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
  registrarSalidaTelaColorAOrden,
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
