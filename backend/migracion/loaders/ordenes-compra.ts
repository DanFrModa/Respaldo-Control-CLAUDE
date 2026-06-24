/**
 * Loader de ÓRDENES DE COMPRA históricas (F4-E6, Pieza A).
 *
 *   `OrdCompra.csv` (7,978)    → `OrdenCompra`        (encabezado; folio = NumCompra)
 *   `OrdCompraDet.csv` (18,163) → `OrdenCompraLinea`  (renglones como TEXTO LIBRE — sin catálogo)
 *   `OrdCom-Ord.csv` (19,600)  → `OrdenCompraOrden`   (ligas N:N a órdenes de producción de F2)
 *
 * Carga vía el MODO MIGRACIÓN del dominio (`crearOCMigrada`, A1): folio EXPLÍCITO, SIN efectos de
 * kardex/recepción. Reglas DURAS (nada se pierde en silencio §7):
 *  • idEmpresa: `OrdCompra.IdEmpresas` → mapeo F1. Sin mapeo (las 6 empresas viejas inactivas) →
 *    OC OMITIDA + listada (el grueso del histórico es de empresas no migradas).
 *  • idProveedor: `OrdCompra.IdProveedor` → mapeo F1 (`Proveedor:IdProveedor`). Sin mapeo → OMITIDA.
 *  • Renglones: `OrdCompraDet.Descripcion` → `descripcionLibre` (texto libre; NO mapea a catálogo).
 *    Cantidad/Precio negativos o vacíos → 0 (saneo, listado si negativo). Descripción vacía → se
 *    usa un texto sentinela "(sin descripción)" para no perder el renglón.
 *  • Ligas N:N: cada `OrdCom-Ord.IdOrdenes` → Orden v2 (mapeo F2). Sin mapeo → liga OMITIDA + listada.
 *  • Autorización: `Autorizado`/`IdUsuAutorizado`/`FechaAutorizado`. Cancelación: `Cancelado`/
 *    `CanceladoMotivo`/`IdUsuCancelado`. Estatus derivado: cancelada > autorizada > borrador.
 *  • `IdUsuAutorizado`/`IdUsuCancelado`: NO hay mapeo de usuarios viejos→v2; se PRESERVA el id
 *    legacy como texto (las columnas no tienen FK — ADR-0005) y se reporta una sola vez.
 *  • `Totales` NO se migra (derivado de las líneas). Ventana de 10 años: configurable (ver
 *    `comun/ventana.ts`); por defecto NO recorta. Lo excluido por la ventana se cuenta y reporta.
 *
 * Idempotencia: por el `MapeoMigracion` de `IdOrdCompra` y, en su defecto, por el unique
 * `(idEmpresa, numCompra)`. En 2ª corrida no duplica.
 */
import { crearOCMigrada, type LineaOCMigrada } from '../../src/dominio/compras/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { EstatusOrdenCompra, PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import {
  cargarMapaNumerico,
  ENTIDAD_MAPEO,
  guardarMapeo,
  leerMapeo,
  type ClienteMapeo,
} from '../comun/mapeo.js';
import { conReintentoTransitorio } from '../comun/reintentos.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import {
  parsearBandera,
  parsearDinero,
  parsearFecha,
  parsearFechaSoloDia,
  parsearTexto,
} from '../comun/valores.js';
import { dentroVentana, type ConfigVentana } from '../comun/ventana.js';
import type { ResultadoLoader } from './clientes.js';

/** Texto sentinela cuando un renglón legacy no trae descripción (no se pierde el renglón). */
const DESCRIPCION_VACIA = '(sin descripción)';

/** Resultado del loader de OC. */
export interface ResultadoOrdenesCompra {
  ocs: ResultadoLoader;
  /** # de renglones (OrdenCompraLinea) creados. */
  lineas: number;
  /** # de ligas N:N (OrdenCompraOrden) creadas. */
  ligas: number;
  /** # de OC excluidas por la ventana temporal. */
  fueraVentana: number;
}

/** Mapeos + cachés que necesita cada OC. */
interface ContextoOC {
  mapaEmpresa: Map<string, number>;
  mapaProveedor: Map<string, number>;
  mapaOrden: Map<string, number>;
  detPorOC: Map<string, Record<string, string>[]>;
  ordsPorOC: Map<string, string[]>;
  ventana: ConfigVentana;
}

/** Contribución de UNA OC a los conteos. */
interface ContribOC {
  estado: 'creado' | 'existente' | 'omitido' | 'omitidoValidacion' | 'fueraVentana';
  lineas: number;
  ligas: number;
}

