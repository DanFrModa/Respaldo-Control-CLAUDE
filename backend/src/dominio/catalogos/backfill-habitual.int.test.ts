import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';

/**
 * ⭐ V1-E3m (§Post-F9.82) — EL BACKFILL DEL HABITUAL, ejecutado **desde el archivo de migración**.
 *
 * POR QUÉ ASÍ Y NO CON EL SQL COPIADO AQUÍ: una prueba que reescribe la sentencia solo demuestra que
 * la copia de la prueba hace lo que la prueba cree. Esta LEE
 * `20260820120000_proveedor_del_material/migration.sql`, recorta su tercer bloque y lo corre tal
 * cual, así que si alguien afloja el `WHERE` en la migración, **este archivo se pone rojo**. Es la
 * única forma honesta de cubrir un backfill: cuando el suite arranca, la migración ya corrió sobre
 * una base vacía, y volver a correr ese `UPDATE` sobre datos sembrados es **idempotente** (marca
 * exactamente lo mismo que habría marcado el día del deploy).
 *
 * Lo que fija, y es un defecto que se coló en la primera vuelta de la etapa: el avío cuyo ÚNICO
 * proveedor está DADO DE BAJA **no** se marca. Marcarlo devolvía el atorón de Daniel del revés —el
 * renglón saldría comprable con un proveedor muerto (`candidatoHabitualAvio` conserva al inactivo a
 * propósito y `crearOC` no valida `activo`)—, en una migración que nadie va a deshacer.
 */
let cliente: PrismaClient;

/** El bloque 3 del archivo de migración (el backfill), tal cual está escrito en disco. */
function sqlDelBackfill(): string {
  const ruta = fileURLToPath(
    new URL(
      '../../../prisma/migrations/20260820120000_proveedor_del_material/migration.sql',
      import.meta.url,
    ),
  );
  const archivo = readFileSync(ruta, 'utf8');
  const marca = '-- ── 3. BACKFILL';
  const desde = archivo.indexOf(marca);
  // Si la marca desaparece, la prueba NO puede seguir "pasando" en silencio sobre nada.
  expect(desde, 'no se encontró el bloque 3 (BACKFILL) en el archivo de migración').toBeGreaterThan(
    -1,
  );
  const bloque = archivo.slice(desde);
  const sentencia = bloque.slice(bloque.indexOf('UPDATE'));
  expect(sentencia).toContain('UPDATE "avio_proveedor"');
  return sentencia;
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
});

describe('Backfill del proveedor HABITUAL (migración V1-E3m, §Post-F9.82)', () => {
  it('marca al ÚNICO proveedor ACTIVO, y NO toca al inactivo ni a los avíos con varios', async () => {
    const activo = await cliente.proveedor.create({ data: { nombre: 'Botones SA' } });
    const otroActivo = await cliente.proveedor.create({ data: { nombre: 'Hilos del Norte' } });
    const deBaja = await cliente.proveedor.create({
      data: { nombre: 'Cerrado hace años', activo: false },
    });

    // (a) un solo proveedor, ACTIVO → se marca.
    const soloActivo = await cliente.avio.create({
      data: { clave: 'BF-UNO', descripcion: 'Un solo proveedor activo' },
    });
    await cliente.avioProveedor.create({
      data: { idAvio: soloActivo.id, idProveedor: activo.id, precio: 3 },
    });

    // (b) 🔴 un solo proveedor, DADO DE BAJA → NO se marca (el defecto de la primera vuelta).
    const soloInactivo = await cliente.avio.create({
      data: { clave: 'BF-BAJA', descripcion: 'Un solo proveedor de baja' },
    });
    await cliente.avioProveedor.create({
      data: { idAvio: soloInactivo.id, idProveedor: deBaja.id, precio: 3 },
    });

    // (c) DOS proveedores → no se toca: ahí sí hay una decisión de negocio, y la toma una persona.
    const conDos = await cliente.avio.create({
      data: { clave: 'BF-DOS', descripcion: 'Dos proveedores' },
    });
    await cliente.avioProveedor.createMany({
      data: [
        { idAvio: conDos.id, idProveedor: activo.id, precio: 3 },
        { idAvio: conDos.id, idProveedor: otroActivo.id, precio: 9 },
      ],
    });

    // (d) un solo proveedor activo… pero YA marcado: el backfill es idempotente.
    const yaMarcado = await cliente.avio.create({
      data: { clave: 'BF-YA', descripcion: 'Ya venía marcado' },
    });
    await cliente.avioProveedor.create({
      data: { idAvio: yaMarcado.id, idProveedor: otroActivo.id, precio: 5, habitual: true },
    });

    await cliente.$executeRawUnsafe(sqlDelBackfill());

    const marcados = await cliente.avioProveedor.findMany({
      where: { habitual: true },
      select: { idAvio: true, idProveedor: true },
    });
    expect(marcados.map((f) => f.idAvio).sort((a, b) => a - b)).toEqual(
      [soloActivo.id, yaMarcado.id].sort((a, b) => a - b),
    );
    // Dicho por su nombre: el del proveedor de baja sigue SIN habitual, que es lo que lo deja salir
    // "sin proveedor" y hace que el comprador pueda desatorarlo desde la explosión.
    const delInactivo = await cliente.avioProveedor.findFirstOrThrow({
      where: { idAvio: soloInactivo.id },
    });
    expect(delInactivo.habitual).toBe(false);
  });

  it('no puede dejar DOS habituales en el mismo avío (el índice único parcial lo impide)', async () => {
    const a = await cliente.proveedor.create({ data: { nombre: 'A' } });
    const b = await cliente.proveedor.create({ data: { nombre: 'B' } });
    const avio = await cliente.avio.create({ data: { clave: 'BF-IDX', descripcion: 'Índice' } });
    await cliente.avioProveedor.create({
      data: { idAvio: avio.id, idProveedor: a.id, habitual: true },
    });
    // La base es la que sostiene "uno por avío", no la buena voluntad del dominio.
    await expect(
      cliente.avioProveedor.create({
        data: { idAvio: avio.id, idProveedor: b.id, habitual: true },
      }),
    ).rejects.toThrow();
  });
});
