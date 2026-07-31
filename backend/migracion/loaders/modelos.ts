/**
 * Loader de MODELOS (F1-E7). `Modelos.csv` (~4,987 filas) → catálogo `Modelo` vía el dominio
 * (`crearModelo`). Regla A1: NUNCA `prisma.create` directo del catálogo.
 *
 * Mapeos que consume (producidos por E6):
 *  • `ENTIDAD_MAPEO.genero` — el CSV de Modelos NO trae `IdGeneros` (columna ausente).
 *    Los modelos se cargan SIN género (campo opcional); se puede asignar después.
 *  • `ENTIDAD_MAPEO.temporada` — la fuente `Temporadas.csv` quedó VACÍA en E6 (ver cuadre).
 *    `IdTemporadas` en todos los registros del CSV es `0`, que no mapea a ninguna temporada
 *    real. Decisión del dueño: cargar el modelo SIN temporada y reportar el total al cuadre
 *    como incidencia informativa (NO null silencioso, §7).
 *
 * Idempotente: la clave de idempotencia es `IdModelos` viejo → mapeo `Modelo`. Si ya existe,
 * se salta. Al final persiste el mapeo `IdModelos viejo → id nuevo` (lo consumen BOM y fotos).
 *
 * `Modelo.codigo` tiene unicidad global (ADR-0007). Si en los datos hay códigos duplicados,
 * `exigirCodigoLibre` lanza `ErrorConflicto` — se reporta y el segundo se omite (no se pierde:
 * queda anotado al reporte de cuadre).
 *
 * `Maquila` → `maquilaBase` (mismo parseo de dinero que telas/avíos).
 * `Activo = '0'` → el modelo se descontinúa tras crear (borrado suave, igual que telas).
 *
 * VENTANA temporal (recarga limitada; pedido del dueño "hay muchísimos y ya no me sirven"):
 * con la ventana ACTIVA solo migran los modelos USADOS (prescan de `comun/prescan-uso.ts`:
 * pedidos/órdenes en ventana ∪ kardex PT ≥ corte ∪ existencia ∪ cíclico). Los que migran
 * SOLO por existencia se listan aparte ("candidatos a depurar", para Daniel). El resto va al
 * bucket `fueraVentana` (conteo agregado + muestra, §7). Inactiva → migran todos, como hoy.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { crearModelo, actualizarModelo } from '../../src/dominio/modelos/modelos.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import { ENTIDAD_MAPEO, guardarMapeo, leerMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import { prescanUso, type PrescanUso } from '../comun/prescan-uso.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear, truncarYReportar } from '../comun/saneo.js';
import { parsearBandera, parsearDinero, parsearTexto } from '../comun/valores.js';
import { resolverVentana } from '../comun/ventana.js';
import type { ResultadoLoader } from './clientes.js';

/** Topes de longitud de los campos de Modelo (calcados del Zod de `src/contrato/esquemas/modelo`). */
const LIMITES_MODELO = {
  codigo: 50,
  descripcion: 500,
} as const;

/** Desenlace de procesar una fila (para conteos). */
type Desenlace = 'creado' | 'existente' | 'omitido' | 'omitidoValidacion' | 'fueraVentana';

