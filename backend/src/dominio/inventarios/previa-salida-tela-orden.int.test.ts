/**
 * Integración de LOS DOS AVISOS de la salida de tela (fila 0.101 — Daniel §Post-F9.193, dec. 8 y 9)
 * contra Postgres real. Lo que la unit NO puede probar, porque vive en la base:
 *
 *  (a) **de dónde sale «lo que la orden pide»**: del snapshot `RequerimientoOrden` que escribe la
 *      explosión — LA MISMA fila que lee el tablero del comprador— sumado por TELA;
 *  (b) **qué cuenta como «ya salido»**: TODAS las salidas ligadas a la orden (`origenTipo`
 *      `salida-tela-orden`), incluidas las de una tanda anterior, y **sin las canceladas**;
 *  (c) **qué lotes quedan VIVOS** en el almacén del que se saca (Σ neta: entradas − salidas que los
 *      nombran, fila 0.142) y los TRES estados del aviso de tono. ⭐ **Desde la 0.142 el TRASPASO
 *      nombra el lote**, así que la tela que llega traspasada ya se puede listar; el tercer estado
 *      (`origen-desconocido`) sigue vivo para la tela que nadie puede nombrar, que **sí la producen
 *      varias puertas del dominio** —el ajuste de entrada del conteo cíclico, la cancelación de una
 *      salida sin lote, un traspaso desde un almacén con tela sin nombre— además de los traspasos
 *      anteriores a esta fila. El helper {@link entrarSinLote} la escribe a mano **por comodidad de
 *      la prueba, no porque no exista puerta**: el porqué está en su propio TSDoc;
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

/**
 * ⭐ **UNA ENTRADA DE TELA SIN LOTE**, escrita a mano contra el kardex. Reproduce exactamente la
 * forma que dejaban los traspasos ANTERIORES a la fila 0.142 (`idPartida = NULL` en las dos patas),
 * que es la que sigue viva en `prueba` y en producción y que **no se repara** (REGLA 0-B: lo viejo
 * se tolera, no se arregla). Es lo que mantiene medido el estado `origen-desconocido`.
 *
 * 🔴 **Por qué se escribe a mano y NO por una puerta del dominio, dicho con precisión** — la primera
 * versión de este comentario afirmaba que *«ninguna puerta la produce»* y **era FALSO por partida
 * doble** (lo cazó el reviewer de la ronda de corrección):
 *  • el **ajuste de ENTRADA del conteo CÍCLICO** (`indicadores/ciclico/tela.ts`) **sí** produce
 *    entradas de tela sin lote, y es una puerta VIVA desde la v0.120 — su propio TSDoc lo dice;
 *  • **cancelar una salida** que no llevaba lote deja una entrada con `idPartida = NULL`, y eso lo
 *    dice el módulo que esta misma fila tocó (`previa-salida-tela-orden.ts`, cabecera).
 * Se escribe a mano igualmente, y por una razón mejor: montar un conteo cíclico completo o una
 * cancelación **sólo para conseguir el dato** metería en esta prueba dos módulos que no son el
 * sujeto, y la haría fallar por motivos ajenos. Aquí interesa **la forma del renglón**, no cómo nació.
 */
