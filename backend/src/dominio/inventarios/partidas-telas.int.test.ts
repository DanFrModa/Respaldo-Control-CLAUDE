/**
 * Tests de integración del INVENTARIO de TELAS NUEVO por COLOR (etapa A2 — partidas + existencia
 * tela×color + kardex de dos componentes). Postgres efímero (testcontainers). 16 casos que cubren:
 *  (a) el ajuste de ENTRADA crea UNA PARTIDA por renglón con FOLIO consecutivo POR EMPRESA (A3),
 *      incluso con el MISMO tela+color repetido en dos renglones (dos lotes de una factura =
 *      dos partidas — DECISIONES §Post-F9.11 punto 4);
 *  (b) cuerpo y complemento viajan JUNTOS (entrada de solo complemento = cuerpo 0) y la tela sin
 *      complemento RECHAZA cantidad de complemento;
 *  (c) la salida valida no-negativo de AMBOS componentes bajo lock (D3, suma directa);
 *  (d) la salida a orden empareja por color (sin partida) y conserva la traza origenId;
 *  (e) traspaso atómico (dos patas) con ambas cantidades y validación del origen;
 *  (f) cancelación = movimiento INVERSO que copia las dimensiones nuevas (el saldo por color se
 *      neutraliza) y no se re-cancela;
 *  (g) existencias agrupadas TELA PADRE → colores → almacenes (vista existencia_tela_color);
 *  (h) kardex cronológico con saldo corrido de los DOS componentes;
 *  (i) búsqueda de partidas por folio / lote del proveedor / factura;
 *  (k) CONTEO físico (fila 0.098): se captura LO CONTADO y el servidor aplica la diferencia como
 *      movimiento de kardex (faltante → entrada CON su partida, sobrante → salida), un conteo que
 *      cuadra no escribe nada, contar CERO vacía, y el saldo que enseña la pantalla sale de la Σ de
 *      movimientos (no de la vista);
 *  (j) REGRESIÓN EN AMBOS SENTIDOS: el flujo viejo por Lote sigue intacto y NO ve los movimientos
 *      nuevos (vista `existencia_tela` redefinida con `id_tela_color IS NULL` + filtro del
 *      `kardexTela` legado), y el flujo nuevo NO ve los del lote.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Almacen, Empresa, PrismaClient, Tela, TelaColor } from '../../datos/index.js';
import { ErrorConflicto, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';
import {
  ajustarInventarioTelaColor,
  cancelarMovimientoTelaColor,
  consultarExistenciasTelaColor,
  kardexTelaColor,
  listarPartidasTela,
  registrarConteoTelaColor,
  registrarSalidaTelaColorAOrden,
  saldosTelaColorParaConteo,
  traspasarTelaColor,
} from './partidas-telas.js';
import { ajustarInventarioTela, consultarExistenciasTela, kardexTela } from './telas.js';

let cliente: PrismaClient;
let empresa: Empresa;
let telaFelpa: Tela; // CON complemento ("Cardigan")
let telaLisa: Tela; // SIN complemento
let colorMarino: TelaColor; // de la felpa
let colorBlanco: TelaColor; // de la felpa
let colorNegroLisa: TelaColor; // de la lisa
let almA: Almacen;
let almB: Almacen;
let idTipoAjusteEntrada: number;
let idTipoAjusteSalida: number;

const PERM_TELAS: ClavePermiso[] = [
  'inventario-telas.ver',
  'inventario-telas.mover',
  'telas.ver-totales',
];
const sesion = (permisos: ClavePermiso[] = PERM_TELAS) =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  telaFelpa = await cliente.tela.create({
    data: {
      nombre: 'Felpa Suiza',
      nombreCuerpo: 'Felpa',
      nombreComplemento: 'Cardigan',
      unidadMedida: 'KG',
    },
  });
  telaLisa = await cliente.tela.create({ data: { nombre: 'Lisa Algodón', unidadMedida: 'M' } });
  colorMarino = await cliente.telaColor.create({
    data: { idTela: telaFelpa.id, nombre: 'Marino Alsa 3040', pantone: '19-3920' },
  });
  colorBlanco = await cliente.telaColor.create({
    data: { idTela: telaFelpa.id, nombre: 'Blanco' },
  });
  colorNegroLisa = await cliente.telaColor.create({
    data: { idTela: telaLisa.id, nombre: 'Negro' },
  });
  almA = await cliente.almacen.create({ data: { nombre: 'Bodega A', tipo: 'TELA' } });
  almB = await cliente.almacen.create({ data: { nombre: 'Bodega B', tipo: 'TELA' } });
  const tipos = await cliente.tipoMovimientoInventario.createManyAndReturn({
    data: [
      { codigo: 'ajuste-entrada', nombre: 'Ajuste (Entrada)', direccion: 'entrada' },
      { codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', direccion: 'salida' },
      { codigo: 'salida-a-orden', nombre: 'Salida a Orden', direccion: 'salida' },
      { codigo: 'transferencia-salida', nombre: 'Transf (Salida)', direccion: 'salida' },
      { codigo: 'transferencia-entrada', nombre: 'Transf (Entrada)', direccion: 'entrada' },
    ],
  });
  idTipoAjusteEntrada = tipos.find((t) => t.codigo === 'ajuste-entrada')!.id;
  idTipoAjusteSalida = tipos.find((t) => t.codigo === 'ajuste-salida')!.id;
});

/** Entra cuerpo+complemento del color dado por un ajuste de entrada (crea partida). */
async function entrarColor(
  idTelaColor: number,
  cantidad: number,
  cantidadComplemento?: number,
  extras?: { loteProveedor?: string; factura?: string; idAlmacen?: number },
) {
  return ajustarInventarioTelaColor(
    sesion(),
    {
      idTipoMov: idTipoAjusteEntrada,
      idAlmacen: extras?.idAlmacen ?? almA.id,
      fecha: '2026-08-06',
      motivo: 'Conteo físico inicial',
      ...(extras?.factura === undefined ? {} : { factura: extras.factura }),
      lineas: [
        {
          idTelaColor,
          cantidad,
          ...(cantidadComplemento === undefined ? {} : { cantidadComplemento }),
          ...(extras?.loteProveedor === undefined ? {} : { loteProveedor: extras.loteProveedor }),
        },
      ],
    },
    bd(),
  );
}

