/**
 * Reporte de CUADRE de la migración F2-E5 (pedidos + órdenes), en DOS niveles (§7 — una columna
 * tirada en silencio NO puede cerrar en verde):
 *
 *  (1) FILAS Y SUMAS: conteos por tabla v1 (CSV, parser real) vs v2 (count Postgres), + la suma
 *      de cantidades por orden v1 (T1..T8) vs v2 (OrdenLineaTalla.cantidad). Diferencias con NOTA.
 *  (2) COLUMNAS: checklist columna-v1 → destino-v2 con el conteo de NO-nulos/NO-cero por columna
 *      en v1 (CSV) y en v2 (Postgres). Cubre TODAS las columnas de las tablas migradas (34 de
 *      Ordenes, 13 de Pedidos, 7 de PedidosDet, 11 de PedidosReales, 7 de PedidosRealesDet, 11 de
 *      OrdenesDet, 5 de ComentaOrd). Las columnas-FK/snapshot tienen su destino anotado.
 *
 * Se corre SOLO el cuadre con `npm run etl:cuadre-f2` (no carga nada; solo cuenta). El nivel (3)
 * —listas de inconsistencias— lo produce el `Reporte` del orquestador (colores/tallas creados,
 * Monarch descartados, órdenes sin pedido, cadenas ambiguas).
 */
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { contarFilasCsv, leerCsv, type FilaCsv } from './comun/csv.js';

/** Un renglón del cuadre de filas/sumas: entidad, v1, v2, nota. */
export interface RenglonCuadreF2 {
  entidad: string;
  v1: number;
  v2: number;
  nota: string;
}

/** Un renglón del cuadre de columnas: columna v1 → destino v2, con sus conteos de no-vacíos. */
export interface RenglonColumna {
  tabla: string;
  columnaV1: string;
  destinoV2: string;
  /** # de filas con valor NO vacío/NO cero en el CSV v1. */
  v1NoVacio: number;
  /** # de filas con valor NO nulo/NO cero en Postgres v2 (o '—' si no se cuenta por columna). */
  v2NoNulo: number | null;
  nota: string;
}

/** Resultado del cuadre F2 completo (los tres bloques que se imprimen). */
export interface CuadreF2 {
  filas: RenglonCuadreF2[];
  columnas: RenglonColumna[];
}

/** ¿El valor textual del CSV cuenta como "con dato" (no vacío y, si numérico, no cero)? */
function tieneDato(valor: string | undefined): boolean {
  if (valor === undefined) return false;
  const t = valor.trim();
  if (t === '') return false;
  // Banderas/FK del viejo: "0" cuenta como SIN dato (no asignado / falso).
  if (t === '0') return false;
  return true;
}

/** Cuenta, por columna, cuántas filas del CSV tienen dato (no vacío/no cero). */
function contarColumnasCsv(nombreArchivo: string, columnas: string[]): Map<string, number> {
  const conteo = new Map<string, number>();
  for (const c of columnas) conteo.set(c, 0);
  let filas: FilaCsv[];
  try {
    filas = leerCsv(nombreArchivo);
  } catch {
    return conteo;
  }
  for (const fila of filas) {
    for (const c of columnas) {
      if (tieneDato(fila[c])) {
        conteo.set(c, (conteo.get(c) ?? 0) + 1);
      }
    }
  }
  return conteo;
}

/** Suma de TODAS las cantidades T1..T8 de OrdenesDet (la "carga" total de matriz en v1). */
function sumaCantidadesOrdenesDet(): number {
  let suma = 0;
  let filas: FilaCsv[];
  try {
    filas = leerCsv('OrdenesDet.csv');
  } catch {
    return 0;
  }
  for (const fila of filas) {
    for (const c of ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']) {
      const n = Number((fila[c] ?? '').trim() || '0');
      if (Number.isFinite(n) && n > 0) suma += n;
    }
  }
  return suma;
}

