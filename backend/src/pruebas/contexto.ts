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
 *
 * ⚠️ `RESTART IDENTITY` **NO alcanza a todas las secuencias**: sólo reinicia las que son PROPIEDAD
 * de una columna de las tablas truncadas (las de `SERIAL`/`autoincrement()`). Una secuencia
 * INDEPENDIENTE —creada con `CREATE SEQUENCE` y consumida con `nextval()`, como
 * `numero_produccion_seq` (migración `20260707180000_r3_pedidos_salida_produccion`)— sobrevive
 * intacta y sigue creciendo durante TODA la corrida. Efecto: un valor que aislado sale `1` sale
 * `68` en la suite completa, y una prueba que lo dé por hecho pasa sola y falla en CI. Por eso aquí
 * se reinician TAMBIÉN, a mano. Es idempotente para las ya reiniciadas por el TRUNCATE.
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

  // Sólo las INDEPENDIENTES: las que no tienen dependencia `a`(uto) de una columna son justo las
  // que el `RESTART IDENTITY` no toca. Hoy es una (`numero_produccion_seq`) de 129; recorrerlas
  // todas sería añadir ~128 viajes a la base en CADA `beforeEach` sin ganar nada.
  const secuencias = await cliente.$queryRaw<{ nombre: string }[]>`
    SELECT c.relname AS nombre
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a'
    WHERE c.relkind = 'S' AND n.nspname = 'public' AND d.objid IS NULL
  `;
  for (const s of secuencias) {
    await cliente.$executeRawUnsafe(`ALTER SEQUENCE "${s.nombre}" RESTART`);
  }
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
