/**
 * CPM (Critical Path Method) PURO de la Ruta Crítica — F5-E4, parte 2 del motor (ADR-0013; doc
 * `08-Ruta-Critica.md` §2.3/§4; D10/D11). Es el corazón del cálculo de fechas de la ruta viva:
 * dado el grafo de procesos (con su duración en días hábiles), el calendario laboral de la empresa
 * y la fecha de entrega de la RC, calcula la FECHA PLANEADA de cada proceso por un BACKWARD PASS
 * (de atrás hacia adelante en el tiempo) y el ACUMULADO de días hábiles (lead time).
 *
 * Se aísla aquí, SIN Prisma ni sesión, para probarlo con tablas calculadas a mano (tests unitarios
 * sin BD). El wrapper que lee/escribe la BD (el handler del job pg-boss) vive en
 * `cpm-job.ts`; este módulo es la matemática.
 *
 * ── Equivalencia con el viejo (`RC_ProgramacionSub.EstablecerLasFechas`, bucle 'OtraVez') ──
 * El viejo estimaba un INICIO con `FechaHabiles` (entrega − días, con un ÷5 aproximado), hacía un
 * FORWARD pass sumando tiempos y empujando los fines de semana a mano (`CuantosSabYDom`), y si el
 * último proceso se PASABA de `QueFechaRC` (la fecha de entrega de la RC) nudgeaba el inicio un día
 * hacia atrás y RE-CALCULABA (la etiqueta `OtraVez`). Ese lazo era un ajuste iterativo frágil para
 * compensar que su conteo de días hábiles no era exacto. v2 lo reemplaza por un BACKWARD PASS EXACTO
 * en días hábiles (`comun/diasHabiles`): el terminal ANCLA en `fechaEntregaRC` y cada proceso retrocede
 * EXACTAMENTE su duración en días hábiles. No hay nudge ni reintento: una pasada da el resultado y es
 * idempotente (re-ejecutar con los mismos datos da las mismas fechas — clave para el reintento de jobs).
 *
 * ── Modelo de dependencias (por ANTECESORES, generalizado a N) ──
 * Un proceso depende de sus ANTECESORES: TODOS deben terminar antes de que el proceso inicie. En
 * FORWARD eso es `inicio(p) = MAX(fin(antecesores))`. En el BACKWARD pass que usamos, la restricción
 * viaja al revés: un antecesor debe TERMINAR a más tardar cuando inicia el MÁS TEMPRANO de sus
 * sucesores, así que `fin(antecesor) = MIN(inicio(sucesores))`. Si un proceso no tiene sucesores es
 * TERMINAL y ancla en `fechaEntregaRC`. (Varios terminales posibles → todos anclan en la entrega.)
 */
import {
  sumarDiasHabiles,
  contarDiasHabiles,
  esDiaHabil,
  type CalendarioLaboral,
} from '../../comun/diasHabiles.js';

/** Un proceso de la ruta tal como lo consume el CPM (puro: solo lo necesario para fechar). */
export interface ProcesoCpm {
  /** Identificador del proceso DENTRO de la ruta (en el job: el id de `RutaOrden`). */
  id: number;
  /** Duración del proceso en DÍAS HÁBILES (ya calculada por `calcularDuracion`, E3). */
  duracionDias: number;
  /** Ids (en este mismo conjunto) de los procesos que DEBEN terminar antes de iniciar este. */
  idsAntecesores: number[];
}

/** Resultado del CPM por proceso: sus fechas calculadas y el acumulado de días hábiles. */
export interface FechasProcesoCpm {
  /** Fecha de INICIO planeada (día hábil) — medianoche UTC. */
  inicio: Date;
  /** Fecha de FIN planeada (día hábil) = la fecha que se publica como planeada del proceso. */
  fin: Date;
  /**
   * Días hábiles ACUMULADOS desde el inicio GLOBAL de la ruta (el inicio más temprano de cualquier
   * proceso) hasta el FIN de este proceso (lead time hasta aquí). En el/los terminal(es) = lead time
   * total de la ruta.
   */
  acumuladoDias: number;
}

/** Resultado completo del CPM: fechas por proceso + el lead time total (días hábiles). */
export interface ResultadoCpm {
  /** Fechas calculadas por id de proceso. */
  fechasPorProceso: Map<number, FechasProcesoCpm>;
  /** Inicio más temprano de toda la ruta (el inicio del primer proceso) — medianoche UTC. */
  inicioRuta: Date;
  /** Lead time total de la ruta en días hábiles (del inicio de la ruta al fin del terminal). */
  acumuladoTotal: number;
  /** Avisos no fatales (p. ej. duración 0, proceso aislado). */
  advertencias: string[];
}

