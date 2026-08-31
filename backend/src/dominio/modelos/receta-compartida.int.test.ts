/**
 * ⭐⭐ V1-E9b — LA RECETA COMPARTIDA, pruebas de CONDUCTA contra Postgres efímero (§Post-F9.167).
 *
 * El guardián (`receta-compartida-guardian.test.ts`) demuestra que ningún archivo LEE la receta sin
 * conocer el resolver. Lo que ninguna prueba de código fuente puede demostrar es que el resultado
 * sea el correcto: eso es lo que hace este archivo, con **un modelo de desarrollo (el padre) y dos
 * hijos de producción vacíos**, por las cuatro puertas que importan:
 *
 *  1. **La ficha** (`leerBom`) — las tres lecturas canónicas.
 *  2. 🔴 **El precosto** (`calcularPreCosto` / `listaPrecios`) — la clase de lectura por `include`
 *     que el conteo del plan no vio. Sin el injerto sale la RECETA VACÍA *sin lanzar*, y de ese
 *     número sale el precio que se cotiza en la cara del cliente.
 *  3. 🔴 **La orden** (`copiarRecetaDelModelo`) — por aquí pasa el 100 % de las órdenes, y es donde
 *     se prueba que viajan las **MEDIDAS POR TALLA** (`ModeloAvioTalla`, R18): ninguna de las tres
 *     lecturas canónicas las trae, y sin ellas el requerido del MRP se mueve en silencio.
 *  4. **El listado** (`listarModelos`) — el resolver EN LOTE con su camino de vuelta: los DOS hijos
 *     tienen que recibir la tela del padre, no sólo el padre.
 *
 * Y en todas, la NO-REGRESIÓN: un modelo sin padre sigue leyendo su propia receta.
 *
 * Corre en CI (NUNCA Docker local, regla §7 de CLAUDE.md).
 */
// Credenciales R2 FALSAS, ANTES de importar el dominio: `listarModelos` y `listarFotosArte`
// construyen el servicio de archivos aunque aquí ningún modelo tenga fotos.
process.env.R2_ACCOUNT_ID ??= 'cuenta-fake';
process.env.R2_ACCESS_KEY_ID ??= 'llave-fake';
process.env.R2_SECRET_ACCESS_KEY ??= 'secreto-fake';
process.env.R2_BUCKET ??= 'control-v2-prueba';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { enTransaccion } from '../../comun/transaccion.js';
import type { ClavePermiso } from '../../contrato/index.js';
import type { Avio, Empresa, PrismaClient, Talla, Tela } from '../../datos/index.js';
import {
  clientePruebas,
  crearEmpresaPrueba,
  crearTipoArtePrueba,
  limpiarBaseDatos,
} from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { calcularPreCosto, listaPrecios } from '../costos/pre-costo.js';
import { copiarRecetaDelModelo } from '../produccion/receta-orden.js';

import { listarFotosArte } from './arte-modelo.js';
import { sugerirAviosFavoritos } from './avios-favoritos.js';
import { leerBom } from './bom-modelo.js';
import { obtenerMedidasAvio } from './medidas-avio-talla.js';
import { listarModelos } from './modelos.js';

let cliente: PrismaClient;
let empresa: Empresa;
let idTipoArte: number;
let telaFelpa: Tela;
let telaRib: Tela;
let avioEtiqueta: Avio;
let tallaCH: Talla;
let tallaG: Talla;
let idCliente: number;

/** El modelo de DESARROLLO: el ÚNICO que tiene receta. */
let idPadre: number;
/** Los dos modelos de PRODUCCIÓN (uno por color) que la comparten — sin receta propia. */
let idHijoRojo: number;
let idHijoAzul: number;
/** Un modelo de producción SIN padre: la no-regresión (`idModeloDesarrollo = NULL`). */
let idSuelto: number;
/** El renglón de arte del padre (para probar la pertenencia del sub-recurso). */
let idArtePadre: number;

