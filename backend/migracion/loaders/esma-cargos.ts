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
 * VENTANA temporal (`ETL_DESDE`/`ETL_VENTANA_ANIOS`, default inactiva) y SALDO INICIAL (D3): el saldo
 * del maquilero es SUMA derivada (`Σcargos + Σabonos − Σpagos − Σdescuentos`, ver `dominio/esma/
 * saldos.ts`), así que recortar historia lo cambiaría. Con la ventana ACTIVA:
 *  • CARGOS: siguen a su ORDEN mapeada (cascada). Los de órdenes excluidas POR LA VENTANA (prescan
 *    `comun/ventana-f2.ts`) van al bucket agregado y su importe VALIDADO (cant×precio, "ceronulo")
 *    alimenta el {@link SaldoInicialEsMa}; los de órdenes con origen inválido siguen OMITIDOS como
 *    siempre (bucket aparte, sin saldo — igual que una corrida sin ventana).
 *  • ABONOS/DESCUENTOS/PAGOS: se excluyen por su FECHA (`EsMa.FechaEsMa` pre-corte) y su monto
 *    signado alimenta el mismo acumulador.
 *  • Al final, {@link crearAsientosSaldoInicialEsMa} crea UN `AbonoMaquilero` sintético "Saldo
 *    inicial de migración" por maquilero (fecha = corte, `revisado`, `conFactura` NULL) — el MISMO
 *    vehículo que el viejo usaba para el "saldo anterior" (abonos con monto libre/negativo), vía
 *    `crearAbonoMigrado` (modo migración, sin efectos derivados). Idempotente por `MapeoMigracion`
 *    (`AbonoMaquilero`, clave `saldo-inicial:<idMaquileroV2>`); si el asiento ya existe con OTRO
 *    monto (corte distinto entre corridas) se LISTA la discrepancia, NUNCA se pisa (§7).
 * Con la ventana INACTIVA nada de esto corre: el comportamiento actual no cambia en nada.
 *
 * Idempotencia: por el `MapeoMigracion` de `IdEsMa_Recibos`.
 */
