/**
 * Impreso de la EXPLOSIÓN de materiales de una orden (F4-E4, R9 — REQUISITOS-NUEVOS.md §R3). El PDF
 * que resume QUÉ y CUÁNTO material hay que comprar para una orden, agrupado por proveedor sugerido,
 * con el neteo de genéricos visible (decisión (d)). Documento generado EN EL SERVIDOR con
 * `@react-pdf/renderer` (`renderToBuffer`), el mismo motor que los demás impresos del sistema. El
 * frontend solo abre el blob.
 *
 * Innegociables aplicados:
 *  • A1 — TODO el armado vive aquí (dominio); la ruta solo valida permiso+Zod y delega.
 *  • A4/A9 — la autorización y el filtro por empresa los hace `explosionarOrden` (`compras.ver`).
 *  • REUSO — los datos se arman con `explosionarOrden` (el mismo cálculo de la pantalla); el impreso
 *    es una vista del mismo dato, NO recalcula nada.
 *
 * `armarDatosImpresoExplosion` resuelve (única parte que toca BD) y `generarPdfExplosion` recibe los
 * datos ya resueltos (testeable sin BD). `explosionarOrden` es un seam inyectable para los tests.
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
import { textoDesglose, type DesgloseMedida } from '../desglose-por-medida.js';
import { type ContextoBd } from '../../../comun/transaccion.js';
import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';
import {
  estilosDoc,
  EncabezadoDocumento,
  PieDocumento,
  TituloSeccion,
} from '../../../comun/impresos-estilos.js';
import { explosionarOrden } from '../mrp.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Un renglón de la explosión para imprimir. */
export interface LineaImpresoExplosion {
  material: string;
  requerido: number;
  unidad: string | null;
  esGenerico: boolean;
  existenciaStock: number;
  /**
   * ⭐ V1-E3q (§Post-F9.85): lo que **de verdad falta comprar** = requerido − stock − lo que ya está
   * en una OC viva. Antes esta columna traía la DEMANDA a secas (`cantidadAComprar`), así que un
   * impreso hecho DESPUÉS de generar la OC decía "compra 180" de algo ya pedido — el mismo defecto
   * que Daniel encontró en la pantalla, sólo que en papel y sin nadie que lo contradiga.
   */
  aComprar: number;
  precioSugerido: number | null;
}

/**
 * ⭐⭐ V1-E8c (§Post-F9.126) — el texto del material CON su color y su desglose por medida.
 * `Felpa 280 · Marino` · `CIE-53 — Cierre · Rojo (53 cm: 1,200 · 60 cm: 800)`.
 */
function nombreDeMaterial(r: {
  material: string;
  telaColor: string | null;
  colorPrenda: string | null;
  medidas: readonly DesgloseMedida[];
}): string {
  const color = r.telaColor ?? r.colorPrenda;
  const base = color === null ? r.material : `${r.material} · ${color}`;
  const desglose = textoDesglose(r.medidas);
  return desglose === '' ? base : `${base} (${desglose})`;
}

/** Un grupo de materiales por proveedor sugerido. */
export interface GrupoImpresoExplosion {
  proveedor: string;
  lineas: LineaImpresoExplosion[];
}

/** Todo lo que necesita el PDF de explosión, ya RESUELTO (sin BD). */
export interface DatosImpresoExplosion {
  empresa: string;
  folioOrden: number;
  modelo: string;
  totalPiezas: number;
  grupos: GrupoImpresoExplosion[];
}

// ── Resolución de datos (lo único que toca BD) ───────────────────────────────────────────────────

/** Dependencias inyectables (los tests pasan un fake para no tocar la BD). */
export interface DepsImpresoExplosion {
  explosionarOrden?: typeof explosionarOrden;
}

/**
 * Resuelve los datos del impreso de explosión (A9: por la empresa activa). Reúsa `explosionarOrden`
 * (mismo cálculo de la pantalla). Lanza `ErrorNoEncontrado` (404) si la orden no es de la empresa.
 */
export async function armarDatosImpresoExplosion(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
  deps: DepsImpresoExplosion = {},
): Promise<DatosImpresoExplosion> {
  verificarPermiso(sesion, 'compras.ver');
  const explosionar = deps.explosionarOrden ?? explosionarOrden;
  const ex = await explosionar(sesion, idOrden, bd);

  return {
    empresa: sesion.nombreEmpresaActiva,
    folioOrden: ex.folioOrden,
    modelo: ex.modelo,
    totalPiezas: ex.totalPiezas,
    grupos: ex.grupos.map((g) => ({
      proveedor: g.proveedor,
      lineas: g.renglones.map((r) => ({
        // ⭐⭐ V1-E8c (§Post-F9.126) — **EL COLOR, TAMBIÉN AQUÍ.** Desde V1-E3u un renglón de tela es
        // *(tela, color)* y desde V1-E8c uno de avío es *(avío, color de prenda)*: sin el color en
        // el texto, las cuatro variantes del cierre del ejemplo de Daniel salen como cuatro
        // renglones IDÉNTICOS con cantidades distintas. Y el desglose por medida se pega detrás,
        // que es lo que este papel viene a decir.
        material: nombreDeMaterial(r),
        requerido: r.cantidadRequerida,
        unidad: r.unidad,
        esGenerico: r.esGenerico,
        existenciaStock: r.existenciaStock,
        aComprar: r.cantidadPendiente,
        precioSugerido: r.precioSugerido,
      })),
    })),
  };
}

