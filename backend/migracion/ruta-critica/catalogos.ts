/**
 * VERIFICACIÓN + COMPLETADO de los CATÁLOGOS de la Ruta Crítica (F5-E7, Pieza B).
 *
 * El catálogo configurable de la RC (procesos, roles N:M, dependencias, familias/artículos, factores
 * por cantidad, duraciones por tela/aplicación, calendario) lo SIEMBRA F5-E1/E2 con datos BAKEADOS
 * (los CSV no viajan en la imagen de Railway). Por eso este ETL formal NO re-crea esos catálogos: los
 * VERIFICA contra los CSV reales y solo CREA lo que falte (regla de la ficha: "empieza verificando").
 *
 * Lo que verifica/completa aquí:
 *  • Familias (`CP_Familia`) y artículos (`CP_Articulos`) — crea los que falten vía dominio.
 *  • Factores por cantidad (`CP_Cant`), duraciones por tela (`RC_TipoTelas`) y aplicación
 *    (`RC_Aplicaciones`) — crea los que falten vía dominio.
 *  • CUADRE de los 26 procesos (`CP_Procesos`) y de los roles responsables N:M (`RC_ProcUsua`),
 *    LISTANDO las 14 asignaciones HUÉRFANAS (apuntan a procesos que no existen en v2) y los
 *    `RC_TipoUsuarios` sin rol — NO se arreglan, se reportan (§7).
 *  • `RC_TipoTelas.FactorTela` se LISTA como columna NO migrada a propósito (ADR-0012/E3: el viejo no
 *    aplicaba ese factor; el comportamiento es no aplicarlo). El esquema SÍ tiene la columna y el seed
 *    la cargó; aquí solo se documenta que el ETL no la "corrige".
 *
 * Todo vía el DOMINIO (A1, modo migración con la sesión de sistema). Idempotente.
 */
import {
  crearArticulo,
  crearFamilia,
  listarArticulos,
  listarFamilias,
} from '../../src/dominio/ruta-critica/familiasArticulos.js';
import {
  crearDuracionAplicacion,
  crearDuracionTela,
  crearFactorCantidad,
  listarDuracionesAplicacion,
  listarDuracionesTela,
  listarFactoresCantidad,
} from '../../src/dominio/ruta-critica/reglasDuracion.js';
import { sincronizarRolesProcesoMigrado } from '../../src/dominio/ruta-critica/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { parsearDinero, parsearEntero, parsearTexto } from '../comun/valores.js';
import { intentarCrear } from '../comun/saneo.js';
import type { Reporte } from '../comun/reporte.js';

import { cargarRolesPorNombre, construirPuenteProcesos } from './comun.js';

/** Conteo resumido de un verificador de catálogo. */
export interface ResultadoCatalogo {
  creados: number;
  existentes: number;
  omitidos: number;
}

const VACIO: ResultadoCatalogo = { creados: 0, existentes: 0, omitidos: 0 };

/** Resultado consolidado de la verificación de catálogos. */
export interface ResultadoCatalogos {
  familias: ResultadoCatalogo;
  articulos: ResultadoCatalogo;
  factores: ResultadoCatalogo;
  telas: ResultadoCatalogo;
  aplicaciones: ResultadoCatalogo;
  /** Mapa `IdCP_Familia → idFamilia v2` (lo usan las plantillas). */
  idFamiliaPorIdViejo: Map<string, number>;
  /** Mapa `IdCP_Articulos → idArticulo v2` (lo usan las plantillas). */
  idArticuloPorIdViejo: Map<string, number>;
  /** Procesos del CSV que no se encontraron en v2 (deben ser 0 si E1 está sembrado). */
  procesosFaltantes: number;
  /** Asignaciones RC_ProcUsua VIGENTES (proceso existe en v2): 54 esperadas. */
  procUsuaVigentes: number;
  /** Asignaciones RC_ProcUsua HUÉRFANAS (proceso inexistente en v2): 14 esperadas. */
  procUsuaHuerfanas: number;
  /** Filas `ProcesoDefRol` insertadas en ESTA corrida (0 en re-corridas — idempotente). */
  rolesResponsablesInsertados: number;
  /** RC_TipoUsuarios sin rol equivalente en el RBAC de v2. */
  tiposUsuarioSinRol: number;
}

// ── Familias + artículos ────────────────────────────────────────────────────────

