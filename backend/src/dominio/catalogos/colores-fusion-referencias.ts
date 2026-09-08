/**
 * ⭐⭐ **QUÉ CUELGA DE UN COLOR, Y QUÉ HACE LA FUSIÓN CON CADA COSA** (fila 0.159, §Post-F9.222).
 *
 * ## La historia, porque explica el diseño
 *
 * §Post-F9.129 hizo que `fusionarColores` **se NEGARA** en cuanto el color origen se usaba fuera de
 * las telas. Era la decisión correcta con las piezas de entonces: la fusión sólo sabía mover
 * `TelaColor`, así que absorber un color usado dejaba catorce relaciones apuntando a un color
 * apagado — y una orden viva con color inactivo **ya no se podía editar**.
 *
 * 🔴 **Pero esa negativa dejó a los duplicados atrapados PARA SIEMPRE.** La primera referencia de la
 * lista era `OrdenLinea`, así que bastaba con que el color hubiera entrado a UNA orden para que no
 * se pudiera unificar nunca. Daniel lo vio en su pantalla: dos renglones,
 * «Blanco Hueso Pantone 14-0002 Tcx Pumice Stone» y «Blanco Hueso», el mismo color real, ya metidos
 * en las OP 5565/5566/5567. Y el problema **empeora solo**: cada día más órdenes usan los dos.
 *
 * ## La salida: repuntar lo que es CATÁLOGO, dejar quieto lo que es DOCUMENTO
 *
 * La negativa nunca fue el objetivo; el objetivo era **no reescribir lo que ya pasó**. Así que la
 * fusión ya no bloquea: clasifica.
 *
 *  • **`repuntar`** — lo que es CATÁLOGO o un AMARRE DERIVADO. Se mueve al canónico dentro de la
 *    misma transacción (A2). Mover un precio por color de un proveedor, o de qué color nació un
 *    modelo, es exactamente lo que la fusión afirma: *«estos dos eran el mismo color»*.
 *
 *  • **`rastro`** — lo que es DOCUMENTO o MOVIMIENTO ASENTADO. **No se toca ni una fila.** La matriz
 *    de la orden es lo que el cliente pidió (D7); el corte, el recibo, el kardex de PT y los
 *    faltantes saldados son hechos con fecha y firma (D3). Quedan apuntando al color absorbido —que
 *    sigue existiendo, sólo que apagado— y quien tiene que **comparar** colores entre documentos
 *    resuelve por el CANÓNICO (`colores-canonicos.ts`) en vez de comparar ids en crudo.
 *
 * ⚠️ **Y por eso la orden sigue siendo editable**: `sincronizarMatriz` dejó de exigir que un color YA
 * PRESENTE en la matriz esté activo. Sin ese cambio, esta clasificación reabriría el daño exacto que
 * §Post-F9.129 vino a cerrar. Van juntos, no son dos etapas.
 *
 * ## 🔴 LA LISTA DE ABAJO NO SE MANTIENE A MANO SIN RED
 *
 * Tres veces se enumeraron estas referencias y las tres se enumeraron mal (el código original miraba
 * 1; una nota de la deuda dijo 1; una revisión dijo 6). Por eso
 * `colores-fusion-referencias.test.ts` **lee `prisma/schema.prisma`** y exige que esta lista cubra
 * TODAS las relaciones entrantes de `model Color` menos `absorbidos`, con igualdad exacta (sobrar
 * también es rojo). Si mañana alguien le cuelga una FK nueva al color y no la clasifica aquí, la
 * prueba se pone **roja** en vez de dejar el hueco abierto.
 *
 * 🔴 **La única excepción, y por qué: `absorbidos`.** Es la relación REFLEXIVA de la propia fusión
 * (`idFusionadoEn`): los colores que ÉSTE se llevó. No es un uso del color, **es la contabilidad de
 * la fusión misma**. Repuntarla estaría MAL, no sólo de más: aplanaría la cadena reescribiendo un
 * hecho histórico («a A se lo llevó B» pasaría a decir «se lo llevó C»). Al fusionar B en C se forma
 * A→B→C y así se queda; `colorCanonico` la recorre entera sin necesidad de aplanarla.
 * ⚠️ Esa excepción NO se declara en este archivo, a propósito: vive como LITERAL dentro de la
 * prueba, para que ampliarla obligue a **editar la prueba**, un acto visible en el diff.
 */
