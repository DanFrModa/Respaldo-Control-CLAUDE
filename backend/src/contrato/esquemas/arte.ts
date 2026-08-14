import { z } from 'zod';

/**
 * ARTE del modelo (bordado / estampado) — contrato compartido (V1-E3d, §Post-F9.35).
 *
 * Hasta V1-E3d el arte era un CATÁLOGO global (`Bordado`) que el BOM del modelo
 * referenciaba. Daniel (12-ago-2026): *"cada arte va pegado siempre a un solo modelo…
 * sería más fácil manejar el arte (o varios) dentro del modelo. Ahí mismo establecer su
 * precio, el proveedor"*. Desde entonces el arte es HIJO del modelo (`ModeloArte`): sus
 * datos, su precio —el que viaja a la OP—, su proveedor (nuevo) y su foto viven ahí.
 *
 * Por eso este esquema no tiene `activo` (borrado suave de catálogo): un arte es un
 * renglón del BOM, se agrega y se quita como las telas y los avíos.
 */

/**
 * Tipo de arte: BORDADO real vs. ESTAMPADO / aplicación (ex campo `BorEst` del sistema
 * viejo, doc 01-Modelos §2). Alineado con el enum `TipoArte` de `src/datos`.
 */
export const TIPOS_ARTE = ['BORDADO', 'ESTAMPADO'] as const;

/** Clave de tipo de arte. */
export type TipoArteClave = (typeof TIPOS_ARTE)[number];

/** Etiquetas para UI de cada tipo de arte. */
export const ETIQUETAS_TIPO_ARTE: Record<TipoArteClave, string> = {
  BORDADO: 'Bordado',
  ESTAMPADO: 'Estampado / aplicación',
};

/**
 * Alta de un arte DENTRO de un modelo (el id del modelo va en la ruta, no aquí). El
 * `nombre` es la clave de negocio, único dentro del modelo (ya no global: el mismo arte
 * duplicado en dos modelos es lo normal, §Post-F9.35). `precio` es el que viaja a la OP;
 * `idProveedor` es quién hace el arte. La FOTO no va aquí: se sube aparte con el flujo
 * presigned de R2.
 */
export const esquemaArteCrear = z.object({
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
  tipo: z.enum(TIPOS_ARTE, { error: 'El tipo debe ser BORDADO o ESTAMPADO' }).default('BORDADO'),
  idProveedor: z
    .number({ error: 'El id del proveedor debe ser un número' })
    .int({ error: 'El id del proveedor debe ser entero' })
    .positive({ error: 'El id del proveedor debe ser positivo' })
    .optional(),
});

/** Datos validados de alta de un arte. */
export type DatosArteCrear = z.infer<typeof esquemaArteCrear>;

/**
 * Edición de un arte: todos los campos del alta, opcionales (edición parcial).
 *
 * Los opcionales de TEXTO/NÚMERO aceptan además `null` para poder VACIAR un dato ya
 * capturado (M1): omitir el campo (`undefined`) = no tocar; mandar `null` = borrar.
 * `tipo` NO es nullable (siempre tiene valor) y se re-declara SIN su `.default()` del
 * alta: en una edición parcial, omitir `tipo` NO debe resetearlo a BORDADO. `nombre`
 * tampoco es nullable (clave de negocio obligatoria).
 */
const baseArteEditar = z.object({
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
  tipo: z.enum(TIPOS_ARTE, { error: 'El tipo debe ser BORDADO o ESTAMPADO' }).optional(),
  idProveedor: z
    .number({ error: 'El id del proveedor debe ser un número' })
    .int({ error: 'El id del proveedor debe ser entero' })
    .positive({ error: 'El id del proveedor debe ser positivo' })
    .optional()
    .nullable(),
});

/**
 * Edición de un arte: `baseArteEditar` + `id` (lo usa el servicio de dominio, que recibe
 * el id dentro del payload).
 */
export const esquemaArteEditar = baseArteEditar.extend({
  id: z
    .number({ error: 'El id del arte es obligatorio' })
    .int({ error: 'El id del arte debe ser entero' })
    .positive({ error: 'El id del arte debe ser positivo' }),
});

/** Datos validados de edición de un arte. */
export type DatosArteEditar = z.infer<typeof esquemaArteEditar>;

/**
 * Cuerpo del PATCH de un arte (la ruta REST recibe los ids en la URL, no en el body):
 * es `baseArteEditar` tal cual (sin `id`).
 */
export const esquemaArtePatchCuerpo = baseArteEditar;

/** Datos validados del cuerpo del PATCH de un arte (sin `id`). */
export type DatosArtePatchCuerpo = z.infer<typeof esquemaArtePatchCuerpo>;

