import { z } from 'zod';

/**
 * Esquemas Zod de ENTRADA del frontend (validacion de captura para una UX clara).
 *
 * Reflejan las reglas de captura del backend (`backend/src/contrato/esquemas`),
 * pero son SOLO para la experiencia de usuario: el servidor SIEMPRE re-valida y
 * es la autoridad (A1). Se definen aqui (no se importan del backend) para que el
 * build del frontend sea autonomo —la imagen de Docker no alcanza `../backend`—;
 * el unico contrato compartido son los TIPOS generados del OpenAPI
 * (`esquema.gen.ts`). Si el backend cambia una regla, se ajusta aqui en la misma
 * tarea (igual que se regenera el cliente).
 *
 * ── Campos NUMERICOS en formularios (patron de referencia) ────────────────────
 * Un `<input type="number">` controlado por react-hook-form siempre entrega un
 * STRING (vacio si no hay captura). Por eso los campos numericos opcionales se
 * modelan en el formulario como `string` y se validan como texto (vacio = sin
 * valor; si trae algo, debe ser un numero en rango). La conversion a `number`
 * ocurre al ARMAR EL CUERPO del API (`aCuerpo` de cada dialogo), no en el schema.
 *
 * Asi el tipo de ENTRADA y el de SALIDA del esquema coinciden (`string`), que es
 * lo que `useForm<T>` y `zodResolver` necesitan bajo `exactOptionalPropertyTypes`
 * (con `z.coerce.number()` la entrada seria `unknown` y chocaria con el tipo del
 * formulario). `numeroOpcional` encapsula ese patron; replicarlo en futuros
 * formularios con numeros.
 */

/**
 * Helper de captura para un numero OPCIONAL en un `<input type="number">`: el
 * valor es texto (vacio = sin valor). Valida, con un mensaje propio por caso, que
 * si hay algo sea un numero dentro de `[min, max]`. Entrada y salida son `string`;
 * la conversion a `number` la hace quien arma el cuerpo del API. Cada `refine`
 * solo aplica cuando el campo NO esta vacio (vacio = sin valor, valido).
 */
function numeroOpcional(opciones: {
  min?: number;
  max?: number;
  mensajeNoNumero: string;
  mensajeMin?: string;
  mensajeMax?: string;
}): z.ZodString {
  let esquema = z
    .string()
    .refine((valor) => valor.trim() === '' || Number.isFinite(Number(valor)), {
      error: opciones.mensajeNoNumero,
    });
  if (opciones.min !== undefined) {
    const min = opciones.min;
    esquema = esquema.refine((valor) => valor.trim() === '' || Number(valor) >= min, {
      error: opciones.mensajeMin ?? opciones.mensajeNoNumero,
    });
  }
  if (opciones.max !== undefined) {
    const max = opciones.max;
    esquema = esquema.refine((valor) => valor.trim() === '' || Number(valor) <= max, {
      error: opciones.mensajeMax ?? opciones.mensajeNoNumero,
    });
  }
  return esquema;
}

/**
 * Convierte el texto de un campo numerico opcional a `number`, o `undefined` si
 * esta vacio. La validacion del rango ya la hizo el schema; aqui solo se traduce
 * para el cuerpo del API. Pareja de {@link numeroOpcional}.
 */
export function numeroOpcionalACuerpo(valor: string): number | undefined {
  const texto = valor.trim();
  return texto === '' ? undefined : Number(texto);
}

// ── Login (espejo de `esquemaLogin` del backend) ────────────────────────────
export const esquemaLogin = z.object({
  username: z
    .string({ error: 'El usuario es obligatorio' })
    .trim()
    .min(1, { error: 'El usuario es obligatorio' })
    .max(30, { error: 'El usuario no puede tener más de 30 caracteres' }),
  password: z
    .string({ error: 'La contraseña es obligatoria' })
    .min(1, { error: 'La contraseña es obligatoria' })
    .max(128, { error: 'La contraseña no puede tener más de 128 caracteres' }),
});

