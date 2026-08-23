/**
 * Impreso del ESTATUS de materiales de una orden (F4-E4, R9 — REQUISITOS-NUEVOS.md §R7). El PDF del
 * tablero "qué tengo / qué falta": por cada material requerido, lo requerido vs lo que está en OC vs
 * lo recibido, con su semáforo. Documento generado EN EL SERVIDOR con `@react-pdf/renderer`. El
 * frontend solo abre el blob.
 *
 * Innegociables aplicados:
 *  • A1 — TODO el armado vive aquí (dominio); la ruta solo valida permiso+Zod y delega.
 *  • A4/A9 — la autorización y el filtro por empresa los hace `estatusMaterialesOrden` (`compras.ver`).
 *  • REUSO — los datos se arman con `estatusMaterialesOrden` (el mismo cruce R7 de la pantalla); el
 *    impreso es una vista del mismo dato, NO recalcula nada.
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

import type { EstatusMaterial } from '../../../contrato/index.js';
import { verificarPermiso, type SesionUsuario } from '../../../comun/permisos.js';
import { type ContextoBd } from '../../../comun/transaccion.js';
import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';
import {
  estilosDoc,
  PALETA,
  EncabezadoDocumento,
  PieDocumento,
} from '../../../comun/impresos-estilos.js';
import { estatusMaterialesOrden } from '../mrp.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Un renglón del estatus para imprimir. */
export interface LineaImpresoEstatus {
  material: string;
  unidad: string | null;
  requerido: number;
  enOc: number;
  recibido: number;
  estatus: EstatusMaterial | 'no-identificado-en-oc';
}

/** Todo lo que necesita el PDF del estatus, ya RESUELTO (sin BD). */
export interface DatosImpresoEstatus {
  empresa: string;
  folioOrden: number;
  tieneSnapshot: boolean;
  lineas: LineaImpresoEstatus[];
}

// ── Resolución de datos (lo único que toca BD) ───────────────────────────────────────────────────

/** Dependencias inyectables (los tests pasan un fake para no tocar la BD). */
export interface DepsImpresoEstatus {
  estatusMaterialesOrden?: typeof estatusMaterialesOrden;
}

/** Etiqueta legible de un estatus para el PDF. */
function etiquetaEstatus(estatus: string, tipo: string): string {
  if (tipo === 'no-identificado') return 'No identificado';
  switch (estatus) {
    case 'pendiente':
      return 'Pendiente';
    case 'en-oc':
      return 'En OC';
    case 'recibido-parcial':
      return 'Recibido parcial';
    case 'completo':
      return 'Completo';
    case 'cubierto-por-stock':
      return 'Cubierto por stock';
    default:
      return estatus;
  }
}

/**
 * Resuelve los datos del impreso de estatus (A9: por la empresa activa). Reúsa
 * `estatusMaterialesOrden` (mismo cruce R7). Lanza `ErrorNoEncontrado` (404) si la orden no es de la
 * empresa.
 */
export async function armarDatosImpresoEstatus(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
  deps: DepsImpresoEstatus = {},
): Promise<DatosImpresoEstatus> {
  verificarPermiso(sesion, 'compras.ver');
  const consultar = deps.estatusMaterialesOrden ?? estatusMaterialesOrden;
  const r = await consultar(sesion, idOrden, bd);

  return {
    empresa: sesion.nombreEmpresaActiva,
    folioOrden: r.folioOrden,
    tieneSnapshot: r.tieneSnapshot,
    lineas: r.filas.map((f) => ({
      material: f.material,
      unidad: f.unidad,
      requerido: f.requerido,
      enOc: f.enOc,
      recibido: f.recibido,
      estatus: f.tipo === 'no-identificado' ? 'no-identificado-en-oc' : f.estatus,
    })),
  };
}

// ── Documento PDF (react-pdf, sin JSX: `createElement`) ──────────────────────────────────────────