/** Verifica/crea las familias y devuelve el mapa `IdCP_Familia → idFamilia v2` (por nombre). */
async function verificarFamilias(
  sesion: SesionUsuario,
  bd: ContextoBd,
  reporte: Reporte,
): Promise<{ resultado: ResultadoCatalogo; idPorIdViejo: Map<string, number> }> {
  const existentes = await listarFamilias(sesion, true, bd);
  const idPorNombre = new Map(existentes.map((f) => [f.nombre.trim(), f.id]));
  const idPorIdViejo = new Map<string, number>();
  const resultado: ResultadoCatalogo = { ...VACIO };

  for (const f of leerCsv('CP_Familia.csv')) {
    const idViejo = (f.IdCP_Familia ?? '').trim();
    const nombre = parsearTexto(f.Familia);
    if (idViejo === '' || nombre === null) {
      resultado.omitidos += 1;
      continue;
    }
    let id = idPorNombre.get(nombre);
    if (id === undefined) {
      const creado = await intentarCrear(reporte, 'FamiliaArticulo', idViejo, () =>
        crearFamilia(sesion, { nombre }, bd),
      );
      if (creado === null) {
        resultado.omitidos += 1;
        continue;
      }
      id = creado.id;
      idPorNombre.set(nombre, id);
      resultado.creados += 1;
    } else {
      resultado.existentes += 1;
    }
    idPorIdViejo.set(idViejo, id);
  }
  return { resultado, idPorIdViejo };
}

/** Verifica/crea los artículos y devuelve `IdCP_Articulos → idArticulo v2` (por nombre+familia). */
async function verificarArticulos(
  sesion: SesionUsuario,
  bd: ContextoBd,
  reporte: Reporte,
  idFamiliaPorIdViejo: Map<string, number>,
): Promise<{ resultado: ResultadoCatalogo; idPorIdViejo: Map<string, number> }> {
  const existentes = await listarArticulos(sesion, true, bd);
  // Clave de dedup: nombre+idFamilia (no hay unique de nombre en ArticuloRC).
  const idPorClave = new Map(
    existentes.map((a) => [`${a.nombre.trim()}|${a.idFamiliaArticulo}`, a.id]),
  );
  const idPorIdViejo = new Map<string, number>();
  const resultado: ResultadoCatalogo = { ...VACIO };

  for (const f of leerCsv('CP_Articulos.csv')) {
    const idViejo = (f.IdCP_Articulos ?? '').trim();
    const nombre = parsearTexto(f.Descripcion);
    const idFamilia = idFamiliaPorIdViejo.get((f.IdCP_Familia ?? '').trim());
    if (idViejo === '' || nombre === null || idFamilia === undefined) {
      resultado.omitidos += 1;
      continue;
    }
    const clave = `${nombre}|${idFamilia}`;
    let id = idPorClave.get(clave);
    if (id === undefined) {
      const creado = await intentarCrear(reporte, 'ArticuloRC', idViejo, () =>
        crearArticulo(sesion, { nombre, idFamiliaArticulo: idFamilia }, bd),
      );
      if (creado === null) {
        resultado.omitidos += 1;
        continue;
      }
      id = creado.id;
      idPorClave.set(clave, id);
      resultado.creados += 1;
    } else {
      resultado.existentes += 1;
    }
    idPorIdViejo.set(idViejo, id);
  }
  return { resultado, idPorIdViejo };
}

// ── Reglas de duración ────────────────────────────────────────────────────────

/** Verifica/crea los factores por cantidad (`CP_Cant`), idempotente por el rango deCant+aCant. */
async function verificarFactores(
  sesion: SesionUsuario,
  bd: ContextoBd,
  reporte: Reporte,
): Promise<ResultadoCatalogo> {
  const existentes = await listarFactoresCantidad(sesion, true, bd);
  const claves = new Set(existentes.map((f) => `${f.deCant}-${f.aCant}`));
  const resultado: ResultadoCatalogo = { ...VACIO };
  for (const f of leerCsv('CP_Cant.csv')) {
    const idViejo = (f.IdCP_Cant ?? '').trim();
    const deCant = parsearEntero(f.DeCant);
    const aCant = parsearEntero(f.ACant);
    const factor = parsearDinero(f.FactorCant);
    if (deCant === null || aCant === null || factor === null) {
      resultado.omitidos += 1;
      continue;
    }
    if (claves.has(`${deCant}-${aCant}`)) {
      resultado.existentes += 1;
      continue;
    }
    const creado = await intentarCrear(reporte, 'FactorCantidad', idViejo, () =>
      crearFactorCantidad(sesion, { deCant, aCant, factor }, bd),
    );
    if (creado === null) {
      resultado.omitidos += 1;
      continue;
    }
    claves.add(`${deCant}-${aCant}`);
    resultado.creados += 1;
  }
  return resultado;
}

