/**
 * EXPLOSIÓN MRP de materiales por orden (Módulo COMPRAS, F4-E4 — el corazón del MRP de F4).
 * REQUISITOS-NUEVOS.md §R3 (explosión telas+avíos contra el BOM) y §R7 (cruce "qué tengo / qué
 * falta"), principio Make-to-Order (se compra POR ORDEN, nunca por niveles de stock/reorden) y doc
 * `Documentacion_MJD/01-Modelos.md §2` (la receta/BOM: telas con `CantTela`, avíos con `CantHab`).
 *
 * Tres operaciones, toda la lógica AQUÍ (A1); las rutas REST solo validan permiso + Zod y delegan:
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
 *  1. `explosionarOrden` (R3): Requerido = Σ( consumoPorPrenda de la RECETA DE LA ORDEN
 *     `paraProduccion` y no excluida × piezas color×talla de la orden ), para TELAS y AVÍOS. PERSISTE un SNAPSHOT regenerable
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
 *
 * ⭐ **LA OC NACE CON LO ÚLTIMO QUE ESE PROVEEDOR COBRÓ (DANIEL, 15-ago-2026 — §Post-F9.48).** El MRP
 * también aplica el escalón 1 de la cascada única, pero con un LÍMITE que es el corazón de la
 * decisión: **solo cuenta la última compra AL PROVEEDOR AL QUE SE LE VA A COMPRAR**. Nunca el precio
 * de un tercero — eso emitiría una orden con un precio que ese proveedor jamás dio.
 *
 *  • **A QUIÉN se le compra NO cambia**: lo sigue fijando R1/F4 (proveedor amarrado; si no, el más
 *    barato). Esta etapa no toca la política de compra, solo **a qué precio nace la línea**.
 *  • **A QUÉ PRECIO**: la última compra REAL a ese proveedor (`ultimo-precio-compra.ts`, OC
 *    autorizada, ya ÷ factor R1). Si nunca se le compró, su precio de catálogo/negociado — el
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
} from '../../contrato/index.js';
import type { PendienteLiberar, TipoCambioRecetaClave } from '../../contrato/index.js';
import type { Prisma, RequerimientoOrden } from '../../datos/index.js';

import { datosCreacion, registrarBitacora } from '../../comun/auditoria.js';
import { precioAUnidadConsumo, resolverFactor } from '../../comun/conversion.js';
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
import { num, numOrNull } from '../costos/decimales.js';
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
import { requeridoAvioReceta } from '../produccion/receta-avios.js';
import {
  desalineacionDeOrden,
  exigirMaterialesLiberados,
  exigirRecetaLiberada,
} from '../produccion/receta-orden.js';

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
      tela: { select: { nombre: true, unidadMedida: true, precioSugerido: true } },
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
  lineas: {
    select: {
      idColor: true,
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

/** Proveedor + precio sugerido resuelto (idProveedor/nombre/precio por unidad de consumo, o nulls). */
interface ProveedorPrecio {
  idProveedor: number | null;
  proveedor: string | null;
  precio: number | null;
}

const SIN_PROVEEDOR: ProveedorPrecio = { idProveedor: null, proveedor: null, precio: null };

/**
 * Proveedor/precio elegido + la TRAZA de si el precio se pisó con la última compra real (D1). La
 * traza no es decorativa: los AVISOS tienen que nombrar la fuente REAL del precio con el que quedó
 * la línea. Un aviso que describe mal su propia causa es el mismo pecado que esta etapa corrigió en
 * la receta —decir una cosa y hacer otra—, solo que en prosa.
 */
interface ProveedorPrecioResuelto extends ProveedorPrecio {
  /** ¿El precio final salió de la última COMPRA REAL a ese proveedor (§Post-F9.48)? */
  desdeUltimaCompra: boolean;
}

