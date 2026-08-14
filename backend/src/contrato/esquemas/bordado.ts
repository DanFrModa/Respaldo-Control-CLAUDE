import { z } from 'zod';

/**
 * Tipo de bordado (catálogo global F1-E3, R2). Distingue el BORDADO real del
 * ESTAMPADO / aplicación (ex campo `BorEst` del sistema viejo, doc 01-Modelos §2).
 * Debe mantenerse alineado con el enum `TipoBordado` de `src/datos`.
 */
export const TIPOS_BORDADO = ['BORDADO', 'ESTAMPADO'] as const;

/** Clave de tipo de bordado. */
export type TipoBordadoClave = (typeof TIPOS_BORDADO)[number];

/** Etiquetas para UI de cada tipo de bordado. */
export const ETIQUETAS_TIPO_BORDADO: Record<TipoBordadoClave, string> = {
  BORDADO: 'Bordado',
  ESTAMPADO: 'Estampado / aplicación',
};

/**
 * Alta de bordado (catálogo global F1-E3, ADR-0007: sin `idEmpresa`). El `nombre`
 * es la clave de negocio (único global). `puntadas` (informativo, alimenta el
 * costeo) y `precio` (de referencia) son opcionales; se aceptan como `number`
 * (Prisma guarda el precio como Decimal) y en la salida el precio se serializa a
 * `number`. La FOTO no va aquí: se sube aparte con el flujo presigned de R2.
 */
export const esquemaBordadoCrear = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
  descripcion: z
    .string()
    .trim()
    .max(500, { error: 'La descripción no puede tener más de 500 caracteres' })
    .optional(),
  puntadas: z
    .number({ error: 'Las puntadas deben ser un número' })
    .int({ error: 'Las puntadas deben ser un entero' })
    .min(0, { error: 'Las puntadas no pueden ser negativas' })
    .max(1_000_000, { error: 'Las puntadas no pueden ser más de 1,000,000' })
    .optional(),
  precio: z
    .number({ error: 'El precio debe ser un número' })
    .nonnegative({ error: 'El precio no puede ser negativo' })
    .optional(),
  tipo: z.enum(TIPOS_BORDADO, { error: 'El tipo debe ser BORDADO o ESTAMPADO' }).default('BORDADO'),
});

/** Datos validados de alta de bordado. */
export type DatosBordadoCrear = z.infer<typeof esquemaBordadoCrear>;

/**
 * Edición de bordado: todos los campos del alta son opcionales (edición parcial)
 * más `activo` para el borrado suave (plan §4: nada se borra físicamente).
 *
 * Los opcionales de TEXTO/NÚMERO aceptan además `null` para poder VACIAR un dato ya
 * capturado (M1): omitir el campo (`undefined`) = no tocar; mandar `null` = borrar.
 * `tipo` NO es nullable (siempre tiene valor) y se re-declara SIN su `.default()`
 * del alta: en una edición parcial, omitir `tipo` NO debe resetearlo a BORDADO (Zod
 * `.partial()` no quita los defaults; aquí `tipo` sin default → omitido queda
 * `undefined`). `nombre` tampoco es nullable (clave de negocio obligatoria).
 */
const baseBordadoEditar = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(150, { error: 'El nombre no puede tener más de 150 caracteres' })
    .optional(),
  descripcion: z
    .string()
    .trim()
    .max(500, { error: 'La descripción no puede tener más de 500 caracteres' })
    .optional()
    .nullable(),
  puntadas: z
    .number({ error: 'Las puntadas deben ser un número' })
    .int({ error: 'Las puntadas deben ser un entero' })
    .min(0, { error: 'Las puntadas no pueden ser negativas' })
    .max(1_000_000, { error: 'Las puntadas no pueden ser más de 1,000,000' })
    .optional()
    .nullable(),
  precio: z
    .number({ error: 'El precio debe ser un número' })
    .nonnegative({ error: 'El precio no puede ser negativo' })
    .optional()
    .nullable(),
  tipo: z.enum(TIPOS_BORDADO, { error: 'El tipo debe ser BORDADO o ESTAMPADO' }).optional(),
  activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
});

/**
 * Edición de bordado: `baseBordadoEditar` + `id` (lo usa el servicio de dominio,
 * que recibe el id dentro del payload).
 */
