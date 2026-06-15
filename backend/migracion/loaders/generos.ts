/**
 * Loader de GÉNEROS (F1-E6). `IPT_Generos.csv` (8) → catálogo `Genero` (upsert por nombre).
 *
 * `Genero` NO tiene servicio de dominio `crear*`: es un catálogo SELECTOR (ABM diferido,
 * sembrado directo en `prisma/seed.ts` con `GENEROS_BASE` — mismo patrón que `RolProveedor`/
 * `TipoProceso`). Por eso, por COHERENCIA con el propio proyecto, este loader hace `upsert`
 * directo (no hay servicio que invocar). Es idempotente (igual que el seed) y, además, no
 * pisa el `activo` si ya existe. Persiste el mapeo `IdIPT_Generos → idGenero` (reusado por
 * E7, donde `Modelo.idGenero` se poblará).
 */
import type { SesionUsuario } from '../../src/comun/permisos.js';

import { leerCsv } from '../comun/csv.js';
import { ENTIDAD_MAPEO, guardarMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { parsearTexto } from '../comun/valores.js';
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

  for (const fila of filas) {
    const idViejo = fila.IdIPT_Generos;
    const nombre = parsearTexto(fila.Genero);
    if (nombre === null) {
      omitidos += 1;
      reporte.agregar('Géneros con nombre vacío (omitidos)', `Id=${idViejo ?? '?'}`);
      continue;
    }

    const existe = await cliente.genero.findUnique({
      where: { nombre },
      select: { id: true },
    });
    let idNuevo: number;
    if (existe === null) {
      const creado = await cliente.genero.create({ data: { nombre }, select: { id: true } });
      idNuevo = creado.id;
      creados += 1;
    } else {
      idNuevo = existe.id;
      existentes += 1;
    }

    if (idViejo !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.genero, idViejo, idNuevo, { nombre });
    }
  }

  return { creados, existentes, omitidos };
}
