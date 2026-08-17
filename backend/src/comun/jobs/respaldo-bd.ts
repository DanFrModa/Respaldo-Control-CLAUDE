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
 *   • **La fila se abre AL EMPEZAR (`EN_CURSO`) y se cierra al terminar.** Una corrida que muere a
 *     media —redeploy, OOM, `SIGKILL` durante el `pg_dump`, que es el paso largo— deja una fila
 *     colgada que se ve, y la corrida siguiente la cierra como `FALLO`. Sin eso, esa muerte no
 *     dejaba ni una línea y el mes siguiente todo parecía normal.
 *   • **Si el respaldo ni siquiera se puede PROGRAMAR, también hay rastro**, y en los TRES modos de
 *     no programarse: falta configuración (`CONFIGURACION`), el motor de jobs no levantó
 *     (`PROGRAMACION`) o el `schedule` tronó (`PROGRAMACION`). El único caso sin rastro es apagarlo
 *     a propósito con `RESPALDO_ACTIVO=false`, que es una decisión y no un fallo.
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
import { cifrarArchivo, type ArchivoCifrado } from '../respaldo/cifrado.js';
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
  /** SHA-256 (hex) del archivo cifrado que se subió. */
  sha256?: string;
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
  /** Cifra `origen` en `destino` y devuelve su tamaño y su huella SHA-256. */
  cifrar?: (origen: string, destino: string, frase: string) => Promise<ArchivoCifrado>;
  /** Reloj (las pruebas lo fijan para razonar sobre la retención). */
  ahora?: () => Date;
  /** Directorio base para los temporales (por defecto el del sistema). */
  dirTemporal?: string;
  /**
   * ABRE el rastro: deja la fila `EN_CURSO` ANTES de empezar y devuelve su id. Es lo que hace que
   * una corrida que MUERE A MEDIA (redeploy, OOM, SIGKILL durante el `pg_dump`) deje huella.
   * Devolver `null` significa "no se pudo abrir"; la corrida sigue igual (el respaldo importa más
   * que su bitácora) y al cerrar se creará la fila entera.
   */
  iniciarRastro?: (iniciadoEn: Date) => Promise<bigint | null>;
  /**
   * CIERRA el rastro: actualiza la fila abierta (o la crea, si no hubo) y escribe la bitácora.
   * Por defecto, `persistirCorrida`.
   */
  persistir?: (registro: RegistroCorrida, idAbierto: bigint | null) => Promise<void>;
  /** Hook de log (el servidor inyecta el suyo). */
  registrarError?: (mensaje: string, error: unknown) => void;
}

/** Resultado de una corrida (lo mismo que se persiste, para que el llamador decida si relanza). */
export type ResultadoRespaldo = RegistroCorrida;

/** Campos de `RespaldoCorrida` comunes al alta y a la actualización. */
function datosDeCorrida(registro: RegistroCorrida): {
  terminadoEn: Date;
  estado: RegistroCorrida['estado'];
  paso: PasoRespaldo;
  bucket: string | null;
  key: string | null;
  tamanoDumpBytes: bigint | null;
  tamanoSubidoBytes: bigint | null;
  sha256: string | null;
  objetosBorrados: number;
  duracionMs: number;
  error: string | null;
} {
  return {
    terminadoEn: registro.terminadoEn,
    estado: registro.estado,
    paso: registro.paso,
    bucket: registro.bucket ?? null,
    key: registro.key ?? null,
    tamanoDumpBytes:
      registro.tamanoDumpBytes === undefined ? null : BigInt(registro.tamanoDumpBytes),
    tamanoSubidoBytes:
      registro.tamanoSubidoBytes === undefined ? null : BigInt(registro.tamanoSubidoBytes),
    sha256: registro.sha256 ?? null,
    objetosBorrados: registro.objetosBorrados,
    duracionMs: registro.duracionMs,
    error: registro.error ?? null,
  };
}

