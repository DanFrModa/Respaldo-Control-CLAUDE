/**
 * ⭐ Fila 0.251 — la migración `20261006120000_la_llave_de_ventas` contra Postgres real.
 *
 * La 0.251 partió `edr.ver` (estado de resultados ENTERO) de la facturación por modelo: Ventas tiene
 * ahora su llave, `ventas.ver`. El código acepta cualquiera de las dos, así que nadie pierde la
 * pantalla; lo que hace la migración es que la llave nueva aparezca, en Administración › Roles, en
 * TODO rol que hoy lleva `edr.ver` —incluidos los que el dueño armó en pantalla, que el seed no
 * toca—, para que quitarle después el EDR a un rol no le quite la facturación. Se mide:
 *
 *  (a) sobre una base como `prueba` (catálogo sin `ventas.ver`): crea la llave y se la da a cada rol
 *      con `edr.ver` —los de sistema y uno armado a mano— y a NADIE más (Administración y Finanzas
 *      incluida: darla es de Daniel); deja una bitácora por rol;
 *  (b) correrla dos veces no duplica, no falla y no deja una segunda bitácora;
 *  (c) base NUEVA (CI, producción): corre antes del seed ⇒ cero filas, no crea la llave; luego el
 *      seed la siembra con el mismo reparto que `edr.ver`;
 *  (d) el seed que corre DESPUÉS la conserva (los roles de sistema la declaran; la sincronización no
 *      se la quita) y deja descripción y módulo iguales al catálogo.
 *
 * El SQL se lee del archivo de la migración y se corre TAL CUAL (mismo patrón que
 * `migracion-las-11-llaves.int.test.ts`): probar una copia sería probar otra cosa.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { sembrar } from '../../prisma/seed.js';
import { CATALOGO_PERMISOS } from '../contrato/index.js';
import { limpiarBaseDatos } from '../pruebas/contexto.js';
import { crearClientePrisma, type PrismaClient } from './index.js';

const MIGRACION = '20261006120000_la_llave_de_ventas';

const SQL_DE_LA_MIGRACION = readFileSync(
  fileURLToPath(new URL(`../../prisma/migrations/${MIGRACION}/migration.sql`, import.meta.url)),
  'utf8',
);

/** Un rol que el DUEÑO armó en pantalla con `edr.ver`: el seed no lo conoce ni lo toca. */
const ROL_A_MANO = 'Contabilidad externa';

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

/**
 * Deja la base como `prueba` ANTES de la 0.251: catálogo y roles sembrados, pero SIN `ventas.ver`
 * (ni la fila del permiso ni ninguna asignación), más un rol armado a mano con `edr.ver` y otro sin
 * ella.
 */
async function sembrarComoPrueba(): Promise<void> {
  await sembrar(prisma);
  await prisma.rolPermiso.deleteMany({ where: { permiso: { clave: 'ventas.ver' } } });
  await prisma.permiso.delete({ where: { clave: 'ventas.ver' } });

  const edrVer = await prisma.permiso.findUniqueOrThrow({ where: { clave: 'edr.ver' } });
  const ordenesVer = await prisma.permiso.findUniqueOrThrow({ where: { clave: 'ordenes.ver' } });
  await prisma.rol.create({
    data: {
      nombre: ROL_A_MANO,
      descripcion: 'Armado por el dueño en Administración › Roles',
      esSistema: false,
      permisos: { create: [{ idPermiso: edrVer.id }, { idPermiso: ordenesVer.id }] },
    },
  });
}

describe('⭐ migración de la fila 0.251: `ventas.ver` a quien ya tiene `edr.ver`, y a nadie más', () => {
  it('(a) crea la llave y se la da EXACTAMENTE a los roles con `edr.ver` — Administración y Finanzas no', async () => {
    await sembrarComoPrueba();
    const conEdr = await rolesCon('edr.ver');
    // Sanidad del escenario: hay roles de sistema Y el armado a mano; si no, la prueba no prueba.
    expect(conEdr).toContain(ROL_A_MANO);
    expect(conEdr).toContain('Directivo');
    expect(conEdr).not.toContain('Administración y Finanzas');
    const antes = await prisma.rolPermiso.count();

    await correrMigracion();

    const llave = await prisma.permiso.findUniqueOrThrow({ where: { clave: 'ventas.ver' } });
    expect(llave.modulo).toBe('ventas');
    expect(await rolesCon('ventas.ver'), 'el reparto tiene que ser el de `edr.ver`').toEqual(
      conEdr,
    );
    expect(await rolesCon('ventas.ver')).not.toContain('Administración y Finanzas');
    // Sólo AGREGÓ: un par por rol con `edr.ver`, nada más.
    expect(await prisma.rolPermiso.count()).toBe(antes + conEdr.length);

    // Rastro (A7): una entrada por rol al que se le agregó, sin usuario, con la clave y el motivo.
    const bitacora = await bitacoraDeLaMigracion();
    expect(bitacora.map((b) => (b.datos as { nombre: string }).nombre).sort()).toEqual(conEdr);
    for (const entrada of bitacora) {
      expect(entrada.accion).toBe('MODIFICAR');
      expect(entrada.idUsuario, 'la hizo la migración, no una persona').toBeNull();
      expect(entrada.datos).toMatchObject({
        operacion: 'agregarPermisos',
        clavesAgregadas: ['ventas.ver'],
      });
    }
  });

  it('(b) correrla dos veces no duplica, no falla y no deja una segunda bitácora', async () => {
    await sembrarComoPrueba();
    await correrMigracion();
    const permisosTrasUna = await prisma.rolPermiso.count();
    const llavesTrasUna = await prisma.permiso.count();
    const bitacoraTrasUna = (await bitacoraDeLaMigracion()).length;
    expect(bitacoraTrasUna).toBeGreaterThan(0);

    await expect(correrMigracion()).resolves.toBe(0);
    expect(await prisma.rolPermiso.count()).toBe(permisosTrasUna);
    expect(await prisma.permiso.count()).toBe(llavesTrasUna);
    expect(await bitacoraDeLaMigracion()).toHaveLength(bitacoraTrasUna);
  });

  it('(c) base NUEVA: sin catálogo no crea nada; luego el seed la reparte como `edr.ver`', async () => {
    await expect(correrMigracion()).resolves.toBe(0);
    expect(await prisma.permiso.count()).toBe(0);
    expect(await prisma.rolPermiso.count()).toBe(0);
    expect(await bitacoraDeLaMigracion()).toEqual([]);

    await sembrar(prisma);
    expect(await rolesCon('ventas.ver')).toEqual(await rolesCon('edr.ver'));
  });

  it('(d) el seed que corre después la CONSERVA y deja la llave igual al catálogo', async () => {
    await sembrarComoPrueba();
    await correrMigracion();
    const tras = await rolesCon('ventas.ver');

    await sembrar(prisma);

    expect(
      await rolesCon('ventas.ver'),
      'la sincronización de roles se la quitó a alguien',
    ).toEqual(tras);
    const llave = await prisma.permiso.findUniqueOrThrow({ where: { clave: 'ventas.ver' } });
    const delCatalogo = CATALOGO_PERMISOS.find((p) => p.clave === 'ventas.ver');
    expect(llave.descripcion).toBe(delCatalogo?.descripcion);
    expect(llave.modulo).toBe(delCatalogo?.modulo);
  });
});
