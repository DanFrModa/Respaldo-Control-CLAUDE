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

// ── Auditores (espejo de `esquemaAuditorCrear`/`Editar` del backend) ──────────

/** Roles de auditor (proto `CAT_AUDITORES`: badge Auditor / Sr. Auditor). */
export const ROLES_AUDITOR = ['Auditor', 'Sr. Auditor'] as const;

/** Clave de rol de auditor. */
export type RolAuditorClave = (typeof ROLES_AUDITOR)[number];

/** Niveles AQL de certificación de un auditor (texto: 1.0 / 1.5 / 2.5 / 4.0). */
export const NIVELES_AQL_AUDITOR = ['1.0', '1.5', '2.5', '4.0'] as const;

/** Clave de nivel AQL de auditor. */
export type NivelAqlAuditorClave = (typeof NIVELES_AQL_AUDITOR)[number];

/**
 * Captura del formulario de auditor (alta y edicion comparten forma). El backend
 * distingue alta (POST) de edicion (PATCH); en el formulario el `rol` y el `nivelAql`
 * siempre se eligen y el `nombre` siempre se captura, asi que los tres son obligatorios.
 */
export const esquemaAuditorFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(120, { error: 'El nombre no puede tener más de 120 caracteres' }),
  rol: z.enum(ROLES_AUDITOR, { error: 'El rol debe ser Auditor o Sr. Auditor' }),
  nivelAql: z.enum(NIVELES_AQL_AUDITOR, { error: 'El nivel AQL debe ser 1.0, 1.5, 2.5 o 4.0' }),
});

/** Datos del formulario de auditor. */
export type DatosAuditorFormulario = z.infer<typeof esquemaAuditorFormulario>;

// ── Proveedores (espejo de `esquemaProveedorCrear`/`Editar` del backend) ──────

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
    /**
     * Campo CORTO del proveedor — el único (V1-E3f pieza B). Sirve de nombre corto de display
     * ("Bloom" para BLOOM TEXTIL) y de clave corta del taller. Es ÚNICO: la unicidad la valida el
     * servidor (A1) y su choque llega como conflicto, no se adivina aquí.
     */
    nombreCorto: z
      .string()
      .trim()
      .max(50, { error: 'El campo corto no puede tener más de 50 caracteres' }),
    razonSocial: z
      .string()
      .trim()
      .max(200, { error: 'La razón social no puede tener más de 200 caracteres' }),
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
    // ── Datos de taller (fusión de terceros, D12/R15) ────────────────────────────
    // Atributos del antiguo Maquilero, portados al Proveedor. Su clave corta se fusionó con
    // `nombreCorto` (arriba) en V1-E3f pieza B. `asegurado` SOLO se muestra si el proveedor tiene
    // algún rol de servicio (§Post-F9.56 punto 7: *"«Está asegurado» solo aplica a maquila"*).
    asegurado: z.boolean(),
    obsPago: z
      .string()
      .trim()
      .max(2000, { error: 'Las observaciones de pago no pueden tener más de 2000 caracteres' }),
  })
  .refine(
    // Regla de captura R15 (espejo del backend): si emite CFDI, exige RFC + régimen.
    (datos) => !datos.factura || (datos.rfc !== '' && datos.regimenFiscalSat !== ''),
    { error: 'Si el proveedor factura, captura su RFC y su régimen fiscal', path: ['rfc'] },
  );

/** Datos del formulario de proveedor. */
export type DatosProveedorFormulario = z.infer<typeof esquemaProveedorFormulario>;

// NOTA (fusion de terceros, D12/R15): el formulario de Cortador se elimino; el cortador es
// un Proveedor con el rol `corte` (usa el formulario de proveedor).

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

// ── Direcciones de entrega (§Post-F9.18, espejo de `esquemaDireccionEntregaCrear`) ───────

/**
 * Captura del formulario de DIRECCION DE ENTREGA. Nombre corto (con el que se elige en la OC) +
 * la direccion completa tal como debe salir impresa. `favorita` marca la de todos los dias: es la
 * que la captura de la OC preselecciona.
 */
export const esquemaDireccionEntregaFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  direccion: z
    .string({ error: 'La dirección es obligatoria' })
    .trim()
    .min(1, { error: 'La dirección es obligatoria' })
    .max(1000, { error: 'La dirección no puede tener más de 1000 caracteres' }),
  contacto: z
    .string()
    .trim()
    .max(200, { error: 'El contacto no puede tener más de 200 caracteres' }),
  telefono: z.string().trim().max(50, { error: 'El teléfono no puede tener más de 50 caracteres' }),
  favorita: z.boolean(),
});

/** Datos del formulario de direccion de entrega. */
export type DatosDireccionEntregaFormulario = z.infer<typeof esquemaDireccionEntregaFormulario>;

// ── Color de una TELA (V1-E6b, §Post-F9.106 — espejo de `esquemaTelaColorAgregar`) ───────

/**
 * Captura del alta de UN color de tela desde la compra (§Post-F9.106). El nombre es LIBRE (el del
 * proveedor: "Marino Alsa 3040") y es lo unico obligatorio.
 *
 * 🔴 **Los precios NO se obligan, a proposito.** El comprador esta dando de alta el color justo
 * porque acaba de hacer falta: exigirle un precio que todavia no tiene seria volver a cerrarle la
 * puerta —lo mismo que llevamos dias quitando— y ademas ese precio es INFORMATIVO (el costo real
 * va por lote). Se piden porque si los sabe, capturarlos aqui le ahorra el viaje al catalogo.
 */
export const esquemaColorDeTelaFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre del color es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre del color es obligatorio' })
    .max(80, { error: 'El nombre del color no puede tener más de 80 caracteres' }),
  pantone: z.string().trim().max(50, { error: 'El pantone no puede tener más de 50 caracteres' }),
  precio: numeroOpcional({
    min: 0,
    mensajeNoNumero: 'El precio debe ser un número',
    mensajeMin: 'El precio no puede ser negativo',
  }).describe('Precio por unidad de consumo (vacío = todavía no se sabe).'),
  precioComplemento: numeroOpcional({
    min: 0,
    mensajeNoNumero: 'El precio del complemento debe ser un número',
    mensajeMin: 'El precio del complemento no puede ser negativo',
  }).describe('Precio del complemento (Cardigan) en ese color (vacío = no se sabe / no lleva).'),
});

/** Datos del formulario de alta de un color de tela. */
export type DatosColorDeTelaFormulario = z.infer<typeof esquemaColorDeTelaFormulario>;

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
 * es obligatoria.
 *
 * ⭐ V1-E3r (§Post-F9.81) — el `orden` es opcional y arranca en **1**, no en 0: dejarlo VACÍO hace
 * que el servidor lo DEDUZCA de la etiqueta (CH antes que M antes que G), y el 0 quedó como
 * sentinela puro ("nadie le puso orden"). Espejo exacto de `esquemaTallaCrear`; el backend
 * re-valida y es la autoridad (A1).
 */
