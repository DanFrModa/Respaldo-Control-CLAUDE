/**
 * RESTAURACIÓN de un respaldo cifrado (V1-E6a). **Un respaldo que nadie sabe restaurar no es un
 * respaldo**: este script es la otra mitad del job de respaldo y la única prueba de que la copia sirve.
 *
 * Hace tres cosas, y cualquiera de ellas por separado:
 *   1. **Lista** los respaldos que hay en R2 (`--listar`).
 *   2. **Baja y descifra** un respaldo (de R2 por su `--key`, o de disco con `--archivo`).
 *   3. **Restaura** el volcado descifrado en una base de datos (`--destino <URL>`), con `pg_restore`.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * CÓMO SE USA (siempre desde `backend/`, y SIEMPRE con `--env-file=.env`: los `npm run` del proyecto
 * no cargan el .env a propósito, ver CLAUDE.md §8)
 *
 *   # 1) ¿Qué respaldos hay?
 *   npx tsx --env-file=.env scripts/restaurar-respaldo.ts --listar
 *
 *   # 2) Bajar y descifrar uno, sin restaurar nada (deja el .dump en el disco):
 *   npx tsx --env-file=.env scripts/restaurar-respaldo.ts \
 *     --key respaldos/bd/2026/control-2026-08-17T080000Z.dump.enc --salida /tmp/control.dump
 *
 *   # 3) El ENSAYO completo: restaurar en una base NUEVA y vacía (nunca encima de la de producción):
 *   createdb ensayo_restauracion
 *   npx tsx --env-file=.env scripts/restaurar-respaldo.ts \
 *     --key respaldos/bd/2026/control-2026-08-17T080000Z.dump.enc \
 *     --destino postgresql://usuario:clave@host:5432/ensayo_restauracion
 *
 *   # 4) Comprobar de paso que el archivo es EL QUE SE SUBIÓ (huella de `respaldo_corrida.sha256`):
 *   npx tsx --env-file=.env scripts/restaurar-respaldo.ts --key <key> --sha256 <hex> --destino <URL>
 *
 * Dentro del contenedor del backend en Railway las variables ya están en el entorno, así que ahí va
 * SIN `--env-file`:  `npx tsx scripts/restaurar-respaldo.ts --listar`.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * DÓNDE SE CORRE (dos vías, según qué se haya roto)
 *
 *  • **Railway sigue en pie** (te cargaste datos, una migración salió mal): córrelo **dentro del
 *    contenedor del backend**. Ahí ya están el cliente de PostgreSQL 17, este script y las
 *    credenciales R2 del ambiente. La imagen lo lleva (`COPY scripts ./scripts` en el Dockerfile).
 *  • **Railway ya NO está** (cuenta suspendida, servicio borrado, mudanza): entonces el contenedor
 *    tampoco está. Córrelo desde un **checkout del repo** en cualquier máquina con **cliente
 *    PostgreSQL ≥ 17** y Node 22, exportando a mano `RESPALDO_LLAVE` y las `R2_*`. Éste es el
 *    escenario para el que existe este segundo respaldo, así que es el que hay que ensayar.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ TRES ADVERTENCIAS QUE NO SON DECORATIVAS
 *
 *  • **`RESPALDO_LLAVE` tiene que ser LA MISMA con la que se cifró.** Si se perdió, el respaldo es
 *    IRRECUPERABLE: no hay puerta trasera ni forma de recuperarlo. Guárdala fuera de Railway.
 *  • **`--destino` DEBE ser una base de ensayo, vacía.** El script exige `--si-estoy-seguro` para
 *    tocar una base que ya tenga tablas, y aun así `pg_restore --clean` BORRA lo que haya.
 *  • **El volcado no trae el esquema `pgboss`** (la cola de jobs): es estado transitorio y pg-boss lo
 *    vuelve a crear solo al arrancar. No es un dato faltante, es una exclusión deliberada. Los
 *    eventos de negocio NO se pierden: viven en `evento_outbox` (esquema `public`, sí incluido) y el
 *    relay sólo publica los que tienen `publicadoEn = null`, así que al levantar la base restaurada
 *    no se re-disparan los ya publicados. **El hueco fino, dicho con todas sus letras:** un evento
 *    que YA se había publicado a pg-boss pero que ningún worker había consumido todavía se pierde al
 *    excluir ese esquema. Es una ventana de segundos y afecta a automatismos (auto-avance de la RC,
 *    refresco de KPIs), no a datos capturados; tras restaurar, conviene revisar la Ruta Crítica de
 *    las órdenes que se movieron ese día.
 *
 * Esta cabecera ES el procedimiento de restauración: se mantiene junto al código para que no pueda
 * quedarse desactualizada respecto de las banderas que el script realmente usa. La parte de
 * INFRAESTRUCTURA que la rodea (dónde crear la base de ensayo en Railway, cómo apuntar el servicio a
 * la base restaurada) le toca a `docs/GUIA-RAILWAY-R2.md`.
 *
 * El ciclo completo —volcado real, cifrado, descifrado y `pg_restore` en otra base, comprobando que
 * los datos llegaron— está ejercitado como prueba automática en
 * `src/comun/jobs/respaldo-bd.int.test.ts` ("ENSAYO DE RESTAURACIÓN"): el procedimiento no depende de
 * que alguien se acuerde de probarlo.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import { GetObjectCommand } from '@aws-sdk/client-s3';

import { configR2DesdeEnv, crearClienteR2, servicioArchivos } from '../src/comun/archivos.js';
import { ErrorValidacion } from '../src/comun/errores.js';
import { descifrarArchivo, sha256Archivo } from '../src/comun/respaldo/cifrado.js';
import { configRespaldoDesdeEnv, PREFIJO_DEFECTO } from '../src/comun/respaldo/config.js';
import { variablesLibpq, type VariablesLibpq } from '../src/comun/respaldo/pg-dump.js';

/** Opciones que acepta el script, ya interpretadas. */
interface Opciones {
  listar: boolean;
  key?: string;
  archivo?: string;
  salida?: string;
  destino?: string;
  sha256?: string;
  siEstoySeguro: boolean;
}

