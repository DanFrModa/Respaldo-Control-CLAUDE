/**
 * Loaders de PRODUCTIVIDAD histórica (F7-E6) — el motor unificado IP/Almacén (área la fija la
 * actividad). Carga VÍA el dominio (A1: `registrarProductividad`), idempotente por `MapeoMigracion`,
 * por LOTES (`enLotes`). La empresa la fija la sesión (A9: el viejo no llevaba empresa en estos
 * módulos → toda la productividad va a la empresa de la sesión, la favorita).
 *
 *   IP_Productiv (1,870)                → RegistroProductividad (área ip; 1 registro por fila)
 *   Alm_Prd (195) × Alm_Prd_Det (910)   → RegistroProductividad (área almacén; 1 registro por DETALLE,
 *                                          aplanando el encabezado-día: fecha/personas/horas)
 *
 * ⭐ VENTANA TEMPORAL (§Post-F9.24, agregada el 11-ago-2026). Ninguno de los dos depende de la
 * orden, así que sin recorte propio ignoraban `ETL_DESDE` y cargaban los 16 años completos aunque la
 * migración lleve solo 2025-2026: los KPI de productividad arrancarían con historia que se decidió
 * NO traer. IP recorta por `IP_Productiv.Fecha`; almacén por la fecha del encabezado-día
 * (`Alm_Prd.FechaAlm`), y sus detalles se van con su encabezado. Lo excluido se cuenta y se REPORTA.
 *
 * Nota de idempotencia (patrón de los ETL previos): `registrarProductividad` no tiene clave natural,
 * así que la idempotencia la da el `MapeoMigracion` (se escribe TRAS crear). Un corte entre el create
 * y el mapeo podría, en una 2ª corrida, duplicar esa única fila (ventana de un round-trip) — mismo
 * trade-off asumido por los loaders de EsMa/Calidad.
 */
import { registrarProductividad } from '../../src/dominio/indicadores/productividad.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import {
  cargarMapaNumerico,
  ENTIDAD_MAPEO,
  guardarMapeo,
  type ClienteMapeo,
} from '../comun/mapeo.js';
import { conReintentoTransitorio } from '../comun/reintentos.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearDinero, parsearEntero, parsearFecha } from '../comun/valores.js';
import { filtrarPorVentana, resolverVentana } from '../comun/ventana.js';
import type { ResultadoLoader } from './clientes.js';

type EstadoContrib = 'creado' | 'existente' | 'omitido' | 'omitidoValidacion' | 'fueraVentana';

/** `YYYY-MM-DD` (UTC) de una fecha parseada, o `null` si no había. */
function aIso(fecha: Date | null): string | null {
  return fecha === null ? null : fecha.toISOString().slice(0, 10);
}

