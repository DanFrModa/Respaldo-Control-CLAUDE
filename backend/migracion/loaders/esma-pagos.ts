/**
 * Loader de PAGOS EsMa históricos (F6-E6).
 *
 *   `EsMa_Pagos.csv` (5,935) → `PagoMaquilero`. Cada renglón es un pago LIBRE ligado a su cabecera
 *   `EsMa` (maquilero + fecha + obs). ⭐ Los pagos históricos NO tienen liga a cargos: el viejo nunca
 *   llevó esa FK. Por eso se cargan vía `crearPagoMigrado` (modo migración, A1) que inserta el pago
 *   SIN `aplicaciones`, SIN el `pg_advisory_xact_lock` por maquilero y SIN recomputar `Orden.pagada`
 *   (a diferencia del servicio normal `pagos.ts::crearPagoMaquilero`, que exige aplicaciones). El
 *   esquema permite un pago sin aplicaciones — E4 lo dejó a propósito para este ETL.
 *
 * Mapeo de campos (la cabecera aporta maquilero + fecha + obs, ver `esma-cargos.ts`):
 *  • idMaquilero: `EsMa.IdMaquileros` → Proveedor (catálogo `Maquileros`). Sin mapeo → OMITIDO + listado.
 *  • monto: `PagoEsMa` (nulo → 0).
 *  • fecha: `EsMa.FechaEsMa` (obligatoria; vacía → OMITIDO + listado).
 *  • observaciones: combina `ObsPagos` + `EsMa.ObsEsMa`.
 *  • estadoRevision: `RevisionPendienteP` 1 → `capturado` (por revisar) / 0 → `revisado`.
 *
 * Idempotencia: por el `MapeoMigracion` de `IdEsMa_Pagos`.
 */
import { crearPagoMigrado } from '../../src/dominio/esma/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';

import { ENTIDAD_MAPEO, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { cargarMovimientosPlanosEsMa, type ResultadoEsMa } from './esma-cargos.js';

/** Carga los PAGOS históricos LIBRES (`EsMa_Pagos.csv` → `PagoMaquilero`, sin aplicaciones). */
export async function cargarPagosEsMa(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoEsMa> {
  return cargarMovimientosPlanosEsMa(sesion, cliente, reporte, {
    etiqueta: 'PagoMaquilero',
    archivo: 'EsMa_Pagos.csv',
    columnaId: 'IdEsMa_Pagos',
    columnaMonto: 'PagoEsMa',
    columnaObs: 'ObsPagos',
    columnaRevision: 'RevisionPendienteP', // 1 → capturado (por revisar) / 0 → revisado
    entidadMapeo: ENTIDAD_MAPEO.pagoMaquilero,
    crear: crearPagoMigrado,
  });
}
