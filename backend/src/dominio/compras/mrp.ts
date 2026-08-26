/**
 * EXPLOSIÓN MRP de materiales por orden (Módulo COMPRAS, F4-E4 — el corazón del MRP de F4).
 * REQUISITOS-NUEVOS.md §R3 (explosión telas+avíos contra el BOM) y §R7 (cruce "qué tengo / qué
 * falta"), principio Make-to-Order (se compra POR ORDEN, nunca por niveles de stock/reorden) y doc
 * `Documentacion_MJD/01-Modelos.md §2` (la receta/BOM: telas con `CantTela`, avíos con `CantHab`).
 *
 * Toda la lógica AQUÍ (A1); las rutas REST solo validan permiso + Zod y delegan.
 *
 * ⭐⭐ **V1-E3q (§Post-F9.85 / §Post-F9.86) — LA COMPRA DESDE LA EXPLOSIÓN.** Daniel, probando en
 * vivo el 20-ago-2026: *"me vuelvo a meter en la pantalla y sigue apareciendo ahí los elementos y
 * **me deja volver a hacerla**"*. Tres cambios que se sostienen entre ellos:
 *
 *  1. **NO SE VUELVE A COMPRAR LO YA COMPRADO.** Cada renglón sale con `cantidadEnOc` y
 *     `cantidadPendiente`, y **sólo lo pendiente se compra**. La verdad de *"cuánto ya está en una
 *     OC"* vive en UN SOLO lugar —`comprometido-en-oc.ts`, el mismo que lee el tablero R7— y su
 *     criterio (todas las OC menos la cancelada; **el borrador SÍ cuenta**) está justificado ahí.
 *  2. **LA REVISIÓN PREVIA.** `planearCompra` es la ÚNICA función que decide qué se compra;
 *     `previoCompraDesdeExplosion` la pinta sin escribir nada y `generarOCDesdeExplosion` la
 *     ejecuta. Una previa que calculara por su cuenta sería una promesa que el sistema no cumple.
 *  3. **UNA COMPRA PARA VARIAS OP.** `explosionarOrdenes` explota un CONJUNTO (`explosionarOrden`
 *     es su atajo de una sola). **Se ve junto, se guarda repartido**: la pantalla agrupa por
 *     material+proveedor y la OC guarda **una línea por (material, OP)**.
 *
 * ⭐ **V1-E3d (§Post-F9.43): la explosión lee la RECETA CONGELADA DE LA ORDEN, no el BOM del
 * modelo.** Daniel: *"El BOM debe de vivir en la OP"*. Consecuencias, todas buscadas:
 *  • Dos órdenes del mismo modelo pueden **comprar cosas distintas** (una con jareta y otra sin).
 *  • Cambiar el BOM del modelo **ya no cambia lo que compra una orden viva**: si el cambio debe
 *    bajar, alguien lo baja a mano desde la receta de esa orden ("restaurar renglón").
 *  • **La puerta**: sin la receta LIBERADA por Desarrollo no se explota ni se genera OC
 *    (`exigirRecetaLiberada`). Cortar y producir NO se bloquean.
 *  • El **precio** de la línea de OC NO sale del precio congelado en la receta: sigue saliendo de la
 *    última compra real al proveedor al que se le compra (§Post-F9.48/V1-E3e). La receta aporta
 *    **qué**, **cuánto** y **a quién** (el amarre); el precio congelado es el que COSTEA la orden.
 *    Las dos decisiones hablan de momentos distintos: congelar es del día que nació la orden,
 *    comprar es del día que se compra.
 *
 *  1. `explosionarOrdenes`/`explosionarOrden` (R3): Requerido = Σ( consumoPorPrenda de la RECETA DE LA ORDEN
 *     `paraProduccion` y no excluida × piezas color×talla de la orden ), para TELAS y AVÍOS. PERSISTE un SNAPSHOT regenerable
 *     (`RequerimientoOrden`): congela el cálculo aunque el BOM cambie después. Regenerar = borrar el
 *     snapshot previo de la orden y reescribirlo en UNA transacción (A2/D3), devolviendo el DIFF
 *     contra el snapshot viejo (nuevo/eliminado/cantidad-cambiada) para mostrarlo. Avíos GENÉRICOS
 *     (decisión (d) de Daniel): se NETEAN contra la existencia REAL del kardex de avíos (Σ de
 *     movimientos, D3) — solo el faltante va a compra; si el stock cubre, no genera compra.
 *  2. `planearCompra` → `previoCompraDesdeExplosion` / `generarOCDesdeExplosion` (R3): del snapshot,
 *     resta lo que YA está en OC (V1-E3q), agrupa lo que de verdad falta POR PROVEEDOR y crea UNA OC
 *     por proveedor. REUSA `crearOC` (no se duplica la
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
 *    ya en unidad de consumo — la única unidad del sistema (§Post-F9.97).
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
 *
 * ⭐ **LA OC NACE CON LO ÚLTIMO QUE ESE PROVEEDOR COBRÓ (DANIEL, 15-ago-2026 — §Post-F9.48).** El MRP
 * también aplica el escalón 1 de la cascada única, pero con un LÍMITE que es el corazón de la
 * decisión: **solo cuenta la última compra AL PROVEEDOR AL QUE SE LE VA A COMPRAR**. Nunca el precio
 * de un tercero — eso emitiría una orden con un precio que ese proveedor jamás dio.
 *
 *  • **A QUIÉN se le compra NO cambia**: lo sigue fijando R1/F4 (proveedor amarrado; si no, el más
 *    barato). Esta etapa no toca la política de compra, solo **a qué precio nace la línea**.
 *  • **A QUÉ PRECIO**: la última compra REAL a ese proveedor (`ultimo-precio-compra.ts`, OC
 *    autorizada, en unidad de consumo §Post-F9.97). Si nunca se le compró, su precio de
 *    catálogo/negociado — el
 *    comportamiento de antes, intacto.
 *  • **EXCEPCIÓN por COLOR**: si el precio salió del escalón `amarre-color`
 *    (`TelaProveedorColor.precio` del color de la orden), ése MANDA sobre la última compra. Razón:
 *    `OrdenCompraLinea` NO guarda color —vive en `OrdenCompraLineaTalla`, y una línea puede cubrir
 *    varios colores con UN precio—, así que la "última compra" de una tela es CIEGA al color;
 *    dejarla ganar cotizaría una tela negra con el precio de la blanca que se compró al final. Es el
 *    mismo argumento que protege a `promedio-medidas` en los avíos (ver `resolucion-precios.ts`).
 *
 * Con esto el ciclo cierra sobre un solo criterio: la OC nace del precio real, se autoriza, y ese
 * precio entra al histórico del que come todo el costeo.
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
  OrigenProveedor,
  OrdenExplosionada,
  OrdenesDelPedidoSalida,
  OmitidoPlan,
  PlanCompra,
  PlanProveedor,
  PlanRenglon,
  PlanLineaOrden,
  RepartoOrden,
} from '../../contrato/index.js';
import type {
  PendienteColor,
  PendienteLiberar,
  TipoCambioRecetaClave,
} from '../../contrato/index.js';
import type { Prisma, RequerimientoOrden } from '../../datos/index.js';

import { datosCreacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { minimoParaSurtir, type TipoRenglonCompra } from './tolerancia-recepcion.js';
import { existenciaAvioTotalEmpresa } from '../../comun/kardex.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import {
  avisoAvioPorMedidaConCantidadesPorTalla,
  hayDescuadreDeRequerido,
} from '../catalogos/unidades-avio.js';
import { num, numOrNull, redondear2 } from '../costos/decimales.js';
import {
  resolverPrecioAvio,
  resolverPrecioTela,
  type OrigenPrecioTela,
} from '../costos/resolucion-precios.js';
import {
  claveMaterialProveedor,
  leerUltimosPreciosCompra,
  SIN_ULTIMOS_PRECIOS,
  type UltimosPreciosCompra,
} from '../costos/ultimo-precio-compra.js';
import {
  requeridoAvioReceta,
  requeridoContradictorioPorMedida,
} from '../produccion/receta-avios.js';
import {
  desalineacionDeOrden,
  exigirMaterialesLiberados,
  exigirRecetaLiberada,
} from '../produccion/receta-orden.js';

import {
  candidatoHabitualAvio,
  candidatoMasBaratoAvio,
  elegirProveedorAvio,
  elegirProveedorTela,
  precioProveedorAvio,
  type CandidatoProveedor,
  type FilaProveedorAvio,
  type ResolucionProveedorMaterial,
} from './proveedor-material.js';

import { crearOC, type EntradaCrearOC } from './ordenes-compra.js';
import {
  aplicarAjusteDelComprador,
  precioComunDelRenglon,
  type AjusteDelComprador,
} from './ajuste-comprador.js';
import {
  claveMaterial,
  comprometidoEnOc,
  repartirComprometidoPorColor,
  type ComprometidoMaterial,
  type ComprometidoPorOrden,
} from './comprometido-en-oc.js';
import {
  redondearCantidadCompra,
  redondearPrecioCompra,
  repartirEntreOrdenes,
  seGuardaComoAlgo,
} from './reparto-ordenes.js';

/** Tolerancia de redondeo al comparar cantidades decimales (4 decimales en BD). */
const TOLERANCIA = 1e-6;

// ── Tipos internos de la explosión ────────────────────────────────────────────────────────────────

/** Un material requerido ya calculado, antes de persistir/proyectar. */
interface RequerimientoCalculado {
  tipo: 'tela' | 'avio';
  idTela: number | null;
  idAvio: number | null;
  /**
   * ⭐⭐ V1-E3u (§Post-F9.89): color de tela de ESTE renglón. `null` = avío, o tela cuyo color
   * todavía nadie dijo (se compra igual, pero la explosión lo reporta en `pendientesColor`).
   */
  idTelaColor: number | null;
  /** Nombre del color de tela (para la pantalla y el impreso), o null. */
  telaColor: string | null;
  material: string;
  cantidadRequerida: number;
  unidad: string | null;
  esGenerico: boolean;
  existenciaStock: number;
  cantidadAComprar: number;
  idProveedorSugerido: number | null;
  proveedorSugerido: string | null;
  precioSugerido: number | null;
  /** ⭐ V1-E3m: de qué escalón salió el proveedor (para la UI y para poder quitar lo de Compras). */
  origenProveedor: OrigenProveedor;
  /** ⭐ V1-E3m: el proveedor propuesto está de BAJA (la UI ofrece reasignarlo ahí mismo). */
  proveedorSugeridoInactivo: boolean;
  /**
   * ⭐⭐ §Post-F9.105 — AVISOS **DE ESTE RENGLÓN** (hoy: la contradicción «avío por medida con
   * cantidades por talla», que infla el requerido). Van pegados al material, NO al pie de la
   * pantalla: es donde se ve el número inflado. Vacío = nada que advertir.
   */
  avisos: string[];
}

/**
 * Selección de la orden para la explosión (RECETA CONGELADA DE LA ORDEN + matriz, V1-E3d). Trae los
 * AMARRES de precio heredados de Desarrollo (`OrdenTela.idTelaProveedor` con su `TelaProveedor` +
 * colores; `OrdenAvio.idAvioProveedor` + los `AvioProveedor` del avío) y, en la matriz, el `idColor`
 * del renglón y el `idTalla`/etiqueta de cada cantidad (precio-por-color y consumo por talla R18).
 */
const seleccionOrdenExplosion = {
  id: true,
  folio: true,
  idEmpresa: true,
  idModelo: true,
  modelo: { select: { codigo: true } },
  // ⭐ V1-E3q (§Post-F9.86): la fecha de entrega de CADA OP —que la pantalla ENSEÑA para ubicar la
  // orden, y nada más: **no alimenta la fecha de ninguna OC** (§Post-F9.120, es la fecha del
  // CLIENTE)— y el PEDIDO INTERNO del que cuelga, que es lo que permite precargar *"los avíos de un
  // mismo pedido interno (ejemplo 1515)"*.
  fechaEntrega: true,
  pedidoLinea: { select: { idPedido: true, pedido: { select: { folio: true } } } },
  // ⭐ V1-E3d (§Post-F9.43): la explosión lee la RECETA CONGELADA DE LA ORDEN, no el BOM del
  // modelo. Los renglones EXCLUIDOS (la jareta que esta orden no lleva) se filtran en la consulta:
  // para el MRP simplemente no existen. El filtro `paraProduccion` se conserva TAL CUAL, solo que
  // ahora sobre la bandera de la orden → cero cambio de alcance.
  //
  // ⭐⭐ V1-E3h (§Post-F9.72): **y se explota SOLO LO LIBERADO**. Daniel: *"podría haber algún cierre
  // que aún no autoriza el cliente, pero ya podríamos ir comprando lo demás"*. Lo que Desarrollo no
  // ha firmado NO entra al requerido — pero tampoco desaparece en silencio (D3): sale por
  // `pendientesLiberar`, con nombre y cantidad, en la MISMA respuesta.
  recetaTelas: {
    where: { excluido: false, liberadoEn: { not: null } },
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
      // ⭐ V1-E3m (§Post-F9.82): la asignación que hizo COMPRAS para ESTA orden (último escalón).
      idProveedorCompra: true,
      precioCompra: true,
      proveedorCompra: { select: { nombre: true, activo: true } },
      // ⭐⭐ V1-E3u (§Post-F9.89): EL COLOR CON EL QUE SE PIDE. Un renglón por color de la matriz
      // que ya tenga dicho su color de tela. Los que faltan NO se adivinan: salen por
      // `pendientesColor` en la misma respuesta (D3), y su cantidad sigue yendo a compra en un
      // renglón sin color — para que la OP nunca compre de menos por un dato que falta capturar.
      colores: {
        select: {
          idColor: true,
          idTelaColor: true,
          telaColor: { select: { nombre: true, precio: true } },
        },
      },
      tela: {
        select: {
          nombre: true,
          unidadMedida: true,
          precioSugerido: true,
          // ⭐ V1-E3m: EL PROVEEDOR DUEÑO de la tela (§Post-F9.11) — el dato que ya estaba capturado
          // y que el motor de compras ignoraba. Con él, la explosión casi nunca se queda sin a
          // quién comprarle.
          idProveedor: true,
          proveedor: { select: { nombre: true, activo: true } },
          // Los precios negociados por proveedor (F8): de aquí sale el precio del DUEÑO cuando lo
          // tiene. Sin renglón, el precio cae al de REFERENCIA de la tela (y se avisa: son cosas
          // distintas y confundirlas es lo que puso un $0.00 enfrente de Daniel).
          proveedoresPrecio: {
            where: { activo: true },
            select: {
              idProveedor: true,
              precio: true,
              manejaPrecioPorColor: true,
              colores: { select: { idColor: true, precio: true } },
            },
          },
        },
      },
    },
  },
  recetaAvios: {
    where: { excluido: false, liberadoEn: { not: null } },
    select: {
      idAvio: true,
      consumoPorPrenda: true,
      consumoPorTalla: true,
      paraProduccion: true,
      idAvioProveedor: true,
      // ⭐ V1-E3m (§Post-F9.82): la asignación de COMPRAS para ESTA orden (último escalón).
      idProveedorCompra: true,
      precioCompra: true,
      proveedorCompra: { select: { nombre: true, activo: true } },
      tallas: { select: { idTalla: true, consumo: true } },
      avio: {
        select: {
          clave: true,
          descripcion: true,
          unidad: true,
          esGenerico: true,
          precioReferencia: true,
          // ⭐⭐ §Post-F9.105 — ¿el avío se compra POR MEDIDA? Es el ÚNICO hecho del que sale esa
          // respuesta (el mismo que usan el BOM, la receta y el precosto: ≥1 medida ACTIVA). Sin
          // él en el `select`, la explosión no podía emitir el aviso **aunque quisiera** — y por
          // eso la compra de los cierres salía 53 veces inflada sin que nadie dijera nada.
          _count: { select: { medidas: { where: { activo: true } } } },
          proveedores: {
            select: {
              idProveedor: true,
              precio: true,
              // ⭐ V1-E3m: quién es el HABITUAL. Con esto el "más barato" de F4 deja de ser la
              // regla general y pasa a ser el fallback del avío que nadie ha marcado.
              habitual: true,
              proveedor: { select: { nombre: true, activo: true } },
            },
          },
        },
      },
    },
  },
  lineas: {
    select: {
      idColor: true,
      // ⭐ V1-E3u: el nombre del color, para que "falta decir de qué color" pueda DECIR cuál.
      color: { select: { nombre: true } },
      tallas: { select: { idTalla: true, cantidad: true, talla: { select: { etiqueta: true } } } },
    },
  },
} satisfies Prisma.OrdenSelect;

/** Orden cargada con lo que la explosión necesita (receta congelada + matriz + amarres). */
type OrdenParaExplosion = Prisma.OrdenGetPayload<{ select: typeof seleccionOrdenExplosion }>;

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────────

/** Carga la orden (empresa activa, A9) con su RECETA y matriz, o lanza `ErrorNoEncontrado`. */
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

/**
 * ⭐⭐ V1-E3u — PIEZAS POR COLOR de la matriz color×talla (§Post-F9.89: *"el sistema calcula cuánta
 * tela de cada color pide la OP… sale de la matriz color×talla, que ya existe"*). Es la base del
 * reparto por color: la cantidad de cada renglón de tela es `piezas del color × consumo por prenda`.
 */
function piezasPorColorOrden(
  orden: OrdenParaExplosion,
): Map<number, { piezas: number; nombre: string }> {
  const mapa = new Map<number, { piezas: number; nombre: string }>();
  for (const linea of orden.lineas) {
    const piezas = linea.tallas.reduce((s, t) => s + t.cantidad, 0);
    const previo = mapa.get(linea.idColor);
    if (previo === undefined) {
      mapa.set(linea.idColor, { piezas, nombre: linea.color.nombre });
    } else {
      previo.piezas += piezas;
    }
  }
  return mapa;
}

/**
 * Proveedor/precio elegido + la TRAZA de si el precio se pisó con la última compra real (D1). La
 * traza no es decorativa: los AVISOS tienen que nombrar la fuente REAL del precio con el que quedó
 * la línea. Un aviso que describe mal su propia causa es el mismo pecado que esta etapa corrigió en
 * la receta —decir una cosa y hacer otra—, solo que en prosa.
 */
interface ProveedorPrecioResuelto extends CandidatoProveedor {
  /** ¿El precio final salió de la última COMPRA REAL a ese proveedor (§Post-F9.48)? */
  desdeUltimaCompra: boolean;
}

/**
 * ⭐ §Post-F9.48 (D1, DANIEL 15-ago-2026): **la línea de OC nace con lo último que ESE proveedor
 * cobró**. Recibe el proveedor/precio YA elegido por la política de `proveedor-material.ts` y le
 * PISA el precio con la última compra REAL **a ese mismo proveedor**, si existe.
 *
 * Invariantes que respeta —y por las que existe como paso aparte, en vez de alimentar la cascada
 * compartida—:
 *  • **NUNCA cambia el proveedor.** La elección es de la política y esta función no la toca.
 *  • **NUNCA usa el precio de un tercero.** Solo mira `porMaterialProveedor`, jamás el mapa global:
 *    una OC dirigida a X no puede nacer con lo que cobró Y.
 *  • **Sin compras a ese proveedor, no hace nada**: se queda el precio de catálogo/negociado que
 *    traía (comportamiento anterior intacto → no-regresión).
 *  • `respetarPrecio` deja al llamador BLINDAR un precio más específico que la compra: hoy lo usan
 *    (a) la tela cuyo precio salió del COLOR (`amarre-color`), porque `OrdenCompraLinea` no guarda
 *    color y la última compra es ciega a él, y (b) ⭐ V1-E3m: el precio que **tecleó Compras** al
 *    asignar el proveedor (`precioFijado`) — quien lo escribió sabía lo que iba a pagar HOY, y
 *    pisarlo con una compra vieja convertiría su captura en decorado.
 */
