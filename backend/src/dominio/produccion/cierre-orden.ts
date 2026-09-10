/**
 * ⭐⭐ CERRAR LA ORDEN Y CONGELAR SU COSTO (0.061 — §Post-F9.154(c), DANIEL 30-ago-2026).
 *
 * LA PREGUNTA QUE LO ORIGINÓ, textual de Daniel: *«¿en qué momento se define que ya se cerró el
 * costo? ¿O va cambiando?»*
 *
 * LA RESPUESTA MEDIDA ERA: **iba cambiando**. El DINERO sí se persistía (`CostoOrden.costoTotal`),
 * pero la CANTIDAD del divisor se re-sumaba de las etapas vivas EN CADA LECTURA. Con el divisor en
 * `cortado` casi no se notaba —el corte pasa una vez y ya—, pero al pasarlo a `recibido`
 * (§Post-F9.154(b), la otra mitad de esta fila) el costo unitario habría quedado **vivo hasta el
 * último recibo, para siempre**. Adoptar el divisor nuevo sin esto dejaba el costo bailando.
 *
 * ⭐ **ES UN ACTO EXPLÍCITO, NUNCA AUTOMÁTICO.** Un cierre por *«ya se entregó el 100 %»* NO
 * funciona, y lo desmiente la propia decisión (a) de esta misma fila: como los FALTANTES se le
 * cobran al maquilero y las INCOMPLETAS salen como merma, esas piezas **no vuelven nunca** ⇒ una
 * orden que perdió piezas jamás llega al 100 % entregado y su costo no se congelaría jamás. Por eso
 * lo cierra una persona, con permiso propio (`ordenes.cerrar`) y con su bitácora.
 *
 * QUÉ HACE CERRAR:
 *  1. Marca la orden: `cerradaEn` + `cerradaPorId` + `motivoCierre` (opcional), y `estado =
 *     cerrada`. La VERDAD autoritativa es `cerradaEn`; el estado es su espejo visible (badge y
 *     filtros). Ver el TSDoc del enum `EstadoOrden` en `schema.prisma`.
 *  2. **CONGELA el costo**: persiste el DIVISOR (`cantidadBaseCongelada`) y el UNITARIO
 *     (`costoUnitarioCongelado`) que valían en ese instante, más `congeladoEn`. A partir de ahí
 *     toda lectura del costo de esa orden devuelve lo congelado; las órdenes abiertas siguen
 *     calculando en vivo. Ver {@link congelarCostoDeOrden}.
 *  3. **Cierra la puerta a la captura**: ninguna etapa nueva (corte, empaque, envío, recibo,
 *     entrega), ninguna cancelación de etapa, ningún cierre con maquilero y ninguna edición del
 *     costo. La guarda es UNA SOLA ({@link exigirOrdenAbierta}) aplicada en cada punto de
 *     escritura; consultar e imprimir siguen libres.
 *
 * QUÉ **NO** HACE CERRAR, y es a propósito:
 *  • NO recalcula el costo (no re-costea nada: congela lo que ya había).
 *  • NO toca el kardex, ni el WIP, ni EsMa, ni la RC. Cerrar no mueve una sola pieza ni un peso.
 *  • NO exige que la orden esté `completa` ni entregada. Se cierra la que ya no va a moverse,
 *    tenga los requisitos de captura o no.
 *  • NO inventa un costo. Y hay que hilar fino con el CERO, porque de eso depende una regla:
 *    - sin fila de `CostoOrden` no se escribe nada (no hay qué congelar);
 *    - con fila pero **base 0**, se congela `cantidadBaseCongelada = 0` —CERO, no NULL— y sólo el
 *      `costoUnitarioCongelado` queda NULL. Ese 0 es un dato: dice «esta orden se cerró SIN piezas»,
 *      y por eso las lecturas lo respetan como divisor 0 (su condición mira `IS NOT NULL`, nunca
 *      `> 0`) en vez de recaer en el cálculo vivo cuando lleguen recibos tardíos.
 *    En ambos casos la lectura sigue diciendo por qué no hay unitario (`unitarioODeuda`).
 *
 * REVERSIBLE SÓLO POR REAPERTURA AUDITADA (D3): {@link reabrirOrden}, con el MISMO permiso, su
 * motivo y su bitácora. Al reabrir, el costo vuelve a calcularse en vivo, el estado derivado se
 * recalcula desde los requisitos y **lo congelado NO se borra: se MARCA** (`descongeladoEn`), para
 * que quede constancia de con qué números se había cerrado. Nada se edita ni se borra: el historial
 * completo de cierres y reaperturas vive en la Bitácora (A7).
 *
 * 🔑 NO SE CONFUNDE CON `CierreMaquilaOrden` (fila 0.109), que cierra la orden **con UN maquilero de
 * UN proceso** y salda su pendiente. Aquél es por tercero (una orden tiene varios vivos a la vez);
 * éste es de la ORDEN ENTERA. Se puede cerrar la orden sin haber cerrado con ningún maquilero, y al
 * revés — aunque lo natural es saldar a los maquileros primero, porque la orden cerrada ya no lo
 * deja hacer.
 *
 * Innegociables aplicados: A1 (toda la regla aquí; las rutas sólo validan y delegan) · A2 (marca +
 * congelado + bitácora en UNA transacción) · A4 (`ordenes.cerrar`, permiso propio) · A7 (bitácora
 * con el motivo y los números congelados) · A9 (empresa activa) · D3 (nada se edita ni se borra;
 * reabrir es el acto inverso auditado).
 */
