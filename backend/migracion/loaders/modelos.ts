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
      `Modelos fuera de ventana (sin uso: sin pedidos/órdenes/kardex/existencia/cíclico en la ` +
        `ventana): ${String(fueraVentana)} NO migrados (ver sección en el reporte).`,
    );
  }
  // Lista COMPLETA que pidió el dueño: modelos que migran por SOLO existencia (sin actividad
  // en la ventana) — candidatos a depurar. El `Reporte` acota su volcado a 50 renglones, así
  // que va a un archivo propio (gitignored como los reporte-etl-*) y al Reporte solo el conteo
  // + la ruta.
  if (pre !== null && pre.modelosSoloExistencia.size > 0) {
    const ruta = escribirCandidatosDepurar(pre, filas);
    reporte.nota(
      `Modelos SIN actividad en la ventana pero CON existencia (migrados por saldo — candidatos ` +
        `a depurar con Daniel): ${String(pre.modelosSoloExistencia.size)}. Lista COMPLETA en: ${ruta}`,
    );
  }
  return { creados, existentes, omitidos, omitidosValidacion, fueraVentana };
}

/**
 * Escribe la lista COMPLETA de candidatos a depurar (código + descripción + existencia PT
 * estimada) en `candidatos-depurar-modelos-<timestamp>.txt` junto a los reportes del ETL.
 * Devuelve la ruta escrita.
 */
function escribirCandidatosDepurar(pre: PrescanUso, filas: Record<string, string>[]): string {
  const renglones: string[] = [];
  const conFila = new Set<string>();
  for (const fila of filas) {
    const codigo = (fila.Modelo ?? '').trim();
    const codigoNorm = codigo.toUpperCase();
    if (
      codigoNorm === '' ||
      !pre.modelosSoloExistencia.has(codigoNorm) ||
      conFila.has(codigoNorm)
    ) {
      continue;
    }
    conFila.add(codigoNorm);
    const existencia = pre.existenciaPtEstimadaPorCodigo.get(codigoNorm) ?? 0;
    const descripcion = (fila.Descripcion ?? '').trim();
    renglones.push(`${codigo}\t${descripcion}\texistencia≈${String(existencia)}`);
  }
  // Códigos del kardex sin fila en Modelos.csv (no migran como catálogo; se listan igual).
  for (const codigoNorm of pre.modelosSoloExistencia) {
    if (conFila.has(codigoNorm)) continue;
    const existencia = pre.existenciaPtEstimadaPorCodigo.get(codigoNorm) ?? 0;
    renglones.push(`${codigoNorm}\t(sin fila en Modelos.csv)\texistencia≈${String(existencia)}`);
  }
  const ruta = join(
    process.cwd(),
    `candidatos-depurar-modelos-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
  );
  const encabezado =
    'MODELOS SIN ACTIVIDAD EN LA VENTANA PERO CON EXISTENCIA (candidatos a depurar — para Daniel)\n' +
    'Migran SOLO porque su saldo inicial de inventario PT los necesita (sin pedidos/órdenes/\n' +
    'movimientos/cíclico dentro de la ventana). Columnas: codigo <TAB> descripcion <TAB> existencia estimada.\n' +
    `Total: ${String(renglones.length)}\n` +
    '─'.repeat(80) +
    '\n';
  writeFileSync(ruta, encabezado + renglones.join('\n') + '\n', { encoding: 'utf-8' });
  return ruta;
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
      reporte.agregar(
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
