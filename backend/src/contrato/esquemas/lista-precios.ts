import { z } from 'zod';

/**
 * Contrato Zod de la LISTA DE PRECIOS por Cliente+Departamento (F8-E4, D13/R20a — Desarrollo y
 * Cotización). Genera el precio de venta desde los PRECOSTOS CONGELADOS (E3) aplicando los FACTORES
 * del cliente (snapshot editable en la lista), y le da al dueño el flujo de aprobación: el sistema
 * PROPONE `precioCalculado` y él, renglón por renglón, aprueba ese o teclea `precioAprobado`.
 *
 * Los IMPORTES (costoUnit, precioCalculado, precioAprobado, factores) se OCULTAN (null) sin
 * `consultas.ver-importes`; el resto (modelo, número del cliente, folio, estado) siempre se ve. Toda
 * la lógica vive en el dominio (`dominio/desarrollo/listas-precios.ts`, A1); aquí solo las FORMAS.
 * En E4 la lista NACE `abierta` y ahí se queda (los cambios de estado + la negociación son E5).
 */

// ── Entradas ──────────────────────────────────────────────────────────────────────

/** Notas de la lista (texto libre). */
const notasLista = z
  .string()
  .trim()
  .max(1000, { error: 'Las notas no pueden tener más de 1000 caracteres' });

/**
 * Un porcentaje de factor de la lista: 0 ≤ % (finito). El tope fino (`margen < 100`; suma de los
 * otros tres `< 100`) lo valida el dominio con mensaje claro; aquí el piso y el rango físico
 * `Decimal(5,2)`.
 */
const porcentajeFactor = z
  .number({ error: 'El porcentaje es obligatorio' })
  .min(0, { error: 'El porcentaje no puede ser negativo' })
  .max(999.99, { error: 'El porcentaje es demasiado grande' });

/**
 * Alta de una lista: cliente + departamento + los desarrollos a incluir. Cada desarrollo debe ser de
 * un proyecto de ese cliente+departamento y tener un precosto CONGELADO (lo valida el dominio, que
 * rechaza con la lista de faltantes). Los factores se copian de `ClienteFactores` (no se capturan
 * aquí). `fecha` default = hoy; `notas` opcional.
 */
export const esquemaListaPreciosCrear = z.object({
  idCliente: z
    .number({ error: 'El cliente es obligatorio' })
    .int({ error: 'El id del cliente debe ser entero' })
    .positive({ error: 'El id del cliente debe ser positivo' })
    .describe('Cliente de la lista.'),
  idClienteDepartamento: z
    .number({ error: 'El departamento es obligatorio' })
    .int({ error: 'El id del departamento debe ser entero' })
    .positive({ error: 'El id del departamento debe ser positivo' })
    .describe('Departamento del cliente (la lista es por Cliente+Departamento).'),
  idsDesarrollo: z
    .array(
      z
        .number({ error: 'El id del desarrollo debe ser un número' })
        .int({ error: 'El id del desarrollo debe ser entero' })
        .positive({ error: 'El id del desarrollo debe ser positivo' }),
    )
    .min(1, { error: 'Selecciona al menos un desarrollo para la lista' })
    .describe('Desarrollos (cotizados) a incluir como renglones.'),
  fecha: z.iso
    .date({ error: 'La fecha debe tener formato YYYY-MM-DD' })
    .optional()
    .describe('Fecha de la lista (YYYY-MM-DD); default = hoy.'),
  notas: notasLista.nullable().optional().describe('Notas de la lista (opcional).'),
});

/** Datos validados de alta de una lista. */
export type DatosListaPreciosCrear = z.infer<typeof esquemaListaPreciosCrear>;

/**
 * Editar el SNAPSHOT de factores de una lista (§Post-F9.125 (a) y (d)): recalcula `precioCalculado`
 * de TODOS los renglones **y TUMBA sus `precioAprobado`**, devolviéndolos a pendiente con nota de qué
 * los invalidó y cuándo. La firma vieja no se borra (D3): va al `NegociacionEvento` inmutable.
 * Requiere `listas.aprobar` — el precio de venta es SÓLO del dueño. Los cuatro % son obligatorios.
 *
 * ⚠️ Este comentario decía *"sin tocar los `precioAprobado`"* —cierto hasta V1-E8b, falso después— y
 * sobrevivió al cambio que lo desmintió, justo encima del esquema de la operación que lo cambió. Es
 * la misma cicatriz de V1-E8a: *el barrido de la prosa se detuvo antes que el del código.*
 */
