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
 *     entrega), ninguna cancelación de etapa, ningún cierre con maquilero, ninguna edición del
 *     costo — y desde 0.226a (§Post-F9.244) tampoco salidas de tela, movimientos de PT, notas de
 *     salida, compras, recepciones, entradas de tela ni auditorías. La guarda es UNA SOLA
 *     ({@link exigirOrdenesAbiertas}, con su candado compartido) aplicada en cada punto de
 *     escritura, y el guardián `orden-cerrada-guardian.test.ts` obliga a declarar cada función que
 *     escribe con una orden. Consultar e imprimir siguen libres; Finanzas (EsMa, EDR, CxP), el MRP y
 *     la RC quedan FUERA a propósito (decisiones 2 y 3 de Daniel).
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
import type { OrdenPreviaCierre, OrdenSalida } from '../../contrato/index.js';
import { esquemaOrdenCerrarCuerpo, esquemaOrdenReabrirCuerpo } from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, enTransaccion, type ContextoBd } from '../../comun/transaccion.js';
import type { Tx } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { cantidadDeBase, cantidadesDeOrden } from '../costos/cantidades.js';
import { redondear4 } from '../costos/decimales.js';

import { obtenerOrden } from './ordenes.js';
import { recalcularEstadoOrden } from './requisitos-orden.js';

/**
 * ⭐⭐ 0.226a (§Post-F9.244) — NAMESPACE del candado consultivo que ordena el CIERRE contra la CAPTURA.
 *
 * Forma de DOS claves `pg_advisory_xact_lock[_shared](int4 NAMESPACE, int4 idOrden)`. `0x4f524443`
 * son los bytes de `'ORDC'` (ORDen Cerrada). Se eligió midiendo el repo: NO es ninguno de los
 * namespaces fijos (`20_5xx`, `20_641`, `0x52440001/2`, `0x54430001`, `0x54454c41`, `0x524f4c45535f41`)
 * ni ninguna de las BASES que se mezclan con la empresa (`0x4f000000`, `0x50000000`, `0x51000000`).
 * ⚠️ **Sobre las colisiones, dicho exacto.** Si otra llave de DOS claves del repo valiera lo mismo
 * (`NAMESPACE`, `idOrden`), una puerta que sostiene el COMPARTIDO de esta orden y otra transacción que
 * pidiera el EXCLUSIVO de esa llave ajena sí podrían esperarse mutuamente — no es sólo «serializar de
 * más». Medido contra las fórmulas que existen: las de etapas/RC/precios/EsMa son
 * `(idEmpresa × 1 000 003) XOR base` con base `0x4f000000`/`0x50000000`/`0x51000000`, y para dar
 * `0x4f524443` la empresa tendría que ser 5.39 / 525.48 / 508.71 — ningún entero ⇒ **imposible**.
 * Las del kardex salen de un hash de seis dimensiones: coincidir exige que el hash caiga justo en
 * este valor de 32 bits Y que su segunda clave sea un `idOrden` vivo — probabilidad del orden de
 * 1 en 4 mil millones por llave. Despreciable, pero no cero; por eso queda escrito.
 *
 * 🔑 EL REPARTO, y por qué así:
 *  • `cerrarOrden` / `reabrirOrden` toman el candado **EXCLUSIVO** como PRIMERA instrucción.
 *  • Cada puerta de captura toma el **COMPARTIDO** (vía {@link exigirOrdenesAbiertas}) como PRIMERA
 *    instrucción de su transacción, y sólo DESPUÉS lee `cerradaEn`.
 * ⇒ dos capturas de la misma orden NO se estorban entre sí (compartido + compartido), pero el cierre
 * espera a que terminen las capturas en vuelo, y una captura que llega durante el cierre espera a que
 * el cierre confirme — y entonces LEE `cerradaEn` ya puesta y se rechaza. Sin esto, una captura que
 * leyó «abierta» un instante antes del cierre escribía DESPUÉS del congelado y el costo congelado no
 * la incluía (la carrera que el congelado de 0.061 vino a matar, por la puerta de al lado).
 *
 * ⚠️ Advisory y NO un candado de FILA sobre la orden. `FOR KEY SHARE` no serviría: no choca con el
 * `UPDATE` de `cerrarOrden` (no toca la llave), así que no lo haría esperar. `FOR SHARE` sí lo haría
 * esperar, pero varias puertas reescriben esa misma fila después (`recalcularEstadoOrden`,
 * `rcActiva`, `pagada`): dos capturas de la misma orden con `FOR SHARE` que luego la actualizan se
 * interbloquearían entre sí. El candado consultivo no tiene ninguno de los dos problemas.
 */