/**
 * ⭐ §Post-F9.48 (D1, DANIEL 15-ago-2026): **la línea de OC nace con lo último que ESE proveedor
 * cobró**. Recibe el proveedor/precio YA elegido por R1/F4 (amarrado o más barato) y le PISA el
 * precio con la última compra REAL **a ese mismo proveedor**, si existe.
 *
 * Invariantes que respeta —y por las que existe como paso aparte, en vez de alimentar la cascada
 * compartida—:
 *  • **NUNCA cambia el proveedor.** La elección es de R1/F4 y esta etapa no la toca.
 *  • **NUNCA usa el precio de un tercero.** Solo mira `porMaterialProveedor`, jamás el mapa global:
 *    una OC dirigida a X no puede nacer con lo que cobró Y.
 *  • **Sin compras a ese proveedor, no hace nada**: se queda el precio de catálogo/negociado que
 *    traía (comportamiento anterior intacto → no-regresión).
 *  • `respetarPrecio` deja al llamador BLINDAR un precio más específico que la compra: hoy lo usa la
 *    tela cuyo precio salió del COLOR (`amarre-color`), porque `OrdenCompraLinea` no guarda color y
 *    la última compra es ciega a él.
 */
function conUltimoPrecioDelProveedor(
  elegido: ProveedorPrecio,
  material: { tipo: 'tela' | 'avio'; id: number },
  ultimos: UltimosPreciosCompra,
  respetarPrecio = false,
): ProveedorPrecioResuelto {
  if (respetarPrecio || elegido.idProveedor === null) {
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
      return 'el proveedor no tiene precio base: se usó el precio de catálogo de la tela';
    case 'sin-precio':
      return 'no hay ningún precio que usar: la línea nace SIN precio';
    default:
      // `amarre-color` no puede llegar aquí (el color solo resuelve con UN color en la orden) y
      // `color-referencia` es inalcanzable en el MRP (nunca se pasa `precioColorReferencia`).
      return 'se usó el precio que resolvió la cascada';
  }
}

/**
 * Resuelve proveedor/precio de una TELA de la receta heredando el AMARRE de Desarrollo (F8-E6). Sin amarre →
 * NULL (como antes de F8: captura manual, D5). Con amarre → `idProveedorSugerido` = el proveedor elegido
 * (aunque el precio termine saliendo del sugerido genérico: a ese proveedor se le compra) y el precio se
 * resuelve con la cascada `resolverPrecioTela`. Precio-por-color: las telas del MRP se consumen por
 * MODELO completo (sin desglose por color en v2), así que sólo se resuelve por color cuando la orden es de
 * UN color; si tiene varios colores con precios de tela DISTINTOS, el precio-por-color NO se aplica y se
 * DEJA UN AVISO (no truena en silencio) que nombra la fuente REAL del precio con el que quedó la línea —
 * base del proveedor, catálogo de la tela o última compra a ese proveedor (D1). Empuja avisos al arreglo
 * compartido.
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
  mt: OrdenParaExplosion['recetaTelas'][number],
  colores: number[],
  avisos: string[],
  ultimos: UltimosPreciosCompra,
): ProveedorPrecioResuelto {
  const tp = mt.telaProveedor;
  if (mt.idTelaProveedor === null || tp === null) {
    // sin amarre → como hoy (NULL / captura manual)
    return { ...SIN_PROVEEDOR, desdeUltimaCompra: false };
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
  // Multi-color con precios de tela DISTINTOS: el precio-por-color no se puede aplicar (la tela se
  // compra por modelo completo). Solo se DETECTA aquí; el aviso se arma más abajo, cuando ya se
  // sabe con qué precio quedó la línea (ver `fuenteDelPrecioTela`).
  let multiColorConPreciosDistintos = false;
  if (tp.manejaPrecioPorColor) {
    const precioPorColor = new Map(tp.colores.map((c) => [c.idColor, numOrNull(c.precio)]));
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
    precioSugerido: numOrNull(mt.tela.precioSugerido),
    amarre: {
      precio: numOrNull(tp.precio),
      manejaPrecioPorColor: tp.manejaPrecioPorColor,
      precioColor,
    },
  });
  // ⭐ D1/§Post-F9.48: la línea nace con lo último que ESTE proveedor cobró. Excepción: un precio
  // por COLOR es más específico que la última compra (que no sabe de colores) y no se pisa.
  const sugerido = conUltimoPrecioDelProveedor(
    { idProveedor: tp.idProveedor, proveedor: tp.proveedor.nombre, precio: resuelto.precio },
    { tipo: 'tela', id: mt.idTela },
    ultimos,
    resuelto.origen === 'amarre-color',
  );

  // El aviso va DESPUÉS de resolver el precio, para poder nombrar la fuente que de verdad se usó:
  // armarlo antes hacía que dijera "el precio base del proveedor" incluso cuando D1 ya lo había
  // pisado con la última compra — mandando a revisar un dato que no era el de la línea.
  if (multiColorConPreciosDistintos) {
    avisos.push(
      `Tela "${mt.tela.nombre}": la orden tiene varios colores con precios de tela distintos ` +
        `en "${tp.proveedor.nombre}", así que el precio por color no se aplicó; ` +
        `${fuenteDelPrecioTela(resuelto.origen, sugerido.desdeUltimaCompra)}. ` +
        `Revisa el precio de la OC.`,
    );
  }

  return sugerido;
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
  ma: OrdenParaExplosion['recetaAvios'][number],
  avisos: string[],
  ultimos: UltimosPreciosCompra,
): ProveedorPrecioResuelto | null {
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
    // ⭐ D1/§Post-F9.48: el precio de la línea es el de la última compra A ESTE proveedor.
    return conUltimoPrecioDelProveedor(
      {
        idProveedor: fila.idProveedor,
        proveedor: fila.proveedor.nombre,
        precio: resuelto.precio,
      },
      { tipo: 'avio', id: ma.idAvio },
      ultimos,
    );
  }
  return null; // amarre sin precio usable → fallback F4 (más barato)
}

/**
 * Cantidad requerida de un AVÍO (R18). Delega el cálculo PURO al helper COMPARTIDO
 * `requeridoAvioReceta` (`produccion/receta-avios.ts`, DEBE-2 — misma regla que la habilitación) y
 * aquí sólo arma el AVISO con las etiquetas de las tallas que cayeron al consumo por prenda.
 */
