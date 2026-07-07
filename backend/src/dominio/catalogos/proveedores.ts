/**
 * Proveedores — catálogo maestro GLOBAL (F1-E1) enriquecido para CxP (F1-E1B, R15).
 *
 * Replica el CRUD patrón de Almacenes (`dominio/admin/almacenes.ts`), con UNA
 * diferencia de diseño: los catálogos maestros de F1 son **globales, sin `idEmpresa`**
 * (ADR-0007, decisión A9 — `Documentacion_MJD/MEJORAS.md` A9). Por eso aquí NO hay
 * empresa activa: la unicidad de `nombre` es global (`@unique`).
 *
 * F1-E1B (R15, D12 — `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §4)
 * convierte este catálogo en el cimiento de las CxP de F9. Agrega:
 *  • Campos fiscales/comerciales/operativos (todos nullable: los 443 proveedores que
 *    migran en F1-E6 no los traen). La condición de pago se modela como `diasCredito`
 *    (Int? — `null`/`0` = contado; ver `crearProveedor`).
 *  • Roles/servicios multi-valor (`ProveedorRol`, N:N): un mismo proveedor puede
 *    maquilar Y cortar. Se crean/editan EN LA MISMA transacción (A2) y se exige ≥1
 *    (en alta y al reemplazar el set en edición). `tipo` SE CONSERVA como clasificador
 *    rápido junto a los roles (acta Gabriel, 13-jun-2026).
 *  • Adjuntos en R2 (`ProveedorArchivo`): constancia/contrato, vía el motor de archivos
 *    de F0 (presigned PUT/GET). El servicio de archivos se inyecta (default
 *    `servicioArchivos()` lazy) para poder pasar un fake en tests sin R2 real.
 *
 * Doc funcional: `Documentacion_MJD/03-Produccion.md` §Órdenes de Compra (tabla
 * `Proveedores`, `TipoProv` H/T/S). Piezas del patrón conservadas: permiso primero
 * (`proveedores.ver`/`.administrar`, sin permisos nuevos en E1B); Zod compartido de
 * `src/contrato`; todo cambio en UNA transacción (A2) con auditoría (A7) + `Bitacora`
 * juntos o nada; borrado SUAVE reversible (`activo`); unicidad de nombre validada en
 * la transacción y respaldada por el unique de la base.
 */
import {
  esquemaProveedorAdjuntoCrear,
  esquemaProveedorCrear,
  esquemaProveedorEditar,
  TIPOS_PROVEEDOR,
  type DatosProveedorAdjuntoCrear,
} from '../../contrato/index.js';
import type { Prisma, Proveedor, ProveedorArchivo, RolProveedor } from '../../datos/index.js';
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

/** Carpeta R2 de los adjuntos de proveedores (la key real se ordena por id, no por nombre). */
const CARPETA_ADJUNTOS = 'proveedores';

/** Alta: campos del esquema compartido (catálogo global, sin `idEmpresa`). */
export type EntradaCrearProveedor = z.input<typeof esquemaProveedorCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarProveedor = z.input<typeof esquemaProveedorEditar>;

/** Proveedor con sus roles cargados (forma que consume la ruta para la salida). */
export type ProveedorConRoles = Proveedor & {
  roles: { rol: Pick<RolProveedor, 'id' | 'codigo' | 'nombre'> }[];
  _count: { archivos: number };
};

