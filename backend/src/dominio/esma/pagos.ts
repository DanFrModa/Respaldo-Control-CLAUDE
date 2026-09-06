/**
 * PAGOS a maquileros (F6-E4; doc 07-EsMa §3, ex `EsMaPagos`) — el corazón anti-doble-pago
 * (decisión (g)). Un pago se LIGA A CARGOS: aplica un número de prendas a cada cargo consumiendo sus
 * "prendas por pagar". Reglas:
 *  • solo se paga sobre cargos `validado` NO `sinCosto`, de la EMPRESA activa y del MISMO maquilero;
 *  • `porPagar(cargo) = cantidadReal − Σ(PagoAplicacion.cantidad)`, calculado por SUMA DIRECTA bajo un
 *    `pg_advisory_xact_lock` POR MAQUILERO (nunca una columna cacheada como verdad — D3): así dos
 *    pagos concurrentes no exceden lo que queda por pagar;
 *  • pagar MÁS de lo que queda por pagar arroja `ErrorConflicto` (bloqueo DURO, no una advertencia);
 *  • el `monto` del pago = Σ(cantidad × precioReal del cargo); no se captura suelto;
 *  • se actualiza `EsMaCargo.cantidadPagada` (cache para derivar "pagado") y se recalcula el estatus
 *    `Orden.pagada` de cada orden afectada.
 *
 * Innegociables: A1 (lógica aquí), A2 (pago + aplicaciones + cache + bitácora en UNA transacción), A4
 * (`esma.ver-pagos`: el permiso #24 "ver estado de cuenta y meter SOLO pagos"), A7 (bitácora), A9
 * (empresa activa), D3 (prendas por pagar = suma de aplicaciones, no columna editable). Los IMPORTES
 * se ocultan en la lectura si falta `consultas.ver-importes`.
 */
