/**
 * Modelos — Módulo 2 (F1-E4): el catálogo de productos. CRUD del `Modelo` (ex tabla
 * `Modelos`, doc `Documentacion_MJD/01-Modelos.md` §2) y el selector de `Genero`.
 *
 * La RECETA/BOM (telas/avíos), el ARTE (bordados/estampados, HIJO del modelo desde V1-E3d) y las
 * FOTOS viven en archivos hermanos (`bom-modelo.ts`, `arte-modelo.ts`, `fotos-modelo.ts`) para no
 * inflar éste: el `Modelo` se da de alta primero y luego se le agregan el BOM, el arte y las
 * fotos. Catálogo GLOBAL (ADR-0007, A9): la unicidad de `codigo` es global.
 *
 * Piezas del patrón conservadas (PLANMAESTRO §9.2): permiso primero (`modelos.ver`/
 * `.administrar`); Zod compartido de `src/contrato`; todo cambio en UNA transacción (A2) con
 * auditoría (A7) + `Bitacora` juntos o nada; borrado SUAVE reversible (`activo` =
 * descontinuar); unicidad de `codigo` validada en la transacción y respaldada por el unique de
 * la base (P2002 → `ErrorConflicto`); listado paginado/ordenado/buscado en SERVIDOR (volumen
 * ~4,987 modelos: la tabla nunca trae todo para filtrar en memoria — cubre la consulta
 * `TodosModelos` del viejo, doc 01-Modelos §3).
 */
import {
  esquemaModeloCrear,
  esquemaModeloEditar,
  type DatosModeloCrearMigracion,
  type DatosModeloEditar,
} from '../../contrato/esquemas/modelo.js';
import { Prisma, type Genero, type Modelo } from '../../datos/index.js';
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
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { cantidadDeBase, cantidadesDeOrdenes } from '../costos/cantidades.js';
import { redondear2 } from '../costos/decimales.js';
import { recalcularEstadoOrdenesDeModelo } from '../produccion/requisitos-orden.js';
import {
  esquemaNumeroProduccion,
  numeroProduccionDeCodigo,
  promoverAProduccionNucleo,
  type ResultadoPromocion,
} from './nomenclatura.js';

/** Alta: campos del esquema compartido (catálogo global, sin `idEmpresa`). */
export type EntradaCrearModelo = z.input<typeof esquemaModeloCrear>;

/** Edición: `id` + cambios parciales (incluye `activo` para descontinuar/reactivar). */
export type EntradaActualizarModelo = z.input<typeof esquemaModeloEditar>;

/** Modelo con su temporada/curva/género/tipo de producto y el conteo de fotos (forma del listado). */
export type ModeloConRelaciones = Modelo & {
  temporada: { nombre: string } | null;
  curvaTalla: { nombre: string } | null;
  genero: { nombre: string } | null;
  tipoProducto: { nombre: string } | null;
  /** Maquilero (costura) cotizado en el desarrollo (R5/B9), o null. */
  maquileroCotizado: { nombre: string } | null;
  /** Modelo PADRE del que nació esta versión (V1-E7b), o null si el modelo es raíz. */
  modeloPadre: { codigo: string } | null;
  /** ⭐ V1-E7d — quien FIRMÓ la revisión de esta versión (§Post-F9.110), o null. */
  revisadoPor: { nombre: string } | null;
  _count: { fotos: number };
  /**
   * URL prefirmada de la foto principal (la primera por orden, luego id), o `null` si no tiene
   * fotos. La resuelve el LISTADO en una sola consulta (sin N+1) para la galería; en las demás
   * salidas (alta/edición/ficha) viene `null` (no aplica) y la proyección la serializa como tal.
   */
  urlFotoPrincipal?: string | null;
  /**
   * Tela PRINCIPAL = nombre de la tela del PRIMER renglón del BOM (mismo orden que la ficha: por
   * nombre de tela). Solo el LISTADO la resuelve (columna del proto `vModelos`, sin N+1); en las
   * demás salidas viene `null` (mismo criterio que `urlFotoPrincipal`).
   */
  telaPrincipal?: string | null;
  /**
   * Existencia total de PT del modelo en la empresa activa (Σ de movimientos vía la vista
   * `existencia_pt`, D3 — la vista es solo CONSULTA, ADR-0010 §3). Solo el LISTADO la resuelve.
   */
  stockPt?: number | null;
  /**
   * Costo UNITARIO del último costeo (F7) del modelo (criterio de la Lista de costos:
   * `costoTotal / cantidadDeBase`). Solo el LISTADO, y solo con `consultas.ver-importes`.
   */
  costoActual?: number | null;
};

/** `include` estándar para traer nombres de relaciones + conteo de fotos. */
export const incluirRelacionesModelo = {
  temporada: { select: { nombre: true } },
  curvaTalla: { select: { nombre: true } },
  genero: { select: { nombre: true } },
  tipoProducto: { select: { nombre: true } },
  maquileroCotizado: { select: { nombre: true } },
  // Linaje de versiones (V1-E7b): el código del padre, para que la ficha pueda decir "Versión 2
  // de CYA-26-71-001" con liga. Un `select` de una columna por un índice: no es un N+1.
  modeloPadre: { select: { codigo: true } },
  // ⭐ V1-E7d — quién firmó la REVISIÓN de esta versión, por NOMBRE: la ficha dice "aprobada por
  // Aurora", no un cuid. Un `select` de una columna por la PK de usuarios: no es un N+1.
  revisadoPor: { select: { nombre: true } },
  _count: { select: { fotos: true } },
} satisfies Prisma.ModeloInclude;

/** Parámetros del listado (los reutiliza la ruta REST en su entrada; tipos nativos). */
const esquemaListarModelosDominio = esquemaPaginacion.extend({
  /** Texto a buscar en el código o la descripción (insensible a mayúsculas). */
  busqueda: z.string().trim().max(200).optional(),
  /** Filtra por temporada. */
  idTemporada: z.number().int().positive().optional(),
  /**
   * Filtro de ORIGEN (§Post-F9.34 punto 2, V1-E3n) — ⭐ **default `todos` desde V1-E8j
   * (§Post-F9.134)**. Antes el default era `produccion`, para que el catálogo no se llenara de los
   * modelos de desarrollo que nunca salen; junto con que **todo modelo nace en desarrollo** eso
   * producía la queja de Daniel —*"generé dos modelos en precosteo… y no los veo en modelos"*—:
   * **la pantalla escondía por defecto justo lo que se acababa de crear.** El motivo viejo sigue
   * siendo válido y **se sirve con la ETAPA visible en cada renglón**, no escondiendo la mitad. Los
   * filtros `produccion` y `desarrollo` siguen ahí para quien quiera una sola cara.
   */
  origen: z.enum(['produccion', 'desarrollo', 'todos']).default('todos'),
  /** Por omisión solo activos; `true` muestra también los descontinuados. */
  incluirInactivos: z.boolean().default(false),
  ordenarPor: z.enum(['codigo', 'descripcion', 'creadoEn']).default('codigo'),
  direccion: z.enum(['asc', 'desc']).default('asc'),
});

