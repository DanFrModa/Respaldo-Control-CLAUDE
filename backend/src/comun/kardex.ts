/**
 * Motor de KARDEX único (F3-E1, ADR-0010; D3 — PLANMAESTRO §4).
 *
 * La existencia NUNCA se edita: es la SUMA de los movimientos (D3). Este módulo es el ÚNICO
 * lugar que escribe en `Movimiento`/`MovimientoDet*` y la base de "no entregar lo que no existe"
 * (E5) y "no recibir lo no enviado" (E4). Es GENÉRICO para PT/tela/avío (un encabezado
 * `Movimiento` + un detalle por tipo de artículo, ADR-0010 §2), pero en F3 solo se ejercita la
 * dimensión PT (modelo×color×talla, D4). El motor vive en `comun/` (A1): la orquestación de
 * negocio (qué tipo de movimiento, contra qué orden, validaciones de pendientes) va en
 * `dominio/`; las rutas REST son delgadas.
 *
 * Garantías:
 *  • A2 — encabezado + detalle + bitácora en UNA transacción (o todo o nada). El traspaso son
 *    DOS movimientos (salida origen + entrada destino) en la MISMA transacción.
 *  • A3 — folio por secuencia atómica (`siguienteFolio`, clave "movimiento"), NUNCA Max()+1.
 *  • A7 — `Bitacora` del movimiento dentro de la transacción.
 *  • D1/D2 — `costoUnit` queda NULL en toda F3 (la valuación llega en F7). El motor NO lo recibe.
 *  • D3/§3 del ADR — la lectura de existencia para VALIDAR sucede DENTRO de la transacción,
 *    sumando `MovimientoDet` DIRECTO bajo bloqueo (advisory lock por artículo×almacén), NUNCA la
 *    vista `existencia_pt` (que es solo para consulta/tableros).
 *  • Cancelación = movimiento INVERSO auditado (D3/A7), JAMÁS edición/borrado del original.
 */
import { DireccionMovimiento, type Movimiento, type Prisma } from '../datos/index.js';

import { registrarBitacora } from './auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from './errores.js';
import { ORIGEN, type OrigenMovimiento } from './origenes.js';
import type { SesionUsuario } from './permisos.js';
import { siguienteFolio } from './secuencias.js';
import { enTransaccion, type ContextoBd, type Tx } from './transaccion.js';

/** Clave de la secuencia de folios del kardex (A3, por empresa). */
const CLAVE_SECUENCIA_MOVIMIENTO = 'movimiento';

/**
 * Un renglón de detalle de PT de un movimiento (D4). `cantidad` SIEMPRE positiva (el signo lo da
 * la dirección del tipo de movimiento). `costoUnit` NO se acepta en F3 (queda NULL — D1/D2).
 */
export interface LineaMovimientoPt {
  idModelo: number;
  idColor: number;
  idTalla: number;
  /**
   * ORDEN de producción a la que PERTENECEN estas prendas (F6-E2 "PT por orden" — ADR-0014). La
   * existencia PT es por modelo×color×talla×ORDEN×almacén. NULL/ausente = bucket "sin orden"
   * (movimiento manual/traspaso/histórico). El dominio decide: recibo/entrega/reclasificación la
   * pasan; los movimientos manuales no.
   */
  idOrden?: number | null;
  /** Cantidad de prendas, entera y POSITIVA (≥1). El signo lo aplica el kardex por la dirección. */
  cantidad: number;
}

/**
 * Datos para registrar UN movimiento de PT (encabezado + detalle). El tipo de movimiento
 * (`idTipoMov`) determina la dirección (entrada/salida); el origen (`origenTipo`/`origenId`)
 * traza el hecho que lo generó (referencia polimórfica, ADR-0010 §1).
 */
export interface EntradaMovimientoPt {
  /** Empresa dueña del movimiento y de su folio (A9). */
  idEmpresa: number;
  /** Tipo de movimiento del catálogo `TipoMovimientoInventario` (define la dirección). */
  idTipoMov: number;
  /** Almacén afectado (D4: existencia por …×almacén). */
  idAlmacen: number;
  /** Fecha del movimiento (solo fecha). */
  fecha: Date;
  /** Discriminador del origen (de `ORIGEN`, nunca un literal — nit #4). */
  origenTipo: OrigenMovimiento;
  /** Id de la fila de origen (texto; cubre PKs Int/String). Opcional. */
  origenId?: string;
  /** Renglones color×talla del movimiento (al menos uno). */
  lineas: LineaMovimientoPt[];
  observaciones?: string;
}

/** Valida que las líneas existan, no se repitan vacías y traigan cantidades positivas enteras. */
function validarLineasPt(lineas: LineaMovimientoPt[]): void {
  if (lineas.length === 0) {
    throw new ErrorValidacion('Un movimiento de inventario necesita al menos un renglón.');
  }
  for (const linea of lineas) {
    if (!Number.isInteger(linea.cantidad) || linea.cantidad <= 0) {
      throw new ErrorValidacion(
        `La cantidad de un renglón de kardex debe ser un entero positivo (recibido: ${String(linea.cantidad)}).`,
      );
    }
  }
}

/** Lee la dirección del tipo de movimiento o lanza si no existe/está inactivo. */
async function direccionDelTipo(tx: Tx, idTipoMov: number): Promise<DireccionMovimiento> {
  const tipo = await tx.tipoMovimientoInventario.findUnique({
    where: { id: idTipoMov },
    select: { direccion: true, activo: true, nombre: true },
  });
  if (tipo === null) {
    throw new ErrorNoEncontrado('TipoMovimientoInventario', idTipoMov);
  }
  if (!tipo.activo) {
    throw new ErrorValidacion(`El tipo de movimiento "${tipo.nombre}" está desactivado.`);
  }
  return tipo.direccion;
}

/**
 * Bloqueo por artículo×almacén DENTRO de la transacción, para que dos salidas/entregas del MISMO
 * artículo no corran en paralelo y dejen existencia negativa (ADR-0010 §3; base de E4/E5). Se usa
 * un **advisory lock transaccional** (`pg_advisory_xact_lock`) con una llave derivada de
 * empresa+almacén+modelo+color+talla: el segundo en llegar espera al primero hasta su commit. El
 * lock se libera SOLO al terminar la transacción (no hay que soltarlo a mano).
 *
 * Se usa advisory lock y no `SELECT … FOR UPDATE` porque el detalle de kardex no tiene una fila
 * "ancla" por artículo (la existencia es una suma de N movimientos): no hay qué bloquear con FOR
 * UPDATE sin materializar un saldo (que D3 prohíbe).
 */
