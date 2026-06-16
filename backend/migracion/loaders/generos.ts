/**
 * Loader de GÉNEROS (F1-E6). `IPT_Generos.csv` (8) → catálogo `Genero` (upsert por nombre
 * NORMALIZADO).
 *
 * `Genero` NO tiene servicio de dominio `crear*`: es un catálogo SELECTOR (ABM diferido,
 * sembrado directo en `prisma/seed.ts` con `GENEROS_BASE` — mismo patrón que `RolProveedor`/
 * `TipoProceso`). Por eso, por COHERENCIA con el propio proyecto, este loader hace `upsert`
 * directo (no hay servicio que invocar).
 *
 * IDEMPOTENCIA ROBUSTA (corrige el cuadre que mostró 12 en vez de 8): el `nombre` es @unique
 * EXACTO en BD, pero el `ñ` del seed ("Niño Infantil"…) y el del CSV (latin-1) pueden venir en
 * formas Unicode distintas (NFC precompuesto vs NFD descompuesto) o con otra capitalización,
 * así que un `findUnique` por nombre exacto NO encuentra el género ya sembrado y crea un
 * DUPLICADO. Aquí se compara por nombre NORMALIZADO (`normalizarParaDedup`: NFD + sin acentos
 * + minúsculas + espacios colapsados, el MISMO criterio de dedup del resto del ETL), así un
 * "Niño Infantil" sembrado por E4 se reconoce aunque difiera en forma Unicode/caso. Tras
 * correr, géneros = 8 (no se duplican los sembrados). Persiste `IdIPT_Generos → idGenero`.
 */
import type { SesionUsuario } from '../../src/comun/permisos.js';

import { leerCsv } from '../comun/csv.js';
import { ENTIDAD_MAPEO, guardarMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { normalizarParaDedup, parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

export async function cargarGeneros(
  _sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const filas = leerCsv('IPT_Generos.csv');
  let creados = 0;
  let existentes = 0;
  let omitidos = 0;
  let omitidosValidacion = 0;

  // Índice en memoria de los géneros EXISTENTES por nombre normalizado (incluye los sembrados
  // por E4). Se actualiza al crear, para que filas duplicadas del CSV en la misma corrida
  // tampoco dupliquen.
  const existentesPorNorm = new Map<string, number>();
  for (const g of await cliente.genero.findMany({ select: { id: true, nombre: true } })) {
    existentesPorNorm.set(normalizarParaDedup(g.nombre), g.id);
  }

  for (const fila of filas) {
    const idViejo = fila.IdIPT_Generos;
    const nombre = parsearTexto(fila.Genero);
    if (nombre === null) {
      omitidos += 1;
      reporte.agregar('Géneros con nombre vacío (omitidos)', `Id=${idViejo ?? '?'}`);
      continue;
    }
    const norm = normalizarParaDedup(nombre);

    let idNuevo: number;
    const existeId = existentesPorNorm.get(norm);
    if (existeId === undefined) {
      // Tolerante a error de fila (uniformidad con el resto de loaders).
      const creado = await intentarCrear(reporte, 'Genero', idViejo, () =>
        cliente.genero.create({ data: { nombre }, select: { id: true } }),
      );
      if (creado === null) {
        omitidosValidacion += 1;
        continue;
      }
      idNuevo = creado.id;
      existentesPorNorm.set(norm, idNuevo);
      creados += 1;
    } else {
      idNuevo = existeId;
      existentes += 1;
    }

    if (idViejo !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.genero, idViejo, idNuevo, { nombre });
    }
  }

  return { creados, existentes, omitidos, omitidosValidacion };
}
