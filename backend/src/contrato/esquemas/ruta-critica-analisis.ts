import { z } from 'zod';

import { esquemaEstadoSemaforo } from './ruta-critica-programacion.js';

/**
 * Esquemas Zod del tablero de gestión "ANÁLISIS RC" (Módulo 8, rediseño R7; doc
 * `REDISENO-FRONTEND.md` §4.10; brecha B14). De CAPTURAR a ANALIZAR: salud de las órdenes, entrega
 * al cliente + tiempo de ciclo, alertas predictivas (CPM forward pass), riesgo por cliente,
 * desempeño del equipo (scoring + bono) y cuellos de botella por proceso.
 *
 * TODAS las agregaciones se calculan EN EL SERVIDOR (SQL/dominio), nunca pivoteando en el cliente
 * (A1; lección F5-E7). Dos consultas de SOLO LECTURA:
 *  • `GET /ruta-critica/analisis`            → salud + entrega/ciclo + alertas + riesgo cliente +
 *                                              cuellos (gate `rc.ruta-ver`).
 *  • `GET /ruta-critica/analisis/desempeno`  → scoring por persona + bono (gate `rc.programar`,
 *                                              management; MISMO permiso que ver pendientes ajenos).
 *  • `GET /ruta-critica/analisis/desempeno/excel` → el MISMO desempeño en `.xlsx`.
 */

// ── Salud de las órdenes: KPIs + triage ("órdenes que requieren atención") ─────────────────────────

