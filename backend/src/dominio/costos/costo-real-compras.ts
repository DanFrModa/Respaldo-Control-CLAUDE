/**
 * COSTO REAL DE MATERIALES DESDE LAS ÓRDENES DE COMPRA (petición de DANIEL, 26-jul-2026 —
 * `DECISIONES.md` §Post-F9.5). Toda la lógica vive AQUÍ (A1); las rutas solo validan permiso + Zod.
 *
 * EL PROBLEMA. Hasta hoy el costo de materiales de una orden se calculaba con la RECETA del modelo
 * por los precios de CATÁLOGO (`Tela.precioSugerido` / `Avio.precioReferencia`, ver `costo-orden.ts`
 * → `teoricoPorPrenda`). Daniel: eso NO refleja la realidad, porque al comprar cambian con
 * frecuencia el PROVEEDOR y el PRECIO de un material para esa orden concreta — y en v2 todo eso ya
 * queda registrado en las órdenes de compra ligadas a la orden de producción
 * (`OrdenCompraLinea.idOrden`, R7/F4).
 *
 * LAS TRES REGLAS DE NEGOCIO (respuestas textuales de Daniel, no se re-preguntan):
 *  1. **Manda lo COMPRADO: la OC autorizada** (no lo recibido, no lo surtido).
 *  2. Los **avíos genéricos** (de stock, `Avio.esGenerico`, que no se compran por orden) se valúan
 *     al **último precio de compra**.
 *  3. Cuando una compra **surte a más de una orden, el costo se PRORRATEA**.
 *
 * EL MOTOR: atribución directa + valuación por consumo. Por cada material de la orden,
 *
 *    costo real = IMPORTE DIRECTO  +  IMPORTE VALUADO
 *
 *  • **IMPORTE DIRECTO** (regla 1) = Σ (cantidad × precio) de las líneas de OC **ligadas a esta
 *    orden** (`idOrden`) cuya OC esté en `autorizada` / `recibida_parcial` / `recibida_total`.
 *    Quedan FUERA `borrador`, `pendiente_autorizacion` y `cancelada`. SIN impuestos (la OC no los
 *    modela) y sin descuentos (tampoco existen en el renglón): el importe es literal.
 *  • **IMPORTE VALUADO** (reglas 2 y 3) = el consumo que la orden requiere y que NO tiene compra
 *    propia ligada — `max(0, requerido − comprado)` — valuado al **ÚLTIMO PRECIO DE COMPRA** de ese
 *    material (la línea de OC autorizada+ más reciente de la EMPRESA ACTIVA, sin importar a qué
 *    orden estuviera ligada). Ahí caen los genéricos (regla 2) y las compras grandes hechas sin
 *    `idOrden`: cada orden se lleva su parte **en proporción a su consumo**, que es exactamente el
 *    prorrateo que pidió Daniel (regla 3). Si el material NUNCA se ha comprado, cae al precio de
 *    CATÁLOGO y se AVISA; si tampoco hay catálogo, cuenta 0 y se AVISA.
 *
 * DE DÓNDE SALE EL "REQUERIDO": del **snapshot del MRP** (`RequerimientoOrden.cantidadRequerida`, el
 * consumo BRUTO antes del neteo contra stock — por eso los genéricos sí se costean aunque salgan del
 * almacén). Si la orden no tiene explosión, se calcula con la receta `paraCosto` × piezas, la MISMA
 * base que el teórico (`cortado`, o `pedido` si aún no hay corte) para que ambos números sean
 * comparables.
 *
 * UNIDADES (R1, `comun/conversion.ts`): el IMPORTE directo nunca necesita conversión (la invariante
 * de valuación dice que `cantidad × precio` no cambia al convertir). Sí la necesitan la CANTIDAD
 * comprada (para restarla del requerido, que está en unidad de consumo del BOM) y el ÚLTIMO PRECIO.
 * Se aplica EXACTAMENTE la misma regla que usa la recepción (`dominio/compras/recepciones.ts`), para
 * que el real cuadre con lo que entra al kardex: **tela → factor 1** (la OC de tela ya va en unidad
 * de uso); **avío → `AvioProveedor.factorConversion` del proveedor de la OC → `Avio.factorConversion`
 * → 1**.
 *
 * QUÉ NO HACE (por diseño):
 *  • NO toca los PROCESOS (maquila / arte / bordados): esos no se compran con OC de material.
 *  • Las líneas de OC **LIBRES** (`descripcionLibre`, sin material de catálogo) ligadas a la orden se
 *    REPORTAN aparte (`importeLibre`) y NO se suman a tela ni a avíos: no hay forma de clasificarlas
 *    automáticamente. Se avisa para que el usuario las capture en "Otros" si aplica.
 *  • NO escribe nada: es lectura pura. Quien congela el resultado es `guardarCostoOrden`
 *    (`CostoOrden.telaReal`/`aviosReal`).
 *
 * Innegociables: A1 (lógica aquí), A4 (`costos.ver`), A9 (todo acotado a la empresa activa: la orden,
 * las OC ligadas y las OC del último precio), D1 (precio ACTUAL: el último de compra o el de
 * catálogo vigente, nunca un `CostoViejo`). Importes en `null` sin `consultas.ver-importes`.
 */
