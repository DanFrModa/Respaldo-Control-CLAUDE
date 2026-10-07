/**
 * ⭐⭐ **fila 0.232 (§Post-F9.245(c)) — LA BASE DE PIEZAS DE LOS AVÍOS: `max(pedido, cortado vivo)`
 * POR CELDA color×talla.**
 *
 * **El problema.** La explosión de materiales (`compras/mrp.ts`) y la habilitación
 * (`produccion/habilitacion-orden.ts`) calculaban el requerido de avíos contra **la matriz PEDIDA**
 * de la orden, nunca contra lo cortado. Como el sobre-corte es libre (decisión (f)), una orden de
 * 100 piezas cortada en 120 dejaba **20 prendas sin avíos**: la explosión no los pedía, la
 * habilitación no los proponía para mandar al taller y, si alguien los tecleaba a mano, la pantalla
 * los rotulaba «sobre-surtido».
 *
 * **Lo que dijo Daniel:** *«casi siempre se compra ANTES de cortar; cuando se corta ya deberían de
 * estar los avíos con el maquilero»*. Por eso esto **no es un modo** («¿contra lo pedido o contra lo
 * cortado?» — eso es justo lo que él descartó): es una **SEGUNDA PASADA después de cortar**. Antes de
 * cortar, lo cortado es cero y la base es lo pedido: **nada cambia**. Después de un sobre-corte, la
 * celda sobre-cortada sube, el requerido de avíos crece, y el neteo que ya existía contra lo
 * comprado (`comprometido-en-oc.ts`) deja pendiente **exactamente la diferencia**.
 *
 * Las reglas, y por qué cada una:
 *  • **Por CELDA, no por total.** Los avíos por medida (R18) se piden por talla y los avíos se parten
 *    por color de prenda (V1-E8c): un corte que rebalancea tallas (menos CH, más M) necesita los
 *    cierres de M aunque sobren los de CH — no son intercambiables.
 *  • **Nunca baja de lo pedido** (es un `max`). El bajo-corte no reduce el requerido: el material ya
 *    se compró, y bajarlo convertiría lo comprado en «sobre-compra» de algo que sí se pidió.
 *  • Por eso es **monótono**, y eso lo hace inmune a la orden **cortada por partes**: un primer corte
 *    del 60 % no mueve nada; el extra aparece cuando lo cortado ACUMULADO rebasa la celda, sin
 *    importar en cuántos cortes.
 *  • **Sólo cortes VIVOS** (`canceladoEn = null`, D3): cancelar el corte quita el extra.
 *  • El **pack se pliega** (§Post-F9.10): el avío no sabe de tendidos, sabe de color×talla.
 *  • Los colores se **canonizan** como el resto del MRP (fila 0.159): la orden y el corte pueden
 *    nombrar un color absorbido por una fusión y su canónico; los dos lados se comparan en el mismo
 *    espacio o la celda se contaría dos veces.
 *  • **Sólo AVÍOS.** La tela sale a la orden por kardex ANTES de cortar (`registrarSalidaTelaAOrden`):
 *    si se cortó de más, la tela ya existía y ya salió. Pedir comprarla después sería pedir algo que
 *    ya se consumió.
 *
 * Una sola definición (regla de «una verdad»): la usan la explosión y la habilitación, para que lo
 * que se compra y lo que se manda al taller salgan del mismo número.
 */
import { TipoEtapaMovimiento } from '../../datos/index.js';

import type { ClienteLectura } from '../../comun/transaccion.js';
import {
  canonizarLineasDeColor,
  idCanonico,
  resolverColoresCanonicos,
} from '../catalogos/colores-canonicos.js';

/** Una talla de un renglón de la matriz: lo único que esta regla necesita leer de ella. */
interface TallaDeMatriz {
  idTalla: number;
  cantidad: number;
}

/** Un renglón de la matriz color×talla de la orden (ya en espacio CANÓNICO de color). */
interface LineaDeMatriz<T extends TallaDeMatriz> {
  idColor: number;
  tallas: readonly T[];
}

