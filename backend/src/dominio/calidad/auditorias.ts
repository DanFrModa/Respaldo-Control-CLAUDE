/**
 * Núcleo transaccional de AUDITORÍAS de calidad (F6-E2; doc `09-Control-de-Calidad.md` §1/§2/§4;
 * DECISIONES.md §F6 (a)/(b)). Toda la lógica de negocio vive AQUÍ (A1); las rutas REST solo validan
 * permiso + Zod y delegan. Una auditoría inspecciona una MUESTRA de prendas de una orden recibida de
 * un maquilero, cuenta las fallas por defecto y deja un RESULTADO que el auditor decide A MANO.
 *
 * Innegociables aplicados:
 *  • A1 — lógica aquí; rutas delgadas.
 *  • A2 — alta/captura/reclasificación en UNA transacción (encabezado + detalle + bitácora + evento).
 *  • A3 — folio `numAuditoria` por secuencia atómica por empresa (`siguienteFolio`, clave "auditoria";
 *    NUNCA Max()+1 — reemplaza el `AumentarNumAudit` del viejo).
 *  • A4 — cada operación re-verifica su permiso (generar / actualizar).
 *  • A7 — bitácora uniforme en cada escritura.
 *  • A9 — todo se filtra/sella por la empresa ACTIVA de la sesión.
 *  • D3 — la reclasificación Primeras↔Segundas es un TRASPASO de kardex (motor `comun/kardex.ts`),
 *    NUNCA una edición de existencias.
 *
 * Decisiones de Daniel (DECISIONES.md §F6):
 *  • (a) RESULTADO MANUAL: el veredicto lo decide el humano; el cálculo por nivel AQL es solo
 *    SUGERENCIA informativa (metadato para KPIs de F7), NO vinculante. La severidad del defecto NO
 *    entra en el veredicto.
 *  • (b) MUESTRA: se propone automática del plan AQL default por la cantidad de la orden; cambiarla a
 *    mano enciende `muestraManual` (gobernado por el permiso de captura).
 *  • Pre-carga de TODOS los favoritos al alta (ex `InsertarFav`); maquilero propuesto de las entregas
 *    reales de la orden, pero ELEGIBLE (mejora del `PrimerMaq`).
 *
 * Integración RC (F5-E6): al CAPTURAR resultado se publica el evento `auditoria-calidad-resuelta` al
 * OUTBOX (en la MISMA tx); el auto-avance re-evalúa el proceso `auditoria` de la orden: si hay una
 * auditoría FINAL aprobada VIVA, lo auto-completa; si no, lo des-completa (idempotente, decisión (f)).
 */
import {
  esquemaAuditoriaCrear,
  esquemaAuditoriaResultadoCuerpo,
  esquemaReclasificacionCuerpo,
  type AuditoriaContextoSalida,
  type AuditoriaSalida,
  type SugerenciaAqlSalida,
} from '../../contrato/index.js';
import { TipoEtapaMovimiento, type Prisma, type PrismaClient } from '../../datos/index.js';
import type { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { dispararPublicacion } from '../../comun/cola-eventos.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  EVENTOS_OUTBOX,
  VERSION_AUDITORIA_CALIDAD,
  registrarEventoOutbox,
  type EventoAuditoriaCalidad,
} from '../../comun/eventos-dominio.js';
import {
  bloquearArticuloPt,
  existenciaPtBloqueada,
  registrarTraspasoPt as registrarTraspasoPtMotor,
  type LineaMovimientoPt,
} from '../../comun/kardex.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { resolverPlanPorLote, type RenglonPlanResuelto } from './planes-aql.js';

/** Clave de la secuencia de folios de auditorías (A3, por empresa). */
const CLAVE_SECUENCIA_AUDITORIA = 'auditoria';
/** Códigos de los tipos de movimiento de las patas del traspaso de reclasificación (seed F3-E3). */
const COD_TRANSFERENCIA_SALIDA = 'transferencia-salida';
const COD_TRANSFERENCIA_ENTRADA = 'transferencia-entrada';
/** Nombres de los almacenes de PT entre los que reclasifica una auditoría (seed F3-E1). */
const ALMACEN_PRIMERAS = 'Primeras';
const ALMACEN_SEGUNDAS = 'Segundas';

