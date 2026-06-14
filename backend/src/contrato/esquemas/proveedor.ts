import { z } from 'zod';

import { esClabeValida, esRfcValido, METODOS_PAGO, MONEDAS } from './fiscal.js';

/**
 * Tipos de proveedor (clasificación rápida de negocio). Equivale al campo `TipoProv`
 * (H/T/S) del sistema viejo (doc 03-Producción §Órdenes de Compra); el mapeo de
 * esos códigos a este enum lo hace el ETL en F1-E6. Debe mantenerse alineado con
 * el enum `TipoProveedor` de `src/datos`.
 *
 * F1-E1B: SE CONSERVA como clasificador rápido **además** de los roles multi-valor
 * (acta de Gabriel, 13-jun-2026 — la lista filtra por `tipo` Y por `rol`).
 */
export const TIPOS_PROVEEDOR = ['TELAS', 'AVIOS', 'SERVICIOS', 'SIN_CLASIFICAR'] as const;

/** Clave de tipo de proveedor. */
export type TipoProveedorClave = (typeof TIPOS_PROVEEDOR)[number];

/** Etiquetas para UI de cada tipo de proveedor. */
export const ETIQUETAS_TIPO_PROVEEDOR: Record<TipoProveedorClave, string> = {
  TELAS: 'Telas',
  AVIOS: 'Avíos',
  SERVICIOS: 'Servicios',
  SIN_CLASIFICAR: 'Sin clasificar',
};

/** Tipos de adjunto de un proveedor (R15 §4). Alineado con el enum `TipoArchivoProveedor`. */
export const TIPOS_ARCHIVO_PROVEEDOR = ['CONSTANCIA', 'CONTRATO', 'OTRO'] as const;
/** Clave de tipo de adjunto de proveedor. */
export type TipoArchivoProveedorClave = (typeof TIPOS_ARCHIVO_PROVEEDOR)[number];

/** Etiquetas para UI de cada tipo de adjunto. */
export const ETIQUETAS_TIPO_ARCHIVO_PROVEEDOR: Record<TipoArchivoProveedorClave, string> = {
  CONSTANCIA: 'Constancia de situación fiscal',
  CONTRATO: 'Contrato',
  OTRO: 'Otro',
};

// ── Campos reutilizables (mismas reglas en alta y edición) ────────────────────

/** Lista de ids de roles del proveedor (R15 §4.1; relación N:N). Enteros positivos únicos. */
const esquemaRolesIds = z
  .array(z.number().int().positive())
  .max(20, { error: 'Demasiados roles' })
  .refine((ids) => new Set(ids).size === ids.length, { error: 'Hay roles repetidos' });