export const NAMESPACE_LOCK_CIERRE_ORDEN = 0x4f524443 | 0;

/** Une folios en español: «12», «12 y 15», «12, 15 y 20». */
function listaDeFolios(folios: readonly string[]): string {
  if (folios.length <= 1) return folios.join('');
  return `${folios.slice(0, -1).join(', ')} y ${folios.at(-1) ?? ''}`;
}

/**
 * ⭐ EL MENSAJE ÚNICO Y CENTRAL de la orden cerrada. Nombra TODAS las órdenes cerradas que tocaba
 * la operación (una nota o una OC pueden llevar varias) y la salida —reabrir— porque el usuario no
 * puede adivinarla: cerrar es reversible, pero sólo por el acto inverso y con permiso.
 */
export function mensajeOrdenCerrada(
  folios: readonly (bigint | number | string)[],
  queSeIntenta: string,
): string {
  const lista = [...new Set(folios.map(String))];
  if (lista.length <= 1) {
    return (
      `La orden ${lista[0] ?? ''} está CERRADA (su costo quedó congelado): no se ${queSeIntenta}. ` +
      'Si de verdad hay que moverla, reábrela primero (permiso "ordenes.cerrar") — queda auditado.'
    );
  }
  return (
    `Las órdenes ${listaDeFolios(lista)} están CERRADAS (su costo quedó congelado): no se ` +
    `${queSeIntenta}. Si de verdad hay que moverlas, reábrelas primero (permiso "ordenes.cerrar") ` +
    '— queda auditado.'
  );
}

/**
 * ⭐ El error de la orden cerrada. Es un {@link ErrorConflicto} (409, código `CONFLICTO`: el contrato
 * de errores no cambia y todo `instanceof ErrorConflicto` que ya existía lo sigue atrapando), con
 * nombre propio para que las pruebas y la pantalla lo distingan de cualquier otro conflicto.
 */
export class ErrorOrdenCerrada extends ErrorConflicto {
  /** Los folios de las órdenes cerradas que bloquearon la operación (como texto: son BigInt). */
  readonly folios: string[];

  constructor(folios: readonly (bigint | number | string)[], queSeIntenta: string) {
    super(mensajeOrdenCerrada(folios, queSeIntenta));
    this.folios = [...new Set(folios.map(String))];
  }
}

/**
 * ⭐⭐ LA GUARDA ÚNICA, EN LOTE Y CON CANDADO (0.226a, §Post-F9.244). Es lo PRIMERO que hace cada
 * puerta de captura dentro de su transacción, antes de cualquier escritura o candado de inventario:
 *
 *  1. toma `pg_advisory_xact_lock_shared(NAMESPACE, idOrden)` por cada orden, en orden ASCENDENTE
 *     (el MISMO orden en todas las puertas);
 *  2. DESPUÉS lee `folio` + `cerradaEn` de esas órdenes (dentro de la empresa activa, A9: una orden
 *     de otra empresa no existe para esta sesión, y su folio no se dice);
 *  3. si alguna está cerrada, lanza UN {@link ErrorOrdenCerrada} que nombra TODAS.
 *
 * 🔑 Mira `cerradaEn`, NO el `estado`. El estado es un espejo (lo pinta el badge y lo filtran las
 * consultas) y lo recalculan varios caminos; la columna es la verdad del acto. Si alguna vez los dos
 * se desalinearan, la guarda falla del lado SEGURO. NO habla de `cancelada`: ésa la rechaza cada
 * puerta con su propio mensaje (una cancelada nunca se produjo; una cerrada terminó su vida normal).
 *
 * ⚠️ 0.226a: la guarda «pura» de 0.061 (`exigirOrdenAbierta`, sin candado) **se borró**: ya nadie la
 * usaba y dejarla exportada era una trampa a un import de distancia. Ésta es la ÚNICA forma.
 *
 * Las órdenes que no existen (o son de otra empresa) se ignoran: el NO ENCONTRADO lo da la puerta,
 * con su propio mensaje. `null`/`undefined` en la lista también se ignoran (renglones sin orden).
 */