import type { OrdenSalida } from '../../contrato/index.js';
import { esquemaOrdenCerrarCuerpo, esquemaOrdenReabrirCuerpo } from '../../contrato/index.js';
import { Prisma, type EstadoOrden } from '../../datos/index.js';
import type { z } from 'zod';

import { datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd } from '../../comun/transaccion.js';
import type { Tx } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { cantidadDeBase, cantidadesDeOrden } from '../costos/cantidades.js';
import { redondear4 } from '../costos/decimales.js';

import { obtenerOrden } from './ordenes.js';
import { recalcularEstadoOrden } from './requisitos-orden.js';

/** Lo mínimo que hay que saber de una orden para decidir si admite escritura. */
export interface OrdenCerrable {
  folio: bigint;
  estado: EstadoOrden;
  cerradaEn: Date | null;
}

/**
 * ⭐ LA GUARDA ÚNICA: rechaza escribir sobre una orden CERRADA (0.061). Todas las puertas de
 * captura de la orden la llaman con la misma orden que ya leyeron —no hace una consulta propia— y
 * dicen en `queSeIntenta` qué se estaba haciendo, para que el mensaje sirva.
 *
 * 🔑 Mira `cerradaEn`, NO el `estado`. El estado es un espejo (lo pinta el badge y lo filtran las
 * consultas) y lo recalculan varios caminos; la columna es la verdad del acto. Si alguna vez los
 * dos se desalinearan, esta guarda falla del lado SEGURO: sigue protegiendo la orden cerrada.
 *
 * NO habla de `cancelada`: ésa la rechaza cada puerta con su propio mensaje desde F2/F3, y son cosas
 * distintas (una cancelada nunca se produjo; una cerrada terminó su vida normal).
 *
 * El mensaje nombra la salida —reabrir— porque el usuario no puede adivinarla: cerrar es reversible,
 * pero sólo por el acto inverso y con permiso.
 */
export function exigirOrdenAbierta(orden: OrdenCerrable, queSeIntenta: string): void {
  if (orden.cerradaEn === null) return;
  throw new ErrorConflicto(
    `La orden ${String(orden.folio)} está CERRADA (su costo quedó congelado): no se ${queSeIntenta}. ` +
      'Si de verdad hay que moverla, reábrela primero (permiso "ordenes.cerrar") — queda auditado.',
  );
}

/** Igual que {@link exigirOrdenAbierta}, pero leyendo la orden por id (para puertas que no la traen). */
export async function exigirOrdenAbiertaPorId(
  tx: Tx,
  idOrden: number,
  queSeIntenta: string,
): Promise<void> {
  const orden = await tx.orden.findUnique({
    where: { id: idOrden },
    select: { folio: true, estado: true, cerradaEn: true },
  });
  if (orden === null) return; // que el NO ENCONTRADO lo dé la puerta, con su propio mensaje
  exigirOrdenAbierta(orden, queSeIntenta);
}

/** Lo que quedó congelado (o los NULL que dicen que no había qué congelar). */
interface CostoCongelado {
  cantidadBaseCongelada: number | null;
  costoUnitarioCongelado: number | null;
}

