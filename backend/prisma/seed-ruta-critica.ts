/**
 * Seed de DESARROLLO de la Ruta Crítica (F5-E1) — IDEMPOTENTE. Siembra:
 *  1. Los ROLES FUNCIONALES reales (`RC_TipoUsuarios.csv`) que falten, sobre el RBAC único (A4):
 *     NO son `esSistema` y NO duplican "Administrador" (ya existe; se reúsa).
 *  2. Los 26 PROCESOS reales (`CP_Procesos.csv`) con sus banderas/tipos mapeados.
 *  3. Sus ROLES RESPONSABLES N:M (`RC_ProcUsua.csv`, 54 asignaciones vigentes).
 *  4. Las DEPENDENCIAS genéricas (un antecesor por proceso, `CP_Procesos.AntecesorRef`).
 *  5. Un CHECKLIST de IP de ejemplo en la "Ficha técnica".
 *
 * **Datos BAKEADOS** (no lee el CSV en runtime): el seed corre en Railway donde los CSV NO
 * viajan en la imagen del backend (mismo criterio que `IPT_TiposMov`/géneros). Los datos se
 * extrajeron en CP850 (CLAUDE.md §4) y se transcribieron aquí 1:1; el ETL FORMAL con cuadre es E7.
 *
 * Idempotencia: procesos por `codigo`; roles por `nombre`; las puentes (roles N:M y dependencias)
 * se SINCRONIZAN al estado conocido (createMany skipDuplicates, sin borrar lo que el usuario haya
 * agregado a mano fuera de este set). El checklist solo se siembra si el proceso no tiene ítems.
 */
import type { PrismaClient } from '../src/datos/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Roles funcionales reales (RC_TipoUsuarios) — sobre el RBAC único (A4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Roles funcionales del sistema viejo (`RC_TipoUsuarios.csv`), con los NOMBRES EXACTOS del CSV
 * (sin acentos salvo "Diseño"). "Administrador" NO va aquí (ya lo siembra el seed de F0; se reúsa).
 * NO son `esSistema` (los puede editar la administración de roles). Idempotente por `nombre`.
 */
const ROLES_FUNCIONALES_RC: string[] = [
  'Ventas',
  'Ingenieria del Producto',
  'Diseño',
  'Produccion',
  'Entregas',
  'Compra Avios',
  'Corte',
  'Calidad',
  'Telas',
  'Diseño Grafico',
  'Habilitaciones',
  'Inventarios',
  'Facturacion',
  'Auxiliar Diseño',
  'Moldes',
  'Auxiliar Produccion',
  'Gerencia',
  'Tecnico Ing Producto',
];

// ─────────────────────────────────────────────────────────────────────────────
// 2-4. Los 26 procesos reales (CP_Procesos) + roles N:M (RC_ProcUsua) + dependencias
// ─────────────────────────────────────────────────────────────────────────────

/** Tipos para el dato bakeado (espejo de los enums de Prisma). */
type CondicionAplicabilidad = 'ninguna' | 'soloSiLlevaAplicacion';
type TipoEventoProceso =
  | 'recepcionTela'
  | 'corte'
  | 'envioCostura'
  | 'reciboCostura'
  | 'envioEstampado'
  | 'reciboEstampado'
  | 'auditoria'
  | 'autorizacionArte'
  | 'entregaCliente'
  | 'manual';
type TipoDuracionProceso = 'fija' | 'porCantidad' | 'porTipoTela' | 'porAplicacion';

interface ProcesoSeed {
  codigo: string;
  nombre: string;
  critico: boolean;
  ultimoProceso: boolean;
  esResurtido: boolean;
  condicionAplicabilidad: CondicionAplicabilidad;
  /** TipoProceso del CSV mapeado a evento de v2 (lo que no tiene evento claro → `manual`). */
  tipoEvento: TipoEventoProceso;
  /** `Variable=1` → `porCantidad`; el resto `fija` (el CSV real no trae variables). */
  tipoDuracion: TipoDuracionProceso;
  /** Código del antecesor (CP_Procesos.AntecesorRef), o `null` si no tiene (proceso raíz). */
  antecesor: string | null;
  /** Roles responsables por NOMBRE (RC_ProcUsua → RC_TipoUsuarios). */
  roles: string[];
}

