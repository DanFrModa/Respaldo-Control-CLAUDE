/**
 * Consultas, tableros y búsqueda de Órdenes — Módulo ÓRDENES (F2-E4; doc
 * `Documentacion_MJD/03-Produccion.md`). Es la OPERACIÓN DIARIA sobre las órdenes que la captura
 * (F2-E2/E3) creó: consultar/listar liviano (para imprimir y saltar), ver las INCOMPLETAS con un
 * semáforo de antigüedad, el TABLERO "pedidos por mes" y el BUSCADOR GLOBAL del layout.
 *
 * Diferencia con `ordenes.ts#listarOrdenes` (el listado de captura): aquí la proyección es LIGERA
 * (no embebe matriz/referencias/comentarios por fila). El `totalPiezas` y los agregados del tablero
 * salen de una SUMA en la base (no se trae toda la matriz a memoria).
 *
 * Innegociables aplicados:
 *  • A1 — toda la lógica vive aquí: el SEMÁFORO de antigüedad y los AGREGADOS los DERIVA el servidor
 *    (el front no decide nada). Las rutas (corte 2) solo validan permiso + Zod y delegan.
 *  • A4 — cada operación re-verifica `ordenes.ver` (deny-by-default).
 *  • A9 — todo se filtra por `idEmpresa` de la sesión activa (una orden de otra empresa no existe).
 *
 * Reuso (sin duplicar): la búsqueda combinada (folio si es entero + código de modelo + nombre de
 * cliente + valor de `OrdenReferencia`, D7) y el filtro por año son los MISMOS de `ordenes.ts`
 * (`armarBusquedaConSinonimos`, `rangoAnio`), reexportados desde allí.
 */
import { z } from 'zod';

import {
  esquemaIncompletasQuery,
  esquemaOrdenesBuscarQuery,
} from '../../contrato/esquemas/orden-consulta.js';
import type {
  IncompletasQuery,
  OrdenesBuscarQuery,
  OrdenesBuscarSalida,
  OrdenesIncompletasPagina,
  OrdenHitSalida,
  OrdenIncompletaSalida,
  OrdenLigeraSalida,
  SemaforoOrden,
  TableroPedidosMes,
  TableroPedidosMesFila,
} from '../../contrato/esquemas/orden-consulta.js';
import { esquemaEstadoOrden } from '../../contrato/esquemas/orden.js';
import type { Prisma } from '../../datos/index.js';

import {
  armarPagina,
  esquemaPaginacion,
  rangoPrisma,
  type Pagina,
  type Paginacion,
} from '../../comun/paginacion.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { armarBusquedaConSinonimos, rangoAnio } from './ordenes.js';

// ── Constantes del semáforo de antigüedad (regla `EsUrgente` del viejo) ──────────────

/** Umbral en días a partir del cual una orden incompleta es URGENTE (viejo: `EsUrgente`, > 7 días). */
export const DIAS_URGENTE_ORDEN = 7;
/** Umbral en días a partir del cual una orden incompleta entra en AMARILLO (atención). */
export const DIAS_AMARILLO_ORDEN = 3;

// ── Tipos internos de proyección ligera ──────────────────────────────────────────────

/** Campos mínimos que selecciona la consulta ligera (encabezado + nombres para la UI). */
const seleccionLigera = {
  id: true,
  folio: true,
  estado: true,
  fecha: true,
  fechaEntrega: true,
  creadoEn: true,
  idModelo: true,
  modelo: { select: { codigo: true, descripcion: true } },
  idCliente: true,
  cliente: { select: { nombre: true } },
  idMaquilero: true,
  maquilero: { select: { nombre: true } },
} satisfies Prisma.OrdenSelect;

/** Fila cruda de la consulta ligera (lo que devuelve Prisma con `seleccionLigera`). */
type FilaLigera = {
  id: number;
  folio: bigint;
  estado: 'capturada' | 'completa' | 'cancelada';
  fecha: Date | null;
  fechaEntrega: Date | null;
  creadoEn: Date;
  idModelo: number;
  modelo: { codigo: string; descripcion: string | null };
  idCliente: number;
  cliente: { nombre: string };
  idMaquilero: number | null;
  maquilero: { nombre: string } | null;
};

// ── Helpers de proyección/derivación ──────────────────────────────────────────────────

/** Convierte un `DateTime @db.Date` a `YYYY-MM-DD`, o `null`. */
function aFechaIso(fecha: Date | null): string | null {
  return fecha === null ? null : fecha.toISOString().slice(0, 10);
}