const PERM: ClavePermiso[] = [
  'modelos.ver',
  'precostos.consultar',
  'consultas.ver-importes',
  'costos.ver',
];
const sesion = () => sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM });
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
  await cliente.configuracionEmpresa.create({
    data: { idEmpresa: empresa.id, utilidadSugerida: 50, regaliasBase: 10 },
  });
  idTipoArte = await crearTipoArtePrueba(cliente);
  idCliente = (await cliente.cliente.create({ data: { nombre: 'C&A' } })).id;
  // "Felpa" antes que "Rib" por nombre: la PRIMERA es la `telaPrincipal` del listado.
  telaFelpa = await cliente.tela.create({ data: { nombre: 'Felpa', precioSugerido: 10 } });
  telaRib = await cliente.tela.create({ data: { nombre: 'Rib', precioSugerido: 4 } });
  avioEtiqueta = await cliente.avio.create({
    data: { clave: 'ETQ-01', descripcion: 'Etiqueta', unidad: 'pza', precioReferencia: 5 },
  });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaG = await cliente.talla.create({ data: { etiqueta: 'G', orden: 2 } });

  // ── EL PADRE: modelo de DESARROLLO con LA receta ──────────────────────────────────────────
  const padre = await cliente.modelo.create({
    data: {
      codigo: 'CYA-26-71-001',
      codigoDesarrollo: 'CYA-26-71-001',
      descripcion: 'Sudadera',
      origen: 'desarrollo',
      maquilaBase: 20,
      telas: {
        create: [
          { idTela: telaFelpa.id, consumoPorPrenda: 2 },
          { idTela: telaRib.id, consumoPorPrenda: 0.5 },
        ],
      },
      avios: {
        // ⭐ `consumoPorTalla` ENCENDIDO y `consumoPorPrenda` puesto en un número absurdo (99): el
        // precosto tiene que usar el PROMEDIO de las medidas por talla (R18) y no el 99. Así, si
        // el injerto perdiera `avios.tallas`, el número cambiaría de forma inconfundible.
        create: [
          {
            idAvio: avioEtiqueta.id,
            consumoPorPrenda: 99,
            consumoPorTalla: true,
            tallas: {
              create: [
                { idTalla: tallaCH.id, consumo: 2 },
                { idTalla: tallaG.id, consumo: 4 },
              ],
            },
          },
        ],
      },
      artes: {
        create: [{ descripcion: 'Bordado pecho', idTipoArte, precio: 7, orden: 0 }],
      },
    },
    select: { id: true },
  });
  idPadre = padre.id;
  idArtePadre = (
    await cliente.modeloArte.findFirstOrThrow({
      where: { idModelo: idPadre },
      select: { id: true },
    })
  ).id;

  // ── LOS DOS HIJOS: producción, uno por color, SIN receta propia ───────────────────────────
  const hijo = async (codigo: string): Promise<number> =>
    (
      await cliente.modelo.create({
        data: {
          codigo,
          descripcion: 'Sudadera',
          origen: 'produccion',
          idModeloDesarrollo: idPadre,
          maquilaBase: 20,
        },
        select: { id: true },
      })
    ).id;
  idHijoRojo = await hijo('71001');
  idHijoAzul = await hijo('71002');

  // ── EL SUELTO: producción sin padre, con receta PROPIA y distinta ─────────────────────────
  idSuelto = (
    await cliente.modelo.create({
      data: {
        codigo: '71999',
        descripcion: 'Playera',
        origen: 'produccion',
        maquilaBase: 3,
        telas: { create: [{ idTela: telaRib.id, consumoPorPrenda: 1 }] },
      },
      select: { id: true },
    })
  ).id;
});

// ── 1. LA FICHA: las tres lecturas canónicas ──────────────────────────────────────────────────