const estilos = StyleSheet.create({
  // Estilos PROPIOS de esta tabla (lo compartido vive en `estilosDoc`).
  celdaMaterial: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  celdaNum: { width: 50, textAlign: 'right' },
  celdaUnidad: { width: 36, textAlign: 'center' },
  celdaEstatus: { width: 96, textAlign: 'left' },
  aviso: { fontSize: 8, color: PALETA.muted, marginBottom: 6 },
});

/** Formatea una cantidad (hasta 4 decimales). */
function num(valor: number): string {
  return valor.toLocaleString('es-MX', { maximumFractionDigits: 4 });
}

/** Tabla del estatus. */
function tablaEstatus(datos: DatosImpresoEstatus): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaMaterial] },
      'Material',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaUnidad] }, 'Un.'),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNum] },
      'Requerido',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNum] }, 'En OC'),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNum] },
      'Recibido',
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaEstatus] },
      'Estatus',
    ),
  );
  const filas = datos.lineas.map((l, i) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `f-${i}` },
      h(Text, { style: [estilosDoc.celda, estilos.celdaMaterial] }, l.material),
      h(Text, { style: [estilosDoc.celda, estilos.celdaUnidad] }, l.unidad ?? '—'),
      h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, num(l.requerido)),
      h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, num(l.enOc)),
      h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, num(l.recibido)),
      h(
        Text,
        { style: [estilosDoc.celda, estilos.celdaEstatus] },
        etiquetaEstatus(
          l.estatus,
          l.estatus === 'no-identificado-en-oc' ? 'no-identificado' : 'mat',
        ),
      ),
    ),
  );
  return h(View, { style: estilosDoc.seccion }, filaEncabezado, ...filas);
}

/** Página = el estatus de una orden. */
function paginaEstatus(datos: DatosImpresoEstatus): ReactElement {
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Estatus de materiales (qué tengo / qué falta) — CONTROL v2',
      derecha: { etiqueta: 'Orden', valor: String(datos.folioOrden), grande: true },
    }),
    !datos.tieneSnapshot
      ? h(
          Text,
          { style: estilos.aviso, key: 'aviso' },
          'La orden aún no se ha explosionado: el cruce solo muestra lo que ya esté en órdenes de compra.',
        )
      : null,
    datos.lineas.length === 0
      ? h(Text, { style: estilosDoc.vacio, key: 'vacio' }, 'Sin materiales para mostrar.')
      : tablaEstatus(datos),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Estatus de materiales de la orden ${datos.folioOrden}`,
    }),
  ];
  return h(
    Page,
    { key: 'pagina-0', size: 'A4', style: estilosDoc.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de UN estatus. */
function documentoEstatus(datos: DatosImpresoEstatus): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Estatus de materiales de la orden ${datos.folioOrden}`,
      author: datos.empresa,
      subject: 'Estatus de materiales',
    },
    paginaEstatus(datos),
  );
}

// ── Generación del Buffer (función pura: recibe datos resueltos) ──────────────────────────────────

/** Genera el PDF (Buffer) del estatus a partir de sus datos ya resueltos. */
export async function generarPdfEstatusMateriales(datos: DatosImpresoEstatus): Promise<Buffer> {
  return renderToBuffer(documentoEstatus(datos));
}

// ── Orquestación de alto nivel (resuelve datos + genera) — la usa la ruta ─────────────────────────

/** Resultado de generar el impreso de estatus (Buffer + folio para el `filename`). */
export interface ImpresoEstatusMateriales {
  buffer: Buffer;
  folioOrden: number;
}

/** Resuelve los datos del estatus (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoEstatusMateriales(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
  deps: DepsImpresoEstatus = {},
): Promise<ImpresoEstatusMateriales> {
  const datos = await armarDatosImpresoEstatus(sesion, idOrden, bd, deps);
  const buffer = await renderizarPdfEnWorker('estatus-materiales', datos, {
    idEmpresa: sesion.idEmpresaActiva,
  });
  return { buffer, folioOrden: datos.folioOrden };
}