import type {
  CostoRealOrdenSalida,
  CostoRealResumen,
  OrigenPrecioReal,
  OrigenRequerido,
} from '../../contrato/index.js';
import { EstatusOrdenCompra, type Prisma } from '../../datos/index.js';

import { resolverFactor } from '../../comun/conversion.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';

import { cantidadesDeOrden } from './cantidades.js';
import { num, numOrNull, redondear2 } from './decimales.js';

/** Cliente de LECTURA. */
type ClienteLectura = ReturnType<typeof clienteLectura>;

/**
 * Estatus de OC que cuentan como COMPRADO (regla 1 de Daniel: manda lo AUTORIZADO, no lo recibido).
 * Quedan fuera `borrador`, `pendiente_autorizacion` y `cancelada`.
 */
export const ESTATUS_COMPRADO: readonly EstatusOrdenCompra[] = [
  EstatusOrdenCompra.autorizada,
  EstatusOrdenCompra.recibida_parcial,
  EstatusOrdenCompra.recibida_total,
];

/** Tolerancia de comparación de cantidades decimales (4 decimales en BD). */
const TOLERANCIA = 1e-6;

/** Redondeo de cantidades a 4 decimales (la precisión de `RequerimientoOrden.cantidadRequerida`). */
function redondear4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ── Tipos de ENTRADA del núcleo puro (los arma el lector de BD de más abajo) ─────────────────────

/** Referencia a una orden de compra (trazabilidad: qué OC, de quién y cuándo). */
export interface ReferenciaCompra {
  idOrdenCompra: number;
  numCompra: number;
  estatus: string;
  /** Fecha de la OC en `YYYY-MM-DD` (o null si la OC no la trae). */
  fecha: string | null;
  idProveedor: number;
  proveedor: string;
}

/** Un material que la orden REQUIERE (del snapshot del MRP o de la receta), con sus precios. */
export interface RequeridoMaterial {
  /** Clave de cruce: `tela-<id>` / `avio-<id>`. */
  clave: string;
  tipo: 'tela' | 'avio';
  idTela: number | null;
  idAvio: number | null;
  material: string;
  unidad: string | null;
  esGenerico: boolean;
  /** Consumo BRUTO de la orden, en unidad de consumo del BOM. */
  requerido: number;
  /** Último precio de compra POR UNIDAD DE CONSUMO (ya normalizado, R1), o null si nunca se compró. */
  ultimoPrecio: number | null;
  /** OC de la que salió ese último precio (null si no hay). */
  ultimaCompra: ReferenciaCompra | null;
  /** Precio de CATÁLOGO por unidad de consumo (`Tela.precioSugerido` / `Avio.precioReferencia`). */
  precioCatalogo: number | null;
}

/** Una línea de OC (autorizada+) LIGADA a la orden de producción. */
export interface LineaCompraLigada {
  /** Clave de cruce: `tela-<id>` / `avio-<id>` / `libre:<descripción>`. */
  clave: string;
  tipo: 'tela' | 'avio' | 'libre';
  idTela: number | null;
  idAvio: number | null;
  material: string;
  /** Cantidad tal cual del renglón (unidad de COMPRA). */
  cantidad: number;
  /** La misma cantidad ya en UNIDAD DE CONSUMO del BOM (R1) — para restarla del requerido. */
  cantidadConsumo: number;
  unidad: string | null;
  precio: number;
  compra: ReferenciaCompra;
}

