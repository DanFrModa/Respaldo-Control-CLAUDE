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
 * escribirlos) · `--concurrencia=<N>` · `--ayuda`.
 *
 * ## Si te sale un error de conexión
 *
 * Este script se corre contra una base REMOTA cuyo cupo de conexiones comparte con el backend
 * desplegado. Si la base va apretada, vuelve a correrlo (es idempotente: retoma donde se quedó) y,
 * si insiste, bájale la concurrencia: `--concurrencia=1` va de uno en uno con una sola conexión.
 * El script te lo dice él mismo, con el estado del cupo, en vez de escupir un volcado de Prisma.
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
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import {
  diagnosticoConexiones,
  esErrorDeConexion,
  hayColgadas,
  textoAyudaConexion,
  textoDiagnostico,
} from './comun/conexion.js';
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
  CONCURRENCIA_FIN_POR_OMISION,
  fechaDemo,
  sembrarDemoFinanzas,
  type ResultadoSiembraFinanzas,
} from './demo/finanzas/sembrar.js';
import { empresaPorDefecto } from './etl-terceros-saldos.js';
// Se REUSAN del gemelo de inventarios (fila 0.201) en vez de duplicarlos: son exactamente la misma
// pregunta —«¿esta ruta cae dentro del repo?» y «¿qué concurrencia pidió el usuario?»— y tenerlas
// en un solo sitio es lo que evita que una se arregle y la otra no. Importar ese módulo no ejecuta
// nada: su arranque está guardado por `import.meta.url === argv[1]`, que aquí no casa.
import { concurrenciaPedida, rutaDentroDe } from './sembrar-demo-inventarios.js';

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

/**
 * Carpeta por omisión de los XML ficticios: **FUERA del repositorio**, en el temporal del sistema.
 *
 * 🔴 POR QUÉ NO VA DENTRO DEL REPO, que es donde estaba. Estos XML NO son estáticos: los **genera**
 * el script con el **RFC y la razón social de la empresa activa** (ver `escribirCfdiFinanzas` en
 * `demo/finanzas/sembrar.ts`), y los reescribe en cada corrida. Y en los CFDI de **VENTA** ese dato
 * no va en el receptor, sino en el **EMISOR** — que es la propia empresa. La empresa de `prueba`
 * **ya tiene su RFC real capturado**, así que la primera corrida que llegue al final los escribiría
 * con el dato real… en una ruta del repositorio, que es **PÚBLICO**, donde lo que entra se queda en
 * el historial para siempre.
 *
 * Es exactamente la pared contra la que se estrelló el sembrador de inventarios en la fila 0.201.
 *
 * ⚠️ Y `.gitignore` SOLO no basta: **medido allí** — un archivo que YA estaba rastreado se sigue
 * mostrando como ` M` y `git add -A` lo sigue preparando, porque `.gitignore` sólo manda sobre lo
 * que NO está en el índice. Aquí eso no llegó a pasar (estos XML **nunca** se comitearon: `git
 * ls-files` de esa carpeta sale vacío), pero la carpeta está igualmente ignorada. Son tres capas:
 * el default de esta constante —que es la que evita que nada vuelva a escribirse dentro—, el
 * `.gitignore`, y el aviso de abajo cuando alguien apunta `--cfdi-dir` al repo a propósito.
 *
 * El nombre es DISTINTO del de inventarios (`control-cfdi-demo`) a propósito: los dos sembradores
 * se corren por separado y ninguno debe pisar los archivos del otro.
 */
export const DIR_CFDI_FINANZAS_POR_OMISION = join(tmpdir(), 'control-cfdi-demo-finanzas');

