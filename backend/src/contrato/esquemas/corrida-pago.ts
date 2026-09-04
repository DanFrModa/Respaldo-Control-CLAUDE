/**
 * CONTRATO de LA CORRIDA SEMANAL DE PAGOS (fila 0.113) — §Post-F9.185 y §Post-F9.189.
 *
 * Daniel: *«Es una de las pantallas más importantes dentro del sistema. Debe estar muy bien
 * hecha.»* Y sobre cuál es el entregable: *«Ni siquiera necesito el Excel. Eso puede vivir en la
 * pantalla y de ahí ir llenando la información de pagos … la idea es trabajarlo ahí mismo.»*
 *
 * ⭐ **LA PANTALLA ES EL PRODUCTO.** Él la dibujó: *«me imagino que en la pantalla donde están los
 * saldos de todos los proveedores con un campo abierto a un lado para capturar lo que se le va a
 * pagar esa semana. Y en esa misma pantalla cargar por default estos conceptos que te comento,
 * también con el campo a un lado. Y tener la posibilidad de cargar el concepto que necesito del
 * catálogo de conceptos nuevo.»*
 *
 * De ahí sale la forma de {@link esquemaCorridaDetalleSalida}: **una sola pantalla, con SECCIONES
 * por rubro** (maquileros · proveedores · los conceptos del catálogo), cada sección con sus propias
 * columnas de REFERENCIA y todas con la misma columna capturable «a pagar esta semana» y el mismo
 * selector efectivo/transferencia.
 *
 * ⚠️ **La referencia NUNCA es el número que se paga** (§Post-F9.189(b): *«yo voy decidiendo los
 * montos a pagar de cada uno. Manualmente»*). El saldo, lo pendiente de revisión, el vencido y los
 * recibos de la semana viajan al lado del campo, para que él decida — no para llenarlo.
 */
import { z } from 'zod';

import { FORMAS_DE_PAGO, RUBROS_PAGO } from './concepto-pago.js';
import { TIPOS_CUENTA_PAGO } from './proveedor.js';

/** Ciclo de vida de una corrida. Espejo del enum Prisma `EstadoCorridaPago`. */
export const ESTADOS_CORRIDA_PAGO = ['borrador', 'cerrada', 'ejecutada'] as const;
/** Clave de estado de corrida. */
export type EstadoCorridaPagoClave = (typeof ESTADOS_CORRIDA_PAGO)[number];

/** Etiquetas para UI. */
export const ETIQUETAS_ESTADO_CORRIDA: Record<EstadoCorridaPagoClave, string> = {
  borrador: 'Borrador',
  cerrada: 'Cerrada',
  ejecutada: 'Ejecutada',
};

/** De dónde viene un renglón. Espejo del enum Prisma `OrigenRenglonPago`. */
export const ORIGENES_RENGLON_PAGO = ['maquila', 'proveedor', 'concepto'] as const;
/** Clave de origen de renglón. */
export type OrigenRenglonPagoClave = (typeof ORIGENES_RENGLON_PAGO)[number];

/** Fecha `YYYY-MM-DD` (las fechas viajan como texto, no como Date). */
const fechaIso = z
  .string({ error: 'La fecha es obligatoria' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'La fecha debe venir como AAAA-MM-DD' });

// ── Alta de la corrida ──────────────────────────────────────────────────────────────────────────

/**
 * Alta de una corrida.
 *
 * `semana` es CUALQUIER día de la semana que se va a pagar: el dominio lo normaliza al LUNES, para
 * que «la corrida del 3» y «la corrida del 5» de la misma semana sean la misma semana y el guardia
 * de un solo borrador por segmento funcione.
 */
export const esquemaCorridaCrear = z
  .object({
    semana: fechaIso.describe('Cualquier día de la semana a pagar (se normaliza al lunes).'),
    conFactura: z
      .boolean({ error: '¿Es la relación CON factura? debe ser verdadero o falso' })
      .describe('true = la relación CON factura; false = la relación SIN factura.'),
    notas: z.string().trim().max(2000).optional(),
  })
  .describe('Alta de una corrida semanal de pagos.');

