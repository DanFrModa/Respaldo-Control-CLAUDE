/**
 * Loader de CARGOS EsMa históricos (F3-E6, Pieza A).
 *
 *   `EsMa.csv` (~11,369: cabecera por maquilero+fecha) + `EsMa_Recibos.csv` (~7,401: un cargo por
 *   renglón) → `EsMaCargo` histórico.
 *
 * Cada renglón de `EsMa_Recibos` es UN cargo, ligado a su `EsMa` (cabecera: maquilero + fecha). En v2
 * el cargo se liga a ORDEN + MAQUILERO + PROCESO, SIN FK al recibo (`idEtapaRecibo = NULL`: la liga
 * formal recibo↔cargo nace en v2 — el viejo no la tenía). Carga vía el MODO MIGRACIÓN del dominio
 * (`crearCargoEsMaMigrado`, A1): NO toca kardex.
 *
 * Mapeo de campos:
 *  • idOrden: `EsMa_Recibos.IdOrdenes` → `Orden.id` (MapeoMigracion de F2). Sin mapeo → cargo
 *    OMITIDO + listado.
 *  • idMaquilero: `EsMa.IdMaquileros` → Proveedor. Según `EsEstampado`: estampadores (1) o
 *    maquileros de costura (0). Sin mapeo → cargo OMITIDO (idMaquilero es NOT NULL).
 *  • idTipoProceso: `EsEstampado` → estampado (1) / costura (0). Falta el TipoProceso → OMITIDO.
 *  • cantidadReal/precioReal: `CantRecEsMa` / `PrecioEsMa` (ya CONCILIADOS en el viejo). Puede nacer
 *    SIN precio (precioReal NULL).
 *  • estado: `RevisionPendiente` 1 → `propuesto` (quedó por revisar); 0 → `validado` (ya conciliado).
 *  • fecha (validadoEn si validado): `EsMa.FechaEsMa`.
 *  • observaciones: combina `EsMa_Recibos.ObsRecibos` + `EsMa.ObsEsMa`.
 *
 * No-cuadre conocido (DOCUMENTADO, NO es error): 12,440 recibos de costura vs 7,401 cargos EsMa — el
 * EsMa del viejo NO tenía relación 1:1 con los recibos (varios recibos podían conciliarse en un cargo,
 * o quedar sin cargo). Por eso el cargo migrado no liga al recibo y el conteo difiere a propósito.
 *
 * Idempotencia: por el `MapeoMigracion` de `IdEsMa_Recibos`.
 *
 * ⭐ VENTANA TEMPORAL (§Post-F9.24, arreglada el 11-ago-2026). TODO lo de EsMa —cargos y los tres
 * movimientos planos— recorta por la fecha de la CABECERA `EsMa.FechaEsMa`, que es la fecha del
 * documento. Antes solo los cargos quedaban acotados de rebote (dependen del mapeo de la orden) y
 * los movimientos planos NO tenían ventana ni dependían de la orden: con `ETL_DESDE=2025` habrían
 * entrado los cargos de apenas **384 cabeceras EsMa** contra **554 abonos + 743 descuentos + 5,935
 * pagos COMPLETOS**, y el saldo de cada maquilero (derivado, D3) habría salido masivamente NEGATIVO
 * — como si a todos se les hubiera pagado de más durante 16 años. La ventana va en los CUATRO por la
 * MISMA fecha justamente para que la cuenta corriente quede lo más coherente posible. Lo excluido se
 * cuenta y se REPORTA (§7).
 *
 * ⚠️ **La coherencia NO es total, y hay que decirlo:** el cargo necesita ADEMÁS el mapeo de su
 * ORDEN. Una cabecera EsMa de 2025 cuyo recibo cuelga de una orden de 2024 pasa la ventana, pero su
 * cargo se OMITE por "orden sin mapeo" mientras los abonos/descuentos/pagos de ESA MISMA cabecera sí
 * entran → reaparece, más chico, el saldo negativo derivado. Y no es rebuscado: una orden cortada en
 * nov-dic se cobra en ene-feb. Por eso NO se dice "o entra el documento EsMa completo o no entra";
 * lo que se hace es **contar aparte** esos cargos (`sinMapeoOrden`) y sacarlos al resumen de la
 * corrida, para que la magnitud del sesgo se VEA en vez de quedar escondida entre los `omitidos`.
 */