/** Crea una orden mínima para la salida-a-orden. Devuelve su id. */
async function crearOrden(): Promise<number> {
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Cliente X' } });
  const modelo = await cliente.modelo.create({ data: { codigo: 'M-1', descripcion: 'Playera' } });
  const orden = await cliente.orden.create({
    data: { folio: 1n, idEmpresa: empresa.id, idModelo: modelo.id, idCliente: clienteNegocio.id },
  });
  return orden.id;
}

describe('ajuste por color: entrada crea partidas con folio atómico (A3)', () => {
  it('crea una partida por renglón con folios consecutivos POR EMPRESA y liga el kardex', async () => {
    const mov = await ajustarInventarioTelaColor(
      sesion(),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almA.id,
        fecha: '2026-08-06',
        motivo: 'Arranque desde cero',
        factura: 'F-100',
        lineas: [
          {
            idTelaColor: colorMarino.id,
            cantidad: 100,
            cantidadComplemento: 40,
            loteProveedor: 'L-778',
          },
          { idTelaColor: colorNegroLisa.id, cantidad: 55 },
        ],
      },
      bd(),
    );
    expect(mov.renglones).toHaveLength(2);
    const folios = mov.renglones.map((r) => r.partidaFolio).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(folios).toEqual([1, 2]);
    const marino = mov.renglones.find((r) => r.idTelaColor === colorMarino.id)!;
    expect(marino.loteProveedor).toBe('L-778');
    expect(marino.cantidad).toBe(100);
    expect(marino.cantidadComplemento).toBe(40);
    // La lisa NO lleva complemento: viaja como null (no 0).
    const lisa = mov.renglones.find((r) => r.idTelaColor === colorNegroLisa.id)!;
    expect(lisa.cantidadComplemento).toBeNull();
    // Las partidas quedaron en la BD con factura y color.
    const partidas = await cliente.partidaTela.findMany({ orderBy: { folio: 'asc' } });
    expect(partidas).toHaveLength(2);
    expect(partidas[0]?.factura).toBe('F-100');
    // Una SEGUNDA entrada sigue la serie (folio 3), por empresa.
    const mov2 = await entrarColor(colorBlanco.id, 10, 0);
    expect(mov2.renglones[0]?.partidaFolio).toBe(3);
  });

  it('acepta el MISMO tela+color en DOS renglones de una entrada (dos lotes = dos partidas)', async () => {
    // DECISIONES §Post-F9.11 punto 4: una factura puede traer dos lotes del mismo color; la
    // partida es la unidad de entrada, así que cada renglón crea LA SUYA (folios consecutivos).
    const mov = await ajustarInventarioTelaColor(
      sesion(),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almA.id,
        fecha: '2026-08-06',
        motivo: 'Factura con dos lotes del mismo color',
        factura: 'F-200',
        lineas: [
          {
            idTelaColor: colorMarino.id,
            cantidad: 60,
            cantidadComplemento: 20,
            loteProveedor: 'L-A',
          },
          {
            idTelaColor: colorMarino.id,
            cantidad: 35,
            cantidadComplemento: 10,
            loteProveedor: 'L-B',
          },
        ],
      },
      bd(),
    );
    expect(mov.renglones).toHaveLength(2);
    expect(mov.renglones.map((r) => r.partidaFolio).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      1, 2,
    ]);
    expect(new Set(mov.renglones.map((r) => r.loteProveedor))).toEqual(new Set(['L-A', 'L-B']));
    // Las DOS partidas existen (mismo color, folios consecutivos) y la existencia SUMA ambos renglones.
    const partidas = await cliente.partidaTela.findMany({ where: { idTelaColor: colorMarino.id } });
    expect(partidas).toHaveLength(2);
    const existencias = await consultarExistenciasTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id },
      bd(),
    );
    expect(existencias.telas[0]?.colores[0]?.existenciaCuerpo).toBe(95);
    expect(existencias.telas[0]?.colores[0]?.existenciaComplemento).toBe(30);
  });

  it('acepta la entrada de SOLO complemento (cuerpo 0) — comprar solo cardigan', async () => {
    const mov = await entrarColor(colorMarino.id, 0, 25);
    expect(mov.renglones[0]?.cantidad).toBe(0);
    expect(mov.renglones[0]?.cantidadComplemento).toBe(25);
    expect(mov.totalCuerpo).toBe(0);
    expect(mov.totalComplemento).toBe(25);
  });

  it('rechaza cantidad de complemento en una tela que NO lleva complemento', async () => {
    await expect(entrarColor(colorNegroLisa.id, 10, 5)).rejects.toThrow(ErrorValidacion);
  });

  it('rechaza un renglón con ambas cantidades en 0', async () => {
    await expect(entrarColor(colorMarino.id, 0, 0)).rejects.toThrow(ErrorValidacion);
  });

  it('rechaza el lote del proveedor en un ajuste de SALIDA (la partida es de entrada)', async () => {
    await entrarColor(colorMarino.id, 50, 20);
    await expect(
      ajustarInventarioTelaColor(
        sesion(),
        {
          idTipoMov: idTipoAjusteSalida,
          idAlmacen: almA.id,
          fecha: '2026-08-06',
          motivo: 'Merma',
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 5, loteProveedor: 'L-999' }],
        },
        bd(),
      ),
    ).rejects.toThrow(ErrorValidacion);
  });
});

