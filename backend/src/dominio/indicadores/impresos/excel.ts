/**
 * Export a EXCEL de los TABLEROS DIRECTIVOS de indicadores (F7-E3). MISMO resultado que la pantalla /
 * PDF: REUSAN los servicios de dominio (`kpis.ts`, A1) y vuelcan sus filas a un libro `.xlsx` con
 * `exceljs`. Genera un BUFFER en el servidor (mismo patrón que `costos/impresos/excel-margenes.ts`).
 */
import ExcelJS from 'exceljs';

import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';

import { kpisRutaCritica, kpisCalidadMaquilero, kpisWip } from '../kpis.js';
import type { ParametrosKpisRc, ParametrosKpisCalidad, ParametrosKpisWip } from '../kpis.js';

import { TEAL_XLSX, etiquetaMes } from './comun.js';

/** Aplica el estilo teal a una fila de encabezado. */
function estilarEncabezado(fila: ExcelJS.Row): void {
  fila.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  fila.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL_XLSX } };
  fila.alignment = { vertical: 'middle' };
}

/** Libro base con metadatos comunes. */
function nuevoLibro(): ExcelJS.Workbook {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'CONTROL v2';
  libro.created = new Date();
  return libro;
}

/** Dependencias inyectables (tests). */
export interface DepsExcelRc {
  kpisRutaCritica?: typeof kpisRutaCritica;
}

/** Genera el `.xlsx` del tablero de KPIs de Ruta Crítica. */
export async function excelKpisRc(
  sesion: SesionUsuario,
  parametros: ParametrosKpisRc = {},
  bd?: ContextoBd,
  deps: DepsExcelRc = {},
): Promise<{ buffer: Buffer }> {
  const obtener = deps.kpisRutaCritica ?? kpisRutaCritica;
  const datos = await obtener(sesion, parametros, bd);
  const libro = nuevoLibro();

  const resumen = libro.addWorksheet('Resumen');
  resumen.addRow(['Entregas a tiempo (último proceso)']);
  resumen.addRow(['Completadas', datos.entregasATiempo.completadas]);
  resumen.addRow(['Medibles (con plan)', datos.entregasATiempo.medibles]);
  resumen.addRow(['Completadas sin plan', datos.entregasATiempo.completadasSinPlan]);
  resumen.addRow(['A tiempo', datos.entregasATiempo.aTiempo]);
  resumen.addRow(['% a tiempo (÷ medibles)', datos.entregasATiempo.porcentaje ?? '']);
  resumen.getRow(1).font = { bold: true };
  resumen.getColumn(1).width = 26;
  resumen.getColumn(2).width = 16;

  const lt = libro.addWorksheet('Lead time');
  lt.columns = [
    { header: 'Proceso', key: 'proc', width: 30 },
    { header: 'n', key: 'n', width: 8 },
    { header: 'Días reales prom.', key: 'real', width: 18 },
    { header: 'Días estimado prom.', key: 'est', width: 18 },
  ];
  estilarEncabezado(lt.getRow(1));
  for (const l of datos.leadTime) {
    lt.addRow({
      proc: l.nombreProceso,
      n: l.numProcesos,
      real: l.diasRealesProm ?? '',
      est: l.diasEstimadoProm ?? '',
    });
  }

  const cb = libro.addWorksheet('Cuellos');
  cb.columns = [
    { header: 'Proceso', key: 'proc', width: 30 },
    { header: 'n', key: 'n', width: 8 },
    { header: 'Atraso medio (días)', key: 'atr', width: 20 },
  ];
  estilarEncabezado(cb.getRow(1));
  for (const c of datos.cuellosBotella) {
    cb.addRow({ proc: c.nombreProceso, n: c.numProcesos, atr: c.atrasoMedioDias ?? '' });
  }

  const dr = libro.addWorksheet('Responsables');
  dr.columns = [
    { header: 'Responsable', key: 'resp', width: 30 },
    { header: 'Procesos', key: 'proc', width: 12 },
    { header: 'A tiempo', key: 'at', width: 12 },
    { header: '% a tiempo', key: 'pct', width: 12 },
  ];
  estilarEncabezado(dr.getRow(1));
  dr.getColumn('pct').numFmt = '0.0%';
  for (const d of datos.desempeno) {
    dr.addRow({ resp: d.responsable, proc: d.numProcesos, at: d.aTiempo, pct: d.porcentaje ?? '' });
  }

  const tn = libro.addWorksheet('Tendencia');
  tn.columns = [
    { header: 'Año', key: 'anio', width: 8 },
    { header: 'Mes', key: 'mes', width: 8 },
    { header: 'Completadas', key: 'comp', width: 14 },
    { header: 'A tiempo', key: 'at', width: 12 },
    { header: '% a tiempo', key: 'pct', width: 12 },
  ];
  estilarEncabezado(tn.getRow(1));
  tn.getColumn('pct').numFmt = '0.0%';
  for (const t of datos.tendencia) {
    tn.addRow({
      anio: t.anio,
      mes: etiquetaMes(t.mes),
      comp: t.completadas,
      at: t.aTiempo,
      pct: t.porcentaje ?? '',
    });
  }

  const datosBuf = await libro.xlsx.writeBuffer();
  return { buffer: Buffer.from(datosBuf) };
}