import {
  crearCargoEsMaMigrado,
  type MovimientoEsMaMigrado,
  type ResultadoMovimientoEsMaMigrado,
} from '../../src/dominio/esma/migracion.js';
import type { EstadoCargoEsMa, EstadoRevisionEsMa } from '../../src/datos/index.js';
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
import { parsearBandera, parsearDinero, parsearFecha, parsearTexto } from '../comun/valores.js';
import { dentroVentana, resolverVentana, type ConfigVentana } from '../comun/ventana.js';
import type { Reporte } from '../comun/reporte.js';
import type { ResultadoLoader } from './clientes.js';
import { cargarMapaOrdenV2 } from './produccion-comun.js';
import { resolverTipoProceso } from './produccion-tipos.js';

/**
 * Resultado de un loader de EsMa: el resumen estándar + lo que la ventana temporal dejó fuera
 * (§Post-F9.24). Se cuenta aparte de los `omitidos` porque no es un dato roto: es el recorte.
 */
export interface ResultadoEsMa {
  movimientos: ResultadoLoader;
  /** # de filas excluidas porque su cabecera `EsMa` es anterior al corte. Listadas en el reporte. */
  fueraVentana: number;
  /**
   * # de CARGOS omitidos porque su ORDEN no está migrada (típicamente: la orden quedó FUERA de la
   * ventana, aunque la cabecera EsMa esté dentro). Es el hueco de coherencia de la cuenta corriente
   * —los abonos/descuentos/pagos de esa misma cabecera SÍ entran—, así que se cuenta APARTE de los
   * `omitidos` para que se vea en el resumen. Siempre 0 en los movimientos planos (no usan orden).
   */
  sinMapeoOrden: number;
}

/** Cabecera `EsMa`: maquilero + fecha + obs, indexada por `IdEsMa`. Compartida por los loaders de
 * movimientos planos (abonos/descuentos/pagos, F6-E6): todos toman de aquí el maquilero + fecha + obs. */
export interface CabeceraEsMa {
  idMaquileroViejo: string;
  fecha: Date | null;
  obs: string | null;
}

/**
 * Lee `EsMa.csv` y arma el mapa `IdEsMa → cabecera` (maquilero + fecha + obs). Una sola lectura de las
 * ~11,369 cabeceras que reusan TODOS los loaders de EsMa (los cargos y los 3 movimientos planos).
 */
export function cargarCabecerasEsMa(): Map<string, CabeceraEsMa> {
  const cabeceras = new Map<string, CabeceraEsMa>();
  for (const f of leerCsv('EsMa.csv')) {
    const id = (f.IdEsMa ?? '').trim();
    if (id === '') continue;
    cabeceras.set(id, {
      idMaquileroViejo: (f.IdMaquileros ?? '').trim(),
      fecha: parsearFecha(f.FechaEsMa),
      obs: parsearTexto(f.ObsEsMa),
    });
  }
  return cabeceras;
}

/**
 * Resuelve el `Proveedor` (v2) de un `IdMaquileros` de la cabecera EsMa. ⭐ El viejo apuntaba SIEMPRE
 * al catálogo de `Maquileros` — incluso los cargos/movimientos de ESTAMPADO, cuyo maquilero es un
 * `Maquileros` con `Proceso=1`, NO el catálogo aparte de `Estampadores`. Por eso se busca PRIMERO en
 * `mapaMaquilero` y solo si no resuelve se cae a `mapaEstampador` (defensivo; en los datos reales el
 * fallback casi nunca se usa). Devuelve `null` si ninguno resuelve (vacío/`0` o sin mapeo).
 */
export function resolverMaquileroCabecera(
  idMaquileroViejo: string,
  mapaMaquilero: Map<string, number>,
  mapaEstampador: Map<string, number>,
): number | null {
  const t = idMaquileroViejo.trim();
  if (t === '' || t === '0') return null;
  return mapaMaquilero.get(t) ?? mapaEstampador.get(t) ?? null;
}

