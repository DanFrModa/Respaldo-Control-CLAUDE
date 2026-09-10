/**
 * Impreso 'INVENTARIO DE TELAS' (F4-E1, R9 — referencia vieja: reporte `InventariosTela`). La hoja
 * (PDF) con las existencias del inventario de telas VIGENTE: por TELA × COLOR × ALMACÉN, con el
 * CUERPO y el COMPLEMENTO juntos (Σ de movimientos, D3).
 *
 * ⚠️ HASTA v0.097 ESTE IMPRESO LEÍA EL INVENTARIO EQUIVOCADO. Cuando el inventario de telas se rehízo
 * por COLOR (etapa A2) las cuentas se partieron en dos para que lo viejo no contaminara lo nuevo, y
 * este impreso se quedó colgado de la consulta LEGADA por lote (`consultarExistenciasTela`), que
 * sólo ve los renglones con `id_tela_color IS NULL`. Resultado: quien imprimía «el inventario de
 * telas» se llevaba el inventario LEGADO por lote bajo el nombre del vigente —hoy prácticamente una
 * hoja en blanco, y con histórico por lote cargado sería peor: números que parecen buenos y no son
 * los que la pantalla enseña—, sin ningún aviso de que lo estaba.
 *
 * ⚠️ El defecto NO era leer algo «muerto»: esa dimensión legada está viva y su kardex se consulta
 * (ver `KardexMaterialesPagina`). Era leer OTRA cosa que la pantalla de la que colgaba el botón, y
 * llamarla igual. Ahora lee
 * {@link consultarExistenciasTelaColor} — la MISMA consulta que pinta «Inventario de telas», de
 * donde cuelga su botón—, así que el papel dice lo mismo que la pantalla.
 *
 * Documento generado EN EL SERVIDOR con `@react-pdf/renderer` (`renderToBuffer`), MISMO motor y
 * patrón que `produccion/impresos/impreso-entrega-cliente.ts` (A1: la ruta solo valida permiso+Zod
 * y delega). Honra el ex-acceso #7 indirectamente: las existencias NO traen importes (solo
 * cantidades), así que el impreso es visible para todo `inventario-telas.ver` sin exponer costos.
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

import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';
import { MAX_FILAS_PDF, leyendaTruncado } from '../../../comun/impreso-topes.js';
import {
  estilosDoc,
  EncabezadoDocumento,
  PieDocumento,
  LeyendaTruncado,
} from '../../../comun/impresos-estilos.js';
import {
  consultarExistenciasTelaColor,
  type ParametrosExistenciasTelaColor,
} from '../partidas-telas.js';
import type { ExistenciasTelaColorLista } from '../../../contrato/index.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Una fila del impreso: un tela×color×almacén con sus DOS componentes. */
export interface FilaImpresoTela {
  tela: string;
  /** Tipo/categoría y proveedor de la tela (la segunda línea de la pantalla). */
  contextoTela: string;
  color: string;
  pantone: string;
  almacen: string;
  /** Unidad de la tela ya en su etiqueta corta ("kg" / "m"). */
  unidad: string;
  cuerpo: number;
  /** `null` = la tela NO lleva complemento (en la pantalla es un "—", no un 0). */
  complemento: number | null;
}

/** Todo lo que necesita el impreso de inventario de telas, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoInventarioTelas {
  empresa: string;
  fecha: string;
  filas: FilaImpresoTela[];
  totalRenglones: number;
  /** Colores distintos del universo COMPLETO del filtro (el KPI «Colores» de la pantalla). */
  totalColores: number;
  totalCuerpo: number;
  totalComplemento: number;
}

/** Etiqueta corta de la unidad de medida de la tela (misma que pinta la pantalla). */
function etiquetaUnidad(unidad: 'KG' | 'M'): string {
  return unidad === 'KG' ? 'kg' : 'm';
}

