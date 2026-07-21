/**
 * Helpers COMPARTIDOS de los loaders de PRODUCCIÓN (F3-E6, Pieza A): corte / envíos / recibos.
 *
 * El problema central: las tablas de detalle del viejo (`OrdenesDetCorte`, `OrdenesDetEntM/A`,
 * `OrdenesDetRecM/A`) NO traen color ni talla. Traen `IdOrdenesDet` (el renglón de `OrdenesDet`, que
 * SÍ tiene el color) + las 8 columnas posicionales `TC1..TC8` (cantidades), donde la talla de la
 * columna n se LEE de la POSICIÓN n de la cadena `Ordenes.Tallas` de la orden padre — exactamente el
 * mismo esquema posicional que F2 usó para `OrdenesDet.Tn` (ver `comun/tallas-orden.ts`).
 *
 * F2 NO guardó un mapeo `IdOrdenesDet → OrdenLinea.id` (creó un `OrdenLinea` por COLOR, agrupando).
 * Así que aquí reconstruimos lo necesario SIN crear nada nuevo (los colores/tallas ya los creó F2):
 *
 *  • {@link MapaOrdenesDet}: `IdOrdenesDet → { idOrdenViejo, color (texto crudo del viejo) }`,
 *    leído de `OrdenesDet.csv`.
 *  • {@link ContextoOrdenV2}: por cada `Orden` ya migrada (resuelta vía MapeoMigracion de F2), su
 *    matriz REAL en v2 (colores por nombre normalizado, tallas por etiqueta normalizada) + la cadena
 *    `Tallas` cruda para el despivote posicional.
 *
 * Con eso, {@link despivotarDetalle} convierte UN renglón de detalle (`IdOrdenesDet` + TC1..TC8) en
 * celdas `{ idColor, idTalla, cantidad }`, resolviendo color por el renglón `OrdenesDet` y talla por
 * la posición de la columna. Lo que NO resuelve (color no encontrado en la orden, columna con
 * cantidad pero sin etiqueta) se LISTA como incidencia y NO se pierde el dato (la cantidad se reporta).
 *
 * NUNCA crea colores/tallas al vuelo (F2 ya los creó; el histórico de producción referencia los de
 * F2). Si algo no resuelve, es una INCONSISTENCIA para Daniel, no un alta silenciosa.
 */
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { cargarMapaNumerico, ENTIDAD_MAPEO, type ClienteMapeo } from '../comun/mapeo.js';
import { MuestraAgregada } from '../comun/muestra.js';
import { mapaColumnasTalla, normalizarClaveColor } from '../comun/tallas-orden.js';
import { parsearEntero } from '../comun/valores.js';
import type { Reporte } from '../comun/reporte.js';

/** Un renglón de `OrdenesDet` del viejo: a qué orden pertenece y su color (texto crudo). */
export interface RenglonOrdenesDet {
  /** `IdOrdenes` (clave vieja de la orden). */
  idOrdenViejo: string;
  /** Texto crudo del color del renglón (p. ej. "Rojo / Marino"). */
  color: string;
}

/** Mapa `IdOrdenesDet (clave vieja) → renglón`. */
export type MapaOrdenesDet = Map<string, RenglonOrdenesDet>;

/** Lee `OrdenesDet.csv` y arma el mapa `IdOrdenesDet → { idOrdenViejo, color }`. */
export function cargarMapaOrdenesDet(): MapaOrdenesDet {
  const mapa: MapaOrdenesDet = new Map();
  for (const f of leerCsv('OrdenesDet.csv')) {
    const idDet = (f.IdOrdenesDet ?? '').trim();
    if (idDet === '') continue;
    mapa.set(idDet, {
      idOrdenViejo: (f.IdOrdenes ?? '').trim(),
      color: (f.Color ?? '').trim(),
    });
  }
  return mapa;
}

/** La matriz REAL en v2 de una orden ya migrada, lista para resolver color/talla del histórico. */
export interface ContextoOrdenV2 {
  idOrden: number;
  idEmpresa: number;
  /** color normalizado → idColor (de los renglones `OrdenLinea` de la orden). */
  idColorPorNombreNorm: Map<string, number>;
  /** etiqueta de talla normalizada → idTalla (de las tallas de la orden). */
  idTallaPorEtiquetaNorm: Map<string, number>;
  /** columna 1..8 → etiqueta de talla (despivote posicional de `Ordenes.Tallas`). */
  etiquetaPorColumna: Map<number, string>;
}

/** Caché de contextos de orden v2 (por `IdOrdenes` viejo), construida bajo demanda. */
export type CacheOrdenes = Map<string, ContextoOrdenV2 | null>;