export const esquemaBordadoEditar = baseBordadoEditar.extend({
  id: z
    .number({ error: 'El id del bordado es obligatorio' })
    .int({ error: 'El id del bordado debe ser entero' })
    .positive({ error: 'El id del bordado debe ser positivo' }),
});

/** Datos validados de edición de bordado. */
export type DatosBordadoEditar = z.infer<typeof esquemaBordadoEditar>;

/**
 * Cuerpo del PATCH de bordado (la ruta REST recibe el `id` en la URL, no en el body):
 * es `baseBordadoEditar` tal cual (sin `id`).
 */
export const esquemaBordadoPatchCuerpo = baseBordadoEditar;

/** Datos validados del cuerpo del PATCH de bordado (sin `id`). */
export type DatosBordadoPatchCuerpo = z.infer<typeof esquemaBordadoPatchCuerpo>;

/**
 * Salida de un bordado en la API (lo que ve el frontend). Proyección del modelo
 * `Bordado` a JSON: el `precio` Decimal de Prisma se serializa a `number` (o null);
 * `idArchivoFoto` indica si tiene foto (el frontend pide la URL aparte). Parte del
 * contrato OpenAPI.
 */
export const esquemaBordadoSalida = z
  .object({
    id: z.number().int().describe('Id del bordado.'),
    nombre: z.string().describe('Nombre del bordado/estampado.'),
    descripcion: z.string().nullable().describe('Descripción, o null.'),
    puntadas: z.number().int().nullable().describe('Número de puntadas (informativo), o null.'),
    precio: z.number().nullable().describe('Precio de referencia, o null.'),
    tipo: z.enum(TIPOS_BORDADO).describe('BORDADO real o ESTAMPADO/aplicación.'),
    idArchivoFoto: z
      .string()
      .nullable()
      .describe('Id del Archivo de la foto en R2, o null si no tiene foto.'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Bordado/estampado del catálogo (global, con foto opcional en R2).');

/** Forma de un bordado tal como lo devuelve la API. */
export type BordadoSalida = z.infer<typeof esquemaBordadoSalida>;

/**
 * Parámetros del listado de bordados EN LA URL (querystring): todo llega como texto,
 * así que se coaccionan números y banderas. Mapea 1:1 al servicio de dominio
 * `listarBordados`. Volumen ~2,964: SIEMPRE en modo servidor (búsqueda + filtro por
 * tipo + orden + paginación). `.describe()` documenta el contrato.
 */
export const esquemaBordadosQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página (máx 100).'),
    busqueda: z
      .string()
      .trim()
      .max(150)
      .optional()
      .describe('Texto a buscar en el nombre (insensible a mayúsculas).'),
    tipo: z.enum(TIPOS_BORDADO).optional().describe('Filtra por tipo (BORDADO/ESTAMPADO).'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los desactivados ("true"/"false").'),
    ordenarPor: z
      .enum(['nombre', 'tipo', 'creadoEn'])
      .default('nombre')
      .describe('Columna de ordenamiento.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de bordados.');

/** Parámetros de listado de bordados ya coaccionados desde la URL. */
export type BordadosQuery = z.infer<typeof esquemaBordadosQuery>;

/** Respuesta paginada del listado de bordados (forma estándar `Pagina<T>`). */
export const esquemaBordadosPagina = z
  .object({
    datos: z.array(esquemaBordadoSalida).describe('Bordados de la página.'),
    total: z.number().int().describe('Total de bordados que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de bordados.');

/** Forma de la respuesta paginada de bordados. */
export type BordadosPagina = z.infer<typeof esquemaBordadosPagina>;

// ── Foto del bordado (R2: 1 bordado → 0..1 foto, vía presigned) ───────────────

/**
 * Solicitud de subida de la FOTO de un bordado: el navegador manda los metadatos de
 * la imagen y el backend devuelve la URL PUT prefirmada (flujo presigned de F0). Solo
 * imágenes (`image/*`): la foto se previsualiza, a diferencia de los PDF del proveedor.
 */
export const esquemaBordadoFotoCrear = z
  .object({
    nombreOriginal: z
      .string({ error: 'El nombre del archivo es obligatorio' })
      .trim()
      .min(1, { error: 'El nombre del archivo es obligatorio' })
      .max(255)
      .describe('Nombre del archivo tal como lo llama el usuario.'),
    tipoMime: z
      .string({ error: 'El tipo de archivo es obligatorio' })
      .trim()
      .regex(/^image\/[\w.+-]+$/, { error: 'La foto debe ser una imagen' })
      .describe('Tipo MIME de la imagen (ej. image/jpeg, image/png, image/webp).'),
    tamanoBytes: z
      .number({ error: 'El tamaño es obligatorio' })
      .int({ error: 'El tamaño debe ser un entero de bytes' })
      .positive({ error: 'El archivo está vacío' })
      .describe('Tamaño exacto en bytes (la URL prefirmada solo acepta este tamaño).'),
  })
  .describe('Datos para preparar la subida de la foto de un bordado.');

/** Datos validados de la solicitud de subida de la foto de un bordado. */
export type DatosBordadoFotoCrear = z.infer<typeof esquemaBordadoFotoCrear>;

/** Salida tras solicitar la subida de la foto: registro + URL PUT prefirmada para R2. */
export const esquemaBordadoFotoSubida = z
  .object({
    idArchivo: z.string().describe('Id del registro Archivo creado para la foto.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    urlSubida: z.string().describe('URL PUT prefirmada: el navegador sube directo a R2.'),
    expiraEnSegundos: z.number().int().describe('Vigencia de la URL de subida (segundos).'),
  })
  .describe('Resultado de preparar la subida de la foto (URL prefirmada).');

/** Forma de la respuesta al preparar la subida de la foto. */
export type BordadoFotoSubida = z.infer<typeof esquemaBordadoFotoSubida>;

/**
 * Salida de la foto de un bordado, con su URL GET prefirmada para verla. `urlDescarga`
 * es `null` cuando el bordado NO tiene foto (la UI pinta el placeholder NoFoto).
 */
export const esquemaBordadoFotoSalida = z
  .object({
    idArchivo: z.string().nullable().describe('Id del registro Archivo de la foto, o null.'),
    nombreOriginal: z.string().nullable().describe('Nombre original del archivo, o null.'),
    tipoMime: z.string().nullable().describe('Tipo MIME de la imagen, o null.'),
    tamanoBytes: z.number().int().nullable().describe('Tamaño en bytes, o null.'),
    urlDescarga: z
      .string()
      .nullable()
      .describe('URL GET prefirmada para ver la foto, o null si no tiene foto.'),
  })
  .describe('Foto de un bordado (con su URL de descarga) o vacía si no tiene.');

/** Forma de la foto de un bordado tal como la devuelve la API. */
export type BordadoFotoSalida = z.infer<typeof esquemaBordadoFotoSalida>;

/**
 * Querystring OPCIONAL del borrado de la foto (`DELETE /api/bordados/{id}/foto`).
 *
 * Sin `idArchivo` el borrado quita la foto VIGENTE, sea cual sea: es el botón "quitar foto" de la
 * pantalla, que quiere justamente eso. Con `idArchivo` el borrado queda ACOTADO a esa foto: si la
 * vigente ya es otra (alguien la reemplazó entre medias), NO se borra nada y la operación responde
 * 409 `CONFLICTO`, para que el llamador distinga "la quité" de "ya no era la tuya".
 *
 * Lo usa la LIMPIEZA del flujo presigned del frontend (`api/subida-archivo.ts`): cuando el `PUT` a
 * R2 falla, quien limpia debe borrar EXCLUSIVAMENTE el registro que su propio intento creó — nunca
 * la imagen buena que otro usuario subió mientras tanto. Es el mismo borrado acotado por id de
 * archivo que ya tienen los demás módulos de adjuntos (proveedor, orden, pedido, entrada de tela,
 * desarrollo, fotos de modelo), donde el id va en la ruta porque son 0..N; aquí la foto es 0..1 y
 * cuelga del bordado, así que el acotamiento viaja como parámetro opcional de consulta.
 */
export const esquemaBordadoFotoQuitarQuery = z
  .object({
    idArchivo: z
      .string({ error: 'El id del archivo debe ser texto' })
      .trim()
      .min(1, { error: 'El id del archivo no puede ir vacío' })
      .optional()
      .describe('Si viene, solo quita la foto cuando la vigente es EXACTAMENTE esta.'),
  })
  .describe('Acotamiento opcional del borrado de la foto de un bordado.');

/** Datos validados del querystring del borrado de la foto. */
export type DatosBordadoFotoQuitarQuery = z.infer<typeof esquemaBordadoFotoQuitarQuery>;
