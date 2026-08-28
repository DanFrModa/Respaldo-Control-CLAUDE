/**
 * Export a EXCEL del ESTADO DE CUENTA DESGLOSADO de un maquilero (F6-E5; ex botón `ParaCopiar` del
 * `EsMa_EdoDesglosado`, hoy `.xlsx` con `exceljs` — plan §1). MISMO resultado que el desglosado en
 * pantalla / PDF: reusa {@link estadoCuentaDesglosado} (A1: la lógica NO se duplica) y vuelca sus
 * filas a un libro con 4 hojas (Cargos, Movimientos, Prendas incompletas, Resumen). Genera un
 * BUFFER en el servidor (mismo patrón que `ruta-critica/impresos/excel-concentrado.ts`): la ruta
 * valida permiso + Zod, llama aquí y responde el binario. Los importes salen VACÍOS si el servicio los ocultó (sin `ver-importes`).
 */
import ExcelJS from 'exceljs';

import type { esquemaEstadoCuentaQuery, DesglosadoSalida } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';
import { ARGB_MARCA } from '../../../comun/impresos-estilos.js';
import { renderizarExcelEnWorker } from '../../../comun/pdf-worker.js';
import { estadoCuentaDesglosado } from '../estado-cuenta.js';
import type { z } from 'zod';

/** Dependencias inyectables (los tests inyectan un `estadoCuentaDesglosado` fake para no tocar BD). */
export interface DepsExcelEstadoCuenta {
  estadoCuentaDesglosado?: typeof estadoCuentaDesglosado;
}

/** Aplica el estilo de marca (negrita, texto blanco) a la fila de encabezado de una hoja. */
function estilarEncabezado(fila: ExcelJS.Row): void {
  fila.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  fila.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB_MARCA } };
  fila.alignment = { vertical: 'middle' };
}

/** Resultado del export: el buffer del `.xlsx` listo para responder. */
export interface ExcelEstadoCuenta {
  buffer: Buffer;
}

/**
 * Resuelve el estado de cuenta desglosado (A9: scope por empresa activa, ya lo impone
 * `estadoCuentaDesglosado`; `esma.ver-pagos` + ocultamiento de importes también). Corre en el HILO
 * PRINCIPAL.
 */
export async function armarDatosExcelEstadoCuenta(
  sesion: SesionUsuario,
  idMaquilero: number,
  query: z.input<typeof esquemaEstadoCuentaQuery> = {},
  bd?: ContextoBd,
  deps: DepsExcelEstadoCuenta = {},
): Promise<DesglosadoSalida> {
  const obtener = deps.estadoCuentaDesglosado ?? estadoCuentaDesglosado;
  return obtener(sesion, idMaquilero, query, bd);
}

/**
 * Construye el `.xlsx` (Cargos + Movimientos + Prendas incompletas + Resumen) de datos ya resueltos.
 * PURO: corre en el WORKER.
 */
