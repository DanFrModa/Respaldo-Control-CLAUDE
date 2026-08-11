/**
 * ETL del módulo RUTA CRÍTICA (F5-E7, Pieza B) — orquestador.
 *
 * Migra (de forma IDEMPOTENTE y re-ejecutable, §7) TODO el histórico/configuración de la RC de los CSV
 * de `Respaldo CLAUDE/TABLAS/` (CP850) a la BD de v2, VÍA los servicios de dominio (A1). Carga en las
 * tablas que ya existen de F5-E1..E6: SIN migración, SIN permisos, SIN seed nuevos.
 *
 * ORDEN de carga (cadena de dependencias):
 *  1. Catálogos (CP_Familia/CP_Articulos, CP_Cant, RC_TipoTelas, RC_Aplicaciones) + verificación de los
 *     26 procesos (los siembra E1) + INSERCIÓN de los 54 roles responsables vigentes (RC_ProcUsua →
 *     ProcesoDefRol); LISTA las 14 huérfanas y los tipos sin rol. FactorTela: declarada no migrada (E3).
 *  2. Plantillas de ruta (CP_Tiempos) — una por artículo, con encadenamiento propio.
 *  3. Roles por usuario (Usuarios.IdRC_TipoUsuarios → UsuarioRol) — los usuarios v2 inexistentes
 *     (no migrados aún: eso es F10) se LISTAN como pendientes.
 *  4. Rutas vivas históricas (RC + RC_IP3/RC_IP4 checklist) → RutaOrden.
 *  5. Estado RC legado de las órdenes (Ordenes.{FechaInicioRC,…,RC_Viva}) — re-confirma lo de F2-E5.
 *  6. Colchón de costura (Propiedades.ColchonCostura → ConfiguracionEmpresa de la empresa favorita).
 *
 * Depende de los mapeos de F1 (no usa) y F2 (`ENTIDAD_MAPEO.orden`) que dejaron los ETLs previos, y de
 * que F5-E1/E2 hayan sembrado los procesos/familias/roles (SEED_ON_START). NO toca la API ni el frontend.
 *
 * Lo corre Gabriel desde `backend/` con:  npx tsx --env-file=.env migracion/etl-ruta-critica.ts
 * (NUNCA `npm run`: esos no llevan --env-file — ver migracion/README.md).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { Reporte } from './comun/reporte.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { describirVentana, resolverVentana } from './comun/ventana.js';
import { calcularCuadreF5, formatearCuadreF5 } from './cuadre-f5.js';
import { verificarCatalogos, type ResultadoCatalogos } from './ruta-critica/catalogos.js';
import {
  cargarOrdenesEstadoRc,
  type ResultadoOrdenesEstadoRc,
} from './ruta-critica/ordenes-estado-rc.js';
import { cargarPlantillas, type ResultadoPlantillas } from './ruta-critica/plantillas.js';
import { cargarPropiedades, type ResultadoPropiedades } from './ruta-critica/propiedades.js';
import { cargarRutasOrden, type ResultadoRutaOrden } from './ruta-critica/ruta-orden.js';
import { cargarUsuariosRoles, type ResultadoUsuariosRoles } from './ruta-critica/usuarios-roles.js';

/** Resultado consolidado del ETL (para el resumen y los tests). */
export interface ResultadoEtlRutaCritica {
  reporte: Reporte;
  catalogos: ResultadoCatalogos;
  plantillas: ResultadoPlantillas;
  usuariosRoles: ResultadoUsuariosRoles;
  rutas: ResultadoRutaOrden;
  ordenesEstadoRc: ResultadoOrdenesEstadoRc;
  propiedades: ResultadoPropiedades;
}

