/**
 * Loader de RECIBOS de maquila históricos (F3-E6, Pieza A). ⭐ VARIANTE SIN EFECTOS DERIVADOS.
 *
 *   COSTURA (M):    `Recibos.csv` (~12,440)   + `OrdenesDetRecM.csv` (~14,254) → tipoProceso=costura
 *   ESTAMPADO (A):  `RecibosEst.csv` (~4,059) + `OrdenesDetRecA.csv` (~5,475)  → tipoProceso=estampado
 *
 * Crea SOLO el `EtapaMovimiento(tipo=recibo_maquila)` + detalle. Excepción JUSTIFICADA a PLANMAESTRO
 * §7 (DECISIONES.md F3-E6): NO genera entrada al kardex PT NI crea `EsMaCargo`. Razón de
 * no-doble-conteo: el kardex histórico se migra ÚNICAMENTE de `IPT_Movs` (Pieza B) y los cargos
 * ÚNICAMENTE de `EsMa_Recibos` (loader `esma-cargos`). Si los recibos pasaran por el servicio
 * completo, las 2,468 entradas tipo 2 del viejo se DUPLICARÍAN. (La liga `IPT_Movs.IdRecibos` la
 * conserva la Pieza B como referencia, no este loader.)
 *
 * CALIDAD: el viejo NO desglosa primeras/segundas en los recibos (sus detalles solo traen TC1..TC8).
 * Se migra todo como PRIMERA (cantidadPrimeras = cantidad, cantidadSegundas = 0) — la representación
 * fiel de "sin desglose" (igual que el default del servicio normal). El almacén destino NO se setea
 * (nace en v2); la calidad va SEPARADA del almacén (decisión Gabriel F3-E4).
 *
 * Reglas de limpieza (NO se arreglan en silencio — se LISTAN para Daniel):
 *  • `TipoPrendas` vacío (~1,408 en costura): el campo viejo era una NOTA libre; en v2 no tiene
 *    columna propia (el detalle es color×talla real). Se PRESERVA en `observaciones` si trae texto;
 *    si está vacío se LISTA y el recibo igual entra (su matriz no depende de TipoPrendas).
 *  • `Cantidad` vacía (~158): la cabecera vieja traía un total; v2 lo DERIVA por suma del detalle.
 *    Se LISTA; si el detalle resuelve celdas, el recibo entra (el total real es la suma).
 *  • `Inventariado` 0/vacío (~1,928, solo costura): NO afecta — esta variante NUNCA genera entrada a
 *    PT (el saldo sale de IPT_Movs, Pieza B). Se ignora la bandera; se LISTA el conteo informativo.
 *
 * Idempotencia: por el `MapeoMigracion` de `IdRecibos`/`IdRecibosEst`.
 */
import { crearReciboMigrado } from '../../src/dominio/produccion/migracion.js';
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
import { parsearFechaSoloDia, parsearTexto } from '../comun/valores.js';
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

/** Configuración de uno de los dos flujos de recibo. */
interface FlujoRecibo {
  etiqueta: string;
  archivoCab: string;
  archivoDet: string;
  pkCab: string;
  fkDet: string;
  entidadMapeo: EntidadMapeo;
  entidadProveedor: EntidadMapeo;
  codigoProceso: string;
  /** ¿La cabecera trae la columna `Inventariado`? (solo costura). */
  tieneInventariado: boolean;
}

const FLUJO_COSTURA: FlujoRecibo = {
  etiqueta: 'ReciboCostura',
  archivoCab: 'Recibos.csv',
  archivoDet: 'OrdenesDetRecM.csv',
  pkCab: 'IdRecibos',
  fkDet: 'IdRecibos',
  entidadMapeo: ENTIDAD_MAPEO.etapaReciboCostura,
  entidadProveedor: ENTIDAD_MAPEO.proveedorPorIdMaquileros,
  codigoProceso: 'costura',
  tieneInventariado: true,
};

