/**
 * LA ETIQUETA DE UN CARGO EsMa, en UN solo lugar (0.114).
 *
 * Desde que Daniel puso el corte y el empaque del lado de la maquila —*«corte es parte de maquilas,
 * no de proveedores … y una maquila de empaque también»*—, un `EsMaCargo` puede colgar de un
 * `TipoProceso` (la maquila de ida y vuelta) **o** de un `servicio` de la orden (corte/empaque), y
 * exactamente uno de los dos viene lleno (CHECK `esma_cargo_proceso_o_servicio`).
 *
 * Toda pantalla que muestra un cargo necesita UNA palabra para esa columna: el estado de cuenta, su
 * PDF y su Excel, el desglosado, la cola de validación, la conciliación y el recibo de pago. Antes
 * cada sitio escribía `c.tipoProceso.nombre` por su cuenta; con el proceso ya nullable eso serían
 * SIETE copias de un `?? ''` — y siete oportunidades de que una diga «—» donde otra dice «Corte».
 * Por eso la etiqueta se redacta AQUÍ y todos la consumen (misma disciplina que `formula-saldo.ts`
 * con el saldo).
 *
 * NO lleva estado ni toca la BD: es una función pura sobre lo que el `select` ya trajo.
 */
import type { ServicioOrden } from '../../datos/index.js';

/** Cómo se llama cada SERVICIO sobre la orden en pantalla (0.114). */
const NOMBRE_SERVICIO: Record<ServicioOrden, string> = {
  corte: 'Corte',
  empaque: 'Empaque',
};

/** Lo mínimo que hay que traer del cargo para poder etiquetarlo. */
export interface CargoEtiquetable {
  /** El proceso de maquila del cargo (null si el cargo es de un servicio de la orden). */
  tipoProceso: { nombre: string } | null;
  /** El servicio de la orden del cargo (null si el cargo es de maquila). */
  servicio: ServicioOrden | null;
}

/**
 * La etiqueta de proceso de un cargo: el nombre del `TipoProceso`, o «Corte»/«Empaque» cuando el
 * cargo es un servicio sobre la orden.
 *
 * Devuelve cadena vacía sólo en el caso IMPOSIBLE (los dos NULL): el CHECK de la migración lo
 * prohíbe y el dominio siempre llena uno. Se prefiere el vacío a lanzar porque esto vive en la ruta
 * de LECTURA de seis reportes: un dato torcido no debe tumbar un estado de cuenta entero.
 */
export function etiquetaProcesoDelCargo(cargo: CargoEtiquetable): string {
  if (cargo.servicio !== null) {
    return NOMBRE_SERVICIO[cargo.servicio];
  }
  return cargo.tipoProceso?.nombre ?? '';
}