/** Llave de una celda PLEGADA (sin pack): color × talla. */
export function claveCeldaBase(idColor: number, idTalla: number): string {
  return `${String(idColor)}|${String(idTalla)}`;
}

/** Lo que devuelve {@link matrizParaAvios}: la matriz efectiva y cuántas piezas le sumó el corte. */
export interface MatrizParaAvios<L> {
  /** Los MISMOS renglones, con cada celda en `max(pedido, cortado)`. Misma forma que la entrada. */
  lineas: L[];
  /** Σ por celda de `max(0, cortado − pedido)`: las piezas que el sobre-corte agregó a la base. */
  piezasSobreCorte: number;
}

/**
 * ⭐⭐ **LA REGLA, PURA.** Recibe la matriz PEDIDA (en espacio canónico) y lo cortado vivo por celda
 * (plegado y canonizado, {@link cortadoVivoPorCelda}) y devuelve la matriz con la que se calculan
 * los avíos: cada celda en `max(pedido, cortado)`.
 *
 * Detalles que importan:
 *  • La orden puede tener **dos renglones con el mismo color** (dos packs, o dos colores fusionados
 *    en uno). La comparación es contra el pedido de la CELDA (Σ de todos sus renglones), y el extra
 *    se suma **una sola vez**, al primer renglón donde aparece la celda. Comparar renglón por renglón
 *    contaría el extra dos veces.
 *  • Una celda cortada que la orden no tiene **se ignora**: el corte la rechaza al capturar
 *    (`aplanarYValidar`), así que sólo podría venir de un histórico migrado. Se tolera, no se
 *    compensa (REGLA 0-B): no hay a qué renglón sumársela.
 *  • Sin sobre-corte devuelve los MISMOS objetos (no copias): el camino de antes de cortar —el de
 *    casi siempre— ni se entera de esta regla.
 */
export function matrizParaAvios<T extends TallaDeMatriz, L extends LineaDeMatriz<T>>(
  lineas: readonly L[],
  cortado: ReadonlyMap<string, number>,
): MatrizParaAvios<L> {
  // Lo PEDIDO por celda: la Σ de todos los renglones que la nombran.
  const pedidoPorCelda = new Map<string, number>();
  for (const linea of lineas) {
    for (const t of linea.tallas) {
      const clave = claveCeldaBase(linea.idColor, t.idTalla);
      pedidoPorCelda.set(clave, (pedidoPorCelda.get(clave) ?? 0) + t.cantidad);
    }
  }

  // El extra de cada celda: lo cortado que rebasa lo pedido (nunca negativo — la base no baja).
  const extraPorCelda = new Map<string, number>();
  let piezasSobreCorte = 0;
  for (const [clave, pedido] of pedidoPorCelda) {
    const extra = Math.max(0, (cortado.get(clave) ?? 0) - pedido);
    if (extra > 0) {
      extraPorCelda.set(clave, extra);
      piezasSobreCorte += extra;
    }
  }
  if (piezasSobreCorte === 0) {
    return { lineas: [...lineas], piezasSobreCorte: 0 };
  }

  // Se reparte cada extra en el PRIMER renglón de su celda, una sola vez.
  const yaSumado = new Set<string>();
  const salida = lineas.map((linea) => {
    let cambio = false;
    const tallas = linea.tallas.map((t) => {
      const clave = claveCeldaBase(linea.idColor, t.idTalla);
      const extra = extraPorCelda.get(clave);
      if (extra === undefined || yaSumado.has(clave)) return t;
      yaSumado.add(clave);
      cambio = true;
      return { ...t, cantidad: t.cantidad + extra };
    });
    return cambio ? { ...linea, tallas } : linea;
  });
  return { lineas: salida, piezasSobreCorte };
}

