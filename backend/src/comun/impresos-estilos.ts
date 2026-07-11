/**
 * Estilos COMPARTIDOS de todos los impresos PDF (`@react-pdf/renderer`) — la identidad visual única
 * del sistema para los documentos que se imprimen/mandan (orden de producción, orden de compra,
 * estados de cuenta, EDR, reportes fiscales, etc.).
 *
 * Antes cada impreso hardcodeaba su propia paleta TEAL (`#0d9488`) y redefinía el mismo StyleSheet
 * (encabezado, tabla, pie…) — nacieron en la era teal y quedaron desalineados de la app, que ya migró
 * a la identidad VERDE del rediseño. Este módulo centraliza:
 *  • La PALETA de marca (verde pino) y los neutrales verde-templados, tomados de los tokens del
 *    frontend (`frontend/src/index.css`, tema claro — el PDF va sobre papel blanco) para que el hex NO
 *    se invente y NO se desincronice.
 *  • La escala TIPOGRÁFICA (título, sección, cuerpo, celda) y las dos fuentes (Helvetica / -Bold).
 *  • Los estilos de TABLA al espíritu de `TablaDensa` del frontend: encabezado atenuado sobre
 *    superficie secundaria (texto muted MAYÚSCULAS), numéricas a la derecha, bordes sutiles y fila de
 *    total con el realce suave de marca.
 *  • Componentes SIN JSX (con `createElement`, como los impresos) reutilizables: encabezado de
 *    documento uniforme (empresa + título + folio/fecha + línea de marca), pie con paginación
 *    "Página N de M" + fecha de generación, título de sección, banda de estado y leyenda de truncado.
 *
 * Los impresos importan de aquí y solo definen lo PROPIO (anchos de columna). El contenido, los datos y
 * los totales NO los toca este módulo: es capa 100 % visual.
 */
import { createElement as h, type ReactElement } from 'react';

import { Text, View, StyleSheet } from '@react-pdf/renderer';

// ── Paleta (identidad VERDE del rediseño — tokens de `frontend/src/index.css`, tema claro) ─────────

/**
 * Colores de la identidad. Marca = verde pino (`--brand`/`--primary` del proto). Neutrales = los
 * verde-templados del rediseño (no los grises fríos de la era teal). Semánticos = los mismos hex de la
 * app. El PDF se imprime sobre papel blanco, así que se usa SIEMPRE el tema claro.
 */
export const PALETA = {
  /** Verde de marca (`--brand` / `--primary`). Línea del encabezado, títulos de sección, membrete. */
  marca: '#0e7c47',
  /** Verde más oscuro (`--brand-hover` / `--brand-soft-fg`). Realces sobre fondo claro. */
  marcaOscura: '#0b6a3c',
  /** Verde brillante (`--brand-bright`). Detalles/acentos. */
  marcaClara: '#16a05c',
  /** Verde suave (`--brand-soft`). Fondo de énfasis (fila de total). */
  marcaSuave: '#e2f2e9',

  /** Tinta principal (`--foreground`) — casi negro verdoso. */
  tinta: '#101c16',
  /** Texto secundario (`--muted-foreground`). Etiquetas, subtítulos, encabezados de tabla. */
  muted: '#5b6b62',
  /** Texto terciario (`--faint`). Pie de página, notas tenues. */
  faint: '#8b988f',
  /** Borde sutil (`--border`). Líneas de tabla y separadores. */
  borde: '#e3e9e4',
  /** Borde marcado (`--border-strong`). */
  bordeFuerte: '#d2dbd5',
  /** Superficie secundaria (`--secondary`/`--muted`). Fondo del encabezado de tabla. */
  superficie: '#f1f5f2',

  /** Semánticos (mismos hex de la app). */
  ok: '#12864e',
  warn: '#b3790c',
  crit: '#cf3b3f',
  info: '#2b7f9e',

  blanco: '#ffffff',
} as const;

/**
 * Verde de marca en formato ARGB para `exceljs` (los exports a Excel comparten la identidad de los
 * PDFs). Se DERIVA de {@link PALETA.marca} para no mantener dos hex del mismo verde: una sola fuente de
 * verdad (`#0e7c47` → `FF0E7C47`). Los builders de Excel importan SOLO esta constante.
 */
export const ARGB_MARCA = `FF${PALETA.marca.slice(1).toUpperCase()}`;

// ── Tipografía ────────────────────────────────────────────────────────────────────────────────────

/** Las dos únicas fuentes disponibles sin registrar TTF externas (core de PDF). */
export const FUENTE = { normal: 'Helvetica', negrita: 'Helvetica-Bold' } as const;

