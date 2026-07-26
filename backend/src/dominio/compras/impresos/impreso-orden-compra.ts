/**
 * Impreso de la ORDEN DE COMPRA (F4-E2) — el PDF que se le manda al proveedor para comprar
 * material (telas/avíos). Documento generado EN EL SERVIDOR con `@react-pdf/renderer`
 * (`renderToBuffer`), el mismo motor que los demás impresos del sistema (orden de producción,
 * envío de maquila, etc.). El frontend solo abre el blob.
 *
 * Decisiones del dueño (Daniel, cerradas):
 *  • (c) UN SOLO PDF de OC (se retiran las variantes viejas y el Excel). La matriz talla×color del
 *    renglón que la use se imprime como tabla. La cantidad del renglón = Σ de su matriz.
 *  • A diferencia de la orden de PRODUCCIÓN, la OC SÍ lleva importes (precio, importe, total): es un
 *    documento de COMPRA, no una hoja de piso.
 *
 * Innegociables aplicados:
 *  • A1 — TODA la lógica de armado vive aquí (dominio); la ruta solo valida permiso+Zod y delega.
 *  • A4 — la autorización la hace `obtenerOC` (`verificarPermiso(sesion, 'compras.ver')`).
 *  • A9 — la OC se resuelve por `obtenerOC`, que filtra por la empresa activa de la sesión (una OC de
 *    otra empresa, para esta sesión, no existe → `ErrorNoEncontrado`/404).
 *  • REUSO — los datos se arman con `obtenerOC` (encabezado + líneas + matriz + total derivado). NO
 *    se reinventa la consulta ni el cálculo del total; el impreso es una vista del mismo dato.
 *
 * Es PURO sobre los datos: `armarDatosImpresoOC` resuelve (única parte que toca BD) y
 * `generarPdfOrdenCompra` recibe los datos ya resueltos (testeable sin BD). `obtenerOC` es un seam
 * inyectable para los tests.
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
  estilosDoc,
  PALETA,
  EncabezadoDocumento,
  PieDocumento,
  TituloSeccion,
  BandaEstado,
} from '../../../comun/impresos-estilos.js';

import { verificarPermiso, type SesionUsuario } from '../../../comun/permisos.js';
import { type ContextoBd } from '../../../comun/transaccion.js';
import { obtenerOC } from '../ordenes-compra.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Una celda de la matriz talla×color de un renglón (para imprimirla como tabla). */
export interface CeldaMatrizImpreso {
  color: string;
  talla: string;
  cantidad: number;
}

/** Un renglón del impreso de la OC, con su importe derivado y (opcional) su matriz. */
export interface LineaImpresoOC {
  /** Texto del material: nombre de tela/avío, o la descripción libre. */
  material: string;
  cantidad: number;
  unidad: string | null;
  precio: number;
  importe: number;
  /** Folio de la orden de producción ligada (R7), o null. */
  folioOrden: number | null;
  /** Matriz talla×color del renglón (vacía si no aplica). */
  matriz: CeldaMatrizImpreso[];
}

/**
 * Todo lo que necesita el documento PDF de UNA orden de compra, ya RESUELTO (sin BD): así
 * `generarPdfOrdenCompra` es una función pura y testeable. El total CUADRA con `CompraSalida.total`.
 */
export interface DatosImpresoOC {
  empresa: string;
  numCompra: number;
  estatus: string;
  cancelada: boolean;
  motivoCancelacion: string | null;
  proveedor: string;
  fecha: string | null;
  fechaEntrega: string | null;
  entregaEn: string | null;
  observaciones: string | null;
  correspondeA: string | null;
  /** Facturas amparadas en v1 (solo lectura, lo llena el ETL), o null. */
  facturasAmparadasLegacy: string | null;
  lineas: LineaImpresoOC[];
  total: number;
}

// ── Resolución de datos (lo único que toca BD) ───────────────────────────────────────────────────

/**
 * Dependencias inyectables de la resolución de datos. Por defecto usa la lectura de dominio real
 * (`obtenerOC`, que ya verifica permiso + empresa activa). Los tests inyectan un fake para no tocar
 * la BD.
 */
export interface DepsImpresoOC {
  obtenerOC?: typeof obtenerOC;
}

/** Texto del material de un renglón: nombre de tela/avío, o la descripción libre, o "—". */
function textoMaterial(linea: {
  tela: string | null;
  avio: string | null;
  descripcionLibre: string | null;
}): string {
  return linea.tela ?? linea.avio ?? linea.descripcionLibre ?? '—';
}

