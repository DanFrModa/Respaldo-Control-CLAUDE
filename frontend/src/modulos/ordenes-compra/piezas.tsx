import type { EstatusOrdenCompra } from '@/api/tipos';
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
  descripcionLibre: string | null;
}): string {
  if (linea.tela !== null) {
    return linea.telaColor == null || linea.telaColor === ''
      ? linea.tela
      : `${linea.tela} · ${linea.telaColor}`;
  }
  return linea.avio ?? linea.descripcionLibre ?? 'Renglón sin material';
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