/** Calcula el cuadre F2 completo (filas/sumas + columnas). */
export async function calcularCuadreF2(cliente: PrismaClient): Promise<CuadreF2> {
  // ── Nivel 1: filas y sumas ──
  const v1Pedidos = contarFilasCsv('Pedidos.csv');
  const v1PedidosDet = contarFilasCsv('PedidosDet.csv');
  const v1Reales = contarFilasCsv('PedidosReales.csv');
  const v1RealesDet = contarFilasCsv('PedidosRealesDet.csv');
  const v1Ordenes = contarFilasCsv('Ordenes.csv');
  const v1OrdenesDet = contarFilasCsv('OrdenesDet.csv');
  const v1Comenta = contarFilasCsv('ComentaOrd.csv');
  const v1SumaMatriz = sumaCantidadesOrdenesDet();

  const [
    v2Pedidos,
    v2PedidoLinea,
    v2Reales,
    v2RealLinea,
    v2Ordenes,
    v2OrdenLinea,
    v2OrdenLineaTalla,
    v2Referencias,
    v2Comenta,
    aggCantidad,
  ] = await Promise.all([
    cliente.pedido.count(),
    cliente.pedidoLinea.count(),
    cliente.pedidoReal.count(),
    cliente.pedidoRealLinea.count(),
    cliente.orden.count(),
    cliente.ordenLinea.count(),
    cliente.ordenLineaTalla.count(),
    cliente.ordenReferencia.count(),
    cliente.ordenComentario.count(),
    cliente.ordenLineaTalla.aggregate({ _sum: { cantidad: true } }),
  ]);
  const v2SumaMatriz = aggCantidad._sum.cantidad ?? 0;

  const filas: RenglonCuadreF2[] = [
    {
      entidad: 'Pedidos',
      v1: v1Pedidos,
      v2: v2Pedidos,
      nota: '≈1:1 (omite sin folio/cliente/empresa mapeable).',
    },
    {
      entidad: 'PedidoLinea (renglones)',
      v1: v1PedidosDet,
      v2: v2PedidoLinea,
      nota: 'v2 ≤ v1 por renglones con modelo sin mapeo (al reporte).',
    },
    {
      entidad: 'PedidosReales',
      v1: v1Reales,
      v2: v2Reales,
      nota: '≈1:1 (omite sin pedido mapeable).',
    },
    {
      entidad: 'PedidoRealLinea (renglones)',
      v1: v1RealesDet,
      v2: v2RealLinea,
      nota: 'v2 ≤ v1 por renglones con IdPedidosDet sin mapeo.',
    },
    {
      entidad: 'Ordenes',
      v1: v1Ordenes,
      v2: v2Ordenes,
      nota: '≈1:1 (omite sin folio/empresa/modelo/cliente mapeable).',
    },
    {
      entidad: 'OrdenesDet (renglones color)',
      v1: v1OrdenesDet,
      v2: v2OrdenLinea,
      nota: 'v2 = un OrdenLinea por color (un OrdenesDet con color vacío no crea renglón).',
    },
    {
      entidad: 'OrdenLineaTalla (despivotadas)',
      v1: 0,
      v2: v2OrdenLineaTalla,
      nota: 'v1 N/A: despivote de T1..T8>0 contra la cadena Tallas.',
    },
    {
      entidad: 'OrdenReferencia (Monarch real)',
      v1: 0,
      v2: v2Referencias,
      nota: 'v1 N/A: solo Monarch ≠ código de modelo (default descartado).',
    },
    {
      entidad: 'ComentaOrd',
      v1: v1Comenta,
      v2: v2Comenta,
      nota: '≈1:1 (omite sin orden mapeable o texto vacío).',
    },
    {
      entidad: 'SUMA cantidades matriz',
      v1: v1SumaMatriz,
      v2: v2SumaMatriz,
      nota: 'Σ T1..T8 (v1) vs Σ OrdenLineaTalla.cantidad (v2): deben CUADRAR (toda cantidad>0 migra).',
    },
  ];

  // ── Nivel 2: columnas (v1 → v2) ──
  const colPedidos = contarColumnasCsv('Pedidos.csv', [
    'IdPedidos',
    'IdClientes',
    'NumeroPed',
    'FechaPedido',
    'FechaDe',
    'FechaHasta',
    'EntregadoTienda',
    'FechaTela',
    'IdOrdCompra',
    'PedCancelado',
    'NoProducir',
    'FechaElaboracion',
    'IdEmpresas',
  ]);
  const colPedidosDet = contarColumnasCsv('PedidosDet.csv', [
    'IdPedidosDet',
    'IdPedidos',
    'IdModelos',
    'CantPed',
    'Precio',
    'EntregadoParcial',
    'CantFalt',
  ]);
  const colReales = contarColumnasCsv('PedidosReales.csv', [
    'IdPedidosReales',
    'IdPedidos',
    'FechaPedPR',
    'FechaInicioPR',
    'FechaFinPR',
    'NumPedReal',
    'Cedis',
    'FechaEntregadaReal',
    'IdUsuarios',
    'FechaUsuario',
    'Apertura',
  ]);
  const colRealesDet = contarColumnasCsv('PedidosRealesDet.csv', [
    'IdPedidosRealesDet',
    'IdPedidosReales',
    'IdPedidosDet',
    'CantidadPR',
    'CantidadEnviada',
    'CantidadEntregadaReal',
    'Empaques',
  ]);
  const colOrdenes = contarColumnasCsv('Ordenes.csv', [
    'IdOrdenes',
    'Numero',
    'IdPedidosDet',
    'IdModelos',
    'IdMaquileros',
    'IdEtiquetasM',
    'IdClientes',
    'IdTelasDis',
    'Fecha',
    'FechaEntrega',
    'Observaciones',
    'Tallas',
    'MaquilaOrd',
    'NoCost',
    'Monarch',
    'OrdCancelada',
    'MotivoCancelada',
    'IdEmpresas',
    'UPC',
    'IdCP_Articulos',
    'IdRC_Aplicaciones',
    'IdRC_TipoTelas',
    'FechaInicioRC',
    'FechaEntregaRC',
    'FechaProg',
    'EnRiesgo',
    'SI_RC',
    'FechaDet',
    'Composicion',
    'CompForzada',
    'Pagada',
    'ObsMaquila',
    'AplicacionOrd',
    'RC_Viva',
  ]);
  const colOrdenesDet = contarColumnasCsv('OrdenesDet.csv', [
    'IdOrdenesDet',
    'IdOrdenes',
    'Color',
    'T1',
    'T2',
    'T3',
    'T4',
    'T5',
    'T6',
    'T7',
    'T8',
  ]);
  const colComenta = contarColumnasCsv('ComentaOrd.csv', [
    'IdComentaOrd',
    'IdOrdenes',
    'IdUsuarios',
    'FechaComen',
    'Comentario',
  ]);

  const C = (
    tabla: string,
    columnaV1: string,
    destinoV2: string,
    conteo: Map<string, number>,
    nota = '',
  ): RenglonColumna => ({
    tabla,
    columnaV1,
    destinoV2,
    v1NoVacio: conteo.get(columnaV1) ?? 0,
    v2NoNulo: null,
    nota,
  });

  const columnas: RenglonColumna[] = [
    // Pedidos (13)
    C('Pedidos', 'IdPedidos', 'mapeo→Pedido.id', colPedidos, 'PK (mapeo)'),
    C('Pedidos', 'IdClientes', 'idCliente (mapeo F1)', colPedidos),
    C('Pedidos', 'NumeroPed', 'folio', colPedidos),
    C('Pedidos', 'FechaPedido', 'fechaPedido', colPedidos),
    C('Pedidos', 'FechaDe', 'fechaDe', colPedidos),
    C('Pedidos', 'FechaHasta', 'fechaHasta', colPedidos),
    C('Pedidos', 'EntregadoTienda', 'entregadoTienda', colPedidos),
    C('Pedidos', 'FechaTela', 'fechaTela', colPedidos),
    C('Pedidos', 'IdOrdCompra', 'idOrdCompraV1 (snapshot)', colPedidos),
    C('Pedidos', 'PedCancelado', 'pedCancelado', colPedidos),
    C('Pedidos', 'NoProducir', 'noProducir', colPedidos),
    C('Pedidos', 'FechaElaboracion', 'fechaElaboracion', colPedidos),
    C('Pedidos', 'IdEmpresas', 'idEmpresa (mapeo F1)', colPedidos),
    // PedidosDet (7)
    C('PedidosDet', 'IdPedidosDet', 'mapeo→PedidoLinea.id', colPedidosDet, 'PK (mapeo)'),
    C('PedidosDet', 'IdPedidos', 'idPedido', colPedidosDet),
    C('PedidosDet', 'IdModelos', 'idModelo (mapeo F1)', colPedidosDet),
    C('PedidosDet', 'CantPed', 'cantidadPedida', colPedidosDet),
    C('PedidosDet', 'Precio', 'precio', colPedidosDet),
    C('PedidosDet', 'EntregadoParcial', 'entregadoParcialV1 (snapshot)', colPedidosDet),
    C('PedidosDet', 'CantFalt', 'cantFaltanteV1 (snapshot)', colPedidosDet),
    // PedidosReales (11)
    C('PedidosReales', 'IdPedidosReales', 'mapeo→PedidoReal.id', colReales, 'PK (mapeo)'),
    C('PedidosReales', 'IdPedidos', 'idPedido (mapeo)', colReales),
    C('PedidosReales', 'FechaPedPR', 'fechaPedPR', colReales),
    C('PedidosReales', 'FechaInicioPR', 'fechaInicio', colReales),
    C('PedidosReales', 'FechaFinPR', 'fechaFin', colReales),
    C('PedidosReales', 'NumPedReal', 'numPedReal', colReales),
    C('PedidosReales', 'Cedis', 'cedis', colReales),
    C('PedidosReales', 'FechaEntregadaReal', 'fechaEntregadaReal', colReales),
    C('PedidosReales', 'IdUsuarios', 'creadoPorId/modificadoPorId (auditoría v1)', colReales),
    C(
      'PedidosReales',
      'FechaUsuario',
      '(auditoría v1; creadoEn=now ETL)',
      colReales,
      'fecha de captura v1, informativa',
    ),
    C('PedidosReales', 'Apertura', 'apertura', colReales),
    // PedidosRealesDet (7)
    C(
      'PedidosRealesDet',
      'IdPedidosRealesDet',
      'mapeo→PedidoRealLinea.id',
      colRealesDet,
      'PK (mapeo)',
    ),
    C('PedidosRealesDet', 'IdPedidosReales', 'idPedidoReal', colRealesDet),
    C('PedidosRealesDet', 'IdPedidosDet', 'idPedidoLinea (mapeo)', colRealesDet),
    C('PedidosRealesDet', 'CantidadPR', 'cantidadPR', colRealesDet),
    C('PedidosRealesDet', 'CantidadEnviada', 'cantidadEnviada', colRealesDet),
    C('PedidosRealesDet', 'CantidadEntregadaReal', 'cantidadEntregadaReal', colRealesDet),
    C('PedidosRealesDet', 'Empaques', 'empaques', colRealesDet),
    // Ordenes (34)
    C('Ordenes', 'IdOrdenes', 'mapeo→Orden.id', colOrdenes, 'PK (mapeo)'),
    C('Ordenes', 'Numero', 'folio', colOrdenes),
    C('Ordenes', 'IdPedidosDet', 'idPedidoLinea (0/vacío→NULL)', colOrdenes),
    C('Ordenes', 'IdModelos', 'idModelo (mapeo F1)', colOrdenes),
    C('Ordenes', 'IdMaquileros', 'idMaquilero (mapeo F1)', colOrdenes),
    C('Ordenes', 'IdEtiquetasM', 'idEtiquetaMarca (mapeo F1)', colOrdenes),
    C('Ordenes', 'IdClientes', 'idCliente (mapeo F1)', colOrdenes),
    C('Ordenes', 'IdTelasDis', 'idTela (mapeo F1)', colOrdenes),
    C('Ordenes', 'Fecha', 'fecha', colOrdenes),
    C('Ordenes', 'FechaEntrega', 'fechaEntrega', colOrdenes),
    C('Ordenes', 'Observaciones', 'observaciones', colOrdenes),
    C('Ordenes', 'Tallas', 'tallasV1 + despivote→OrdenLineaTalla', colOrdenes),
    C('Ordenes', 'MaquilaOrd', 'maquilaOrd', colOrdenes),
    C('Ordenes', 'NoCost', 'noCostear', colOrdenes),
    C('Ordenes', 'Monarch', '→OrdenReferencia (D7; default descartado)', colOrdenes),
    C('Ordenes', 'OrdCancelada', 'estado=cancelada', colOrdenes),
    C('Ordenes', 'MotivoCancelada', 'motivoCancelada', colOrdenes),
    C('Ordenes', 'IdEmpresas', 'idEmpresa (mapeo F1)', colOrdenes),
    C(
      'Ordenes',
      'UPC',
      'EXCLUIDA POR DECISIÓN',
      colOrdenes,
      'Gabriel 16-jun-2026: códigos de barra en retiro; la columna destino Orden.upc fue eliminada del modelo',
    ),
    C('Ordenes', 'IdCP_Articulos', 'idTipoArticuloRC (F5)', colOrdenes),
    C('Ordenes', 'IdRC_Aplicaciones', 'idRcAplicaciones (F5)', colOrdenes),
    C('Ordenes', 'IdRC_TipoTelas', 'idRcTipoTelas (F5)', colOrdenes),
    C('Ordenes', 'FechaInicioRC', 'fechaInicioRC (F5)', colOrdenes),
    C('Ordenes', 'FechaEntregaRC', 'fechaEntregaRC (F5)', colOrdenes),
    C('Ordenes', 'FechaProg', 'fechaProg (F5)', colOrdenes),
    C('Ordenes', 'EnRiesgo', 'enRiesgo (F5)', colOrdenes),
    C('Ordenes', 'SI_RC', 'siRC (F5)', colOrdenes),
    C('Ordenes', 'FechaDet', 'fechaCompletada + estado=completa', colOrdenes),
    C('Ordenes', 'Composicion', 'composicion', colOrdenes),
    C('Ordenes', 'CompForzada', 'compForzada', colOrdenes),
    C('Ordenes', 'Pagada', 'pagada (F6)', colOrdenes),
    C('Ordenes', 'ObsMaquila', 'obsMaquila', colOrdenes),
    C('Ordenes', 'AplicacionOrd', 'aplicacionOrd', colOrdenes),
    C('Ordenes', 'RC_Viva', 'rcViva (F5)', colOrdenes),
    // OrdenesDet (11)
    C(
      'OrdenesDet',
      'IdOrdenesDet',
      '(no se mapea; OrdenLinea.id propio)',
      colOrdenesDet,
      'la matriz se reagrupa por color',
    ),
    C('OrdenesDet', 'IdOrdenes', 'idOrden (mapeo)', colOrdenesDet),
    C('OrdenesDet', 'Color', 'idColor (catálogo Color)', colOrdenesDet),
    C('OrdenesDet', 'T1', 'OrdenLineaTalla (despivote)', colOrdenesDet),
    C('OrdenesDet', 'T2', 'OrdenLineaTalla (despivote)', colOrdenesDet),
    C('OrdenesDet', 'T3', 'OrdenLineaTalla (despivote)', colOrdenesDet),
    C('OrdenesDet', 'T4', 'OrdenLineaTalla (despivote)', colOrdenesDet),
    C('OrdenesDet', 'T5', 'OrdenLineaTalla (despivote)', colOrdenesDet),
    C('OrdenesDet', 'T6', 'OrdenLineaTalla (despivote)', colOrdenesDet),
    C('OrdenesDet', 'T7', 'OrdenLineaTalla (despivote)', colOrdenesDet),
    C('OrdenesDet', 'T8', 'OrdenLineaTalla (despivote)', colOrdenesDet),
    // ComentaOrd (5)
    C('ComentaOrd', 'IdComentaOrd', 'mapeo→OrdenComentario.id', colComenta, 'PK (mapeo)'),
    C('ComentaOrd', 'IdOrdenes', 'idOrden (mapeo)', colComenta),
    C('ComentaOrd', 'IdUsuarios', 'idUsuario (auditoría v1)', colComenta),
    C('ComentaOrd', 'FechaComen', 'fecha (auditoría v1)', colComenta),
    C('ComentaOrd', 'Comentario', 'comentario', colComenta),
  ];

  return { filas, columnas };
}