/** Parámetros del listado (los reutiliza la ruta REST en su entrada). */
export type ParametrosListarModelos = z.input<typeof esquemaListarModelosDominio>;

/**
 * Unicidad de negocio GLOBAL (ADR-0007): no puede haber dos modelos con el mismo `codigo`,
 * sin importar mayúsculas. Se valida DENTRO de la transacción; la carrera residual la captura
 * el unique de la base (P2002 → `ErrorConflicto`). El mensaje distingue si el existente está
 * activo o descontinuado (invita a reactivar).
 *
 * ⚠️ Desde V1-E3n un modelo puede tener DOS números (`codigo` vigente + `codigoDesarrollo`
 * conservado, §Post-F9.34 punto 5) y **los dos son buscables**. La base los guarda en columnas
 * distintas, así que sus `@unique` NO impiden que el `codigo` de un modelo choque con el
 * `codigoDesarrollo` de otro — y ahí una búsqueda por ese texto devolvería dos modelos sin manera
 * de saber cuál es cuál. Por eso la comprobación mira las DOS columnas.
 */
async function exigirCodigoLibre(tx: Tx, codigo: string, idActual?: number): Promise<void> {
  const existente = await tx.modelo.findFirst({
    where: {
      OR: [
        { codigo: { equals: codigo, mode: 'insensitive' } },
        { codigoDesarrollo: { equals: codigo, mode: 'insensitive' } },
      ],
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true, codigo: true, codigoDesarrollo: true },
  });
  if (existente !== null) {
    const esDeDesarrollo = existente.codigo.toLowerCase() !== codigo.toLowerCase();
    const donde = esDeDesarrollo
      ? ` (es el nº de desarrollo del modelo "${existente.codigo}")`
      : '';
    throw new ErrorConflicto(
      existente.activo
        ? `Ya existe un modelo con el código "${codigo}"${donde}.`
        : `Ya existe un modelo con el código "${codigo}"${donde} (está descontinuado; puedes reactivarlo).`,
    );
  }
}

/** Busca un modelo por id o lanza `ErrorNoEncontrado`. */
export async function exigirModelo(tx: Tx, id: number): Promise<Modelo> {
  const modelo = await tx.modelo.findUnique({ where: { id } });
  if (modelo === null) {
    throw new ErrorNoEncontrado('Modelo', id);
  }
  return modelo;
}

/** Una talla de la CURVA del modelo (en el orden de la curva). */
export interface TallaCurvaModelo {
  idTalla: number;
  etiqueta: string;
  /** Posición dentro de la curva (`CurvaTallaItem.posicion`): define el orden de captura. */
  posicion: number;
}

/**
 * Lee las TALLAS DE LA CURVA de un modelo, en el orden de la curva (D4). Devuelve `[]` cuando el
 * modelo no tiene curva asignada — que es distinto de "la curva está vacía", pero para el
 * llamador significa lo mismo: no hay tallas con las que capturar.
 *
 * Es la lista que la ficha del modelo publica (`tallasCurva`) y con la que las medidas por talla
 * de un avío del BOM (R18) arman su matriz: SIN esto nada en el sistema sabía qué tallas ofrecer
 * y la captura por talla no podía nacer (V1-E3c).
 */
export async function leerTallasCurvaModelo(tx: Tx, idModelo: number): Promise<TallaCurvaModelo[]> {
  const modelo = await tx.modelo.findUnique({
    where: { id: idModelo },
    select: { idCurvaTalla: true },
  });
  if (modelo === null || modelo.idCurvaTalla === null) {
    return [];
  }
  const items = await tx.curvaTallaItem.findMany({
    where: { idCurva: modelo.idCurvaTalla },
    select: { idTalla: true, posicion: true, talla: { select: { etiqueta: true } } },
    orderBy: [{ posicion: 'asc' }, { idTalla: 'asc' }],
  });
  return items.map((i) => ({
    idTalla: i.idTalla,
    etiqueta: i.talla.etiqueta,
    posicion: i.posicion,
  }));
}

/** Valida que una temporada (si viene) exista y esté ACTIVA. Lanza `ErrorValidacion` si no. */
async function exigirTemporadaValida(tx: Tx, idTemporada: number): Promise<void> {
  const temporada = await tx.temporada.findUnique({
    where: { id: idTemporada },
    select: { nombre: true, activo: true },
  });
  if (temporada === null) {
    throw new ErrorValidacion('La temporada seleccionada no existe.');
  }
  if (!temporada.activo) {
    throw new ErrorValidacion(
      `La temporada "${temporada.nombre}" está desactivada y no se puede asignar.`,
    );
  }
}

/** Valida que una curva de tallas (si viene) exista y esté ACTIVA. */
async function exigirCurvaValida(tx: Tx, idCurva: number): Promise<void> {
  const curva = await tx.curvaTalla.findUnique({
    where: { id: idCurva },
    select: { nombre: true, activo: true },
  });
  if (curva === null) {
    throw new ErrorValidacion('La curva de tallas seleccionada no existe.');
  }
  if (!curva.activo) {
    throw new ErrorValidacion(
      `La curva de tallas "${curva.nombre}" está desactivada y no se puede asignar.`,
    );
  }
}

/** Valida que un género (si viene) exista y esté ACTIVO. */
async function exigirGeneroValido(tx: Tx, idGenero: number): Promise<void> {
  const genero = await tx.genero.findUnique({
    where: { id: idGenero },
    select: { nombre: true, activo: true },
  });
  if (genero === null) {
    throw new ErrorValidacion('El género seleccionado no existe.');
  }
  if (!genero.activo) {
    throw new ErrorValidacion(
      `El género "${genero.nombre}" está desactivado y no se puede asignar.`,
    );
  }
}

/** Valida que un tipo de producto (si viene) exista y esté ACTIVO (F6-E1). */
async function exigirTipoProductoValido(tx: Tx, idTipoProducto: number): Promise<void> {
  const tipo = await tx.tipoProducto.findUnique({
    where: { id: idTipoProducto },
    select: { nombre: true, activo: true },
  });
  if (tipo === null) {
    throw new ErrorValidacion('El tipo de producto seleccionado no existe.');
  }
  if (!tipo.activo) {
    throw new ErrorValidacion(
      `El tipo de producto "${tipo.nombre}" está desactivado y no se puede asignar.`,
    );
  }
}

