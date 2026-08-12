import { z } from 'zod';

/**
 * Esquemas Zod de CAPTURA del módulo Pedidos (F2-E1) — SOLO para la UX del formulario
 * (mensajes en español, requeridos). Reflejan las reglas del backend pero NO las reemplazan:
 * el servidor re-valida y es la autoridad (A1). Los números/fechas se capturan como texto en
 * los `<input>` y se convierten al cuerpo del API al enviar.
 */

/** Un renglón del pedido en el formulario (cantidad/precio como texto del input). */
export const esquemaRenglonFormulario = z.object({
  /** Id del renglón existente (solo edición); vacío = renglón nuevo. */
  id: z.number().int().positive().optional(),
  /** Id del modelo elegido en el selector (texto del `<select>`). */
  idModelo: z.string().min(1, { error: 'Elige un modelo' }),
  cantidadPedida: z
    .string()
    .min(1, { error: 'La cantidad es obligatoria' })
    .refine((v) => Number.isInteger(Number(v)) && Number(v) >= 1, {
      error: 'La cantidad debe ser un entero ≥ 1',
    }),
  // El precio es texto y puede quedar VACÍO: un usuario sin `pedidos.importes` no lo captura
  // (el campo va oculto). Solo se valida cuando trae valor; vacío = "no capturado" y no viaja al
  // API (el backend conserva el precio almacenado o usa 0 en un renglón nuevo).
  precio: z
    .string()
    .refine((v) => v.trim() === '' || (!Number.isNaN(Number(v)) && Number(v) >= 0), {
      error: 'El precio no puede ser negativo',
    }),
});

/** Datos de captura de un renglón. */
export type DatosRenglonFormulario = z.infer<typeof esquemaRenglonFormulario>;

/** Formulario del pedido: cliente + fechas + bandera "no producir" + renglones. */
export const esquemaPedidoFormulario = z.object({
  idCliente: z.string().min(1, { error: 'Elige un cliente' }),
  fechaPedido: z.string(),
  fechaDe: z.string(),
  fechaHasta: z.string(),
  fechaTela: z.string(),
  fechaElaboracion: z.string(),
  /**
   * NO PRODUCIR (V1-E3a, §Post-F9.36 punto 3): el backend RECHAZA "Generar OP" de un pedido con esta
   * bandera (`dominio/produccion/ordenes.ts`), y hasta hoy el campo no aparecía en NINGUNA pantalla
   * — los pedidos migrados de Access la traen, así que el bloqueo no tenía salida. Ahora se ve y se
   * puede quitar (y poner).
   */
  noProducir: z.boolean(),
  renglones: z.array(esquemaRenglonFormulario),
});

/** Datos de captura del pedido. */
export type DatosPedidoFormulario = z.infer<typeof esquemaPedidoFormulario>;

/** Formulario del encabezado de un pedido real. */
export const esquemaPedidoRealFormulario = z.object({
  numPedReal: z.string(),
  cedis: z.string(),
  apertura: z.string(),
  fechaPedPR: z.string(),
  fechaInicio: z.string(),
  fechaFin: z.string(),
});

/** Datos de captura del encabezado de un pedido real. */
export type DatosPedidoRealFormulario = z.infer<typeof esquemaPedidoRealFormulario>;

/** Convierte un texto de fecha del input a `YYYY-MM-DD` o `undefined` si está vacío. */
export function fechaACuerpo(valor: string): string | undefined {
  const limpio = valor.trim();
  return limpio.length > 0 ? limpio : undefined;
}

/** Convierte un texto de fecha del input a `YYYY-MM-DD` o `null` (para vaciar en PATCH). */
export function fechaACuerpoEditar(valor: string): string | null {
  const limpio = valor.trim();
  return limpio.length > 0 ? limpio : null;
}