export const esquemaTallaFormulario = z.object({
  etiqueta: z
    .string({ error: 'La etiqueta es obligatoria' })
    .trim()
    .min(1, { error: 'La etiqueta es obligatoria' })
    .max(50, { error: 'La etiqueta no puede tener más de 50 caracteres' }),
  orden: numeroOpcional({
    min: 1,
    mensajeNoNumero: 'El orden debe ser un número',
    mensajeMin: 'El orden debe ser 1 o más (déjalo vacío para que se deduzca de la etiqueta)',
  }).describe('Orden de despliegue (vacío = lo deduce el servidor de la etiqueta).'),
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
 * `nombre` es obligatorio; razon social, RFC e identificador son opcionales. Las
 * banderas (favorita, paraIpt, paraEdr) se capturan como checkbox y no van en este
 * schema de texto. El RFC (F9-E3) valida su forma en el backend (A1); aquí solo el largo.
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
  rfc: z
    .string()
    .trim()
    .toUpperCase()
    .max(13, { error: 'El RFC no puede tener más de 13 caracteres' }),
  identificador: z
    .string()
    .trim()
    .max(50, { error: 'El identificador no puede tener más de 50 caracteres' }),
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
  agingLimite1: numeroOpcional({
    min: 1,
    mensajeNoNumero: 'El primer límite de antigüedad debe ser un número',
    mensajeMin: 'El primer límite debe ser de al menos 1 día',
  }).describe('Fin de la 1ª cubeta de antigüedad de saldos, en días (F9-E5/D15d).'),
  agingLimite2: numeroOpcional({
    min: 1,
    mensajeNoNumero: 'El segundo límite de antigüedad debe ser un número',
    mensajeMin: 'El segundo límite debe ser de al menos 1 día',
  }).describe('Fin de la 2ª cubeta de antigüedad de saldos, en días (F9-E5/D15d).'),
  pctDesvioCompra: numeroOpcional({
    min: 1,
    mensajeNoNumero: 'El aviso de desvío debe ser un número',
    mensajeMin: 'El aviso de desvío debe ser de al menos 1 %',
  }).describe(
    '⭐⭐ V1-E3u (§Post-F9.89(a)): % de diferencia entre lo calculado y lo pedido a partir del cual ' +
      'se avisa a quien autoriza la OC. Sólo avisa; nunca bloquea.',
  ),

  costoEmpaqueBase: numeroOpcional({
    min: 0,
    mensajeNoNumero: 'El costo de empaque debe ser un número',
    mensajeMin: 'El costo de empaque no puede ser negativo',
  }).describe(
    '⭐ V1-E8w (§Post-F9.153): costo de empaque por prenda con el que nacen los precostos nuevos.',
  ),
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

// NOTA (fusion de terceros, D12/R15): el formulario de Maquilero se elimino; un maquilero
// es un Proveedor con sus roles de servicio (usa el formulario de proveedor).

// ── Tipos de proceso de maquila (espejo de `esquemaTipoProcesoCrear`/`Editar`) ─

/**
 * Captura del formulario de tipo de proceso (F3-E1; alta y edicion comparten forma).
 * `generaEntradaPt` (decision (e)): solo un admin puede tocarla — la pantalla DESHABILITA el
 * control para no-admin y el backend descarta cualquier valor que venga sin permiso.
 */
export const esquemaTipoProcesoFormulario = z.object({
  codigo: z
    .string({ error: 'El código es obligatorio' })
    .trim()
    .min(1, { error: 'El código es obligatorio' })
    .max(50, { error: 'El código no puede tener más de 50 caracteres' })
    .regex(/^[a-z][a-z0-9-]*$/, {
      error: 'Usa minúsculas, dígitos y guiones (ej. "costura")',
    }),
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  generaEntradaPt: z.boolean(),
  /** V1-E3f (§Post-F9.58): ¿se ofrece como TIPO DE ARTE? (catálogo único). */
  esArte: z.boolean(),
  /** V1-E3f (§Post-F9.52 punto 6): ¿su arte lleva puntadas? (solo bordado en el seed). */
  usaPuntadas: z.boolean(),
});

/** Datos del formulario de tipo de proceso. */
export type DatosTipoProcesoFormulario = z.infer<typeof esquemaTipoProcesoFormulario>;

// ── Ruta Crítica: procesos (espejo de `esquemaProcesoCrear`/`Editar` del backend, F5-E1) ──

/** Condiciones de aplicabilidad (espejo del backend). */
export const CONDICIONES_APLICABILIDAD = ['ninguna', 'soloSiLlevaAplicacion'] as const;
/** Clave de condición de aplicabilidad. */
export type CondicionAplicabilidadClave = (typeof CONDICIONES_APLICABILIDAD)[number];
/** Etiquetas para UI de cada condición. */
export const ETIQUETAS_CONDICION_APLICABILIDAD: Record<CondicionAplicabilidadClave, string> = {
  ninguna: 'Siempre aplica',
  soloSiLlevaAplicacion: 'Solo si la orden lleva arte (aplicación/estampado)',
};

/** Tipos de evento de proceso (espejo del backend). */
export const TIPOS_EVENTO_PROCESO = [
  'recepcionTela',
  'corte',
  'envioCostura',
  'reciboCostura',
  'envioEstampado',
  'reciboEstampado',
  'auditoria',
  'autorizacionArte',
  'entregaCliente',
  'manual',
  // Bloque nuevo (cierre del hueco de emisores, post-F9): eventos que v2 ya emite.
  'revisionOp',
  'autorizacionFit',
  'autorizacionTono',
  'autorizacionAvios',
  'compraTela',
  'surtidoAvios',
  'auditoriaCorte',
  'empaque',
] as const;
/** Clave de tipo de evento. */
export type TipoEventoProcesoClave = (typeof TIPOS_EVENTO_PROCESO)[number];
/** Etiquetas para UI de cada tipo de evento. */
export const ETIQUETAS_TIPO_EVENTO_PROCESO: Record<TipoEventoProcesoClave, string> = {
  recepcionTela: 'Recepción de tela',
  corte: 'Corte',
  envioCostura: 'Envío a costura',
  reciboCostura: 'Recibo de costura',
  envioEstampado: 'Envío a arte',
  reciboEstampado: 'Recibo de arte',
  auditoria: 'Auditoría de calidad',
  autorizacionArte: 'Autorización de arte',
  entregaCliente: 'Entrega a cliente',
  manual: 'Manual (sin evento del sistema)',
  revisionOp: 'Revisión de la orden',
  autorizacionFit: 'Autorización de fit',
  autorizacionTono: 'Autorización de tono de tela',
  autorizacionAvios: 'Autorización de avíos',
  compraTela: 'Orden de compra de tela',
  surtidoAvios: 'Surtido de avíos',
  auditoriaCorte: 'Auditoría de corte',
  empaque: 'Empaque',
};

/** Tipos de duración de proceso (espejo del backend). */
export const TIPOS_DURACION_PROCESO = [
  'fija',
  'porCantidad',
  'porTipoTela',
  'porAplicacion',
  'porDificultad',
] as const;
/** Clave de tipo de duración. */
export type TipoDuracionProcesoClave = (typeof TIPOS_DURACION_PROCESO)[number];
/** Etiquetas para UI de cada tipo de duración. */
export const ETIQUETAS_TIPO_DURACION_PROCESO: Record<TipoDuracionProcesoClave, string> = {
  fija: 'Duración fija (días)',
  porCantidad: 'Escala con la cantidad de piezas',
  porTipoTela: 'Según el tipo de tela',
  porAplicacion: 'Según la aplicación',
  porDificultad: 'Por dificultad (# de operaciones del modelo)',
};

/**
 * Captura del formulario de proceso de la RC (alta y edición comparten forma). Roles, dependencias
 * y checklist se gestionan por sus propios sub-recursos (no van en este schema de texto/banderas).
 * Validación SOLO de UX: el backend re-valida y es la autoridad (A1).
 */
export const esquemaProcesoRcFormulario = z.object({
  codigo: z
    .string({ error: 'El código es obligatorio' })
    .trim()
    .min(1, { error: 'El código es obligatorio' })
    .max(50, { error: 'El código no puede tener más de 50 caracteres' })
    .regex(/^[a-z][a-z0-9-]*$/, {
      error: 'Usa minúsculas, dígitos y guiones (ej. "corte")',
    }),
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(200, { error: 'El nombre no puede tener más de 200 caracteres' }),
  critico: z.boolean(),
  ultimoProceso: z.boolean(),
  esResurtido: z.boolean(),
  condicionAplicabilidad: z.enum(CONDICIONES_APLICABILIDAD),
  tipoEvento: z.enum(TIPOS_EVENTO_PROCESO),
  tipoDuracion: z.enum(TIPOS_DURACION_PROCESO),
});

/** Datos del formulario de proceso de la RC. */
export type DatosProcesoRcFormulario = z.infer<typeof esquemaProcesoRcFormulario>;

// ── Calidad: defectos, tipos de producto y planes AQL (F6-E1) ─────────────────

/** Severidades de defecto (espejo del backend). */
export const SEVERIDADES_DEFECTO = ['critico', 'mayor', 'menor'] as const;
/** Clave de severidad de defecto. */
export type SeveridadDefectoClave = (typeof SEVERIDADES_DEFECTO)[number];
/** Etiquetas para UI de cada severidad. */
export const ETIQUETAS_SEVERIDAD_DEFECTO: Record<SeveridadDefectoClave, string> = {
  critico: 'Crítico',
  mayor: 'Mayor',
  menor: 'Menor',
};

/** Niveles AQL disponibles (espejo del backend). */
export const NIVELES_AQL = [1, 2.5, 10] as const;
/** Clave de nivel AQL. */
export type NivelAqlClave = (typeof NIVELES_AQL)[number];

// ── Calidad: auditorías (F6-E2, espejo del backend) ───────────────────────────

/** Resultados de una auditoría (el veredicto lo decide el auditor a mano). */
export const RESULTADOS_AUDITORIA = ['aprobado', 'reprobado', 'no_calificado'] as const;
/** Clave de resultado de auditoría. */
export type ResultadoAuditoriaClave = (typeof RESULTADOS_AUDITORIA)[number];
/** Etiquetas para UI de cada resultado. */
export const ETIQUETAS_RESULTADO_AUDITORIA: Record<ResultadoAuditoriaClave, string> = {
  aprobado: 'Aprobada',
  reprobado: 'Reprobada',
  no_calificado: 'Sin calificar',
};

/** Tipos de auditoría (en piso / final / de corte / sin definir). */
export const TIPOS_AUDITORIA = ['en_piso', 'final', 'no_definida', 'corte'] as const;
/** Clave de tipo de auditoría. */
export type TipoAuditoriaClave = (typeof TIPOS_AUDITORIA)[number];
/** Etiquetas para UI de cada tipo. */
export const ETIQUETAS_TIPO_AUDITORIA: Record<TipoAuditoriaClave, string> = {
  en_piso: 'En piso',
  final: 'Final',
  no_definida: 'Sin definir',
  corte: 'De corte',
};

/** Etiquetas de la accion de bitacora (espejo del backend, A7). */
export const ETIQUETAS_ACCION_BITACORA: Record<string, string> = {
  CREAR: 'Creó',
  MODIFICAR: 'Modificó',
  DESACTIVAR: 'Desactivó',
  CANCELAR: 'Canceló',
  OTRO: 'Otro',
};

/**
 * Captura del formulario de defecto (alta y edicion comparten forma). Los campos
 * obligatorios son `clave`, `descripcion`, `nivelAQL`, `severidad` y `aplicaGeneral`;
 * el resto son opcionales. Los `tiposProducto` (ids) se capturan como array de
 * numeros aparte (el backend los requiere cuando `aplicaGeneral` es `false`).
 * Validacion solo de UX: el servidor re-valida y es la autoridad (A1).
 */
export const esquemaDefectoFormulario = z.object({
  clave: z
    .string({ error: 'La clave es obligatoria' })
    .trim()
    .min(1, { error: 'La clave es obligatoria' })
    .max(50, { error: 'La clave no puede tener más de 50 caracteres' }),
  descripcion: z
    .string({ error: 'La descripción es obligatoria' })
    .trim()
    .min(1, { error: 'La descripción es obligatoria' })
    .max(500, { error: 'La descripción no puede tener más de 500 caracteres' }),
  pag: z
    .string()
    .trim()
    .max(50, { error: 'La página/referencia no puede tener más de 50 caracteres' }),
  nivelAQL: z.enum(['1', '2.5', '10'], {
    error: 'El nivel AQL debe ser 1, 2.5 o 10',
  }),
  favorito: z.boolean(),
  categoria: z
    .string()
    .trim()
    .max(100, { error: 'La categoría no puede tener más de 100 caracteres' }),
  severidad: z.enum(SEVERIDADES_DEFECTO, {
    error: 'La severidad debe ser crítico, mayor o menor',
  }),
  aplicaGeneral: z.boolean(),
  tiposProducto: z.array(z.number()),
});

/** Datos del formulario de defecto. */
export type DatosDefectoFormulario = z.infer<typeof esquemaDefectoFormulario>;

/**
 * Captura del formulario de tipo de producto (solo el nombre). Simple CRUD.
 * Validacion solo de UX: el backend re-valida y es la autoridad (A1).
 */
export const esquemaTipoProductoFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(100, { error: 'El nombre no puede tener más de 100 caracteres' }),
  // Dígito de CONCEPTO (§Post-F9.34, V1-E3n): el 1º del código de producción. Se captura como
  // texto y vacío = sin dígito (el tipo existe igual, pero sus modelos no se pueden numerar).
  // El 0 y el 1 NO se usan — Daniel: *"el 1 no es nada"*.
  digitoConcepto: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[2-9]$/.test(v), {
      error: 'El dígito va del 2 al 9 (el 0 y el 1 no se usan)',
    }),
});

