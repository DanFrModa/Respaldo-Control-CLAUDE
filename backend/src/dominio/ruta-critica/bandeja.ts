/**
 * BANDEJA "mis tareas" + CONTEO de alertas de la RUTA CRÍTICA — F5-E5 (doc `08-Ruta-Critica.md` §4;
 * D11; A1/A4/A9). Dos CONSULTAS de solo lectura sobre la ruta viva:
 *
 *  • `consultarBandeja` — las TAREAS activas de quien opera: renglones `RutaOrden` con `estado='activo'`
 *    (el motor de E4 mantiene 'activo' = sin `fechaReal` y con TODOS sus antecesores completados) de
 *    órdenes con la RC activa, de la EMPRESA activa (A9). Por defecto, solo los procesos de los que el
 *    usuario es RESPONSABLE (intersección de sus roles con `ProcesoDefRol`, N:M — la MISMA regla que la
 *    captura en `cumplimiento.ts`); el admin (`roles.administrar`) ve todo. Con `todas=true` (y permiso
 *    de supervisión `rc.programar`) muestra TODAS las tareas activas de la empresa, no solo las suyas.
 *  • `contarAlertas` — resume MIS tareas activas (misma definición, SIN `todas`) en
 *    `{ atrasados, enRiesgo }` para el badge del header.
 *
 * El SEMÁFORO y el `diasAtraso` los DERIVA el dominio (A1: cero lógica de semáforo en el frontend),
 * reusando `estadoSemaforoProceso` de `semaforoYRiesgo.ts`. `diasAtraso` se mide en DÍAS NATURALES
 * (UTC) respecto a `fechaPlaneadaVigente` vs HOY — el criterio más simple y consistente con el del
 * semáforo (que también compara días naturales, ADR-0013).
 *
 * Antirregresión N+1: una sola query Prisma con los `include` necesarios; semáforo/atraso/orden se
 * calculan en memoria. La paginación es la estándar del proyecto (tope 100).
 */
import { z } from 'zod';

import type {
  AlertasRcConteo,
  BandejaTareaSalida,
  ResponsableRc,
  ResumenPendientes,
  UrgenciaPendiente,
} from '../../contrato/esquemas/ruta-critica-bandeja.js';
import type { Prisma } from '../../datos/index.js';

import {
  armarPagina,
  esquemaPaginacion,
  rangoPrisma,
  type Pagina,
  type Paginacion,
} from '../../comun/paginacion.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { diasRestantesProceso } from './rutaOrden.js';
import { estadoSemaforoProceso, type EstadoSemaforo } from './semaforoYRiesgo.js';

// ── Días de atraso (puro) ───────────────────────────────────────────────────────────────────────

/** Trunca una fecha a medianoche UTC (solo el día calendario importa para el atraso). */
function aMedianocheUtc(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
}

/**
 * Días NATURALES (UTC) vencidos de un proceso respecto a su fecha planeada vigente: HOY − planeada,
 * acotado a ≥ 0 (0 si aún no vence o no hay planeada). Mismo criterio "días naturales" que el
 * semáforo. PURO: se prueba con fechas a mano.
 */
export function diasAtrasoProceso(fechaPlaneadaVigente: Date | null, hoy: Date): number {
  if (fechaPlaneadaVigente === null) return 0;
  const MS_DIA = 24 * 60 * 60 * 1000;
  const dias = Math.round(
    (aMedianocheUtc(hoy).getTime() - aMedianocheUtc(fechaPlaneadaVigente).getTime()) / MS_DIA,
  );
  return Math.max(0, dias);
}

/** Días que abarca la sección "esta semana" de Mis pendientes (próximos 4 días, como el proto). */
const DIAS_SEMANA_PENDIENTES = 4;

/**
 * URGENCIA de un pendiente (R4, A1: la clasificación vive en el dominio): compara la fecha
 * planeada vigente contra HOY en días naturales UTC — `vencida` (< hoy), `hoy`, `semana`
 * (próximos 4 días), `despues`, o `sinFecha` (el CPM aún no fecha). PURA.
 */
export function urgenciaProceso(fechaPlaneadaVigente: Date | null, hoy: Date): UrgenciaPendiente {
  if (fechaPlaneadaVigente === null) return 'sinFecha';
  const MS_DIA = 24 * 60 * 60 * 1000;
  const dias = Math.round(
    (aMedianocheUtc(fechaPlaneadaVigente).getTime() - aMedianocheUtc(hoy).getTime()) / MS_DIA,
  );
  if (dias < 0) return 'vencida';
  if (dias === 0) return 'hoy';
  if (dias <= DIAS_SEMANA_PENDIENTES) return 'semana';
  return 'despues';
}

