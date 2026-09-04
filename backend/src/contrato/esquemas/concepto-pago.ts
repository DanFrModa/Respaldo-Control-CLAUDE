/**
 * CONTRATO del CATÁLOGO DE CONCEPTOS DE PAGO QUE **NO** SON PROVEEDORES (fila 0.125).
 *
 * Daniel (§Post-F9.189(c)): *«quiero dejar pagos para cosas que no necesariamente están dadas de
 * alta como proveedores (nóminas por fuera, gratificaciones, pago de algún servicio como agua, o
 * cualquier otra cosa). Debería de poder tener como un catálogo de otras cosas que no son
 * proveedores»* — y confirmó, esa misma tarde: *«que sean un catálogo aparte, no proveedores»*.
 *
 * ⭐ Y con PREDETERMINADOS, también textual: *«algunos de ellos quiero que se carguen por default
 * en la relación, porque son conceptos que cada semana pago y no quiero que se me vaya a olvidar
 * ponerlo (caja chica, nómina por fuera, etc.) … para que siempre se carguen EN CERO para que yo
 * le ponga la cantidad»*.
 *
 * Las CUENTAS del concepto tienen la MISMA forma que las del proveedor (0.112) y reusan sus
 * funciones puras de validación (`normalizarNumeroDeCuenta` / `motivoCuentaInvalida`, en
 * `proveedor.ts`): un número de cuenta se valida igual venga de donde venga.
 */
import { z } from 'zod';

import {
  camposCuentaPago,
  FORMAS_DE_PAGO_PROVEEDOR,
  motivoCuentaInvalida,
  TIPOS_CUENTA_PAGO,
} from './proveedor.js';

/**
 * Cómo sale físicamente el dinero (§Post-F9.189(c)). Espejo del enum Prisma `FormaDePago`.
 *
 * ⚠️ NO es `Proveedor.formaPago` (texto libre con la clave del SAT para el CFDI, "03 —
 * Transferencia"): eso quedó superado por `formaPagoPreferida`. Aquí sólo hay dos respuestas,
 * porque son las dos con las que Daniel cierra su relación semanal.
 */
export const FORMAS_DE_PAGO = FORMAS_DE_PAGO_PROVEEDOR;
/** Clave de forma de pago. */
export type FormaDePagoClave = (typeof FORMAS_DE_PAGO)[number];

/** Etiquetas para UI. */
export const ETIQUETAS_FORMA_DE_PAGO: Record<FormaDePagoClave, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
};

/**
 * Las SECCIONES de la relación de pago (§Post-F9.189(e): *«misma relación pero separada por rubro.
 * Así como mi archivo de Excel»*). Espejo del enum Prisma `RubroPago`.
 *
 * Los dos primeros se DERIVAN del proveedor (tiene rol de maquila o no); los otros cuatro son los
 * que Daniel nombró para este catálogo.
 */
export const RUBROS_PAGO = [
  'maquila',
  'proveedores',
  'nomina',
  'servicios',
  'caja_chica',
  'otros',
] as const;
/** Clave de rubro. */
export type RubroPagoClave = (typeof RUBROS_PAGO)[number];

/**
 * Los rubros que un CONCEPTO puede llevar: los cuatro que NO se derivan de un proveedor. Un
 * concepto del catálogo jamás cae en la sección de maquileros ni en la de proveedores — ésas las
 * llenan los proveedores mismos (lo repite un CHECK en la base).
 */
export const RUBROS_CONCEPTO_PAGO = ['nomina', 'servicios', 'caja_chica', 'otros'] as const;
/** Clave de rubro de un concepto del catálogo. */
export type RubroConceptoPagoClave = (typeof RUBROS_CONCEPTO_PAGO)[number];

/** Etiquetas para UI, en el ORDEN en el que Daniel quiere ver las secciones de su relación. */
export const ETIQUETAS_RUBRO_PAGO: Record<RubroPagoClave, string> = {
  maquila: 'Maquileros',
  proveedores: 'Proveedores',
  nomina: 'Nómina por fuera',
  servicios: 'Servicios',
  caja_chica: 'Caja chica',
  otros: 'Otros',
};

