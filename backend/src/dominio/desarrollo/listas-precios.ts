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
import type { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import {
  esquemaAjustarPrecioLinea,
  esquemaListaFactoresEditar,
  esquemaListaPreciosCrear,
  type CandidatoLista,
  type DatosAjustarPrecioLinea,
  type DatosListaFactoresEditar,
  type DatosListaPreciosCrear,
  type DescartadoLista,
  type DesgloseCostoLinea,
  type ListaPreciosLineaSalida,
  type ListaPreciosResumen,
  type ListaPreciosDetalle,
  type ListasPreciosQuery,
  type MotivoNoCandidato,
} from '../../contrato/esquemas/lista-precios.js';
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
    aprobado: linea.precioAprobado !== null,
    aprobadoPorId: linea.aprobadoPorId,
    aprobadoEn: linea.aprobadoEn === null ? null : linea.aprobadoEn.toISOString(),
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

    // El departamento debe pertenecer al cliente (si no, la resolución de factores mentiría).
    const departamento = await tx.clienteDepartamento.findFirst({
      where: { id: datos.idClienteDepartamento, idCliente: datos.idCliente },
      select: { id: true },
    });
    if (departamento === null) {
      throw new ErrorValidacion('El departamento no pertenece al cliente indicado.');
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
 * todos sus importes y su aprobación, MÁS todos sus eventos de negociación (que se irían por
 * cascada). Nada de conteos: lo que se guarda es lo que había, tal cual, y con eso se puede
 * reconstruir el renglón entero.
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
 * renglón con sus importes y su aprobación, y cada evento de negociación—, no un conteo.
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

/** Un renglón mínimo para contar aprobados en el listado (sin cargar todo). */
const incluirResumen = {
  cliente: { select: { nombre: true } },
  clienteDepartamento: { select: { nombre: true } },
  estadoLista: { select: { codigo: true, nombre: true } },
  lineas: { select: { precioAprobado: true } },
} satisfies Prisma.ListaPreciosInclude;

type ListaResumenPayload = Prisma.ListaPreciosGetPayload<{ include: typeof incluirResumen }>;

/** Proyecta una lista a su resumen de listado (sin renglones; con conteo de aprobados). */
function aResumen(lista: ListaResumenPayload): ListaPreciosResumen {
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
    renglonesAprobados: lista.lineas.filter((l) => l.precioAprobado !== null).length,
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

/** Lo que devuelve el diagnóstico: los que SÍ califican y los que no, con su motivo. */
export interface DiagnosticoCandidatos {
  candidatos: CandidatoLista[];
  descartados: DescartadoLista[];
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

  const desarrollos = await clienteLectura(bd).desarrollo.findMany({
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

  return { candidatos, descartados };
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
 * DESGLOSE de costo de un renglón (rediseño R5, §4.8): agrupa los conceptos del precosto CONGELADO del
 * renglón y suma sus importes EN EL SERVIDOR (A1 / lección F5-E7: la agregación nunca se pivotea en el
 * cliente) — Tela · Avíos · Procesos · Corte · Maquila = costo total. Para que el dueño revise "que
 * haga sentido" antes de aprobar/autorizar. Scope por empresa (A9); los importes se OCULTAN (null) sin
 * `consultas.ver-importes`. Requiere `listas.ver` (evita el cruce de permisos con `desarrollo.ver`).
 */
export async function desgloseCostoLinea(
  sesion: SesionUsuario,
  idLinea: number,
  bd?: ContextoBd,
): Promise<DesgloseCostoLinea> {
  verificarPermiso(sesion, 'listas.ver');
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const linea = await clienteLectura(bd).listaPreciosLinea.findFirst({
    where: { id: idLinea, lista: { idEmpresa: sesion.idEmpresaActiva } },
    select: {
      idPrecosto: true,
      precosto: {
        select: {
          version: true,
          costoTotal: true,
          lineas: {
            select: {
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

  // Suma por concepto (server-side): un renglón por concepto con su subtotal, ordenado por catálogo.
  const porConcepto = new Map<
    string,
    { codigo: string; nombre: string; orden: number; subtotal: number }
  >();
  for (const l of linea.precosto.lineas) {
    const c = l.conceptoCosto;
    const acc = porConcepto.get(c.codigo) ?? {
      codigo: c.codigo,
      nombre: c.nombre,
      orden: c.orden,
      subtotal: 0,
    };
    acc.subtotal += num(l.importe);
    porConcepto.set(c.codigo, acc);
  }
  const grupos = [...porConcepto.values()]
    .sort((a, b) => a.orden - b.orden)
    .map((g) => ({
      codigo: g.codigo,
      nombre: g.nombre,
      subtotal: verImportes ? redondear2(g.subtotal) : null,
    }));

  return {
    idPrecosto: linea.idPrecosto,
    versionPrecosto: linea.precosto.version,
    grupos,
    costoTotal: verImportes ? num(linea.precosto.costoTotal) : null,
  };
}
