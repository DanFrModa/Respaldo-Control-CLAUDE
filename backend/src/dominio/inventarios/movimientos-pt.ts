/**
 * Inventario de PRODUCTO TERMINADO operable (F3-E3; doc 04-Inventarios — IPT). Toda la lógica de
 * negocio vive AQUÍ (A1); las rutas REST solo validan permiso + Zod y delegan. Esta capa ORQUESTA el
 * motor de kardex (`comun/kardex.ts`) — que es el ÚNICO que escribe `Movimiento`/`MovimientoDetPt`—,
 * pero pone las VALIDACIONES de negocio que el motor no hace: no dejar existencia negativa en salidas
 * y traspasos, elegir el tipo inverso de una cancelación, y rechazar la dirección `traspaso` como
 * movimiento simple.
 *
 * Innegociables aplicados:
 *  • A1 — la lógica vive en este módulo de dominio; las rutas son delgadas.
 *  • A2 — el motor abre/compone la transacción; las validaciones de existencia suceden DENTRO de esa
 *    misma transacción (este módulo abre la tx, valida bajo lock y llama al motor con `{ tx }`).
 *  • A3/A7 — folio atómico + bitácora los hace el motor en cada movimiento.
 *  • A4 — cada operación re-verifica su permiso (`inventario-pt.ver`/`.mover`).
 *  • A9 — todo se filtra/sella por la empresa ACTIVA de la sesión.
 *  • D3 — la existencia es SIEMPRE Σ de movimientos; NO se edita ni se borra un movimiento. La
 *    corrección es un movimiento INVERSO auditado ({@link cancelarMovimientoPt}). Las VALIDACIONES
 *    transaccionales suman `MovimientoDetPt` DIRECTO bajo bloqueo (motor: `existenciaPtBloqueada`),
 *    NUNCA la vista `existencia_pt` (la vista es solo para CONSULTA — ADR-0010 §3).
 *  • D1/D2 — `costoUnit` queda NULL en toda F3 (el motor ni lo recibe).
 *
 * §Post-F9.40 (V1-E3b) — EL PT ETIQUETADO POR ORDEN SE PUEDE MOVER. La existencia de PT es por
 * modelo×color×talla×ORDEN×almacén (F6-E2): el recibo de maquila etiqueta cada pieza con la orden
 * que la produjo. Hasta V1-E3b este módulo pasaba `idOrden = null` FIJO, así que el movimiento
 * manual y el traspaso solo tocaban el bucket «sin orden» — lo producido por la fábrica no se podía
 * traspasar ni sacar a mano (dos saldos que no se hablaban) y la pantalla de existencias mostraba
 * piezas que el sistema rechazaba mover. Ahora la ORDEN viaja POR RENGLÓN (por color) desde la
 * captura: se escribe y se VALIDA contra ESE bucket, bajo el mismo lock. `null` sigue siendo el
 * bucket «sin orden» (lo capturado a mano en el arranque y lo migrado), que se mueve con libertad.
 *
 * Decisiones del lead (F3-E3):
 *  • Traspaso = dos patas con tipos `transferencia-salida`/`transferencia-entrada` (resueltos por
 *    `codigo`); el tipo viejo `transferencia-almacenes` (dirección `traspaso`) NO se usa como pata.
 *  • Cancelación: inverso por `error-entrada`/`error-salida` según la dirección del original
 *    (entrada→error-entrada salida; salida→error-salida entrada).
 *  • Salidas y traspasos NO pueden dejar existencia negativa. Entradas y cancelaciones no llevan ese
 *    bloqueo (la cancelación es el MECANISMO de corrección; un inverso siempre debe poder registrarse).
 *
 * NOTA — `IPT_Revision` (recuadre del viejo): NO se construye en E3. Con el kardex puro (la existencia
 * es la suma de movimientos, D3) no hay un saldo materializado que "recuadrar" contra los movimientos;
 * cualquier ajuste se captura como un movimiento de ajuste o un inverso auditado. No hay código.
 */
import {
  esquemaMovimientoPtCrear,
  esquemaTraspasoPtCrear,
  esquemaMovimientoPtCancelarCuerpo,
  type DatosMovPtLineaEntrada,
  type MovimientoPtSalida,
  type TraspasoPtSalida,
  type ExistenciasPtLista,
  type KardexPtLista,
  type KardexPtRenglon,
} from '../../contrato/index.js';
import { DireccionMovimiento, Prisma } from '../../datos/index.js';
import { z } from 'zod';