export async function bloquearArticuloPt(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  idModelo: number,
  idColor: number,
  idTalla: number,
  idOrden: number | null,
): Promise<void> {
  // Dos claves int4 estables a partir de las 6 dimensiones (pg_advisory_xact_lock(int4, int4)).
  // No precisa ser criptográfico ni libre de colisiones: una colisión (dos artículos×orden×almacén
  // distintos que caigan en la misma pareja de claves) solo hace que dos transacciones que NO
  // competían por el mismo saldo se serialicen de más (pierden algo de paralelismo) — NUNCA
  // afecta la correctitud (la suma de `existenciaPtBloqueada` se filtra por las 6 dimensiones
  // reales, no por la clave del lock). La ORDEN entra a la clave (F6-E2 "PT por orden"): dos
  // operaciones sobre el MISMO artículo pero ÓRDENES distintas ya no compiten por el mismo saldo,
  // así que no deben sobre-serializarse. `idOrden` NULL (bucket "sin orden") se mapea a 0.
  const clave1 = (idEmpresa * 1_000_003 + idAlmacen) | 0;
  const clave2 = (((idModelo * 1_000_003 + idColor) * 31 + idTalla) * 31 + (idOrden ?? 0)) | 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave1}::int, ${clave2}::int)`;
}

/**
 * Existencia ACTUAL de un artículo PT en un almacén, sumando `MovimientoDet` DIRECTO (NUNCA la
 * vista — ADR-0010 §3). Pensada para validar dentro de una transacción; tómala SIEMPRE después de
 * {@link bloquearArticuloPt} para que el cálculo sea consistente bajo concurrencia (E4/E5).
 *
 * El signo se aplica por la dirección del tipo de movimiento (entrada +, salida −; cualquier otra
 * cuenta 0, defensivo — los traspasos se materializan como dos patas entrada/salida, nit #1).
 */
export async function existenciaPtBloqueada(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  idModelo: number,
  idColor: number,
  idTalla: number,
  idOrden: number | null,
): Promise<number> {
  // La ORDEN entra a la dimensión de existencia (F6-E2 "PT por orden"): se compara con
  // `IS NOT DISTINCT FROM` para que el bucket "sin orden" (NULL) case consigo mismo (mismo patrón
  // que `id_lote` NULL en tela). Así una salida/entrega/reclasificación valida contra el saldo de
  // SU orden (o del bucket sin orden), no contra el total del modelo.
  const filas = await tx.$queryRaw<{ existencia: bigint | null }[]>`
    SELECT COALESCE(SUM(
      d."cantidad" * CASE t."direccion"
        WHEN 'entrada' THEN 1
        WHEN 'salida'  THEN -1
        ELSE 0
      END
    ), 0)::bigint AS existencia
    FROM "movimiento_det_pt" d
    JOIN "movimientos" m ON m."id" = d."id_movimiento"
    JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
    WHERE m."id_empresa" = ${idEmpresa}
      AND m."id_almacen" = ${idAlmacen}
      AND d."id_modelo" = ${idModelo}
      AND d."id_color" = ${idColor}
      AND d."id_talla" = ${idTalla}
      AND d."id_orden" IS NOT DISTINCT FROM ${idOrden}
  `;
  return Number(filas[0]?.existencia ?? 0n);
}

/**
 * Registra UN movimiento de PT (encabezado + detalle + bitácora) en UNA transacción (A2), con
 * folio atómico (A3). Es el primitivo que usan los servicios de dominio (movimiento manual de
 * E3, entrada del recibo de E4, salida de la entrega de E5). NO valida pendientes ni existencia:
 * esa lógica de negocio vive en `dominio/` (el motor solo escribe correcto y consistente).
 *
 * `costoUnit` se deja NULL (D1/D2 — F7): por eso no se recibe.
 *
 * @returns el `Movimiento` creado (encabezado).
 */
export async function registrarMovimientoPt(
  sesion: SesionUsuario,
  entrada: EntradaMovimientoPt,
  bd?: ContextoBd,
): Promise<Movimiento> {
  validarLineasPt(entrada.lineas);
  return enTransaccion(async (tx) => {
    // Valida tipo activo y RECHAZA la dirección `traspaso` (nit del reviewer): un movimiento
    // simple con un tipo de dirección `traspaso` contaría 0 en la vista y en
    // `existenciaPtBloqueada` (`ELSE 0`) → existencia perdida en silencio. Los traspasos van por
    // `registrarTraspasoPt` (dos patas salida/entrada). Las patas de un traspaso entran aquí con
    // dirección `salida`/`entrada` (ya validadas en `registrarTraspasoPt`), así que pasan.
    const direccion = await direccionDelTipo(tx, entrada.idTipoMov);
    if (direccion === DireccionMovimiento.traspaso) {
      throw new ErrorValidacion(
        'Un tipo de movimiento de dirección "traspaso" no se registra como movimiento simple: usa registrarTraspasoPt (salida de origen + entrada de destino).',
      );
    }
    const folio = await siguienteFolio(tx, entrada.idEmpresa, CLAVE_SECUENCIA_MOVIMIENTO);

    const movimiento = await tx.movimiento.create({
      data: {
        folio,
        idEmpresa: entrada.idEmpresa,
        idTipoMov: entrada.idTipoMov,
        idAlmacen: entrada.idAlmacen,
        fecha: entrada.fecha,
        origenTipo: entrada.origenTipo,
        ...(entrada.origenId === undefined ? {} : { origenId: entrada.origenId }),
        idUsuario: sesion.id,
        ...(entrada.observaciones === undefined ? {} : { observaciones: entrada.observaciones }),
        // costoUnit NULL en F3 (D1/D2): no se setea ningún costo.
        detallesPt: {
          create: entrada.lineas.map((linea) => ({
            idModelo: linea.idModelo,
            idColor: linea.idColor,
            idTalla: linea.idTalla,
            idOrden: linea.idOrden ?? null,
            cantidad: linea.cantidad,
          })),
        },
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Movimiento',
      idEntidad: movimiento.id,
      accion: 'CREAR',
      datos: {
        folio: folio.toString(),
        idTipoMov: entrada.idTipoMov,
        idAlmacen: entrada.idAlmacen,
        origenTipo: entrada.origenTipo,
        renglones: entrada.lineas.length,
      },
    });

    return movimiento;
  }, bd);
}

/** Datos de un traspaso de PT entre dos almacenes de la misma empresa. */
export interface EntradaTraspasoPt {
  idEmpresa: number;
  /** Tipo de movimiento de SALIDA (dirección `salida`) para la pata de origen. */
  idTipoMovSalida: number;
  /** Tipo de movimiento de ENTRADA (dirección `entrada`) para la pata de destino. */
  idTipoMovEntrada: number;
  idAlmacenOrigen: number;
  idAlmacenDestino: number;
  fecha: Date;
  lineas: LineaMovimientoPt[];
  observaciones?: string;
}

/**
 * Traspaso de PT entre almacenes (nit #1 / ADR-0010 §1): se materializa como DOS `Movimiento` —
 * una SALIDA del almacén origen y una ENTRADA al almacén destino— en LA MISMA transacción (A2:
 * si una falla, no queda ninguna). Así la existencia TOTAL no cambia (la cantidad pasa de origen
 * a destino) y la vista nunca ve una dirección `traspaso` con signo plano. Cada pata lleva su
 * folio propio y `origenTipo = traspaso`; se enlazan informativamente por el `origenId` (el id
 * de la pata de salida).
 *
 * TODO (F3-E3 — "no traspasar más de lo que hay"): cuando E3 agregue la validación de existencia,
 * debe tomar `bloquearArticuloPt` + `existenciaPtBloqueada` sobre el almacén ORIGEN (por cada
 * artículo) ANTES de crear la pata de salida, dentro de esta misma transacción (igual que el
 * recibo de E4 y la entrega de E5). En F3-E1 aún NO se valida existencia, por eso el traspaso no
 * toma todavía el lock; el hueco se cierra en E3 sin tocar el núcleo de este motor.
 *
 * @returns `{ salida, entrada }` con los dos movimientos creados.
 */
export async function registrarTraspasoPt(
  sesion: SesionUsuario,
  entrada: EntradaTraspasoPt,
  bd?: ContextoBd,
): Promise<{ salida: Movimiento; entrada: Movimiento }> {
  if (entrada.idAlmacenOrigen === entrada.idAlmacenDestino) {
    throw new ErrorValidacion(
      'El traspaso necesita un almacén de origen y otro de destino distintos.',
    );
  }
  validarLineasPt(entrada.lineas);

  return enTransaccion(async (tx) => {
    if ((await direccionDelTipo(tx, entrada.idTipoMovSalida)) !== DireccionMovimiento.salida) {
      throw new ErrorValidacion(
        'El tipo de la pata de salida del traspaso debe ser de dirección "salida".',
      );
    }
    if ((await direccionDelTipo(tx, entrada.idTipoMovEntrada)) !== DireccionMovimiento.entrada) {
      throw new ErrorValidacion(
        'El tipo de la pata de entrada del traspaso debe ser de dirección "entrada".',
      );
    }

    const salida = await registrarMovimientoPt(
      sesion,
      {
        idEmpresa: entrada.idEmpresa,
        idTipoMov: entrada.idTipoMovSalida,
        idAlmacen: entrada.idAlmacenOrigen,
        fecha: entrada.fecha,
        origenTipo: ORIGEN.traspaso,
        lineas: entrada.lineas,
        ...(entrada.observaciones === undefined ? {} : { observaciones: entrada.observaciones }),
      },
      { tx },
    );

    const entradaMov = await registrarMovimientoPt(
      sesion,
      {
        idEmpresa: entrada.idEmpresa,
        idTipoMov: entrada.idTipoMovEntrada,
        idAlmacen: entrada.idAlmacenDestino,
        fecha: entrada.fecha,
        origenTipo: ORIGEN.traspaso,
        origenId: String(salida.id), // enlaza la entrada con su pata de salida (informativo)
        lineas: entrada.lineas,
        ...(entrada.observaciones === undefined ? {} : { observaciones: entrada.observaciones }),
      },
      { tx },
    );

    return { salida, entrada: entradaMov };
  }, bd);
}

/**
 * CANCELA un movimiento de PT generando su INVERSO auditado (D3/A7): NUNCA se edita ni se borra el
 * original. El inverso copia el detalle del original con un tipo de movimiento de dirección OPUESTA
 * (lo provee el llamador: el dominio sabe qué tipo "Error de Entrada/Salida"/inverso usar) y queda
 * enlazado al original por `idMovimientoInverso`. Un movimiento ya anulado no se puede volver a
 * anular (`ErrorConflicto`).
 *
 * @param idMovimiento   movimiento original a anular.
 * @param idTipoMovInverso tipo de movimiento (dirección opuesta) para el inverso.
 * @returns el movimiento INVERSO creado.
 */
export async function cancelarMovimientoPt(
  sesion: SesionUsuario,
  idMovimiento: number,
  idTipoMovInverso: number,
  bd?: ContextoBd,
): Promise<Movimiento> {
  return enTransaccion(async (tx) => {
    const original = await tx.movimiento.findUnique({
      where: { id: idMovimiento },
      include: { detallesPt: true, anuladoPor: { select: { id: true } } },
    });
    if (original === null) {
      throw new ErrorNoEncontrado('Movimiento', idMovimiento);
    }
    if (original.anuladoPor.length > 0) {
      throw new ErrorConflicto('Ese movimiento ya fue cancelado (tiene un movimiento inverso).');
    }
    if (original.detallesPt.length === 0) {
      throw new ErrorValidacion('Solo se pueden cancelar movimientos de producto terminado en F3.');
    }

    const direccionInversa = await direccionDelTipo(tx, idTipoMovInverso);
    const direccionOriginal = await direccionDelTipo(tx, original.idTipoMov);
    // El inverso debe oponerse al original (entrada↔salida); evita "cancelar" sin neutralizar.
    const opuestas =
      (direccionOriginal === DireccionMovimiento.entrada &&
        direccionInversa === DireccionMovimiento.salida) ||
      (direccionOriginal === DireccionMovimiento.salida &&
        direccionInversa === DireccionMovimiento.entrada);
    if (!opuestas) {
      throw new ErrorValidacion(
        'El tipo de movimiento inverso debe tener la dirección OPUESTA a la del movimiento original.',
      );
    }

    const folio = await siguienteFolio(tx, original.idEmpresa, CLAVE_SECUENCIA_MOVIMIENTO);
    const inverso = await tx.movimiento.create({
      data: {
        folio,
        idEmpresa: original.idEmpresa,
        idTipoMov: idTipoMovInverso,
        idAlmacen: original.idAlmacen,
        fecha: new Date(),
        origenTipo: ORIGEN.cancelacion,
        origenId: String(original.id),
        idUsuario: sesion.id,
        idMovimientoInverso: original.id,
        detallesPt: {
          create: original.detallesPt.map((det) => ({
            idModelo: det.idModelo,
            idColor: det.idColor,
            idTalla: det.idTalla,
            // El inverso hereda la ORDEN del renglón original (F6-E2 "PT por orden"): así neutraliza
            // el MISMO bucket de orden y la existencia por orden no queda descuadrada.
            idOrden: det.idOrden,
            cantidad: det.cantidad,
          })),
        },
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Movimiento',
      idEntidad: original.id,
      accion: 'CANCELAR',
      datos: { folioInverso: folio.toString(), idMovimientoInverso: inverso.id },
    });

    return inverso;
  }, bd);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DIMENSIÓN TELA (tela × lote, D5) — F4-E1
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Mismo motor genérico que PT (un encabezado `Movimiento` + un detalle por tipo de artículo,
// ADR-0010 §2), ahora ejercitando `MovimientoDetTela`. Diferencias con PT:
//  • La dimensión es tela × LOTE (D5: el lote define el teñido/color y agrupa N telas
//    acompañantes); la existencia es por tela×lote×almacén.
//  • `cantidad` es Decimal (telas se miden en kg/m): se pasa como `number` y la columna Decimal la
//    guarda. La suma directa bajo lock se hace con SQL numérico (no bigint como en PT).
//  • `costoUnit` SÍ se acepta (D1: la entrada-recepción valuará con el costo por unidad de consumo
//    ya convertido — E3). En un ajuste/salida puede ir NULL.
//  • El advisory lock es por empresa+almacén+tela+lote (NULL→0 para la clave; una colisión solo
//    serializa de más, nunca afecta la correctitud — la suma se filtra por las dimensiones reales).

/**
 * Un renglón de detalle de TELA de un movimiento (D5). `cantidad` SIEMPRE positiva (el signo lo da
 * la dirección del tipo). `costoUnit` opcional (valuación en E3). `idLote` opcional a nivel motor
 * (el dominio de telas lo exige; un ajuste sin lote puede no traerlo).
 */
export interface LineaMovimientoTela {
  idTela: number;
  /** Lote de la tela (D5, flujo VIEJO). Opcional a nivel motor; el dominio de lotes lo requiere. */
  idLote?: number | null;
  /**
   * Color de tela (hijo de la tela) del flujo NUEVO por color (etapa A2). Si viene, el renglón es
   * del inventario nuevo: `cantidad` = CUERPO (admite 0) y `cantidadComplemento` viaja junta.
   */
  idTelaColor?: number | null;
  /** Partida de la ENTRADA (traza, flujo nuevo). NULL en salidas: el consumo empareja por color. */
  idPartida?: number | null;
  /**
   * Cantidad de tela, POSITIVA. El signo lo aplica el kardex por la dirección. En el flujo NUEVO
   * por color es el CUERPO y admite 0 (entrada de solo complemento) siempre que
   * `cantidadComplemento` sea > 0.
   */
  cantidad: number;
  /** Cantidad del COMPLEMENTO (cardigan) del flujo nuevo. NULL si la tela no lleva complemento. */
  cantidadComplemento?: number | null;
  /** Costo unitario (por unidad de consumo) al momento del movimiento. NULL si no aplica (D1). */
  costoUnit?: number | null;
}

/** Datos para registrar UN movimiento de TELA (encabezado + detalle). Análogo a {@link EntradaMovimientoPt}. */
export interface EntradaMovimientoTela {
  idEmpresa: number;
  idTipoMov: number;
  idAlmacen: number;
  fecha: Date;
  origenTipo: OrigenMovimiento;
  origenId?: string;
  lineas: LineaMovimientoTela[];
  observaciones?: string;
}

/**
 * Valida líneas de tela: al menos una y cantidades finitas. El flujo VIEJO por lote conserva su
 * regla (`cantidad > 0`); el flujo NUEVO por color (`idTelaColor` presente) acepta cuerpo 0 o
 * complemento 0, pero exige que AL MENOS UNO sea > 0 y que ninguno sea negativo (Daniel: cuerpo y
 * complemento viajan JUNTOS en el mismo renglón; comprar solo complemento = cuerpo en 0).
 */
function validarLineasTela(lineas: LineaMovimientoTela[]): void {
  if (lineas.length === 0) {
    throw new ErrorValidacion('Un movimiento de inventario de tela necesita al menos un renglón.');
  }
  for (const linea of lineas) {
    const esFlujoColor = linea.idTelaColor !== undefined && linea.idTelaColor !== null;
    if (!esFlujoColor) {
      if (!Number.isFinite(linea.cantidad) || linea.cantidad <= 0) {
        throw new ErrorValidacion(
          `La cantidad de un renglón de kardex de tela debe ser un número positivo (recibido: ${String(linea.cantidad)}).`,
        );
      }
      continue;
    }
    const cuerpo = linea.cantidad;
    const complemento = linea.cantidadComplemento ?? 0;
    if (!Number.isFinite(cuerpo) || cuerpo < 0) {
      throw new ErrorValidacion(
        `La cantidad de cuerpo de un renglón por color debe ser un número ≥ 0 (recibido: ${String(cuerpo)}).`,
      );
    }
    if (!Number.isFinite(complemento) || complemento < 0) {
      throw new ErrorValidacion(
        `La cantidad de complemento de un renglón por color debe ser un número ≥ 0 (recibido: ${String(linea.cantidadComplemento)}).`,
      );
    }
    if (cuerpo === 0 && complemento === 0) {
      throw new ErrorValidacion(
        'Un renglón por color necesita cantidad de cuerpo o de complemento mayor que 0.',
      );
    }
  }
}

/**
 * Bloqueo por tela×lote×almacén DENTRO de la transacción (advisory lock transaccional), para que dos
 * salidas/traspasos de la MISMA tela/lote no corran en paralelo y dejen existencia negativa
 * (ADR-0010 §3). Mismo criterio que {@link bloquearArticuloPt}: la clave no precisa ser libre de
 * colisiones (una colisión solo serializa de más). `idLote` NULL se mapea a 0 para la clave.
 */
export async function bloquearTela(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  idTela: number,
  idLote: number | null,
): Promise<void> {
  const clave1 = (idEmpresa * 1_000_003 + idAlmacen) | 0;
  const clave2 = (idTela * 1_000_003 + (idLote ?? 0)) | 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave1}::int, ${clave2}::int)`;
}

