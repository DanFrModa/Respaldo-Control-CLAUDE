/**
 * ⭐ POR QUÉ FUSIONAR UN COLOR SE **NIEGA** CUANDO YA SE USA (§Post-F9.129, ronda de corrección).
 *
 * `fusionarColores` nació en F1-E6 para depurar duplicados del catálogo migrado. Reasigna al color
 * destino las referencias de **`TelaColor`** y luego **DESACTIVA** el origen. Ese "y luego desactiva"
 * es el problema: `Color` tiene **QUINCE** relaciones entrantes y la fusión sólo mueve **una**.
 * Las otras **catorce** se quedan apuntando a un color apagado.
 *
 * Y eso no es un daño abstracto: el propio dominio impone que **una orden viva no puede apuntar a un
 * color inactivo** (`produccion/ordenes.ts`, `sincronizarMatriz`: *"El color … está desactivado; no se
 * puede usar"*). Fusionar un color que está en una orden la deja **ineditable**, y el corte, el kardex
 * de PT y las órdenes de compra quedan colgando del mismo color apagado.
 *
 * ⚠️ **QUÉ LO VOLVIÓ URGENTE.** Hasta §Post-F9.129 casi nadie tenía motivo para fusionar un color en
 * uso. Ese cambio **fabrica el motivo**: el catálogo quedó lleno de `NEGRO A`/`NEGRO B`/`NEGRO C` que
 * el mismo cambio declara *"no eran colores, eran empaques"*, y la pantalla de fusión promete que
 * *"las telas que usaban los duplicados pasan al canónico"* — **sin decir una palabra de las
 * órdenes**. El atajo estaba servido.
 *
 * ⚠️ **POR QUÉ SE BLOQUEA EN VEZ DE REASIGNAR.** Reasignar sólo `OrdenLinea` sería peor que no hacer
 * nada: `EtapaMovimientoDet` (corte/envío/recibo) y `MovimientoDetPt` (kardex de PT) cuelgan del MISMO
 * color, así que mover la matriz y dejar quietos el corte y el kardex los deja **incoherentes entre
 * sí**. Unificar de verdad las órdenes ya importadas es una **migración aparte** —irreversible, y
 * necesita la palabra de Daniel—. Entre "no hacer nada" y esa migración hay un tercer camino que **no
 * toca ni un dato**: negarse, y decir por qué.
 *
 * ⚠️ **LA LISTA DE ABAJO NO SE MANTIENE A MANO SIN RED.** Tres veces se enumeraron estas referencias y
 * las tres se enumeraron mal (el código original miraba 1; una nota de la deuda dijo 1; una revisión
 * dijo 6). Por eso `colores-fusion-referencias.test.ts` **lee `prisma/schema.prisma`** y exige que esta
 * lista cubra TODAS las relaciones entrantes de `model Color` menos las dos excluidas a propósito
 * (`telas` y `absorbidos`, ver abajo): si mañana alguien le cuelga una FK nueva al color y no la
 * agrega aquí, la prueba se pone **roja** en vez de reabrir el hueco en silencio.
 */
import type { Tx } from '../../comun/transaccion.js';

/**
 * Una referencia entrante a `Color` que la fusión **no sabe mover** y que, por lo tanto, la bloquea.
 * `relacion` es el nombre del campo de vuelta en `model Color` (lo verifica la prueba contra el
 * esquema); `etiqueta` es cómo se le dice al usuario en el mensaje de error.
 */
export interface ReferenciaBloqueante {
  relacion: string;
  etiqueta: string;
  contar: (tx: Tx, idColor: number) => Promise<number>;
}

/**
 * Las TRECE referencias entrantes de `Color` que la fusión no reasigna. Quedan fuera, a propósito, dos:
 * `telas` (= `TelaColor`, la única que sí sabe mover) y `absorbidos` (V1-E8s, §Post-F9.143: la
 * relación REFLEXIVA `idFusionadoEn`, que no es un uso del color sino la contabilidad de la propia
 * fusión — bloquear por ella impediría encadenar «A→B» y luego «B→C»). El orden es el del daño que
 * causan: primero lo que paraliza una orden viva, al final los precios.
 */
