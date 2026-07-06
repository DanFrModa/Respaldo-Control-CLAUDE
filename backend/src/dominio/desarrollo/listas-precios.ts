/**
 * LISTA DE PRECIOS por Cliente+Departamento (F8-E4, D13/R20a) — genera el precio de venta desde los
 * PRECOSTOS CONGELADOS (E3) aplicando los FACTORES del cliente, y da al dueño el flujo de aprobación.
 *
 * El sistema PROPONE `precioCalculado` (fórmula de cascada, `../costos/precio-lista.ts`) y el dueño,
 * renglón por renglón, APRUEBA ese o TECLEA otro (`precioAprobado`). Los factores se copian como
 * SNAPSHOT editable al crear la lista; editarlos recalcula TODOS los `precioCalculado` sin tocar los
 * aprobados. En E4 la lista NACE `abierta` y ahí se queda (los cambios de estado + la negociación por
 * versiones son E5).
 *
 * Innegociables aplicados:
 *  • A1 — toda la lógica vive aquí; las rutas sólo validan permiso + Zod y delegan. La aritmética del
 *    precio NO se duplica: se reutiliza `calcularPrecioLista` (`../costos/precio-lista.ts`).
 *  • A2 — cada operación multi-tabla (lista + renglones + bitácora) va en UNA transacción.
 *  • A3 — el FOLIO sale de `siguienteFolio(...,'lista-precios')` (secuencia atómica, NUNCA Max()+1).
 *  • A7 — auditoría uniforme + `Bitacora` en la misma tx.
 *  • A9 — scope por empresa activa en TODA lectura/mutación (la lista es por empresa; sus renglones
 *    cuelgan de la lista). Una lista de otra empresa, para esta sesión, no existe.
 *  • Importes ocultos (null) sin `consultas.ver-importes` — lo aplica la proyección server-side.
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
  type ListaPreciosLineaSalida,
  type ListaPreciosResumen,
  type ListaPreciosDetalle,
  type ListasPreciosQuery,
} from '../../contrato/esquemas/lista-precios.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { num, numOrNull } from '../costos/decimales.js';
import { calcularPrecioLista, type FactoresLista } from '../costos/precio-lista.js';
import { factoresANumeros, resolverFactores, validarFactores } from './cliente-factores.js';

/** Entradas tipadas de las mutaciones (forma del esquema compartido). */
export type EntradaCrearLista = z.input<typeof esquemaListaPreciosCrear>;
export type EntradaEditarFactoresLista = z.input<typeof esquemaListaFactoresEditar>;
export type EntradaAjustarPrecio = z.input<typeof esquemaAjustarPrecioLinea>;

/** Parámetros del listado = el querystring del contrato (reutilizado por la ruta REST). */
export type FiltrosListas = ListasPreciosQuery;

/** Namespace del `pg_advisory_xact_lock` que serializa el recálculo de factores por lista. */
const NAMESPACE_LOCK_LISTA = 20_542;

/**
 * Namespace del `pg_advisory_xact_lock` que serializa la CREACIÓN de listas por EMPRESA. Sostiene la
 * invariante "un desarrollo vive en A LO MÁS UNA lista": sin él, dos `crearLista` concurrentes con el
 * mismo desarrollo (READ COMMITTED) leerían ambos `listaLineas = 0` y ambos insertarían (el
 * `@@unique([idLista, idDesarrollo])` sólo impide el duplicado DENTRO de una lista, no entre listas).
 * Crear listas es infrecuente, así que serializar por empresa es aceptable.
 *
 * TODO(E5): cuando E5 toque la migración de estas tablas, blindar la invariante a nivel BD con
 * `@@unique([idDesarrollo])` en `lista_precios_linea` (un desarrollo en a lo más una lista) — defensa
 * en profundidad que vuelve el lock una optimización, no la única barrera.
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
          modelo: { select: { codigo: true, descripcion: true } },
        },
      },
      precosto: { select: { version: true } },
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
  };
}

/** `YYYY-MM-DD` de un `Date` (columna @db.Date). Solo el día calendario importa. */
function aFechaCorta(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Proyecta una lista COMPLETA (con renglones) a la salida del contrato. */
function aListaSalida(lista: ListaConDetalle, verImportes: boolean): ListaPreciosDetalle {
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
    margenPct: verImportes ? lista.margenPct.toNumber() : null,
    descuentosPct: verImportes ? lista.descuentosPct.toNumber() : null,
    regaliasPct: verImportes ? lista.regaliasPct.toNumber() : null,
    costoVentasPct: verImportes ? lista.costoVentasPct.toNumber() : null,
    notas: lista.notas,
    lineas: lista.lineas.map((l) => aLineaSalida(l, verImportes)),
    creadoEn: lista.creadoEn.toISOString(),
    creadoPorId: lista.creadoPorId,
    modificadoEn: lista.modificadoEn.toISOString(),
    modificadoPorId: lista.modificadoPorId,
  };
}

// ── Helpers de existencia / locks ─────────────────────────────────────────────────────

/** Lista de la EMPRESA ACTIVA (A9), o `ErrorNoEncontrado`. */
async function exigirLista(
  tx: Tx,
  id: number,
  idEmpresa: number,
): Promise<{ id: number; idEstadoLista: number }> {
  const lista = await tx.listaPrecios.findFirst({
    where: { id, idEmpresa },
    select: { id: true, idEstadoLista: true },
  });
  if (lista === null) {
    throw new ErrorNoEncontrado('Lista de precios', id);
  }
  return lista;
}

