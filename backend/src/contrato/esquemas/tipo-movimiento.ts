import { z } from 'zod';

/**
 * Esquemas del catálogo de TIPOS DE MOVIMIENTO DE INVENTARIO (F3-E1; ex `IPT_TiposMov`).
 *
 * Es un catálogo de SOLO LECTURA en F3-E1 (los 19 tipos se siembran; el GET los expone para que
 * las pantallas de movimientos de E3 los listen). Cada tipo lleva su `direccion` (entrada/salida/
 * traspaso), que el kardex usa para el signo de la existencia (D3, ADR-0010).
 */

/** Direcciones de movimiento (alineado con el enum `DireccionMovimiento` de `src/datos`). */
export const DIRECCIONES_MOVIMIENTO = ['entrada', 'salida', 'traspaso'] as const;

/** Dirección de un tipo de movimiento. */
export type DireccionMovimientoClave = (typeof DIRECCIONES_MOVIMIENTO)[number];

/** Etiquetas para UI de cada dirección. */
export const ETIQUETAS_DIRECCION_MOVIMIENTO: Record<DireccionMovimientoClave, string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  traspaso: 'Traspaso',
};

/** Salida de un tipo de movimiento de inventario en la API. */
export const esquemaTipoMovimientoSalida = z
  .object({
    id: z.number().int().describe('Id del tipo de movimiento.'),
    codigo: z.string().describe('Clave estable kebab-case (ej. "entrada-maquila").'),
    nombre: z.string().describe('Nombre para mostrar (ex IPT_TiposMov.TipoMov).'),
    direccion: z
      .enum(DIRECCIONES_MOVIMIENTO)
      .describe('Dirección: entrada (+), salida (−) o traspaso.'),
    activo: z.boolean().describe('Falso si está desactivado.'),
  })
  .describe('Tipo de movimiento de inventario (catálogo de solo lectura en F3).');

/** Forma de un tipo de movimiento tal como lo devuelve la API. */
export type TipoMovimientoSalida = z.infer<typeof esquemaTipoMovimientoSalida>;

/** Filtros del listado de tipos de movimiento (querystring). Lista simple, sin paginación. */
export const esquemaTiposMovimientoQuery = z
  .object({
    incluirInactivos: z
      .stringbool()
      .default(false)
      .describe('Incluye los desactivados ("true"/"false").'),
    direccion: z
      .enum(DIRECCIONES_MOVIMIENTO)
      .optional()
      .describe('Filtra por dirección (entrada/salida/traspaso).'),
  })
  .describe('Filtros del listado de tipos de movimiento.');

/** Parámetros de listado de tipos de movimiento ya coaccionados desde la URL. */
export type TiposMovimientoQuery = z.infer<typeof esquemaTiposMovimientoQuery>;

/** Respuesta del listado de tipos de movimiento (lista simple ordenada por id). */
export const esquemaTiposMovimientoLista = z
  .object({
    datos: z.array(esquemaTipoMovimientoSalida).describe('Tipos de movimiento.'),
  })
  .describe('Lista de tipos de movimiento de inventario.');

/** Forma de la respuesta de la lista de tipos de movimiento. */
export type TiposMovimientoLista = z.infer<typeof esquemaTiposMovimientoLista>;
