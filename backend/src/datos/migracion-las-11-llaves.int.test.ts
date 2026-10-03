/**
 * ⭐ Fila 0.250 — la migración `20261003120000_las_11_llaves_de_daniel` contra Postgres real.
 *
 * Esa migración existe porque el seed NO alcanza a `prueba`: los 15 perfiles de puesto se siembran
 * crear-si-no-existe y uno que ya tiene permisos no se vuelve a tocar (§Post-F9.258). Lo que se mide
 * aquí es su promesa entera, que es más fina que «agrega 11 llaves»:
 *
 *  (a) sobre roles ya sembrados SIN las 11, las agrega — y respeta lo que el dueño movió a mano: una
 *      llave ajena que él puso sigue, una que él quitó (y no es de las 11) sigue quitada;
 *  (b) correrla dos veces no duplica ni falla, ni deja una segunda bitácora;
 *  (c) en una base NUEVA (CI, producción) corre ANTES del seed, sin roles: cero filas, sin error, y
 *      después el seed los crea ya con las 11;
 *  (d) a un rol CASCARÓN (existe con cero permisos) no le mete nada — si lo hiciera, el seed lo
 *      vería «con permisos», lo saltaría y el puesto nacería con dos llaves en vez de su perfil.
 *
 * El SQL se lee del archivo de la migración y se corre TAL CUAL (mismo patrón que
 * `backfill-habitual.int.test.ts`): probar una copia sería probar otra cosa.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { PERFILES_DE_PUESTO, sembrar } from '../../prisma/seed.js';
import { limpiarBaseDatos } from '../pruebas/contexto.js';
import { crearClientePrisma, type PrismaClient } from './index.js';

const MIGRACION = '20261003120000_las_11_llaves_de_daniel';

const SQL_DE_LA_MIGRACION = readFileSync(
  fileURLToPath(new URL(`../../prisma/migrations/${MIGRACION}/migration.sql`, import.meta.url)),
  'utf8',
);

/**
 * Las 11 que Daniel aceptó (§Post-F9.260), escritas a mano: la contraparte independiente del
 * `VALUES` de la migración. Si alguien cambiara una llave allí, esto no se movería solo.
 */
const LAS_11: readonly { rol: string; clave: string }[] = [
  { rol: 'Encargado de Telas', clave: 'compras.ver' },
  { rol: 'Producción', clave: 'compras.ver' },
  { rol: 'Producción', clave: 'rc.bandeja-completa' },
  { rol: 'Supervisor de Calidad', clave: 'calidad.generar-auditorias' },
  { rol: 'Habilitaciones', clave: 'compras.recibir' },
  { rol: 'Habilitaciones', clave: 'compras.ver' },
  { rol: 'Líder de Calidad', clave: 'calidad.administrar-catalogo' },
  { rol: 'Gerente de Ventas', clave: 'clientes.administrar' },
  { rol: 'Compras', clave: 'proveedores.administrar' },
  { rol: 'Compras', clave: 'compras.cancelar' },
  { rol: 'Almacén de Producto Terminado', clave: 'produccion.empaque' },
];

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

async function clavesDe(nombreRol: string): Promise<string[]> {
  const filas = await prisma.rolPermiso.findMany({
    where: { rol: { nombre: nombreRol } },
    select: { permiso: { select: { clave: true } } },
  });
  return filas.map((f) => f.permiso.clave).sort();
}

async function quitar(nombreRol: string, clave: string): Promise<void> {
  const borradas = await prisma.rolPermiso.deleteMany({
    where: { rol: { nombre: nombreRol }, permiso: { clave } },
  });
  // Si no borró nada, el escenario no es el que la prueba cree estar armando.
  expect(borradas.count, `${nombreRol} no tenía ${clave} para quitársela`).toBe(1);
}

async function poner(nombreRol: string, clave: string): Promise<void> {
  const rol = await prisma.rol.findUniqueOrThrow({ where: { nombre: nombreRol } });
  const permiso = await prisma.permiso.findUniqueOrThrow({ where: { clave } });
  await prisma.rolPermiso.create({ data: { idRol: rol.id, idPermiso: permiso.id } });
}

async function bitacoraDeLaMigracion() {
  return prisma.bitacora.findMany({
    where: { entidad: 'Rol', datos: { path: ['migracion'], equals: MIGRACION } },
    orderBy: { id: 'asc' },
  });
}

/** Deja la base como `prueba`: perfiles ya sembrados, pero SIN las 11 (el seed de antes). */
async function sembrarComoPrueba(): Promise<void> {
  await sembrar(prisma);
  for (const { rol, clave } of LAS_11) await quitar(rol, clave);
}

