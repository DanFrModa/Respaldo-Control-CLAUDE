import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { SesionUsuario } from '../../comun/permisos.js';
import type { Cliente, Color, Empresa, Modelo, PrismaClient, Talla } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { consultarIncompletas } from './consultas.js';
import { realinearEstadoOrdenes } from './requisitos-orden.js';

/**
 * Integración de "ÓRDENES INCOMPLETAS" (`consultarIncompletas`) contra el Postgres efímero (CI).
 *
 * Es la prueba de PUNTA A PUNTA del entregable que pidió Daniel el 26-jul-2026 (*"si no meten la
 * información del arte, o no desmarcan la casilla, está como incompleto… siempre hay que atender
 * ese tema"*), porque junta las tres piezas que solo la base puede probar juntas:
 *  1. la consulta filtra por el ESTADO GUARDADO (`ordenes.estado = 'capturada'`);
 *  2. una incompleta YA PUEDE TENER MATRIZ (le puede faltar el arte o la receta de avíos), así que
 *     sus piezas se agregan de verdad — antes se proyectaban hardcodeadas en 0;
 *  3. la **puesta al día del histórico** es la que hace visible el backlog: aquí se corre la regla
 *     VIVA (`realinearEstadoOrdenes`, la fuente ÚNICA del dominio) sobre un corpus sembrado a mano,
 *     y se comprueba que degrada lo que debe, respeta lo que no, y que el resultado ATERRIZA en
 *     esta consulta — que es donde Daniel trabaja el tema.
 *
 * ⚠️ DÓNDE QUEDÓ EL SQL DE LA MIGRACIÓN (cambio del 14-ago-2026, V1-E3d). Hasta esta etapa el
 * bloque de la puesta al día LEÍA y re-ejecutaba el archivo real
 * `prisma/migrations/20260726130000_recalculo_estado_ordenes/migration.sql`, para no validar una
 * copia divergente. Dejó de ser posible cuando el arte se movió al modelo: aquel SQL consulta
 * `modelo_bordado`, tabla que `20260814120000_arte_en_el_modelo` ELIMINA (sus renglones se pasan
 * 1:1 a `modelo_arte`, así que el efecto de julio se conserva intacto). La cadena de migraciones
 * NO está rota —en una base nueva la de julio corre cuando `modelo_bordado` todavía existe— y esa
 * migración NO se toca: ya corrió en `prueba` y en `main`, es historia inmutable. Lo que dejó de
 * tener sentido es REPRODUCIR una migración congelada contra el esquema de hoy.
 *
 * El espíritu original —validar lo que se despliega, no una copia— se conserva mejor todavía
 * ejercitando la regla viva: aquel SQL era, por su propia cabecera, una RÉPLICA en SQL de
 * `requisitos-orden.ts`, y hoy la puesta al día que de verdad corre (en el go-live y tras cada
 * carga de datos) es el script `migracion/realinear-estado-ordenes.ts`, que delega en
 * `realinearEstadoOrdenes` — el motor que se usa aquí. El recorrido completo del script
 * (paginación, transacción por lote, `--dry-run`, `--empresa`) se prueba en
 * `migracion/realinear-estado-ordenes.int.test.ts`; lo que sigue viviendo AQUÍ es el amarre con la
 * pantalla. Única aserción que cambió de literal: el `motivo` de la bitácora
 * (`realineado-post-carga` en vez de `recalculo-estado-automatico`), porque el proceso que la
 * escribe es otro. Ninguna otra se relajó.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let clienteNegocio: Cliente;
let colorRojo: Color;
let tallaCH: Talla;
/** Modelo COMPLETO: receta de avíos + prenda lisa (`llevaArte: false`). */
let modeloOk: Modelo;
/** Modelo que LLEVA arte (default) y NO lo tiene capturado en el BOM. */
let modeloSinArte: Modelo;

const bd = () => ({ cliente });
const sesion = (): SesionUsuario =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: ['ordenes.ver'] });

let folio = 0;

