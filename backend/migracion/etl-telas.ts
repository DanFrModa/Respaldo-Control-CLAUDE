/**
 * ETL del INVENTARIO de TELAS histórico (kardex) — F4-E6, Pieza B.
 *
 * Migra el histórico real del inventario de TELAS (Entradas/Salidas + sus detalles) a la BD de v2
 * como movimientos del KARDEX único (D3), VÍA el MODO MIGRACIÓN de la capa de dominio
 * (`dominio/inventarios/migracion.ts`, A1: el motor de kardex es el único que escribe). Es
 * IDEMPOTENTE (por `MapeoMigracion` + `Movimiento.origenId`) y re-ejecutable (se re-corre en F10).
 *
 * Clasifica las Entradas/Salidas del viejo en (a) pares de traspaso, (b) entradas de compra directas
 * (SIN RecepcionCompra), (c) salidas a orden y (d) salidas sin clasificar (ajuste-salida), y
 * sintetiza un LOTE legacy por color (decisión f). Ver `loaders/entradas-salidas-telas.ts`.
 *
 * DEPENDE de los mapeos que dejaron los ETL previos (DEBEN haber corrido ANTES):
 *  • `etl-catalogos.ts` → mapeos `Tela:IdTelas`, `Color`, `Almacen:Tela`, `Empresa`.
 *  • `etl-pedidos-ordenes.ts` → `Orden` (para las salidas ligadas a orden, c).
 *  • el SEED de `prueba` → catálogo `TipoMovimientoInventario` (entrada-recepcion, salida-a-orden,
 *    ajuste-salida, transferencia-salida/-entrada).
 *
 * Lo corre Gabriel desde `backend/` (NUNCA `npm run`, ver `migracion/README.md`):
 *   npx tsx --env-file=.env migracion/etl-telas.ts
 *
 * Al final imprime el CUADRE de telas (cuadre-f4) + las incidencias para decisión de Daniel, y
 * escribe un artefacto `reporte-etl-f4e6-telas-<timestamp>.txt` (gitignored, como F2/F3).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { calcularCuadreF4, formatearCuadreF4 } from './cuadre-f4.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { Reporte } from './comun/reporte.js';
import { describirVentana } from './comun/ventana.js';
import { cargarTelasKardex } from './loaders/entradas-salidas-telas.js';

/** Corre el ETL de kardex de telas contra el cliente dado. Devuelve el reporte de incidencias. */
export async function ejecutarEtlTelas(cliente: PrismaClient): Promise<Reporte> {
  const sesion = sesionEtl();
  const reporte = new Reporte();

  console.log('ETL de inventario de TELAS (kardex histórico) F4-E6 — inicio');

  // Empresa por defecto de las entradas/traspasos (sin orden): FR Moda (la favorita).
  const frModa = await cliente.empresa.findFirst({
    where: { favorita: true },
    select: { id: true },
  });
  const idEmpresaDefecto = frModa?.id ?? sesion.idEmpresaActiva;
  if (frModa === null) {
    reporte.nota(
      `No se halló empresa favorita (FR Moda); se usa idEmpresa=${String(idEmpresaDefecto)} para entradas/traspasos.`,
    );
  }

  const r = await cargarTelasKardex(sesion, cliente, reporte, idEmpresaDefecto);

  reporte.nota(describirVentana(r.ventana));
  console.log(`  Lotes legacy sintetizados (uno por color): ${String(r.lotesLegacy)}`);
  console.log(
    `  Pares de traspaso detectados=${String(r.paresDetectados)} ` +
      `(entradas 'Transferencia' sin par=${String(r.entradasTransferenciaSinPar)})`,
  );
  imprimir('Entradas de compra (b)', r.entradasCompra);
  imprimir('Salidas a orden (c)', r.salidasOrden);
  imprimir('Salidas sin clasificar (d, ajuste-salida)', r.salidasSinClasificar);
  imprimir('Traspasos (a, pares)', r.traspasos);
  if (r.ventana.corte !== null) {
    console.log(`  ${describirVentana(r.ventana)}`);
    console.log(
      `    (docs condensados: entradas=${String(r.docsCondensados.entradas)} ` +
        `salidas=${String(r.docsCondensados.salidas)} traspasos=${String(r.docsCondensados.traspasos)} · ` +
        `renglones=${String(r.renglonesCondensados)})`,
    );
    imprimir('Saldos iniciales (sintéticos por combo)', r.saldosIniciales);
    console.log(`    (combos con neto negativo=${String(r.saldosNegativos)})`);
  }

  console.log('ETL de inventario de TELAS F4-E6 — fin de carga');
  return reporte;
}

/** Imprime una línea de resumen de un `ResultadoLoader`. */
function imprimir(
  etiqueta: string,
  r: { creados: number; existentes: number; omitidos: number; omitidosValidacion?: number },
): void {
  console.log(
    `  ${etiqueta.padEnd(42)} creados=${String(r.creados).padStart(6)} ` +
      `existentes=${String(r.existentes).padStart(6)} ` +
      `omitidos=${String(r.omitidos).padStart(6)} ` +
      `omitidosValidacion=${String(r.omitidosValidacion ?? 0)}`,
  );
}

/** Punto de entrada del script. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  // Mismos tiempos HOLGADOS que el ETL de F3 (BD remota de `prueba`, proxy público).
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
    const reporte = await ejecutarEtlTelas(cliente);

    const cuadre = await calcularCuadreF4(cliente);
    const textoCuadre = formatearCuadreF4(cuadre);
    const textoReporte = reporte.aTexto();

    console.log('\n' + textoCuadre);
    console.log('\n' + textoReporte);

    const salida = join(
      process.cwd(),
      `reporte-etl-f4e6-telas-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
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
