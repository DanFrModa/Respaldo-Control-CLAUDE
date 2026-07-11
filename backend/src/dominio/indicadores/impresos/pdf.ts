/**
 * Impresos PDF de los TABLEROS DIRECTIVOS de indicadores (F7-E3, R9). Generados EN EL SERVIDOR con
 * `@react-pdf/renderer`. REUSAN los servicios de dominio (`kpis.ts`, A1). El Excel de los mismos
 * tableros vive en `excel.ts`.
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
  type Styles,
} from '@react-pdf/renderer';

/** Un estilo de react-pdf (los valores de `StyleSheet.create`). */
type Style = Styles[string];

import type { KpisRc, KpisCalidad, KpisWip } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';

import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';
import {
  estilosDoc,
  FUENTE,
  PALETA,
  EncabezadoDocumento,
  PieDocumento,
} from '../../../comun/impresos-estilos.js';

import { kpisRutaCritica, kpisCalidadMaquilero, kpisWip } from '../kpis.js';
import type { ParametrosKpisRc, ParametrosKpisCalidad, ParametrosKpisWip } from '../kpis.js';

import { etiquetaMes, num1, pct, razonSocialEmpresa } from './comun.js';

const estilos = StyleSheet.create({
  // Estilos PROPIOS de los tableros (lo compartido vive en `estilosDoc`).
  seccionTitulo: {
    fontSize: 11,
    fontFamily: FUENTE.negrita,
    color: PALETA.marca,
    marginTop: 14,
    marginBottom: 4,
  },
  destacado: { fontSize: 12, fontFamily: FUENTE.negrita, color: PALETA.tinta },
});

/** Una columna de una tabla del impreso. */
interface Columna {
  titulo: string;
  ancho?: number; // px fijos; sin ancho = flex
  derecha?: boolean;
}

/** Renderiza una tabla (encabezado + filas) con las columnas dadas. */
function tabla(clave: string, columnas: Columna[], filas: string[][]): ReactElement {
  const estiloCol = (c: Columna): Style[] => {
    const arr: Style[] = [estilosDoc.celda];
    arr.push(c.ancho === undefined ? { flexGrow: 1, flexBasis: 0 } : { width: c.ancho });
    if (c.derecha) arr.push({ textAlign: 'right' });
    return arr;
  };
  const enc = h(
    View,
    { style: estilosDoc.filaTabla, key: `${clave}-enc` },
    ...columnas.map((c, i) =>
      h(Text, { key: `h-${i}`, style: [...estiloCol(c), estilosDoc.celdaEncabezado] }, c.titulo),
    ),
  );
  const cuerpo =
    filas.length === 0
      ? [h(Text, { key: `${clave}-v`, style: estilosDoc.subtitulo }, 'Sin datos en el periodo.')]
      : filas.map((fila, r) =>
          h(
            View,
            { style: estilosDoc.filaTabla, key: `${clave}-f-${r}`, wrap: false },
            ...columnas.map((c, i) =>
              h(Text, { key: `c-${i}`, style: estiloCol(c) }, fila[i] ?? ''),
            ),
          ),
        );
  return h(View, { key: clave }, enc, ...cuerpo);
}

/** Sello "datos al:" legible. */
function selloDatosAl(datosAl: string | null): string {
  if (datosAl === null) return 'Datos al: (aún no se calculan)';
  return `Datos al: ${new Date(datosAl).toLocaleString('es-MX')}`;
}

/** Encabezado común del impreso (identidad compartida + sello "datos al"). */
function encabezado(pagador: string, titulo: string, datosAl: string | null): ReactElement {
  return h(
    View,
    { key: 'enc-wrap' },
    EncabezadoDocumento({ empresa: pagador, titulo: `${titulo} — CONTROL v2` }),
    h(Text, { style: estilosDoc.subtitulo }, selloDatosAl(datosAl)),
  );
}

/** Envuelve las secciones en un Document A4 apaisado. */
function documento(
  pagador: string,
  titulo: string,
  contenido: ReactElement[],
): ReactElement<DocumentProps> {
  return h(
    Document,
    { title: titulo, author: pagador, subject: titulo },
    h(
      Page,
      { size: 'A4', orientation: 'landscape', style: estilosDoc.pagina },
      ...contenido,
      PieDocumento({ contexto: `CONTROL v2 · ${pagador} · ${titulo}` }),
    ),
  );
}

// ── Ruta Crítica ──────────────────────────────────────────────────────────────────────────────────

/** Dependencias inyectables (tests). */
export interface DepsPdfRc {
  kpisRutaCritica?: typeof kpisRutaCritica;
}

/** Genera el PDF del tablero de KPIs de Ruta Crítica. */
export async function impresoKpisRc(
  sesion: SesionUsuario,
  parametros: ParametrosKpisRc = {},
  bd?: ContextoBd,
  deps: DepsPdfRc = {},
): Promise<{ buffer: Buffer }> {
  const obtener = deps.kpisRutaCritica ?? kpisRutaCritica;
  const datos: KpisRc = await obtener(sesion, parametros, bd);
  const pagador = await razonSocialEmpresa(sesion, bd);
  return { buffer: await renderizarPdfEnWorker('kpis-rc', { pagador, datos }) };
}