/**
 * Proyecta la respuesta de existencias por color a la tabla del impreso: DESDOBLA el árbol
 * tela → colores → almacenes en un renglón por tela×color×almacén (así el papel se puede llevar a
 * la bodega y los totales cuadran con la barra de pie de la pantalla, que suma todos los almacenes).
 * El complemento va `null` en las telas que no lo llevan (la pantalla pinta "—", no un 0).
 */
export function armarFilasImpreso(lista: ExistenciasTelaColorLista): FilaImpresoTela[] {
  const filas: FilaImpresoTela[] = [];
  for (const tela of lista.telas) {
    const llevaComplemento = tela.nombreComplemento !== null;
    const contexto = [tela.categoria, tela.proveedor, tela.nombreProveedor]
      .filter((parte): parte is string => parte !== null && parte.length > 0)
      .join(' · ');
    for (const color of tela.colores) {
      for (const almacen of color.almacenes) {
        filas.push({
          tela: tela.nombre,
          contextoTela: contexto.length > 0 ? contexto : '—',
          color: color.nombre,
          pantone: color.pantone ?? '—',
          almacen: almacen.almacen,
          unidad: etiquetaUnidad(tela.unidadMedida),
          cuerpo: almacen.cuerpo,
          complemento: llevaComplemento ? almacen.complemento : null,
        });
      }
    }
  }
  return filas;
}

/** Dependencias inyectables (los tests inyectan un `consultarExistenciasTelaColor` fake, sin BD). */
export interface DepsImpresoInventarioTelas {
  consultarExistenciasTelaColor?: typeof consultarExistenciasTelaColor;
}

/** Resuelve los datos del impreso de inventario de telas (A9). Reusa `consultarExistenciasTelaColor`. */
export async function armarDatosImpresoInventarioTelas(
  sesion: SesionUsuario,
  parametros: ParametrosExistenciasTelaColor = {},
  bd?: ContextoBd,
  deps: DepsImpresoInventarioTelas = {},
): Promise<DatosImpresoInventarioTelas> {
  const consultar = deps.consultarExistenciasTelaColor ?? consultarExistenciasTelaColor;
  const lista = await consultar(sesion, parametros, bd);
  const todas = armarFilasImpreso(lista);
  // Blindaje: se DIBUJAN a lo más `MAX_FILAS_PDF` renglones (miles bloquearían el render), pero el
  // conteo y las Σ siguen siendo del universo COMPLETO del filtro (no del truncado).
  return {
    empresa: sesion.nombreEmpresaActiva,
    fecha: new Date().toISOString().slice(0, 10),
    filas: todas.slice(0, MAX_FILAS_PDF),
    totalRenglones: todas.length,
    totalColores: lista.telas.reduce((suma, t) => suma + t.colores.length, 0),
    totalCuerpo: lista.totalCuerpo,
    totalComplemento: lista.totalComplemento,
  };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

const estilos = StyleSheet.create({
  // Anchos de columna PROPIOS de esta tabla (lo compartido vive en `estilosDoc`).
  cTela: { width: '20%' },
  cContexto: { width: '18%' },
  cColor: { width: '15%' },
  cPantone: { width: '10%' },
  cAlmacen: { width: '15%' },
  cUnidad: { width: '5%' },
  cCuerpo: { width: '8.5%', textAlign: 'right' },
  cComplemento: { width: '8.5%', textAlign: 'right' },
  cTotalEtiqueta: { width: '83%' },
});

/** Encabezado de la tabla de existencias. */
function filaEncabezado(): ReactElement {
  return h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.cTela] }, 'Tela'),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.cContexto] },
      'Tipo / proveedor',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.cColor] }, 'Color'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.cPantone] }, 'Pantone'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.cAlmacen] }, 'Almacén'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.cUnidad] }, 'U.'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.cCuerpo] }, 'Cuerpo'),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.cComplemento] },
      'Complemento',
    ),
  );
}