import type { Prisma } from '../../datos/index.js';
import type { Tx } from '../../comun/transaccion.js';

import { bloquearModelosDelDesarrollo } from '../modelos/nomenclatura.js';

/** Qué hace la fusión con una referencia entrante de `Color`. */
export type TratoDeReferencia = 'repuntar' | 'rastro';

/** Lo que un repunte dejó hecho: cuántas filas se movieron y cuáles se DESCARTARON (con su porqué). */
export interface RepunteHecho {
  /** Filas que ahora apuntan al color canónico. */
  movidos: number;
  /**
   * Filas que NO se pudieron mover (chocaban con una llave única del destino) y se retiraron o se
   * dejaron quietas, **con sus valores**, para que la decisión quede AUDITABLE y rehacible a mano.
   */
  descartados?: Prisma.JsonObject[];
}

/** Lo que un repunte necesita saber: de qué color a qué color. */
export interface ContextoRepunte {
  idOrigen: number;
  idDestino: number;
}

/**
 * Una referencia entrante a `Color`. `relacion` es el nombre del campo de vuelta en `model Color`
 * (lo verifica la prueba contra el esquema); `etiqueta` es cómo se le dice al usuario.
 */
export interface ReferenciaDeColor {
  relacion: string;
  etiqueta: string;
  trato: TratoDeReferencia;
  /** Cuántas filas cuelgan HOY de este color. La usa la bitácora de la fusión. */
  contar: (tx: Tx, idColor: number) => Promise<number>;
  /** Mueve las filas del origen al destino. Obligatorio si `trato === 'repuntar'`, ausente si no. */
  repuntar?: (tx: Tx, contexto: ContextoRepunte) => Promise<RepunteHecho>;
}

/**
 * ⚖️ **LA REGLA DE COLISIÓN, UNA SOLA PARA LAS CUATRO TABLAS QUE SE REPUNTAN: GANA EL DESTINO.**
 *
 * Las cuatro llevan una llave única que incluye el color, así que cuando el origen **y** el destino
 * tienen fila para el mismo padre (la misma tela, el mismo proveedor, el mismo desarrollo, el mismo
 * renglón de receta) un `updateMany` a secas reventaría la fusión entera.
 *
 * Gana el del color que SE QUEDA porque el canónico es la identidad que sobrevive: conserva su id,
 * su nombre y su historia, y sus datos son parte de esa identidad. Que los del absorbido lo pisaran
 * significaría que el color sale de la fusión con el mismo nombre y **otro precio** — el cambio más
 * caro del sistema ocurriendo como efecto colateral invisible de una limpieza de catálogo.
 *
 * ⚠️ **Y nada se pierde en silencio:** lo del absorbido se escribe en la BITÁCORA antes de retirarlo,
 * así que la decisión es auditable y rehacible a mano. Tampoco se BLOQUEA por esto: bloquear
 * devolvería a Daniel al problema que esta fila viene a resolver.
 */
const PORQUE_GANA_EL_DESTINO = 'el color que se conserva ya tenía fila propia; ganan sus datos';

/**
 * Las CATORCE relaciones entrantes de `Color`, clasificadas. El orden es el del peso que tienen para
 * quien lee la bitácora: primero lo que la fusión mueve, luego lo que se queda con el rastro,
 * empezando por lo que más se ve (las órdenes) y terminando en el inventario cíclico.
 */
