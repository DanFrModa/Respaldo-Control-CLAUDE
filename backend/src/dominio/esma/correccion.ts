/**
 * ⭐⭐ CORREGIR un movimiento SIN FACTURA del estado de cuenta de un maquilero — abonos, descuentos y
 * pagos de EsMa (fila 0.145; `DECISIONES.md` §Post-F9.203).
 *
 * DANIEL (6-sep-2026): *«Quiero tener manera de modificar cualquier registro que se meta en
 * cualquier estado de cuenta de los proveedores sin factura. **Sólo yo. Nadie más ni con permiso.
 * Sólo yo.**»* Sobre la forma, tras plantearle el costo: *«Sí, está bien **con rastro**.»*
 *
 * ## De dónde nace
 *
 * Hasta hoy, un abono o un pago a un maquilero capturado por error **NO se podía anular NUNCA**: de
 * los cuatro conceptos de EsMa sólo el descuento tenía cancelación (fila 0.109, y sólo para el
 * deshacer de un cierre de orden). En Cuentas por pagar, en cambio, se cancela todo desde F9-E1.
 * Esta fila cierra esa asimetría — y la cierra con la forma que Daniel pidió, que no es «cancelar».
 *
 * ## LA FORMA: un gesto, dos hechos
 *
 * En pantalla es **editar**: se abre el renglón con sus valores, se cambia lo que haga falta, se
 * guarda. Por dentro, en UNA transacción (A2): el movimiento viejo queda **cancelado** (suave, con
 * su motivo y su autor) y nace uno **nuevo** que lo sustituye, ligado a él (`idAbonoCorregido` /
 * `idDescuentoCorregido` / `idPagoCorregido`).
 *
 * ⇒ **D3 intacto**: nada se edita ni se borra, el saldo sigue siendo Σ de movimientos y el pasado
 * se sigue pudiendo reconstruir. Lo que cambia no es la regla, es que ahora hay una forma de
 * ejercerla en un solo gesto.
 *
 * ## Las cuatro guardas, y por qué cada una
 *
 *  1. **La BANDERA de la persona** ({@link verificarCorrectorSinFactura}), no un permiso: *«ni con
 *     permiso»*. No se reparte con ningún rol ni se asigna desde ninguna pantalla.
 *  2. **SIN FACTURA es del MOVIMIENTO, no del proveedor.** Un proveedor de modalidad `ambos` tiene
 *     movimientos de los dos tipos; el renglón con factura queda INTOCABLE aunque sea del mismo
 *     proveedor, porque detrás hay un CFDI y un CFDI no se corrige por dentro: se cancela ante el
 *     SAT. El criterio de «sin factura» es el mismo de la partición de siempre (`formula-saldo.ts`
 *     §segmento): `conFactura = false` **o** sin definir.
 *  3. **El proveedor y el concepto no se cambian.** No son campos del cuerpo (que es `strict`) y el
 *     servidor los toma del movimiento corregido. Cambiar de proveedor o de concepto no es corregir
 *     un renglón: es otro renglón.
 *  4. **El permiso de capturar ESE concepto sigue haciendo falta**, además de la bandera. La bandera
 *     ABRE una puerta que no existía; no exime de poder operar el módulo. Y si el movimiento estaba
 *     `revisado`, hereda ese estado ⇒ exige también `esma.revisar`, por la regla de la fila 0.128
 *     (nacer `revisado` es un acto de VALIDACIÓN). Todo falla CERRADO.
 *
 * ## Una cosa que a propósito NO se exige: que el maquilero siga ACTIVO
 *
 * Capturar un movimiento nuevo sí lo exige (`crearAbonoMaquilero`, `crearPagoMaquilero`: un
 * proveedor desactivado no recibe movimientos nuevos). Corregir, no — y es deliberado: **corregir no
 * es hacer negocio nuevo, es arreglar lo que ya pasó**. Si a un taller se le dio de baja el mes
 * pasado y su estado de cuenta trae un abono mal capturado, tiene que poder arreglarse; obligar a
 * reactivarlo para eso sería mover un dato del catálogo para poder tocar la contabilidad.
 *
 * Innegociables: A1 (la lógica vive aquí; las rutas delegan), A2 (anulación + recaptura en UNA
 * transacción), A4 (permisos), A7 (bitácora con **lo que decía antes**), A9 (empresa activa), D3.
 */
