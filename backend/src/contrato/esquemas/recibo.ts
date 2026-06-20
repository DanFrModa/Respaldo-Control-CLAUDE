import { z } from 'zod';

/**
 * Esquemas Zod del RECIBO de maquila (F3-E4; doc 03-Produccion Paso 5 "Recibo" + flujo paralelo de
 * estampado). UNA sola definición de reglas para UI y servidor (alimenta el OpenAPI). El recibo es
 * la etapa ⭐ central de F3: de UNA captura se derivan varios efectos según el `TipoProceso`
 * (costura: WIP + entrada a PT + cargo EsMa; estampado/bordado/lavado: WIP + cargo EsMa, sin tocar
 * inventario). El detalle es SIEMPRE color×talla (D4), con su CALIDAD (primeras/segundas).
 *
 * Reglas de negocio (la AUTORIDAD es el dominio; estos esquemas solo cuidan la forma):
 *  • `recibido ≤ enviado` ESTRICTO por orden+proceso (decisión (g)): el dominio lo valida por suma
 *    directa de `EtapaMovimientoDet` bajo bloqueo.
 *  • Calidad primeras/segundas SEPARADA del almacén destino. Si una celda trae desglose, debe sumar
 *    el total recibido de la celda (lo valida el dominio).
 *  • El almacén destino (primeras/segundas) SOLO aplica cuando el proceso genera entrada a PT
 *    (costura). NO hay bandera "Inventariado": recibir = ya queda en inventario (mejora A1).
 */

// ── Renglón color×talla con calidad (primeras/segundas) ──────────────────────────────────────────

/**
 * Una talla recibida dentro de un color (D4). `cantidad` = total recibido (entera ≥ 0). Opcional el
 * desglose de calidad: `cantidadPrimeras` (buenas) + `cantidadSegundas` (defectuosas). Si se manda
 * el desglose, ambas son enteras ≥ 0 y suman `cantidad` (lo cierra el dominio).
 */
const esquemaReciboTalla = z.object({
  idTalla: z
    .number({ error: 'El id de la talla es obligatorio' })
    .int({ error: 'El id de la talla debe ser entero' })
    .positive({ error: 'El id de la talla debe ser positivo' }),
  cantidad: z
    .number({ error: 'La cantidad es obligatoria' })
    .int({ error: 'La cantidad debe ser entera' })
    .min(0, { error: 'La cantidad no puede ser negativa' }),
  cantidadPrimeras: z
    .number()
    .int({ error: 'Las primeras deben ser un entero' })
    .min(0, { error: 'Las primeras no pueden ser negativas' })
    .optional()
    .describe('Piezas de PRIMERA (buenas) de esta talla. Opcional; default = toda la cantidad.'),
  cantidadSegundas: z
    .number()
    .int({ error: 'Las segundas deben ser un entero' })
    .min(0, { error: 'Las segundas no pueden ser negativas' })
    .optional()
    .describe('Piezas de SEGUNDA (defectuosas) de esta talla. Opcional; default 0.'),
});

/** Un renglón de la matriz del recibo: un color con sus cantidades por talla (D4). */
const esquemaReciboLinea = z.object({
  idColor: z
    .number({ error: 'El id del color es obligatorio' })
    .int({ error: 'El id del color debe ser entero' })
    .positive({ error: 'El id del color debe ser positivo' }),
  tallas: z
    .array(esquemaReciboTalla)
    .min(1, { error: 'Cada color necesita al menos una talla' })
    .describe('Cantidades por talla de este color.'),
});

/** La matriz color×talla de un recibo (al menos un color). */
const esquemaReciboMatriz = z
  .array(esquemaReciboLinea)
  .min(1, { error: 'Captura al menos un color con sus tallas' })
  .describe('Matriz color×talla del recibo (D4) con su calidad.');

/** Un renglón de la matriz del recibo tal como lo recibe el dominio. */
export type DatosReciboLineaEntrada = z.infer<typeof esquemaReciboLinea>;

// ── Alta de un recibo de maquila ─────────────────────────────────────────────────────────────────

