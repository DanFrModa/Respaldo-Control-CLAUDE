/**
 * Impreso PDF del ESTADO DE RESULTADOS ANUAL (F7-E2, R9; doc 06-Costos-y-EDR §4 "EDR por año"). Reusa
 * {@link edrPorAnio} (A1). Comparativo mensual (ventas/costo/gastos/resultado por mes) + totales + el
 * corte por empresa del año. Generado EN EL SERVIDOR con `@react-pdf/renderer`.
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
} from '../../../comun/impresos-estilos.js';

import type { EdrPorAnioSalida } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';

import { edrPorAnio } from '../edr.js';

import { MESES_ES, membreteConsolidado, pesos } from './comun-edr.js';

/** Datos resueltos del impreso anual. */
export interface DatosImpresoEdrAnual {
  membrete: string;
  anual: EdrPorAnioSalida;
}

/** Dependencias inyectables (tests inyectan `edrPorAnio` fake). */
export interface DepsImpresoEdrAnual {
  edrPorAnio?: typeof edrPorAnio;
}

/** Resuelve el comparativo anual + el membrete consolidado. */
export async function armarDatosImpresoEdrAnual(
  sesion: SesionUsuario,
  anio: number,
  bd?: ContextoBd,
  deps: DepsImpresoEdrAnual = {},
): Promise<DatosImpresoEdrAnual> {
  const obtener = deps.edrPorAnio ?? edrPorAnio;
  const anual = await obtener(sesion, anio, bd);
  const membrete = await membreteConsolidado(bd);
  return { membrete, anual };
}

const estilos = StyleSheet.create({
  // Anchos de columna PROPIOS (lo compartido vive en `estilosDoc`).
  colMes: { width: 74 },
  colFlex: { flexGrow: 1, flexBasis: 0 },
  colNum: { width: 80, textAlign: 'right' },
});

function pagina(datos: DatosImpresoEdrAnual): ReactElement {
  const a = datos.anual;
  const enc = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colMes] }, 'Mes'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Ventas'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Costo'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Gastos'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Resultado'),
  );
  const filas = a.meses.map((m, i) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `m-${i}`, wrap: false },
      h(Text, { style: [estilosDoc.celda, estilos.colMes] }, MESES_ES[m.mes] ?? String(m.mes)),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pesos(m.ventas)),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pesos(m.costo)),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pesos(m.gastos)),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pesos(m.resultado)),
    ),
  );
  const total = h(
    View,
    { style: [estilosDoc.filaTabla, estilosDoc.filaTotal], key: 'total' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.colMes] }, 'TOTAL'),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.colNum] },
      pesos(a.totalVentas),
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.colNum] },
      pesos(a.totalCosto),
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.colNum] }, ''),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.colNum] },
      pesos(a.totalResultado),
    ),
  );

  const encEmp = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc-emp' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colFlex] }, 'Empresa'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Ventas'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Costo'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Utilidad'),
  );
  const filasEmp = a.porEmpresa.map((c, i) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `e-${i}`, wrap: false },
      h(Text, { style: [estilosDoc.celda, estilos.colFlex] }, c.empresa),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pesos(c.ventas)),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pesos(c.costo)),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pesos(c.utilidadBruta)),
    ),
  );

  return h(
    Page,
    { size: 'A4', style: estilosDoc.pagina },
    EncabezadoDocumento({
      empresa: datos.membrete,
      titulo: `Estado de Resultados ${a.anio} · Comparativo mensual · Consolidado (costo actual)`,
    }),
    TituloSeccion('Por mes'),
    ...(a.meses.length === 0
      ? [h(Text, { key: 'v', style: estilosDoc.subtitulo }, 'Sin meses generados en el año.')]
      : [enc, ...filas, total]),
    TituloSeccion('Por empresa (año)'),
    ...(a.porEmpresa.length === 0 ? [] : [encEmp, ...filasEmp]),
    PieDocumento({ contexto: `CONTROL v2 · ${datos.membrete} · Estado de Resultados ${a.anio}` }),
  );
}

function documento(datos: DatosImpresoEdrAnual): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `EDR ${datos.anual.anio}`,
      author: datos.membrete,
      subject: 'Estado de Resultados anual',
    },
    pagina(datos),
  );
}

/** Genera el PDF (Buffer) del EDR anual. */
export async function generarPdfEdrAnual(datos: DatosImpresoEdrAnual): Promise<Buffer> {
  return renderToBuffer(documento(datos));
}

/** Resuelve los datos y devuelve el PDF del EDR anual. */
export async function impresoEdrAnual(
  sesion: SesionUsuario,
  anio: number,
  bd?: ContextoBd,
  deps: DepsImpresoEdrAnual = {},
): Promise<{ buffer: Buffer }> {
  const datos = await armarDatosImpresoEdrAnual(sesion, anio, bd, deps);
  return { buffer: await renderizarPdfEnWorker('edr-anual', datos) };
}