function requeridoAvio(
  ma: OrdenParaExplosion['recetaAvios'][number],
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
 *
 * ⭐ **PRECIO de la línea (D1/§Post-F9.48):** una vez elegido el proveedor por R1/F4, el precio se
 * PISA con el de la última compra REAL **a ese mismo proveedor** ({@link conUltimoPrecioDelProveedor});
 * si nunca se le compró, queda el de catálogo/negociado. La elección del proveedor NO cambia y jamás
 * se usa el precio de un tercero.
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
  for (const mt of orden.recetaTelas) {
    if (!mt.paraProduccion) continue;
    const requerida = num(mt.consumoPorPrenda) * totalPiezas;
    const sugerido = resolverProveedorPrecioTela(mt, colores, avisos, ultimos);
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

  // ── AVÍOS de la RECETA DE LA ORDEN (paraProduccion, no excluidos) ──
  for (const ma of orden.recetaAvios) {
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
      resolverProveedorPrecioAvioAmarrado(ma, avisos, ultimos) ??
      // Sin amarre usable: el MÁS BARATO de F4 elige al proveedor (R1, intacto) y D1 le pone el
      // precio de la última compra A ESE MISMO proveedor.
      conUltimoPrecioDelProveedor(
        await proveedorSugeridoAvio(tx, ma.idAvio),
        { tipo: 'avio', id: ma.idAvio },
        ultimos,
      );
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
  /** Cambios del modelo que afectan a ESTE material (§Post-F9.43(d)); vacío = nada que avisar. */
  cambiosReceta: TipoCambioRecetaClave[] = [],
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
    cambiosReceta,
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
    // La orden PRIMERO (A9): si es de otra empresa se responde 404 y no se dice nada más de ella —
    // ni siquiera si su receta está liberada.
    const orden = await cargarOrden(tx, idOrden, idEmpresa);
    // ⭐ LA PUERTA (V1-E3d §Post-F9.43(c), re-cortada por V1-E3h §Post-F9.72): ya no es todo-o-nada.
    // Con ALGO liberado se explota lo liberado y se REPORTA lo que faltó firmar; con NADA liberado
    // frena (no hay qué comprar) y el mensaje dice dónde se libera. La puerta va antes de COMPRAR,
    // no antes de producir: cortar, enviar a maquila, recibir y entregar NO pasan por aquí.
    const porLiberar = await exigirRecetaLiberada(tx, idOrden, idEmpresa);
    // El ARTE no se compra por MRP (igual que en el reparto de la desalineación): listarlo aquí
    // sería ruido para quien está viendo materiales.
    const pendientesLiberar: PendienteLiberar[] = porLiberar
      .filter((r) => r.tipo !== 'arte')
      .map((r) => ({
        tipo: r.tipo as 'tela' | 'avio',
        idRenglon: r.idRenglon,
        idTela: r.idTela,
        idAvio: r.idAvio,
        material: r.material,
        consumoPorPrenda: r.consumoPorPrenda,
        unidad: r.unidad,
      }));
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
          // El renglón ya no existe en la receta: la desalineación no tiene qué marcarle.
          cambiosReceta: [],
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
        aRequerimientoSalida(
          creada,
          diffPorClave.get(claveRequerimiento(c)) ?? 'sin-cambio',
          cambiosDe(c),
        ),
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
        desalineada: desalineacion.hayCambios,
        // V1-E3h: queda escrito CONTRA QUÉ se explotó — cuántos renglones se quedaron fuera por no
        // estar firmados. Sin esto, una explosión corta parecería un BOM incompleto.
        pendientesLiberar: pendientesLiberar.length,
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
      desalineacion,
      pendientesLiberar,
    };
  }, bd);
}

