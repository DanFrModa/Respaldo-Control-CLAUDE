/**
 * Loader del KARDEX de INVENTARIO PT histórico (F3-E6, Pieza B) — el primer uso del motor de kardex
 * con datos reales del histórico (D3). Fuentes (CP850):
 *
 *   `IPT_Movs.csv` (~5,072)    → encabezado de cada movimiento (fecha, tipo, EnSa, almacén, obs…)
 *   `IPT_MovsDet.csv` (~6,886) → renglones (IdIPT_Mod_Alm → modelo×almacén + cantidad)
 *   `IPT_Mod_Alm.csv` (~3,655) → liga IdIPT_Mod_Alm → (IdIPT_Modelos, IdIPT_Almacenes)
 *   `IPT_Modelos.csv` (~1,224) → IdIPT_Modelos → NumMod (=código de v2) + IdEmpresas (empresa del mov.)
 *
 * Carga VÍA el MODO MIGRACIÓN del dominio (`crearMovimientoIptMigrado`, A1): el motor de kardex es
 * el ÚNICO que escribe `Movimiento`/`MovimientoDetPt`. Reglas DURAS (nada se pierde en silencio §7):
 *
 *  • DECISIÓN (c) — SENTINELA: el viejo NO tiene color/talla en IPT. Cada movimiento entra con un
 *    Color y una Talla `(sin especificar)` INACTIVOS (no salen en los selectores de captura). Se
 *    upsertan idempotentemente una sola vez y se reúsan en todo el histórico.
 *  • EMPRESA del movimiento = empresa del MODELO (`IPT_Modelos.IdEmpresas` → mapeo `Empresa`). El
 *    `IPT_Movs` no trae empresa; el modelo sí. Modelo con empresa sin mapeo (las inactivas / 0) →
 *    movimiento OMITIDO y reportado (no se inventa una empresa).
 *  • TIPO de movimiento: `IPT_Movs.IdIPT_TipoMov` (1..19) → código del seed canónico por POSICIÓN
 *    (el seed transcribió `IPT_TiposMov` 1:1 en orden). `IdIPT_TipoMov ∈ {0, vacío}` (464 filas del
 *    viejo, sin tipo) → se usa el tipo por `EnSa` ("Otras Entradas"/"Otras Salidas") y se REPORTA.
 *  • DIRECCIÓN: la define el tipo de v2 (su `direccion`). Se VERIFICA que case con `IPT_Movs.EnSa`
 *    (1=entrada/2=salida); si NO casa (p. ej. el tipo viejo era traspaso, dir 3), se REPORTA y el
 *    movimiento se carga con el tipo "Otras Entradas/Salidas" según EnSa (un traspaso del viejo era
 *    UN renglón con almacén único; v2 lo modela como dos patas — el histórico no trae la contraparte,
 *    así que se preserva como entrada/salida simple según su EnSa y se LISTA).
 *  • ALMACÉN: `IPT_Movs.IdIPT_Almacenes` → mapeo `Almacen:IPT` (los 3 PT). Sin mapeo → OMITIDO+report.
 *  • MODELO: `IdIPT_Mod_Alm` → `IPT_Mod_Alm.IdIPT_Modelos` → `IPT_Modelos.NumMod` → mapeo `Modelo`
 *    (por IdModelos viejo). Como IPT_Modelos NO referencia IdModelos directo sino NumMod (=código),
 *    se resuelve por el CÓDIGO del modelo de v2. Sin match → renglón OMITIDO + reportado.
 *  • `IdRecibos` (2,353 filas): se conserva como REFERENCIA informativa en `observaciones`, NUNCA
 *    como FK ni efecto (la entrada de PT del recibo la genera E4 sobre datos nuevos; aquí NO).
 *  • CANTIDAD ≤ 0 en un renglón → OMITIDO + reportado (el motor exige entero positivo).
 *
 * Idempotencia: por `Movimiento.origenId` = `IdIPT_MovsDet` con `origenTipo='migracion'`. Antes de
 * crear, se consulta el set de origenId ya migrados (una sola query) y se saltan los existentes; una
 * 2ª corrida no duplica. Carga CONCURRENTE acotada (`enLotes` + `conReintentoTransitorio`), POR
 * RENGLÓN independiente (cada `IPT_MovsDet` es su propio `Movimiento`).
 *
 * VENTANA TEMPORAL (`comun/ventana.ts`, default INACTIVA = comportamiento idéntico al de siempre):
 * con ventana ACTIVA, los renglones con fecha ≥ corte migran igual que hoy; los ANTERIORES no se
 * migran individuales sino que se ACUMULAN en memoria por combinación de inventario
 * (empresa×almacén×modelo — color/talla son el sentinela en TODO el histórico) con signo según la
 * dirección del tipo, y al final se crea UN movimiento SINTÉTICO por combo con fecha = corte:
 * neto > 0 → `inventario-inicial` (entrada); neto < 0 → `otras-salidas` por |neto| (incidencia
 * listada); neto 0 → nada. Así la existencia final por combo con ventana activa === la de migrar
 * todo (D3). Solo entra al neto lo que SE HABRÍA migrado (los renglones que hoy se omiten por datos
 * inválidos siguen omitiéndose ANTES de acumular). Idempotencia de los sintéticos: mismo
 * `origenTipo='migracion'` con `origenId = 'saldo-inicial:e<empresa>:a<almacén>:m<modelo>'` (no
 * puede colisionar con los `IdIPT_MovsDet` reales, que son numéricos) — el MISMO set `yaMigrados`
 * los salta en una 2ª corrida. OJO: cambiar la config de la ventana entre corridas contra la MISMA
 * BD no está soportado (los saldos previos quedarían de otro corte); recargar desde BD limpia.
 */
