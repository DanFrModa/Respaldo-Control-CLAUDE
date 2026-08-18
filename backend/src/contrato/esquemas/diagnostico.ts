import { z } from 'zod';

/**
 * Esquemas del DIAGNÓSTICO DE INFRAESTRUCTURA (almacenamiento R2 + respaldo mensual).
 *
 * No es un módulo de negocio: es la pantalla que responde, SIN abrir Railway ni Cloudflare y sin
 * pedirle a nadie que lea un log, dos preguntas que hasta hoy costaban horas de arqueología:
 *   • «¿por qué no puedo subir fotos?» — y cuál de las cinco causas posibles es (guía §9.1);
 *   • «¿de verdad se está respaldando la base?» — cuya respuesta, con corridas MENSUALES, nadie
 *     descubría hasta necesitarla.
 *
 * Todo lo que sale por aquí es DIAGNÓSTICO, nunca secretos: las credenciales van enmascaradas.
 */

/** Cómo salió una prueba del diagnóstico. */
export const ESTADOS_PRUEBA = ['ok', 'falla', 'aviso', 'no-probado'] as const;

/** Estado de una prueba del diagnóstico. */
export type EstadoPruebaClave = (typeof ESTADOS_PRUEBA)[number];

/** Una prueba del diagnóstico (una fila de la pantalla). */
export const esquemaPruebaDiagnostico = z
  .object({
    clave: z.string().describe('Identificador estable de la prueba.'),
    titulo: z.string().describe('Qué se probó, en una línea.'),
    estado: z.enum(ESTADOS_PRUEBA).describe('Cómo salió.'),
    detalle: z.string().describe('Qué pasó exactamente (incluye el código de error de R2).'),
    sugerencia: z.string().optional().describe('Qué hacer para arreglarlo.'),
  })
  .describe('Resultado de una prueba del diagnóstico.');

/** Diagnóstico del almacenamiento de archivos (Cloudflare R2). */
export const esquemaDiagnosticoAlmacenamiento = z
  .object({
    bucket: z.string().describe('Bucket configurado en este ambiente.'),
    cuenta: z.string().describe('Id de cuenta de Cloudflare, enmascarado.'),
    accessKeyId: z.string().describe('Access Key del token S3, enmascarado.'),
    origenProbado: z.string().describe('Origen público del frontend contra el que se probó CORS.'),
    corsActual: z
      .string()
      .nullable()
      .describe('Política CORS que hoy tiene el bucket (JSON), o null si no se pudo leer.'),
    corsSugerido: z.string().describe('Política CORS que el sistema necesita, lista para pegar.'),
    pruebas: z.array(esquemaPruebaDiagnostico),
    veredicto: z.string().describe('Qué está pasando y qué sigue, en una frase.'),
    puedeSubirFotos: z.boolean().describe('¿El navegador puede subir archivos ahora mismo?'),
  })
  .describe('Diagnóstico del almacenamiento de archivos (R2).');

/** Estados posibles del respaldo mensual. */
export const ESTADOS_RESPALDO_CONFIG = ['programado', 'apagado', 'sin-configurar'] as const;

/** Una corrida del respaldo, tal como la muestra el diagnóstico. */
export const esquemaCorridaRespaldo = z
  .object({
    id: z.string().describe('Id de la corrida (BigInt como texto).'),
    iniciadoEn: z.iso.datetime().describe('Cuándo arrancó.'),
    terminadoEn: z.iso.datetime().nullable().describe('Cuándo terminó (null si sigue en curso).'),
    estado: z.string().describe('EN_CURSO / EXITO / FALLO.'),
    paso: z.string().describe('Paso alcanzado (o donde tronó).'),
    key: z.string().nullable().describe('Key del objeto en R2 (la que pide el restaurador).'),
    tamanoSubidoBytes: z
      .string()
      .nullable()
      .describe('Tamaño del archivo cifrado que confirmó R2, en bytes.'),
    sha256: z.string().nullable().describe('Huella SHA-256 del archivo cifrado.'),
    error: z.string().nullable().describe('El error, si falló.'),
  })
  .describe('Una corrida del respaldo mensual a R2.');

/** Diagnóstico del respaldo mensual cifrado a R2. */
export const esquemaDiagnosticoRespaldo = z
  .object({
    estado: z.enum(ESTADOS_RESPALDO_CONFIG).describe('Cómo quedó el respaldo al arrancar.'),
    mensaje: z
      .string()
      .describe('Explicación del estado (qué falta, o desde cuándo está apagado).'),
    cron: z.string().describe('Cron UTC de la corrida.'),
    cuando: z.string().describe('El cron traducido a lenguaje humano.'),
    retencion: z.number().int().describe('Cuántos respaldos se conservan.'),
    ultimasCorridas: z.array(esquemaCorridaRespaldo).describe('Las últimas corridas registradas.'),
    veredicto: z.string().describe('Si hay o no segundo respaldo, y qué hacer.'),
  })
  .describe('Diagnóstico del respaldo mensual cifrado a R2.');

/** Respuesta completa del diagnóstico. */
export const esquemaDiagnostico = z
  .object({
    hora: z.iso.datetime().describe('Cuándo se corrió el diagnóstico.'),
    almacenamiento: esquemaDiagnosticoAlmacenamiento,
    respaldo: esquemaDiagnosticoRespaldo,
  })
  .describe('Diagnóstico de infraestructura: almacenamiento de archivos y respaldo.');

/** Resultado de pedir una corrida manual del respaldo. */
export const esquemaRespaldoEncolado = z
  .object({
    encolado: z.boolean().describe('¿Se pudo encolar la corrida?'),
    mensaje: z.string().describe('Qué pasó y qué esperar.'),
  })
  .describe('Resultado de pedir un respaldo ahora mismo.');

/** Diagnóstico completo tal como lo devuelve la API. */
export type Diagnostico = z.infer<typeof esquemaDiagnostico>;
/** Resultado de encolar un respaldo manual. */
export type RespaldoEncolado = z.infer<typeof esquemaRespaldoEncolado>;