/** Crea una orden con el estado GUARDADO que se le pida (simula el corpus migrado de Access). */
async function crearOrden(opciones: {
  idModelo: number;
  estado: 'capturada' | 'completa' | 'cancelada';
  piezas?: number;
  fechaCompletada?: Date | null;
  creadoEn?: Date;
}): Promise<number> {
  folio += 1;
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(folio),
      idEmpresa: empresa.id,
      idModelo: opciones.idModelo,
      idCliente: clienteNegocio.id,
      estado: opciones.estado,
      fechaCompletada: opciones.fechaCompletada ?? null,
      ...(opciones.creadoEn === undefined ? {} : { creadoEn: opciones.creadoEn }),
      ...(opciones.piezas === undefined
        ? {}
        : {
            lineas: {
              create: [
                {
                  idColor: colorRojo.id,
                  tallas: { create: [{ idTalla: tallaCH.id, cantidad: opciones.piezas }] },
                },
              ],
            },
          }),
    },
  });
  return orden.id;
}

/** Corta la orden (etapa VIVA) → queda "en producción" y la puesta al día no la degrada. */
async function cortar(idOrden: number): Promise<void> {
  folio += 1;
  await cliente.etapaMovimiento.create({
    data: {
      folio: BigInt(folio),
      idEmpresa: empresa.id,
      idOrden,
      tipo: 'corte',
      fecha: new Date('2026-07-01T00:00:00.000Z'),
    },
  });
}

/** Lee el estado guardado de una orden. */
async function estadoDe(id: number): Promise<string> {
  const o = await cliente.orden.findUniqueOrThrow({ where: { id }, select: { estado: true } });
  return o.estado;
}

/**
 * Corre la PUESTA AL DÍA del histórico igual que el camino que se despliega: el motor de dominio
 * dentro de la transacción del llamador (A2), que es exactamente como lo invoca
 * `migracion/realinear-estado-ordenes.ts` en cada lote. Se le pasan TODAS las órdenes del corpus
 * (el motor ya excluye las `cancelada` por dentro; aquí el corpus cabe de sobra en un lote).
 */
async function ponerAlDiaElHistorico(): Promise<void> {
  const todas = await cliente.orden.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  await cliente.$transaction((tx) =>
    realinearEstadoOrdenes(
      tx,
      todas.map((o) => o.id),
    ),
  );
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  folio = 0;
  empresa = await crearEmpresaPrueba(cliente);
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });

  modeloOk = await cliente.modelo.create({ data: { codigo: 'OK-1', llevaArte: false } });
  const avio = await cliente.avio.create({ data: { clave: 'HIL-1', descripcion: 'Hilo' } });
  await cliente.modeloAvio.create({
    data: { idModelo: modeloOk.id, idAvio: avio.id, consumoPorPrenda: 1, paraProduccion: true },
  });

  // `llevaArte` NO se pasa: nace `true` (el default que pidió Daniel), y el BOM no tiene arte.
  modeloSinArte = await cliente.modelo.create({ data: { codigo: 'ARTE-1' } });
  await cliente.modeloAvio.create({
    data: {
      idModelo: modeloSinArte.id,
      idAvio: avio.id,
      consumoPorPrenda: 1,
      paraProduccion: true,
    },
  });
});

describe('consultarIncompletas — proyección real (F2-E4 + estado automático)', () => {
  it('lista las `capturada` con su TOTAL DE PIEZAS real (una incompleta SÍ puede tener matriz)', async () => {
    await crearOrden({ idModelo: modeloSinArte.id, estado: 'capturada', piezas: 120 });
    await crearOrden({ idModelo: modeloOk.id, estado: 'completa', piezas: 50 });
    await crearOrden({ idModelo: modeloOk.id, estado: 'cancelada', piezas: 7 });

    const pagina = await consultarIncompletas(sesion(), {}, bd());

    expect(pagina.total).toBe(1);
    // El bug que esto fija: antes se proyectaba 0 porque "capturada" implicaba "sin matriz".
    expect(pagina.datos[0]?.totalPiezas).toBe(120);
  });

  it('una incompleta SIN matriz sigue saliendo con 0 piezas', async () => {
    await crearOrden({ idModelo: modeloOk.id, estado: 'capturada' });

    const pagina = await consultarIncompletas(sesion(), {}, bd());

    expect(pagina.total).toBe(1);
    expect(pagina.datos[0]?.totalPiezas).toBe(0);
  });

  it('deriva el semáforo por antigüedad (>7 días = urgente)', async () => {
    await crearOrden({
      idModelo: modeloSinArte.id,
      estado: 'capturada',
      piezas: 10,
      creadoEn: new Date('2026-07-01T00:00:00.000Z'),
    });

    const pagina = await consultarIncompletas(
      sesion(),
      {},
      bd(),
      new Date('2026-07-15T00:00:00.000Z'),
    );

    expect(pagina.datos[0]?.diasAntiguedad).toBe(14);
    expect(pagina.datos[0]?.semaforo).toBe('urgente');
  });
});

