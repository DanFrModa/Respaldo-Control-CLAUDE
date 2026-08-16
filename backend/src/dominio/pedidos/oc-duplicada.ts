/**
 * ⭐ DEFENSA CONTRA LA DOBLE IMPORTACIÓN DE LA MISMA OC DEL CLIENTE (V1-E4 punto 1).
 *
 * Importar dos veces el mismo papel creaba EN SILENCIO un segundo pedido, una segunda OP con su nº
 * de producción, su ruta crítica y su MRP. Se descubría semanas después, CORTANDO DOBLE: cuesta
 * tela y horas de maquila reales.
 *
 * Vive aquí, y no dentro de un importador, porque hay DOS puertas de entrada —Excel (`importacion.ts`)
 * y PDF (`importacion-pdf.ts`)— y la defensa solo sirve si las dos comparten identidad, candado y
 * mensajes. Tenerla en un solo lado fue justo el hueco que quedó abierto en la primera ronda: la
 * guarda del Excel miraba `Pedido.ocCliente` y la del PDF `Orden.ocCliente`, así que una OC
 * importada por PDF se podía volver a importar por Excel sin que nada avisara.
 *
 * DÓNDE VIVE LA IDENTIDAD DE UNA OC, y por qué se miran las dos:
 *  • `Orden.ocCliente` — el nº de orden del papel, uno POR OP. El importador PDF lo escribe con el
 *    número propio de cada PDF; el Excel lo hereda del pedido al crear cada orden.
 *  • `Pedido.ocCliente` — la referencia general capturada en el Excel. El importador PDF guarda
 *    aquí la referencia general de la TANDA (que puede ser otra cosa, o nada).
 * Mirar solo una de las dos deja pasar duplicados según por qué puerta entró el original.
 *
 * NO se usa un `@@unique` de BD sobre `(cliente, ocCliente)` a propósito: esa columna llega del ETL
 * del sistema viejo, donde el número de OC NO estaba controlado (hay repetidos y vacíos), así que un
 * unique tumbaría la migración. El candado + la re-verificación DENTRO de la transacción dan la
 * misma garantía para lo que se captura de aquí en adelante, sin tocar el histórico.
 *
 * DOS LÍMITES CONOCIDOS, los dos DELIBERADOS:
 *
 *  1. Un pedido CANCELADO antes de esta etapa puede conservar OPs VIVAS: hasta V1-E4, cancelar el
 *     pedido no las tocaba (es justo el defecto del punto 5). Re-importar esa OC queda bloqueada
 *     por sus órdenes, no por el pedido. La salida es cancelar esas OPs — que además es lo que
 *     debió pasar desde el principio, porque si no se siguen cortando.
 *
 *  2. En el importador de EXCEL la OC es TEXTO LIBRE que teclea el usuario, no un dato leído del
 *     papel. Si alguien reutiliza la misma referencia para dos órdenes de compra genuinamente
 *     distintas, la segunda recibe un 409. Se acepta a propósito: el falso positivo tiene salida
 *     inmediata y visible (el mensaje dice que cambie la referencia), mientras que el falso
 *     NEGATIVO —dejar pasar un duplicado real— cuesta tela y horas de maquila y no se descubre en
 *     semanas. Ante la duda, la defensa se equivoca del lado barato.
 */
import type { Tx } from '../../comun/transaccion.js';

/**
 * Namespace del `pg_advisory_xact_lock` que serializa POR CLIENTE la confirmación de una
 * importación de OC, compartido por las DOS puertas (Excel y PDF). Sin él, dos confirmaciones
 * simultáneas del mismo papel leerían ambas "todavía no existe" (READ COMMITTED) y nacerían los dos
 * pedidos duplicados.
 */
export const NAMESPACE_LOCK_IMPORTACION = 20_641;

/** Clave de comparación de un nº de OC del cliente (trim + mayúsculas; vacío = sin OC). */
export function claveOcCliente(texto: string | null | undefined): string {
  return (texto ?? '').trim().toUpperCase();
}

/** Dónde se encontró la OC ya importada (para redactar el mensaje con el documento correcto). */
export type OcExistente =
  /** Ya hay una OP viva con ese nº de orden del cliente. */
  | { donde: 'orden'; idOrden: number; folioOrden: number }
  /** Ya hay un pedido no cancelado con esa referencia de OC. */
  | { donde: 'pedido'; idPedido: number; folioPedido: number };

/** Por qué un PDF de la tanda es un DUPLICADO. */
export type DuplicadoPdf =
  /** Esa OC ya existe en la base (importación anterior, por cualquiera de las dos puertas). */
  | { origen: 'importado'; existente: OcExistente }
  /** Dos PDFs de la MISMA tanda traen el mismo nº de orden (el mismo papel subido dos veces). */
  | { origen: 'lote'; nombreArchivoPrimero: string };

