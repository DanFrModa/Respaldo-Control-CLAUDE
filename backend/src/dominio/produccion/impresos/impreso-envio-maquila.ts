/**
 * Impresos de los ENVÍOS a maquila (F3-E2, R9):
 *  • {@link impresoEnvioMaquila} — DOCUMENTO DE ENVÍO/ENTREGA A MAQUILA (ref. viejo
 *    `ReciboEntMaquilaImp`/`ReciboEntMaqDetImp`): la hoja que acompaña las prendas que SALEN al
 *    maquilero/estampador. Encabezado (empresa, folio del envío, fecha, maquilero, proceso,
 *    orden/modelo, fecha compromiso, precio pactado) + matriz color×talla con totales. SIN precios
 *    de costo del modelo; SÍ el precio pactado del envío.
 *  • {@link impresoFichaEstampado} — FICHA DE ARTE (ref. viejo `FichaEst`/`FichaEstImp`): la
 *    ficha que acompaña un envío de proceso de estampado/aplicación. Estructura similar, rotulada
 *    como ficha de arte, con espacio para instrucciones del proceso — y, desde la 0.094, **CON LA
 *    FOTO DEL ARTE**.
 *
 * ⭐ 0.094 — LA FICHA DE ARTE LLEVA LA FOTO (Daniel, 2-sep-2026, §Post-F9.181(c): *"sí lleva foto
 * la ficha de estampado"*). Va en la FICHA y **no** en el documento de envío: el documento de envío
 * es el remito de las prendas que salen (quién, cuántas, a qué precio) y lo firma el maquilero de
 * costura; la ficha es el papel que el PROVEEDOR DE ARTE tiene en la mano mientras trabaja, y sin
 * la imagen no sabe qué tiene que estampar. La 0.083 ya decidió CUÁL foto manda en cada OP
 * (heredadas del modelo − las que la OP apagó + las que la OP subió): aquí sólo se LEE lo ya
 * resuelto (`imagenes-impreso.ts`), nunca se vuelve a decidir.
 *
 * ⚠️ **0.107 — el bloque de arte ya no vive aquí**: el tope, la resolución de las fotos y la
 * rejilla que las pinta se subieron a `bloque-fotos-arte.ts`, porque el RECIBO de maquila de arte
 * —el otro papel del mismo proveedor— tenía el hueco simétrico. La ficha lo USA; no lo posee. Si
 * algo del bloque hay que cambiar, se cambia allí y cambia para los dos papeles a la vez.
 *
 * Documentos generados EN EL SERVIDOR con `@react-pdf/renderer` (`renderToBuffer`), MISMO motor y
 * patrón que `impreso-orden.ts` (deps inyectables, A1: la ruta solo valida permiso+Zod y delega).
 *
 * Innegociables: A1 (toda la lógica aquí), A9 (`obtenerEtapa` filtra por la empresa activa → 404 si
 * no es de la empresa). Se reusa `obtenerEtapa` (encabezado + matriz + nombres) — NO se reinventa.
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
  PALETA,
  EncabezadoDocumento,
  PieDocumento,
  TituloSeccion,
  BandaEstado,
} from '../../../comun/impresos-estilos.js';

import type { SesionUsuario } from '../../../comun/permisos.js';
import { ErrorValidacion } from '../../../comun/errores.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { obtenerEtapa } from '../etapas.js';
import type { EtapaSalida } from '../../../contrato/index.js';
// ⭐ 0.107 — el BLOQUE DE ARTE (cuántas caben, con qué tope se bajan, cómo se resuelven y cómo se
// pintan) vive en un módulo compartido con el RECIBO de maquila de arte: son los dos papeles que el
// proveedor de arte tiene en la mano, y la 0.107 nació justo de que la foto se le hubiera puesto a
// uno y no al otro. Debajo de él, `imagenes-impreso.ts` sigue siendo el único dueño de la regla de
// QUÉ fotos manda la OP (0.083), compartida también con el impreso de la orden.
import {
  bloqueFotosArte,
  resolverFotosArte,
  type DatosFotosArte,
  type DepsFotosArteImpresas,
} from './bloque-fotos-arte.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Todo lo que necesita el documento de envío a maquila, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoEnvio {
  empresa: string;
  folio: number;
  fecha: string;
  fechaCompromiso: string | null;
  maquilero: string | null;
  proceso: string | null;
  folioOrden: number;
  precioPactado: number | null;
  /**
   * ⭐ V1-E4b — lo que se entrega YA ES PRODUCTO TERMINADO (proceso después de costura,
   * §Post-F9.61). Este papel lo FIRMA el maquilero: tiene que decirlo, porque no es lo mismo
   * recibir bultos cortados que prendas terminadas —cambia lo que se le reclama si no vuelven— y
   * porque esas piezas salieron de un almacén concreto, que también se imprime.
   */
  prendaTerminada: boolean;
  /** Almacén de PT del que salieron (solo cuando son prendas terminadas). */
  almacenOrigen: string | null;
  /** Salieron del stock «sin orden asignada» (histórico migrado / inventario de arranque). */
  stockSinOrden: boolean;
  observaciones: string | null;
  cancelado: boolean;
  /** Columnas: etiquetas de talla en el orden en que aparecen en la matriz. */
  tallas: string[];
  /** Renglones color×talla; `cantidades[i]` alinea con `tallas[i]`. */
  renglones: { color: string; cantidades: number[]; totalFila: number }[];
  totalesColumna: number[];
  totalPiezas: number;
}