// ── Operación 2: GENERAR OC desde la explosión (R3) ─────────────────────────────────────────────────

/**
 * ⭐ §Post-F9.71 — RESUELVE LA FECHA DE CADA OC (función PURA, sin BD: la regla se prueba sin
 * levantar Postgres). Para cada proveedor al que se le va a comprar: su fecha propia si la pantalla
 * la mandó, si no la `fechaBase` (la del formulario o, en su defecto, la de la orden de producción).
 * Los que se quedan sin ninguna salen en `sinFecha` para que quien llama los nombre en el error.
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
    const fecha = propias.get(idProveedor) ?? fechaBase;
    if (fecha === null) {
      sinFecha.push(idProveedor);
      continue;
    }
    fechas.set(idProveedor, fecha);
  }
  return { fechas, sinFecha };
}

/**
 * Genera una o varias OC desde el snapshot de explosión (R3): toma el requerido PENDIENTE
 * (`cantidadAComprar > 0`) seleccionado, lo agrupa POR PROVEEDOR sugerido y crea UNA OC por
 * proveedor en UNA transacción (A2), REUSANDO `crearOC` (folio atómico A3, auditoría A7, ligas N:N).
 * Cada línea liga la orden de producción (`idOrden`) para que R7 cruce sin prorrateos. La OC nace en
 * `borrador`. `idsRequerimiento` vacío = generar para TODO lo pendiente. Permiso `compras.administrar`.
 *
 * ⭐ §Post-F9.71 — CADA OC LLEVA SU PROPIA FECHA DE ENTREGA. La tela se necesita semanas antes que
 * los avíos: `fechasPorProveedor` manda la fecha de cada proveedor y `fechaEntrega` queda como el
 * valor de arranque para los que no traen la suya. Ponerles a todas la misma fecha volvía el dato
 * decorativo — y un dato que nadie cree no sirve para reclamar.
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
      select: { id: true, folio: true, fechaEntrega: true },
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', idOrden);
    }
    // ⭐ LA PUERTA otra vez (V1-E3d, §Post-F9.43(c)): generar OC es EXACTAMENTE el momento de gastar
    // dinero. Se re-verifica aquí y no solo al explotar, porque el snapshot pudo haberse hecho antes
    // (o la liberación revocarse) y el gate tiene que estar donde sale el dinero.
    await exigirRecetaLiberada(tx, idOrden, idEmpresa);

    // §Post-F9.18: toda OC nace con FECHA DE ENTREGA y DIRECCIÓN del catálogo. Aquí no se inventan:
    // se toman de lo que ya existe — la fecha de entrega de la ORDEN de producción y la dirección
    // FAVORITA del catálogo — salvo que la pantalla mande las suyas. Si no hay de dónde, se dice
    // exactamente qué falta en vez de generar una OC a medias.
    //
    // ⭐ §Post-F9.71 — la fecha de arriba es el VALOR INICIAL, no la verdad de todas: cada proveedor
    // puede traer la suya (`fechasPorProveedor`) y ésa gana. La comprobación de "falta fecha" ya no
    // puede hacerse aquí de un golpe, porque un proveedor con fecha propia NO necesita la de arriba:
    // se hace PROVEEDOR POR PROVEEDOR, más abajo, cuando ya se sabe a quién se le va a comprar.
    const fechaBase =
      cuerpo.fechaEntrega ??
      (orden.fechaEntrega === null ? null : orden.fechaEntrega.toISOString().slice(0, 10));
    let idDireccionEntrega = cuerpo.idDireccionEntrega;
    if (idDireccionEntrega === undefined) {
      const favorita = await tx.direccionEntrega.findFirst({
        where: { favorita: true, activo: true },
        select: { id: true },
      });
      if (favorita === null) {
        throw new ErrorValidacion(
          'No hay una dirección de entrega marcada como favorita en el catálogo: márcala en ' +
            'Compras › Direcciones de entrega, o elige una al generar las compras.',
        );
      }
      idDireccionEntrega = favorita.id;
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

    // ⭐⭐ V1-E3h — Y AHORA, MATERIAL POR MATERIAL (§Post-F9.72). Con la firma por renglón, "algo
    // liberado" ya no basta aquí: el SNAPSHOT se escribió con lo que estaba firmado en su momento, y
    // entre la explosión y este clic alguien pudo tocar un renglón (lo que lo vuelve a cerrar). Sin
    // esta segunda verificación, la compra parcial abriría justo el agujero que la firma tapa —
    // comprar contra un renglón que Desarrollo ya des-autorizó. Se dice CON NOMBRE cuál (D3).
    await exigirMaterialesLiberados(tx, idOrden, idEmpresa, elegibles);

    // Agrupa por proveedor sugerido → una OC por proveedor.
    const porProveedor = new Map<number, typeof elegibles>();
    for (const r of elegibles) {
      const idProv = r.idProveedorSugerido as number;
      const lista = porProveedor.get(idProv) ?? [];
      lista.push(r);
      porProveedor.set(idProv, lista);
    }

    // ⭐ §Post-F9.71 — la fecha de CADA OC. Se resuelve ANTES de crear la primera (A2: o nacen todas
    // o no nace ninguna), y si a alguna no le queda fecha por ningún lado se dice CON NOMBRE Y
    // APELLIDO: "falta la fecha" sin decir de quién obliga al usuario a adivinar cuál proveedor es.
    const { fechas, sinFecha } = resolverFechasDeOc(
      [...porProveedor.keys()],
      fechaBase,
      cuerpo.fechasPorProveedor,
    );
    if (sinFecha.length > 0) {
      const nombres = await tx.proveedor.findMany({
        where: { id: { in: sinFecha } },
        select: { nombre: true },
        orderBy: { nombre: 'asc' },
      });
      const lista = nombres.map((p) => p.nombre).join(', ');
      throw new ErrorValidacion(
        `La orden ${String(orden.folio)} no tiene fecha de entrega, y toda orden de compra la ` +
          `necesita. Captúrala en la orden, o indica la fecha de entrega (la de arriba o la de ` +
          `cada proveedor) al generar las compras. Sin fecha se quedarían: ${lista}.`,
      );
    }

    const ordenesCompra: OcGeneradaSalida[] = [];
    for (const [idProveedor, lista] of porProveedor) {
      // A estas alturas TODO proveedor del mapa tiene fecha (si no, se rechazó arriba con sus
      // nombres). El `?? ''` es inalcanzable, y si algún día dejara de serlo `crearOC` lo rechaza
      // en su `validarEntrada` — nunca se escribe una OC con fecha inventada.
      const fechaEntrega = fechas.get(idProveedor) ?? '';
      const entrada: EntradaCrearOC = {
        idProveedor,
        fechaEntrega,
        idDireccionEntrega,
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