export const REFERENCIAS_QUE_BLOQUEAN_FUSION: ReferenciaBloqueante[] = [
  {
    relacion: 'ordenLineas',
    etiqueta: 'órdenes de producción',
    contar: (tx, id) => tx.ordenLinea.count({ where: { idColor: id } }),
  },
  {
    relacion: 'etapasMovimientoDet',
    etiqueta: 'movimientos de producción (corte/envío/recibo/entrega)',
    contar: (tx, id) => tx.etapaMovimientoDet.count({ where: { idColor: id } }),
  },
  {
    relacion: 'movimientosDetPt',
    etiqueta: 'movimientos de inventario de producto terminado',
    contar: (tx, id) => tx.movimientoDetPt.count({ where: { idColor: id } }),
  },
  {
    relacion: 'ordenTelaColores',
    etiqueta: 'recetas de tela de órdenes',
    contar: (tx, id) => tx.ordenTelaColor.count({ where: { idColor: id } }),
  },
  {
    relacion: 'ordenCompraLineasTalla',
    etiqueta: 'renglones de órdenes de compra de tela',
    contar: (tx, id) => tx.ordenCompraLineaTalla.count({ where: { idColor: id } }),
  },
  {
    relacion: 'ordenCompraLineasAvio',
    etiqueta: 'renglones de órdenes de compra de avío',
    contar: (tx, id) => tx.ordenCompraLinea.count({ where: { idColorPrenda: id } }),
  },
  {
    relacion: 'requerimientosAvio',
    etiqueta: 'requerimientos de avío de la explosión',
    contar: (tx, id) => tx.requerimientoOrden.count({ where: { idColorPrenda: id } }),
  },
  {
    relacion: 'dadosPorCubiertoAvio',
    etiqueta: 'faltantes de avío dados por cubiertos',
    contar: (tx, id) => tx.requerimientoCubierto.count({ where: { idColorPrenda: id } }),
  },
  {
    relacion: 'lotes',
    etiqueta: 'lotes de tela (legado)',
    contar: (tx, id) => tx.lote.count({ where: { idColor: id } }),
  },
  {
    relacion: 'inventarioCiclicoDet',
    etiqueta: 'conteos de inventario cíclico',
    contar: (tx, id) => tx.inventarioCiclicoDet.count({ where: { idColor: id } }),
  },
  {
    // ⭐⭐ V1-E3 (§Post-F9.172(b)) — LOS MODELOS QUE NACIERON DE ESTE COLOR. Es la referencia con el
    // daño más SILENCIOSO de toda la lista: `Modelo.idColor` es la mitad de la llave
    // `modelos_linaje_color_unico`, la que contesta *«¿este color ya tiene modelo?»*. Absorbido el
    // color por debajo, la siguiente OC de ese color **ya no reconocería el modelo que existe** y
    // estrenaría OTRO número de 5 dígitos para la MISMA prenda — que es exactamente lo que la
    // decisión de Daniel (*«se reúsa cuando sea el mismo modelo»*) vino a impedir. Y no lo ataja la
    // FK: la fusión no BORRA el origen, lo DESACTIVA.
    relacion: 'modelosPorColor',
    etiqueta: 'modelos de producción nacidos de este color',
    contar: (tx, id) => tx.modelo.count({ where: { idColor: id } }),
  },
  {
    // ⭐ V1 (fila 0.109) — las PIEZAS FALTANTES SALDADAS al cerrar una orden con un maquilero. Mismo
    // daño que `etapasMovimientoDet`, y con dinero encima: ese renglón es lo que se le cobró (o se
    // le perdonó) a un maquilero por color×talla, y colgado de un color apagado deja de poder
    // explicarse. La prueba de este archivo lo exigió en cuanto la relación existió.
    relacion: 'cierresMaquilaDet',
    etiqueta: 'faltantes saldados al cerrar órdenes con maquileros',
    contar: (tx, id) => tx.cierreMaquilaOrdenDet.count({ where: { idColor: id } }),
  },
  {
    relacion: 'telaProveedorColores',
    etiqueta: 'precios por color de proveedores de tela',
    contar: (tx, id) => tx.telaProveedorColor.count({ where: { idColor: id } }),
  },
];

/** Un uso encontrado: qué es y cuántos renglones son. */
export interface UsoDeColor {
  etiqueta: string;
  cuenta: number;
}

/**
 * Cuenta, dentro de la transacción, los usos del color que la fusión NO sabe mover. Devuelve sólo los
 * que tienen al menos un renglón, en el orden de {@link REFERENCIAS_QUE_BLOQUEAN_FUSION}.
 */
export async function contarUsosQueBloqueanFusion(tx: Tx, idColor: number): Promise<UsoDeColor[]> {
  const usos: UsoDeColor[] = [];
  for (const referencia of REFERENCIAS_QUE_BLOQUEAN_FUSION) {
    const cuenta = await referencia.contar(tx, idColor);
    if (cuenta > 0) usos.push({ etiqueta: referencia.etiqueta, cuenta });
  }
  return usos;
}

/**
 * El mensaje del rechazo: qué color, en qué está metido (con sus cuentas) y **cuál es el camino de
 * salida**. Se dice con letras porque quien lo lee está justo a punto de intentar el atajo malo.
 */
export function mensajeFusionBloqueada(nombreOrigen: string, usos: UsoDeColor[]): string {
  const detalle = usos.map((u) => `${String(u.cuenta)} ${u.etiqueta}`).join(', ');
  return (
    `El color "${nombreOrigen}" ya está en uso (${detalle}); fusionarlo dejaría esos registros ` +
    `apuntando a un color apagado, y las órdenes que lo usan ya no se podrían editar. ` +
    `La fusión sólo sabe mover los colores de TELA. Unificar órdenes ya importadas ` +
    `(por ejemplo los "Negro A"/"Negro B" viejos) es una migración aparte: ver §Post-F9.129.`
  );
}