export async function cargarModelos(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  prescan?: PrescanUso | null,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const filas = leerCsv('Modelos.csv');
  // Prescan de USO (lo pasa el orquestador; suelto se calcula aquí). Inactivo → null.
  const pre = prescan === undefined ? prescanUso(resolverVentana()) : prescan;

  // Nota de incidencia: IdTemporadas siempre es 0 (Temporadas.csv vacío en E6).
  // Todos los modelos se cargan sin temporada; reportar al cuadre como incidencia informativa.
  reporte.nota(
    'Temporadas: Modelos.csv trae IdTemporadas en todos los registros, pero Temporadas.csv ' +
      'quedó vacío en E6 y todos los IdTemporadas son 0 (sin mapeo). Los ' +
      `${String(filas.length)} modelos se cargan SIN temporada. (Decisión del dueño: ` +
      'cargar sin temporada y reportar como incidencia — §7, no null silencioso.)',
  );

  const resultados = await enLotes(
    filas,
    (fila): Promise<Desenlace> => procesarModelo(sesion, bd, cliente, reporte, pre, fila),
    CONCURRENCIA_ETL,
  );

  let creados = 0;
  let existentes = 0;
  let omitidos = 0;
  let omitidosValidacion = 0;
  let fueraVentana = 0;
  for (const r of resultados) {
    const d = r.ok ? r.valor : 'omitidoValidacion';
    if (d === 'creado') creados += 1;
    else if (d === 'existente') existentes += 1;
    else if (d === 'omitido') omitidos += 1;
    else if (d === 'fueraVentana') fueraVentana += 1;
    else omitidosValidacion += 1;
  }
  if (pre !== null && fueraVentana > 0) {
    reporte.nota(
      `Modelos fuera de ventana (SIN actividad en la ventana: sin pedidos/órdenes, sin kardex ` +
        `PT ≥ corte y sin cíclico): ${String(fueraVentana)} NO migrados.`,
    );
  }
  // CONSTANCIA para Daniel (criterio del dueño: lo sin actividad NO entra aunque tenga saldo):
  // deja por escrito QUÉ inventario se dejó de migrar. Va a un archivo propio porque el
  // `Reporte` acota su volcado a 50 renglones; al Reporte solo el conteo + la ruta.
  if (
    pre !== null &&
    (pre.modelosExcluidosConExistencia.size > 0 || pre.telasExcluidasConExistencia.size > 0)
  ) {
    const { ruta, totalModelos, existenciaModelos, totalTelas, existenciaTelas } =
      escribirExcluidosSinActividad(pre, filas);
    reporte.nota(
      `Inventario NO migrado por falta de actividad en la ventana (decisión del dueño): ` +
        `${String(totalModelos)} modelos (≈${existenciaModelos.toFixed(0)} pzas) y ` +
        `${String(totalTelas)} telas (≈${existenciaTelas.toFixed(0)} u). Constancia COMPLETA en: ${ruta}`,
    );
  }
  return { creados, existentes, omitidos, omitidosValidacion, fueraVentana };
}

/**
 * Escribe la CONSTANCIA del inventario que NO se migra: modelos y telas EXCLUIDOS por no tener
 * actividad en la ventana pero que SÍ traían existencia pre-corte, con su existencia estimada.
 * Archivo `excluidos-sin-actividad-<timestamp>.txt` junto a los reportes del ETL (gitignored).
 * Devuelve la ruta + los totales para la nota del `Reporte`.
 */
