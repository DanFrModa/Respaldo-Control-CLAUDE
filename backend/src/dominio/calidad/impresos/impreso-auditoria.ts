/**
 * Impreso de una AUDITORÍA de calidad (F6-E3, R9; ref. viejo `FormatoAuditorias`/`FormatoAuditoriasDet`,
 * doc `09-Control-de-Calidad.md` §3): la hoja que documenta la inspección de una muestra de una orden.
 * Encabezado (nº de auditoría, orden, modelo, cantidad, muestra, tipo, maquilero, elaboró/auditó,
 * fechas) + detalle de defectos (clave, pág, descripción, nivel AQL, nº de fallas) + el RESULTADO
 * grande (ACEPTADO / RECHAZADO / NO CALIFICADO) con el total de prendas rechazadas y las observaciones.
 *
 * Documento generado EN EL SERVIDOR con `@react-pdf/renderer` (`renderToBuffer`), MISMO motor y patrón
 * que `produccion/impresos/impreso-recibo-maquila.ts` (A1: la ruta solo valida permiso+Zod y delega).
 * Reusa `obtenerAuditoria` (A9: filtra por la empresa activa → 404 si no) y resuelve `pag` de cada
 * defecto y el nombre de usuario de quien elaboró/auditó, que no viajan en la proyección del núcleo.
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

import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';

import {
  ETIQUETAS_TIPO_AUDITORIA,
  type ResultadoAuditoriaClave,
  type TipoAuditoriaClave,
} from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';
import { obtenerAuditoria } from '../auditorias.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Un renglón de defecto del impreso (con `pag` resuelto). */
export interface RenglonImpresoAuditoria {
  clave: string;
  pag: string | null;
  descripcion: string;
  nivelAQL: number;
  numFallas: number;
}

/** Todo lo que necesita el documento de auditoría, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoAuditoria {
  empresa: string;
  numAuditoria: number;
  folioOrden: number | null;
  codigoModelo: string | null;
  cantidadOrden: number;
  tamanoMuestra: number;
  muestraManual: boolean;
  tipoAuditoria: TipoAuditoriaClave;
  maquilero: string | null;
  elaboro: string | null;
  auditor: string | null;
  fechaElaboracion: string;
  fechaAuditoria: string;
  resultado: ResultadoAuditoriaClave;
  observaciones: string | null;
  cancelada: boolean;
  totalFallas: number;
  renglones: RenglonImpresoAuditoria[];
}

/** Dependencias inyectables (los tests inyectan `obtenerAuditoria` fake para no tocar BD). */
export interface DepsImpresoAuditoria {
  obtenerAuditoria?: typeof obtenerAuditoria;
}

/**
 * Resuelve los datos del impreso de una auditoría (A9, vía `obtenerAuditoria`). Consulta aparte la
 * cantidad de la orden, el `pag` de cada defecto y el nombre de quien elaboró/auditó (no viajan en la
 * proyección del núcleo). Acción de impresión → esas lecturas extra son aceptables.
 */
