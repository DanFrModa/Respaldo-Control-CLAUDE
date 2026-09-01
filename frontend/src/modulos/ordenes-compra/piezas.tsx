import { ShoppingCart } from 'lucide-react';

import type { EstatusOrdenCompra, OcComprometida } from '@/api/tipos';
import { ChipEstado, type TonoEstado } from '@/components/dominio/ChipEstado';

/**
 * Piezas compartidas del módulo ÓRDENES DE COMPRA (F4-E2): el chip de estatus y los helpers de
 * presentación que reusan el listado, la captura y la bandeja de autorización. SOLO presentación
 * (A1): el estatus lo deriva y controla el backend; aquí únicamente se pinta. El chip usa los tonos
 * semánticos del rediseño (ChipEstado) para leerse igual que en el resto de la app.
 */

/** Etiqueta legible (es) de cada estatus de OC. */
export const ETIQUETA_ESTATUS_OC: Record<EstatusOrdenCompra, string> = {
  borrador: 'Borrador',
  pendiente_autorizacion: 'Pendiente',
  autorizada: 'Autorizada',
  recibida_parcial: 'Recibida parcial',
  recibida_total: 'Recibida total',
  cancelada: 'Cancelada',
};

/** Tono semántico por estatus (borrador apagado; pendiente atención; recibida total = ok; cancelada crítica). */
const TONO_ESTATUS: Record<EstatusOrdenCompra, TonoEstado> = {
  borrador: 'neutro',
  pendiente_autorizacion: 'warn',
  autorizada: 'info',
  recibida_parcial: 'info',
  recibida_total: 'ok',
  cancelada: 'crit',
};

/** Chip del estatus DERIVADO de una orden de compra. */
export function EstatusOcBadge({ estatus }: { estatus: EstatusOrdenCompra }): React.JSX.Element {
  return (
    <ChipEstado tono={TONO_ESTATUS[estatus]} data-testid="estatus-oc">
      {ETIQUETA_ESTATUS_OC[estatus]}
    </ChipEstado>
  );
}

/**
 * ⭐⭐⭐ **"ESTO YA ESTÁ COMPRADO", DICHO EN UN CHIP** (0.085, §Post-F9.173(a)).
 *
 * DANIEL: *"Si ya está comprado, **solo avisa que ya está comprado**… **No se puede cancelar la OC
 * en automático… eso hay que negociarlo con el proveedor.**"*
 *
 * Vive AQUÍ, en las piezas del módulo de Órdenes de Compra, y no en cada pantalla que lo usa: lo
 * pintan la receta de la orden **y** la bandeja «Recetas por liberar», y las dos tienen que leerse
 * igual. Reusa {@link ETIQUETA_ESTATUS_OC}, que ya es la única traducción de los estatus de OC —una
 * segunda tabla de nombres es como acaban diciendo «Recibida parcial» en un lado y otra cosa en el
 * otro.
 *
 * 🔴 **El ESTADO va SIEMPRE junto al folio, y no es adorno**: una OC autorizada se puede
 * des-autorizar (con el permiso de Dirección); una recibida **no**. Sin el estado, quien lee el chip
 * no sabe cuál de los dos caminos tiene enfrente.
 *
 * ⛔ **Y NO hay botón de «des-autorizar» aquí, a propósito.** Ese acto exige `compras.desautorizar`,
 * que sólo tienen Administrador y Dirección: pintárselo al comprador sería pintarle un 403
 * (§Post-F9.145(f)). La puerta que sí se le puede abrir es **la OC misma**, que él sí ve — por eso
 * `alVer`, y por eso el llamador lo pasa **sólo** si la sesión tiene `compras.ver`.
 */
export function ChipsOcComprometidas({
  ocs,
  alVer,
}: {
  ocs: readonly OcComprometida[];
  /** Llevar a las compras de esta orden. Sin él, los chips son informativos (nadie choca con 403). */
  alVer?: () => void;
}): React.JSX.Element | null {
  if (ocs.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1" data-testid="ocs-comprometidas">
      {ocs.map((o) => {
        /*
         * 🔴 `o.recibida` VIENE DEL SERVIDOR; aquí NO se deduce del estatus (hallazgo del reviewer).
         *
         * La primera versión escribía `estatus === 'recibida_parcial' || estatus ===
         * 'recibida_total'` — una **segunda implementación de `algunaRecibida`**, en otro lenguaje,
         * decidiendo qué camino se le ofrece a una persona. Es el mismo pecado que la 0.085 vino a
         * borrar al fusionar la consulta de la guarda, a tres archivos de distancia. La regla vive
         * en el dominio y viaja hecha (mismo patrón que `capturaReparable`, V1-E8h).
         */
        const titulo = o.recibida
          ? `OC #${String(o.folio)} ya recibida: ese material entró al inventario, así que ya no se des-autoriza — el camino es una devolución o un ajuste.`
          : `OC #${String(o.folio)} ${ETIQUETA_ESTATUS_OC[o.estatus].toLowerCase()}: cancelarla se negocia con el proveedor, y des-autorizarla es del perfil de Dirección.`;
        const chip = (
          <ChipEstado tono="warn" title={titulo} data-testid={`oc-comprometida-${String(o.folio)}`}>
            <ShoppingCart className="size-3" aria-hidden /> Comprado · OC {o.folio} ·{' '}
            {ETIQUETA_ESTATUS_OC[o.estatus]}
          </ChipEstado>
        );
        return alVer === undefined ? (
          <span key={o.idOrdenCompra}>{chip}</span>
        ) : (
          <button
            key={o.idOrdenCompra}
            type="button"
            className="cursor-pointer"
            onClick={alVer}
            title={`${titulo} Clic para ver las compras de esta orden.`}
          >
            {chip}
          </button>
        );
      })}
    </span>
  );
}

