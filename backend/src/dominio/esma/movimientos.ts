/**
 * MOVIMIENTOS planos de EsMa — ABONOS y DESCUENTOS (F6-E4; doc 07-EsMa §3, ex `EsMaAbonos`/
 * `EsMaDescuentos`). Movimientos "planos": el maquilero + la fecha + las observaciones van en CADA
 * movimiento (sin encabezado). Toda la lógica vive aquí (A1); las rutas delegan.
 *
 * Innegociables: A2 (cada alta en su transacción con bitácora), A4 (`esma.modificar` para capturar;
 * la LECTURA con `esma.ver-pagos`), A7 (bitácora), A9 (empresa activa). El `conFactura` se resuelve de
 * la modalidad del proveedor (decisión (h)). Los IMPORTES se ocultan en la lectura si falta
 * `consultas.ver-importes` (server-side: el JSON no trae el monto).
 */
import {
  esquemaMovimientoEsMaCrear,
  type DatosMovimientoEsMaCrear,
  type MovimientoEsMaSalida,
  type MovimientosEsMaLista,
  type ConceptoMovimientoEsMaClave,
  type RevisionSalida,
} from '../../contrato/index.js';
import { type Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { resolverConFactura, type ModalidadFacturacion } from './facturacion.js';

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/** Datos comunes de un movimiento tras persistir, para proyectar. */
interface MovimientoFila {
  id: number;
  idEmpresa: number;
  idMaquilero: number;
  maquilero: { nombre: string };
  monto: Prisma.Decimal;
  fecha: Date;
  conFactura: boolean | null;
  observaciones: string | null;
  estadoRevision: 'capturado' | 'revisado';
  creadoEn: Date;
}

/** Proyecta un movimiento plano; oculta el monto si no puede ver importes (server-side). */
function aMovimientoSalida(
  m: MovimientoFila,
  concepto: ConceptoMovimientoEsMaClave,
  puedeVerImportes: boolean,
): MovimientoEsMaSalida {
  return {
    id: m.id,
    concepto,
    idEmpresa: m.idEmpresa,
    idMaquilero: m.idMaquilero,
    maquilero: m.maquilero.nombre,
    monto: puedeVerImportes ? m.monto.toNumber() : null,
    fecha: m.fecha.toISOString().slice(0, 10),
    conFactura: m.conFactura,
    observaciones: m.observaciones,
    estadoRevision: m.estadoRevision,
    creadoEn: m.creadoEn.toISOString(),
  };
}

/** Resuelve un maquilero de la empresa activa: existe y está activo. Devuelve nombre + modalidad. */
async function exigirMaquilero(
  tx: Tx,
  idMaquilero: number,
): Promise<{ nombre: string; modalidad: ModalidadFacturacion | null }> {
  const prov = await tx.proveedor.findUnique({
    where: { id: idMaquilero },
    select: { activo: true, nombre: true, modalidadFacturacion: true },
  });
  if (prov === null) {
    throw new ErrorNoEncontrado('Proveedor', idMaquilero);
  }
  if (!prov.activo) {
    throw new ErrorConflicto(`El proveedor "${prov.nombre}" está desactivado.`);
  }
  return { nombre: prov.nombre, modalidad: prov.modalidadFacturacion };
}

/** `include` común para proyectar un movimiento con el nombre del maquilero. */
const incluirMaquilero = { maquilero: { select: { nombre: true } } } as const;

// ── ABONOS ────────────────────────────────────────────────────────────────────────────────────

/** Captura un ABONO a la cuenta de un maquilero (A2/A7). Permiso `esma.modificar`. */
export async function crearAbonoMaquilero(
  sesion: SesionUsuario,
  entrada: z.input<typeof esquemaMovimientoEsMaCrear>,
  bd?: ContextoBd,
): Promise<MovimientoEsMaSalida> {
  verificarPermiso(sesion, 'esma.modificar');
  const datos = validarEntrada(esquemaMovimientoEsMaCrear, entrada);
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const movimiento = await enTransaccion(async (tx) => {
    const { modalidad } = await exigirMaquilero(tx, datos.idMaquilero);
    const conFactura = resolverConFactura(modalidad, datos.conFactura);
    const creado = await tx.abonoMaquilero.create({
      data: {
        idEmpresa: sesion.idEmpresaActiva,
        idMaquilero: datos.idMaquilero,
        monto: datos.monto,
        fecha: aDateColumna(datos.fecha),
        conFactura,
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
        ...datosCreacion(sesion),
      },
      include: incluirMaquilero,
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'AbonoMaquilero',
      idEntidad: creado.id,
      accion: 'CREAR',
      datos: { idMaquilero: datos.idMaquilero, monto: datos.monto, conFactura },
    });
    return creado;
  }, bd);

  return aMovimientoSalida(movimiento, 'abono', puedeVerImportes);
}

/** Lista los ABONOS de un maquilero (empresa activa, A9). Permiso `esma.ver-pagos`; oculta importes. */
export async function listarAbonosMaquilero(
  sesion: SesionUsuario,
  idMaquilero: number,
  bd?: ContextoBd,
): Promise<MovimientosEsMaLista> {
  verificarPermiso(sesion, 'esma.ver-pagos');
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const filas = await clienteLectura(bd).abonoMaquilero.findMany({
    where: { idEmpresa: sesion.idEmpresaActiva, idMaquilero },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    include: incluirMaquilero,
  });
  const total = puedeVerImportes ? filas.reduce((s, f) => s + f.monto.toNumber(), 0) : null;
  return { filas: filas.map((f) => aMovimientoSalida(f, 'abono', puedeVerImportes)), total };
}

// ── DESCUENTOS ────────────────────────────────────────────────────────────────────────────────

/** Captura un DESCUENTO a la cuenta de un maquilero (A2/A7). Permiso `esma.modificar`. */
export async function crearDescuentoMaquilero(
  sesion: SesionUsuario,
  entrada: z.input<typeof esquemaMovimientoEsMaCrear>,
  bd?: ContextoBd,
): Promise<MovimientoEsMaSalida> {
  verificarPermiso(sesion, 'esma.modificar');
  const datos: DatosMovimientoEsMaCrear = validarEntrada(esquemaMovimientoEsMaCrear, entrada);
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const movimiento = await enTransaccion(async (tx) => {
    const { modalidad } = await exigirMaquilero(tx, datos.idMaquilero);
    const conFactura = resolverConFactura(modalidad, datos.conFactura);
    const creado = await tx.descuentoMaquilero.create({
      data: {
        idEmpresa: sesion.idEmpresaActiva,
        idMaquilero: datos.idMaquilero,
        monto: datos.monto,
        fecha: aDateColumna(datos.fecha),
        conFactura,
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
        ...datosCreacion(sesion),
      },
      include: incluirMaquilero,
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'DescuentoMaquilero',
      idEntidad: creado.id,
      accion: 'CREAR',
      datos: { idMaquilero: datos.idMaquilero, monto: datos.monto, conFactura },
    });
    return creado;
  }, bd);

  return aMovimientoSalida(movimiento, 'descuento', puedeVerImportes);
}

/** Lista los DESCUENTOS de un maquilero (empresa activa, A9). Permiso `esma.ver-pagos`; oculta importes. */
export async function listarDescuentosMaquilero(
  sesion: SesionUsuario,
  idMaquilero: number,
  bd?: ContextoBd,
): Promise<MovimientosEsMaLista> {
  verificarPermiso(sesion, 'esma.ver-pagos');
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const filas = await clienteLectura(bd).descuentoMaquilero.findMany({
    where: { idEmpresa: sesion.idEmpresaActiva, idMaquilero },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    include: incluirMaquilero,
  });
  const total = puedeVerImportes ? filas.reduce((s, f) => s + f.monto.toNumber(), 0) : null;
  return { filas: filas.map((f) => aMovimientoSalida(f, 'descuento', puedeVerImportes)), total };
}

// ── Revisión / autorización de una partida (F6-E5) ──────────────────────────────────────────────

/**
 * REVISA (autoriza) una partida `capturado` → `revisado` (F6-E5; ex asteriscos `Rev`/`RevRec` del
 * `EsMa_EdoCta` viejo). Aplica a abonos, descuentos y pagos. En UNA transacción (A2) con bitácora
 * (A7). Idempotencia dura: si ya estaba `revisado`, lanza `ErrorConflicto` (409). Permiso
 * `esma.modificar` (A4); solo la empresa activa (A9). Es el "punto de control del admin" del viejo,
 * operable también desde el celular (E5 vista móvil).
 */
export async function revisarMovimiento(
  sesion: SesionUsuario,
  concepto: ConceptoMovimientoEsMaClave,
  id: number,
  bd?: ContextoBd,
): Promise<RevisionSalida> {
  verificarPermiso(sesion, 'esma.modificar');
  const idEmpresa = sesion.idEmpresaActiva;

  const entidadBitacora =
    concepto === 'abono'
      ? 'AbonoMaquilero'
      : concepto === 'descuento'
        ? 'DescuentoMaquilero'
        : 'PagoMaquilero';

  await enTransaccion(async (tx) => {
    // Lee el estado actual del movimiento del concepto (siempre acotado a la empresa activa, A9).
    const actual =
      concepto === 'abono'
        ? await tx.abonoMaquilero.findFirst({
            where: { id, idEmpresa },
            select: { estadoRevision: true },
          })
        : concepto === 'descuento'
          ? await tx.descuentoMaquilero.findFirst({
              where: { id, idEmpresa },
              select: { estadoRevision: true },
            })
          : await tx.pagoMaquilero.findFirst({
              where: { id, idEmpresa },
              select: { estadoRevision: true },
            });

    if (actual === null) {
      throw new ErrorNoEncontrado(entidadBitacora, id);
    }
    if (actual.estadoRevision === 'revisado') {
      throw new ErrorConflicto('Esa partida ya está revisada.');
    }

    const datos = { estadoRevision: 'revisado' as const, ...datosModificacion(sesion) };
    if (concepto === 'abono') {
      await tx.abonoMaquilero.update({ where: { id }, data: datos });
    } else if (concepto === 'descuento') {
      await tx.descuentoMaquilero.update({ where: { id }, data: datos });
    } else {
      await tx.pagoMaquilero.update({ where: { id }, data: datos });
    }

    await registrarBitacora(tx, sesion, {
      entidad: entidadBitacora,
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: { accion: 'revisar', estadoRevision: 'revisado' },
    });
  }, bd);

  return { concepto, id, estadoRevision: 'revisado' };
}
