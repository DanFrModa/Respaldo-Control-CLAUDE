/**
 * PRESCAN de USO de catálogos (recarga limitada por fecha — pedido del dueño: "hay muchísimos
 * modelos y ya no me sirven" → con la ventana ACTIVA solo migran los catálogos GRANDES que
 * de verdad se USAN en la ventana; el resto se cuenta como `fueraVentana`, nada en silencio).
 *
 * ⭐ CRITERIO VIGENTE (cambio dictado por el DUEÑO): **SOLO lo USADO en la ventana**. Una
 * entidad SIN actividad dentro de la ventana NO entra **aunque tenga existencia o saldo
 * viejo** — el dueño acepta explícitamente perder ese inventario ("ya no me sirve"). Los
 * prongs de "existencia / neto pre-corte" quedaron RETIRADOS (retenían ~1,093 modelos y ~155
 * telas por saldo histórico). Lo excluido que SÍ tenía existencia se deja por escrito en
 * `excluidos-sin-actividad-<timestamp>.txt` (constancia para Daniel), nunca en silencio.
 *
 * ⚠️ Lo que SÍ se conserva: los **saldos iniciales de las entidades que SÍ migran** (un modelo
 * usado en 2025 cuyo stock viene de 2024 conserva su existencia; si no, saldría negativo). La
 * maquinaria de saldo inicial (kardex PT/telas, EsMa) sigue intacta: solo produce asientos de
 * entidades dentro del set, porque los loaders descartan la fila ANTES de acumular cuando el
 * modelo/tela no mapea (no quedan sintéticos huérfanos).
 *
 * Extiende el patrón de `ventana-f2.ts` (clientes por uso) a modelos/telas/avíos/bordados/
 * proveedores. Lee los CSV del viejo (CP850, `leerCsv`) UNA vez y arma los sets de claves v1
 * "usadas". Definición de USADO (unión de fuentes):
 *
 *  • MODELO: referenciado por pedidos/órdenes DENTRO de la ventana (cascada de
 *    `ventana-f2.ts`) ∪ con movimiento de kardex PT de **fecha ≥ corte** ∪ referenciado por el
 *    cíclico (`Alm_InvCic`) dentro de la ventana. OJO: kardex/cíclico referencian por CÓDIGO y
 *    los documentos por `IdModelos` → los sets van en AMBOS espacios, cruzados vía `Modelos.csv`.
 *  • TELA: en el BOM de un modelo usado (`ModelosTela`→IdTelasDis) ∪ referenciada por una orden
 *    dentro de la ventana (`Ordenes.IdTelasDis`) ∪ con movimiento **≥ corte** (`Entradas`/
 *    `Salidas`: por la cabecera `IdTela` y por sus renglones vía IdTelasColAlm→TelasColores).
 *    Las OC/notas legacy NO pueden aportar telas: sus renglones son TEXTO LIBRE sin FK a
 *    catálogo (`OrdCompraDet.Descripcion`→`descripcionLibre`, `NotasDet.Descripcion`→
 *    `descripcionLegacy`; verificado en sus loaders).
 *  • AVÍO: BOM de un modelo usado (`ModelosHab`→IdHabilitacion) — se encoge solo con los
 *    modelos. BORDADO: idem (`ModelosBor`→IdBordados).
 *  • PROVEEDOR (4 espacios de id + nombres): OC dentro de la ventana (IdProveedor) ∪ proveedor
 *    TEXTO de tela/avío usado (match por `normalizarParaDedup`, igual que los loaders) ∪
 *    terceros con actividad EN VENTANA: maquileros de órdenes migradas (`Ordenes`/`Entregas`/
 *    `Recibos`/`CC_Auditorias` de esas órdenes) o de notas en ventana, o con **movimiento EsMa
 *    de fecha ≥ corte**; estampadores de `EntregasEst`/`RecibosEst` de órdenes migradas (su
 *    columna se llama IdMaquileros pero es espacio Estampadores); cortadores de `Corte` de
 *    órdenes migradas. (RETIRADO el criterio grueso de "cualquiera con cuenta EsMa".)
 *  • COLORES: NO se filtran (quedan COMPLETOS, decisión declarada): son chicos y los referencian
 *    por texto libre múltiples fuentes (OrdenesDet, lotes de tela por color) — filtrarlos
 *    arriesga romper un saldo inicial de las entidades que SÍ migran.
 *  • SIEMPRE completos: empresas, almacenes, géneros, temporadas, etiquetas de marca,
 *    tela-categorías, tallas/curvas (chicos/estructurales).
 *
 * RED DE SEGURIDAD: si este prescan dejara fuera algo que un ETL posterior sí necesita, ese
 * ETL ya REPORTA el mapeo faltante (nunca silencioso) — y con la ventana activa esos descartes
 * masivos van a BUCKETS AGREGADOS (conteo + muestra), no a incidencias por fila.
 *
 * Con la ventana INACTIVA devuelve `null` y todo migra completo (invariante: sin `ETL_DESDE`
 * nada cambia).
 */
