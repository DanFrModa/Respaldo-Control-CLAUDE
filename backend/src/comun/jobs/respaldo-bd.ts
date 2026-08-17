/**
 * SEGUNDO RESPALDO: copia MENSUAL cifrada a R2 (V1-E6a — PLANMAESTRO §2.2 "respaldo doble" y §11;
 * mitigación #1 de la tabla de riesgos de §14; `HOJA-DE-RUTA.md` §4; `docs/hoja-de-ruta/V1-etapas.md`
 * §V1-E6 punto 3).
 *
 * POR QUÉ EXISTE, y por qué MENSUAL (Gabriel, 17-ago-2026): **los respaldos diarios de Railway ya
 * están encendidos en todos los ambientes** y cubren el día a día —un borrado torpe, una migración
 * que salió mal—. Lo que NO cubren es que el problema SEA Railway: cuenta suspendida, servicio
 * borrado por error, caída larga, o la decisión de mudarse de proveedor. Para ese escenario hace
 * falta una copia PROPIA, cifrada y en otra casa; y para ese escenario, una copia mensual alcanza.
 * La frecuencia es configurable (`RESPALDO_CRON`) por si Gabriel la quiere ajustar sin desplegar.
 *
 * QUÉ HACE EN CADA CORRIDA (madrugada del día 1, hora del centro de México; ver `CRON_DEFECTO`):
 *   1. `pg_dump` de la base completa → archivo temporal (`comun/respaldo/pg-dump.ts`).
 *   2. Lo cifra con AES-256-GCM (`comun/respaldo/cifrado.ts`).
 *   3. Lo sube a R2 con una key ordenable por fecha.
 *   4. **VERIFICA** que el objeto quedó allá, preguntándole a R2 su tamaño (HeadObject) y
 *      comparándolo con el del archivo local.
 *   5. Borra los respaldos que sobran del tope de retención (`comun/respaldo/retencion.ts`).
 *   6. Escriba lo que escriba el resultado, deja RASTRO.
 *
 * ⭐ EL REQUISITO QUE MANDA: **QUE NO FALLE EN SILENCIO.** Un respaldo que falla callado es peor que
 * no tener respaldo, porque genera confianza falsa. Por eso:
 *   • Cada corrida escribe una fila en `RespaldoCorrida` (cuándo, si subió, cuánto pesó, en qué paso
 *     tronó y con qué error) — el rastro estructurado.
 *   • Y ADEMÁS un renglón de `Bitacora` con entidad `RespaldoBd`, que se ve en la **pantalla de
 *     consulta de bitácora que ya existe** (Administración › Bitácora, permiso `admin.ver-bitacora`,
 *     F6-E1): filtrando por esa entidad se ve la lista de corridas sin construir pantalla nueva ni
 *     tocar el contrato. Es el patrón que el sistema ya usa para los hechos de fondo (el barrido de
 *     riesgo de la RC hace lo mismo).
 *   • Y un `log.error` en el log del servicio de Railway.
 *   • Un fallo se PROPAGA al worker de pg-boss, que reintenta: cada reintento vuelve a dejar rastro.
 *   • Si el respaldo ni siquiera se puede PROGRAMAR (falta la llave, el R2 de este ambiente es de
 *     relleno), el arranque deja una corrida en FALLO con paso `CONFIGURACION`. La ausencia de
 *     respaldo también se ve, en el mismo lugar donde se ven los fallos.
 *
 * ⚠️ Esto es AVISO PASIVO: alguien tiene que ir a mirar. No hay correo ni push (el plan los difirió
 * a una fase posterior). Con corridas MENSUALES eso pesa más, no menos: si falla en enero y nadie
 * mira, se descubre en junio. Mientras no haya notificación activa, la revisión del rastro
 * (Administración › Bitácora, entidad `RespaldoBd`) es parte del procedimiento, no un extra.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PasoRespaldo, type Prisma } from '../../datos/index.js';
import { configR2DesdeEnv, servicioArchivos } from '../archivos.js';
import { registrarBitacora } from '../auditoria.js';
import { cifrarArchivo } from '../respaldo/cifrado.js';
import {
  decidirArranqueRespaldo,
  type ConfigRespaldo,
  configRespaldoDesdeEnv,
} from '../respaldo/config.js';
import { generarVolcado, versionPgDump } from '../respaldo/pg-dump.js';
import { claveRespaldo, seleccionarObsoletos, type ObjetoRespaldo } from '../respaldo/retencion.js';
import { enTransaccion, type ContextoBd } from '../transaccion.js';

import { COLAS_JOBS, motorJobs } from './index.js';

/** Tipo MIME del objeto en R2: binario opaco (va cifrado, no es un `application/sql`). */
const MIME_RESPALDO = 'application/octet-stream';

