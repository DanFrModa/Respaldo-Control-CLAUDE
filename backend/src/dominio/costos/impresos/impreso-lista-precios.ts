/**
 * Impreso PDF de la LISTA DE PRECIOS (F7-E1, R9; doc 06-Costos-y-EDR §5, ex reporte `ListaPrecios`).
 * Cada modelo con su costo estimado (pre-costo) y su precio de venta SUGERIDO (utilidad + regalías
 * PARAMETRIZADAS, redondeo al alza — {@link calcularPrecioSugerido}), agrupado por género. Documento
 * generado EN EL SERVIDOR con `@react-pdf/renderer`: función pura `armarDatos…` + componente + render.
 * Reusa {@link listaPrecios} (A1: la lógica NO se duplica; el ocultamiento de importes sin
 * `consultas.ver-importes` ya lo aplica el dominio, y la razón social es de la empresa activa A9).
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

import type { ListaPreciosSalida } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';

import { listaPrecios, type ParametrosListaPrecios } from '../pre-costo.js';

/** Pagador para el encabezado: razón social o nombre de la empresa activa (A9), nunca hardcodeado. */
export function pagadorDeEmpresa(empresa: { razonSocial: string | null; nombre: string }): string {
  return empresa.razonSocial ?? empresa.nombre;
}

/** Datos resueltos del impreso (forma PURA, ya sin BD). */
export interface DatosImpresoListaPrecios {
  pagador: string;
  lista: ListaPreciosSalida;
}

/** Dependencias inyectables (los tests inyectan `listaPrecios` fake para no tocar BD). */
export interface DepsImpresoListaPrecios {
  listaPrecios?: typeof listaPrecios;
}

/** Resuelve los datos (A9 vía `listaPrecios`) + la razón social de la empresa activa. */
export async function armarDatosImpresoListaPrecios(
  sesion: SesionUsuario,
  query: ParametrosListaPrecios = {},
  bd?: ContextoBd,
  deps: DepsImpresoListaPrecios = {},
): Promise<DatosImpresoListaPrecios> {
  const obtener = deps.listaPrecios ?? listaPrecios;
  const lista = await obtener(sesion, query, bd);
  const empresa = await clienteLectura(bd).empresa.findUnique({
    where: { id: sesion.idEmpresaActiva },
    select: { razonSocial: true, nombre: true },
  });
  const pagador = pagadorDeEmpresa(
    empresa ?? { razonSocial: null, nombre: sesion.nombreEmpresaActiva },
  );
  return { pagador, lista };
}

const TEAL = '#0d9488';
const GRIS = '#64748b';
const GRIS_BORDE = '#e2e8f0';
const TINTA = '#0f172a';

/** Formatea un importe en pesos (o "—" si es null). */
function pesos(n: number | null): string {
  if (n === null) return '—';
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const estilos = StyleSheet.create({
  pagina: {
    paddingVertical: 36,
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
  empresa: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: TEAL },
  subtitulo: { fontSize: 8, color: GRIS, marginTop: 2 },
  bloqueDerecha: { alignItems: 'flex-end' },
  etiqueta: { fontSize: 7, color: GRIS, textTransform: 'uppercase' },
  valorFuerte: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  tituloGenero: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: TEAL,
    marginTop: 12,
    marginBottom: 4,
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
  colCodigo: { width: 70 },
  colFlex: { flexGrow: 1, flexBasis: 0 },
  colNum: { width: 72, textAlign: 'right' },
  inactivo: { color: GRIS },
  pie: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 7,
    color: '#94a3b8',
    textAlign: 'center',
  },
});

/** Encabezado de la tabla de un género. */
function encabezadoTabla(): ReactElement {
  return h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colCodigo] }, 'Modelo'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colFlex] }, 'Descripción'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Costo'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Precio sug.'),
  );
}

/** Sección de un género con su tabla. */
function seccionGenero(genero: string, filas: ListaPreciosSalida['filas']): ReactElement {
  const cuerpo = filas.map((f, i) =>
    h(
      View,
      { style: estilos.filaTabla, key: `f-${i}`, wrap: false },
      h(
        Text,
        { style: [estilos.celda, estilos.colCodigo, ...(f.activo ? [] : [estilos.inactivo])] },
        f.codigo,
      ),
      h(
        Text,
        { style: [estilos.celda, estilos.colFlex, ...(f.activo ? [] : [estilos.inactivo])] },
        `${f.descripcion ?? ''}${f.activo ? '' : ' (inactivo)'}`,
      ),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(f.costo)),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(f.precioSugerido)),
    ),
  );
  return h(
    View,
    { key: `g-${genero}` },
    h(Text, { style: estilos.tituloGenero }, genero),
    encabezadoTabla(),
    ...cuerpo,
  );
}

/** Agrupa las filas por género (preservando el orden por código). */
function agruparPorGenero(
  filas: ListaPreciosSalida['filas'],
): Map<string, ListaPreciosSalida['filas']> {
  const grupos = new Map<string, ListaPreciosSalida['filas']>();
  for (const f of filas) {
    const g = f.genero ?? 'Sin género';
    const arr = grupos.get(g) ?? [];
    arr.push(f);
    grupos.set(g, arr);
  }
  return grupos;
}

/** Página del impreso. */
function paginaLista(datos: DatosImpresoListaPrecios): ReactElement {
  const l = datos.lista;
  const params =
    l.utilidadSugerida === null || l.regaliasBase === null
      ? 'Precios ocultos (sin permiso de importes)'
      : `Utilidad ${l.utilidadSugerida}% · Regalías ${l.regaliasBase}% · redondeo al alza`;
  const grupos = agruparPorGenero(l.filas);
  const secciones = [...grupos.entries()].map(([g, filas]) => seccionGenero(g, filas));

  return h(
    Page,
    { size: 'A4', style: estilos.pagina },
    h(
      View,
      { style: estilos.encabezado, key: 'enc' },
      h(
        View,
        {},
        h(Text, { style: estilos.empresa }, datos.pagador),
        h(Text, { style: estilos.subtitulo }, 'Lista de precios sugeridos — CONTROL v2'),
      ),
      h(
        View,
        { style: estilos.bloqueDerecha },
        h(Text, { style: estilos.etiqueta }, 'Parámetros'),
        h(Text, { style: estilos.valorFuerte }, params),
      ),
    ),
    ...(secciones.length === 0
      ? [h(Text, { key: 'vacio', style: estilos.subtitulo }, 'Sin modelos para los filtros dados.')]
      : secciones),
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.pagador} · Lista de precios · ${params}`,
    ),
  );
}

/** Documento de la lista de precios. */
function documentoLista(datos: DatosImpresoListaPrecios): ReactElement<DocumentProps> {
  return h(
    Document,
    { title: 'Lista de precios', author: datos.pagador, subject: 'Lista de precios sugeridos' },
    paginaLista(datos),
  );
}

/** Genera el PDF (Buffer) de la lista de precios a partir de sus datos resueltos. */
export async function generarPdfListaPrecios(datos: DatosImpresoListaPrecios): Promise<Buffer> {
  return renderToBuffer(documentoLista(datos));
}

/** Resuelve los datos (A9) y devuelve el PDF de la lista de precios. */
export async function impresoListaPrecios(
  sesion: SesionUsuario,
  query: ParametrosListaPrecios = {},
  bd?: ContextoBd,
  deps: DepsImpresoListaPrecios = {},
): Promise<{ buffer: Buffer }> {
  const datos = await armarDatosImpresoListaPrecios(sesion, query, bd, deps);
  return { buffer: await generarPdfListaPrecios(datos) };
}
