/**
 * PRENDAS INCOMPLETAS del recibo de maquila (V1-E8k; §Post-F9.136). El módulo ÚNICO donde vive la
 * aritmética del concepto, para que las puertas que lo tocan llamen a la MISMA función y no a un
 * resumen suyo (una copia reducida deriva antes de comitearse).
 *
 * QUÉ ES. Una prenda a la que le faltó una pieza y NUNCA se terminó de coser. No es una segunda
 * (una segunda tiene defecto pero se vende más barata): es una NO-PRENDA. Daniel exige que el
 * maquilero se la lleve de vuelta —*"porque los faltantes se los cobro"*— y que el sistema deje
 * constancia de la entrega.
 *
 * LAS CUATRO REGLAS (§Post-F9.136, opción A elegida por Daniel):
 *  1. NO cuenta como producida: de 100 mandadas con 95 buenas + 5 incompletas, la orden produjo 95.
 *  2. NO entra a ningún inventario (ni primeras, ni segundas, ni un almacén aparte).
 *  3. NO se paga: no engorda el cargo EsMa.
 *  4. SÍ se registra y SÍ se ve, en el ESTADO DE CUENTA del maquilero, FUERA del cargo.
 *
 * CÓMO SE CUMPLEN 1-3 SIN ESCRIBIR NI UNA GUARDA: las incompletas viven en su propia columna
 * (`EtapaMovimientoDet.cantidadIncompletas`), fuera de `cantidad`. Todo lo que produce, inventaría
 * o cobra —el kardex de PT, `esma/cargos.ts`, `esma/conciliacion.ts`, el EDR, los KPIs, el WIP—
 * suma `cantidad` (o `cantidadPrimeras`/`cantidadSegundas`), así que las incompletas quedan fuera
 * POR CONSTRUCCIÓN, no por un filtro que alguien pueda olvidar mañana.
 *
 * LO ÚNICO QUE SÍ TOPAN es el total FÍSICAMENTE devuelto: no se pueden devolver más piezas de las
 * que salieron del taller. Ése es {@link piezasDevueltas} + {@link recibiblePorCelda}, y lo usan
 * las dos puertas de esa regla: el tope que valida `registrarReciboMaquila` bajo lock
 * (`produccion/recibos.ts`) y el pendiente que la pantalla de captura usa como referencia
 * (`pendientePorMaquilero`, `produccion/wip.ts`). ⚠️ El PENDIENTE por recibir NO se cierra con las
 * incompletas: Daniel lo necesita ABIERTO para cobrar el faltante (por eso descartó la opción B).
 */
import type { Prisma } from '../../datos/index.js';
import { TipoEtapaMovimiento } from '../../datos/index.js';

import { type clienteLectura } from '../../comun/transaccion.js';

/** Cliente de solo lectura (el singleton de Prisma o una transacción en curso). */
type ClienteLectura = ReturnType<typeof clienteLectura>;

// ── Aritmética compartida (la MISMA función en las dos puertas) ──────────────────────────────────

/** Lo mínimo que hay que leer de un detalle para saber cuántas piezas volvieron del taller. */
export interface PiezasDelDetalle {
  /** Total recibido BUENO (primeras + segundas). Es lo que produce, inventaría y se paga. */
  cantidad: number;
  /** Incompletas entregadas. NULL en corte/envío y en TODO lo migrado (Access no tenía el concepto). */
  cantidadIncompletas: number | null;
}

/**
 * Piezas FÍSICAMENTE devueltas por un renglón de recibo: las buenas MÁS las incompletas. Es la
 * única cuenta en la que las incompletas suman — porque salieron del taller y ya no están con el
 * maquilero. NO es "lo producido" (eso es `cantidad` a secas) ni "lo que se paga".
 */
export function piezasDevueltas(det: PiezasDelDetalle): number {
  return det.cantidad + (det.cantidadIncompletas ?? 0);
}

/**
 * Lo que TODAVÍA se le puede recibir a un maquilero en una celda color×talla: lo que se le envió
 * menos lo que ya devolvió (bueno + incompletas). Puede salir negativo cuando el histórico migrado
 * tiene recibos sin envío; quien lo use decide si lo pisa a 0.
 */
