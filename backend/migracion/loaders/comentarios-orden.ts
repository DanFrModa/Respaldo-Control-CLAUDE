/**
 * Loader de COMENTARIOS de orden (F2-E5). `ComentaOrd.csv` (795) → `OrdenComentario`, vía el
 * MODO MIGRACIÓN del dominio (`crearComentarioOrdenMigrado`, A1).
 *
 * Preserva la auditoría ORIGINAL: IdUsuarios→idUsuario, FechaComen→fecha (NO se sella con now()).
 * Liga IdOrdenes→idOrden vía el mapeo que dejó el loader de órdenes. Idempotencia: por el mapeo de
 * IdComentaOrd; en 2ª corrida no duplica. Comentarios sin orden mapeable o con texto vacío se
 * LISTAN/omiten (§7).
 *
 * VENTANA temporal (recarga limitada, p. ej. `ETL_DESDE=2025-01-01`): el comentario NO filtra por
 * su propia fecha — cuelga de la orden. CASCADA: si su orden quedó fuera de la ventana, el
 * comentario se excluye también y se CUENTA en su propio bucket (`fueraVentana`), separado de
 * "orden sin mapeo". Ventana inactiva (default) → migra todo, como siempre.
 */
import { crearComentarioOrdenMigrado } from '../../src/dominio/produccion/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import {
  cargarMapaNumerico,
  ENTIDAD_MAPEO,
  guardarMapeo,
  leerMapeo,
  type ClienteMapeo,
} from '../comun/mapeo.js';
import { conReintentoTransitorio } from '../comun/reintentos.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearFecha, parsearTexto } from '../comun/valores.js';
import { prescanVentanaF2, type PrescanVentanaF2 } from '../comun/ventana-f2.js';
import { resolverVentana } from '../comun/ventana.js';
import type { ResultadoLoader } from './clientes.js';

/** Desenlace de procesar un comentario (para agregar conteos tras los lotes). */
type Desenlace = 'creado' | 'existente' | 'omitido' | 'omitidoValidacion' | 'fueraVentana';

export async function cargarComentariosOrden(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  prescan?: PrescanVentanaF2 | null,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const mapaOrden = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.orden);
  // Prescan de la ventana (cascada orden→comentario): lo pasa el orquestador; suelto se calcula
  // aquí. Con ventana inactiva es `null` (cero costo, comportamiento de siempre).
  const pre = prescan === undefined ? prescanVentanaF2(resolverVentana()) : prescan;

  // Cada comentario es una unidad INDEPENDIENTE → carga concurrente acotada (con reintento ante
  // cortes transitorios de conexión; la unidad es idempotente por el mapeo de IdComentaOrd).
  const filas = leerCsv('ComentaOrd.csv');
  const resultados = await enLotes(
    filas,
    (f): Promise<Desenlace> =>
      conReintentoTransitorio(() =>
        procesarComentario(sesion, bd, cliente, reporte, mapaOrden, pre, f),
      ),
    CONCURRENCIA_ETL,
  );

  const r: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };
  let fueraVentana = 0;
  for (const res of resultados) {
    const d = res.ok ? res.valor : 'omitidoValidacion';
    if (d === 'creado') r.creados += 1;
    else if (d === 'existente') r.existentes += 1;
    else if (d === 'omitido') r.omitidos += 1;
    else if (d === 'fueraVentana') fueraVentana += 1;
    else r.omitidosValidacion = (r.omitidosValidacion ?? 0) + 1;
  }
  // Lo excluido por cascada de la ventana se REPORTA agregado (conteo, no lista — §7).
  if (fueraVentana > 0) {
    reporte.nota(
      `ComentaOrd fuera de ventana: ${String(fueraVentana)} comentarios de órdenes excluidas — NO migrados (cascada).`,
    );
  }
  r.fueraVentana = fueraVentana;
  return r;
}

/** Procesa UNA fila de ComentaOrd (idempotente, tolerante). */
async function procesarComentario(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: ClienteMapeo,
  reporte: Reporte,
  mapaOrden: Map<string, number>,
  prescan: PrescanVentanaF2 | null,
  f: Record<string, string>,
): Promise<Desenlace> {
  const idViejo = (f.IdComentaOrd ?? '').trim();
  const idOrdenV1 = (f.IdOrdenes ?? '').trim();
  const comentario = parsearTexto(f.Comentario);

  // Cascada de la ventana ANTES del mapeo: el comentario de una orden excluida NO debe caer en
  // el bucket "orden sin mapeo" — es exclusión a propósito, con su propio conteo.
  if (prescan !== null && prescan.ordenesFuera.has(idOrdenV1)) {
    return 'fueraVentana';
  }

  if (comentario === null) {
    reporte.agregar('Comentario de orden vacío (omitido)', `IdComentaOrd=${idViejo}`);
    return 'omitido';
  }
  const idOrden = mapaOrden.get(idOrdenV1);
  if (idOrden === undefined) {
    reporte.agregar(
      'Comentario con orden sin mapeo (omitido)',
      `IdComentaOrd=${idViejo} IdOrdenes=${idOrdenV1}`,
    );
    return 'omitido';
  }

  const yaMapeado = await leerMapeo(cliente, ENTIDAD_MAPEO.ordenComentario, idViejo);
  if (yaMapeado !== null) {
    return 'existente';
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
    return 'omitidoValidacion';
  }
  await guardarMapeo(cliente, ENTIDAD_MAPEO.ordenComentario, idViejo, id);
  return 'creado';
}