/**
 * Bloqueo por COLOR de tela × almacén DENTRO de la transacción (flujo NUEVO, etapa A2): dos
 * salidas/traspasos del MISMO tela-color no corren en paralelo y dejan existencia negativa
 * (ADR-0010 §3). La clave2 se deriva del `idTelaColor` con un multiplicador distinto al del flujo
 * por lote para no colisionar sistemáticamente con {@link bloquearTela} (una colisión solo
 * serializa de más, nunca afecta la correctitud).
 */
export async function bloquearTelaColor(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  idTelaColor: number,
): Promise<void> {
  const clave1 = (idEmpresa * 1_000_003 + idAlmacen) | 0;
  const clave2 = (idTelaColor * 1_000_033 + 7) | 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave1}::int, ${clave2}::int)`;
}

/** Existencia (cuerpo + complemento) de un color de tela en un almacén, por suma DIRECTA. */
export interface ExistenciaTelaColor {
  /** Existencia del CUERPO (Σ de `cantidad` con signo). */
  cuerpo: number;
  /** Existencia del COMPLEMENTO (Σ de `cantidad_complemento` con signo; 0 si nunca hubo). */
  complemento: number;
}

/**
 * Existencia ACTUAL de un tela-color en un almacén — AMBOS componentes (cuerpo y complemento) —
 * sumando `movimiento_det_tela` DIRECTO (NUNCA la vista `existencia_tela_color` — ADR-0010 §3).
 * Tómala SIEMPRE tras {@link bloquearTelaColor}: es la base de la validación de no-negativo de
 * los DOS componentes en salidas/traspasos del flujo nuevo (D3).
 */
export async function existenciaTelaColorBloqueada(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  idTelaColor: number,
): Promise<ExistenciaTelaColor> {
  const filas = await tx.$queryRaw<
    { cuerpo: Prisma.Decimal | null; complemento: Prisma.Decimal | null }[]
  >`
    SELECT
      COALESCE(SUM(
        d."cantidad" * CASE t."direccion"
          WHEN 'entrada' THEN 1
          WHEN 'salida'  THEN -1
          ELSE 0
        END
      ), 0) AS cuerpo,
      COALESCE(SUM(
        COALESCE(d."cantidad_complemento", 0) * CASE t."direccion"
          WHEN 'entrada' THEN 1
          WHEN 'salida'  THEN -1
          ELSE 0
        END
      ), 0) AS complemento
    FROM "movimiento_det_tela" d
    JOIN "movimientos" m ON m."id" = d."id_movimiento"
    JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
    WHERE m."id_empresa" = ${idEmpresa}
      AND m."id_almacen" = ${idAlmacen}
      AND d."id_tela_color" = ${idTelaColor}
  `;
  return {
    cuerpo: Number(filas[0]?.cuerpo ?? 0),
    complemento: Number(filas[0]?.complemento ?? 0),
  };
}

/**
 * Existencia ACTUAL de una tela/lote en un almacén, sumando `movimiento_det_tela` DIRECTO (NUNCA la
 * vista — ADR-0010 §3). Decimal: se devuelve `number`. Tómala SIEMPRE tras {@link bloquearTela}.
 * El `idLote` NULL se compara con `IS NOT DISTINCT FROM` para que el ajuste sin lote case consigo
 * mismo. EXCLUYE los renglones del flujo NUEVO por color (etapa A2, `id_tela_color` poblado):
 * también traen `id_lote` NULL y sin el filtro contaminarían la suma del flujo legado.
 */
export async function existenciaTelaBloqueada(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  idTela: number,
  idLote: number | null,
): Promise<number> {
  const filas = await tx.$queryRaw<{ existencia: Prisma.Decimal | null }[]>`
    SELECT COALESCE(SUM(
      d."cantidad" * CASE t."direccion"
        WHEN 'entrada' THEN 1
        WHEN 'salida'  THEN -1
        ELSE 0
      END
    ), 0) AS existencia
    FROM "movimiento_det_tela" d
    JOIN "movimientos" m ON m."id" = d."id_movimiento"
    JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
    WHERE m."id_empresa" = ${idEmpresa}
      AND m."id_almacen" = ${idAlmacen}
      AND d."id_tela" = ${idTela}
      AND d."id_lote" IS NOT DISTINCT FROM ${idLote}
      AND d."id_tela_color" IS NULL
  `;
  return Number(filas[0]?.existencia ?? 0);
}

/**
 * Registra UN movimiento de TELA (encabezado + detalle + bitácora) en UNA transacción (A2), con
 * folio atómico (A3). Primitivo de los servicios de dominio de telas (ajuste/salida-a-orden de E1,
 * entrada-recepción de E3). NO valida existencia: esa lógica vive en `dominio/` (el motor solo
 * escribe correcto). RECHAZA la dirección `traspaso` (va por {@link registrarTraspasoTela}).
 */
export async function registrarMovimientoTela(
  sesion: SesionUsuario,
  entrada: EntradaMovimientoTela,
  bd?: ContextoBd,
): Promise<Movimiento> {
  validarLineasTela(entrada.lineas);
  return enTransaccion(async (tx) => {
    const direccion = await direccionDelTipo(tx, entrada.idTipoMov);
    if (direccion === DireccionMovimiento.traspaso) {
      throw new ErrorValidacion(
        'Un tipo de movimiento de dirección "traspaso" no se registra como movimiento simple: usa registrarTraspasoTela (salida de origen + entrada de destino).',
      );
    }
    const folio = await siguienteFolio(tx, entrada.idEmpresa, CLAVE_SECUENCIA_MOVIMIENTO);

    const movimiento = await tx.movimiento.create({
      data: {
        folio,
        idEmpresa: entrada.idEmpresa,
        idTipoMov: entrada.idTipoMov,
        idAlmacen: entrada.idAlmacen,
        fecha: entrada.fecha,
        origenTipo: entrada.origenTipo,
        ...(entrada.origenId === undefined ? {} : { origenId: entrada.origenId }),
        idUsuario: sesion.id,
        ...(entrada.observaciones === undefined ? {} : { observaciones: entrada.observaciones }),
        detallesTela: {
          create: entrada.lineas.map((linea) => ({
            idTela: linea.idTela,
            idLote: linea.idLote ?? null,
            idTelaColor: linea.idTelaColor ?? null,
            idPartida: linea.idPartida ?? null,
            cantidad: linea.cantidad,
            cantidadComplemento: linea.cantidadComplemento ?? null,
            costoUnit: linea.costoUnit ?? null,
          })),
        },
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Movimiento',
      idEntidad: movimiento.id,
      accion: 'CREAR',
      datos: {
        folio: folio.toString(),
        dimension: 'tela',
        idTipoMov: entrada.idTipoMov,
        idAlmacen: entrada.idAlmacen,
        origenTipo: entrada.origenTipo,
        renglones: entrada.lineas.length,
      },
    });

    return movimiento;
  }, bd);
}

/** Datos de un traspaso de TELA entre dos almacenes de la misma empresa. */
export interface EntradaTraspasoTela {
  idEmpresa: number;
  idTipoMovSalida: number;
  idTipoMovEntrada: number;
  idAlmacenOrigen: number;
  idAlmacenDestino: number;
  fecha: Date;
  lineas: LineaMovimientoTela[];
  observaciones?: string;
}

/**
 * Traspaso de TELA entre almacenes: DOS `Movimiento` (salida del origen + entrada al destino) en LA
 * MISMA transacción (A2). Análogo a {@link registrarTraspasoPt}. La validación de existencia del
 * origen (no dejar negativo) la hace el dominio bajo lock ANTES de llamar aquí (suma directa).
 */
export async function registrarTraspasoTela(
  sesion: SesionUsuario,
  entrada: EntradaTraspasoTela,
  bd?: ContextoBd,
): Promise<{ salida: Movimiento; entrada: Movimiento }> {
  if (entrada.idAlmacenOrigen === entrada.idAlmacenDestino) {
    throw new ErrorValidacion(
      'El traspaso necesita un almacén de origen y otro de destino distintos.',
    );
  }
  validarLineasTela(entrada.lineas);

  return enTransaccion(async (tx) => {
    if ((await direccionDelTipo(tx, entrada.idTipoMovSalida)) !== DireccionMovimiento.salida) {
      throw new ErrorValidacion(
        'El tipo de la pata de salida del traspaso debe ser de dirección "salida".',
      );
    }
    if ((await direccionDelTipo(tx, entrada.idTipoMovEntrada)) !== DireccionMovimiento.entrada) {
      throw new ErrorValidacion(
        'El tipo de la pata de entrada del traspaso debe ser de dirección "entrada".',
      );
    }

    const salida = await registrarMovimientoTela(
      sesion,
      {
        idEmpresa: entrada.idEmpresa,
        idTipoMov: entrada.idTipoMovSalida,
        idAlmacen: entrada.idAlmacenOrigen,
        fecha: entrada.fecha,
        origenTipo: ORIGEN.traspaso,
        lineas: entrada.lineas,
        ...(entrada.observaciones === undefined ? {} : { observaciones: entrada.observaciones }),
      },
      { tx },
    );

    const entradaMov = await registrarMovimientoTela(
      sesion,
      {
        idEmpresa: entrada.idEmpresa,
        idTipoMov: entrada.idTipoMovEntrada,
        idAlmacen: entrada.idAlmacenDestino,
        fecha: entrada.fecha,
        origenTipo: ORIGEN.traspaso,
        origenId: String(salida.id),
        lineas: entrada.lineas,
        ...(entrada.observaciones === undefined ? {} : { observaciones: entrada.observaciones }),
      },
      { tx },
    );

    return { salida, entrada: entradaMov };
  }, bd);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DIMENSIÓN AVÍO (avío × lote opcional, R4) — F4-E1
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Igual que tela pero la dimensión operativa es avío × almacén (R4: inventario de avíos
// multi-almacén). El lote del avío es opcional y NO entra en la dimensión de existencia (la vista
// `existencia_avio` agrega por avío×almacén); el lock y la suma son por avío×almacén. `esGenerico`
// se copia de `Avio.esGenerico` (R4) para consultas de kardex sin join.

/** Un renglón de detalle de AVÍO de un movimiento (R4). `cantidad` POSITIVA; `costoUnit` opcional. */
export interface LineaMovimientoAvio {
  idAvio: number;
  /** Lote del avío (opcional, R4). No entra en la dimensión de existencia (avío×almacén). */
  idLote?: number | null;
  /** Avío genérico de stock (copiado de `Avio.esGenerico` para consultas sin join). */
  esGenerico?: boolean;
  /** Cantidad de avío, POSITIVA (> 0). */
  cantidad: number;
  /** Costo unitario al momento del movimiento. NULL si no aplica (D1). */
  costoUnit?: number | null;
}

/** Datos para registrar UN movimiento de AVÍO (encabezado + detalle). */
export interface EntradaMovimientoAvio {
  idEmpresa: number;
  idTipoMov: number;
  idAlmacen: number;
  fecha: Date;
  origenTipo: OrigenMovimiento;
  origenId?: string;
  lineas: LineaMovimientoAvio[];
  observaciones?: string;
}

/** Valida líneas de avío: al menos una, cantidades finitas y positivas. */
function validarLineasAvio(lineas: LineaMovimientoAvio[]): void {
  if (lineas.length === 0) {
    throw new ErrorValidacion('Un movimiento de inventario de avío necesita al menos un renglón.');
  }
  for (const linea of lineas) {
    if (!Number.isFinite(linea.cantidad) || linea.cantidad <= 0) {
      throw new ErrorValidacion(
        `La cantidad de un renglón de kardex de avío debe ser un número positivo (recibido: ${String(linea.cantidad)}).`,
      );
    }
  }
}

/**
 * Bloqueo por avío×almacén DENTRO de la transacción (la existencia de avíos es por avío×almacén,
 * R4; el lote no entra en la dimensión). Mismo criterio de claves que {@link bloquearArticuloPt}.
 */
export async function bloquearAvio(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  idAvio: number,
): Promise<void> {
  const clave1 = (idEmpresa * 1_000_003 + idAlmacen) | 0;
  const clave2 = idAvio | 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave1}::int, ${clave2}::int)`;
}

