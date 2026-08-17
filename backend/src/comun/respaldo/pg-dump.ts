/**
 * VOLCADO de la base con `pg_dump` (V1-E6a).
 *
 * Envuelve la herramienta oficial de PostgreSQL en algo que el job pueda llamar y, sobre todo, en
 * mensajes de error que se entiendan sin leer código: las dos formas típicas de fallar aquí
 * (el binario no está en la imagen, o su versión es más vieja que el servidor) producen errores
 * crípticos que costarían una tarde de depuración a las 3 de la mañana.
 *
 * QUÉ INCLUYE EL VOLCADO (decisión de esta etapa):
 *  • **Esquema + datos de TODA la base**, sin excluir tablas de negocio. Un respaldo selectivo es
 *    un respaldo con letra chica; el día que se use, nadie se acordará de qué se dejó fuera.
 *  • **Se excluye el esquema `pgboss`** — la cola de jobs. Es estado TRANSITORIO (jobs encolados,
 *    archivo de jobs viejos, schedules) que pg-boss vuelve a crear solo al arrancar. Restaurarlo
 *    sería peor que no hacerlo: al levantar el sistema restaurado se re-dispararían jobs de una
 *    fecha que ya pasó. Los eventos que SÍ importan viven en `evento_outbox`, tabla normal del
 *    esquema `public`, y esa sí entra completa.
 *  • **`--format=custom`**: comprimido de fábrica y restaurable con `pg_restore` de forma selectiva
 *    (una sola tabla, sin índices, en paralelo…). Un `.sql` plano no permite nada de eso.
 *  • **`--no-owner --no-privileges`**: el volcado no lleva grabado el nombre del rol dueño, así que
 *    se restaura tal cual en cualquier base y con cualquier usuario. Es lo que vuelve posible el
 *    ENSAYO de restauración en una base de prueba, que es la mitad del valor de esta etapa.
 *
 * La contraseña NO viaja en los argumentos: se pasa por variables de entorno de libpq (`PGPASSWORD`
 * y compañía). Los argumentos de un proceso son legibles por cualquiera que liste procesos
 * (`/proc/<pid>/cmdline`); el entorno de un proceso ajeno, no.
 */
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';

import { ErrorValidacion } from '../errores.js';

/** El volcado no se pudo hacer (binario ausente, credenciales, versión incompatible…). */
export class ErrorVolcado extends ErrorValidacion {}

/** Datos de conexión ya traducidos a las variables de entorno que entiende libpq. */
export interface VariablesLibpq {
  PGHOST: string;
  /** Nombre de la base. Va aparte porque `pg_restore` NO lo toma del entorno y exige `--dbname`. */
  PGDATABASE: string;
  PGPORT?: string;
  PGUSER?: string;
  PGPASSWORD?: string;
  PGSSLMODE?: string;
}

/**
 * Traduce una `DATABASE_URL` de Postgres a las variables de entorno que entiende libpq. Función
 * PURA (por eso es testeable sin base): es la que garantiza que la contraseña NO acabe en la línea
 * de comandos.
 *
 * Se ignoran a propósito los parámetros de la URL que son de Prisma y no de libpq
 * (`schema`, `connection_limit`, `pgbouncer`…); el único que se traduce es `sslmode`.
 */
export function variablesLibpq(url: string): VariablesLibpq {
  let analizada: URL;
  try {
    analizada = new URL(url);
  } catch {
    throw new ErrorVolcado('DATABASE_URL no es una URL de conexión válida.');
  }
  if (analizada.protocol !== 'postgres:' && analizada.protocol !== 'postgresql:') {
    throw new ErrorVolcado(
      `DATABASE_URL no apunta a PostgreSQL (protocolo "${analizada.protocol}").`,
    );
  }

  const base = decodeURIComponent(analizada.pathname.replace(/^\//, ''));
  if (base === '') {
    throw new ErrorVolcado('DATABASE_URL no incluye el nombre de la base de datos.');
  }
  const sslmode = analizada.searchParams.get('sslmode');
  return {
    PGHOST: decodeURIComponent(analizada.hostname),
    PGDATABASE: base,
    ...(analizada.port === '' ? {} : { PGPORT: analizada.port }),
    ...(analizada.username === '' ? {} : { PGUSER: decodeURIComponent(analizada.username) }),
    ...(analizada.password === '' ? {} : { PGPASSWORD: decodeURIComponent(analizada.password) }),
    ...(sslmode === null || sslmode === '' ? {} : { PGSSLMODE: sslmode }),
  };
}

/** Esquemas que NO entran al volcado (estado transitorio de la cola de jobs). */
export const ESQUEMAS_EXCLUIDOS = ['pgboss'] as const;

/**
 * Minutos máximos que puede tardar un volcado antes de darlo por COLGADO. `pg_dump` puede quedarse
 * esperando para siempre (un lock que nadie suelta, una red que se cae a media transferencia sin
 * cerrar el socket), y una corrida colgada no falla: simplemente NUNCA termina — que es la forma más
 * silenciosa de no tener respaldo. Al vencer, se mata el proceso y la corrida falla con su rastro.
 * Configurable por `RESPALDO_TIMEOUT_MIN`; 3 horas de default dan margen de sobra a esta base.
 */
export const TIMEOUT_VOLCADO_MIN_DEFECTO = 180;

/** Minutos de tope para el volcado, leídos del entorno (con el default de arriba si no vienen). */
export function timeoutVolcadoMinutos(
  env: Record<string, string | undefined> = process.env,
): number {
  const crudo = Number(env.RESPALDO_TIMEOUT_MIN);
  return Number.isFinite(crudo) && crudo > 0 ? crudo : TIMEOUT_VOLCADO_MIN_DEFECTO;
}

/** Corre un proceso y devuelve su código de salida junto con lo que escribió en stderr. */
async function correr(
  ejecutable: string,
  argumentos: readonly string[],
  entorno: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ codigo: number | null; stderr: string; expirado: boolean }> {
  return new Promise((resolver, rechazar) => {
    const proceso = spawn(ejecutable, argumentos, { env: entorno });
    let stderr = '';
    let expirado = false;
    // Primero SIGTERM (deja a pg_dump cerrar su conexión); si ni así se muere, SIGKILL.
    const reloj = setTimeout(() => {
      expirado = true;
      proceso.kill('SIGTERM');
      setTimeout(() => proceso.kill('SIGKILL'), 10_000).unref();
    }, timeoutMs);
    reloj.unref();
    proceso.stderr.on('data', (trozo: Buffer) => {
      // Se acota: un pg_dump que falla en bucle podría escribir megas de texto.
      stderr = `${stderr}${trozo.toString('utf8')}`.slice(-4000);
    });
    proceso.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        rechazar(
          new ErrorVolcado(
            `No se encontró el ejecutable "${ejecutable}". La imagen del backend debe traer el ` +
              'cliente de PostgreSQL (paquete `postgresql-client-17`, ver backend/Dockerfile); si ' +
              'está en otra ruta, indícala con RESPALDO_PG_DUMP.',
          ),
        );
        return;
      }
      rechazar(error);
    });
    proceso.on('close', (codigo) => {
      clearTimeout(reloj);
      resolver({ codigo, stderr: stderr.trim(), expirado });
    });
  });
}

