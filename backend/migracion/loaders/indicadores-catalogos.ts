/**
 * Loaders de CATÁLOGOS del módulo Indicadores (F7-E6): personal y actividades de productividad.
 * Catálogos GLOBALES (ADR-0007), así que la empresa de la sesión es indistinta. Carga VÍA el dominio
 * (A1: `crearPersonal`/`crearActividad`), idempotente por `MapeoMigracion` (la 2ª corrida no re-crea).
 * Secuencial (pocas filas: 7 personas + 25 actividades IP + 11 actividades almacén) y con `@@unique
 * (area, nombre)`: los homónimos del viejo se OMITEN y se LISTAN (no se fusionan a ciegas).
 *
 *   IP_Personal (7)     → PersonalArea            (area = ip; `activo` respetado)
 *   IP_Actividades (25) → ActividadProductividad  (area = ip;  porcentajeD)
 *   Alm_Prd_Act (11)    → ActividadProductividad  (area = almacen; pzPersDia + porcenPzas)
 */
import {
  actualizarPersonal,
  crearActividad,
  crearPersonal,
} from '../../src/dominio/indicadores/productividad.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { ENTIDAD_MAPEO, guardarMapeo, leerMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearBandera, parsearDinero, parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

/** Jornada base válida para el índice de IP (Zod: > 0 y ≤ 24). Fuera de rango → se omite el dato. */
function horasBaseValida(h: number | null): number | undefined {
  return h !== null && h > 0 && h <= 24 ? h : undefined;
}

/**
 * Carga IP_Personal → PersonalArea (área ip). ⭐ Crea SIEMPRE ACTIVO (aunque el viejo lo tuviera
 * inactivo): las personas 4/5 están inactivas PERO tienen registros de productividad, y
 * `registrarProductividad` rechaza a una persona desactivada. Por eso la baja suave de los inactivos
 * se aplica DESPUÉS (ver {@link desactivarPersonalInactivoIp}), una vez cargada la productividad.
 */
export async function cargarPersonalIp(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const r: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };

  for (const f of leerCsv('IP_Personal.csv')) {
    const idViejo = (f.IdIP_Personal ?? '').trim();
    const nombre = parsearTexto(f.NombreIP);
    if (idViejo === '' || nombre === null) {
      reporte.agregar('IP_Personal sin id/nombre (OMITIDO)', JSON.stringify(f).slice(0, 120));
      r.omitidos += 1;
      continue;
    }
    if ((await leerMapeo(cliente, ENTIDAD_MAPEO.personalIp, idViejo)) !== null) {
      r.existentes += 1;
      continue;
    }
    const horasBase = horasBaseValida(parsearDinero(f.HorasBase));
    const puesto = parsearTexto(f.Puesto) ?? undefined;

    const creado = await intentarCrear(reporte, 'PersonalArea', idViejo, () =>
      crearPersonal(sesion, { nombre, area: 'ip', horasBase, puesto }, bd),
    );
    if (creado === null) {
      r.omitidosValidacion = (r.omitidosValidacion ?? 0) + 1;
      continue;
    }
    await guardarMapeo(cliente, ENTIDAD_MAPEO.personalIp, idViejo, creado.id);
    r.creados += 1;
  }
  return r;
}

/**
 * Aplica la baja suave (Activo=0) a las personas de IP que el viejo tenía INACTIVAS. Corre DESPUÉS de
 * cargar la productividad (ver {@link cargarPersonalIp}): así los registros de una persona inactiva no
 * se rechazan al cargarse. Idempotente (re-desactivar es no-op). Devuelve cuántas desactivó.
 */
