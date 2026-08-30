/**
 * PRENDAS INCOMPLETAS del recibo de maquila (V1-E8k / V1-E8v; §Post-F9.136 + §Post-F9.147). El
 * módulo ÚNICO donde vive la aritmética del concepto, para que las puertas que lo tocan llamen a la
 * MISMA función y no a un resumen suyo (una copia reducida deriva antes de comitearse).
 *
 * QUÉ ES. Una prenda a la que le faltó una pieza y NUNCA se terminó de coser. No es una segunda
 * (una segunda tiene defecto pero se vende más barata): es una NO-PRENDA. Daniel exige que el
 * maquilero se la lleve de vuelta y que el sistema deje constancia de la entrega.
 *
 * ⭐ LA INVARIANTE DE LAS CUATRO CUBETAS (§Post-F9.147, DANIEL 29-ago-2026: *"siempre es
 * indispensable tener la trazabilidad completa de lo que se manda a fabricar. Si se cortan 100 y se
 * entregan 100 al maquilero, debemos de saber que paso con cada prenda despues (primers, segundas,
 * faltantes (cobradas al maquilero), o incompletas)"*):
 *
 *     enviado = primeras + segundas + faltantes + incompletas
 *
 * Las cuatro cubetas son EXCLUYENTES y suman lo enviado. `primeras`+`segundas` son las buenas
 * (`EtapaMovimientoDet.cantidad`); `incompletas` es su columna propia; el **faltante** es el
 * residuo — lo que NO volvió — y es lo único que sigue en poder del maquilero.
 *
 * LAS CINCO REGLAS DEL CONCEPTO:
 *  1. NO cuenta como producida: de 100 mandadas con 95 buenas + 5 incompletas, la orden produjo 95.
 *  2. NO entra a ningún inventario (ni primeras, ni segundas, ni un almacén aparte). Se pierden.
 *  3. NO se paga: no engorda el cargo EsMa.
 *  4. SÍ se registra y SÍ se ve, en el ESTADO DE CUENTA del maquilero, FUERA del cargo.
 *  5. ⭐ **SALE DEL TRÁNSITO** (V1-E8v): la prenda YA VOLVIÓ físicamente, así que deja de contar
 *     como pendiente de entregar. DANIEL: *"Al registrarlas como incompletas entregadas, dejan de
 *     estar en la maquila. El ya termino de entregar las 100… Pro las incompletas, ya no quedan
 *     como pendientes de entregar. Y tampoco entra al inventario…. es decir se pierden esas
 *     prendas. Pero si seria bueno saber en algun lado que esas prendas que se perdieron estan
 *     incompletas."*
 *
 * 🔴 LA REGLA 5 CORRIGE la decisión A de §Post-F9.136, que decía que el pendiente quedaba ABIERTO
 * "para cobrarle el faltante". Ese razonamiento **confundía incompleta con faltante**: el FALTANTE
 * es la prenda que nunca volvió (ésa sí queda abierta y se le cobra); la INCOMPLETA ya volvió. Toda
 * la prosa que afirmaba lo contrario quedó retirada del repo en V1-E8v.
 *
 * CÓMO SE CUMPLEN 1-3 SIN ESCRIBIR NI UNA GUARDA: las incompletas viven en su propia columna
 * (`EtapaMovimientoDet.cantidadIncompletas`), fuera de `cantidad`. Todo lo que produce, inventaría
 * o cobra —el kardex de PT, `esma/cargos.ts`, `esma/conciliacion.ts`, el EDR, los KPIs— suma
 * `cantidad` (o `cantidadPrimeras`/`cantidadSegundas`), así que las incompletas quedan fuera POR
 * CONSTRUCCIÓN, no por un filtro que alguien pueda olvidar mañana.
 *
 * LO QUE SÍ TOPAN, por la regla 5, es **el pendiente**, que desde V1-E8v es UN SOLO NÚMERO:
 * {@link pendientePorCelda}. Antes había dos —"pendiente" (enviado − buenas) y "recibible"
 * (enviado − buenas − incompletas)— y la pantalla tenía que llevar los dos; hoy son el mismo, y el
 * campo `recibible` del contrato desapareció. Lo usan, todas por esta misma función:
 *  • el tope que valida `registrarReciboMaquila` bajo lock (`produccion/recibos.ts`);
 *  • el pendiente por maquilero y por proceso del WIP (`produccion/wip.ts`);
 *  • los pendientes de la pantalla de captura (`produccion/recibos.ts::pendientesPorRecibir`);
 *  • las existencias en poder del maquilero (`produccion/wip.ts::consultarExistenciaMaquilero`);
 *  • el WIP por orden (`pendientesDerivados`), su agregado, la vista `kpi_wip` y el Resumen
 *    operativo — ésos en SQL, que no puede llamar a esta función: su fórmula lleva el comentario
 *    que apunta aquí.
 */
import type { Prisma } from '../../datos/index.js';
import { TipoEtapaMovimiento } from '../../datos/index.js';

import { type clienteLectura } from '../../comun/transaccion.js';

/** Cliente de solo lectura (el singleton de Prisma o una transacción en curso). */
type ClienteLectura = ReturnType<typeof clienteLectura>;

// ── Aritmética compartida (la MISMA función en todas las puertas) ────────────────────────────────

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
 * EL PENDIENTE de una celda color×talla: lo que se le envió menos lo que ya devolvió (buenas +
 * incompletas). Es a la vez *"lo que el maquilero todavía tiene en su taller"* y *"lo que todavía se
 * le puede recibir"* — desde V1-E8v (regla 5) son **el mismo número**, y por eso hay una sola
 * función y un solo campo en el contrato. Lo que quede aquí cuando el maquilero ya cerró su entrega
 * es el FALTANTE, que es lo que se le cobra.
 *
 * Puede salir negativo cuando el histórico migrado tiene recibos sin envío; quien lo use decide si
 * lo pisa a 0.
 */
export function pendientePorCelda(enviado: number, devuelto: number): number {
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
 * temas de pago"*, y regla 5 de §Post-F9.147: *"si seria bueno saber en algun lado que esas prendas
 * que se perdieron estan incompletas"*). Solo lectura, sin importes: **no suman ni restan al saldo**.
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
