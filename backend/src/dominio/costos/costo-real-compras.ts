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
 * ═══ "ÚLTIMO PRECIO" = EL MÁS RECIENTE, VENGA DE LA ORDEN QUE VENGA ═══
 * Incluida **esta misma orden**: si la orden acaba de comprar felpa a $30 y le falta cubrir un
 * remanente, ese remanente se valúa a **$30**, no a una compra vieja de $18 de otra orden. Es lo que
 * significa "último precio de compra" y es lo más fiel al costo de reponer hoy ese material; valuar
 * con un precio viejo teniendo uno fresco sería peor. El desempate es explícito y determinista:
 * **fecha de la OC DESC (las OC sin fecha, al final) → folio DESC → renglón DESC**. La liga a la
 * orden NO influye en el orden: solo cuenta la fecha.
 *
 * ═══ LA SOBRE-COMPRA SE COSTEA COMPLETA (aclaración de DANIEL, 26-jul-2026) ═══
 * Textual: *"si se cortaron 1,000 prendas pero la orden de etiquetas se hizo por 1,100, se debe
 * costear —para efectos reales— el costo de la orden COMPLETA entre lo cortado. En este caso debería
 * costar 1.1 etiquetas por prenda"*. Por eso el IMPORTE DIRECTO entra **íntegro y sin tope**: jamás
 * se recorta a `min(comprado, requerido)` ni se prorratea hacia abajo. El `max(0, requerido −
 * comprado)` existe SOLO para el remanente que la orden consume y NO compró; cuando lo comprado
 * excede al requerido ese remanente es 0 y ya está — comprar de más es NORMAL, **no** genera aviso de
 * alarma. El "1.1 por prenda" cae solo al dividir `costoTotal ÷ cortado` (la base de prorrateo D2)
 * en `costo-orden.ts`. Corolario: escalar el REQUERIDO (abajo) nunca toca el importe directo.
 *
 * ═══ DE DÓNDE SALE EL "REQUERIDO" (corregido tras la revisión del 26-jul-2026) ═══
 * El real y el TEÓRICO tienen que ser COMPARABLES: si no, el default que se guarda mete un sesgo
 * invisible. El teórico usa la receta **`paraCosto`** sobre las piezas **CORTADAS**; el snapshot del
 * MRP (`RequerimientoOrden`) usa la receta **`paraProduccion`** sobre las piezas **PEDIDAS**. Son dos
 * universos distintos. Por eso aquí el requerido se construye SIEMPRE sobre la base del costeo:
 *
 *  • **Base de piezas = `cantidades.cortado`** (la misma del teórico). Si la orden aún no se corta,
 *    el requerido es 0 y el real refleja SOLO lo comprado (con aviso). NUNCA se cae a `pedido`: eso
 *    era justo el sesgo (1,000 pedidas / 900 cortadas ⇒ ~11 % de sobrecosto silencioso).
 *  • **El snapshot del MRP se ESCALA** de su base (piezas pedidas = Σ de la matriz) a las cortadas:
 *    `requerido = cantidadRequerida × (cortado ÷ pedido)`. Se usa el snapshot porque su consumo es
 *    más fino que el BOM plano (matriz real, consumo por talla R18). Si la orden no tiene matriz
 *    (pedido = 0) no se puede escalar: se usa tal cual y se AVISA.
 *  • **Se RECONCILIA contra el BOM `paraCosto`**, que es el que manda para costear:
 *      – material `paraCosto` **ausente** del snapshot ⇒ se AGREGA con `consumoPorPrenda × cortado`
 *        y se AVISA (BOM que creció después de explosionar, o avío `paraCosto` sin `paraProduccion`).
 *        Antes esto salía en **$0 sin un solo aviso**.
 *      – material del snapshot que **NO es `paraCosto`** ⇒ NO se valúa (no es componente de costo) y
 *        se AVISA. Si se le compró para la orden, esa compra SÍ cuenta (dinero realmente gastado).
 *  • Sin snapshot: BOM `paraCosto` × cortado (`origenRequerido = 'receta'`).
 *
 * UNIDADES (R1, `comun/conversion.ts`): el IMPORTE directo nunca necesita conversión (la invariante
 * de valuación dice que `cantidad × precio` no cambia al convertir). Sí la necesitan la CANTIDAD
 * comprada (para restarla del requerido, que está en unidad de consumo del BOM) y el ÚLTIMO PRECIO.
 * Se aplica EXACTAMENTE la misma regla que usa la recepción (`dominio/compras/recepciones.ts`), para
 * que el real cuadre con lo que entra al kardex: **tela → factor 1** (la OC de tela ya va en unidad
 * de uso); **avío → `AvioProveedor.factorConversion` del proveedor de la OC → `Avio.factorConversion`
 * → 1**.
 *
 * ⚠️ DEUDA CONOCIDA DE F4 (ver `HOJA-DE-RUTA.md` §4): `mrp.generarOCDesdeExplosion` escribe la línea
 * de OC en unidad de CONSUMO, mientras `recepciones.ts` y el TSDoc del schema la definen en unidad de
 * PRESENTACIÓN. Con `factor ≠ 1` ese renglón queda sesgado en el kardex Y aquí. NO se corrige en este
 * módulo (cambiar la semántica afectaría a las OC ya creadas): se **AVISA** por cada material cuyo
 * factor sea ≠ 1 para que nadie guarde un número sesgado sin verlo.
 *
 * QUÉ NO HACE (por diseño):
 *  • NO toca los PROCESOS (maquila / arte / bordados): esos no se compran con OC de material.
 *  • Las líneas de OC **LIBRES** (`descripcionLibre`, sin material de catálogo) ligadas a la orden se
 *    REPORTAN aparte (`importeLibre`) y NO se suman a tela ni a avíos: no hay forma de clasificarlas
 *    automáticamente. Se avisa para que el usuario las capture en "Otros" si aplica.
 *  • Solo mira la liga POR RENGLÓN (`OrdenCompraLinea.idOrden`). La liga N:N de encabezado
 *    (`OrdenCompraOrden`) NO cuenta como compra directa (decisión declarada en §Post-F9.5).
 *  • NO escribe nada: es lectura pura. Quien congela el resultado es `guardarCostoOrden`
 *    (`CostoOrden.telaReal`/`aviosReal`).
 *
 * AVISOS SIN DINERO (A9/permisos): los textos de `avisos` **NUNCA** contienen un importe. Van al
 * mismo canal para todos, y un usuario con `costos.ver` pero SIN `consultas.ver-importes` no puede
 * deducir cifras de ellos (lo verifican `costo-real-compras.test.ts` y el test de integración).
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

