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
 *  (e) traspaso atómico (dos patas) con ambas cantidades y validación del origen, y ⭐ **el LOTE
 *      viajando en las dos patas** (fila 0.142): reparto FIFO por folio sobre el saldo real del
 *      origen, cuerpo y complemento por separado, remanente sin lote, y la prohibición de cancelar
 *      una sola pata;
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

/**
 * ⭐ FILA 0.173 — POR QUÉ ESTAS PRUEBAS PIDEN UN `desde` EXPLÍCITO. Desde esta fila, un kardex sin
 * periodo se lee con la VENTANA POR OMISIÓN (12 meses hacia atrás desde HOY), y las fixturas de
 * este archivo están fechadas en 2026: hoy caen dentro, pero llegado 2027 dejarían de caer y estas
 * pruebas fallarían por el CALENDARIO, no por el código. Fijar el piso las vuelve deterministas.
 * El periodo tiene sus propias pruebas, que sí lo ejercitan a propósito.
 */
const PERIODO_COMPLETO = '2000-01-01';

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
        motivo: 'Se manda al cortador',
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
          motivo: 'Se manda al cortador',
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 31 }],
        },
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐ FILA 0.172 — EL MOTIVO DEL TRASPASO QUEDA EN LAS DOS PATAS
// ═════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 Es la promesa de la fila, y sólo se puede medir contra Postgres: el motor
// (`comun/kardex.ts` → `registrarTraspasoTela`, patas en `:976` y `:991`) pasa el MISMO encabezado a
// las dos, así que basta con que alguien deje de pasarlo a la pata de ENTRADA para que el kardex del
// almacén que RECIBE la tela no diga por qué llegó — y nada más se rompería: la hoja impresa lee la
// SALIDA y seguiría bien. Es exactamente la prueba que la fila 0.100 sí escribió para PT
// (`movimientos-pt.int.test.ts`, «el motivo del traspaso queda en LAS DOS patas») y que esta fila
// copió todo menos eso.

describe('el MOTIVO del traspaso queda en LAS DOS patas (fila 0.172)', () => {
  it('⭐ salida Y entrada guardan el motivo, recortado, en `Movimiento.observaciones`', async () => {
    await entrarColor(colorMarino.id, 100, 40);
    const t = await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-08-06',
        // Con espacios de sobra a propósito: el contrato lo recorta (`.trim()`), así que lo que
        // llega a la columna no es lo que se tecleó.
        motivo: '   Reacomodo de bodega   ',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 50, cantidadComplemento: 20 }],
      },
      bd(),
    );

    // 🔴 LAS DOS, leídas de la BASE (no del objeto que devuelve el dominio): es la columna que va a
    // mirar el kardex de cada almacén.
    const salida = await cliente.movimiento.findUniqueOrThrow({ where: { id: t.salida.id } });
    const entrada = await cliente.movimiento.findUniqueOrThrow({ where: { id: t.entrada.id } });
    expect(salida.observaciones).toBe('Reacomodo de bodega');
    expect(entrada.observaciones).toBe('Reacomodo de bodega');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐⭐ FILA 0.142 — EL LOTE VIAJA EN EL TRASPASO (Daniel §Post-F9.201 punto 1)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
//
// La REGLA del reparto (FIFO por folio, cuerpo y complemento por separado, remanente sin lote) se
// mide pura en `partidas-telas.test.ts`. Lo que SÓLO se puede medir contra Postgres, y es lo que
// estas pruebas fijan:
//  • que la partida llegue de verdad a los renglones de kardex de LAS DOS patas (el motor pasa el
//    mismo arreglo a las dos: si eso cambiara, el destino se quedaría sin lote y nadie lo vería);
//  • que el reparto salga del SALDO REAL del origen, leído después del lock (Σ de movimientos);
//  • que la tela sin lote del origen siga viajando sin lote, sin romper el traspaso.

