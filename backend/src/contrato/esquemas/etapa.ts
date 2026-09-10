import { z } from 'zod';

import { esquemaPackEntrada, esquemaPackSalida } from './pack.js';

/**
 * Esquemas Zod de las ETAPAS de producción (F3-E2: corte + envío a maquila unificado; doc
 * 03-Produccion Pasos 3 y 4 + flujo paralelo de estampado, Observación 4). UNA sola definición de
 * reglas para UI y servidor (alimenta el OpenAPI). El detalle es SIEMPRE color×talla (D4).
 *
 * Sobre las tolerancias (DECISIONES.md (f)/(g)):
 *  • (f) Sobre-corte LIBRE: el corte acepta cualquier cantidad ≥ 0; la pantalla solo AVISA si
 *    excede lo pedido. Aquí no hay tope.
 *  • (g) Sobre-envío ESTRICTO: el servidor bloquea si lo enviado excede el cortado disponible para
 *    ese proceso. La validación real vive en el dominio (suma directa de `EtapaMovimientoDet`).
 */

// ── Renglón color×talla (compartido por corte y envío) ──────────────────────────────────────────

/** Una talla con su cantidad dentro de un color (D4). Cantidad entera ≥ 0. */
const esquemaEtapaTalla = z.object({
  idTalla: z
    .number({ error: 'El id de la talla es obligatorio' })
    .int({ error: 'El id de la talla debe ser entero' })
    .positive({ error: 'El id de la talla debe ser positivo' }),
  cantidad: z
    .number({ error: 'La cantidad es obligatoria' })
    .int({ error: 'La cantidad debe ser entera' })
    .min(0, { error: 'La cantidad no puede ser negativa' }),
});

/**
 * Un renglón de la matriz de la etapa: un color × su PACK, con sus cantidades por talla (D4).
 *
 * ⭐ El PACK (§Post-F9.10) es OBLIGATORIO en corte y en entrega a maquila **cuando la orden maneja
 * packs** — *«cada tendido es de un pack»* — y tiene que ser uno de los packs de la orden. En una
 * orden SIN packs el campo se omite (o va vacío) y todo se comporta igual que siempre; mandarlo en
 * ese caso es un error de captura y el dominio lo rechaza, no lo ignora.
 */
const esquemaEtapaLinea = z.object({
  idColor: z
    .number({ error: 'El id del color es obligatorio' })
    .int({ error: 'El id del color debe ser entero' })
    .positive({ error: 'El id del color debe ser positivo' }),
  pack: esquemaPackEntrada.describe(
    'PACK / TENDIDO de este renglón (§Post-F9.10). OBLIGATORIO en corte y entrega a maquila si la ' +
      'orden maneja packs; ausente o vacío en las órdenes que no los manejan.',
  ),
  tallas: z
    .array(esquemaEtapaTalla)
    .min(1, { error: 'Cada color necesita al menos una talla' })
    .describe('Cantidades por talla de este color.'),
});

/** La matriz color×talla de una etapa (al menos un color). */
const esquemaEtapaMatriz = z
  .array(esquemaEtapaLinea)
  .min(1, { error: 'Captura al menos un color con sus tallas' })
  .describe('Matriz color×talla de la etapa (D4).');

/** Un renglón de la matriz tal como lo recibe el dominio. */
export type DatosEtapaLineaEntrada = z.infer<typeof esquemaEtapaLinea>;

// ── Corte ────────────────────────────────────────────────────────────────────────────────────

/**
 * PRECIO POR PRENDA pactado con el proveedor de un SERVICIO sobre la orden (corte/empaque, 0.114).
 * Misma forma que el `precioPactado` del envío a maquila: opcional, ≥ 0 y con dos decimales — la
 * columna es `Decimal(12,2)` y un tercer decimal se perdería en silencio al guardarlo.
 *
 * Es la mitad que faltaba de *«sólo hay que poner su cantidad y precio para meterlo en la OP»*: sin
 * él, el cargo del cortador nace SIN precio y hay que teclearlo aparte al validarlo — la doble
 * captura que v2 elimina.
 */