/** Construye el `data` de los campos opcionales presentes en el alta (solo los definidos). */
function datosOpcionalesCrear(
  // La forma LAXA (`…Migracion`) es la que sirve a las dos puertas del alta: es un supertipo de la
  // normal —sólo relaja los dos dígitos— y aquí se leen campos que ninguna de las dos exige.
  datos: DatosModeloCrearMigracion,
): Partial<Prisma.ModeloUncheckedCreateInput> {
  const data: Partial<Prisma.ModeloUncheckedCreateInput> = {};
  if (datos.descripcion !== undefined) data.descripcion = datos.descripcion;
  // Composición del DESARROLLO (Daniel 24-jul-2026): '' se guarda como null (nunca cadena vacía).
  if (datos.composicion !== undefined)
    data.composicion = datos.composicion === '' ? null : datos.composicion;
  if (datos.maquilaBase !== undefined) data.maquilaBase = datos.maquilaBase;
  if (datos.idTemporada !== undefined) data.idTemporada = datos.idTemporada;
  if (datos.idCurvaTalla !== undefined) data.idCurvaTalla = datos.idCurvaTalla;
  if (datos.idGenero !== undefined) data.idGenero = datos.idGenero;
  if (datos.idTipoProducto !== undefined) data.idTipoProducto = datos.idTipoProducto;
  // R5, B7/B8/B9/B10: campos del editor de desarrollo.
  if (datos.numOperaciones !== undefined) data.numOperaciones = datos.numOperaciones;
  if (datos.corteBase !== undefined) data.corteBase = datos.corteBase;
  if (datos.idMaquileroCotizado !== undefined) data.idMaquileroCotizado = datos.idMaquileroCotizado;
  if (datos.secuenciaEstampado !== undefined) data.secuenciaEstampado = datos.secuenciaEstampado;
  // ¿Lleva arte? (Daniel 26-jul-2026): omitir = `true` por default de la BD, que es lo que él
  // pidió — la prenda lleva arte MIENTRAS no la desmarquen.
  if (datos.llevaArte !== undefined) data.llevaArte = datos.llevaArte;
  return data;
}

/**
 * Código estable del rol de proveedor "Maquila (costura)" (seed `ROLES_PROVEEDOR_BASE`). El maquilero
 * cotizado es, por definición, de costura → se valida contra ESTE rol (no cualquier proveedor).
 */
const ROL_MAQUILA_COSTURA = 'maquila-costura';

/**
 * Valida que un maquilero cotizado (Proveedor, si viene) exista, esté ACTIVO y tenga el rol
 * "Maquila (costura)" (R5/B9). El front ya filtra por ese rol, pero vía API cualquiera podría fijar
 * un proveedor arbitrario → la autoridad es el servidor (A1).
 */
async function exigirMaquileroValido(tx: Tx, idProveedor: number): Promise<void> {
  const proveedor = await tx.proveedor.findUnique({
    where: { id: idProveedor },
    select: {
      nombre: true,
      activo: true,
      roles: { where: { rol: { codigo: ROL_MAQUILA_COSTURA } }, select: { idProveedor: true } },
    },
  });
  if (proveedor === null) {
    throw new ErrorValidacion('El maquilero cotizado seleccionado no existe.');
  }
  if (!proveedor.activo) {
    throw new ErrorValidacion(
      `El maquilero "${proveedor.nombre}" está desactivado y no se puede asignar.`,
    );
  }
  if (proveedor.roles.length === 0) {
    throw new ErrorValidacion(
      `El proveedor "${proveedor.nombre}" no es maquilero de costura; el maquilero cotizado debe tener el rol "Maquila (costura)".`,
    );
  }
}

/**
 * Compara un decimal capturado (number | null | undefined) con el guardado (Decimal | null).
 * `undefined` = no se tocó. Distingue `null` (vaciar) de un número nuevo. Mismo helper que
 * Tela/Bordado en E3.
 */
function cambiaDecimal(entrada: number | null | undefined, actual: Prisma.Decimal | null): boolean {
  if (entrada === undefined) {
    return false;
  }
  const actualNum = actual === null ? null : actual.toNumber();
  return actualNum !== entrada;
}

/**
 * Aplica los campos opcionales que VENGAN en la edición al `update` y registra qué cambió
 * (para la bitácora). Semántica del PATCH parcial (M1): texto omitido = no tocar; `null`/'' =
 * borrar; número/FK omitido = no tocar; `null` en una FK la quita. Devuelve el detalle de
 * cambios. Mismo patrón que `aplicarOpcionalesEditar` de la tela.
 */