import {
  esquemaCorreccionSinFactura,
  type ConceptoCorregibleEsMaClave,
  type CorreccionEsMaSalida,
  type DatosCorreccionSinFactura,
} from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  verificarCorrectorSinFactura,
  verificarPermiso,
  type SesionUsuario,
} from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import {
  esSinFactura,
  resolverCambios,
  MENSAJE_CARRERA,
  MENSAJE_TIENE_FACTURA,
  MENSAJE_SIN_CAMBIOS,
  type CambiosResueltos,
} from '../finanzas/correccion-comun.js';

import { WHERE_VIVO_ABONO, WHERE_VIVO_DESCUENTO, WHERE_VIVO_PAGO } from './formula-saldo.js';
import {
  bloquearMaquilero,
  cancelarPagoMaquileroInterno,
  recapturarPagoCorregido,
  type PagoParaCorregir,
} from './pagos.js';

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/** El permiso con el que se CAPTURA cada concepto: corregir no exime de poder operar el módulo. */
function permisoDeCaptura(
  concepto: ConceptoCorregibleEsMaClave,
): 'esma.modificar' | 'esma.ver-pagos' {
  // El pago va con `esma.ver-pagos` (el permiso #24, "ver estado de cuenta y meter SOLO pagos");
  // abonos y descuentos, con `esma.modificar`. Es exactamente el reparto de `crearPagoMaquilero` /
  // `crearAbonoMaquilero`: la corrección no inventa una puerta nueva, usa la misma.
  return concepto === 'pago' ? 'esma.ver-pagos' : 'esma.modificar';
}

/** Nombre de la entidad en la bitácora (A7) por concepto. */
function entidadBitacora(concepto: ConceptoCorregibleEsMaClave): string {
  return concepto === 'abono'
    ? 'AbonoMaquilero'
    : concepto === 'descuento'
      ? 'DescuentoMaquilero'
      : 'PagoMaquilero';
}

/** Deja en la bitácora QUÉ DECÍA ANTES el movimiento corregido y qué dice ahora (A7, «con rastro»). */
async function bitacoraCorreccion(
  tx: Tx,
  sesion: SesionUsuario,
  concepto: ConceptoCorregibleEsMaClave,
  idCorregido: number,
  idNuevo: number,
  antes: { monto: number; fecha: string; observaciones: string | null },
  despues: CambiosResueltos,
  motivo: string,
): Promise<void> {
  await registrarBitacora(tx, sesion, {
    entidad: entidadBitacora(concepto),
    idEntidad: idCorregido,
    accion: 'MODIFICAR',
    datos: {
      operacion: 'corregir-sin-factura',
      motivo,
      idNuevo,
      antes: { monto: antes.monto, fecha: antes.fecha, observaciones: antes.observaciones },
      despues: {
        monto: despues.monto,
        fecha: despues.fecha,
        observaciones: despues.observaciones,
      },
    },
  });
}

// ── Abonos y descuentos (movimientos planos, sin efectos derivados) ─────────────────────────────

/** Lo que la corrección necesita saber de un abono o un descuento. */
interface PlanoParaCorregir {
  id: number;
  idMaquilero: number;
  monto: Prisma.Decimal;
  fecha: Date;
  conFactura: boolean | null;
  observaciones: string | null;
  estadoRevision: 'capturado' | 'revisado';
  /** Sólo el descuento: el cierre de orden que lo propuso (fila 0.109). */
  idCierreMaquila?: number | null;
}

/**
 * Guardas comunes a los tres conceptos, en el orden en que importan. Se separa para que la lista se
 * lea de un vistazo y para que ningún concepto se salte una por descuido.
 */
function exigirCorregible(
  sesion: SesionUsuario,
  concepto: ConceptoCorregibleEsMaClave,
  movimiento: { conFactura: boolean | null; estadoRevision: 'capturado' | 'revisado' },
): void {
  verificarCorrectorSinFactura(sesion);
  verificarPermiso(sesion, permisoDeCaptura(concepto));
  if (!esSinFactura(movimiento.conFactura)) {
    throw new ErrorConflicto(MENSAJE_TIENE_FACTURA);
  }
  // Hereda el estado de revisión: si estaba `revisado` (o sea, ya cuenta al saldo), el movimiento
  // nuevo nace `revisado` y eso es un acto de VALIDACIÓN — regla de la fila 0.128.
  if (movimiento.estadoRevision === 'revisado') {
    verificarPermiso(sesion, 'esma.revisar');
  }
}

