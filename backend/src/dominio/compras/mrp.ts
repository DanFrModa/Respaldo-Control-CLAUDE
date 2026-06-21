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
 * PROVEEDOR SUGERIDO de TELAS: en v2 NO hay liga directa tela→proveedor (el proveedor se decide al
 * comprar el lote, D5); por eso las telas salen con `idProveedorSugerido` NULL y caen en el grupo
 * "Sin proveedor sugerido" (el usuario elige proveedor al generar/editar la OC). Documentado aquí.
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

/** Orden cargada con lo que la explosión necesita (BOM del modelo + matriz de la orden). */
type OrdenParaExplosion = Prisma.OrdenGetPayload<{
  select: {
    id: true;
    folio: true;
    idEmpresa: true;
    idModelo: true;
    modelo: {
      select: {
        codigo: true;
        telas: {
          select: {
            idTela: true;
            consumoPorPrenda: true;
            paraProduccion: true;
            tela: { select: { nombre: true; unidadMedida: true } };
          };
        };
        avios: {
          select: {
            idAvio: true;
            consumoPorPrenda: true;
            paraProduccion: true;
            avio: { select: { clave: true; descripcion: true; unidad: true; esGenerico: true } };
          };
        };
      };
    };
    lineas: { select: { tallas: { select: { cantidad: true } } } };
  };
}>;

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
          tela: { select: { nombre: true, unidadMedida: true } },
        },
      },
      avios: {
        select: {
          idAvio: true,
          consumoPorPrenda: true,
          paraProduccion: true,
          avio: { select: { clave: true, descripcion: true, unidad: true, esGenerico: true } },
        },
      },
    },
  },
  lineas: { select: { tallas: { select: { cantidad: true } } } },
} satisfies Prisma.OrdenSelect;

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────────

/** Carga la orden (de la empresa activa, A9) con su BOM y matriz, o lanza `ErrorNoEncontrado`. */
async function cargarOrden(tx: Tx, idOrden: number, idEmpresa: number): Promise<OrdenParaExplosion> {
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

/**
 * Resuelve el proveedor/precio SUGERIDO de un avío (R1): el `AvioProveedor` con precio MÁS BARATO
 * (por unidad de consumo = precio ÷ factor). En EMPATE de precio gana el `idProveedor` MENOR
 * (desempate DETERMINISTA, no el orden de la BD). Los que no traen precio se ignoran. Devuelve el id
 * del proveedor, su nombre y el precio por unidad de consumo, o nulls si ninguno tiene precio.
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
    },
  });
  let mejor: { idProveedor: number; proveedor: string; precio: number } | null = null;
  for (const op of opciones) {
    if (op.precio === null) continue;
    // Precio por unidad de consumo (R1): precio por presentación ÷ factor (proveedor → avío → 1).
    const factor = resolverFactor(
      op.factorConversion === null ? null : Number(op.factorConversion),
      null,
    );
    const precioConsumo = precioAUnidadConsumo(Number(op.precio), factor);
    // Más barato gana; en empate de precio, el idProveedor MENOR (determinista, no orden de BD).
    const ganaPorPrecio = mejor === null || precioConsumo < mejor.precio;
    const empateMenorId =
      mejor !== null && precioConsumo === mejor.precio && op.idProveedor < mejor.idProveedor;
    if (ganaPorPrecio || empateMenorId) {
      mejor = { idProveedor: op.idProveedor, proveedor: op.proveedor.nombre, precio: precioConsumo };
    }
  }
  return mejor === null
    ? { idProveedor: null, proveedor: null, precio: null }
    : { idProveedor: mejor.idProveedor, proveedor: mejor.proveedor, precio: mejor.precio };
}

/**
 * Calcula los requerimientos de una orden (función de cálculo R3; las lecturas de avíos
 * genéricos/proveedores las hace contra `tx`). Para cada renglón del BOM `paraProduccion`:
 *   requerido = consumoPorPrenda × totalPiezas.
 * AVÍOS genéricos (decisión (d)): netea contra el stock REAL (Σ kardex, D3) → solo el faltante va a
 * compra. Telas y avíos NO genéricos van completos a compra. Proveedor sugerido: avíos del
 * `AvioProveedor` más barato (R1); telas NULL (sin liga directa tela→proveedor, D5).
 */
async function calcularRequerimientos(
  tx: Tx,
  orden: OrdenParaExplosion,
  totalPiezas: number,
  existenciaGenerico: (idAvio: number) => Promise<number>,
): Promise<RequerimientoCalculado[]> {
  const resultado: RequerimientoCalculado[] = [];

  // ── TELAS del BOM (paraProduccion) ──
  for (const mt of orden.modelo.telas) {
    if (!mt.paraProduccion) continue;
    const requerida = Number(mt.consumoPorPrenda) * totalPiezas;
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
      idProveedorSugerido: null, // sin liga directa tela→proveedor en v2 (D5)
      proveedorSugerido: null,
      precioSugerido: null,
    });
  }

  // ── AVÍOS del BOM (paraProduccion) ──
  for (const ma of orden.modelo.avios) {
    if (!ma.paraProduccion) continue;
    const requerida = Number(ma.consumoPorPrenda) * totalPiezas;
    const esGenerico = ma.avio.esGenerico;

    let existencia = 0;
    let aComprar = requerida;
    if (esGenerico) {
      // Decisión (d): netea contra el stock REAL del kardex (Σ movimientos, D3). Solo el faltante
      // va a compra; si el stock cubre todo, no genera compra (aComprar = 0).
      existencia = await existenciaGenerico(ma.idAvio);
      aComprar = Math.max(0, requerida - existencia);
    }

    const sugerido = await proveedorSugeridoAvio(tx, ma.idAvio);
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

    const calculados = await calcularRequerimientos(tx, orden, totalPiezas, existenciaGenerico);

    // Snapshot anterior (para el diff). Se relee por clave material.
    const previos = await tx.requerimientoOrden.findMany({
      where: { idOrden },
      select: { idTela: true, idAvio: true, cantidadRequerida: true },
    });
    const previoPorClave = new Map(previos.map((p) => [claveRequerimiento(p), p]));
    const clavesNuevas = new Set(calculados.map(claveRequerimiento));
    const regenerado = previos.length > 0;

    // Diff por renglón (en memoria, comparando viejo vs nuevo).
    const diffPorClave = new Map<string, DiffRequerimiento>();
    for (const c of calculados) {
      const clave = claveRequerimiento(c);
      const prev = previoPorClave.get(clave);
      if (prev === undefined) {
        diffPorClave.set(clave, regenerado ? 'nuevo' : 'sin-cambio');
      } else {
        const cambio = Math.abs(Number(prev.cantidadRequerida) - c.cantidadRequerida) > TOLERANCIA;
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
      filas.push(aRequerimientoSalida(creada, diffPorClave.get(claveRequerimiento(c)) ?? 'sin-cambio'));
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
    const orden = await tx.orden.findFirst({ where: { id: idOrden, idEmpresa }, select: { id: true } });
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
      l.idTela !== null
        ? `tela-${l.idTela}`
        : l.idAvio !== null
          ? `avio-${l.idAvio}`
          : claveLibre;
    const material =
      l.tela?.nombre ??
      (l.avio === null ? (l.descripcionLibre ?? '(libre)') : `${l.avio.clave} — ${l.avio.descripcion}`);
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
      r.tela?.nombre ??
      (r.avio === null ? '—' : `${r.avio.clave} — ${r.avio.descripcion}`);
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
