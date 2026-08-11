/**
 * ETL de PEDIDOS y ÓRDENES (F2-E5) — orquestador (la ÚLTIMA etapa de la fase F2).
 *
 * Migra el histórico real de pedidos y órdenes (7 CSV de `Respaldo CLAUDE/TABLAS/`) a la BD de
 * v2, VÍA el MODO MIGRACIÓN de la capa de dominio (A1: nunca lógica de negocio en el ETL), de
 * forma IDEMPOTENTE y re-ejecutable (§7). Depende de los mapeos de F1 (clientes, empresas,
 * modelos, colores, tallas, etiquetas, telas, proveedores) que dejó `etl:catalogos`/`etl:modelos`.
 *
 * Lo corre Gabriel en Railway/`prueba` con `npm run etl:pedidos-ordenes` (tsx). NO toca la API ni
 * el frontend. Al final imprime el cuadre (conteos v1 CSV vs v2 Postgres, dos niveles) + las
 * incidencias para decisión de Daniel.
 *
 * ORDEN de carga (la cadena de FK/mapeo importa):
 *  1. Pedidos + PedidosDet      → Pedido + PedidoLinea   (mapea IdPedidos, IdPedidosDet)
 *  2. PedidosReales + Det       → PedidoReal + Linea      (liga IdPedidosDet → PedidoLinea)
 *  3. Ordenes + OrdenesDet      → Orden + matriz + Monarch (liga IdPedidosDet; despivota T1..T8)
 *  4. ComentaOrd                → OrdenComentario          (liga IdOrdenes)
 *  5. Siembra de secuencias folioPedido/folioOrden por empresa (post-máximo migrado)
 *
 * Cada documento (pedido/orden/real/comentario) se crea en SU PROPIA transacción (atomicidad por
 * documento, A2): un fallo a media carga NO deja a medias un registro, y re-ejecutar retoma sin
 * duplicar (idempotencia por el unique (idEmpresa,folio) o por MapeoMigracion).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';
import { CLAVE_SECUENCIA_PEDIDO } from '../src/dominio/pedidos/pedidos.js';
import { CLAVE_SECUENCIA_ORDEN } from '../src/dominio/produccion/ordenes.js';
import { sembrarSecuencia } from '../src/comun/secuencias.js';

import { calcularCuadreF2, formatearCuadreF2 } from './cuadre-f2.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { Reporte } from './comun/reporte.js';
import { cargarComentariosOrden } from './loaders/comentarios-orden.js';
import { describirVentana, resolverVentana } from './comun/ventana.js';
import { cargarOrdenes } from './loaders/ordenes.js';
import { cargarPedidos } from './loaders/pedidos.js';
import { cargarPedidosReales } from './loaders/pedidos-reales.js';
import type { ResultadoLoader } from './loaders/clientes.js';

/** Imprime el resumen de un loader. */
function log(nombre: string, r: ResultadoLoader): void {
  const omVal = r.omitidosValidacion ?? 0;
  console.log(
    `  ${nombre.padEnd(24)} creados=${String(r.creados).padStart(5)} ` +
      `existentes=${String(r.existentes).padStart(5)} omitidos=${String(r.omitidos).padStart(5)}` +
      (omVal > 0 ? ` omitidosValidacion=${String(omVal)}` : ''),
  );
}

/**
 * Siembra las secuencias `pedido` y `orden` por empresa, ADELANTÁNDOLAS al máximo folio migrado
 * de cada una (idempotente y monótono: nunca retrocede). Sin esto, la primera captura nueva
 * chocaría contra el unique `(idEmpresa, folio)`.
 */
