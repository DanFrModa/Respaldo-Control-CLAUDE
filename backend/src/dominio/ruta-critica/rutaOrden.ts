/**
 * MOTOR de la RUTA VIVA por orden — parte 1 (F5-E3; doc `08-Ruta-Critica.md` §2.3/§4; D10/D11;
 * A1/A2/A7). Genera y ajusta la ruta de UNA orden a partir de la PLANTILLA aplicable (E2):
 *
 *  • `generarRutaOrden` — instancia la ruta de la orden: un renglón `RutaOrden` por proceso
 *    APLICABLE (omitiendo los condicionales cuando la orden no lleva aplicación, RECONECTANDO los
 *    sucesores a los antecesores TRANSITIVOS reales — mejora vs el frágil decremento `VerifAntecesor`
 *    del viejo), con su `duracionDias` (`calcularDuracion`), su snapshot de dependencias
 *    (`RutaOrdenDep`) y su checklist (`RutaOrdenChecklist`). Marca la orden como programada y ENCOLA
 *    el recálculo del CPM (cuyas fechas calcula E4); la respuesta es INMEDIATA (la captura nunca
 *    espera al CPM, §11). RE-GENERAR está PERMITIDO y CONSERVA las fechas reales ya capturadas
 *    (mejora explícita vs el bloqueo "Ya está programada" del viejo).
 *  • `ajustarRutaOrden` — agrega/quita procesos y edita dependencias de ESA orden sobre
 *    `RutaOrden`/`RutaOrdenDep` SIN tocar la plantilla (D10); re-encola el recálculo.
 *
 * Semántica de DURACIÓN 0 (ex `TiemposEnCero`): TODO proceso que quede con `duracionDias === 0`
 * (resurtido, "Sin Aplicación", o tiempo 0) se AUTO-COMPLETA al generar — `fechaReal = fecha de
 * inicio de la RC`, `estado = completado`, `origenCaptura = 'evento'` (lo completó el sistema, no
 * un usuario). En RESURTIDO, además, los procesos con bandera `esResurtido` se fuerzan a duración 0
 * (ex `EsResurtidoBoton`) y caen en esa misma regla.
 *
 * La RC NUNCA pisa `Orden.fechaEntrega` (la fecha comprometida con el cliente): trabaja con
 * `fechaEntregaRC` / `fechaInicioRC` aparte (decisión (c)).
 */
import type { Prisma } from '../../datos/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { COLAS_JOBS, encolarJob, type PayloadRecalcularRuta } from '../../comun/jobs/index.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';

import {
  calcularDuracion,
  type RangoDificultadCalculo,
  type RangoFactorCantidad,
} from './calcularDuracion.js';
import { activarProcesosListos } from './cumplimiento.js';
import {
  construirGrafoSucesores,
  esAlcanzable,
  validarRedefinicionesAcumulado,
  type RedefinicionAntecesores,
} from './grafo.js';
import {
  estadoSemaforoOrden,
  estadoSemaforoProceso,
  type EstadoSemaforo,
} from './semaforoYRiesgo.js';

// ── Tipos de entrada ────────────────────────────────────────────────────────────

/** Datos para PROGRAMAR (generar/re-generar) la ruta de una orden. */
export interface DatosGenerarRuta {
  /** Orden a programar. */
  idOrden: number;
  /** Artículo RC elegido (resuelve la plantilla por artículo y/o su familia). */
  idArticuloRC: number;
  /** Fecha de entrega de la RC (la RC se planea hacia atrás desde aquí en E4). */
  fechaEntregaRC: Date;
  /** Tipo de tela elegido (DuracionPorTipoTela) — para la regla `porTipoTela`. */
  idTipoTela: number;
  /** Aplicación elegida (DuracionPorAplicacion) — para la regla `porAplicacion` y la aplicabilidad. */
  idAplicacion: number;
  /** ¿La orden es resurtido? (los procesos `esResurtido` quedan en duración 0). */
  esResurtido?: boolean;
  /** Fecha de inicio de la RC (default: hoy). Las duración-0 se auto-completan con esta fecha. */
  fechaInicioRC?: Date;
}

/** Tipo de evento de negocio del proceso (espejo de `TipoEventoProceso`; R4: auto vs manual). */
export type TipoEventoRc =
  | 'recepcionTela'
  | 'corte'
  | 'envioCostura'
  | 'reciboCostura'
  | 'envioEstampado'
  | 'reciboEstampado'
  | 'auditoria'
  | 'autorizacionArte'
  | 'entregaCliente'
  | 'manual';

/** Un renglón de la ruta viva tal como lo devuelve el dominio. */
export interface RutaOrdenProcesoDto {
  id: number;
  idProcesoDef: number;
  codigoProceso: string;
  nombreProceso: string;
  secuencia: number;
  critico: boolean;
  ultimoProceso: boolean;
  esResurtido: boolean;
  condicionAplicabilidad: 'ninguna' | 'soloSiLlevaAplicacion';
  /** Cómo se COMPLETA el proceso (R4): `manual` = a mano; el resto, auto por su evento de sistema. */
  tipoEvento: TipoEventoRc;
  /** Nombres de los ROLES responsables del proceso (N:M sobre el RBAC, R4). */
  rolesResponsables: string[];
  /** ¿Quien CONSULTA es responsable de este proceso (o admin)? — para el badge "tú" (R4). */
  esResponsableActual: boolean;
  duracionDias: number;
  acumuladoDias: number | null;
  fechaPlaneadaOriginal: Date | null;
  fechaPlaneadaVigente: Date | null;
  fechaReal: Date | null;
  /**
   * Días NATURALES que faltan para la fecha planeada vigente (negativo = vencido) — la HOLGURA que
   * pinta el panel (R4, A1: la deriva el dominio). Null si el proceso no tiene fecha vigente.
   */
  diasRestantes: number | null;
  estado: 'pendiente' | 'activo' | 'completado';
  capturadoPorId: string | null;
  /** Nombre de quién capturó el cumplimiento (resuelto del Usuario), o null (F5-E5). */
  capturadoPorNombre: string | null;
  capturadoEn: Date | null;
  origenCaptura: 'manual' | 'evento' | null;
  /** ¿Hay una entrada PARCIAL en curso (auto-avance, F5-E6)? El proceso aún no está completo. */
  parcialEnCurso: boolean;
  /** Semáforo de cumplimiento del proceso (HOY vs planeada vigente) (F5-E4). */
  semaforo: EstadoSemaforo;
  idsAntecesores: number[];
  checklist: { id: number; descripcion: string; orden: number; hecho: boolean }[];
}