export const REFERENCIAS_DE_COLOR: ReferenciaDeColor[] = [
  // ───────────────────────── repuntadas: CATÁLOGO y AMARRES DERIVADOS ─────────────────────────
  {
    /**
     * LEGACY §Post-F9.11 — la liga de un color de TELA al catálogo de PRENDA, en las filas MIGRADAS.
     * Es la única que la fusión sabía mover desde F1-E6, y sigue siendo la más importante: de ella
     * cuelga el paso 1 de `casar-color-de-tela.ts` (*«la tela YA tiene ese color amarrado»*).
     */
    relacion: 'telas',
    etiqueta: 'colores de tela ligados al catálogo (legado)',
    trato: 'repuntar',
    contar: (tx, id) => tx.telaColor.count({ where: { idColor: id } }),
    repuntar: async (tx, { idOrigen, idDestino }) => {
      const delOrigen = await tx.telaColor.findMany({ where: { idColor: idOrigen } });
      if (delOrigen.length === 0) return { movidos: 0 };

      const delDestino = await tx.telaColor.findMany({
        where: { idColor: idDestino },
        select: { id: true, idTela: true, precio: true, pantone: true, precioComplemento: true },
      });
      const destinoPorTela = new Map(delDestino.map((r) => [r.idTela, r]));

      let movidos = 0;
      for (const ref of delOrigen) {
        const destino = destinoPorTela.get(ref.idTela);
        if (destino === undefined) {
          await tx.telaColor.update({ where: { id: ref.id }, data: { idColor: idDestino } });
          movidos++;
          continue;
        }
        // Colisión de la PK del puente: gana el destino, PERO se RELLENA todo dato que él tuviera
        // nulo y el origen sí traiga (§Post-F9.11: no perder un dato que sólo existía en el
        // duplicado). El renglón sobrante del origen se retira: ya no aporta nada.
        const relleno: {
          precio?: Prisma.Decimal;
          pantone?: string;
          precioComplemento?: Prisma.Decimal;
        } = {
          ...(destino.precio === null && ref.precio !== null ? { precio: ref.precio } : {}),
          ...(destino.pantone === null && ref.pantone !== null ? { pantone: ref.pantone } : {}),
          ...(destino.precioComplemento === null && ref.precioComplemento !== null
            ? { precioComplemento: ref.precioComplemento }
            : {}),
        };
        if (Object.keys(relleno).length > 0) {
          await tx.telaColor.update({ where: { id: destino.id }, data: relleno });
        }
        await tx.telaColor.delete({ where: { id: ref.id } });
        movidos++;
      }
      // Sin `descartados`: en la colisión de `TelaColor` no se pierde ningún dato — el destino se
      // queda con los suyos y ADEMÁS absorbe los que él tenía en nulo (§Post-F9.11).
      return { movidos };
    },
  },
  {
    /**
     * ⭐ fila 0.159 — EL PRECIO QUE UN PROVEEDOR COBRA POR ESE COLOR de tela (F8-E1, D13). Es
     * catálogo puro, y **la explosión lo lee para valuar**: si se quedara colgando del absorbido, la
     * OP del color canónico compraría al precio de referencia en vez del negociado — un cambio de
     * precio callado, que es justo lo que ninguna limpieza de catálogo debe provocar.
     */
    relacion: 'telaProveedorColores',
    etiqueta: 'precios por color de proveedores de tela',
    trato: 'repuntar',
    contar: (tx, id) => tx.telaProveedorColor.count({ where: { idColor: id } }),
    repuntar: async (tx, { idOrigen, idDestino }) => {
      const delOrigen = await tx.telaProveedorColor.findMany({ where: { idColor: idOrigen } });
      if (delOrigen.length === 0) return { movidos: 0 };

      const delDestino = await tx.telaProveedorColor.findMany({
        where: { idColor: idDestino },
        select: { idTelaProveedor: true, precio: true },
      });
      const destinoPorProveedor = new Map(delDestino.map((r) => [r.idTelaProveedor, r]));

      let movidos = 0;
      const descartados: Prisma.JsonObject[] = [];
      for (const ref of delOrigen) {
        const destino = destinoPorProveedor.get(ref.idTelaProveedor);
        const llave = {
          idTelaProveedor_idColor: { idTelaProveedor: ref.idTelaProveedor, idColor: idOrigen },
        };
        if (destino === undefined) {
          await tx.telaProveedorColor.update({ where: llave, data: { idColor: idDestino } });
          movidos++;
          continue;
        }
        if (destino.precio === null && ref.precio !== null) {
          // El destino no tenía precio y el duplicado sí: se rellena en vez de tirarlo.
          await tx.telaProveedorColor.update({
            where: {
              idTelaProveedor_idColor: {
                idTelaProveedor: ref.idTelaProveedor,
                idColor: idDestino,
              },
            },
            data: { precio: ref.precio },
          });
        } else if (ref.precio !== null) {
          descartados.push({
            que: 'precio por color de proveedor de tela',
            idTelaProveedor: ref.idTelaProveedor,
            precio: ref.precio.toString(),
            porQue: PORQUE_GANA_EL_DESTINO,
          });
        }
        await tx.telaProveedorColor.delete({ where: llave });
        movidos++;
      }
      return { movidos, ...(descartados.length > 0 ? { descartados } : {}) };
    },
  },
  {
    /**
     * ⭐⭐ **LOS MODELOS QUE NACIERON DE ESTE COLOR** (V1-E3, §Post-F9.172(b)) — la referencia con el
     * daño más SILENCIOSO de todas, y la razón por la que repuntarla no es opcional.
     *
     * `Modelo.idColor` es la mitad de la llave `modelos_linaje_color_unico`, la que contesta
     * *«¿este color ya tiene modelo?»*. Si el modelo se quedara colgando del color absorbido, la
     * siguiente OC del color canónico **no reconocería el modelo que existe** y estrenaría OTRO
     * número de 5 dígitos para la MISMA prenda — exactamente lo que la decisión de Daniel
     * (*«se reúsa cuando sea el mismo modelo»*) vino a impedir, y quemando un número de una serie
     * que sólo tiene 999 por par.
     *
     * ⚠️ Mover esta columna **no** cambia lo que se produce: el color de lo que se corta vive en la
     * OP (`OrdenLinea`), no aquí. Esta columna sólo dice DE QUÉ COLOR ES este modelo del catálogo, y
     * eso es precisamente lo que la fusión acaba de redefinir.
     */
    relacion: 'modelosPorColor',
    etiqueta: 'modelos de producción nacidos de este color',
    trato: 'repuntar',
    contar: (tx, id) => tx.modelo.count({ where: { idColor: id } }),
    repuntar: async (tx, { idOrigen, idDestino }) => {
      const delOrigen = await tx.modelo.findMany({
        where: { idColor: idOrigen },
        select: { id: true, codigo: true, idModeloDesarrollo: true },
        orderBy: { id: 'asc' },
      });
      if (delOrigen.length === 0) return { movidos: 0 };

      let movidos = 0;
      const descartados: Prisma.JsonObject[] = [];
      for (const modelo of delOrigen) {
        if (modelo.idModeloDesarrollo !== null) {
          // ⭐ ronda 2 — EL MISMO LOCK POR DESARROLLO que toma `obtenerODerivarModeloDeProduccion`
          // antes de mirar. Sin él, fusionar mientras alguien genera una OP del mismo desarrollo
          // choca contra `modelos_linaje_color_unico` y aborta con un P2002 crudo: seguro (A2
          // revierte la fusión entera) pero feo. Con él, una espera. Va ANTES del `findFirst`, que
          // es lo que vuelve atómico el par «¿ya hay uno del canónico?» + «muévelo».
          await bloquearModelosDelDesarrollo(tx, modelo.idModeloDesarrollo);
          // ⚠️ ¿El desarrollo YA tiene un hijo del color canónico? Entonces son DOS modelos de
          // producción para el MISMO color real, y unificarlos NO es esta operación: el número es
          // del modelo y arrastra órdenes, inventario y kardex. Se deja quieto (conserva su
          // historia) y se anota: de aquí en adelante el que se reusa es el del canónico.
          const yaHay = await tx.modelo.findFirst({
            where: { idModeloDesarrollo: modelo.idModeloDesarrollo, idColor: idDestino },
            select: { id: true, codigo: true },
          });
          if (yaHay !== null) {
            descartados.push({
              que: 'modelo de producción que se queda con el color absorbido',
              idModelo: modelo.id,
              codigo: modelo.codigo,
              chocaCon: { idModelo: yaHay.id, codigo: yaHay.codigo },
              porQue:
                'ese desarrollo ya tenía un modelo del color que se conserva; unificar dos ' +
                'modelos de producción es otra operación (el número es del modelo)',
            });
            continue;
          }
        }
        await tx.modelo.update({ where: { id: modelo.id }, data: { idColor: idDestino } });
        movidos++;
      }
      return { movidos, ...(descartados.length > 0 ? { descartados } : {}) };
    },
  },
  {
    /**
     * ⭐ V1-E3u (§Post-F9.89) — DE QUÉ COLOR DE TELA se compra este color de prenda EN ESTA ORDEN.
     *
     * Se repunta y no se deja con rastro porque **el propio módulo lo declara derivado**: quitar un
     * amarre lo BORRA (`asignarColorDeTela`: *«es un amarre derivado, no un hecho de negocio»*), y
     * lo que de verdad se pidió al proveedor vive en la línea de la OC, que sí se queda quieta.
     * Dejarlo colgando del absorbido partiría en dos la pregunta *«¿ya dije de qué color va?»*.
     */
    relacion: 'ordenTelaColores',
    etiqueta: 'colores de tela amarrados a órdenes',
    trato: 'repuntar',
    contar: (tx, id) => tx.ordenTelaColor.count({ where: { idColor: id } }),
    repuntar: async (tx, { idOrigen, idDestino }) => {
      const delOrigen = await tx.ordenTelaColor.findMany({
        where: { idColor: idOrigen },
        select: { id: true, idOrdenTela: true, idTelaColor: true },
        orderBy: { id: 'asc' },
      });
      if (delOrigen.length === 0) return { movidos: 0 };

      const delDestino = await tx.ordenTelaColor.findMany({
        where: { idColor: idDestino },
        select: { idOrdenTela: true },
      });
      const ocupados = new Set(delDestino.map((r) => r.idOrdenTela));

      let movidos = 0;
      const descartados: Prisma.JsonObject[] = [];
      for (const ref of delOrigen) {
        if (ocupados.has(ref.idOrdenTela)) {
          descartados.push({
            que: 'amarre de color de tela retirado por duplicado',
            idOrdenTela: ref.idOrdenTela,
            idTelaColor: ref.idTelaColor,
            porQue: PORQUE_GANA_EL_DESTINO,
          });
          await tx.ordenTelaColor.delete({ where: { id: ref.id } });
          continue;
        }
        await tx.ordenTelaColor.update({ where: { id: ref.id }, data: { idColor: idDestino } });
        ocupados.add(ref.idOrdenTela);
        movidos++;
      }
      return { movidos, ...(descartados.length > 0 ? { descartados } : {}) };
    },
  },

  // ─────────────── con RASTRO: documentos y movimientos asentados, no se tocan ────────────────
  {
    /**
     * 🔴 **LA MATRIZ DE LA ORDEN — la que hacía imposible fusionar, y la que NO se toca.**
     * `OrdenLinea.idColor` es lo que el cliente pidió (D7) y de ella cuelga TODA la producción: el
     * corte, el envío a maquila, el recibo, la entrega y el kardex de PT comparan contra estos ids.
     * Reescribirla movería la matriz y dejaría los movimientos apuntando a otro lado — incoherentes
     * entre sí, que es el daño exacto que §Post-F9.129 describía. Y con packs hay algo peor: una
     * orden puede tener los DOS duplicados en su matriz, así que repuntar chocaría con
     * `@@unique([idOrden, idColor, pack])` y habría que SUMAR dos renglones del pedido en uno.
     */
    relacion: 'ordenLineas',
    etiqueta: 'renglones de matriz de órdenes de producción',
    trato: 'rastro',
    contar: (tx, id) => tx.ordenLinea.count({ where: { idColor: id } }),
  },
  {
    relacion: 'etapasMovimientoDet',
    etiqueta: 'movimientos de producción (corte/envío/recibo/entrega)',
    trato: 'rastro',
    contar: (tx, id) => tx.etapaMovimientoDet.count({ where: { idColor: id } }),
  },
  {
    relacion: 'movimientosDetPt',
    etiqueta: 'movimientos de inventario de producto terminado',
    trato: 'rastro',
    contar: (tx, id) => tx.movimientoDetPt.count({ where: { idColor: id } }),
  },
  {
    /**
     * Las PIEZAS FALTANTES SALDADAS al cerrar una orden con un maquilero (fila 0.109): lo que se le
     * cobró (o se le perdonó) por color×talla. Es dinero ya asentado — D3 sin matices.
     */
    relacion: 'cierresMaquilaDet',
    etiqueta: 'faltantes saldados al cerrar órdenes con maquileros',
    trato: 'rastro',
    contar: (tx, id) => tx.cierreMaquilaOrdenDet.count({ where: { idColor: id } }),
  },
  {
    /**
     * Renglones de la matriz talla×color de una línea de OC: **un documento que ya se le mandó al
     * proveedor**. Lo que se compró se compró con ese nombre de color.
     */
    relacion: 'ordenCompraLineasTalla',
    etiqueta: 'renglones de órdenes de compra de tela',
    trato: 'rastro',
    contar: (tx, id) => tx.ordenCompraLineaTalla.count({ where: { idColor: id } }),
  },
  {
    /**
     * El color de PRENDA de una línea de OC de AVÍO (V1-E8c). Mismo criterio: es el documento del
     * proveedor. Y aquí está la trampa que la fila 0.159 tuvo que cerrar: el NETEO
     * (*«¿cuánto de esto ya está comprado?»*) cruza esta columna contra la explosión, así que
     * `comprometidoEnOc` la resuelve por el CANÓNICO — si no, después de una fusión la explosión
     * pediría otra vez lo que ya viaja en una OC.
     */
    relacion: 'ordenCompraLineasAvio',
    etiqueta: 'renglones de órdenes de compra de avío',
    trato: 'rastro',
    contar: (tx, id) => tx.ordenCompraLinea.count({ where: { idColorPrenda: id } }),
  },
  {
    /**
     * El snapshot de la explosión. No se repunta porque **se rehace entero** en cada corrida
     * (`guardarSnapshot` borra y vuelve a escribir), y desde esta fila la explosión lo escribe ya
     * con el color canónico. Repuntarlo sería arreglar algo que la siguiente corrida reescribe.
     */
    relacion: 'requerimientosAvio',
    etiqueta: 'requerimientos de avío de la explosión',
    trato: 'rastro',
    contar: (tx, id) => tx.requerimientoOrden.count({ where: { idColorPrenda: id } }),
  },
  {
    /**
     * *«Con esto queda cubierto»* (§Post-F9.99): la decisión de una PERSONA sobre un faltante. No se
     * reescribe una decisión firmada; el lector (`dado-por-cubierto.ts`) la resuelve por el canónico
     * para que siga contando después de una fusión.
     */
    relacion: 'dadosPorCubiertoAvio',
    etiqueta: 'faltantes de avío dados por cubiertos',
    trato: 'rastro',
    contar: (tx, id) => tx.requerimientoCubierto.count({ where: { idColorPrenda: id } }),
  },
  {
    relacion: 'lotes',
    etiqueta: 'lotes de tela (legado)',
    trato: 'rastro',
    contar: (tx, id) => tx.lote.count({ where: { idColor: id } }),
  },
  {
    relacion: 'inventarioCiclicoDet',
    etiqueta: 'conteos de inventario cíclico',
    trato: 'rastro',
    contar: (tx, id) => tx.inventarioCiclicoDet.count({ where: { idColor: id } }),
  },
];