const esquemaPrecioServicio = z
  .number({ error: 'El precio pactado debe ser un número' })
  .min(0, { error: 'El precio pactado no puede ser negativo' })
  .multipleOf(0.01, { error: 'El precio pactado no puede tener más de 2 decimales' });

/**
 * Alta de un CORTE de una orden (doc 03-Produccion Paso 3). `idTipoProceso` es NULL (el corte no
 * es maquila); `idTercero` es el CORTADOR (Proveedor con rol `corte`). Sobre-corte LIBRE (f): no
 * hay tope de cantidad — la pantalla avisa, el servidor acepta.
 *
 * ⭐ 0.114 — el corte es PAGABLE. Daniel: *«en corte no necesitas mandar y recibir mercancía… sólo
 * hay que poner su cantidad y precio para meterlo en la OP, pero no va y viene»*. Con
 * `precioPactado` el corte genera su CARGO EsMa (`servicio: 'corte'`) igual que el recibo de
 * maquila genera el suyo, sin envío ni recibo de por medio.
 */
export const esquemaCorteCrear = z
  .object({
    idOrden: z
      .number({ error: 'La orden es obligatoria' })
      .int({ error: 'El id de la orden debe ser entero' })
      .positive({ error: 'El id de la orden debe ser positivo' }),
    idCortador: z
      .number({ error: 'El cortador es obligatorio' })
      .int({ error: 'El id del cortador debe ser entero' })
      .positive({ error: 'El id del cortador debe ser positivo' })
      .describe('Proveedor con rol "corte".'),
    fecha: z.iso
      .date({ error: 'La fecha del corte es obligatoria (YYYY-MM-DD)' })
      .describe('Fecha del corte (YYYY-MM-DD).'),
    precioPactado: esquemaPrecioServicio
      .nullish()
      .describe('Precio por prenda pactado con el cortador (base de su cargo EsMa), opcional.'),
    observaciones: z.string().trim().max(1000).optional(),
    lineas: esquemaEtapaMatriz,
  })
  .describe('Datos de un corte de orden (color×talla, D4; sobre-corte libre).');

/** Datos validados de alta de corte. */
export type DatosCorteCrear = z.infer<typeof esquemaCorteCrear>;

// ── Empaque (servicio sobre la orden, hermano del corte — 0.114) ────────────────────────────────

/**
 * Alta de un EMPAQUE de una orden (0.114). Calcado del corte y por la MISMA razón: Daniel dictó que
 * *«el empaque no toca el inventario»* y que *«una maquila de empaque»* se paga desde la orden. Así
 * que `idTipoProceso` va NULL (no es maquila: no hay envío ni recibo) e `idTercero` es el EMPACADOR
 * (Proveedor con rol `empaque`).
 *
 * ⭐ LA CANTIDAD ES PROPIA, no se deriva del recibo (regla de C&A que dictó Daniel): se fabrican
 * 1,000 y se empacan 990 — se paga lo empacado y las 10 restantes se quedan quietas en inventario.
 * Por eso el servidor NO topa el empaque contra lo recibido ni contra lo cortado (igual que el
 * sobre-corte libre, decisión (f)): la pantalla puede AVISAR, el servidor acepta.
 */
