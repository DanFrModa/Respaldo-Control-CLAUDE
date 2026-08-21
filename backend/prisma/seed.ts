/**
 * Seed de la fundación (F0) — IDEMPOTENTE: se puede correr N veces sin duplicar
 * (todo son upserts/sincronizaciones por clave natural). Se ejecuta con
 * `npm run db:seed` (= `prisma db seed`, configurado en prisma.config.ts).
 *
 * Siembra:
 *  1. La empresa "FR Moda" (favorita) con su configuración — datos reales de
 *     `Respaldo CLAUDE/TABLAS/Empresas.csv` y `Propiedades.csv`.
 *  2. El catálogo de permisos de `src/contrato` (sincronización por `clave`, A4).
 *  3. Los roles predefinidos que absorben los NIVELES del sistema viejo
 *     (doc 00-Arranque-Login-y-Menu.md §2) con una asignación de permisos APROXIMADA
 *     que Daniel validará en la pantalla de roles (ver mapeo abajo).
 *  4. El usuario `admin` con contraseña temporal y rol Administrador.
 *  5. La plantilla de importación de C&A (formato `pdf-cya`, 7% de sobre-pedido) SI el cliente
 *     ya existe — §Post-F9.70 punto 2: sin ella el 7% de Daniel no operaba.
 *  6. El ORDEN canónico de las tallas ya cargadas (V1-E3r, §Post-F9.81): repara el `orden = 0`
 *     que dejó el ETL, sin pisar nunca un orden que puso una persona.
 */
import { pathToFileURL } from 'node:url';

import { hashPassword } from 'better-auth/crypto';

import { CATALOGO_PERMISOS, CLAVES_PERMISO, type ClavePermiso } from '../src/contrato/index.js';
import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';
import {
  deducirOrdenTalla,
  ORDEN_SIN_ASIGNAR,
} from '../src/dominio/catalogos/orden-de-tallas.js';
import {
  CAMPOS_VARIABLES_DEFAULT_CYA,
  esNombreDeCya,
  PORCENTAJE_ADICIONAL_CYA,
} from '../src/dominio/pedidos/plantilla-cya.js';

import { sembrarCalidad } from './seed-calidad.js';
import { sembrarRutaCritica } from './seed-ruta-critica.js';
import { sembrarRutaCriticaPlantillas } from './seed-ruta-critica-plantillas.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Empresa FR Moda + configuración (ex-`Propiedades`, ahora POR empresa — plan §4)
// ─────────────────────────────────────────────────────────────────────────────