/** Corre TODO el ETL de la Ruta Crítica contra el cliente dado. */
export async function ejecutarEtlRutaCritica(
  cliente: PrismaClient,
): Promise<ResultadoEtlRutaCritica> {
  const sesion = sesionEtl();
  const reporte = new Reporte();

  console.log('ETL de Ruta Crítica F5-E7 (Pieza B) — inicio');
  // §Post-F9.24 — la ventana se imprime SIEMPRE, aunque este ETL no recorte por su propia fecha:
  // el runbook (README, Regla 3) manda verificar en la PRIMERA línea de cada reporte que el corte
  // fue el mismo en toda la sesión. Un ETL que la calla no se puede verificar.
  // (La RC recorta DE REBOTE, por la orden: si la orden no migró, su ruta tampoco.)
  const ventana = resolverVentana();
  console.log(`  ${describirVentana(ventana)}`);
  reporte.nota(describirVentana(ventana));

  const catalogos = await verificarCatalogos(sesion, cliente, reporte);
  console.log(
    `  Catálogos      familias(c/e=${catalogos.familias.creados}/${catalogos.familias.existentes}) ` +
      `articulos(${catalogos.articulos.creados}/${catalogos.articulos.existentes}) ` +
      `factores(${catalogos.factores.creados}/${catalogos.factores.existentes}) ` +
      `telas(${catalogos.telas.creados}/${catalogos.telas.existentes}) ` +
      `aplic(${catalogos.aplicaciones.creados}/${catalogos.aplicaciones.existentes})`,
  );
  console.log(
    `  Roles N:M      procUsua vigentes=${catalogos.procUsuaVigentes} huerfanas=${catalogos.procUsuaHuerfanas} ` +
      `ProcesoDefRol insertados=${catalogos.rolesResponsablesInsertados} ` +
      `procesosFaltantes=${catalogos.procesosFaltantes} tiposSinRol=${catalogos.tiposUsuarioSinRol}`,
  );

  const plantillas = await cargarPlantillas(
    sesion,
    cliente,
    reporte,
    catalogos.idArticuloPorIdViejo,
  );
  console.log(
    `  Plantillas     creadas=${plantillas.creadas} existentes=${plantillas.existentes} ` +
      `omitidas=${plantillas.omitidas} renglones=${plantillas.renglones}`,
  );

  const usuariosRoles = await cargarUsuariosRoles(sesion, cliente, reporte);
  console.log(
    `  UsuarioRol     conTipo=${usuariosRoles.conTipo} casadosV2=${usuariosRoles.casadosV2} ` +
      `insertados=${usuariosRoles.insertados} pendientesF9=${usuariosRoles.pendientesF9} ` +
      `sinRol=${usuariosRoles.sinRolEquivalente} activosSinTipo=${usuariosRoles.activosSinTipo}`,
  );

  const rutas = await cargarRutasOrden(sesion, cliente, reporte);
  console.log(
    `  Rutas RC       ordenes=${rutas.ordenes} renglones=${rutas.renglones} ` +
      `checklist=${rutas.itemsChecklist} omitidos=${rutas.omitidos} ` +
      `ordenesSinMapeo=${rutas.ordenesSinMapeo}`,
  );

  const ordenesEstadoRc = await cargarOrdenesEstadoRc(sesion, cliente, reporte);
  console.log(
    `  Estado RC ord. candidatas=${ordenesEstadoRc.candidatas} actualizadas=${ordenesEstadoRc.actualizadas} ` +
      `alDia=${ordenesEstadoRc.alDia} sinMapeo=${ordenesEstadoRc.sinMapeo}`,
  );

  const propiedades = await cargarPropiedades(sesion, cliente, reporte);
  console.log(
    `  Propiedades    colchonCostura=${String(propiedades.colchonCostura)} aplicado=${String(propiedades.aplicado)}`,
  );

  console.log('ETL de Ruta Crítica F5-E7 (Pieza B) — fin de carga');
  return { reporte, catalogos, plantillas, usuariosRoles, rutas, ordenesEstadoRc, propiedades };
}

/** Punto de entrada del script. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  // Mismos tiempos HOLGADOS y pool ESTABLE que los ETL de F2/F3/F4 (BD remota de prueba en Railway).
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
    const resultado = await ejecutarEtlRutaCritica(cliente);

    const cuadre = await calcularCuadreF5(cliente);
    const textoCuadre = formatearCuadreF5(cuadre);
    const textoReporte = resultado.reporte.aTexto();

    console.log('\n' + textoCuadre);
    console.log('\n' + textoReporte);

    const salida = join(
      process.cwd(),
      `reporte-etl-f5e7-ruta-critica-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
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
