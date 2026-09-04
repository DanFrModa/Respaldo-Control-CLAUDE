import { z } from 'zod';

/**
 * Contrato Zod del módulo ÓRDENES DE COMPRA (F4-E2 — doc `Documentacion_MJD/03-Produccion.md`
 * §OC). La OC es el documento con el que se COMPRA material (telas/avíos) a un proveedor (ex
 * `OrdCompra`/`OrdCompraDet`). Reglas de captura aquí (las repite el dominio, A1):
 *
 *  • El folio `numCompra` lo asigna la secuencia atómica POR EMPRESA (A3/A9) — NO se captura.
 *  • El `idEmpresa` lo toma el dominio de la sesión activa (A9) — NO viaja en el cuerpo.
 *  • El `estatus` (borrador / pendiente_autorizacion / autorizada / recibida parcial o total /
 *    cancelada) lo DERIVAN/controlan los servicios; ningún cuerpo de captura lo lleva.
 *  • El TOTAL de la OC y de cada renglón se DERIVA por suma (Σ cantidad×precio): NUNCA viaja
 *    un total de entrada; en la salida sale calculado (D3).
 *  • Cada renglón es de CATÁLOGO (`idTela` XOR `idAvio`) o LIBRE (`descripcionLibre`):
 *    exactamente una de las tres (lo valida el dominio). Decisión (c): el renglón puede llevar
 *    matriz talla×color NATIVA; cuando la lleva, su `cantidad` = Σ de la matriz (valida el dominio).
 *  • La autorización/cancelación/duplicado son operaciones propias (no van por el PATCH).
 *
 * Semántica del PATCH parcial (igual que Orden/Pedido): omitir un campo (`undefined`) = no tocar;
 * mandar `null` en un opcional = vaciarlo. Las fechas date-only viajan como `YYYY-MM-DD`.
 */

// ── Matriz talla×color del renglón (decisión c) ──────────────────────────────────────

/**
 * Cantidad de una talla×color dentro de un renglón de OC (decisión (c)). `idColor`/`idTalla` del
 * catálogo + `cantidad` entera ≥0. El par (color, talla) aparece UNA vez por renglón (lo valida el
 * dominio); la suma de la matriz = `cantidad` del renglón.
 */
export const esquemaCompraLineaTallaEntrada = z.object({
  idColor: z
    .number({ error: 'El color es obligatorio' })
    .int({ error: 'El id del color debe ser entero' })
    .positive({ error: 'El id del color debe ser positivo' })
    .describe('Color del catálogo (F1).'),
  idTalla: z
    .number({ error: 'La talla es obligatoria' })
    .int({ error: 'El id de la talla debe ser entero' })
    .positive({ error: 'El id de la talla debe ser positivo' })
    .describe('Talla del catálogo (D4).'),
  cantidad: z
    .number({ error: 'La cantidad es obligatoria' })
    .int({ error: 'La cantidad debe ser un número entero' })
    .min(0, { error: 'La cantidad no puede ser negativa' })
    .describe('Cantidad de esta talla×color.'),
});

/** Datos validados de una cantidad de la matriz talla×color. */
export type DatosCompraLineaTallaEntrada = z.infer<typeof esquemaCompraLineaTallaEntrada>;

// ── Renglón de la OC ──────────────────────────────────────────────────────────────────

/**
 * Renglón de la OC: un material a comprar. De CATÁLOGO (`idTela` XOR `idAvio`) o LIBRE
 * (`descripcionLibre`); exactamente una de las tres (lo valida el dominio). `cantidad`/`precio`
 * son decimales positivos. `idOrden` (orden de PRODUCCIÓN) liga POR LÍNEA para R7 (opcional).
 * `tallas` es la matriz opcional (decisión (c)); si viene, Σ = `cantidad`.
 */
