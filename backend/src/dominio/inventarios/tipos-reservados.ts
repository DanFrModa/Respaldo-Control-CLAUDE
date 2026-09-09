/**
 * ⛔⛔ QUÉ RÓTULO PUEDE ESCRIBIR UNA PERSONA A MANO EN EL KARDEX (fila 0.171).
 *
 * ## Por qué esto importa más de lo que parece
 *
 * El kardex **es** el inventario (D3: la existencia es la Σ de movimientos, nunca un saldo
 * guardado). No es un reflejo de lo que pasó: es el registro de lo que pasó. Y en la pantalla del
 * kardex, de cada movimiento sólo se lee el **nombre de su tipo**. O sea que el tipo de movimiento
 * no es una etiqueta decorativa — es **la afirmación** de qué ocurrió y de quién lo hizo. Ofrecer
 * en un desplegable un rótulo que el sistema se reserva para sí es ofrecer una manera de escribir
 * un hecho falso en el registro que decide cuánto hay.
 *
 * ## 🔑 SON DOS RESERVAS DISTINTAS, Y CONFUNDIRLAS SERÍA REPETIR EL DEFECTO CON OTRO NOMBRE
 *
 * El catálogo `TipoMovimientoInventario` es GLOBAL (uno solo para PT, telas y avíos), así que
 * cualquier tipo sembrado por cualquier flujo aparece en el desplegable de cualquier captura. Pero
 * los tipos que un humano no debe elegir **no lo son por la misma razón**:
 *
 * | Reserva | Quién SÍ los escribe | Por qué puerta |
 * |---|---|---|
 * | **a la DIRECCIÓN** ({@link CODIGOS_TIPO_RESERVADOS}), 2 | Daniel, en persona | *«Salida de material sin orden»* (fila 0.104), con `salida-material.registrar` |
 * | **al SISTEMA** ({@link CODIGOS_TIPO_DEL_SISTEMA}), 12 | **nadie** — sólo el código | ninguna: son el EFECTO de otra operación (traspasar, recibir, entregar, contar, cancelar) |
 *
 * Los primeros **se capturan, por un camino**: existe una pantalla, existe un permiso, y quien la
 * tiene los escribe con toda legitimidad. Los segundos **no se capturan por ningún camino, ni
 * siquiera por el dueño**: nacen como consecuencia de otra operación, y escribirlos «a pelo»
 * produce un movimiento que dice que ocurrió algo que no ocurrió, sin nada de lo que ese algo
 * arrastra (el WIP, el cargo al maquilero, la otra pata del traspaso, el enlace al movimiento
 * cancelado).
 *
 * Meter los del sistema dentro del conjunto de la dirección habría sido cómodo y habría **borrado
 * esa diferencia**: mañana alguien le da a Daniel el permiso de la 0.104 y, sin quererlo, le abre
 * la puerta a estampar «Error de Entrada» a mano. Por eso son dos conjuntos y un motivo explícito
 * ({@link motivoReservaTipo}), no una lista sola.
 *
 * ## 🔴 EL CRITERIO, porque «lo resuelve el código por `codigo`» NO es suficiente
 *
 * Entra aquí el tipo que **SÓLO** escribe el código: no hay captura legítima de ese rótulo, por
 * ninguna pantalla y con ningún permiso. NO basta con que algún flujo automático lo resuelva por
 * `codigo` — `ajuste-entrada`/`ajuste-salida` los resuelve el código (para la contrapartida de una
 * cancelación de tela, por ejemplo) y aun así **son el ajuste manual de toda la vida**, el que
 * recomienda cada uno de los mensajes de rechazo de aquí abajo; reservarlos dejaría al almacén sin
 * cómo corregir. Lo mismo con `otras-salidas`, que además usa la salida sin orden como su caso
 * «otro»: la 0.104 ya decidió, con estas palabras, que reservarlo *«sería quitarle una capacidad
 * que ya tenía»*.
 *
 * ⚠️ **Esta lista NO se declara completa para siempre.** Se enumeraron a mano los 29 tipos que
 * siembra `prisma/seed.ts` y se cruzó cada uno contra quién lo escribe; hoy los que cumplen el
 * criterio son estos 12. El día que una fila estrene un tipo que sólo escriba el código, **tiene
 * que añadirlo aquí**, y el rechazo no aparece solo. Lo que sí está atado a máquina es que los 12
 * existan en el seed (`tipos-reservados.test.ts`): un dedazo dejaría la reserva muda.
 *
 * ## Los DOCE del sistema, y qué miente cada uno si se pone a mano
 *
 *  • `error-entrada` / `error-salida` — 🔴 los peores. Son los rótulos que el sistema estampa al
 *    **CANCELAR** un movimiento (`movimientos-pt.ts`, `transito.ts`, `entregas-cliente.ts`): el
 *    inverso auditado que exige D3. Puestos a mano, el kardex **afirma una cancelación que nunca
 *    ocurrió**, sin movimiento cancelado del otro lado.
 *  • `transferencia-salida` / `transferencia-entrada` — 🔴 las DOS PATAS de un traspaso, que el
 *    motor escribe **juntas y en la misma transacción**. Una sola, a mano, es **media
 *    transferencia**: la mercancía sale de un almacén y no llega a ninguno. Es peor que un rótulo
 *    equivocado — deja existencia colgando en el aire.
 *  • `ajuste-ciclico-entrada` / `-salida` — los estrenó F7-E5 *«para poder rastrear en el kardex qué
 *    diferencias vinieron de un cíclico»*. A mano afirman un conteo físico que nadie hizo, y
 *    contaminan justo la medición para la que nacieron. El ajuste genérico sigue disponible.
 *  • `entrada-recepcion` — lo escribe la RECEPCIÓN de una compra (con su factor de conversión y su
 *    costo). A mano entra material por una compra que no existe.
 *  • `salida-a-orden` — el seed lo llama *«**LA** única vía que descuenta tela hacia una orden»*. A
 *    mano carga consumo a una OP sin que nadie haya surtido nada.
 *  • `salida-por-nota` — el consumo de avíos va ligado a una NOTA de salida (R4). A mano, la nota
 *    no existe.
 *  • `merma-incompletas` — su propio seed lo dice: *«Lo mueve `darSalidaMermaIncompletas`, nunca a
 *    mano»* (fila 0.061). Es la prenda incompleta que sale sola del almacén de tránsito.
 *  • `entrada-maquila` — lo genera el RECIBO del maquilero, que además mueve el WIP y le carga al
 *    maquilero. A mano no actualiza nada de eso: entra producto de la nada.
 *  • `entrega-cliente` — lo genera la ENTREGA, que además marca la orden y alimenta la RC. A mano
 *    sale producto sin que nadie lo haya entregado.
 *
 * ⚠️ **Ninguno de los doce se rompe con esto**, porque los flujos buenos resuelven su tipo **por
 * `codigo`** y escriben con el MOTOR de kardex (`comun/kardex.ts`) — nunca pasan por el escritor
 * genérico ni por {@link rechazarTipoReservado}. Medido: las cuatro llamadas de la guarda están en
 * `registrarMovimientoPt`, `ajustarInventarioAvio`, `ajustarInventarioTela` y
 * `ajustarInventarioTelaColor`, y ninguna dentro del traspaso, del cíclico, de la recepción ni de
 * la nota. Es la misma forma que ya tenía la 0.104.
 *
 * ## Dónde muerde (A1: la pantalla esconde, el SERVIDOR decide)
 *
 * {@link rechazarTipoReservado} lo llaman los **CUATRO** escritores genéricos de inventario, los
 * únicos que aceptan un `idTipoMov` venido de una captura: PT (`movimientos-pt.ts`), tela por
 * color (`partidas-telas.ts`), tela por lote legada (`telas.ts`) y avíos (`avios.ts`). Son cuatro
 * puertas y hay que contarlas siempre: cerrar tres deja el rótulo igual de falsificable, sólo que
 * por la de al lado (cicatriz de la 0.104, 2ª ronda del reviewer). {@link tipoEsCapturableAMano}
 * alimenta la bandera `capturaManual` del catálogo para que además ninguna pantalla lo OFREZCA —
 * pero eso es cortesía; la pared es el rechazo.
 */