function leerArgumentos(argv: readonly string[]): Opciones {
  const opciones: Opciones = { listar: false, siEstoySeguro: false };
  for (let indice = 0; indice < argv.length; indice += 1) {
    const argumento = argv[indice];
    const valor = (): string => {
      const siguiente = argv[indice + 1];
      if (siguiente === undefined || siguiente.startsWith('--')) {
        throw new Error(`La opción ${argumento} necesita un valor.`);
      }
      indice += 1;
      return siguiente;
    };
    switch (argumento) {
      case '--listar':
        opciones.listar = true;
        break;
      case '--key':
        opciones.key = valor();
        break;
      case '--archivo':
        opciones.archivo = valor();
        break;
      case '--salida':
        opciones.salida = valor();
        break;
      case '--destino':
        opciones.destino = valor();
        break;
      case '--sha256':
        opciones.sha256 = valor().trim().toLowerCase();
        break;
      case '--si-estoy-seguro':
        opciones.siEstoySeguro = true;
        break;
      case '--ayuda':
      case '-h':
        opciones.listar = false;
        throw new Error('AYUDA');
      default:
        throw new Error(`Opción no reconocida: ${argumento}`);
    }
  }
  return opciones;
}

const AYUDA = `
Restauración de un respaldo cifrado de CONTROL (V1-E6a).

  --listar                Lista los respaldos que hay en R2, del más nuevo al más viejo.
  --key <key>             Respaldo a bajar de R2 (la key que aparece en --listar).
  --archivo <ruta>        Respaldo ya descargado en disco (alternativa a --key).
  --salida <ruta>         Dónde dejar el volcado DESCIFRADO (por defecto, un temporal que se borra).
  --destino <URL>         Base donde restaurar (pg_restore). Sin esto, solo descifra.
  --sha256 <hex>          Comprueba la huella del archivo cifrado ANTES de descifrar (la huella
                          la guarda cada corrida en respaldo_corrida.sha256). Detecta corrupción
                          sin necesitar la llave.
  --si-estoy-seguro       Permite restaurar sobre una base que YA tiene tablas (las borra).

Variables necesarias: RESPALDO_LLAVE (la misma con la que se cifró) y las R2_* del ambiente.
Correr SIEMPRE desde backend/ y con --env-file=.env.
`.trim();

