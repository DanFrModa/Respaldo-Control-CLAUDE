/**
 * Demo de la RUTA CRÍTICA (F5-E4) — script de DESARROLLO, NO de producción. Ejecuta la secuencia
 * completa del motor para que Gabriel COMPARE las fechas a mano:
 *   1. Base mínima (seed de fundación: empresa FR Moda + permisos/roles + admin).
 *   2. Catálogos RC: familia/artículo, una regla de tela y una aplicación "Sin Aplicación",
 *      un par de factores por cantidad, una PLANTILLA chica de 3 procesos (2 + 3 + 1 días, en cadena).
 *   3. Una orden con 300 piezas.
 *   4. PROGRAMA la RC (genera la ruta viva desde la plantilla) — `generarRutaOrden`.
 *   5. Corre el CPM directo (`recalcularRutaOrden`; en scripts el motor pg-boss está inactivo) y
 *      imprime la TABLA de fechas planeadas + acumulado.
 *   6. CAPTURA el avance del primer proceso (fechaReal) y RE-PROGRAMA con otra entrega; vuelve a
 *      correr el CPM e imprime la tabla (mostrando que la planeada ORIGINAL se conserva).
 *
 * Idempotente en lo razonable: re-corre el seed y upserta catálogos; crea una orden demo nueva cada
 * vez (folio centinela alto). Se corre con `npm run demo:rc` (necesita `DATABASE_URL`). NO toca prod.
 */
import { pathToFileURL } from 'node:url';

import { CLAVES_PERMISO, type ClavePermiso } from '../src/contrato/index.js';
import type { SesionUsuario } from '../src/comun/permisos.js';
import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';
import { generarRutaOrden, obtenerRutaOrden } from '../src/dominio/ruta-critica/rutaOrden.js';
import { recalcularRutaOrden } from '../src/dominio/ruta-critica/cpm-job.js';
import { completarProceso } from '../src/dominio/ruta-critica/cumplimiento.js';
import { sembrar } from '../prisma/seed.js';

const FOLIO_DEMO_RC = 9_100_001n;

function sesionDemo(idEmpresa: number): SesionUsuario {
  return {
    id: 'demo-rc-sistema',
    username: 'demo-rc',
    nombre: 'Demo RC (F5-E4)',
    idEmpresaActiva: idEmpresa,
    nombreEmpresaActiva: 'FR Moda',
    permisos: new Set<ClavePermiso>(CLAVES_PERMISO),
  };
}

function iso(d: Date | null): string {
  return d === null ? '—' : d.toISOString().slice(0, 10);
}

async function imprimirTabla(
  sesion: SesionUsuario,
  idOrden: number,
  titulo: string,
): Promise<void> {
  const ruta = await obtenerRutaOrden(sesion, idOrden);
  console.log(`\n=== ${titulo} ===`);
  console.log(
    `Orden ${String(idOrden)} | entrega RC ${iso(ruta.fechaEntregaRC)} | semáforo ${ruta.semaforo} | estado ${ruta.estadoRecalculo}`,
  );
  console.log('proceso     dur  inicio→fin (vigente)   original     acum  estado    semáforo');
  for (const p of ruta.procesos) {
    console.log(
      `${p.codigoProceso.padEnd(11)} ${String(p.duracionDias).padStart(3)}  ` +
        `${iso(p.fechaPlaneadaVigente)}            ${iso(p.fechaPlaneadaOriginal)}  ` +
        `${String(p.acumuladoDias ?? '—').padStart(4)}  ${p.estado.padEnd(9)} ${p.semaforo}`,
    );
  }
}

