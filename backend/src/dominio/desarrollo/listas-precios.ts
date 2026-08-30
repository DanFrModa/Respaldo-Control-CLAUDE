/**
 * LISTA DE PRECIOS por Cliente+Departamento (F8-E4, D13/R20a) — genera el precio de venta desde los
 * PRECOSTOS CONGELADOS (E3) aplicando los FACTORES del cliente, y da al dueño el flujo de aprobación.
 *
 * El sistema PROPONE `precioCalculado` (fórmula de cascada, `../costos/precio-lista.ts`) y el dueño,
 * renglón por renglón, APRUEBA ese o TECLEA otro (`precioAprobado`). Los factores se copian como
 * SNAPSHOT editable al crear la lista; editarlos recalcula TODOS los `precioCalculado`. En E4 la lista
 * NACE `abierta` y ahí se queda (los cambios de estado + la negociación por versiones son E5).
 *
 * ⭐ **V1-E8b (§Post-F9.125) — EL PRECIO DE VENTA ES SÓLO DEL DUEÑO.** Tres cosas cambiaron aquí:
 *  • **(a)** editar los factores del snapshot pide **`listas.aprobar`**, no `listas.administrar`
 *    (Daniel: *"los factores sólo yo los puedo mover"*).
 *  • **(b)** los cuatro factores salen en `null` para quien no los pueda mover — el criterio ÚNICO es
 *    `puedeVerFactoresDePrecio` (`./cliente-factores.ts`), el mismo que usan el catálogo del cliente y
 *    la calculadora de la mesa.
 *  • **(d)** mover los factores **TUMBA las aprobaciones** de la lista, con nota de qué las invalidó y
 *    cuándo. Antes se recalculaba el precio *"sin tocar los aprobados"* para no pisarle la firma al
 *    dueño, **y el efecto era el contrario**: quedaba un precio aprobado que ya no correspondía a los
 *    factores con que se calculó. La ronda de negociación (`negociacion.ts`) SÍ reseteaba: eran DOS
 *    criterios para el mismo hecho, y hoy son uno solo.
 *
 * Innegociables aplicados:
 *  • A1 — toda la lógica vive aquí; las rutas sólo validan permiso + Zod y delegan. La aritmética del
 *    precio NO se duplica: se reutiliza `calcularPrecioLista` (`../costos/precio-lista.ts`).
 *  • A2 — cada operación multi-tabla (lista + renglones + bitácora) va en UNA transacción.
 *  • A3 — el FOLIO sale de `siguienteFolio(...,'lista-precios')` (secuencia atómica, NUNCA Max()+1).
 *  • A7 — auditoría uniforme + `Bitacora` en la misma tx.
 *  • A9 — scope por empresa activa en TODA lectura/mutación (la lista es por empresa; sus renglones
 *    cuelgan de la lista). Una lista de otra empresa, para esta sesión, no existe.
 *  • Importes ocultos (null) sin `consultas.ver-importes`, y FACTORES ocultos sin `listas.aprobar` —
 *    los dos los aplica la proyección server-side.
 */