/**
 * CONGELA el costo de la orden dentro de la transacción del cierre (A2). Persiste el DIVISOR y el
 * UNITARIO tal como valen ahora, más el instante.
 *
 * Usa EXACTAMENTE la misma aritmética que la lectura en vivo —la base GUARDADA del costo y
 * `cantidadDeBase` sobre las cantidades derivadas— porque congelar tiene que dar el MISMO número
 * que se venía mostrando. Una copia reducida aquí haría que el costo cambiara justo al cerrarlo,
 * que es lo contrario de lo que se pide. (No hace falta el default de la base: si no hay fila de
 * costo se sale antes, y si la hay, su `baseProrrateo` siempre trae valor.)
 *
 * Si la orden NO tiene fila de costo, no hay nada que congelar y no se crea ninguna: un cierre no
 * costea. Si la base es 0 o no hay `costoTotal`, se congela lo que se sabe (el divisor) y el
 * unitario queda NULL — la lectura seguirá explicando por qué falta (`unitarioODeuda`), pero ya no
 * cambiará de opinión con el siguiente movimiento.
 */
async function congelarCostoDeOrden(tx: Tx, idOrden: number, ahora: Date): Promise<CostoCongelado> {
  const costo = await tx.costoOrden.findUnique({
    where: { idOrden },
    select: { costoTotal: true, baseProrrateo: true },
  });
  if (costo === null) return { cantidadBaseCongelada: null, costoUnitarioCongelado: null };

  const cant = await cantidadesDeOrden(idOrden, { tx });
  const base = costo.baseProrrateo;
  const cantidadBase = cantidadDeBase(cant, base);
  const total = costo.costoTotal === null ? null : costo.costoTotal.toNumber();
  const unitario = total === null || cantidadBase <= 0 ? null : redondear4(total / cantidadBase);

  await tx.costoOrden.update({
    where: { idOrden },
    data: {
      cantidadBaseCongelada: cantidadBase,
      costoUnitarioCongelado: unitario === null ? null : new Prisma.Decimal(unitario),
      congeladoEn: ahora,
      // Un cierre nuevo limpia la marca de la reapertura anterior: lo que vale es el congelado de
      // AHORA. El rastro de la reapertura ya quedó en la bitácora (D3/A7).
      descongeladoEn: null,
    },
  });
  return { cantidadBaseCongelada: cantidadBase, costoUnitarioCongelado: unitario };
}

/**
 * ⭐ CIERRA una orden (A4 `ordenes.cerrar`, A2, A7, A9). Acto explícito e idempotente-por-rechazo:
 * cerrar una ya cerrada se RECHAZA (no se re-congela en silencio con números nuevos, que es
 * justamente lo que el congelado viene a impedir).
 *
 * RECHAZA una orden CANCELADA: no tiene vida administrativa que cerrar, y dejarla en `cerrada`
 * borraría el hecho de que se canceló. Son dos finales distintos y sólo cabe uno.
 */