/**
 * Umbral de SOSPECHA del real contra el teórico: si un componente real queda por DEBAJO de esta
 * fracción de su teórico, se avisa. Medio (0.5) porque un real legítimo suele moverse ±30 % contra
 * el catálogo (mejor precio negociado, merma distinta); caer a MENOS DE LA MITAD casi siempre
 * significa compras incompletas, sin autorizar o con precio en cero — no un buen precio.
 */
const UMBRAL_REAL_SOSPECHOSO = 0.5;

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

/** Un material que la orden REQUIERE (BOM `paraCosto`, reconciliado con el MRP), con sus precios. */
export interface RequeridoMaterial {
  /** Clave de cruce: `tela-<id>` / `avio-<id>`. */
  clave: string;
  tipo: 'tela' | 'avio';
  idTela: number | null;
  idAvio: number | null;
  material: string;
  unidad: string | null;
  esGenerico: boolean;
  /** Consumo BRUTO de la orden sobre las piezas CORTADAS, en unidad de consumo del BOM. */
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

/** Opciones del núcleo puro (todas opcionales: los tests pueden llamarlo con dos argumentos). */
export interface OpcionesCombinar {
  /** Avisos ya detectados por el lector de BD (escalado del MRP, factores de conversión…). */
  avisosPrevios?: readonly string[];
  /**
   * Claves que el lector ya conoce y decidió NO costear (materiales del snapshot fuera de
   * `paraCosto`): evitan el aviso genérico de "no aparece en el requerido", que sería redundante.
   */
  clavesNoCosteables?: ReadonlySet<string>;
  /** Teórico del mismo componente, para el aviso comparativo de subvaluación. Null = no comparar. */
  teorico?: { tela: number; avios: number } | null;
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

/** El real de una orden ya calculado, con el contexto que la salida necesita mostrar. */
export interface RealDeOrden {
  calculado: CostoRealCalculado;
  origenRequerido: OrigenRequerido;
  /** Piezas sobre las que se calculó el consumo requerido (= piezas cortadas, la base del teórico). */
  piezasBase: number;
}

/** Real VACÍO: lo usa el camino que decide NO calcularlo (migración) para no mentir con números. */
export function realVacio(): RealDeOrden {
  return {
    calculado: {
      tela: 0,
      avios: 0,
      total: 0,
      importeDirecto: 0,
      importeValuado: 0,
      importeLibre: 0,
      hayCompras: false,
      materiales: [],
      avisos: [],
    },
    origenRequerido: 'sin-requerido',
    piezasBase: 0,
  };
}

// ── NÚCLEO PURO (sin BD — es lo que ejercitan los tests unitarios) ────────────────────────────────

/**
 * Combina el REQUERIDO de la orden con las COMPRAS ligadas y produce el costo real por material.
 * Función PURA: recibe todo ya leído (requeridos con su último precio/catálogo, y las líneas de OC
 * ligadas ya filtradas por estatus y por empresa) y no toca la base de datos.
 *
 * Reglas aplicadas, en este orden, por material:
 *  1. `importeDirecto` = Σ (cantidad × precio) de sus líneas de OC ligadas, **COMPLETO y sin tope**
 *     aunque exceda el requerido (aclaración de Daniel: la sobre-compra es costo real) → regla 1.
 *  2. `cantidadValuada` = max(0, requerido − comprado) → SOLO el remanente que no se compró.
 *  3. `precioValuado` = último precio de compra → catálogo (con aviso) → 0 (con aviso) → reglas 2 y 3.
 *  4. `importe` = directo + valuado; se acumula en TELA o en AVÍOS según el tipo.
 * Las compras LIBRES se acumulan aparte (`importeLibre`) y NO entran a los totales.
 *
 * REDONDEO (una sola vez, para que el desglose CUADRE con el encabezado): cada compra se redondea a
 * 2 decimales, el importe directo es la Σ de esas compras ya redondeadas, el valuado se redondea, y
 * los totales `tela`/`avios`/`total` se acumulan a partir de los importes de material YA redondeados.
 *
 * ROBUSTEZ: `RequerimientoOrden` no tiene índice único por (orden, material), así que las filas
 * repetidas de un mismo material se FUSIONAN aquí (suma de requeridos) antes de calcular.
 *
 * AVISOS: nunca llevan un importe en el texto (ver el encabezado del módulo).
 */
export function combinarCostoReal(
  requeridos: readonly RequeridoMaterial[],
  lineas: readonly LineaCompraLigada[],
  opciones: OpcionesCombinar = {},
): CostoRealCalculado {
  const avisos: string[] = [...(opciones.avisosPrevios ?? [])];
  const noCosteables = opciones.clavesNoCosteables ?? new Set<string>();

  // Fusiona requeridos repetidos del mismo material (sin @@unique en `RequerimientoOrden`).
  const requeridosUnicos: RequeridoMaterial[] = [];
  const indicePorClave = new Map<string, number>();
  for (const r of requeridos) {
    const i = indicePorClave.get(r.clave);
    if (i === undefined) {
      indicePorClave.set(r.clave, requeridosUnicos.length);
      requeridosUnicos.push({ ...r });
      continue;
    }
    const previo = requeridosUnicos[i];
    if (previo !== undefined) {
      previo.requerido += r.requerido;
      previo.esGenerico = previo.esGenerico || r.esGenerico;
    }
  }

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

  /** Proyecta las líneas de un material: compras redondeadas + su importe directo (Σ de ellas). */
  const armarCompras = (
    lista: readonly LineaCompraLigada[],
  ): {
    compras: MaterialRealCalculado['compras'];
    directo: number;
    comprado: number;
    hayPrecioCero: boolean;
  } => {
    let directo = 0;
    let comprado = 0;
    let hayPrecioCero = false;
    const compras = lista.map((l) => {
      // El importe de CADA renglón se redondea aquí y el directo es su suma: así la lista del
      // desglose suma EXACTAMENTE el importe directo que se muestra arriba (punto de centavos).
      const importe = redondear2(l.cantidad * l.precio);
      directo += importe;
      comprado += l.cantidadConsumo;
      if (l.precio <= TOLERANCIA) {
        hayPrecioCero = true;
      }
      return {
        ...l.compra,
        cantidad: redondear4(l.cantidad),
        unidad: l.unidad,
        precio: redondear2(l.precio),
        importe,
      };
    });
    return { compras, directo: redondear2(directo), comprado, hayPrecioCero };
  };

  // 1) Un renglón por material REQUERIDO (el caso normal).
  for (const r of requeridosUnicos) {
    clavesUsadas.add(r.clave);
    const lista = porClave.get(r.clave) ?? [];
    if (lista.length > 0) {
      hayCompras = true;
    }
    const { compras, directo, comprado, hayPrecioCero } = armarCompras(lista);

    if (hayPrecioCero) {
      avisos.push(
        `«${r.material}» tiene una compra ligada a esta orden con PRECIO EN CERO: su costo real ` +
          `puede estar subvaluado. Captura el precio en la orden de compra.`,
      );
    }

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
        `«${r.material}» no tiene precio (ni compras ni catálogo): se valuó en cero. Revísalo.`,
      );
    }

