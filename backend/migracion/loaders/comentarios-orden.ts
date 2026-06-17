/**
 * Loader de COMENTARIOS de orden (F2-E5). `ComentaOrd.csv` (795) → `OrdenComentario`, vía el
 * MODO MIGRACIÓN del dominio (`crearComentarioOrdenMigrado`, A1).
 *
 * Preserva la auditoría ORIGINAL: IdUsuarios→idUsuario, FechaComen→fecha (NO se sella con now()).
 * Liga IdOrdenes→idOrden vía el mapeo que dejó el loader de órdenes. Idempotencia: por el mapeo de
 * IdComentaOrd; en 2ª corrida no duplica. Comentarios sin orden mapeable o con texto vacío se
 * LISTAN/omiten (§7).
 */
import { crearComentarioOrdenMigrado } from '../../src/dominio/produccion/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import {
  cargarMapaNumerico,
  ENTIDAD_MAPEO,
  guardarMapeo,
  leerMapeo,
  type ClienteMapeo,
} from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearFecha, parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

export async function cargarComentariosOrden(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const mapaOrden = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.orden);

  const r: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };

  for (const f of leerCsv('ComentaOrd.csv')) {
    const idViejo = (f.IdComentaOrd ?? '').trim();
    const idOrdenV1 = (f.IdOrdenes ?? '').trim();
    const comentario = parsearTexto(f.Comentario);

    if (comentario === null) {
      r.omitidos += 1;
      reporte.agregar('Comentario de orden vacío (omitido)', `IdComentaOrd=${idViejo}`);
      continue;
    }
    const idOrden = mapaOrden.get(idOrdenV1);
    if (idOrden === undefined) {
      r.omitidos += 1;
      reporte.agregar(
        'Comentario con orden sin mapeo (omitido)',
        `IdComentaOrd=${idViejo} IdOrdenes=${idOrdenV1}`,
      );
      continue;
    }

    const yaMapeado = await leerMapeo(cliente, ENTIDAD_MAPEO.ordenComentario, idViejo);
    if (yaMapeado !== null) {
      r.existentes += 1;
      continue;
    }

    const id = await intentarCrear(reporte, 'OrdenComentario', idViejo, () =>
      crearComentarioOrdenMigrado(
        sesion,
        {
          idOrden,
          idUsuario: parsearTexto(f.IdUsuarios),
          comentario,
          fecha: parsearFecha(f.FechaComen),
          claveVieja: idViejo,
        },
        bd,
      ),
    );
    if (id === null) {
      r.omitidosValidacion = (r.omitidosValidacion ?? 0) + 1;
      continue;
    }
    r.creados += 1;
    await guardarMapeo(cliente, ENTIDAD_MAPEO.ordenComentario, idViejo, id);
  }

  return r;
}
