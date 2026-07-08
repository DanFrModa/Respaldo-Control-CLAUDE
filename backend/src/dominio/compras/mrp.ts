/**
 * EXPLOSIÓN MRP de materiales por orden (Módulo COMPRAS, F4-E4 — el corazón del MRP de F4).
 * REQUISITOS-NUEVOS.md §R3 (explosión telas+avíos contra el BOM) y §R7 (cruce "qué tengo / qué
 * falta"), principio Make-to-Order (se compra POR ORDEN, nunca por niveles de stock/reorden) y doc
 * `Documentacion_MJD/01-Modelos.md §2` (la receta/BOM: telas con `CantTela`, avíos con `CantHab`).
 *
 * Tres operaciones, toda la lógica AQUÍ (A1); las rutas REST solo validan permiso + Zod y delegan:
 *
 *  1. `explosionarOrden` (R3): Requerido = Σ( consumoPorPrenda del BOM `paraProduccion` × piezas
 *     color×talla de la orden ), para TELAS y AVÍOS por igual. PERSISTE un SNAPSHOT regenerable
 *     (`RequerimientoOrden`): congela el cálculo aunque el BOM cambie después. Regenerar = borrar el
 *     snapshot previo de la orden y reescribirlo en UNA transacción (A2/D3), devolviendo el DIFF
 *     contra el snapshot viejo (nuevo/eliminado/cantidad-cambiada) para mostrarlo. Avíos GENÉRICOS
 *     (decisión (d) de Daniel): se NETEAN contra la existencia REAL del kardex de avíos (Σ de
 *     movimientos, D3) — solo el faltante va a compra; si el stock cubre, no genera compra.
 *  2. `generarOCDesdeExplosion` (R3): del snapshot, agrupa el requerido PENDIENTE seleccionado POR
 *     PROVEEDOR sugerido y crea UNA OC por proveedor en un clic. REUSA `crearOC` (no se duplica la
 *     lógica de folio/transacción/auditoría). Liga cada línea a la orden (`idOrden`) para que R7
 *     cruce sin prorrateos. La OC nace en `borrador` (sigue su ciclo normal de E2).
 *  3. `estatusMaterialesOrden` (R7): cruce on-demand Requerido (snapshot) vs En-OC (Σ líneas de OC
 *     no canceladas ligadas a la orden) vs Recibido (Σ recepciones activas) → semáforo por material.
 *     Las líneas de OC libres o sin requerido correspondiente salen como 'no-identificado' (no
 *     inflan el cruce).
 *
 * Innegociables aplicados:
 *  • A1 — la lógica vive aquí; las rutas son delgadas.
 *  • A2 — la regeneración del snapshot (borrar viejo + escribir nuevo) y la generación de OC van en
 *    UNA transacción.
 *  • A3 — la OC generada toma su folio de la secuencia atómica vía `crearOC` (no se reimplementa).
 *  • A4 — `compras.ver` (explosión/estatus, lectura) y `compras.administrar` (generar OC) se
 *    re-verifican aquí (defensa en profundidad).
 *  • A7 — auditoría uniforme en el snapshot (creadoPor/modificadoPor) + bitácora al regenerar.
 *  • A9 — todo se filtra/sella por la empresa ACTIVA de la sesión.
 *  • D3 — la existencia de avíos genéricos es Σ de movimientos del kardex (`existenciaAvioTotalEmpresa`),
 *    NUNCA un nivel persistido.
 *  • R1 — el proveedor/precio sugerido de un avío sale del `AvioProveedor` MÁS BARATO (con precio),
 *    convertido a costo por unidad de consumo (precio ÷ factor) con el motor `comun/conversion.ts`.
 *  • R3/Make-to-Order — el requerido es SIEMPRE por orden; nunca por stock/reorden.
 *
 * PROVEEDOR SUGERIDO de TELAS (F8-E6, "enganche"): si Desarrollo AMARRÓ un proveedor a la tela del BOM
 * (`ModeloTela.idTelaProveedor`), el MRP lo hereda y resuelve su precio con la cascada compartida
 * `resolverPrecioTela` (amarre-color → amarre → color-referencia → sugerido). Si NO hay amarre, la tela
 * sigue como antes de F8: `idProveedorSugerido` NULL → grupo "Sin proveedor sugerido" (el proveedor del
 * lote se decide al comprar, D5) y captura manual. Los avíos anteponen el amarre `ModeloAvio.
 * idAvioProveedor` (`resolverPrecioAvio`); sin amarre, caen al "más barato" de F4 (fallback intacto →
 * NO-REGRESIÓN). El consumo de avíos por talla (R18) se compra por medida×curva. Documentado en cada
 * helper; los casos ambiguos (tela multi-color con precios distintos, talla sin medida) NO truenan en
 * silencio: van a `avisos` en la salida.
 */
import type {
  ExplosionSalida,
  RequerimientoSalida,
  GrupoProveedorSalida,
  EstadoGenerico,
  DiffRequerimiento,
  DatosGenerarOc,
  GenerarOcResultado,
  OcGeneradaSalida,
  EstatusMaterialesSalida,
  EstatusMaterialFila,
  EstatusMaterial,
} from '../../contrato/index.js';
import type { Prisma, RequerimientoOrden } from '../../datos/index.js';

import { datosCreacion, registrarBitacora } from '../../comun/auditoria.js';
import { precioAUnidadConsumo, resolverFactor } from '../../comun/conversion.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import { existenciaAvioTotalEmpresa } from '../../comun/kardex.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { num, numOrNull } from '../costos/decimales.js';
import { resolverPrecioAvio, resolverPrecioTela } from '../costos/resolucion-precios.js';
import { requeridoAvioReceta } from '../produccion/receta-avios.js';