/**
 * Datos de la FICHA DE ARTE: los del envío + las fotos del arte que manda esta OP.
 *
 * Es un tipo APARTE (y no un campo opcional de {@link DatosImpresoEnvio}) para que el documento de
 * ENVÍO no cargue nunca con las imágenes: sus datos cruzan al worker por `postMessage`, y meterle
 * megas de data-URL a un papel que no las pinta sería pagarlas dos veces por nada.
 */
export interface DatosImpresoFichaArte extends DatosImpresoEnvio, DatosFotosArte {}

/**
 * Etiqueta de la fila de la matriz: el color y, cuando la orden se fabrica por packs (§Post-F9.10),
 * SU TENDIDO. El pack tiene que salir en el papel: es lo que el cortador y el maquilero usan para
 * saber qué corrida están manejando, y sin él dos filas del mismo color se leerían como un error de
 * captura. En una orden sin packs es cadena vacía y la fila se imprime exactamente igual que antes.
 */
function etiquetaColorPack(color: string, pack: string): string {
  return pack.trim() === '' ? color : `${color}  ·  PACK ${pack.trim()}`;
}

/**
 * Proyecta la matriz de la etapa (colores con sus tallas) a la tabla color×talla del impreso:
 * columnas = unión ordenada de tallas (preservando orden de aparición), filas = colores, con
 * totales por fila, por columna y total general. Misma forma que `armarTabla` de `impreso-orden`.
 */