/**
 * Existencia ACTUAL de un avío en un almacén, sumando `movimiento_det_avio` DIRECTO (NUNCA la vista
 * — ADR-0010 §3). Decimal → `number`. Tómala SIEMPRE tras {@link bloquearAvio}. Agrega por
 * avío×almacén (NO por lote — R4).
 */
export async function existenciaAvioBloqueada(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  idAvio: number,
): Promise<number> {
  const filas = await tx.$queryRaw<{ existencia: Prisma.Decimal | null }[]>`
    SELECT COALESCE(SUM(
      d."cantidad" * CASE t."direccion"
        WHEN 'entrada' THEN 1
        WHEN 'salida'  THEN -1
        ELSE 0
      END
    ), 0) AS existencia
    FROM "movimiento_det_avio" d
    JOIN "movimientos" m ON m."id" = d."id_movimiento"
    JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
    WHERE m."id_empresa" = ${idEmpresa}
      AND m."id_almacen" = ${idAlmacen}
      AND d."id_avio" = ${idAvio}
  `;
  return Number(filas[0]?.existencia ?? 0);
}

/**
 * Existencia TOTAL de un avío en la empresa (Σ de movimientos en TODOS los almacenes, D3) — lectura
 * de PLANEACIÓN (NO toma lock; NO valida no-negativo). La usa el MRP (F4-E4) para netear los avíos
 * genéricos contra el stock real (decisión d) cuando el usuario YA está autorizado por `compras.ver`
 * (no debe exigir además `inventario-avios.ver`). Para validar salidas/traspasos sí se usa la versión
 * BLOQUEADA por almacén ({@link existenciaAvioBloqueada}); esta NO sirve para eso (no serializa).
 */
