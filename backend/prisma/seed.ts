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
      upc: '7500092',
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
  // ESTRUCTURADOS de F1-E2 (maquileros/tallas/clientes) siguen el MISMO reparto.
  const directivo = sin(
    todos,
    'usuarios.administrar',
    'roles.administrar',
    'almacenes.administrar',
    'empresas.administrar',
    'proveedores.administrar',
    'cortadores.administrar',
    'temporadas.administrar',
    'etiquetas-marca.administrar',
    'colores.administrar',
    // F1-E2 — catálogos estructurados.
    'maquileros.administrar',
    'tallas.administrar',
    'clientes.administrar',
  );

  // Nivel 40 — Gerencial: "como Directivo, pero sin menú de Costos ni ver costos".
  const gerencial = sin(directivo, 'ordenes.ver-costos');

  // Nivel 45 — Ventas: "sin ver el total de ventas en $ en Pedidos" → importes/precios
  // en consultas.
  const ventas = sin(gerencial, 'consultas.ver-importes');

  // Nivel 47 — Logística: "sin importes; no puede crear/modificar órdenes" → fuera
  // modificar órdenes y los precios de maquila (importes de la orden).
  const logistica = sin(
    ventas,
    'ordenes.modificar',
    'ordenes.precio-maquila',
    'ordenes.ver-precio-real-maquila',
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
  { codigo: 'maquila-costura', nombre: 'Maquila (costura)' },
  { codigo: 'corte', nombre: 'Corte' },
  { codigo: 'estampado-aplicacion', nombre: 'Estampado / aplicación' },
  { codigo: 'vende-telas', nombre: 'Vende telas' },
  { codigo: 'vende-avios', nombre: 'Vende avíos' },
  { codigo: 'otros-servicios', nombre: 'Otros servicios' },
];

async function sembrarRolesProveedor(prisma: PrismaClient): Promise<void> {
  for (const rol of ROLES_PROVEEDOR_BASE) {
    await prisma.rolProveedor.upsert({
      where: { codigo: rol.codigo },
      // No se pisa el nombre/activo si ya existe (pudo editarse en producción).
      update: {},
      create: { codigo: rol.codigo, nombre: rol.nombre },
    });
  }
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
const TIPOS_PROCESO_BASE: { codigo: string; nombre: string }[] = [
  { codigo: 'costura', nombre: 'Costura' },
  { codigo: 'estampado', nombre: 'Estampado' },
  { codigo: 'bordado', nombre: 'Bordado' },
  { codigo: 'lavado', nombre: 'Lavado' },
  { codigo: 'aplicacion', nombre: 'Aplicación' },
];

async function sembrarTiposProceso(prisma: PrismaClient): Promise<void> {
  for (const tipo of TIPOS_PROCESO_BASE) {
    await prisma.tipoProceso.upsert({
      where: { codigo: tipo.codigo },
      // No se pisa el nombre/activo si ya existe (pudo editarse en producción).
      update: {},
      create: { codigo: tipo.codigo, nombre: tipo.nombre },
    });
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
  await sembrarAdmin(prisma);
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
