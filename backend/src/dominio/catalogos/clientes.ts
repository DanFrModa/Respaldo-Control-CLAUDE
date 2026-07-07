/**
 * Clientes — catálogo maestro GLOBAL (F1-E2, PIEZA C) con campos de referencia (D7).
 *
 * El sistema viejo solo tiene `IdClientes/Cliente/Activo` (doc `02-Pedidos.md` §2;
 * tabla `Clientes.csv`). v2 (PLANMAESTRO §4) lo enriquece en dos frentes:
 *  • Contacto básico (contacto/teléfono/email/dirección), todos opcionales.
 *  • DEFINICIÓN de campos de referencia POR cliente (D7 — `DECISIONES.md` D7): cada
 *    cliente declara SUS campos (p. ej. "No. de pedido del cliente"), que en el viejo
 *    eran el campo reutilizado `Monarch`. Aquí va SOLO la definición (etiqueta + tipo +
 *    orden); los VALORES se capturan por orden en F2 (`OrdenReferencia`).
 *
 * Como Proveedor (maestro con hijos, `proveedores.ts`): catálogo global SIN `idEmpresa`
 * (ADR-0007, A9 — unicidad de `nombre` global `@unique`). Cada operación va en UNA
 * transacción (A2) con auditoría (A7) + `Bitacora` juntos o nada; borrado SUAVE
 * reversible (`activo`); unicidad validada en la transacción y respaldada por el unique
 * de la base (P2002 → `ErrorConflicto`).
 *
 * Reglas D7 (PLANMAESTRO §4):
 *  • `etiqueta` de un campo es ÚNICA DENTRO del cliente (índice `@@unique([idCliente,
 *    etiqueta])`); el mensaje al duplicar es claro.
 *  • Cada operación de campo exige que el cliente exista y esté ACTIVO (no se editan
 *    campos de un cliente desactivado).
 *  • Borrado SUAVE del campo (`activo`): en F1 un campo aún no tiene valores. **Regla
 *    para F2:** cuando un `ClienteCampo` tenga valores capturados (en `OrdenReferencia`)
 *    NO se borrará físico — solo se desactivará (`activo=false`), para no perder el
 *    histórico de pedidos. Esa restricción se implementará en F2 junto con la captura
 *    de valores; aquí se documenta y el borrado ya es suave por diseño.
 */