describe('salidas: no-negativo de AMBOS componentes bajo lock (D3)', () => {
  it('la salida de ajuste valida el CUERPO por suma directa', async () => {
    await entrarColor(colorMarino.id, 30, 50);
    await expect(
      ajustarInventarioTelaColor(
        sesion(),
        {
          idTipoMov: idTipoAjusteSalida,
          idAlmacen: almA.id,
          fecha: '2026-08-06',
          motivo: 'Salida mayor al cuerpo',
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 31, cantidadComplemento: 10 }],
        },
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);
  });

  it('la salida de ajuste valida TAMBIÉN el COMPLEMENTO (aunque el cuerpo alcance)', async () => {
    await entrarColor(colorMarino.id, 100, 10);
    await expect(
      ajustarInventarioTelaColor(
        sesion(),
        {
          idTipoMov: idTipoAjusteSalida,
          idAlmacen: almA.id,
          fecha: '2026-08-06',
          motivo: 'Salida mayor al complemento',
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 20, cantidadComplemento: 11 }],
        },
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);
    // Y con cantidades válidas SÍ pasa (ambos componentes juntos en el mismo renglón).
    const mov = await ajustarInventarioTelaColor(
      sesion(),
      {
        idTipoMov: idTipoAjusteSalida,
        idAlmacen: almA.id,
        fecha: '2026-08-06',
        motivo: 'Salida válida',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 20, cantidadComplemento: 10 }],
      },
      bd(),
    );
    expect(mov.direccion).toBe('salida');
  });

  it('la salida a orden empareja por color (sin partida), descuenta ambos y deja la traza', async () => {
    await entrarColor(colorMarino.id, 100, 40, { loteProveedor: 'L-1' });
    const idOrden = await crearOrden();
    const mov = await registrarSalidaTelaColorAOrden(
      sesion(),
      {
        idOrden,
        idAlmacen: almA.id,
        fecha: '2026-08-06',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 60, cantidadComplemento: 25 }],
      },
      bd(),
    );
    expect(mov.origenTipo).toBe('salida-tela-orden');
    expect(mov.origenId).toBe(String(idOrden));
    // La salida NO lleva partida (el consumo NO obliga a escoger partida).
    expect(mov.renglones[0]?.idPartida).toBeNull();
    const existencias = await consultarExistenciasTelaColor(sesion(), {}, bd());
    const felpa = existencias.telas.find((t) => t.idTela === telaFelpa.id)!;
    expect(felpa.totalCuerpo).toBe(40);
    expect(felpa.totalComplemento).toBe(15);
    // Sobregiro del complemento en una segunda salida → rechazada.
    await expect(
      registrarSalidaTelaColorAOrden(
        sesion(),
        {
          idOrden,
          idAlmacen: almA.id,
          fecha: '2026-08-06',
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 0, cantidadComplemento: 16 }],
        },
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);
  });
});

