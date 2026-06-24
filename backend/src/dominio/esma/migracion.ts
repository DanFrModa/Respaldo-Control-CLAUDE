/**
 * MODO MIGRACIÓN de los CARGOS EsMa (F3-E6) — capa de dominio (A1).
 *
 * El servicio normal (`cargos.ts`) deriva el cargo de un RECIBO: nace `propuesto` (cantidad = piezas
 * del recibo, precio = precioPactado del recibo) y el admin lo `validado` fijando cantidad/precio
 * REALES. El histórico, en cambio, ya viene VALIDADO en el viejo (`EsMa_Recibos`: cada renglón trae
 * `CantRecEsMa` + `PrecioEsMa` reales, que el maquilero y la empresa ya conciliaron). Por eso el
 * cargo migrado nace con un estado y sus reales EXPLÍCITOS, SIN pasar por la cola de validación de v2.
 *
 * ⭐ Liga al recibo: en v2 el cargo nace de un recibo (`idEtapaRecibo`). En el histórico esa liga
 * formal NO existe (el viejo llevaba EsMa por su cuenta; el no-cuadre conocido —12,440 recibos vs
 * 7,401 cargos— lo confirma: NO hay 1:1). Por eso el cargo migrado lleva `idEtapaRecibo = NULL` (el
 * schema lo permite a propósito para el histórico). Se liga a ORDEN + MAQUILERO + PROCESO, que es lo
 * que el viejo sí tenía. La liga formal recibo↔cargo nace en v2 (F3-E4).
 *
 * Sigue siendo: A2 (transacción), A7 (bitácora, origen ETL), A9 (idEmpresa explícito — derivado de
 * la orden por el loader). NO toca kardex (D3 no aplica: el cargo es CxP de maquila). Idempotencia:
 * el loader resuelve "ya existe" por el `MapeoMigracion` de `IdEsMa_Recibos` ANTES de llamar.
 */
import type { EstadoCargoEsMa } from '../../datos/index.js';

import { registrarBitacora } from '../../comun/auditoria.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd } from '../../comun/transaccion.js';

/** Un cargo EsMa histórico a migrar (snapshot del viejo `EsMa` + `EsMa_Recibos`). */
export interface CargoEsMaMigrado {
  idEmpresa: number;
  idMaquilero: number;
  idOrden: number;
  idTipoProceso: number;
  /** Cantidad real conciliada en el viejo (`CantRecEsMa`). NULL si el viejo no la trae. */
  cantidadReal?: number | null;
  /** Precio real conciliado en el viejo (`PrecioEsMa`). NULL si nace sin precio. */
  precioReal?: number | null;
  /** Estado derivado del dato viejo (validado por defecto; revisión pendiente queda `propuesto`). */
  estado: EstadoCargoEsMa;
  observaciones?: string | null;
  /** Fecha original del cargo (`EsMa.FechaEsMa`); si `validado`, sella `validadoEn`. */
  fecha?: Date | null;
}

/** Resultado de migrar un cargo EsMa. */
export interface ResultadoCargoEsMaMigrado {
  idCargo: number;
}

/**
 * Crea un cargo EsMa HISTÓRICO (ligado a orden + maquilero + proceso, SIN `idEtapaRecibo`), en UNA
 * transacción (A2/A7). Estado + reales EXPLÍCITOS del viejo (no pasa por la cola de validación). Si
 * el estado es `validado`, sella `validadoEn` con la fecha original (`validadoPorId` = usuario ETL).
 */
export async function crearCargoEsMaMigrado(
  sesion: SesionUsuario,
  entrada: CargoEsMaMigrado,
  bd?: ContextoBd,
): Promise<ResultadoCargoEsMaMigrado> {
  return enTransaccion(async (tx) => {
    const validado = entrada.estado === 'validado';
    const cargo = await tx.esMaCargo.create({
      data: {
        idEmpresa: entrada.idEmpresa,
        // idEtapaRecibo NULL: la liga formal recibo↔cargo nace en v2 (histórico sin amarre 1:1).
        idMaquilero: entrada.idMaquilero,
        idOrden: entrada.idOrden,
        idTipoProceso: entrada.idTipoProceso,
        ...(entrada.cantidadReal == null ? {} : { cantidadReal: entrada.cantidadReal }),
        ...(entrada.precioReal == null ? {} : { precioReal: entrada.precioReal }),
        estado: entrada.estado,
        observaciones: entrada.observaciones ?? null,
        ...(validado && entrada.fecha != null ? { validadoEn: entrada.fecha } : {}),
        ...(validado ? { validadoPorId: sesion.id } : {}),
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'EsMaCargo',
      idEntidad: cargo.id,
      accion: 'CREAR',
      datos: {
        operacion: 'migracion',
        idEmpresa: entrada.idEmpresa,
        idOrden: entrada.idOrden,
        idMaquilero: entrada.idMaquilero,
        idTipoProceso: entrada.idTipoProceso,
        estado: entrada.estado,
      },
    });

    return { idCargo: cargo.id };
  }, bd);
}
