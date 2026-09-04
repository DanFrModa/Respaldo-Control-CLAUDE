import { z } from 'zod';

import { MODALIDADES_FACTURACION } from './esma.js';
import { esClabeValida, esRfcValido, METODOS_PAGO, MONEDAS } from './fiscal.js';

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
/**
 * Cómo sale físicamente el dinero en la corrida semanal (0.113). Espejo del enum Prisma
 * `FormaDePago`; se declara aquí —ARRIBA DEL TODO, antes de su primer uso— y no se importa de
 * `concepto-pago.ts`: ese módulo importa de éste, y el ciclo dejaría uno de los dos sin
 * inicializar (con la declaración más abajo el generador de OpenAPI truena con «Cannot access
 * FORMAS_DE_PAGO_PROVEEDOR before initialization»: zona muerta temporal). `concepto-pago.ts` re-exporta la
 * MISMA constante bajo `FORMAS_DE_PAGO`, así que la lista sigue siendo una sola.
 */
export const FORMAS_DE_PAGO_PROVEEDOR = ['efectivo', 'transferencia'] as const;

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
  /**
   * ⭐ EFECTIVO o TRANSFERENCIA por omisión, para la corrida semanal (0.113; §Post-F9.189(c)):
   * *«podemos dejarlo como default de cada proveedor, pero con opción a cambiarlo — de pronto un
   * maquilero me pide que le pague una semana en efectivo»*. Cada renglón de la corrida lo puede
   * cambiar; esto es sólo la sugerencia.
   *
   * ⚠️ NO confundir con `formaPago` (de arriba), que es TEXTO LIBRE con la clave del SAT para el
   * CFDI ("03 — Transferencia") y quedó SUPERADO: ya no se captura en pantalla.
   */
  formaPagoPreferida: z
    .enum(FORMAS_DE_PAGO_PROVEEDOR, {
      error: 'La forma de pago debe ser efectivo o transferencia',
    })
    .nullable()
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
  // opcionales. Su clave corta (`corto`) vive hoy en `nombreCorto` (V1-E3f pieza B).
  asegurado: z.boolean({ error: '¿Asegurado? debe ser verdadero o falso' }).optional(),
  obsPago: z
    .string()
    .trim()
    .max(2000, { error: 'Las observaciones de pago no pueden tener más de 2000 caracteres' })
    .optional(),

  // ── Facturación (F6-E4/E5 decisión (h); general del proveedor desde §Post-F9.57) ─
  /**
   * Modalidad de facturación del proveedor (solo_con/solo_sin/ambos).
   *
   * ⚠️ Aquí es `.optional()` porque este bloque lo comparten el ALTA, la EDICIÓN y la MIGRACIÓN, y
   * cada una lo trata distinto. En el ALTA es **OBLIGATORIA** (fila 0.110): la sobrescribe
   * {@link esquemaProveedorCrear}. Ver ahí el porqué.
   */
  modalidadFacturacion: z
    .enum(MODALIDADES_FACTURACION, { error: 'La modalidad de facturación no es válida' })
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
  // Fusión de terceros (D12/R15): `obsPago` se puede VACIAR (M1); `asegurado`
  // es bandera (omitir = no tocar), no se hace nullable (igual que `factura`).
  obsPago: camposEnriquecidos.obsPago.nullable(),
  // ⭐ Modalidad de facturación: **NO es nullable** (fila 0.110). Omitir = no tocar (así siguen
  // funcionando los PATCH parciales: desactivar/reactivar un proveedor, o la fusión de roles del
  // ETL). Pero mandar `null` —vaciarla— se RECHAZA: es el único campo del formulario que no se
  // puede dejar sin definir, porque decide de dónde sale el pago del proveedor (§Post-F9.186(a)).
  // Efecto en la pantalla: abrir y GUARDAR la ficha de un proveedor migrado obliga a elegirla.
  modalidadFacturacion: camposEnriquecidos.modalidadFacturacion,
} as const;

// ── CONTACTOS del proveedor (V1-E3f pieza B, §Post-F9.56 punto 1 / §Post-F9.57 punto 1) ──────────
//
// Daniel: *"A veces es importante ir registrando al vendedor, a la de crédito y cobranza, al
// encargado del taller, a la supervisora…"* y, cerrando la pregunta del puesto: *"sí un catálogo de
// contactos, pero deja el campo abierto qué rol tiene cada persona"*. Por eso el PUESTO es TEXTO
// LIBRE — no hay enum ni catálogo que validar.

