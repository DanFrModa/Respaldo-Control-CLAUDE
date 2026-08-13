/**
 * Impreso 'TRASPASO DE TELA ENTRE ALMACENES' (V1-E3b, §Post-F9.38 — R9). La hoja (PDF) que ACOMPAÑA
 * la tela cuando sale físicamente de un almacén a otro: *"Vamos a necesitar notas cuando se mueva
 * entre almacenes (si le mando tela a un cortador, si necesito una nota de salida)"* (Daniel).
 *
 * ⚠️ NO GENERA FOLIO NI DOCUMENTO NUEVO (Daniel: *"No debe de generar otro folio de nada. Me refiero
 * a solo la impresión del folio que ya existe"*). El traspaso YA es un hecho del kardex con su folio
 * (dos patas: salida del origen + entrada al destino, `origenTipo = traspaso`); este módulo solo lo
 * IMPRIME. Crear una `NotaSalida` paralela sería una SEGUNDA fuente de verdad del mismo hecho
 * físico, cuando el saldo ya se deriva del kardex (D3): dos folios para un movimiento acaban con uno
 * de los dos mintiendo.
 *
 * Qué lleva la hoja: el folio del traspaso, la fecha, el almacén ORIGEN y el DESTINO, el TERCERO
 * (el cortador dueño del almacén destino — `Almacen.idCortador`, §Post-F9.13) y el detalle por color
 * con AMBOS componentes (cuerpo y complemento/cardigan, que viajan juntos en el renglón).
 *
 * REIMPRIMIBLE desde el historial (el kardex por color), no solo al momento de guardar — mismo
 * criterio que la reimpresión de producción de V1-E3a. Y un traspaso CANCELADO **no se imprime**: su
 * papel no debe volver a salir con un bulto (misma regla que los envíos a maquila).
 *
 * Documento generado EN EL SERVIDOR con `@react-pdf/renderer`, MISMO motor y patrón que
 * `produccion/impresos/impreso-envio-maquila.ts` (A1: la ruta solo valida permiso + Zod y delega;
 * `armarDatos*` toca BD en el hilo principal y `generarPdf*` es puro y corre en el worker).
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

import type { Prisma } from '../../../datos/index.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../../comun/errores.js';
import {
  estilosDoc,
  FUENTE,
  EncabezadoDocumento,
  PieDocumento,
  TituloSeccion,
} from '../../../comun/impresos-estilos.js';
import { ORIGEN } from '../../../comun/origenes.js';
import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';
import { verificarPermiso, type SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Un renglón del impreso: una tela × color con sus dos componentes (o una tela × lote, flujo viejo). */
export interface RenglonImpresoTraspasoTela {
  tela: string;
  /** Color de la tela (flujo nuevo) o la clave del lote (flujo viejo); nunca vacío. */
  colorOLote: string;
  pantone: string | null;
  /** Nombre del componente CUERPO de la tela (p. ej. "Felpa"); null = la tela no lo nombra. */
  nombreCuerpo: string | null;
  cantidadCuerpo: number;
  /** Nombre del COMPLEMENTO (p. ej. "Cardigan"); null = la tela no lleva complemento. */
  nombreComplemento: string | null;
  /** Cantidad del complemento; null = la tela no lleva complemento. */
  cantidadComplemento: number | null;
}

/** Todo lo que necesita el impreso del traspaso, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoTraspasoTela {
  empresa: string;
  /** Folio del traspaso: el de la pata de SALIDA (el que ya existe; NO se genera uno nuevo). */
  folio: number;
  fecha: string;
  almacenOrigen: string;
  almacenDestino: string;
  /** Cortador/tercero dueño del almacén destino (§Post-F9.13), o null si el almacén no tiene. */
  tercero: string | null;
  observaciones: string | null;
  renglones: RenglonImpresoTraspasoTela[];
  totalCuerpo: number;
  totalComplemento: number;
}

// ── Resolución de datos (BD) ─────────────────────────────────────────────────────────────────────

/** `include` de las dos patas: detalle de tela con nombres legibles + almacén. */
const incluirPata = {
  almacen: { select: { nombre: true, cortador: { select: { nombre: true } } } },
  anuladoPor: { select: { id: true } },
  tipoMov: { select: { direccion: true } },
  detallesTela: {
    orderBy: [{ idTela: 'asc' }, { id: 'asc' }],
    include: {
      tela: { select: { nombre: true, nombreCuerpo: true, nombreComplemento: true } },
      telaColor: { select: { nombre: true, pantone: true } },
      lote: { select: { clave: true } },
    },
  },
} satisfies Prisma.MovimientoInclude;