export async function cargarOrdenesCompra(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  ventana: ConfigVentana,
): Promise<ResultadoOrdenesCompra> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const cli = cliente as PrismaClient;

  const mapaEmpresa = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.empresa);
  const mapaProveedor = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.proveedorPorIdProveedor);
  const mapaOrden = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.orden);

  // Detalle agrupado por IdOrdCompra (lectura secuencial; el bucle solo LEE).
  const detPorOC = new Map<string, Record<string, string>[]>();
  for (const f of leerCsv('OrdCompraDet.csv')) {
    const idOC = (f.IdOrdCompra ?? '').trim();
    if (idOC === '') continue;
    const lista = detPorOC.get(idOC) ?? [];
    lista.push(f);
    detPorOC.set(idOC, lista);
  }

  // Ligas N:N agrupadas por IdOrdCompra (valores = IdOrdenes viejos, sin resolver aún).
  const ordsPorOC = new Map<string, string[]>();
  for (const f of leerCsv('OrdCom-Ord.csv')) {
    const idOC = (f.IdOrdCompra ?? '').trim();
    const idOrden = (f.IdOrdenes ?? '').trim();
    if (idOC === '' || idOrden === '') continue;
    const lista = ordsPorOC.get(idOC) ?? [];
    lista.push(idOrden);
    ordsPorOC.set(idOC, lista);
  }

  // Nota informativa única: usuarios viejos no mapeados (se preserva el id legacy como texto).
  reporte.nota(
    'OC: no hay mapeo de usuarios viejos→v2; IdUsuAutorizado/IdUsuCancelado se PRESERVAN como id ' +
      'legacy en texto (columnas sin FK, ADR-0005). No se inventa un usuario v2.',
  );

  const resultado: ResultadoOrdenesCompra = {
    ocs: { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 },
    lineas: 0,
    ligas: 0,
    fueraVentana: 0,
  };

  const ctx: ContextoOC = {
    mapaEmpresa,
    mapaProveedor,
    mapaOrden,
    detPorOC,
    ordsPorOC,
    ventana,
  };

  const filas = leerCsv('OrdCompra.csv');
  const contribs = await enLotes(
    filas,
    (f) => conReintentoTransitorio(() => procesarOC(sesion, bd, cli, reporte, f, ctx)),
    CONCURRENCIA_ETL,
  );

  for (const res of contribs) {
    if (!res.ok) {
      resultado.ocs.omitidosValidacion = (resultado.ocs.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const c = res.valor;
    if (c.estado === 'creado') resultado.ocs.creados += 1;
    else if (c.estado === 'existente') resultado.ocs.existentes += 1;
    else if (c.estado === 'omitido') resultado.ocs.omitidos += 1;
    else if (c.estado === 'fueraVentana') resultado.fueraVentana += 1;
    else resultado.ocs.omitidosValidacion = (resultado.ocs.omitidosValidacion ?? 0) + 1;
    resultado.lineas += c.lineas;
    resultado.ligas += c.ligas;
  }

  return resultado;
}

/** Deriva el estatus histórico de la OC: cancelada > autorizada > borrador. */
function estatusOCMigrada(cancelado: boolean, autorizado: boolean): EstatusOrdenCompra {
  if (cancelado) return 'cancelada';
  if (autorizado) return 'autorizada';
  return 'borrador';
}

/** Resuelve una FK obligatoria del viejo (0/vacío/sin mapeo → null). */
function resolverFk(crudo: string | undefined, mapa: Map<string, number>): number | null {
  const t = (crudo ?? '').trim();
  if (t === '' || t === '0') return null;
  return mapa.get(t) ?? null;
}

async function procesarOC(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: PrismaClient,
  reporte: Reporte,
  f: Record<string, string>,
  ctx: ContextoOC,
): Promise<ContribOC> {
  const idViejo = (f.IdOrdCompra ?? '').trim();
  const sin = (estado: ContribOC['estado']): ContribOC => ({ estado, lineas: 0, ligas: 0 });

  // Idempotencia primero.
  const ya = await leerMapeo(cliente, ENTIDAD_MAPEO.ordenCompra, idViejo);
  if (ya !== null) {
    return sin('existente');
  }

  const numCompra = parsearTexto(f.NumCompra);
  const numCompraN = numCompra === null ? null : Number(numCompra);
  if (numCompraN === null || !Number.isFinite(numCompraN)) {
    reporte.agregar('OC sin NumCompra numérico (OMITIDA)', `IdOrdCompra=${idViejo}`);
    return sin('omitido');
  }

  const idEmpresa = resolverFk(f.IdEmpresas, ctx.mapaEmpresa);
  if (idEmpresa === null) {
    reporte.agregar(
      'OC con empresa sin mapeo (OMITIDA — empresa vieja no migrada)',
      `IdOrdCompra=${idViejo} IdEmpresas=${(f.IdEmpresas ?? '').trim()}`,
    );
    return sin('omitido');
  }
  const idProveedor = resolverFk(f.IdProveedor, ctx.mapaProveedor);
  if (idProveedor === null) {
    reporte.agregar(
      'OC con proveedor sin mapeo (OMITIDA)',
      `IdOrdCompra=${idViejo} IdProveedor=${(f.IdProveedor ?? '').trim()}`,
    );
    return sin('omitido');
  }

  // Ventana temporal (por fecha de emisión).
  const fecha = parsearFechaSoloDia(f.Fecha);
  if (!dentroVentana(fecha, ctx.ventana)) {
    return sin('fueraVentana');
  }

  // Idempotencia adicional por el unique (idEmpresa, numCompra): si ya existe, mapea y sale.
  const existePorFolio = await cliente.ordenCompra.findUnique({
    where: { idEmpresa_numCompra: { idEmpresa, numCompra: BigInt(numCompraN) } },
    select: { id: true },
  });
  if (existePorFolio !== null) {
    await guardarMapeo(cliente, ENTIDAD_MAPEO.ordenCompra, idViejo, existePorFolio.id);
    return sin('existente');
  }

  // Estatus + autorización + cancelación históricas.
  const autorizado = parsearBandera(f.Autorizado);
  const cancelado = parsearBandera(f.Cancelado);
  const estatus = estatusOCMigrada(cancelado, autorizado);
  const idUsuAutorizado = autorizado ? legacyUsuario(f.IdUsuAutorizado) : null;
  const fechaAutorizado = autorizado ? parsearFecha(f.FechaAutorizado) : null;
  const canceladaPorId = cancelado ? legacyUsuario(f.IdUsuCancelado) : null;
  const motivoCancelacion = cancelado
    ? (parsearTexto(f.CanceladoMotivo) ?? 'Cancelada en sistema anterior (sin motivo registrado)')
    : null;
  // El viejo no tiene fecha de cancelación; se usa la fecha de la OC como sello informativo.
  const canceladaEn = cancelado ? (parsearFecha(f.Fecha) ?? new Date()) : null;

  // Renglones legacy (texto libre).
  const dets = ctx.detPorOC.get(idViejo) ?? [];
  const lineas: LineaOCMigrada[] = [];
  for (const d of dets) {
    const cantidad = parsearDinero(d.Cantidad);
    if (cantidad !== null && cantidad < 0) {
      reporte.agregar(
        'OC: renglón con cantidad NEGATIVA (saneada a 0)',
        `IdOrdCompra=${idViejo} IdOrdCompraDet=${(d.IdOrdCompraDet ?? '').trim()} cant=${String(cantidad)}`,
      );
    }
    const precio = parsearDinero(d.Precio);
    lineas.push({
      descripcionLibre: parsearTexto(d.Descripcion) ?? DESCRIPCION_VACIA,
      cantidad: cantidad !== null && cantidad > 0 ? cantidad : 0,
      unidad: parsearTexto(d.Unidad),
      precio: precio !== null && precio > 0 ? precio : 0,
    });
  }

  // Ligas N:N: resolver cada IdOrdenes viejo a Orden v2 (sin mapeo → liga omitida + listada).
  const idsOrdenLigada: number[] = [];
  for (const idOrdenViejo of ctx.ordsPorOC.get(idViejo) ?? []) {
    const idOrden = ctx.mapaOrden.get(idOrdenViejo);
    if (idOrden === undefined) {
      reporte.agregar(
        'OC: liga a orden de producción sin mapeo (liga OMITIDA)',
        `IdOrdCompra=${idViejo} IdOrdenes=${idOrdenViejo}`,
      );
      continue;
    }
    idsOrdenLigada.push(idOrden);
  }

  const creada = await intentarCrear(reporte, 'OrdenCompra', idViejo, () =>
    crearOCMigrada(
      sesion,
      {
        numCompra: numCompraN,
        idEmpresa,
        idProveedor,
        fecha,
        fechaEntrega: parsearFechaSoloDia(f.FechaEntrega),
        entregaEn: parsearTexto(f.EntregaEn),
        observaciones: parsearTexto(f.Observaciones),
        correspondeA: parsearTexto(f.CorrespondeA),
        facturasAmparadasLegacy: parsearTexto(f.FacturasAmparadas),
        estatus,
        idUsuAutorizado,
        fechaAutorizado,
        canceladaEn,
        canceladaPorId,
        motivoCancelacion,
        lineas,
        idsOrdenLigada,
      },
      bd,
    ),
  );
  if (creada === null) {
    return sin('omitidoValidacion');
  }
  await guardarMapeo(cliente, ENTIDAD_MAPEO.ordenCompra, idViejo, creada.idOrdenCompra);
  return { estado: 'creado', lineas: creada.lineas, ligas: creada.ligas };
}

/** Preserva el id de usuario viejo como texto (0/vacío → null). NO hay FK (ADR-0005). */
function legacyUsuario(crudo: string | undefined): string | null {
  const t = (crudo ?? '').trim();
  if (t === '' || t === '0') return null;
  return `legacy:${t}`;
}