/**
 * Configuración de R2, con un error que DICE QUÉ FALTA. Sin esto, `--listar` —el PRIMER comando que
 * alguien teclea el día del desastre— moría con el genérico "Los datos capturados no son válidos",
 * que no nombra ni una variable. El mensaje de `RESPALDO_LLAVE` ya era explícito; éste ahora también.
 */
function configR2OExplicar(): ReturnType<typeof configR2DesdeEnv> {
  try {
    return configR2DesdeEnv();
  } catch (error) {
    const detalle = error instanceof ErrorValidacion ? error.message : String(error);
    throw new Error(
      'Faltan las credenciales de Cloudflare R2 para leer los respaldos. Necesitas las CUATRO ' +
        'variables del ambiente donde vive el bucket:\n' +
        '    R2_ACCOUNT_ID       id de la cuenta de Cloudflare\n' +
        '    R2_ACCESS_KEY_ID    token S3 del bucket (con permiso de lectura)\n' +
        '    R2_SECRET_ACCESS_KEY  secreto de ese token\n' +
        '    R2_BUCKET           nombre del bucket (p. ej. control-v2-prod)\n' +
        '  Están en las variables del servicio backend en Railway. Corre este script desde ' +
        `backend/ con --env-file=.env, o expórtalas a mano.\n  Detalle: ${detalle}`,
      // Se conserva el error original como `cause`: el mensaje de arriba es para el humano, y esto
      // deja el rastro técnico intacto para `RESPALDO_DEBUG=true`.
      { cause: error },
    );
  }
}

/** Baja un objeto de R2 a disco, en streaming (el respaldo puede pesar cientos de MB). */
async function descargarDeR2(key: string, destino: string): Promise<number> {
  const config = configR2OExplicar();
  const cliente = crearClienteR2(config);
  const respuesta = await cliente.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  if (respuesta.Body === undefined) {
    throw new Error(`El objeto "${key}" no tiene contenido en R2.`);
  }
  await pipeline(respuesta.Body as Readable, createWriteStream(destino));
  const info = await stat(destino);
  return info.size;
}

/** Corre `pg_restore` contra la base destino, mostrando su salida tal cual. */
/**
 * Argumentos EXACTOS con los que este script invoca `pg_restore`. Se expone aparte —y la prueba de
 * integración la llama a ELLA, no a una copia— porque la lección ya se pagó una vez: `--dbname` es
 * obligatorio (a diferencia de `psql` y `pg_dump`, `pg_restore` NO lee `PGDATABASE`) y una prueba
 * que se limitaba a repetir la lista de argumentos dejaba pasar su borrado sin quejarse.
 */
export function argumentosPgRestore(volcado: string, variables: VariablesLibpq): string[] {
  return [
    // ⚠️ `--dbname` va EXPLÍCITO: `pg_restore` NO toma la base de `PGDATABASE` y aborta con
    // "one of -d/--dbname and -f/--file must be specified". La CONTRASEÑA sigue por entorno.
    '--dbname',
    variables.PGDATABASE,
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    // Los avisos de "no existe el objeto que iba a borrar" son NORMALES al restaurar en una base
    // vacía: sin --exit-on-error, pg_restore los reporta y sigue.
    volcado,
  ];
}

