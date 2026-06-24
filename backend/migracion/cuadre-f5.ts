/**
 * Reporte de CUADRE de la RUTA CRÍTICA (F5-E7, Pieza B), espejo de `cuadre-f4.ts`/`cuadre-fase.ts`
 * (§7 — un dato tirado en silencio NO puede cerrar en verde). Cuenta v1 (CSV) vs v2 (BD) por entidad y
 * LISTA las inconsistencias de origen que el ETL no "arregla": las 14 asignaciones HUÉRFANAS de
 * `RC_ProcUsua`, los usuarios con tipo sin usuario v2 (pendientes F9) y los `RC_TipoUsuarios` sin Rol,
 * y declara `RC_TipoTelas.FactorTela` como columna NO migrada a propósito (ADR-0012/E3).
 *
 * Objetivo: correr el ETL DOS veces seguidas = MISMOS números (idempotente). Este cuadre es de SOLO
 * LECTURA y se puede correr aparte con `npx tsx --env-file=.env migracion/cuadre-f5.ts`.
 */
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { contarFilasCsv, leerCsv } from './comun/csv.js';
import { cargarMapaNumerico, ENTIDAD_MAPEO } from './comun/mapeo.js';
import { parsearTexto } from './comun/valores.js';
import { cargarRolesPorNombre, construirPuenteProcesos } from './ruta-critica/comun.js';

/** Un renglón del cuadre de conteos: entidad, v1, v2, nota. */
export interface RenglonCuadreF5 {
  entidad: string;
  v1: number;
  v2: number;
  nota: string;
}

/** Listas cualitativas del cuadre (inconsistencias de origen — NO se corrigen, se listan). */
export interface ListasCuadreF5 {
  /** # de RC_ProcUsua HUÉRFANAS (proceso inexistente en v2): 14 esperadas. */
  procUsuaHuerfanas: number;
  /** Detalle (acotado) de las huérfanas. */
  detalleHuerfanas: string[];
  /** # de RC_TipoUsuarios sin Rol equivalente en v2. */
  tiposSinRol: number;
  /** Detalle de los tipos sin rol. */
  detalleTiposSinRol: string[];
  /** # de usuarios del viejo con tipo (esperado 23). */
  usuariosConTipo: number;
  /** # de esos usuarios cuyo usuario v2 EXISTE hoy (se les pudo/podrá asignar el rol). */
  usuariosCasadosV2: number;
  /** # de esos usuarios PENDIENTES hasta la migración de usuarios (F9). */
  usuariosPendientesF9: number;
  /** # de usuarios ACTIVOS del viejo SIN tipo RC. */
  activosSinTipo: number;
}

/** Cuadre F5 completo. */
export interface CuadreF5 {
  conteos: RenglonCuadreF5[];
  listas: ListasCuadreF5;
}