export function recibiblePorCelda(enviado: number, devuelto: number): number {
  return enviado - devuelto;
}

// ── Las incompletas que un maquilero entregó (regla 4: dónde se VEN) ─────────────────────────────

/** Un renglón del bloque de incompletas: una entrega concreta, con su orden y su modelo. */
export interface IncompletaEntregada {
  idRecibo: number;
  folioRecibo: number;
  fecha: string;
  idOrden: number;
  folioOrden: number;
  codigoModelo: string;
  descripcionModelo: string | null;
  tipoProceso: string;
  piezas: number;
}

/** El bloque informativo de incompletas de un maquilero: sus renglones y el total de piezas. */
export interface IncompletasBloque {
  filas: IncompletaEntregada[];
  totalPiezas: number;
}

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/**
 * PRENDAS INCOMPLETAS que un maquilero entregó en el periodo, agrupadas por recibo (regla 4 de
 * §Post-F9.136: *"sólo quisiera ver reflejado en algún lado que sí las entrego, para revisar los
 * temas de pago"*). Solo lectura, sin importes: **no suman ni restan al saldo**.
 *
 * Es la MISMA función que alimenta el estado de cuenta unificado y el desglosado (y de ahí el PDF y
 * el Excel): un resumen aparte para cada uno acabaría diciendo números distintos.
 *
 * ⚠️ Deliberadamente NO se segmenta por `conFactura`: una incompleta no es dinero, no lleva
 * factura y no pertenece a ninguno de los dos segmentos. Se muestra completa en los dos.
 *
 * ⚠️ Se filtra por la FECHA del recibo (igual que la conciliación EsMa), no por `creadoEn`: es el
 * día en que el maquilero entregó, que es de lo que se discute con él.
 *
 * ⚠️ Recibos VIVOS únicamente (`canceladoEn: null`): cancelar el recibo borra la entrega de la
 * conversación, igual que borra su cargo.
 */
export async function incompletasDeMaquilero(
  cliente: ClienteLectura,
  filtros: {
    idEmpresa: number;
    idMaquilero: number;
    desde?: string | undefined;
    hasta?: string | undefined;
  },
): Promise<IncompletasBloque> {
  const rangoFecha: Prisma.EtapaMovimientoWhereInput =
    filtros.desde === undefined && filtros.hasta === undefined
      ? {}
      : {
          fecha: {
            ...(filtros.desde === undefined ? {} : { gte: aDateColumna(filtros.desde) }),
            ...(filtros.hasta === undefined ? {} : { lte: aDateColumna(filtros.hasta) }),
          },
        };

  const recibos = await cliente.etapaMovimiento.findMany({
    where: {
      idEmpresa: filtros.idEmpresa,
      idTercero: filtros.idMaquilero,
      tipo: TipoEtapaMovimiento.recibo_maquila,
      canceladoEn: null,
      detalles: { some: { cantidadIncompletas: { gt: 0 } } },
      ...rangoFecha,
    },
    select: {
      id: true,
      folio: true,
      fecha: true,
      idOrden: true,
      orden: { select: { folio: true, modelo: { select: { codigo: true, descripcion: true } } } },
      tipoProceso: { select: { nombre: true } },
      detalles: { select: { cantidadIncompletas: true } },
    },
    orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
  });

  const filas = recibos.map((r) => ({
    idRecibo: r.id,
    folioRecibo: Number(r.folio),
    fecha: r.fecha.toISOString().slice(0, 10),
    idOrden: r.idOrden,
    folioOrden: Number(r.orden.folio),
    codigoModelo: r.orden.modelo.codigo,
    descripcionModelo: r.orden.modelo.descripcion,
    tipoProceso: r.tipoProceso?.nombre ?? '',
    piezas: r.detalles.reduce((s, d) => s + (d.cantidadIncompletas ?? 0), 0),
  }));

  return { filas, totalPiezas: filas.reduce((s, f) => s + f.piezas, 0) };
}
