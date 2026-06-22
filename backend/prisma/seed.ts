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
 */
import { pathToFileURL } from 'node:url';

import { hashPassword } from 'better-auth/crypto';

import { CATALOGO_PERMISOS, CLAVES_PERMISO, type ClavePermiso } from '../src/contrato/index.js';
import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { sembrarRutaCritica } from './seed-ruta-critica.js';

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
  // Las fechas de inventario físico y el almacén PT por defecto los traerá la migración (F8).
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
  // (telas/avios/bordados) siguen el MISMO reparto.
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
    'bordados.administrar',
    // F1-E4 — modelos (Módulo 2): administrar el catálogo + BOM + fotos solo para
    // Administrador y AdministracionDireccion (mismo reparto que el resto de catálogos).
    'modelos.administrar',
    // F3-E1 — tipos de proceso (Módulo 4, catálogo): administrar solo Administrador y
    // AdministracionDireccion (mismo reparto que el resto de catálogos). El `ver` y los
    // permisos operativos de producción/inventario cascadean (siguen en el conjunto).
    'tipos-proceso.administrar',
  );

  // Nivel 40 — Gerencial: "como Directivo, pero sin menú de Costos ni ver costos".
  const gerencial = sin(directivo, 'ordenes.ver-costos');

  // Nivel 45 — Ventas: "sin ver el total de ventas en $ en Pedidos" → importes/precios
  // en consultas Y en el módulo Pedidos (F2-E1: `pedidos.importes` oculta `precio`/totales,
  // doc 02-Pedidos §3). Ventas SÍ captura pedidos (alta/edición), solo no ve los importes.
  const ventas = sin(gerencial, 'consultas.ver-importes', 'pedidos.importes');

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
  { codigo: 'estampado', nombre: 'Estampado' },
  { codigo: 'bordado', nombre: 'Bordado' },
  { codigo: 'lavado', nombre: 'Lavado' },
  { codigo: 'aplicacion', nombre: 'Aplicación' },
  // Venta de materiales (proveedores comerciales).
  { codigo: 'vende-telas', nombre: 'Vende telas' },
  { codigo: 'vende-avios', nombre: 'Vende avíos' },
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
const TIPOS_PROCESO_BASE: { codigo: string; nombre: string; generaEntradaPt: boolean }[] = [
  { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  { codigo: 'estampado', nombre: 'Estampado', generaEntradaPt: false },
  { codigo: 'bordado', nombre: 'Bordado', generaEntradaPt: false },
  { codigo: 'lavado', nombre: 'Lavado', generaEntradaPt: false },
  { codigo: 'aplicacion', nombre: 'Aplicación', generaEntradaPt: false },
];

async function sembrarTiposProceso(prisma: PrismaClient): Promise<void> {
  for (const tipo of TIPOS_PROCESO_BASE) {
    await prisma.tipoProceso.upsert({
      where: { codigo: tipo.codigo },
      // No se pisa nombre/activo/generaEntradaPt si ya existe (pudo editarse en producción).
      update: {},
      create: {
        codigo: tipo.codigo,
        nombre: tipo.nombre,
        generaEntradaPt: tipo.generaEntradaPt,
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
const GENEROS_BASE: string[] = [
  'Caballero',
  'Dama',
  'Niño Infantil',
  'Niña Infantil',
  'Niño Juvenil',
  'Niña Juvenil',
  'Bebo',
  'Beba',
];

async function sembrarGeneros(prisma: PrismaClient): Promise<void> {
  for (const nombre of GENEROS_BASE) {
    await prisma.genero.upsert({
      where: { nombre },
      // No se pisa el activo si ya existe (pudo editarse/desactivarse en producción).
      update: {},
      create: { nombre },
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

async function sembrarTiposMovimiento(prisma: PrismaClient): Promise<void> {
  await verificarTiposMovimientoContraCsv();
  // Los 19 canónicos del CSV + los 2 nuevos de F3-E3 (patas del traspaso) + los 3 de F4-E1 (kardex
  // de telas y avíos). Idempotente: el `update: {}` no pisa nombre/dirección/activo si ya existen
  // (pudieron editarse en producción).
  for (const tipo of [...TIPOS_MOVIMIENTO_BASE, ...TIPOS_MOVIMIENTO_V2, ...TIPOS_MOVIMIENTO_F4]) {
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
      await prisma.almacen.create({ data: { nombre, tipo: 'PT', idEmpresa: null } });
    }
  }
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
  await sembrarAdmin(prisma);
  // Ruta Crítica (F5-E1): roles funcionales + 26 procesos reales + roles N:M + dependencias +
  // checklist de IP de ejemplo. Después de los roles base de F0 (reúsa "Administrador").
  await sembrarRutaCritica(prisma);
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