/** Lo mínimo que el respaldo necesita del almacén de objetos (inyectable: las pruebas lo falsean). */
export interface AlmacenRespaldos {
  /** Bucket destino (solo para dejarlo escrito en el rastro). */
  bucket: string;
  /** Sube el archivo local a esa key exacta. Devuelve los bytes enviados. */
  subirArchivo(key: string, ruta: string, tipoMime: string): Promise<number>;
  /** Tamaño que reporta el almacén para esa key, o `null` si el objeto NO está. */
  tamanoObjeto(key: string): Promise<number | null>;
  /** Objetos existentes bajo el prefijo (para la retención). */
  listarObjetos(prefijo: string): Promise<ObjetoRespaldo[]>;
  /** Borra un objeto por su key. */
  eliminarObjeto(key: string): Promise<void>;
}

/** Lo que se guarda de una corrida (lo consume {@link persistirCorrida}). */
export interface RegistroCorrida {
  iniciadoEn: Date;
  terminadoEn: Date;
  estado: 'EXITO' | 'FALLO';
  paso: PasoRespaldo;
  bucket?: string;
  key?: string;
  tamanoDumpBytes?: number;
  tamanoSubidoBytes?: number;
  objetosBorrados: number;
  duracionMs: number;
  error?: string;
}

/** Dependencias del respaldo. Todas inyectables para poder probar los caminos de fallo sin R2. */
export interface DepsRespaldo {
  config: ConfigRespaldo;
  almacen: AlmacenRespaldos;
  // Todas las dependencias se declaran como PROPIEDADES de tipo función (`nombre: (…) => …`) y no
  // con la forma abreviada de método (`nombre(…): …`): el cuerpo las toma sueltas del objeto
  // (`const cifrar = deps.cifrar ?? …`) y la forma de método las ata a un `this` que aquí no existe.
  /** Genera el volcado en `destino` y devuelve su tamaño en bytes. */
  generarVolcado: (destino: string) => Promise<number>;
  /** Cifra `origen` en `destino` y devuelve el tamaño del cifrado. */
  cifrar?: (origen: string, destino: string, frase: string) => Promise<number>;
  /** Reloj (las pruebas lo fijan para razonar sobre la retención). */
  ahora?: () => Date;
  /** Directorio base para los temporales (por defecto el del sistema). */
  dirTemporal?: string;
  /** Persiste el rastro de la corrida. Por defecto escribe en `RespaldoCorrida` + `Bitacora`. */
  persistir?: (registro: RegistroCorrida) => Promise<void>;
  /** Hook de log (el servidor inyecta el suyo). */
  registrarError?: (mensaje: string, error: unknown) => void;
}

/** Resultado de una corrida (lo mismo que se persiste, para que el llamador decida si relanza). */
export type ResultadoRespaldo = RegistroCorrida;

/**
 * Escribe el rastro de una corrida: la fila estructurada en `RespaldoCorrida` **y** el renglón de
 * `Bitacora` (entidad `RespaldoBd`), los dos en la MISMA transacción (A2/A7) para que no pueda
 * quedar uno sin el otro. `sesion` va en `null`: es un proceso del sistema, igual que el barrido de
 * riesgo de la RC.
 *
 * La acción de bitácora distingue de un vistazo: `CREAR` cuando el respaldo se creó de verdad,
 * `OTRO` cuando la corrida terminó en fallo (no se creó nada).
 */
