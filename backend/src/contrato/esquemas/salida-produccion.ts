import { z } from 'zod';

import {
  esquemaOrdenLineaEntrada,
  esquemaOrdenReferenciaEntrada,
  esquemaOrdenSalida,
} from './orden.js';

/**
 * Contrato Zod de la SALIDA A PRODUCCIÓN (rediseño R3, B4/B6 — proto §4.1 "Generar OP"): la
 * operación central del flujo nuevo de captura. Desde un RENGLÓN de pedido interno (que el
 * constructor eligió por su modelo DE DESARROLLO), aquí NACE la matriz color×talla de la OP y,
 * al confirmar, en UNA transacción (A2):
 *
 *  • se crea la ORDEN de producción (reusa el alta F2: autorrelleno + folio por secuencia A3),
 *  • se copia el SNAPSHOT de la OC del cliente (`Pedido.ocCliente` → `Orden.ocCliente`, B3),
 *  • se LIGA la orden a su desarrollo (`DesarrolloOrden`, núcleo de `ligarOrden` F8-E6) si el
 *    renglón tiene desarrollo (sin desarrollo = caso legado: la OP nace sin liga),
 *  • ⭐⭐ **se REUSA —o NACE— el MODELO DE PRODUCCIÓN DE ESE COLOR** (V1-E3, §Post-F9.172(b)): si el
 *    renglón apunta a un modelo de DESARROLLO, la OP se sella con un modelo de producción propio,
 *    con su nº de 5 dígitos y COMPARTIENDO la receta del desarrollo, que se queda intacto y en su
 *    catálogo. Cuatro OC de cuatro colores ⇒ cuatro modelos y UNA receta. Si el mismo color ya
 *    tenía modelo, se REUSA (el número es del modelo, no de la orden); si el renglón ya apunta a un
 *    modelo de producción (todo el histórico del Access), la OP lo HEREDA y nada nace,
 *  • y se ENCOLA la generación automática de la Ruta Crítica (outbox, B5).
 *
 * También aquí: los CANDIDATOS de desarrollo para el selector del constructor (búsqueda
 * server-side sin acentos). Toda la lógica vive en el dominio (A1); aquí sólo las FORMAS.
 */

// ── Generar OP (salida a producción de un renglón) ───────────────────────────────────

/**
 * Cuerpo de `POST /pedidos/lineas/:idLinea/salida-produccion`. La matriz color×talla es
 * OBLIGATORIA y con al menos un renglón (aquí NACE la matriz de la OP — proto §4.1); las
 * referencias del cliente (D7) y las fechas son opcionales. La validación cuadra/faltan/sobran
 * contra la cantidad del renglón es GUÍA de la UI: el backend NO exige que cuadre (N órdenes por
 * renglón = resurtidos, F2-E2), solo que la matriz traiga piezas (> 0).
 */
export const esquemaSalidaProduccionCuerpo = z
  .object({
    lineas: z
      .array(esquemaOrdenLineaEntrada)
      .min(1, { error: 'Captura la matriz de colores y tallas de la orden' })
      .describe('Matriz color×talla de la OP (nace aquí; al menos un color).'),
    referencias: z
      .array(esquemaOrdenReferenciaEntrada)
      .optional()
      .describe('Valores de referencia del cliente (D7) para la orden, opcionales.'),
    fecha: z.iso
      .date({ error: 'La fecha de la orden no es válida' })
      .optional()
      .describe('Fecha de la orden (YYYY-MM-DD); default hoy.'),
    fechaEntrega: z.iso
      .date({ error: 'La fecha de entrega no es válida' })
      .optional()
      .describe(
        'Fecha de entrega comprometida de la OP; si se omite, hereda la ventana del pedido (fechaHasta ?? fechaDe).',
      ),
    numeroProduccion: z
      .number({ error: 'El número de producción debe ser un número' })
      .int({ error: 'El número de producción debe ser entero' })
      .min(10_000, { error: 'El número de producción debe tener 5 dígitos' })
      .max(99_999, { error: 'El número de producción debe tener 5 dígitos' })
      .optional()
      .describe(
        'Nº de producción CONFIRMADO para el modelo que va a NACER de este color (§Post-F9.46: el sistema lo precarga y el usuario lo puede cambiar). Omitir = aceptar el que propone el sistema. Se IGNORA —con aviso, sin bloquear— si ese color ya tenía modelo (se reusa el suyo) y también si el renglón ya apunta a un modelo de producción.',
      ),
  })
  .describe('Datos para generar la OP (salida a producción) de un renglón de pedido.');

/** Datos validados del cuerpo de salida a producción. */
export type DatosSalidaProduccion = z.infer<typeof esquemaSalidaProduccionCuerpo>;