import { ErrorValidacion } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import { CODIGOS_TIPO_RESERVADOS } from './salida-sin-orden.js';

/** Por qué un rótulo del catálogo no se puede elegir en una captura manual. */
export type MotivoReserva = 'direccion' | 'sistema';

/**
 * Los rótulos que **sólo escribe el CÓDIGO**, con el flujo que los produce (va en el mensaje: un
 * rechazo que dice a dónde ir es una instrucción, no un portazo).
 *
 * 🔑 Es un MAPA y no un `Set` a propósito: el valor es la razón de ser de la reserva. Quien quiera
 * añadir uno tiene que escribir **quién lo escribe**, y si no sabe contestar eso, es que el tipo no
 * va aquí (ver el CRITERIO del encabezado: no basta con que el código lo resuelva por `codigo`).
 */
export const QUIEN_ESCRIBE_TIPO_DEL_SISTEMA: Readonly<Record<string, string>> = {
  // — Cancelación (el inverso auditado de D3) —
  'error-entrada': 'lo escribe el sistema al CANCELAR un movimiento de entrada',
  'error-salida': 'lo escribe el sistema al CANCELAR un movimiento de salida',
  // — Traspaso entre almacenes: las dos patas van JUNTAS o no van —
  'transferencia-salida':
    'lo escribe el sistema al registrar un traspaso entre almacenes, junto con su pata de entrada',
  'transferencia-entrada':
    'lo escribe el sistema al registrar un traspaso entre almacenes, junto con su pata de salida',
  // — Conteo cíclico —
  'ajuste-ciclico-entrada': 'lo escribe el sistema al aplicar un inventario cíclico contado',
  'ajuste-ciclico-salida': 'lo escribe el sistema al aplicar un inventario cíclico contado',
  // — Compras y consumo de material —
  'entrada-recepcion': 'lo escribe el sistema al recibir una orden de compra',
  'salida-a-orden': 'lo escribe el sistema al surtir tela a una orden de producción',
  'salida-por-nota': 'lo escribe el sistema al registrar una nota de salida de avíos',
  // — Producción —
  'entrada-maquila': 'lo escribe el sistema al registrar el recibo de maquila',
  'entrega-cliente': 'lo escribe el sistema al registrar la entrega al cliente',
  'merma-incompletas':
    'lo escribe el sistema al dar salida a las prendas incompletas del almacén de tránsito',
};

