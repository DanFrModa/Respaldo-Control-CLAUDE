import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Avio, Color, Empresa, PrismaClient, Talla, Tela } from '../../datos/index.js';
import { enTransaccion } from '../../comun/transaccion.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrarRecetaDeOrden } from '../../pruebas/receta.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { crearOrdenMigrada } from './migracion.js';
import { centroComandoOrdenes } from './centro-comando.js';
import { frenteAlGrupoDeOrdenes } from './hermanas-de-la-op.js';
import {
  abrirReceta,
  agregarRenglonReceta,
  copiarRecetaDelModelo,
  liberarReceta,
  marcarRecetaRevisada,
  obtenerRecetaOrden,
  quitarRenglonReceta,
} from './receta-orden.js';

/**
 * Integración de **EL AVISO DE LA OP QUE SE DESVÍA DEL GRUPO** (fila 0.068 (a)) contra Postgres.
 *
 * El embudo puro (la regla de quién se desvía) ya está cubierto sin base en
 * `hermanas-de-la-op.test.ts`. Aquí se prueba **lo único que la base puede contestar**:
 *  • que «hermana» se resuelva por el **LINAJE** (`idModeloDesarrollo ?? idModelo`) y no por el id
 *    del modelo pelado — o sea, que los hijos por color de V1-E9a se reconozcan entre ellos;
 *  • que una orden **CANCELADA** ni cuente ni reciba aviso;
 *  • que una orden de **OTRA EMPRESA** no se cuele (A9);
 *  • que el aviso viaje en las DOS superficies (la receta de la OP y el Centro de Órdenes) y que
 *    salga de la MISMA comparación;
 *  • que el histórico **sin receta congelada** no dispare un aviso falso.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let idCliente: number;
let colorRojo: Color;
let tallaCH: Talla;
let telaJersey: Tela;
let avioBoton: Avio;
let avioCierre: Avio;
/** El modelo de DESARROLLO del que cuelgan los hijos por color (V1-E9a). */
let idDesarrollo: number;
/** Dos hijos de producción del mismo desarrollo: son hermanos. */
let idHijoRojo: number;
let idHijoCafe: number;

const PERM: ClavePermiso[] = ['ordenes.ver', 'desarrollo.ver', 'desarrollo.administrar'];

const bd = () => ({ cliente });

function sesion(permisos: ClavePermiso[] = PERM, idEmpresaActiva = empresa.id): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva, permisos });
}

/** Crea una orden de 10 piezas de un modelo dado y le COPIA la receta (como el alta real). */
async function crearOrden(
  folio: bigint,
  idModelo: number,
  idEmpresaOrden = empresa.id,
): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio,
      idEmpresa: idEmpresaOrden,
      idModelo,
      idCliente,
      lineas: {
        create: [
          { idColor: colorRojo.id, tallas: { create: [{ idTalla: tallaCH.id, cantidad: 10 }] } },
        ],
      },
    },
  });
  await enTransaccion(
    (tx) =>
      copiarRecetaDelModelo(tx, sesion(), {
        id: orden.id,
        idEmpresa: idEmpresaOrden,
        idModelo,
      }),
    bd(),
  );
  return orden.id;
}

/** Una orden SIN receta congelada — como todo lo que migró del Access. */
async function crearOrdenSinReceta(folio: bigint, idModelo: number): Promise<number> {
  const orden = await cliente.orden.create({
    data: { folio, idEmpresa: empresa.id, idModelo, idCliente },
  });
  return orden.id;
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Marilyn Fitness');
  idCliente = (await cliente.cliente.create({ data: { nombre: 'C&A' } })).id;
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  telaJersey = await cliente.tela.create({ data: { nombre: 'Jersey', precioSugerido: 50 } });
  avioBoton = await cliente.avio.create({
    data: { clave: 'BOT-01', descripcion: 'Botón', unidad: 'pza', precioReferencia: 2 },
  });
  avioCierre = await cliente.avio.create({
    data: { clave: 'CIE-02', descripcion: 'Cierre café', unidad: 'pza', precioReferencia: 9 },
  });

  // El PADRE de desarrollo, con la receta compartida (V1-E9b: los hijos NO la copian, la comparten).
  const desarrollo = await cliente.modelo.create({
    data: {
      codigo: 'CYA-26-71-001',
      descripcion: 'Sudadera',
      llevaArte: false,
      origen: 'desarrollo',
    },
  });
  idDesarrollo = desarrollo.id;
  await cliente.modeloTela.create({
    data: { idModelo: idDesarrollo, idTela: telaJersey.id, consumoPorPrenda: 1.5 },
  });
  await cliente.modeloAvio.create({
    data: { idModelo: idDesarrollo, idAvio: avioBoton.id, consumoPorPrenda: 2 },
  });

  // Los dos hijos POR COLOR (V1-E9a): distinto `idModelo`, MISMO linaje.
  idHijoRojo = (
    await cliente.modelo.create({
      data: {
        codigo: '62100',
        descripcion: 'Sudadera rojo',
        llevaArte: false,
        origen: 'produccion',
        idModeloDesarrollo: idDesarrollo,
        numeroProduccion: 62100,
      },
    })
  ).id;
  idHijoCafe = (
    await cliente.modelo.create({
      data: {
        codigo: '62101',
        descripcion: 'Sudadera café',
        llevaArte: false,
        origen: 'produccion',
        idModeloDesarrollo: idDesarrollo,
        numeroProduccion: 62101,
      },
    })
  ).id;
});

