/**
 * Pedidos internos — Módulo PEDIDOS (F2-E1): el compromiso con el cliente del que salen las
 * órdenes de producción (doc `Documentacion_MJD/02-Pedidos.md` §1-2). CRUD del `Pedido` +
 * sus renglones (`PedidoLinea`), copiar un pedido y cancelarlo (suave).
 *
 * Innegociables aplicados:
 *  • A1 — toda la lógica vive aquí; las rutas solo validan permiso + Zod y delegan.
 *  • A2 — encabezado + renglones en UNA transacción (`enTransaccion`): crear/editar/copiar/
 *    crear-pedido-real son atómicos (o queda todo, o nada). Corrige el viejo, que insertaba el
 *    encabezado y luego los renglones sin transacción.
 *  • A3/A9 — el `folio` sale de la secuencia atómica `"pedido"` POR EMPRESA (`siguienteFolio`);
 *    NUNCA `Max()+1` (sustituye `AumentarNumPed`, doc 02 §6.1). El folio es por empresa de la
 *    sesión activa.
 *  • A7 — auditoría uniforme: `creadoPorId`/`modificadoPorId` + `Bitacora` en la misma tx.
 *  • Cancelación SUAVE (`pedCancelado`): el pedido nunca se borra; sigue consultable (doc 02 §4.2).
 *
 * Ocultamiento de IMPORTES (doc 02 §3): la proyección a la salida pone `precio`/`importe` en
 * `null` cuando la sesión NO tiene `pedidos.importes`. Se decide en el backend (serialización),
 * NO con CSS — el JSON que viaja NO trae los importes.
 */
import {
  esquemaPedidoCrear,
  esquemaPedidoEditar,
  esquemaPedidoCopiarCuerpo,
} from '../../contrato/esquemas/pedido.js';
import type {
  DatosPedidoLineaEntrada,
  PedidoLineaSalida,
  PedidoSalida,
} from '../../contrato/esquemas/pedido.js';
import type { Pedido, PedidoLinea, Prisma } from '../../datos/index.js';
import { z } from 'zod';

import { servicioArchivos, type ServicioArchivos } from '../../comun/archivos.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  armarPagina,
  esquemaPaginacion,
  rangoPrisma,
  type Pagina,
} from '../../comun/paginacion.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Clave de la secuencia de folios de pedidos (A3 — por empresa). */
export const CLAVE_SECUENCIA_PEDIDO = 'pedido';

/** Alta: campos del esquema compartido (la empresa la pone el dominio desde la sesión). */
export type EntradaCrearPedido = z.input<typeof esquemaPedidoCrear>;
/** Edición: `id` + cambios parciales (+ set de renglones opcional). */
export type EntradaActualizarPedido = z.input<typeof esquemaPedidoEditar>;

/**
 * Parámetros del listado con tipos NATIVOS (la ruta ya coaccionó la querystring; el dominio
 * re-valida con tipos nativos, no string — mismo patrón que `clientes.ts`). NO se reusa el
 * esquema del contrato (que coacciona desde texto) para que la ruta pueda pasar el
 * `request.query` ya parseado sin chocar de tipos.
 */
const esquemaListarPedidosDominio = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(200).optional(),
  idCliente: z.number().int().positive().optional(),
  incluirCancelados: z.boolean().default(false),
  ordenarPor: z.enum(['folio', 'fechaPedido', 'creadoEn']).default('folio'),
  direccion: z.enum(['asc', 'desc']).default('desc'),
});

/** Parámetros del listado (los reutiliza la ruta REST). */
export type ParametrosListarPedidos = z.input<typeof esquemaListarPedidosDominio>;

/**
 * Pedido con su cliente, sus renglones (con el modelo de cada uno) y la foto principal del
 * modelo resuelta para la UI. Es la forma que arma el dominio antes de proyectar a la salida.
 */
type PedidoConDetalle = Pedido & {
  cliente: { nombre: string };
  lineas: (PedidoLinea & {
    modelo: { codigo: string; descripcion: string | null };
    urlFotoModelo?: string | null;
  })[];
};

/** `include` estándar para traer el cliente y los renglones (con su modelo, ordenados por id). */
const incluirDetalle = {
  cliente: { select: { nombre: true } },
  lineas: {
    orderBy: { id: 'asc' },
    include: { modelo: { select: { codigo: true, descripcion: true } } },
  },
} satisfies Prisma.PedidoInclude;

// ── Helpers de existencia/validación ──────────────────────────────────────────────