import {
  crearMovimientoIptMigrado,
  type MovimientoIptMigrado,
} from '../../src/dominio/inventarios/migracion.js';
import { DireccionMovimiento, type PrismaClient } from '../../src/datos/index.js';
import { ORIGEN } from '../../src/comun/origenes.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import { cargarMapaNumerico, ENTIDAD_MAPEO, type ClienteMapeo } from '../comun/mapeo.js';
import { conReintentoTransitorio } from '../comun/reintentos.js';
import type { Reporte } from '../comun/reporte.js';
import {
  AcumuladorSaldos,
  esPreCorte,
  observacionSaldoInicial,
  type SaldoCombo,
} from '../comun/saldo-inicial.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearEntero, parsearFecha, parsearTexto } from '../comun/valores.js';
import { describirVentana, resolverVentana, type ConfigVentana } from '../comun/ventana.js';
import type { ResultadoLoader } from './clientes.js';

/** Nombre/etiqueta del Color y la Talla SENTINELA (decisión (c)). Inactivos, reusados por todo IPT. */
export const COLOR_SENTINELA = '(sin especificar)';
export const TALLA_SENTINELA = '(sin especificar)';

/** `codigo` de los tipos de movimiento por defecto cuando el viejo no trae IdIPT_TipoMov (según EnSa). */
const COD_OTRAS_ENTRADAS = 'otras-entradas';
const COD_OTRAS_SALIDAS = 'otras-salidas';

/**
 * Posición (IdIPT_TiposMov 1..19) → `codigo` del seed canónico (TIPOS_MOVIMIENTO_BASE, en el mismo
 * orden que `IPT_TiposMov.csv`). El seed verifica esa correspondencia 1:1 contra el CSV en arranque,
 * así que aquí se replica como tabla estable (el ETL no lee el seed para no acoplarse a su orden).
 */
const CODIGO_POR_TIPO_VIEJO: Record<number, string> = {
  1: 'inventario-inicial',
  2: 'entrada-maquila',
  3: 'entrada-aplicacion',
  4: 'devolucion-nota-credito',
  5: 'entrega-cliente',
  6: 'salida-aplicacion',
  7: 'muestrario-ventas',
  8: 'salida-maquilero',
  9: 'transferencia-almacenes',
  10: 'recibo-muestrario',
  11: 'error-entrada',
  12: 'error-salida',
  13: 'venta-mostrador',
  14: 'ajuste-entrada',
  15: 'ajuste-salida',
  16: 'salida-laboratorio',
  17: 'salida-composturas',
  18: 'otras-salidas',
  19: 'otras-entradas',
};

/**
 * Dirección CANÓNICA de cada código (la misma del seed `TIPOS_MOVIMIENTO_BASE`). Permite decidir, sin
 * consultar la BD, si la dirección del tipo viejo casa con `EnSa` (la discordancia del tipo 9 'traspaso',
 * dir `traspaso`, es la única real en el dump). Mantener en sincronía con el seed (E1).
 */
const DIRECCION_POR_CODIGO: Record<string, DireccionMovimiento> = {
  'inventario-inicial': DireccionMovimiento.entrada,
  'entrada-maquila': DireccionMovimiento.entrada,
  'entrada-aplicacion': DireccionMovimiento.entrada,
  'devolucion-nota-credito': DireccionMovimiento.entrada,
  'entrega-cliente': DireccionMovimiento.salida,
  'salida-aplicacion': DireccionMovimiento.salida,
  'muestrario-ventas': DireccionMovimiento.salida,
  'salida-maquilero': DireccionMovimiento.salida,
  'transferencia-almacenes': DireccionMovimiento.traspaso,
  'recibo-muestrario': DireccionMovimiento.entrada,
  'error-entrada': DireccionMovimiento.salida,
  'error-salida': DireccionMovimiento.entrada,
  'venta-mostrador': DireccionMovimiento.salida,
  'ajuste-entrada': DireccionMovimiento.entrada,
  'ajuste-salida': DireccionMovimiento.salida,
  'salida-laboratorio': DireccionMovimiento.salida,
  'salida-composturas': DireccionMovimiento.salida,
  'otras-salidas': DireccionMovimiento.salida,
  'otras-entradas': DireccionMovimiento.entrada,
};

