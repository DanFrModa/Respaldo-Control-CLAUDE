import { z } from 'zod';

import { esquemaPackSalida } from './pack.js';

/**
 * ⭐ CERRAR LA ORDEN CON UN MAQUILERO (V1, fila 0.109; DANIEL 3-sep-2026). El acto que salda la
 * CUARTA CUBETA de §Post-F9.147 —el FALTANTE— y, si se decide cobrarlo, PROPONE el descuento.
 *
 * DANIEL, con sus palabras: *«un botón de cerrar la orden»*, que *«se cierra por orden»*, que **lo
 * aprieta quien recibe** (no él), que **salda siempre el pendiente** y que **propone** el cobro
 * esperando su visto bueno — *nunca cobra solo*. Dos desenlaces, y los dos limpian la lista:
 * **cerrado y cobrado** o **cerrado y perdonado**.
 *
 * 🔑 QUÉ ES UN FALTANTE, y por qué no es una incompleta (§Post-F9.147): *«de 1000 entrego 995 y
 * faltan 5»* — la prenda **nunca volvió**, sigue en poder del maquilero y **se le cobra**. La
 * INCOMPLETA sí volvió (*«regreso las 5 sin confeccionar, pero ahí están»*) y NO se cobra: ésa ya
 * tiene su columna desde V1-E8k. Lo que las separa es una sola pregunta: ¿volvió la prenda?
 *
 * 🔑 POR QUÉ EL COBRO ES UN **DESCUENTO** Y NO UN CARGO: el signo. `saldo = Σcargos + Σabonos −
 * Σpagos − Σdescuentos` (`esma/formula-saldo.ts`), o sea que un CARGO SUBE lo que se le debe al
 * maquilero — le pagaría las prendas que no devolvió. Cobrarle BAJA lo que se le debe, que es un
 * descuento, y es la palabra que usó Daniel: *«se le quita a mando (normalmente **descontandole**
 * esas prendas faltantes)»*. Nace `capturado`, así que **no cuenta al saldo** hasta que alguien lo
 * revisa en el estado de cuenta: ahí está el *«esperando su visto bueno»*, con el flujo que ya
 * existía (`esma.modificar`), sin pantalla nueva.
 */

// ── Cerrar ───────────────────────────────────────────────────────────────────────────────────────

/** Los dos desenlaces de un cierre. Los dos saldan el pendiente. */
export const DESENLACES_CIERRE_MAQUILA = ['cobrado', 'perdonado'] as const;

/** Desenlace de un cierre de orden con un maquilero. */
export type DesenlaceCierreMaquilaClave = (typeof DESENLACES_CIERRE_MAQUILA)[number];

/**
 * Cuerpo de «cerrar la orden» con UN maquilero de UN proceso. El QUÉ se salda no se manda: lo
 * DERIVA el servidor por suma directa bajo bloqueo (D3) — mandarlo desde el cliente sería dejar que
 * la pantalla decidiera cuántas piezas se cobran.
 *
 * `motivo` es OBLIGATORIO al **perdonar**: perdonar dinero sin decir por qué es justo lo que una
 * auditoría no puede aceptar. Al cobrar es opcional (la nota del cierre).
 */
export const esquemaCierreMaquilaCrear = z
  .object({
    idMaquilero: z
      .number({ error: 'El maquilero es obligatorio' })
      .int({ error: 'El id del maquilero debe ser entero' })
      .positive({ error: 'El id del maquilero debe ser positivo' })
      .describe('Maquilero con el que se cierra la orden (Proveedor).'),
    idTipoProceso: z
      .number({ error: 'El tipo de proceso es obligatorio' })
      .int({ error: 'El id del tipo de proceso debe ser entero' })
      .positive({ error: 'El id del tipo de proceso debe ser positivo' })
      .describe('Proceso cuyo saldo se cierra (costura/estampado/…).'),
    fecha: z.iso
      .date({ error: 'La fecha del cierre es obligatoria (YYYY-MM-DD)' })
      .describe('Fecha del cierre (YYYY-MM-DD).'),
    desenlace: z
      .enum(DESENLACES_CIERRE_MAQUILA, { error: 'Elige si se le cobra o se le perdona' })
      .describe('`cobrado` propone el descuento; `perdonado` solo salda el pendiente.'),
    conFactura: z
      .boolean()
      .optional()
      .describe(
        'Con/sin factura del descuento propuesto. Solo hace falta cuando el maquilero factura de ' +
          'las DOS formas (`modalidadFacturacion = ambos`): ahí el movimiento no puede quedar ' +
          'ambiguo (F6-E4, decisión (h)). Con `solo_con`/`solo_sin` se ignora y manda el catálogo.',
      ),
    motivo: z
      .string()
      .trim()
      .max(500, { error: 'El motivo no puede tener más de 500 caracteres' })
      .optional()
      .describe('Nota del cierre. OBLIGATORIA al perdonar.'),
  })
  .refine((d) => d.desenlace !== 'perdonado' || (d.motivo ?? '').length >= 3, {
    error: 'Explica por qué se le perdona el faltante (mínimo 3 caracteres)',
    path: ['motivo'],
  })
  .describe('Cierre de una orden con un maquilero: salda el faltante y propone (o no) cobrarlo.');

/** Datos validados de un cierre. */
export type DatosCierreMaquilaCrear = z.infer<typeof esquemaCierreMaquilaCrear>;

