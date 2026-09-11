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
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarFechaCapturable } from '../../comun/fecha-capturable.js';
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
import { DONDE_CANCELAR_AJUSTE_CICLICO } from './cancelacion-comun.js';
import {
  camposPeriodoKardex,
  diaDelPeriodo,
  periodoAlDerecho,
  recortarPorLaCola,
  resolverVentanaKardex,
} from './periodo-kardex.js';
import { rechazarTipoReservado } from './tipos-reservados.js';

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

/**
 * ⏳ **LA FECHA DEL MOVIMIENTO VUELVE A TENER CANDADO (fila 0.171).**
 *
 * En el sistema viejo, poner una fecha libre a un movimiento de PT era un privilegio: el **acceso
 * #28**, *«Poder meter la fecha que sea en los movimientos de almacen de PT»* (doc
 * `04-Inventarios`). v2 se trajo el permiso al catálogo —`ipt.fecha-libre`, con su `idAcceso: 28`
 * anotado— pero **se le olvidó la guarda**: hasta esta fila el esquema aceptaba cualquier fecha sin
 * mirar permiso, y el permiso no tenía UN SOLO llamador en todo `backend/src`. El gemelo de
 * Indicadores (`indicadores.fecha-libre`) sí protege desde F7-E4, y es lo que demuestra que aquí
 * hubo un descuido y no una decisión.
 *
 * Backdatear un movimiento no es cosmético: el kardex ES el inventario (D3) y la fecha es por
 * dónde se corta el saldo a un día, se cuadra un cíclico y se lee «cuánto había cuando». Una
 * entrada fechada el mes pasado cambia una historia que ya se leyó.
 *
 * 🔑 Va en el DOMINIO, no en el esquema del contrato (A1): la pantalla puede acotar el selector,
 * pero quien llame por otro camino se topa con la misma pared.
 *
 * ⏳ **La VENTANA (7 días) es un DEFAULT PROPUESTO, pendiente de que lo confirme Daniel.** Se toma
 * de `comun/fecha-capturable.ts` por simetría con Indicadores; nadie ha decidido cuál es la buena
 * para el almacén de PT.
 *
 * 🔴 **Y hay que decirlo aquí, pegado a la guarda: con el seed de HOY esta puerta no le cierra a
 * nadie.** Los SEIS perfiles que pueden mover PT (`Directivo`, `Gerencial`, `Ventas`, `Logística`,
 * `Asistente`, `Secretarial`) llevan también `ipt.fecha-libre` — herencia de la cascada del sistema
 * viejo, el mismo defecto que documenta el perfil `Secretarial` en `prisma/seed.ts` y que las filas
 * 0.105/0.128 vienen podando de a uno. El gemelo de Indicadores está exactamente igual. El
 * MECANISMO ya existe (que es lo que faltaba); a QUIÉN se le quita la llave es una decisión de
 * perfiles que le toca a Daniel, no a esta fila.
 */