/** Verifica/crea las duraciones por tipo de tela (`RC_TipoTelas`), idempotente por nombre. */
async function verificarTelas(
  sesion: SesionUsuario,
  bd: ContextoBd,
  reporte: Reporte,
): Promise<ResultadoCatalogo> {
  const existentes = await listarDuracionesTela(sesion, true, bd);
  const nombres = new Set(existentes.map((t) => t.nombre.trim()));
  const resultado: ResultadoCatalogo = { ...VACIO };
  for (const f of leerCsv('RC_TipoTelas.csv')) {
    const idViejo = (f.IdRC_TipoTelas ?? '').trim();
    const nombre = parsearTexto(f.TipoTela);
    const dias = parsearEntero(f.Dias);
    const factorTela = parsearDinero(f.FactorTela) ?? 0;
    if (nombre === null || dias === null) {
      resultado.omitidos += 1;
      continue;
    }
    if (nombres.has(nombre)) {
      resultado.existentes += 1;
      continue;
    }
    const creado = await intentarCrear(reporte, 'DuracionPorTipoTela', idViejo, () =>
      crearDuracionTela(sesion, { nombre, dias, factorTela }, bd),
    );
    if (creado === null) {
      resultado.omitidos += 1;
      continue;
    }
    nombres.add(nombre);
    resultado.creados += 1;
  }
  return resultado;
}

/** Verifica/crea las duraciones por aplicación (`RC_Aplicaciones`), idempotente por nombre. */
async function verificarAplicaciones(
  sesion: SesionUsuario,
  bd: ContextoBd,
  reporte: Reporte,
): Promise<ResultadoCatalogo> {
  const existentes = await listarDuracionesAplicacion(sesion, true, bd);
  const nombres = new Set(existentes.map((a) => a.nombre.trim()));
  const resultado: ResultadoCatalogo = { ...VACIO };
  for (const f of leerCsv('RC_Aplicaciones.csv')) {
    const idViejo = (f.IdRC_Aplicaciones ?? '').trim();
    const nombre = parsearTexto(f.TipoAplicacion);
    const clave = parsearTexto(f.ClaveAplicacion);
    const dias = parsearEntero(f.Dias);
    if (nombre === null || dias === null) {
      resultado.omitidos += 1;
      continue;
    }
    if (nombres.has(nombre)) {
      resultado.existentes += 1;
      continue;
    }
    const creado = await intentarCrear(reporte, 'DuracionPorAplicacion', idViejo, () =>
      crearDuracionAplicacion(sesion, { nombre, clave: clave ?? undefined, dias }, bd),
    );
    if (creado === null) {
      resultado.omitidos += 1;
      continue;
    }
    nombres.add(nombre);
    resultado.creados += 1;
  }
  return resultado;
}

// ── Procesos + roles responsables N:M (RC_ProcUsua → ProcesoDefRol) ────────────

/**
 * CARGA los roles responsables N:M (`RC_ProcUsua` → `ProcesoDefRol`) y CUADRA procesos/roles. Los 26
 * procesos los siembra E1 (no se re-crean); aquí se INSERTAN las **54 asignaciones VIGENTES** (proceso
 * existe en v2 + tipo casa a un Rol), de forma ADITIVA e idempotente (`sincronizarRolesProcesoMigrado`,
 * skipDuplicates → 0 inserciones en re-corridas). Las **14 HUÉRFANAS** (proceso inexistente en v2) y
 * los `RC_TipoUsuarios` sin Rol equivalente se LISTAN como inconsistencia de origen, NUNCA se crean (§7).
 *
 * Las asignaciones se agrupan por proceso y se cargan en UNA llamada por proceso (lote por proceso,
 * nunca fila por fila).
 */
