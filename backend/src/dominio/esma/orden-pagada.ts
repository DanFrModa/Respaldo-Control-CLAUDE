/**
 * "Orden PAGADA" — estado DERIVADO (D3) + override manual auditado (F6-E4, decisión (f); doc 07-EsMa).
 * Una orden queda `pagada` cuando TODOS sus cargos PAGABLES (validados, no sin-costo) están pagados
 * (cantidadPagada ≥ cantidadReal). NO es una bandera editable a mano salvo el override `pagadaForzada`:
 *  • `pagadaForzada = true/false` FUERZA el estatus (la derivación deja de pisarlo);
 *  • `pagadaForzada = null` vuelve a la derivación automática.
 *
 * Innegociables: A1 (lógica aquí), A2 (override/recalculo en transacción), A4 (`esma.modificar` para
 * forzar; `esma.ver-pagos` para consultar), A7 (bitácora del override y de los cambios derivados),
 * A9 (empresa activa), D3 (el estatus se deriva de los cargos, no se captura suelto).
 */
import { type OrdenPagadaSalida, esquemaOrdenPagadaForzarCuerpo } from '../../contrato/index.js';
import type { z } from 'zod';

import { datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { WHERE_CUENTA_CARGO } from './formula-saldo.js';

/** Resultado de la derivación: cuántos cargos pagables tiene la orden y cuántos ya están pagados. */
interface DerivacionPagada {
  derivada: boolean;
  cargosPagables: number;
  cargosPagados: number;
}

/**
 * Calcula la derivación de "pagada" de una orden a partir de sus cargos VIVOS (no cancelados): los
 * PAGABLES son exactamente los que le CUENTAN al saldo del maquilero (validados y con costo); de
 * esos, "pagado" = `cantidadPagada ≥ cantidadReal`. `derivada` = hay ≥1 pagable Y todos pagados. Lee
 * directo de los cargos (sin acumuladores, D3).
 *
 * ⭐ El criterio NO se escribe aquí: es {@link WHERE_CUENTA_CARGO}, el MISMO de la fórmula del saldo
 * (`formula-saldo.ts`). "Lo que se le debe al maquilero" y "lo que hay que pagarle para dar la orden
 * por pagada" tienen que ser el mismo conjunto de cargos: si mañana el criterio cambia —otra causa
 * de exclusión, otro estado— y esta copia se quedara atrás, una orden se declararía pagada con
 * cargos que el saldo sigue cobrando (o al revés). La guardia de `formula-saldo.test.ts` lo vigila:
 * este archivo está en su lista de CONSUMIDORES_DEL_SALDO.
 */
async function calcularDerivada(tx: Tx, idOrden: number): Promise<DerivacionPagada> {
  const cargos = await tx.esMaCargo.findMany({
    where: { idOrden, ...WHERE_CUENTA_CARGO },
    select: { cantidadReal: true, cantidadPagada: true },
  });
  let pagados = 0;
  for (const c of cargos) {
    const real = c.cantidadReal?.toNumber() ?? 0;
    const pagada = c.cantidadPagada.toNumber();
    if (pagada >= real) {
      pagados += 1;
    }
  }
  const cargosPagables = cargos.length;
  return {
    derivada: cargosPagables > 0 && pagados === cargosPagables,
    cargosPagables,
    cargosPagados: pagados,
  };
}

/**
 * Recalcula y persiste el estatus DERIVADO `Orden.pagada` (cache para otros consumidores). Respeta el
 * override: si `pagadaForzada` NO es null, no toca `pagada` (queda forzada). Registra bitácora solo si
 * el valor derivado cambió. Se llama DENTRO de la transacción que aplicó un pago (por cada orden
 * afectada). No verifica permiso: es un efecto derivado del pago (ya autorizado).
 */
export async function recalcularOrdenPagada(
  tx: Tx,
  sesion: SesionUsuario,
  idOrden: number,
): Promise<void> {
  const orden = await tx.orden.findUnique({
    where: { id: idOrden },
    select: { pagada: true, pagadaForzada: true },
  });
  if (orden === null || orden.pagadaForzada !== null) {
    return; // orden inexistente o con override manual: la derivación no pisa.
  }
  const { derivada } = await calcularDerivada(tx, idOrden);
  if (orden.pagada === derivada) {
    return; // sin cambios.
  }
  await tx.orden.update({
    where: { id: idOrden },
    data: { pagada: derivada, ...datosModificacion(sesion) },
  });
  await registrarBitacora(tx, sesion, {
    entidad: 'Orden',
    idEntidad: idOrden,
    accion: 'MODIFICAR',
    datos: { campo: 'pagada', valor: derivada, origen: 'derivacion-esma' },
  });
}

/** Proyecta el estatus "pagada" de una orden (efectivo + derivado + override). */
async function proyectarEstatus(
  tx: Tx,
  idOrden: number,
  folioOrden: bigint,
  pagadaForzada: boolean | null,
): Promise<OrdenPagadaSalida> {
  const { derivada, cargosPagables, cargosPagados } = await calcularDerivada(tx, idOrden);
  return {
    idOrden,
    folioOrden: Number(folioOrden),
    pagada: pagadaForzada ?? derivada,
    pagadaForzada,
    pagadaDerivada: derivada,
    cargosPagables,
    cargosPagados,
  };
}

/** Consulta el estatus "pagada" de una orden de la empresa activa (A9). Permiso `esma.ver-pagos`. */
export async function obtenerOrdenPagada(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<OrdenPagadaSalida> {
  verificarPermiso(sesion, 'esma.ver-pagos');
  const cliente = clienteLectura(bd);
  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: { id: true, folio: true, pagadaForzada: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  return proyectarEstatus(cliente, orden.id, orden.folio, orden.pagadaForzada);
}

/**
 * Aplica el OVERRIDE manual de "pagada" (decisión (f)): `pagadaForzada` true/false fuerza el estatus;
 * `null` vuelve a la derivación. En una transacción (A2) + bitácora (A7). Permiso `esma.modificar`.
 */
export async function forzarOrdenPagada(
  sesion: SesionUsuario,
  idOrden: number,
  cuerpo: z.input<typeof esquemaOrdenPagadaForzarCuerpo>,
  bd?: ContextoBd,
): Promise<OrdenPagadaSalida> {
  verificarPermiso(sesion, 'esma.modificar');
  const datos = validarEntrada(esquemaOrdenPagadaForzarCuerpo, cuerpo);

  await enTransaccion(async (tx) => {
    const orden = await tx.orden.findFirst({
      where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
      select: { id: true },
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', idOrden);
    }

    if (datos.pagadaForzada === null) {
      // Vuelve a la derivación automática: limpia el override y sella el valor derivado.
      const { derivada } = await calcularDerivada(tx, idOrden);
      await tx.orden.update({
        where: { id: idOrden },
        data: { pagadaForzada: null, pagada: derivada, ...datosModificacion(sesion) },
      });
    } else {
      await tx.orden.update({
        where: { id: idOrden },
        data: {
          pagadaForzada: datos.pagadaForzada,
          pagada: datos.pagadaForzada,
          ...datosModificacion(sesion),
        },
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'MODIFICAR',
      datos: { campo: 'pagadaForzada', valor: datos.pagadaForzada, origen: 'override-manual' },
    });
  }, bd);

  return obtenerOrdenPagada(sesion, idOrden, bd);
}