export async function persistirCorrida(registro: RegistroCorrida, bd?: ContextoBd): Promise<void> {
  await enTransaccion(async (tx) => {
    const fila = await tx.respaldoCorrida.create({
      data: {
        iniciadoEn: registro.iniciadoEn,
        terminadoEn: registro.terminadoEn,
        estado: registro.estado,
        paso: registro.paso,
        bucket: registro.bucket ?? null,
        key: registro.key ?? null,
        tamanoDumpBytes:
          registro.tamanoDumpBytes === undefined ? null : BigInt(registro.tamanoDumpBytes),
        tamanoSubidoBytes:
          registro.tamanoSubidoBytes === undefined ? null : BigInt(registro.tamanoSubidoBytes),
        objetosBorrados: registro.objetosBorrados,
        duracionMs: registro.duracionMs,
        error: registro.error ?? null,
      },
      select: { id: true },
    });

    const datos: Prisma.InputJsonValue = {
      estado: registro.estado,
      paso: registro.paso,
      bucket: registro.bucket ?? null,
      key: registro.key ?? null,
      tamanoDumpBytes: registro.tamanoDumpBytes ?? null,
      tamanoSubidoBytes: registro.tamanoSubidoBytes ?? null,
      objetosBorrados: registro.objetosBorrados,
      duracionMs: registro.duracionMs,
      error: registro.error ?? null,
    };
    await registrarBitacora(tx, null, {
      entidad: 'RespaldoBd',
      idEntidad: fila.id,
      accion: registro.estado === 'EXITO' ? 'CREAR' : 'OTRO',
      datos,
    });
  }, bd);
}

/**
 * CUERPO del respaldo (sin pg-boss): hace el volcado, lo cifra, lo sube, **verifica que quedó**,
 * aplica la retención y deja el rastro. NO lanza: devuelve el resultado con su `estado`, para que el
 * llamador decida (el worker de pg-boss relanza, y así pg-boss reintenta).
 *
 * Los temporales viven en un directorio propio que se borra SIEMPRE (`finally`): un volcado de la
 * base entera olvidado en el disco del contenedor sería una fuga de datos y, además, llenaría el
 * disco a las pocas corridas.
 *
 * @example
 * // Corrida manual desde una consola del backend, con todo real:
 * await ejecutarRespaldoBd(depsRespaldoDesdeEnv());
 */