// ── Tipos de SALIDA del núcleo puro (números crudos; el gate de importes se aplica al proyectar) ──

/** Un material ya resuelto: cuánto vino de compra directa y cuánto de valuación. */
export interface MaterialRealCalculado {
  tipo: 'tela' | 'avio' | 'libre';
  idTela: number | null;
  idAvio: number | null;
  material: string;
  unidad: string | null;
  esGenerico: boolean;
  requerido: number;
  comprado: number;
  compras: (ReferenciaCompra & {
    cantidad: number;
    unidad: string | null;
    precio: number;
    importe: number;
  })[];
  importeDirecto: number;
  cantidadValuada: number;
  precioValuado: number | null;
  importeValuado: number;
  origenPrecio: OrigenPrecioReal;
  ultimaCompra: ReferenciaCompra | null;
  importe: number;
}

/** Resultado completo del cálculo (crudo). */
export interface CostoRealCalculado {
  tela: number;
  avios: number;
  total: number;
  importeDirecto: number;
  importeValuado: number;
  importeLibre: number;
  hayCompras: boolean;
  materiales: MaterialRealCalculado[];
  avisos: string[];
}

// ── NÚCLEO PURO (sin BD — es lo que ejercitan los tests unitarios) ────────────────────────────────

/**
 * Combina el REQUERIDO de la orden con las COMPRAS ligadas y produce el costo real por material.
 * Función PURA: recibe todo ya leído (requeridos con su último precio/catálogo, y las líneas de OC
 * ligadas ya filtradas por estatus y por empresa) y no toca la base de datos.
 *
 * Reglas aplicadas, en este orden, por material:
 *  1. `importeDirecto` = Σ (cantidad × precio) de sus líneas de OC ligadas → regla 1 de Daniel.
 *  2. `cantidadValuada` = max(0, requerido − comprado) → lo que la orden consume pero no compró.
 *  3. `precioValuado` = último precio de compra → catálogo (con aviso) → 0 (con aviso) → reglas 2 y 3.
 *  4. `importe` = directo + valuado; se acumula en TELA o en AVÍOS según el tipo.
 * Las compras LIBRES se acumulan aparte (`importeLibre`) y NO entran a los totales.
 */
