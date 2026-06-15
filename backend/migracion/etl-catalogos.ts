/**
 * ETL de CATÁLOGOS y MATERIALES (F1-E6, PIEZA A) — orquestador.
 *
 * Carga los catálogos del sistema viejo (Access, CSV en `Respaldo CLAUDE/TABLAS/`) a la BD
 * de v2, VÍA los servicios de dominio (A1: nunca `prisma.create` directo de catálogos), de
 * forma IDEMPOTENTE y re-ejecutable (§7). Persiste la tabla de MAPEO `mapeo_migracion`
 * (clave-vieja → id-nuevo), entregable que reutilizan E7/F2/F4/F9.
 *
 * Lo corre Gabriel en Railway/`prueba` con `npm run etl:catalogos` (tsx). NO toca la API ni
 * el frontend. NO sube fotos (eso es E7). Al final imprime el reporte de cuadre (conteos v1
 * CSV vs v2 Postgres, calculados en runtime) + las incidencias para decisión.
 *
 * ORDEN de carga (respeta dependencias de FK/mapeo):
 *  1. Empresas (da el id de FR Moda para los almacenes)
 *  2. Clientes · Etiquetas de marca · Géneros · Temporadas (independientes)
 *  3. Tela-categorías (las usa Telas)
 *  4. Proveedores + fusión de terceros (los usan Avíos)
 *  5. Almacenes (PT + Tela, en FR Moda)
 *  6. Bordados
 *  7. Avíos (match difuso a proveedores)
 *  8. Colores (texto→idColor; los usa Telas-colores)
 *  9. Telas (unificadas; mapeo IdTelas/IdTelasDis)
 * 10. Telas-colores (necesita mapeo de telas y de colores)
 * 11. Tallas + curvas (desde Ordenes.Tallas)
 *
 * Cada loader corre con su propia composición de transacciones (cada `crear*` abre su tx):
 * un fallo a media carga NO deja a medias un registro (atomicidad por servicio, A2), y
 * re-ejecutar retoma sin duplicar (idempotencia).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { calcularCuadre, formatearCuadre } from './cuadre.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { Reporte } from './comun/reporte.js';
import { cargarAlmacenes } from './loaders/almacenes.js';
import { cargarAvios } from './loaders/avios.js';
import { cargarBordados } from './loaders/bordados.js';
import { cargarClientes, type ResultadoLoader } from './loaders/clientes.js';
import { cargarColores } from './loaders/colores.js';
import { cargarEmpresas } from './loaders/empresas.js';
import { cargarEtiquetasMarca } from './loaders/etiquetas-marca.js';
import { cargarGeneros } from './loaders/generos.js';
import { cargarProveedores } from './loaders/proveedores.js';
import { cargarTallas } from './loaders/tallas.js';
import { cargarTelaCategorias } from './loaders/tela-categorias.js';
import { cargarTelas } from './loaders/telas.js';
import { cargarTelasColores } from './loaders/telas-colores.js';
import { cargarTemporadas } from './loaders/temporadas.js';

/** Imprime el resumen de un loader (creados/existentes/omitidos). */
function log(nombre: string, r: ResultadoLoader): void {
  console.log(
    `  ${nombre.padEnd(22)} creados=${String(r.creados).padStart(5)} ` +
      `existentes=${String(r.existentes).padStart(5)} omitidos=${String(r.omitidos).padStart(5)}`,
  );
}

/** Corre TODO el ETL contra el cliente dado. Devuelve el reporte de incidencias. */
export async function ejecutarEtl(cliente: PrismaClient): Promise<Reporte> {
  const sesion = sesionEtl();
  const reporte = new Reporte();

  console.log('ETL de catálogos F1-E6 — inicio');

  const empresas = await cargarEmpresas(sesion, cliente, reporte);
  log('Empresas', empresas);
  const idEmpresa = empresas.idFrModa ?? 1;

  log('Clientes', await cargarClientes(sesion, cliente, reporte));
  log('Etiquetas de marca', await cargarEtiquetasMarca(sesion, cliente, reporte));
  log('Géneros', await cargarGeneros(sesion, cliente, reporte));
  log('Temporadas', await cargarTemporadas(sesion, cliente, reporte));
  log('Tela-categorías', await cargarTelaCategorias(sesion, cliente, reporte));

  const prov = await cargarProveedores(sesion, cliente, reporte);
  log('Proveedores', prov);
  console.log(`    (fusiones de roles de terceros: ${String(prov.fusiones)})`);

  log('Almacenes', await cargarAlmacenes(sesion, cliente, reporte, idEmpresa));
  log('Bordados', await cargarBordados(sesion, cliente, reporte));
  log('Avíos', await cargarAvios(sesion, cliente, reporte));
  log('Colores', await cargarColores(sesion, cliente, reporte));
  log('Telas', await cargarTelas(sesion, cliente, reporte));
  log('Telas-colores', await cargarTelasColores(sesion, cliente, reporte));

  const tallas = await cargarTallas(sesion, cliente, reporte);
  log('Tallas', tallas.tallas);
  log('Curvas', tallas.curvas);
  console.log(`    (cadenas de talla raras reportadas: ${String(tallas.cadenasRaras)})`);

  console.log('ETL de catálogos F1-E6 — fin de carga');
  return reporte;
}

/** Punto de entrada del script (`npm run etl:catalogos`). */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const cliente = crearClientePrisma(url);
  try {
    const reporte = await ejecutarEtl(cliente);

    // Reporte de CUADRE en runtime (v1 CSV vs v2 Postgres) — nunca números a mano.
    const cuadre = await calcularCuadre(cliente);
    const textoCuadre = formatearCuadre(cuadre);
    const textoReporte = reporte.aTexto();

    console.log('\n' + textoCuadre);
    console.log('\n' + textoReporte);

    // Persistir ambos a un archivo junto al ETL (útil para revisar y elevar a Gabriel/Daniel).
    const salida = join(
      process.cwd(),
      `reporte-etl-f1e6-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
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