/** Datos del formulario de tipo de producto. */
export type DatosTipoProductoFormulario = z.infer<typeof esquemaTipoProductoFormulario>;

/**
 * Captura de un limite de un renglon de plan AQL (nivel AQL + Ac + Re).
 * Cada renglon puede tener 1-N limites (uno por nivel AQL).
 */
export const esquemaLimiteAqlFormulario = z.object({
  nivelAQL: z.enum(['1', '2.5', '10'], { error: 'El nivel AQL debe ser 1, 2.5 o 10' }),
  aceptar: z
    .string({ error: 'El número de aceptación es obligatorio' })
    .refine((v) => v.trim() !== '' && Number.isInteger(Number(v)) && Number(v) >= 0, {
      error: 'El Ac debe ser un entero ≥ 0',
    }),
  rechazar: z
    .string({ error: 'El número de rechazo es obligatorio' })
    .refine((v) => v.trim() !== '' && Number.isInteger(Number(v)) && Number(v) >= 1, {
      error: 'El Re debe ser un entero ≥ 1',
    }),
});

/** Datos de un limite de renglon AQL en el formulario. */
export type DatosLimiteAqlFormulario = z.infer<typeof esquemaLimiteAqlFormulario>;

/**
 * Captura de un renglon del plan AQL (rango de lote + tamano de muestra + limites).
 * `loteMin` es obligatorio; `loteMax` es opcional (nulo = sin tope, el ultimo renglon).
 * Los limites son un array con al menos un elemento (uno por nivel AQL).
 * Validacion solo de UX (A1).
 */