    const valuado = redondear2(cantidadValuada * (precioValuado ?? 0));
    const importe = redondear2(directo + valuado);

    // Un material que la orden REQUIERE y que acaba costando CERO es casi siempre un dato faltante
    // (precio en cero, catálogo en cero, compra sin autorizar). El caso `sin-precio` ya avisó arriba.
    if (r.requerido > TOLERANCIA && importe <= TOLERANCIA && origenPrecio !== 'sin-precio') {
      avisos.push(
        `«${r.material}» se requiere para esta orden pero su costo real quedó en CERO. Revisa ` +
          `precios y compras antes de guardar.`,
      );
    }

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
      importeDirecto: directo,
      cantidadValuada: redondear4(cantidadValuada),
      precioValuado: precioValuado === null ? null : redondear2(precioValuado),
      importeValuado: valuado,
      origenPrecio,
      ultimaCompra: origenPrecio === 'ultimo-precio-compra' ? r.ultimaCompra : null,
      importe,
    });
  }

  // 2) Materiales COMPRADOS para la orden que NO están en el requerido de COSTO (fuera del BOM
  //    `paraCosto`, o compras libres). Su compra SÍ es dinero gastado en esta orden: entra al costo
  //    (las de catálogo) o se reporta aparte (las libres). Lo que NO se hace es valuar consumo suyo.
  let renglonesLibres = 0;
  for (const [clave, lista] of porClave) {
    if (clavesUsadas.has(clave)) continue;
    const primera = lista[0];
    if (primera === undefined) continue;
    const { compras, directo, comprado, hayPrecioCero } = armarCompras(lista);

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
      if (hayPrecioCero) {
        avisos.push(
          `«${primera.material}» tiene una compra ligada a esta orden con PRECIO EN CERO: su ` +
            `costo real puede estar subvaluado. Captura el precio en la orden de compra.`,
        );
      }
      // El lector ya avisó (y explicó por qué) de los materiales que decidió no costear.
      if (!noCosteables.has(clave)) {
        avisos.push(
          `«${primera.material}» tiene compra ligada a la orden pero NO aparece en el requerido ` +
            `(ni en la explosión de materiales ni en la receta de costo): su compra SÍ entra al ` +
            `costo real.`,
        );
      }
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
      importeDirecto: directo,
      cantidadValuada: 0,
      precioValuado: null,
      importeValuado: 0,
      origenPrecio: 'compra-directa',
      ultimaCompra: null,
      importe: primera.tipo === 'libre' ? 0 : directo,
    });
  }

  if (renglonesLibres > 0) {
    avisos.push(
      `Hay renglones de compra LIBRE ligados a esta orden (fletes, servicios, material no ` +
        `catalogado): no se pueden clasificar como tela ni avío, así que NO entran al costo real. ` +
        `Captúralos en "Otros" si corresponden a esta orden.`,
    );
  }

  const telaFinal = redondear2(tela);
  const aviosFinal = redondear2(avios);

  // Aviso comparativo: un real muy por debajo del teórico casi nunca es "compramos barato".
  const teorico = opciones.teorico ?? null;
  if (teorico !== null) {
    if (teorico.tela > TOLERANCIA && telaFinal < teorico.tela * UMBRAL_REAL_SOSPECHOSO) {
      avisos.push(
        `El costo real de TELA quedó por debajo de la MITAD del teórico: revisa que las compras ` +
          `estén completas, autorizadas y con precio antes de guardar.`,
      );
    }
    if (teorico.avios > TOLERANCIA && aviosFinal < teorico.avios * UMBRAL_REAL_SOSPECHOSO) {
      avisos.push(
        `El costo real de AVÍOS quedó por debajo de la MITAD del teórico: revisa que las compras ` +
          `estén completas, autorizadas y con precio antes de guardar.`,
      );
    }
  }

  return {
    tela: telaFinal,
    avios: aviosFinal,
    // El total se deriva de los componentes YA redondeados: el encabezado siempre cuadra.
    total: redondear2(telaFinal + aviosFinal),
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

/** Aviso de la deuda conocida de F4 cuando un material usa factor de conversión ≠ 1. */
function avisoFactor(material: string): string {
  return (
    `«${material}» se compra en una presentación distinta a su unidad de uso (factor de ` +
    `conversión): por un defecto conocido del MRP (ver HOJA-DE-RUTA §4), su cantidad comprada y su ` +
    `último precio pueden venir sesgados. Verifica este renglón antes de guardar.`
  );
}

/**
 * ÚLTIMO PRECIO DE COMPRA de cada material (regla 2 de Daniel), POR UNIDAD DE CONSUMO. Es la línea
 * de OC `autorizada`/`recibida_*` MÁS RECIENTE de la EMPRESA ACTIVA (A9) para ese material — sin
 * importar a qué orden estuviera ligada, que es justo lo que reparte una compra grande entre las
 * órdenes que la consumen (regla 3). "Más reciente" = fecha de la OC descendente (las OC sin fecha
 * van al final), y a igualdad, el folio/renglón mayor (determinista).
 *
 * Se resuelve con una consulta POR MATERIAL (`findFirst`, índice por `id_tela`/`id_avio`) y solo de
 * los materiales que REALMENTE hay que valuar: son unas pocas decenas por orden, van en paralelo, y
 * así el orden es EXACTO (incluidas las OC sin fecha), en vez de traer todo el histórico de compras
 * del material para quedarnos con una fila. El camino de migración ni siquiera las ejecuta
 * (`guardarCostoOrden` con `calcularReal: false`).
 */
async function leerUltimosPrecios(
  cliente: ClienteLectura,
  idEmpresa: number,
  materiales: readonly {
    clave: string;
    material: string;
    idTela: number | null;
    idAvio: number | null;
  }[],
): Promise<{
  precios: Map<string, { precio: number; compra: ReferenciaCompra }>;
  avisos: string[];
}> {
  const precios = new Map<string, { precio: number; compra: ReferenciaCompra }>();
  const avisos: string[] = [];
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
      return { clave: m.clave, material: m.material, linea };
    }),
  );

  const encontradas = filas.flatMap((f) => (f.linea === null ? [] : [f.linea]));
  const { factoresAvio, factoresAvioProveedor } = await leerFactores(cliente, encontradas);
  for (const f of filas) {
    if (f.linea === null) continue;
    const factor = factorDeLinea(f.linea, factoresAvio, factoresAvioProveedor);
    if (factor !== 1) {
      avisos.push(avisoFactor(f.material));
    }
    precios.set(f.clave, {
      // Precio por unidad de CONSUMO (R1: precio por presentación ÷ factor) — igual que la recepción.
      precio: num(f.linea.precio) / factor,
      compra: referencia(f.linea),
    });
  }
  return { precios, avisos };
}