import {
  crearAbonoMigrado,
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
import { MuestraAgregada } from '../comun/muestra.js';
import { conReintentoTransitorio } from '../comun/reintentos.js';
import { AcumuladorSaldos, esPreCorte, observacionSaldoInicial } from '../comun/saldo-inicial.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearBandera, parsearDinero, parsearFecha, parsearTexto } from '../comun/valores.js';
import { resolverVentana, type ConfigVentana } from '../comun/ventana.js';
import type { Reporte } from '../comun/reporte.js';
import type { ResultadoLoader } from './clientes.js';
import { BucketOrdenNoMigrada, cargarMapaOrdenV2 } from './produccion-comun.js';
import { resolverTipoProceso } from './produccion-tipos.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// SALDO INICIAL de EsMa (ventana temporal activa). El saldo del maquilero se DERIVA por suma (D3:
// `Σcargos validados + Σabonos − Σpagos − Σdescuentos`, `dominio/esma/saldos.ts`); si la ventana
// recorta historia sin más, el saldo quedaría MAL. Este acumulador junta, mientras corren los
// loaders, el efecto SIGNADO de lo excluido por la ventana, por maquilero v2, y al final
// `crearAsientosSaldoInicialEsMa` lo condensa en UN `AbonoMaquilero` por maquilero (fecha = corte).
// ─────────────────────────────────────────────────────────────────────────────

/** Datos del combo del acumulador (aquí el combo es simplemente el maquilero v2). */
interface ComboSaldoEsMa {
  idMaquilero: number;
}

/**
 * Acumulador del saldo inicial EsMa (solo suma con la ventana ACTIVA — con la ventana inactiva es
 * inerte y nada cambia). `ordenesFuera` (prescan de `comun/ventana-f2.ts`) distingue los cargos de
 * órdenes excluidas POR LA VENTANA (van al saldo) de los de origen inválido (omitidos como siempre).
 */
export class SaldoInicialEsMa {
  readonly acumulador = new AcumuladorSaldos<ComboSaldoEsMa>();
  /** # de cargos excluidos por ventana cuyo importe validado entró al saldo. */
  cargosAlSaldo = 0;
  /** # de cargos excluidos por ventana que NO entran al saldo (propuestos o maquilero sin mapeo). */
  cargosSinSaldo = 0;

  constructor(
    readonly ventana: ConfigVentana,
    /** `IdOrdenes` v1 excluidas POR LA VENTANA (prescan F2). */
    readonly ordenesFuera: ReadonlySet<string>,
  ) {}

  /** ¿La ventana está activa (hay corte)? Inactiva → el acumulador es un no-op. */
  get activa(): boolean {
    return this.ventana.corte !== null;
  }

  /** Suma una contribución SIGNADA al saldo del maquilero (+cargo/+abono, −pago/−descuento). */
  sumar(idMaquilero: number, monto: number): void {
    if (!this.activa || monto === 0) return;
    const clave = String(idMaquilero).padStart(10, '0');
    if (monto >= 0) this.acumulador.agregar(clave, { idMaquilero }, 'entrada', monto);
    else this.acumulador.agregar(clave, { idMaquilero }, 'salida', -monto);
  }
}

export async function cargarCargosEsMa(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  saldoInicial?: SaldoInicialEsMa,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const cli = cliente as PrismaClient;

  const idProcCostura = await resolverTipoProceso(cli, 'costura');
  const idProcEstampado = await resolverTipoProceso(cli, 'estampado');
  if (idProcCostura === null || idProcEstampado === null) {
    reporte.agregar(
      'CargoEsMa: falta el TipoProceso costura/estampado (re-sembrar) — flujo OMITIDO',
      'EsMa_Recibos.csv',
    );
    return { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };
  }

  const mapaOrdenV2 = await cargarMapaOrdenV2(cliente);
  const mapaMaquilero = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.proveedorPorIdMaquileros);
  const mapaEstampador = await cargarMapaNumerico(
    cliente,
    ENTIDAD_MAPEO.proveedorPorIdEstampadores,
  );

  // Cabeceras EsMa por IdEsMa (helper compartido con los loaders de movimientos planos).
  const cabeceras = cargarCabecerasEsMa();

  const resultado: ResultadoLoader = {
    creados: 0,
    existentes: 0,
    omitidos: 0,
    omitidosValidacion: 0,
  };

  // Bucket AGREGADO de cargos con orden no migrada (con ventana activa serían miles: conteo + muestra).
  const bucketOrden = new BucketOrdenNoMigrada();

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
          bucketOrden,
          saldoInicial,
        }),
      ),
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

  bucketOrden.volcar(reporte, 'CargoEsMa');
  if (saldoInicial?.activa === true) {
    reporte.nota(
      `CargoEsMa (ventana activa): ${String(saldoInicial.cargosAlSaldo)} cargos VALIDADOS de órdenes ` +
        `fuera de ventana alimentan el saldo inicial; ${String(saldoInicial.cargosSinSaldo)} excluidos ` +
        'sin efecto en saldo (propuestos o maquilero sin mapeo — igual que sin ventana).',
    );
  }

  return resultado;
}

interface ContextoCargos {
  cabeceras: Map<string, CabeceraEsMa>;
  mapaOrdenV2: Map<string, number>;
  mapaMaquilero: Map<string, number>;
  mapaEstampador: Map<string, number>;
  idProcCostura: number;
  idProcEstampado: number;
  /** Agregado de cargos con orden no migrada (conteo + muestra, no una incidencia por fila). */
  bucketOrden: BucketOrdenNoMigrada;
  /** Acumulador del saldo inicial (solo con ventana activa; lo pasa `etl-esma`). */
  saldoInicial?: SaldoInicialEsMa | undefined;
}