export function combinarCostoReal(
  requeridos: readonly RequeridoMaterial[],
  lineas: readonly LineaCompraLigada[],
): CostoRealCalculado {
  const avisos: string[] = [];

  // Agrupa las líneas ligadas por material.
  const porClave = new Map<string, LineaCompraLigada[]>();
  for (const l of lineas) {
    const lista = porClave.get(l.clave) ?? [];
    lista.push(l);
    porClave.set(l.clave, lista);
  }

  const materiales: MaterialRealCalculado[] = [];
  const clavesUsadas = new Set<string>();
  let tela = 0;
  let avios = 0;
  let importeDirecto = 0;
  let importeValuado = 0;
  let importeLibre = 0;
  let hayCompras = false;

  /** Proyecta las líneas de un material a la forma de trazabilidad + su importe directo. */
  const armarCompras = (
    lista: readonly LineaCompraLigada[],
  ): { compras: MaterialRealCalculado['compras']; directo: number; comprado: number } => {
    let directo = 0;
    let comprado = 0;
    const compras = lista.map((l) => {
      const importe = l.cantidad * l.precio;
      directo += importe;
      comprado += l.cantidadConsumo;
      return {
        ...l.compra,
        cantidad: redondear4(l.cantidad),
        unidad: l.unidad,
        precio: redondear2(l.precio),
        importe: redondear2(importe),
      };
    });
    return { compras, directo, comprado };
  };

  // 1) Un renglón por material REQUERIDO (el caso normal).
  for (const r of requeridos) {
    clavesUsadas.add(r.clave);
    const lista = porClave.get(r.clave) ?? [];
    if (lista.length > 0) {
      hayCompras = true;
    }
    const { compras, directo, comprado } = armarCompras(lista);

    const cantidadValuada = Math.max(0, r.requerido - comprado);
    let precioValuado: number | null = null;
    let origenPrecio: OrigenPrecioReal;
    if (cantidadValuada <= TOLERANCIA) {
      // Nada que valuar: o la compra ligada cubre todo el consumo, o no hay consumo ni compra.
      origenPrecio = lista.length > 0 ? 'compra-directa' : 'sin-precio';
    } else if (r.ultimoPrecio !== null) {
      precioValuado = r.ultimoPrecio;
      origenPrecio = 'ultimo-precio-compra';
    } else if (r.precioCatalogo !== null) {
      precioValuado = r.precioCatalogo;
      origenPrecio = 'catalogo';
      avisos.push(
        `«${r.material}» nunca se ha comprado con orden de compra: se valuó a precio de catálogo.`,
      );
    } else {
      origenPrecio = 'sin-precio';
      avisos.push(
        `«${r.material}» no tiene precio (ni compras ni catálogo): se valuó en $0. Revísalo.`,
      );
    }

    const valuado = cantidadValuada * (precioValuado ?? 0);
    const importe = directo + valuado;
    importeDirecto += directo;
    importeValuado += valuado;
    if (r.tipo === 'tela') {
      tela += importe;
    } else {
      avios += importe;
    }

    materiales.push({
      tipo: r.tipo,
      idTela: r.idTela,
      idAvio: r.idAvio,
      material: r.material,
      unidad: r.unidad,
      esGenerico: r.esGenerico,
      requerido: redondear4(r.requerido),
      comprado: redondear4(comprado),
      compras,
      importeDirecto: redondear2(directo),
      cantidadValuada: redondear4(cantidadValuada),
      precioValuado: precioValuado === null ? null : redondear2(precioValuado),
      importeValuado: redondear2(valuado),
      origenPrecio,
      ultimaCompra: origenPrecio === 'ultimo-precio-compra' ? r.ultimaCompra : null,
      importe: redondear2(importe),
    });
  }

  // 2) Materiales COMPRADOS para la orden que NO aparecen en el requerido (fuera del BOM, o compras
  //    libres). Su compra SÍ es real: entra al costo (las de catálogo) o se reporta aparte (libres).
  let renglonesLibres = 0;
  for (const [clave, lista] of porClave) {
    if (clavesUsadas.has(clave)) continue;
    const primera = lista[0];
    if (primera === undefined) continue;
    const { compras, directo, comprado } = armarCompras(lista);

    if (primera.tipo === 'libre') {
      renglonesLibres += lista.length;
      importeLibre += directo;
    } else {
      hayCompras = true;
      importeDirecto += directo;
      if (primera.tipo === 'tela') {
        tela += directo;
      } else {
        avios += directo;
      }
      avisos.push(
        `«${primera.material}» tiene compra ligada a la orden pero NO aparece en el requerido ` +
          `(ni en el MRP ni en la receta): su compra SÍ entra al costo real.`,
      );
    }

    materiales.push({
      tipo: primera.tipo,
      idTela: primera.idTela,
      idAvio: primera.idAvio,
      material: primera.material,
      unidad: primera.unidad,
      esGenerico: false,
      requerido: 0,
      comprado: redondear4(comprado),
      compras,
      importeDirecto: redondear2(directo),
      cantidadValuada: 0,
      precioValuado: null,
      importeValuado: 0,
      origenPrecio: 'compra-directa',
      ultimaCompra: null,
      importe: primera.tipo === 'libre' ? 0 : redondear2(directo),
    });
  }

  if (renglonesLibres > 0) {
    avisos.push(
      `${renglonesLibres} renglón(es) de compra LIBRE ligados a la orden por ` +
        `${redondear2(importeLibre).toFixed(2)}: no se pueden clasificar como tela ni avío, así que ` +
        `NO entran al costo real. Captúralos en "Otros" si corresponden a esta orden.`,
    );
  }

  return {
    tela: redondear2(tela),
    avios: redondear2(avios),
    total: redondear2(tela + avios),
    importeDirecto: redondear2(importeDirecto),
    importeValuado: redondear2(importeValuado),
    importeLibre: redondear2(importeLibre),
    hayCompras,
    materiales,
    avisos,
  };
}

// ── LECTURA de la base de datos ───────────────────────────────────────────────────────────────────

/** Fecha `Date` de columna date-only → `YYYY-MM-DD` (o null). */
function aFechaCorta(fecha: Date | null): string | null {
  return fecha === null ? null : fecha.toISOString().slice(0, 10);
}