/**
 * Vuelca la base de `url` al archivo `destino` (formato custom de PostgreSQL, sin cifrar todavía).
 *
 * @returns el tamaño del volcado en bytes.
 * @throws {ErrorVolcado} si `pg_dump` no está, no conecta, o su versión es más vieja que el servidor.
 */
export async function generarVolcado(opciones: {
  url: string;
  destino: string;
  ejecutable?: string;
  /** Tope en minutos antes de matar el proceso (por defecto, {@link timeoutVolcadoMinutos}). */
  timeoutMinutos?: number;
}): Promise<number> {
  const ejecutable = opciones.ejecutable ?? 'pg_dump';
  const argumentos = [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    ...ESQUEMAS_EXCLUIDOS.map((esquema) => `--exclude-schema=${esquema}`),
    '--file',
    opciones.destino,
  ];

  const minutos = opciones.timeoutMinutos ?? timeoutVolcadoMinutos();
  const { codigo, stderr, expirado } = await correr(
    ejecutable,
    argumentos,
    { ...process.env, ...variablesLibpq(opciones.url) },
    minutos * 60 * 1000,
  );

  if (expirado) {
    throw new ErrorVolcado(
      `pg_dump se pasó del tope de ${String(minutos)} minutos y se dio por COLGADO (se mató el ` +
        'proceso). Una corrida colgada nunca falla sola: sería un respaldo que no existe y que ' +
        'nadie ve fallar. Sube RESPALDO_TIMEOUT_MIN si la base creció, o revisa si hay un lock ' +
        `atorado. Detalle: ${stderr === '' ? '(sin detalle)' : stderr}`,
    );
  }

  if (codigo !== 0) {
    // El fallo más traicionero: un pg_dump más viejo que el servidor se NIEGA a volcar (no degrada,
    // no avisa a medias — falla). Pasa en cuanto Railway sube la major de Postgres y la imagen del
    // backend se queda con el cliente anterior, así que el mensaje lo dice con todas sus letras.
    if (/server version|aborting because of server version mismatch/i.test(stderr)) {
      throw new ErrorVolcado(
        `pg_dump es de una versión MÁS VIEJA que el servidor PostgreSQL y se niega a volcar. ` +
          `Actualiza el cliente de PostgreSQL en backend/Dockerfile a la major del servidor. Detalle: ${stderr}`,
      );
    }
    throw new ErrorVolcado(
      `pg_dump terminó con código ${String(codigo)}: ${stderr === '' ? '(sin detalle)' : stderr}`,
    );
  }

  const info = await stat(opciones.destino);
  if (info.size === 0) {
    throw new ErrorVolcado('pg_dump terminó bien pero el volcado quedó VACÍO (0 bytes).');
  }
  return info.size;
}

/**
 * Devuelve la versión de `pg_dump` (ej. `"17.4"`), o `null` si el binario no está disponible. Solo
 * se usa para dejar constancia en los logs de arranque y para que las pruebas puedan saltarse el
 * ida-y-vuelta real cuando la máquina no tiene cliente de PostgreSQL.
 */
export async function versionPgDump(ejecutable = 'pg_dump'): Promise<string | null> {
  try {
    const salida = await new Promise<string>((resolver, rechazar) => {
      const proceso = spawn(ejecutable, ['--version']);
      let texto = '';
      proceso.stdout.on('data', (trozo: Buffer) => {
        texto += trozo.toString('utf8');
      });
      proceso.on('error', rechazar);
      proceso.on('close', () => {
        resolver(texto);
      });
    });
    return /(\d+\.\d+)/.exec(salida)?.[1] ?? null;
  } catch {
    return null;
  }
}