/** Alta de auditoría (campos del esquema compartido). */
export type EntradaAuditoriaCrear = z.input<typeof esquemaAuditoriaCrear>;
/** Captura de resultados (campos del esquema compartido). */
export type EntradaAuditoriaResultado = z.input<typeof esquemaAuditoriaResultadoCuerpo>;
/** Reclasificación (campos del esquema compartido). */
export type EntradaReclasificacion = z.input<typeof esquemaReclasificacionCuerpo>;

// ─────────────────────────────────────────────────────────────────────────────
// Sugerencia AQL (PURA — unit-testeable; decisión (a))
// ─────────────────────────────────────────────────────────────────────────────

/** Un defecto con su nivel AQL y sus fallas, para calcular la sugerencia. */
export interface DefectoFallaNivel {
  nivelAQL: number;
  numFallas: number;
}

/**
 * Calcula la SUGERENCIA AQL (informativa, NO vinculante — decisión (a)). Σ las fallas por NIVEL AQL
 * (niveles distintos NO se suman entre sí) y compara contra el Ac/Re del plan para ese nivel: `≤ Ac`
 * sugiere aprobar, `≥ Re` sugiere reprobar (como Re = Ac+1, no hay zona muerta). La sugerencia GLOBAL
 * es reprobar si ALGÚN nivel sugiere reprobar. PURA (sin BD). Si no hay renglón de plan (`null`), la
 * sugerencia no es resoluble (la captura es posible igual: el veredicto es manual).
 */