// ── Documento PDF (react-pdf, sin JSX: `createElement`) ──────────────────────────────────────────

const estilos = StyleSheet.create({
  // Anchos de columna PROPIOS de esta tabla (lo compartido vive en `estilosDoc`).
  celdaMaterial: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  celdaNum: { width: 56, textAlign: 'right' },
  celdaUnidad: { width: 40, textAlign: 'center' },
});

/** Formatea una cantidad (hasta 4 decimales, sin ceros sobrantes). */
function num(valor: number): string {
  return valor.toLocaleString('es-MX', { maximumFractionDigits: 4 });
}

/** Un campo etiqueta/valor del encabezado. */
function campo(etiqueta: string, valor: string): ReactElement {
  return h(
    View,
    { style: estilosDoc.campoTercio, key: etiqueta },
    h(Text, { style: estilosDoc.etiquetaCampo }, etiqueta),
    h(Text, { style: estilosDoc.valorCampo }, valor),
  );
}

/** Tabla de un grupo de proveedor. */
function tablaGrupo(grupo: GrupoImpresoExplosion, idx: number): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaMaterial] },
      'Material',
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNum] },
      'Requerido',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaUnidad] }, 'Un.'),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNum] },
      'En stock',
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNum] },
      'A comprar',
    ),
  );
  const filas = grupo.lineas.map((l, i) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `f-${i}` },
      h(
        Text,
        { style: [estilosDoc.celda, estilos.celdaMaterial] },
        `${l.material}${l.esGenerico ? ' (genérico)' : ''}`,
      ),
      h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, num(l.requerido)),
      h(Text, { style: [estilosDoc.celda, estilos.celdaUnidad] }, l.unidad ?? '—'),
      h(
        Text,
        { style: [estilosDoc.celda, estilos.celdaNum] },
        l.esGenerico ? num(l.existenciaStock) : '—',
      ),
      h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, num(l.aComprar)),
    ),
  );
  return h(
    View,
    { style: estilosDoc.seccion, key: `g-${idx}` },
    TituloSeccion(grupo.proveedor),
    filaEncabezado,
    ...filas,
  );
}

/** Página = la explosión de una orden. */
function paginaExplosion(datos: DatosImpresoExplosion): ReactElement {
  const cuerpo: ReactElement[] =
    datos.grupos.length === 0
      ? [
          h(
            Text,
            { style: estilosDoc.vacio, key: 'vacio' },
            'La orden no requiere materiales (BOM vacío o sin piezas).',
          ),
        ]
      : datos.grupos.map((g, i) => tablaGrupo(g, i));

  return h(
    Page,
    { key: 'pagina-0', size: 'A4', style: estilosDoc.pagina },
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Explosión de materiales (MRP) — CONTROL v2',
      derecha: { etiqueta: 'Orden', valor: String(datos.folioOrden), grande: true },
    }),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Modelo', datos.modelo),
      campo('Total de piezas', num(datos.totalPiezas)),
    ),
    ...cuerpo,
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Explosión de la orden ${datos.folioOrden}`,
    }),
  );
}

/** Documento de UNA explosión. */
function documentoExplosion(datos: DatosImpresoExplosion): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Explosión de la orden ${datos.folioOrden}`,
      author: datos.empresa,
      subject: 'Explosión de materiales',
    },
    paginaExplosion(datos),
  );
}

// ── Generación del Buffer (función pura: recibe datos resueltos) ──────────────────────────────────

/** Genera el PDF (Buffer) de la explosión a partir de sus datos ya resueltos. */
export async function generarPdfExplosion(datos: DatosImpresoExplosion): Promise<Buffer> {
  return renderToBuffer(documentoExplosion(datos));
}

// ── Orquestación de alto nivel (resuelve datos + genera) — la usa la ruta ─────────────────────────

/** Resultado de generar el impreso de explosión (Buffer + folio para el `filename`). */
export interface ImpresoExplosion {
  buffer: Buffer;
  folioOrden: number;
}

/** Resuelve los datos de la explosión (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoExplosion(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
  deps: DepsImpresoExplosion = {},
): Promise<ImpresoExplosion> {
  const datos = await armarDatosImpresoExplosion(sesion, idOrden, bd, deps);
  const buffer = await renderizarPdfEnWorker('explosion', datos, {
    idEmpresa: sesion.idEmpresaActiva,
  });
  return { buffer, folioOrden: datos.folioOrden };
}