import type { EstadoRenglonLista, Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import {
  esquemaAjustarPrecioLinea,
  esquemaListaFactoresEditar,
  esquemaListaPreciosCrear,
  esquemaPrecioTargetLinea,
  type CandidatoLista,
  type DatosAjustarPrecioLinea,
  type DatosListaFactoresEditar,
  type DatosListaPreciosCrear,
  type DatosPrecioTargetLinea,
  type DescartadoLista,
  type DesgloseCostoLinea,
  type ListaPreciosLineaSalida,
  type ListaPreciosResumen,
  type ListaPreciosDetalle,
  type ListasPreciosQuery,
  type MotivoNoCandidato,
} from '../../contrato/esquemas/lista-precios.js';
import { servicioArchivos, type ServicioArchivos } from '../../comun/archivos.js';
import {
  aJsonBitacora,
  datosCreacion,
  datosModificacion,
  registrarBitacora,
} from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { fechaDelActo } from '../../comun/fecha-negocio.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { num, numOrNull, redondear2 } from '../costos/decimales.js';
import { calcularPrecioLista, type FactoresLista } from '../costos/precio-lista.js';
import {
  factoresANumeros,
  puedeVerFactoresDePrecio,
  buscarFactoresResueltos,
  resolverFactores,
  validarFactores,
} from './cliente-factores.js';
import { avisoDeCostoViejo } from './costo-viejo.js';

/** Entradas tipadas de las mutaciones (forma del esquema compartido). */
export type EntradaCrearLista = z.input<typeof esquemaListaPreciosCrear>;
export type EntradaEditarFactoresLista = z.input<typeof esquemaListaFactoresEditar>;
export type EntradaAjustarPrecio = z.input<typeof esquemaAjustarPrecioLinea>;

/** Parámetros del listado = el querystring del contrato (reutilizado por la ruta REST). */
export type FiltrosListas = ListasPreciosQuery;

/**
 * Namespace del `pg_advisory_xact_lock` que serializa TODA mutación de UNA lista: recálculo de
 * factores (E4), aprobación/tecleo de un renglón (E4), rondas/acuerdos y cambio de estado (E5). Al
 * ser el MISMO namespace por `idLista`, `cambiarEstadoLista` (E5) se serializa contra las demás →
 * el guard de `esCierre` es race-free (cierra el TOCTOU: nadie cierra la lista entre que se lee el
 * estado y se muta). Se exporta para que `negociacion.ts` tome el MISMO lock.
 */
export const NAMESPACE_LOCK_LISTA = 20_542;

/**
 * Namespace del `pg_advisory_xact_lock` que serializa la CREACIÓN de listas por EMPRESA. Sin él, dos
 * `crearLista` concurrentes con el mismo desarrollo (READ COMMITTED) leerían ambos `listaLineas = 0` y
 * ambos intentarían insertar el renglón.
 *
 * La invariante "un desarrollo vive en A LO MÁS UNA lista" YA está blindada a nivel BD: E5 agregó
 * `@@unique([idDesarrollo])` en `lista_precios_linea` (migración `20260706120000_f8_e5_negociacion`),
 * que la garantiza incluso ENTRE listas (el `@@unique([idLista, idDesarrollo])` heredado solo cubría el
 * duplicado DENTRO de una misma lista). Con ese candado a nivel BD, este lock es una OPTIMIZACIÓN de UX
 * —serializa la creación para devolver un `ErrorConflicto` claro con TODOS los desarrollos en conflicto,
 * en vez de un 500 opaco por la violación del unique—, no la única barrera. Crear listas es infrecuente,
 * así que serializar por empresa es aceptable.
 */
const NAMESPACE_LOCK_CREAR_LISTA = 20_543;

// ── Include + proyección ────────────────────────────────────────────────────────────

/** `include` para leer una lista con sus renglones (desarrollo/modelo/número cliente + versión). */
const incluirLista = {
  cliente: { select: { nombre: true } },
  clienteDepartamento: { select: { nombre: true } },
  estadoLista: { select: { codigo: true, nombre: true } },
  lineas: {
    orderBy: { id: 'asc' },
    include: {
      desarrollo: {
        select: {
          numeroCliente: true,
          // ⭐ V1-E8d: `recetaTocadaEn`/`recetaTocadaCambio` son la MARCA DE AGUA de la receta
          // (sólo las escribe el embudo `tocarModeloPorCambioDeReceta`); contra `congeladoEn` de
          // abajo dicen si el costo del renglón quedó viejo. §Post-F9.127.
          modelo: {
            select: {
              codigo: true,
              descripcion: true,
              recetaTocadaEn: true,
              recetaTocadaCambio: true,
            },
          },
        },
      },
      precosto: { select: { version: true, congeladoEn: true } },
    },
  },
} satisfies Prisma.ListaPreciosInclude;

type ListaConDetalle = Prisma.ListaPreciosGetPayload<{ include: typeof incluirLista }>;

/** Proyecta un renglón a la salida del contrato (importes en null sin `consultas.ver-importes`). */
function aLineaSalida(
  linea: ListaConDetalle['lineas'][number],
  verImportes: boolean,
): ListaPreciosLineaSalida {
  return {
    id: linea.id,
    idDesarrollo: linea.idDesarrollo,
    idPrecosto: linea.idPrecosto,
    versionPrecosto: linea.precosto.version,
    codigoModelo: linea.desarrollo.modelo.codigo,
    descripcionModelo: linea.desarrollo.modelo.descripcion,
    numeroCliente: linea.desarrollo.numeroCliente,
    costoUnit: verImportes ? linea.costoUnit.toNumber() : null,
    precioCalculado: verImportes ? linea.precioCalculado.toNumber() : null,
    precioAprobado: verImportes ? numOrNull(linea.precioAprobado) : null,
    // ⭐ V1-E8w (§Post-F9.150): el TARGET del cliente. Es un importe → tras la reja; el HECHO de que
    // exista no lo es, y va aparte para que quien no ve importes sepa que ese renglón trae target
    // (mismo criterio que `aprobado` respecto de `precioAprobado`).
    precioTarget: verImportes ? numOrNull(linea.precioTarget) : null,
    tieneTarget: linea.precioTarget !== null,
    aprobado: linea.precioAprobado !== null,
    aprobadoPorId: linea.aprobadoPorId,
    aprobadoEn: linea.aprobadoEn === null ? null : linea.aprobadoEn.toISOString(),
    // ⭐ V1-E8x (§Post-F9.151): el SEGUNDO eje del renglón. No es un importe (no lo tapa
    // `consultas.ver-importes`): saber que un modelo se dropeó es un hecho del negocio, y quien no
    // ve precios igual necesita saber que ese modelo ya no va en el papel.
    estado: linea.estado,
    nombreEstado: NOMBRE_ESTADO_RENGLON[linea.estado],
    estadoPorId: linea.estadoPorId,
    estadoEn: linea.estadoEn === null ? null : linea.estadoEn.toISOString(),
    // ⭐ V1-E8d (§Post-F9.127): la FRASE del aviso la arma el servidor (criterio único en
    // `costo-viejo.ts`), no la pantalla. Null = no hay nada que avisar. NO va tras la reja de
    // importes: no lleva ni un número de dinero, y quien no ve importes también tiene que saber
    // que ese renglón está costeado con una receta vieja.
    avisoCostoViejo: avisoDeCostoViejo({
      congeladoEn: linea.precosto.congeladoEn,
      versionPrecosto: linea.precosto.version,
      recetaTocadaEn: linea.desarrollo.modelo.recetaTocadaEn,
      recetaTocadaCambio: linea.desarrollo.modelo.recetaTocadaCambio,
      aprobado: linea.precioAprobado !== null,
    }),
  };
}

/** `YYYY-MM-DD` de un `Date` (columna @db.Date). Solo el día calendario importa. */
function aFechaCorta(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Proyecta una lista COMPLETA (con renglones) a la salida del contrato.
 *
 * Dos rejas DISTINTAS, y por eso son dos parámetros: los IMPORTES (costo/precios) se ocultan sin
 * `consultas.ver-importes`, y los cuatro FACTORES sin `listas.aprobar` (§Post-F9.125(b) — quien arma
 * la lista ve los precios, pero no de qué porcentajes salieron).
 */
function aListaSalida(
  lista: ListaConDetalle,
  verImportes: boolean,
  verFactores: boolean,
): ListaPreciosDetalle {
  return {
    id: lista.id,
    folio: Number(lista.folio),
    idCliente: lista.idCliente,
    nombreCliente: lista.cliente.nombre,
    idClienteDepartamento: lista.idClienteDepartamento,
    nombreDepartamento: lista.clienteDepartamento.nombre,
    fecha: aFechaCorta(lista.fecha),
    idEstadoLista: lista.idEstadoLista,
    codigoEstado: lista.estadoLista.codigo,
    nombreEstado: lista.estadoLista.nombre,
    margenPct: verFactores ? lista.margenPct.toNumber() : null,
    descuentosPct: verFactores ? lista.descuentosPct.toNumber() : null,
    regaliasPct: verFactores ? lista.regaliasPct.toNumber() : null,
    costoVentasPct: verFactores ? lista.costoVentasPct.toNumber() : null,
    notas: lista.notas,
    lineas: lista.lineas.map((l) => aLineaSalida(l, verImportes)),
    creadoEn: lista.creadoEn.toISOString(),
    creadoPorId: lista.creadoPorId,
    modificadoEn: lista.modificadoEn.toISOString(),
    modificadoPorId: lista.modificadoPorId,
  };
}

// ── Helpers de existencia / locks ─────────────────────────────────────────────────────

/** Lista de la EMPRESA ACTIVA (A9) con su estado (código + `esCierre`), o `ErrorNoEncontrado`. */
async function exigirLista(
  tx: Tx,
  id: number,
  idEmpresa: number,
): Promise<{ id: number; idEstadoLista: number; codigoEstado: string; esCierre: boolean }> {
  const lista = await tx.listaPrecios.findFirst({
    where: { id, idEmpresa },
    select: {
      id: true,
      idEstadoLista: true,
      estadoLista: { select: { codigo: true, esCierre: true } },
    },
  });
  if (lista === null) {
    throw new ErrorNoEncontrado('Lista de precios', id);
  }
  return {
    id: lista.id,
    idEstadoLista: lista.idEstadoLista,
    codigoEstado: lista.estadoLista.codigo,
    esCierre: lista.estadoLista.esCierre,
  };
}

/**
 * Toma el advisory lock por lista (NAMESPACE_LOCK_LISTA) y devuelve el renglón (A9) CON el estado de
 * su lista (`esCierre`), leído BAJO el lock — race-free vs `cambiarEstadoLista` (cierra el TOCTOU).
 * El `idLista` de un renglón es INMUTABLE (los renglones no migran de lista), así que leerlo sin lock
 * y luego bloquear por él es seguro. Se exporta para que `negociacion.ts` reutilice el mismo patrón.
 */
export async function exigirLineaBloqueandoLista(
  tx: Tx,
  idLinea: number,
  idEmpresa: number,
): Promise<{
  id: number;
  idLista: number;
  idDesarrollo: number;
  idPrecosto: number;
  precioCalculado: Prisma.Decimal;
  precioAprobado: Prisma.Decimal | null;
  /**
   * ⭐ V1-E8x (§Post-F9.151): el estado del RENGLÓN, leído BAJO el mismo lock que el de la lista.
   * Viaja por aquí a propósito: este helper es la ÚNICA puerta de las siete mutaciones de renglón
   * (aprobar, teclear, target, quitar, ronda, acuerdo, mesa), así que devolverlo aquí le da el
   * guard a las siete de una vez y race-free — nadie cierra ni dropea el renglón entre que se lee
   * su estado y se muta.
   */
  estado: EstadoRenglonLista;
  esCierre: boolean;
}> {
  const base = await tx.listaPreciosLinea.findFirst({
    where: { id: idLinea, lista: { idEmpresa } },
    select: { idLista: true },
  });
  if (base === null) {
    throw new ErrorNoEncontrado('Renglón de lista de precios', idLinea);
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_LISTA}::int, ${base.idLista}::int)`;
  // Re-lectura BAJO el lock: el estado (esCierre) ya no puede cambiar hasta el commit.
  const linea = await tx.listaPreciosLinea.findFirst({
    where: { id: idLinea, lista: { idEmpresa } },
    select: {
      id: true,
      idLista: true,
      idDesarrollo: true,
      idPrecosto: true,
      precioCalculado: true,
      precioAprobado: true,
      estado: true,
      lista: { select: { estadoLista: { select: { esCierre: true } } } },
    },
  });
  if (linea === null) {
    throw new ErrorNoEncontrado('Renglón de lista de precios', idLinea);
  }
  return {
    id: linea.id,
    idLista: linea.idLista,
    idDesarrollo: linea.idDesarrollo,
    idPrecosto: linea.idPrecosto,
    precioCalculado: linea.precioCalculado,
    precioAprobado: linea.precioAprobado,
    estado: linea.estado,
    esCierre: linea.lista.estadoLista.esCierre,
  };
}

/**
 * Guard de negociación/edición: una lista en estado de CIERRE (cerrada/ya-pedida) no admite rondas,
 * acuerdos ni ediciones de renglón (reabrir = cambiar de estado, auditado). Se lee `esCierre` BAJO el
 * advisory lock por lista, así que es race-free (D3: la lista congelada no se toca por sorpresa).
 */
export function exigirListaNoCerrada(esCierre: boolean): void {
  if (esCierre) {
    throw new ErrorConflicto(
      'La lista está cerrada; reábrela (cambia su estado) para negociar o editar sus renglones.',
    );
  }
}

/** Nombre legible de cada estado del renglón (el que Daniel lee, en sus palabras). */
export const NOMBRE_ESTADO_RENGLON: Record<EstadoRenglonLista, string> = {
  abierto: 'Abierto',
  en_negociacion: 'En negociación',
  cerrado: 'Cerrado',
  // 🔴 «Dropeado» es la palabra de Daniel (§Post-F9.151 punto 2): NO se traduce.
  dropeado: 'Dropeado',
};

/**
 * ⭐ V1-E8x (§Post-F9.151) — GUARD del RENGLÓN: un modelo **cerrado o dropeado NO acepta más
 * movimiento** (ni rondas, ni acuerdos, ni mesa, ni target, ni re-aprobación) hasta que se REVIVA
 * con `cambiarEstadoRenglon`.
 *
 * Es el eje HERMANO de {@link exigirListaNoCerrada} y NO lo sustituye: aquél cierra el DOCUMENTO
 * entero, éste cierra UN modelo dentro de él (que es justo lo que Daniel pidió: *«de una lista de 10
 * modelos, cierro 5 y los otros ya no los vendo»*). Se evalúa con el `estado` leído BAJO el advisory
 * lock por lista (`exigirLineaBloqueandoLista`), así que es race-free.
 *
 * 🔴 **Quitar el renglón NO pasa por aquí, a propósito.** `lista_precios_linea` tiene
 * `@@unique([idDesarrollo])`: si un renglón dropeado no se pudiera quitar, su desarrollo quedaría
 * ATRAPADO para siempre y no podría entrar NUNCA a otra lista — exactamente la trampa que V1-E4
 * vino a cerrar. Dropear no puede resucitarla.
 */
export function exigirRenglonMovible(estado: EstadoRenglonLista, accion: string): void {
  if (estado === 'cerrado' || estado === 'dropeado') {
    throw new ErrorConflicto(
      `Este modelo está ${NOMBRE_ESTADO_RENGLON[estado].toLowerCase()} y ya no admite ${accion}. ` +
        'Revívelo (déjalo en Abierto o En negociación) si hay que volver a moverlo; su historial se conserva.',
    );
  }
}

// ── Crear lista ─────────────────────────────────────────────────────────────────────

/**
 * Texto del RECHAZO por cada motivo de no-candidatura (V1-E8f). Vive aquí, y no en el frontend, porque
 * es el mensaje de un ERROR del API (el diálogo, en cambio, redacta sus propios avisos a partir del
 * motivo). El de borrador NOMBRA la versión cuando se conoce: "no le sirve de nada saber que algo
 * falta si no sabe QUÉ" (§Post-F9.96).
 */
const TEXTO_MOTIVO_NO_CANDIDATO: Record<MotivoNoCandidato, (version?: number) => string> = {
  apagado: () => 'está apagado (reactívalo antes de cotizarlo)',
  'ya-en-lista': () => 'ya está en otra lista de precios',
  'precosto-borrador': (version) =>
    version === undefined
      ? 'su precosto sigue en BORRADOR: congélalo («Precosto» → «Congelar versión»)'
      : `su precosto v${version} sigue en BORRADOR: congélalo («Precosto» → «Congelar versión»)`,
  'sin-precosto': () => 'todavía no tiene precosto: genéralo y congélalo',
};

/**
 * CREA una lista de precios (A2/A3) por Cliente+Departamento con un renglón por desarrollo. Valida que
 * cada desarrollo pertenezca a un proyecto del MISMO cliente+departamento y de la empresa activa (A9),
 * que NO esté apagado, que tenga un precosto CONGELADO (usa la ÚLTIMA versión congelada) y que NO esté
 * ya en otra lista. Junta TODOS los que fallen (con su razón) y rechaza en un solo error. Copia los
 * factores del cliente como SNAPSHOT y calcula el `precioCalculado` de cada renglón. La lista nace
 * `abierta`. Requiere `listas.administrar`.
 *
 * La invariante "un desarrollo en a lo más UNA lista" se serializa con un advisory lock por empresa
 * tomado al ABRIR la transacción: la re-lectura de `listaLineas` corre bajo el lock (sin TOCTOU).
 */
export async function crearLista(
  sesion: SesionUsuario,
  entrada: EntradaCrearLista,
  bd?: ContextoBd,
): Promise<ListaPreciosDetalle> {
  verificarPermiso(sesion, 'listas.administrar');
  const datos: DatosListaPreciosCrear = validarEntrada(esquemaListaPreciosCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const ids = [...new Set(datos.idsDesarrollo)];

  const idNueva = await enTransaccion(async (tx) => {
    // Serializa la creación de listas de ESTA empresa (A3/invariante "a lo más una lista por
    // desarrollo"): la lectura de `listaLineas` de abajo re-valida bajo el lock, sin TOCTOU.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_CREAR_LISTA}::int, ${idEmpresa}::int)`;

    // El departamento debe pertenecer al cliente (si no, la resolución de factores mentiría) y estar
    // ACTIVO.
    //
    // 🔴 Lo ACTIVO se exige desde V1-E8p (§Post-F9.122a): apagar un departamento es *cómo* la fusión
    // retira un duplicado (borrado suave, D3), así que a partir de esa etapa es el flujo normal. Sin
    // esta guarda se podía —reproducido— fusionar y acto seguido armar una lista NUEVA colgada del
    // absorbido, sin error y sin aviso: el estado prohibido que la fusión acaba de barrer, de vuelta
    // en una llamada. Hasta ahora la invariante la sostenía la PANTALLA (`DialogoCrearLista.tsx`
    // filtra por `activo`) — lógica de negocio en el frontend (A1), que una pestaña vieja atraviesa.
    //
    // ⭐ Guarda GEMELA de `cliente-factores.ts` y de `proyectos.ts`: mismo `ErrorConflicto` y misma
    // forma de mensaje. Los tres escritores de este catálogo dicen lo mismo.
    const departamento = await tx.clienteDepartamento.findFirst({
      where: { id: datos.idClienteDepartamento, idCliente: datos.idCliente },
      select: { id: true, activo: true, nombre: true },
    });
    if (departamento === null) {
      throw new ErrorValidacion('El departamento no pertenece al cliente indicado.');
    }
    if (!departamento.activo) {
      throw new ErrorConflicto(
        `El departamento "${departamento.nombre}" está desactivado; reactívalo para armar su lista de precios.`,
      );
    }

    // Desarrollos que SÍ son del cliente+departamento+empresa, con su última versión congelada.
    const desarrollos = await tx.desarrollo.findMany({
      where: {
        id: { in: ids },
        proyecto: {
          idEmpresa,
          idCliente: datos.idCliente,
          idClienteDepartamento: datos.idClienteDepartamento,
        },
      },
      select: {
        id: true,
        apagado: true,
        modelo: { select: { codigo: true } },
        // TODOS los precostos, no sólo los congelados (V1-E8f): con los borradores a la vista, la
        // clasificación es la MISMA regla del diálogo (`motivoNoCandidato`) y el rechazo puede
        // nombrar la versión que se quedó sin congelar.
        precostos: {
          orderBy: { version: 'desc' },
          select: { id: true, version: true, estado: true, costoTotal: true },
        },
        // Un desarrollo va en A LO MÁS UNA lista (mismo invariante que `motivoNoCandidato`): si ya
        // tiene un renglón, se rechaza (la re-negociación de E5 vive en la lista existente, no crea otra).
        listaLineas: { take: 1, select: { id: true } },
      },
    });

    // Junta TODOS los problemas (con su razón) en una sola pasada: el usuario los ve todos de una vez,
    // no de categoría en categoría. Un id que no es del cliente/no existe es entrada INVÁLIDA (400);
    // el resto son conflictos de estado (409). Se elige el tipo según haya o no entradas inválidas.
    const porId = new Map(desarrollos.map((d) => [d.id, d]));
    const problemas: string[] = [];
    let hayEntradaInvalida = false;
    for (const id of ids) {
      const d = porId.get(id);
      if (d === undefined) {
        problemas.push(`#${id}: no es del cliente/departamento indicado (o no existe)`);
        hayEntradaInvalida = true;
        continue;
      }
      // MISMA regla que el diálogo de candidatos (V1-E8f): una sola función decide quién entra, y
      // aquí sólo se traduce su motivo a texto. Antes la regla estaba escrita dos veces.
      const motivo = motivoNoCandidato(d);
      if (motivo === null) {
        continue;
      }
      const borrador = d.precostos.find((p) => p.estado === 'borrador');
      problemas.push(`${d.modelo.codigo}: ${TEXTO_MOTIVO_NO_CANDIDATO[motivo](borrador?.version)}`);
    }
    if (problemas.length > 0) {
      const mensaje = `No se puede crear la lista; corrige estos desarrollos: ${problemas.join('; ')}.`;
      throw hayEntradaInvalida ? new ErrorValidacion(mensaje) : new ErrorConflicto(mensaje);
    }

    // Factores del cliente/departamento (snapshot). Se re-validan por si acaso (deben venir válidos).
    const factoresFila = await resolverFactores(tx, datos.idCliente, datos.idClienteDepartamento);
    const factores: FactoresLista = factoresANumeros(factoresFila);
    validarFactores(factores);

    // Estado inicial `abierta` (lo siembra E1; si falta, es bug del seed → falla claro, no lo crea).
    const estadoAbierta = await tx.estadoLista.findUnique({
      where: { codigo: 'abierta' },
      select: { id: true },
    });
    if (estadoAbierta === null) {
      throw new Error('Falta el estado de lista "abierta" (¿se corrió el seed de F8-E1?).');
    }

    const folio = await siguienteFolio(tx, idEmpresa, 'lista-precios');
    const fecha = datos.fecha === undefined ? new Date() : new Date(datos.fecha);

    const lista = await tx.listaPrecios.create({
      data: {
        folio,
        idEmpresa,
        idCliente: datos.idCliente,
        idClienteDepartamento: datos.idClienteDepartamento,
        fecha,
        idEstadoLista: estadoAbierta.id,
        margenPct: factoresFila.margenPct,
        descuentosPct: factoresFila.descuentosPct,
        regaliasPct: factoresFila.regaliasPct,
        costoVentasPct: factoresFila.costoVentasPct,
        ...(datos.notas === undefined || datos.notas === null ? {} : { notas: datos.notas }),
        ...datosCreacion(sesion),
      },
      select: { id: true },
    });

    // Un renglón por desarrollo (en el orden pedido, ya validado). costoUnit = costo del congelado.
    const auditoria = datosCreacion(sesion);
    const renglones: Prisma.ListaPreciosLineaCreateManyInput[] = ids.map((id) => {
      const precosto = porId.get(id)?.precostos.find((p) => p.estado === 'congelado');
      // La validación de arriba garantiza el congelado; si faltara, es una invariante rota (no un
      // `idPrecosto: 0` silencioso que reventaría opaco contra la FK Restrict).
      if (precosto === undefined) {
        throw new Error(`Desarrollo ${id} quedó sin precosto congelado tras la validación.`);
      }
      const costoUnit = num(precosto.costoTotal);
      return {
        idLista: lista.id,
        idDesarrollo: id,
        idPrecosto: precosto.id,
        costoUnit,
        precioCalculado: calcularPrecioLista(costoUnit, factores),
        ...auditoria,
      };
    });
    await tx.listaPreciosLinea.createMany({ data: renglones });

    await registrarBitacora(tx, sesion, {
      entidad: 'ListaPrecios',
      idEntidad: lista.id,
      accion: 'CREAR',
      datos: {
        folio: Number(folio),
        idCliente: datos.idCliente,
        idClienteDepartamento: datos.idClienteDepartamento,
        renglones: renglones.length,
      },
    });

    return lista.id;
  }, bd);

  return obtenerLista(sesion, idNueva, bd);
}