describe('quién es hermana — el LINAJE, no el id del modelo', () => {
  it('⭐ dos OP de hijos DISTINTOS del mismo desarrollo se reconocen como hermanas', async () => {
    const opRoja = await crearOrden(5001n, idHijoRojo);
    const opCafe = await crearOrden(5002n, idHijoCafe);

    const r = await frenteAlGrupoDeOrdenes(cliente, [opRoja, opCafe], empresa.id);
    expect(r.get(opRoja)?.hermanas).toBe(1);
    expect(r.get(opRoja)?.foliosHermanas).toEqual([5002]);
    expect(r.get(opCafe)?.foliosHermanas).toEqual([5001]);
    // Nacieron de la MISMA receta compartida ⇒ van iguales y NADIE recibe aviso.
    expect(r.get(opRoja)?.aviso).toBeNull();
    expect(r.get(opCafe)?.aviso).toBeNull();
  });

  it('🔴 CONTROL NEGATIVO: dos OP de modelos SIN parentesco no son hermanas', async () => {
    const ajeno = await cliente.modelo.create({
      data: { codigo: '70000', descripcion: 'Playera', llevaArte: false, origen: 'produccion' },
    });
    await cliente.modeloTela.create({
      data: { idModelo: ajeno.id, idTela: telaJersey.id, consumoPorPrenda: 99 },
    });
    const opHija = await crearOrden(5001n, idHijoRojo);
    const opAjena = await crearOrden(5009n, ajeno.id);

    const r = await frenteAlGrupoDeOrdenes(cliente, [opHija, opAjena], empresa.id);
    expect(r.get(opHija)?.hermanas).toBe(0);
    expect(r.get(opAjena)?.hermanas).toBe(0);
    // Y el consumo 99 de la ajena NO mancha a la hija (99 ≠ 1.5, pero no son del mismo grupo).
    expect(r.get(opHija)?.aviso).toBeNull();
    expect(r.get(opAjena)?.aviso).toBeNull();
  });

  it('el histórico (una OP cuyo modelo ES la raíz) es hermana de los hijos de ese mismo modelo', async () => {
    // Dos OP del MISMO modelo migrado: linaje = el propio modelo, así que son hermanas entre ellas.
    const viejo = await cliente.modelo.create({
      data: { codigo: '55555', descripcion: 'Migrado', llevaArte: false, origen: 'produccion' },
    });
    await cliente.modeloTela.create({
      data: { idModelo: viejo.id, idTela: telaJersey.id, consumoPorPrenda: 1 },
    });
    const a = await crearOrden(6001n, viejo.id);
    const b = await crearOrden(6002n, viejo.id);
    const r = await frenteAlGrupoDeOrdenes(cliente, [a, b], empresa.id);
    expect(r.get(a)?.hermanas).toBe(1);
    expect(r.get(b)?.hermanas).toBe(1);
  });
});

