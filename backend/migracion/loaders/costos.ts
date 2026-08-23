/**
 * Loader de COSTOS históricos (F7-E6). `CostoOrd.csv` (2,513) → `CostoOrden` (uno por orden).
 *
 * Carga VÍA el servicio de dominio `guardarCostoOrden` (A1): el mismo que usa la captura, así el
 * `costoTotal` lo ARMA el dominio (Σ de los componentes guardados) y se congela el teórico en vivo.
 *
 * MAPEO de componentes (⭐ DECISIÓN D2 — la REGALÍA sale del costo, 2026-07-02):
 *   telaCost     ← TelaCost
 *   aviosCost    ← HabCost                       (habilitación de costura + empaque)
 *   procesosCost ← MaquilaCost + BordCost        (maquila + bordado; el schema lo dice: "ex MaquilaCost+BordCost")
 *   otros/descOtros ← Otros / DescOtros
 *   RegaliasCost → **NO se migra como componente** (D2: la regalía va sobre la VENTA, no en el costo).
 *   `costoTotal` v2 = tela + procesos + avíos + otros (lo suma el dominio) → EXCLUYE la regalía.
 *
 * Hallazgo empírico (verificado sobre el CSV, ver `cuadre-f7.ts`): el `Costo` viejo INCLUÍA la
 * regalía (`Costo == TelaCost+HabCost+BordCost+MaquilaCost+RegaliasCost+Otros` en las filas con
 * regalía ≠ 0). Por eso el `costoTotal` v2 será menor por Σ RegaliasCost: es un DELTA ESPERADO por
 * diseño (D2), documentado en el cuadre, NUNCA corregido en silencio (§7). El `Costo` viejo se
 * preserva en el mapeo (`datos.costoViejo`) y en el cuadre para trazabilidad.
 *
 * Empresa (A9): el dominio acota por `sesion.idEmpresaActiva`, así que cada orden se costea con una
 * sesión de la EMPRESA de esa orden (derivada de la orden migrada de F2). Órdenes `noCostear` → el
 * dominio las rechaza: se LISTAN y OMITEN (no se fuerza). Órdenes sin mapeo → LISTADAS y OMITIDAS.
 *
 * Idempotencia: se salta las órdenes que ya tienen `CostoOrden` (una 2ª corrida no re-costea).
 */
import { guardarCostoOrden } from '../../src/dominio/costos/costo-orden.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import { ENTIDAD_MAPEO, guardarMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import { conReintentoTransitorio } from '../comun/reintentos.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear, truncarYReportar } from '../comun/saneo.js';
import { sesionEtl } from '../comun/sesion-etl.js';
import { parsearDinero, parsearTexto } from '../comun/valores.js';
import { cargarMapaOrdenV2 } from './produccion-comun.js';
import type { ResultadoLoader } from './clientes.js';

/** Tope de longitud de los textos libres del costo (calcado de `esquemas/costos.ts`). */
const MAX_DESC_OTROS = 200;
const MAX_OBSERVACIONES = 500;

/** Datos de una orden migrada que el loader necesita (empresa + bandera noCostear). */
interface OrdenCosteable {
  idEmpresa: number;
  noCostear: boolean;
}

/** Carga `idOrdenV2 → { idEmpresa, noCostear }` de una sola query (para resolver empresa y el gate). */
async function cargarOrdenesCosteables(
  cliente: ClienteMapeo,
): Promise<Map<number, OrdenCosteable>> {
  const filas = await cliente.orden.findMany({
    select: { id: true, idEmpresa: true, noCostear: true },
  });
  const mapa = new Map<number, OrdenCosteable>();
  for (const f of filas) mapa.set(f.id, { idEmpresa: f.idEmpresa, noCostear: f.noCostear });
  return mapa;
}

type EstadoContrib = 'creado' | 'existente' | 'omitido' | 'omitidoValidacion';

interface ContextoCostos {
  cliente: PrismaClient;
  bd: ContextoBd;
  reporte: Reporte;
  mapaOrdenV2: Map<string, number>;
  ordenes: Map<number, OrdenCosteable>;
  yaCosteadas: Set<number>;
}