/**
 * Resuelve los datos del impreso a partir de CUALQUIERA de las dos patas del traspaso (la de salida
 * o la de entrada — el historial ofrece las dos): con la pata dada se encuentra su gemela y de ahí
 * salen origen y destino. A9: solo movimientos de la empresa activa (si no, 404). Permiso
 * `inventario-telas.ver` (A4, defensa en profundidad además del guard de la ruta).
 *
 * Lanza `ErrorValidacion` si el movimiento no es una pata de traspaso (un ajuste o una salida a
 * orden no tienen "hoja de traspaso") o si el traspaso está CANCELADO (su papel no vuelve a salir).
 */
export async function armarDatosImpresoTraspasoTela(
  sesion: SesionUsuario,
  idMovimiento: number,
  bd?: ContextoBd,
): Promise<DatosImpresoTraspasoTela> {
  verificarPermiso(sesion, 'inventario-telas.ver');
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const pata = await cliente.movimiento.findFirst({
    where: { id: idMovimiento, idEmpresa },
    include: incluirPata,
  });
  if (pata === null) {
    throw new ErrorNoEncontrado('Movimiento', idMovimiento);
  }
  if (pata.origenTipo !== ORIGEN.traspaso) {
    throw new ErrorValidacion(
      'La hoja de traspaso solo aplica a un traspaso entre almacenes (este movimiento no lo es).',
    );
  }
  if (pata.detallesTela.length === 0) {
    throw new ErrorValidacion('Este traspaso no es de tela: no tiene hoja de traspaso de tela.');
  }

  // La gemela: el motor materializa el traspaso como salida del origen + entrada al destino, y la
  // ENTRADA guarda `origenId = id de la salida`. Según qué pata llegue (la dirección de su tipo lo
  // dice), se busca hacia adelante (soy la salida) o hacia atrás (soy la entrada).
  const esSalida = pata.tipoMov.direccion === 'salida';
  // ⚠️ `Number(null)` es 0 y `Number.isInteger(0)` es `true`: si se convirtiera a ciegas, la pata
  // HUÉRFANA (entrada sin `origenId`) se colaría como id 0 y este aviso —el que nombra el problema
  // real— nunca saldría. Por eso el NULL se separa ANTES de convertir.
  const idGemela = esSalida || pata.origenId === null ? null : Number(pata.origenId);
  if (!esSalida && (idGemela === null || !Number.isInteger(idGemela))) {
    throw new ErrorValidacion(
      `La pata de entrada del traspaso ${String(idMovimiento)} no apunta a su pata de salida: no ` +
        'se puede imprimir la hoja.',
    );
  }
  const gemela = esSalida
    ? await cliente.movimiento.findFirst({
        where: { idEmpresa, origenTipo: ORIGEN.traspaso, origenId: String(pata.id) },
        include: incluirPata,
      })
    : await cliente.movimiento.findFirst({
        where: { idEmpresa, id: idGemela as number },
        include: incluirPata,
      });
  if (gemela === null) {
    // Un traspaso SIEMPRE nace con sus dos patas en la misma transacción (A2). Si falta una, el
    // dato está roto y se DICE — no se imprime media hoja como si fuera completa.
    throw new ErrorValidacion(
      `No se encontró la otra pata del traspaso del movimiento ${String(idMovimiento)}: no se ` +
        'puede imprimir la hoja (le faltaría el almacén de origen o el de destino).',
    );
  }

  const salida = esSalida ? pata : gemela;
  const entrada = esSalida ? gemela : pata;

  // Un traspaso cancelado NO se imprime (misma regla que los envíos a maquila de V1-E3a). Basta con
  // que CUALQUIERA de las patas esté anulada: el traspaso ya no representa un bulto en camino.
  // ⚠️ Hoy esta rama es DEFENSA, no un camino vivo: `cancelarMovimientoMaterial` RECHAZA anular una
  // sola pata de un traspaso (dejaría el inventario descuadrado entre los dos almacenes), así que
  // un traspaso se revierte con un traspaso INVERSO —que tiene su propia hoja—. Se deja escrita
  // para que, si algún día nace una cancelación de traspaso completa, el papel no salga con ella.
  if (salida.anuladoPor.length > 0 || entrada.anuladoPor.length > 0) {
    throw new ErrorValidacion(
      'Este traspaso está cancelado: su hoja no se vuelve a imprimir (no debe salir con un bulto).',
    );
  }

  const renglones: RenglonImpresoTraspasoTela[] = salida.detallesTela.map((d) => ({
    tela: d.tela.nombre,
    // Flujo NUEVO por color → el color; flujo VIEJO por lote → la clave del lote.
    colorOLote: d.telaColor?.nombre ?? d.lote?.clave ?? '(sin color)',
    pantone: d.telaColor?.pantone ?? null,
    nombreCuerpo: d.tela.nombreCuerpo,
    cantidadCuerpo: Number(d.cantidad),
    nombreComplemento: d.tela.nombreComplemento,
    cantidadComplemento: d.cantidadComplemento === null ? null : Number(d.cantidadComplemento),
  }));

  return {
    empresa: sesion.nombreEmpresaActiva,
    // El folio de la pata de SALIDA es EL folio del traspaso (el que ya existe).
    folio: Number(salida.folio),
    fecha: salida.fecha.toISOString().slice(0, 10),
    almacenOrigen: salida.almacen.nombre,
    almacenDestino: entrada.almacen.nombre,
    // El tercero es el CORTADOR dueño del almacén destino (§Post-F9.13): a quién se le manda la tela.
    tercero: entrada.almacen.cortador?.nombre ?? null,
    observaciones: salida.observaciones,
    renglones,
    totalCuerpo: renglones.reduce((suma, r) => suma + r.cantidadCuerpo, 0),
    totalComplemento: renglones.reduce((suma, r) => suma + (r.cantidadComplemento ?? 0), 0),
  };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

const estilos = StyleSheet.create({
  cTela: { flexGrow: 1, flexBasis: 0 },
  cColor: { width: '22%' },
  cPantone: { width: '14%' },
  cCantidad: { width: '14%', textAlign: 'right' },
  cTotalEtiqueta: { flexGrow: 1, flexBasis: 0, fontFamily: FUENTE.negrita },
  firmas: { flexDirection: 'row', gap: 24, marginTop: 28 },
  firma: { flexGrow: 1, flexBasis: 0, borderTopWidth: 0.5, paddingTop: 4, textAlign: 'center' },
});

/** Un campo etiqueta/valor del encabezado. */
function campo(etiqueta: string, valor: string | null): ReactElement {
  return h(
    View,
    { style: estilosDoc.campoTercio, key: etiqueta },
    h(Text, { style: estilosDoc.etiquetaCampo }, etiqueta),
    h(Text, { style: estilosDoc.valorCampo }, valor ?? '—'),
  );
}

/** Formatea una cantidad de tela (kg/m) con separadores y hasta 3 decimales. */
function cantidad(valor: number | null): string {
  if (valor === null) return '—';
  return valor.toLocaleString('es-MX', { maximumFractionDigits: 3 });
}

/** Tabla del detalle: una fila por tela × color, con los DOS componentes. */
function tablaRenglones(datos: DatosImpresoTraspasoTela): ReactElement {
  // Los nombres de los componentes salen de la PRIMERA tela que los declare (el impreso es de un
  // envío, casi siempre de la misma tela); si nadie los nombra, se usan los genéricos.
  const encCuerpo = datos.renglones.find((r) => r.nombreCuerpo !== null)?.nombreCuerpo ?? 'Cuerpo';
  const encComplemento =
    datos.renglones.find((r) => r.nombreComplemento !== null)?.nombreComplemento ?? 'Complemento';

  const filaEncabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.cTela] }, 'Tela'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.cColor] }, 'Color'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.cPantone] }, 'Pantone'),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.cCantidad] },
      encCuerpo,
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.cCantidad] },
      encComplemento,
    ),
  );

  const filas = datos.renglones.map((r, i) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `fila-${String(i)}`, wrap: false },
      h(Text, { style: [estilosDoc.celda, estilos.cTela] }, r.tela),
      h(Text, { style: [estilosDoc.celda, estilos.cColor] }, r.colorOLote),
      h(Text, { style: [estilosDoc.celda, estilos.cPantone] }, r.pantone ?? '—'),
      h(Text, { style: [estilosDoc.celda, estilos.cCantidad] }, cantidad(r.cantidadCuerpo)),
      h(Text, { style: [estilosDoc.celda, estilos.cCantidad] }, cantidad(r.cantidadComplemento)),
    ),
  );

  const filaTotal = h(
    View,
    { style: [estilosDoc.filaTabla, estilosDoc.filaTotal], key: 'total' },
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.cTotalEtiqueta] },
      `Total — ${String(datos.renglones.length)} renglón(es)`,
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.cColor] }, ''),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.cPantone] }, ''),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.cCantidad] },
      cantidad(datos.totalCuerpo),
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.cCantidad] },
      cantidad(datos.totalComplemento),
    ),
  );

  const cuerpo =
    datos.renglones.length === 0
      ? [h(Text, { style: estilosDoc.vacio, key: 'vacio' }, 'Sin renglones.')]
      : [filaEncabezado, ...filas, filaTotal];

  return h(View, { style: estilosDoc.seccion }, TituloSeccion('Tela que se traspasa'), ...cuerpo);
}