/**
 * ABRE el rastro de una corrida: deja la fila en `EN_CURSO` **antes** de empezar a trabajar, y de
 * paso cierra como `FALLO` las corridas que quedaron abiertas de veces anteriores.
 *
 * POR QUÉ SE ESCRIBE AL EMPEZAR Y NO SÓLO AL TERMINAR: el `pg_dump` es el paso largo. Un redeploy,
 * un OOM o un `SIGKILL` a media corrida no dejarían NI UNA LÍNEA si la fila se escribiera al final —
 * y el mes siguiente todo parecería normal. Con la fila abierta, esa muerte se ve: primero como una
 * corrida `EN_CURSO` que lleva horas, y después como el `FALLO` que le pone la siguiente corrida.
 *
 * Las corridas huérfanas se cierran con su bitácora, para que aparezcan donde se mira.
 */
export async function iniciarCorrida(iniciadoEn: Date, bd?: ContextoBd): Promise<bigint> {
  return enTransaccion(async (tx) => {
    const huerfanas = await tx.respaldoCorrida.findMany({
      where: { estado: 'EN_CURSO' },
      select: { id: true, iniciadoEn: true },
    });
    for (const huerfana of huerfanas) {
      await tx.respaldoCorrida.update({
        where: { id: huerfana.id },
        data: {
          estado: 'FALLO',
          terminadoEn: iniciadoEn,
          error:
            'La corrida quedó SIN TERMINAR (el proceso murió a media: redeploy, falta de memoria o ' +
            'apagado del contenedor). Se cerró al arrancar la corrida siguiente.',
        },
      });
      await registrarBitacora(tx, null, {
        entidad: 'RespaldoBd',
        idEntidad: huerfana.id,
        accion: 'OTRO',
        datos: { estado: 'FALLO', motivo: 'corrida-sin-terminar' },
      });
    }

    const fila = await tx.respaldoCorrida.create({
      data: { iniciadoEn, estado: 'EN_CURSO', paso: PasoRespaldo.VOLCADO, objetosBorrados: 0 },
      select: { id: true },
    });
    return fila.id;
  }, bd);
}

/**
 * CIERRA el rastro de una corrida: actualiza la fila abierta —o la crea entera si no la hubo, que
 * es el caso de los fallos de arranque— **y** escribe el renglón de `Bitacora` (entidad
 * `RespaldoBd`), los dos en la MISMA transacción (A2/A7) para que no pueda quedar uno sin el otro.
 * `sesion` va en `null`: es un proceso del sistema, igual que el barrido de riesgo de la RC.
 *
 * La acción de bitácora distingue de un vistazo: `CREAR` cuando el respaldo se creó de verdad,
 * `OTRO` cuando la corrida terminó en fallo (no se creó nada).
 */
