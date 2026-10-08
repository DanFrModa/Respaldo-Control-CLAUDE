/**
 * ⭐⭐ **FILA 0.257 — ¿LA RECETA CAMBIÓ DESDE LA ÚLTIMA EXPLOSIÓN?**
 *
 * La previa de compra y la generación de OC compran el SNAPSHOT de la explosión
 * (`RequerimientoOrden`), no la receta viva. Medido por el reviewer de la 0.232: explotar con un
 * avío de captura contradictoria (5,300 piezas donde eran 600), corregirlo (`corregirCapturaAvio`),
 * marcarlo revisado, re-liberarlo y pedir la previa **sin re-explotar** ⇒ la OC salía por 5,300 —
 * 8.8 veces de más— con cero avisos y cero bloqueos.
 *
 * 🔴 **Por qué un CONTADOR y no una fecha que ya existía.** Comparar `liberadoEn` contra el snapshot
 * da falsos positivos (liberar re-sella también lo ya firmado, y editar SÓLO el precio revoca la
 * firma) y falsos negativos (quitar un renglón no toca ninguna firma). `modificadoEn` igual: marcar
 * revisado lo mueve, un renglón borrado desaparece del máximo. Hace falta un número que **sólo
 * suban los cambios que mueven lo que la explosión LEE**:
 *
 *  - `OrdenVersionReceta.versionReceta` — lo sube {@link marcarRecetaCambiada}, dentro de la
 *    transacción del cambio (A2).
 *  - `OrdenVersionReceta.versionExplotada` — la versión que LEYÓ la última explosión
 *    (`compras/mrp.ts`, {@link sellarVersionExplotada}).
 *
 * 🔴 **En una tabla propia (`orden_version_receta`), nunca en `ordenes`** (2ª revisión, medido por el
 * reviewer): con las columnas en `ordenes`, el sello de la explosión sostenía la fila de cada OP del
 * lote hasta el COMMIT, y contra quien escribe esas filas en otro orden —`recalcularEstadoOrdenesDe
 * Modelo` al guardar «lleva arte»— daba 8-11 deadlocks de 25. Escribir aquí sólo toma `FOR KEY SHARE`
 * sobre la orden (la FK), que no choca con un `UPDATE` que no toque su llave.
 *
 * La orden está **desfasada** cuando las dos no coinciden ({@link recetaDesfasada}); la previa lo
 * enseña como BLOQUEO y la generación lo rechaza. El remedio es un clic: volver a explotar.
 *
 * QUÉ LO SUBE (y por qué, renglón por renglón, en cada llamador):
 *  - editar consumo, `paraProduccion`, la bandera por talla (la que QUEDA, ya normalizada), las
 *    medidas por talla o el amarre del proveedor de un renglón de tela/avío **que el snapshot trae**
 *    ({@link cambiaLoQueSeCompra} + {@link estaEnElSnapshot});
 *  - corregir la captura de un avío, restaurar un renglón, quitarlo — también si el snapshot lo trae;
 *  - FIRMAR un renglón de producción que el snapshot NO trae (`liberarReceta`): es lo que le falta;
 *  - el color de compra de una tela que el snapshot trae (`asignarColorDeTela`);
 *  - la MATRIZ pedida de la orden ({@link matrizCambiaLoQueSeCompra}).
 *
 * 🔑 **La pregunta al snapshot es la que hace que todo cuadre.** Editar SÓLO el precio revoca la
 * firma; al re-firmar, el renglón sigue en el snapshot tal cual y no se sube nada. Pero si alguien
 * re-explota MIENTRAS está sin firmar, el snapshot nuevo ya no lo trae — y al firmarlo, sí se sube.
 * Y un renglón sin firmar que se edita después de explotar (el cierre que el cliente todavía no
 * autoriza) no frena la compra de lo demás: no está en ella.
 *
 *  - REASIGNAR el proveedor (o su precio) que Compras ya había asignado en la orden, si el material
 *    está en el snapshot ({@link reasignaLoQueSeCompra}): cuando nada más resuelve el proveedor, la
 *    explosión le compra a ESE, a ESE precio.
 *  - La FUSIÓN de colores, cuando repunta o descarta el color de tela de una orden cuya tela está
 *    en el snapshot (`catalogos/colores-fusion-referencias.ts`).
 *
 * QUÉ NO LO SUBE (la explosión no lo lee, o no lo lee del snapshot): precio, notas, `paraCosto`,
 * `paraPreCosto`, el complemento de la tela (la generación lo lee VIVO), el arte, las lápidas,
 * marcar revisado, abrir/cerrar la receta, re-firmar lo ya firmado y la PRIMERA asignación del
 * proveedor de Compras (el snapshot se calculó sin ella: o trae el proveedor que resolvió Desarrollo
 * o el catálogo —que esa asignación no pisa—, o lo trae «sin proveedor», omitido y a la vista).
 *
 * ⚠️ **Límite declarado:** los cambios del CATÁLOGO (genérico, medidas activas, proveedores y sus
 * precios) no ensucian a cada orden que los usa — sería un barrido sobre toda la base. Su remedio
 * es el mismo (re-explotar) y la pantalla de explosión re-explota sola al cargar.
 */
