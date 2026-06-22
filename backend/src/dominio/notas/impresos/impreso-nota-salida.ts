/**
 * Impreso de la NOTA DE SALIDA a maquilero (F4-E5) — el PDF que documenta el ENVÍO de materiales
 * (telas + avíos) a un maquilero contra una orden de producción. Documento generado EN EL SERVIDOR
 * con `@react-pdf/renderer` (`renderToBuffer`), el mismo motor que los demás impresos del sistema
 * (orden de compra, orden de producción, envío de maquila, etc.). El frontend solo abre el blob.
 * Referencia del formato viejo: `NotasImp`/`NotaEntImp`.
 *
 * Decisiones del dueño (Daniel, cerradas):
 *  • (g) El almacén ORIGEN va en el ENCABEZADO de la nota (un solo almacén por nota): así se imprime.
 *  • (e) La TELA no descuenta inventario en la nota (la nota solo DOCUMENTA el envío y referencia su
 *    salida-a-orden de E1); el renglón de tela muestra tela/lote, el de avío muestra el avío.
 *
 * A diferencia de la orden de compra, la nota de salida NO lleva importes: es un documento de ENVÍO
 * (qué material sale a quién), no de compra.
 *
 * Innegociables aplicados:
 *  • A1 — TODA la lógica de armado vive aquí (dominio); la ruta solo valida permiso+Zod y delega.
 *  • A4 — la autorización la hace `obtenerNotaSalida` (`verificarPermiso(sesion, 'notas.ver')`).
 *  • A9 — la nota se resuelve por `obtenerNotaSalida`, que filtra por la empresa activa de la sesión
 *    (una nota de otra empresa, para esta sesión, no existe → `ErrorNoEncontrado`/404).
 *  • REUSO — los datos se arman con `obtenerNotaSalida` (encabezado + renglones ya proyectados). NO se
 *    reinventa la consulta; el impreso es una vista del mismo dato.
 *
 * Es PURO sobre los datos: `armarDatosImpresoNotaSalida` resuelve (única parte que toca BD) y
 * `generarPdfNotaSalida` recibe los datos ya resueltos (testeable sin BD). `obtenerNotaSalida` es un
 * seam inyectable para los tests.
 */
import { createElement as h, type ReactElement } from 'react';

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
  type DocumentProps,
} from '@react-pdf/renderer';

import { verificarPermiso, type SesionUsuario } from '../../../comun/permisos.js';
import { type ContextoBd } from '../../../comun/transaccion.js';
import { obtenerNotaSalida } from '../notas-salida.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Un renglón del impreso de la nota: orden destino + material (avío o tela/lote) + cantidad. */
export interface LineaImpresoNotaSalida {
  /** Folio de la orden de producción destino, o null. */
  folioOrden: number | null;
  /** Tipo del renglón (avío o tela). */
  tipo: 'avio' | 'tela';
  /** Texto del material: clave/descripción del avío, o nombre de la tela. */
  material: string;
  /** Clave del lote de la tela (solo renglones de tela), o null. */
  lote: string | null;
  cantidad: number;
  unidad: string | null;
}

/**
 * Todo lo que necesita el documento PDF de UNA nota de salida, ya RESUELTO (sin BD): así
 * `generarPdfNotaSalida` es una función pura y testeable.
 */
export interface DatosImpresoNotaSalida {
  empresa: string;
  numNota: number;
  estatus: string;
  cancelada: boolean;
  motivoCancelacion: string | null;
  maquilero: string;
  almacen: string;
  fechaElaboracion: string | null;
  fechaEnvio: string | null;
  observaciones: string | null;
  lineas: LineaImpresoNotaSalida[];
}

// ── Resolución de datos (lo único que toca BD) ───────────────────────────────────────────────────

/**
 * Dependencias inyectables de la resolución de datos. Por defecto usa la lectura de dominio real
 * (`obtenerNotaSalida`, que ya verifica permiso + empresa activa). Los tests inyectan un fake para no
 * tocar la BD.
 */
export interface DepsImpresoNotaSalida {
  obtenerNotaSalida?: typeof obtenerNotaSalida;
}

/**
 * Resuelve TODOS los datos del impreso de una nota de salida (A9: por la empresa activa de la
 * sesión). Reúsa `obtenerNotaSalida` (encabezado + renglones proyectados): el impreso es una vista
 * del mismo dato. Lanza `ErrorNoEncontrado` (404) si la nota no es de la empresa activa.
 */