/** Una orden del triage (atrasada o en riesgo) con su etapa atorada y responsable. */
export const esquemaOrdenAtencion = z
  .object({
    idOrden: z.number().int().describe('Id de la orden.'),
    folioOrden: z.number().int().describe('Folio consecutivo de la orden (por empresa).'),
    cliente: z.string().describe('Nombre del cliente.'),
    codigoModelo: z.string().describe('Código del modelo.'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    etapaAtorada: z
      .string()
      .nullable()
      .describe('Proceso más urgente sin cumplir (la etapa donde está atorada la orden).'),
    responsable: z
      .string()
      .nullable()
      .describe('Rol(es) responsable(s) de la etapa atorada (concatenados), o null.'),
    semaforo: esquemaEstadoSemaforo.describe('Semáforo de la orden (atrasado / en riesgo).'),
    holguraDias: z
      .number()
      .int()
      .describe('Urgencia en días naturales: <0 vencida, 0 hoy, >0 días restantes (holgura).'),
    fechaEntregaRC: z.iso.datetime().nullable().describe('Fecha de entrega comprometida, o null.'),
  })
  .describe('Una orden que requiere atención (triage de la salud de órdenes).');

/** Forma de una fila del triage. */
export type OrdenAtencion = z.infer<typeof esquemaOrdenAtencion>;

/** Salud de las órdenes: KPIs de la RC + la tabla de triage. */
export const esquemaAnalisisSalud = z
  .object({
    ordenesActivas: z.number().int().describe('Órdenes con la RC viva (empresa activa).'),
    aTiempo: z.number().int().describe('Órdenes activas cuyo semáforo es a tiempo.'),
    enRiesgo: z.number().int().describe('Órdenes activas cuyo semáforo es en riesgo.'),
    atrasadas: z.number().int().describe('Órdenes activas cuyo semáforo es atrasado.'),
    cumplimiento: z
      .number()
      .int()
      .nullable()
      .describe('% de órdenes activas a tiempo (0-100), o null si no hay órdenes activas.'),
    atencion: z
      .array(esquemaOrdenAtencion)
      .describe(
        'Órdenes atrasadas + en riesgo, ordenadas por urgencia (la más apremiante primero).',
      ),
  })
  .describe('Salud de las órdenes: KPIs + triage.');

// ── Entrega al cliente + tiempo de ciclo (reusa la definición de F7-E3) ────────────────────────────

/** Entrega a tiempo (on-time delivery) + tiempo de ciclo OP→entrega, con sus tendencias. */
export const esquemaEntregaCiclo = z
  .object({
    onTimePct: z
      .number()
      .int()
      .nullable()
      .describe('% de entregas a tiempo en la ventana (0-100), o null si no hay órdenes medibles.'),
    onTimeATiempo: z.number().int().describe('Órdenes entregadas a tiempo en la ventana.'),
    onTimeMedibles: z
      .number()
      .int()
      .describe('Órdenes entregadas MEDIBLES (con fecha real y planeada) en la ventana.'),
    tendenciaSemanas: z
      .array(z.number().int())
      .describe(
        '% a tiempo por semana en las últimas 4 semanas (antiguo→reciente), para el sparkline.',
      ),
    cicloPromedioDias: z
      .number()
      .nullable()
      .describe('Días naturales promedio OP→entrega en la ventana, o null si no hay datos.'),
    cicloTendenciaDias: z
      .number()
      .nullable()
      .describe('Delta del ciclo vs la ventana anterior (negativo = más rápido), o null.'),
    datosAl: z.iso
      .datetime()
      .nullable()
      .describe('Sello de la última actualización de las vistas KPI (F7-E3), o null.'),
  })
  .describe('Entrega al cliente + tiempo de ciclo (el resultado que de verdad importa).');

// ── Alertas predictivas (CPM forward pass) ─────────────────────────────────────────────────────────

/** Una orden que HOY se ve a tiempo pero cuyo colchón proyectado no alcanza (va a atrasarse). */
export const esquemaOrdenAlerta = z
  .object({
    idOrden: z.number().int().describe('Id de la orden.'),
    folioOrden: z.number().int().describe('Folio de la orden.'),
    cliente: z.string().describe('Nombre del cliente.'),
    codigoModelo: z.string().describe('Código del modelo.'),
    descripcionModelo: z.string().nullable().describe('Descripción del modelo, o null.'),
    procesosRestantes: z.number().int().describe('Procesos que aún faltan por cumplir.'),
    colchonDias: z
      .number()
      .int()
      .describe('Colchón proyectado en días hábiles (forward pass): <0 = va a atrasarse.'),
    fechaEntregaRC: z.iso.datetime().nullable().describe('Fecha de entrega comprometida, o null.'),
  })
  .describe('Alerta predictiva de una orden (colchón proyectado por el CPM forward pass).');

/** Forma de una alerta predictiva. */
export type OrdenAlerta = z.infer<typeof esquemaOrdenAlerta>;

// ── Riesgo por cliente ─────────────────────────────────────────────────────────────────────────────

/** Riesgo agregado por cliente: activas / en riesgo / atrasadas + semáforo. */
export const esquemaRiesgoCliente = z
  .object({
    idCliente: z.number().int().describe('Id del cliente.'),
    cliente: z.string().describe('Nombre del cliente.'),
    activas: z.number().int().describe('Órdenes activas del cliente.'),
    enRiesgo: z.number().int().describe('Órdenes del cliente en riesgo.'),
    atrasadas: z.number().int().describe('Órdenes del cliente atrasadas.'),
    semaforo: z
      .enum(['ok', 'warn', 'crit'])
      .describe('Semáforo del cliente: crit si tiene atrasadas, warn si en riesgo, ok si no.'),
  })
  .describe('Riesgo agregado por cliente.');

/** Forma del riesgo por cliente. */
export type RiesgoCliente = z.infer<typeof esquemaRiesgoCliente>;

// ── Cuellos de botella por proceso ─────────────────────────────────────────────────────────────────

/** Cuello de botella por proceso: dónde se atoran más las órdenes (sistémico). */
export const esquemaCuelloProceso = z
  .object({
    idProcesoDef: z.number().int().describe('Tipo de proceso (ProcesoDef).'),
    codigoProceso: z.string().describe('Código del proceso.'),
    nombreProceso: z.string().describe('Nombre del proceso.'),
    vencidos: z.number().int().describe('Órdenes vencidas en ese proceso.'),
    hoy: z.number().int().describe('Órdenes que vencen HOY en ese proceso.'),
    total: z.number().int().describe('Total de órdenes actualmente atoradas en ese proceso.'),
  })
  .describe('Cuello de botella por proceso.');

/** Forma de un cuello de botella. */
export type CuelloProceso = z.infer<typeof esquemaCuelloProceso>;

// ── Respuesta del tablero (todo salvo el desempeño de personas) ────────────────────────────────────

/** Respuesta completa del tablero Análisis RC (gate `rc.ruta-ver`). */
export const esquemaAnalisisRc = z
  .object({
    salud: esquemaAnalisisSalud,
    entregaCiclo: esquemaEntregaCiclo,
    alertas: z
      .array(esquemaOrdenAlerta)
      .describe('Órdenes que hoy se ven a tiempo pero cuyo colchón proyectado no alcanza.'),
    riesgoCliente: z.array(esquemaRiesgoCliente).describe('Riesgo por cliente (con semáforo).'),
    cuellos: z.array(esquemaCuelloProceso).describe('Cuellos de botella por proceso.'),
  })
  .describe('Tablero de gestión "Análisis RC": salud, entrega/ciclo, alertas, riesgo, cuellos.');

/** Forma de la respuesta del tablero. */
export type AnalisisRc = z.infer<typeof esquemaAnalisisRc>;

// ── Desempeño del equipo (scoring + bono) — endpoint aparte, gate `rc.programar` ───────────────────

/** Calificación cualitativa derivada del score. */
export const esquemaBadgeDesempeno = z.enum(['excelente', 'bien', 'regular', 'bajo']);

/** Forma de la calificación cualitativa. */
export type BadgeDesempeno = z.infer<typeof esquemaBadgeDesempeno>;

/** Desempeño de UNA persona en la RC (scoring + bono). */
export const esquemaPersonaDesempeno = z
  .object({
    idUsuario: z.string().describe('Id del usuario.'),
    nombre: z.string().describe('Nombre completo de la persona.'),
    area: z.string().describe('Área derivada de sus roles (concatenados).'),
    activos: z.number().int().describe('Procesos activos a su cargo (por sus roles).'),
    vencidos: z.number().int().describe('Procesos a su cargo vencidos AHORA.'),
    onTimePct: z
      .number()
      .int()
      .nullable()
      .describe('% de procesos que entregó en tiempo (histórico), o null si no tiene capturas.'),
    reaccionHoras: z
      .number()
      .nullable()
      .describe('Horas promedio en atender un proceso desde que cae en su cancha, o null.'),
    tendencia: z
      .number()
      .int()
      .nullable()
      .describe('Delta del % en tiempo vs la semana pasada (puntos), o null si no hay base.'),
    calificacion: z
      .number()
      .int()
      .nullable()
      .describe(
        'Calificación 0-100 (% en tiempo − penalización por vencidos), o null sin historial.',
      ),
    badge: esquemaBadgeDesempeno.nullable().describe('Etiqueta cualitativa del score, o null.'),
    bono: z.boolean().describe('¿Gana el bono semanal? (calificación ≥ umbral Y 0 vencidos).'),
    sobrecarga: z.boolean().describe('¿Trae mucha carga? (para leer un score bajo con contexto).'),
  })
  .describe('Desempeño de una persona en la Ruta Crítica.');

/** Forma del desempeño de una persona. */
export type PersonaDesempeno = z.infer<typeof esquemaPersonaDesempeno>;

/** Umbrales (configurables a futuro) con los que se calculó el desempeño. */
export const esquemaParametrosDesempeno = z
  .object({
    umbralBono: z.number().int().describe('Calificación mínima para el bono (default 90).'),
    penalizacionPorVencido: z
      .number()
      .int()
      .describe('Puntos que resta cada proceso vencido a la calificación (default 5).'),
    sobrecargaActivos: z
      .number()
      .int()
      .describe('A partir de cuántos activos se marca "sobrecarga" (default 15).'),
  })
  .describe('Umbrales configurables del scoring del desempeño.');

/** Respuesta del desempeño del equipo (gate `rc.programar`). */
export const esquemaDesempenoRc = z
  .object({
    personas: z
      .array(esquemaPersonaDesempeno)
      .describe('Desempeño por persona, ordenado por calificación (mejor primero).'),
    conBono: z.number().int().describe('Cuántas personas ganan el bono esta semana.'),
    parametros: esquemaParametrosDesempeno,
  })
  .describe('Desempeño del equipo de la Ruta Crítica (scoring + bono).');

/** Forma de la respuesta del desempeño. */
export type DesempenoRc = z.infer<typeof esquemaDesempenoRc>;
