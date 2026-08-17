/**
 * CONFIGURACIÓN del respaldo periódico a R2 (V1-E6a) y su GUARD de arranque.
 *
 * Todo lo que puede faltar para que el respaldo no sirva se decide AQUÍ, en funciones PURAS (reciben
 * el env, no tocan nada): así el arranque puede decidir sin BD, y las pruebas cubren cada caso sin
 * levantar el mundo. El principio de la etapa manda: **si falta algo, el respaldo NO corre EN
 * SILENCIO** — o se programa bien configurado, o queda un rastro rojo que se ve.
 *
 * Las tres cosas que se exigen y por qué:
 *  1. `RESPALDO_LLAVE` — sin llave no hay cifrado, y un volcado de la base ENTERA en claro dentro de
 *     un bucket ajeno no es una opción. Se exige una frase LARGA (mínimo {@link MINIMO_LLAVE}
 *     caracteres) porque de ella sale la llave AES.
 *  2. Credenciales R2 completas y REALES — con las de relleno (`dev`) el respaldo se firmaría contra
 *     una cuenta que no existe y fallaría en cada corrida.
 *  3. `R2_SUBIDA_LOCAL` apagado — ese modo convierte las subidas server-side en un NO-OP para dev/CI
 *     (ver `comun/archivos.ts`). Un respaldo "subido" en no-op es exactamente el fallo silencioso
 *     que esta etapa existe para evitar. El respaldo NO usa esa ruta (sube directo con su propio
 *     PutObject), pero que la bandera esté encendida significa que este ambiente NO es uno donde
 *     deba correr un respaldo real.
 */
import { z } from 'zod';

import { credencialesR2SonDummy } from '../archivos.js';
import { ErrorValidacion } from '../errores.js';

import { timeoutVolcadoMinutos } from './pg-dump.js';

/**
 * Largo mínimo de `RESPALDO_LLAVE`. 24 caracteres es lo que da una frase con entropía suficiente
 * sin volverla imposible de teclear; la recomendación de la guía es generarla con
 * `openssl rand -base64 32` (44 caracteres).
 */
export const MINIMO_LLAVE = 24;

/**
 * Cuántos respaldos se conservan en R2, por defecto. **12 = un año** de respaldos mensuales.
 *
 * POR QUÉ SE CUENTAN RESPALDOS Y NO DÍAS: la frecuencia es configurable (`RESPALDO_CRON`), y una
 * retención en días cambiaría en silencio cuántas copias existen en cuanto alguien tocara el cron —
 * pasar de mensual a semanal con "30 días" dejaría 4 copias en vez de 12. Contando respaldos, la
 * promesa ("los últimos 12") se cumple con cualquier frecuencia.
 */
export const RETENCION_DEFECTO = 12;

/**
 * Cron por defecto: `0 8 1 * *` = **el día 1 de cada mes a las 08:00 UTC** = **02:00 del día 1, hora
 * del centro de México**.
 *
 * ES MENSUAL, no diario, y la razón es de reparto de trabajo (Gabriel, 17-ago-2026): **los respaldos
 * diarios de Railway ya están encendidos en todos los ambientes** y cubren el día a día. Esta copia
 * es el SEGUNDO respaldo del plan (§2.2, *"además de los backups de Railway"*), y su valor es el
 * caso en que **el problema sea Railway**: cuenta suspendida, servicio borrado, caída larga o mudanza
 * de proveedor. Para eso, una copia mensual fuera de su plataforma alcanza.
 *
 * ⚠️ Que sea mensual hace el aviso de fallo MÁS importante, no menos: si falla en enero, sin rastro
 * nadie se entera hasta que se necesite en junio. Por eso cada corrida deja fila en
 * `RespaldoCorrida` y renglón de bitácora.
 *
 * pg-boss evalúa los cron en UTC, así que la hora local va convertida a mano. México suprimió el
 * horario de verano en 2022: el centro del país está en UTC-6 TODO el año y esta conversión no se
 * desfasa en abril ni en octubre. Se eligió la madrugada porque es cuando el `pg_dump` compite con
 * menos capturas.
 */
export const CRON_DEFECTO = '0 8 1 * *';

/**
 * Margen, en minutos, que se le suma al tope del `pg_dump` para acotar la corrida COMPLETA: después
 * del volcado quedan el cifrado, la subida a R2 y la retención. Una hora sobra para un volcado
 * grande sobre una red lenta.
 */
export const MARGEN_CORRIDA_MIN = 60;

