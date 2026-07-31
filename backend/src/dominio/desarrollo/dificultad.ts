/**
 * Resolvedor de DIFICULTAD por # de operaciones (rediseño R5, B7) — para el editor de desarrollo.
 *
 * La dificultad NO se teclea: se DERIVA del # de operaciones de costura del modelo contra la tabla
 * configurable `RangoDificultad` (que R4 construyó y alimenta el CPM: `porDificultad`). El editor de
 * desarrollo muestra EN VIVO "34 ops → Muy complejo → costura ≈ 20 d"; para eso llama a esta función
 * (server-side, A1) con el # de operaciones que el usuario captura. Requiere sólo `desarrollo.ver`
 * (el usuario de desarrollo NO necesita permisos de Ruta Crítica para ver su dificultad derivada).
 *
 * El match es el rango ACTIVO cuyo intervalo cubre `ops` (`opsHasta` NULL = abierto "N+"). Los rangos
 * activos no se solapan (lo garantiza el CRUD de R4), así que a lo más UNO casa; si ninguno cubre el
 * valor (tabla vacía o hueco), devuelve `rango: null` y el CPM cae a la duración estándar del proceso.
 */
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';

/** Un rango de dificultad que casó con el # de operaciones. */
export interface RangoDificultadResuelto {
  id: number;
  nombre: string;
  diasCostura: number;
  opsDesde: number;
  opsHasta: number | null;
}

/** Dificultad derivada de un # de operaciones (el rango que casó, o null). */
export interface DificultadResuelta {
  numOperaciones: number;
  rango: RangoDificultadResuelto | null;
}

/**
 * Resuelve el rango de dificultad ACTIVO que cubre `numOperaciones` (o null si ninguno). Requiere
 * `desarrollo.ver`. Orden `opsDesde desc` + `take 1`: con rangos no solapados devuelve el correcto,
 * y ante un solape residual gana el de mayor `opsDesde` (el más específico).
 */
export async function resolverDificultadPorOps(
  sesion: SesionUsuario,
  numOperaciones: number,
  bd?: ContextoBd,
): Promise<DificultadResuelta> {
  verificarPermiso(sesion, 'desarrollo.ver');
  const rango = await clienteLectura(bd).rangoDificultad.findFirst({
    where: {
      activo: true,
      opsDesde: { lte: numOperaciones },
      OR: [{ opsHasta: null }, { opsHasta: { gte: numOperaciones } }],
    },
    orderBy: { opsDesde: 'desc' },
    select: { id: true, nombre: true, diasCostura: true, opsDesde: true, opsHasta: true },
  });
  return { numOperaciones, rango: rango ?? null };
}
