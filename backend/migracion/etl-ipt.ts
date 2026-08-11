/**
 * ETL del INVENTARIO PT histórico (kardex) — F3-E6, Pieza B.
 *
 * Migra el histórico real del inventario de PRODUCTO TERMINADO (IPT_Movs/IPT_MovsDet) a la BD de v2
 * como movimientos del KARDEX único (D3), VÍA el MODO MIGRACIÓN de la capa de dominio
 * (`dominio/inventarios/migracion.ts`, A1: el motor de kardex es el único que escribe). Es
 * IDEMPOTENTE (por `Movimiento.origenId` = IdIPT_MovsDet) y re-ejecutable (se re-corre en F10).
 *
 * DEPENDE de los mapeos que dejaron los ETL previos (DEBEN haber corrido ANTES):
 *  • `etl-catalogos.ts`  → mapeos `Empresa`, `Almacen:IPT` (los 3 PT).
 *  • `etl-modelos.ts`    → modelos (resueltos aquí por su CÓDIGO = `IPT_Modelos.NumMod`).
 *  • el SEED de `prueba`  → catálogo `TipoMovimientoInventario` (los 19 + 2 patas v2) y los almacenes.
 *  • `etl-produccion.ts` (Pieza A) NO es prerequisito de DATOS de este ETL: la Pieza A carga
 *    corte/envío/recibo/EsMa SIN generar kardex (los recibos van en variante "sin efectos") justo
 *    para que el ÚNICO origen de kardex sea esta migración. Orden recomendado igual: producción → ipt.
 *
 * Lo corre Gabriel desde `backend/` (NUNCA `npm run`, ver `migracion/README.md`):
 *   npx tsx --env-file=.env migracion/etl-ipt.ts
 *
 * Al final imprime el CUADRE DE FASE (cuadre-f3) + las incidencias para decisión de Daniel, y
 * escribe un artefacto `reporte-etl-f3-<timestamp>.txt` (gitignored, como F2).
 *
 * ⚠️ NO SE CORRE EN EL GO-LIVE. El almacén de producto terminado arranca del CONTEO FÍSICO que
 * captura Daniel (§Post-F9.25), no del histórico. Y desde el 11-ago-2026 este ETL SÍ obedece
 * `ETL_DESDE` (antes lo ignoraba, y con el corte de 2025-2026 metía igual las **5,072 CABECERAS**
 * `IPT_Movs` de **2020-2023** —los movimientos que llegan al kardex son sus renglones de
 * `IPT_MovsDet`, más— al kardex de PT): con `ETL_DESDE=2025` no carga nada. Correrlo DESPUÉS del conteo
 * físico lo PISA con historia vieja.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { calcularCuadreF3, formatearCuadreF3 } from './cuadre-f3.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { Reporte } from './comun/reporte.js';
import { describirVentana, resolverVentana } from './comun/ventana.js';
import { cargarIptKardex } from './loaders/ipt-kardex.js';

/** Corre el ETL de kardex IPT contra el cliente dado. Devuelve el reporte de incidencias. */
export async function ejecutarEtlIpt(cliente: PrismaClient): Promise<Reporte> {
  const sesion = sesionEtl();
  const reporte = new Reporte();

  console.log('ETL de inventario PT (kardex histórico) F3-E6 — inicio');
  // §Post-F9.24: la ventana se imprime SIEMPRE, aunque no recorte, para que quede claro qué se
  // migró en esta corrida (con ETL_DESDE=2025 este ETL no carga nada: el PT arranca del conteo
  // físico, §Post-F9.25).
  const ventana = resolverVentana();
  console.log(`  ${describirVentana(ventana)}`);
  reporte.nota(describirVentana(ventana));

  const r = await cargarIptKardex(sesion, cliente, reporte);
  console.log(
    `  Movimientos IPT          creados=${String(r.movimientos.creados).padStart(5)} ` +
      `existentes=${String(r.movimientos.existentes).padStart(5)} ` +
      `omitidos=${String(r.movimientos.omitidos).padStart(5)} ` +
      `omitidosValidacion=${String(r.movimientos.omitidosValidacion ?? 0)}`,
  );
  console.log(
    `    (detalles migrados=${String(r.detallesMigrados)} piezas=${String(r.piezas)} ` +
      `tipoVacío(EnSa)=${String(r.tipoVacio)} direcciónDiscordante=${String(r.direccionDiscordante)})`,
  );
  if (r.cabecerasFueraVentana > 0 || r.detallesFueraVentana > 0) {
    console.log(
      `    (fuera de la ventana: ${String(r.cabecerasFueraVentana)} cabeceras IPT_Movs ` +
        `→ ${String(r.detallesFueraVentana)} renglones que NO entraron al kardex de PT)`,
    );
  }

  console.log('ETL de inventario PT F3-E6 — fin de carga');
  return reporte;
}

/** Punto de entrada del script. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  // Mismos tiempos HOLGADOS que el ETL de F2 (BD remota de `prueba`, proxy público): subir
  // maxWait/timeout (defaults dan P2028), pool grande y keepAlive para no perder conexiones ociosas.
  const cliente = crearClientePrisma(url, {
    transactionOptions: { maxWait: 20_000, timeout: 120_000 },
    poolMax: 12,
    pool: {
      keepAlive: true,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 30_000,
    },
  });
  try {
    const reporte = await ejecutarEtlIpt(cliente);

    const cuadre = await calcularCuadreF3(cliente);
    const textoCuadre = formatearCuadreF3(cuadre);
    const textoReporte = reporte.aTexto();

    console.log('\n' + textoCuadre);
    console.log('\n' + textoReporte);

    const salida = join(
      process.cwd(),
      `reporte-etl-f3-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
    );
    writeFileSync(salida, `${textoCuadre}\n\n${textoReporte}\n`, { encoding: 'utf-8' });
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