/** Formatea una fecha date-only `YYYY-MM-DD` como "13 jun 2026" sin desfase de zona. */
export function fechaCortaOc(valor: string | null): string {
  if (valor === null) {
    return '—';
  }
  const [a, m, d] = valor.split('-').map(Number);
  if (a === undefined || m === undefined || d === undefined) {
    return '—';
  }
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Descripción legible del material de un renglón (tela / avío / libre).
 *
 * ⭐⭐ V1-E3u (§Post-F9.89) — **y el COLOR, cuando el renglón lo trae.** Es el mismo texto que el
 * impreso le manda al proveedor (`impreso-orden-compra.ts`), y tiene que serlo: si el papel dice
 * *"Felpa 280 · Marino Alsa"* y la pantalla dice *"Felpa 280"* a secas, quien recibe está
 * comparando la factura contra una OC que en pantalla no dice de qué color era — que es
 * exactamente la fricción que esta etapa vino a quitar. Sin color se lee igual que siempre.
 */
export function descripcionMaterial(linea: {
  tela: string | null;
  telaColor?: string | null;
  avio: string | null;
  colorAvio?: string | null;
  descripcionLibre: string | null;
}): string {
  if (linea.tela !== null) {
    return linea.telaColor == null || linea.telaColor === ''
      ? linea.tela
      : `${linea.tela} · ${linea.telaColor}`;
  }
  // ⭐⭐ V1-E8c (§Post-F9.126) — **y el COLOR del avío**, por la misma razón que el de la tela:
  // desde esta etapa el cierre se compra POR COLOR, así que cuatro renglones del mismo cierre se
  // leerían idénticos sin él. Daniel lo pidió con estas palabras: *"poner 4 veces el cierre y en la
  // descripción del avío ponerle el color"*.
  if (linea.avio !== null) {
    return linea.colorAvio == null || linea.colorAvio === ''
      ? linea.avio
      : `${linea.avio} · ${linea.colorAvio}`;
  }
  return linea.descripcionLibre ?? 'Renglón sin material';
}

/**
 * Qué estatus de OC **sí** se imprimen (V1-E4e, §Post-F9.101). Espejo de presentación de
 * `ESTATUS_OC_COMPROMETIDA` del dominio, que es quien manda.
 *
 * 🔴 **Es un `Record` exhaustivo a propósito, no una cadena de `if`.** El frontend no puede importar
 * el dominio, así que esta lista es una copia — y una copia que se desincroniza en silencio es una
 * trampa: con un `if`, un estatus NUEVO caería por omisión en *"no se imprime"* y dejaría el botón
 * escondido para una OC que el servidor **sí** imprime, sin que nada avisara. Escrito como
 * `Record<EstatusOrdenCompra, boolean>` **el compilador exige decidir** para cada estatus nuevo — el
 * mismo idioma que ya usan `ETIQUETA_ESTATUS_OC` y `TONO_ESTATUS` aquí al lado, y el mismo espíritu
 * con el que `comprometido-en-oc.ts` escribe sus listas extensivas en vez de un `{ not: ... }`.
 */
const SE_IMPRIME: Record<EstatusOrdenCompra, boolean> = {
  borrador: false,
  pendiente_autorizacion: false,
  autorizada: true,
  recibida_parcial: true,
  recibida_total: true,
  cancelada: false,
};

/**
 * ⭐ **¿POR QUÉ NO SE PUEDE IMPRIMIR ESTA OC?** — `null` = sí se puede (V1-E4e, §Post-F9.101).
 *
 * Daniel: *"Nunca debe de dejar imprimir una orden que no esté autorizada… **ni aunque diga
 * borrador**. Para no generar confusiones con el proveedor."* Un papel con membrete, folio,
 * proveedor, materiales, cantidades y precios ES una orden de compra a los ojos de quien la recibe;
 * y un borrador todavía puede cambiar. La autorización es la firma: sin firma no hay papel.
 *
 * 🔴 **Esto SÓLO esconde el botón. Quien de verdad niega es el servidor** (`impreso-orden-compra.ts`,
 * §Post-F9.68: esconder Y bloquear) — con la URL a mano, un botón oculto no protege nada. Aquí vive
 * únicamente el texto que le explica al usuario por qué no lo ve, para que no quede ni un botón
 * muerto ni un error seco.
 *
 * ⚠️ **Efecto colateral declarado:** quien hoy imprima el borrador *para revisarlo en papel antes de
 * autorizar* deja de poder hacerlo. Para revisar están la pantalla de la OC y la revisión previa de
 * §Post-F9.85.
 */
export function motivoNoImprimirOc(estatus: EstatusOrdenCompra): string | null {
  if (SE_IMPRIME[estatus]) {
    return null;
  }
  if (estatus === 'cancelada') {
    return 'La orden está cancelada: ya no se manda al proveedor.';
  }
  return 'Se imprime cuando la orden esté autorizada.';
}