/**
 * Resuelve y CACHEA el contexto v2 de una orden por su clave vieja `IdOrdenes`. Devuelve `null` si la
 * orden no se migró (sin mapeo) o no existe en v2 (el llamador lo reporta). Lee la matriz REAL de la
 * orden (colores de sus `OrdenLinea`, tallas de sus `OrdenLineaTalla`) + la cadena `Tallas` cruda.
 */
export async function resolverContextoOrden(
  cliente: PrismaClient,
  cache: CacheOrdenes,
  mapaOrdenV2: Map<string, number>,
  tallasCrudasPorOrdenViejo: Map<string, string>,
  idOrdenViejo: string,
): Promise<ContextoOrdenV2 | null> {
  if (cache.has(idOrdenViejo)) {
    return cache.get(idOrdenViejo) ?? null;
  }
  const idOrden = mapaOrdenV2.get(idOrdenViejo);
  if (idOrden === undefined) {
    cache.set(idOrdenViejo, null);
    return null;
  }
  const orden = await cliente.orden.findUnique({
    where: { id: idOrden },
    select: {
      id: true,
      idEmpresa: true,
      lineas: {
        select: {
          idColor: true,
          color: { select: { nombre: true } },
          tallas: { select: { idTalla: true, talla: { select: { etiqueta: true } } } },
        },
      },
    },
  });
  if (orden === null) {
    cache.set(idOrdenViejo, null);
    return null;
  }

  const idColorPorNombreNorm = new Map<string, number>();
  const idTallaPorEtiquetaNorm = new Map<string, number>();
  for (const linea of orden.lineas) {
    idColorPorNombreNorm.set(normalizarClaveColor(linea.color.nombre), linea.idColor);
    for (const t of linea.tallas) {
      idTallaPorEtiquetaNorm.set(t.talla.etiqueta.trim().toLowerCase(), t.idTalla);
    }
  }

  const crudoTallas = tallasCrudasPorOrdenViejo.get(idOrdenViejo) ?? '';
  const { porColumna } = mapaColumnasTalla(crudoTallas);

  const ctx: ContextoOrdenV2 = {
    idOrden: orden.id,
    idEmpresa: orden.idEmpresa,
    idColorPorNombreNorm,
    idTallaPorEtiquetaNorm,
    etiquetaPorColumna: porColumna,
  };
  cache.set(idOrdenViejo, ctx);
  return ctx;
}

/**
 * BUCKET AGREGADO de filas cuya ORDEN no está en el mapeo de F2 ("orden no migrada — fuera de
 * ventana u origen inválido"). Con la ventana temporal activa, F2 deja MILES de órdenes sin migrar
 * y TODA su producción/cargos cae aquí: una incidencia POR FILA inundaría el reporte. En su lugar
 * se cuenta el total y se guarda una MUESTRA (~10) de ejemplos; `volcar` escribe UNA sección con el
 * total + la muestra (nada se descarta en silencio, §7 — pero agregado, vía `comun/muestra.ts`).
 * NOTA: aquí NO hay filtro de fecha propio: si la orden migró, TODA su producción migra (la
 * historia de la orden queda completa); si no migró, todo lo suyo cae a este bucket.
 */
export class BucketOrdenNoMigrada {
  private readonly muestra = new MuestraAgregada();

  /** Registra UNA fila omitida por orden no migrada (guarda el detalle solo si cabe en la muestra). */
  registrar(detalle: string): void {
    this.muestra.agregar(detalle);
  }

  /** Total de filas registradas. */
  get conteo(): number {
    return this.muestra.conteo;
  }

  /** Vuelca el agregado al reporte como UNA sección (no-op si no acumuló nada). */
  volcar(reporte: Reporte, etiqueta: string): void {
    this.muestra.volcar(
      reporte,
      `${etiqueta}: orden no migrada — fuera de ventana u origen inválido (filas OMITIDAS, agregado)`,
    );
  }
}

/** Una celda despivotada del histórico de producción: color + talla (ids v2) + cantidad. */
export interface CeldaDetalle {
  idColor: number;
  idTalla: number;
  cantidad: number;
}

/** Las 8 cantidades posicionales TC1..TC8 de un renglón de detalle (índice 0..7; null = 0). */
export function leerCantidadesTC(f: Record<string, string>): (number | null)[] {
  return [
    parsearEntero(f.TC1),
    parsearEntero(f.TC2),
    parsearEntero(f.TC3),
    parsearEntero(f.TC4),
    parsearEntero(f.TC5),
    parsearEntero(f.TC6),
    parsearEntero(f.TC7),
    parsearEntero(f.TC8),
  ];
}

