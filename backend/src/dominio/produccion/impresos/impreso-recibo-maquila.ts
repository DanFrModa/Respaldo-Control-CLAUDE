/**
 * Impreso del RECIBO de maquila UNIFICADO (F3-E4, R9; ref. viejo `ReciboMaqImp`/`RecibosEstImp`): la
 * hoja que documenta la recepción de prenda terminada desde maquila. UN PDF parametrizado por
 * `TipoProceso` (costura/estampado/…, D8): el encabezado y la nota cambian según si el proceso metió
 * a inventario PT (costura) o no (estampado/bordado/lavado). Incluye la matriz color×talla con su
 * CALIDAD (primeras/segundas) y los totales, más —si las hubo— las PRENDAS INCOMPLETAS que el
 * maquilero entregó (V1-E8k, §Post-F9.136), en un renglón aparte que dice que no se pagan.
 *
 * ⭐⭐ 0.107 — **EL RECIBO DE UN PROCESO DE ARTE LLEVA LA FOTO DEL ARTE.** La 0.094 se la puso a la
 * ficha que sale CON el envío; este papel —la constancia que se firma cuando el trabajo VUELVE— es
 * el otro que el mismo proveedor tiene en la mano, y seguía sin ella. Sin la imagen, quien recibe
 * no tiene contra qué cotejar lo que le entregan.
 *
 * 🔑 **Cuándo la lleva: cuando el proceso NO mete a inventario PT** (`generaEntradaPt === false`).
 * No es un criterio nuevo: es el MISMO con el que el resto del producto parte costura de arte
 * (`AvanceProduccion.tsx`, `esCostura = TipoProceso.generaEntradaPt`), incluido el recibo sin
 * proceso, que ya se clasificaba como arte. Un recibo de COSTURA no lleva fotos, igual que siempre.
 * Cubre también el arte que va DESPUÉS de la costura (V1-E4b, `devuelveDeTransito`): también es
 * arte y también las lleva.
 *
 * El bloque de imágenes —tope, resolución best-effort y rejilla— NO se copió de la ficha: vive en
 * `bloque-fotos-arte.ts` y lo usan los dos papeles. Si cambia, cambia para ambos.
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
// ⭐ 0.107 — el bloque de arte, COMPARTIDO con la ficha de arte del envío (los dos papeles del
// mismo proveedor). Debajo, `imagenes-impreso.ts` sigue siendo el único dueño de la regla de QUÉ
// fotos manda la OP (0.083). Lecturas de BAJO NIVEL, sin permiso propio: esta impresión ya está
// autorizada por `produccion.wip-ver` y qué arte lleva la orden es parte de su documento.
import {
  bloqueFotosArte,
  resolverFotosArte,
  AVISO_FOTO_FALTANTE,
  type DatosFotosArte,
  type DepsFotosArteImpresas,
} from './bloque-fotos-arte.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/**
 * Todo lo que necesita el documento de recibo, ya resuelto (sin BD) → función pura.
 *
 * Extiende {@link DatosFotosArte} (0.107): `fotosArte` + `fotosArteOcultas`. A diferencia de la
 * ficha —que es un tipo aparte del envío para que el remito no cargue nunca con las imágenes—, el
 * recibo es UN solo documento parametrizado por proceso, así que los campos están siempre; en un
 * recibo de COSTURA llegan vacíos y no viajan bytes de más al worker de PDF.
 */