/** `select` de una línea de OC ligada con su encabezado (para importe + trazabilidad). */
const seleccionLineaOc = {
  id: true,
  idTela: true,
  idAvio: true,
  descripcionLibre: true,
  cantidad: true,
  unidad: true,
  precio: true,
  tela: { select: { nombre: true } },
  avio: { select: { clave: true, descripcion: true } },
  ordenCompra: {
    select: {
      id: true,
      numCompra: true,
      estatus: true,
      fecha: true,
      idProveedor: true,
      proveedor: { select: { nombre: true } },
    },
  },
} satisfies Prisma.OrdenCompraLineaSelect;

type LineaOcLeida = Prisma.OrdenCompraLineaGetPayload<{ select: typeof seleccionLineaOc }>;

/** Referencia de trazabilidad a partir del encabezado leído. */
function referencia(l: LineaOcLeida): ReferenciaCompra {
  return {
    idOrdenCompra: l.ordenCompra.id,
    numCompra: Number(l.ordenCompra.numCompra),
    estatus: l.ordenCompra.estatus,
    fecha: aFechaCorta(l.ordenCompra.fecha),
    idProveedor: l.ordenCompra.idProveedor,
    proveedor: l.ordenCompra.proveedor.nombre,
  };
}

/** Nombre legible de un material a partir de la línea (tela, avío o libre). */
function nombreMaterial(l: LineaOcLeida): string {
  if (l.tela !== null) return l.tela.nombre;
  if (l.avio !== null) return `${l.avio.clave} — ${l.avio.descripcion}`;
  return l.descripcionLibre ?? '(compra libre)';
}

/** Clave de cruce de una línea de OC. */
function claveLinea(l: LineaOcLeida): string {
  if (l.idTela !== null) return `tela-${String(l.idTela)}`;
  if (l.idAvio !== null) return `avio-${String(l.idAvio)}`;
  return `libre:${l.descripcionLibre ?? ''}`;
}

/**
 * FACTOR de conversión presentación→consumo de una línea de OC (R1), con la MISMA cascada que usa la
 * recepción (`recepciones.ts`): tela ⇒ 1; avío ⇒ `AvioProveedor.factorConversion` (del proveedor de
 * la OC) → `Avio.factorConversion` → 1. Recibe los factores ya leídos en bloque (sin N+1).
 */
function factorDeLinea(
  l: LineaOcLeida,
  factoresAvio: Map<number, number | null>,
  factoresAvioProveedor: Map<string, number | null>,
): number {
  if (l.idAvio === null) {
    return 1;
  }
  const porProveedor = factoresAvioProveedor.get(
    `${String(l.idAvio)}-${String(l.ordenCompra.idProveedor)}`,
  );
  return resolverFactor(porProveedor ?? null, factoresAvio.get(l.idAvio) ?? null);
}

/** Lee, en dos consultas, los factores de conversión de los avíos que aparecen en unas líneas. */
async function leerFactores(
  cliente: ClienteLectura,
  lineas: readonly LineaOcLeida[],
): Promise<{
  factoresAvio: Map<number, number | null>;
  factoresAvioProveedor: Map<string, number | null>;
}> {
  const idsAvio = [...new Set(lineas.flatMap((l) => (l.idAvio === null ? [] : [l.idAvio])))];
  const factoresAvio = new Map<number, number | null>();
  const factoresAvioProveedor = new Map<string, number | null>();
  if (idsAvio.length === 0) {
    return { factoresAvio, factoresAvioProveedor };
  }
  const idsProveedor = [...new Set(lineas.map((l) => l.ordenCompra.idProveedor))];
  const [avios, pares] = await Promise.all([
    cliente.avio.findMany({
      where: { id: { in: idsAvio } },
      select: { id: true, factorConversion: true },
    }),
    cliente.avioProveedor.findMany({
      where: { idAvio: { in: idsAvio }, idProveedor: { in: idsProveedor } },
      select: { idAvio: true, idProveedor: true, factorConversion: true },
    }),
  ]);
  for (const a of avios) {
    factoresAvio.set(a.id, numOrNull(a.factorConversion));
  }
  for (const p of pares) {
    factoresAvioProveedor.set(
      `${String(p.idAvio)}-${String(p.idProveedor)}`,
      numOrNull(p.factorConversion),
    );
  }
  return { factoresAvio, factoresAvioProveedor };
}