/**
 * Decide, PDF por PDF y en su orden, si su nº de orden del cliente ya se importó (DOMINIO PURO —
 * lo prueba `oc-duplicada.test.ts`). Gana el duplicado contra la BASE sobre el de la tanda: es el
 * que el usuario necesita ver primero (ya hay una OP viva cortándose con ese papel).
 *
 * Un PDF sin nº de orden (no parseó, o el papel no lo trae) NUNCA es duplicado: sin identidad no
 * hay con qué compararlo, y bloquearlo por eso pararía importaciones legítimas.
 */
export function detectarDuplicadosOc(
  pdfs: readonly { nombreArchivo: string; numeroOrden: string }[],
  yaImportadas: ReadonlyMap<string, OcExistente>,
): (DuplicadoPdf | null)[] {
  const vistosEnLote = new Map<string, string>();
  return pdfs.map((pdf) => {
    const clave = claveOcCliente(pdf.numeroOrden);
    if (clave === '') return null;
    const enBd = yaImportadas.get(clave);
    if (enBd !== undefined) {
      return { origen: 'importado', existente: enBd };
    }
    const primero = vistosEnLote.get(clave);
    if (primero !== undefined) {
      return { origen: 'lote', nombreArchivoPrimero: primero };
    }
    vistosEnLote.set(clave, pdf.nombreArchivo);
    return null;
  });
}

/** Frase que nombra el documento donde ya vive esa OC ("la OP 1207" / "el pedido 34"). */
export function describirExistente(existente: OcExistente): string {
  return existente.donde === 'orden'
    ? `la OP ${String(existente.folioOrden)}`
    : `el pedido ${String(existente.folioPedido)}`;
}

/** Mensaje ÚNICO del duplicado (misma redacción en la vista previa y en el confirm). */
export function mensajeDuplicado(duplicado: DuplicadoPdf, numeroOrden: string): string {
  return duplicado.origen === 'importado'
    ? `La OC ${numeroOrden} del cliente YA se importó: nació ${describirExistente(duplicado.existente)}. No se vuelve a importar (se duplicaría la producción).`
    : `La OC ${numeroOrden} viene repetida en esta tanda (ya la trae "${duplicado.nombreArchivoPrimero}"); solo se importa una vez.`;
}

/**
 * Lee qué nº de OC del cliente YA están importados en la empresa activa (A9), mirando las DOS
 * fuentes de identidad (ver el encabezado). Devuelve un mapa clave-de-OC → dónde vive.
 *
 * NO cuentan los documentos CANCELADOS: si la importación anterior se canceló, volver a importar
 * ese papel es legítimo. La OP gana sobre el pedido cuando ambos coinciden — es el documento que de
 * verdad está produciendo, y el que el usuario tiene que ir a ver.
 */
export async function cargarOcYaImportadas(
  bd: Pick<Tx, 'orden' | 'pedido'>,
  idCliente: number,
  idEmpresa: number,
  numeros: readonly string[],
): Promise<Map<string, OcExistente>> {
  const claves = [...new Set(numeros.map(claveOcCliente))].filter((c) => c !== '');
  if (claves.length === 0) return new Map();

  // `mode: 'insensitive'` sobre el set de claves: el papel puede venir con espacios/mayúsculas
  // distintas y seguiría siendo la MISMA orden de compra.
  const [ordenes, pedidos] = await Promise.all([
    bd.orden.findMany({
      where: {
        idEmpresa,
        estado: { not: 'cancelada' },
        // La OP llega al cliente por su renglón de pedido (`Orden` no tiene FK directa al cliente).
        pedidoLinea: { pedido: { idCliente } },
        ocCliente: { in: claves, mode: 'insensitive' },
      },
      select: { id: true, folio: true, ocCliente: true },
      orderBy: { id: 'asc' },
    }),
    bd.pedido.findMany({
      where: {
        idEmpresa,
        idCliente,
        pedCancelado: false,
        ocCliente: { in: claves, mode: 'insensitive' },
      },
      select: { id: true, folio: true, ocCliente: true },
      orderBy: { id: 'asc' },
    }),
  ]);

  const mapa = new Map<string, OcExistente>();
  // Los PEDIDOS entran primero y las ÓRDENES después PISÁNDOLOS: la OP es el documento que está
  // produciendo de verdad, y es a donde hay que mandar al usuario.
  for (const pedido of pedidos) {
    const clave = claveOcCliente(pedido.ocCliente);
    if (clave !== '' && !mapa.has(clave)) {
      mapa.set(clave, { donde: 'pedido', idPedido: pedido.id, folioPedido: Number(pedido.folio) });
    }
  }
  for (const orden of ordenes) {
    const clave = claveOcCliente(orden.ocCliente);
    const previo = mapa.get(clave);
    // Se conserva la PRIMERA orden (orderBy id asc): la OP original, no la última copia.
    if (clave !== '' && previo?.donde !== 'orden') {
      mapa.set(clave, { donde: 'orden', idOrden: orden.id, folioOrden: Number(orden.folio) });
    }
  }
  return mapa;
}