/** Renglón cuya lista es de la empresa activa (A9), con el id de su lista y el precio calculado. */
async function exigirLineaDeEmpresa(
  tx: Tx,
  idLinea: number,
  idEmpresa: number,
): Promise<{ id: number; idLista: number; precioCalculado: Prisma.Decimal }> {
  const linea = await tx.listaPreciosLinea.findFirst({
    where: { id: idLinea, lista: { idEmpresa } },
    select: { id: true, idLista: true, precioCalculado: true },
  });
  if (linea === null) {
    throw new ErrorNoEncontrado('Renglón de lista de precios', idLinea);
  }
  return linea;
}

// ── Crear lista ─────────────────────────────────────────────────────────────────────

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
        precostos: {
          where: { estado: 'congelado' },
          orderBy: { version: 'desc' },
          take: 1,
          select: { id: true, costoTotal: true },
        },
        // Un desarrollo va en A LO MÁS UNA lista (mismo invariante que `candidatosParaLista`): si ya
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
      if (d.apagado) {
        problemas.push(`${d.modelo.codigo}: está apagado`);
        continue;
      }
      if (d.precostos.length === 0) {
        problemas.push(`${d.modelo.codigo}: no tiene un precosto congelado`);
        continue;
      }
      if (d.listaLineas.length > 0) {
        problemas.push(`${d.modelo.codigo}: ya está en otra lista de precios`);
      }
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
      const precosto = porId.get(id)?.precostos[0];
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
 * EDITA el snapshot de factores de la lista y RECALCULA el `precioCalculado` de TODOS sus renglones,
 * SIN tocar los `precioAprobado` (la aprobación del dueño se respeta). Serializado por advisory lock
 * por lista (evita recálculos concurrentes que se pisen). Requiere `listas.administrar`.
 */
export async function editarFactoresLista(
  sesion: SesionUsuario,
  idLista: number,
  entrada: EntradaEditarFactoresLista,
  bd?: ContextoBd,
): Promise<ListaPreciosDetalle> {
  verificarPermiso(sesion, 'listas.administrar');
  const datos: DatosListaFactoresEditar = validarEntrada(esquemaListaFactoresEditar, entrada);
  validarFactores(datos);

  await enTransaccion(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_LISTA}::int, ${idLista}::int)`;
    await exigirLista(tx, idLista, sesion.idEmpresaActiva);
    // TODO(E5): antes de habilitar transiciones de estado, E5 DEBE agregar aquí el guard de `esCierre`
    // (no editar factores/recalcular sobre una lista en estado de cierre). En E4 la lista siempre está
    // `abierta`, así que hoy es inalcanzable.

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

    // Recalcula precioCalculado por renglón (depende de su costoUnit). Nunca toca precioAprobado.
    const renglones = await tx.listaPreciosLinea.findMany({
      where: { idLista },
      select: { id: true, costoUnit: true },
    });
    for (const renglon of renglones) {
      await tx.listaPreciosLinea.update({
        where: { id: renglon.id },
        data: {
          precioCalculado: calcularPrecioLista(num(renglon.costoUnit), datos),
          ...datosModificacion(sesion),
        },
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'ListaPrecios',
      idEntidad: idLista,
      accion: 'MODIFICAR',
      datos: { operacion: 'editar-factores', renglones: renglones.length },
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
    const linea = await exigirLineaDeEmpresa(tx, idLinea, sesion.idEmpresaActiva);
    // TODO(E5): antes de habilitar transiciones de estado, E5 DEBE agregar aquí el guard de `esCierre`
    // (no aprobar sobre una lista en estado de cierre). En E4 la lista siempre está `abierta`.
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
    const linea = await exigirLineaDeEmpresa(tx, idLinea, sesion.idEmpresaActiva);
    // TODO(E5): antes de habilitar transiciones de estado, E5 DEBE agregar aquí el guard de `esCierre`
    // (no teclear precio sobre una lista en estado de cierre). En E4 la lista siempre está `abierta`.
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
  return aListaSalida(lista, tienePermiso(sesion, 'consultas.ver-importes'));
}

/**
 * CANDIDATOS para una lista: desarrollos "cotizados" (≥1 precosto congelado) de ese cliente+
 * departamento de la empresa activa (A9), NO apagados y SIN renglón en ninguna lista. Para el diálogo
 * de crear. Requiere `listas.ver`.
 */
export async function candidatosParaLista(
  sesion: SesionUsuario,
  parametros: { idCliente: number; idClienteDepartamento: number },
  bd?: ContextoBd,
): Promise<CandidatoLista[]> {
  verificarPermiso(sesion, 'listas.ver');
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const desarrollos = await clienteLectura(bd).desarrollo.findMany({
    where: {
      apagado: false,
      proyecto: {
        idEmpresa: sesion.idEmpresaActiva,
        idCliente: parametros.idCliente,
        idClienteDepartamento: parametros.idClienteDepartamento,
      },
      precostos: { some: { estado: 'congelado' } },
      listaLineas: { none: {} },
    },
    select: {
      id: true,
      numeroCliente: true,
      idProyecto: true,
      proyecto: { select: { folio: true, nombre: true } },
      modelo: { select: { codigo: true, descripcion: true } },
      precostos: {
        where: { estado: 'congelado' },
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true, version: true, costoTotal: true },
      },
    },
    orderBy: { id: 'asc' },
  });

  return desarrollos.map((d): CandidatoLista => {
    const precosto = d.precostos[0];
    return {
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
    };
  });
}
