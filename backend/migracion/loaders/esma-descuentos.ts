/**
 * Loader de DESCUENTOS EsMa históricos (F6-E6).
 *
 *   `EsMa_Desc.csv` (743) → `DescuentoMaquilero`. Cada renglón es un descuento ligado a su cabecera
 *   `EsMa` (maquilero + fecha + obs). En v2 el movimiento es PLANO (F6-E4). Carga vía el MODO
 *   MIGRACIÓN del dominio (`crearDescuentoMigrado`, A1): SIN efectos derivados, `conFactura = null`,
 *   `estadoRevision = revisado` (histórico ya conciliado — no traían bandera de revisión).
 *
 * Mapeo de campos (la cabecera aporta maquilero + fecha + obs, ver `esma-cargos.ts`):
 *  • idMaquilero: `EsMa.IdMaquileros` → Proveedor (catálogo `Maquileros`). Sin mapeo → OMITIDO + listado.
 *  • monto: `DescuentoEsMa` (nulo → 0). Puede ser NEGATIVO: se preserva tal cual.
 *  • fecha: `EsMa.FechaEsMa` (obligatoria; vacía → OMITIDO + listado).
 *  • observaciones: combina `ObsDesc` + `EsMa.ObsEsMa`.
 *
 * Idempotencia: por el `MapeoMigracion` de `IdEsMa_Desc`.
 */
import { crearDescuentoMigrado } from '../../src/dominio/esma/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';

import { ENTIDAD_MAPEO, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { cargarMovimientosPlanosEsMa, type ResultadoEsMa } from './esma-cargos.js';

/** Carga los DESCUENTOS históricos (`EsMa_Desc.csv` → `DescuentoMaquilero`). */
export async function cargarDescuentosEsMa(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoEsMa> {
  return cargarMovimientosPlanosEsMa(sesion, cliente, reporte, {
    etiqueta: 'DescuentoMaquilero',
    archivo: 'EsMa_Desc.csv',
    columnaId: 'IdEsMa_Desc',
    columnaMonto: 'DescuentoEsMa',
    columnaObs: 'ObsDesc',
    columnaRevision: null, // el viejo no traía bandera de revisión → revisado (ya conciliado)
    entidadMapeo: ENTIDAD_MAPEO.descuentoMaquilero,
    crear: crearDescuentoMigrado,
  });
}