export const esquemaCompraLineaEntrada = z.object({
  idTela: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe('Tela del catálogo (XOR avío/libre).'),
  idAvio: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe('Avío del catálogo (XOR tela/libre).'),
  idAvioProveedor: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe('Avío del AvioProveedor que da el precio R1 (traza; solo en líneas de avío).'),
  idTelaColor: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      '⭐⭐ V1-E3u (§Post-F9.89) — COLOR de la tela que se pide. Daniel: *"debo de tener la ' +
        'posibilidad de ir comprando esa tela en diferentes colores (y pantones)"*. Sólo en líneas ' +
        'de TELA, y tiene que ser un color de ESA tela (lo valida el dominio). Omitir/`null` = se ' +
        'pide sin decir el color, que es como funcionó el sistema hasta esta etapa y como siguen ' +
        'las OC migradas — se permite para no romper lo que ya existe, pero la recepción no puede ' +
        'cruzarlo contra lo que llega.',
    ),
  idColorPrenda: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      '⭐⭐ V1-E8c (§Post-F9.126) — COLOR DE PRENDA con el que se pide el AVÍO. Daniel: *"cada color ' +
        'es diferente y cada color tiene cantidades por medida… En la receta no viene definido el ' +
        'color. Eso viene hasta que nos hacen el pedido"*. Es la IDENTIDAD del renglón: por ella la ' +
        'explosión netea lo ya comprado. Sólo en líneas de AVÍO (lo valida el dominio). Omitir/' +
        '`null` = se pide sin decir el color, como todas las OC anteriores a esta etapa.',
    ),
  colorAvio: z
    .string()
    .trim()
    .max(120, { error: 'El color del avío no puede tener más de 120 caracteres' })
    .nullable()
    .optional()
    .describe(
      '⭐⭐ V1-E8c (§Post-F9.126) — EL COLOR QUE LEE EL PROVEEDOR, como texto. Daniel: *"poner 4 ' +
        'veces el cierre y en la descripción del avío ponerle el color"*. Nace precargado con el ' +
        'nombre del color de la prenda y es EDITABLE (el avío puede ir en contraste). Es texto y no ' +
        'un catálogo a propósito (§Post-F9.91). Sólo en líneas de AVÍO.',
    ),
  medidas: z
    .array(
      z.object({
        idAvioMedida: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe('Medida del catálogo del avío, o null = la cubeta "Sin medida".'),
        etiqueta: z
          .string()
          .trim()
          .min(1, { error: 'La etiqueta de la medida es obligatoria' })
          .max(60, { error: 'La etiqueta de la medida no puede tener más de 60 caracteres' })
          .describe('Etiqueta congelada de la medida ("53 cm") o "Sin medida".'),
        cantidad: z
          .number({ error: 'La cantidad de la medida es obligatoria' })
          .min(0, { error: 'La cantidad de la medida no puede ser negativa' })
          .describe('Cuánto de esa medida.'),
        orden: z.number().int().min(0).optional().describe('Orden de despliegue (0 por omisión).'),
      }),
    )
    .optional()
    .describe(
      '⭐⭐ V1-E8c (§Post-F9.126) — DESGLOSE POR MEDIDA del renglón de AVÍO (cierres, jaretas, ' +
        'cintas palmita). 🔴 **La medida NO parte el renglón: va en una tablita debajo**, porque no ' +
        'se recibe por medida (llegan "3,200 cierres"). Si viene, **Σ de sus cantidades = ' +
        '`cantidad`** y sus etiquetas no se repiten (lo valida el dominio). Sólo en líneas de AVÍO.',
    ),
  cantidad: z
    .number({ error: 'La cantidad es obligatoria' })
    .positive({ error: 'La cantidad debe ser mayor a cero' })
    .describe('Cantidad a comprar (en unidad). Si usa matriz, debe ser Σ de la matriz.'),
  unidad: z
    .string()
    .trim()
    .max(50, { error: 'La unidad no puede tener más de 50 caracteres' })
    .nullable()
    .optional()
    .describe(
      'Unidad de compra, que es SIEMPRE la unidad de CONSUMO (m, pza, kg) — §Post-F9.97: la ' +
        'presentación (rollo, caja) no es una unidad del sistema, y escribirla aquí NO hace que ' +
        'nada se convierta. En renglones de TELA se IGNORA lo que venga: la fija la unidad de la ' +
        'tela (§Post-F9.18).',
    ),
  precio: z
    .number({ error: 'El precio es obligatorio' })
    .min(0, { error: 'El precio no puede ser negativo' })
    .describe(
      'Precio unitario de la línea (D1: precio actual). En tela con complemento, del cuerpo.',
    ),
  cantidadComplemento: z
    .number()
    .positive({ error: 'La cantidad del complemento debe ser mayor a cero' })
    .nullable()
    .optional()
    .describe(
      'Cantidad del COMPLEMENTO (Cardigan). OBLIGATORIA en telas que definen complemento; ' +
        'prohibida en avíos, líneas libres y telas sin complemento (lo valida el dominio).',
    ),
  precioComplemento: z
    .number()
    .min(0, { error: 'El precio del complemento no puede ser negativo' })
    .nullable()
    .optional()
    .describe('Precio unitario del complemento. Si no viene, se cobra al precio del cuerpo.'),
  cantidadSugerida: z
    .number()
    .min(0, { error: 'La cantidad sugerida no puede ser negativa' })
    .nullable()
    .optional()
    .describe(
      '⭐ V1-E3u (§Post-F9.89(a)) — LO QUE EL SISTEMA CALCULÓ para esta línea, guardado junto a lo ' +
        'que se pidió. Lo llena la generación desde la explosión; una OC capturada a mano lo deja ' +
        'en `null` (no hay contra qué medir un desvío). Es el DATO con el que la bandeja de ' +
        'autorización arma el aviso — el aviso no se guarda como texto, para que no envejezca.',
    ),
  idOrden: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe('Orden de PRODUCCIÓN ligada (R7, liga por línea; opcional).'),
  descripcionLibre: z
    .string()
    .trim()
    .max(500, { error: 'La descripción no puede tener más de 500 caracteres' })
    .nullable()
    .optional()
    .describe('Descripción libre (SOLO líneas no catalogadas; con tela/avío null).'),
  tallas: z
    .array(esquemaCompraLineaTallaEntrada)
    .optional()
    .describe('Matriz talla×color opcional (decisión c); si viene, Σ = cantidad.'),
});