export async function armarDatosImpresoNotaSalida(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
  deps: DepsImpresoNotaSalida = {},
): Promise<DatosImpresoNotaSalida> {
  verificarPermiso(sesion, 'notas.ver');
  const obtener = deps.obtenerNotaSalida ?? obtenerNotaSalida;

  // `obtenerNotaSalida` ya verifica permiso + empresa activa (A9).
  const nota = await obtener(sesion, id, bd);

  return {
    empresa: sesion.nombreEmpresaActiva,
    numNota: nota.numNota,
    estatus: nota.estatus,
    cancelada: nota.estatus === 'cancelada',
    motivoCancelacion: nota.motivoCancelacion,
    maquilero: nota.maquilero,
    almacen: nota.almacen,
    fechaElaboracion: nota.fechaElaboracion,
    fechaEnvio: nota.fechaEnvio,
    observaciones: nota.observaciones,
    lineas: nota.lineas.map((l) => ({
      folioOrden: l.folioOrden,
      tipo: l.tipo,
      material: l.tipo === 'avio' ? (l.avio ?? '—') : (l.tela ?? '—'),
      lote: l.loteClave,
      cantidad: l.cantidad,
      unidad: l.unidad,
    })),
  };
}

// ── Documento PDF (react-pdf, sin JSX: `createElement`) ──────────────────────────────────────────

const TEAL = '#0d9488';
const GRIS = '#64748b';
const GRIS_BORDE = '#e2e8f0';
const TINTA = '#0f172a';
const ROJO = '#b91c1c';

const estilos = StyleSheet.create({
  pagina: {
    paddingVertical: 32,
    paddingHorizontal: 40,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: TINTA,
  },
  encabezado: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: TEAL,
    paddingBottom: 8,
    marginBottom: 12,
  },
  empresa: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: TEAL },
  subtitulo: { fontSize: 8, color: GRIS, marginTop: 2 },
  folioBloque: { alignItems: 'flex-end' },
  folioEtiqueta: { fontSize: 8, color: GRIS, textTransform: 'uppercase' },
  folioValor: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  bandaCancelada: {
    backgroundColor: ROJO,
    color: '#ffffff',
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginBottom: 10,
    borderRadius: 4,
  },
  bandaCanceladaTitulo: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  bandaCanceladaMotivo: { fontSize: 8, marginTop: 2 },
  filaCampos: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  campo: { width: '33%', marginBottom: 6, paddingRight: 8 },
  campoAncho: { width: '66%', marginBottom: 6, paddingRight: 8 },
  etiquetaCampo: { fontSize: 7, color: GRIS, textTransform: 'uppercase' },
  valorCampo: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  valorCampoTexto: { fontSize: 9 },
  seccion: { marginTop: 10 },
  tituloSeccion: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: TEAL,
    textTransform: 'uppercase',
    marginBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: GRIS_BORDE,
    paddingBottom: 2,
  },
  // Tabla de renglones.
  filaTabla: { flexDirection: 'row' },
  celda: {
    borderWidth: 0.5,
    borderColor: GRIS_BORDE,
    paddingVertical: 3,
    paddingHorizontal: 4,
    fontSize: 8,
  },
  celdaEncabezado: { backgroundColor: '#f1f5f9', fontFamily: 'Helvetica-Bold' },
  celdaMaterial: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  celdaTipo: { width: 42, textAlign: 'center' },
  celdaLote: { width: 70, textAlign: 'left' },
  celdaNum: { width: 56, textAlign: 'right' },
  celdaUnidad: { width: 46, textAlign: 'center' },
  celdaOrden: { width: 50, textAlign: 'center' },
  vacio: { fontSize: 8, color: GRIS },
  pie: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    fontSize: 7,
    color: '#94a3b8',
    textAlign: 'center',
  },
});

/** Un campo etiqueta/valor del encabezado. */
function campo(etiqueta: string, valor: string | null, ancho = false): ReactElement {
  return h(
    View,
    { style: ancho ? estilos.campoAncho : estilos.campo, key: etiqueta },
    h(Text, { style: estilos.etiquetaCampo }, etiqueta),
    h(Text, { style: estilos.valorCampo }, valor ?? '—'),
  );
}

/** Banda roja "CANCELADA" + motivo (solo si la nota está cancelada). */
function bandaCancelada(datos: DatosImpresoNotaSalida): ReactElement | null {
  if (!datos.cancelada) {
    return null;
  }
  return h(
    View,
    { style: estilos.bandaCancelada },
    h(Text, { style: estilos.bandaCanceladaTitulo }, 'NOTA DE SALIDA CANCELADA'),
    h(
      Text,
      { style: estilos.bandaCanceladaMotivo },
      `Motivo: ${datos.motivoCancelacion ?? 'sin especificar'}`,
    ),
  );
}