function aplicarOpcionalesEditar(
  datos: DatosModeloEditar,
  actual: Modelo,
  cambios: Prisma.ModeloUncheckedUpdateInput,
): Record<string, unknown> {
  const detalle: Record<string, unknown> = {};

  // descripcion (texto): omitir = no tocar; vacío/`null` = borrar (a null, nunca '').
  if (datos.descripcion !== undefined) {
    const nuevo = datos.descripcion === null || datos.descripcion === '' ? null : datos.descripcion;
    if (nuevo !== actual.descripcion) {
      cambios.descripcion = nuevo;
      detalle.descripcion = { de: actual.descripcion, a: nuevo };
    }
  }

  // composicion (texto, Daniel 24-jul-2026): omitir = no tocar; vacío/`null` = borrar (a null).
  // Cambiarla aquí NO re-deriva las órdenes ya creadas (ver `crearOrden`): las que no tienen
  // override (`compForzada = false`) se re-derivan la próxima vez que se toca la orden.
  if (datos.composicion !== undefined) {
    const nuevo = datos.composicion === null || datos.composicion === '' ? null : datos.composicion;
    if (nuevo !== actual.composicion) {
      cambios.composicion = nuevo;
      detalle.composicion = { de: actual.composicion, a: nuevo };
    }
  }

  // maquilaBase (decimal nullable): omitir = no tocar; `null` = quitar; número = fijar.
  if (cambiaDecimal(datos.maquilaBase, actual.maquilaBase)) {
    const nuevo = datos.maquilaBase ?? null;
    cambios.maquilaBase = nuevo;
    detalle.maquilaBase = {
      de: actual.maquilaBase === null ? null : actual.maquilaBase.toNumber(),
      a: nuevo,
    };
  }

  // FKs (idTemporada/idCurvaTalla/idGenero): `null` quita; un id fija; omitir = no tocar.
  if (datos.idTemporada !== undefined && datos.idTemporada !== actual.idTemporada) {
    cambios.idTemporada = datos.idTemporada;
    detalle.idTemporada = { de: actual.idTemporada, a: datos.idTemporada };
  }
  if (datos.idCurvaTalla !== undefined && datos.idCurvaTalla !== actual.idCurvaTalla) {
    cambios.idCurvaTalla = datos.idCurvaTalla;
    detalle.idCurvaTalla = { de: actual.idCurvaTalla, a: datos.idCurvaTalla };
  }
  if (datos.idGenero !== undefined && datos.idGenero !== actual.idGenero) {
    cambios.idGenero = datos.idGenero;
    detalle.idGenero = { de: actual.idGenero, a: datos.idGenero };
  }
  if (datos.idTipoProducto !== undefined && datos.idTipoProducto !== actual.idTipoProducto) {
    cambios.idTipoProducto = datos.idTipoProducto;
    detalle.idTipoProducto = { de: actual.idTipoProducto, a: datos.idTipoProducto };
  }

  // R5, B7: # de operaciones (int nullable): omitir = no tocar; `null` = quitar; número = fijar.
  if (datos.numOperaciones !== undefined && datos.numOperaciones !== actual.numOperaciones) {
    cambios.numOperaciones = datos.numOperaciones;
    detalle.numOperaciones = { de: actual.numOperaciones, a: datos.numOperaciones };
  }
  // R5, B8: corte (decimal nullable): omitir = no tocar; `null` = quitar; número = fijar.
  if (cambiaDecimal(datos.corteBase, actual.corteBase)) {
    const nuevo = datos.corteBase ?? null;
    cambios.corteBase = nuevo;
    detalle.corteBase = {
      de: actual.corteBase === null ? null : actual.corteBase.toNumber(),
      a: nuevo,
    };
  }
  // R5, B9: maquilero cotizado (FK nullable): `null` lo quita; un id lo fija; omitir = no tocar.
  if (
    datos.idMaquileroCotizado !== undefined &&
    datos.idMaquileroCotizado !== actual.idMaquileroCotizado
  ) {
    cambios.idMaquileroCotizado = datos.idMaquileroCotizado;
    detalle.idMaquileroCotizado = {
      de: actual.idMaquileroCotizado,
      a: datos.idMaquileroCotizado,
    };
  }
  // R5, B10: secuencia de estampado (enum, no nullable): omitir = no tocar.
  if (
    datos.secuenciaEstampado !== undefined &&
    datos.secuenciaEstampado !== actual.secuenciaEstampado
  ) {
    cambios.secuenciaEstampado = datos.secuenciaEstampado;
    detalle.secuenciaEstampado = { de: actual.secuenciaEstampado, a: datos.secuenciaEstampado };
  }
  // ¿Lleva arte? (booleano con default `true`, no nullable): omitir = no tocar. Cambiarlo mueve el
  // estado de las órdenes del modelo (requisito ARTE), por eso queda en el detalle de bitácora.
  if (datos.llevaArte !== undefined && datos.llevaArte !== actual.llevaArte) {
    cambios.llevaArte = datos.llevaArte;
    detalle.llevaArte = { de: actual.llevaArte, a: datos.llevaArte };
  }

  return detalle;
}

/**
 * MARCA de nomenclatura con la que un modelo entra al catálogo: en qué mitad vive y qué números
 * lleva. Es lo ÚNICO que distingue el alta normal del modo migración, y por eso viaja como dato al
 * núcleo en vez de como bandera: el núcleo no sabe —ni tiene que saber— quién lo llamó.
 */
export interface MarcaNomenclaturaModelo {
  origen: 'desarrollo' | 'produccion';
  codigoDesarrollo: string | null;
  numeroProduccion: number | null;
}

/** La marca del alta normal (V1-E8j): nace en DESARROLLO, sin nº de producción (§Post-F9.134). */
export function marcaDesarrollo(codigo: string): MarcaNomenclaturaModelo {
  return {
    origen: 'desarrollo',
    // El código VIGENTE y el de DESARROLLO valen lo mismo mientras el modelo es de desarrollo
    // (§Post-F9.34 punto 5): cuando la promoción sustituya el código por el número, el que se
    // tecleó aquí NO se pierde y sigue siendo buscable (D3).
    codigoDesarrollo: codigo,
    // El nº lo estrena la promoción, que es la única que toma el lock de la serie.
    numeroProduccion: null,
  };
}

/**
 * ⭐ V1-E8j — LOS DOS DÍGITOS SON OBLIGATORIOS EN EL ALTA (§Post-F9.134).
 *
 * El tipo de prenda da el dígito de CONCEPTO y el género el de GÉNERO (§Post-F9.83): con ellos el
 * sistema arma el nº de producción de 5 dígitos. Desde que **todo modelo nace en desarrollo**, uno
 * sin ellos es un callejón sin salida — y no uno teórico: **rompía la importación de la OC del
 * cliente**, porque generar la OP promueve el modelo y `digitosDelModelo` no tenía de dónde
 * sacarlos; al ser `confirmarImportacion` UNA transacción (A2), se caía el pedido entero.
 *
 * No es una regla nueva: el alta de DESARROLLO (`crearDesarrolloConModeloNuevo`) ya exigía las dos
 * cosas y con el mismo criterio —que el catálogo tenga el dígito capturado, no sólo que se haya
 * elegido algo—. Esto ALINEA la segunda puerta con la primera.
 *
 * ⚠️ Vive aquí, en `crearModelo`, y NO en el núcleo: el modo migración entra por debajo (los ~4,987
 * modelos del Access no traen género y ya son de producción con su número puesto, así que no hay
 * nada que numerar). *La misma regla en dos capas deriva; ésta tiene una sola.*
 */
async function exigirDigitosDeNomenclatura(
  tx: Tx,
  idTipoProducto: number,
  idGenero: number,
): Promise<void> {
  const [tipo, genero] = await Promise.all([
    tx.tipoProducto.findUnique({
      where: { id: idTipoProducto },
      select: { nombre: true, digitoConcepto: true },
    }),
    tx.genero.findUnique({
      where: { id: idGenero },
      select: { nombre: true, digitoNomenclatura: true },
    }),
  ]);
  if (tipo !== null && tipo.digitoConcepto === null) {
    throw new ErrorValidacion(
      `El tipo de prenda "${tipo.nombre}" no tiene dígito de concepto capturado, y sin él el ` +
        `modelo no podría recibir su número de producción. Captúralo en su catálogo.`,
    );
  }
  if (genero !== null && genero.digitoNomenclatura === null) {
    throw new ErrorValidacion(
      `El género "${genero.nombre}" no tiene dígito de nomenclatura capturado, y sin él el modelo ` +
        `no podría recibir su número de producción. Captúralo en su catálogo.`,
    );
  }
}

