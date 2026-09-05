/**
 * Impreso 'TRASPASO DE PRODUCTO TERMINADO ENTRE ALMACENES' (fila 0.100, §Post-F9.193 decisión 2).
 * La hoja (PDF) que ACOMPAÑA las prendas cuando salen físicamente de un almacén a otro.
 *
 * ⚠️ POR QUÉ EXISTE: el repaso del 4-sep-2026 midió que el inventario de PT **no tiene ni un solo
 * papel** — telas ya tenía su hoja de traspaso (`impreso-traspaso-tela.ts`, §Post-F9.38) y producto
 * terminado se movía entre bodegas sin nada que firmara nadie. Ésta es su gemela.
 *
 * ⚠️ NO GENERA FOLIO NI DOCUMENTO NUEVO (Daniel, decisión 2: la hoja lleva *"el folio del traspaso
 * que ya existe"*). El traspaso YA es un hecho del kardex con su folio (dos patas: salida del origen
 * + entrada al destino, `origenTipo = traspaso`); este módulo solo lo IMPRIME. Un documento paralelo
 * sería una SEGUNDA fuente de verdad del mismo hecho físico, cuando el saldo se deriva del kardex
 * (D3): dos folios para un movimiento acaban con uno de los dos mintiendo. Y A3 queda intacto — no
 * se toca ninguna secuencia.
 *
 * Qué lleva la hoja: el folio del traspaso, la fecha, QUIÉN lo registró, el almacén ORIGEN y el
 * DESTINO, el modelo, el MOTIVO (obligatorio desde esta misma fila) y el detalle color × talla, con
 * la ORDEN de producción de cada renglón cuando la tiene (la existencia de PT es por
 * modelo×color×talla×ORDEN×almacén — F6-E2/§Post-F9.40).
 *
 * El «registró» sale del `idUsuario` de la pata de SALIDA, resuelto a nombre por el embudo canónico
 * (`comun/nombres-usuario.ts`): esa columna es un id suelto SIN FK (ADR-0005), así que el nombre no
 * viaja por `include`. Si el id no resuelve —cuenta purgada, o un movimiento migrado que no lo
 * trae— la hoja imprime «—» y sale igual: la historia no se borra porque una cuenta se vaya (D3).
 *
 * ⚠️ A DIFERENCIA de la hoja de TELA, ésta NO lleva campo de «cortador / tercero», y no es un olvido:
 * `Almacen.idCortador` sólo se puede ligar a un almacén de **TELA** (`dominio/admin/almacenes.ts` →
 * `exigirCortadorValido`: *"Solo un almacén de TELAS puede ligarse a un cortador"*), y las DOS patas
 * de un traspaso de PT tienen que ser de tipo PT (fila 0.137). O sea que en esta hoja el campo
 * saldría «—» SIEMPRE: sería un renglón impreso que no puede llenarse nunca.
 *
 * REGLA 0-B — un traspaso VIEJO, capturado antes de que el motivo fuera obligatorio, tiene
 * `observaciones` NULL: la hoja imprime «—» y sale igual. No se rellena ni se repara nada.
 *
 * REIMPRIMIBLE desde el historial por el id de CUALQUIERA de las dos patas, no solo al momento de
 * guardar — mismo criterio que la hoja de tela. La puerta en pantalla es el KARDEX en modo «Por
 * folio» (`KardexPtPagina`): se busca el folio y el detalle del movimiento ofrece el botón. Y un
 * traspaso CANCELADO **no se imprime**: su papel no debe volver a salir con un bulto.
 *
 * Documento generado EN EL SERVIDOR con `@react-pdf/renderer`, MISMO motor y patrón que
 * `impreso-traspaso-tela.ts` (A1: la ruta solo valida permiso + Zod y delega; `armarDatos*` toca BD
 * en el hilo principal y `generarPdf*` es puro y corre en el worker).
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
import { nombreDeUsuario, nombresDeUsuarios } from '../../../comun/nombres-usuario.js';
import { ORIGEN } from '../../../comun/origenes.js';
import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';
import { verificarPermiso, type SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Un renglón de la matriz: un color (de una orden) con su cantidad por talla. */
export interface RenglonImpresoTraspasoPt {
  /** Nombre del color. */
  color: string;
  /**
   * Folio de la ORDEN de producción de la que salen estas piezas, o `null` si van del bucket «sin
   * orden» (lo capturado a mano en el arranque y lo migrado — §Post-F9.40).
   */
  folioOrden: number | null;
  /** Cantidades alineadas 1:1 con {@link DatosImpresoTraspasoPt.tallas}. */
  cantidades: number[];
  /** Total del renglón (suma de sus cantidades). */
  totalFila: number;
}

