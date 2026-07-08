import { z } from 'zod';

/**
 * Contrato Zod del IMPORTADOR del pedido del cliente (rediseño R8, B15 — proto §4.1 "Etapa 3"): el
 * cliente manda su Orden de Compra en SU formato (Excel); se le enseña UNA vez el mapeo (plantilla
 * por cliente) y las siguientes veces se importa solo. Al confirmar NACE, en UNA transacción (A2):
 * pedido interno + una OP por modelo reconocido (con su matriz color×talla del archivo) + su Ruta
 * Crítica — reusando `salidaAProduccion` (R3). Toda la lógica vive en el dominio (A1); aquí sólo las
 * FORMAS. El archivo viaja como base64 en JSON (los OCs son chicos) para no meter multipart al
 * stack Zod/OpenAPI; el backend lo decodifica y lo parsea con exceljs.
 */

// ── Mapeo de columnas del archivo del cliente ────────────────────────────────

/** Qué es una columna del archivo del cliente (proto: `IMP_ROLES`). */
export const esquemaRolColumnaImportacion = z
  .enum(['modeloCliente', 'color', 'talla', 'cantidad', 'precio', 'ignorar'])
  .describe('Rol de la columna: modelo del cliente / color / talla / cantidad / precio / ignorar.');

/** Rol de columna validado. */
export type RolColumnaImportacion = z.infer<typeof esquemaRolColumnaImportacion>;

/** Etiquetas legibles de los roles obligatorios (para los mensajes de validación). */
const ETIQUETA_ROL: Record<RolColumnaImportacion, string> = {
  modeloCliente: 'Modelo del cliente',
  color: 'Color',
  talla: 'Talla',
  cantidad: 'Cantidad',
  precio: 'Precio',
  ignorar: 'Ignorar',
};

/** Mapeo de UNA columna del archivo (índice + encabezado + rol). */
export const esquemaMapeoColumna = z
  .object({
    indice: z
      .number({ error: 'El índice de la columna es obligatorio' })
      .int({ error: 'El índice debe ser entero' })
      .min(0, { error: 'El índice no puede ser negativo' })
      .describe('Posición (0-based) de la columna en el archivo.'),
    columna: z
      .string()
      .trim()
      .max(255)
      .describe('Encabezado de la columna (para mostrar; el índice manda al aplicar).'),
    rol: esquemaRolColumnaImportacion,
  })
  .describe('Cómo se interpreta una columna del archivo del cliente.');

/** Un renglón de mapeo validado. */
export type MapeoColumna = z.infer<typeof esquemaMapeoColumna>;

/**
 * Mapeo COMPLETO del archivo (una entrada por columna). Debe indicar EXACTAMENTE una columna para
 * cada rol obligatorio — Modelo del cliente, Color, Talla y Cantidad — porque de ahí nacen la liga
 * al desarrollo y la matriz color×talla de la OP (Precio es opcional). Se rechaza si falta uno o si
 * hay dos columnas con el mismo rol (ambigüedad).
 */
export const esquemaMapeoImportacion = z
  .array(esquemaMapeoColumna)
  .min(1, { error: 'Marca qué es cada columna del archivo del cliente' })
  .superRefine((mapeo, ctx) => {
    const conteo = new Map<RolColumnaImportacion, number>();
    for (const item of mapeo) {
      if (item.rol !== 'ignorar') {
        conteo.set(item.rol, (conteo.get(item.rol) ?? 0) + 1);
      }
    }
    for (const rol of ['modeloCliente', 'color', 'talla', 'cantidad'] as const) {
      if ((conteo.get(rol) ?? 0) === 0) {
        ctx.addIssue({
          code: 'custom',
          message: `Falta indicar qué columna es "${ETIQUETA_ROL[rol]}".`,
        });
      }
    }
    for (const [rol, n] of conteo) {
      if (n > 1) {
        ctx.addIssue({
          code: 'custom',
          message: `Hay más de una columna marcada como "${ETIQUETA_ROL[rol]}".`,
        });
      }
    }
  })
  .describe(
    'Mapeo columna→rol del archivo del cliente (Modelo/Color/Talla/Cantidad obligatorios).',
  );