/** Bloque (1): conteos v1 (CSV) vs v2 (BD). */
async function calcularConteos(cliente: PrismaClient): Promise<RenglonCuadreF5[]> {
  const v1Familias = contarFilasCsv('CP_Familia.csv');
  const v1Articulos = contarFilasCsv('CP_Articulos.csv');
  const v1Procesos = contarFilasCsv('CP_Procesos.csv');
  const v1Tiempos = contarFilasCsv('CP_Tiempos.csv');
  const v1Cant = contarFilasCsv('CP_Cant.csv');
  const v1Telas = contarFilasCsv('RC_TipoTelas.csv');
  const v1Aplic = contarFilasCsv('RC_Aplicaciones.csv');
  const v1TiposUsuario = contarFilasCsv('RC_TipoUsuarios.csv');
  const v1ProcUsua = contarFilasCsv('RC_ProcUsua.csv');
  const v1Rc = contarFilasCsv('RC.csv');
  const v1Ip3 = contarFilasCsv('RC_IP3.csv');
  const v1Ip4 = contarFilasCsv('RC_IP4.csv');

  const [
    v2Familias,
    v2Articulos,
    v2Procesos,
    v2ProcDefRol,
    v2PlantProc,
    v2Factores,
    v2Telas,
    v2Aplic,
    v2RutaOrden,
    v2RutaChecklist,
    v2UsuarioRol,
  ] = await Promise.all([
    cliente.familiaArticulo.count(),
    cliente.articuloRC.count(),
    cliente.procesoDef.count(),
    cliente.procesoDefRol.count(),
    cliente.plantillaRutaProceso.count(),
    cliente.factorCantidad.count(),
    cliente.duracionPorTipoTela.count(),
    cliente.duracionPorAplicacion.count(),
    cliente.rutaOrden.count(),
    cliente.rutaOrdenChecklist.count(),
    cliente.usuarioRol.count(),
  ]);

  return [
    {
      entidad: 'Familias (CP_Familia)',
      v1: v1Familias,
      v2: v2Familias,
      nota: 'v2 ≥ v1: el seed de E2 ya las sembró; el ETL solo crea las que falten.',
    },
    {
      entidad: 'Artículos RC (CP_Articulos)',
      v1: v1Articulos,
      v2: v2Articulos,
      nota: 'v2 ≥ v1 (seed E2 + ETL).',
    },
    {
      entidad: 'Procesos (CP_Procesos)',
      v1: v1Procesos,
      v2: v2Procesos,
      nota: 'v2 = 26 (los siembra E1; el ETL NO los re-crea, solo verifica por código).',
    },
    {
      entidad: 'Roles responsables N:M (RC_ProcUsua)',
      v1: v1ProcUsua,
      v2: v2ProcDefRol,
      nota: 'v1=68 = 54 vigentes (migradas a ProcesoDefRol) + 14 HUÉRFANAS (listadas, no migradas). v2 cuenta solo las materializadas (puede incluir las del seed E1, que son las mismas).',
    },
    {
      entidad: 'Plantillas: renglones (CP_Tiempos)',
      v1: v1Tiempos,
      v2: v2PlantProc,
      nota: 'v1=156 (26 procesos × 6 artículos). v2 = renglones de plantilla (seed E2 ya sembró 2 plantillas; el ETL crea las que falten por artículo).',
    },
    {
      entidad: 'Factores por cantidad (CP_Cant)',
      v1: v1Cant,
      v2: v2Factores,
      nota: 'v2 ≥ v1 (seed E2 + ETL, idempotente por rango).',
    },
    {
      entidad: 'Duración por tipo de tela (RC_TipoTelas)',
      v1: v1Telas,
      v2: v2Telas,
      nota: 'v2 ≥ v1. FactorTela NO se aplica (ADR-0012/E3) — la columna existe pero el motor no la usa.',
    },
    {
      entidad: 'Duración por aplicación (RC_Aplicaciones)',
      v1: v1Aplic,
      v2: v2Aplic,
      nota: 'v2 ≥ v1 (sin factor en el origen).',
    },
    {
      entidad: 'Tipos de usuario (RC_TipoUsuarios → Rol)',
      v1: v1TiposUsuario,
      v2: 0,
      nota: 'Sin catálogo paralelo: casan por NOMBRE con los Roles del RBAC único (A4). v2 no se cuenta como tabla propia; los que no casan se LISTAN.',
    },
    {
      entidad: 'Ruta viva histórica (RC)',
      v1: v1Rc,
      v2: v2RutaOrden,
      nota: 'v1=181 renglones (8 órdenes). v2 = RutaOrden (incluye rutas v2 generadas además del histórico): v2 ≥ histórico migrado. Renglones de órdenes no migradas se OMITEN (listados).',
    },
    {
      entidad: 'Checklist de ruta (RC_IP3 + RC_IP4)',
      v1: v1Ip3 + v1Ip4,
      v2: v2RutaChecklist,
      nota: 'v1 = filas IP3(6 cols)+IP4(3 cols) por renglón; v2 = ítems de checklist (9 por renglón con IP). v2 incluye checklists de rutas v2 generadas.',
    },
    {
      entidad: 'Roles por usuario (Usuarios → UsuarioRol)',
      v1: 23,
      v2: v2UsuarioRol,
      nota: 'v1 = 23 usuarios con IdRC_TipoUsuarios. v2 = UsuarioRol total (incluye los de seed/admin). Los usuarios v2 inexistentes quedan PENDIENTES hasta F9 (listados).',
    },
  ];
}