export const esquemaEmpaqueCrear = z
  .object({
    idOrden: z
      .number({ error: 'La orden es obligatoria' })
      .int({ error: 'El id de la orden debe ser entero' })
      .positive({ error: 'El id de la orden debe ser positivo' }),
    idEmpacador: z
      .number({ error: 'El empacador es obligatorio' })
      .int({ error: 'El id del empacador debe ser entero' })
      .positive({ error: 'El id del empacador debe ser positivo' })
      .describe('Proveedor con rol "empaque".'),
    fecha: z.iso
      .date({ error: 'La fecha del empaque es obligatoria (YYYY-MM-DD)' })
      .describe('Fecha del empaque (YYYY-MM-DD).'),
    precioPactado: esquemaPrecioServicio
      .nullish()
      .describe('Precio por prenda pactado con el empacador (base de su cargo EsMa), opcional.'),
    observaciones: z.string().trim().max(1000).optional(),
    lineas: esquemaEtapaMatriz,
  })
  .describe('Datos de un empaque de orden (color×talla, D4; cantidad propia, sin tope).');

/** Datos validados de alta de empaque. */
export type DatosEmpaqueCrear = z.infer<typeof esquemaEmpaqueCrear>;

// ── Envío a maquila (UN servicio para costura Y estampado) ──────────────────────────────────────

/**
 * Alta de un ENVÍO a maquila (doc 03-Produccion Paso 4 + flujo paralelo de estampado, Observación
 * 4). UN solo esquema parametrizado por `idTipoProceso` (costura/estampado/bordado/lavado, D8).
 * `idTercero` es el MAQUILERO/ESTAMPADOR (Proveedor con el rol que mapea al proceso). Sobre-envío
 * ESTRICTO (g): el servidor bloquea si excede el cortado disponible para ese proceso.
 */
export const esquemaEnvioCrear = z
  .object({
    idOrden: z
      .number({ error: 'La orden es obligatoria' })
      .int({ error: 'El id de la orden debe ser entero' })
      .positive({ error: 'El id de la orden debe ser positivo' }),
    idTipoProceso: z
      .number({ error: 'El tipo de proceso es obligatorio' })
      .int({ error: 'El id del tipo de proceso debe ser entero' })
      .positive({ error: 'El id del tipo de proceso debe ser positivo' })
      .describe('Proceso de maquila (costura/estampado/…).'),
    idMaquilero: z
      .number({ error: 'El maquilero es obligatorio' })
      .int({ error: 'El id del maquilero debe ser entero' })
      .positive({ error: 'El id del maquilero debe ser positivo' })
      .describe('Proveedor con el rol que mapea al proceso.'),
    fecha: z.iso
      .date({ error: 'La fecha del envío es obligatoria (YYYY-MM-DD)' })
      .describe('Fecha del envío (YYYY-MM-DD).'),
    fechaCompromiso: z.iso
      .date({ error: 'La fecha compromiso debe ser YYYY-MM-DD' })
      .nullish()
      .describe('Fecha compromiso del maquilero (YYYY-MM-DD), opcional.'),
    precioPactado: z
      .number({ error: 'El precio pactado debe ser un número' })
      .min(0, { error: 'El precio pactado no puede ser negativo' })
      .nullish()
      .describe('Precio de maquila pactado (base del cargo EsMa), opcional.'),
    prendaTerminada: z
      .boolean()
      .default(false)
      .describe(
        'Las prendas que se mandan YA son producto terminado (proceso DESPUÉS de costura, §Post-F9.61): el envío las SACA de `idAlmacenOrigen` hacia el almacén de tránsito y su recibo las devuelve.',
      ),
    idAlmacenOrigen: z
      .number({ error: 'El almacén de origen debe ser un número' })
      .int({ error: 'El id del almacén debe ser entero' })
      .positive({ error: 'El id del almacén debe ser positivo' })
      .optional()
      .describe('Almacén de PT del que salen las prendas. OBLIGATORIO si `prendaTerminada`.'),
    stockSinOrden: z
      .boolean()
      .default(false)
      .describe(
        'Las prendas salen del bucket de existencia «sin orden asignada» (`id_orden = NULL`: histórico migrado e inventario físico de arranque) en vez del bucket de su orden. Solo aplica con `prendaTerminada`.',
      ),
    observaciones: z.string().trim().max(1000).optional(),
    lineas: esquemaEtapaMatriz,
  })
  .describe('Datos de un envío a maquila (color×talla, D4; sobre-envío estricto).');