describe('traspaso por color (dos patas atómicas, A2)', () => {
  it('mueve AMBOS componentes entre almacenes y valida el origen', async () => {
    await entrarColor(colorMarino.id, 80, 30);
    const traspaso = await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-08-06',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 50, cantidadComplemento: 30 }],
      },
      bd(),
    );
    expect(traspaso.salida.idAlmacen).toBe(almA.id);
    expect(traspaso.entrada.idAlmacen).toBe(almB.id);
    const existencias = await consultarExistenciasTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id },
      bd(),
    );
    const color = existencias.telas[0]?.colores[0];
    expect(color?.existenciaCuerpo).toBe(80);
    expect(color?.existenciaComplemento).toBe(30);
    const porAlmacen = new Map(color?.almacenes.map((a) => [a.idAlmacen, a]));
    expect(porAlmacen.get(almA.id)?.cuerpo).toBe(30);
    expect(porAlmacen.get(almA.id)?.complemento).toBe(0);
    expect(porAlmacen.get(almB.id)?.cuerpo).toBe(50);
    expect(porAlmacen.get(almB.id)?.complemento).toBe(30);
    // Sin existencia suficiente en el ORIGEN no se mueve nada (atómico).
    await expect(
      traspasarTelaColor(
        sesion(),
        {
          idAlmacenOrigen: almA.id,
          idAlmacenDestino: almB.id,
          fecha: '2026-08-06',
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 31 }],
        },
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);
  });
});

describe('cancelación = inverso auditado (D3, NUNCA edita/borra)', () => {
  it('el inverso copia color/partida/complemento y neutraliza el saldo; no se re-cancela', async () => {
    const mov = await entrarColor(colorMarino.id, 100, 40, { loteProveedor: 'L-2' });
    const cancelado = await cancelarMovimientoTelaColor(
      sesion(),
      mov.id,
      { motivo: 'Captura equivocada' },
      bd(),
    );
    expect(cancelado.cancelado).toBe(true);
    // El ORIGINAL sigue en la BD (no se borra); existe un INVERSO con las mismas dimensiones.
    const detalles = await cliente.movimientoDetTela.findMany({
      where: { idTelaColor: colorMarino.id },
    });
    expect(detalles).toHaveLength(2);
    for (const d of detalles) {
      expect(d.idTelaColor).toBe(colorMarino.id);
      expect(Number(d.cantidad)).toBe(100);
      expect(Number(d.cantidadComplemento)).toBe(40);
      expect(d.idPartida).not.toBeNull();
    }
    // El saldo por color quedó NEUTRALIZADO (con ceros visibles solo con incluirCeros).
    const existencias = await consultarExistenciasTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, incluirCeros: true },
      bd(),
    );
    expect(existencias.telas[0]?.colores[0]?.existenciaCuerpo).toBe(0);
    expect(existencias.telas[0]?.colores[0]?.existenciaComplemento).toBe(0);
    // Y sin incluirCeros la fila desaparece.
    const sinCeros = await consultarExistenciasTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id },
      bd(),
    );
    expect(sinCeros.telas).toHaveLength(0);
    // No se re-cancela.
    await expect(
      cancelarMovimientoTelaColor(sesion(), mov.id, { motivo: 'Otra vez' }, bd()),
    ).rejects.toThrow(ErrorConflicto);
  });
});