export async function construirExcelEstadoCuenta(d: DesglosadoSalida): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'CONTROL v2';
  libro.created = new Date();

  // ── Hoja Cargos ──────────────────────────────────────────────────────────────
  const cargos = libro.addWorksheet('Cargos', { views: [{ state: 'frozen', ySplit: 1 }] });
  cargos.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Orden', key: 'orden', width: 10 },
    { header: 'Modelo', key: 'modelo', width: 30 },
    { header: 'Proceso', key: 'proceso', width: 18 },
    { header: 'Cantidad', key: 'cantidad', width: 12 },
    { header: 'Precio', key: 'precio', width: 12 },
    { header: 'Importe', key: 'importe', width: 14 },
    { header: 'Sin costo', key: 'sinCosto', width: 10 },
    { header: 'Facturación', key: 'factura', width: 12 },
  ];
  estilarEncabezado(cargos.getRow(1));
  for (const c of d.cargos) {
    cargos.addRow({
      fecha: c.fecha,
      orden: c.folioOrden,
      modelo: c.descripcionModelo ? `${c.codigoModelo} — ${c.descripcionModelo}` : c.codigoModelo,
      proceso: c.tipoProceso,
      cantidad: c.cantidad ?? '',
      precio: c.precio ?? '',
      importe: c.sinCosto ? 0 : (c.importe ?? ''),
      sinCosto: c.sinCosto ? 'Sí' : 'No',
      factura: c.conFactura === null ? '—' : c.conFactura ? 'Con' : 'Sin',
    });
  }

  // ── Hoja Movimientos (abonos/descuentos/pagos) ────────────────────────────────
  const movs = libro.addWorksheet('Movimientos', { views: [{ state: 'frozen', ySplit: 1 }] });
  movs.columns = [
    { header: 'Tipo', key: 'tipo', width: 12 },
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Referencia', key: 'ref', width: 40 },
    { header: 'Importe', key: 'importe', width: 14 },
    { header: 'Facturación', key: 'factura', width: 12 },
  ];
  estilarEncabezado(movs.getRow(1));
  const factura = (v: boolean | null): string => (v === null ? '—' : v ? 'Con' : 'Sin');
  for (const a of d.abonos) {
    movs.addRow({
      tipo: 'Abono',
      fecha: a.fecha,
      ref: a.observaciones ?? '',
      importe: a.monto ?? '',
      factura: factura(a.conFactura),
    });
  }
  for (const dsc of d.descuentos) {
    movs.addRow({
      tipo: 'Descuento',
      fecha: dsc.fecha,
      ref: dsc.observaciones ?? '',
      importe: dsc.monto ?? '',
      factura: factura(dsc.conFactura),
    });
  }
  for (const p of d.pagos) {
    const folios = [...new Set(p.aplicaciones.map((ap) => ap.folioOrden))]
      .sort((x, y) => x - y)
      .map((f) => `#${String(f)}`)
      .join(', ');
    movs.addRow({
      tipo: 'Pago',
      fecha: p.fecha,
      ref: folios || `Pago #${String(p.id)}`,
      importe: p.monto ?? '',
      factura: factura(p.conFactura),
    });
  }

  // ── Hoja Prendas incompletas (V1-E8k, §Post-F9.136) ───────────────────────────
  // Hoja PROPIA, no una columna más de "Cargos": las incompletas no llevan precio ni importe
  // (*"tampoco se pagan"*) y meterlas en la hoja del dinero invitaría a sumarlas. Se crea siempre
  // —aunque venga vacía— para que el archivo tenga la misma forma corrida tras corrida.
  const incompletas = libro.addWorksheet('Prendas incompletas', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  incompletas.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Recibo', key: 'recibo', width: 10 },
    { header: 'Orden', key: 'orden', width: 10 },
    { header: 'Modelo', key: 'modelo', width: 30 },
    { header: 'Proceso', key: 'proceso', width: 18 },
    { header: 'Piezas', key: 'piezas', width: 12 },
  ];
  estilarEncabezado(incompletas.getRow(1));
  for (const f of d.incompletas.filas) {
    incompletas.addRow({
      fecha: f.fecha,
      recibo: f.folioRecibo,
      orden: f.folioOrden,
      modelo: f.descripcionModelo ? `${f.codigoModelo} — ${f.descripcionModelo}` : f.codigoModelo,
      proceso: f.tipoProceso,
      piezas: f.piezas,
    });
  }

  // ── Hoja Resumen (saldo derivado) ─────────────────────────────────────────────
  const resumen = libro.addWorksheet('Resumen');
  resumen.columns = [
    { header: 'Concepto', key: 'concepto', width: 20 },
    { header: 'Valor', key: 'valor', width: 20 },
  ];
  estilarEncabezado(resumen.getRow(1));
  resumen.addRow({ concepto: 'Maquilero', valor: d.maquilero });
  resumen.addRow({ concepto: 'Periodo', valor: `${d.desde ?? '—'} a ${d.hasta ?? '—'}` });
  resumen.addRow({ concepto: 'Total cargos', valor: d.saldo.totalCargos ?? '' });
  resumen.addRow({ concepto: 'Total abonos', valor: d.saldo.totalAbonos ?? '' });
  resumen.addRow({ concepto: 'Total pagos', valor: d.saldo.totalPagos ?? '' });
  resumen.addRow({ concepto: 'Total descuentos', valor: d.saldo.totalDescuentos ?? '' });
  const filaSaldo = resumen.addRow({ concepto: 'Saldo', valor: d.saldo.saldo ?? '' });
  filaSaldo.font = { bold: true };
  // DESPUÉS del saldo y sin negrita: es información, no un renglón de la cuenta (§Post-F9.136).
  resumen.addRow({
    concepto: 'Prendas incompletas',
    valor: d.incompletas.totalPiezas,
  });

  const buffer = await libro.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Genera el `.xlsx` del estado de cuenta desglosado. Datos en el hilo principal, libro en un worker
 * (blindaje del event loop).
 */
export async function excelEstadoCuenta(
  sesion: SesionUsuario,
  idMaquilero: number,
  query: z.input<typeof esquemaEstadoCuentaQuery> = {},
  bd?: ContextoBd,
  deps: DepsExcelEstadoCuenta = {},
): Promise<ExcelEstadoCuenta> {
  const datos = await armarDatosExcelEstadoCuenta(sesion, idMaquilero, query, bd, deps);
  return { buffer: await renderizarExcelEnWorker('excel-esma-estado-cuenta', datos) };
}