/** Resultado de la salida a producción: la orden nacida + la traza del flujo nuevo. */
export const esquemaSalidaProduccionSalida = z
  .object({
    orden: esquemaOrdenSalida.describe('La orden de producción recién creada (con su matriz).'),
    idModeloProduccion: z
      .number()
      .int()
      .describe(
        'Modelo de PRODUCCIÓN con el que quedó sellada la OP (el hijo por color, o el del renglón en el caso legado).',
      ),
    codigoModeloProduccion: z
      .string()
      .describe(
        'Código VIGENTE de ese modelo (= su nº de 5 dígitos cuando nació por esta puerta).',
      ),
    numeroProduccion: z
      .number()
      .int()
      .nullable()
      .describe(
        'Nº de producción del modelo de la OP. Null sólo en el caso legado, cuando el modelo del renglón ya era de producción con código NO numérico de 5 dígitos (histórico tipo `51783a` o `M-18`).',
      ),
    modeloDeProduccion: z
      .enum(['nacido', 'reusado', 'heredado'])
      .describe(
        'Qué pasó con el modelo de la OP (V1-E3): `nacido` = ESTA salida hizo nacer el modelo de producción de ese color, con su número; `reusado` = ese color ya tenía modelo y se usó el suyo (el número es del modelo, no de la orden); `heredado` = el renglón ya apuntaba a un modelo de producción (histórico del Access) y la OP lo lleva tal cual, sin que nazca nada.',
      ),
    idModeloDesarrollo: z
      .number()
      .int()
      .nullable()
      .describe(
        'Modelo de DESARROLLO del que nació el de la OP — y de quien es, por lo tanto, la receta que comparten todos sus colores. Null en el caso `heredado`.',
      ),
    codigoModeloDesarrollo: z
      .string()
      .nullable()
      .describe(
        'Nº de desarrollo de ese padre (se CONSERVA y sigue buscable, D3), o null en el caso `heredado`.',
      ),
    avisosNumeroProduccion: z
      .array(z.string())
      .describe(
        'Avisos de la asignación del número (dígitos que no cuadran, serie cerca del tope, número capturado que no se usó porque el color ya tenía modelo). NUNCA bloquean.',
      ),
    idDesarrollo: z
      .number()
      .int()
      .nullable()
      .describe('Desarrollo ligado a la OP, o null (renglón sin desarrollo = caso legado).'),
    ligaCreada: z.boolean().describe('true si se creó la liga DesarrolloOrden en esta operación.'),
  })
  .describe('Resultado de generar la OP (salida a producción).');

/** Forma del resultado de la salida a producción. */
export type SalidaProduccionSalida = z.infer<typeof esquemaSalidaProduccionSalida>;

// ── Candidatos de desarrollo (selector del constructor) ─────────────────────────────

/** Querystring del selector de desarrollos del constructor (`GET /pedidos/candidatos-desarrollo`). */
export const esquemaCandidatosDesarrolloQuery = z
  .object({
    busqueda: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe(
        'Texto a buscar SIN acentos ni mayúsculas: código/descripción del modelo, nº del cliente, nombre del proyecto o del cliente.',
      ),
    idCliente: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra a los desarrollos de un cliente (el del encabezado del pedido).'),
    limite: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe('Máximo de candidatos a devolver (typeahead).'),
  })
  .describe('Búsqueda server-side de desarrollos para el constructor de pedido.');

/** Parámetros de candidatos ya coaccionados desde la URL. */
export type CandidatosDesarrolloQuery = z.infer<typeof esquemaCandidatosDesarrolloQuery>;

/** Un candidato de desarrollo para el selector (nombre + proyecto/cliente + nº del cliente). */
export const esquemaCandidatoDesarrollo = z
  .object({
    idDesarrollo: z.number().int().describe('Id del desarrollo.'),
    idModelo: z.number().int().describe('Id del modelo del desarrollo.'),
    codigoModelo: z.string().describe('Nº de desarrollo (Modelo.codigo).'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    numeroCliente: z.string().nullable().describe('Nº del cliente para este modelo, o null.'),
    numeroProduccion: z
      .number()
      .int()
      .nullable()
      .describe('Nº interno de producción del modelo (si ya salió a producción), o null.'),
    idProyecto: z.number().int().describe('Proyecto del desarrollo.'),
    folioProyecto: z.number().int().describe('Folio del proyecto.'),
    nombreProyecto: z.string().describe('Nombre/tema del proyecto.'),
    idCliente: z.number().int().describe('Cliente del proyecto.'),
    nombreCliente: z.string().describe('Nombre del cliente.'),
    nombreDepartamento: z.string().describe('Departamento del cliente.'),
    precioSugerido: z
      .number()
      .nullable()
      .describe(
        'Precio PROPUESTO para el renglón del pedido (del renglón de lista más reciente: aprobado ?? calculado), o null sin lista o sin `pedidos.importes`.',
      ),
  })
  .describe('Desarrollo candidato para un renglón del pedido.');

/** Forma de un candidato de desarrollo. */
export type CandidatoDesarrollo = z.infer<typeof esquemaCandidatoDesarrollo>;

/** Respuesta del selector de desarrollos. */
export const esquemaCandidatosDesarrolloSalida = z
  .object({
    datos: z.array(esquemaCandidatoDesarrollo).describe('Candidatos (tope `limite`).'),
  })
  .describe('Desarrollos candidatos para el constructor de pedido.');

/** Forma de la respuesta de candidatos. */
export type CandidatosDesarrolloSalida = z.infer<typeof esquemaCandidatosDesarrolloSalida>;