import type { Tx } from '../../comun/transaccion.js';

/** Tolerancia al comparar cantidades decimales (la misma que la receta y el MRP). */
const TOLERANCIA = 1e-6;

/**
 * ⭐⭐ fila 0.257 (2ª vuelta, H1) — NAMESPACE del candado consultivo que SERIALIZA, por orden, la
 * explosión contra los cambios que suben la versión.
 *
 * 🔴 **La carrera que tapa (medida por el reviewer con dos conexiones).** Las mutaciones deciden si
 * subir la versión preguntándole al snapshot ({@link estaEnElSnapshot}), y el snapshot que ven es el
 * COMITEADO — no el que una explosión en vuelo está reescribiendo:
 *  - R2: la orden nunca se explotó; una explosión lee el consumo 6 y escribe 600 sin confirmar; en
 *    paralelo se edita el consumo a 3 — la mutación pregunta al snapshot comiteado (vacío) y no sube
 *    nada. La explosión confirma 600 sellada con la versión 0, y al re-firmar el avío ya está en el
 *    snapshot: queda 0/0 y la previa compra 600 donde eran 300.
 *  - R3: el snapshot trae el botón; sólo se cambia el precio (revoca la firma); una explosión en
 *    vuelo lo deja fuera (no está firmado), y en paralelo se firma: `liberar` pregunta al snapshot
 *    COMITEADO —que todavía lo trae— y no sube nada. Queda 1/1 y la OC sale sin el botón.
 * Con el candado, «leer la versión → calcular → sellar» y «preguntar al snapshot → escribir → subir»
 * son atómicos uno respecto del otro para la misma orden.
 *
 * Forma de DOS claves `pg_advisory_xact_lock(int4 NAMESPACE, int4 idOrden)`. `0x52435056` son los
 * bytes de `'RCPV'` (ReCeta, Por Versión). Medido contra el repo: NO es ninguno de los namespaces
 * fijos (`20_5xx`, `20_641`, `0x52440001/2`, `0x54430001`, `0x4f524443`, `0x524f4c45535f41`); con las
 * BASES que se mezclan con la empresa (`(idEmpresa × 1 000 003) XOR 0x4f000000/0x50000000/0x51000000`)
 * la empresa tendría que valer 490.95 / 37.97 / 54.74 — ningún entero ⇒ imposible. La fórmula del
 * kardex (`idEmpresa × 1 000 003 + idAlmacen`) sólo lo alcanza con la empresa 1380 y el almacén
 * 139050, y además con un `idOrden` de segunda clave igual a su artículo: despreciable.
 *
 * ⚠️ **Advisory y NO `SELECT … FOR UPDATE` de la fila de la orden**, y es deliberado: la fila de
 * `ordenes` la escriben muchísimos caminos (recalcular el estado, el cierre, RC, EsMa…) y casi todos
 * DESPUÉS de tomar sus propios candados (el compartido del cierre, el de etapas 0x4f). Un candado de
 * fila metería a la explosión —que sólo pide `compras.ver`— en el grafo de espera de todos ellos, y
 * cualquiera que ya hubiera escrito la orden y luego pidiera éste cerraría un ciclo. El consultivo
 * con namespace propio sólo choca consigo mismo: el grafo nuevo es exactamente el de las funciones
 * de abajo.
 *
 * 🔑 **El orden, para que no haya ciclos:** cuando una transacción toma el compartido del cierre de
 * la orden ({@link exigirOrdenesAbiertas}), lo toma ANTES que éste; y ninguna transacción que
 * sostiene éste pide después el de etapas (0x4f), el del kardex, el exclusivo del cierre ni el de
 * precios. Varias órdenes ⇒ en orden de id ASCENDENTE (lo hace {@link bloquearVersionReceta}).
 */
export const NAMESPACE_LOCK_VERSION_RECETA = 0x52435056 | 0;

/**
 * Toma el candado de la versión de la receta de una o varias órdenes, en orden ASCENDENTE y sin
 * repetir. Va SIEMPRE antes de leer `versionReceta` (la explosión) o de preguntarle al snapshot (las
 * mutaciones). Es re-entrante dentro de la misma transacción (Postgres apila los advisory), así que
 * el acto en bloque puede tomarlos todos de entrada y sus llamadas internas volver a pedirlos.
 */