/**
 * Cuánto puede durar, como MÁXIMO, una corrida entera (volcado + cifrado + subida + retención).
 *
 * Es UN SOLO NÚMERO con dos usos que TIENEN que coincidir, y de no coincidir nació un defecto real:
 *  1. `expireInSeconds` del job de pg-boss — pasado este tiempo, la cola da el job por expirado y lo
 *     REINTENTA **sin matar al que sigue corriendo**. Su default son 15 min, muy por debajo de las
 *     3 h que permite `RESPALDO_TIMEOUT_MIN`: dos `pg_dump` a la vez, dos corridas compartiendo key
 *     (se pisan el objeto en R2) y el barrido de huérfanas cerrando como "muerta" una corrida VIVA.
 *  2. El umbral del barrido de huérfanas — sólo se cierra lo que lleva MÁS de esta ventana abierto,
 *     así una corrida legítima jamás es candidata.
 *
 * Mientras los dos salgan de aquí, no se pueden volver a contradecir.
 */
export function ventanaCorridaMinutos(
  env: Record<string, string | undefined> = process.env,
): number {
  return timeoutVolcadoMinutos(env) + MARGEN_CORRIDA_MIN;
}

/** Prefijo (carpeta lógica) donde viven los respaldos dentro del bucket R2. */
export const PREFIJO_DEFECTO = 'respaldos/bd';

/** Extensión de los objetos de respaldo: volcado `pg_dump` en formato custom, ya cifrado. */
export const EXTENSION_RESPALDO = '.dump.enc';

/** Configuración resuelta y validada del respaldo. */
export interface ConfigRespaldo {
  /** Frase de la que se deriva la llave AES (`RESPALDO_LLAVE`). NUNCA se loguea ni se audita. */
  frase: string;
  /** Cuántos respaldos se conservan en R2 (`RESPALDO_RETENCION`). */
  retencion: number;
  /** Carpeta lógica dentro del bucket (`RESPALDO_PREFIJO`). */
  prefijo: string;
  /** Cron UTC de la corrida (`RESPALDO_CRON`); por defecto, mensual. */
  cron: string;
  /** Ruta del ejecutable de `pg_dump` (`RESPALDO_PG_DUMP`), por si la imagen lo tiene fuera del PATH. */
  pgDump: string;
}

/**
 * Los mensajes de cada regla hablan del VALOR, no de la variable: el nombre de la variable lo
 * antepone {@link configRespaldoDesdeEnv} con la ruta del problema. Así, falte lo que falte —
 * incluida una variable AUSENTE, cuyo mensaje lo escribe Zod y no nosotros— el texto que acaba en
 * el log y en el rastro SIEMPRE dice de qué variable habla.
 */
const esquemaEnvRespaldo = z.object({
  RESPALDO_LLAVE: z
    .string()
    .min(
      MINIMO_LLAVE,
      `falta o es demasiado corta (mínimo ${String(MINIMO_LLAVE)} caracteres). Genérala con ` +
        '`openssl rand -base64 32` y guárdala FUERA de Railway: sin ella el respaldo es irrecuperable.',
    ),
  RESPALDO_RETENCION: z.coerce
    .number()
    .int('debe ser un número entero de respaldos a conservar.')
    .min(1, 'debe ser al menos 1 (con 0 no quedaría ningún respaldo).')
    .max(1000, 'no puede pasar de 1000 respaldos.')
    .default(RETENCION_DEFECTO),
  RESPALDO_PREFIJO: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/, 'inválido (minúsculas y "/", ej. "respaldos/bd").')
    .default(PREFIJO_DEFECTO),
  RESPALDO_CRON: z.string().trim().min(1, 'no puede ir vacío.').default(CRON_DEFECTO),
  RESPALDO_PG_DUMP: z.string().trim().min(1, 'no puede ir vacío.').default('pg_dump'),
});

/**
 * Lee y valida la configuración del respaldo desde el entorno. Lanza `ErrorValidacion` con el
 * detalle de qué falta (el mensaje se guarda tal cual en el rastro de la corrida, así que está
 * escrito para que Gabriel lo entienda sin abrir el código).
 */
