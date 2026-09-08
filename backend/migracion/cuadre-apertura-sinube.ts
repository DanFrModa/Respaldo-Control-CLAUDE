/**
 * Reporte de CUADRE de la carga de apertura desde SINUBE (fila 0.131, §Post-F9.224) — patrón de
 * `cuadre-f9.ts` (§7: un dato tirado en silencio NO cierra en verde).
 *
 * Es la hoja que Daniel compara **contra su archivo de SINUBE**: cuántos renglones traía, cuántos se
 * cargaron, **cuántos se descartaron y por qué**, y **la suma de saldos cargada**. Contra la base
 * mide, además, lo que la carga dejó de verdad: cuántos movimientos existen por cada UUID del
 * archivo, su Σ monto y —la comprobación que justifica la guarda de los días de crédito— **cuántos
 * cargos quedaron SIN fecha de vencimiento** (tiene que ser 0; si no, la pantalla de antigüedad se
 * quedaría muda para ese proveedor).
 *
 * Sólo LEE. Correr aparte con:
 *   npx tsx --env-file=.env migracion/cuadre-apertura-sinube.ts -- --archivo=sinube.xlsx
 */
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import {
  ErrorListadoSinube,
  clasificarSinube,
  leerArchivoSinube,
  type ClasificacionSinube,
} from './loaders/sinube-apertura.js';

/** Redondeo monetario a 2 decimales. */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Lo que la base tiene de un proveedor tras la carga. */
export interface RenglonCuadreApertura {
  idProveedor: number;
  nombre: string;
  /** Movimientos de apertura encontrados en la base para los UUID de este proveedor. */
  movimientos: number;
  /** Σ |monto| (la cifra comparable con la columna `Saldo` del archivo). */
  sumaAbsoluta: number;
  /** Σ monto con su signo (cargos − notas de crédito) = lo que mueve el saldo. */
  neto: number;
  /** Cargos sin `fechaVencimiento`: DEBE ser 0 (si no, no hay antigüedad que enseñar). */
  cargosSinVencimiento: number;
}

/** Resultado del cuadre. */
export interface CuadreApertura {
  clasificacion: ClasificacionSinube;
  /** UUID del archivo que SÍ están en la base (cargados por ésta o por otra corrida). */
  encontrados: number;
  /** UUID del archivo que deberían estar y NO están (0 tras una corrida completa). */
  faltantes: string[];
  renglones: RenglonCuadreApertura[];
  sumaAbsolutaBd: number;
  netoBd: number;
  cargosSinVencimiento: number;
}

/**
 * Cruza el archivo con la base: busca cada UUID que el archivo manda cargar y mide lo que quedó.
 * NO escribe nada y NO corrige nada (§7: los descuadres se listan).
 */
export async function calcularCuadreApertura(
  cliente: PrismaClient,
  clasificacion: ClasificacionSinube,
): Promise<CuadreApertura> {
  const uuids = clasificacion.aperturas
    .map((a) => a.movimiento.uuidCfdi)
    .filter((u): u is string => u !== null && u !== undefined);

  const movimientos =
    uuids.length === 0
      ? []
      : await cliente.movimientoTercero.findMany({
          where: { uuidCfdi: { in: uuids } },
          select: {
            uuidCfdi: true,
            monto: true,
            origen: true,
            fechaVencimiento: true,
            cancelado: true,
            idProveedor: true,
            proveedor: { select: { nombre: true } },
          },
        });

  const porProveedor = new Map<number, RenglonCuadreApertura>();
  const vistos = new Set<string>();
  let sumaAbsolutaBd = 0;
  let netoBd = 0;
  let cargosSinVencimiento = 0;

  for (const m of movimientos) {
    if (m.uuidCfdi !== null) vistos.add(m.uuidCfdi);
    const monto = Number(m.monto);
    // Un movimiento CANCELADO sigue en la tabla (D3: nada se borra) pero su inverso lo neutraliza:
    // no se cuenta en las sumas, y se ve porque el conteo de movimientos no le cuadra al de UUID.
    if (m.cancelado) continue;
    const id = m.idProveedor ?? 0;
    const fila = porProveedor.get(id) ?? {
      idProveedor: id,
      nombre: m.proveedor?.nombre ?? '(sin proveedor)',
      movimientos: 0,
      sumaAbsoluta: 0,
      neto: 0,
      cargosSinVencimiento: 0,
    };
    fila.movimientos += 1;
    fila.sumaAbsoluta = redondear2(fila.sumaAbsoluta + Math.abs(monto));
    fila.neto = redondear2(fila.neto + monto);
    const esCargo = monto > 0;
    if (esCargo && m.fechaVencimiento === null) {
      fila.cargosSinVencimiento += 1;
      cargosSinVencimiento += 1;
    }
    porProveedor.set(id, fila);
    sumaAbsolutaBd = redondear2(sumaAbsolutaBd + Math.abs(monto));
    netoBd = redondear2(netoBd + monto);
  }

  return {
    clasificacion,
    encontrados: vistos.size,
    faltantes: uuids.filter((u) => !vistos.has(u)),
    renglones: [...porProveedor.values()].sort((a, b) => b.sumaAbsoluta - a.sumaAbsoluta),
    sumaAbsolutaBd,
    netoBd,
    cargosSinVencimiento,
  };
}