export async function exigirOrdenesAbiertas(
  tx: Tx,
  idEmpresa: number,
  idsOrden: readonly (number | null | undefined)[],
  queSeIntenta: string,
): Promise<void> {
  const ids = [...new Set(idsOrden.filter((id): id is number => Number.isInteger(id)))].toSorted(
    (a, b) => a - b,
  );
  if (ids.length === 0) return;
  for (const id of ids) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${NAMESPACE_LOCK_CIERRE_ORDEN}::int, ${id}::int)`;
  }
  const cerradas = await tx.orden.findMany({
    where: { id: { in: ids }, idEmpresa, cerradaEn: { not: null } },
    select: { folio: true },
    orderBy: { folio: 'asc' },
  });
  if (cerradas.length === 0) return;
  throw new ErrorOrdenCerrada(
    cerradas.map((o) => o.folio),
    queSeIntenta,
  );
}

/** {@link exigirOrdenesAbiertas} para UNA orden (la forma más común de las puertas). */
export async function exigirOrdenAbiertaPorId(
  tx: Tx,
  idEmpresa: number,
  idOrden: number | null | undefined,
  queSeIntenta: string,
): Promise<void> {
  await exigirOrdenesAbiertas(tx, idEmpresa, [idOrden], queSeIntenta);
}

/**
 * El candado EXCLUSIVO del cierre/reapertura. Espera a que terminen las capturas en vuelo de esa
 * orden (que sostienen el compartido) y hace esperar a las que lleguen mientras tanto.
 */
async function bloquearOrdenParaCierre(tx: Tx, idOrden: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_CIERRE_ORDEN}::int, ${idOrden}::int)`;
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
    // ⭐ 0.226a: el candado EXCLUSIVO es la PRIMERA instrucción. Espera a las capturas en vuelo
    // (que sostienen el compartido) para que el congelado de abajo las INCLUYA.
    await bloquearOrdenParaCierre(tx, id);
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
    // ⭐ 0.226a: mismo candado EXCLUSIVO que el cierre, como PRIMERA instrucción.
    await bloquearOrdenParaCierre(tx, id);
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

/**
 * ⭐ 0.226b (C8 de §Post-F9.261) — LA PREVIA DEL CIERRE: el producto terminado que todavía queda
 * etiquetado con la orden. Cerrada, esas piezas ya no se mueven a mano, no se traspasan ni se
 * reclasifican (sólo el conteo cíclico o reabrir pueden), así que el diálogo de cerrar AVISA antes
 * —no bloquea: cerrar con piezas puede ser legítimo y cuánto pasa es dato de Daniel—.
 *
 * Lectura pura, sin candado (es un aviso: quien manda es el cierre). La existencia es la SUMA
 * DIRECTA de `movimiento_det_pt` (D3, ADR-0010 §3), nunca la vista, agrupada por artículo×almacén y
 * contando sólo los saldos POSITIVOS: un bucket en negativo (anomalía) no puede «esconder» las
 * piezas que sí hay en otro. Permiso `ordenes.cerrar`: es información para quien va a cerrar.
 */
export async function previaCierreOrden(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<OrdenPreviaCierre> {
  verificarPermiso(sesion, 'ordenes.cerrar');
  const idEmpresa = sesion.idEmpresaActiva;
  const cliente = clienteLectura(bd);
  // A9: una orden de otra empresa, para esta sesión, no existe.
  const orden = await cliente.orden.findFirst({
    where: { id, idEmpresa },
    select: { id: true, folio: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', id);
  }
  const filas = await cliente.$queryRaw<
    { idAlmacen: number; almacen: string; piezas: bigint }[]
  >(Prisma.sql`
    SELECT s."id_almacen" AS "idAlmacen", a."nombre" AS "almacen", SUM(s."saldo")::bigint AS "piezas"
    FROM (
      SELECT m."id_almacen", d."id_modelo", d."id_color", d."id_talla",
             SUM(d."cantidad" * CASE t."direccion"
               WHEN 'entrada' THEN 1
               WHEN 'salida'  THEN -1
               ELSE 0
             END) AS "saldo"
      FROM "movimiento_det_pt" d
      JOIN "movimientos" m ON m."id" = d."id_movimiento"
      JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
      WHERE m."id_empresa" = ${idEmpresa}
        AND d."id_orden" = ${id}
      GROUP BY m."id_almacen", d."id_modelo", d."id_color", d."id_talla"
    ) s
    JOIN "almacenes" a ON a."id" = s."id_almacen"
    WHERE s."saldo" > 0
    GROUP BY s."id_almacen", a."nombre"
    ORDER BY a."nombre" ASC, s."id_almacen" ASC
  `);
  const porAlmacen = filas.map((f) => ({
    idAlmacen: f.idAlmacen,
    almacen: f.almacen,
    piezas: Number(f.piezas),
  }));
  return {
    idOrden: orden.id,
    folio: Number(orden.folio),
    piezasPt: porAlmacen.reduce((s, f) => s + f.piezas, 0),
    porAlmacen,
  };
}