describe('⭐ migración de la fila 0.250: las 11 llaves de Daniel sobre los roles que YA existen', () => {
  it('(a) agrega las 11 y respeta lo que el dueño movió a mano: la ajena sigue, la quitada sigue quitada', async () => {
    await sembrarComoPrueba();
    // Lo que Daniel pudo haber hecho en pantalla, y que la migración NO puede deshacer:
    await poner('Producción', 'almacenes.ver'); // una llave AJENA a las 11, agregada por él
    await quitar('Compras', 'notas.ver'); // una que él QUITÓ y no es de las 11
    // Y un rol al que ya le había dado la suya antes de la migración: no debe dejar bitácora.
    await poner('Encargado de Telas', 'compras.ver');

    const antes = await prisma.rolPermiso.count();
    const produccionAntes = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'Producción' } });

    await correrMigracion();

    for (const { rol, clave } of LAS_11) {
      expect(await clavesDe(rol), `${rol} tiene que llevar ${clave}`).toContain(clave);
    }
    expect(await clavesDe('Producción'), 'la llave ajena que él agregó').toContain('almacenes.ver');
    expect(await clavesDe('Compras'), 'la que él quitó sigue quitada').not.toContain('notas.ver');
    // Sólo AGREGÓ: 11 pares menos el de Telas, que ya estaba.
    expect(await prisma.rolPermiso.count()).toBe(antes + 10);
    // Y no tocó la fila del rol (ni nombre, ni descripción, ni su sello de modificación).
    const produccionDespues = await prisma.rol.findUniqueOrThrow({
      where: { nombre: 'Producción' },
    });
    expect(produccionDespues).toEqual(produccionAntes);

    // Rastro (A7): UNA entrada por rol al que efectivamente le agregó algo, con lo que agregó.
    const bitacora = await bitacoraDeLaMigracion();
    const porRol = Object.fromEntries(
      bitacora.map((b) => {
        const datos = b.datos as { nombre: string; clavesAgregadas: string[] };
        return [datos.nombre, datos.clavesAgregadas];
      }),
    );
    expect(porRol).toEqual({
      Producción: ['compras.ver', 'rc.bandeja-completa'],
      'Supervisor de Calidad': ['calidad.generar-auditorias'],
      Habilitaciones: ['compras.recibir', 'compras.ver'],
      'Líder de Calidad': ['calidad.administrar-catalogo'],
      'Gerente de Ventas': ['clientes.administrar'],
      Compras: ['compras.cancelar', 'proveedores.administrar'],
      'Almacén de Producto Terminado': ['produccion.empaque'],
    });
    expect(bitacora, 'Encargado de Telas ya la tenía: no hay nada que registrar').toHaveLength(7);
    for (const entrada of bitacora) {
      expect(entrada.accion).toBe('MODIFICAR');
      expect(entrada.idUsuario, 'la hizo la migración, no una persona').toBeNull();
      expect(entrada.datos).toMatchObject({
        operacion: 'agregarPermisos',
        motivo: 'fila 0.250 · decisiones de Daniel §Post-F9.260',
      });
    }
  });

  it('(b) correrla dos veces no duplica, no falla y no deja una segunda bitácora', async () => {
    await sembrarComoPrueba();
    await correrMigracion();
    const permisosTrasUna = await prisma.rolPermiso.count();
    const bitacoraTrasUna = (await bitacoraDeLaMigracion()).length;
    expect(bitacoraTrasUna).toBe(8);

    await expect(correrMigracion()).resolves.toBe(0);
    expect(await prisma.rolPermiso.count()).toBe(permisosTrasUna);
    expect(await bitacoraDeLaMigracion()).toHaveLength(bitacoraTrasUna);
  });

  it('(c) base NUEVA: corre antes del seed, sin roles ⇒ cero filas y sin error; luego el seed trae las 11', async () => {
    await expect(correrMigracion()).resolves.toBe(0);
    expect(await prisma.rolPermiso.count()).toBe(0);
    expect(await bitacoraDeLaMigracion()).toEqual([]);

    await sembrar(prisma);
    for (const { rol, clave } of LAS_11) {
      expect(await clavesDe(rol), `${rol} tiene que nacer con ${clave}`).toContain(clave);
    }
  });

  it('(d) a un rol CASCARÓN (cero permisos) no le mete nada: el seed lo llena ENTERO después', async () => {
    // «Habilitaciones» es la colisión con la Ruta Crítica: como rol de la RC nace vacío. Si la
    // migración le metiera sus dos llaves, el seed lo vería «con permisos» y lo saltaría.
    await sembrar(prisma);
    await prisma.rolPermiso.deleteMany({ where: { rol: { nombre: 'Habilitaciones' } } });

    await correrMigracion();
    expect(await clavesDe('Habilitaciones'), 'un cascarón no se toca').toEqual([]);

    await sembrar(prisma);
    const perfil = PERFILES_DE_PUESTO.find((p) => p.nombre === 'Habilitaciones');
    expect(await clavesDe('Habilitaciones')).toEqual([...(perfil?.permisos ?? [])].sort());
  });
});
