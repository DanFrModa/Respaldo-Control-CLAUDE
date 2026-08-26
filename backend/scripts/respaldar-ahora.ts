/**
 * RESPALDO MANUAL — dispara AHORA la misma corrida que el job mensual (V1-E6a).
 *
 * **Por qué existe.** El respaldo a R2 es mensual (`RESPALDO_CRON`, por defecto el día 1 a las 08:00
 * UTC). Eso deja dos huecos que este script tapa:
 *
 *   1. **Verificar que sirve, sin esperar al día 1.** Que el job esté agendado sólo prueba que el
 *      reloj está puesto; no prueba que el `pg_dump` corra, que el cifrado funcione, que R2 acepte
 *      la subida ni que el archivo se pueda recuperar. Eso sólo se sabe corriéndolo.
 *   2. **Respaldar bajo demanda**, antes de algo delicado: una migración grande, un ETL de go-live,
 *      una limpieza masiva. Un respaldo de hace 29 días no consuela.
 *
 * Corre EXACTAMENTE el mismo código que el job (`ejecutarRespaldoBd`), con las mismas variables de
 * entorno. No es una imitación: si esto funciona, el del día 1 también.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * CÓMO SE USA (desde `backend/`, SIEMPRE con `--env-file=.env`: los `npm run` no lo cargan a
 * propósito — ver CLAUDE.md §7)
 *
 *   # Respaldo normal (aplica la retención configurada, igual que el job mensual):
 *   npx tsx --env-file=.env scripts/respaldar-ahora.ts
 *
 *   # Sin borrar ningún respaldo viejo (recomendado para un ENSAYO):
 *   npx tsx --env-file=.env scripts/respaldar-ahora.ts --sin-borrar
 *
 *   # Sólo revisar la configuración, sin respaldar nada:
 *   npx tsx --env-file=.env scripts/respaldar-ahora.ts --revisar
 *
 * Dentro del contenedor del backend en Railway las variables ya están en el entorno, así que ahí va
 * SIN `--env-file`:  `npx tsx scripts/respaldar-ahora.ts --sin-borrar`
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * QUÉ HACE, EN ORDEN
 *
 *   1. Revisa la configuración (las mismas reglas del arranque del servidor).
 *   2. `pg_dump` de la base completa (excluye el esquema `pgboss`).
 *   3. Cifra el volcado con `RESPALDO_LLAVE` (AES-GCM).
 *   4. Lo sube a R2 y comprueba el tamaño con HeadObject.
 *   5. Aplica la retención (salvo `--sin-borrar`).
 *   6. Deja el rastro en `respaldo_corrida` y en la bitácora (entidad `RespaldoBd`) — igual que el job.
 *
 * ⚠️ **La llave manda.** Si `RESPALDO_LLAVE` no es la misma con la que se cifró un respaldo, ese
 * respaldo es IRRECUPERABLE. Guárdala FUERA de Railway (gestor de contraseñas).
 *
 * ⚠️ **`--sin-borrar` no desactiva la retención para siempre**: sólo la salta en ESTA corrida. Es lo
 * que quieres en un ensayo, para no gastarte el año de historia con una corrida de prueba.
 */
import { pathToFileURL } from 'node:url';

import { ErrorValidacion } from '../src/comun/errores.js';
import {
  depsRespaldoDesdeEnv,
  ejecutarRespaldoBd,
  type ResultadoRespaldo,
} from '../src/comun/jobs/respaldo-bd.js';
import { configRespaldoDesdeEnv, decidirArranqueRespaldo } from '../src/comun/respaldo/config.js';
import { versionPgDump } from '../src/comun/respaldo/pg-dump.js';

/** Retención "no borres nada" para el ensayo. No cambia la configuración del ambiente. */
const RETENCION_SIN_BORRAR = 100_000;

interface Opciones {
  sinBorrar: boolean;
  revisar: boolean;
}

function leerOpciones(argv: readonly string[]): Opciones {
  const opciones: Opciones = { sinBorrar: false, revisar: false };
  for (const arg of argv) {
    if (arg === '--sin-borrar') opciones.sinBorrar = true;
    else if (arg === '--revisar') opciones.revisar = true;
    else if (arg === '--ayuda' || arg === '-h') {
      console.log(
        'Uso: npx tsx --env-file=.env scripts/respaldar-ahora.ts [--sin-borrar] [--revisar]\n\n' +
          '  --sin-borrar  No aplica la retención en esta corrida (recomendado para un ensayo).\n' +
          '  --revisar     Sólo revisa la configuración; no respalda nada.\n',
      );
      process.exit(0);
    } else {
      throw new ErrorValidacion(`Opción desconocida: "${arg}". Usa --ayuda para ver las válidas.`);
    }
  }
  return opciones;
}

