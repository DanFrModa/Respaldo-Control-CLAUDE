/**
 * ⭐ **LA VERDAD DE "CUÁNTO DE ESTO YA ESTÁ EN UNA ORDEN DE COMPRA" — UN SOLO LUGAR**
 * (V1-E3q, §Post-F9.85).
 *
 * Daniel, probando en vivo: *"me vuelvo a meter en la pantalla y sigue apareciendo ahí los
 * elementos y me deja volver a hacerla"*. El defecto de fondo era que la explosión proponía comprar
 * lo que YA se había comprado: el snapshot de requerimientos (`RequerimientoOrden.cantidadAComprar`)
 * guarda la DEMANDA (requerido − stock) y nadie le restaba lo que ya viajaba en una OC.
 *
 * El cruce ya existía —el tablero *"qué tengo / qué falta"* (R7) lo calculaba dentro de
 * `estatusMaterialesOrden`—, pero vivía enterrado ahí. Este módulo lo SACA a una función
 * compartida para que el tablero, la explosión, la revisión previa y la generación de OC lean
 * **exactamente el mismo número**. Una segunda implementación del mismo cruce es una segunda
 * verdad, y dos verdades sobre "cuánto ya compré" es justo el defecto que esta etapa vino a cerrar.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## ⚖️ QUÉ ESTATUS DE OC CUENTAN COMO "YA COMPRADO" — la decisión, con su razón
 *
 * **Cuentan TODAS menos `cancelada`.** Es decir: `borrador`, `pendiente_autorizacion`,
 * `autorizada`, `recibida_parcial` y `recibida_total`.
 *
 * **Por qué `borrador` SÍ cuenta** (y aquí está el corazón del arreglo): la OC que genera esta
 * misma pantalla **nace en `borrador`** (`ordenes-compra.ts`, §Post-F9.85 defecto 2). Si el
 * borrador no contara, el usuario generaría la OC, volvería a la explosión, vería el renglón
 * pendiente otra vez y la generaría de nuevo — exactamente lo que Daniel vio. Un borrador es un
 * documento REAL, con folio propio, que alguien ya escribió: la pregunta que responde este módulo
 * no es *"¿ya me comprometí a pagar?"* sino *"¿este material ya está cubierto por un documento
 * vivo?"*, y un borrador lo cubre.
 *
 * **Por qué `cancelada` NO cuenta:** cancelar es la manera documentada de deshacer (D3, la OC no se
 * borra, se marca). Una OC cancelada dejó de cubrir su material y ese material tiene que volver a
 * aparecer como pendiente de comprar — si no, cancelar una compra equivocada dejaría a la orden sin
 * poder recomprar nunca.
 *
 * ⚠️ **Este criterio NO es el mismo que el del COSTO, y es a propósito.** Para costear
 * (`ultimo-precio-compra.ts`, D1/§Post-F9.48) sólo cuentan `autorizada` y `recibida_*`: ahí la
 * pregunta es *"¿qué precio pagó de verdad la empresa?"*, y un borrador todavía no es un precio
 * pagado —ni siquiera está autorizado— así que dejarlo entrar cotizaría la orden con un número que
 * nadie aprobó. Aquí la pregunta es otra: *"¿hace falta volver a comprar esto?"*. Copiar el
 * criterio del costo sin pensarlo habría dejado el defecto vivo. **Dos preguntas distintas, dos
 * criterios distintos, cada uno escrito donde se usa.**
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * A9: todo se filtra por la empresa activa (la OC y la orden de producción). D3: `recibido` sale de
 * recepciones NO reversadas (una recepción reversada deja de contar sin borrarse).
 */
import type { EstatusOrdenCompra } from '../../datos/index.js';
import type { ContextoBd } from '../../comun/transaccion.js';
import { clienteLectura } from '../../comun/transaccion.js';

/**
 * Estatus de OC que cuentan como "el material ya está cubierto por un documento vivo". Es la lista
 * COMPLETA menos `cancelada`; se escribe extensiva (y no como `{ not: 'cancelada' }`) para que
 * cualquier estatus NUEVO obligue a decidir a mano si cubre o no, en vez de colarse por omisión.
 */