/** Datos validados de un renglón de OC. */
export type DatosCompraLineaEntrada = z.infer<typeof esquemaCompraLineaEntrada>;

// ── Encabezado: campos comunes a alta/edición ────────────────────────────────────────

/**
 * Fecha de ENTREGA del encabezado (date-only). Devuelta por una función para no reusar la MISMA
 * instancia de ZodObject en alta y edición.
 *
 * §Post-F9.18 (Daniel): la fecha de entrega es **obligatoria** — sin ella la OC no se puede
 * perseguir, y era el campo que más se quedaba vacío. Y NO es nullable: una vez capturada no se
 * puede vaciar (el histórico migrado sí la trae en NULL; eso no se toca).
 *
 * La fecha de EMISIÓN ya no se captura: la pone el SERVIDOR con el día en que se crea la OC
 * (*"la fecha de creación de la OC es la del día que se hace, sin opción a cambiarla"*), así que
 * no viaja en ningún cuerpo de entrada.
 */
function campoFechaEntrega() {
  return {
    fechaEntrega: z.iso
      .date({ error: 'La fecha de entrega no es válida' })
      .describe('Fecha de entrega esperada (YYYY-MM-DD). Obligatoria.'),
  } as const;
}

// ── Alta de una OC ────────────────────────────────────────────────────────────────────