/** Todo lo que necesita la hoja del traspaso de PT, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoTraspasoPt {
  empresa: string;
  /** Folio del traspaso: el de la pata de SALIDA (el que ya existe; NO se genera uno nuevo). */
  folio: number;
  fecha: string;
  /**
   * QUIÉN registró el traspaso, ya resuelto a nombre (`Movimiento.idUsuario` guarda sólo el id, sin
   * FK física — ADR-0005). `null` cuando el movimiento no trae usuario (lo migrado del sistema
   * viejo) o cuando el id ya no resuelve (cuenta purgada): la hoja sale igual, con «—».
   *
   * En un papel que alguien FIRMA al recibir el bulto, el nombre de quien lo mandó es la mitad del
   * rastro; el motivo es la otra.
   */
  usuario: string | null;
  almacenOrigen: string;
  almacenDestino: string;
  /** Código del modelo traspasado (un traspaso de PT es de UN modelo). */
  modelo: string;
  /** Descripción del modelo, o null. */
  descripcionModelo: string | null;
  /**
   * MOTIVO del traspaso (fila 0.100). `null` SOLO en los traspasos viejos, capturados antes de que
   * el motivo fuera obligatorio (REGLA 0-B): la hoja sale igual, con «—».
   */
  motivo: string | null;
  /** Columnas de la matriz: etiquetas de talla, en el orden del catálogo. */
  tallas: string[];
  renglones: RenglonImpresoTraspasoPt[];
  /** Totales por columna (alineados con `tallas`). */
  totalesColumna: number[];
  totalPiezas: number;
}

// ── Resolución de datos (BD) ─────────────────────────────────────────────────────────────────────

/** `include` de las dos patas: detalle color×talla con nombres legibles + almacén. */
const incluirPata = {
  almacen: { select: { nombre: true } },
  anuladoPor: { select: { id: true } },
  tipoMov: { select: { direccion: true } },
  detallesPt: {
    orderBy: [{ idColor: 'asc' }, { idTalla: 'asc' }],
    include: {
      modelo: { select: { codigo: true, descripcion: true } },
      color: { select: { nombre: true } },
      talla: { select: { etiqueta: true, orden: true } },
      orden: { select: { folio: true } },
    },
  },
} satisfies Prisma.MovimientoInclude;

type PataConDetalle = Prisma.MovimientoGetPayload<{ include: typeof incluirPata }>;

/**
 * Proyecta el detalle color×talla de la pata de SALIDA a la matriz del impreso: columnas = tallas
 * (ordenadas por el `orden` del catálogo, con el id como desempate estable), filas = color × ORDEN
 * (§Post-F9.40 — agrupar solo por color fundiría piezas de producciones distintas en un renglón que
 * diría una orden que no es la de todas). Devuelve también los totales por columna y el general.
 */
function armarMatriz(
  detalles: PataConDetalle['detallesPt'],
): Pick<DatosImpresoTraspasoPt, 'tallas' | 'renglones' | 'totalesColumna' | 'totalPiezas'> {
  // Columnas: tallas únicas ordenadas por el catálogo (no por el orden en que llegaron los renglones).
  const porTalla = new Map<number, { etiqueta: string; orden: number }>();
  for (const d of detalles) {
    porTalla.set(d.idTalla, { etiqueta: d.talla.etiqueta, orden: d.talla.orden });
  }
  const columnas = [...porTalla.entries()]
    .sort(([idA, a], [idB, b]) => a.orden - b.orden || idA - idB)
    .map(([idTalla, t]) => ({ idTalla, etiqueta: t.etiqueta }));
  const tallas = columnas.map((c) => c.etiqueta);

  // Filas: color × orden, en el orden en que aparecen (el `include` ya viene ordenado por color).
  const filas = new Map<
    string,
    { color: string; folioOrden: number | null; porTalla: Map<number, number> }
  >();
  for (const d of detalles) {
    const clave = `${String(d.idColor)}:${d.idOrden === null ? 'sin' : String(d.idOrden)}`;
    let fila = filas.get(clave);
    if (fila === undefined) {
      fila = {
        color: d.color.nombre,
        folioOrden: d.orden === null ? null : Number(d.orden.folio),
        porTalla: new Map(),
      };
      filas.set(clave, fila);
    }
    fila.porTalla.set(d.idTalla, (fila.porTalla.get(d.idTalla) ?? 0) + d.cantidad);
  }

  const totalesColumna = new Array<number>(columnas.length).fill(0);
  let totalPiezas = 0;
  const renglones = [...filas.values()].map((fila) => {
    const cantidades = columnas.map((c) => fila.porTalla.get(c.idTalla) ?? 0);
    cantidades.forEach((valor, i) => {
      totalesColumna[i] = (totalesColumna[i] ?? 0) + valor;
    });
    const totalFila = cantidades.reduce((suma, v) => suma + v, 0);
    totalPiezas += totalFila;
    return { color: fila.color, folioOrden: fila.folioOrden, cantidades, totalFila };
  });

  return { tallas, renglones, totalesColumna, totalPiezas };
}