describe('leerBom — la ficha del hijo enseña la receta del PADRE', () => {
  it('telas, avíos y artes del hijo son los del padre (no una lista vacía)', async () => {
    const bom = await leerBom(cliente, idHijoRojo, empresa.id);
    expect(bom.telas.map((t) => t.nombre)).toEqual(['Felpa', 'Rib']);
    expect(bom.avios.map((a) => a.clave)).toEqual(['ETQ-01']);
    expect(bom.artes.map((a) => a.descripcion)).toEqual(['Bordado pecho']);
  });

  it('los DOS hijos ven exactamente lo mismo (la igualdad es estructural, no vigilada)', async () => {
    const rojo = await leerBom(cliente, idHijoRojo, empresa.id);
    const azul = await leerBom(cliente, idHijoAzul, empresa.id);
    expect(azul).toEqual(rojo);
  });

  it('el padre sigue leyendo la suya, y un modelo SIN padre la suya (no-regresión)', async () => {
    expect((await leerBom(cliente, idPadre, empresa.id)).telas.map((t) => t.nombre)).toEqual([
      'Felpa',
      'Rib',
    ]);
    expect((await leerBom(cliente, idSuelto, empresa.id)).telas.map((t) => t.nombre)).toEqual([
      'Rib',
    ]);
  });

  it('el hijo NO tiene ni una fila de receta propia — la comparte, no la copia', async () => {
    // Si esto dejara de ser cierto, el sistema habría vuelto a las cuatro copias que Daniel quiso
    // evitar, y las pruebas de arriba pasarían igual sin probar nada.
    expect(await cliente.modeloTela.count({ where: { idModelo: idHijoRojo } })).toBe(0);
    expect(await cliente.modeloAvio.count({ where: { idModelo: idHijoRojo } })).toBe(0);
    expect(await cliente.modeloArte.count({ where: { idModelo: idHijoRojo } })).toBe(0);
    expect(await cliente.modeloAvioTalla.count({ where: { idModelo: idHijoRojo } })).toBe(0);
  });
});

// ── 2. 🔴 EL PRECOSTO: la lectura por `include` que el plan no vio ────────────────────────────

describe('🔴 calcularPreCosto — el precosto del hijo NO sale vacío', () => {
  /** Los números del padre, a mano: telas 2×10 + 0.5×4 = 22 · avío (2+4)/2 × 5 = 15 · arte 7. */
  const TOTAL_TELA = 22;
  const TOTAL_AVIOS = 15;
  const TOTAL_ARTE = 7;
  const MAQUILA = 20;

  it('el hijo cuesta lo mismo que el padre, renglón por renglón', async () => {
    const hijo = await calcularPreCosto(sesion(), idHijoRojo, bd());
    expect(hijo.telas.map((t) => t.tela).sort()).toEqual(['Felpa', 'Rib']);
    expect(hijo.totalTela).toBe(TOTAL_TELA);
    expect(hijo.totalArte).toBe(TOTAL_ARTE);
    expect(hijo.costoTotal).toBe(TOTAL_TELA + TOTAL_AVIOS + TOTAL_ARTE + MAQUILA);

    const padre = await calcularPreCosto(sesion(), idPadre, bd());
    expect(hijo.costoTotal).toBe(padre.costoTotal);
  });

  it('🔴 el defecto que esta etapa vino a evitar: NO es sólo maquila', async () => {
    // Ésta es la aserción de la etapa escrita al revés, a propósito. Sin el injerto el precosto
    // devolvía `costoTotal === maquila` con las tres listas vacías: no lanza, no truena, sólo
    // entrega un número más bajo — y de ahí sale el precio que se cotiza al cliente.
    const hijo = await calcularPreCosto(sesion(), idHijoRojo, bd());
    expect(hijo.telas).not.toHaveLength(0);
    expect(hijo.avios).not.toHaveLength(0);
    expect(hijo.artes).not.toHaveLength(0);
    expect(hijo.costoTotal).not.toBe(hijo.maquila);
  });

  it('⭐ las MEDIDAS POR TALLA (R18) llegan por `avios.tallas`: el avío promedia 3, no 99', async () => {
    // `ModeloAvioTalla` no la lee NINGUNA de las tres lecturas canónicas; al `include` entra
    // colgada del avío. Con `consumoPorPrenda = 99`, si el injerto perdiera `tallas` el consumo
    // saltaría de 3 a 99 y el importe de 15 a 495: imposible de confundir.
    const hijo = await calcularPreCosto(sesion(), idHijoRojo, bd());
    expect(hijo.avios[0]?.consumoPorPrenda).toBe(3);
    expect(hijo.totalAvios).toBe(TOTAL_AVIOS);
  });

  it('un modelo SIN padre precostea con LO SUYO (no-regresión)', async () => {
    const suelto = await calcularPreCosto(sesion(), idSuelto, bd());
    expect(suelto.telas.map((t) => t.tela)).toEqual(['Rib']);
    expect(suelto.costoTotal).toBe(1 * 4 + 3);
  });
});