import { crearOC, type EntradaCrearOC } from './ordenes-compra.js';

/** Tolerancia de redondeo al comparar cantidades decimales (4 decimales en BD). */
const TOLERANCIA = 1e-6;

// ── Tipos internos de la explosión ────────────────────────────────────────────────────────────────

/** Un material requerido ya calculado, antes de persistir/proyectar. */
interface RequerimientoCalculado {
  tipo: 'tela' | 'avio';
  idTela: number | null;
  idAvio: number | null;
  material: string;
  cantidadRequerida: number;
  unidad: string | null;
  esGenerico: boolean;
  existenciaStock: number;
  cantidadAComprar: number;
  idProveedorSugerido: number | null;
  proveedorSugerido: string | null;
  precioSugerido: number | null;
}

/**
 * Selección de la orden para la explosión (BOM del modelo + matriz). Desde F8-E6 trae también los
 * AMARRES de precio de Desarrollo (`ModeloTela.idTelaProveedor` con su `TelaProveedor` + colores;
 * `ModeloAvio.idAvioProveedor` + los `AvioProveedor` del avío) y, en la matriz, el `idColor` del
 * renglón y el `idTalla`/etiqueta de cada cantidad (para el precio-por-color y el consumo por talla R18).
 */
const seleccionOrdenExplosion = {
  id: true,
  folio: true,
  idEmpresa: true,
  idModelo: true,
  modelo: {
    select: {
      codigo: true,
      telas: {
        select: {
          idTela: true,
          consumoPorPrenda: true,
          paraProduccion: true,
          idTelaProveedor: true,
          telaProveedor: {
            select: {
              idProveedor: true,
              precio: true,
              manejaPrecioPorColor: true,
              proveedor: { select: { nombre: true, activo: true } },
              colores: { select: { idColor: true, precio: true } },
            },
          },
          tela: { select: { nombre: true, unidadMedida: true, precioSugerido: true } },
        },
      },
      avios: {
        select: {
          idAvio: true,
          consumoPorPrenda: true,
          consumoPorTalla: true,
          paraProduccion: true,
          idAvioProveedor: true,
          tallas: { select: { idTalla: true, consumo: true } },
          avio: {
            select: {
              clave: true,
              descripcion: true,
              unidad: true,
              esGenerico: true,
              precioReferencia: true,
              factorConversion: true,
              proveedores: {
                select: {
                  idProveedor: true,
                  precio: true,
                  factorConversion: true,
                  proveedor: { select: { nombre: true, activo: true } },
                },
              },
            },
          },
        },
      },
    },
  },
  lineas: {
    select: {
      idColor: true,
      tallas: { select: { idTalla: true, cantidad: true, talla: { select: { etiqueta: true } } } },
    },
  },
} satisfies Prisma.OrdenSelect;

/** Orden cargada con lo que la explosión necesita (BOM del modelo + matriz + amarres, F8-E6). */
type OrdenParaExplosion = Prisma.OrdenGetPayload<{ select: typeof seleccionOrdenExplosion }>;

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────────

/** Carga la orden (de la empresa activa, A9) con su BOM y matriz, o lanza `ErrorNoEncontrado`. */
async function cargarOrden(
  tx: Tx,
  idOrden: number,
  idEmpresa: number,
): Promise<OrdenParaExplosion> {
  const orden = await tx.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: seleccionOrdenExplosion,
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  return orden;
}

/** Σ de TODAS las piezas color×talla de la orden = la base del cálculo R3. */
function totalPiezasOrden(orden: OrdenParaExplosion): number {
  let total = 0;
  for (const linea of orden.lineas) {
    for (const t of linea.tallas) {
      total += t.cantidad;
    }
  }
  return total;
}

/** Piezas de la orden AGRUPADAS por talla (para el consumo por talla, R18). Guarda la etiqueta para los avisos. */
function piezasPorTallaOrden(
  orden: OrdenParaExplosion,
): Map<number, { piezas: number; etiqueta: string }> {
  const mapa = new Map<number, { piezas: number; etiqueta: string }>();
  for (const linea of orden.lineas) {
    for (const t of linea.tallas) {
      const previo = mapa.get(t.idTalla);
      if (previo === undefined) {
        mapa.set(t.idTalla, { piezas: t.cantidad, etiqueta: t.talla.etiqueta });
      } else {
        previo.piezas += t.cantidad;
      }
    }
  }
  return mapa;
}

/** Ids de color DISTINTOS presentes en la matriz de la orden (para el precio-por-color de tela). */
function coloresDeOrden(orden: OrdenParaExplosion): number[] {
  return [...new Set(orden.lineas.map((l) => l.idColor))];
}

/** Proveedor + precio sugerido resuelto (idProveedor/nombre/precio por unidad de consumo, o nulls). */
interface ProveedorPrecio {
  idProveedor: number | null;
  proveedor: string | null;
  precio: number | null;
}

const SIN_PROVEEDOR: ProveedorPrecio = { idProveedor: null, proveedor: null, precio: null };

