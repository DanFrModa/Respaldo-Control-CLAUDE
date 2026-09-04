/**
 * ESTADO DE CUENTA de un maquilero (F6-E5; doc 07-EsMa §1/§4, ex `EsMa_EdoCta` — la pantalla más
 * completa del viejo). Dos vistas de solo lectura (A1: la lógica vive aquí):
 *
 *  1. {@link estadoCuentaMaquilero} — línea de tiempo UNIFICADA de los 4 conceptos (cargo/abono/
 *     descuento/pago) por fecha, con la marca de "pendiente de revisión" de cada renglón, MÁS el
 *     saldo derivado (reusa {@link saldoDeMaquilero}). El `monto` de cada renglón lleva SIGNO
 *     contable coherente con la fórmula del saldo: cargo (+), abono (+), pago (−), descuento (−).
 *  2. {@link estadoCuentaDesglosado} — el detalle imprimible: cargos por orden/modelo/cantidad/
 *     precio/importe + los abonos/descuentos/pagos del periodo + el saldo final. Fuente del PDF (R9)
 *     y del Excel.
 *
 * ⭐ V1-E8k (§Post-F9.136) — las DOS vistas traen además el bloque `incompletas`: las prendas que el
 * maquilero entregó SIN terminar de coser. Daniel las pidió justo aquí (*"sólo quisiera ver reflejado
 * en algún lado que sí las entrego, para revisar los temas de pago"*), y van **fuera de los cargos**:
 * no son dinero, no suman ni restan al saldo. Las dos las piden a la MISMA función
 * ({@link incompletasDeMaquilero}, en `produccion/incompletas.ts`) para no acabar diciendo números
 * distintos en la pantalla y en el papel.
 *
 * El SALDO es siempre el derivado ALL-TIME (D3; el balance actual no depende del periodo): el periodo
 * `desde/hasta` solo filtra el DETALLE de movimientos. Segmentable por facturación (decisión (h)).
 * Innegociables: A1, A4 (`esma.ver-pagos`), A9 (movimientos de la empresa activa), D3. Los IMPORTES
 * se ocultan (null) si falta `consultas.ver-importes`.
 */