/** Datos del formulario de login. */
export type DatosLogin = z.infer<typeof esquemaLogin>;

// ── Almacenes (espejo de `esquemaAlmacenCrear`/`Editar` del backend) ─────────

/** Tipos de almacen del kardex unico (PT, telas, avios). */
export const TIPOS_ALMACEN = ['PT', 'TELA', 'AVIO'] as const;

/** Clave de tipo de almacen. */
export type TipoAlmacenClave = (typeof TIPOS_ALMACEN)[number];

/** Etiquetas para UI de cada tipo de almacen. */
export const ETIQUETAS_TIPO_ALMACEN: Record<TipoAlmacenClave, string> = {
  PT: 'Producto terminado',
  TELA: 'Telas',
  AVIO: 'Avíos',
};

/**
 * Captura del formulario de almacen (alta y edicion comparten forma). El backend
 * distingue alta (POST) de edicion (PATCH); en el formulario el `tipo` siempre se
 * elige y el `nombre` siempre se captura, asi que ambos son obligatorios aqui.
 */
export const esquemaAlmacenFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  tipo: z.enum(TIPOS_ALMACEN, {
    error: 'El tipo debe ser PT (producto terminado), TELA o AVIO',
  }),
});

/** Datos del formulario de almacen. */
export type DatosAlmacenFormulario = z.infer<typeof esquemaAlmacenFormulario>;

// ── Proveedores (espejo de `esquemaProveedorCrear`/`Editar` del backend) ──────

/** Tipos de proveedor (clasificacion de negocio). */
export const TIPOS_PROVEEDOR = ['TELAS', 'AVIOS', 'SERVICIOS', 'SIN_CLASIFICAR'] as const;

/** Clave de tipo de proveedor. */
export type TipoProveedorClave = (typeof TIPOS_PROVEEDOR)[number];

/** Etiquetas para UI de cada tipo de proveedor (espejo del backend). */
export const ETIQUETAS_TIPO_PROVEEDOR: Record<TipoProveedorClave, string> = {
  TELAS: 'Telas',
  AVIOS: 'Avíos',
  SERVICIOS: 'Servicios',
  SIN_CLASIFICAR: 'Sin clasificar',
};

/** Monedas del proveedor (espejo de `MONEDAS` del backend, R15 §4). */
export const MONEDAS_PROVEEDOR = ['MXN', 'USD'] as const;
/** Clave de moneda. */
export type MonedaClave = (typeof MONEDAS_PROVEEDOR)[number];
/** Etiquetas para UI de cada moneda. */
export const ETIQUETAS_MONEDA: Record<MonedaClave, string> = {
  MXN: 'Peso mexicano (MXN)',
  USD: 'Dólar (USD)',
};

/** Métodos de pago del CFDI (espejo de `METODOS_PAGO` del backend, R15 §4). */
export const METODOS_PAGO_PROVEEDOR = ['PUE', 'PPD'] as const;
/** Clave de método de pago. */
export type MetodoPagoClave = (typeof METODOS_PAGO_PROVEEDOR)[number];
/** Etiquetas para UI de cada método de pago CFDI. */
export const ETIQUETAS_METODO_PAGO: Record<MetodoPagoClave, string> = {
  PUE: 'PUE — Pago en una sola exhibición',
  PPD: 'PPD — Pago en parcialidades o diferido',
};

/** Tipos documentales de adjunto de proveedor (espejo del backend, R15 §4). */
export const TIPOS_ARCHIVO_PROVEEDOR = ['CONSTANCIA', 'CONTRATO', 'OTRO'] as const;
/** Clave de tipo de adjunto. */
export type TipoArchivoProveedorClave = (typeof TIPOS_ARCHIVO_PROVEEDOR)[number];
/** Etiquetas para UI de cada tipo de adjunto. */
export const ETIQUETAS_TIPO_ARCHIVO_PROVEEDOR: Record<TipoArchivoProveedorClave, string> = {
  CONSTANCIA: 'Constancia de situación fiscal',
  CONTRATO: 'Contrato',
  OTRO: 'Otro',
};