/**
 * Alta de una orden de compra. `idProveedor` obligatorio; el resto del encabezado opcional. Las
 * `lineas` pueden venir en el alta (al menos una recomendada, pero el dominio permite OC vacía en
 * borrador). El estado inicial es `borrador` (lo pone el dominio).
 */
export const esquemaCompraCrear = z.object({
  idProveedor: z
    .number({ error: 'El proveedor es obligatorio' })
    .int({ error: 'El id del proveedor debe ser entero' })
    .positive({ error: 'El id del proveedor debe ser positivo' })
    .describe('Proveedor al que se le compra.'),
  ...campoFechaEntrega(),
  idDireccionEntrega: z
    .number({ error: 'La dirección de entrega es obligatoria' })
    .int({ error: 'El id de la dirección debe ser entero' })
    .positive({ error: 'El id de la dirección debe ser positivo' })
    .describe('Dirección de entrega DEL CATÁLOGO (§Post-F9.18). Obligatoria en las OC nuevas.'),
  observaciones: z
    .string()
    .trim()
    .max(2000, { error: 'Las observaciones no pueden tener más de 2000 caracteres' })
    .nullable()
    .optional()
    .describe('Observaciones generales.'),
  correspondeA: z
    .string()
    .trim()
    .max(500, { error: 'El campo "corresponde a" no puede tener más de 500 caracteres' })
    .nullable()
    .optional()
    .describe('A qué corresponde la compra (texto libre).'),
  lineas: z
    .array(esquemaCompraLineaEntrada)
    .default([])
    .describe('Renglones de la OC (materiales a comprar).'),
});

/** Datos validados de alta de OC. */
export type DatosCompraCrear = z.infer<typeof esquemaCompraCrear>;

/**
 * Edición de una OC (encabezado + reemplazo del SET de líneas). Campos de encabezado opcionales
 * (nullable para vaciar). `lineas`, si viene, REEMPLAZA el set completo (el dominio sincroniza). El
 * `id` va en la URL (no en el cuerpo del PATCH).
 */
export const esquemaCompraEditarCuerpo = z.object({
  idProveedor: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Proveedor (solo editable en borrador/pendiente).'),
  // Opcional (no tocar si se omite) pero NO nullable: una vez capturada no se vacía.
  fechaEntrega: campoFechaEntrega().fechaEntrega.optional(),
  // La dirección se puede cambiar, pero no quitar (mismo criterio que la fecha de entrega).
  idDireccionEntrega: esquemaCompraCrear.shape.idDireccionEntrega.optional(),
  observaciones: esquemaCompraCrear.shape.observaciones,
  correspondeA: esquemaCompraCrear.shape.correspondeA,
  lineas: z
    .array(esquemaCompraLineaEntrada)
    .optional()
    .describe('Set COMPLETO de renglones (si viene, reemplaza los actuales).'),
});

/** Datos validados del cuerpo del PATCH de OC. */
export type DatosCompraEditarCuerpo = z.infer<typeof esquemaCompraEditarCuerpo>;

// ── Cancelar ──────────────────────────────────────────────────────────────────────────

/** Cuerpo de cancelar una OC (cancelación SUAVE): el motivo es OBLIGATORIO. */
export const esquemaCompraCancelarCuerpo = z.object({
  motivo: z
    .string({ error: 'El motivo de cancelación es obligatorio' })
    .trim()
    .min(1, { error: 'El motivo de cancelación es obligatorio' })
    .max(2000, { error: 'El motivo no puede tener más de 2000 caracteres' })
    .describe('Motivo de la cancelación (obligatorio).'),
});

/** Datos validados del cuerpo de cancelar. */
export type DatosCompraCancelar = z.infer<typeof esquemaCompraCancelarCuerpo>;

// ── Des-autorizar (⭐ V1-E3y, §Post-F9.79) ────────────────────────────────────────────