export async function bloquearVersionReceta(tx: Tx, idsOrden: readonly number[]): Promise<void> {
  const ids = [...new Set(idsOrden)].toSorted((a, b) => a - b);
  for (const id of ids) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_VERSION_RECETA}::int, ${id}::int)`;
  }
}

/**
 * La versión de la receta de la orden, tal como está AHORA (sin fila = 0). La explosión la lee
 * ANTES que la receta, ya bajo el candado RCPV: el orden de las lecturas deja de depender de cómo
 * reparta Prisma una consulta anidada.
 */
export async function leerVersionReceta(tx: Tx, idOrden: number): Promise<number> {
  const fila = await tx.ordenVersionReceta.findUnique({
    where: { idOrden },
    select: { versionReceta: true },
  });
  return fila?.versionReceta ?? 0;
}

/**
 * Sube la versión de la receta de la orden: *«lo que se compraría cambió»*. Va SIEMPRE dentro de la
 * transacción del cambio (A2) y bajo el candado RCPV. Upsert: la orden que todavía no tiene fila
 * estaba en 0 y pasa a 1. El `+ 1` lo hace Postgres sobre la fila (no un leer-y-escribir).
 *
 * ⚠️ Escribe `orden_version_receta`, NUNCA `ordenes`: ver el encabezado (deadlocks medidos) — y de
 * paso no mueve el `modificadoEn` de la orden, cuyo «Historial» diría que la modificó alguien que no
 * la tocó.
 */
export async function marcarRecetaCambiada(tx: Tx, idOrden: number): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO orden_version_receta (id_orden, version_receta) VALUES (${idOrden}, 1)
    ON CONFLICT (id_orden) DO UPDATE SET version_receta = orden_version_receta.version_receta + 1`;
}

/**
 * Sella el snapshot recién escrito con la versión de la receta que la explosión LEYÓ. Upsert bajo el
 * candado RCPV: si la orden no tenía fila, la versión leída fue 0 y nace `(0, leída)`.
 */