function conUltimoPrecioDelProveedor(
  elegido: CandidatoProveedor,
  material: { tipo: 'tela' | 'avio'; id: number },
  ultimos: UltimosPreciosCompra,
  respetarPrecio = false,
): ProveedorPrecioResuelto {
  if (respetarPrecio || elegido.precioFijado === true) {
    return { ...elegido, desdeUltimaCompra: false };
  }
  const ultima = ultimos.porMaterialProveedor.get(
    claveMaterialProveedor(material.tipo, material.id, elegido.idProveedor),
  );
  return ultima === undefined
    ? { ...elegido, desdeUltimaCompra: false }
    : { ...elegido, precio: ultima.precio, desdeUltimaCompra: true };
}

/**
 * Nombra, EN PROSA, la fuente del precio con el que quedó la línea. La usan los avisos: si el texto
 * dijera "el precio base del proveedor" mientras D1 pisó el precio con la última compra, el aviso
 * mandaría a revisar el dato equivocado.
 */
function fuenteDelPrecioTela(origen: OrigenPrecioTela, desdeUltimaCompra: boolean): string {
  if (desdeUltimaCompra) {
    return 'se usó el precio de la última compra a ese proveedor';
  }
  switch (origen) {
    case 'amarre':
      return 'se usó el precio base del proveedor';
    case 'sugerido':
      // ⚠️ V1-E3m: el `precioSugerido` de la tela es el precio de REFERENCIA, NO el del proveedor.
      // Decirlo con su nombre es la mitad del arreglo: Daniel vio "referencia" y un $0.00 y no supo
      // que estaba mirando otra cosa que el precio de compra.
      return 'ese proveedor no tiene precio negociado: se usó el precio de REFERENCIA de la tela';
    case 'sin-precio':
      return 'no hay ningún precio que usar: la línea nace SIN precio';
    default:
      // `amarre-color` no puede llegar aquí (el color solo resuelve con UN color en la orden) y
      // `color-referencia` es inalcanzable en el MRP (nunca se pasa `precioColorReferencia`).
      return 'se usó el precio que resolvió la cascada';
  }
}

// ── Candidatos de proveedor de una TELA (V1-E3m, §Post-F9.82) ──────────────────────────────────

/** Un renglón proveedor–tela con precio (el amarre de Desarrollo, o el precio negociado del dueño). */
interface FilaPrecioTela {
  precio: Prisma.Decimal | null;
  manejaPrecioPorColor: boolean;
  colores: readonly { idColor: number; precio: Prisma.Decimal | null }[];
}

/**
 * Resuelve el PRECIO de una tela **para un proveedor concreto** con la cascada compartida
 * (`resolverPrecioTela`): precio por color del proveedor → precio base del proveedor → precio de
 * REFERENCIA de la tela. `fila === null` (el proveedor no tiene renglón de precio) cae directo a la
 * referencia — que es un precio distinto y por eso el llamador lo avisa.
 *
 * Precio-por-color: las telas del MRP se consumen por MODELO completo (sin desglose por color en
 * v2), así que sólo se resuelve por color cuando la orden es de UN color; si tiene varios colores
 * con precios de tela DISTINTOS, el precio-por-color NO se aplica y se DEVUELVE la señal para que
 * el llamador lo diga (nada truena en silencio).
 */
function precioTelaDeProveedor(
  precioSugeridoTela: number | null,
  fila: FilaPrecioTela | null,
  colores: number[],
  /**
   * ⭐⭐ V1-E3u (§Post-F9.89(b)) — `TelaColor.precio` del color CON EL QUE SE ESTÁ PIDIENDO. Daniel:
   * *"el precio sale del color"*. El escalón ya existía en la cascada única
   * (`resolverPrecioTela`, paso `color-referencia`) y hasta hoy el MRP no lo llenaba nunca — no
   * tenía cómo, porque el renglón no sabía de qué color era. Ahora sí, así que se pasa: por debajo
   * del precio negociado con ESE proveedor (que es más específico) y por encima de la referencia
   * plana de la tela (que no distingue tonos).
   */
  precioColorReferencia: number | null = null,
): { precio: number | null; origen: OrigenPrecioTela; multiColorConPreciosDistintos: boolean } {
  let precioColor: number | null = null;
  let multiColorConPreciosDistintos = false;
  if (fila !== null && fila.manejaPrecioPorColor) {
    const precioPorColor = new Map(fila.colores.map((c) => [c.idColor, numOrNull(c.precio)]));
    if (colores.length === 1) {
      precioColor = precioPorColor.get(colores[0]!) ?? null;
    } else {
      const distintos = new Set(
        colores.map((id) => precioPorColor.get(id)).filter((p): p is number => p != null),
      );
      multiColorConPreciosDistintos = distintos.size >= 2;
    }
  }
  const resuelto = resolverPrecioTela({
    precioSugerido: precioSugeridoTela,
    precioColorReferencia,
    amarre:
      fila === null
        ? null
        : {
            precio: numOrNull(fila.precio),
            manejaPrecioPorColor: fila.manejaPrecioPorColor,
            precioColor,
          },
  });
  return { precio: resuelto.precio, origen: resuelto.origen, multiColorConPreciosDistintos };
}

/**
 * Un candidato de tela YA resuelto: el proveedor, con qué precio y de qué escalón salió ese precio,
 * más los avisos que **solo importan si este candidato es el que gana**. Los avisos se arman como
 * FUNCIÓN de `desdeUltimaCompra` porque su texto tiene que nombrar la fuente REAL del precio final
 * (D1 pudo haberlo pisado después de elegir).
 */
interface CandidatoTelaResuelto {
  candidato: CandidatoProveedor;
  origenPrecio: OrigenPrecioTela;
  avisos: (desdeUltimaCompra: boolean) => string[];
}

/** Arma un candidato de tela para un proveedor concreto (con su precio y sus avisos). */
function candidatoTela(
  mt: OrdenParaExplosion['recetaTelas'][number],
  proveedor: { idProveedor: number; nombre: string; activo: boolean },
  fila: FilaPrecioTela | null,
  colores: number[],
  etiqueta: string,
  precioCapturado: number | null = null,
  /** ⭐ V1-E3u: `TelaColor.precio` del color con el que se pide este renglón (o null). */
  precioColorReferencia: number | null = null,
): CandidatoTelaResuelto {
  const resuelto = precioTelaDeProveedor(
    numOrNull(mt.tela.precioSugerido),
    fila,
    colores,
    precioColorReferencia,
  );
  const precio = precioCapturado ?? resuelto.precio;
  return {
    candidato: {
      idProveedor: proveedor.idProveedor,
      proveedor: proveedor.nombre,
      precio,
      activo: proveedor.activo,
      ...(precioCapturado === null ? {} : { precioFijado: true }),
    },
    origenPrecio: resuelto.origen,
    avisos: (desdeUltimaCompra: boolean): string[] => {
      const avisos: string[] = [];
      // Proveedor dado de baja: se conserva la sugerencia (alguien lo eligió a propósito y la OC es
      // editable), pero NO en silencio — `generarOCDesdeExplosion`/`crearOC` no validan `activo`.
      if (!proveedor.activo) {
        avisos.push(
          `Tela "${mt.tela.nombre}": el proveedor ${etiqueta} "${proveedor.nombre}" está INACTIVO; ` +
            `se mantiene la sugerencia, revísalo antes de generar la OC.`,
        );
      }
      if (resuelto.multiColorConPreciosDistintos && precioCapturado === null) {
        avisos.push(
          `Tela "${mt.tela.nombre}": la orden tiene varios colores con precios de tela distintos ` +
            `en "${proveedor.nombre}", así que el precio por color no se aplicó; ` +
            `${fuenteDelPrecioTela(resuelto.origen, desdeUltimaCompra)}. ` +
            `Revisa el precio de la OC.`,
        );
      }
      // ⚠️ V1-E3m: el precio de REFERENCIA no es el precio del proveedor. Si la línea terminó
      // valuada con él —y no con una compra real—, se dice: es exactamente la confusión que dejó a
      // Daniel mirando un $0.00 sin saber de dónde salía.
      if (precioCapturado === null && !desdeUltimaCompra && resuelto.origen === 'sugerido') {
        avisos.push(
          `Tela "${mt.tela.nombre}": no hay precio negociado con "${proveedor.nombre}" ni compras ` +
            `previas, así que la OC nace con el precio de REFERENCIA de la tela. Revísalo.`,
        );
      }
      if (precioCapturado === null && !desdeUltimaCompra && resuelto.origen === 'sin-precio') {
        avisos.push(
          `Tela "${mt.tela.nombre}": no hay ningún precio (ni negociado, ni de compras previas, ni ` +
            `de referencia), así que la línea de OC nace SIN precio. Captúralo en la OC.`,
        );
      }
      return avisos;
    },
  };
}

/**
 * Los TRES candidatos de proveedor de una tela, en su orden de precedencia (la elige
 * `elegirProveedorTela`): amarre de Desarrollo → ⭐ DUEÑO de la tela → asignación de Compras.
 *
 * ⭐ **El escalón del DUEÑO es el corazón de V1-E3m.** `Tela.idProveedor` existía desde §Post-F9.11
 * con la regla de Daniel escrita en su propio comentario (*"la felpa de Alsatex y la de otro
 * proveedor son telas DISTINTAS"*), y el MRP no lo miraba: exigía el amarre de F8, pensado para
 * material que se compra a varios. Por eso *"no me deja hacer nada"* con la receta liberada.
 */
function candidatosTela(
  mt: OrdenParaExplosion['recetaTelas'][number],
  colores: number[],
  /** ⭐ V1-E3u: precio del color de tela con el que se pide ESTE renglón (§Post-F9.89(b)). */
  precioColorReferencia: number | null = null,
): {
  amarre: CandidatoTelaResuelto | null;
  dueno: CandidatoTelaResuelto | null;
  compras: CandidatoTelaResuelto | null;
} {
  const tp = mt.telaProveedor;
  const amarre =
    mt.idTelaProveedor === null || tp === null
      ? null
      : candidatoTela(
          mt,
          { idProveedor: tp.idProveedor, nombre: tp.proveedor.nombre, activo: tp.proveedor.activo },
          tp,
          colores,
          'amarrado',
          null,
          precioColorReferencia,
        );

  // ⭐ EL DUEÑO. Su precio sale de su renglón negociado (F8) si lo tiene; si no, de la REFERENCIA
  // de la tela — cosas distintas, y por eso el candidato avisa cuál usó.
  const idDueno = mt.tela.idProveedor;
  const dueno =
    idDueno === null || mt.tela.proveedor === null
      ? null
      : candidatoTela(
          mt,
          {
            idProveedor: idDueno,
            nombre: mt.tela.proveedor.nombre,
            activo: mt.tela.proveedor.activo,
          },
          mt.tela.proveedoresPrecio.find((f) => f.idProveedor === idDueno) ?? null,
          colores,
          'dueño de la tela',
          null,
          precioColorReferencia,
        );

  // ⭐ La asignación de COMPRAS para ESTA orden (último escalón, §Post-F9.82).
  const idCompras = mt.idProveedorCompra;
  const compras =
    idCompras === null || mt.proveedorCompra === null
      ? null
      : candidatoTela(
          mt,
          {
            idProveedor: idCompras,
            nombre: mt.proveedorCompra.nombre,
            activo: mt.proveedorCompra.activo,
          },
          mt.tela.proveedoresPrecio.find((f) => f.idProveedor === idCompras) ?? null,
          colores,
          'que asignó Compras',
          numOrNull(mt.precioCompra),
          precioColorReferencia,
        );

  return { amarre, dueno, compras };
}

// ── Candidatos de proveedor de un AVÍO (V1-E3m, §Post-F9.82) ───────────────────────────────────

/** Un candidato de avío ya resuelto (proveedor + precio) con los avisos que solo valen si gana. */
interface CandidatoAvioResuelto {
  candidato: CandidatoProveedor;
  avisos: (desdeUltimaCompra: boolean) => string[];
}

/**
 * Envuelve un candidato de avío con sus avisos: proveedor INACTIVO (se conserva la sugerencia, pero
 * se dice) y precio ausente/de referencia. `precioCapturado` es el que tecleó Compras al asignar:
 * si viene, MANDA (y no se avisa nada del precio: lo puso una persona a propósito).
 */
function conAvisosAvio(
  ma: OrdenParaExplosion['recetaAvios'][number],
  base: CandidatoProveedor,
  etiqueta: string,
  precioCapturado: number | null = null,
): CandidatoAvioResuelto {
  const nombreMaterial = `${ma.avio.clave} — ${ma.avio.descripcion}`;
  const precioReferencia = numOrNull(ma.avio.precioReferencia);
  // Sin precio del proveedor: la REFERENCIA del avío es el último recurso (ADR-0009) y se avisa.
  const usaReferencia =
    precioCapturado === null && base.precio === null && precioReferencia !== null;
  const precio = precioCapturado ?? base.precio ?? (usaReferencia ? precioReferencia : null);
  return {
    candidato: {
      ...base,
      precio,
      ...(precioCapturado === null ? {} : { precioFijado: true }),
    },
    avisos: (desdeUltimaCompra: boolean): string[] => {
      const avisos: string[] = [];
      if (!base.activo) {
        avisos.push(
          `Avío "${nombreMaterial}": el proveedor ${etiqueta} "${base.proveedor}" está INACTIVO; ` +
            `se mantiene la sugerencia, revísalo antes de la OC.`,
        );
      }
      if (desdeUltimaCompra || precioCapturado !== null) {
        return avisos;
      }
      if (usaReferencia) {
        avisos.push(
          `Avío "${nombreMaterial}": "${base.proveedor}" no tiene precio capturado ni compras ` +
            `previas, así que la OC nace con el precio de REFERENCIA del avío. Revísalo.`,
        );
      } else if (precio === null) {
        avisos.push(
          `Avío "${nombreMaterial}": no hay ningún precio para "${base.proveedor}", así que la ` +
            `línea de OC nace SIN precio. Captúralo en la OC.`,
        );
      }
      return avisos;
    },
  };
}

/**
 * Resuelve el candidato AMARRADO por Desarrollo (`OrdenAvio.idAvioProveedor`, F8-E6) con
 * `resolverPrecioAvio`. Devuelve `null` si no hay amarre o si el amarrado no tiene precio usable —
 * y entonces el llamador cae al HABITUAL y, si tampoco, al "más barato" de F4 (fallback INTACTO →
 * no-regresión).
 */
function candidatoAvioAmarrado(
  ma: OrdenParaExplosion['recetaAvios'][number],
): CandidatoAvioResuelto | null {
  if (ma.idAvioProveedor === null) return null;
  const fila = ma.avio.proveedores.find((p) => p.idProveedor === ma.idAvioProveedor);
  if (fila === undefined) return null;
  // Sólo la fila amarrada + sin `precioReferencia`: así el fallback "más barato"/referencia de
  // `resolverPrecioAvio` NO elige a otro (esa red la tejen el habitual y el más barato).
  const resuelto = resolverPrecioAvio({
    precioReferencia: null,
    idAvioProveedor: ma.idAvioProveedor,
    proveedores: [
      {
        idProveedor: fila.idProveedor,
        precio: numOrNull(fila.precio),
      },
    ],
  });
  if (resuelto.origen !== 'amarre' || resuelto.idProveedor === null) {
    return null; // amarre sin precio usable → sigue la cascada
  }
  return conAvisosAvio(
    ma,
    {
      idProveedor: fila.idProveedor,
      proveedor: fila.proveedor.nombre,
      precio: resuelto.precio,
      activo: fila.proveedor.activo,
    },
    'amarrado',
  );
}

/** Las filas `AvioProveedor` del avío en la forma que consume la política pura. */
function filasProveedorAvio(ma: OrdenParaExplosion['recetaAvios'][number]): FilaProveedorAvio[] {
  return ma.avio.proveedores.map((p) => ({
    idProveedor: p.idProveedor,
    proveedor: p.proveedor.nombre,
    activo: p.proveedor.activo,
    precio: numOrNull(p.precio),
    habitual: p.habitual,
  }));
}

/**
 * Los CUATRO candidatos de proveedor de un avío, en orden de precedencia (`elegirProveedorAvio`):
 * amarre de Desarrollo → ⭐ HABITUAL → más barato (F4) → asignación de Compras.
 */
function candidatosAvio(ma: OrdenParaExplosion['recetaAvios'][number]): {
  amarre: CandidatoAvioResuelto | null;
  habitual: CandidatoAvioResuelto | null;
  masBarato: CandidatoAvioResuelto | null;
  compras: CandidatoAvioResuelto | null;
} {
  const filas = filasProveedorAvio(ma);

  const habitualBase = candidatoHabitualAvio(filas);
  const masBaratoBase = candidatoMasBaratoAvio(filas);

  // ⭐ La asignación de COMPRAS: su precio es el que tecleó el comprador; si no capturó, el del
  // renglón de ese proveedor (si lo hay) y, si no, la referencia del avío.
  const idCompras = ma.idProveedorCompra;
  const filaCompras =
    idCompras === null ? undefined : filas.find((f) => f.idProveedor === idCompras);
  const compras =
    idCompras === null || ma.proveedorCompra === null
      ? null
      : conAvisosAvio(
          ma,
          {
            idProveedor: idCompras,
            proveedor: ma.proveedorCompra.nombre,
            precio: filaCompras === undefined ? null : precioProveedorAvio(filaCompras),
            activo: ma.proveedorCompra.activo,
          },
          'que asignó Compras',
          numOrNull(ma.precioCompra),
        );

  return {
    amarre: candidatoAvioAmarrado(ma),
    habitual: habitualBase === null ? null : conAvisosAvio(ma, habitualBase, 'habitual'),
    masBarato: masBaratoBase === null ? null : conAvisosAvio(ma, masBaratoBase, 'más barato'),
    compras,
  };
}

/**
 * Lo MÍNIMO que {@link requeridoAvio} necesita de un renglón de receta de avío. Se escribe
 * estructuralmente (y no como `OrdenParaExplosion['recetaAvios'][number]`) por la misma razón que
 * `AvioRecetaR18`: así la regla se puede PROBAR sin base de datos ni un payload de Prisma entero —
 * y queda dicho, en el tipo, que la decisión depende de cuatro datos y no del `select` completo.
 */
export interface AvioDeLaExplosion {
  consumoPorPrenda: Prisma.Decimal;
  consumoPorTalla: boolean;
  tallas: { idTalla: number; consumo: Prisma.Decimal }[];
  avio: {
    clave: string;
    descripcion: string;
    unidad: string | null;
    /** ⭐ §Post-F9.105: `medidas` = medidas ACTIVAS del avío. >0 ⇒ se compra POR MEDIDA. */
    _count: { medidas: number };
  };
}