/**
 * Alta de un RECIBO de maquila (doc 03-Produccion Paso 5). UN solo esquema parametrizado por
 * `idTipoProceso` (costura/estampado/…). `idMaquilero` es el Proveedor con el rol del proceso. Los
 * almacenes destino (primeras/segundas) SOLO se usan si el proceso genera entrada a PT (costura);
 * para los demás procesos se ignoran. `idEtapaEnvio` liga OPCIONALMENTE el recibo a un envío
 * concreto (decisión (d), reversible).
 */
export const esquemaReciboCrear = z
  .object({
    idOrden: z
      .number({ error: 'La orden es obligatoria' })
      .int({ error: 'El id de la orden debe ser entero' })
      .positive({ error: 'El id de la orden debe ser positivo' }),
    idTipoProceso: z
      .number({ error: 'El tipo de proceso es obligatorio' })
      .int({ error: 'El id del tipo de proceso debe ser entero' })
      .positive({ error: 'El id del tipo de proceso debe ser positivo' })
      .describe('Proceso de maquila que se recibe (costura/estampado/…).'),
    idMaquilero: z
      .number({ error: 'El maquilero es obligatorio' })
      .int({ error: 'El id del maquilero debe ser entero' })
      .positive({ error: 'El id del maquilero debe ser positivo' })
      .describe('Proveedor con el rol que mapea al proceso.'),
    fecha: z.iso
      .date({ error: 'La fecha del recibo es obligatoria (YYYY-MM-DD)' })
      .describe('Fecha del recibo (YYYY-MM-DD).'),
    idEtapaEnvio: z
      .number()
      .int({ error: 'El id del envío debe ser entero' })
      .positive({ error: 'El id del envío debe ser positivo' })
      .optional()
      .describe('Liga opcional al envío que se recibe (mismo orden+proceso).'),
    idAlmacenPrimeras: z
      .number()
      .int({ error: 'El id del almacén de primeras debe ser entero' })
      .positive({ error: 'El id del almacén de primeras debe ser positivo' })
      .optional()
      .describe('Almacén destino de las primeras (solo si el proceso mete a PT — costura).'),
    idAlmacenSegundas: z
      .number()
      .int({ error: 'El id del almacén de segundas debe ser entero' })
      .positive({ error: 'El id del almacén de segundas debe ser positivo' })
      .optional()
      .describe('Almacén destino de las segundas (solo si el proceso mete a PT — costura).'),
    precioPactado: z
      .number({ error: 'El precio pactado debe ser un número' })
      .min(0, { error: 'El precio pactado no puede ser negativo' })
      .nullish()
      .describe('Precio de maquila (base del cargo EsMa). Opcional; suele heredarse del envío.'),
    observaciones: z.string().trim().max(1000).optional(),
    lineas: esquemaReciboMatriz,
  })
  .describe('Datos de un recibo de maquila (color×talla con calidad, D4).');

/** Datos validados de alta de recibo. */
export type DatosReciboCrear = z.infer<typeof esquemaReciboCrear>;

// ── Cancelación de un recibo ─────────────────────────────────────────────────────────────────────

/** Cuerpo de la cancelación de un recibo (motivo obligatorio, A7). */
export const esquemaReciboCancelarCuerpo = z
  .object({
    motivo: z
      .string({ error: 'El motivo es obligatorio' })
      .trim()
      .min(3, { error: 'Explica el motivo (mínimo 3 caracteres)' })
      .max(500, { error: 'El motivo no puede tener más de 500 caracteres' }),
  })
  .describe('Motivo de la cancelación del recibo.');

/** Datos validados de la cancelación. */
export type DatosReciboCancelar = z.infer<typeof esquemaReciboCancelarCuerpo>;

// ── Salida de un recibo (encabezado + matriz con calidad) ────────────────────────────────────────