// ── Orden por urgencia (puro) ─────────────────────────────────────────────────────────────────────

/** Peso del semáforo para ordenar (mayor = más urgente): atrasado > enRiesgo > aTiempo. */
const PESO_SEMAFORO: Record<EstadoSemaforo, number> = {
  atrasado: 2,
  enRiesgo: 1,
  aTiempo: 0,
};

/**
 * Ordena las tareas por URGENCIA (mutando una copia): atrasado > enRiesgo > aTiempo; dentro del mismo
 * estado, mayor `diasAtraso` primero; a igualdad, `fechaPlaneadaVigente` ascendente (la más próxima
 * primero; las sin fecha al final). Empate final estable por `idRutaOrden`. PURO: se prueba con datos
 * a mano.
 */
export function ordenarTareasPorUrgencia(
  tareas: readonly BandejaTareaSalida[],
): BandejaTareaSalida[] {
  return [...tareas].sort((a, b) => {
    const peso = PESO_SEMAFORO[b.semaforo] - PESO_SEMAFORO[a.semaforo];
    if (peso !== 0) return peso;
    if (b.diasAtraso !== a.diasAtraso) return b.diasAtraso - a.diasAtraso;
    // Planeada ascendente; null al final.
    const fa = a.fechaPlaneadaVigente;
    const fb = b.fechaPlaneadaVigente;
    if (fa !== fb) {
      if (fa === null) return 1;
      if (fb === null) return -1;
      const cmp = fa.localeCompare(fb);
      if (cmp !== 0) return cmp;
    }
    return a.idRutaOrden - b.idRutaOrden;
  });
}

// ── Carga de las tareas activas (consulta única) ──────────────────────────────────────────────────

/** `include` mínimo para proyectar una tarea sin viajes extra (encabezado + proceso + checklist). */
const INCLUDE_TAREA = {
  orden: {
    select: {
      folio: true,
      idModelo: true,
      fechaEntrega: true,
      modelo: { select: { codigo: true, descripcion: true } },
      cliente: { select: { nombre: true } },
    },
  },
  procesoDef: { select: { codigo: true, nombre: true, tipoEvento: true } },
  checklist: {
    orderBy: { orden: 'asc' },
    select: { id: true, descripcion: true, orden: true, hecho: true },
  },
} as const satisfies Prisma.RutaOrdenInclude;

type TareaConRelaciones = Prisma.RutaOrdenGetPayload<{ include: typeof INCLUDE_TAREA }>;

/** Proyecta una fila cruda + su semáforo/atraso al DTO de salida de la bandeja. */
function aTareaSalida(fila: TareaConRelaciones, hoy: Date): BandejaTareaSalida {
  const semaforo = estadoSemaforoProceso(
    { fechaPlaneadaVigente: fila.fechaPlaneadaVigente, fechaReal: fila.fechaReal },
    hoy,
  );
  return {
    idRutaOrden: fila.id,
    idOrden: fila.idOrden,
    folioOrden: Number(fila.orden.folio),
    cliente: fila.orden.cliente.nombre,
    idModelo: fila.orden.idModelo,
    codigoModelo: fila.orden.modelo.codigo,
    descripcionModelo: fila.orden.modelo.descripcion,
    idProcesoDef: fila.idProcesoDef,
    codigoProceso: fila.procesoDef.codigo,
    nombreProceso: fila.procesoDef.nombre,
    critico: fila.critico,
    tipoEvento: fila.procesoDef.tipoEvento,
    fechaEntrega: fila.orden.fechaEntrega === null ? null : fila.orden.fechaEntrega.toISOString(),
    fechaPlaneadaVigente:
      fila.fechaPlaneadaVigente === null ? null : fila.fechaPlaneadaVigente.toISOString(),
    urgencia: urgenciaProceso(fila.fechaPlaneadaVigente, hoy),
    diasRestantes: diasRestantesProceso(fila.fechaPlaneadaVigente, hoy),
    diasAtraso: diasAtrasoProceso(fila.fechaPlaneadaVigente, hoy),
    semaforo,
    parcialEnCurso: fila.parcialEnCurso,
    checklist: fila.checklist.map((c) => ({
      id: c.id,
      descripcion: c.descripcion,
      orden: c.orden,
      hecho: c.hecho,
    })),
  };
}

/**
 * Ids de los `ProcesoDef` de los que `sesion` es RESPONSABLE: procesos cuyo `ProcesoDefRol` cruza con
 * alguno de los roles del usuario (vía `UsuarioRol`). Misma intersección N:M que `exigirCapturaProceso`
 * (cumplimiento.ts). Devuelve `null` si el usuario es ADMIN (`roles.administrar`): ve todos los
 * procesos, sin filtro por responsabilidad.
 */