async function sembrarEmpresa(prisma: PrismaClient): Promise<number> {
  // Datos reales de Empresas.csv (IdEmpresas=8: la favorita, Importancia=1).
  const empresa = await prisma.empresa.upsert({
    where: { nombre: 'FR Moda' },
    // No se pisa nada si ya existe: la empresa es DATO del negocio, no catálogo de código.
    update: {},
    create: {
      nombre: 'FR Moda',
      razonSocial: 'FR Moda, S.A. De C.V.',
      identificador: 'FR',
      favorita: true,
      paraIpt: true,
      paraEdr: true,
      activa: true,
    },
  });

  // Valores vigentes de Propiedades.csv: UtilidadSujerida=50, Regalias=10, ColchonCostura=1.
  // Las fechas de inventario físico y el almacén PT por defecto los traerá la migración (F10).
  await prisma.configuracionEmpresa.upsert({
    where: { idEmpresa: empresa.id },
    update: {},
    create: {
      idEmpresa: empresa.id,
      utilidadSugerida: 50,
      regaliasBase: 10,
      colchonCostura: 1,
    },
  });

  return empresa.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Permisos: la BD se sincroniza con el catálogo tipado de src/contrato
// ─────────────────────────────────────────────────────────────────────────────

async function sembrarPermisos(prisma: PrismaClient): Promise<Map<ClavePermiso, number>> {
  const idPorClave = new Map<ClavePermiso, number>();
  for (const permiso of CATALOGO_PERMISOS) {
    const fila = await prisma.permiso.upsert({
      where: { clave: permiso.clave },
      update: { descripcion: permiso.descripcion, modulo: permiso.modulo },
      create: {
        clave: permiso.clave,
        descripcion: permiso.descripcion,
        modulo: permiso.modulo,
      },
    });
    idPorClave.set(permiso.clave, fila.id);
  }

  // Un permiso en BD que ya no está en el catálogo es señal de catálogo desactualizado:
  // se avisa pero NO se borra (podría tener asignaciones; lo decide una migración expresa).
  const huerfanos = await prisma.permiso.findMany({
    where: { clave: { notIn: [...CLAVES_PERMISO] } },
    select: { clave: true },
  });
  for (const huerfano of huerfanos) {
    console.warn(`⚠ Permiso en BD fuera del catálogo de src/contrato: ${huerfano.clave}`);
  }

  return idPorClave;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Roles predefinidos (absorben los niveles del sistema viejo — doc 00 §2, A4)
// ─────────────────────────────────────────────────────────────────────────────

/** Resta claves de un conjunto base (cascada de niveles: menor nivel ⊃ mayor nivel). */
function sin(base: readonly ClavePermiso[], ...quitar: ClavePermiso[]): ClavePermiso[] {
  return base.filter((clave) => !quitar.includes(clave));
}

/**
 * MAPEO NIVELES → ROLES (aproximación inicial — SE VALIDA CON DANIEL, ver README).
 *
 * En el sistema viejo convivían dos ejes (doc 10 §4): el NIVEL (filtraba menú y campos
 * sensibles) y los ACCESOS por usuario (`UsuAccesos`, independientes del nivel). Aquí se
 * fusionan en roles: cada rol parte de "todo lo del nivel superior" (cascada del doc 00
 * §2) menos lo que ese nivel tenía explícitamente prohibido. Donde la restricción vieja
 * era SOLO de menú (no un acceso de la tabla `Accesos`), el conjunto no cambia y la
 * diferencia se aplicará como visibilidad de menú en la fase del módulo correspondiente.
 */
function definirRoles(): {
  nombre: string;
  descripcion: string;
  permisos: ClavePermiso[];
}[] {
  // Todo el catálogo (38 del sistema viejo + administración nueva de v2).
  const todos: readonly ClavePermiso[] = CLAVES_PERMISO;

  // Nivel 30 — Directivo: pierde la administración del sistema (en el viejo, el botón
  // Administración era exclusivo de nivel ≤ 20, doc 00 §3.1). Conserva el `.ver` de los
  // catálogos (consulta), pero NO su `.administrar`: administrar catálogos maestros
  // (igual que almacenes/usuarios/roles/empresas) queda solo para Administrador y
  // AdministracionDireccion (F1-E1, ADR-0007). Por eso se restan los `*.administrar` de
  // los catálogos junto con los de administración del sistema. Los catálogos
  // ESTRUCTURADOS de F1-E2 (maquileros/tallas/clientes) y los de MATERIALES de F1-E3
  // (telas/avios) siguen el MISMO reparto.
  const directivo = sin(
    todos,
    'usuarios.administrar',
    'roles.administrar',
    'almacenes.administrar',
    'empresas.administrar',
    'proveedores.administrar',
    'temporadas.administrar',
    'etiquetas-marca.administrar',
    'colores.administrar',
    // F1-E2 — catálogos estructurados. NOTA: maquileros/cortadores se fusionaron en
    // proveedores (D12/R15) → cubiertos por `proveedores.administrar` de arriba.
    'tallas.administrar',
    'clientes.administrar',
    // F1-E3 — catálogos de materiales.
    'telas.administrar',
    'avios.administrar',
    // F1-E4 — modelos (Módulo 2): administrar el catálogo + BOM + fotos solo para
    // Administrador y AdministracionDireccion (mismo reparto que el resto de catálogos).
    'modelos.administrar',
    // F3-E1 — tipos de proceso (Módulo 4, catálogo): administrar solo Administrador y
    // AdministracionDireccion (mismo reparto que el resto de catálogos). El `ver` y los
    // permisos operativos de producción/inventario cascadean (siguen en el conjunto).
    'tipos-proceso.administrar',
    // F6-E1 — catálogo de Calidad (defectos/tipos de producto/planes AQL): administrar solo
    // Administrador y AdministracionDireccion (mismo reparto que el resto de catálogos). El
    // `calidad.ver` y la consulta de bitácora cascadean (siguen en el conjunto del directivo).
    'calidad.administrar-catalogo',
    // F8-E1 — catálogos de configuración de Desarrollo/Cotización (conceptos de costo R19,
    // estados de lista R20): administrar solo Administrador y AdministracionDireccion (mismo
    // reparto que el resto de catálogos). El `.ver` y los permisos de desarrollo/listas cascadean.
    'concepto-costo.administrar',
    'estado-lista.administrar',
    // F5 — catálogo de Ruta Crítica (procesos/plantillas/reglas/calendario laboral): administrar
    // solo Administrador y AdministracionDireccion (mismo reparto que el resto de catálogos
    // maestros). `rc.catalogo-ver` y el motor de RC cascadean. (Fix de pentest: antes se colaba a
    // roles clericales.)
    'rc.catalogo-administrar',
    // F9-E1 — cuenta corriente de terceros (Finanzas, D12/D15): CAPTURAR/CANCELAR movimientos
    // (`terceros.administrar`) y la VISTA FISCAL (`terceros.fiscal`) quedan solo para Administrador
    // y AdministracionDireccion (mismo reparto que los catálogos maestros y por prudencia
    // financiera; sé conservador como el fix de pentest de los `*.administrar`). El `terceros.ver`
    // NO se corta aquí: baja hasta Gerencial (se corta en Ventas, ver abajo), como EsMa.
    'terceros.administrar',
    'terceros.fiscal',
    // F9-E2 — CxP: capturar/cancelar movimientos (`cxp.administrar`) queda solo para Administrador y
    // AdministracionDireccion (mismo reparto que `terceros.administrar`). El `cxp.ver` NO se corta aquí:
    // baja hasta Gerencial (se corta en Ventas, ver abajo).
    'cxp.administrar',
    // F9-E4 — CxC: capturar/cancelar movimientos e importar CFDI de venta (`cxc.administrar`) queda solo
    // para Administrador y AdministracionDireccion (mismo reparto que `cxp.administrar`). El `cxc.ver` NO
    // se corta aquí: baja hasta Gerencial (se corta en Ventas, ver abajo).
    'cxc.administrar',
  );

  // Nivel 40 — Gerencial: "como Directivo, pero sin menú de Costos ni ver costos". En v2 eso son el
  // botón legado de costos de la orden (`ordenes.ver-costos`), el módulo de Costos (`costos.ver`/
  // `costos.capturar`, menú 6, F7-E1) Y el Estado de Resultados (`edr.ver`/`edr.capturar`, menú 6.2,
  // F7-E2). Conserva el PRE-COSTO (`precostos.consultar`, nivel ≤45).
  const gerencial = sin(
    directivo,
    'ordenes.ver-costos',
    'costos.ver',
    'costos.capturar',
    'edr.ver',
    'edr.capturar',
    // F8-E4 — aprobar precios de lista es del DUEÑO (Administrador/AdministracionDireccion/
    // Directivo, decisión (h)): Gerencial NO aprueba. Conserva ver/administrar/negociar de listas
    // y todo desarrollo.*.
    'listas.aprobar',
  );

  // Nivel 45 — Ventas: "sin ver el total de ventas en $ en Pedidos" → importes/precios
  // en consultas Y en el módulo Pedidos (F2-E1: `pedidos.importes` oculta `precio`/totales,
  // doc 02-Pedidos §3). Ventas SÍ captura pedidos (alta/edición), solo no ve los importes.
  // Los TABLEROS directivos de indicadores (F7-E3, `indicadores.ver`) son de DIRECCIÓN/GERENCIA →
  // se cortan aquí (los conservan Administrador, AdministracionDireccion, Directivo y Gerencial).
  const ventas = sin(
    gerencial,
    'consultas.ver-importes',
    'pedidos.importes',
    'indicadores.ver',
    // F8-E5 — negociar/mover estados de lista es del dueño y el gerente comercial (decisión (h)):
    // Ventas NO negocia. Conserva desarrollo.* (pre-venta) y listas.ver/.administrar.
    'listas.negociar',
    // F9-E1 — la cuenta corriente de terceros (CxC/CxP) es información FINANCIERA: `terceros.ver`
    // se corta en Ventas hacia abajo (lo conservan Directivo y Gerencial, que ya ven EsMa). Mismo
    // criterio que `indicadores.ver`/`consultas.ver-importes`: de Ventas para abajo no ve saldos.
    'terceros.ver',
    // F9-E2 — CxP: `cxp.ver` (bandeja por pagar + estado de cuenta) es información FINANCIERA; se
    // corta en Ventas hacia abajo, igual que `terceros.ver`.
    'cxp.ver',
    // F9-E4 — CxC: `cxc.ver` (bandeja por cobrar + estado de cuenta) es información FINANCIERA; se
    // corta en Ventas hacia abajo, igual que `cxp.ver`.
    'cxc.ver',
  );

  // Nivel 47 — Logística: "sin importes; no puede crear/modificar órdenes" → fuera
  // modificar órdenes y los precios de maquila (importes de la orden). En v2 (F2-E2) "no
  // crear/modificar órdenes" se traduce además a quitar el CRUD nuevo de la orden
  // (`ordenes.administrar`/`.cancelar`); conserva `ordenes.ver` (consulta).
  const logistica = sin(
    ventas,
    'ordenes.modificar',
    'ordenes.precio-maquila',
    'ordenes.ver-precio-real-maquila',
    'ordenes.administrar',
    'ordenes.cancelar',
    // Nivel 47 y abajo ya no acceden al pre-costo (era ≤45): Directivo/Gerencial/Ventas sí.
    'precostos.consultar',
    // F8 — Desarrollo/Cotización (D13): armar proyectos/desarrollos, precostear y administrar
    // listas de precios es trabajo de PRE-VENTA (Directivo/Gerencial/Ventas). De Logística hacia
    // abajo se corta administrar/precostear (mismo precedente que `precostos.consultar`, ≤45).
    // `desarrollo.ver` y `listas.ver` NO se cortan: la CONSULTA cascadea amplia (hasta Secretarial).
    'desarrollo.administrar',
    'desarrollo.precostear',
    'listas.administrar',
  );

  // Nivel 50 — Asistente: su única restricción extra era el MENÚ de catálogos de la RC
  // (no existe como acceso granular) → mismo conjunto que Logística por ahora.
  const asistente = [...logistica];

  // Nivel 60 — Secretarial: "no puede modificar el precio de maquila" — ya quitado desde
  // Logística → mismo conjunto que Asistente por ahora.
  const secretarial = [...asistente];

  return [
    {
      nombre: 'Administrador',
      // Nivel 1 (Daniel): todo, incluida la administración del sistema.
      descripcion: 'Acceso total al sistema (absorbe el nivel 1 del sistema viejo)',
      permisos: [...todos],
    },
    {
      nombre: 'AdministracionDireccion',
      // Nivel 20: "todo menos modificar la base de datos" — modificar el diseño de la BD
      // era una capacidad de Access, no de la aplicación; en v2 no existe como permiso.
      descripcion:
        'Administración y dirección: todo el sistema (absorbe el nivel 20 del sistema viejo)',
      permisos: [...todos],
    },
    {
      nombre: 'Directivo',
      descripcion: 'Dirección del negocio sin administración del sistema (absorbe el nivel 30)',
      permisos: directivo,
    },
    {
      nombre: 'Gerencial',
      descripcion: 'Gerencia sin acceso a costos (absorbe el nivel 40)',
      permisos: gerencial,
    },
    {
      nombre: 'Ventas',
      descripcion: 'Ventas sin importes totales ni costos (absorbe el nivel 45)',
      permisos: ventas,
    },
    {
      nombre: 'Logistica',
      descripcion: 'Logística sin importes y sin modificar órdenes (absorbe el nivel 47)',
      permisos: logistica,
    },
    {
      nombre: 'Asistente',
      descripcion: 'Asistente de dirección (absorbe el nivel 50)',
      permisos: asistente,
    },
    {
      nombre: 'Secretarial',
      descripcion: 'Captura secretarial (absorbe el nivel 60)',
      permisos: secretarial,
    },
    {
      nombre: 'Basico',
      // Nivel 100 ("nivUltimo"): el más restringido; en el viejo, sus accesos se
      // activaban uno por uno por usuario → el rol arranca sin permisos.
      descripcion: 'Acceso básico sin permisos especiales (absorbe el nivel 100)',
      permisos: [],
    },
  ];
}

async function sembrarRoles(
  prisma: PrismaClient,
  idPermisoPorClave: Map<ClavePermiso, number>,
): Promise<void> {
  for (const rol of definirRoles()) {
    const fila = await prisma.rol.upsert({
      where: { nombre: rol.nombre },
      update: { descripcion: rol.descripcion, esSistema: true },
      create: { nombre: rol.nombre, descripcion: rol.descripcion, esSistema: true },
    });

    const idsPermisos = rol.permisos.map((clave) => {
      const id = idPermisoPorClave.get(clave);
      if (id === undefined) {
        throw new Error(`Permiso "${clave}" del rol ${rol.nombre} no está sembrado`);
      }
      return id;
    });

    // Los roles de sistema se SINCRONIZAN con esta definición (estado conocido):
    // se quita lo que sobre y se agrega lo que falte, sin duplicar.
    await prisma.rolPermiso.deleteMany({
      where: { idRol: fila.id, idPermiso: { notIn: idsPermisos } },
    });
    await prisma.rolPermiso.createMany({
      data: idsPermisos.map((idPermiso) => ({ idRol: fila.id, idPermiso })),
      skipDuplicates: true,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3b. Roles de proveedor (F1-E1B, R15 §4.1) — catálogo base, idempotente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Roles/servicios base de proveedor (R15 §4.1 —
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md`). Catálogo administrable:
 * Gabriel puede agregar/desactivar más desde la UI; estos son el punto de partida.
 * Se siembran por `codigo` (clave natural estable), sin pisar el `nombre` si ya
 * existe (pudo editarse). NO se borran los que no estén aquí (podrían estar en uso).
 */
const ROLES_PROVEEDOR_BASE: { codigo: string; nombre: string }[] = [
  // Servicios de producción (cubren a los antiguos Maquilero y Cortador — fusión de
  // terceros, D12/R15): un taller marca con casillas qué servicios presta.
  { codigo: 'maquila-costura', nombre: 'Maquila (costura)' },
  { codigo: 'corte', nombre: 'Corte' },
  // Nombres como los pide Daniel (§Post-F9.54 punto 1, 16-ago-2026): *"Yo cambiaría el nombre a
  // Estampador, Bordador… El vende telas y vende avíos lo dejaría solo como Telas y Avíos, le
  // quitaría el «Vende»."* Solo cambia el NOMBRE visible; el `codigo` es la clave estable.
  //
  // ⚠️ Esto de aquí SOLO cubre una base recién creada: el `upsert` de abajo usa `update: {}`, que
  // NO pisa el nombre de un rol que ya existe. En una base con datos (p. ej. `prueba`) los cuatro
  // renombres los hace la MIGRACIÓN `20260818140000_proveedores_como_daniel_los_usa`, por código.
  // Los dos caminos coinciden a propósito. (La nota vieja de §Post-F9.54 decía que bastaba
  // `SEED_ON_START=true`: era FALSO, y ya está corregida en el documento.)
  { codigo: 'estampado', nombre: 'Estampador' },
  { codigo: 'bordado', nombre: 'Bordador' },
  { codigo: 'lavado', nombre: 'Lavado' },
  { codigo: 'aplicacion', nombre: 'Aplicación' },
  // Venta de materiales (proveedores comerciales).
  { codigo: 'vende-telas', nombre: 'Telas' },
  { codigo: 'vende-avios', nombre: 'Avíos' },
  { codigo: 'otros-servicios', nombre: 'Otros servicios' },
];

/**
 * Roles de proveedor OBSOLETOS que sembrados antiguos pudieron dejar en `prueba` y que
 * la fusión de terceros (D12/R15) reemplazó. Se DESACTIVAN (no se borran: pudieron
 * quedar asignados a algún proveedor de prueba; el borrado suave evita dejar pares
 * colgando). `estampado-aplicacion` se separó en `estampado` + `aplicacion`.
 */
const ROLES_PROVEEDOR_OBSOLETOS: string[] = ['estampado-aplicacion'];

async function sembrarRolesProveedor(prisma: PrismaClient): Promise<void> {
  for (const rol of ROLES_PROVEEDOR_BASE) {
    await prisma.rolProveedor.upsert({
      where: { codigo: rol.codigo },
      // No se pisa el nombre/activo si ya existe (pudo editarse en producción).
      update: {},
      create: { codigo: rol.codigo, nombre: rol.nombre },
    });
  }
  // Desactiva los roles obsoletos si existen (idempotente; no falla si no están).
  await prisma.rolProveedor.updateMany({
    where: { codigo: { in: ROLES_PROVEEDOR_OBSOLETOS }, activo: true },
    data: { activo: false },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3c. Tipos de proceso de maquila (F1-E2) — catálogo base, idempotente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tipos de proceso de maquila base (maquila unificada — PLANMAESTRO §4;
 * doc `03-Produccion.md`: M = costura, A = estampado/aplicación, y §324 lista
 * bordado/lavado como tipos a parametrizar). Catálogo administrable: el ABM fino
 * queda diferido (como los roles-proveedor en E1B), pero estos son el punto de
 * partida. Se siembran por `codigo` (clave natural estable), sin pisar el `nombre`
 * si ya existe (pudo editarse). NO se borran los que no estén aquí (podrían estar en uso).
 */
// F3-E1: cada tipo nace con su bandera `generaEntradaPt` (decisión (e), DECISIONES.md / ADR-0010):
// SOLO costura deja prenda terminada → su recibo mete a inventario PT; estampado/aplicación,
// bordado y lavado = false. Es el DEFAULT inicial; cambiarlo luego es dato (UI de admin), no
// migración. `update` NO pisa la bandera si el tipo ya existe (pudo ajustarse en producción).
// V1-E3f (§Post-F9.58/.59): este catálogo es AHORA también el de TIPOS DE ARTE — Daniel:
// *"De acuerdo. Y un solo catálogo."*. `esArte` marca cuáles se ofrecen como arte (bordado,
// estampado, aplicación —*"Aplicación también es arte"*— y lavado; la costura NO, es la única
// diferencia real entre las dos listas que se fusionaron), y `usaPuntadas` cuáles muestran el
// campo de puntadas (solo bordado, §Post-F9.52 punto 6).
//
// ⚠️ El `update: {}` de abajo NO pisa las banderas de un tipo que YA existe: en una base con
// datos (p. ej. `prueba`) las marca la MIGRACIÓN `20260818120000_catalogo_unico_de_arte`, por
// código. Esto de aquí solo cubre la base recién creada. Los dos caminos coinciden a propósito.
const TIPOS_PROCESO_BASE: {
  codigo: string;
  nombre: string;
  generaEntradaPt: boolean;
  esArte: boolean;
  usaPuntadas: boolean;
}[] = [
  {
    codigo: 'costura',
    nombre: 'Costura',
    generaEntradaPt: true,
    esArte: false,
    usaPuntadas: false,
  },
  {
    codigo: 'estampado',
    nombre: 'Estampado',
    generaEntradaPt: false,
    esArte: true,
    usaPuntadas: false,
  },
  { codigo: 'bordado', nombre: 'Bordado', generaEntradaPt: false, esArte: true, usaPuntadas: true },
  { codigo: 'lavado', nombre: 'Lavado', generaEntradaPt: false, esArte: true, usaPuntadas: false },
  {
    codigo: 'aplicacion',
    nombre: 'Aplicación',
    generaEntradaPt: false,
    esArte: true,
    usaPuntadas: false,
  },
];

async function sembrarTiposProceso(prisma: PrismaClient): Promise<void> {
  for (const tipo of TIPOS_PROCESO_BASE) {
    await prisma.tipoProceso.upsert({
      where: { codigo: tipo.codigo },
      // No se pisa nombre/activo/banderas si ya existe (pudo editarse en producción).
      update: {},
      create: {
        codigo: tipo.codigo,
        nombre: tipo.nombre,
        generaEntradaPt: tipo.generaEntradaPt,
        esArte: tipo.esArte,
        usaPuntadas: tipo.usaPuntadas,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3d. Géneros de modelo (F1-E4) — catálogo base, idempotente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Géneros de modelo del sistema viejo (doc `01-Modelos.md` §3, lista de precios por
 * género). Catálogo selector: se siembran + se expone solo `GET /api/generos`; el ABM
 * fino se DIFIERE (mismo patrón que `RolProveedor`/`TipoProceso`). Se siembran por
 * `nombre` (clave natural), sin pisar `activo` si ya existe. NO se borran los que no
 * estén aquí (podrían estar en uso una vez que el ETL E7 pueble `Modelo.idGenero`).
 */
/**
 * Géneros base con su DÍGITO de la nomenclatura de producción (§Post-F9.34, V1-E3n): es el 2º
 * dígito del código de 5 (`71001` → `1` = Caballero). `alterno` es el dígito de CONTINUACIÓN
 * cuando la serie se agota: sólo Caballero lo tiene (1 → 5), porque su serie `x1` ya llegó a 999
 * en el Access y Daniel abrió la `x5`. El 8 no se usa.
 */
const GENEROS_BASE: { nombre: string; digito: number; alterno?: number }[] = [
  { nombre: 'Caballero', digito: 1, alterno: 5 },
  { nombre: 'Dama', digito: 2 },
  { nombre: 'Niño Infantil', digito: 4 },
  { nombre: 'Niña Infantil', digito: 6 },
  { nombre: 'Niño Juvenil', digito: 3 },
  { nombre: 'Niña Juvenil', digito: 7 },
  { nombre: 'Bebo', digito: 0 },
  { nombre: 'Beba', digito: 9 },
];

async function sembrarGeneros(prisma: PrismaClient): Promise<void> {
  for (const { nombre, digito, alterno } of GENEROS_BASE) {
    await prisma.genero.upsert({
      where: { nombre },
      // No se pisa el activo si ya existe (pudo editarse/desactivarse en producción), pero el
      // dígito SÍ se re-siembra: es la tabla de Daniel, no una preferencia editable.
      update: { digitoNomenclatura: digito, digitoAlterno: alterno ?? null },
      create: { nombre, digitoNomenclatura: digito, digitoAlterno: alterno ?? null },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3e. Tipos de movimiento de inventario (F3-E1) — ex `IPT_TiposMov`, idempotente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los 19 tipos de movimiento de inventario del sistema viejo (`IPT_TiposMov.csv`,
 * doc 04-Inventarios §A.2) con su DIRECCIÓN (ex `TipoEnSa`: 1=entrada, 2=salida, 3=traspaso),
 * que el kardex usa para el signo de la existencia (D3, ADR-0010). Cada uno con un `codigo`
 * estable kebab-case para referenciarlo en código sin atarlo al texto.
 *
 * Es la lista CANÓNICA (fuente de verdad del seed), transcrita de `IPT_TiposMov.csv`. El CSV se
 * lee en CP850 (CLAUDE.md §4 / `migracion/comun/csv.ts`) SOLO para VERIFICAR esta lista contra el
 * dump cuando el archivo está disponible (local/CI) — `verificarTiposMovimientoContraCsv`; en el
 * deploy (donde el CSV no viaja en la imagen del backend) la verificación se omite sin fallar.
 *
 * Se siembran por `codigo`; `update` NO pisa nombre/activo/dirección si ya existen (idempotente).
 */
const TIPOS_MOVIMIENTO_BASE: {
  codigo: string;
  nombre: string;
  direccion: 'entrada' | 'salida' | 'traspaso';
}[] = [
  { codigo: 'inventario-inicial', nombre: 'Inventario Inicial', direccion: 'entrada' },
  { codigo: 'entrada-maquila', nombre: 'Entrada de Maquila', direccion: 'entrada' },
  { codigo: 'entrada-aplicacion', nombre: 'Entrada de Aplicación', direccion: 'entrada' },
  {
    codigo: 'devolucion-nota-credito',
    nombre: 'Devolución / Notas de Crédito',
    direccion: 'entrada',
  },
  { codigo: 'entrega-cliente', nombre: 'Entrega a Cliente', direccion: 'salida' },
  { codigo: 'salida-aplicacion', nombre: 'Salida a Aplicación', direccion: 'salida' },
  { codigo: 'muestrario-ventas', nombre: 'Muestrario Ventas', direccion: 'salida' },
  { codigo: 'salida-maquilero', nombre: 'Salida a Maquilero', direccion: 'salida' },
  {
    codigo: 'transferencia-almacenes',
    nombre: 'Transferencia entre almacenes',
    direccion: 'traspaso',
  },
  { codigo: 'recibo-muestrario', nombre: 'Recibo de Muestrario', direccion: 'entrada' },
  { codigo: 'error-entrada', nombre: 'Error de Entrada', direccion: 'salida' },
  { codigo: 'error-salida', nombre: 'Error de Salida', direccion: 'entrada' },
  { codigo: 'venta-mostrador', nombre: 'Venta de Mostrador', direccion: 'salida' },
  { codigo: 'ajuste-entrada', nombre: 'Ajuste de Inventario (Entrada)', direccion: 'entrada' },
  { codigo: 'ajuste-salida', nombre: 'Ajuste de Inventario (Salida)', direccion: 'salida' },
  { codigo: 'salida-laboratorio', nombre: 'Salida a Laboratorio', direccion: 'salida' },
  { codigo: 'salida-composturas', nombre: 'Salida a Composturas', direccion: 'salida' },
  { codigo: 'otras-salidas', nombre: 'Otras Salidas', direccion: 'salida' },
  { codigo: 'otras-entradas', nombre: 'Otras Entradas', direccion: 'entrada' },
];

/** `IPT_TiposMov.TipoEnSa` → dirección de v2 (1=entrada, 2=salida, 3=traspaso). */
function direccionDesdeTipoEnSa(valor: string): 'entrada' | 'salida' | 'traspaso' | null {
  if (valor === '1') return 'entrada';
  if (valor === '2') return 'salida';
  if (valor === '3') return 'traspaso';
  return null;
}

/**
 * VERIFICA que {@link TIPOS_MOVIMIENTO_BASE} tenga las 19 entradas del dump viejo con su dirección
 * (nit #5: el CSV se lee en CP850). Best-effort: si el CSV no está disponible (deploy), avisa y
 * sigue. Si está pero NO cuadra (conteo o dirección por TipoEnSa), LANZA — el seed canónico no
 * debe divergir del viejo en silencio.
 */
async function verificarTiposMovimientoContraCsv(): Promise<void> {
  let leerCsv: (nombre: string) => Record<string, string>[];
  try {
    ({ leerCsv } = await import('../migracion/comun/csv.js'));
  } catch {
    return; // el ETL/csv no está disponible en este contexto: se omite la verificación
  }
  let filas: Record<string, string>[];
  try {
    filas = leerCsv('IPT_TiposMov.csv');
  } catch {
    console.warn(
      '⚠ IPT_TiposMov.csv no disponible: se omite la verificación (seed canónico igual se aplica).',
    );
    return;
  }
  if (filas.length !== TIPOS_MOVIMIENTO_BASE.length) {
    throw new Error(
      `IPT_TiposMov.csv trae ${String(filas.length)} tipos; el seed canónico tiene ${String(TIPOS_MOVIMIENTO_BASE.length)}.`,
    );
  }
  // El orden del CSV coincide 1:1 con el de la lista canónica (IdIPT_TiposMov 1..19).
  filas.forEach((fila, i) => {
    const esperada = TIPOS_MOVIMIENTO_BASE[i];
    const direccionCsv = direccionDesdeTipoEnSa(String(fila.TipoEnSa ?? '').trim());
    if (esperada === undefined || direccionCsv !== esperada.direccion) {
      throw new Error(
        `IPT_TiposMov.csv fila ${String(i + 1)} ("${String(fila.TipoMov)}") tiene dirección ${String(direccionCsv)}, ` +
          `pero el seed espera ${esperada?.direccion ?? '(ninguna)'} para "${esperada?.nombre ?? ''}".`,
      );
    }
  });
}

/**
 * Tipos de movimiento NUEVOS de v2 que NO vienen del CSV viejo (F3-E3). El viejo modelaba la
 * "Transferencia entre almacenes" con UN tipo de dirección `traspaso`; v2 la materializa como DOS
 * patas (salida del origen + entrada al destino) para que la vista `existencia_pt` sume +1/−1 por
 * almacén (ADR-0010 §1/§5). El traspaso de dominio resuelve estas patas POR `codigo`. NO entran en
 * {@link TIPOS_MOVIMIENTO_BASE} (esa es la lista canónica verificada 1:1 contra el CSV de 19); el
 * tipo viejo `transferencia-almacenes` (dirección `traspaso`) se conserva y NO se usa como pata.
 */
const TIPOS_MOVIMIENTO_V2: {
  codigo: string;
  nombre: string;
  direccion: 'entrada' | 'salida' | 'traspaso';
}[] = [
  {
    codigo: 'transferencia-salida',
    nombre: 'Transferencia entre Almacenes (Salida)',
    direccion: 'salida',
  },
  {
    codigo: 'transferencia-entrada',
    nombre: 'Transferencia entre Almacenes (Entrada)',
    direccion: 'entrada',
  },
];

/**
 * Tipos de movimiento NUEVOS de F4-E1 (kardex de telas y avíos). El viejo registraba las entradas
 * de tela con factura, las salidas ligadas a la orden (`Salidas.IdOrdenes`) y los consumos por nota
 * en tablas SEPARADAS sin un tipo de movimiento explícito; v2 los modela como tipos de kardex con su
 * dirección (D3, ADR-0010). El traspaso reusa `transferencia-salida`/`-entrada` (ya sembrados en
 * F3-E3) y el ajuste reusa `ajuste-entrada`/`-salida` (de los 19 canónicos): NO se duplican aquí.
 *  • `entrada-recepcion` — entrada de tela/avío por recepción de compra (E3, con factor de
 *    conversión y costo por unidad de consumo). Dirección entrada.
 *  • `salida-a-orden` — salida de TELA hacia una orden de producción (`Salidas.IdOrdenes`, E1). Es
 *    LA única vía que descuenta tela hacia una orden; la nota (E5) la referencia sin segundo
 *    movimiento. Dirección salida.
 *  • `salida-por-nota` — salida de AVÍO por una nota de salida a maquilero (E5: el consumo de avíos
 *    va ligado a las notas, R4). Dirección salida.
 */
const TIPOS_MOVIMIENTO_F4: {
  codigo: string;
  nombre: string;
  direccion: 'entrada' | 'salida' | 'traspaso';
}[] = [
  { codigo: 'entrada-recepcion', nombre: 'Entrada por Recepción de Compra', direccion: 'entrada' },
  { codigo: 'salida-a-orden', nombre: 'Salida de Tela a Orden', direccion: 'salida' },
  { codigo: 'salida-por-nota', nombre: 'Salida de Avío por Nota', direccion: 'salida' },
];

/**
 * Tipos de movimiento NUEVOS de F7-E5 (ajuste por inventario CÍCLICO). El ajuste que reconcilia el
 * conteo físico contra el kardex se aplica como MOVIMIENTO (D3, nunca editando un saldo); se usan
 * tipos DEDICADOS (en vez del `ajuste-entrada`/`-salida` genérico) para poder rastrear en el kardex
 * qué diferencias vinieron de un cíclico. Entra por SEED (no por migración) → el deploy a `prueba`
 * requiere SEED_ON_START=true.
 */
const TIPOS_MOVIMIENTO_F7: {
  codigo: string;
  nombre: string;
  direccion: 'entrada' | 'salida' | 'traspaso';
}[] = [
  {
    codigo: 'ajuste-ciclico-entrada',
    nombre: 'Ajuste por Cíclico (Entrada)',
    direccion: 'entrada',
  },
  { codigo: 'ajuste-ciclico-salida', nombre: 'Ajuste por Cíclico (Salida)', direccion: 'salida' },
];

async function sembrarTiposMovimiento(prisma: PrismaClient): Promise<void> {
  await verificarTiposMovimientoContraCsv();
  // Los 19 canónicos del CSV + los 2 nuevos de F3-E3 (patas del traspaso) + los 3 de F4-E1 (kardex
  // de telas y avíos) + los 2 de F7-E5 (ajuste por cíclico). Idempotente: el `update: {}` no pisa
  // nombre/dirección/activo si ya existen (pudieron editarse en producción).
  for (const tipo of [
    ...TIPOS_MOVIMIENTO_BASE,
    ...TIPOS_MOVIMIENTO_V2,
    ...TIPOS_MOVIMIENTO_F4,
    ...TIPOS_MOVIMIENTO_F7,
  ]) {
    await prisma.tipoMovimientoInventario.upsert({
      where: { codigo: tipo.codigo },
      update: {},
      create: { codigo: tipo.codigo, nombre: tipo.nombre, direccion: tipo.direccion },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3f. Almacenes de PT (F3-E1) — ex `IPT_Almacenes` (Primeras/Segundas/Tránsito)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los 3 almacenes de PT del sistema viejo (`IPT_Almacenes.csv`: Primeras/Segundas/Tránsito). Son
 * GLOBALES (`idEmpresa = null`, como crea el dominio de almacenes para los compartidos). Se
 * siembran de forma idempotente: si ya existe un almacén PT con ese nombre (global), NO se
 * duplica. El kardex de PT (E3) y el recibo de costura (E4) los usan como destino.
 */
const ALMACENES_PT_BASE: string[] = ['Primeras', 'Segundas', 'Tránsito'];

/**
 * Nombre del almacén de PT que hace de TRÁNSITO A PROCESO EXTERNO (V1-E4b, §Post-F9.61). El nombre
 * solo se usa AQUÍ, para saber a cuál ponerle la bandera la primera vez; de ahí en adelante el
 * dominio lo resuelve SIEMPRE por `esTransitoProceso` (renombrar el almacén no rompe nada).
 */
const NOMBRE_ALMACEN_TRANSITO = 'Tránsito';

async function sembrarAlmacenesPt(prisma: PrismaClient): Promise<void> {
  for (const nombre of ALMACENES_PT_BASE) {
    // Idempotente por (nombre, tipo PT, global): si ya existe NO se crea otro (el @@unique de
    // almacenes es (idEmpresa, nombre), pero los globales tienen idEmpresa null, que Postgres
    // trata como distinto en el unique → se verifica a mano antes de crear).
    const existente = await prisma.almacen.findFirst({
      where: { nombre, tipo: 'PT', idEmpresa: null },
      select: { id: true },
    });
    if (existente === null) {
      await prisma.almacen.create({
        data: {
          nombre,
          tipo: 'PT',
          idEmpresa: null,
          esTransitoProceso: nombre === NOMBRE_ALMACEN_TRANSITO,
        },
      });
    }
  }

  // V1-E4b: enciende la bandera del tránsito en las bases que YA tenían el almacén sembrado (F3-E1).
  // Solo si NINGUNO la trae: si alguien la movió a otro almacén a propósito, el seed no se la quita.
  const yaHayTransito = await prisma.almacen.count({ where: { esTransitoProceso: true } });
  if (yaHayTransito === 0) {
    const transito = await prisma.almacen.findFirst({
      where: { nombre: NOMBRE_ALMACEN_TRANSITO, tipo: 'PT', idEmpresa: null },
      select: { id: true },
    });
    if (transito !== null) {
      await prisma.almacen.update({
        where: { id: transito.id },
        data: { esTransitoProceso: true },
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3g. Reactivos del checklist de FICHAS CONFIABLES (F7-E4) — los 8 fijos del viejo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los 8 reactivos fijos del checklist de confiabilidad de la ficha técnica del sistema viejo
 * (`IP_InfConf`, doc 05 §A.2): eran columnas booleanas; en v2 son FILAS configurables (A6). Se
 * siembran de forma idempotente por `clave`; se pueden agregar más sin migración. El `orden`
 * respeta la secuencia del formulario viejo.
 */
const REACTIVOS_FICHA_BASE: { clave: string; etiqueta: string; orden: number }[] = [
  { clave: 'InfGeneral', etiqueta: 'Información general', orden: 1 },
  { clave: 'InfTela', etiqueta: 'Información de tela', orden: 2 },
  { clave: 'InfHab', etiqueta: 'Información de avíos', orden: 3 },
  { clave: 'Medidas', etiqueta: 'Medidas de avíos', orden: 4 },
  { clave: 'Dibujo', etiqueta: 'Dibujo', orden: 5 },
  { clave: 'InfEtiqueta', etiqueta: 'Información de etiqueta', orden: 6 },
  { clave: 'EspCostura', etiqueta: 'Especificaciones de costura', orden: 7 },
  { clave: 'MedidasPrendas', etiqueta: 'Medidas en prenda', orden: 8 },
];

async function sembrarReactivosFicha(prisma: PrismaClient): Promise<void> {
  for (const reactivo of REACTIVOS_FICHA_BASE) {
    await prisma.checklistFichaDef.upsert({
      where: { clave: reactivo.clave },
      // Idempotente: no pisa etiqueta/orden/activo si ya existe (pudieron editarse en producción).
      update: {},
      create: { clave: reactivo.clave, etiqueta: reactivo.etiqueta, orden: reactivo.orden },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3h. Conceptos de costo (F8-E1, R19) — catálogo base, idempotente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conceptos de costo del precosto (F8-E1, R19 — propuesta §3/§7-C). Catálogo que gobierna por DATO
 * los renglones del precosto (como `TipoProceso` gobierna el kardex). `fijo=true` (tela/avíos/
 * maquila) ⇒ NO desactivable (lo exige el dominio de admin). El resto son ampliables. La REGALÍA NO
 * es concepto (D2: va sobre la venta — factor de la lista, E4). Se siembran por `codigo`; `update`
 * NO pisa nombre/orden/fijo/activo si ya existe (idempotente; pudo editarse en producción).
 */
const CONCEPTOS_COSTO_BASE: { codigo: string; nombre: string; orden: number; fijo: boolean }[] = [
  { codigo: 'tela', nombre: 'Tela', orden: 1, fijo: true },
  { codigo: 'avios', nombre: 'Avíos', orden: 2, fijo: true },
  { codigo: 'maquila', nombre: 'Maquila', orden: 3, fijo: true },
  { codigo: 'estampado', nombre: 'Estampado', orden: 4, fijo: false },
  { codigo: 'bordado', nombre: 'Bordado', orden: 5, fijo: false },
  { codigo: 'otros-procesos', nombre: 'Otros procesos', orden: 6, fijo: false },
  { codigo: 'otros', nombre: 'Otros', orden: 7, fijo: false },
  // Corte (rediseño R5, B8): costo fijo por prenda SEPARADO de la maquila (decisión Daniel). El
  // precosto crea su renglón fijo auto (`lineaCorte`). REQUIERE re-seed en `prueba` (SEED_ON_START):
  // sin este concepto, `generarPrecosto` truena ("falta el concepto de costo base corte").
  { codigo: 'corte', nombre: 'Corte', orden: 8, fijo: true },
];

async function sembrarConceptosCosto(prisma: PrismaClient): Promise<void> {
  for (const concepto of CONCEPTOS_COSTO_BASE) {
    await prisma.conceptoCosto.upsert({
      where: { codigo: concepto.codigo },
      update: {},
      create: {
        codigo: concepto.codigo,
        nombre: concepto.nombre,
        orden: concepto.orden,
        fijo: concepto.fijo,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3i. Estados de lista de precios (F8-E1, R20) — catálogo base, idempotente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estados de una lista de precios (F8-E1, R20 — propuesta §4). Catálogo configurable (ampliable,
 * decisión de Daniel). `esCierre=true` (cerrada/ya-pedida) bloquea nuevas rondas de negociación
 * (regla de dominio, E5). Se siembran por `codigo`; `update` NO pisa nombre/orden/esCierre/activo.
 */
const ESTADOS_LISTA_BASE: { codigo: string; nombre: string; orden: number; esCierre: boolean }[] = [
  { codigo: 'abierta', nombre: 'Abierta', orden: 1, esCierre: false },
  { codigo: 'en-negociacion', nombre: 'En negociación', orden: 2, esCierre: false },
  { codigo: 'cerrada', nombre: 'Cerrada', orden: 3, esCierre: true },
  { codigo: 'ya-pedida', nombre: 'Ya pedida', orden: 4, esCierre: true },
];

async function sembrarEstadosLista(prisma: PrismaClient): Promise<void> {
  for (const estado of ESTADOS_LISTA_BASE) {
    await prisma.estadoLista.upsert({
      where: { codigo: estado.codigo },
      update: {},
      create: {
        codigo: estado.codigo,
        nombre: estado.nombre,
        orden: estado.orden,
        esCierre: estado.esCierre,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3.bis Plantilla de importación de C&A (formato pdf-cya, 7% de sobre-pedido)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⭐ §Post-F9.70 punto 2 — SIEMBRA LA PLANTILLA DE C&A para que el 7% de sobre-pedido (§Post-F9.2)
 * OPERE DE VERDAD. Sin ninguna `PlantillaImportacion`, `leerConfigPlantillaPdf` caía a
 * `porcentajeAdicional: 0` y las OPs nacían con las cantidades EXACTAS del cliente en vez de las que
 * se fabrican.
 *
 * **Decisión (lead, V1-E3i): va en el SEED y no "que alguien la dé de alta desde la pantalla".** Una
 * plantilla que hay que acordarse de crear es una plantilla que NO existe el día que se necesita — y
 * el día que se necesita es el día que se importa la primera OC, cuando ya nadie se acuerda. Sigue
 * siendo editable desde la pantalla del importador (guardar ahí crea una versión nueva que deja a
 * ésta fuera de vigencia).
 *
 * Dos cuidados, ambos deliberados:
 *  • El CLIENTE lo trae el ETL de Access, no el seed: aquí se BUSCA por nombre ({@link esNombreDeCya})
 *    y NO se inventa. Si no aparece, se dice en la salida del seed en vez de callarse (D3).
 *  • Sólo se siembra si el cliente NO tiene NINGUNA plantilla. Si ya tiene una (aunque sea `excel`,
 *    o una que alguien editó), NO se toca: el seed no pisa lo que un humano configuró.
 */
async function sembrarPlantillaImportacionCya(prisma: PrismaClient): Promise<void> {
  const clientes = await prisma.cliente.findMany({ select: { id: true, nombre: true } });
  const cya = clientes.filter((c) => esNombreDeCya(c.nombre));
  if (cya.length === 0) {
    console.log(
      'Seed: no hay ningún cliente que se llame C&A todavía (lo carga el ETL), así que no se ' +
        'sembró su plantilla de importación. Cuando exista, se siembra al volver a correr el seed ' +
        '(o se da de alta desde el importador de OC).',
    );
    return;
  }
  for (const cliente of cya) {
    const yaTiene = await prisma.plantillaImportacion.count({ where: { idCliente: cliente.id } });
    if (yaTiene > 0) {
      console.log(
        `Seed: el cliente "${cliente.nombre}" ya tiene plantilla de importación configurada; no se ` +
          'toca (el % adicional se ajusta desde el importador de OC).',
      );
      continue;
    }
    await prisma.plantillaImportacion.create({
      data: {
        idCliente: cliente.id,
        nombre: 'OC en PDF (C&A) v1',
        version: 1,
        vigente: true,
        formato: 'pdf-cya',
        // `pdf-cya` no mapea columnas (el extractor es código); la config viva son los campos
        // variables + el %.
        mapeo: [],
        camposVariables: CAMPOS_VARIABLES_DEFAULT_CYA,
        porcentajeAdicional: PORCENTAJE_ADICIONAL_CYA,
      },
    });
    console.log(
      `Seed: plantilla pdf-cya sembrada para "${cliente.nombre}" con ` +
        `${String(PORCENTAJE_ADICIONAL_CYA)}% de sobre-pedido (§Post-F9.2).`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3.ter Orden canónico de las tallas ya cargadas (V1-E3r, §Post-F9.81)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⭐ §Post-F9.81 — REPARA EL ORDEN DE LAS TALLAS MIGRADAS.
 *
 * El ETL creó las 94 tallas del Access con `crearTalla(sesion, { etiqueta })`, sin `orden`, así que
 * todas se quedaron en el `@default(0)` de la base y el desempate cayó en la etiqueta: la matriz
 * salía *CH, G, M, XG* en vez de *CH, M, G, XG*. Desde esta etapa `crearTalla` DEDUCE el orden, lo
 * que arregla lo que nazca de hoy en adelante; esto arregla lo que YA está cargado.
 *
 * Va en el seed y no en una migración SQL por dos razones: la escala vive en TypeScript
 * (`deducirOrdenTalla`, con su medición documentada) y duplicarla en SQL la condenaría a divergir; y
 * el seed ya corre en cada arranque de `prueba` con `SEED_ON_START=true`, que es exactamente cuando
 * hace falta.
 *
 * 🔑 **Idempotente y NO destructivo:** sólo toca las filas que siguen en el sentinela `orden = 0`.
 * Un orden que capturó una persona (el contrato lo obliga a ser ≥1 desde V1-E3r) NUNCA se pisa —
 * correr el seed diez veces deja el mismo resultado que correrlo una. Las etiquetas que la escala no
 * reconoce se quedan en 0 y se REPORTAN en la salida, en vez de recibir una posición inventada (D3).
 */
async function sembrarOrdenDeTallas(prisma: PrismaClient): Promise<void> {
  // Sólo el sentinela: lo que alguien ya ordenó a mano no se toca.
  const pendientes = await prisma.talla.findMany({
    where: { orden: ORDEN_SIN_ASIGNAR },
    select: { id: true, etiqueta: true },
  });
  if (pendientes.length === 0) {
    return;
  }

  const reparadas = pendientes
    .map((t) => ({ id: t.id, orden: deducirOrdenTalla(t.etiqueta) }))
    .filter((t): t is { id: number; orden: number } => t.orden !== null);

  // Se agrupan por `orden` para escribir con UN `updateMany` por valor distinto en vez de uno por
  // talla: son decenas de filas, pero la regla del proyecto es escribir por LOTES, no 1×1.
  const porOrden = new Map<number, number[]>();
  for (const t of reparadas) {
    porOrden.set(t.orden, [...(porOrden.get(t.orden) ?? []), t.id]);
  }
  for (const [orden, ids] of porOrden) {
    await prisma.talla.updateMany({
      where: { id: { in: ids }, orden: ORDEN_SIN_ASIGNAR },
      data: { orden },
    });
  }

  const sinEscala = pendientes.length - reparadas.length;
  console.log(
    `Seed: orden canónico sembrado en ${String(reparadas.length)} talla(s) que estaban en 0.` +
      (sinEscala === 0
        ? ''
        : ` Quedaron ${String(sinEscala)} etiqueta(s) que la escala no reconoce (se dejan en 0 a ` +
          'propósito; ordénalas a mano desde Catálogos › Tallas si hace falta).'),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Usuario admin (contraseña TEMPORAL — cambiarla en el primer inicio de sesión)
// ─────────────────────────────────────────────────────────────────────────────

const PASSWORD_TEMPORAL_ADMIN = 'Control.2026!';

async function sembrarAdmin(prisma: PrismaClient): Promise<void> {
  const admin = await prisma.usuario.upsert({
    where: { username: 'admin' },
    // No se pisan nombre/estado si ya existe (pudo editarse en producción).
    update: {},
    create: {
      username: 'admin',
      displayUsername: 'admin',
      nombre: 'Administrador',
      // Email sintético: better-auth lo exige, el negocio no lo usa (doc 10 §4).
      email: 'admin@control.local',
      emailVerified: true,
      activo: true,
    },
  });

  // Cuenta de credenciales de better-auth: providerId "credential" y accountId = id del
  // usuario (convención de better-auth). El hash es scrypt de better-auth/crypto — el
  // MISMO formato que better-auth verifica en el login (E3, ADR-0003).
  // update: {} a propósito — re-correr el seed JAMÁS restablece una contraseña cambiada.
  await prisma.cuenta.upsert({
    where: {
      providerId_accountId: { providerId: 'credential', accountId: admin.id },
    },
    update: {},
    create: {
      providerId: 'credential',
      accountId: admin.id,
      userId: admin.id,
      password: await hashPassword(PASSWORD_TEMPORAL_ADMIN),
    },
  });

  const rolAdministrador = await prisma.rol.findUniqueOrThrow({
    where: { nombre: 'Administrador' },
    select: { id: true },
  });
  await prisma.usuarioRol.upsert({
    where: { idUsuario_idRol: { idUsuario: admin.id, idRol: rolAdministrador.id } },
    update: {},
    create: { idUsuario: admin.id, idRol: rolAdministrador.id },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

/** Corre el seed completo contra el cliente dado (lo reutilizan los tests). */
export async function sembrar(prisma: PrismaClient): Promise<void> {
  await sembrarEmpresa(prisma);
  const idPermisoPorClave = await sembrarPermisos(prisma);
  await sembrarRoles(prisma, idPermisoPorClave);
  await sembrarRolesProveedor(prisma);
  await sembrarTiposProceso(prisma);
  await sembrarGeneros(prisma);
  await sembrarTiposMovimiento(prisma);
  await sembrarAlmacenesPt(prisma);
  // Fichas confiables (F7-E4): los 8 reactivos fijos del checklist del viejo (IP_InfConf), ahora
  // filas configurables (A6). Idempotente por clave.
  await sembrarReactivosFicha(prisma);
  // Desarrollo/Cotización (F8-E1): conceptos de costo (R19; tela/avíos/maquila fijos) y estados de
  // lista (R20; cerrada/ya-pedida son de cierre). Idempotentes por `codigo`. Entran por SEED (no por
  // migración) → el deploy a `prueba` requiere SEED_ON_START=true.
  await sembrarConceptosCosto(prisma);
  await sembrarEstadosLista(prisma);
  // Importador de OC por PDF (§Post-F9.70 punto 2): la plantilla de C&A con su 7% de
  // sobre-pedido. Depende de que el cliente exista (lo carga el ETL): si no está, avisa y sigue.
  await sembrarPlantillaImportacionCya(prisma);
  await sembrarOrdenDeTallas(prisma);
  await sembrarAdmin(prisma);
  // Ruta Crítica (F5-E1): roles funcionales + 26 procesos reales + roles N:M + dependencias +
  // checklist de IP de ejemplo. Después de los roles base de F0 (reúsa "Administrador").
  await sembrarRutaCritica(prisma);
  // Ruta Crítica (F5-E2): familias/artículos + reglas de duración (cantidad/tela/aplicación) +
  // 2 plantillas reales (1/6 y 6/6) con su encadenamiento propio + calendario L–V y festivos MX
  // de la empresa favorita. Después de F5-E1 (necesita los procesos) y de la empresa favorita.
  await sembrarRutaCriticaPlantillas(prisma);
  // Calidad (F6-E1): tipos de producto base (lista corta editable, decisión (d)) + UN plan de
  // muestreo AQL default (ISO 2859 nivel general II, AQL 1.0/2.5/10) como DATOS. Idempotente; no
  // siembra defectos (los carga el ETL de F6-E6).
  await sembrarCalidad(prisma);
}

// Punto de entrada al ejecutarse como script (`prisma db seed` → `tsx prisma/seed.ts`).
const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const prisma = crearClientePrisma(url);
  try {
    await sembrar(prisma);
    console.log('Seed de fundación aplicado (idempotente).');
  } finally {
    await prisma.$disconnect();
  }
}