/** Un uso encontrado: qué es y cuántos renglones son. */
export interface UsoDeColor {
  relacion: string;
  etiqueta: string;
  cuenta: number;
}

/**
 * Cuenta, dentro de la transacción, lo que la fusión **NO va a mover** y por lo tanto se queda
 * apuntando al color absorbido. No es una guarda: es lo que la fusión escribe en su bitácora para
 * que dentro de un año se pueda contestar *«¿qué quedó colgando de aquel color?»* sin adivinar.
 * Devuelve sólo las que tienen al menos un renglón.
 */
export async function contarUsosConRastro(tx: Tx, idColor: number): Promise<UsoDeColor[]> {
  const usos: UsoDeColor[] = [];
  for (const referencia of REFERENCIAS_DE_COLOR) {
    if (referencia.trato !== 'rastro') continue;
    const cuenta = await referencia.contar(tx, idColor);
    if (cuenta > 0) {
      usos.push({ relacion: referencia.relacion, etiqueta: referencia.etiqueta, cuenta });
    }
  }
  return usos;
}

/** Lo que el repunte completo de UN origen dejó hecho, ya agregado. */
export interface RepunteDeColor {
  movidos: number;
  descartados: Prisma.JsonObject[];
}

/**
 * Corre TODOS los repuntes de un origen hacia el destino, en el orden de
 * {@link REFERENCIAS_DE_COLOR} y dentro de la transacción de la fusión (A2: o se consolida entero o
 * no se toca nada).
 */
export async function repuntarReferenciasDeColor(
  tx: Tx,
  contexto: ContextoRepunte,
): Promise<RepunteDeColor> {
  let movidos = 0;
  const descartados: Prisma.JsonObject[] = [];
  for (const referencia of REFERENCIAS_DE_COLOR) {
    if (referencia.repuntar === undefined) continue;
    const hecho = await referencia.repuntar(tx, contexto);
    movidos += hecho.movidos;
    for (const d of hecho.descartados ?? []) {
      descartados.push({ relacion: referencia.relacion, ...d });
    }
  }
  return { movidos, descartados };
}