/** `select` de la orden para el costo real: empresa + receta `paraCosto` (la que manda al costear). */
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

/** Un material del BOM `paraCosto` normalizado (la fuente de verdad del COSTEO). */
interface MaterialBom {
  clave: string;
  tipo: 'tela' | 'avio';
  idTela: number | null;
  idAvio: number | null;
  material: string;
  unidad: string | null;
  esGenerico: boolean;
  consumoPorPrenda: number;
  precioCatalogo: number | null;
}

/** Normaliza el BOM `paraCosto` del modelo (telas + avíos) a una lista uniforme. */
function bomParaCosto(orden: OrdenReal): MaterialBom[] {
  return [
    ...orden.modelo.telas.map((t) => ({
      clave: `tela-${String(t.idTela)}`,
      tipo: 'tela' as const,
      idTela: t.idTela,
      idAvio: null,
      material: t.tela.nombre,
      unidad: t.tela.unidadMedida,
      esGenerico: false,
      consumoPorPrenda: num(t.consumoPorPrenda),
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
      consumoPorPrenda: num(a.consumoPorPrenda),
      precioCatalogo: numOrNull(a.avio.precioReferencia),
    })),
  ];
}

/** Base de materiales requeridos (sin último precio todavía) + contexto del cálculo. */
interface BaseRequerido {
  origen: OrigenRequerido;
  piezasBase: number;
  filas: Omit<RequeridoMaterial, 'ultimoPrecio' | 'ultimaCompra'>[];
  /** Materiales del snapshot que NO son `paraCosto`: no se valúan (pero su compra sí cuenta). */
  clavesNoCosteables: Set<string>;
  avisos: string[];
  /** Teórico del mismo alcance (BOM `paraCosto` × piezas cortadas), para el aviso comparativo. */
  teorico: { tela: number; avios: number };
}