import { esquemaPagoCrear, type PagoSalida, type PagosLista } from '../../contrato/index.js';
import { type Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { etiquetaProcesoDelCargo } from './etiqueta-cargo.js';
import { resolverConFactura } from './facturacion.js';
import { WHERE_VIVO_PAGO } from './formula-saldo.js';
import { recalcularOrdenPagada } from './orden-pagada.js';

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/**
 * Bloqueo por MAQUILERO dentro de la transacción (concurrencia, decisión (g)). Namespace propio
 * (distinto del de recibos por orden) para que dos pagos al mismo maquilero se serialicen y no
 * excedan las prendas por pagar. Se libera al commit.
 */
export async function bloquearMaquilero(
  tx: Tx,
  idEmpresa: number,
  idMaquilero: number,
): Promise<void> {
  const clave1 = ((idEmpresa * 1_000_003) ^ 0x51000000) | 0;
  const clave2 = idMaquilero | 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave1}::int, ${clave2}::int)`;
}

/**
 * ⭐⭐ PRENDAS YA PAGADAS de un cargo — **la suma que manda** (D3), y la que la fila 0.145 tuvo que
 * corregir.
 *
 * `EsMaCargo.cantidadPagada` es un CACHE (así lo dice su propio comentario en el schema); la verdad
 * es esta suma de `PagoAplicacion`. Desde la 0.145 un pago se puede CANCELAR —lo hace la corrección
 * de un movimiento sin factura—, y un pago cancelado no pagó nada: sus aplicaciones siguen ahí como
 * rastro (D3: nada se borra) pero **dejan de consumir «prendas por pagar»**.
 *
 * 🔴 Sin este filtro, corregir un pago dejaba los cargos marcados como pagados con dinero que ya no
 * existe: el saldo del maquilero bajaba (el pago cancelado deja de restar) pero sus cargos seguían
 * «cubiertos», y la orden seguía marcada como pagada. Es el error que hace que un maquilero deje de
 * cobrar lo que se le debe.
 *
 * Se llama SIEMPRE bajo el `pg_advisory_xact_lock` por maquilero (ver {@link bloquearMaquilero}).
 */
async function prendasPagadasVivas(tx: Tx, idCargo: number): Promise<number> {
  const agg = await tx.pagoAplicacion.aggregate({
    where: { idCargo, pago: WHERE_VIVO_PAGO },
    _sum: { cantidad: true },
  });
  return agg._sum.cantidad?.toNumber() ?? 0;
}

/** Una aplicación pedida: cuántas prendas de qué cargo cubre el pago. */
interface AplicacionSolicitada {
  idCargo: number;
  cantidad: number;
}

/** Lo que deja resuelto {@link aplicarACargos}: el detalle a persistir y sus efectos derivados. */
interface AplicacionResuelta {
  monto: number;
  detalle: { idCargo: number; cantidad: number; importe: number }[];
  ordenesAfectadas: Set<number>;
}

/**
 * ⭐ EL NÚCLEO de aplicar un pago a cargos (decisión (g) de F6), extraído en la fila 0.145 para que
 * la CAPTURA ({@link crearPagoMaquilero}) y la CORRECCIÓN (`esma/correccion.ts`) usen **el mismo
 * camino**: mismas guardas, mismo tope de prendas por pagar, mismo cache. Corregir un pago aplicado
 * lo re-aplica a los mismos cargos, y tiene que hacerlo con estas reglas, no con una copia.
 *
 * Valida cargo por cargo (existe, es de este maquilero y esta empresa, está validado, no es sin
 * costo, tiene precio y cantidad reales) y topa la cantidad contra las prendas por pagar VIVAS
 * ({@link prendasPagadasVivas}). Actualiza el cache `cantidadPagada` del cargo.
 *
 * ⚠️ El llamador YA tomó {@link bloquearMaquilero} y corre dentro de su transacción: esta función no
 * bloquea ni abre transacción propia. No verifica permisos (los verifica quien la llama).
 */
async function aplicarACargos(
  tx: Tx,
  sesion: SesionUsuario,
  idEmpresa: number,
  idMaquilero: number,
  aplicaciones: readonly AplicacionSolicitada[],
  /**
   * ⭐ Fila 0.145 — qué se está haciendo, para que el mensaje hable de eso. Al CORREGIR un pago se
   * re-aplican sus cargos, y si alguno se canceló entre medias el usuario recibía un error sobre
   * *«no se puede pagar hasta validarlo»* cuando lo único que quería era mover una fecha. Falla
   * cerrado en los dos casos; lo que cambia es que ahora dice la verdad de lo que pasó.
   */
  motivo: 'captura' | 'correccion' = 'captura',
): Promise<AplicacionResuelta> {
  const ordenesAfectadas = new Set<number>();
  const detalle: { idCargo: number; cantidad: number; importe: number }[] = [];
  let monto = 0;

  for (const ap of aplicaciones) {
    const cargo = await tx.esMaCargo.findFirst({
      where: { id: ap.idCargo, idEmpresa, idMaquilero },
      select: {
        id: true,
        estado: true,
        sinCosto: true,
        cantidadReal: true,
        precioReal: true,
        idOrden: true,
      },
    });
    if (cargo === null) {
      throw new ErrorNoEncontrado('EsMaCargo', ap.idCargo);
    }
    if (cargo.estado !== 'validado') {
      throw new ErrorConflicto(
        motivo === 'correccion'
          ? `Este pago cubre el cargo ${ap.idCargo}, que ya NO está validado (lo cancelaron o lo ` +
              'regresaron a revisión). Por eso no se puede corregir: al rehacerlo, ese cargo dejaría ' +
              'de estar cubierto. Revisa primero el cargo.'
          : `El cargo ${ap.idCargo} no está validado: no se puede pagar hasta validarlo.`,
      );
    }
    if (cargo.sinCosto) {
      throw new ErrorConflicto(
        motivo === 'correccion'
          ? `Este pago cubre el cargo ${ap.idCargo}, que ahora está marcado SIN COSTO. Por eso no ` +
              'se puede corregir: al rehacerlo, ese cargo ya no se le pagaría al maquilero.'
          : `El cargo ${ap.idCargo} es SIN COSTO: no se paga.`,
      );
    }
    if (cargo.precioReal === null || cargo.cantidadReal === null) {
      throw new ErrorConflicto(`El cargo ${ap.idCargo} no tiene precio/cantidad reales.`);
    }

    // Prendas por pagar = cantidadReal − Σ(aplicaciones VIVAS previas), por SUMA DIRECTA bajo lock (D3).
    const yaPagado = await prendasPagadasVivas(tx, ap.idCargo);
    const porPagar = cargo.cantidadReal.toNumber() - yaPagado;
    if (ap.cantidad > porPagar) {
      throw new ErrorConflicto(
        `No se puede pagar ${ap.cantidad} pza(s) del cargo ${ap.idCargo}: solo quedan ${porPagar} por pagar.`,
      );
    }

    const importe = ap.cantidad * cargo.precioReal.toNumber();
    detalle.push({ idCargo: ap.idCargo, cantidad: ap.cantidad, importe });
    monto += importe;

    // Actualiza el cache de prendas pagadas del cargo (para derivar "pagado").
    await tx.esMaCargo.update({
      where: { id: ap.idCargo },
      data: { cantidadPagada: yaPagado + ap.cantidad, ...datosModificacion(sesion) },
    });
    ordenesAfectadas.add(cargo.idOrden);
  }

  return { monto, detalle, ordenesAfectadas };
}

/** `include` para proyectar un pago con sus aplicaciones (orden + proceso legibles). */
const incluirPago = {
  maquilero: { select: { nombre: true } },
  aplicaciones: {
    orderBy: { idCargo: 'asc' },
    include: {
      cargo: {
        select: {
          idOrden: true,
          orden: { select: { folio: true } },
          // 0.114: el cargo puede ser de maquila (proceso) o de un servicio de la orden
          // (corte/empaque); se traen los dos y la etiqueta la redacta `etiqueta-cargo.ts`.
          servicio: true,
          tipoProceso: { select: { nombre: true } },
        },
      },
    },
  },
} satisfies Prisma.PagoMaquileroInclude;

type PagoConDetalle = Prisma.PagoMaquileroGetPayload<{ include: typeof incluirPago }>;

/** Proyecta un pago; oculta importes (monto e importes por aplicación) si no puede verlos. */
function aPagoSalida(p: PagoConDetalle, puedeVerImportes: boolean): PagoSalida {
  return {
    id: p.id,
    idEmpresa: p.idEmpresa,
    idMaquilero: p.idMaquilero,
    maquilero: p.maquilero.nombre,
    monto: puedeVerImportes ? p.monto.toNumber() : null,
    fecha: p.fecha.toISOString().slice(0, 10),
    conFactura: p.conFactura,
    observaciones: p.observaciones,
    estadoRevision: p.estadoRevision,
    aplicaciones: p.aplicaciones.map((a) => ({
      idCargo: a.idCargo,
      idOrden: a.cargo.idOrden,
      folioOrden: Number(a.cargo.orden.folio),
      tipoProceso: etiquetaProcesoDelCargo(a.cargo),
      cantidad: a.cantidad.toNumber(),
      importe: puedeVerImportes ? a.importe.toNumber() : null,
    })),
    // Fila 0.145: un pago ANULADO se sigue devolviendo, pero MARCADO (D3/A7: no se esconde nada).
    // El recibo en PDF lee esto para estamparlo — ver `impresos/impreso-recibo-pago.ts`.
    canceladoEn: p.canceladoEn === null ? null : p.canceladoEn.toISOString(),
    motivoCancelacion: p.motivoCancelacion,
    creadoEn: p.creadoEn.toISOString(),
  };
}

/**
 * Registra un PAGO a un maquilero, aplicándolo a sus cargos (decisión (g)). Ver el TSDoc del módulo
 * para las reglas (prendas por pagar bajo lock, bloqueo anti-doble-pago, monto derivado). Permiso
 * `esma.ver-pagos` (A4).
 */
export async function crearPagoMaquilero(
  sesion: SesionUsuario,
  entrada: z.input<typeof esquemaPagoCrear>,
  bd?: ContextoBd,
): Promise<PagoSalida> {
  verificarPermiso(sesion, 'esma.ver-pagos');
  const datos = validarEntrada(esquemaPagoCrear, entrada);

  // Un cargo no puede aparecer dos veces en el mismo pago (además la PK lo impide).
  const idsCargo = datos.aplicaciones.map((a) => a.idCargo);
  if (new Set(idsCargo).size !== idsCargo.length) {
    throw new ErrorValidacion('Un cargo no puede aparecer dos veces en el mismo pago.');
  }

  const idPago = await enTransaccion(async (tx) => {
    // Maquilero activo + su modalidad de facturación (decisión h).
    const prov = await tx.proveedor.findUnique({
      where: { id: datos.idMaquilero },
      select: { activo: true, nombre: true, modalidadFacturacion: true },
    });
    if (prov === null) {
      throw new ErrorNoEncontrado('Proveedor', datos.idMaquilero);
    }
    if (!prov.activo) {
      throw new ErrorConflicto(`El proveedor "${prov.nombre}" está desactivado.`);
    }
    const conFactura = resolverConFactura(prov.modalidadFacturacion, datos.conFactura);

    // Serializa por maquilero: "prendas por pagar" consistente contra pagos concurrentes.
    await bloquearMaquilero(tx, sesion.idEmpresaActiva, datos.idMaquilero);

    // Las guardas, el tope de prendas por pagar y el cache viven en UN solo sitio
    // ({@link aplicarACargos}), que es el mismo que usa la corrección de la fila 0.145.
    const {
      monto,
      detalle: aplicacionesData,
      ordenesAfectadas,
    } = await aplicarACargos(
      tx,
      sesion,
      sesion.idEmpresaActiva,
      datos.idMaquilero,
      datos.aplicaciones,
    );

    const pago = await tx.pagoMaquilero.create({
      data: {
        idEmpresa: sesion.idEmpresaActiva,
        idMaquilero: datos.idMaquilero,
        monto,
        fecha: aDateColumna(datos.fecha),
        conFactura,
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
        aplicaciones: { create: aplicacionesData },
        ...datosCreacion(sesion),
      },
    });

    // Recalcula el estatus "pagada" (derivado) de cada orden afectada.
    for (const idOrden of ordenesAfectadas) {
      await recalcularOrdenPagada(tx, sesion, idOrden);
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'PagoMaquilero',
      idEntidad: pago.id,
      accion: 'CREAR',
      datos: {
        idMaquilero: datos.idMaquilero,
        monto,
        conFactura,
        aplicaciones: aplicacionesData.map((a) => ({ idCargo: a.idCargo, cantidad: a.cantidad })),
      },
    });

    return pago.id;
  }, bd);

  return obtenerPagoMaquilero(sesion, idPago, bd);
}

/**
 * Obtiene un pago de la empresa activa (A9), o lanza `ErrorNoEncontrado`. Permiso `esma.ver-pagos`.
 *
 * ⚠️ **Devuelve TAMBIÉN los pagos ANULADOS, y a propósito** (fila 0.145): esconderlos rompería el
 * rastro que esta fila existe para conservar (D3/A7) y dejaría un id que «desaparece». Lo que NO
 * puede pasar es que se sirvan como si valieran: por eso la proyección trae `canceladoEn` y el
 * RECIBO en PDF lo estampa en grande. Los LISTADOS sí filtran los vivos —ahí un anulado sólo sería
 * ruido—; este obtener por id es el único que enseña la ficha completa.
 */
export async function obtenerPagoMaquilero(
  sesion: SesionUsuario,
  idPago: number,
  bd?: ContextoBd,
): Promise<PagoSalida> {
  verificarPermiso(sesion, 'esma.ver-pagos');
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const pago = await clienteLectura(bd).pagoMaquilero.findFirst({
    where: { id: idPago, idEmpresa: sesion.idEmpresaActiva },
    include: incluirPago,
  });
  if (pago === null) {
    throw new ErrorNoEncontrado('PagoMaquilero', idPago);
  }
  return aPagoSalida(pago, puedeVerImportes);
}

/** Lista los PAGOS de un maquilero (empresa activa, A9). Permiso `esma.ver-pagos`; oculta importes. */
export async function listarPagosMaquilero(
  sesion: SesionUsuario,
  idMaquilero: number,
  bd?: ContextoBd,
): Promise<PagosLista> {
  verificarPermiso(sesion, 'esma.ver-pagos');
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const pagos = await clienteLectura(bd).pagoMaquilero.findMany({
    // VIVOS (fila 0.145): el pago que sustituyó una corrección no se lista.
    where: { idEmpresa: sesion.idEmpresaActiva, idMaquilero, ...WHERE_VIVO_PAGO },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    include: incluirPago,
  });
  const total = puedeVerImportes ? pagos.reduce((s, p) => s + p.monto.toNumber(), 0) : null;
  return { filas: pagos.map((p) => aPagoSalida(p, puedeVerImportes)), total };
}

/**
 * ⭐ PAGO **A CUENTA** de un maquilero, SIN aplicaciones a cargos (fila 0.113).
 *
 * Existe porque la corrida semanal lo exige: §Post-F9.189(b), Daniel textual — *«yo voy decidiendo
 * los montos a pagar de cada uno. Manualmente»*. El monto que teclea NO se deriva de los cargos y
 * casi nunca los cubre exactamente, así que obligarlo a repartirlo entre cargos (lo que hace
 * {@link crearPagoMaquilero}, decisión (g) de F6) volvería impracticable la pantalla más importante
 * del sistema.
 *
 * 🔑 Y hay un caso donde NO hay a qué aplicar: el **ANTICIPO** (§Post-F9.186(h)). Un anticipo es un
 * pago sin recibos, y en la convención de EsMa el «abono» SUBE lo que se le debe al maquilero
 * mientras el pago lo BAJA — así que un anticipo tiene que ser un PAGO, y deja el saldo en negativo
 * a propósito: es lo que le debemos a la casa hasta que trabaje.
 *
 * Qué se conserva de {@link crearPagoMaquilero}: el maquilero activo, la empresa (A9), el segmento
 * de facturación por `resolverConFactura`, y la bitácora (A7). Qué NO aplica: el lock por maquilero
 * y el tope de «prendas por pagar» —no hay aplicaciones que topar—, y por eso tampoco toca
 * `cantidadPagada` ni el estatus `pagada` de ninguna orden: **este pago no dice que ningún cargo
 * concreto quedó cubierto**, sólo que salió dinero.
 *
 * ⚠️ Nace `revisado` cuando quien lo crea así lo pide, y quien lo pide es la EJECUCIÓN de la
 * corrida: el dinero ya salió y el saldo tiene que reflejarlo (el estado `capturado` existe para lo
 * que otro capturó y Daniel todavía no ha decidido — aquí la decisión ES suya, y ejecutar es el
 * acto de confirmarla).
 *
 * ⭐⭐ **Y POR ESO EXIGE `esma.revisar` CUANDO NACE `revisado`** (fila 0.128). Hoy eso **no cierra
 * ninguna puerta que no estuviera cerrada**: el único llamador es `ejecutarCorrida`
 * (`dominio/pagos/corrida.ts`), que va bajo `pagos.corrida-armar` —un permiso *más estrecho todavía*, de `SOLO_ADMINISTRADOR` porque
 * Daniel lo pidió para él (§Post-F9.189(g))—, así que quien llega aquí ya es el círculo del dueño.
 * No es una puerta lateral: es la misma persona validando por otro camino.
 *
 * 🔑 Lo que cambia es DÓNDE VIVE LA GARANTÍA. Sin la línea, la única razón por la que esta función
 * no acuña deuda validada a nombre de cualquiera es **quién resulta llamarla hoy** — y su guarda
 * propia era `esma.ver-pagos`, que en el seed tienen los OCHO perfiles. Un segundo llamador (una
 * pantalla de anticipos, un ETL, una corrida futura con otro permiso) heredaría el agujero sin que
 * nada chistara, porque la protección estaría en el llamador y no en el acto. Con la línea, la
 * regla de la fila 0.128 —*«nace `revisado` ⇒ es un acto de VALIDACIÓN»*— la impone la función que
 * escribe el estado, que es donde se puede cumplir siempre. Defensa en profundidad, la convención
 * de la casa (misma razón por la que CxP re-verifica al delegar en el motor de terceros).
 *
 * `capturado` sigue pidiendo sólo `esma.ver-pagos`: capturar un pago nunca fue validar.
 *
 * Sólo se llama DENTRO de una transacción del llamador (`tx`): el pago y el renglón de la corrida
 * que lo apunta son un solo hecho atómico (A2).
 */
export async function crearPagoACuentaMaquilero(
  tx: Tx,
  sesion: SesionUsuario,
  datos: {
    idMaquilero: number;
    monto: number;
    fecha: string;
    conFactura: boolean;
    observaciones?: string | undefined;
    estadoRevision: 'capturado' | 'revisado';
    /** Referencia legible para la bitácora (p. ej. el folio de la corrida que lo originó). */
    origenAuditoria: Record<string, unknown>;
  },
): Promise<{ id: number }> {
  verificarPermiso(sesion, 'esma.ver-pagos');
  // Nace `revisado` ⇒ es un acto de VALIDACIÓN (fila 0.128), no sólo de captura. Ver el TSDoc:
  // hoy no cierra nada nuevo —el único llamador va bajo `pagos.corrida-armar`—, pero deja la
  // garantía DENTRO del acto en vez de depender de quién resulte llamarlo.
  if (datos.estadoRevision === 'revisado') {
    verificarPermiso(sesion, 'esma.revisar');
  }

  const prov = await tx.proveedor.findUnique({
    where: { id: datos.idMaquilero },
    select: { activo: true, nombre: true, modalidadFacturacion: true },
  });
  if (prov === null) {
    throw new ErrorNoEncontrado('Proveedor', datos.idMaquilero);
  }
  if (!prov.activo) {
    throw new ErrorConflicto(`El proveedor "${prov.nombre}" está desactivado.`);
  }
  // Mismo resolvedor que el pago normal: la modalidad del proveedor manda y un proveedor sin
  // modalidad definida NO se puede pagar (lanza con su mensaje, que dice qué hacer).
  const conFactura = resolverConFactura(prov.modalidadFacturacion, datos.conFactura);

  const pago = await tx.pagoMaquilero.create({
    data: {
      idEmpresa: sesion.idEmpresaActiva,
      idMaquilero: datos.idMaquilero,
      monto: datos.monto,
      fecha: aDateColumna(datos.fecha),
      conFactura,
      estadoRevision: datos.estadoRevision,
      ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
      ...datosCreacion(sesion),
    },
  });

  await registrarBitacora(tx, sesion, {
    entidad: 'PagoMaquilero',
    idEntidad: pago.id,
    accion: 'CREAR',
    datos: {
      idMaquilero: datos.idMaquilero,
      monto: datos.monto,
      conFactura,
      aCuenta: true,
      ...datos.origenAuditoria,
    },
  });

  return { id: pago.id };
}

// ── CORRECCIÓN de un pago SIN FACTURA (fila 0.145) ────────────────────────────────────────────────
//
// Las dos mitades del acto viven aquí porque aquí viven sus reglas (las aplicaciones a cargos y el
// cache de prendas pagadas). Quien las orquesta —y quien exige la bandera de la persona— es
// `esma/correccion.ts`: estas dos funciones NO verifican la bandera ni abren transacción propia.

/** Un pago tal como lo necesita la corrección (lo lee `correccion.ts` bajo lock). */
export interface PagoParaCorregir {
  id: number;
  idMaquilero: number;
  monto: Prisma.Decimal;
  conFactura: boolean | null;
  observaciones: string | null;
  estadoRevision: 'capturado' | 'revisado';
  aplicaciones: { idCargo: number; cantidad: Prisma.Decimal }[];
}

/**
 * ⭐⭐ CANCELA un pago (suave, D3) y **DESHACE SU APLICACIÓN A LOS CARGOS**. El caso difícil de la
 * fila 0.145.
 *
 * Un pago no es un renglón suelto: consume «prendas por pagar» de cargos concretos y deja el estatus
 * `Orden.pagada` derivado de eso. Cancelarlo cambiando sólo su renglón dejaría los cargos marcados
 * como pagados con dinero que ya no existe — el maquilero dejaría de cobrar lo que se le debe.
 *
 * Qué hace, en la transacción del llamador (que YA tomó {@link bloquearMaquilero}):
 *  1. marca el pago `canceladoEn` con un `updateMany` CONDICIONAL (`canceladoEn: null`) — la lectura
 *     previa da el mensaje, la condición da la garantía (precedente F8-E3, `CLAUDE.md` §7.3);
 *  2. recalcula el cache `cantidadPagada` de cada cargo que tocaba, con la suma VIVA
 *     ({@link prendasPagadasVivas}) — que ya no cuenta las aplicaciones de este pago;
 *  3. recalcula el estatus derivado `Orden.pagada` de cada orden afectada;
 *  4. deja bitácora (A7).
 *
 * ⚠️ Las filas de `PagoAplicacion` NO se borran (D3: nada se edita ni se borra). Siguen colgando del
 * pago cancelado como rastro de lo que se hizo; lo que cambia es que la suma que manda las excluye.
 */
export async function cancelarPagoMaquileroInterno(
  tx: Tx,
  sesion: SesionUsuario,
  pago: PagoParaCorregir,
  motivo: string,
): Promise<void> {
  const cancelados = await tx.pagoMaquilero.updateMany({
    where: { id: pago.id, idEmpresa: sesion.idEmpresaActiva, ...WHERE_VIVO_PAGO },
    data: {
      canceladoEn: new Date(),
      canceladoPorId: sesion.id,
      motivoCancelacion: motivo,
      ...datosModificacion(sesion),
    },
  });
  if (cancelados.count === 0) {
    throw new ErrorConflicto(
      'Ese pago cambió mientras se corregía (alguien lo canceló en paralelo). Vuelve a consultarlo ' +
        'antes de decidir.',
    );
  }

  // Deshace la aplicación: el cache vuelve a ser la suma VIVA, que ya no cuenta este pago.
  const ordenes = new Set<number>();
  for (const ap of pago.aplicaciones) {
    const vivas = await prendasPagadasVivas(tx, ap.idCargo);
    const cargo = await tx.esMaCargo.update({
      where: { id: ap.idCargo },
      data: { cantidadPagada: vivas, ...datosModificacion(sesion) },
      select: { idOrden: true },
    });
    ordenes.add(cargo.idOrden);
  }
  for (const idOrden of ordenes) {
    await recalcularOrdenPagada(tx, sesion, idOrden);
  }

  await registrarBitacora(tx, sesion, {
    entidad: 'PagoMaquilero',
    idEntidad: pago.id,
    accion: 'CANCELAR',
    datos: {
      motivo,
      origen: 'correccion-sin-factura',
      aplicacionesDeshechas: pago.aplicaciones.map((a) => ({
        idCargo: a.idCargo,
        cantidad: a.cantidad.toNumber(),
      })),
    },
  });
}

/**
 * Captura el pago BUENO que sustituye al corregido, dentro de la misma transacción.
 *
 * Reglas propias de este acto (las de negocio; las técnicas las pone {@link aplicarACargos}):
 *  • si el pago corregido estaba APLICADO a cargos, el nuevo se aplica a **los mismos cargos con las
 *    mismas cantidades** y su `monto` se DERIVA de ahí (nunca se acepta un importe suelto: el
 *    modelo promete `monto = Σ aplicaciones.importe`);
 *  • si era un pago A CUENTA (sin aplicaciones — el de la corrida semanal, fila 0.113), el importe
 *    es libre;
 *  • el `conFactura` se COPIA verbatim del corregido: corregir nunca cambia de segmento (y así un
 *    movimiento migrado con la modalidad sin definir se puede corregir igual, REGLA 0-B);
 *  • el `estadoRevision` se hereda: corregir un pago ya revisado no lo saca del saldo a escondidas.
 *    Que heredar `revisado` exija `esma.revisar` lo verifica `correccion.ts`, como en
 *    {@link crearPagoACuentaMaquilero}.
 *
 * 🔴 **EL RENGLÓN DE LA CORRIDA SEMANAL NO SE REPUNTA — y es DELIBERADO, no un cabo suelto.**
 * Si el pago corregido nació de una corrida (fila 0.113), su `RenglonCorridaPago` sigue apuntando al
 * pago VIEJO. **No lo "arregles"**: el renglón es el registro histórico de *lo que esa corrida emitió
 * ese día*, y la corrección es un hecho POSTERIOR, ligado por `idPagoCorregido`. Repuntarlo sería
 * reescribir el pasado — justo lo que esta fila existe para evitar. Además el monto que la relación
 * reporta vive en su propia columna (`RenglonCorridaPago.monto`), así que no hay doble conteo con el
 * libro; y su FK es `@unique`, de modo que tampoco *podría* apuntar a los dos.
 */
export async function recapturarPagoCorregido(
  tx: Tx,
  sesion: SesionUsuario,
  corregido: PagoParaCorregir,
  cambios: { monto: number; fecha: string; observaciones: string | null },
): Promise<{ id: number }> {
  // Nace con el estado de revisión HEREDADO. Si ese estado es `revisado`, escribirlo es un acto de
  // VALIDACIÓN (fila 0.128), y la garantía vive DENTRO de la función que lo escribe —no en quien la
  // llame— por la misma razón que en {@link crearPagoACuentaMaquilero}.
  if (corregido.estadoRevision === 'revisado') {
    verificarPermiso(sesion, 'esma.revisar');
  }

  const idEmpresa = sesion.idEmpresaActiva;
  const aplicado = corregido.aplicaciones.length > 0;

  const resuelto = aplicado
    ? await aplicarACargos(
        tx,
        sesion,
        idEmpresa,
        corregido.idMaquilero,
        corregido.aplicaciones.map((a) => ({
          idCargo: a.idCargo,
          cantidad: a.cantidad.toNumber(),
        })),
        'correccion',
      )
    : null;
  const monto = resuelto === null ? cambios.monto : resuelto.monto;

  const pago = await tx.pagoMaquilero.create({
    data: {
      idEmpresa,
      idMaquilero: corregido.idMaquilero,
      monto,
      fecha: aDateColumna(cambios.fecha),
      conFactura: corregido.conFactura,
      estadoRevision: corregido.estadoRevision,
      ...(cambios.observaciones === null ? {} : { observaciones: cambios.observaciones }),
      ...(resuelto === null ? {} : { aplicaciones: { create: resuelto.detalle } }),
      idPagoCorregido: corregido.id,
      ...datosCreacion(sesion),
    },
  });

  if (resuelto !== null) {
    for (const idOrden of resuelto.ordenesAfectadas) {
      await recalcularOrdenPagada(tx, sesion, idOrden);
    }
  }

  await registrarBitacora(tx, sesion, {
    entidad: 'PagoMaquilero',
    idEntidad: pago.id,
    accion: 'CREAR',
    datos: {
      idMaquilero: corregido.idMaquilero,
      monto,
      conFactura: corregido.conFactura,
      correccionDe: corregido.id,
      aplicado,
    },
  });

  return { id: pago.id };
}
