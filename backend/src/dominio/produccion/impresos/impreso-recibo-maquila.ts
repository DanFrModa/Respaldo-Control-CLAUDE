/**
 * Impreso del RECIBO de maquila UNIFICADO (F3-E4, R9; ref. viejo `ReciboMaqImp`/`RecibosEstImp`): la
 * hoja que documenta la recepción de prenda terminada desde maquila. UN PDF parametrizado por
 * `TipoProceso` (costura/estampado/…, D8): el encabezado y la nota cambian según si el proceso metió
 * a inventario PT (costura) o no (estampado/bordado/lavado). Incluye la matriz color×talla con su
 * CALIDAD (primeras/segundas) y los totales, más —si las hubo— las PRENDAS INCOMPLETAS que el
 * maquilero entregó (V1-E8k, §Post-F9.136), en un renglón aparte que dice que no se pagan.
 *
 * Documento generado EN EL SERVIDOR con `@react-pdf/renderer` (`renderToBuffer`), MISMO motor y
 * patrón que `impreso-envio-maquila.ts` (A1: la ruta solo valida permiso+Zod y delega). Reusa
 * `obtenerRecibo` (encabezado + matriz + nombres) — A9: filtra por la empresa activa → 404 si no.
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
  FUENTE,
  EncabezadoDocumento,
  PieDocumento,
  TituloSeccion,
  BandaEstado,
} from '../../../comun/impresos-estilos.js';

import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { obtenerRecibo } from '../recibos.js';
import type { ReciboSalida } from '../../../contrato/index.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Todo lo que necesita el documento de recibo, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoRecibo {
  empresa: string;
  folio: number;
  fecha: string;
  maquilero: string | null;
  proceso: string | null;
  generaEntradaPt: boolean;
  /**
   * El recibo DEVOLVIÓ prendas que estaban en TRÁNSITO (V1-E4b, §Post-F9.61): el envío las había
   * sacado del almacén porque el proceso va DESPUÉS de la costura. Ese recibo también deja
   * mercancía en inventario, aunque el proceso no sea el que la crea — decir "No mete a inventario"
   * ahí sería falso. Se deriva de que el recibo traiga almacén destino sin ser de costura (los
   * almacenes solo se persisten cuando el recibo mueve inventario).
   */
  devuelveDeTransito: boolean;
  almacenPrimeras: string | null;
  almacenSegundas: string | null;
  folioOrden: number;
  precioPactado: number | null;
  observaciones: string | null;
  cancelado: boolean;
  /** Columnas: etiquetas de talla en el orden en que aparecen. */
  tallas: string[];
  /** Renglones color×talla; `cantidades[i]` alinea con `tallas[i]`. */
  renglones: { color: string; cantidades: number[]; totalFila: number }[];
  totalesColumna: number[];
  totalPiezas: number;
  totalPrimeras: number;
  totalSegundas: number;
  /**
   * PRENDAS INCOMPLETAS entregadas (V1-E8k, §Post-F9.136). APARTE de `totalPiezas`: el maquilero
   * las trajo, pero no se produjeron, no entraron a inventario y no se pagan. Va en la hoja porque
   * ésta es la constancia que se firma con él.
   */
  totalIncompletas: number;
}

/**
 * Etiqueta de la fila de la matriz: el color y, cuando la orden se fabrica por packs (§Post-F9.10),
 * SU TENDIDO. El pack tiene que salir en el papel: es lo que el cortador y el maquilero usan para
 * saber qué corrida están manejando, y sin él dos filas del mismo color se leerían como un error de
 * captura. En una orden sin packs es cadena vacía y la fila se imprime exactamente igual que antes.
 */
function etiquetaColorPack(color: string, pack: string): string {
  return pack.trim() === '' ? color : `${color}  ·  PACK ${pack.trim()}`;
}