function escribirExcluidosSinActividad(
  pre: PrescanUso,
  filas: Record<string, string>[],
): {
  ruta: string;
  totalModelos: number;
  existenciaModelos: number;
  totalTelas: number;
  existenciaTelas: number;
} {
  // ── Modelos ──
  const renglonesModelos: string[] = [];
  const conFila = new Set<string>();
  let existenciaModelos = 0;
  const anotarModelo = (codigo: string, codigoNorm: string, descripcion: string): void => {
    const existencia = pre.existenciaPtEstimadaPorCodigo.get(codigoNorm) ?? 0;
    existenciaModelos += Math.abs(existencia);
    renglonesModelos.push(`${codigo}\t${descripcion}\texistencia≈${String(existencia)}`);
  };
  for (const fila of filas) {
    const codigo = (fila.Modelo ?? '').trim();
    const codigoNorm = codigo.toUpperCase();
    if (
      codigoNorm === '' ||
      !pre.modelosExcluidosConExistencia.has(codigoNorm) ||
      conFila.has(codigoNorm)
    ) {
      continue;
    }
    conFila.add(codigoNorm);
    anotarModelo(codigo, codigoNorm, (fila.Descripcion ?? '').trim());
  }
  // Códigos del kardex sin fila en Modelos.csv (se listan igual: es inventario que se pierde).
  for (const codigoNorm of pre.modelosExcluidosConExistencia) {
    if (conFila.has(codigoNorm)) continue;
    anotarModelo(codigoNorm, codigoNorm, '(sin fila en Modelos.csv)');
  }

  // ── Telas ──
  const renglonesTelas: string[] = [];
  let existenciaTelas = 0;
  for (const idTelas of pre.telasExcluidasConExistencia) {
    const existencia = pre.existenciaTelaEstimadaPorId.get(idTelas) ?? 0;
    existenciaTelas += Math.abs(existencia);
    renglonesTelas.push(`IdTelas=${idTelas}\texistencia≈${String(existencia)}`);
  }

  const ruta = join(
    process.cwd(),
    `excluidos-sin-actividad-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
  );
  const texto = [
    'INVENTARIO QUE NO SE MIGRA — constancia para Daniel',
    '',
    'Criterio vigente (decisión del DUEÑO): a la recarga por ventana solo entra lo que tuvo',
    'ACTIVIDAD dentro de la ventana. Lo de abajo quedó FUERA aunque traía existencia/saldo previo',
    '("ya no me sirve"). Se deja por escrito para que quede registro de qué inventario se dejó de',
    'migrar. NO es una incidencia ni un error: es la decisión aplicada.',
    '',
    `MODELOS excluidos con existencia PT: ${String(renglonesModelos.length)} ` +
      `(≈${existenciaModelos.toFixed(0)} piezas en total)`,
    'Columnas: codigo <TAB> descripcion <TAB> existencia estimada',
    '─'.repeat(80),
    ...renglonesModelos,
    '',
    `TELAS excluidas con existencia: ${String(renglonesTelas.length)} ` +
      `(≈${existenciaTelas.toFixed(0)} unidades en total)`,
    'Columnas: IdTelas (clave v1) <TAB> existencia estimada',
    '─'.repeat(80),
    ...renglonesTelas,
    '',
  ].join('\n');
  writeFileSync(ruta, texto, { encoding: 'utf-8' });
  return {
    ruta,
    totalModelos: renglonesModelos.length,
    existenciaModelos,
    totalTelas: renglonesTelas.length,
    existenciaTelas,
  };
}

async function procesarModelo(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: ClienteMapeo,
  reporte: Reporte,
  pre: PrescanUso | null,
  fila: Record<string, string>,
): Promise<Desenlace> {
  const idViejo = fila.IdModelos;

  // Idempotencia: si ya está mapeado, saltar.
  if (idViejo !== undefined && idViejo.trim() !== '') {
    const ya = await leerMapeo(cliente, ENTIDAD_MAPEO.modelo, idViejo);
    if (ya !== null) {
      return 'existente';
    }
  }

  // Código del modelo (campo `Modelo` en el CSV — es el código de negocio).
  const codigoCrudo = parsearTexto(fila.Modelo);
  if (codigoCrudo === null) {
    reporte.agregar('Modelos con código vacío (omitidos)', `IdModelos=${idViejo ?? '?'}`);
    return 'omitido';
  }

  // Ventana por USO: modelo sin uso (ni por id ni por código) → fuera, con su propio bucket.
  if (pre !== null) {
    const codigoNorm = codigoCrudo.trim().toUpperCase();
    const usado =
      (idViejo !== undefined && pre.modelosId.has(idViejo.trim())) ||
      pre.modelosCodigo.has(codigoNorm);
    if (!usado) {
      reporte.agregarMuestra(
        'Modelos FUERA de ventana (sin uso en la ventana — NO migrados)',
        `codigo="${codigoCrudo}" (IdModelos=${idViejo ?? '?'})`,
      );
      return 'fueraVentana';
    }
    // Los que migran por SOLO existencia se listan COMPLETOS en un archivo propio (lo escribe
    // `cargarModelos` al final — el Reporte acota a 50 renglones y el dueño pidió la lista entera).
  }
  const codigo =
    truncarYReportar(reporte, 'Modelo', idViejo, 'codigo', codigoCrudo, LIMITES_MODELO.codigo) ??
    codigoCrudo;

  const descripcionCruda = parsearTexto(fila.Descripcion);
  const descripcion =
    truncarYReportar(
      reporte,
      'Modelo',
      idViejo,
      'descripcion',
      descripcionCruda,
      LIMITES_MODELO.descripcion,
    ) ?? undefined;

  const maquilaBase = parsearDinero(fila.Maquila);

  // IdTemporadas: siempre 0 en los datos reales → no mapear (ya reportado como nota global).
  // El modelo se crea sin temporada.

  const creado = await intentarCrear(reporte, 'Modelo', idViejo, () =>
    crearModelo(
      sesion,
      {
        codigo,
        ...(descripcion !== undefined ? { descripcion } : {}),
        ...(maquilaBase !== null && maquilaBase > 0 ? { maquilaBase } : {}),
      },
      bd,
    ),
  );

  if (creado === null) {
    return 'omitidoValidacion';
  }

  // Si estaba inactivo en el viejo, descontinuarlo (borrado suave).
  if (!parsearBandera(fila.Activo)) {
    await actualizarModelo(sesion, { id: creado.id, activo: false }, bd);
  }

  // Persistir el mapeo IdModelos viejo → id nuevo.
  if (idViejo !== undefined && idViejo.trim() !== '') {
    await guardarMapeo(cliente, ENTIDAD_MAPEO.modelo, idViejo, creado.id, {
      codigo: creado.codigo,
    });
  }

  return 'creado';
}