/** Tabla de renglones de la nota (orden, tipo, material, lote, cantidad, unidad). */
function tablaLineas(datos: DatosImpresoNotaSalida): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaOrden] }, 'Orden'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaTipo] }, 'Tipo'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaMaterial] }, 'Material'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaLote] }, 'Lote'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaNum] }, 'Cantidad'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaUnidad] }, 'Unidad'),
  );

  const filas = datos.lineas.map((l, i) =>
    h(
      View,
      { style: estilos.filaTabla, key: `fila-${i}` },
      h(
        Text,
        { style: [estilos.celda, estilos.celdaOrden] },
        l.folioOrden === null ? '—' : String(l.folioOrden),
      ),
      h(Text, { style: [estilos.celda, estilos.celdaTipo] }, l.tipo === 'avio' ? 'Avío' : 'Tela'),
      h(Text, { style: [estilos.celda, estilos.celdaMaterial] }, l.material),
      h(Text, { style: [estilos.celda, estilos.celdaLote] }, l.lote ?? '—'),
      h(Text, { style: [estilos.celda, estilos.celdaNum] }, String(l.cantidad)),
      h(Text, { style: [estilos.celda, estilos.celdaUnidad] }, l.unidad ?? '—'),
    ),
  );

  const cuerpo =
    datos.lineas.length === 0
      ? [h(Text, { style: estilos.vacio, key: 'vacio' }, 'Sin renglones capturados.')]
      : [filaEncabezado, ...filas];

  return h(
    View,
    { style: estilos.seccion },
    h(Text, { style: estilos.tituloSeccion }, 'Renglones'),
    ...cuerpo,
  );
}

/** Una página = una nota de salida. */
function paginaNotaSalida(datos: DatosImpresoNotaSalida, clave: string): ReactElement {
  const hijos: (ReactElement | null)[] = [
    h(
      View,
      { style: estilos.encabezado, key: 'enc' },
      h(
        View,
        {},
        h(Text, { style: estilos.empresa }, datos.empresa),
        h(Text, { style: estilos.subtitulo }, 'Nota de salida a maquilero — CONTROL v2'),
      ),
      h(
        View,
        { style: estilos.folioBloque },
        h(Text, { style: estilos.folioEtiqueta }, 'Folio'),
        h(Text, { style: estilos.folioValor }, String(datos.numNota)),
      ),
    ),
    bandaCancelada(datos),
    h(
      View,
      { style: estilos.filaCampos, key: 'campos' },
      campo('Maquilero', datos.maquilero, true),
      campo('Estatus', datos.estatus),
      campo('Almacén origen', datos.almacen, true),
      campo('Fecha de elaboración', datos.fechaElaboracion),
      campo('Fecha de envío', datos.fechaEnvio),
    ),
    datos.observaciones
      ? h(
          View,
          { style: estilos.campoAncho, key: 'obs' },
          h(Text, { style: estilos.etiquetaCampo }, 'Observaciones'),
          h(Text, { style: estilos.valorCampoTexto }, datos.observaciones),
        )
      : null,
    tablaLineas(datos),
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.empresa} · Nota de salida ${datos.numNota} · Maquilero ${datos.maquilero}`,
    ),
  ];

  return h(
    Page,
    { key: clave, size: 'A4', style: estilos.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de UNA nota de salida. */
function documentoNotaSalida(datos: DatosImpresoNotaSalida): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Nota de salida ${datos.numNota}`,
      author: datos.empresa,
      subject: 'Nota de salida a maquilero',
    },
    paginaNotaSalida(datos, 'pagina-0'),
  );
}

// ── Generación del Buffer (función pura: recibe datos resueltos) ──────────────────────────────────

/** Genera el PDF (Buffer) de una nota de salida a partir de sus datos ya resueltos. */
export async function generarPdfNotaSalida(datos: DatosImpresoNotaSalida): Promise<Buffer> {
  return renderToBuffer(documentoNotaSalida(datos));
}

// ── Orquestación de alto nivel (resuelve datos + genera) — la usa la ruta ─────────────────────────

/** Resultado de generar el impreso de una nota (Buffer + folio para el `filename`). */
export interface ImpresoNotaSalida {
  buffer: Buffer;
  numNota: number;
}

/** Resuelve los datos de una nota (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoNotaSalida(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
  deps: DepsImpresoNotaSalida = {},
): Promise<ImpresoNotaSalida> {
  const datos = await armarDatosImpresoNotaSalida(sesion, id, bd, deps);
  const buffer = await generarPdfNotaSalida(datos);
  return { buffer, numNota: datos.numNota };
}