/** Los renglones de kardex de un movimiento, con el folio de su partida (o null). */
async function renglonesConLote(idMovimiento: number) {
  const detalles = await cliente.movimientoDetTela.findMany({
    where: { idMovimiento },
    select: { cantidad: true, cantidadComplemento: true, partida: { select: { folio: true } } },
    orderBy: { id: 'asc' },
  });
  return detalles.map((d) => ({
    folioPartida: d.partida === null ? null : Number(d.partida.folio),
    cuerpo: Number(d.cantidad),
    complemento: d.cantidadComplemento === null ? null : Number(d.cantidadComplemento),
  }));
}

describe('el traspaso NOMBRA el lote en las dos patas (fila 0.142)', () => {
  it('⭐ reparte FIFO por folio y escribe la MISMA partida en la salida y en la entrada', async () => {
    const p1 = await entrarColor(colorMarino.id, 500, 0, { loteProveedor: 'L-A' });
    const p2 = await entrarColor(colorMarino.id, 300, 0, { loteProveedor: 'L-B' });
    const folioP1 = p1.renglones[0]!.partidaFolio!;
    const folioP2 = p2.renglones[0]!.partidaFolio!;

    const traspaso = await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-08-06',
        motivo: 'Se manda al cortador',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 700 }],
      },
      bd(),
    );

    const esperado = [
      { folioPartida: folioP1, cuerpo: 500, complemento: 0 },
      { folioPartida: folioP2, cuerpo: 200, complemento: 0 },
    ];
    // 🔴 LAS DOS patas, y por separado: es lo único que demuestra que el lote llega al DESTINO, que
    // es donde alguien va a escoger el rollo.
    expect(await renglonesConLote(traspaso.salida.id)).toEqual(esperado);
    expect(await renglonesConLote(traspaso.entrada.id)).toEqual(esperado);
  });

  it('⭐ el CUERPO y el COMPLEMENTO se nombran por separado (partida de sólo cardigan)', async () => {
    // El lote viejo tiene sólo cuerpo; el nuevo, sólo cardigan. Un reparto que arrastrara el
    // complemento detrás del cuerpo escribiría un renglón imposible.
    const soloCuerpo = await entrarColor(colorMarino.id, 400, 0, { loteProveedor: 'L-CUERPO' });
    const soloCardigan = await entrarColor(colorMarino.id, 0, 200, {
      loteProveedor: 'L-CARDIGAN',
    });
    const traspaso = await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-08-06',
        motivo: 'Se manda al cortador',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 400, cantidadComplemento: 150 }],
      },
      bd(),
    );
    expect(await renglonesConLote(traspaso.entrada.id)).toEqual([
      { folioPartida: soloCuerpo.renglones[0]!.partidaFolio, cuerpo: 400, complemento: 0 },
      { folioPartida: soloCardigan.renglones[0]!.partidaFolio, cuerpo: 0, complemento: 150 },
    ]);
  });

  it('⭐ un SEGUNDO traspaso ya no puede repartir el lote que el primero se llevó', async () => {
    // El saldo por lote sale de la Σ de movimientos (D3): la pata de salida del primer traspaso YA
    // descontó `L-A`. Si el reparto sumara sólo entradas, este segundo traspaso volvería a nombrar
    // `L-A` — el mismo rollo saldría dos veces de la bodega, en el papel.
    const pa = await entrarColor(colorMarino.id, 500, 0, { loteProveedor: 'L-A' });
    const pb = await entrarColor(colorMarino.id, 500, 0, { loteProveedor: 'L-B' });
    await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-08-06',
        motivo: 'Se manda al cortador',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 500 }],
      },
      bd(),
    );
    const segundo = await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-08-07',
        motivo: 'Se manda al cortador',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 500 }],
      },
      bd(),
    );
    expect(await renglonesConLote(segundo.salida.id)).toEqual([
      { folioPartida: pb.renglones[0]!.partidaFolio, cuerpo: 500, complemento: 0 },
    ]);
    // …y el primero se había llevado el otro, no éste.
    expect(pa.renglones[0]!.partidaFolio).not.toBe(pb.renglones[0]!.partidaFolio);
  });

  it('la tela que ningún lote explica viaja SIN lote, junto a la que sí (REGLA 0-B)', async () => {
    // Así se ve un almacén real hoy: parte de su tela entró antes de la 0.142 (sin partida) y parte
    // con su partida. El traspaso mueve las dos y no inventa un lote para la primera.
    const conLote = await entrarColor(colorMarino.id, 200, 0, { loteProveedor: 'L-A' });
    const tipoTransferenciaEntrada = await cliente.tipoMovimientoInventario.findFirstOrThrow({
      where: { codigo: 'transferencia-entrada' },
    });
    await cliente.movimiento.create({
      data: {
        folio: 987654n,
        idEmpresa: empresa.id,
        idTipoMov: tipoTransferenciaEntrada.id,
        idAlmacen: almA.id,
        fecha: new Date('2026-07-01T00:00:00.000Z'),
        origenTipo: 'traspaso',
        detallesTela: {
          create: [
            {
              idTela: telaFelpa.id,
              idTelaColor: colorMarino.id,
              idPartida: null,
              cantidad: 300,
              cantidadComplemento: 0,
            },
          ],
        },
      },
    });

    const traspaso = await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-08-06',
        motivo: 'Se manda al cortador',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 500 }],
      },
      bd(),
    );
    expect(await renglonesConLote(traspaso.entrada.id)).toEqual([
      { folioPartida: conLote.renglones[0]!.partidaFolio, cuerpo: 200, complemento: 0 },
      { folioPartida: null, cuerpo: 300, complemento: 0 },
    ]);
  });

  it('🔴 una sola pata del traspaso NO se cancela: la marcha atrás es OTRO traspaso', async () => {
    // El motor lo prohíbe (`cancelarMovimientoMaterial`) porque descuadraría los dos almacenes. Con
    // el lote viajando importa el doble: cancelar sólo la entrada dejaría el lote descontado del
    // origen y sin aparecer en ningún lado.
    await entrarColor(colorMarino.id, 500, 0, { loteProveedor: 'L-A' });
    const traspaso = await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-08-06',
        motivo: 'Se manda al cortador',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 500 }],
      },
      bd(),
    );
    await expect(
      cancelarMovimientoTelaColor(sesion(), traspaso.salida.id, { motivo: 'Me equivoqué' }, bd()),
    ).rejects.toThrow(ErrorConflicto);
    await expect(
      cancelarMovimientoTelaColor(sesion(), traspaso.entrada.id, { motivo: 'Me equivoqué' }, bd()),
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

  // ⭐⭐ LA OTRA MITAD DE «EL INVERSO COPIA LA PARTIDA», y es la que importa para el aviso de tono:
  // si el original NO llevaba lote, el inverso tampoco ⇒ **cancelar una salida mete tela SIN nombre
  // en el anaquel**. Es la segunda de las cuatro puertas del mapa de `previa-salida-tela-orden.ts`,
  // y hasta ahora vivía sólo como corolario razonado del caso de arriba (que cancela una ENTRADA,
  // que sí lleva partida). Se mide para que la palabra «medidas» del doc de módulo sea verdad.
  it('⭐ cancelar una salida SIN lote devuelve la tela SIN lote (la 2ª puerta del mapa)', async () => {
    await entrarColor(colorMarino.id, 100, 40, { loteProveedor: 'L-3' });
    const idOrden = await crearOrden();
    const salida = await registrarSalidaTelaColorAOrden(
      sesion(),
      {
        idOrden,
        idAlmacen: almA.id,
        fecha: '2026-08-06',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 60, cantidadComplemento: 25 }],
      },
      bd(),
    );
    expect(salida.renglones[0]?.idPartida).toBeNull(); // P3: el consumo empareja por color

    const cancelado = await cancelarMovimientoTelaColor(
      sesion(),
      salida.id,
      { motivo: 'La orden se surtió de otra bodega' },
      bd(),
    );
    expect(cancelado.cancelado).toBe(true);

    // 🔴 El INVERSO es una ENTRADA (devuelve la tela al anaquel) y va SIN partida: nadie sabe de qué
    // lote era lo que se había sacado, así que inventarle uno sería mentir. Ésa es exactamente la
    // tela que enciende el tercer estado del aviso de tono.
    const inverso = await cliente.movimiento.findFirstOrThrow({
      where: { idEmpresa: empresa.id, origenTipo: 'cancelacion' },
      include: { detallesTela: true, tipoMov: { select: { direccion: true } } },
    });
    expect(inverso.tipoMov.direccion).toBe('entrada');
    expect(inverso.detallesTela).toHaveLength(1);
    expect(inverso.detallesTela[0]?.idPartida).toBeNull();
    expect(Number(inverso.detallesTela[0]?.cantidad ?? -1)).toBe(60);
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
    const kardex = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, desde: PERIODO_COMPLETO },
      bd(),
    );
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
    const kardexViejo = await kardexTela(
      sesion(),
      { idTela: telaFelpa.id, desde: PERIODO_COMPLETO },
      bd(),
    );
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
        motivo: 'Se manda al cortador',
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
    const legado = await kardexTela(
      sesion(),
      { idTela: telaFelpa.id, desde: PERIODO_COMPLETO },
      bd(),
    );
    expect(legado.renglones).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (l) EL PERIODO del kardex por COLOR — fila 0.173 (mecanismo de la 0.138)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⭐ Hasta esta fila, `kardexTelaColor` pedía TODOS los movimientos del color, sin filtro de fechas
