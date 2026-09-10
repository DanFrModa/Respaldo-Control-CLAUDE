/**
 * Cantidades DERIVADAS de una orden que sirven de BASE DE PRORRATEO del costeo (F7-E1; D2/D3/D4).
 * Todas se calculan por SUMA DIRECTA de `EtapaMovimientoDet` (etapas vivas, canceladas excluidas) —
 * NUNCA por un acumulador ni una columna (D3). Es el mismo criterio que el tablero WIP (F3-E5).
 *
 *  • pedido   = Σ de la matriz `OrdenLineaTalla` (lo pedido).
 *  • cortado  = Σ etapas `corte`                          (= `CantCorte` del viejo).
 *  • recibido = Σ recibos de procesos que meten a PT (costura, `generaEntradaPt`) — prenda
 *               terminada. ⭐ **Es la BASE POR DEFECTO desde 0.061** (§Post-F9.154(b)).
 *  • vendido  = Σ etapas `entrega_cliente`.
 *
 * ⭐ **POR QUÉ `recibido` Y NO `cortado`** (DANIEL, 30-ago-2026): *«Las 10 faltantes se las voy a
 * cobrar al maquilero… esas las sacaría de la ecuación. Y las segundas también se venden a un
 * Saldero. Las únicas que se pierden por completo son las incompletas.»* `recibido` suma
 * `EtapaMovimientoDet.cantidad`, que es `primeras + segundas` — o sea, exactamente lo que se vende.
 * Quedan fuera solas, sin ninguna guarda: las INCOMPLETAS (viven en su columna aparte,
 * `cantidadIncompletas`, y desde 0.061 salen como merma) y los FALTANTES (nunca se recibieron, y se
 * le cobran al maquilero en EsMa). Dividir entre las CORTADAS quedó descartado por Daniel porque
 * **escondería el costo de la merma**: repartiría el dinero entre piezas que no existen.
 *
 * ⚠️ Imprecisión DECLARADA y no corregida: el cobro del faltante al maquilero NO baja el costo de la
 * orden (vive en EsMa, otra cuenta). Daniel lo sabe y lo aceptó así.
 *
 * Se reusa en el costeo de una orden (obtener/guardar) y en la lista de costos (unitario por fila).
 */
import type { BaseProrrateo, MotivoSinUnitario } from '../../contrato/index.js';
import { TipoEtapaMovimiento, type Prisma } from '../../datos/index.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';

/** Cliente de LECTURA (sin transacción). */
type ClienteLectura = ReturnType<typeof clienteLectura>;

/** Cantidades derivadas de una orden (base del prorrateo del costo unitario). */
export interface CantidadesOrden {
  pedido: number;
  cortado: number;
  recibido: number;
  vendido: number;
}

/** Cantidades en cero (para una orden sin matriz ni etapas). */
export function cantidadesVacias(): CantidadesOrden {
  return { pedido: 0, cortado: 0, recibido: 0, vendido: 0 };
}

/**
 * BASE DE PRORRATEO POR DEFECTO (0.061 — §Post-F9.154(b), DANIEL). Una sola constante para que el
 * fallback del cálculo, el primer costeo y el `@default` del esquema no puedan decir cosas
 * distintas. Ver la cabecera del módulo para el porqué.
 */
export const BASE_PRORRATEO_DEFAULT = 'recibido' as const satisfies BaseProrrateo;

/**
 * ⭐ QUÉ BASE SE GUARDA en un costeo (0.061). Pura, para que la regla se pueda probar sin BD.
 *
 * ⚠️ **Aquí vivía un defecto latente.** Hasta 0.061 el esquema Zod del cuerpo traía
 * `.default('cortado')` —ojo, TIEMPO PASADO: hoy ese default ya no existe—, así que `pedida` NUNCA
 * llegaba `undefined` y **un PUT que omitiera el campo PISABA la base de una orden ya costeada** y le cambiaba el costo unitario sin que nadie lo pidiera
 * (el total no se mueve; el divisor sí). Estaba documentado como decisión —«mándala siempre»— y al
 * cambiar el default a `recibido` habría dejado de ser latente: cada PUT descuidado habría reescrito
 * la base de las órdenes viejas, que es justo lo que la REGLA 0-B prohíbe.
 *
 * Hoy el campo es `.optional()` sin default y la regla es la MISMA que la de los importes:
 *  • **omitir CONSERVA** lo guardado (orden ya costeada);
 *  • en el **PRIMER** costeo (no hay nada guardado) cae a {@link BASE_PRORRATEO_DEFAULT}.
 */