async function procesosResponsablesDe(
  cliente: ReturnType<typeof clienteLectura>,
  sesion: SesionUsuario,
): Promise<number[] | null> {
  if (sesion.permisos.has('roles.administrar')) return null; // admin: sin filtro.
  return procesosResponsablesDeUsuario(cliente, sesion.id);
}

/**
 * Ids de los `ProcesoDef` de los que el usuario `idUsuario` es RESPONSABLE por sus roles (la misma
 * intersección N:M), SIN el atajo de admin: al supervisar "pendientes de X" (R4) se muestra lo que
 * los ROLES de X cubren, no un "todo" implícito.
 */
async function procesosResponsablesDeUsuario(
  cliente: ReturnType<typeof clienteLectura>,
  idUsuario: string,
): Promise<number[]> {
  const rolesUsuario = await cliente.usuarioRol.findMany({
    where: { idUsuario },
    select: { idRol: true },
  });
  const idsRol = rolesUsuario.map((r) => r.idRol);
  if (idsRol.length === 0) return []; // sin roles: ninguna tarea propia.
  const puentes = await cliente.procesoDefRol.findMany({
    where: { idRol: { in: idsRol } },
    select: { idProcesoDef: true },
  });
  return [...new Set(puentes.map((p) => p.idProcesoDef))];
}

/**
 * Arma el `where` de las tareas ACTIVAS de la empresa activa (A9): renglones 'activo' de órdenes con
 * la RC viva. Si `idsProcesoResponsable` no es null, además restringe a esos procesos (las tareas del
 * usuario); si es `[]`, no devuelve nada (usuario sin procesos responsables). `filtroCliente` añade,
 * cuando viene, un `contains` insensible sobre el nombre del cliente DENTRO del mismo `orden` (para no
 * perder el scope de empresa/rcActiva).
 */
function whereTareasActivas(
  sesion: SesionUsuario,
  idsProcesoResponsable: number[] | null,
  filtroCliente?: string,
): Prisma.RutaOrdenWhereInput {
  const orden: Prisma.OrdenWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    rcActiva: true,
    ...(filtroCliente === undefined || filtroCliente === ''
      ? {}
      : { cliente: { nombre: { contains: filtroCliente, mode: 'insensitive' } } }),
  };
  return {
    estado: 'activo',
    orden,
    ...(idsProcesoResponsable === null ? {} : { idProcesoDef: { in: idsProcesoResponsable } }),
  };
}

// ── Bandeja "mis tareas" ──────────────────────────────────────────────────────────────────────────

/**
 * Esquema de los filtros de la bandeja EN DOMINIO (tipos ya nativos: `boolean`/`number`), distinto del
 * de la URL (`esquemaBandejaRcQuery`, con `z.coerce`/`z.stringbool`). La ruta coacciona la querystring
 * y pasa AQUÍ el valor nativo; los tests llaman con valores nativos. Re-validar `stringbool` sobre un
 * booleano ya coaccionado lanzaría (Zod 4.4.x) → 400 espurio; por eso el dominio tiene su propio
 * esquema con `z.boolean()` (mismo patrón que `esquemaConsultaOrdenesDominio`/`*Dominio`).
 */
const esquemaBandejaDominio = esquemaPaginacion.extend({
  idProcesoDef: z.number().int().positive().optional(),
  idOrden: z.number().int().positive().optional(),
  busquedaCliente: z.string().trim().max(200).optional(),
  todas: z.boolean().default(false),
  deUsuario: z.string().trim().max(100).optional(),
});

/** Parámetros que acepta `consultarBandeja` (forma nativa, no la de la URL). */
export type ParametrosBandeja = z.input<typeof esquemaBandejaDominio>;

/**
 * BANDEJA "mis tareas" de la Ruta Crítica (empresa activa, A9). Devuelve las tareas ACTIVAS del
 * usuario (procesos de los que es responsable), o TODAS las activas de la empresa con `todas=true`
 * (supervisión: exige `rc.programar`). Ordenadas por urgencia. Lectura; exige `rc.ruta-ver`.
 */
