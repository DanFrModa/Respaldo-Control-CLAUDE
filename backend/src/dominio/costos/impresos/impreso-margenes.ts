/**
 * Impreso PDF de COSTOS Y MÁRGENES POR PEDIDO (F7-E1, R9; doc 06-Costos-y-EDR §5). Reusa
 * {@link margenesPorPedido} (A1: la lógica NO se duplica; el ocultamiento de importes/márgenes sin
 * `consultas.ver-importes` y el scope de empresa A9 ya los aplica el dominio). Generado EN EL SERVIDOR
 * con `@react-pdf/renderer`. El Excel del mismo reporte vive en `excel-margenes.ts`.
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

import type { MargenesSalida, MargenesQuery } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';
import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';
import {
  estilosDoc,
  FUENTE,
  PALETA,
  EncabezadoDocumento,
  PieDocumento,
  LeyendaTruncado,
} from '../../../comun/impresos-estilos.js';
import { MAX_FILAS_PDF, leyendaTruncado } from '../../../comun/impreso-topes.js';
import type { z } from 'zod';
import type { esquemaMargenesQuery } from '../../../contrato/index.js';

import { margenesPorPedido } from '../margenes.js';

import { pagadorDeEmpresa } from './impreso-lista-precios.js';

/** Datos resueltos del impreso (forma PURA). */
export interface DatosImpresoMargenes {
  pagador: string;
  /** Márgenes con las filas YA topadas a `MAX_FILAS_PDF` (los totales siguen siendo del universo). */
  margenes: MargenesSalida;
  /** Conteo de pedidos del universo COMPLETO del filtro (para el aviso de truncado). */
  totalFilas: number;
}

/** Dependencias inyectables (tests inyectan `margenesPorPedido` fake). */
export interface DepsImpresoMargenes {
  margenesPorPedido?: typeof margenesPorPedido;
}

/** Resuelve los datos (A9) + la razón social de la empresa activa. */
export async function armarDatosImpresoMargenes(
  sesion: SesionUsuario,
  query: z.input<typeof esquemaMargenesQuery> = {},
  bd?: ContextoBd,
  deps: DepsImpresoMargenes = {},
): Promise<DatosImpresoMargenes> {
  const obtener = deps.margenesPorPedido ?? margenesPorPedido;
  const margenes = await obtener(sesion, query, bd);
  const empresa = await clienteLectura(bd).empresa.findUnique({
    where: { id: sesion.idEmpresaActiva },
    select: { razonSocial: true, nombre: true },
  });
  const pagador = pagadorDeEmpresa(
    empresa ?? { razonSocial: null, nombre: sesion.nombreEmpresaActiva },
  );
  // Blindaje: se DIBUJAN a lo más `MAX_FILAS_PDF` pedidos; los totales (piezas/importe) siguen siendo
  // del universo COMPLETO del filtro (los calcula el dominio sobre todas las filas).
  return {
    pagador,
    margenes: { ...margenes, filas: margenes.filas.slice(0, MAX_FILAS_PDF) },
    totalFilas: margenes.filas.length,
  };
}

function pesos(n: number | null): string {
  if (n === null) return '—';
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** Fracción → porcentaje legible (o "—"). */
function pct(n: number | null): string {
  if (n === null) return '—';
  return `${(n * 100).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

const estilos = StyleSheet.create({
  // Anchos de columna y bloque de total PROPIOS (lo compartido vive en `estilosDoc`).
  colChica: { width: 44 },
  colFlex: { flexGrow: 1, flexBasis: 0 },
  colNum: { width: 62, textAlign: 'right' },
  totalBloque: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 24,
    borderTopWidth: 1,
    borderTopColor: PALETA.marca,
    paddingTop: 8,
  },
  totalItem: { alignItems: 'flex-end' },
  totalValor: { fontSize: 12, fontFamily: FUENTE.negrita },
});

function pagina(datos: DatosImpresoMargenes): ReactElement {
  const m = datos.margenes;
  const enc = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colChica] }, 'Pedido'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colFlex] }, 'Cliente'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colChica] }, 'Fecha'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Piezas'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Importe'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'M. prom.'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'M. pond.'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'M. $/pza'),
  );
  const filas = m.filas.map((f, i) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `f-${i}`, wrap: false },
      h(Text, { style: [estilosDoc.celda, estilos.colChica] }, `#${String(f.folio)}`),
      h(Text, { style: [estilosDoc.celda, estilos.colFlex] }, f.cliente),
      h(Text, { style: [estilosDoc.celda, estilos.colChica] }, f.fechaHasta ?? '—'),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, String(f.cantidad)),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pesos(f.importe)),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pct(f.margenPromedio)),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pct(f.margenPonderado)),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pesos(f.margenPesosPorPieza)),
    ),
  );
  const textoTruncado = leyendaTruncado(m.filas.length, datos.totalFilas);
  const aviso = textoTruncado === null ? [] : [LeyendaTruncado(textoTruncado)];

  return h(
    Page,
    { size: 'A4', orientation: 'landscape', style: estilosDoc.pagina },
    EncabezadoDocumento({
      empresa: datos.pagador,
      titulo: 'Costos y márgenes por pedido — CONTROL v2',
    }),
    enc,
    ...(filas.length === 0
      ? [h(Text, { key: 'v', style: estilosDoc.subtitulo }, 'Sin pedidos costeados en el periodo.')]
      : filas),
    ...aviso,
    h(
      View,
      { style: estilos.totalBloque, key: 'tot' },
      h(
        View,
        { style: estilos.totalItem, key: 'p' },
        h(Text, { style: estilosDoc.etiquetaMenor }, 'Piezas'),
        h(Text, { style: estilos.totalValor }, String(m.totalPiezas)),
      ),
      h(
        View,
        { style: estilos.totalItem, key: 'i' },
        h(Text, { style: estilosDoc.etiquetaMenor }, 'Importe'),
        h(Text, { style: estilos.totalValor }, pesos(m.totalImporte)),
      ),
    ),
    PieDocumento({ contexto: `CONTROL v2 · ${datos.pagador} · Costos y márgenes por pedido` }),
  );
}

function documento(datos: DatosImpresoMargenes): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: 'Márgenes por pedido',
      author: datos.pagador,
      subject: 'Costos y márgenes por pedido',
    },
    pagina(datos),
  );
}

/** Genera el PDF (Buffer) de los márgenes por pedido. */
export async function generarPdfMargenes(datos: DatosImpresoMargenes): Promise<Buffer> {
  return renderToBuffer(documento(datos));
}

/** Resuelve los datos (A9) y devuelve el PDF de márgenes por pedido. */
export async function impresoMargenes(
  sesion: SesionUsuario,
  query: z.input<typeof esquemaMargenesQuery> = {},
  bd?: ContextoBd,
  deps: DepsImpresoMargenes = {},
): Promise<{ buffer: Buffer }> {
  const datos = await armarDatosImpresoMargenes(sesion, query, bd, deps);
  return {
    buffer: await renderizarPdfEnWorker('costos-margenes', datos, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
  };
}

/** Reexporta el tipo del filtro para la ruta (comodidad). */
export type { MargenesQuery };