/**
 * Restaura `volcado` en la base de `urlDestino` con `pg_restore`. Exportada para que el ENSAYO de
 * restauración (`src/comun/jobs/respaldo-bd.int.test.ts`) ejecute ESTA función y no una imitación:
 * si alguien le quita `--dbname`, el ensayo se cae.
 */
export async function restaurar(volcado: string, urlDestino: string): Promise<void> {
  const variables = variablesLibpq(urlDestino);
  const argumentos = argumentosPgRestore(volcado, variables);
  await new Promise<void>((resolver, rechazar) => {
    const proceso = spawn('pg_restore', argumentos, {
      env: { ...process.env, ...variables },
      stdio: 'inherit',
    });
    proceso.on('error', rechazar);
    proceso.on('close', (codigo) => {
      if (codigo === 0) {
        resolver();
        return;
      }
      // pg_restore devuelve ≠ 0 también cuando solo hubo avisos; se avisa sin mentir.
      rechazar(
        new Error(
          `pg_restore terminó con código ${String(codigo)}. Si solo aparecieron avisos de "does not ` +
            'exist" al limpiar una base vacía, la restauración probablemente sí funcionó: verifícalo ' +
            'consultando algunas tablas.',
        ),
      );
    });
  });
}

/** ¿La base destino ya tiene tablas de negocio? (para no pisar algo real por accidente). */
async function baseTieneTablas(urlDestino: string): Promise<boolean> {
  const salida = await new Promise<string>((resolver, rechazar) => {
    const proceso = spawn(
      'psql',
      [
        '--tuples-only',
        '--no-align',
        '--command',
        "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'",
      ],
      { env: { ...process.env, ...variablesLibpq(urlDestino) } },
    );
    let texto = '';
    proceso.stdout.on('data', (trozo: Buffer) => {
      texto += trozo.toString('utf8');
    });
    proceso.on('error', rechazar);
    proceso.on('close', () => {
      resolver(texto.trim());
    });
  });
  return Number(salida) > 0;
}

