/**
 * Unit (sin BD, sin disco) del PRESCAN de USO de catálogos: modelos por documentos/kardex/
 * existencia/cíclico (con el puente id↔código), cascada al BOM (telas/avíos/bordados),
 * telas por movimiento/existencia y proveedores por espacio de id + nombre.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { calcularPrescanUso, type FuentesPrescanUso } from './prescan-uso.js';
import { resolverVentana } from './ventana.js';

let desdePrevio: string | undefined;

beforeEach(() => {
  desdePrevio = process.env.ETL_DESDE;
  process.env.ETL_DESDE = '2025-01-01';
});

afterEach(() => {
  if (desdePrevio === undefined) delete process.env.ETL_DESDE;
  else process.env.ETL_DESDE = desdePrevio;
});

/**
 * Fixture chica pero completa:
 *  • Modelo 1 (M-A): en pedido dentro de ventana → usado por documentos.
 *  • Modelo 2 (M-B): solo kardex PRE-corte con neto ≠ 0 → usado SOLO por existencia.
 *  • Modelo 3 (M-C): solo pedido FUERA de ventana y kardex pre-corte con neto 0 → NO usado.
 *  • Modelo 4 (M-D): movimiento de kardex DENTRO de la ventana → usado (con actividad).
 *  • Telas: dis 71 en BOM de modelo usado; IdTelas 81 con entrada ≥ corte; IdTelas 82 con
 *    existencia en TelasColAlm; IdTelas 83 sin nada → fuera.
 *  • Avío 61 en BOM de modelo usado; avío 62 en BOM del modelo NO usado → fuera.
 *  • Proveedores: OC en ventana (IdProveedor 11); maquilero 21 con recibo de orden migrada;
 *    maquilero 22 solo en EsMa (criterio grueso); estampador 31 (EntregasEst de orden
 *    migrada); cortador 41 (Corte de orden migrada); nombre "Prov Tela SA" por TelasDis 71.
 */