/** Combo de inventario PT del saldo inicial (color/talla son SIEMPRE el sentinela, decisión (c)). */
export interface ComboIpt {
  idEmpresa: number;
  idAlmacen: number;
  idModelo: number;
}

/** Clave estable del combo (también es la base del `origenId` del movimiento sintético). */
export function claveComboIpt(c: ComboIpt): string {
  return `e${String(c.idEmpresa)}:a${String(c.idAlmacen)}:m${String(c.idModelo)}`;
}

/**
 * `origenId` del movimiento SINTÉTICO de saldo inicial de un combo (con `origenTipo='migracion'`).
 * El prefijo `saldo-inicial:` garantiza no colisionar con los `IdIPT_MovsDet` reales (numéricos).
 */
export function origenIdSaldoInicialIpt(c: ComboIpt): string {
  return `saldo-inicial:${claveComboIpt(c)}`;
}

/** Resultado del loader de kardex IPT (resumen estándar + contadores propios). */
export interface ResultadoIptKardex {
  movimientos: ResultadoLoader;
  /** # de renglones de detalle (IPT_MovsDet) efectivamente migrados. */
  detallesMigrados: number;
  /** Σ de piezas migradas (suma de cantidades, sin signo). */
  piezas: number;
  /** # de movimientos cuya dirección NO casó con EnSa (se cargaron como Otras Entradas/Salidas). */
  direccionDiscordante: number;
  /** # de renglones con IdIPT_TipoMov 0/vacío (tipo derivado de EnSa). */
  tipoVacio: number;
  /** Configuración de la ventana temporal aplicada (para el reporte). */
  ventana: ConfigVentana;
  /** # de renglones PRE-CORTE condensados en saldos iniciales (0 con ventana inactiva). */
  renglonesCondensados: number;
  /** Movimientos SINTÉTICOS de saldo inicial (uno por combo con neto ≠ 0). */
  saldosIniciales: ResultadoLoader;
  /** # de combos cuyo neto pre-corte fue NEGATIVO (salida `otras-salidas`, listados). */
  saldosNegativos: number;
}

/** Tipo de movimiento del catálogo, resuelto por código (id + dirección). */
interface TipoMov {
  id: number;
  direccion: DireccionMovimiento;
}

/** Encabezado crudo de un IPT_Movs (ya parseado lo esencial). */
export interface MovCrudo {
  fecha: Date | null;
  idTipoMov: number | null;
  enSa: number | null;
  idAlmacenV1: string;
  referencia: string | null;
  obs: string | null;
  idRecibos: string | null;
}

/**
 * Upsert IDEMPOTENTE del Color/Talla SENTINELA (decisión (c)). Nacen INACTIVOS para que NO aparezcan
 * en los selectores de captura. Se hace por acceso DIRECTO a la tabla (no por `crearColor`/`crearTalla`,
 * que crean ACTIVOS y no expresan `activo:false`): el sentinela es un artefacto técnico de la
 * migración, no data de negocio capturable. Devuelve sus ids.
 */
export async function asegurarSentinelas(
  cliente: ClienteMapeo,
): Promise<{ idColor: number; idTalla: number }> {
  const color = await cliente.color.upsert({
    where: { nombre: COLOR_SENTINELA },
    update: {},
    create: { nombre: COLOR_SENTINELA, activo: false },
    select: { id: true },
  });
  const talla = await cliente.talla.upsert({
    where: { etiqueta: TALLA_SENTINELA },
    update: {},
    create: { etiqueta: TALLA_SENTINELA, orden: 0, activo: false },
    select: { id: true },
  });
  return { idColor: color.id, idTalla: talla.id };
}