/** Proyecta una fila cruda + su total agregado a la salida LIGERA del contrato. */
function aOrdenLigera(fila: FilaLigera, totalPiezas: number): OrdenLigeraSalida {
  return {
    id: fila.id,
    folio: Number(fila.folio),
    estado: fila.estado,
    fecha: aFechaIso(fila.fecha),
    fechaEntrega: aFechaIso(fila.fechaEntrega),
    idModelo: fila.idModelo,
    codigoModelo: fila.modelo.codigo,
    descripcionModelo: fila.modelo.descripcion,
    idCliente: fila.idCliente,
    cliente: fila.cliente.nombre,
    idMaquilero: fila.idMaquilero,
    maquilero: fila.maquilero?.nombre ?? null,
    totalPiezas,
  };
}

/**
 * Suma de piezas (Σ de `OrdenLineaTalla.cantidad`) POR orden, para un conjunto de ids, en UNA sola
 * consulta agregada (no trae la matriz a memoria). Devuelve un mapa `idOrden -> total`; las órdenes
 * sin matriz (incompletas) no aparecen en el mapa y se proyectan con total 0. Exportada: el centro
 * de comando (R2) la reusa para la columna "Cant. ordenada".
 */
export async function totalesPorOrden(
  cliente: ReturnType<typeof clienteLectura>,
  idsOrden: number[],
): Promise<Map<number, number>> {
  const totales = new Map<number, number>();
  if (idsOrden.length === 0) {
    return totales;
  }
  // groupBy sobre las tallas, filtrando por la orden a través del renglón (relación). Es un solo
  // agregado en la base; el resultado es una fila por orden con su Σ de cantidades.
  const filas = await cliente.ordenLineaTalla.groupBy({
    by: ['idOrdenLinea'],
    where: { ordenLinea: { idOrden: { in: idsOrden } } },
    _sum: { cantidad: true },
  });
  // groupBy por `idOrdenLinea` da el total por renglón (color); hay que reagrupar por orden. Para
  // mapear renglón→orden con un solo viaje extra, traemos el par (idOrdenLinea, idOrden) ligero.
  const renglones = await cliente.ordenLinea.findMany({
    where: { idOrden: { in: idsOrden } },
    select: { id: true, idOrden: true },
  });
  const ordenPorRenglon = new Map(renglones.map((r) => [r.id, r.idOrden]));
  for (const fila of filas) {
    const idOrden = ordenPorRenglon.get(fila.idOrdenLinea);
    if (idOrden === undefined) continue;
    totales.set(idOrden, (totales.get(idOrden) ?? 0) + (fila._sum.cantidad ?? 0));
  }
  return totales;
}

/** Días COMPLETOS transcurridos desde `desde` hasta ahora (≥0). */
function diasDesde(desde: Date, ahora: Date): number {
  const ms = ahora.getTime() - desde.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Deriva el semáforo de antigüedad de una orden incompleta (regla `EsUrgente` del viejo):
 *  • `urgente` si > {@link DIAS_URGENTE_ORDEN} días (7),
 *  • `amarillo` si > {@link DIAS_AMARILLO_ORDEN} días (3) y hasta 7,
 *  • `verde` en otro caso. Exportada y probada por unit (fronteras).
 */
export function semaforoPorDias(dias: number): SemaforoOrden {
  if (dias > DIAS_URGENTE_ORDEN) return 'urgente';
  if (dias > DIAS_AMARILLO_ORDEN) return 'amarillo';
  return 'verde';
}

// ── Consulta (listado ligero con filtros de servidor) ───────────────────────────────

/**
 * Parámetros de la CONSULTA de órdenes EN DOMINIO (tipos ya nativos: `boolean`/`number`), distinto
 * del esquema de la URL del contrato (`esquemaConsultaOrdenes`, con `z.coerce`/`z.stringbool` para
 * el texto del querystring). La ruta valida/coacciona la querystring y pasa AQUÍ el resultado nativo;
 * los tests llaman con valores nativos. Re-validar el contrato (stringbool) sobre un booleano ya
 * coaccionado lanzaría (Zod 4.4.x: `stringbool` solo acepta texto) → 400 espurio; por eso el dominio
 * tiene su propio esquema con `z.boolean()` — mismo patrón que `esquemaListarTallas`/`*Dominio`.
 */
export const esquemaConsultaOrdenesDominio = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(200).optional(),
  idModelo: z.number().int().positive().optional(),
  idCliente: z.number().int().positive().optional(),
  anio: z.number().int().min(2000).max(2100).optional(),
  estado: esquemaEstadoOrden.optional(),
  incluirCanceladas: z.boolean().default(false),
  ordenarPor: z.enum(['folio', 'fecha', 'fechaEntrega', 'creadoEn']).default('folio'),
  direccion: z.enum(['asc', 'desc']).default('desc'),
});