/**
 * Cantidad requerida de un AVÍO (R18). Delega el cálculo PURO al helper COMPARTIDO
 * `requeridoAvioReceta` (`produccion/receta-avios.ts`, DEBE-2 — misma regla que la habilitación) y
 * aquí sólo arma los AVISOS: las tallas que cayeron al consumo por prenda (al pie, son un apunte de
 * valuación) y ⭐⭐ **la CONTRADICCIÓN de §Post-F9.105, que va pegada AL RENGLÓN**.
 *
 * 🔴 **Por qué el de la contradicción NO va con los otros.** Los avisos de `avisos` se pintan al pie
 * en gris, bajo *"Notas de la explosión (precios y proveedores)"*: son apuntes sobre cómo quedó
 * valuada la compra. Meter ahí un *"estás pidiendo 53 veces de más"* sería mostrarlo y esconderlo a
 * la vez — el pecado exacto que esta etapa vino a corregir (el aviso existía desde V1-E3g… dentro
 * de un desplegable colapsado). Por eso viaja en el renglón: **donde se ve el número inflado**.
 *
 * El texto es el MISMO de las otras dos pantallas (`catalogos/unidades-avio.ts`); lo único que
 * cambia es a dónde manda a arreglarlo, porque desde aquí no se arregla.
 */
export function requeridoAvio(
  ma: AvioDeLaExplosion,
  totalPiezas: number,
  piezasPorTalla: Map<number, { piezas: number; etiqueta: string }>,
  avisos: string[],
): { requerido: number; avisosRenglon: string[] } {
  const piezasSimple = new Map([...piezasPorTalla].map(([id, v]) => [id, v.piezas]));
  const { requerido, tallasSinMedida } = requeridoAvioReceta(ma, totalPiezas, piezasSimple);
  if (tallasSinMedida.length > 0) {
    const etiquetas = tallasSinMedida.map((id) => piezasPorTalla.get(id)?.etiqueta ?? String(id));
    avisos.push(
      `Avío "${ma.avio.clave} — ${ma.avio.descripcion}": sin medida por talla (R18) para ` +
        `${etiquetas.join(', ')}; se usó el consumo por prenda.`,
    );
  }
  // ⭐⭐ §Post-F9.105 — "es por medida" sale de UN solo hecho: ≥1 medida ACTIVA en el catálogo del
  // avío (el mismo criterio que `modoCapturaAvio` y que el precosto). La explosión NO apaga la
  // bandera ni corrige el requerido: sólo lo DICE (D3 — una lectura no cambia datos).
  //
  // 🔴 **Y sólo si el requerido de verdad está DESCUADRADO** (2ª vuelta del reviewer). La bandera
  // puede estar encendida sin que nadie haya capturado cantidades por talla: ahí R18 cae al consumo
  // por prenda y el número sale BIEN. En la receta ese renglón se avisa igual —es donde se arregla,
  // y una captura futura lo volvería a inflar—, pero aquí sería un aviso amarillo colgado de un
  // número correcto, en la pantalla que acaba de pasar por la limpieza de §Post-F9.96.
  const medido =
    ma.avio._count.medidas > 0 && ma.consumoPorTalla
      ? requeridoContradictorioPorMedida(ma, totalPiezas, piezasSimple, ma.avio.unidad)
      : null;
  const avisosRenglon =
    medido !== null && hayDescuadreDeRequerido(medido)
      ? [
          avisoAvioPorMedidaConCantidadesPorTalla(
            'Se arregla en la receta de la orden: abre ese renglón de avío, guárdalo (con eso se ' +
              'normaliza) y vuelve a explotar.',
            medido,
          ),
        ]
      : [];
  return { requerido, avisosRenglon };
}

/**
 * ⭐ V1-E3m (§Post-F9.82) — CIERRA la elección de proveedor de UN material: recibe los candidatos ya
 * armados, deja que la política pura elija (`proveedor-material.ts`), le pisa el precio con la
 * última compra REAL a ESE proveedor (D1/§Post-F9.48) y suelta los avisos **del que ganó** — nunca
 * los de los que no se usaron, que serían ruido sobre decisiones que nadie tomó.
 *
 * También delata la ASIGNACIÓN DORMIDA: Compras había asignado un proveedor para esta orden y ya no
 * se usa porque Desarrollo/el catálogo resolvieron. Es el comportamiento buscado —Desarrollo manda—
 * pero callarlo dejaría a alguien creyendo que compra a quien él eligió (D3).
 */
function cerrarEleccion(
  eleccion: ResolucionProveedorMaterial,
  avisosCandidato: ((desdeUltimaCompra: boolean) => string[]) | null,
  material: { tipo: 'tela' | 'avio'; id: number; nombre: string },
  ultimos: UltimosPreciosCompra,
  avisos: string[],
  respetarPrecio = false,
  nombreAsignadoPorCompras: string | null = null,
): {
  idProveedor: number | null;
  proveedor: string | null;
  precio: number | null;
  inactivo: boolean;
} {
  if (eleccion.asignacionDormida && nombreAsignadoPorCompras !== null) {
    avisos.push(
      `${material.tipo === 'tela' ? 'Tela' : 'Avío'} "${material.nombre}": Compras había asignado a ` +
        `"${nombreAsignadoPorCompras}" para esta orden, pero ya NO se usa porque el proveedor viene ` +
        `${eleccion.origen === 'amarre-desarrollo' ? 'de Desarrollo' : 'del catálogo'} ` +
        `("${eleccion.elegido?.proveedor ?? '—'}"). Quita la asignación si ya no hace falta.`,
    );
  }
  if (eleccion.elegido === null) {
    return { idProveedor: null, proveedor: null, precio: null, inactivo: false };
  }
  const resuelto = conUltimoPrecioDelProveedor(
    eleccion.elegido,
    { tipo: material.tipo, id: material.id },
    ultimos,
    respetarPrecio,
  );
  if (avisosCandidato !== null) {
    avisos.push(...avisosCandidato(resuelto.desdeUltimaCompra));
  }
  return {
    idProveedor: resuelto.idProveedor,
    proveedor: resuelto.proveedor,
    precio: resuelto.precio,
    // Se CONSERVA la sugerencia (el aviso ya lo dice), pero viaja la bandera: sin ella la pantalla
    // no podía ofrecer la reasignación en el único renglón donde de verdad urge.
    inactivo: !resuelto.activo,
  };
}

/**
 * Calcula los requerimientos de una orden (función de cálculo R3; la lectura del stock de avíos
 * genéricos y de las últimas compras las hace contra `tx`). Para cada renglón de la RECETA DE LA
 * ORDEN `paraProduccion`:
 *   • TELA: requerido = consumoPorPrenda × totalPiezas. Proveedor: **amarre de Desarrollo → ⭐ DUEÑO
 *     de la tela (§Post-F9.11/V1-E3m) → asignación de Compras**. Antes de V1-E3m, sin amarre se
 *     quedaba en NULL — y como el amarre casi nunca existe, la explosión llegaba entera sin
 *     proveedor y el botón de generar OC no encendía nunca (el atorón de Daniel).
 *   • AVÍO: requerido = consumoPorPrenda × totalPiezas, o Σ(medida×piezas) si se consume por talla
 *     (R18, `requeridoAvio`). Proveedor: **amarre → ⭐ HABITUAL → más barato (F4, fallback intacto)
 *     → asignación de Compras**.
 * AVÍOS genéricos (decisión (d)): netea contra el stock REAL (Σ kardex, D3) → solo el faltante va a
 * compra. Telas y avíos NO genéricos van completos a compra. Los casos ambiguos van a `avisos`.
 *
 * ⭐ **PRECIO de la línea (D1/§Post-F9.48):** una vez elegido el proveedor, el precio se PISA con el
 * de la última compra REAL **a ese mismo proveedor** ({@link conUltimoPrecioDelProveedor}); si nunca
 * se le compró, queda el de catálogo/negociado. La elección del proveedor NO cambia y jamás se usa
 * el precio de un tercero.
 */
async function calcularRequerimientos(
  tx: Tx,
  orden: OrdenParaExplosion,
  totalPiezas: number,
  existenciaGenerico: (idAvio: number) => Promise<number>,
  avisos: string[],
  /** ⭐ V1-E3u: se LLENA aquí — las telas cuyo color todavía nadie dijo (§Post-F9.89, D3). */
  pendientesColor: PendienteColor[],
): Promise<RequerimientoCalculado[]> {
  const resultado: RequerimientoCalculado[] = [];
  const colores = coloresDeOrden(orden);
  const piezasPorColor = piezasPorColorOrden(orden);
  const piezasPorTalla = piezasPorTallaOrden(orden);
  // ⭐ D1/§Post-F9.48: últimas compras REALES de toda la RECETA, EN UN LOTE y acotadas a la empresa
  // de la orden (A9). Solo se usa el mapa POR PROVEEDOR: la línea de OC jamás nace con el precio de
  // un tercero. Si la receta está vacía, ni se consulta.
  const materiales = {
    telas: orden.recetaTelas.filter((t) => t.paraProduccion).map((t) => t.idTela),
    avios: orden.recetaAvios.filter((a) => a.paraProduccion).map((a) => a.idAvio),
  };
  const ultimos =
    materiales.telas.length === 0 && materiales.avios.length === 0
      ? SIN_ULTIMOS_PRECIOS
      : await leerUltimosPreciosCompra(tx, orden.idEmpresa, materiales);

  // ── TELAS de la RECETA DE LA ORDEN (paraProduccion, no excluidas) ──
  //
  // ⭐⭐ V1-E3u (§Post-F9.89) — **UN RENGLÓN POR TELA×COLOR, y el color sale de la matriz de la OP.**
  // Antes había una fila por tela con `consumo × TODAS las piezas`; ahora hay una por color de tela
  // con `consumo × las piezas DE ESE COLOR`. La Σ es idéntica (Σ piezas por color = total piezas),
  // así que la orden no compra ni un gramo de más ni de menos por partirse: lo que cambia es que
  // ahora **se puede pedir**, que era justo lo que faltaba.
  for (const mt of orden.recetaTelas) {
    if (!mt.paraProduccion) continue;
    const consumo = num(mt.consumoPorPrenda);
    const amarrados = new Map(mt.colores.map((c) => [c.idColor, c]));

    // Agrupa los colores de la MATRIZ por el color de tela que tienen dicho. Dos colores de prenda
    // que se cortan de la misma tela y el mismo tono caen en el MISMO grupo: es la decisión (c) de
    // Daniel (*"se compra el color y el almacén lo reparte"*) aplicada dentro de una sola OP.
    interface GrupoColor {
      idTelaColor: number | null;
      telaColor: string | null;
      precioColor: number | null;
      piezas: number;
      /** Colores de PRENDA que caen en este grupo (el precio por color del proveedor los usa). */
      coloresPrenda: number[];
      /** Nombres de esos colores, para poder decir CUÁLES faltan por capturar. */
      nombresPrenda: string[];
    }
    const grupos = new Map<number | 'sin', GrupoColor>();
    for (const [idColor, { piezas, nombre }] of piezasPorColor) {
      const amarre = amarrados.get(idColor);
      const llave: number | 'sin' = amarre === undefined ? 'sin' : amarre.idTelaColor;
      const grupo = grupos.get(llave) ?? {
        idTelaColor: amarre?.idTelaColor ?? null,
        telaColor: amarre?.telaColor.nombre ?? null,
        precioColor: amarre === undefined ? null : numOrNull(amarre.telaColor.precio),
        piezas: 0,
        coloresPrenda: [],
        nombresPrenda: [],
      };
      grupo.piezas += piezas;
      grupo.coloresPrenda.push(idColor);
      grupo.nombresPrenda.push(nombre);
      grupos.set(llave, grupo);
    }
    // Una orden sin matriz (0 colores) sigue teniendo su renglón: se compra la tela sin color, como
    // siempre. Sin esto, una OP a la que todavía no le capturan la matriz dejaría de explotar.
    if (grupos.size === 0) {
      grupos.set('sin', {
        idTelaColor: null,
        telaColor: null,
        precioColor: null,
        piezas: totalPiezas,
        coloresPrenda: colores,
        nombresPrenda: [],
      });
    }

    // 🔴 LO QUE FALTA POR DECIR, DICHO (D3). El grupo `sin` NO se calla ni se deja de comprar: se
    // compra sin color —para que la OP no se quede corta por un dato que falta capturar— y se
    // REPORTA, con los nombres de los colores, para que el comprador lo arregle en su pantalla.
    const sinDecir = grupos.get('sin');
    if (sinDecir !== undefined && sinDecir.nombresPrenda.length > 0) {
      pendientesColor.push({
        idTela: mt.idTela,
        tela: mt.tela.nombre,
        // ⭐ V1-E3u: de QUÉ orden es (la acción de la pantalla abre ESTA, no la primera del lote).
        idOrden: orden.id,
        folioOrden: Number(orden.folio),
        colores: [...sinDecir.nombresPrenda].sort((a, b) => a.localeCompare(b, 'es')),
        cantidadRequerida: consumo * sinDecir.piezas,
        unidad: mt.tela.unidadMedida,
      });
    }

    for (const grupo of grupos.values()) {
      const requerida = consumo * grupo.piezas;
      const candidatos = candidatosTela(mt, grupo.coloresPrenda, grupo.precioColor);
      const eleccion = elegirProveedorTela({
        amarre: candidatos.amarre?.candidato,
        dueno: candidatos.dueno?.candidato,
        compras: candidatos.compras?.candidato,
      });
      const ganador =
        eleccion.origen === 'amarre-desarrollo'
          ? candidatos.amarre
          : eleccion.origen === 'dueno-tela'
            ? candidatos.dueno
            : eleccion.origen === 'asignado-compras'
              ? candidatos.compras
              : null;
      const sugerido = cerrarEleccion(
        eleccion,
        ganador?.avisos ?? null,
        {
          tipo: 'tela',
          id: mt.idTela,
          nombre:
            grupo.telaColor === null ? mt.tela.nombre : `${mt.tela.nombre} · ${grupo.telaColor}`,
        },
        ultimos,
        avisos,
        // Un precio por COLOR es MÁS específico que la última compra (que no sabe de colores): no se
        // pisa. Mismo argumento que protege al promedio de medidas en los avíos. Y desde V1-E3u eso
        // vale también para el precio del COLOR DE TELA (`color-referencia`): es del tono que se
        // está pidiendo, mientras que la última compra puede ser de otro tono por completo.
        ganador?.origenPrecio === 'amarre-color' || ganador?.origenPrecio === 'color-referencia',
        candidatos.compras?.candidato.proveedor ?? null,
      );
      resultado.push({
        tipo: 'tela',
        idTela: mt.idTela,
        idAvio: null,
        idTelaColor: grupo.idTelaColor,
        telaColor: grupo.telaColor,
        material: mt.tela.nombre,
        cantidadRequerida: requerida,
        unidad: mt.tela.unidadMedida,
        esGenerico: false,
        existenciaStock: 0,
        cantidadAComprar: requerida, // telas siempre van completas a compra (no se netean)
        idProveedorSugerido: sugerido.idProveedor,
        proveedorSugerido: sugerido.proveedor,
        precioSugerido: sugerido.precio,
        origenProveedor: eleccion.origen,
        proveedorSugeridoInactivo: sugerido.inactivo,
        // Las telas no tienen medidas por talla: nada que advertir por este lado.
        avisos: [],
      });
    }
  }

  // ── AVÍOS de la RECETA DE LA ORDEN (paraProduccion, no excluidos) ──
  for (const ma of orden.recetaAvios) {
    if (!ma.paraProduccion) continue;
    const { requerido: requerida, avisosRenglon } = requeridoAvio(
      ma,
      totalPiezas,
      piezasPorTalla,
      avisos,
    );
    const esGenerico = ma.avio.esGenerico;

    let existencia = 0;
    let aComprar = requerida;
    if (esGenerico) {
      // Decisión (d): netea contra el stock REAL del kardex (Σ movimientos, D3). Solo el faltante
      // va a compra; si el stock cubre todo, no genera compra (aComprar = 0).
      existencia = await existenciaGenerico(ma.idAvio);
      aComprar = Math.max(0, requerida - existencia);
    }

    const candidatos = candidatosAvio(ma);
    const eleccion = elegirProveedorAvio({
      amarre: candidatos.amarre?.candidato,
      habitual: candidatos.habitual?.candidato,
      masBarato: candidatos.masBarato?.candidato,
      compras: candidatos.compras?.candidato,
    });
    const ganador =
      eleccion.origen === 'amarre-desarrollo'
        ? candidatos.amarre
        : eleccion.origen === 'habitual'
          ? candidatos.habitual
          : eleccion.origen === 'mas-barato'
            ? candidatos.masBarato
            : eleccion.origen === 'asignado-compras'
              ? candidatos.compras
              : null;
    const nombreMaterial = `${ma.avio.clave} — ${ma.avio.descripcion}`;
    const sugerido = cerrarEleccion(
      eleccion,
      ganador?.avisos ?? null,
      { tipo: 'avio', id: ma.idAvio, nombre: nombreMaterial },
      ultimos,
      avisos,
      false,
      candidatos.compras?.candidato.proveedor ?? null,
    );
    resultado.push({
      tipo: 'avio',
      idTela: null,
      idAvio: ma.idAvio,
      // ⚠️ Los AVÍOS no llevan color, y NO es un olvido: en el modelo de datos el avío no tiene
      // colores en ningún lado (ni catálogo, ni kardex, ni recepción). Daniel lo sospechó
      // (*"y seguramente también en avíos"*); al medirlo resultó ser un hueco DISTINTO y más
      // grande, que necesita su propia etapa (ver la nota de V1-E3u en la ficha).
      idTelaColor: null,
      telaColor: null,
      material: nombreMaterial,
      cantidadRequerida: requerida,
      unidad: ma.avio.unidad,
      esGenerico,
      existenciaStock: existencia,
      cantidadAComprar: aComprar,
      idProveedorSugerido: sugerido.idProveedor,
      proveedorSugerido: sugerido.proveedor,
      precioSugerido: sugerido.precio,
      origenProveedor: eleccion.origen,
      proveedorSugeridoInactivo: sugerido.inactivo,
      // ⭐⭐ §Post-F9.105: el aviso viaja PEGADO al renglón (ver `requeridoAvio`).
      avisos: avisosRenglon,
    });
  }

  return resultado;
}

/**
 * Clave estable de un requerimiento (para casar snapshot viejo vs nuevo en el diff).
 *
 * ⭐ V1-E3u: incluye el COLOR, porque desde §Post-F9.89 la identidad de un renglón de tela es
 * *(tela, color)*. Sin el color, dos renglones de la misma tela en colores distintos se pisarían al
 * calcular el diff y la pantalla marcaría "cambió" un renglón que no cambió.
 */
function claveRequerimiento(r: {
  idTela: number | null;
  idAvio: number | null;
  idTelaColor?: number | null;
}): string {
  if (r.idTela === null) return `avio-${String(r.idAvio)}`;
  return `tela-${String(r.idTela)}-c${r.idTelaColor == null ? 'sin' : String(r.idTelaColor)}`;
}