async function correr(prisma: PrismaClient): Promise<void> {
  await sembrar(prisma);
  const empresa = await prisma.empresa.findUniqueOrThrow({ where: { nombre: 'FR Moda' } });
  const idEmpresa = empresa.id;
  const sesion = sesionDemo(idEmpresa);

  // Catálogos RC.
  const familia = await prisma.familiaArticulo.upsert({
    where: { nombre: 'DEMO RC' },
    update: {},
    create: { nombre: 'DEMO RC' },
  });
  // ArticuloRC no tiene clave natural única: se busca por nombre+familia y, si no, se crea.
  const articulo =
    (await prisma.articuloRC.findFirst({
      where: { nombre: 'DEMO 3 procesos', idFamiliaArticulo: familia.id },
    })) ??
    (await prisma.articuloRC.create({
      data: { nombre: 'DEMO 3 procesos', idFamiliaArticulo: familia.id },
    }));
  const tela = await prisma.duracionPorTipoTela.upsert({
    where: { nombre: 'DEMO Nacional' },
    update: {},
    create: { nombre: 'DEMO Nacional', dias: 5, factorTela: 1 },
  });
  const aplic = await prisma.duracionPorAplicacion.upsert({
    where: { nombre: 'DEMO Sin Aplicacion' },
    update: {},
    create: { nombre: 'DEMO Sin Aplicacion', dias: 0 },
  });
  await prisma.factorCantidad.createMany({
    data: [{ deCant: 1, aCant: 500, factor: 1 }],
    skipDuplicates: true,
  });

  // Procesos (fija) en cadena a(2) → b(3) → c(1, último).
  const a = await prisma.procesoDef.upsert({
    where: { codigo: 'demo-a' },
    update: {},
    create: { codigo: 'demo-a', nombre: 'DEMO A', tipoDuracion: 'fija' },
  });
  const b = await prisma.procesoDef.upsert({
    where: { codigo: 'demo-b' },
    update: {},
    create: { codigo: 'demo-b', nombre: 'DEMO B', tipoDuracion: 'fija' },
  });
  const c = await prisma.procesoDef.upsert({
    where: { codigo: 'demo-c' },
    update: {},
    create: { codigo: 'demo-c', nombre: 'DEMO C', tipoDuracion: 'fija', ultimoProceso: true },
  });

  // Plantilla por artículo (se recrea limpia).
  await prisma.plantillaRuta.deleteMany({ where: { idArticuloRC: articulo.id } });
  const plantilla = await prisma.plantillaRuta.create({
    data: {
      nombre: 'DEMO plantilla 3 procesos',
      idArticuloRC: articulo.id,
      idFamiliaArticulo: familia.id,
    },
  });
  const ra = await prisma.plantillaRutaProceso.create({
    data: { idPlantillaRuta: plantilla.id, idProcesoDef: a.id, tiempoEstandar: 2, orden: 0 },
  });
  const rb = await prisma.plantillaRutaProceso.create({
    data: { idPlantillaRuta: plantilla.id, idProcesoDef: b.id, tiempoEstandar: 3, orden: 1 },
  });
  const rc = await prisma.plantillaRutaProceso.create({
    data: { idPlantillaRuta: plantilla.id, idProcesoDef: c.id, tiempoEstandar: 1, orden: 2 },
  });
  await prisma.plantillaRutaDep.createMany({
    data: [
      { idPlantillaRutaProceso: rb.id, idAntecesor: ra.id },
      { idPlantillaRutaProceso: rc.id, idAntecesor: rb.id },
    ],
  });

  // Orden demo (folio centinela; se recrea).
  const clienteNeg = await prisma.cliente.upsert({
    where: { nombre: 'Cliente Demo RC' },
    update: {},
    create: { nombre: 'Cliente Demo RC' },
  });
  const modelo = await prisma.modelo.upsert({
    where: { codigo: 'DEMO-RC-100' },
    update: {},
    create: { codigo: 'DEMO-RC-100', descripcion: 'Modelo demo RC' },
  });
  await prisma.orden.deleteMany({ where: { idEmpresa, folio: FOLIO_DEMO_RC } });
  const color = await prisma.color.upsert({
    where: { nombre: 'Demo RC Rojo' },
    update: {},
    create: { nombre: 'Demo RC Rojo' },
  });
  const talla = await prisma.talla.upsert({
    where: { etiqueta: 'DEMO-RC-CH' },
    update: {},
    create: { etiqueta: 'DEMO-RC-CH', orden: 1 },
  });
  const orden = await prisma.orden.create({
    data: {
      folio: FOLIO_DEMO_RC,
      idEmpresa,
      idModelo: modelo.id,
      idCliente: clienteNeg.id,
      estado: 'completa',
      lineas: {
        create: [{ idColor: color.id, tallas: { create: [{ idTalla: talla.id, cantidad: 300 }] } }],
      },
    },
  });

  // 1) Programar la RC (genera la ruta; el CPM lo corremos a mano porque pg-boss está inactivo).
  await generarRutaOrden(sesion, {
    idOrden: orden.id,
    idArticuloRC: articulo.id,
    fechaEntregaRC: new Date('2026-06-29T00:00:00Z'), // lunes
    idTipoTela: tela.id,
    idAplicacion: aplic.id,
  });
  await recalcularRutaOrden(orden.id, idEmpresa);
  await imprimirTabla(sesion, orden.id, 'PROGRAMADA (CPM corrido)');

  // 2) Capturar avance del primer proceso (demo-a).
  const renglones = await prisma.rutaOrden.findMany({
    where: { idOrden: orden.id },
    select: { id: true, idProcesoDef: true },
  });
  const idRutaA = renglones.find((r) => r.idProcesoDef === a.id)?.id;
  if (idRutaA !== undefined) {
    await completarProceso(sesion, idRutaA, new Date('2026-06-19T00:00:00Z'));
  }

  // 3) Re-programar con otra entrega (una semana después) y volver a correr el CPM.
  await generarRutaOrden(sesion, {
    idOrden: orden.id,
    idArticuloRC: articulo.id,
    fechaEntregaRC: new Date('2026-07-06T00:00:00Z'),
    idTipoTela: tela.id,
    idAplicacion: aplic.id,
  });
  await recalcularRutaOrden(orden.id, idEmpresa);
  await imprimirTabla(sesion, orden.id, 'RE-PROGRAMADA (entrega +1 semana, fecha real conservada)');

  console.log('\nListo. Compara la columna "inicio→fin (vigente)" con tu cálculo a mano.');
}

async function main(): Promise<void> {
  const prisma = crearClientePrisma(process.env.DATABASE_URL ?? '');
  try {
    await correr(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