function fuentes(): FuentesPrescanUso {
  return {
    pedidos: [
      { IdPedidos: '10', IdClientes: '1', FechaPedido: '15/02/2025 00:00:00' }, // dentro
      { IdPedidos: '11', IdClientes: '2', FechaPedido: '01/06/2019 00:00:00' }, // fuera
    ],
    pedidosDet: [
      { IdPedidosDet: '100', IdPedidos: '10', IdModelos: '1' }, // modelo 1 usado por docs
      { IdPedidosDet: '110', IdPedidos: '11', IdModelos: '3' }, // pedido fuera → no aporta
    ],
    ordenes: [
      // Orden dentro, huérfana: usa modelo 1, tela dis 72, maquilero 21.
      {
        IdOrdenes: '500',
        IdPedidosDet: '0',
        IdModelos: '1',
        IdTelasDis: '72',
        IdMaquileros: '21',
        IdClientes: '1',
        Fecha: '10/02/2025 00:00:00',
      },
      // Orden fuera (fecha vieja).
      {
        IdOrdenes: '501',
        IdPedidosDet: '0',
        IdModelos: '3',
        IdTelasDis: '73',
        IdMaquileros: '23',
        IdClientes: '1',
        Fecha: '01/01/2018 00:00:00',
      },
    ],
    modelos: [
      { IdModelos: '1', Modelo: 'M-A' },
      { IdModelos: '2', Modelo: 'M-B' },
      { IdModelos: '3', Modelo: 'M-C' },
      { IdModelos: '4', Modelo: 'M-D' },
      { IdModelos: '5', Modelo: 'M-E' },
    ],
    iptModelos: [
      { IdIPT_Modelos: '900', NumMod: 'M-B' },
      { IdIPT_Modelos: '901', NumMod: 'M-C' },
      { IdIPT_Modelos: '902', NumMod: 'M-D' },
      { IdIPT_Modelos: '903', NumMod: 'M-E' },
    ],
    iptModAlm: [
      { IdIPT_Mod_Alm: '950', IdIPT_Modelos: '900', Existencia: '0' },
      { IdIPT_Mod_Alm: '951', IdIPT_Modelos: '901', Existencia: '0' },
      { IdIPT_Mod_Alm: '952', IdIPT_Modelos: '902', Existencia: '0' },
      { IdIPT_Mod_Alm: '953', IdIPT_Modelos: '903', Existencia: '0' },
    ],
    iptMovs: [
      { IdIPT_Movs: 'm1', Fecha: '01/03/2020 00:00:00', EnSa: '1' }, // pre-corte entrada
      { IdIPT_Movs: 'm2', Fecha: '01/04/2020 00:00:00', EnSa: '2' }, // pre-corte salida
      { IdIPT_Movs: 'm3', Fecha: '15/03/2025 00:00:00', EnSa: '2' }, // DENTRO de la ventana
      // Nota 4: EnSa VACÍO pero tipo 1 = inventario-inicial (entrada canónica) → el signo lo
      // decide el TIPO (como el ETL), no el EnSa.
      { IdIPT_Movs: 'm4', Fecha: '01/05/2020 00:00:00', IdIPT_TipoMov: '1', EnSa: '' },
    ],
    iptMovsDet: [
      { IdIPT_MovsDet: 'd1', IdIPT_Movs: 'm1', IdIPT_Mod_Alm: '950', CantMov: '10' }, // M-B +10
      { IdIPT_MovsDet: 'd2', IdIPT_Movs: 'm2', IdIPT_Mod_Alm: '950', CantMov: '4' }, // M-B −4 → neto 6
      { IdIPT_MovsDet: 'd3', IdIPT_Movs: 'm1', IdIPT_Mod_Alm: '951', CantMov: '5' }, // M-C +5
      { IdIPT_MovsDet: 'd4', IdIPT_Movs: 'm2', IdIPT_Mod_Alm: '951', CantMov: '5' }, // M-C −5 → neto 0
      { IdIPT_MovsDet: 'd5', IdIPT_Movs: 'm3', IdIPT_Mod_Alm: '952', CantMov: '2' }, // M-D en ventana
      { IdIPT_MovsDet: 'd6', IdIPT_Movs: 'm4', IdIPT_Mod_Alm: '953', CantMov: '3' }, // M-E +3 (por tipo)
    ],
    almInvCic: [],
    modelosTela: [
      { IdModelosTela: 't1', IdModelos: '1', IdTelasDis: '71' }, // BOM de modelo usado
      { IdModelosTela: 't2', IdModelos: '3', IdTelasDis: '73' }, // modelo NO usado
    ],
    modelosHab: [
      { IdModelosHab: 'h1', IdModelos: '1', IdHabilitacion: '61' },
      { IdModelosHab: 'h2', IdModelos: '3', IdHabilitacion: '62' },
    ],
    modelosBor: [
      { IdModelosBor: 'b1', IdModelos: '2', IdBordados: '51' }, // BOM del modelo "solo existencia"
      { IdModelosBor: 'b2', IdModelos: '3', IdBordados: '52' },
    ],
    entradas: [
      { IdEntradas: 'e1', Fecha: '05/02/2025 00:00:00', IdTela: '81' }, // ≥ corte → usada
      { IdEntradas: 'e2', Fecha: '05/02/2019 00:00:00', IdTela: '83' }, // pre-corte → no aporta
      { IdEntradas: 'e3', Fecha: '05/02/2020 00:00:00', IdTela: '84' }, // pre-corte, con renglones
    ],
    // BLOQUEANTE del reviewer: tela 84 con NETO pre-corte ≠ 0 CALCULADO desde los renglones,
    // SIN snapshot en TelasColAlm (ExTela=0) — debe quedar usada por el neto, no por el snapshot.
    entradasDet: [
      { IdEntradasDet: 'ed1', IdEntradas: 'e3', IdTelasColAlm: 'c3', TelaEnt1: '7', TelaEnt2: '0' },
      { IdEntradasDet: 'ed2', IdEntradas: 'e2', IdTelasColAlm: 'c2', TelaEnt1: '5', TelaEnt2: '0' }, // tela 83 +5
    ],
    salidas: [{ IdSalidas: 's1', Fecha: '06/02/2019 00:00:00', IdTela: '83' }],
    salidasDet: [
      { IdSalidasDet: 'sd1', IdSalidas: 's1', IdTelasColAlm: 'c2', TelaSal1: '5', TelaSal2: '0' }, // tela 83 −5 → neto 0
    ],
    telasColAlm: [
      { IdTelasColAlm: 'c1', IdTelasColores: 'tc1', ExTela1: '3.5', ExTela2: '0' }, // existencia
      { IdTelasColAlm: 'c2', IdTelasColores: 'tc2', ExTela1: '0', ExTela2: '0' },
      { IdTelasColAlm: 'c3', IdTelasColores: 'tc3', ExTela1: '0', ExTela2: '0' }, // SIN snapshot
    ],
    telasColores: [
      { IdTelasColores: 'tc1', IdTelas: '82', Color: 'ROJO' },
      { IdTelasColores: 'tc2', IdTelas: '83', Color: 'AZUL' },
      { IdTelasColores: 'tc3', IdTelas: '84', Color: 'VERDE' },
    ],
    telasDis: [
      { IdTelasDis: '71', TelaDis: 'FELPA X', Proveedor: 'Prov Tela SA' },
      { IdTelasDis: '73', TelaDis: 'VIEJA Y', Proveedor: 'Prov Viejo SA' },
    ],
    habilitacion: [
      { IdHabilitacion: '61', Clave: 'BTN-1', Proveedor: 'Prov Avio SA' },
      { IdHabilitacion: '62', Clave: 'BTN-2', Proveedor: 'Prov Avio Viejo' },
    ],
    ordCompra: [
      { IdOrdCompra: 'oc1', IdProveedor: '11', Fecha: '20/01/2025 00:00:00' }, // dentro
      { IdOrdCompra: 'oc2', IdProveedor: '12', Fecha: '20/01/2019 00:00:00' }, // fuera
    ],
    notas: [],
    entregas: [],
    recibos: [{ IdRecibos: 'r1', IdOrdenes: '500', IdMaquileros: '21' }], // orden migrada
    entregasEst: [{ IdEntregasEst: 'ee1', IdOrdenes: '500', IdMaquileros: '31' }], // espacio Estampadores
    recibosEst: [],
    corte: [
      { IdCorte: 'co1', IdOrdenes: '500', IdCortadores: '41' },
      { IdCorte: 'co2', IdOrdenes: '501', IdCortadores: '42' }, // orden fuera → no aporta
    ],
    esMa: [{ IdEsMa: 'es1', IdMaquileros: '22', FechaEsMa: '01/01/2010 00:00:00' }], // grueso
    ccAuditorias: [],
  };
}