/**
 * Resuelve TODOS los datos del impreso de una OC (A9: por la empresa activa de la sesión). Reúsa
 * `obtenerOC` (encabezado + líneas + matriz + total derivado): el impreso es una vista del mismo
 * dato, no recalcula nada. Lanza `ErrorNoEncontrado` (404) si la OC no es de la empresa activa.
 */
export async function armarDatosImpresoOC(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
  deps: DepsImpresoOC = {},
): Promise<DatosImpresoOC> {
  verificarPermiso(sesion, 'compras.ver');
  const obtener = deps.obtenerOC ?? obtenerOC;

  // `obtenerOC` ya verifica permiso + empresa activa (A9) y deriva el total.
  const oc = await obtener(sesion, id, bd);

  return {
    empresa: sesion.nombreEmpresaActiva,
    numCompra: oc.numCompra,
    estatus: oc.estatus,
    cancelada: oc.estatus === 'cancelada',
    motivoCancelacion: oc.motivoCancelacion,
    proveedor: oc.proveedor,
    fecha: oc.fecha,
    fechaEntrega: oc.fechaEntrega,
    entregaEn: oc.entregaEn,
    observaciones: oc.observaciones,
    correspondeA: oc.correspondeA,
    facturasAmparadasLegacy: oc.facturasAmparadasLegacy,
    lineas: oc.lineas.map((l) => ({
      material: textoMaterial(l),
      cantidad: l.cantidad,
      unidad: l.unidad,
      precio: l.precio,
      importe: l.subtotal,
      folioOrden: l.folioOrden,
      matriz: l.tallas.map((t) => ({
        color: t.color,
        talla: t.etiquetaTalla,
        cantidad: t.cantidad,
      })),
    })),
    total: oc.total,
  };
}

// ── Documento PDF (react-pdf, sin JSX: `createElement`) ──────────────────────────────────────────

const estilos = StyleSheet.create({
  // Anchos de columna PROPIOS de esta tabla (lo compartido vive en `estilosDoc`).
  celdaMaterial: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  celdaNum: { width: 58, textAlign: 'right' },
  celdaUnidad: { width: 46, textAlign: 'center' },
  celdaOrden: { width: 50, textAlign: 'center' },
  // Sub-tabla de la matriz talla×color de un renglón.
  matrizContenedor: { marginTop: 2, marginBottom: 4, marginLeft: 8 },
  matrizTitulo: { fontSize: 7, color: PALETA.muted, marginBottom: 1 },
  celdaMatriz: { width: 70, textAlign: 'left' },
});