export const esquemaListaFactoresEditar = z.object({
  margenPct: porcentajeFactor.describe('% de margen sobre la venta (debe ser < 100).'),
  descuentosPct: porcentajeFactor.describe('% de descuentos sobre la venta.'),
  regaliasPct: porcentajeFactor.describe('% de regalías sobre la venta.'),
  costoVentasPct: porcentajeFactor.describe('% de costo de ventas sobre la venta.'),
});

/** Datos validados de edición del snapshot de factores. */
export type DatosListaFactoresEditar = z.infer<typeof esquemaListaFactoresEditar>;

/** Ajustar (teclear) el precio aprobado de un renglón: precio > 0. */
export const esquemaAjustarPrecioLinea = z.object({
  precio: z
    .number({ error: 'El precio es obligatorio' })
    .positive({ error: 'El precio debe ser mayor a cero' })
    .describe('Precio aprobado tecleado por el dueño (> 0).'),
});

/** Datos validados del ajuste de precio de un renglón. */
export type DatosAjustarPrecioLinea = z.infer<typeof esquemaAjustarPrecioLinea>;

// ── Salida ──────────────────────────────────────────────────────────────────────

/** Un renglón de la lista (con datos del desarrollo/modelo y los precios; importes ocultos sin permiso). */
export const esquemaListaPreciosLineaSalida = z
  .object({
    id: z.number().int().describe('Id del renglón.'),
    idDesarrollo: z.number().int().describe('Desarrollo del renglón.'),
    idPrecosto: z.number().int().describe('Versión congelada del precosto usada.'),
    versionPrecosto: z.number().int().describe('Nº de versión del precosto congelado.'),
    codigoModelo: z.string().describe('Código del modelo (nuestro número).'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    numeroCliente: z.string().nullable().describe('Número del cliente para este modelo, o null.'),
    costoUnit: z.number().nullable().describe('Costo unitario snapshot (o null sin importes).'),
    precioCalculado: z
      .number()
      .nullable()
      .describe('Precio propuesto por la fórmula (o null sin importes).'),
    precioAprobado: z
      .number()
      .nullable()
      .describe(
        'Precio aprobado/tecleado por el dueño (null si aún no se aprueba o sin importes).',
      ),
    aprobado: z.boolean().describe('¿Ya tiene precio aprobado? (independiente de ver importes).'),
    aprobadoPorId: z.string().nullable().describe('Quién aprobó el precio, o null.'),
    aprobadoEn: z.iso.datetime().nullable().describe('Cuándo se aprobó (ISO 8601), o null.'),
    // ⭐ V1-E8d (§Post-F9.127) — la frase la arma el SERVIDOR (`dominio/desarrollo/costo-viejo.ts`)
    // para que la pantalla no la degrade a un semáforo mudo ni escriba una segunda redacción.
    avisoCostoViejo: z
      .string()
      .nullable()
      .describe(
        'AVISO en español: la receta del modelo cambió DESPUÉS de congelarse el precosto con el ' +
          'que está calculado este precio, así que el costo quedó viejo. Dice qué parte de la ' +
          'receta cambió y cuándo. Null = no hay nada que avisar. Es un AVISO, no un candado: ' +
          'no bloquea aprobar ni bajar documentos (§Post-F9.127).',
      ),
  })
  .describe('Renglón de una lista de precios.');

/** Forma de un renglón de lista de precios. */
export type ListaPreciosLineaSalida = z.infer<typeof esquemaListaPreciosLineaSalida>;

/** Una lista de precios COMPLETA con sus renglones (para el detalle). */
export const esquemaListaPreciosDetalle = z
  .object({
    id: z.number().int().describe('Id de la lista.'),
    folio: z.number().int().describe('Folio consecutivo por empresa.'),
    idCliente: z.number().int().describe('Cliente de la lista.'),
    nombreCliente: z.string().describe('Nombre del cliente.'),
    idClienteDepartamento: z.number().int().describe('Departamento del cliente.'),
    nombreDepartamento: z.string().describe('Nombre del departamento.'),
    fecha: z.iso.date().describe('Fecha de la lista (YYYY-MM-DD).'),
    idEstadoLista: z.number().int().describe('Estado de la lista.'),
    codigoEstado: z.string().describe('Código del estado (ej. "abierta").'),
    nombreEstado: z.string().describe('Nombre del estado.'),
    // §Post-F9.125(b): los CUATRO factores son del dueño. La reja NO es `consultas.ver-importes`
    // (Desarrollo lo tiene y lo necesita), es `listas.aprobar`.
    margenPct: z.number().nullable().describe('Snapshot % margen (o null sin `listas.aprobar`).'),
    descuentosPct: z
      .number()
      .nullable()
      .describe('Snapshot % descuentos (o null sin `listas.aprobar`).'),
    regaliasPct: z
      .number()
      .nullable()
      .describe('Snapshot % regalías (o null sin `listas.aprobar`).'),
    costoVentasPct: z
      .number()
      .nullable()
      .describe('Snapshot % costo de ventas (o null sin `listas.aprobar`).'),
    notas: z.string().nullable().describe('Notas de la lista, o null.'),
    lineas: z.array(esquemaListaPreciosLineaSalida).describe('Renglones (uno por desarrollo).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que la modificó.'),
  })
  .describe('Lista de precios por Cliente+Departamento, con sus renglones.');

/** Forma de una lista completa (con renglones). */
export type ListaPreciosDetalle = z.infer<typeof esquemaListaPreciosDetalle>;

/** Una lista en el LISTADO (resumen, sin renglones). */
export const esquemaListaPreciosResumen = z
  .object({
    id: z.number().int().describe('Id de la lista.'),
    folio: z.number().int().describe('Folio consecutivo por empresa.'),
    idCliente: z.number().int().describe('Cliente de la lista.'),
    nombreCliente: z.string().describe('Nombre del cliente.'),
    idClienteDepartamento: z.number().int().describe('Departamento del cliente.'),
    nombreDepartamento: z.string().describe('Nombre del departamento.'),
    fecha: z.iso.date().describe('Fecha de la lista (YYYY-MM-DD).'),
    idEstadoLista: z.number().int().describe('Estado de la lista.'),
    codigoEstado: z.string().describe('Código del estado.'),
    nombreEstado: z.string().describe('Nombre del estado.'),
    totalRenglones: z.number().int().describe('Cuántos renglones tiene la lista.'),
    renglonesAprobados: z.number().int().describe('Cuántos renglones ya tienen precio aprobado.'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
  })
  .describe('Resumen de una lista de precios (para el listado).');

/** Forma del resumen de una lista. */
export type ListaPreciosResumen = z.infer<typeof esquemaListaPreciosResumen>;

/** Respuesta del listado de listas (filtrable por cliente/departamento/estado/fechas). */
export const esquemaListasPreciosLista = z
  .object({
    datos: z.array(esquemaListaPreciosResumen).describe('Listas de precios (más nueva primero).'),
  })
  .describe('Listas de precios (D13/R20a).');

/** Forma del listado de listas. */
export type ListasPreciosLista = z.infer<typeof esquemaListasPreciosLista>;

/** Querystring del listado de listas (todos los filtros opcionales). */
export const esquemaListasPreciosQuery = z.object({
  idCliente: z.coerce.number().int().positive().optional().describe('Filtra por cliente.'),
  idClienteDepartamento: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('Filtra por departamento.'),
  idEstadoLista: z.coerce.number().int().positive().optional().describe('Filtra por estado.'),
  desde: z.iso.date().optional().describe('Fecha mínima de la lista (YYYY-MM-DD).'),
  hasta: z.iso.date().optional().describe('Fecha máxima de la lista (YYYY-MM-DD).'),
});

/** Parámetros del listado (los reutiliza la ruta REST). */
export type ListasPreciosQuery = z.infer<typeof esquemaListasPreciosQuery>;

/** Un desarrollo CANDIDATO para una lista (cotizado, sin renglón en ninguna lista). */
export const esquemaCandidatoLista = z
  .object({
    idDesarrollo: z.number().int().describe('Desarrollo candidato.'),
    idProyecto: z.number().int().describe('Proyecto del desarrollo.'),
    folioProyecto: z.number().int().describe('Folio del proyecto.'),
    nombreProyecto: z.string().describe('Nombre/tema del proyecto.'),
    codigoModelo: z.string().describe('Código del modelo.'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    numeroCliente: z.string().nullable().describe('Número del cliente para este modelo, o null.'),
    idPrecosto: z.number().int().describe('Versión congelada del precosto (la más reciente).'),
    versionPrecosto: z.number().int().describe('Nº de versión del precosto congelado.'),
    costoTotal: z.number().nullable().describe('Costo total del precosto (o null sin importes).'),
  })
  .describe('Desarrollo candidato para una lista (cotizado, sin renglón en una lista).');

/** Forma de un candidato. */
export type CandidatoLista = z.infer<typeof esquemaCandidatoLista>;

/**
 * ⭐ V1-E8f (§Post-F9.128) — POR QUÉ un desarrollo NO es candidato. Daniel: *"Justo me sale la
 * leyenda de que no hay desarrollos disponibles"*. Un aviso que dice "no hay X" sin decir por qué ni
 * qué hacer ES el defecto (§Post-F9.96), así que el servidor CLASIFICA cada desarrollo descartado y
 * devuelve el motivo; el texto lo pone el frontend (la lógica es del dominio, la redacción de la UI —
 * mismo reparto que el estado derivado del desarrollo).
 *
 * Los cuatro motivos son EXHAUSTIVOS y se evalúan en este orden de precedencia:
 *  • `apagado`           — el desarrollo está apagado (se reactiva con «Mostrar apagados»).
 *  • `ya-en-lista`       — ya tiene renglón en una lista (un desarrollo vive en A LO MÁS UNA, D13);
 *                          se devuelven `idLista`/`folioLista` para PODER LLEVAR AHÍ al usuario.
 *  • `precosto-borrador` — tiene precosto(s) pero NINGUNO congelado: es EL caso de Daniel. Se
 *                          devuelve `versionPrecosto` = la versión borrador más reciente, para que el
 *                          aviso pueda nombrarla ("v2 sigue en borrador").
 *  • `sin-precosto`      — el modelo no tiene ni un precosto todavía.
 */
export const MOTIVOS_NO_CANDIDATO = [
  'apagado',
  'ya-en-lista',
  'precosto-borrador',
  'sin-precosto',
] as const;

/** Motivo por el que un desarrollo NO puede entrar a una lista de precios. */
export const esquemaMotivoNoCandidato = z
  .enum(MOTIVOS_NO_CANDIDATO)
  .describe(
    'Por qué el desarrollo no es candidato (apagado/ya-en-lista/precosto-borrador/sin-precosto).',
  );

/** Forma del motivo. */
export type MotivoNoCandidato = z.infer<typeof esquemaMotivoNoCandidato>;

/** Un desarrollo DESCARTADO, con el motivo que lo descartó y con qué llevar al usuario al remedio. */
export const esquemaDescartadoLista = z
  .object({
    idDesarrollo: z.number().int().describe('Desarrollo descartado.'),
    idProyecto: z.number().int().describe('Proyecto del desarrollo.'),
    folioProyecto: z.number().int().describe('Folio del proyecto.'),
    nombreProyecto: z.string().describe('Nombre/tema del proyecto.'),
    codigoModelo: z.string().describe('Código del modelo.'),
    numeroCliente: z.string().nullable().describe('Número del cliente para este modelo, o null.'),
    motivo: esquemaMotivoNoCandidato,
    versionPrecosto: z
      .number()
      .int()
      .nullable()
      .describe('Versión del precosto BORRADOR más reciente (motivo precosto-borrador), o null.'),
    idLista: z.number().int().nullable().describe('Lista que ya lo contiene (motivo ya-en-lista).'),
    folioLista: z.number().int().nullable().describe('Folio de esa lista, o null.'),
  })
  .describe('Desarrollo que NO es candidato, con el motivo exacto que lo dejó fuera (V1-E8f).');

/** Forma de un descartado. */
export type DescartadoLista = z.infer<typeof esquemaDescartadoLista>;

/** Respuesta de los candidatos para una lista: los que SÍ, y los que no con su motivo. */
export const esquemaCandidatosLista = z
  .object({
    datos: z.array(esquemaCandidatoLista).describe('Desarrollos candidatos.'),
    descartados: z
      .array(esquemaDescartadoLista)
      .describe('Desarrollos del mismo cliente+departamento que NO calificaron, con su motivo.'),
    // ⭐ V1-E8t (§Post-F9.145): el SEGUNDO requisito para armar la lista, que hasta la 0.056 sólo
    // se descubría al apretar «Crear lista» y volvía como un 400. Se dice ANTES, y con él la
    // pantalla enciende la puerta «Capturar factores».
    faltanFactores: z
      .boolean()
      .describe(
        'Verdadero si este cliente+departamento NO tiene factores (ni override ni default): sin ellos la lista se rechaza.',
      ),
  })
  .describe(
    'Candidatos para una lista de precios, los descartados con su motivo (V1-E8f) y si faltan los factores (V1-E8t).',
  );

/** Forma de la lista de candidatos. */
export type CandidatosLista = z.infer<typeof esquemaCandidatosLista>;

/** Querystring de los candidatos (cliente + departamento, ambos obligatorios). */
export const esquemaCandidatosQuery = z.object({
  idCliente: z.coerce.number().int().positive().describe('Cliente.'),
  idClienteDepartamento: z.coerce.number().int().positive().describe('Departamento del cliente.'),
  // Daniel (ago-2026): acota los candidatos a UN proyecto (el botón «Generar lista de precios»
  // desde el proyecto ofrece SOLO sus modelos). Omitir = todos los del cliente+departamento (el
  // diálogo general de Cotizaciones).
  idProyecto: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('Acota los candidatos a un proyecto (opcional).'),
});

/** Parámetros de los candidatos. */
export type CandidatosQuery = z.infer<typeof esquemaCandidatosQuery>;

/**
 * DESGLOSE de costo de un renglón (rediseño R5, §4.8): los conceptos del precosto congelado del
 * renglón agrupados y sumados EN EL SERVIDOR (A1: nunca se pivotea en el cliente) — Tela · Avíos ·
 * Procesos · Corte · Maquila = costo total. Para que el dueño "vea que hace sentido" antes de aprobar.
 * Los subtotales/total se OCULTAN (null) sin `consultas.ver-importes`.
 */
export const esquemaGrupoDesgloseCosto = z
  .object({
    codigo: z.string().describe('Código del concepto de costo (tela/avios/maquila/corte/…).'),
    nombre: z.string().describe('Nombre legible del concepto.'),
    subtotal: z
      .number()
      .nullable()
      .describe('Suma de importes del concepto (o null sin importes).'),
  })
  .describe('Un concepto del desglose de costo con su subtotal.');

/** Forma de un grupo del desglose. */
export type GrupoDesgloseCosto = z.infer<typeof esquemaGrupoDesgloseCosto>;

/** Respuesta del desglose de costo de un renglón. */
export const esquemaDesgloseCostoLinea = z
  .object({
    idPrecosto: z.number().int().describe('Precosto congelado del renglón.'),
    versionPrecosto: z.number().int().describe('Nº de versión del precosto.'),
    grupos: z
      .array(esquemaGrupoDesgloseCosto)
      .describe('Conceptos agrupados por tipo, ordenados por su orden de catálogo.'),
    costoTotal: z.number().nullable().describe('Costo total del renglón (o null sin importes).'),
  })
  .describe('Desglose de costo por concepto de un renglón de lista (§4.8).');

/** Forma del desglose de costo. */
export type DesgloseCostoLinea = z.infer<typeof esquemaDesgloseCostoLinea>;
