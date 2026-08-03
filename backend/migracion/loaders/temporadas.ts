/**
 * Loader de TEMPORADAS (F1-E6). `Temporadas.csv` está **CONFIRMADO VACÍO** (0 filas de
 * datos). NO se inventa nada: este loader detecta la fuente vacía y lo emite al reporte para
 * decisión (§7, NUNCA un null silencioso).
 *
 * Si en el futuro la fuente trae filas (p. ej. recuperadas del .mdb con contraseña), este
 * loader las cargaría VÍA el dominio `crearTemporada` (idempotente por nombre). Hoy solo
 * reporta el faltante, que afecta a E7 (4,984 modelos con `IdTemporadas`).
 */
import { crearTemporada } from '../../src/dominio/catalogos/temporadas.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { ENTIDAD_MAPEO, guardarMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import { prescanUso, type PrescanUso } from '../comun/prescan-uso.js';
import type { Reporte } from '../comun/reporte.js';
import { resolverVentana } from '../comun/ventana.js';
import { parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

export async function cargarTemporadas(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  prescan?: PrescanUso | null,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  let filas: Record<string, string>[];
  try {
    filas = leerCsv('Temporadas.csv');
  } catch {
    filas = [];
  }
  // Ventana ACTIVA → solo las temporadas de los modelos migrados (orden del dueño). En los
  // datos reales `Modelos.IdTemporadas` es 0 en TODAS las filas y este CSV viene vacío, así
  // que en la práctica no cambia nada; se aplica por corrección del criterio.
  const pre = prescan === undefined ? prescanUso(resolverVentana()) : prescan;
  if (pre !== null) {
    const antes = filas.length;
    filas = filas.filter((f) => pre.temporadasId.has((f.IdTemporadas ?? '').trim()));
    if (antes - filas.length > 0) {
      reporte.nota(
        `Temporadas fuera de ventana (sin uso en los modelos migrados): ${String(antes - filas.length)} NO migradas.`,
      );
    }
  }

  if (filas.length === 0) {
    reporte.agregar(
      'Temporadas: fuente VACÍA — pendiente de decisión',
      'Temporadas.csv no trae filas. Recuperar del .mdb con contraseña o decisión de Daniel ' +
        '(afecta E7: 4,984 modelos tienen IdTemporadas que quedarán sin mapear).',
    );
    return { creados: 0, existentes: 0, omitidos: 0 };
  }

  // Camino futuro (hoy no se ejecuta): si hubiera filas, cargarlas idempotentemente.
  let creados = 0;
  let existentes = 0;
  for (const fila of filas) {
    const nombre = parsearTexto(fila.Temporada);
    const idViejo = fila.IdTemporadas;
    if (nombre === null) {
      continue;
    }
    const existe = await cliente.temporada.findFirst({
      where: { nombre: { equals: nombre, mode: 'insensitive' } },
      select: { id: true },
    });
    let idNuevo: number;
    if (existe === null) {
      const creada = await crearTemporada(sesion, { nombre }, bd);
      idNuevo = creada.id;
      creados += 1;
    } else {
      idNuevo = existe.id;
      existentes += 1;
    }
    if (idViejo !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.temporada, idViejo, idNuevo, { nombre });
    }
  }
  return { creados, existentes, omitidos: 0 };
}
