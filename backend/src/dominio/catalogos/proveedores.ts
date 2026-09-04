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
 *    (en alta y al reemplazar el set en edición). El `tipo` (enum) SE RETIRÓ en V1-E3f pieza B
 *    (§Post-F9.56 punto 3): los roles multi-valor ya cubren el caso que el tipo único no podía
 *    —vender telas Y ser maquilero—, y la migración tradujo el valor viejo a rol.
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
  esquemaProveedorAvioAsignar,
  esquemaProveedorContactoCrear,
  esquemaProveedorContactoEditarCuerpo,
  esquemaProveedorCrear,
  esquemaProveedorCrearMigrado,
  esquemaProveedorEditar,
  type DatosProveedorAdjuntoCrear,
  type DatosProveedorAvioAsignar,
  type ProveedorAvioSalida,
} from '../../contrato/index.js';
import type {
  Prisma,
  Proveedor,
  ProveedorArchivo,
  ProveedorContacto,
  ProveedorCuentaPago,
  RolProveedor,
} from '../../datos/index.js';
import { z } from 'zod';

import {
  eliminarObjetosBestEffort,
  servicioArchivos,
  type ServicioArchivos,
} from '../../comun/archivos.js';
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
import { CODIGO_PRISMA, codigoErrorPrisma, unicidadDeCampo } from '../../comun/prisma-errores.js';
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

/** Alta en modo MIGRACIÓN: igual, pero la modalidad de facturación puede faltar (REGLA 0-B). */
export type EntradaCrearProveedorMigrado = z.input<typeof esquemaProveedorCrearMigrado>;

/** Edición: `id` + cambios parciales (incluye `activo` para des/reactivar). */
export type EntradaActualizarProveedor = z.input<typeof esquemaProveedorEditar>;

/** Proveedor con sus roles y contactos cargados (forma que consume la ruta para la salida). */
export type ProveedorConRoles = Proveedor & {
  roles: { rol: Pick<RolProveedor, 'id' | 'codigo' | 'nombre'> }[];
  contactos: ProveedorContacto[];
  cuentasPago: ProveedorCuentaPago[];
  _count: { archivos: number };
};

/**
 * `include` estándar: roles + contactos ACTIVOS + conteo de adjuntos. Los contactos archivados
 * (borrado suave, D3) no viajan en la ficha del proveedor: se ven con `?incluirInactivos=true`
 * en el listado propio de contactos.
 */