export async function sellarVersionExplotada(
  tx: Tx,
  idOrden: number,
  versionLeida: number,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO orden_version_receta (id_orden, version_receta, version_explotada)
    VALUES (${idOrden}, ${versionLeida}, ${versionLeida})
    ON CONFLICT (id_orden) DO UPDATE SET version_explotada = EXCLUDED.version_explotada`;
}

/**
 * ¿El snapshot de la última explosión de esta orden trae este material? Es lo que separa un cambio
 * que deja VIEJO lo que se va a comprar de uno que no:
 *
 *  - un renglón que el snapshot **sí** trae y cuyo contenido cambia ⇒ la compra quedó vieja;
 *  - uno que **no** trae (estaba sin firmar al explotar, o no es de producción) no está en la
 *    compra: cambiarlo no deja nada viejo — y en cuanto se FIRME, `liberarReceta` sí sube la
 *    versión, porque entonces el snapshot es el que le falta.
 *
 * 🔴 Sin esta pregunta, Desarrollo editando un cierre que el cliente todavía no autoriza (lo normal:
 * *«ya podríamos ir comprando lo demás»*, §Post-F9.72) congelaría la compra de todo lo demás.
 */
export async function estaEnElSnapshot(
  tx: Tx,
  idOrden: number,
  material: { idTela: number } | { idAvio: number },
): Promise<boolean> {
  const fila = await tx.requerimientoOrden.findFirst({
    where: { idOrden, ...material },
    select: { id: true },
  });
  return fila !== null;
}

/**
 * ¿El snapshot de esta orden ya no corresponde a su receta? Función PURA (la usan la previa y sus
 * pruebas).
 *
 *  - Explotada con otra versión ⇒ **desfasada**.
 *  - `versionRecetaExplotada` NULL (sin fila, o nunca se explotó desde la fila 0.257) **con snapshot** ⇒
 *    desfasada: es un snapshot de antes del deploy y nadie sabe contra qué receta se calculó (pide
 *    re-explotar UNA vez, que la pantalla hace sola).
 *  - NULL **sin snapshot** ⇒ no: la orden nunca se explotó, no hay nada viejo que comprar (la
 *    previa no trae nada de ella).
 */
export function recetaDesfasada(orden: {
  versionReceta: number;
  versionRecetaExplotada: number | null;
  tieneSnapshot: boolean;
}): boolean {
  if (orden.versionRecetaExplotada === null) return orden.tieneSnapshot;
  return orden.versionRecetaExplotada !== orden.versionReceta;
}

/** Lo que la explosión LEE de un renglón de tela o avío de la receta (y nada más). */
export interface LoQueSeCompraDelRenglon {
  consumoPorPrenda: number;
  paraProduccion: boolean;
  /** Amarre del proveedor de Desarrollo (`idTelaProveedor` / `idAvioProveedor`). */
  idAmarreProveedor: number | null;
  /** Sólo avíos: ¿la cantidad sale de las medidas por talla? */
  consumoPorTalla?: boolean;
  /** Sólo avíos: las medidas por talla (consumo + qué medida usa cada talla). */
  tallas?: readonly { idTalla: number; consumo: number; idAvioMedida: number | null }[];
}

/**
 * ⭐ ¿Este cambio de un renglón mueve lo que se compra? Función PURA: compara el ANTES contra el
 * DESPUÉS, no «vino en el cuerpo» — reenviar el mismo consumo no cambia nada que comprar.
 *
 * 🔴 El precio, las notas, las banderas de costo y el complemento NO están aquí a propósito: la
 * explosión no los lee del renglón. Meterlos haría que corregir un precio bloqueara la compra.
 */
export function cambiaLoQueSeCompra(
  antes: LoQueSeCompraDelRenglon,
  despues: LoQueSeCompraDelRenglon,
): boolean {
  if (Math.abs(antes.consumoPorPrenda - despues.consumoPorPrenda) > TOLERANCIA) return true;
  if (antes.paraProduccion !== despues.paraProduccion) return true;
  if (antes.idAmarreProveedor !== despues.idAmarreProveedor) return true;
  if ((antes.consumoPorTalla ?? false) !== (despues.consumoPorTalla ?? false)) return true;
  return tallasDistintas(antes.tallas ?? [], despues.tallas ?? []);
}

function tallasDistintas(
  a: readonly { idTalla: number; consumo: number; idAvioMedida: number | null }[],
  b: readonly { idTalla: number; consumo: number; idAvioMedida: number | null }[],
): boolean {
  if (a.length !== b.length) return true;
  const deB = new Map(b.map((t) => [t.idTalla, t]));
  for (const t of a) {
    const otra = deB.get(t.idTalla);
    if (otra === undefined) return true;
    if (Math.abs(t.consumo - otra.consumo) > TOLERANCIA) return true;
    if (t.idAvioMedida !== otra.idAvioMedida) return true;
  }
  return false;
}

/**
 * ⭐⭐ fila 0.257 (H2) — ¿Este cambio del proveedor que asigna COMPRAS en una orden mueve lo que
 * se compraría? Función PURA.
 *
 *  - Sin asignación previa ⇒ **no**: el snapshot se calculó sin ella. O el material ya traía el
 *    proveedor de Desarrollo o del catálogo (y esta asignación, que es el ÚLTIMO escalón, no lo
 *    pisa), o venía «sin proveedor» y la previa lo enseña como omitido, a la vista.
 *  - Con asignación previa, otro proveedor, otro precio, o quitarla ⇒ **sí**: si la explosión
 *    resolvió con ella, la previa compraría al proveedor viejo al precio viejo.
 */
export function reasignaLoQueSeCompra(
  antes: { idProveedor: number | null; precio: number | null },
  despues: { idProveedor: number | null; precio: number | null },
): boolean {
  if (antes.idProveedor === null) return false;
  if (antes.idProveedor !== despues.idProveedor) return true;
  if (antes.precio === null || despues.precio === null) return antes.precio !== despues.precio;
  return Math.abs(antes.precio - despues.precio) > TOLERANCIA;
}

/**
 * ⭐ ¿La matriz pedida cambió en lo que la explosión lee? Función PURA. Compara las piezas por
 * celda (color × talla) — el pack y el pantone no mueven ninguna cantidad de material.
 *
 * Bajar, subir o REPARTIR distinto con el mismo total cuentan: el avío por color de prenda y por
 * medida sale de cada celda, no del total (lo que la 0.232 no veía: sólo avisaba cuando la base
 * CRECÍA).
 */
export function matrizCambiaLoQueSeCompra(
  antes: readonly { idColor: number; idTalla: number; cantidad: number }[],
  despues: readonly { idColor: number; idTalla: number; cantidad: number }[],
): boolean {
  const sumar = (
    celdas: readonly { idColor: number; idTalla: number; cantidad: number }[],
  ): Map<string, number> => {
    const m = new Map<string, number>();
    for (const c of celdas) {
      if (c.cantidad === 0) continue; // una celda en cero no pide nada: es lo mismo que no estar
      const llave = `${String(c.idColor)}:${String(c.idTalla)}`;
      m.set(llave, (m.get(llave) ?? 0) + c.cantidad);
    }
    return m;
  };
  const a = sumar(antes);
  const b = sumar(despues);
  if (a.size !== b.size) return true;
  for (const [llave, cantidad] of a) {
    if (b.get(llave) !== cantidad) return true;
  }
  return false;
}