/** Reduce las contribuciones por-fila a un `ResultadoLoader`. */
function reducir(
  contribs: { ok: boolean; valor?: EstadoContrib }[],
  fueraVentana = 0,
): ResultadoLoader {
  const r: ResultadoLoader = {
    creados: 0,
    existentes: 0,
    omitidos: 0,
    omitidosValidacion: 0,
    fueraVentana,
  };
  for (const res of contribs) {
    if (!res.ok) {
      r.omitidosValidacion = (r.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const e = res.valor as EstadoContrib;
    if (e === 'creado') r.creados += 1;
    else if (e === 'existente') r.existentes += 1;
    else if (e === 'omitido') r.omitidos += 1;
    else if (e === 'fueraVentana') r.fueraVentana = (r.fueraVentana ?? 0) + 1;
    else r.omitidosValidacion = (r.omitidosValidacion ?? 0) + 1;
  }
  return r;
}

// ── Productividad IP ───────────────────────────────────────────────────────────────────────────

interface ContextoIp {
  sesion: SesionUsuario;
  cliente: ClienteMapeo;
  bd: ContextoBd;
  reporte: Reporte;
  mapaPersona: Map<string, number>;
  mapaActividad: Map<string, number>;
  yaMigrados: Set<string>;
}

async function procesarProdIp(ctx: ContextoIp, f: Record<string, string>): Promise<EstadoContrib> {
  const idViejo = (f.IdIP_Productiv ?? '').trim();
  if (idViejo === '') {
    ctx.reporte.agregar('IP_Productiv sin id (OMITIDO)', JSON.stringify(f).slice(0, 120));
    return 'omitido';
  }
  if (ctx.yaMigrados.has(idViejo)) return 'existente';

  const idPersona = ctx.mapaPersona.get((f.IdIp_Personal ?? '').trim());
  const idActividad = ctx.mapaActividad.get((f.IdIp_Actividades ?? '').trim());
  if (idPersona === undefined || idActividad === undefined) {
    ctx.reporte.agregar(
      'IP_Productiv con persona/actividad sin mapeo (OMITIDO)',
      `IdIP_Productiv=${idViejo} IdIp_Personal=${f.IdIp_Personal ?? ''} IdIp_Actividades=${f.IdIp_Actividades ?? ''}`,
    );
    return 'omitido';
  }
  const fecha = aIso(parsearFecha(f.Fecha));
  const cantidad = parsearDinero(f.CantidadAct);
  const horasTrabajadas = parsearDinero(f.HorasTrabajadas);
  if (fecha === null || cantidad === null || horasTrabajadas === null) {
    ctx.reporte.agregar(
      'IP_Productiv con fecha/cantidad/horas faltante (OMITIDO)',
      `IdIP_Productiv=${idViejo} Fecha="${f.Fecha ?? ''}" CantidadAct="${f.CantidadAct ?? ''}" HorasTrabajadas="${f.HorasTrabajadas ?? ''}"`,
    );
    return 'omitido';
  }

  const creado = await intentarCrear(ctx.reporte, 'RegistroProductividad (ip)', idViejo, () =>
    registrarProductividad(
      ctx.sesion,
      { fecha, idActividad, idPersona, cantidad, horasTrabajadas, personas: 1 },
      ctx.bd,
    ),
  );
  if (creado === null) return 'omitidoValidacion';
  await guardarMapeo(ctx.cliente, ENTIDAD_MAPEO.productividadIp, idViejo, creado.id);
  ctx.yaMigrados.add(idViejo);
  return 'creado';
}

/** Carga IP_Productiv → RegistroProductividad (área ip). */
export async function cargarProductividadIp(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const ctx: ContextoIp = {
    sesion,
    cliente,
    bd: { cliente: cliente as PrismaClient },
    reporte,
    mapaPersona: await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.personalIp),
    mapaActividad: await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.actividadIp),
    yaMigrados: new Set((await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.productividadIp)).keys()),
  };
  // §Post-F9.24: recorte por la fecha del registro, ANTES de procesar. Lo excluido sale listado.
  const { dentro, fuera } = filtrarPorVentana(
    leerCsv('IP_Productiv.csv'),
    'Fecha',
    resolverVentana(),
    reporte,
    'Productividad IP (IP_Productiv)',
    (f) => `IdIP_Productiv=${f.IdIP_Productiv ?? '?'}`,
  );
  const contribs = await enLotes(
    dentro,
    (f) => conReintentoTransitorio(() => procesarProdIp(ctx, f)),
    CONCURRENCIA_ETL,
  );
  return reducir(
    contribs.map((c) => (c.ok ? { ok: true, valor: c.valor } : { ok: false })),
    fuera,
  );
}

// ── Productividad Almacén ────────────────────────────────────────────────────────────────────────

/** Encabezado-día del almacén (`Alm_Prd`): fecha + cuadrilla + horas, por `IdAlm_Prd`. */
interface CabeceraAlm {
  fecha: string | null;
  personas: number | null;
  horasTrabajadas: number | null;
}

interface ContextoAlm {
  sesion: SesionUsuario;
  cliente: ClienteMapeo;
  bd: ContextoBd;
  reporte: Reporte;
  cabeceras: Map<string, CabeceraAlm>;
  /** Encabezados-día que la ventana dejó fuera (ya reportados UNA vez, al filtrar). */
  idsCabFueraVentana: Set<string>;
  mapaActividad: Map<string, number>;
  mapaCliente: Map<string, number>;
  yaMigrados: Set<string>;
}

