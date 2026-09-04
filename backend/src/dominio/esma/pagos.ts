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
async function bloquearMaquilero(tx: Tx, idEmpresa: number, idMaquilero: number): Promise<void> {
  const clave1 = ((idEmpresa * 1_000_003) ^ 0x51000000) | 0;
  const clave2 = idMaquilero | 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave1}::int, ${clave2}::int)`;
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

    const ordenesAfectadas = new Set<number>();
    const aplicacionesData: { idCargo: number; cantidad: number; importe: number }[] = [];
    let monto = 0;

    for (const ap of datos.aplicaciones) {
      const cargo = await tx.esMaCargo.findFirst({
        where: {
          id: ap.idCargo,
          idEmpresa: sesion.idEmpresaActiva,
          idMaquilero: datos.idMaquilero,
        },
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
          `El cargo ${ap.idCargo} no está validado: no se puede pagar hasta validarlo.`,
        );
      }
      if (cargo.sinCosto) {
        throw new ErrorConflicto(`El cargo ${ap.idCargo} es SIN COSTO: no se paga.`);
      }
      if (cargo.precioReal === null || cargo.cantidadReal === null) {
        throw new ErrorConflicto(`El cargo ${ap.idCargo} no tiene precio/cantidad reales.`);
      }

      // Prendas por pagar = cantidadReal − Σ(aplicaciones previas), por SUMA DIRECTA bajo lock (D3).
      const agg = await tx.pagoAplicacion.aggregate({
        where: { idCargo: ap.idCargo },
        _sum: { cantidad: true },
      });
      const yaPagado = agg._sum.cantidad?.toNumber() ?? 0;
      const porPagar = cargo.cantidadReal.toNumber() - yaPagado;
      if (ap.cantidad > porPagar) {
        throw new ErrorConflicto(
          `No se puede pagar ${ap.cantidad} pza(s) del cargo ${ap.idCargo}: solo quedan ${porPagar} por pagar.`,
        );
      }

      const importe = ap.cantidad * cargo.precioReal.toNumber();
      aplicacionesData.push({ idCargo: ap.idCargo, cantidad: ap.cantidad, importe });
      monto += importe;

      // Actualiza el cache de prendas pagadas del cargo (para derivar "pagado").
      await tx.esMaCargo.update({
        where: { id: ap.idCargo },
        data: { cantidadPagada: yaPagado + ap.cantidad, ...datosModificacion(sesion) },
      });
      ordenesAfectadas.add(cargo.idOrden);
    }

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

/** Obtiene un pago de la empresa activa (A9), o lanza `ErrorNoEncontrado`. Permiso `esma.ver-pagos`. */
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
    where: { idEmpresa: sesion.idEmpresaActiva, idMaquilero },
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