/**
 * Cuerpo de DES-AUTORIZAR una OC: el motivo es OBLIGATORIO, como en la cancelación.
 *
 * Quitar la firma de una compra es un acto de la misma gravedad que cancelarla —el proveedor ya
 * tenía un compromiso enfrente—, así que se exige decir por qué y queda en la bitácora (A7/D3).
 */
export const esquemaCompraDesautorizarCuerpo = z.object({
  motivo: z
    .string({ error: 'El motivo para des-autorizar es obligatorio' })
    .trim()
    .min(1, { error: 'El motivo para des-autorizar es obligatorio' })
    .max(2000, { error: 'El motivo no puede tener más de 2000 caracteres' })
    .describe('Motivo por el que se quita la autorización (obligatorio).'),
});

/** Datos validados del cuerpo de des-autorizar. */
export type DatosCompraDesautorizar = z.infer<typeof esquemaCompraDesautorizarCuerpo>;

// ── Salidas ─────────────────────────────────────────────────────────────────────────────

/** Estatus de la OC tal como sale al cliente. */
export const esquemaEstatusOrdenCompra = z
  .enum([
    'borrador',
    'pendiente_autorizacion',
    'autorizada',
    'recibida_parcial',
    'recibida_total',
    'cancelada',
  ])
  .describe('Estatus de la orden de compra (controlado por los servicios).');

/** Cantidad de la matriz talla×color en la salida (con etiquetas para la UI). */
export const esquemaCompraLineaTallaSalida = z
  .object({
    idColor: z.number().int().describe('Id del color.'),
    color: z.string().describe('Nombre del color (para la UI).'),
    idTalla: z.number().int().describe('Id de la talla.'),
    etiquetaTalla: z.string().describe('Etiqueta de la talla (para la UI).'),
    cantidad: z.number().int().describe('Cantidad de esta talla×color.'),
  })
  .describe('Cantidad de la matriz talla×color de un renglón de OC.');

/** Forma de una cantidad de la matriz en la API. */
export type CompraLineaTallaSalida = z.infer<typeof esquemaCompraLineaTallaSalida>;

