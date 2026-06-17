import { z } from 'zod';

/**
 * Contrato Zod del Módulo 2 — Modelos (F1-E4): el modelo (ex `Modelos`), su receta/BOM
 * (telas/avíos/bordados) y sus fotos en R2. Una sola definición de las reglas de captura
 * para UI y servidor (fuente del OpenAPI). Doc funcional: `Documentacion_MJD/01-Modelos.md`.
 * Catálogo GLOBAL (ADR-0007): la unicidad de `codigo` es global.
 *
 * Decisiones cerradas con Gabriel:
 *  • `Genero` es un catálogo SEMBRADO con un solo selector (`GET /api/generos`, bajo
 *    `modelos.ver`); aquí solo su salida. `Modelo.idGenero` es FK nullable (ETL E7).
 *  • BOM telas/avíos: cada renglón con `consumoPorPrenda` + las TRES banderas 🔑
 *    `paraPreCosto`/`paraProduccion`/`paraCosto` (doc 01-Modelos §2 — se conservan).
 *  • BOM bordados: `{ idBordado, precio }` SIN cantidad ni banderas. `precio` es NULLABLE
 *    en el contrato (para que el ETL E7 cargue históricos rellenando desde `Bordado.precio`);
 *    en la captura por UI es REQUERIDO y se pre-llena con `Bordado.precio` (editable). Misma
 *    relajación-para-ETL que `Avio.unidad/presentacion` en E3 (ADR-0009).
 *
 * Semántica del PATCH parcial (M1, igual que Tela/Avio): omitir un campo (`undefined`) = no
 * tocar; mandar `null`/'' en un opcional de texto = vaciarlo (se guarda `null`, nunca '').
 * Decimales entran como `number` y salen como `number` (Prisma los guarda como `Decimal`).
 */

// ── Género (catálogo selector, sin permiso propio) ─────────────────────────────