/**
 * ÚLTIMO PRECIO DE COMPRA de cada material (regla 2 de Daniel), POR UNIDAD DE CONSUMO. Es la línea
 * de OC `autorizada`/`recibida_*` MÁS RECIENTE de la EMPRESA ACTIVA (A9) para ese material — sin
 * importar a qué orden estuviera ligada, que es justo lo que reparte una compra grande entre las
 * órdenes que la consumen (regla 3). "Más reciente" = fecha de la OC descendente (las OC sin fecha
 * van al final), y a igualdad, el folio/renglón mayor (determinista).
 *
 * Se resuelve con una consulta POR MATERIAL (`findFirst`, índice por `id_tela`/`id_avio`): son unas
 * pocas decenas de materiales por orden y así el orden es exacto, en vez de traer todo el histórico
 * de compras del material para quedarnos con una fila.
 */
async function leerUltimosPrecios(
  cliente: ClienteLectura,
  idEmpresa: number,
  materiales: readonly { clave: string; idTela: number | null; idAvio: number | null }[],
): Promise<Map<string, { precio: number; compra: ReferenciaCompra }>> {
  const resultado = new Map<string, { precio: number; compra: ReferenciaCompra }>();
  const filas = await Promise.all(
    materiales.map(async (m) => {
      const linea = await cliente.ordenCompraLinea.findFirst({
        where: {
          ...(m.idTela === null ? { idAvio: m.idAvio } : { idTela: m.idTela }),
          ordenCompra: { idEmpresa, estatus: { in: [...ESTATUS_COMPRADO] } },
        },
        orderBy: [
          { ordenCompra: { fecha: { sort: 'desc', nulls: 'last' } } },
          { ordenCompra: { numCompra: 'desc' } },
          { id: 'desc' },
        ],
        select: seleccionLineaOc,
      });
      return { clave: m.clave, linea };
    }),
  );

  const encontradas = filas.flatMap((f) => (f.linea === null ? [] : [f.linea]));
  const { factoresAvio, factoresAvioProveedor } = await leerFactores(cliente, encontradas);
  for (const f of filas) {
    if (f.linea === null) continue;
    const factor = factorDeLinea(f.linea, factoresAvio, factoresAvioProveedor);
    resultado.set(f.clave, {
      // Precio por unidad de CONSUMO (R1: precio por presentación ÷ factor) — igual que la recepción.
      precio: num(f.linea.precio) / factor,
      compra: referencia(f.linea),
    });
  }
  return resultado;
}