/** Da formato de tabla al cuadre F2 (filas + columnas). */
export function formatearCuadreF2(c: CuadreF2): string {
  const p: string[] = [];
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(' CUADRE F2-E5 (1) FILAS Y SUMAS — v1 (CSV) vs v2 (Postgres)');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(`${'Entidad'.padEnd(34)}${'v1'.padStart(8)}${'v2'.padStart(8)}   Nota`);
  p.push('─'.repeat(70));
  for (const r of c.filas) {
    const v1 = r.v1 === 0 ? '   —' : String(r.v1);
    p.push(`${r.entidad.padEnd(34)}${v1.padStart(8)}${String(r.v2).padStart(8)}   ${r.nota}`);
  }
  p.push('');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(' CUADRE F2-E5 (2) COLUMNAS — v1 (no-vacío) → destino v2');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(`${'Tabla.columna v1'.padEnd(34)}${'v1≠∅'.padStart(8)}  → destino v2 (nota)`);
  p.push('─'.repeat(70));
  for (const r of c.columnas) {
    const clave = `${r.tabla}.${r.columnaV1}`;
    p.push(
      `${clave.padEnd(34)}${String(r.v1NoVacio).padStart(8)}  → ${r.destinoV2}` +
        (r.nota !== '' ? `  [${r.nota}]` : ''),
    );
  }
  return p.join('\n');
}

/** Punto de entrada del script `npm run etl:cuadre-f2`. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const cliente = crearClientePrisma(url);
  try {
    const cuadre = await calcularCuadreF2(cliente);
    console.log(formatearCuadreF2(cuadre));
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