/** Campos comunes del contacto (mismas reglas en alta y edición). */
const camposContacto = {
  nombre: z
    .string({ error: 'El nombre del contacto es obligatorio' })
    .trim()
    .min(1, { error: 'El nombre del contacto es obligatorio' })
    .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
  /** Qué hace la persona, en TEXTO LIBRE (vendedor, crédito y cobranza, encargado del taller…). */
  puesto: z
    .string()
    .trim()
    .max(100, { error: 'El puesto no puede tener más de 100 caracteres' })
    .optional(),
  telefono: z
    .string()
    .trim()
    .max(100, { error: 'El teléfono no puede tener más de 100 caracteres' })
    .optional(),
  email: z
    .email({ error: 'El email del contacto no es válido' })
    .max(200, { error: 'El email no puede tener más de 200 caracteres' })
    .optional(),
  notas: z
    .string()
    .trim()
    .max(1000, { error: 'Las notas no pueden tener más de 1000 caracteres' })
    .optional(),
} as const;

/** Alta de un contacto (el proveedor va en la URL, no en el cuerpo). */
export const esquemaProveedorContactoCrear = z
  .object(camposContacto)
  .describe('Alta de un contacto del proveedor (puesto en texto libre).');

/** Datos validados del alta de un contacto. */
export type DatosProveedorContactoCrear = z.infer<typeof esquemaProveedorContactoCrear>;

/**
 * Edición PARCIAL de un contacto: omitir = no tocar; `null`/'' = borrar el dato. El `nombre` no
 * es nullable (un contacto sin nombre no sirve), pero sí opcional (se puede editar solo el puesto).
 */
export const esquemaProveedorContactoEditarCuerpo = z
  .object({
    nombre: camposContacto.nombre.optional(),
    puesto: camposContacto.puesto.nullable(),
    telefono: camposContacto.telefono.nullable(),
    email: camposContacto.email.nullable(),
    notas: camposContacto.notas.nullable(),
    /** Borrado SUAVE (D3): `false` archiva el contacto, `true` lo revive. */
    activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
  })
  .describe('Edición parcial de un contacto del proveedor.');

/** Datos validados de la edición de un contacto. */
export type DatosProveedorContactoEditarCuerpo = z.infer<
  typeof esquemaProveedorContactoEditarCuerpo
>;

/** Forma de un contacto tal como lo devuelve la API. */
export const esquemaProveedorContactoSalida = z
  .object({
    id: z.number().int().describe('Id del contacto.'),
    idProveedor: z.number().int().describe('Id del proveedor dueño del contacto.'),
    nombre: z.string().describe('Nombre de la persona.'),
    puesto: z.string().nullable().describe('Qué hace (texto libre), o null.'),
    telefono: z.string().nullable().describe('Teléfono, o null.'),
    email: z.string().nullable().describe('Email, o null.'),
    notas: z.string().nullable().describe('Notas, o null.'),
    activo: z.boolean().describe('Falso si está archivado (borrado suave).'),
  })
  .describe('Contacto de un proveedor.');

/** Contacto de proveedor tal como sale de la API. */
export type ProveedorContactoSalida = z.infer<typeof esquemaProveedorContactoSalida>;

// ── CUENTAS / DESTINOS DE PAGO del proveedor (0.112) ─────────────────────────────────────────────
//
// 🔴 Salió de LEER el Excel con el que Daniel paga cada semana (~150 beneficiarios), no de una
// entrevista. Dos hallazgos, y ninguno cabía en `Proveedor.banco` + `Proveedor.clabe`:
// 🔒 Los nombres son INVENTADOS: los reales son personas físicas y el repo es PÚBLICO (fila 0.123).
//   1. El BENEFICIARIO casi nunca es el proveedor («TALLER NORTE 1» se deposita a otra persona).
//   2. «TALLER NORTE 1 / 2 / 3» no son tres proveedores: es UNO con TRES cuentas, partido en tres
//      renglones porque Excel no sabe modelar otra cosa.
// Daniel: *«Estaría bien poder tener más de una cuenta, definir una como default, pero tener las
// demás como historial de cuentas, para poder reutilizarlas.»* Y: *«Tendría una cuenta Fiscal, y
// podría tener más de una cuenta no fiscal.»*

