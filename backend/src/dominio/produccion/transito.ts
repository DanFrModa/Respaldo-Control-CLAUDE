/**
 * TRÁNSITO DE PRENDAS A PROCESO EXTERNO (V1-E4b — §Post-F9.59 / §Post-F9.60 / §Post-F9.61).
 *
 * El problema que resuelve, en la frase de Daniel: *"¿de qué manera manejamos los faltantes o
 * segundas?"*. Hoy Daniel manda estampados/lavados DESPUÉS de la costura (§Post-F9.60). Se mandan
 * 100 prendas ya terminadas, vuelven 95 primeras + 3 segundas y faltan 2 — y el almacén sigue
 * diciendo 100 primeras. No es que esté mal capturado: NO HABÍA MOVIMIENTO donde registrarlo (el
 * envío no tocaba el kardex de PT y el recibo solo metía a PT si `TipoProceso.generaEntradaPt`).
 *
 * ⭐ La respuesta NO inventa una entidad nueva: **el saldo «en proceso» es un ALMACÉN más**. El repo
 * ya tenía almacenes, traspasos entre ellos (dos patas salida/entrada en una transacción, F3-E3 /
 * ADR-0010 §1) y hasta el almacén "Tránsito" sembrado desde F3-E1 (heredado de `IPT_Almacenes` del
 * sistema viejo, donde nunca se usó). Este módulo solo lo pone a trabajar:
 *
 *   | Momento                              | Movimiento de kardex                                |
 *   |--------------------------------------|-----------------------------------------------------|
 *   | Envío de prendas YA TERMINADAS       | traspaso  almacén origen → TRÁNSITO                  |
 *   | Recibo de primeras                   | traspaso  TRÁNSITO → almacén de primeras            |
 *   | Recibo de segundas                   | traspaso  TRÁNSITO → almacén de segundas            |
 *   | Diferencia (lo que no volvió)        | se QUEDA en TRÁNSITO, viva, a cargo del tercero     |
 *   | Recibo de INCOMPLETAS                | NADA: no se inventarían ⇒ se quedan en TRÁNSITO     |
 *
 * Consecuencias, que son justo lo que Daniel pidió:
 *  • el faltante NO se absorbe en silencio (D3): sigue existiendo, en tránsito, hasta que llegue o
 *    se le dé salida a mano con motivo (movimiento manual de PT, que ya existe desde F3-E3);
 *  • la prenda que salió PRIMERA y vuelve SEGUNDA es una reclasificación real (sale de tránsito y
 *    entra a segundas), expresable con movimientos sin editar un solo saldo;
 *  • el inventario deja de mentir sobre dónde están las prendas (el conteo cíclico de F7-E5 ya
 *    tiene explicación para la diferencia: están en tránsito).
 *
 * ⚠️ Quién tiene cada pieza NO lo dice el kardex (el tránsito es UN almacén, no uno por maquilero):
 * lo dice el WIP, que lleva el saldo POR TERCERO (`enviado − recibido − incompletas − faltantes saldados`, `wip.ts`
 * `pendientePorMaquilero` / `consultarExistenciaMaquilero`). Cada capa hace su trabajo: el kardex
 * responde "¿cuántas piezas NO están en el piso?" y el WIP "¿a quién se las reclamo?". Por eso el
 * tránsito no necesita un almacén por tercero.
 *
 * 🔴 **PERO DESDE V1-E8v (§Post-F9.147) LAS DOS CAPAS DIVERGEN, y hay que saberlo.** Hasta esa etapa
 * las dos cuentas coincidían pieza por pieza. Ya no: la prenda que vuelve **INCOMPLETA** sale del
 * WIP —el maquilero la devolvió, deja de tenerla— pero **NO sale del TRÁNSITO**, porque no se
 * inventaría (Daniel: *"tampoco entra al inventario…. es decir se pierden esas prendas"*). Con 100
 * enviadas y 95 buenas + 5 incompletas, el WIP dice que el maquilero no tiene nada y el tránsito
 * sigue guardando 5 piezas que **nadie va a devolver**.
 *
 * NO rompe D3: la existencia sigue siendo la Σ de movimientos REALES, y esas 5 piezas de verdad
 * salieron del almacén y nunca volvieron a él. Lo que dejó de ser cierto es que las dos capas lleven
 * el mismo número — así que **no se pueden usar la una para cuadrar la otra**. Se limpian igual que
 * el faltante: con un movimiento manual de PT con motivo. Darles salida automática exigiría un tipo
 * de movimiento nuevo (¿merma?) y **eso es una decisión de negocio que Daniel no ha tomado**;
 * inventarla sería ponerle en la boca algo que no dijo. Deuda con nombre en `HOJA-DE-RUTA.md` §4.
 *
 * Innegociables aplicados: A1 (la lógica vive en dominio) · A2 (todo dentro de la transacción del
 * hecho) · A9 (empresa activa) · D3 (existencia = Σ de movimientos, validada por suma DIRECTA bajo
 * advisory lock antes de sacar; cancelar = inverso auditado, nunca edición).
 */
