/**
 * Reporte de CUADRE de F9 (Finanzas) — F9-E6, patrón de `cuadre-f6.ts`/`cuadre-f7.ts` (§7: un dato
 * tirado en silencio NO cierra en verde). Compara, por tercero:
 *
 *   • SALDO ESPERADO del corte de SINUBE/contador — de la MISMA fuente que carga el ETL: la suma de
 *     las aperturas del CSV (con su signo por origen, `signoDeOrigen`) o, si el corte trae la columna
 *     `saldoEsperado`, ESE valor declarado (tiene prioridad — es la cifra que dio el contador).
 *   • SALDO v2 de las APERTURAS cargadas: Σ monto de los movimientos que el ETL creó (los que están en
 *     `MapeoMigracion` bajo `AperturaTercero`) — se aísla del resto del libro para medir SOLO lo que
 *     este ETL sembró. `saldo = Σ monto` (D3), nunca una columna.
 *
 * Las diferencias se LISTAN a incidencia; NUNCA se fuerzan (§7). Solo LECTURA. Reusa la resolución de
 * terceros del loader (RFC/nombre → id) para correlacionar el CSV con la BD sin duplicar lógica.
 *
 * Correr aparte con: npx tsx --env-file=.env migracion/cuadre-f9.ts -- --archivo=saldos.csv
 */
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { opcionesClienteEtl } from './comun/cliente-etl.js';
import { signoDeOrigen } from '../src/dominio/terceros/origen-tercero.js';
import type { TipoTercero } from '../src/datos/index.js';

import { cargarMapaNumerico, ENTIDAD_MAPEO } from './comun/mapeo.js';
import {
  indiceTerceros,
  leerArchivoAperturas,
  resolverTercero,
  type IndiceTerceros,
  type OpcionesParseo,
} from './loaders/terceros-saldos.js';

/** Redondeo monetario a 2 decimales. */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Un renglón del cuadre por tercero. */
export interface RenglonCuadreF9 {
  tipoTercero: TipoTercero;
  idTercero: number;
  nombre: string;
  /** Esperado del corte (declarado `saldoEsperado`, o Σ de las aperturas del CSV). */
  esperado: number;
  /** Σ monto de las aperturas cargadas en v2. */
  v2: number;
  /** ¿Se usó el `saldoEsperado` declarado (true) o la suma de renglones (false)? */
  declarado: boolean;
  /** ¿Cuadra (|esperado − v2| ≤ 1 centavo)? */
  cuadra: boolean;
}

/** Resultado completo del cuadre F9. */
export interface CuadreF9 {
  /** Renglones comparados (unión de terceros del CSV y de las aperturas v2). */
  renglones: RenglonCuadreF9[];
  comparados: number;
  cuadran: number;
  descuadran: number;
  totalEsperado: number;
  totalV2: number;
  /** # de renglones del CSV que NO se pudieron resolver a un tercero (fuera del comparado). */
  filasSinResolver: number;
  /** # de aperturas cargadas en v2 (Σ de movimientos en el mapeo). */
  aperturasCargadas: number;
}

/** Acumulado del esperado de un tercero (desde el CSV). */
interface EsperadoTercero {
  idTercero: number;
  nombre: string;
  suma: number;
  declarado: number | null;
}

/** Fila del agregado v2 por tercero. */
interface FilaV2Tercero {
  tipoTercero: TipoTercero;
  idCliente: number | null;
  idProveedor: number | null;
  monto: { toNumber(): number };
}

/**
 * Calcula el cuadre F9 comparando el corte del CSV con las aperturas cargadas. Requiere el archivo del
 * corte (para el esperado); v2 sale de la BD (los movimientos en `MapeoMigracion.AperturaTercero`).
 */