/** Renglón de la OC en la salida (con nombres del material y subtotal derivado). */
export const esquemaCompraLineaSalida = z
  .object({
    id: z.number().int().describe('Id del renglón.'),
    idTela: z.number().int().nullable().describe('Tela del catálogo, o null.'),
    tela: z.string().nullable().describe('Nombre de la tela, o null.'),
    nombreComplementoTela: z
      .string()
      .nullable()
      .describe('Cómo se llama el complemento de esa tela ("Cardigan"); null = no lleva.'),
    cantidadComplemento: z
      .number()
      .nullable()
      .describe('Cantidad del complemento comprada en este renglón, o null.'),
    precioComplemento: z
      .number()
      .nullable()
      .describe('Precio unitario del complemento; null = al precio del cuerpo.'),
    idAvio: z.number().int().nullable().describe('Avío del catálogo, o null.'),
    avio: z.string().nullable().describe('Clave/descripción del avío, o null.'),
    idAvioProveedor: z
      .number()
      .int()
      .nullable()
      .describe('Avío del AvioProveedor del precio, o null.'),
    idTelaColor: z
      .number()
      .int()
      .nullable()
      .describe('⭐⭐ V1-E3u: color de tela que pide este renglón (§Post-F9.89), o null.'),
    telaColor: z.string().nullable().describe('Nombre del color de tela, o null.'),
    idColorPrenda: z
      .number()
      .int()
      .nullable()
      .describe('⭐⭐ V1-E8c (§Post-F9.126): color de PRENDA con el que se pidió el avío, o null.'),
    colorPrenda: z
      .string()
      .nullable()
      .describe('Nombre de ese color de prenda (el que el sistema propuso), o null.'),
    colorAvio: z
      .string()
      .nullable()
      .describe(
        '⭐⭐ V1-E8c (§Post-F9.126): el color del avío tal como lo lee el PROVEEDOR (texto ' +
          'editable), o null. Puede diferir de `colorPrenda` cuando el avío va en contraste.',
      ),
    medidas: z
      .array(
        z.object({
          idAvioMedida: z.number().int().nullable().describe('Medida del catálogo, o null.'),
          etiqueta: z.string().describe('Etiqueta congelada ("53 cm" / "Sin medida").'),
          cantidad: z.number().describe('Cuánto de esa medida (Σ = cantidad del renglón).'),
          orden: z.number().int().describe('Orden de despliegue.'),
        }),
      )
      .describe(
        '⭐⭐ V1-E8c (§Post-F9.126): desglose por medida del renglón (vacío si no aplica). Es ' +
          'información PARA EL PROVEEDOR: no se recibe por medida.',
      ),
    pantoneTelaColor: z
      .string()
      .nullable()
      .describe('Pantone de ese color de tela (para el impreso y para quien recibe), o null.'),
    descripcionLibre: z
      .string()
      .nullable()
      .describe('Descripción libre (líneas no catalogadas), o null.'),
    cantidad: z.number().describe('Cantidad a comprar.'),
    cantidadSugerida: z
      .number()
      .nullable()
      .describe('⭐ V1-E3u: lo que el sistema propuso para esta línea; null = capturada a mano.'),
    avisoDesvio: z
      .string()
      .nullable()
      .describe(
        '⭐ V1-E3u (§Post-F9.89(a)) — EL AVISO PARA QUIEN AUTORIZA, cuando lo pedido se aparta de ' +
          'lo calculado más allá del porcentaje de la empresa. `null` = no hay nada que avisar. ' +
          '🔴 Es un AVISO: nada aquí impide autorizar la OC (§Post-F9.64, guía no jaula).',
      ),
    unidad: z
      .string()
      .nullable()
      .describe('Unidad de compra —siempre la de CONSUMO, §Post-F9.97—, o null.'),
    precio: z.number().describe('Precio unitario de la línea.'),
    subtotal: z
      .number()
      .describe('Subtotal derivado del renglón (cuerpo + complemento, si lo lleva).'),
    idOrden: z.number().int().nullable().describe('Orden de producción ligada (R7), o null.'),
    folioOrden: z
      .number()
      .int()
      .nullable()
      .describe('Folio de la orden ligada (para la UI), o null.'),
    tallas: z
      .array(esquemaCompraLineaTallaSalida)
      .describe('Matriz talla×color (vacía si no aplica).'),
  })
  .describe('Renglón de una orden de compra.');

/** Forma de un renglón de OC en la API. */
export type CompraLineaSalida = z.infer<typeof esquemaCompraLineaSalida>;

/** Orden de producción ligada a la OC (a nivel encabezado). */
export const esquemaCompraOrdenLigadaSalida = z
  .object({
    idOrden: z.number().int().describe('Id de la orden de producción.'),
    folio: z.number().int().describe('Folio de la orden de producción.'),
  })
  .describe('Liga (encabezado) a una orden de producción.');

/** Forma de una liga a orden en la API. */
export type CompraOrdenLigadaSalida = z.infer<typeof esquemaCompraOrdenLigadaSalida>;

/**
 * Salida de una OC (proyección a JSON). Incluye el encabezado, las líneas (con matriz y subtotal
 * derivado), las órdenes ligadas y el TOTAL derivado por suma (Σ subtotales).
 */