let folioLegado = 900000n;
async function entrarSinLote(
  idTelaColor: number,
  cantidad: number,
  extras?: { idAlmacen?: number; cantidadComplemento?: number },
): Promise<void> {
  const tipo = await cliente.tipoMovimientoInventario.findFirstOrThrow({
    where: { codigo: 'transferencia-entrada' },
  });
  const color = await cliente.telaColor.findUniqueOrThrow({ where: { id: idTelaColor } });
  folioLegado += 1n;
  await cliente.movimiento.create({
    data: {
      folio: folioLegado,
      idEmpresa: empresa.id,
      idTipoMov: tipo.id,
      idAlmacen: extras?.idAlmacen ?? almB.id,
      fecha: new Date('2026-08-01T00:00:00.000Z'),
      origenTipo: 'traspaso',
      detallesTela: {
        create: [
          {
            idTela: color.idTela,
            idTelaColor,
            idPartida: null,
            cantidad,
            cantidadComplemento: extras?.cantidadComplemento ?? null,
          },
        ],
      },
    },
  });
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

  it('con DOS partidas avisa Y las lista (folio, lote y cuánto QUEDA de cada una)', async () => {
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
    expect(color.partidas.map((p) => p.saldo)).toEqual([500, 300]);
  });

  // ⭐⭐⭐ LA FILA 0.142, MEDIDA DE PUNTA A PUNTA: el traspaso NOMBRA EL LOTE en el destino.
  // Hasta la 0.141 las dos patas iban con `idPartida = NULL` y este mismo escenario daba
  // `origen-desconocido` con `entradoConocido: 0` — o sea, el almacén del cortador ciego. Hoy el
  // lote viaja, así que el destino sabe exactamente de qué partida es su tela.
  it('⭐ tela llegada por TRASPASO llega CON SU LOTE: el destino lo conoce y no hay nada que avisar', async () => {
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
    // En el almacén DESTINO (el del cortador) hay 800 kg y UNA partida que los explica entera.
    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 100 }], almB.id);
    expect(r.hayRiesgoTono).toBe(false);
    expect(r.colores[0]).toMatchObject({
      estadoTono: 'sin-riesgo',
      existencia: 800,
      saldoConocido: 800,
      sinNombrar: 0,
    });
    expect(r.colores[0]?.partidas.map((p) => p.loteProveedor)).toEqual(['L-A']);
    // Y en el ORIGEN el lote ya no queda: el traspaso lo descontó de ahí (Σ neta, no acumulado).
    const enOrigen = await previa([{ idTelaColor: colorMarino.id, cantidad: 1 }], almA.id);
    expect(enOrigen.colores[0]).toMatchObject({ existencia: 0, saldoConocido: 0 });
    expect(enOrigen.colores[0]?.partidas).toEqual([]);
  });

  // ⭐ Y el tercer estado SIGUE VIVO, para la tela que nadie puede nombrar: la que se traspasó
  // ANTES de la 0.142 y se queda así (REGLA 0-B — aditivo, sin backfill). Sin esta prueba, el
  // estado `origen-desconocido` se quedaba sin un solo caso que lo midiera contra la base.
  it('la tela vieja (traspasada ANTES de la 0.142, sin lote) sigue dando ORIGEN DESCONOCIDO', async () => {
    await entrarSinLote(colorMarino.id, 800);
    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 100 }], almB.id);
    expect(r.hayRiesgoTono).toBe(true);
    expect(r.colores[0]).toMatchObject({
      estadoTono: 'origen-desconocido',
      existencia: 800,
      saldoConocido: 0,
      sinNombrar: 800,
    });
    expect(r.colores[0]?.partidas).toEqual([]);
  });

  // ⭐⭐ EL SEGUNDO DEFECTO QUE LA FILA CURA, con el escenario EXACTO que lo midió: 500 con lote ya
  // consumidos + 300 que llegan traspasados. Con la regla vieja daba `300 > 500` = falso ⇒ SIN
  // RIESGO, con tela de tono desconocido en el anaquel. Hoy los 300 llegan CON su lote, así que hay
  // dos lotes que listar y el aviso sale.
  it('⭐ 500 con lote ya consumidos + 300 traspasados: antes callaba, ahora AVISA y los lista', async () => {
    await entrar(colorMarino.id, 500, { loteProveedor: 'L-VIEJO', idAlmacen: almB.id });
    // Se consumen enteros por una salida a orden desde ESE almacén (que no nombra lote, P3).
    await registrarSalidaTelaColorAOrden(
      sesion(),
      {
        idOrden,
        idAlmacen: almB.id,
        fecha: '2026-09-02',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 500 }],
      },
      bd(),
    );
    // …y llegan 300 traspasados desde la bodega, ahora CON su lote.
    await entrar(colorMarino.id, 300, { loteProveedor: 'L-NUEVO' });
    await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-09-03',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 300 }],
      },
      bd(),
    );

    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 100 }], almB.id);
    expect(r.hayRiesgoTono).toBe(true);
    expect(r.colores[0]).toMatchObject({ estadoTono: 'varias-partidas', existencia: 300 });
    expect(r.colores[0]?.partidas.map((p) => p.loteProveedor)).toEqual(['L-VIEJO', 'L-NUEVO']);
    // 🔻 EL LÍMITE DECLARADO DE P3, MEDIDO Y NO SÓLO RAZONADO: la salida a orden NO nombró el lote,
    // así que `L-VIEJO` sigue con saldo 500 aunque en el anaquel no quede nada suyo — el saldo por
    // lote queda POR ENCIMA de la existencia en un almacén que consume. Es el precio de que el
    // consumo empareje por color, y quien lea este número tiene que saberlo.
    expect(r.colores[0]?.saldoConocido).toBe(800);
    expect(r.colores[0]?.partidas.map((p) => p.saldo)).toEqual([500, 300]);
  });

  // ⭐⭐ LO QUE APORTA EL SALDO **NETO** (decisión P1), y sin lo cual esta fila habría cambiado
  // «callar» por «avisar de más»: en el ORIGEN, un lote que ya se fue entero DEJA DE LISTARSE.
  // Con la Σ vieja (sólo entradas) los dos lotes seguirían contando para siempre ⇒ la bodega vacía
  // gritaría `varias-partidas` en cada captura.
  it('⭐ los lotes que ya se traspasaron ENTEROS desaparecen de la lista del origen', async () => {
    await entrar(colorMarino.id, 500, { loteProveedor: 'L-A' });
    await entrar(colorMarino.id, 300, { loteProveedor: 'L-B' });
    // Antes de moverlos, la bodega sí tiene dos lotes que ofrecer.
    const antes = await previa([{ idTelaColor: colorMarino.id, cantidad: 10 }], almA.id);
    expect(antes.colores[0]?.estadoTono).toBe('varias-partidas');

    await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-09-03',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 800 }],
      },
      bd(),
    );

    const despues = await previa([{ idTelaColor: colorMarino.id, cantidad: 10 }], almA.id);
    expect(despues.colores[0]).toMatchObject({
      estadoTono: 'sin-riesgo',
      existencia: 0,
      saldoConocido: 0,
    });
    expect(despues.colores[0]?.partidas).toEqual([]);
    // Y los DOS lotes aterrizaron en el destino, cada uno con lo suyo (FIFO: primero L-A entero).
    const enDestino = await previa([{ idTelaColor: colorMarino.id, cantidad: 10 }], almB.id);
    expect(enDestino.colores[0]?.partidas.map((p) => [p.loteProveedor, p.saldo])).toEqual([
      ['L-A', 500],
      ['L-B', 300],
    ]);
  });

  it('⭐ una partida propia del destino MÁS una traspasada = DOS lotes: la alarma con la lista', async () => {
    // Antes de la 0.142 este caso daba `origen-desconocido` con 500 sin nombrar: el destino veía
    // 800 kg y sólo podía explicar los 300 suyos. Hoy los 500 llegan con `L-ORIGEN`, así que hay
    // DOS tonos de verdad entre los que escoger — y eso es exactamente lo que Daniel pidió ver.
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
      estadoTono: 'varias-partidas',
      existencia: 800,
      saldoConocido: 800,
      sinNombrar: 0,
    });
    expect(r.colores[0]?.partidas.map((p) => p.loteProveedor)).toEqual(['L-DESTINO', 'L-ORIGEN']);
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
      saldoConocido: 500,
    });
    expect(r.hayRiesgoTono).toBe(false);
  });

  it('⭐ el COMPLEMENTO traspasado también llega con su lote (una partida de sólo cardigan)', async () => {
    // El complemento es una existencia INDEPENDIENTE del cuerpo, y hay partidas de sólo cardigan.
    // Si el reparto del traspaso mirara nada más el cuerpo, este cardigan aterrizaría sin nombre.
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
      estadoTono: 'sin-riesgo',
      existencia: 300,
      saldoConocido: 300,
      sinNombrar: 0,
    });
    expect(r.colores[0]?.partidas.map((p) => p.loteProveedor)).toEqual(['L-CARDIGAN']);
    // Y el cardigan VIEJO (traspasado antes de la 0.142) sigue sin nombre: la tela no se repara.
    await entrarSinLote(colorBlanco.id, 0, { cantidadComplemento: 120 });
    const viejo = await previa(
      [{ idTelaColor: colorBlanco.id, cantidad: 0, cantidadComplemento: 10 }],
      almB.id,
    );
    expect(viejo.colores[0]).toMatchObject({
      estadoTono: 'origen-desconocido',
      existencia: 120,
      sinNombrar: 120,
    });
  });

  // ⭐⭐ EL CASO MIXTO CONTRA LA BASE: dos lotes vivos en el almacén Y tela que nadie puede nombrar
  // encima. Las DOS condiciones son ciertas y **gana la alarma**, que es la que trae la lista. Nada
  // fijaba esa precedencia hasta esta prueba: invertir el ternario escondía la lista justo aquí.
  // ⚠️ Desde la 0.142 la tela sin nombre ya NO puede venir de un traspaso nuevo (ésos nombran el
  // lote): viene de la que se traspasó ANTES, que es la que sigue en `prueba` y en producción.
  it('con VARIOS lotes Y tela sin nombrar encima gana la ALARMA, y dice cuánto no puede nombrar', async () => {
    await entrar(colorMarino.id, 500, { loteProveedor: 'L-A', idAlmacen: almB.id });
    await entrar(colorMarino.id, 300, { loteProveedor: 'L-B', idAlmacen: almB.id });
    // …y 200 más de la tela vieja, entrada antes de la 0.142, sin lote que la nombre.
    await entrarSinLote(colorMarino.id, 200);

    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 100 }], almB.id);
    expect(r.colores[0]).toMatchObject({
      estadoTono: 'varias-partidas',
      existencia: 1000,
      saldoConocido: 800,
      sinNombrar: 200,
    });
    // La lista sobrevive —es lo accionable— y la cantidad sin nombrar viaja junto a ella.
    expect(r.colores[0]?.partidas.map((p) => p.loteProveedor)).toEqual(['L-A', 'L-B']);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 🔴 EL HALLAZGO GRAVE DE LA RONDA DE CORRECCIÓN, contra la base y de punta a punta
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  it('🔴 el traspaso NO nombra un lote que ya se consumió: los cuatro pasos del reviewer', async () => {
    // 1. Entran 500 de L-VIEJO a la bodega.
    await entrar(colorMarino.id, 500, { loteProveedor: 'L-VIEJO' });
    // 2. Se surten los 500 a una orden. La salida NO nombra lote (P3) ⇒ el saldo de L-VIEJO sigue
    //    diciendo 500 aunque en el anaquel no quede ni un kilo suyo.
    await sacar(colorMarino.id, 500);
    // 3. Entran 300 de L-NUEVO: es LO ÚNICO que hay en la bodega.
    await entrar(colorMarino.id, 300, { loteProveedor: 'L-NUEVO' });
    // 4. Se traspasan esos 300 al cortador.
    const traspaso = await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-09-04',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 300 }],
      },
      bd(),
    );

    // ⭐ El renglón del kardex —el mismo que viaja a las DOS patas y a la hoja impresa— tiene que
    // nombrar L-NUEVO. Sin el tope contra la existencia real decía L-VIEJO: un lote fantasma.
    const detalles = await cliente.movimientoDetTela.findMany({
      where: { idMovimiento: { in: [traspaso.salida.id, traspaso.entrada.id] } },
      select: { idMovimiento: true, partida: { select: { loteProveedor: true } } },
    });
    expect(detalles).toHaveLength(2);
    expect(detalles.map((d) => d.partida?.loteProveedor)).toEqual(['L-NUEVO', 'L-NUEVO']);

    // Y en el destino el aviso dice la verdad: un solo lote, el que de verdad llegó.
    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 100 }], almB.id);
    expect(r.colores[0]?.partidas.map((p) => p.loteProveedor)).toEqual(['L-NUEVO']);
    expect(r.colores[0]).toMatchObject({ estadoTono: 'sin-riesgo', existencia: 300 });
  });

  // 🔻🔻 EL LÍMITE DEL TOPE, MEDIDO — y esta prueba existe para que NADIE vuelva a prometer de más.
  // La primera versión de esta fila afirmó que el tope garantiza *«nunca se nombra un lote que ya no
  // tiene nada»*. **Es FALSO cuando además ha entrado tela SIN lote**, y aquí está el porqué: el
  // desajuste `Σ saldos − existencia` mezcla DOS causas de signo contrario que la Σ no puede
  // separar — el consumo no nombrado (el lote reclama de MÁS) y la entrada sin lote (reclama de
  // MENOS)— y se cancelan entre sí. Medido: 500 de `L-FANTASMA` consumidos sin nombrar (sobre-
  // reclamo real = 500) + 200 entrados sin lote ⇒ el tope sólo ve 300 de desajuste y le deja al
  // fantasma 200 kg que físicamente no son suyos.
  it('🔻 LÍMITE: con tela sin lote de por medio, el tope NO borra del todo al lote fantasma', async () => {
    await entrar(colorMarino.id, 500, { loteProveedor: 'L-FANTASMA' });
    await sacar(colorMarino.id, 500); // salida a orden: no nombra lote (P3)
    await entrarSinLote(colorMarino.id, 200, { idAlmacen: almA.id });

    const traspaso = await traspasarTelaColor(
      sesion(),
      {
        idAlmacenOrigen: almA.id,
        idAlmacenDestino: almB.id,
        fecha: '2026-09-04',
        lineas: [{ idTelaColor: colorMarino.id, cantidad: 200 }],
      },
      bd(),
    );
    const detalles = await cliente.movimientoDetTela.findMany({
      where: { idMovimiento: traspaso.entrada.id },
      select: { idPartida: true, cantidad: true },
    });
    // ⚠️ ESTO ES LO QUE HACE, y se escribe tal cual en vez de fingir que hace otra cosa: nombra
    // `L-FANTASMA`. La raíz sigue siendo P3 y está declarada en DECISIONES §Post-F9.206.
    expect(detalles).toHaveLength(1);
    expect(detalles[0]?.idPartida).not.toBeNull();

    // ⚠️ Y EL MECANISMO, DICHO BIEN. Una versión anterior de este comentario afirmaba que «con tope
    // el saldo del fantasma queda en 0». **Es falso, y aquí queda fijado:** el tope acota un pool EN
    // MEMORIA para decidir el reparto — **no escribe nada en el kardex**. El saldo de `L-FANTASMA`
    // en el origen queda en 500 − 200 = **300**, exactamente igual que sin tope. Lo que sí cambia es
    // el SIGUIENTE traspaso: con la existencia ya en 0, el tope vacía el pool y no lo nombra.
    const idFantasma = detalles[0]?.idPartida ?? 0;
    const saldoFantasma = await cliente.movimientoDetTela.aggregate({
      where: { idPartida: idFantasma, movimiento: { idAlmacen: almA.id } },
      _sum: { cantidad: true },
    });
    // Σ SIN signo de los renglones que nombran al fantasma en el origen: la entrada de 500 y la pata
    // de salida del traspaso de 200. Que sean 700 demuestra que el tope NO tocó el kardex.
    expect(Number(saldoFantasma._sum.cantidad ?? 0)).toBe(700);
  });

  it('un lote con CUERPO vivo y complemento en negativo NO desaparece de la lista', async () => {
    // Hallazgo 6: `saldo = cuerpo + complemento` con filtro sobre la suma borraba de la lista un
    // lote con +100 de cuerpo y −100 de cardigan, aunque esos 100 kg de cuerpo sí fueran suyos.
    await entrar(colorMarino.id, 100, { cantidadComplemento: 0, loteProveedor: 'L-MIXTO' });
    // Un inverso de corrección deja el complemento de ESE lote en negativo.
    const tipoSalida = await cliente.tipoMovimientoInventario.findFirstOrThrow({
      where: { codigo: 'ajuste-salida' },
    });
    const partida = await cliente.partidaTela.findFirstOrThrow({
      where: { loteProveedor: 'L-MIXTO' },
    });
    await cliente.movimiento.create({
      data: {
        folio: 800001n,
        idEmpresa: empresa.id,
        idTipoMov: tipoSalida.id,
        idAlmacen: almA.id,
        fecha: new Date('2026-09-03T00:00:00.000Z'),
        origenTipo: 'cancelacion',
        detallesTela: {
          create: [
            {
              idTela: telaFelpa.id,
              idTelaColor: colorMarino.id,
              idPartida: partida.id,
              cantidad: 0,
              cantidadComplemento: 100,
            },
          ],
        },
      },
    });

    const r = await previa([{ idTelaColor: colorMarino.id, cantidad: 10 }], almA.id);
    expect(r.colores[0]?.partidas.map((p) => p.loteProveedor)).toEqual(['L-MIXTO']);
    expect(r.colores[0]?.partidas[0]?.saldo).toBe(100);
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
// (d) LA QUE FUE LA PANTALLA LEGADA POR LOTE — la puerta trasera, medida por su punto de entrada
// ═════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 Esta sección existe porque la rama de `lineasTela` se podía BORRAR ENTERA y todo el backend
// seguía verde: la unit probaba el núcleo puro con una línea sin color hecha a mano —saltándose el
// punto de entrada— y el frontend mockeaba el hook. Aquí se entra por donde entraba la pantalla.
//
// ⚠️ La pantalla y su endpoint se RETIRARON en la fila 0.170 (escribían tela SIN color, invisible
// para la pantalla de existencias vigente). La sección se queda: la rama de `lineasTela` sigue viva
// en el dominio y esto es lo único que la mide por su punto de entrada.

describe('lo que entraba por la pantalla LEGADA por lote da el MISMO aviso', () => {
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