export async function calcularCuadreF9(
  cliente: PrismaClient,
  archivo: string,
  opciones: OpcionesParseo & { encoding?: string } = {},
): Promise<CuadreF9> {
  const { filas } = leerArchivoAperturas(archivo, opciones);
  const indices: Record<TipoTercero, IndiceTerceros> = {
    cliente: await indiceTerceros(cliente, 'cliente'),
    proveedor: await indiceTerceros(cliente, 'proveedor'),
  };

  // Esperado del CSV, por (tipo:id). Prioriza `saldoEsperado`; si no, suma los renglones con su signo.
  const esperado = new Map<string, EsperadoTercero & { tipoTercero: TipoTercero }>();
  let filasSinResolver = 0;
  for (const f of filas) {
    const { tercero } = resolverTercero(indices[f.tipoTercero], f.rfc, f.nombre);
    if (tercero === null) {
      filasSinResolver += 1;
      continue;
    }
    const key = `${f.tipoTercero}:${String(tercero.idTercero)}`;
    const previo = esperado.get(key) ?? {
      tipoTercero: f.tipoTercero,
      idTercero: tercero.idTercero,
      nombre: tercero.nombre,
      suma: 0,
      declarado: null,
    };
    previo.suma += signoDeOrigen(f.movimiento.origen) * f.movimiento.importe;
    if (f.saldoEsperado !== null) previo.declarado = f.saldoEsperado;
    esperado.set(key, previo);
  }

  // v2: Σ monto de las aperturas cargadas (movimientos en el mapeo `AperturaTercero`), por tercero.
  const idsApertura = [
    ...(await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.aperturaTercero)).values(),
  ];
  const v2 = new Map<string, number>();
  let aperturasCargadas = 0;
  if (idsApertura.length > 0) {
    const movs = (await cliente.movimientoTercero.findMany({
      where: { id: { in: idsApertura } },
      select: { tipoTercero: true, idCliente: true, idProveedor: true, monto: true },
    })) as FilaV2Tercero[];
    aperturasCargadas = movs.length;
    for (const m of movs) {
      const idTercero = m.idCliente ?? m.idProveedor ?? 0;
      const key = `${m.tipoTercero}:${String(idTercero)}`;
      v2.set(key, (v2.get(key) ?? 0) + m.monto.toNumber());
    }
  }

  // Compara sobre la unión de terceros.
  const keys = new Set<string>([...esperado.keys(), ...v2.keys()]);
  const renglones: RenglonCuadreF9[] = [];
  let cuadran = 0;
  let totalEsperado = 0;
  let totalV2 = 0;
  for (const key of [...keys].sort()) {
    const esp = esperado.get(key);
    const usaDeclarado = esp?.declarado !== null && esp?.declarado !== undefined;
    const esperadoVal = redondear2(usaDeclarado ? (esp?.declarado ?? 0) : (esp?.suma ?? 0));
    const v2Val = redondear2(v2.get(key) ?? 0);
    const cuadra = Math.abs(esperadoVal - v2Val) <= 0.01;
    if (cuadra) cuadran += 1;
    totalEsperado += esperadoVal;
    totalV2 += v2Val;
    const [tipo, idStr] = key.split(':');
    renglones.push({
      tipoTercero: tipo as TipoTercero,
      idTercero: Number(idStr),
      nombre: esp?.nombre ?? '(sin datos del CSV)',
      esperado: esperadoVal,
      v2: v2Val,
      declarado: usaDeclarado,
      cuadra,
    });
  }

  return {
    renglones,
    comparados: keys.size,
    cuadran,
    descuadran: keys.size - cuadran,
    totalEsperado: redondear2(totalEsperado),
    totalV2: redondear2(totalV2),
    filasSinResolver,
    aperturasCargadas,
  };
}

/** Da formato de texto al cuadre F9. */
export function formatearCuadreF9(c: CuadreF9): string {
  const p: string[] = [];
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(' CUADRE F9 (FINANZAS) — corte de terceros (CSV) vs aperturas v2');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(`  Terceros comparados     : ${String(c.comparados)}`);
  p.push(`  Cuadran (≤ 1 centavo)   : ${String(c.cuadran)}`);
  p.push(`  Descuadran              : ${String(c.descuadran)}`);
  p.push(`  Total esperado (corte)  : ${c.totalEsperado.toFixed(2)}`);
  p.push(`  Total v2 (aperturas)    : ${c.totalV2.toFixed(2)}`);
  p.push(`  Diferencia (v2 − corte) : ${(c.totalV2 - c.totalEsperado).toFixed(2)}`);
  p.push(`  Aperturas cargadas (mov): ${String(c.aperturasCargadas)}`);
  p.push(`  Renglones del CSV sin resolver a un tercero: ${String(c.filasSinResolver)}`);
  const descuadres = c.renglones.filter((r) => !r.cuadra);
  if (descuadres.length > 0) {
    p.push('');
    p.push('── DESCUADRES (NO se fuerzan, §7; a revisar con el contador) ──');
    for (const r of descuadres.slice(0, 40)) {
      p.push(
        `  ${r.tipoTercero.padEnd(9)} #${String(r.idTercero).padStart(5)} "${r.nombre}" ` +
          `esperado=${r.esperado.toFixed(2)} v2=${r.v2.toFixed(2)} dif=${(r.v2 - r.esperado).toFixed(2)}` +
          (r.declarado ? ' [saldoEsperado declarado]' : ''),
      );
    }
    if (descuadres.length > 40) p.push(`  … y ${String(descuadres.length - 40)} más.`);
  }
  return p.join('\n');
}

/** Lee un flag `--clave=valor` de argv (o null). */
function flag(clave: string): string | null {
  const pref = `--${clave}=`;
  const arg = process.argv.find((a) => a.startsWith(pref));
  return arg === undefined ? null : arg.slice(pref.length);
}

/** Punto de entrada del script `cuadre-f9.ts` (solo lee/cuenta). */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const archivo = flag('archivo');
  if (archivo === null) {
    console.error('Falta --archivo=<ruta.csv> (el mismo corte que carga el ETL).');
    process.exit(1);
  }
  const corteStr = flag('corte');
  const encoding = flag('encoding');
  const opciones: OpcionesParseo & { encoding?: string } = {};
  if (corteStr !== null) opciones.corte = new Date(`${corteStr}T00:00:00.000Z`);
  if (encoding !== null) opciones.encoding = encoding;
  const cliente = crearClientePrisma(url, opcionesClienteEtl());
  try {
    console.log(formatearCuadreF9(await calcularCuadreF9(cliente, archivo, opciones)));
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
