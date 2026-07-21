/**
 * PRESCAN de USO de catálogos (recarga limitada por fecha — pedido del dueño: "hay muchísimos
 * modelos y ya no me sirven" → con la ventana ACTIVA solo migran los catálogos GRANDES que
 * de verdad se USAN en la ventana; el resto se cuenta como `fueraVentana`, nada en silencio).
 *
 * Extiende el patrón de `ventana-f2.ts` (clientes por uso) a modelos/telas/avíos/bordados/
 * proveedores. Lee los CSV del viejo (CP850, `leerCsv`) UNA vez y arma los sets de claves v1
 * "usadas". Definición de USADO (unión de fuentes):
 *
 *  • MODELO: referenciado por pedidos/órdenes DENTRO de la ventana (cascada de
 *    `ventana-f2.ts`) ∪ con movimiento de kardex PT con fecha ≥ corte ∪ con EXISTENCIA
 *    (neto de kardex pre-corte ≠ 0 por cadena IPT_Movs→IPT_MovsDet→IPT_Mod_Alm→IPT_Modelos
 *    →NumMod, con EnSa 1=entrada/2=salida, y además el snapshot `IPT_Mod_Alm.Existencia`≠0
 *    — su saldo inicial lo va a necesitar) ∪ referenciado por el cíclico (`Alm_InvCic`,
 *    por CÓDIGO `ModeloIC`) dentro de la ventana. OJO: el kardex/cíclico referencian por
 *    CÓDIGO y los documentos por `IdModelos` → los sets van en AMBOS espacios, cruzados vía
 *    `Modelos.csv`. Los que migran SOLO por existencia (sin actividad en ventana) se separan
 *    en `modelosSoloExistencia` (lista para Daniel: candidatos a depurar).
 *  • TELA: en el BOM de un modelo usado (`ModelosTela`→IdTelasDis) ∪ referenciada por una
 *    orden dentro de la ventana (`Ordenes.IdTelasDis`) ∪ con movimiento ≥ corte
 *    (`Entradas`/`Salidas`, espacio IdTelas) ∪ con EXISTENCIA (snapshot `TelasColAlm`
 *    ExTela1/2 ≠ 0, vía `TelasColores`→IdTelas). Las OC/notas legacy NO aportan telas (sus
 *    renglones son TEXTO LIBRE, sin FK a catálogo).
 *  • AVÍO: en el BOM de un modelo usado (`ModelosHab`→IdHabilitacion). (OC/notas: texto
 *    libre, no referencian avíos por id.)
 *  • BORDADO: en el BOM de un modelo usado (`ModelosBor`→IdBordados).
 *  • PROVEEDOR (4 espacios de id + nombres): OC dentro de ventana (IdProveedor) ∪ proveedor
 *    TEXTO de tela/avío usado (match por `normalizarParaDedup`, igual que los loaders) ∪
 *    MAQUILERO con actividad de órdenes migradas (Ordenes/Entregas/Recibos/Notas/auditorías)
 *    o presente en EsMa (criterio GRUESO del saldo: el asiento inicial de EsMa lo necesita)
 *    ∪ ESTAMPADOR de EntregasEst/RecibosEst de órdenes migradas (la columna se llama
 *    IdMaquileros pero es espacio Estampadores) ∪ CORTADOR de `Corte` de órdenes migradas.
 *  • COLORES: NO se filtran (quedan COMPLETOS, decisión declarada): son chicos comparados
 *    con modelos y los referencian por texto libre múltiples fuentes (OrdenesDet, lotes de
 *    tela por color) — filtrarlos arriesga dejar fuera uno que un saldo inicial necesita.
 *  • SIEMPRE completos: empresas, almacenes, géneros, temporadas, etiquetas de marca,
 *    tela-categorías, tallas/curvas (chicos/estructurales).
 *
 * RED DE SEGURIDAD: si este prescan dejara fuera algo que un ETL posterior sí necesita, ese
 * ETL ya REPORTA el mapeo faltante como incidencia (nunca silencioso) — el hueco se ve en el
 * reporte y se corrige re-corriendo sin ventana o afinando el criterio.
 *
 * Con la ventana INACTIVA devuelve `null` y todo migra completo (invariante: sin `ETL_DESDE`
 * nada cambia).
 */