export async function consultarBandeja(
  sesion: SesionUsuario,
  parametros: ParametrosBandeja = {},
  bd?: ContextoBd,
  ahora: Date = new Date(),
): Promise<Pagina<BandejaTareaSalida>> {
  verificarPermiso(sesion, 'rc.ruta-ver');
  const filtros = validarEntrada(esquemaBandejaDominio, parametros);
  const cliente = clienteLectura(bd);

  // `todas` (supervisión): ver TODAS las tareas activas de la empresa exige el permiso de
  // programación (planeación/supervisión). Sin él, el flag se ignora y se acota a las propias.
  const verTodas = filtros.todas && sesion.permisos.has('rc.programar');

  // "Viendo pendientes de:" (R4): consultar los pendientes de OTRO usuario exige el MISMO permiso
  // de supervisión que `todas` (`rc.programar`) — aquí sí con 403 duro (no se ignora en silencio:
  // devolver "mis" tareas como si fueran las de otro engañaría a la pantalla).
  const deOtro = filtros.deUsuario !== undefined && filtros.deUsuario !== sesion.id;
  if (deOtro) {
    verificarPermiso(sesion, 'rc.programar');
  }

  // Procesos responsables: del usuario SUPERVISADO (por sus roles, sin atajo de admin) o del que
  // consulta (null = admin → todos). Con `verTodas`, no filtra.
  const idsResponsable = deOtro
    ? await procesosResponsablesDeUsuario(cliente, filtros.deUsuario ?? '')
    : verTodas
      ? null
      : await procesosResponsablesDe(cliente, sesion);

  // El filtro EXPLÍCITO por proceso se INTERSECA con los procesos responsables (no los pisa): si el
  // usuario filtra por un proceso del que no es responsable, no ve nada.
  let idsProcesoEfectivos: number[] | null = idsResponsable;
  if (filtros.idProcesoDef !== undefined) {
    if (idsResponsable === null) {
      idsProcesoEfectivos = [filtros.idProcesoDef]; // admin/todas: solo ese proceso.
    } else {
      idsProcesoEfectivos = idsResponsable.includes(filtros.idProcesoDef)
        ? [filtros.idProcesoDef]
        : []; // pidió un proceso del que no es responsable → vacío.
    }
  }

  const where: Prisma.RutaOrdenWhereInput = {
    ...whereTareasActivas(sesion, idsProcesoEfectivos, filtros.busquedaCliente),
    ...(filtros.idOrden === undefined ? {} : { idOrden: filtros.idOrden }),
  };

  const paginacion: Paginacion = { pagina: filtros.pagina, porPagina: filtros.porPagina };

  // El orden por urgencia se calcula en memoria (depende del semáforo derivado), así que NO se puede
  // paginar en la base con `orderBy`/`skip`/`take` por urgencia. Se traen TODAS las filas que cumplen
  // el filtro, se ordenan y se corta la página pedida. El universo (tareas ACTIVAS de la empresa) es
  // acotado por diseño, así que esto es seguro.
  const filas = await cliente.rutaOrden.findMany({ where, include: INCLUDE_TAREA });
  const tareas = ordenarTareasPorUrgencia(filas.map((f) => aTareaSalida(f, ahora)));

  const total = tareas.length;
  const inicio = rangoPrisma(paginacion).skip;
  const pagina = tareas.slice(inicio, inicio + paginacion.porPagina);
  return armarPagina(pagina, total, paginacion);
}

// ── Conteo de alertas (badge del header) ──────────────────────────────────────────────────────────

/**
 * CONTEO de MIS tareas activas por gravedad (`{ atrasados, enRiesgo }`) para el badge del header.
 * Misma definición de "mías" que la bandeja, SIN el flag `todas`. Lectura; exige `rc.ruta-ver`.
 */
export async function contarAlertas(
  sesion: SesionUsuario,
  bd?: ContextoBd,
  ahora: Date = new Date(),
): Promise<AlertasRcConteo> {
  verificarPermiso(sesion, 'rc.ruta-ver');
  const cliente = clienteLectura(bd);

  const idsResponsable = await procesosResponsablesDe(cliente, sesion);
  const filas = await cliente.rutaOrden.findMany({
    where: whereTareasActivas(sesion, idsResponsable),
    select: { fechaPlaneadaVigente: true, fechaReal: true },
  });

  let atrasados = 0;
  let enRiesgo = 0;
  for (const f of filas) {
    const estado = estadoSemaforoProceso(
      { fechaPlaneadaVigente: f.fechaPlaneadaVigente, fechaReal: f.fechaReal },
      ahora,
    );
    if (estado === 'atrasado') atrasados += 1;
    else if (estado === 'enRiesgo') enRiesgo += 1;
  }
  return { atrasados, enRiesgo };
}

// ── Resumen "Mis pendientes" (R4): KPIs + agrupación por proceso, EN SERVIDOR ─────────────────────