export async function cargarCargosEsMa(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoEsMa> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const cli = cliente as PrismaClient;

  const idProcCostura = await resolverTipoProceso(cli, 'costura');
  const idProcEstampado = await resolverTipoProceso(cli, 'estampado');
  if (idProcCostura === null || idProcEstampado === null) {
    reporte.agregar(
      'CargoEsMa: falta el TipoProceso costura/estampado (re-sembrar) — flujo OMITIDO',
      'EsMa_Recibos.csv',
    );
    return {
      movimientos: { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 },
      fueraVentana: 0,
      sinMapeoOrden: 0,
    };
  }

  const mapaOrdenV2 = await cargarMapaOrdenV2(cliente);
  const mapaMaquilero = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.proveedorPorIdMaquileros);
  const mapaEstampador = await cargarMapaNumerico(
    cliente,
    ENTIDAD_MAPEO.proveedorPorIdEstampadores,
  );

  // Cabeceras EsMa por IdEsMa (helper compartido con los loaders de movimientos planos).
  const cabeceras = cargarCabecerasEsMa();

  const movimientos: ResultadoLoader = {
    creados: 0,
    existentes: 0,
    omitidos: 0,
    omitidosValidacion: 0,
  };
  let fueraVentana = 0;
  let sinMapeoOrden = 0;

  const ventana = resolverVentana();
  const filas = leerCsv('EsMa_Recibos.csv');
  const contribs = await enLotes(
    filas,
    (f) =>
      conReintentoTransitorio(() =>
        procesarCargo(sesion, bd, cli, reporte, f, {
          cabeceras,
          mapaOrdenV2,
          mapaMaquilero,
          mapaEstampador,
          idProcCostura,
          idProcEstampado,
          ventana,
        }),
      ),
    CONCURRENCIA_ETL,
  );

  for (const res of contribs) {
    if (!res.ok) {
      movimientos.omitidosValidacion = (movimientos.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const e = res.valor;
    if (e === 'creado') movimientos.creados += 1;
    else if (e === 'existente') movimientos.existentes += 1;
    else if (e === 'omitido') movimientos.omitidos += 1;
    else if (e === 'fueraVentana') fueraVentana += 1;
    else if (e === 'sinMapeoOrden') {
      // Sigue contando como omitido (no cambia el cuadre); el contador propio es para VERLO.
      movimientos.omitidos += 1;
      sinMapeoOrden += 1;
    } else movimientos.omitidosValidacion = (movimientos.omitidosValidacion ?? 0) + 1;
  }

  return { movimientos, fueraVentana, sinMapeoOrden };
}

interface ContextoCargos {
  cabeceras: Map<string, CabeceraEsMa>;
  mapaOrdenV2: Map<string, number>;
  mapaMaquilero: Map<string, number>;
  mapaEstampador: Map<string, number>;
  idProcCostura: number;
  idProcEstampado: number;
  ventana: ConfigVentana;
}

type EstadoContrib =
  | 'creado'
  | 'existente'
  | 'omitido'
  | 'omitidoValidacion'
  | 'fueraVentana'
  /** Solo cargos: la cabecera EsMa entra por fecha, pero su ORDEN no está migrada. */
  | 'sinMapeoOrden';

async function procesarCargo(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: PrismaClient,
  reporte: Reporte,
  f: Record<string, string>,
  ctx: ContextoCargos,
): Promise<EstadoContrib> {
  const idCargoViejo = (f.IdEsMa_Recibos ?? '').trim();
  const idEsMa = (f.IdEsMa ?? '').trim();
  const idOrdenViejo = (f.IdOrdenes ?? '').trim();

  const ya = await leerMapeo(cliente, ENTIDAD_MAPEO.cargoEsMa, idCargoViejo);
  if (ya !== null) {
    return 'existente';
  }

  const cab = ctx.cabeceras.get(idEsMa);
  if (cab === undefined) {
    reporte.agregar(
      'CargoEsMa con cabecera EsMa inexistente (OMITIDO)',
      `IdEsMa_Recibos=${idCargoViejo} IdEsMa=${idEsMa}`,
    );
    return 'omitido';
  }

  // Ventana temporal por la fecha de la CABECERA (la del documento EsMa). Va en los cuatro loaders
  // de EsMa con el MISMO criterio para que la cuenta corriente del maquilero quede coherente.
  if (!dentroVentana(cab.fecha, ctx.ventana)) {
    reporte.agregar(
      'CargoEsMa FUERA de la ventana temporal (cabecera EsMa anterior al corte)',
      `IdEsMa_Recibos=${idCargoViejo} IdEsMa=${idEsMa} fecha=${cab.fecha?.toISOString().slice(0, 10) ?? '(sin fecha)'}`,
    );
    return 'fueraVentana';
  }

  const idOrden = ctx.mapaOrdenV2.get(idOrdenViejo);
  if (idOrden === undefined) {
    // La cabecera EsMa SÍ pasó la ventana, pero su orden no está migrada (lo normal: la orden es de
    // antes del corte). Los abonos/descuentos/pagos de esta misma cabecera sí van a entrar, así que
    // este cargo faltante sesga el saldo del maquilero hacia lo NEGATIVO. Se cuenta aparte.
    reporte.agregar(
      'CargoEsMa con orden sin mapeo (OMITIDO — la cabecera EsMa sí entra, el cargo no: sesga el saldo)',
      `IdEsMa_Recibos=${idCargoViejo} IdOrdenes=${idOrdenViejo}`,
    );
    return 'sinMapeoOrden';
  }
  const ordenV2 = await cliente.orden.findUnique({
    where: { id: idOrden },
    select: { idEmpresa: true },
  });
  if (ordenV2 === null) {
    reporte.agregar(
      'CargoEsMa con orden inexistente en v2 (OMITIDO)',
      `IdEsMa_Recibos=${idCargoViejo} IdOrdenes=${idOrdenViejo}`,
    );
    return 'omitido';
  }

  const esEstampado = parsearBandera(f.EsEstampado);
  const idTipoProceso = esEstampado ? ctx.idProcEstampado : ctx.idProcCostura;
  // ⭐ FIX F6-E6: el maquilero de la cabecera es SIEMPRE un `Maquileros` — también en estampado, cuyo
  // maquilero es un `Maquileros` con `Proceso=1` (NO el catálogo de Estampadores). Antes el estampado
  // se buscaba SOLO en `mapaEstampador` → 1,251 cargos válidos quedaban "sin mapeo" (falso). Ahora se
  // resuelve por `mapaMaquilero` (fallback estampador); el `idTipoProceso` sigue siendo estampado.
  const idMaquilero = resolverMaquileroCabecera(
    cab.idMaquileroViejo,
    ctx.mapaMaquilero,
    ctx.mapaEstampador,
  );
  if (idMaquilero === null) {
    reporte.agregar(
      'CargoEsMa con maquilero sin mapeo (OMITIDO — idMaquilero es obligatorio)',
      `IdEsMa_Recibos=${idCargoViejo} IdMaquileros=${cab.idMaquileroViejo} esEstampado=${String(esEstampado)}`,
    );
    return 'omitido';
  }

  // RevisionPendiente 1 → propuesto (quedó por revisar); 0/vacío → validado (ya conciliado).
  const revisionPendiente = parsearBandera(f.RevisionPendiente);
  const estado: EstadoCargoEsMa = revisionPendiente ? 'propuesto' : 'validado';

  const obsRecibos = parsearTexto(f.ObsRecibos);
  const observaciones =
    obsRecibos === null ? cab.obs : cab.obs === null ? obsRecibos : `${obsRecibos}\n${cab.obs}`;

  const creado = await intentarCrear(reporte, 'CargoEsMa', idCargoViejo, () =>
    crearCargoEsMaMigrado(
      sesion,
      {
        idEmpresa: ordenV2.idEmpresa,
        idMaquilero,
        idOrden,
        idTipoProceso,
        cantidadReal: parsearDinero(f.CantRecEsMa),
        precioReal: parsearDinero(f.PrecioEsMa),
        estado,
        observaciones,
        fecha: cab.fecha,
      },
      bd,
    ),
  );
  if (creado === null) {
    return 'omitidoValidacion';
  }
  await guardarMapeo(cliente, ENTIDAD_MAPEO.cargoEsMa, idCargoViejo, creado.idCargo);
  return 'creado';
}

// ─────────────────────────────────────────────────────────────────────────────
// MOVIMIENTOS PLANOS de EsMa (F6-E6): abonos / descuentos / pagos históricos. Los tres comparten la
// MISMA mecánica (una tabla hija de `EsMa` con {clave, monto, obs} + la cabecera aporta maquilero +
// fecha + obs), así que se cargan con UN loader genérico configurable. Las diferencias (archivo,
// columnas, bandera de revisión, entidad de mapeo, fn de dominio) viven en `ConfigMovimientoPlano`;
// los loaders concretos (`esma-abonos.ts`/`esma-descuentos.ts`/`esma-pagos.ts`) solo pasan su config.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resuelve la empresa dueña de los MOVIMIENTOS planos de EsMa. A diferencia del cargo (que hereda la
 * empresa de su ORDEN), abono/descuento/pago no cuelgan de una orden: el viejo llevaba UN solo estado
 * de cuenta de maquila (FR Moda / Marilyn — misma empresa). Para que los movimientos queden en la
 * MISMA empresa que los cargos (el orquestador carga los cargos PRIMERO), se toma la empresa de un
 * cargo EsMa ya migrado; si aún no hay cargos, se cae a la empresa FAVORITA y, en último caso, a la
 * primera empresa. Lanza si no hay ninguna empresa (config inválida).
 */