/**
 * Corrige un ABONO o un DESCUENTO: cancela el viejo (suave) y captura el bueno, ligados, en UNA
 * transacción.
 *
 * ⚠️ El `updateMany` de la cancelación es CONDICIONAL (`canceladoEn: null`), no un `update` por id:
 * la lectura previa da el MENSAJE, la condición da la GARANTÍA. Entre las dos cabe otra transacción
 * —otra corrección, o el deshacer de un cierre sobre el mismo descuento— y sin la condición las dos
 * prosperarían dejando dos sustitutos de un mismo renglón. `count === 0` significa: llegó otro
 * primero. (Precedente F8-E3 / fila 0.109; `CLAUDE.md` §7.3.)
 */
async function corregirPlano(
  tx: Tx,
  sesion: SesionUsuario,
  concepto: 'abono' | 'descuento',
  movimiento: PlanoParaCorregir,
  datos: DatosCorreccionSinFactura,
): Promise<CorreccionEsMaSalida> {
  const idEmpresa = sesion.idEmpresaActiva;
  const antes = {
    monto: movimiento.monto.toNumber(),
    fecha: movimiento.fecha.toISOString().slice(0, 10),
    observaciones: movimiento.observaciones,
  };
  const cambios = resolverCambios(antes, datos);
  if (!cambios.hayCambio) {
    throw new ErrorValidacion(MENSAJE_SIN_CAMBIOS);
  }

  const cancelacion = {
    canceladoEn: new Date(),
    canceladoPorId: sesion.id,
    motivoCancelacion: datos.motivo,
    ...datosModificacion(sesion),
  };
  const comunNuevo = {
    idEmpresa,
    idMaquilero: movimiento.idMaquilero,
    monto: cambios.monto,
    fecha: aDateColumna(cambios.fecha),
    // El segmento se COPIA verbatim: corregir nunca cambia de segmento (y así lo migrado sin
    // modalidad definida se puede corregir sin toparse con `resolverConFactura`).
    conFactura: movimiento.conFactura,
    estadoRevision: movimiento.estadoRevision,
    ...(cambios.observaciones === null ? {} : { observaciones: cambios.observaciones }),
    ...datosCreacion(sesion),
  };

  let idNuevo: number;
  if (concepto === 'abono') {
    const cancelados = await tx.abonoMaquilero.updateMany({
      where: { id: movimiento.id, idEmpresa, ...WHERE_VIVO_ABONO },
      data: cancelacion,
    });
    if (cancelados.count === 0) {
      throw new ErrorConflicto(MENSAJE_CARRERA);
    }
    const creado = await tx.abonoMaquilero.create({
      data: { ...comunNuevo, idAbonoCorregido: movimiento.id },
      select: { id: true },
    });
    idNuevo = creado.id;
  } else {
    const cancelados = await tx.descuentoMaquilero.updateMany({
      where: { id: movimiento.id, idEmpresa, ...WHERE_VIVO_DESCUENTO },
      data: cancelacion,
    });
    if (cancelados.count === 0) {
      throw new ErrorConflicto(MENSAJE_CARRERA);
    }
    const creado = await tx.descuentoMaquilero.create({
      data: { ...comunNuevo, idDescuentoCorregido: movimiento.id },
      select: { id: true },
    });
    idNuevo = creado.id;
  }

  // ⭐ A7 — el movimiento NUEVO deja su propia entrada `CREAR`, igual que si se hubiera capturado a
  // mano. Sin ella el abono corregido quedaba con CERO renglones propios en la bitácora y la
  // pregunta «¿quién creó este abono?» no se podía contestar: la única de las cuatro rutas de la
  // fila que lo omitía (el motor y el pago sí la dejaban).
  await registrarBitacora(tx, sesion, {
    entidad: entidadBitacora(concepto),
    idEntidad: idNuevo,
    accion: 'CREAR',
    datos: {
      idMaquilero: movimiento.idMaquilero,
      monto: cambios.monto,
      conFactura: movimiento.conFactura,
      correccionDe: movimiento.id,
    },
  });

  await bitacoraCorreccion(
    tx,
    sesion,
    concepto,
    movimiento.id,
    idNuevo,
    antes,
    cambios,
    datos.motivo,
  );
  return { concepto, idCorregido: movimiento.id, idNuevo };
}

