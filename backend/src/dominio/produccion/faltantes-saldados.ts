/**
 * ⭐ LOS FALTANTES SALDADOS — la LECTURA de la tercera cubeta (V1, fila 0.109). Módulo pequeño y
 * SOLO LECTURA: aquí vive la única forma de preguntar *«¿cuántas piezas de este saldo ya se
 * cerraron?»*, para que las cinco puertas que hoy calculan el pendiente pregunten lo MISMO.
 *
 * ## Por qué está en su propio archivo
 *
 * El ACTO de cerrar vive en `cierre-maquila.ts` y necesita saber el pendiente, que lo derivan
 * `wip.ts` y `recibos.ts`; y esos dos necesitan saber lo saldado, que lo escribe el acto. Poner la
 * lectura con el acto habría cerrado el círculo de imports. Aquí no hay ciclo: **este módulo no
 * importa a nadie del dominio de producción**, y los otros tres lo importan a él.
 *
 * ## Qué se lee, siempre
 *
 * `CierreMaquilaOrdenDet.cantidadFaltantes` de los cierres **VIVOS** (`deshechoEn IS NULL`). Un
 * cierre deshecho deja de saldar en el mismo instante: sus piezas vuelven al pendiente. Eso es el
 * D3 aplicado a esta cubeta — el cierre no se edita ni se borra, se DESHACE, y la lectura obedece.
 *
 * La llave de las celdas es la MISMA de todo el módulo (`claveCeldaPack`, color:talla:PACK) más su
 * versión plegada (color:talla), porque el tope del recibo topa las dos (§Post-F9.10).
 */
import type { Prisma } from '../../datos/index.js';

import { type clienteLectura } from '../../comun/transaccion.js';

import { claveCeldaPack } from './packs.js';

/** Cliente de solo lectura (el singleton de Prisma o una transacción en curso). */
type ClienteLectura = ReturnType<typeof clienteLectura>;

// ── LO QUE DE VERDAD SE PUEDE SALDAR (puro: la MISMA aritmética para la vista y para el acto) ─────

/**
 * Una celda con su pendiente ya derivado (`enviado − devuelto − saldado`). El `pack` NO viaja: esta
 * cuenta se hace SIEMPRE plegando los tendidos, porque el saldo real de un color×talla es el
 * agregado (§Post-F9.10, condición (1)).
 */
export interface CeldaPendiente {
  idColor: number;
  idTalla: number;
  /** Pendiente de esa celda. **Puede ser NEGATIVO** (histórico migrado, o devoluciones sin pack). */
  pendiente: number;
}

/**
 * ⭐⭐ LAS CELDAS QUE DE VERDAD SE PUEDEN SALDAR: pliega por color×talla y se queda con las de
 * pendiente **> 0**. Es la aritmética del faltante, y existe UNA SOLA VEZ porque la usan las dos
 * caras — la que OFRECE el botón (`wip.ts::pendientePorMaquilero`) y la que ESCRIBE el cierre y el
 * descuento (`cierre-maquila.ts::derivarFaltantes`).
 *
 * 🔴 POR QUÉ NO SIRVE `totalPendiente` (la suma plana). Una celda NEGATIVA —un recibo del histórico
 * capturado en la talla equivocada, o lo devuelto sin decir de qué pack era— **compensa** dentro de
 * la suma plana y hace que los dos lados digan números distintos:
 *   • con `+5` en una talla y `−5` en otra, la suma plana es 0 y el botón NO APARECERÍA nunca,
 *     mientras el servidor sí tiene 5 piezas que saldar. Las órdenes migradas —el grueso de «la
 *     lista que nunca se vacía»— se quedarían sin poder cerrarse, que es justo lo que esta fila vino
 *     a arreglar.
 *   • con `+5` y `−3`, la suma plana dice 2 y el servidor saldaría 5: el diálogo enseñaría 2 piezas
 *     y el maquilero recibiría un descuento por 5 × precio. **Dinero.**
 * Es la misma trampa que ya cazó un reviewer en la pantalla de recibo (*«se mira `celdas`, no el
 * total»*, `AvanceProduccion.tsx`): una celda no le presta saldo a otra.
 */
export function celdasSaldables(celdas: readonly CeldaPendiente[]): CeldaPendiente[] {
  const plegado = new Map<string, CeldaPendiente>();
  for (const c of celdas) {
    const clave = `${c.idColor}:${c.idTalla}`;
    const acum = plegado.get(clave);
    if (acum === undefined) {
      plegado.set(clave, { idColor: c.idColor, idTalla: c.idTalla, pendiente: c.pendiente });
    } else {
      acum.pendiente += c.pendiente;
    }
  }
  return [...plegado.values()].filter((c) => c.pendiente > 0);
}

/** Σ de las piezas saldables — el número que la pantalla enseña y el que el servidor va a escribir. */
export function totalSaldable(celdas: readonly CeldaPendiente[]): number {
  return celdasSaldables(celdas).reduce((s, c) => s + c.pendiente, 0);
}

/**
 * Las dos agregaciones de un mismo conjunto de celdas: plegada (color:talla) y por tendido
 * (color:talla:pack). Misma forma que la `SumaCeldas` de `recibos.ts` a propósito: el tope del
 * recibo consume las dos juntas y una forma distinta obligaría a traducir en la frontera.
 */
export interface SaldosSaldados {
  /** Por color:talla — el AGREGADO de todos los packs. */
  total: Map<string, number>;
  /** Por color:talla:pack — lo saldado de cada tendido. */
  porPack: Map<string, number>;
}