/** Datos validados del alta. */
export type DatosCorridaCrear = z.infer<typeof esquemaCorridaCrear>;

// ── El renglón que se captura ───────────────────────────────────────────────────────────────────

/**
 * Lo que la pantalla manda al teclear un renglón. El `id` viaja aparte (en la URL) al editar.
 *
 * ⭐ `idCuenta` es la cuenta DESTINO. Con `formaPago: 'efectivo'` va en `null` y el beneficiario
 * pasa a ser el proveedor/concepto mismo (§Post-F9.189(c)). Con `transferencia` es obligatoria: una
 * transferencia sin cuenta no se puede hacer, y dejarla «para después» es justo el hueco por el que
 * un renglón llegaría al banco sin destino.
 */
export const esquemaRenglonCorridaGuardar = z
  .object({
    // 🔴 `origen` NO se acepta del cliente: lo DERIVA el dominio del beneficiario y sus roles
    // (`rubro === 'maquila' ? 'maquila' : 'proveedor'`, o `'concepto'`). Estuvo aquí y era un
    // agujero real: el origen decide EN QUÉ LIBRO nace el pago (EsMa vs CxP), así que un cuerpo con
    // `{origen:'proveedor', idProveedor:<un maquilero>}` pintaba la fila en Maquileros y metía el
    // dinero en CxP. Mandarlo ahora es un campo desconocido y se ignora.
    idProveedor: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Proveedor (origen maquila/proveedor).'),
    idConcepto: z.number().int().positive().optional().describe('Concepto (origen concepto).'),
    monto: z
      .number({ error: 'El monto debe ser un número' })
      .min(0, { error: 'El monto no puede ser negativo' })
      .max(99_999_999.99, { error: 'El monto es demasiado grande' })
      .describe('Lo que se le paga esta semana. CERO es válido: se ve, pero no sale.'),
    formaPago: z.enum(FORMAS_DE_PAGO).describe('Efectivo o transferencia.'),
    idCuenta: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .describe('Cuenta destino (obligatoria si es transferencia; null si es efectivo).'),
    /**
     * ⭐ LA EXPLICACIÓN DEL PAGO, en texto libre. Sale de LEER el archivo real que finanzas arma
     * cada semana: su columna «Concepto» lleva de 30 a 170 caracteres y es lo que le dice a quien
     * ejecuta la transferencia QUÉ está pagando («Nómina por fuera <fecha>», la compra, el
     * servicio). Opcional —un maquilero con su recibo se explica solo— pero es la primera columna
     * que se lee en la relación.
     */
    concepto: z.string().trim().max(500).nullable().optional(),
    /** Folios de las remisiones o recibos que ampara el pago («7909 y 7888»). */
    referencia: z.string().trim().max(200).nullable().optional(),
  })
  .describe(
    'Un renglón de la relación: a quién (proveedor O concepto), cuánto, por dónde y por qué. ' +
      'El origen y el rubro los DERIVA el servidor del beneficiario.',
  );

/** Datos validados del renglón. */
export type DatosRenglonCorridaGuardar = z.infer<typeof esquemaRenglonCorridaGuardar>;

// ── Salidas ─────────────────────────────────────────────────────────────────────────────────────

/** Una cuenta destino, tal como la ve la pantalla para elegirla (sin exponer el número completo). */
export const esquemaCuentaDestinoSalida = z
  .object({
    id: z.number().int(),
    beneficiario: z.string().describe('A nombre de quién va el depósito.'),
    banco: z.string().nullable(),
    tipoCuenta: z.enum(TIPOS_CUENTA_PAGO),
    /**
     * ⭐ Los ÚLTIMOS 4 dígitos, no el número entero. La pantalla sólo necesita distinguir dos
     * cuentas del mismo beneficiario; el número completo vive en el catálogo (donde se captura) y
     * en la relación ejecutable (donde hace falta para transferir).
     */
    ultimos4: z.string().describe('Últimos 4 dígitos de la cuenta.'),
    alias: z.string().nullable().describe('Su "1", "2"… — lo que distingue un pago partido.'),
    esFiscal: z.boolean().describe('A ella puede salir un pago CON factura.'),
    esDefault: z.boolean(),
  })
  .describe('Cuenta destino elegible para un renglón.');