/**
 * Orden topológico (procesos antes que sus sucesores) por Kahn. Lanza si hay ciclo (el grafo de la
 * ruta DEBE ser acíclico — lo garantizan `generarRutaOrden`/`ajustarRutaOrden` vía `grafo.ts`; aquí
 * es defensa en profundidad para no colgar el job en un ciclo imprevisto).
 */
function ordenTopologico<T extends { id: number; idsAntecesores: number[] }>(
  procesos: readonly T[],
): T[] {
  const porId = new Map(procesos.map((p) => [p.id, p]));
  // gradoEntrante[p] = cuántos antecesores (válidos) tiene p.
  const gradoEntrante = new Map<number, number>();
  // sucesores[antecesor] = procesos que lo tienen como antecesor.
  const sucesores = new Map<number, number[]>();
  for (const p of procesos) {
    gradoEntrante.set(p.id, 0);
  }
  for (const p of procesos) {
    for (const idAnt of p.idsAntecesores) {
      if (!porId.has(idAnt)) continue; // antecesor fuera del conjunto: se ignora (defensivo).
      gradoEntrante.set(p.id, (gradoEntrante.get(p.id) ?? 0) + 1);
      const lista = sucesores.get(idAnt) ?? [];
      lista.push(p.id);
      sucesores.set(idAnt, lista);
    }
  }
  const cola: number[] = [];
  for (const [id, grado] of gradoEntrante) {
    if (grado === 0) cola.push(id);
  }
  const orden: T[] = [];
  while (cola.length > 0) {
    const id = cola.shift();
    if (id === undefined) break;
    const p = porId.get(id);
    if (p !== undefined) orden.push(p);
    for (const idSuc of sucesores.get(id) ?? []) {
      const g = (gradoEntrante.get(idSuc) ?? 0) - 1;
      gradoEntrante.set(idSuc, g);
      if (g === 0) cola.push(idSuc);
    }
  }
  if (orden.length !== procesos.length) {
    throw new Error(
      'El grafo de la ruta tiene un ciclo: el CPM no puede ordenarlo topológicamente.',
    );
  }
  return orden;
}

/**
 * Calcula las fechas planeadas de TODOS los procesos por un BACKWARD PASS en días hábiles desde
 * `fechaEntregaRC`. PURO e IDEMPOTENTE.
 *
 * Algoritmo:
 *  1. Orden topológico (antecesores antes que sucesores).
 *  2. Recorriendo en orden INVERSO (terminales primero):
 *     - `fin(p)` = si p NO tiene sucesores → `fechaEntregaRC`; si los tiene → `MIN(inicio(sucesores))`.
 *     - `inicio(p)` = `sumarDiasHabiles(fin(p), -duracionDias, calendario)` (retrocede días hábiles).
 *       Con duración 0, `inicio === fin` (cero pasos hábiles).
 *  3. El `acumuladoDias` de cada proceso = días hábiles entre el inicio de la RUTA (el inicio más
 *     temprano de todos los procesos) y el FIN del proceso, AMBOS inclusive si hábiles
 *     (`contarDiasHabiles`). En el terminal = lead time total.
 *
 * `fechaInicioRC` NO fuerza el inicio: es solo el ancla por defecto que el llamador usa para las
 * fechas reales de los procesos de duración 0 (E3); el inicio REAL de la ruta lo dicta el backward
 * pass desde la entrega. Se acepta como parámetro por si una iteración futura quiere acotarlo.
 *
 * @param procesos       procesos de la ruta (id, duración, antecesores).
 * @param fechaEntregaRC fecha de entrega de la RC (ancla del/los proceso(s) terminal(es)).
 * @param calendario     calendario laboral ya cargado (días hábiles + festivos).
 */
