import type { DescartadoLista, MotivoNoCandidato } from '@/api/listas-precios';

/**
 * ⭐ V1-E8f (§Post-F9.128) — POR QUÉ un modelo no puede entrar a una lista, EN PALABRAS.
 *
 * Daniel se topó cuatro veces con el mismo muro y la última fue: *"Justo me sale la leyenda de que no
 * hay desarrollos disponibles"*. La regla de la casa (§Post-F9.96) dice que un aviso de "no hay X"
 * **sin decir por qué ni qué hacer ES el defecto**, así que el servidor ya clasifica cada modelo
 * descartado (`motivoNoCandidato`) y aquí se traduce ese motivo a lo que el usuario tiene que leer:
 * qué le pasa a ese modelo y cuál es el siguiente paso, con el nombre del acto ("Congelar versión"),
 * no una generalidad.
 *
 * El reparto es el de siempre: la LÓGICA la decide el dominio (A1), la REDACCIÓN vive en la UI —
 * igual que el estado derivado del desarrollo y sus etiquetas.
 */

/** Cómo se presenta cada motivo: encabezado del grupo y qué hacer al respecto. */
export const TEXTO_MOTIVO_NO_CANDIDATO: Record<
  MotivoNoCandidato,
  { titulo: string; remedio: string; conteo: (cuantos: number) => string }
> = {
  'precosto-borrador': {
    titulo: 'Su precosto sigue en BORRADOR',
    remedio: 'Ábrelo en «Precosto» y usa «Congelar versión»: sólo una versión congelada se cotiza.',
    conteo: (n) => `${String(n)} con el precosto en borrador`,
  },
  'sin-precosto': {
    titulo: 'Todavía no tienen precosto',
    remedio: 'Ábrelos en «Precosto», genera la versión y congélala.',
    conteo: (n) => `${String(n)} sin precosto`,
  },
  'ya-en-lista': {
    titulo: 'Ya están en una lista de precios',
    remedio: 'Un modelo vive en UNA sola lista: para re-cotizarlo, ábrela y negocia ahí.',
    conteo: (n) => `${String(n)} ya en una lista`,
  },
  apagado: {
    titulo: 'Están apagados',
    remedio: 'Reactívalos en el proyecto (control «Mostrar apagados») antes de cotizarlos.',
    conteo: (n) => (n === 1 ? '1 apagado' : `${String(n)} apagados`),
  },
};

/**
 * Orden en que se muestran los grupos: primero lo que el usuario PUEDE arreglar ahora mismo (congelar
 * / precostear) y al final lo que sólo informa (ya colocado / apagado).
 */
export const ORDEN_MOTIVOS: readonly MotivoNoCandidato[] = [
  'precosto-borrador',
  'sin-precosto',
  'ya-en-lista',
  'apagado',
];

/** Un grupo de descartados que comparten motivo. */
export interface GrupoDescartados {
  motivo: MotivoNoCandidato;
  titulo: string;
  remedio: string;
  modelos: DescartadoLista[];
}

/** Agrupa los descartados por motivo, en el orden de `ORDEN_MOTIVOS` y sin grupos vacíos. */
export function agruparDescartados(descartados: readonly DescartadoLista[]): GrupoDescartados[] {
  return ORDEN_MOTIVOS.map((motivo) => ({
    motivo,
    titulo: TEXTO_MOTIVO_NO_CANDIDATO[motivo].titulo,
    remedio: TEXTO_MOTIVO_NO_CANDIDATO[motivo].remedio,
    modelos: descartados.filter((d) => d.motivo === motivo),
  })).filter((g) => g.modelos.length > 0);
}

/**
 * Cómo se nombra UN modelo descartado: su código y, cuando se conoce, el dato que vuelve el aviso
 * concreto — la versión que se quedó en borrador, o el folio de la lista donde ya está.
 */
export function etiquetaDescartado(d: DescartadoLista): string {
  const base = d.numeroCliente === null ? d.codigoModelo : `${d.codigoModelo} · ${d.numeroCliente}`;
  if (d.motivo === 'precosto-borrador' && d.versionPrecosto !== null) {
    return `${base} — v${String(d.versionPrecosto)} en borrador`;
  }
  if (d.motivo === 'ya-en-lista' && d.folioLista !== null) {
    return `${base} — lista #${String(d.folioLista)}`;
  }
  return base;
}

/**
 * RESUMEN de UNA LÍNEA, para donde no cabe la lista completa (el motivo bajo el botón «Generar lista
 * de precios» del proyecto). Dice cuántos hay de cada motivo y qué hacer con el primero — el que el
 * usuario puede arreglar ahora.
 *
 * ⚠️ Antes esto se ADIVINABA en el cliente a partir del estado derivado del desarrollo, y el propio
 * comentario admitía que en varias mezclas *"no se puede separar sin mentir"* y salía una disyunción
 * ("…o ya está en otra lista"). Ahora el motivo lo dice el servidor por modelo: se acabó la adivinanza.
 */
export function resumenSinCandidatos(descartados: readonly DescartadoLista[]): string {
  if (descartados.length === 0) {
    return 'No hay ningún modelo aquí todavía: agrega uno y congela su precosto para poder cotizarlo.';
  }
  const grupos = agruparDescartados(descartados);
  const cuenta = grupos
    .map((g) => TEXTO_MOTIVO_NO_CANDIDATO[g.motivo].conteo(g.modelos.length))
    .join(' · ');
  return `Ningún modelo disponible — ${cuenta}. ${grupos[0]?.remedio ?? ''}`.trim();
}
