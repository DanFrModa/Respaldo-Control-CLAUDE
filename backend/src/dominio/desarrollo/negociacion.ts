/**
 * NEGOCIACIÓN por versiones de la lista de precios (F8-E5, D13/R20b) — la capa que remata la lista de
 * E4 trayendo al sistema lo que hoy vive en Excel: el re-costeo por RONDAS, los acuerdos por renglón,
 * los estados de la lista y el archivo por Cliente+Departamento.
 *
 * Cómo funciona una RONDA (propuesta §4 — "la clave"): se ajusta el desarrollo (BOM/conceptos, con E1/
 * E3) y se CONGELA una nueva versión del precosto (E3, inmutable). Aquí el renglón se RE-APUNTA a esa
 * versión: recalcula `costoUnit`/`precioCalculado` con los factores de la lista y RESETEA el
 * `precioAprobado` (el costo cambió → el precio se re-aprueba después con `listas.aprobar`; separa
 * negociador de aprobador). La versión y el precio ANTERIORES quedan en un `NegociacionEvento`
 * INMUTABLE (nunca se pierden). Un ACUERDO sin re-costeo sólo registra el evento (precio + nota), sin
 * tocar el renglón. El precio ACORDADO va SIEMPRE al evento, no al `precioAprobado`.
 *
 * Innegociables aplicados:
 *  • A1 — toda la lógica vive aquí; las rutas sólo validan permiso + Zod y delegan. La aritmética del
 *    precio NO se duplica: se reutiliza `calcularPrecioLista` (`../costos/precio-lista.ts`).
 *  • A2 — cada operación multi-tabla (renglón + evento + bitácora) va en UNA transacción.
 *  • A7 — auditoría uniforme + `Bitacora` sobre `ListaPrecios` en la misma tx.
 *  • A9 — scope por empresa activa en TODA lectura/mutación (el renglón/lista es por empresa).
 *  • D3 — el `NegociacionEvento` y las versiones congeladas son INMUTABLES: se AGREGAN, jamás se
 *    editan/borran. Una lista en estado de CIERRE no admite rondas/acuerdos (reabrir = cambiar estado,
 *    auditado). Todo bajo el advisory lock POR LISTA (`NAMESPACE_LOCK_LISTA`, compartido con E4) →
 *    el guard de `esCierre` es race-free (cierra el TOCTOU con `cambiarEstadoLista`).
 *  • Importes ocultos (null) sin `consultas.ver-importes` — lo aplica la proyección server-side.
 */
import type { Prisma } from '../../datos/index.js';

