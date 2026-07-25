/**
 * Impreso PDF de la HOJA DE CONTEO de un inventario cíclico (F7-E5, R9). Generado EN EL SERVIDOR con
 * `@react-pdf/renderer`. REUSA el servicio de dominio (`leerConteoParaHoja`, A1: aplica A9 + el
 * permiso). CONTEO CIEGO (D6): la hoja NO imprime el teórico — trae una columna en blanco para anotar
 * a mano la cantidad FÍSICA contada.
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
  type Styles,
} from '@react-pdf/renderer';

import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';
import { estilosDoc, FUENTE, PALETA, PieDocumento } from '../../../comun/impresos-estilos.js';

/** Un estilo de react-pdf (los valores de `StyleSheet.create`). */
type Style = Styles[string];

import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';

import { leerConteoParaHoja } from '../inventario-ciclico.js';
import { razonSocialEmpresa } from './comun.js';

const estilos = StyleSheet.create({
  // Estilos PROPIOS de la hoja (lo compartido vive en `estilosDoc`).
  metaDer: { alignItems: 'flex-end' },
  metaTitulo: { fontSize: 12, fontFamily: FUENTE.negrita, color: PALETA.tinta },
  metaLinea: { fontSize: 8, color: PALETA.muted, marginTop: 2 },
  // Celda con más alto (renglón para anotar el conteo físico a mano) — conteo ciego.
  celda: {
    borderWidth: 0.5,
    borderColor: PALETA.borde,
    paddingVertical: 4,
    paddingHorizontal: 4,
    fontSize: 8,
    color: PALETA.tinta,
  },
  celdaContar: { minHeight: 18 },
});

/** Una columna de la hoja. */
interface Columna {
  titulo: string;
  ancho?: number; // px fijos; sin ancho = flex
  derecha?: boolean;
  contar?: boolean; // columna en blanco para anotar a mano
}

const COLUMNAS: Columna[] = [
  { titulo: '#', ancho: 26, derecha: true },
  { titulo: 'Modelo', ancho: 90 },
  { titulo: 'Color' },
  { titulo: 'Talla', ancho: 60 },
  { titulo: 'Orden', ancho: 60 },
  { titulo: 'Cantidad contada', ancho: 130, contar: true },
];

function estiloCol(c: Columna): Style[] {
  const arr: Style[] = [estilos.celda];
  arr.push(c.ancho === undefined ? { flexGrow: 1, flexBasis: 0 } : { width: c.ancho });
  if (c.derecha) arr.push({ textAlign: 'right' });
  if (c.contar) arr.push(estilos.celdaContar);
  return arr;
}

/** Genera el PDF de la hoja de conteo (CIEGA — sin teórico). */
export async function impresoHojaConteo(
  sesion: SesionUsuario,
  idInventarioCiclico: number,
  bd?: ContextoBd,
): Promise<{ buffer: Buffer }> {
  const datos = await leerConteoParaHoja(sesion, idInventarioCiclico, bd);
  const pagador = await razonSocialEmpresa(sesion, bd);
  return {
    buffer: await renderizarPdfEnWorker(
      'hoja-conteo',
      { pagador, datos },
      { idEmpresa: sesion.idEmpresaActiva },
    ),
  };
}

/** Payload YA resuelto de la hoja de conteo (para el render en worker). */
export interface PayloadPdfHojaConteo {
  pagador: string;
  datos: Awaited<ReturnType<typeof leerConteoParaHoja>>;
}

/** Render PURO de la hoja de conteo ciega (datos ya resueltos → Buffer). */
export async function generarPdfHojaConteo(payload: PayloadPdfHojaConteo): Promise<Buffer> {
  const { pagador, datos } = payload;
  const titulo = `Hoja de conteo — Cíclico #${String(datos.folio)}`;

  const enc = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    ...COLUMNAS.map((c, i) =>
      h(Text, { key: `h-${i}`, style: [...estiloCol(c), estilosDoc.celdaEncabezado] }, c.titulo),
    ),
  );
  const cuerpo =
    datos.renglones.length === 0
      ? [h(Text, { key: 'vacio', style: estilosDoc.subtitulo }, 'Sin artículos que contar.')]
      : datos.renglones.map((r, idx) =>
          h(
            View,
            { style: estilosDoc.filaTabla, key: `f-${r.idDet}`, wrap: false },
            h(Text, { key: 'c0', style: estiloCol(COLUMNAS[0]!) }, String(idx + 1)),
            h(Text, { key: 'c1', style: estiloCol(COLUMNAS[1]!) }, r.modelo),
            h(Text, { key: 'c2', style: estiloCol(COLUMNAS[2]!) }, r.color),
            h(Text, { key: 'c3', style: estiloCol(COLUMNAS[3]!) }, r.etiquetaTalla),
            h(
              Text,
              { key: 'c4', style: estiloCol(COLUMNAS[4]!) },
              r.folioOrden === null ? 'Sin orden' : `#${String(r.folioOrden)}`,
            ),
            // Columna EN BLANCO (conteo ciego): el capturista anota la cantidad física a mano.
            h(Text, { key: 'c5', style: estiloCol(COLUMNAS[5]!) }, ''),
          ),
        );

  const documento: ReactElement<DocumentProps> = h(
    Document,
    { title: titulo, author: pagador, subject: titulo },
    h(
      Page,
      { size: 'A4', style: estilosDoc.pagina },
      h(
        View,
        { style: estilosDoc.encabezado, key: 'header' },
        h(
          View,
          {},
          h(Text, { style: estilosDoc.marca }, pagador),
          h(Text, { style: estilosDoc.subtitulo }, 'Hoja de conteo — CONTROL v2'),
          h(
            Text,
            { style: estilosDoc.subtitulo },
            `Almacén: ${datos.almacen}  ·  Fecha: ${datos.fecha}`,
          ),
        ),
        h(
          View,
          { style: estilos.metaDer },
          h(Text, { style: estilos.metaTitulo }, `Cíclico #${String(datos.folio)}`),
          h(Text, { style: estilos.metaLinea }, `Artículos: ${String(datos.renglones.length)}`),
          h(Text, { style: estilos.metaLinea }, 'Contó: __________________'),
        ),
      ),
      h(View, { key: 'tabla' }, enc, ...cuerpo),
      PieDocumento({ contexto: `CONTROL v2 · ${pagador} · ${titulo}` }),
    ),
  );

  return renderToBuffer(documento);
}