export function baseProrrateoAGuardar(
  pedida: BaseProrrateo | undefined,
  guardada: BaseProrrateo | undefined | null,
): BaseProrrateo {
  return pedida ?? guardada ?? BASE_PRORRATEO_DEFAULT;
}

/**
 * ⭐⭐ EL DIVISOR CONGELADO de una orden CERRADA, o `null` si hay que calcularlo en vivo (0.061 —
 * §Post-F9.154(c)).
 *
 * Devuelve un número SOLO cuando se cumplen las dos condiciones: la orden está cerrada
 * (`cerradaEn`, la verdad autoritativa) **y** su costo trae el sello del congelado (`congeladoEn` +
 * `cantidadBaseCongelada`). Con una sola no basta: una orden cerrada sin fila de costo no congeló
 * nada, y un congelado viejo de una orden REABIERTA ya no está en vigor (se conservó como historia,
 * marcado con `descongeladoEn` — D3: no se borra, se marca).
 *
 * Se congela el DIVISOR, no el unitario ya dividido: así el unitario lo sigue produciendo la misma
 * aritmética que en vivo y no puede haber dos que se separen. El `costoUnitarioCongelado` que se
 * persiste es la constancia auditable del número con el que se cerró.
 *
 * 🔑 **VIVE AQUÍ, junto a {@link cantidadDeBase}, y no en `costo-orden.ts`, a propósito.** El costo
 * unitario de una orden lo publican CINCO puertas —la ficha de costeo y la lista de costos
 * (`costo-orden.ts`), el **EDR** (`edr/edr.ts`), la columna «costo actual» del listado de modelos
 * (`modelos/modelos.ts`) y los **márgenes por pedido** (`costos/margenes.ts`)—. Al nacer, esta
 * función vivía en `costo-orden.ts` y sólo la usaban las dos de ahí: las otras seguían dividiendo
 * EN VIVO, así que una misma orden cerrada podía dar un número en su ficha y otro en el Estado de
 * Resultados. Ponerla en la casa común es lo que hace verdad la promesa del TSDoc de `CostoOrden`
 * en `schema.prisma`: que el costo de una orden cerrada no se mueve **por ningún camino**.
 *
 * ⚠️ **CUATRO la LLAMAN; el quinto la TRADUCE.** `margenes.ts` es una consulta agregada en SQL
 * crudo y no puede invocar esta función: repite la regla como un `CASE` (ver su comentario). Es la
 * única copia que existe, y por eso es la única que puede separarse de aquí sin que el compilador
 * diga nada — sus tres sutilezas (hacen falta las DOS marcas; el congelado de una orden REABIERTA
 * ya no vale; un divisor congelado de CERO se respeta como cero) están amarradas con pruebas de
 * integración propias en `costos.int.test.ts`, cada una verificada con su mutación. Quien toque ese
 * `CASE` tiene que volver a mirarlas.
 */
export function divisorCongelado(
  orden: { cerradaEn: Date | null },
  costo: { congeladoEn: Date | null; cantidadBaseCongelada: number | null } | null,
): number | null {
  if (orden.cerradaEn === null || costo === null) return null;
  if (costo.congeladoEn === null) return null;
  return costo.cantidadBaseCongelada;
}

/** Elige la cantidad de la base de prorrateo pedida. */
export function cantidadDeBase(c: CantidadesOrden, base: BaseProrrateo): number {
  return base === 'cortado' ? c.cortado : base === 'recibido' ? c.recibido : c.vendido;
}

/** Cómo se llama cada base en lenguaje del negocio (para redactar el "aún no hay…"). */
const PIEZAS_DE_LA_BASE: Record<BaseProrrateo, string> = {
  cortado: 'piezas cortadas',
  recibido: 'piezas recibidas',
  vendido: 'piezas entregadas al cliente',
};

/** Qué hace que la base llegue a tener piezas (la segunda mitad de la frase). */
const COMO_SE_LLENA_LA_BASE: Record<BaseProrrateo, string> = {
  cortado: 'se calcula al capturar el corte',
  recibido: 'se calcula cuando llegue el primer recibo de costura',
  vendido: 'se calcula al registrar la primera entrega al cliente',
};