const FLUJO_ESTAMPADO: FlujoRecibo = {
  etiqueta: 'ReciboEstampado',
  archivoCab: 'RecibosEst.csv',
  archivoDet: 'OrdenesDetRecA.csv',
  pkCab: 'IdRecibosEst',
  fkDet: 'IdRecibosEst',
  entidadMapeo: ENTIDAD_MAPEO.etapaReciboEstampado,
  entidadProveedor: ENTIDAD_MAPEO.proveedorPorIdEstampadores,
  codigoProceso: 'estampado',
  tieneInventariado: false,
};

/** Resultado de un flujo de recibos. */
export interface ResultadoRecibos {
  recibos: ResultadoLoader;
  celdas: number;
  /** # de recibos de costura con Inventariado 0/vacío (informativo; NO afecta — no hay entrada PT). */
  sinInventariar: number;
  /** # de recibos sin TipoPrendas (listado). */
  sinTipoPrendas: number;
  /** # de recibos sin Cantidad en cabecera (el total se deriva del detalle; listado). */
  sinCantidad: number;
}

function resolverTercero(crudo: string | undefined, mapa: Map<string, number>): number | null {
  const t = (crudo ?? '').trim();
  if (t === '' || t === '0') return null;
  return mapa.get(t) ?? null;
}