/**
 * Los 26 procesos reales, en orden de `NumProceso`. Mapeo aplicado:
 *  • `Critico→critico`, `UltimoProceso→ultimoProceso`, `EsResurtido→esResurtido`.
 *  • `NoLlevaProceso=1 → condicionAplicabilidad='soloSiLlevaAplicacion'` (procesos saltables si la
 *    orden no lleva arte/aplicación).
 *  • `Variable=1 → tipoDuracion='porCantidad'` (el resto `fija`).
 *  • `TipoProceso → tipoEvento`: AP→autorizacionArte, T→recepcionTela, CO→corte, EP→envioEstampado,
 *    RP→reciboEstampado, CP→auditoria, EC→envioCostura, C→reciboCostura; F/M/'' → manual.
 *  • R9 (remate, dictamen Daniel §4.9 "auto-completado por evento"): `auditoria-calidad-interna` →
 *    `auditoria` (la AQL final de F6 la completa) y `entrega-cdis` → `entregaCliente` (F3-E5). Para
 *    BDs YA sembradas (el upsert de abajo NO pisa filas existentes) el backfill vive en la migración
 *    `20260710150000_r9_rc_tipo_evento_backfill`.
 *  • `AntecesorRef → antecesor` (dependencia genérica; un antecesor por proceso).
 */