export async function cargarIptKardex(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoIptKardex> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const ventana = resolverVentana();
  if (ventana.corte !== null) {
    reporte.nota(
      `${describirVentana(ventana)} Los movimientos IPT anteriores al corte se CONDENSAN en ` +
        `saldos iniciales por combo empresa×almacén×modelo (fecha = corte).`,
    );
  }

  // ── Sentinelas + catálogos de apoyo ────────────────────────────────────────────────────────
  const { idColor: idColorSentinela, idTalla: idTallaSentinela } =
    await asegurarSentinelas(cliente);
  reporte.nota(
    `Inventario PT (decisión c): cada movimiento histórico usa el Color/Talla SENTINELA ` +
      `"${COLOR_SENTINELA}" (INACTIVOS, no visibles en captura) — el viejo no tenía esa dimensión en IPT.`,
  );

  // Mapeos de fases previas.
  const mapaEmpresa = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.empresa);
  const mapaAlmacen = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.almacenIpt);
  const mapaModelo = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.modelo);

  // Tipos de movimiento por código (id + dirección), de una sola query.
  const tipoPorCodigo = new Map<string, TipoMov>();
  for (const t of await cliente.tipoMovimientoInventario.findMany({
    select: { id: true, codigo: true, direccion: true },
  })) {
    tipoPorCodigo.set(t.codigo, { id: t.id, direccion: t.direccion });
  }

  // Código de modelo de v2 → idModelo (para resolver IPT_Modelos.NumMod, que es el CÓDIGO).
  const idPorCodigoModelo = new Map<string, number>();
  for (const m of await cliente.modelo.findMany({ select: { id: true, codigo: true } })) {
    idPorCodigoModelo.set(m.codigo.trim().toUpperCase(), m.id);
  }

  // IPT_Modelos: IdIPT_Modelos → { codigo (NumMod), idEmpresaV1 }.
  const modeloV1PorId = new Map<string, { numMod: string; idEmpresaV1: string }>();
  for (const f of leerCsv('IPT_Modelos.csv')) {
    const id = (f.IdIPT_Modelos ?? '').trim();
    if (id === '') continue;
    modeloV1PorId.set(id, {
      numMod: (f.NumMod ?? '').trim().toUpperCase(),
      idEmpresaV1: (f.IdEmpresas ?? '').trim(),
    });
  }

  // IPT_Mod_Alm: IdIPT_Mod_Alm → { IdIPT_Modelos, IdIPT_Almacenes }.
  const modAlmPorId = new Map<string, { idModeloV1: string; idAlmacenV1: string }>();
  for (const f of leerCsv('IPT_Mod_Alm.csv')) {
    const id = (f.IdIPT_Mod_Alm ?? '').trim();
    if (id === '') continue;
    modAlmPorId.set(id, {
      idModeloV1: (f.IdIPT_Modelos ?? '').trim(),
      idAlmacenV1: (f.IdIPT_Almacenes ?? '').trim(),
    });
  }

  // IPT_Movs: IdIPT_Movs → encabezado crudo.
  const movPorId = new Map<string, MovCrudo>();
  for (const f of leerCsv('IPT_Movs.csv')) {
    const id = (f.IdIPT_Movs ?? '').trim();
    if (id === '') continue;
    movPorId.set(id, {
      fecha: parsearFecha(f.Fecha),
      idTipoMov: parsearEntero(f.IdIPT_TipoMov),
      enSa: parsearEntero(f.EnSa),
      idAlmacenV1: (f.IdIPT_Almacenes ?? '').trim(),
      referencia: parsearTexto(f.Referencia),
      obs: parsearTexto(f.ObsMovs),
      idRecibos: parsearTexto(f.IdRecibos),
    });
  }

  // Idempotencia: origenId (IdIPT_MovsDet) ya migrados (origenTipo='migracion').
  const yaMigrados = new Set<string>();
  for (const m of await cliente.movimiento.findMany({
    where: { origenTipo: ORIGEN.migracion },
    select: { origenId: true },
  })) {
    if (m.origenId !== null) yaMigrados.add(m.origenId);
  }

  const resultado: ResultadoIptKardex = {
    movimientos: { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 },
    detallesMigrados: 0,
    piezas: 0,
    direccionDiscordante: 0,
    tipoVacio: 0,
    ventana,
    renglonesCondensados: 0,
    saldosIniciales: { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 },
    saldosNegativos: 0,
  };

  const detalles = leerCsv('IPT_MovsDet.csv');
  const contexto: ContextoIpt = {
    sesion,
    cliente,
    bd,
    reporte,
    ventana,
    acumulador: new AcumuladorSaldos<ComboIpt>(),
    idColorSentinela,
    idTallaSentinela,
    mapaEmpresa,
    mapaAlmacen,
    mapaModelo,
    tipoPorCodigo,
    idPorCodigoModelo,
    modeloV1PorId,
    modAlmPorId,
    movPorId,
    yaMigrados,
  };

  const contribs = await enLotes(
    detalles,
    (f): Promise<ContribDet> => conReintentoTransitorio(() => procesarDetalle(contexto, f)),
    CONCURRENCIA_ETL,
  );

  for (const res of contribs) {
    if (!res.ok) {
      resultado.movimientos.omitidosValidacion =
        (resultado.movimientos.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const c = res.valor;
    if (c.estado === 'creado') {
      resultado.movimientos.creados += 1;
      resultado.detallesMigrados += 1;
      resultado.piezas += c.piezas;
      if (c.direccionDiscordante) resultado.direccionDiscordante += 1;
      if (c.tipoVacio) resultado.tipoVacio += 1;
    } else if (c.estado === 'existente') {
      resultado.movimientos.existentes += 1;
    } else if (c.estado === 'condensado') {
      resultado.renglonesCondensados += 1;
      if (c.direccionDiscordante) resultado.direccionDiscordante += 1;
      if (c.tipoVacio) resultado.tipoVacio += 1;
    } else if (c.estado === 'omitido') {
      resultado.movimientos.omitidos += 1;
    } else {
      resultado.movimientos.omitidosValidacion =
        (resultado.movimientos.omitidosValidacion ?? 0) + 1;
    }
  }

  // ── SALDOS INICIALES (solo con ventana activa): un movimiento sintético por combo ────────────
  await crearSaldosIniciales(contexto, resultado);

  return resultado;
}

/**
 * Crea los movimientos SINTÉTICOS de saldo inicial (uno por combo con neto ≠ 0), con fecha = corte.
 * Con ventana INACTIVA o sin renglones condensados, no hace nada (comportamiento de siempre).
 * Idempotente: el `origenId` sintético vive en el MISMO set `yaMigrados` (origenTipo='migracion').
 */
async function crearSaldosIniciales(
  ctx: ContextoIpt,
  resultado: ResultadoIptKardex,
): Promise<void> {
  const corte = ctx.ventana.corte;
  if (corte === null || ctx.acumulador.combos === 0) return;

  const saldos = ctx.acumulador.saldos();
  const combosEnCero = saldos.filter((s) => s.neto === 0).length;
  const conNeto = saldos.filter((s) => s.neto !== 0);

  const res = await enLotes(
    conNeto,
    (s) => conReintentoTransitorio(() => crearUnSaldoInicial(ctx, corte, s)),
    CONCURRENCIA_ETL,
  );
  for (const r of res) {
    if (!r.ok) {
      resultado.saldosIniciales.omitidosValidacion =
        (resultado.saldosIniciales.omitidosValidacion ?? 0) + 1;
      continue;
    }
    if (r.valor.estado === 'creado') resultado.saldosIniciales.creados += 1;
    else if (r.valor.estado === 'existente') resultado.saldosIniciales.existentes += 1;
    else
      resultado.saldosIniciales.omitidosValidacion =
        (resultado.saldosIniciales.omitidosValidacion ?? 0) + 1;
    if (r.valor.negativo) resultado.saldosNegativos += 1;
  }

  ctx.reporte.nota(
    `IPT ventana: ${String(ctx.acumulador.renglones)} renglones pre-corte condensados en ` +
      `${String(ctx.acumulador.combos)} combos (empresa×almacén×modelo) → saldos iniciales ` +
      `creados=${String(resultado.saldosIniciales.creados)} ` +
      `existentes=${String(resultado.saldosIniciales.existentes)} ` +
      `netoNegativo=${String(resultado.saldosNegativos)} ` +
      `netoCero(sin movimiento)=${String(combosEnCero)}.`,
  );
}

/** Crea (idempotente) el movimiento sintético de UN combo. Neto > 0 entrada; < 0 salida por |neto|. */
async function crearUnSaldoInicial(
  ctx: ContextoIpt,
  corte: Date,
  s: SaldoCombo<ComboIpt>,
): Promise<{ estado: 'creado' | 'existente' | 'omitidoValidacion'; negativo: boolean }> {
  const negativo = s.neto < 0;
  const origenId = origenIdSaldoInicialIpt(s.datos);
  if (ctx.yaMigrados.has(origenId)) {
    return { estado: 'existente', negativo };
  }
  const codigo = negativo ? COD_OTRAS_SALIDAS : 'inventario-inicial';
  const tipo = ctx.tipoPorCodigo.get(codigo);
  if (tipo === undefined) {
    ctx.reporte.agregar(
      `IPT saldo inicial: falta el tipo "${codigo}" en el catálogo (re-sembrar) — combo OMITIDO`,
      `combo=${s.clave} neto=${String(s.neto)}`,
    );
    return { estado: 'omitidoValidacion', negativo };
  }
  if (negativo) {
    ctx.reporte.agregar(
      'IPT saldo inicial NEGATIVO (condensado como salida `otras-salidas` — descuadre del viejo)',
      `combo=${s.clave} neto=${String(s.neto)} (entradas=${String(s.entradas)} salidas=${String(s.salidas)} renglones=${String(s.renglones)})`,
    );
  }
  const entrada: MovimientoIptMigrado = {
    idEmpresa: s.datos.idEmpresa,
    idTipoMov: tipo.id,
    idAlmacen: s.datos.idAlmacen,
    idModelo: s.datos.idModelo,
    idColorSentinela: ctx.idColorSentinela,
    idTallaSentinela: ctx.idTallaSentinela,
    cantidad: Math.abs(s.neto),
    fecha: corte,
    origenId,
    observaciones: observacionSaldoInicial(
      `${String(s.entradas)} entradas − ${String(s.salidas)} salidas en ${String(s.renglones)} renglones de IPT_MovsDet`,
    ),
  };
  const idMovimiento = await intentarCrear(ctx.reporte, 'SaldoInicialIPT', s.clave, () =>
    crearMovimientoIptMigrado(ctx.sesion, entrada, ctx.bd),
  );
  if (idMovimiento === null) {
    return { estado: 'omitidoValidacion', negativo };
  }
  ctx.yaMigrados.add(origenId);
  return { estado: 'creado', negativo };
}

/** Todo lo que necesita `procesarDetalle` (resuelto una sola vez). */
interface ContextoIpt {
  sesion: SesionUsuario;
  cliente: ClienteMapeo;
  bd: ContextoBd;
  reporte: Reporte;
  /** Ventana temporal de la corrida (resuelta UNA vez; default inactiva). */
  ventana: ConfigVentana;
  /** Acumulador de renglones pre-corte por combo (solo se llena con ventana activa). */
  acumulador: AcumuladorSaldos<ComboIpt>;
  idColorSentinela: number;
  idTallaSentinela: number;
  mapaEmpresa: Map<string, number>;
  mapaAlmacen: Map<string, number>;
  mapaModelo: Map<string, number>;
  tipoPorCodigo: Map<string, TipoMov>;
  idPorCodigoModelo: Map<string, number>;
  modeloV1PorId: Map<string, { numMod: string; idEmpresaV1: string }>;
  modAlmPorId: Map<string, { idModeloV1: string; idAlmacenV1: string }>;
  movPorId: Map<string, MovCrudo>;
  yaMigrados: Set<string>;
}

/** Contribución de UN renglón IPT_MovsDet a los conteos (`condensado` = pre-corte, va al saldo). */
interface ContribDet {
  estado: 'creado' | 'existente' | 'omitido' | 'omitidoValidacion' | 'condensado';
  piezas: number;
  direccionDiscordante: boolean;
  tipoVacio: boolean;
}

const SIN = (estado: ContribDet['estado']): ContribDet => ({
  estado,
  piezas: 0,
  direccionDiscordante: false,
  tipoVacio: false,
});

/**
 * Decisión PURA del CÓDIGO de tipo de movimiento de v2 para un renglón (sin tocar BD), a partir del
 * `IdIPT_TipoMov` viejo y el `EnSa`:
 *  • Tipo 1..19 conocido cuya dirección CASA con EnSa → su código (caso normal).
 *  • Tipo 0/vacío → "Otras Entradas/Salidas" según EnSa (`vacio=true`).
 *  • Tipo desconocido o cuya dirección NO casa con EnSa (p. ej. el 9 'traspaso', dir 3) → "Otras
 *    Entradas/Salidas" según EnSa (`discordante=true`).
 *  • EnSa inválido y se necesita el fallback → `null` (irresoluble; el llamador omite).
 *
 * `direccionDeCodigo` es la dirección CANÓNICA del seed (la misma que el ETL espera en BD): permite
 * decidir la discordancia sin consultar el catálogo. Devuelve el `codigo` final + banderas de reporte.
 */
export function tipoDestino(
  idTipoMov: number | null,
  enSa: number | null,
): { codigo: string; discordante: boolean; vacio: boolean } | null {
  const codPorEnSa = enSa === 1 ? COD_OTRAS_ENTRADAS : enSa === 2 ? COD_OTRAS_SALIDAS : null;
  const dirEsperada =
    enSa === 1 ? DireccionMovimiento.entrada : enSa === 2 ? DireccionMovimiento.salida : null;

  // Tipo vacío/0 (464 filas del viejo): usar el de EnSa.
  if (idTipoMov === null || idTipoMov === 0) {
    return codPorEnSa === null ? null : { codigo: codPorEnSa, discordante: false, vacio: true };
  }

  const codigo = CODIGO_POR_TIPO_VIEJO[idTipoMov];
  if (codigo === undefined) {
    // Tipo desconocido: usar el de EnSa.
    return codPorEnSa === null ? null : { codigo: codPorEnSa, discordante: true, vacio: false };
  }

  // Si la dirección canónica del tipo NO casa con EnSa (p. ej. tipo 9 = traspaso, dir 3): cae a EnSa.
  const dirCanonica = DIRECCION_POR_CODIGO[codigo];
  if (dirEsperada !== null && dirCanonica !== dirEsperada && codPorEnSa !== null) {
    return { codigo: codPorEnSa, discordante: true, vacio: false };
  }

  return { codigo, discordante: false, vacio: false };
}

/**
 * SIGNO (+1 entrada / −1 salida / 0 irresoluble o traspaso) que el ETL aplicaría a un renglón
 * IPT, con LA MISMA regla que la carga real: dirección canónica del TIPO destino (vía
 * {@link tipoDestino}); el `EnSa` solo decide en tipos vacíos/discordantes. Lo usa el prescan
 * de USO (`comun/prescan-uso.ts`) para que su neto pre-corte no diverja del ETL.
 */
export function signoMovimientoIpt(idTipoMov: number | null, enSa: number | null): number {
  const destino = tipoDestino(idTipoMov, enSa);
  if (destino === null) return 0;
  const direccion = DIRECCION_POR_CODIGO[destino.codigo];
  if (direccion === DireccionMovimiento.entrada) return 1;
  if (direccion === DireccionMovimiento.salida) return -1;
  return 0;
}

/**
 * Resuelve el tipo de movimiento de v2 (id + dirección reales del catálogo) para un renglón: aplica
 * {@link tipoDestino} (decisión pura) y luego busca el id por código en el catálogo ya cargado. `null`
 * si es irresoluble o si el código resultante no existe en el catálogo (raro: faltaría re-seed).
 */
function resolverTipo(
  ctx: ContextoIpt,
  idTipoMov: number | null,
  enSa: number | null,
): { tipo: TipoMov; discordante: boolean; vacio: boolean } | null {
  const destino = tipoDestino(idTipoMov, enSa);
  if (destino === null) return null;
  const tipo = ctx.tipoPorCodigo.get(destino.codigo);
  return tipo === undefined
    ? null
    : { tipo, discordante: destino.discordante, vacio: destino.vacio };
}

/** Procesa UN renglón IPT_MovsDet → un Movimiento (idempotente, tolerante). */
async function procesarDetalle(ctx: ContextoIpt, f: Record<string, string>): Promise<ContribDet> {
  const idDet = (f.IdIPT_MovsDet ?? '').trim();
  if (idDet === '') {
    ctx.reporte.agregar('IPT_MovsDet sin IdIPT_MovsDet (omitido)', JSON.stringify(f).slice(0, 120));
    return SIN('omitido');
  }

  // Idempotencia.
  if (ctx.yaMigrados.has(idDet)) {
    return SIN('existente');
  }

  const idMovV1 = (f.IdIPT_Movs ?? '').trim();
  const idModAlmV1 = (f.IdIPT_Mod_Alm ?? '').trim();
  const cantidad = parsearEntero(f.CantMov);

  if (cantidad === null || cantidad <= 0) {
    ctx.reporte.agregar(
      'IPT_MovsDet con cantidad ≤ 0 o no numérica (omitido)',
      `IdIPT_MovsDet=${idDet} CantMov="${f.CantMov ?? ''}"`,
    );
    return SIN('omitido');
  }

  const mov = ctx.movPorId.get(idMovV1);
  if (mov === undefined) {
    ctx.reporte.agregar(
      'IPT_MovsDet sin IPT_Movs (encabezado) mapeable (omitido)',
      `IdIPT_MovsDet=${idDet} IdIPT_Movs=${idMovV1}`,
    );
    return SIN('omitido');
  }

  const modAlm = ctx.modAlmPorId.get(idModAlmV1);
  if (modAlm === undefined) {
    ctx.reporte.agregar(
      'IPT_MovsDet sin IPT_Mod_Alm mapeable (omitido)',
      `IdIPT_MovsDet=${idDet} IdIPT_Mod_Alm=${idModAlmV1}`,
    );
    return SIN('omitido');
  }

  // Modelo: IdIPT_Modelos → NumMod (=código v2) → idModelo.
  const modeloV1 = ctx.modeloV1PorId.get(modAlm.idModeloV1);
  if (modeloV1 === undefined) {
    ctx.reporte.agregar(
      'IPT_Mod_Alm con IdIPT_Modelos sin IPT_Modelos (omitido)',
      `IdIPT_MovsDet=${idDet} IdIPT_Modelos=${modAlm.idModeloV1}`,
    );
    return SIN('omitido');
  }
  const idModelo = ctx.idPorCodigoModelo.get(modeloV1.numMod);
  if (idModelo === undefined) {
    ctx.reporte.agregar(
      'Modelo de IPT sin match por código (NumMod) en v2 (omitido)',
      `IdIPT_MovsDet=${idDet} NumMod="${modeloV1.numMod}"`,
    );
    return SIN('omitido');
  }

  // Empresa = empresa del MODELO viejo (IPT_Modelos.IdEmpresas → mapeo Empresa).
  const idEmpresa = ctx.mapaEmpresa.get(modeloV1.idEmpresaV1);
  if (idEmpresa === undefined) {
    ctx.reporte.agregar(
      'IPT: empresa del modelo sin mapeo — movimiento OMITIDO (empresa inactiva/0 no migrada)',
      `IdIPT_MovsDet=${idDet} NumMod="${modeloV1.numMod}" IdEmpresas=${modeloV1.idEmpresaV1}`,
    );
    return SIN('omitido');
  }

  // Almacén: IPT_Movs.IdIPT_Almacenes → mapeo Almacen:IPT (el del encabezado manda).
  const idAlmacen = ctx.mapaAlmacen.get(mov.idAlmacenV1);
  if (idAlmacen === undefined) {
    ctx.reporte.agregar(
      'IPT: almacén del movimiento sin mapeo (omitido)',
      `IdIPT_MovsDet=${idDet} IdIPT_Almacenes=${mov.idAlmacenV1}`,
    );
    return SIN('omitido');
  }

  // Tipo de movimiento + dirección.
  const resTipo = resolverTipo(ctx, mov.idTipoMov, mov.enSa);
  if (resTipo === null) {
    ctx.reporte.agregar(
      'IPT: tipo de movimiento irresoluble (sin tipo y sin EnSa válido) (omitido)',
      `IdIPT_MovsDet=${idDet} IdIPT_TipoMov=${String(mov.idTipoMov)} EnSa=${String(mov.enSa)}`,
    );
    return SIN('omitido');
  }
  if (resTipo.discordante) {
    ctx.reporte.agregar(
      'IPT: dirección del tipo viejo NO casa con EnSa (cargado como Otras Entradas/Salidas por EnSa)',
      `IdIPT_MovsDet=${idDet} IdIPT_TipoMov=${String(mov.idTipoMov)} EnSa=${String(mov.enSa)}`,
    );
  }
  if (resTipo.vacio) {
    ctx.reporte.agregar(
      'IPT: IdIPT_TipoMov 0/vacío (tipo derivado de EnSa: Otras Entradas/Salidas)',
      `IdIPT_MovsDet=${idDet} EnSa=${String(mov.enSa)}`,
    );
  }

  // Fecha: si el viejo no trae fecha parseable, se reporta y se usa la del movimiento o, en último
  // caso, una fecha cero histórica — NUNCA now() (no inventar una fecha de hoy en un dato histórico).
  let fecha = mov.fecha;
  if (fecha === null) {
    ctx.reporte.agregar(
      'IPT_Movs sin fecha parseable (se usa 1900-01-01 como marcador histórico)',
      `IdIPT_MovsDet=${idDet} IdIPT_Movs=${idMovV1}`,
    );
    fecha = new Date(Date.UTC(1900, 0, 1));
  }

  // ── Ventana temporal: renglón PRE-CORTE → se ACUMULA al saldo inicial de su combo ────────────
  // Solo llega aquí lo que SE HABRÍA migrado (todas las validaciones de arriba ya pasaron); lo que
  // hoy se omite por datos inválidos NO entra al neto. La fecha sin parsear cayó al marcador 1900
  // (histórico) → también se condensa. Rareza: un tipo con dirección `traspaso` (EnSa inválido +
  // tipo 9) sigue el camino individual — el motor lo rechaza y queda listado, igual que hoy.
  if (esPreCorte(fecha, ctx.ventana) && resTipo.tipo.direccion !== DireccionMovimiento.traspaso) {
    const combo: ComboIpt = { idEmpresa, idAlmacen, idModelo };
    ctx.acumulador.agregar(
      claveComboIpt(combo),
      combo,
      resTipo.tipo.direccion === DireccionMovimiento.entrada ? 'entrada' : 'salida',
      cantidad,
    );
    return {
      estado: 'condensado',
      piezas: cantidad,
      direccionDiscordante: resTipo.discordante,
      tipoVacio: resTipo.vacio,
    };
  }

  const observaciones = construirObservaciones(mov);

  const entrada: MovimientoIptMigrado = {
    idEmpresa,
    idTipoMov: resTipo.tipo.id,
    idAlmacen,
    idModelo,
    idColorSentinela: ctx.idColorSentinela,
    idTallaSentinela: ctx.idTallaSentinela,
    cantidad,
    fecha,
    origenId: idDet,
    ...(observaciones === null ? {} : { observaciones }),
  };

  const idMovimiento = await intentarCrear(ctx.reporte, 'MovimientoIPT', idDet, () =>
    crearMovimientoIptMigrado(ctx.sesion, entrada, ctx.bd),
  );
  if (idMovimiento === null) {
    return SIN('omitidoValidacion');
  }
  ctx.yaMigrados.add(idDet);

  return {
    estado: 'creado',
    piezas: cantidad,
    direccionDiscordante: resTipo.discordante,
    tipoVacio: resTipo.vacio,
  };
}

/** Texto informativo del movimiento: obs + referencia + el IdRecibos como traza (NO FK ni efecto). */
export function construirObservaciones(mov: MovCrudo): string | null {
  const partes: string[] = [];
  if (mov.obs !== null) partes.push(mov.obs);
  if (mov.referencia !== null && mov.referencia !== mov.obs) partes.push(`Ref: ${mov.referencia}`);
  if (mov.idRecibos !== null) partes.push(`[v1 IdRecibos=${mov.idRecibos}]`);
  const texto = partes.join(' · ').trim();
  return texto === '' ? null : texto.slice(0, 1000);
}
