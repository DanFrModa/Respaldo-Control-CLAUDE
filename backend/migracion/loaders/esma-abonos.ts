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
import { resolverVentana, type ConfigVentana } from '../comun/ventana.js';
import { cargarMovimientosPlanosEsMa, type SaldoInicialEsMa } from './esma-cargos.js';
import type { ResultadoLoader } from './clientes.js';

/**
 * Carga los ABONOS históricos (`EsMa_Abonos.csv` → `AbonoMaquilero`). Con la ventana temporal
 * ACTIVA, los abonos PRE-CORTE se excluyen y su monto (+, signo del saldo derivado D3) alimenta el
 * saldo inicial (`saldoInicial`, lo pasa `etl-esma`); con la ventana inactiva nada cambia.
 */
export async function cargarAbonosEsMa(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  ventana: ConfigVentana = resolverVentana(),
  saldoInicial?: SaldoInicialEsMa,
): Promise<ResultadoLoader> {
  return cargarMovimientosPlanosEsMa(
    sesion,
    cliente,
    reporte,
    {
      etiqueta: 'AbonoMaquilero',
      archivo: 'EsMa_Abonos.csv',
      columnaId: 'IdEsMa_Abonos',
      columnaMonto: 'AbonoEsMa',
      columnaObs: 'ObsAbonos',
      columnaRevision: null, // el viejo no traía bandera de revisión → revisado (ya conciliado)
      entidadMapeo: ENTIDAD_MAPEO.abonoMaquilero,
      signoSaldo: 1, // el abono SUMA al saldo derivado (D3)
      crear: crearAbonoMigrado,
    },
    ventana,
    saldoInicial,
  );
}