/** Proyecta la matriz del recibo a la tabla color×talla del impreso (misma forma que el envío). */
export function armarTablaRecibo(
  lineas: ReciboSalida['lineas'],
): Pick<DatosImpresoRecibo, 'tallas' | 'renglones' | 'totalesColumna' | 'totalPiezas'> {
  const tallas: string[] = [];
  for (const linea of lineas) {
    for (const t of linea.tallas) {
      if (!tallas.includes(t.etiquetaTalla)) {
        tallas.push(t.etiquetaTalla);
      }
    }
  }

  const totalesColumna = new Array<number>(tallas.length).fill(0);
  let totalPiezas = 0;

  const renglones = lineas.map((linea) => {
    const porTalla = new Map(linea.tallas.map((t) => [t.etiquetaTalla, t.cantidad]));
    const cantidades = tallas.map((etiqueta) => porTalla.get(etiqueta) ?? 0);
    let totalFila = 0;
    cantidades.forEach((cantidad, i) => {
      totalFila += cantidad;
      totalesColumna[i] = (totalesColumna[i] ?? 0) + cantidad;
    });
    totalPiezas += totalFila;
    return { color: etiquetaColorPack(linea.color, linea.pack), cantidades, totalFila };
  });

  return { tallas, renglones, totalesColumna, totalPiezas };
}

/** Dependencias inyectables (los tests inyectan un `obtenerRecibo` fake para no tocar BD). */
export interface DepsImpresoRecibo {
  obtenerRecibo?: typeof obtenerRecibo;
}

/** Resuelve los datos del impreso de un recibo (A9). Reusa `obtenerRecibo`. */
export async function armarDatosImpresoRecibo(
  sesion: SesionUsuario,
  idRecibo: number,
  bd?: ContextoBd,
  deps: DepsImpresoRecibo = {},
): Promise<DatosImpresoRecibo> {
  const obtener = deps.obtenerRecibo ?? obtenerRecibo;
  const recibo = await obtener(sesion, idRecibo, bd);
  const tabla = armarTablaRecibo(recibo.lineas);
  return {
    empresa: sesion.nombreEmpresaActiva,
    folio: recibo.folio,
    fecha: recibo.fecha,
    maquilero: recibo.tercero,
    proceso: recibo.tipoProceso,
    generaEntradaPt: recibo.generaEntradaPt,
    devuelveDeTransito: !recibo.generaEntradaPt && recibo.idAlmacenPrimeras !== null,
    almacenPrimeras: recibo.almacenPrimeras,
    almacenSegundas: recibo.almacenSegundas,
    folioOrden: recibo.folioOrden,
    precioPactado: recibo.precioPactado,
    observaciones: recibo.observaciones,
    cancelado: recibo.cancelado,
    totalPrimeras: recibo.totalPrimeras,
    totalSegundas: recibo.totalSegundas,
    totalIncompletas: recibo.totalIncompletas,
    ...tabla,
  };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

const estilos = StyleSheet.create({
  // Estilos PROPIOS de este recibo (lo compartido vive en `estilosDoc`).
  colColor: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  colTalla: { width: 34, textAlign: 'center' },
  colTotal: { width: 42, textAlign: 'center', fontFamily: FUENTE.negrita },
  notaCalidad: { marginTop: 8, flexDirection: 'row', gap: 16 },
  notaItem: { fontSize: 9 },
  notaIncompletas: { marginTop: 4 },
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

/** Banda roja "RECIBO CANCELADO" (solo si está cancelado). */
function bandaCancelada(datos: DatosImpresoRecibo): ReactElement | null {
  if (!datos.cancelado) {
    return null;
  }
  return BandaEstado({ titulo: 'RECIBO CANCELADO' });
}

/** Tabla MATRIZ color×talla con totales por fila/columna y total general. */
function tablaMatriz(datos: DatosImpresoRecibo): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colColor] }, 'Color'),
    ...datos.tallas.map((t, i) =>
      h(
        Text,
        { key: `th-${i}`, style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colTalla] },
        t,
      ),
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colTotal] }, 'Total'),
  );

  const filasColor = datos.renglones.map((r, fila) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `fila-${fila}` },
      h(Text, { style: [estilosDoc.celda, estilos.colColor] }, r.color),
      ...r.cantidades.map((c, i) =>
        h(
          Text,
          { key: `c-${fila}-${i}`, style: [estilosDoc.celda, estilos.colTalla] },
          c === 0 ? '' : String(c),
        ),
      ),
      h(Text, { style: [estilosDoc.celda, estilos.colTotal] }, String(r.totalFila)),
    ),
  );

  const filaTotales = h(
    View,
    { style: [estilosDoc.filaTabla, estilosDoc.filaTotal], key: 'tot' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.colColor] }, 'Total'),
    ...datos.totalesColumna.map((c, i) =>
      h(
        Text,
        { key: `tc-${i}`, style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.colTalla] },
        String(c),
      ),
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.colTotal] },
      String(datos.totalPiezas),
    ),
  );

  const cuerpo =
    datos.renglones.length === 0
      ? [h(Text, { style: estilosDoc.vacio, key: 'vacio' }, 'Sin matriz.')]
      : [filaEncabezado, ...filasColor, filaTotales];

  return h(
    View,
    { style: estilosDoc.seccion },
    TituloSeccion('Cantidades recibidas (color × talla)'),
    ...cuerpo,
  );
}