/** Campos fiscales/comerciales/operativos del proveedor (R15 §4), todos opcionales. */
const camposEnriquecidos = {
  // ── Fiscal ──────────────────────────────────────────────────────────────────
  factura: z.boolean({ error: '¿Factura? debe ser verdadero o falso' }).optional(),
  rfc: z
    .string()
    .trim()
    .toUpperCase()
    .max(13, { error: 'El RFC no puede tener más de 13 caracteres' })
    .refine((v) => v === '' || esRfcValido(v), {
      error: 'El RFC no tiene una forma válida (12 para moral, 13 para física)',
    })
    .optional(),
  regimenFiscalSat: z
    .string()
    .trim()
    .max(10, { error: 'El régimen fiscal no puede tener más de 10 caracteres' })
    .optional(),
  usoCfdiHabitual: z
    .string()
    .trim()
    .max(10, { error: 'El uso de CFDI no puede tener más de 10 caracteres' })
    .optional(),
  codigoPostalExpedicion: z
    .string()
    .trim()
    .regex(/^\d{5}$/, { error: 'El código postal debe tener 5 dígitos' })
    .optional(),
  retieneIva: z.boolean({ error: 'Retiene IVA debe ser verdadero o falso' }).optional(),
  retieneIsr: z.boolean({ error: 'Retiene ISR debe ser verdadero o falso' }).optional(),

  // ── Contacto ──────────────────────────────────────────────────────────────────
  email: z
    .email({ error: 'El email no es válido' })
    .max(200, { error: 'El email no puede tener más de 200 caracteres' })
    .optional(),
  direccion: z
    .string()
    .trim()
    .max(300, { error: 'La dirección no puede tener más de 300 caracteres' })
    .optional(),

  // ── Comercial / pago ──────────────────────────────────────────────────────────
  diasCredito: z
    .number({ error: 'Los días de crédito deben ser un número' })
    .int({ error: 'Los días de crédito deben ser un entero' })
    .min(0, { error: 'Los días de crédito no pueden ser negativos' })
    .max(365, { error: 'Los días de crédito no pueden ser más de 365' })
    .optional(),
  moneda: z.enum(MONEDAS, { error: 'La moneda debe ser MXN o USD' }).optional(),
  formaPago: z
    .string()
    .trim()
    .max(50, { error: 'La forma de pago no puede tener más de 50 caracteres' })
    .optional(),
  metodoPago: z.enum(METODOS_PAGO, { error: 'El método de pago debe ser PUE o PPD' }).optional(),
  banco: z
    .string()
    .trim()
    .max(100, { error: 'El banco no puede tener más de 100 caracteres' })
    .optional(),
  clabe: z
    .string()
    .trim()
    .refine((v) => v === '' || esClabeValida(v), {
      error: 'La CLABE debe tener 18 dígitos con dígito de control válido',
    })
    .optional(),
  limiteCredito: z
    .number({ error: 'El límite de crédito debe ser un número' })
    .min(0, { error: 'El límite de crédito no puede ser negativo' })
    .optional(),

  // ── Operativo ───────────────────────────────────────────────────────────────
  leadTimeDias: z
    .number({ error: 'El lead time debe ser un número' })
    .int({ error: 'El lead time debe ser un entero de días' })
    .min(0, { error: 'El lead time no puede ser negativo' })
    .max(365, { error: 'El lead time no puede ser más de 365 días' })
    .optional(),
  notas: z
    .string()
    .trim()
    .max(2000, { error: 'Las notas no pueden tener más de 2000 caracteres' })
    .optional(),

  // ── Maquila/corte (fusión de terceros, D12/R15) ───────────────────────────────
  // Atributos propios del antiguo Maquilero, portados al Proveedor. Solo se capturan
  // cuando el tercero presta servicios de taller (rol maquila/corte/…); por eso son
  // opcionales. `corto` es clave corta única global (nullable).
  corto: z
    .string()
    .trim()
    .max(50, { error: 'El código corto no puede tener más de 50 caracteres' })
    .optional(),
  asegurado: z.boolean({ error: '¿Asegurado? debe ser verdadero o falso' }).optional(),
  obsPago: z
    .string()
    .trim()
    .max(2000, { error: 'Las observaciones de pago no pueden tener más de 2000 caracteres' })
    .optional(),
} as const;

/**
 * Variante de EDICIÓN de los campos enriquecidos: los de texto/numéricos/enum
 * aceptan además `null` para poder VACIAR un dato ya capturado (M1). Semántica del
 * PATCH parcial: omitir el campo (`undefined`) = no tocar; mandar `null` = ponerlo a
 * null (borrar). Las banderas (`factura`/`retieneIva`/`retieneIsr`) NO se hacen
 * nullable: el formulario siempre las manda como boolean y `undefined` basta para
 * "no tocar". `.nullable()` se aplica SOBRE el `.optional()` ya existente, así que
 * cada campo acepta `undefined | null | <valor válido>` conservando sus reglas.
 */
const camposEnriquecidosEditar = {
  ...camposEnriquecidos,
  rfc: camposEnriquecidos.rfc.nullable(),
  regimenFiscalSat: camposEnriquecidos.regimenFiscalSat.nullable(),
  usoCfdiHabitual: camposEnriquecidos.usoCfdiHabitual.nullable(),
  codigoPostalExpedicion: camposEnriquecidos.codigoPostalExpedicion.nullable(),
  email: camposEnriquecidos.email.nullable(),
  direccion: camposEnriquecidos.direccion.nullable(),
  diasCredito: camposEnriquecidos.diasCredito.nullable(),
  moneda: camposEnriquecidos.moneda.nullable(),
  formaPago: camposEnriquecidos.formaPago.nullable(),
  metodoPago: camposEnriquecidos.metodoPago.nullable(),
  banco: camposEnriquecidos.banco.nullable(),
  clabe: camposEnriquecidos.clabe.nullable(),
  limiteCredito: camposEnriquecidos.limiteCredito.nullable(),
  leadTimeDias: camposEnriquecidos.leadTimeDias.nullable(),
  notas: camposEnriquecidos.notas.nullable(),
  // Fusión de terceros (D12/R15): `corto`/`obsPago` se pueden VACIAR (M1); `asegurado`
  // es bandera (omitir = no tocar), no se hace nullable (igual que `factura`).
  corto: camposEnriquecidos.corto.nullable(),
  obsPago: camposEnriquecidos.obsPago.nullable(),
} as const;