async function principal(): Promise<void> {
  let opciones: Opciones;
  try {
    opciones = leerArgumentos(process.argv.slice(2));
  } catch (error) {
    console.error(AYUDA);
    if (error instanceof Error && error.message !== 'AYUDA') {
      console.error(`\n${error.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (opciones.listar) {
    const prefijo = process.env.RESPALDO_PREFIJO ?? PREFIJO_DEFECTO;
    configR2OExplicar(); // valida y explica ANTES de que el servicio truene con el mensaje genérico
    const objetos = await servicioArchivos().listarObjetos(prefijo);
    if (objetos.length === 0) {
      console.log(`No hay ningún respaldo bajo "${prefijo}" en el bucket. ⚠️ Eso NO es normal.`);
      return;
    }
    const ordenados = [...objetos].sort(
      (uno, otro) =>
        (otro.ultimaModificacion?.getTime() ?? 0) - (uno.ultimaModificacion?.getTime() ?? 0),
    );
    console.log(`${String(ordenados.length)} respaldo(s) bajo "${prefijo}":\n`);
    for (const objeto of ordenados) {
      const fecha = objeto.ultimaModificacion?.toISOString() ?? '(sin fecha)';
      const mb = ((objeto.tamanoBytes ?? 0) / 1024 / 1024).toFixed(1);
      console.log(`  ${fecha}  ${mb.padStart(8)} MB  ${objeto.key}`);
    }
    return;
  }

  if (opciones.key === undefined && opciones.archivo === undefined) {
    console.error(AYUDA);
    console.error('\nFalta indicar QUÉ respaldo: --key (de R2) o --archivo (de disco).');
    process.exitCode = 1;
    return;
  }

  // La llave es lo único imprescindible para descifrar: se valida ANTES de bajar nada.
  const { frase } = configRespaldoDesdeEnv();

  // Y la base destino se revisa ANTES de bajar y descifrar cientos de MB: si el comando se va a
  // rechazar por seguridad, que sea en el primer segundo y no en el quinto minuto.
  if (
    opciones.destino !== undefined &&
    !opciones.siEstoySeguro &&
    (await baseTieneTablas(opciones.destino))
  ) {
    console.error(
      '⛔ La base destino YA TIENE TABLAS. Restaurar encima las BORRA.\n' +
        '   Si de verdad es lo que quieres, repite el comando con --si-estoy-seguro.',
    );
    process.exitCode = 1;
    return;
  }

  const carpeta = await mkdtemp(join(tmpdir(), 'control-restaura-'));
  try {
    let cifrado: string;
    if (opciones.key !== undefined) {
      cifrado = join(carpeta, 'respaldo.dump.enc');
      console.log(`Bajando "${opciones.key}" de R2...`);
      const bytes = await descargarDeR2(opciones.key, cifrado);
      console.log(`  ${(bytes / 1024 / 1024).toFixed(1)} MB descargados.`);
    } else if (opciones.archivo !== undefined) {
      cifrado = opciones.archivo;
    } else {
      // Inalcanzable (arriba se exige --key o --archivo), pero se dice en vez de forzar el tipo.
      throw new Error('No se indicó qué respaldo restaurar (--key o --archivo).');
    }

    if (opciones.sha256 !== undefined) {
      console.log('Comprobando la huella SHA-256 del archivo cifrado...');
      const real = await sha256Archivo(cifrado);
      if (real !== opciones.sha256) {
        throw new Error(
          'La huella SHA-256 NO coincide: el archivo NO es el que se subió, o llegó corrupto.\n' +
            `    esperada: ${opciones.sha256}\n    real:     ${real}\n` +
            '  Baja el respaldo otra vez; si vuelve a no coincidir, usa el respaldo del mes anterior.',
        );
      }
      console.log('  Huella correcta.');
    }

    const volcado = opciones.salida ?? join(carpeta, 'control.dump');
    console.log('Descifrando (AES-256-GCM)...');
    const bytes = await descifrarArchivo(cifrado, volcado, frase);
    console.log(
      `  Volcado descifrado y VERIFICADO: ${(bytes / 1024 / 1024).toFixed(1)} MB → ${volcado}`,
    );

    if (opciones.destino === undefined) {
      console.log(
        '\nListo. No se restauró nada (falta --destino). El volcado se puede cargar a mano con:\n' +
          `  pg_restore --clean --if-exists --no-owner --no-privileges -d <URL> ${volcado}`,
      );
      return;
    }

    console.log('Restaurando en la base destino con pg_restore...');
    await restaurar(volcado, opciones.destino);
    console.log(
      '\n✅ Restauración terminada. VERIFÍCALA antes de darla por buena: cuenta órdenes, pedidos y\n' +
        '   movimientos de kardex y contrástalos con lo que esperabas del día del respaldo.',
    );
  } finally {
    // Los temporales se borran SIEMPRE: un volcado de la base entera olvidado en el disco es una
    // fuga de datos. Si el usuario pidió --salida, ese archivo está fuera de la carpeta y se queda.
    await rm(carpeta, { recursive: true, force: true });
  }
}

/**
 * ¿Se está EJECUTANDO este archivo, o sólo se está IMPORTANDO? El ensayo de restauración importa
 * `restaurar` de aquí (para probar el código de verdad y no una copia); sin este guard, importarlo
 * dispararía además el CLI entero.
 */
const ejecutadoDirecto =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoDirecto) {
  // Este script se corre bajo presión (y probablemente de madrugada): un volcado de stack de Node no
  // le sirve a nadie. Cualquier error sale como UNA línea legible, y el detalle técnico solo si se
  // pide con RESPALDO_DEBUG=true.
  try {
    await principal();
  } catch (error) {
    console.error(`\n⛔ ${error instanceof Error ? error.message : String(error)}`);
    if (process.env.RESPALDO_DEBUG === 'true') {
      console.error(error);
    } else {
      console.error('   (para ver el detalle técnico: RESPALDO_DEBUG=true)');
    }
    process.exitCode = 1;
  }
}
