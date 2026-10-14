/**
 * ⭐ Fila 0.238 — la migración `20261014130000_la_llave_de_comentar` contra Postgres real.
 *
 * Daniel, sobre Aurora: *«las listas negociar solo de lectura y poder agregar comentarios, pero no
 * modificar lo que yo hice»*. La 0.238 crea `listas.comentar` y el seed se la da a «Gerente de
 * Ventas»; pero ese perfil es del dueño y el seed lo SALTA cuando ya existe con permisos (como en
 * `prueba`). La migración se la lleva sin paso manual. Se mide:
 *
 *  (a) sobre una base como `prueba` (catálogo sin `listas.comentar`, «Gerente de Ventas» ya sembrado
 *      y SIN la llave): crea la llave y se la da a «Gerente de Ventas» y a NADIE más; deja una
 *      bitácora sin usuario;
 *  (b) correrla dos veces no duplica, no falla y no deja una segunda bitácora;
 *  (c) base NUEVA (CI, producción): corre antes del seed ⇒ cero filas; luego el seed la reparte;
 *  (d) un «Gerente de Ventas» CASCARÓN (cero permisos) NO se toca: lo llena entero el seed;
 *  (e) el seed que corre DESPUÉS la conserva y deja descripción y módulo iguales al catálogo.
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

const MIGRACION = '20261014130000_la_llave_de_comentar';
const PERFIL = 'Gerente de Ventas';

const SQL_DE_LA_MIGRACION = readFileSync(
  fileURLToPath(new URL(`../../prisma/migrations/${MIGRACION}/migration.sql`, import.meta.url)),
  'utf8',
);

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

async function bitacoraDeLaMigracion() {
  return prisma.bitacora.findMany({
    where: { entidad: 'Rol', datos: { path: ['migracion'], equals: MIGRACION } },
    orderBy: { id: 'asc' },
  });
}

/** Deja la base como `prueba` ANTES de la 0.238: todo sembrado, pero SIN `listas.comentar`. */
async function sembrarComoPrueba(): Promise<void> {
  await sembrar(prisma);
  await prisma.rolPermiso.deleteMany({ where: { permiso: { clave: 'listas.comentar' } } });
  await prisma.permiso.delete({ where: { clave: 'listas.comentar' } });
}

describe('⭐ migración de la fila 0.238: `listas.comentar` a «Gerente de Ventas», y a nadie más', () => {
  it('(a) crea la llave y se la da SÓLO a «Gerente de Ventas», con bitácora sin usuario', async () => {
    await sembrarComoPrueba();
    // Sanidad del escenario: el perfil existe CON permisos (si no, la prueba no prueba nada).
    const perfil = await prisma.rol.findUniqueOrThrow({
      where: { nombre: PERFIL },
      select: { id: true, _count: { select: { permisos: true } } },
    });
    expect(perfil._count.permisos).toBeGreaterThan(0);
    const antes = await prisma.rolPermiso.count();

    await correrMigracion();

    const llave = await prisma.permiso.findUniqueOrThrow({ where: { clave: 'listas.comentar' } });
    expect(llave.modulo).toBe('listas');
    expect(await rolesCon('listas.comentar')).toEqual([PERFIL]);
    expect(await prisma.rolPermiso.count()).toBe(antes + 1);

    const bitacora = await bitacoraDeLaMigracion();
    expect(bitacora).toHaveLength(1);
    expect(bitacora[0]!.idEntidad).toBe(String(perfil.id));
    expect(bitacora[0]!.accion).toBe('MODIFICAR');
    expect(bitacora[0]!.idUsuario, 'la hizo la migración, no una persona').toBeNull();
    expect(bitacora[0]!.datos).toMatchObject({
      operacion: 'agregarPermisos',
      nombre: PERFIL,
      clavesAgregadas: ['listas.comentar'],
    });
  });

  it('(b) correrla dos veces no duplica, no falla y no deja una segunda bitácora', async () => {
    await sembrarComoPrueba();
    await correrMigracion();
    const permisosTrasUna = await prisma.rolPermiso.count();
    const llavesTrasUna = await prisma.permiso.count();

    await expect(correrMigracion()).resolves.toBe(0);
    expect(await prisma.rolPermiso.count()).toBe(permisosTrasUna);
    expect(await prisma.permiso.count()).toBe(llavesTrasUna);
    expect(await bitacoraDeLaMigracion()).toHaveLength(1);
  });

  it('(c) base NUEVA: sin catálogo no crea nada; luego el seed la reparte', async () => {
    await expect(correrMigracion()).resolves.toBe(0);
    expect(await prisma.permiso.count()).toBe(0);
    expect(await prisma.rolPermiso.count()).toBe(0);
    expect(await bitacoraDeLaMigracion()).toEqual([]);

    await sembrar(prisma);
    expect(await rolesCon('listas.comentar')).toContain(PERFIL);
  });

  it('(d) un «Gerente de Ventas» CASCARÓN (cero permisos) no se toca: lo llena el seed entero', async () => {
    await sembrarComoPrueba();
    const perfil = await prisma.rol.findUniqueOrThrow({ where: { nombre: PERFIL } });
    await prisma.rolPermiso.deleteMany({ where: { idRol: perfil.id } });

    await correrMigracion();

    expect(await prisma.rolPermiso.count({ where: { idRol: perfil.id } })).toBe(0);
    expect(await bitacoraDeLaMigracion()).toEqual([]);
  });

  it('(e) el seed que corre después la CONSERVA y deja la llave igual al catálogo', async () => {
    await sembrarComoPrueba();
    await correrMigracion();

    await sembrar(prisma);

    expect(await rolesCon('listas.comentar')).toContain(PERFIL);
    const llave = await prisma.permiso.findUniqueOrThrow({ where: { clave: 'listas.comentar' } });
    const delCatalogo = CATALOGO_PERMISOS.find((p) => p.clave === 'listas.comentar');
    expect(llave.descripcion).toBe(delCatalogo?.descripcion);
    expect(llave.modulo).toBe(delCatalogo?.modulo);
  });
});
