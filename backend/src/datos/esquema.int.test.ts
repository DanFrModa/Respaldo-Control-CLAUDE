/**
 * Tests de integración de los constraints del esquema contra Postgres real:
 * unicidad de username (identidad del login) y de Secuencia por empresa+clave
 * (la base de los folios A3 — sin este constraint los folios podrían duplicarse).
 *
 * Corren contra el Postgres efímero de testcontainers (entorno-global.ts) y
 * limpian SOLO sus propios artefactos para no pisar a otras suites.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { crearClientePrisma, type PrismaClient } from './index.js';

const EMPRESA_TEST = 'test-empresa-esquema';

let prisma: PrismaClient;

async function limpiarArtefactos(): Promise<void> {
  // Orden por FKs (Restrict): primero secuencias, luego la empresa de prueba.
  await prisma.secuencia.deleteMany({ where: { empresa: { nombre: EMPRESA_TEST } } });
  await prisma.empresa.deleteMany({ where: { nombre: EMPRESA_TEST } });
  await prisma.usuario.deleteMany({ where: { username: { startsWith: 'test-dup' } } });
}

beforeAll(async () => {
  prisma = crearClientePrisma(inject('urlBaseDatosPruebas'));
  await limpiarArtefactos();
});

afterAll(async () => {
  await limpiarArtefactos();
  await prisma.$disconnect();
});

describe('constraints del esquema', () => {
  it('rechaza dos usuarios con el mismo username (P2002)', async () => {
    await prisma.usuario.create({
      data: { username: 'test-dup', nombre: 'Prueba', email: 'test-dup@control.local' },
    });
    await expect(
      prisma.usuario.create({
        data: { username: 'test-dup', nombre: 'Otra', email: 'test-dup-2@control.local' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rechaza dos secuencias con la misma empresa+clave y permite claves distintas (A3)', async () => {
    const empresa = await prisma.empresa.create({
      data: { nombre: EMPRESA_TEST, paraIpt: false, paraEdr: false },
    });

    await prisma.secuencia.create({ data: { idEmpresa: empresa.id, clave: 'pedido' } });
    await expect(
      prisma.secuencia.create({ data: { idEmpresa: empresa.id, clave: 'pedido' } }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Misma empresa con otra clave sí es válida (un contador por tipo de folio).
    const otra = await prisma.secuencia.create({
      data: { idEmpresa: empresa.id, clave: 'orden' },
    });
    expect(otra.valor).toBe(0n);
  });
});