/**
 * Resuelve proveedor/precio de una TELA del BOM heredando el AMARRE de Desarrollo (F8-E6). Sin amarre →
 * NULL (como antes de F8: captura manual, D5). Con amarre → `idProveedorSugerido` = el proveedor elegido
 * (aunque el precio termine saliendo del sugerido genérico: a ese proveedor se le compra) y el precio se
 * resuelve con la cascada `resolverPrecioTela`. Precio-por-color: las telas del MRP se consumen por
 * MODELO completo (sin desglose por color en v2), así que sólo se resuelve por color cuando la orden es de
 * UN color; si tiene varios colores con precios de tela DISTINTOS, usa el precio BASE del amarre y DEJA UN
 * AVISO (no truena en silencio). Empuja avisos al arreglo compartido.
 *
 * NOTA (cascada, decisión F8-E6): AQUÍ la cascada OMITE el paso `color-referencia` (`TelaColor.precio`
 * sin proveedor) a propósito — la tela del MRP se consume por MODELO completo (no hay color por renglón
 * de requerimiento), así que el precio-por-color solo aplica DENTRO del amarre. Sin amarre → NULL.
 *
 * Proveedor amarrado INACTIVO: se mantiene la sugerencia (Desarrollo lo eligió a propósito y la OC es
 * editable), pero se DEJA UN AVISO — `generarOCDesdeExplosion`/`crearOC` no validan `activo`, así que sin
 * este aviso la OC se crearía a un proveedor de baja en silencio.
 */
function resolverProveedorPrecioTela(
  mt: OrdenParaExplosion['modelo']['telas'][number],
  colores: number[],
  avisos: string[],
): ProveedorPrecio {
  const tp = mt.telaProveedor;
  if (mt.idTelaProveedor === null || tp === null) {
    return SIN_PROVEEDOR; // sin amarre → como hoy (NULL / captura manual)
  }

  // Proveedor amarrado dado de baja: se conserva la sugerencia, pero no en silencio (aviso a la OC).
  if (!tp.proveedor.activo) {
    avisos.push(
      `Tela "${mt.tela.nombre}": el proveedor amarrado "${tp.proveedor.nombre}" está INACTIVO; ` +
        `se mantiene la sugerencia, revísalo antes de generar la OC.`,
    );
  }

  // Precio del COLOR en contexto: sólo si el proveedor cotiza por color Y la orden es de UN color.
  let precioColor: number | null = null;
  if (tp.manejaPrecioPorColor) {
    const precioPorColor = new Map(tp.colores.map((c) => [c.idColor, numOrNull(c.precio)]));
    if (colores.length === 1) {
      precioColor = precioPorColor.get(colores[0]!) ?? null;
    } else {
      // Multi-color: usa el precio BASE. Si los colores de la orden tienen precios de tela DISTINTOS,
      // avisa (el base pierde ese detalle; la tela se compra por modelo completo, no por color).
      const distintos = new Set(
        colores.map((id) => precioPorColor.get(id)).filter((p): p is number => p != null),
      );
      if (distintos.size >= 2) {
        avisos.push(
          `Tela "${mt.tela.nombre}": la orden tiene varios colores con precios de tela distintos ` +
            `en "${tp.proveedor.nombre}"; se usó el precio base del proveedor. Revisa el precio de la OC.`,
        );
      }
    }
  }

  const resuelto = resolverPrecioTela({
    precioSugerido: numOrNull(mt.tela.precioSugerido),
    amarre: {
      precio: numOrNull(tp.precio),
      manejaPrecioPorColor: tp.manejaPrecioPorColor,
      precioColor,
    },
  });
  return { idProveedor: tp.idProveedor, proveedor: tp.proveedor.nombre, precio: resuelto.precio };
}

/**
 * Resuelve proveedor/precio de un AVÍO heredando el AMARRE de Desarrollo (`ModeloAvio.idAvioProveedor`,
 * F8-E6) con `resolverPrecioAvio`. Devuelve el proveedor amarrado SÓLO si tiene un precio usable (origen
 * `amarre`); si no hay amarre, o el amarrado no tiene precio, devuelve `null` para que el llamador caiga
 * al "más barato" de F4 (`proveedorSugeridoAvio`, fallback INTACTO → no-regresión). El precio se normaliza
 * a unidad de consumo (÷ factor, R1) dentro de `resolverPrecioAvio`, sin duplicar la aritmética.
 *
 * Proveedor amarrado INACTIVO: si el amarre SÍ resuelve (tiene precio), se mantiene la sugerencia pero se
 * DEJA UN AVISO (misma razón que en tela: la OC no valida `activo`). Si el amarrado no tiene precio, cae al
 * fallback F4 —que sí filtra activos— y no hace falta avisar (el amarrado inactivo no se usa).
 */
function resolverProveedorPrecioAvioAmarrado(
  ma: OrdenParaExplosion['modelo']['avios'][number],
  avisos: string[],
): ProveedorPrecio | null {
  if (ma.idAvioProveedor === null) return null;
  const fila = ma.avio.proveedores.find((p) => p.idProveedor === ma.idAvioProveedor);
  if (fila === undefined) return null;
  // Sólo la fila amarrada + sin `precioReferencia`: así el fallback "más barato"/referencia de
  // `resolverPrecioAvio` NO elige a otro (esa red la teje `proveedorSugeridoAvio`, idéntico a F4).
  const resuelto = resolverPrecioAvio({
    precioReferencia: null,
    factorConversionAvio: numOrNull(ma.avio.factorConversion),
    idAvioProveedor: ma.idAvioProveedor,
    proveedores: [
      {
        idProveedor: fila.idProveedor,
        precio: numOrNull(fila.precio),
        factorConversion: numOrNull(fila.factorConversion),
      },
    ],
  });
  if (resuelto.origen === 'amarre' && resuelto.idProveedor !== null) {
    if (!fila.proveedor.activo) {
      avisos.push(
        `Avío "${ma.avio.clave} — ${ma.avio.descripcion}": el proveedor amarrado ` +
          `"${fila.proveedor.nombre}" está INACTIVO; se mantiene la sugerencia, revísalo antes de la OC.`,
      );
    }
    return {
      idProveedor: fila.idProveedor,
      proveedor: fila.proveedor.nombre,
      precio: resuelto.precio,
    };
  }
  return null; // amarre sin precio usable → fallback F4 (más barato)
}