export async function desactivarPersonalInactivoIp(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<number> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  let desactivadas = 0;
  for (const f of leerCsv('IP_Personal.csv')) {
    const idViejo = (f.IdIP_Personal ?? '').trim();
    if (idViejo === '' || parsearBandera(f.Activo)) continue; // solo los que el viejo tenía inactivos
    const idNuevo = await leerMapeo(cliente, ENTIDAD_MAPEO.personalIp, idViejo);
    if (idNuevo === null) continue; // no se cargó (homónimo omitido): nada que desactivar
    const ok = await intentarCrear(reporte, 'PersonalArea (desactivar)', idViejo, () =>
      actualizarPersonal(sesion, { id: Number(idNuevo), activo: false }, bd),
    );
    if (ok !== null) desactivadas += 1;
  }
  return desactivadas;
}

/** Carga IP_Actividades → ActividadProductividad (área ip; porcentajeD). */
export async function cargarActividadesIp(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const r: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };

  for (const f of leerCsv('IP_Actividades.csv')) {
    const idViejo = (f.IdIP_Actividades ?? '').trim();
    const nombre = parsearTexto(f.Actividad);
    if (idViejo === '' || nombre === null) {
      reporte.agregar('IP_Actividades sin id/nombre (OMITIDO)', JSON.stringify(f).slice(0, 120));
      r.omitidos += 1;
      continue;
    }
    if ((await leerMapeo(cliente, ENTIDAD_MAPEO.actividadIp, idViejo)) !== null) {
      r.existentes += 1;
      continue;
    }
    const porcentajeD = parsearDinero(f.PorcentajeD) ?? undefined;
    const creada = await intentarCrear(reporte, 'ActividadProductividad (ip)', idViejo, () =>
      crearActividad(sesion, { nombre, area: 'ip', porcentajeD }, bd),
    );
    if (creada === null) {
      r.omitidosValidacion = (r.omitidosValidacion ?? 0) + 1;
      continue;
    }
    await guardarMapeo(cliente, ENTIDAD_MAPEO.actividadIp, idViejo, creada.id);
    r.creados += 1;
  }
  return r;
}

/** Carga Alm_Prd_Act → ActividadProductividad (área almacén; pzPersDia > 0 + porcenPzas). */
export async function cargarActividadesAlmacen(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const r: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };

  for (const f of leerCsv('Alm_Prd_Act.csv')) {
    const idViejo = (f.IdAlm_Prd_Act ?? '').trim();
    const nombre = parsearTexto(f.ActividadAlm);
    if (idViejo === '' || nombre === null) {
      reporte.agregar('Alm_Prd_Act sin id/nombre (OMITIDO)', JSON.stringify(f).slice(0, 120));
      r.omitidos += 1;
      continue;
    }
    if ((await leerMapeo(cliente, ENTIDAD_MAPEO.actividadAlmacen, idViejo)) !== null) {
      r.existentes += 1;
      continue;
    }
    const pzPersDia = parsearDinero(f.Pz_Pers_Dia) ?? undefined;
    const porcenPzas = parsearDinero(f.PorcenPzas) ?? undefined;
    if (pzPersDia === undefined || pzPersDia <= 0) {
      // El almacén EXIGE pzPersDia > 0 (es el divisor del índice): sin él, la actividad no sirve.
      reporte.agregar(
        'Alm_Prd_Act sin Pz_Pers_Dia > 0 (OMITIDA — es el divisor del índice)',
        `IdAlm_Prd_Act=${idViejo} Pz_Pers_Dia="${f.Pz_Pers_Dia ?? ''}"`,
      );
      r.omitidos += 1;
      continue;
    }
    const creada = await intentarCrear(reporte, 'ActividadProductividad (almacen)', idViejo, () =>
      crearActividad(sesion, { nombre, area: 'almacen', pzPersDia, porcenPzas }, bd),
    );
    if (creada === null) {
      r.omitidosValidacion = (r.omitidosValidacion ?? 0) + 1;
      continue;
    }
    await guardarMapeo(cliente, ENTIDAD_MAPEO.actividadAlmacen, idViejo, creada.id);
    r.creados += 1;
  }
  return r;
}