/** Estado de un genérico tras netear (decisión (d)) — para la UI. */
function estadoGenerico(r: RequerimientoCalculado): EstadoGenerico {
  if (!r.esGenerico) return 'no-aplica';
  return r.cantidadAComprar <= TOLERANCIA ? 'cubierto-por-stock' : 'faltante-parcial';
}

// ── Proyección a la salida ─────────────────────────────────────────────────────────────────────────

/** Fila del snapshot ya escrita, con la traza del cálculo que NO se persiste. */
interface FilaSnapshot {
  fila: RequerimientoOrden & {
    tela: { nombre: string } | null;
    avio: { clave: string; descripcion: string } | null;
    telaColor: { nombre: string } | null;
    proveedorSugerido: { nombre: string } | null;
  };
  diff: DiffRequerimiento;
  /**
   * ⭐ V1-E3m: de dónde salió el proveedor. NO se persiste en el snapshot: es una TRAZA del cálculo
   * que se acaba de hacer, y guardarla obligaría a mantenerla al día cada vez que cambie el
   * catálogo — un dato viejo aquí mentiría sobre quién eligió al proveedor.
   */
  origenProveedor: OrigenProveedor;
  /** ⭐ V1-E3m: ¿el proveedor propuesto está de baja? (tampoco se persiste: es traza del cálculo). */
  proveedorSugeridoInactivo: boolean;
  /** Cambios del modelo que afectan a ESTE material (§Post-F9.43(d)); vacío = nada que avisar. */
  cambiosReceta: TipoCambioRecetaClave[];
  /**
   * ⭐⭐ §Post-F9.105 — avisos DEL RENGLÓN (la contradicción «por medida + cantidades por talla»).
   * Tampoco se persisten: son traza del cálculo que se acaba de hacer, igual que `cambiosReceta`.
   * Guardarlos obligaría a mantenerlos al día cada vez que alguien arregle la receta.
   */
  avisos: string[];
}

/** Lo que la explosión calculó para UNA orden, antes de agrupar entre órdenes. */
interface ExplosionDeOrden {
  orden: OrdenParaExplosion;
  ficha: OrdenExplosionada;
  filas: FilaSnapshot[];
  /** Materiales que estaban en el snapshot previo y ya no (se muestran, no se persisten). */
  eliminados: RequerimientoSalida[];
  pendientesLiberar: PendienteLiberar[];
  /** ⭐ V1-E3u: telas a las que falta decirles de qué color se compran (§Post-F9.89, D3). */
  pendientesColor: PendienteColor[];
  desalineacion: ExplosionSalida['desalineacion'];
  regenerado: boolean;
}

/** Ficha ligera de una orden para la salida (incluye su pedido interno, §Post-F9.86). */
function fichaDeOrden(orden: OrdenParaExplosion, totalPiezas: number): OrdenExplosionada {
  return {
    idOrden: orden.id,
    folio: Number(orden.folio),
    idModelo: orden.idModelo,
    modelo: orden.modelo.codigo,
    totalPiezas,
    idPedido: orden.pedidoLinea?.idPedido ?? null,
    folioPedido:
      orden.pedidoLinea?.pedido === undefined ? null : Number(orden.pedidoLinea.pedido.folio),
    fechaEntrega:
      orden.fechaEntrega === null ? null : orden.fechaEntrega.toISOString().slice(0, 10),
  };
}

/**
 * ⭐ V1-E3q — **CLAVE DE AGRUPACIÓN entre OP** (§Post-F9.86: *"que vaya agrupando las cantidades"*).
 * Un renglón de la pantalla es un **material + el proveedor al que se le va a comprar**: si dos OP
 * compran la misma felpa a proveedores distintos (una la tiene amarrada por Desarrollo y la otra
 * no), son DOS compras distintas y no se pueden sumar — cada una acaba en su propia OC.
 */
function claveAgrupada(fila: {
  idTela: number | null;
  idAvio: number | null;
  idTelaColor: number | null;
  idProveedorSugerido: number | null;
}): string {
  // ⭐⭐ V1-E3u (§Post-F9.89(c)): el COLOR entra en la clave. *"Se compra el color y el almacén lo
  // reparte"*: dos OP que necesitan el MISMO color de la MISMA tela se suman en un solo renglón —y
  // dos colores distintos NO se suman, aunque sean la misma tela, porque son dos compras distintas
  // y quien recibe tiene que poder distinguirlas.
  const color = fila.idTelaColor === null ? 'sin' : String(fila.idTelaColor);
  return `${claveMaterial(fila)}|${color}|${fila.idProveedorSugerido === null ? 'sin' : String(fila.idProveedorSugerido)}`;
}

/**
 * ⭐⭐ §Post-F9.105 — un aviso del renglón dice **DE QUÉ OP habla** sólo cuando hay varias en
 * pantalla. Con una sola sería repetir el encabezado en cada línea (el mismo criterio con el que la
 * pantalla enseña o esconde el reparto por OP).
 *
 * 🔴 Se saca a función PURA y exportada porque vivía como closure y **ninguna prueba la sostenía**:
 * el reviewer la mutó a "nunca prefijar" y todo siguió en verde (mutación 14). Justo el caso en que
 * el aviso sirve de algo —dos OP en pantalla, sólo una descuadrada— era el que nadie fijaba.
 */
export function prefijarConLaOrden(aviso: string, folio: number, variasOrdenes: boolean): string {
  return variasOrdenes ? `Orden ${String(folio)}: ${aviso}` : aviso;
}

/**
 * Proyecta las filas de snapshot de TODAS las órdenes a los renglones de la pantalla, **agrupando
 * por material+proveedor y guardando el reparto por OP** (§Post-F9.86: *"se ve junto, se guarda
 * repartido"*), y **neteando contra lo que ya está en una OC** (§Post-F9.85, `comprometidoEnOc`).
 */
function proyectarRenglones(
  explosiones: ExplosionDeOrden[],
  comprometido: ComprometidoPorOrden,
): RequerimientoSalida[] {
  const porClave = new Map<string, RequerimientoSalida>();

  for (const e of explosiones) {
    // ⭐⭐ V1-E3u — EL NETEO, AHORA POR COLOR. Un renglón de tela se netea contra las líneas de OC
    // de SU color; el acervo de líneas SIN color (todo lo anterior a esta etapa) se reparte con la
    // regla escrita en `repartirComprometidoPorColor`, que con un solo renglón sin color devuelve
    // exactamente lo de antes. Se calcula UNA vez por (orden, material) y no por fila, porque la
    // regla necesita ver a todos los hermanos del mismo material a la vez.
    const conFolio = (aviso: string): string =>
      prefijarConLaOrden(aviso, e.ficha.folio, explosiones.length > 1);

    const enOcPorFila = new Map<number, number>();
    /** ⭐ V1-E3u: cuánto del `enOc` de cada fila viene de una OC que NO dice el color. */
    const ambiguoPorFila = new Map<number, number>();
    const porMaterialOrden = new Map<string, typeof e.filas>();
    for (const f of e.filas) {
      const clave = claveMaterial(f.fila);
      const grupo = porMaterialOrden.get(clave) ?? [];
      grupo.push(f);
      porMaterialOrden.set(clave, grupo);
    }
    for (const [clave, grupo] of porMaterialOrden) {
      const repartido = repartirComprometidoPorColor(
        grupo.map((f) => ({
          idTelaColor: f.fila.idTelaColor,
          cantidadAComprar: Number(f.fila.cantidadAComprar),
        })),
        comprometido.get(e.orden.id)?.get(clave),
      );
      grupo.forEach((f, i) => {
        enOcPorFila.set(f.fila.id, repartido[i]?.enOc ?? 0);
        ambiguoPorFila.set(f.fila.id, repartido[i]?.desdeAcervoSinColor ?? 0);
      });
    }

    for (const {
      fila,
      diff,
      origenProveedor,
      proveedorSugeridoInactivo,
      cambiosReceta,
      avisos: avisosDelRenglon,
    } of e.filas) {
      const aComprar = Number(fila.cantidadAComprar);
      // 🔴 A LA ESCALA EN QUE SE VA A GUARDAR (corrección del reviewer, 21-ago). `enOc` es Σ de
      // líneas de 2 decimales —redondear quita el polvo de coma flotante— y lo PENDIENTE se compara
      // y se compra en esa misma escala: sin esto, un requerido de 3.7020 contra una línea guardada
      // de 3.70 dejaba 0.002 "pendientes" que ninguna columna puede guardar, y el renglón volvía a
      // ofrecerse para siempre (la queja literal de Daniel).
      // `enOc` ya viene a la escala de su columna desde `comprometidoEnOc` (la única verdad).
      const enOc = enOcPorFila.get(fila.id) ?? 0;
      // ⭐ V1-E3u (§Post-F9.89): la parte de `enOc` que viene de una OC SIN color. La pantalla la
      // marca — atribuirla a ESTE color fue una elección del sistema, no un dato de la OC.
      const enOcAmbiguo = ambiguoPorFila.get(fila.id) ?? 0;
      const pendiente = redondearCantidadCompra(Math.max(0, aComprar - enOc));
      const precio = fila.precioSugerido === null ? null : Number(fila.precioSugerido);
      const material =
        fila.tela?.nombre ??
        (fila.avio === null ? '—' : `${fila.avio.clave} — ${fila.avio.descripcion}`);
      const telaColor = fila.telaColor?.nombre ?? null;

      const reparto: RepartoOrden = {
        idRequerimiento: fila.id,
        idOrden: e.orden.id,
        folioOrden: e.ficha.folio,
        cantidadRequerida: Number(fila.cantidadRequerida),
        cantidadAComprar: aComprar,
        cantidadEnOc: enOc,
        cantidadPendiente: pendiente,
        precioSugerido: precio,
      };

      const clave = claveAgrupada(fila);
      const previo = porClave.get(clave);
      if (previo === undefined) {
        porClave.set(clave, {
          id: fila.id,
          tipo: fila.idTela !== null ? 'tela' : 'avio',
          idTela: fila.idTela,
          idAvio: fila.idAvio,
          idTelaColor: fila.idTelaColor,
          telaColor,
          material,
          cantidadRequerida: reparto.cantidadRequerida,
          unidad: fila.unidad,
          esGenerico: fila.esGenerico,
          estadoGenerico: estadoDeGenerico(fila.esGenerico, aComprar),
          existenciaStock: Number(fila.existenciaStock),
          cantidadAComprar: aComprar,
          idProveedorSugerido: fila.idProveedorSugerido,
          proveedorSugerido: fila.proveedorSugerido?.nombre ?? null,
          precioSugerido: precio,
          origenProveedor,
          proveedorSugeridoInactivo,
          diff,
          cambiosReceta: [...cambiosReceta],
          avisos: avisosDelRenglon.map(conFolio),
          cantidadEnOc: enOc,
          cantidadEnOcSinColor: enOcAmbiguo,
          cantidadPendiente: pendiente,
          idsRequerimiento: [fila.id],
          porOrden: [reparto],
        });
        continue;
      }
      // El PRECIO del renglón agrupado se queda con el de la primera OP: es sólo para la vista, y
      // dos OP pueden traer precios distintos del mismo material (el precio por COLOR del amarre).
      // El precio con el que NACE cada línea es el de su propia OP, y ése viaja en `porOrden`.
      previo.cantidadRequerida += reparto.cantidadRequerida;
      previo.cantidadAComprar += aComprar;
      previo.cantidadEnOc += enOc;
      previo.cantidadEnOcSinColor += enOcAmbiguo;
      previo.cantidadPendiente += pendiente;
      // ⚠️ La existencia de un genérico es de la EMPRESA, no de la orden: **NO se suma**. Con el
      // stock repartido entre el lote, la primera OP ve la existencia entera y las siguientes sólo
      // el remanente; sumarlas diría "hay 140" donde hay 100. Se queda el MÁXIMO, que es la
      // existencia real al empezar la compra — el número que el comprador necesita ver.
      previo.existenciaStock = Math.max(previo.existenciaStock, Number(fila.existenciaStock));
      previo.estadoGenerico = estadoDeGenerico(previo.esGenerico, previo.cantidadAComprar);
      previo.proveedorSugeridoInactivo =
        previo.proveedorSugeridoInactivo || proveedorSugeridoInactivo;
      if (previo.diff === 'sin-cambio' && diff !== 'sin-cambio') previo.diff = diff;
      for (const c of cambiosReceta) {
        if (!previo.cambiosReceta.includes(c)) previo.cambiosReceta.push(c);
      }
      // ⭐⭐ §Post-F9.105: los avisos de las OP que caen en el MISMO renglón se apilan (cada uno con
      // su folio). No se deduplican: dos OP pueden pedir de más cantidades distintas del mismo
      // avío, y quedarse con el primero escondería la mitad del problema.
      previo.avisos.push(...avisosDelRenglon.map(conFolio));
      previo.idsRequerimiento.push(fila.id);
      previo.porOrden.push(reparto);
    }
  }

  return [...porClave.values()];
}

/** Estado de un genérico tras netear contra el stock (decisión (d)) — para la UI. */
function estadoDeGenerico(esGenerico: boolean, aComprar: number): EstadoGenerico {
  if (!esGenerico) return 'no-aplica';
  return aComprar <= TOLERANCIA ? 'cubierto-por-stock' : 'faltante-parcial';
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
 * ⭐ V1-E3q (§Post-F9.86) — **EL STOCK DE GENÉRICOS SE REPARTE ENTRE LAS OP DEL LOTE, NO SE
 * DUPLICA.** Cada orden netea sus genéricos contra la existencia REAL del kardex (decisión (d),
 * D3); si dos OP del mismo lote piden el mismo hilo, explotarlas por separado le daría a las dos la
 * existencia COMPLETA y el sistema compraría de menos — un faltante silencioso justo en el material
 * del que nadie lleva cuenta.
 *
 * Este cierre lleva un LEDGER por lote: la primera OP consume lo que necesita y la siguiente ve
 * sólo el remanente. El orden es determinista (las OP se procesan por folio ascendente), así que
 * dos corridas iguales reparten igual; y la OP más vieja es la que se queda con el stock, que es
 * también la que primero se va a producir.
 */
function existenciaCompartida(
  tx: Tx,
  idEmpresa: number,
): {
  existenciaGenerico: (idAvio: number) => Promise<number>;
  consumirGenerico: (idAvio: number, cantidad: number) => void;
} {
  /** Existencia TOTAL de cada genérico (se consulta UNA sola vez por lote). */
  const total = new Map<number, number>();
  /** Lo que las OP ya procesadas del lote se apartaron de ese genérico. */
  const apartado = new Map<number, number>();
  return {
    existenciaGenerico: async (idAvio: number): Promise<number> => {
      let existencia = total.get(idAvio);
      if (existencia === undefined) {
        existencia = await existenciaAvioTotalEmpresa(tx, idEmpresa, idAvio);
        total.set(idAvio, existencia);
      }
      return Math.max(0, existencia - (apartado.get(idAvio) ?? 0));
    },
    consumirGenerico: (idAvio: number, cantidad: number): void => {
      apartado.set(idAvio, (apartado.get(idAvio) ?? 0) + cantidad);
    },
  };
}

/**
 * Explosiona UNA orden y PERSISTE su snapshot (parte del lote de {@link explosionarOrdenes}). Ya
 * viene dentro de la transacción del lote (A2): o se escriben todos los snapshots o ninguno.
 */
async function explosionarUna(
  tx: Tx,
  sesion: SesionUsuario,
  idOrden: number,
  idEmpresa: number,
  existenciaGenerico: (idAvio: number) => Promise<number>,
  consumirGenerico: (idAvio: number, cantidad: number) => void,
  avisos: string[],
): Promise<ExplosionDeOrden> {
  // La orden PRIMERO (A9): si es de otra empresa se responde 404 y no se dice nada más de ella —
  // ni siquiera si su receta está liberada.
  const orden = await cargarOrden(tx, idOrden, idEmpresa);
  // ⭐ LA PUERTA (V1-E3d §Post-F9.43(c), re-cortada por V1-E3h §Post-F9.72): ya no es todo-o-nada.
  // Con ALGO liberado se explota lo liberado y se REPORTA lo que faltó firmar; con NADA liberado
  // frena (no hay qué comprar) y el mensaje dice dónde se libera. La puerta va antes de COMPRAR,
  // no antes de producir: cortar, enviar a maquila, recibir y entregar NO pasan por aquí.
  const porLiberar = await exigirRecetaLiberada(tx, idOrden, idEmpresa);
  const totalPiezas = totalPiezasOrden(orden);
  const ficha = fichaDeOrden(orden, totalPiezas);
  // El ARTE no se compra por MRP (igual que en el reparto de la desalineación): listarlo aquí
  // sería ruido para quien está viendo materiales.
  const pendientesLiberar: PendienteLiberar[] = porLiberar
    .filter((r) => r.tipo !== 'arte')
    .map((r) => ({
      tipo: r.tipo as 'tela' | 'avio',
      idRenglon: r.idRenglon,
      // ⭐ V1-E3q: con varias OP en pantalla, un "falta liberar la felpa" sin decir de cuál orden
      // manda al comprador a adivinar. El aviso nombra su OP.
      idOrden,
      folioOrden: ficha.folio,
      idTela: r.idTela,
      idAvio: r.idAvio,
      material: r.material,
      consumoPorPrenda: r.consumoPorPrenda,
      unidad: r.unidad,
    }));

  // Avisos de la explosión (F8-E6): tela multi-color con precios distintos, avío por talla sin
  // medida… Nada truena en silencio; se acumulan aquí y viajan en la salida.
  const avisosDeEsta: string[] = [];
  const pendientesColor: PendienteColor[] = [];
  const calculados = await calcularRequerimientos(
    tx,
    orden,
    totalPiezas,
    existenciaGenerico,
    avisosDeEsta,
    pendientesColor,
  );
  // Lo que ESTA orden se llevó del stock compartido queda apartado para la siguiente del lote.
  for (const c of calculados) {
    if (c.esGenerico && c.idAvio !== null && c.existenciaStock > 0) {
      consumirGenerico(c.idAvio, Math.min(c.existenciaStock, c.cantidadRequerida));
    }
  }
  avisos.push(...avisosDeEsta.map((a) => `Orden ${String(ficha.folio)}: ${a}`));

  // Snapshot anterior (para el diff). Se relee por clave material — se traen también proveedor/precio
  // sugeridos: desde F8-E6 el amarre puede cambiar de proveedor/precio SIN mover la cantidad, y ese
  // cambio SÍ es relevante para la UI (los valores ya se persisten bien; solo faltaba la etiqueta).
  const previos = await tx.requerimientoOrden.findMany({
    where: { idOrden },
    select: {
      idTela: true,
      idAvio: true,
      idTelaColor: true,
      cantidadRequerida: true,
      idProveedorSugerido: true,
      precioSugerido: true,
    },
  });
  const previoPorClave = new Map(previos.map((p) => [claveRequerimiento(p), p]));
  const clavesNuevas = new Set(calculados.map(claveRequerimiento));
  /**
   * ⭐⭐ V1-E3u — LOS MATERIALES que siguen en la receta, sin mirar el color.
   *
   * 🔴 Sin esto, la PRIMERA explosión después de decir los colores mentiría: el renglón viejo de la
   * felpa (sin color) no casa con los nuevos (con color), así que caería en `eliminados` y la
   * pantalla diría **"(material retirado del BOM)"** de una tela que nadie retiró — justo después de
   * que el comprador hizo lo que el sistema le pidió. Un aviso que describe mal su propia causa es
   * el mismo pecado que §Post-F9.85 vino a corregir, sólo que en prosa.
   */
  const materialesNuevos = new Set(calculados.map(claveMaterial));
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
    // Se reporta como eliminado sólo si el MATERIAL entero desapareció. Que cambie de color (o que
    // pase de "sin color" a tenerlo) no es una baja: es el mismo material, dicho mejor.
    if (!clavesNuevas.has(clave) && !materialesNuevos.has(claveMaterial(p))) {
      eliminados.push({
        id: -1,
        tipo: p.idTela !== null ? 'tela' : 'avio',
        idTela: p.idTela,
        idAvio: p.idAvio,
        idTelaColor: p.idTelaColor,
        telaColor: null,
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
        origenProveedor: 'sin-proveedor',
        proveedorSugeridoInactivo: false,
        diff: 'eliminado',
        // El renglón ya no existe en la receta: la desalineación no tiene qué marcarle.
        cambiosReceta: [],
        // Ni avisos: no hay renglón vivo del que puedan hablar.
        avisos: [],
        cantidadEnOc: 0,
        cantidadEnOcSinColor: 0,
        cantidadPendiente: 0,
        idsRequerimiento: [],
        porOrden: [],
      });
    }
  }

  // Reemplaza el snapshot: borra el viejo y escribe el nuevo (A2/D3).
  await tx.requerimientoOrden.deleteMany({ where: { idOrden } });
  // ⭐ PRIMER AVISO de §Post-F9.43(d): la desalineación va AQUÍ, el lugar de la decisión — quien
  // está a punto de gastar no debería tener que abrir la orden en otra pantalla para enterarse de
  // que el modelo se movió. Se calcula al vuelo con la MISMA regla de la receta (no se
  // re-implementa) y se reparte por material para MARCAR los renglones afectados.
  const desalineacion = await desalineacionDeOrden(tx, idOrden, idEmpresa);
  const cambiosPorMaterial = new Map<string, TipoCambioRecetaClave[]>();
  for (const c of desalineacion.cambios) {
    if (c.tipo === 'arte') continue; // el arte no se compra por MRP: no tiene renglón que marcar
    const clave = `${c.tipo}-${c.material}`;
    const lista = cambiosPorMaterial.get(clave);
    if (lista === undefined) cambiosPorMaterial.set(clave, [c.que]);
    else lista.push(c.que);
  }
  /** Los cambios que le tocan a un renglón, casados por el MISMO texto de material. */
  const cambiosDe = (r: RequerimientoCalculado): TipoCambioRecetaClave[] =>
    cambiosPorMaterial.get(`${r.tipo}-${r.material}`) ?? [];

  const filas: FilaSnapshot[] = [];
  for (const c of calculados) {
    const creada = await tx.requerimientoOrden.create({
      data: {
        idOrden,
        idTela: c.idTela,
        idAvio: c.idAvio,
        idTelaColor: c.idTelaColor,
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
        telaColor: { select: { nombre: true } },
        proveedorSugerido: { select: { nombre: true } },
      },
    });
    filas.push({
      fila: creada,
      diff: diffPorClave.get(claveRequerimiento(c)) ?? 'sin-cambio',
      origenProveedor: c.origenProveedor,
      proveedorSugeridoInactivo: c.proveedorSugeridoInactivo,
      cambiosReceta: cambiosDe(c),
      avisos: c.avisos,
    });
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
      desalineada: desalineacion.hayCambios,
      // V1-E3h: queda escrito CONTRA QUÉ se explotó — cuántos renglones se quedaron fuera por no
      // estar firmados. Sin esto, una explosión corta parecería un BOM incompleto.
      pendientesLiberar: pendientesLiberar.length,
      // ⭐ V1-E3u: queda escrito cuántas telas se explotaron SIN decir su color. Es el dato con el
      // que se puede ver si la captura de colores va al día o si la gente la está saltando.
      pendientesColor: pendientesColor.length,
    },
  });

  return {
    orden,
    ficha,
    filas,
    eliminados,
    pendientesLiberar,
    pendientesColor,
    desalineacion,
    regenerado,
  };
}