export function configRespaldoDesdeEnv(
  env: Record<string, string | undefined> = process.env,
): ConfigRespaldo {
  // La llave AUSENTE se normaliza a cadena vacía para que caiga en la MISMA regla de largo mínimo
  // que una llave corta: así el mensaje explica qué poner, en vez del "expected string, received
  // undefined" de Zod, que a nadie le dice qué hacer. (Se hace aquí y no con `.default('')` en el
  // esquema porque `.default` de Zod NO revalida el valor por omisión: una llave vacía habría
  // pasado la validación y el respaldo se habría cifrado con una frase vacía.)
  const resultado = esquemaEnvRespaldo.safeParse({
    ...env,
    RESPALDO_LLAVE: env.RESPALDO_LLAVE ?? '',
  });
  if (!resultado.success) {
    // Se antepone SIEMPRE el nombre de la variable: sin eso, una variable ausente produce el
    // "expected string, received undefined" genérico de Zod y quien lea el log no sabe cuál poner.
    const detalle = resultado.error.issues
      .map((problema) => `${problema.path.join('.') || 'entorno'}: ${problema.message}`)
      .join(' · ');
    throw new ErrorValidacion(`Configuración del respaldo incompleta: ${detalle}`);
  }
  return {
    frase: resultado.data.RESPALDO_LLAVE,
    retencion: resultado.data.RESPALDO_RETENCION,
    prefijo: resultado.data.RESPALDO_PREFIJO,
    cron: resultado.data.RESPALDO_CRON,
    pgDump: resultado.data.RESPALDO_PG_DUMP,
  };
}

/** ¿El respaldo está encendido por configuración? Se apaga explícitamente con `RESPALDO_ACTIVO=false`. */
export function respaldoActivo(env: Record<string, string | undefined> = process.env): boolean {
  return env.RESPALDO_ACTIVO !== 'false';
}

/** Qué hacer con el respaldo al arrancar el servidor. */
export interface DecisionArranqueRespaldo {
  /**
   * `programar`  — todo en orden: se registra el job periódico.
   * `apagado`    — alguien lo apagó a propósito (`RESPALDO_ACTIVO=false`); se avisa y no se programa.
   * `sin-config` — SE QUISO programar pero falta configuración: NO se programa y se deja rastro ROJO
   *                (log + fila de `RespaldoCorrida` en FALLO + bitácora). Nunca se calla.
   */
  accion: 'programar' | 'apagado' | 'sin-config';
  /** Configuración resuelta (solo cuando `accion === 'programar'`). */
  config?: ConfigRespaldo;
  /** Mensaje para loguear/auditar. Vacío cuando `accion === 'programar'`. */
  mensaje?: string;
}

/**
 * Decide, sin efectos, si el respaldo se programa. Función PURA: el llamador
 * (`registrarRespaldoPeriodico`) ejecuta el efecto (loguear, dejar el rastro rojo, programar el cron).
 *
 * El orden de los rechazos va de lo más explícito a lo más sutil: primero "lo apagaron a propósito",
 * luego "el R2 de este ambiente no es real", luego "falta la llave o los parámetros".
 */
export function decidirArranqueRespaldo(
  env: Record<string, string | undefined> = process.env,
): DecisionArranqueRespaldo {
  if (!respaldoActivo(env)) {
    return {
      accion: 'apagado',
      mensaje:
        'Respaldo a R2 APAGADO por configuración (RESPALDO_ACTIVO=false). Este ambiente NO tiene ' +
        'segundo respaldo: el único que queda es el nativo de Railway — que no cubre el caso de que ' +
        'el problema SEA Railway (cuenta suspendida, servicio borrado, mudanza de proveedor).',
    };
  }

  if (credencialesR2SonDummy(env)) {
    return {
      accion: 'sin-config',
      mensaje:
        'Respaldo a R2 NO programado: las credenciales R2 de este ambiente son de relleno ' +
        '(R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY con valores dummy). Un respaldo que no puede ' +
        'subir a ningún lado no sirve. Configura el token S3 real del bucket, o apágalo a ' +
        'propósito con RESPALDO_ACTIVO=false.',
    };
  }

  if ((env.R2_BUCKET ?? '').trim() === '' || (env.R2_ACCOUNT_ID ?? '').trim() === '') {
    return {
      accion: 'sin-config',
      mensaje:
        'Respaldo a R2 NO programado: faltan R2_ACCOUNT_ID y/o R2_BUCKET (no hay bucket destino).',
    };
  }

  if (env.R2_SUBIDA_LOCAL === 'true') {
    return {
      accion: 'sin-config',
      mensaje:
        'Respaldo a R2 NO programado: R2_SUBIDA_LOCAL=true marca este ambiente como dev/CI, donde ' +
        'las subidas server-side son un NO-OP. Un respaldo "subido" a la nada es peor que ninguno.',
    };
  }

  try {
    return { accion: 'programar', config: configRespaldoDesdeEnv(env) };
  } catch (error) {
    return {
      accion: 'sin-config',
      mensaje: `Respaldo a R2 NO programado: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
