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
 *  • ⭐ V1-E8b (§Post-F9.125) — los FACTORES (y todo lo que los delate: la simulación entera) salen en
 *    `null` sin `listas.aprobar`. Y el reseteo de `precioAprobado` que la RONDA hacía desde F8-E5 ya
 *    no es sólo suyo: `editarFactoresLista` hace lo mismo cuando se mueven los porcentajes, con el
 *    mismo `NegociacionEvento` inmutable. **Un solo criterio para el mismo hecho** — cambiar aquello
 *    sobre lo que se firmó tumba la firma, venga del costo o del margen.
 */
import type { Prisma } from '../../datos/index.js';

import {
  esquemaAcuerdoRegistrar,
  esquemaCambiarEstadoLista,
  esquemaRondaRegistrar,
  esquemaSimularMesaCuerpo,
  esquemaSimularNegociacionQuery,
  type DatosAcuerdoRegistrar,
  type DatosCambiarEstadoLista,
  type DatosRondaRegistrar,
  type DatosSimularMesa,
  type DatosSimularNegociacion,
  type ListaPreciosDetalle,
  type NegociacionEventoSalida,
  type SimulacionMesa,
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
import { num, numOrNull, redondear2 } from '../costos/decimales.js';
import {
  calcularPrecioLista,
  simularMargenNegociacion,
  type FactoresLista,
} from '../costos/precio-lista.js';
import { factoresANumeros, puedeVerFactoresDePrecio } from './cliente-factores.js';
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

/**
 * Resuelve, de UNA consulta, el nombre de los autores de un lote de eventos (V1-E8q, §Post-F9.141).
 *
 * `NegociacionEvento.registradoPorId` NO tiene FK física al usuario —es un log INMUTABLE, igual que
 * `OrdenComentario`—, así que el nombre no viaja por `include`: hay que ir por él. Se hace en el
 * servidor y en bloque (nunca N+1, nunca desde el cliente, que no tiene de dónde sacarlo). Es el
 * mismo patrón que ya usa la bitácora (`admin/bitacora.ts`).
 *
 * Un autor que ya no existe devuelve `undefined` → el evento sale con `nombreRegistradoPor: null` y
 * el hilo se sigue leyendo completo: dar de baja a un usuario NO puede borrar la historia (D3).
 */
export async function nombresDeAutores(
  cliente: Pick<Tx, 'usuario'>,
  eventos: readonly { registradoPorId: string | null }[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(eventos.map((e) => e.registradoPorId).filter((id): id is string => id !== null)),
  ];
  if (ids.length === 0) return new Map();
  const usuarios = await cliente.usuario.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombre: true },
  });
  return new Map(usuarios.map((u) => [u.id, u.nombre]));
}