export async function persistirCorrida(
  registro: RegistroCorrida,
  idAbierto: bigint | null = null,
  bd?: ContextoBd,
): Promise<void> {
  await enTransaccion(async (tx) => {
    const datos = datosDeCorrida(registro);
    const id =
      idAbierto === null
        ? (
            await tx.respaldoCorrida.create({
              data: { iniciadoEn: registro.iniciadoEn, ...datos },
              select: { id: true },
            })
          ).id
        : (
            await tx.respaldoCorrida.update({
              where: { id: idAbierto },
              data: datos,
              select: { id: true },
            })
          ).id;

    const datosBitacora: Prisma.InputJsonValue = {
      estado: registro.estado,
      paso: registro.paso,
      bucket: registro.bucket ?? null,
      key: registro.key ?? null,
      tamanoDumpBytes: registro.tamanoDumpBytes ?? null,
      tamanoSubidoBytes: registro.tamanoSubidoBytes ?? null,
      sha256: registro.sha256 ?? null,
      objetosBorrados: registro.objetosBorrados,
      duracionMs: registro.duracionMs,
      error: registro.error ?? null,
    };
    await registrarBitacora(tx, null, {
      entidad: 'RespaldoBd',
      idEntidad: id,
      accion: registro.estado === 'EXITO' ? 'CREAR' : 'OTRO',
      datos: datosBitacora,
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
  const iniciar = deps.iniciarRastro ?? ((momento: Date) => iniciarCorrida(momento));
  const persistir =
    deps.persistir ??
    ((registro: RegistroCorrida, id: bigint | null) => persistirCorrida(registro, id));
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
  let sha256: string | undefined;
  let key: string | undefined;
  let objetosBorrados = 0;
  // `carpeta` se declara FUERA del try para que el `finally` pueda borrarla, pero se CREA DENTRO:
  // `mkdtemp` puede fallar (disco lleno, TMPDIR mal puesto) y si estuviera fuera del try esa
  // excepción se saltaría el rastro y subiría al worker — rompiendo el contrato de esta función
  // ("NO lanza") justo en el único escenario de la lista que se perdía.
  let carpeta: string | undefined;

  // El rastro se ABRE antes de trabajar: si el proceso muere a media (el `pg_dump` es el paso
  // largo), queda una fila EN_CURSO en vez de ningún registro. Si ni esto se puede escribir, la
  // corrida sigue igual: el respaldo importa más que su bitácora.
  let idAbierto: bigint | null = null;
  try {
    idAbierto = (await iniciar(iniciadoEn)) ?? null;
  } catch (error) {
    registrarError('Respaldo: no se pudo abrir el rastro de la corrida (la corrida sigue).', error);
  }

  try {
    carpeta = await mkdtemp(join(deps.dirTemporal ?? tmpdir(), 'control-respaldo-'));
    const rutaVolcado = join(carpeta, 'control.dump');
    const rutaCifrada = join(carpeta, 'control.dump.enc');

    // 1. Volcado.
    tamanoDumpBytes = await deps.generarVolcado(rutaVolcado);

    // 2. Cifrado (deja de paso la huella SHA-256 de lo que se va a subir).
    paso = PasoRespaldo.CIFRADO;
    const cifrado = await cifrar(rutaVolcado, rutaCifrada, deps.config.frase);
    const tamanoCifrado = cifrado.bytes;
    sha256 = cifrado.sha256;

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
      ...(sha256 === undefined ? {} : { sha256 }),
      objetosBorrados,
      duracionMs: Date.now() - arranque,
    };
    await persistir(resultado, idAbierto);
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
      ...(sha256 === undefined ? {} : { sha256 }),
      objetosBorrados,
      duracionMs: Date.now() - arranque,
      error: error instanceof Error ? error.message : String(error),
    };
    registrarError(`⛔ RESPALDO A R2 FALLIDO en el paso ${paso}. LA BASE NO SE RESPALDÓ.`, error);
    // El rastro es lo último que puede fallar, y si falla NO puede tapar el error original.
    try {
      await persistir(resultado, idAbierto);
    } catch (errorRastro) {
      registrarError(
        '⛔ RESPALDO A R2: además, no se pudo guardar el rastro de la corrida fallida.',
        errorRastro,
      );
    }
    return resultado;
  } finally {
    if (carpeta !== undefined) {
      await rm(carpeta, { recursive: true, force: true });
    }
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
 * Deja el rastro ROJO de "el respaldo NO quedó programado". Se llama en el arranque: la AUSENCIA de
 * respaldo tiene que verse en el MISMO sitio donde se ven sus fallos, no sólo en un log que se
 * pierde entre miles de líneas.
 *
 * @param paso `CONFIGURACION` si falta una variable; `PROGRAMACION` si la configuración estaba bien
 *   pero no se pudo dejar programado (el motor de jobs no levantó, o `schedule` falló).
 */
async function registrarNoProgramado(mensaje: string, paso: PasoRespaldo): Promise<void> {
  const ahora = new Date();
  await persistirCorrida({
    iniciadoEn: ahora,
    terminadoEn: ahora,
    estado: 'FALLO',
    paso,
    objetosBorrados: 0,
    duracionMs: 0,
    error: mensaje,
  });
}

/**
 * Cablea el respaldo a pg-boss: registra el WORKER de la cola y programa su cron (mensual por
 * defecto). Espejo de `riesgo-rc.ts` / `refrescar-kpis.ts`. Idempotente (re-programar la misma
 * cola/cron reemplaza el schedule).
 *
 * ⚠️ EL ORDEN IMPORTA, Y ES DELIBERADO: se DECIDE primero y se mira el motor de jobs después. Al
 * revés —que es como nació— un motor caído hacía salir la función sin log, sin fila y sin bitácora:
 * el sistema se quedaba sin respaldo y el lugar designado para enterarse estaba VACÍO. Y no es
 * hipotético aquí: el backend arranca antes de que `postgres.railway.internal` responda,
 * `iniciarMotorJobs` cae en su `catch`, deja `boss = null` y la app SIGUE SIRVIENDO (la cicatriz de
 * `CLAUDE.md` §8, "arranque resiliente a la BD"). Desde ese momento no habría respaldo, en silencio.
 *
 * Los cuatro desenlaces, todos con rastro salvo el que es una decisión:
 *  • apagado a propósito (`RESPALDO_ACTIVO=false`) → log, SIN fila (no es un problema).
 *  • falta configuración                          → log + fila `FALLO`/`CONFIGURACION`.
 *  • configuración OK pero sin motor de jobs      → log + fila `FALLO`/`PROGRAMACION`.
 *  • `schedule` truena                            → log + fila `FALLO`/`PROGRAMACION`.
 *
 * Seguro para local/CI: ahí `RESPALDO_ACTIVO=false` (`docker-compose.yml`), que cae en "apagado" y
 * no escribe nada.
 *
 * @param registrarError hook para logear (el servidor inyecta el suyo).
 */
export async function registrarRespaldoPeriodico(
  registrarError: (mensaje: string, error: unknown) => void = (msg, err) => {
    console.error(msg, err);
  },
): Promise<void> {
  const decision = decidirArranqueRespaldo();

  // Apagado a propósito: se avisa y punto. No deja rastro rojo porque no es un fallo, es una
  // decisión de quien configuró el ambiente.
  if (decision.accion === 'apagado') {
    registrarError(`⛔ ${decision.mensaje ?? 'Respaldo a R2 apagado.'}`, undefined);
    return;
  }

  /** Loguea y deja la fila roja; si ni la fila se puede escribir, al menos queda el log. */
  const dejarRastroRojo = async (mensaje: string, paso: PasoRespaldo): Promise<void> => {
    registrarError(`⛔ ${mensaje}`, undefined);
    try {
      await registrarNoProgramado(mensaje, paso);
    } catch (error) {
      registrarError('Respaldo: además, no se pudo registrar que NO quedó programado.', error);
    }
  };

  // Se exige la configuración RESUELTA, no sólo la etiqueta: un `programar` sin config sería un bug
  // de la decisión, y ante la duda se trata como "no configurado" (deja rastro) en vez de arrancar a
  // ciegas o tumbar el proceso con un cast optimista.
  const config = decision.accion === 'programar' ? decision.config : undefined;
  if (config === undefined) {
    await dejarRastroRojo(
      decision.mensaje ?? 'Respaldo a R2 NO programado (configuración no resuelta).',
      PasoRespaldo.CONFIGURACION,
    );
    return;
  }

  const boss = motorJobs();
  if (boss === null) {
    await dejarRastroRojo(
      'Respaldo a R2 NO programado: la configuración está COMPLETA pero el motor de jobs (pg-boss) ' +
        'no está disponible — no levantó al arrancar, o JOBS_ACTIVOS=false. El sistema se queda SIN ' +
        'segundo respaldo hasta que se reinicie el backend con la base alcanzable.',
      PasoRespaldo.PROGRAMACION,
    );
    return;
  }

  // Aviso temprano y barato: si `pg_dump` no está en la imagen, se sabe AL ARRANCAR y no la
  // madrugada de la corrida. No impide programar (el fallo real quedará con su rastro), pero el log
  // lo dice.
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
    // Mismo rastro rojo que un motor ausente: el resultado para el negocio es idéntico —no hay
    // respaldo programado— y antes esto sólo dejaba un `log.error`.
    await dejarRastroRojo(
      'Respaldo a R2 NO programado: la configuración está completa pero falló al registrar el job ' +
        `en la cola (${error instanceof Error ? error.message : String(error)}). El sistema se ` +
        'queda SIN segundo respaldo.',
      PasoRespaldo.PROGRAMACION,
    );
  }
}