/**
 * Busca un pedido de la EMPRESA ACTIVA por id, o lanza `ErrorNoEncontrado` (un pedido de otra
 * empresa, para esta sesión, no existe — A9). Lo usan obtener/editar/copiar/cancelar.
 */
async function exigirPedido(tx: Tx, id: number, idEmpresa: number): Promise<Pedido> {
  const pedido = await tx.pedido.findFirst({ where: { id, idEmpresa } });
  if (pedido === null) {
    throw new ErrorNoEncontrado('Pedido', id);
  }
  return pedido;
}

/** Exige que el cliente exista y esté ACTIVO (no se le hacen pedidos a un cliente desactivado). */
async function exigirClienteActivo(tx: Tx, idCliente: number): Promise<void> {
  const cliente = await tx.cliente.findUnique({
    where: { id: idCliente },
    select: { activo: true, nombre: true },
  });
  if (cliente === null) {
    throw new ErrorNoEncontrado('Cliente', idCliente);
  }
  if (!cliente.activo) {
    throw new ErrorConflicto(
      `El cliente "${cliente.nombre}" está desactivado; reactívalo para hacerle pedidos.`,
    );
  }
}

/**
 * Exige que TODOS los modelos de los renglones existan y estén ACTIVOS (no se piden modelos
 * descontinuados). Una sola consulta para todo el set. Lanza con el primer modelo problemático.
 */
async function exigirModelosActivos(tx: Tx, idsModelo: number[]): Promise<void> {
  if (idsModelo.length === 0) {
    return;
  }
  const unicos = [...new Set(idsModelo)];
  const modelos = await tx.modelo.findMany({
    where: { id: { in: unicos } },
    select: { id: true, activo: true, codigo: true },
  });
  const porId = new Map(modelos.map((m) => [m.id, m]));
  for (const id of unicos) {
    const modelo = porId.get(id);
    if (modelo === undefined) {
      throw new ErrorNoEncontrado('Modelo', id);
    }
    if (!modelo.activo) {
      throw new ErrorConflicto(
        `El modelo "${modelo.codigo}" está descontinuado; no se puede pedir.`,
      );
    }
  }
}

// ── Sincronización del set de renglones (diff mínimo, conserva auditoría) ──────────

/**
 * Sincroniza los renglones de un pedido al `set` deseado en la transacción (A2), conservando
 * la auditoría de los renglones que no cambian (diff mínimo, como el grid de colores de la
 * tela en F1-E3). Renglones con `id` que existan se ACTUALIZAN; los nuevos (sin `id`) se
 * CREAN; los que ya no están en el set se BORRAN físico (un renglón sin órdenes/pedidos
 * reales aún; el Restrict de `PedidoRealLinea` impide borrar uno con seguimiento, traducido a
 * `ErrorConflicto`).
 *
 * 🔑 Regla de IMPORTES server-side (doc 02 §3 — defensa A1 que también cierra el hueco vía API
 * directa): si la sesión NO puede ver importes (`pedidos.importes`), al ACTUALIZAR un renglón
 * EXISTENTE el `precio` entrante se IGNORA y se conserva el almacenado (el usuario no vio el
 * precio real, no puede pisarlo con un valor falso). En un renglón NUEVO, sin precio entrante,
 * se usa 0 por defecto (es un alta, no una sobrescritura). Un usuario CON el permiso sí puede
 * cambiar el precio; si lo omite en un renglón existente, también se conserva el almacenado.
 */