export function calcularSugerenciaAql(
  defectos: readonly DefectoFallaNivel[],
  renglon: RenglonPlanResuelto | null,
  tamanoLote: number,
): SugerenciaAqlSalida {
  if (renglon === null) {
    return {
      resoluble: false,
      idPlan: null,
      nombrePlan: null,
      tamanoLote,
      tamanoMuestra: null,
      niveles: [],
      sugerenciaGlobal: null,
      mensaje:
        'No hay un plan AQL default que cubra esta cantidad; el resultado se decide a mano (decisión a).',
    };
  }

  const fallasPorNivel = new Map<number, number>();
  for (const d of defectos) {
    fallasPorNivel.set(d.nivelAQL, (fallasPorNivel.get(d.nivelAQL) ?? 0) + d.numFallas);
  }

  const niveles = renglon.niveles.map((n) => {
    const totalFallas = fallasPorNivel.get(n.nivelAQL) ?? 0;
    const sugerencia: 'aprobar' | 'reprobar' = totalFallas <= n.aceptar ? 'aprobar' : 'reprobar';
    return {
      nivelAQL: n.nivelAQL,
      totalFallas,
      aceptar: n.aceptar,
      rechazar: n.rechazar,
      sugerencia,
    };
  });
  const sugerenciaGlobal: 'aprobar' | 'reprobar' = niveles.some((n) => n.sugerencia === 'reprobar')
    ? 'reprobar'
    : 'aprobar';

  return {
    resoluble: true,
    idPlan: renglon.idPlan,
    nombrePlan: renglon.nombrePlan,
    tamanoLote,
    tamanoMuestra: renglon.tamanoMuestra,
    niveles,
    sugerenciaGlobal,
    mensaje: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecturas de apoyo
// ─────────────────────────────────────────────────────────────────────────────

/** Cliente de lectura o transacción: ambos exponen los mismos delegados de modelo. */
type ClienteBd = Tx | PrismaClient;

/** Cantidad TOTAL de la orden (Σ color×talla de `OrdenLineaTalla`, D4 — ex `TraerCant`). */
async function cantidadDeOrden(tx: ClienteBd, idOrden: number): Promise<number> {
  const agregado = await tx.ordenLineaTalla.aggregate({
    where: { ordenLinea: { idOrden } },
    _sum: { cantidad: true },
  });
  return agregado._sum.cantidad ?? 0;
}

/** Un maquilero propuesto de la orden. */
interface MaquileroPropuesto {
  id: number;
  nombre: string;
  sugerido: boolean;
}

/**
 * Maquileros REALES de una orden: los terceros de sus etapas de envío/recibo de maquila VIVAS (ex
 * `Entregas`/`Recibos`) más el maquilero asignado a la orden. El SUGERIDO (ex `PrimerMaq`) es el del
 * recibo de costura más reciente, o el del envío más reciente, o el asignado a la orden. Sin repetir.
 */
async function maquilerosDeOrden(tx: ClienteBd, idOrden: number): Promise<MaquileroPropuesto[]> {
  const etapas = await tx.etapaMovimiento.findMany({
    where: {
      idOrden,
      canceladoEn: null,
      tipo: { in: [TipoEtapaMovimiento.recibo_maquila, TipoEtapaMovimiento.envio_maquila] },
      idTercero: { not: null },
    },
    select: {
      idTercero: true,
      tipo: true,
      fecha: true,
      tercero: { select: { nombre: true } },
    },
    orderBy: { fecha: 'desc' },
  });
  const orden = await tx.orden.findUnique({
    where: { id: idOrden },
    select: { idMaquilero: true, maquilero: { select: { nombre: true } } },
  });

  // El sugerido: el tercero del recibo más reciente; si no hay recibo, el del envío más reciente; si
  // no hay etapas, el maquilero asignado a la orden.
  const recibo = etapas.find((e) => e.tipo === TipoEtapaMovimiento.recibo_maquila);
  const idSugerido = recibo?.idTercero ?? etapas[0]?.idTercero ?? orden?.idMaquilero ?? null;

  const porId = new Map<number, MaquileroPropuesto>();
  for (const e of etapas) {
    if (e.idTercero === null) continue;
    if (!porId.has(e.idTercero)) {
      porId.set(e.idTercero, {
        id: e.idTercero,
        nombre: e.tercero?.nombre ?? `Proveedor ${String(e.idTercero)}`,
        sugerido: e.idTercero === idSugerido,
      });
    }
  }
  if (orden?.idMaquilero != null && !porId.has(orden.idMaquilero)) {
    porId.set(orden.idMaquilero, {
      id: orden.idMaquilero,
      nombre: orden.maquilero?.nombre ?? `Proveedor ${String(orden.idMaquilero)}`,
      sugerido: orden.idMaquilero === idSugerido,
    });
  }
  return [...porId.values()];
}

/** `include` para proyectar una auditoría con su detalle + datos legibles. */
const incluirAuditoria = {
  maquilero: { select: { nombre: true } },
  orden: { select: { folio: true, idModelo: true, modelo: { select: { codigo: true } } } },
  defectos: {
    orderBy: [{ defecto: { nivelAQL: 'asc' } }, { idDefecto: 'asc' }],
    include: {
      defecto: {
        select: { clave: true, descripcion: true, nivelAQL: true, favorito: true, activo: true },
      },
    },
  },
} satisfies Prisma.AuditoriaInclude;

type AuditoriaConDetalle = Prisma.AuditoriaGetPayload<{ include: typeof incluirAuditoria }>;

/** Convierte un `@db.Date` a `YYYY-MM-DD`. */
function aFechaIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Proyecta una auditoría (con su detalle + sugerencia ya calculada) a la forma JSON del contrato. */
function aAuditoriaSalida(
  a: AuditoriaConDetalle,
  sugerencia: SugerenciaAqlSalida,
): AuditoriaSalida {
  let totalFallas = 0;
  const defectos = a.defectos.map((d) => {
    totalFallas += d.numFallas;
    return {
      idDefecto: d.idDefecto,
      clave: d.defecto.clave,
      descripcion: d.defecto.descripcion,
      nivelAQL: d.defecto.nivelAQL.toNumber(),
      favorito: d.defecto.favorito,
      activo: d.defecto.activo,
      numFallas: d.numFallas,
    };
  });

  return {
    id: a.id,
    numAuditoria: Number(a.numAuditoria),
    idEmpresa: a.idEmpresa,
    idOrden: a.idOrden,
    folioOrden: a.orden.folio === null ? null : Number(a.orden.folio),
    codigoModelo: a.orden.modelo.codigo,
    idMaquilero: a.idMaquilero,
    maquilero: a.maquilero?.nombre ?? null,
    fechaElaboracion: aFechaIso(a.fechaElaboracion),
    fechaAuditoria: aFechaIso(a.fechaAuditoria),
    elaboroPorId: a.elaboroPorId,
    auditorPorId: a.auditorPorId,
    tamanoMuestra: a.tamanoMuestra,
    muestraManual: a.muestraManual,
    resultado: a.resultado,
    resultadoManual: a.resultadoManual,
    tipoAuditoria: a.tipoAuditoria,
    observaciones: a.observaciones,
    cancelada: a.cancelada,
    totalFallas,
    defectos,
    sugerencia,
    creadoEn: a.creadoEn.toISOString(),
    creadoPorId: a.creadoPorId,
    modificadoEn: a.modificadoEn.toISOString(),
    modificadoPorId: a.modificadoPorId,
  };
}

/** Carga la auditoría (con detalle) de la empresa activa y calcula su sugerencia AQL. */
async function obtenerAuditoriaProyectada(
  sesion: SesionUsuario,
  idAuditoria: number,
  bd?: ContextoBd,
): Promise<AuditoriaSalida> {
  const cliente = clienteLectura(bd);
  const a = await cliente.auditoria.findFirst({
    where: { id: idAuditoria, idEmpresa: sesion.idEmpresaActiva },
    include: incluirAuditoria,
  });
  if (a === null) {
    throw new ErrorNoEncontrado('Auditoria', idAuditoria);
  }
  const cantidad = await cantidadDeOrden(cliente, a.idOrden);
  const renglon = await resolverPlanPorLote(cantidad, bd);
  const sugerencia = calcularSugerenciaAql(
    a.defectos.map((d) => ({ nivelAQL: d.defecto.nivelAQL.toNumber(), numFallas: d.numFallas })),
    renglon,
    cantidad,
  );
  return aAuditoriaSalida(a, sugerencia);
}

// ─────────────────────────────────────────────────────────────────────────────
// Operaciones de ESCRITURA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Da de alta una auditoría de una orden (doc 09 §2 — ex `CC_AltaAuditorias`). Permiso
 * `calidad.generar-auditorias`. En UNA transacción (A2): genera el folio (A3), trae la cantidad de la
 * orden (ex `TraerCant`), propone/valida el maquilero de las entregas reales (ex `PrimerMaq`, pero
 * ELEGIBLE), calcula el tamaño de muestra del plan AQL default (decisión (b)), pre-carga TODOS los
 * defectos favoritos activos con 0 fallas (ex `InsertarFav`) y registra el doble responsable
 * (elaboró/auditor = usuario de sesión). El resultado nace `no_calificado`.
 */
export async function crearAuditoria(
  sesion: SesionUsuario,
  entrada: EntradaAuditoriaCrear,
  bd?: ContextoBd,
): Promise<AuditoriaSalida> {
  verificarPermiso(sesion, 'calidad.generar-auditorias');
  const datos = validarEntrada(esquemaAuditoriaCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const hoy = aFechaIso(new Date());

  const idAuditoria = await enTransaccion(async (tx) => {
    const orden = await tx.orden.findFirst({
      where: { id: datos.idOrden, idEmpresa },
      select: { id: true },
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', datos.idOrden);
    }

    const cantidad = await cantidadDeOrden(tx, datos.idOrden);
    const maquileros = await maquilerosDeOrden(tx, datos.idOrden);

    // Maquilero: si vino uno, debe ser de los propuestos (decisión: elegir entre los reales de la
    // orden). Si no vino, se usa el sugerido; si no hay propuestos, queda null.
    let idMaquilero: number | null;
    if (datos.idMaquilero != null) {
      if (!maquileros.some((m) => m.id === datos.idMaquilero)) {
        throw new ErrorValidacion(
          'El maquilero elegido no es de los que participaron en la orden (envío/recibo o asignado).',
        );
      }
      idMaquilero = datos.idMaquilero;
    } else {
      idMaquilero = maquileros.find((m) => m.sugerido)?.id ?? maquileros[0]?.id ?? null;
    }

    // Muestra del plan AQL default por la cantidad (decisión (b)). Si no hay plan resoluble, 0 (la
    // captura permite override): es un borde — el seed siembra el plan default.
    const renglon = await resolverPlanPorLote(cantidad, { tx });
    const tamanoMuestra = renglon?.tamanoMuestra ?? 0;

    const folio = await siguienteFolio(tx, idEmpresa, CLAVE_SECUENCIA_AUDITORIA);

    const favoritos = await tx.defectoCatalogo.findMany({
      where: { favorito: true, activo: true },
      select: { id: true },
    });

    const auditoria = await tx.auditoria.create({
      data: {
        numAuditoria: folio,
        idEmpresa,
        idOrden: datos.idOrden,
        idMaquilero,
        fechaElaboracion: new Date(`${datos.fechaElaboracion ?? hoy}T00:00:00.000Z`),
        fechaAuditoria: new Date(`${datos.fechaAuditoria ?? hoy}T00:00:00.000Z`),
        elaboroPorId: sesion.id,
        auditorPorId: sesion.id,
        tamanoMuestra,
        muestraManual: false,
        tipoAuditoria: datos.tipoAuditoria,
        defectos: {
          create: favoritos.map((f) => ({
            idDefecto: f.id,
            numFallas: 0,
            ...datosCreacion(sesion),
          })),
        },
        ...datosCreacion(sesion),
      },
      select: { id: true },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Auditoria',
      idEntidad: auditoria.id,
      accion: 'CREAR',
      datos: {
        numAuditoria: folio.toString(),
        idOrden: datos.idOrden,
        idMaquilero,
        cantidad,
        tamanoMuestra,
        favoritosPrecargados: favoritos.length,
        tipoAuditoria: datos.tipoAuditoria,
      },
    });
    return auditoria.id;
  }, bd);

  return obtenerAuditoriaProyectada(sesion, idAuditoria, bd);
}

/**
 * Captura los RESULTADOS de una auditoría (doc 09 §2). Permiso `calidad.actualizar-auditorias`. El
 * auditor captura las fallas por defecto (REEMPLAZAN el set completo) y decide a mano el `resultado`
 * con observaciones (decisión (a) — la sugerencia AQL NO es vinculante). El `tamanoMuestra` opcional
 * sobre-escribe la muestra del plan (decisión (b) — gobernado por este mismo permiso, queda en
 * Bitácora con `muestraManual`). En la MISMA tx (A2) se publica el evento `auditoria-calidad-resuelta`
 * al outbox para que el auto-avance de la RC re-evalúe el proceso `auditoria` de la orden.
 */
export async function capturarResultado(
  sesion: SesionUsuario,
  idAuditoria: number,
  entrada: EntradaAuditoriaResultado,
  bd?: ContextoBd,
): Promise<AuditoriaSalida> {
  verificarPermiso(sesion, 'calidad.actualizar-auditorias');
  const datos = validarEntrada(esquemaAuditoriaResultadoCuerpo, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  // Sin defectos repetidos en la captura (defensa; la unicidad la refuerza la BD).
  const ids = datos.defectos.map((d) => d.idDefecto);
  if (new Set(ids).size !== ids.length) {
    throw new ErrorValidacion('Un defecto no puede aparecer dos veces en la captura.');
  }

  await enTransaccion(async (tx) => {
    const actual = await tx.auditoria.findFirst({
      where: { id: idAuditoria, idEmpresa },
      select: { id: true, idOrden: true, cancelada: true, tamanoMuestra: true },
    });
    if (actual === null) {
      throw new ErrorNoEncontrado('Auditoria', idAuditoria);
    }
    if (actual.cancelada) {
      throw new ErrorConflicto('La auditoría está cancelada; no se puede capturar.');
    }

    // Los defectos capturados deben existir en el catálogo (activos o ya cargados).
    if (ids.length > 0) {
      const existentes = await tx.defectoCatalogo.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      if (existentes.length !== new Set(ids).size) {
        throw new ErrorValidacion('Algún defecto capturado no existe en el catálogo.');
      }
    }

    // Rewrite del set de fallas (patrón "rewrite del BOM"): borra y recrea.
    await tx.auditoriaDefecto.deleteMany({ where: { idAuditoria } });
    if (datos.defectos.length > 0) {
      await tx.auditoriaDefecto.createMany({
        data: datos.defectos.map((d) => ({
          idAuditoria,
          idDefecto: d.idDefecto,
          numFallas: d.numFallas,
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        })),
      });
    }

    const cambios: Prisma.AuditoriaUpdateInput = {
      resultado: datos.resultado,
      resultadoManual: true,
      observaciones: datos.observaciones ?? null,
      auditorPorId: sesion.id,
      ...datosModificacion(sesion),
    };
    // Override de muestra (decisión (b)): solo si cambia respecto a la actual (enciende muestraManual).
    let muestraNueva: number | null = null;
    if (datos.tamanoMuestra !== undefined && datos.tamanoMuestra !== actual.tamanoMuestra) {
      cambios.tamanoMuestra = datos.tamanoMuestra;
      cambios.muestraManual = true;
      muestraNueva = datos.tamanoMuestra;
    }
    await tx.auditoria.update({ where: { id: idAuditoria }, data: cambios });

    await registrarBitacora(tx, sesion, {
      entidad: 'Auditoria',
      idEntidad: idAuditoria,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'capturar-resultado',
        resultado: datos.resultado,
        renglones: datos.defectos.length,
        ...(muestraNueva !== null
          ? { muestraSobreescrita: { de: actual.tamanoMuestra, a: muestraNueva } }
          : {}),
        ...(datos.observaciones != null && datos.observaciones !== ''
          ? { observaciones: datos.observaciones }
          : {}),
      },
    });

    // OUTBOX (F5-E6): el auto-avance re-evalúa el proceso `auditoria` de la orden. Se publica en TODA
    // captura (no solo al aprobar) para que des-completar también funcione (decisión (f)).
    const payload: EventoAuditoriaCalidad = { idEmpresa, idOrden: actual.idOrden };
    await registrarEventoOutbox(
      tx,
      EVENTOS_OUTBOX.auditoriaCalidadResuelta,
      VERSION_AUDITORIA_CALIDAD,
      idEmpresa,
      payload,
    );
  }, bd);

  dispararPublicacion();
  return obtenerAuditoriaProyectada(sesion, idAuditoria, bd);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reclasificación Primeras↔Segundas (traspaso de kardex — D3)
// ─────────────────────────────────────────────────────────────────────────────

/** Resuelve un tipo de movimiento por su `codigo`, exigiéndolo activo. */
async function tipoMovPorCodigo(tx: Tx, codigo: string): Promise<number> {
  const tipo = await tx.tipoMovimientoInventario.findUnique({
    where: { codigo },
    select: { id: true, activo: true, nombre: true },
  });
  if (tipo === null) {
    throw new ErrorValidacion(
      `Falta el tipo de movimiento "${codigo}" en el catálogo (re-sembrar).`,
    );
  }
  if (!tipo.activo) {
    throw new ErrorValidacion(`El tipo de movimiento "${tipo.nombre}" está desactivado.`);
  }
  return tipo.id;
}

/** Resuelve un almacén de PT por nombre (global o de la empresa activa). */
async function almacenPtPorNombre(tx: Tx, nombre: string, idEmpresa: number): Promise<number> {
  const almacen = await tx.almacen.findFirst({
    where: { nombre, tipo: 'PT', OR: [{ idEmpresa: null }, { idEmpresa }] },
    select: { id: true },
  });
  if (almacen === null) {
    throw new ErrorValidacion(`Falta el almacén de PT "${nombre}" (re-sembrar).`);
  }
  return almacen.id;
}

/** Aplana la matriz de reclasificación a celdas con cantidad > 0 (D4). Exige al menos una. Las
 * celdas quedan etiquetadas con la ORDEN auditada (F6-E2 "PT por orden"): la reclasificación mueve
 * SOLO las prendas de esa orden entre Primeras/Segundas, no el modelo entero. */
function aplanarReclasif(
  lineas: EntradaReclasificacion['lineas'],
  idModelo: number,
  idOrden: number,
): LineaMovimientoPt[] {
  const celdas: LineaMovimientoPt[] = [];
  for (const linea of lineas) {
    for (const t of linea.tallas) {
      if (t.cantidad > 0) {
        celdas.push({
          idModelo,
          idColor: linea.idColor,
          idTalla: t.idTalla,
          idOrden,
          cantidad: t.cantidad,
        });
      }
    }
  }
  if (celdas.length === 0) {
    throw new ErrorValidacion(
      'La reclasificación no tiene ninguna pieza (todas las cantidades son 0).',
    );
  }
  return celdas;
}

/** Valida bajo lock que sacar `celdas` del almacén origen no deje existencia negativa (D3). */
async function validarNoNegativo(
  tx: Tx,
  idEmpresa: number,
  idAlmacen: number,
  celdas: readonly LineaMovimientoPt[],
): Promise<void> {
  const ordenadas = [...celdas].sort((a, b) => a.idColor - b.idColor || a.idTalla - b.idTalla);
  for (const c of ordenadas) {
    // PT por orden (F6-E2): valida contra el saldo de la ORDEN auditada en el almacén origen.
    const idOrden = c.idOrden ?? null;
    await bloquearArticuloPt(tx, idEmpresa, idAlmacen, c.idModelo, c.idColor, c.idTalla, idOrden);
    const existencia = await existenciaPtBloqueada(
      tx,
      idEmpresa,
      idAlmacen,
      c.idModelo,
      c.idColor,
      c.idTalla,
      idOrden,
    );
    if (existencia - c.cantidad < 0) {
      throw new ErrorConflicto(
        `No hay existencia suficiente para reclasificar: se intentan mover ${String(c.cantidad)} pza(s) ` +
          `de un artículo de esta orden con ${String(existencia)} en el almacén origen (no se permite negativo).`,
      );
    }
  }
}

/**
 * Reclasifica prendas Primeras↔Segundas tras una auditoría (doc 03 paso 5; D3). Genera un TRASPASO de
 * kardex (motor `comun/kardex.ts`) entre los almacenes "Primeras" y "Segundas" — NUNCA edita
 * existencias. Permiso `calidad.actualizar-auditorias` (es un acto de calidad; no exige permiso de
 * inventario, por eso usa el motor directo y valida no-negativo aquí). El modelo lo deriva de la orden
 * de la auditoría. Queda en Bitácora ligado a la auditoría (trazabilidad).
 */
export async function reclasificar(
  sesion: SesionUsuario,
  idAuditoria: number,
  entrada: EntradaReclasificacion,
  bd?: ContextoBd,
): Promise<AuditoriaSalida> {
  verificarPermiso(sesion, 'calidad.actualizar-auditorias');
  const datos = validarEntrada(esquemaReclasificacionCuerpo, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const hoy = aFechaIso(new Date());

  await enTransaccion(async (tx) => {
    const auditoria = await tx.auditoria.findFirst({
      where: { id: idAuditoria, idEmpresa },
      select: {
        id: true,
        numAuditoria: true,
        cancelada: true,
        idOrden: true,
        orden: { select: { idModelo: true } },
      },
    });
    if (auditoria === null) {
      throw new ErrorNoEncontrado('Auditoria', idAuditoria);
    }
    if (auditoria.cancelada) {
      throw new ErrorConflicto('La auditoría está cancelada; no se puede reclasificar.');
    }

    const idModelo = auditoria.orden.idModelo;
    const celdas = aplanarReclasif(datos.lineas, idModelo, auditoria.idOrden);

    const idPrimeras = await almacenPtPorNombre(tx, ALMACEN_PRIMERAS, idEmpresa);
    const idSegundas = await almacenPtPorNombre(tx, ALMACEN_SEGUNDAS, idEmpresa);
    const idAlmacenOrigen = datos.sentido === 'a-segundas' ? idPrimeras : idSegundas;
    const idAlmacenDestino = datos.sentido === 'a-segundas' ? idSegundas : idPrimeras;

    const idTipoSalida = await tipoMovPorCodigo(tx, COD_TRANSFERENCIA_SALIDA);
    const idTipoEntrada = await tipoMovPorCodigo(tx, COD_TRANSFERENCIA_ENTRADA);

    await validarNoNegativo(tx, idEmpresa, idAlmacenOrigen, celdas);

    const { salida, entrada: entradaMov } = await registrarTraspasoPtMotor(
      sesion,
      {
        idEmpresa,
        idTipoMovSalida: idTipoSalida,
        idTipoMovEntrada: idTipoEntrada,
        idAlmacenOrigen,
        idAlmacenDestino,
        fecha: new Date(`${datos.fecha ?? hoy}T00:00:00.000Z`),
        lineas: celdas,
        observaciones:
          datos.observaciones ??
          `Reclasificación de auditoría #${String(auditoria.numAuditoria)} (${datos.sentido}).`,
      },
      { tx },
    );

    await registrarBitacora(tx, sesion, {
      entidad: 'Auditoria',
      idEntidad: idAuditoria,
      accion: 'OTRO',
      datos: {
        operacion: 'reclasificacion',
        sentido: datos.sentido,
        piezas: celdas.reduce((s, c) => s + c.cantidad, 0),
        movimientoSalida: salida.id,
        movimientoEntrada: entradaMov.id,
      },
    });
  }, bd);

  return obtenerAuditoriaProyectada(sesion, idAuditoria, bd);
}

// ─────────────────────────────────────────────────────────────────────────────
// Consultas (SOLO LECTURA)
// ─────────────────────────────────────────────────────────────────────────────

/** Obtiene una auditoría (con su detalle y sugerencia) de la empresa activa. `calidad.ver`. */
export async function obtenerAuditoria(
  sesion: SesionUsuario,
  idAuditoria: number,
  bd?: ContextoBd,
): Promise<AuditoriaSalida> {
  verificarPermiso(sesion, 'calidad.ver');
  return obtenerAuditoriaProyectada(sesion, idAuditoria, bd);
}

/**
 * Contexto de una orden para dar de alta su auditoría (alta — ex `TraerCant`/`PrimerMaq`): cantidad
 * total, maquileros propuestos (de las entregas reales) y la muestra propuesta del plan AQL default.
 * Permiso `calidad.generar-auditorias` (es el flujo de alta). A9.
 */
export async function obtenerContextoOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<AuditoriaContextoSalida> {
  verificarPermiso(sesion, 'calidad.generar-auditorias');
  const cliente = clienteLectura(bd);
  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: { id: true, folio: true, idModelo: true, modelo: { select: { codigo: true } } },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  const cantidad = await cantidadDeOrden(cliente, idOrden);
  const maquileros = await maquilerosDeOrden(cliente, idOrden);
  const renglon = await resolverPlanPorLote(cantidad, bd);

  const muestra =
    renglon === null
      ? {
          resoluble: false,
          idPlan: null,
          nombrePlan: null,
          tamanoLote: cantidad,
          tamanoMuestra: null,
          niveles: [],
          mensaje: 'No hay un plan AQL default que cubra esta cantidad; captura la muestra a mano.',
        }
      : {
          resoluble: true,
          idPlan: renglon.idPlan,
          nombrePlan: renglon.nombrePlan,
          tamanoLote: cantidad,
          tamanoMuestra: renglon.tamanoMuestra,
          niveles: renglon.niveles.map((n) => ({
            nivelAQL: n.nivelAQL,
            aceptar: n.aceptar,
            rechazar: n.rechazar,
          })),
          mensaje: null,
        };

  return {
    idOrden: orden.id,
    folioOrden: orden.folio === null ? null : Number(orden.folio),
    idModelo: orden.idModelo,
    codigoModelo: orden.modelo.codigo,
    cantidad,
    maquileros,
    muestra,
  };
}