async function procesarProdAlm(
  ctx: ContextoAlm,
  f: Record<string, string>,
): Promise<EstadoContrib> {
  const idViejo = (f.IdAlm_Prd_Det ?? '').trim();
  if (idViejo === '') {
    ctx.reporte.agregar('Alm_Prd_Det sin id (OMITIDO)', JSON.stringify(f).slice(0, 120));
    return 'omitido';
  }
  if (ctx.yaMigrados.has(idViejo)) return 'existente';

  const idCab = (f.IdAlm_Prd ?? '').trim();
  const cab = ctx.cabeceras.get(idCab);
  if (cab === undefined) {
    // Su encabezado-día quedó FUERA de la ventana: no es dato roto, es el recorte (ya listado).
    if (ctx.idsCabFueraVentana.has(idCab)) return 'fueraVentana';
    ctx.reporte.agregar(
      'Alm_Prd_Det sin encabezado Alm_Prd (OMITIDO)',
      `IdAlm_Prd_Det=${idViejo} IdAlm_Prd=${f.IdAlm_Prd ?? ''}`,
    );
    return 'omitido';
  }
  const idActividad = ctx.mapaActividad.get((f.IdAlm_Prd_Act ?? '').trim());
  if (idActividad === undefined) {
    ctx.reporte.agregar(
      'Alm_Prd_Det con actividad sin mapeo (OMITIDO)',
      `IdAlm_Prd_Det=${idViejo} IdAlm_Prd_Act=${f.IdAlm_Prd_Act ?? ''}`,
    );
    return 'omitido';
  }
  const cantidad = parsearDinero(f.Piezas);
  if (
    cab.fecha === null ||
    cab.personas === null ||
    cab.horasTrabajadas === null ||
    cantidad === null
  ) {
    ctx.reporte.agregar(
      'Alm_Prd_Det/Alm_Prd con fecha/personas/horas/piezas faltante (OMITIDO)',
      `IdAlm_Prd_Det=${idViejo} IdAlm_Prd=${f.IdAlm_Prd ?? ''} Piezas="${f.Piezas ?? ''}"`,
    );
    return 'omitido';
  }
  // Cliente atendido (opcional): sin mapeo → sin cliente (no bloquea el registro de almacén).
  const idCliente = ctx.mapaCliente.get((f.IdClientes ?? '').trim());

  const creado = await intentarCrear(ctx.reporte, 'RegistroProductividad (almacen)', idViejo, () =>
    registrarProductividad(
      ctx.sesion,
      {
        fecha: cab.fecha as string,
        idActividad,
        cantidad,
        horasTrabajadas: cab.horasTrabajadas as number,
        personas: cab.personas as number,
        ...(idCliente === undefined ? {} : { idCliente }),
      },
      ctx.bd,
    ),
  );
  if (creado === null) return 'omitidoValidacion';
  await guardarMapeo(ctx.cliente, ENTIDAD_MAPEO.productividadAlmacen, idViejo, creado.id);
  ctx.yaMigrados.add(idViejo);
  return 'creado';
}

/** Carga Alm_Prd × Alm_Prd_Det → RegistroProductividad (área almacén). */
export async function cargarProductividadAlmacen(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  // §Post-F9.24: el recorte va en el ENCABEZADO-DÍA (`Alm_Prd.FechaAlm` es la fecha; el detalle no
  // trae fecha propia). Los detalles de un encabezado excluido se cuentan como `fueraVentana`, NO
  // como "sin encabezado" (que es un diagnóstico distinto: dato roto).
  const todasLasCabeceras = leerCsv('Alm_Prd.csv');
  const { dentro: cabsDentro, fuera: cabsFuera } = filtrarPorVentana(
    todasLasCabeceras,
    'FechaAlm',
    resolverVentana(),
    reporte,
    'Productividad Almacén (Alm_Prd, encabezado-día)',
    (f) => `IdAlm_Prd=${f.IdAlm_Prd ?? '?'}`,
  );
  const idsCabFueraVentana = new Set<string>();
  if (cabsFuera > 0) {
    const vivas = new Set(cabsDentro.map((f) => (f.IdAlm_Prd ?? '').trim()));
    for (const f of todasLasCabeceras) {
      const id = (f.IdAlm_Prd ?? '').trim();
      if (id !== '' && !vivas.has(id)) idsCabFueraVentana.add(id);
    }
  }

  const cabeceras = new Map<string, CabeceraAlm>();
  for (const f of cabsDentro) {
    const id = (f.IdAlm_Prd ?? '').trim();
    if (id === '') continue;
    cabeceras.set(id, {
      fecha: aIso(parsearFecha(f.FechaAlm)),
      personas: parsearEntero(f.Personas),
      horasTrabajadas: parsearDinero(f.HorasTrabajadas),
    });
  }

  const ctx: ContextoAlm = {
    sesion,
    cliente,
    bd: { cliente: cliente as PrismaClient },
    reporte,
    cabeceras,
    idsCabFueraVentana,
    mapaActividad: await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.actividadAlmacen),
    mapaCliente: await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.cliente),
    yaMigrados: new Set(
      (await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.productividadAlmacen)).keys(),
    ),
  };
  const contribs = await enLotes(
    leerCsv('Alm_Prd_Det.csv'),
    (f) => conReintentoTransitorio(() => procesarProdAlm(ctx, f)),
    CONCURRENCIA_ETL,
  );
  return reducir(contribs.map((c) => (c.ok ? { ok: true, valor: c.valor } : { ok: false })));
}
