/**
 * Integración de LOS DOS AVISOS de la salida de tela (fila 0.101 — Daniel §Post-F9.193, dec. 8 y 9)
 * contra Postgres real. Lo que la unit NO puede probar, porque vive en la base:
 *
 *  (a) **de dónde sale «lo que la orden pide»**: del snapshot `RequerimientoOrden` que escribe la
 *      explosión — LA MISMA fila que lee el tablero del comprador— sumado por TELA;
 *  (b) **qué cuenta como «ya salido»**: TODAS las salidas ligadas a la orden (`origenTipo`
 *      `salida-tela-orden`), incluidas las de una tanda anterior, y **sin las canceladas**;
 *  (c) **qué partidas conoce** el almacén del que se saca, y los TRES estados del aviso de tono —
 *      incluido el que se descubrió en revisión: la tela que llega por **TRASPASO** entra SIN
 *      partida, así que hay existencia real que ninguna partida explica y el aviso tiene que decir
 *      «no se sabe» en vez de callar;
 *  (d) que la PANTALLA LEGADA por lote entra por el mismo aviso (`lineasTela`) y que sus salidas ya
 *      contaban en «ya salido» — la puerta trasera, medida y no sólo razonada;
 *  (e) que la previa es SOLO LECTURA (no escribe ni un movimiento) y que A9 la acota a la empresa.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Almacen, Empresa, PrismaClient, Tela, TelaColor } from '../../datos/index.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  ajustarInventarioTelaColor,
  cancelarMovimientoTelaColor,
  registrarSalidaTelaColorAOrden,
  traspasarTelaColor,
} from './partidas-telas.js';
import { ajustarInventarioTela, registrarSalidaTelaAOrden } from './telas.js';
import { previaSalidaTelaColorAOrden } from './previa-salida-tela-orden.js';

let cliente: PrismaClient;
let empresa: Empresa;
let telaFelpa: Tela;
let telaLisa: Tela;
let colorMarino: TelaColor;
let colorBlanco: TelaColor;
let colorNegroLisa: TelaColor;
let almA: Almacen;
let almB: Almacen;
let idTipoAjusteEntrada: number;
let idOrden: number;

const PERM: ClavePermiso[] = ['inventario-telas.ver', 'inventario-telas.mover'];
const sesion = (permisos: ClavePermiso[] = PERM) =>
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
    data: { idTela: telaFelpa.id, nombre: 'Marino' },
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
  idOrden = await crearOrden();
});

/** Crea una orden mínima de la empresa activa. */
async function crearOrden(): Promise<number> {
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Cliente X' } });
  const modelo = await cliente.modelo.create({ data: { codigo: 'M-1', descripcion: 'Playera' } });
  const orden = await cliente.orden.create({
    data: { folio: 1n, idEmpresa: empresa.id, idModelo: modelo.id, idCliente: clienteNegocio.id },
  });
  return orden.id;
}

/**
 * Escribe el SNAPSHOT de la explosión tal como lo deja `explosionarUna`: una fila por tela×color.
 * Es LA tabla que lee el comprador; la previa la lee tal cual, sin recalcular nada.
 */
async function requerir(
  filas: { idTela: number; idTelaColor?: number; cantidad: number; unidad: string }[],
): Promise<void> {
  for (const f of filas) {
    await cliente.requerimientoOrden.create({
      data: {
        idOrden,
        idTela: f.idTela,
        ...(f.idTelaColor === undefined ? {} : { idTelaColor: f.idTelaColor }),
        cantidadRequerida: f.cantidad,
        unidad: f.unidad,
        cantidadAComprar: f.cantidad,
      },
    });
  }
}

/** Entrada por ajuste: crea UNA partida del color en el almacén dado. */
async function entrar(
  idTelaColor: number,
  cantidad: number,
  extras?: { loteProveedor?: string; idAlmacen?: number; cantidadComplemento?: number },
) {
  return ajustarInventarioTelaColor(
    sesion(),
    {
      idTipoMov: idTipoAjusteEntrada,
      idAlmacen: extras?.idAlmacen ?? almA.id,
      fecha: '2026-09-01',
      motivo: 'Entrada de prueba',
      lineas: [
        {
          idTelaColor,
          cantidad,
          ...(extras?.cantidadComplemento === undefined
            ? {}
            : { cantidadComplemento: extras.cantidadComplemento }),
          ...(extras?.loteProveedor === undefined ? {} : { loteProveedor: extras.loteProveedor }),
        },
      ],
    },
    bd(),
  );
}