import { DireccionMovimiento } from '../../datos/index.js';

import { ErrorConflicto, ErrorValidacion } from '../../comun/errores.js';
import {
  cancelarMovimientoPt as cancelarMovimientoPtMotor,
  exigirExistenciaPt,
  registrarTraspasoPt as registrarTraspasoPtMotor,
  type LineaMovimientoPt,
} from '../../comun/kardex.js';
import type { OrigenMovimiento } from '../../comun/origenes.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Tx } from '../../comun/transaccion.js';

/** Pata de SALIDA de un traspaso de PT (seed F3-E3, dirección `salida`). */
const COD_TRASPASO_SALIDA = 'transferencia-salida';
/** Pata de ENTRADA de un traspaso de PT (seed F3-E3, dirección `entrada`). */
const COD_TRASPASO_ENTRADA = 'transferencia-entrada';
/** Inverso de una ENTRADA al cancelar (dirección `salida`). */
const COD_ERROR_ENTRADA = 'error-entrada';
/** Inverso de una SALIDA al cancelar (dirección `entrada`). */
const COD_ERROR_SALIDA = 'error-salida';

/** Resuelve un tipo de movimiento por su `codigo`, exigiéndolo ACTIVO. */
async function tipoPorCodigo(tx: Tx, codigo: string): Promise<{ id: number; nombre: string }> {
  const tipo = await tx.tipoMovimientoInventario.findUnique({
    where: { codigo },
    select: { id: true, nombre: true, activo: true },
  });
  if (tipo === null) {
    throw new ErrorValidacion(
      `Falta el tipo de movimiento "${codigo}" en el catálogo (re-sembrar). No se puede continuar.`,
    );
  }
  if (!tipo.activo) {
    throw new ErrorValidacion(`El tipo de movimiento "${tipo.nombre}" está desactivado.`);
  }
  return { id: tipo.id, nombre: tipo.nombre };
}

/**
 * Resuelve el ALMACÉN DE TRÁNSITO usable por una empresa: el que trae la bandera
 * `esTransitoProceso`, activo, GLOBAL o de esa empresa (A9 — mismo criterio que `exigirAlmacen`).
 * Se busca por la BANDERA, jamás por el nombre: el nombre lo puede editar cualquiera desde el
 * catálogo de almacenes y el flujo se rompería en silencio.
 *
 * Exige que haya EXACTAMENTE uno: con dos, "¿a cuál mando las prendas?" no tiene respuesta y el
 * inventario quedaría partido entre dos buckets sin que nadie lo note. El propio de la empresa gana
 * al global si existieran ambos (mismo criterio de precedencia que el resto de los catálogos A9);
 * la ambigüedad que se rechaza es tener DOS del mismo alcance.
 *
 * ⚠️ Desde el hallazgo H7 del reviewer, tener dos es **imposible en la base**: el índice único
 * PARCIAL `almacen_transito_unico` (migración `20260817160000`) lo prohíbe. La verificación de aquí
 * se conserva a propósito como segunda línea —si alguien dropea el índice a mano, el flujo falla
 * con un mensaje claro en vez de elegir un almacén a la suerte y partir el inventario—, pero por
 * eso su rama de "hay más de uno" ya no es alcanzable desde la aplicación.
 */
