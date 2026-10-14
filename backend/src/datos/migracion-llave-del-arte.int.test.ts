/**
 * ⭐ Fila 0.235 — la migración `20261014140000_la_llave_del_arte` contra Postgres real.
 *
 * La 0.235 partió el ARTE de `modelos.administrar` (que abre además la ficha, las telas y los avíos)
 * y de `desarrollo.administrar` (fotos de arte de la orden): nace `modelos.arte`. Daniel, sobre
 * Diseño Gráfico: *«desarrolla todos los artes, define quién es el proveedor y cotiza cuánto cuesta
 * cada uno»*. El perfil de puesto «Diseño Gráfico» es del DUEÑO: el seed lo crea-si-no-existe y en
 * `prueba` ya existe ⇒ el seed lo salta, y la llave le llega por esta migración. Se mide:
 *
 *  (a) sobre una base como `prueba` (catálogo sin `modelos.arte`, y Diseño Gráfico con las llaves
 *      completas que Daniel le abrió «en lo que se construye» y SIN `tipos-proceso.ver`): crea la
 *      llave con la descripción del catálogo y le da a «Diseño Gráfico» las DOS —`modelos.arte` y
 *      `tipos-proceso.ver`, sin la cual no se llena el selector de tipo del diálogo de arte— y a
 *      NADIE más —ni a «Diseño Grafico» sin acento, el rol de la Ruta Crítica—; NO le quita
 *      `modelos.administrar` ni `desarrollo.administrar`; deja UNA bitácora sin usuario;
 *  (b) correrla dos veces no duplica, no falla y no deja una segunda bitácora;
 *  (c) base NUEVA (CI, producción): corre antes del seed ⇒ cero filas, no crea la llave; luego el
 *      seed la siembra en Diseño Gráfico y en los roles de sistema que la declaran;
 *  (d) un «Diseño Gráfico» VACÍO (cascarón) NO se toca: el seed lo llena entero después;
 *  (e) el seed que corre DESPUÉS la conserva (el perfil del dueño no se re-sincroniza) y deja la
 *      llave igual al catálogo;
 *  (f) si Daniel ya le había dado `tipos-proceso.ver` en pantalla, sólo se agrega `modelos.arte` y
 *      la bitácora dice SÓLO lo que de verdad se agregó.
 *
 * El SQL se lee del archivo de la migración y se corre TAL CUAL (mismo patrón que
 * `migracion-llave-de-ventas.int.test.ts`): probar una copia sería probar otra cosa.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { sembrar } from '../../prisma/seed.js';
import { CATALOGO_PERMISOS } from '../contrato/index.js';
import { limpiarBaseDatos } from '../pruebas/contexto.js';
import { crearClientePrisma, type PrismaClient } from './index.js';

const MIGRACION = '20261014140000_la_llave_del_arte';

const SQL_DE_LA_MIGRACION = readFileSync(
  fileURLToPath(new URL(`../../prisma/migrations/${MIGRACION}/migration.sql`, import.meta.url)),
  'utf8',
);

const GRAFICO = 'Diseño Gráfico';
/** El rol funcional de la Ruta Crítica: se distingue SÓLO por el acento y es OTRA fila. */
const GRAFICO_RC = 'Diseño Grafico';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = crearClientePrisma(inject('urlBaseDatosPruebas'));
});