/**
 * Cantidad requerida de un AVÍO (R18). Delega el cálculo PURO al helper COMPARTIDO
 * `requeridoAvioReceta` (`produccion/receta-avios.ts`, DEBE-2 — misma regla que la habilitación) y
 * aquí sólo arma el AVISO con las etiquetas de las tallas que cayeron al consumo por prenda.
 */
function requeridoAvio(
  ma: OrdenParaExplosion['modelo']['avios'][number],
  totalPiezas: number,
  piezasPorTalla: Map<number, { piezas: number; etiqueta: string }>,
  avisos: string[],
): number {
  const piezasSimple = new Map([...piezasPorTalla].map(([id, v]) => [id, v.piezas]));
  const { requerido, tallasSinMedida } = requeridoAvioReceta(ma, totalPiezas, piezasSimple);
  if (tallasSinMedida.length > 0) {
    const etiquetas = tallasSinMedida.map((id) => piezasPorTalla.get(id)?.etiqueta ?? String(id));
    avisos.push(
      `Avío "${ma.avio.clave} — ${ma.avio.descripcion}": sin medida por talla (R18) para ` +
        `${etiquetas.join(', ')}; se usó el consumo por prenda.`,
    );
  }
  return requerido;
}

/**
 * Resuelve el proveedor/precio SUGERIDO de un avío (R1): el `AvioProveedor` con precio MÁS BARATO
 * (por unidad de consumo = precio ÷ factor). En EMPATE de precio gana el `idProveedor` MENOR
 * (desempate DETERMINISTA, no el orden de la BD). Los que no traen precio se ignoran. Devuelve el id
 * del proveedor, su nombre y el precio por unidad de consumo, o nulls si ninguno tiene precio.
 *
 * NORMALIZACIÓN del factor (F8-E6, alineado con el amarre): `resolverFactor(proveedor, avío)` — cae al
 * `Avio.factorConversion` cuando el proveedor no fija el suyo, EXACTAMENTE como `resolverPrecioAvio`
 * (cascada F8-E1). Antes de F8 se pasaba `null` como fallback (se ignoraba el factor del avío), lo que
 * hacía que el MISMO proveedor diera precios distintos según el camino (amarre vs. más barato). Ya no.
 */
async function proveedorSugeridoAvio(
  tx: Tx,
  idAvio: number,
): Promise<{ idProveedor: number | null; proveedor: string | null; precio: number | null }> {
  const opciones = await tx.avioProveedor.findMany({
    where: { idAvio, precio: { not: null }, proveedor: { activo: true } },
    select: {
      idProveedor: true,
      precio: true,
      factorConversion: true,
      proveedor: { select: { nombre: true } },
      avio: { select: { factorConversion: true } },
    },
  });
  let mejor: { idProveedor: number; proveedor: string; precio: number } | null = null;
  for (const op of opciones) {
    if (op.precio === null) continue;
    // Precio por unidad de consumo (R1): precio por presentación ÷ factor (proveedor → avío → 1).
    const factor = resolverFactor(
      numOrNull(op.factorConversion),
      numOrNull(op.avio.factorConversion),
    );
    const precioConsumo = precioAUnidadConsumo(Number(op.precio), factor);
    // Más barato gana; en empate de precio, el idProveedor MENOR (determinista, no orden de BD).
    const ganaPorPrecio = mejor === null || precioConsumo < mejor.precio;
    const empateMenorId =
      mejor !== null && precioConsumo === mejor.precio && op.idProveedor < mejor.idProveedor;
    if (ganaPorPrecio || empateMenorId) {
      mejor = {
        idProveedor: op.idProveedor,
        proveedor: op.proveedor.nombre,
        precio: precioConsumo,
      };
    }
  }
  return mejor === null
    ? { idProveedor: null, proveedor: null, precio: null }
    : { idProveedor: mejor.idProveedor, proveedor: mejor.proveedor, precio: mejor.precio };
}

/**
 * Calcula los requerimientos de una orden (función de cálculo R3; las lecturas de avíos
 * genéricos/proveedores las hace contra `tx`). Para cada renglón del BOM `paraProduccion`:
 *   • TELA: requerido = consumoPorPrenda × totalPiezas. Proveedor/precio del AMARRE de Desarrollo
 *     (F8-E6, `resolverProveedorPrecioTela`); sin amarre → NULL (captura manual, D5).
 *   • AVÍO: requerido = consumoPorPrenda × totalPiezas, o Σ(medida×piezas) si se consume por talla
 *     (R18, `requeridoAvio`). Proveedor/precio: AMARRE `ModeloAvio.idAvioProveedor` primero; sin
 *     amarre (o amarrado sin precio) → "más barato" de F4 (`proveedorSugeridoAvio`, fallback intacto).
 * AVÍOS genéricos (decisión (d)): netea contra el stock REAL (Σ kardex, D3) → solo el faltante va a
 * compra. Telas y avíos NO genéricos van completos a compra. Los casos ambiguos van a `avisos`.
 */