async function sincronizarLineas(
  tx: Tx,
  sesion: SesionUsuario,
  idPedido: number,
  set: DatosPedidoLineaEntrada[],
  puedeVerImportes: boolean,
): Promise<void> {
  await exigirModelosActivos(
    tx,
    set.map((l) => l.idModelo),
  );

  const actuales = await tx.pedidoLinea.findMany({
    where: { idPedido },
    select: { id: true },
  });
  const idsActuales = new Set(actuales.map((l) => l.id));
  const idsDeseados = new Set(set.filter((l) => l.id !== undefined).map((l) => l.id as number));

  // Renglones a borrar: están en BD pero no en el set deseado.
  const aBorrar = [...idsActuales].filter((id) => !idsDeseados.has(id));
  if (aBorrar.length > 0) {
    try {
      await tx.pedidoLinea.deleteMany({ where: { id: { in: aBorrar }, idPedido } });
    } catch (error) {
      throw new ErrorConflicto(
        'No se puede quitar un renglón que ya tiene seguimiento de pedidos reales. Cancela o ajusta el pedido real primero.',
        { causa: error },
      );
    }
  }

  for (const linea of set) {
    if (linea.id !== undefined && idsActuales.has(linea.id)) {
      // Precio del renglón EXISTENTE: solo se toca si la sesión puede ver importes Y lo mandó.
      // Si no puede ver importes (o lo omitió), NO se incluye en el `data` → se conserva el
      // precio almacenado (nunca un 0 falso encima del precio real).
      const cambios: Prisma.PedidoLineaUncheckedUpdateInput = {
        idModelo: linea.idModelo,
        cantidadPedida: linea.cantidadPedida,
        ...datosModificacion(sesion),
      };
      if (puedeVerImportes && linea.precio !== undefined) {
        cambios.precio = linea.precio;
      }
      await tx.pedidoLinea.update({ where: { id: linea.id }, data: cambios });
    } else {
      // Renglón NUEVO: sin precio entrante (p. ej. usuario sin importes) se usa 0 por defecto.
      await tx.pedidoLinea.create({
        data: {
          idPedido,
          idModelo: linea.idModelo,
          cantidadPedida: linea.cantidadPedida,
          precio: linea.precio ?? 0,
          ...datosCreacion(sesion),
        },
      });
    }
  }
}

// ── Proyección a la salida (con ocultamiento de importes server-side) ──────────────

/**
 * Proyecta un pedido (con detalle) a la forma JSON del contrato. `puedeVerImportes` decide si
 * `precio`/`importe`/`totalImporte` salen con su valor o en `null` (ocultamiento server-side,
 * doc 02 §3 — el JSON NO trae los importes si no tiene permiso). Las fechas date-only salen
 * como `YYYY-MM-DD`.
 */
function aPedidoSalida(pedido: PedidoConDetalle, puedeVerImportes: boolean): PedidoSalida {
  let totalPiezas = 0;
  let totalImporte = 0;
  const lineas: PedidoLineaSalida[] = pedido.lineas.map((l) => {
    const precio = l.precio.toNumber();
    const importe = l.cantidadPedida * precio;
    totalPiezas += l.cantidadPedida;
    totalImporte += importe;
    return {
      id: l.id,
      idModelo: l.idModelo,
      codigoModelo: l.modelo.codigo,
      descripcionModelo: l.modelo.descripcion,
      urlFotoModelo: l.urlFotoModelo ?? null,
      cantidadPedida: l.cantidadPedida,
      precio: puedeVerImportes ? precio : null,
      importe: puedeVerImportes ? importe : null,
      entregadoParcialV1: l.entregadoParcialV1,
      cantFaltanteV1: l.cantFaltanteV1,
    };
  });

  return {
    id: pedido.id,
    folio: Number(pedido.folio),
    idEmpresa: pedido.idEmpresa,
    idCliente: pedido.idCliente,
    cliente: pedido.cliente.nombre,
    fechaPedido: aFechaIso(pedido.fechaPedido),
    fechaDe: aFechaIso(pedido.fechaDe),
    fechaHasta: aFechaIso(pedido.fechaHasta),
    fechaTela: aFechaIso(pedido.fechaTela),
    fechaElaboracion: aFechaIso(pedido.fechaElaboracion),
    entregadoTienda: pedido.entregadoTienda,
    noProducir: pedido.noProducir,
    pedCancelado: pedido.pedCancelado,
    idOrdCompraV1: pedido.idOrdCompraV1,
    totalPiezas,
    totalImporte: puedeVerImportes ? totalImporte : null,
    lineas,
    creadoEn: pedido.creadoEn.toISOString(),
    creadoPorId: pedido.creadoPorId,
    modificadoEn: pedido.modificadoEn.toISOString(),
    modificadoPorId: pedido.modificadoPorId,
  };
}

/** Convierte un `DateTime @db.Date` de Prisma a `YYYY-MM-DD`, o `null`. */
function aFechaIso(fecha: Date | null): string | null {
  if (fecha === null) {
    return null;
  }
  // `@db.Date` viene a medianoche UTC; el slice de la parte de fecha de la ISO es estable.
  return fecha.toISOString().slice(0, 10);
}

