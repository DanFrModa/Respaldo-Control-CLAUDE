import { z } from 'zod';

/**
 * Esquemas Zod del RESUMEN OPERATIVO (pantalla de inicio `/`, rediseño R9 — proto `vResumen`).
 * UNA sola definición de reglas para UI y servidor (alimenta el OpenAPI). Toda la lógica vive en
 * `dominio/resumen/resumen.ts` (A1); aquí solo las FORMAS.
 *
 * RBAC por BLOQUE (A4, patrón `contarAlertas`): el endpoint es uno solo, pero cada bloque respeta
 * el permiso de su dominio dueño — sin el permiso, el bloque llega `null` y el frontend oculta la
 * tarjeta. Así el Resumen nunca filtra datos que la sesión no podría ver en la pantalla dueña.
 */

// ── KPIs (tarjetas de vistazo) ────────────────────────────────────────────────────────────────────

/** Órdenes ABIERTAS: con algo pendiente en el pipeline (mismo criterio que el tablero WIP). */
const esquemaKpiOrdenesAbiertas = z.object({
  total: z
    .number()
    .int()
    .describe('Órdenes vivas con algo pendiente por etapa (criterio del tablero WIP).'),
});

/** Piezas EN PRODUCCIÓN (en poder de maquileros) = enviado − recibido − incompletas (directa, D3). */
const esquemaKpiWipMaquila = z.object({
  piezas: z
    .number()
    .int()
    .describe('Piezas en poder de maquila (enviado − recibido − incompletas, vivos; V1-E8v).'),
  maquileros: z
    .number()
    .int()
    .describe(
      'Maquileros con saldo ≠ 0 en su poder (enviado − recibido − incompletas por tercero, V1-E8v).',
    ),
});

/** Piezas CORTADAS esta semana (lun–dom ISO) + la semana anterior para la tendencia. */
const esquemaKpiCortadoSemana = z.object({
  piezas: z.number().int().describe('Σ piezas de cortes vivos de la semana ISO actual.'),
  piezasSemanaAnterior: z
    .number()
    .int()
    .describe('Σ piezas de cortes vivos de la semana ISO anterior (base de la tendencia).'),
  deltaPct: z
    .number()
    .nullable()
    .describe('Variación % vs la semana anterior (null si la anterior fue 0).'),
});

/** % de ENTREGAS A TIEMPO de la RC en los últimos 30 días (vista `kpi_entregas_a_tiempo`, F7). */
const esquemaKpiEntregasATiempo = z.object({
  porcentaje: z
    .number()
    .nullable()
    .describe('aTiempo ÷ medibles de los últimos 30 días (fracción 0–1; null sin medibles).'),
  medibles: z
    .number()
    .int()
    .describe('Órdenes medibles en la ventana (último proceso cumplido CON fecha planeada).'),
  deltaPuntos: z
    .number()
    .nullable()
    .describe('Diferencia en PUNTOS porcentuales vs los 30 días previos (null si no medible).'),
});

/** EXISTENCIA total de PT (Σ de la vista `existencia_pt`, kardex D3). */
const esquemaKpiExistenciaPt = z.object({
  piezas: z.number().int().describe('Existencia total de producto terminado (Σ kardex, D3).'),
  almacenes: z.number().int().describe('Almacenes con existencia ≠ 0.'),
});

// ── Órdenes por vencer (semáforo RC, próximos 7 días) ─────────────────────────────────────────────

/** Una orden con compromiso RC dentro de los próximos 7 días (o ya vencido). */
const esquemaOrdenPorVencer = z.object({
  idOrden: z.number().int().describe('Id de la orden.'),
  folio: z.number().int().describe('Folio de la orden (por empresa).'),
  codigoModelo: z.string().describe('Código del modelo.'),
  descripcionModelo: z.string().nullable().describe('Descripción del modelo (si la tiene).'),
  cliente: z.string().describe('Nombre del cliente.'),
  piezas: z.number().int().describe('Total pedido de la orden (Σ matriz color×talla).'),
  avancePct: z.number().int().describe('% de procesos de la RC ya cumplidos (0–100, redondeado).'),
  compromiso: z
    .string()
    .describe('Próxima fecha planeada vigente pendiente (ISO; el compromiso que apremia).'),
  semaforo: z
    .enum(['aTiempo', 'enRiesgo', 'atrasado'])
    .describe('Semáforo de la ORDEN (el peor de sus procesos, ADR-0013).'),
  etapasAtrasadas: z.number().int().describe('Procesos de la ruta ya vencidos (para el chip).'),
});

// ── Cortes por semana (gráfica de barras) ─────────────────────────────────────────────────────────

/** Piezas cortadas de UNA semana ISO (punto de la gráfica). */
const esquemaCorteSemana = z.object({
  anioSemana: z.string().describe('Semana ISO "2026-W27" (clave estable del bucket).'),
  etiqueta: z.string().describe('Etiqueta corta de la barra ("S27").'),
  piezas: z.number().int().describe('Σ piezas de cortes vivos de esa semana.'),
});

// ── Respuesta completa ────────────────────────────────────────────────────────────────────────────

/** Respuesta de `GET /resumen`: cada bloque llega `null` si la sesión no tiene su permiso. */
export const esquemaResumenOperativo = z
  .object({
    ordenesAbiertas: esquemaKpiOrdenesAbiertas
      .nullable()
      .describe('Órdenes abiertas (permiso `produccion.wip-ver`; null sin permiso).'),
    wipMaquila: esquemaKpiWipMaquila
      .nullable()
      .describe('Piezas en producción/maquila (permiso `produccion.wip-ver`; null sin permiso).'),
    cortadoSemana: esquemaKpiCortadoSemana
      .nullable()
      .describe('Cortado esta semana (permiso `produccion.wip-ver`; null sin permiso).'),
    entregasATiempo: esquemaKpiEntregasATiempo
      .nullable()
      .describe('Entregas a tiempo · últimos 30 d (permiso `indicadores.ver`; null sin permiso).'),
    existenciaPt: esquemaKpiExistenciaPt
      .nullable()
      .describe('Existencia PT (permiso `inventario-pt.ver`; null sin permiso).'),
    ordenesPorVencer: z
      .array(esquemaOrdenPorVencer)
      .nullable()
      .describe('Órdenes por vencer · próx. 7 días (permiso `rc.ruta-ver`; null sin permiso).'),
    cortesPorSemana: z
      .array(esquemaCorteSemana)
      .nullable()
      .describe(
        'Piezas cortadas por semana, últimas 7 (vieja→actual; permiso `produccion.wip-ver`).',
      ),
  })
  .describe('Resumen operativo de la portada (cada bloque respeta el permiso de su dominio).');

/** Resumen operativo (respuesta completa). */
export type ResumenOperativo = z.infer<typeof esquemaResumenOperativo>;

/** Una orden por vencer (fila de la tabla del Resumen). */
export type OrdenPorVencer = z.infer<typeof esquemaOrdenPorVencer>;

/** Un punto de la gráfica "Cortes por semana". */
export type CorteSemanaResumen = z.infer<typeof esquemaCorteSemana>;