/**
 * Despivota UN renglón de detalle (su `IdOrdenesDet` + TC1..TC8) a celdas `{ idColor, idTalla,
 * cantidad }` contra el contexto v2 de su orden. Resuelve:
 *  • color: del renglón `OrdenesDet` (texto), por nombre normalizado en la matriz de la orden; si
 *    además el mapeo texto→idColor de F1 lo casa, se usa como respaldo.
 *  • talla: por la POSICIÓN n de la columna TCn → etiqueta de la cadena `Tallas` → idTalla.
 * Lo que no resuelve se LISTA (con `etiquetaIncidencia`) y NO se pierde la cantidad (se reporta).
 * Devuelve solo celdas con cantidad >0.
 */
export function despivotarDetalle(
  reporte: Reporte,
  etiquetaIncidencia: string,
  idDetViejo: string,
  ctx: ContextoOrdenV2,
  renglon: RenglonOrdenesDet,
  cantidades: (number | null)[],
  mapaColorF1Norm: Map<string, number>,
): CeldaDetalle[] {
  const sumaTotal = cantidades.reduce((a: number, c) => a + (c ?? 0), 0);

  // Color del renglón OrdenesDet → idColor de la matriz de la orden (o del mapeo F1 como respaldo).
  const colorNorm = normalizarClaveColor(renglon.color);
  const idColor = ctx.idColorPorNombreNorm.get(colorNorm) ?? mapaColorF1Norm.get(colorNorm) ?? null;
  if (idColor === null) {
    if (sumaTotal > 0) {
      reporte.agregar(
        `${etiquetaIncidencia}: color del detalle SIN match en la orden (cantidad preservada en TC?)`,
        `IdOrdenesDet=${idDetViejo} color="${renglon.color}" suma=${String(sumaTotal)}`,
      );
    }
    return [];
  }

  const celdas: CeldaDetalle[] = [];
  for (let col = 1; col <= 8; col += 1) {
    const cantidad = cantidades[col - 1] ?? 0;
    if (cantidad <= 0) continue;
    const etiqueta = ctx.etiquetaPorColumna.get(col);
    if (etiqueta === undefined) {
      reporte.agregar(
        `${etiquetaIncidencia}: cantidad en columna SIN etiqueta de talla (cantidad preservada en TC?)`,
        `IdOrdenesDet=${idDetViejo} col=TC${String(col)} cant=${String(cantidad)}`,
      );
      continue;
    }
    const idTalla = ctx.idTallaPorEtiquetaNorm.get(etiqueta.trim().toLowerCase());
    if (idTalla === undefined) {
      reporte.agregar(
        `${etiquetaIncidencia}: etiqueta de talla SIN match en la orden (cantidad preservada)`,
        `IdOrdenesDet=${idDetViejo} col=TC${String(col)} etiqueta="${etiqueta}" cant=${String(cantidad)}`,
      );
      continue;
    }
    celdas.push({ idColor, idTalla, cantidad });
  }
  return celdas;
}

/**
 * Carga el mapeo texto→idColor de F1 como `Map<nombreNormalizado, idColor>` (respaldo cuando el color
 * del renglón no aparece en la matriz de la orden, p. ej. una orden cuyas líneas no se migraron pero
 * el color sí existe en el catálogo). Lectura única al inicio del loader.
 */
export async function cargarMapaColorF1Norm(cliente: ClienteMapeo): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  for (const m of await cliente.mapeoMigracion.findMany({
    where: { entidad: ENTIDAD_MAPEO.color },
    select: { claveVieja: true, idNuevo: true },
  })) {
    const id = Number(m.idNuevo);
    if (Number.isFinite(id)) {
      mapa.set(normalizarClaveColor(m.claveVieja), id);
    }
  }
  return mapa;
}

/** Carga el mapa `IdOrdenes viejo → Orden.id v2` (MapeoMigracion de F2). */
export async function cargarMapaOrdenV2(cliente: ClienteMapeo): Promise<Map<string, number>> {
  return cargarMapaNumerico(cliente, ENTIDAD_MAPEO.orden);
}

/** Lee `Ordenes.csv` y arma `IdOrdenes → cadena Tallas cruda` (para el despivote posicional). */
export function cargarTallasCrudasPorOrden(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const f of leerCsv('Ordenes.csv')) {
    const idOrd = (f.IdOrdenes ?? '').trim();
    if (idOrd === '') continue;
    mapa.set(idOrd, f.Tallas ?? '');
  }
  return mapa;
}