import { leerCsv, type FilaCsv } from './csv.js';
import { signoMovimientoIpt } from '../loaders/ipt-kardex.js';

import {
  normalizarParaDedup,
  parsearDinero,
  parsearEntero,
  parsearFecha,
  parsearFechaSoloDia,
} from './valores.js';
import { calcularPrescanVentanaF2, type PrescanVentanaF2 } from './ventana-f2.js';
import { dentroVentana, type ConfigVentana } from './ventana.js';

/** Sets de claves v1 "usadas" por catálogo (ventana ACTIVA). */
export interface PrescanUso {
  /** Prescan F2 (pedidos/órdenes/clientes) del que cuelga la cascada. */
  f2: PrescanVentanaF2;
  /** `IdModelos` usados (documentos ∪ traducción de códigos usados). */
  modelosId: Set<string>;
  /** Códigos de modelo usados, normalizados UPPER (kardex/cíclico ∪ traducción de ids). */
  modelosCodigo: Set<string>;
  /**
   * CONSTANCIA (no altera el filtro): códigos de modelo EXCLUIDOS por no tener actividad en la
   * ventana pero que SÍ traían existencia PT pre-corte → inventario que se deja de migrar por
   * decisión del dueño. Se vuelca a `excluidos-sin-actividad-<timestamp>.txt`.
   */
  modelosExcluidosConExistencia: Set<string>;
  /** Igual que el anterior, para telas: `IdTelas` excluidos que traían existencia pre-corte. */
  telasExcluidasConExistencia: Set<string>;
  /** `IdTelas` usadas (movimientos/existencia). */
  telasIdTelas: Set<string>;
  /** `IdTelasDis` usadas (BOM ∪ órdenes en ventana). */
  telasIdTelasDis: Set<string>;
  /** `IdHabilitacion` usados (BOM de modelos usados). */
  aviosId: Set<string>;
  /** `IdBordados` usados (BOM de modelos usados). */
  bordadosId: Set<string>;
  /** `IdProveedor` usados (OC en ventana). */
  provIdProveedor: Set<string>;
  /** `IdMaquileros` usados (órdenes/entregas/recibos/notas/EsMa/auditorías). */
  provIdMaquileros: Set<string>;
  /** `IdEstampadores` usados (EntregasEst/RecibosEst de órdenes migradas). */
  provIdEstampadores: Set<string>;
  /** `IdCortadores` usados (Corte de órdenes migradas). */
  provIdCortadores: Set<string>;
  /** Nombres normalizados (`normalizarParaDedup`) del proveedor TEXTO de telas/avíos usados. */
  provNombres: Set<string>;
  /**
   * Existencia PT estimada por código de modelo (neto pre-corte CALCULADO; si el código solo
   * apareció en el snapshot `IPT_Mod_Alm`, la suma del snapshot). Solo para la CONSTANCIA de
   * lo excluido — NO participa en el criterio de USADO.
   */
  existenciaPtEstimadaPorCodigo: Map<string, number>;
  /** Existencia de tela estimada por `IdTelas` (neto pre-corte calculado / snapshot). Constancia. */
  existenciaTelaEstimadaPorId: Map<string, number>;
}