/**
 * Valor "sin elegir" de un `<select>` opcional con enum (moneda/método). Como un
 * `<select>` siempre entrega un string, el campo se modela como string y se valida
 * "vacío = sin valor"; la conversión al enum del API la hace `aCuerpo` del dialogo.
 */
export const SIN_ELEGIR = '';

/**
 * ¿Es un RFC mexicano con forma válida? Espejo de `esRfcValido` del backend
 * (`src/contrato/esquemas/fiscal.ts`): persona moral (12) o física (13), forma
 * y fecha plausibles. SOLO valida la forma (no el padrón del SAT). UX espejo: el
 * backend re-valida y es la autoridad (A1).
 */
function esRfcValido(rfc: string): boolean {
  const limpio = rfc.trim().toUpperCase();
  const patron = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
  if (!patron.test(limpio)) {
    return false;
  }
  const fecha = limpio.length === 13 ? limpio.slice(4, 10) : limpio.slice(3, 9);
  const mes = Number(fecha.slice(2, 4));
  const dia = Number(fecha.slice(4, 6));
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31;
}

/**
 * ¿Es una CLABE interbancaria válida? Espejo de `esClabeValida` del backend: 18
 * dígitos con dígito de control (algoritmo Banxico, pesos 3-7-1).
 */
function esClabeValida(clabe: string): boolean {
  const limpio = clabe.trim();
  if (!/^\d{18}$/.test(limpio)) {
    return false;
  }
  const PESOS = [3, 7, 1];
  let suma = 0;
  for (let i = 0; i < 17; i += 1) {
    const cifra = Number(limpio.charAt(i));
    const peso = PESOS[i % 3] ?? 1;
    suma += (cifra * peso) % 10;
  }
  const control = (10 - (suma % 10)) % 10;
  return control === Number(limpio.charAt(17));
}

/**
 * Captura del formulario de proveedor enriquecido (F1-E1B, R15; alta y edición
 * comparten forma). Solo el `nombre` es obligatorio; los `roles` (≥1) los exige el
 * dialogo (estado aparte, no son texto del schema). Todos los demás campos son
 * opcionales y se agrupan en secciones (General · Fiscal · Contacto · Pago ·
 * Operativo). Los numéricos se capturan como texto (patron `numeroOpcional`) y los
 * enum-opcionales como string ("" = sin elegir); `aCuerpo` del dialogo convierte.
 *
 * Refleja las reglas del backend (factura ⇒ RFC + régimen; RFC/CLABE válidos),
 * pero es SOLO UX: el servidor re-valida y es la autoridad (A1).
 */