/** La ruta viva COMPLETA de una orden tal como la devuelve el dominio. */
export interface RutaOrdenDto {
  idOrden: number;
  rcActiva: boolean;
  fechaInicioRC: Date | null;
  fechaEntregaRC: Date | null;
  fechaProgramada: Date | null;
  esResurtido: boolean;
  idArticuloRC: number | null;
  idTipoTela: number | null;
  idAplicacion: number | null;
  /** Secuencia de estampado del MODELO (R4, B10): antes | despues | flexible. */
  secuenciaEstampadoModelo: 'antes' | 'despues' | 'flexible';
  /** Elección de secuencia de ESTA orden (solo flexibles), o null si no se ha decidido. */
  secEstampadoElegido: 'antes' | 'despues' | null;
  /** Secuencia EFECTIVA con la que se planeó la ruta (elección > modelo; flexible sin elección = antes). */
  secuenciaEstampadoEfectiva: 'antes' | 'despues';
  /**
   * Si la orden NO tiene ruta (`sin-ruta`) y la RC automática de R3 la OMITIÓ o FALLÓ, el motivo
   * registrado en bitácora — la UI lo muestra con el CTA "Programar ahora" (cierra el caveat del
   * toast optimista de R3). Null si hay ruta o no hay rastro.
   */
  motivoSinRuta: string | null;
  /**
   * Estado del cálculo de fechas (F5-E4): `calculado` (todos los procesos tienen fecha vigente),
   * `recalculando` (hay procesos sin fecha vigente: el CPM aún no terminó tras programar/ajustar) o
   * `sin-ruta` (la orden no tiene ruta generada).
   */
  estadoRecalculo: 'calculado' | 'recalculando' | 'sin-ruta';
  /** Semáforo de cumplimiento de la orden (el peor de sus procesos) (F5-E4). */
  semaforo: EstadoSemaforo;
  procesos: RutaOrdenProcesoDto[];
  advertencias: string[];
}

const INCLUDE_RUTA = {
  procesoDef: {
    select: {
      codigo: true,
      nombre: true,
      tipoEvento: true,
      roles: { select: { idRol: true, rol: { select: { nombre: true } } } },
    },
  },
  antecesores: { select: { idAntecesor: true } },
  checklist: { orderBy: { orden: 'asc' } },
} as const satisfies Prisma.RutaOrdenInclude;

type RutaConRelaciones = Prisma.RutaOrdenGetPayload<{ include: typeof INCLUDE_RUTA }>;

// ── Lectura ───────────────────────────────────────────────────────────────────

/** `select` de la ORDEN que el DTO de la ruta necesita (reusado por leer/generar/ajustar). */
const SELECT_ORDEN_RC = {
  id: true,
  rcActiva: true,
  fechaInicioRC: true,
  fechaEntregaRC: true,
  fechaProgramada: true,
  esResurtidoRC: true,
  idArticuloRcProg: true,
  idDuracionTela: true,
  idDuracionAplicacion: true,
  secEstampadoElegido: true,
  modelo: { select: { secuenciaEstampado: true } },
} as const satisfies Prisma.OrdenSelect;

/**
 * Roles del usuario que consulta, para el `esResponsableActual` por proceso (badge "tú", R4).
 * `'admin'` (roles.administrar) = responsable de todo — mismo criterio que la captura
 * (`exigirCapturaProceso`) y la bandeja.
 */
async function idsRolesDeSesion(
  cliente: ReturnType<typeof clienteLectura>,
  sesion: SesionUsuario,
): Promise<'admin' | ReadonlySet<number>> {
  if (sesion.permisos.has('roles.administrar')) return 'admin';
  const filas = await cliente.usuarioRol.findMany({
    where: { idUsuario: sesion.id },
    select: { idRol: true },
  });
  return new Set(filas.map((f) => f.idRol));
}

/**
 * MOTIVO por el que la orden quedó SIN ruta, si la RC automática de R3 lo dejó en bitácora
 * (`rc-automatica-omitida` con su `motivo`, o `rc-automatica-fallida`). Devuelve null si no hay
 * rastro. Solo se consulta cuando la orden no tiene renglones de ruta.
 */
async function motivoRcAutomatica(
  cliente: ReturnType<typeof clienteLectura>,
  idOrden: number,
): Promise<string | null> {
  const fila = await cliente.bitacora.findFirst({
    where: {
      entidad: 'Orden',
      idEntidad: String(idOrden),
      OR: [
        { datos: { path: ['operacion'], equals: 'rc-automatica-omitida' } },
        { datos: { path: ['operacion'], equals: 'rc-automatica-fallida' } },
      ],
    },
    orderBy: { id: 'desc' },
    select: { datos: true },
  });
  if (fila === null) return null;
  const datos = fila.datos as { operacion?: string; motivo?: string } | null;
  if (datos?.operacion === 'rc-automatica-omitida' && typeof datos.motivo === 'string') {
    return datos.motivo;
  }
  return 'La programación automática de la Ruta Crítica falló por un error del sistema; prográmala a mano.';
}

/**
 * Obtiene la ruta viva de una orden (renglones, duraciones, dependencias, estado). Lectura;
 * exige `rc.ruta-ver`. Si la orden NO tiene ruta, incluye el MOTIVO de la omisión/fallo de la RC
 * automática (R3) cuando hay rastro en bitácora (R4).
 */