/** Espacios de firma (entrega / recibe): la hoja va con el bulto y se firma de recibido. */
function firmas(): ReactElement {
  return h(
    View,
    { style: estilos.firmas, key: 'firmas' },
    h(Text, { style: [estilos.firma, estilosDoc.etiquetaCampo] }, 'Entrega (almacén)'),
    h(Text, { style: [estilos.firma, estilosDoc.etiquetaCampo] }, 'Recibe (destino)'),
  );
}

/** La página de la hoja de traspaso. */
function paginaTraspaso(datos: DatosImpresoTraspasoTela): ReactElement {
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Traspaso de tela entre almacenes — CONTROL v2',
      derecha: { etiqueta: 'Folio del traspaso', valor: String(datos.folio), grande: true },
    }),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Almacén origen', datos.almacenOrigen),
      campo('Almacén destino', datos.almacenDestino),
      campo('Cortador / tercero', datos.tercero),
      campo('Fecha', datos.fecha),
    ),
    datos.observaciones === null
      ? null
      : h(
          View,
          { style: estilosDoc.campoDosTercios, key: 'obs' },
          h(Text, { style: estilosDoc.etiquetaCampo }, 'Observaciones'),
          h(Text, { style: estilosDoc.valorCampoTexto }, datos.observaciones),
        ),
    tablaRenglones(datos),
    firmas(),
    PieDocumento({
      contexto:
        `CONTROL v2 · ${datos.empresa} · Traspaso ${String(datos.folio)} · ` +
        `${datos.almacenOrigen} → ${datos.almacenDestino}`,
    }),
  ];
  return h(
    Page,
    { key: 'traspaso', size: 'A4', style: estilosDoc.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de UNA hoja de traspaso de tela. */
function documentoTraspaso(datos: DatosImpresoTraspasoTela): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Traspaso de tela ${String(datos.folio)}`,
      author: datos.empresa,
      subject: 'Traspaso de tela entre almacenes',
    },
    paginaTraspaso(datos),
  );
}

// ── Generación del Buffer (función pura) ─────────────────────────────────────────────────────────

/** Genera el PDF (Buffer) de la hoja de traspaso a partir de sus datos resueltos. */
export async function generarPdfTraspasoTela(datos: DatosImpresoTraspasoTela): Promise<Buffer> {
  return renderToBuffer(documentoTraspaso(datos));
}

// ── Orquestación de alto nivel (resuelve datos + genera) — la usa la ruta ────────────────────────

/** Resultado de generar la hoja de traspaso (Buffer + folio para el `filename`). */
export interface ImpresoTraspasoTela {
  buffer: Buffer;
  folio: number;
}

/** Resuelve los datos del traspaso (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoTraspasoTela(
  sesion: SesionUsuario,
  idMovimiento: number,
  bd?: ContextoBd,
): Promise<ImpresoTraspasoTela> {
  const datos = await armarDatosImpresoTraspasoTela(sesion, idMovimiento, bd);
  return {
    buffer: await renderizarPdfEnWorker('traspaso-tela', datos, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
    folio: datos.folio,
  };
}