/** `include` estándar para traer roles + conteo de adjuntos junto al proveedor. */
const incluirRolesYConteo = {
  roles: {
    select: { rol: { select: { id: true, codigo: true, nombre: true } } },
    orderBy: { rol: { nombre: 'asc' } },
  },
  _count: { select: { archivos: true } },
} satisfies Prisma.ProveedorInclude;

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export const esquemaListarProveedores = esquemaPaginacion.extend({
  /** Texto a buscar en el nombre (insensible a mayúsculas). */
  busqueda: z.string().trim().max(150).optional(),
  /** Filtrar por tipo de proveedor (clasificador rápido). */
  tipo: z.enum(TIPOS_PROVEEDOR).optional(),
  /** Filtrar por id de rol/servicio (R15). */
  rol: z.number().int().positive().optional(),
  /** Por omisión solo activos; `true` muestra también los desactivados. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'tipo', 'creadoEn']).default('nombre'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

export type ParametrosListarProveedores = z.input<typeof esquemaListarProveedores>;

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos proveedores con el
 * mismo nombre, sin importar mayúsculas ("Textiles SA" ≡ "textiles sa"). Se valida
 * DENTRO de la transacción; la carrera residual la captura el unique de la base
 * (P2002 → `ErrorConflicto`).
 */
async function exigirNombreLibre(tx: Tx, nombre: string, idActual?: number): Promise<void> {
  const existente = await tx.proveedor.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un proveedor llamado "${nombre}".`
        : `Ya existe un proveedor llamado "${nombre}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/** Busca un proveedor por id o lanza `ErrorNoEncontrado`. */
async function exigirProveedor(tx: Tx, id: number): Promise<Proveedor> {
  const proveedor = await tx.proveedor.findUnique({ where: { id } });
  if (proveedor === null) {
    throw new ErrorNoEncontrado('Proveedor', id);
  }
  return proveedor;
}

/**
 * Valida que todos los `idsRoles` existan y estén ACTIVOS (no se puede asignar un rol
 * desactivado). Devuelve los roles encontrados. Lanza `ErrorValidacion` si alguno no
 * existe o está inactivo (mensaje claro para la UI).
 */
async function exigirRolesValidos(tx: Tx, idsRoles: number[]): Promise<RolProveedor[]> {
  const unicos = [...new Set(idsRoles)];
  const roles = await tx.rolProveedor.findMany({ where: { id: { in: unicos } } });
  if (roles.length !== unicos.length) {
    throw new ErrorValidacion('Uno o más roles seleccionados no existen.');
  }
  const inactivo = roles.find((rol) => !rol.activo);
  if (inactivo !== undefined) {
    throw new ErrorValidacion(
      `El rol "${inactivo.nombre}" está desactivado y no se puede asignar.`,
    );
  }
  return roles;
}

/**
 * Reemplaza el conjunto de roles de un proveedor DENTRO de la transacción (A2):
 * borra los que sobran y crea los que faltan (diff mínimo, sin duplicar). Exige ≥1
 * rol resultante. Devuelve true si hubo algún cambio (para la bitácora).
 */
async function sincronizarRoles(
  tx: Tx,
  sesion: SesionUsuario,
  idProveedor: number,
  idsDeseados: number[],
): Promise<boolean> {
  const unicos = [...new Set(idsDeseados)];
  if (unicos.length === 0) {
    throw new ErrorValidacion('El proveedor debe tener al menos un rol/servicio.');
  }
  await exigirRolesValidos(tx, unicos);

  const actuales = await tx.proveedorRol.findMany({
    where: { idProveedor },
    select: { idRolProveedor: true },
  });
  const setActual = new Set(actuales.map((r) => r.idRolProveedor));
  const setDeseado = new Set(unicos);

  const aQuitar = [...setActual].filter((id) => !setDeseado.has(id));
  const aAgregar = [...setDeseado].filter((id) => !setActual.has(id));

  if (aQuitar.length === 0 && aAgregar.length === 0) {
    return false;
  }
  if (aQuitar.length > 0) {
    await tx.proveedorRol.deleteMany({
      where: { idProveedor, idRolProveedor: { in: aQuitar } },
    });
  }
  if (aAgregar.length > 0) {
    await tx.proveedorRol.createMany({
      data: aAgregar.map((idRolProveedor) => ({
        idProveedor,
        idRolProveedor,
        creadoPorId: sesion.id,
      })),
    });
  }
  return true;
}

/** Construye el `data` de los campos enriquecidos presentes en el alta (solo los definidos). */
function datosEnriquecidosCrear(
  datos: z.output<typeof esquemaProveedorCrear>,
): Partial<Prisma.ProveedorCreateInput> {
  const data: Partial<Prisma.ProveedorCreateInput> = {};
  if (datos.razonSocial !== undefined) data.razonSocial = datos.razonSocial;
  if (datos.telefono !== undefined) data.telefono = datos.telefono;
  if (datos.contacto !== undefined) data.contacto = datos.contacto;
  if (datos.condiciones !== undefined) data.condiciones = datos.condiciones;
  if (datos.factura !== undefined) data.factura = datos.factura;
  if (datos.rfc !== undefined) data.rfc = datos.rfc;
  if (datos.regimenFiscalSat !== undefined) data.regimenFiscalSat = datos.regimenFiscalSat;
  if (datos.usoCfdiHabitual !== undefined) data.usoCfdiHabitual = datos.usoCfdiHabitual;
  if (datos.codigoPostalExpedicion !== undefined) {
    data.codigoPostalExpedicion = datos.codigoPostalExpedicion;
  }
  if (datos.retieneIva !== undefined) data.retieneIva = datos.retieneIva;
  if (datos.retieneIsr !== undefined) data.retieneIsr = datos.retieneIsr;
  if (datos.email !== undefined) data.email = datos.email;
  if (datos.direccion !== undefined) data.direccion = datos.direccion;
  if (datos.diasCredito !== undefined) data.diasCredito = datos.diasCredito;
  if (datos.moneda !== undefined) data.moneda = datos.moneda;
  if (datos.formaPago !== undefined) data.formaPago = datos.formaPago;
  if (datos.metodoPago !== undefined) data.metodoPago = datos.metodoPago;
  if (datos.banco !== undefined) data.banco = datos.banco;
  if (datos.clabe !== undefined) data.clabe = datos.clabe;
  if (datos.limiteCredito !== undefined) data.limiteCredito = datos.limiteCredito;
  if (datos.leadTimeDias !== undefined) data.leadTimeDias = datos.leadTimeDias;
  if (datos.notas !== undefined) data.notas = datos.notas;
  // Fusión de terceros (D12/R15): atributos del antiguo maquilero.
  if (datos.corto !== undefined) data.corto = datos.corto;
  if (datos.asegurado !== undefined) data.asegurado = datos.asegurado;
  if (datos.obsPago !== undefined) data.obsPago = datos.obsPago;
  // Facturación EsMa (F6-E5, decisión h).
  if (datos.modalidadFacturacion !== undefined)
    data.modalidadFacturacion = datos.modalidadFacturacion;
  return data;
}

/** Campos de TEXTO editables (clave del payload === clave del modelo). */
const CAMPOS_TEXTO_EDITABLES = [
  'razonSocial',
  'telefono',
  'contacto',
  'condiciones',
  'rfc',
  'regimenFiscalSat',
  'usoCfdiHabitual',
  'codigoPostalExpedicion',
  'email',
  'direccion',
  'moneda',
  'formaPago',
  'metodoPago',
  'banco',
  'clabe',
  'notas',
  // Fusión de terceros (D12/R15): atributos del antiguo maquilero (texto nullable).
  'corto',
  'obsPago',
] as const;

/** Campos BOOLEANOS editables (no nullables: el formulario los manda como boolean). */
const CAMPOS_BOOL_EDITABLES = ['factura', 'retieneIva', 'retieneIsr', 'asegurado'] as const;

/** Campos NUMÉRICOS enteros editables (nullables: `null` = borrar el dato). */
const CAMPOS_NUM_EDITABLES = ['diasCredito', 'leadTimeDias'] as const;

/**
 * Aplica los campos enriquecidos que VENGAN en la edición al `update` y registra qué
 * cambió (para la bitácora). Semántica del PATCH parcial (M1):
 *   - campo OMITIDO (`undefined`) → no se toca.
 *   - campo en `null` (o texto que queda vacío) → se BORRA (se pone a `null`); NUNCA
 *     se escribe `''` (un texto vacío se normaliza a `null` antes de comparar/guardar).
 *   - campo con valor → se guarda si difiere del actual.
 * Devuelve el detalle de cambios para la bitácora.
 */
function aplicarEnriquecidosEditar(
  datos: z.output<typeof esquemaProveedorEditar>,
  actual: Proveedor,
  cambios: Prisma.ProveedorUpdateInput,
): Record<string, unknown> {
  const detalle: Record<string, unknown> = {};

  // Textos: omitir = no tocar; vacío/`null` = borrar (normalizado a null, nunca '').
  for (const campo of CAMPOS_TEXTO_EDITABLES) {
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

  // Banderas: omitir = no tocar (no son nullables; el formulario manda boolean).
  for (const campo of CAMPOS_BOOL_EDITABLES) {
    const nuevo = datos[campo];
    if (nuevo === undefined) {
      continue;
    }
    const anterior = actual[campo];
    if (nuevo !== anterior) {
      (cambios as Record<string, unknown>)[campo] = nuevo;
      detalle[campo] = { de: anterior, a: nuevo };
    }
  }

  // Numéricos enteros: omitir = no tocar; `null` = borrar.
  for (const campo of CAMPOS_NUM_EDITABLES) {
    const nuevo = datos[campo];
    if (nuevo === undefined) {
      continue;
    }
    const anterior = actual[campo];
    if (nuevo !== anterior) {
      (cambios as Record<string, unknown>)[campo] = nuevo;
      detalle[campo] = { de: anterior, a: nuevo };
    }
  }

  // `limiteCredito` es Decimal: comparar por valor numérico (Prisma devuelve Decimal).
  // Omitir = no tocar; `null` = borrar.
  if (datos.limiteCredito !== undefined) {
    const anterior = actual.limiteCredito === null ? null : Number(actual.limiteCredito);
    if (datos.limiteCredito !== anterior) {
      cambios.limiteCredito = datos.limiteCredito;
      detalle.limiteCredito = { de: anterior, a: datos.limiteCredito };
    }
  }

  // `modalidadFacturacion` es enum (F6-E5): omitir = no tocar; `null` = borrar (sin definir).
  if (datos.modalidadFacturacion !== undefined) {
    const nuevo = datos.modalidadFacturacion;
    if (nuevo !== actual.modalidadFacturacion) {
      cambios.modalidadFacturacion = nuevo;
      detalle.modalidadFacturacion = { de: actual.modalidadFacturacion, a: nuevo };
    }
  }
  return detalle;
}

/**
 * Crea un proveedor (catálogo global) con sus roles en UNA transacción (A2). Reglas:
 * permiso `proveedores.administrar`; nombre único global → `ErrorConflicto`; **≥1 rol**
 * (R15); si `factura=true` exige RFC + régimen (regla de captura, validada en el
 * esquema); nace activo; auditoría y bitácora en la misma transacción (A7).
 *
 * Condición de pago: `diasCredito` (null o 0 = contado; >0 = días de crédito).
 *
 * @example
 * const p = await crearProveedor(sesion, {
 *   nombre: "Maquilas SA", tipo: "SERVICIOS", roles: [1, 2],
 *   factura: true, rfc: "MSA010101AB1", regimenFiscalSat: "601", diasCredito: 30,
 * });
 */
export async function crearProveedor(
  sesion: SesionUsuario,
  entrada: EntradaCrearProveedor,
  bd?: ContextoBd,
): Promise<ProveedorConRoles> {
  verificarPermiso(sesion, 'proveedores.administrar');
  const datos = validarEntrada(esquemaProveedorCrear, entrada);
  if (datos.roles === undefined || datos.roles.length === 0) {
    throw new ErrorValidacion('El proveedor debe tener al menos un rol/servicio.');
  }

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, datos.nombre);

      const proveedor = await tx.proveedor.create({
        data: {
          nombre: datos.nombre,
          tipo: datos.tipo,
          ...datosEnriquecidosCrear(datos),
          ...datosCreacion(sesion),
        },
      });

      await sincronizarRoles(tx, sesion, proveedor.id, datos.roles ?? []);

      await registrarBitacora(tx, sesion, {
        entidad: 'Proveedor',
        idEntidad: proveedor.id,
        accion: 'CREAR',
        datos: { nombre: proveedor.nombre, tipo: proveedor.tipo, roles: datos.roles },
      });

      return tx.proveedor.findUniqueOrThrow({
        where: { id: proveedor.id },
        include: incluirRolesYConteo,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un proveedor llamado "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un proveedor: datos generales, campos enriquecidos (R15), roles y/o
 * `activo` para desactivar (borrado suave) o reactivar — la forma exacta del esquema
 * compartido `esquemaProveedorEditar`. Todo en UNA transacción (A2).
 *
 * Roles: si `roles` NO viene, no se tocan; si viene (cualquier arreglo), reemplaza el
 * set y exige ≥1 (no puede quedar en 0). Bitácora según lo que pasó: `MODIFICAR` con
 * el detalle de campos, y/o `DESACTIVAR` si el cambio apagó el proveedor.
 */
export async function actualizarProveedor(
  sesion: SesionUsuario,
  entrada: EntradaActualizarProveedor,
  bd?: ContextoBd,
): Promise<ProveedorConRoles> {
  verificarPermiso(sesion, 'proveedores.administrar');
  const datos = validarEntrada(esquemaProveedorEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirProveedor(tx, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const cambiaTipo = datos.tipo !== undefined && datos.tipo !== actual.tipo;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      const cambios: Prisma.ProveedorUpdateInput = { ...datosModificacion(sesion) };
      const detalleEnriquecidos = aplicarEnriquecidosEditar(datos, actual, cambios);
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if (cambiaTipo && datos.tipo !== undefined) {
        cambios.tipo = datos.tipo;
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

      // Roles: solo se tocan si vienen en el payload (omitir = no tocar). El set
      // resultante debe tener ≥1 (lo exige `sincronizarRoles`).
      const cambiaRoles =
        datos.roles !== undefined
          ? await sincronizarRoles(tx, sesion, datos.id, datos.roles)
          : false;

      const huboCambioEscalar =
        cambiaNombre ||
        cambiaTipo ||
        Object.keys(detalleEnriquecidos).length > 0 ||
        reactiva ||
        desactiva;

      if (!huboCambioEscalar && !cambiaRoles) {
        return tx.proveedor.findUniqueOrThrow({
          where: { id: datos.id },
          include: incluirRolesYConteo,
        });
      }

      if (huboCambioEscalar) {
        // `cambios` ya trae nombre/tipo/enriquecidos/activo + auditoría según corresponda.
        await tx.proveedor.update({ where: { id: datos.id }, data: cambios });
      } else if (cambiaRoles) {
        // Solo cambiaron roles: deja constancia de la modificación (modificadoPorId/En).
        await tx.proveedor.update({
          where: { id: datos.id },
          data: { ...datosModificacion(sesion) },
        });
      }

      if (
        cambiaNombre ||
        cambiaTipo ||
        Object.keys(detalleEnriquecidos).length > 0 ||
        reactiva ||
        cambiaRoles
      ) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Proveedor',
          idEntidad: datos.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: datos.nombre } } : {}),
            ...(cambiaTipo ? { tipo: { de: actual.tipo, a: datos.tipo } } : {}),
            ...detalleEnriquecidos,
            ...(cambiaRoles ? { roles: datos.roles } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Proveedor',
          idEntidad: datos.id,
          accion: 'DESACTIVAR',
          datos: { nombre: actual.nombre },
        });
      }

      return tx.proveedor.findUniqueOrThrow({
        where: { id: datos.id },
        include: incluirRolesYConteo,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un proveedor con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un proveedor: deja de aparecer en capturas pero su
 * historial queda intacto. Desactivar dos veces es `ErrorConflicto` (la pantalla
 * estaba desactualizada). Atajo explícito del botón "Desactivar".
 */
export async function desactivarProveedor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ProveedorConRoles> {
  verificarPermiso(sesion, 'proveedores.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirProveedor(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El proveedor "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarProveedor(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un proveedor desactivado (operación inversa del borrado suave). */
export async function reactivarProveedor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ProveedorConRoles> {
  verificarPermiso(sesion, 'proveedores.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirProveedor(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El proveedor "${actual.nombre}" ya está activo.`);
    }
    return actualizarProveedor(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Obtiene un proveedor por id (con roles y conteo de adjuntos) o lanza `ErrorNoEncontrado`. */
export async function obtenerProveedor(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ProveedorConRoles> {
  verificarPermiso(sesion, 'proveedores.ver');
  const proveedor = await clienteLectura(bd).proveedor.findUnique({
    where: { id },
    include: incluirRolesYConteo,
  });
  if (proveedor === null) {
    throw new ErrorNoEncontrado('Proveedor', id);
  }
  return proveedor;
}

/**
 * Lista proveedores con búsqueda, orden y paginación EN SERVIDOR (la tabla de la UI
 * nunca trae todo para filtrar en memoria). Por defecto: solo activos. Permite
 * filtrar por `tipo` (clasificador rápido) y por `rol` (R15) — ambos coexisten.
 *
 * @example
 * const pagina = await listarProveedores(sesion, { tipo: "TELAS", rol: 4 });
 */
export async function listarProveedores(
  sesion: SesionUsuario,
  parametros: ParametrosListarProveedores = {},
  bd?: ContextoBd,
): Promise<Pagina<ProveedorConRoles>> {
  verificarPermiso(sesion, 'proveedores.ver');
  const filtros = validarEntrada(esquemaListarProveedores, parametros);
  const cliente = clienteLectura(bd);

  // Busqueda por nombre SIN acentos ni mayusculas (R2 §4.4.1: "oscar" encuentra a "Oscar"):
  // pre-filtro de ids via unaccent (comun/busqueda.ts), compuesto con el resto del where.
  const idsBusqueda =
    filtros.busqueda === undefined || filtros.busqueda === ''
      ? undefined
      : await idsPorNombreSinAcentos(cliente, 'proveedor', filtros.busqueda);

  const where: Prisma.ProveedorWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.tipo === undefined ? {} : { tipo: filtros.tipo }),
    ...(filtros.rol === undefined ? {} : { roles: { some: { idRolProveedor: filtros.rol } } }),
    ...(idsBusqueda === undefined ? {} : { id: { in: idsBusqueda } }),
  };

  const [total, datos] = await Promise.all([
    cliente.proveedor.count({ where }),
    cliente.proveedor.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: incluirRolesYConteo,
      ...rangoPrisma(filtros),
    }),
  ]);

  return armarPagina(datos, total, filtros);
}

// ── Roles de proveedor (catálogo selector, R15 §4.1) ──────────────────────────

/**
 * Lista los roles/servicios de proveedor para el selector de la ficha. Por defecto
 * solo los activos (los inactivos no se pueden asignar). Requiere `proveedores.ver`.
 */
export async function listarRolesProveedor(
  sesion: SesionUsuario,
  opciones: { incluirInactivos?: boolean } = {},
  bd?: ContextoBd,
): Promise<RolProveedor[]> {
  verificarPermiso(sesion, 'proveedores.ver');
  return clienteLectura(bd).rolProveedor.findMany({
    where: opciones.incluirInactivos === true ? {} : { activo: true },
    orderBy: { nombre: 'asc' },
  });
}

// ── Adjuntos en R2 (R15 §4: constancia/contrato) ──────────────────────────────

/** Resultado de preparar la subida de un adjunto (registro + URL PUT prefirmada). */
export interface SubidaAdjuntoProveedor {
  idArchivo: string;
  tipo: DatosProveedorAdjuntoCrear['tipo'];
  nombreOriginal: string;
  urlSubida: string;
  expiraEnSegundos: number;
}

/** Adjunto de proveedor con su URL de descarga prefirmada. */
export interface AdjuntoProveedorConUrl {
  idArchivo: string;
  tipo: ProveedorArchivo['tipo'];
  nombreOriginal: string;
  tipoMime: string;
  tamanoBytes: number;
  urlDescarga: string;
  creadoEn: Date;
}

/**
 * Prepara la subida de un adjunto del proveedor (R15 §4) en UNA transacción (A2):
 * exige el proveedor y el permiso `proveedores.administrar`, crea el registro `Archivo`
 * vía el motor de R2 (carpeta `proveedores/<id>` — llave ORDENADA por id, no por
 * nombre, A5), liga `ProveedorArchivo`, registra bitácora y devuelve la URL PUT
 * prefirmada para que el navegador suba DIRECTO a R2.
 *
 * El servicio de archivos se inyecta (default `servicioArchivos()` lazy) para poder
 * pasar un fake en tests sin R2 real (igual que `comun/archivos.test.ts`).
 */
export async function agregarAdjuntoProveedor(
  sesion: SesionUsuario,
  idProveedor: number,
  entrada: DatosProveedorAdjuntoCrear,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<SubidaAdjuntoProveedor> {
  verificarPermiso(sesion, 'proveedores.administrar');
  const datos = validarEntrada(esquemaProveedorAdjuntoCrear, entrada);

  return enTransaccion(async (tx) => {
    await exigirProveedor(tx, idProveedor);

    const subida = await archivos.solicitarSubida(tx, sesion, {
      nombreOriginal: datos.nombreOriginal,
      tipoMime: datos.tipoMime,
      tamanoBytes: datos.tamanoBytes,
      carpeta: `${CARPETA_ADJUNTOS}/${idProveedor}`,
    });

    await tx.proveedorArchivo.create({
      data: {
        idProveedor,
        idArchivo: subida.archivo.id,
        tipo: datos.tipo,
        creadoPorId: sesion.id,
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Proveedor',
      idEntidad: idProveedor,
      accion: 'MODIFICAR',
      datos: { adjunto: 'agregar', tipo: datos.tipo, archivo: datos.nombreOriginal },
    });

    return {
      idArchivo: subida.archivo.id,
      tipo: datos.tipo,
      nombreOriginal: datos.nombreOriginal,
      urlSubida: subida.urlSubida,
      expiraEnSegundos: subida.expiraEnSegundos,
    };
  }, bd);
}

/**
 * Lista los adjuntos de un proveedor (R15 §4), cada uno con su URL GET prefirmada
 * para verlo/descargarlo. Requiere `proveedores.ver`. Exige que el proveedor exista.
 */
export async function listarAdjuntosProveedor(
  sesion: SesionUsuario,
  idProveedor: number,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<AdjuntoProveedorConUrl[]> {
  verificarPermiso(sesion, 'proveedores.ver');
  const cliente = clienteLectura(bd);
  const proveedor = await cliente.proveedor.findUnique({
    where: { id: idProveedor },
    select: { id: true },
  });
  if (proveedor === null) {
    throw new ErrorNoEncontrado('Proveedor', idProveedor);
  }

  const adjuntos = await cliente.proveedorArchivo.findMany({
    where: { idProveedor },
    orderBy: { creadoEn: 'asc' },
    include: {
      archivo: {
        select: { id: true, key: true, nombreOriginal: true, tipoMime: true, tamanoBytes: true },
      },
    },
  });

  return Promise.all(
    adjuntos.map(async (adjunto) => ({
      idArchivo: adjunto.archivo.id,
      tipo: adjunto.tipo,
      nombreOriginal: adjunto.archivo.nombreOriginal,
      tipoMime: adjunto.archivo.tipoMime,
      tamanoBytes: adjunto.archivo.tamanoBytes,
      urlDescarga: await archivos.urlDescarga(adjunto.archivo.key, {
        nombreDescarga: adjunto.archivo.nombreOriginal,
      }),
      creadoEn: adjunto.creadoEn,
    })),
  );
}

/**
 * Quita un adjunto del proveedor (R15 §4) en UNA transacción (A2): borra el
 * `ProveedorArchivo` y su `Archivo` (el objeto R2 huérfano es inofensivo — lo
 * documenta `comun/archivos.ts`). Requiere `proveedores.administrar`. Si el adjunto
 * no pertenece a ese proveedor → `ErrorNoEncontrado`.
 */
export async function quitarAdjuntoProveedor(
  sesion: SesionUsuario,
  idProveedor: number,
  idArchivo: string,
  bd?: ContextoBd,
): Promise<void> {
  verificarPermiso(sesion, 'proveedores.administrar');
  return enTransaccion(async (tx) => {
    const adjunto = await tx.proveedorArchivo.findFirst({
      where: { idProveedor, idArchivo },
      include: { archivo: { select: { nombreOriginal: true } } },
    });
    if (adjunto === null) {
      throw new ErrorNoEncontrado('Adjunto del proveedor', idArchivo);
    }

    // Borrar el Archivo arrastra el ProveedorArchivo (onDelete Cascade); hacerlo en
    // un solo paso evita un huérfano si algo fallara entre ambos borrados.
    await tx.archivo.delete({ where: { id: idArchivo } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Proveedor',
      idEntidad: idProveedor,
      accion: 'MODIFICAR',
      datos: { adjunto: 'quitar', archivo: adjunto.archivo.nombreOriginal },
    });
  }, bd);
}