import {
  esquemaEstadoCuentaQuery,
  type EstadoCuentaMovimiento,
  type EstadoCuentaSalida,
  type DesglosadoSalida,
  type MovimientoEsMaSalida,
  type PagoSalida,
  type ConceptoMovimientoEsMaClave,
} from '../../contrato/index.js';
import { type Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { ErrorNoEncontrado } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { incompletasDeMaquilero } from '../produccion/incompletas.js';

import {
  aporteCargoAlSaldo,
  pendienteDeRevisionCargo,
  pendienteDeRevisionPlano,
  WHERE_CARGO_REVISADO,
  whereSegmentoFactura,
  type SegmentoFactura,
  type WhereSegmentoFactura,
} from './formula-saldo.js';
import { saldoDeMaquilero } from './saldos.js';

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/** Redondeo monetario a 2 decimales. */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Cláusula `where` de facturación para un segmento (o `{}` si no se segmenta) — pedida a la
 * definición ÚNICA (`formula-saldo.ts` §segmento).
 *
 * 🔴 Aquí decía `{ conFactura: segmento === 'con' }`, o sea `= false` para el segmento «sin». Como
 * `conFactura` es NULLABLE, eso dejaba FUERA lo migrado del Access sin definir… mientras
 * `convivencia-esma.ts` lo metía DENTRO. Dos respuestas para la misma pregunta, con dinero en
 * medio. Ahora hay una sola: «sin factura» = `false` **o** sin definir.
 */
function conFacturaWhere(segmento: SegmentoFactura | undefined): WhereSegmentoFactura {
  return whereSegmentoFactura(segmento);
}

/** Rango sobre una columna `@db.Date` (fecha del movimiento), inclusivo en ambos extremos. */
function rangoFecha(
  desde: string | undefined,
  hasta: string | undefined,
): { fecha?: { gte?: Date; lte?: Date } } {
  if (desde === undefined && hasta === undefined) {
    return {};
  }
  return {
    fecha: {
      ...(desde === undefined ? {} : { gte: aDateColumna(desde) }),
      ...(hasta === undefined ? {} : { lte: aDateColumna(hasta) }),
    },
  };
}

/** Rango sobre `creadoEn` (datetime): [desde 00:00, hasta+1día) para incluir todo el día `hasta`. */
function rangoCreado(
  desde: string | undefined,
  hasta: string | undefined,
): { creadoEn?: { gte?: Date; lt?: Date } } {
  if (desde === undefined && hasta === undefined) {
    return {};
  }
  return {
    creadoEn: {
      ...(desde === undefined ? {} : { gte: aDateColumna(desde) }),
      ...(hasta === undefined ? {} : { lt: new Date(aDateColumna(hasta).getTime() + 86_400_000) }),
    },
  };
}

/** Exige un maquilero de la empresa activa (existe) y devuelve su nombre. */
async function exigirMaquilero(
  cliente: ReturnType<typeof clienteLectura>,
  id: number,
): Promise<string> {
  const m = await cliente.proveedor.findUnique({ where: { id }, select: { nombre: true } });
  if (m === null) {
    throw new ErrorNoEncontrado('Proveedor', id);
  }
  return m.nombre;
}

/**
 * Estado de cuenta UNIFICADO de un maquilero: los 4 conceptos del periodo fusionados en una línea de
 * tiempo ordenada por fecha (fecha ASC, luego concepto, luego id — determinista) + el saldo derivado.
 * Permiso `esma.ver-pagos`; oculta importes sin `consultas.ver-importes`.
 */
export async function estadoCuentaMaquilero(
  sesion: SesionUsuario,
  idMaquilero: number,
  parametros: z.input<typeof esquemaEstadoCuentaQuery> = {},
  bd?: ContextoBd,
): Promise<EstadoCuentaSalida> {
  verificarPermiso(sesion, 'esma.ver-pagos');
  const filtros = validarEntrada(esquemaEstadoCuentaQuery, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const maquilero = await exigirMaquilero(cliente, idMaquilero);
  const factura = conFacturaWhere(filtros.conFactura);
  const oculto = (v: number): number | null => (puedeVerImportes ? redondear2(v) : null);

  // Cargos VIVOS del periodo (por su alta a EsMa = creadoEn). Los `propuesto` salen marcados pendientes
  // (aún sin importe real → monto null); los `sinCosto` se muestran en 0 (no cuentan al saldo).
  const cargos = await cliente.esMaCargo.findMany({
    where: {
      idEmpresa,
      idMaquilero,
      estado: { not: 'cancelado' },
      ...factura,
      ...rangoCreado(filtros.desde, filtros.hasta),
    },
    select: {
      id: true,
      estado: true,
      sinCosto: true,
      cantidadReal: true,
      precioReal: true,
      creadoEn: true,
      orden: { select: { folio: true } },
      tipoProceso: { select: { nombre: true } },
    },
  });

  // Abonos / descuentos / pagos del periodo (por su fecha date-only).
  const [abonos, descuentos, pagos] = await Promise.all([
    cliente.abonoMaquilero.findMany({
      where: { idEmpresa, idMaquilero, ...factura, ...rangoFecha(filtros.desde, filtros.hasta) },
      select: { id: true, monto: true, fecha: true, observaciones: true, estadoRevision: true },
    }),
    cliente.descuentoMaquilero.findMany({
      where: { idEmpresa, idMaquilero, ...factura, ...rangoFecha(filtros.desde, filtros.hasta) },
      select: { id: true, monto: true, fecha: true, observaciones: true, estadoRevision: true },
    }),
    cliente.pagoMaquilero.findMany({
      where: { idEmpresa, idMaquilero, ...factura, ...rangoFecha(filtros.desde, filtros.hasta) },
      select: {
        id: true,
        monto: true,
        fecha: true,
        estadoRevision: true,
        aplicaciones: { select: { cargo: { select: { orden: { select: { folio: true } } } } } },
      },
    }),
  ]);

  const movimientos: EstadoCuentaMovimiento[] = [];

  for (const c of cargos) {
    const importeReal =
      c.cantidadReal === null || c.precioReal === null
        ? null
        : c.cantidadReal.toNumber() * c.precioReal.toNumber();
    // monto (signo +): validado con costo → importe real; sin costo → 0; propuesto → sin importe.
    // Quién aporta y cuánto lo decide la definición única (formula-saldo.ts), no este archivo.
    const aporte = aporteCargoAlSaldo(c, importeReal);
    const monto = aporte === null ? null : oculto(aporte);
    movimientos.push({
      concepto: 'cargo',
      id: c.id,
      fecha: c.creadoEn.toISOString().slice(0, 10),
      referencia: `Orden #${String(Number(c.orden.folio))} · ${c.tipoProceso.nombre}${c.sinCosto ? ' (sin costo)' : ''}`,
      monto,
      estadoRevision: c.estado,
      // La marca del renglón sale de la MISMA definición que la suma (formula-saldo.ts): así el
      // detalle y el total no pueden volver a contradecirse (fila 0.115).
      pendienteRevision: pendienteDeRevisionCargo(c),
    });
  }

  for (const a of abonos) {
    movimientos.push({
      concepto: 'abono',
      id: a.id,
      fecha: a.fecha.toISOString().slice(0, 10),
      referencia: a.observaciones ?? 'Abono',
      monto: oculto(a.monto.toNumber()),
      estadoRevision: a.estadoRevision,
      pendienteRevision: pendienteDeRevisionPlano(a.estadoRevision),
    });
  }

  for (const d of descuentos) {
    movimientos.push({
      concepto: 'descuento',
      id: d.id,
      fecha: d.fecha.toISOString().slice(0, 10),
      referencia: d.observaciones ?? 'Descuento',
      // Descuento resta: signo negativo.
      monto: puedeVerImportes ? -redondear2(d.monto.toNumber()) : null,
      estadoRevision: d.estadoRevision,
      pendienteRevision: pendienteDeRevisionPlano(d.estadoRevision),
    });
  }

  for (const p of pagos) {
    const folios = [...new Set(p.aplicaciones.map((ap) => Number(ap.cargo.orden.folio)))].sort(
      (x, y) => x - y,
    );
    movimientos.push({
      concepto: 'pago',
      id: p.id,
      fecha: p.fecha.toISOString().slice(0, 10),
      referencia:
        folios.length > 0
          ? `Pago · órdenes ${folios.map((f) => `#${String(f)}`).join(', ')}`
          : `Pago #${String(p.id)}`,
      // Pago resta: signo negativo.
      monto: puedeVerImportes ? -redondear2(p.monto.toNumber()) : null,
      estadoRevision: p.estadoRevision,
      pendienteRevision: pendienteDeRevisionPlano(p.estadoRevision),
    });
  }

  // Orden determinista: por fecha ASC, luego concepto (orden fijo), luego id.
  const ordenConcepto: Record<EstadoCuentaMovimiento['concepto'], number> = {
    cargo: 0,
    abono: 1,
    descuento: 2,
    pago: 3,
  };
  movimientos.sort(
    (a, b) =>
      a.fecha.localeCompare(b.fecha) ||
      ordenConcepto[a.concepto] - ordenConcepto[b.concepto] ||
      a.id - b.id,
  );

  const saldo = await saldoDeMaquilero(
    sesion,
    idMaquilero,
    filtros.conFactura === undefined ? {} : { conFactura: filtros.conFactura },
    bd,
  );

  // Bloque informativo, FUERA de `movimientos` (no lleva signo contable porque no es dinero).
  const incompletas = await incompletasDeMaquilero(cliente, {
    idEmpresa,
    idMaquilero,
    desde: filtros.desde,
    hasta: filtros.hasta,
  });

  return {
    idMaquilero,
    maquilero,
    desde: filtros.desde ?? null,
    hasta: filtros.hasta ?? null,
    conFactura: filtros.conFactura ?? null,
    saldo,
    movimientos,
    incompletas,
  };
}

// ── Desglosado (detalle imprimible) ───────────────────────────────────────────────────────────────

/** `include`/`select` de un cargo desglosado con su modelo. */
const seleccionCargoDesglosado = {
  id: true,
  sinCosto: true,
  conFactura: true,
  cantidadReal: true,
  precioReal: true,
  creadoEn: true,
  orden: { select: { folio: true, modelo: { select: { codigo: true, descripcion: true } } } },
  tipoProceso: { select: { nombre: true } },
} satisfies Prisma.EsMaCargoSelect;

/** Proyecta un abono/descuento period-filtered al contrato (oculta el monto si aplica). */
function aMovSalida(
  m: {
    id: number;
    idMaquilero: number;
    monto: Prisma.Decimal;
    fecha: Date;
    conFactura: boolean | null;
    observaciones: string | null;
    estadoRevision: 'capturado' | 'revisado';
    creadoEn: Date;
  },
  concepto: ConceptoMovimientoEsMaClave,
  maquilero: string,
  idEmpresa: number,
  puedeVerImportes: boolean,
): MovimientoEsMaSalida {
  return {
    id: m.id,
    concepto,
    idEmpresa,
    idMaquilero: m.idMaquilero,
    maquilero,
    monto: puedeVerImportes ? m.monto.toNumber() : null,
    fecha: m.fecha.toISOString().slice(0, 10),
    conFactura: m.conFactura,
    observaciones: m.observaciones,
    estadoRevision: m.estadoRevision,
    creadoEn: m.creadoEn.toISOString(),
  };
}

/**
 * Estado de cuenta DESGLOSADO de un maquilero: cargos VALIDADOS del periodo por orden/modelo (fuente
 * del PDF R9 y del Excel) + los abonos/descuentos/pagos del periodo + el saldo derivado. Permiso
 * `esma.ver-pagos`; oculta importes sin `consultas.ver-importes`.
 */
export async function estadoCuentaDesglosado(
  sesion: SesionUsuario,
  idMaquilero: number,
  parametros: z.input<typeof esquemaEstadoCuentaQuery> = {},
  bd?: ContextoBd,
): Promise<DesglosadoSalida> {
  verificarPermiso(sesion, 'esma.ver-pagos');
  const filtros = validarEntrada(esquemaEstadoCuentaQuery, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const maquilero = await exigirMaquilero(cliente, idMaquilero);
  const factura = conFacturaWhere(filtros.conFactura);

  const cargosRaw = await cliente.esMaCargo.findMany({
    where: {
      idEmpresa,
      idMaquilero,
      // Los cargos YA REVISADOS, sin costo incluidos (salen con importe 0). El criterio no se
      // escribe aquí: sale de la definición única, igual que el de la suma (fila 0.115).
      ...WHERE_CARGO_REVISADO,
      ...factura,
      ...rangoCreado(filtros.desde, filtros.hasta),
    },
    select: seleccionCargoDesglosado,
    orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }],
  });

  const cargos = cargosRaw.map((c) => {
    const cantidad = c.cantidadReal === null ? null : c.cantidadReal.toNumber();
    const precio = c.precioReal === null ? null : c.precioReal.toNumber();
    const importeBruto = cantidad === null || precio === null ? null : cantidad * precio;
    const importe =
      importeBruto === null ? null : puedeVerImportes ? redondear2(importeBruto) : null;
    return {
      idCargo: c.id,
      fecha: c.creadoEn.toISOString().slice(0, 10),
      folioOrden: Number(c.orden.folio),
      codigoModelo: c.orden.modelo.codigo,
      descripcionModelo: c.orden.modelo.descripcion,
      tipoProceso: c.tipoProceso.nombre,
      cantidad,
      precio: precio === null ? null : puedeVerImportes ? precio : null,
      importe,
      sinCosto: c.sinCosto,
      conFactura: c.conFactura,
    };
  });

  const [abonosRaw, descuentosRaw, pagosRaw] = await Promise.all([
    cliente.abonoMaquilero.findMany({
      where: { idEmpresa, idMaquilero, ...factura, ...rangoFecha(filtros.desde, filtros.hasta) },
      orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
    }),
    cliente.descuentoMaquilero.findMany({
      where: { idEmpresa, idMaquilero, ...factura, ...rangoFecha(filtros.desde, filtros.hasta) },
      orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
    }),
    cliente.pagoMaquilero.findMany({
      where: { idEmpresa, idMaquilero, ...factura, ...rangoFecha(filtros.desde, filtros.hasta) },
      orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
      include: {
        aplicaciones: {
          orderBy: { idCargo: 'asc' },
          include: {
            cargo: {
              select: {
                idOrden: true,
                orden: { select: { folio: true } },
                tipoProceso: { select: { nombre: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const abonos = abonosRaw.map((a) =>
    aMovSalida(a, 'abono', maquilero, idEmpresa, puedeVerImportes),
  );
  const descuentos = descuentosRaw.map((d) =>
    aMovSalida(d, 'descuento', maquilero, idEmpresa, puedeVerImportes),
  );
  const pagos: PagoSalida[] = pagosRaw.map((p) => ({
    id: p.id,
    idEmpresa,
    idMaquilero,
    maquilero,
    monto: puedeVerImportes ? p.monto.toNumber() : null,
    fecha: p.fecha.toISOString().slice(0, 10),
    conFactura: p.conFactura,
    observaciones: p.observaciones,
    estadoRevision: p.estadoRevision,
    aplicaciones: p.aplicaciones.map((ap) => ({
      idCargo: ap.idCargo,
      idOrden: ap.cargo.idOrden,
      folioOrden: Number(ap.cargo.orden.folio),
      tipoProceso: ap.cargo.tipoProceso.nombre,
      cantidad: ap.cantidad.toNumber(),
      importe: puedeVerImportes ? ap.importe.toNumber() : null,
    })),
    creadoEn: p.creadoEn.toISOString(),
  }));

  const saldo = await saldoDeMaquilero(
    sesion,
    idMaquilero,
    filtros.conFactura === undefined ? {} : { conFactura: filtros.conFactura },
    bd,
  );

  // La MISMA función que el estado de cuenta unificado (de aquí salen también el PDF y el Excel).
  const incompletas = await incompletasDeMaquilero(cliente, {
    idEmpresa,
    idMaquilero,
    desde: filtros.desde,
    hasta: filtros.hasta,
  });

  return {
    idMaquilero,
    maquilero,
    desde: filtros.desde ?? null,
    hasta: filtros.hasta ?? null,
    conFactura: filtros.conFactura ?? null,
    cargos,
    abonos,
    descuentos,
    pagos,
    incompletas,
    saldo,
  };
}