async function cargarYCuadrarProcesosYRoles(
  sesion: SesionUsuario,
  cliente: PrismaClient,
  bd: ContextoBd,
  reporte: Reporte,
): Promise<{
  procesosFaltantes: number;
  procUsuaVigentes: number;
  procUsuaHuerfanas: number;
  rolesResponsablesInsertados: number;
  tiposUsuarioSinRol: number;
}> {
  // Puente IdCP_Procesos → ProcesoDef v2 (por posición/codigo de E1).
  const { porIdViejo, faltantes } = await construirPuenteProcesos(cliente);
  for (const f of faltantes) {
    reporte.agregar(
      'Proceso del CSV sin ProcesoDef en v2 (re-sembrar E1)',
      `IdCP_Procesos=${f.idViejo} codigoEsperado=${f.codigoEsperado}`,
    );
  }

  // RC_TipoUsuarios → Rol (por nombre). Los que no casan se LISTAN.
  const rolesPorNombre = await cargarRolesPorNombre(cliente);
  const idRolPorTipo = new Map<string, number>();
  let tiposUsuarioSinRol = 0;
  for (const f of leerCsv('RC_TipoUsuarios.csv')) {
    const idTipo = (f.IdRC_TipoUsuarios ?? '').trim();
    const nombre = parsearTexto(f.NombreTipoUsuario);
    if (idTipo === '' || nombre === null) continue;
    const idRol = rolesPorNombre.get(nombre);
    if (idRol === undefined) {
      tiposUsuarioSinRol += 1;
      reporte.agregar(
        'RC_TipoUsuarios sin Rol equivalente en v2 (RBAC único, A4)',
        `IdRC_TipoUsuarios=${idTipo} nombre="${nombre}"`,
      );
    } else {
      idRolPorTipo.set(idTipo, idRol);
    }
  }

  // RC_ProcUsua: separa VIGENTES (proceso existe en v2) de HUÉRFANAS, agrupa las vigentes por proceso.
  let procUsuaVigentes = 0;
  let procUsuaHuerfanas = 0;
  const rolesPorProceso = new Map<number, Set<number>>();
  for (const f of leerCsv('RC_ProcUsua.csv')) {
    const idProcViejo = (f.IdCP_Procesos ?? '').trim();
    const idTipo = (f.IdRC_TipoUsuarios ?? '').trim();
    const v2 = porIdViejo.get(idProcViejo);
    if (v2 === undefined) {
      procUsuaHuerfanas += 1;
      reporte.agregar(
        'RC_ProcUsua HUÉRFANA: apunta a un proceso inexistente en v2 (inconsistencia de origen)',
        `IdRC_ProcUsua=${(f.IdRC_ProcUsua ?? '').trim()} IdCP_Procesos=${idProcViejo} IdRC_TipoUsuarios=${idTipo}`,
      );
      continue;
    }
    procUsuaVigentes += 1;
    const idRol = idRolPorTipo.get(idTipo);
    if (idRol === undefined) {
      // El tipo no casó a un Rol (ya listado arriba): la asignación vigente no se puede materializar.
      reporte.agregar(
        'RC_ProcUsua VIGENTE pero su RC_TipoUsuarios no casa a un Rol (asignación no materializada)',
        `IdRC_ProcUsua=${(f.IdRC_ProcUsua ?? '').trim()} IdCP_Procesos=${idProcViejo} IdRC_TipoUsuarios=${idTipo}`,
      );
      continue;
    }
    const set = rolesPorProceso.get(v2.id) ?? new Set<number>();
    set.add(idRol);
    rolesPorProceso.set(v2.id, set);
  }

  // Inserta las asignaciones VIGENTES por proceso (lote por proceso), aditivo e idempotente (A1).
  let rolesResponsablesInsertados = 0;
  for (const [idProcesoDef, idsRoles] of rolesPorProceso) {
    const insertados = await intentarCrear(reporte, 'ProcesoDefRol', idProcesoDef, () =>
      sincronizarRolesProcesoMigrado(sesion, idProcesoDef, [...idsRoles], bd),
    );
    if (insertados !== null) rolesResponsablesInsertados += insertados;
  }

  return {
    procesosFaltantes: faltantes.length,
    procUsuaVigentes,
    procUsuaHuerfanas,
    rolesResponsablesInsertados,
    tiposUsuarioSinRol,
  };
}

/** Verifica/completa TODOS los catálogos RC y cuadra procesos/roles. */
export async function verificarCatalogos(
  sesion: SesionUsuario,
  cliente: PrismaClient,
  reporte: Reporte,
): Promise<ResultadoCatalogos> {
  const bd: ContextoBd = { cliente };

  const fam = await verificarFamilias(sesion, bd, reporte);
  const art = await verificarArticulos(sesion, bd, reporte, fam.idPorIdViejo);
  const factores = await verificarFactores(sesion, bd, reporte);
  const telas = await verificarTelas(sesion, bd, reporte);
  const aplicaciones = await verificarAplicaciones(sesion, bd, reporte);
  const cuadre = await cargarYCuadrarProcesosYRoles(sesion, cliente, bd, reporte);

  // FactorTela: declarada NO migrada a propósito (ADR-0012/E3). Solo nota informativa.
  reporte.nota(
    'RC_TipoTelas.FactorTela NO se "migra" como comportamiento (ADR-0012/E3): el viejo no lo aplicaba. ' +
      'La columna existe en el esquema y el seed la cargó; el ETL no la corrige.',
  );

  return {
    familias: fam.resultado,
    articulos: art.resultado,
    factores,
    telas,
    aplicaciones,
    idFamiliaPorIdViejo: fam.idPorIdViejo,
    idArticuloPorIdViejo: art.idPorIdViejo,
    procesosFaltantes: cuadre.procesosFaltantes,
    procUsuaVigentes: cuadre.procUsuaVigentes,
    procUsuaHuerfanas: cuadre.procUsuaHuerfanas,
    rolesResponsablesInsertados: cuadre.rolesResponsablesInsertados,
    tiposUsuarioSinRol: cuadre.tiposUsuarioSinRol,
  };
}