export async function obtenerRutaOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<RutaOrdenDto> {
  verificarPermiso(sesion, 'rc.ruta-ver');
  const cliente = clienteLectura(bd);
  const orden = await cliente.orden.findUnique({
    where: { id: idOrden },
    select: SELECT_ORDEN_RC,
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  const filas = await cliente.rutaOrden.findMany({
    where: { idOrden },
    include: INCLUDE_RUTA,
    orderBy: { secuencia: 'asc' },
  });
  const nombres = await nombresCapturadores(cliente, filas);
  const rolesSesion = await idsRolesDeSesion(cliente, sesion);
  const motivoSinRuta = filas.length === 0 ? await motivoRcAutomatica(cliente, idOrden) : null;
  return armarDto(orden, filas, nombres, rolesSesion, motivoSinRuta);
}

// ── Generación ──────────────────────────────────────────────────────────────────

/**
 * Genera (o RE-GENERA) la ruta viva de una orden desde la plantilla aplicable. Transaccional (A2),
 * auditado (A7). Tras el commit, ENCOLA el recálculo del CPM (E4) — la respuesta no espera al job.
 * Exige `rc.programar`.
 */
export async function generarRutaOrden(
  sesion: SesionUsuario,
  datos: DatosGenerarRuta,
  bd?: ContextoBd,
): Promise<RutaOrdenDto> {
  verificarPermiso(sesion, 'rc.programar');

  const resultado = await enTransaccion(async (tx) => {
    const orden = await tx.orden.findUnique({
      where: { id: datos.idOrden },
      select: {
        id: true,
        idEmpresa: true,
        secEstampadoElegido: true,
        modelo: { select: { numOperaciones: true, secuenciaEstampado: true } },
      },
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', datos.idOrden);
    }

    // 1) Catálogos de programación (validados): artículo, tela, aplicación.
    const articulo = await tx.articuloRC.findUnique({
      where: { id: datos.idArticuloRC },
      select: { id: true, idFamiliaArticulo: true, activo: true },
    });
    if (articulo === null) {
      throw new ErrorValidacion('El artículo RC indicado no existe.');
    }
    if (!articulo.activo) {
      throw new ErrorValidacion('El artículo RC indicado está desactivado.');
    }
    const tela = await tx.duracionPorTipoTela.findUnique({
      where: { id: datos.idTipoTela },
      select: { id: true, dias: true },
    });
    if (tela === null) {
      throw new ErrorValidacion('El tipo de tela indicado no existe.');
    }
    const aplicacion = await tx.duracionPorAplicacion.findUnique({
      where: { id: datos.idAplicacion },
      select: { id: true, dias: true },
    });
    if (aplicacion === null) {
      throw new ErrorValidacion('La aplicación indicada no existe.');
    }

    // 2) Plantilla aplicable: por artículo concreto, si no por su familia.
    const plantilla = await resolverPlantilla(tx, articulo.id, articulo.idFamiliaArticulo);
    if (plantilla === null) {
      throw new ErrorValidacion(
        'No hay una plantilla de ruta activa para ese artículo ni su familia. ' +
          'Define una plantilla en el catálogo de la Ruta Crítica antes de programar.',
      );
    }

    // 3) Cantidad total de la orden (Σ de la matriz color×talla).
    const cantidad = await sumarCantidadOrden(tx, datos.idOrden);

    // 4) Factores por cantidad (catálogo en vivo, activos) + colchón de la empresa (constantes)
    //    + rangos de dificultad por # de operaciones (R4/B7, para la regla `porDificultad`).
    const factores = await cargarFactoresCantidad(tx);
    const colchon = await colchonDeEmpresa(tx, orden.idEmpresa);
    const rangosDificultad = await cargarRangosDificultad(tx);

    // 5) ¿La orden lleva aplicación? = la aplicación elegida tiene días > 0 ("Sin Aplicación" = 0).
    const llevaAplicacion = aplicacion.dias > 0;

    // 6) Construye la ruta: omite condicionales no aplicables RECONECTANDO transitivamente.
    const fechaInicio = datos.fechaInicioRC ?? hoyUtc();
    const esResurtido = datos.esResurtido ?? false;
    const advertencias: string[] = [];

    const renglonesPlantilla = plantilla.procesos; // ya ordenados por `orden`.

    // Aristas de la plantilla en términos de idProcesoDef (para reconectar transitivamente).
    const aristasPlantilla: { idProceso: number; idAntecesor: number }[] = [];
    const idProcesoDefPorRenglon = new Map(renglonesPlantilla.map((r) => [r.id, r.idProcesoDef]));
    for (const r of renglonesPlantilla) {
      for (const a of r.antecesores) {
        const idAnt = idProcesoDefPorRenglon.get(a.idAntecesor);
        if (idAnt !== undefined) {
          aristasPlantilla.push({ idProceso: r.idProcesoDef, idAntecesor: idAnt });
        }
      }
    }

    // ── Secuencia de ESTAMPADO (R4, B10): dependencia CONDICIONAL "recibo de estampado →
    // envío a costura". Efectiva = elección de la orden (flexibles) > secuencia del modelo;
    // flexible sin elección se planea 'antes' (conservador: reserva el tiempo del estampado).
    // Con 'antes' (y si la orden lleva aplicación), la confección ESPERA al estampado: se agrega
    // la arista, salvo que cerrara un ciclo (catálogo editado raro → se omite con aviso).
    const secuenciaEfectiva = secuenciaEstampadoEfectiva(
      orden.modelo.secuenciaEstampado,
      orden.secEstampadoElegido,
    );
    if (secuenciaEfectiva === 'antes' && llevaAplicacion) {
      const idsRecibo = renglonesPlantilla
        .filter((r) => r.procesoDef.tipoEvento === 'reciboEstampado')
        .map((r) => r.idProcesoDef);
      const idsEnvioCostura = renglonesPlantilla
        .filter((r) => r.procesoDef.tipoEvento === 'envioCostura')
        .map((r) => r.idProcesoDef);
      const grafo = construirGrafoSucesores(aristasPlantilla);
      for (const idEnvio of idsEnvioCostura) {
        for (const idRecibo of idsRecibo) {
          const yaExiste = aristasPlantilla.some(
            (a) => a.idProceso === idEnvio && a.idAntecesor === idRecibo,
          );
          if (yaExiste) continue;
          // Ciclo si el recibo ya es alcanzable DESDE el envío (el envío lo antecede).
          if (esAlcanzable(grafo, idEnvio, idRecibo)) {
            advertencias.push(
              'No se pudo amarrar "estampado antes de coser": la dependencia formaría un ciclo ' +
                'con el encadenamiento de la plantilla. Revisa el catálogo de dependencias.',
            );
            continue;
          }
          aristasPlantilla.push({ idProceso: idEnvio, idAntecesor: idRecibo });
        }
      }
    }

    // Procesos OMITIDOS = condicionales (`soloSiLlevaAplicacion`) cuando la orden NO lleva aplicación.
    const omitidos = new Set<number>();
    for (const r of renglonesPlantilla) {
      if (r.procesoDef.condicionAplicabilidad === 'soloSiLlevaAplicacion' && !llevaAplicacion) {
        omitidos.add(r.idProcesoDef);
      }
    }

    // Guard del "último proceso" (ancla de lead time del CPM de E4): si la omisión dejaría a la ruta
    // SIN ningún `ultimoProceso` (porque el/los único(s) terminal(es) eran condicionales omitidos),
    // NO se omiten esos terminales — la ruta debe conservar su proceso final para que el CPM de E4
    // tenga ancla. Se re-incluyen y se deja un aviso (caso raro: el terminal era condicional).
    const terminalesEnPlantilla = renglonesPlantilla.filter((r) => r.procesoDef.ultimoProceso);
    if (terminalesEnPlantilla.length > 0) {
      const quedaAlgunTerminal = terminalesEnPlantilla.some((r) => !omitidos.has(r.idProcesoDef));
      if (!quedaAlgunTerminal) {
        for (const r of terminalesEnPlantilla) omitidos.delete(r.idProcesoDef);
        advertencias.push(
          'El proceso "último" de la plantilla es condicional y la orden no lleva aplicación; ' +
            'se conserva igualmente como proceso terminal de la ruta (ancla de la RC).',
        );
      }
    }

    // Antecesores TRANSITIVOS reales tras omitir: si quito B, quien dependía de B pasa a depender de
    // los antecesores (vivos) de B, transitivamente. Se calcula sobre el grafo "sucesor→antecesores".
    const antecesoresDirectos = new Map<number, Set<number>>();
    for (const { idProceso, idAntecesor } of aristasPlantilla) {
      const set = antecesoresDirectos.get(idProceso) ?? new Set<number>();
      set.add(idAntecesor);
      antecesoresDirectos.set(idProceso, set);
    }
    const antecesoresVivos = (idProceso: number): number[] =>
      resolverAntecesoresVivos(idProceso, antecesoresDirectos, omitidos);

    // 7) Renglones a crear (procesos NO omitidos) con su duración.
    const procesosVivos = renglonesPlantilla.filter((r) => !omitidos.has(r.idProcesoDef));

    type PlanRenglon = {
      idProcesoDef: number;
      secuencia: number;
      critico: boolean;
      ultimoProceso: boolean;
      esResurtido: boolean;
      condicionAplicabilidad: 'ninguna' | 'soloSiLlevaAplicacion';
      duracionDias: number;
      idsAntecesores: number[];
      checklist: { descripcion: string; orden: number }[];
    };

    const plan: PlanRenglon[] = [];
    for (const [indice, r] of procesosVivos.entries()) {
      const proc = r.procesoDef;
      // Duración: si la orden es resurtido y el proceso aplica a resurtido → 0 (ex EsResurtidoBoton).
      let duracionDias: number;
      if (esResurtido && proc.esResurtido) {
        duracionDias = 0;
      } else {
        const calc = calcularDuracion({
          tipoDuracion: proc.tipoDuracion,
          tiempoEstandar: r.tiempoEstandar,
          cantidad,
          colchonCostura: colchon,
          factoresCantidad: factores,
          tela: { dias: tela.dias },
          aplicacion: { dias: aplicacion.dias },
          numOperaciones: orden.modelo.numOperaciones,
          rangosDificultad,
        });
        duracionDias = calc.dias;
        for (const adv of calc.advertencias) {
          advertencias.push(`[${proc.codigo}] ${adv}`);
        }
      }
      plan.push({
        idProcesoDef: proc.id,
        secuencia: indice,
        critico: proc.critico,
        ultimoProceso: proc.ultimoProceso,
        esResurtido: proc.esResurtido,
        condicionAplicabilidad: proc.condicionAplicabilidad,
        duracionDias,
        idsAntecesores: antecesoresVivos(proc.id),
        checklist: proc.checklist.map((c) => ({ descripcion: c.descripcion, orden: c.orden })),
      });
    }

    // 8) Persistencia: conservar fechas reales ya capturadas de los procesos que persisten.
    const previas = await tx.rutaOrden.findMany({
      where: { idOrden: datos.idOrden },
      select: {
        idProcesoDef: true,
        fechaReal: true,
        capturadoPorId: true,
        capturadoEn: true,
        origenCaptura: true,
        estado: true,
      },
    });
    const previaPorProceso = new Map(previas.map((p) => [p.idProcesoDef, p]));

    // Borra la ruta anterior (Cascade limpia dep + checklist) y recrea (set completo).
    await tx.rutaOrden.deleteMany({ where: { idOrden: datos.idOrden } });

    // Crea cada renglón (uno por uno: necesitamos su id para las aristas y el checklist).
    const idRutaPorProceso = new Map<number, number>();
    for (const renglon of plan) {
      const previa = previaPorProceso.get(renglon.idProcesoDef);
      const autoCompletadoPorCero = renglon.duracionDias === 0;
      // Conserva la captura real previa si la había; si no, auto-completa los de duración 0.
      const conservaReal = previa?.fechaReal != null;
      const fechaReal = conservaReal
        ? (previa?.fechaReal ?? null)
        : autoCompletadoPorCero
          ? fechaInicio
          : null;
      const estado: 'pendiente' | 'activo' | 'completado' = conservaReal
        ? (previa?.estado ?? 'completado')
        : autoCompletadoPorCero
          ? 'completado'
          : 'pendiente';
      const origenCaptura: 'manual' | 'evento' | null = conservaReal
        ? (previa?.origenCaptura ?? null)
        : autoCompletadoPorCero
          ? 'evento'
          : null;

      const creado = await tx.rutaOrden.create({
        data: {
          idOrden: datos.idOrden,
          idProcesoDef: renglon.idProcesoDef,
          secuencia: renglon.secuencia,
          critico: renglon.critico,
          ultimoProceso: renglon.ultimoProceso,
          esResurtido: renglon.esResurtido,
          condicionAplicabilidad: renglon.condicionAplicabilidad,
          duracionDias: renglon.duracionDias,
          fechaReal,
          estado,
          ...(conservaReal && previa?.capturadoPorId != null
            ? { capturadoPorId: previa.capturadoPorId }
            : {}),
          ...(conservaReal && previa?.capturadoEn != null
            ? { capturadoEn: previa.capturadoEn }
            : autoCompletadoPorCero
              ? { capturadoEn: fechaInicio }
              : {}),
          ...(origenCaptura === null ? {} : { origenCaptura }),
          ...datosCreacion(sesion),
        },
        select: { id: true },
      });
      idRutaPorProceso.set(renglon.idProcesoDef, creado.id);
    }

    // Aristas (RutaOrdenDep) en términos de renglones de la ruta.
    const aristasDep: { idRutaOrden: number; idAntecesor: number }[] = [];
    for (const renglon of plan) {
      const idRuta = idRutaPorProceso.get(renglon.idProcesoDef);
      if (idRuta === undefined) continue;
      for (const idAnt of renglon.idsAntecesores) {
        const idRutaAnt = idRutaPorProceso.get(idAnt);
        if (idRutaAnt !== undefined) {
          aristasDep.push({ idRutaOrden: idRuta, idAntecesor: idRutaAnt });
        }
      }
    }
    if (aristasDep.length > 0) {
      await tx.rutaOrdenDep.createMany({ data: aristasDep, skipDuplicates: true });
    }

    // Checklist (RutaOrdenChecklist) por renglón.
    const itemsChecklist: Prisma.RutaOrdenChecklistCreateManyInput[] = [];
    for (const renglon of plan) {
      const idRuta = idRutaPorProceso.get(renglon.idProcesoDef);
      if (idRuta === undefined) continue;
      for (const item of renglon.checklist) {
        itemsChecklist.push({
          idRutaOrden: idRuta,
          descripcion: item.descripcion,
          orden: item.orden,
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        });
      }
    }
    if (itemsChecklist.length > 0) {
      await tx.rutaOrdenChecklist.createMany({ data: itemsChecklist });
    }

    // ARRANQUE de la ruta: activa los procesos LISTOS (raíz, o cuyos antecesores ya quedaron
    // completados — p. ej. un antecesor auto-completado por duración 0). Sin esto la bandeja
    // (`estado='activo'`) nunca se poblaría tras generar. Se hace TRAS crear filas + aristas.
    await activarProcesosListos(tx, datos.idOrden);

    // 9) Marca la orden como programada (NUNCA toca `fechaEntrega` comprometida — decisión (c)).
    await tx.orden.update({
      where: { id: datos.idOrden },
      data: {
        rcActiva: true,
        fechaInicioRC: fechaInicio,
        fechaEntregaRC: datos.fechaEntregaRC,
        fechaProgramada: new Date(),
        esResurtidoRC: esResurtido,
        idArticuloRcProg: datos.idArticuloRC,
        idDuracionTela: datos.idTipoTela,
        idDuracionAplicacion: datos.idAplicacion,
        ...datosModificacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: datos.idOrden,
      accion: 'OTRO',
      datos: {
        operacion: 'programar-rc',
        idArticuloRC: datos.idArticuloRC,
        idTipoTela: datos.idTipoTela,
        idAplicacion: datos.idAplicacion,
        esResurtido,
        totalProcesos: plan.length,
        omitidos: [...omitidos],
      },
    });

    const orden2 = await tx.orden.findUniqueOrThrow({
      where: { id: datos.idOrden },
      select: SELECT_ORDEN_RC,
    });
    const filas = await tx.rutaOrden.findMany({
      where: { idOrden: datos.idOrden },
      include: INCLUDE_RUTA,
      orderBy: { secuencia: 'asc' },
    });
    const nombres = await nombresCapturadores(tx, filas);
    const rolesSesion = await idsRolesDeSesion(tx, sesion);
    const dto = armarDto(orden2, filas, nombres, rolesSesion);
    dto.advertencias = advertencias;
    return { dto, idEmpresa: orden.idEmpresa };
  }, bd);

  // Tras el commit: ENCOLA el recálculo del CPM (E4). Fire-and-forget — la captura no espera al job
  // (NO-OP si el motor está inactivo). Nunca rompe la respuesta de programar.
  // ⚠️ ASUME TRANSACCIÓN PROPIA: en prod los handlers llaman SIN `bd.tx`, así que `enTransaccion` ya
  // commiteó cuando llegamos aquí. Si algún día se COMPONE `generarRutaOrden` bajo una `bd.tx`
  // externa, este encolado correría ANTES del commit de esa tx externa (encolaría un recálculo de
  // datos aún no visibles). En ese escenario hay que MOVER el encolado a un hook post-commit del
  // llamador (no encolar aquí). Mantener este aviso si se añade composición.
  await encolarRecalculo(datos.idOrden, resultado.idEmpresa, 'generar');
  return resultado.dto;
}

// ── Ajuste de la ruta de una orden (sin tocar la plantilla, D10) ─────────────────

/** Datos para AJUSTAR la ruta de una orden (agregar/quitar procesos, editar dependencias). */
export interface DatosAjustarRuta {
  /** Orden cuya ruta se ajusta. */
  idOrden: number;
  /** Procesos a AGREGAR (del catálogo `ProcesoDef`), con duración explícita y antecesores. */
  agregar?: {
    idProcesoDef: number;
    duracionDias: number;
    idsAntecesores?: number[];
  }[];
  /** Ids de `ProcesoDef` a QUITAR de la ruta (se borran de RutaOrden; sus aristas caen en cascada). */
  quitar?: number[];
  /**
   * Re-definición del set COMPLETO de antecesores de un proceso de la ruta (en términos de
   * idProcesoDef). Si viene, REEMPLAZA las aristas de ese proceso.
   */
  dependencias?: { idProcesoDef: number; idsAntecesores: number[] }[];
}

/**
 * Ajusta la ruta de una orden SIN tocar la plantilla (D10): agrega/quita procesos y/o redefine
 * dependencias, validando que el grafo siga ACÍCLICO (reusa `grafo.ts`). Transaccional (A2),
 * auditado (A7). Re-encola el recálculo del CPM. Exige `rc.programar`.
 */
export async function ajustarRutaOrden(
  sesion: SesionUsuario,
  datos: DatosAjustarRuta,
  bd?: ContextoBd,
): Promise<RutaOrdenDto> {
  verificarPermiso(sesion, 'rc.programar');

  const resultado = await enTransaccion(async (tx) => {
    const orden = await tx.orden.findUnique({
      where: { id: datos.idOrden },
      select: { id: true, idEmpresa: true, rcActiva: true },
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', datos.idOrden);
    }
    if (orden.rcActiva !== true) {
      throw new ErrorValidacion(
        'La orden no tiene una ruta generada; prográmala antes de ajustar.',
      );
    }

    // Renglones actuales de la ruta (idProcesoDef → id de RutaOrden).
    const actuales = await tx.rutaOrden.findMany({
      where: { idOrden: datos.idOrden },
      select: { id: true, idProcesoDef: true, secuencia: true },
    });
    const idRutaPorProceso = new Map(actuales.map((r) => [r.idProcesoDef, r.id]));
    let maxSecuencia = actuales.reduce((m, r) => Math.max(m, r.secuencia), -1);

    // 1) QUITAR procesos (Cascade limpia sus aristas/checklist).
    const quitar = [...new Set(datos.quitar ?? [])];
    if (quitar.length > 0) {
      const idsRuta = quitar
        .map((idProc) => idRutaPorProceso.get(idProc))
        .filter((x): x is number => x !== undefined);
      if (idsRuta.length > 0) {
        await tx.rutaOrden.deleteMany({ where: { id: { in: idsRuta } } });
        for (const idProc of quitar) idRutaPorProceso.delete(idProc);
      }
    }

    // 2) AGREGAR procesos (valida que existan y no estén ya en la ruta).
    for (const ag of datos.agregar ?? []) {
      if (idRutaPorProceso.has(ag.idProcesoDef)) {
        throw new ErrorValidacion('Ese proceso ya está en la ruta de la orden.');
      }
      const proc = await tx.procesoDef.findUnique({
        where: { id: ag.idProcesoDef },
        select: {
          id: true,
          critico: true,
          ultimoProceso: true,
          esResurtido: true,
          condicionAplicabilidad: true,
        },
      });
      if (proc === null) {
        throw new ErrorValidacion('Alguno de los procesos a agregar no existe.');
      }
      maxSecuencia += 1;
      const creado = await tx.rutaOrden.create({
        data: {
          idOrden: datos.idOrden,
          idProcesoDef: proc.id,
          secuencia: maxSecuencia,
          critico: proc.critico,
          ultimoProceso: proc.ultimoProceso,
          esResurtido: proc.esResurtido,
          condicionAplicabilidad: proc.condicionAplicabilidad,
          duracionDias: Math.max(0, ag.duracionDias),
          ...datosCreacion(sesion),
        },
        select: { id: true },
      });
      idRutaPorProceso.set(proc.id, creado.id);
    }

    // 3) Set de dependencias a redefinir: agregadas (con sus antecesores) + las explícitas.
    const redefiniciones = new Map<number, number[]>();
    for (const ag of datos.agregar ?? []) {
      redefiniciones.set(ag.idProcesoDef, [...new Set(ag.idsAntecesores ?? [])]);
    }
    for (const d of datos.dependencias ?? []) {
      redefiniciones.set(d.idProcesoDef, [...new Set(d.idsAntecesores)]);
    }

    if (redefiniciones.size > 0) {
      // Primero, validar que todo proceso/antecesor referido pertenezca a la ruta de la orden.
      for (const [idProc, idsAnt] of redefiniciones) {
        if (!idRutaPorProceso.has(idProc)) {
          throw new ErrorValidacion('Un proceso a redefinir no pertenece a la ruta de la orden.');
        }
        for (const idAnt of idsAnt) {
          if (!idRutaPorProceso.has(idAnt)) {
            throw new ErrorValidacion('Un antecesor indicado no pertenece a la ruta de la orden.');
          }
        }
      }
      // Validación ACUMULATIVA del LOTE completo (anti-ciclo CRUZADO dentro del MISMO request):
      // `agregar` + `dependencias` se procesan en el MISMO acumulador, en orden, de modo que un PATCH
      // con `[{A→[B]}, {B→[A]}]` (cada una válida por separado, pero juntas cierran A↔B) se RECHACE.
      // La lógica pura vive en `grafo.ts` (`validarRedefinicionesAcumulado`), testeada sin BD.
      const aristasVivas = await cargarAristasRuta(tx, datos.idOrden, idRutaPorProceso);
      const lote: RedefinicionAntecesores[] = [...redefiniciones].map(
        ([idProceso, idsAntecesores]) => ({
          idProceso,
          idsAntecesores,
        }),
      );
      const res = validarRedefinicionesAcumulado(aristasVivas, lote);
      if (!res.ok) {
        throw new ErrorValidacion(
          'El ajuste formaría un ciclo en la ruta. La Ruta Crítica no admite ciclos.',
        );
      }
      // Aplica: reemplaza las aristas de cada proceso redefinido.
      for (const [idProc, idsAnt] of redefiniciones) {
        const idRuta = idRutaPorProceso.get(idProc);
        if (idRuta === undefined) continue;
        await tx.rutaOrdenDep.deleteMany({ where: { idRutaOrden: idRuta } });
        const datosDep = idsAnt
          .map((idAnt) => idRutaPorProceso.get(idAnt))
          .filter((x): x is number => x !== undefined)
          .map((idRutaAnt) => ({
            idRutaOrden: idRuta,
            idAntecesor: idRutaAnt,
            creadoPorId: sesion.id,
          }));
        if (datosDep.length > 0) {
          await tx.rutaOrdenDep.createMany({ data: datosDep, skipDuplicates: true });
        }
      }
    }

    // Tras recomponer filas/aristas el conjunto LISTO pudo cambiar (un proceso quedó sin antecesores,
    // o todos sus antecesores ya completados): re-activa los listos. Solo promueve 'pendiente'→'activo'
    // (NUNCA toca 'completado'/'activo'), así que no afecta fechas reales ni capturas conservadas.
    await activarProcesosListos(tx, datos.idOrden);

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: datos.idOrden,
      accion: 'OTRO',
      datos: {
        operacion: 'ajustar-ruta',
        agregados: (datos.agregar ?? []).map((a) => a.idProcesoDef),
        quitados: quitar,
        redefinidas: [...redefiniciones.keys()],
      },
    });

    const orden2 = await tx.orden.findUniqueOrThrow({
      where: { id: datos.idOrden },
      select: SELECT_ORDEN_RC,
    });
    const filas = await tx.rutaOrden.findMany({
      where: { idOrden: datos.idOrden },
      include: INCLUDE_RUTA,
      orderBy: { secuencia: 'asc' },
    });
    const nombres = await nombresCapturadores(tx, filas);
    const rolesSesion = await idsRolesDeSesion(tx, sesion);
    return { dto: armarDto(orden2, filas, nombres, rolesSesion), idEmpresa: orden.idEmpresa };
  }, bd);

  // ⚠️ ASUME TRANSACCIÓN PROPIA (ver la misma nota en `generarRutaOrden`): si se compone bajo una
  // `bd.tx` externa, mover este encolado a un hook post-commit del llamador.
  await encolarRecalculo(datos.idOrden, resultado.idEmpresa, 'ajustar');
  return resultado.dto;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fecha de hoy a medianoche UTC (sin hora). */
function hoyUtc(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
}

/** Encola (fire-and-forget) el recálculo del CPM de una orden. Nunca lanza al llamador. */
export async function encolarRecalculo(
  idOrden: number,
  idEmpresa: number,
  motivo: 'generar' | 'ajustar',
): Promise<void> {
  const payload: PayloadRecalcularRuta = { idOrden, idEmpresa, motivo };
  try {
    await encolarJob(COLAS_JOBS.recalcularRutaOrden, idOrden, payload);
  } catch {
    // El recálculo se puede re-disparar; no rompe la programación ya consumada.
  }
}

/** Resuelve la plantilla aplicable: por artículo concreto, si no por su familia. Solo activas. */
async function resolverPlantilla(
  tx: Tx,
  idArticuloRC: number,
  idFamiliaArticulo: number,
): Promise<Prisma.PlantillaRutaGetPayload<{ include: typeof INCLUDE_PLANTILLA }> | null> {
  const porArticulo = await tx.plantillaRuta.findFirst({
    where: { idArticuloRC, activo: true },
    include: INCLUDE_PLANTILLA,
    orderBy: { id: 'asc' },
  });
  if (porArticulo !== null) return porArticulo;
  return tx.plantillaRuta.findFirst({
    where: { idFamiliaArticulo, idArticuloRC: null, activo: true },
    include: INCLUDE_PLANTILLA,
    orderBy: { id: 'asc' },
  });
}

const INCLUDE_PLANTILLA = {
  procesos: {
    orderBy: { orden: 'asc' },
    include: {
      procesoDef: {
        select: {
          id: true,
          codigo: true,
          critico: true,
          ultimoProceso: true,
          esResurtido: true,
          condicionAplicabilidad: true,
          tipoEvento: true,
          tipoDuracion: true,
          checklist: { where: { activo: true }, orderBy: { orden: 'asc' } },
        },
      },
      antecesores: { select: { idAntecesor: true } },
    },
  },
} as const satisfies Prisma.PlantillaRutaInclude;

/** Σ de la matriz color×talla de la orden (cantidad total de piezas). */
async function sumarCantidadOrden(tx: Tx, idOrden: number): Promise<number> {
  const agregado = await tx.ordenLineaTalla.aggregate({
    where: { ordenLinea: { idOrden } },
    _sum: { cantidad: true },
  });
  return agregado._sum.cantidad ?? 0;
}

/** Factores por cantidad activos del catálogo, como rangos PUROS para `calcularDuracion`. */
async function cargarFactoresCantidad(tx: Tx): Promise<RangoFactorCantidad[]> {
  const filas = await tx.factorCantidad.findMany({
    where: { activo: true },
    orderBy: { deCant: 'asc' },
    select: { deCant: true, aCant: true, factor: true },
  });
  return filas.map((f) => ({ deCant: f.deCant, aCant: f.aCant, factor: Number(f.factor) }));
}

/** Rangos de dificultad ACTIVOS del catálogo (R4/B7), puros para `calcularDuracion`. */
async function cargarRangosDificultad(tx: Tx): Promise<RangoDificultadCalculo[]> {
  const filas = await tx.rangoDificultad.findMany({
    where: { activo: true },
    orderBy: { opsDesde: 'asc' },
    select: { opsDesde: true, opsHasta: true, diasCostura: true },
  });
  return filas;
}

/**
 * Secuencia de estampado EFECTIVA de una orden (R4/B10): la elección de la orden manda (solo la
 * guardan las flexibles); si el modelo es `flexible` y aún no hay elección → `antes` (conservador:
 * el plan reserva la espera del estampado; producción la puede soltar en vivo). PURA.
 */
export function secuenciaEstampadoEfectiva(
  modelo: 'antes' | 'despues' | 'flexible',
  elegido: 'antes' | 'despues' | 'flexible' | null,
): 'antes' | 'despues' {
  if (elegido === 'antes' || elegido === 'despues') return elegido;
  if (modelo === 'flexible') return 'antes';
  return modelo;
}

/**
 * Días NATURALES (UTC) que faltan para la fecha planeada vigente (negativo = ya venció) — la
 * HOLGURA del panel de la ruta (R4). Null si no hay fecha planeada. PURA.
 */
export function diasRestantesProceso(fechaPlaneadaVigente: Date | null, hoy: Date): number | null {
  if (fechaPlaneadaVigente === null) return null;
  const MS_DIA = 24 * 60 * 60 * 1000;
  const aMedianoche = (f: Date): number =>
    Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate());
  return Math.round((aMedianoche(fechaPlaneadaVigente) - aMedianoche(hoy)) / MS_DIA);
}

/** Colchón de costura de la empresa (días), o 0 si no hay configuración/valor. */
async function colchonDeEmpresa(tx: Tx, idEmpresa: number): Promise<number> {
  const config = await tx.configuracionEmpresa.findUnique({
    where: { idEmpresa },
    select: { colchonCostura: true },
  });
  return config?.colchonCostura ?? 0;
}

/**
 * Antecesores VIVOS de un proceso tras omitir los condicionales: si un antecesor está omitido, se
 * reemplaza por SUS antecesores vivos (transitivamente). Evita ciclos con un set de visitados.
 */
function resolverAntecesoresVivos(
  idProceso: number,
  antecesoresDirectos: ReadonlyMap<number, ReadonlySet<number>>,
  omitidos: ReadonlySet<number>,
): number[] {
  const resultado = new Set<number>();
  const visitados = new Set<number>();
  const pila: number[] = [...(antecesoresDirectos.get(idProceso) ?? [])];
  while (pila.length > 0) {
    const ant = pila.pop();
    if (ant === undefined || visitados.has(ant)) continue;
    visitados.add(ant);
    if (omitidos.has(ant)) {
      // Salta el omitido: hereda SUS antecesores (transitivo).
      for (const sub of antecesoresDirectos.get(ant) ?? []) {
        if (!visitados.has(sub)) pila.push(sub);
      }
    } else {
      resultado.add(ant);
    }
  }
  return [...resultado];
}

/** Aristas vivas de la ruta (en idProcesoDef) para validar ciclos en `ajustarRutaOrden`. */
async function cargarAristasRuta(
  tx: Tx,
  idOrden: number,
  idRutaPorProceso: ReadonlyMap<number, number>,
): Promise<{ idProceso: number; idAntecesor: number }[]> {
  // id de RutaOrden → idProcesoDef (inverso del mapa que ya tenemos).
  const procesoPorIdRuta = new Map<number, number>();
  for (const [idProc, idRuta] of idRutaPorProceso) procesoPorIdRuta.set(idRuta, idProc);

  const deps = await tx.rutaOrdenDep.findMany({
    where: { rutaOrden: { idOrden } },
    select: { idRutaOrden: true, idAntecesor: true },
  });
  const aristas: { idProceso: number; idAntecesor: number }[] = [];
  for (const d of deps) {
    const idProc = procesoPorIdRuta.get(d.idRutaOrden);
    const idAnt = procesoPorIdRuta.get(d.idAntecesor);
    if (idProc !== undefined && idAnt !== undefined) {
      aristas.push({ idProceso: idProc, idAntecesor: idAnt });
    }
  }
  return aristas;
}

/**
 * Resuelve el nombre de cada `capturadoPorId` presente en los renglones, en UN solo viaje a la BD.
 * Devuelve el mapa `idUsuario -> nombre` (las ids sin usuario quedan fuera → se proyectan a null).
 */
async function nombresCapturadores(
  cliente: ReturnType<typeof clienteLectura>,
  filas: RutaConRelaciones[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(filas.map((f) => f.capturadoPorId).filter((x): x is string => x !== null)),
  ];
  if (ids.length === 0) return new Map();
  const usuarios = await cliente.usuario.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombre: true },
  });
  return new Map(usuarios.map((u) => [u.id, u.nombre]));
}