/**
 * ⭐⭐ **EXPLOSIONA UN CONJUNTO DE ÓRDENES** (R3 + V1-E3q §Post-F9.86) y persiste el snapshot de
 * cada una en UNA transacción (A2). Daniel: *"¿cómo hacemos cuando una OC cubre varias OP? Es muy
 * muy común… normalmente compramos varias OP con una sola OC"*.
 *
 * Lo que hace, en orden:
 *  1. Explosiona **cada OP** como siempre (receta congelada × matriz, neteo de genéricos, precios),
 *     con el stock de genéricos **repartido** entre las OP del lote ({@link existenciaCompartida}).
 *  2. Cruza contra **lo que ya está en una OC viva** (`comprometidoEnOc`, §Post-F9.85) → cada
 *     renglón sale con `cantidadEnOc` y `cantidadPendiente`. **Esto es lo que impide volver a
 *     comprar lo ya comprado.**
 *  3. **Agrupa** por material+proveedor y guarda el **reparto por OP** (§Post-F9.86).
 *
 * Permiso `compras.ver`; toda orden ajena a la empresa activa responde 404 (A9).
 *
 * El stock de avíos genéricos se lee con `existenciaAvioTotalEmpresa` (Σ de movimientos en todos los
 * almacenes, D3) SIN re-verificar `inventario-avios.ver` (el usuario ya está autorizado por
 * `compras.ver`).
 */
export async function explosionarOrdenes(
  sesion: SesionUsuario,
  idsOrden: readonly number[],
  bd?: ContextoBd,
): Promise<ExplosionSalida> {
  verificarPermiso(sesion, 'compras.ver');
  const idEmpresa = sesion.idEmpresaActiva;
  const unicos = [...new Set(idsOrden)];
  if (unicos.length === 0) {
    throw new ErrorValidacion('Elige al menos una orden de producción para explotar.');
  }

  return enTransaccion(async (tx) => {
    // Orden DETERMINISTA del lote (por folio): decide quién se lleva el stock de genéricos, así que
    // no puede depender de en qué orden vinieron los ids en el cuerpo del request.
    const folios = await tx.orden.findMany({
      where: { id: { in: unicos }, idEmpresa },
      select: { id: true, folio: true },
      orderBy: { folio: 'asc' },
    });
    // A9: cualquier id que no sea de la empresa activa (o no exista) es 404 — y se dice CUÁL, sin
    // filtrar nada de la orden ajena más allá de su id (que el usuario ya tenía).
    const encontrados = new Set(folios.map((o) => o.id));
    const ajeno = unicos.find((id) => !encontrados.has(id));
    if (ajeno !== undefined) {
      throw new ErrorNoEncontrado('Orden', ajeno);
    }

    const { existenciaGenerico, consumirGenerico } = existenciaCompartida(tx, idEmpresa);

    const avisos: string[] = [];
    const explosiones: ExplosionDeOrden[] = [];
    for (const o of folios) {
      explosiones.push(
        await explosionarUna(
          tx,
          sesion,
          o.id,
          idEmpresa,
          existenciaGenerico,
          consumirGenerico,
          avisos,
        ),
      );
    }

    // ⭐ EL NETEO CONTRA LO YA COMPRADO (§Post-F9.85) — la única verdad del sistema, compartida con
    // el tablero R7. Se lee DESPUÉS de escribir los snapshots, dentro de la misma transacción.
    const comprometido = await comprometidoEnOc(idEmpresa, unicos, { tx });
    const renglones = proyectarRenglones(explosiones, comprometido);
    const eliminados = explosiones.flatMap((e) => e.eliminados);
    const todos = [...renglones, ...eliminados];

    const primera = explosiones[0] as ExplosionDeOrden;
    const multi = explosiones.length > 1;
    return {
      ordenes: explosiones.map((e) => e.ficha),
      idOrden: primera.orden.id,
      folioOrden: primera.ficha.folio,
      idModelo: primera.ficha.idModelo,
      modelo: primera.ficha.modelo,
      totalPiezas: explosiones.reduce((s, e) => s + e.ficha.totalPiezas, 0),
      grupos: agruparPorProveedor(todos),
      huboCambios: todos.some((r) => r.diff !== 'sin-cambio'),
      regenerado: explosiones.some((e) => e.regenerado),
      avisos,
      // Con varias OP la desalineación se FUNDE: `hayCambios`/`conOrdenCompra`/`critico` son "alguna
      // la tiene" y los cambios se concatenan nombrando su orden — el aviso no puede quedarse mudo
      // porque el comprador metió dos OP en la misma compra.
      desalineacion: {
        hayCambios: explosiones.some((e) => e.desalineacion.hayCambios),
        conOrdenCompra: explosiones.some((e) => e.desalineacion.conOrdenCompra),
        critico: explosiones.some((e) => e.desalineacion.critico),
        cambios: explosiones.flatMap((e) =>
          e.desalineacion.cambios.map((c) =>
            multi ? { ...c, detalle: `Orden ${String(e.ficha.folio)}: ${c.detalle}` } : c,
          ),
        ),
      },
      pendientesLiberar: explosiones.flatMap((e) => e.pendientesLiberar),
      // ⭐ V1-E3u: con varias OP, cada una aporta sus telas sin color. NO se funden por tela: dos OP
      // pueden pedir la misma tela y tener capturados colores distintos, y decir "falta el color de
      // la felpa" sin decir de cuál orden mandaría al comprador a adivinar (la misma lección que
      // §Post-F9.86 dejó en `pendientesLiberar`).
      pendientesColor: explosiones.flatMap((e) =>
        e.pendientesColor.map((p) =>
          multi ? { ...p, tela: `Orden ${String(e.ficha.folio)}: ${p.tela}` } : p,
        ),
      ),
    };
  }, bd);
}

/**
 * Explosiona UNA orden — atajo de {@link explosionarOrdenes} para el impreso (R9) y para todo lo
 * que sigue razonando en singular. Mismo cálculo, mismo neteo: NO hay una segunda implementación.
 */
export async function explosionarOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<ExplosionSalida> {
  return explosionarOrdenes(sesion, [idOrden], bd);
}

// ── ⭐ Las OP del mismo PEDIDO INTERNO (precarga de §Post-F9.86) ────────────────────────────────

/**
 * Las órdenes de producción que cuelgan del MISMO pedido interno que la orden dada. Es la PRECARGA
 * de la pantalla: Daniel, *"muchas veces se compran los avíos de un mismo pedido interno (que
 * incluyen varias OP) (ejemplo 1515)"*.
 *
 * Las **canceladas se listan pero salen marcadas** para que la pantalla NO las precargue: comprar
 * material para una orden cancelada es tirar el dinero, pero esconderla dejaría al comprador
 * preguntándose por qué el pedido "tiene menos OP de las que tiene". Permiso `compras.ver`, A9.
 */
export async function ordenesDelPedidoDeOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<OrdenesDelPedidoSalida> {
  verificarPermiso(sesion, 'compras.ver');
  const idEmpresa = sesion.idEmpresaActiva;
  const cliente = clienteLectura(bd);

  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: {
      id: true,
      folio: true,
      estado: true,
      modelo: { select: { codigo: true } },
      cliente: { select: { nombre: true } },
      pedidoLinea: { select: { idPedido: true, pedido: { select: { folio: true } } } },
    },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  const idPedido = orden.pedidoLinea?.idPedido ?? null;
  if (idPedido === null) {
    // Histórico migrado sin pedido: no hay hermanas que precargar, pero la respuesta no miente —
    // devuelve la propia orden para que la pantalla arranque igual.
    return {
      idPedido: null,
      folioPedido: null,
      ordenes: [
        {
          idOrden: orden.id,
          folio: Number(orden.folio),
          modelo: orden.modelo.codigo,
          cliente: orden.cliente.nombre,
          cancelada: orden.estado === 'cancelada',
        },
      ],
    };
  }

  const hermanas = await cliente.orden.findMany({
    where: { idEmpresa, pedidoLinea: { idPedido } },
    select: {
      id: true,
      folio: true,
      estado: true,
      modelo: { select: { codigo: true } },
      cliente: { select: { nombre: true } },
    },
    orderBy: { folio: 'asc' },
  });

  return {
    idPedido,
    folioPedido:
      orden.pedidoLinea?.pedido === undefined ? null : Number(orden.pedidoLinea.pedido.folio),
    ordenes: hermanas.map((o) => ({
      idOrden: o.id,
      folio: Number(o.folio),
      modelo: o.modelo.codigo,
      cliente: o.cliente.nombre,
      cancelada: o.estado === 'cancelada',
    })),
  };
}

// ── Operación 2: GENERAR OC desde la explosión (R3) ─────────────────────────────────────────────────

/**
 * ⭐ §Post-F9.71 — RESUELVE LA FECHA DE CADA OC (función PURA, sin BD: la regla se prueba sin
 * levantar Postgres). Para cada proveedor al que se le va a comprar, en este orden:
 *  1. su fecha propia si la pantalla la mandó,
 *  2. la `fechaBase` (la que el usuario puso arriba, para todas).
 * Los que se quedan sin ninguna salen en `sinFecha` para que quien llama los nombre en el error.
 *
 * 🔴🔴 **V1-E7f (§Post-F9.120) — NO HAY UN TERCER PELDAÑO: LA FECHA NO SE HEREDA DE NINGÚN LADO.**
 * Hasta aquí existía un respaldo (V1-E3q): sin nada capturado, la OC se llevaba la fecha de entrega
 * **de la orden de producción**. Daniel lo cazó usando el sistema — *"no puse fecha de entrega en
 * una OC de tela, y tomó la fecha de entrega de la OC del cliente"* —, y el defecto es de NEGOCIO:
 * la fecha de la orden es **cuándo se le entrega al CLIENTE**, la de la OC es **cuándo tiene que
 * llegar la TELA**. Igualarlas le pide al proveedor la materia prima el mismo día en que hay que
 * entregar la prenda terminada: imposible por definición. Y lo grave no era que el campo quedara
 * vacío, sino que quedaba **LLENO con un número equivocado que se ve legítimo**: un campo vacío
 * frena y se revisa; uno lleno con la fecha incorrecta nadie lo mira — y es el dato con el que se le
 * reclama al proveedor. Decisión de Daniel, sin matices: *"que marque error y pida poner una fecha
 * de entrega. **No toma nada en automático de ningún lado**"*.
 *
 * ⚠️ Calcularla **hacia atrás** desde la entrega de la OP con el tiempo de entrega de cada proveedor
 * (§Post-F9.71(B)) sigue siendo el camino correcto de fondo, y sigue abierto: exige capturar ese
 * dato, que hoy no existe. Cuando exista será una **PROPUESTA editable**, nunca un valor silencioso
 * — que es justo lo que este respaldo era.
 *
 * Las fechas de proveedores que NO están comprando se IGNORAN a propósito: la pantalla enseña las
 * fechas de todos los grupos y el usuario puede comprar sólo unos renglones — reventar por una fecha
 * que sobra sería castigar una compra parcial perfectamente válida.
 *
 * Dos fechas DISTINTAS para el mismo proveedor sí se rechazan (D3): quedarse con la última sería
 * inventar cuál de las dos quiso la persona.
 */
export function resolverFechasDeOc(
  idsProveedor: number[],
  fechaBase: string | null,
  fechasPorProveedor: DatosGenerarOc['fechasPorProveedor'],
): { fechas: Map<number, string>; sinFecha: number[] } {
  const propias = new Map<number, string>();
  for (const fila of fechasPorProveedor ?? []) {
    const previa = propias.get(fila.idProveedor);
    if (previa !== undefined && previa !== fila.fechaEntrega) {
      throw new ErrorValidacion(
        `Llegaron dos fechas de entrega distintas (${previa} y ${fila.fechaEntrega}) para el ` +
          `mismo proveedor: manda una sola por proveedor.`,
      );
    }
    propias.set(fila.idProveedor, fila.fechaEntrega);
  }

  const fechas = new Map<number, string>();
  const sinFecha: number[] = [];
  for (const idProveedor of idsProveedor) {
    // Dos peldaños y se acabó (§Post-F9.120): lo que no capturó una persona, no lo pone nadie.
    const fecha = propias.get(idProveedor) ?? fechaBase ?? null;
    if (fecha === null) {
      sinFecha.push(idProveedor);
      continue;
    }
    fechas.set(idProveedor, fecha);
  }
  return { fechas, sinFecha };
}

/**
 * ⭐⭐ V1-E3u — clave de agrupación de la COMPRA: material + color. Es la que decide qué renglones
 * caben en una misma línea de la revisión previa (y por tanto en un mismo renglón de OC por OP).
 */
function claveMaterialColor(r: {
  idTela: number | null;
  idAvio: number | null;
  idTelaColor: number | null;
}): string {
  return `${claveMaterial(r)}|${r.idTelaColor === null ? 'sin' : String(r.idTelaColor)}`;
}

/**
 * Clave de un AJUSTE del comprador (el total que teclea). Desde V1-E3u lleva el color: la decisión
 * (a) de Daniel es que *"compras capture cada cantidad"*, y una cantidad por tela —sin color— ya no
 * identifica un renglón. Se escribe en UN solo lugar para que el que la GUARDA y el que la BUSCA no
 * puedan escribirla distinto (la clase de defecto que hace que un ajuste "no se aplique" en
 * silencio).
 */
function claveAjuste(
  tipo: 'tela' | 'avio',
  idMaterial: number,
  idTelaColor: number | null,
  idProveedor: number,
): string {
  const color = idTelaColor === null ? 'sin' : String(idTelaColor);
  return `${tipo}-${String(idMaterial)}|${color}|${String(idProveedor)}`;
}

/** Un renglón de snapshot con lo que hace falta para planear su compra. */
interface RequerimientoParaPlan {
  id: number;
  idOrden: number;
  folioOrden: number;
  idTela: number | null;
  idAvio: number | null;
  /** ⭐⭐ V1-E3u: color de tela del renglón (§Post-F9.89); null en avíos y en telas sin color dicho. */
  idTelaColor: number | null;
  /** Nombre del color, para nombrarlo en la previa y en los mensajes de omisión. */
  telaColor: string | null;
  material: string;
  unidad: string | null;
  esGenerico: boolean;
  cantidadAComprar: number;
  cantidadEnOc: number;
  /**
   * ⭐⭐ V1-E3u (§Post-F9.89) — cuánto de `cantidadEnOc` viene de una OC que **no dice de qué color**
   * era. Atribuírselo a ESTE color fue una **elección** del sistema, no un dato de la orden.
   *
   * 🔴 Aquí pesa más que en la explosión, y por eso viaja hasta la previa: este número es el que
   * RESTA de lo que se va a comprar, y cuando se lo come entero el renglón **desaparece de la
   * compra** con un *"ya está en una orden de compra viva: no hace falta volver a comprarlo"*. Esa
   * frase afirma un HECHO — y si la atribución fue una elección, puede ser falsa. Es exactamente el
   * fallo que §Post-F9.85 vino a cerrar: *no basta con no callarse; hay que no mentir*.
   */
  cantidadEnOcSinColor: number;
  cantidadPendiente: number;
  idProveedorSugerido: number | null;
  precioSugerido: number | null;
}

