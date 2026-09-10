/**
 * CAPTURA del CUMPLIMIENTO de la ruta viva — F5-E4, parte 2 del motor (ADR-0013; doc
 * `08-Ruta-Critica.md` §2.3/§4; D11). Tres operaciones de avance "la pelota pasa de mano en mano":
 *
 *  • `completarProceso`  — marca un proceso como CUMPLIDO (captura `fechaReal` + quién/cuándo, base
 *    del KPI D11) y ACTIVA los sucesores cuyos antecesores quedaron TODOS completados (generaliza
 *    `QueActiva` del viejo a N antecesores). Si el proceso era el ÚLTIMO → cierra la RC de la orden
 *    (`rcActiva = false`; equivale a `MatarRC`). La RC NUNCA escribe `Orden.fechaEntrega` (decisión
 *    (c) de E3): expone la fecha, la orden decide.
 *  • `revertirProceso`   — DESMARCA un proceso (limpia `fechaReal`/captura, recalcula estado) y, si
 *    estaba cerrada la RC por este proceso terminal, la REABRE (`rcActiva = true`). Deja rastro en
 *    `Bitacora` (A7): la historia no se pierde.
 *  • `marcarChecklistItem` — marca/desmarca un ítem de checklist; completar TODOS los ítems
 *    AUTO-COMPLETA el proceso padre; desmarcar un ítem de un proceso auto-completado por checklist lo
 *    REVIERTE (con rastro en bitácora).
 *
 * VALIDACIÓN de captura (server-side, A4): además del permiso `rc.capturar`, quien captura debe tener
 * ALGUNO de sus roles entre los roles RESPONSABLES del proceso (`ProcesoDefRol`, N:M). El admin
 * (`roles.administrar`) puede capturar cualquier proceso (mismo criterio de "marcador admin" que
 * `generaEntradaPt` en tipos-proceso / la edición de OC autorizada en compras). Y desde la fila
 * 0.175, la FECHA que se captura pasa además por su propia ventana — ver
 * {@link DIAS_VENTANA_CAPTURA_RC}: hasta entonces `fechaReal` entraba del cliente sin filtro alguno,
 * siendo la base del KPI de puntualidad (D11).
 *
 * Innegociables: A1 (lógica aquí), A2 (transacción), A7 (bitácora + `datosModificacion`).
 */
import { datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { hoyDelNegocioUtc, verificarFechaCapturable } from '../../comun/fecha-capturable.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';

/**
 * Días hacia atrás que puede fechar un cumplimiento quien NO tiene
 * `rc.fecha-libre-cumplimiento`. **Cambiar la ventana es cambiar este número, y sólo éste.**
 *
 * ⏳ **2 sale del sistema viejo, no de una suposición.** Es literal el umbral que gobernaba la
 * captura en Access —`RC_MeterDatosDet`, `FechaReal_AfterUpdate`, línea 392 del volcado—:
 *
 * ```vba
 * If PrP(10) = True Then          ' con la llave: cualquier fecha, sin límite
 * Else
 *   If FechaReal + 2 < QueFechaHoy Then
 *     MsgBox "No puedes meter una fecha con mas de dos dias de retrazo..."
 * ```
 *
 * y es el mismo 2 que lleva escrito en su nombre el acceso #10 del catálogo viejo (*«Se puede meter
 * las fechas con mas de 2 dias de retrazo»*), hoy `rc.fechas-retraso`.
 *
 * 🔴 **PERO OJO — el viejo contaba 2 días HÁBILES, no 2 de calendario, y esto no.** El mismo
 * `AfterUpdate` corría la referencia hacia atrás los lunes y martes (`QueFechaHoy = Date - 2`) para
 * que el fin de semana no se comiera la ventana: **en lunes se podía fechar hasta el jueves**. Con
 * los 2 días de calendario de aquí, un lunes sólo alcanza al sábado y **el trabajo del viernes ya
 * no se puede capturar sin la llave**. Es el único caso que el viejo se molestó en tratar aparte,
 * así que alguien lo vivió. **La ventana definitiva la contesta Daniel**; si la quiere igual que el
 * viejo en su peor caso, el número es **4** y es esta línea.
 */
export const DIAS_VENTANA_CAPTURA_RC = 2;

/**
 * LA VENTANA DE CAPTURA de la fecha real de cumplimiento — la guarda que faltaba (fila 0.175).
 *
 * `fechaReal` es la **base del KPI de puntualidad (D11)** y hasta esta fila entraba del cliente sin
 * un solo filtro: ni ventana, ni la regla «nunca el futuro», ni permiso. `rc.fecha-libre-cumplimiento`
 * llevaba sembrado desde F5 en ocho perfiles **sin un solo llamador** —una llave repartida con
 * cuidado, de una puerta que no existía—. Aquí nace la puerta.
 *
 * Es el MISMO molde que el inventario de PT (`movimientos-pt.ts`) e Indicadores
 * (`indicadores/fechas.ts`): una sola frase —*sin la llave, sólo los últimos N días y nunca el
 * futuro*— escrita una vez en `comun/fecha-capturable.ts`. Lo único propio de la RC es el N.
 *
 * ⚠️ **Lo del futuro es NUEVO respecto al viejo, y a propósito:** aquel `AfterUpdate` sólo miraba el
 * retraso, así que aceptaba una fecha futura sin chistar. Un proceso «cumplido» mañana envenena el
 * KPI de D11 —sale a tiempo algo que no ha pasado—, y el molde compartido ya lo rechaza.
 *
 * 🔴 **Y hay que decirlo aquí, pegado a la guarda: con el seed de HOY esta puerta no le cierra a
 * nadie.** Medido importando `definirRoles()` (no leyendo el archivo): de los 9 perfiles, **OCHO**
 * llevan `rc.capturar` —`Administrador` y `AdministracionDireccion`, que reciben el catálogo
 * ENTERO (`seed.ts:879-890`), más `Directivo`, `Gerencial`, `Ventas`, `Logística`, `Asistente` y
 * `Secretarial`—, y **los OCHO llevan también `rc.fecha-libre-cumplimiento`**: los que capturan sin
 * la llave son **CERO**. Es herencia de la cascada del sistema viejo, el mismo defecto que las
 * filas 0.105/0.128 vienen podando de a uno, y calcado del gemelo de PT. El MECANISMO ya existe
 * (que es lo que faltaba); a QUIÉN se le quita la llave es una decisión de perfiles que le toca a
 * Daniel, no a esta fila.
 */
function verificarFechaCumplimientoRc(sesion: SesionUsuario, fecha: Date): void {
  verificarFechaCapturable(sesion, fecha, {
    permiso: 'rc.fecha-libre-cumplimiento',
    dias: DIAS_VENTANA_CAPTURA_RC,
  });
}

/**
 * Bloqueo de las CAPTURAS de una orden dentro de la transacción (advisory lock transaccional por
 * empresa+orden). Serializa todas las capturas de la MISMA orden (completar/revertir/checklist): sin
 * él, dos transacciones completando antecesores DISTINTOS del mismo sucesor bajo READ COMMITTED
 * pueden leer ambas al otro aún no-completado y NINGUNA activar al sucesor (queda pendiente pese a
 * estar todo listo). Mismo patrón/llave que `bloquearEtapasDeOrden` (F3-E2) — órdenes distintas NO se
 * bloquean entre sí. El lock se libera al terminar la transacción.
 */
async function bloquearCapturasDeOrden(tx: Tx, idEmpresa: number, idOrden: number): Promise<void> {
  // Dos claves int4 estables (forma pg_advisory_xact_lock(int4, int4)); colisión solo serializa de
  // más. 0x4F = 'O' de orden, misma familia que las etapas de producción (correctitud por idOrden).
  const clave1 = ((idEmpresa * 1_000_003) ^ 0x4f000000) | 0;
  const clave2 = idOrden | 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave1}::int, ${clave2}::int)`;
}

/**
 * Verifica que `sesion` pueda CAPTURAR el proceso `idRutaOrden`: tiene `rc.capturar` Y (es admin O
 * alguno de sus roles está entre los roles responsables del `ProcesoDef` del renglón). Lanza
 * `ErrorPermiso` si no. Devuelve el renglón de ruta cargado (para no re-consultarlo).
 */
interface RenglonCaptura {
  id: number;
  idOrden: number;
  idEmpresa: number;
  idProcesoDef: number;
  ultimoProceso: boolean;
  fechaReal: Date | null;
  estado: 'pendiente' | 'activo' | 'completado';
  origenCaptura: 'manual' | 'evento' | null;
}

async function exigirCapturaProceso(
  tx: Tx,
  sesion: SesionUsuario,
  idRutaOrden: number,
): Promise<RenglonCaptura> {
  verificarPermiso(sesion, 'rc.capturar');

  // Scope por empresa activa (A9): un renglón de ruta de una orden de otra empresa "no existe" → 404
  // (nunca se captura/revierte su avance). Se filtra por la empresa de la ORDEN dueña del renglón.
  const fila = await tx.rutaOrden.findFirst({
    where: { id: idRutaOrden, orden: { idEmpresa: sesion.idEmpresaActiva } },
    select: {
      id: true,
      idOrden: true,
      idProcesoDef: true,
      ultimoProceso: true,
      fechaReal: true,
      estado: true,
      origenCaptura: true,
      orden: { select: { idEmpresa: true } },
    },
  });
  if (fila === null) {
    throw new ErrorNoEncontrado('RutaOrden', idRutaOrden);
  }
  const renglon: RenglonCaptura = {
    id: fila.id,
    idOrden: fila.idOrden,
    idEmpresa: fila.orden.idEmpresa,
    idProcesoDef: fila.idProcesoDef,
    ultimoProceso: fila.ultimoProceso,
    fechaReal: fila.fechaReal,
    estado: fila.estado,
    origenCaptura: fila.origenCaptura,
  };

  // Admin (roles.administrar) captura cualquier proceso (marcador de admin, A4).
  if (sesion.permisos.has('roles.administrar')) {
    return renglon;
  }

  // Roles responsables del proceso (N:M) ∩ roles del usuario. Sin intersección → 403.
  const responsables = await tx.procesoDefRol.findMany({
    where: { idProcesoDef: renglon.idProcesoDef },
    select: { idRol: true },
  });
  if (responsables.length === 0) {
    throw new ErrorPermiso(
      'El proceso no tiene roles responsables definidos; solo un administrador puede capturarlo.',
    );
  }
  const idsResponsables = new Set(responsables.map((r) => r.idRol));
  const rolesUsuario = await tx.usuarioRol.findMany({
    where: { idUsuario: sesion.id },
    select: { idRol: true },
  });
  const tieneRol = rolesUsuario.some((r) => idsResponsables.has(r.idRol));
  if (!tieneRol) {
    throw new ErrorPermiso(
      'Tu rol no es responsable de este proceso de la Ruta Crítica; no puedes capturar su avance.',
    );
  }
  return renglon;
}

/**
 * Activa los SUCESORES del proceso recién completado cuyos antecesores estén TODOS completados
 * (pendiente → activo). Generaliza `QueActiva` del viejo a N antecesores: la pelota solo pasa cuando
 * TODO lo previo está hecho. PURO sobre `tx` (sin efectos externos).
 */
async function activarSucesoresListos(tx: Tx, idRutaCompletado: number): Promise<number[]> {
  // Sucesores directos del proceso completado.
  const aristasSuc = await tx.rutaOrdenDep.findMany({
    where: { idAntecesor: idRutaCompletado },
    select: { idRutaOrden: true },
  });
  const activados: number[] = [];
  for (const { idRutaOrden: idSuc } of aristasSuc) {
    const sucesor = await tx.rutaOrden.findUnique({
      where: { id: idSuc },
      select: { id: true, estado: true },
    });
    if (sucesor === null || sucesor.estado !== 'pendiente') continue;
    // ¿Todos los antecesores del sucesor están completados?
    const antecesores = await tx.rutaOrdenDep.findMany({
      where: { idRutaOrden: idSuc },
      select: { antecesor: { select: { estado: true } } },
    });
    const todosCompletos = antecesores.every((a) => a.antecesor.estado === 'completado');
    if (todosCompletos) {
      await tx.rutaOrden.update({ where: { id: idSuc }, data: { estado: 'activo' } });
      activados.push(idSuc);
    }
  }
  return activados;
}

/**
 * Marca un proceso de la ruta como CUMPLIDO. Captura `fechaReal` (default hoy), quién/cuándo,
 * `origenCaptura = 'manual'`, `estado = 'completado'`; activa sucesores listos; si es el último
 * proceso, cierra la RC de la orden. Transaccional (A2), auditado (A7). Exige `rc.capturar` + rol
 * responsable (o admin).
 *
 * La fecha pasa por {@link verificarFechaCumplimientoRc} ANTES de abrir la transacción — mismo
 * orden que el inventario de PT (`registrarMovimientoPt`): una fecha fuera de la ventana se rechaza
 * sin gastar un viaje a la base. `rc.capturar` y el rol responsable los sigue exigiendo
 * {@link exigirCapturaProceso} dentro (y el `preHandler` de la ruta antes que nadie); los dos
 * rechazos son `ErrorPermiso`, así que por HTTP se ven igual (403).
 *
 * @param sesion       quién captura.
 * @param idRutaOrden  renglón de ruta (proceso×orden) a completar.
 * @param fechaReal    fecha de cumplimiento (default: hoy del NEGOCIO). Sujeta a la ventana de
 *                     captura salvo con `rc.fecha-libre-cumplimiento`.
 * @param bd           contexto de BD opcional.
 */
export async function completarProceso(
  sesion: SesionUsuario,
  idRutaOrden: number,
  fechaReal?: Date,
  bd?: ContextoBd,
): Promise<number> {
  const fecha = fechaReal ?? hoyDelNegocioUtc();
  verificarFechaCumplimientoRc(sesion, fecha);

  return enTransaccion(async (tx) => {
    const renglon = await exigirCapturaProceso(tx, sesion, idRutaOrden);
    // Serializa todas las capturas de ESTA orden (race de activación de sucesores).
    await bloquearCapturasDeOrden(tx, renglon.idEmpresa, renglon.idOrden);

    await tx.rutaOrden.update({
      where: { id: renglon.id },
      data: {
        fechaReal: fecha,
        estado: 'completado',
        capturadoPorId: sesion.id,
        capturadoEn: new Date(),
        origenCaptura: 'manual',
        ...datosModificacion(sesion),
      },
    });

    const activados = await activarSucesoresListos(tx, renglon.id);

    // Si es el ÚLTIMO proceso, cierra la RC (equivale a MatarRC). NO toca Orden.fechaEntrega (dec. (c)).
    if (renglon.ultimoProceso) {
      await tx.orden.update({
        where: { id: renglon.idOrden },
        data: { rcActiva: false, ...datosModificacion(sesion) },
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'RutaOrden',
      idEntidad: renglon.id,
      accion: 'OTRO',
      datos: {
        operacion: 'completar-proceso',
        idOrden: renglon.idOrden,
        fechaReal: fecha.toISOString(),
        activados,
        cerroRc: renglon.ultimoProceso,
      },
    });
    return renglon.idOrden;
  }, bd);
}

/**
 * REVIERTE el cumplimiento de un proceso (desmarcar): limpia `fechaReal`/captura, recalcula su
 * estado (activo si todos sus antecesores están completados, si no pendiente) y REABRE la RC si era
 * el proceso terminal que la cerró. Deja rastro en `Bitacora` (A7). Exige `rc.capturar` + rol
 * responsable (o admin).
 */
export async function revertirProceso(
  sesion: SesionUsuario,
  idRutaOrden: number,
  bd?: ContextoBd,
): Promise<number> {
  return enTransaccion(async (tx) => {
    const renglon = await exigirCapturaProceso(tx, sesion, idRutaOrden);
    await bloquearCapturasDeOrden(tx, renglon.idEmpresa, renglon.idOrden);
    if (renglon.fechaReal === null && renglon.estado !== 'completado') {
      throw new ErrorValidacion('El proceso no está cumplido; no hay nada que revertir.');
    }

    const nuevoEstado = await estadoSegunAntecesores(tx, renglon.id);

    await tx.rutaOrden.update({
      where: { id: renglon.id },
      data: {
        fechaReal: null,
        estado: nuevoEstado,
        capturadoPorId: null,
        capturadoEn: null,
        origenCaptura: null,
        ...datosModificacion(sesion),
      },
    });

    // Si era el último proceso y la orden tenía la RC cerrada por él, la reabre.
    if (renglon.ultimoProceso) {
      await tx.orden.update({
        where: { id: renglon.idOrden },
        data: { rcActiva: true, ...datosModificacion(sesion) },
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'RutaOrden',
      idEntidad: renglon.id,
      accion: 'OTRO',
      datos: {
        operacion: 'revertir-proceso',
        idOrden: renglon.idOrden,
        nuevoEstado,
        reabrioRc: renglon.ultimoProceso,
      },
    });
    return renglon.idOrden;
  }, bd);
}

/** Estado que corresponde a un proceso SIN cumplir según sus antecesores (activo si todos listos). */
async function estadoSegunAntecesores(
  tx: Tx,
  idRutaOrden: number,
): Promise<'pendiente' | 'activo'> {
  const antecesores = await tx.rutaOrdenDep.findMany({
    where: { idRutaOrden },
    select: { antecesor: { select: { estado: true } } },
  });
  if (antecesores.length === 0) return 'activo'; // sin antecesores: arranca activo.
  return antecesores.every((a) => a.antecesor.estado === 'completado') ? 'activo' : 'pendiente';
}

/**
 * Activa TODOS los procesos LISTOS de una orden: cada `RutaOrden` en `'pendiente'` cuyos antecesores
 * estén TODOS `'completado'` (vacuamente cierto si NO tiene antecesores: proceso raíz) pasa a
 * `'activo'`. Reusa el MISMO predicado que `estadoSegunAntecesores`/`activarSucesoresListos`.
 *
 * Es el "arranque" que faltaba: tras GENERAR (o re-ajustar) la ruta nadie había puesto en `'activo'`
 * los procesos raíz (o los que quedaron listos porque su antecesor se auto-completó por duración 0),
 * así que la bandeja (`estado='activo'`) nunca se poblaba. Al COMPLETAR un proceso ya lo cubría
 * `activarSucesoresListos`; esta es la versión que recorre la orden completa, para usarse al generar/
 * ajustar.
 *
 * UNA sola pasada basta: activar NUNCA completa nada (solo `'pendiente'→'activo'`), así que no se
 * abre la posibilidad de que activar un proceso vuelva listo a otro en la misma corrida (no hay efecto
 * dominó). NUNCA toca `'completado'` ni `'activo'` (idempotente y seguro respecto a fechas reales /
 * capturas ya existentes). PURO sobre `tx`. Devuelve los ids que activó.
 */
export async function activarProcesosListos(tx: Tx, idOrden: number): Promise<number[]> {
  const filas = await tx.rutaOrden.findMany({
    where: { idOrden, estado: 'pendiente' },
    select: { id: true, antecesores: { select: { antecesor: { select: { estado: true } } } } },
  });
  const aActivar = filas
    .filter((f) => f.antecesores.every((a) => a.antecesor.estado === 'completado'))
    .map((f) => f.id);
  if (aActivar.length > 0) {
    await tx.rutaOrden.updateMany({
      where: { id: { in: aActivar } },
      data: { estado: 'activo' },
    });
  }
  return aActivar;
}

/**
 * Marca o desmarca un ÍTEM de checklist de un proceso de la ruta. Si al marcarlo quedan TODOS los
 * ítems hechos, AUTO-COMPLETA el proceso padre con `origenCaptura='evento'` (lo completó el sistema,
 * no una captura manual de fecha — igual que la duración-0 de E3). Si al desmarcar un ítem el proceso
 * estaba AUTO-completado por checklist (origenCaptura !== 'manual'), lo REVIERTE; una completación
 * MANUAL NO se pisa. Transaccional (A2), auditado (A7). Exige `rc.capturar` + rol responsable (o admin).
 *
 * @param sesion       quién captura.
 * @param idChecklist  ítem de `RutaOrdenChecklist`.
 * @param hecho        nuevo valor del ítem.
 * @param bd           contexto de BD opcional.
 */
export async function marcarChecklistItem(
  sesion: SesionUsuario,
  idChecklist: number,
  hecho: boolean,
  bd?: ContextoBd,
): Promise<number> {
  return enTransaccion(async (tx) => {
    const item = await tx.rutaOrdenChecklist.findUnique({
      where: { id: idChecklist },
      select: { id: true, idRutaOrden: true, hecho: true },
    });
    if (item === null) {
      throw new ErrorNoEncontrado('RutaOrdenChecklist', idChecklist);
    }
    // Autoriza sobre el proceso padre (carga el renglón y valida rol/permiso).
    const renglon = await exigirCapturaProceso(tx, sesion, item.idRutaOrden);
    await bloquearCapturasDeOrden(tx, renglon.idEmpresa, renglon.idOrden);

    if (item.hecho !== hecho) {
      await tx.rutaOrdenChecklist.update({
        where: { id: item.id },
        data: {
          hecho,
          ...(hecho
            ? { fechaHecho: new Date(), hechoPorId: sesion.id }
            : { fechaHecho: null, hechoPorId: null }),
          ...datosModificacion(sesion),
        },
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'RutaOrdenChecklist',
      idEntidad: item.id,
      accion: 'OTRO',
      datos: { operacion: 'marcar-checklist', idRutaOrden: item.idRutaOrden, hecho },
    });

    // ¿Tiene checklist y quedó TODO hecho? → auto-completar el proceso (si no está ya cumplido).
    const items = await tx.rutaOrdenChecklist.findMany({
      where: { idRutaOrden: item.idRutaOrden },
      select: { hecho: true },
    });
    const todoHecho = items.length > 0 && items.every((i) => i.hecho);

    if (todoHecho && renglon.estado !== 'completado') {
      // Fecha del SERVIDOR (nadie la teclea) → no pasa por la ventana de captura; pero es la MISMA
      // columna `fechaReal` que alimenta el KPI de D11, así que se ancla en el día del NEGOCIO y no
      // en el UTC (fila 0.174): el servidor corre en UTC y quien captura está en México (−06:00),
      // de modo que entre las 18:00 y las 23:59 de allá el día UTC ya iba adelantado y el
      // cumplimiento quedaba fechado MAÑANA.
      const fecha = hoyDelNegocioUtc();
      // Lo completó el SISTEMA (todos los ítems hechos), no una captura manual de fecha → 'evento'
      // (igual que la duración-0 de E3). Así, al desmarcar un ítem, la reversión SOLO toca procesos
      // auto-completados (origenCaptura !== 'manual') y NUNCA pisa una completación manual.
      await tx.rutaOrden.update({
        where: { id: renglon.id },
        data: {
          fechaReal: fecha,
          estado: 'completado',
          capturadoPorId: sesion.id,
          capturadoEn: new Date(),
          origenCaptura: 'evento',
          ...datosModificacion(sesion),
        },
      });
      const activados = await activarSucesoresListos(tx, renglon.id);
      if (renglon.ultimoProceso) {
        await tx.orden.update({
          where: { id: renglon.idOrden },
          data: { rcActiva: false, ...datosModificacion(sesion) },
        });
      }
      await registrarBitacora(tx, sesion, {
        entidad: 'RutaOrden',
        idEntidad: renglon.id,
        accion: 'OTRO',
        datos: {
          operacion: 'auto-completar-por-checklist',
          idOrden: renglon.idOrden,
          activados,
          cerroRc: renglon.ultimoProceso,
        },
      });
    } else if (
      !todoHecho &&
      renglon.estado === 'completado' &&
      renglon.fechaReal !== null &&
      renglon.origenCaptura !== 'manual'
    ) {
      // Se desmarcó un ítem de un proceso AUTO-completado por checklist (origenCaptura !== 'manual'):
      // revierte el cumplimiento. Una completación MANUAL NO se pisa al tocar el checklist.
      const nuevoEstado = await estadoSegunAntecesores(tx, renglon.id);
      await tx.rutaOrden.update({
        where: { id: renglon.id },
        data: {
          fechaReal: null,
          estado: nuevoEstado,
          capturadoPorId: null,
          capturadoEn: null,
          origenCaptura: null,
          ...datosModificacion(sesion),
        },
      });
      if (renglon.ultimoProceso) {
        await tx.orden.update({
          where: { id: renglon.idOrden },
          data: { rcActiva: true, ...datosModificacion(sesion) },
        });
      }
      await registrarBitacora(tx, sesion, {
        entidad: 'RutaOrden',
        idEntidad: renglon.id,
        accion: 'OTRO',
        datos: {
          operacion: 'revertir-por-checklist',
          idOrden: renglon.idOrden,
          nuevoEstado,
          reabrioRc: renglon.ultimoProceso,
        },
      });
    }
    return renglon.idOrden;
  }, bd);
}