/** Cómo se identifica el destino del depósito. Espejo del enum Prisma `TipoCuentaPago`. */
export const TIPOS_CUENTA_PAGO = ['clabe', 'tarjeta'] as const;
/** Clave de tipo de cuenta de pago. */
export type TipoCuentaPagoClave = (typeof TIPOS_CUENTA_PAGO)[number];

/** Etiquetas para UI de cada tipo de cuenta. */
export const ETIQUETAS_TIPO_CUENTA_PAGO: Record<TipoCuentaPagoClave, string> = {
  clabe: 'CLABE interbancaria',
  tarjeta: 'Tarjeta de débito',
};

/** Dígitos de una CLABE (Banxico): 17 + dígito de control. */
const LARGO_CLABE = 18;
/** Rango de dígitos de un número de tarjeta (PAN): 15 (Amex) a 19. */
const LARGO_TARJETA_MIN = 15;
const LARGO_TARJETA_MAX = 19;

/**
 * Deja SÓLO los dígitos de un número de cuenta capturado a mano o pegado del banco (que llega con
 * espacios, guiones o puntos). Es lo que se guarda: así la unicidad por proveedor compara peras con
 * peras y no deja pasar la misma cuenta escrita de dos maneras.
 */
export function normalizarNumeroDeCuenta(cuenta: string): string {
  return cuenta.replace(/\D/g, '');
}

/**
 * ¿Qué tiene de malo este número para el tipo declarado? Devuelve el mensaje en español, o `null`
 * si está bien. Función PURA y COMPARTIDA a propósito: la usa el Zod del alta (donde el par llega
 * completo) y la usa el DOMINIO al editar (donde el tipo puede venir de la base y el número del
 * cuerpo, o al revés) — una sola regla, dos lugares que la aplican.
 *
 * ⚠️ **Tiene un ESPEJO en el front**, `frontend/src/modulos/proveedores/cuentas-pago.ts` (mismo
 * criterio que `esClabeValida`, que ya vivía duplicado): el aviso al capturar tiene que decir lo
 * mismo que contesta el servidor. **Si cambian estas reglas o los largos, cámbialos también allá.**
 *
 * La CLABE se valida ENTERA (18 dígitos + dígito de control de Banxico), igual que el campo viejo:
 * una CLABE con el control mal es un error de dedo garantizado. La TARJETA sólo se valida por
 * longitud (15–19 dígitos) y NO por Luhn: rebotar la captura de Daniel el día que esté cargando sus
 * ~150 beneficiarios cuesta más que dejar pasar un dígito cambiado, que el banco rechaza igual.
 */
export function motivoCuentaInvalida(tipo: TipoCuentaPagoClave, cuenta: string): string | null {
  const digitos = normalizarNumeroDeCuenta(cuenta);
  if (digitos === '') {
    return 'Escribe el número de la cuenta.';
  }
  if (tipo === 'clabe') {
    if (digitos.length !== LARGO_CLABE) {
      return `La CLABE debe tener ${LARGO_CLABE} dígitos (llevas ${digitos.length}).`;
    }
    return esClabeValida(digitos)
      ? null
      : 'La CLABE no es válida: su dígito de control no cuadra. Revisa el número.';
  }
  if (digitos.length < LARGO_TARJETA_MIN || digitos.length > LARGO_TARJETA_MAX) {
    return `El número de tarjeta debe tener entre ${LARGO_TARJETA_MIN} y ${LARGO_TARJETA_MAX} dígitos (llevas ${digitos.length}).`;
  }
  return null;
}

/**
 * Campos comunes de una cuenta de pago (mismas reglas en alta y edición).
 *
 * ⭐ **Se EXPORTA porque hay dos tablas de cuentas con la misma forma**: la del proveedor (0.112) y
 * la del concepto de pago que no es proveedor (`concepto-pago.ts`, 0.125). Las reglas de captura son
 * las mismas y se escriben UNA vez; el que difiere es el dueño, que va en la URL.
 */