export function calcularCpm(
  procesos: readonly ProcesoCpm[],
  fechaEntregaRC: Date,
  calendario: CalendarioLaboral,
): ResultadoCpm {
  const advertencias: string[] = [];
  const fechasPorProceso = new Map<number, FechasProcesoCpm>();

  if (procesos.length === 0) {
    return {
      fechasPorProceso,
      inicioRuta: fechaEntregaRC,
      acumuladoTotal: 0,
      advertencias,
    };
  }

  const orden = ordenTopologico(procesos);
  const porId = new Map(procesos.map((p) => [p.id, p]));

  // sucesores[p] = procesos que dependen de p (lo tienen como antecesor).
  const sucesores = new Map<number, number[]>();
  for (const p of procesos) {
    for (const idAnt of p.idsAntecesores) {
      if (!porId.has(idAnt)) continue;
      const lista = sucesores.get(idAnt) ?? [];
      lista.push(p.id);
      sucesores.set(idAnt, lista);
    }
  }

  // Fin/inicio por proceso, calculados en orden topológico INVERSO (terminales primero).
  const inicioPorId = new Map<number, Date>();
  const finPorId = new Map<number, Date>();
  for (let i = orden.length - 1; i >= 0; i -= 1) {
    const p = orden[i];
    if (p === undefined) continue;
    const idsSuc = sucesores.get(p.id) ?? [];
    let fin: Date;
    if (idsSuc.length === 0) {
      // Terminal: ancla en la fecha de entrega de la RC.
      fin = new Date(
        Date.UTC(
          fechaEntregaRC.getUTCFullYear(),
          fechaEntregaRC.getUTCMonth(),
          fechaEntregaRC.getUTCDate(),
        ),
      );
    } else {
      // Debe terminar a más tardar cuando INICIA el más TEMPRANO de sus sucesores (MIN).
      let minInicioSuc: Date | null = null;
      for (const idSuc of idsSuc) {
        const inicioSuc = inicioPorId.get(idSuc);
        if (inicioSuc === undefined) continue;
        if (minInicioSuc === null || inicioSuc.getTime() < minInicioSuc.getTime()) {
          minInicioSuc = inicioSuc;
        }
      }
      // minInicioSuc nunca es null aquí (los sucesores ya se procesaron en el recorrido inverso).
      fin = minInicioSuc ?? fechaEntregaRC;
    }
    const inicio = sumarDiasHabiles(fin, -p.duracionDias, calendario);
    finPorId.set(p.id, fin);
    inicioPorId.set(p.id, inicio);
    if (p.duracionDias === 0) {
      advertencias.push(`El proceso ${String(p.id)} tiene duración 0 (inicio = fin).`);
    }
  }

  // Inicio de la RUTA = el inicio más temprano de cualquier proceso.
  let inicioRuta: Date | null = null;
  for (const inicio of inicioPorId.values()) {
    if (inicioRuta === null || inicio.getTime() < inicioRuta.getTime()) {
      inicioRuta = inicio;
    }
  }
  const inicioRutaFinal = inicioRuta ?? fechaEntregaRC;

  // Acumulado por proceso = días hábiles [inicioRuta, fin(p)] (ambos inclusive si hábiles).
  let acumuladoTotal = 0;
  for (const p of procesos) {
    const inicio = inicioPorId.get(p.id);
    const fin = finPorId.get(p.id);
    if (inicio === undefined || fin === undefined) continue;
    const acumuladoDias = contarDiasHabiles(inicioRutaFinal, fin, calendario);
    fechasPorProceso.set(p.id, { inicio, fin, acumuladoDias });
    if (acumuladoDias > acumuladoTotal) acumuladoTotal = acumuladoDias;
  }

  return {
    fechasPorProceso,
    inicioRuta: inicioRutaFinal,
    acumuladoTotal,
    advertencias,
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// FORWARD PASS predictivo — "alertas predictivas" del tablero Análisis RC (R7, B14; ADR-0016).
//
// El backward pass de arriba fecha la ruta desde la ENTREGA hacia atrás (planeación). El forward
// pass responde una pregunta DISTINTA: si el trabajo QUE FALTA arranca HOY, ¿cuándo terminaría de
// verdad la orden y alcanza la fecha de entrega? Proyecta las fechas de los procesos PENDIENTES
// hacia adelante desde HOY (los ya completados no imponen retraso) y compara el fin proyectado
// contra la entrega. El "COLCHÓN PROYECTADO" (slack) resultante detecta órdenes que HOY se ven a
// tiempo (ningún proceso vencido) pero cuyo camino restante NO cabe antes de la entrega → van a
// atrasarse. Es SOLO una proyección de lectura: no se persiste ni toca `fechaPlaneadaVigente`.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Un proceso de la ruta tal como lo consume el FORWARD pass (puro). */
export interface ProcesoForward {
  /** Identificador del proceso dentro de la ruta (en el tablero: el id de `RutaOrden`). */
  id: number;
  /** Duración del proceso en DÍAS HÁBILES (ya calculada por `calcularDuracion`). */
  duracionDias: number;
  /** Ids (en este conjunto) de los procesos que DEBEN terminar antes de iniciar este. */
  idsAntecesores: number[];
  /** ¿El proceso ya está CUMPLIDO? (tiene `fechaReal`). Un completado no añade trabajo restante. */
  completado: boolean;
}

/** Resultado de la proyección hacia adelante de una orden. */
export interface ProyeccionForward {
  /**
   * Fin proyectado de TODA la ruta si el trabajo restante arranca HOY (día hábil, medianoche UTC).
   * Si no queda nada pendiente, es HOY.
   */
  finProyectado: Date;
  /**
   * COLCHÓN proyectado en DÍAS HÁBILES con signo: `> 0` sobra holgura, `0` justo, `< 0` la orden
   * NO alcanza a entregar a tiempo por proyección (aunque hoy no esté atrasada).
   */
  colchonDias: number;
  /** Procesos aún sin completar (los que forman el trabajo restante). */
  procesosRestantes: number;
  /** Avisos no fatales (p. ej. duración 0). */
  advertencias: string[];
}

/**
 * Días hábiles con SIGNO entre `desde` y `hasta` (colchón/slack): 0 si es el mismo día; `+n` si
 * `hasta` es posterior (hábiles ESTRICTAMENTE después de `desde`, sin contar el propio `desde` que
 * ya está "consumido" por el fin del trabajo); `-n` si `hasta` es anterior (días hábiles de retraso).
 * Reusa `contarDiasHabiles` (inclusivo) y descuenta el EXTREMO MÁS TEMPRANO — pero SOLO si ese
 * extremo es día hábil (si cae en inhábil, `contarDiasHabiles` ya no lo contó, así que no se resta:
 * restarlo subestimaría el colchón). PURO.
 */
function diasHabilesConSigno(desde: Date, hasta: Date, calendario: CalendarioLaboral): number {
  const a = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate()));
  const b = new Date(Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth(), hasta.getUTCDate()));
  if (a.getTime() === b.getTime()) return 0;
  if (a.getTime() < b.getTime()) {
    return Math.max(0, contarDiasHabiles(a, b, calendario) - (esDiaHabil(a, calendario) ? 1 : 0));
  }
  return -Math.max(0, contarDiasHabiles(b, a, calendario) - (esDiaHabil(b, calendario) ? 1 : 0));
}