export const esquemaProveedorFormulario = z
  .object({
    // ── General ─────────────────────────────────────────────────────────────────
    nombre: z
      .string({ error: 'El nombre es obligatorio' })
      .trim()
      .min(1, { error: 'El nombre es obligatorio' })
      .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
    razonSocial: z
      .string()
      .trim()
      .max(200, { error: 'La razón social no puede tener más de 200 caracteres' }),
    tipo: z.enum(TIPOS_PROVEEDOR, {
      error: 'El tipo debe ser TELAS, AVIOS, SERVICIOS o SIN_CLASIFICAR',
    }),
    // ── Fiscal ──────────────────────────────────────────────────────────────────
    factura: z.boolean(),
    rfc: z
      .string()
      .trim()
      .toUpperCase()
      .max(13, { error: 'El RFC no puede tener más de 13 caracteres' })
      .refine((v) => v === '' || esRfcValido(v), {
        error: 'El RFC no tiene una forma válida (12 para moral, 13 para física)',
      }),
    regimenFiscalSat: z
      .string()
      .trim()
      .max(10, { error: 'El régimen fiscal no puede tener más de 10 caracteres' }),
    usoCfdiHabitual: z
      .string()
      .trim()
      .max(10, { error: 'El uso de CFDI no puede tener más de 10 caracteres' }),
    codigoPostalExpedicion: z
      .string()
      .trim()
      .refine((v) => v === '' || /^\d{5}$/.test(v), {
        error: 'El código postal debe tener 5 dígitos',
      }),
    retieneIva: z.boolean(),
    retieneIsr: z.boolean(),
    // ── Contacto ──────────────────────────────────────────────────────────────────
    email: z
      .string()
      .trim()
      .max(200, { error: 'El email no puede tener más de 200 caracteres' })
      .refine((v) => v === '' || z.email().safeParse(v).success, {
        error: 'El email no es válido',
      }),
    direccion: z
      .string()
      .trim()
      .max(300, { error: 'La dirección no puede tener más de 300 caracteres' }),
    telefono: z
      .string()
      .trim()
      .max(100, { error: 'El teléfono no puede tener más de 100 caracteres' }),
    contacto: z
      .string()
      .trim()
      .max(150, { error: 'El contacto no puede tener más de 150 caracteres' }),
    // ── Pago ──────────────────────────────────────────────────────────────────────
    diasCredito: numeroOpcional({
      min: 0,
      max: 365,
      mensajeNoNumero: 'Los días de crédito deben ser un número',
      mensajeMin: 'Los días de crédito no pueden ser negativos',
      mensajeMax: 'Los días de crédito no pueden ser más de 365',
    }).describe('Días de crédito (vacío o 0 = contado).'),
    moneda: z.string(),
    formaPago: z
      .string()
      .trim()
      .max(50, { error: 'La forma de pago no puede tener más de 50 caracteres' }),
    metodoPago: z.string(),
    banco: z.string().trim().max(100, { error: 'El banco no puede tener más de 100 caracteres' }),
    clabe: z
      .string()
      .trim()
      .refine((v) => v === '' || esClabeValida(v), {
        error: 'La CLABE debe tener 18 dígitos con dígito de control válido',
      }),
    limiteCredito: numeroOpcional({
      min: 0,
      mensajeNoNumero: 'El límite de crédito debe ser un número',
      mensajeMin: 'El límite de crédito no puede ser negativo',
    }).describe('Límite de crédito (vacío = sin valor).'),
    // ── Operativo ───────────────────────────────────────────────────────────────
    leadTimeDias: numeroOpcional({
      min: 0,
      max: 365,
      mensajeNoNumero: 'El lead time debe ser un número',
      mensajeMin: 'El lead time no puede ser negativo',
      mensajeMax: 'El lead time no puede ser más de 365 días',
    }).describe('Lead time en días (vacío = sin valor).'),
    condiciones: z
      .string()
      .trim()
      .max(500, { error: 'Las condiciones no pueden tener más de 500 caracteres' }),
    notas: z
      .string()
      .trim()
      .max(2000, { error: 'Las notas no pueden tener más de 2000 caracteres' }),
  })
  .refine(
    // Regla de captura R15 (espejo del backend): si emite CFDI, exige RFC + régimen.
    (datos) => !datos.factura || (datos.rfc !== '' && datos.regimenFiscalSat !== ''),
    { error: 'Si el proveedor factura, captura su RFC y su régimen fiscal', path: ['rfc'] },
  );

/** Datos del formulario de proveedor. */
export type DatosProveedorFormulario = z.infer<typeof esquemaProveedorFormulario>;

// ── Cortadores (espejo de `esquemaCortadorCrear`/`Editar` del backend) ────────