/** Fuentes crudas (inyectables en el test; en real las lee {@link prescanUso} con `leerCsv`). */
export interface FuentesPrescanUso {
  pedidos: FilaCsv[];
  pedidosDet: FilaCsv[];
  ordenes: FilaCsv[];
  modelos: FilaCsv[];
  iptModelos: FilaCsv[];
  iptModAlm: FilaCsv[];
  iptMovs: FilaCsv[];
  iptMovsDet: FilaCsv[];
  almInvCic: FilaCsv[];
  modelosTela: FilaCsv[];
  modelosHab: FilaCsv[];
  modelosBor: FilaCsv[];
  entradas: FilaCsv[];
  entradasDet: FilaCsv[];
  salidas: FilaCsv[];
  salidasDet: FilaCsv[];
  telasColAlm: FilaCsv[];
  telasColores: FilaCsv[];
  telasDis: FilaCsv[];
  habilitacion: FilaCsv[];
  ordCompra: FilaCsv[];
  notas: FilaCsv[];
  entregas: FilaCsv[];
  recibos: FilaCsv[];
  entregasEst: FilaCsv[];
  recibosEst: FilaCsv[];
  corte: FilaCsv[];
  esMa: FilaCsv[];
  ccAuditorias: FilaCsv[];
}

/** Valor de celda limpio. */
function limpio(v: string | undefined): string {
  return (v ?? '').trim();
}

/** ¿La clave es una FK real (no vacía ni el `0` "sin asignar" del viejo)? */
function esClave(v: string): boolean {
  return v !== '' && v !== '0';
}

/** Tolerancia del neto de kardex (el criterio no necesita ser exacto al centavo). */
const TOLERANCIA_NETO = 0.0001;