// y sin `LIMIT`. Ahora hay periodo, ventana por omisión y tope; y como este kardex tiene DOS
// columnas de saldo (cuerpo y complemento), recortar sin sembrar el saldo anterior las habría
// dejado mintiendo a las dos a la vez.

describe('El PERIODO del kardex por color (fila 0.173)', () => {
  /** Entrada del color marino en una FECHA dada (crea partida). Devuelve el folio del movimiento. */
  async function entradaEn(
    fecha: string,
    cuerpo: number,
    complemento?: number,
    idAlmacen: number = almA.id,
  ): Promise<number> {
    const mov = await ajustarInventarioTelaColor(
      sesion(),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen,
        fecha,
        motivo: 'Entrada de la prueba',
        lineas: [
          {
            idTelaColor: colorMarino.id,
            cantidad: cuerpo,
            ...(complemento === undefined ? {} : { cantidadComplemento: complemento }),
          },
        ],
      },
      bd(),
    );
    return mov.folio;
  }

  /** `AAAA-MM-DD` de hoy en el huso del negocio, corrido `meses` hacia atrás. */
  function haceMeses(meses: number): string {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    const [a, m, d] = hoy.split('-').map(Number);
    return new Date(Date.UTC(a as number, (m as number) - 1 - meses, d)).toISOString().slice(0, 10);
  }

  it('⭐ un movimiento FUERA del periodo NO llega: el recorte lo hace el servidor', async () => {
    await entradaEn('2026-01-15', 30); // fuera
    const folioDentro = await entradaEn('2026-06-20', 7); // dentro

    const kardex = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, desde: '2026-06-01', hasta: '2026-06-30' },
      bd(),
    );

    expect(kardex.renglones.map((r) => r.folio)).toEqual([folioDentro]);
    expect(kardex.desde).toBe('2026-06-01');
    expect(kardex.hasta).toBe('2026-06-30');
    expect(kardex.ventanaPorOmision).toBe(false);
    expect(kardex.truncado).toBe(false);
  });

  /**
   * ⭐⭐ LA PRUEBA DE QUE EL FILTRO ESTÁ EN EL `WHERE` Y NO EN JAVASCRIPT. Las demás miran la
   * salida, y la salida sale igual si alguien trae los diez años y luego recorta en memoria — que
   * es justo lo que la fila prohíbe. Ésta las distingue cruzando el periodo con el TOPE: filtrando
   * en el servidor la base sólo ve el de enero y llega 1; filtrando después de traer, el tope se
   * habría llevado los tres de junio (los más nuevos, `folio DESC`) y llegarían 0.
   */
  it('⭐⭐ el filtro va en la CONSULTA, no en memoria (el tope no se come el periodo)', async () => {
    const folioEnero = await entradaEn('2026-01-15', 1);
    await entradaEn('2026-06-01', 1);
    await entradaEn('2026-06-02', 1);
    await entradaEn('2026-06-03', 1);

    const kardex = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, desde: '2026-01-01', hasta: '2026-01-31', limite: 2 },
      bd(),
    );
    expect(kardex.renglones.map((r) => r.folio)).toEqual([folioEnero]);
    expect(kardex.truncado).toBe(false);
  });

  it('⭐ los DOS bordes son INCLUSIVOS, y un día más allá deja el movimiento fuera', async () => {
    const primero = await entradaEn('2026-06-01', 5);
    const ultimo = await entradaEn('2026-06-30', 5);

    const dentro = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, desde: '2026-06-01', hasta: '2026-06-30' },
      bd(),
    );
    expect(dentro.renglones.map((r) => r.folio)).toEqual([primero, ultimo]);

    const sinPrimero = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, desde: '2026-06-02', hasta: '2026-06-30' },
      bd(),
    );
    expect(sinPrimero.renglones.map((r) => r.folio)).toEqual([ultimo]);

    const sinUltimo = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, desde: '2026-06-01', hasta: '2026-06-29' },
      bd(),
    );
    expect(sinUltimo.renglones.map((r) => r.folio)).toEqual([primero]);
  });

  it('⭐ SIN periodo, la ventana por omisión deja fuera lo viejo (y lo dice)', async () => {
    await entradaEn(haceMeses(24), 40); // dos años atrás: fuera de la ventana de 12 meses
    const reciente = await entradaEn(haceMeses(1), 6); // el mes pasado: dentro

    const porOmision = await kardexTelaColor(sesion(), { idTelaColor: colorMarino.id }, bd());
    expect(porOmision.renglones.map((r) => r.folio)).toEqual([reciente]);
    expect(porOmision.ventanaPorOmision).toBe(true);
    expect(porOmision.desde).toBe(haceMeses(12));
    expect(porOmision.hasta).toBeNull();

    // Y el histórico NO se perdió: pedirlo a mano lo trae. La ventana es un default, no un candado.
    const completo = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, desde: PERIODO_COMPLETO },
      bd(),
    );
    expect(completo.renglones).toHaveLength(2);
    expect(completo.ventanaPorOmision).toBe(false);
  });

  it('⭐ el SALDO del periodo arranca del saldo anterior — y los DOS componentes', async () => {
    await entradaEn('2026-01-15', 30, 12); // antes del periodo
    await entradaEn('2026-06-20', 7, 3); // dentro

    const kardex = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, desde: '2026-06-01' },
      bd(),
    );

    // Si el saldo anterior se ignorara, este renglón diría 7 / 3 — y las dos columnas mentirían.
    expect(kardex.renglones).toHaveLength(1);
    expect(kardex.renglones[0]?.saldoCuerpo).toBe(37);
    expect(kardex.renglones[0]?.saldoComplemento).toBe(15);
    expect(kardex.saldosIniciales).toHaveLength(1);
    expect(kardex.saldosIniciales[0]?.saldoCuerpo).toBe(30);
    expect(kardex.saldosIniciales[0]?.saldoComplemento).toBe(12);
    expect(kardex.saldosIniciales[0]?.almacen).toBe('Bodega A');
  });

  it('el saldo anterior RESTA las salidas anteriores (no es un total de entradas)', async () => {
    await entradaEn('2026-01-15', 30, 12);
    await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-02-10',
        motivo: 'Se manda al cortador',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 12, cantidadComplemento: 2 }],
      },
      bd(),
    );
    await entradaEn('2026-06-20', 1, 1);

    const kardex = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, idAlmacen: almA.id, desde: '2026-06-01' },
      bd(),
    );
    expect(kardex.saldosIniciales[0]?.saldoCuerpo).toBe(18);
    expect(kardex.saldosIniciales[0]?.saldoComplemento).toBe(10);
    expect(kardex.renglones[0]?.saldoCuerpo).toBe(19);
  });

  it('sólo trae el saldo anterior de los ALMACENES que se movieron en el periodo', async () => {
    await entradaEn('2026-01-15', 30, 0, almA.id); // Bodega A — se moverá en el periodo
    await entradaEn('2026-01-16', 50, 0, almB.id); // Bodega B — quieta durante el periodo
    await entradaEn('2026-06-20', 7, 0, almA.id);

    const kardex = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, desde: '2026-06-01' },
      bd(),
    );
    expect(kardex.saldosIniciales.map((s) => s.almacen)).toEqual(['Bodega A']);
  });

  /**
   * ⭐⭐ EL CORTE SE LLEVA LO VIEJO, NO LO NUEVO. El folio es la secuencia atómica por empresa (A3):
   * crece con el tiempo, así que `ORDER BY folio ASC LIMIT n` devolvería los n MÁS VIEJOS de la
   * ventana — en producto terminado eso escondió siete meses recientes con la pantalla diciendo «en
   * adelante». Lo que fija esta prueba es la DIRECCIÓN, y el saldo que la acompaña.
   */
  it('⭐⭐ el TOPE conserva el FINAL del periodo, y el saldo sigue cuadrando', async () => {
    const folios = [
      await entradaEn('2026-06-01', 1),
      await entradaEn('2026-06-02', 1),
      await entradaEn('2026-06-03', 1),
    ];

    const cortado = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, desde: '2026-01-01', limite: 2 },
      bd(),
    );
    expect(cortado.renglones).toHaveLength(2);
    expect(cortado.truncado).toBe(true);
    expect(cortado.limite).toBe(2);
    // Los DOS ÚLTIMOS, en orden cronológico. Con el corte al revés esto sería [folios0, folios1].
    expect(cortado.renglones.map((r) => r.folio)).toEqual([folios[1], folios[2]]);
    // Y el saldo NO arranca de cero: cuenta el movimiento que el tope se saltó.
    expect(cortado.saldosIniciales[0]?.saldoCuerpo).toBe(1);
    expect(cortado.renglones.map((r) => r.saldoCuerpo)).toEqual([2, 3]);

    const completo = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, desde: '2026-01-01', limite: 3 },
      bd(),
    );
    expect(completo.renglones).toHaveLength(3);
    expect(completo.truncado).toBe(false);
    expect(completo.saldosIniciales).toHaveLength(0);
    expect(completo.renglones.map((r) => r.saldoCuerpo)).toEqual([1, 2, 3]);
  });

  it('⭐ tres movimientos del MISMO día con tope 2: el que se cae cuenta en el saldo anterior', async () => {
    const folios = [
      await entradaEn('2026-06-10', 5),
      await entradaEn('2026-06-10', 7),
      await entradaEn('2026-06-10', 9),
    ];

    const kardex = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, desde: '2026-06-01', limite: 2 },
      bd(),
    );
    expect(kardex.renglones.map((r) => r.folio)).toEqual([folios[1], folios[2]]);
    expect(kardex.saldosIniciales[0]?.saldoCuerpo).toBe(5);
    expect(kardex.renglones.map((r) => r.saldoCuerpo)).toEqual([12, 21]);
  });

  /**
   * ⭐⭐⭐ EL DESEMPATE POR `id` DEL DETALLE, que es la línea de la que cuelga todo el invariante y
   * la que en producto terminado sobrevivía a 56 pruebas en verde (fila 0.138): todas las fixturas
   * creaban movimientos de UN SOLO renglón y la llave `(folio, id)` degeneraba en el folio.
   *
   * 🔑 Aquí el caso NO es artificial: desde la fila 0.142 **un traspaso reparte FIFO entre las
   * partidas del origen**, así que UNA pata de traspaso escribe VARIOS renglones del mismo color y
   * del mismo almacén — o sea, del mismo cubo de saldo. Si el tope corta EN MEDIO de esa pata, el
   * renglón que se queda fuera tiene el MISMO folio que el ancla, y sólo el `id` lo distingue.
   *
   * Montaje: dos partidas (100 y 50) y un traspaso de 120 que el FIFO parte en 100 + 20. Con tope 1
   * se ve el ÚLTIMO renglón de la pata (−20) y el de −100 queda fuera: el saldo anterior tiene que
   * valer 50 (150 − 100), no 150. Sin el `id` en la comparación, el −100 no cae en ninguna de las
   * dos ramas y el saldo dice 150 → el renglón visible cerraría en 130 en vez de en 30, que es la
   * existencia REAL del almacén.
   */
  it('⭐⭐⭐ con el tope cortando DENTRO de un traspaso, el desempate es (folio, id) — no el folio', async () => {
    await entradaEn('2026-06-01', 100);
    await entradaEn('2026-06-02', 50);
    await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-06-03',
        motivo: 'Se manda al cortador',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 120 }],
      },
      bd(),
    );

    // La pata de salida en Bodega A trae DOS renglones (FIFO: 100 de la primera partida y 20 de la
    // segunda). Con tope 1 sólo se ve el segundo.
    const kardex = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, idAlmacen: almA.id, desde: '2026-06-01', limite: 1 },
      bd(),
    );
    expect(kardex.truncado).toBe(true);
    expect(kardex.renglones).toHaveLength(1);
    expect(kardex.renglones[0]?.salidaCuerpo).toBe(20);
    // ⭐ El número que mata la mutación: 50, no 150.
    expect(kardex.saldosIniciales[0]?.saldoCuerpo).toBe(50);
    // Y el último saldo visible es la existencia REAL del almacén (150 − 120), con tope o sin él.
    expect(kardex.renglones[0]?.saldoCuerpo).toBe(30);

    const existencias = await consultarExistenciasTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, idAlmacen: almA.id },
      bd(),
    );
    expect(existencias.telas[0]?.colores[0]?.existenciaCuerpo).toBe(30);
  });

  /**
   * ⭐⭐ EL FILTRO POR PARTIDA ES DE CORRECCIÓN EN EL SALDO ANTERIOR, no de rendimiento. La llave de
   * agrupación es SÓLO el almacén, así que si el saldo anterior no filtrara por partida, las otras
   * partidas del mismo almacén caerían DENTRO del mismo grupo y la columna «Saldo» mentiría entera.
   */
  it('⭐⭐ filtrando por PARTIDA, el saldo anterior es el de ESA partida (no el del almacén)', async () => {
    const primera = await ajustarInventarioTelaColor(
      sesion(),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almA.id,
        fecha: '2026-01-15',
        motivo: 'Entrada de la prueba',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 30, loteProveedor: 'L-UNO' }],
      },
      bd(),
    );
    const idPartida = primera.renglones[0]?.idPartida;
    expect(idPartida).toBeDefined();
    if (idPartida == null) return; // estrecha el tipo (sin `!`)
    // Otra partida del MISMO almacén y ANTES del periodo: es la que se colaría sin el filtro.
    await entradaEn('2026-01-16', 500);
    // Y un movimiento de la PRIMERA partida dentro del periodo, para que tenga qué enseñar. El
    // traspaso reparte FIFO por folio de partida, así que 5 salen de la más vieja (ésta).
    await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-06-20',
        motivo: 'Se manda al cortador',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 5 }],
      },
      bd(),
    );

    const kardex = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, idPartida, idAlmacen: almA.id, desde: '2026-06-01' },
      bd(),
    );
    // 30, no 530: la otra partida no entra aunque comparta almacén.
    expect(kardex.saldosIniciales[0]?.saldoCuerpo).toBe(30);
    expect(kardex.renglones[0]?.saldoCuerpo).toBe(25);
  });

  /**
   * ⭐ A9 — la EMPRESA es de corrección en el saldo anterior. `id_empresa` no está en la llave de
   * agrupación (que es el almacén), así que un movimiento de otra empresa en el mismo almacén
   * caería DENTRO del mismo grupo y todos los saldos mentirían a la vez.
   */
  it('⭐ un movimiento de OTRA empresa no entra en el saldo anterior (A9)', async () => {
    await entradaEn('2026-01-15', 30);
    // La misma tela/color/almacén, pero de otra empresa: NO debe sumar.
    const otra = await crearEmpresaPrueba(cliente, 'Otra SA');
    await ajustarInventarioTelaColor(
      sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM_TELAS }),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almA.id,
        fecha: '2026-01-20',
        motivo: 'Entrada de otra empresa',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 999 }],
      },
      bd(),
    );
    await entradaEn('2026-06-20', 7);

    const kardex = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, desde: '2026-06-01' },
      bd(),
    );
    expect(kardex.saldosIniciales[0]?.saldoCuerpo).toBe(30);
    expect(kardex.renglones[0]?.saldoCuerpo).toBe(37);
  });
  /**
   * ⭐⭐⭐ LA LLAVE DEL `GROUP BY` ES **UNA SOLA COLUMNA**, Y AÑADIRLE OTRA ES TAN LETAL COMO QUITAR
   * UNA DEL `WHERE` — pero nadie lo medía.
   *
   * 🔑 El resto de las pruebas de este bloque razonan sobre **QUITAR** condiciones (y esas guardas
   * mueren con precisión: quitar `id_partida` mata sólo su prueba). Lo que faltaba es la mutación
   * simétrica y **la más natural que existe aquí**: *«agrupo por lo mismo que filtro»*, o sea
   * `GROUP BY 1, d."id_partida"`. No es teórica — con ella el saldo anterior devuelve **una fila por
   * partida del mismo almacén**, el `new Map(...)` del llamador se queda con **la última** (y el
   * orden entre empates de `ORDER BY a."nombre"` **ni siquiera es estable**), y la columna «Saldo»
   * arranca del saldo de UNA partida en vez del total del almacén. El caso es el normal: cualquier
   * color recibido en dos partidas, mirado con la ventana por omisión.
   *
   * El montaje deja DOS partidas y DOS direcciones (entrada y salida) en el MISMO almacén y ANTES
   * del periodo, así que muere igual con `GROUP BY 1, m."id_tipo_mov"` o con `GROUP BY 1, d."id"`:
   * lo que fija es que el saldo anterior de un almacén es **UNA fila con la suma neta**.
   */
  it('⭐⭐⭐ el saldo anterior de un almacén es UNA fila con la SUMA (no una por partida)', async () => {
    // Dos partidas del mismo almacén, antes del periodo.
    await entradaEn('2026-01-10', 100, 40);
    await entradaEn('2026-01-11', 50, 20);
    // Y una SALIDA antes del periodo (el traspaso reparte FIFO: sale de la partida más vieja), para
    // que en el mismo cubo convivan las dos direcciones.
    await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-01-12',
        motivo: 'Se manda al cortador',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 30, cantidadComplemento: 10 }],
      },
      bd(),
    );
    // Algo DENTRO del periodo, para que el almacén tenga renglones que enseñar.
    await entradaEn('2026-06-20', 1, 1);

    const kardex = await kardexTelaColor(
      sesion(),
      { idTelaColor: colorMarino.id, desde: '2026-06-01' },
      bd(),
    );

    // ⭐ UNA sola fila para Bodega A —no dos, ni tres— y con la suma neta de todo lo anterior.
    expect(kardex.saldosIniciales).toHaveLength(1);
    expect(kardex.saldosIniciales[0]?.almacen).toBe('Bodega A');
    expect(kardex.saldosIniciales[0]?.saldoCuerpo).toBe(120); // 100 + 50 − 30
    expect(kardex.saldosIniciales[0]?.saldoComplemento).toBe(50); // 40 + 20 − 10
    // Y el saldo corrido arranca de ahí (si el Map se quedara con una partida, diría 71 u 81).
    expect(kardex.renglones).toHaveLength(1);
    expect(kardex.renglones[0]?.saldoCuerpo).toBe(121);
    expect(kardex.renglones[0]?.saldoComplemento).toBe(51);
  });
});