/**
 * FORWARD PASS predictivo de una orden: proyecta el fin de la ruta arrancando el trabajo RESTANTE
 * HOY y devuelve el colchón (slack) en días hábiles contra `fechaEntregaRC`. PURO e IDEMPOTENTE.
 *
 * Algoritmo:
 *  1. Orden topológico (antecesores antes que sucesores).
 *  2. Recorriendo hacia adelante:
 *     - Proceso YA completado → su fin proyectado ANCLA en HOY (ya ocurrió; no empuja a nadie al futuro).
 *     - Proceso pendiente → `inicio = MAX(HOY, MAX(fin de sus antecesores))`;
 *       `fin = sumarDiasHabiles(inicio, +duracionDias)` (con duración 0, fin = inicio).
 *  3. `finProyectado` de la ruta = el fin proyectado MÁS TARDÍO de todos los procesos (o HOY si vacío).
 *  4. `colchonDias` = días hábiles con signo de `finProyectado` a `fechaEntregaRC`.
 *
 * @param procesos       procesos de la ruta (id, duración, antecesores, completado).
 * @param hoy            fecha de referencia (se trunca a medianoche UTC).
 * @param fechaEntregaRC fecha de entrega comprometida de la RC.
 * @param calendario     calendario laboral ya cargado.
 */
export function proyectarColchonForward(
  procesos: readonly ProcesoForward[],
  hoy: Date,
  fechaEntregaRC: Date,
  calendario: CalendarioLaboral,
): ProyeccionForward {
  const advertencias: string[] = [];
  const hoyMid = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()));
  const procesosRestantes = procesos.filter((p) => !p.completado).length;

  if (procesos.length === 0 || procesosRestantes === 0) {
    return {
      finProyectado: hoyMid,
      colchonDias: diasHabilesConSigno(hoyMid, fechaEntregaRC, calendario),
      procesosRestantes: 0,
      advertencias,
    };
  }

  const orden = ordenTopologico(procesos);
  const finPorId = new Map<number, Date>();
  for (const p of orden) {
    if (p.completado) {
      // Ya ocurrió: ancla en HOY para no empujar a sus sucesores al futuro.
      finPorId.set(p.id, hoyMid);
      continue;
    }
    let inicio = hoyMid;
    for (const idAnt of p.idsAntecesores) {
      const finAnt = finPorId.get(idAnt) ?? hoyMid;
      if (finAnt.getTime() > inicio.getTime()) inicio = finAnt;
    }
    const fin = sumarDiasHabiles(inicio, p.duracionDias, calendario);
    finPorId.set(p.id, fin);
    if (p.duracionDias === 0) {
      advertencias.push(`El proceso ${String(p.id)} tiene duración 0 (inicio = fin).`);
    }
  }

  let finProyectado = hoyMid;
  for (const fin of finPorId.values()) {
    if (fin.getTime() > finProyectado.getTime()) finProyectado = fin;
  }

  return {
    finProyectado,
    colchonDias: diasHabilesConSigno(finProyectado, fechaEntregaRC, calendario),
    procesosRestantes,
    advertencias,
  };
}
