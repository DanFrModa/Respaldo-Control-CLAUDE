/**
 * SEMBRADOR DE DATOS FICTICIOS PARA PROBAR FINANZAS (no es un ETL de migración).
 *
 * Daniel está probando Finanzas en `prueba` y no tiene con qué: le faltan terceros con saldo,
 * cuentas por pagar y por cobrar, pagos, antigüedad de saldos y facturas que cotejar. Esto le pone
 * un juego completo de datos INVENTADOS, marcado con el prefijo `DEMO-FIN`, que se borra de un
 * golpe cuando ya no haga falta.
 *
 * Es el **gemelo** de `sembrar-demo-inventarios.ts`, con su propio espacio de marcas
 * (`Demo:Fin:*` en vez de `Demo:*`): los dos se siembran y se limpian por separado, y correr
 * `--limpiar` de uno **jamás** toca lo del otro.
 *
 * ## Cómo se corre (desde `backend/`, como todos los scripts de esta carpeta)
 *
 * ```bash
 * # 1) ENSAYO EN SECO — dice qué haría, sin escribir nada.
 * npx tsx --env-file=.env migracion/sembrar-demo-finanzas.ts -- --simular
 *
 * # 2) SEMBRAR (idempotente: correrlo dos veces no duplica nada).
 * npx tsx --env-file=.env migracion/sembrar-demo-finanzas.ts
 *
 * # 3) BORRAR todo lo sembrado (y sólo eso).
 * npx tsx --env-file=.env migracion/sembrar-demo-finanzas.ts -- --limpiar
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
 * ## Qué queda sembrado (y para qué sirve cada cosa)
 *
 *  • **6 proveedores y 4 clientes** ficticios, con días de crédito distintos y las tres modalidades
 *    de facturación (siempre / nunca / de las dos formas).
 *  • **Cuenta corriente con movimientos de verdad**: cargos y abonos de CxP y de CxC, con saldos
 *    PARCIALES (ni cero ni el cargo entero) y uno CANCELADO con su inverso auditado.
 *  • **Antigüedad de saldos (aging) repartida**: las fechas nacen escalonadas hacia atrás para que
 *    caigan en las cuatro cubetas. Si todo naciera hoy, el reporte de aging saldría vacío.
 *  • **El fold de EsMa**: dos maquileros con abonos y descuentos, que salen DENTRO de su estado de
 *    cuenta de CxP.
 *  • **Tres corridas semanales de pago** (CON factura ejecutada, SIN factura ejecutada y una en
 *    borrador), con sus pagos reales y sus FOLIOS DE DOCUMENTO.
 *  • **Cotejo con sus cuatro estados**: una factura que cuadra, una en rojo sin atender (frena el
 *    pago), una en rojo ya atendida y una que no liga con ningún documento.
 *  • **6 CFDI ficticios en disco** para probar a mano las dos importaciones (proveedor y ventas),
 *    incluidos un emisor y un receptor que NO están en el catálogo.
 *
 * ## Las reglas que respeta (y por qué importan)
 *
 *  • **Todo por el DOMINIO (A1).** Ni un `prisma.create` de un catálogo, de un movimiento, de un
 *    pago o de una corrida: se llaman los mismos servicios que la aplicación. La razón no es
 *    estética: el saldo es Σ de movimientos (D3), el vencimiento lo deriva el motor, el folio del
 *    documento lo reparte la secuencia atómica y el veredicto del cotejo lo recalcula el dominio.
 *    Si esto insertara filas a pelo, las pantallas no cuadrarían con el motor — una mentira que
 *    probar.
 *  • **Marcado y borrable.** Todo nace con el prefijo `DEMO-FIN` y queda anotado en
 *    `mapeo_migracion` bajo `Demo:Fin:*`; `--limpiar` borra exactamente eso (ver
 *    `demo/finanzas/limpiar.ts` para por qué eso no rompe D3, y qué pasa si alguien ya operó
 *    encima).
 *  • **Idempotente.** Cada cosa se anota al crearse; en la segunda corrida se reconoce y se salta.
 *  • **REGLA 0-B.** No toca, repara ni audita NADA de lo que ya exista en `prueba`: sólo agrega.
 *  • **Sin permisos nuevos, sin migración, sin semillas del sistema.** Usa el seed que ya está.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { Reporte } from './comun/reporte.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { totalCfdi } from './demo/cfdi.js';
import { catalogoCfdiFinanzas } from './demo/finanzas/cfdi.js';
import {
  CLIENTES_DEMO_FIN,
  CONCEPTOS_DEMO_FIN,
  CORRIDAS_DEMO_FIN,
  FACTURAS_COTEJO_DEMO,
  MOVIMIENTOS_CXC_DEMO,
  MOVIMIENTOS_CXP_DEMO,
  MOVIMIENTOS_ESMA_DEMO,
  PREFIJO_DEMO_FIN,
  PROVEEDORES_DEMO_FIN,
} from './demo/finanzas/datos.js';
import type { InvasorFin } from './demo/finanzas/limpiar.js';
import {
  ErrorLimpiezaFinBloqueada,
  conjuntoFinVacio,
  detectarInvasoresFin,
  limpiarDemoFinanzas,
  planDeLimpiezaFin,
  reunirDemoFin,
} from './demo/finanzas/limpiar.js';
import {
  fechaDemo,
  sembrarDemoFinanzas,
  type ResultadoSiembraFinanzas,
} from './demo/finanzas/sembrar.js';
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
export const DIR_CFDI_FINANZAS_POR_OMISION = join(
  'migracion',
  '__fixtures__',
  'demo-cfdi-finanzas',
);

const AYUDA = `
Sembrador de datos ficticios para probar FINANZAS.

  npx tsx --env-file=.env migracion/sembrar-demo-finanzas.ts [-- <banderas>]

  --simular, --dry-run   No escribe nada: dice qué se sembraría.
  --limpiar              Borra TODO lo sembrado por este script (y sólo eso).
  --empresa=<id|nombre>  Empresa de los documentos (por omisión, la favorita).
  --cfdi-dir=<ruta>      Dónde escribir los CFDI ficticios (por omisión ${DIR_CFDI_FINANZAS_POR_OMISION}).
  --sin-cfdi             No escribe los CFDI ficticios.
  --ayuda                Esto.
`;

/** Imprime el plan de la siembra (lo que se haría), sin tocar la base. */
function imprimirPlan(): void {
  const maquileros = PROVEEDORES_DEMO_FIN.filter((p) =>
    p.roles.some((r) => r !== 'vende-telas' && r !== 'vende-avios' && r !== 'otros-servicios'),
  ).length;
  const cuentas = PROVEEDORES_DEMO_FIN.reduce((a, p) => a + p.cuentas.length, 0);
  const ejecutadas = CORRIDAS_DEMO_FIN.filter((c) => c.estado === 'ejecutada').length;
  const enRojo = FACTURAS_COTEJO_DEMO.filter(
    (f) => f.aplicaA === null || f.aplicaA.importe !== f.importe,
  ).length;
  console.log('Se sembraría (todo con el prefijo "%s"):', PREFIJO_DEMO_FIN.trim());
  console.log(
    `  • ${String(PROVEEDORES_DEMO_FIN.length)} proveedores (${String(maquileros)} maquileros, ` +
      `para ver el fold de EsMa) con ${String(cuentas)} cuentas de pago ficticias`,
  );
  console.log(
    `  • ${String(CLIENTES_DEMO_FIN.length)} clientes con días de crédito 0/30/45/60 (uno SIN RFC, a propósito)`,
  );
  console.log(
    `  • ${String(CONCEPTOS_DEMO_FIN.length)} conceptos de pago (ninguno predeterminado)`,
  );
  console.log(
    `  • ${String(MOVIMIENTOS_CXP_DEMO.length)} movimientos de CxP y ` +
      `${String(MOVIMIENTOS_CXC_DEMO.length)} de CxC, escalonados hacia atrás para repartir el aging`,
  );
  console.log(
    `  • ${String(MOVIMIENTOS_ESMA_DEMO.length)} movimientos de EsMa (abonos/descuentos de maquilero)`,
  );
  console.log(
    `  • ${String(CORRIDAS_DEMO_FIN.length)} corridas semanales de pago (${String(ejecutadas)} ejecutadas + 1 en borrador)`,
  );
  console.log(
    `  • ${String(FACTURAS_COTEJO_DEMO.length)} facturas sujetas a cotejo (${String(enRojo)} en ROJO: una sin atender, una atendida y una sin liga)`,
  );
  for (const c of catalogoCfdiFinanzas(fechaDemo)) {
    console.log(`  • CFDI ${c.archivo} — total ${totalCfdi(c).toFixed(2)} — ${c.nota}`);
  }
}

