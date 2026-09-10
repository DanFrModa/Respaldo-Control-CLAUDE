/**
 * Loader de MODELOS (F1-E7). `Modelos.csv` (~4,987 filas) → catálogo `Modelo` vía el dominio
 * (`crearModeloMigrado`). Regla A1: NUNCA `prisma.create` directo del catálogo.
 *
 * ⚠️ **Por qué el MODO MIGRACIÓN y no `crearModelo` a secas (V1-E8j, §Post-F9.134).** Desde esa
 * decisión el alta normal hace nacer todo modelo en **DESARROLLO** (sin nº de producción; el
 * catálogo de producción se llena sólo por «pasar a producción»). El histórico del Access es lo
 * contrario en las dos cosas: son modelos que YA son de producción y **no tienen orden** (su código
 * de 5 dígitos ES su nº de producción y nunca pasaron por Desarrollo) y **no traen género** — el CSV
 * ni siquiera tiene la columna—, que el alta normal ahora EXIGE.
 *
 * `crearModeloMigrado` (`src/dominio/modelos/migracion.ts`) **NO llama a `crearModelo`**: los dos
 * comparten `crearModeloNucleo` —mismas validaciones de código y FKs, misma auditoría, misma
 * bitácora— y **la marca de nomenclatura viaja en el propio `create`**, no en un `update` posterior.
 * La exigencia de los dos dígitos vive UNA sola vez, por ENCIMA del núcleo, en el alta normal: así
 * la migración entra **por debajo** sin banderas.
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
 */
import { actualizarModelo } from '../../src/dominio/modelos/modelos.js';
import { crearModeloMigrado } from '../../src/dominio/modelos/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import { ENTIDAD_MAPEO, guardarMapeo, leerMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear, truncarYReportar } from '../comun/saneo.js';
import { parsearBandera, parsearDinero, parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

/** Topes de longitud de los campos de Modelo (calcados del Zod de `src/contrato/esquemas/modelo`). */
const LIMITES_MODELO = {
  codigo: 50,
  descripcion: 500,
} as const;

/** Desenlace de procesar una fila (para conteos). */
type Desenlace = 'creado' | 'existente' | 'omitido' | 'omitidoValidacion';

export async function cargarModelos(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const filas = leerCsv('Modelos.csv');

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
    (fila): Promise<Desenlace> => procesarModelo(sesion, bd, cliente, reporte, fila),
    CONCURRENCIA_ETL,
  );

  let creados = 0;
  let existentes = 0;
  let omitidos = 0;
  let omitidosValidacion = 0;
  for (const r of resultados) {
    const d = r.ok ? r.valor : 'omitidoValidacion';
    if (d === 'creado') creados += 1;
    else if (d === 'existente') existentes += 1;
    else if (d === 'omitido') omitidos += 1;
    else omitidosValidacion += 1;
  }
  return { creados, existentes, omitidos, omitidosValidacion };
}

async function procesarModelo(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: ClienteMapeo,
  reporte: Reporte,
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
    crearModeloMigrado(
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
