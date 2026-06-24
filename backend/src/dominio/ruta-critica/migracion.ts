/**
 * MODO MIGRACIÓN del módulo RUTA CRÍTICA (F5-E7) — capa de dominio (A1).
 *
 * El servicio normal (`rutaOrden.ts`) está afinado para la PROGRAMACIÓN nueva: genera la ruta de una
 * orden DESDE la plantilla aplicable (resuelve artículo/familia/tela/aplicación, calcula duraciones,
 * auto-completa los procesos de duración 0, encola el CPM de E4, etc.). El histórico del viejo
 * (`RC.csv`), en cambio, NO viene de una plantilla: es una FOTO de la ruta de cada orden tal como se
 * capturó en su día (un renglón por proceso, con su `FechaEst`/`FechaReal`/`Acumulado` y QUIÉN/CUÁNDO
 * lo capturó). Hay que PRESERVARLO tal cual, sin pasarlo por el motor de plantillas.
 *
 * Para no ENSUCIAR el servicio normal con banderas de migración (E1–E6 y el API REST quedan INTACTOS:
 * esta función NO se expone en ninguna ruta Zod/REST), el modo migración vive aquí. Sigue siendo:
 *  • Transaccional (A2): toda la ruta de UNA orden (renglones + checklist) en una sola tx.
 *  • Auditada (A7): `creadoPorId`/`modificadoPorId` + `Bitacora` en la misma tx.
 *
 * Lo que RELAJA respecto al servicio normal (excepciones históricas, documentadas):
 *  • Renglones EXPLÍCITOS (de `RC.csv`), no derivados de una plantilla. No calcula duraciones ni
 *    encola el CPM (las fechas históricas se conservan tal cual; D11: explotación analítica).
 *  • Las FECHAS y la CAPTURA (`capturadoPorId`/`capturadoEn`/`origenCaptura`) se setean del viejo
 *    (`FechaEst`/`FechaReal`/`IdUsuario`/`FechaUsuarioRC`), no se re-sellan con now() ni con el ETL.
 *  • `capturadoPorId` guarda el `IdUsuario` ORIGINAL del viejo como texto (sin FK física a `usuarios`,
 *    igual que `OrdenComentario.idUsuario` de F2-E5): los 137 usuarios reales del viejo no se han
 *    migrado a v2 todavía, así que se conserva el id legacy auditable (D11: "quién capturó").
 *  • Estado por fila: `completado` si tiene `FechaReal`; si no, `activo` (en curso) o `pendiente`
 *    (sin fecha estimada). El semáforo/CPM de E4 NO se recalcula (es un snapshot histórico).
 *
 * Idempotencia: el loader BORRA la ruta histórica de la orden (Cascade limpia dep + checklist) y la
 * RECREA con el set completo del CSV. Re-ejecutar deja los MISMOS renglones (no duplica).
 */
import type { Prisma } from '../../datos/index.js';

import { registrarBitacora } from '../../comun/auditoria.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd } from '../../comun/transaccion.js';

/** Estado de un renglón de la ruta histórica (espejo del enum `EstadoProcesoRuta`). */
type EstadoProcesoRuta = 'pendiente' | 'activo' | 'completado';

/** Un ítem de checklist histórico de un renglón de la ruta de la orden (snapshot del viejo IP3/IP4). */
export interface ItemChecklistMigrado {
  descripcion: string;
  orden: number;
  hecho: boolean;
}