export const camposCuentaPago = {
  /**
   * ⭐ A NOMBRE DE QUIÉN está la cuenta. Obligatorio, y **casi nunca es el proveedor**: por eso no
   * se deriva de él ni se deja vacío "porque se entiende".
   */
  beneficiario: z
    .string({ error: 'El beneficiario es obligatorio' })
    .trim()
    .min(1, { error: 'Escribe a nombre de quién está la cuenta' })
    .max(150, { error: 'El beneficiario no puede tener más de 150 caracteres' }),
  /** Banco del destino ("BBVA", "Banorte"…). Texto libre: no hay catálogo de bancos. */
  banco: z
    .string()
    .trim()
    .max(100, { error: 'El banco no puede tener más de 100 caracteres' })
    .optional(),
  tipoCuenta: z.enum(TIPOS_CUENTA_PAGO, { error: 'El tipo de cuenta debe ser CLABE o tarjeta' }),
  /** El número tal como se captura (con o sin espacios); se guarda sólo con dígitos. */
  cuenta: z
    .string({ error: 'El número de cuenta es obligatorio' })
    .trim()
    .min(1, { error: 'Escribe el número de la cuenta' })
    .max(40, { error: 'El número de cuenta no puede tener más de 40 caracteres' }),
  /** Cómo la llama Daniel en su relación: su «1», «2», «3»… o "la de la esposa". */
  alias: z
    .string()
    .trim()
    .max(60, { error: 'El alias no puede tener más de 60 caracteres' })
    .optional(),
  /** ⭐ ¿Es la cuenta FISCAL? A ella puede salir un pago CON factura. */
  esFiscal: z.boolean({ error: '¿Es cuenta fiscal? debe ser verdadero o falso' }).optional(),
  notas: z
    .string()
    .trim()
    .max(1000, { error: 'Las notas no pueden tener más de 1000 caracteres' })
    .optional(),
} as const;

/**
 * Alta de una cuenta de pago (el proveedor va en la URL, no en el cuerpo).
 *
 * `esDefault` NO se pide en el alta: la PRIMERA cuenta del proveedor queda default sola (el dominio
 * lo decide) y las demás se promueven después con el PATCH. Así el alta nunca compite por la marca.
 */
export const esquemaProveedorCuentaPagoCrear = z
  .object(camposCuentaPago)
  .superRefine((datos, ctx) => {
    const motivo = motivoCuentaInvalida(datos.tipoCuenta, datos.cuenta);
    if (motivo !== null) {
      ctx.addIssue({ code: 'custom', message: motivo, path: ['cuenta'] });
    }
  })
  .describe('Alta de una cuenta/destino de pago del proveedor.');

/** Datos validados del alta de una cuenta de pago. */
export type DatosProveedorCuentaPagoCrear = z.infer<typeof esquemaProveedorCuentaPagoCrear>;

/**
 * Edición PARCIAL de una cuenta: omitir = no tocar; `null`/'' = borrar el dato opcional.
 *
 * El par (tipo, número) NO se puede validar aquí cuando sólo viene uno de los dos: el otro está en
 * la base. Esa validación la hace el DOMINIO sobre el par EFECTIVO, con la misma función pura
 * (`motivoCuentaInvalida`) — la autoridad es el servidor (A1), no este esquema.
 */
export const esquemaProveedorCuentaPagoEditarCuerpo = z
  .object({
    beneficiario: camposCuentaPago.beneficiario.optional(),
    banco: camposCuentaPago.banco.nullable(),
    tipoCuenta: camposCuentaPago.tipoCuenta.optional(),
    cuenta: camposCuentaPago.cuenta.optional(),
    alias: camposCuentaPago.alias.nullable(),
    esFiscal: camposCuentaPago.esFiscal,
    notas: camposCuentaPago.notas.nullable(),
    /**
     * ⭐ `true` la vuelve LA cuenta por omisión del proveedor (y apaga la que lo era, en la misma
     * transacción); `false` sólo le quita la marca — no promueve a nadie más.
     */
    esDefault: z
      .boolean({ error: '¿Es la cuenta por omisión? debe ser verdadero o falso' })
      .optional(),
    /** Borrado SUAVE (D3): `false` RETIRA la cuenta (queda como historial), `true` la revive. */
    activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
  })
  .describe('Edición parcial de una cuenta/destino de pago del proveedor.');

/** Datos validados de la edición de una cuenta de pago. */
export type DatosProveedorCuentaPagoEditarCuerpo = z.infer<
  typeof esquemaProveedorCuentaPagoEditarCuerpo
>;

/**
 * Forma de una cuenta de pago tal como la devuelve la API.
 *
 * ⚠️ `esDefault` sale como **boolean puro**: adentro la columna es `true`/NULL (así la base
 * garantiza una sola default por proveedor), pero eso es plomería del esquema y no tiene por qué
 * cruzar el contrato. La ruta lo proyecta con `=== true`.
 */