/**
 * ⭐ V1-E8j · H9 — LA PUERTA TAMBIÉN SE CIERRA EN LA EDICIÓN (§Post-F9.134).
 *
 * El alta ya no deja NACER un modelo innumerable… pero la edición dejaba **convertir** uno: dos
 * clics en la ficha (*«Sin género»*) y el modelo de desarrollo se quedaba sin sus dos dígitos. El
 * estado final es idéntico al que esta etapa vino a cerrar — la OP no se puede generar y, como
 * `confirmarImportacion` es UNA transacción (A2), **se cae el pedido entero de la OC**.
 *
 * Y el fallback por `codigoDesarrollo` NO salva: sólo lee los dígitos si el código tiene la forma
 * `CYA-26-71-001`, y el alta del catálogo admite cualquier texto.
 *
 * ⚠️ **Sólo aplica a los modelos de DESARROLLO.** En los de PRODUCCIÓN se deja vaciar, y ahí está la
 * razón de la laxitud original: los ~4,987 migrados del Access son `origen: 'produccion'`, no traen
 * género, y exigírselo bloquearía su ficha entera para corregir cualquier otra cosa. Esa razón
 * **nunca aplicó a los de desarrollo**, que son justo los que necesitan el número.
 */
function exigirNoDesnumerar(
  datos: DatosModeloEditar,
  actual: Pick<Modelo, 'origen' | 'codigo'>,
): void {
  if (actual.origen !== 'desarrollo') {
    return;
  }
  if (datos.idTipoProducto === null) {
    throw new ErrorValidacion(
      `No se puede quitarle el tipo de prenda al modelo "${actual.codigo}": es el primer dígito de ` +
        `su número, y sin él no se le podría dar su número de producción. Cámbialo por otro.`,
    );
  }
  if (datos.idGenero === null) {
    throw new ErrorValidacion(
      `No se puede quitarle el género al modelo "${actual.codigo}": es el segundo dígito de su ` +
        `número, y sin él no se le podría dar su número de producción. Cámbialo por otro.`,
    );
  }
}

/**
 * NÚCLEO del alta de modelo, compartido por el alta normal (`crearModelo`) y el modo migración
 * (`migracion.ts` → `crearModeloMigrado`). Mismo patrón que `promoverAProduccionNucleo` y
 * `ligarOrdenNucleo`: las dos puertas aplican las MISMAS reglas dentro de la MISMA transacción (A2).
 *
 * Hace todo lo común —código único global, FKs existentes y activas, la fila, la auditoría y la
 * bitácora (A7)— y recibe la NOMENCLATURA ya decidida por quien llama. Lo que deliberadamente **no**
 * hace es exigir los dos dígitos: esa regla es del alta normal y vive en `crearModelo`.
 */
export async function crearModeloNucleo(
  tx: Tx,
  sesion: SesionUsuario,
  datos: DatosModeloCrearMigracion,
  marca: MarcaNomenclaturaModelo,
): Promise<ModeloConRelaciones> {
  await exigirCodigoLibre(tx, datos.codigo);
  if (datos.idTemporada !== undefined) await exigirTemporadaValida(tx, datos.idTemporada);
  if (datos.idCurvaTalla !== undefined) await exigirCurvaValida(tx, datos.idCurvaTalla);
  if (datos.idGenero !== undefined) await exigirGeneroValido(tx, datos.idGenero);
  if (datos.idTipoProducto !== undefined) await exigirTipoProductoValido(tx, datos.idTipoProducto);
  if (datos.idMaquileroCotizado !== undefined)
    await exigirMaquileroValido(tx, datos.idMaquileroCotizado);

  const modelo = await tx.modelo.create({
    data: {
      codigo: datos.codigo,
      ...marca,
      ...datosOpcionalesCrear(datos),
      ...datosCreacion(sesion),
    },
  });

  await registrarBitacora(tx, sesion, {
    entidad: 'Modelo',
    idEntidad: modelo.id,
    accion: 'CREAR',
    datos: { codigo: modelo.codigo, idTemporada: modelo.idTemporada, origen: marca.origen },
  });

  return tx.modelo.findUniqueOrThrow({
    where: { id: modelo.id },
    include: incluirRelacionesModelo,
  });
}

/**
 * Traduce el choque contra el `@unique` de `codigo` en un `ErrorConflicto` con el mensaje del
 * negocio. Lo comparten las dos puertas del alta (la carrera residual que `exigirCodigoLibre` no
 * alcanza a ver la captura la base, y el mensaje tiene que ser el mismo por las dos).
 */
