/**
 * SEMBRADOR DE DATOS FICTICIOS PARA PROBAR INVENTARIOS (no es un ETL de migración).
 *
 * Daniel está probando inventarios en `prueba` y no tiene con qué: le faltan material, proveedores,
 * compras, recepciones y facturas. Esto le pone un juego completo de datos INVENTADOS, marcado con
 * el prefijo `DEMO-`, que se borra de un golpe cuando ya no haga falta.
 *
 * ## Cómo se corre (desde `backend/`, como todos los scripts de esta carpeta)
 *
 * ```bash
 * # 1) ENSAYO EN SECO — dice qué haría, sin escribir nada.
 * npx tsx --env-file=.env migracion/sembrar-demo-inventarios.ts -- --simular
 *
 * # 2) SEMBRAR (idempotente: correrlo dos veces no duplica nada).
 * npx tsx --env-file=.env migracion/sembrar-demo-inventarios.ts
 *
 * # 3) BORRAR todo lo sembrado (y sólo eso).
 * npx tsx --env-file=.env migracion/sembrar-demo-inventarios.ts -- --limpiar
 * ```
 *
 * ⚠️ **NUNCA `npm run`**: esos scripts no llevan `--env-file=.env` y arrancan sin `DATABASE_URL`
 * (ver `migracion/README.md`). Y esto escribe en la base a la que apunte tu `.env`: apunta a
 * `prueba`, nunca a producción.
 *
 * Banderas: `--simular` (alias `--dry-run`) · `--limpiar` · `--empresa=<id|nombre>` (por omisión la
 * empresa favorita) · `--cfdi-dir=<ruta>` (dónde escribir los XML ficticios; `--sin-cfdi` para no
 * escribirlos) · `--ayuda`.
 *
 * ## Las reglas que respeta (y por qué importan)
 *
 *  • **Todo por el DOMINIO (A1).** Ni un `prisma.create` de catálogo, OC o movimiento: se llaman los
 *    mismos servicios que la aplicación. La existencia es Σ de movimientos (D3): sembrar filas a
 *    pelo daría números que no cuadran con el motor, o sea una mentira que probar.
 *  • **Marcado y borrable.** Todo nace con el prefijo `DEMO-` y queda anotado en `mapeo_migracion`
 *    bajo `Demo:*`; `--limpiar` borra exactamente eso (ver `demo/limpiar.ts` para por qué eso no
 *    rompe D3, y qué pasa si alguien ya operó encima).
 *  • **Idempotente.** Cada cosa se anota al crearse; en la segunda corrida se reconoce y se salta.
 *  • **REGLA 0-B.** No toca, repara ni audita NADA de lo que ya exista en `prueba`: sólo agrega.
 *  • **Sin permisos nuevos, sin migración, sin semillas del sistema.** Usa el seed que ya está.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { Reporte } from './comun/reporte.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { contarDemo, limpiarDemoInventarios } from './demo/limpiar.js';
import { catalogoCfdiDemo } from './demo/sembrar.js';
import { sembrarDemoInventarios, type ResultadoSiembra } from './demo/sembrar.js';
import { totalCfdi } from './demo/cfdi.js';
import {
  ALMACENES_DEMO,
  AVIOS_DEMO,
  ORDENES_COMPRA_DEMO,
  PREFIJO_DEMO,
  PROVEEDORES_DEMO,
  TELAS_DEMO,
} from './demo/datos.js';
import { empresaPorDefecto } from './etl-terceros-saldos.js';

/** Lee un flag `--clave=valor` de argv (o null). */
function flag(clave: string): string | null {
  const pref = `--${clave}=`;
  const arg = process.argv.find((a) => a.startsWith(pref));
  return arg === undefined ? null : arg.slice(pref.length);
}

/** ¿Está presente un flag booleano? */
function bandera(clave: string): boolean {
  return process.argv.includes(`--${clave}`);
}

/** Carpeta por omisión de los XML ficticios (dentro del repo, como ejemplos versionados). */
export const DIR_CFDI_POR_OMISION = join('migracion', '__fixtures__', 'demo-cfdi');

const AYUDA = `
Sembrador de datos ficticios para probar INVENTARIOS.

  npx tsx --env-file=.env migracion/sembrar-demo-inventarios.ts [-- <banderas>]

  --simular, --dry-run   No escribe nada: dice qué se sembraría.
  --limpiar              Borra TODO lo sembrado por este script (y sólo eso).
  --empresa=<id|nombre>  Empresa de los documentos (por omisión, la favorita).
  --cfdi-dir=<ruta>      Dónde escribir los CFDI ficticios (por omisión ${DIR_CFDI_POR_OMISION}).
  --sin-cfdi             No escribe los CFDI ficticios.
  --ayuda                Esto.
`;