export async function armarDatosImpresoAuditoria(
  sesion: SesionUsuario,
  idAuditoria: number,
  bd?: ContextoBd,
  deps: DepsImpresoAuditoria = {},
): Promise<DatosImpresoAuditoria> {
  const obtener = deps.obtenerAuditoria ?? obtenerAuditoria;
  const auditoria = await obtener(sesion, idAuditoria, bd);
  const cliente = clienteLectura(bd);

  const cantidadAgg = await cliente.ordenLineaTalla.aggregate({
    where: { ordenLinea: { idOrden: auditoria.idOrden } },
    _sum: { cantidad: true },
  });
  const cantidadOrden = cantidadAgg._sum.cantidad ?? 0;

  const idsDefecto = auditoria.defectos.map((d) => d.idDefecto);
  const pags = await cliente.defectoCatalogo.findMany({
    where: { id: { in: idsDefecto } },
    select: { id: true, pag: true },
  });
  const pagPorId = new Map(pags.map((p) => [p.id, p.pag]));

  const idsUsuario = [auditoria.elaboroPorId, auditoria.auditorPorId].filter(
    (x): x is string => x !== null,
  );
  const usuarios =
    idsUsuario.length === 0
      ? []
      : await cliente.usuario.findMany({
          where: { id: { in: idsUsuario } },
          select: { id: true, nombre: true },
        });
  const nombrePorId = new Map(usuarios.map((u) => [u.id, u.nombre]));
  const nombreUsuario = (id: string | null): string | null =>
    id === null ? null : (nombrePorId.get(id) ?? null);

  return {
    empresa: sesion.nombreEmpresaActiva,
    numAuditoria: auditoria.numAuditoria,
    folioOrden: auditoria.folioOrden,
    codigoModelo: auditoria.codigoModelo,
    cantidadOrden,
    tamanoMuestra: auditoria.tamanoMuestra,
    muestraManual: auditoria.muestraManual,
    tipoAuditoria: auditoria.tipoAuditoria,
    maquilero: auditoria.maquilero,
    elaboro: nombreUsuario(auditoria.elaboroPorId),
    auditor: nombreUsuario(auditoria.auditorPorId),
    fechaElaboracion: auditoria.fechaElaboracion,
    fechaAuditoria: auditoria.fechaAuditoria,
    resultado: auditoria.resultado,
    observaciones: auditoria.observaciones,
    cancelada: auditoria.cancelada,
    totalFallas: auditoria.totalFallas,
    renglones: auditoria.defectos.map((d) => ({
      clave: d.clave,
      pag: pagPorId.get(d.idDefecto) ?? null,
      descripcion: d.descripcion,
      nivelAQL: d.nivelAQL,
      numFallas: d.numFallas,
    })),
  };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

const TEAL = '#0d9488';
const GRIS = '#64748b';
const GRIS_BORDE = '#e2e8f0';
const TINTA = '#0f172a';
const ROJO = '#b91c1c';
const VERDE = '#15803d';

/** Etiqueta grande del resultado + su color (ACEPTADO / RECHAZADO / NO CALIFICADO). */
const RESULTADO_IMPRESO: Record<ResultadoAuditoriaClave, { texto: string; color: string }> = {
  aprobado: { texto: 'ACEPTADO', color: VERDE },
  reprobado: { texto: 'RECHAZADO', color: ROJO },
  no_calificado: { texto: 'NO CALIFICADO', color: GRIS },
};

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
  filaTabla: { flexDirection: 'row' },
  celda: {
    borderWidth: 0.5,
    borderColor: GRIS_BORDE,
    paddingVertical: 3,
    paddingHorizontal: 4,
    fontSize: 8,
  },
  celdaEncabezado: { backgroundColor: '#f1f5f9', fontFamily: 'Helvetica-Bold' },
  celdaClave: { width: 70 },
  celdaPag: { width: 40, textAlign: 'center' },
  celdaDescripcion: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  celdaNivel: { width: 42, textAlign: 'center' },
  celdaFallas: { width: 42, textAlign: 'center', fontFamily: 'Helvetica-Bold' },
  filaTotales: { backgroundColor: '#f8fafc' },
  resultadoBloque: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GRIS_BORDE,
    borderRadius: 4,
    padding: 10,
  },
  resultadoTexto: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
  resultadoEtiqueta: { fontSize: 7, color: GRIS, textTransform: 'uppercase' },
  rechazadasValor: { fontSize: 16, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
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

/** Banda roja "AUDITORÍA CANCELADA" (solo si está cancelada). */
function bandaCancelada(datos: DatosImpresoAuditoria): ReactElement | null {
  if (!datos.cancelada) {
    return null;
  }
  return h(
    View,
    { style: estilos.bandaCancelada },
    h(Text, { style: estilos.bandaCanceladaTitulo }, 'AUDITORÍA CANCELADA'),
  );
}

/** Tabla de DETALLE de defectos (clave, pág, descripción, nivel AQL, nº de fallas) + total. */
function tablaDefectos(datos: DatosImpresoAuditoria): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaClave] }, 'Clave'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaPag] }, 'Pág'),
    h(
      Text,
      { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaDescripcion] },
      'Defecto',
    ),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaNivel] }, 'AQL'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaFallas] }, 'Fallas'),
  );

  const filas = datos.renglones.map((r, i) =>
    h(
      View,
      { style: estilos.filaTabla, key: `fila-${i}` },
      h(Text, { style: [estilos.celda, estilos.celdaClave] }, r.clave),
      h(Text, { style: [estilos.celda, estilos.celdaPag] }, r.pag ?? ''),
      h(Text, { style: [estilos.celda, estilos.celdaDescripcion] }, r.descripcion),
      h(Text, { style: [estilos.celda, estilos.celdaNivel] }, String(r.nivelAQL)),
      h(
        Text,
        { style: [estilos.celda, estilos.celdaFallas] },
        r.numFallas === 0 ? '' : String(r.numFallas),
      ),
    ),
  );

  const filaTotales = h(
    View,
    { style: [estilos.filaTabla, estilos.filaTotales], key: 'tot' },
    h(
      Text,
      {
        style: [
          estilos.celda,
          estilos.celdaEncabezado,
          { flexGrow: 1, flexBasis: 0, textAlign: 'right' as const },
        ],
      },
      'Total de prendas rechazadas',
    ),
    h(
      Text,
      { style: [estilos.celda, estilos.celdaEncabezado, estilos.celdaFallas] },
      String(datos.totalFallas),
    ),
  );

  const cuerpo =
    datos.renglones.length === 0
      ? [h(Text, { style: estilos.vacio, key: 'vacio' }, 'Sin defectos capturados.')]
      : [filaEncabezado, ...filas, filaTotales];

  return h(
    View,
    { style: estilos.seccion },
    h(Text, { style: estilos.tituloSeccion }, 'Defectos encontrados'),
    ...cuerpo,
  );
}

