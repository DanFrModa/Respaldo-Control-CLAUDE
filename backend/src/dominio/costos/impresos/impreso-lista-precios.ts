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
import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';
import {
  estilosDoc,
  FUENTE,
  PALETA,
  EncabezadoDocumento,
  PieDocumento,
  LeyendaTruncado,
} from '../../../comun/impresos-estilos.js';
import { MAX_FILAS_PDF, leyendaTruncado } from '../../../comun/impreso-topes.js';

import { listaPrecios, type ParametrosListaPrecios } from '../pre-costo.js';

/** Pagador para el encabezado: razón social o nombre de la empresa activa (A9), nunca hardcodeado. */
export function pagadorDeEmpresa(empresa: { razonSocial: string | null; nombre: string }): string {
  return empresa.razonSocial ?? empresa.nombre;
}

/** Datos resueltos del impreso (forma PURA, ya sin BD). */
export interface DatosImpresoListaPrecios {
  pagador: string;
  /** Lista con las filas YA topadas a `MAX_FILAS_PDF` (los parámetros y el pie siguen completos). */
  lista: ListaPreciosSalida;
  /** Conteo de modelos del universo COMPLETO del filtro (para el aviso de truncado). */
  totalFilas: number;
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
  // Blindaje: se DIBUJAN a lo más `MAX_FILAS_PDF` modelos; el conteo completo va aparte (aviso).
  return {
    pagador,
    lista: { ...lista, filas: lista.filas.slice(0, MAX_FILAS_PDF) },
    totalFilas: lista.filas.length,
  };
}

/** Formatea un importe en pesos (o "—" si es null). */
function pesos(n: number | null): string {
  if (n === null) return '—';
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const estilos = StyleSheet.create({
  // Estilos PROPIOS de la lista (lo compartido vive en `estilosDoc`).
  tituloGenero: {
    fontSize: 10,
    fontFamily: FUENTE.negrita,
    color: PALETA.marca,
    marginTop: 12,
    marginBottom: 4,
  },
  colCodigo: { width: 70 },
  colFlex: { flexGrow: 1, flexBasis: 0 },
  colNum: { width: 72, textAlign: 'right' },
  inactivo: { color: PALETA.muted },
});

/** Encabezado de la tabla de un género. */
function encabezadoTabla(): ReactElement {
  return h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colCodigo] }, 'Modelo'),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colFlex] },
      'Descripción',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Costo'),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] },
      'Precio sug.',
    ),
  );
}

/** Sección de un género con su tabla. */
function seccionGenero(genero: string, filas: ListaPreciosSalida['filas']): ReactElement {
  const cuerpo = filas.map((f, i) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `f-${i}`, wrap: false },
      h(
        Text,
        { style: [estilosDoc.celda, estilos.colCodigo, ...(f.activo ? [] : [estilos.inactivo])] },
        f.codigo,
      ),
      h(
        Text,
        { style: [estilosDoc.celda, estilos.colFlex, ...(f.activo ? [] : [estilos.inactivo])] },
        `${f.descripcion ?? ''}${f.activo ? '' : ' (inactivo)'}`,
      ),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pesos(f.costo)),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pesos(f.precioSugerido)),
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
  const textoTruncado = leyendaTruncado(l.filas.length, datos.totalFilas);
  const aviso = textoTruncado === null ? [] : [LeyendaTruncado(textoTruncado)];

  return h(
    Page,
    { size: 'A4', style: estilosDoc.pagina },
    EncabezadoDocumento({
      empresa: datos.pagador,
      titulo: 'Lista de precios sugeridos — CONTROL v2',
      derecha: { etiqueta: 'Parámetros', valor: params },
    }),
    ...(secciones.length === 0
      ? [
          h(
            Text,
            { key: 'vacio', style: estilosDoc.subtitulo },
            'Sin modelos para los filtros dados.',
          ),
        ]
      : secciones),
    ...aviso,
    PieDocumento({ contexto: `CONTROL v2 · ${datos.pagador} · Lista de precios · ${params}` }),
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
  return {
    buffer: await renderizarPdfEnWorker('costos-lista-precios', datos, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
  };
}