/** Cuenta destino tal como sale de la API. */
export type CuentaDestinoSalida = z.infer<typeof esquemaCuentaDestinoSalida>;

/** Un renglón ya guardado, tal como sale de la API. */
export const esquemaRenglonCorridaSalida = z
  .object({
    id: z.number().int(),
    origen: z.enum(ORIGENES_RENGLON_PAGO),
    idProveedor: z.number().int().nullable(),
    idConcepto: z.number().int().nullable(),
    rubro: z.enum(RUBROS_PAGO).describe('Sección de la relación (congelada al crear el renglón).'),
    nombre: z.string().describe('Nombre con el que sale impreso (congelado).'),
    monto: z.number().nullable().describe('Lo que se le paga (null si se ocultan importes).'),
    formaPago: z.enum(FORMAS_DE_PAGO),
    idCuenta: z.number().int().nullable().describe('Id de la cuenta destino, o null (efectivo).'),
    beneficiario: z.string().describe('A nombre de quién va (congelado).'),
    banco: z.string().nullable(),
    tipoCuenta: z.enum(TIPOS_CUENTA_PAGO).nullable(),
    ultimos4: z.string().nullable().describe('Últimos 4 dígitos de la cuenta, o null.'),
    aliasCuenta: z.string().nullable(),
    cuentaEsFiscal: z.boolean().nullable(),
    concepto: z.string().nullable().describe('La explicación del pago (lo que se está pagando).'),
    referencia: z.string().nullable().describe('Folios de remisiones/recibos que ampara.'),
    /** Id del pago/movimiento que nació al ejecutar, o null si todavía no se ejecutó. */
    idPagoMaquilero: z.number().int().nullable(),
    idMovimientoTercero: z.number().int().nullable(),
  })
  .describe('Un renglón guardado de la corrida.');

/** Renglón tal como sale de la API. */
export type RenglonCorridaSalida = z.infer<typeof esquemaRenglonCorridaSalida>;

/**
 * ⭐ UNA FILA DE LA PANTALLA DE TRABAJO: un beneficiario candidato con su REFERENCIA al lado y sus
 * renglones (0, 1, o más de uno si el pago se partió).
 *
 * Las columnas de referencia CAMBIAN por sección y por eso viajan todas nullable:
 *  • maquileros → `saldo` (EsMa, sólo lo revisado) + `porRevisar` + `recibosSemana`;
 *  • proveedores CxP → `saldo` + `vencido` (las cubetas de la bandeja);
 *  • conceptos del catálogo → ninguna: nacen en cero.
 * NINGUNA es el número que se paga (§Post-F9.189(b)).
 */