/** El ORDEN de las secciones de la relación (el de su Excel: primero las maquilas). */
export const ORDEN_RUBROS_PAGO: readonly RubroPagoClave[] = [
  'maquila',
  'proveedores',
  'nomina',
  'servicios',
  'caja_chica',
  'otros',
];

// ── El concepto ──────────────────────────────────────────────────────────────────────────────────

/** Campos comunes del concepto (mismas reglas en alta y edición). */
const camposConcepto = {
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, { error: 'Escribe cómo se llama el concepto' })
    .max(120, { error: 'El nombre no puede tener más de 120 caracteres' }),
  rubro: z.enum(RUBROS_CONCEPTO_PAGO, {
    error: 'El rubro debe ser nómina, servicios, caja chica u otros',
  }),
  formaPagoPreferida: z
    .enum(FORMAS_DE_PAGO, { error: 'La forma de pago debe ser efectivo o transferencia' })
    .nullable()
    .optional(),
  predeterminado: z
    .boolean({ error: '¿Se carga solo en cada corrida? debe ser verdadero o falso' })
    .optional(),
  notas: z
    .string()
    .trim()
    .max(1000, { error: 'Las notas no pueden tener más de 1000 caracteres' })
    .optional(),
} as const;

/** Alta de un concepto de pago. */
export const esquemaConceptoPagoCrear = z
  .object(camposConcepto)
  .describe('Alta de un concepto de pago que no es proveedor.');

/** Datos validados del alta. */
export type DatosConceptoPagoCrear = z.infer<typeof esquemaConceptoPagoCrear>;

/** Edición PARCIAL: omitir = no tocar; `null`/'' = borrar el dato opcional. */
export const esquemaConceptoPagoEditar = z
  .object({
    nombre: camposConcepto.nombre.optional(),
    rubro: camposConcepto.rubro.optional(),
    formaPagoPreferida: camposConcepto.formaPagoPreferida,
    predeterminado: camposConcepto.predeterminado,
    notas: camposConcepto.notas.nullable(),
    /** Borrado SUAVE (D3): `false` lo retira del catálogo, `true` lo revive. */
    activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
  })
  .describe('Edición parcial de un concepto de pago.');

/** Datos validados de la edición. */
export type DatosConceptoPagoEditar = z.infer<typeof esquemaConceptoPagoEditar>;

/** Una cuenta de pago de un concepto, tal como sale de la API (espejo de la del proveedor). */
export const esquemaConceptoPagoCuentaSalida = z
  .object({
    id: z.number().int().describe('Id de la cuenta.'),
    idConcepto: z.number().int().describe('Id del concepto dueño de la cuenta.'),
    beneficiario: z.string().describe('A nombre de quién está la cuenta (el del depósito).'),
    banco: z.string().nullable().describe('Banco, o null.'),
    tipoCuenta: z.enum(TIPOS_CUENTA_PAGO).describe('CLABE o tarjeta.'),
    cuenta: z.string().describe('El número, sólo dígitos.'),
    alias: z.string().nullable().describe('Cómo se le llama en la relación de pago.'),
    esFiscal: z.boolean().describe('Verdadero si a ella puede salir un pago CON factura.'),
    esDefault: z.boolean().describe('Verdadero si es LA cuenta por omisión del concepto.'),
    notas: z.string().nullable().describe('Notas, o null.'),
    activo: z.boolean().describe('Falso si está retirada (sigue siendo historial reutilizable).'),
  })
  .describe('Cuenta/destino de pago de un concepto.');

/** Cuenta de concepto tal como sale de la API. */
export type ConceptoPagoCuentaSalida = z.infer<typeof esquemaConceptoPagoCuentaSalida>;

