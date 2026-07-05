/**
 * Loader de FICHAS CONFIABLES históricas (F7-E6). `IP_InfConf` (160) → `FichaVerificacion`.
 *
 * El viejo guardaba 8 columnas booleanas fijas por orden (InfGeneral..MedidasPrendas). v2 lo modela
 * por FILAS (reactivo × orden, A6): el ETL DESPIVOTA las 8 columnas contra los 8 `ChecklistFichaDef`
 * sembrados en E4 (la `clave` del reactivo ES el nombre de la columna vieja). Carga VÍA el dominio
 * (A1: `verificarFichaOrden`, que upserta por (idOrden, idReactivo) → idempotente por naturaleza).
 *
 * ⭐ Empresa (A9): `verificarFichaOrden` exige que la orden sea de `sesion.idEmpresaActiva`, así que
 * cada ficha se guarda con una sesión de la EMPRESA de su orden (derivada de la orden migrada de F2).
 *
 * ⭐ Revisor histórico (D11): `verificarFichaOrden` sella `revisorId = sesion.id`. Para PRESERVAR el
 * revisor viejo (`IP_InfConf.IdUsuarios`) —igual que la RC preserva `capturadoPor`— se corre con una
 * sesión cuyo `id` es ese usuario viejo (texto, sin FK — ADR-0005; F10 remapeará usuarios). Si el viejo
 * no trae usuario (0/vacío), cae a la sesión de sistema `etl-sistema`. La `fecha` = `FechaRevision`.
 *
 * `IP_InfConf.Observ` (texto libre) NO se migra: el modelo `FichaVerificacion` no tiene campo de
 * observación (el checklist es por reactivo booleano). Se LISTA una nota; no se pierde en silencio.
 */
import { verificarFichaOrden } from '../../src/dominio/indicadores/fichas.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { cargarMapaNumerico, ENTIDAD_MAPEO, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { sesionEtl } from '../comun/sesion-etl.js';
import { parsearBandera, parsearEntero, parsearFecha } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

/** Carga IP_InfConf → FichaVerificacion (despivotando las 8 columnas contra los 8 reactivos). */
export async function cargarFichas(
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const cli = cliente as PrismaClient;
  const bd: ContextoBd = { cliente: cli };
  const r: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };

  reporte.nota(
    'Fichas confiables: `IP_InfConf.Observ` (texto libre) NO se migra — `FichaVerificacion` no tiene ' +
      'campo de observación (checklist por reactivo booleano). El revisor viejo (IdUsuarios) sí se ' +
      'preserva como `revisorId` (texto sin FK, F10 remapea).',
  );

  // Reactivos activos del checklist (clave = nombre de la columna vieja). Una sola query.
  const reactivos = await cli.checklistFichaDef.findMany({
    where: { activo: true },
    select: { id: true, clave: true },
  });
  if (reactivos.length === 0) {
    reporte.agregar(
      'Fichas: no hay ChecklistFichaDef sembrados (re-sembrar con SEED_ON_START) — flujo OMITIDO',
      'IP_InfConf.csv',
    );
    return r;
  }

  const mapaOrdenV2 = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.orden);
  // idOrden v2 → idEmpresa (para la sesión por-empresa que exige verificarFichaOrden).
  const empresaPorOrden = new Map<number, number>();
  for (const o of await cli.orden.findMany({ select: { id: true, idEmpresa: true } })) {
    empresaPorOrden.set(o.id, o.idEmpresa);
  }
  // Órdenes que YA tienen ficha (idempotencia: no re-procesar).
  const yaConFicha = new Set<number>(
    (
      await cli.fichaVerificacion.findMany({ distinct: ['idOrden'], select: { idOrden: true } })
    ).map((f) => f.idOrden),
  );

  for (const f of leerCsv('IP_InfConf.csv')) {
    const idViejo = (f.IdIP_InfConf ?? '').trim();
    const idOrden = mapaOrdenV2.get((f.IdOrdenes ?? '').trim());
    if (idOrden === undefined) {
      reporte.agregar(
        'IP_InfConf con orden sin mapeo en v2 (OMITIDO)',
        `IdIP_InfConf=${idViejo} IdOrdenes=${f.IdOrdenes ?? ''}`,
      );
      r.omitidos += 1;
      continue;
    }
    const idEmpresa = empresaPorOrden.get(idOrden);
    if (idEmpresa === undefined) {
      reporte.agregar(
        'IP_InfConf con orden inexistente en v2 (OMITIDO)',
        `IdIP_InfConf=${idViejo} idOrden=${idOrden}`,
      );
      r.omitidos += 1;
      continue;
    }
    if (yaConFicha.has(idOrden)) {
      r.existentes += 1;
      continue;
    }

    const items = reactivos
      .filter((rc) => f[rc.clave] !== undefined)
      .map((rc) => ({ idReactivo: rc.id, hecho: parsearBandera(f[rc.clave]) }));
    if (items.length === 0) {
      reporte.agregar(
        'IP_InfConf sin columnas de reactivo reconocibles (OMITIDO)',
        `IdIP_InfConf=${idViejo}`,
      );
      r.omitidos += 1;
      continue;
    }

    // Sesión con el revisor viejo (preserva `revisorId`) + la empresa de la orden (A9).
    const revisorViejo = parsearEntero(f.IdUsuarios);
    const base = sesionEtl(idEmpresa);
    const sesion: SesionUsuario =
      revisorViejo !== null && revisorViejo > 0 ? { ...base, id: String(revisorViejo) } : base;
    const fecha = parsearFecha(f.FechaRevision);
    const fechaIso = fecha === null ? undefined : fecha.toISOString().slice(0, 10);

    const ok = await intentarCrear(reporte, 'FichaVerificacion', idViejo, () =>
      verificarFichaOrden(
        sesion,
        idOrden,
        { items, ...(fechaIso === undefined ? {} : { fecha: fechaIso }) },
        bd,
      ),
    );
    if (ok === null) {
      r.omitidosValidacion = (r.omitidosValidacion ?? 0) + 1;
      continue;
    }
    yaConFicha.add(idOrden);
    r.creados += 1;
  }
  return r;
}