// ── Editar factores (snapshot) ─────────────────────────────────────────────────────

/**
 * ¿De verdad cambió alguno de los cuatro factores? Se compara NÚMERO a número (el snapshot viene en
 * `Decimal` y la entrada en `number`, así que se normalizan los dos con `factoresANumeros`/la propia
 * entrada). Guardar los MISMOS valores no mueve nada, y por eso no tumba ninguna firma: castigar un
 * "guardar" sin cambios sería exactamente la firma-adorno al revés, un sobresalto sin hecho detrás.
 */
function factoresCambiaron(antes: FactoresLista, ahora: FactoresLista): boolean {
  return (
    antes.margenPct !== ahora.margenPct ||
    antes.descuentosPct !== ahora.descuentosPct ||
    antes.regaliasPct !== ahora.regaliasPct ||
    antes.costoVentasPct !== ahora.costoVentasPct
  );
}

/**
 * ⭐ **V1-E8b (§Post-F9.125(d))** — EDITA el snapshot de factores de la lista, RECALCULA el
 * `precioCalculado` de TODOS sus renglones y **TUMBA las aprobaciones** que hubiera.
 *
 * ⚠️ **Qué cambió y por qué, porque es lo contrario de lo que decía antes.** Hasta V1-E8a esta
 * función recalculaba *"sin tocar `precioAprobado`"*, y estaba escrito como una cortesía: **no
 * pisarle la firma al dueño**. El efecto era el contrario del propósito — quedaba un precio APROBADO
 * que ya no correspondía a los factores con que se calculó, y el sistema lo seguía presentando como
 * firmado. Es la misma lección de §Post-F9.116 en el otro extremo del flujo: *una firma que no está
 * amarrada a lo que se firmó no es una firma, es un adorno.*
 *
 * ⚠️ **Y había DOS criterios para el mismo hecho.** `registrarRonda` (`negociacion.ts`) SÍ resetea
 * `precioAprobado` cuando el COSTO cambia. Que mover el costo tumbara la firma y mover el margen no,
 * no era una distinción de negocio: era que nadie las había mirado juntas. Hoy las dos puertas hacen
 * lo mismo y por el mismo camino — un `NegociacionEvento` INMUTABLE por renglón.
 *
 * ⚠️ **Dónde queda la firma vieja (D3): NO se borra.** El renglón se limpia (nadie ha aprobado el
 * precio que hay AHORA, y dejar ahí a quien aprobó el anterior sería el adorno otra vez), pero:
 *  • el **evento de negociación** —que es el libro inmutable del renglón, el mismo que la pantalla ya
 *    enseña como historial— se lleva el precio anterior y la NOTA de qué lo invalidó y cuándo;
 *  • la **bitácora** se lleva, renglón por renglón, quién había aprobado y en qué fecha.
 * Se vuelve a aprobar normalmente, con `listas.aprobar`, como cualquier renglón nuevo: **no hay
 * estado muerto** (§Post-F9.125(d), condición (c) de §Post-F9.116).
 *
 * Serializado por advisory lock por lista (evita recálculos concurrentes que se pisen). **Requiere
 * `listas.aprobar`** (§Post-F9.125(a)): mover un factor ES mover el precio de venta.
 */