/** Escala de tamaños (pt) uniforme para todos los impresos. */
export const TIPO = {
  /** Membrete (empresa / razón social). */
  marca: 14,
  /** Folio grande del bloque derecho. */
  folio: 16,
  /** Valor destacado del bloque derecho (maquilero, fecha…). */
  valorFuerte: 11,
  /** Título de sección. */
  seccion: 9,
  /** Cuerpo general. */
  cuerpo: 9,
  /** Celda de tabla. */
  celda: 8,
  /** Encabezado de tabla (MAYÚSCULAS atenuadas). */
  encabezadoTabla: 7.5,
  /** Etiqueta MAYÚSCULAS de campo. */
  etiqueta: 7,
  /** Subtítulo / notas. */
  subtitulo: 8,
  /** Pie de página. */
  pie: 7,
} as const;

// ── Estilos compartidos ─────────────────────────────────────────────────────────────────────────

/**
 * Estilos reutilizables. Los impresos los componen con sus propios anchos de columna en arreglos
 * (`[estilosDoc.celda, estilosDoc.celdaEncabezado, local.colNum]`): el último gana. El encabezado de
 * tabla es MAYÚSCULAS atenuadas; la fila de total lleva el verde suave de marca.
 */
export const estilosDoc = StyleSheet.create({
  // Página. El `paddingBottom` es MAYOR que el resto de márgenes para reservar la banda del pie
  // compartido (borde + 2 líneas: "Página N de M" + "Generado el…"): en documentos MULTIPÁGINA el
  // contenido de las páginas intermedias se detiene antes del pie y nunca lo cruza.
  pagina: {
    paddingTop: 34,
    paddingBottom: 52,
    paddingHorizontal: 40,
    fontFamily: FUENTE.normal,
    fontSize: TIPO.cuerpo,
    color: PALETA.tinta,
  },

  // Encabezado del documento (empresa + título + bloque derecho + línea de marca). Funciona tanto con
  // bloque derecho (folio/fecha) como sin él (el membrete queda a la izquierda ocupando el ancho).
  encabezado: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1.5,
    borderBottomColor: PALETA.marca,
    paddingBottom: 8,
    marginBottom: 14,
  },
  marca: {
    fontSize: TIPO.marca,
    fontFamily: FUENTE.negrita,
    color: PALETA.marca,
    letterSpacing: 0.2,
  },
  subtitulo: { fontSize: TIPO.subtitulo, color: PALETA.muted, marginTop: 3 },
  bloqueDerecha: { alignItems: 'flex-end' },

  // Etiqueta MAYÚSCULAS atenuada + valor fuerte (bloque derecho y campos).
  etiquetaMenor: {
    fontSize: TIPO.etiqueta,
    color: PALETA.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  valorFuerte: { fontSize: TIPO.valorFuerte, fontFamily: FUENTE.negrita, color: PALETA.tinta },
  folioValor: { fontSize: TIPO.folio, fontFamily: FUENTE.negrita, color: PALETA.tinta },

  // Banda de estado (CANCELADA, etc.).
  bandaEstado: {
    backgroundColor: PALETA.crit,
    paddingVertical: 5,
    paddingHorizontal: 9,
    marginBottom: 10,
    borderRadius: 3,
  },
  bandaEstadoTitulo: {
    fontSize: 11,
    fontFamily: FUENTE.negrita,
    color: PALETA.blanco,
    letterSpacing: 0.3,
  },
  bandaEstadoTexto: { fontSize: TIPO.subtitulo, color: PALETA.blanco, marginTop: 2 },

  // Campos etiqueta/valor del encabezado.
  filaCampos: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  campoTercio: { width: '33%', marginBottom: 6, paddingRight: 10 },
  campoDosTercios: { width: '66%', marginBottom: 6, paddingRight: 10 },
  campoCompleto: { width: '100%', marginBottom: 6 },
  etiquetaCampo: {
    fontSize: TIPO.etiqueta,
    color: PALETA.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 1,
  },
  valorCampo: { fontSize: 10, fontFamily: FUENTE.negrita, color: PALETA.tinta },
  valorCampoTexto: { fontSize: TIPO.cuerpo, color: PALETA.tinta },

  // Secciones.
  seccion: { marginTop: 12 },
  tituloSeccion: {
    fontSize: TIPO.seccion,
    fontFamily: FUENTE.negrita,
    color: PALETA.marca,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 5,
    borderBottomWidth: 0.75,
    borderBottomColor: PALETA.borde,
    paddingBottom: 3,
  },

  // Tabla (espíritu `TablaDensa`).
  filaTabla: { flexDirection: 'row' },
  celda: {
    borderWidth: 0.5,
    borderColor: PALETA.borde,
    paddingVertical: 3.5,
    paddingHorizontal: 5,
    fontSize: TIPO.celda,
    color: PALETA.tinta,
  },
  celdaEncabezado: {
    backgroundColor: PALETA.superficie,
    fontFamily: FUENTE.negrita,
    color: PALETA.muted,
    fontSize: TIPO.encabezadoTabla,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  celdaNum: { textAlign: 'right' },
  filaTotal: { backgroundColor: PALETA.marcaSuave },
  celdaTotal: {
    backgroundColor: PALETA.marcaSuave,
    fontFamily: FUENTE.negrita,
    color: PALETA.tinta,
  },

  // Notas.
  vacio: { fontSize: TIPO.celda, color: PALETA.muted, marginTop: 4 },
  leyenda: {
    fontSize: TIPO.subtitulo,
    color: PALETA.warn,
    fontFamily: FUENTE.negrita,
    marginTop: 10,
  },

  // Pie (paginación + fecha de generación).
  pie: {
    position: 'absolute',
    bottom: 22,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderTopWidth: 0.5,
    borderTopColor: PALETA.borde,
    paddingTop: 5,
  },
  pieTexto: {
    fontSize: TIPO.pie,
    color: PALETA.faint,
    flexGrow: 1,
    flexBasis: 0,
    paddingRight: 12,
  },
  pieDerecha: { alignItems: 'flex-end' },
  piePagina: { fontSize: TIPO.pie, color: PALETA.faint },
  pieFecha: { fontSize: TIPO.pie, color: PALETA.faint, marginTop: 1 },
});

// ── Componentes compartidos (sin JSX: `createElement`) ────────────────────────────────────────────

/** Opciones del encabezado uniforme de documento. */
export interface EncabezadoOpciones {
  /** Membrete: empresa / razón social. */
  empresa: string;
  /** Subtítulo del documento (p. ej. "Orden de compra — CONTROL v2"). */
  titulo: string;
  /** Bloque derecho opcional (folio, fecha de corte, maquilero…). Sin él, el membrete ocupa el ancho. */
  derecha?: { etiqueta: string; valor: string; grande?: boolean };
}

/**
 * Encabezado uniforme de TODOS los impresos: membrete de la empresa (verde de marca), subtítulo del
 * documento y, a la derecha, un bloque etiqueta/valor opcional (folio grande, fecha, maquilero…). Cierra
 * con la línea de marca inferior. Trae su propia `key` para poder ir directo en el arreglo de hijos.
 */
export function EncabezadoDocumento(opts: EncabezadoOpciones): ReactElement {
  const derecha =
    opts.derecha === undefined
      ? null
      : h(
          View,
          { style: estilosDoc.bloqueDerecha },
          h(Text, { style: estilosDoc.etiquetaMenor }, opts.derecha.etiqueta),
          h(
            Text,
            { style: opts.derecha.grande ? estilosDoc.folioValor : estilosDoc.valorFuerte },
            opts.derecha.valor,
          ),
        );
  return h(
    View,
    { style: estilosDoc.encabezado, key: 'encabezado' },
    h(
      View,
      {},
      h(Text, { style: estilosDoc.marca }, opts.empresa),
      h(Text, { style: estilosDoc.subtitulo }, opts.titulo),
    ),
    derecha,
  );
}

/** Fecha de generación (día de hoy, formato es-MX) — una sola vez por documento. */
function fechaGeneracion(): string {
  return new Date().toLocaleDateString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Pie de página FIJO y uniforme: a la izquierda el texto de contexto (mismo que ya traía cada impreso:
 * empresa · documento · total…), y a la derecha la paginación "Página N de M" + la fecha de generación.
 * `render` (react-pdf) rellena el número de página real por hoja. Trae su propia `key`.
 */
export function PieDocumento(opts: { contexto: string }): ReactElement {
  const fecha = fechaGeneracion();
  return h(
    View,
    { style: estilosDoc.pie, key: 'pie', fixed: true },
    h(Text, { style: estilosDoc.pieTexto }, opts.contexto),
    h(
      View,
      { style: estilosDoc.pieDerecha },
      h(Text, {
        style: estilosDoc.piePagina,
        render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
          `Página ${String(pageNumber)} de ${String(totalPages)}`,
      }),
      h(Text, { style: estilosDoc.pieFecha }, `Generado el ${fecha}`),
    ),
  );
}

/** Título de sección uniforme (MAYÚSCULAS de marca con subrayado sutil). */
export function TituloSeccion(texto: string): ReactElement {
  return h(Text, { style: estilosDoc.tituloSeccion }, texto);
}

/** Banda de estado (por defecto CANCELADA en rojo) con título + detalle. Trae su propia `key`. */
export function BandaEstado(opts: { titulo: string; detalle?: string | null }): ReactElement {
  return h(
    View,
    { style: estilosDoc.bandaEstado, key: 'banda' },
    h(Text, { style: estilosDoc.bandaEstadoTitulo }, opts.titulo),
    opts.detalle === undefined || opts.detalle === null
      ? null
      : h(Text, { style: estilosDoc.bandaEstadoTexto }, opts.detalle),
  );
}

/** Leyenda de truncado uniforme (aviso ámbar de que la tabla se topó). Trae su propia `key`. */
export function LeyendaTruncado(texto: string): ReactElement {
  return h(Text, { style: estilosDoc.leyenda, key: 'leyenda' }, texto);
}