type EstadoContrib = 'creado' | 'existente' | 'omitido' | 'omitidoValidacion' | 'fueraVentana';

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

  const idOrden = ctx.mapaOrdenV2.get(idOrdenViejo);
  if (idOrden === undefined) {
    // Orden no migrada (fuera de ventana u origen inválido): al bucket agregado (conteo + muestra).
    ctx.bucketOrden.registrar(`IdEsMa_Recibos=${idCargoViejo} IdOrdenes=${idOrdenViejo}`);
    // Ventana ACTIVA y la orden quedó fuera POR LA VENTANA (prescan F2): el importe VALIDADO del
    // cargo (cant×precio, "ceronulo" — solo los validados suman en el saldo derivado, D3) alimenta
    // el saldo inicial del maquilero. Origen inválido → NO suma (igual que una corrida sin ventana).
    if (ctx.saldoInicial?.activa === true && ctx.saldoInicial.ordenesFuera.has(idOrdenViejo)) {
      const validado = !parsearBandera(f.RevisionPendiente);
      const idMaquilero = resolverMaquileroCabecera(
        cab.idMaquileroViejo,
        ctx.mapaMaquilero,
        ctx.mapaEstampador,
      );
      if (validado && idMaquilero !== null) {
        const importe = (parsearDinero(f.CantRecEsMa) ?? 0) * (parsearDinero(f.PrecioEsMa) ?? 0);
        ctx.saldoInicial.sumar(idMaquilero, importe);
        ctx.saldoInicial.cargosAlSaldo += 1;
      } else {
        ctx.saldoInicial.cargosSinSaldo += 1;
      }
    }
    return 'omitido';
  }
  const ordenV2 = await cliente.orden.findUnique({
    where: { id: idOrden },
    select: { idEmpresa: true },
  });
  if (ordenV2 === null) {
    ctx.bucketOrden.registrar(
      `IdEsMa_Recibos=${idCargoViejo} IdOrdenes=${idOrdenViejo} (mapeada pero inexistente en v2)`,
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
  /** Signo con el que el concepto entra al SALDO derivado (D3): abonos `+1`, pagos/descuentos `-1`.
   * Solo se usa con la ventana activa, para acumular lo excluido en el saldo inicial. */
  signoSaldo: 1 | -1;
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
  /** Ventana temporal (se resuelve UNA vez por corrida). */
  ventana: ConfigVentana;
  /** Bucket agregado de movimientos pre-corte excluidos (conteo + muestra). */
  bucketFueraVentana: MuestraAgregada;
  /** Acumulador del saldo inicial (solo con ventana activa; lo pasa `etl-esma`). */
  saldoInicial?: SaldoInicialEsMa | undefined;
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
  ventana: ConfigVentana = resolverVentana(),
  saldoInicial?: SaldoInicialEsMa,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const cli = cliente as PrismaClient;

  const idEmpresa = await resolverEmpresaEsMa(cli);
  const cabeceras = cargarCabecerasEsMa();
  const mapaMaquilero = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.proveedorPorIdMaquileros);
  const mapaEstampador = await cargarMapaNumerico(
    cliente,
    ENTIDAD_MAPEO.proveedorPorIdEstampadores,
  );

  const resultado: ResultadoLoader = {
    creados: 0,
    existentes: 0,
    omitidos: 0,
    omitidosValidacion: 0,
  };

  // Bucket agregado de los movimientos pre-corte excluidos por la ventana (conteo + muestra).
  const bucketFueraVentana = new MuestraAgregada();

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
          bucketFueraVentana,
          saldoInicial,
        }),
      ),
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
    else if (e === 'fueraVentana') resultado.fueraVentana = (resultado.fueraVentana ?? 0) + 1;
    else resultado.omitidosValidacion = (resultado.omitidosValidacion ?? 0) + 1;
  }

  bucketFueraVentana.volcar(
    reporte,
    `${cfg.etiqueta} FUERA de la ventana temporal (EXCLUIDO — su efecto entra al saldo inicial) (agregado)`,
  );

  return resultado;
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

  // Ventana temporal: el movimiento PRE-CORTE se EXCLUYE y su efecto signado (D3) va al saldo
  // inicial del maquilero. Con ventana inactiva `esPreCorte` siempre es false (nada cambia). El
  // chequeo va DESPUÉS de la idempotencia: lo ya migrado por una corrida sin ventana queda como
  // `existente` y NO se re-suma al saldo (anti doble conteo).
  if (esPreCorte(fecha, ctx.ventana)) {
    ctx.saldoInicial?.sumar(idMaquilero, cfg.signoSaldo * monto);
    ctx.bucketFueraVentana.agregar(
      `${cfg.columnaId}=${idViejo} fecha=${fecha.toISOString().slice(0, 10)} monto=${monto.toFixed(2)}`,
    );
    return 'fueraVentana';
  }

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

// ─────────────────────────────────────────────────────────────────────────────
// Asientos del SALDO INICIAL (se corren al FINAL de `etl-esma`, tras los 4 loaders).
// ─────────────────────────────────────────────────────────────────────────────

/** Redondeo monetario a 2 decimales (mismo criterio que `dominio/esma/saldos.ts`). */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Resultado de la creación de asientos de saldo inicial (para el log y los tests). */
export interface ResultadoSaldoInicialEsMa {
  /** Maquileros con neto ≠ 0 (candidatos a asiento). */
  maquileros: number;
  /** Asientos creados en esta corrida. */
  creados: number;
  /** Asientos que ya existían (idempotencia por `MapeoMigracion`). */
  existentes: number;
  /** Maquileros cuyo neto pre-corte cierra en 0 (sin asiento). */
  netoCero: number;
  /** Asientos existentes cuyo monto difiere del neto recalculado (LISTADOS, nunca se pisan). */
  discrepantes: number;
}