export const esquemaCompraSalida = z
  .object({
    id: z.number().int().describe('Id interno de la OC.'),
    numCompra: z.number().int().describe('Folio consecutivo por empresa.'),
    idEmpresa: z.number().int().describe('Empresa dueña de la OC y del folio.'),
    estatus: esquemaEstatusOrdenCompra,
    idProveedor: z.number().int().describe('Proveedor.'),
    proveedor: z.string().describe('Nombre del proveedor (para la UI).'),
    /**
     * ⭐⭐ FILA 0.129 — ¿ESTE PROVEEDOR FACTURA? Es lo que decide qué pasa con la deuda al RECIBIR
     * (`dominio/terceros/cargo-de-entrada.ts`), y la pantalla de recepción lo tiene que poder decir
     * ANTES de confirmar: *"nace un cargo sin factura por $X"* o *"factura pendiente"*.
     *
     * Se DERIVA de `Proveedor.modalidadFacturacion` con `emiteFactura()` —la única fuente desde la
     * fila 0.124—: `solo_sin` ⇒ `sin-factura`; `solo_con`/`ambos` ⇒ `factura`; NULL ⇒ `no-definida`
     * (los migrados de Access, a los que nadie se lo preguntó). Viaja ya traducido para que la
     * pantalla no repita la regla: quién factura lo decide el servidor, en un solo lugar (A1).
     */
    modalidadFacturaProveedor: z
      .enum(['factura', 'sin-factura', 'no-definida'])
      .describe(
        '¿El proveedor emite factura (CFDI)? Decide qué deuda nace al recibir (fila 0.129).',
      ),
    fecha: z.iso.date().nullable().describe('Fecha de emisión (YYYY-MM-DD), o null.'),
    fechaEntrega: z.iso.date().nullable().describe('Fecha de entrega esperada, o null.'),
    idDireccionEntrega: z
      .number()
      .int()
      .nullable()
      .describe('Dirección de entrega del catálogo (§Post-F9.18); null en las migradas.'),
    direccionEntregaNombre: z
      .string()
      .nullable()
      .describe('Nombre corto de la dirección elegida (para la UI), o null.'),
    entregaEn: z.string().nullable().describe('Dónde se entrega, o null.'),
    observaciones: z.string().nullable().describe('Observaciones, o null.'),
    correspondeA: z.string().nullable().describe('A qué corresponde la compra, o null.'),
    facturasAmparadasLegacy: z
      .string()
      .nullable()
      .describe('Facturas amparadas en v1 (solo lectura, lo llena el ETL), o null.'),
    idUsuAutorizado: z.string().nullable().describe('Usuario que autorizó, o null.'),
    fechaAutorizado: z.iso.datetime().nullable().describe('Fecha de autorización (ISO), o null.'),
    canceladaEn: z.iso.datetime().nullable().describe('Fecha de cancelación (ISO), o null.'),
    canceladaPorId: z.string().nullable().describe('Usuario que canceló, o null.'),
    motivoCancelacion: z.string().nullable().describe('Motivo de la cancelación, o null.'),
    lineas: z.array(esquemaCompraLineaSalida).describe('Renglones de la OC.'),
    ordenesLigadas: z
      .array(esquemaCompraOrdenLigadaSalida)
      .describe('Órdenes de producción ligadas (encabezado).'),
    total: z.number().describe('Total derivado de la OC (Σ cantidad×precio).'),
    creadoEn: z.iso.datetime().describe('Fecha de alta (ISO 8601).'),
    creadoPorId: z.string().nullable().describe('Id del usuario que la creó.'),
    modificadoEn: z.iso.datetime().describe('Fecha de la última modificación (ISO 8601).'),
    modificadoPorId: z.string().nullable().describe('Id del último usuario que la modificó.'),
  })
  .describe('Orden de compra (encabezado + líneas + matriz + órdenes ligadas + total).');

/** Forma de una OC en la API. */
export type CompraSalida = z.infer<typeof esquemaCompraSalida>;

// ── Listado / búsqueda ────────────────────────────────────────────────────────────────

/**
 * Parámetros del listado de OC EN LA URL (querystring). Filtros por proveedor/estatus/rango de
 * fechas + búsqueda (folio o nombre de proveedor), orden y paginación de servidor.
 */