/** Proyecta un evento a la salida del contrato (importes en null sin `consultas.ver-importes`). */
export function aEventoSalida(
  evento: EventoConVersiones,
  verImportes: boolean,
  nombrePorId: ReadonlyMap<string, string>,
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
    nombreRegistradoPor:
      evento.registradoPorId === null ? null : (nombrePorId.get(evento.registradoPorId) ?? null),
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

/** Los cinco campos que TODA simulación de margen devuelve (con el candado de factores aplicado). */
interface ProyeccionMargen {
  precioObjetivo: number;
  precioNeto: number | null;
  margenBrutoPct: number | null;
  margenObjetivoPct: number | null;
  cumpleObjetivo: boolean | null;
}

/**
 * ⭐ **GUARDA GEMELA del margen: el ÚNICO sitio donde un margen se calcula y se proyecta.**
 *
 * La calculadora de §4.8 (`simularNegociacion`, un precio contra el costo guardado) y el negociador
 * en vivo de la mesa (`simularMesa`, un precio contra costos movidos a mano — §Post-F9.138) enseñan
 * **el mismo número al mismo dueño en la misma pantalla**. Si cada una hiciera su propia cuenta —o
 * aplicara el candado de factores por su lado— divergirían en la primera corrección, y la mesa
 * enseñaría un margen que la lista desmiente. Aquí no pueden: las dos entran por esta función, que
 * hace UNA sola cosa —llamar a `simularMargenNegociacion` (`../costos/precio-lista.ts`, la aritmética
 * pura y aislada de D2) y taparlo con `puedeVerFactoresDePrecio`— y ninguna de las dos ve los
 * porcentajes por su cuenta.
 *
 * 🔴 El candado NO es opcional ni se decide aquí: `puedeVerFactoresDePrecio` (`cliente-factores.ts`)
 * es el criterio ÚNICO de §Post-F9.125(b), el mismo que usan el snapshot de la lista y la ficha del
 * cliente. *«Nadie mas que yo ve los factores por favor….»* (Daniel, 29-ago-2026).
 */
function proyectarMargen(
  sesion: SesionUsuario,
  costo: number,
  precioObjetivo: number,
  factores: FactoresLista,
): ProyeccionMargen {
  const sim = simularMargenNegociacion(costo, precioObjetivo, factores);
  // Mismo criterio ÚNICO que el snapshot de la lista y el catálogo del cliente (§Post-F9.125(b)).
  const verFactores = puedeVerFactoresDePrecio(sesion);
  return {
    precioObjetivo,
    precioNeto: verFactores ? sim.precioNeto : null,
    margenBrutoPct: verFactores ? sim.margenBrutoPct : null,
    margenObjetivoPct: verFactores ? sim.margenObjetivoPct : null,
    cumpleObjetivo: verFactores ? sim.cumpleObjetivo : null,
  };
}

/**
 * SIMULA el margen de un precio OBJETIVO sobre un renglón (rediseño R5, §4.8) — el motor de la
 * calculadora "en vivo" de la mesa de negociación. Es una LECTURA pura (no muta nada): toma el costo
 * (el vigente del renglón, o el de una versión congelada indicada para previsualizar una ronda) y los
 * FACTORES snapshot de la lista, y delega la aritmética a `simularMargenNegociacion` (A1: la fórmula
 * vive en el dominio, NO se duplica en el front; misma cascada que `calcularPrecioLista`). Scope por
 * empresa (A9). Requiere `listas.negociar`; los números son importes puros → la ruta añade además
 * `consultas.ver-importes` (como el PDF/Excel).
 *
 * 🔴 **V1-E8b (§Post-F9.125(b)) — ESTA ERA LA TERCERA PUERTA A LOS FACTORES, y era la más ancha.**
 * Ocultar los cuatro porcentajes en la lista no servía de nada mientras este endpoint los sirviera
 * desde otro lado, y los servía **todos**:
 *  • `margenObjetivoPct` **ES** el `margenPct` del snapshot, devuelto tal cual. No es derivable de
 *    nada: es el factor.
 *  • `precioNeto` = objetivo × (1 − suma/100) ⇒ dividido entre el objetivo (que lo pone quien
 *    pregunta) entrega la **suma de los otros tres**, que ni el costo ni el precio revelan.
 *  • `margenBrutoPct` sale del neto, así que arrastra la misma fuga.
 *  • `cumpleObjetivo` es un ORÁCULO: bastan unas cuantas consultas moviendo el objetivo hasta que la
 *    respuesta cambia para reconstruir el margen con la precisión que se quiera.
 * Por eso los CUATRO salen en `null` sin `listas.aprobar`. Esto **no** es el límite que Daniel aceptó
 * a sabiendas —"el margen se saca con una división" sobre datos que Desarrollo ya tiene—: aquí era el
 * sistema entregando el número digerido, que es justo lo que dijo que no debía pasar.
 *
 * ⚠️ **`costo` NO se oculta**: quien llega aquí ya lo ve en el desglose del renglón y en el precosto.
 * Taparlo en un solo endpoint no escondería nada y sí rompería la pantalla.
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
  return { costo, ...proyectarMargen(sesion, costo, datos.precioObjetivo, factores) };
}

// ── ⭐⭐ LA MESA: el negociador EN VIVO (§Post-F9.138 / .139 / .144) ─────────────────────

/**
 * ⭐⭐ **EL NEGOCIADOR EN VIVO — el renglón "casi como si fuera un excel" que se persigue en las DOS
 * direcciones** (§Post-F9.138). Palabras de Daniel, con el cliente enfrente:
 *
 * > *"estoy a media negociacion y el cliente me dice: ponle una jareta mas barata y bajame 3 pesos…
 * > entonces yo voy jugando en tiempo real con la receta para llegar al costo que me pide. Por eso
 * > siempre tengo que saber el margen que tengo"*
 *
 * Esa frase del cliente son **las dos direcciones en una sola oración**, y por eso esta función
 * contesta las dos de un tiro sobre el MISMO renglón:
 *
 *  1. **escribo PRECIO → sale MARGEN** — `margenBrutoPct` / `cumpleObjetivo`, ya con *"todas las
 *     condiciones"* (los cuatro factores del cliente, cascada D2).
 *  2. **muevo un COSTO → se mueve el margen y el PRECIO** — `costoSimulado` / `deltaCosto` /
 *     `precioSugerido`. Ésta era **la mitad que NO existía**: `simularNegociacion` sólo admite el
 *     costo VIGENTE del renglón o el de un precosto **congelado** (*"Sólo se puede simular sobre una
 *     versión CONGELADA del precosto."*), y en la mesa no hay ninguna versión congelada que tenga la
 *     jareta más barata — porque esa jareta **no existe todavía**.
 *
 * 🔴🔴 **LO QUE ESTA FUNCIÓN NO HACE, Y ES SU PROPIEDAD MÁS IMPORTANTE: NO ESCRIBE NADA**
 * (§Post-F9.139 punto 2, *"el simulador NO CREA NADA"*). No hay `create`, `update`, `upsert`,
 * `delete`, `$executeRaw` ni `registrarBitacora` en su cuerpo; no abre `enTransaccion`; su único
 * acceso a la base es **un `findFirst` de lectura**. No toca el catálogo (ni avío, ni proveedor, ni
 * medida, ni color), no toca la receta del modelo, no toca el precosto y no toca el renglón de la
 * lista. La razón, con nombre propio: el catálogo de medidas de avío **ya se fragmentó una vez** por
 * dejar que se creara a media prisa (§Post-F9.106: `"53 cm"` / `"53cm"` / `"53"` → la orden de compra
 * partida en tres), y la mesa es **el lugar de más prisa que hay en todo el sistema**.
 *
 * ⭐ **Y por eso los importes que entran son LIBRES** (`RenglonMesa` = etiqueta + importe, sin id de
 * catálogo): §Post-F9.144(b) —*"me quitan un cierre y yo le pongo que estimos que la maquila costara
 * 5 pesos menos"*— **no es un dato, es una META**, y Daniel mismo advierte que *"no es seguro que se
 * consiga"*. Un número que puede fallar no tiene por qué existir en ningún catálogo para poder
 * usarse en la mesa; lo que hace con él la oficina después es §Post-F9.140/.144(a), otro momento y
 * otra persona.
 *
 * ⚠️ **El costo VIGENTE se lee del renglón, no se recibe**, y se devuelve como `costoVigente`: es la
 * línea base contra la que se mide el `deltaCosto` (*"la maquila baja 5 pesos"*). Si el cliente
 * mandara también la base, la pantalla podría mentirle al dueño sobre de dónde partió.
 *
 * 🔴 **El candado de los factores es el mismo de siempre y ahora cubre también `precioSugerido`** —
 * ver `esquemaSimulacionMesa` y `proyectarMargen`: sin `listas.aprobar` los CINCO campos derivados
 * salen `null`, porque el sugerido dividido entre el costo (que lo teclea quien pregunta) delata el
 * multiplicador de los cuatro factores. §Post-F9.125(b) cerró tres puertas; ésta habría sido la
 * cuarta.
 *
 * Scope por empresa (A9); requiere `listas.negociar` (la ruta añade `listas.ver` y
 * `consultas.ver-importes`, como la calculadora hermana).
 */
export async function simularMesa(
  sesion: SesionUsuario,
  idLinea: number,
  entrada: DatosSimularMesa,
  bd?: ContextoBd,
): Promise<SimulacionMesa> {
  verificarPermiso(sesion, 'listas.negociar');
  const datos = validarEntrada(esquemaSimularMesaCuerpo, entrada);
  const cliente = clienteLectura(bd);

  // El renglón debe ser de la empresa activa (A9); trae su costo VIGENTE + el snapshot de factores.
  const linea = await cliente.listaPreciosLinea.findFirst({
    where: { id: idLinea, lista: { idEmpresa: sesion.idEmpresaActiva } },
    select: {
      costoUnit: true,
      lista: {
        select: { margenPct: true, descuentosPct: true, regaliasPct: true, costoVentasPct: true },
      },
    },
  });
  if (linea === null) {
    throw new ErrorNoEncontrado('Renglón de lista de precios', idLinea);
  }

  // La suma se hace EN EL SERVIDOR (A1 / lección F5-E7: la agregación nunca se pivotea en el
  // cliente). Se redondea a 2 con el MISMO helper con el que `congelarVersion` calcula el
  // `costoTotal` de un precosto: si la mesa sumara distinto, su línea base no cuadraría con la real.
  const costoVigente = num(linea.costoUnit);
  const costoSimulado = redondear2(datos.renglones.reduce((suma, r) => suma + r.importe, 0));
  const factores: FactoresLista = factoresANumeros(linea.lista);
  const verFactores = puedeVerFactoresDePrecio(sesion);

  return {
    costoVigente,
    costoSimulado,
    deltaCosto: redondear2(costoSimulado - costoVigente),
    // Dirección 2: el precio que ese costo pediría con las condiciones de ESTE cliente. Misma
    // aritmética que la lista de precios (A1: `calcularPrecioLista`, jamás una copia).
    precioSugerido: verFactores ? calcularPrecioLista(costoSimulado, factores) : null,
    // Dirección 1: el margen del precio capturado, por la MISMA guarda que la calculadora de §4.8.
    ...proyectarMargen(sesion, costoSimulado, datos.precioObjetivo, factores),
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
  const nombrePorId = await nombresDeAutores(cliente, eventos);
  return eventos.map((e) => aEventoSalida(e, verImportes, nombrePorId));
}