export const esquemaRenglonAqlFormulario = z.object({
  loteMin: z
    .string({ error: 'El lote mínimo es obligatorio' })
    .refine((v) => v.trim() !== '' && Number.isInteger(Number(v)) && Number(v) >= 1, {
      error: 'El lote mínimo debe ser un entero ≥ 1',
    }),
  loteMax: z.string(),
  tamanoMuestra: z
    .string({ error: 'El tamaño de muestra es obligatorio' })
    .refine((v) => v.trim() !== '' && Number.isInteger(Number(v)) && Number(v) >= 1, {
      error: 'El tamaño de muestra debe ser un entero ≥ 1',
    }),
  limites: z.array(esquemaLimiteAqlFormulario),
});

/** Datos de un renglon del plan AQL en el formulario. */
export type DatosRenglonAqlFormulario = z.infer<typeof esquemaRenglonAqlFormulario>;

/**
 * Captura del formulario de plan AQL (alta y edicion comparten forma). Solo el
 * `nombre` va en el schema de texto; los `renglones` se gestionan con
 * `useFieldArray` y tienen su propio schema. Validacion solo de UX (A1).
 */
export const esquemaPlanAqlFormulario = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre es obligatorio' })
    .max(200, { error: 'El nombre no puede tener más de 200 caracteres' }),
  renglones: z.array(esquemaRenglonAqlFormulario),
});

/** Datos del formulario de plan AQL. */
export type DatosPlanAqlFormulario = z.infer<typeof esquemaPlanAqlFormulario>;