/** Salida a la orden por el flujo vigente (por color). */
async function sacar(idTelaColor: number, cantidad: number) {
  return registrarSalidaTelaColorAOrden(
    sesion(),
    { idOrden, idAlmacen: almA.id, fecha: '2026-09-02', lineas: [{ idTelaColor, cantidad }] },
    bd(),
  );
}

/** Pide la previa de una captura por color (el complemento viaja si se le pasa). */
async function previa(
  lineas: { idTelaColor: number; cantidad: number; cantidadComplemento?: number }[],
  idAlmacen = almA.id,
) {
  return previaSalidaTelaColorAOrden(sesion(), { idOrden, idAlmacen, lineas }, bd());
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// (a) SOBRE-SALIDA — el requerido sale del SNAPSHOT DE LA EXPLOSIÓN
// ═════════════════════════════════════════════════════════════════════════════════════════════════

describe('sobre-salida: la cifra sale del snapshot que ve el comprador', () => {
  it('lee `RequerimientoOrden` y SUMA los colores de la misma tela', async () => {
    // La explosión partió la felpa en dos colores (600 + 400 = 1,000 kg).
    await requerir([
      { idTela: telaFelpa.id, idTelaColor: colorMarino.id, cantidad: 600, unidad: 'KG' },
      { idTela: telaFelpa.id, idTelaColor: colorBlanco.id, cantidad: 400, unidad: 'KG' },
    ]);
    await entrar(colorMarino.id, 2000);

    const cabe = await previa([{ idTelaColor: colorMarino.id, cantidad: 900 }]);
    expect(cabe.tieneExplosion).toBe(true);
    expect(cabe.telas[0]).toMatchObject({ requerido: 1000, unidad: 'KG', sobreSalida: false });

    const sePasa = await previa([{ idTelaColor: colorMarino.id, cantidad: 1200 }]);
    expect(sePasa.telas[0]).toMatchObject({ excedente: 200, sobreSalida: true });
    expect(sePasa.haySobreSalida).toBe(true);
  });

  it('SIN snapshot de explosión no inventa un requerido: calla', async () => {
    await entrar(colorMarino.id, 2000);
    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 1500 }]);
    expect(r.tieneExplosion).toBe(false);
    expect(r.telas[0]?.requerido).toBeNull();
    expect(r.haySobreSalida).toBe(false);
  });

  it('un requerimiento de AVÍO no se cuela como si fuera de tela', async () => {
    const avio = await cliente.avio.create({
      data: { clave: 'CIE-53', descripcion: 'Cierre 53 cm', unidad: 'pza' },
    });
    await cliente.requerimientoOrden.create({
      data: {
        idOrden,
        idAvio: avio.id,
        cantidadRequerida: 3000,
        unidad: 'pza',
        cantidadAComprar: 3000,
      },
    });
    await entrar(colorMarino.id, 2000);
    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 1500 }]);
    // Hay snapshot (de avíos), pero de ESA TELA no dice nada: no hay contra qué comparar.
    expect(r.tieneExplosion).toBe(true);
    expect(r.telas[0]?.requerido).toBeNull();
    expect(r.haySobreSalida).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// (b) «LO YA SACADO ANTES» — el caso que evade al aviso ingenuo
// ═════════════════════════════════════════════════════════════════════════════════════════════════

