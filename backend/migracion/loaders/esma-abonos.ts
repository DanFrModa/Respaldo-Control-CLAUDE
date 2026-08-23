/**
 * Loader de ABONOS EsMa históricos (F6-E6).
 *
 *   `EsMa_Abonos.csv` (554) → `AbonoMaquilero`. Cada renglón es un abono ligado a su cabecera `EsMa`
 *   (maquilero + fecha + obs). En v2 el movimiento es PLANO (F6-E4): el maquilero + la fecha + la obs
 *   viven en el propio abono. Carga vía el MODO MIGRACIÓN del dominio (`crearAbonoMigrado`, A1): SIN
 *   efectos derivados, `conFactura = null` (el viejo no tenía el flag), `estadoRevision = revisado`
 *   (histórico ya conciliado — los abonos/descuentos no traían bandera de revisión).
 *
 * Mapeo de campos (la cabecera aporta maquilero + fecha + obs, ver `esma-cargos.ts`):
 *  • idMaquilero: `EsMa.IdMaquileros` → Proveedor (siempre catálogo `Maquileros`, ver el FIX de
 *    estampado en `esma-cargos.ts`). Sin mapeo → OMITIDO + listado.
 *  • monto: `AbonoEsMa` (nulo → 0). Puede ser NEGATIVO ("saldo anterior"): se preserva tal cual.
 *  • fecha: `EsMa.FechaEsMa` (obligatoria; vacía → OMITIDO + listado).
 *  • observaciones: combina `ObsAbonos` + `EsMa.ObsEsMa`.
 *
 * Idempotencia: por el `MapeoMigracion` de `IdEsMa_Abonos`.
 */
import { crearAbonoMigrado } from '../../src/dominio/esma/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';

import { ENTIDAD_MAPEO, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { cargarMovimientosPlanosEsMa, type ResultadoEsMa } from './esma-cargos.js';

/** Carga los ABONOS históricos (`EsMa_Abonos.csv` → `AbonoMaquilero`). */
export async function cargarAbonosEsMa(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoEsMa> {
  return cargarMovimientosPlanosEsMa(sesion, cliente, reporte, {
    etiqueta: 'AbonoMaquilero',
    archivo: 'EsMa_Abonos.csv',
    columnaId: 'IdEsMa_Abonos',
    columnaMonto: 'AbonoEsMa',
    columnaObs: 'ObsAbonos',
    columnaRevision: null, // el viejo no traía bandera de revisión → revisado (ya conciliado)
    entidadMapeo: ENTIDAD_MAPEO.abonoMaquilero,
    crear: crearAbonoMigrado,
  });
}