import {
  esquemaClienteCampoCrear,
  esquemaClienteCampoEditar,
  esquemaClienteCrear,
  esquemaClienteEditar,
} from '../../contrato/index.js';
import type { Cliente, ClienteCampo, Prisma } from '../../datos/index.js';
import { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import {
  armarPagina,
  esquemaPaginacion,
  rangoPrisma,
  type Pagina,
} from '../../comun/paginacion.js';
import { idsPorNombreSinAcentos } from '../../comun/busqueda.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Alta: campos del esquema compartido (catálogo global, sin `idEmpresa`). */
export type EntradaCrearCliente = z.input<typeof esquemaClienteCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarCliente = z.input<typeof esquemaClienteEditar>;

/** Cliente con sus campos de referencia cargados (forma que consume la ruta para la salida). */
export type ClienteConCampos = Cliente & { campos: ClienteCampo[] };

/**
 * `include` estándar para traer los campos de referencia (ordenados por `orden`, luego
 * `id` para un orden estable ante empates) junto al cliente. Lo usan tanto `obtener`
 * como `listar`: igual que Proveedor embebe sus roles, el cliente embebe sus campos en
 * la salida (la lista pagina ≤100 filas, así el join es barato y evita un N+1 en la UI).
 */
const incluirCampos = {
  campos: { orderBy: [{ orden: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ClienteInclude;

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export const esquemaListarClientes = esquemaPaginacion.extend({
  /** Texto a buscar en el nombre (insensible a mayúsculas). */
  busqueda: z.string().trim().max(200).optional(),
  /** Por omisión solo activos; `true` muestra también los desactivados. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarClientes = z.input<typeof esquemaListarClientes>;

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos clientes con el mismo
 * nombre, sin importar mayúsculas ("Liverpool" ≡ "liverpool"). Se valida DENTRO de la
 * transacción; la carrera residual la captura el unique de la base (P2002 →
 * `ErrorConflicto`).
 */
async function exigirNombreLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.cliente.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un cliente llamado "${nombre}".`
        : `Ya existe un cliente llamado "${nombre}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un cliente por id o lanza `ErrorNoEncontrado`. */
async function exigirCliente(tx: Tx, id: number): Promise<Cliente> {
  const cliente = await tx.cliente.findUnique({ where: { id } });
  if (cliente === null) {
    throw new ErrorNoEncontrado('Cliente', id);
  }
  return cliente;
}

/**
 * Busca un cliente ACTIVO por id (para operar sus campos): no se editan campos de un
 * cliente desactivado. Lanza `ErrorNoEncontrado` si no existe, `ErrorConflicto` si está
 * desactivado.
 */
async function exigirClienteActivo(tx: Tx, id: number): Promise<Cliente> {
  const cliente = await exigirCliente(tx, id);
  if (!cliente.activo) {
    throw new ErrorConflicto(
      `El cliente "${cliente.nombre}" está desactivado; reactívalo para editar sus campos.`,
    );
  }
  return cliente;
}

/** Campos de contacto editables (clave del payload === clave del modelo). */
const CAMPOS_CONTACTO_EDITABLES = ['contacto', 'telefono', 'email', 'direccion'] as const;

/**
 * Aplica los campos de contacto que VENGAN en la edición al `update` y registra qué
 * cambió (para la bitácora). Semántica del PATCH parcial (M1, igual que Proveedor):
 *   - campo OMITIDO (`undefined`) → no se toca.
 *   - campo en `null` (o texto que queda vacío) → se BORRA (a `null`); NUNCA se escribe
 *     `''` (un texto vacío se normaliza a `null` antes de comparar/guardar).
 *   - campo con valor → se guarda si difiere del actual.
 * Devuelve el detalle de cambios para la bitácora.
 */
function aplicarContactoEditar(
  datos: z.output<typeof esquemaClienteEditar>,
  actual: Cliente,
  cambios: Prisma.ClienteUpdateInput,
): Record<string, unknown> {
  const detalle: Record<string, unknown> = {};
  for (const campo of CAMPOS_CONTACTO_EDITABLES) {
    const crudo = datos[campo];
    if (crudo === undefined) {
      continue;
    }
    const nuevo = crudo === null || crudo === '' ? null : crudo;
    const anterior = actual[campo];
    if (nuevo !== anterior) {
      (cambios as Record<string, unknown>)[campo] = nuevo;
      detalle[campo] = { de: anterior, a: nuevo };
    }
  }
  return detalle;
}

/** Construye el `data` de los campos de contacto presentes en el alta (solo los definidos). */
function datosContactoCrear(
  datos: z.output<typeof esquemaClienteCrear>,
): Partial<Prisma.ClienteCreateInput> {
  const data: Partial<Prisma.ClienteCreateInput> = {};
  if (datos.contacto !== undefined) data.contacto = datos.contacto;
  if (datos.telefono !== undefined) data.telefono = datos.telefono;
  if (datos.email !== undefined) data.email = datos.email;
  if (datos.direccion !== undefined) data.direccion = datos.direccion;
  return data;
}

/**
 * Crea un cliente (catálogo global). Reglas: permiso `clientes.administrar`; nombre
 * único global → `ErrorConflicto`; nace activo y SIN campos de referencia (se agregan
 * después con `agregarCampoCliente`); auditoría y bitácora en la misma transacción
 * (A2/A7).
 *
 * @example
 * const c = await crearCliente(sesion, { nombre: "Liverpool", email: "compras@liverpool.mx" });
 */
export async function crearCliente(
  sesion: SesionUsuario,
  entrada: EntradaCrearCliente,
  bd?: ContextoBd,
): Promise<ClienteConCampos> {
  verificarPermiso(sesion, 'clientes.administrar');
  const datos = validarEntrada(esquemaClienteCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, datos.nombre);

      const cliente = await tx.cliente.create({
        data: {
          nombre: datos.nombre,
          ...datosContactoCrear(datos),
          ...datosCreacion(sesion),
        },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'Cliente',
        idEntidad: cliente.id,
        accion: 'CREAR',
        datos: { nombre: cliente.nombre },
      });

      return tx.cliente.findUniqueOrThrow({ where: { id: cliente.id }, include: incluirCampos });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un cliente llamado "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un cliente: nombre, datos de contacto (M1) y/o `activo` para desactivar
 * (borrado suave) o reactivar — la forma exacta del esquema `esquemaClienteEditar`.
 * Todo en UNA transacción (A2). NO toca los campos de referencia (se gestionan por su
 * propio sub-recurso). Bitácora: `MODIFICAR` con el detalle, y/o `DESACTIVAR` si el
 * cambio apagó el cliente.
 */
export async function actualizarCliente(
  sesion: SesionUsuario,
  entrada: EntradaActualizarCliente,
  bd?: ContextoBd,
): Promise<ClienteConCampos> {
  verificarPermiso(sesion, 'clientes.administrar');
  const datos = validarEntrada(esquemaClienteEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirCliente(tx, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      const cambios: Prisma.ClienteUpdateInput = { ...datosModificacion(sesion) };
      const detalleContacto = aplicarContactoEditar(datos, actual, cambios);
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      // Al cambiar nombre o al reactivar puede chocar con un nombre vigente.
      if (cambiaNombre) {
        await exigirNombreLibre(tx, datos.nombre ?? actual.nombre, datos.id);
      } else if (reactiva) {
        await exigirNombreLibre(tx, actual.nombre, datos.id);
      }

      const huboCambio =
        cambiaNombre || Object.keys(detalleContacto).length > 0 || reactiva || desactiva;

      if (!huboCambio) {
        // Nada que guardar: idempotente, sin bitácora vacía.
        return tx.cliente.findUniqueOrThrow({ where: { id: datos.id }, include: incluirCampos });
      }

      await tx.cliente.update({ where: { id: datos.id }, data: cambios });

      if (cambiaNombre || Object.keys(detalleContacto).length > 0 || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Cliente',
          idEntidad: datos.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: datos.nombre } } : {}),
            ...detalleContacto,
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Cliente',
          idEntidad: datos.id,
          accion: 'DESACTIVAR',
          datos: { nombre: actual.nombre },
        });
      }

      return tx.cliente.findUniqueOrThrow({ where: { id: datos.id }, include: incluirCampos });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un cliente con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un cliente: deja de aparecer en capturas pero su historial
 * (y sus campos de referencia) queda intacto. Desactivar dos veces es `ErrorConflicto`
 * (la pantalla estaba desactualizada). Atajo explícito del botón "Desactivar".
 */
export async function desactivarCliente(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ClienteConCampos> {
  verificarPermiso(sesion, 'clientes.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirCliente(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El cliente "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarCliente(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un cliente desactivado (operación inversa del borrado suave). */
export async function reactivarCliente(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ClienteConCampos> {
  verificarPermiso(sesion, 'clientes.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirCliente(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El cliente "${actual.nombre}" ya está activo.`);
    }
    return actualizarCliente(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un cliente por id (con sus campos de referencia) o lanza `ErrorNoEncontrado`. */
export async function obtenerCliente(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ClienteConCampos> {
  verificarPermiso(sesion, 'clientes.ver');
  const cliente = await clienteLectura(bd).cliente.findUnique({
    where: { id },
    include: incluirCampos,
  });
  if (cliente === null) {
    throw new ErrorNoEncontrado('Cliente', id);
  }
  return cliente;
}

/**
 * Lista clientes con búsqueda, orden y paginación EN SERVIDOR (la tabla de la UI nunca
 * trae todo para filtrar en memoria). Por defecto: solo activos. Cada cliente trae sus
 * campos de referencia embebidos (ver `incluirCampos`): la lista pagina ≤100 filas, así
 * la UI puede mostrar p. ej. cuántos campos tiene cada cliente sin un N+1.
 *
 * @example
 * const pagina = await listarClientes(sesion, { busqueda: "liver" });
 */
export async function listarClientes(
  sesion: SesionUsuario,
  parametros: ParametrosListarClientes = {},
  bd?: ContextoBd,
): Promise<Pagina<ClienteConCampos>> {
  verificarPermiso(sesion, 'clientes.ver');
  const filtros = validarEntrada(esquemaListarClientes, parametros);
  const cliente = clienteLectura(bd);

  // Búsqueda por nombre SIN acentos ni mayúsculas (R2 §4.4.1: "oscar" encuentra a "Óscar"):
  // pre-filtro de ids vía unaccent (comun/busqueda.ts), compuesto con el resto del where.
  const idsBusqueda =
    filtros.busqueda === undefined || filtros.busqueda === ''
      ? undefined
      : await idsPorNombreSinAcentos(cliente, 'cliente', filtros.busqueda);

  const where: Prisma.ClienteWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(idsBusqueda === undefined ? {} : { id: { in: idsBusqueda } }),
  };

  const [total, datos] = await Promise.all([
    cliente.cliente.count({ where }),
    cliente.cliente.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: incluirCampos,
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}

// ── Campos de referencia del cliente (D7) ─────────────────────────────────────────

/** Alta de un campo de referencia (D7): forma del esquema compartido. */
export type EntradaCrearCampoCliente = z.input<typeof esquemaClienteCampoCrear>;

/** Edición de un campo (D7): `id` + cambios parciales (incluye `activo`). */
export type EntradaActualizarCampoCliente = z.input<typeof esquemaClienteCampoEditar>;

/**
 * Unicidad de la `etiqueta` DENTRO del cliente (D7): un cliente no puede tener dos
 * campos con la misma etiqueta, sin importar mayúsculas. Se valida en la transacción;
 * la carrera residual la captura el unique `@@unique([idCliente, etiqueta])`.
 */
async function exigirEtiquetaLibre(
  tx: Tx,
  idCliente: number,
  etiqueta: string,
  idActual?: number,
): Promise<void> {
  const existente = await tx.clienteCampo.findFirst({
    where: {
      idCliente,
      etiqueta: { equals: etiqueta, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Este cliente ya tiene un campo llamado "${etiqueta}".`
        : `Este cliente ya tiene un campo llamado "${etiqueta}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/**
 * Busca un campo que PERTENEZCA al cliente o lanza `ErrorNoEncontrado` (un campo de
 * otro cliente, para este cliente, no existe).
 */
async function exigirCampoDeCliente(
  tx: Tx,
  idCliente: number,
  idCampo: number,
): Promise<ClienteCampo> {
  const campo = await tx.clienteCampo.findFirst({ where: { id: idCampo, idCliente } });
  if (campo === null) {
    throw new ErrorNoEncontrado('Campo del cliente', idCampo);
  }
  return campo;
}

/** Siguiente `orden` para un campo nuevo del cliente (al final): max(orden)+1, o 0 si no hay. */
async function siguienteOrdenCampo(tx: Tx, idCliente: number): Promise<number> {
  const agregado = await tx.clienteCampo.aggregate({
    where: { idCliente },
    _max: { orden: true },
  });
  const maximo = agregado._max.orden;
  return maximo === null ? 0 : maximo + 1;
}

/**
 * Lista los campos de referencia de un cliente (D7), ordenados por `orden`. Por defecto
 * solo los activos; `incluirInactivos` trae también los desactivados. Requiere
 * `clientes.ver`. Exige que el cliente exista (no su estado activo: ver los campos de un
 * cliente desactivado es lícito).
 */
export async function listarCamposCliente(
  sesion: SesionUsuario,
  idCliente: number,
  opciones: { incluirInactivos?: boolean } = {},
  bd?: ContextoBd,
): Promise<ClienteCampo[]> {
  verificarPermiso(sesion, 'clientes.ver');
  const cliente = clienteLectura(bd);
  const existe = await cliente.cliente.findUnique({
    where: { id: idCliente },
    select: { id: true },
  });
  if (existe === null) {
    throw new ErrorNoEncontrado('Cliente', idCliente);
  }
  return cliente.clienteCampo.findMany({
    where: { idCliente, ...(opciones.incluirInactivos === true ? {} : { activo: true }) },
    orderBy: [{ orden: 'asc' }, { id: 'asc' }],
  });
}

/**
 * Agrega un campo de referencia a un cliente (D7) en UNA transacción (A2). Reglas:
 * permiso `clientes.administrar`; el cliente debe existir y estar ACTIVO; `etiqueta`
 * única dentro del cliente → `ErrorConflicto`; si no se da `orden`, se coloca al final.
 * Auditoría/bitácora en la misma transacción.
 */
export async function agregarCampoCliente(
  sesion: SesionUsuario,
  idCliente: number,
  entrada: EntradaCrearCampoCliente,
  bd?: ContextoBd,
): Promise<ClienteCampo> {
  verificarPermiso(sesion, 'clientes.administrar');
  const datos = validarEntrada(esquemaClienteCampoCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirClienteActivo(tx, idCliente);
      await exigirEtiquetaLibre(tx, idCliente, datos.etiqueta);

      const orden = datos.orden ?? (await siguienteOrdenCampo(tx, idCliente));

      const campo = await tx.clienteCampo.create({
        data: {
          idCliente,
          etiqueta: datos.etiqueta,
          tipo: datos.tipo,
          orden,
          ...datosCreacion(sesion),
        },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'Cliente',
        idEntidad: idCliente,
        accion: 'MODIFICAR',
        datos: { campo: 'agregar', etiqueta: campo.etiqueta, tipo: campo.tipo },
      });

      return campo;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Este cliente ya tiene un campo llamado "${datos.etiqueta}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un campo de referencia de un cliente (D7): etiqueta, tipo, orden y/o
 * `activo` (des/reactivar) — la forma de `esquemaClienteCampoEditar`. UNA transacción
 * (A2). El cliente debe estar ACTIVO. Si cambia la etiqueta, se exige que la nueva esté
 * libre dentro del cliente. Bitácora con el detalle.
 *
 * NOTA F2: este servicio NO borra el campo físicamente; cuando un campo tenga valores
 * capturados (`OrdenReferencia`, F2) el borrado seguirá siendo suave (`activo=false`).
 */
export async function actualizarCampoCliente(
  sesion: SesionUsuario,
  idCliente: number,
  entrada: EntradaActualizarCampoCliente,
  bd?: ContextoBd,
): Promise<ClienteCampo> {
  verificarPermiso(sesion, 'clientes.administrar');
  const datos = validarEntrada(esquemaClienteCampoEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirClienteActivo(tx, idCliente);
      const actual = await exigirCampoDeCliente(tx, idCliente, datos.id);

      const cambiaEtiqueta = datos.etiqueta !== undefined && datos.etiqueta !== actual.etiqueta;
      const cambiaTipo = datos.tipo !== undefined && datos.tipo !== actual.tipo;
      const cambiaOrden = datos.orden !== undefined && datos.orden !== actual.orden;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaEtiqueta && !cambiaTipo && !cambiaOrden && !reactiva && !desactiva) {
        return actual; // nada que guardar: idempotente, sin bitácora vacía
      }

      if (cambiaEtiqueta && datos.etiqueta !== undefined) {
        await exigirEtiquetaLibre(tx, idCliente, datos.etiqueta, datos.id);
      }

      const cambios: Prisma.ClienteCampoUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaEtiqueta && datos.etiqueta !== undefined) {
        cambios.etiqueta = datos.etiqueta;
      }
      if (cambiaTipo && datos.tipo !== undefined) {
        cambios.tipo = datos.tipo;
      }
      if (cambiaOrden && datos.orden !== undefined) {
        cambios.orden = datos.orden;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const campo = await tx.clienteCampo.update({ where: { id: datos.id }, data: cambios });

      if (cambiaEtiqueta || cambiaTipo || cambiaOrden || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Cliente',
          idEntidad: idCliente,
          accion: 'MODIFICAR',
          datos: {
            campo: 'modificar',
            idCampo: campo.id,
            ...(cambiaEtiqueta ? { etiqueta: { de: actual.etiqueta, a: campo.etiqueta } } : {}),
            ...(cambiaTipo ? { tipo: { de: actual.tipo, a: campo.tipo } } : {}),
            ...(cambiaOrden ? { orden: { de: actual.orden, a: campo.orden } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Cliente',
          idEntidad: idCliente,
          accion: 'MODIFICAR',
          datos: { campo: 'desactivar', idCampo: campo.id, etiqueta: campo.etiqueta },
        });
      }

      return campo;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Este cliente ya tiene un campo con esa etiqueta.', {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un campo de referencia de un cliente (D7). Desactivar dos
 * veces es `ErrorConflicto`. El cliente debe estar ACTIVO. Borrado suave por diseño
 * (regla F2: un campo con valores nunca se borra físico).
 */
export async function desactivarCampoCliente(
  sesion: SesionUsuario,
  idCliente: number,
  idCampo: number,
  bd?: ContextoBd,
): Promise<ClienteCampo> {
  verificarPermiso(sesion, 'clientes.administrar');
  return enTransaccion(async (tx) => {
    await exigirClienteActivo(tx, idCliente);
    const actual = await exigirCampoDeCliente(tx, idCliente, idCampo);
    if (!actual.activo) {
      throw new ErrorConflicto(`El campo "${actual.etiqueta}" ya está desactivado.`);
    }
    return actualizarCampoCliente(sesion, idCliente, { id: idCampo, activo: false }, { tx });
  }, bd);
}

/** Reactiva un campo de referencia desactivado (operación inversa del borrado suave). */
export async function reactivarCampoCliente(
  sesion: SesionUsuario,
  idCliente: number,
  idCampo: number,
  bd?: ContextoBd,
): Promise<ClienteCampo> {
  verificarPermiso(sesion, 'clientes.administrar');
  return enTransaccion(async (tx) => {
    await exigirClienteActivo(tx, idCliente);
    const actual = await exigirCampoDeCliente(tx, idCliente, idCampo);
    if (actual.activo) {
      throw new ErrorConflicto(`El campo "${actual.etiqueta}" ya está activo.`);
    }
    // No hace falta re-checar la etiqueta: el unique `@@unique([idCliente, etiqueta])`
    // cubre activos e inactivos, así que mientras estuvo apagada nadie pudo reusarla.
    return actualizarCampoCliente(sesion, idCliente, { id: idCampo, activo: true }, { tx });
  }, bd);
}