describe('🔴 listaPrecios — el injerto EN LOTE del precosto', () => {
  it('los dos hijos salen con el costo del padre, y el suelto con el suyo', async () => {
    const lista = await listaPrecios(sesion(), {}, bd());
    const porCodigo = new Map(lista.filas.map((f) => [f.codigo, f.costo]));
    expect(porCodigo.get('71001')).toBe(64); // 22 + 15 + 7 + 20
    expect(porCodigo.get('71002')).toBe(64);
    expect(porCodigo.get('CYA-26-71-001')).toBe(64);
    expect(porCodigo.get('71999')).toBe(7); // 1 × 4 + 3 de maquila
  });
});

// ── 3. 🔴 LA ORDEN: por aquí pasa el 100 % de las órdenes ─────────────────────────────────────

describe('🔴 copiarRecetaDelModelo — la orden de un hijo nace con la receta del padre', () => {
  /** Crea una orden de 10 piezas del modelo dado y le copia la receta, como hace el alta real. */
  async function ordenConReceta(folio: bigint, idModelo: number): Promise<number> {
    const orden = await cliente.orden.create({
      data: { folio, idEmpresa: empresa.id, idModelo, idCliente },
      select: { id: true },
    });
    await enTransaccion(
      (tx) =>
        copiarRecetaDelModelo(tx, sesion(), {
          id: orden.id,
          idEmpresa: empresa.id,
          idModelo,
        }),
      bd(),
    );
    return orden.id;
  }

  it('copia telas, avíos y artes del padre', async () => {
    const idOrden = await ordenConReceta(1n, idHijoRojo);
    expect(await cliente.ordenTela.count({ where: { idOrden } })).toBe(2);
    expect(await cliente.ordenAvio.count({ where: { idOrden } })).toBe(1);
    expect(await cliente.ordenArte.count({ where: { idOrden } })).toBe(1);
  });

  it('⭐⭐ copia también las MEDIDAS POR TALLA — el gemelo silencioso (R18 → MRP)', async () => {
    // Sin el resolver aquí, la orden de un hijo nacería SIN medidas por talla **en silencio**, y
    // eso mueve el requerido del MRP. No hay error, no hay aviso: sólo se compra otra cantidad.
    const idOrden = await ordenConReceta(2n, idHijoRojo);
    const medidas = await cliente.ordenAvioTalla.findMany({
      where: { ordenAvio: { idOrden } },
      select: { idTalla: true, consumo: true },
      orderBy: { idTalla: 'asc' },
    });
    expect(medidas.map((m) => m.consumo.toNumber())).toEqual([2, 4]);
    expect(medidas.map((m) => m.idTalla)).toEqual([tallaCH.id, tallaG.id]);
  });

  it('congela el mismo PRECIO que el padre (la cascada única, §Post-F9.48)', async () => {
    const idOrden = await ordenConReceta(3n, idHijoAzul);
    const telas = await cliente.ordenTela.findMany({
      where: { idOrden },
      select: { idTela: true, precio: true },
    });
    const porTela = new Map(telas.map((t) => [t.idTela, t.precio?.toNumber() ?? null]));
    expect(porTela.get(telaFelpa.id)).toBe(10);
    expect(porTela.get(telaRib.id)).toBe(4);
  });

  it('en MODO MIGRACIÓN (`sinPrecios`) también lee la receta del padre', async () => {
    // El ETL no pasa por las lecturas canónicas: lee `modeloTela`/`modeloAvio` en crudo. Si el
    // resolver sólo viviera dentro de `leerTelasBom`, esta puerta se quedaría fuera.
    const orden = await cliente.orden.create({
      data: { folio: 4n, idEmpresa: empresa.id, idModelo: idHijoRojo, idCliente },
      select: { id: true },
    });
    const resumen = await enTransaccion(
      (tx) =>
        copiarRecetaDelModelo(
          tx,
          null,
          { id: orden.id, idEmpresa: empresa.id, idModelo: idHijoRojo },
          { sinPrecios: true },
        ),
      bd(),
    );
    expect(resumen).toEqual({ telas: 2, avios: 1, artes: 1 });
    const tela = await cliente.ordenTela.findFirstOrThrow({ where: { idOrden: orden.id } });
    expect(tela.precio).toBeNull();
  });

  it('la orden de un modelo SIN padre copia LO SUYO (no-regresión)', async () => {
    const idOrden = await ordenConReceta(5n, idSuelto);
    const telas = await cliente.ordenTela.findMany({ where: { idOrden } });
    expect(telas).toHaveLength(1);
    expect(telas[0]?.idTela).toBe(telaRib.id);
  });
});