/** Una talla con su cantidad y calidad en la salida de un recibo. */
const esquemaReciboTallaSalida = z.object({
  idTalla: z.number().int().describe('Id de la talla.'),
  etiquetaTalla: z.string().describe('Etiqueta visible de la talla.'),
  cantidad: z.number().int().describe('Total recibido de la talla.'),
  cantidadPrimeras: z.number().int().nullable().describe('Primeras (buenas) o null.'),
  cantidadSegundas: z.number().int().nullable().describe('Segundas (defectuosas) o null.'),
});

/** Un renglón color×talla en la salida de un recibo, con totales derivados. */
const esquemaReciboLineaSalida = z.object({
  idColor: z.number().int().describe('Id del color.'),
  color: z.string().describe('Nombre del color.'),
  tallas: z.array(esquemaReciboTallaSalida).describe('Cantidades por talla (con calidad).'),
  totalPiezas: z.number().int().describe('Total del renglón (derivado por suma).'),
});

/** Salida de un recibo de maquila: encabezado + matriz + totales. Parte del contrato OpenAPI. */
export const esquemaReciboSalida = z
  .object({
    id: z.number().int().describe('Id del recibo (EtapaMovimiento).'),
    folio: z.number().int().describe('Folio consecutivo por empresa (A3).'),
    idEmpresa: z.number().int().describe('Empresa dueña (A9).'),
    idOrden: z.number().int().describe('Orden a la que pertenece.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    idTipoProceso: z.number().int().nullable().describe('Proceso de maquila.'),
    tipoProceso: z.string().nullable().describe('Nombre del proceso.'),
    generaEntradaPt: z
      .boolean()
      .describe('Si el proceso del recibo metió las primeras/segundas a inventario PT.'),
    idTercero: z.number().int().nullable().describe('Maquilero/estampador (Proveedor).'),
    tercero: z.string().nullable().describe('Nombre del maquilero/estampador.'),
    idEtapaEnvio: z.number().int().nullable().describe('Envío ligado (opcional) o null.'),
    idAlmacenPrimeras: z.number().int().nullable().describe('Almacén destino de primeras o null.'),
    almacenPrimeras: z.string().nullable().describe('Nombre del almacén de primeras o null.'),
    idAlmacenSegundas: z.number().int().nullable().describe('Almacén destino de segundas o null.'),
    almacenSegundas: z.string().nullable().describe('Nombre del almacén de segundas o null.'),
    fecha: z.string().describe('Fecha del recibo (YYYY-MM-DD).'),
    precioPactado: z.number().nullable().describe('Precio pactado o null.'),
    observaciones: z.string().nullable().describe('Observaciones o null.'),
    cancelado: z.boolean().describe('Si el recibo está cancelado (suave).'),
    canceladoEn: z.iso.datetime().nullable().describe('Cuándo se canceló (ISO) o null.'),
    canceladoPorId: z.string().nullable().describe('Id del usuario que canceló o null.'),
    motivoCancelacion: z.string().nullable().describe('Motivo de cancelación o null.'),
    idMovimientoEntrada: z
      .number()
      .int()
      .nullable()
      .describe(
        'PRIMER movimiento de kardex (entrada a PT) generado por el recibo de costura, o null si ' +
          'no metió a PT. Un recibo con primeras Y segundas genera DOS movimientos de entrada (uno ' +
          'por almacén); este campo expone solo el primero como indicador de "sí metió a PT".',
      ),
    lineas: z.array(esquemaReciboLineaSalida).describe('Matriz color×talla del recibo.'),
    totalPiezas: z.number().int().describe('Total recibido (derivado).'),
    totalPrimeras: z.number().int().describe('Total de primeras (derivado).'),
    totalSegundas: z.number().int().describe('Total de segundas (derivado).'),
    creadoEn: z.iso.datetime().describe('Fecha de captura (ISO).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que lo capturó.'),
  })
  .describe('Recibo de maquila con su matriz color×talla y calidad.');

/** Forma de un recibo tal como lo devuelve la API. */
export type ReciboSalida = z.infer<typeof esquemaReciboSalida>;

// ── Pendientes por recibir (derivados: enviado − recibido por orden+proceso) ─────────────────────

/** Pendiente de UNA celda color×talla. */
const esquemaPendienteRecibirCelda = z.object({
  idColor: z.number().int().describe('Id del color.'),
  color: z.string().describe('Nombre del color.'),
  idTalla: z.number().int().describe('Id de la talla.'),
  etiquetaTalla: z.string().describe('Etiqueta visible de la talla.'),
  cantidad: z.number().int().describe('Pendiente por recibir (enviado − recibido).'),
});

/** Pendiente por recibir de un proceso de maquila: enviado − recibido a ESE proceso. */
const esquemaPendienteRecibirProceso = z.object({
  idTipoProceso: z.number().int().describe('Id del tipo de proceso.'),
  tipoProceso: z.string().describe('Nombre del proceso.'),
  codigoProceso: z.string().describe('Código del proceso (kebab-case).'),
  generaEntradaPt: z.boolean().describe('Si el recibo de este proceso mete a PT.'),
  celdas: z
    .array(esquemaPendienteRecibirCelda)
    .describe('enviado − recibido a este proceso, por color×talla (solo celdas ≠ 0).'),
  totalPendiente: z.number().int().describe('Total pendiente por recibir de este proceso.'),
});

/**
 * Pendientes por recibir DERIVADOS de una orden (form `Proceso` del viejo, sin acumuladores): por
 * cada proceso ya enviado a la orden, enviado − recibido a ESE proceso, por color×talla. Las etapas
 * canceladas NO cuentan.
 */
export const esquemaPendientesRecibir = z
  .object({
    idOrden: z.number().int().describe('Orden.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    porRecibir: z
      .array(esquemaPendienteRecibirProceso)
      .describe('enviado − recibido, por proceso ya usado en la orden.'),
  })
  .describe('Pendientes por recibir derivados de una orden (por proceso).');

/** Forma de los pendientes por recibir tal como los devuelve la API. */
export type PendientesRecibir = z.infer<typeof esquemaPendientesRecibir>;

// ── Recibos semanales por maquilero ──────────────────────────────────────────────────────────────

/** Filtros del reporte de recibos semanales (querystring). */
export const esquemaRecibosSemanalesQuery = z
  .object({
    desde: z.iso.date().optional().describe('Fecha inicial (YYYY-MM-DD), inclusiva.'),
    hasta: z.iso.date().optional().describe('Fecha final (YYYY-MM-DD), inclusiva.'),
    idMaquilero: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por un maquilero concreto (Proveedor).'),
  })
  .describe('Filtros de los recibos semanales por maquilero.');

/** Parámetros de los recibos semanales ya coaccionados. */
export type RecibosSemanalesQuery = z.infer<typeof esquemaRecibosSemanalesQuery>;

/** Una fila de los recibos semanales: un maquilero en una semana, con su total recibido. */
const esquemaRecibosSemanalesFila = z.object({
  idMaquilero: z.number().int().nullable().describe('Maquilero (Proveedor) o null.'),
  maquilero: z.string().describe('Nombre del maquilero (o "Sin asignar").'),
  anioSemana: z.string().describe('Año-semana ISO (p. ej. "2026-W25").'),
  inicioSemana: z.string().describe('Lunes de la semana (YYYY-MM-DD).'),
  totalRecibido: z.number().int().describe('Piezas recibidas (suma de los recibos vivos).'),
  totalPrimeras: z.number().int().describe('Piezas de primera recibidas.'),
  totalSegundas: z.number().int().describe('Piezas de segunda recibidas.'),
  numRecibos: z.number().int().describe('Número de recibos capturados esa semana.'),
});

/** Respuesta de los recibos semanales por maquilero (agrupado, ya derivado). */
export const esquemaRecibosSemanalesLista = z
  .object({
    filas: z
      .array(esquemaRecibosSemanalesFila)
      .describe('Maquilero × semana con su total recibido.'),
  })
  .describe('Recibos semanales por maquilero.');

/** Forma de los recibos semanales tal como los devuelve la API. */
export type RecibosSemanalesLista = z.infer<typeof esquemaRecibosSemanalesLista>;