/** Un concepto de pago tal como sale de la API (con sus cuentas). */
export const esquemaConceptoPagoSalida = z
  .object({
    id: z.number().int().describe('Id del concepto.'),
    nombre: z.string().describe('Cómo se llama en la relación.'),
    rubro: z.enum(RUBROS_PAGO).describe('Sección de la relación donde cae.'),
    formaPagoPreferida: z
      .enum(FORMAS_DE_PAGO)
      .nullable()
      .describe('Efectivo o transferencia por omisión, o null (sin preferencia).'),
    predeterminado: z
      .boolean()
      .describe('Verdadero si se carga solo, EN CERO, en cada corrida nueva.'),
    notas: z.string().nullable().describe('Notas, o null.'),
    activo: z.boolean().describe('Falso si está retirado del catálogo.'),
    cuentas: z.array(esquemaConceptoPagoCuentaSalida).describe('Cuentas/destinos de pago.'),
  })
  .describe('Concepto de pago que no es proveedor.');

/** Concepto de pago tal como sale de la API. */
export type ConceptoPagoSalida = z.infer<typeof esquemaConceptoPagoSalida>;

/** Filtros del listado del catálogo (paginación del SERVIDOR, patrón CRUD). */
export const esquemaConceptosPagoQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página (máx 100).'),
    busqueda: z.string().trim().max(120).optional().describe('Filtra por nombre.'),
    rubro: z.enum(RUBROS_CONCEPTO_PAGO).optional().describe('Filtra por rubro.'),
    incluirInactivos: z.coerce
      .boolean()
      .default(false)
      .describe('Incluye los conceptos retirados.'),
  })
  .describe('Filtros y paginación del catálogo de conceptos de pago.');

/** Filtros ya coaccionados. */
export type ConceptosPagoQuery = z.infer<typeof esquemaConceptosPagoQuery>;

/** Página del catálogo. */
export const esquemaConceptosPagoPagina = z
  .object({
    datos: z.array(esquemaConceptoPagoSalida),
    total: z.number().int(),
    pagina: z.number().int(),
    porPagina: z.number().int(),
    totalPaginas: z.number().int(),
  })
  .describe('Página del catálogo de conceptos de pago.');

/** Página del catálogo tal como sale de la API. */
export type ConceptosPagoPagina = z.infer<typeof esquemaConceptosPagoPagina>;

// ── Las cuentas del concepto (mismas reglas que las del proveedor) ──────────────────────────────

/**
 * Alta de una cuenta del concepto. El concepto va en la URL, no en el cuerpo. `esDefault` NO se
 * pide: la PRIMERA cuenta queda default sola (lo decide el dominio) y las demás se promueven con
 * el PATCH — así el alta nunca compite por la marca. Idéntico al proveedor (0.112).
 */
export const esquemaConceptoPagoCuentaCrear = z
  .object(camposCuentaPago)
  .superRefine((datos, ctx) => {
    const motivo = motivoCuentaInvalida(datos.tipoCuenta, datos.cuenta);
    if (motivo !== null) {
      ctx.addIssue({ code: 'custom', message: motivo, path: ['cuenta'] });
    }
  })
  .describe('Alta de una cuenta/destino de pago de un concepto.');

/** Datos validados del alta de una cuenta de concepto. */
export type DatosConceptoPagoCuentaCrear = z.infer<typeof esquemaConceptoPagoCuentaCrear>;

/** Edición PARCIAL de una cuenta del concepto (mismas reglas que la del proveedor). */
export const esquemaConceptoPagoCuentaEditar = z
  .object({
    beneficiario: camposCuentaPago.beneficiario.optional(),
    banco: camposCuentaPago.banco.nullable(),
    tipoCuenta: camposCuentaPago.tipoCuenta.optional(),
    cuenta: camposCuentaPago.cuenta.optional(),
    alias: camposCuentaPago.alias.nullable(),
    esFiscal: camposCuentaPago.esFiscal,
    notas: camposCuentaPago.notas.nullable(),
    esDefault: z
      .boolean({ error: '¿Es la cuenta por omisión? debe ser verdadero o falso' })
      .optional(),
    activo: z.boolean({ error: 'Activo debe ser verdadero o falso' }).optional(),
  })
  .describe('Edición parcial de una cuenta/destino de pago de un concepto.');

/** Datos validados de la edición de una cuenta de concepto. */
export type DatosConceptoPagoCuentaEditar = z.infer<typeof esquemaConceptoPagoCuentaEditar>;