export const ESTATUS_OC_QUE_CUBREN: readonly EstatusOrdenCompra[] = [
  'borrador',
  'pendiente_autorizacion',
  'autorizada',
  'recibida_parcial',
  'recibida_total',
];

/**
 * Clave estable de un material (tela XOR avío) — la MISMA en el snapshot de requerimientos, en las
 * líneas de OC y en el tablero R7. Las líneas libres (sin tela ni avío) caen en `libre`.
 */
export function claveMaterial(m: { idTela: number | null; idAvio: number | null }): string {
  if (m.idTela !== null) return `tela-${String(m.idTela)}`;
  if (m.idAvio !== null) return `avio-${String(m.idAvio)}`;
  return 'libre';
}

/** Lo que UNA orden de producción ya tiene comprado de UN material. */
export interface ComprometidoMaterial {
  /** Σ cantidades en líneas de OC que CUBREN (ver la lista de estatus de arriba). */
  enOc: number;
  /** Σ recibido por recepciones NO reversadas de esas líneas. */
  recibido: number;
  /** Nombre del material tal como lo trae la línea de OC (para las filas 'no-identificado' de R7). */
  material: string;
  idTela: number | null;
  idAvio: number | null;
}

/** Lo comprometido de un conjunto de órdenes: `idOrden → (claveMaterial → comprometido)`. */
export type ComprometidoPorOrden = Map<number, Map<string, ComprometidoMaterial>>;

/**
 * ⭐ LA función. Devuelve, por orden de producción y por material, cuánto ya está en OC y cuánto ya
 * se recibió. Lectura pura (no escribe nada): se puede llamar dentro o fuera de una transacción.
 *
 * @param idsOrden órdenes de producción a cruzar; vacío = mapa vacío (no consulta).
 */
export async function comprometidoEnOc(
  idEmpresa: number,
  idsOrden: readonly number[],
  bd?: ContextoBd,
): Promise<ComprometidoPorOrden> {
  const resultado: ComprometidoPorOrden = new Map();
  if (idsOrden.length === 0) return resultado;

  const cliente = clienteLectura(bd);
  const lineas = await cliente.ordenCompraLinea.findMany({
    where: {
      idOrden: { in: [...idsOrden] },
      // A9 + el criterio de arriba: la OC tiene que ser de esta empresa y estar VIVA.
      ordenCompra: { estatus: { in: [...ESTATUS_OC_QUE_CUBREN] }, idEmpresa },
    },
    select: {
      idOrden: true,
      idTela: true,
      idAvio: true,
      descripcionLibre: true,
      cantidad: true,
      tela: { select: { nombre: true } },
      avio: { select: { clave: true, descripcion: true } },
      recepcionLineas: {
        where: { recepcionCompra: { reversadaEn: null } },
        select: { cantidadRecibida: true },
      },
    },
  });

  for (const l of lineas) {
    if (l.idOrden === null) continue; // imposible por el `where`, pero el tipo lo permite
    const porMaterial = resultado.get(l.idOrden) ?? new Map<string, ComprometidoMaterial>();
    const clave = claveMaterial(l);
    const material =
      l.tela?.nombre ??
      (l.avio === null
        ? (l.descripcionLibre ?? '(libre)')
        : `${l.avio.clave} — ${l.avio.descripcion}`);
    const acum = porMaterial.get(clave) ?? {
      enOc: 0,
      recibido: 0,
      material,
      idTela: l.idTela,
      idAvio: l.idAvio,
    };
    acum.enOc += Number(l.cantidad);
    acum.recibido += l.recepcionLineas.reduce((s, r) => s + Number(r.cantidadRecibida), 0);
    porMaterial.set(clave, acum);
    resultado.set(l.idOrden, porMaterial);
  }

  return resultado;
}

/** Lo comprometido de UN material en UNA orden (0/0 si no hay nada). */
export function comprometidoDe(
  mapa: ComprometidoPorOrden,
  idOrden: number,
  material: { idTela: number | null; idAvio: number | null },
): { enOc: number; recibido: number } {
  const fila = mapa.get(idOrden)?.get(claveMaterial(material));
  return { enOc: fila?.enOc ?? 0, recibido: fila?.recibido ?? 0 };
}