async function sembrarSecuenciasF2(cliente: PrismaClient): Promise<void> {
  const maxPedido = await cliente.pedido.groupBy({
    by: ['idEmpresa'],
    _max: { folio: true },
  });
  for (const g of maxPedido) {
    const max = g._max.folio ?? 0n;
    await sembrarSecuencia(cliente, g.idEmpresa, CLAVE_SECUENCIA_PEDIDO, max);
  }
  const maxOrden = await cliente.orden.groupBy({
    by: ['idEmpresa'],
    _max: { folio: true },
  });
  for (const g of maxOrden) {
    const max = g._max.folio ?? 0n;
    await sembrarSecuencia(cliente, g.idEmpresa, CLAVE_SECUENCIA_ORDEN, max);
  }
  console.log(
    `  Secuencias sembradas: pedido(${String(maxPedido.length)} empresas) ` +
      `orden(${String(maxOrden.length)} empresas)`,
  );
}

/** Corre TODO el ETL de F2 contra el cliente dado. Devuelve el reporte de incidencias. */
export async function ejecutarEtlPedidosOrdenes(cliente: PrismaClient): Promise<Reporte> {
  const sesion = sesionEtl();
  const reporte = new Reporte();

  console.log('ETL de pedidos y órdenes F2-E5 — inicio');
  // §Post-F9.24: la ventana se imprime SIEMPRE, aunque no recorte, para que quede claro qué se
  // migró en esta corrida.
  const ventana = resolverVentana();
  console.log(`  ${describirVentana(ventana)}`);
  reporte.nota(describirVentana(ventana));

  const pedidos = await cargarPedidos(sesion, cliente, reporte);
  log('Pedidos', pedidos.pedidos);
  if (pedidos.fueraVentana > 0) {
    console.log(`    (fuera de la ventana: ${String(pedidos.fueraVentana)} pedidos)`);
  }
  log('PedidoLinea', pedidos.lineas);

  const reales = await cargarPedidosReales(sesion, cliente, reporte);
  log('PedidosReales', reales.reales);
  log('PedidoRealLinea', reales.lineas);

  const ordenes = await cargarOrdenes(sesion, cliente, reporte);
  log('Ordenes', ordenes.ordenes);
  console.log(
    `    (renglones color=${String(ordenes.renglonesColor)} celdas talla=${String(ordenes.celdasTalla)} ` +
      `referencias Monarch=${String(ordenes.referencias)} monarch-default descartados=${String(ordenes.monarchDefault)})`,
  );
  console.log(
    `    (colores creados al vuelo=${String(ordenes.coloresCreados)} tallas creadas al vuelo=${String(ordenes.tallasCreadas)})`,
  );
  if (ordenes.fueraVentana > 0) {
    console.log(
      `    (fuera de la ventana: ${String(ordenes.fueraVentana)} órdenes — y con ellas su corte, envíos, recibos, RC, auditorías y costos)`,
    );
  }

  log('ComentaOrd', await cargarComentariosOrden(sesion, cliente, reporte));

  console.log('ETL de pedidos y órdenes F2-E5 — sembrando secuencias');
  await sembrarSecuenciasF2(cliente);

  console.log('ETL de pedidos y órdenes F2-E5 — fin de carga');
  return reporte;
}

/** Punto de entrada del script (`npm run etl:pedidos-ordenes`). */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  // Tiempos de transacción HOLGADOS + pool grande y ESTABLE: el ETL corre minutos contra la BD
  // remota de `prueba` (Railway, proxy público). La latencia exige subir maxWait/timeout (los
  // defaults de Prisma dan `P2028`); la concurrencia (lotes.ts) exige `poolMax`; y el proxy
  // corta conexiones ociosas, así que `keepAlive` + timeouts mantienen el pool sano durante toda
  // la corrida. Solo el ETL: la app no pasa estas opciones.
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
    const reporte = await ejecutarEtlPedidosOrdenes(cliente);

    const cuadre = await calcularCuadreF2(cliente);
    const textoCuadre = formatearCuadreF2(cuadre);
    const textoReporte = reporte.aTexto();

    console.log('\n' + textoCuadre);
    console.log('\n' + textoReporte);

    const salida = join(
      process.cwd(),
      `reporte-etl-f2e5-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
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