async function calcularRequerimientos(
  tx: Tx,
  orden: OrdenParaExplosion,
  totalPiezas: number,
  existenciaGenerico: (idAvio: number) => Promise<number>,
  avisos: string[],
): Promise<RequerimientoCalculado[]> {
  const resultado: RequerimientoCalculado[] = [];
  const colores = coloresDeOrden(orden);
  const piezasPorTalla = piezasPorTallaOrden(orden);

  // ── TELAS del BOM (paraProduccion) ──
  for (const mt of orden.modelo.telas) {
    if (!mt.paraProduccion) continue;
    const requerida = num(mt.consumoPorPrenda) * totalPiezas;
    const sugerido = resolverProveedorPrecioTela(mt, colores, avisos);
    resultado.push({
      tipo: 'tela',
      idTela: mt.idTela,
      idAvio: null,
      material: mt.tela.nombre,
      cantidadRequerida: requerida,
      unidad: mt.tela.unidadMedida,
      esGenerico: false,
      existenciaStock: 0,
      cantidadAComprar: requerida, // telas siempre van completas a compra (no se netean)
      idProveedorSugerido: sugerido.idProveedor,
      proveedorSugerido: sugerido.proveedor,
      precioSugerido: sugerido.precio,
    });
  }

  // ── AVÍOS del BOM (paraProduccion) ──
  for (const ma of orden.modelo.avios) {
    if (!ma.paraProduccion) continue;
    const requerida = requeridoAvio(ma, totalPiezas, piezasPorTalla, avisos);
    const esGenerico = ma.avio.esGenerico;

    let existencia = 0;
    let aComprar = requerida;
    if (esGenerico) {
      // Decisión (d): netea contra el stock REAL del kardex (Σ movimientos, D3). Solo el faltante
      // va a compra; si el stock cubre todo, no genera compra (aComprar = 0).
      existencia = await existenciaGenerico(ma.idAvio);
      aComprar = Math.max(0, requerida - existencia);
    }

    // Amarre de Desarrollo primero (F8-E6); si no resuelve, "más barato" de F4 (fallback intacto).
    const sugerido =
      resolverProveedorPrecioAvioAmarrado(ma, avisos) ??
      (await proveedorSugeridoAvio(tx, ma.idAvio));
    resultado.push({
      tipo: 'avio',
      idTela: null,
      idAvio: ma.idAvio,
      material: `${ma.avio.clave} — ${ma.avio.descripcion}`,
      cantidadRequerida: requerida,
      unidad: ma.avio.unidad,
      esGenerico,
      existenciaStock: existencia,
      cantidadAComprar: aComprar,
      idProveedorSugerido: sugerido.idProveedor,
      proveedorSugerido: sugerido.proveedor,
      precioSugerido: sugerido.precio,
    });
  }

  return resultado;
}

/** Clave estable de un requerimiento (para casar snapshot viejo vs nuevo en el diff). */
function claveRequerimiento(r: { idTela: number | null; idAvio: number | null }): string {
  return r.idTela !== null ? `tela-${r.idTela}` : `avio-${String(r.idAvio)}`;
}

/** Estado de un genérico tras netear (decisión (d)) — para la UI. */
function estadoGenerico(r: RequerimientoCalculado): EstadoGenerico {
  if (!r.esGenerico) return 'no-aplica';
  return r.cantidadAComprar <= TOLERANCIA ? 'cubierto-por-stock' : 'faltante-parcial';
}

// ── Proyección a la salida ─────────────────────────────────────────────────────────────────────────

/** Proyecta un renglón persistido + su diff a la forma del contrato. */
function aRequerimientoSalida(
  fila: RequerimientoOrden & {
    tela: { nombre: string } | null;
    avio: { clave: string; descripcion: string } | null;
    proveedorSugerido: { nombre: string } | null;
  },
  diff: DiffRequerimiento,
): RequerimientoSalida {
  const tipo: 'tela' | 'avio' = fila.idTela !== null ? 'tela' : 'avio';
  const material =
    fila.tela?.nombre ??
    (fila.avio === null ? '—' : `${fila.avio.clave} — ${fila.avio.descripcion}`);
  const aComprar = Number(fila.cantidadAComprar);
  const estado: EstadoGenerico = !fila.esGenerico
    ? 'no-aplica'
    : aComprar <= TOLERANCIA
      ? 'cubierto-por-stock'
      : 'faltante-parcial';
  return {
    id: fila.id,
    tipo,
    idTela: fila.idTela,
    idAvio: fila.idAvio,
    material,
    cantidadRequerida: Number(fila.cantidadRequerida),
    unidad: fila.unidad,
    esGenerico: fila.esGenerico,
    estadoGenerico: estado,
    existenciaStock: Number(fila.existenciaStock),
    cantidadAComprar: aComprar,
    idProveedorSugerido: fila.idProveedorSugerido,
    proveedorSugerido: fila.proveedorSugerido?.nombre ?? null,
    precioSugerido: fila.precioSugerido === null ? null : Number(fila.precioSugerido),
    diff,
  };
}

/** Agrupa los renglones de salida por proveedor sugerido (el grupo null va al final). */
function agruparPorProveedor(renglones: RequerimientoSalida[]): GrupoProveedorSalida[] {
  const grupos = new Map<number | null, GrupoProveedorSalida>();
  for (const r of renglones) {
    const clave = r.idProveedorSugerido;
    let grupo = grupos.get(clave);
    if (grupo === undefined) {
      grupo = {
        idProveedor: clave,
        proveedor: r.proveedorSugerido ?? 'Sin proveedor sugerido',
        renglones: [],
      };
      grupos.set(clave, grupo);
    }
    grupo.renglones.push(r);
  }
  // Proveedores con nombre primero (alfabético), el grupo "sin proveedor" al final.
  return [...grupos.values()].sort((a, b) => {
    if (a.idProveedor === null) return 1;
    if (b.idProveedor === null) return -1;
    return a.proveedor.localeCompare(b.proveedor, 'es');
  });
}