/** Frase que explica una omisión, en el idioma del comprador (nunca en el del programador). */
function detalleDeOmision(r: RequerimientoParaPlan, motivo: OmitidoPlan['motivo']): string {
  // ⭐ V1-E3u: cuando el renglón trae color, el mensaje lo DICE. Con dos colores de la misma tela
  // en la lista, un "ya está en una OC" sin color manda al comprador a averiguar cuál de los dos.
  const nombre = r.telaColor === null ? r.material : `${r.material} · ${r.telaColor}`;
  switch (motivo) {
    case 'sin-proveedor':
      return `No hay a quién comprarle "${nombre}" (ni Desarrollo ni el catálogo lo amarran, y Compras no le asignó proveedor para la orden ${String(r.folioOrden)}).`;
    case 'ya-en-oc': {
      const base = `"${nombre}" ya está en una orden de compra viva para la orden ${String(r.folioOrden)} (${formatearCantidad(r.cantidadEnOc)}${r.unidad === null ? '' : ` ${r.unidad}`}): no hace falta volver a comprarlo. Si esa OC se cancela, vuelve a aparecer aquí.`;
      // 🔴 V1-E3u (§Post-F9.89) — CUANDO ESE "YA ESTÁ COMPRADO" ES UNA ELECCIÓN, NO UN HECHO.
      // Este renglón **desaparece de la compra** por culpa de este número. Si parte de él viene de
      // una OC que no dice de qué color era, la frase de arriba afirma algo que el sistema no puede
      // sostener — y el material podría quedarse sin comprar. Es el mismo fallo que §Post-F9.85
      // cerró: *no basta con no callarse; hay que no mentir*.
      if (r.cantidadEnOcSinColor <= 0) return base;
      return (
        `${base} ⚠ Ojo: ${formatearCantidad(r.cantidadEnOcSinColor)}` +
        `${r.unidad === null ? '' : ` ${r.unidad}`} de esa cantidad vienen de una orden de compra ` +
        `que NO dice de qué color era, y el sistema se los atribuyó a este color. Si en realidad ` +
        `eran de otro tono, esto se está quedando sin comprar: revísalo antes de generar la OC.`
      );
    }
    case 'menor-al-minimo':
      return `De "${nombre}" falta ${formatearCantidad(r.cantidadAComprar)}${r.unidad === null ? '' : ` ${r.unidad}`} para la orden ${String(r.folioOrden)}, pero una orden de compra no puede pedir menos de 0.01: esa diferencia es más chica de lo que el documento puede guardar. No se compra — el consumo real se ajusta al descargar el material.`;
    case 'cubierto-por-stock':
      return `"${nombre}" es genérico y el inventario lo cubre: no genera compra.`;
    case 'no-seleccionado':
      return `No lo marcaste para esta compra.`;
    case 'sin-cantidad':
      return `"${nombre}" no requiere cantidad en la orden ${String(r.folioOrden)}.`;
  }
}

/** Cantidad legible (hasta 4 decimales) para los mensajes del plan. */
function formatearCantidad(valor: number): string {
  return valor.toLocaleString('es-MX', { maximumFractionDigits: 4 });
}

/**
 * ⭐⭐ **POR QUÉ UN RENGLÓN NO ENTRA EN LA COMPRA — o `null` si sí entra.** Es la escalera de
 * motivos de {@link planearCompra}, PURA y exportada, para que se pueda probar sin base (D3: nada
 * se omite en silencio, y cada omisión dice su razón con letras).
 *
 * 🔴 **V1-E4d, 2ª vuelta — "NO LO MARCASTE" SÓLO SE LE DICE A QUIEN PUDO MARCARLO.** La pantalla
 * deshabilita la casilla de todo lo que no es comprable (`comprable = tiene proveedor && queda
 * pendiente`), así que hay renglones que **no se pueden marcar**. Con la selección hecha, el plan
 * los reportaba igual como *"No lo marcaste para esta compra"*: una frase que **culpa al comprador
 * de algo que el sistema no le dejó hacer** y que le esconde la razón verdadera —que no hay a quién
 * comprarle, o que **ya está comprado**— justo en la pantalla donde firma.
 *
 * ⚠️ **Son DOS mitades y las dos importan**: `sin proveedor` (el atorón de §Post-F9.82) y `sin nada
 * pendiente` (el chip «Ya comprado», que sale a diario). Preguntando primero si era SELECCIONABLE,
 * lo no marcado sigue diciendo "no lo marcaste" y lo demás cae en su motivo real. Es §Post-F9.85
 * otra vez: *no basta con no callarse; hay que no mentir*.
 *
 * 🔴 **No puede cambiar QUÉ se compra, y eso se ve aquí:** `null` exige las dos últimas condiciones
 * de la escalera, que **son exactamente `seleccionable`**, así que un renglón no-seleccionable jamás
 * puede volverse elegible por esta puerta. Lo único que cambia es la ETIQUETA de por qué no entró.
 *
 * ⚠️ **Vive fuera de `planearCompra` a propósito** (3ª vuelta): mientras la escalera era un ternario
 * dentro del bucle, la única manera de fijar su comportamiento era una prueba de INTEGRACIÓN —o sea,
 * sólo en CI—. Es la misma lección que cerró el filtro del arte: *la regla se pone donde una prueba
 * unitaria pueda verla.*
 */
export function motivoDeOmision(
  r: Pick<
    RequerimientoParaPlan,
    'idProveedorSugerido' | 'cantidadPendiente' | 'cantidadAComprar' | 'cantidadEnOc' | 'esGenerico'
  >,
  seleccion: { haySeleccion: boolean; marcado: boolean },
): OmitidoPlan['motivo'] | null {
  const seleccionable = r.idProveedorSugerido !== null && seGuardaComoAlgo(r.cantidadPendiente);
  if (seleccionable && seleccion.haySeleccion && !seleccion.marcado) return 'no-seleccionado';
  if (r.cantidadAComprar <= TOLERANCIA) return r.esGenerico ? 'cubierto-por-stock' : 'sin-cantidad';
  // ⭐ V1-E3q — EL ARREGLO DE FONDO: lo que ya está en una OC viva NO se vuelve a comprar.
  //
  // ⚠️ `cantidadPendiente` YA viene a la escala de la columna (se redondea en el llamador), así que
  // en ESTE punto `!seGuardaComoAlgo(...)` equivale a `=== 0`: el corte fino lo hizo el redondeo, no
  // esta línea, y volverla a `<= TOLERANCIA` no cambiaría nada (mutante equivalente, verificado). Se
  // conserva por decir en qué escala se está razonando. Lo que SÍ decide aquí —y sobre un valor
  // CRUDO— es **cuál de las dos verdades** se le cuenta al comprador, y por eso pregunta por
  // `cantidadEnOc`:
  //
  // 🔴 Sin esa pregunta (segunda vuelta del reviewer, 21-ago) TODO lo que quedaba por debajo de 0.01
  // se reportaba como `ya-en-oc`, aunque no existiera ninguna OC: la previa le decía al comprador
  // *"ya está en una orden de compra viva (0 pza)… si esa OC se cancela, vuelve a aparecer"*
  // —mandándolo a cancelar un documento inexistente—. §Post-F9.85 nació porque Daniel dejó de
  // creerle a la pantalla; una previa que afirma un hecho FALSO es exactamente ese fallo. **No basta
  // con no callarse (D3): hay que no mentir.**
  if (!seGuardaComoAlgo(r.cantidadPendiente)) {
    return seGuardaComoAlgo(r.cantidadEnOc) ? 'ya-en-oc' : 'menor-al-minimo';
  }
  if (r.idProveedorSugerido === null) return 'sin-proveedor';
  return null;
}

/**
 * ⭐⭐ **EL PLAN DE COMPRA — un solo cálculo para la revisión previa Y para la generación**
 * (V1-E3q, §Post-F9.85/.86).
 *
 * Daniel: *"me gustaría que al darle «generar OC desde la explosión», te mande a una pantalla
 * previa, antes de generar la OC. **Una revisión previa es indispensable**"*. Una revisión previa
 * que calculara por su cuenta sería una promesa que el sistema no cumple; por eso esta función es
 * la ÚNICA que decide qué se compra, y las dos operaciones (`previoCompraDesdeExplosion` y
 * `generarOCDesdeExplosion`) la llaman igual. La previa la pinta; la generación la ejecuta.
 *
 * Lo que resuelve, en orden:
 *  1. Las OP del conjunto (A9: cualquier orden ajena → 404) y **la puerta de la receta liberada**.
 *  2. La dirección de entrega (la del formulario o la FAVORITA del catálogo).
 *  3. El requerido de cada OP **neteado contra lo que ya está en OC** (`comprometidoEnOc`,
 *     §Post-F9.85) → lo que de verdad falta comprar.
 *  4. Lo que se QUEDA FUERA, con su razón dicha con letras (nada se omite en silencio, D3).
 *  5. La agrupación por proveedor y material, **con el reparto por OP** (§Post-F9.86), incluidos
 *     los **ajustes** del comprador (el sobrante: comprar el rollo completo).
 *  6. La fecha de cada OC (§Post-F9.71) y los **bloqueos** que impedirían generar.
 *
 * ⚠️ Los bloqueos NO se lanzan aquí: se DEVUELVEN. La revisión previa tiene que poder enseñar "esto
 * es lo que falta" sin reventar, y la generación es la que convierte esa lista en un rechazo. Un
 * solo cálculo, dos maneras de reaccionar a él.
 */