const AYUDA = `
Sembrador de datos ficticios para probar FINANZAS.

  npx tsx --env-file=.env migracion/sembrar-demo-finanzas.ts [-- <banderas>]

  --simular, --dry-run   No escribe nada: dice qué se sembraría.
  --limpiar              Borra TODO lo sembrado por este script (y sólo eso).
  --empresa=<id|nombre>  Empresa de los documentos (por omisión, la favorita).
  --cfdi-dir=<ruta>      Dónde escribir los CFDI ficticios. Por omisión se escriben FUERA
                         del repositorio, en ${DIR_CFDI_FINANZAS_POR_OMISION}
                         (llevan el RFC de tu empresa: no deben acabar en git).
  --sin-cfdi             No escribe los CFDI ficticios.
  --concurrencia=<N>     Cuántos catálogos crear a la vez (por omisión ${String(
    CONCURRENCIA_FIN_POR_OMISION,
  )}). Con 1 va de
                         uno en uno: más lento, pero usa una sola conexión. Úsalo si la
                         base te está dando errores de conexión.
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

/** Imprime el resumen de una siembra. `dirCfdi` es dónde quedaron los XML (null si no se escribieron). */
function imprimirResumen(r: ResultadoSiembraFinanzas, dirCfdi: string | null): void {
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
  // Los CFDI salen FUERA del repo a propósito, así que hay que decir dónde: si no, el usuario los
  // busca donde estaban antes y no los encuentra.
  if (dirCfdi !== null && r.cfdiEscritos > 0) {
    console.log('');
    console.log(`Los ${String(r.cfdiEscritos)} CFDI ficticios quedaron en:`);
    console.log(`  ${resolve(dirCfdi)}`);
    console.log(
      '  (fuera del repositorio a propósito: en los de VENTA el EMISOR lleva el RFC y el nombre ' +
        'de tu empresa). Impórtalos desde Finanzas › Importar CFDI cuando quieras probarlo.',
    );
  }
}

/**
 * Dice, ANTES de empezar, cómo está el cupo de conexiones de la base. Es lo que convierte un fallo
 * futuro en algo entendible: si arranca diciendo «38 ocupadas de 40», el usuario ya sabe por qué se
 * va a quejar, en vez de encontrarse un código de error a los dos minutos.
 *
 * Nunca estorba: si el cupo no se puede leer, la siembra sigue igual.
 */
async function imprimirEstadoDelCupo(cliente: PrismaClient, concurrencia: number): Promise<void> {
  const d = await diagnosticoConexiones(cliente);
  if (d === null) return;
  console.log(textoDiagnostico(d));
  const colgadas = hayColgadas(d);
  if (colgadas > 0) {
    console.log(
      `  ⚠️  ${String(colgadas)} de ellas están "idle in transaction": suelen ser restos de una ` +
        'corrida anterior que murió a media escritura, y siguen ocupando cupo.',
    );
  }
  const libres = d.maximo - d.total;
  if (libres < concurrencia + 2) {
    console.log(
      `  ⚠️  Quedan ~${String(libres)} conexiones libres y este script va a pedir hasta ` +
        `${String(concurrencia + 2)}. Si falla, córrelo con --concurrencia=1.`,
    );
  }
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
  const concurrencia = concurrenciaPedida(CONCURRENCIA_FIN_POR_OMISION);

  console.log(`Sembrador de datos ficticios de FINANZAS — empresa ${String(idEmpresa)}`);
  if (simular) {
    imprimirPlan();
    const r = await sembrarDemoFinanzas(cliente, sesion, {
      idEmpresa,
      dirCfdi: null,
      simular: true,
      concurrencia,
    });
    console.log(r.reporte.aTexto());
    return 0;
  }

  await imprimirEstadoDelCupo(cliente, concurrencia);

  const dirCfdi = bandera('sin-cfdi') ? null : (flag('cfdi-dir') ?? DIR_CFDI_FINANZAS_POR_OMISION);
  // El default ya es seguro (fuera del repo). Esto es el respaldo para el acto DELIBERADO de
  // apuntar la salida a una ruta del repositorio: no se prohíbe —puede haber una razón—, pero no
  // se hace en silencio. `..` desde `backend/` es la raíz del repo (este script se corre desde ahí).
  if (dirCfdi !== null && rutaDentroDe(dirCfdi, join(process.cwd(), '..'))) {
    console.warn('');
    console.warn('⚠️  OJO: estás escribiendo los CFDI DENTRO del repositorio.');
    console.warn(
      '   Estos XML llevan el RFC y la razón social de tu empresa (en los de VENTA, como',
    );
    console.warn(
      '   EMISOR), y este repositorio es PÚBLICO: si se comitean, esos datos quedan en el',
    );
    console.warn('   historial para siempre. Si no era lo que querías, quita --cfdi-dir y se');
    console.warn('   escribirán en:');
    console.warn(`     ${DIR_CFDI_FINANZAS_POR_OMISION}`);
    console.warn('');
  }
  const resultado = await sembrarDemoFinanzas(cliente, sesion, {
    idEmpresa,
    dirCfdi,
    simular: false,
    concurrencia,
  });
  imprimirResumen(resultado, dirCfdi);
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
  const concurrencia = concurrenciaPedida(CONCURRENCIA_FIN_POR_OMISION);
  const cliente = crearClientePrisma(url, {
    transactionOptions: { maxWait: 20_000, timeout: 120_000 },
    // El pool se dimensiona a lo que la corrida va a usar de verdad: una conexión por tarea en
    // vuelo más dos de holgura para las lecturas sueltas (mapeo, comprobaciones). Pedir 12 fijas
    // cuando se van a usar 4 sólo le quita cupo al backend desplegado, que comparte esta base.
    poolMax: concurrencia + 2,
    pool: { keepAlive: true, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 30_000 },
  });
  ejecutar(cliente)
    .then(async (codigo) => {
      await cliente.$disconnect();
      process.exit(codigo);
    })
    .catch(async (error: unknown) => {
      // Un fallo de CONEXIÓN no se le suelta al usuario como un volcado de Prisma: se le explica
      // qué pasó y qué hacer. El volcado técnico se imprime igual, debajo, por si hay que
      // reportarlo — pero deja de ser lo único que se ve.
      if (esErrorDeConexion(error)) {
        console.error(
          textoAyudaConexion({
            comando: 'npx tsx --env-file=.env migracion/sembrar-demo-finanzas.ts',
            concurrencia,
            diagnostico: await diagnosticoConexiones(cliente),
          }),
        );
        console.error('   ── detalle técnico ───────────────────────────────────────────');
        console.error(`   ${error instanceof Error ? error.message : String(error)}`);
        console.error('');
      } else {
        console.error(error);
      }
      await cliente.$disconnect();
      process.exit(1);
    });
}

/** Reporte re-exportado para que las pruebas no tengan que importarlo aparte. */
export { Reporte };