/**
 * Captura del formulario de cortador. Solo el `nombre` es obligatorio. El
 * `precioReferencia` es opcional y, si se captura, no puede ser negativo; se
 * captura como texto en el `<input>` y se convierte a numero al enviar
 * (`numeroOpcionalACuerpo`).
 */
export const esquemaCortadorFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
  precioReferencia: numeroOpcional({
    min: 0,
    mensajeNoNumero: 'El precio de referencia debe ser un número',
    mensajeMin: 'El precio de referencia no puede ser negativo',
  }).describe('Precio de referencia por corte (vacío = sin precio).'),
  telefonos: z
    .string()
    .trim()
    .max(150, { error: 'Los teléfonos no pueden tener más de 150 caracteres' }),
});

/** Datos del formulario de cortador. */
export type DatosCortadorFormulario = z.infer<typeof esquemaCortadorFormulario>;

// ── Temporadas (espejo de `esquemaTemporadaCrear`/`Editar` del backend) ───────

/** Captura del formulario de temporada (solo el nombre). */
export const esquemaTemporadaFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
});

/** Datos del formulario de temporada. */
export type DatosTemporadaFormulario = z.infer<typeof esquemaTemporadaFormulario>;

// ── Etiquetas de marca (espejo de `esquemaEtiquetaMarcaCrear`/`Editar`) ───────

/**
 * Captura del formulario de etiqueta de marca. `regalias` es un PORCENTAJE 0–100
 * (alimenta el costeo): se valida aqui para una UX clara, pero el backend
 * re-valida y es la autoridad. Se captura como texto y se convierte a numero al
 * enviar (`numeroOpcionalACuerpo`); vacio cuenta como 0%.
 */
export const esquemaEtiquetaMarcaFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  regalias: numeroOpcional({
    min: 0,
    max: 100,
    mensajeNoNumero: 'Las regalías deben ser un número',
    mensajeMin: 'Las regalías no pueden ser menores a 0%',
    mensajeMax: 'Las regalías no pueden ser mayores a 100%',
  }).describe('Porcentaje de regalías 0–100 (vacío = 0%).'),
});

/** Datos del formulario de etiqueta de marca. */
export type DatosEtiquetaMarcaFormulario = z.infer<typeof esquemaEtiquetaMarcaFormulario>;

// ── Colores (espejo de `esquemaColorCrear`/`Editar` del backend) ──────────────

/** Captura del formulario de color (solo el nombre). */
export const esquemaColorFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(80, { error: 'El nombre no puede tener más de 80 caracteres' }),
});

/** Datos del formulario de color. */
export type DatosColorFormulario = z.infer<typeof esquemaColorFormulario>;

// ── Tallas y curvas (espejo de `esquemaTallaCrear`/`esquemaCurvaCrear`, D4) ───

/**
 * Captura del formulario de talla (alta y edicion comparten forma). La `etiqueta`
 * es obligatoria; el `orden` es opcional (texto en un `<input type="number">`;
 * vacio = lo asigna el backend con 0). Validacion solo de UX: el backend re-valida
 * y es la autoridad (A1).
 */
export const esquemaTallaFormulario = z.object({
  etiqueta: z
    .string({ error: 'La etiqueta es obligatoria' })
    .trim()
    .min(1, { error: 'La etiqueta es obligatoria' })
    .max(50, { error: 'La etiqueta no puede tener más de 50 caracteres' }),
  orden: numeroOpcional({
    min: 0,
    mensajeNoNumero: 'El orden debe ser un número',
    mensajeMin: 'El orden no puede ser negativo',
  }).describe('Orden de despliegue (vacío = 0).'),
});

/** Datos del formulario de talla. */
export type DatosTallaFormulario = z.infer<typeof esquemaTallaFormulario>;

/**
 * Captura del formulario de curva (alta y edicion comparten forma). Solo el
 * `nombre` es texto del schema; las tallas (≥1, en orden) las gestiona el armador
 * de curva como estado aparte (igual que los roles del proveedor) y se envian
 * INLINE en el cuerpo del API. El backend exige ≥1 y es la autoridad (A1).
 */