/** Parámetros que acepta `consultarOrdenes` (forma nativa, no la de la URL). */
export type ParametrosConsultaOrdenes = z.input<typeof esquemaConsultaOrdenesDominio>;

/**
 * CONSULTA de órdenes de la empresa activa (A9) con búsqueda combinada y proyección LIGERA. Mismos
 * filtros que el listado de captura (modelo/cliente/año/estado/canceladas + búsqueda) pero sin
 * embeber la matriz: el `totalPiezas` se agrega aparte (Σ de tallas en la base). Para tablas de
 * consulta, selección masiva e impresión.
 */
export async function consultarOrdenes(
  sesion: SesionUsuario,
  parametros: ParametrosConsultaOrdenes = {},
  bd?: ContextoBd,
): Promise<Pagina<OrdenLigeraSalida>> {
  verificarPermiso(sesion, 'ordenes.ver');
  const filtros = validarEntrada(esquemaConsultaOrdenesDominio, parametros);

  const where: Prisma.OrdenWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    ...(filtros.estado === undefined ? {} : { estado: filtros.estado }),
    ...(filtros.estado === undefined && !filtros.incluirCanceladas
      ? { estado: { not: 'cancelada' } }
      : {}),
    ...(filtros.idModelo === undefined ? {} : { idModelo: filtros.idModelo }),
    ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
    ...(filtros.anio === undefined ? {} : { fecha: rangoAnio(filtros.anio) }),
    ...(await armarBusquedaConSinonimos(filtros.busqueda, bd)),
  };

  const cliente = clienteLectura(bd);
  const paginacion: Paginacion = { pagina: filtros.pagina, porPagina: filtros.porPagina };
  const [total, filas] = await Promise.all([
    cliente.orden.count({ where }),
    cliente.orden.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      select: seleccionLigera,
      ...rangoPrisma(paginacion),
    }),
  ]);

  const totales = await totalesPorOrden(
    cliente,
    filas.map((f) => f.id),
  );
  const datos = (filas as FilaLigera[]).map((f) => aOrdenLigera(f, totales.get(f.id) ?? 0));
  return armarPagina(datos, total, paginacion);
}

// ── Incompletas (capturadas sin matriz, con semáforo) ────────────────────────────────

/**
 * Órdenes INCOMPLETAS de la empresa activa: las que están en `estado='capturada'`, es decir, las
 * que NO cumplen todavía los requisitos de la regla (tallas + avíos, y arte si aplica — ver
 * `requisitos-orden.ts`). Proyección ligera + `diasAntiguedad` (desde `creadoEn`, con `fecha` como
 * respaldo) + el `semaforo` DERIVADO (> 7 días = urgente). El orden por defecto es por antigüedad
 * descendente (las más viejas primero).
 *
 * ⚠️ Ya NO es "paridad con `FechaDet Is Null`" del viejo (26-jul-2026). Con el estado automático,
 * `capturada` significa "le falta un requisito", no "no tiene matriz": una incompleta PUEDE tener
 * matriz (le puede faltar la receta de avíos) y hasta puede traer `fechaCompletada` de cuando sí
 * estuvo completa (esa fecha se sella una vez y nunca se borra). Por eso las piezas SÍ se agregan
 * —antes se proyectaban como 0— y por eso el filtro es por `estado`, no por la fecha.
 *
 * Para PROVOCAR el estado URGENTE en pruebas manuales: crear una orden (queda 'capturada') con una
 * `creadoEn` de hace > 7 días, o usar el script de demo (`scripts/datos-demo-ordenes.ts`), que
 * siembra una orden incompleta antigua. En unit se prueba `semaforoPorDias` en sus fronteras.
 */