/**
 * Alta de proveedor (catálogo global F1-E1, ADR-0007: sin `idEmpresa`). El nombre
 * es la clave de negocio (único global); los demás datos son opcionales.
 *
 * F1-E1B (R15): agrega `roles` (multi-valor, ≥1 lo exige el dominio en alta), campos
 * fiscales/comerciales/operativos y la regla `factura ⇒ rfc + regimenFiscalSat`
 * (validada como regla de captura aquí; el dominio la repite, A1).
 */
export const esquemaProveedorCrear = z
  .object({
    nombre: z
      .string({ error: 'El nombre es obligatorio' })
      .trim()
      .min(1, { error: 'El nombre es obligatorio' })
      .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
    razonSocial: z
      .string()
      .trim()
      .max(200, { error: 'La razón social no puede tener más de 200 caracteres' })
      .optional(),
    tipo: z
      .enum(TIPOS_PROVEEDOR, { error: 'El tipo debe ser TELAS, AVIOS, SERVICIOS o SIN_CLASIFICAR' })
      .default('SIN_CLASIFICAR'),
    telefono: z
      .string()
      .trim()
      .max(100, { error: 'El teléfono no puede tener más de 100 caracteres' })
      .optional(),
    contacto: z
      .string()
      .trim()
      .max(150, { error: 'El contacto no puede tener más de 150 caracteres' })
      .optional(),
    condiciones: z
      .string()
      .trim()
      .max(500, { error: 'Las condiciones no pueden tener más de 500 caracteres' })
      .optional(),
    /** Ids de roles a asignar (R15 §4.1). En alta el dominio exige ≥1. */
    roles: esquemaRolesIds.optional(),
    ...camposEnriquecidos,
  })
  .refine(
    // Regla de captura R15: si emite CFDI, exige RFC y régimen fiscal. Se valida
    // sobre el payload de captura (no rompe filas migradas, que no mandan `factura`).
    (datos) =>
      datos.factura !== true || ((datos.rfc ?? '') !== '' && (datos.regimenFiscalSat ?? '') !== ''),
    {
      error: 'Si el proveedor factura, captura su RFC y su régimen fiscal',
      path: ['rfc'],
    },
  );

/** Datos validados de alta de proveedor. */
export type DatosProveedorCrear = z.infer<typeof esquemaProveedorCrear>;

/**
 * Edición de proveedor: todos los campos del alta son opcionales (edición parcial)
 * más `activo` para el borrado suave (plan §4: nada se borra físicamente).
 *
 * Los campos con `.default()` en el alta se sobrescriben aquí como `.optional()` SIN
 * default: en una edición parcial, omitir un campo NO debe resetearlo (Zod `.partial()`
 * NO quita los defaults, así que el omitido se rellenaría con su default y pisaría el
 * valor real en la BD). Aquí `tipo` sin default → si no se manda, queda `undefined`.
 * Los campos enriquecidos de E1B ya son `.optional()` sin default (no tienen la trampa).
 *
 * `roles`: si se omite, NO se tocan los roles existentes; si se manda (aunque sea []),
 * el dominio reemplaza el set — y exige ≥1 (no puede quedar en 0). La misma regla
 * `factura ⇒ rfc + régimen` aplica, pero solo cuando el payload trae `factura: true`.
 */
