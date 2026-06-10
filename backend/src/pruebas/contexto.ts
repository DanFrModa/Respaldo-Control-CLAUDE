/**
 * Contexto de los tests de INTEGRACIÓN (`*.int.test.ts`).
 *
 * Los tests corren contra el Postgres efímero de testcontainers que levanta
 * `entorno-global.ts` (PLANMAESTRO §9.2: "integración contra Postgres
 * efímero" — JAMÁS contra la base compartida de desarrollo) con las
 * migraciones reales de `backend/prisma` aplicadas. Aquí viven el cliente y el
 * seed PROPIO de pruebas: cada archivo limpia la base y siembra exactamente
 * lo que necesita.
 */
import { CATALOGO_PERMISOS } from '../contrato/index.js';
import { crearClientePrisma, type Empresa, type PrismaClient } from '../datos/index.js';
import { inject } from 'vitest';

/** Cliente Prisma contra el Postgres efímero (uno por archivo de pruebas). */
export function clientePruebas(): PrismaClient {
  return crearClientePrisma(inject('urlBaseDatosPruebas'));
}

/**
 * Deja la base VACÍA (TRUNCATE de todas las tablas de la app, reiniciando
 * autoincrementales). Se corre en `beforeEach`: cada test parte de cero y
 * ningún test depende de los datos de otro.
 */
export async function limpiarBaseDatos(cliente: PrismaClient): Promise<void> {
  const tablas = await cliente.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tablas.length === 0) {
    return;
  }
  const lista = tablas.map((t) => `"${t.tablename}"`).join(', ');
  await cliente.$executeRawUnsafe(`TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`);
}

/** Siembra el catálogo de permisos de `src/contrato` en la tabla `permisos`. */
export async function sembrarPermisos(cliente: PrismaClient): Promise<void> {
  await cliente.permiso.createMany({
    data: CATALOGO_PERMISOS.map((permiso) => ({
      clave: permiso.clave,
      descripcion: permiso.descripcion,
      modulo: permiso.modulo,
    })),
    skipDuplicates: true,
  });
}

/** Crea una empresa de prueba activa. */
export async function crearEmpresaPrueba(
  cliente: PrismaClient,
  nombre = 'FR Moda de Prueba',
): Promise<Empresa> {
  return cliente.empresa.create({
    data: { nombre, paraIpt: true, paraEdr: true, favorita: false },
  });
}