/** El costo unitario, o el MOTIVO (con su frase) de por qué no lo hay. */
export interface UnitarioODeuda {
  /** `costoTotal ÷ cantidadBase`, o null. Sin redondear: quien lo publica aplica su `money()`. */
  costoUnitario: number | null;
  motivoSinUnitario: MotivoSinUnitario | null;
  /** La frase que la pantalla muestra en lugar del unitario; null cuando sí hay unitario. */
  textoSinUnitario: string | null;
}

/**
 * ⭐ LA REGLA ÚNICA del costo unitario y de POR QUÉ FALTA cuando falta (0.061 — §Post-F9.154(b)).
 * Pura, y la usan las **DOS** puertas (de los **CINCO** publicadores) que publican un unitario
 * **con su motivo**: `obtenerCostoOrden`/`guardarCostoOrden` y `listarCostos`. Así ninguna de las
 * dos redacta distinto de la otra.
 *
 * ⚠️ **No confundir con los PUBLICADORES del unitario, que son CINCO** (esas dos, el EDR
 * `edr/edr.ts`, el listado de modelos `modelos/modelos.ts` y los márgenes por pedido
 * `costos/margenes.ts`). Los otros tres no pasan por aquí —dividen y ya, sin frase de motivo—, pero
 * **sí** por {@link divisorCongelado}, que es lo que garantiza que una orden cerrada valga lo mismo
 * en los cinco. El censo mecánico vive en `scratchpad/borradores/0061-cruce-publicadores.py`.
 * *(Este comentario decía «DOS» a secas y se leía como si sólo hubiera dos sitios que dividen.)*
 *
 * La división entre cero YA estaba guardada antes de esta fila (los seis divisores devolvían
 * `null`): lo que faltaba era **decir por qué**. Con el default en `recibido`, una orden recién
 * cortada tiene la base en 0 hasta el primer recibo de costura, y un `null` pelón hacía que la
 * pantalla pintara «—» sin distinguir *«todavía no hay piezas recibidas»* de *«no se ha capturado el
 * costo»* o de *«no tienes permiso de ver importes»*.
 *
 * Orden de precedencia, del más accionable al menos: la BASE en 0 gana (es lo que el usuario puede
 * resolver capturando el recibo), luego la falta de costo capturado, y al final el permiso.
 *
 * `verImportes` es el permiso `consultas.ver-importes`: sin él el importe se oculta, pero el motivo
 * y la frase se siguen dando (no filtran dinero: hablan de piezas y de permisos).
 */
export function unitarioODeuda(
  costoTotal: number | null,
  cantidadBase: number,
  base: BaseProrrateo,
  verImportes: boolean,
): UnitarioODeuda {
  if (cantidadBase <= 0) {
    return {
      costoUnitario: null,
      motivoSinUnitario: 'sin-base',
      textoSinUnitario: `Aún no hay ${PIEZAS_DE_LA_BASE[base]}: el costo por prenda ${COMO_SE_LLENA_LA_BASE[base]}.`,
    };
  }
  if (costoTotal === null) {
    return {
      costoUnitario: null,
      motivoSinUnitario: 'sin-costo',
      textoSinUnitario: 'Esta orden todavía no tiene costo capturado.',
    };
  }
  if (!verImportes) {
    return {
      costoUnitario: null,
      motivoSinUnitario: 'sin-importes',
      textoSinUnitario: 'Sin permiso para ver importes.',
    };
  }
  return {
    costoUnitario: costoTotal / cantidadBase,
    motivoSinUnitario: null,
    textoSinUnitario: null,
  };
}

/** Σ de una etapa (por tipo, opcionalmente solo procesos que meten a PT) para UNA orden. */
async function totalEtapa(
  cliente: ClienteLectura,
  idOrden: number,
  tipo: TipoEtapaMovimiento,
  soloEntradaPt = false,
): Promise<number> {
  const where: Prisma.EtapaMovimientoDetWhereInput = {
    etapaMov: {
      idOrden,
      tipo,
      canceladoEn: null,
      ...(soloEntradaPt ? { tipoProceso: { generaEntradaPt: true } } : {}),
    },
  };
  const agregado = await cliente.etapaMovimientoDet.aggregate({ where, _sum: { cantidad: true } });
  return agregado._sum.cantidad ?? 0;
}