const baseProveedorEditar = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, { error: 'El nombre es obligatorio' })
      .max(150, { error: 'El nombre no puede tener más de 150 caracteres' })
      .optional(),
    // Opcionales nullable (M1): omitir = no tocar; `null` = borrar. `nombre` NO es
    // nullable (clave de negocio obligatoria) y `tipo` tampoco (siempre tiene valor).
    razonSocial: z
      .string()
      .trim()
      .max(200, { error: 'La razón social no puede tener más de 200 caracteres' })
      .optional()
      .nullable(),
    tipo: z
      .enum(TIPOS_PROVEEDOR, { error: 'El tipo debe ser TELAS, AVIOS, SERVICIOS o SIN_CLASIFICAR' })
      .optional(),
    telefono: z
      .string()
      .trim()
      .max(100, { error: 'El teléfono no puede tener más de 100 caracteres' })
      .optional()
      .nullable(),
    contacto: z
      .string()
      .trim()
      .max(150, { error: 'El contacto no puede tener más de 150 caracteres' })
      .optional()
      .nullable(),
    condiciones: z
      .string()
      .trim()
      .max(500, { error: 'Las condiciones no pueden tener más de 500 caracteres' })
      .optional()
      .nullable(),
    /** Reemplaza el set de roles si viene; el dominio exige ≥1. Omitir = no tocar. */
    roles: esquemaRolesIds.optional(),
    activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
    ...camposEnriquecidosEditar,
  })
  .extend({
    id: z
      .number({ error: 'El id del proveedor es obligatorio' })
      .int({ error: 'El id del proveedor debe ser entero' })
      .positive({ error: 'El id del proveedor debe ser positivo' }),
  });

/**
 * Regla de captura compartida por crear/editar: factura ⇒ RFC + régimen fiscal. En
 * edición rfc/régimen pueden llegar `null` (intento de vaciarlos); `?? ''` los trata
 * como ausentes, así que poner factura sin RFC —o vaciar el RFC con factura activa—
 * falla la regla (no se puede facturar sin RFC).
 */
const reglaFacturaExigeRfc = (datos: {
  factura?: boolean | null | undefined;
  rfc?: string | null | undefined;
  regimenFiscalSat?: string | null | undefined;
}): boolean =>
  datos.factura !== true || ((datos.rfc ?? '') !== '' && (datos.regimenFiscalSat ?? '') !== '');

export const esquemaProveedorEditar = baseProveedorEditar.refine(reglaFacturaExigeRfc, {
  error: 'Si el proveedor factura, captura su RFC y su régimen fiscal',
  path: ['rfc'],
});

/** Datos validados de edición de proveedor. */
export type DatosProveedorEditar = z.infer<typeof esquemaProveedorEditar>;

/**
 * Cuerpo del PATCH de proveedor (la ruta REST recibe el `id` en la URL, no en el body).
 * Se deriva del esquema OBJETO base (antes del `.refine()`, que produce un efecto sin
 * `.omit()`), omitiendo `id` y re-aplicando la regla `factura ⇒ RFC`.
 */
export const esquemaProveedorPatchCuerpo = baseProveedorEditar
  .omit({ id: true })
  .refine(reglaFacturaExigeRfc, {
    error: 'Si el proveedor factura, captura su RFC y su régimen fiscal',
    path: ['rfc'],
  });

/** Datos validados del cuerpo del PATCH de proveedor (sin `id`). */
export type DatosProveedorPatchCuerpo = z.infer<typeof esquemaProveedorPatchCuerpo>;

/** Forma de un rol del proveedor tal como sale embebido en el proveedor. */
export const esquemaRolProveedorEnProveedor = z
  .object({
    id: z.number().int().describe('Id del rol.'),
    codigo: z.string().describe('Clave estable del rol (kebab-case).'),
    nombre: z.string().describe('Nombre legible del rol.'),
  })
  .describe('Rol/servicio asignado al proveedor.');

/**
 * Salida de un proveedor en la API (lo que ve el frontend). Proyección del modelo
 * `Proveedor` a JSON, con la auditoría (quién/cuándo) y, en E1B, los campos
 * enriquecidos, los `roles` asignados y el conteo de adjuntos. Parte del contrato OpenAPI.
 */
