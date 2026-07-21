/**
 * PRESCAN de la ventana temporal sobre los documentos de F2 (recarga limitada por fecha).
 *
 * Cuando la ventana está ACTIVA (`ETL_DESDE=YYYY-MM-DD` o `ETL_VENTANA_ANIOS`>0), el ETL solo
 * migra los pedidos/órdenes cuya fecha propia cae dentro de la ventana, con INVARIANTE de
 * cascada: NUNCA migra un hijo cuyo padre quedó fuera (pedido real u orden de un pedido
 * excluido, comentario de una orden excluida). Este prescan lee UNA vez los CSV de F2
 * (`Pedidos`/`PedidosDet`/`Ordenes`, encoding CP850 vía `leerCsv`) y arma los conjuntos de
 * claves v1 que los loaders necesitan para aplicar la ventana y la cascada SIN releer nada:
 *
 *  • `pedidosFuera` / `pedidosDetFuera`: pedidos con `FechaPedido` fuera + sus renglones.
 *  • `ordenesFuera`: órdenes con `Fecha` propia fuera O cuyo `IdPedidosDet` cuelga de un
 *    pedido excluido (cascada) — lo usan órdenes y comentarios.
 *  • `clientesEnVentana`: `IdClientes` referenciados por pedidos u órdenes DENTRO de la
 *    ventana — lo usa el loader de clientes (F1) para migrar SOLO los clientes con uso real
 *    en la ventana. (Los pedidos reales no aportan clientes: referencian al cliente vía su
 *    pedido, que ya está contemplado.)
 *
 * Regla de fechas idéntica a los loaders (`dentroVentana`): fecha nula/imparseable = DENTRO
 * (no se excluye por edad lo que no tiene fecha). Con ventana INACTIVA el prescan devuelve
 * `null` y todo migra como hoy (invariante: sin `ETL_DESDE` nada cambia).
 */
import { leerCsv, type FilaCsv } from './csv.js';
import { esIdPedidosDetVacio } from './ordenes-reglas.js';
import { parsearFechaSoloDia } from './valores.js';
import { dentroVentana, type ConfigVentana } from './ventana.js';

/** Conjuntos de claves v1 excluidas/usadas que produce el prescan (ventana ACTIVA). */
export interface PrescanVentanaF2 {
  /** `IdPedidos` cuyo `FechaPedido` quedó FUERA de la ventana. */
  pedidosFuera: Set<string>;
  /** `IdPedidosDet` cuyos pedidos padre quedaron fuera (cascada pedido → renglón). */
  pedidosDetFuera: Set<string>;
  /** `IdOrdenes` fuera: por `Fecha` propia o por cascada (su `IdPedidosDet` ∈ `pedidosDetFuera`). */
  ordenesFuera: Set<string>;
  /** `IdClientes` referenciados por pedidos u órdenes DENTRO de la ventana. */
  clientesEnVentana: Set<string>;
}

/** Fuentes crudas del prescan (inyectables para el test unitario; en real vienen de `leerCsv`). */
export interface FuentesPrescanF2 {
  pedidos: FilaCsv[];
  pedidosDet: FilaCsv[];
  ordenes: FilaCsv[];
}

/**
 * Núcleo PURO del prescan (sin disco): calcula los conjuntos a partir de las filas crudas.
 * La lógica de exclusión aquí es LA definición (los loaders clasifican con estos mismos sets).
 */
export function calcularPrescanVentanaF2(
  ventana: ConfigVentana,
  fuentes: FuentesPrescanF2,
): PrescanVentanaF2 {
  const pedidosFuera = new Set<string>();
  const clientesEnVentana = new Set<string>();

  // 1) Pedidos: fecha propia = FechaPedido. Dentro → su cliente cuenta como "usado".
  for (const f of fuentes.pedidos) {
    const idPedido = (f.IdPedidos ?? '').trim();
    const fecha = parsearFechaSoloDia(f.FechaPedido);
    if (!dentroVentana(fecha, ventana)) {
      if (idPedido !== '') pedidosFuera.add(idPedido);
      continue;
    }
    const idCliente = (f.IdClientes ?? '').trim();
    if (idCliente !== '' && idCliente !== '0') clientesEnVentana.add(idCliente);
  }

  // 2) Cascada pedido → renglón: los IdPedidosDet de pedidos fuera quedan fuera también.
  const pedidosDetFuera = new Set<string>();
  for (const f of fuentes.pedidosDet) {
    const idPedido = (f.IdPedidos ?? '').trim();
    if (!pedidosFuera.has(idPedido)) continue;
    const idDet = (f.IdPedidosDet ?? '').trim();
    if (idDet !== '') pedidosDetFuera.add(idDet);
  }

  // 3) Órdenes: fecha propia = Fecha; cascada si su IdPedidosDet cuelga de un pedido fuera.
  //    Dentro → su cliente (referencia directa IdClientes) cuenta como "usado".
  const ordenesFuera = new Set<string>();
  for (const f of fuentes.ordenes) {
    const idOrden = (f.IdOrdenes ?? '').trim();
    const fecha = parsearFechaSoloDia(f.Fecha);
    const idDet = (f.IdPedidosDet ?? '').trim();
    const cascada = !esIdPedidosDetVacio(idDet) && pedidosDetFuera.has(idDet);
    if (!dentroVentana(fecha, ventana) || cascada) {
      if (idOrden !== '') ordenesFuera.add(idOrden);
      continue;
    }
    const idCliente = (f.IdClientes ?? '').trim();
    if (idCliente !== '' && idCliente !== '0') clientesEnVentana.add(idCliente);
  }

  return { pedidosFuera, pedidosDetFuera, ordenesFuera, clientesEnVentana };
}

/**
 * Prescan desde los CSV reales (`Pedidos.csv`/`PedidosDet.csv`/`Ordenes.csv`). Devuelve `null`
 * con ventana INACTIVA (cero costo y cero cambio de comportamiento). Se calcula UNA vez por
 * corrida y se comparte entre loaders (el orquestador lo pasa; cada loader lo recalcula solo
 * si se le llama suelto, p. ej. desde clientes en F1).
 */
export function prescanVentanaF2(ventana: ConfigVentana): PrescanVentanaF2 | null {
  if (ventana.corte === null) return null;
  return calcularPrescanVentanaF2(ventana, {
    pedidos: leerCsv('Pedidos.csv'),
    pedidosDet: leerCsv('PedidosDet.csv'),
    ordenes: leerCsv('Ordenes.csv'),
  });
}