export async function almacenDeTransito(
  tx: Tx,
  idEmpresa: number,
): Promise<{ id: number; nombre: string }> {
  const candidatos = await tx.almacen.findMany({
    where: {
      esTransitoProceso: true,
      activo: true,
      tipo: 'PT',
      OR: [{ idEmpresa: null }, { idEmpresa }],
    },
    select: { id: true, nombre: true, idEmpresa: true },
    orderBy: { id: 'asc' },
  });
  if (candidatos.length === 0) {
    throw new ErrorValidacion(
      'Falta el almacén de TRÁNSITO a proceso externo en el catálogo (un almacén de PT marcado ' +
        'como tránsito; el catálogo base lo siembra con el nombre "Tránsito"). Hay que re-sembrar. ' +
        'No se puede continuar.',
    );
  }
  // ⚠️ Esta precedencia (el propio de la empresa gana al global) es HOY INALCANZABLE y se conserva
  // solo por si el modelo cambia: el índice único parcial `almacen_transito_unico` es sobre TODA la
  // tabla, no por empresa, así que no puede haber un tránsito global Y otro de empresa a la vez —
  // ni dos de empresas distintas. Que nadie lo lea como "cada empresa puede tener el suyo": hoy el
  // tránsito es UNO en todo el sistema. Cambiar eso pide cambiar el índice, no este código.
  const propios = candidatos.filter((a) => a.idEmpresa !== null);
  const elegibles = propios.length > 0 ? propios : candidatos;
  if (elegibles.length > 1) {
    throw new ErrorValidacion(
      `Hay ${String(elegibles.length)} almacenes marcados como TRÁNSITO a proceso externo; debe ` +
        'haber exactamente uno. Desmarca los sobrantes en Almacenes.',
    );
  }
  const elegido = elegibles[0];
  /* c8 ignore next 3 -- inalcanzable: `elegibles.length` es 1 aquí (narrowing que TS no hace). */
  if (elegido === undefined) {
    throw new ErrorValidacion('No hay almacén de TRÁNSITO a proceso externo.');
  }
  return { id: elegido.id, nombre: elegido.nombre };
}

/**
 * RECHAZA que un flujo de negocio use el almacén de TRÁNSITO como origen o destino directo
 * (V1-E4b). El tránsito no es una bodega: es el reflejo en inventario de lo que está físicamente en
 * el taller de un tercero, y solo lo mueven el ENVÍO (que mete) y el RECIBO (que saca). Antes de
 * esta etapa el hueco no existía porque el tránsito nunca tenía existencia; ahora sí la tiene, y
 * sin este candado se podría, por ejemplo, entregarle al cliente prendas que están en el
 * estampador — el almacén cuadraría y la mercancía no existiría.
 *
 * La salida legítima de lo que NO vuelve (el faltante que se da de baja con motivo) es un
 * MOVIMIENTO MANUAL de PT (F3-E3), que no pasa por aquí: ahí es una decisión explícita, auditada y
 * cancelable, no un efecto colateral de otro flujo.
 */
export async function rechazarAlmacenDeTransito(
  tx: Tx,
  idAlmacen: number,
  queSeIntenta: string,
): Promise<void> {
  // El almacén ya viene validado por `exigirAlmacen` (existe, activo y de esta empresa o global,
  // A9): aquí solo se mira la bandera.
  const almacen = await tx.almacen.findFirst({
    where: { id: idAlmacen, esTransitoProceso: true },
    select: { nombre: true },
  });
  if (almacen === null) return;
  throw new ErrorValidacion(
    `"${almacen.nombre}" es el almacén de TRÁNSITO a proceso externo: guarda lo que está en el ` +
      `taller de un tercero, no se ${queSeIntenta} desde ahí. Si esas piezas ya no van a volver, ` +
      'dales salida con un movimiento manual de inventario, con su motivo.',
  );
}

/** Un renglón de prendas que se mueve hacia/desde el tránsito (color×talla de UNA orden). */
export interface LineaTransito {
  idColor: number;
  idTalla: number;
  cantidad: number;
}

