/**
 * DIAGNÓSTICO del almacenamiento de archivos (Cloudflare R2).
 *
 * Por qué existe: cuando «no se pueden subir fotos», el navegador NO puede decir por qué. R2 rechaza
 * el `PUT` prefirmado **sin cabeceras CORS**, y el navegador convierte esa respuesta en una falla de
 * red genérica — indistinguible de un cable desconectado (ver la nota (a) de
 * `frontend/src/api/subida-archivo.ts`). Desde afuera, cinco causas MUY distintas se ven idénticas:
 *
 *   1. el token S3 se venció / se rotó / se borró        → `InvalidAccessKeyId`
 *   2. el secreto no corresponde al Access Key           → `SignatureDoesNotMatch`
 *   3. el token es de solo lectura, o no alcanza a ESTE  → `AccessDenied` (403)
 *      bucket
 *   4. el bucket no existe o el nombre trae un typo      → `NoSuchBucket` (404)
 *   5. las credenciales están bien, pero la política     → el `PUT` server-side FUNCIONA y aun así
 *      CORS del bucket no acepta al origen del frontend     el navegador no puede subir
 *
 * Este módulo las separa **desde el servidor**, que es el único lugar donde las credenciales existen
 * (en Railway son variables del backend; nadie las ve, ni siquiera quien administra). Hace pruebas
 * REALES contra R2 —sube, lee y borra un objeto de prueba diminuto— y, para la causa 5, dispara el
 * **preflight** `OPTIONS` que haría el navegador: desde Node ese preflight no está sujeto a la
 * política del mismo origen, así que se puede observar la respuesta cruda de R2 en vez de la versión
 * censurada que ve el navegador.
 *
 * NO es lógica de negocio (A1): es infraestructura común, hermana de `comun/archivos.ts`, y por eso
 * vive aquí. El orquestador que lo expone al API está en `dominio/admin/diagnostico.ts`.
 *
 * SEGURIDAD: el reporte NUNCA incluye el secreto ni el Access Key completos. Del Access Key salen
 * los primeros 4 caracteres y su largo — lo justo para responder «¿es la llave que creí que puse?»
 * sin volver el reporte un vector de fuga.
 */