export const esquemaFilaCorridaSalida = z
  .object({
    origen: z.enum(ORIGENES_RENGLON_PAGO),
    idProveedor: z.number().int().nullable(),
    idConcepto: z.number().int().nullable(),
    rubro: z.enum(RUBROS_PAGO),
    nombre: z.string(),
    nombreCorto: z.string().nullable(),
    /** Forma de pago sugerida (preferencia del beneficiario, o la que implica tener cuenta). */
    formaPagoSugerida: z.enum(FORMAS_DE_PAGO),
    /** Cuenta sugerida (la default activa), o null. */
    idCuentaSugerida: z.number().int().nullable(),
    cuentas: z.array(esquemaCuentaDestinoSalida).describe('Cuentas activas donde puede cobrar.'),
    /**
     * ⭐ ¿Se le puede pagar CON factura? `false` cuando no tiene NINGUNA cuenta fiscal capturada
     * (§Post-F9.189(d): *«sin cuenta fiscal capturada, ese proveedor no se puede pagar con factura
     * hasta tenerla — la corrida lo dice con su nombre»*). Sólo se mira en la corrida CON factura.
     */
    puedeConFactura: z.boolean(),
    // ── Referencia (NUNCA el número que se paga) ────────────────────────────────────────────
    saldo: z.number().nullable().describe('Saldo a favor del beneficiario, o null.'),
    vencido: z.number().nullable().describe('Parte vencida del saldo (sólo CxP), o null.'),
    porRevisarNeto: z
      .number()
      .nullable()
      .describe('Neto capturado que aún NO suma al saldo (sólo maquila), o null.'),
    porRevisarPartidas: z
      .number()
      .int()
      .describe('Cuántas partidas esperan revisión (0 si no aplica). NO es un importe.'),
    recibosSemanaImporte: z
      .number()
      .nullable()
      .describe('Σ de lo recibido esta semana valuado a precio pactado (sólo maquila), o null.'),
    recibosSemanaCantidad: z
      .number()
      .int()
      .describe('Prendas recibidas esta semana (0 si no aplica).'),
    // ── Lo capturado ────────────────────────────────────────────────────────────────────────
    renglones: z.array(esquemaRenglonCorridaSalida),
    /** Σ de los montos de sus renglones (null si se ocultan importes). */
    totalCapturado: z.number().nullable(),
  })
  .describe('Una fila de la pantalla de trabajo de la corrida.');

/** Fila de trabajo tal como sale de la API. */
export type FilaCorridaSalida = z.infer<typeof esquemaFilaCorridaSalida>;

/** Los totales de una sección o de toda la corrida, separados como en el Excel de Daniel. */
export const esquemaTotalesPago = z
  .object({
    efectivo: z.number().nullable().describe('Σ de lo que sale en efectivo.'),
    transferencia: z.number().nullable().describe('Σ de lo que sale por transferencia.'),
    total: z.number().nullable(),
    renglones: z.number().int().describe('Cuántos renglones CON monto (> 0) hay.'),
  })
  .describe('Totales de efectivo y transferencia (los de su relación semanal).');

/** Totales tal como salen de la API. */
export type TotalesPago = z.infer<typeof esquemaTotalesPago>;

/** El encabezado de una corrida (para la lista y para el detalle). */
export const esquemaCorridaSalida = z
  .object({
    id: z.number().int(),
    folio: z.number().int(),
    semana: z.string().describe('Lunes de la semana pagada (AAAA-MM-DD).'),
    conFactura: z.boolean(),
    estado: z.enum(ESTADOS_CORRIDA_PAGO),
    notas: z.string().nullable(),
    cerradaEn: z.string().nullable(),
    ejecutadaEn: z.string().nullable(),
    totales: esquemaTotalesPago,
  })
  .describe('Encabezado de una corrida semanal de pagos.');

/** Corrida (encabezado) tal como sale de la API. */
export type CorridaSalida = z.infer<typeof esquemaCorridaSalida>;

/** Una SECCIÓN de la pantalla: el rubro con sus filas y sus totales. */
export const esquemaSeccionCorridaSalida = z
  .object({
    rubro: z.enum(RUBROS_PAGO),
    filas: z.array(esquemaFilaCorridaSalida),
    totales: esquemaTotalesPago,
  })
  .describe('Una sección (rubro) de la relación.');

/** Sección tal como sale de la API. */
export type SeccionCorridaSalida = z.infer<typeof esquemaSeccionCorridaSalida>;

/**
 * ⭐ LA PANTALLA DE TRABAJO ENTERA: la corrida + sus secciones por rubro + los avisos que hay que
 * resolver antes de cerrarla.
 */