/** Parámetros del resumen: solo el "de quién" (supervisión, mismo gate que la bandeja). */
const esquemaResumenDominio = z.object({
  deUsuario: z.string().trim().max(100).optional(),
});

/** Parámetros de `resumenPendientes`. */
export type ParametrosResumenPendientes = z.input<typeof esquemaResumenDominio>;

/**
 * RESUMEN de "Mis pendientes" (R4): agrega EN SERVIDOR (A1) los KPIs de la pantalla (vencidas /
 * para hoy / esta semana / más adelante / total) y los grupos por TIPO de proceso con su conteo
 * (para el toggle "Agrupar por: Proceso"). Misma definición de "mis tareas" que la bandeja
 * (misma intersección de roles, mismo `deUsuario` supervisado con `rc.programar`). Lectura;
 * exige `rc.ruta-ver`.
 */
export async function resumenPendientes(
  sesion: SesionUsuario,
  parametros: ParametrosResumenPendientes = {},
  bd?: ContextoBd,
  ahora: Date = new Date(),
): Promise<ResumenPendientes> {
  verificarPermiso(sesion, 'rc.ruta-ver');
  const filtros = validarEntrada(esquemaResumenDominio, parametros);
  const cliente = clienteLectura(bd);

  const deOtro = filtros.deUsuario !== undefined && filtros.deUsuario !== sesion.id;
  if (deOtro) {
    verificarPermiso(sesion, 'rc.programar');
  }
  const idsResponsable = deOtro
    ? await procesosResponsablesDeUsuario(cliente, filtros.deUsuario ?? '')
    : await procesosResponsablesDe(cliente, sesion);

  const filas = await cliente.rutaOrden.findMany({
    where: whereTareasActivas(sesion, idsResponsable),
    select: {
      fechaPlaneadaVigente: true,
      idProcesoDef: true,
      procesoDef: { select: { codigo: true, nombre: true } },
    },
  });

  const resumen: ResumenPendientes = {
    vencidas: 0,
    paraHoy: 0,
    estaSemana: 0,
    masAdelante: 0,
    sinFecha: 0,
    total: filas.length,
    porProceso: [],
  };
  const porProceso = new Map<
    number,
    {
      codigoProceso: string;
      nombreProceso: string;
      total: number;
      vencidas: number;
      paraHoy: number;
    }
  >();
  for (const f of filas) {
    const urgencia = urgenciaProceso(f.fechaPlaneadaVigente, ahora);
    if (urgencia === 'vencida') resumen.vencidas += 1;
    else if (urgencia === 'hoy') resumen.paraHoy += 1;
    else if (urgencia === 'semana') resumen.estaSemana += 1;
    else if (urgencia === 'despues') resumen.masAdelante += 1;
    else resumen.sinFecha += 1;

    const grupo = porProceso.get(f.idProcesoDef) ?? {
      codigoProceso: f.procesoDef.codigo,
      nombreProceso: f.procesoDef.nombre,
      total: 0,
      vencidas: 0,
      paraHoy: 0,
    };
    grupo.total += 1;
    if (urgencia === 'vencida') grupo.vencidas += 1;
    if (urgencia === 'hoy') grupo.paraHoy += 1;
    porProceso.set(f.idProcesoDef, grupo);
  }

  // Grupos ordenados por lo más ATORADO (vencidas, luego para hoy, luego volumen; empate por id).
  resumen.porProceso = [...porProceso.entries()]
    .map(([idProcesoDef, g]) => ({ idProcesoDef, ...g }))
    .sort(
      (a, b) =>
        b.vencidas - a.vencidas ||
        b.paraHoy - a.paraHoy ||
        b.total - a.total ||
        a.idProcesoDef - b.idProcesoDef,
    );
  return resumen;
}

// ── Responsables RC (selector "Viendo pendientes de:", R4) ────────────────────────────────────────

/**
 * Usuarios ACTIVOS con algún rol RESPONSABLE de procesos activos de la RC — la población del
 * selector "Viendo pendientes de:". Es una función de SUPERVISIÓN: exige `rc.programar` (el mismo
 * gate que ver pendientes ajenos; NADA de permisos nuevos). Ordenados por nombre.
 */
export async function listarResponsablesRc(
  sesion: SesionUsuario,
  bd?: ContextoBd,
): Promise<ResponsableRc[]> {
  verificarPermiso(sesion, 'rc.programar');
  const cliente = clienteLectura(bd);
  const usuarios = await cliente.usuario.findMany({
    where: {
      activo: true,
      roles: { some: { rol: { procesos: { some: { procesoDef: { activo: true } } } } } },
    },
    select: { id: true, nombre: true, username: true },
    orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
  });
  return usuarios;
}