export async function resolverEmpresaEsMa(cliente: PrismaClient): Promise<number> {
  const cargo = await cliente.esMaCargo.findFirst({ select: { idEmpresa: true } });
  if (cargo !== null) return cargo.idEmpresa;
  const favorita = await cliente.empresa.findFirst({
    where: { favorita: true },
    select: { id: true },
  });
  if (favorita !== null) return favorita.id;
  const cualquiera = await cliente.empresa.findFirst({
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (cualquiera === null) {
    throw new Error('No hay ninguna empresa para asignar los movimientos EsMa.');
  }
  return cualquiera.id;
}

/** Configuración de un concepto de movimiento plano (abono/descuento/pago) para el loader genérico. */
export interface ConfigMovimientoPlano {
  /** Etiqueta para el reporte de incidencias (p. ej. `'AbonoMaquilero'`). */
  etiqueta: string;
  /** Archivo CSV fuente (p. ej. `'EsMa_Abonos.csv'`). */
  archivo: string;
  /** Columna de la clave vieja del hijo (p. ej. `'IdEsMa_Abonos'`). */
  columnaId: string;
  /** Columna del importe (p. ej. `'AbonoEsMa'`); nulo/no numérico → `0`. */
  columnaMonto: string;
  /** Columna de observaciones del hijo (p. ej. `'ObsAbonos'`). */
  columnaObs: string;
  /** Columna de la bandera de revisión pendiente (solo pagos: `'RevisionPendienteP'`). `null` = el
   * concepto no la trae → `revisado` (histórico ya conciliado); `1` → `capturado`, `0` → `revisado`. */
  columnaRevision: string | null;
  /** Entidad de mapeo para la idempotencia (`ENTIDAD_MAPEO.abonoMaquilero`, etc.). */
  entidadMapeo: EntidadMapeo;
  /** Fn de dominio (modo migración) que inserta el movimiento sin efectos derivados. */
  crear: (
    sesion: SesionUsuario,
    entrada: MovimientoEsMaMigrado,
    bd?: ContextoBd,
  ) => Promise<ResultadoMovimientoEsMaMigrado>;
}

/** Contexto compartido por las filas de un loader de movimientos planos. */
interface ContextoMovimiento {
  cfg: ConfigMovimientoPlano;
  cabeceras: Map<string, CabeceraEsMa>;
  mapaMaquilero: Map<string, number>;
  mapaEstampador: Map<string, number>;
  idEmpresa: number;
  ventana: ConfigVentana;
}

/**
 * Loader GENÉRICO de movimientos planos EsMa (abono/descuento/pago). Idempotente (por `MapeoMigracion`
 * del hijo), por LOTES (`enLotes`), tolerante (cada fila en `intentarCrear` + reintento transitorio).
 * Combina cada hijo con su cabecera `EsMa` (maquilero + fecha + obs) y carga vía la fn de dominio de
 * `cfg.crear` (modo migración: sin efectos derivados). Ver `ConfigMovimientoPlano`.
 */
export async function cargarMovimientosPlanosEsMa(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  cfg: ConfigMovimientoPlano,
): Promise<ResultadoEsMa> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const cli = cliente as PrismaClient;

  const idEmpresa = await resolverEmpresaEsMa(cli);
  const cabeceras = cargarCabecerasEsMa();
  const mapaMaquilero = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.proveedorPorIdMaquileros);
  const mapaEstampador = await cargarMapaNumerico(
    cliente,
    ENTIDAD_MAPEO.proveedorPorIdEstampadores,
  );

  const movimientos: ResultadoLoader = {
    creados: 0,
    existentes: 0,
    omitidos: 0,
    omitidosValidacion: 0,
  };
  let fueraVentana = 0;

  const ventana = resolverVentana();
  const filas = leerCsv(cfg.archivo);
  const contribs = await enLotes(
    filas,
    (f) =>
      conReintentoTransitorio(() =>
        procesarMovimientoPlano(sesion, bd, cli, reporte, f, {
          cfg,
          cabeceras,
          mapaMaquilero,
          mapaEstampador,
          idEmpresa,
          ventana,
        }),
      ),
    CONCURRENCIA_ETL,
  );

  for (const res of contribs) {
    if (!res.ok) {
      movimientos.omitidosValidacion = (movimientos.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const e = res.valor;
    if (e === 'creado') movimientos.creados += 1;
    else if (e === 'existente') movimientos.existentes += 1;
    else if (e === 'omitido') movimientos.omitidos += 1;
    else if (e === 'fueraVentana') fueraVentana += 1;
    // `sinMapeoOrden` no lo produce este loader (los movimientos planos no cuelgan de una orden);
    // se contempla para que un cambio futuro no lo deje cayendo en `omitidosValidacion`.
    else if (e === 'sinMapeoOrden') movimientos.omitidos += 1;
    else movimientos.omitidosValidacion = (movimientos.omitidosValidacion ?? 0) + 1;
  }

  return { movimientos, fueraVentana, sinMapeoOrden: 0 };
}

/** Procesa UNA fila de movimiento plano (abono/descuento/pago). */
async function procesarMovimientoPlano(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: PrismaClient,
  reporte: Reporte,
  f: Record<string, string>,
  ctx: ContextoMovimiento,
): Promise<EstadoContrib> {
  const { cfg } = ctx;
  const idViejo = (f[cfg.columnaId] ?? '').trim();
  const idEsMa = (f.IdEsMa ?? '').trim();

  const ya = await leerMapeo(cliente, cfg.entidadMapeo, idViejo);
  if (ya !== null) {
    return 'existente';
  }

  const cab = ctx.cabeceras.get(idEsMa);
  if (cab === undefined) {
    reporte.agregar(
      `${cfg.etiqueta} con cabecera EsMa inexistente (OMITIDO)`,
      `${cfg.columnaId}=${idViejo} IdEsMa=${idEsMa}`,
    );
    return 'omitido';
  }

  // ⭐ Ventana temporal por la fecha de la CABECERA (§Post-F9.24). Este loader NO depende de la
  // orden, así que sin este recorte cargaba los 554 abonos + 743 descuentos + 5,935 pagos COMPLETOS
  // contra apenas los cargos de 2025-2026: el saldo del maquilero (derivado, D3) salía masivamente
  // negativo, como si a todos se les hubiera pagado de más durante 16 años.
  if (!dentroVentana(cab.fecha, ctx.ventana)) {
    reporte.agregar(
      `${cfg.etiqueta} FUERA de la ventana temporal (cabecera EsMa anterior al corte)`,
      `${cfg.columnaId}=${idViejo} IdEsMa=${idEsMa} fecha=${cab.fecha?.toISOString().slice(0, 10) ?? '(sin fecha)'}`,
    );
    return 'fueraVentana';
  }

  const idMaquilero = resolverMaquileroCabecera(
    cab.idMaquileroViejo,
    ctx.mapaMaquilero,
    ctx.mapaEstampador,
  );
  if (idMaquilero === null) {
    reporte.agregar(
      `${cfg.etiqueta} con maquilero sin mapeo (OMITIDO — idMaquilero es obligatorio)`,
      `${cfg.columnaId}=${idViejo} IdMaquileros=${cab.idMaquileroViejo}`,
    );
    return 'omitido';
  }

  const fecha = cab.fecha;
  if (fecha === null) {
    reporte.agregar(
      `${cfg.etiqueta} con fecha vacía en la cabecera (OMITIDO — la fecha es obligatoria)`,
      `${cfg.columnaId}=${idViejo} IdEsMa=${idEsMa}`,
    );
    return 'omitido';
  }

  // Importe: nulo/no numérico → 0. Puede ser NEGATIVO (abonos/descuentos "saldo anterior"): se preserva.
  const monto = parsearDinero(f[cfg.columnaMonto]) ?? 0;
  const obsHijo = parsearTexto(f[cfg.columnaObs]);
  const observaciones =
    obsHijo === null ? cab.obs : cab.obs === null ? obsHijo : `${obsHijo}\n${cab.obs}`;
  // Abonos/descuentos: sin bandera → `revisado` (ya conciliados). Pagos: RevisionPendienteP 1→capturado / 0→revisado.
  const estadoRevision: EstadoRevisionEsMa =
    cfg.columnaRevision === null
      ? 'revisado'
      : parsearBandera(f[cfg.columnaRevision])
        ? 'capturado'
        : 'revisado';

  const creado = await intentarCrear(reporte, cfg.etiqueta, idViejo, () =>
    cfg.crear(
      sesion,
      { idEmpresa: ctx.idEmpresa, idMaquilero, monto, fecha, estadoRevision, observaciones },
      bd,
    ),
  );
  if (creado === null) {
    return 'omitidoValidacion';
  }
  await guardarMapeo(cliente, cfg.entidadMapeo, idViejo, creado.id);
  return 'creado';
}