import {
  DeleteObjectCommand,
  GetBucketCorsCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { configR2DesdeEnv, crearClienteR2, credencialesR2SonDummy } from './archivos.js';

/** Cómo salió una prueba del diagnóstico. */
export type EstadoPrueba = 'ok' | 'falla' | 'aviso' | 'no-probado';

/** Resultado de UNA prueba (una fila de la pantalla). */
export interface PruebaDiagnostico {
  /** Identificador estable de la prueba (para la UI y para citarla en un reporte). */
  clave: string;
  /** Qué se probó, en una línea, en español de negocio. */
  titulo: string;
  estado: EstadoPrueba;
  /** Qué pasó exactamente (incluye el código de error de R2 cuando lo hay). */
  detalle: string;
  /** Qué hacer para arreglarlo. Vacío cuando la prueba salió bien. */
  sugerencia?: string;
}

/** Reporte completo del almacenamiento. */
export interface ReporteR2 {
  /** Nombre del bucket configurado (no es secreto: es un nombre elegido por nosotros). */
  bucket: string;
  /** Id de cuenta de Cloudflare, ENMASCARADO (primeros 6 caracteres). */
  cuenta: string;
  /** Access Key ID ENMASCARADO (primeros 4 caracteres + largo). */
  accessKeyId: string;
  /** Origen público del frontend contra el que se probó CORS (el que usa el navegador). */
  origenProbado: string;
  /** Política CORS que hoy tiene el bucket, en JSON, o `null` si no se pudo leer. */
  corsActual: string | null;
  /** Política CORS que el sistema necesita, lista para pegar en el panel de Cloudflare. */
  corsSugerido: string;
  pruebas: PruebaDiagnostico[];
  /** Una frase: qué está pasando y qué sigue. Es lo primero que se lee en pantalla. */
  veredicto: string;
  /** ¿Todo lo indispensable para subir fotos está en orden? */
  puedeSubirFotos: boolean;
}

/** Enmascara un valor dejando ver solo su principio y su largo (nunca el secreto completo). */
export function enmascarar(valor: string, visibles: number): string {
  const limpio = valor.trim();
  if (limpio === '') {
    return '(vacío)';
  }
  if (limpio.length <= visibles) {
    return `${limpio} (${String(limpio.length)} caracteres)`;
  }
  return `${limpio.slice(0, visibles)}… (${String(limpio.length)} caracteres)`;
}

/**
 * Traduce el error crudo del SDK de S3 a una prueba con causa y arreglo. Es una función PURA: recibe
 * el error, devuelve el veredicto. Aquí vive el mapa «código de R2 → qué le pasó de verdad al
 * usuario», que es el corazón útil de todo el módulo.
 */
export function interpretarErrorR2(
  error: unknown,
  contexto: { bucket: string; operacion: string },
): { detalle: string; sugerencia: string } {
  const nombre =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : 'ErrorDesconocido';
  const codigoHttp =
    typeof error === 'object' && error !== null && '$metadata' in error
      ? ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? 0)
      : 0;
  const mensaje = error instanceof Error ? error.message : String(error);
  const sufijoHttp = codigoHttp > 0 ? ` (HTTP ${String(codigoHttp)})` : '';

  if (nombre === 'InvalidAccessKeyId') {
    return {
      detalle: `R2 no reconoce el Access Key${sufijoHttp}: el token ya no existe.`,
      sugerencia:
        'El token S3 se venció, se rotó o se borró en Cloudflare. Crea uno nuevo (R2 → API Tokens → ' +
        'Account API token, permiso "Object Read & Write" con alcance al bucket) y actualiza ' +
        'R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY en Railway. OJO: la Secret solo se ve UNA vez al crearlo.',
    };
  }
  if (nombre === 'SignatureDoesNotMatch') {
    return {
      detalle: `La firma no cuadra${sufijoHttp}: el Access Key existe, pero el secreto no es el suyo.`,
      sugerencia:
        'R2_SECRET_ACCESS_KEY no corresponde a R2_ACCESS_KEY_ID (se mezclaron dos tokens, o se copió ' +
        'con un espacio/salto de línea de más). Vuelve a pegar el par COMPLETO del mismo token; si ya ' +
        'no tienes la Secret, crea un token nuevo.',
    };
  }
  if (nombre === 'AccessDenied' || codigoHttp === 403) {
    return {
      detalle: `R2 rechazó la operación por permisos${sufijoHttp}.`,
      sugerencia:
        `El token es válido pero no puede ${contexto.operacion} en «${contexto.bucket}». Casi siempre ` +
        'es un token "Object Read only" (necesita "Object Read & Write") o un token cuyo alcance no ' +
        'incluye ESTE bucket. Revísalo en Cloudflare → R2 → API Tokens.',
    };
  }
  if (nombre === 'NoSuchBucket' || codigoHttp === 404) {
    return {
      detalle: `El bucket «${contexto.bucket}» no existe en esta cuenta${sufijoHttp}.`,
      sugerencia:
        'R2_BUCKET trae un typo, o el bucket es de otra cuenta (R2_ACCOUNT_ID). Compara el nombre ' +
        'EXACTO contra la lista de buckets en Cloudflare → R2.',
    };
  }
  if (nombre === 'TimeoutError' || /ENOTFOUND|EAI_AGAIN|ECONNREFUSED/.test(mensaje)) {
    return {
      detalle: `No se pudo contactar a R2: ${mensaje}`,
      sugerencia:
        'El endpoint sale de R2_ACCOUNT_ID (https://<cuenta>.r2.cloudflarestorage.com). Si el id está ' +
        'mal, el dominio ni siquiera resuelve. Verifica el Account ID en el panel de R2.',
    };
  }
  return {
    detalle: `${nombre}${sufijoHttp}: ${mensaje}`,
    sugerencia:
      'Error no catalogado de R2. Copia este texto tal cual al reportarlo: trae el código exacto que ' +
      'devolvió Cloudflare.',
  };
}

/**
 * Política CORS que el sistema NECESITA, en el JSON exacto que acepta el panel de Cloudflare
 * (R2 → el bucket → Settings → CORS Policy → Edit). Se genera con los orígenes reales para que se
 * pueda copiar y pegar sin editar nada — la trampa #4 de `docs/GUIA-RAILWAY-R2.md` §9.1 es
 * justamente que el origen del frontend cambió y la política se quedó con el viejo.
 *
 * `PUT` es la subida; `GET` y `HEAD` son la descarga/vista de la foto ya subida. `AllowedHeaders:
 * content-type` es lo único que el navegador manda de más en el preflight (el resto va firmado en la
 * URL). `ExposeHeaders: etag` deja que el navegador confirme el objeto guardado.
 */