/** Un renglón de la RUTA HISTÓRICA de una orden (un proceso, ya resuelto a `idProcesoDef` de v2). */
export interface RenglonRutaMigrada {
  /** Proceso del catálogo v2 (resuelto del `RC.IdCP_Procesos` por el loader). */
  idProcesoDef: number;
  /** Posición del proceso en la ruta de la orden (`RC.NumProcesoRC`). */
  secuencia: number;
  /** Snapshot de la criticidad del proceso (del catálogo, al migrar). */
  critico: boolean;
  /** Snapshot de "último proceso" (del catálogo, al migrar). */
  ultimoProceso: boolean;
  /** Snapshot de "aplica en resurtido" (del catálogo, al migrar). */
  esResurtido: boolean;
  /** Snapshot de la condición de aplicabilidad (del catálogo, al migrar). */
  condicionAplicabilidad: 'ninguna' | 'soloSiLlevaAplicacion';
  /** Duración estimada en días (`RC.TiempoRC`; 0 si no venía). */
  duracionDias: number;
  /** Días acumulados hasta este proceso (`RC.Acumulado`; null si no venía). */
  acumuladoDias: number | null;
  /** Fecha estimada del viejo (`RC.FechaEst`) → fecha planeada original/vigente. */
  fechaEst: Date | null;
  /** Fecha real de cumplimiento del viejo (`RC.FechaReal`) → fechaReal. */
  fechaReal: Date | null;
  /** Quién capturó (`RC.IdUsuario` ORIGINAL como texto; null si 0/vacío). */
  capturadoPorId: string | null;
  /** Cuándo se capturó (`RC.FechaUsuarioRC`; null si no venía). */
  capturadoEn: Date | null;
  /** Ítems de checklist históricos (de `RC_IP3`/`RC_IP4`), si los hay. */
  checklist: ItemChecklistMigrado[];
}

/** Resultado de migrar la ruta histórica de UNA orden. */
export interface ResultadoRutaMigrada {
  renglones: number;
  itemsChecklist: number;
}

/**
 * Crea (o RE-CREA) la RUTA HISTÓRICA de UNA orden a partir de sus renglones explícitos del viejo, en
 * UNA transacción (A2/A7). Idempotente: borra la ruta previa de la orden (Cascade limpia dep +
 * checklist) y recrea el set completo. NO toca la plantilla ni encola el CPM.
 *
 * El `estado` y la `origenCaptura` por renglón se derivan así:
 *  • con `fechaReal` → `completado` + `origenCaptura='manual'` (lo capturó un usuario en el viejo).
 *  • sin `fechaReal` pero con `fechaEst` → `activo` (en curso, planeado pero no cumplido).
 *  • sin nada → `pendiente`.
 */
export async function crearRutaOrdenMigrada(
  sesion: SesionUsuario,
  idOrden: number,
  renglones: RenglonRutaMigrada[],
  bd?: ContextoBd,
): Promise<ResultadoRutaMigrada> {
  return enTransaccion(async (tx) => {
    // Borra la ruta anterior de la orden (idempotencia): Cascade limpia RutaOrdenDep + checklist.
    await tx.rutaOrden.deleteMany({ where: { idOrden } });

    let creados = 0;
    let items = 0;
    for (const r of renglones) {
      const estado: EstadoProcesoRuta =
        r.fechaReal !== null ? 'completado' : r.fechaEst !== null ? 'activo' : 'pendiente';
      const origenCaptura: 'manual' | null = r.fechaReal !== null ? 'manual' : null;

      const data: Prisma.RutaOrdenCreateInput = {
        orden: { connect: { id: idOrden } },
        procesoDef: { connect: { id: r.idProcesoDef } },
        secuencia: r.secuencia,
        critico: r.critico,
        ultimoProceso: r.ultimoProceso,
        esResurtido: r.esResurtido,
        condicionAplicabilidad: r.condicionAplicabilidad,
        duracionDias: r.duracionDias,
        acumuladoDias: r.acumuladoDias,
        // El viejo solo llevaba la fecha ESTIMADA (una sola): se conserva como original y vigente.
        fechaPlaneadaOriginal: r.fechaEst,
        fechaPlaneadaVigente: r.fechaEst,
        fechaReal: r.fechaReal,
        estado,
        capturadoPorId: r.capturadoPorId,
        capturadoEn: r.capturadoEn,
        ...(origenCaptura === null ? {} : { origenCaptura }),
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      };
      const fila = await tx.rutaOrden.create({ data, select: { id: true } });
      creados += 1;

      if (r.checklist.length > 0) {
        await tx.rutaOrdenChecklist.createMany({
          data: r.checklist.map((c) => ({
            idRutaOrden: fila.id,
            descripcion: c.descripcion,
            orden: c.orden,
            hecho: c.hecho,
            ...(c.hecho ? { hechoPorId: sesion.id } : {}),
            creadoPorId: sesion.id,
            modificadoPorId: sesion.id,
          })),
        });
        items += r.checklist.length;
      }
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'OTRO',
      datos: { operacion: 'migracion-rc', renglones: creados, itemsChecklist: items },
    });

    return { renglones: creados, itemsChecklist: items };
  }, bd);
}