/** Pesos en MXN sin redondear (precio pactado). */
function pesos(valor: number | null): string | null {
  if (valor === null) return null;
  return valor.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

/** Una página del documento de RECIBO de maquila. */
function paginaRecibo(datos: DatosImpresoRecibo, clave: string): ReactElement {
  const camposAlmacen =
    datos.generaEntradaPt || datos.devuelveDeTransito
      ? [
          campo('Almacén primeras', datos.almacenPrimeras),
          campo('Almacén segundas', datos.almacenSegundas),
        ]
      : [];

  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Recibo de maquila — CONTROL v2',
      derecha: { etiqueta: 'Folio de recibo', valor: String(datos.folio), grande: true },
    }),
    bandaCancelada(datos),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Maquilero', datos.maquilero),
      campo('Proceso', datos.proceso),
      campo('Orden', String(datos.folioOrden)),
      campo('Fecha de recibo', datos.fecha),
      campo('Precio pactado', pesos(datos.precioPactado)),
      campo(
        'Mete a inventario',
        datos.generaEntradaPt
          ? 'Sí (costura)'
          : datos.devuelveDeTransito
            ? 'Sí (regresa de proceso)'
            : 'No',
      ),
      ...camposAlmacen,
    ),
    datos.observaciones
      ? h(
          View,
          { style: estilosDoc.campoDosTercios, key: 'obs' },
          h(Text, { style: estilosDoc.etiquetaCampo }, 'Observaciones'),
          h(Text, { style: estilosDoc.valorCampoTexto }, datos.observaciones),
        )
      : null,
    tablaMatriz(datos),
    h(
      View,
      { style: estilos.notaCalidad, key: 'calidad' },
      h(Text, { style: estilos.notaItem }, `Primeras: ${datos.totalPrimeras}`),
      h(Text, { style: estilos.notaItem }, `Segundas: ${datos.totalSegundas}`),
      h(Text, { style: estilos.notaItem }, `Total recibido: ${datos.totalPiezas}`),
    ),
    // Renglón APARTE del de calidad: una incompleta no es una calidad, y no está sumada en el
    // total recibido (§Post-F9.136). Solo aparece si la hubo, para no ensuciar el 99 % de las hojas.
    datos.totalIncompletas > 0
      ? h(
          View,
          { style: estilos.notaIncompletas, key: 'incompletas' },
          h(
            Text,
            { style: estilos.notaItem },
            `Prendas incompletas entregadas: ${datos.totalIncompletas} — NO cuentan como ` +
              'producidas, no entran a inventario y no se pagan.',
          ),
        )
      : null,
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Recibo ${datos.folio} · Orden ${datos.folioOrden} · ${datos.totalPiezas} piezas`,
    }),
  ];
  return h(
    Page,
    { key: clave, size: 'A4', style: estilosDoc.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de UN recibo de maquila. */
function documentoRecibo(datos: DatosImpresoRecibo): ReactElement<DocumentProps> {
  return h(
    Document,
    { title: `Recibo ${datos.folio}`, author: datos.empresa, subject: 'Recibo de maquila' },
    paginaRecibo(datos, 'recibo'),
  );
}

/** Genera el PDF (Buffer) del documento de recibo a partir de sus datos resueltos. */
export async function generarPdfRecibo(datos: DatosImpresoRecibo): Promise<Buffer> {
  return renderToBuffer(documentoRecibo(datos));
}

/** Resultado de generar un impreso de recibo (Buffer + folio para el `filename`). */
export interface ImpresoRecibo {
  buffer: Buffer;
  folio: number;
}

/** Resuelve los datos del recibo (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoReciboMaquila(
  sesion: SesionUsuario,
  idRecibo: number,
  bd?: ContextoBd,
  deps: DepsImpresoRecibo = {},
): Promise<ImpresoRecibo> {
  const datos = await armarDatosImpresoRecibo(sesion, idRecibo, bd, deps);
  return {
    buffer: await renderizarPdfEnWorker('recibo-maquila', datos, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
    folio: datos.folio,
  };
}