export async function editarFactoresLista(
  sesion: SesionUsuario,
  idLista: number,
  entrada: EntradaEditarFactoresLista,
  bd?: ContextoBd,
): Promise<ListaPreciosDetalle> {
  verificarPermiso(sesion, 'listas.aprobar');
  const datos: DatosListaFactoresEditar = validarEntrada(esquemaListaFactoresEditar, entrada);
  validarFactores(datos);

  await enTransaccion(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_LISTA}::int, ${idLista}::int)`;
    const lista = await exigirLista(tx, idLista, sesion.idEmpresaActiva);
    // E5: no se editan factores/recalculan precios sobre una lista en estado de CIERRE. El `esCierre`
    // se leyó BAJO el mismo advisory lock que `cambiarEstadoLista` toma → race-free.
    exigirListaNoCerrada(lista.esCierre);

    // Los factores VIGENTES, leídos bajo el lock: son los que dicen si de verdad hubo cambio.
    const snapshot = await tx.listaPrecios.findUniqueOrThrow({
      where: { id: idLista },
      select: { margenPct: true, descuentosPct: true, regaliasPct: true, costoVentasPct: true },
    });
    const cambiaron = factoresCambiaron(factoresANumeros(snapshot), datos);

    await tx.listaPrecios.update({
      where: { id: idLista },
      data: {
        margenPct: datos.margenPct,
        descuentosPct: datos.descuentosPct,
        regaliasPct: datos.regaliasPct,
        costoVentasPct: datos.costoVentasPct,
        ...datosModificacion(sesion),
      },
    });

    const renglones = await tx.listaPreciosLinea.findMany({
      where: { idLista },
      select: {
        id: true,
        costoUnit: true,
        precioAprobado: true,
        aprobadoPorId: true,
        aprobadoEn: true,
      },
    });

    const cuando = new Date();
    /** Las firmas que se cayeron, para que la bitácora pueda contestar "¿quién la había aprobado?". */
    const firmasTumbadas: Prisma.JsonArray = [];

    for (const renglon of renglones) {
      const precioCalculado = calcularPrecioLista(num(renglon.costoUnit), datos);
      // Sólo cae la firma que EXISTE y sólo si los factores de verdad se movieron.
      const tumbar = cambiaron && renglon.precioAprobado !== null;

      await tx.listaPreciosLinea.update({
        where: { id: renglon.id },
        data: {
          precioCalculado,
          ...(tumbar ? { precioAprobado: null, aprobadoPorId: null, aprobadoEn: null } : {}),
          ...datosModificacion(sesion),
        },
      });

      if (!tumbar) {
        continue;
      }

      const desde =
        renglon.aprobadoEn === null
          ? ''
          : ` La aprobación era del ${fechaDelActo(renglon.aprobadoEn)}.`;
      // El evento es INMUTABLE y sin precostos (no hubo re-costeo: el costo no se movió, los
      // factores sí). Su `precioAnterior` es la firma que se cae; su `precioNuevo`, lo que la
      // fórmula propone ahora.
      await tx.negociacionEvento.create({
        data: {
          idListaLinea: renglon.id,
          idPrecostoAnterior: null,
          idPrecostoNuevo: null,
          precioAnterior: renglon.precioAprobado,
          precioNuevo: precioCalculado,
          acuerdo:
            `Se INVALIDÓ la aprobación automáticamente el ${fechaDelActo(cuando)}: después de ` +
            `aprobarse se movieron los FACTORES de la lista (margen / descuentos / regalías / ` +
            `costo de ventas), así que el precio firmado ya no corresponde a los porcentajes con ` +
            `los que se calculó.${desde} Hay que volver a aprobarlo.`,
          registradoPorId: sesion.id,
        },
      });

      firmasTumbadas.push({
        idLinea: renglon.id,
        precioAprobadoAnterior: num(renglon.precioAprobado),
        aprobadoPorId: renglon.aprobadoPorId,
        aprobadoEn: renglon.aprobadoEn === null ? null : renglon.aprobadoEn.toISOString(),
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'ListaPrecios',
      idEntidad: idLista,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'editar-factores',
        renglones: renglones.length,
        factoresCambiaron: cambiaron,
        // D3: las firmas que se cayeron viajan ÍNTEGRAS al renglón de bitácora. Sin esto, una vez
        // sobrescrita la fila nadie podría contestar quién había aprobado ese precio y cuándo.
        firmasInvalidadas: firmasTumbadas,
      },
    });
  }, bd);

  return obtenerLista(sesion, idLista, bd);
}

// ── Aprobar / ajustar precio de un renglón ─────────────────────────────────────────

/**
 * APRUEBA un renglón: fija `precioAprobado = precioCalculado` (ATÓMICO: el UPDATE copia la columna, así
 * aprueba SIEMPRE el calculado VIGENTE aunque justo cambien los factores) y sella quién/cuándo. Rechaza
 * si el calculado es ≤ 0 (coherente con `ajustarPrecioLinea`, que exige `precio > 0`: no hay precio de
 * venta de 0). Requiere `listas.aprobar`. Devuelve la lista completa (para refrescar la aprobación).
 */
export async function aprobarLinea(
  sesion: SesionUsuario,
  idLinea: number,
  bd?: ContextoBd,
): Promise<ListaPreciosDetalle> {
  verificarPermiso(sesion, 'listas.aprobar');

  const idLista = await enTransaccion(async (tx) => {
    // Toma el advisory lock por lista ANTES de leer el estado (race-free vs `cambiarEstadoLista`).
    const linea = await exigirLineaBloqueandoLista(tx, idLinea, sesion.idEmpresaActiva);
    // E5: no se aprueba sobre una lista en estado de CIERRE.
    exigirListaNoCerrada(linea.esCierre);
    // V1-E8x: ni sobre un MODELO cerrado/dropeado (§Post-F9.151) — el eje hermano, por renglón.
    exigirRenglonMovible(linea.estado, 'aprobar su precio');
    if (num(linea.precioCalculado) <= 0) {
      throw new ErrorConflicto(
        'No se puede aprobar un precio calculado de 0; ajusta el precosto (para que tenga costo) o teclea un precio.',
      );
    }
    const ahora = new Date();
    // Copia atómica precio_calculado → precio_aprobado (Prisma no puede set columna=columna).
    await tx.$executeRaw`
      UPDATE "lista_precios_linea"
      SET "precio_aprobado" = "precio_calculado",
          "aprobado_por_id" = ${sesion.id},
          "aprobado_en" = ${ahora},
          "modificado_por_id" = ${sesion.id},
          "modificado_en" = ${ahora}
      WHERE "id" = ${idLinea}
    `;
    await registrarBitacora(tx, sesion, {
      entidad: 'ListaPrecios',
      idEntidad: linea.idLista,
      accion: 'MODIFICAR',
      datos: { operacion: 'aprobar-linea', idLinea },
    });
    return linea.idLista;
  }, bd);

  return obtenerLista(sesion, idLista, bd);
}

/**
 * AJUSTA (teclea) el precio aprobado de un renglón: `precioAprobado = precio` capturado por el dueño,
 * sella quién/cuándo. Valida `precio > 0`. Requiere `listas.aprobar`. Devuelve la lista completa.
 */
export async function ajustarPrecioLinea(
  sesion: SesionUsuario,
  idLinea: number,
  entrada: EntradaAjustarPrecio,
  bd?: ContextoBd,
): Promise<ListaPreciosDetalle> {
  verificarPermiso(sesion, 'listas.aprobar');
  const datos: DatosAjustarPrecioLinea = validarEntrada(esquemaAjustarPrecioLinea, entrada);

  const idLista = await enTransaccion(async (tx) => {
    // Toma el advisory lock por lista ANTES de leer el estado (race-free vs `cambiarEstadoLista`).
    const linea = await exigirLineaBloqueandoLista(tx, idLinea, sesion.idEmpresaActiva);
    // E5: no se teclea precio sobre una lista en estado de CIERRE.
    exigirListaNoCerrada(linea.esCierre);
    // V1-E8x: ni sobre un MODELO cerrado/dropeado (§Post-F9.151).
    exigirRenglonMovible(linea.estado, 'teclearle un precio');
    await tx.listaPreciosLinea.update({
      where: { id: idLinea },
      data: {
        precioAprobado: datos.precio,
        aprobadoPorId: sesion.id,
        aprobadoEn: new Date(),
        ...datosModificacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'ListaPrecios',
      idEntidad: linea.idLista,
      accion: 'MODIFICAR',
      datos: { operacion: 'ajustar-precio', idLinea, precio: datos.precio },
    });
    return linea.idLista;
  }, bd);

  return obtenerLista(sesion, idLista, bd);
}

// ── ⭐ El TARGET PRICE del cliente (V1-E8w, §Post-F9.150) ────────────────────────────

/**
 * ⭐ FIJA (o BORRA) el **TARGET PRICE** que el cliente dio para un renglón. Daniel:
 *
 * > *«aveces los clientes nos dan sus target prices…. y es importante saberlo a la hora de la
 * > negociacion. Eso lo debe de poner Aurora desde que hace la lista de precios. (o los modelos).
 * > Debe de tener un liugar para poner el target que le dio el cliente si es que nos lo dio. Y me
 * > debe de aparecer en la negociacion.»*
 *
 * 🔴 **El permiso es `listas.administrar`, NO `listas.aprobar`.** Es deliberado y es el corazón de
 * la decisión: quien lo captura es **Aurora al armar la lista** (Gerencial: administra listas,
 * negocia y cotiza, pero **no** aprueba precios), no el dueño en la mesa. Con `listas.aprobar` el
 * dato habría quedado del lado equivocado del reparto — es la misma puerta con la que se agrega y
 * se quita un renglón, que es exactamente cuando se conoce el target.
 *
 * 🔴 **INFORMA, NO BLOQUEA** (decisión punto 4): fijar un target no impide aprobar por debajo, ni
 * cotizar, ni bajar el PDF. Es un dato que viene de FUERA; el sistema no lo calcula ni lo obedece.
 *
 * `precioTarget: null` **borra** el target: *"si es que nos lo dio"* — un número capturado por error
 * tiene que poder retirarse, porque un target falso en la mesa es peor que ninguno.
 *
 * Bajo el advisory lock por lista + guard de lista NO cerrada, como cualquier edición de renglón (una
 * lista en estado de cierre es historia; para tocarla se reabre, y eso queda auditado).
 */
export async function fijarPrecioTargetLinea(
  sesion: SesionUsuario,
  idLinea: number,
  entrada: z.input<typeof esquemaPrecioTargetLinea>,
  bd?: ContextoBd,
): Promise<ListaPreciosDetalle> {
  verificarPermiso(sesion, 'listas.administrar');
  const datos: DatosPrecioTargetLinea = validarEntrada(esquemaPrecioTargetLinea, entrada);

  const idLista = await enTransaccion(async (tx) => {
    const linea = await exigirLineaBloqueandoLista(tx, idLinea, sesion.idEmpresaActiva);
    exigirListaNoCerrada(linea.esCierre);
    // V1-E8x: un modelo cerrado/dropeado tampoco recibe target nuevo (§Post-F9.151).
    exigirRenglonMovible(linea.estado, 'capturarle el target del cliente');
    await tx.listaPreciosLinea.update({
      where: { id: idLinea },
      data: { precioTarget: datos.precioTarget, ...datosModificacion(sesion) },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'ListaPrecios',
      idEntidad: linea.idLista,
      accion: 'MODIFICAR',
      datos: { operacion: 'precio-target', idLinea, precioTarget: datos.precioTarget },
    });
    return linea.idLista;
  }, bd);

  return obtenerLista(sesion, idLista, bd);
}

// ── Quitar un renglón / borrar la lista (V1-E4 punto 4) ─────────────────────────────

/**
 * ⭐ V1-E4 (punto 4) — un desarrollo metido por error en una lista quedaba ATRAPADO PARA SIEMPRE.
 *
 * Por qué era una trampa y no una molestia: `lista_precios_linea` tiene `@@unique([idDesarrollo])`
 * a nivel BD (F8-E5), o sea que **un desarrollo vive en A LO MÁS UNA lista**. Sin forma de quitar
 * el renglón, ese desarrollo no podía entrar NUNCA a la lista correcta — `crearLista` lo rechazaba
 * con "ya está en otra lista" y no había salida por ningún lado.
 *
 * D3 (nada desaparece en silencio): el renglón se borra FÍSICO —tiene que hacerlo, o el unique lo
 * seguiría reteniendo— pero antes queda ÍNTEGRO en la bitácora: el objeto completo del `antes` con
 * todos sus importes y su aprobación, MÁS todos sus eventos de negociación **con el DESGLOSE de
 * costos de cada uno** (que se irían por cascada). Nada de conteos: lo que se guarda es lo que
 * había, tal cual, y con eso se puede reconstruir el renglón entero — incluida la mesa con la que
 * se vendió (§Post-F9.149).
 *
 * Guardas: `listas.administrar`, empresa activa (A9 — un renglón ajeno da 404, no 409) y lista NO
 * cerrada (una lista en estado de cierre es historia; para tocarla hay que reabrirla, que es un
 * cambio de estado auditado).
 */
export async function quitarLineaLista(
  sesion: SesionUsuario,
  idLinea: number,
  bd?: ContextoBd,
): Promise<ListaPreciosDetalle> {
  verificarPermiso(sesion, 'listas.administrar');

  const idLista = await enTransaccion(async (tx) => {
    // Mismo patrón que aprobar/ajustar: advisory lock por lista ANTES de leer el estado.
    const base = await exigirLineaBloqueandoLista(tx, idLinea, sesion.idEmpresaActiva);
    exigirListaNoCerrada(base.esCierre);
    // 🔴 V1-E8x: quitar NO lleva `exigirRenglonMovible`, y es DELIBERADO. Un renglón dropeado
    // (o cerrado) sigue reteniendo su desarrollo por el `@@unique([idDesarrollo])`: si tampoco se
    // pudiera quitar, ese desarrollo no podría entrar NUNCA a otra lista — la trampa exacta que
    // esta función vino a cerrar. Dropear un modelo no puede resucitarla.

    // V1-E7c: un renglón YA COTIZADO sí se puede quitar. Retenerlo (como hacía la primera versión de
    // esta etapa, con un `Restrict`) NO protegía la cotización —su contenido está congelado en sus
    // propias columnas— sino que ATRAPABA el desarrollo: con `@@unique([idDesarrollo])` no podría
    // entrar NUNCA a otra lista, y sin escapatoria, porque una cotización no se borra ni cancelándola.
    // La FK del documento es `SetNull`: al quitar el renglón, el puntero se va a null y el papel se
    // sigue imprimiendo idéntico.

    // El objeto COMPLETO del `antes` (D3) + los eventos que se van por cascada.
    const antes = await tx.listaPreciosLinea.findUniqueOrThrow({ where: { id: idLinea } });
    const eventos = await tx.negociacionEvento.findMany({
      where: { idListaLinea: idLinea },
      orderBy: { id: 'asc' },
      // 🔴🔴 CON SU DESGLOSE, no sólo el escalar (V1-E8w, ronda de corrección).
      // `NegociacionEventoCosto` cuelga del evento con `onDelete: Cascade`, así que se va en el
      // mismo borrado; sin este `include` la foto guardaba el `costoEstimado` y el comentario, y el
      // desglose —tela 1.2×20, maquila 5, jareta 3.25…— desaparecía SIN RASTRO. Es exactamente lo
      // que §Post-F9.149 declara insuficiente: *«un total sin desglose no sirve para eso»*, porque
      // con el desglose es como Desarrollo arma la receta nueva.
      include: { costos: { orderBy: { orden: 'asc' } } },
    });

    await tx.listaPreciosLinea.delete({ where: { id: idLinea } });
    await tx.listaPrecios.update({
      where: { id: base.idLista },
      data: { ...datosModificacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'ListaPrecios',
      idEntidad: base.idLista,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'quitar-linea',
        idLinea,
        antes: aJsonBitacora(antes),
        eventosNegociacion: eventos.map(aJsonBitacora),
      },
    });
    return base.idLista;
  }, bd);

  return obtenerLista(sesion, idLista, bd);
}

/**
 * ⭐ V1-E4 (punto 4) — BORRA una lista de precios completa (con sus renglones y sus eventos de
 * negociación, que se van por cascada). Es la otra mitad de la trampa: una lista creada por error
 * retenía a TODOS sus desarrollos, y ninguno podía entrar a la lista buena.
 *
 * D3: el `antes` que queda en bitácora es la lista ENTERA —encabezado con sus factores, cada
 * renglón con sus importes y su aprobación, y cada evento de negociación **con su desglose de
 * costos**—, no un conteo.
 *
 * Guardas: `listas.administrar`, empresa activa (A9) y estado NO de cierre. Una lista `cerrada` o
 * `ya-pedida` es un compromiso con el cliente: para borrarla hay que reabrirla primero (cambio de
 * estado auditado), y entonces se ve en la bitácora que alguien la reabrió PARA borrarla.
 */
export async function eliminarLista(
  sesion: SesionUsuario,
  idLista: number,
  bd?: ContextoBd,
): Promise<void> {
  verificarPermiso(sesion, 'listas.administrar');

  await enTransaccion(async (tx) => {
    // A9 primero: una lista de otra empresa NO EXISTE para esta sesión (404, nunca 409 — un 409
    // confirmaría que existe).
    const existe = await tx.listaPrecios.findFirst({
      where: { id: idLista, idEmpresa: sesion.idEmpresaActiva },
      select: { id: true },
    });
    if (existe === null) {
      throw new ErrorNoEncontrado('Lista de precios', idLista);
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_LISTA}::int, ${idLista}::int)`;

    // Re-lectura BAJO el lock: el estado ya no puede cambiar hasta el commit.
    const lista = await tx.listaPrecios.findFirstOrThrow({
      where: { id: idLista, idEmpresa: sesion.idEmpresaActiva },
      include: { estadoLista: { select: { esCierre: true, nombre: true } } },
    });
    if (lista.estadoLista.esCierre) {
      throw new ErrorConflicto(
        `La lista ${String(Number(lista.folio))} está "${lista.estadoLista.nombre}" (estado de cierre); reábrela antes de borrarla.`,
      );
    }

    const lineas = await tx.listaPreciosLinea.findMany({
      where: { idLista },
      orderBy: { id: 'asc' },
    });
    const eventos = await tx.negociacionEvento.findMany({
      where: { idListaLinea: { in: lineas.map((l) => l.id) } },
      orderBy: { id: 'asc' },
      // 🔴🔴 CON SU DESGLOSE (V1-E8w, ronda de corrección) — ver el mismo `include` en
      // `quitarLineaLista`: los `NegociacionEventoCosto` se van por cascada y sin fotografiarlos el
      // `antes` guardaba un total mudo.
      include: { costos: { orderBy: { orden: 'asc' } } },
    });

    // V1-E7c: una lista que ya produjo cotizaciones SÍ se borra. El documento emitido no depende de
    // ella para nada —su encabezado (cliente, departamento, folio de la lista) y sus renglones están
    // CONGELADOS como valores—, así que `Cotizacion.idLista` es `SetNull` y la cotización queda
    // íntegra con el puntero en null. Blindarla habría dejado la lista atrapada para siempre.

    // La bitácora va ANTES del delete: si el borrado falla, tampoco queda el registro (A2), y si
    // sale bien el `antes` ya está escrito en la MISMA transacción.
    await registrarBitacora(tx, sesion, {
      entidad: 'ListaPrecios',
      idEntidad: idLista,
      // No hay acción `ELIMINAR` en el enum; el precedente del repo para un borrado físico es
      // `OTRO` + `operacion` (ver `dominio/admin/roles.ts`).
      accion: 'OTRO',
      datos: {
        operacion: 'eliminar-lista',
        antes: aJsonBitacora({
          ...lista,
          estadoLista: undefined,
          lineas,
          eventosNegociacion: eventos,
        }),
      },
    });
    // Cascade: `lista_precios_linea` y, desde ahí, `negociacion_evento`.
    await tx.listaPrecios.delete({ where: { id: idLista } });
  }, bd);
}

