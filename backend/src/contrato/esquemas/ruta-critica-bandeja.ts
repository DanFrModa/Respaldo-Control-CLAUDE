import { z } from 'zod';

import { esquemaEstadoSemaforo } from './ruta-critica-programacion.js';

/**
 * Esquemas Zod de la BANDEJA "mis tareas" + el conteo de alertas de la RUTA CRÍTICA (Módulo 8,
 * F5-E5; doc `08-Ruta-Critica.md` §4; D11). UNA sola definición de reglas para UI y servidor
 * (alimenta el OpenAPI).
 *
 * Son CONSULTAS de SOLO LECTURA:
 *  • La BANDEJA lista las tareas ACTIVAS (renglones `RutaOrden` con `estado='activo'`: el motor
 *    mantiene 'activo' = sin `fechaReal` y con TODOS sus antecesores completados) de órdenes con la
 *    RC activa donde —por defecto— el usuario es responsable del proceso (intersección de sus roles
 *    con `ProcesoDefRol`, la MISMA regla N:M que la captura). El `semaforo`/`diasAtraso` los DERIVA
 *    el dominio (A1: cero lógica de semáforo en el frontend).
 *  • El CONTEO de alertas resume MIS tareas activas en `{ atrasados, enRiesgo }` para el badge del
 *    header.
 *
 * El flag por querystring `todas` se RE-VALIDA en el dominio con un esquema local `z.boolean()` (no
 * el `stringbool` del contrato): evita el 400 espurio del hotfix F2 (PR #56) al re-validar.
 */

// ── Bandeja "mis tareas": filtros de la URL ─────────────────────────────────────────────────────

/**
 * Filtros de la BANDEJA en la URL (querystring). Filtros opcionales por proceso/orden + búsqueda de
 * cliente, el flag `todas` (supervisión: todas las tareas activas de la empresa, no solo las del
 * usuario; requiere permiso de programación) y paginación estándar (tope 100).
 */
export const esquemaBandejaRcQuery = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1).describe('Página (1-based).'),
    porPagina: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Renglones por página (tope 100).'),
    idProcesoDef: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Filtra por un tipo de proceso (ProcesoDef).'),
    idOrden: z.coerce.number().int().positive().optional().describe('Filtra por una orden.'),
    busquedaCliente: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('Texto a buscar en el nombre del cliente.'),
    todas: z
      .stringbool()
      .default(false)
      .describe(
        'Supervisión: si true (y con permiso), muestra TODAS las tareas activas de la empresa, ' +
          'no solo las de los roles del usuario.',
      ),
  })
  .describe('Filtros y paginación de la bandeja "mis tareas" de la Ruta Crítica.');

/** Parámetros de la bandeja ya coaccionados desde la URL. */
export type BandejaRcQuery = z.infer<typeof esquemaBandejaRcQuery>;

// ── Bandeja "mis tareas": salida ────────────────────────────────────────────────────────────────

/** Un ítem de checklist de la tarea (renglón de la bandeja). */
export const esquemaBandejaChecklistSalida = z.object({
  id: z.number().int().describe('Id del ítem de checklist.'),
  descripcion: z.string().describe('Texto del punto a verificar.'),
  orden: z.number().int().describe('Posición del ítem en el checklist.'),
  hecho: z.boolean().describe('¿Ya se verificó este punto en esta orden?'),
});

/**
 * Una TAREA de la bandeja = un proceso ACTIVO de la ruta viva de una orden, listo para que su
 * responsable lo capture. Trae lo que la pantalla necesita para listar/priorizar sin más viajes:
 * encabezado de la orden, el proceso, su semáforo/atraso y su checklist.
 */
export const esquemaBandejaTareaSalida = z
  .object({
    idRutaOrden: z.number().int().describe('Id del renglón de ruta (proceso×orden) a capturar.'),
    idOrden: z.number().int().describe('Id de la orden.'),
    folioOrden: z.number().int().describe('Folio consecutivo de la orden (por empresa).'),
    cliente: z.string().describe('Nombre del cliente de la orden.'),
    idModelo: z.number().int().describe('Modelo a producir.'),
    codigoModelo: z.string().describe('Código del modelo.'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    idProcesoDef: z.number().int().describe('Tipo de proceso (ProcesoDef).'),
    codigoProceso: z.string().describe('Código del proceso (kebab-case).'),
    nombreProceso: z.string().describe('Nombre del proceso (para la UI).'),
    critico: z.boolean().describe('¿Es un proceso crítico de la ruta?'),
    fechaPlaneadaVigente: z.iso
      .datetime()
      .nullable()
      .describe('Fecha planeada vigente del proceso (CPM, E4), o null si aún no se ha fechado.'),
    diasAtraso: z
      .number()
      .int()
      .describe('Días NATURALES vencidos respecto a la planeada vigente (>0 si vencida; 0 si no).'),
    semaforo: esquemaEstadoSemaforo.describe(
      'Semáforo de cumplimiento del proceso (HOY vs planeada vigente).',
    ),
    parcialEnCurso: z
      .boolean()
      .describe('¿Hay una entrada PARCIAL en curso (auto-avance, F5-E6)? La tarea sigue activa.'),
    checklist: z
      .array(esquemaBandejaChecklistSalida)
      .describe('Ítems de checklist del proceso (snapshot por orden).'),
  })
  .describe('Una tarea activa de la bandeja "mis tareas" de la Ruta Crítica.');

/** Forma de una tarea de la bandeja. */
export type BandejaTareaSalida = z.infer<typeof esquemaBandejaTareaSalida>;

/** Respuesta paginada de la bandeja "mis tareas" (forma estándar `Pagina<T>`). */
export const esquemaBandejaRcPagina = z
  .object({
    datos: z.array(esquemaBandejaTareaSalida).describe('Tareas activas de la página.'),
    total: z.number().int().describe('Total de tareas que cumplen el filtro.'),
    pagina: z.number().int().describe('Página devuelta.'),
    porPagina: z.number().int().describe('Renglones por página.'),
    totalPaginas: z.number().int().describe('Total de páginas.'),
  })
  .describe('Página de la bandeja "mis tareas" de la Ruta Crítica.');

/** Forma de la respuesta paginada de la bandeja. */
export type BandejaRcPagina = z.infer<typeof esquemaBandejaRcPagina>;

// ── Conteo de alertas (badge del header) ────────────────────────────────────────────────────────

/** Conteo de MIS tareas activas por gravedad del semáforo (para el badge del header). */
export const esquemaAlertasRcConteo = z
  .object({
    atrasados: z.number().int().describe('Mis tareas activas atrasadas (HOY > planeada vigente).'),
    enRiesgo: z
      .number()
      .int()
      .describe('Mis tareas activas en riesgo (planeada vigente dentro del umbral).'),
  })
  .describe('Conteo de mis tareas activas atrasadas / en riesgo (badge del header).');

/** Forma del conteo de alertas. */
export type AlertasRcConteo = z.infer<typeof esquemaAlertasRcConteo>;