/**
 * Resuelve los datos de la hoja a partir de CUALQUIERA de las dos patas del traspaso (la de salida o
 * la de entrada — el kardex ofrece las dos): con la pata dada se encuentra su gemela y de ahí salen
 * origen y destino. A9: solo movimientos de la empresa activa (si no, 404). Permiso
 * `inventario-pt.ver` (A4, defensa en profundidad además del guard de la ruta).
 *
 * Lanza `ErrorValidacion` si el movimiento no es una pata de traspaso (un movimiento manual o el
 * efecto de un recibo no tienen "hoja de traspaso"), si no es de PT, o si el traspaso está CANCELADO
 * (su papel no vuelve a salir con un bulto).
 */
export async function armarDatosImpresoTraspasoPt(
  sesion: SesionUsuario,
  idMovimiento: number,
  bd?: ContextoBd,
): Promise<DatosImpresoTraspasoPt> {
  verificarPermiso(sesion, 'inventario-pt.ver');
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
  if (pata.detallesPt.length === 0) {
    throw new ErrorValidacion(
      'Este traspaso no es de producto terminado: no tiene hoja de traspaso de PT.',
    );
  }

  // La gemela: el motor materializa el traspaso como salida del origen + entrada al destino, y la
  // ENTRADA guarda `origenId = id de la salida`. Según qué pata llegue (la dirección de su tipo lo
  // dice), se busca hacia adelante (soy la salida) o hacia atrás (soy la entrada).
  const esSalida = pata.tipoMov.direccion === 'salida';
  // ⚠️ `Number(null)`, `Number('')` y `Number('  ')` son TODOS 0, y `Number.isInteger(0)` es `true`:
  // si se convirtiera a ciegas, la pata HUÉRFANA (entrada cuyo `origenId` es NULL o viene vacío) se
  // colaría como id 0 y este aviso —el que nombra el problema real— nunca saldría. Por eso el vacío
  // se separa ANTES de convertir (misma trampa cazada en la hoja de tela).
  const referenciaGemela = pata.origenId?.trim() ?? '';
  const idGemela = esSalida || referenciaGemela === '' ? null : Number(referenciaGemela);
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

  // Un traspaso cancelado NO se imprime. Basta con que CUALQUIERA de las patas esté anulada: el
  // traspaso ya no representa un bulto en camino.
  if (salida.anuladoPor.length > 0 || entrada.anuladoPor.length > 0) {
    throw new ErrorValidacion(
      'Este traspaso está cancelado: su hoja no se vuelve a imprimir (no debe salir con un bulto).',
    );
  }

  const primerDetalle = salida.detallesPt[0];
  if (primerDetalle === undefined) {
    // La pata que llegó tenía detalle de PT, pero su gemela (la salida) no: dato roto, se dice.
    throw new ErrorValidacion(
      `La pata de salida del traspaso del movimiento ${String(idMovimiento)} no tiene renglones ` +
        'de producto terminado: no se puede imprimir la hoja.',
    );
  }

  // QUIÉN lo registró. `Movimiento.idUsuario` es un id suelto SIN FK (ADR-0005: el log de inventario
  // es inmutable y no puede quedar atado al ciclo de vida de una cuenta), así que el nombre no viaja
  // por `include`: se va por él con el embudo canónico del proyecto, que ya resuelve el lote de una
  // consulta y devuelve `null` —nunca revienta— cuando el id no existe o es NULL.
  const nombrePorId = await nombresDeUsuarios(cliente, [salida.idUsuario]);

  return {
    empresa: sesion.nombreEmpresaActiva,
    // El folio de la pata de SALIDA es EL folio del traspaso (el que ya existe).
    folio: Number(salida.folio),
    fecha: salida.fecha.toISOString().slice(0, 10),
    usuario: nombreDeUsuario(nombrePorId, salida.idUsuario),
    almacenOrigen: salida.almacen.nombre,
    almacenDestino: entrada.almacen.nombre,
    modelo: primerDetalle.modelo.codigo,
    descripcionModelo: primerDetalle.modelo.descripcion,
    // REGLA 0-B: NULL en los traspasos viejos (sin motivo). La hoja sale igual.
    motivo: salida.observaciones,
    ...armarMatriz(salida.detallesPt),
  };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

const estilos = StyleSheet.create({
  colColor: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  colTalla: { width: 34, textAlign: 'center' },
  colTotal: { width: 42, textAlign: 'center', fontFamily: FUENTE.negrita },
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

/**
 * Etiqueta de la fila: el color y, cuando las piezas llevan ORDEN, de cuál salieron. En el papel eso
 * es lo que evita que un bulto se confunda con otro del mismo color de otra producción.
 */
function etiquetaFila(r: RenglonImpresoTraspasoPt): string {
  return r.folioOrden === null ? r.color : `${r.color} · OP ${String(r.folioOrden)}`;
}

/** Tabla MATRIZ color×talla con totales por fila/columna y total general. */
function tablaMatriz(datos: DatosImpresoTraspasoPt): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colColor] }, 'Color'),
    ...datos.tallas.map((t, i) =>
      h(
        Text,
        {
          key: `th-${String(i)}`,
          style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colTalla],
        },
        t,
      ),
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colTotal] }, 'Total'),
  );

  const filasColor = datos.renglones.map((r, fila) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `fila-${String(fila)}`, wrap: false },
      h(Text, { style: [estilosDoc.celda, estilos.colColor] }, etiquetaFila(r)),
      ...r.cantidades.map((c, i) =>
        h(
          Text,
          { key: `c-${String(fila)}-${String(i)}`, style: [estilosDoc.celda, estilos.colTalla] },
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
        {
          key: `tc-${String(i)}`,
          style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.colTalla],
        },
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
    TituloSeccion('Prendas que se traspasan (color × talla)'),
    ...cuerpo,
  );
}

