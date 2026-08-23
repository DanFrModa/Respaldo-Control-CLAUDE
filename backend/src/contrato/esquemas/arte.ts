import { z } from 'zod';

/**
 * ARTE del modelo (bordado / estampado / aplicación / lavado…) — contrato compartido
 * (V1-E3d §Post-F9.35 + **V1-E3f §Post-F9.52/.58**).
 *
 * Hasta V1-E3d el arte era un CATÁLOGO global (`Bordado`) que el BOM del modelo
 * referenciaba. Daniel (12-ago-2026): *"cada arte va pegado siempre a un solo modelo…
 * sería más fácil manejar el arte (o varios) dentro del modelo. Ahí mismo establecer su
 * precio, el proveedor"*. Desde entonces el arte es HIJO del modelo (`ModeloArte`).
 *
 * **V1-E3f lo puso como Daniel lo usa de verdad** (§Post-F9.52, siete observaciones):
 *  1. **Se fue el `nombre`** — *"Es completamente irrelevante el nombre del estampado. Creo que
 *     con la descripción sería suficiente."* La `descripcion` pasó a REQUERIDA y es el campo
 *     visible; la identidad del renglón es su `id` y el orden lo da `orden` (desempate por `id`).
 *  2. **`posicion`** — frente / espalda / manga…, TEXTO LIBRE (*"a veces son cosas muy
 *     específicas, que no tendría caso tenerlas en un catálogo"*).
 *  3. El selector de proveedores se ACOTA por rol (`codigoRolProveedor` del tipo).
 *  4. **El tipo es un CATÁLOGO** (`idTipoArte` → `TipoProceso` con `esArte`), no un enum.
 *  5. **Fotos en PLURAL** (`ModeloArteFoto`), no una sola.
 *  6. Las **puntadas** se muestran solo cuando el tipo las usa (`TipoProceso.usaPuntadas`).
 *
 * Por eso este esquema no tiene `activo` (borrado suave de catálogo): un arte es un
 * renglón del BOM, se agrega y se quita como las telas y los avíos.
 */

/** Descripción del arte: el campo VISIBLE y obligatorio desde V1-E3f (ex `nombre`). */
const descripcionArte = z
  .string({ error: 'La descripción es obligatoria' })
  .trim()
  .min(1, { error: 'La descripción es obligatoria' })
  .max(500, { error: 'La descripción no puede tener más de 500 caracteres' });

/** Posición del arte en la prenda (texto libre, §Post-F9.52 punto 2). */
const posicionArte = z
  .string()
  .trim()
  .max(100, { error: 'La posición no puede tener más de 100 caracteres' });

/** Puntadas: entero no negativo (se captura solo si el tipo las usa). */
const puntadasArte = z
  .number({ error: 'Las puntadas deben ser un número' })
  .int({ error: 'Las puntadas deben ser un entero' })
  .min(0, { error: 'Las puntadas no pueden ser negativas' })
  .max(1_000_000, { error: 'Las puntadas no pueden ser más de 1,000,000' });

/** Precio del arte (el que viaja a la OP). */
const precioArte = z
  .number({ error: 'El precio debe ser un número' })
  .nonnegative({ error: 'El precio no puede ser negativo' });

/** Id del tipo de arte: FK al catálogo ÚNICO (`TipoProceso` con `esArte`, §Post-F9.58). */
const idTipoArte = z
  .number({ error: 'El tipo de arte es obligatorio' })
  .int({ error: 'El tipo de arte debe ser entero' })
  .positive({ error: 'El tipo de arte debe ser positivo' });

/** Id del proveedor que hace el arte. */
const idProveedorArte = z
  .number({ error: 'El id del proveedor debe ser un número' })
  .int({ error: 'El id del proveedor debe ser entero' })
  .positive({ error: 'El id del proveedor debe ser positivo' });

/**
 * Alta de un arte DENTRO de un modelo (el id del modelo va en la ruta, no aquí). La
 * `descripcion` y el `idTipoArte` son obligatorios; `precio` es el que viaja a la OP;
 * `idProveedor` es quién lo hace. Las FOTOS no van aquí: se suben aparte con el flujo
 * presigned de R2, una por una.
 */
export const esquemaArteCrear = z.object({
  descripcion: descripcionArte,
  posicion: posicionArte.optional(),
  puntadas: puntadasArte.optional(),
  precio: precioArte.optional(),
  idTipoArte,
  idProveedor: idProveedorArte.optional(),
});