/** Formatea el cuadre para consola/archivo. */
export function formatearCuadreApertura(c: CuadreApertura): string {
  const r = c.clasificacion.resumen;
  const p: string[] = [];
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(' CUADRE — APERTURA DE SALDOS DESDE SINUBE (fila 0.131)');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(`  Renglones leídos del archivo : ${String(r.leidos)}`);
  for (const [tipo, n] of Object.entries(r.porTipoFiscal).sort()) {
    p.push(`      · Tipo fiscal "${tipo}"`.padEnd(33) + `: ${String(n)}`);
  }
  p.push(`  Renglones CARGADOS (vivos)   : ${String(r.cargados)}`);
  p.push(`  ⭐ SUMA DE SALDOS CARGADA     : ${r.sumaSaldoCargado.toFixed(2)}`);
  for (const [tipo, s] of Object.entries(r.sumaSaldoPorTipoFiscal).sort()) {
    p.push(`      · de "${tipo}"`.padEnd(33) + `: ${s.toFixed(2)}`);
  }
  p.push(
    `  Efecto NETO en la cuenta     : ${r.netoCargado.toFixed(2)}  (cargos − notas de crédito)`,
  );
  p.push('');
  p.push('── DESCARTADOS (y por qué) ────────────────────────────────────');
  const motivos = Object.entries(r.descartesPorMotivo).sort();
  if (motivos.length === 0) {
    p.push('  (ninguno)');
  } else {
    for (const [motivo, n] of motivos) {
      const suma = r.sumaDescartadaPorMotivo[motivo] ?? 0;
      p.push(`  ${String(n).padStart(4)} · ${motivo}`);
      p.push(`         saldo que se queda fuera: ${suma.toFixed(2)}`);
    }
  }
  if (c.clasificacion.avisos.length > 0) {
    p.push('');
    p.push('── AVISOS (no bloquean, pero míralos) ─────────────────────────');
    for (const a of c.clasificacion.avisos.slice(0, 20)) {
      p.push(`  ${a.motivo}: ${a.detalle}`);
    }
    if (c.clasificacion.avisos.length > 20) {
      p.push(`  … y ${String(c.clasificacion.avisos.length - 20)} más.`);
    }
  }
  p.push('');
  p.push('── LO QUE QUEDÓ EN LA BASE ────────────────────────────────────');
  p.push(`  UUID del archivo encontrados : ${String(c.encontrados)} de ${String(r.cargados)}`);
  p.push(`  Σ |monto| en la base         : ${c.sumaAbsolutaBd.toFixed(2)}`);
  // 🔴 La diferencia ≠ 0 es el ÚNICO cable trampa del choque con `etl-cfdi-masivo.ts`: si ese CFDI
  //    ya existía con el TOTAL del comprobante, la apertura no lo tocó y la cuenta lleva deuda que ya
  //    se pagó. Antes salía como un número más en la lista; ahora grita, igual que los cargos sin
  //    vencimiento.
  const diferencia = redondear2(c.sumaAbsolutaBd - r.sumaSaldoCargado);
  p.push(
    `  Diferencia contra el archivo : ${diferencia.toFixed(2)}` +
      (diferencia === 0
        ? '  (cuadra)'
        : '  🔴 NO CUADRA — revisa los UUID que ya existían: conservan su importe, no el saldo'),
  );
  p.push(`  Σ monto (neto) en la base    : ${c.netoBd.toFixed(2)}`);
  p.push(
    `  🔴 Cargos SIN vencimiento     : ${String(c.cargosSinVencimiento)}` +
      (c.cargosSinVencimiento === 0
        ? '  (correcto: todos tienen antigüedad)'
        : '  ← LA PANTALLA DE ANTIGÜEDAD NO LOS VA A PODER MOSTRAR'),
  );
  if (c.faltantes.length > 0) {
    p.push('');
    p.push(`── UUID QUE NO SE ENCONTRARON (${String(c.faltantes.length)}) ──`);
    for (const u of c.faltantes.slice(0, 20)) p.push(`  ${u}`);
    if (c.faltantes.length > 20) p.push(`  … y ${String(c.faltantes.length - 20)} más.`);
  }
  if (c.renglones.length > 0) {
    p.push('');
    p.push('── POR PROVEEDOR ──────────────────────────────────────────────');
    for (const f of c.renglones.slice(0, 60)) {
      p.push(
        `  #${String(f.idProveedor).padStart(5)} ${f.nombre.slice(0, 42).padEnd(42)} ` +
          `movs=${String(f.movimientos).padStart(4)} Σ|monto|=${f.sumaAbsoluta.toFixed(2).padStart(14)} ` +
          `neto=${f.neto.toFixed(2).padStart(14)}` +
          (f.cargosSinVencimiento > 0
            ? `  ⚠️ sin vencimiento: ${String(f.cargosSinVencimiento)}`
            : ''),
      );
    }
    if (c.renglones.length > 60)
      p.push(`  … y ${String(c.renglones.length - 60)} proveedores más.`);
  }
  return p.join('\n');
}

/** Lee un flag `--clave=valor` de argv (o null). */
function flag(clave: string): string | null {
  const pref = `--${clave}=`;
  const arg = process.argv.find((a) => a.startsWith(pref));
  return arg === undefined ? null : arg.slice(pref.length);
}

/** Punto de entrada del script (solo lee/cuenta). */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const archivo = flag('archivo');
  if (archivo === null) {
    console.error(
      'Falta --archivo=<ruta.xlsx>. Uso: npx tsx --env-file=.env migracion/cuadre-apertura-sinube.ts -- --archivo=sinube.xlsx',
    );
    process.exit(1);
  }
  const cliente = crearClientePrisma(url);
  try {
    const clasificacion = clasificarSinube(await leerArchivoSinube(archivo));
    console.log(formatearCuadreApertura(await calcularCuadreApertura(cliente, clasificacion)));
  } catch (e) {
    if (e instanceof ErrorListadoSinube) {
      console.error(`🔴 No se pudo leer el archivo: ${e.message}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