/** Espacios de firma (entrega / recibe): la hoja va con el bulto y se firma de recibido. */
function firmas(): ReactElement {
  return h(
    View,
    { style: estilos.firmas, key: 'firmas' },
    h(Text, { style: [estilos.firma, estilosDoc.etiquetaCampo] }, 'Entrega (almacén origen)'),
    h(Text, { style: [estilos.firma, estilosDoc.etiquetaCampo] }, 'Recibe (almacén destino)'),
  );
}

/** La página de la hoja de traspaso. */
function paginaTraspaso(datos: DatosImpresoTraspasoPt): ReactElement {
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Traspaso de producto terminado entre almacenes — CONTROL v2',
      derecha: { etiqueta: 'Folio del traspaso', valor: String(datos.folio), grande: true },
    }),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Almacén origen', datos.almacenOrigen),
      campo('Almacén destino', datos.almacenDestino),
      campo('Fecha', datos.fecha),
      // Quien lo mandó, en el mismo papel que quien lo recibe va a firmar.
      campo('Registró', datos.usuario),
      campo('Modelo', datos.modelo),
      campo('Descripción', datos.descripcionModelo),
    ),
    // El MOTIVO es lo que esta fila vino a exigir: en la hoja va a la vista, no escondido al pie.
    h(
      View,
      { style: estilosDoc.campoDosTercios, key: 'motivo' },
      h(Text, { style: estilosDoc.etiquetaCampo }, 'Motivo del traspaso'),
      h(Text, { style: estilosDoc.valorCampoTexto }, datos.motivo ?? '—'),
    ),
    tablaMatriz(datos),
    firmas(),
    PieDocumento({
      // ⚠️ SIN flecha «→»: no está en WinAnsi y `@react-pdf` la imprime como un apóstrofo (medido
      // al extraer el texto del PDF). La hoja de tela arrastra ese glifo roto en su propio pie.
      contexto:
        `CONTROL v2 · ${datos.empresa} · Traspaso ${String(datos.folio)} · ` +
        `de ${datos.almacenOrigen} a ${datos.almacenDestino}`,
    }),
  ];
  return h(
    Page,
    { key: 'traspaso', size: 'A4', style: estilosDoc.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de UNA hoja de traspaso de PT. */
function documentoTraspaso(datos: DatosImpresoTraspasoPt): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Traspaso de producto terminado ${String(datos.folio)}`,
      author: datos.empresa,
      subject: 'Traspaso de producto terminado entre almacenes',
    },
    paginaTraspaso(datos),
  );
}

// ── Generación del Buffer (función pura) ─────────────────────────────────────────────────────────

/** Genera el PDF (Buffer) de la hoja de traspaso a partir de sus datos resueltos. */
export async function generarPdfTraspasoPt(datos: DatosImpresoTraspasoPt): Promise<Buffer> {
  return renderToBuffer(documentoTraspaso(datos));
}

// ── Orquestación de alto nivel (resuelve datos + genera) — la usa la ruta ────────────────────────

/** Resultado de generar la hoja de traspaso (Buffer + folio para el `filename`). */
export interface ImpresoTraspasoPt {
  buffer: Buffer;
  folio: number;
}

/** Resuelve los datos del traspaso (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoTraspasoPt(
  sesion: SesionUsuario,
  idMovimiento: number,
  bd?: ContextoBd,
): Promise<ImpresoTraspasoPt> {
  const datos = await armarDatosImpresoTraspasoPt(sesion, idMovimiento, bd);
  return {
    buffer: await renderizarPdfEnWorker('traspaso-pt', datos, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
    folio: datos.folio,
  };
}