// ── Operación 1: EXPLOSIONAR (R3) ────────────────────────────────────────────────────────────────

/**
 * Explosiona una orden (R3) y PERSISTE el snapshot regenerable en UNA transacción (A2): carga el
 * BOM + matriz de la orden (A9), calcula el requerido (netea genéricos contra el stock real, D3),
 * BORRA el snapshot anterior de la orden y escribe el nuevo, devolviendo el DIFF contra el viejo
 * (para marcar en la UI lo que cambió si el BOM se modificó). Permiso `compras.ver`.
 *
 * El stock de avíos genéricos se lee con `existenciaAvioTotalEmpresa` (Σ de movimientos en todos los
 * almacenes, D3) SIN re-verificar `inventario-avios.ver` (el usuario ya está autorizado por
 * `compras.ver`); una consulta por avío genérico (acotado: pocos genéricos por modelo).
 */
export async function explosionarOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<ExplosionSalida> {
  verificarPermiso(sesion, 'compras.ver');
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx) => {
    const orden = await cargarOrden(tx, idOrden, idEmpresa);
    const totalPiezas = totalPiezasOrden(orden);

    // Existencia de un avío genérico = total (todos los almacenes) de la empresa activa (Σ kardex,
    // D3). Lectura de PLANEACIÓN sin re-verificar `inventario-avios.ver`: el usuario ya está
    // autorizado por `compras.ver` y la explosión no debe exigir un segundo permiso (un rol custom
    // con compras.ver pero sin inventario-avios.ver tiraría 403 a media operación, reviewer F4-E4).
    const existenciaGenerico = (idAvio: number): Promise<number> =>
      existenciaAvioTotalEmpresa(tx, idEmpresa, idAvio);

    // Avisos de la explosión (F8-E6): tela multi-color con precios distintos, avío por talla sin
    // medida… Nada truena en silencio; se acumulan aquí y viajan en la salida.
    const avisos: string[] = [];
    const calculados = await calcularRequerimientos(
      tx,
      orden,
      totalPiezas,
      existenciaGenerico,
      avisos,
    );

    // Snapshot anterior (para el diff). Se relee por clave material — se traen también proveedor/precio
    // sugeridos: desde F8-E6 el amarre puede cambiar de proveedor/precio SIN mover la cantidad, y ese
    // cambio SÍ es relevante para la UI (los valores ya se persisten bien; solo faltaba la etiqueta).
    const previos = await tx.requerimientoOrden.findMany({
      where: { idOrden },
      select: {
        idTela: true,
        idAvio: true,
        cantidadRequerida: true,
        idProveedorSugerido: true,
        precioSugerido: true,
      },
    });
    const previoPorClave = new Map(previos.map((p) => [claveRequerimiento(p), p]));
    const clavesNuevas = new Set(calculados.map(claveRequerimiento));
    const regenerado = previos.length > 0;

    // Diff por renglón (en memoria, comparando viejo vs nuevo): cantidad, proveedor o precio sugerido.
    const diffPorClave = new Map<string, DiffRequerimiento>();
    for (const c of calculados) {
      const clave = claveRequerimiento(c);
      const prev = previoPorClave.get(clave);
      if (prev === undefined) {
        diffPorClave.set(clave, regenerado ? 'nuevo' : 'sin-cambio');
      } else {
        const cambioCantidad =
          Math.abs(Number(prev.cantidadRequerida) - c.cantidadRequerida) > TOLERANCIA;
        const cambioProveedor = (prev.idProveedorSugerido ?? null) !== c.idProveedorSugerido;
        const precioPrev = prev.precioSugerido === null ? null : Number(prev.precioSugerido);
        const cambioPrecio =
          precioPrev === null || c.precioSugerido === null
            ? precioPrev !== c.precioSugerido
            : Math.abs(precioPrev - c.precioSugerido) > TOLERANCIA;
        const cambio = cambioCantidad || cambioProveedor || cambioPrecio;
        diffPorClave.set(clave, cambio ? 'cantidad-cambiada' : 'sin-cambio');
      }
    }
    // Materiales que estaban antes y ya no (BOM les quitó la bandera/los borró): se reportan como
    // 'eliminado' (no se persisten — el snapshot nuevo no los lleva — pero se muestran en la salida).
    const eliminados: RequerimientoSalida[] = [];
    for (const p of previos) {
      const clave = claveRequerimiento(p);
      if (!clavesNuevas.has(clave)) {
        eliminados.push({
          id: -1,
          tipo: p.idTela !== null ? 'tela' : 'avio',
          idTela: p.idTela,
          idAvio: p.idAvio,
          material: '(material retirado del BOM)',
          cantidadRequerida: Number(p.cantidadRequerida),
          unidad: null,
          esGenerico: false,
          estadoGenerico: 'no-aplica',
          existenciaStock: 0,
          cantidadAComprar: 0,
          idProveedorSugerido: null,
          proveedorSugerido: null,
          precioSugerido: null,
          diff: 'eliminado',
        });
      }
    }

    // Reemplaza el snapshot: borra el viejo y escribe el nuevo (A2/D3).
    await tx.requerimientoOrden.deleteMany({ where: { idOrden } });
    const filas: RequerimientoSalida[] = [];
    for (const c of calculados) {
      const creada = await tx.requerimientoOrden.create({
        data: {
          idOrden,
          idTela: c.idTela,
          idAvio: c.idAvio,
          cantidadRequerida: c.cantidadRequerida,
          unidad: c.unidad,
          esGenerico: c.esGenerico,
          existenciaStock: c.existenciaStock,
          cantidadAComprar: c.cantidadAComprar,
          idProveedorSugerido: c.idProveedorSugerido,
          precioSugerido: c.precioSugerido,
          ...datosCreacion(sesion),
        },
        include: {
          tela: { select: { nombre: true } },
          avio: { select: { clave: true, descripcion: true } },
          proveedorSugerido: { select: { nombre: true } },
        },
      });
      filas.push(
        aRequerimientoSalida(creada, diffPorClave.get(claveRequerimiento(c)) ?? 'sin-cambio'),
      );
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'OTRO',
      datos: {
        explosionMrp: true,
        renglones: filas.length,
        totalPiezas,
        regenerado,
      },
    });

    const todos = [...filas, ...eliminados];
    const huboCambios = todos.some((r) => r.diff !== 'sin-cambio');

    return {
      idOrden,
      folioOrden: Number(orden.folio),
      idModelo: orden.idModelo,
      modelo: orden.modelo.codigo,
      totalPiezas,
      grupos: agruparPorProveedor(todos),
      huboCambios,
      regenerado,
      avisos,
    };
  }, bd);
}