describe('calcularPrescanUso — modelos', () => {
  it('SOLO actividad en la ventana: documentos ∪ kardex ≥ corte ∪ cíclico (la existencia NO cuenta)', () => {
    const p = calcularPrescanUso(resolverVentana(), fuentes());
    // 1 (M-A) por pedido en ventana; 4 (M-D) por movimiento ≥ corte. 2 (M-B) y 5 (M-E) tienen
    // existencia pre-corte pero NINGUNA actividad → FUERA (criterio del dueño). 3 (M-C): nada.
    expect(p.modelosId).toEqual(new Set(['1', '4']));
    expect(p.modelosCodigo.has('M-A')).toBe(true);
    expect(p.modelosCodigo.has('M-D')).toBe(true);
    expect(p.modelosCodigo.has('M-B')).toBe(false); // neto 6 pre-corte, pero sin actividad
    expect(p.modelosCodigo.has('M-E')).toBe(false); // idem (neto 3 por tipo)
    expect(p.modelosCodigo.has('M-C')).toBe(false);
  });

  it('deja CONSTANCIA del inventario excluido (con su existencia estimada)', () => {
    const p = calcularPrescanUso(resolverVentana(), fuentes());
    expect(p.modelosExcluidosConExistencia).toEqual(new Set(['M-B', 'M-E']));
    expect(p.existenciaPtEstimadaPorCodigo.get('M-B')).toBe(6);
    expect(p.existenciaPtEstimadaPorCodigo.get('M-E')).toBe(3);
    // M-C tenía neto 0: ni entra ni figura como inventario perdido.
    expect(p.modelosExcluidosConExistencia.has('M-C')).toBe(false);
  });

  it('nota 4: el signo del neto PT (para la constancia) lo decide el TIPO, no el EnSa', () => {
    const p = calcularPrescanUso(resolverVentana(), fuentes());
    // m4 es tipo 1 (inventario-inicial) con EnSa VACÍO: si el signo dependiera del EnSa el neto
    // sería 0 y M-E no figuraría como inventario dejado fuera.
    expect(p.existenciaPtEstimadaPorCodigo.get('M-E')).toBe(3);
    expect(p.modelosExcluidosConExistencia.has('M-E')).toBe(true);
  });
});

