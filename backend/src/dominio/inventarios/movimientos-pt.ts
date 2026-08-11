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

import { registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  bloquearArticuloPt,
  cancelarMovimientoPt as cancelarMovimientoPtMotor,
  existenciaPtBloqueada,
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
          // El nº de orden vieja se captura por color y se replica a sus tallas.
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
    // §Post-F9.25 — de qué orden VIEJA salieron estas prendas (solo consulta).
    numOrdenV1: c.numOrdenV1 ?? null,
  }));
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
 * la existencia negativa (D3). Toma `bloquearArticuloPt` + `existenciaPtBloqueada` por cada artículo
 * DENTRO de la transacción (concurrencia: dos salidas del mismo artículo no se cuelan entre la
 * lectura y la escritura — base de "no entregar lo que no existe"). Suma directa de `MovimientoDetPt`,
 * NUNCA la vista (ADR-0010 §3).
 */
async function validarNoNegativo(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  idModelo: number,
  celdas: Celda[],
): Promise<void> {
  // Toma los locks en un orden DETERMINISTA (por color, luego talla) para que dos operaciones que
  // compitan por los mismos artículos los adquieran SIEMPRE en el mismo orden: elimina el riesgo
  // teórico de deadlock entre dos traspasos cruzados. No copia/ordena `celdas` (caller la usa luego).
  // Los movimientos manuales / traspasos NO tienen orden (F6-E2 "PT por orden"): validan contra el
  // bucket "sin orden" (`idOrden = null`), igual que el histórico.
  const ordenadas = [...celdas].sort((a, b) => a.idColor - b.idColor || a.idTalla - b.idTalla);
  for (const c of ordenadas) {
    await bloquearArticuloPt(tx, idEmpresa, idAlmacen, idModelo, c.idColor, c.idTalla, null);
    const existencia = await existenciaPtBloqueada(
      tx,
      idEmpresa,
      idAlmacen,
      idModelo,
      c.idColor,
      c.idTalla,
      null,
    );
    if (existencia - c.cantidad < 0) {
      throw new ErrorConflicto(
        `No hay existencia suficiente: se intenta sacar ${c.cantidad} pza(s) de un artículo con ` +
          `${existencia} en existencia (no se permite dejar el inventario en negativo).`,
      );
    }
  }
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
    },
  },
} satisfies Prisma.MovimientoInclude;

type MovimientoConDetalle = Prisma.MovimientoGetPayload<{ include: typeof incluirMovimiento }>;

/** Proyecta un movimiento (con detalle) a la forma JSON del contrato. El total se DERIVA por suma. */
function aMovimientoSalida(m: MovimientoConDetalle): MovimientoPtSalida {
  // Agrupa el detalle por color, ordenando las tallas por su `orden` del catálogo.
  const porColor = new Map<number, { color: string; tallas: MovimientoConDetalle['detallesPt'] }>();
  let codigoModelo = '';
  for (const det of m.detallesPt) {
    codigoModelo = det.modelo.codigo;
    const grupo = porColor.get(det.idColor) ?? { color: det.color.nombre, tallas: [] };
    grupo.tallas.push(det);
    porColor.set(det.idColor, grupo);
  }

  let totalPiezas = 0;
  const lineas = [...porColor.entries()].map(([idColor, grupo]) => {
    let totalLinea = 0;
    const tallas = grupo.tallas
      .slice()
      .sort((a, b) => a.talla.orden - b.talla.orden || a.idTalla - b.idTalla)
      .map((t) => {
        totalLinea += t.cantidad;
        return { idTalla: t.idTalla, etiquetaTalla: t.talla.etiqueta, cantidad: t.cantidad };
      });
    totalPiezas += totalLinea;
    return { idColor, color: grupo.color, tallas, totalPiezas: totalLinea };
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

    const celdas = aplanarYValidar(datos.lineas);

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
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
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
    const celdas = aplanarYValidar(datos.lineas);

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
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
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

/** Forma de DOMINIO de los filtros del kardex por modelo (ya coaccionados). */
const esquemaConsultaKardexPt = z.object({
  idModelo: z.number().int().positive(),
  idColor: z.number().int().positive().optional(),
  idTalla: z.number().int().positive().optional(),
  idAlmacen: z.number().int().positive().optional(),
  idOrden: z.number().int().positive().optional(),
});

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
 * modelo, con SALDO CORRIDO (running total) por artículo. Opcionalmente filtra color/talla/almacén.
 * Lee `MovimientoDetPt` DIRECTO (sin la vista — la vista no preserva el orden cronológico). El saldo
 * corrido se calcula EN MEMORIA por artículo (idColor:idTalla:idAlmacen) en orden (folio asc): un
 * artículo concreto es lo único que comparte saldo; el saldo de cada renglón es el del artículo de
 * ESE renglón tras aplicar su efecto. Los movimientos cancelados se MARCAN pero su inverso ya
 * neutraliza el saldo (ambos aparecen en el kardex). Permiso `inventario-pt.ver` (A4); empresa activa
 * (A9).
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

  const detalles = await cliente.movimientoDetPt.findMany({
    where: {
      idModelo: filtros.idModelo,
      ...(filtros.idColor === undefined ? {} : { idColor: filtros.idColor }),
      ...(filtros.idTalla === undefined ? {} : { idTalla: filtros.idTalla }),
      ...(filtros.idOrden === undefined ? {} : { idOrden: filtros.idOrden }),
      movimiento: {
        idEmpresa,
        ...(filtros.idAlmacen === undefined ? {} : { idAlmacen: filtros.idAlmacen }),
      },
    },
    select: {
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
    // Orden cronológico estable: por folio (secuencia atómica por empresa, A3), luego por id de
    // detalle para desempatar renglones del mismo movimiento.
    orderBy: [{ movimiento: { folio: 'asc' } }, { id: 'asc' }],
  });

  // Saldo corrido por artículo (color:talla:almacén): el efecto se aplica por la dirección.
  const saldoPorArticulo = new Map<string, number>();
  const renglones: KardexPtRenglon[] = detalles.map((d) => {
    const m = d.movimiento;
    const esEntrada = m.tipoMov.direccion === DireccionMovimiento.entrada;
    const esSalida = m.tipoMov.direccion === DireccionMovimiento.salida;
    const entrada = esEntrada ? d.cantidad : 0;
    const salida = esSalida ? d.cantidad : 0;

    // PT por orden (F6-E2): el saldo corrido es por artículo×ALMACÉN×ORDEN (el bucket "sin orden"
    // —`id_orden` NULL— lleva su propio saldo, separado de las prendas con orden).
    const claveArt = `${d.idColor}:${d.idTalla}:${m.idAlmacen}:${d.idOrden ?? 'sin'}`;
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

  return { idModelo: modelo.id, modelo: modelo.codigo, renglones };
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