// ── Operación 2: GENERAR OC desde la explosión (R3) ─────────────────────────────────────────────────

/**
 * Genera una o varias OC desde el snapshot de explosión (R3): toma el requerido PENDIENTE
 * (`cantidadAComprar > 0`) seleccionado, lo agrupa POR PROVEEDOR sugerido y crea UNA OC por
 * proveedor en UNA transacción (A2), REUSANDO `crearOC` (folio atómico A3, auditoría A7, ligas N:N).
 * Cada línea liga la orden de producción (`idOrden`) para que R7 cruce sin prorrateos. La OC nace en
 * `borrador`. `idsRequerimiento` vacío = generar para TODO lo pendiente. Permiso `compras.administrar`.
 *
 * Los renglones SIN proveedor sugerido (telas, o avíos sin proveedor con precio) se agrupan en una OC
 * "sin proveedor", que NO puede crearse (la OC exige proveedor): esos renglones se OMITEN y se
 * reportan aparte — el usuario captura su OC a mano (eligiendo proveedor) desde la pantalla de OC.
 */
export async function generarOCDesdeExplosion(
  sesion: SesionUsuario,
  idOrden: number,
  cuerpo: DatosGenerarOc,
  bd?: ContextoBd,
): Promise<GenerarOcResultado> {
  verificarPermiso(sesion, 'compras.administrar');
  const idEmpresa = sesion.idEmpresaActiva;
  const seleccion = new Set(cuerpo.idsRequerimiento);

  return enTransaccion(async (tx) => {
    // La orden debe ser de la empresa activa (A9).
    const orden = await tx.orden.findFirst({
      where: { id: idOrden, idEmpresa },
      select: { id: true },
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', idOrden);
    }

    const requerimientos = await tx.requerimientoOrden.findMany({
      where: { idOrden },
      select: {
        id: true,
        idTela: true,
        idAvio: true,
        unidad: true,
        cantidadAComprar: true,
        idProveedorSugerido: true,
        precioSugerido: true,
      },
    });

    // Solo lo PENDIENTE de compra (cantidadAComprar > 0), CON proveedor sugerido, y seleccionado.
    const elegibles = requerimientos.filter((r) => {
      const aComprar = Number(r.cantidadAComprar);
      if (aComprar <= TOLERANCIA) return false;
      if (r.idProveedorSugerido === null) return false;
      if (seleccion.size > 0 && !seleccion.has(r.id)) return false;
      return true;
    });

    // Agrupa por proveedor sugerido → una OC por proveedor.
    const porProveedor = new Map<number, typeof elegibles>();
    for (const r of elegibles) {
      const idProv = r.idProveedorSugerido as number;
      const lista = porProveedor.get(idProv) ?? [];
      lista.push(r);
      porProveedor.set(idProv, lista);
    }

    const ordenesCompra: OcGeneradaSalida[] = [];
    for (const [idProveedor, lista] of porProveedor) {
      const entrada: EntradaCrearOC = {
        idProveedor,
        lineas: lista.map((r) => ({
          idTela: r.idTela,
          idAvio: r.idAvio,
          cantidad: Number(r.cantidadAComprar),
          unidad: r.unidad,
          precio: r.precioSugerido === null ? 0 : Number(r.precioSugerido),
          idOrden,
        })),
      };
      // REUSA crearOC (se une a esta tx): folio atómico, auditoría, ligas N:N — sin duplicar nada.
      const oc = await crearOC(sesion, entrada, { tx });
      ordenesCompra.push({
        idOrdenCompra: oc.id,
        numCompra: oc.numCompra,
        idProveedor: oc.idProveedor,
        proveedor: oc.proveedor,
        renglones: oc.lineas.length,
        total: oc.total,
      });
    }

    return { ordenesCompra };
  }, bd);
}

// ── Operación 3: ESTATUS de materiales (R7) ──────────────────────────────────────────────────────────

/**
 * Determina el estatus (semáforo) de un material requerido (función PURA — sin BD). Reglas R7:
 *  • cubierto-por-stock: genérico cubierto sin compra (requerido > 0 pero aComprar = 0).
 *  • completo: recibido ≥ lo que va a compra (con tolerancia).
 *  • recibido-parcial: algo recibido pero no todo.
 *  • en-oc: hay cantidad en OC pero nada recibido.
 *  • pendiente: nada en OC.
 */
export function calcularEstatusMaterial(
  aComprar: number,
  enOc: number,
  recibido: number,
  esGenericoCubierto: boolean,
): EstatusMaterial {
  if (esGenericoCubierto) return 'cubierto-por-stock';
  if (recibido + TOLERANCIA >= aComprar && aComprar > TOLERANCIA) return 'completo';
  if (recibido > TOLERANCIA) return 'recibido-parcial';
  if (enOc > TOLERANCIA) return 'en-oc';
  return 'pendiente';
}

/**
 * Tablero "qué tengo / qué falta" de una orden (R7) — consulta ON-DEMAND (la captura nunca espera un
 * recálculo). Cruza, por material requerido (snapshot):
 *  • En-OC = Σ cantidades de `OrdenCompraLinea` (de OC NO canceladas) de ese material ligadas a la
 *    orden (`idOrden`).
 *  • Recibido = Σ `RecepcionCompraLinea` (de recepciones ACTIVAS) de esas líneas.
 * Las líneas de OC libres o ligadas a la orden pero SIN requerido correspondiente salen como
 * 'no-identificado' (no inflan el cruce). Permiso `compras.ver`; empresa activa (A9).
 */
export async function estatusMaterialesOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<EstatusMaterialesSalida> {
  verificarPermiso(sesion, 'compras.ver');
  const idEmpresa = sesion.idEmpresaActiva;
  const cliente = clienteLectura(bd);

  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: { id: true, folio: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  const requerimientos = await cliente.requerimientoOrden.findMany({
    where: { idOrden },
    include: {
      tela: { select: { nombre: true } },
      avio: { select: { clave: true, descripcion: true } },
    },
  });

  // Líneas de OC (de OC NO canceladas) ligadas a esta orden de producción. Traen su material +
  // lo recibido por recepciones ACTIVAS (para el cruce). La empresa ya está sellada por la orden.
  const lineasOc = await cliente.ordenCompraLinea.findMany({
    where: {
      idOrden,
      ordenCompra: { estatus: { not: 'cancelada' }, idEmpresa },
    },
    select: {
      idTela: true,
      idAvio: true,
      descripcionLibre: true,
      cantidad: true,
      tela: { select: { nombre: true } },
      avio: { select: { clave: true, descripcion: true } },
      recepcionLineas: {
        where: { recepcionCompra: { reversadaEn: null } },
        select: { cantidadRecibida: true },
      },
    },
  });

  // Acumula En-OC y Recibido por material (clave tela/avío). Las líneas libres → clave especial.
  interface Acum {
    enOc: number;
    recibido: number;
    material: string;
    idTela: number | null;
    idAvio: number | null;
  }
  const porMaterial = new Map<string, Acum>();
  const claveLibre = 'libre';
  for (const l of lineasOc) {
    const clave =
      l.idTela !== null ? `tela-${l.idTela}` : l.idAvio !== null ? `avio-${l.idAvio}` : claveLibre;
    const material =
      l.tela?.nombre ??
      (l.avio === null
        ? (l.descripcionLibre ?? '(libre)')
        : `${l.avio.clave} — ${l.avio.descripcion}`);
    const recibido = l.recepcionLineas.reduce((s, r) => s + Number(r.cantidadRecibida), 0);
    const acum = porMaterial.get(clave) ?? {
      enOc: 0,
      recibido: 0,
      material,
      idTela: l.idTela,
      idAvio: l.idAvio,
    };
    acum.enOc += Number(l.cantidad);
    acum.recibido += recibido;
    porMaterial.set(clave, acum);
  }

  const filas: EstatusMaterialFila[] = [];
  const clavesRequeridas = new Set<string>();

  // 1) Una fila por material REQUERIDO (snapshot): cruza con lo de OC/recibido.
  for (const r of requerimientos) {
    const clave = r.idTela !== null ? `tela-${r.idTela}` : `avio-${String(r.idAvio)}`;
    clavesRequeridas.add(clave);
    const acum = porMaterial.get(clave);
    const aComprar = Number(r.cantidadAComprar);
    const enOc = acum?.enOc ?? 0;
    const recibido = acum?.recibido ?? 0;
    const esGenericoCubierto = r.esGenerico && aComprar <= TOLERANCIA;
    const material =
      r.tela?.nombre ?? (r.avio === null ? '—' : `${r.avio.clave} — ${r.avio.descripcion}`);
    filas.push({
      tipo: r.idTela !== null ? 'tela' : 'avio',
      idTela: r.idTela,
      idAvio: r.idAvio,
      material,
      unidad: r.unidad,
      requerido: Number(r.cantidadRequerida),
      enOc,
      recibido,
      estatus: calcularEstatusMaterial(aComprar, enOc, recibido, esGenericoCubierto),
    });
  }

  // 2) Materiales en OC ligados a la orden pero SIN requerido (libres o fuera del BOM) → no-identificado.
  for (const [clave, acum] of porMaterial) {
    if (clavesRequeridas.has(clave)) continue;
    filas.push({
      tipo: 'no-identificado',
      idTela: acum.idTela,
      idAvio: acum.idAvio,
      material: acum.material,
      unidad: null,
      requerido: 0,
      enOc: acum.enOc,
      recibido: acum.recibido,
      estatus: 'en-oc',
    });
  }

  return {
    idOrden,
    folioOrden: Number(orden.folio),
    tieneSnapshot: requerimientos.length > 0,
    filas,
  };
}

// Exporta `estadoGenerico` para tests del helper de neteo (decisión d).
export { estadoGenerico };