describe('el caso de Daniel — el cierre que sólo lleva la café', () => {
  it('⭐ avisa SÓLO a la que se desvía, nombrando el avío, en las DOS superficies', async () => {
    const opRoja = await crearOrden(5001n, idHijoRojo);
    const opAzul = await crearOrden(5002n, idHijoRojo);
    const opCafe = await crearOrden(5003n, idHijoCafe);

    // «No hubo cierre de ese tono y se compró otro tipo de cierre sólo para la café.»
    await agregarRenglonReceta(
      sesion(),
      opCafe,
      { tipo: 'avio', idAvio: avioCierre.id, consumoPorPrenda: 1 },
      bd(),
    );

    // ── En LA ORDEN (la receta de la OP) ────────────────────────────────────────────────
    const receta = await obtenerRecetaOrden(sesion(), opCafe, bd());
    expect(receta.frenteAlGrupo.hermanas).toBe(2);
    expect(receta.frenteAlGrupo.aviso).toContain('no va igual que sus 2 hermanas');
    expect(receta.frenteAlGrupo.aviso).toContain('CIE-02');
    expect(receta.frenteAlGrupo.diferencias).toHaveLength(1);
    expect(receta.frenteAlGrupo.diferencias[0]).toMatchObject({ tipo: 'avio', que: 'solo-esta' });
    expect(receta.frenteAlGrupo.diferencias[0]?.detalle).toContain('OP 5001, 5002 no lo llevan');

    // 🔴 CONTROL NEGATIVO: las otras dos siguen limpias.
    for (const id of [opRoja, opAzul]) {
      const suya = await obtenerRecetaOrden(sesion(), id, bd());
      expect(suya.frenteAlGrupo.aviso).toBeNull();
      expect(suya.frenteAlGrupo.diferencias).toEqual([]);
      expect(suya.frenteAlGrupo.hermanas).toBe(2);
    }

    // ── En LA FAMILIA (el Centro de Órdenes) — MISMO texto, MISMA comparación ───────────
    const pagina = await centroComandoOrdenes(sesion(), {}, bd());
    const porId = new Map(pagina.datos.map((f) => [f.id, f.frenteAlGrupo]));
    expect(porId.get(opCafe)?.aviso).toBe(receta.frenteAlGrupo.aviso);
    expect(porId.get(opRoja)?.aviso).toBeNull();
    expect(porId.get(opAzul)?.aviso).toBeNull();
  });

  it('⭐ la jareta: quitar un renglón (lápida) también desvía a la OP, y lo dice', async () => {
    const opRoja = await crearOrden(5001n, idHijoRojo);
    const opAzul = await crearOrden(5002n, idHijoRojo);
    const opCafe = await crearOrden(5003n, idHijoCafe);

    const receta = await obtenerRecetaOrden(sesion(), opCafe, bd());
    const boton = receta.avios.find((a) => a.clave === 'BOT-01');
    expect(boton).toBeDefined();
    if (boton === undefined) return;
    await quitarRenglonReceta(sesion(), opCafe, 'avio', boton.id, {}, bd());

    const despues = await obtenerRecetaOrden(sesion(), opCafe, bd());
    expect(despues.frenteAlGrupo.diferencias).toHaveLength(1);
    expect(despues.frenteAlGrupo.diferencias[0]).toMatchObject({
      tipo: 'avio',
      que: 'no-la-lleva',
    });
    expect(despues.frenteAlGrupo.diferencias[0]?.detalle).toContain('esta OP no lo lleva');

    for (const id of [opRoja, opAzul]) {
      expect((await obtenerRecetaOrden(sesion(), id, bd())).frenteAlGrupo.aviso).toBeNull();
    }
  });

  it('🔴 el aviso NO bloquea: agregar el avío distinto se guarda igual, sin excepción', async () => {
    await crearOrden(5001n, idHijoRojo);
    const opCafe = await crearOrden(5003n, idHijoCafe);
    // Si esto lanzara, la mitad «informativo, no guarda» estaría rota.
    await expect(
      agregarRenglonReceta(
        sesion(),
        opCafe,
        { tipo: 'avio', idAvio: avioCierre.id, consumoPorPrenda: 1 },
        bd(),
      ),
    ).resolves.toBeDefined();
    const receta = await obtenerRecetaOrden(sesion(), opCafe, bd());
    expect(receta.avios.some((a) => a.clave === 'CIE-02')).toBe(true);
    // Y la receta sigue siendo comprable exactamente igual que antes del aviso.
    expect(receta.frenteAlGrupo.aviso).not.toBeNull();
  });
});

