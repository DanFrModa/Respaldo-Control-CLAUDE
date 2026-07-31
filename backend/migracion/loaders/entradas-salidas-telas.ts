/**
 * Loader del KARDEX de TELAS histórico (F4-E6, Pieza B) — migra el inventario real de telas del
 * sistema viejo al kardex único de v2 (D3), vía el MODO MIGRACIÓN del dominio (A1). Fuentes (CP850):
 *
 *   `Entradas.csv` (8,017)      → encabezado de cada entrada (Fecha, Factura, Referencia, IdTela)
 *   `EntradasDet.csv` (11,041)  → renglones (IdTelasColAlm + TelaEnt1/TelaEnt2 + Peso)
 *   `Salidas.csv` (16,525)      → encabezado de cada salida (IdOrdenes, IdTela, Fecha, Referencia)
 *   `SalidasDet.csv` (22,734)   → renglones (IdTelasColAlm + TelaSal1/TelaSal2)
 *   `TelasColAlm.csv` (113,219) → IdTelasColAlm → (IdTelasColores, IdAlmacenes, ExTela1, ExTela2)
 *   `TelasColores.csv` (4,566)  → IdTelasColores → (IdTelas, Color, Precio)
 *
 * CLASIFICACIÓN (ficha F4-E6):
 *  (a) PARES DE TRASPASO legacy: Entrada `Factura='Transferencia'` + su Salida gemela (sin
 *      `IdOrdenes`) → un movimiento `traspaso` (salida origen + entrada destino, A2). El emparejado
 *      es DETERMINISTA por firma de detalle (ver `comun/pares-traspaso-tela.ts`).
 *  (b) ENTRADAS DE COMPRA (resto de Entradas) → entrada DIRECTA al kardex SIN crear
 *      `RecepcionCompra` (el viejo no liga entrada↔OC; `RecepcionCompra` queda para v2). Tipo
 *      `entrada-recepcion`. El `Precio` de `TelasColores` → `costoUnit` del movimiento (D1).
 *  (c) SALIDAS con `IdOrdenes` → salida ligada a la orden (`origenTipo='salida-tela-orden'`,
 *      `origenId=idOrden`), tipo `salida-a-orden`, empresa = la de la orden.
 *  (d) SALIDAS restantes (sin orden y NO pata de traspaso) → se migran como `ajuste-salida` (para
 *      preservar la existencia D3) y se LISTAN en el reporte; NO se inventa liga a orden alguna.
 *
 * LOTES legacy (decisión (f) de Daniel): el viejo NO tenía lotes (la existencia era por
 * tela×color×almacén, `TelasColAlm`). Para que v2 (existencia por tela×lote×almacén, D5) cuadre con
 * el viejo, se sintetiza UN lote por COLOR (`IdTelasColores`): la PRIMERA entrada de ese color lo
 * materializa (factura/proveedor/fecha de esa entrada) y TODAS las entradas/salidas de ese color lo
 * reusan. Clave determinista `LEGACY-TELA-<IdTelasColores>` (idempotente). El componente del lote es
 * la tela parent (v2 unificó los dos componentes Texto1/Texto2 en una sola `Tela`, ADR-0009): por eso
 * cada renglón mueve `TelaEnt1+TelaEnt2` (suma) como cantidad de esa tela; el desglose va a las
 * observaciones. (Reconciliación de la decisión (f) documentada en el reporte de cierre.)
 *
 * Idempotencia: por `MapeoMigracion` (IdEntradasDet/IdSalidasDet/clave-de-par → Movimiento.id) y por
 * `Movimiento.origenId`. Carga POR LOTES (`enLotes` + `conReintentoTransitorio`): cada DOCUMENTO (o
 * par de traspaso) es una unidad atómica A2. Los lotes legacy y los catálogos se PRE-RESUELVEN antes
 * del bucle concurrente (el bucle solo LEE; nunca crea un lote al vuelo → sin carreras en el unique).
 *
 * VENTANA TEMPORAL (default INACTIVA = comportamiento idéntico al de siempre): antes, con ventana
 * activa, los documentos pre-corte solo se OMITÍAN → las existencias (D3, suma de movimientos)
 * quedaban MAL. Ahora los docs pre-corte se CONDENSAN: sus renglones se ACUMULAN en memoria por la
 * combinación de inventario del kardex de telas (tela×lote×almacén — el lote legacy es 1:1 con el
 * color viejo `IdTelasColores`, así que el combo preserva tela×color×almacén del viejo) con signo
 * según el tipo de documento; un TRASPASO pre-corte resta en el almacén ORIGEN y suma en el DESTINO.
 * Al final se crea UN movimiento sintético por combo con fecha = corte: neto > 0 →
 * `inventario-inicial` (entrada, costo del `TelasColores.Precio` del color); neto < 0 →
 * `ajuste-salida` por |neto| (incidencia listada); neto 0 → nada. Solo entra al neto lo que SE
 * HABRÍA migrado (renglones sin tela/lote/almacén mapeable siguen omitiéndose y listándose).
 * Idempotencia de los sintéticos: `origenTipo='migracion'` +
 * `origenId='saldo-inicial-tela:t<tela>:l<lote>:a<almacén>'` (no colisiona con los origenId de
 * documentos, que llevan prefijos `EntradasDet:`/`SalidasDet:`/`Traspaso:`) — el MISMO set
 * `origenIdsTela` los salta en una 2ª corrida. La EMPRESA del sintético es la default (la existencia
 * por almacén no depende de la empresa; solo numera el folio). OJO: cambiar la config de la ventana
 * entre corridas contra la MISMA BD no está soportado; recargar desde BD limpia.
 */