/**
 * Convierte celdas color×talla a líneas del kardex, etiquetadas con su modelo y con el BUCKET de
 * existencia del que salen / al que vuelven (F6-E2 "PT por orden").
 *
 * `idOrdenBucket` NO es siempre la orden del envío: `null` es el bucket «sin orden asignada», donde
 * vive TODO el histórico migrado (`migracion/loaders/ipt-kardex.ts` no etiqueta orden) y TODO lo que
 * se capture en el inventario físico de arranque. Sin poder elegirlo, el envío de prendas
 * terminadas no alcanzaba justo el stock que hay el día uno.
 */
function aLineasKardex(
  idModelo: number,
  idOrdenBucket: number | null,
  celdas: LineaTransito[],
): LineaMovimientoPt[] {
  return celdas
    .filter((c) => c.cantidad > 0)
    .map((c) => ({
      idModelo,
      idColor: c.idColor,
      idTalla: c.idTalla,
      idOrden: idOrdenBucket,
      cantidad: c.cantidad,
    }));
}

/**
 * TRASPASA prendas de un almacén de PT al TRÁNSITO (envío de prendas ya terminadas a un proceso
 * externo). Dentro de la transacción del envío (A2). Valida primero, bajo advisory lock y por suma
 * DIRECTA, que el almacén origen tenga las piezas (D3 — no se deja el inventario en negativo): si
 * el estampador se lleva prendas que el almacén no tiene, el problema es el dato, no el saldo.
 *
 * Las DOS patas quedan selladas con `origenTipo`/`origenId` del ENVÍO, para que la cancelación del
 * envío las encuentre juntas.
 */
export async function traspasarPrendasATransito(
  sesion: SesionUsuario,
  tx: Tx,
  datos: {
    idEmpresa: number;
    idAlmacenOrigen: number;
    idModelo: number;
    /** Bucket de existencia del que salen: la orden, o `null` = «sin orden asignada». */
    idOrdenBucket: number | null;
    fecha: Date;
    origenTipo: OrigenMovimiento;
    origenId: string;
    celdas: LineaTransito[];
  },
): Promise<void> {
  const lineas = aLineasKardex(datos.idModelo, datos.idOrdenBucket, datos.celdas);
  if (lineas.length === 0) return;

  const transito = await almacenDeTransito(tx, datos.idEmpresa);
  if (transito.id === datos.idAlmacenOrigen) {
    throw new ErrorValidacion(
      `"${transito.nombre}" es el almacén de tránsito: las prendas no pueden salir de ahí hacia sí mismo.`,
    );
  }
  await exigirExistenciaPt(tx, datos.idEmpresa, datos.idAlmacenOrigen, datos.idModelo, lineas);

  // En SERIE, no `Promise.all`: el cliente de una transacción interactiva de Prisma no admite dos
  // consultas a la vez (avisa con un DeprecationWarning y en pg@9 será error).
  const salida = await tipoPorCodigo(tx, COD_TRASPASO_SALIDA);
  const entrada = await tipoPorCodigo(tx, COD_TRASPASO_ENTRADA);
  await registrarTraspasoPtMotor(
    sesion,
    {
      idEmpresa: datos.idEmpresa,
      idTipoMovSalida: salida.id,
      idTipoMovEntrada: entrada.id,
      idAlmacenOrigen: datos.idAlmacenOrigen,
      idAlmacenDestino: transito.id,
      fecha: datos.fecha,
      lineas,
      origenTipo: datos.origenTipo,
      origenId: datos.origenId,
    },
    { tx },
  );
}

/**
 * DEVUELVE prendas del TRÁNSITO a un almacén de PT (recibo de un proceso posterior a la costura:
 * primeras a su almacén, segundas al suyo — la reclasificación que hoy no tenía salida). Valida que
 * el tránsito tenga las piezas de ESA orden (D3, bajo lock): recibir más de lo que salió dejaría el
 * tránsito negativo, y eso siempre es un dato mal capturado.
 */