describe('🔴🔴 el histórico migrado NO vota — contra el ETL de verdad', () => {
  /**
   * ⭐ **Esta prueba usa el MISMO camino del ETL** (`crearOrdenMigrada`, el que llama
   * `migracion/loaders/ordenes.ts`), no un fixture que imite su firma. Es lo único que puede
   * demostrar que la marca que la comparación mira —`liberadoEn` sellado con `liberadoPorId` en
   * NULL— es la que el ETL escribe de verdad.
   */
  async function migrada(folio: bigint, idModelo: number): Promise<number> {
    const creada = await crearOrdenMigrada(
      sesion(),
      {
        folio,
        idEmpresa: empresa.id,
        idModelo,
        idCliente,
        idPedidoLinea: null,
        estado: 'completa',
        celdas: [{ idColor: colorRojo.id, idTalla: tallaCH.id, cantidad: 10 }],
      },
      bd(),
    );
    return creada.idOrden;
  }

  it('⭐ la receta que escribe el ETL lleva la marca (firmada, y por NADIE con nombre)', async () => {
    const idOrden = await migrada(7001n, idHijoRojo);
    const renglones = await cliente.ordenTela.findMany({
      where: { idOrden },
      select: { liberadoEn: true, liberadoPorId: true },
    });
    // Si esto fallara, la exclusión de abajo estaría mirando una marca que no existe.
    expect(renglones.length).toBeGreaterThan(0);
    for (const r of renglones) {
      expect(r.liberadoEn).not.toBeNull();
      expect(r.liberadoPorId).toBeNull();
    }
  });

  it('⭐ tres OP migradas no señalan a la nueva — Y POR ESO el grupo se queda mudo (el coste)', async () => {
    /*
     * ⚠️ **Esta prueba fija las DOS caras de la decisión, no sólo la buena.** La buena: el histórico
     * deja de invertir el aviso. La que cuesta: **al apartarlo, la familia se queda sin grupo y no
     * habla** — y el escenario de aquí abajo es, en código, EL MISMO que el del cierre café sobre
     * una familia migrada. Se acepta porque el silencio es preferible a señalar a la OP correcta, y
     * porque **no es permanente**: en cuanto una persona firme la receta de una hermana, ésa vuelve
     * al grupo y el aviso empieza a hablar (lo fija la prueba de abajo).
     */
    await migrada(7001n, idHijoRojo);
    await migrada(7002n, idHijoRojo);
    await migrada(7003n, idHijoCafe);
    // La OP nueva nace por el camino normal y le agregan el avío que el modelo ganó después.
    const nueva = await crearOrden(7004n, idHijoCafe);
    await agregarRenglonReceta(
      sesion(),
      nueva,
      { tipo: 'avio', idAvio: avioCierre.id, consumoPorPrenda: 1 },
      bd(),
    );

    const receta = await obtenerRecetaOrden(sesion(), nueva, bd());
    expect(receta.frenteAlGrupo.aviso).toBeNull();
    expect(receta.frenteAlGrupo.hermanas).toBe(0);
    expect(receta.frenteAlGrupo.fueraDeLaComparacion).toBe(3);
    expect(receta.frenteAlGrupo.notaFueraDeLaComparacion).toContain('3 OP del modelo quedaron');
  });

  it('⭐⭐ LA MITIGACIÓN: firmar la receta devuelve la orden al grupo y el aviso vuelve a hablar', async () => {
    /*
     * Es lo que hace tolerable el recorte de arriba: el silencio dura hasta que la familia se
     * trabaja en v2. Aquí una OP migrada la firma UNA PERSONA (`liberarReceta` pone su id en
     * `liberadoPorId`) y, con eso, vuelve a votar: la OP nueva que difiere ya recibe su aviso.
     */
    const migradaA = await migrada(7001n, idHijoRojo);
    const nueva = await crearOrden(7004n, idHijoCafe);
    await agregarRenglonReceta(
      sesion(),
      nueva,
      { tipo: 'avio', idAvio: avioCierre.id, consumoPorPrenda: 1 },
      bd(),
    );

    // Antes de firmar: la migrada no vota, la nueva se queda sin grupo y NO habla.
    const antes = await obtenerRecetaOrden(sesion(), nueva, bd());
    expect(antes.frenteAlGrupo.hermanas).toBe(0);
    expect(antes.frenteAlGrupo.aviso).toBeNull();
    expect(antes.frenteAlGrupo.notaFueraDeLaComparacion).not.toBeNull();

    // Una PERSONA firma la receta de la migrada (revisar + liberar, el camino real).
    await marcarRecetaRevisada(sesion(), migradaA, bd());
    const suya = await obtenerRecetaOrden(sesion(), migradaA, bd());
    await liberarReceta(
      sesion(),
      migradaA,
      {
        renglones: [
          ...suya.telas
            .filter((t) => !t.excluido)
            .map((t) => ({ tipo: 'tela' as const, id: t.id })),
          ...suya.avios
            .filter((a) => !a.excluido)
            .map((a) => ({ tipo: 'avio' as const, id: a.id })),
        ],
      },
      bd(),
    );

    // Después: la migrada volvió al grupo y el aviso habla.
    const despues = await obtenerRecetaOrden(sesion(), nueva, bd());
    expect(despues.frenteAlGrupo.hermanas).toBe(1);
    expect(despues.frenteAlGrupo.aviso).not.toBeNull();
    expect(despues.frenteAlGrupo.diferencias[0]).toMatchObject({ tipo: 'avio', que: 'solo-esta' });
  });

  it('⭐⭐ LA JARETA sobre una OP MIGRADA la devuelve al grupo (quitar es decidir)', async () => {
    /*
     * 🔴 El cuadrante que faltaba, y era peor que el del cierre café: `quitarRenglonReceta` **no
     * revoca la firma a propósito**, así que los renglones vivos de una OP migrada seguían siendo
     * todos del backfill y **la propia OP quedaba fuera de la comparación** — ni siquiera se
     * comparaba. La lápida `ajustado` es la evidencia de que una persona decidió.
     */
    const conJareta = await migrada(7001n, idHijoRojo);
    const otra = await migrada(7002n, idHijoCafe);
    // La otra la firma una persona, para que haya con quién comparar.
    await marcarRecetaRevisada(sesion(), otra, bd());
    const suya = await obtenerRecetaOrden(sesion(), otra, bd());
    await liberarReceta(
      sesion(),
      otra,
      {
        renglones: [
          ...suya.telas
            .filter((t) => !t.excluido)
            .map((t) => ({ tipo: 'tela' as const, id: t.id })),
          ...suya.avios
            .filter((a) => !a.excluido)
            .map((a) => ({ tipo: 'avio' as const, id: a.id })),
        ],
      },
      bd(),
    );

    /*
     * 🔴 **CONTEXTO, NO PRUEBA — y estaba en ROJO.** Esta línea decía `toBe(0)` para «demostrar»
     * que `conJareta` estaba apartada, y son DOS errores en uno:
     *  1. el valor real es **1** (medido): `otra` sí es comparable —la firmó una persona—, y
     *  2. aunque acertara, **no demostraría nada**: `hermanas` excluye a la propia orden
     *     (`hermanas-de-la-op.ts`: `comparables.filter((o) => o.idOrden !== orden.idOrden)`), así
     *     que **la membresía de una orden NO puede mover su propio conteo**. Vale 1 esté dentro o
     *     fuera.
     *
     * En este montaje **ninguna cantidad del estado «antes» discrimina**: `conJareta` y `otra`
     * tienen la MISMA receta, así que entrar al grupo tampoco produciría diferencias. Quien
     * demuestra la conducta es el `despues` de abajo. Se deja el valor como contexto, rotulado,
     * para que nadie lo vuelva a leer como una comprobación.
     */
    const antes = await frenteAlGrupoDeOrdenes(cliente, [conJareta], empresa.id);
    expect(antes.get(conJareta)?.hermanas).toBe(1);

    // Se le quita el botón (la jareta): queda lápida `ajustado`, SIN tocar su firma.
    const receta = await obtenerRecetaOrden(sesion(), conJareta, bd());
    const boton = receta.avios.find((a) => a.clave === 'BOT-01');
    expect(boton).toBeDefined();
    if (boton === undefined) return;
    await quitarRenglonReceta(sesion(), conJareta, 'avio', boton.id, {}, bd());

    // La firma del renglón excluido SIGUE siendo la del backfill (por eso hacía falta la lápida).
    const lapida = await cliente.ordenAvio.findFirstOrThrow({
      where: { idOrden: conJareta, excluido: true },
      select: { liberadoEn: true, liberadoPorId: true, estado: true },
    });
    expect(lapida.liberadoEn).not.toBeNull();
    expect(lapida.liberadoPorId).toBeNull();
    expect(lapida.estado).toBe('ajustado');

    /*
     * Y aun así la OP volvió al grupo, y el aviso habla.
     *
     * ⚠️ **El peso lo lleva `diferencias`, no `hermanas`** (que también vale 1 aquí, pero valía 1
     * antes: no distingue). Sólo una orden COMPARADA produce diferencias, así que ésta es la
     * aserción que separa los dos mundos.
     */
    const despues = await obtenerRecetaOrden(sesion(), conJareta, bd());
    expect(despues.frenteAlGrupo.diferencias[0]).toMatchObject({
      que: 'no-la-lleva',
      tipo: 'avio',
    });
    expect(despues.frenteAlGrupo.aviso).not.toBeNull();
  });

  it('🔴 «marcar todo revisado» y «reabrir» NO devuelven la orden al grupo', async () => {
    /*
     * Los DOS cuadrantes donde la frase de la mitigación era falsa: las dos cosas son «trabajar la
     * receta» y ninguna toca la firma —revisar sólo mueve el `estado`; reabrir escribe en la ORDEN
     * y *«sólo marca: NO desfirma»*—.
     *
     * ⚠️⚠️ **CÓMO SE MONTA PARA QUE MIDA ALGO — y las DOS cantidades que NO sirven.** Medido con
     * sonda sobre `compararConHermanas`, comparando el mundo «`a` apartada» contra «`a` dentro»:
     *
     * | Montaje | apartada | dentro | ¿distingue? |
     * |---|---|---|---|
     * | `a` + `b`, **las dos migradas** (la 1ª versión) | `{fuera:1, difs:0, herm:0}` | `{fuera:1, difs:0, herm:0}` | ❌ **en NINGUNA** |
     * | `a` migrada + una **TRABAJADA** | `{fuera:0, difs:0, herm:1, aviso:no}` | `{fuera:0, difs:1, herm:1, aviso:sí}` | ✅ sólo `aviso`/`difs` |
     *
     * Dos lecciones, las dos medidas y ninguna evidente:
     *  1. con dos órdenes migradas **las tres cantidades coinciden exacto** —`a` no tiene hermanas
     *     de ninguna manera, y `fueraDeLaComparacion` da 1 tanto por `fuera` como por `fuera − 1`—,
     *     así que la 1ª versión **pasaba por construcción**: si mañana revisar o reabrir devolvieran
     *     la orden, habría seguido verde;
     *  2. 🔴 y con la tercera OP **`hermanas` TAMPOCO distingue**: vale 1 en los dos mundos, porque
     *     cuenta las comparables del grupo y la trabajada está ahí en ambos casos. Aseverar sobre
     *     `hermanas` habría sido cambiar una prueba vacía por otra.
     *
     * ⇒ Se asevera sobre **`aviso`/`diferencias`**, y la `trabajada` lleva un avío que `a` no tiene
     * para que ENTRAR tenga una consecuencia visible. El test de abajo cierra la pinza: el mismo
     * montaje con un acto de los que SÍ devuelven da el valor contrario.
     */
    const a = await migrada(7001n, idHijoRojo);
    // Una hermana YA TRABAJADA (nace por el camino normal) y que lleva algo que `a` no lleva: sin
    // esa diferencia, entrar al grupo no cambiaría nada observable y la prueba volvería a ser vacía.
    const trabajada = await crearOrden(7002n, idHijoCafe);
    await agregarRenglonReceta(
      sesion(),
      trabajada,
      { tipo: 'avio', idAvio: avioCierre.id, consumoPorPrenda: 1 },
      bd(),
    );

    const antes = await frenteAlGrupoDeOrdenes(cliente, [a], empresa.id);
    expect(antes.get(a)?.aviso).toBeNull();
    expect(antes.get(a)?.diferencias).toEqual([]);

    await marcarRecetaRevisada(sesion(), a, bd());
    const trasRevisar = await frenteAlGrupoDeOrdenes(cliente, [a], empresa.id);
    expect(trasRevisar.get(a)?.aviso).toBeNull();
    expect(trasRevisar.get(a)?.diferencias).toEqual([]);

    await abrirReceta(sesion(), a, { motivo: 'hay que corregir el consumo' }, bd());
    const trasAbrir = await frenteAlGrupoDeOrdenes(cliente, [a], empresa.id);
    expect(trasAbrir.get(a)?.aviso).toBeNull();
    expect(trasAbrir.get(a)?.diferencias).toEqual([]);
  });

  it('🔴 CONTROL DEL CONTROL: en ESA misma familia, un acto que SÍ devuelve da AVISO', async () => {
    /*
     * Es la mitad que demuestra que la prueba de arriba distingue de verdad: MISMO montaje, y un
     * acto de los que sí devuelven (quitar un renglón — la jareta). Si el `aviso` fuera null aquí,
     * la aserción de arriba no estaría midiendo nada.
     *
     * ⚠️ Se asevera `aviso`/`diferencias` **a propósito, y no `hermanas`**: esa cantidad excluye a
     * la propia orden, así que vale lo mismo entre en el grupo o no.
     */
    const a = await migrada(7001n, idHijoRojo);
    const trabajada = await crearOrden(7002n, idHijoCafe);
    await agregarRenglonReceta(
      sesion(),
      trabajada,
      { tipo: 'avio', idAvio: avioCierre.id, consumoPorPrenda: 1 },
      bd(),
    );

    const receta = await obtenerRecetaOrden(sesion(), a, bd());
    const boton = receta.avios.find((av) => av.clave === 'BOT-01');
    expect(boton).toBeDefined();
    if (boton === undefined) return;
    await quitarRenglonReceta(sesion(), a, 'avio', boton.id, {}, bd());

    const despues = await frenteAlGrupoDeOrdenes(cliente, [a], empresa.id);
    // 🔴 EL VALOR CONTRARIO en el MISMO montaje: si esto no saliera, la prueba de arriba no estaría
    // midiendo nada (era exactamente su defecto).
    expect(despues.get(a)?.aviso).not.toBeNull();
    expect(despues.get(a)?.diferencias.length).toBeGreaterThan(0);
  });

  it('🔴 CONTROL: dos OP NUEVAS del mismo linaje sí se comparan entre ellas', async () => {
    await migrada(7001n, idHijoRojo);
    const a = await crearOrden(7004n, idHijoRojo);
    const b = await crearOrden(7005n, idHijoCafe);
    await agregarRenglonReceta(
      sesion(),
      b,
      { tipo: 'avio', idAvio: avioCierre.id, consumoPorPrenda: 1 },
      bd(),
    );
    const r = await frenteAlGrupoDeOrdenes(cliente, [a, b], empresa.id);
    expect(r.get(a)?.hermanas).toBe(1);
    expect(r.get(b)?.aviso).not.toBeNull();
    // Y la migrada sigue contándose como apartada.
    expect(r.get(a)?.fueraDeLaComparacion).toBe(1);
  });
});