export interface DatosImpresoRecibo extends DatosFotosArte {
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

/**
 * Dependencias inyectables: `obtenerRecibo` (para no tocar BD) y, desde la 0.107, las del bloque de
 * arte (lectura de fotos, R2 y descarga) — los tests las sustituyen para no tocar ni BD ni red.
 */
export interface DepsImpresoRecibo extends DepsFotosArteImpresas {
  obtenerRecibo?: typeof obtenerRecibo;
}

/**
 * ⭐ 0.107 — ¿ESTE recibo es de un proceso de ARTE (y por tanto lleva la foto)?
 *
 * **Sí cuando el proceso NO mete a inventario PT.** Es el mismo criterio con el que el resto del
 * producto separa costura de arte (`AvanceProduccion.tsx`: `esCostura = generaEntradaPt === true`,
 * y `claveEtapaDeMovimiento` manda a «Recibo de Arte» todo lo demás, incluido el recibo sin
 * `TipoProceso`, que llega aquí con `generaEntradaPt` en `false`). No se inventa una regla nueva:
 * si un día cambia lo que hace «de arte» a un proceso, cambia en el catálogo y este papel la sigue.
 *
 * Un recibo que DEVUELVE de tránsito (V1-E4b) también es de arte: el proceso sigue sin ser el que
 * crea el producto terminado, solo lo regresa al almacén del que había salido.
 *
 * Pura y exportada: el criterio se prueba sin renderizar ni tocar BD.
 */
export function esReciboDeArte(recibo: Pick<ReciboSalida, 'generaEntradaPt'>): boolean {
  return !recibo.generaEntradaPt;
}

/**
 * Resuelve los datos del impreso de un recibo (A9). Reusa `obtenerRecibo`.
 *
 * ⭐ 0.107 — si el recibo es de ARTE ({@link esReciboDeArte}), resuelve además las fotos del arte
 * de la orden con el MISMO pipeline que la ficha ({@link resolverFotosArte}: tope antes de tocar
 * R2, presign best-effort por imagen y descarga con tope de bytes). 🔴 **El papel sale siempre**:
 * si la lectura truena, si R2 rechaza una key o si una imagen no se puede bajar, el recibo se
 * imprime igual —con su hueco cuando la foto existía y no llegó—.
 *
 * 🔑 Un recibo de COSTURA ni siquiera pregunta por las fotos: no toca BD de más, no toca R2 y **no
 * construye `servicioArchivos()`** (que lanza si falta un `R2_*`). Su hoja es exactamente la de
 * antes de esta fila.
 */
export async function armarDatosImpresoRecibo(
  sesion: SesionUsuario,
  idRecibo: number,
  bd?: ContextoBd,
  deps: DepsImpresoRecibo = {},
): Promise<DatosImpresoRecibo> {
  const obtener = deps.obtenerRecibo ?? obtenerRecibo;
  const recibo = await obtener(sesion, idRecibo, bd);
  const tabla = armarTablaRecibo(recibo.lineas);
  const fotos: DatosFotosArte = esReciboDeArte(recibo)
    ? await resolverFotosArte(
        bd,
        recibo.idOrden,
        sesion.idEmpresaActiva,
        `el recibo de maquila ${String(idRecibo)}`,
        deps,
      )
    : { fotosArte: [], fotosArteOcultas: 0 };
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
    ...fotos,
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

/**
 * ⭐ 0.107 — El bloque de arte de ESTE papel: el COMPARTIDO con la ficha ({@link bloqueFotosArte}),
 * con el único texto que los dos papeles no dicen igual — el del HUECO. En el recibo el trabajo ya
 * volvió, así que la foto se pide *antes de dar por bueno lo recibido*, no *antes de producir*.
 *
 * Existe como función exportada, y no como una llamada suelta dentro de la página, para poder
 * probar sin renderizar que este papel no se quedó con el aviso de la ficha: el PDF comprime sus
 * flujos de texto, así que sobre el Buffer esa comprobación no discrimina nada.
 */
export function bloqueArteRecibo(datos: DatosImpresoRecibo): ReactElement | null {
  return bloqueFotosArte(datos, AVISO_FOTO_FALTANTE.antesDeCotejar);
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
    // ⭐ 0.107 — el ARTE va ARRIBA, antes de las cantidades, EN EL MISMO SITIO que en la ficha: es
    // la identidad del trabajo (de qué arte se habla), y las cantidades solo tienen sentido cuando
    // ya se sabe. Que los dos papeles del proveedor de arte lo pongan en el mismo lugar es parte de
    // que sean gemelos. En un recibo de COSTURA `fotosArte` va vacío y el bloque devuelve `null`:
    // la hoja de siempre, sin sección ni hueco.
    bloqueArteRecibo(datos),
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

/**
 * Resuelve los datos del recibo (A9) —incluidas las fotos del arte si es un recibo de ARTE, 0.107—
 * y devuelve su PDF + el folio para el nombre del archivo.
 */
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