/** Datos validados de alta de un arte. */
export type DatosArteCrear = z.infer<typeof esquemaArteCrear>;

/**
 * Edición de un arte: todos los campos del alta, opcionales (edición parcial).
 *
 * Los opcionales de TEXTO/NÚMERO aceptan además `null` para poder VACIAR un dato ya
 * capturado (M1): omitir el campo (`undefined`) = no tocar; mandar `null` = borrar.
 * `descripcion` e `idTipoArte` NO son nullables (siempre tienen valor).
 */
const baseArteEditar = z.object({
  descripcion: descripcionArte.optional(),
  posicion: posicionArte.optional().nullable(),
  puntadas: puntadasArte.optional().nullable(),
  precio: precioArte.optional().nullable(),
  idTipoArte: idTipoArte.optional(),
  idProveedor: idProveedorArte.optional().nullable(),
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

/** Una foto del arte tal como sale embebida en el arte (sin URL: se piden aparte). */
export const esquemaArteFotoResumen = z
  .object({
    idFoto: z.number().int().describe('Id del renglón de foto (ModeloArteFoto).'),
    idArchivo: z.string().describe('Id del Archivo en R2.'),
    orden: z.number().int().describe('Posición de la foto dentro del arte (0 = la primera).'),
  })
  .describe('Foto de un arte, sin su URL prefirmada.');

/**
 * Salida de un arte en la API. Proyección de `ModeloArte` a JSON: el `precio` Decimal de
 * Prisma se serializa a `number` (o null). `proveedor` y los datos del TIPO vienen resueltos
 * para pintar la tabla sin un segundo viaje, y `fotos` trae el resumen de las fotos (la URL
 * prefirmada de cada una se pide aparte). Parte del contrato OpenAPI.
 */
export const esquemaArteSalida = z
  .object({
    id: z.number().int().describe('Id del arte.'),
    idModelo: z.number().int().describe('Id del modelo dueño del arte.'),
    descripcion: z.string().describe('Descripción del arte (el campo visible desde V1-E3f).'),
    posicion: z.string().nullable().describe('Dónde va en la prenda (texto libre), o null.'),
    puntadas: z.number().int().nullable().describe('Número de puntadas (informativo), o null.'),
    precio: z.number().nullable().describe('Precio del arte (el que viaja a la OP), o null.'),
    idTipoArte: z.number().int().describe('Id del tipo de arte (catálogo TipoProceso).'),
    tipoArte: z.string().describe('Nombre del tipo de arte, resuelto.'),
    codigoTipoArte: z.string().describe('Código estable del tipo de arte (ej. "bordado").'),
    usaPuntadas: z.boolean().describe('¿El tipo de este arte usa puntadas? (§Post-F9.52.6).'),
    idProveedor: z.number().int().nullable().describe('Id del proveedor que lo hace, o null.'),
    proveedor: z.string().nullable().describe('Nombre del proveedor que lo hace, o null.'),
    fotos: z.array(esquemaArteFotoResumen).describe('Fotos del arte, ordenadas.'),
    orden: z.number().int().describe('Posición dentro del modelo (0 = arte principal).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Arte (bordado/estampado/…) de un modelo, con sus fotos en R2.');

/** Forma de un arte tal como lo devuelve la API. */
export type ArteSalida = z.infer<typeof esquemaArteSalida>;

/** Lista de artes de un modelo (respuesta de `GET /api/modelos/{id}/artes`). */
export const esquemaArtesLista = z
  .object({ datos: z.array(esquemaArteSalida).describe('Artes del modelo, ya ordenados.') })
  .describe('Artes (bordados/estampados/…) de un modelo.');

/** Forma de la lista de artes de un modelo. */
export type ArtesLista = z.infer<typeof esquemaArtesLista>;

/**
 * Cuerpo de «copiar arte de otro modelo» (`POST /api/modelos/{id}/artes/copiar`). Trae el
 * arte YA LLENO para ajustarlo: es la conveniencia que daba el catálogo, sin reinventarlo
 * (§Post-F9.35). Copia descripción/posición/puntadas/precio/tipo/proveedor **y las fotos**
 * (las copias comparten los mismos `Archivo`, igual que las que dejó la migración).
 *
 * Desde V1-E3f ya no lleva `nombre`: no hay nombre que desambiguar, y dos artes con la misma
 * descripción en un modelo son legales (§Post-F9.52 punto 1 — Daniel lo sabe).
 */
export const esquemaArteCopiarCuerpo = z
  .object({
    idArteOrigen: z
      .number({ error: 'El id del arte de origen es obligatorio' })
      .int({ error: 'El id del arte de origen debe ser entero' })
      .positive({ error: 'El id del arte de origen debe ser positivo' }),
    /** Descripción para la copia; si se omite, se conserva la del origen. */
    descripcion: descripcionArte.optional(),
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
      .describe('Texto a buscar en la descripción del arte o en la clave/nombre del modelo.'),
    idTipoArte: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por tipo de arte (id del catálogo TipoProceso).'),
    soloConFoto: z
      .stringbool()
      .default(false)
      .describe('Solo el arte que tiene foto ("true"/"false").'),
    ordenarPor: z
      .enum(['descripcion', 'modelo', 'tipo', 'creadoEn'])
      .default('descripcion')
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
    descripcion: z.string().describe('Descripción del arte.'),
    posicion: z.string().nullable().describe('Dónde va en la prenda, o null.'),
    idTipoArte: z.number().int().describe('Id del tipo de arte.'),
    tipoArte: z.string().describe('Nombre del tipo de arte.'),
    // Lo pinta el diálogo «copiar arte de otro modelo» (que consume este mismo endpoint): al
    // copiar un arte se copia SU PRECIO, así que hay que verlo ANTES de elegirlo. La rejilla de
    // la galería no lo muestra —ahí sobra—, pero el campo NO es decorativo.
    precio: z.number().nullable().describe('Precio del arte, o null.'),
    idArchivoFoto: z
      .string()
      .nullable()
      .describe('Id del Archivo de la PRIMERA foto del arte, o null si no tiene.'),
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

// ── Fotos del arte (R2: 1 arte → N fotos, vía presigned) ─────────────────────

/**
 * Solicitud de subida de UNA foto de un arte: el navegador manda los metadatos de la
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
  .describe('Datos para preparar la subida de una foto de un arte.');

/** Datos validados de la solicitud de subida de la foto de un arte. */
export type DatosArteFotoCrear = z.infer<typeof esquemaArteFotoCrear>;

/** Salida tras solicitar la subida de una foto: registro + URL PUT prefirmada para R2. */
export const esquemaArteFotoSubida = z
  .object({
    idFoto: z.number().int().describe('Id del renglón de foto creado (para limpiarlo si falla).'),
    idArchivo: z.string().describe('Id del registro Archivo creado para la foto.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    urlSubida: z.string().describe('URL PUT prefirmada: el navegador sube directo a R2.'),
    expiraEnSegundos: z.number().int().describe('Vigencia de la URL de subida (segundos).'),
  })
  .describe('Resultado de preparar la subida de una foto (URL prefirmada).');

/** Forma de la respuesta al preparar la subida de una foto. */
export type ArteFotoSubida = z.infer<typeof esquemaArteFotoSubida>;

/** Una foto del arte con su URL GET prefirmada para verla. */
export const esquemaArteFotoSalida = z
  .object({
    idFoto: z.number().int().describe('Id del renglón de foto.'),
    idArchivo: z.string().describe('Id del registro Archivo de la foto.'),
    orden: z.number().int().describe('Posición dentro del arte (0 = la primera).'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    tipoMime: z.string().describe('Tipo MIME de la imagen.'),
    tamanoBytes: z.number().int().describe('Tamaño en bytes.'),
    urlDescarga: z.string().describe('URL GET prefirmada para ver la foto.'),
  })
  .describe('Foto de un arte con su URL de descarga.');

/** Forma de una foto de arte tal como la devuelve la API. */
export type ArteFotoSalida = z.infer<typeof esquemaArteFotoSalida>;

/** Lista de fotos de un arte (`GET /api/modelos/{id}/artes/{idArte}/fotos`). */
export const esquemaArteFotosLista = z
  .object({ datos: z.array(esquemaArteFotoSalida).describe('Fotos del arte, ordenadas.') })
  .describe('Fotos de un arte, cada una con su URL prefirmada.');

/** Forma de la lista de fotos de un arte. */
export type ArteFotosLista = z.infer<typeof esquemaArteFotosLista>;