/** Datos validados de alta de envío. */
export type DatosEnvioCrear = z.infer<typeof esquemaEnvioCrear>;

// ── Cancelación de etapa (corte o envío) ────────────────────────────────────────────────────────

/** Cuerpo de la cancelación de una etapa (motivo obligatorio, A7). */
export const esquemaEtapaCancelarCuerpo = z
  .object({
    motivo: z
      .string({ error: 'El motivo es obligatorio' })
      .trim()
      .min(3, { error: 'Explica el motivo (mínimo 3 caracteres)' })
      .max(500, { error: 'El motivo no puede tener más de 500 caracteres' }),
  })
  .describe('Motivo de la cancelación de la etapa.');

/** Datos validados de la cancelación. */
export type DatosEtapaCancelar = z.infer<typeof esquemaEtapaCancelarCuerpo>;

// ── Salida de una etapa (corte/envío) ───────────────────────────────────────────────────────────

/** Una talla con su cantidad en la salida de una etapa. */
const esquemaEtapaTallaSalida = z.object({
  idTalla: z.number().int().describe('Id de la talla.'),
  etiquetaTalla: z.string().describe('Etiqueta visible de la talla.'),
  cantidad: z.number().int().describe('Cantidad de la talla.'),
});

/** Un renglón color×talla en la salida de una etapa, con total derivado. */
const esquemaEtapaLineaSalida = z.object({
  idColor: z.number().int().describe('Id del color.'),
  color: z.string().describe('Nombre del color.'),
  pack: esquemaPackSalida.describe(
    'PACK / TENDIDO de este renglón (§Post-F9.10). CADENA VACÍA = sin pack.',
  ),
  tallas: z.array(esquemaEtapaTallaSalida).describe('Cantidades por talla.'),
  totalPiezas: z.number().int().describe('Total del renglón (derivado por suma).'),
});