export async function conConflictoDeCodigo<T>(codigo: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un modelo con el código "${codigo}".`, { causa: error });
    }
    throw error;
  }
}

/**
 * Crea un modelo del catálogo (global) en UNA transacción (A2). Reglas: permiso
 * `modelos.administrar`; `codigo` único global → `ErrorConflicto`; temporada/curva/género/tipo/
 * maquilero existentes y ACTIVOS; nace activo y SIN BOM ni fotos (se capturan aparte); auditoría y
 * bitácora en la misma transacción (A7).
 *
 * ⭐ **V1-E8j (§Post-F9.134) — TODO MODELO NACE EN DESARROLLO.** Antes esta función lo dejaba **en
 * producción** (el default de la columna) y le derivaba su nº del código. Esa puerta se cerró por
 * decisión de Daniel: *"nunca va a pasar que dé de alta un modelo de producción si no tiene ya una
 * orden asignada"*. El catálogo de producción se llena por **pasar a producción**
 * (`nomenclatura.ts` → `promoverAProduccionNucleo`), que es quien asigna el nº de 5 dígitos con su
 * lock de serie; un modelo que naciera directo en producción se saltaría todo lo que Desarrollo pone
 * antes (precosteo, receta revisada, precio aprobado, linaje) y llegaría **sin con qué costearse**.
 *
 * ⭐ Y por eso mismo **exige el tipo de prenda y el género** ({@link exigirDigitosDeNomenclatura}):
 * son los dos dígitos con los que después se le arma el número, y un modelo de desarrollo sin ellos
 * no se puede promover.
 *
 * ⚠️ El **ETL del histórico** carga ~4,987 modelos que SÍ son de producción, sin orden y sin género:
 * no pasa por aquí, sino por `modelos/migracion.ts` → `crearModeloMigrado`, que comparte el
 * {@link crearModeloNucleo} y entra **por debajo** de la regla de los dígitos.
 *
 * @example
 * const m = await crearModelo(sesion, {
 *   codigo: "CYA-26-71-001", descripcion: "Sudadera", idTipoProducto: 7, idGenero: 1,
 * });
 */
export async function crearModelo(
  sesion: SesionUsuario,
  entrada: EntradaCrearModelo,
  bd?: ContextoBd,
): Promise<ModeloConRelaciones> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaModeloCrear, entrada);

  return conConflictoDeCodigo(datos.codigo, () =>
    enTransaccion(async (tx) => {
      // ⭐ La regla del alta normal, ANTES del núcleo (el modo migración entra por debajo).
      await exigirDigitosDeNomenclatura(tx, datos.idTipoProducto, datos.idGenero);
      return crearModeloNucleo(tx, sesion, datos, marcaDesarrollo(datos.codigo));
    }, bd),
  );
}

/**
 * Actualiza un modelo: datos generales y/o `activo` para descontinuar (borrado suave) o
 * reactivar. Todo en UNA transacción (A2). El BOM NO se toca aquí (tiene sus propios
 * endpoints). Bitácora según lo que pasó: `MODIFICAR` con el detalle, y/o `DESACTIVAR` si se
 * descontinuó.
 */
export async function actualizarModelo(
  sesion: SesionUsuario,
  entrada: EntradaActualizarModelo,
  bd?: ContextoBd,
): Promise<ModeloConRelaciones> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaModeloEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirModelo(tx, datos.id);

      const cambiaCodigo = datos.codigo !== undefined && datos.codigo !== actual.codigo;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      // ⭐ H9 — un modelo de DESARROLLO no puede quedarse sin sus dos dígitos por la vía de la
      // edición: el alta ya no deja crearlo así, y esto cierra la otra mitad de la misma puerta.
      exigirNoDesnumerar(datos, actual);

      const cambios: Prisma.ModeloUncheckedUpdateInput = { ...datosModificacion(sesion) };
      const detalleOpcionales = aplicarOpcionalesEditar(datos, actual, cambios);
      if (cambiaCodigo && datos.codigo !== undefined) {
        cambios.codigo = datos.codigo;
        // El nº de producción sigue al código: renombrar un modelo a `71005` lo hace ocupar ese
        // consecutivo, y sacarlo de la forma de 5 dígitos lo libera. En un modelo de DESARROLLO
        // se queda en null (lo exige el CHECK de la base; su número lo estrena la promoción).
        cambios.numeroProduccion =
          actual.origen === 'desarrollo' ? null : numeroProduccionDeCodigo(datos.codigo);
        // ⭐ V1-E8j — y en un modelo de DESARROLLO el nº de desarrollo VIAJA CON EL CÓDIGO: los dos
        // valen lo mismo mientras vive ahí (§Post-F9.34 punto 5). Sin esto, renombrar dejaba el
        // viejo colgado en la otra columna y el modelo quedaba con DOS códigos buscables, ninguno
        // de los cuales era el que se ve. Desde que todo modelo nace en desarrollo, renombrarlo es
        // el caso NORMAL, no el raro. En producción no se toca: ahí el nº de desarrollo es historia
        // congelada (D3).
        if (actual.origen === 'desarrollo') {
          cambios.codigoDesarrollo = datos.codigo;
        }
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      if (cambiaCodigo) {
        await exigirCodigoLibre(tx, datos.codigo ?? actual.codigo, datos.id);
      } else if (reactiva) {
        await exigirCodigoLibre(tx, actual.codigo, datos.id);
      }

      // Si se asignan FKs nuevas (no null), validarlas (existen y activas).
      if (
        datos.idTemporada !== undefined &&
        datos.idTemporada !== null &&
        datos.idTemporada !== actual.idTemporada
      ) {
        await exigirTemporadaValida(tx, datos.idTemporada);
      }
      if (
        datos.idCurvaTalla !== undefined &&
        datos.idCurvaTalla !== null &&
        datos.idCurvaTalla !== actual.idCurvaTalla
      ) {
        await exigirCurvaValida(tx, datos.idCurvaTalla);
      }
      if (
        datos.idGenero !== undefined &&
        datos.idGenero !== null &&
        datos.idGenero !== actual.idGenero
      ) {
        await exigirGeneroValido(tx, datos.idGenero);
      }
      if (
        datos.idTipoProducto !== undefined &&
        datos.idTipoProducto !== null &&
        datos.idTipoProducto !== actual.idTipoProducto
      ) {
        await exigirTipoProductoValido(tx, datos.idTipoProducto);
      }
      if (
        datos.idMaquileroCotizado !== undefined &&
        datos.idMaquileroCotizado !== null &&
        datos.idMaquileroCotizado !== actual.idMaquileroCotizado
      ) {
        await exigirMaquileroValido(tx, datos.idMaquileroCotizado);
      }

      const huboCambio =
        cambiaCodigo || Object.keys(detalleOpcionales).length > 0 || reactiva || desactiva;

      if (!huboCambio) {
        return tx.modelo.findUniqueOrThrow({
          where: { id: datos.id },
          include: incluirRelacionesModelo,
        });
      }

      await tx.modelo.update({ where: { id: datos.id }, data: cambios });

      if (cambiaCodigo || Object.keys(detalleOpcionales).length > 0 || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Modelo',
          idEntidad: datos.id,
          accion: 'MODIFICAR',
          datos: {
            ...(cambiaCodigo ? { codigo: { de: actual.codigo, a: datos.codigo } } : {}),
            ...detalleOpcionales,
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Modelo',
          idEntidad: datos.id,
          accion: 'DESACTIVAR',
          datos: { codigo: actual.codigo },
        });
      }

      // "Lleva arte" es un REQUISITO del estado automático de la orden (Daniel 26-jul-2026):
      // desmarcarlo puede COMPLETAR sola a una orden a la que solo le faltaba el arte. Se recalcula
      // en la MISMA transacción (A2) y, como todo recálculo por catálogo, SOLO puede completar —
      // marcar "sí lleva" nunca degrada lo ya completo (ver `recalcularEstadoOrdenesDeModelo`).
      if (detalleOpcionales.llevaArte !== undefined) {
        await recalcularEstadoOrdenesDeModelo(tx, sesion, datos.id, 'lleva-arte');
      }

      return tx.modelo.findUniqueOrThrow({
        where: { id: datos.id },
        include: incluirRelacionesModelo,
      });
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un modelo con ese código.', { causa: error });
    }
    throw error;
  }
}

/**
 * Descontinúa (borrado SUAVE) un modelo: deja de aparecer en capturas pero su historial, BOM
 * y fotos quedan intactos. Descontinuar dos veces es `ErrorConflicto`. Atajo del botón
 * "Descontinuar".
 */
export async function descontinuarModelo(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ModeloConRelaciones> {
  verificarPermiso(sesion, 'modelos.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirModelo(tx, id);
    if (!actual.activo) {
      throw new ErrorConflicto(`El modelo "${actual.codigo}" ya está descontinuado.`);
    }
    return actualizarModelo(sesion, { id, activo: false }, { tx });
  }, bd);
}

/** Reactiva un modelo descontinuado (operación inversa del borrado suave). */
export async function reactivarModelo(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ModeloConRelaciones> {
  verificarPermiso(sesion, 'modelos.administrar');
  return enTransaccion(async (tx) => {
    const actual = await exigirModelo(tx, id);
    if (actual.activo) {
      throw new ErrorConflicto(`El modelo "${actual.codigo}" ya está activo.`);
    }
    return actualizarModelo(sesion, { id, activo: true }, { tx });
  }, bd);
}

/** Resultado de «pasar a producción»: el modelo ya promovido + el detalle de la promoción. */
export interface ModeloPromovido extends ResultadoPromocion {
  modelo: ModeloConRelaciones;
}

/**
 * Pasa un modelo de DESARROLLO al catálogo de PRODUCCIÓN (§Post-F9.34 punto 4 / §Post-F9.46): le
 * asigna el nº de 5 dígitos —el que propone el sistema, o el que capture Daniel— y lo saca del
 * filtro de desarrollo. **Nada se pierde (D3):** conserva su `codigoDesarrollo` (buscable) y todo
 * lo que cuelga del modelo (BOM, arte, fotos, precosteo, listas, órdenes) sigue igual, porque nada
 * de eso apunta al código: apuntan al `id`, que no cambia.
 *
 * Todo en UNA transacción (A2) con el lock del par y la bitácora dentro (A7). El re-leído del
 * modelo va en la MISMA transacción a propósito: así el llamador ve la promoción ya aplicada sin
 * exigirle además `modelos.ver`.
 */
export async function pasarModeloAProduccion(
  sesion: SesionUsuario,
  id: number,
  entrada: { numeroProduccion?: number | undefined } = {},
  bd?: ContextoBd,
): Promise<ModeloPromovido> {
  verificarPermiso(sesion, 'modelos.administrar');
  const numero =
    entrada.numeroProduccion === undefined
      ? undefined
      : esquemaNumeroProduccion.parse(entrada.numeroProduccion);

  try {
    return await enTransaccion(async (tx) => {
      const resultado = await promoverAProduccionNucleo(tx, sesion, id, numero);
      const modelo = await tx.modelo.findUniqueOrThrow({
        where: { id },
        include: incluirRelacionesModelo,
      });
      return { ...resultado, modelo };
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      // Carrera residual contra otra promoción del mismo número (el lock cubre el par del
      // catálogo; un número capturado de OTRO par se sale de él). Mensaje claro, no P2002 crudo.
      throw new ErrorConflicto('Ese número de producción ya está ocupado por otro modelo.', {
        causa: error,
      });
    }
    throw error;
  }
}

/** Obtiene un modelo por id (datos generales + relaciones + conteo de fotos), o lanza `ErrorNoEncontrado`. */
export async function obtenerModelo(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<ModeloConRelaciones> {
  verificarPermiso(sesion, 'modelos.ver');
  const modelo = await clienteLectura(bd).modelo.findUnique({
    where: { id },
    include: incluirRelacionesModelo,
  });
  if (modelo === null) {
    throw new ErrorNoEncontrado('Modelo', id);
  }
  return modelo;
}

/**
 * Lista modelos con búsqueda, orden y paginación EN SERVIDOR (volumen ~4,987: la tabla de la
 * UI nunca trae todo para filtrar en memoria — cubre `TodosModelos` del viejo). Por defecto:
 * solo activos. La búsqueda cubre `codigo` O `descripcion`; filtro opcional `idTemporada`.
 *
 * @example
 * const pagina = await listarModelos(sesion, { idTemporada: 2, busqueda: "sudadera" });
 */
export async function listarModelos(
  sesion: SesionUsuario,
  parametros: ParametrosListarModelos = {},
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<Pagina<ModeloConRelaciones>> {
  verificarPermiso(sesion, 'modelos.ver');
  const filtros = validarEntrada(esquemaListarModelosDominio, parametros);

  const where: Prisma.ModeloWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    // El filtro de origen es lo que separa los dos catálogos (§Post-F9.34 punto 2).
    ...(filtros.origen === 'todos' ? {} : { origen: filtros.origen }),
    ...(filtros.idTemporada === undefined ? {} : { idTemporada: filtros.idTemporada }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : {
          OR: [
            { codigo: { contains: filtros.busqueda, mode: 'insensitive' } },
            // Un modelo promovido tiene DOS números y los DOS son buscables (§Post-F9.34 punto 5):
            // buscar por su viejo `CYA-26-71-001` lo encuentra aunque hoy se llame `71001`.
            { codigoDesarrollo: { contains: filtros.busqueda, mode: 'insensitive' } },
            { descripcion: { contains: filtros.busqueda, mode: 'insensitive' } },
          ],
        }),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.modelo.count({ where }),
    cliente.modelo.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: incluirRelacionesModelo,
      ...rangoPrisma(filtros),
    }),
  ]);

  const conFoto = await adjuntarFotoPrincipal(cliente, datos, archivos);
  const conAgregados = await adjuntarAgregadosListado(cliente, sesion, conFoto, bd);
  return armarPagina(conAgregados, total, filtros);
}

/**
 * Resuelve la FOTO PRINCIPAL de cada modelo de la página en UNA sola consulta (sin N+1) y
 * adjunta su URL de descarga prefirmada (`urlFotoPrincipal`), para que la galería pinte la
 * miniatura sin pedir una foto por celda. La "principal" es la primera por `orden` (luego `id`)
 * — la misma que encabeza el carrusel del modelo. Modelos sin fotos quedan con `null`.
 *
 * Detalle de la consulta única: se traen TODAS las fotos de los modelos de la página de un
 * golpe (`idModelo in [...]`), ordenadas; al recorrerlas, la PRIMERA de cada modelo es su
 * principal (el resto se ignora). Las URLs prefirmadas se generan en paralelo.
 */
async function adjuntarFotoPrincipal(
  cliente: ReturnType<typeof clienteLectura>,
  modelos: ModeloConRelaciones[],
  archivos: ServicioArchivos,
): Promise<ModeloConRelaciones[]> {
  const conFotos = modelos.filter((m) => m._count.fotos > 0).map((m) => m.id);
  if (conFotos.length === 0) {
    return modelos.map((m) => ({ ...m, urlFotoPrincipal: null }));
  }

  const fotos = await cliente.modeloFoto.findMany({
    where: { idModelo: { in: conFotos } },
    orderBy: [{ orden: 'asc' }, { id: 'asc' }],
    select: { idModelo: true, archivo: { select: { key: true } } },
  });

  // La primera foto de cada modelo (por el orden de la consulta) es su principal.
  const keyPrincipalPorModelo = new Map<number, string>();
  for (const foto of fotos) {
    if (!keyPrincipalPorModelo.has(foto.idModelo)) {
      keyPrincipalPorModelo.set(foto.idModelo, foto.archivo.key);
    }
  }

  // Genera las URLs prefirmadas (una por modelo CON foto) en paralelo.
  const urlPorModelo = new Map<number, string>(
    await Promise.all(
      [...keyPrincipalPorModelo.entries()].map(
        async ([idModelo, key]): Promise<[number, string]> => [
          idModelo,
          await archivos.urlDescarga(key),
        ],
      ),
    ),
  );

  return modelos.map((m) => ({ ...m, urlFotoPrincipal: urlPorModelo.get(m.id) ?? null }));
}

/**
 * Adjunta a cada modelo de la PÁGINA los agregados del listado del proto `vModelos` (rediseño R9),
 * en consultas ACOTADAS a la página (sin N+1 — mismo criterio que `adjuntarFotoPrincipal`):
 *
 *  • `telaPrincipal` — el PRIMER renglón del BOM de telas por nombre de tela (el MISMO orden con
 *    que la ficha lista el BOM, así la columna coincide con lo que el cajón muestra); una sola
 *    consulta por página, la primera tela de cada modelo gana.
 *  • `stockPt` — Σ de la existencia PT del modelo en la EMPRESA ACTIVA (A9), leyendo la vista
 *    `existencia_pt` agrupada por modelo (la vista es solo CONSULTA — ADR-0010 §3; la existencia
 *    es SIEMPRE Σ de movimientos, D3). Modelos sin movimientos quedan en 0.
 *  • `costoActual` — costo UNITARIO del ÚLTIMO costeo (F7) de una orden del modelo en la empresa
 *    activa: el `CostoOrden` con `costoTotal` guardado más recientemente MODIFICADO (DISTINCT ON
 *    por modelo), dividido entre su base de prorrateo (`cantidadDeBase`, D2) — EXACTAMENTE el
 *    criterio de la Lista de costos (`listarCostos`). `null` si nunca se costeó o la base es 0.
 *    Mismo candado de importes que Costos: sin `consultas.ver-importes` viene `null` (ni se
 *    consulta).
 */
async function adjuntarAgregadosListado(
  cliente: ReturnType<typeof clienteLectura>,
  sesion: SesionUsuario,
  modelos: ModeloConRelaciones[],
  bd?: ContextoBd,
): Promise<ModeloConRelaciones[]> {
  const ids = modelos.map((m) => m.id);
  if (ids.length === 0) {
    return modelos;
  }
  const idEmpresa = sesion.idEmpresaActiva;

  // Tela principal: todas las telas del BOM de los modelos de la página, en el orden de la ficha
  // (nombre asc); al recorrer, la PRIMERA de cada modelo es su principal (igual que la foto).
  const telas = await cliente.modeloTela.findMany({
    where: { idModelo: { in: ids } },
    select: { idModelo: true, tela: { select: { nombre: true } } },
    orderBy: [{ tela: { nombre: 'asc' } }, { idTela: 'asc' }],
  });
  const telaPorModelo = new Map<number, string>();
  for (const t of telas) {
    if (!telaPorModelo.has(t.idModelo)) {
      telaPorModelo.set(t.idModelo, t.tela.nombre);
    }
  }

  // Stock PT: la vista `existencia_pt` agrupada por modelo (una consulta por página, A9).
  const stock = await cliente.$queryRaw<{ idModelo: number; existencia: bigint }[]>(Prisma.sql`
    SELECT e."id_modelo" AS "idModelo", COALESCE(SUM(e."existencia"), 0)::bigint AS "existencia"
    FROM "existencia_pt" e
    WHERE e."id_empresa" = ${idEmpresa} AND e."id_modelo" IN (${Prisma.join(ids)})
    GROUP BY e."id_modelo"
  `);
  const stockPorModelo = new Map(stock.map((f) => [f.idModelo, Number(f.existencia)]));

  // Costo actual: solo con el permiso de importes (mismo candado que la Lista de costos).
  const costoPorModelo = tienePermiso(sesion, 'consultas.ver-importes')
    ? await costoUnitarioUltimoCosteo(cliente, idEmpresa, ids, bd)
    : new Map<number, number>();

  return modelos.map((m) => ({
    ...m,
    telaPrincipal: telaPorModelo.get(m.id) ?? null,
    stockPt: stockPorModelo.get(m.id) ?? 0,
    costoActual: costoPorModelo.get(m.id) ?? null,
  }));
}

/**
 * Resuelve el costo UNITARIO del ÚLTIMO costeo (F7) de cada modelo: DISTINCT ON por modelo del
 * `CostoOrden` con `costoTotal` guardado (el modificado más recientemente gana; desempate por id),
 * y `costoTotal / cantidadDeBase(baseProrrateo)` con las cantidades derivadas de esas órdenes
 * (`cantidadesDeOrdenes` — el MISMO helper de la Lista de costos, no una derivación distinta).
 * Los modelos sin costeo o con base 0 no entran al mapa (→ `null` en la salida).
 */
async function costoUnitarioUltimoCosteo(
  cliente: ReturnType<typeof clienteLectura>,
  idEmpresa: number,
  idsModelo: number[],
  bd?: ContextoBd,
): Promise<Map<number, number>> {
  const ultimos = await cliente.$queryRaw<
    {
      idModelo: number;
      idOrden: number;
      costoTotal: Prisma.Decimal;
      baseProrrateo: 'cortado' | 'recibido' | 'vendido';
    }[]
  >(Prisma.sql`
    SELECT DISTINCT ON (o."id_modelo")
      o."id_modelo"       AS "idModelo",
      co."id_orden"       AS "idOrden",
      co."costo_total"    AS "costoTotal",
      co."base_prorrateo" AS "baseProrrateo"
    FROM "costo_orden" co
    JOIN "ordenes" o ON o."id" = co."id_orden"
    WHERE co."id_empresa" = ${idEmpresa}
      AND co."costo_total" IS NOT NULL
      AND o."id_modelo" IN (${Prisma.join(idsModelo)})
    ORDER BY o."id_modelo", co."modificado_en" DESC, co."id" DESC
  `);
  if (ultimos.length === 0) {
    return new Map();
  }

  const cantidades = await cantidadesDeOrdenes(
    ultimos.map((u) => u.idOrden),
    bd,
  );
  const resultado = new Map<number, number>();
  for (const u of ultimos) {
    const c = cantidades.get(u.idOrden);
    const cantidadBase = c === undefined ? 0 : cantidadDeBase(c, u.baseProrrateo);
    if (cantidadBase > 0) {
      resultado.set(u.idModelo, redondear2(Number(u.costoTotal) / cantidadBase));
    }
  }
  return resultado;
}

// ── Género (catálogo selector, R bajo `modelos.ver`) ──────────────────────────

/**
 * Lista los géneros para el selector de la ficha. Por defecto solo los activos (los inactivos
 * no se pueden asignar). Requiere `modelos.ver` (sin permiso propio: mismo criterio de
 * sub-catálogo selector que `RolProveedor`). El ABM fino se DIFIERE.
 */
export async function listarGeneros(
  sesion: SesionUsuario,
  opciones: { incluirInactivos?: boolean } = {},
  bd?: ContextoBd,
): Promise<Genero[]> {
  verificarPermiso(sesion, 'modelos.ver');
  return clienteLectura(bd).genero.findMany({
    where: opciones.incluirInactivos === true ? {} : { activo: true },
    orderBy: { nombre: 'asc' },
  });
}