/**
 * Proyecta orden + renglones al DTO de dominio. `nombresPorId` resuelve `capturadoPorNombre`
 * (F5-E5); `rolesSesion` deriva `esResponsableActual` (badge "tú", R4); `motivoSinRuta` viene de
 * bitácora cuando la orden no tiene ruta (R4).
 */
function armarDto(
  orden: {
    id: number;
    rcActiva: boolean | null;
    fechaInicioRC: Date | null;
    fechaEntregaRC: Date | null;
    fechaProgramada: Date | null;
    esResurtidoRC: boolean | null;
    idArticuloRcProg: number | null;
    idDuracionTela: number | null;
    idDuracionAplicacion: number | null;
    secEstampadoElegido: 'antes' | 'despues' | 'flexible' | null;
    modelo: { secuenciaEstampado: 'antes' | 'despues' | 'flexible' };
  },
  filas: RutaConRelaciones[],
  nombresPorId: ReadonlyMap<string, string> = new Map(),
  rolesSesion: 'admin' | ReadonlySet<number> = new Set<number>(),
  motivoSinRuta: string | null = null,
): RutaOrdenDto {
  // idProcesoDef por id de RutaOrden, para traducir las aristas a idProcesoDef.
  const procesoPorIdRuta = new Map(filas.map((f) => [f.id, f.idProcesoDef]));

  // Semáforo (F5-E4): HOY vs fechaPlaneadaVigente de cada proceso. Estado del recálculo: si algún
  // proceso aún NO tiene fecha vigente, el CPM no ha terminado de fechar ("recalculando…", E5).
  const hoy = new Date();
  const semaforoOrden = estadoSemaforoOrden(
    filas.map((f) => ({ fechaPlaneadaVigente: f.fechaPlaneadaVigente, fechaReal: f.fechaReal })),
    hoy,
  );
  const algunSinFechar = filas.some((f) => f.fechaPlaneadaVigente === null);
  const estadoRecalculo: 'calculado' | 'recalculando' | 'sin-ruta' =
    filas.length === 0 ? 'sin-ruta' : algunSinFechar ? 'recalculando' : 'calculado';

  // El elegido persistido solo puede ser antes|despues (lo valida el dominio al elegir); si un
  // dato viejo trajera 'flexible', se proyecta como null (sin elección).
  const elegido =
    orden.secEstampadoElegido === 'antes' || orden.secEstampadoElegido === 'despues'
      ? orden.secEstampadoElegido
      : null;

  return {
    idOrden: orden.id,
    rcActiva: orden.rcActiva ?? false,
    fechaInicioRC: orden.fechaInicioRC,
    fechaEntregaRC: orden.fechaEntregaRC,
    fechaProgramada: orden.fechaProgramada,
    esResurtido: orden.esResurtidoRC ?? false,
    idArticuloRC: orden.idArticuloRcProg,
    idTipoTela: orden.idDuracionTela,
    idAplicacion: orden.idDuracionAplicacion,
    secuenciaEstampadoModelo: orden.modelo.secuenciaEstampado,
    secEstampadoElegido: elegido,
    secuenciaEstampadoEfectiva: secuenciaEstampadoEfectiva(
      orden.modelo.secuenciaEstampado,
      elegido,
    ),
    motivoSinRuta,
    estadoRecalculo,
    semaforo: semaforoOrden,
    procesos: filas.map((f) => ({
      id: f.id,
      idProcesoDef: f.idProcesoDef,
      codigoProceso: f.procesoDef.codigo,
      nombreProceso: f.procesoDef.nombre,
      secuencia: f.secuencia,
      critico: f.critico,
      ultimoProceso: f.ultimoProceso,
      esResurtido: f.esResurtido,
      condicionAplicabilidad: f.condicionAplicabilidad,
      tipoEvento: f.procesoDef.tipoEvento,
      rolesResponsables: f.procesoDef.roles.map((r) => r.rol.nombre),
      esResponsableActual:
        rolesSesion === 'admin' || f.procesoDef.roles.some((r) => rolesSesion.has(r.idRol)),
      duracionDias: f.duracionDias,
      acumuladoDias: f.acumuladoDias,
      fechaPlaneadaOriginal: f.fechaPlaneadaOriginal,
      fechaPlaneadaVigente: f.fechaPlaneadaVigente,
      fechaReal: f.fechaReal,
      diasRestantes: diasRestantesProceso(f.fechaPlaneadaVigente, hoy),
      estado: f.estado,
      capturadoPorId: f.capturadoPorId,
      capturadoPorNombre:
        f.capturadoPorId === null ? null : (nombresPorId.get(f.capturadoPorId) ?? null),
      capturadoEn: f.capturadoEn,
      origenCaptura: f.origenCaptura,
      parcialEnCurso: f.parcialEnCurso,
      semaforo: estadoSemaforoProceso(
        { fechaPlaneadaVigente: f.fechaPlaneadaVigente, fechaReal: f.fechaReal },
        hoy,
      ),
      idsAntecesores: f.antecesores
        .map((a) => procesoPorIdRuta.get(a.idAntecesor))
        .filter((x): x is number => x !== undefined),
      checklist: f.checklist.map((c) => ({
        id: c.id,
        descripcion: c.descripcion,
        orden: c.orden,
        hecho: c.hecho,
      })),
    })),
    advertencias: [],
  };
}
