/**
 * ETL de SALDOS INICIALES de terceros (F9-E6; D15c) — orquestador.
 *
 * Carga el "punto de partida" de CxC/CxP (el corte de SINUBE) como movimientos de APERTURA vía el modo
 * migración del motor (`insertarAperturasMigradas`, A1), por LOTES, IDEMPOTENTE. NO lee Access: la
 * fuente es un archivo CSV suelto (export del contador / corte de SINUBE) de FORMATO FLEXIBLE — ver
 * el encabezado de `loaders/terceros-saldos.ts` y `migracion/README.md`.
 *
 * ⚠️ NO SE CORRE todavía (D15c): los archivos fuente aún no existen (Daniel está sacando el corte).
 * Se CONSTRUYE y PRUEBA con fixtures; se ejecuta cuando llegue el corte, con:
 *
 *   npx tsx --env-file=.env migracion/etl-terceros-saldos.ts -- --archivo=saldos.csv [--empresa=<id|nombre>] \
 *     [--corte=YYYY-MM-DD] [--encoding=utf8|cp850]
 *
 * (NUNCA `npm run`: esos no llevan --env-file — ver migracion/README.md.)
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { opcionesClienteEtl } from './comun/cliente-etl.js';

import { sesionEtl } from './comun/sesion-etl.js';
import { Reporte } from './comun/reporte.js';
import {
  cargarAperturas,
  leerArchivoAperturas,
  type OpcionesParseo,
} from './loaders/terceros-saldos.js';
import { calcularCuadreF9, formatearCuadreF9 } from './cuadre-f9.js';
import type { ResultadoLoader } from './loaders/clientes.js';

/** Lee un flag `--clave=valor` de argv (o null). */
function flag(clave: string): string | null {
  const pref = `--${clave}=`;
  const arg = process.argv.find((a) => a.startsWith(pref));
  return arg === undefined ? null : arg.slice(pref.length);
}

/** Resuelve la empresa por defecto: la del flag `--empresa` (id o nombre), o la favorita, o la primera. */
async function empresaPorDefecto(cliente: PrismaClient, ref: string | null): Promise<number> {
  if (ref !== null) {
    const comoId = Number(ref);
    if (Number.isInteger(comoId)) {
      const e = await cliente.empresa.findUnique({ where: { id: comoId }, select: { id: true } });
      if (e !== null) return e.id;
    }
    const porNombre = await cliente.empresa.findFirst({
      where: { nombre: { equals: ref, mode: 'insensitive' } },
      select: { id: true },
    });
    if (porNombre !== null) return porNombre.id;
    throw new Error(`No se encontró la empresa "${ref}" (--empresa).`);
  }
  const favorita = await cliente.empresa.findFirst({
    where: { favorita: true },
    select: { id: true },
  });
  if (favorita !== null) return favorita.id;
  const primera = await cliente.empresa.findFirst({ select: { id: true }, orderBy: { id: 'asc' } });
  if (primera === null) throw new Error('No hay ninguna empresa a la cual asignar las aperturas.');
  return primera.id;
}

/** Imprime el resumen de un loader (mismo formato que los demás ETL). */
function log(nombre: string, r: ResultadoLoader): void {
  const omVal = r.omitidosValidacion ?? 0;
  console.log(
    `  ${nombre.padEnd(22)} creados=${String(r.creados).padStart(6)} ` +
      `existentes=${String(r.existentes).padStart(6)} omitidos=${String(r.omitidos).padStart(6)}` +
      (omVal > 0 ? ` omitidosValidacion=${String(omVal)}` : ''),
  );
}

/**
 * Corre el ETL de saldos iniciales contra `cliente`, leyendo `archivo`. Devuelve el reporte (para el
 * volcado). Reutilizable por los tests de integración (que inyectan un cliente de testcontainers).
 */
export async function ejecutarEtlTercerosSaldos(
  cliente: PrismaClient,
  archivo: string,
  opciones: OpcionesParseo & { encoding?: string; empresaRef?: string | null } = {},
): Promise<Reporte> {
  const sesion = sesionEtl();
  const reporte = new Reporte();

  console.log('ETL saldos iniciales de terceros F9-E6 — inicio');

  const { filas, incidencias } = leerArchivoAperturas(archivo, opciones);
  for (const inc of incidencias) {
    reporte.agregar(inc.motivo, inc.detalle);
  }
  console.log(
    `  Renglones válidos parseados: ${String(filas.length)} · incidencias de parseo: ${String(incidencias.length)}`,
  );

  const idEmpresaDefault = await empresaPorDefecto(cliente, opciones.empresaRef ?? null);
  const res = await cargarAperturas(sesion, cliente, reporte, { filas, idEmpresaDefault });
  log('Aperturas', res);

  console.log('ETL saldos iniciales de terceros F9-E6 — fin de carga');
  return reporte;
}

/** Punto de entrada del script. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const archivo = flag('archivo');
  if (archivo === null) {
    console.error(
      'Falta --archivo=<ruta.csv>. Uso: npx tsx --env-file=.env migracion/etl-terceros-saldos.ts -- --archivo=saldos.csv',
    );
    process.exit(1);
  }
  const corteStr = flag('corte');
  const corte = corteStr === null ? undefined : new Date(`${corteStr}T00:00:00.000Z`);
  const encoding = flag('encoding') ?? undefined;
  const empresaRef = flag('empresa');

  const cliente = crearClientePrisma(url, opcionesClienteEtl());
  // Con `exactOptionalPropertyTypes`, las props opcionales solo se incluyen si vinieron.
  const opciones: OpcionesParseo & { encoding?: string; empresaRef?: string | null } = {
    empresaRef,
  };
  if (corte !== undefined) opciones.corte = corte;
  if (encoding !== undefined) opciones.encoding = encoding;
  const opcionesCuadre: OpcionesParseo & { encoding?: string } = {};
  if (corte !== undefined) opcionesCuadre.corte = corte;
  if (encoding !== undefined) opcionesCuadre.encoding = encoding;

  try {
    const reporte = await ejecutarEtlTercerosSaldos(cliente, archivo, opciones);

    // Cuadre F9: saldo v2 (motor, por tercero) vs el saldo esperado del corte (columna `saldoEsperado`).
    const cuadre = formatearCuadreF9(await calcularCuadreF9(cliente, archivo, opcionesCuadre));
    const textoReporte = reporte.aTexto();
    console.log('\n' + cuadre);
    console.log('\n' + textoReporte);

    const salida = join(
      process.cwd(),
      `reporte-etl-f9e6-saldos-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
    );
    writeFileSync(salida, `${cuadre}\n\n${textoReporte}\n`, { encoding: 'utf-8' });
    console.log(`\nReporte escrito en: ${salida}`);
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