// ── 4. EL LISTADO: el resolver EN LOTE, con su camino de vuelta ───────────────────────────────

describe('listarModelos — la tela principal EN LOTE (un padre, dos hijos)', () => {
  it('🔴 los DOS hijos reciben la tela del padre, no sólo el padre', async () => {
    const pagina = await listarModelos(sesion(), { origen: 'todos', porPagina: 50 }, bd());
    const porCodigo = new Map(pagina.datos.map((m) => [m.codigo, m.telaPrincipal]));
    // Sin el camino de vuelta, el mapa se arma por `fila.idModelo` y sólo el padre tendría tela:
    // los dos hijos saldrían en `null` SIN QUE NADA FALLE.
    expect(porCodigo.get('71001')).toBe('Felpa');
    expect(porCodigo.get('71002')).toBe('Felpa');
    expect(porCodigo.get('CYA-26-71-001')).toBe('Felpa');
    // Y el que no comparte receta conserva la suya.
    expect(porCodigo.get('71999')).toBe('Rib');
  });
});

// ── 5. Las demás lecturas de la receta ────────────────────────────────────────────────────────

describe('las demás lecturas de la receta también resuelven', () => {
  it('obtenerMedidasAvio: las medidas por talla del hijo son las del padre', async () => {
    const medidas = await obtenerMedidasAvio(sesion(), idHijoRojo, avioEtiqueta.id, bd());
    expect(medidas.tallas.map((t) => t.consumo)).toEqual([2, 4]);
    expect(medidas.consumoPorTalla).toBe(true);
  });

  it('sugerirAviosFavoritos: un favorito que la receta del PADRE ya tiene no se re-sugiere', async () => {
    await cliente.avio.update({
      where: { id: avioEtiqueta.id },
      data: { favorito: true, cantFav: 1 },
    });
    const s = await sugerirAviosFavoritos(sesion(), idHijoRojo, bd());
    expect(s.yaEnLaReceta.map((a) => a.clave)).toEqual(['ETQ-01']);
    expect(s.sugeridos).toEqual([]);
  });

  it('listarFotosArte: el arte HEREDADO se abre desde el hijo (no un 404)', async () => {
    // La ficha del hijo acaba de listar ese arte (`leerArtesModelo`); si la pertenencia se
    // comprobara contra el hijo, abrir sus fotos daría `ErrorNoEncontrado` sobre un renglón que la
    // pantalla enseña. Sin fotos la lista es vacía — lo que se prueba es que NO lanza.
    await expect(listarFotosArte(sesion(), idHijoRojo, idArtePadre, bd())).resolves.toEqual([]);
  });
});