function verificarFechaMovimientoPt(sesion: SesionUsuario, fechaIso: string): void {
  verificarFechaCapturable(sesion, aDateColumna(fechaIso), { permiso: 'ipt.fecha-libre' });
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
  // Fila 0.171 — la fecha LIBRE es un privilegio (ex acceso #28); sin él, sólo la ventana.
  verificarFechaMovimientoPt(sesion, datos.fecha);
  const idEmpresa = sesion.idEmpresaActiva;

  const idMovimiento = await enTransaccion(async (tx) => {
    // ⛔ Ningún rótulo RESERVADO se estampa a mano (`tipos-reservados.ts`), por las DOS razones:
    //  • 0.104 — «Devolución a Proveedor» / «Venta de Material» los escribe sólo la dirección por
    //    su pantalla; quien leyera el kardex creería que esa salida la autorizó Daniel. La venta
    //    de PT tiene su propia fila (0.130), con cliente y precio.
    //  • 0.171 — los DOCE que escribe SÓLO el sistema (la lista y el porqué de cada uno están en
    //    `tipos-reservados.ts`). Los dos peores tienen su reflejo aquí mismo: `error-entrada` /
    //    `error-salida` son los que estampa la CANCELACIÓN de abajo —puestos a mano el kardex
    //    afirmaría una cancelación que nunca ocurrió— y `transferencia-salida`/`-entrada` son las
    //    dos patas que `registrarTraspasoPt` escribe JUNTAS: una sola, a mano, es media
    //    transferencia (mercancía que sale de un almacén y no llega a ninguno).
    await rechazarTipoReservado(tx, datos.idTipoMov);
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
  // Fila 0.171 — el traspaso escribe DOS movimientos de kardex con esta fecha, así que pasa por el
  // mismo candado: el acceso #28 del viejo hablaba de «los movimientos de almacen de PT», no de una
  // pantalla en particular. Dejar sólo el movimiento manual guardado sería cerrar una de dos
  // puertas al mismo dato.
  verificarFechaMovimientoPt(sesion, datos.fecha);
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
  // La frase vive en `cancelacion-comun.ts`: telas y avíos dicen EXACTAMENTE lo mismo (fila 0.099).
  [ORIGEN.ajusteCiclico]: DONDE_CANCELAR_AJUSTE_CICLICO,
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

    // El motor crea el inverso y lo enlaza; lanza ErrorConflicto si ya estaba anulado. Desde la
    // fila 0.180 recibe el MOTIVO: lo escribe en las `observaciones` del inverso (para que se lea
    // en el kardex) y en su propio renglón de bitácora `CANCELAR`. Aquí ya NO se registra un
    // renglón `OTRO` aparte: era el parche de cuando el motor no aceptaba motivo, y ahora sería
    // el mismo dato dos veces sobre la misma entidad.
    await cancelarMovimientoPtMotor(sesion, idMovimiento, tipoInverso.id, datos.motivo, { tx });
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
 * ⭐ EL TOPE DE LAS EXISTENCIAS (fila 0.143) — renglones que devuelve la consulta si nadie pide otro.
 *
 * **El defecto que cura:** `consultarExistenciasPt` tenía TODOS sus filtros opcionales y ningún
 * `LIMIT`, así que abrir Inventario › Existencias sin elegir modelo pedía **la vista entera en una
 * sola respuesta** (el reviewer de la 0.138 midió 56 860 filas contra una base sintética).
 *
 * 📏 **Medido con 60 000 renglones de existencia sembrados** (el orden de magnitud de aquella
 * medición): la carga útil de la respuesta pasa de **10 498 KB a 198 KB**, o sea **53 veces menos**
 * (el reviewer de la fila lo repitió en otra máquina y midió **47×** — mismo orden). **Ésa es la
 * mejora, y es la que reproduce en cualquier sitio.**
 *
 * ⚠️ **De dónde NO sale.** `existencia_pt` es una vista AGREGADA (`GROUP BY` sobre
 * `movimiento_det_pt`): hay que calcularla entera **en los dos casos**, y ningún índice puede
 * evitarlo (`EXPLAIN`: `HashAggregate` sobre un `Seq Scan`, y el `LIMIT` sólo añade un `top-N
 * heapsort`). Lo que el tope ahorra es serializar, transferir, guardar en memoria y pintar decenas
 * de miles de objetos. **Los tiempos concretos NO se citan aquí a propósito: no reproducen.** Las
 * dos mediciones de esta fila coinciden en que el tope **no empeora** el tiempo con 60 000
 * renglones (219→167 ms en una máquina, 1 733→430 ms en otra) y discrepan por completo en las
 * cifras y en el caso pequeño; una versión anterior de este comentario dedujo de UNA sola muestra
 * un mecanismo («el sort del corte lo hace un pelo más caro») que la segunda máquina no observa.
 * Si algún día la queja fuera el TIEMPO de la consulta y no el peso, la respuesta sería otra —una
 * vista materializada—, no un tope más chico.
 *
 * 🔑 **Es el hermano de la 0.138, pero NO se cura igual.** El kardex se acotó por FECHAS (periodo +
 * ventana por omisión, `periodo-kardex.ts`); **una existencia no tiene fecha**: es un saldo, no un
 * suceso. No hay periodo que recortar, así que aquí sólo queda la otra mitad del mecanismo de la
 * 0.138 — el TOPE DURO con aviso honesto —, y por eso se copian su forma y sus nombres (`limite` de
 * entrada, `limite`/`truncado` en la respuesta) en vez de inventar un quinto patrón.
 *
 * 📏 **Por qué 1 000 / 5 000, los MISMOS números del kardex.** Un renglón de existencia es más ligero
 * que uno de kardex (12 campos contra 20) y lo pinta la misma tabla densa de la misma pantalla, así
 * que el techo que aguanta el navegador es el mismo o mayor: usar otro número obligaría a explicar
 * una diferencia que no existe. Un solo par de números para todo el módulo de inventarios.
 *
 * ⚠️ **Y por qué NO se usa `esquemaPaginacion` (el paginado estándar del proyecto).** Su tope es
 * **100 por página**, y la matriz de UN SOLO modelo (color×talla×orden×almacén) pasa de 100
 * renglones con facilidad: paginar de 100 en 100 convertiría la consulta normal —la que hoy sale de
 * un tirón— en seis peticiones. El tope alto con aviso deja intacta la consulta normal y sólo acota
 * la patológica.
 */
export const RENGLONES_EXISTENCIAS_PT_POR_OMISION = 1000;

/** Tope DURO de renglones de existencias: ni pidiéndolo se pasa de aquí. */
export const TOPE_RENGLONES_EXISTENCIAS_PT = 5000;

/**
 * Forma de DOMINIO de los filtros de existencias (ya coaccionados): la ruta REST coacciona el
 * querystring con el esquema del contrato (stringbool/coerce) y entrega banderas/números; este
 * esquema re-valida la forma de dominio (igual patrón que `esquemaListarTiposMovimiento`).
 *
 * ⚠️ **Se EXPORTA para que el contrato pueda compararse contra él** (`contrato/esquemas/
 * tope-existencias-honesto.test.ts`): el tope vive dos veces —como `.max()` literal en el
 * querystring publicado y como {@link TOPE_RENGLONES_EXISTENCIAS_PT} aquí— y una prueba mecánica
 * cruza los dos. Comparar contra un intermediario «equivalente» sería un guardián ciego (cicatriz
 * de `contrato/esquemas/paginacion-honesta.test.ts`).
 */
export const esquemaConsultaExistenciasPt = z.object({
  idModelo: z.number().int().positive().optional(),
  idColor: z.number().int().positive().optional(),
  idTalla: z.number().int().positive().optional(),
  idAlmacen: z.number().int().positive().optional(),
  idOrden: z.number().int().positive().optional(),
  incluirCeros: z.boolean().default(false),
  /** Con 'color-talla' la respuesta incluye el rollup `porColorTalla` (exige `idModelo`). */
  agrupar: z.enum(['color-talla']).optional(),
  /** Tope de renglones. El DEFAULT vive aquí (A1), no en el contrato. */
  limite: z
    .number()
    .int()
    .min(1)
    .max(TOPE_RENGLONES_EXISTENCIAS_PT)
    .default(RENGLONES_EXISTENCIAS_PT_POR_OMISION),
});

// ── El PERIODO del kardex (fila 0.138, generalizado en la 0.173) ─────────────────────────────────
//
// El mecanismo entero —ventana por omisión, tope duro, corte por la cola y por qué— vive UNA sola
// vez en `periodo-kardex.ts`, que es de donde lo toman también los kardex de tela (por color y por
// lote) y el de avíos. Aquí sólo se le pegan los filtros propios de producto terminado.
//
// ⚠️ LO QUE SÍ ES PROPIO DE PT Y NO SE PUEDE PERDER AL COMPARTIR EL MECANISMO. El periodo se lee SIN
// TECHO cuando nadie pide `hasta`, para que un movimiento con FECHA FUTURA siga saliendo. En
// materiales esas fechas son sobre todo basura del histórico de Access; en producto terminado el
// matiz es otro: desde la fila 0.171 el movimiento manual y el traspaso RECHAZAN una fecha futura a
// quien no tenga `ipt.fecha-libre`, así que hoy sólo pueden nacer con fecha futura (a) los que
// capture alguien CON esa llave —que hoy son todos los perfiles que mueven PT— y (b) los que escriba
// el sistema o traiga el ETL, que no pasan por la guarda. La lectura sigue sin techo a propósito: si
// existen, se ven.
//
// ⏳ Y QUEDA UNA PREGUNTA DE NEGOCIO ABIERTA, numerada aparte: ¿el almacén de PT captura de verdad
// movimientos con fecha futura? Si la respuesta es que sí y es habitual, la guarda de la 0.171 le
// estorbaría a quien se quede sin la llave el día que se poden los perfiles. Va junto con la
// pregunta de cuántos días debe durar la ventana — las dos las contesta Daniel de una vez.

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
    ...camposPeriodoKardex,
  })
  .refine(periodoAlDerecho.predicado, periodoAlDerecho.opciones);

/** Parámetros de la consulta de existencias (forma de dominio). */
export type ParametrosExistenciasPt = z.input<typeof esquemaConsultaExistenciasPt>;

/**
 * Consulta las EXISTENCIAS de PT por modelo×color×talla×almacén, leyendo la vista `existencia_pt`
 * (aquí SÍ se usa la vista — es una CONSULTA, ADR-0010 §3) por `$queryRaw`, filtrada por la empresa
 * activa (A9) y opcionalmente por modelo/color/talla/almacén. JOIN para traer nombres legibles. Por
 * defecto OMITE las filas con existencia 0 (parámetro `incluirCeros` para verlas). Devuelve las filas
 * + los totales del UNIVERSO + si hubo corte. Permiso `inventario-pt.ver` (A4).
 *
 * ⭐ FILA 0.143 — EL TOPE, Y POR QUÉ LOS TOTALES SIGUEN SIENDO VERDAD.
 *
 * Antes no había `LIMIT`: sin modelo y sin almacén esto devolvía la vista completa. Ahora se
 * devuelven como mucho {@link TOPE_RENGLONES_EXISTENCIAS_PT} renglones y la respuesta DICE cuántos
 * hay en total y si cortó — ver el porqué del número en {@link RENGLONES_EXISTENCIAS_PT_POR_OMISION}.
 *
 * ⭐⭐ **EL CORTE SE LLEVA LO PEQUEÑO, NO «EL FINAL DEL ALFABETO».** El kardex podía recortar por la
 * cola porque su orden (el folio) *es* su importancia: uno abre un kardex a ver lo último. Una
 * existencia no tiene tiempo, y cortar por el orden de PRESENTACIÓN (código de modelo) escondería
 * *«todos los modelos de la M en adelante»* — un criterio que no significa nada para quien mira
 * inventario. Aquí el corte se decide por **cantidad**: si sólo caben N renglones, los que importan
 * son **donde está la mercancía**.
 *
 * Y se ordena por **`abs(existencia)`, no por `existencia`**, a propósito: una existencia NEGATIVA
 * es una anomalía que alguien tiene que ver, y un `DESC` a secas las manda a todas al final —
 * justo a la zona que el tope se lleva. Esconder anomalías detrás de un aviso de recorte sería el
 * mismo defecto con otra ropa.
 *
 * 🔴 **PERO EL MISMO `abs()` TIENE UN SESGO QUE HAY QUE CONOCER ANTES DE LLAMAR A ESTA FUNCIÓN: los
 * renglones en CERO quedan, por construcción, los ÚLTIMOS — o sea, los PRIMEROS que el tope
 * descarta.** Medido: con 80 renglones en el universo, 16 de ellos en cero y sitio para 40,
 * sobrevivieron **0** de los 16. ⇒ **quien pida `incluirCeros` porque los ceros le importan NO
 * puede quedarse con el `limite` por omisión** (es el caso del modo ENTRADA de Movimientos PT, que
 * pide los buckets de orden que quedaron en cero al irse a estampado: la pantalla pide el techo,
 * ver `frontend/src/modulos/inventarios/tope-existencias.ts`). Lo fija
 * `movimientos-pt.int.test.ts` para que un quinto consumidor no lo redescubra a golpes.
 *
 * ⚠️ Y que nadie «arregle» esto reordenando para que los ceros ganen: quien perdería entonces es un
 * renglón CON saldo, y para un desplegable de órdenes eso hace exactamente el mismo daño. El
 * consumidor que necesita la lista COMPLETA no necesita un mejor recorte: necesita no recortar.
 *
 * 🔑 **El corte se decide por cantidad pero la lista se ENTREGA en el orden de siempre** (modelo,
 * color, talla, almacén, orden): la consulta interna elige QUÉ renglones caben y la externa los
 * acomoda para leerlos. Así la pantalla se ve exactamente igual que antes cuando no hay corte, y el
 * desempate del `LIMIT` va por la llave completa de la vista (los cinco ids, que son su `GROUP BY`)
 * para que **dos llamadas idénticas devuelvan siempre los mismos renglones**.
 *
 * 📐 **Los totales se miden sobre el UNIVERSO, con funciones de ventana en la MISMA consulta.**
 * `count(*) OVER ()` y `sum(existencia) OVER ()` se evalúan ANTES del `ORDER BY`/`LIMIT`, así que
 * cada renglón devuelto trae el conteo y la suma de **todo lo que casa con el `WHERE`**. Es la
 * diferencia entre *«hay 56 860 renglones, te enseño 1 000»* y una pantalla que dice 1 000 y se
 * queda tan tranquila. Sumar en JS lo que llegó daría el total DEL PEDAZO — un número creíble y
 * falso. Y viene de la misma consulta (no de un `count` aparte) para que el `WHERE` sea el mismo
 * **por construcción**, no por parecido.
 *
 * ⚠️ **Lo que el tope NO toca: `porColorTalla`.** Ese rollup lo agrega SQL (`GROUP BY`) sobre el
 * universo entero, así que la matriz del cajón de Modelos sigue siendo exacta aunque `filas` venga
 * recortada. Su cardinalidad tampoco necesita tope: exige `idModelo` y es la rejilla color×talla de
 * UN modelo (decenas de celdas, no decenas de miles).
 *
 * 🚫 **No hay `pagina`, y es una decisión, no un olvido.** El orden por el que se corta —cantidad—
 * no es un orden por el que un humano navegue: «la página 7 de las existencias ordenadas por
 * piezas» no le sirve a nadie. La herramienta para llegar al resto es el FILTRO (modelo, almacén,
 * color, talla), que es lo que el operador usa de todas formas, y el aviso de la pantalla lo dice
 * con esas palabras. A cambio queda esto dicho en voz alta, **con los dos números que de verdad
 * rigen, que no son el mismo**: la pantalla de Existencias corta en
 * {@link RENGLONES_EXISTENCIAS_PT_POR_OMISION} (su default, porque es un informe y nadie lee más),
 * así que **ahí un modelo con más de 1 000 renglones ya no se ve completo ni filtrando**; las dos
 * pantallas de CAPTURA piden el techo de {@link TOPE_RENGLONES_EXISTENCIAS_PT} porque necesitan la
 * lista completa, y su límite empieza ahí. Ese residuo pediría paginar de verdad —o mejor, un
 * agregado en servidor para el desplegable de órdenes—, y hoy no existe.
 *
 * ⚠️ Una versión anterior de este comentario declaraba el residuo sólo en 5 000 **sin que ninguna
 * pantalla pidiera 5 000**: subestimaba la exposición real por 5×, y era justo la frase con la que
 * la fila se defiende de no paginar.
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
      /** Renglones del UNIVERSO del filtro (window: se cuenta antes del LIMIT). */
      totalFilas: bigint;
      /** Σ existencia del UNIVERSO del filtro (window: se suma antes del LIMIT). */
      totalUniverso: bigint;
    }[]
  >(Prisma.sql`
    SELECT * FROM (
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
        e."existencia"  AS "existencia",
        -- Los totales son del UNIVERSO: las funciones de ventana se evalúan ANTES del LIMIT.
        COUNT(*) OVER ()                        AS "totalFilas",
        (SUM(e."existencia") OVER ())::bigint   AS "totalUniverso"
      FROM "existencia_pt" e
      JOIN "modelos"   mo ON mo."id" = e."id_modelo"
      JOIN "colores"   c  ON c."id"  = e."id_color"
      JOIN "tallas"    t  ON t."id"  = e."id_talla"
      JOIN "almacenes" a  ON a."id"  = e."id_almacen"
      LEFT JOIN "ordenes" o ON o."id" = e."id_orden"
      WHERE ${where}
      -- QUÉ renglones caben: los de más piezas (en más o en menos). El desempate por la llave
      -- completa de la vista hace el corte DETERMINISTA (dos llamadas iguales, mismos renglones).
      ORDER BY abs(e."existencia") DESC,
               e."id_modelo" ASC, e."id_color" ASC, e."id_talla" ASC,
               e."id_almacen" ASC, e."id_orden" ASC NULLS FIRST
      LIMIT ${filtros.limite}
    ) pagina
    -- CÓMO se leen: el orden de presentación de siempre (el de antes de la fila 0.143).
    ORDER BY pagina."modelo" ASC, pagina."color" ASC, pagina."ordenTalla" ASC,
             pagina."almacen" ASC, pagina."folioOrden" ASC NULLS FIRST
  `);

  // Del UNIVERSO, no del pedazo. Sin renglones no hay ventana que leer: el filtro no casó con nada,
  // así que los dos totales son cero de verdad (el `LIMIT` es ≥ 1, no puede vaciar una página sola).
  const totalFilas = filas.length === 0 ? 0 : Number(filas[0]?.totalFilas ?? 0);
  const totalExistencia = filas.length === 0 ? 0 : Number(filas[0]?.totalUniverso ?? 0);
  const encabezado = {
    totalFilas,
    limite: filtros.limite,
    truncado: totalFilas > filas.length,
  };

  const filasSalida = filas.map((f) => {
    const existencia = Number(f.existencia);
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
    return { filas: filasSalida, totalExistencia, ...encabezado };
  }

  // Rollup color×talla (rediseño R9, matriz del cajón de Modelos): la MISMA `WHERE` del listado,
  // agrupada en SERVIDOR (A1) — la existencia de cada celda ya viene sumada a través de
  // almacenes/órdenes; el cliente solo pinta (no pivota).
  //
  // ⚠️ SIN `LIMIT`, y a propósito (fila 0.143): esto NO es la lista recortada, es un agregado del
  // universo entero. Si se le pusiera el tope, la matriz del cajón empezaría a mentir en cuanto
  // `filas` viniera cortada. Su tamaño está acotado por otro lado: `agrupar=color-talla` exige
  // `idModelo`, así que son las celdas color×talla de UN modelo.
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
    ...encabezado,
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
 * se aplica la ventana por omisión de {@link resolverVentanaKardex}. Pero recortar por fecha, a
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

  const ventana = resolverVentanaKardex(filtros);
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

  // Los `limite` MÁS NUEVOS, devueltos en orden cronológico.
  const { enPeriodo, truncado } = recortarPorLaCola(detalles, filtros.limite);

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