/** Mensaje del descuento que nació del cierre de una orden y por eso no se corrige por su cuenta. */
export const MENSAJE_DESCUENTO_DE_CIERRE =
  'Ese descuento lo propuso el CIERRE de la orden con el maquilero: no se corrige suelto, porque ' +
  'el cierre es su dueño y podría deshacerse después. Deshaz el cierre y vuelve a cerrarlo con el ' +
  'importe correcto.';

/** Mensaje del pago YA APLICADO a cargos, al que se le quiso cambiar el importe. */
export const MENSAJE_PAGO_APLICADO =
  'Ese pago está aplicado a cargos concretos: su importe NO es un dato suelto, sale de las prendas ' +
  'aplicadas por el precio de cada cargo. Corrige su fecha o sus observaciones; para cambiar el ' +
  'dinero hay que cambiar las prendas aplicadas, y eso se hace capturando el pago de nuevo.';

// ── El orquestador ──────────────────────────────────────────────────────────────────────────────

/**
 * CORRIGE un movimiento SIN FACTURA de EsMa (abono, descuento o pago). Ver el TSDoc del módulo para
 * la forma y las guardas.
 *
 * ⚠️ El CARGO no entra: no es un movimiento que alguien «meta» en el estado de cuenta, nace de un
 * RECIBO de maquila y ya tiene su propio camino para arreglarse (validarlo fija cantidad y precio
 * reales; cancelarlo lo saca). Corregirlo por aquí sería una segunda forma de hacer lo mismo, con
 * otras reglas.
 */
export async function corregirMovimientoEsMa(
  sesion: SesionUsuario,
  concepto: ConceptoCorregibleEsMaClave,
  id: number,
  cuerpo: z.input<typeof esquemaCorreccionSinFactura>,
  bd?: ContextoBd,
): Promise<CorreccionEsMaSalida> {
  // La BANDERA primero, antes de tocar la base: quien no la tiene se lleva un 403 sin que su
  // intento haya leído ni bloqueado nada. `exigirCorregible` la vuelve a pedir más abajo (defensa en
  // profundidad: quien llegue por otro camino topa con la misma pared).
  verificarCorrectorSinFactura(sesion);
  const datos: DatosCorreccionSinFactura = validarEntrada(esquemaCorreccionSinFactura, cuerpo);
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx) => {
    if (concepto === 'pago') {
      return corregirPagoEnTx(tx, sesion, id, datos);
    }

    const movimiento =
      concepto === 'abono'
        ? await tx.abonoMaquilero.findFirst({
            where: { id, idEmpresa, ...WHERE_VIVO_ABONO },
            select: {
              id: true,
              idMaquilero: true,
              monto: true,
              fecha: true,
              conFactura: true,
              observaciones: true,
              estadoRevision: true,
            },
          })
        : await tx.descuentoMaquilero.findFirst({
            where: { id, idEmpresa, ...WHERE_VIVO_DESCUENTO },
            select: {
              id: true,
              idMaquilero: true,
              monto: true,
              fecha: true,
              conFactura: true,
              observaciones: true,
              estadoRevision: true,
              idCierreMaquila: true,
            },
          });
    if (movimiento === null) {
      throw new ErrorNoEncontrado(entidadBitacora(concepto), id);
    }
    exigirCorregible(sesion, concepto, movimiento);
    // ⭐ El descuento que PROPUSO un cierre de orden es del cierre, no de quien lo mira: su
    // `idCierreMaquila` es `@unique`, así que el sustituto no podría heredarlo y el deshacer del
    // cierre se quedaría buscando un descuento que ya nadie usa. Se corta con su razón.
    if ('idCierreMaquila' in movimiento && movimiento.idCierreMaquila !== null) {
      throw new ErrorConflicto(MENSAJE_DESCUENTO_DE_CIERRE);
    }
    return corregirPlano(tx, sesion, concepto, movimiento, datos);
  }, bd);
}