/** Payload YA resuelto del tablero de RC (para el render en worker). */
export interface PayloadPdfKpisRc {
  pagador: string;
  datos: KpisRc;
}

/** Render PURO del tablero de KPIs de Ruta Crítica (datos ya resueltos → Buffer). */
export async function generarPdfKpisRc(payload: PayloadPdfKpisRc): Promise<Buffer> {
  const { pagador, datos } = payload;
  const titulo = 'Indicadores — Ruta Crítica';

  const et = datos.entregasATiempo;
  const contenido: ReactElement[] = [
    encabezado(pagador, titulo, datos.datosAl),
    h(Text, { key: 't-ent', style: estilos.seccionTitulo }, 'Entregas a tiempo (último proceso)'),
    h(
      Text,
      { key: 'v-ent', style: estilos.destacado },
      `${pct(et.porcentaje)}  (${et.aTiempo} a tiempo de ${et.medibles} medibles` +
        `${et.completadasSinPlan > 0 ? `; ${et.completadasSinPlan} completada(s) sin plan` : ''})`,
    ),
    h(Text, { key: 't-lt', style: estilos.seccionTitulo }, 'Lead time por proceso (días)'),
    tabla(
      'lt',
      [
        { titulo: 'Proceso' },
        { titulo: 'n', ancho: 44, derecha: true },
        { titulo: 'Real prom.', ancho: 70, derecha: true },
        { titulo: 'Estimado', ancho: 70, derecha: true },
      ],
      datos.leadTime.map((l) => [
        l.nombreProceso,
        String(l.numProcesos),
        num1(l.diasRealesProm),
        num1(l.diasEstimadoProm),
      ]),
    ),
    h(
      Text,
      { key: 't-cb', style: estilos.seccionTitulo },
      'Cuellos de botella (atraso medio, días)',
    ),
    tabla(
      'cb',
      [
        { titulo: 'Proceso' },
        { titulo: 'n', ancho: 44, derecha: true },
        { titulo: 'Atraso medio', ancho: 80, derecha: true },
      ],
      datos.cuellosBotella.map((c) => [
        c.nombreProceso,
        String(c.numProcesos),
        num1(c.atrasoMedioDias),
      ]),
    ),
    h(Text, { key: 't-dr', style: estilos.seccionTitulo }, 'Desempeño por responsable'),
    tabla(
      'dr',
      [
        { titulo: 'Responsable' },
        { titulo: 'Procesos', ancho: 60, derecha: true },
        { titulo: 'A tiempo', ancho: 60, derecha: true },
        { titulo: '%', ancho: 60, derecha: true },
      ],
      datos.desempeno.map((d) => [
        d.responsable,
        String(d.numProcesos),
        String(d.aTiempo),
        pct(d.porcentaje),
      ]),
    ),
  ];
  return renderToBuffer(documento(pagador, titulo, contenido));
}

// ── Calidad por maquilero ───────────────────────────────────────────────────────────────────────

/** Dependencias inyectables (tests). */
export interface DepsPdfCalidad {
  kpisCalidadMaquilero?: typeof kpisCalidadMaquilero;
}

/** Genera el PDF del tablero de calidad por maquilero. */
export async function impresoKpisCalidad(
  sesion: SesionUsuario,
  parametros: ParametrosKpisCalidad = {},
  bd?: ContextoBd,
  deps: DepsPdfCalidad = {},
): Promise<{ buffer: Buffer }> {
  const obtener = deps.kpisCalidadMaquilero ?? kpisCalidadMaquilero;
  const datos: KpisCalidad = await obtener(sesion, parametros, bd);
  const pagador = await razonSocialEmpresa(sesion, bd);
  return { buffer: await renderizarPdfEnWorker('kpis-calidad', { pagador, datos }) };
}

/** Payload YA resuelto del tablero de calidad por maquilero (para el render en worker). */
export interface PayloadPdfKpisCalidad {
  pagador: string;
  datos: KpisCalidad;
}