// ── Roles RESPONSABLES de un proceso (RC_ProcUsua → ProcesoDefRol, N:M) ────────

/**
 * Sincroniza (de forma ADITIVA e IDEMPOTENTE) el set de ROLES RESPONSABLES de un proceso de la RC
 * (`ProcesoDefRol`, N:M sobre el RBAC único, A4). A DIFERENCIA del servicio normal
 * `asignarRolesResponsables` (que REEMPLAZA el set completo borrando lo que no venga), el modo
 * migración solo AGREGA las asignaciones de `RC_ProcUsua` que falten (createMany skipDuplicates),
 * SIN borrar lo que el usuario o el seed ya hayan puesto — mismo criterio que `seed-ruta-critica.ts`.
 * Devuelve cuántas filas se insertaron en ESTA corrida. Transaccional (A2) y auditado (A7) solo
 * cuando hubo inserción. NO se expone en ninguna ruta REST.
 */
export async function sincronizarRolesProcesoMigrado(
  sesion: SesionUsuario,
  idProcesoDef: number,
  idsRoles: readonly number[],
  bd?: ContextoBd,
): Promise<number> {
  const ids = [...new Set(idsRoles)];
  if (ids.length === 0) return 0;
  return enTransaccion(async (tx) => {
    const r = await tx.procesoDefRol.createMany({
      data: ids.map((idRol) => ({ idProcesoDef, idRol, creadoPorId: sesion.id })),
      skipDuplicates: true,
    });
    if (r.count > 0) {
      await registrarBitacora(tx, sesion, {
        entidad: 'ProcesoDef',
        idEntidad: idProcesoDef,
        accion: 'OTRO',
        datos: { operacion: 'migracion-roles-responsables', insertados: r.count, idsRoles: ids },
      });
    }
    return r.count;
  }, bd);
}

// ── Roles de usuario (Usuarios.IdRC_TipoUsuarios → UsuarioRol) ─────────────────

/**
 * Asigna (de forma ADITIVA e IDEMPOTENTE) un ROL funcional a un usuario v2 en el RBAC único
 * (`UsuarioRol`, A4). A DIFERENCIA del servicio normal `asignarRoles` (que REEMPLAZA el set completo),
 * el modo migración solo AGREGA el rol del `RC_TipoUsuarios` del viejo SIN borrar los demás roles del
 * usuario (createMany skipDuplicates): así no se pierde el rol Administrador ni nada ya configurado.
 * Devuelve `true` si el rol se insertó en ESTA corrida (false si ya lo tenía). Transaccional (A2) y
 * auditado (A7) solo cuando hubo inserción.
 *
 * Sin esto, la Bandeja de E5 queda vacía para los usuarios reales (su responsabilidad por proceso se
 * deriva del rol). NO se exponen en ninguna ruta REST.
 */
export async function asignarRolUsuarioMigrado(
  sesion: SesionUsuario,
  idUsuario: string,
  idRol: number,
  bd?: ContextoBd,
): Promise<boolean> {
  return enTransaccion(async (tx) => {
    const r = await tx.usuarioRol.createMany({
      data: [{ idUsuario, idRol, creadoPorId: sesion.id }],
      skipDuplicates: true,
    });
    if (r.count > 0) {
      await registrarBitacora(tx, sesion, {
        entidad: 'Usuario',
        idEntidad: idUsuario,
        accion: 'OTRO',
        datos: { operacion: 'migracion-rc-rol', idRol },
      });
    }
    return r.count > 0;
  }, bd);
}