import {
  asegurarLoteLegacyTela,
  crearMovimientoTelaMigrado,
  crearTraspasoTelaMigrado,
  enTransaccion,
} from '../../src/dominio/inventarios/migracion.js';
import { ORIGEN } from '../../src/comun/origenes.js';
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
import {
  emparejarTraspasos,
  type DocumentoTela,
  type RenglonDetalleTela,
} from '../comun/pares-traspaso-tela.js';
import { conReintentoTransitorio } from '../comun/reintentos.js';
import type { Reporte } from '../comun/reporte.js';
import {
  AcumuladorSaldos,
  esPreCorte,
  observacionSaldoInicial,
  type DireccionSaldo,
} from '../comun/saldo-inicial.js';
import { intentarCrear } from '../comun/saneo.js';
import { resolverVentana, type ConfigVentana } from '../comun/ventana.js';
import { parsearDinero, parsearFechaSoloDia, parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

/** Códigos estables de los tipos de movimiento de tela que el ETL resuelve por nombre. */
const COD_ENTRADA_COMPRA = 'entrada-recepcion';
const COD_SALIDA_A_ORDEN = 'salida-a-orden';
const COD_AJUSTE_SALIDA = 'ajuste-salida';
const COD_TRANSFERENCIA_SALIDA = 'transferencia-salida';
const COD_TRANSFERENCIA_ENTRADA = 'transferencia-entrada';

/** Prefijo de la clave determinista del lote legacy (uno por IdTelasColores). */
const PREFIJO_LOTE_LEGACY = 'LEGACY-TELA';

/** Tipo de la ENTRADA sintética de saldo inicial (el más natural del seed para "saldo de arranque"). */
const COD_INVENTARIO_INICIAL = 'inventario-inicial';

/** Combo de inventario del kardex de telas para el saldo inicial (tela×lote×almacén, D5). */
export interface ComboTela {
  idTela: number;
  idLote: number;
  idAlmacen: number;
}

/** Clave estable del combo (ordena el volcado; base del `origenId` sintético). */
export function claveComboTela(c: ComboTela): string {
  return `t${String(c.idTela)}:l${String(c.idLote)}:a${String(c.idAlmacen)}`;
}

/** `origenId` del movimiento SINTÉTICO de saldo inicial de un combo de telas. */
export function origenIdSaldoInicialTela(c: ComboTela): string {
  return `saldo-inicial-tela:${claveComboTela(c)}`;
}

/** Redondea un neto de tela a 4 decimales (la precisión del kardex, Decimal(14,4)). */
function redondear4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Documentos pre-corte CONDENSADOS (no migrados individuales), por clase. */
export interface DocsCondensados {
  entradas: number;
  salidas: number;
  traspasos: number;
}

/** Resultado del loader de kardex de telas (resumen + contadores propios de la clasificación). */
export interface ResultadoTelasKardex {
  /** Entradas de compra (b) migradas como movimientos de entrada directa. */
  entradasCompra: ResultadoLoader;
  /** Salidas a orden (c) migradas. */
  salidasOrden: ResultadoLoader;
  /** Salidas sin clasificar (d) migradas como ajuste-salida. */
  salidasSinClasificar: ResultadoLoader;
  /** Pares de traspaso (a) migrados. */
  traspasos: ResultadoLoader;
  /** Pares de traspaso detectados (deterministas) en esta corrida. */
  paresDetectados: number;
  /** Entradas 'Transferencia' que no encontraron salida gemela (reportadas). */
  entradasTransferenciaSinPar: number;
  /** Lotes legacy sintetizados (uno por color tocado). */
  lotesLegacy: number;
  /** Configuración de la ventana temporal aplicada (para el reporte). */
  ventana: ConfigVentana;
  /** Docs pre-corte condensados al saldo inicial (0 en todo con ventana inactiva). */
  docsCondensados: DocsCondensados;
  /** # de renglones pre-corte acumulados en los combos. */
  renglonesCondensados: number;
  /** Movimientos SINTÉTICOS de saldo inicial (uno por combo tela×lote×almacén con neto ≠ 0). */
  saldosIniciales: ResultadoLoader;
  /** # de combos cuyo neto pre-corte fue NEGATIVO (salida `ajuste-salida`, listados). */
  saldosNegativos: number;
}

/** Una fila de detalle ya normalizada con su color/almacén resueltos. */
interface RenglonResuelto {
  idTelasColAlm: string;
  idTelasColores: string;
  idAlmacenV1: string;
  cant1: number;
  cant2: number;
}

/** Un documento (entrada o salida) ya resuelto: cabecera + renglones con cantidades numéricas. */
interface DocResuelto {
  id: string;
  fecha: Date | null;
  idTelaV1: string;
  factura: string | null;
  referencia: string | null;
  idOrdenV1: string | null;
  renglones: RenglonResuelto[];
}

const RES_VACIO = (): ResultadoLoader => ({
  creados: 0,
  existentes: 0,
  omitidos: 0,
  omitidosValidacion: 0,
});

export async function cargarTelasKardex(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  idEmpresaDefecto: number,
): Promise<ResultadoTelasKardex> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const ventana = resolverVentana();
  if (ventana.corte !== null) {
    reporte.nota(
      'Telas ventana: los documentos anteriores al corte se CONDENSAN en saldos iniciales por ' +
        'combo tela×lote×almacén (fecha = corte); los traspasos pre-corte restan en el origen y ' +
        'suman en el destino.',
    );
  }

  // ── Mapeos de fases previas ──────────────────────────────────────────────────────────────────
  const mapaTela = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.telaPorIdTelas);
  const mapaColor = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.color);
  const mapaAlmacen = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.almacenTela);
  const mapaOrden = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.orden);

  // Empresa de cada orden (para las salidas ligadas a orden, A9): una sola query.
  const empresaPorOrden = new Map<number, number>();
  for (const o of await cliente.orden.findMany({ select: { id: true, idEmpresa: true } })) {
    empresaPorOrden.set(o.id, o.idEmpresa);
  }

  // Tipos de movimiento por código (id) — una query.
  const idTipoPorCodigo = new Map<string, number>();
  for (const t of await cliente.tipoMovimientoInventario.findMany({
    select: { id: true, codigo: true },
  })) {
    idTipoPorCodigo.set(t.codigo, t.id);
  }
  const idEntradaCompra = exigirTipo(idTipoPorCodigo, COD_ENTRADA_COMPRA);
  const idSalidaOrden = exigirTipo(idTipoPorCodigo, COD_SALIDA_A_ORDEN);
  const idAjusteSalida = exigirTipo(idTipoPorCodigo, COD_AJUSTE_SALIDA);
  const idTransfSalida = exigirTipo(idTipoPorCodigo, COD_TRANSFERENCIA_SALIDA);
  const idTransfEntrada = exigirTipo(idTipoPorCodigo, COD_TRANSFERENCIA_ENTRADA);

  // ── Catálogos legacy en memoria ──────────────────────────────────────────────────────────────
  // TelasColAlm: IdTelasColAlm → (IdTelasColores, IdAlmacenes). (113k filas: solo lo necesario.)
  const colAlmPorId = new Map<string, { idTelasColores: string; idAlmacenV1: string }>();
  for (const f of leerCsv('TelasColAlm.csv')) {
    const id = (f.IdTelasColAlm ?? '').trim();
    if (id === '') continue;
    colAlmPorId.set(id, {
      idTelasColores: (f.IdTelasColores ?? '').trim(),
      idAlmacenV1: (f.IdAlmacenes ?? '').trim(),
    });
  }
  // TelasColores: IdTelasColores → (IdTelas, Color, Precio).
  const coloresPorId = new Map<
    string,
    { idTelasV1: string; color: string; precio: number | null }
  >();
  for (const f of leerCsv('TelasColores.csv')) {
    const id = (f.IdTelasColores ?? '').trim();
    if (id === '') continue;
    coloresPorId.set(id, {
      idTelasV1: (f.IdTelas ?? '').trim(),
      color: (f.Color ?? '').trim(),
      precio: parsearDinero(f.Precio),
    });
  }

  // ── Resolver documentos (entradas y salidas) con sus renglones ───────────────────────────────
  const detEntradasPorDoc = agruparDetalle('EntradasDet.csv', 'IdEntradas', 'TelaEnt1', 'TelaEnt2');
  const detSalidasPorDoc = agruparDetalle('SalidasDet.csv', 'IdSalidas', 'TelaSal1', 'TelaSal2');

  const entradas: DocResuelto[] = [];
  for (const f of leerCsv('Entradas.csv')) {
    const id = (f.IdEntradas ?? '').trim();
    if (id === '') continue;
    entradas.push({
      id,
      fecha: parsearFechaSoloDia(f.Fecha),
      idTelaV1: (f.IdTela ?? '').trim(),
      factura: parsearTexto(f.Factura),
      referencia: parsearTexto(f.Referencia),
      idOrdenV1: null,
      renglones: resolverRenglones(detEntradasPorDoc.get(id) ?? [], colAlmPorId, coloresPorId),
    });
  }

  const salidas: DocResuelto[] = [];
  for (const f of leerCsv('Salidas.csv')) {
    const id = (f.IdSalidas ?? '').trim();
    if (id === '') continue;
    const idOrden = (f.IdOrdenes ?? '').trim();
    salidas.push({
      id,
      fecha: parsearFechaSoloDia(f.Fecha),
      idTelaV1: (f.IdTela ?? '').trim(),
      factura: null,
      referencia: parsearTexto(f.Referencia),
      idOrdenV1: idOrden === '' || idOrden === '0' ? null : idOrden,
      renglones: resolverRenglones(detSalidasPorDoc.get(id) ?? [], colAlmPorId, coloresPorId),
    });
  }

  // ── (a) Emparejar PARES DE TRASPASO (entradas 'Transferencia' ↔ salidas sin orden) ───────────
  const entradasTransf = entradas.filter((e) => esTransferencia(e.factura));
  const salidasSinOrden = salidas.filter((s) => s.idOrdenV1 === null);
  const { pares, entradasSinPar, idsSalidaUsados } = emparejarTraspasos(
    entradasTransf.map(aDocumentoFirma),
    salidasSinOrden.map(aDocumentoFirma),
  );
  reporte.nota(
    `Telas — pares de traspaso detectados: ${String(pares.length)} (de ${String(entradasTransf.length)} ` +
      `entradas 'Transferencia'). Sin par: ${String(entradasSinPar.length)} (se reportan; NO se migran como traspaso).`,
  );
  for (const e of entradasSinPar) {
    reporte.agregar(
      'Telas: entrada Transferencia SIN salida gemela (no se migra como traspaso — DECISIÓN)',
      `IdEntradas=${e.id} fecha=${e.fecha} idTela=${e.idTela}`,
    );
  }
  const docEntradaPorId = new Map(entradas.map((e) => [e.id, e]));
  const docSalidaPorId = new Map(salidas.map((s) => [s.id, s]));
  const idsEntradaTransfPareadas = new Set(pares.map((p) => p.entrada.id));

  // ── PRE-RESOLVER lotes legacy (uno por color) ────────────────────────────────────────────────
  // Recolecta TODOS los colores tocados (de entradas de compra + salidas + traspasos) y siembra su
  // lote ANTES del bucle concurrente. La PRIMERA entrada de compra de cada color aporta
  // factura/proveedor/fecha; si un color solo aparece en salidas, su lote nace mínimo.
  const loteIdPorColor = new Map<string, number>();
  const lotesLegacy = await sembrarLotesLegacy(
    sesion,
    cliente,
    reporte,
    entradas,
    salidas,
    coloresPorId,
    mapaColor,
    mapaTela,
    idsEntradaTransfPareadas,
    loteIdPorColor,
  );

  // Costo por lote legacy (= `TelasColores.Precio` del color 1:1 del lote), para que la ENTRADA
  // sintética de saldo inicial conserve el costo de la tela (D1) igual que una entrada de compra.
  const precioPorLote = new Map<number, number | null>();
  for (const [idTelasColores, idLote] of loteIdPorColor) {
    precioPorLote.set(idLote, coloresPorId.get(idTelasColores)?.precio ?? null);
  }

  // ── Idempotencia: mapeos ya migrados ─────────────────────────────────────────────────────────
  const yaEntrada = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.movEntradaTela);
  const yaSalida = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.movSalidaTela);
  const yaTraspaso = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.movTraspasoTelaSalida);
  // Guard a nivel MOVIMIENTO por `origenId` (un documento puede generar >1 movimiento — uno por
  // almacén): si una 2ª corrida re-procesa un documento cuyo mapeo de doc no se guardó (falló a
  // medias en un almacén), este set evita re-crear los movimientos que SÍ entraron (idempotencia fina).
  const origenIdsTela = new Set<string>();
  for (const m of await cliente.movimiento.findMany({
    where: { detallesTela: { some: {} }, origenId: { not: null } },
    select: { origenId: true },
  })) {
    if (m.origenId !== null) origenIdsTela.add(m.origenId);
  }

  const ctx: Ctx = {
    sesion,
    cliente,
    bd,
    reporte,
    ventana,
    acumulador: new AcumuladorSaldos<ComboTela>(),
    docsCondensados: { entradas: 0, salidas: 0, traspasos: 0 },
    precioPorLote,
    idEmpresaDefecto,
    mapaTela,
    mapaAlmacen,
    mapaOrden,
    empresaPorOrden,
    coloresPorId,
    loteIdPorColor,
    idEntradaCompra,
    idSalidaOrden,
    idAjusteSalida,
    idTransfSalida,
    idTransfEntrada,
    idTipoPorCodigo,
    yaEntrada,
    yaSalida,
    yaTraspaso,
    origenIdsTela,
  };

  // ── (a) Migrar TRASPASOS (cada par = unidad atómica) ─────────────────────────────────────────
  const traspasos = RES_VACIO();
  const resTraspasos = await enLotes(
    pares,
    (p) =>
      conReintentoTransitorio(() =>
        migrarTraspaso(ctx, docEntradaPorId.get(p.entrada.id), docSalidaPorId.get(p.salida.id)),
      ),
    CONCURRENCIA_ETL,
  );
  acumular(traspasos, resTraspasos);

  // ── (b) Migrar ENTRADAS DE COMPRA (las que NO son traspaso pareado) ──────────────────────────
  const entradasCompra = RES_VACIO();
  const entradasCompraDocs = entradas.filter((e) => !idsEntradaTransfPareadas.has(e.id));
  const resEntradas = await enLotes(
    entradasCompraDocs,
    (e) => conReintentoTransitorio(() => migrarEntradaCompra(ctx, e)),
    CONCURRENCIA_ETL,
  );
  acumular(entradasCompra, resEntradas);

  // ── (c)+(d) Migrar SALIDAS (con orden o sin clasificar; NUNCA las pata de traspaso) ──────────
  const salidasOrden = RES_VACIO();
  const salidasSinClasificar = RES_VACIO();
  const salidasMigrables = salidas.filter((s) => !idsSalidaUsados.has(s.id));
  const resSalidas = await enLotes(
    salidasMigrables,
    (s) => conReintentoTransitorio(() => migrarSalida(ctx, s)),
    CONCURRENCIA_ETL,
  );
  for (const r of resSalidas) {
    if (!r.ok) {
      salidasSinClasificar.omitidosValidacion = (salidasSinClasificar.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const objetivo = r.valor.clase === 'orden' ? salidasOrden : salidasSinClasificar;
    aplicarEstado(objetivo, r.valor.estado);
  }

  // ── SALDOS INICIALES (solo con ventana activa): un movimiento sintético por combo ────────────
  const { saldosIniciales, saldosNegativos } = await crearSaldosInicialesTela(ctx);

  return {
    entradasCompra,
    salidasOrden,
    salidasSinClasificar,
    traspasos,
    paresDetectados: pares.length,
    entradasTransferenciaSinPar: entradasSinPar.length,
    lotesLegacy,
    ventana,
    docsCondensados: ctx.docsCondensados,
    renglonesCondensados: ctx.acumulador.renglones,
    saldosIniciales,
    saldosNegativos,
  };
}

/**
 * Crea los movimientos SINTÉTICOS de saldo inicial de telas (uno por combo tela×lote×almacén con
 * neto ≠ 0), con fecha = corte. Con ventana INACTIVA o sin nada condensado, no hace nada. Neto > 0 →
 * `inventario-inicial` (entrada, costo del color); neto < 0 → `ajuste-salida` por |neto| (listado).
 * Idempotente por el set `origenIdsTela` (el sintético lleva `origenTipo='migracion'` + su
 * `origenId` determinista, y en una 2ª corrida ya aparece en la query de arranque).
 */
async function crearSaldosInicialesTela(
  ctx: Ctx,
): Promise<{ saldosIniciales: ResultadoLoader; saldosNegativos: number }> {
  const saldosIniciales = RES_VACIO();
  let saldosNegativos = 0;
  const corte = ctx.ventana.corte;
  if (corte === null || ctx.acumulador.combos === 0) {
    return { saldosIniciales, saldosNegativos };
  }

  // El tipo de la entrada sintética se exige SOLO aquí (con ventana inactiva ni se consulta).
  const idInventarioInicial = exigirTipo(ctx.idTipoPorCodigo, COD_INVENTARIO_INICIAL);

  const saldos = ctx.acumulador.saldos();
  let combosEnCero = 0;

  const res = await enLotes(
    saldos,
    (s) =>
      conReintentoTransitorio(
        async (): Promise<
          'creado' | 'creado-negativo' | 'existente' | 'omitidoValidacion' | 'cero'
        > => {
          const neto = redondear4(s.neto);
          if (neto === 0) return 'cero'; // el combo cierra en cero: sin movimiento
          const negativo = neto < 0;
          const origenId = origenIdSaldoInicialTela(s.datos);
          if (ctx.origenIdsTela.has(origenId)) return 'existente';
          if (negativo) {
            ctx.reporte.agregar(
              'Telas saldo inicial NEGATIVO (condensado como `ajuste-salida` — descuadre del viejo)',
              `combo=${s.clave} neto=${String(neto)} (entradas=${String(redondear4(s.entradas))} ` +
                `salidas=${String(redondear4(s.salidas))} renglones=${String(s.renglones)})`,
            );
          }
          const costoUnit = negativo ? null : (ctx.precioPorLote.get(s.datos.idLote) ?? null);
          const creado = await intentarCrear(ctx.reporte, 'SaldoInicialTela', s.clave, () =>
            crearMovimientoTelaMigrado(
              ctx.sesion,
              {
                idEmpresa: ctx.idEmpresaDefecto,
                idTipoMov: negativo ? ctx.idAjusteSalida : idInventarioInicial,
                idAlmacen: s.datos.idAlmacen,
                fecha: corte,
                origenId,
                origenTipo: ORIGEN.migracion,
                lineas: [
                  {
                    idTela: s.datos.idTela,
                    idLote: s.datos.idLote,
                    cantidad: Math.abs(neto),
                    costoUnit,
                  },
                ],
                observaciones: observacionSaldoInicial(
                  `${String(redondear4(s.entradas))} de entrada − ${String(redondear4(s.salidas))} ` +
                    `de salida en ${String(s.renglones)} renglones de Entradas/Salidas/traspasos`,
                ),
              },
              ctx.bd,
            ),
          );
          if (creado === null) return 'omitidoValidacion';
          ctx.origenIdsTela.add(origenId);
          return negativo ? 'creado-negativo' : 'creado';
        },
      ),
    CONCURRENCIA_ETL,
  );

  for (const r of res) {
    if (!r.ok) {
      saldosIniciales.omitidosValidacion = (saldosIniciales.omitidosValidacion ?? 0) + 1;
      continue;
    }
    if (r.valor === 'cero') combosEnCero += 1;
    else if (r.valor === 'creado-negativo') {
      saldosIniciales.creados += 1;
      saldosNegativos += 1;
    } else aplicarEstado(saldosIniciales, r.valor);
  }

  ctx.reporte.nota(
    `Telas ventana: ${String(ctx.acumulador.renglones)} renglones pre-corte condensados ` +
      `(docs: entradas=${String(ctx.docsCondensados.entradas)} salidas=${String(ctx.docsCondensados.salidas)} ` +
      `traspasos=${String(ctx.docsCondensados.traspasos)}) en ${String(ctx.acumulador.combos)} combos ` +
      `(tela×lote×almacén) → saldos iniciales creados=${String(saldosIniciales.creados)} ` +
      `existentes=${String(saldosIniciales.existentes)} netoNegativo=${String(saldosNegativos)} ` +
      `netoCero(sin movimiento)=${String(combosEnCero)}.`,
  );
  return { saldosIniciales, saldosNegativos };
}

// ── Contexto del bucle ──────────────────────────────────────────────────────────────────────────

interface Ctx {
  sesion: SesionUsuario;
  cliente: ClienteMapeo;
  bd: ContextoBd;
  reporte: Reporte;
  ventana: ConfigVentana;
  /** Acumulador de renglones pre-corte por combo tela×lote×almacén (solo con ventana activa). */
  acumulador: AcumuladorSaldos<ComboTela>;
  /** Conteo de documentos pre-corte condensados, por clase. */
  docsCondensados: DocsCondensados;
  /** Costo (`TelasColores.Precio`) por lote legacy, para la entrada sintética de saldo. */
  precioPorLote: Map<number, number | null>;
  idEmpresaDefecto: number;
  mapaTela: Map<string, number>;
  mapaAlmacen: Map<string, number>;
  mapaOrden: Map<string, number>;
  empresaPorOrden: Map<number, number>;
  coloresPorId: Map<string, { idTelasV1: string; color: string; precio: number | null }>;
  loteIdPorColor: Map<string, number>;
  idEntradaCompra: number;
  idSalidaOrden: number;
  idAjusteSalida: number;
  idTransfSalida: number;
  idTransfEntrada: number;
  /** Catálogo completo código→id (para resolver tipos que solo usa la ventana activa). */
  idTipoPorCodigo: Map<string, number>;
  yaEntrada: Map<string, number>;
  yaSalida: Map<string, number>;
  yaTraspaso: Map<string, number>;
  /** `origenId`s de movimientos de tela ya migrados (guard fino por movimiento). */
  origenIdsTela: Set<string>;
}

/** Estado de una unidad procesada. */
type Estado = 'creado' | 'existente' | 'omitido' | 'omitidoValidacion';

// ── Migradores ────────────────────────────────────────────────────────────────────────────────

/**
 * Construye las líneas de kardex de un documento: por cada renglón resuelve idTela + idLote (del
 * color) + cantidad (`cant1+cant2`). Renglones sin tela/color/lote mapeable se REPORTAN y se omiten
 * (no se pierde silenciosamente: queda en el reporte). Devuelve líneas agrupadas por almacén (un
 * documento del viejo puede tocar >1 almacén → se parte en un movimiento por almacén).
 */
function construirLineasPorAlmacen(
  ctx: Ctx,
  doc: DocResuelto,
  costoPorColor: boolean,
  etiqueta: string,
): Map<string, { idTela: number; idLote: number; cantidad: number; costoUnit: number | null }[]> {
  const porAlmacen = new Map<
    string,
    { idTela: number; idLote: number; cantidad: number; costoUnit: number | null }[]
  >();
  for (const r of doc.renglones) {
    const cantidad = r.cant1 + r.cant2;
    if (cantidad <= 0) continue; // renglón en ceros: no aporta movimiento (igual que el viejo)
    const col = ctx.coloresPorId.get(r.idTelasColores);
    if (col === undefined) {
      ctx.reporte.agregarMuestra(
        `${etiqueta}: renglón con IdTelasColores sin TelasColores (omitido)`,
        `doc=${doc.id} IdTelasColAlm=${r.idTelasColAlm} IdTelasColores=${r.idTelasColores}`,
      );
      continue;
    }
    const idTela = ctx.mapaTela.get(col.idTelasV1);
    const idLote = ctx.loteIdPorColor.get(r.idTelasColores);
    const idAlmacen = ctx.mapaAlmacen.get(r.idAlmacenV1);
    if (idTela === undefined || idLote === undefined || idAlmacen === undefined) {
      // Muestra ACOTADA: con la ventana activa este descarte es MASIVO y esperado (telas fuera
      // del set de USO), no una incidencia a revisar fila por fila. El total siempre se ve.
      ctx.reporte.agregarMuestra(
        `${etiqueta}: renglón sin tela/lote/almacén mapeable (omitido)`,
        `doc=${doc.id} IdTelas=${col.idTelasV1} IdTelasColores=${r.idTelasColores} ` +
          `almacénV1=${r.idAlmacenV1} (tela=${String(idTela)} lote=${String(idLote)} alm=${String(idAlmacen)})`,
      );
      continue;
    }
    const costoUnit = costoPorColor ? col.precio : null;
    const lista = porAlmacen.get(String(idAlmacen)) ?? [];
    lista.push({ idTela, idLote, cantidad, costoUnit });
    porAlmacen.set(String(idAlmacen), lista);
  }
  return porAlmacen;
}

/**
 * CONDENSA un documento PRE-CORTE al acumulador de saldos: resuelve sus renglones con la MISMA
 * criba que la migración individual (`construirLineasPorAlmacen` — lo no mapeable se lista y NO
 * entra al neto) y suma/resta cada línea en su combo tela×lote×almacén. Devuelve el # de renglones
 * acumulados (0 = nada resoluble; el doc queda como omitido, igual que hoy).
 */
function condensarDocumento(
  ctx: Ctx,
  doc: DocResuelto,
  direccion: DireccionSaldo,
  etiqueta: string,
): number {
  const porAlmacen = construirLineasPorAlmacen(ctx, doc, false, etiqueta);
  let renglones = 0;
  for (const [idAlmacen, lineas] of porAlmacen) {
    for (const l of lineas) {
      const combo: ComboTela = { idTela: l.idTela, idLote: l.idLote, idAlmacen: Number(idAlmacen) };
      ctx.acumulador.agregar(claveComboTela(combo), combo, direccion, l.cantidad);
      renglones += 1;
    }
  }
  return renglones;
}

/** Migra una ENTRADA DE COMPRA (b): movimientos de entrada directa (uno por almacén tocado). */
async function migrarEntradaCompra(ctx: Ctx, doc: DocResuelto): Promise<Estado> {
  if (ctx.yaEntrada.has(doc.id)) return 'existente';
  if (esPreCorte(doc.fecha, ctx.ventana)) {
    // Pre-corte: NO migra individual — se condensa al saldo inicial (cuenta como omitido, igual
    // que antes; el agregado sale en la nota de la ventana).
    if (condensarDocumento(ctx, doc, 'entrada', 'Telas entrada (pre-corte)') > 0) {
      ctx.docsCondensados.entradas += 1;
    }
    return 'omitido';
  }
  const fecha = doc.fecha;
  if (fecha === null) {
    ctx.reporte.agregar('Telas entrada: sin fecha parseable (omitida)', `IdEntradas=${doc.id}`);
    return 'omitido';
  }
  const porAlmacen = construirLineasPorAlmacen(ctx, doc, true, 'Telas entrada');
  if (porAlmacen.size === 0) return 'omitido';

  const observaciones = obs(doc.factura, doc.referencia, `v1 IdEntradas=${doc.id}`);
  // Un documento del viejo puede tocar >1 almacén; cada almacén es un movimiento. El mapeo de
  // idempotencia se ancla al PRIMER movimiento (origenId del documento) — basta para no re-migrar.
  let primerId: number | null = null;
  let algunoYaExistia = false;
  for (const [idAlmacen, lineas] of porAlmacen) {
    const origenId = `EntradasDet:${doc.id}:${idAlmacen}`;
    if (ctx.origenIdsTela.has(origenId)) {
      algunoYaExistia = true;
      continue; // ya migrado en una corrida previa (guard fino por movimiento)
    }
    const creado = await intentarCrear(ctx.reporte, 'MovEntradaTela', doc.id, () =>
      crearMovimientoTelaMigrado(
        ctx.sesion,
        {
          idEmpresa: ctx.idEmpresaDefecto,
          idTipoMov: ctx.idEntradaCompra,
          idAlmacen: Number(idAlmacen),
          fecha,
          origenId,
          origenTipo: ORIGEN.migracion,
          lineas,
          ...(observaciones === null ? {} : { observaciones }),
        },
        ctx.bd,
      ),
    );
    if (creado === null) return primerId === null ? 'omitidoValidacion' : 'creado';
    ctx.origenIdsTela.add(origenId);
    if (primerId === null) primerId = creado;
  }
  if (primerId === null) return algunoYaExistia ? 'existente' : 'omitidoValidacion';
  await guardarMapeo(ctx.cliente, ENTIDAD_MAPEO.movEntradaTela, doc.id, primerId);
  ctx.yaEntrada.set(doc.id, primerId);
  return 'creado';
}

/** Resultado de una salida (incluye su clase para contabilizar orden vs sin-clasificar). */
interface ResSalida {
  estado: Estado;
  clase: 'orden' | 'sin-clasificar';
}

/** Migra una SALIDA (c con orden / d sin clasificar). NUNCA recibe una pata de traspaso. */
async function migrarSalida(ctx: Ctx, doc: DocResuelto): Promise<ResSalida> {
  const conOrden = doc.idOrdenV1 !== null;
  const clase: ResSalida['clase'] = conOrden ? 'orden' : 'sin-clasificar';
  if (ctx.yaSalida.has(doc.id)) return { estado: 'existente', clase };
  if (esPreCorte(doc.fecha, ctx.ventana)) {
    // Pre-corte: se condensa al saldo (resta del combo). OJO: se condensa ANTES de clasificar
    // (c/d) — para el neto da igual la clase, y así las miles de salidas viejas no inundan el
    // reporte con la incidencia por-documento de la decisión (d).
    if (condensarDocumento(ctx, doc, 'salida', 'Telas salida (pre-corte)') > 0) {
      ctx.docsCondensados.salidas += 1;
    }
    return { estado: 'omitido', clase };
  }
  const fecha = doc.fecha;
  if (fecha === null) {
    ctx.reporte.agregar('Telas salida: sin fecha parseable (omitida)', `IdSalidas=${doc.id}`);
    return { estado: 'omitido', clase };
  }

  // (c) salida ligada a orden: resolver la orden y su empresa.
  let idEmpresa = ctx.idEmpresaDefecto;
  let idTipoMov = ctx.idAjusteSalida;
  let origenTipo: typeof ORIGEN.migracion | typeof ORIGEN.salidaTelaOrden = ORIGEN.migracion;
  let idOrdenNuevo: number | null = null;
  if (conOrden) {
    idOrdenNuevo = ctx.mapaOrden.get(doc.idOrdenV1 ?? '') ?? null;
    if (idOrdenNuevo === null) {
      ctx.reporte.agregar(
        'Telas salida con IdOrdenes sin orden mapeable (migrada como ajuste-salida + reportada)',
        `IdSalidas=${doc.id} IdOrdenes=${doc.idOrdenV1 ?? '?'}`,
      );
      // cae a ajuste-salida (no se pierde la existencia), pero se queda en clase 'orden' (era su intención)
    } else {
      idEmpresa = ctx.empresaPorOrden.get(idOrdenNuevo) ?? ctx.idEmpresaDefecto;
      idTipoMov = ctx.idSalidaOrden;
      origenTipo = ORIGEN.salidaTelaOrden;
    }
  } else {
    ctx.reporte.agregar(
      'Telas salida SIN orden y NO pata de traspaso (migrada como ajuste-salida — DECISIÓN d)',
      `IdSalidas=${doc.id} fecha=${fecha.toISOString().slice(0, 10)}`,
    );
  }

  const porAlmacen = construirLineasPorAlmacen(ctx, doc, false, 'Telas salida');
  if (porAlmacen.size === 0) return { estado: 'omitido', clase };

  const refExtra =
    idOrdenNuevo !== null
      ? `v1 IdSalidas=${doc.id} (orden v1=${doc.idOrdenV1 ?? '?'})`
      : `v1 IdSalidas=${doc.id}`;
  const observaciones = obs(null, doc.referencia, refExtra);
  // El guard fino por `origenId` solo aplica a la salida sin-orden (ajuste-salida), cuyo origenId es
  // único por almacén (`SalidasDet:doc:alm`). La salida-a-orden comparte origenId=idOrden entre sus
  // almacenes, así que NO se usa para idempotencia fina (la protege `yaSalida` a nivel documento).
  const usaGuardFino = origenTipo === ORIGEN.migracion;
  let primerId: number | null = null;
  let algunoYaExistia = false;
  for (const [idAlmacen, lineas] of porAlmacen) {
    const origenId =
      origenTipo === ORIGEN.salidaTelaOrden && idOrdenNuevo !== null
        ? String(idOrdenNuevo)
        : `SalidasDet:${doc.id}:${idAlmacen}`;
    if (usaGuardFino && ctx.origenIdsTela.has(origenId)) {
      algunoYaExistia = true;
      continue;
    }
    const creado = await intentarCrear(ctx.reporte, 'MovSalidaTela', doc.id, () =>
      crearMovimientoTelaMigrado(
        ctx.sesion,
        {
          idEmpresa,
          idTipoMov,
          idAlmacen: Number(idAlmacen),
          fecha,
          origenId,
          origenTipo,
          lineas,
          ...(observaciones === null ? {} : { observaciones }),
        },
        ctx.bd,
      ),
    );
    if (creado === null)
      return { estado: primerId === null ? 'omitidoValidacion' : 'creado', clase };
    if (usaGuardFino) ctx.origenIdsTela.add(origenId);
    if (primerId === null) primerId = creado;
  }
  if (primerId === null) {
    return { estado: algunoYaExistia ? 'existente' : 'omitidoValidacion', clase };
  }
  await guardarMapeo(ctx.cliente, ENTIDAD_MAPEO.movSalidaTela, doc.id, primerId);
  ctx.yaSalida.set(doc.id, primerId);
  return { estado: 'creado', clase };
}

/**
 * Migra un PAR DE TRASPASO (a): salida del almacén ORIGEN + entrada al almacén DESTINO en UNA
 * transacción (A2). El almacén origen viene de la SALIDA (su renglón) y el destino de la ENTRADA. El
 * viejo movía la MISMA cantidad por color en ambas patas; se toman las líneas de la salida (origen) y
 * se valida que destino sea otro almacén. Solo se migra si el par toca EXACTAMENTE un almacén por
 * pata (lo normal en un traspaso del viejo); casos raros (>1 almacén por pata) se reportan.
 */
async function migrarTraspaso(
  ctx: Ctx,
  entrada: DocResuelto | undefined,
  salida: DocResuelto | undefined,
): Promise<Estado> {
  if (entrada === undefined || salida === undefined) return 'omitido';
  const claveSalida = `Traspaso:${salida.id}`;
  if (ctx.yaTraspaso.has(claveSalida)) return 'existente';
  const fecha = salida.fecha ?? entrada.fecha;
  if (fecha === null) {
    ctx.reporte.agregar('Telas traspaso: sin fecha parseable (omitido)', `IdSalidas=${salida.id}`);
    return 'omitido';
  }
  const preCorte = esPreCorte(fecha, ctx.ventana);

  const lineasSalida = construirLineasPorAlmacen(ctx, salida, false, 'Telas traspaso (salida)');
  const lineasEntrada = construirLineasPorAlmacen(ctx, entrada, false, 'Telas traspaso (entrada)');
  if (lineasSalida.size !== 1 || lineasEntrada.size !== 1) {
    ctx.reporte.agregar(
      'Telas traspaso: par con ≠1 almacén por pata (omitido — revisar manualmente)',
      `IdEntradas=${entrada.id} IdSalidas=${salida.id} almOrigen=${lineasSalida.size} almDestino=${lineasEntrada.size}`,
    );
    return 'omitido';
  }
  const [idAlmacenOrigen, lineas] = [...lineasSalida.entries()][0]!;
  const [idAlmacenDestino] = [...lineasEntrada.entries()][0]!;
  if (idAlmacenOrigen === idAlmacenDestino) {
    ctx.reporte.agregar(
      'Telas traspaso: origen y destino iguales (omitido)',
      `IdEntradas=${entrada.id} IdSalidas=${salida.id} almacén=${idAlmacenOrigen}`,
    );
    return 'omitido';
  }

  if (preCorte) {
    // Pre-corte: el traspaso se condensa como sus DOS patas (mismas líneas que la migración
    // individual, tomadas de la pata de salida): RESTA en el almacén ORIGEN y SUMA en el DESTINO.
    // Pasó ya las mismas validaciones que un traspaso migrable (par 1×1, almacenes distintos).
    for (const l of lineas) {
      const comboOrigen: ComboTela = {
        idTela: l.idTela,
        idLote: l.idLote,
        idAlmacen: Number(idAlmacenOrigen),
      };
      const comboDestino: ComboTela = {
        idTela: l.idTela,
        idLote: l.idLote,
        idAlmacen: Number(idAlmacenDestino),
      };
      ctx.acumulador.agregar(claveComboTela(comboOrigen), comboOrigen, 'salida', l.cantidad);
      ctx.acumulador.agregar(claveComboTela(comboDestino), comboDestino, 'entrada', l.cantidad);
    }
    if (lineas.length > 0) ctx.docsCondensados.traspasos += 1;
    return 'omitido';
  }

  const observaciones = obs(
    null,
    salida.referencia,
    `traspaso v1 IdSalidas=${salida.id}→IdEntradas=${entrada.id}`,
  );
  const res = await intentarCrear(ctx.reporte, 'TraspasoTela', salida.id, () =>
    crearTraspasoTelaMigrado(
      ctx.sesion,
      {
        idEmpresa: ctx.idEmpresaDefecto,
        idTipoMovSalida: ctx.idTransfSalida,
        idTipoMovEntrada: ctx.idTransfEntrada,
        idAlmacenOrigen: Number(idAlmacenOrigen),
        idAlmacenDestino: Number(idAlmacenDestino),
        fecha,
        origenIdSalida: `Traspaso:${salida.id}`,
        origenIdEntrada: `Traspaso:${entrada.id}`,
        lineas: lineas.map((l) => ({ idTela: l.idTela, idLote: l.idLote, cantidad: l.cantidad })),
        ...(observaciones === null ? {} : { observaciones }),
      },
      ctx.bd,
    ),
  );
  if (res === null) return 'omitidoValidacion';
  await guardarMapeo(ctx.cliente, ENTIDAD_MAPEO.movTraspasoTelaSalida, claveSalida, res.idSalida);
  await guardarMapeo(
    ctx.cliente,
    ENTIDAD_MAPEO.movTraspasoTelaEntrada,
    `Traspaso:${entrada.id}`,
    res.idEntrada,
  );
  ctx.yaTraspaso.set(claveSalida, res.idSalida);
  return 'creado';
}

// ── Siembra de lotes legacy (pre-pasada secuencial) ──────────────────────────────────────────────

/**
 * Siembra (secuencial, idempotente) UN lote por color tocado, ANTES del bucle concurrente. Recorre
 * primero las ENTRADAS DE COMPRA (en orden de id, para que la PRIMERA aporte factura/proveedor/fecha)
 * y luego cualquier color que solo aparezca en salidas. Llena `loteIdPorColor`. Devuelve el # de
 * colores con lote.
 */
async function sembrarLotesLegacy(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  entradas: DocResuelto[],
  salidas: DocResuelto[],
  coloresPorId: Map<string, { idTelasV1: string; color: string; precio: number | null }>,
  mapaColor: Map<string, number>,
  mapaTela: Map<string, number>,
  idsEntradaTransfPareadas: Set<string>,
  loteIdPorColor: Map<string, number>,
): Promise<number> {
  // Primera aparición (datos de la entrada de compra) por color.
  const datosColor = new Map<string, { factura: string | null; fecha: Date | null }>();
  const entradasOrdenadas = [...entradas].sort((a, b) => Number(a.id) - Number(b.id));
  const coloresEnSalidas = new Set<string>();
  for (const s of salidas) for (const r of s.renglones) coloresEnSalidas.add(r.idTelasColores);

  for (const e of entradasOrdenadas) {
    const esCompra = !idsEntradaTransfPareadas.has(e.id);
    for (const r of e.renglones) {
      if (!datosColor.has(r.idTelasColores) && esCompra) {
        datosColor.set(r.idTelasColores, { factura: e.factura, fecha: e.fecha });
      }
    }
  }

  // Universo de colores: los de TODOS los renglones (entradas + salidas).
  const colores = new Set<string>();
  for (const e of entradas) for (const r of e.renglones) colores.add(r.idTelasColores);
  for (const c of coloresEnSalidas) colores.add(c);

  const bd = { cliente: cliente as PrismaClient };
  let sembrados = 0;
  for (const idTelasColores of colores) {
    const col = coloresPorId.get(idTelasColores);
    if (col === undefined) continue;
    const idColor = mapaColor.get(col.color);
    const idTela = mapaTela.get(col.idTelasV1);
    if (idColor === undefined || idTela === undefined) {
      reporte.agregar(
        'Telas lote legacy: color/tela sin mapeo (lote no sembrado; sus renglones se omitirán)',
        `IdTelasColores=${idTelasColores} color="${col.color}" IdTelas=${col.idTelasV1}`,
      );
      continue;
    }
    const datos = datosColor.get(idTelasColores);
    const clave = `${PREFIJO_LOTE_LEGACY}-${idTelasColores}`;
    const idLote = await intentarCrear(reporte, 'LoteLegacyTela', idTelasColores, () =>
      enTransaccion(
        (tx) =>
          asegurarLoteLegacyTela(tx, sesion, {
            clave,
            idColor,
            idTela,
            cantidadComponente: 0,
            ...(datos?.factura == null ? {} : { factura: datos.factura }),
            ...(datos?.fecha == null ? {} : { fecha: datos.fecha }),
            observaciones: `Lote legacy sintetizado (F4-E6) — color ${col.color}, tela v1 ${col.idTelasV1}.`,
          }),
        bd,
      ),
    );
    if (idLote === null) continue;
    loteIdPorColor.set(idTelasColores, idLote);
    await guardarMapeo(cliente, ENTIDAD_MAPEO.loteLegacyTela, idTelasColores, idLote);
    sembrados += 1;
  }
  return sembrados;
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

/** Exige un tipo de movimiento del catálogo por código (sin él, el ETL no puede continuar). */
function exigirTipo(mapa: Map<string, number>, codigo: string): number {
  const id = mapa.get(codigo);
  if (id === undefined) {
    throw new Error(
      `Falta el tipo de movimiento "${codigo}" en el catálogo. Re-sembrar (SEED_ON_START) antes del ETL.`,
    );
  }
  return id;
}

/** Lee un CSV de detalle y lo agrupa por su documento padre. */
function agruparDetalle(
  archivo: string,
  colDoc: string,
  colCant1: string,
  colCant2: string,
): Map<string, { idTelasColAlm: string; cant1: string; cant2: string }[]> {
  const mapa = new Map<string, { idTelasColAlm: string; cant1: string; cant2: string }[]>();
  for (const f of leerCsv(archivo)) {
    const idDoc = (f[colDoc] ?? '').trim();
    if (idDoc === '') continue;
    const lista = mapa.get(idDoc) ?? [];
    lista.push({
      idTelasColAlm: (f.IdTelasColAlm ?? '').trim(),
      cant1: (f[colCant1] ?? '').trim(),
      cant2: (f[colCant2] ?? '').trim(),
    });
    mapa.set(idDoc, lista);
  }
  return mapa;
}

/** Resuelve los renglones crudos de un documento (color + almacén + cantidades numéricas). */
function resolverRenglones(
  crudos: { idTelasColAlm: string; cant1: string; cant2: string }[],
  colAlmPorId: Map<string, { idTelasColores: string; idAlmacenV1: string }>,
  _coloresPorId: Map<string, unknown>,
): RenglonResuelto[] {
  const out: RenglonResuelto[] = [];
  for (const c of crudos) {
    const ca = colAlmPorId.get(c.idTelasColAlm);
    if (ca === undefined) continue; // sin TelasColAlm: no se puede ubicar color/almacén
    out.push({
      idTelasColAlm: c.idTelasColAlm,
      idTelasColores: ca.idTelasColores,
      idAlmacenV1: ca.idAlmacenV1,
      cant1: aNum(c.cant1),
      cant2: aNum(c.cant2),
    });
  }
  return out;
}

/** Convierte una cantidad cruda del viejo a número (≥0; vacío/NaN = 0). */
function aNum(crudo: string): number {
  const n = Number(crudo.replace(/[\s,]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** ¿La factura indica un traspaso? (`'Transferencia'`, sin importar mayúsculas/espacios). */
function esTransferencia(factura: string | null): boolean {
  return factura !== null && factura.trim().toLowerCase() === 'transferencia';
}

/** Proyecta un documento resuelto a la forma de firma (para el emparejado de pares). */
function aDocumentoFirma(doc: DocResuelto): DocumentoTela {
  const renglones: RenglonDetalleTela[] = doc.renglones.map((r) => ({
    idTelasColAlm: r.idTelasColAlm,
    idTelasColores: r.idTelasColores,
    idAlmacen: r.idAlmacenV1,
    cant1: String(r.cant1),
    cant2: String(r.cant2),
  }));
  return {
    id: doc.id,
    fecha: doc.fecha === null ? '' : doc.fecha.toISOString().slice(0, 10),
    idTela: doc.idTelaV1,
    renglones,
  };
}

/** Construye observaciones del movimiento (factura + referencia + traza v1), acotado a 1000. */
function obs(factura: string | null, referencia: string | null, traza: string): string | null {
  const partes: string[] = [];
  if (factura !== null) partes.push(`Factura: ${factura}`);
  if (referencia !== null) partes.push(`Ref: ${referencia}`);
  partes.push(`[${traza}]`);
  const texto = partes.join(' · ').trim();
  return texto === '' ? null : texto.slice(0, 1000);
}

/** Acumula resultados de `enLotes` en un `ResultadoLoader`. */
function acumular(
  acc: ResultadoLoader,
  resultados: { ok: boolean; valor?: Estado }[] | readonly { ok: boolean }[],
): void {
  for (const r of resultados as { ok: boolean; valor?: Estado }[]) {
    if (!r.ok) {
      acc.omitidosValidacion = (acc.omitidosValidacion ?? 0) + 1;
      continue;
    }
    aplicarEstado(acc, r.valor ?? 'omitidoValidacion');
  }
}

/** Suma un estado al contador correspondiente. */
function aplicarEstado(acc: ResultadoLoader, estado: Estado): void {
  if (estado === 'creado') acc.creados += 1;
  else if (estado === 'existente') acc.existentes += 1;
  else if (estado === 'omitido') acc.omitidos += 1;
  else acc.omitidosValidacion = (acc.omitidosValidacion ?? 0) + 1;
}