export const esquemaListarCompras = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página.'),
    busqueda: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('Texto a buscar (folio o nombre de proveedor).'),
    idProveedor: z.coerce.number().int().positive().optional().describe('Filtra por proveedor.'),
    estatus: esquemaEstatusOrdenCompra.optional().describe('Filtra por estatus.'),
    fechaDesde: z.iso.date().optional().describe('Filtra por fecha de emisión ≥ (YYYY-MM-DD).'),
    fechaHasta: z.iso.date().optional().describe('Filtra por fecha de emisión ≤ (YYYY-MM-DD).'),
    idOrden: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Filtra las OC ligadas a una orden de producción (R7; pantalla "Compras por orden").',
      ),
    incluirCanceladas: z
      .stringbool()
      .default(false)
      .describe('Incluye las OC canceladas (cancelación suave).'),
    ordenarPor: z
      .enum(['numCompra', 'fecha', 'fechaEntrega', 'creadoEn'])
      .default('numCompra')
      .describe('Columna de orden.'),
    direccion: z.enum(['asc', 'desc']).default('desc').describe('Dirección del orden.'),
  })
  .describe('Filtros, orden y paginación del listado de OC.');

/** Parámetros de listado de OC ya coaccionados desde la URL. */
export type ListarCompras = z.infer<typeof esquemaListarCompras>;

/** Respuesta paginada del listado de OC (forma estándar `Pagina<T>`). */
export const esquemaComprasPagina = z
  .object({
    datos: z.array(esquemaCompraSalida).describe('OC de la página.'),
    total: z.number().int().describe('Total de OC que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de órdenes de compra.');

/** Forma de la respuesta paginada de OC. */
export type ComprasPagina = z.infer<typeof esquemaComprasPagina>;

// ── Resumen de cabecera (KPIs `vCompras`, rediseño R9) ─────────────────────────────────

/**
 * Filtros del resumen de OC (querystring). Sub-conjunto de los del listado que ACOTAN el universo
 * de "OC abiertas": proveedor, rango de fecha de emisión, búsqueda (folio/proveedor) y orden ligada.
 * El estatus NO se recibe: el resumen SIEMPRE mira las OC abiertas (autorizada + recibida_parcial).
 */
export const esquemaResumenComprasQuery = z
  .object({
    busqueda: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('Texto a buscar (folio o nombre de proveedor).'),
    idProveedor: z.coerce.number().int().positive().optional().describe('Filtra por proveedor.'),
    fechaDesde: z.iso.date().optional().describe('Filtra por fecha de emisión ≥ (YYYY-MM-DD).'),
    fechaHasta: z.iso.date().optional().describe('Filtra por fecha de emisión ≤ (YYYY-MM-DD).'),
    idOrden: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra las OC ligadas a una orden de producción (R7).'),
  })
  .describe('Filtros del resumen de órdenes de compra (KPIs de cabecera).');

/** Parámetros del resumen de OC ya coaccionados desde la URL. */
export type ResumenComprasQuery = z.infer<typeof esquemaResumenComprasQuery>;

/**
 * Resumen de cabecera de OC (KPIs `vCompras`): número de OC ABIERTAS (autorizada + recibida_parcial)
 * y el importe TODAVÍA por recibir = Σ sobre las líneas de esas OC de (cantidad − recibido) ×
 * precio, donde `recibido` es la Σ de lo recibido por línea en recepciones ACTIVAS (mismo criterio
 * que el recálculo de estatus de `recepciones.ts`). El pendiente por línea nunca es negativo.
 */
export const esquemaResumenCompras = z
  .object({
    ocAbiertas: z
      .number()
      .int()
      .describe('# de OC abiertas (autorizada + recibida_parcial) que cumplen el filtro.'),
    porRecibir: z
      .number()
      .describe('Importe pendiente de recibir (Σ (cantidad − recibido) × precio, ≥ 0).'),
  })
  .describe('Resumen de cabecera de órdenes de compra (KPIs).');

/** Forma del resumen de OC. */
export type ResumenCompras = z.infer<typeof esquemaResumenCompras>;