/** Dependencias inyectables (tests). */
export interface DepsExcelCalidad {
  kpisCalidadMaquilero?: typeof kpisCalidadMaquilero;
}

/** Genera el `.xlsx` del tablero de calidad por maquilero. */
export async function excelKpisCalidad(
  sesion: SesionUsuario,
  parametros: ParametrosKpisCalidad = {},
  bd?: ContextoBd,
  deps: DepsExcelCalidad = {},
): Promise<{ buffer: Buffer }> {
  const obtener = deps.kpisCalidadMaquilero ?? kpisCalidadMaquilero;
  const datos = await obtener(sesion, parametros, bd);
  const libro = nuevoLibro();

  const mq = libro.addWorksheet('Maquileros');
  mq.columns = [
    { header: 'Maquilero', key: 'maq', width: 30 },
    { header: 'Auditorías', key: 'aud', width: 12 },
    { header: 'Aprobadas', key: 'apr', width: 12 },
    { header: 'Calificadas', key: 'cal', width: 12 },
    { header: '% aprobación', key: 'pct', width: 14 },
  ];
  estilarEncabezado(mq.getRow(1));
  mq.getColumn('pct').numFmt = '0.0%';
  for (const m of datos.maquileros) {
    mq.addRow({
      maq: m.maquilero,
      aud: m.numAuditorias,
      apr: m.aprobadas,
      cal: m.calificadas,
      pct: m.porcentaje ?? '',
    });
  }

  const df = libro.addWorksheet('Defectos');
  df.columns = [
    { header: 'Clave', key: 'clave', width: 16 },
    { header: 'Defecto', key: 'desc', width: 40 },
    { header: 'Fallas', key: 'fallas', width: 10 },
    { header: 'Auditorías', key: 'aud', width: 12 },
  ];
  estilarEncabezado(df.getRow(1));
  for (const d of datos.defectosTop) {
    df.addRow({ clave: d.clave, desc: d.descripcion, fallas: d.totalFallas, aud: d.numAuditorias });
  }

  const tn = libro.addWorksheet('Tendencia');
  tn.columns = [
    { header: 'Año', key: 'anio', width: 8 },
    { header: 'Mes', key: 'mes', width: 8 },
    { header: 'Auditorías', key: 'aud', width: 12 },
    { header: 'Aprobadas', key: 'apr', width: 12 },
    { header: '% aprobación', key: 'pct', width: 14 },
  ];
  estilarEncabezado(tn.getRow(1));
  tn.getColumn('pct').numFmt = '0.0%';
  for (const t of datos.tendencia) {
    tn.addRow({
      anio: t.anio,
      mes: etiquetaMes(t.mes),
      aud: t.numAuditorias,
      apr: t.aprobadas,
      pct: t.porcentaje ?? '',
    });
  }

  const datosBuf = await libro.xlsx.writeBuffer();
  return { buffer: Buffer.from(datosBuf) };
}

/** Dependencias inyectables (tests). */
export interface DepsExcelWip {
  kpisWip?: typeof kpisWip;
}

/** Genera el `.xlsx` del tablero WIP analítico. */
export async function excelKpisWip(
  sesion: SesionUsuario,
  parametros: ParametrosKpisWip = {},
  bd?: ContextoBd,
  deps: DepsExcelWip = {},
): Promise<{ buffer: Buffer }> {
  const obtener = deps.kpisWip ?? kpisWip;
  const datos = await obtener(sesion, { ...parametros, porPagina: 100 }, bd);
  const libro = nuevoLibro();
  const t = datos.totales;

  const resumen = libro.addWorksheet('Totales');
  resumen.addRow(['Etapa', 'Piezas']);
  estilarEncabezado(resumen.getRow(1));
  resumen.addRow(['Por cortar', t.porCortar]);
  resumen.addRow(['Cortado por enviar', t.cortadoPorEnviar]);
  resumen.addRow(['Por recibir', t.porRecibir]);
  resumen.addRow(['Por entregar', t.porEntregar]);
  resumen.getColumn(1).width = 22;
  resumen.getColumn(2).width = 12;

  const ord = libro.addWorksheet('Órdenes');
  ord.columns = [
    { header: 'Folio', key: 'folio', width: 10 },
    { header: 'Cliente', key: 'cliente', width: 28 },
    { header: 'Modelo', key: 'modelo', width: 16 },
    { header: 'Pedido', key: 'pedido', width: 10 },
    { header: 'Cortado', key: 'cortado', width: 10 },
    { header: 'Enviado', key: 'enviado', width: 10 },
    { header: 'Recibido', key: 'recibido', width: 10 },
    { header: 'Entregado', key: 'entregado', width: 11 },
    { header: 'Por recibir', key: 'porRecibir', width: 12 },
    { header: 'Por entregar', key: 'porEntregar', width: 13 },
  ];
  estilarEncabezado(ord.getRow(1));
  for (const o of datos.datos) {
    ord.addRow({
      folio: o.folio,
      cliente: o.cliente,
      modelo: o.codigoModelo,
      pedido: o.pedido,
      cortado: o.cortado,
      enviado: o.enviado,
      recibido: o.recibido,
      entregado: o.entregado,
      porRecibir: o.porRecibir,
      porEntregar: o.porEntregar,
    });
  }

  const datosBuf = await libro.xlsx.writeBuffer();
  return { buffer: Buffer.from(datosBuf) };
}