/**
 * ⭐⭐ La corrección de un PAGO — el caso difícil, dentro de la transacción del orquestador.
 *
 * Un pago no es un renglón suelto: consume «prendas por pagar» de cargos concretos y de ahí se
 * deriva el estatus `Orden.pagada`. Por eso aquí, y sólo aquí, hace falta el
 * `pg_advisory_xact_lock` POR MAQUILERO: entre deshacer la aplicación vieja y hacer la nueva no
 * puede colarse otro pago que se lleve las prendas que este pago va a volver a ocupar.
 *
 * El orden importa y es éste:
 *  1. lock por maquilero;
 *  2. leer el pago vivo con sus aplicaciones (y sus guardas);
 *  3. CANCELARLO deshaciendo su aplicación (`cancelarPagoMaquileroInterno`) — sólo después de esto
 *    las prendas que ocupaba vuelven a estar «por pagar»;
 *  4. RECAPTURARLO con las mismas aplicaciones (`recapturarPagoCorregido`), que las vuelve a tomar.
 *
 * Si el paso 4 fallara, la transacción entera se deshace: no existe el estado intermedio donde el
 * pago está cancelado y los cargos libres.
 */
async function corregirPagoEnTx(
  tx: Tx,
  sesion: SesionUsuario,
  id: number,
  datos: DatosCorreccionSinFactura,
): Promise<CorreccionEsMaSalida> {
  const idEmpresa = sesion.idEmpresaActiva;
  // Se lee primero sin lock para saber DE QUIÉN es el pago (el lock es por maquilero); las guardas
  // y la cancelación se hacen después, ya bajo el lock y con una segunda lectura autoritativa.
  const cabecera = await tx.pagoMaquilero.findFirst({
    where: { id, idEmpresa, ...WHERE_VIVO_PAGO },
    select: { idMaquilero: true },
  });
  if (cabecera === null) {
    throw new ErrorNoEncontrado('PagoMaquilero', id);
  }
  await bloquearMaquilero(tx, idEmpresa, cabecera.idMaquilero);

  const pago = await tx.pagoMaquilero.findFirst({
    where: { id, idEmpresa, ...WHERE_VIVO_PAGO },
    select: {
      id: true,
      idMaquilero: true,
      monto: true,
      fecha: true,
      conFactura: true,
      observaciones: true,
      estadoRevision: true,
      aplicaciones: { select: { idCargo: true, cantidad: true }, orderBy: { idCargo: 'asc' } },
    },
  });
  if (pago === null) {
    throw new ErrorNoEncontrado('PagoMaquilero', id);
  }
  exigirCorregible(sesion, 'pago', pago);

  const antes = {
    monto: pago.monto.toNumber(),
    fecha: pago.fecha.toISOString().slice(0, 10),
    observaciones: pago.observaciones,
  };
  const cambios = resolverCambios(antes, datos);
  if (!cambios.hayCambio) {
    throw new ErrorValidacion(MENSAJE_SIN_CAMBIOS);
  }
  // 🔴 El límite declarado de esta fila: un pago APLICADO no cambia de importe. Ver el mensaje.
  if (
    pago.aplicaciones.length > 0 &&
    datos.importe !== undefined &&
    cambios.monto !== antes.monto
  ) {
    throw new ErrorConflicto(MENSAJE_PAGO_APLICADO);
  }

  const paraCorregir: PagoParaCorregir = {
    id: pago.id,
    idMaquilero: pago.idMaquilero,
    monto: pago.monto,
    conFactura: pago.conFactura,
    observaciones: pago.observaciones,
    estadoRevision: pago.estadoRevision,
    aplicaciones: pago.aplicaciones,
  };
  await cancelarPagoMaquileroInterno(tx, sesion, paraCorregir, datos.motivo);
  const nuevo = await recapturarPagoCorregido(tx, sesion, paraCorregir, {
    monto: cambios.monto,
    fecha: cambios.fecha,
    observaciones: cambios.observaciones,
  });

  await bitacoraCorreccion(tx, sesion, 'pago', pago.id, nuevo.id, antes, cambios, datos.motivo);
  return { concepto: 'pago', idCorregido: pago.id, idNuevo: nuevo.id };
}