/** Carga los recibos de COSTURA (Recibos → tipoProceso costura). */
export async function cargarRecibosCostura(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoRecibos> {
  return cargarFlujoRecibo(sesion, cliente, reporte, FLUJO_COSTURA);
}

/** Carga los recibos de ESTAMPADO (RecibosEst → tipoProceso estampado). */
export async function cargarRecibosEstampado(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoRecibos> {
  return cargarFlujoRecibo(sesion, cliente, reporte, FLUJO_ESTAMPADO);
}

async function cargarFlujoRecibo(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  flujo: FlujoRecibo,
): Promise<ResultadoRecibos> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const cli = cliente as PrismaClient;

  const vacio: ResultadoRecibos = {
    recibos: { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 },
    celdas: 0,
    sinInventariar: 0,
    sinTipoPrendas: 0,
    sinCantidad: 0,
  };

  const idTipoProceso = await resolverTipoProceso(cli, flujo.codigoProceso);
  if (idTipoProceso === null) {
    reporte.agregar(
      `${flujo.etiqueta}: falta el TipoProceso "${flujo.codigoProceso}" (re-sembrar) — flujo OMITIDO`,
      `archivo=${flujo.archivoCab}`,
    );
    return vacio;
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
  const resultado: ResultadoRecibos = { ...vacio, recibos: { ...vacio.recibos } };

  const filas = leerCsv(flujo.archivoCab);
  const contribs = await enLotes(
    filas,
    (f) =>
      conReintentoTransitorio(() =>
        procesarRecibo(sesion, bd, cli, reporte, f, {
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
      resultado.recibos.omitidosValidacion = (resultado.recibos.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const c = res.valor;
    if (c.estado === 'creado') resultado.recibos.creados += 1;
    else if (c.estado === 'existente') resultado.recibos.existentes += 1;
    else if (c.estado === 'omitido') resultado.recibos.omitidos += 1;
    else resultado.recibos.omitidosValidacion = (resultado.recibos.omitidosValidacion ?? 0) + 1;
    resultado.celdas += c.celdas;
    if (c.sinInventariar) resultado.sinInventariar += 1;
    if (c.sinTipoPrendas) resultado.sinTipoPrendas += 1;
    if (c.sinCantidad) resultado.sinCantidad += 1;
  }

  return resultado;
}

interface ContextoRecibos {
  flujo: FlujoRecibo;
  idTipoProceso: number;
  mapaOrdenV2: Map<string, number>;
  mapaProveedor: Map<string, number>;
  mapaColorF1: Map<string, number>;
  mapaOrdenesDet: MapaOrdenesDet;
  tallasCrudas: Map<string, string>;
  detPorCab: Map<string, Record<string, string>[]>;
  cacheOrdenes: CacheOrdenes;
}

interface ContribRecibo {
  estado: 'creado' | 'existente' | 'omitido' | 'omitidoValidacion';
  celdas: number;
  sinInventariar: boolean;
  sinTipoPrendas: boolean;
  sinCantidad: boolean;
}

async function procesarRecibo(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: PrismaClient,
  reporte: Reporte,
  f: Record<string, string>,
  ctx: ContextoRecibos,
): Promise<ContribRecibo> {
  const { flujo } = ctx;
  const sin = (
    estado: ContribRecibo['estado'],
    extra: Partial<ContribRecibo> = {},
  ): ContribRecibo => ({
    estado,
    celdas: 0,
    sinInventariar: false,
    sinTipoPrendas: false,
    sinCantidad: false,
    ...extra,
  });

  const idCab = (f[flujo.pkCab] ?? '').trim();
  const idOrdenViejo = (f.IdOrdenes ?? '').trim();

  const ya = await leerMapeo(cliente, flujo.entidadMapeo, idCab);
  if (ya !== null) {
    return sin('existente');
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
    return sin('omitido');
  }

  // Reglas de limpieza (NO arreglar en silencio — listar). No bloquean la carga.
  const tipoPrendas = parsearTexto(f.TipoPrendas);
  const sinTipoPrendas = tipoPrendas === null;
  if (sinTipoPrendas) {
    reporte.agregar(
      `${flujo.etiqueta}: sin TipoPrendas (nota vieja vacía; el recibo igual entra)`,
      `${flujo.pkCab}=${idCab}`,
    );
  }
  const cantidadCab = parsearTexto(f.Cantidad);
  const sinCantidad = cantidadCab === null;
  if (sinCantidad) {
    reporte.agregar(
      `${flujo.etiqueta}: sin Cantidad en cabecera (el total se deriva del detalle)`,
      `${flujo.pkCab}=${idCab}`,
    );
  }
  let sinInventariar = false;
  if (flujo.tieneInventariado) {
    const inv = (f.Inventariado ?? '').trim();
    if (inv === '' || inv === '0') {
      sinInventariar = true; // informativo: esta variante nunca genera entrada PT
    }
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
    return sin('omitido', { sinInventariar, sinTipoPrendas, sinCantidad });
  }

  const fecha = parsearFechaSoloDia(f.Fecha);
  if (fecha === null) {
    reporte.agregar(
      `${flujo.etiqueta}: sin fecha parseable (OMITIDO)`,
      `${flujo.pkCab}=${idCab} Fecha="${f.Fecha ?? ''}"`,
    );
    return sin('omitido', { sinInventariar, sinTipoPrendas, sinCantidad });
  }

  // Calidad: todo PRIMERA (el viejo no desglosa segundas). cantidadPrimeras = cantidad, segundas = 0.
  const celdasConCalidad = celdas.map((c) => ({
    ...c,
    cantidadPrimeras: c.cantidad,
    cantidadSegundas: 0,
  }));

  // Observaciones: combina la nota libre del recibo con TipoPrendas (si trae), para no perder el dato.
  const obsRecibo = parsearTexto(f.Observaciones);
  const observaciones =
    tipoPrendas === null
      ? obsRecibo
      : obsRecibo === null
        ? `TipoPrendas: ${tipoPrendas}`
        : `${obsRecibo}\nTipoPrendas: ${tipoPrendas}`;

  const creado = await intentarCrear(reporte, flujo.etiqueta, idCab, () =>
    crearReciboMigrado(
      sesion,
      {
        idEmpresa: orden.idEmpresa,
        idOrden: orden.idOrden,
        idTipoProceso: ctx.idTipoProceso,
        claveVieja: `${flujo.pkCab}=${idCab}`,
        idTercero: resolverTercero(f.IdMaquileros, ctx.mapaProveedor),
        fecha,
        observaciones,
        celdas: celdasConCalidad,
      },
      bd,
    ),
  );
  if (creado === null) {
    return sin('omitidoValidacion', { sinInventariar, sinTipoPrendas, sinCantidad });
  }
  await guardarMapeo(cliente, flujo.entidadMapeo, idCab, creado.idEtapa);
  return {
    estado: 'creado',
    celdas: creado.celdas,
    sinInventariar,
    sinTipoPrendas,
    sinCantidad,
  };
}