import { leerCsv, type FilaCsv } from './csv.js';
import {
  normalizarParaDedup,
  parsearDinero,
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
  /** Códigos que migran SOLO por existencia PT (sin docs/kardex≥corte/cíclico) — lista para Daniel. */
  modelosSoloExistencia: Set<string>;
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
  salidas: FilaCsv[];
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

  // ── 3) Kardex PT por código: movimiento ≥ corte, neto pre-corte y existencia snapshot ─────
  const codigoPorIptModelo = new Map<string, string>(); // IdIPT_Modelos → NumMod
  for (const f of fuentes.iptModelos) {
    const id = limpio(f.IdIPT_Modelos);
    const numMod = limpio(f.NumMod).toUpperCase();
    if (id !== '' && numMod !== '') codigoPorIptModelo.set(id, numMod);
  }
  const iptModeloPorModAlm = new Map<string, string>(); // IdIPT_Mod_Alm → IdIPT_Modelos
  const kardexExistencia = new Set<string>();
  for (const f of fuentes.iptModAlm) {
    const id = limpio(f.IdIPT_Mod_Alm);
    const idIptModelo = limpio(f.IdIPT_Modelos);
    if (id !== '' && idIptModelo !== '') iptModeloPorModAlm.set(id, idIptModelo);
    const existencia = parsearDinero(f.Existencia) ?? 0;
    if (Math.abs(existencia) > TOLERANCIA_NETO) {
      const codigo = codigoPorIptModelo.get(idIptModelo);
      if (codigo !== undefined) kardexExistencia.add(codigo);
    }
  }
  const movCrudo = new Map<string, { fecha: Date | null; enSa: string }>(); // IdIPT_Movs
  for (const f of fuentes.iptMovs) {
    const id = limpio(f.IdIPT_Movs);
    if (id === '') continue;
    movCrudo.set(id, { fecha: parsearFecha(f.Fecha), enSa: limpio(f.EnSa) });
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
    // Pre-corte: acumular el neto (EnSa 1=entrada, 2=salida — mismo criterio que etl-ipt).
    const cant = parsearDinero(f.CantMov) ?? 0;
    const signo = mov.enSa === '1' ? 1 : mov.enSa === '2' ? -1 : 0;
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

  // ── 4) Unión de modelos en ambos espacios + "solo existencia" (lista para Daniel) ─────────
  const codigosDocs = new Set<string>();
  for (const id of modelosId) {
    const codigo = codigoPorId.get(id);
    if (codigo !== undefined) codigosDocs.add(codigo);
  }
  const modelosCodigo = new Set<string>([
    ...codigosDocs,
    ...kardexEnVentana,
    ...kardexNeto,
    ...kardexExistencia,
    ...ciclicoEnVentana,
  ]);
  const modelosSoloExistencia = new Set<string>();
  for (const codigo of [...kardexNeto, ...kardexExistencia]) {
    if (!codigosDocs.has(codigo) && !kardexEnVentana.has(codigo) && !ciclicoEnVentana.has(codigo)) {
      modelosSoloExistencia.add(codigo);
    }
  }
  for (const codigo of modelosCodigo) {
    const id = idPorCodigo.get(codigo);
    if (id !== undefined) modelosId.add(id);
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

  // ── 6) Telas por movimiento ≥ corte (Entradas/Salidas) y existencia (TelasColAlm) ─────────
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
  for (const f of fuentes.telasColAlm) {
    const ex = (parsearDinero(f.ExTela1) ?? 0) + (parsearDinero(f.ExTela2) ?? 0);
    if (Math.abs(ex) <= TOLERANCIA_NETO) continue;
    const idTelas = idTelasPorTelaColor.get(limpio(f.IdTelasColores));
    if (idTelas !== undefined) telasIdTelas.add(idTelas);
  }

  // ── 7) Proveedores: OC/notas por fecha; terceros por cascada de órdenes migradas; EsMa ────
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
  // EsMa: criterio GRUESO — cualquier maquilero con cuenta EsMa se conserva (su saldo inicial
  // pre-corte lo va a necesitar; calcular el saldo exacto aquí duplicaría el ETL de F6).
  for (const f of fuentes.esMa) {
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

  return {
    f2,
    modelosId,
    modelosCodigo,
    modelosSoloExistencia,
    telasIdTelas,
    telasIdTelasDis,
    aviosId,
    bordadosId,
    provIdProveedor,
    provIdMaquileros,
    provIdEstampadores,
    provIdCortadores,
    provNombres,
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
    salidas: leerCsv('Salidas.csv'),
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