describe('🔴 el SEMBRADOR de fixtures no puede armar la trampa de la marca', () => {
  /**
   * ⚠️ **LA TRAMPA QUE ESTO DESARMA.** `sembrarRecetaDeOrden` es el helper estándar de ~10
   * `*.int.test.ts` y firmaba con `liberadoPorId: null` — **la marca exacta** con la que este módulo
   * reconoce «receta escrita por un backfill» y aparta la orden del grupo. Con eso, la primera
   * prueba futura que sembrara dos hermanas y esperara un aviso habría obtenido **SILENCIO**, y
   * habría parecido que el módulo está roto justo sobre la única defensa pre-CI que tiene.
   *
   * El helper simula el ALTA NORMAL, así que ahora firma como una persona. Esta prueba lo fija.
   *
   * 🔴 **Y DESTAPÓ UNA SEGUNDA TRAMPA, en el mismo helper y de la misma familia.** Esta prueba
   * siembra sobre los HIJOS POR COLOR, cuya receta vive en el modelo de DESARROLLO (V1-E9b): el
   * helper leía el BOM con el `idModelo` pelado —sin resolver el linaje, como sí lo resuelve
   * `copiarRecetaDelModelo`— y copiaba **cero renglones en silencio**. Una orden sin ni una fila
   * congelada no queda «apartada por la firma»: queda apartada por **no tener receta**, igual que el
   * histórico del Access. Los dos caminos dan el MISMO síntoma (`hermanas: 0`), y por eso el CONTROL
   * de abajo pasaba por la razón equivocada. Hoy el helper resuelve el linaje y **lanza** si no
   * sembró nada, así que los dos casos ya no se pueden confundir.
   */
  it('dos hermanas sembradas con el helper SÍ se comparan (no salen apartadas)', async () => {
    const a = await cliente.orden.create({
      data: { folio: 8001n, idEmpresa: empresa.id, idModelo: idHijoRojo, idCliente },
    });
    const b = await cliente.orden.create({
      data: { folio: 8002n, idEmpresa: empresa.id, idModelo: idHijoCafe, idCliente },
    });
    await sembrarRecetaDeOrden(cliente, a.id, idHijoRojo);
    await sembrarRecetaDeOrden(cliente, b.id, idHijoCafe);

    // 🔑 Que el helper SÍ sembró es lo que separa este mundo del CONTROL de abajo: sin esto, las
    //    dos pruebas describirían el mismo estado (dos órdenes vacías) y la pareja no mediría nada.
    expect(await cliente.ordenTela.count({ where: { idOrden: a.id } })).toBeGreaterThan(0);
    expect(await cliente.ordenAvio.count({ where: { idOrden: b.id } })).toBeGreaterThan(0);

    const r = await frenteAlGrupoDeOrdenes(cliente, [a.id, b.id], empresa.id);
    // Lo que fallaba: `hermanas: 0` y `fueraDeLaComparacion: 1` en las dos.
    // ⚠️ `hermanas` de A mide la membresía de **B** (excluye a la propia orden), así que hacen falta
    //    las dos aserciones para decir que las DOS entraron.
    expect(r.get(a.id)?.hermanas).toBe(1);
    expect(r.get(b.id)?.hermanas).toBe(1);
    expect(r.get(a.id)?.fueraDeLaComparacion).toBe(0);
  });

  it('🔴 CONTROL: pidiendo la firma de un backfill a propósito, SÍ quedan apartadas', async () => {
    // La opción existe para el test que de verdad quiera el estado «la firmó la migración».
    const a = await cliente.orden.create({
      data: { folio: 8003n, idEmpresa: empresa.id, idModelo: idHijoRojo, idCliente },
    });
    const b = await cliente.orden.create({
      data: { folio: 8004n, idEmpresa: empresa.id, idModelo: idHijoCafe, idCliente },
    });
    await sembrarRecetaDeOrden(cliente, a.id, idHijoRojo, { liberadoPorId: null });
    await sembrarRecetaDeOrden(cliente, b.id, idHijoCafe, { liberadoPorId: null });

    // 🔴 LA PATA QUE FALTABA: quedan apartadas por la FIRMA, no por estar vacías. Sin comprobar que
    //    la receta existe, este CONTROL pasaba también con dos órdenes SIN receta —que es como
    //    estaban de verdad— y su «resultado contrario» no era contrario a nada.
    const firmaA = await cliente.ordenTela.findFirstOrThrow({ where: { idOrden: a.id } });
    expect(firmaA.liberadoEn).not.toBeNull();
    expect(firmaA.liberadoPorId).toBeNull();

    const r = await frenteAlGrupoDeOrdenes(cliente, [a.id, b.id], empresa.id);
    expect(r.get(a.id)?.hermanas).toBe(0);
    expect(r.get(a.id)?.fueraDeLaComparacion).toBe(1);
  });
});

