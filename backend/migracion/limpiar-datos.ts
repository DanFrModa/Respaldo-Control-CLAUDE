/**
 * LIMPIEZA TOTAL de la BD (recarga limitada por fecha — runbook en `migracion/README.md`).
 *
 * VACÍA todas las tablas del esquema `public` (TRUNCATE ... RESTART IDENTITY CASCADE) EXCEPTO
 * `_prisma_migrations` (el historial de migraciones NO se toca: la estructura queda intacta,
 * solo se van los DATOS). Las tablas se descubren en runtime vía `pg_tables` — NUNCA una lista
 * a mano (una tabla nueva de una fase futura no se puede quedar fuera en silencio).
 *
 * USO (desde `backend/`, como todos los ETL — ver README):
 *
 *   npx tsx --env-file=.env migracion/limpiar-datos.ts              ← ENSAYO: solo imprime qué HARÍA
 *   npx tsx --env-file=.env migracion/limpiar-datos.ts --confirmar  ← BORRA de verdad
 *
 * Sin `--confirmar` es un ENSAYO (dry-run): lista las tablas con sus conteos y sale sin tocar
 * nada. Con `--confirmar` trunca y muestra conteos antes/después. Al final SIEMPRE recuerda los
 * pasos manuales: re-seed (`SEED_ON_START=true`), password del admin y huérfanos de R2.
 *
 * ⚠️ Pensado para la BD de `prueba` (Railway). Es DESTRUCTIVO e irreversible: apunta la
 * `DATABASE_URL` del `.env` con cuidado.
 */
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

/** Tabla que NUNCA se trunca (historial de migraciones de Prisma: estructura, no datos). */
const TABLA_PROTEGIDA = '_prisma_migrations';

/** Nombre de tabla + conteo de filas. */
interface TablaConConteo {
  tabla: string;
  filas: number;
}

/** Descubre las tablas del esquema `public` (menos la protegida), en orden alfabético. */
async function descubrirTablas(cliente: PrismaClient): Promise<string[]> {
  const filas = await cliente.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> ${TABLA_PROTEGIDA}
    ORDER BY tablename
  `;
  return filas.map((f) => f.tablename);
}

/** Cita un identificador Postgres (comillas dobles escapadas) para el SQL dinámico del TRUNCATE. */
function citarIdent(nombre: string): string {
  return `"${nombre.replaceAll('"', '""')}"`;
}

/** Cuenta las filas de cada tabla (una a una: son ~decenas de tablas, no hace falta más). */
async function contarTablas(cliente: PrismaClient, tablas: string[]): Promise<TablaConConteo[]> {
  const resultado: TablaConConteo[] = [];
  for (const tabla of tablas) {
    const filas = await cliente.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM ${citarIdent(tabla)}`,
    );
    resultado.push({ tabla, filas: Number(filas[0]?.n ?? 0n) });
  }
  return resultado;
}

/** Imprime la tabla de conteos (solo con datos primero, vacías agregadas al final). */
function imprimirConteos(titulo: string, conteos: TablaConConteo[]): void {
  const conDatos = conteos.filter((c) => c.filas > 0);
  const vacias = conteos.length - conDatos.length;
  const total = conteos.reduce((suma, c) => suma + c.filas, 0);
  console.log(`\n${titulo}`);
  console.log(`${'Tabla'.padEnd(40)}${'Filas'.padStart(10)}`);
  console.log('─'.repeat(50));
  for (const c of conDatos) {
    console.log(`${c.tabla.padEnd(40)}${String(c.filas).padStart(10)}`);
  }
  console.log('─'.repeat(50));
  console.log(
    `${String(conteos.length)} tablas (${String(vacias)} ya vacías) · TOTAL ${String(total)} filas`,
  );
}

/** Punto de entrada del script. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const confirmar = process.argv.includes('--confirmar');

  const cliente = crearClientePrisma(url);
  try {
    const tablas = await descubrirTablas(cliente);
    if (tablas.length === 0) {
      console.log(
        'No hay tablas en el esquema public (¿migraciones sin aplicar?). Nada que hacer.',
      );
      return;
    }

    const antes = await contarTablas(cliente, tablas);
    imprimirConteos(
      confirmar
        ? 'Conteos ANTES de limpiar:'
        : `ENSAYO (sin --confirmar): esto es lo que se VACIARÍA (se conserva ${TABLA_PROTEGIDA}):`,
      antes,
    );

    if (!confirmar) {
      console.log(
        '\nNo se borró NADA. Para vaciar de verdad:\n' +
          '  npx tsx --env-file=.env migracion/limpiar-datos.ts --confirmar',
      );
      return;
    }

    // TRUNCATE de TODAS las tablas en una sola sentencia: RESTART IDENTITY reinicia las
    // secuencias/identity y CASCADE resuelve las FKs entre ellas (no hay que ordenarlas).
    console.log(`\nTRUNCATE de ${String(tablas.length)} tablas (RESTART IDENTITY CASCADE)…`);
    await cliente.$executeRawUnsafe(
      `TRUNCATE TABLE ${tablas.map(citarIdent).join(', ')} RESTART IDENTITY CASCADE`,
    );

    const despues = await contarTablas(cliente, tablas);
    imprimirConteos('Conteos DESPUÉS de limpiar (todo debe estar en 0):', despues);
    const sobran = despues.filter((c) => c.filas > 0);
    if (sobran.length > 0) {
      console.error(
        `⚠️ Quedaron tablas con filas tras el TRUNCATE (revisar): ${sobran.map((c) => c.tabla).join(', ')}`,
      );
    }

    console.log(
      '\n═══════════════════════════════════════════════════════════════\n' +
        ' BD VACIADA. Pasos manuales OBLIGATORIOS antes de recargar:\n' +
        '═══════════════════════════════════════════════════════════════\n' +
        ' (a) Reinicia el backend en Railway con SEED_ON_START=true para re-sembrar\n' +
        '     catálogos base, permisos, roles y el usuario admin (el TRUNCATE también\n' +
        '     los borró; sin el seed el login y los menús NO funcionan).\n' +
        ' (b) El usuario `admin` vuelve al password del seed — CÁMBIALO en cuanto entres.\n' +
        ' (c) Los objetos ya subidos a R2 (fotos de modelos/bordados/adjuntos) quedan\n' +
        '     HUÉRFANOS: sus registros en BD se borraron pero el archivo físico sigue en\n' +
        '     el bucket (limitación conocida: el motor de archivos no tiene DeleteObject;\n' +
        '     deuda técnica aparcada en HOJA-DE-RUTA.md §4). El ETL de fotos los re-liga\n' +
        '     al re-subir; los viejos solo ocupan espacio.\n' +
        ' (d) El esquema `pgboss` NO se tocó (solo se vació `public`): pueden quedar jobs\n' +
        '     de RC encolados apuntando a filas ya borradas. Los handlers son resilientes\n' +
        '     y los absorben, pero conviene saberlo — el reinicio del backend del paso (a)\n' +
        '     los deja drenarse en limpio.\n' +
        ' Después: corre los ETL en su orden documentado (ver README de migracion/),\n' +
        ' anteponiendo ETL_DESDE=YYYY-MM-DD si quieres la recarga limitada por fecha.',
    );
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