/**
 * ⭐⭐ **LO CORTADO VIVO de un lote de órdenes, por celda color×talla** — Σ de `EtapaMovimientoDet`
 * de los cortes NO cancelados (D3: nunca acumuladores, siempre la suma de los movimientos), con el
 * pack PLEGADO y el color en su CANÓNICO. UNA consulta para todo el lote (sin N+1).
 *
 * Devuelve un mapa por orden; una orden sin corte no aparece (equivale a «nada cortado»).
 *
 * No verifica permiso ni empresa: es un ayudante de lectura interno y quien lo llama ya cargó la
 * orden sellada por la empresa activa (A9).
 */
export async function cortadoVivoDeOrdenes(
  cliente: ClienteLectura,
  idsOrden: readonly number[],
): Promise<Map<number, Map<string, number>>> {
  const salida = new Map<number, Map<string, number>>();
  if (idsOrden.length === 0) return salida;
  const filas = await cliente.etapaMovimientoDet.findMany({
    where: {
      etapaMov: {
        idOrden: { in: [...idsOrden] },
        tipo: TipoEtapaMovimiento.corte,
        canceladoEn: null,
      },
    },
    select: {
      idColor: true,
      idTalla: true,
      cantidad: true,
      etapaMov: { select: { idOrden: true } },
    },
  });
  if (filas.length === 0) return salida;
  const canonicos = await resolverColoresCanonicos(
    cliente,
    filas.map((f) => f.idColor),
  );
  for (const f of filas) {
    const porCelda = salida.get(f.etapaMov.idOrden) ?? new Map<string, number>();
    const clave = claveCeldaBase(idCanonico(canonicos, f.idColor), f.idTalla);
    porCelda.set(clave, (porCelda.get(clave) ?? 0) + f.cantidad);
    salida.set(f.etapaMov.idOrden, porCelda);
  }
  return salida;
}

/** {@link cortadoVivoDeOrdenes} para UNA orden. */
export async function cortadoVivoPorCelda(
  cliente: ClienteLectura,
  idOrden: number,
): Promise<Map<string, number>> {
  return (await cortadoVivoDeOrdenes(cliente, [idOrden])).get(idOrden) ?? new Map();
}

/** Las piezas de AVÍOS de una orden, ya agregadas: el total y su desglose por talla. */
export interface PiezasDeAviosDeOrden {
  /** Σ de la matriz con cada celda en `max(pedido, cortado vivo)`. */
  total: number;
  /** La misma base, por talla (el insumo de R18). */
  porTalla: Map<number, number>;
  /** Lo que el sobre-corte sumó (Σ por celda de `max(0, cortado − pedido)`). */
  piezasSobreCorte: number;
}

/**
 * ⭐⭐ **fila 0.232 (2ª vuelta, H5 del review) — las piezas de AVÍOS de una orden, leídas de la BD.**
 * Para quien no trae la matriz cargada (la receta de la orden: la magnitud del aviso de captura y
 * la bitácora de «Corregir»). Lee la matriz con su color, la pone en espacio canónico y la sube a
 * lo cortado con la MISMA regla ({@link matrizParaAvios}) — si no, la receta y la explosión darían
 * dos cifras del mismo descuadre.
 */
export async function piezasDeAviosDeOrden(
  cliente: ClienteLectura,
  idOrden: number,
): Promise<PiezasDeAviosDeOrden> {
  const lineas = await cliente.ordenLinea.findMany({
    where: { idOrden },
    orderBy: { id: 'asc' },
    select: {
      idColor: true,
      color: { select: { nombre: true } },
      tallas: { select: { idTalla: true, cantidad: true } },
    },
  });
  const canonicos = await resolverColoresCanonicos(
    cliente,
    lineas.map((l) => l.idColor),
  );
  const base = matrizParaAvios(
    canonizarLineasDeColor(lineas, canonicos),
    await cortadoVivoPorCelda(cliente, idOrden),
  );
  const porTalla = new Map<number, number>();
  let total = 0;
  for (const linea of base.lineas) {
    for (const t of linea.tallas) {
      porTalla.set(t.idTalla, (porTalla.get(t.idTalla) ?? 0) + t.cantidad);
      total += t.cantidad;
    }
  }
  return { total, porTalla, piezasSobreCorte: base.piezasSobreCorte };
}