/** Formatea un importe en pesos (2 decimales con separador de miles). */
function pesos(valor: number): string {
  return `$${valor.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Un campo etiqueta/valor del encabezado. */
function campo(etiqueta: string, valor: string | null, ancho = false): ReactElement {
  return h(
    View,
    { style: ancho ? estilosDoc.campoDosTercios : estilosDoc.campoTercio, key: etiqueta },
    h(Text, { style: estilosDoc.etiquetaCampo }, etiqueta),
    h(Text, { style: estilosDoc.valorCampo }, valor ?? '—'),
  );
}

/** Banda roja "CANCELADA" + motivo (solo si la OC está cancelada). */
function bandaCancelada(datos: DatosImpresoOC): ReactElement | null {
  if (!datos.cancelada) {
    return null;
  }
  return BandaEstado({
    titulo: 'ORDEN DE COMPRA CANCELADA',
    detalle: `Motivo: ${datos.motivoCancelacion ?? 'sin especificar'}`,
  });
}

/** Sub-tabla de la matriz talla×color de un renglón (solo si el renglón la usa). */
function matrizLinea(linea: LineaImpresoOC, clave: string): ReactElement | null {
  if (linea.matriz.length === 0) {
    return null;
  }
  return h(
    View,
    { style: estilos.matrizContenedor, key: clave },
    h(Text, { style: estilos.matrizTitulo }, 'Desglose por talla y color:'),
    ...linea.matriz.map((c, i) =>
      h(
        View,
        { style: estilosDoc.filaTabla, key: `m-${i}` },
        h(Text, { style: [estilosDoc.celda, estilos.celdaMatriz] }, c.color),
        h(Text, { style: [estilosDoc.celda, estilos.celdaMatriz] }, c.talla),
        h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, String(c.cantidad)),
      ),
    ),
  );
}

/** Tabla de renglones de la OC (material, cantidad, unidad, precio, importe, orden ligada). */
function tablaLineas(datos: DatosImpresoOC): ReactElement {
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
      'Cantidad',
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaUnidad] },
      'Unidad',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNum] }, 'Precio'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNum] }, 'Importe'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaOrden] }, 'Orden'),
  );

  const filas: ReactElement[] = [];
  datos.lineas.forEach((l, i) => {
    filas.push(
      h(
        View,
        { style: estilosDoc.filaTabla, key: `fila-${i}` },
        h(Text, { style: [estilosDoc.celda, estilos.celdaMaterial] }, l.material),
        h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, String(l.cantidad)),
        h(Text, { style: [estilosDoc.celda, estilos.celdaUnidad] }, l.unidad ?? '—'),
        h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, pesos(l.precio)),
        h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, pesos(l.importe)),
        h(
          Text,
          { style: [estilosDoc.celda, estilos.celdaOrden] },
          l.folioOrden === null ? '—' : String(l.folioOrden),
        ),
      ),
    );
    const matriz = matrizLinea(l, `matriz-${i}`);
    if (matriz !== null) {
      filas.push(matriz);
    }
  });

  const filaTotal = h(
    View,
    { style: [estilosDoc.filaTabla, estilosDoc.filaTotal], key: 'total' },
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaMaterial] },
      'Total de la orden de compra',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaNum] }, ''),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaUnidad] }, ''),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaNum] }, ''),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaNum] },
      pesos(datos.total),
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaOrden] }, ''),
  );

  const cuerpo =
    datos.lineas.length === 0
      ? [h(Text, { style: estilosDoc.vacio, key: 'vacio' }, 'Sin renglones capturados.')]
      : [filaEncabezado, ...filas, filaTotal];

  return h(View, { style: estilosDoc.seccion }, TituloSeccion('Renglones'), ...cuerpo);
}

/** Una página = una orden de compra. */
function paginaOC(datos: DatosImpresoOC, clave: string): ReactElement {
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Orden de compra — CONTROL v2',
      derecha: { etiqueta: 'Folio', valor: String(datos.numCompra), grande: true },
    }),
    bandaCancelada(datos),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Proveedor', datos.proveedor, true),
      campo('Estatus', datos.estatus),
      campo('Fecha', datos.fecha),
      campo('Fecha de entrega', datos.fechaEntrega),
      campo('Entregar en', datos.entregaEn, true),
      campo('Corresponde a', datos.correspondeA, true),
    ),
    datos.observaciones
      ? h(
          View,
          { style: estilosDoc.campoDosTercios, key: 'obs' },
          h(Text, { style: estilosDoc.etiquetaCampo }, 'Observaciones'),
          h(Text, { style: estilosDoc.valorCampoTexto }, datos.observaciones),
        )
      : null,
    datos.facturasAmparadasLegacy
      ? h(
          View,
          { style: estilosDoc.campoDosTercios, key: 'facturas' },
          h(Text, { style: estilosDoc.etiquetaCampo }, 'Facturas amparadas (histórico)'),
          h(Text, { style: estilosDoc.valorCampoTexto }, datos.facturasAmparadasLegacy),
        )
      : null,
    tablaLineas(datos),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Orden de compra ${datos.numCompra} · Total ${pesos(datos.total)}`,
    }),
  ];

  return h(
    Page,
    { key: clave, size: 'A4', style: estilosDoc.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de UNA orden de compra. */
function documentoOC(datos: DatosImpresoOC): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Orden de compra ${datos.numCompra}`,
      author: datos.empresa,
      subject: 'Orden de compra',
    },
    paginaOC(datos, 'pagina-0'),
  );
}

// ── Generación del Buffer (función pura: recibe datos resueltos) ──────────────────────────────────

/** Genera el PDF (Buffer) de una OC a partir de sus datos ya resueltos. */
export async function generarPdfOrdenCompra(datos: DatosImpresoOC): Promise<Buffer> {
  return renderToBuffer(documentoOC(datos));
}

// ── Orquestación de alto nivel (resuelve datos + genera) — la usa la ruta ─────────────────────────

/** Resultado de generar el impreso de una OC (Buffer + folio para el `filename`). */
export interface ImpresoOC {
  buffer: Buffer;
  numCompra: number;
}

/** Resuelve los datos de una OC (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoOrdenCompra(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
  deps: DepsImpresoOC = {},
): Promise<ImpresoOC> {
  const datos = await armarDatosImpresoOC(sesion, id, bd, deps);
  const buffer = await renderizarPdfEnWorker('orden-compra', datos, {
    idEmpresa: sesion.idEmpresaActiva,
  });
  return { buffer, numCompra: datos.numCompra };
}