describe('sobre-salida: cuenta lo que YA salió contra la orden', () => {
  it('DOS TANDAS que sumadas se pasan avisan, aunque ninguna se pase sola', async () => {
    await requerir([
      { idTela: telaFelpa.id, idTelaColor: colorMarino.id, cantidad: 1000, unidad: 'KG' },
    ]);
    await entrar(colorMarino.id, 5000);

    // Primera tanda: 700 de 1,000 → cabe, no avisa.
    const primera = await previa([{ idTelaColor: colorMarino.id, cantidad: 700 }]);
    expect(primera.telas[0]).toMatchObject({ yaSalido: 0, sobreSalida: false });
    await sacar(colorMarino.id, 700);

    // Segunda tanda: 400 más. Sola cabría (400 < 1,000); SUMADA se pasa por 100.
    const segunda = await previa([{ idTelaColor: colorMarino.id, cantidad: 400 }]);
    expect(segunda.telas[0]).toMatchObject({
      yaSalido: 700,
      aSacar: 400,
      excedente: 100,
      sobreSalida: true,
    });
  });

  it('suma las salidas de TODOS los colores de la tela (la comparación es por tela)', async () => {
    await requerir([
      { idTela: telaFelpa.id, idTelaColor: colorMarino.id, cantidad: 500, unidad: 'KG' },
      { idTela: telaFelpa.id, idTelaColor: colorBlanco.id, cantidad: 500, unidad: 'KG' },
    ]);
    await entrar(colorMarino.id, 5000);
    await entrar(colorBlanco.id, 5000);
    await sacar(colorMarino.id, 800);

    const r = await previa([{ idTelaColor: colorBlanco.id, cantidad: 300 }]);
    expect(r.telas[0]).toMatchObject({ yaSalido: 800, aSacar: 300, excedente: 100 });
  });

  it('una salida CANCELADA deja de contar (su tela ya volvió al almacén)', async () => {
    await requerir([
      { idTela: telaFelpa.id, idTelaColor: colorMarino.id, cantidad: 1000, unidad: 'KG' },
    ]);
    await entrar(colorMarino.id, 5000);
    const salida = await sacar(colorMarino.id, 900);
    expect((await previa([{ idTelaColor: colorMarino.id, cantidad: 300 }])).telas[0]).toMatchObject(
      {
        yaSalido: 900,
        sobreSalida: true,
      },
    );

    await cancelarMovimientoTelaColor(sesion(), salida.id, { motivo: 'Se capturó de más' }, bd());
    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 300 }]);
    expect(r.telas[0]).toMatchObject({ yaSalido: 0, excedente: 0, sobreSalida: false });
  });

  it('NO cuenta las salidas de OTRA orden', async () => {
    await requerir([
      { idTela: telaFelpa.id, idTelaColor: colorMarino.id, cantidad: 1000, unidad: 'KG' },
    ]);
    await entrar(colorMarino.id, 5000);
    const otra = await crearOrden2();
    await registrarSalidaTelaColorAOrden(
      sesion(),
      {
        idOrden: otra,
        idAlmacen: almA.id,
        fecha: '2026-09-02',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 900 }],
      },
      bd(),
    );
    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 300 }]);
    expect(r.telas[0]?.yaSalido).toBe(0);
  });
});