/** Bloque grande del RESULTADO (ACEPTADO / RECHAZADO / NO CALIFICADO) + prendas rechazadas. */
function bloqueResultado(datos: DatosImpresoAuditoria): ReactElement {
  const r = RESULTADO_IMPRESO[datos.resultado];
  return h(
    View,
    { style: estilos.resultadoBloque },
    h(
      View,
      {},
      h(Text, { style: estilos.resultadoEtiqueta }, 'Resultado (manual)'),
      h(Text, { style: [estilos.resultadoTexto, { color: r.color }] }, r.texto),
    ),
    h(
      View,
      {},
      h(Text, { style: estilos.resultadoEtiqueta }, 'Prendas rechazadas'),
      h(Text, { style: estilos.rechazadasValor }, String(datos.totalFallas)),
    ),
  );
}

/** Una página del documento de AUDITORÍA. */
function paginaAuditoria(datos: DatosImpresoAuditoria, clave: string): ReactElement {
  const hijos: (ReactElement | null)[] = [
    h(
      View,
      { style: estilos.encabezado, key: 'enc' },
      h(
        View,
        {},
        h(Text, { style: estilos.empresa }, datos.empresa),
        h(Text, { style: estilos.subtitulo }, 'Auditoría de calidad — CONTROL v2'),
      ),
      h(
        View,
        { style: estilos.folioBloque },
        h(Text, { style: estilos.folioEtiqueta }, 'No. auditoría'),
        h(Text, { style: estilos.folioValor }, String(datos.numAuditoria)),
      ),
    ),
    bandaCancelada(datos),
    h(
      View,
      { style: estilos.filaCampos, key: 'campos' },
      campo('Orden', datos.folioOrden === null ? '—' : String(datos.folioOrden)),
      campo('Modelo', datos.codigoModelo),
      campo('Tipo', ETIQUETAS_TIPO_AUDITORIA[datos.tipoAuditoria]),
      campo('Cantidad de la orden', datos.cantidadOrden.toLocaleString('es-MX')),
      campo(
        'Tamaño de muestra',
        `${String(datos.tamanoMuestra)}${datos.muestraManual ? ' (manual)' : ''}`,
      ),
      campo('Maquilero', datos.maquilero),
      campo('Elaboró', datos.elaboro),
      campo('Auditó', datos.auditor),
      campo('Fecha de elaboración', datos.fechaElaboracion),
      campo('Fecha de auditoría', datos.fechaAuditoria),
    ),
    tablaDefectos(datos),
    bloqueResultado(datos),
    datos.observaciones
      ? h(
          View,
          { style: [estilos.campoAncho, { width: '100%' as const, marginTop: 10 }], key: 'obs' },
          h(Text, { style: estilos.etiquetaCampo }, 'Observaciones'),
          h(Text, { style: estilos.valorCampoTexto }, datos.observaciones),
        )
      : null,
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.empresa} · Auditoría ${datos.numAuditoria} · ${datos.totalFallas} prendas rechazadas`,
    ),
  ];
  return h(
    Page,
    { key: clave, size: 'A4', style: estilos.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de UNA auditoría de calidad. */
function documentoAuditoria(datos: DatosImpresoAuditoria): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Auditoría ${datos.numAuditoria}`,
      author: datos.empresa,
      subject: 'Auditoría de calidad',
    },
    paginaAuditoria(datos, 'auditoria'),
  );
}

/** Genera el PDF (Buffer) del documento de auditoría a partir de sus datos resueltos. */
export async function generarPdfAuditoria(datos: DatosImpresoAuditoria): Promise<Buffer> {
  return renderToBuffer(documentoAuditoria(datos));
}

/** Resultado de generar un impreso de auditoría (Buffer + folio para el `filename`). */
export interface ImpresoAuditoria {
  buffer: Buffer;
  folio: number;
}

/** Resuelve los datos de la auditoría (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoAuditoria(
  sesion: SesionUsuario,
  idAuditoria: number,
  bd?: ContextoBd,
  deps: DepsImpresoAuditoria = {},
): Promise<ImpresoAuditoria> {
  const datos = await armarDatosImpresoAuditoria(sesion, idAuditoria, bd, deps);
  return { buffer: await renderizarPdfEnWorker('auditoria', datos), folio: datos.numAuditoria };
}