export async function devolverPrendasDeTransito(
  sesion: SesionUsuario,
  tx: Tx,
  datos: {
    idEmpresa: number;
    idAlmacenDestino: number;
    idModelo: number;
    /** Bucket al que VUELVEN: el MISMO del que salieron (nunca se reetiqueta mercancía). */
    idOrdenBucket: number | null;
    fecha: Date;
    origenTipo: OrigenMovimiento;
    origenId: string;
    celdas: LineaTransito[];
  },
): Promise<void> {
  const lineas = aLineasKardex(datos.idModelo, datos.idOrdenBucket, datos.celdas);
  if (lineas.length === 0) return;

  const transito = await almacenDeTransito(tx, datos.idEmpresa);
  if (transito.id === datos.idAlmacenDestino) {
    throw new ErrorValidacion(
      `"${transito.nombre}" es el almacén de tránsito: no puede ser el destino de un recibo.`,
    );
  }
  await exigirExistenciaPt(tx, datos.idEmpresa, transito.id, datos.idModelo, lineas);

  // En SERIE, no `Promise.all`: el cliente de una transacción interactiva de Prisma no admite dos
  // consultas a la vez (avisa con un DeprecationWarning y en pg@9 será error).
  const salida = await tipoPorCodigo(tx, COD_TRASPASO_SALIDA);
  const entrada = await tipoPorCodigo(tx, COD_TRASPASO_ENTRADA);
  await registrarTraspasoPtMotor(
    sesion,
    {
      idEmpresa: datos.idEmpresa,
      idTipoMovSalida: salida.id,
      idTipoMovEntrada: entrada.id,
      idAlmacenOrigen: transito.id,
      idAlmacenDestino: datos.idAlmacenDestino,
      fecha: datos.fecha,
      lineas,
      origenTipo: datos.origenTipo,
      origenId: datos.origenId,
    },
    { tx },
  );
}

/**
 * REVIERTE todos los movimientos de kardex que generó un hecho (envío o recibo), con INVERSOS
 * auditados (D3/A7: el original NUNCA se edita ni se borra). Es el espejo de las dos funciones de
 * arriba para la cancelación.
 *
 * Dos cosas que hay que hacer bien y no son obvias:
 *  1. **El tipo inverso depende de la DIRECCIÓN de cada movimiento**, no del hecho: un traspaso son
 *     DOS patas (una salida y una entrada) y cada una se anula con la dirección OPUESTA a la suya
 *     (`error-entrada` es una SALIDA y solo sirve para anular entradas; `error-salida`, al revés).
 *     Usar un solo tipo para todas —como bastaba cuando el recibo solo generaba entradas— haría
 *     tronar el motor con "el inverso debe tener la dirección OPUESTA".
 *  2. **El inverso de una ENTRADA saca mercancía**, así que primero se valida que el almacén la
 *     tenga (D3). Sin esto, cancelar un recibo cuyas prendas ya se entregaron/mandaron a otro
 *     proceso dejaría el almacén en NEGATIVO por la puerta de atrás — el único camino del sistema
 *     que podía hacerlo, porque `cancelarMovimientoPt` no valida existencia (no puede: no sabe si
 *     lo que revierte es una entrada o una salida hasta que lo mira).
 */