/** Mapeo completo validado. */
export type MapeoImportacion = z.infer<typeof esquemaMapeoImportacion>;

// ── Plantilla de importación (versionada, una vigente por cliente) ───────────

/** Una plantilla de importación tal como sale a la API. */
export const esquemaPlantillaImportacionSalida = z
  .object({
    id: z.number().int().describe('Id de la plantilla.'),
    idCliente: z.number().int().describe('Cliente dueño de la plantilla.'),
    nombre: z.string().describe('Nombre descriptivo del formato.'),
    version: z.number().int().describe('Nº de versión dentro del cliente.'),
    vigente: z.boolean().describe('Si es la versión que se aplica hoy.'),
    mapeo: z.array(esquemaMapeoColumna).describe('Mapeo columna→rol guardado.'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Usuario que la guardó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Último usuario que la modificó.'),
  })
  .describe('Plantilla de importación de un cliente.');

/** Forma de una plantilla en la API. */
export type PlantillaImportacionSalida = z.infer<typeof esquemaPlantillaImportacionSalida>;

/** Respuesta de la plantilla VIGENTE de un cliente (o `null` si no tiene). */
export const esquemaPlantillaImportacionVigente = z
  .object({
    plantilla: esquemaPlantillaImportacionSalida.nullable(),
  })
  .describe('Plantilla vigente del cliente (null = aún no tiene formato guardado).');

/** Forma de la respuesta de plantilla vigente. */
export type PlantillaImportacionVigente = z.infer<typeof esquemaPlantillaImportacionVigente>;

/** Cuerpo de guardar una plantilla (versión NUEVA — no edita la vieja). */
export const esquemaPlantillaImportacionGuardar = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, { error: 'El nombre del formato es obligatorio' })
      .max(200)
      .optional()
      .describe('Nombre descriptivo (default "Formato del cliente vN").'),
    mapeo: esquemaMapeoImportacion,
  })
  .describe('Datos para guardar (versionar) la plantilla de un cliente.');

/** Datos validados de guardar plantilla. */
export type DatosPlantillaImportacionGuardar = z.infer<typeof esquemaPlantillaImportacionGuardar>;

// ── Campos del archivo (base64) compartidos por analizar/confirmar ───────────

/** Nombre del archivo del cliente. */
const campoNombreArchivo = z
  .string({ error: 'El nombre del archivo es obligatorio' })
  .trim()
  .min(1, { error: 'El nombre del archivo es obligatorio' })
  .max(255)
  .describe('Nombre del archivo del cliente (para mostrar y adjuntar).');

/**
 * Contenido del archivo en base64 (los OCs son chicos; el backend lo decodifica y parsea). El tope
 * real es 10 MB DECODIFICADOS (`MAX_ARCHIVO_BYTES` en el dominio); en base64 eso son ≈13.98 MB, así
 * que el cap de este string (14 MiB) sólo blinda contra payloads absurdos — la validación autoritaria
 * de 10 MB la hace el dominio al decodificar. El `bodyLimit` de la ruta (15 MiB) va por encima de los
 * dos. Los tres límites quedan alineados a los 10 MB reales.
 */
const campoArchivoBase64 = z
  .string({ error: 'El contenido del archivo es obligatorio' })
  .min(1, { error: 'El contenido del archivo es obligatorio' })
  .max(14 * 1024 * 1024, { error: 'El archivo es demasiado grande (máx. 10 MB)' })
  .describe('Contenido del Excel del cliente en base64 (acepta prefijo data: URL).');

// ── Analizar / vista previa ──────────────────────────────────────────────────

/**
 * Cuerpo de `POST /pedidos/importacion/analizar`: sube el archivo + el cliente (y opcionalmente el
 * mapeo). Devuelve los encabezados/muestras del archivo (para el paso "Formato"), la plantilla
 * vigente del cliente (si tiene) y —si hay mapeo (el enviado o el de la plantilla vigente)— la
 * VISTA PREVIA con los modelos reconocidos/no-reconocidos.
 */