// ── Lecturas ────────────────────────────────────────────────────────────────────────

/** Un renglón mínimo para contar aprobados/dropeados en el listado (sin cargar todo). */
const incluirResumen = {
  cliente: { select: { nombre: true } },
  clienteDepartamento: { select: { nombre: true } },
  estadoLista: { select: { codigo: true, nombre: true } },
  lineas: { select: { precioAprobado: true, estado: true } },
} satisfies Prisma.ListaPreciosInclude;

type ListaResumenPayload = Prisma.ListaPreciosGetPayload<{ include: typeof incluirResumen }>;

/**
 * Proyecta una lista a su resumen de listado (sin renglones; con los conteos que deciden si de esa
 * lista puede salir papel).
 *
 * ⭐ V1-E8x (§Post-F9.155): `renglonesAprobados` cuenta **sólo entre los VIGENTES**, no entre todos.
 * Antes de los estados daba igual; hoy no: un dropeado que quedó con su firma vieja habría inflado
 * el conteo, y uno sin firmar lo habría dejado congelado en «3/5» para siempre aunque el PDF ya
 * pudiera bajarse. El par que la pantalla enseña —aprobados sobre vigentes— es exactamente el que
 * el guard del papel evalúa.
 */
function aResumen(lista: ListaResumenPayload): ListaPreciosResumen {
  const vigentes = lista.lineas.filter((l) => l.estado !== 'dropeado');
  return {
    id: lista.id,
    folio: Number(lista.folio),
    idCliente: lista.idCliente,
    nombreCliente: lista.cliente.nombre,
    idClienteDepartamento: lista.idClienteDepartamento,
    nombreDepartamento: lista.clienteDepartamento.nombre,
    fecha: aFechaCorta(lista.fecha),
    idEstadoLista: lista.idEstadoLista,
    codigoEstado: lista.estadoLista.codigo,
    nombreEstado: lista.estadoLista.nombre,
    totalRenglones: lista.lineas.length,
    renglonesDropeados: lista.lineas.length - vigentes.length,
    renglonesAprobados: vigentes.filter((l) => l.precioAprobado !== null).length,
    creadoEn: lista.creadoEn.toISOString(),
  };
}

