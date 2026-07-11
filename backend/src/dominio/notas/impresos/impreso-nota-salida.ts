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

import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';
import {
  estilosDoc,
  EncabezadoDocumento,
  PieDocumento,
  TituloSeccion,
  BandaEstado,
} from '../../../comun/impresos-estilos.js';

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

const estilos = StyleSheet.create({
  // Anchos de columna PROPIOS de esta tabla (lo compartido vive en `estilosDoc`).
  celdaMaterial: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  celdaTipo: { width: 42, textAlign: 'center' },
  celdaLote: { width: 70, textAlign: 'left' },
  celdaNum: { width: 56, textAlign: 'right' },
  celdaUnidad: { width: 46, textAlign: 'center' },
  celdaOrden: { width: 50, textAlign: 'center' },
});

/** Un campo etiqueta/valor del encabezado. */
function campo(etiqueta: string, valor: string | null, ancho = false): ReactElement {
  return h(
    View,
    { style: ancho ? estilosDoc.campoDosTercios : estilosDoc.campoTercio, key: etiqueta },
    h(Text, { style: estilosDoc.etiquetaCampo }, etiqueta),
    h(Text, { style: estilosDoc.valorCampo }, valor ?? '—'),
  );
}

/** Banda roja "CANCELADA" + motivo (solo si la nota está cancelada). */
function bandaCancelada(datos: DatosImpresoNotaSalida): ReactElement | null {
  if (!datos.cancelada) {
    return null;
  }
  return BandaEstado({
    titulo: 'NOTA DE SALIDA CANCELADA',
    detalle: `Motivo: ${datos.motivoCancelacion ?? 'sin especificar'}`,
  });
}

/** Tabla de renglones de la nota (orden, tipo, material, lote, cantidad, unidad). */
function tablaLineas(datos: DatosImpresoNotaSalida): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaOrden] }, 'Orden'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaTipo] }, 'Tipo'),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaMaterial] },
      'Material',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaLote] }, 'Lote'),
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
  );

  const filas = datos.lineas.map((l, i) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `fila-${i}` },
      h(
        Text,
        { style: [estilosDoc.celda, estilos.celdaOrden] },
        l.folioOrden === null ? '—' : String(l.folioOrden),
      ),
      h(
        Text,
        { style: [estilosDoc.celda, estilos.celdaTipo] },
        l.tipo === 'avio' ? 'Avío' : 'Tela',
      ),
      h(Text, { style: [estilosDoc.celda, estilos.celdaMaterial] }, l.material),
      h(Text, { style: [estilosDoc.celda, estilos.celdaLote] }, l.lote ?? '—'),
      h(Text, { style: [estilosDoc.celda, estilos.celdaNum] }, String(l.cantidad)),
      h(Text, { style: [estilosDoc.celda, estilos.celdaUnidad] }, l.unidad ?? '—'),
    ),
  );

  const cuerpo =
    datos.lineas.length === 0
      ? [h(Text, { style: estilosDoc.vacio, key: 'vacio' }, 'Sin renglones capturados.')]
      : [filaEncabezado, ...filas];

  return h(View, { style: estilosDoc.seccion }, TituloSeccion('Renglones'), ...cuerpo);
}

/** Una página = una nota de salida. */
function paginaNotaSalida(datos: DatosImpresoNotaSalida, clave: string): ReactElement {
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Nota de salida a maquilero — CONTROL v2',
      derecha: { etiqueta: 'Folio', valor: String(datos.numNota), grande: true },
    }),
    bandaCancelada(datos),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Maquilero', datos.maquilero, true),
      campo('Estatus', datos.estatus),
      campo('Almacén origen', datos.almacen, true),
      campo('Fecha de elaboración', datos.fechaElaboracion),
      campo('Fecha de envío', datos.fechaEnvio),
    ),
    datos.observaciones
      ? h(
          View,
          { style: estilosDoc.campoDosTercios, key: 'obs' },
          h(Text, { style: estilosDoc.etiquetaCampo }, 'Observaciones'),
          h(Text, { style: estilosDoc.valorCampoTexto }, datos.observaciones),
        )
      : null,
    tablaLineas(datos),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Nota de salida ${datos.numNota} · Maquilero ${datos.maquilero}`,
    }),
  ];

  return h(
    Page,
    { key: clave, size: 'A4', style: estilosDoc.pagina },
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
  const buffer = await renderizarPdfEnWorker('nota-salida', datos);
  return { buffer, numNota: datos.numNota };
}