export const esquemaProveedorCuentaPagoSalida = z
  .object({
    id: z.number().int().describe('Id de la cuenta.'),
    idProveedor: z.number().int().describe('Id del proveedor dueño de la cuenta.'),
    beneficiario: z.string().describe('A nombre de quién está la cuenta (el del depósito).'),
    banco: z.string().nullable().describe('Banco, o null.'),
    tipoCuenta: z.enum(TIPOS_CUENTA_PAGO).describe('CLABE o tarjeta.'),
    cuenta: z.string().describe('El número, sólo dígitos.'),
    alias: z.string().nullable().describe('Cómo se le llama en la relación de pago ("1", "2"…).'),
    esFiscal: z.boolean().describe('Verdadero si a ella puede salir un pago CON factura.'),
    esDefault: z.boolean().describe('Verdadero si es LA cuenta por omisión del proveedor.'),
    notas: z.string().nullable().describe('Notas, o null.'),
    activo: z.boolean().describe('Falso si está retirada (sigue siendo historial reutilizable).'),
  })
  .describe('Cuenta/destino de pago de un proveedor.');

/** Cuenta de pago tal como sale de la API. */
export type ProveedorCuentaPagoSalida = z.infer<typeof esquemaProveedorCuentaPagoSalida>;

// ── CONSTANCIA DE SITUACIÓN FISCAL (V1-E3f pieza B, §Post-F9.55) ─────────────────────────────────
//
// Daniel: *"En proveedores me gustaría poder subir su Constancia de Situación Fiscal para darlos de
// alta. Con ese documento se llena toda la info en automático: RFC, direcciones, etc."*
//
// ⭐ El documento PROPONE, la persona CONFIRMA: este endpoint NO guarda nada. Devuelve lo que dice el
// papel y la pantalla llena los campos para que alguien los revise y acepte. Sirve igual en el ALTA
// y en la EDICIÓN. El PDF viaja en base64 (misma mecánica que el importador de OC de C&A) y se
// CONSERVA aparte como adjunto `CONSTANCIA` del proveedor: no se lee y se tira.

/** Cuerpo del análisis: el PDF de la constancia en base64. */
export const esquemaAnalizarConstanciaCuerpo = z
  .object({
    archivoBase64: z
      .string({ error: 'Falta el archivo' })
      .min(1, { error: 'Falta el archivo' })
      .describe('PDF de la Constancia de Situación Fiscal, en base64 (máx. 10 MB decodificado).'),
  })
  .describe('Constancia de Situación Fiscal a leer (no se guarda nada aquí).');

/** Datos validados del análisis de la constancia. */
export type DatosAnalizarConstanciaCuerpo = z.infer<typeof esquemaAnalizarConstanciaCuerpo>;

/** Un régimen fiscal propuesto por la constancia. */
export const esquemaRegimenPropuesto = z
  .object({
    clave: z
      .string()
      .describe(
        'Clave del catálogo c_RegimenFiscal del SAT (p. ej. "601"), o "" si no se reconoció.',
      ),
    descripcion: z.string().describe('Nombre del régimen tal como se leyó/reconoció.'),
  })
  .describe('Régimen fiscal propuesto (la persona escoge si hay más de uno).');

/** Lo que la constancia PROPONE. Ningún campo se guarda sin confirmación. */
export const esquemaAnalizarConstanciaSalida = z
  .object({
    tipoPersona: z.enum(['fisica', 'moral']).describe('fisica (trae CURP) o moral (denominación).'),
    rfc: z.string().describe('RFC leído, o "".'),
    razonSocial: z
      .string()
      .describe('Denominación (moral) o nombre + apellidos compuestos (física), o "".'),
    curp: z.string().describe('CURP (solo persona física), o "".'),
    regimenes: z
      .array(esquemaRegimenPropuesto)
      .describe('Regímenes encontrados. Con más de uno, la persona escoge.'),
    codigoPostalExpedicion: z.string().describe('CP del domicilio fiscal (5 dígitos), o "".'),
    direccion: z.string().describe('Domicilio armado con las partes que sí traen valor, o "".'),
    advertencias: z
      .array(z.string())
      .describe('Lo que no se pudo leer. NO bloquea: se captura a mano.'),
  })
  .describe('Datos que PROPONE la constancia (la persona confirma).');

/** Salida del análisis de la constancia. */
export type AnalizarConstanciaSalida = z.infer<typeof esquemaAnalizarConstanciaSalida>;