export function armarTablaEtapa(
  lineas: EtapaSalida['lineas'],
): Pick<DatosImpresoEnvio, 'tallas' | 'renglones' | 'totalesColumna' | 'totalPiezas'> {
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

/** Dependencias inyectables (los tests inyectan un `obtenerEtapa` fake para no tocar BD). */
export interface DepsImpresoEnvio {
  obtenerEtapa?: typeof obtenerEtapa;
}

/**
 * Dependencias de la FICHA DE ARTE: las del envío + lo que hace falta para las imágenes. Los tests
 * las inyectan para no tocar BD ni R2.
 */
export interface DepsImpresoFichaArte extends DepsImpresoEnvio, DepsFotosArteImpresas {}

/**
 * Trae la ETAPA y exige que sea un ENVÍO a maquila (A9: `obtenerEtapa` filtra por la empresa
 * activa de la sesión). Lanza `ErrorValidacion` si no lo es (un corte no tiene "documento de
 * envío"); `ErrorNoEncontrado` (404) si la etapa no es de la empresa activa.
 */
async function etapaDeEnvio(
  sesion: SesionUsuario,
  idEtapa: number,
  bd: ContextoBd | undefined,
  deps: DepsImpresoEnvio,
): Promise<EtapaSalida> {
  const obtener = deps.obtenerEtapa ?? obtenerEtapa;
  const etapa = await obtener(sesion, idEtapa, bd);
  if (etapa.tipo !== 'envio_maquila') {
    throw new ErrorValidacion('El documento de envío solo aplica a etapas de envío a maquila.');
  }
  return etapa;
}

/** Proyección PURA de la etapa a los datos del papel (sin BD): la comparten los dos impresos. */
function datosDeLaEtapa(etapa: EtapaSalida, empresa: string): DatosImpresoEnvio {
  return {
    empresa,
    folio: etapa.folio,
    fecha: etapa.fecha,
    fechaCompromiso: etapa.fechaCompromiso,
    maquilero: etapa.tercero,
    proceso: etapa.tipoProceso,
    folioOrden: etapa.folioOrden,
    precioPactado: etapa.precioPactado,
    prendaTerminada: etapa.prendaTerminada,
    almacenOrigen: etapa.almacenOrigen,
    stockSinOrden: etapa.stockSinOrden,
    observaciones: etapa.observaciones,
    cancelado: etapa.cancelado,
    ...armarTablaEtapa(etapa.lineas),
  };
}

/**
 * Resuelve los datos del impreso de un envío (A9: por la empresa activa de la sesión). Reusa
 * `obtenerEtapa` (encabezado + matriz + nombres). Lanza `ErrorValidacion` si la etapa NO es un
 * envío a maquila; `ErrorNoEncontrado` (404) si no es de la empresa activa.
 *
 * ⚠️ SIN imágenes, a propósito: el documento de envío es el remito de las prendas, no el papel del
 * proveedor de arte (0.094).
 */
export async function armarDatosImpresoEnvio(
  sesion: SesionUsuario,
  idEtapa: number,
  bd?: ContextoBd,
  deps: DepsImpresoEnvio = {},
): Promise<DatosImpresoEnvio> {
  return datosDeLaEtapa(await etapaDeEnvio(sesion, idEtapa, bd, deps), sesion.nombreEmpresaActiva);
}

/**
 * ⭐ 0.094 — Datos de la FICHA DE ARTE: los del envío + las fotos del arte que manda esta OP.
 *
 * Todo el trabajo de las imágenes —el tope, el presign y la descarga, en tres capas best-effort—
 * lo hace {@link resolverFotosArte}, que desde la 0.107 comparte con el RECIBO de arte. Aquí solo
 * queda lo propio de ESTA hoja: de qué etapa sale y cómo se nombra en los avisos.
 *
 * 🔴 **EL PAPEL SALE SIEMPRE**, y 🔑 una OP **sin arte imprime NORMAL** (ni sección ni hueco): las
 * dos garantías las sostiene `resolverFotosArte`, con su detalle documentado allí.
 */
export async function armarDatosImpresoFichaArte(
  sesion: SesionUsuario,
  idEtapa: number,
  bd?: ContextoBd,
  deps: DepsImpresoFichaArte = {},
): Promise<DatosImpresoFichaArte> {
  const etapa = await etapaDeEnvio(sesion, idEtapa, bd, deps);
  const datos = datosDeLaEtapa(etapa, sesion.nombreEmpresaActiva);
  const fotos = await resolverFotosArte(
    bd,
    etapa.idOrden,
    sesion.idEmpresaActiva,
    `la ficha del envío ${String(idEtapa)}`,
    deps,
  );
  return { ...datos, ...fotos };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

const estilos = StyleSheet.create({
  // Estilos PROPIOS del envío/ficha (lo compartido vive en `estilosDoc`).
  colColor: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  colTalla: { width: 34, textAlign: 'center' },
  colTotal: { width: 42, textAlign: 'center', fontFamily: FUENTE.negrita },
  cajaInstrucciones: {
    marginTop: 10,
    borderWidth: 0.5,
    borderColor: PALETA.borde,
    minHeight: 70,
    padding: 6,
  },
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

/** Banda roja "CANCELADO" (solo si la etapa está cancelada). */
function bandaCancelada(datos: DatosImpresoEnvio): ReactElement | null {
  if (!datos.cancelado) {
    return null;
  }
  return BandaEstado({ titulo: 'ENVÍO CANCELADO' });
}

/** Tabla MATRIZ color×talla con totales por fila/columna y total general. */
function tablaMatriz(datos: DatosImpresoEnvio): ReactElement {
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
    TituloSeccion('Cantidades (color × talla)'),
    ...cuerpo,
  );
}

/**
 * QUÉ se entrega, en una línea, para el papel que firma el maquilero (V1-E4b). Sin prenda
 * terminada devuelve `null` y el campo ni se imprime: el envío de bultos cortados es el de siempre
 * y no hay nada nuevo que decir.
 */
export function queSeEntrega(datos: DatosImpresoEnvio): string | null {
  if (!datos.prendaTerminada) return null;
  const deDonde = datos.almacenOrigen === null ? '' : ` (salen del almacén ${datos.almacenOrigen}`;
  const bucket = datos.stockSinOrden ? ', stock sin orden asignada' : '';
  const cierre = deDonde === '' ? '' : `${bucket})`;
  return `PRENDAS YA TERMINADAS${deDonde}${cierre}`;
}

/** Pesos en MXN sin redondear (precio pactado). */
function pesos(valor: number | null): string | null {
  if (valor === null) return null;
  return valor.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

/** Una página del documento de ENVÍO a maquila. */
function paginaEnvio(datos: DatosImpresoEnvio, clave: string): ReactElement {
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Envío a maquila — CONTROL v2',
      derecha: { etiqueta: 'Folio de envío', valor: String(datos.folio), grande: true },
    }),
    bandaCancelada(datos),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Maquilero', datos.maquilero),
      campo('Proceso', datos.proceso),
      campo('Orden', String(datos.folioOrden)),
      campo('Fecha de envío', datos.fecha),
      campo('Fecha compromiso', datos.fechaCompromiso),
      campo('Precio pactado', pesos(datos.precioPactado)),
      // Solo aparece cuando SÍ son prendas terminadas (V1-E4b): en el envío de bultos cortados no
      // hay nada nuevo que declarar y el papel se queda como siempre.
      campo('Qué se entrega', queSeEntrega(datos), true),
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
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Envío ${datos.folio} · Orden ${datos.folioOrden} · ${datos.totalPiezas} piezas`,
    }),
  ];
  return h(
    Page,
    { key: clave, size: 'A4', style: estilosDoc.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Una página de la FICHA DE ARTE (acompaña un envío de proceso de estampado/aplicación). */
function paginaFichaEstampado(datos: DatosImpresoFichaArte, clave: string): ReactElement {
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Ficha de arte — CONTROL v2',
      derecha: { etiqueta: 'Folio de envío', valor: String(datos.folio), grande: true },
    }),
    bandaCancelada(datos),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Prov. de Arte', datos.maquilero),
      campo('Proceso', datos.proceso),
      campo('Orden', String(datos.folioOrden)),
      campo('Fecha de envío', datos.fecha),
      campo('Fecha compromiso', datos.fechaCompromiso),
      campo('Precio pactado', pesos(datos.precioPactado)),
      // Solo aparece cuando SÍ son prendas terminadas (V1-E4b): en el envío de bultos cortados no
      // hay nada nuevo que declarar y el papel se queda como siempre.
      campo('Qué se entrega', queSeEntrega(datos), true),
    ),
    // ⭐ 0.094 — el ARTE va ARRIBA, antes de las cantidades: es la identidad del trabajo (qué hay
    // que estampar), y las cantidades sólo tienen sentido una vez que se sabe de qué arte se habla.
    // ⚠️ Y NO donde lo pone el impreso de la ORDEN, que lo manda al final: allí el arte es una
    // sección entre diez y arriba van las fotos de la PRENDA, que es el asunto de esa hoja. En
    // ésta el asunto ES el arte, así que ocupa el sitio que allá ocupa la prenda.
    bloqueFotosArte(datos),
    tablaMatriz(datos),
    h(
      View,
      { style: estilosDoc.seccion, key: 'instr' },
      TituloSeccion('Instrucciones del arte'),
      datos.observaciones
        ? h(View, { style: estilos.cajaInstrucciones }, h(Text, {}, datos.observaciones))
        : h(View, { style: estilos.cajaInstrucciones }, h(Text, { style: estilosDoc.vacio }, '')),
    ),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Ficha de arte · Envío ${datos.folio} · ${datos.totalPiezas} piezas`,
    }),
  ];
  return h(
    Page,
    { key: clave, size: 'A4', style: estilosDoc.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de UN envío a maquila. */
function documentoEnvio(datos: DatosImpresoEnvio): ReactElement<DocumentProps> {
  return h(
    Document,
    { title: `Envío ${datos.folio}`, author: datos.empresa, subject: 'Envío a maquila' },
    paginaEnvio(datos, 'envio'),
  );
}

/** Documento de UNA ficha de estampado. */
function documentoFichaEstampado(datos: DatosImpresoFichaArte): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Ficha de arte ${datos.folio}`,
      author: datos.empresa,
      subject: 'Ficha de arte',
    },
    paginaFichaEstampado(datos, 'ficha'),
  );
}

// ── Generación del Buffer (funciones puras) ──────────────────────────────────────────────────────

/** Genera el PDF (Buffer) del documento de envío a maquila a partir de sus datos resueltos. */
export async function generarPdfEnvio(datos: DatosImpresoEnvio): Promise<Buffer> {
  return renderToBuffer(documentoEnvio(datos));
}

/** Genera el PDF (Buffer) de la ficha de estampado a partir de sus datos resueltos. */
export async function generarPdfFichaEstampado(datos: DatosImpresoFichaArte): Promise<Buffer> {
  return renderToBuffer(documentoFichaEstampado(datos));
}

// ── Orquestación de alto nivel (resuelve datos + genera) — la usa la ruta ────────────────────────

/** Resultado de generar un impreso de envío (Buffer + folio para el `filename`). */
export interface ImpresoEnvio {
  buffer: Buffer;
  folio: number;
}

/** Resuelve los datos del envío (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoEnvioMaquila(
  sesion: SesionUsuario,
  idEtapa: number,
  bd?: ContextoBd,
  deps: DepsImpresoEnvio = {},
): Promise<ImpresoEnvio> {
  const datos = await armarDatosImpresoEnvio(sesion, idEtapa, bd, deps);
  return {
    buffer: await renderizarPdfEnWorker('envio-maquila', datos, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
    folio: datos.folio,
  };
}

/** Resuelve los datos del envío + las fotos del arte (A9) y devuelve la FICHA DE ARTE + el folio. */
export async function impresoFichaEstampado(
  sesion: SesionUsuario,
  idEtapa: number,
  bd?: ContextoBd,
  deps: DepsImpresoFichaArte = {},
): Promise<ImpresoEnvio> {
  const datos = await armarDatosImpresoFichaArte(sesion, idEtapa, bd, deps);
  return {
    buffer: await renderizarPdfEnWorker('ficha-estampado', datos, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
    folio: datos.folio,
  };
}