export const esquemaCorridaDetalleSalida = z
  .object({
    corrida: esquemaCorridaSalida,
    secciones: z.array(esquemaSeccionCorridaSalida),
    /**
     * Lo que IMPIDE cerrar la corrida, con el nombre de cada quien (§Post-F9.189(d): *«la corrida
     * lo dice con su nombre»*). Vacío = se puede cerrar.
     */
    bloqueos: z
      .array(
        z.object({
          nombre: z.string(),
          motivo: z.string(),
        }),
      )
      .describe('Renglones que impiden cerrar, con su nombre y el porqué.'),
  })
  .describe('La pantalla de trabajo de una corrida de pagos.');

/** Detalle de corrida tal como sale de la API. */
export type CorridaDetalleSalida = z.infer<typeof esquemaCorridaDetalleSalida>;

/** Lista de corridas. */
export const esquemaCorridasLista = z
  .object({
    filas: z.array(esquemaCorridaSalida),
    total: z.number().int(),
    pagina: z.number().int(),
    porPagina: z.number().int(),
    totalPaginas: z.number().int(),
  })
  .describe('Página de corridas de pago.');

/** Lista de corridas tal como sale de la API. */
export type CorridasLista = z.infer<typeof esquemaCorridasLista>;

/** Filtros de la lista de corridas (paginación del SERVIDOR). */
export const esquemaCorridasQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1),
    porPagina: z.coerce.number().int().min(1).max(100).default(20),
    conFactura: z
      .enum(['con', 'sin'])
      .optional()
      .describe('Filtra el segmento (con factura / sin factura).'),
    estado: z.enum(ESTADOS_CORRIDA_PAGO).optional(),
  })
  .describe('Filtros y paginación de las corridas de pago.');

/** Filtros ya coaccionados. */
export type CorridasQuery = z.infer<typeof esquemaCorridasQuery>;

/**
 * ⭐ EL CONCENTRADO EJECUTABLE: sólo los renglones CON monto, ordenados por monto descendente, con
 * los totales separados de efectivo y transferencia por rubro y el gran total.
 *
 * Es la lista con la que finanzas hace las transferencias, y lo que sustituye a la hoja «Transfers
 * Concentrado» de su Excel. ⚠️ **Los renglones NO se colapsan por beneficiario** (§Post-F9.185(e)):
 * un pago partido en dos cuentas son DOS renglones, *«así debe salir en la relación para poder hacer
 * las dos transferencias»*. Aquí SÍ va el número de cuenta completo: es para transferir.
 */
export const esquemaConcentradoRenglon = z
  .object({
    rubro: z.enum(RUBROS_PAGO),
    nombre: z.string(),
    beneficiario: z.string(),
    banco: z.string().nullable(),
    tipoCuenta: z.enum(TIPOS_CUENTA_PAGO).nullable(),
    cuenta: z.string().nullable().describe('El número completo (es para transferir), o null.'),
    aliasCuenta: z.string().nullable(),
    formaPago: z.enum(FORMAS_DE_PAGO),
    monto: z.number().nullable(),
    /** La explicación del pago: la columna que finanzas lee para ejecutar la transferencia. */
    concepto: z.string().nullable(),
    referencia: z.string().nullable(),
  })
  .describe('Un renglón de la relación ejecutable.');

/** Renglón del concentrado tal como sale de la API. */
export type ConcentradoRenglon = z.infer<typeof esquemaConcentradoRenglon>;

/** El concentrado completo. */
export const esquemaConcentradoSalida = z
  .object({
    corrida: esquemaCorridaSalida,
    secciones: z
      .array(
        z.object({
          rubro: z.enum(RUBROS_PAGO),
          renglones: z.array(esquemaConcentradoRenglon),
          totales: esquemaTotalesPago,
        }),
      )
      .describe('Las secciones con monto (una sección sin nada que pagar no sale).'),
    totales: esquemaTotalesPago.describe('El gran total de la corrida.'),
  })
  .describe('La relación ejecutable de una corrida (lo que se le manda a finanzas).');

/** Concentrado tal como sale de la API. */
export type ConcentradoSalida = z.infer<typeof esquemaConcentradoSalida>;