/**
 * Alta de proveedor (catálogo global F1-E1, ADR-0007: sin `idEmpresa`). El nombre
 * es la clave de negocio (único global); los demás datos son opcionales.
 *
 * F1-E1B (R15): agrega `roles` (multi-valor, ≥1 lo exige el dominio en alta), campos
 * fiscales/comerciales/operativos y la regla `factura ⇒ rfc + regimenFiscalSat`
 * (validada como regla de captura aquí; el dominio la repite, A1).
 */
const baseProveedorCrear = z
  .object({
    nombre: z
      .string({ error: 'El nombre es obligatorio' })
      .trim()
      .min(1, { error: 'El nombre es obligatorio' })
      .max(150, { error: 'El nombre no puede tener más de 150 caracteres' }),
    /**
     * Campo CORTO del proveedor — el único (V1-E3f pieza B, §Post-F9.57/.58). Sirve de nombre
     * corto de display ("Bloom" para BLOOM TEXTIL, A1.1) Y de clave corta del taller (ex `corto`).
     * ÚNICO global, sin distinguir mayúsculas: *"sí debe de ser único"* (Daniel).
     */
    nombreCorto: z
      .string()
      .trim()
      .max(50, { error: 'El campo corto no puede tener más de 50 caracteres' })
      .optional(),
    razonSocial: z
      .string()
      .trim()
      .max(200, { error: 'La razón social no puede tener más de 200 caracteres' })
      .optional(),
    telefono: z
      .string()
      .trim()
      .max(100, { error: 'El teléfono no puede tener más de 100 caracteres' })
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
  .describe('Alta de proveedor (base compartida por la captura y la migración).');

/** Regla de captura R15, compartida por las dos variantes del alta: factura ⇒ RFC + régimen. */
const reglaFacturaExigeRfcAlta = {
  regla: (datos: {
    factura?: boolean | undefined;
    rfc?: string | undefined;
    regimenFiscalSat?: string | undefined;
  }): boolean =>
    datos.factura !== true || ((datos.rfc ?? '') !== '' && (datos.regimenFiscalSat ?? '') !== ''),
  opciones: {
    error: 'Si el proveedor factura, captura su RFC y su régimen fiscal',
    path: ['rfc'] as const,
  },
} as const;

/**
 * ALTA de proveedor (captura normal). Igual que la base, pero con la **modalidad de facturación
 * OBLIGATORIA** (fila 0.110).
 *
 * ⭐ POR QUÉ ES OBLIGATORIA. Daniel (3-sep-2026, §Post-F9.186(a)): *"es un campo **obligatorio** de
 * llenar. **A fuerzas hay que definir si es con, sin o ambas**"*. La marca con/sin factura decide
 * **de dónde sale el pago** del proveedor: CON factura el pago nace del estado de cuenta del BANCO;
 * SIN factura nace de la RELACIÓN que Daniel define y que se ejecuta tal cual (§Post-F9.184(f)). Un
 * proveedor sin clasificar deja al sistema sin saber por cuál de los dos caminos meter su pago —y
 * ese pago se pierde o se duplica—, así que la pregunta se hace **al darlo de alta**, no después.
 *
 * ⚠️ REGLA 0-B: esto NO toca a los proveedores que ya existen. Los migrados siguen consultándose,
 * apareciendo en su estado de cuenta y en los reportes con la modalidad vacía; lo único que no se
 * puede es **crear uno nuevo** sin ella (ni capturarle un movimiento hasta definírsela). La
 * migración usa {@link esquemaProveedorCrearMigrado}.
 */
export const esquemaProveedorCrear = baseProveedorCrear
  .extend({
    modalidadFacturacion: z.enum(MODALIDADES_FACTURACION, {
      error:
        'Indica cómo factura este proveedor: solo con factura, solo sin factura, o de las dos formas',
    }),
  })
  .refine(reglaFacturaExigeRfcAlta.regla, {
    error: reglaFacturaExigeRfcAlta.opciones.error,
    path: [...reglaFacturaExigeRfcAlta.opciones.path],
  });

/**
 * ALTA en modo MIGRACIÓN: idéntica al alta normal salvo que la modalidad de facturación **puede
 * faltar**. Uso EXCLUSIVO del ETL (`migracion/loaders/proveedores.ts`), **jamás desde una ruta
 * REST** — el mismo patrón que `registrarMovimientoTerceroInterno` en el motor de terceros.
 *
 * Existe por la REGLA 0-B (`CLAUDE.md` §7): el sistema viejo nunca hizo esta pregunta, así que el
 * histórico llega con el dato vacío **a propósito** y eso NO es un defecto. Daniel: *"yo me encargo
 * de ponerlo bien cuando hagamos la migración de datos reales"*. Rellenarlo aquí con un valor
 * inventado sería justo lo que la regla prohíbe.
 */
export const esquemaProveedorCrearMigrado = baseProveedorCrear.refine(
  reglaFacturaExigeRfcAlta.regla,
  {
    error: reglaFacturaExigeRfcAlta.opciones.error,
    path: [...reglaFacturaExigeRfcAlta.opciones.path],
  },
);

/** Datos validados de alta de proveedor (captura normal: la modalidad viene siempre). */
export type DatosProveedorCrear = z.infer<typeof esquemaProveedorCrear>;

/** Datos validados de alta de proveedor en modo MIGRACIÓN (la modalidad puede faltar). */
export type DatosProveedorCrearMigrado = z.infer<typeof esquemaProveedorCrearMigrado>;

/**
 * Edición de proveedor: todos los campos del alta son opcionales (edición parcial)
 * más `activo` para el borrado suave (plan §4: nada se borra físicamente).
 *
 * Ningún campo lleva `.default()` aquí: en una edición parcial, omitir un campo NO debe
 * resetearlo (Zod `.partial()` NO quita los defaults, así que el omitido se rellenaría con su
 * default y pisaría el valor real en la BD). Los campos enriquecidos de E1B ya son `.optional()`
 * sin default.
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
    // nullable: es la clave de negocio y siempre tiene valor.
    /** Campo corto ÚNICO del proveedor: `null`/'' lo borra; omitir = no tocar. */
    nombreCorto: z
      .string()
      .trim()
      .max(50, { error: 'El campo corto no puede tener más de 50 caracteres' })
      .optional()
      .nullable(),
    razonSocial: z
      .string()
      .trim()
      .max(200, { error: 'La razón social no puede tener más de 200 caracteres' })
      .optional()
      .nullable(),
    telefono: z
      .string()
      .trim()
      .max(100, { error: 'El teléfono no puede tener más de 100 caracteres' })
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
    nombreCorto: z
      .string()
      .nullable()
      .describe('Campo corto ÚNICO del proveedor ("Bloom", "TCD"), o null.'),
    razonSocial: z.string().nullable().describe('Razón social, o null.'),
    telefono: z.string().nullable().describe('Teléfono, o null.'),
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
    formaPago: z
      .string()
      .nullable()
      .describe('Clave del SAT para el CFDI (SUPERADA por formaPagoPreferida), o null.'),
    formaPagoPreferida: z
      .enum(FORMAS_DE_PAGO_PROVEEDOR)
      .nullable()
      .describe('Efectivo o transferencia por omisión en la corrida semanal, o null.'),
    metodoPago: z.string().nullable().describe('Método de pago CFDI (PUE/PPD), o null.'),
    banco: z.string().nullable().describe('Banco, o null.'),
    clabe: z.string().nullable().describe('CLABE interbancaria, o null.'),
    limiteCredito: z.number().nullable().describe('Límite de crédito, o null.'),
    // ── Operativo (E1B) ─────────────────────────────────────────────────────────
    leadTimeDias: z.number().int().nullable().describe('Lead time en días, o null.'),
    notas: z.string().nullable().describe('Notas, o null.'),
    // ── Maquila/corte (fusión de terceros D12/R15) ───────────────────────────────
    asegurado: z.boolean().nullable().describe('¿Está asegurado? (talleres), o null.'),
    obsPago: z.string().nullable().describe('Observaciones de pago (talleres), o null.'),
    modalidadFacturacion: z
      .enum(MODALIDADES_FACTURACION)
      .nullable()
      .describe('Modalidad de facturación EsMa (solo_con/solo_sin/ambos), o null (sin definir).'),
    // ── Relaciones (E1B) ────────────────────────────────────────────────────────
    roles: z.array(esquemaRolProveedorEnProveedor).describe('Roles/servicios del proveedor.'),
    contactos: z
      .array(esquemaProveedorContactoSalida)
      .describe('Contactos ACTIVOS del proveedor (V1-E3f pieza B).'),
    cuentasPago: z
      .array(esquemaProveedorCuentaPagoSalida)
      .describe(
        'Cuentas de pago ACTIVAS del proveedor, la default primero (0.112). Las retiradas se piden aparte.',
      ),
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
 * El filtro por `rol` (id) es el único clasificador: `tipo` se retiró en V1-E3f pieza B
 * (§Post-F9.56 punto 3 — los roles multi-valor ya cubren lo que el tipo único no podía).
 */
export const esquemaProveedoresQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      // ⚠️ 100 es el tope REAL, el del dominio (`comun/paginacion.ts`: "nadie lee más y protege la
      // base"). El contrato decía 500 y era MENTIRA: el servicio re-valida con el esquema del
      // dominio, así que quien leía el OpenAPI y pedía 500 recibía un 400. No es un cambio de
      // conducta —hoy ya fallaba—: es dejar de prometer lo que nunca se cumplió. Que los dos lados
      // sigan de acuerdo lo vigila `paginacion-honesta.test.ts`.
      .max(100)
      .default(20)
      .describe('Renglones por página (máx 100).'),
    busqueda: z
      .string()
      .trim()
      .max(150)
      .optional()
      .describe('Texto a buscar en el nombre (insensible a mayúsculas).'),
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
      .enum(['nombre', 'creadoEn'])
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

// ── Avíos que surte el proveedor (B17, rediseño R9 — lado PROVEEDOR de AvioProveedor) ──
// El vínculo avío↔proveedor (R1) ya se administra desde el AVÍO (avios.administrar). B17
// abre la MISMA relación desde el PROVEEDOR ("avíos que surte" con asignar/quitar), para la
// pantalla de Proveedores del proto (`drawerProveedor`). Se gobierna con `proveedores.*` (el
// permiso de la pantalla), sin permiso nuevo.

/**
 * Un avío que surte el proveedor, con SU precio y condiciones (el renglón `AvioProveedor`
 * visto desde el lado proveedor). Trae la clave y descripción del avío embebidas para que la
 * UI no cruce con el catálogo. Sale suelto en `GET /api/proveedores/{id}/avios`.
 */
export const esquemaProveedorAvioSalida = z
  .object({
    idAvio: z.number().int().describe('Id del avío.'),
    clave: z.string().describe('Clave del avío (para la UI).'),
    descripcion: z.string().describe('Descripción del avío (para la UI).'),
    precio: z.number().nullable().describe('Precio al que este proveedor lo surte, o null.'),
    condiciones: z.string().nullable().describe('Condiciones comerciales, o null.'),
  })
  .describe('Avío que surte un proveedor con su precio y condiciones (R1/B17).');

/** Forma de un avío surtido por un proveedor tal como lo devuelve la API. */
export type ProveedorAvioSalida = z.infer<typeof esquemaProveedorAvioSalida>;

/** Lista de avíos que surte un proveedor (`GET /api/proveedores/{id}/avios`). */
export const esquemaProveedorAviosLista = z
  .object({
    datos: z
      .array(esquemaProveedorAvioSalida)
      .describe('Avíos que surte el proveedor con su precio.'),
  })
  .describe('Avíos que surte un proveedor (B17).');

/** Forma de la lista de avíos que surte un proveedor. */
export type ProveedorAviosLista = z.infer<typeof esquemaProveedorAviosLista>;

/**
 * Cuerpo para asignar un avío a un proveedor (`POST /api/proveedores/{id}/avios`): el avío y,
 * opcionalmente, el precio al que lo surte y las condiciones. Mismas reglas de precio/condiciones
 * que el renglón embebido del avío (`esquemaAvioProveedorEntrada`).
 */
export const esquemaProveedorAvioAsignar = z
  .object({
    idAvio: z
      .number({ error: 'El id del avío es obligatorio' })
      .int({ error: 'El id del avío debe ser entero' })
      .positive({ error: 'El id del avío debe ser positivo' }),
    precio: z
      .number({ error: 'El precio debe ser un número' })
      .nonnegative({ error: 'El precio no puede ser negativo' })
      .optional(),
    condiciones: z
      .string()
      .trim()
      .max(500, { error: 'Las condiciones no pueden tener más de 500 caracteres' })
      .optional(),
  })
  .describe('Asignar un avío que surte el proveedor con su precio y condiciones (B17).');

/** Datos validados para asignar un avío a un proveedor. */
export type DatosProveedorAvioAsignar = z.infer<typeof esquemaProveedorAvioAsignar>;