export async function consultarIncompletas(
  sesion: SesionUsuario,
  parametros: Partial<IncompletasQuery> = {},
  bd?: ContextoBd,
  ahora: Date = new Date(),
): Promise<OrdenesIncompletasPagina> {
  verificarPermiso(sesion, 'ordenes.ver');
  const filtros = validarEntrada(esquemaIncompletasQuery, parametros);

  const where: Prisma.OrdenWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    estado: 'capturada',
  };

  const cliente = clienteLectura(bd);
  const paginacion: Paginacion = { pagina: filtros.pagina, porPagina: filtros.porPagina };
  const [total, filas] = await Promise.all([
    cliente.orden.count({ where }),
    cliente.orden.findMany({
      where,
      // Por antigüedad: la más vieja (creadoEn asc) es la más urgente. `desc` la pone primero.
      orderBy: { creadoEn: filtros.direccion === 'desc' ? 'asc' : 'desc' },
      select: seleccionLigera,
      ...rangoPrisma(paginacion),
    }),
  ]);

  const totales = await totalesPorOrden(
    cliente,
    (filas as FilaLigera[]).map((f) => f.id),
  );

  const datos: OrdenIncompletaSalida[] = (filas as FilaLigera[]).map((f) => {
    const referencia = f.creadoEn ?? f.fecha ?? ahora;
    const dias = diasDesde(referencia, ahora);
    return {
      ...aOrdenLigera(f, totales.get(f.id) ?? 0),
      diasAntiguedad: dias,
      semaforo: semaforoPorDias(dias),
    };
  });

  return {
    datos,
    total,
    pagina: paginacion.pagina,
    porPagina: paginacion.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / paginacion.porPagina)),
  };
}

// ── Tablero "pedidos por mes" ────────────────────────────────────────────────────────

/** Etiqueta corta de un mes (p. ej. "jun 2026"). */
const MESES_CORTOS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;

/** Fila cruda del agregado del tablero (Σ por orden, antes de agrupar por mes). */
interface FilaTablero {
  fecha: Date | null;
  idOrden: number;
  totalPiezas: number;
}

/**
 * Agrupa filas (una por orden, con su mes y su total de piezas) en filas de tablero por mes. Pura y
 * sin BD: la prueba unitaria la ejercita directo. Las órdenes sin `fecha` se ignoran (no caen en
 * ningún mes). Devuelve las filas en orden cronológico (anio, mes).
 */
export function agruparPorMes(filas: FilaTablero[]): TableroPedidosMesFila[] {
  const porMes = new Map<string, TableroPedidosMesFila>();
  for (const fila of filas) {
    if (fila.fecha === null) continue;
    const anio = fila.fecha.getUTCFullYear();
    const mes = fila.fecha.getUTCMonth() + 1;
    const clave = `${anio}-${String(mes).padStart(2, '0')}`;
    const existente = porMes.get(clave);
    if (existente === undefined) {
      porMes.set(clave, {
        anio,
        mes,
        clave,
        etiqueta: `${MESES_CORTOS[mes - 1]} ${anio}`,
        numOrdenes: 1,
        totalPiezas: fila.totalPiezas,
      });
    } else {
      existente.numOrdenes += 1;
      existente.totalPiezas += fila.totalPiezas;
    }
  }
  return [...porMes.values()].sort((a, b) => a.anio - b.anio || a.mes - b.mes);
}

/**
 * Filtros del TABLERO "pedidos por mes" EN DOMINIO (tipos ya nativos: `boolean`/`number`), distinto
 * del esquema de la URL del contrato (`esquemaTableroPedidosMesQuery`, con `z.coerce`/`z.stringbool`
 * para el texto del querystring). La ruta coacciona la querystring y pasa AQUÍ el valor nativo; los
 * tests llaman con valores nativos. Re-validar el contrato (stringbool) sobre el booleano ya
 * coaccionado lanzaría (Zod 4.4.x) → 400 espurio; por eso el dominio tiene su propio esquema con
 * `z.boolean()` — mismo patrón que `esquemaConsultaOrdenesDominio`/`*Dominio`.
 */
const esquemaTableroPedidosMesDominio = z.object({
  anio: z.number().int().min(2000).max(2100).optional(),
  mes: z.number().int().min(1).max(12).optional(),
  idCliente: z.number().int().positive().optional(),
  incluirCanceladas: z.boolean().default(false),
  // Banderas de paridad (viejo); sin efecto en F2 (no hay avance todavía). Se aceptan pero no se usan.
  entregadosTienda: z.boolean().optional(),
  noProducir: z.boolean().optional(),
});

/** Parámetros que acepta `tableroPedidosPorMes` (forma nativa, no la de la URL). */
export type ParametrosTableroPedidosMes = z.input<typeof esquemaTableroPedidosMesDominio>;

/**
 * TABLERO "pedidos por mes" de la empresa activa: agrega las órdenes por mes de su `fecha` con
 * métricas (número de órdenes + total de piezas). Filtros por año/mes/cliente/canceladas.
 *
 * DISEÑO EXTENSIBLE (F3): hoy solo cuenta órdenes y suma piezas. En F3, cuando exista el avance de
 * producción (corte/entregas), se sumarán columnas (piezas cortadas, entregadas, % avance) como
 * campos NUEVOS de cada fila — sin rehacer este endpoint ni romper el contrato.
 *
 * NOTA DEL VIEJO (paridad pendiente, NO inventar en F2): la consulta original filtraba
 * `EntregadoParcial = No` (excluía lo ya entregado parcialmente) y ofrecía banderas
 * `entregadosTienda`/`noProducir`. En F2 ese AVANCE todavía no existe (llega en F3), así que esas
 * banderas se aceptan en el contrato pero NO tienen efecto aún; se honrarán cuando F3 traiga el
 * motor de entregas.
 */