/** Núcleo PURO del prescan de uso (sin disco). La lógica de arriba, paso a paso. */
export function calcularPrescanUso(ventana: ConfigVentana, fuentes: FuentesPrescanUso): PrescanUso {
  const f2 = calcularPrescanVentanaF2(ventana, {
    pedidos: fuentes.pedidos,
    pedidosDet: fuentes.pedidosDet,
    ordenes: fuentes.ordenes,
  });

  const modelosId = new Set<string>();
  const telasIdTelas = new Set<string>();
  const telasIdTelasDis = new Set<string>();
  const provIdProveedor = new Set<string>();
  const provIdMaquileros = new Set<string>();
  const provIdEstampadores = new Set<string>();
  const provIdCortadores = new Set<string>();

  // ── 1) Modelos/telas/maquileros referenciados por DOCUMENTOS dentro de la ventana ─────────
  for (const f of fuentes.pedidosDet) {
    if (f2.pedidosFuera.has(limpio(f.IdPedidos))) continue;
    const idModelo = limpio(f.IdModelos);
    if (esClave(idModelo)) modelosId.add(idModelo);
  }
  for (const f of fuentes.ordenes) {
    if (f2.ordenesFuera.has(limpio(f.IdOrdenes))) continue;
    const idModelo = limpio(f.IdModelos);
    if (esClave(idModelo)) modelosId.add(idModelo);
    const idTelaDis = limpio(f.IdTelasDis);
    if (esClave(idTelaDis)) telasIdTelasDis.add(idTelaDis);
    const idMaq = limpio(f.IdMaquileros);
    if (esClave(idMaq)) provIdMaquileros.add(idMaq);
  }

  // ── 2) Puente id↔código de modelos (`Modelos.csv`: kardex/cíclico van por CÓDIGO) ─────────
  const codigoPorId = new Map<string, string>();
  const idPorCodigo = new Map<string, string>();
  for (const f of fuentes.modelos) {
    const id = limpio(f.IdModelos);
    const codigo = limpio(f.Modelo).toUpperCase();
    if (id === '' || codigo === '') continue;
    codigoPorId.set(id, codigo);
    if (!idPorCodigo.has(codigo)) idPorCodigo.set(codigo, id);
  }

  // ── 3) Kardex PT por código: USADO = movimiento ≥ corte. El neto pre-corte y el snapshot YA
  // NO deciden (criterio del dueño): se calculan SOLO como CONSTANCIA de lo que se deja fuera.
  const codigoPorIptModelo = new Map<string, string>(); // IdIPT_Modelos → NumMod
  for (const f of fuentes.iptModelos) {
    const id = limpio(f.IdIPT_Modelos);
    const numMod = limpio(f.NumMod).toUpperCase();
    if (id !== '' && numMod !== '') codigoPorIptModelo.set(id, numMod);
  }
  const iptModeloPorModAlm = new Map<string, string>(); // IdIPT_Mod_Alm → IdIPT_Modelos
  const kardexExistencia = new Set<string>();
  const snapshotPorCodigo = new Map<string, number>(); // Σ IPT_Mod_Alm.Existencia por código
  for (const f of fuentes.iptModAlm) {
    const id = limpio(f.IdIPT_Mod_Alm);
    const idIptModelo = limpio(f.IdIPT_Modelos);
    if (id !== '' && idIptModelo !== '') iptModeloPorModAlm.set(id, idIptModelo);
    const existencia = parsearDinero(f.Existencia) ?? 0;
    const codigo = codigoPorIptModelo.get(idIptModelo);
    if (codigo !== undefined && existencia !== 0) {
      snapshotPorCodigo.set(codigo, (snapshotPorCodigo.get(codigo) ?? 0) + existencia);
    }
    if (Math.abs(existencia) > TOLERANCIA_NETO) {
      if (codigo !== undefined) kardexExistencia.add(codigo);
    }
  }
  // IdIPT_Movs → cabecera cruda (fecha + tipo + EnSa).
  const movCrudo = new Map<
    string,
    { fecha: Date | null; idTipoMov: number | null; enSa: number | null }
  >();
  for (const f of fuentes.iptMovs) {
    const id = limpio(f.IdIPT_Movs);
    if (id === '') continue;
    movCrudo.set(id, {
      fecha: parsearFecha(f.Fecha),
      idTipoMov: parsearEntero(f.IdIPT_TipoMov),
      enSa: parsearEntero(f.EnSa),
    });
  }
  const kardexEnVentana = new Set<string>();
  const netoPre = new Map<string, number>();
  for (const f of fuentes.iptMovsDet) {
    const mov = movCrudo.get(limpio(f.IdIPT_Movs));
    if (mov === undefined) continue; // cadena rota: el ETL de IPT ya la reporta
    const idIptModelo = iptModeloPorModAlm.get(limpio(f.IdIPT_Mod_Alm));
    const codigo = idIptModelo === undefined ? undefined : codigoPorIptModelo.get(idIptModelo);
    if (codigo === undefined) continue;
    if (dentroVentana(mov.fecha, ventana)) {
      kardexEnVentana.add(codigo);
      continue;
    }
    // Pre-corte: acumular el neto con LA MISMA regla de signo del ETL (dirección canónica del
    // TIPO vía `tipoDestino`; el EnSa solo decide en tipos vacíos/discordantes — nota 4).
    const cant = parsearDinero(f.CantMov) ?? 0;
    const signo = signoMovimientoIpt(mov.idTipoMov, mov.enSa);
    if (signo !== 0 && cant !== 0) {
      netoPre.set(codigo, (netoPre.get(codigo) ?? 0) + signo * cant);
    }
  }
  const kardexNeto = new Set<string>();
  for (const [codigo, neto] of netoPre) {
    if (Math.abs(neto) > TOLERANCIA_NETO) kardexNeto.add(codigo);
  }

  // Cíclico (Alm_InvCic, por código) dentro de la ventana.
  const ciclicoEnVentana = new Set<string>();
  for (const f of fuentes.almInvCic) {
    if (!dentroVentana(parsearFecha(f.FechaIC), ventana)) continue;
    const codigo = limpio(f.ModeloIC).toUpperCase();
    if (codigo !== '') ciclicoEnVentana.add(codigo);
  }

  // ── 4) Unión de modelos en ambos espacios + CONSTANCIA de lo excluido con existencia ─────
  const codigosDocs = new Set<string>();
  for (const id of modelosId) {
    const codigo = codigoPorId.get(id);
    if (codigo !== undefined) codigosDocs.add(codigo);
  }
  // CRITERIO DEL DUEÑO: SOLO actividad en la ventana. La existencia pre-corte NO entra.
  const modelosCodigo = new Set<string>([...codigosDocs, ...kardexEnVentana, ...ciclicoEnVentana]);
  // CONSTANCIA: excluidos que SÍ traían existencia (inventario que se deja de migrar).
  const modelosExcluidosConExistencia = new Set<string>();
  for (const codigo of [...kardexNeto, ...kardexExistencia]) {
    if (!modelosCodigo.has(codigo)) modelosExcluidosConExistencia.add(codigo);
  }
  for (const codigo of modelosCodigo) {
    const id = idPorCodigo.get(codigo);
    if (id !== undefined) modelosId.add(id);
  }
  // Existencia estimada por código (SOLO constancia de lo excluido): el neto CALCULADO manda;
  // si el código solo apareció en el snapshot, la suma del snapshot.
  const existenciaPtEstimadaPorCodigo = new Map<string, number>();
  for (const [codigo, snapshot] of snapshotPorCodigo) {
    existenciaPtEstimadaPorCodigo.set(codigo, snapshot);
  }
  for (const [codigo, neto] of netoPre) {
    existenciaPtEstimadaPorCodigo.set(codigo, neto);
  }

  // ── 5) BOM de los modelos usados → telas (IdTelasDis) / avíos / bordados ──────────────────
  const aviosId = new Set<string>();
  const bordadosId = new Set<string>();
  for (const f of fuentes.modelosTela) {
    if (!modelosId.has(limpio(f.IdModelos))) continue;
    const idTelaDis = limpio(f.IdTelasDis);
    if (esClave(idTelaDis)) telasIdTelasDis.add(idTelaDis);
  }
  for (const f of fuentes.modelosHab) {
    if (!modelosId.has(limpio(f.IdModelos))) continue;
    const idAvio = limpio(f.IdHabilitacion);
    if (esClave(idAvio)) aviosId.add(idAvio);
  }
  for (const f of fuentes.modelosBor) {
    if (!modelosId.has(limpio(f.IdModelos))) continue;
    const idBordado = limpio(f.IdBordados);
    if (esClave(idBordado)) bordadosId.add(idBordado);
  }

  // ── 6) Telas: USADO = movimiento ≥ corte (cabecera `Entradas`/`Salidas.IdTela` y renglones).
  // El neto pre-corte y el snapshot `TelasColAlm` YA NO deciden (criterio del dueño): se calculan
  // SOLO como CONSTANCIA del inventario de tela que se deja fuera.
  for (const f of [...fuentes.entradas, ...fuentes.salidas]) {
    if (!dentroVentana(parsearFechaSoloDia(f.Fecha), ventana)) continue;
    const idTela = limpio(f.IdTela);
    if (esClave(idTela)) telasIdTelas.add(idTela);
  }
  const idTelasPorTelaColor = new Map<string, string>(); // IdTelasColores → IdTelas
  for (const f of fuentes.telasColores) {
    const id = limpio(f.IdTelasColores);
    const idTelas = limpio(f.IdTelas);
    if (id !== '' && esClave(idTelas)) idTelasPorTelaColor.set(id, idTelas);
  }
  const idTelasPorColAlm = new Map<string, string>(); // IdTelasColAlm → IdTelas
  const snapshotTelaPorId = new Map<string, number>(); // Σ TelasColAlm.ExTela1+2 por IdTelas
  for (const f of fuentes.telasColAlm) {
    const idColAlm = limpio(f.IdTelasColAlm);
    const idTelas = idTelasPorTelaColor.get(limpio(f.IdTelasColores));
    if (idColAlm !== '' && idTelas !== undefined) idTelasPorColAlm.set(idColAlm, idTelas);
    // Snapshot: NO decide (ya no es criterio); solo alimenta la constancia de lo excluido.
    const ex = (parsearDinero(f.ExTela1) ?? 0) + (parsearDinero(f.ExTela2) ?? 0);
    if (idTelas !== undefined && ex !== 0) {
      snapshotTelaPorId.set(idTelas, (snapshotTelaPorId.get(idTelas) ?? 0) + ex);
    }
  }
  // Neto pre-corte por tela desde EntradasDet/SalidasDet (cadena IdTelasColAlm→TelasColores→
  // IdTelas), con LA MISMA criba del ETL de telas: cantidad = cant1+cant2 > 0, cadena completa,
  // documento sin fecha parseable omitido. Entrada suma, salida resta; los traspasos del viejo
  // son pares entrada+salida de la MISMA tela → se cancelan a nivel tela (no distorsionan).
  const netoTelaPre = new Map<string, number>();
  const acumularNetoTela = (
    dets: FilaCsv[],
    fechaPorDoc: Map<string, Date | null>,
    colDoc: string,
    col1: string,
    col2: string,
    signo: number,
  ): void => {
    for (const f of dets) {
      const fecha = fechaPorDoc.get(limpio(f[colDoc]));
      if (fecha === undefined || fecha === null) continue; // doc inexistente o sin fecha (el ETL lo omite)
      const cantidad = (parsearDinero(f[col1]) ?? 0) + (parsearDinero(f[col2]) ?? 0);
      if (cantidad <= 0) continue; // renglón en ceros: no aporta movimiento (igual que el ETL)
      const idTelas = idTelasPorColAlm.get(limpio(f.IdTelasColAlm));
      if (idTelas === undefined) continue; // cadena rota: el ETL de telas ya la reporta
      if (dentroVentana(fecha, ventana)) {
        telasIdTelas.add(idTelas); // movimiento en ventana visto desde el renglón (superset)
        continue;
      }
      netoTelaPre.set(idTelas, (netoTelaPre.get(idTelas) ?? 0) + signo * cantidad);
    }
  };
  const fechaEntradaPorDoc = new Map<string, Date | null>();
  for (const f of fuentes.entradas) {
    const id = limpio(f.IdEntradas);
    if (id !== '') fechaEntradaPorDoc.set(id, parsearFechaSoloDia(f.Fecha));
  }
  const fechaSalidaPorDoc = new Map<string, Date | null>();
  for (const f of fuentes.salidas) {
    const id = limpio(f.IdSalidas);
    if (id !== '') fechaSalidaPorDoc.set(id, parsearFechaSoloDia(f.Fecha));
  }
  acumularNetoTela(
    fuentes.entradasDet,
    fechaEntradaPorDoc,
    'IdEntradas',
    'TelaEnt1',
    'TelaEnt2',
    1,
  );
  acumularNetoTela(fuentes.salidasDet, fechaSalidaPorDoc, 'IdSalidas', 'TelaSal1', 'TelaSal2', -1);
  // CRITERIO DEL DUEÑO: el neto pre-corte NO mete la tela al set. Solo deja CONSTANCIA de la
  // existencia de tela que se deja de migrar (se resuelve tras cerrar el set, más abajo).
  const existenciaTelaEstimadaPorId = new Map<string, number>();
  for (const [idTelas, snapshot] of snapshotTelaPorId) {
    existenciaTelaEstimadaPorId.set(idTelas, snapshot);
  }
  for (const [idTelas, neto] of netoTelaPre) {
    existenciaTelaEstimadaPorId.set(idTelas, neto);
  }

  // ── 7) Proveedores: OC/notas por fecha; terceros por cascada de órdenes migradas; EsMa
  // SOLO con movimiento en ventana (el criterio grueso de "cuenta EsMa" quedó retirado) ───────
  for (const f of fuentes.ordCompra) {
    if (!dentroVentana(parsearFechaSoloDia(f.Fecha), ventana)) continue;
    const idProv = limpio(f.IdProveedor);
    if (esClave(idProv)) provIdProveedor.add(idProv);
  }
  for (const f of fuentes.notas) {
    if (!dentroVentana(parsearFechaSoloDia(f.FechaElaboracion), ventana)) continue;
    const idMaq = limpio(f.IdMaquileros);
    if (esClave(idMaq)) provIdMaquileros.add(idMaq);
  }
  for (const f of [...fuentes.entregas, ...fuentes.recibos]) {
    if (f2.ordenesFuera.has(limpio(f.IdOrdenes))) continue;
    const idMaq = limpio(f.IdMaquileros);
    if (esClave(idMaq)) provIdMaquileros.add(idMaq);
  }
  // OJO: en EntregasEst/RecibosEst la columna se llama IdMaquileros pero su espacio es
  // ESTAMPADORES (así lo mapea F3: `proveedorPorIdEstampadores`).
  for (const f of [...fuentes.entregasEst, ...fuentes.recibosEst]) {
    if (f2.ordenesFuera.has(limpio(f.IdOrdenes))) continue;
    const idEst = limpio(f.IdMaquileros);
    if (esClave(idEst)) provIdEstampadores.add(idEst);
  }
  for (const f of fuentes.corte) {
    if (f2.ordenesFuera.has(limpio(f.IdOrdenes))) continue;
    const idCort = limpio(f.IdCortadores);
    if (esClave(idCort)) provIdCortadores.add(idCort);
  }
  // EsMa: SOLO movimientos DENTRO de la ventana (`FechaEsMa` ≥ corte). El criterio grueso
  // anterior ("cualquiera con cuenta EsMa") quedó RETIRADO por decisión del dueño: retenía
  // 334/496 maquileros por saldo viejo. Fecha nula = dentro (regla de `dentroVentana`).
  for (const f of fuentes.esMa) {
    if (!dentroVentana(parsearFecha(f.FechaEsMa), ventana)) continue;
    const idMaq = limpio(f.IdMaquileros);
    if (esClave(idMaq)) provIdMaquileros.add(idMaq);
  }
  for (const f of fuentes.ccAuditorias) {
    if (f2.ordenesFuera.has(limpio(f.IdOrdenes))) continue;
    const idMaq = limpio(f.IdMaquilero);
    if (esClave(idMaq)) provIdMaquileros.add(idMaq);
  }

  // ── 8) Proveedor TEXTO de telas/avíos usados (match por nombre, igual que los loaders) ────
  const provNombres = new Set<string>();
  for (const f of fuentes.telasDis) {
    if (!telasIdTelasDis.has(limpio(f.IdTelasDis))) continue;
    const norm = normalizarParaDedup(f.Proveedor);
    if (norm !== '') provNombres.add(norm);
  }
  for (const f of fuentes.habilitacion) {
    if (!aviosId.has(limpio(f.IdHabilitacion))) continue;
    const norm = normalizarParaDedup(f.Proveedor);
    if (norm !== '') provNombres.add(norm);
  }

  // CONSTANCIA final: telas excluidas que SÍ traían existencia pre-corte (inventario de tela
  // que se deja de migrar). Se calcula con el set ya cerrado.
  const telasExcluidasConExistencia = new Set<string>();
  for (const [idTelas, existencia] of existenciaTelaEstimadaPorId) {
    if (Math.abs(existencia) > TOLERANCIA_NETO && !telasIdTelas.has(idTelas)) {
      telasExcluidasConExistencia.add(idTelas);
    }
  }

  return {
    f2,
    modelosId,
    modelosCodigo,
    modelosExcluidosConExistencia,
    telasExcluidasConExistencia,
    telasIdTelas,
    telasIdTelasDis,
    aviosId,
    bordadosId,
    provIdProveedor,
    provIdMaquileros,
    provIdEstampadores,
    provIdCortadores,
    provNombres,
    existenciaPtEstimadaPorCodigo,
    existenciaTelaEstimadaPorId,
  };
}