export async function ejecutarRespaldoBd(deps: DepsRespaldo): Promise<ResultadoRespaldo> {
  const reloj = deps.ahora ?? ((): Date => new Date());
  const cifrar = deps.cifrar ?? cifrarArchivo;
  const persistir = deps.persistir ?? persistirCorrida;
  const registrarError =
    deps.registrarError ??
    ((mensaje, error): void => {
      console.error(mensaje, error);
    });

  const iniciadoEn = reloj();
  const arranque = Date.now();
  let paso: PasoRespaldo = PasoRespaldo.VOLCADO;
  let tamanoDumpBytes: number | undefined;
  let tamanoSubidoBytes: number | undefined;
  let key: string | undefined;
  let objetosBorrados = 0;

  const carpeta = await mkdtemp(join(deps.dirTemporal ?? tmpdir(), 'control-respaldo-'));
  try {
    const rutaVolcado = join(carpeta, 'control.dump');
    const rutaCifrada = join(carpeta, 'control.dump.enc');

    // 1. Volcado.
    tamanoDumpBytes = await deps.generarVolcado(rutaVolcado);

    // 2. Cifrado.
    paso = PasoRespaldo.CIFRADO;
    const tamanoCifrado = await cifrar(rutaVolcado, rutaCifrada, deps.config.frase);

    // 3. Subida.
    paso = PasoRespaldo.SUBIDA;
    key = claveRespaldo(deps.config.prefijo, iniciadoEn);
    await deps.almacen.subirArchivo(key, rutaCifrada, MIME_RESPALDO);

    // 4. VERIFICACIÓN. Que el PUT no haya lanzado NO prueba que el objeto esté: se le pregunta a R2.
    //    Y no basta con que exista — si el tamaño no cuadra, la transferencia se cortó a la mitad y
    //    ese archivo NO se puede descifrar (GCM lo rechazaría al restaurar, cuando ya sería tarde).
    paso = PasoRespaldo.VERIFICACION;
    const tamanoEnR2 = await deps.almacen.tamanoObjeto(key);
    if (tamanoEnR2 === null) {
      throw new Error(
        `El almacén aceptó la subida pero el objeto "${key}" NO ESTÁ en el bucket ` +
          `"${deps.almacen.bucket}". El respaldo de esta corrida NO existe.`,
      );
    }
    if (tamanoEnR2 !== tamanoCifrado) {
      throw new Error(
        `El objeto "${key}" quedó INCOMPLETO en el bucket "${deps.almacen.bucket}": se subieron ` +
          `${String(tamanoCifrado)} bytes y el almacén reporta ${String(tamanoEnR2)}. Un respaldo ` +
          'truncado no se puede descifrar.',
      );
    }
    tamanoSubidoBytes = tamanoEnR2;

    // 5. Retención. Va DESPUÉS de verificar, nunca antes: primero se confirma que el respaldo nuevo
    //    existe de verdad y solo entonces se toca uno viejo.
    paso = PasoRespaldo.RETENCION;
    const existentes = await deps.almacen.listarObjetos(deps.config.prefijo);
    const obsoletos = seleccionarObsoletos(existentes, deps.config.prefijo, {
      retencion: deps.config.retencion,
      ahora: reloj(),
      keyProtegida: key,
    });
    for (const keyVieja of obsoletos) {
      try {
        await deps.almacen.eliminarObjeto(keyVieja);
        objetosBorrados += 1;
      } catch (error) {
        // Que no se pueda borrar un respaldo viejo NO tumba la corrida: el respaldo de hoy ya está
        // arriba y verificado, que es lo que importa. Se loguea y se sigue (a lo sumo, el bucket
        // guarda de más).
        registrarError(`Respaldo: no se pudo borrar el respaldo viejo "${keyVieja}".`, error);
      }
    }

    const terminadoEn = reloj();
    const resultado: ResultadoRespaldo = {
      iniciadoEn,
      terminadoEn,
      estado: 'EXITO',
      paso: PasoRespaldo.RETENCION,
      bucket: deps.almacen.bucket,
      key,
      tamanoDumpBytes,
      tamanoSubidoBytes,
      objetosBorrados,
      duracionMs: Date.now() - arranque,
    };
    await persistir(resultado);
    return resultado;
  } catch (error) {
    const resultado: ResultadoRespaldo = {
      iniciadoEn,
      terminadoEn: reloj(),
      estado: 'FALLO',
      paso,
      bucket: deps.almacen.bucket,
      ...(key === undefined ? {} : { key }),
      ...(tamanoDumpBytes === undefined ? {} : { tamanoDumpBytes }),
      ...(tamanoSubidoBytes === undefined ? {} : { tamanoSubidoBytes }),
      objetosBorrados,
      duracionMs: Date.now() - arranque,
      error: error instanceof Error ? error.message : String(error),
    };
    registrarError(`⛔ RESPALDO A R2 FALLIDO en el paso ${paso}. LA BASE NO SE RESPALDÓ.`, error);
    // El rastro es lo último que puede fallar, y si falla NO puede tapar el error original.
    try {
      await persistir(resultado);
    } catch (errorRastro) {
      registrarError(
        '⛔ RESPALDO A R2: además, no se pudo guardar el rastro de la corrida fallida.',
        errorRastro,
      );
    }
    return resultado;
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
}

/**
 * Arma las dependencias REALES desde el entorno: `pg_dump` sobre `DATABASE_URL` y el servicio de
 * archivos apuntado al bucket R2 del ambiente. Se usa en el arranque del servidor y en la corrida
 * manual del script de restauración/ensayo.
 */
export function depsRespaldoDesdeEnv(
  config: ConfigRespaldo = configRespaldoDesdeEnv(),
  registrarError?: (mensaje: string, error: unknown) => void,
): DepsRespaldo {
  const archivos = servicioArchivos();
  const { bucket } = configR2DesdeEnv();
  return {
    config,
    almacen: {
      bucket,
      subirArchivo: (key, ruta, tipoMime) => archivos.subirArchivoDesdeRuta(key, ruta, tipoMime),
      tamanoObjeto: (key) => archivos.tamanoObjeto(key),
      listarObjetos: (prefijo) => archivos.listarObjetos(prefijo),
      eliminarObjeto: (key) => archivos.eliminarObjeto(key),
    },
    generarVolcado: async (destino) => {
      const url = process.env.DATABASE_URL;
      if (url === undefined || url === '') {
        throw new Error('Respaldo: falta DATABASE_URL; no hay base que volcar.');
      }
      return generarVolcado({ url, destino, ejecutable: config.pgDump });
    },
    ...(registrarError === undefined ? {} : { registrarError }),
  };
}

/**
 * Deja el rastro ROJO de "el respaldo NO está programado" (falta configuración). Se llama en el
 * arranque: la AUSENCIA de respaldo tiene que verse en el mismo sitio donde se ven sus fallos, no
 * solo en un log que se pierde entre miles de líneas.
 */
async function registrarFaltaDeConfiguracion(mensaje: string): Promise<void> {
  const ahora = new Date();
  await persistirCorrida({
    iniciadoEn: ahora,
    terminadoEn: ahora,
    estado: 'FALLO',
    paso: PasoRespaldo.CONFIGURACION,
    objetosBorrados: 0,
    duracionMs: 0,
    error: mensaje,
  });
}

/**
 * Cablea el respaldo a pg-boss: registra el WORKER de la cola y programa su cron (mensual por
 * defecto). Espejo de
 * `riesgo-rc.ts` / `refrescar-kpis.ts`. Idempotente (re-programar la misma cola/cron reemplaza el
 * schedule). NO-OP si el motor de jobs está inactivo (tests/CI: `JOBS_ACTIVOS=false`) — lo testeable
 * sin pg-boss es el CUERPO (`ejecutarRespaldoBd`), que se invoca directo con sus dependencias.
 *
 * Si la configuración NO alcanza, **no se programa nada** y se deja constancia (log + fila en
 * FALLO). Nunca se programa "a medias" ni se calla.
 *
 * @param registrarError hook para logear (el servidor inyecta el suyo).
 */
export async function registrarRespaldoPeriodico(
  registrarError: (mensaje: string, error: unknown) => void = (msg, err) => {
    console.error(msg, err);
  },
): Promise<void> {
  const boss = motorJobs();
  if (boss === null) {
    return; // motor inactivo (tests/CI): nada que programar.
  }

  const decision = decidirArranqueRespaldo();
  // Se exige la configuración RESUELTA, no solo la etiqueta: un `programar` sin config sería un bug
  // de la decisión, y ante la duda se trata como "no configurado" (deja rastro) en vez de arrancar a
  // ciegas o tumbar el proceso con un cast optimista.
  const config = decision.accion === 'programar' ? decision.config : undefined;
  if (config === undefined) {
    const mensaje = decision.mensaje ?? 'Respaldo a R2 no programado (configuración no resuelta).';
    registrarError(`⛔ ${mensaje}`, undefined);
    if (decision.accion !== 'apagado') {
      // Apagado a propósito NO deja rastro rojo (es una decisión, no un problema). Cualquier otro
      // caso sí: la AUSENCIA de respaldo tiene que verse donde se ven sus fallos.
      try {
        await registrarFaltaDeConfiguracion(mensaje);
      } catch (error) {
        registrarError('Respaldo: no se pudo registrar la falta de configuración.', error);
      }
    }
    return;
  }

  // Aviso temprano y barato: si `pg_dump` no está en la imagen, se sabe AL ARRANCAR y no a las 2 de
  // la mañana. No impide programar (el fallo real quedará con su rastro), pero el log lo dice.
  const version = await versionPgDump(config.pgDump);
  if (version === null) {
    registrarError(
      `⛔ Respaldo a R2: "${config.pgDump}" no está disponible en esta imagen. El respaldo se ` +
        'programó igual, pero fallará en cada corrida hasta que se instale el cliente de PostgreSQL.',
      undefined,
    );
  }

  try {
    await boss.work(COLAS_JOBS.respaldoBd, { localConcurrency: 1, batchSize: 1 }, async () => {
      const resultado = await ejecutarRespaldoBd(depsRespaldoDesdeEnv(config, registrarError));
      if (resultado.estado === 'FALLO') {
        // Se PROPAGA a propósito: pg-boss marca el job como fallido (queda en su tabla) y lo
        // reintenta. Cada reintento vuelve a dejar rastro; tragarse el error aquí haría que el
        // respaldo se viera "hecho" desde la cola.
        throw new Error(`Respaldo a R2 fallido (${resultado.paso}): ${resultado.error ?? ''}`);
      }
    });
    await boss.schedule(COLAS_JOBS.respaldoBd, config.cron);
  } catch (error) {
    registrarError(
      '⛔ No se pudo programar el respaldo a R2 (la app sigue SIN segundo respaldo):',
      error,
    );
  }
}