/** Cuerpo del DESHACER de un cierre (motivo obligatorio, A7 — igual que toda cancelación). */
export const esquemaCierreMaquilaDeshacerCuerpo = z
  .object({
    motivo: z
      .string({ error: 'El motivo es obligatorio' })
      .trim()
      .min(3, { error: 'Explica el motivo (mínimo 3 caracteres)' })
      .max(500, { error: 'El motivo no puede tener más de 500 caracteres' }),
  })
  .describe('Motivo del deshacer del cierre.');

/** Datos validados del deshacer. */
export type DatosCierreMaquilaDeshacer = z.infer<typeof esquemaCierreMaquilaDeshacerCuerpo>;

// ── Salida ───────────────────────────────────────────────────────────────────────────────────────

/** Una celda saldada del cierre: color×talla×pack con las piezas que nunca volvieron. */
const esquemaCierreMaquilaCelda = z.object({
  idColor: z.number().int().describe('Id del color.'),
  color: z.string().describe('Nombre del color.'),
  pack: esquemaPackSalida.describe('PACK / tendido de la celda; cadena vacía si no aplica.'),
  idTalla: z.number().int().describe('Id de la talla.'),
  etiquetaTalla: z.string().describe('Etiqueta visible de la talla.'),
  cantidadFaltantes: z.number().int().describe('Piezas faltantes saldadas en esta celda.'),
});

/**
 * Un cierre tal como lo devuelve la API. `importe` y `precioFaltante` van **redactados a `null`**
 * para quien no tiene `ordenes.ver-precio-real-maquila`, igual que el `precioPactado` de un recibo
 * (R2 §4.4.3): el cierre lo puede apretar quien recibe, y quien recibe no necesariamente ve precios.
 */
export const esquemaCierreMaquilaSalida = z
  .object({
    id: z.number().int().describe('Id del cierre.'),
    idEmpresa: z.number().int().describe('Empresa dueña (A9).'),
    idOrden: z.number().int().describe('Orden cerrada.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    idMaquilero: z.number().int().describe('Maquilero con el que se cerró.'),
    maquilero: z.string().describe('Nombre del maquilero.'),
    idTipoProceso: z.number().int().describe('Proceso cuyo saldo se cerró.'),
    tipoProceso: z.string().describe('Nombre del proceso.'),
    fecha: z.string().describe('Fecha del cierre (YYYY-MM-DD).'),
    desenlace: z
      .enum(DESENLACES_CIERRE_MAQUILA)
      .describe('`cobrado` (propuso descuento) o `perdonado`.'),
    piezasFaltantes: z.number().int().describe('Total de piezas saldadas (derivado del detalle).'),
    precioFaltante: z
      .number()
      .nullable()
      .describe(
        'Precio pactado con el que se propuso el cobro, CONGELADO al cerrar. `null` si el envío no ' +
          'traía precio, si se perdonó, o si el usuario no puede ver precios reales de maquila.',
      ),
    importe: z
      .number()
      .nullable()
      .describe('Importe propuesto (piezas × precio), o null. Redactado sin permiso de precios.'),
    idDescuento: z
      .number()
      .int()
      .nullable()
      .describe(
        'Descuento EsMa propuesto por este cierre, o null. Con `desenlace = cobrado` y esto en ' +
          '`null`, el cierre SÍ saldó el faltante pero NO pudo proponer el cobro porque el envío ' +
          'no traía precio pactado (1,309 envíos migrados no lo traen): hay que capturar el ' +
          'descuento a mano en el estado de cuenta. Se dice con nombre en vez de inventar un precio.',
      ),
    descuentoRevisado: z
      .boolean()
      .describe(
        'Si el descuento propuesto YA fue revisado (y por tanto ya movió el saldo del maquilero). ' +
          'Con esto en `true` el cierre ya NO se puede deshacer.',
      ),
    motivo: z.string().nullable().describe('Nota del cierre o null.'),
    deshecho: z
      .boolean()
      .describe('Si el cierre está deshecho (las piezas volvieron al pendiente).'),
    deshechoEn: z.iso.datetime().nullable().describe('Cuándo se deshizo (ISO) o null.'),
    deshechoPorId: z.string().nullable().describe('Id del usuario que lo deshizo o null.'),
    motivoDeshacer: z.string().nullable().describe('Motivo del deshacer o null.'),
    celdas: z.array(esquemaCierreMaquilaCelda).describe('Las piezas saldadas, color×talla×pack.'),
    creadoEn: z.iso.datetime().describe('Cuándo se cerró (ISO).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que cerró.'),
  })
  .describe('Cierre de una orden con un maquilero (V1, fila 0.109).');

/** Forma de un cierre tal como lo devuelve la API. */
export type CierreMaquilaSalida = z.infer<typeof esquemaCierreMaquilaSalida>;

/** Los cierres de una orden (vivos y deshechos, los deshechos al final). */
export const esquemaCierresMaquilaLista = z
  .object({
    idOrden: z.number().int().describe('Orden.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    filas: z.array(esquemaCierreMaquilaSalida).describe('Cierres de la orden.'),
  })
  .describe('Cierres de una orden con sus maquileros.');

/** Forma de la lista de cierres tal como la devuelve la API. */
export type CierresMaquilaLista = z.infer<typeof esquemaCierresMaquilaLista>;