import {
  esquemaAcuerdoRegistrar,
  esquemaCambiarEstadoLista,
  esquemaRondaRegistrar,
  esquemaSimularNegociacionQuery,
  type DatosAcuerdoRegistrar,
  type DatosCambiarEstadoLista,
  type DatosRondaRegistrar,
  type DatosSimularNegociacion,
  type ListaPreciosDetalle,
  type NegociacionEventoSalida,
  type SimulacionNegociacion,
} from '../../contrato/index.js';
import { datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { num, numOrNull } from '../costos/decimales.js';
import {
  calcularPrecioLista,
  simularMargenNegociacion,
  type FactoresLista,
} from '../costos/precio-lista.js';
import { factoresANumeros } from './cliente-factores.js';
import {
  exigirLineaBloqueandoLista,
  exigirListaNoCerrada,
  obtenerLista,
  NAMESPACE_LOCK_LISTA,
} from './listas-precios.js';

// ── Include + proyección de eventos ───────────────────────────────────────────────────

/**
 * `include` para leer un evento con la versión resuelta del precosto anterior/nuevo. Se exporta para
 * que la vista 360 del enganche (F8-E6) reutilice el MISMO proyector sin acoplarse al permiso
 * `listas.ver` que exige `listarEventosDeLinea`.
 */
export const incluirEvento = {
  precostoAnterior: { select: { version: true } },
  precostoNuevo: { select: { version: true } },
} satisfies Prisma.NegociacionEventoInclude;

type EventoConVersiones = Prisma.NegociacionEventoGetPayload<{ include: typeof incluirEvento }>;

/** Proyecta un evento a la salida del contrato (importes en null sin `consultas.ver-importes`). */
export function aEventoSalida(
  evento: EventoConVersiones,
  verImportes: boolean,
): NegociacionEventoSalida {
  return {
    id: evento.id,
    idListaLinea: evento.idListaLinea,
    idPrecostoAnterior: evento.idPrecostoAnterior,
    idPrecostoNuevo: evento.idPrecostoNuevo,
    versionAnterior: evento.precostoAnterior?.version ?? null,
    versionNueva: evento.precostoNuevo?.version ?? null,
    precioAnterior: verImportes ? numOrNull(evento.precioAnterior) : null,
    precioNuevo: verImportes ? numOrNull(evento.precioNuevo) : null,
    acuerdo: evento.acuerdo,
    registradoPorId: evento.registradoPorId,
    registradoEn: evento.registradoEn.toISOString(),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────────

/** Factores snapshot de la lista (bajo el lock ya tomado por el llamador). */
async function factoresDeLista(tx: Tx, idLista: number): Promise<FactoresLista> {
  const lista = await tx.listaPrecios.findUniqueOrThrow({
    where: { id: idLista },
    select: { margenPct: true, descuentosPct: true, regaliasPct: true, costoVentasPct: true },
  });
  return factoresANumeros(lista);
}

// ── Ronda (re-costeo) ─────────────────────────────────────────────────────────────────

/**
 * REGISTRA una RONDA sobre un renglón (A2): re-apunta a un precosto CONGELADO NUEVO del MISMO
 * desarrollo, recalcula `costoUnit`/`precioCalculado` con los factores de la lista, RESETEA el
 * `precioAprobado` (+ quién/cuándo), e inserta un `NegociacionEvento` INMUTABLE con las versiones y
 * precios anterior/nuevo. Todo bajo el advisory lock por lista (guard `esCierre` race-free). El precio
 * ACORDADO (opcional) va SÓLO al evento. Requiere `listas.negociar`.
 */
export async function registrarRonda(
  sesion: SesionUsuario,
  idLinea: number,
  entrada: DatosRondaRegistrar,
  bd?: ContextoBd,
): Promise<ListaPreciosDetalle> {
  verificarPermiso(sesion, 'listas.negociar');
  const datos = validarEntrada(esquemaRondaRegistrar, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  const idLista = await enTransaccion(async (tx) => {
    const linea = await exigirLineaBloqueandoLista(tx, idLinea, idEmpresa);
    exigirListaNoCerrada(linea.esCierre);

    // El precosto NUEVO debe existir (A9), ser CONGELADO, del MISMO desarrollo y DISTINTO del actual.
    const nuevo = await tx.precosto.findFirst({
      where: { id: datos.idPrecostoNuevo, desarrollo: { proyecto: { idEmpresa } } },
      select: { id: true, idDesarrollo: true, estado: true, version: true, costoTotal: true },
    });
    if (nuevo === null) {
      throw new ErrorNoEncontrado('Precosto', datos.idPrecostoNuevo);
    }
    if (nuevo.idDesarrollo !== linea.idDesarrollo) {
      throw new ErrorValidacion(
        'El precosto elegido no es del mismo desarrollo del renglón; elige una versión de ESTE modelo.',
      );
    }
    if (nuevo.estado !== 'congelado') {
      throw new ErrorConflicto(
        `El precosto v${nuevo.version} no está congelado; congélalo antes de cerrar la ronda.`,
      );
    }
    if (nuevo.id === linea.idPrecosto) {
      throw new ErrorConflicto(
        'El renglón ya usa esa versión; genera y congela una versión distinta para la ronda.',
      );
    }

    const factores = await factoresDeLista(tx, linea.idLista);
    const costoUnit = num(nuevo.costoTotal); // costoTotal se persiste al congelar (no-null en congelado)
    const precioCalculadoNuevo = calcularPrecioLista(costoUnit, factores);

    // Anterior recuperable (nunca se pierde): la versión y el precio vigentes ANTES de la ronda.
    const idPrecostoAnterior = linea.idPrecosto;
    const precioAnterior = numOrNull(linea.precioAprobado) ?? num(linea.precioCalculado);

    // Re-apunta el renglón. RESETEA el aprobado: el costo cambió, el precio nuevo se re-aprueba luego.
    await tx.listaPreciosLinea.update({
      where: { id: idLinea },
      data: {
        idPrecosto: nuevo.id,
        costoUnit,
        precioCalculado: precioCalculadoNuevo,
        precioAprobado: null,
        aprobadoPorId: null,
        aprobadoEn: null,
        ...datosModificacion(sesion),
      },
    });

    // Evento INMUTABLE (D3): el precio nuevo del evento es el ACORDADO si vino, si no el calculado.
    await tx.negociacionEvento.create({
      data: {
        idListaLinea: idLinea,
        idPrecostoAnterior,
        idPrecostoNuevo: nuevo.id,
        precioAnterior,
        precioNuevo: datos.precioAcordado ?? precioCalculadoNuevo,
        acuerdo: datos.acuerdo,
        registradoPorId: sesion.id,
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'ListaPrecios',
      idEntidad: linea.idLista,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'ronda',
        idLinea,
        idPrecostoAnterior,
        idPrecostoNuevo: nuevo.id,
        versionNueva: nuevo.version,
      },
    });

    return linea.idLista;
  }, bd);

  return obtenerLista(sesion, idLista, bd);
}

// ── Acuerdo (sin re-costeo) ────────────────────────────────────────────────────────────

/**
 * REGISTRA un ACUERDO sin re-costeo (A2): NO cambia el precosto ni el `precioAprobado` del renglón;
 * sólo inserta un `NegociacionEvento` (sin precostos, con el precio acordado opcional + la nota). Bajo
 * el lock por lista + guard `esCierre`. Requiere `listas.negociar`.
 */
export async function registrarAcuerdo(
  sesion: SesionUsuario,
  idLinea: number,
  entrada: DatosAcuerdoRegistrar,
  bd?: ContextoBd,
): Promise<ListaPreciosDetalle> {
  verificarPermiso(sesion, 'listas.negociar');
  const datos = validarEntrada(esquemaAcuerdoRegistrar, entrada);

  const idLista = await enTransaccion(async (tx) => {
    const linea = await exigirLineaBloqueandoLista(tx, idLinea, sesion.idEmpresaActiva);
    exigirListaNoCerrada(linea.esCierre);

    const precioAnterior = numOrNull(linea.precioAprobado) ?? num(linea.precioCalculado);

    await tx.negociacionEvento.create({
      data: {
        idListaLinea: idLinea,
        idPrecostoAnterior: null,
        idPrecostoNuevo: null,
        precioAnterior,
        precioNuevo: datos.precioAcordado ?? null,
        acuerdo: datos.acuerdo,
        registradoPorId: sesion.id,
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'ListaPrecios',
      idEntidad: linea.idLista,
      accion: 'MODIFICAR',
      datos: { operacion: 'acuerdo', idLinea },
    });

    return linea.idLista;
  }, bd);

  return obtenerLista(sesion, idLista, bd);
}

// ── Cambio de estado de la lista ───────────────────────────────────────────────────────

/**
 * CAMBIA el estado de una lista (A2) a cualquier `EstadoLista` ACTIVO — incluida la REAPERTURA de una
 * lista cerrada (por eso NO lleva guard `esCierre`; la reapertura queda auditada por la bitácora, que
 * registra `de`→`a`). Bajo el advisory lock por lista (serializa contra rondas/acuerdos/ediciones).
 * Requiere `listas.negociar`.
 */
export async function cambiarEstadoLista(
  sesion: SesionUsuario,
  idLista: number,
  entrada: DatosCambiarEstadoLista,
  bd?: ContextoBd,
): Promise<ListaPreciosDetalle> {
  verificarPermiso(sesion, 'listas.negociar');
  const datos = validarEntrada(esquemaCambiarEstadoLista, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_LISTA}::int, ${idLista}::int)`;

    // Lista de la empresa activa (A9), con su estado ACTUAL (para la bitácora `de`→`a`).
    const lista = await tx.listaPrecios.findFirst({
      where: { id: idLista, idEmpresa },
      select: { id: true, idEstadoLista: true, estadoLista: { select: { codigo: true } } },
    });
    if (lista === null) {
      throw new ErrorNoEncontrado('Lista de precios', idLista);
    }

    const destino = await tx.estadoLista.findUnique({
      where: { id: datos.idEstadoLista },
      select: { id: true, codigo: true, activo: true },
    });
    if (destino === null) {
      throw new ErrorNoEncontrado('Estado de lista', datos.idEstadoLista);
    }
    if (!destino.activo) {
      throw new ErrorConflicto(`El estado "${destino.codigo}" está desactivado; elige uno activo.`);
    }

    await tx.listaPrecios.update({
      where: { id: idLista },
      data: { idEstadoLista: destino.id, ...datosModificacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'ListaPrecios',
      idEntidad: idLista,
      accion: 'MODIFICAR',
      datos: { operacion: 'cambiar-estado', de: lista.estadoLista.codigo, a: destino.codigo },
    });
  }, bd);

  return obtenerLista(sesion, idLista, bd);
}

// ── Calculadora de negociación (preview en vivo, §4.8) ──────────────────────────────────

/**
 * SIMULA el margen de un precio OBJETIVO sobre un renglón (rediseño R5, §4.8) — el motor de la
 * calculadora "en vivo" de la mesa de negociación. Es una LECTURA pura (no muta nada): toma el costo
 * (el vigente del renglón, o el de una versión congelada indicada para previsualizar una ronda) y los
 * FACTORES snapshot de la lista, y delega la aritmética a `simularMargenNegociacion` (A1: la fórmula
 * vive en el dominio, NO se duplica en el front; misma cascada que `calcularPrecioLista`). Scope por
 * empresa (A9). Requiere `listas.negociar`; los números son importes puros → la ruta añade además
 * `consultas.ver-importes` (como el PDF/Excel).
 */
export async function simularNegociacion(
  sesion: SesionUsuario,
  idLinea: number,
  entrada: DatosSimularNegociacion,
  bd?: ContextoBd,
): Promise<SimulacionNegociacion> {
  verificarPermiso(sesion, 'listas.negociar');
  const datos = validarEntrada(esquemaSimularNegociacionQuery, entrada);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  // El renglón debe ser de la empresa activa (A9); trae su costo vigente + el snapshot de factores.
  const linea = await cliente.listaPreciosLinea.findFirst({
    where: { id: idLinea, lista: { idEmpresa } },
    select: {
      idDesarrollo: true,
      costoUnit: true,
      lista: {
        select: { margenPct: true, descuentosPct: true, regaliasPct: true, costoVentasPct: true },
      },
    },
  });
  if (linea === null) {
    throw new ErrorNoEncontrado('Renglón de lista de precios', idLinea);
  }

  // Costo a simular: por defecto el VIGENTE del renglón; si se indica una versión, la de ESE precosto
  // congelado del MISMO desarrollo (para previsualizar el margen de una ronda antes de guardarla).
  let costo = num(linea.costoUnit);
  if (datos.idPrecosto !== undefined) {
    const precosto = await cliente.precosto.findFirst({
      where: { id: datos.idPrecosto, desarrollo: { proyecto: { idEmpresa } } },
      select: { idDesarrollo: true, estado: true, costoTotal: true },
    });
    if (precosto === null) {
      throw new ErrorNoEncontrado('Precosto', datos.idPrecosto);
    }
    if (precosto.idDesarrollo !== linea.idDesarrollo) {
      throw new ErrorValidacion(
        'El precosto elegido no es del mismo desarrollo del renglón; elige una versión de ESTE modelo.',
      );
    }
    if (precosto.estado !== 'congelado') {
      throw new ErrorConflicto('Sólo se puede simular sobre una versión CONGELADA del precosto.');
    }
    costo = num(precosto.costoTotal);
  }

  const factores: FactoresLista = factoresANumeros(linea.lista);
  const sim = simularMargenNegociacion(costo, datos.precioObjetivo, factores);
  return {
    costo,
    precioObjetivo: datos.precioObjetivo,
    precioNeto: sim.precioNeto,
    margenBrutoPct: sim.margenBrutoPct,
    margenObjetivoPct: sim.margenObjetivoPct,
    cumpleObjetivo: sim.cumpleObjetivo,
  };
}

// ── Historial de eventos de un renglón ─────────────────────────────────────────────────

/**
 * HISTORIAL de negociación de un renglón (orden CRONOLÓGICO: por id, que es el orden de inserción),
 * con la versión del precosto anterior/nuevo resuelta. Los precios salen null sin
 * `consultas.ver-importes` (ocultación server-side, como E4). Scope por empresa (A9). Requiere
 * `listas.ver`.
 */
export async function listarEventosDeLinea(
  sesion: SesionUsuario,
  idLinea: number,
  bd?: ContextoBd,
): Promise<NegociacionEventoSalida[]> {
  verificarPermiso(sesion, 'listas.ver');
  const cliente = clienteLectura(bd);

  // El renglón debe ser de la empresa activa (A9): uno de otra empresa, para esta sesión, no existe.
  const linea = await cliente.listaPreciosLinea.findFirst({
    where: { id: idLinea, lista: { idEmpresa: sesion.idEmpresaActiva } },
    select: { id: true },
  });
  if (linea === null) {
    throw new ErrorNoEncontrado('Renglón de lista de precios', idLinea);
  }

  const eventos = await cliente.negociacionEvento.findMany({
    where: { idListaLinea: idLinea },
    orderBy: { id: 'asc' },
    include: incluirEvento,
  });
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');
  return eventos.map((e) => aEventoSalida(e, verImportes));
}