/** Migra UNA fila `CostoOrd` → `CostoOrden` (idempotente, tolerante). */
async function procesarCosto(
  ctx: ContextoCostos,
  f: Record<string, string>,
): Promise<EstadoContrib> {
  const idCostoViejo = (f.IdCostoOrd ?? '').trim();
  const idOrdenViejo = (f.IdOrdenes ?? '').trim();

  const idOrden = ctx.mapaOrdenV2.get(idOrdenViejo);
  if (idOrden === undefined) {
    ctx.reporte.agregar(
      'CostoOrd con orden sin mapeo en v2 (OMITIDO)',
      `IdCostoOrd=${idCostoViejo} IdOrdenes=${idOrdenViejo}`,
    );
    return 'omitido';
  }

  const orden = ctx.ordenes.get(idOrden);
  if (orden === undefined) {
    ctx.reporte.agregar(
      'CostoOrd con orden inexistente en v2 (OMITIDO)',
      `IdCostoOrd=${idCostoViejo} IdOrdenes=${idOrdenViejo}`,
    );
    return 'omitido';
  }
  if (orden.noCostear) {
    ctx.reporte.agregar(
      'CostoOrd de una orden "no costear" (OMITIDO — el dominio la rechaza)',
      `IdCostoOrd=${idCostoViejo} idOrden=${idOrden}`,
    );
    return 'omitido';
  }
  if (ctx.yaCosteadas.has(idOrden)) {
    return 'existente';
  }

  // Componentes (D2): la regalía NO entra. procesos = maquila + bordado; avíos = habilitación.
  const telaCost = parsearDinero(f.TelaCost) ?? 0;
  const aviosCost = parsearDinero(f.HabCost) ?? 0;
  const procesosCost = (parsearDinero(f.MaquilaCost) ?? 0) + (parsearDinero(f.BordCost) ?? 0);
  const otros = parsearDinero(f.Otros) ?? 0;
  const descOtros = truncarYReportar(
    ctx.reporte,
    'CostoOrden',
    idCostoViejo,
    'descOtros',
    parsearTexto(f.DescOtros),
    MAX_DESC_OTROS,
  );
  const observaciones = truncarYReportar(
    ctx.reporte,
    'CostoOrden',
    idCostoViejo,
    'observaciones',
    parsearTexto(f.Observaciones),
    MAX_OBSERVACIONES,
  );

  // Sesión de la EMPRESA de la orden (A9 — el dominio acota por idEmpresaActiva).
  const sesion = sesionEtl(orden.idEmpresa);
  const guardado = await intentarCrear(ctx.reporte, 'CostoOrden', idCostoViejo, () =>
    guardarCostoOrden(
      sesion,
      idOrden,
      { telaCost, aviosCost, procesosCost, otros, descOtros, observaciones },
      ctx.bd,
      // El CSV viejo trae los TRES componentes explícitos: el REAL de compras no se usaría para
      // ningún default, y calcularlo por cada una de las ~2,500 filas solo serviría para congelar
      // un número de HOY en una orden de los 90. `telaReal`/`aviosReal` quedan NULL a propósito.
      { calcularReal: false },
    ),
  );
  if (guardado === null) {
    return 'omitidoValidacion';
  }
  ctx.yaCosteadas.add(idOrden);

  // Traza: IdCostoOrd → idOrden + el `Costo` viejo (con regalía) para el cuadre.
  const costoViejo = parsearDinero(f.Costo);
  await guardarMapeo(ctx.cliente, ENTIDAD_MAPEO.costoOrden, idCostoViejo, idOrden, {
    costoViejo: costoViejo ?? 0,
    regaliasCost: parsearDinero(f.RegaliasCost) ?? 0,
  });
  return 'creado';
}

/**
 * Carga TODO el histórico de costos (`CostoOrd` → `CostoOrden`), por LOTES, idempotente y tolerante.
 * Devuelve el resumen estándar (creados/existentes/omitidos/omitidosValidacion).
 */
export async function cargarCostos(
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const cli = cliente as PrismaClient;
  const bd: ContextoBd = { cliente: cli };

  reporte.nota(
    'Costos (D2): la REGALÍA (RegaliasCost) NO se migra como componente del costo (va sobre la ' +
      'venta). El `Costo` viejo INCLUÍA la regalía → el costoTotal v2 es menor por Σ RegaliasCost ' +
      '(delta ESPERADO por diseño, ver cuadre-f7).',
  );

  const mapaOrdenV2 = await cargarMapaOrdenV2(cliente);
  const ordenes = await cargarOrdenesCosteables(cliente);
  const yaCosteadas = new Set<number>(
    (await cli.costoOrden.findMany({ select: { idOrden: true } })).map((c) => c.idOrden),
  );

  const ctx: ContextoCostos = { cliente: cli, bd, reporte, mapaOrdenV2, ordenes, yaCosteadas };

  const resultado: ResultadoLoader = {
    creados: 0,
    existentes: 0,
    omitidos: 0,
    omitidosValidacion: 0,
  };
  const filas = leerCsv('CostoOrd.csv');
  const contribs = await enLotes(
    filas,
    (f) => conReintentoTransitorio(() => procesarCosto(ctx, f)),
    CONCURRENCIA_ETL,
  );
  for (const res of contribs) {
    if (!res.ok) {
      resultado.omitidosValidacion = (resultado.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const e = res.valor;
    if (e === 'creado') resultado.creados += 1;
    else if (e === 'existente') resultado.existentes += 1;
    else if (e === 'omitido') resultado.omitidos += 1;
    else resultado.omitidosValidacion = (resultado.omitidosValidacion ?? 0) + 1;
  }
  return resultado;
}