describe('existencias agrupadas y kardex de dos componentes', () => {
  it('agrupa TELA PADRE → colores con nombres de cuerpo/complemento, unidad y filtros', async () => {
    await entrarColor(colorMarino.id, 100, 40);
    await entrarColor(colorBlanco.id, 20, 5);
    await entrarColor(colorNegroLisa.id, 33);
    const todas = await consultarExistenciasTelaColor(sesion(), {}, bd());
    expect(todas.telas).toHaveLength(2);
    const felpa = todas.telas.find((t) => t.idTela === telaFelpa.id)!;
    expect(felpa.nombreCuerpo).toBe('Felpa');
    expect(felpa.nombreComplemento).toBe('Cardigan');
    expect(felpa.unidadMedida).toBe('KG');
    expect(felpa.colores.map((c) => c.nombre)).toEqual(['Blanco', 'Marino Alsa 3040']);
    expect(felpa.totalCuerpo).toBe(120);
    expect(felpa.totalComplemento).toBe(45);
    const lisa = todas.telas.find((t) => t.idTela === telaLisa.id)!;
    expect(lisa.nombreComplemento).toBeNull();
    expect(lisa.totalCuerpo).toBe(33);
    expect(todas.totalCuerpo).toBe(153);
    expect(todas.totalComplemento).toBe(45);
    // Búsqueda server-side por nombre del color (pantone/nombre/proveedor).
    const buscada = await consultarExistenciasTelaColor(sesion(), { busqueda: 'marino' }, bd());
    expect(buscada.telas).toHaveLength(1);
    expect(buscada.telas[0]?.colores.map((c) => c.nombre)).toEqual(['Marino Alsa 3040']);
  });

  it('el kardex corre el saldo de los DOS componentes por almacén, con partida', async () => {
    await entrarColor(colorMarino.id, 100, 40, { loteProveedor: 'L-9' });
    const idOrden = await crearOrden();
    await registrarSalidaTelaColorAOrden(
      sesion(),
      {
        idOrden,
        idAlmacen: almA.id,
        fecha: '2026-08-07',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 30, cantidadComplemento: 15 }],
      },
      bd(),
    );
    const kardex = await kardexTelaColor(sesion(), { idTelaColor: colorMarino.id }, bd());
    expect(kardex.tela).toBe('Felpa Suiza');
    expect(kardex.telaColor).toBe('Marino Alsa 3040');
    expect(kardex.nombreComplemento).toBe('Cardigan');
    expect(kardex.renglones).toHaveLength(2);
    const [entrada, salida] = kardex.renglones;
    expect(entrada?.entradaCuerpo).toBe(100);
    expect(entrada?.saldoCuerpo).toBe(100);
    expect(entrada?.saldoComplemento).toBe(40);
    expect(entrada?.loteProveedor).toBe('L-9');
    expect(salida?.salidaCuerpo).toBe(30);
    expect(salida?.saldoCuerpo).toBe(70);
    expect(salida?.salidaComplemento).toBe(15);
    expect(salida?.saldoComplemento).toBe(25);
    expect(salida?.idPartida).toBeNull();
  });

  it('busca partidas por lote del proveedor, factura y folio', async () => {
    await entrarColor(colorMarino.id, 10, 5, { loteProveedor: 'LOTE-ABC', factura: 'F-55' });
    await entrarColor(colorBlanco.id, 20, 0, { loteProveedor: 'OTRO' });
    const porLote = await listarPartidasTela(sesion(), { busqueda: 'lote-abc' }, bd());
    expect(porLote.datos).toHaveLength(1);
    expect(porLote.datos[0]?.telaColor).toBe('Marino Alsa 3040');
    const porFactura = await listarPartidasTela(sesion(), { busqueda: 'F-55' }, bd());
    expect(porFactura.datos).toHaveLength(1);
    const porFolio = await listarPartidasTela(sesion(), { busqueda: '2' }, bd());
    expect(porFolio.datos.map((p) => p.folio)).toEqual([2]);
    const porColor = await listarPartidasTela(sesion(), { idTelaColor: colorBlanco.id }, bd());
    expect(porColor.datos).toHaveLength(1);
  });
});