export const esquemaCurvaFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
});

/** Datos del formulario de curva. */
export type DatosCurvaFormulario = z.infer<typeof esquemaCurvaFormulario>;

// ── Usuarios (espejo de `esquemaUsuarioCrear`/`Editar` del backend) ───────────

/**
 * Largo minimo de contraseña (espejo del backend: ≥8). Se usa tanto en el alta
 * de usuario como en el dialogo de cambio de contraseña.
 */
export const CONTRASENA_MIN = 8;

/**
 * Captura del formulario de ALTA de usuario. El alta exige usuario, nombre y
 * contraseña; el correo es opcional (el backend genera uno sintetico si falta).
 * `esAuditor` y los roles se capturan aparte (checkbox y selector multiple) y no
 * forman parte de este schema de texto. Validacion solo de UX: el backend
 * re-valida y es la autoridad (A1).
 */
export const esquemaUsuarioCrear = z.object({
  username: z
    .string({ error: 'El usuario es obligatorio' })
    .trim()
    .min(1, { error: 'El usuario es obligatorio' })
    .max(30, { error: 'El usuario no puede tener más de 30 caracteres' }),
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  email: z
    .string()
    .trim()
    .refine((valor) => valor === '' || z.email().safeParse(valor).success, {
      error: 'El correo no tiene un formato válido',
    }),
  password: z
    .string({ error: 'La contraseña es obligatoria' })
    .min(CONTRASENA_MIN, {
      error: `La contraseña debe tener al menos ${CONTRASENA_MIN} caracteres`,
    })
    .max(128, { error: 'La contraseña no puede tener más de 128 caracteres' }),
});

/** Datos del formulario de alta de usuario. */
export type DatosUsuarioCrear = z.infer<typeof esquemaUsuarioCrear>;

/**
 * Captura del formulario de EDICION de usuario. Sin contraseña (se cambia en un
 * dialogo aparte) y sin usuario (el username es inmutable). El nombre sigue
 * obligatorio; el correo opcional.
 */
export const esquemaUsuarioEditar = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  email: z
    .string()
    .trim()
    .refine((valor) => valor === '' || z.email().safeParse(valor).success, {
      error: 'El correo no tiene un formato válido',
    }),
});

/** Datos del formulario de edicion de usuario. */
export type DatosUsuarioEditar = z.infer<typeof esquemaUsuarioEditar>;

/** Captura del dialogo de cambio de contraseña (≥8, igual que el backend). */
export const esquemaContrasena = z.object({
  password: z
    .string({ error: 'La contraseña es obligatoria' })
    .min(CONTRASENA_MIN, {
      error: `La contraseña debe tener al menos ${CONTRASENA_MIN} caracteres`,
    })
    .max(128, { error: 'La contraseña no puede tener más de 128 caracteres' }),
});

/** Datos del dialogo de cambio de contraseña. */
export type DatosContrasena = z.infer<typeof esquemaContrasena>;

// ── Empresas (espejo de `esquemaEmpresaCrear`/`Editar` del backend) ───────────

/**
 * Captura del formulario de empresa (alta y edicion comparten forma). Solo el
 * `nombre` es obligatorio; razon social, identificador (RFC) y `upc` son
 * opcionales. El `upc` es clave (lo usara E5): visible y editable. Las banderas
 * (favorita, paraIpt, paraEdr) se capturan como checkbox y no van en este schema
 * de texto.
 */
export const esquemaEmpresaFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
  razonSocial: z
    .string()
    .trim()
    .max(200, { error: 'La razón social no puede tener más de 200 caracteres' }),
  identificador: z
    .string()
    .trim()
    .max(50, { error: 'El identificador no puede tener más de 50 caracteres' }),
  upc: z.string().trim().max(50, { error: 'El UPC no puede tener más de 50 caracteres' }),
});