async function planearCompra(
  tx: Tx,
  sesion: SesionUsuario,
  cuerpo: DatosGenerarOc,
): Promise<{ plan: PlanCompra; idDireccionEntrega: number | null }> {
  const idEmpresa = sesion.idEmpresaActiva;
  const unicos = [...new Set(cuerpo.idsOrden)];
  const seleccion = new Set(cuerpo.idsRequerimiento);
  const bloqueos: string[] = [];

  // ── 1) Las OP del conjunto (A9) ──
  const ordenes = await tx.orden.findMany({
    where: { id: { in: unicos }, idEmpresa },
    select: {
      id: true,
      folio: true,
      idModelo: true,
      fechaEntrega: true,
      modelo: { select: { codigo: true } },
      pedidoLinea: { select: { idPedido: true, pedido: { select: { folio: true } } } },
      // ⭐ §Post-F9.105: la matriz venía SIN `idTalla` porque sólo se sumaba para `totalPiezas`.
      // Con la talla —un campo más en la MISMA consulta, ni una query extra— se puede medir cuánto
      // se está pidiendo de más por la contradicción «por medida + cantidades por talla» (R18).
      lineas: { select: { tallas: { select: { idTalla: true, cantidad: true } } } },
    },
    orderBy: { folio: 'asc' },
  });
  const encontradas = new Set(ordenes.map((o) => o.id));
  const ajena = unicos.find((id) => !encontradas.has(id));
  if (ajena !== undefined) {
    throw new ErrorNoEncontrado('Orden', ajena);
  }

  // ⭐ LA PUERTA otra vez (V1-E3d, §Post-F9.43(c)): generar OC es EXACTAMENTE el momento de gastar
  // dinero. Se re-verifica aquí y no solo al explotar, porque el snapshot pudo haberse hecho antes
  // (o la liberación revocarse) y el gate tiene que estar donde sale el dinero.
  //
  // ⭐⭐ **V1-E4d — Y LO QUE FALTA FIRMAR YA NO SE TIRA A LA BASURA.** Esta llamada SIEMPRE devolvió
  // los renglones vivos sin liberar, y aquí se descartaban: el aviso *"Desarrollo todavía no libera
  // N material(es)"* sólo existía en la ENTRADA de la explosión, apilado con los otros ocho. Ahora
  // se guarda para levantarlo **en el paso de avanzar** (§Post-F9.96), que es donde el comprador
  // decide gastar. **No cuesta ni una consulta extra**: el dato ya venía y se estaba ignorando.
  const sinLiberar: PendienteSinLiberar[] = [];
  for (const o of ordenes) {
    const porLiberar = await exigirRecetaLiberada(tx, o.id, idEmpresa);
    // Se pasan TAL CUAL (el arte incluido): quién sobra lo decide `avisosDeMaterialSinLiberar`, que
    // es la parte pura y probable. Aquí sólo se les pega la orden de la que son.
    sinLiberar.push(
      ...porLiberar.map((r) => ({
        tipo: r.tipo,
        idOrden: o.id,
        folioOrden: Number(o.folio),
        idTela: r.idTela,
        idAvio: r.idAvio,
        material: r.material,
        consumoPorPrenda: r.consumoPorPrenda,
        unidad: r.unidad,
      })),
    );
  }

  const fichas: OrdenExplosionada[] = ordenes.map((o) => ({
    idOrden: o.id,
    folio: Number(o.folio),
    idModelo: o.idModelo,
    modelo: o.modelo.codigo,
    totalPiezas: o.lineas.reduce((s, l) => s + l.tallas.reduce((st, t) => st + t.cantidad, 0), 0),
    idPedido: o.pedidoLinea?.idPedido ?? null,
    folioPedido: o.pedidoLinea?.pedido === undefined ? null : Number(o.pedidoLinea.pedido.folio),
    fechaEntrega: o.fechaEntrega === null ? null : o.fechaEntrega.toISOString().slice(0, 10),
  }));
  const folioDe = new Map(fichas.map((f) => [f.idOrden, f.folio]));
  // ⚠️ Aquí vivía `entregaDe` (la fecha de entrega de cada OP, indexada). Murió con el respaldo de
  // la fecha de la OC (§Post-F9.120): ya nadie la consulta para decidir nada. La fecha de la OP
  // sigue viajando en `fichas` —la pantalla la ENSEÑA, que es legítimo—, pero no alimenta ningún
  // cálculo: dejar el mapa "por si acaso" es justo la herencia silenciosa que se acaba de quitar.

  // ── 2) La dirección de entrega (§Post-F9.18) ──
  let idDireccionEntrega: number | null = cuerpo.idDireccionEntrega ?? null;
  if (idDireccionEntrega === null) {
    const favorita = await tx.direccionEntrega.findFirst({
      where: { favorita: true, activo: true },
      select: { id: true },
    });
    idDireccionEntrega = favorita?.id ?? null;
    if (idDireccionEntrega === null) {
      bloqueos.push(
        'No hay una dirección de entrega marcada como favorita en el catálogo: márcala en ' +
          'Compras › Direcciones de entrega, o elige una al generar las compras.',
      );
    }
  }

  // ── 3) El requerido de todas las OP, neteado contra lo YA COMPRADO ──
  const filas = await tx.requerimientoOrden.findMany({
    where: { idOrden: { in: unicos } },
    select: {
      id: true,
      idOrden: true,
      idTela: true,
      idAvio: true,
      idTelaColor: true,
      unidad: true,
      esGenerico: true,
      cantidadAComprar: true,
      idProveedorSugerido: true,
      precioSugerido: true,
      tela: { select: { nombre: true } },
      avio: { select: { clave: true, descripcion: true } },
      telaColor: { select: { nombre: true } },
    },
    // Determinista: el reparto (y qué OP absorbe el residuo del redondeo) no puede depender del
    // orden en que Postgres devuelva las filas.
    orderBy: [{ idOrden: 'asc' }, { id: 'asc' }],
  });
  const comprometido = await comprometidoEnOc(idEmpresa, unicos, { tx });

  // ⭐⭐ §Post-F9.105 — LA CONTRADICCIÓN, TAMBIÉN EN LA PANTALLA QUE CONFIRMA LA COMPRA. La previa
  // lee el SNAPSHOT, que no sabe si el avío se compra por medida; para saberlo hay que ir a la
  // receta. Es UNA consulta para todo el lote, y ya viene filtrada a los renglones que la traen.
  const contradicciones = contradiccionesDeLasOrdenes(
    await tx.ordenAvio.findMany({
      // 🔴 SÓLO los dos hechos que DEFINEN la contradicción: la bandera encendida y un avío con
      // medidas activas. Nada de `excluido`/`paraProduccion`/`liberadoEn`: quién entra de verdad en
      // esta compra lo decide el PLAN (`avisosDeAvioPorMedida`), y filtrar aquí por un estado que
      // pudo cambiar DESPUÉS del snapshot podría callar el aviso de un renglón que sí se compra.
      where: {
        idOrden: { in: unicos },
        consumoPorTalla: true,
        avio: { medidas: { some: { activo: true } } },
      },
      select: {
        idOrden: true,
        idAvio: true,
        consumoPorPrenda: true,
        consumoPorTalla: true,
        tallas: { select: { idTalla: true, consumo: true } },
        avio: { select: { clave: true, descripcion: true, unidad: true } },
      },
      orderBy: [{ idOrden: 'asc' }, { idAvio: 'asc' }],
    }),
    ordenes,
    folioDe,
  );

  // ⭐⭐ V1-E3u — el neteo POR COLOR, con la MISMA función que usa la explosión (una sola verdad).
  // Se calcula por (orden, material) porque la regla del acervo sin color necesita ver juntos a
  // todos los renglones del mismo material.
  const enOcPorFila = new Map<number, number>();
  /** ⭐ V1-E3u: la parte de ese `enOc` que el sistema ELIGIÓ atribuirle (acervo sin color). */
  const ambiguoPorFila = new Map<number, number>();
  {
    const porOrdenMaterial = new Map<string, typeof filas>();
    for (const f of filas) {
      const llave = `${String(f.idOrden)}|${claveMaterial(f)}`;
      const grupo = porOrdenMaterial.get(llave) ?? [];
      grupo.push(f);
      porOrdenMaterial.set(llave, grupo);
    }
    for (const grupo of porOrdenMaterial.values()) {
      const cabeza = grupo[0];
      if (cabeza === undefined) continue;
      const repartido = repartirComprometidoPorColor(
        grupo.map((f) => ({
          idTelaColor: f.idTelaColor,
          cantidadAComprar: Number(f.cantidadAComprar),
        })),
        comprometido.get(cabeza.idOrden)?.get(claveMaterial(cabeza)),
      );
      grupo.forEach((f, i) => {
        enOcPorFila.set(f.id, repartido[i]?.enOc ?? 0);
        ambiguoPorFila.set(f.id, repartido[i]?.desdeAcervoSinColor ?? 0);
      });
    }
  }

  const requerimientos: RequerimientoParaPlan[] = filas.map((f) => {
    const aComprar = Number(f.cantidadAComprar);
    const enOc = enOcPorFila.get(f.id) ?? 0;
    return {
      id: f.id,
      idOrden: f.idOrden,
      folioOrden: folioDe.get(f.idOrden) ?? 0,
      idTela: f.idTela,
      idAvio: f.idAvio,
      idTelaColor: f.idTelaColor,
      telaColor: f.telaColor?.nombre ?? null,
      material:
        f.tela?.nombre ?? (f.avio === null ? '—' : `${f.avio.clave} — ${f.avio.descripcion}`),
      unidad: f.unidad,
      esGenerico: f.esGenerico,
      cantidadAComprar: aComprar,
      cantidadEnOc: enOc,
      cantidadEnOcSinColor: ambiguoPorFila.get(f.id) ?? 0,
      // Misma escala que en la proyección de la explosión (arriba): la previa y la pantalla tienen
      // que decir el MISMO número, y ese número es el que la columna puede guardar.
      cantidadPendiente: redondearCantidadCompra(Math.max(0, aComprar - enOc)),
      idProveedorSugerido: f.idProveedorSugerido,
      precioSugerido: f.precioSugerido === null ? null : Number(f.precioSugerido),
    };
  });

  // ── 4) Qué entra y qué NO, con la razón (D3: nada se omite en silencio) ──
  const elegibles: RequerimientoParaPlan[] = [];
  const omitidos: OmitidoPlan[] = [];
  for (const r of requerimientos) {
    const motivo = motivoDeOmision(r, {
      haySeleccion: seleccion.size > 0,
      marcado: seleccion.has(r.id),
    });
    if (motivo === null) {
      elegibles.push(r);
      continue;
    }
    omitidos.push({
      idRequerimiento: r.id,
      idOrden: r.idOrden,
      folioOrden: r.folioOrden,
      tipo: r.idTela !== null ? 'tela' : 'avio',
      // ⭐ V1-E3u: el color forma parte de la identidad del renglón, así que forma parte de su
      // nombre. Sin él, dos omisiones de la misma tela se ven idénticas en la lista.
      material: r.telaColor === null ? r.material : `${r.material} · ${r.telaColor}`,
      unidad: r.unidad,
      cantidadAComprar: r.cantidadAComprar,
      cantidadEnOc: r.cantidadEnOc,
      cantidadEnOcSinColor: r.cantidadEnOcSinColor,
      motivo,
      detalle: detalleDeOmision(r, motivo),
    });
  }

  // ⭐⭐ V1-E3h — Y AHORA, MATERIAL POR MATERIAL (§Post-F9.72). Con la firma por renglón, "algo
  // liberado" ya no basta: el SNAPSHOT se escribió con lo que estaba firmado en su momento, y entre
  // la explosión y este clic alguien pudo tocar un renglón (lo que lo vuelve a cerrar). Sin esta
  // segunda verificación, la compra parcial abriría justo el agujero que la firma tapa. Se dice CON
  // NOMBRE cuál (D3), orden por orden.
  for (const o of ordenes) {
    await exigirMaterialesLiberados(
      tx,
      o.id,
      idEmpresa,
      elegibles.filter((r) => r.idOrden === o.id),
    );
  }

  // ── 5) Agrupa por PROVEEDOR y por MATERIAL, guardando el reparto por OP (§Post-F9.86) ──
  interface Acumulado {
    tipo: 'tela' | 'avio';
    idMaterial: number;
    idTelaColor: number | null;
    telaColor: string | null;
    material: string;
    unidad: string | null;
    integrantes: RequerimientoParaPlan[];
  }
  /**
   * ⭐ V1-E3u: lo ELEGIDO por el sistema en un renglón de la previa = Σ de lo elegido en las OP que
   * lo componen. Se suma aquí y no en la pantalla (A1), y con la MISMA función que arma el renglón,
   * para que el aviso no pueda decir un número que la lista no dice.
   */
  const elegidoDe = (acum: Acumulado): number =>
    redondearCantidadCompra(acum.integrantes.reduce((suma, r) => suma + r.cantidadEnOcSinColor, 0));
  const porProveedor = new Map<number, Map<string, Acumulado>>();
  for (const r of elegibles) {
    const idProveedor = r.idProveedorSugerido as number;
    const materiales = porProveedor.get(idProveedor) ?? new Map<string, Acumulado>();
    // ⭐⭐ V1-E3u (§Post-F9.89(c)) — *"se compra el color y el almacén lo reparte"*: la agrupación
    // es por MATERIAL + COLOR. Dos OP que piden el mismo color de la misma tela caen en un solo
    // renglón (que es lo que Daniel pidió); dos colores distintos NO se suman.
    const clave = claveMaterialColor(r);
    const acum: Acumulado = materiales.get(clave) ?? {
      tipo: r.idTela !== null ? 'tela' : 'avio',
      idMaterial: (r.idTela ?? r.idAvio) as number,
      idTelaColor: r.idTelaColor,
      telaColor: r.telaColor,
      material: r.material,
      unidad: r.unidad,
      integrantes: [],
    };
    acum.integrantes.push(r);
    materiales.set(clave, acum);
    porProveedor.set(idProveedor, materiales);
  }

  // Lo que el comprador ajustó a mano por material+color+proveedor: el SOBRANTE de compra
  // (§Post-F9.86) y —⭐⭐ V1-E3z— el PRECIO (§Post-F9.94). Los dos son opcionales por separado: se
  // puede corregir sólo uno. La REGLA de cómo se aplican vive en `ajuste-comprador.ts` (pura), no
  // aquí, para que la previa y la generación no puedan divergir nunca.
  const ajustes = new Map<string, AjusteDelComprador>();
  for (const a of cuerpo.ajustes ?? []) {
    const clave = claveAjuste(a.tipo, a.idMaterial, a.idTelaColor ?? null, a.idProveedor);
    const previo = ajustes.get(clave) ?? {};
    ajustes.set(clave, {
      // Dos entradas para el MISMO renglón se FUNDEN quedándose con la última que trae cada campo:
      // así un cuerpo que manda la cantidad en una entrada y el precio en otra no pierde ninguna de
      // las dos (y el `?? previo.x` deja intacto lo que la nueva entrada no menciona).
      cantidadTotal: a.cantidadTotal ?? previo.cantidadTotal,
      precioUnitario: a.precioUnitario ?? previo.precioUnitario,
    });
  }

  const nombresProveedor = new Map(
    (
      await tx.proveedor.findMany({
        where: { id: { in: [...porProveedor.keys()] } },
        select: { id: true, nombre: true },
      })
    ).map((p) => [p.id, p.nombre]),
  );

  // ── 6) La fecha de cada OC (§Post-F9.71) — SIN RESPALDO NINGUNO (§Post-F9.120) ──
  // 🔴 Aquí se armaba un `respaldoPorProveedor` con la entrega más próxima de las OP que surte cada
  // OC, y se pasaba como último recurso. Se RETIRÓ entero: la fecha de la OP es la del CLIENTE, no
  // la del proveedor (el porqué completo, en el docstring de `resolverFechasDeOc`). Sin fecha
  // capturada, la compra NO se genera y se dice.
  const { fechas, sinFecha } = resolverFechasDeOc(
    [...porProveedor.keys()],
    cuerpo.fechaEntrega ?? null,
    cuerpo.fechasPorProveedor,
  );
  if (sinFecha.length > 0) {
    const lista = sinFecha
      .map((id) => nombresProveedor.get(id) ?? `#${String(id)}`)
      .sort((a, b) => a.localeCompare(b, 'es'))
      .join(', ');
    // 🔴 V1-E7f (§Post-F9.120) — EL TEXTO DICE DÓNDE **SÍ** SE CAPTURA. El de antes mandaba a
    // capturarla *"en la orden"*, que con el respaldo retirado es un consejo FALSO: hacerlo ya no
    // sirve de nada, y un mensaje que manda al usuario a hacer algo que no funciona es peor que no
    // decir nada. Se captura en esta misma pantalla, y **por proveedor** (§Post-F9.71(A): la tela y
    // los avíos no llegan el mismo día, por eso cada OC lleva la suya). Los culpables se nombran —
    // como siempre— para no obligar a adivinar a quién le falta.
    bloqueos.push(
      `Falta la fecha de entrega de la compra, y toda orden de compra la necesita: es CUÁNDO tiene ` +
        `que llegar el material. No se hereda de la orden de producción —ésa dice cuándo se le ` +
        `entrega al cliente, no cuándo debe llegar la tela—, así que hay que capturarla aquí, al ` +
        `generar las compras: la de arriba vale para todas, o dale la suya a cada proveedor en su ` +
        `grupo de materiales. Sin fecha se quedarían: ${lista}.`,
    );
  }

  const proveedores: PlanProveedor[] = [];
  for (const [idProveedor, materiales] of porProveedor) {
    const renglones: PlanRenglon[] = [];
    for (const acum of materiales.values()) {
      const propuesta = redondearCantidadCompra(
        acum.integrantes.reduce((s, r) => s + r.cantidadPendiente, 0),
      );
      const ajuste = ajustes.get(
        claveAjuste(acum.tipo, acum.idMaterial, acum.idTelaColor, idProveedor),
      );
      // ⭐⭐ V1-E3z (§Post-F9.94) — LA REGLA DEL AJUSTE, en un solo lugar y PURA: qué cantidad y qué
      // precio quedan, y qué bloquea. Los bloqueos se DEVUELVEN (no se lanzan): la previa los pinta
      // y la generación los convierte en rechazo.
      const ajustado = aplicarAjusteDelComprador(
        acum.material,
        propuesta,
        precioComunDelRenglon(
          acum.integrantes.map((r) => redondearPrecioCompra(r.precioSugerido ?? 0)),
        ),
        ajuste,
      );
      const total = ajustado.cantidadTotal;
      bloqueos.push(...ajustado.bloqueos);
      // Un renglón cuyo total no llega al mínimo guardable no genera línea, así que enseñarlo
      // prometería una línea que la generación no va a escribir… **salvo cuando el culpable es el
      // ajuste del comprador**: ahí la generación ya está bloqueada (nada se escribe), y el número
      // que él tecleó tiene que quedarse EN PANTALLA para poder corregirlo ahí mismo. Desaparecer el
      // renglón lo dejaría con un bloqueo que nombra un material que ya no ve.
      if (!seGuardaComoAlgo(total) && ajustado.bloqueos.length === 0) continue;
      // ⭐ SE VE JUNTO, SE GUARDA REPARTIDO: el total (ajustado o no) se reparte entre las OP en
      // proporción a lo que cada una necesita, y la última absorbe el residuo del redondeo.
      const cantidades = repartirEntreOrdenes(
        acum.integrantes.map((r) => r.cantidadPendiente),
        total,
      );
      // La PROPUESTA repartida por OP: es contra lo que se mide el desvío de CADA línea. Se reparte
      // con la MISMA función que el total (`repartirEntreOrdenes`), no con una regla paralela: si
      // las dos repartieran distinto, el desvío que ve quien autoriza sería el de una línea que
      // nunca existió.
      const propuestas = repartirEntreOrdenes(
        acum.integrantes.map((r) => r.cantidadPendiente),
        propuesta,
      );
      const porOrden: PlanLineaOrden[] = acum.integrantes.map((r, i) => {
        const cantidad = cantidades[i] ?? 0;
        // ⭐ El PRECIO también se lleva a la escala de su columna (`OrdenCompraLinea.precio`
        // `Decimal(12,2)`): con un precio de cola larga —hoy, el que TECLEA el comprador
        // (§Post-F9.94) o el promedio de medidas del avío (R5/B11)— la previa prometía 5,999.99
        // donde la OC guardaba 5,999.40. (Antes la cola la producía el factor de conversión, que
        // V1-E8a retiró; el redondeo sigue haciendo falta, sólo cambió de dónde viene la cola.)
        // ⭐⭐ V1-E3z: si el comprador FIJÓ el precio del renglón, ése gana para TODAS sus líneas
        // (§Post-F9.94). Si no lo tocó, cada línea conserva el que resolvió el servidor — que puede
        // diferir entre OP (V1-E3m: Compras pudo teclear uno al asignar el proveedor en una sola).
        const precio = ajustado.precioAjustado
          ? (ajustado.precioUnitario ?? 0)
          : redondearPrecioCompra(r.precioSugerido ?? 0);
        return {
          idRequerimiento: r.id,
          idOrden: r.idOrden,
          folioOrden: r.folioOrden,
          cantidad,
          cantidadPropuesta: propuestas[i] ?? 0,
          precio,
          // Y el importe se calcula con la MISMA regla que `aCompraSalida` usa para el subtotal de
          // la línea (`redondear2(cantidad × precio)`), llamando a la misma función: si las dos
          // sumaran distinto, el total prometido y el guardado volverían a separarse.
          importe: redondear2(cantidad * precio),
          // ⭐ V1-E3z — ¿esta línea SÍ se escribe? Es EXACTAMENTE el predicado con el que la
          // generación filtra (`seGuardaComoAlgo`), llamado desde aquí para que la previa no pueda
          // prometer una línea que luego se salta. Se volvió visible al hacer editable la cantidad
          // en la previa: bajar un total puede dejar a una OP en cero.
          seEscribe: seGuardaComoAlgo(cantidad),
        };
      });
      renglones.push({
        tipo: acum.tipo,
        idMaterial: acum.idMaterial,
        idTelaColor: acum.idTelaColor,
        telaColor: acum.telaColor,
        // ⭐⭐ V1-E3u — hasta la ÚLTIMA pantalla antes de comprometer el dinero (§Post-F9.89).
        cantidadEnOcSinColor: elegidoDe(acum),
        material: acum.material,
        unidad: acum.unidad,
        cantidadTotal: total,
        cantidadPropuesta: propuesta,
        ajustado: ajustado.cantidadAjustada,
        // ⭐⭐ V1-E3z (§Post-F9.94) — el precio del renglón viaja para poder EDITARLO en la previa.
        precioUnitario: ajustado.precioUnitario,
        precioPropuesto: ajustado.precioPropuesto,
        precioAjustado: ajustado.precioAjustado,
        // 🔴 V1-E3z: el importe del renglón suma SÓLO las líneas que se van a escribir. Una línea
        // que no sobrevive al guardarse no se escribe, así que su importe no es dinero que se vaya a
        // comprometer — sumarlo hacía que la previa prometiera un total mayor que el de la OC.
        importe: porOrden.filter((l) => l.seEscribe).reduce((s, l) => s + l.importe, 0),
        porOrden,
      });
    }
    proveedores.push({
      idProveedor,
      proveedor: nombresProveedor.get(idProveedor) ?? `#${String(idProveedor)}`,
      fechaEntrega: fechas.get(idProveedor) ?? null,
      renglones,
      total: renglones.reduce((s, r) => s + r.importe, 0),
      ordenes: [...new Set(renglones.flatMap((r) => r.porOrden.map((l) => l.folioOrden)))].sort(
        (a, b) => a - b,
      ),
    });
  }
  proveedores.sort((a, b) => a.proveedor.localeCompare(b.proveedor, 'es'));
  omitidos.sort(
    (a, b) => a.folioOrden - b.folioOrden || a.material.localeCompare(b.material, 'es'),
  );

  return {
    plan: {
      ordenes: fichas,
      proveedores,
      omitidos,
      bloqueos,
      // ⭐⭐ V1-E4c/V1-E4d — los avisos, AQUÍ y no en la entrada de la explosión (ver abajo). El
      // orden importa poco, pero se pone primero lo que se va a COMPRAR mal (color) y después lo
      // que NO se va a comprar (sin liberar): de más caro a menos.
      avisos: [
        // ⭐⭐ §Post-F9.105 va PRIMERO: los otros dos hablan de un dato que FALTA; éste habla de
        // dinero que se va a gastar de más AHORA, en la OC que se está a punto de firmar.
        ...avisosDeAvioPorMedida(contradicciones, proveedores),
        ...avisosDeTelaSinColor(proveedores),
        ...avisosDeMaterialSinLiberar(sinLiberar, proveedores),
      ],
      totalGeneral: proveedores.reduce((s, p) => s + p.total, 0),
    },
    idDireccionEntrega,
  };
}

/**
 * ⭐⭐ §Post-F9.105 — Una contradicción «avío POR MEDIDA con cantidades POR TALLA» detectada en una
 * de las OP del plan, **ya medida y redactada**. El texto viene del sitio único
 * (`catalogos/unidades-avio.ts`): la previa no re-escribe el aviso, sólo decide si lo enseña.
 */
export interface ContradiccionPorMedida {
  idOrden: number;
  folioOrden: number;
  idAvio: number;
  material: string;
  /** El aviso completo, con la magnitud del descuadre. */
  aviso: string;
}

/** Lo mínimo de un renglón de receta de avío para poder medir la contradicción. */
interface RenglonContradictorio {
  idOrden: number;
  idAvio: number;
  consumoPorPrenda: Prisma.Decimal;
  consumoPorTalla: boolean;
  tallas: { idTalla: number; consumo: Prisma.Decimal }[];
  avio: { clave: string; descripcion: string; unidad: string | null };
}

/** La matriz color×talla de una OP, tal como la trae la consulta del plan. */
interface OrdenConMatriz {
  id: number;
  lineas: { tallas: { idTalla: number; cantidad: number }[] }[];
}

/**
 * ⭐⭐ §Post-F9.105 — MIDE las contradicciones de un lote de OP contra las piezas de cada orden.
 *
 * Es PURA (recibe las filas ya leídas) por la misma razón que sus vecinas: la regla que decide qué
 * se le dice al comprador tiene que poder probarse sin base de datos. La cuenta la hace la función
 * del dominio (`requeridoContradictorioPorMedida`), no una copia: si el aviso de la previa midiera
 * distinto que el del renglón, el comprador vería dos cifras del mismo descuadre.
 */
export function contradiccionesDeLasOrdenes(
  renglones: readonly RenglonContradictorio[],
  ordenes: readonly OrdenConMatriz[],
  folioDe: ReadonlyMap<number, number>,
): ContradiccionPorMedida[] {
  const piezasDe = new Map<number, { total: number; porTalla: Map<number, number> }>();
  for (const o of ordenes) {
    const porTalla = new Map<number, number>();
    let total = 0;
    for (const l of o.lineas) {
      for (const t of l.tallas) {
        porTalla.set(t.idTalla, (porTalla.get(t.idTalla) ?? 0) + t.cantidad);
        total += t.cantidad;
      }
    }
    piezasDe.set(o.id, { total, porTalla });
  }

  const salida: ContradiccionPorMedida[] = [];
  for (const r of renglones) {
    const piezas = piezasDe.get(r.idOrden) ?? { total: 0, porTalla: new Map<number, number>() };
    const medido = requeridoContradictorioPorMedida(
      r,
      piezas.total,
      piezas.porTalla,
      r.avio.unidad,
    );
    // 🔴 Mismo criterio que la explosión: sin descuadre el número es correcto y el aviso sobra.
    if (medido === null || !hayDescuadreDeRequerido(medido)) continue;
    salida.push({
      idOrden: r.idOrden,
      folioOrden: folioDe.get(r.idOrden) ?? 0,
      idAvio: r.idAvio,
      material: `${r.avio.clave} — ${r.avio.descripcion}`,
      aviso: avisoAvioPorMedidaConCantidadesPorTalla(
        'Se arregla en la receta de la orden: abre ese renglón de avío, guárdalo (con eso se ' +
          'normaliza) y vuelve a explotar.',
        medido,
      ),
    });
  }
  return salida;
}