/**
 * LISTA las listas de precios de la empresa activa (A9), más nueva primero, con filtros opcionales por
 * cliente/departamento/estado y rango de fechas. Requiere `listas.ver`.
 */
export async function listarListas(
  sesion: SesionUsuario,
  filtros: FiltrosListas = {},
  bd?: ContextoBd,
): Promise<ListaPreciosResumen[]> {
  verificarPermiso(sesion, 'listas.ver');
  const fecha: Prisma.DateTimeFilter = {};
  if (filtros.desde !== undefined) {
    fecha.gte = new Date(filtros.desde);
  }
  if (filtros.hasta !== undefined) {
    fecha.lte = new Date(filtros.hasta);
  }
  const listas = await clienteLectura(bd).listaPrecios.findMany({
    where: {
      idEmpresa: sesion.idEmpresaActiva,
      ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
      ...(filtros.idClienteDepartamento === undefined
        ? {}
        : { idClienteDepartamento: filtros.idClienteDepartamento }),
      ...(filtros.idEstadoLista === undefined ? {} : { idEstadoLista: filtros.idEstadoLista }),
      ...(filtros.desde === undefined && filtros.hasta === undefined ? {} : { fecha }),
    },
    orderBy: { folio: 'desc' },
    include: incluirResumen,
  });
  return listas.map(aResumen);
}