describe('calcularPrescanUso — cascada BOM y telas', () => {
  it('telas/avíos/bordados del BOM siguen a su modelo usado', () => {
    const p = calcularPrescanUso(resolverVentana(), fuentes());
    expect(p.telasIdTelasDis).toEqual(new Set(['71', '72'])); // BOM de usado + orden en ventana
    expect(p.aviosId).toEqual(new Set(['61']));
    // El bordado 51 colgaba de M-B, que ahora queda FUERA → el BOM se encoge solo.
    expect(p.bordadosId).toEqual(new Set([]));
  });

  it('telas SOLO por movimiento ≥ corte (existencia/neto pre-corte ya NO cuentan)', () => {
    const p = calcularPrescanUso(resolverVentana(), fuentes());
    // 81 por movimiento ≥ corte. 82 (snapshot) y 84 (neto +7) quedan FUERA: sin actividad.
    expect(p.telasIdTelas).toEqual(new Set(['81']));
  });

  it('deja CONSTANCIA de las telas excluidas que traían existencia', () => {
    const p = calcularPrescanUso(resolverVentana(), fuentes());
    expect(p.telasExcluidasConExistencia).toEqual(new Set(['82', '84']));
    expect(p.existenciaTelaEstimadaPorId.get('84')).toBe(7); // neto calculado
    expect(p.telasExcluidasConExistencia.has('83')).toBe(false); // neto 0
  });
});

describe('calcularPrescanUso — proveedores', () => {
  it('OC por fecha; maquilero/estampador/cortador por cascada; EsMa SOLO con fecha ≥ corte', () => {
    const p = calcularPrescanUso(resolverVentana(), fuentes());
    expect(p.provIdProveedor).toEqual(new Set(['11']));
    // 21 por recibo de orden migrada; 22 tiene cuenta EsMa VIEJA (2010) → ya NO entra
    // (criterio grueso retirado); 23: su orden quedó fuera.
    expect(p.provIdMaquileros).toEqual(new Set(['21']));
    expect(p.provIdEstampadores).toEqual(new Set(['31']));
    expect(p.provIdCortadores).toEqual(new Set(['41'])); // 42: orden fuera
  });

  it('un maquilero con movimiento EsMa DENTRO de la ventana sí entra', () => {
    const base = fuentes();
    const p = calcularPrescanUso(resolverVentana(), {
      ...base,
      esMa: [...base.esMa, { IdEsMa: 'es2', IdMaquileros: '24', FechaEsMa: '10/03/2025 00:00:00' }],
    });
    expect(p.provIdMaquileros.has('24')).toBe(true);
  });

  it('proveedor TEXTO de telas/avíos usados entra por nombre normalizado', () => {
    const p = calcularPrescanUso(resolverVentana(), fuentes());
    expect(p.provNombres.has('prov tela sa')).toBe(true);
    expect(p.provNombres.has('prov avio sa')).toBe(true);
    expect(p.provNombres.has('prov viejo sa')).toBe(false); // su tela no se usa
  });
});