/** Salida de una etapa (corte/envío): encabezado + matriz + total. Parte del contrato OpenAPI. */
export const esquemaEtapaSalida = z
  .object({
    id: z.number().int().describe('Id de la etapa.'),
    folio: z.number().int().describe('Folio consecutivo por empresa (A3).'),
    idEmpresa: z.number().int().describe('Empresa dueña (A9).'),
    idOrden: z.number().int().describe('Orden a la que pertenece.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    tipo: z
      .enum(['corte', 'envio_maquila', 'recibo_maquila', 'entrega_cliente', 'empaque'])
      .describe('Tipo de etapa.'),
    idTipoProceso: z
      .number()
      .int()
      .nullable()
      .describe('Proceso de maquila (null en corte y empaque: son servicios sobre la orden).'),
    tipoProceso: z.string().nullable().describe('Nombre del proceso (null en corte y empaque).'),
    idTercero: z.number().int().nullable().describe('Cortador/maquilero/empacador (Proveedor).'),
    tercero: z.string().nullable().describe('Nombre del cortador/maquilero/empacador.'),
    fecha: z.string().describe('Fecha de la etapa (YYYY-MM-DD).'),
    fechaCompromiso: z.string().nullable().describe('Fecha compromiso (YYYY-MM-DD) o null.'),
    precioPactado: z
      .number()
      .nullable()
      .describe(
        'Precio pactado, o null. REDACTADO (null) sin `ordenes.ver-precio-real-maquila` (R2 §4.4.3: es el precio real de maquila de la etapa).',
      ),
    prendaTerminada: z
      .boolean()
      .describe(
        'Envío de prendas YA TERMINADAS (V1-E4b): salieron del almacén hacia el tránsito. Siempre false en corte/recibo/entrega.',
      ),
    idAlmacenOrigen: z
      .number()
      .int()
      .nullable()
      .describe('Almacén de PT del que salieron las prendas (solo envíos de prenda terminada).'),
    almacenOrigen: z.string().nullable().describe('Nombre del almacén de origen o null.'),
    stockSinOrden: z
      .boolean()
      .describe(
        'Las prendas salieron del bucket «sin orden asignada» (V1-E4b). Siempre false en el resto.',
      ),
    observaciones: z.string().nullable().describe('Observaciones o null.'),
    cancelado: z.boolean().describe('Si la etapa está cancelada (suave).'),
    canceladoEn: z.iso.datetime().nullable().describe('Cuándo se canceló (ISO) o null.'),
    canceladoPorId: z.string().nullable().describe('Id del usuario que canceló o null.'),
    motivoCancelacion: z.string().nullable().describe('Motivo de cancelación o null.'),
    lineas: z.array(esquemaEtapaLineaSalida).describe('Matriz color×talla de la etapa.'),
    totalPiezas: z.number().int().describe('Total de piezas de la etapa (derivado).'),
    creadoEn: z.iso.datetime().describe('Fecha de captura (ISO).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la capturó.'),
    creadoPorNombre: z
      .string()
      .nullable()
      .describe('Nombre de quien la capturó (rediseño R2, §4.4.4: "capturado por · fecha").'),
  })
  .describe('Etapa de producción (corte/envío) con su matriz color×talla.');

/** Forma de una etapa tal como la devuelve la API. */
export type EtapaSalida = z.infer<typeof esquemaEtapaSalida>;

/**
 * Historial de etapas de una orden (F3-E2): cortes Y envíos, VIVOS y CANCELADOS (las canceladas se
 * conservan como historial, marcadas). Cada etapa lleva su matriz color×talla y su estado de
 * cancelación. Es lo que las pantallas de captura muestran para poder CANCELAR una etapa con motivo.
 */
export const esquemaEtapasOrdenLista = z
  .object({
    idOrden: z.number().int().describe('Orden.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    etapas: z
      .array(esquemaEtapaSalida)
      .describe('Cortes y envíos de la orden (vivos y cancelados).'),
  })
  .describe('Historial de etapas (corte/envío) de una orden.');

/** Forma del historial de etapas de una orden tal como lo devuelve la API. */
export type EtapasOrdenLista = z.infer<typeof esquemaEtapasOrdenLista>;

/**
 * Filtros del historial de etapas (rediseño R2 — Avance de producción): `incluirRecibos` suma los
 * RECIBOS de maquila (F3-E4) a la lista, para que el stepper de 5 etapas pinte también los
 * movimientos de recibo. Default `false` (comportamiento F3-E2 intacto para las pantallas viejas).
 */
export const esquemaEtapasOrdenQuery = z
  .object({
    incluirRecibos: z
      .stringbool()
      .default(false)
      .describe('Incluye los recibos de maquila en el historial (Avance de producción, R2).'),
  })
  .describe('Filtros del historial de etapas de una orden.');

/** Parámetros del historial ya coaccionados. */
export type EtapasOrdenQuery = z.infer<typeof esquemaEtapasOrdenQuery>;

// ── Pendientes por orden (derivados, sin acumuladores) ──────────────────────────────────────────

/**
 * Pendiente de UNA celda color×talla×PACK, para una etapa concreta. El pack entra en la LLAVE de la
 * celda (§Post-F9.10): sin él, la pantalla ofrecería un tope agregado por color que el servidor
 * rechaza pack por pack al enviar (sobre-envío ESTRICTO, decisión (g)). En una orden sin packs va
 * vacío y la celda es la de siempre.
 */
const esquemaPendienteCelda = z.object({
  idColor: z.number().int().describe('Id del color.'),
  color: z.string().describe('Nombre del color.'),
  pack: esquemaPackSalida.describe('PACK de la celda. CADENA VACÍA = la orden no maneja packs.'),
  idTalla: z.number().int().describe('Id de la talla.'),
  etiquetaTalla: z.string().describe('Etiqueta visible de la talla.'),
  cantidad: z.number().int().describe('Cantidad pendiente (puede ser negativa por sobre-corte).'),
});

/** Pendiente de un proceso de maquila: cuánto cortado falta por enviar a ESE proceso. */
const esquemaPendientePorEnviar = z.object({
  idTipoProceso: z.number().int().describe('Id del tipo de proceso.'),
  tipoProceso: z.string().describe('Nombre del proceso.'),
  codigoProceso: z.string().describe('Código del proceso (kebab-case).'),
  celdas: z
    .array(esquemaPendienteCelda)
    .describe('cortado − enviado a este proceso, por color×talla.'),
  totalPendiente: z.number().int().describe('Total pendiente por enviar a este proceso.'),
});

/**
 * Pendientes DERIVADOS de una orden (form `Proceso` del viejo, sin acumuladores). `porCortar` =
 * Σ orden − Σ corte (puede ser negativo por sobre-corte; se muestra tal cual). `cortadoPorEnviar`
 * = Σ corte − Σ enviado a ese proceso, por cada proceso ya enviado a la orden.
 */
export const esquemaPendientesOrden = z
  .object({
    idOrden: z.number().int().describe('Orden.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    porCortar: z
      .array(esquemaPendienteCelda)
      .describe('orden − corte, por color×talla (negativo si hubo sobre-corte).'),
    totalPorCortar: z.number().int().describe('Total por cortar (derivado).'),
    cortadoTotal: z.number().int().describe('Total cortado de la orden (derivado).'),
    cortadoPorEnviar: z
      .array(esquemaPendientePorEnviar)
      .describe('cortado − enviado, por proceso ya usado en la orden.'),
  })
  .describe('Pendientes derivados de una orden (corte y envío).');

/** Forma de los pendientes de una orden tal como los devuelve la API. */
export type PendientesOrden = z.infer<typeof esquemaPendientesOrden>;

// ── Sugerencia de captura: "corte completo" / "lo que se cortó" (V1-E8i, §Post-F9.131) ─────────

/**
 * El veredicto de la sugerencia: `'hay'` (sí se puede precargar) y las **cuatro** razones por las que
 * no. Es un dato del DOMINIO, no un texto de pantalla: la razón la decide el servidor (que es quien
 * sabe cuánto se pidió, se cortó y se envió) y la pantalla solo la traduce a palabras de taller. Sin
 * esto, el botón se quedaría mudo y el usuario no sabría si falla el sistema o es que de verdad ya
 * no queda nada.
 */
export const MOTIVOS_SUGERENCIA = [
  'hay',
  'orden-sin-matriz',
  'todo-cortado',
  'nada-cortado',
  'todo-enviado',
] as const;

/** Una celda color×talla×PACK que la captura puede precargar (siempre positiva). */
const esquemaCeldaSugerida = z.object({
  idColor: z.number().int().describe('Id del color.'),
  color: z.string().describe('Nombre del color.'),
  pack: esquemaPackSalida.describe('PACK de la celda. CADENA VACÍA = la orden no maneja packs.'),
  idTalla: z.number().int().describe('Id de la talla.'),
  etiquetaTalla: z.string().describe('Etiqueta visible de la talla.'),
  cantidad: z.number().int().positive().describe('Cantidad sugerida para esta celda (> 0).'),
});

/**
 * Lo que un botón de precarga puede llenar en la captura de una etapa (V1-E8i). NO guarda nada:
 * es el atajo de captura que pidió Daniel para no teclear talla por talla lo que casi siempre es
 * exactamente lo esperado.
 *
 *  • base `corte` → lo que FALTA POR CORTAR = Σ orden − Σ corte, por celda, sin negativos. Con la
 *    orden todavía sin cortar es exactamente "lo que se ordenó", que es lo que pidió Daniel; con un
 *    corte parcial ya capturado es lo que falta, que es lo único que se puede cortar de nuevo sin
 *    duplicar piezas.
 *  • base `envio` → lo que se puede ENVIAR TODAVÍA a ESE proceso = Σ corte − Σ enviado a ese
 *    proceso, por celda, sin negativos. Respeta la decisión (g) (sobre-envío ESTRICTO): precargar
 *    el bruto cortado tras un primer envío parcial produciría un guardado que el servidor rechaza.
 */
export const esquemaSugerenciaCaptura = z
  .object({
    idOrden: z.number().int().describe('Orden.'),
    base: z
      .enum(['corte', 'envio'])
      .describe('Qué captura se precarga: el corte o el envío a un proceso.'),
    idTipoProceso: z
      .number()
      .int()
      .nullable()
      .describe('Proceso al que se enviaría (null cuando la base es el corte).'),
    celdas: z
      .array(esquemaCeldaSugerida)
      .describe('Celdas color×talla a precargar (solo las positivas).'),
    total: z.number().int().describe('Suma de las celdas sugeridas.'),
    motivo: z
      .enum(MOTIVOS_SUGERENCIA)
      .describe(
        'hay = sí hay qué precargar; el resto explica por qué no (orden sin matriz color×talla, ' +
          'ya se cortó todo, todavía no se corta nada, o ya se envió todo lo cortado).',
      ),
  })
  .describe('Qué puede precargar el botón de captura de una etapa (no guarda nada).');

/** Forma de la sugerencia de captura tal como la devuelve la API. */
export type SugerenciaCaptura = z.infer<typeof esquemaSugerenciaCaptura>;

/** Filtros de la sugerencia de captura (querystring): el proceso al que se enviaría, si aplica. */
export const esquemaSugerenciaCapturaQuery = z
  .object({
    idTipoProceso: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Proceso de maquila al que se enviaría. Sin él, la sugerencia es la del CORTE.'),
  })
  .describe('Filtros de la sugerencia de captura de una etapa.');

/** Parámetros de la sugerencia de captura ya coaccionados. */
export type SugerenciaCapturaQuery = z.infer<typeof esquemaSugerenciaCapturaQuery>;

// ── Corte semanal por cortador ──────────────────────────────────────────────────────────────────

/** Filtros del reporte de corte semanal (querystring). */
export const esquemaCorteSemanalQuery = z
  .object({
    desde: z.iso.date().optional().describe('Fecha inicial (YYYY-MM-DD), inclusiva.'),
    hasta: z.iso.date().optional().describe('Fecha final (YYYY-MM-DD), inclusiva.'),
    idCortador: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por un cortador concreto (Proveedor).'),
  })
  .describe('Filtros del corte semanal por cortador.');

/** Parámetros del corte semanal ya coaccionados. */
export type CorteSemanalQuery = z.infer<typeof esquemaCorteSemanalQuery>;

/** Una fila del corte semanal: un cortador en una semana, con su total cortado. */
const esquemaCorteSemanalFila = z.object({
  idCortador: z.number().int().nullable().describe('Cortador (Proveedor) o null si no se asignó.'),
  cortador: z.string().describe('Nombre del cortador (o "Sin asignar").'),
  anioSemana: z.string().describe('Año-semana ISO (p. ej. "2026-W25").'),
  inicioSemana: z.string().describe('Lunes de la semana (YYYY-MM-DD).'),
  totalCortado: z.number().int().describe('Piezas cortadas (suma de las etapas vivas).'),
  numCortes: z.number().int().describe('Número de cortes capturados esa semana.'),
});

/** Respuesta del corte semanal por cortador (agrupado, ya derivado). */
export const esquemaCorteSemanalLista = z
  .object({
    filas: z.array(esquemaCorteSemanalFila).describe('Cortador × semana con su total cortado.'),
  })
  .describe('Corte semanal por cortador.');

/** Forma del corte semanal tal como lo devuelve la API. */
export type CorteSemanalLista = z.infer<typeof esquemaCorteSemanalLista>;