export const esquemaProveedorSalida = z
  .object({
    id: z.number().int().describe('Id del proveedor.'),
    nombre: z.string().describe('Nombre del proveedor.'),
    razonSocial: z.string().nullable().describe('Razón social, o null.'),
    tipo: z
      .enum(TIPOS_PROVEEDOR)
      .describe('Clasificación rápida: TELAS, AVIOS, SERVICIOS o SIN_CLASIFICAR.'),
    telefono: z.string().nullable().describe('Teléfono, o null.'),
    contacto: z.string().nullable().describe('Persona de contacto, o null.'),
    condiciones: z.string().nullable().describe('Condiciones comerciales (texto libre), o null.'),
    // ── Fiscal (E1B) ──────────────────────────────────────────────────────────
    factura: z.boolean().nullable().describe('¿Emite CFDI? (formal/informal), o null.'),
    rfc: z.string().nullable().describe('RFC, o null.'),
    regimenFiscalSat: z.string().nullable().describe('Régimen fiscal del SAT, o null.'),
    usoCfdiHabitual: z.string().nullable().describe('Uso de CFDI habitual, o null.'),
    codigoPostalExpedicion: z.string().nullable().describe('CP de expedición, o null.'),
    retieneIva: z.boolean().nullable().describe('¿Se le retiene IVA?, o null.'),
    retieneIsr: z.boolean().nullable().describe('¿Se le retiene ISR?, o null.'),
    // ── Contacto (E1B) ────────────────────────────────────────────────────────
    email: z.string().nullable().describe('Email (para OC y XML), o null.'),
    direccion: z.string().nullable().describe('Dirección, o null.'),
    // ── Comercial / pago (E1B) ──────────────────────────────────────────────────
    diasCredito: z.number().int().nullable().describe('Días de crédito (null/0 = contado).'),
    moneda: z.string().nullable().describe('Moneda habitual (MXN/USD), o null.'),
    formaPago: z.string().nullable().describe('Forma de pago, o null.'),
    metodoPago: z.string().nullable().describe('Método de pago CFDI (PUE/PPD), o null.'),
    banco: z.string().nullable().describe('Banco, o null.'),
    clabe: z.string().nullable().describe('CLABE interbancaria, o null.'),
    limiteCredito: z.number().nullable().describe('Límite de crédito, o null.'),
    // ── Operativo (E1B) ─────────────────────────────────────────────────────────
    leadTimeDias: z.number().int().nullable().describe('Lead time en días, o null.'),
    notas: z.string().nullable().describe('Notas, o null.'),
    // ── Maquila/corte (fusión de terceros D12/R15) ───────────────────────────────
    corto: z.string().nullable().describe('Código corto del taller (ex maquilero), o null.'),
    asegurado: z.boolean().nullable().describe('¿Está asegurado? (talleres), o null.'),
    obsPago: z.string().nullable().describe('Observaciones de pago (talleres), o null.'),
    // ── Relaciones (E1B) ────────────────────────────────────────────────────────
    roles: z.array(esquemaRolProveedorEnProveedor).describe('Roles/servicios del proveedor.'),
    cantidadAdjuntos: z.number().int().describe('Cantidad de adjuntos del proveedor.'),
    activo: z.boolean().describe('Falso si está desactivado (borrado suave).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que lo modificó.'),
  })
  .describe('Proveedor del catálogo (global, enriquecido R15).');

/** Forma de un proveedor tal como lo devuelve la API. */
export type ProveedorSalida = z.infer<typeof esquemaProveedorSalida>;

/**
 * Parámetros del listado de proveedores EN LA URL (querystring): todo llega como
 * texto, así que se coaccionan números y banderas. Mapea 1:1 al servicio de
 * dominio `listarProveedores`. `.describe()` documenta el contrato.
 *
 * F1-E1B: agrega el filtro `rol` (por id) junto al `tipo` de E1 (ambos coexisten).
 */
export const esquemaProveedoresQuery = z
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
    tipo: z.enum(TIPOS_PROVEEDOR).optional().describe('Filtra por tipo de proveedor.'),
    rol: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por id de rol/servicio del proveedor (R15).'),
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
  .describe('Filtros, orden y paginación del listado de proveedores.');

/** Parámetros de listado de proveedores ya coaccionados desde la URL. */
export type ProveedoresQuery = z.infer<typeof esquemaProveedoresQuery>;

