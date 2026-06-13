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

/**
 * Captura del formulario de proveedor (alta y edicion comparten forma). Solo el
 * `nombre` es obligatorio; los demas datos (razon social, telefono, contacto,
 * condiciones) son opcionales. El `tipo` siempre se elige (default sin clasificar).
 */
export const esquemaProveedorFormulario = z.object({
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
  telefono: z
    .string()
    .trim()
    .max(100, { error: 'El teléfono no puede tener más de 100 caracteres' }),
  contacto: z
    .string()
    .trim()
    .max(150, { error: 'El contacto no puede tener más de 150 caracteres' }),
  condiciones: z
    .string()
    .trim()
    .max(500, { error: 'Las condiciones no pueden tener más de 500 caracteres' }),
});

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