/**
 * Crea UN `AbonoMaquilero` sintético "Saldo inicial de migración" por maquilero con neto pre-corte
 * ≠ 0, con fecha = corte de la ventana (ver el TSDoc del módulo). Vehículo LIMPIO y ya existente: el
 * propio viejo llevaba el "saldo anterior" como abonos de monto libre (incluso negativo), y
 * `crearAbonoMigrado` (modo migración) los inserta sin efectos derivados ni validación de signo.
 * IDEMPOTENTE por `MapeoMigracion` (`AbonoMaquilero`, clave estable `saldo-inicial:<idMaquileroV2>`);
 * un asiento existente con OTRO monto (p. ej. cortes distintos entre corridas) se LISTA como
 * discrepancia y NO se pisa (§7). Con la ventana inactiva o sin nada acumulado es un no-op.
 */
export async function crearAsientosSaldoInicialEsMa(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  saldoInicial: SaldoInicialEsMa,
): Promise<ResultadoSaldoInicialEsMa> {
  const r: ResultadoSaldoInicialEsMa = {
    maquileros: 0,
    creados: 0,
    existentes: 0,
    netoCero: 0,
    discrepantes: 0,
  };
  const corte = saldoInicial.ventana.corte;
  const saldos = saldoInicial.acumulador.saldos();
  if (corte === null || saldos.length === 0) {
    return r;
  }

  const cli = cliente as PrismaClient;
  const bd: ContextoBd = { cliente: cli };
  const idEmpresa = await resolverEmpresaEsMa(cli);
  const fechaCorte = corte.toISOString().slice(0, 10);

  for (const s of saldos) {
    const neto = redondear2(s.neto);
    if (neto === 0) {
      r.netoCero += 1;
      continue;
    }
    r.maquileros += 1;
    const idMaquilero = s.datos.idMaquilero;
    const claveVieja = `saldo-inicial:${String(idMaquilero)}`;

    const ya = await leerMapeo(cli, ENTIDAD_MAPEO.abonoMaquilero, claveVieja);
    if (ya !== null) {
      r.existentes += 1;
      // Cruce defensivo: si el asiento existente no coincide con el neto recalculado (otro corte u
      // otra corrida), se LISTA — nunca se pisa ni se "corrige" en silencio (§7).
      const existente = await cli.abonoMaquilero.findUnique({
        where: { id: Number(ya) },
        select: { monto: true },
      });
      const montoExistente = existente === null ? null : existente.monto.toNumber();
      if (montoExistente === null || Math.abs(montoExistente - neto) > 0.01) {
        r.discrepantes += 1;
        reporte.agregar(
          'Saldo inicial EsMa: asiento EXISTENTE difiere del neto recalculado (NO se pisa — revisar corte/corridas)',
          `idMaquilero=${String(idMaquilero)} existente=${montoExistente === null ? '(borrado)' : montoExistente.toFixed(2)} recalculado=${neto.toFixed(2)}`,
        );
      }
      continue;
    }

    const creado = await intentarCrear(reporte, 'AbonoMaquilero (saldo inicial)', claveVieja, () =>
      crearAbonoMigrado(
        sesion,
        {
          idEmpresa,
          idMaquilero,
          monto: neto,
          fecha: corte,
          estadoRevision: 'revisado',
          observaciones: observacionSaldoInicial(
            `EsMa maquilero v2=${String(idMaquilero)} · neto pre-corte (cargos validados + abonos − ` +
              `pagos − descuentos, D3) = ${neto.toFixed(2)} · renglones=${String(s.renglones)} · corte=${fechaCorte}`,
          ),
        },
        bd,
      ),
    );
    if (creado === null) {
      continue;
    }
    await guardarMapeo(cli, ENTIDAD_MAPEO.abonoMaquilero, claveVieja, creado.id, {
      neto,
      corte: fechaCorte,
      renglones: s.renglones,
      entradas: redondear2(s.entradas),
      salidas: redondear2(s.salidas),
    });
    r.creados += 1;
    // El desglose por maquilero queda EXPLÍCITO en el reporte (el delta v1-vs-v2 se explica solo).
    reporte.agregar(
      'Saldo inicial de migración EsMa (UN AbonoMaquilero por maquilero, fecha = corte)',
      `idMaquilero=${String(idMaquilero)} neto=${neto.toFixed(2)} (renglones pre-corte=${String(s.renglones)})`,
    );
  }
  return r;
}