/**
 * Prescan de uso desde los CSV reales. `null` con ventana INACTIVA (cero costo, cero cambio).
 * Se calcula UNA vez por corrida (los orquestadores lo comparten entre loaders; un loader
 * llamado suelto lo recalcula solo si su ventana está activa).
 */
export function prescanUso(ventana: ConfigVentana): PrescanUso | null {
  if (ventana.corte === null) return null;
  return calcularPrescanUso(ventana, {
    pedidos: leerCsv('Pedidos.csv'),
    pedidosDet: leerCsv('PedidosDet.csv'),
    ordenes: leerCsv('Ordenes.csv'),
    modelos: leerCsv('Modelos.csv'),
    iptModelos: leerCsv('IPT_Modelos.csv'),
    iptModAlm: leerCsv('IPT_Mod_Alm.csv'),
    iptMovs: leerCsv('IPT_Movs.csv'),
    iptMovsDet: leerCsv('IPT_MovsDet.csv'),
    almInvCic: leerCsv('Alm_InvCic.csv'),
    modelosTela: leerCsv('ModelosTela.csv'),
    modelosHab: leerCsv('ModelosHab.csv'),
    modelosBor: leerCsv('ModelosBor.csv'),
    entradas: leerCsv('Entradas.csv'),
    entradasDet: leerCsv('EntradasDet.csv'),
    salidas: leerCsv('Salidas.csv'),
    salidasDet: leerCsv('SalidasDet.csv'),
    telasColAlm: leerCsv('TelasColAlm.csv'),
    telasColores: leerCsv('TelasColores.csv'),
    telasDis: leerCsv('TelasDis.csv'),
    habilitacion: leerCsv('Habilitacion.csv'),
    ordCompra: leerCsv('OrdCompra.csv'),
    notas: leerCsv('Notas.csv'),
    entregas: leerCsv('Entregas.csv'),
    recibos: leerCsv('Recibos.csv'),
    entregasEst: leerCsv('EntregasEst.csv'),
    recibosEst: leerCsv('RecibosEst.csv'),
    corte: leerCsv('Corte.csv'),
    esMa: leerCsv('EsMa.csv'),
    ccAuditorias: leerCsv('CC_Auditorias.csv'),
  });
}