describe('el universo comparado — canceladas, empresas y recetas vacías', () => {
  it('🔴 una OP CANCELADA no cuenta como hermana y tampoco recibe aviso', async () => {
    const opRoja = await crearOrden(5001n, idHijoRojo);
    const opCafe = await crearOrden(5003n, idHijoCafe);
    await agregarRenglonReceta(
      sesion(),
      opCafe,
      { tipo: 'avio', idAvio: avioCierre.id, consumoPorPrenda: 1 },
      bd(),
    );

    // Con la café viva, la roja tiene 1 hermana y la café avisa.
    expect(
      (await frenteAlGrupoDeOrdenes(cliente, [opRoja], empresa.id)).get(opRoja)?.hermanas,
    ).toBe(1);

    await cliente.orden.update({ where: { id: opCafe }, data: { estado: 'cancelada' } });

    const r = await frenteAlGrupoDeOrdenes(cliente, [opRoja, opCafe], empresa.id);
    // La roja se queda sola: la cancelada dejó de ser hermana.
    expect(r.get(opRoja)?.hermanas).toBe(0);
    expect(r.get(opRoja)?.aviso).toBeNull();
    // Y la cancelada ni siquiera aparece: no se le inventa un grupo.
    expect(r.has(opCafe)).toBe(false);
    const receta = await obtenerRecetaOrden(sesion(), opCafe, bd());
    expect(receta.frenteAlGrupo.aviso).toBeNull();
    expect(receta.frenteAlGrupo.hermanas).toBe(0);
  });

  it('🔴 A9: una OP de OTRA empresa no es hermana aunque sea del mismo modelo', async () => {
    const opRoja = await crearOrden(5001n, idHijoRojo);
    await crearOrden(5001n, idHijoRojo, otraEmpresa.id);
    const r = await frenteAlGrupoDeOrdenes(cliente, [opRoja], empresa.id);
    expect(r.get(opRoja)?.hermanas).toBe(0);
    expect(r.get(opRoja)?.aviso).toBeNull();
  });

  it('🔴 una hermana SIN receta congelada (histórico) no dispara un aviso falso, pero se CUENTA', async () => {
    const opConReceta = await crearOrden(5001n, idHijoRojo);
    const opVieja = await crearOrdenSinReceta(5002n, idHijoCafe);

    const r = await frenteAlGrupoDeOrdenes(cliente, [opConReceta, opVieja], empresa.id);
    // La vieja no «deja de llevar» la tela y el botón: es que nunca tuvo receta.
    expect(r.get(opConReceta)?.aviso).toBeNull();
    expect(r.get(opConReceta)?.hermanas).toBe(0);
    // Pero la exclusión NO es silenciosa.
    expect(r.get(opConReceta)?.fueraDeLaComparacion).toBe(1);
    expect(r.get(opVieja)?.aviso).toBeNull();
  });
});