// ── Estado RC legacy de una orden (Ordenes.{FechaInicioRC,…,RC_Viva}) ──────────

/** Campos de estado RC LEGADO de una orden a fijar (escalares snapshot de v1; sin FK ni motor). */
export interface EstadoRcOrdenMigrado {
  idTipoArticuloRC: number | null;
  idRcAplicaciones: number | null;
  idRcTipoTelas: number | null;
  fechaInicioRC: Date | null;
  fechaEntregaRC: Date | null;
  fechaProg: Date | null;
  enRiesgo: boolean | null;
  siRC: boolean | null;
  rcViva: boolean | null;
}

/**
 * Fija el ESTADO RC LEGADO de una orden (los escalares snapshot de v1: artículo/aplicación/tela RC,
 * fechas RC, `enRiesgo`/`siRC`/`rcViva`). Son DATO HISTÓRICO sin FK ni motor (distintos de los campos
 * del motor v2 `rcActiva`/`idArticuloRcProg`/…). El ETL de órdenes de F2-E5 YA los cargó al migrar
 * `Ordenes.csv`; este modo migración los RE-CONFIRMA de forma IDEMPOTENTE: actualiza SOLO si algún
 * valor difiere (re-correr no toca nada cuando ya cuadran). Transaccional (A2) y auditado (A7) solo
 * cuando hubo cambio. Devuelve `true` si actualizó en esta corrida.
 */
export async function fijarEstadoRcOrdenMigrado(
  sesion: SesionUsuario,
  idOrden: number,
  datos: EstadoRcOrdenMigrado,
  bd?: ContextoBd,
): Promise<boolean> {
  return enTransaccion(async (tx) => {
    const actual = await tx.orden.findUnique({
      where: { id: idOrden },
      select: {
        idTipoArticuloRC: true,
        idRcAplicaciones: true,
        idRcTipoTelas: true,
        fechaInicioRC: true,
        fechaEntregaRC: true,
        fechaProg: true,
        enRiesgo: true,
        siRC: true,
        rcViva: true,
      },
    });
    if (actual === null) return false;

    const igualFecha = (a: Date | null, b: Date | null): boolean =>
      (a === null && b === null) || (a !== null && b !== null && a.getTime() === b.getTime());

    const sinCambios =
      actual.idTipoArticuloRC === datos.idTipoArticuloRC &&
      actual.idRcAplicaciones === datos.idRcAplicaciones &&
      actual.idRcTipoTelas === datos.idRcTipoTelas &&
      igualFecha(actual.fechaInicioRC, datos.fechaInicioRC) &&
      igualFecha(actual.fechaEntregaRC, datos.fechaEntregaRC) &&
      igualFecha(actual.fechaProg, datos.fechaProg) &&
      actual.enRiesgo === datos.enRiesgo &&
      actual.siRC === datos.siRC &&
      actual.rcViva === datos.rcViva;
    if (sinCambios) return false;

    await tx.orden.update({
      where: { id: idOrden },
      data: {
        idTipoArticuloRC: datos.idTipoArticuloRC,
        idRcAplicaciones: datos.idRcAplicaciones,
        idRcTipoTelas: datos.idRcTipoTelas,
        fechaInicioRC: datos.fechaInicioRC,
        fechaEntregaRC: datos.fechaEntregaRC,
        fechaProg: datos.fechaProg,
        enRiesgo: datos.enRiesgo,
        siRC: datos.siRC,
        rcViva: datos.rcViva,
        modificadoPorId: sesion.id,
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'OTRO',
      datos: { operacion: 'migracion-estado-rc' },
    });
    return true;
  }, bd);
}