/**
 * Arma el REQUERIDO del COSTEO (ver el bloque "DE DÓNDE SALE EL REQUERIDO" del encabezado):
 * BOM `paraCosto` × piezas CORTADAS como esqueleto, afinado con el snapshot del MRP ESCALADO de su
 * base (piezas pedidas) a las cortadas, y reconciliado en los dos sentidos con avisos explícitos.
 */
async function armarRequerido(
  cliente: ClienteLectura,
  orden: OrdenReal,
  bd: ContextoBd | undefined,
): Promise<BaseRequerido> {
  const avisos: string[] = [];
  const clavesNoCosteables = new Set<string>();
  const bom = bomParaCosto(orden);
  const bomPorClave = new Map(bom.map((b) => [b.clave, b]));

  const cant = await cantidadesDeOrden(orden.id, bd);
  // La MISMA base que el teórico de `costo-orden.ts`: piezas CORTADAS (nunca las pedidas).
  const piezasBase = cant.cortado;

  const teorico = {
    tela:
      bom
        .filter((b) => b.tipo === 'tela')
        .reduce((s, b) => s + b.consumoPorPrenda * (b.precioCatalogo ?? 0), 0) * piezasBase,
    avios:
      bom
        .filter((b) => b.tipo === 'avio')
        .reduce((s, b) => s + b.consumoPorPrenda * (b.precioCatalogo ?? 0), 0) * piezasBase,
  };

  if (piezasBase <= 0) {
    avisos.push(
      `La orden todavía no tiene corte: el consumo requerido es cero, así que el costo real solo ` +
        `refleja lo que ya se compró para ella.`,
    );
  }

  const snapshot = await cliente.requerimientoOrden.findMany({
    where: { idOrden: orden.id },
    select: {
      idTela: true,
      idAvio: true,
      cantidadRequerida: true,
      unidad: true,
      esGenerico: true,
      tela: { select: { nombre: true, unidadMedida: true, precioSugerido: true } },
      avio: { select: { clave: true, descripcion: true, unidad: true, precioReferencia: true } },
    },
    orderBy: { id: 'asc' },
  });

  // ── Sin explosión de MRP: BOM `paraCosto` × cortado ────────────────────────────────────────────
  if (snapshot.length === 0) {
    return {
      origen: bom.length === 0 ? 'sin-requerido' : 'receta',
      piezasBase,
      filas: bom.map((b) => ({
        clave: b.clave,
        tipo: b.tipo,
        idTela: b.idTela,
        idAvio: b.idAvio,
        material: b.material,
        unidad: b.unidad,
        esGenerico: b.esGenerico,
        requerido: b.consumoPorPrenda * piezasBase,
        precioCatalogo: b.precioCatalogo,
      })),
      clavesNoCosteables,
      avisos,
      teorico,
    };
  }

  // ── Con explosión: se ESCALA de piezas PEDIDAS (su base, `mrp.ts`) a piezas CORTADAS ────────────
  const piezasSnapshot = cant.pedido;
  const escala = piezasSnapshot > 0 ? piezasBase / piezasSnapshot : 1;

  // Suma el snapshot por material (no hay índice único que lo garantice) y descarta lo no costeable.
  const requeridoSnapshot = new Map<string, { cantidad: number; unidad: string | null }>();
  for (const r of snapshot) {
    const clave = r.idTela === null ? `avio-${String(r.idAvio)}` : `tela-${String(r.idTela)}`;
    if (!bomPorClave.has(clave)) {
      if (!clavesNoCosteables.has(clave)) {
        clavesNoCosteables.add(clave);
        const nombre =
          r.tela?.nombre ?? (r.avio === null ? clave : `${r.avio.clave} — ${r.avio.descripcion}`);
        avisos.push(
          `«${nombre}» viene de la explosión de materiales pero NO está marcado "se considera al ` +
            `costear" en la receta del modelo: su consumo NO se valuó. Si se le compró para esta ` +
            `orden, esa compra sí cuenta.`,
        );
      }
      continue;
    }
    const previo = requeridoSnapshot.get(clave);
    requeridoSnapshot.set(clave, {
      cantidad: (previo?.cantidad ?? 0) + num(r.cantidadRequerida),
      unidad: previo?.unidad ?? r.unidad,
    });
  }

  // Los avisos del ESCALADO solo tienen sentido si el snapshot aportó algo costeable (si no aportó
  // nada, ningún requerido salió de él y hablar de "ajustar la explosión" sería mentira).
  if (requeridoSnapshot.size > 0) {
    if (piezasSnapshot > 0) {
      if (Math.abs(escala - 1) > TOLERANCIA) {
        avisos.push(
          `La explosión de materiales se calculó sobre las piezas PEDIDAS y el costo se prorratea ` +
            `sobre las CORTADAS: el consumo requerido se ajustó a esa proporción.`,
        );
      }
    } else if (piezasBase > 0) {
      avisos.push(
        `No se pudo ajustar la explosión de materiales a las piezas cortadas (la orden no tiene ` +
          `matriz de tallas): se usó el consumo de la explosión tal cual.`,
      );
    }
  }

  const filas = bom.map((b) => {
    const delSnapshot = requeridoSnapshot.get(b.clave);
    if (delSnapshot === undefined) {
      avisos.push(
        `«${b.material}» está en la receta de COSTO del modelo pero NO en la explosión de ` +
          `materiales de la orden: se costeó con la receta. Vuelve a explosionar la orden si ` +
          `quieres que el MRP mande.`,
      );
    }
    return {
      clave: b.clave,
      tipo: b.tipo,
      idTela: b.idTela,
      idAvio: b.idAvio,
      material: b.material,
      unidad: delSnapshot?.unidad ?? b.unidad,
      esGenerico: b.esGenerico,
      requerido:
        delSnapshot === undefined ? b.consumoPorPrenda * piezasBase : delSnapshot.cantidad * escala,
      precioCatalogo: b.precioCatalogo,
    };
  });

  return {
    // HONESTIDAD DE LA ETIQUETA: `snapshot-mrp` solo si el snapshot APORTÓ al menos un material
    // costeable. Que exista `RequerimientoOrden` no basta: si la reconciliación lo descartó entero
    // (ningún material suyo es `paraCosto`), el 100 % del requerido salió de la receta y eso es lo
    // que hay que decir — la pantalla lo muestra al usuario como "de dónde salió la base".
    origen:
      filas.length === 0 ? 'sin-requerido' : requeridoSnapshot.size > 0 ? 'snapshot-mrp' : 'receta',
    piezasBase,
    filas,
    clavesNoCosteables,
    avisos,
    teorico,
  };
}

