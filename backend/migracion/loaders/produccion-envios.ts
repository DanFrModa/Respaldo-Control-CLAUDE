/**
 * Loader de ENVÍOS a maquila históricos (F3-E6, Pieza A). UN loader para los dos flujos paralelos
 * (D8), parametrizado por el `TipoProceso`:
 *
 *   COSTURA (M):    `Entregas.csv` (~7,412)    + `OrdenesDetEntM.csv` (~15,220) → tipoProceso=costura
 *   ESTAMPADO (A):  `EntregasEst.csv` (~4,516) + `OrdenesDetEntA.csv` (~7,619)  → tipoProceso=estampado
 *
 * En el viejo "Entregas/EntregasEst" = envío AL maquilero (NO recibo). Carga vía el MODO MIGRACIÓN
 * del dominio (`crearEnvioMigrado`, A1): folio de la secuencia atómica, SIN efectos. Reglas DURAS:
 *  • idOrden: `IdOrdenes` → `Orden.id` (MapeoMigracion de F2). Sin mapeo → envío OMITIDO + listado.
 *  • idMaquilero: `IdMaquileros` → Proveedor (MapeoMigracion de F1: maquileros para costura,
 *    estampadores para estampado). 0/vacío/sin mapeo → idTercero NULL (NO se valida rol).
 *  • precioPactado: `PrecioPactado` ($/pieza) — CONSERVADO tal cual (puede ser NULL).
 *  • fechaCompromiso: `FechaEntregaM` (solo día). `Consecutivo` (N-ésimo envío de la orden) se
 *    PRESERVA en la bitácora vía `claveVieja` (NO es folio: ver migracion.ts).
 *  • color/talla: del despivote del detalle; lo que no resuelve → incidencia.
 *
 * Idempotencia: por el `MapeoMigracion` de su clave (Consecutivo de Entregas/EntregasEst).
 */
import { crearEnvioMigrado } from '../../src/dominio/produccion/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import {
  cargarMapaNumerico,
  ENTIDAD_MAPEO,
  guardarMapeo,
  leerMapeo,
  type ClienteMapeo,
  type EntidadMapeo,
} from '../comun/mapeo.js';
import { conReintentoTransitorio } from '../comun/reintentos.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearDinero, parsearFechaSoloDia, parsearTexto } from '../comun/valores.js';
import type { Reporte } from '../comun/reporte.js';
import type { ResultadoLoader } from './clientes.js';
import {
  cargarMapaColorF1Norm,
  cargarMapaOrdenesDet,
  cargarMapaOrdenV2,
  cargarTallasCrudasPorOrden,
  despivotarDetalle,
  leerCantidadesTC,
  resolverContextoOrden,
  type CacheOrdenes,
  type CeldaDetalle,
  type MapaOrdenesDet,
} from './produccion-comun.js';
import { resolverTipoProceso } from './produccion-tipos.js';

/** Configuración de uno de los dos flujos de envío. */
interface FlujoEnvio {
  /** Etiqueta para incidencias/log ("EnvíoCostura" / "EnvíoEstampado"). */
  etiqueta: string;
  /** Archivo de cabeceras (`Entregas.csv` / `EntregasEst.csv`). */
  archivoCab: string;
  /** Archivo de detalle (`OrdenesDetEntM.csv` / `OrdenesDetEntA.csv`). */
  archivoDet: string;
  /** Nombre de la PK de la cabecera (`IdEntregas` / `IdEntregasEst`). */
  pkCab: string;
  /** FK del detalle a la cabecera (`IdEntregas` / `IdEntregasEst`). */
  fkDet: string;
  /** Entidad de mapeo de la cabecera (idempotencia). */
  entidadMapeo: EntidadMapeo;
  /** Entidad de mapeo del proveedor (maquileros vs estampadores). */
  entidadProveedor: EntidadMapeo;
  /** Código de `TipoProceso` (costura / estampado). */
  codigoProceso: string;
}

const FLUJO_COSTURA: FlujoEnvio = {
  etiqueta: 'EnvíoCostura',
  archivoCab: 'Entregas.csv',
  archivoDet: 'OrdenesDetEntM.csv',
  pkCab: 'IdEntregas',
  fkDet: 'IdEntregas',
  entidadMapeo: ENTIDAD_MAPEO.etapaEnvioCostura,
  entidadProveedor: ENTIDAD_MAPEO.proveedorPorIdMaquileros,
  codigoProceso: 'costura',
};