const incluirRolesYConteo = {
  roles: {
    select: { rol: { select: { id: true, codigo: true, nombre: true } } },
    orderBy: { rol: { nombre: 'asc' } },
  },
  contactos: { where: { activo: true }, orderBy: [{ nombre: 'asc' }, { id: 'asc' }] },
  // Cuentas de pago ACTIVAS, la DEFAULT primero (0.112). Las retiradas son historial: no viajan en
  // la ficha, se piden con `?incluirInactivas=true` en su listado propio.
  // ⚠️ `nulls: 'last'` NO es adorno: `esDefault` es `true`/NULL (así la base garantiza una sola
  // default) y en Postgres un `ORDER BY ... DESC` pone los NULL PRIMERO. Sin esto, la default
  // saldría hasta el final.
  cuentasPago: {
    where: { activo: true },
    orderBy: [{ esDefault: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
  },
  _count: { select: { archivos: true } },
} satisfies Prisma.ProveedorInclude;

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export const esquemaListarProveedores = esquemaPaginacion.extend({
  /** Texto a buscar en el nombre (insensible a mayúsculas). */
  busqueda: z.string().trim().max(150).optional(),
  /** Filtrar por id de rol/servicio (R15). */
  rol: z.number().int().positive().optional(),
  /** Por omisión solo activos; `true` muestra también los desactivados. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['nombre', 'creadoEn']).default('nombre'),
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

/**
 * Unicidad del CAMPO CORTO (V1-E3f pieza B — §Post-F9.58 punto 1, Daniel: *"sí debe de ser
 * único"*). Al fusionarse el `nombreCorto` de display con el `corto` del taller, el campo pasó a
 * ser una CLAVE de uso diario: dos proveedores con "TCD" confunden a quien opera.
 *
 * Se compara SIN distinguir MAYÚSCULAS ("TCD" ≡ "tcd"), igual que el `nombre`: es la clave que la
 * gente teclea. ⚠️ `mode: 'insensitive'` **NO ignora los acentos** — "Kañón" y "Kanon" son claves
 * distintas para esta comprobación y también para la base. Es lo correcto (son textos distintos),
 * pero decirlo importa: el comentario anterior afirmaba lo contrario.
 *
 * La red de la carrera concurrente son DOS índices de la base, no uno: el `@unique` exacto del
 * modelo y el funcional `unique(lower(nombre_corto))` que crea la migración. Sin el segundo, dos
 * altas simultáneas con distinta caja pasaban las dos (ninguna transacción ve a la otra), y el
 * estado que la migración deduplicó a propósito volvía a aparecer al día siguiente.
 *
 * Vacío/`null` NO se valida: los NULL no chocan entre sí en Postgres y cientos de proveedores no
 * tienen clave corta.
 */
async function exigirCortoLibre(tx: Tx, corto: string, idActual?: number): Promise<void> {
  if (corto === '') return;
  const existente = await tx.proveedor.findFirst({
    where: {
      nombreCorto: { equals: corto, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, nombre: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      `El campo corto "${corto}" ya lo usa el proveedor "${existente.nombre}". Es una clave de uso ` +
        `diario: no puede repetirse.`,
    );
  }
}

/**
 * Confirma que el proveedor existe (404 si no). EXPORTADO: lo reusan los sub-catálogos que cuelgan
 * del proveedor y viven en su propio archivo (`proveedor-cuentas-pago.ts`).
 */
export async function exigirProveedor(tx: Tx, id: number): Promise<Proveedor> {
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
  datos: z.output<typeof esquemaProveedorCrearMigrado>,
): Partial<Prisma.ProveedorCreateInput> {
  const data: Partial<Prisma.ProveedorCreateInput> = {};
  // Campo corto ÚNICO de uso diario ("Bloom" para BLOOM TEXTIL; A1.1 + §Post-F9.57/.58). La
  // unicidad (insensible a mayúsculas) la valida `exigirCortoLibre` y la respaldan los dos índices.
  if (datos.nombreCorto !== undefined) data.nombreCorto = datos.nombreCorto;
  if (datos.razonSocial !== undefined) data.razonSocial = datos.razonSocial;
  if (datos.telefono !== undefined) data.telefono = datos.telefono;
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
  if (datos.formaPagoPreferida !== undefined) data.formaPagoPreferida = datos.formaPagoPreferida;
  if (datos.metodoPago !== undefined) data.metodoPago = datos.metodoPago;
  if (datos.banco !== undefined) data.banco = datos.banco;
  if (datos.clabe !== undefined) data.clabe = datos.clabe;
  if (datos.limiteCredito !== undefined) data.limiteCredito = datos.limiteCredito;
  if (datos.leadTimeDias !== undefined) data.leadTimeDias = datos.leadTimeDias;
  if (datos.notas !== undefined) data.notas = datos.notas;
  // Fusión de terceros (D12/R15): atributos del antiguo maquilero (su `corto` vive en `nombreCorto`).
  if (datos.asegurado !== undefined) data.asegurado = datos.asegurado;
  if (datos.obsPago !== undefined) data.obsPago = datos.obsPago;
  // Facturación EsMa (F6-E5, decisión h).
  if (datos.modalidadFacturacion !== undefined)
    data.modalidadFacturacion = datos.modalidadFacturacion;
  return data;
}

/** Campos de TEXTO editables (clave del payload === clave del modelo). */
const CAMPOS_TEXTO_EDITABLES = [
  'nombreCorto',
  'razonSocial',
  'telefono',
  'condiciones',
  'rfc',
  'regimenFiscalSat',
  'usoCfdiHabitual',
  'codigoPostalExpedicion',
  'email',
  'direccion',
  'moneda',
  'formaPago',
  // ⚠️ `formaPagoPreferida` es un ENUM, no texto libre, y aun así va en esta lista a propósito: el
  // bucle hace exactamente lo que necesita —omitir = no tocar, ''/null = borrar la preferencia— y
  // así hereda el mismo renglón de bitácora que los demás campos (0.113). El Zod ya garantiza que
  // el valor sólo pueda ser `efectivo`, `transferencia` o nulo.
  'formaPagoPreferida',
  'metodoPago',
  'banco',
  'clabe',
  'notas',
  // Fusión de terceros (D12/R15): atributos del antiguo maquilero (texto nullable).
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

  // `modalidadFacturacion` es enum (F6-E5): omitir = no tocar. **`null` YA NO se admite** (fila
  // 0.110): el esquema lo rechaza antes de llegar aquí, porque vaciarla dejaría al proveedor sin
  // saber por qué camino sale su pago (§Post-F9.186(a)). Se cambia de valor, no se borra.
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
 * esquema); **`modalidadFacturacion` OBLIGATORIA** (fila 0.110, ver abajo); nace activo;
 * auditoría y bitácora en la misma transacción (A7).
 *
 * ⭐ LA MODALIDAD DE FACTURACIÓN SE PREGUNTA AL DAR DE ALTA. Daniel (3-sep-2026,
 * §Post-F9.186(a)): *"es un campo **obligatorio** de llenar. **A fuerzas hay que definir si es con,
 * sin o ambas**"*. No es cosmético: decide **de dónde sale el pago** del proveedor —CON factura, el
 * pago nace del estado de cuenta del BANCO; SIN factura, de la RELACIÓN que Daniel define
 * (§Post-F9.184(f))—. Sin ella, su pago no sabe por cuál de los dos caminos entrar. Lo exige
 * `esquemaProveedorCrear`; el ETL usa {@link crearProveedorMigrado}.
 *
 * Condición de pago: `diasCredito` (null o 0 = contado; >0 = días de crédito).
 *
 * @example
 * const p = await crearProveedor(sesion, {
 *   nombre: "Maquilas SA", roles: [1, 2], modalidadFacturacion: "solo_con",
 *   factura: true, rfc: "MSA010101AB1", regimenFiscalSat: "601", diasCredito: 30,
 * });
 */
export async function crearProveedor(
  sesion: SesionUsuario,
  entrada: EntradaCrearProveedor,
  bd?: ContextoBd,
): Promise<ProveedorConRoles> {
  verificarPermiso(sesion, 'proveedores.administrar');
  return crearProveedorValidado(sesion, validarEntrada(esquemaProveedorCrear, entrada), bd);
}

/**
 * MISMA alta, con la **modalidad de facturación opcional**. Uso EXCLUSIVO del ETL
 * (`migracion/loaders/proveedores.ts`), **jamás desde una ruta REST** — mismo patrón que
 * `registrarMovimientoTerceroInterno` en el motor de terceros.
 *
 * Por qué existe (REGLA 0-B, `CLAUDE.md` §7): Access nunca preguntó cómo factura cada proveedor,
 * así que el histórico llega con el dato vacío **a propósito** y eso NO es un defecto. Daniel: *"yo
 * me encargo de ponerlo bien cuando hagamos la migración de datos reales"*. Inventar aquí un valor
 * para cuadrar el alta sería justo lo que la regla prohíbe. El proveedor migrado se consulta y
 * aparece en su estado de cuenta con normalidad; lo que no se le puede es **capturar un movimiento
 * nuevo** hasta que se le defina la modalidad (`resolverConFactura` lo corta).
 */
export async function crearProveedorMigrado(
  sesion: SesionUsuario,
  entrada: EntradaCrearProveedorMigrado,
  bd?: ContextoBd,
): Promise<ProveedorConRoles> {
  verificarPermiso(sesion, 'proveedores.administrar');
  return crearProveedorValidado(sesion, validarEntrada(esquemaProveedorCrearMigrado, entrada), bd);
}

/** Cuerpo compartido del alta (ya validada y con el permiso verificado). */
async function crearProveedorValidado(
  sesion: SesionUsuario,
  datos: z.output<typeof esquemaProveedorCrearMigrado>,
  bd?: ContextoBd,
): Promise<ProveedorConRoles> {
  if (datos.roles === undefined || datos.roles.length === 0) {
    throw new ErrorValidacion('El proveedor debe tener al menos un rol/servicio.');
  }

  try {
    return await enTransaccion(async (tx) => {
      await exigirNombreLibre(tx, datos.nombre);
      await exigirCortoLibre(tx, datos.nombreCorto ?? '');

      const proveedor = await tx.proveedor.create({
        data: {
          nombre: datos.nombre,
          ...datosEnriquecidosCrear(datos),
          ...datosCreacion(sesion),
        },
      });

      await sincronizarRoles(tx, sesion, proveedor.id, datos.roles ?? []);

      await registrarBitacora(tx, sesion, {
        entidad: 'Proveedor',
        idEntidad: proveedor.id,
        accion: 'CREAR',
        datos: { nombre: proveedor.nombre, roles: datos.roles },
      });

      return tx.proveedor.findUniqueOrThrow({
        where: { id: proveedor.id },
        include: incluirRolesYConteo,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      // La tabla tiene DOS únicos (`nombre` y `nombre_corto`): el mensaje sigue al que se violó.
      if (unicidadDeCampo(error, 'nombre_corto')) {
        throw new ErrorConflicto(
          `El campo corto "${datos.nombreCorto ?? ''}" ya lo usa otro proveedor.`,
          { causa: error },
        );
      }
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
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      const cambios: Prisma.ProveedorUpdateInput = { ...datosModificacion(sesion) };
      const detalleEnriquecidos = aplicarEnriquecidosEditar(datos, actual, cambios);
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

      // El campo corto también es único (§Post-F9.58). Se valida el valor RESULTANTE: si el PATCH
      // lo trae, el nuevo; si no lo trae pero se está REACTIVANDO, el que ya tenía (mientras estuvo
      // apagado alguien pudo tomar esa clave).
      const cortoResultante =
        'nombreCorto' in cambios ? ((cambios.nombreCorto as string | null) ?? '') : null;
      if (cortoResultante !== null) {
        await exigirCortoLibre(tx, cortoResultante, datos.id);
      } else if (reactiva) {
        await exigirCortoLibre(tx, actual.nombreCorto ?? '', datos.id);
      }

      // Roles: solo se tocan si vienen en el payload (omitir = no tocar). El set
      // resultante debe tener ≥1 (lo exige `sincronizarRoles`).
      const cambiaRoles =
        datos.roles !== undefined
          ? await sincronizarRoles(tx, sesion, datos.id, datos.roles)
          : false;

      const huboCambioEscalar =
        cambiaNombre || Object.keys(detalleEnriquecidos).length > 0 || reactiva || desactiva;

      if (!huboCambioEscalar && !cambiaRoles) {
        return tx.proveedor.findUniqueOrThrow({
          where: { id: datos.id },
          include: incluirRolesYConteo,
        });
      }

      if (huboCambioEscalar) {
        // `cambios` ya trae nombre/enriquecidos/activo + auditoría según corresponda.
        await tx.proveedor.update({ where: { id: datos.id }, data: cambios });
      } else if (cambiaRoles) {
        // Solo cambiaron roles: deja constancia de la modificación (modificadoPorId/En).
        await tx.proveedor.update({
          where: { id: datos.id },
          data: { ...datosModificacion(sesion) },
        });
      }

      if (cambiaNombre || Object.keys(detalleEnriquecidos).length > 0 || reactiva || cambiaRoles) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Proveedor',
          idEntidad: datos.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: datos.nombre } } : {}),
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
      if (unicidadDeCampo(error, 'nombre_corto')) {
        throw new ErrorConflicto('Ese campo corto ya lo usa otro proveedor.', { causa: error });
      }
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
 * filtrar por `rol` (R15), el único clasificador desde que se retiró el `tipo`.
 *
 * @example
 * const pagina = await listarProveedores(sesion, { rol: 4 });
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
 * `ProveedorArchivo` y su `Archivo` y, TRAS el commit, borra el OBJETO físico de R2 en
 * modo BEST-EFFORT (0.081a: antes el objeto se quedaba en el bucket para siempre). Si R2
 * falla NO revierte el borrado del registro. Requiere `proveedores.administrar`. Si el
 * adjunto no pertenece a ese proveedor → `ErrorNoEncontrado`.
 *
 * ⚠️ Llamar SIEMPRE a NIVEL SUPERIOR (sin pasar un `bd.tx` ya abierto): el borrado físico
 * corre DESPUÉS del commit — ver {@link eliminarObjetosBestEffort}.
 */
export async function quitarAdjuntoProveedor(
  sesion: SesionUsuario,
  idProveedor: number,
  idArchivo: string,
  bd?: ContextoBd,
  archivos?: ServicioArchivos,
): Promise<void> {
  verificarPermiso(sesion, 'proveedores.administrar');

  // La key del objeto R2 se captura DENTRO de la tx para borrarlo best-effort tras el commit.
  const keyR2 = await enTransaccion(async (tx) => {
    const adjunto = await tx.proveedorArchivo.findFirst({
      where: { idProveedor, idArchivo },
      include: { archivo: { select: { key: true, nombreOriginal: true } } },
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

    return adjunto.archivo.key;
  }, bd);

  await eliminarObjetosBestEffort(
    archivos,
    [keyR2],
    `el adjunto del proveedor ${String(idProveedor)}`,
  );
}

// ── Avíos que surte el proveedor (B17, R9 — lado PROVEEDOR de AvioProveedor) ────
//
// El vínculo avío↔proveedor (R1) ya se administra desde el AVÍO (`avios.ts`,
// `avios.administrar`). B17 abre la MISMA relación desde el PROVEEDOR ("avíos que
// surte" con asignar/quitar) para la pantalla de Proveedores (proto `drawerProveedor`).
// Se gobierna con `proveedores.*` (el permiso de la pantalla), SIN permiso nuevo — el
// avío es un sub-catálogo embebido, mismo criterio que "los proveedores de un avío se
// gobiernan con `avios.administrar`" (permisos.ts). Cada acción es UNA transacción (A2)
// con auditoría (A7) sobre la entidad `Proveedor`. La relación es la misma tabla que
// edita el avío, así que asignar/quitar aquí se refleja allá (y viceversa).

/** Proyecta el include estándar de un avío surtido a la forma de salida (decimales → number). */
const seleccionAvioSurtido = {
  idAvio: true,
  precio: true,
  condiciones: true,
  avio: { select: { clave: true, descripcion: true } },
} satisfies Prisma.AvioProveedorSelect;

/** Fila de `AvioProveedor` con el avío embebido, tal como la trae `seleccionAvioSurtido`. */
type FilaAvioSurtido = Prisma.AvioProveedorGetPayload<{ select: typeof seleccionAvioSurtido }>;

/** Convierte una fila de avío surtido a la forma de salida del contrato (B17). */
function aProveedorAvioSalida(fila: FilaAvioSurtido): ProveedorAvioSalida {
  return {
    idAvio: fila.idAvio,
    clave: fila.avio.clave,
    descripcion: fila.avio.descripcion,
    precio: fila.precio === null ? null : Number(fila.precio),
    condiciones: fila.condiciones,
  };
}

/**
 * Exige que el avío exista y esté ACTIVO (no se puede asignar uno desactivado). Devuelve
 * su clave para los mensajes/bitácora. Lanza `ErrorNoEncontrado` si no existe o
 * `ErrorValidacion` si está inactivo. Simétrico a `exigirProveedoresValidos` del avío.
 */
async function exigirAvioActivo(tx: Tx, idAvio: number): Promise<{ clave: string }> {
  const avio = await tx.avio.findUnique({
    where: { id: idAvio },
    select: { clave: true, activo: true },
  });
  if (avio === null) {
    throw new ErrorNoEncontrado('Avio', idAvio);
  }
  if (!avio.activo) {
    throw new ErrorValidacion(`El avío "${avio.clave}" está desactivado y no se puede asignar.`);
  }
  return { clave: avio.clave };
}

/**
 * Lista los avíos que surte un proveedor (B17), cada uno con SU precio/condiciones. Requiere
 * `proveedores.ver`. Exige que el proveedor exista. Ordenado por clave del avío.
 */
export async function listarAviosDeProveedor(
  sesion: SesionUsuario,
  idProveedor: number,
  bd?: ContextoBd,
): Promise<ProveedorAvioSalida[]> {
  verificarPermiso(sesion, 'proveedores.ver');
  const cliente = clienteLectura(bd);
  const proveedor = await cliente.proveedor.findUnique({
    where: { id: idProveedor },
    select: { id: true },
  });
  if (proveedor === null) {
    throw new ErrorNoEncontrado('Proveedor', idProveedor);
  }
  const filas = await cliente.avioProveedor.findMany({
    where: { idProveedor },
    select: seleccionAvioSurtido,
    orderBy: { avio: { clave: 'asc' } },
  });
  return filas.map(aProveedorAvioSalida);
}

/**
 * Asigna un avío que surte el proveedor (B17): crea el vínculo `AvioProveedor` con su precio y
 * condiciones, en UNA transacción (A2). Requiere `proveedores.administrar`; el avío debe existir
 * y estar activo; si el proveedor ya surte ese avío → `ErrorConflicto` (para cambiar el precio se
 * quita y se re-asigna, o se edita desde el catálogo de avíos). Bitácora sobre `Proveedor` (A7).
 * Devuelve la lista actualizada de avíos que surte (para refrescar la UI en un viaje).
 */
export async function asignarAvioProveedor(
  sesion: SesionUsuario,
  idProveedor: number,
  entrada: DatosProveedorAvioAsignar,
  bd?: ContextoBd,
): Promise<ProveedorAvioSalida[]> {
  verificarPermiso(sesion, 'proveedores.administrar');
  const datos = validarEntrada(esquemaProveedorAvioAsignar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirProveedor(tx, idProveedor);
      const avio = await exigirAvioActivo(tx, datos.idAvio);

      const existente = await tx.avioProveedor.findUnique({
        where: { idAvio_idProveedor: { idAvio: datos.idAvio, idProveedor } },
        select: { idAvio: true },
      });
      if (existente !== null) {
        throw new ErrorConflicto(`Este proveedor ya surte el avío "${avio.clave}".`);
      }

      await tx.avioProveedor.create({
        data: {
          idAvio: datos.idAvio,
          idProveedor,
          ...(datos.precio === undefined ? {} : { precio: datos.precio }),
          ...(datos.condiciones === undefined || datos.condiciones === ''
            ? {}
            : { condiciones: datos.condiciones }),
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'Proveedor',
        idEntidad: idProveedor,
        accion: 'MODIFICAR',
        datos: {
          avio: 'asignar',
          idAvio: datos.idAvio,
          clave: avio.clave,
          ...(datos.precio === undefined ? {} : { precio: datos.precio }),
        },
      });

      const filas = await tx.avioProveedor.findMany({
        where: { idProveedor },
        select: seleccionAvioSurtido,
        orderBy: { avio: { clave: 'asc' } },
      });
      return filas.map(aProveedorAvioSalida);
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Este proveedor ya surte ese avío.', { causa: error });
    }
    throw error;
  }
}

/**
 * Quita un avío que surte el proveedor (B17): borra el vínculo `AvioProveedor`, en UNA
 * transacción (A2). Requiere `proveedores.administrar`. Si el proveedor no surte ese avío →
 * `ErrorNoEncontrado`. Bitácora sobre `Proveedor` (A7). Devuelve la lista actualizada.
 */
export async function quitarAvioProveedor(
  sesion: SesionUsuario,
  idProveedor: number,
  idAvio: number,
  bd?: ContextoBd,
): Promise<ProveedorAvioSalida[]> {
  verificarPermiso(sesion, 'proveedores.administrar');
  return enTransaccion(async (tx) => {
    const fila = await tx.avioProveedor.findUnique({
      where: { idAvio_idProveedor: { idAvio, idProveedor } },
      select: { avio: { select: { clave: true } } },
    });
    if (fila === null) {
      throw new ErrorNoEncontrado('Avío del proveedor', idAvio);
    }

    await tx.avioProveedor.delete({
      where: { idAvio_idProveedor: { idAvio, idProveedor } },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Proveedor',
      idEntidad: idProveedor,
      accion: 'MODIFICAR',
      datos: { avio: 'quitar', idAvio, clave: fila.avio.clave },
    });

    const filas = await tx.avioProveedor.findMany({
      where: { idProveedor },
      select: seleccionAvioSurtido,
      orderBy: { avio: { clave: 'asc' } },
    });
    return filas.map(aProveedorAvioSalida);
  }, bd);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTACTOS del proveedor (V1-E3f pieza B — §Post-F9.56 punto 1 / §Post-F9.57 punto 1)
// ─────────────────────────────────────────────────────────────────────────────
//
// Antes había UN campo `contacto` con un nombre suelto. Daniel: *"A veces es importante ir
// registrando al vendedor, a la de crédito y cobranza, al encargado del taller, a la supervisora…
// Depende qué tipo de proveedor y qué tipo de puestos se requieren."* Y sobre el puesto: *"sí un
// catálogo de contactos, pero deja el campo abierto qué rol tiene cada persona"* — TEXTO LIBRE.
//
// SIN permisos nuevos: se gobiernan con `proveedores.ver`/`.administrar`, que ya existen. Nada se
// borra físicamente (D3): un contacto que se fue se archiva con `activo = false` y su nombre sigue
// disponible para leer documentos viejos.

/** Un contacto tal como sale del dominio (la ruta lo proyecta al contrato). */
export type ContactoProveedor = ProveedorContacto;

/**
 * Confirma que el contacto EXISTE **y es de ese proveedor**. Un id de contacto ajeno responde 404,
 * no 403 ni un update silencioso a la ficha equivocada (A9: nunca se opera sobre lo ajeno).
 */
async function exigirContactoDelProveedor(
  tx: Tx,
  idProveedor: number,
  idContacto: number,
): Promise<ProveedorContacto> {
  const contacto = await tx.proveedorContacto.findFirst({
    where: { id: idContacto, idProveedor },
  });
  if (contacto === null) {
    throw new ErrorNoEncontrado('ProveedorContacto', idContacto);
  }
  return contacto;
}

/** Lista los contactos de un proveedor. Por omisión solo los activos. Permiso `proveedores.ver`. */
export async function listarContactosProveedor(
  sesion: SesionUsuario,
  idProveedor: number,
  incluirInactivos = false,
  bd?: ContextoBd,
): Promise<ContactoProveedor[]> {
  verificarPermiso(sesion, 'proveedores.ver');
  const cliente = clienteLectura(bd);
  const proveedor = await cliente.proveedor.findUnique({
    where: { id: idProveedor },
    select: { id: true },
  });
  if (proveedor === null) {
    throw new ErrorNoEncontrado('Proveedor', idProveedor);
  }
  return cliente.proveedorContacto.findMany({
    where: { idProveedor, ...(incluirInactivos ? {} : { activo: true }) },
    orderBy: [{ activo: 'desc' }, { nombre: 'asc' }, { id: 'asc' }],
  });
}

/**
 * Agrega un contacto al proveedor, en UNA transacción con su bitácora (A2/A7). El puesto es texto
 * libre (puede ir vacío). No hay unicidad: dos personas pueden llamarse igual, y el mismo nombre
 * puede repetirse con puestos distintos.
 */
export async function crearContactoProveedor(
  sesion: SesionUsuario,
  idProveedor: number,
  entrada: unknown,
  bd?: ContextoBd,
): Promise<ContactoProveedor> {
  verificarPermiso(sesion, 'proveedores.administrar');
  const datos = validarEntrada(esquemaProveedorContactoCrear, entrada);

  return enTransaccion(async (tx) => {
    await exigirProveedor(tx, idProveedor);

    const contacto = await tx.proveedorContacto.create({
      data: {
        idProveedor,
        nombre: datos.nombre,
        puesto: datos.puesto ?? null,
        telefono: datos.telefono ?? null,
        email: datos.email ?? null,
        notas: datos.notas ?? null,
        ...datosCreacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'ProveedorContacto',
      idEntidad: contacto.id,
      accion: 'CREAR',
      datos: { idProveedor, nombre: contacto.nombre, puesto: contacto.puesto },
    });

    return contacto;
  }, bd);
}

/** Campos de TEXTO editables de un contacto (clave del payload === clave del modelo). */
const CAMPOS_TEXTO_CONTACTO = ['nombre', 'puesto', 'telefono', 'email', 'notas'] as const;

/**
 * Edita un contacto (PATCH parcial, misma semántica que el proveedor: omitir = no tocar; `null`/''
 * = borrar) y/o lo archiva/revive con `activo`. Todo en UNA transacción con bitácora (A2/A7).
 *
 * El `nombre` es lo único que no se puede vaciar (un contacto sin nombre no sirve para nada): el
 * esquema lo deja opcional pero NO nullable.
 */
export async function actualizarContactoProveedor(
  sesion: SesionUsuario,
  idProveedor: number,
  idContacto: number,
  entrada: unknown,
  bd?: ContextoBd,
): Promise<ContactoProveedor> {
  verificarPermiso(sesion, 'proveedores.administrar');
  const datos = validarEntrada(esquemaProveedorContactoEditarCuerpo, entrada);

  return enTransaccion(async (tx) => {
    const actual = await exigirContactoDelProveedor(tx, idProveedor, idContacto);

    const cambios: Prisma.ProveedorContactoUpdateInput = { ...datosModificacion(sesion) };
    const detalle: Record<string, unknown> = {};

    for (const campo of CAMPOS_TEXTO_CONTACTO) {
      const crudo = datos[campo];
      if (crudo === undefined) continue;
      const nuevo = crudo === null || crudo === '' ? null : crudo;
      // `nombre` nunca queda en null: el esquema lo exige con ≥1 carácter si viene.
      if (campo === 'nombre' && nuevo === null) continue;
      const anterior = actual[campo];
      if (nuevo !== anterior) {
        (cambios as Record<string, unknown>)[campo] = nuevo;
        detalle[campo] = { de: anterior, a: nuevo };
      }
    }

    const archiva = datos.activo === false && actual.activo;
    const revive = datos.activo === true && !actual.activo;
    if (archiva) {
      cambios.activo = false;
    } else if (revive) {
      cambios.activo = true;
    }

    if (Object.keys(detalle).length === 0 && !archiva && !revive) {
      return actual;
    }

    const actualizado = await tx.proveedorContacto.update({
      where: { id: idContacto },
      data: cambios,
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'ProveedorContacto',
      idEntidad: idContacto,
      // Archivar un contacto es un DESACTIVAR de libro (borrado suave), no un MODIFICAR más.
      accion: archiva ? 'DESACTIVAR' : 'MODIFICAR',
      datos: {
        idProveedor,
        ...detalle,
        ...(archiva ? { operacion: 'archivar', nombre: actual.nombre } : {}),
        ...(revive ? { operacion: 'reactivar' } : {}),
      },
    });

    return actualizado;
  }, bd);
}