/** Los códigos reservados al SISTEMA (las llaves de {@link QUIEN_ESCRIBE_TIPO_DEL_SISTEMA}). */
export const CODIGOS_TIPO_DEL_SISTEMA: ReadonlySet<string> = new Set(
  Object.keys(QUIEN_ESCRIBE_TIPO_DEL_SISTEMA),
);

/**
 * Por qué está reservado un código, o `null` si cualquiera con su `.mover` lo puede capturar. Es
 * el ÚNICO sitio donde se cruzan las dos reservas: lo demás pregunta por aquí.
 */
export function motivoReservaTipo(codigo: string): MotivoReserva | null {
  if (CODIGOS_TIPO_RESERVADOS.has(codigo)) return 'direccion';
  if (CODIGOS_TIPO_DEL_SISTEMA.has(codigo)) return 'sistema';
  return null;
}

/** ¿Se puede ELEGIR este código en una captura manual? (bandera `capturaManual` del catálogo). */
export function tipoEsCapturableAMano(codigo: string): boolean {
  return motivoReservaTipo(codigo) === null;
}

/**
 * RECHAZA que un escritor GENÉRICO de inventario estampe un rótulo reservado — por cualquiera de
 * las dos razones. Se llama con el `idTipoMov` que llegó de la captura, DENTRO de la transacción y
 * ANTES de escribir nada.
 *
 * Se rechaza en seco (no se pide una llave): los flujos legítimos de los dos grupos resuelven su
 * tipo **por código**, no por id, así que ni pasan por aquí. Un camino alterno para escribir el
 * mismo rótulo serían otra vez dos puertas para una decisión.
 */
export async function rechazarTipoReservado(tx: Tx, idTipoMov: number): Promise<void> {
  const tipo = await tx.tipoMovimientoInventario.findUnique({
    where: { id: idTipoMov },
    select: { codigo: true, nombre: true },
  });
  if (tipo === null) return;
  const motivo = motivoReservaTipo(tipo.codigo);
  if (motivo === null) return;
  if (motivo === 'direccion') {
    throw new ErrorValidacion(
      `"${tipo.nombre}" no se captura como un movimiento manual: es una salida que sólo autoriza ` +
        `la dirección. Se registra en «Salida de material sin orden». Para corregir el inventario ` +
        `usa un ajuste.`,
    );
  }
  throw new ErrorValidacion(
    `"${tipo.nombre}" no se captura a mano: ${QUIEN_ESCRIBE_TIPO_DEL_SISTEMA[tipo.codigo] ?? ''}. ` +
      `Para corregir el inventario usa un ajuste.`,
  );
}