export const esquemaAnalizarImportacionCuerpo = z
  .object({
    idCliente: z
      .number({ error: 'El cliente es obligatorio' })
      .int()
      .positive()
      .describe('Cliente del pedido.'),
    nombreArchivo: campoNombreArchivo,
    archivoBase64: campoArchivoBase64,
    mapeo: esquemaMapeoImportacion
      .optional()
      .describe('Mapeo a aplicar; si se omite, se usa la plantilla vigente del cliente (si hay).'),
  })
  .describe('Analiza el archivo del cliente y arma la vista previa.');

/** Datos validados de analizar. */
export type DatosAnalizarImportacion = z.infer<typeof esquemaAnalizarImportacionCuerpo>;

/** Un grupo (modelo del cliente) de la vista previa, con su reconocimiento y su matriz derivada. */
export const esquemaGrupoImportacion = z
  .object({
    modeloCliente: z.string().describe('Nº/estilo del modelo tal como viene en el archivo.'),
    reconocido: z.boolean().describe('true si se amarró a un desarrollo (por nº de cliente).'),
    idDesarrollo: z.number().int().nullable().describe('Desarrollo amarrado, o null.'),
    idModelo: z.number().int().nullable().describe('Modelo del desarrollo, o null.'),
    codigoModelo: z.string().nullable().describe('Nº de desarrollo (Modelo.codigo), o null.'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    numeroProduccion: z
      .number()
      .int()
      .nullable()
      .describe('Nº interno de producción del modelo (si ya salió), o null.'),
    totalPiezas: z.number().int().describe('Suma de cantidades del grupo.'),
    numRenglones: z.number().int().describe('Renglones del archivo en este grupo.'),
    precio: z
      .number()
      .nullable()
      .describe('Precio de referencia (primer renglón con precio), o null sin `pedidos.importes`.'),
    coloresNoResueltos: z
      .array(z.string())
      .describe('Colores del archivo que NO existen en el catálogo (bloquean la matriz).'),
    tallasNoResueltas: z
      .array(z.string())
      .describe('Tallas del archivo que NO existen en el catálogo (bloquean la matriz).'),
    cantidadesIlegibles: z
      .number()
      .int()
      .describe(
        'Renglones con cantidad presente pero NO numérica (p. ej. "N/A"): se tratan como 0.',
      ),
  })
  .describe('Un modelo del cliente en la vista previa.');

/** Forma de un grupo de la vista previa. */
export type GrupoImportacion = z.infer<typeof esquemaGrupoImportacion>;

/** Vista previa: los grupos (modelos del cliente) + totales. */
export const esquemaPreviewImportacion = z
  .object({
    grupos: z.array(esquemaGrupoImportacion).describe('Modelos del cliente detectados.'),
    totalGrupos: z.number().int().describe('Cuántos modelos del cliente hay.'),
    totalReconocidos: z.number().int().describe('Cuántos se amarraron a un desarrollo.'),
    totalPiezas: z.number().int().describe('Suma de piezas de todo el archivo.'),
  })
  .describe('Vista previa de la importación.');

/** Forma de la vista previa. */
export type PreviewImportacion = z.infer<typeof esquemaPreviewImportacion>;

/** Respuesta de analizar: encabezados/muestras + plantilla vigente + vista previa (si hay mapeo). */
export const esquemaAnalizarImportacionSalida = z
  .object({
    columnas: z.array(z.string()).describe('Encabezados de las columnas del archivo.'),
    muestras: z
      .array(z.array(z.string()))
      .describe('Primeras filas del archivo (para mostrar ejemplos al mapear).'),
    totalFilas: z.number().int().describe('Total de renglones de datos del archivo.'),
    plantillaVigente: esquemaPlantillaImportacionSalida
      .nullable()
      .describe('Formato guardado del cliente (null = hay que enseñárselo).'),
    preview: esquemaPreviewImportacion
      .nullable()
      .describe('Vista previa (null si no hubo mapeo que aplicar).'),
  })
  .describe('Resultado de analizar el archivo del cliente.');

/** Forma de la respuesta de analizar. */
export type AnalizarImportacionSalida = z.infer<typeof esquemaAnalizarImportacionSalida>;

// ── Confirmar la importación ──────────────────────────────────────────────────

/** Una resolución MANUAL: liga un modelo del cliente (sin reconocer) a un desarrollo elegido a mano. */
export const esquemaResolucionImportacion = z
  .object({
    modeloCliente: z
      .string({ error: 'El modelo del cliente es obligatorio' })
      .trim()
      .min(1)
      .describe('Nº/estilo del modelo del cliente tal como viene en el archivo.'),
    idDesarrollo: z
      .number({ error: 'El desarrollo es obligatorio' })
      .int()
      .positive()
      .describe('Desarrollo (del mismo cliente) al que se liga a mano.'),
  })
  .describe('Liga manual modelo-del-cliente → desarrollo.');

/** Datos validados de una resolución manual. */
export type DatosResolucionImportacion = z.infer<typeof esquemaResolucionImportacion>;

/**
 * Cuerpo de `POST /pedidos/importacion/confirmar`: el archivo + el mapeo + las resoluciones manuales
 * (de los modelos que no se reconocieron solos). Crea el pedido interno + las OPs con su matriz + su
 * RC, en UNA transacción. Los modelos que quedan sin desarrollo (ni auto ni manual) se OMITEN y se
 * devuelven en `noReconocidos` (el resto sí se importa).
 */
export const esquemaConfirmarImportacionCuerpo = z
  .object({
    idCliente: z
      .number({ error: 'El cliente es obligatorio' })
      .int()
      .positive()
      .describe('Cliente del pedido (empresa activa de la sesión, A9).'),
    nombreArchivo: campoNombreArchivo,
    archivoBase64: campoArchivoBase64,
    mapeo: esquemaMapeoImportacion,
    ocCliente: z
      .string()
      .trim()
      .max(100, { error: 'La OC del cliente no puede tener más de 100 caracteres' })
      .nullable()
      .optional()
      .describe('OC original del cliente (referencia; se guarda como snapshot en cada OP, B3).'),
    resoluciones: z
      .array(esquemaResolucionImportacion)
      .default([])
      .describe('Ligas manuales de los modelos que no se reconocieron solos.'),
  })
  .describe('Confirma la importación: crea pedido interno + OPs + RC.');

/** Datos validados de confirmar. */
export type DatosConfirmarImportacion = z.infer<typeof esquemaConfirmarImportacionCuerpo>;

/** Una OP nacida de la importación. */
export const esquemaOrdenImportada = z
  .object({
    idOrden: z.number().int().describe('Id de la OP creada.'),
    folio: z.number().int().describe('Folio de la OP (por empresa).'),
    numeroProduccion: z.number().int().describe('Nº interno de producción minteado/reusado.'),
    codigoModelo: z.string().describe('Nº de desarrollo del modelo.'),
    modeloCliente: z.string().describe('Nº/estilo del modelo del cliente (del archivo).'),
    totalPiezas: z.number().int().describe('Piezas de la OP (Σ de la matriz).'),
  })
  .describe('Una OP creada por la importación.');

/** Forma de una OP importada. */
export type OrdenImportada = z.infer<typeof esquemaOrdenImportada>;

/** Respuesta de confirmar: el pedido nacido + las OPs + los modelos que quedaron fuera. */
export const esquemaConfirmarImportacionSalida = z
  .object({
    idPedido: z.number().int().describe('Id del pedido interno creado.'),
    folioPedido: z.number().int().describe('Folio del pedido (por empresa).'),
    ordenes: z.array(esquemaOrdenImportada).describe('OPs creadas (una por modelo reconocido).'),
    noReconocidos: z
      .array(z.string())
      .describe('Modelos del cliente que quedaron SIN desarrollo (no se importaron).'),
  })
  .describe('Resultado de la importación (pedido + OPs + no reconocidos).');

/** Forma de la respuesta de confirmar. */
export type ConfirmarImportacionSalida = z.infer<typeof esquemaConfirmarImportacionSalida>;