/** Datos del formulario de empresa. */
export type DatosEmpresaFormulario = z.infer<typeof esquemaEmpresaFormulario>;

/**
 * Captura de la configuracion por empresa (seccion secundaria). Decimales
 * opcionales (utilidad, regalias, colchon) con el patron oficial `numeroOpcional`
 * (texto; vacio = sin valor). Las fechas se capturan como `<input type="date">`
 * (texto `YYYY-MM-DD`; vacio = sin fecha) y el almacen PT por defecto como id
 * numerico opcional.
 */
export const esquemaConfiguracionEmpresa = z.object({
  utilidadSugerida: numeroOpcional({
    min: 0,
    mensajeNoNumero: 'La utilidad sugerida debe ser un número',
    mensajeMin: 'La utilidad sugerida no puede ser negativa',
  }).describe('Porcentaje/factor de utilidad sugerida (vacío = sin valor).'),
  regaliasBase: numeroOpcional({
    min: 0,
    mensajeNoNumero: 'Las regalías base deben ser un número',
    mensajeMin: 'Las regalías base no pueden ser negativas',
  }).describe('Regalías base (vacío = sin valor).'),
  colchonCostura: numeroOpcional({
    min: 0,
    mensajeNoNumero: 'El colchón de costura debe ser un número',
    mensajeMin: 'El colchón de costura no puede ser negativo',
  }).describe('Colchón de costura (vacío = sin valor).'),
  fechaInventarioTelas: z.string().describe('Fecha del inventario de telas (vacío = sin fecha).'),
  fechaInventarioPt: z.string().describe('Fecha del inventario de PT (vacío = sin fecha).'),
  idAlmacenPtDefault: numeroOpcional({
    min: 1,
    mensajeNoNumero: 'El almacén PT por defecto debe ser un número',
    mensajeMin: 'El identificador de almacén no es válido',
  }).describe('Id del almacén PT por defecto (vacío = sin valor).'),
});

/** Datos del formulario de configuracion de empresa. */
export type DatosConfiguracionEmpresa = z.infer<typeof esquemaConfiguracionEmpresa>;

// ── Maquileros (espejo de `esquemaMaquileroCrear`/`Editar` del backend, F1-E2) ─

/**
 * Captura del formulario de maquilero (maquila unificada; alta y edicion comparten
 * forma). `corto` y `nombre` son obligatorios; los demas campos son texto opcional. Los
 * `tipos` de proceso (capacidades, N:N) los exige el dialogo (≥1) como estado aparte, no
 * son texto del schema. Validacion solo de UX: el backend re-valida y es la autoridad (A1).
 */
export const esquemaMaquileroFormulario = z.object({
  corto: z
    .string({ error: 'El código corto es obligatorio' })
    .trim()
    .min(1, { error: 'El código corto es obligatorio' })
    .max(50, { error: 'El código corto no puede tener más de 50 caracteres' }),
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(200, { error: 'El nombre no puede tener más de 200 caracteres' }),
  apellidos: z
    .string()
    .trim()
    .max(200, { error: 'Los apellidos no pueden tener más de 200 caracteres' }),
  telefonos: z
    .string()
    .trim()
    .max(200, { error: 'Los teléfonos no pueden tener más de 200 caracteres' }),
  direccion: z
    .string()
    .trim()
    .max(300, { error: 'La dirección no puede tener más de 300 caracteres' }),
  observaciones: z
    .string()
    .trim()
    .max(2000, { error: 'Las observaciones no pueden tener más de 2000 caracteres' }),
  obsPago: z
    .string()
    .trim()
    .max(2000, { error: 'Las observaciones de pago no pueden tener más de 2000 caracteres' }),
  asegurado: z.boolean(),
});

/** Datos del formulario de maquilero. */
export type DatosMaquileroFormulario = z.infer<typeof esquemaMaquileroFormulario>;