/** Convierte un `YYYY-MM-DD` (o null/undefined) al `Date` que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string | null | undefined): Date | null | undefined {
  if (valor === undefined) {
    return undefined;
  }
  if (valor === null) {
    return null;
  }
  return new Date(`${valor}T00:00:00.000Z`);
}

/**
 * Resuelve la URL prefirmada de la foto PRINCIPAL del modelo de cada renglón (sin N+1): una
 * sola consulta a `modeloFoto` para todos los modelos de los renglones, y las URLs en
 * paralelo. La principal es la primera por `orden` (luego `id`), igual que la galería.
 */
async function adjuntarFotosModelo(
  cliente: ReturnType<typeof clienteLectura>,
  pedido: PedidoConDetalle,
  archivos: ServicioArchivos,
): Promise<PedidoConDetalle> {
  const idsModelo = [...new Set(pedido.lineas.map((l) => l.idModelo))];
  if (idsModelo.length === 0) {
    return pedido;
  }
  const fotos = await cliente.modeloFoto.findMany({
    where: { idModelo: { in: idsModelo } },
    orderBy: [{ orden: 'asc' }, { id: 'asc' }],
    select: { idModelo: true, archivo: { select: { key: true } } },
  });
  const keyPorModelo = new Map<number, string>();
  for (const foto of fotos) {
    if (!keyPorModelo.has(foto.idModelo)) {
      keyPorModelo.set(foto.idModelo, foto.archivo.key);
    }
  }
  const urlPorModelo = new Map<number, string>(
    await Promise.all(
      [...keyPorModelo.entries()].map(
        async ([idModelo, key]): Promise<[number, string]> => [
          idModelo,
          await archivos.urlDescarga(key),
        ],
      ),
    ),
  );
  return {
    ...pedido,
    lineas: pedido.lineas.map((l) => ({
      ...l,
      urlFotoModelo: urlPorModelo.get(l.idModelo) ?? null,
    })),
  };
}

// ── Operaciones ───────────────────────────────────────────────────────────────────

/**
 * Crea un pedido interno (encabezado + renglones) en UNA transacción (A2). Toma el folio de la
 * secuencia atómica `"pedido"` de la empresa activa (A3/A9). Valida que el cliente esté activo
 * y que los modelos de los renglones existan y estén activos. Auditoría + bitácora en la tx.
 */