export async function revertirMovimientosDeHecho(
  sesion: SesionUsuario,
  tx: Tx,
  datos: { origenTipo: OrigenMovimiento; origenId: string },
): Promise<number> {
  const movimientos = await tx.movimiento.findMany({
    where: {
      origenTipo: datos.origenTipo,
      origenId: datos.origenId,
      idMovimientoInverso: null, // los inversos no se re-cancelan
    },
    select: {
      id: true,
      idEmpresa: true,
      idAlmacen: true,
      anuladoPor: { select: { id: true } },
      tipoMov: { select: { direccion: true } },
      detallesPt: {
        select: { idModelo: true, idColor: true, idTalla: true, idOrden: true, cantidad: true },
      },
    },
    orderBy: { id: 'asc' },
  });

  // Los tipos inversos se resuelven SOLO cuando hacen falta (memoizados): un recibo de costura
  // genera puras entradas y no tiene por qué exigir que exista `error-salida` en el catálogo.
  const cache = new Map<string, { id: number; nombre: string }>();
  const tipoInverso = async (codigo: string): Promise<{ id: number; nombre: string }> => {
    const enCache = cache.get(codigo);
    if (enCache !== undefined) return enCache;
    const tipo = await tipoPorCodigo(tx, codigo);
    cache.set(codigo, tipo);
    return tipo;
  };

  let revertidos = 0;
  for (const mov of movimientos) {
    if (mov.anuladoPor.length > 0) continue; // ya estaba anulado (defensivo)
    const esEntrada = mov.tipoMov.direccion === DireccionMovimiento.entrada;
    if (esEntrada) {
      // El inverso SACA: agrupa por modelo (el detalle de un movimiento de PT es de un solo modelo
      // en todos los flujos de producción, pero se agrupa igual por si algún día no lo fuera).
      const porModelo = new Map<number, typeof mov.detallesPt>();
      for (const det of mov.detallesPt) {
        const grupo = porModelo.get(det.idModelo) ?? [];
        grupo.push(det);
        porModelo.set(det.idModelo, grupo);
      }
      for (const [idModelo, celdas] of porModelo) {
        await exigirExistenciaPt(tx, mov.idEmpresa, mov.idAlmacen, idModelo, celdas);
      }
    }
    const inverso = await tipoInverso(esEntrada ? COD_ERROR_ENTRADA : COD_ERROR_SALIDA);
    await cancelarMovimientoPtMotor(sesion, mov.id, inverso.id, { tx });
    revertidos += 1;
  }
  return revertidos;
}

/** Cómo salieron las prendas de un envío vivo: si salieron del almacén y de qué bucket. */
export interface FormaDelEnvio {
  /** El envío sacó producto TERMINADO del almacén hacia el tránsito (§Post-F9.61). */
  prendaTerminada: boolean;
  /** Salió del bucket «sin orden asignada» (`id_orden = NULL`) en vez del bucket de su orden. */
  stockSinOrden: boolean;
}

/**
 * ¿CÓMO salieron las prendas de los envíos VIVOS de esta orden+proceso? Es lo que decide si el
 * recibo devuelve mercancía del tránsito —o sea, la propiedad de POSICIÓN que §Post-F9.59 pedía
 * sacar de `TipoProceso.generaEntradaPt` (el mismo estampado va antes de la costura en una orden y
 * después en otra; la bandera del tipo no puede saberlo)— y a QUÉ bucket de existencia devolverla.
 *
 * Se mira por orden+proceso (no por maquilero): el WIP agrega los pendientes por proceso y el envío
 * exige que todos los de la misma orden+proceso coincidan en AMBAS banderas, así que aquí la
 * respuesta es única. `null` = no hay envíos vivos (el recibo decide con las reglas de siempre).
 */
export async function formaDelEnvioVivo(
  tx: Tx,
  idOrden: number,
  idTipoProceso: number,
): Promise<FormaDelEnvio | null> {
  const envios = await tx.etapaMovimiento.findMany({
    where: {
      idOrden,
      idTipoProceso,
      tipo: 'envio_maquila',
      canceladoEn: null,
    },
    select: { prendaTerminada: true, stockSinOrden: true },
    distinct: ['prendaTerminada', 'stockSinOrden'],
  });
  if (envios.length === 0) return null;
  if (envios.length > 1) {
    // No debería pasar (el envío lo impide), pero si el dato viejo lo trae mezclado hay que decirlo
    // en vez de elegir uno a la suerte y mover inventario por la mitad.
    throw new ErrorConflicto(
      'Esta orden tiene entregas vivas MEZCLADAS de este proceso: no todas salieron del almacén de ' +
        'la misma forma (unas como prendas ya terminadas y otras como bultos cortados, o de buckets ' +
        'de existencia distintos). Cancela las que estén mal capturadas antes de recibir.',
    );
  }
  const forma = envios[0];
  /* c8 ignore next 3 -- inalcanzable: `envios.length` es 1 aquí (narrowing que TS no hace). */
  if (forma === undefined) return null;
  return { prendaTerminada: forma.prendaTerminada, stockSinOrden: forma.stockSinOrden };
}