const FLUJO_ESTAMPADO: FlujoEnvio = {
  etiqueta: 'EnvíoEstampado',
  archivoCab: 'EntregasEst.csv',
  archivoDet: 'OrdenesDetEntA.csv',
  pkCab: 'IdEntregasEst',
  fkDet: 'IdEntregasEst',
  entidadMapeo: ENTIDAD_MAPEO.etapaEnvioEstampado,
  entidadProveedor: ENTIDAD_MAPEO.proveedorPorIdEstampadores,
  codigoProceso: 'estampado',
};

/** Resultado de un flujo de envíos. */
export interface ResultadoEnvios {
  envios: ResultadoLoader;
  /** # de renglones de detalle creados. */
  celdas: number;
}

function resolverTercero(crudo: string | undefined, mapa: Map<string, number>): number | null {
  const t = (crudo ?? '').trim();
  if (t === '' || t === '0') return null;
  return mapa.get(t) ?? null;
}

/** Carga los envíos de COSTURA (Entregas → tipoProceso costura). */
export async function cargarEnviosCostura(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoEnvios> {
  return cargarFlujoEnvio(sesion, cliente, reporte, FLUJO_COSTURA);
}

/** Carga los envíos de ESTAMPADO (EntregasEst → tipoProceso estampado). */
export async function cargarEnviosEstampado(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoEnvios> {
  return cargarFlujoEnvio(sesion, cliente, reporte, FLUJO_ESTAMPADO);
}

async function cargarFlujoEnvio(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  flujo: FlujoEnvio,
): Promise<ResultadoEnvios> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const cli = cliente as PrismaClient;

  const idTipoProceso = await resolverTipoProceso(cli, flujo.codigoProceso);
  if (idTipoProceso === null) {
    reporte.agregar(
      `${flujo.etiqueta}: falta el TipoProceso "${flujo.codigoProceso}" (re-sembrar) — flujo OMITIDO`,
      `archivo=${flujo.archivoCab}`,
    );
    return { envios: { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 }, celdas: 0 };
  }

  const mapaOrdenV2 = await cargarMapaOrdenV2(cliente);
  const mapaProveedor = await cargarMapaNumerico(cliente, flujo.entidadProveedor);
  const mapaColorF1 = await cargarMapaColorF1Norm(cliente);
  const mapaOrdenesDet = cargarMapaOrdenesDet();
  const tallasCrudas = cargarTallasCrudasPorOrden();

  const detPorCab = new Map<string, Record<string, string>[]>();
  for (const f of leerCsv(flujo.archivoDet)) {
    const idCab = (f[flujo.fkDet] ?? '').trim();
    if (idCab === '') continue;
    const lista = detPorCab.get(idCab) ?? [];
    lista.push(f);
    detPorCab.set(idCab, lista);
  }

  const cacheOrdenes: CacheOrdenes = new Map();
  const resultado: ResultadoEnvios = {
    envios: { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 },
    celdas: 0,
  };

  const filas = leerCsv(flujo.archivoCab);
  const contribs = await enLotes(
    filas,
    (f) =>
      conReintentoTransitorio(() =>
        procesarEnvio(sesion, bd, cli, reporte, f, {
          flujo,
          idTipoProceso,
          mapaOrdenV2,
          mapaProveedor,
          mapaColorF1,
          mapaOrdenesDet,
          tallasCrudas,
          detPorCab,
          cacheOrdenes,
        }),
      ),
    CONCURRENCIA_ETL,
  );

  for (const res of contribs) {
    if (!res.ok) {
      resultado.envios.omitidosValidacion = (resultado.envios.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const c = res.valor;
    if (c.estado === 'creado') resultado.envios.creados += 1;
    else if (c.estado === 'existente') resultado.envios.existentes += 1;
    else if (c.estado === 'omitido') resultado.envios.omitidos += 1;
    else resultado.envios.omitidosValidacion = (resultado.envios.omitidosValidacion ?? 0) + 1;
    resultado.celdas += c.celdas;
  }

  return resultado;
}

interface ContextoEnvios {
  flujo: FlujoEnvio;
  idTipoProceso: number;
  mapaOrdenV2: Map<string, number>;
  mapaProveedor: Map<string, number>;
  mapaColorF1: Map<string, number>;
  mapaOrdenesDet: MapaOrdenesDet;
  tallasCrudas: Map<string, string>;
  detPorCab: Map<string, Record<string, string>[]>;
  cacheOrdenes: CacheOrdenes;
}

interface ContribEnvio {
  estado: 'creado' | 'existente' | 'omitido' | 'omitidoValidacion';
  celdas: number;
}

async function procesarEnvio(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: PrismaClient,
  reporte: Reporte,
  f: Record<string, string>,
  ctx: ContextoEnvios,
): Promise<ContribEnvio> {
  const { flujo } = ctx;
  const idCab = (f[flujo.pkCab] ?? '').trim();
  const idOrdenViejo = (f.IdOrdenes ?? '').trim();

  const ya = await leerMapeo(cliente, flujo.entidadMapeo, idCab);
  if (ya !== null) {
    return { estado: 'existente', celdas: 0 };
  }

  const orden = await resolverContextoOrden(
    cliente,
    ctx.cacheOrdenes,
    ctx.mapaOrdenV2,
    ctx.tallasCrudas,
    idOrdenViejo,
  );
  if (orden === null) {
    reporte.agregar(
      `${flujo.etiqueta}: orden sin mapeo/inexistente (OMITIDO)`,
      `${flujo.pkCab}=${idCab} IdOrdenes=${idOrdenViejo}`,
    );
    return { estado: 'omitido', celdas: 0 };
  }

  const dets = ctx.detPorCab.get(idCab) ?? [];
  const celdas: CeldaDetalle[] = [];
  for (const d of dets) {
    const idDet = (d.IdOrdenesDet ?? '').trim();
    const renglon = ctx.mapaOrdenesDet.get(idDet);
    if (renglon === undefined) {
      reporte.agregar(
        `${flujo.etiqueta}: detalle sin renglón OrdenesDet (omitido el renglón)`,
        `${flujo.pkCab}=${idCab} IdOrdenesDet=${idDet}`,
      );
      continue;
    }
    celdas.push(
      ...despivotarDetalle(
        reporte,
        flujo.etiqueta,
        idDet,
        orden,
        renglon,
        leerCantidadesTC(d),
        ctx.mapaColorF1,
      ),
    );
  }

  if (celdas.length === 0) {
    reporte.agregar(
      `${flujo.etiqueta}: sin celdas resolubles (OMITIDO)`,
      `${flujo.pkCab}=${idCab} IdOrdenes=${idOrdenViejo} dets=${String(dets.length)}`,
    );
    return { estado: 'omitido', celdas: 0 };
  }

  const fecha = parsearFechaSoloDia(f.Fecha);
  if (fecha === null) {
    reporte.agregar(
      `${flujo.etiqueta}: sin fecha parseable (OMITIDO)`,
      `${flujo.pkCab}=${idCab} Fecha="${f.Fecha ?? ''}"`,
    );
    return { estado: 'omitido', celdas: 0 };
  }

  const consecutivo = (f.Consecutivo ?? '').trim();
  const creado = await intentarCrear(reporte, flujo.etiqueta, idCab, () =>
    crearEnvioMigrado(
      sesion,
      {
        idEmpresa: orden.idEmpresa,
        idOrden: orden.idOrden,
        idTipoProceso: ctx.idTipoProceso,
        claveVieja: `${flujo.pkCab}=${idCab} Consecutivo=${consecutivo}`,
        idTercero: resolverTercero(f.IdMaquileros, ctx.mapaProveedor),
        fecha,
        fechaCompromiso: parsearFechaSoloDia(f.FechaEntregaM),
        precioPactado: parsearDinero(f.PrecioPactado),
        observaciones: parsearTexto(f.Observaciones),
        celdas,
      },
      bd,
    ),
  );
  if (creado === null) {
    return { estado: 'omitidoValidacion', celdas: 0 };
  }
  await guardarMapeo(cliente, flujo.entidadMapeo, idCab, creado.idEtapa);
  return { estado: 'creado', celdas: creado.celdas };
}