/** Salida de un género en la API (selector `GET /api/generos`). */
export const esquemaGeneroSalida = z
  .object({
    id: z.number().int().describe('Id del género.'),
    nombre: z.string().describe('Nombre del género (único global).'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
  })
  .describe('Género del catálogo (selector).');

/** Forma de un género tal como lo devuelve la API. */
export type GeneroSalida = z.infer<typeof esquemaGeneroSalida>;

// ── BOM: telas y avíos (consumo + 3 banderas 🔑) ───────────────────────────────

/** Consumo por prenda: número positivo (Prisma lo guarda como `Decimal(12,4)`). */
const esquemaConsumo = z
  .number({ error: 'El consumo debe ser un número' })
  .positive({ error: 'El consumo debe ser mayor a 0' });

/**
 * Renglón de captura del BOM de TELAS de un modelo (doc 01-Modelos §2, `ModelosTela`): la
 * tela del catálogo, su consumo por prenda y las TRES banderas de uso. Las banderas tienen
 * default `true` en el alta; la unicidad de la tela DENTRO del modelo la valida el dominio
 * (rechazo claro) y la respalda la PK compuesta `[idModelo, idTela]`.
 */
export const esquemaModeloTelaEntrada = z.object({
  idTela: z
    .number({ error: 'El id de la tela es obligatorio' })
    .int({ error: 'El id de la tela debe ser entero' })
    .positive({ error: 'El id de la tela debe ser positivo' }),
  consumoPorPrenda: esquemaConsumo,
  paraPreCosto: z.boolean().default(true),
  paraProduccion: z.boolean().default(true),
  paraCosto: z.boolean().default(true),
});

/** Datos validados de un renglón de tela del BOM. */
export type DatosModeloTelaEntrada = z.infer<typeof esquemaModeloTelaEntrada>;

/**
 * Renglón de captura del BOM de AVÍOS de un modelo (doc 01-Modelos §2, `ModelosHab`): misma
 * forma que la tela (consumo + 3 banderas), referenciando un avío del catálogo.
 */
export const esquemaModeloAvioEntrada = z.object({
  idAvio: z
    .number({ error: 'El id del avío es obligatorio' })
    .int({ error: 'El id del avío debe ser entero' })
    .positive({ error: 'El id del avío debe ser positivo' }),
  consumoPorPrenda: esquemaConsumo,
  paraPreCosto: z.boolean().default(true),
  paraProduccion: z.boolean().default(true),
  paraCosto: z.boolean().default(true),
});

/** Datos validados de un renglón de avío del BOM. */
export type DatosModeloAvioEntrada = z.infer<typeof esquemaModeloAvioEntrada>;

/**
 * Renglón de captura del BOM de BORDADOS de un modelo (doc 01-Modelos §2, `ModelosBor`): el
 * bordado del catálogo y su `precio`. SIN cantidad ni banderas (decisión cerrada). `precio`
 * es OPCIONAL en el contrato (nullable en BD para el ETL E7); la UI lo exige y lo pre-llena
 * con `Bordado.precio` (editable).
 */
export const esquemaModeloBordadoEntrada = z.object({
  idBordado: z
    .number({ error: 'El id del bordado es obligatorio' })
    .int({ error: 'El id del bordado debe ser entero' })
    .positive({ error: 'El id del bordado debe ser positivo' }),
  precio: z
    .number({ error: 'El precio debe ser un número' })
    .nonnegative({ error: 'El precio no puede ser negativo' })
    .optional(),
});

/** Datos validados de un renglón de bordado del BOM. */
export type DatosModeloBordadoEntrada = z.infer<typeof esquemaModeloBordadoEntrada>;

/**
 * Lista de telas del BOM (sin `idTela` repetido — un componente aparece UNA vez). Puede ir
 * VACÍA (un modelo nuevo puede no tener BOM aún). Lo refina el esquema y lo re-valida el dominio.
 */
export const esquemaModeloTelas = z
  .array(esquemaModeloTelaEntrada)
  .max(200, { error: 'Demasiadas telas en el modelo' })
  .refine((items) => new Set(items.map((i) => i.idTela)).size === items.length, {
    error: 'Hay telas repetidas en el modelo',
  });

/** Lista de avíos del BOM (sin `idAvio` repetido; puede ir vacía). */
export const esquemaModeloAvios = z
  .array(esquemaModeloAvioEntrada)
  .max(200, { error: 'Demasiados avíos en el modelo' })
  .refine((items) => new Set(items.map((i) => i.idAvio)).size === items.length, {
    error: 'Hay avíos repetidos en el modelo',
  });

/** Lista de bordados del BOM (sin `idBordado` repetido; puede ir vacía). */
export const esquemaModeloBordados = z
  .array(esquemaModeloBordadoEntrada)
  .max(100, { error: 'Demasiados bordados en el modelo' })
  .refine((items) => new Set(items.map((i) => i.idBordado)).size === items.length, {
    error: 'Hay bordados repetidos en el modelo',
  });

// ── Modelo (datos generales) ───────────────────────────────────────────────────

/** Campos opcionales del modelo (mismas reglas de longitud en alta y edición). */
const camposOpcionalesModelo = {
  descripcion: z
    .string()
    .trim()
    .max(500, { error: 'La descripción no puede tener más de 500 caracteres' })
    .optional(),
} as const;

/**
 * Alta de modelo (catálogo global F1-E4). El `codigo` es la clave de negocio (único global).
 * `maquilaBase` (costo de maquila base, doc 01-Modelos §4) y las FK temporada/curva/género
 * son OPCIONALES (el ETL E7 las poblará). El BOM no va aquí: se captura con los endpoints de
 * BOM tras crear el modelo (igual que la foto del bordado en E3). Nace activo y sin BOM/fotos.
 */
export const esquemaModeloCrear = z.object({
  codigo: z
    .string({ error: 'El código es obligatorio' })
    .trim()
    .min(1, { error: 'El código es obligatorio' })
    .max(50, { error: 'El código no puede tener más de 50 caracteres' }),
  /** Costo de maquila base (informativo en el catálogo; lo heredan las órdenes). Opcional, no negativo. */
  maquilaBase: z
    .number({ error: 'La maquila base debe ser un número' })
    .nonnegative({ error: 'La maquila base no puede ser negativa' })
    .optional(),
  /** Temporada (opcional). Si viene, el dominio exige que exista y esté activa. */
  idTemporada: z
    .number({ error: 'El id de la temporada debe ser un número' })
    .int({ error: 'El id de la temporada debe ser entero' })
    .positive({ error: 'El id de la temporada debe ser positivo' })
    .optional(),
  /** Curva de tallas (opcional, D4). Si viene, el dominio exige que exista y esté activa. */
  idCurvaTalla: z
    .number({ error: 'El id de la curva de tallas debe ser un número' })
    .int({ error: 'El id de la curva de tallas debe ser entero' })
    .positive({ error: 'El id de la curva de tallas debe ser positivo' })
    .optional(),
  /** Género (opcional). Si viene, el dominio exige que exista y esté activo. */
  idGenero: z
    .number({ error: 'El id del género debe ser un número' })
    .int({ error: 'El id del género debe ser entero' })
    .positive({ error: 'El id del género debe ser positivo' })
    .optional(),
  ...camposOpcionalesModelo,
});

/** Datos validados de alta de modelo. */
export type DatosModeloCrear = z.infer<typeof esquemaModeloCrear>;

/**
 * Edición de modelo: `id` + todos los campos del alta opcionales (edición parcial) +
 * `activo` para descontinuar/reactivar. Los textos opcionales son nullable (M1: `null`/'' =
 * borrar). Las FK aceptan `null` para QUITAR la relación; omitir = no tocar. El BOM NO se
 * toca aquí (tiene sus propios endpoints, como la foto del bordado en E3).
 */
export const esquemaModeloEditar = z
  .object({
    codigo: z
      .string()
      .trim()
      .min(1, { error: 'El código es obligatorio' })
      .max(50, { error: 'El código no puede tener más de 50 caracteres' })
      .optional(),
    /** `null` quita el valor; un número lo fija; omitir = no tocar. */
    maquilaBase: z
      .number({ error: 'La maquila base debe ser un número' })
      .nonnegative({ error: 'La maquila base no puede ser negativa' })
      .nullable()
      .optional(),
    /** `null` quita la temporada; un id la fija; omitir = no tocar. */
    idTemporada: z
      .number({ error: 'El id de la temporada debe ser un número' })
      .int({ error: 'El id de la temporada debe ser entero' })
      .positive({ error: 'El id de la temporada debe ser positivo' })
      .nullable()
      .optional(),
    /** `null` quita la curva; un id la fija; omitir = no tocar. */
    idCurvaTalla: z
      .number({ error: 'El id de la curva de tallas debe ser un número' })
      .int({ error: 'El id de la curva de tallas debe ser entero' })
      .positive({ error: 'El id de la curva de tallas debe ser positivo' })
      .nullable()
      .optional(),
    /** `null` quita el género; un id lo fija; omitir = no tocar. */
    idGenero: z
      .number({ error: 'El id del género debe ser un número' })
      .int({ error: 'El id del género debe ser entero' })
      .positive({ error: 'El id del género debe ser positivo' })
      .nullable()
      .optional(),
    descripcion: camposOpcionalesModelo.descripcion.nullable(),
    activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
  })
  .extend({
    id: z
      .number({ error: 'El id del modelo es obligatorio' })
      .int({ error: 'El id del modelo debe ser entero' })
      .positive({ error: 'El id del modelo debe ser positivo' }),
  });

/** Datos validados de edición de modelo. */
export type DatosModeloEditar = z.infer<typeof esquemaModeloEditar>;

/** Cuerpo del PATCH de modelo (la ruta REST recibe el `id` en la URL, no en el body). */
export const esquemaModeloPatchCuerpo = esquemaModeloEditar.omit({ id: true });

/** Datos validados del cuerpo del PATCH de modelo (sin `id`). */
export type DatosModeloPatchCuerpo = z.infer<typeof esquemaModeloPatchCuerpo>;

// ── Salida del BOM (renglones embebidos en la ficha) ───────────────────────────

/** Salida de un renglón de tela del BOM (con el nombre de la tela embebido para la UI). */
export const esquemaModeloTelaSalida = z
  .object({
    idTela: z.number().int().describe('Id de la tela.'),
    nombre: z.string().describe('Nombre de la tela (para la UI).'),
    consumoPorPrenda: z.number().describe('Consumo de tela por prenda.'),
    paraPreCosto: z.boolean().describe('¿Entra en el pre-costeo?'),
    paraProduccion: z.boolean().describe('¿Se considera al producir?'),
    paraCosto: z.boolean().describe('¿Entra en el costeo real?'),
  })
  .describe('Renglón de tela del BOM del modelo.');

/** Salida de un renglón de avío del BOM (con la clave/descripción del avío embebidas). */
export const esquemaModeloAvioSalida = z
  .object({
    idAvio: z.number().int().describe('Id del avío.'),
    clave: z.string().describe('Clave del avío (para la UI).'),
    descripcion: z.string().describe('Descripción del avío (para la UI).'),
    consumoPorPrenda: z.number().describe('Consumo de avío por prenda.'),
    paraPreCosto: z.boolean().describe('¿Entra en el pre-costeo?'),
    paraProduccion: z.boolean().describe('¿Se considera al producir?'),
    paraCosto: z.boolean().describe('¿Entra en el costeo real?'),
  })
  .describe('Renglón de avío del BOM del modelo.');

/** Salida de un renglón de bordado del BOM (con el nombre/tipo del bordado embebidos). */
export const esquemaModeloBordadoSalida = z
  .object({
    idBordado: z.number().int().describe('Id del bordado.'),
    nombre: z.string().describe('Nombre del bordado (para la UI).'),
    tipo: z.enum(['BORDADO', 'ESTAMPADO']).describe('Tipo del bordado (para la UI).'),
    precio: z.number().nullable().describe('Precio del bordado en este modelo, o null.'),
  })
  .describe('Renglón de bordado del BOM del modelo.');

// ── Salida del modelo (ficha con BOM + conteo de fotos) ────────────────────────

/**
 * Salida de un modelo en la API. En el LISTADO trae los datos generales + conteo de fotos +
 * el nombre de temporada/género (sin el BOM, que es voluminoso); la FICHA
 * (`GET /api/modelos/:id`) trae además el BOM completo embebido. Los decimales se serializan
 * a `number`; la auditoría va incluida.
 */
export const esquemaModeloSalida = z
  .object({
    id: z.number().int().describe('Id del modelo.'),
    codigo: z.string().describe('Código/clave de negocio del modelo (único global).'),
    descripcion: z.string().nullable().describe('Descripción, o null.'),
    maquilaBase: z.number().nullable().describe('Costo de maquila base, o null.'),
    idTemporada: z.number().int().nullable().describe('Id de la temporada, o null.'),
    temporada: z.string().nullable().describe('Nombre de la temporada, o null.'),
    idCurvaTalla: z.number().int().nullable().describe('Id de la curva de tallas, o null.'),
    curvaTalla: z.string().nullable().describe('Nombre de la curva de tallas, o null.'),
    idGenero: z.number().int().nullable().describe('Id del género, o null.'),
    genero: z.string().nullable().describe('Nombre del género, o null.'),
    cantidadFotos: z.number().int().describe('Cantidad de fotos del modelo.'),
    /**
     * URL GET prefirmada de la FOTO PRINCIPAL del modelo (la primera por orden, luego id), o
     * `null` si el modelo no tiene fotos. La resuelve el listado para que la galería pinte la
     * miniatura SIN una petición por celda (sin N+1). Vida corta: se regenera en cada listado.
     */
    urlFotoPrincipal: z
      .string()
      .nullable()
      .describe('URL prefirmada de la foto principal del modelo, o null si no tiene fotos.'),
    activo: z.boolean().describe('Falso si está descontinuado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Modelo del catálogo (global).');

/** Forma de un modelo (listado) tal como lo devuelve la API. */
export type ModeloSalida = z.infer<typeof esquemaModeloSalida>;

/** Salida de la FICHA de un modelo: datos generales + BOM completo embebido. */
export const esquemaModeloFichaSalida = esquemaModeloSalida
  .extend({
    telas: z.array(esquemaModeloTelaSalida).describe('Telas del BOM.'),
    avios: z.array(esquemaModeloAvioSalida).describe('Avíos del BOM.'),
    bordados: z.array(esquemaModeloBordadoSalida).describe('Bordados del BOM.'),
  })
  .describe('Ficha de un modelo con su receta (BOM) completa.');

/** Forma de la ficha de un modelo (con BOM) tal como la devuelve la API. */
export type ModeloFichaSalida = z.infer<typeof esquemaModeloFichaSalida>;

/**
 * Parámetros del listado de modelos EN LA URL (querystring): todo llega como texto, así que
 * se coaccionan números y banderas. Búsqueda por `codigo` O `descripcion` (insensible a
 * mayúsculas); filtros opcionales `idTemporada` e `incluirInactivos`. Volumen ~4,987:
 * SIEMPRE en modo servidor.
 */
export const esquemaModelosQuery = z
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
      .max(200)
      .optional()
      .describe('Texto a buscar en el código o la descripción (insensible a mayúsculas).'),
    idTemporada: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por id de temporada.'),
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los descontinuados ("true"/"false").'),
    ordenarPor: z
      .enum(['codigo', 'descripcion', 'creadoEn'])
      .default('codigo')
      .describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('asc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de modelos.');

/** Parámetros de listado de modelos ya coaccionados desde la URL. */
export type ModelosQuery = z.infer<typeof esquemaModelosQuery>;

/** Respuesta paginada del listado de modelos (forma estándar `Pagina<T>`). */
export const esquemaModelosPagina = z
  .object({
    datos: z.array(esquemaModeloSalida).describe('Modelos de la página.'),
    total: z.number().int().describe('Total de modelos que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de modelos.');

/** Forma de la respuesta paginada de modelos. */
export type ModelosPagina = z.infer<typeof esquemaModelosPagina>;

// ── Cuerpos de los endpoints de BOM (set-completo por sección) ─────────────────

/**
 * Cuerpo para reemplazar el set COMPLETO de telas del BOM (`PUT /api/modelos/:id/bom/telas`):
 * el dominio sincroniza (agrega/quita/actualiza) en UNA transacción A2 (como los colores de
 * la tela o los proveedores del avío en E3). Puede quedar vacío.
 */
export const esquemaModeloBomTelasCuerpo = z
  .object({ telas: esquemaModeloTelas })
  .describe('Set completo de telas del BOM del modelo.');

/** Datos validados del set de telas del BOM. */
export type DatosModeloBomTelas = z.infer<typeof esquemaModeloBomTelasCuerpo>;

/** Cuerpo para reemplazar el set COMPLETO de avíos del BOM (`PUT /api/modelos/:id/bom/avios`). */
export const esquemaModeloBomAviosCuerpo = z
  .object({ avios: esquemaModeloAvios })
  .describe('Set completo de avíos del BOM del modelo.');

/** Datos validados del set de avíos del BOM. */
export type DatosModeloBomAvios = z.infer<typeof esquemaModeloBomAviosCuerpo>;

/** Cuerpo para reemplazar el set COMPLETO de bordados del BOM (`PUT /api/modelos/:id/bom/bordados`). */
export const esquemaModeloBomBordadosCuerpo = z
  .object({ bordados: esquemaModeloBordados })
  .describe('Set completo de bordados del BOM del modelo.');

/** Datos validados del set de bordados del BOM. */
export type DatosModeloBomBordados = z.infer<typeof esquemaModeloBomBordadosCuerpo>;

/** Listas sueltas de cada sección del BOM (respuesta de los `GET /api/modelos/:id/bom/*`). */
export const esquemaModeloBomTelasLista = z
  .object({ datos: z.array(esquemaModeloTelaSalida).describe('Telas del BOM.') })
  .describe('Telas del BOM de un modelo.');
export type ModeloBomTelasLista = z.infer<typeof esquemaModeloBomTelasLista>;

export const esquemaModeloBomAviosLista = z
  .object({ datos: z.array(esquemaModeloAvioSalida).describe('Avíos del BOM.') })
  .describe('Avíos del BOM de un modelo.');
export type ModeloBomAviosLista = z.infer<typeof esquemaModeloBomAviosLista>;

export const esquemaModeloBomBordadosLista = z
  .object({ datos: z.array(esquemaModeloBordadoSalida).describe('Bordados del BOM.') })
  .describe('Bordados del BOM de un modelo.');
export type ModeloBomBordadosLista = z.infer<typeof esquemaModeloBomBordadosLista>;

/**
 * Cuerpo para COPIAR el BOM de otro modelo (`POST /api/modelos/:id/copiar-bom`). `idOrigen`
 * es el modelo del que se copian telas/avíos/bordados; `reemplazar` decide si se reemplaza
 * el BOM actual (true, por defecto) o se fusiona conservando lo existente (false). Atómico (A2).
 */
export const esquemaModeloCopiarBomCuerpo = z
  .object({
    idOrigen: z
      .number({ error: 'El id del modelo de origen es obligatorio' })
      .int({ error: 'El id del modelo de origen debe ser entero' })
      .positive({ error: 'El id del modelo de origen debe ser positivo' }),
    /** true (por defecto): reemplaza el BOM actual; false: fusiona (conserva lo existente). */
    reemplazar: z.boolean().default(true),
  })
  .describe('Copiar la receta (BOM) de otro modelo.');

/** Datos validados del cuerpo de copiar BOM. */
export type DatosModeloCopiarBom = z.infer<typeof esquemaModeloCopiarBomCuerpo>;

// ── Fotos del modelo (R2: N fotos por modelo, vía presigned) ───────────────────

/** Tipos de foto del modelo (espejo del enum `TipoFotoModelo` de src/datos). */
export const TIPOS_FOTO_MODELO = ['FRENTE', 'ESPALDA', 'OTRO'] as const;

/** Clave de tipo de foto de modelo. */
export type TipoFotoModeloClave = (typeof TIPOS_FOTO_MODELO)[number];

/** Etiquetas para UI de cada tipo de foto. */
export const ETIQUETAS_TIPO_FOTO_MODELO: Record<TipoFotoModeloClave, string> = {
  FRENTE: 'Frente',
  ESPALDA: 'Espalda',
  OTRO: 'Otra',
};

/**
 * Solicitud de subida de UNA foto de un modelo: el navegador manda los metadatos de la imagen
 * y el backend devuelve la URL PUT prefirmada (flujo presigned de F0). Solo imágenes
 * (`image/*`). `tipo` (frente/espalda/otra) y `orden` opcionales (default OTRO / al final).
 */
export const esquemaModeloFotoCrear = z
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
    tipo: z.enum(TIPOS_FOTO_MODELO).default('OTRO').describe('Tipo de foto (frente/espalda/otra).'),
  })
  .describe('Datos para preparar la subida de una foto de un modelo.');

/** Datos validados de la solicitud de subida de una foto de un modelo. */
export type DatosModeloFotoCrear = z.infer<typeof esquemaModeloFotoCrear>;

/** Salida tras solicitar la subida de una foto: registro + URL PUT prefirmada para R2. */
export const esquemaModeloFotoSubida = z
  .object({
    idFoto: z.number().int().describe('Id del registro ModeloFoto creado.'),
    idArchivo: z.string().describe('Id del registro Archivo creado para la foto.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    urlSubida: z.string().describe('URL PUT prefirmada: el navegador sube directo a R2.'),
    expiraEnSegundos: z.number().int().describe('Vigencia de la URL de subida (segundos).'),
  })
  .describe('Resultado de preparar la subida de una foto (URL prefirmada).');

/** Forma de la respuesta al preparar la subida de una foto. */
export type ModeloFotoSubida = z.infer<typeof esquemaModeloFotoSubida>;

/** Salida de UNA foto de un modelo, con su URL GET prefirmada para verla. */
export const esquemaModeloFotoSalida = z
  .object({
    idFoto: z.number().int().describe('Id del registro ModeloFoto.'),
    idArchivo: z.string().describe('Id del registro Archivo de la foto.'),
    tipo: z.enum(TIPOS_FOTO_MODELO).describe('Tipo de foto (frente/espalda/otra).'),
    orden: z.number().int().describe('Orden de despliegue en el carrusel.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    tipoMime: z.string().describe('Tipo MIME de la imagen.'),
    tamanoBytes: z.number().int().describe('Tamaño en bytes.'),
    urlDescarga: z.string().describe('URL GET prefirmada para ver la foto.'),
  })
  .describe('Foto de un modelo con su URL de descarga.');

/** Forma de una foto de un modelo tal como la devuelve la API. */
export type ModeloFotoSalida = z.infer<typeof esquemaModeloFotoSalida>;

/** Lista de fotos de un modelo (respuesta de `GET /api/modelos/:id/fotos`). */
export const esquemaModeloFotosLista = z
  .object({
    datos: z.array(esquemaModeloFotoSalida).describe('Fotos del modelo (ordenadas).'),
  })
  .describe('Fotos de un modelo (N por modelo).');

/** Forma de la lista de fotos de un modelo. */
export type ModeloFotosLista = z.infer<typeof esquemaModeloFotosLista>;

/**
 * Cuerpo para actualizar los metadatos de UNA foto (`PATCH /api/modelos/:id/fotos/:idFoto`):
 * tipo y/o orden. Ambos opcionales (omitir = no tocar). No reemplaza la imagen (eso es subir
 * una foto nueva y quitar la vieja).
 */
export const esquemaModeloFotoEditarCuerpo = z
  .object({
    tipo: z.enum(TIPOS_FOTO_MODELO).optional().describe('Nuevo tipo (frente/espalda/otra).'),
    orden: z
      .number({ error: 'El orden debe ser un número' })
      .int({ error: 'El orden debe ser entero' })
      .min(0, { error: 'El orden no puede ser negativo' })
      .optional()
      .describe('Nuevo orden de despliegue.'),
  })
  .describe('Metadatos a actualizar de una foto del modelo (tipo/orden).');

/** Datos validados de edición de metadatos de una foto. */
export type DatosModeloFotoEditar = z.infer<typeof esquemaModeloFotoEditarCuerpo>;
