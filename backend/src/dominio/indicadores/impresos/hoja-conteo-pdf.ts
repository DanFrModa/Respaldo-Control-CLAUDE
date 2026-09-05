/**
 * Impreso PDF de la HOJA DE CONTEO de un inventario cíclico (F7-E5, R9). Generado EN EL SERVIDOR con
 * `@react-pdf/renderer`. REUSA el servicio de dominio (`leerConteoParaHoja`, A1: aplica A9 + el
 * permiso).
 *
 * ⭐ **UNA hoja para las tres dimensiones (fila 0.099).** El renglón viene YA DESCRITO del servidor
 * (`titulo`/`subtitulo`), así que la misma plantilla imprime prendas, telas o avíos sin ramificar.
 * Lo que sí cambia con la dimensión son dos columnas:
 *
 *  • **«Sistema»** sale SÓLO cuando el conteo NO es ciego. En producto terminado el conteo es CIEGO
 *    (D6) y la hoja NO imprime el teórico — igual que la pantalla. En telas y avíos Daniel pidió
 *    capturar «con el saldo del sistema a la vista» (§Post-F9.193 punto 4), y la hoja que se lleva
 *    al anaquel enseña lo mismo que la pantalla: si la hoja lo ocultara, la decisión valdría sólo
 *    para quien cuenta frente a un monitor.
 *  • **La segunda casilla en blanco** aparece cuando algún renglón lleva COMPLEMENTO (D5): esa tela
 *    se cuenta con dos números, y sin la segunda casilla no habría dónde anotar el cardigan.
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

function estiloCol(c: Columna): Style[] {
  const arr: Style[] = [estilos.celda];
  arr.push(c.ancho === undefined ? { flexGrow: 1, flexBasis: 0 } : { width: c.ancho });
  if (c.derecha) arr.push({ textAlign: 'right' });
  if (c.contar) arr.push(estilos.celdaContar);
  return arr;
}

/** Renglón ya descrito por el servidor (la forma que devuelve `leerConteoParaHoja`). */
type RenglonHoja = Awaited<ReturnType<typeof leerConteoParaHoja>>['renglones'][number];

/**
 * Arma las columnas de ESTA hoja: siempre `#`, artículo, detalle y la casilla del conteo; más la
 * columna «Sistema» si el conteo no es ciego, y una segunda casilla si hay complementos que contar.
 */
function columnasDe(renglones: readonly RenglonHoja[]): {
  columnas: Columna[];
  conSistema: boolean;
  conComplemento: boolean;
} {
  // El conteo CIEGO se reconoce por lo que NO viene: el dominio no serializa `cantTeorica` en PT.
  const conSistema = renglones.some((r) => r.cantTeorica !== undefined);
  const conComplemento = renglones.some((r) => r.nombreComplemento !== null);
  const columnas: Columna[] = [
    { titulo: '#', ancho: 26, derecha: true },
    { titulo: 'Artículo', ancho: 120 },
    { titulo: 'Detalle' },
    ...(conSistema ? [{ titulo: 'Sistema', ancho: 60, derecha: true }] : []),
    { titulo: conComplemento ? 'Contado' : 'Cantidad contada', ancho: conComplemento ? 90 : 130, contar: true },
    ...(conComplemento ? [{ titulo: 'Contado (2º comp.)', ancho: 90, contar: true }] : []),
  ];
  return { columnas, conSistema, conComplemento };
}

/** Cantidad con su unidad, para la columna «Sistema» (`—` si el renglón no la trae). */
function conUnidad(valor: number | undefined, unidad: string | null): string {
  if (valor === undefined) return '';
  return unidad === null ? String(valor) : `${String(valor)} ${unidad}`;
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

  const { columnas, conSistema, conComplemento } = columnasDe(datos.renglones);
  const enc = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    ...columnas.map((c, i) =>
      h(Text, { key: `h-${i}`, style: [...estiloCol(c), estilosDoc.celdaEncabezado] }, c.titulo),
    ),
  );
  const cuerpo =
    datos.renglones.length === 0
      ? [h(Text, { key: 'vacio', style: estilosDoc.subtitulo }, 'Sin artículos que contar.')]
      : datos.renglones.map((r, idx) => {
          const celdas: string[] = [
            String(idx + 1),
            r.titulo,
            r.subtitulo ?? '',
            ...(conSistema ? [conUnidad(r.cantTeorica, r.unidad)] : []),
            // Columna EN BLANCO: el capturista anota lo que contó, a mano.
            '',
            // Segunda casilla sólo si ESTE renglón lleva complemento; si no, se raya con «—» para
            // que nadie anote un número donde no hay nada que contar.
            ...(conComplemento ? [r.nombreComplemento === null ? '—' : ''] : []),
          ];
          return h(
            View,
            { style: estilosDoc.filaTabla, key: `f-${r.idDet}`, wrap: false },
            ...celdas.map((texto, i) =>
              h(Text, { key: `c${String(i)}`, style: estiloCol(columnas[i]!) }, texto),
            ),
          );
        });

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