const PROCESOS_RC: ProcesoSeed[] = [
  {
    codigo: 'revision-orden',
    nombre: 'REVISIÓN ORDEN DE PRODUCCIÓN',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: null,
    roles: ['Administrador', 'Gerencia'],
  },
  {
    codigo: 'ficha-desarrollo',
    nombre: 'Ficha de desarrollo',
    critico: false,
    ultimoProceso: false,
    esResurtido: true,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: 'revision-orden',
    roles: ['Administrador', 'Gerencia'],
  },
  {
    codigo: 'programacion',
    nombre: 'Programación',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: 'ficha-desarrollo',
    roles: ['Administrador', 'Gerencia'],
  },
  {
    codigo: 'autorizacion-fit',
    nombre: 'Autorización de fit',
    critico: false,
    ultimoProceso: false,
    esResurtido: true,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: 'revision-orden',
    roles: ['Administrador', 'Ingenieria del Producto'],
  },
  {
    codigo: 'autorizacion-arte',
    nombre: 'Autorización de Arte (Artes Autorizados, Ficha Tecnica y Posicion)',
    critico: false,
    ultimoProceso: false,
    esResurtido: true,
    condicionAplicabilidad: 'soloSiLlevaAplicacion',
    tipoEvento: 'autorizacionArte',
    tipoDuracion: 'fija',
    antecesor: 'revision-orden',
    roles: ['Administrador', 'Calidad'],
  },
  {
    codigo: 'orden-compra-tela',
    nombre: 'Orden de compra tela',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: 'ficha-desarrollo',
    roles: ['Administrador', 'Gerencia'],
  },
  {
    codigo: 'autorizacion-tono-tela',
    nombre: 'Autorización tono de tela',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: 'ficha-desarrollo',
    roles: ['Administrador', 'Gerencia'],
  },
  {
    codigo: 'autorizacion-avios',
    nombre: 'Autorización de avíos',
    critico: false,
    ultimoProceso: false,
    esResurtido: true,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: 'ficha-desarrollo',
    roles: ['Administrador', 'Compra Avios'],
  },
  {
    codigo: 'ficha-tecnica',
    nombre: 'Ficha técnica (Incluye incformación de avíos)',
    critico: false,
    ultimoProceso: false,
    esResurtido: true,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: 'revision-orden',
    roles: ['Administrador', 'Tecnico Ing Producto'],
  },
  {
    codigo: 'contramuestra-maquila',
    nombre: 'Contra muestra  autorizada de maquila (Maquilero)',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: 'autorizacion-fit',
    roles: ['Administrador', 'Tecnico Ing Producto'],
  },
  {
    codigo: 'orden-compra-habilitaciones',
    nombre: 'Órden de compra de habiltaciones e información de avíos a Control',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: 'autorizacion-avios',
    roles: ['Administrador', 'Gerencia'],
  },
  {
    codigo: 'surtido-avios',
    nombre: 'Surtido de avíos',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: 'orden-compra-habilitaciones',
    roles: ['Administrador', 'Produccion'],
  },
  {
    codigo: 'recepcion-tela',
    nombre: 'Recepción de tela',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'recepcionTela',
    tipoDuracion: 'fija',
    antecesor: 'orden-compra-tela',
    roles: ['Administrador', 'Inventarios'],
  },
  {
    codigo: 'autorizacion-muestras-laboratorio',
    nombre: 'Autorización de muestras a laboratorio',
    critico: false,
    ultimoProceso: false,
    esResurtido: true,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: 'recepcion-tela',
    roles: ['Administrador', 'Ingenieria del Producto'],
  },
  {
    codigo: 'entrega-moldes-corte',
    nombre: 'Entrega de moldes auditados a corte',
    critico: false,
    ultimoProceso: false,
    esResurtido: true,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: 'recepcion-tela',
    roles: ['Administrador', 'Corte'],
  },
  {
    codigo: 'auditoria-corte',
    nombre: 'Auditoría de Corte',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: 'entrega-moldes-corte',
    roles: ['Administrador', 'Calidad'],
  },
  {
    codigo: 'corte',
    nombre: 'Corte',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'corte',
    tipoDuracion: 'fija',
    antecesor: 'auditoria-corte',
    roles: ['Administrador', 'Produccion'],
  },
  {
    codigo: 'envio-procesos',
    nombre: 'Envío a procesos',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'soloSiLlevaAplicacion',
    tipoEvento: 'envioEstampado',
    tipoDuracion: 'fija',
    antecesor: 'corte',
    roles: ['Administrador', 'Corte', 'Inventarios'],
  },
  {
    codigo: 'recepcion-procesos',
    nombre: 'Recepción  Procesos',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'soloSiLlevaAplicacion',
    tipoEvento: 'reciboEstampado',
    tipoDuracion: 'fija',
    antecesor: 'envio-procesos',
    roles: ['Administrador', 'Corte', 'Inventarios'],
  },
  {
    codigo: 'auditoria-calidad-proceso',
    nombre: 'Auditoria de Calidad Inicio Proceso o estampado',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'soloSiLlevaAplicacion',
    tipoEvento: 'auditoria',
    tipoDuracion: 'fija',
    antecesor: 'envio-procesos',
    roles: ['Administrador', 'Calidad'],
  },
  {
    codigo: 'envio-confeccion',
    nombre: 'Envío a confección (1500 prendas) por maquilero',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'envioCostura',
    tipoDuracion: 'fija',
    antecesor: 'corte',
    roles: ['Administrador', 'Produccion'],
  },
  {
    codigo: 'recepcion-confeccion',
    nombre: 'Recepción de confección (1500 prendas) por maquilero',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'reciboCostura',
    tipoDuracion: 'fija',
    antecesor: 'envio-confeccion',
    roles: ['Administrador', 'Inventarios'],
  },
  {
    codigo: 'auditoria-calidad-interna',
    nombre: 'Auditoria de Calidad Interna',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    // R9 (dictamen Daniel §4.9): "Calidad → auditoría AQL" — la auditoría interna ES la AQL final
    // de F6; el evento `auditoria-calidad-resuelta` ya existe y la auto-completa (final aprobada).
    tipoEvento: 'auditoria',
    tipoDuracion: 'fija',
    antecesor: 'recepcion-confeccion',
    roles: ['Administrador', 'Entregas'],
  },
  {
    codigo: 'empaque',
    nombre: 'Empaque',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: 'auditoria-calidad-interna',
    roles: ['Administrador', 'Calidad'],
  },
  {
    codigo: 'entrega-cdis',
    nombre: 'Entrega en CDIS',
    critico: false,
    ultimoProceso: false,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    // R9 (dictamen Daniel §4.9): "Entrega → entrega a cliente" — el evento
    // `entrega-cliente-registrada` (F3-E5) ya existe y la auto-completa.
    tipoEvento: 'entregaCliente',
    tipoDuracion: 'fija',
    antecesor: 'empaque',
    roles: ['Administrador', 'Gerencia'],
  },
  {
    codigo: 'aceptacion-cliente',
    nombre: 'Aceptación de Cliente',
    critico: false,
    ultimoProceso: true,
    esResurtido: false,
    condicionAplicabilidad: 'ninguna',
    tipoEvento: 'manual',
    tipoDuracion: 'fija',
    antecesor: 'entrega-cdis',
    roles: ['Administrador', 'Gerencia'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 4b. Rangos de DIFICULTAD por # de operaciones (rediseño R4, B7) — datos de EJEMPLO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tabla de dificultad de ARRANQUE (spec §4.9, Excel `Procesos_RC.xlsx` de Daniel): rango de
 * operaciones → nombre + días de costura. `opsHasta` null = abierto ("33+"). Es CONFIGURABLE:
 * solo se siembra si la tabla está VACÍA (no pisa lo que Daniel edite después).
 */
const RANGOS_DIFICULTAD: {
  opsDesde: number;
  opsHasta: number | null;
  nombre: string;
  diasCostura: number;
}[] = [
  { opsDesde: 1, opsHasta: 8, nombre: 'Muy sencillo', diasCostura: 6 },
  { opsDesde: 9, opsHasta: 14, nombre: 'Sencillo', diasCostura: 8 },
  { opsDesde: 15, opsHasta: 22, nombre: 'Medio', diasCostura: 11 },
  { opsDesde: 23, opsHasta: 32, nombre: 'Complejo', diasCostura: 15 },
  { opsDesde: 33, opsHasta: null, nombre: 'Muy complejo', diasCostura: 20 },
];

// ─────────────────────────────────────────────────────────────────────────────
// 5. Checklist de IP de ejemplo (en la "Ficha técnica")
// ─────────────────────────────────────────────────────────────────────────────

/** Código del proceso donde va el checklist de ejemplo y sus ítems EN ORDEN. */
const CHECKLIST_EJEMPLO = {
  codigoProceso: 'ficha-tecnica',
  items: [
    'Verificar curva de tallas y consumos de tela',
    'Confirmar el listado de avíos y sus proveedores',
    'Revisar las posiciones de bordado/estampado',
    'Validar el precio de maquila estimado',
  ],
};

/**
 * Siembra el catálogo configurable de la Ruta Crítica (F5-E1). Idempotente; se invoca desde el
 * seed principal después de que los roles base de F0 ya existen (reúsa "Administrador").
 */
export async function sembrarRutaCritica(prisma: PrismaClient): Promise<void> {
  // 1) Roles funcionales (no esSistema). Idempotente por nombre; no pisa los existentes.
  for (const nombre of ROLES_FUNCIONALES_RC) {
    await prisma.rol.upsert({
      where: { nombre },
      update: {},
      create: { nombre, descripcion: `Rol funcional ${nombre} (Ruta Crítica)`, esSistema: false },
    });
  }

  // Mapa nombre→id de todos los roles que vamos a referenciar (incluye Administrador de F0).
  const nombresRoles = new Set<string>([
    ...ROLES_FUNCIONALES_RC,
    ...PROCESOS_RC.flatMap((p) => p.roles),
  ]);
  const roles = await prisma.rol.findMany({
    where: { nombre: { in: [...nombresRoles] } },
    select: { id: true, nombre: true },
  });
  const idRolPorNombre = new Map(roles.map((r) => [r.nombre, r.id]));

  // 2) Procesos. Idempotente por codigo; no pisa banderas/tipos si ya existen (pudieron editarse).
  for (const proceso of PROCESOS_RC) {
    await prisma.procesoDef.upsert({
      where: { codigo: proceso.codigo },
      update: {},
      create: {
        codigo: proceso.codigo,
        nombre: proceso.nombre,
        critico: proceso.critico,
        ultimoProceso: proceso.ultimoProceso,
        esResurtido: proceso.esResurtido,
        condicionAplicabilidad: proceso.condicionAplicabilidad,
        tipoEvento: proceso.tipoEvento,
        tipoDuracion: proceso.tipoDuracion,
      },
    });
  }

  const procesos = await prisma.procesoDef.findMany({ select: { id: true, codigo: true } });
  const idProcesoPorCodigo = new Map(procesos.map((p) => [p.codigo, p.id]));

  // 3) Roles responsables N:M (createMany skipDuplicates: no duplica ni borra lo agregado a mano).
  const filasRoles: { idProcesoDef: number; idRol: number }[] = [];
  for (const proceso of PROCESOS_RC) {
    const idProceso = idProcesoPorCodigo.get(proceso.codigo);
    if (idProceso === undefined) continue;
    for (const nombreRol of proceso.roles) {
      const idRol = idRolPorNombre.get(nombreRol);
      if (idRol !== undefined) {
        filasRoles.push({ idProcesoDef: idProceso, idRol });
      }
    }
  }
  if (filasRoles.length > 0) {
    await prisma.procesoDefRol.createMany({ data: filasRoles, skipDuplicates: true });
  }

  // 4) Dependencias genéricas (un antecesor por proceso, AntecesorRef).
  const filasDep: { idProceso: number; idAntecesor: number }[] = [];
  for (const proceso of PROCESOS_RC) {
    if (proceso.antecesor === null) continue;
    const idProceso = idProcesoPorCodigo.get(proceso.codigo);
    const idAntecesor = idProcesoPorCodigo.get(proceso.antecesor);
    if (idProceso !== undefined && idAntecesor !== undefined && idProceso !== idAntecesor) {
      filasDep.push({ idProceso, idAntecesor });
    }
  }
  if (filasDep.length > 0) {
    await prisma.procesoDep.createMany({ data: filasDep, skipDuplicates: true });
  }

  // 4b) Rangos de dificultad (R4, B7): solo si la tabla está VACÍA (no pisa la configuración).
  const yaHayRangos = await prisma.rangoDificultad.count();
  if (yaHayRangos === 0) {
    await prisma.rangoDificultad.createMany({
      data: RANGOS_DIFICULTAD.map((r, orden) => ({
        opsDesde: r.opsDesde,
        opsHasta: r.opsHasta,
        nombre: r.nombre,
        diasCostura: r.diasCostura,
        orden,
      })),
    });
  }

  // 5) Checklist de IP de ejemplo: solo si el proceso aún no tiene ítems (no pisa lo capturado).
  const idChecklistProceso = idProcesoPorCodigo.get(CHECKLIST_EJEMPLO.codigoProceso);
  if (idChecklistProceso !== undefined) {
    const yaTiene = await prisma.procesoChecklist.count({
      where: { idProcesoDef: idChecklistProceso },
    });
    if (yaTiene === 0) {
      await prisma.procesoChecklist.createMany({
        data: CHECKLIST_EJEMPLO.items.map((descripcion, orden) => ({
          idProcesoDef: idChecklistProceso,
          descripcion,
          orden,
        })),
      });
    }
  }
}