/** Imprime el plan de la siembra (lo que se haría), sin tocar la base. */
function imprimirPlan(): void {
  const porPlan = (p: string): number => ORDENES_COMPRA_DEMO.filter((o) => o.plan === p).length;
  console.log('Se sembraría (todo con el prefijo "%s"):', PREFIJO_DEMO);
  console.log(
    `  • ${String(PROVEEDORES_DEMO.length)} proveedores con RFC ficticio, régimen y días de crédito`,
  );
  console.log(`  • ${String(ALMACENES_DEMO.length)} almacenes (2 de telas + 2 de avíos)`);
  console.log(
    `  • ${String(TELAS_DEMO.length)} telas con ${String(
      TELAS_DEMO.reduce((a, t) => a + t.colores.length, 0),
    )} colores (${String(TELAS_DEMO.filter((t) => t.nombreComplemento !== null).length)} con complemento)`,
  );
  console.log(`  • ${String(AVIOS_DEMO.length)} avíos`);
  console.log(
    `  • ${String(ORDENES_COMPRA_DEMO.length)} órdenes de compra: ${String(porPlan('completa'))} recibidas ` +
      `completas, ${String(porPlan('parcial'))} parciales, ${String(porPlan('ninguna'))} autorizadas sin ` +
      `recibir y ${String(porPlan('borrador'))} en borrador`,
  );
  console.log('  • conteo físico inicial + 3 traspasos + 1 merma (kardex en los dos sentidos)');
  for (const c of catalogoCfdiDemo()) {
    console.log(`  • CFDI ${c.archivo} — total ${totalCfdi(c).toFixed(2)} — ${c.nota}`);
  }
}

/** Imprime el resumen de una siembra. */
function imprimirResumen(r: ResultadoSiembra): void {
  console.log('');
  console.log('── Sembrado ──────────────────────────────────────────────────');
  console.log(`  Proveedores .......... ${String(r.proveedores)}`);
  console.log(`  Almacenes ............ ${String(r.almacenes)}`);
  console.log(`  Telas / colores ...... ${String(r.telas)} / ${String(r.coloresTela)}`);
  console.log(`  Avíos ................ ${String(r.avios)}`);
  console.log(`  Órdenes de compra .... ${String(r.ordenesCompra)}`);
  console.log(`  Entradas de tela ..... ${String(r.entradasTela)}`);
  console.log(`  Recepciones .......... ${String(r.recepciones)}`);
  console.log(`  Movimientos sueltos .. ${String(r.movimientos)}`);
  console.log(`  CFDI escritos ........ ${String(r.cfdiEscritos)}`);
  console.log(`  Ya existían .......... ${String(r.existentes)} (idempotencia: no se duplicaron)`);
  console.log(r.reporte.aTexto());
}

/** Corre el sembrador contra `cliente` (expuesto para las pruebas). */
export async function ejecutar(cliente: PrismaClient): Promise<number> {
  if (bandera('ayuda') || bandera('help')) {
    console.log(AYUDA);
    return 0;
  }

  const simular = bandera('simular') || bandera('dry-run');
  const limpiar = bandera('limpiar');

  if (limpiar) {
    const hay = await contarDemo(cliente);
    const total = Object.values(hay).reduce((a, b) => a + b, 0);
    console.log('Datos ficticios anotados hoy:', JSON.stringify(hay));
    if (total === 0) {
      console.log('No hay nada que limpiar.');
      return 0;
    }
    if (simular) {
      console.log('ENSAYO EN SECO (--simular): no se borró nada.');
      return 0;
    }
    try {
      const borrado = await limpiarDemoInventarios(cliente);
      console.log('Borrado:', JSON.stringify(borrado, null, 2));
      console.log('Listo: la base quedó como antes de sembrar (la bitácora se conserva, A7).');
      return 0;
    } catch (error) {
      console.error(
        '\n🔴 NO SE BORRÓ NADA (la transacción se revirtió entera).\n' +
          'Lo más probable: alguien ya OPERÓ encima de los datos ficticios (una nota de salida, un\n' +
          'conteo cíclico, un pago aplicado, una orden que consumió la tela…) y la base lo protege.\n' +
          'Cancela o revierte esos documentos desde la aplicación y vuelve a intentarlo.\n',
      );
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  const idEmpresa = await empresaPorDefecto(cliente, flag('empresa'));
  const sesion = sesionEtl(idEmpresa);

  console.log(`Sembrador de datos ficticios de INVENTARIOS — empresa ${String(idEmpresa)}`);
  if (simular) {
    imprimirPlan();
    const r = await sembrarDemoInventarios(cliente, sesion, {
      idEmpresa,
      dirCfdi: null,
      simular: true,
    });
    console.log(r.reporte.aTexto());
    return 0;
  }

  const dirCfdi = bandera('sin-cfdi') ? null : (flag('cfdi-dir') ?? DIR_CFDI_POR_OMISION);
  const resultado = await sembrarDemoInventarios(cliente, sesion, {
    idEmpresa,
    dirCfdi,
    simular: false,
  });
  imprimirResumen(resultado);
  console.log('');
  console.log('Para borrarlo todo:');
  console.log('  npx tsx --env-file=.env migracion/sembrar-demo-inventarios.ts -- --limpiar');
  return 0;
}

/** Punto de entrada (sólo cuando se ejecuta como script, no al importarlo desde una prueba). */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example). ¿Corriste con --env-file=.env?');
    process.exit(1);
  }
  const cliente = crearClientePrisma(url, {
    transactionOptions: { maxWait: 20_000, timeout: 120_000 },
    poolMax: 12,
    pool: { keepAlive: true, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 30_000 },
  });
  ejecutar(cliente)
    .then(async (codigo) => {
      await cliente.$disconnect();
      process.exit(codigo);
    })
    .catch(async (error: unknown) => {
      console.error(error);
      await cliente.$disconnect();
      process.exit(1);
    });
}

/** Reporte vacío re-exportado para que las pruebas no tengan que importarlo aparte. */
export { Reporte };