export async function tableroPedidosPorMes(
  sesion: SesionUsuario,
  parametros: ParametrosTableroPedidosMes = {},
  bd?: ContextoBd,
): Promise<TableroPedidosMes> {
  verificarPermiso(sesion, 'ordenes.ver');
  const filtros = validarEntrada(esquemaTableroPedidosMesDominio, parametros);

  const where: Prisma.OrdenWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    // El tablero agrupa por mes de la fecha: las órdenes sin fecha quedan fuera.
    fecha: { not: null },
    ...(filtros.incluirCanceladas ? {} : { estado: { not: 'cancelada' } }),
    ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
    ...rangoFechaTablero(filtros.anio, filtros.mes),
  };

  const cliente = clienteLectura(bd);
  const ordenes = await cliente.orden.findMany({
    where,
    select: { id: true, fecha: true },
  });

  const totales = await totalesPorOrden(
    cliente,
    ordenes.map((o) => o.id),
  );
  const filas: FilaTablero[] = ordenes.map((o) => ({
    fecha: o.fecha,
    idOrden: o.id,
    totalPiezas: totales.get(o.id) ?? 0,
  }));

  const filasMes = agruparPorMes(filas);
  return {
    filas: filasMes,
    totalOrdenes: filasMes.reduce((acc, f) => acc + f.numOrdenes, 0),
    totalPiezas: filasMes.reduce((acc, f) => acc + f.totalPiezas, 0),
  };
}

/**
 * Rango de `fecha` (@db.Date) según los filtros año/mes del tablero. Sin año → sin rango (todo lo
 * que tenga fecha). Con año y mes → ese mes. Con año sin mes → ese año natural (reusa `rangoAnio`).
 */
function rangoFechaTablero(
  anio: number | undefined,
  mes: number | undefined,
): Prisma.OrdenWhereInput {
  if (anio === undefined) {
    return {};
  }
  if (mes === undefined) {
    return { fecha: rangoAnio(anio) };
  }
  const inicio = new Date(Date.UTC(anio, mes - 1, 1));
  const fin = new Date(Date.UTC(anio, mes, 1));
  return { fecha: { gte: inicio, lt: fin } };
}

// ── Buscador global del layout ────────────────────────────────────────────────────────

/** Máximo de hits que devuelve el buscador global (suficiente para un panel de sugerencias). */
export const LIMITE_BUSCADOR_ORDENES = 20;

/**
 * BUSCADOR GLOBAL de órdenes para el layout: localiza por folio interno, código de modelo o
 * CUALQUIER valor de `OrdenReferencia` (D7) o nombre de cliente — la MISMA búsqueda combinada del
 * listado (`armarBusquedaConSinonimos`, sinónimos de departamento incluidos), pero con proyección
 * LIGERA (`{ id, folio, codigoModelo, cliente }`) y
 * tope de {@link LIMITE_BUSCADOR_ORDENES} hits. Filtra por empresa activa (A9). Excluye canceladas
 * (no se navega a algo cancelado desde el buscador rápido; la consulta sí las puede mostrar).
 */
export async function buscarOrdenesGlobal(
  sesion: SesionUsuario,
  parametros: OrdenesBuscarQuery,
  bd?: ContextoBd,
): Promise<OrdenesBuscarSalida> {
  verificarPermiso(sesion, 'ordenes.ver');
  const { q } = validarEntrada(esquemaOrdenesBuscarQuery, parametros);

  const where: Prisma.OrdenWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    estado: { not: 'cancelada' },
    ...(await armarBusquedaConSinonimos(q, bd)),
  };

  const cliente = clienteLectura(bd);
  const filas = await cliente.orden.findMany({
    where,
    orderBy: { folio: 'desc' },
    take: LIMITE_BUSCADOR_ORDENES,
    select: {
      id: true,
      folio: true,
      modelo: { select: { codigo: true } },
      cliente: { select: { nombre: true } },
    },
  });

  const datos: OrdenHitSalida[] = filas.map((f) => ({
    id: f.id,
    folio: Number(f.folio),
    codigoModelo: f.modelo.codigo,
    cliente: f.cliente.nombre,
  }));
  return { datos };
}