/** Render PURO del tablero de calidad por maquilero (datos ya resueltos → Buffer). */
export async function generarPdfKpisCalidad(payload: PayloadPdfKpisCalidad): Promise<Buffer> {
  const { pagador, datos } = payload;
  const titulo = 'Indicadores — Calidad por maquilero';

  const contenido: ReactElement[] = [
    encabezado(pagador, titulo, datos.datosAl),
    h(Text, { key: 't-mq', style: estilos.seccionTitulo }, 'Aprobación por maquilero'),
    tabla(
      'mq',
      [
        { titulo: 'Maquilero' },
        { titulo: 'Auditorías', ancho: 66, derecha: true },
        { titulo: 'Aprobadas', ancho: 66, derecha: true },
        { titulo: 'Calificadas', ancho: 70, derecha: true },
        { titulo: '% aprob.', ancho: 60, derecha: true },
      ],
      datos.maquileros.map((m) => [
        m.maquilero,
        String(m.numAuditorias),
        String(m.aprobadas),
        String(m.calificadas),
        pct(m.porcentaje),
      ]),
    ),
    h(Text, { key: 't-df', style: estilos.seccionTitulo }, 'Defectos más frecuentes'),
    tabla(
      'df',
      [
        { titulo: 'Clave', ancho: 70 },
        { titulo: 'Defecto' },
        { titulo: 'Fallas', ancho: 60, derecha: true },
        { titulo: 'Auditorías', ancho: 66, derecha: true },
      ],
      datos.defectosTop.map((d) => [
        d.clave,
        d.descripcion,
        String(d.totalFallas),
        String(d.numAuditorias),
      ]),
    ),
    h(Text, { key: 't-tn', style: estilos.seccionTitulo }, 'Tendencia mensual de aprobación'),
    tabla(
      'tn',
      [
        { titulo: 'Mes', ancho: 80 },
        { titulo: 'Auditorías', ancho: 66, derecha: true },
        { titulo: 'Aprobadas', ancho: 66, derecha: true },
        { titulo: '% aprob.', ancho: 60, derecha: true },
      ],
      datos.tendencia.map((t) => [
        `${etiquetaMes(t.mes)} ${t.anio}`,
        String(t.numAuditorias),
        String(t.aprobadas),
        pct(t.porcentaje),
      ]),
    ),
  ];
  return renderToBuffer(documento(pagador, titulo, contenido));
}

// ── WIP analítico ─────────────────────────────────────────────────────────────────────────────────

/** Dependencias inyectables (tests). */
export interface DepsPdfWip {
  kpisWip?: typeof kpisWip;
}

/** Genera el PDF del tablero WIP analítico. */
export async function impresoKpisWip(
  sesion: SesionUsuario,
  parametros: ParametrosKpisWip = {},
  bd?: ContextoBd,
  deps: DepsPdfWip = {},
): Promise<{ buffer: Buffer }> {
  const obtener = deps.kpisWip ?? kpisWip;
  // `porPagina: 100` topa la lista de órdenes con avance (el tablero es un concentrado directivo).
  const datos: KpisWip = await obtener(sesion, { ...parametros, porPagina: 100 }, bd);
  const pagador = await razonSocialEmpresa(sesion, bd);
  return { buffer: await renderizarPdfEnWorker('kpis-wip', { pagador, datos }) };
}

/** Payload YA resuelto del tablero WIP analítico (para el render en worker). */
export interface PayloadPdfKpisWip {
  pagador: string;
  datos: KpisWip;
}

/** Render PURO del tablero WIP analítico (datos ya resueltos → Buffer). */
export async function generarPdfKpisWip(payload: PayloadPdfKpisWip): Promise<Buffer> {
  const { pagador, datos } = payload;
  const titulo = 'Indicadores — WIP analítico';
  const t = datos.totales;

  const contenido: ReactElement[] = [
    encabezado(pagador, titulo, datos.datosAl),
    h(Text, { key: 't-tot', style: estilos.seccionTitulo }, 'Totales por etapa'),
    tabla(
      'tot',
      [
        { titulo: 'Por cortar', derecha: true },
        { titulo: 'Cortado por enviar', derecha: true },
        { titulo: 'Por recibir', derecha: true },
        { titulo: 'Por entregar', derecha: true },
      ],
      [
        [
          String(t.porCortar),
          String(t.cortadoPorEnviar),
          String(t.porRecibir),
          String(t.porEntregar),
        ],
      ],
    ),
    h(Text, { key: 't-ord', style: estilos.seccionTitulo }, 'Órdenes con avance'),
    tabla(
      'ord',
      [
        { titulo: 'Folio', ancho: 44 },
        { titulo: 'Cliente' },
        { titulo: 'Modelo', ancho: 80 },
        { titulo: 'Ped.', ancho: 40, derecha: true },
        { titulo: 'Cort.', ancho: 40, derecha: true },
        { titulo: 'Env.', ancho: 40, derecha: true },
        { titulo: 'Rec.', ancho: 40, derecha: true },
        { titulo: 'Entr.', ancho: 40, derecha: true },
        { titulo: 'x recibir', ancho: 52, derecha: true },
        { titulo: 'x entregar', ancho: 56, derecha: true },
      ],
      datos.datos.map((o) => [
        `#${String(o.folio)}`,
        o.cliente,
        o.codigoModelo,
        String(o.pedido),
        String(o.cortado),
        String(o.enviado),
        String(o.recibido),
        String(o.entregado),
        String(o.porRecibir),
        String(o.porEntregar),
      ]),
    ),
  ];
  return renderToBuffer(documento(pagador, titulo, contenido));
}