/** Σ de la matriz pedida (`OrdenLineaTalla`) de UNA orden. */
async function totalPedido(cliente: ClienteLectura, idOrden: number): Promise<number> {
  const agregado = await cliente.ordenLineaTalla.aggregate({
    where: { ordenLinea: { idOrden } },
    _sum: { cantidad: true },
  });
  return agregado._sum.cantidad ?? 0;
}

/** Cantidades derivadas de UNA orden (pedido/cortado/recibido/vendido). */
export async function cantidadesDeOrden(
  idOrden: number,
  bd?: ContextoBd,
): Promise<CantidadesOrden> {
  const cliente = clienteLectura(bd);
  const [pedido, cortado, recibido, vendido] = await Promise.all([
    totalPedido(cliente, idOrden),
    totalEtapa(cliente, idOrden, TipoEtapaMovimiento.corte),
    totalEtapa(cliente, idOrden, TipoEtapaMovimiento.recibo_maquila, true),
    totalEtapa(cliente, idOrden, TipoEtapaMovimiento.entrega_cliente),
  ]);
  return { pedido, cortado, recibido, vendido };
}

/**
 * Cantidades derivadas de un CONJUNTO de órdenes en pocas consultas agregadas (no N+1), para la lista
 * de costos. Devuelve `idOrden → CantidadesOrden` (las órdenes sin etapas quedan en 0).
 */
export async function cantidadesDeOrdenes(
  idsOrden: number[],
  bd?: ContextoBd,
): Promise<Map<number, CantidadesOrden>> {
  const resultado = new Map<number, CantidadesOrden>();
  if (idsOrden.length === 0) {
    return resultado;
  }
  const cliente = clienteLectura(bd);

  // Σ por etapa agrupando por (idEtapaMov) y luego reagrupando por orden — mismo patrón que WIP.
  const sumaPorOrden = async (
    tipo: TipoEtapaMovimiento,
    soloEntradaPt = false,
  ): Promise<Map<number, number>> => {
    const filas = await cliente.etapaMovimientoDet.groupBy({
      by: ['idEtapaMov'],
      where: {
        etapaMov: {
          idOrden: { in: idsOrden },
          tipo,
          canceladoEn: null,
          ...(soloEntradaPt ? { tipoProceso: { generaEntradaPt: true } } : {}),
        },
      },
      _sum: { cantidad: true },
    });
    const etapas = await cliente.etapaMovimiento.findMany({
      where: { id: { in: filas.map((f) => f.idEtapaMov) } },
      select: { id: true, idOrden: true },
    });
    const ordenPorEtapa = new Map(etapas.map((e) => [e.id, e.idOrden]));
    const acum = new Map<number, number>();
    for (const f of filas) {
      const idOrden = ordenPorEtapa.get(f.idEtapaMov);
      if (idOrden === undefined) continue;
      acum.set(idOrden, (acum.get(idOrden) ?? 0) + (f._sum.cantidad ?? 0));
    }
    return acum;
  };

  const pedidoFilas = await cliente.ordenLineaTalla.groupBy({
    by: ['idOrdenLinea'],
    where: { ordenLinea: { idOrden: { in: idsOrden } } },
    _sum: { cantidad: true },
  });
  const renglones = await cliente.ordenLinea.findMany({
    where: { idOrden: { in: idsOrden } },
    select: { id: true, idOrden: true },
  });
  const ordenPorRenglon = new Map(renglones.map((r) => [r.id, r.idOrden]));
  const pedido = new Map<number, number>();
  for (const f of pedidoFilas) {
    const idOrden = ordenPorRenglon.get(f.idOrdenLinea);
    if (idOrden === undefined) continue;
    pedido.set(idOrden, (pedido.get(idOrden) ?? 0) + (f._sum.cantidad ?? 0));
  }

  const [cortado, recibido, vendido] = await Promise.all([
    sumaPorOrden(TipoEtapaMovimiento.corte),
    sumaPorOrden(TipoEtapaMovimiento.recibo_maquila, true),
    sumaPorOrden(TipoEtapaMovimiento.entrega_cliente),
  ]);

  for (const id of idsOrden) {
    resultado.set(id, {
      pedido: pedido.get(id) ?? 0,
      cortado: cortado.get(id) ?? 0,
      recibido: recibido.get(id) ?? 0,
      vendido: vendido.get(id) ?? 0,
    });
  }
  return resultado;
}