export async function crearPedido(
  sesion: SesionUsuario,
  entrada: EntradaCrearPedido,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<PedidoSalida> {
  verificarPermiso(sesion, 'pedidos.administrar');
  const datos = validarEntrada(esquemaPedidoCrear, entrada);
  const puedeVerImportes = tienePermiso(sesion, 'pedidos.importes');

  const idPedido = await enTransaccion(async (tx) => {
    await exigirClienteActivo(tx, datos.idCliente);
    const folio = await siguienteFolio(tx, sesion.idEmpresaActiva, CLAVE_SECUENCIA_PEDIDO);

    const pedido = await tx.pedido.create({
      data: {
        folio,
        idEmpresa: sesion.idEmpresaActiva,
        idCliente: datos.idCliente,
        fechaPedido: aDateColumna(datos.fechaPedido) ?? null,
        fechaDe: aDateColumna(datos.fechaDe) ?? null,
        fechaHasta: aDateColumna(datos.fechaHasta) ?? null,
        fechaTela: aDateColumna(datos.fechaTela) ?? null,
        fechaElaboracion: aDateColumna(datos.fechaElaboracion) ?? null,
        entregadoTienda: datos.entregadoTienda,
        noProducir: datos.noProducir,
        ...datosCreacion(sesion),
      },
    });

    await sincronizarLineas(tx, sesion, pedido.id, datos.lineas, puedeVerImportes);

    await registrarBitacora(tx, sesion, {
      entidad: 'Pedido',
      idEntidad: pedido.id,
      accion: 'CREAR',
      datos: { folio: Number(folio), idCliente: datos.idCliente, renglones: datos.lineas.length },
    });

    return pedido.id;
  }, bd);

  return obtenerPedido(sesion, idPedido, bd, archivos);
}

/**
 * Actualiza un pedido interno: encabezado (cliente/fechas/banderas) y, si `lineas` viene, el
 * SET COMPLETO de renglones (sincroniza), todo en UNA transacción (A2). No se puede editar un
 * pedido cancelado (reactívalo conceptualmente no aplica: la cancelación es definitiva-suave).
 */
export async function actualizarPedido(
  sesion: SesionUsuario,
  entrada: EntradaActualizarPedido,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<PedidoSalida> {
  verificarPermiso(sesion, 'pedidos.administrar');
  const datos = validarEntrada(esquemaPedidoEditar, entrada);
  const puedeVerImportes = tienePermiso(sesion, 'pedidos.importes');

  await enTransaccion(async (tx) => {
    const actual = await exigirPedido(tx, datos.id, sesion.idEmpresaActiva);
    if (actual.pedCancelado) {
      throw new ErrorConflicto('El pedido está cancelado; no se puede modificar.');
    }

    if (datos.idCliente !== undefined && datos.idCliente !== actual.idCliente) {
      await exigirClienteActivo(tx, datos.idCliente);
    }

    const cambios: Prisma.PedidoUpdateInput = { ...datosModificacion(sesion) };
    if (datos.idCliente !== undefined) {
      cambios.cliente = { connect: { id: datos.idCliente } };
    }
    aplicarFecha(cambios, 'fechaPedido', aDateColumna(datos.fechaPedido));
    aplicarFecha(cambios, 'fechaDe', aDateColumna(datos.fechaDe));
    aplicarFecha(cambios, 'fechaHasta', aDateColumna(datos.fechaHasta));
    aplicarFecha(cambios, 'fechaTela', aDateColumna(datos.fechaTela));
    aplicarFecha(cambios, 'fechaElaboracion', aDateColumna(datos.fechaElaboracion));
    if (datos.entregadoTienda !== undefined) cambios.entregadoTienda = datos.entregadoTienda;
    if (datos.noProducir !== undefined) cambios.noProducir = datos.noProducir;

    await tx.pedido.update({ where: { id: datos.id }, data: cambios });

    if (datos.lineas !== undefined) {
      await sincronizarLineas(tx, sesion, datos.id, datos.lineas, puedeVerImportes);
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Pedido',
      idEntidad: datos.id,
      accion: 'MODIFICAR',
      datos: {
        ...(datos.idCliente !== undefined ? { idCliente: datos.idCliente } : {}),
        ...(datos.lineas !== undefined ? { renglones: datos.lineas.length } : {}),
      },
    });
  }, bd);

  return obtenerPedido(sesion, datos.id, bd, archivos);
}

/** Aplica una fecha al `update` solo si vino (`undefined` = no tocar; `null` = vaciar). */
function aplicarFecha(
  cambios: Prisma.PedidoUpdateInput,
  campo: 'fechaPedido' | 'fechaDe' | 'fechaHasta' | 'fechaTela' | 'fechaElaboracion',
  valor: Date | null | undefined,
): void {
  if (valor !== undefined) {
    cambios[campo] = valor;
  }
}

/**
 * Copia un pedido en uno NUEVO (doc 02 §4.3): mismo cliente y fechas, folio NUEVO de la
 * secuencia (A3 — NO se replica la rareza `NumeroPed=0` del viejo), y SOLO los renglones
 * seleccionados (`idLineas`; vacío/omitido = todos), en UNA transacción. El nuevo pedido nace
 * activo y SIN pedidos reales.
 */
export async function copiarPedido(
  sesion: SesionUsuario,
  idOrigen: number,
  cuerpo: z.input<typeof esquemaPedidoCopiarCuerpo> = {},
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<PedidoSalida> {
  verificarPermiso(sesion, 'pedidos.administrar');
  const datos = validarEntrada(esquemaPedidoCopiarCuerpo, cuerpo);

  const idNuevo = await enTransaccion(async (tx) => {
    const origen = await tx.pedido.findFirst({
      where: { id: idOrigen, idEmpresa: sesion.idEmpresaActiva },
      include: { lineas: { orderBy: { id: 'asc' } } },
    });
    if (origen === null) {
      throw new ErrorNoEncontrado('Pedido', idOrigen);
    }

    // Renglones a copiar: los seleccionados (validando que pertenezcan al pedido) o todos.
    let lineasOrigen = origen.lineas;
    if (datos.idLineas !== undefined && datos.idLineas.length > 0) {
      const seleccion = new Set(datos.idLineas);
      lineasOrigen = origen.lineas.filter((l) => seleccion.has(l.id));
      if (lineasOrigen.length !== seleccion.size) {
        throw new ErrorValidacion('Alguno de los renglones a copiar no pertenece a este pedido.');
      }
    }

    const folio = await siguienteFolio(tx, sesion.idEmpresaActiva, CLAVE_SECUENCIA_PEDIDO);
    const nuevo = await tx.pedido.create({
      data: {
        folio,
        idEmpresa: sesion.idEmpresaActiva,
        idCliente: origen.idCliente,
        fechaPedido: origen.fechaPedido,
        fechaDe: origen.fechaDe,
        fechaHasta: origen.fechaHasta,
        fechaTela: origen.fechaTela,
        fechaElaboracion: origen.fechaElaboracion,
        ...datosCreacion(sesion),
      },
    });

    if (lineasOrigen.length > 0) {
      await tx.pedidoLinea.createMany({
        data: lineasOrigen.map((l) => ({
          idPedido: nuevo.id,
          idModelo: l.idModelo,
          cantidadPedida: l.cantidadPedida,
          precio: l.precio,
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        })),
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Pedido',
      idEntidad: nuevo.id,
      accion: 'CREAR',
      datos: { copiadoDe: idOrigen, folio: Number(folio), renglones: lineasOrigen.length },
    });

    return nuevo.id;
  }, bd);

  return obtenerPedido(sesion, idNuevo, bd, archivos);
}

/**
 * Cancela un pedido (cancelación SUAVE, doc 02 §4.2): pone `pedCancelado = true` + bitácora
 * `CANCELAR`. El pedido sigue consultable. Cancelar dos veces es `ErrorConflicto`.
 */
export async function cancelarPedido(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<PedidoSalida> {
  verificarPermiso(sesion, 'pedidos.administrar');

  await enTransaccion(async (tx) => {
    const actual = await exigirPedido(tx, id, sesion.idEmpresaActiva);
    if (actual.pedCancelado) {
      throw new ErrorConflicto(`El pedido ${Number(actual.folio)} ya está cancelado.`);
    }
    await tx.pedido.update({
      where: { id },
      data: { pedCancelado: true, ...datosModificacion(sesion) },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Pedido',
      idEntidad: id,
      accion: 'CANCELAR',
      datos: { folio: Number(actual.folio) },
    });
  }, bd);

  return obtenerPedido(sesion, id, bd, archivos);
}

/** Obtiene un pedido (con cliente, renglones y fotos de modelo) o lanza `ErrorNoEncontrado`. */
export async function obtenerPedido(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<PedidoSalida> {
  verificarPermiso(sesion, 'pedidos.ver');
  const cliente = clienteLectura(bd);
  const pedido = await cliente.pedido.findFirst({
    where: { id, idEmpresa: sesion.idEmpresaActiva },
    include: incluirDetalle,
  });
  if (pedido === null) {
    throw new ErrorNoEncontrado('Pedido', id);
  }
  const conFotos = await adjuntarFotosModelo(cliente, pedido, archivos);
  return aPedidoSalida(conFotos, tienePermiso(sesion, 'pedidos.importes'));
}

/**
 * Lista pedidos de la empresa activa (A9) con búsqueda (folio o cliente), filtro por cliente,
 * orden y paginación EN SERVIDOR. Por defecto NO incluye los cancelados. Cada pedido trae sus
 * renglones embebidos (con la foto del modelo). El ocultamiento de importes aplica por pedido.
 */
export async function listarPedidos(
  sesion: SesionUsuario,
  parametros: ParametrosListarPedidos = {},
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<Pagina<PedidoSalida>> {
  verificarPermiso(sesion, 'pedidos.ver');
  const filtros = validarEntrada(esquemaListarPedidosDominio, parametros);
  const puedeVerImportes = tienePermiso(sesion, 'pedidos.importes');

  const busquedaFolio = aFolioBusqueda(filtros.busqueda);
  const where: Prisma.PedidoWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    ...(filtros.incluirCancelados ? {} : { pedCancelado: false }),
    ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : {
          OR: [
            { cliente: { nombre: { contains: filtros.busqueda, mode: 'insensitive' } } },
            ...(busquedaFolio === null ? [] : [{ folio: busquedaFolio }]),
          ],
        }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.pedido.count({ where }),
    cliente.pedido.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: incluirDetalle,
      ...rangoPrisma(filtros),
    }),
  ]);

  const conFotos = await Promise.all(datos.map((p) => adjuntarFotosModelo(cliente, p, archivos)));
  const salida = conFotos.map((p) => aPedidoSalida(p, puedeVerImportes));
  return armarPagina(salida, total, filtros);
}

/** Si la búsqueda es un entero, devuelve el `bigint` para filtrar por folio; si no, `null`. */
function aFolioBusqueda(busqueda: string | undefined): bigint | null {
  if (busqueda === undefined || !/^\d+$/.test(busqueda.trim())) {
    return null;
  }
  try {
    return BigInt(busqueda.trim());
  } catch {
    return null;
  }
}