/** Obtiene una lista completa (con renglones) de la empresa activa, o `ErrorNoEncontrado`. */
export async function obtenerLista(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ListaPreciosDetalle> {
  verificarPermiso(sesion, 'listas.ver');
  const lista = await clienteLectura(bd).listaPrecios.findFirst({
    where: { id, idEmpresa: sesion.idEmpresaActiva },
    include: incluirLista,
  });
  if (lista === null) {
    throw new ErrorNoEncontrado('Lista de precios', id);
  }
  return aListaSalida(
    lista,
    tienePermiso(sesion, 'consultas.ver-importes'),
    puedeVerFactoresDePrecio(sesion),
  );
}

/**
 * ⭐ V1-E8f (§Post-F9.128) — CLASIFICADOR PURO: ¿este desarrollo entra a una lista, y si no, por qué?
 *
 * Está aparte y sin BD a propósito: es la regla de **QUIÉN CALIFICA**, en un solo lugar y con prueba
 * unitaria (antes vivía disuelta en el `where` de Prisma, donde no se puede preguntar "¿y por qué no?").
 *
 * ⚠️ **NO trae el ALCANCE, y no debe traerlo.** Las tres condiciones de alcance —empresa activa (A9),
 * cliente y departamento— siguen en el `where`, porque **definen el universo de la pregunta, no un
 * descarte**: un desarrollo de otro cliente no es "descartado", simplemente no es de esta pregunta.
 * Se dice aquí porque la primera redacción afirmaba "la regla ENTERA", y quien la reusara creyendo
 * que trae el A9 dentro se saltaría el scope por empresa.
 * `null` = SÍ es candidato.
 *
 * ⭐ **LA PRECEDENCIA NO ES COSMÉTICA: decide QUÉ REMEDIO se le ofrece al usuario**, así que se elige
 * por *"¿cuál de los dos arreglos lo acerca de verdad a cotizarlo?"*, no por cuál se detectó antes.
 *
 * `ya-en-lista` **gana a `apagado`** — y esto se corrigió en la ronda de revisión de V1-E8f. Antes
 * ganaba `apagado`, y como `apagarDesarrollo` **no impide** apagar algo que ya está en una lista, el
 * caso es alcanzable: el usuario leía *"reactívalo antes de cotizarlo"*, lo reactivaba… **y seguía sin
 * poder**, ahora bajo *"ya está en una lista"*. **Un remedio que promete un resultado que no puede
 * entregar es peor que no ofrecer ninguno.** Con `ya-en-lista` primero, la cadena termina bien:
 * quitarlo de la lista → (si además está apagado) reactivarlo → cotizarlo.
 *
 * Después va `apagado`, y sólo al final se distingue "tiene precosto pero en borrador" de "no tiene ni
 * uno".
 */
export function motivoNoCandidato(desarrollo: {
  apagado: boolean;
  precostos: readonly { estado: string }[];
  listaLineas: readonly unknown[];
}): MotivoNoCandidato | null {
  if (desarrollo.listaLineas.length > 0) {
    return 'ya-en-lista';
  }
  if (desarrollo.apagado) {
    return 'apagado';
  }
  if (desarrollo.precostos.some((p) => p.estado === 'congelado')) {
    return null;
  }
  return desarrollo.precostos.length > 0 ? 'precosto-borrador' : 'sin-precosto';
}

/** Lo que devuelve el diagnóstico: los que SÍ califican, los que no con su motivo, y si faltan factores. */
export interface DiagnosticoCandidatos {
  candidatos: CandidatoLista[];
  descartados: DescartadoLista[];
  /**
   * ⭐ V1-E8t (§Post-F9.145) — ¿este cliente+departamento NO tiene factores de precio? Lo contesta
   * `buscarFactoresResueltos`, **la misma función que usa el bloqueo** (`resolverFactores` dentro de
   * `crearLista`): el aviso y el candado no pueden decir cosas distintas.
   */
  faltanFactores: boolean;
}

/**
 * DIAGNÓSTICO de candidatura para una lista, de TODOS los desarrollos de ese cliente+departamento de
 * la empresa activa (A9). Devuelve los CANDIDATOS —"cotizados" (≥1 precosto congelado), no apagados y
 * sin renglón en ninguna lista— y también los DESCARTADOS con el motivo exacto que los dejó fuera.
 *
 * ⭐ V1-E8f (§Post-F9.128): antes esto sólo devolvía los candidatos y el filtro vivía en el `where`,
 * así que cuando salían cero el usuario recibía *"no hay desarrollos cotizados disponibles"* y nada
 * más — Daniel se topó justo con eso. Ahora se traen TODOS y se clasifican en memoria con
 * `motivoNoCandidato`: una sola consulta, una sola regla, y el aviso puede decir POR QUÉ y a dónde ir.
 *
 * ⚠️ **SIN TOPE, y la razón está MEDIDA a medias — queda dicho.** El universo es un
 * cliente+departamento, y la primera redacción lo llamaba *"acotado"* **sin haberlo medido**. Hoy no
 * duele (Desarrollo arranca en cero: no hay ETL de Access para este módulo), pero **el cubo
 * `ya-en-lista` CRECE MONÓTONAMENTE** — es *"todo lo que alguna vez se cotizó a ese cliente"*—, y se
 * trae entero en cada apertura del diálogo, con todos sus precostos, y se pinta un renglón por cada
 * descartado. Lo levantó el reviewer de V1-E8f.
 * ⇒ **Cuando un cliente pase de ~200 desarrollos cotizados, hay que paginar o dejar de traer los ya
 * colocados.** *Llamar "acotado" a algo que sólo crece es la clase de suposición que se descubre el
 * día que duele.*
 *
 * Con `idProyecto` (Daniel, ago-2026) se acota a UN proyecto: es lo que ofrece el botón «Generar lista
 * de precios» desde la página del proyecto, que ya conoce cliente y departamento.
 * Requiere `listas.ver`.
 */
export async function diagnosticoCandidatosLista(
  sesion: SesionUsuario,
  parametros: { idCliente: number; idClienteDepartamento: number; idProyecto?: number },
  bd?: ContextoBd,
): Promise<DiagnosticoCandidatos> {
  verificarPermiso(sesion, 'listas.ver');
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const cliente = clienteLectura(bd);

  // ⭐ V1-E8t (§Post-F9.145) — el OTRO requisito de la lista, preguntado ANTES de apretar el botón.
  // Se pregunta con la MISMA función del bloqueo, no con una copia de la cascada override→default.
  const faltanFactores =
    (await buscarFactoresResueltos(
      cliente,
      parametros.idCliente,
      parametros.idClienteDepartamento,
    )) === null;

  const desarrollos = await cliente.desarrollo.findMany({
    where: {
      ...(parametros.idProyecto === undefined ? {} : { idProyecto: parametros.idProyecto }),
      proyecto: {
        idEmpresa: sesion.idEmpresaActiva,
        idCliente: parametros.idCliente,
        idClienteDepartamento: parametros.idClienteDepartamento,
      },
    },
    select: {
      id: true,
      apagado: true,
      numeroCliente: true,
      idProyecto: true,
      proyecto: { select: { folio: true, nombre: true } },
      modelo: { select: { codigo: true, descripcion: true } },
      // TODOS los precostos (no sólo los congelados): sin los borradores no se puede distinguir
      // "le falta congelar la v2" de "no tiene ni un precosto", que son remedios DISTINTOS.
      precostos: {
        orderBy: { version: 'desc' },
        select: { id: true, version: true, estado: true, costoTotal: true },
      },
      listaLineas: { select: { idLista: true, lista: { select: { folio: true } } } },
    },
    orderBy: { id: 'asc' },
  });

  const candidatos: CandidatoLista[] = [];
  const descartados: DescartadoLista[] = [];

  for (const d of desarrollos) {
    const motivo = motivoNoCandidato(d);
    if (motivo === null) {
      // `precostos` viene ordenado por versión DESC: el primero congelado es el más reciente.
      const precosto = d.precostos.find((p) => p.estado === 'congelado');
      candidatos.push({
        idDesarrollo: d.id,
        idProyecto: d.idProyecto,
        folioProyecto: Number(d.proyecto.folio),
        nombreProyecto: d.proyecto.nombre,
        codigoModelo: d.modelo.codigo,
        descripcionModelo: d.modelo.descripcion,
        numeroCliente: d.numeroCliente,
        idPrecosto: precosto?.id ?? 0,
        versionPrecosto: precosto?.version ?? 0,
        costoTotal: verImportes ? num(precosto?.costoTotal) : null,
      });
      continue;
    }
    const borrador = d.precostos.find((p) => p.estado === 'borrador');
    const renglon = d.listaLineas[0];
    descartados.push({
      idDesarrollo: d.id,
      idProyecto: d.idProyecto,
      folioProyecto: Number(d.proyecto.folio),
      nombreProyecto: d.proyecto.nombre,
      codigoModelo: d.modelo.codigo,
      numeroCliente: d.numeroCliente,
      motivo,
      versionPrecosto: motivo === 'precosto-borrador' ? (borrador?.version ?? null) : null,
      idLista: motivo === 'ya-en-lista' ? (renglon?.idLista ?? null) : null,
      folioLista:
        motivo === 'ya-en-lista' && renglon !== undefined ? Number(renglon.lista.folio) : null,
    });
  }

  return { candidatos, descartados, faltanFactores };
}

/**
 * CANDIDATOS para una lista (sólo los que SÍ califican) — proyección de `diagnosticoCandidatosLista`.
 * Requiere `listas.ver`.
 *
 * ⚠️ **HOY SU ÚNICO CONSUMIDOR ES SU PROPIA PRUEBA DE INTEGRACIÓN** — la ruta usa el diagnóstico
 * completo desde V1-E8f. Lo levantó el reviewer, y **se conserva a propósito**: es la proyección
 * *"sólo los que sí"*, que es la pregunta natural de cualquier consumidor futuro que no necesite los
 * descartados, y **cuesta cero mantenerla** porque no repite la regla: llama al diagnóstico.
 *
 * 🔴 Se anota en vez de callarse porque *una función exportada cuyo único llamador es su prueba
 * parece viva y no lo está*, y en este proyecto ya hubo ocho casos del patrón "se construye y nadie
 * lo usa". **Si dentro de un par de etapas sigue sin llamador de producción, se retira** y el int
 * test proyecta el diagnóstico a mano.
 */
export async function candidatosParaLista(
  sesion: SesionUsuario,
  parametros: { idCliente: number; idClienteDepartamento: number; idProyecto?: number },
  bd?: ContextoBd,
): Promise<CandidatoLista[]> {
  return (await diagnosticoCandidatosLista(sesion, parametros, bd)).candidatos;
}

/**
 * DESGLOSE de costo de un renglón (rediseño R5, §4.8 + ⭐⭐ V1-E8w): los conceptos del precosto
 * CONGELADO del renglón, agrupados y sumados EN EL SERVIDOR (A1 / lección F5-E7: la agregación nunca
 * se pivotea en el cliente) — Tela · Avíos · Procesos · Corte · Maquila · Empaque = costo total.
 *
 * ⭐⭐ **V1-E8w — YA NO APLASTA.** Hasta la 0.059 esta función devolvía SÓLO el subtotal por concepto:
 * el detalle vivía en `precosto.lineas` y la mesa nunca lo veía. Ése era el defecto —agrupaba, no le
 * faltaba el dato—, y es justo lo que Daniel pidió abrir:
 *
 * > *«En el desglose de elementos, es importante poner precio de la tela, y consumo…»*
 * > *«Para los avios, me gustaria poder abrir el desglose de los costos de los avios y poder mover
 * > los costos ahi. Desglosados… no solo el total, por que no se bien de que elementos se compone.»*
 *
 * Así que cada grupo viaja con sus `lineas` (id, descripción, **consumo y precio separados**,
 * importe) **además** del subtotal. El subtotal no se retira: los consumidores que sólo lo querían
 * —el renglón expandible de la lista— siguen leyéndolo igual.
 *
 * ⭐ **Y trae la FOTO principal del modelo** (*«Me gustaria ir viendo la foto del modelo. La
 * principal.»*). Se firma AQUÍ, en el desglose de UN renglón, y no en la lista completa: prefirmar
 * una URL cuesta un viaje a R2, y una lista de 20 modelos habría pagado 20 en cada carga para
 * enseñar una sola foto a la vez. La "principal" es la PRIMERA por `orden` — el mismo criterio del
 * carrusel, la galería y el impreso de la orden (`orden-principal.ts`), nunca una segunda opinión.
 *
 * Scope por empresa (A9); los importes se OCULTAN (null) sin `consultas.ver-importes` —el `consumo`
 * NO: es una cantidad, mismo criterio que `PrecostoLineaSalida`—. Requiere `listas.ver` (evita el
 * cruce de permisos con `desarrollo.ver`).
 */
export async function desgloseCostoLinea(
  sesion: SesionUsuario,
  idLinea: number,
  bd?: ContextoBd,
  /** Servicio de archivos inyectable (para probar sin R2 real, como fotos de modelo/bordado). */
  archivos?: ServicioArchivos,
): Promise<DesgloseCostoLinea> {
  verificarPermiso(sesion, 'listas.ver');
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const linea = await clienteLectura(bd).listaPreciosLinea.findFirst({
    where: { id: idLinea, lista: { idEmpresa: sesion.idEmpresaActiva } },
    select: {
      idPrecosto: true,
      desarrollo: {
        select: {
          modelo: {
            select: {
              codigo: true,
              // La PRIMERA por `orden` (luego `id`) es la principal — el criterio único del sistema.
              fotos: {
                orderBy: [{ orden: 'asc' }, { id: 'asc' }],
                take: 1,
                select: { archivo: { select: { key: true } } },
              },
            },
          },
        },
      },
      precosto: {
        select: {
          version: true,
          costoTotal: true,
          lineas: {
            orderBy: [{ conceptoCosto: { orden: 'asc' } }, { id: 'asc' }],
            select: {
              id: true,
              descripcion: true,
              consumo: true,
              precioUnit: true,
              importe: true,
              conceptoCosto: { select: { codigo: true, nombre: true, orden: true } },
            },
          },
        },
      },
    },
  });
  if (linea === null) {
    throw new ErrorNoEncontrado('Renglón de lista de precios', idLinea);
  }

  // Agrupación por concepto (server-side): subtotal + LOS RENGLONES, ordenados por catálogo. El
  // `orderBy` de la consulta ya deja las líneas en orden de concepto y luego de id, así que el
  // recorrido conserva ese orden dentro de cada grupo sin volver a ordenar.
  const porConcepto = new Map<
    string,
    {
      codigo: string;
      nombre: string;
      orden: number;
      subtotal: number;
      lineas: DesgloseCostoLinea['grupos'][number]['lineas'];
    }
  >();
  for (const l of linea.precosto.lineas) {
    const c = l.conceptoCosto;
    const acc = porConcepto.get(c.codigo) ?? {
      codigo: c.codigo,
      nombre: c.nombre,
      orden: c.orden,
      subtotal: 0,
      lineas: [],
    };
    acc.subtotal += num(l.importe);
    acc.lineas.push({
      id: l.id,
      descripcion: l.descripcion,
      consumo: numOrNull(l.consumo),
      precioUnit: verImportes ? num(l.precioUnit) : null,
      importe: verImportes ? num(l.importe) : null,
    });
    porConcepto.set(c.codigo, acc);
  }
  const grupos = [...porConcepto.values()]
    .sort((a, b) => a.orden - b.orden)
    .map((g) => ({
      codigo: g.codigo,
      nombre: g.nombre,
      subtotal: verImportes ? redondear2(g.subtotal) : null,
      lineas: g.lineas,
    }));

  // La foto sólo se firma si la hay: `servicioArchivos()` lee la configuración de R2 al construirse,
  // y un renglón sin fotos no tiene por qué exigirla.
  const keyFoto = linea.desarrollo.modelo.fotos[0]?.archivo.key;
  const urlFotoModelo =
    keyFoto === undefined ? null : await (archivos ?? servicioArchivos()).urlDescarga(keyFoto);

  return {
    idPrecosto: linea.idPrecosto,
    versionPrecosto: linea.precosto.version,
    grupos,
    costoTotal: verImportes ? num(linea.precosto.costoTotal) : null,
    codigoModelo: linea.desarrollo.modelo.codigo,
    urlFotoModelo,
  };
}