export async function cerrarOrden(
  sesion: SesionUsuario,
  id: number,
  cuerpo: z.input<typeof esquemaOrdenCerrarCuerpo> = {},
  bd?: ContextoBd,
): Promise<OrdenSalida> {
  verificarPermiso(sesion, 'ordenes.cerrar');
  // 🔴 `ordenes.ver` SE EXIGE AQUÍ, ANTES de la transacción, aunque no lo use el acto: esta función
  // devuelve la orden y la lee con `obtenerOrden`, que lo pide. Sin esta línea, una sesión con
  // `ordenes.cerrar` y sin `ordenes.ver` CERRABA la orden —commit incluido— y recibía un 403
  // después: el usuario ve un error y cree que no pasó nada, cuando el costo ya quedó congelado.
  // Es el «403-tras-commit» de F8-E3, y el mismo criterio que `cancelarPedido` aplica con
  // `ordenes.cancelar`. Lo cazó la suite de integración corrida en local (ronda 2 de la revisión).
  verificarPermiso(sesion, 'ordenes.ver');
  const datos = validarEntrada(esquemaOrdenCerrarCuerpo, cuerpo);

  await enTransaccion(async (tx) => {
    const actual = await tx.orden.findFirst({
      where: { id, idEmpresa: sesion.idEmpresaActiva },
      select: { id: true, folio: true, estado: true, cerradaEn: true },
    });
    if (actual === null) {
      throw new ErrorNoEncontrado('Orden', id);
    }
    if (actual.estado === 'cancelada') {
      throw new ErrorConflicto(
        `La orden ${String(actual.folio)} está CANCELADA: no se cierra (no hay nada que cerrar, y ` +
          'dejarla como cerrada borraría el hecho de que se canceló).',
      );
    }
    if (actual.cerradaEn !== null) {
      throw new ErrorConflicto(
        `La orden ${String(actual.folio)} ya está cerrada (desde el ` +
          `${actual.cerradaEn.toISOString().slice(0, 10)}). Para volver a cerrarla con números ` +
          'nuevos hay que reabrirla primero.',
      );
    }

    const ahora = new Date();
    const congelado = await congelarCostoDeOrden(tx, id, ahora);

    await tx.orden.update({
      where: { id },
      data: {
        estado: 'cerrada',
        cerradaEn: ahora,
        cerradaPorId: sesion.id,
        motivoCierre: datos.motivo ?? null,
        // A7: cerrar ES una modificación de la orden (el detalle la re-sincroniza por `modificadoEn`).
        ...datosModificacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: {
        acto: 'cerrar-orden',
        folio: Number(actual.folio),
        estadoPrevio: actual.estado,
        motivo: datos.motivo ?? null,
        // A7: los números CONGELADOS son el corazón del acto. Sin ellos, la bitácora no permitiría
        // auditar con qué divisor se cerró el costo.
        ...congelado,
      },
    });
  }, bd);

  return obtenerOrden(sesion, id, bd);
}

/**
 * ⭐ REABRE una orden cerrada (A4 `ordenes.cerrar` — el mismo permiso: quien puede cerrar el costo
 * puede volver a abrirlo; A2, A7, A9). Es el ACTO INVERSO AUDITADO que exige D3, no una edición:
 *  • el costo vuelve a calcularse EN VIVO;
 *  • lo congelado **no se borra**, se MARCA con `descongeladoEn` (queda la constancia de con qué
 *    números se había cerrado);
 *  • el `estado` vuelve a DERIVARSE de los requisitos (`recalcularEstadoOrden`), así que la orden
 *    reaparece como `capturada` o `completa` según lo que de verdad tenga hoy. No se "restaura" el
 *    estado que tenía antes de cerrarse: se vuelve a computar, que es lo único que no puede mentir.
 *
 * El motivo es OBLIGATORIO aquí (a diferencia del cierre): reabrir una orden cerrada es la
 * excepción, y la excepción se justifica.
 */
export async function reabrirOrden(
  sesion: SesionUsuario,
  id: number,
  cuerpo: z.input<typeof esquemaOrdenReabrirCuerpo>,
  bd?: ContextoBd,
): Promise<OrdenSalida> {
  verificarPermiso(sesion, 'ordenes.cerrar');
  // Mismo motivo que en {@link cerrarOrden}: el 403 de la lectura tiene que salir ANTES del commit.
  verificarPermiso(sesion, 'ordenes.ver');
  const datos = validarEntrada(esquemaOrdenReabrirCuerpo, cuerpo);

  await enTransaccion(async (tx) => {
    const actual = await tx.orden.findFirst({
      where: { id, idEmpresa: sesion.idEmpresaActiva },
      select: {
        id: true,
        folio: true,
        estado: true,
        cerradaEn: true,
        idModelo: true,
        fechaCompletada: true,
      },
    });
    if (actual === null) {
      throw new ErrorNoEncontrado('Orden', id);
    }
    if (actual.cerradaEn === null) {
      throw new ErrorConflicto(`La orden ${String(actual.folio)} no está cerrada.`);
    }

    const ahora = new Date();
    await tx.orden.update({
      where: { id },
      data: {
        cerradaEn: null,
        cerradaPorId: null,
        motivoCierre: null,
        // Provisional: `recalcularEstadoOrden` lo deja en el que de verdad toca (`capturada` o
        // `completa`). Se pone aquí porque esa función NO mueve un estado que no sea derivable, y
        // `cerrada` no lo es.
        estado: 'capturada',
        ...datosModificacion(sesion),
      },
    });

    // El congelado se MARCA, no se borra (D3). `updateMany` porque la orden puede no tener costo.
    await tx.costoOrden.updateMany({
      where: { idOrden: id, congeladoEn: { not: null } },
      data: { descongeladoEn: ahora },
    });

    // El estado vuelve a DERIVARSE de lo que la orden tiene hoy (misma tx, A2).
    await recalcularEstadoOrden(
      tx,
      sesion,
      {
        id,
        idModelo: actual.idModelo,
        estado: 'capturada',
        fechaCompletada: actual.fechaCompletada,
      },
      { tocarAuditoria: true, permitirDesCompletar: false },
    );

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: {
        acto: 'reabrir-orden',
        folio: Number(actual.folio),
        cerradaEnPrevio: actual.cerradaEn.toISOString(),
        motivo: datos.motivo,
      },
    });
  }, bd);

  return obtenerOrden(sesion, id, bd);
}