/** Una fila de existencia de tela×color×almacén. */
function filaTela(f: FilaImpresoTela, i: number): ReactElement {
  return h(
    View,
    { style: estilosDoc.filaTabla, key: `fila-${i}`, wrap: false },
    h(Text, { style: [estilosDoc.celda, estilos.cTela] }, f.tela),
    h(Text, { style: [estilosDoc.celda, estilos.cContexto] }, f.contextoTela),
    h(Text, { style: [estilosDoc.celda, estilos.cColor] }, f.color),
    h(Text, { style: [estilosDoc.celda, estilos.cPantone] }, f.pantone),
    h(Text, { style: [estilosDoc.celda, estilos.cAlmacen] }, f.almacen),
    h(Text, { style: [estilosDoc.celda, estilos.cUnidad] }, f.unidad),
    h(Text, { style: [estilosDoc.celda, estilos.cCuerpo] }, f.cuerpo.toLocaleString('es-MX')),
    h(
      Text,
      { style: [estilosDoc.celda, estilos.cComplemento] },
      // "—" (no 0) cuando la tela no lleva complemento: igual que la pantalla.
      f.complemento === null ? '—' : f.complemento.toLocaleString('es-MX'),
    ),
  );
}

/** Fila de TOTAL general (cuadra con la barra de pie de «Inventario de telas»). */
function filaTotal(datos: DatosImpresoInventarioTelas): ReactElement {
  return h(
    View,
    { style: [estilosDoc.filaTabla, estilosDoc.filaTotal], key: 'total' },
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.cTotalEtiqueta] },
      `Total — ${datos.totalColores} color(es) en ${datos.totalRenglones} renglón(es)`,
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.cCuerpo] },
      datos.totalCuerpo.toLocaleString('es-MX'),
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.cComplemento] },
      datos.totalComplemento.toLocaleString('es-MX'),
    ),
  );
}

/** La página del impreso de inventario de telas. */
function paginaInventario(datos: DatosImpresoInventarioTelas): ReactElement {
  const cuerpo =
    datos.filas.length === 0
      ? [
          h(
            Text,
            { style: estilosDoc.vacio, key: 'vacio' },
            'Sin existencias de tela para mostrar.',
          ),
        ]
      : [filaEncabezado(), ...datos.filas.map((f, i) => filaTela(f, i)), filaTotal(datos)];

  const textoTruncado = leyendaTruncado(datos.filas.length, datos.totalRenglones);
  const aviso = textoTruncado === null ? [] : [LeyendaTruncado(textoTruncado)];

  return h(
    Page,
    { key: 'pagina', size: 'A4', orientation: 'landscape', style: estilosDoc.pagina },
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Inventario de telas (existencias por tela × color × almacén) — CONTROL v2',
      derecha: { etiqueta: 'Fecha de corte', valor: datos.fecha },
    }),
    ...cuerpo,
    ...aviso,
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Inventario de telas · ${datos.totalColores} colores · ${datos.totalCuerpo.toLocaleString('es-MX')} de cuerpo · ${datos.totalComplemento.toLocaleString('es-MX')} de complemento`,
    }),
  );
}

/** Documento del inventario de telas. */
function documentoInventario(datos: DatosImpresoInventarioTelas): ReactElement<DocumentProps> {
  return h(
    Document,
    { title: 'Inventario de telas', author: datos.empresa, subject: 'Inventario de telas' },
    paginaInventario(datos),
  );
}

/** Genera el PDF (Buffer) del inventario de telas a partir de sus datos resueltos. */
export async function generarPdfInventarioTelas(
  datos: DatosImpresoInventarioTelas,
): Promise<Buffer> {
  return renderToBuffer(documentoInventario(datos));
}

/** Resuelve los datos del inventario de telas (A9) y devuelve su PDF. */
export async function impresoInventarioTelas(
  sesion: SesionUsuario,
  parametros: ParametrosExistenciasTelaColor = {},
  bd?: ContextoBd,
  deps: DepsImpresoInventarioTelas = {},
): Promise<Buffer> {
  const datos = await armarDatosImpresoInventarioTelas(sesion, parametros, bd, deps);
  return renderizarPdfEnWorker('inventario-telas', datos, { idEmpresa: sesion.idEmpresaActiva });
}