describe('REGRESIÓN: el flujo viejo por Lote sigue intacto', () => {
  it('el ajuste por lote (D5) sigue funcionando y NO se mezcla con la vista por color', async () => {
    const colorPrenda = await cliente.color.create({ data: { nombre: 'Rojo' } });
    const mov = await ajustarInventarioTela(
      sesion(),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almA.id,
        fecha: '2026-08-06',
        motivo: 'Entrada legado por lote',
        lote: {
          idColor: colorPrenda.id,
          componentes: [{ idTela: telaFelpa.id, cantidad: 77 }],
        },
      },
      bd(),
    );
    expect(mov.renglones[0]?.cantidad).toBe(77);
    // La vista vieja lo suma…
    const viejas = await consultarExistenciasTela(sesion(), { idTela: telaFelpa.id }, bd());
    expect(viejas.totalExistencia).toBe(77);
    // …y la vista NUEVA por color NO lo ve (filas sin id_tela_color quedan fuera).
    const nuevas = await consultarExistenciasTelaColor(sesion(), { idTela: telaFelpa.id }, bd());
    expect(nuevas.telas).toHaveLength(0);
  });

  it('el flujo LEGADO no ve los movimientos NUEVOS por color (sentido contrario)', async () => {
    // Reviewer A2 #2: la regresión debe cubrir AMBOS sentidos. Un movimiento del inventario
    // nuevo (id_lote NULL + id_tela_color poblado) NO debe aparecer ni en la vista vieja
    // `existencia_tela` (redefinida con `id_tela_color IS NULL`) ni en el `kardexTela` legado
    // — antes se colaba como fila fantasma "(sin lote)" con solo el cuerpo.
    await entrarColor(colorMarino.id, 100, 40, { loteProveedor: 'L-NUEVO' });
    const viejas = await consultarExistenciasTela(sesion(), { idTela: telaFelpa.id }, bd());
    expect(viejas.filas).toHaveLength(0);
    expect(viejas.totalExistencia).toBe(0);
    const kardexViejo = await kardexTela(sesion(), { idTela: telaFelpa.id }, bd());
    expect(kardexViejo.renglones).toHaveLength(0);
    // El movimiento SÍ está donde debe: en el flujo nuevo.
    const nuevas = await consultarExistenciasTelaColor(sesion(), { idTela: telaFelpa.id }, bd());
    expect(nuevas.telas[0]?.totalCuerpo).toBe(100);
    expect(nuevas.telas[0]?.totalComplemento).toBe(40);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (k) CONTEO FÍSICO por color — fila 0.098: se captura LO CONTADO, no la resta
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** El saldo de UN color (la consulta va por lotes; aquí sólo hace falta uno). */
async function saldoDe(idTelaColor: number, idAlmacen: number = almA.id) {
  const { saldos } = await saldosTelaColorParaConteo(
    sesion(),
    { idAlmacen, idTelaColor: String(idTelaColor) },
    bd(),
  );
  const saldo = saldos[0];
  if (saldo === undefined) throw new Error('la consulta de saldos no devolvió el color pedido');
  return saldo;
}

describe('conteo por color: el servidor calcula y aplica la diferencia (D3)', () => {
  it('FALTANTE → entrada por la diferencia CON su partida; la existencia queda en lo contado', async () => {
    await entrarColor(colorMarino.id, 100, 40, { loteProveedor: 'L-INI' });

    const conteo = await registrarConteoTelaColor(
      sesion(),
      {
        idAlmacen: almA.id,
        fecha: '2026-09-02',
        motivo: 'Conteo físico de septiembre',
        factura: 'F-CONTEO',
        lineas: [
          {
            idTelaColor: colorMarino.id,
            contadoCuerpo: 130,
            contadoComplemento: 50,
            loteProveedor: 'L-CONTEO',
          },
        ],
      },
      bd(),
    );

    expect(conteo.sinDiferencias).toBe(false);
    expect(conteo.salida).toBeNull();
    // Entra la DIFERENCIA (30 / 10), no lo contado (130 / 50).
    expect(conteo.entrada?.renglones[0]?.cantidad).toBe(30);
    expect(conteo.entrada?.renglones[0]?.cantidadComplemento).toBe(10);
    expect(conteo.renglones[0]).toMatchObject({
      teoricoCuerpo: 100,
      contadoCuerpo: 130,
      diferenciaCuerpo: 30,
      diferenciaComplemento: 10,
    });
    // La pata de entrada creó SU partida (la partida es la unidad de entrada) con su lote.
    expect(conteo.entrada?.renglones[0]?.loteProveedor).toBe('L-CONTEO');
    const partidas = await cliente.partidaTela.findMany({ orderBy: { folio: 'asc' } });
    expect(partidas.at(-1)?.factura).toBe('F-CONTEO');

    // Y la existencia (Σ de movimientos) quedó EXACTAMENTE en lo contado.
    const saldo = await saldoDe(colorMarino.id, almA.id);
    expect(saldo.cuerpo).toBe(130);
    expect(saldo.complemento).toBe(50);
  });

  it('SOBRANTE → salida por la diferencia (sin partida) y la existencia baja a lo contado', async () => {
    await entrarColor(colorMarino.id, 100, 40);

    const conteo = await registrarConteoTelaColor(
      sesion(),
      {
        idAlmacen: almA.id,
        fecha: '2026-09-02',
        motivo: 'Conteo físico',
        lineas: [{ idTelaColor: colorMarino.id, contadoCuerpo: 80, contadoComplemento: 25 }],
      },
      bd(),
    );

    expect(conteo.entrada).toBeNull();
    expect(conteo.salida?.renglones[0]?.cantidad).toBe(20);
    expect(conteo.salida?.renglones[0]?.cantidadComplemento).toBe(15);
    // Las salidas no llevan partida (el consumo empareja por color).
    expect(conteo.salida?.renglones[0]?.idPartida).toBeNull();

    const saldo = await saldoDe(colorMarino.id, almA.id);
    expect(saldo.cuerpo).toBe(80);
    expect(saldo.complemento).toBe(25);
  });

  it('contar CERO vacía el color (y NO deja el inventario en negativo)', async () => {
    await entrarColor(colorNegroLisa.id, 55);

    const conteo = await registrarConteoTelaColor(
      sesion(),
      {
        idAlmacen: almA.id,
        fecha: '2026-09-02',
        motivo: 'Ya no quedó nada',
        lineas: [{ idTelaColor: colorNegroLisa.id, contadoCuerpo: 0 }],
      },
      bd(),
    );
    expect(conteo.salida?.renglones[0]?.cantidad).toBe(55);

    const saldo = await saldoDe(colorNegroLisa.id, almA.id);
    expect(saldo.cuerpo).toBe(0);
  });

  it('un conteo que CUADRA no escribe NINGÚN movimiento', async () => {
    await entrarColor(colorMarino.id, 100, 40);
    const antes = await cliente.movimiento.count();

    const conteo = await registrarConteoTelaColor(
      sesion(),
      {
        idAlmacen: almA.id,
        fecha: '2026-09-02',
        motivo: 'Conteo que cuadra',
        lineas: [{ idTelaColor: colorMarino.id, contadoCuerpo: 100, contadoComplemento: 40 }],
      },
      bd(),
    );

    expect(conteo.sinDiferencias).toBe(true);
    expect(conteo.entrada).toBeNull();
    expect(conteo.salida).toBeNull();
    expect(conteo.renglones[0]?.diferenciaCuerpo).toBe(0);
    expect(await cliente.movimiento.count()).toBe(antes);
  });

  it('⭐ el MISMO color con cuerpo sobrante y complemento faltante genera LAS DOS patas', async () => {
    await entrarColor(colorMarino.id, 100, 40);

    const conteo = await registrarConteoTelaColor(
      sesion(),
      {
        idAlmacen: almA.id,
        fecha: '2026-09-02',
        motivo: 'Sobró felpa y faltó cardigan',
        lineas: [{ idTelaColor: colorMarino.id, contadoCuerpo: 90, contadoComplemento: 55 }],
      },
      bd(),
    );

    expect(conteo.salida?.renglones[0]?.cantidad).toBe(10);
    expect(conteo.salida?.renglones[0]?.cantidadComplemento).toBe(0);
    expect(conteo.entrada?.renglones[0]?.cantidad).toBe(0);
    expect(conteo.entrada?.renglones[0]?.cantidadComplemento).toBe(15);

    const saldo = await saldoDe(colorMarino.id, almA.id);
    expect(saldo.cuerpo).toBe(90);
    expect(saldo.complemento).toBe(55);
  });

  it('cuenta CADA ALMACÉN por su cuenta (el conteo de A no toca lo de B)', async () => {
    await entrarColor(colorMarino.id, 100, 40);
    await entrarColor(colorMarino.id, 70, 30, { idAlmacen: almB.id });

    await registrarConteoTelaColor(
      sesion(),
      {
        idAlmacen: almA.id,
        fecha: '2026-09-02',
        motivo: 'Conteo solo de A',
        lineas: [{ idTelaColor: colorMarino.id, contadoCuerpo: 90, contadoComplemento: 40 }],
      },
      bd(),
    );

    const enA = await saldoDe(colorMarino.id, almA.id);
    const enB = await saldoDe(colorMarino.id, almB.id);
    expect(enA.cuerpo).toBe(90);
    expect(enB.cuerpo).toBe(70);
  });

  it('rechaza el MISMO color repetido (dos restas contra el mismo saldo)', async () => {
    await entrarColor(colorMarino.id, 100, 40);
    await expect(
      registrarConteoTelaColor(
        sesion(),
        {
          idAlmacen: almA.id,
          fecha: '2026-09-02',
          motivo: 'Color repetido',
          lineas: [
            { idTelaColor: colorMarino.id, contadoCuerpo: 10 },
            { idTelaColor: colorMarino.id, contadoCuerpo: 10 },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza contar complemento en una tela que NO lo lleva', async () => {
    await expect(
      registrarConteoTelaColor(
        sesion(),
        {
          idAlmacen: almA.id,
          fecha: '2026-09-02',
          motivo: 'Complemento donde no hay',
          lineas: [{ idTelaColor: colorNegroLisa.id, contadoCuerpo: 5, contadoComplemento: 3 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  // ⚠️ RENOMBRADA (2ª ronda). Antes decía «…no de la vista» y NO podía demostrarlo:
  // `existencia_tela_color` es un `CREATE VIEW` PLANO (migración 20260806130000_a2_partidas_telas),
  // no materializado, así que se calcula al consultar y leerla devolvería EXACTAMENTE lo mismo. La
  // prueba pasaba por la razón equivocada. Lo que este caso sí demuestra es que el saldo REFLEJA
  // cada movimiento del color (incluidas las dos patas de un traspaso) y que reparte por almacén.
  // Que la fuente sea la TABLA y no la vista lo vigila el guardián de SQL en `partidas-telas.test.ts`.
  it('el saldo refleja cada movimiento del color, pata por pata y almacén por almacén', async () => {
    await entrarColor(colorMarino.id, 100, 40);
    await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-09-02',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 30, cantidadComplemento: 10 }],
      },
      bd(),
    );
    const enA = await saldoDe(colorMarino.id, almA.id);
    expect(enA.cuerpo).toBe(70);
    expect(enA.complemento).toBe(30);
    expect(enA.nombreComplemento).toBe('Cardigan');
    // Una tela SIN complemento lo reporta como null (la pantalla no pide ese número).
    const lisa = await saldoDe(colorNegroLisa.id, almA.id);
    expect(lisa.nombreComplemento).toBeNull();
    expect(lisa.cuerpo).toBe(0);
  });

  it('⭐ ESPEJO: el cuerpo CUADRA y SOBRA complemento → sólo salida, y el cuerpo no se mueve', async () => {
    // La gemela que sobrevivió a la 1ª ronda: sin este caso, quitar el disyuntor
    // `difComplemento < 0` de la pata de salida dejaba las pruebas en verde.
    await entrarColor(colorMarino.id, 100, 40);

    const conteo = await registrarConteoTelaColor(
      sesion(),
      {
        idAlmacen: almA.id,
        fecha: '2026-09-02',
        motivo: 'Sobró cardigan; la felpa cuadró',
        lineas: [{ idTelaColor: colorMarino.id, contadoCuerpo: 100, contadoComplemento: 25 }],
      },
      bd(),
    );

    expect(conteo.entrada).toBeNull();
    expect(conteo.salida?.renglones[0]?.cantidad).toBe(0);
    expect(conteo.salida?.renglones[0]?.cantidadComplemento).toBe(15);

    const saldo = await saldoDe(colorMarino.id, almA.id);
    expect(saldo.cuerpo).toBe(100);
    expect(saldo.complemento).toBe(25);
  });

  it('⭐ conteo MIXTO: la partida se crea para la línea que FALTA, con SU lote (no el de otra)', async () => {
    // El amarre partida↔línea va por `datos.lineas[indice]`, y hasta ahora todos los casos tenían
    // su única entrada en la línea 0: cambiarlo por `lineas[i]` habría pasado igual. Aquí la línea
    // 0 SOBRA (va a la salida) y la 1 FALTA (va a la entrada) con su propio lote: si el amarre se
    // corriera de índice, la partida nacería con el lote del renglón equivocado.
    await entrarColor(colorMarino.id, 100, 40);
    await entrarColor(colorNegroLisa.id, 50);

    const conteo = await registrarConteoTelaColor(
      sesion(),
      {
        idAlmacen: almA.id,
        fecha: '2026-09-02',
        motivo: 'Uno sobra y otro falta',
        factura: 'F-MIXTO',
        lineas: [
          // Línea 0 → SOBRANTE (sale). Su `loteProveedor` no debe acabar en ninguna partida.
          { idTelaColor: colorMarino.id, contadoCuerpo: 80, contadoComplemento: 40 },
          // Línea 1 → FALTANTE (entra) y es la que crea partida, con SU lote.
          { idTelaColor: colorNegroLisa.id, contadoCuerpo: 75, loteProveedor: 'L-B' },
        ],
      },
      bd(),
    );

    expect(conteo.salida?.renglones[0]?.idTelaColor).toBe(colorMarino.id);
    expect(conteo.salida?.renglones[0]?.cantidad).toBe(20);
    // La ENTRADA es la lisa, con su lote y su factura — no el color de la línea 0.
    expect(conteo.entrada?.renglones).toHaveLength(1);
    expect(conteo.entrada?.renglones[0]?.idTelaColor).toBe(colorNegroLisa.id);
    expect(conteo.entrada?.renglones[0]?.cantidad).toBe(25);
    expect(conteo.entrada?.renglones[0]?.loteProveedor).toBe('L-B');

    // Y en la BD la partida nueva quedó ligada al COLOR de la línea 1.
    const ultima = await cliente.partidaTela.findFirst({ orderBy: { folio: 'desc' } });
    expect(ultima?.idTelaColor).toBe(colorNegroLisa.id);
    expect(ultima?.loteProveedor).toBe('L-B');
    expect(ultima?.factura).toBe('F-MIXTO');
  });

  it('un color sin NINGÚN movimiento devuelve saldo 0, no se omite del renglón', async () => {
    // El `GROUP BY` no lo trae; el relleno a 0 lo pone de vuelta. En el arranque «sin dato» y
    // «cero» no son lo mismo.
    const { saldos } = await saldosTelaColorParaConteo(
      sesion(),
      {
        idAlmacen: almA.id,
        idTelaColor: `${String(colorMarino.id)},${String(colorBlanco.id)}`,
      },
      bd(),
    );
    expect(saldos).toHaveLength(2);
    expect(saldos.every((s) => s.cuerpo === 0 && s.complemento === 0)).toBe(true);
  });

  it('el conteo NO contamina el flujo LEGADO por lote (ni al revés)', async () => {
    await entrarColor(colorMarino.id, 100, 40);
    await registrarConteoTelaColor(
      sesion(),
      {
        idAlmacen: almA.id,
        fecha: '2026-09-02',
        motivo: 'Conteo',
        lineas: [{ idTelaColor: colorMarino.id, contadoCuerpo: 130, contadoComplemento: 40 }],
      },
      bd(),
    );
    // El kardex legado por lote sigue sin ver nada del flujo por color.
    const legado = await kardexTela(sesion(), { idTela: telaFelpa.id }, bd());
    expect(legado.renglones).toHaveLength(0);
  });
});