describe('puesta al día del histórico (realineado post-carga) → el backlog se vuelve VISIBLE', () => {
  it('degrada las históricas que ya no cumplen y las muestra en "Órdenes incompletas"', async () => {
    // El corpus migrado: todas venían guardadas como `completa` con su fecha sellada.
    const sello = new Date('2020-05-05T00:00:00.000Z');
    const sinArte = await crearOrden({
      idModelo: modeloSinArte.id,
      estado: 'completa',
      piezas: 300,
      fechaCompletada: sello,
    });
    const cumple = await crearOrden({
      idModelo: modeloOk.id,
      estado: 'completa',
      piezas: 80,
      fechaCompletada: sello,
    });
    const sinMatriz = await crearOrden({
      idModelo: modeloOk.id,
      estado: 'completa',
      fechaCompletada: sello,
    });
    const enProduccion = await crearOrden({
      idModelo: modeloSinArte.id,
      estado: 'completa',
      piezas: 500,
      fechaCompletada: sello,
    });
    await cortar(enProduccion);
    const cancelada = await crearOrden({
      idModelo: modeloSinArte.id,
      estado: 'cancelada',
      piezas: 10,
    });

    // Antes de la puesta al día, "Órdenes incompletas" está VACÍA: el backlog es invisible.
    expect((await consultarIncompletas(sesion(), {}, bd())).total).toBe(0);

    await ponerAlDiaElHistorico();

    // Degrada: la que lleva arte sin capturar y la que no tiene matriz.
    expect(await estadoDe(sinArte)).toBe('capturada');
    expect(await estadoDe(sinMatriz)).toBe('capturada');
    // NO toca: la que cumple, la que ya está en producción (corte vivo) ni la cancelada.
    expect(await estadoDe(cumple)).toBe('completa');
    expect(await estadoDe(enProduccion)).toBe('completa');
    expect(await estadoDe(cancelada)).toBe('cancelada');

    // El sello histórico NUNCA se borra (aunque la orden vuelva a estar incompleta).
    const degradada = await cliente.orden.findUniqueOrThrow({
      where: { id: sinArte },
      select: { fechaCompletada: true },
    });
    expect(degradada.fechaCompletada).toEqual(sello);

    // Y AHÍ está el entregable: el backlog aparece en la pantalla donde se trabaja.
    const pagina = await consultarIncompletas(sesion(), {}, bd());
    expect(pagina.total).toBe(2);
    const porId = new Map(pagina.datos.map((d) => [d.id, d]));
    expect(porId.get(sinArte)?.totalPiezas).toBe(300);
    expect(porId.get(sinMatriz)?.totalPiezas).toBe(0);
  });

  it('deja bitácora POR ORDEN (A7) atribuida al sistema, y es idempotente', async () => {
    const sinArte = await crearOrden({
      idModelo: modeloSinArte.id,
      estado: 'completa',
      piezas: 20,
    });

    await ponerAlDiaElHistorico();

    const renglones = await cliente.bitacora.findMany({
      where: { entidad: 'Orden', idEntidad: String(sinArte) },
    });
    expect(renglones).toHaveLength(1);
    expect(renglones[0]?.idUsuario).toBeNull(); // proceso de sistema, no una persona
    expect(renglones[0]?.datos).toMatchObject({
      estado: 'capturada',
      motivo: 'realineado-post-carga',
    });

    const pantallaTrasLaPrimera = await consultarIncompletas(sesion(), {}, bd());
    expect(pantallaTrasLaPrimera.total).toBe(1);

    // Re-correrla no encuentra nada que escribir: ni degrada de nuevo, ni duplica bitácora, ni
    // mueve la pantalla.
    await ponerAlDiaElHistorico();
    expect(
      await cliente.bitacora.count({ where: { entidad: 'Orden', idEntidad: String(sinArte) } }),
    ).toBe(1);
    expect((await consultarIncompletas(sesion(), {}, bd())).total).toBe(1);
  });
});