/** Llave plegada (sin pack): la misma forma que usan `recibos.ts` y `wip.ts` para el agregado. */
function claveCeldaPlegada(idColor: number, idTalla: number): string {
  return `${idColor}:${idTalla}`;
}

/** `where` de los detalles de cierres VIVOS de una orden, opcionalmente por proceso y/o maquilero. */
function whereDetalles(filtros: {
  idOrden: number;
  idTipoProceso?: number | undefined;
  idMaquilero?: number | undefined;
}): Prisma.CierreMaquilaOrdenDetWhereInput {
  return {
    cierre: {
      idOrden: filtros.idOrden,
      deshechoEn: null,
      ...(filtros.idTipoProceso === undefined ? {} : { idTipoProceso: filtros.idTipoProceso }),
      ...(filtros.idMaquilero === undefined ? {} : { idMaquilero: filtros.idMaquilero }),
    },
  };
}

/**
 * FALTANTES YA SALDADOS de una orden (y opcionalmente de UN proceso y/o UN maquilero), por celda.
 * Es el tercer sumando de {@link produccion/incompletas.ts::pendientePorCelda} en las puertas que
 * trabajan por celda: el tope del recibo y el pendiente que la pantalla ofrece.
 */
export async function saldadosPorCelda(
  cliente: ClienteLectura,
  filtros: {
    idOrden: number;
    idTipoProceso?: number | undefined;
    idMaquilero?: number | undefined;
  },
): Promise<SaldosSaldados> {
  const filas = await cliente.cierreMaquilaOrdenDet.findMany({
    where: whereDetalles(filtros),
    select: { idColor: true, idTalla: true, pack: true, cantidadFaltantes: true },
  });
  const total = new Map<string, number>();
  const porPack = new Map<string, number>();
  for (const f of filas) {
    const plegada = claveCeldaPlegada(f.idColor, f.idTalla);
    total.set(plegada, (total.get(plegada) ?? 0) + f.cantidadFaltantes);
    const conPack = claveCeldaPack(f.idColor, f.idTalla, f.pack);
    porPack.set(conPack, (porPack.get(conPack) ?? 0) + f.cantidadFaltantes);
  }
  return { total, porPack };
}

/**
 * Lo mismo, pero AGRUPADO POR MAQUILERO (como `sumarCeldasPorTercero` de `wip.ts`): por cada
 * tercero, su matriz color×talla×pack de piezas saldadas. Base del desglose «por recibir POR
 * MAQUILERO», donde el que ya cerró tiene que salir en CERO y no desaparecer (su historia sigue
 * siendo parte de la trazabilidad de las cuatro cubetas).
 *
 * La llave del mapa es `number` y no `number | null` porque `CierreMaquilaOrden.idMaquilero` es
 * OBLIGATORIO: no se puede cerrar con «Sin asignar» (a nadie se le cobra un faltante sin nombre).
 */
export async function saldadosPorTercero(
  cliente: ClienteLectura,
  idOrden: number,
  idTipoProceso: number,
): Promise<Map<number, Map<string, number>>> {
  const filas = await cliente.cierreMaquilaOrdenDet.findMany({
    where: whereDetalles({ idOrden, idTipoProceso }),
    select: {
      idColor: true,
      idTalla: true,
      pack: true,
      cantidadFaltantes: true,
      cierre: { select: { idMaquilero: true } },
    },
  });
  const porTercero = new Map<number, Map<string, number>>();
  for (const f of filas) {
    const celdas = porTercero.get(f.cierre.idMaquilero) ?? new Map<string, number>();
    const clave = claveCeldaPack(f.idColor, f.idTalla, f.pack);
    celdas.set(clave, (celdas.get(clave) ?? 0) + f.cantidadFaltantes);
    porTercero.set(f.cierre.idMaquilero, celdas);
  }
  return porTercero;
}

/**
 * TOTAL de piezas saldadas por ORDEN, para un conjunto de órdenes, en UNA agregación en la base (el
 * tablero WIP lo pide para todas las filas de la página a la vez, nunca orden por orden). Las
 * órdenes sin cierres no aparecen: el llamador las proyecta con 0.
 */
export async function saldadosPorOrden(
  cliente: ClienteLectura,
  idsOrden: number[],
): Promise<Map<number, number>> {
  const totales = new Map<number, number>();
  if (idsOrden.length === 0) {
    return totales;
  }
  const filas = await cliente.cierreMaquilaOrden.findMany({
    where: { idOrden: { in: idsOrden }, deshechoEn: null },
    select: { idOrden: true, detalles: { select: { cantidadFaltantes: true } } },
  });
  for (const f of filas) {
    const suma = f.detalles.reduce((s, d) => s + d.cantidadFaltantes, 0);
    totales.set(f.idOrden, (totales.get(f.idOrden) ?? 0) + suma);
  }
  return totales;
}

/**
 * TOTAL de piezas saldadas del universo de órdenes que cumpla un `where` (el agregado del tablero
 * WIP y el Resumen operativo, que suman sobre TODO el filtro y no sobre la página). Una sola
 * agregación en la base: el detalle nunca viaja a memoria.
 */
export async function totalSaldadoDeOrdenes(
  cliente: ClienteLectura,
  where: Prisma.OrdenWhereInput,
): Promise<number> {
  const r = await cliente.cierreMaquilaOrdenDet.aggregate({
    where: { cierre: { deshechoEn: null, orden: where } },
    _sum: { cantidadFaltantes: true },
  });
  return r._sum.cantidadFaltantes ?? 0;
}