/**
 * Salida de un arte en la API. Proyección de `ModeloArte` a JSON: el `precio` Decimal de
 * Prisma se serializa a `number` (o null); `idArchivoFoto` indica si tiene foto (el
 * frontend pide la URL aparte). `proveedor` viene resuelto para pintar la tabla sin un
 * segundo viaje. Parte del contrato OpenAPI.
 */
export const esquemaArteSalida = z
  .object({
    id: z.number().int().describe('Id del arte.'),
    idModelo: z.number().int().describe('Id del modelo dueño del arte.'),
    nombre: z.string().describe('Nombre del arte.'),
    descripcion: z.string().nullable().describe('Descripción, o null.'),
    puntadas: z.number().int().nullable().describe('Número de puntadas (informativo), o null.'),
    precio: z.number().nullable().describe('Precio del arte (el que viaja a la OP), o null.'),
    tipo: z.enum(TIPOS_ARTE).describe('BORDADO real o ESTAMPADO/aplicación.'),
    idProveedor: z.number().int().nullable().describe('Id del proveedor que lo hace, o null.'),
    proveedor: z.string().nullable().describe('Nombre del proveedor que lo hace, o null.'),
    idArchivoFoto: z
      .string()
      .nullable()
      .describe('Id del Archivo de la foto en R2, o null si no tiene foto.'),
    orden: z.number().int().describe('Posición dentro del modelo (0 = arte principal).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Arte (bordado/estampado) de un modelo, con foto opcional en R2.');

/** Forma de un arte tal como lo devuelve la API. */
export type ArteSalida = z.infer<typeof esquemaArteSalida>;

/** Lista de artes de un modelo (respuesta de `GET /api/modelos/{id}/artes`). */
export const esquemaArtesLista = z
  .object({ datos: z.array(esquemaArteSalida).describe('Artes del modelo, ya ordenados.') })
  .describe('Artes (bordados/estampados) de un modelo.');

/** Forma de la lista de artes de un modelo. */
export type ArtesLista = z.infer<typeof esquemaArtesLista>;

/**
 * Cuerpo de «copiar arte de otro modelo» (`POST /api/modelos/{id}/artes/copiar`). Trae el
 * arte YA LLENO para ajustarlo: es la conveniencia que daba el catálogo, sin reinventarlo
 * (§Post-F9.35). Copia nombre/descripción/puntadas/precio/tipo/proveedor **y la foto**
 * (las copias comparten el mismo `Archivo`, igual que las que dejó la migración).
 */
export const esquemaArteCopiarCuerpo = z
  .object({
    idArteOrigen: z
      .number({ error: 'El id del arte de origen es obligatorio' })
      .int({ error: 'El id del arte de origen debe ser entero' })
      .positive({ error: 'El id del arte de origen debe ser positivo' }),
    /** Nombre para la copia; si se omite, se conserva el del origen (o se desambigua). */
    nombre: z
      .string()
      .trim()
      .min(1, { error: 'El nombre es obligatorio' })
      .max(150, { error: 'El nombre no puede tener más de 150 caracteres' })
      .optional(),
  })
  .describe('Copiar a este modelo un arte que ya existe en otro.');

/** Datos validados del cuerpo de copiar arte. */
export type DatosArteCopiar = z.infer<typeof esquemaArteCopiarCuerpo>;

// ── Galería de arte (armada DESDE los modelos, §Post-F9.35 punto 4) ───────────

/**
 * Parámetros de la GALERÍA de arte en la URL (querystring): todo llega como texto, así que
 * se coaccionan números y banderas. La galería sobrevivió al retiro del catálogo, pero
 * ahora se arma desde los modelos y cada foto dice de qué modelo es.
 */
export const esquemaGaleriaArteQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(24)
      .describe('Renglones por página (máx 100).'),
    busqueda: z
      .string()
      .trim()
      .max(150)
      .optional()
      .describe('Texto a buscar en el nombre del arte o en la clave/nombre del modelo.'),
    tipo: z.enum(TIPOS_ARTE).optional().describe('Filtra por tipo (BORDADO/ESTAMPADO).'),
    soloConFoto: z
      .stringbool()
      .default(false)
      .describe('Solo el arte que tiene foto ("true"/"false").'),
    ordenarPor: z
      .enum(['nombre', 'modelo', 'tipo', 'creadoEn'])
      .default('nombre')
      .describe('Columna de ordenamiento.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación de la galería de arte.');

/** Parámetros de la galería ya coaccionados desde la URL. */
export type GaleriaArteQuery = z.infer<typeof esquemaGaleriaArteQuery>;

/** Celda de la galería: el arte + DE QUÉ MODELO es (§Post-F9.35 punto 4). */
export const esquemaGaleriaArteItem = z
  .object({
    id: z.number().int().describe('Id del arte.'),
    nombre: z.string().describe('Nombre del arte.'),
    tipo: z.enum(TIPOS_ARTE).describe('BORDADO real o ESTAMPADO/aplicación.'),
    precio: z.number().nullable().describe('Precio del arte, o null.'),
    idArchivoFoto: z.string().nullable().describe('Id del Archivo de la foto, o null.'),
    idModelo: z.number().int().describe('Id del modelo dueño del arte.'),
    claveModelo: z.string().describe('Clave del modelo dueño (para la UI).'),
    nombreModelo: z.string().nullable().describe('Nombre del modelo dueño, o null.'),
  })
  .describe('Celda de la galería de arte (con el modelo al que pertenece).');

/** Respuesta paginada de la galería (forma estándar `Pagina<T>`). */
export const esquemaGaleriaArtePagina = z
  .object({
    datos: z.array(esquemaGaleriaArteItem).describe('Arte de la página.'),
    total: z.number().int().describe('Total de arte que cumple el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de la galería de arte.');

/** Forma de la respuesta paginada de la galería. */
export type GaleriaArtePagina = z.infer<typeof esquemaGaleriaArtePagina>;

// ── Foto del arte (R2: 1 arte → 0..1 foto, vía presigned) ─────────────────────

/**
 * Solicitud de subida de la FOTO de un arte: el navegador manda los metadatos de la
 * imagen y el backend devuelve la URL PUT prefirmada (flujo presigned de F0). Solo
 * imágenes (`image/*`): la foto se previsualiza, a diferencia de los PDF del proveedor.
 */
export const esquemaArteFotoCrear = z
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
  .describe('Datos para preparar la subida de la foto de un arte.');

/** Datos validados de la solicitud de subida de la foto de un arte. */
export type DatosArteFotoCrear = z.infer<typeof esquemaArteFotoCrear>;

/** Salida tras solicitar la subida de la foto: registro + URL PUT prefirmada para R2. */
export const esquemaArteFotoSubida = z
  .object({
    idArchivo: z.string().describe('Id del registro Archivo creado para la foto.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    urlSubida: z.string().describe('URL PUT prefirmada: el navegador sube directo a R2.'),
    expiraEnSegundos: z.number().int().describe('Vigencia de la URL de subida (segundos).'),
  })
  .describe('Resultado de preparar la subida de la foto (URL prefirmada).');

/** Forma de la respuesta al preparar la subida de la foto. */
export type ArteFotoSubida = z.infer<typeof esquemaArteFotoSubida>;

/**
 * Salida de la foto de un arte, con su URL GET prefirmada para verla. `urlDescarga` es
 * `null` cuando el arte NO tiene foto (la UI pinta el placeholder NoFoto).
 */
export const esquemaArteFotoSalida = z
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
  .describe('Foto de un arte (con su URL de descarga) o vacía si no tiene.');

/** Forma de la foto de un arte tal como la devuelve la API. */
export type ArteFotoSalida = z.infer<typeof esquemaArteFotoSalida>;

/**
 * Querystring OPCIONAL del borrado de la foto (`DELETE /api/modelos/{id}/artes/{idArte}/foto`).
 *
 * Sin `idArchivo` el borrado quita la foto VIGENTE, sea cual sea: es el botón "quitar foto" de la
 * pantalla, que quiere justamente eso. Con `idArchivo` el borrado queda ACOTADO a esa foto: si la
 * vigente ya es otra (alguien la reemplazó entre medias), NO se borra nada y la operación responde
 * 409 `CONFLICTO`, para que el llamador distinga "la quité" de "ya no era la tuya".
 *
 * Lo usa la LIMPIEZA del flujo presigned del frontend (`api/subida-archivo.ts`): cuando el `PUT` a
 * R2 falla, quien limpia debe borrar EXCLUSIVAMENTE el registro que su propio intento creó — nunca
 * la imagen buena que otro usuario subió mientras tanto.
 */
export const esquemaArteFotoQuitarQuery = z
  .object({
    idArchivo: z
      .string({ error: 'El id del archivo debe ser texto' })
      .trim()
      .min(1, { error: 'El id del archivo no puede ir vacío' })
      .optional()
      .describe('Si viene, solo quita la foto cuando la vigente es EXACTAMENTE esta.'),
  })
  .describe('Acotamiento opcional del borrado de la foto de un arte.');

/** Datos validados del querystring del borrado de la foto. */
export type DatosArteFotoQuitarQuery = z.infer<typeof esquemaArteFotoQuitarQuery>;