/** Segunda orden de la misma empresa (para probar que las salidas no se cruzan). */
async function crearOrden2(): Promise<number> {
  const modelo = await cliente.modelo.create({ data: { codigo: 'M-2', descripcion: 'Sudadera' } });
  const clienteNegocio = await cliente.cliente.findFirstOrThrow();
  const orden = await cliente.orden.create({
    data: { folio: 2n, idEmpresa: empresa.id, idModelo: modelo.id, idCliente: clienteNegocio.id },
  });
  return orden.id;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// (c) RIESGO DE TONO — partidas vivas del color EN ESE ALMACÉN
// ═════════════════════════════════════════════════════════════════════════════════════════════════

describe('riesgo de tono: los TRES estados contra la base', () => {
  // 🔴 La conducta que la 0.101 arregla: hasta la v0.100 este aviso salía SIEMPRE.
  it('UNA partida que explica toda la existencia = sin riesgo: NO avisa', async () => {
    await entrar(colorMarino.id, 500, { loteProveedor: 'L-A' });
    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 100 }]);
    expect(r.hayRiesgoTono).toBe(false);
    expect(r.colores[0]).toMatchObject({ estadoTono: 'sin-riesgo', existencia: 500 });
    expect(r.colores[0]?.partidas).toHaveLength(1);
  });

  it('con DOS partidas avisa Y las lista (folio, lote y cuánto entró)', async () => {
    await entrar(colorMarino.id, 500, { loteProveedor: 'L-A' });
    await entrar(colorMarino.id, 300, { loteProveedor: 'L-B' });
    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 100 }]);
    expect(r.hayRiesgoTono).toBe(true);
    const color = r.colores[0]!;
    expect(color).toMatchObject({
      estadoTono: 'varias-partidas',
      telaColor: 'Marino',
      tela: 'Felpa Suiza',
    });
    expect(color.partidas.map((p) => p.loteProveedor)).toEqual(['L-A', 'L-B']);
    expect(color.partidas.map((p) => p.entrado)).toEqual([500, 300]);
  });

  // ⭐⭐ EL HUECO QUE ENCONTRÓ LA REVISIÓN, medido contra la base con un traspaso DE VERDAD.
  // Las patas del traspaso van con `idPartida = NULL`, así que la tela aterriza en el almacén del
  // cortador sin ninguna partida que la nombre. Antes: cero partidas ⇒ aviso mudo con la tela
  // enfrente. Ahora: hay existencia que nada explica ⇒ el aviso lo DICE.
  it('tela llegada por TRASPASO (sin partida) = origen desconocido: AVISA en vez de callar', async () => {
    await entrar(colorMarino.id, 800, { loteProveedor: 'L-A' });
    await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-09-02',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 800 }],
      },
      bd(),
    );
    // En el almacén DESTINO (el del cortador) hay 800 kg y NINGUNA partida que los explique.
    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 100 }], almB.id);
    expect(r.hayRiesgoTono).toBe(true);
    expect(r.colores[0]).toMatchObject({
      estadoTono: 'origen-desconocido',
      existencia: 800,
      entradoConocido: 0,
    });
    expect(r.colores[0]?.partidas).toEqual([]);
  });

  it('traspaso PARCIAL sobre una partida conocida: lo que sobra tampoco se calla', async () => {
    // Una partida propia del destino (300) + 500 que llegan traspasados = 800 de existencia que una
    // sola partida no explica. La regla de "cero partidas" seguiría callando este caso.
    await entrar(colorMarino.id, 300, { loteProveedor: 'L-DESTINO', idAlmacen: almB.id });
    await entrar(colorMarino.id, 500, { loteProveedor: 'L-ORIGEN' });
    await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-09-02',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 500 }],
      },
      bd(),
    );
    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 100 }], almB.id);
    expect(r.colores[0]).toMatchObject({
      estadoTono: 'origen-desconocido',
      existencia: 800,
      entradoConocido: 300,
    });
  });

  // ⭐⭐ EL COMPLEMENTO ES LA RAZÓN DE SER DE ESTE AVISO, y hasta la tercera revisión no lo vigilaba
  // NADIE: se podía quitar el cardigan de cualquiera de los dos lados de la comparación y las 18
  // pruebas seguían verdes. `DECISIONES.md` §Post-F9.11 punto 2, textual: *"el cuerpo puede salir de
  // una partida y el complemento de otra. Cuando eso pase, la pantalla avisa"* — y describe la
  // compra de SÓLO cardigan (misma tela y color, cuerpo en 0, con su propia partida).
  it('una partida de SÓLO complemento explica su existencia y NO dispara origen-desconocido', async () => {
    // El caso de Daniel: llega cardigan solo, con su partida. Cuerpo 0, complemento 500.
    await entrar(colorMarino.id, 0, { cantidadComplemento: 500, loteProveedor: 'L-CARDIGAN' });
    const r = await previa([
      { idTelaColor: colorMarino.id, cantidad: 0, cantidadComplemento: 100 },
    ]);
    expect(r.colores[0]).toMatchObject({
      estadoTono: 'sin-riesgo',
      existencia: 500,
      entradoConocido: 500,
    });
    expect(r.hayRiesgoTono).toBe(false);
  });

  it('el complemento llegado por TRASPASO también cuenta como tela de origen desconocido', async () => {
    // Sin el complemento en la EXISTENCIA, el almacén destino se vería vacío y el aviso callaría
    // con 300 kg de cardigan de tono desconocido en el anaquel.
    await entrar(colorMarino.id, 0, { cantidadComplemento: 300, loteProveedor: 'L-CARDIGAN' });
    await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-09-02',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 0, cantidadComplemento: 300 }],
      },
      bd(),
    );
    const r = await previa(
      [{ idTelaColor: colorMarino.id, cantidad: 0, cantidadComplemento: 100 }],
      almB.id,
    );
    expect(r.colores[0]).toMatchObject({
      estadoTono: 'origen-desconocido',
      existencia: 300,
      entradoConocido: 0,
    });
  });

  // ⭐⭐ EL CASO MIXTO CONTRA LA BASE: dos partidas conocidas en el almacén Y tela traspasada encima.
  // Las DOS condiciones son ciertas y **gana la alarma**, que es la que trae la lista. Nada fijaba
  // esa precedencia hasta esta prueba: invertir el ternario escondía la lista justo aquí.
  it('con VARIAS partidas Y tela traspasada encima gana la ALARMA, y dice cuánto no puede nombrar', async () => {
    await entrar(colorMarino.id, 500, { loteProveedor: 'L-A', idAlmacen: almB.id });
    await entrar(colorMarino.id, 300, { loteProveedor: 'L-B', idAlmacen: almB.id });
    // …y 200 más que llegan traspasados desde la bodega, SIN partida que los nombre.
    await entrar(colorMarino.id, 200, { loteProveedor: 'L-BODEGA' });
    await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-09-02',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 200 }],
      },
      bd(),
    );

    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 100 }], almB.id);
    expect(r.colores[0]).toMatchObject({
      estadoTono: 'varias-partidas',
      existencia: 1000,
      entradoConocido: 800,
      sinNombrar: 200,
    });
    // La lista sobrevive —es lo accionable— y la cantidad sin nombrar viaja junto a ella.
    expect(r.colores[0]?.partidas.map((p) => p.loteProveedor)).toEqual(['L-A', 'L-B']);
  });

  it('las partidas de OTRO almacén no cuentan (se saca del almacén elegido)', async () => {
    await entrar(colorMarino.id, 500, { loteProveedor: 'L-A' });
    await entrar(colorMarino.id, 300, { loteProveedor: 'L-B', idAlmacen: almB.id });
    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 100 }], almA.id);
    expect(r.hayRiesgoTono).toBe(false);
    expect(r.colores[0]?.partidas.map((p) => p.loteProveedor)).toEqual(['L-A']);
  });

  it('una entrada CANCELADA no deja partida NI existencia: vuelve a haber una sola', async () => {
    await entrar(colorMarino.id, 500, { loteProveedor: 'L-A' });
    const segunda = await entrar(colorMarino.id, 300, { loteProveedor: 'L-B' });
    expect((await previa([{ idTelaColor: colorMarino.id, cantidad: 100 }])).hayRiesgoTono).toBe(
      true,
    );

    await cancelarMovimientoTelaColor(sesion(), segunda.id, { motivo: 'No llegó' }, bd());
    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 100 }]);
    expect(r.colores[0]).toMatchObject({ estadoTono: 'sin-riesgo', existencia: 500 });
    expect(r.colores[0]?.partidas.map((p) => p.loteProveedor)).toEqual(['L-A']);
  });

  it('el riesgo es POR COLOR: las partidas de otro color no lo disparan', async () => {
    await entrar(colorMarino.id, 500, { loteProveedor: 'L-A' });
    await entrar(colorBlanco.id, 300, { loteProveedor: 'L-B' });
    await entrar(colorBlanco.id, 200, { loteProveedor: 'L-C' });
    const r = await previa([
      { idTelaColor: colorMarino.id, cantidad: 100 },
      { idTelaColor: colorBlanco.id, cantidad: 100 },
    ]);
    const porColor = new Map(r.colores.map((c) => [c.telaColor, c.estadoTono]));
    expect(porColor.get('Marino')).toBe('sin-riesgo');
    expect(porColor.get('Blanco')).toBe('varias-partidas');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// (d) LA PANTALLA LEGADA POR LOTE — la puerta trasera, medida por su punto de entrada
// ═════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 Esta sección existe porque la rama de `lineasTela` se podía BORRAR ENTERA y todo el backend
// seguía verde: la unit probaba el núcleo puro con una línea sin color hecha a mano —saltándose el
// punto de entrada— y el frontend mockeaba el hook. Aquí se entra por donde entra la pantalla.

describe('la pantalla LEGADA por lote entra al MISMO aviso', () => {
  /** Da de alta existencia por LOTE (flujo viejo, D5) y devuelve el id del lote creado. */
  async function entrarPorLote(cantidad: number): Promise<number> {
    const colorPrenda = await cliente.color.create({
      data: { nombre: `Tono ${String(cantidad)}` },
    });
    await ajustarInventarioTela(
      sesion(),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almA.id,
        fecha: '2026-09-01',
        motivo: 'Entrada legada por lote',
        lote: { idColor: colorPrenda.id, componentes: [{ idTela: telaFelpa.id, cantidad }] },
      },
      bd(),
    );
    const lote = await cliente.lote.findFirstOrThrow({ orderBy: { id: 'desc' } });
    return lote.id;
  }

  it('sus renglones SIN COLOR (`lineasTela`) entran al aviso de sobre-salida', async () => {
    await requerir([
      { idTela: telaFelpa.id, idTelaColor: colorMarino.id, cantidad: 1000, unidad: 'KG' },
    ]);
    const r = await previaSalidaTelaColorAOrden(
      sesion(),
      {
        idOrden,
        idAlmacen: almA.id,
        lineasTela: [{ idTela: telaFelpa.id, cantidad: 1200 }],
      },
      bd(),
    );
    expect(r.telas[0]).toMatchObject({
      tela: 'Felpa Suiza',
      requerido: 1000,
      aSacar: 1200,
      excedente: 200,
      sobreSalida: true,
    });
    // Sin color no hay partidas entre las que escoger: el aviso de tono no dice nada de esto.
    expect(r.colores).toEqual([]);
    expect(r.hayRiesgoTono).toBe(false);
  });

  // ⭐ Y la otra mitad: una salida REAL del flujo legado cuenta como «ya salido». Hasta ahora eso
  // sólo estaba razonado en un comentario (comparten `origenTipo`); aquí queda medido.
  it('una salida REAL del flujo legado ya cuenta en «ya salido» (de las dos pantallas)', async () => {
    await requerir([
      { idTela: telaFelpa.id, idTelaColor: colorMarino.id, cantidad: 1000, unidad: 'KG' },
    ]);
    const idLote = await entrarPorLote(900);
    await registrarSalidaTelaAOrden(
      sesion(),
      {
        idOrden,
        idAlmacen: almA.id,
        fecha: '2026-09-02',
        lineas: [{ idTela: telaFelpa.id, idLote, cantidad: 900 }],
      },
      bd(),
    );

    // (1) La pantalla LEGADA lo ve: 900 fuera + 200 más = 100 de más.
    const legada = await previaSalidaTelaColorAOrden(
      sesion(),
      { idOrden, idAlmacen: almA.id, lineasTela: [{ idTela: telaFelpa.id, cantidad: 200 }] },
      bd(),
    );
    expect(legada.telas[0]).toMatchObject({ yaSalido: 900, aSacar: 200, excedente: 100 });

    // (2) Y la pantalla POR COLOR también: es la MISMA tela, contada una sola vez.
    await entrar(colorMarino.id, 500);
    const porColor = await previa([{ idTelaColor: colorMarino.id, cantidad: 200 }]);
    expect(porColor.telas[0]).toMatchObject({ yaSalido: 900, excedente: 100, sobreSalida: true });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// (e) La previa NO escribe, y respeta la empresa activa (A9)
// ═════════════════════════════════════════════════════════════════════════════════════════════════

describe('la previa es de solo lectura y respeta A9', () => {
  it('no registra NINGÚN movimiento ni toca el snapshot', async () => {
    await requerir([
      { idTela: telaLisa.id, idTelaColor: colorNegroLisa.id, cantidad: 10, unidad: 'M' },
    ]);
    await entrar(colorNegroLisa.id, 500);
    const movsAntes = await cliente.movimiento.count();
    const reqAntes = await cliente.requerimientoOrden.count();

    await previa([{ idTelaColor: colorNegroLisa.id, cantidad: 9999 }]);

    expect(await cliente.movimiento.count()).toBe(movsAntes);
    expect(await cliente.requerimientoOrden.count()).toBe(reqAntes);
  });

  it('una orden de OTRA empresa responde 404 (no se dice nada de ella)', async () => {
    const otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra SA de CV');
    const modelo = await cliente.modelo.create({ data: { codigo: 'M-9', descripcion: 'X' } });
    const clienteNegocio = await cliente.cliente.findFirstOrThrow();
    const ajena = await cliente.orden.create({
      data: {
        folio: 77n,
        idEmpresa: otraEmpresa.id,
        idModelo: modelo.id,
        idCliente: clienteNegocio.id,
      },
    });
    await expect(
      previaSalidaTelaColorAOrden(
        sesion(),
        {
          idOrden: ajena.id,
          idAlmacen: almA.id,
          lineas: [{ idTelaColor: colorMarino.id, cantidad: 1 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});