/** Bloque (2): listas cualitativas (huérfanas, tipos sin rol, usuarios pendientes F9). */
async function calcularListas(cliente: PrismaClient): Promise<ListasCuadreF5> {
  const { porIdViejo } = await construirPuenteProcesos(cliente);

  // RC_ProcUsua huérfanas.
  const detalleHuerfanas: string[] = [];
  for (const f of leerCsv('RC_ProcUsua.csv')) {
    const idProcViejo = (f.IdCP_Procesos ?? '').trim();
    if (!porIdViejo.has(idProcViejo)) {
      detalleHuerfanas.push(
        `IdRC_ProcUsua=${(f.IdRC_ProcUsua ?? '').trim()} IdCP_Procesos=${idProcViejo} IdRC_TipoUsuarios=${(f.IdRC_TipoUsuarios ?? '').trim()}`,
      );
    }
  }

  // RC_TipoUsuarios sin Rol.
  const rolesPorNombre = await cargarRolesPorNombre(cliente);
  const nombreTipoPorId = new Map<string, string>();
  const detalleTiposSinRol: string[] = [];
  for (const f of leerCsv('RC_TipoUsuarios.csv')) {
    const idTipo = (f.IdRC_TipoUsuarios ?? '').trim();
    const nombre = parsearTexto(f.NombreTipoUsuario);
    if (idTipo === '' || nombre === null) continue;
    nombreTipoPorId.set(idTipo, nombre);
    if (!rolesPorNombre.has(nombre)) {
      detalleTiposSinRol.push(`IdRC_TipoUsuarios=${idTipo} nombre="${nombre}"`);
    }
  }

  // Usuarios con tipo: cuántos casan a un usuario v2 EXISTENTE vs pendientes F9; activos sin tipo.
  const usuariosV2 = await cliente.usuario.findMany({ select: { username: true } });
  const loginsV2 = new Set(usuariosV2.map((u) => u.username.trim().toLowerCase()));
  let usuariosConTipo = 0;
  let usuariosCasadosV2 = 0;
  let usuariosPendientesF9 = 0;
  let activosSinTipo = 0;
  for (const f of leerCsv('Usuarios.csv')) {
    const idTipo = (f.IdRC_TipoUsuarios ?? '').trim();
    const tieneTipo = idTipo !== '' && idTipo !== '0';
    const activo = ['1', '-1', 'true', 'sí', 'si'].includes((f.Activo ?? '').trim().toLowerCase());
    const login = parsearTexto(f.Usuario)?.toLowerCase() ?? null;
    if (!tieneTipo) {
      if (activo) activosSinTipo += 1;
      continue;
    }
    usuariosConTipo += 1;
    if (login !== null && loginsV2.has(login)) usuariosCasadosV2 += 1;
    else usuariosPendientesF9 += 1;
  }

  return {
    procUsuaHuerfanas: detalleHuerfanas.length,
    detalleHuerfanas,
    tiposSinRol: detalleTiposSinRol.length,
    detalleTiposSinRol,
    usuariosConTipo,
    usuariosCasadosV2,
    usuariosPendientesF9,
    activosSinTipo,
  };
}

/** Calcula el cuadre F5 completo (conteos + listas). */
export async function calcularCuadreF5(cliente: PrismaClient): Promise<CuadreF5> {
  // Forzar resolución de los mapeos (lectura) para que el cuadre falle claro si faltara F2.
  await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.orden);
  const conteos = await calcularConteos(cliente);
  const listas = await calcularListas(cliente);
  return { conteos, listas };
}

/** Da formato de texto al cuadre F5. */
export function formatearCuadreF5(c: CuadreF5): string {
  const p: string[] = [];
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(' CUADRE F5 (RUTA CRÍTICA) — v1 (CSV) vs v2 (Postgres)');
  p.push('═══════════════════════════════════════════════════════════════');
  p.push(`${'Entidad'.padEnd(40)}${'v1'.padStart(8)}${'v2'.padStart(8)}   Nota`);
  p.push('─'.repeat(80));
  for (const r of c.conteos) {
    const v2 = r.v2 === 0 ? '   —' : String(r.v2);
    p.push(`${r.entidad.padEnd(40)}${String(r.v1).padStart(8)}${v2.padStart(8)}   ${r.nota}`);
  }

  const L = c.listas;
  p.push('');
  p.push('── Inconsistencias de origen LISTADAS (NO se corrigen, §7) ──');
  p.push(
    `  RC_ProcUsua HUÉRFANAS (proceso inexistente en v2): ${String(L.procUsuaHuerfanas)} (esperado 14)`,
  );
  for (const d of L.detalleHuerfanas.slice(0, 20)) p.push(`    - ${d}`);
  if (L.detalleHuerfanas.length > 20)
    p.push(`    … y ${String(L.detalleHuerfanas.length - 20)} más.`);

  p.push(`  RC_TipoUsuarios SIN Rol equivalente en v2: ${String(L.tiposSinRol)}`);
  for (const d of L.detalleTiposSinRol.slice(0, 20)) p.push(`    - ${d}`);

  p.push('');
  p.push('── Roles por usuario (dependencia cruzada con F9) ──');
  p.push(
    `  Usuarios del viejo con tipo RC                  : ${String(L.usuariosConTipo)} (esperado 23)`,
  );
  p.push(`    casan a un usuario v2 EXISTENTE (asignables)  : ${String(L.usuariosCasadosV2)}`);
  p.push(
    `    PENDIENTES hasta migración de usuarios (F9)    : ${String(L.usuariosPendientesF9)} — re-correr el ETL tras F9 los materializa`,
  );
  p.push(`  Usuarios ACTIVOS del viejo SIN tipo RC          : ${String(L.activosSinTipo)}`);

  p.push('');
  p.push('── Columnas declaradas NO migradas a propósito ──');
  p.push(
    '  RC_TipoTelas.FactorTela: el viejo NO lo aplicaba (ADR-0012/E3). La columna existe y el seed la',
  );
  p.push('  cargó, pero el motor de duración NO la usa; el ETL no la "corrige".');

  return p.join('\n');
}

/** Punto de entrada del script `cuadre-f5.ts` (solo lee/cuenta). */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const cliente = crearClientePrisma(url);
  try {
    const cuadre = await calcularCuadreF5(cliente);
    console.log(formatearCuadreF5(cuadre));
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