export async function existenciaAvioTotalEmpresa(
  tx: Tx,
  idEmpresa: number,
  idAvio: number,
): Promise<number> {
  const filas = await tx.$queryRaw<{ existencia: Prisma.Decimal | null }[]>`
    SELECT COALESCE(SUM(
      d."cantidad" * CASE t."direccion"
        WHEN 'entrada' THEN 1
        WHEN 'salida'  THEN -1
        ELSE 0
      END
    ), 0) AS existencia
    FROM "movimiento_det_avio" d
    JOIN "movimientos" m ON m."id" = d."id_movimiento"
    JOIN "tipos_movimiento_inventario" t ON t."id" = m."id_tipo_mov"
    WHERE m."id_empresa" = ${idEmpresa}
      AND d."id_avio" = ${idAvio}
  `;
  return Number(filas[0]?.existencia ?? 0);
}

/**
 * Registra UN movimiento de AVÍO (encabezado + detalle + bitácora) en UNA transacción (A2), con
 * folio atómico (A3). Primitivo de los servicios de dominio de avíos. NO valida existencia (lo hace
 * el dominio). RECHAZA la dirección `traspaso` (va por {@link registrarTraspasoAvio}).
 */
export async function registrarMovimientoAvio(
  sesion: SesionUsuario,
  entrada: EntradaMovimientoAvio,
  bd?: ContextoBd,
): Promise<Movimiento> {
  validarLineasAvio(entrada.lineas);
  return enTransaccion(async (tx) => {
    const direccion = await direccionDelTipo(tx, entrada.idTipoMov);
    if (direccion === DireccionMovimiento.traspaso) {
      throw new ErrorValidacion(
        'Un tipo de movimiento de dirección "traspaso" no se registra como movimiento simple: usa registrarTraspasoAvio (salida de origen + entrada de destino).',
      );
    }
    const folio = await siguienteFolio(tx, entrada.idEmpresa, CLAVE_SECUENCIA_MOVIMIENTO);

    const movimiento = await tx.movimiento.create({
      data: {
        folio,
        idEmpresa: entrada.idEmpresa,
        idTipoMov: entrada.idTipoMov,
        idAlmacen: entrada.idAlmacen,
        fecha: entrada.fecha,
        origenTipo: entrada.origenTipo,
        ...(entrada.origenId === undefined ? {} : { origenId: entrada.origenId }),
        idUsuario: sesion.id,
        ...(entrada.observaciones === undefined ? {} : { observaciones: entrada.observaciones }),
        detallesAvio: {
          create: entrada.lineas.map((linea) => ({
            idAvio: linea.idAvio,
            idLote: linea.idLote ?? null,
            esGenerico: linea.esGenerico ?? false,
            cantidad: linea.cantidad,
            costoUnit: linea.costoUnit ?? null,
          })),
        },
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Movimiento',
      idEntidad: movimiento.id,
      accion: 'CREAR',
      datos: {
        folio: folio.toString(),
        dimension: 'avio',
        idTipoMov: entrada.idTipoMov,
        idAlmacen: entrada.idAlmacen,
        origenTipo: entrada.origenTipo,
        renglones: entrada.lineas.length,
      },
    });

    return movimiento;
  }, bd);
}

/** Datos de un traspaso de AVÍO entre dos almacenes de la misma empresa. */
export interface EntradaTraspasoAvio {
  idEmpresa: number;
  idTipoMovSalida: number;
  idTipoMovEntrada: number;
  idAlmacenOrigen: number;
  idAlmacenDestino: number;
  fecha: Date;
  lineas: LineaMovimientoAvio[];
  observaciones?: string;
}

/**
 * Traspaso de AVÍO entre almacenes: DOS `Movimiento` (salida del origen + entrada al destino) en LA
 * MISMA transacción (A2). Análogo a {@link registrarTraspasoTela}. La validación de existencia del
 * origen la hace el dominio bajo lock antes de llamar aquí.
 */
export async function registrarTraspasoAvio(
  sesion: SesionUsuario,
  entrada: EntradaTraspasoAvio,
  bd?: ContextoBd,
): Promise<{ salida: Movimiento; entrada: Movimiento }> {
  if (entrada.idAlmacenOrigen === entrada.idAlmacenDestino) {
    throw new ErrorValidacion(
      'El traspaso necesita un almacén de origen y otro de destino distintos.',
    );
  }
  validarLineasAvio(entrada.lineas);

  return enTransaccion(async (tx) => {
    if ((await direccionDelTipo(tx, entrada.idTipoMovSalida)) !== DireccionMovimiento.salida) {
      throw new ErrorValidacion(
        'El tipo de la pata de salida del traspaso debe ser de dirección "salida".',
      );
    }
    if ((await direccionDelTipo(tx, entrada.idTipoMovEntrada)) !== DireccionMovimiento.entrada) {
      throw new ErrorValidacion(
        'El tipo de la pata de entrada del traspaso debe ser de dirección "entrada".',
      );
    }

    const salida = await registrarMovimientoAvio(
      sesion,
      {
        idEmpresa: entrada.idEmpresa,
        idTipoMov: entrada.idTipoMovSalida,
        idAlmacen: entrada.idAlmacenOrigen,
        fecha: entrada.fecha,
        origenTipo: ORIGEN.traspaso,
        lineas: entrada.lineas,
        ...(entrada.observaciones === undefined ? {} : { observaciones: entrada.observaciones }),
      },
      { tx },
    );

    const entradaMov = await registrarMovimientoAvio(
      sesion,
      {
        idEmpresa: entrada.idEmpresa,
        idTipoMov: entrada.idTipoMovEntrada,
        idAlmacen: entrada.idAlmacenDestino,
        fecha: entrada.fecha,
        origenTipo: ORIGEN.traspaso,
        origenId: String(salida.id),
        lineas: entrada.lineas,
        ...(entrada.observaciones === undefined ? {} : { observaciones: entrada.observaciones }),
      },
      { tx },
    );

    return { salida, entrada: entradaMov };
  }, bd);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CANCELACIÓN GENÉRICA (tela/avío) — F4-E1
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * CANCELA un movimiento de TELA o AVÍO generando su INVERSO auditado (D3/A7): NUNCA edita ni borra
 * el original. Copia el detalle (de la dimensión que tenga el movimiento) con un tipo de dirección
 * OPUESTA (lo provee el dominio) y lo enlaza por `idMovimientoInverso`. Un movimiento ya anulado no
 * se vuelve a anular (`ErrorConflicto`). Es el equivalente para tela/avío de
 * {@link cancelarMovimientoPt}: detecta la dimensión por cuál detalle trae el original.
 *
 * @param idMovimiento     movimiento original a anular (debe ser de tela o avío).
 * @param idTipoMovInverso tipo de movimiento (dirección opuesta) para el inverso.
 * @returns el movimiento INVERSO creado.
 */
export async function cancelarMovimientoMaterial(
  sesion: SesionUsuario,
  idMovimiento: number,
  idTipoMovInverso: number,
  bd?: ContextoBd,
): Promise<Movimiento> {
  return enTransaccion(async (tx) => {
    const original = await tx.movimiento.findUnique({
      where: { id: idMovimiento },
      include: {
        detallesTela: true,
        detallesAvio: true,
        anuladoPor: { select: { id: true } },
      },
    });
    if (original === null) {
      throw new ErrorNoEncontrado('Movimiento', idMovimiento);
    }
    if (original.anuladoPor.length > 0) {
      throw new ErrorConflicto('Ese movimiento ya fue cancelado (tiene un movimiento inverso).');
    }
    // RECHAZA cancelar UNA SOLA PATA de un traspaso (D3 — reviewer F4-E1 obs. #2): un traspaso son
    // DOS `Movimiento` independientes (salida del origen + entrada del destino, `origenTipo =
    // traspaso`). Cancelar solo una pata re-entra/saca de un lado y deja viva la otra → inventario
    // descuadrado entre los dos almacenes. La reversión correcta es un TRASPASO inverso (destino→
    // origen), no una cancelación parcial.
    if (original.origenTipo === ORIGEN.traspaso) {
      throw new ErrorConflicto(
        'Este movimiento es una pata de un traspaso entre almacenes: no se cancela una sola pata ' +
          '(dejaría el inventario descuadrado). Revierte el traspaso con un traspaso inverso ' +
          '(del destino al origen).',
      );
    }
    const esTela = original.detallesTela.length > 0;
    const esAvio = original.detallesAvio.length > 0;
    if (!esTela && !esAvio) {
      throw new ErrorValidacion(
        'Solo se pueden cancelar por esta vía movimientos de TELA o AVÍO (los de PT van por su propia ruta).',
      );
    }

    const direccionInversa = await direccionDelTipo(tx, idTipoMovInverso);
    const direccionOriginal = await direccionDelTipo(tx, original.idTipoMov);
    const opuestas =
      (direccionOriginal === DireccionMovimiento.entrada &&
        direccionInversa === DireccionMovimiento.salida) ||
      (direccionOriginal === DireccionMovimiento.salida &&
        direccionInversa === DireccionMovimiento.entrada);
    if (!opuestas) {
      throw new ErrorValidacion(
        'El tipo de movimiento inverso debe tener la dirección OPUESTA a la del movimiento original.',
      );
    }

    const folio = await siguienteFolio(tx, original.idEmpresa, CLAVE_SECUENCIA_MOVIMIENTO);
    const inverso = await tx.movimiento.create({
      data: {
        folio,
        idEmpresa: original.idEmpresa,
        idTipoMov: idTipoMovInverso,
        idAlmacen: original.idAlmacen,
        fecha: new Date(),
        origenTipo: ORIGEN.cancelacion,
        origenId: String(original.id),
        idUsuario: sesion.id,
        idMovimientoInverso: original.id,
        ...(esTela
          ? {
              detallesTela: {
                // El inverso copia TAMBIÉN las dimensiones del flujo nuevo por color (A2):
                // sin `idTelaColor`/`cantidadComplemento` el par original+inverso NO se
                // neutralizaría en la vista/suma por color y el saldo quedaría descuadrado.
                create: original.detallesTela.map((det) => ({
                  idTela: det.idTela,
                  idLote: det.idLote,
                  idTelaColor: det.idTelaColor,
                  idPartida: det.idPartida,
                  cantidad: det.cantidad,
                  cantidadComplemento: det.cantidadComplemento,
                  costoUnit: det.costoUnit,
                })),
              },
            }
          : {
              detallesAvio: {
                create: original.detallesAvio.map((det) => ({
                  idAvio: det.idAvio,
                  idLote: det.idLote,
                  esGenerico: det.esGenerico,
                  cantidad: det.cantidad,
                  costoUnit: det.costoUnit,
                })),
              },
            }),
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Movimiento',
      idEntidad: original.id,
      accion: 'CANCELAR',
      datos: {
        dimension: esTela ? 'tela' : 'avio',
        folioInverso: folio.toString(),
        idMovimientoInverso: inverso.id,
      },
    });

    return inverso;
  }, bd);
}

/** Re-export para que los servicios de dominio referencien la dirección sin importar `datos`. */
export { DireccionMovimiento };
export type { Prisma };