/** `select` de la orden para el costo real: empresa + receta `paraCosto` (fallback sin snapshot). */
const seleccionOrdenReal = {
  id: true,
  folio: true,
  idEmpresa: true,
  modelo: {
    select: {
      telas: {
        where: { paraCosto: true },
        select: {
          idTela: true,
          consumoPorPrenda: true,
          tela: { select: { nombre: true, unidadMedida: true, precioSugerido: true } },
        },
      },
      avios: {
        where: { paraCosto: true },
        select: {
          idAvio: true,
          consumoPorPrenda: true,
          avio: {
            select: {
              clave: true,
              descripcion: true,
              unidad: true,
              precioReferencia: true,
              esGenerico: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.OrdenSelect;

type OrdenReal = Prisma.OrdenGetPayload<{ select: typeof seleccionOrdenReal }>;

/** Base de materiales requeridos (sin precios todavía) + de dónde salió. */
interface BaseRequerido {
  origen: OrigenRequerido;
  filas: Omit<RequeridoMaterial, 'ultimoPrecio' | 'ultimaCompra'>[];
}

/**
 * Arma el REQUERIDO de la orden: el snapshot del MRP si existe (consumo BRUTO, antes del neteo
 * contra stock — los genéricos también se costean), y si no, la receta `paraCosto` × piezas (la
 * MISMA base que el teórico: cortado, o pedido si aún no hay corte).
 */
async function armarRequerido(
  cliente: ClienteLectura,
  orden: OrdenReal,
  bd: ContextoBd | undefined,
): Promise<BaseRequerido> {
  const snapshot = await cliente.requerimientoOrden.findMany({
    where: { idOrden: orden.id },
    select: {
      idTela: true,
      idAvio: true,
      cantidadRequerida: true,
      unidad: true,
      esGenerico: true,
      tela: { select: { nombre: true, unidadMedida: true, precioSugerido: true } },
      avio: {
        select: { clave: true, descripcion: true, unidad: true, precioReferencia: true },
      },
    },
    orderBy: { id: 'asc' },
  });

  if (snapshot.length > 0) {
    return {
      origen: 'snapshot-mrp',
      filas: snapshot.map((r) => ({
        clave: r.idTela === null ? `avio-${String(r.idAvio)}` : `tela-${String(r.idTela)}`,
        tipo: r.idTela === null ? ('avio' as const) : ('tela' as const),
        idTela: r.idTela,
        idAvio: r.idAvio,
        material:
          r.tela?.nombre ?? (r.avio === null ? '—' : `${r.avio.clave} — ${r.avio.descripcion}`),
        unidad: r.unidad ?? r.tela?.unidadMedida ?? r.avio?.unidad ?? null,
        esGenerico: r.esGenerico,
        requerido: num(r.cantidadRequerida),
        precioCatalogo: numOrNull(r.tela?.precioSugerido ?? r.avio?.precioReferencia ?? null),
      })),
    };
  }

  // Sin explosión de MRP: receta `paraCosto` × piezas (cortado, o pedido si aún no se corta).
  const cant = await cantidadesDeOrden(orden.id, bd);
  const piezas = cant.cortado > 0 ? cant.cortado : cant.pedido;
  const filas: BaseRequerido['filas'] = [
    ...orden.modelo.telas.map((t) => ({
      clave: `tela-${String(t.idTela)}`,
      tipo: 'tela' as const,
      idTela: t.idTela,
      idAvio: null,
      material: t.tela.nombre,
      unidad: t.tela.unidadMedida,
      esGenerico: false,
      requerido: num(t.consumoPorPrenda) * piezas,
      precioCatalogo: numOrNull(t.tela.precioSugerido),
    })),
    ...orden.modelo.avios.map((a) => ({
      clave: `avio-${String(a.idAvio)}`,
      tipo: 'avio' as const,
      idTela: null,
      idAvio: a.idAvio,
      material: `${a.avio.clave} — ${a.avio.descripcion}`,
      unidad: a.avio.unidad,
      esGenerico: a.avio.esGenerico,
      requerido: num(a.consumoPorPrenda) * piezas,
      precioCatalogo: numOrNull(a.avio.precioReferencia),
    })),
  ];
  return { origen: filas.length === 0 ? 'sin-requerido' : 'receta', filas };
}

/**
 * Calcula el COSTO REAL de materiales de una orden (lectura pura, sin permisos: lo llaman
 * `costoRealOrden` —que sí verifica `costos.ver`— y `guardarCostoOrden` dentro de su transacción).
 * La orden ya viene resuelta y verificada como de la empresa activa (A9).
 */
export async function calcularCostoRealDeOrden(
  orden: OrdenReal,
  bd?: ContextoBd,
): Promise<{ calculado: CostoRealCalculado; origenRequerido: OrigenRequerido }> {
  const cliente = clienteLectura(bd);
  const idEmpresa = orden.idEmpresa;

  // 1) Compras LIGADAS a la orden, de OC autorizada+ y de la empresa activa (A9, regla 1).
  const lineasOc = await cliente.ordenCompraLinea.findMany({
    where: {
      idOrden: orden.id,
      ordenCompra: { idEmpresa, estatus: { in: [...ESTATUS_COMPRADO] } },
    },
    orderBy: { id: 'asc' },
    select: seleccionLineaOc,
  });
  const { factoresAvio, factoresAvioProveedor } = await leerFactores(cliente, lineasOc);
  const ligadas: LineaCompraLigada[] = lineasOc.map((l) => {
    const factor = factorDeLinea(l, factoresAvio, factoresAvioProveedor);
    const cantidad = num(l.cantidad);
    return {
      clave: claveLinea(l),
      tipo: l.idTela !== null ? 'tela' : l.idAvio !== null ? 'avio' : 'libre',
      idTela: l.idTela,
      idAvio: l.idAvio,
      material: nombreMaterial(l),
      cantidad,
      // Cantidad en unidad de CONSUMO (R1) — para poder restarla del requerido del BOM.
      cantidadConsumo: cantidad * factor,
      unidad: l.unidad,
      precio: num(l.precio),
      compra: referencia(l),
    };
  });

  // 2) Requerido de la orden (snapshot del MRP o receta).
  const base = await armarRequerido(cliente, orden, bd);

  // 3) Último precio de compra SOLO de los materiales que tienen consumo sin compra propia (los
  //    que la compra ligada ya cubre por completo no necesitan valuarse → cero consultas de más).
  const compradoPorClave = new Map<string, number>();
  for (const l of ligadas) {
    compradoPorClave.set(l.clave, (compradoPorClave.get(l.clave) ?? 0) + l.cantidadConsumo);
  }
  const porValuar = base.filas.filter(
    (f) => f.requerido - (compradoPorClave.get(f.clave) ?? 0) > TOLERANCIA,
  );
  const ultimos = await leerUltimosPrecios(cliente, idEmpresa, porValuar);
  const requeridos: RequeridoMaterial[] = base.filas.map((f) => {
    const u = ultimos.get(f.clave);
    return {
      ...f,
      ultimoPrecio: u === undefined ? null : u.precio,
      ultimaCompra: u === undefined ? null : u.compra,
    };
  });

  return { calculado: combinarCostoReal(requeridos, ligadas), origenRequerido: base.origen };
}

/** Lee la orden de la empresa activa con lo que el costo real necesita, o lanza `ErrorNoEncontrado`. */
async function ordenParaReal(
  sesion: SesionUsuario,
  idOrden: number,
  cliente: ClienteLectura,
): Promise<OrdenReal> {
  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: seleccionOrdenReal,
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  return orden;
}

/** Proyecta el resumen del real ocultando importes sin `consultas.ver-importes`. */
export function resumenReal(
  calculado: CostoRealCalculado,
  origenRequerido: OrigenRequerido,
  verImportes: boolean,
): CostoRealResumen {
  const money = (v: number): number | null => (verImportes ? v : null);
  return {
    tela: money(calculado.tela),
    avios: money(calculado.avios),
    total: money(calculado.total),
    importeDirecto: money(calculado.importeDirecto),
    importeValuado: money(calculado.importeValuado),
    importeLibre: money(calculado.importeLibre),
    hayCompras: calculado.hayCompras,
    origenRequerido,
    avisos: calculado.avisos,
  };
}

/**
 * COSTO REAL de materiales de una orden CON su desglose por material (A4 `costos.ver`, A9). Es el
 * endpoint del cajón "¿de dónde sale este número?": qué se compró, a quién, a qué precio y qué se
 * valuó a último precio de compra. Importes en `null` sin `consultas.ver-importes` (las CANTIDADES
 * sí se ven: no son dinero).
 */
export async function costoRealOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<CostoRealOrdenSalida> {
  verificarPermiso(sesion, 'costos.ver');
  const cliente = clienteLectura(bd);
  const orden = await ordenParaReal(sesion, idOrden, cliente);
  const { calculado, origenRequerido } = await calcularCostoRealDeOrden(orden, bd);
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const money = (v: number | null): number | null => (verImportes ? v : null);

  return {
    ...resumenReal(calculado, origenRequerido, verImportes),
    idOrden: orden.id,
    folio: Number(orden.folio),
    materiales: calculado.materiales.map((m) => ({
      tipo: m.tipo,
      idTela: m.idTela,
      idAvio: m.idAvio,
      material: m.material,
      unidad: m.unidad,
      esGenerico: m.esGenerico,
      requerido: m.requerido,
      comprado: m.comprado,
      compras: m.compras.map((c) => ({
        idOrdenCompra: c.idOrdenCompra,
        numCompra: c.numCompra,
        estatus: c.estatus,
        fecha: c.fecha,
        idProveedor: c.idProveedor,
        proveedor: c.proveedor,
        cantidad: c.cantidad,
        unidad: c.unidad,
        precio: money(c.precio),
        importe: money(c.importe),
      })),
      importeDirecto: money(m.importeDirecto),
      cantidadValuada: m.cantidadValuada,
      precioValuado: money(m.precioValuado),
      importeValuado: money(m.importeValuado),
      origenPrecio: m.origenPrecio,
      ultimaCompra: m.ultimaCompra,
      importe: money(m.importe),
    })),
  };
}

/** Selección de la orden que necesita el costo real (la reusa `costo-orden.ts` en su transacción). */
export { seleccionOrdenReal };
export type { OrdenReal };