/** Imprime los estorbos que impiden limpiar, con qué hacer con cada uno. */
function imprimirInvasores(invasores: InvasorFin[]): void {
  console.error('');
  console.error('🔴 NO SE BORRÓ NADA: alguien ya operó encima de los datos ficticios.');
  console.error('   No se tocó NADA: ni lo ficticio ni, por supuesto, lo que capturaste encima.');
  for (const i of invasores) {
    console.error('');
    console.error(`── ${i.que} (${String(i.cuantos)}) ──`);
    console.error(
      `   ids: ${i.ejemplos.map(String).join(', ')}${i.cuantos > i.ejemplos.length ? ', …' : ''}`,
    );
    console.error(`   → ${i.comoSeArregla}`);
  }
  console.error('');
}

/** Imprime el resumen de una siembra. */
function imprimirResumen(r: ResultadoSiembraFinanzas): void {
  console.log('');
  console.log('── Sembrado ──────────────────────────────────────────────────');
  console.log(`  Proveedores .............. ${String(r.proveedores)}`);
  console.log(`  Cuentas de pago .......... ${String(r.cuentasPago)}`);
  console.log(`  Clientes ................. ${String(r.clientes)}`);
  console.log(`  Conceptos de pago ........ ${String(r.conceptosPago)}`);
  console.log(`  Movimientos de CxP ....... ${String(r.movimientosCxp)}`);
  console.log(`  Movimientos de CxC ....... ${String(r.movimientosCxc)}`);
  console.log(`  Movimientos de EsMa ...... ${String(r.movimientosEsMa)}`);
  console.log(`  Corridas / renglones ..... ${String(r.corridas)} / ${String(r.renglonesCorrida)}`);
  console.log(`  Facturas de cotejo ....... ${String(r.facturasCotejo)}`);
  console.log(`  Cotejos aplicados ........ ${String(r.cotejosAplicados)}`);
  console.log(`  CFDI escritos ............ ${String(r.cfdiEscritos)}`);
  console.log(
    `  Ya existían .............. ${String(r.existentes)} (idempotencia: no se duplicaron)`,
  );
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
    const conjunto = await reunirDemoFin(cliente);
    if (conjuntoFinVacio(conjunto)) {
      console.log('No hay nada que limpiar (el mapeo Demo:Fin:* está vacío).');
      return 0;
    }
    const invasores = await detectarInvasoresFin(cliente, conjunto);
    if (invasores.length > 0) {
      imprimirInvasores(invasores);
      return simular ? 0 : 1;
    }
    // El ensayo en seco enseña EXACTAMENTE lo que va a pasar, no un conteo aparte que después no
    // cuadra: eso daba falsa tranquilidad.
    console.log(
      'Se borraría exactamente esto:',
      JSON.stringify(await planDeLimpiezaFin(cliente, conjunto), null, 2),
    );
    if (simular) {
      console.log('ENSAYO EN SECO (--simular): no se borró nada. Nadie ha operado encima.');
      return 0;
    }
    try {
      const borrado = await limpiarDemoFinanzas(cliente);
      console.log('Borrado:', JSON.stringify(borrado, null, 2));
      console.log(
        'Listo: la base quedó como antes de sembrar Finanzas (la bitácora y los folios ya ' +
          'consumidos se conservan, A7/A3). Lo del sembrador de INVENTARIOS no se tocó.',
      );
      return 0;
    } catch (error) {
      if (error instanceof ErrorLimpiezaFinBloqueada) {
        imprimirInvasores(error.invasores);
        return 1;
      }
      console.error('\n🔴 NO SE BORRÓ NADA (la transacción se revirtió entera).\n');
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  const idEmpresa = await empresaPorDefecto(cliente, flag('empresa'));
  const sesion = sesionEtl(idEmpresa);

  console.log(`Sembrador de datos ficticios de FINANZAS — empresa ${String(idEmpresa)}`);
  if (simular) {
    imprimirPlan();
    const r = await sembrarDemoFinanzas(cliente, sesion, {
      idEmpresa,
      dirCfdi: null,
      simular: true,
    });
    console.log(r.reporte.aTexto());
    return 0;
  }

  const dirCfdi = bandera('sin-cfdi') ? null : (flag('cfdi-dir') ?? DIR_CFDI_FINANZAS_POR_OMISION);
  const resultado = await sembrarDemoFinanzas(cliente, sesion, {
    idEmpresa,
    dirCfdi,
    simular: false,
  });
  imprimirResumen(resultado);
  console.log('');
  console.log('Para borrarlo todo:');
  console.log('  npx tsx --env-file=.env migracion/sembrar-demo-finanzas.ts -- --limpiar');
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

/** Reporte re-exportado para que las pruebas no tengan que importarlo aparte. */
export { Reporte };