function mb(bytes: number | undefined): string {
  if (bytes === undefined) return '—';
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function imprimirResultado(r: ResultadoRespaldo, sinBorrar: boolean): void {
  const segundos = (r.duracionMs / 1000).toFixed(1);
  console.log('\n────────────────────────────────────────────────────────────');
  if (r.estado === 'EXITO') {
    console.log(`✅ RESPALDO HECHO  (${segundos} s)`);
    console.log(`   bucket        : ${r.bucket ?? '—'}`);
    console.log(`   key           : ${r.key ?? '—'}`);
    console.log(`   volcado       : ${mb(r.tamanoDumpBytes)}  (sin cifrar)`);
    console.log(`   subido a R2   : ${mb(r.tamanoSubidoBytes)}  (cifrado)`);
    console.log(`   sha256        : ${r.sha256 ?? '—'}`);
    console.log(
      `   viejos borrados: ${r.objetosBorrados}${sinBorrar ? '  (retención SALTADA por --sin-borrar)' : ''}`,
    );
    console.log('\n   Para comprobar que se puede RECUPERAR (la única prueba que cuenta):');
    console.log(
      `   npx tsx --env-file=.env scripts/restaurar-respaldo.ts --key ${r.key ?? '<key>'} \\\n` +
        '     --destino postgresql://usuario:clave@host:5432/ensayo_restauracion',
    );
  } else {
    console.log(`⛔ RESPALDO FALLIDO en el paso ${r.paso}  (${segundos} s)`);
    console.log(`   ${r.error ?? 'sin detalle'}`);
    console.log(
      '\n   El rastro quedó en `respaldo_corrida` y en la bitácora (entidad RespaldoBd).',
    );
  }
  console.log('────────────────────────────────────────────────────────────\n');
}

async function principal(): Promise<void> {
  const opciones = leerOpciones(process.argv.slice(2));

  // 1. Las MISMAS reglas que aplica el servidor al arrancar: así el diagnóstico de aquí y el de
  //    producción no pueden contradecirse.
  const decision = decidirArranqueRespaldo();
  if (decision.accion === 'sin-config') {
    throw new ErrorValidacion(decision.mensaje ?? 'Configuración del respaldo incompleta.');
  }
  if (decision.accion === 'apagado') {
    // Apagado a propósito NO impide una corrida manual: quien ejecuta esto lo está pidiendo. Pero se
    // dice, para que nadie crea que el ambiente quedó con respaldo automático.
    console.warn(
      '⚠️  RESPALDO_ACTIVO=false: este ambiente NO tiene respaldo automático.\n' +
        '   Se corre igual porque lo pediste a mano, pero el del día 1 no va a suceder.\n',
    );
  }

  const config = configRespaldoDesdeEnv();
  const version = await versionPgDump(config.pgDump);
  if (version === null) {
    throw new ErrorValidacion(
      `"${config.pgDump}" no está disponible aquí. El respaldo necesita el cliente de PostgreSQL ` +
        '(≥ 17). En el contenedor del backend ya viene; desde tu máquina, instálalo.',
    );
  }

  console.log('Configuración del respaldo:');
  console.log(`   pg_dump    : ${version}`);
  console.log(`   prefijo    : ${config.prefijo}`);
  console.log(`   cron       : ${config.cron}   (el automático; esta corrida es manual)`);
  console.log(
    `   retención  : ${opciones.sinBorrar ? 'SALTADA (--sin-borrar)' : `${config.retencion} copias`}`,
  );

  if (opciones.revisar) {
    console.log('\n✅ La configuración está completa. No se respaldó nada (--revisar).\n');
    return;
  }

  console.log('\nRespaldando… (el pg_dump de una base grande puede tardar varios minutos)\n');
  const resultado = await ejecutarRespaldoBd(
    depsRespaldoDesdeEnv(
      opciones.sinBorrar ? { ...config, retencion: RETENCION_SIN_BORRAR } : config,
      (mensaje, error) => console.error(mensaje, error),
    ),
  );

  imprimirResultado(resultado, opciones.sinBorrar);
  if (resultado.estado === 'FALLO') process.exitCode = 1;
}

/** ¿Se EJECUTA este archivo, o sólo se IMPORTA? (mismo guard que `restaurar-respaldo.ts`). */
const ejecutadoDirecto =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoDirecto) {
  try {
    await principal();
  } catch (error) {
    console.error(`\n⛔ ${error instanceof Error ? error.message : String(error)}`);
    if (process.env.RESPALDO_DEBUG === 'true') console.error(error);
    else console.error('   (para ver el detalle técnico: RESPALDO_DEBUG=true)');
    process.exitCode = 1;
  }
}