/**
 * ⭐⭐ **§Post-F9.105 — EL AVISO EN LA REVISIÓN PREVIA: el último sitio antes de que salga el
 * dinero.**
 *
 * Daniel pidió la previa porque *"una revisión previa es indispensable"*. Que ahí apareciera un
 * renglón **53 veces inflado sin una palabra** era el mismo defecto que esta etapa vino a cerrar,
 * en el momento en que más caro cuesta: el renglón de la explosión sí lo avisa, pero quien llega y
 * pulsa «Revisar y generar OC» de corrido nunca pasa por esa línea.
 *
 * **Sólo avisa por lo que DE VERDAD se va a escribir** (`seEscribe`), exactamente igual que
 * {@link avisosDeTelaSinColor}: una contradicción en un avío que esta OC no compra —porque ya está
 * en otra OC, o porque no llega al mínimo guardable— no es dinero que se vaya a gastar hoy, y
 * nombrarla aquí sería ruido en la pantalla donde menos sobra.
 *
 * NO bloquea (§Post-F9.64). El comprador puede seguir: quizá esa cantidad sí es la buena. Lo que ya
 * no puede es firmarla creyendo que el número está bien.
 */
export function avisosDeAvioPorMedida(
  contradicciones: readonly ContradiccionPorMedida[],
  proveedores: readonly PlanProveedor[],
): string[] {
  const seEscriben = new Set<string>();
  for (const p of proveedores) {
    for (const r of p.renglones) {
      if (r.tipo !== 'avio') continue;
      for (const l of r.porOrden) {
        if (l.seEscribe) seEscriben.add(`${String(l.idOrden)}|${String(r.idMaterial)}`);
      }
    }
  }
  const avisos: string[] = [];
  for (const c of contradicciones) {
    if (!seEscriben.has(`${String(c.idOrden)}|${String(c.idAvio)}`)) continue;
    avisos.push(`"${c.material}" (orden ${String(c.folioOrden)}): ${c.aviso}`);
  }
  return avisos;
}

/**
 * ⭐⭐ **V1-E4c — QUÉ TELAS SE VAN A COMPRAR SIN DECIR SU COLOR, dicho EN EL PASO DE AVANZAR.**
 *
 * Daniel, 23-ago-2026: *"el proceso normal es llenar ahí la información. Los mensajes amarillos
 * parecieran que estamos haciendo algo mal. **Primero que dé la opción de meterlo, y si no se hace,
 * entonces que mande los mensajes en amarillo**"*. Por eso este aviso ya no vive en la entrada de la
 * explosión —donde recibía con nueve avisos apilados y el único lugar para arreglarlo estaba dentro
 * del regaño— sino en la **revisión previa**, que es cuando se va a comprometer el dinero. El lugar
 * para CAPTURAR está ahora en el renglón de la tela.
 *
 * Se calcula sobre el PLAN ya armado, no sobre la explosión, y ahí está el matiz que importa: sólo
 * avisa por lo que **de verdad se va a escribir** (`seEscribe`). Un renglón sin color que no genera
 * línea —porque su cantidad no llega al mínimo guardable, o porque ya está todo comprado— no es un
 * dato que falte: es un renglón que no se compra.
 *
 * NO bloquea: una tela sin color se ha comprado así toda la vida (y así siguen las 7,978 OC
 * migradas). Avisa, que es lo que Daniel pidió.
 */
export function avisosDeTelaSinColor(proveedores: readonly PlanProveedor[]): string[] {
  const avisos: string[] = [];
  for (const p of proveedores) {
    for (const r of p.renglones) {
      if (r.tipo !== 'tela' || r.idTelaColor !== null) continue;
      const lineas = r.porOrden.filter((l) => l.seEscribe);
      if (lineas.length === 0) continue;
      const folios = [...new Set(lineas.map((l) => l.folioOrden))].sort((a, b) => a - b);
      avisos.push(
        `"${r.material}" se va a pedir a ${p.proveedor} SIN decir de qué color ` +
          `(${formatearCantidad(lineas.reduce((s, l) => s + l.cantidad, 0))}` +
          `${r.unidad === null ? '' : ` ${r.unidad}`}, ` +
          `${folios.length === 1 ? 'orden' : 'órdenes'} ${folios.map((f) => String(f)).join(', ')}). ` +
          `La OC no le va a decir al proveedor qué tono mandar, ni le va a servir a quien reciba ` +
          `para cruzar lo que llegue. Se dice en el renglón de la tela, en la explosión.`,
      );
    }
  }
  return avisos;
}

/**
 * Un renglón de receta que Desarrollo todavía NO firma, tal como lo devuelve la puerta
 * (`exigirRecetaLiberada`) más la orden de la que es. Incluye el **arte** a propósito: el filtro
 * vive dentro de {@link avisosDeMaterialSinLiberar}, que es donde se puede probar.
 */
export interface PendienteSinLiberar {
  tipo: 'tela' | 'avio' | 'arte';
  idOrden: number;
  folioOrden: number;
  idTela: number | null;
  idAvio: number | null;
  material: string;
  consumoPorPrenda: number;
  unidad: string | null;
}

/**
 * ⭐⭐ **V1-E4d (§Post-F9.96) — QUÉ SE VA A COMPRAR *SIN* LO QUE DESARROLLO NO HA FIRMADO, dicho EN
 * EL PASO DE AVANZAR.**
 *
 * Es el hermano del aviso del color, y nace de la misma regla de Daniel: *"primero que dé la opción
 * de meterlo, y si no se hace, entonces que mande los mensajes en amarillo"*. Lo que falta liberar
 * ya **se ve en la explosión** —al final, con nombre, cantidad y el botón que lleva a liberarlo—;
 * esto es la **consecuencia** de no haberlo hecho, y sale cuando se va a comprometer el dinero: la
 * OC que estás a punto de firmar **no va a llevar ese material**.
 *
 * ⚠️ **EL DESCUENTO POR `seEscribe` ES UNA DEFENSA, NO UN CASO DE HOY — y se dice para que nadie
 * lo lea como lo que no es** (hallazgo del reviewer, 2ª vuelta de V1-E4d). Un renglón sin firmar
 * que **sí** tuviera requerimiento elegible **no puede llegar hasta aquí**: `exigirMaterialesLiberados`
 * rechaza la compra entera con un 409 unas líneas antes ({@link planearCompra}). O sea que hoy este
 * `continue` **nunca corre en producción**. Se conserva —cuesta una línea— porque el día que esa
 * puerta se mueva (una compra parcial que se permita, un rescate de snapshot) el aviso **no
 * mentiría**: decir *"no entra"* de algo que sí entra es exactamente la mentira que §Post-F9.85
 * vino a cerrar. Lo que la primera vuelta afirmaba —que ése era *el* escenario real— era falso.
 *
 * El ARTE se filtra AQUÍ DENTRO y no en el llamador (2ª vuelta): el arte no se compra por MRP, así
 * que nombrarlo sería ruido en una pantalla de materiales — pero mientras el filtro vivía fuera, la
 * regla no la sostenía ninguna prueba unitaria (esta función es pura y exportada; el sitio de
 * llamada, no).
 *
 * NO bloquea (§Post-F9.64: avisar no es bloquear): comprar lo liberado y dejar el resto para otra
 * OC es una manera legítima de trabajar, y es justo lo que V1-E3h abrió al partir la puerta.
 */
export function avisosDeMaterialSinLiberar(
  pendientes: readonly PendienteSinLiberar[],
  proveedores: readonly PlanProveedor[],
): string[] {
  const seEscriben = new Set<string>();
  for (const p of proveedores) {
    for (const r of p.renglones) {
      for (const l of r.porOrden) {
        if (l.seEscribe) seEscriben.add(`${String(l.idOrden)}|${r.tipo}-${String(r.idMaterial)}`);
      }
    }
  }
  const avisos: string[] = [];
  for (const p of pendientes) {
    if (p.tipo === 'arte') continue;
    const idMaterial = p.tipo === 'tela' ? p.idTela : p.idAvio;
    if (
      idMaterial !== null &&
      seEscriben.has(`${String(p.idOrden)}|${p.tipo}-${String(idMaterial)}`)
    ) {
      continue;
    }
    avisos.push(
      `"${p.material}" NO entra en esta compra: Desarrollo todavía no lo libera en la orden ` +
        `${String(p.folioOrden)} (${formatearCantidad(p.consumoPorPrenda)}` +
        `${p.unidad === null ? '' : ` ${p.unidad}`} por prenda). Si esta OC debía llevarlo, ` +
        `libéralo en la receta de la orden y vuelve a explotar antes de generar.`,
    );
  }
  return avisos;
}

/**
 * ⭐⭐ **LA REVISIÓN PREVIA** (§Post-F9.85) — *"una revisión previa es indispensable"* (Daniel).
 * Devuelve, sin escribir NADA, las OC que saldrían: proveedor, renglones, cantidades, **de qué OP
 * es cada cantidad** y lo que se va a omitir con su razón.
 *
 * Permiso `compras.administrar` — el MISMO que genera. La previa no es "ver la explosión" (eso ya
 * lo da `compras.ver`): es la primera mitad de la acción de comprar, y quien no puede comprar no
 * tiene por qué ver el documento que se emitiría (§Post-F9.68, esconder Y bloquear).
 */
export async function previoCompraDesdeExplosion(
  sesion: SesionUsuario,
  cuerpo: DatosGenerarOc,
  bd?: ContextoBd,
): Promise<PlanCompra> {
  verificarPermiso(sesion, 'compras.administrar');
  return enTransaccion(async (tx) => (await planearCompra(tx, sesion, cuerpo)).plan, bd);
}

/**
 * Genera una o varias OC desde el snapshot de explosión (R3), **para el conjunto de OP que el
 * comprador armó** (§Post-F9.86): agrupa lo PENDIENTE (ya neteado contra lo que está en OC,
 * §Post-F9.85) por proveedor y crea UNA OC por proveedor en UNA transacción (A2), REUSANDO `crearOC`
 * (folio atómico A3, auditoría A7, ligas N:N). **Cada línea conserva su `idOrden`**: la OC se ve
 * junta y se guarda repartida, que es lo que mantiene cuadrado el "qué falta" de cada OP y hace que
 * el costo caiga donde debe. La OC nace en `borrador`. Permiso `compras.administrar`.
 *
 * El plan lo calcula {@link planearCompra} — el MISMO código que la revisión previa. Aquí no se
 * vuelve a decidir nada: se ejecuta el plan, y si trae **bloqueos** se rechaza con esas mismas
 * frases (la pantalla nunca es la autoridad, A1).
 */
export async function generarOCDesdeExplosion(
  sesion: SesionUsuario,
  cuerpo: DatosGenerarOc,
  bd?: ContextoBd,
): Promise<GenerarOcResultado> {
  verificarPermiso(sesion, 'compras.administrar');

  return enTransaccion(async (tx) => {
    const { plan, idDireccionEntrega } = await planearCompra(tx, sesion, cuerpo);
    if (plan.bloqueos.length > 0) {
      throw new ErrorValidacion(plan.bloqueos.join(' '));
    }
    // Sin bloqueos, la dirección SIEMPRE quedó resuelta (que falte es uno de los bloqueos). Esta
    // guarda existe para que el tipo lo diga y para que, si algún día se rompiera esa invariante,
    // truene aquí y no escriba una OC sin dirección.
    if (idDireccionEntrega === null) {
      throw new ErrorValidacion(
        'Falta la dirección de entrega de las órdenes de compra que se iban a generar.',
      );
    }

    const ordenesCompra: OcGeneradaSalida[] = [];
    for (const p of plan.proveedores) {
      // ⭐ UNA LÍNEA POR (MATERIAL, OP) — el reparto que sí se guarda (§Post-F9.86).
      const lineas = p.renglones.flatMap((r) =>
        r.porOrden
          // Un reparto puede dejar a una OP en cero (ajuste a la baja): una línea de cantidad cero
          // no es una compra, y `crearOC` la rechazaría. Se omite, no se inventa.
          // 🔴 El corte es el MÍNIMO GUARDABLE (0.01), no 1e-6: con `TOLERANCIA` este filtro juzgaba
          // el valor ANTES de que la columna lo recortara, así que dejaba pasar líneas que acababan
          // en `0.00` — y cada una quemaba un folio de OC (hallazgo del reviewer, 21-ago).
          // ⭐ V1-E3z: el corte se lee del PLAN (`seEscribe`), que lo calculó con ese mismo
          // predicado. Re-evaluarlo aquí era otra copia de la regla que podía separarse de la que la
          // previa enseña; ahora la previa dice exactamente qué líneas van a existir.
          .filter((l) => l.seEscribe)
          .map((l) => ({
            idTela: r.tipo === 'tela' ? r.idMaterial : null,
            idAvio: r.tipo === 'avio' ? r.idMaterial : null,
            // ⭐⭐ V1-E3u (§Post-F9.89) — EL COLOR VIAJA A LA LÍNEA DE OC. Éste es el eslabón que
            // faltaba: desde aquí la OC ya PIDE por color, que es lo que la recepción lleva años
            // exigiendo. `null` = renglón sin color dicho (se compra como antes de la etapa).
            idTelaColor: r.idTelaColor,
            cantidad: l.cantidad,
            // ⭐ V1-E3u (§Post-F9.89(a)) — LO QUE EL SISTEMA PROPUSO, guardado junto a lo que se
            // pidió. No es decoración: es lo que le deja a la bandeja de autorización decir *"aquí
            // se está pidiendo 30 % más de lo calculado"* sin volver a explotar nada.
            cantidadSugerida: l.cantidadPropuesta,
            unidad: r.unidad,
            precio: l.precio,
            idOrden: l.idOrden,
          })),
      );
      if (lineas.length === 0) continue;
      const entrada: EntradaCrearOC = {
        idProveedor: p.idProveedor,
        // A estas alturas TODA OC del plan tiene fecha y dirección (si no, se rechazó arriba con sus
        // nombres). El `?? ''` es inalcanzable, y si algún día dejara de serlo `crearOC` lo rechaza
        // en su `validarEntrada` — nunca se escribe una OC con fecha inventada.
        fechaEntrega: p.fechaEntrega ?? '',
        idDireccionEntrega,
        lineas,
      };
      // REUSA crearOC (se une a esta tx): folio atómico, auditoría, ligas N:N — sin duplicar nada.
      // `automatica`: la explosión NO sabe cuánto COMPLEMENTO (Cardigan) lleva una tela que lo
      // tiene —el BOM guarda un solo consumo por tela—, así que estas OC nacen con el complemento
      // PENDIENTE en vez de con una cantidad inventada. `autorizarOC` no las deja pasar hasta que
      // alguien lo capture (§Post-F9.18).
      const oc = await crearOC(sesion, entrada, { tx }, { automatica: true });
      ordenesCompra.push({
        idOrdenCompra: oc.id,
        numCompra: oc.numCompra,
        idProveedor: oc.idProveedor,
        proveedor: oc.proveedor,
        renglones: oc.lineas.length,
        total: oc.total,
      });
    }

    // ⭐ V1-E3q: lo omitido VIAJA con el resultado. Antes los renglones sin proveedor se descartaban
    // en silencio y el usuario sólo veía "se generaron 2 OC" sin saber qué se quedó fuera.
    return { ordenesCompra, omitidos: plan.omitidos };
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
  /**
   * Tipo de la fila: elige su banda de tolerancia, la MISMA que cierra la orden de compra
   * (§Post-F9.19). Sin banda, el tablero diría "recibido parcial" para siempre —contradiciendo a la
   * OC, que ya se dio por recibida— porque *"nunca se recibe la cantidad exacta"*, ni en tela ni en
   * avíos.
   */
  tipo: TipoRenglonCompra = 'avio',
): EstatusMaterial {
  if (esGenericoCubierto) return 'cubierto-por-stock';
  const minimo = minimoParaSurtir(aComprar, tipo);
  if (recibido + TOLERANCIA >= minimo && aComprar > TOLERANCIA) return 'completo';
  if (recibido > TOLERANCIA) return 'recibido-parcial';
  if (enOc > TOLERANCIA) return 'en-oc';
  return 'pendiente';
}

/**
 * Tablero "qué tengo / qué falta" de una orden (R7) — consulta ON-DEMAND (la captura nunca espera un
 * recálculo). Cruza, por material requerido (snapshot), el **En-OC / Recibido** que calcula
 * `comprometidoEnOc` — ⭐ V1-E3q: la MISMA función que netea la explosión y el plan de compra, para
 * que el tablero y la pantalla de comprar nunca digan números distintos sobre lo mismo.
 *
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

  // ⭐ V1-E3q: LA verdad de "cuánto ya está en OC", compartida (`comprometido-en-oc.ts`).
  const porMaterial: Map<string, ComprometidoMaterial> =
    (await comprometidoEnOc(idEmpresa, [idOrden], bd)).get(idOrden) ??
    new Map<string, ComprometidoMaterial>();

  const filas: EstatusMaterialFila[] = [];
  const clavesRequeridas = new Set<string>();

  // ⭐⭐ V1-E3u (§Post-F9.89) — EL TABLERO SIGUE SIENDO POR MATERIAL, y es a propósito. Desde esta
  // etapa el snapshot tiene una fila por tela×COLOR, pero la pregunta de *"qué tengo / qué falta"*
  // es *"¿tengo la tela para producir?"*, no *"¿tengo cada tono?"*: es la decisión (c) de Daniel
  // —*"se compra el color y el almacén lo reparte"*— vista desde el almacén.
  //
  // 🔴 Y hay una razón dura además de la conceptual: `porMaterial` (lo comprometido en OC) está
  // indexado POR MATERIAL. Si aquí se pintara una fila por color, CADA una leería el `enOc` del
  // material COMPLETO y el tablero diría que hay tres veces más comprado del que hay. Se suma
  // primero y se cruza después.
  const requeridosPorMaterial = new Map<
    string,
    {
      idTela: number | null;
      idAvio: number | null;
      unidad: string | null;
      nombre: string;
      requerido: number;
      aComprar: number;
      esGenerico: boolean;
    }
  >();
  for (const r of requerimientos) {
    const clave = claveMaterial(r);
    const nombre =
      r.tela?.nombre ?? (r.avio === null ? '—' : `${r.avio.clave} — ${r.avio.descripcion}`);
    const acum = requeridosPorMaterial.get(clave) ?? {
      idTela: r.idTela,
      idAvio: r.idAvio,
      unidad: r.unidad,
      nombre,
      requerido: 0,
      aComprar: 0,
      esGenerico: r.esGenerico,
    };
    acum.requerido += Number(r.cantidadRequerida);
    acum.aComprar += Number(r.cantidadAComprar);
    requeridosPorMaterial.set(clave, acum);
  }

  // 1) Una fila por material REQUERIDO (snapshot): cruza con lo de OC/recibido.
  for (const [clave, r] of requeridosPorMaterial) {
    clavesRequeridas.add(clave);
    const acum = porMaterial.get(clave);
    const aComprar = r.aComprar;
    const enOc = acum?.enOc ?? 0;
    const recibido = acum?.recibido ?? 0;
    const esGenericoCubierto = r.esGenerico && aComprar <= TOLERANCIA;
    filas.push({
      tipo: r.idTela !== null ? 'tela' : 'avio',
      idTela: r.idTela,
      idAvio: r.idAvio,
      material: r.nombre,
      unidad: r.unidad,
      requerido: r.requerido,
      enOc,
      recibido,
      estatus: calcularEstatusMaterial(
        aComprar,
        enOc,
        recibido,
        esGenericoCubierto,
        r.idTela !== null ? 'tela' : 'avio',
      ),
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