beforeEach(async () => {
  await limpiarBaseDatos(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const correrMigracion = (): Promise<number> => prisma.$executeRawUnsafe(SQL_DE_LA_MIGRACION);

/** Nombres (ordenados) de los roles que llevan `clave`. */
async function rolesCon(clave: string): Promise<string[]> {
  const filas = await prisma.rolPermiso.findMany({
    where: { permiso: { clave } },
    select: { rol: { select: { nombre: true } } },
  });
  return filas.map((f) => f.rol.nombre).sort();
}

/** Las claves (ordenadas) que lleva un rol. */
async function clavesDe(nombre: string): Promise<string[]> {
  const filas = await prisma.rolPermiso.findMany({
    where: { rol: { nombre } },
    select: { permiso: { select: { clave: true } } },
  });
  return filas.map((f) => f.permiso.clave).sort();
}

async function bitacoraDeLaMigracion() {
  return prisma.bitacora.findMany({
    where: { entidad: 'Rol', datos: { path: ['migracion'], equals: MIGRACION } },
    orderBy: { id: 'asc' },
  });
}

async function darLlaves(nombreRol: string, claves: string[]): Promise<void> {
  const rol = await prisma.rol.findUniqueOrThrow({ where: { nombre: nombreRol } });
  const permisos = await prisma.permiso.findMany({ where: { clave: { in: claves } } });
  await prisma.rolPermiso.createMany({
    data: permisos.map((p) => ({ idRol: rol.id, idPermiso: p.id })),
    skipDuplicates: true,
  });
}

async function quitarLlave(nombreRol: string, clave: string): Promise<void> {
  await prisma.rolPermiso.deleteMany({ where: { rol: { nombre: nombreRol }, permiso: { clave } } });
}

/**
 * Deja la base como `prueba` ANTES de la 0.235: catálogo y roles sembrados SIN `modelos.arte` (ni la
 * fila del permiso ni ninguna asignación); «Diseño Gráfico» con las dos llaves completas que Daniel le
 * abrió en pantalla (§Post-F9.250(b)); y el rol de la RC «Diseño Grafico» (sin acento) con un permiso,
 * para que el nombre exacto sea lo que decide y no el «tiene permisos».
 */
async function sembrarComoPrueba(): Promise<void> {
  await sembrar(prisma);
  await prisma.rolPermiso.deleteMany({ where: { permiso: { clave: 'modelos.arte' } } });
  await prisma.permiso.delete({ where: { clave: 'modelos.arte' } });
  // En `prueba` el perfil nació ANTES de la 0.235: tampoco lleva `tipos-proceso.ver`.
  await quitarLlave(GRAFICO, 'tipos-proceso.ver');
  await darLlaves(GRAFICO, ['modelos.administrar', 'desarrollo.administrar']);
  await prisma.rol.upsert({
    where: { nombre: GRAFICO_RC },
    update: {},
    create: { nombre: GRAFICO_RC, descripcion: 'Rol funcional de la RC', esSistema: false },
  });
  await darLlaves(GRAFICO_RC, ['ordenes.ver']);
}

describe('⭐ migración de la fila 0.235: `modelos.arte` a «Diseño Gráfico», y a nadie más', () => {
  it('(a) crea la llave y le da las DOS SÓLO a «Diseño Gráfico», sin quitarle nada', async () => {
    await sembrarComoPrueba();
    // Sanidad del escenario: nadie la tiene y Diseño Gráfico lleva las dos completas.
    expect(await rolesCon('modelos.arte')).toEqual([]);
    const antesGrafico = await clavesDe(GRAFICO);
    expect(antesGrafico).toContain('modelos.administrar');
    expect(antesGrafico).toContain('desarrollo.administrar');
    expect(antesGrafico).not.toContain('tipos-proceso.ver');
    const conTipos = await rolesCon('tipos-proceso.ver');
    const antes = await prisma.rolPermiso.count();

    await correrMigracion();

    const llave = await prisma.permiso.findUniqueOrThrow({ where: { clave: 'modelos.arte' } });
    const delCatalogo = CATALOGO_PERMISOS.find((p) => p.clave === 'modelos.arte');
    expect(llave.modulo).toBe('modelos');
    expect(llave.descripcion, 'la migración tiene que escribir el texto del catálogo').toBe(
      delCatalogo?.descripcion,
    );
    expect(await rolesCon('modelos.arte')).toEqual([GRAFICO]);
    expect(await rolesCon('modelos.arte')).not.toContain(GRAFICO_RC);
    // `tipos-proceso.ver`: a Diseño Gráfico y a nadie más que no la tuviera ya.
    expect(await rolesCon('tipos-proceso.ver')).toEqual([...conTipos, GRAFICO].sort());
    // Sólo AGREGÓ: dos pares, nada más, y no le quitó nada a Diseño Gráfico.
    expect(await prisma.rolPermiso.count()).toBe(antes + 2);
    expect(await clavesDe(GRAFICO)).toEqual(
      [...antesGrafico, 'modelos.arte', 'tipos-proceso.ver'].sort(),
    );

    // Rastro (A7): una entrada, sin usuario, con la clave y el motivo.
    const bitacora = await bitacoraDeLaMigracion();
    expect(bitacora).toHaveLength(1);
    expect(bitacora[0]?.accion).toBe('MODIFICAR');
    expect(bitacora[0]?.idUsuario, 'la hizo la migración, no una persona').toBeNull();
    expect(bitacora[0]?.datos).toMatchObject({
      operacion: 'agregarPermisos',
      nombre: GRAFICO,
      clavesAgregadas: ['modelos.arte', 'tipos-proceso.ver'],
    });
  });

  it('(b) correrla dos veces no duplica, no falla y no deja una segunda bitácora', async () => {
    await sembrarComoPrueba();
    await correrMigracion();
    const permisosTrasUna = await prisma.rolPermiso.count();
    const llavesTrasUna = await prisma.permiso.count();
    expect(await bitacoraDeLaMigracion()).toHaveLength(1);

    await expect(correrMigracion()).resolves.toBe(0);
    expect(await prisma.rolPermiso.count()).toBe(permisosTrasUna);
    expect(await prisma.permiso.count()).toBe(llavesTrasUna);
    expect(await bitacoraDeLaMigracion()).toHaveLength(1);
  });

  it('(c) base NUEVA: sin catálogo no crea nada; luego el seed la siembra donde se declaró', async () => {
    await expect(correrMigracion()).resolves.toBe(0);
    expect(await prisma.permiso.count()).toBe(0);
    expect(await prisma.rolPermiso.count()).toBe(0);
    expect(await bitacoraDeLaMigracion()).toEqual([]);

    await sembrar(prisma);
    expect(await rolesCon('modelos.arte')).toEqual(
      [
        'AdministracionDireccion',
        'Administrador',
        'Directivo',
        'Director General',
        'Gerencial',
        GRAFICO,
      ].sort(),
    );
  });

  it('(d) un «Diseño Gráfico» VACÍO no se toca: el seed lo llena ENTERO después', async () => {
    await sembrar(prisma);
    await prisma.rolPermiso.deleteMany({ where: { permiso: { clave: 'modelos.arte' } } });
    await prisma.permiso.delete({ where: { clave: 'modelos.arte' } });
    const grafico = await prisma.rol.findUniqueOrThrow({ where: { nombre: GRAFICO } });
    await prisma.rolPermiso.deleteMany({ where: { idRol: grafico.id } });

    await correrMigracion();
    expect(await clavesDe(GRAFICO), 'el cascarón no se toca').toEqual([]);
    expect(await bitacoraDeLaMigracion()).toEqual([]);

    await sembrar(prisma);
    expect(await clavesDe(GRAFICO)).toEqual(
      [
        'modelos.arte',
        'modelos.ver',
        'ordenes.ver',
        'proveedores.modificar',
        'proveedores.ver',
        'tipos-proceso.ver',
      ].sort(),
    );
  });

  it('(e) el seed que corre después la CONSERVA y deja la llave igual al catálogo', async () => {
    await sembrarComoPrueba();
    await correrMigracion();
    const tras = await clavesDe(GRAFICO);

    await sembrar(prisma);

    expect(await clavesDe(GRAFICO), 'el seed pisó el perfil del dueño').toEqual(tras);
    expect(await rolesCon('modelos.arte')).toContain(GRAFICO);
    const llave = await prisma.permiso.findUniqueOrThrow({ where: { clave: 'modelos.arte' } });
    const delCatalogo = CATALOGO_PERMISOS.find((p) => p.clave === 'modelos.arte');
    expect(llave.descripcion).toBe(delCatalogo?.descripcion);
    expect(llave.modulo).toBe(delCatalogo?.modulo);
  });

  it('(f) si ya llevaba `tipos-proceso.ver`, sólo agrega `modelos.arte` y la bitácora dice sólo eso', async () => {
    await sembrarComoPrueba();
    await darLlaves(GRAFICO, ['tipos-proceso.ver']);
    const antes = await prisma.rolPermiso.count();

    await correrMigracion();

    expect(await prisma.rolPermiso.count()).toBe(antes + 1);
    const bitacora = await bitacoraDeLaMigracion();
    expect(bitacora).toHaveLength(1);
    expect(bitacora[0]?.datos).toMatchObject({ clavesAgregadas: ['modelos.arte'] });
  });
});