/** Respuesta paginada del listado de proveedores (forma estándar `Pagina<T>`). */
export const esquemaProveedoresPagina = z
  .object({
    datos: z.array(esquemaProveedorSalida).describe('Proveedores de la página.'),
    total: z.number().int().describe('Total de proveedores que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de proveedores.');

/** Forma de la respuesta paginada de proveedores. */
export type ProveedoresPagina = z.infer<typeof esquemaProveedoresPagina>;

// ── Roles de proveedor (catálogo selector, R15 §4.1) ──────────────────────────

/** Salida de un rol de proveedor (para el selector `GET /api/roles-proveedor`). */
export const esquemaRolProveedorSalida = z
  .object({
    id: z.number().int().describe('Id del rol.'),
    codigo: z.string().describe('Clave estable del rol (kebab-case).'),
    nombre: z.string().describe('Nombre legible del rol.'),
    activo: z.boolean().describe('Falso si está desactivado.'),
  })
  .describe('Rol/servicio de proveedor (catálogo administrable).');

/** Forma de un rol de proveedor tal como lo devuelve la API. */
export type RolProveedorSalida = z.infer<typeof esquemaRolProveedorSalida>;

// ── Adjuntos del proveedor (R15 §4: constancia, contrato — en R2) ─────────────

/**
 * Solicitud de subida de un adjunto del proveedor: el navegador manda los metadatos
 * del archivo y el backend devuelve la URL PUT prefirmada (flujo presigned de F0).
 */
export const esquemaProveedorAdjuntoCrear = z
  .object({
    tipo: z
      .enum(TIPOS_ARCHIVO_PROVEEDOR, { error: 'El tipo de adjunto no es válido' })
      .default('OTRO')
      .describe('Tipo documental del adjunto (constancia/contrato/otro).'),
    nombreOriginal: z
      .string({ error: 'El nombre del archivo es obligatorio' })
      .trim()
      .min(1, { error: 'El nombre del archivo es obligatorio' })
      .max(255)
      .describe('Nombre del archivo tal como lo llama el usuario.'),
    tipoMime: z
      .string({ error: 'El tipo de archivo es obligatorio' })
      .trim()
      .regex(/^[\w.+-]+\/[\w.+-]+$/, { error: 'Tipo de archivo (MIME) inválido' })
      .describe('Tipo MIME del archivo (ej. application/pdf).'),
    tamanoBytes: z
      .number({ error: 'El tamaño es obligatorio' })
      .int({ error: 'El tamaño debe ser un entero de bytes' })
      .positive({ error: 'El archivo está vacío' })
      .describe('Tamaño exacto en bytes (la URL prefirmada solo acepta este tamaño).'),
  })
  .describe('Datos para preparar la subida de un adjunto de proveedor.');

/** Datos validados de alta de adjunto de proveedor. */
export type DatosProveedorAdjuntoCrear = z.infer<typeof esquemaProveedorAdjuntoCrear>;

/** Salida tras solicitar la subida: registro + URL PUT prefirmada para R2. */
export const esquemaProveedorAdjuntoSubida = z
  .object({
    idArchivo: z.string().describe('Id del registro Archivo creado.'),
    tipo: z.enum(TIPOS_ARCHIVO_PROVEEDOR).describe('Tipo documental del adjunto.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    urlSubida: z.string().describe('URL PUT prefirmada: el navegador sube directo a R2.'),
    expiraEnSegundos: z.number().int().describe('Vigencia de la URL de subida (segundos).'),
  })
  .describe('Resultado de preparar la subida de un adjunto (URL prefirmada).');

/** Forma de la respuesta al preparar la subida de un adjunto. */
export type ProveedorAdjuntoSubida = z.infer<typeof esquemaProveedorAdjuntoSubida>;

/** Salida de un adjunto ya registrado, con su URL GET prefirmada para verlo/descargarlo. */
export const esquemaProveedorAdjuntoSalida = z
  .object({
    idArchivo: z.string().describe('Id del registro Archivo.'),
    tipo: z.enum(TIPOS_ARCHIVO_PROVEEDOR).describe('Tipo documental del adjunto.'),
    nombreOriginal: z.string().describe('Nombre original del archivo.'),
    tipoMime: z.string().describe('Tipo MIME del archivo.'),
    tamanoBytes: z.number().int().describe('Tamaño en bytes.'),
    urlDescarga: z.string().describe('URL GET prefirmada para ver/descargar el archivo.'),
    creadoEn: z.iso.datetime().describe('Fecha en que se adjuntó (ISO 8601).'),
  })
  .describe('Adjunto de un proveedor con su URL de descarga.');

/** Forma de un adjunto de proveedor tal como lo devuelve la API. */
export type ProveedorAdjuntoSalida = z.infer<typeof esquemaProveedorAdjuntoSalida>;

/** Lista de adjuntos de un proveedor. */
export const esquemaProveedorAdjuntosLista = z
  .object({
    datos: z.array(esquemaProveedorAdjuntoSalida).describe('Adjuntos del proveedor.'),
  })
  .describe('Adjuntos de un proveedor.');

/** Forma de la lista de adjuntos. */
export type ProveedorAdjuntosLista = z.infer<typeof esquemaProveedorAdjuntosLista>;