/**
 * Calcula el COSTO REAL de materiales de una orden (lectura pura, sin permisos: lo llaman
 * `costoRealOrden` —que sí verifica `costos.ver`— y `guardarCostoOrden` dentro de su transacción).
 * La orden ya viene resuelta y verificada como de la empresa activa (A9).
 */
export async function calcularCostoRealDeOrden(
  orden: OrdenReal,
  bd?: ContextoBd,
): Promise<RealDeOrden> {
  const cliente = clienteLectura(bd);
  const idEmpresa = orden.idEmpresa;
  const avisosPrevios: string[] = [];

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
  const conFactorRaro = new Set<string>();
  const ligadas: LineaCompraLigada[] = lineasOc.map((l) => {
    const factor = factorDeLinea(l, factoresAvio, factoresAvioProveedor);
    const cantidad = num(l.cantidad);
    const material = nombreMaterial(l);
    if (factor !== 1) {
      conFactorRaro.add(material);
    }
    return {
      clave: claveLinea(l),
      tipo: l.idTela !== null ? 'tela' : l.idAvio !== null ? 'avio' : 'libre',
      idTela: l.idTela,
      idAvio: l.idAvio,
      material,
      cantidad,
      // Cantidad en unidad de CONSUMO (R1) — para poder restarla del requerido del BOM.
      cantidadConsumo: cantidad * factor,
      unidad: l.unidad,
      precio: num(l.precio),
      compra: referencia(l),
    };
  });
  for (const material of conFactorRaro) {
    avisosPrevios.push(avisoFactor(material));
  }

  // 2) Requerido del COSTEO (BOM `paraCosto` × cortado, afinado y reconciliado con el MRP).
  const base = await armarRequerido(cliente, orden, bd);
  avisosPrevios.push(...base.avisos);

  // 3) Último precio de compra SOLO de los materiales que tienen consumo sin compra propia (los
  //    que la compra ligada ya cubre por completo no necesitan valuarse → cero consultas de más).
  const compradoPorClave = new Map<string, number>();
  for (const l of ligadas) {
    compradoPorClave.set(l.clave, (compradoPorClave.get(l.clave) ?? 0) + l.cantidadConsumo);
  }
  const porValuar = base.filas.filter(
    (f) => f.requerido - (compradoPorClave.get(f.clave) ?? 0) > TOLERANCIA,
  );
  const { precios, avisos: avisosUltimos } = await leerUltimosPrecios(
    cliente,
    idEmpresa,
    porValuar,
  );
  for (const aviso of avisosUltimos) {
    if (!avisosPrevios.includes(aviso)) {
      avisosPrevios.push(aviso);
    }
  }

  const requeridos: RequeridoMaterial[] = base.filas.map((f) => {
    const u = precios.get(f.clave);
    return {
      ...f,
      ultimoPrecio: u === undefined ? null : u.precio,
      ultimaCompra: u === undefined ? null : u.compra,
    };
  });

  return {
    calculado: combinarCostoReal(requeridos, ligadas, {
      avisosPrevios,
      clavesNoCosteables: base.clavesNoCosteables,
      teorico: base.teorico,
    }),
    origenRequerido: base.origen,
    piezasBase: base.piezasBase,
  };
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

/**
 * Proyecta el resumen del real ocultando importes sin `consultas.ver-importes`. Los `avisos` viajan
 * SIEMPRE completos porque, por contrato de este módulo, nunca llevan una cifra de dinero.
 */
export function resumenReal(real: RealDeOrden, verImportes: boolean): CostoRealResumen {
  const c = real.calculado;
  const money = (v: number): number | null => (verImportes ? v : null);
  return {
    tela: money(c.tela),
    avios: money(c.avios),
    total: money(c.total),
    importeDirecto: money(c.importeDirecto),
    importeValuado: money(c.importeValuado),
    importeLibre: money(c.importeLibre),
    hayCompras: c.hayCompras,
    origenRequerido: real.origenRequerido,
    piezasBase: real.piezasBase,
    avisos: c.avisos,
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
  const real = await calcularCostoRealDeOrden(orden, bd);
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const money = (v: number | null): number | null => (verImportes ? v : null);

  return {
    ...resumenReal(real, verImportes),
    idOrden: orden.id,
    folio: Number(orden.folio),
    materiales: real.calculado.materiales.map((m) => ({
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