export function politicaCorsSugerida(origenes: string[]): string {
  return JSON.stringify(
    [
      {
        AllowedOrigins: origenes,
        AllowedMethods: ['GET', 'PUT', 'HEAD'],
        AllowedHeaders: ['content-type'],
        ExposeHeaders: ['etag'],
        MaxAgeSeconds: 3600,
      },
    ],
    null,
    2,
  );
}

/** Dependencias inyectables (los tests pasan un cliente y un `fetch` de mentiras). */
export interface DepsDiagnostico {
  cliente: S3Client;
  bucket: string;
  /** `fetch` usado para el preflight CORS (inyectable para probar sin red). */
  buscar?: typeof fetch;
}

/**
 * Dispara el preflight `OPTIONS` que haría el navegador ANTES del `PUT`, y lee la respuesta CRUDA.
 *
 * Esto es lo que el navegador no puede contarnos: si R2 no devuelve `access-control-allow-origin`
 * para nuestro origen, el navegador aborta la subida y reporta «falla de red». Desde Node no hay
 * política del mismo origen, así que aquí sí se ve la verdad.
 */
export async function probarPreflightCors(
  urlPrefirmada: string,
  origen: string,
  buscar: typeof fetch = fetch,
): Promise<PruebaDiagnostico> {
  const clave = 'cors-preflight';
  const titulo = `El navegador puede subir desde ${origen}`;
  try {
    const respuesta = await buscar(urlPrefirmada, {
      method: 'OPTIONS',
      headers: {
        Origin: origen,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    const permitido = respuesta.headers.get('access-control-allow-origin');
    const metodos = respuesta.headers.get('access-control-allow-methods') ?? '';

    if (permitido === null) {
      return {
        clave,
        titulo,
        estado: 'falla',
        detalle:
          `R2 respondió al preflight con HTTP ${String(respuesta.status)} y SIN la cabecera ` +
          '`access-control-allow-origin`. El navegador bloquea la subida y la reporta como falla de red.',
        sugerencia:
          `El bucket no tiene política CORS, o la que tiene no incluye el origen ${origen}. Pega la ` +
          'política sugerida en Cloudflare → R2 → el bucket → Settings → CORS Policy → Edit.',
      };
    }
    if (permitido !== '*' && permitido !== origen) {
      return {
        clave,
        titulo,
        estado: 'falla',
        detalle: `R2 permite subidas desde «${permitido}», pero el frontend vive en «${origen}».`,
        sugerencia:
          'Es el caso clásico: el dominio público cambió (o se copió el de otro ambiente) y la política ' +
          'CORS se quedó con el viejo. Actualízala con la política sugerida.',
      };
    }
    if (!/PUT/i.test(metodos) && metodos !== '') {
      return {
        clave,
        titulo,
        estado: 'falla',
        detalle: `El origen sí está permitido, pero los métodos permitidos son «${metodos}» (falta PUT).`,
        sugerencia: 'Agrega PUT a AllowedMethods en la política CORS del bucket.',
      };
    }
    return {
      clave,
      titulo,
      estado: 'ok',
      detalle: `R2 acepta el preflight desde ${origen} (métodos: ${metodos === '' ? 'PUT' : metodos}).`,
    };
  } catch (error) {
    return {
      clave,
      titulo,
      estado: 'falla',
      detalle: `No se pudo hacer el preflight contra R2: ${error instanceof Error ? error.message : String(error)}`,
      sugerencia:
        'Revisa que R2_ACCOUNT_ID sea el correcto y que el servidor tenga salida a internet.',
    };
  }
}

/**
 * Corre el diagnóstico COMPLETO: variables, escritura, lectura, borrado, política CORS y preflight.
 *
 * El objeto de prueba se sube bajo `diagnostico/` con nombre único y se borra al final. Si el borrado
 * falla, se avisa (queda basura, no un fallo del sistema): el token puede tener escritura sin borrado.
 *
 * @param origenes Orígenes del frontend a validar contra CORS. El PRIMERO es el que se prueba con el
 *                 preflight (el que el usuario está usando ahora mismo).
 */
export async function diagnosticarR2(
  origenes: string[],
  env: Record<string, string | undefined> = process.env,
  deps?: DepsDiagnostico,
): Promise<ReporteR2> {
  const pruebas: PruebaDiagnostico[] = [];
  const origenProbado = origenes[0] ?? '(desconocido)';
  const corsSugerido = politicaCorsSugerida(origenes);

  // ── 1) Las variables ────────────────────────────────────────────────────────────────────────
  let config;
  try {
    config = configR2DesdeEnv(env);
  } catch (error) {
    return {
      bucket: env.R2_BUCKET ?? '(sin definir)',
      cuenta: '(sin definir)',
      accessKeyId: '(sin definir)',
      origenProbado,
      corsActual: null,
      corsSugerido,
      pruebas: [
        {
          clave: 'variables',
          titulo: 'Las cuatro variables R2_* del servidor',
          estado: 'falla',
          detalle: error instanceof Error ? error.message : String(error),
          sugerencia:
            'Falta al menos una variable en el servicio backend de Railway: R2_ACCOUNT_ID, ' +
            'R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET.',
        },
      ],
      veredicto: 'No se puede subir nada: al backend le faltan variables del almacenamiento.',
      puedeSubirFotos: false,
    };
  }

  const dummy = credencialesR2SonDummy(env);
  pruebas.push({
    clave: 'variables',
    titulo: 'Las cuatro variables R2_* del servidor',
    estado: dummy ? 'falla' : 'ok',
    detalle: dummy
      ? 'Las credenciales son de RELLENO (valores de desarrollo), no las reales del bucket.'
      : `Presentes: bucket «${config.bucket}», cuenta ${enmascarar(config.cuentaId, 6)}, ` +
        `llave ${enmascarar(config.accessKeyId, 4)}.`,
    ...(dummy
      ? {
          sugerencia:
            'Este ambiente quedó con las credenciales de desarrollo. Pon las del token S3 real en las ' +
            'variables del backend en Railway y vuelve a desplegar.',
        }
      : {}),
  });

  const cliente = deps?.cliente ?? crearClienteR2(config);
  const bucket = deps?.bucket ?? config.bucket;
  const buscar = deps?.buscar ?? fetch;
  const key = `diagnostico/prueba-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;

  // ── 2) Escribir (es lo que hace una subida de foto, y lo que hace el respaldo mensual) ───────
  let escrituraOk = false;
  try {
    await cliente.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: 'Prueba de diagnóstico de CONTROL. Se puede borrar.',
        ContentType: 'text/plain',
      }),
    );
    escrituraOk = true;
    pruebas.push({
      clave: 'escritura',
      titulo: 'El servidor puede GUARDAR en el bucket',
      estado: 'ok',
      detalle: `Objeto de prueba escrito en «${bucket}».`,
    });
  } catch (error) {
    const { detalle, sugerencia } = interpretarErrorR2(error, {
      bucket,
      operacion: 'escribir',
    });
    pruebas.push({
      clave: 'escritura',
      titulo: 'El servidor puede GUARDAR en el bucket',
      estado: 'falla',
      detalle,
      sugerencia,
    });
  }

  // ── 3) Leer y borrar (solo tienen sentido si se escribió) ────────────────────────────────────
  if (escrituraOk) {
    try {
      await cliente.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      pruebas.push({
        clave: 'lectura',
        titulo: 'El servidor puede LEER del bucket',
        estado: 'ok',
        detalle: 'El objeto de prueba se leyó de vuelta.',
      });
    } catch (error) {
      const { detalle, sugerencia } = interpretarErrorR2(error, { bucket, operacion: 'leer' });
      pruebas.push({
        clave: 'lectura',
        titulo: 'El servidor puede LEER del bucket',
        estado: 'falla',
        detalle,
        sugerencia,
      });
    }

    try {
      await cliente.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      pruebas.push({
        clave: 'limpieza',
        titulo: 'El objeto de prueba se borró',
        estado: 'ok',
        detalle: 'No quedó basura en el bucket.',
      });
    } catch (error) {
      const { detalle } = interpretarErrorR2(error, { bucket, operacion: 'borrar' });
      pruebas.push({
        clave: 'limpieza',
        titulo: 'El objeto de prueba se borró',
        estado: 'aviso',
        detalle: `${detalle} Quedó el objeto «${key}» (inofensivo, se puede borrar a mano).`,
      });
    }
  } else {
    for (const [clave, titulo] of [
      ['lectura', 'El servidor puede LEER del bucket'],
      ['limpieza', 'El objeto de prueba se borró'],
    ] as const) {
      pruebas.push({
        clave,
        titulo,
        estado: 'no-probado',
        detalle: 'No se probó: la escritura falló antes.',
      });
    }
  }

  // ── 4) La política CORS que hoy tiene el bucket ──────────────────────────────────────────────
  let corsActual: string | null = null;
  try {
    const respuesta = await cliente.send(new GetBucketCorsCommand({ Bucket: bucket }));
    corsActual = JSON.stringify(respuesta.CORSRules ?? [], null, 2);
    const reglas = respuesta.CORSRules ?? [];
    const cubre = reglas.some(
      (regla) =>
        (regla.AllowedOrigins ?? []).some((o) => o === '*' || origenes.includes(o)) &&
        (regla.AllowedMethods ?? []).some((m) => m.toUpperCase() === 'PUT'),
    );
    pruebas.push({
      clave: 'cors-config',
      titulo: 'La política CORS del bucket incluye al frontend',
      estado: cubre ? 'ok' : 'falla',
      detalle: cubre
        ? `El bucket permite PUT desde ${origenProbado}.`
        : reglas.length === 0
          ? 'El bucket NO tiene ninguna política CORS: ningún navegador puede subirle archivos.'
          : `El bucket tiene política CORS, pero ninguna regla permite PUT desde ${origenProbado}.`,
      ...(cubre
        ? {}
        : {
            sugerencia:
              'Pega la política sugerida en Cloudflare → R2 → el bucket → Settings → CORS Policy → Edit.',
          }),
    });
  } catch (error) {
    // Leer la configuración del bucket es una operación de ADMINISTRACIÓN: un token «Object Read &
    // Write» (el que recomienda la guía, por menor privilegio) NO puede leerla. Eso NO es un
    // problema — por eso es aviso y no falla: la prueba que de verdad manda es el preflight de
    // abajo, que mide lo mismo que mediría el navegador.
    const { detalle } = interpretarErrorR2(error, { bucket, operacion: 'leer su configuración' });
    pruebas.push({
      clave: 'cors-config',
      titulo: 'La política CORS del bucket incluye al frontend',
      estado: 'aviso',
      detalle: `No se pudo leer la política desde aquí (${detalle}). Es normal con un token «Object Read & Write».`,
      sugerencia:
        'La prueba de abajo (preflight) mide lo mismo que el navegador y no necesita ese permiso.',
    });
  }

  // ── 5) El preflight: la prueba que replica EXACTAMENTE lo que hace el navegador ──────────────
  let urlPrefirmada: string;
  try {
    urlPrefirmada = await getSignedUrl(
      cliente,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'text/plain' }),
      { expiresIn: 60 },
    );
    pruebas.push(await probarPreflightCors(urlPrefirmada, origenProbado, buscar));
  } catch (error) {
    pruebas.push({
      clave: 'cors-preflight',
      titulo: `El navegador puede subir desde ${origenProbado}`,
      estado: 'no-probado',
      detalle: `No se pudo firmar la URL de prueba: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const falla = (clave: string): boolean =>
    pruebas.some((p) => p.clave === clave && p.estado === 'falla');
  const puedeSubirFotos = !falla('variables') && !falla('escritura') && !falla('cors-preflight');

  let veredicto: string;
  if (falla('variables')) {
    veredicto =
      'Las credenciales del almacenamiento no son las reales: no se puede subir ni respaldar nada.';
  } else if (falla('escritura')) {
    veredicto =
      'El token S3 no sirve para escribir en el bucket. Esto rompe las fotos Y el respaldo mensual: ' +
      'arréglalo primero (mira el detalle de la prueba «El servidor puede GUARDAR»).';
  } else if (falla('cors-preflight') || falla('cors-config')) {
    veredicto =
      'Las credenciales están BIEN (el servidor guarda y lee sin problema): lo que falla es la política ' +
      'CORS del bucket, que es lo que deja al navegador subir directo. Pega la política sugerida en ' +
      'Cloudflare y las fotos vuelven, sin tocar código ni volver a desplegar.';
  } else {
    veredicto = 'El almacenamiento está sano: guardar, leer y subir desde el navegador funcionan.';
  }

  return {
    bucket,
    cuenta: enmascarar(config.cuentaId, 6),
    accessKeyId: enmascarar(config.accessKeyId, 4),
    origenProbado,
    corsActual,
    corsSugerido,
    pruebas,
    veredicto,
    puedeSubirFotos,
  };
}