import { exigirAlmacenDelTipo } from '../../comun/almacenes.js';
import { registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { ZONA_DEL_NEGOCIO } from '../../comun/fecha-negocio.js';
import {
  cancelarMovimientoPt as cancelarMovimientoPtMotor,
  exigirExistenciaPt,
  registrarMovimientoPt as registrarMovimientoPtMotor,
  registrarTraspasoPt as registrarTraspasoPtMotor,
  type LineaMovimientoPt,
} from '../../comun/kardex.js';
import { ORIGEN } from '../../comun/origenes.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

// ── Códigos estables de los tipos de movimiento que el dominio resuelve por nombre ───────────────

/** Tipo de la pata de SALIDA de un traspaso (seed F3-E3, dirección `salida`). */
const COD_TRANSFERENCIA_SALIDA = 'transferencia-salida';
/** Tipo de la pata de ENTRADA de un traspaso (seed F3-E3, dirección `entrada`). */
const COD_TRANSFERENCIA_ENTRADA = 'transferencia-entrada';
/** Tipo inverso para CANCELAR un movimiento de ENTRADA (sale lo que había entrado; dirección `salida`). */
const COD_ERROR_ENTRADA = 'error-entrada';
/** Tipo inverso para CANCELAR un movimiento de SALIDA (re-entra lo que había salido; dirección `entrada`). */
const COD_ERROR_SALIDA = 'error-salida';

// ── Tipos internos ───────────────────────────────────────────────────────────────────────────────

/** Una celda color×talla "aplanada" (un renglón por talla), ya sin ceros. */
interface Celda {
  idColor: number;
  idTalla: number;
  cantidad: number;
  /**
   * ORDEN de producción de la que salen estas prendas (§Post-F9.40). Se captura por COLOR y viaja a
   * cada celda de ese color. `null` = bucket «sin orden». A DIFERENCIA de `numOrdenV1`, SÍ entra en
   * la llave de existencia y en los locks de no-negativo (la existencia PT es por
   * modelo×color×talla×ORDEN×almacén — F6-E2).
   */
  idOrden: number | null;
  /**
   * Nº de la orden del sistema VIEJO que fabricó estas prendas (§Post-F9.25). Se captura por COLOR
   * (un color de un modelo salió de una orden) y viaja a cada celda de ese color. Informativo: no
   * entra en la llave de existencia ni en los locks de no-negativo.
   */
  numOrdenV1?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Aplana la matriz de la entrada a celdas, validando SANIDAD (D4): color y talla SIN repetir dentro
 * de la captura y cantidades enteras ≥ 0 (Zod ya lo asegura; defensa en profundidad). Descarta las
 * celdas en 0. Exige al menos una celda con cantidad > 0. NO valida que color/talla existan (lo hace
 * la FK al escribir) ni la existencia (eso es la validación de salida/traspaso, bajo lock).
 */
function aplanarYValidar(lineas: DatosMovPtLineaEntrada[]): Celda[] {
  const idsColor = lineas.map((l) => l.idColor);
  if (new Set(idsColor).size !== idsColor.length) {
    throw new ErrorValidacion('Un color no puede aparecer dos veces en la misma captura.');
  }

  const celdas: Celda[] = [];
  for (const linea of lineas) {
    const idsTalla = linea.tallas.map((t) => t.idTalla);
    if (new Set(idsTalla).size !== idsTalla.length) {
      throw new ErrorValidacion('Una talla no puede aparecer dos veces en el mismo color.');
    }
    for (const t of linea.tallas) {
      if (!Number.isInteger(t.cantidad) || t.cantidad < 0) {
        throw new ErrorValidacion('Las cantidades deben ser enteros ≥ 0.');
      }
      if (t.cantidad > 0) {
        celdas.push({
          idColor: linea.idColor,
          idTalla: t.idTalla,
          cantidad: t.cantidad,
          // La orden (§Post-F9.40) y el nº de orden vieja se capturan por color y se replican a
          // sus tallas. Un color con existencia repartida en DOS órdenes se mueve con DOS
          // movimientos (un color no puede repetirse en la misma captura — regla de arriba).
          idOrden: linea.idOrden ?? null,
          numOrdenV1: linea.numOrdenV1 ?? null,
        });
      }
    }
  }
  if (celdas.length === 0) {
    throw new ErrorValidacion('El movimiento no tiene ninguna pieza (todas las cantidades son 0).');
  }
  return celdas;
}

/** Convierte celdas de dominio a líneas del motor de kardex (mismo modelo en todas). */
function aLineasMotor(idModelo: number, celdas: Celda[]): LineaMovimientoPt[] {
  return celdas.map((c) => ({
    idModelo,
    idColor: c.idColor,
    idTalla: c.idTalla,
    cantidad: c.cantidad,
    // §Post-F9.40 — el bucket de ORDEN que el usuario eligió (null = «sin orden»). El movimiento
    // escribe en el MISMO bucket contra el que se validó el no-negativo.
    idOrden: c.idOrden,
    // §Post-F9.25 — de qué orden VIEJA salieron estas prendas (solo consulta).
    numOrdenV1: c.numOrdenV1 ?? null,
  }));
}

/**
 * Valida que las ÓRDENES elegidas en la captura existan y sean de la empresa activa (A9 — §Post-F9.40).
 * Sin esto, un cliente podría etiquetar piezas con la orden de OTRA empresa (la columna `id_orden`
 * del detalle no lleva la empresa: la lleva el encabezado del movimiento). El bucket «sin orden»
 * (null) no necesita validación.
 */
async function validarOrdenesDeLaEmpresa(
  tx: Tx,
  idEmpresa: number,
  celdas: Celda[],
): Promise<void> {
  const ids = [...new Set(celdas.map((c) => c.idOrden).filter((id): id is number => id !== null))];
  if (ids.length === 0) {
    return;
  }
  const ordenes = await tx.orden.findMany({
    where: { id: { in: ids }, idEmpresa },
    select: { id: true },
  });
  const existentes = new Set(ordenes.map((o) => o.id));
  for (const id of ids) {
    if (!existentes.has(id)) {
      throw new ErrorNoEncontrado('Orden', id);
    }
  }
}

/** Resuelve un tipo de movimiento por su `codigo`, exigiéndolo activo. Lanza si no existe/inactivo. */
async function tipoPorCodigo(
  tx: Tx,
  codigo: string,
): Promise<{ id: number; nombre: string; direccion: DireccionMovimiento }> {
  const tipo = await tx.tipoMovimientoInventario.findUnique({
    where: { codigo },
    select: { id: true, nombre: true, direccion: true, activo: true },
  });
  if (tipo === null) {
    throw new ErrorValidacion(
      `Falta el tipo de movimiento "${codigo}" en el catálogo (re-sembrar). No se puede continuar.`,
    );
  }
  if (!tipo.activo) {
    throw new ErrorValidacion(`El tipo de movimiento "${tipo.nombre}" está desactivado.`);
  }
  return { id: tipo.id, nombre: tipo.nombre, direccion: tipo.direccion };
}

/**
 * Valida, bajo bloqueo, que SACAR `celdas` del almacén `idAlmacen` (artículos del `idModelo`) no deje
 * la existencia negativa (D3). La regla vive en el MOTOR ({@link exigirExistenciaPt}): la comparten
 * los movimientos manuales/traspasos de aquí y el envío de prendas terminadas al tránsito (V1-E4b),
 * y tiene que ser la misma letra por letra. Suma directa de `MovimientoDetPt` bajo advisory lock,
 * NUNCA la vista (ADR-0010 §3).
 *
 * §Post-F9.40 — cada celda valida contra el bucket de SU orden (F6-E2 "PT por orden"): el bucket
 * «sin orden» (`idOrden = null`, lo capturado a mano y lo migrado) es uno más, no el único.
 */
async function validarNoNegativo(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  idModelo: number,
  celdas: Celda[],
): Promise<void> {
  await exigirExistenciaPt(tx, idEmpresa, idAlmacen, idModelo, celdas);
}

// ── Proyección a la salida ─────────────────────────────────────────────────────────────────────

/** `include` para proyectar un movimiento PT con su matriz + nombres legibles. */
const incluirMovimiento = {
  tipoMov: { select: { nombre: true, direccion: true } },
  almacen: { select: { nombre: true } },
  anuladoPor: { select: { id: true } },
  detallesPt: {
    orderBy: [{ idColor: 'asc' }, { idTalla: 'asc' }],
    include: {
      modelo: { select: { codigo: true } },
      color: { select: { nombre: true } },
      talla: { select: { etiqueta: true, orden: true } },
      // §Post-F9.40 — el renglón dice de QUÉ orden salieron las piezas: el folio se muestra en la
      // respuesta (null = bucket «sin orden»).
      orden: { select: { folio: true } },
    },
  },
} satisfies Prisma.MovimientoInclude;

type MovimientoConDetalle = Prisma.MovimientoGetPayload<{ include: typeof incluirMovimiento }>;

/** Proyecta un movimiento (con detalle) a la forma JSON del contrato. El total se DERIVA por suma. */
function aMovimientoSalida(m: MovimientoConDetalle): MovimientoPtSalida {
  // Agrupa el detalle por color × ORDEN (§Post-F9.40): agrupar solo por color fundiría en un mismo
  // renglón piezas de órdenes distintas — el movimiento diría una orden que no es la de todas sus
  // piezas. Las tallas se ordenan por su `orden` del catálogo.
  const porRenglon = new Map<
    string,
    {
      idColor: number;
      color: string;
      idOrden: number | null;
      folioOrden: number | null;
      tallas: MovimientoConDetalle['detallesPt'];
    }
  >();
  let codigoModelo = '';
  for (const det of m.detallesPt) {
    codigoModelo = det.modelo.codigo;
    const clave = `${det.idColor}:${det.idOrden ?? 'sin'}`;
    const grupo = porRenglon.get(clave) ?? {
      idColor: det.idColor,
      color: det.color.nombre,
      idOrden: det.idOrden,
      folioOrden: det.orden === null ? null : Number(det.orden.folio),
      tallas: [],
    };
    grupo.tallas.push(det);
    porRenglon.set(clave, grupo);
  }

  let totalPiezas = 0;
  const lineas = [...porRenglon.values()].map((grupo) => {
    let totalLinea = 0;
    const tallas = grupo.tallas
      .slice()
      .sort((a, b) => a.talla.orden - b.talla.orden || a.idTalla - b.idTalla)
      .map((t) => {
        totalLinea += t.cantidad;
        return { idTalla: t.idTalla, etiquetaTalla: t.talla.etiqueta, cantidad: t.cantidad };
      });
    totalPiezas += totalLinea;
    return {
      idColor: grupo.idColor,
      color: grupo.color,
      idOrden: grupo.idOrden,
      folioOrden: grupo.folioOrden,
      tallas,
      totalPiezas: totalLinea,
    };
  });

  // El modelo del movimiento es el de su detalle (todos comparten modelo en F3-E3).
  const idModelo = m.detallesPt[0]?.idModelo ?? 0;

  return {
    id: m.id,
    folio: Number(m.folio),
    idEmpresa: m.idEmpresa,
    idTipoMov: m.idTipoMov,
    tipoMov: m.tipoMov.nombre,
    direccion: m.tipoMov.direccion,
    idAlmacen: m.idAlmacen,
    almacen: m.almacen.nombre,
    idModelo,
    modelo: codigoModelo,
    fecha: m.fecha.toISOString().slice(0, 10),
    observaciones: m.observaciones,
    origenTipo: m.origenTipo,
    cancelado: m.anuladoPor.length > 0,
    idMovimientoInverso: m.idMovimientoInverso,
    lineas,
    totalPiezas,
    creadoEn: m.creadoEn.toISOString(),
    creadoPorId: m.creadoPorId,
  };
}

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/** Obtiene un movimiento (con su matriz) de la empresa activa, o lanza `ErrorNoEncontrado` (A9). */
async function obtenerMovimiento(
  idMovimiento: number,
  idEmpresa: number,
  bd?: ContextoBd,
): Promise<MovimientoPtSalida> {
  const m = await clienteLectura(bd).movimiento.findFirst({
    where: { id: idMovimiento, idEmpresa },
    include: incluirMovimiento,
  });
  if (m === null) {
    throw new ErrorNoEncontrado('Movimiento', idMovimiento);
  }
  return aMovimientoSalida(m);
}

// ── Operaciones de ESCRITURA ───────────────────────────────────────────────────────────────────

/** Datos de un movimiento manual (campos del esquema compartido). */
export type EntradaMovimientoPt = z.input<typeof esquemaMovimientoPtCrear>;
/** Datos de un traspaso (campos del esquema compartido). */
export type EntradaTraspasoPt = z.input<typeof esquemaTraspasoPtCrear>;

/**
 * Registra un MOVIMIENTO MANUAL de inventario PT (entrada/salida/ajuste — doc 04-Inventarios). El
 * tipo de movimiento define la dirección: si es `salida`, valida bajo lock que no deje existencia
 * negativa (D3); las `entrada` no validan existencia. RECHAZA la dirección `traspaso` con mensaje
 * claro (eso va por {@link registrarTraspasoPt}). Permiso `inventario-pt.mover` (A4). El folio, la
 * escritura y la bitácora los hace el motor de kardex en UNA transacción (A2/A3/A7); origen
 * `ORIGEN.movimientoManual`.
 */
export async function registrarMovimientoPt(
  sesion: SesionUsuario,
  entrada: EntradaMovimientoPt,
  bd?: ContextoBd,
): Promise<MovimientoPtSalida> {
  verificarPermiso(sesion, 'inventario-pt.mover');
  const datos = validarEntrada(esquemaMovimientoPtCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  const idMovimiento = await enTransaccion(async (tx) => {
    const tipo = await tipoPorCodigoId(tx, datos.idTipoMov);
    if (tipo.direccion === DireccionMovimiento.traspaso) {
      throw new ErrorValidacion(
        'Un tipo de movimiento de dirección "traspaso" no es un movimiento manual: usa el traspaso ' +
          'entre almacenes (salida del origen + entrada al destino).',
      );
    }

    // Fila 0.137 — el almacén tiene que ser de PT: existe, activo, de esta empresa (A9) y del TIPO
    // del artículo que se mueve. Antes NADA de esto se validaba aquí: una entrada de producto
    // terminado se guardaba tan campante en la bodega de telas (o en un almacén de otra empresa).
    await exigirAlmacenDelTipo(tx, datos.idAlmacen, 'PT', idEmpresa);

    const celdas = aplanarYValidar(datos.lineas);
    // §Post-F9.40 — las órdenes elegidas deben ser de la empresa activa (A9), en entradas y salidas.
    await validarOrdenesDeLaEmpresa(tx, idEmpresa, celdas);

    // Solo las SALIDAS validan no-negativo (D3); las entradas suman sin tope.
    if (tipo.direccion === DireccionMovimiento.salida) {
      await validarNoNegativo(tx, idEmpresa, datos.idAlmacen, datos.idModelo, celdas);
    }

    const movimiento = await registrarMovimientoPtMotor(
      sesion,
      {
        idEmpresa,
        idTipoMov: datos.idTipoMov,
        idAlmacen: datos.idAlmacen,
        fecha: aDateColumna(datos.fecha),
        origenTipo: ORIGEN.movimientoManual,
        lineas: aLineasMotor(datos.idModelo, celdas),
        // Fila 0.100 — el MOTIVO se guarda en `Movimiento.observaciones`, la MISMA columna en la
        // que telas y avíos guardan el suyo (`dominio/inventarios/telas.ts`). Ya no es opcional:
        // `validarEntrada` (arriba, en ESTE dominio — A1) rechaza el movimiento sin él.
        observaciones: datos.motivo,
      },
      { tx },
    );
    return movimiento.id;
  }, bd);

  return obtenerMovimiento(idMovimiento, idEmpresa, bd);
}

/**
 * Registra un TRASPASO de PT entre dos almacenes de la empresa activa (doc 04-Inventarios). Valida
 * que el origen tenga existencia suficiente (cierra el TODO de `kardex.ts` línea ~260: el motor por
 * sí solo NO valida existencia del origen). Origen y destino DISTINTOS. El motor materializa las DOS
 * patas (salida del origen + entrada al destino) en UNA transacción (A2); este dominio abre la tx,
 * bloquea+valida el ORIGEN por artículo y luego llama al motor con `{ tx }`. Permiso
 * `inventario-pt.mover` (A4). Las patas usan los tipos `transferencia-salida`/`transferencia-entrada`
 * (resueltos por código).
 */
export async function registrarTraspasoPt(
  sesion: SesionUsuario,
  entrada: EntradaTraspasoPt,
  bd?: ContextoBd,
): Promise<TraspasoPtSalida> {
  verificarPermiso(sesion, 'inventario-pt.mover');
  const datos = validarEntrada(esquemaTraspasoPtCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  if (datos.idAlmacenOrigen === datos.idAlmacenDestino) {
    throw new ErrorValidacion(
      'El traspaso necesita un almacén de origen y otro de destino distintos.',
    );
  }

  const { idSalida, idEntrada } = await enTransaccion(async (tx) => {
    const tipoSalida = await tipoPorCodigo(tx, COD_TRANSFERENCIA_SALIDA);
    const tipoEntrada = await tipoPorCodigo(tx, COD_TRANSFERENCIA_ENTRADA);
    // Fila 0.137 — LOS DOS extremos deben ser de PT. Con el destino sin validar, un traspaso podía
    // "mudar" producto terminado a la bodega de telas y ahí quedaba, contado como PT en un almacén
    // que no es de PT.
    await exigirAlmacenDelTipo(tx, datos.idAlmacenOrigen, 'PT', idEmpresa);
    await exigirAlmacenDelTipo(tx, datos.idAlmacenDestino, 'PT', idEmpresa);
    const celdas = aplanarYValidar(datos.lineas);
    // §Post-F9.40 — las órdenes elegidas deben ser de la empresa activa (A9). Las DOS patas del
    // traspaso llevan la MISMA orden: la pieza no pierde de qué producción es al cambiar de almacén.
    await validarOrdenesDeLaEmpresa(tx, idEmpresa, celdas);

    // Cierra el hueco del motor: existencia suficiente en el ORIGEN, bajo lock por artículo, dentro
    // de la misma transacción que escribe las patas (concurrencia + atomicidad).
    await validarNoNegativo(tx, idEmpresa, datos.idAlmacenOrigen, datos.idModelo, celdas);

    const { salida, entrada: entradaMov } = await registrarTraspasoPtMotor(
      sesion,
      {
        idEmpresa,
        idTipoMovSalida: tipoSalida.id,
        idTipoMovEntrada: tipoEntrada.id,
        idAlmacenOrigen: datos.idAlmacenOrigen,
        idAlmacenDestino: datos.idAlmacenDestino,
        fecha: aDateColumna(datos.fecha),
        lineas: aLineasMotor(datos.idModelo, celdas),
        // Fila 0.100 — motivo obligatorio, guardado en `observaciones` de las DOS patas (el motor
        // lo copia): la hoja del traspaso lo imprime desde la pata de salida.
        observaciones: datos.motivo,
      },
      { tx },
    );
    return { idSalida: salida.id, idEntrada: entradaMov.id };
  }, bd);

  return {
    salida: await obtenerMovimiento(idSalida, idEmpresa, bd),
    entrada: await obtenerMovimiento(idEntrada, idEmpresa, bd),
  };
}

/**
 * Cómo se le dice al usuario dónde SÍ se cancela cada movimiento que no nació a mano. La clave es el
 * `origenTipo`; el valor, la frase que se le pone al mensaje.
 */
const DONDE_CANCELAR: Record<string, string> = {
  [ORIGEN.traspaso]:
    'es una de las DOS patas de un traspaso entre almacenes: cancelar solo una dejaría el ' +
    'inventario descuadrado entre los dos almacenes. Revierte el traspaso con otro traspaso, del ' +
    'destino al origen',
  [ORIGEN.reciboMaquila]: 'lo generó un RECIBO de maquila: cancélalo desde el recibo',
  [ORIGEN.envioMaquila]:
    'lo generó una ENTREGA de prendas a proceso: cancélala desde la entrega (así regresan del ' +
    'tránsito y el pendiente del maquilero se cierra con ella)',
  [ORIGEN.entregaCliente]: 'lo generó una ENTREGA A CLIENTE: cancélala desde la entrega',
  // ⚠️ El cíclico NO es una puerta de vuelta: `generarAjusteCiclico` deja el conteo en `cerrado`
  // (`inventario-ciclico.ts`) y `cancelarInventarioCiclico` rechaza justo ese estado ("ya está
  // cerrado (con ajuste): no se cancela"). O sea que el ÚNICO estado en el que existe un movimiento
  // `ajuste-ciclico` es el estado en el que el cíclico se niega a deshacerse. Mandar ahí al usuario
  // sería mandarlo a una puerta cerrada con llave — misma redacción que `migracion`, que es el otro
  // caso sin marcha atrás.
  [ORIGEN.ajusteCiclico]:
    'lo generó el AJUSTE de un INVENTARIO CÍCLICO ya cerrado, que no tiene marcha atrás. Si el ' +
    'conteo estuvo mal, corrige la existencia con un movimiento manual NUEVO, no anulando el ajuste',
  [ORIGEN.cancelacion]:
    'YA ES el inverso de otro movimiento (una cancelación): cancelar una cancelación no revierte ' +
    'nada, solo enreda la historia',
  [ORIGEN.migracion]:
    'lo cargó la MIGRACIÓN del sistema viejo: corregirlo a mano descuadraría el histórico. Ajusta ' +
    'la existencia con un movimiento nuevo, no anulando el migrado',
};

/**
 * ⭐ Solo se cancelan A MANO los movimientos que se capturaron A MANO (V1-E4b, hallazgo H2 del
 * reviewer). Todos los demás son el EFECTO de un hecho de negocio —un recibo, una entrega, un envío
 * de prendas a proceso, un cíclico— que además tiene su propio estado (etapa viva, cargo EsMa,
 * pendiente del maquilero). Anular el movimiento suelto revierte el inventario y deja el hecho en
 * pie: el kardex y el WIP quedan contándose historias distintas.
 *
 * El caso que lo destapó: tras un envío de 100 prendas al estampador, cancelando desde Inventarios
 * SOLO la pata de entrada al tránsito quedaban `primeras = 0` y `tránsito = 0` mientras el WIP
 * seguía reclamándole 100 al maquilero — cien prendas desaparecidas del kardex, que es exactamente
 * la enfermedad que esta etapa vino a curar. La raíz es anterior a V1-E4b (el traspaso manual tenía
 * el mismo hueco, y `cancelarMovimientoMaterial` ya lo cerraba para tela/avío), pero el tránsito la
 * vuelve grave porque ahora ese saldo SOSTIENE la historia del faltante.
 *
 * El mensaje no dice "no se puede": dice dónde sí (`DONDE_CANCELAR`).
 */
function exigirMovimientoCancelableAMano(origenTipo: string | null, origenId: string | null): void {
  if (origenTipo === ORIGEN.movimientoManual) {
    return;
  }
  const donde =
    (origenTipo === null ? undefined : DONDE_CANCELAR[origenTipo]) ??
    `lo generó otro proceso del sistema (${origenTipo ?? 'sin origen'}): cancélalo desde ahí`;
  const cual = origenId === null ? '' : ` (folio/id de origen: ${origenId})`;
  throw new ErrorConflicto(
    `Este movimiento no se capturó a mano: ${donde}${cual}. Anularlo aquí dejaría el ` +
      'inventario y el avance de producción contando historias distintas.',
  );
}

/**
 * CANCELA un movimiento de PT generando su INVERSO auditado (D3/A7): NUNCA edita ni borra el original.
 * Reemplaza la práctica vieja de "Error de Entrada/Salida": lee la dirección del original y elige el
 * tipo inverso — original `entrada` → `error-entrada` (saca lo que entró); original `salida` →
 * `error-salida` (re-entra lo que salió). Un inverso es un movimiento de corrección: NO lleva
 * validación de no-negativo (debe poder registrarse siempre). Permiso `inventario-pt.mover` (A4).
 * Solo movimientos de la empresa activa (A9). Un movimiento ya cancelado no se vuelve a cancelar
 * (lo refuerza el motor).
 */
export async function cancelarMovimientoPt(
  sesion: SesionUsuario,
  idMovimiento: number,
  cuerpo: z.input<typeof esquemaMovimientoPtCancelarCuerpo>,
  bd?: ContextoBd,
): Promise<MovimientoPtSalida> {
  verificarPermiso(sesion, 'inventario-pt.mover');
  const datos = validarEntrada(esquemaMovimientoPtCancelarCuerpo, cuerpo);
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    // Alcance por empresa activa (A9) + dirección del original para elegir el inverso.
    const original = await tx.movimiento.findFirst({
      where: { id: idMovimiento, idEmpresa },
      select: {
        id: true,
        origenTipo: true,
        origenId: true,
        tipoMov: { select: { direccion: true } },
        detallesPt: { select: { id: true } },
      },
    });
    if (original === null) {
      throw new ErrorNoEncontrado('Movimiento', idMovimiento);
    }
    if (original.detallesPt.length === 0) {
      throw new ErrorValidacion('Solo se pueden cancelar movimientos de producto terminado en F3.');
    }
    exigirMovimientoCancelableAMano(original.origenTipo, original.origenId);

    // entrada → inverso de SALIDA (error-entrada); salida → inverso de ENTRADA (error-salida).
    const codigoInverso =
      original.tipoMov.direccion === DireccionMovimiento.entrada
        ? COD_ERROR_ENTRADA
        : COD_ERROR_SALIDA;
    const tipoInverso = await tipoPorCodigo(tx, codigoInverso);

    // El motor crea el inverso y lo enlaza; lanza ErrorConflicto si ya estaba anulado.
    await cancelarMovimientoPtMotor(sesion, idMovimiento, tipoInverso.id, { tx });

    // El motor ya registra el CANCELAR, pero sin el motivo; lo dejamos en la bitácora (A7) para no
    // perderlo (el motor no acepta motivo y no se toca el núcleo).
    await registrarBitacora(tx, sesion, {
      entidad: 'Movimiento',
      idEntidad: idMovimiento,
      accion: 'OTRO',
      datos: { motivoCancelacion: datos.motivo },
    });
  }, bd);

  // Devuelve el ORIGINAL ya marcado como cancelado (su `anuladoPor` ahora trae al inverso).
  return obtenerMovimiento(idMovimiento, idEmpresa, bd);
}

/** Resuelve un tipo de movimiento por su id (PK), exigiéndolo activo. Lanza si no existe/inactivo. */
async function tipoPorCodigoId(
  tx: Tx,
  idTipoMov: number,
): Promise<{ id: number; nombre: string; direccion: DireccionMovimiento }> {
  const tipo = await tx.tipoMovimientoInventario.findUnique({
    where: { id: idTipoMov },
    select: { id: true, nombre: true, direccion: true, activo: true },
  });
  if (tipo === null) {
    throw new ErrorNoEncontrado('TipoMovimientoInventario', idTipoMov);
  }
  if (!tipo.activo) {
    throw new ErrorValidacion(`El tipo de movimiento "${tipo.nombre}" está desactivado.`);
  }
  return { id: tipo.id, nombre: tipo.nombre, direccion: tipo.direccion };
}

// ── Consultas de SOLO LECTURA ──────────────────────────────────────────────────────────────────

/**
 * Forma de DOMINIO de los filtros de existencias (ya coaccionados): la ruta REST coacciona el
 * querystring con el esquema del contrato (stringbool/coerce) y entrega banderas/números; este
 * esquema re-valida la forma de dominio (igual patrón que `esquemaListarTiposMovimiento`).
 */
const esquemaConsultaExistenciasPt = z.object({
  idModelo: z.number().int().positive().optional(),
  idColor: z.number().int().positive().optional(),
  idTalla: z.number().int().positive().optional(),
  idAlmacen: z.number().int().positive().optional(),
  idOrden: z.number().int().positive().optional(),
  incluirCeros: z.boolean().default(false),
  /** Con 'color-talla' la respuesta incluye el rollup `porColorTalla` (exige `idModelo`). */
  agrupar: z.enum(['color-talla']).optional(),
});

// ── El PERIODO del kardex (fila 0.138) ──────────────────────────────────────────────────────────
//
// Daniel, en el repaso de inventarios: *«con diez años cargados, pedirlo trae todo»*. Y era literal:
// medido contra una base sintética de 10 años (100 000 movimientos / 500 000 renglones de detalle),
// `kardexPt` de UN modelo devolvía **25 000 renglones y 8.3 MB de JSON** en una sola respuesta.
//
// La cura tiene dos piezas, y las DOS viven aquí (A1: ni la ruta ni la pantalla deciden nada):
//  1. Un PERIODO (`desde`/`hasta`) que se resuelve EN SERVIDOR (`WHERE movimientos.fecha …`), nunca
//     filtrando en el cliente lo que ya llegó.
//  2. Una VENTANA POR OMISIÓN cuando nadie pide periodo: sin esto, la pantalla que hoy no manda
//     fechas seguiría pidiendo los diez años y el defecto seguiría vivo para quien no toque el
//     filtro — que es justo la mayoría.
//
// Y como el rango solo no acota nada (quien escriba `desde=2016-01-01` vuelve al punto de partida),
// hay además un TOPE DURO de renglones. Los tres datos —periodo efectivo, tope y si hubo corte—
// VIAJAN EN LA RESPUESTA, para que la pantalla pueda decirlo: nadie debe creer que está viendo todo
// cuando está viendo un pedazo.

/**
 * Meses de la ventana por omisión cuando NADIE pide `desde`.
 *
 * Doce, no tres ni uno: un año es el ciclo completo del negocio (las dos temporadas y la
 * comparación contra el mismo mes del año pasado), y de un plumazo deja fuera el ~90 % de un
 * histórico de diez años. Un periodo más largo se pide a mano — y entonces es una decisión
 * consciente, no el precio por omisión de abrir la pantalla.
 */
export const MESES_VENTANA_KARDEX_PT = 12;

/** Renglones que devuelve el kardex si el llamador no pide otro tope. */
export const RENGLONES_KARDEX_PT_POR_OMISION = 1000;

/** Tope DURO de renglones: ni pidiéndolo se pasa de aquí (es el techo que el rango no garantiza). */
export const TOPE_RENGLONES_KARDEX_PT = 5000;

/**
 * Forma de DOMINIO de los filtros del kardex por modelo (ya coaccionados).
 *
 * **Se EXPORTA para que el contrato pueda compararse contra él** (`contrato/esquemas/
 * tope-kardex-honesto.test.ts`), no porque nadie más lo use: es el objeto que de verdad valida, y
 * una prueba que interrogue a un intermediario «equivalente» es un guardián ciego (la cicatriz está
 * escrita en `contrato/esquemas/paginacion-honesta.test.ts`).
 */
export const esquemaConsultaKardexPt = z
  .object({
    idModelo: z.number().int().positive(),
    idColor: z.number().int().positive().optional(),
    idTalla: z.number().int().positive().optional(),
    idAlmacen: z.number().int().positive().optional(),
    idOrden: z.number().int().positive().optional(),
    /** Primer día del periodo (YYYY-MM-DD), INCLUSIVE. */
    desde: z.iso.date({ error: 'La fecha «desde» no es válida (YYYY-MM-DD)' }).optional(),
    /** Último día del periodo (YYYY-MM-DD), INCLUSIVE. */
    hasta: z.iso.date({ error: 'La fecha «hasta» no es válida (YYYY-MM-DD)' }).optional(),
    limite: z
      .number()
      .int()
      .min(1)
      .max(TOPE_RENGLONES_KARDEX_PT)
      .default(RENGLONES_KARDEX_PT_POR_OMISION),
  })
  .refine((f) => f.desde === undefined || f.hasta === undefined || f.desde <= f.hasta, {
    error: 'El periodo está al revés: «desde» no puede ser posterior a «hasta».',
    path: ['desde'],
  });

/** El periodo que el kardex REALMENTE consultó (lo que viaja de vuelta a la pantalla). */
export interface VentanaKardexPt {
  /** Primer día consultado (YYYY-MM-DD, inclusive). SIEMPRE hay uno: nunca se lee sin piso. */
  desde: string;
  /** Último día consultado (YYYY-MM-DD, inclusive), o `null` si no se puso techo. */
  hasta: string | null;
  /** `true` cuando el `desde` lo puso esta función porque nadie pidió periodo. */
  porOmision: boolean;
}

/** El día de HOY tal como lo vive el negocio (México), en YYYY-MM-DD. */
function hoyDelNegocio(ahora: Date): string {
  // `en-CA` da exactamente `YYYY-MM-DD`; la zona se toma de `comun/fecha-negocio` para no tener
  // dos husos distintos en el sistema (el servidor corre en UTC y la gente captura en -06:00).
  return ahora.toLocaleDateString('en-CA', { timeZone: ZONA_DEL_NEGOCIO });
}

/**
 * Resuelve el PERIODO del kardex. Función PURA (por eso se prueba sin base de datos).
 *
 * Reglas, y son las que la respuesta declara:
 *  • Los dos extremos son INCLUSIVOS: un movimiento fechado el mismo día que `hasta` SÍ entra
 *    (`fecha` es una columna `date`, así que no hay trampa de horas).
 *  • Si NO viene `desde`, se pone uno: {@link MESES_VENTANA_KARDEX_PT} meses hacia atrás desde
 *    `hasta` si lo hay, o desde hoy si no. Es decir, **el periodo SIEMPRE tiene piso**, y por eso
 *    pedir el kardex no puede volver a traer diez años.
 *  • Si viene `hasta` sin `desde`, la ventana son los 12 meses que TERMINAN en `hasta` (no «todo
 *    hasta esa fecha»): la garantía de piso vale también ahí.
 *  • Si no viene `hasta`, no se pone techo — un movimiento con fecha futura (los hay: se capturan
 *    con la fecha del documento) sigue apareciendo, que es lo que uno espera al abrir el kardex.
 */
export function resolverVentanaKardexPt(
  filtros: { desde?: string | undefined; hasta?: string | undefined },
  ahora: Date = new Date(),
): VentanaKardexPt {
  const hasta = filtros.hasta ?? null;
  if (filtros.desde !== undefined) {
    return { desde: filtros.desde, hasta, porOmision: false };
  }
  const ancla = filtros.hasta ?? hoyDelNegocio(ahora);
  const [anio, mes, dia] = ancla.split('-').map(Number);
  // Aritmética de CALENDARIO en UTC (nada de restar milisegundos): un mes no dura siempre lo mismo.
  const piso = new Date(
    Date.UTC(anio as number, (mes as number) - 1 - MESES_VENTANA_KARDEX_PT, dia),
  );
  return { desde: piso.toISOString().slice(0, 10), hasta, porOmision: true };
}

/** Convierte un YYYY-MM-DD del periodo al `Date` que espera una columna `date` de Postgres. */
function diaDelPeriodo(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Parámetros de la consulta de existencias (forma de dominio). */
export type ParametrosExistenciasPt = z.input<typeof esquemaConsultaExistenciasPt>;

/**
 * Consulta las EXISTENCIAS de PT por modelo×color×talla×almacén, leyendo la vista `existencia_pt`
 * (aquí SÍ se usa la vista — es una CONSULTA, ADR-0010 §3) por `$queryRaw`, filtrada por la empresa
 * activa (A9) y opcionalmente por modelo/color/talla/almacén. JOIN para traer nombres legibles. Por
 * defecto OMITE las filas con existencia 0 (parámetro `incluirCeros` para verlas). Devuelve las filas
 * + el total general. Permiso `inventario-pt.ver` (A4).
 */
export async function consultarExistenciasPt(
  sesion: SesionUsuario,
  parametros: ParametrosExistenciasPt = {},
  bd?: ContextoBd,
): Promise<ExistenciasPtLista> {
  verificarPermiso(sesion, 'inventario-pt.ver');
  const filtros = validarEntrada(esquemaConsultaExistenciasPt, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  // El rollup color×talla es POR MODELO (la matriz del cajón); sin modelo no tiene sentido.
  if (filtros.agrupar === 'color-talla' && filtros.idModelo === undefined) {
    throw new ErrorValidacion('El rollup por color×talla requiere el filtro `idModelo`.');
  }

  // Condiciones componibles (Prisma.sql evita inyección; cada filtro es opcional).
  const condiciones: Prisma.Sql[] = [Prisma.sql`e."id_empresa" = ${idEmpresa}`];
  if (filtros.idModelo !== undefined)
    condiciones.push(Prisma.sql`e."id_modelo" = ${filtros.idModelo}`);
  if (filtros.idColor !== undefined)
    condiciones.push(Prisma.sql`e."id_color" = ${filtros.idColor}`);
  if (filtros.idTalla !== undefined)
    condiciones.push(Prisma.sql`e."id_talla" = ${filtros.idTalla}`);
  if (filtros.idAlmacen !== undefined)
    condiciones.push(Prisma.sql`e."id_almacen" = ${filtros.idAlmacen}`);
  if (filtros.idOrden !== undefined)
    condiciones.push(Prisma.sql`e."id_orden" = ${filtros.idOrden}`);
  if (!filtros.incluirCeros) condiciones.push(Prisma.sql`e."existencia" <> 0`);

  const where = Prisma.join(condiciones, ' AND ');

  // PT por orden (F6-E2): la vista `existencia_pt` ya agrega por …×ORDEN×almacén; aquí se trae el
  // folio de la orden (LEFT JOIN: el bucket "sin orden" tiene `id_orden` NULL → folio NULL).
  const filas = await cliente.$queryRaw<
    {
      idModelo: number;
      modelo: string;
      idColor: number;
      color: string;
      idTalla: number;
      etiquetaTalla: string;
      ordenTalla: number;
      idAlmacen: number;
      almacen: string;
      idOrden: number | null;
      folioOrden: bigint | null;
      existencia: bigint;
    }[]
  >(Prisma.sql`
    SELECT
      e."id_modelo"   AS "idModelo",
      mo."codigo"     AS "modelo",
      e."id_color"    AS "idColor",
      c."nombre"      AS "color",
      e."id_talla"    AS "idTalla",
      t."etiqueta"    AS "etiquetaTalla",
      t."orden"       AS "ordenTalla",
      e."id_almacen"  AS "idAlmacen",
      a."nombre"      AS "almacen",
      e."id_orden"    AS "idOrden",
      o."folio"       AS "folioOrden",
      e."existencia"  AS "existencia"
    FROM "existencia_pt" e
    JOIN "modelos"   mo ON mo."id" = e."id_modelo"
    JOIN "colores"   c  ON c."id"  = e."id_color"
    JOIN "tallas"    t  ON t."id"  = e."id_talla"
    JOIN "almacenes" a  ON a."id"  = e."id_almacen"
    LEFT JOIN "ordenes" o ON o."id" = e."id_orden"
    WHERE ${where}
    ORDER BY mo."codigo" ASC, c."nombre" ASC, t."orden" ASC, a."nombre" ASC, o."folio" ASC NULLS FIRST
  `);

  let totalExistencia = 0;
  const filasSalida = filas.map((f) => {
    const existencia = Number(f.existencia);
    totalExistencia += existencia;
    return {
      idModelo: f.idModelo,
      modelo: f.modelo,
      idColor: f.idColor,
      color: f.color,
      idTalla: f.idTalla,
      etiquetaTalla: f.etiquetaTalla,
      ordenTalla: f.ordenTalla,
      idAlmacen: f.idAlmacen,
      almacen: f.almacen,
      idOrden: f.idOrden,
      folioOrden: f.folioOrden === null ? null : Number(f.folioOrden),
      existencia,
    };
  });

  if (filtros.agrupar !== 'color-talla') {
    return { filas: filasSalida, totalExistencia };
  }

  // Rollup color×talla (rediseño R9, matriz del cajón de Modelos): la MISMA `WHERE` del listado,
  // agrupada en SERVIDOR (A1) — la existencia de cada celda ya viene sumada a través de
  // almacenes/órdenes; el cliente solo pinta (no pivota).
  const celdas = await cliente.$queryRaw<
    {
      idColor: number;
      color: string;
      idTalla: number;
      etiquetaTalla: string;
      ordenTalla: number;
      existencia: bigint;
    }[]
  >(Prisma.sql`
    SELECT
      e."id_color"   AS "idColor",
      c."nombre"     AS "color",
      e."id_talla"   AS "idTalla",
      t."etiqueta"   AS "etiquetaTalla",
      t."orden"      AS "ordenTalla",
      SUM(e."existencia")::bigint AS "existencia"
    FROM "existencia_pt" e
    JOIN "colores" c ON c."id" = e."id_color"
    JOIN "tallas"  t ON t."id" = e."id_talla"
    WHERE ${where}
    GROUP BY e."id_color", c."nombre", e."id_talla", t."etiqueta", t."orden"
    ORDER BY c."nombre" ASC, t."orden" ASC, e."id_talla" ASC
  `);

  return {
    filas: filasSalida,
    totalExistencia,
    porColorTalla: celdas.map((c) => ({
      idColor: c.idColor,
      color: c.color,
      idTalla: c.idTalla,
      etiquetaTalla: c.etiquetaTalla,
      ordenTalla: c.ordenTalla,
      existencia: Number(c.existencia),
    })),
  };
}

/** Parámetros del kardex por modelo (forma de dominio, ya coaccionada). */
export type ParametrosKardexPt = z.input<typeof esquemaConsultaKardexPt>;

/**
 * KARDEX por MODELO (doc 04-Inventarios — IPT_Kardex): lista CRONOLÓGICA de los movimientos de PT del
 * modelo EN UN PERIODO, con SALDO CORRIDO (running total) por artículo. Opcionalmente filtra
 * color/talla/almacén/orden. Lee `MovimientoDetPt` DIRECTO (sin la vista — la vista no preserva el
 * orden cronológico). El saldo corrido se calcula EN MEMORIA por artículo
 * (idColor:idTalla:idAlmacen:idOrden) en orden (folio asc): un artículo concreto es lo único que
 * comparte saldo; el saldo de cada renglón es el del artículo de ESE renglón tras aplicar su efecto.
 * Los movimientos cancelados se MARCAN pero su inverso ya neutraliza el saldo (ambos aparecen en el
 * kardex). Permiso `inventario-pt.ver` (A4); empresa activa (A9). SOLO LEE (D3 intacto).
 *
 * ⭐ FILA 0.138 — EL PERIODO, y por qué el saldo sigue siendo verdad. El filtro de fechas se aplica
 * en el `WHERE` (servidor), NUNCA recortando en el cliente lo que ya llegó; y si nadie pide periodo
 * se aplica la ventana por omisión de {@link resolverVentanaKardexPt}. Pero recortar por fecha, a
 * secas, ROMPERÍA la columna «Saldo»: el primer renglón de la ventana arrancaría en cero y todos los
 * saldos de abajo serían falsos. Por eso el periodo trae de la mano su SALDO ANTERIOR: una sola
 * consulta agregada suma, por artículo, todo lo que pasó ANTES de `desde`, y con ese número se
 * siembra el saldo corrido. Así cada saldo que se enseña es el saldo de verdad del artículo, no el
 * del pedazo que se está mirando.
 *
 * Y como un rango que el usuario escribe no acota nada por sí solo (`desde=2016-01-01` es otra vez
 * todo el histórico), hay un TOPE DURO de renglones: se piden `limite + 1` y, si vino de más, se
 * corta el excedente y se marca `truncado`.
 *
 * ⭐⭐ EL CORTE SE LLEVA LO VIEJO, NO LO NUEVO — y por qué eso obligó a mover el saldo anterior.
 * La primera versión de esta función pedía `folio ASC` y tiraba la cola. Parecía inocuo porque se
 * midió contra una base sintética cuyos folios NO guardaban relación con la fecha (correlación
 * medida: −0.0007). Pero el folio es la **secuencia atómica por empresa (A3)**: en producción crece
 * con el tiempo, o sea que `ORDER BY folio ASC LIMIT 1000` devuelve **los mil MÁS VIEJOS de la
 * ventana**. Medido sobre una base con folios cronológicos (25 000 renglones, 2 340 en los últimos
 * doce meses): la pantalla decía «Periodo: 2025-09-05 en adelante» y enseñaba **2025-09-05 →
 * 2026-02-07**, escondiendo los siete meses recientes — justo lo que uno abre un kardex a mirar.
 *
 * Ahora se pide `folio DESC` y se invierte: **lo que se ve es el FINAL del periodo**. El precio es
 * que el saldo anterior ya no puede ser «lo de antes de `desde`» (habría que sumarle además los
 * renglones que el corte se saltó), así que pasa a ser algo más simple y más fuerte: **lo que el
 * artículo traía justo antes del PRIMER RENGLÓN QUE SE VE**, calculado con la MISMA llave de orden
 * que la lista (`(folio, id)`), no con la fecha. Cuando no hay corte, ese punto es el inicio del
 * periodo y el número es idéntico al de antes; cuando lo hay, sigue siendo exacto. Usar la misma
 * llave para ordenar y para cortar es lo que hace que dos movimientos del mismo día a ambos lados
 * del límite no se cuenten dos veces ni se pierdan.
 */
export async function kardexPt(
  sesion: SesionUsuario,
  parametros: ParametrosKardexPt,
  bd?: ContextoBd,
): Promise<KardexPtLista> {
  verificarPermiso(sesion, 'inventario-pt.ver');
  const filtros = validarEntrada(esquemaConsultaKardexPt, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const modelo = await cliente.modelo.findUnique({
    where: { id: filtros.idModelo },
    select: { id: true, codigo: true },
  });
  if (modelo === null) {
    throw new ErrorNoEncontrado('Modelo', filtros.idModelo);
  }

  const ventana = resolverVentanaKardexPt(filtros);
  const desdeDia = diaDelPeriodo(ventana.desde);
  const hastaDia = ventana.hasta === null ? undefined : diaDelPeriodo(ventana.hasta);

  const detalles = await cliente.movimientoDetPt.findMany({
    where: {
      idModelo: filtros.idModelo,
      ...(filtros.idColor === undefined ? {} : { idColor: filtros.idColor }),
      ...(filtros.idTalla === undefined ? {} : { idTalla: filtros.idTalla }),
      ...(filtros.idOrden === undefined ? {} : { idOrden: filtros.idOrden }),
      movimiento: {
        idEmpresa,
        ...(filtros.idAlmacen === undefined ? {} : { idAlmacen: filtros.idAlmacen }),
        // El PERIODO, resuelto en SERVIDOR. Los dos extremos inclusivos: `fecha` es `date`, así que
        // `lte` del último día lo incluye entero (no hay medianoche que se coma el día).
        fecha: { gte: desdeDia, ...(hastaDia === undefined ? {} : { lte: hastaDia }) },
      },
    },
    select: {
      // El `id` del detalle NO es decorativo: junto con el folio forma la llave de orden, y con
      // ella se ancla el saldo anterior en el punto exacto donde arranca la lista.
      id: true,
      idColor: true,
      idTalla: true,
      idOrden: true,
      numOrdenV1: true,
      cantidad: true,
      color: { select: { nombre: true } },
      talla: { select: { etiqueta: true } },
      orden: { select: { folio: true } },
      movimiento: {
        select: {
          id: true,
          folio: true,
          fecha: true,
          observaciones: true,
          idAlmacen: true,
          almacen: { select: { nombre: true } },
          idTipoMov: true,
          tipoMov: { select: { nombre: true, direccion: true } },
          anuladoPor: { select: { id: true } },
        },
      },
    },
    // ⭐ DESCENDENTE a propósito (ver el encabezado): cuando el periodo no cabe en `limite`, lo que
    // se conserva es el FINAL. La llave es la misma de siempre —folio (secuencia atómica por
    // empresa, A3) y luego el id del detalle para desempatar renglones del mismo movimiento—, sólo
    // que recorrida al revés; la lista se invierte abajo y sale igual de cronológica.
    orderBy: [{ movimiento: { folio: 'desc' } }, { id: 'desc' }],
    // Uno de más: es la forma barata de saber que hay más SIN pagar un `count` sobre diez años.
    take: filtros.limite + 1,
  });

  const truncado = detalles.length > filtros.limite;
  // Los `limite` MÁS NUEVOS, devueltos en orden cronológico (el `slice` ya copia: no se muta).
  const enPeriodo = detalles.slice(0, filtros.limite).reverse();

  // SALDO ANTERIOR por artículo: lo que cada uno traía JUSTO ANTES del primer renglón que se ve.
  // Es lo que hace verdadera la columna «Saldo» cuando el kardex viene recortado —por fechas o por
  // el tope—. Sin renglones no hay punto de anclaje NI nada que explicar: se ahorra la consulta.
  const ancla = enPeriodo[0];
  const saldosPrevios =
    ancla === undefined
      ? []
      : await saldosAntesDelPeriodo(cliente, {
          idEmpresa,
          idModelo: filtros.idModelo,
          idColor: filtros.idColor,
          idTalla: filtros.idTalla,
          idAlmacen: filtros.idAlmacen,
          idOrden: filtros.idOrden,
          desde: desdeDia,
          hasta: hastaDia,
          anclaFolio: ancla.movimiento.folio,
          anclaIdDetalle: ancla.id,
        });

  // Saldo corrido por artículo (color:talla:almacén:orden), SEMBRADO con el saldo anterior.
  const saldoPorArticulo = new Map<string, number>(
    saldosPrevios.map((s) => [
      claveArticuloPt(s.idColor, s.idTalla, s.idAlmacen, s.idOrden),
      s.saldo,
    ]),
  );
  const articulosDelPeriodo = new Set<string>();

  const renglones: KardexPtRenglon[] = enPeriodo.map((d) => {
    const m = d.movimiento;
    const esEntrada = m.tipoMov.direccion === DireccionMovimiento.entrada;
    const esSalida = m.tipoMov.direccion === DireccionMovimiento.salida;
    const entrada = esEntrada ? d.cantidad : 0;
    const salida = esSalida ? d.cantidad : 0;

    // PT por orden (F6-E2): el saldo corrido es por artículo×ALMACÉN×ORDEN (el bucket "sin orden"
    // —`id_orden` NULL— lleva su propio saldo, separado de las prendas con orden).
    const claveArt = claveArticuloPt(d.idColor, d.idTalla, m.idAlmacen, d.idOrden);
    articulosDelPeriodo.add(claveArt);
    const saldoPrevio = saldoPorArticulo.get(claveArt) ?? 0;
    const saldo = saldoPrevio + entrada - salida;
    saldoPorArticulo.set(claveArt, saldo);

    return {
      idMovimiento: m.id,
      folio: Number(m.folio),
      fecha: m.fecha.toISOString().slice(0, 10),
      idTipoMov: m.idTipoMov,
      tipoMov: m.tipoMov.nombre,
      direccion: m.tipoMov.direccion,
      idAlmacen: m.idAlmacen,
      almacen: m.almacen.nombre,
      idColor: d.idColor,
      color: d.color.nombre,
      idTalla: d.idTalla,
      etiquetaTalla: d.talla.etiqueta,
      idOrden: d.idOrden,
      folioOrden: d.orden === null ? null : Number(d.orden.folio),
      numOrdenV1: d.numOrdenV1,
      entrada,
      salida,
      saldo,
      cancelado: m.anuladoPor.length > 0,
      observaciones: m.observaciones,
    };
  });

  return {
    idModelo: modelo.id,
    modelo: modelo.codigo,
    desde: ventana.desde,
    hasta: ventana.hasta,
    ventanaPorOmision: ventana.porOmision,
    limite: filtros.limite,
    truncado,
    // Sólo los artículos que SE MOVIERON en el periodo: son los que la tabla enseña y los únicos
    // cuyo saldo hay que poder explicar. Lo que no se movió no es kardex del periodo — es
    // existencia, y para eso está la pantalla de Existencias.
    saldosIniciales: saldosPrevios.filter((s) =>
      articulosDelPeriodo.has(claveArticuloPt(s.idColor, s.idTalla, s.idAlmacen, s.idOrden)),
    ),
    renglones,
  };
}

/** La llave del saldo corrido: un artículo es color×talla×almacén×orden (el NULL es su propio cubo). */
function claveArticuloPt(
  idColor: number,
  idTalla: number,
  idAlmacen: number,
  idOrden: number | null,
): string {
  return `${String(idColor)}:${String(idTalla)}:${String(idAlmacen)}:${idOrden === null ? 'sin' : String(idOrden)}`;
}

/** Filtros con los que se calcula el saldo anterior (los MISMOS del kardex, más el punto de corte). */
interface FiltrosSaldoAnterior {
  idEmpresa: number;
  idModelo: number;
  idColor?: number | undefined;
  idTalla?: number | undefined;
  idAlmacen?: number | undefined;
  idOrden?: number | undefined;
  /** Primer día del periodo. Todo lo ESTRICTAMENTE anterior a este día es «antes del periodo». */
  desde: Date;
  /** Último día del periodo, o `undefined` si no hay techo. */
  hasta?: Date | undefined;
  /** Folio del PRIMER renglón que se va a enseñar (el punto donde arranca el saldo corrido). */
  anclaFolio: bigint;
  /** Id del detalle de ese mismo renglón: desempata los renglones del mismo movimiento. */
  anclaIdDetalle: number;
}

/**
 * SALDO ANTERIOR por artículo: Σ(cantidad·signo) de todo lo que ese artículo movió ANTES del punto
 * donde arranca la lista (D3 — la existencia siempre es suma de movimientos, nunca un saldo
 * guardado). Ese punto son dos cosas a la vez, y por eso la condición tiene dos ramas:
 *
 *  1. **Todo lo anterior al periodo** (`fecha < desde`) — el saldo de apertura de siempre.
 *  2. **Lo del periodo que el TOPE dejó fuera por arriba** (dentro del periodo, pero con
 *     `(folio, id)` anterior al primer renglón visible). Cuando no hubo corte esta rama está vacía
 *     y el resultado es idéntico al del punto 1.
 *
 * Las dos ramas son excluyentes (una mira `fecha <`, la otra `fecha >=`), así que nada se cuenta
 * dos veces. Y la segunda usa **la misma llave con la que la lista se ordena y se corta**, no la
 * fecha: es lo que evita que dos movimientos del mismo día a ambos lados del límite se dupliquen o
 * se pierdan.
 *
 * ⚠️ **A9 y el MODELO son de CORRECCIÓN; color/talla/almacén/orden son de RENDIMIENTO.** La llave de
 * agrupación es color×talla×almacén×orden, así que un renglón de otro color cae en OTRO grupo y el
 * llamador lo descarta; pero `id_empresa` y `id_modelo` **no** están en esa llave: quitarlos sumaría
 * los movimientos de otra empresa o de otro modelo DENTRO del mismo grupo y todos los saldos de la
 * columna mentirían a la vez. Por eso esos dos tienen prueba que muere al quitarlos y los otros
 * cuatro no pueden tenerla — se dice aquí en vez de fingirla.
 *
 * Va en SQL crudo a propósito: el signo lo da `tipos_movimiento_inventario.direccion`, que cuelga
 * del encabezado `movimientos`, y Prisma no sabe agrupar por columnas de una relación. La suma es
 * la MISMA expresión que aplica el saldo corrido de arriba (entrada suma, salida resta, `traspaso`
 * no mueve saldo: sus dos patas se registran como tipos de dirección salida/entrada). Se agrega en
 * un CTE y los nombres se pegan DESPUÉS, para que los JOIN de catálogo trabajen sobre el puñado de
 * grupos y no sobre el histórico entero.
 */
async function saldosAntesDelPeriodo(
  cliente: ReturnType<typeof clienteLectura>,
  filtros: FiltrosSaldoAnterior,
): Promise<KardexPtLista['saldosIniciales']> {
  // El periodo, tal como lo aplica la lista (mismos bordes inclusivos).
  const dentroDelPeriodo =
    filtros.hasta === undefined
      ? Prisma.sql`m."fecha" >= ${filtros.desde}::date`
      : Prisma.sql`m."fecha" >= ${filtros.desde}::date AND m."fecha" <= ${filtros.hasta}::date`;

  const condiciones: Prisma.Sql[] = [
    Prisma.sql`d."id_modelo" = ${filtros.idModelo}`,
    Prisma.sql`m."id_empresa" = ${filtros.idEmpresa}`,
    // Rama 1: antes del periodo. Rama 2: dentro del periodo pero antes del primer renglón visible
    // (lo que el tope se llevó por arriba). Excluyentes entre sí.
    Prisma.sql`(
      m."fecha" < ${filtros.desde}::date
      OR (
        ${dentroDelPeriodo}
        AND (m."folio", d."id") < (${filtros.anclaFolio}::bigint, ${filtros.anclaIdDetalle}::int)
      )
    )`,
  ];
  if (filtros.idColor !== undefined)
    condiciones.push(Prisma.sql`d."id_color" = ${filtros.idColor}`);
  if (filtros.idTalla !== undefined)
    condiciones.push(Prisma.sql`d."id_talla" = ${filtros.idTalla}`);
  if (filtros.idOrden !== undefined)
    condiciones.push(Prisma.sql`d."id_orden" = ${filtros.idOrden}`);
  if (filtros.idAlmacen !== undefined)
    condiciones.push(Prisma.sql`m."id_almacen" = ${filtros.idAlmacen}`);
  const where = Prisma.join(condiciones, ' AND ');

  const filas = await cliente.$queryRaw<
    {
      idColor: number;
      color: string;
      idTalla: number;
      etiquetaTalla: string;
      idAlmacen: number;
      almacen: string;
      idOrden: number | null;
      folioOrden: bigint | null;
      saldo: bigint;
    }[]
  >(Prisma.sql`
    WITH previos AS (
      SELECT
        d."id_color"   AS "idColor",
        d."id_talla"   AS "idTalla",
        m."id_almacen" AS "idAlmacen",
        d."id_orden"   AS "idOrden",
        SUM(
          CASE
            WHEN t."direccion" = 'entrada' THEN d."cantidad"
            WHEN t."direccion" = 'salida'  THEN -d."cantidad"
            ELSE 0
          END
        )::bigint AS "saldo"
      FROM "movimiento_det_pt" d
      JOIN "movimientos" m ON m."id" = d."id_movimiento"
      JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
      WHERE ${where}
      GROUP BY 1, 2, 3, 4
    )
    SELECT
      p."idColor",
      c."nombre"   AS "color",
      p."idTalla",
      ta."etiqueta" AS "etiquetaTalla",
      p."idAlmacen",
      a."nombre"   AS "almacen",
      p."idOrden",
      o."folio"    AS "folioOrden",
      p."saldo"
    FROM previos p
    JOIN "colores"   c  ON c."id"  = p."idColor"
    JOIN "tallas"    ta ON ta."id" = p."idTalla"
    JOIN "almacenes" a  ON a."id"  = p."idAlmacen"
    LEFT JOIN "ordenes" o ON o."id" = p."idOrden"
    WHERE p."saldo" <> 0
    ORDER BY c."nombre" ASC, ta."orden" ASC, a."nombre" ASC, o."folio" ASC NULLS FIRST
  `);

  return filas.map((f) => ({
    idColor: f.idColor,
    color: f.color,
    idTalla: f.idTalla,
    etiquetaTalla: f.etiquetaTalla,
    idAlmacen: f.idAlmacen,
    almacen: f.almacen,
    idOrden: f.idOrden,
    folioOrden: f.folioOrden === null ? null : Number(f.folioOrden),
    saldo: Number(f.saldo),
  }));
}

/**
 * KARDEX por FOLIO: el detalle de UN movimiento por su folio dentro de la empresa activa (A9). Es la
 * vista de "abrir un movimiento del kardex" (con su matriz color×talla). Permiso `inventario-pt.ver`.
 */
export async function obtenerMovimientoPorFolio(
  sesion: SesionUsuario,
  folio: number,
  bd?: ContextoBd,
): Promise<MovimientoPtSalida> {
  verificarPermiso(sesion, 'inventario-pt.ver');
  const m = await clienteLectura(bd).movimiento.findFirst({
    where: { idEmpresa: sesion.idEmpresaActiva, folio: BigInt(folio) },
    include: incluirMovimiento,
  });
  if (m === null) {
    throw new ErrorNoEncontrado('Movimiento (folio)', folio);
  }
  return aMovimientoSalida(m);
}
