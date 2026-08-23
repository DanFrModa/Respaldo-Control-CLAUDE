/**
 * ⭐⭐ Integración de **LA TELA SE COMPRA POR COLOR** (V1-E3u, §Post-F9.89) contra Postgres real.
 *
 * Lo que esta batería protege, en las palabras de la decisión:
 *  • **(a) El sistema PROPONE, Compras CAPTURA, el desvío AVISA a quien autoriza** — y el reparto
 *    por color **sale de la matriz color×talla que ya existe**, no de un prorrateo inventado.
 *  • **(b) El precio sale del color, se corrige ahí, y eso ACTUALIZA EL CATÁLOGO** — con auditoría
 *    A7 que dice quién, cuándo, de cuánto a cuánto y desde dónde.
 *  • **(c) Se compra el COLOR y el almacén lo reparte** — dos OP que piden el mismo color caen en
 *    un renglón, sin dejar de guardarse repartidas por OP (§Post-F9.86).
 *  • **A9**: una orden de otra empresa no existe para esta sesión.
 *  • **Lo viejo no se rompe**: una tela sin color dicho se sigue explotando y comprando.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Proveedor,
  Talla,
  Tela,
  TelaColor,
} from '../../datos/index.js';
import type { ClavePermiso } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrarRecetaDeOrden } from '../../pruebas/receta.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  asignarColorDeTela,
  coloresDeTelaDeOrden,
  fijarPrecioDeColor,
} from './color-de-la-tela.js';
import {
  explosionarOrden,
  explosionarOrdenes,
  generarOCDesdeExplosion,
  previoCompraDesdeExplosion,
} from './mrp.js';
import { autorizarOC, obtenerOC } from './ordenes-compra.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let telaFelpa: Tela;
let colorRojo: Color;
let colorAzul: Color;
let tonoGrana: TelaColor;
let tonoMarino: TelaColor;
let proveedor: Proveedor;
let clienteNegocioId: number;
let tallaCH: Talla;
let tallaM: Talla;
let idOrden: number;

const PERM: ClavePermiso[] = ['compras.ver', 'compras.administrar'];
const sesion = (permisos: ClavePermiso[] = PERM): SesionUsuario =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

/**
 * Orden de **40 piezas repartidas en DOS colores**: Rojo 30 (CH 10 + M 20) y Azul 10 (CH 5 + M 5).
 * Con la felpa a 1.5 m/prenda, el reparto por color CORRECTO es 45 m de Rojo y 15 m de Azul.
 *
 * 🔴 Los números están elegidos para que ningún error pase por casualidad: si el cálculo usara el
 * total de la orden daría 60 y 60; si repartiera "a partes iguales" daría 30 y 30; si se quedara
 * con el color más grande daría 45 y 45. Sólo *piezas del color × consumo* da 45 y 15.
 */
async function crearOrdenDosColores(folio: bigint, idEmpresaOrden: number): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio,
      idEmpresa: idEmpresaOrden,
      idModelo: modelo.id,
      idCliente: clienteNegocioId,
      estado: 'completa',
      fechaCompletada: new Date(),
      fechaEntrega: new Date('2026-09-30T00:00:00.000Z'),
      lineas: {
        create: [
          {
            idColor: colorRojo.id,
            pantone: '19-1664 TCX',
            tallas: {
              create: [
                { idTalla: tallaCH.id, cantidad: 10 },
                { idTalla: tallaM.id, cantidad: 20 },
              ],
            },
          },
          {
            idColor: colorAzul.id,
            tallas: {
              create: [
                { idTalla: tallaCH.id, cantidad: 5 },
                { idTalla: tallaM.id, cantidad: 5 },
              ],
            },
          },
        ],
      },
    },
  });
  await sembrarRecetaDeOrden(cliente, orden.id, modelo.id);
  return orden.id;
}

/** Amarra los dos colores de la orden a los dos tonos de la felpa. */
async function amarrarLosDosColores(id: number = idOrden): Promise<void> {
  await asignarColorDeTela(
    sesion(),
    id,
    { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: tonoGrana.id },
    bd(),
  );
  await asignarColorDeTela(
    sesion(),
    id,
    { idTela: telaFelpa.id, idColor: colorAzul.id, idTelaColor: tonoMarino.id },
    bd(),
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
  empresa = await crearEmpresaPrueba(cliente);
  clienteNegocioId = (await cliente.cliente.create({ data: { nombre: 'Liverpool' } })).id;
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  colorAzul = await cliente.color.create({ data: { nombre: 'Azul' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  await cliente.direccionEntrega.create({
    data: { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123', favorita: true },
  });
  proveedor = await cliente.proveedor.create({ data: { nombre: 'Alsatex' } });
  telaFelpa = await cliente.tela.create({
    data: { nombre: 'Felpa 280', unidadMedida: 'M', idProveedor: proveedor.id, precioSugerido: 50 },
  });
  // Dos tonos de ESA tela, con precios DISTINTOS: es lo que hace que el precio por color importe.
  tonoGrana = await cliente.telaColor.create({
    data: { idTela: telaFelpa.id, nombre: 'Grana 7700', pantone: '19-1664 TCX', precio: 80 },
  });
  tonoMarino = await cliente.telaColor.create({
    data: { idTela: telaFelpa.id, nombre: 'Marino Alsa 3040', pantone: '19-4052 TCX', precio: 95 },
  });

  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  await cliente.modeloTela.create({
    data: { idModelo: modelo.id, idTela: telaFelpa.id, consumoPorPrenda: 1.5 },
  });

  idOrden = await crearOrdenDosColores(1n, empresa.id);
});

describe('Leer los colores de la orden (el puente que faltaba)', () => {
  it('trae un renglón por color de la MATRIZ con sus piezas y la tela que pide', async () => {
    const salida = await coloresDeTelaDeOrden(sesion(), idOrden, bd());
    const felpa = salida.telas.find((t) => t.idTela === telaFelpa.id);
    expect(felpa).toBeDefined();
    const rojo = felpa?.colores.find((c) => c.idColor === colorRojo.id);
    const azul = felpa?.colores.find((c) => c.idColor === colorAzul.id);

    expect(rojo?.piezas).toBe(30);
    expect(azul?.piezas).toBe(10);
    // ⭐ El cálculo lo hace el SERVIDOR (A1): 30 × 1.5 y 10 × 1.5.
    expect(rojo?.cantidadRequerida).toBeCloseTo(45);
    expect(azul?.cantidadRequerida).toBeCloseTo(15);
    // Todavía nadie amarró nada.
    expect(rojo?.idTelaColor).toBeNull();
  });

  it('PROPONE por pantone y NO guarda la propuesta sola', async () => {
    const salida = await coloresDeTelaDeOrden(sesion(), idOrden, bd());
    const felpa = salida.telas[0];
    const rojo = felpa?.colores.find((c) => c.idColor === colorRojo.id);
    // La OP capturó el pantone 19-1664 en el rojo, que es el de "Grana 7700".
    expect(rojo?.propuestaIdTelaColor).toBe(tonoGrana.id);
    expect(rojo?.origenPropuesta).toBe('mismo-pantone');
    // 🔴 Y sigue SIN amarrar: proponer no es decidir.
    expect(rojo?.idTelaColor).toBeNull();
    expect(await cliente.ordenTelaColor.count()).toBe(0);
  });

  it('rechaza un color de OTRA tela (el cerrojo que le quita el trabajo a quien recibe)', async () => {
    const otraTela = await cliente.tela.create({
      data: { nombre: 'Cardigan', unidadMedida: 'KG', idProveedor: proveedor.id },
    });
    const ajeno = await cliente.telaColor.create({
      data: { idTela: otraTela.id, nombre: 'Marino de otra tela' },
    });
    await expect(
      asignarColorDeTela(
        sesion(),
        idOrden,
        { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: ajeno.id },
        bd(),
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('rechaza un color de prenda que la orden NO produce', async () => {
    const verde = await cliente.color.create({ data: { nombre: 'Verde' } });
    await expect(
      asignarColorDeTela(
        sesion(),
        idOrden,
        { idTela: telaFelpa.id, idColor: verde.id, idTelaColor: tonoGrana.id },
        bd(),
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('A9: una orden de otra empresa responde 404, no un permiso ni un vacío', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra empresa');
    const idAjena = await crearOrdenDosColores(999n, otra.id);
    await expect(coloresDeTelaDeOrden(sesion(), idAjena, bd())).rejects.toThrow(ErrorNoEncontrado);
    await expect(
      asignarColorDeTela(
        sesion(),
        idAjena,
        { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: tonoGrana.id },
        bd(),
      ),
    ).rejects.toThrow(ErrorNoEncontrado);
  });

  it('exige `compras.administrar` para amarrar (esconder Y bloquear, §Post-F9.68)', async () => {
    await expect(
      asignarColorDeTela(
        sesion(['compras.ver']),
        idOrden,
        { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: tonoGrana.id },
        bd(),
      ),
    ).rejects.toThrow(ErrorPermiso);
  });
});

describe('⭐ La explosión reparte POR COLOR usando la matriz de la OP', () => {
  it('parte la tela en un renglón por color, con las piezas DE ESE COLOR', async () => {
    await amarrarLosDosColores();
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const telas = ex.grupos.flatMap((g) => g.renglones).filter((r) => r.idTela === telaFelpa.id);

    expect(telas).toHaveLength(2);
    const grana = telas.find((r) => r.idTelaColor === tonoGrana.id);
    const marino = telas.find((r) => r.idTelaColor === tonoMarino.id);
    // 🔴 LAS CIFRAS: 30 piezas × 1.5 y 10 piezas × 1.5. Ni 60/60 (total de la orden), ni 30/30
    // (mitad y mitad), ni 45/45 (el color más grande copiado).
    expect(grana?.cantidadRequerida).toBeCloseTo(45);
    expect(marino?.cantidadRequerida).toBeCloseTo(15);
    expect(grana?.telaColor).toBe('Grana 7700');
    expect(marino?.telaColor).toBe('Marino Alsa 3040');
    // Y la Σ sigue siendo la de siempre: partir no compra ni un metro de más.
    expect((grana?.cantidadRequerida ?? 0) + (marino?.cantidadRequerida ?? 0)).toBeCloseTo(60);
  });

  it('(b) el PRECIO sale del color: cada renglón trae el precio de SU tono', async () => {
    await amarrarLosDosColores();
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const telas = ex.grupos.flatMap((g) => g.renglones).filter((r) => r.idTela === telaFelpa.id);
    // Grana $80, Marino $95 — y NO el precio de referencia plano de la tela ($50), que es lo que
    // salía antes de esta etapa porque el renglón no sabía de qué color era.
    expect(telas.find((r) => r.idTelaColor === tonoGrana.id)?.precioSugerido).toBeCloseTo(80);
    expect(telas.find((r) => r.idTelaColor === tonoMarino.id)?.precioSugerido).toBeCloseTo(95);
  });

  it('lo que falta por decir se REPORTA y se sigue comprando (D3, no se adivina)', async () => {
    // Sólo se amarra UNO de los dos colores.
    await asignarColorDeTela(
      sesion(),
      idOrden,
      { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: tonoGrana.id },
      bd(),
    );
    const ex = await explosionarOrden(sesion(), idOrden, bd());

    expect(ex.pendientesColor).toHaveLength(1);
    expect(ex.pendientesColor[0]?.tela).toBe('Felpa 280');
    expect(ex.pendientesColor[0]?.colores).toEqual(['Azul']);
    expect(ex.pendientesColor[0]?.cantidadRequerida).toBeCloseTo(15);

    // 🔴 Y la cantidad NO se pierde: sigue yendo a compra en un renglón sin color.
    const telas = ex.grupos.flatMap((g) => g.renglones).filter((r) => r.idTela === telaFelpa.id);
    const sinColor = telas.find((r) => r.idTelaColor === null);
    expect(sinColor?.cantidadRequerida).toBeCloseTo(15);
    expect(telas.reduce((s, r) => s + r.cantidadRequerida, 0)).toBeCloseTo(60);
  });

  it('🔴 decir el color NO reporta la tela como «retirada del BOM»', async () => {
    // Primera explosión SIN colores: el snapshot queda con un renglón de felpa sin color.
    await explosionarOrden(sesion(), idOrden, bd());
    // El comprador hace lo que el sistema le pidió: dice los colores.
    await amarrarLosDosColores();
    const ex = await explosionarOrden(sesion(), idOrden, bd());

    // 🔴 El valor que lo pondría ROJO: un renglón con `diff: 'eliminado'` y el texto de "retirado
    // del BOM" — que es lo que salía antes de la corrección, justo después de acertar.
    const todos = ex.grupos.flatMap((g) => g.renglones);
    expect(todos.some((r) => r.diff === 'eliminado')).toBe(false);
    expect(todos.some((r) => r.material.includes('retirado del BOM'))).toBe(false);
    // Y la felpa sigue ahí, ahora en sus dos colores.
    expect(todos.filter((r) => r.idTela === telaFelpa.id)).toHaveLength(2);
  });

  it('sin ningún color dicho, la explosión sigue igual que antes de la etapa', async () => {
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const telas = ex.grupos.flatMap((g) => g.renglones).filter((r) => r.idTela === telaFelpa.id);
    expect(telas).toHaveLength(1);
    expect(telas[0]?.idTelaColor).toBeNull();
    expect(telas[0]?.cantidadRequerida).toBeCloseTo(60);
    expect(ex.pendientesColor).toHaveLength(1);
  });
});

describe('⭐ (c) Se compra el COLOR, y se sigue guardando repartido por OP (§Post-F9.86)', () => {
  it('dos OP con el mismo color van en UN renglón y en DOS líneas de OC', async () => {
    await amarrarLosDosColores();
    const idOrdenB = await crearOrdenDosColores(2n, empresa.id);
    await amarrarLosDosColores(idOrdenB);

    const ex = await explosionarOrdenes(sesion(), [idOrden, idOrdenB], bd());
    const telas = ex.grupos.flatMap((g) => g.renglones).filter((r) => r.idTela === telaFelpa.id);
    // Un renglón POR COLOR (no por OP): la felpa Grana de las dos OP es una sola compra.
    expect(telas).toHaveLength(2);
    const grana = telas.find((r) => r.idTelaColor === tonoGrana.id);
    expect(grana?.cantidadRequerida).toBeCloseTo(90); // 45 + 45
    expect(grana?.porOrden).toHaveLength(2); // …pero se ve junto y se GUARDA repartido.

    const { ordenesCompra } = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden, idOrdenB], idsRequerimiento: [] },
      bd(),
    );
    const oc = await obtenerOC(sesion(), ordenesCompra[0]?.idOrdenCompra as number, bd());
    const lineasGrana = oc.lineas.filter((l) => l.idTelaColor === tonoGrana.id);
    expect(lineasGrana).toHaveLength(2); // una por OP (§Post-F9.86: el reparto SIEMPRE por OP)
    expect(lineasGrana.reduce((s, l) => s + l.cantidad, 0)).toBeCloseTo(90);
    // Y cada línea PIDE su color, con su nombre y su pantone para quien recibe.
    expect(lineasGrana[0]?.telaColor).toBe('Grana 7700');
    expect(lineasGrana[0]?.pantoneTelaColor).toBe('19-1664 TCX');
  });

  it('no vuelve a ofrecer lo ya comprado, color por color (§Post-F9.85 sigue vivo)', async () => {
    await amarrarLosDosColores();
    // El plan de compra lee el SNAPSHOT de la explosión: primero se explota, después se compra.
    await explosionarOrden(sesion(), idOrden, bd());
    await generarOCDesdeExplosion(sesion(), { idsOrden: [idOrden], idsRequerimiento: [] }, bd());

    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const telas = ex.grupos.flatMap((g) => g.renglones).filter((r) => r.idTela === telaFelpa.id);
    for (const r of telas) {
      expect(r.cantidadPendiente).toBeCloseTo(0);
    }
    expect(telas.find((r) => r.idTelaColor === tonoGrana.id)?.cantidadEnOc).toBeCloseTo(45);
    expect(telas.find((r) => r.idTelaColor === tonoMarino.id)?.cantidadEnOc).toBeCloseTo(15);
  });
});

/**
 * ⭐⭐ **LA ATRIBUCIÓN ELEGIDA LLEGA HASTA LA REVISIÓN PREVIA** (V1-E3u, §Post-F9.89).
 *
 * El escenario es el REAL de lo migrado: una OC comprada **antes** de la etapa (sin color) y, ya
 * después, alguien dice los colores de la receta. Al netear, esos kilos sin color hay que
 * atribuírselos a algún tono — y **el sistema elige**. Estas pruebas comprueban que esa elección
 * viaja hasta la última pantalla antes de comprometer el dinero, en sus dos formas.
 */
describe('⭐ Lo comprado SIN color, dicho hasta la previa (§Post-F9.89)', () => {
  /** Compra la felpa ANTES de decir los colores (= una OC como las ~7,978 migradas). */
  async function comprarSinColor(cantidadTotal?: number): Promise<void> {
    await explosionarOrden(sesion(), idOrden, bd());
    await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden],
        idsRequerimiento: [],
        ...(cantidadTotal === undefined
          ? {}
          : {
              ajustes: [
                {
                  tipo: 'tela' as const,
                  idMaterial: telaFelpa.id,
                  idTelaColor: null,
                  idProveedor: proveedor.id,
                  cantidadTotal,
                },
              ],
            }),
      },
      bd(),
    );
  }

  it('🔴 un renglón que SÍ se compra dice cuánto se le restó por una elección', async () => {
    // Se compran sólo 30 de los 60: alcanza para parte del grana y nada más.
    await comprarSinColor(30);
    await amarrarLosDosColores();
    await explosionarOrden(sesion(), idOrden, bd());

    const plan = await previoCompraDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    const renglones = plan.proveedores.flatMap((p) => p.renglones);
    const grana = renglones.find((r) => r.idTelaColor === tonoGrana.id);

    // El grana necesitaba 45 y se le restaron los 30 del acervo sin color: quedan 15 por comprar…
    expect(grana?.cantidadTotal).toBeCloseTo(15);
    // …🔴 y la previa DICE que esos 30 los eligió el sistema. El valor que la pone ROJA: 0.
    expect(grana?.cantidadEnOcSinColor).toBeCloseTo(30);
    // El marino no recibió nada del acervo: no se le inventa una advertencia.
    expect(
      renglones.find((r) => r.idTelaColor === tonoMarino.id)?.cantidadEnOcSinColor,
    ).toBeCloseTo(0);
  });

  it('🔴 un renglón OMITIDO por «ya en OC» avisa que ese "ya está comprado" fue una elección', async () => {
    // Se compra TODO sin color; después se dicen los colores. Los dos tonos quedan "cubiertos"…
    await comprarSinColor();
    await amarrarLosDosColores();
    await explosionarOrden(sesion(), idOrden, bd());

    const plan = await previoCompraDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    const omitidos = plan.omitidos.filter((o) => o.motivo === 'ya-en-oc');
    expect(omitidos.length).toBeGreaterThan(0);

    // 🔴 Este renglón DESAPARECE de la compra por ese número. El valor que la pone ROJA: que
    // `cantidadEnOcSinColor` sea 0 y el detalle siga afirmando a secas "no hace falta volver a
    // comprarlo" — un hecho que el sistema no puede sostener (§Post-F9.85: no basta con no
    // callarse; hay que no mentir).
    const conElección = omitidos.filter((o) => o.cantidadEnOcSinColor > 0);
    expect(conElección.length).toBeGreaterThan(0);
    for (const o of conElección) {
      expect(o.detalle).toContain('NO dice de qué color');
      expect(o.detalle).toContain('se está quedando sin comprar');
    }
  });

  it('con el color dicho ANTES de comprar, no hay ninguna elección que advertir', async () => {
    // El camino limpio: primero el color, después la compra. Nada es ambiguo.
    await amarrarLosDosColores();
    await explosionarOrden(sesion(), idOrden, bd());
    await generarOCDesdeExplosion(sesion(), { idsOrden: [idOrden], idsRequerimiento: [] }, bd());
    await explosionarOrden(sesion(), idOrden, bd());

    const plan = await previoCompraDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    // Rojo si se advirtiera de todo: una alarma que suena siempre deja de leerse.
    for (const o of plan.omitidos) {
      expect(o.cantidadEnOcSinColor).toBeCloseTo(0);
      expect(o.detalle).not.toContain('NO dice de qué color');
    }
    for (const r of plan.proveedores.flatMap((p) => p.renglones)) {
      expect(r.cantidadEnOcSinColor).toBeCloseTo(0);
    }
  });
});

describe('⭐ (a) El desvío AVISA a quien autoriza — y NO bloquea', () => {
  it('guarda lo que el sistema propuso junto a lo que Compras pidió', async () => {
    await amarrarLosDosColores();
    await explosionarOrden(sesion(), idOrden, bd());
    const { ordenesCompra } = await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden],
        idsRequerimiento: [],
        // Compras teclea 70 donde el sistema calculó 45 (el rollo completo): +55 %.
        ajustes: [
          {
            tipo: 'tela',
            idMaterial: telaFelpa.id,
            idTelaColor: tonoGrana.id,
            idProveedor: proveedor.id,
            cantidadTotal: 70,
          },
        ],
      },
      bd(),
    );
    const oc = await obtenerOC(sesion(), ordenesCompra[0]?.idOrdenCompra as number, bd());
    const grana = oc.lineas.find((l) => l.idTelaColor === tonoGrana.id);
    const marino = oc.lineas.find((l) => l.idTelaColor === tonoMarino.id);

    expect(grana?.cantidad).toBeCloseTo(70);
    expect(grana?.cantidadSugerida).toBeCloseTo(45);
    // 🔴 EL AVISO EXISTE…
    expect(grana?.avisoDesvio).not.toBeNull();
    expect(grana?.avisoDesvio).toContain('MÁS');
    expect(grana?.avisoDesvio).toContain('No impide autorizar');
    // …y el color que NO se tocó no avisa nada (el ajuste es POR COLOR, no por tela).
    expect(marino?.cantidad).toBeCloseTo(15);
    expect(marino?.avisoDesvio).toBeNull();
  });

  it('🔴 el desvío NO impide generar la OC: el documento se crea igual', async () => {
    await amarrarLosDosColores();
    await explosionarOrden(sesion(), idOrden, bd());
    const resultado = await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden],
        idsRequerimiento: [],
        ajustes: [
          {
            tipo: 'tela',
            idMaterial: telaFelpa.id,
            idTelaColor: tonoMarino.id,
            idProveedor: proveedor.id,
            cantidadTotal: 500, // +3,233 %
          },
        ],
      },
      bd(),
    );
    // La OC nació. El control vive en la autorización, no en una tranca en la captura.
    expect(resultado.ordenesCompra).toHaveLength(1);
    const oc = await obtenerOC(sesion(), resultado.ordenesCompra[0]?.idOrdenCompra as number, bd());
    expect(oc.lineas.find((l) => l.idTelaColor === tonoMarino.id)?.cantidad).toBeCloseTo(500);
  });

  /**
   * 🔴 **AUTORIZAR con un desvío grande TIENE que funcionar.** Hasta aquí se probaba que la OC se
   * *genera* igual; que se pueda **autorizar** —el momento en el que Daniel quiere que llegue el
   * aviso— no lo probaba nadie. Valor que la pone ROJA: cualquier guardia futuro en `autorizarOC`
   * que mire `avisoDesvio`/`cantidadSugerida` y rechace. El aviso es para que una PERSONA decida,
   * no para que el sistema decida por ella (§Post-F9.64).
   */
  it('🔴 el desvío no impide AUTORIZAR: quien autoriza ve el aviso y decide igual', async () => {
    await amarrarLosDosColores();
    await explosionarOrden(sesion(), idOrden, bd());
    const { ordenesCompra } = await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden],
        idsRequerimiento: [],
        ajustes: [
          {
            tipo: 'tela',
            idMaterial: telaFelpa.id,
            idTelaColor: tonoGrana.id,
            idProveedor: proveedor.id,
            cantidadTotal: 200, // +344 % sobre los 45 calculados
          },
        ],
      },
      bd(),
    );
    const idOc = ordenesCompra[0]?.idOrdenCompra as number;

    // El aviso EXISTE (es lo que quien autoriza tiene que leer)…
    const antes = await obtenerOC(sesion(), idOc, bd());
    expect(antes.lineas.find((l) => l.idTelaColor === tonoGrana.id)?.avisoDesvio).not.toBeNull();

    // …y aun así se autoriza, sin trucos: el permiso normal y la OC queda autorizada.
    const autorizada = await autorizarOC(sesion([...PERM, 'compras.autorizar']), idOc, bd());
    expect(autorizada.estatus).toBe('autorizada');
    expect(autorizada.idUsuAutorizado).not.toBeNull();
    // Y el aviso sigue ahí después de autorizar: es historia, no un semáforo que se apaga.
    const despues = await obtenerOC(sesion(), idOc, bd());
    expect(despues.lineas.find((l) => l.idTelaColor === tonoGrana.id)?.avisoDesvio).not.toBeNull();
  });

  it('el umbral es el de la EMPRESA: subirlo apaga el aviso sin tocar el dato', async () => {
    await amarrarLosDosColores();
    await explosionarOrden(sesion(), idOrden, bd());
    const { ordenesCompra } = await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden],
        idsRequerimiento: [],
        ajustes: [
          {
            tipo: 'tela',
            idMaterial: telaFelpa.id,
            idTelaColor: tonoGrana.id,
            idProveedor: proveedor.id,
            cantidadTotal: 50, // +11.1 % → avisa con el default de 10
          },
        ],
      },
      bd(),
    );
    const idOc = ordenesCompra[0]?.idOrdenCompra as number;
    expect(
      (await obtenerOC(sesion(), idOc, bd())).lineas.find((l) => l.cantidad === 50)?.avisoDesvio,
    ).not.toBeNull();

    await cliente.configuracionEmpresa.upsert({
      where: { idEmpresa: empresa.id },
      create: { idEmpresa: empresa.id, pctDesvioCompra: 25 },
      update: { pctDesvioCompra: 25 },
    });
    const conUmbralAlto = await obtenerOC(sesion(), idOc, bd());
    const linea = conUmbralAlto.lineas.find((l) => l.cantidad === 50);
    expect(linea?.avisoDesvio).toBeNull();
    // 🔴 Y el DATO sigue intacto: lo que cambió es el aviso, no lo que se pidió ni lo que se propuso.
    expect(linea?.cantidadSugerida).toBeCloseTo(45);
  });
});

describe('⭐ (b) Corregir el precio del color ACTUALIZA EL CATÁLOGO — auditado (A7)', () => {
  it('cambia el catálogo, devuelve el ANTES y el DESPUÉS, y lo deja en bitácora', async () => {
    const salida = await fijarPrecioDeColor(
      sesion(),
      tonoGrana.id,
      { precio: 88.5, idOrden },
      bd(),
    );

    expect(salida.precioAnterior).toBeCloseTo(80);
    expect(salida.precio).toBeCloseTo(88.5);
    // 🔴 EL CATÁLOGO cambió para TODOS (es lo que Daniel eligió, y por eso se audita).
    const enCatalogo = await cliente.telaColor.findUniqueOrThrow({ where: { id: tonoGrana.id } });
    expect(Number(enCatalogo.precio)).toBeCloseTo(88.5);

    const bitacora = await cliente.bitacora.findFirst({
      where: { entidad: 'TelaColor', idEntidad: String(tonoGrana.id) },
      orderBy: { id: 'desc' },
    });
    expect(bitacora).not.toBeNull();
    const datos = bitacora?.datos as Record<string, unknown>;
    // Quién, de cuánto a cuánto, y DESDE DÓNDE (§Post-F9.89(b)).
    expect(datos.precioAnterior).toBe(80);
    expect(datos.precioNuevo).toBe(88.5);
    expect(datos.idOrden).toBe(idOrden);
    expect(datos.folioOrden).toBe(1);
    expect(bitacora?.idUsuario).not.toBeNull();
  });

  it('el precio corregido es el que usa la SIGUIENTE explosión (no se queda en la pantalla)', async () => {
    await amarrarLosDosColores();
    await fijarPrecioDeColor(sesion(), tonoGrana.id, { precio: 120, idOrden }, bd());
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const grana = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idTelaColor === tonoGrana.id);
    expect(grana?.precioSugerido).toBeCloseTo(120);
  });

  it('A9 en la TRAZA: no se puede citar una orden de otra empresa como origen', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra empresa');
    const idAjena = await crearOrdenDosColores(998n, otra.id);
    await expect(
      fijarPrecioDeColor(sesion(), tonoGrana.id, { precio: 10, idOrden: idAjena }, bd()),
    ).rejects.toThrow(ErrorNoEncontrado);
    // Y NO escribió nada: el precio sigue como estaba.
    const sinTocar = await cliente.telaColor.findUniqueOrThrow({ where: { id: tonoGrana.id } });
    expect(Number(sinTocar.precio)).toBeCloseTo(80);
  });

  it('exige `compras.administrar` (quien no compra no mueve el catálogo desde aquí)', async () => {
    await expect(
      fijarPrecioDeColor(sesion(['compras.ver']), tonoGrana.id, { precio: 1 }, bd()),
    ).rejects.toThrow(ErrorPermiso);
  });
});

/**
 * ⭐⭐ **V1-E4c (B) — EL AVISO AMARILLO DEL COLOR, DE PUNTA A PUNTA.**
 *
 * La regla que rige la etapa (registrada en `DECISIONES.md` §Post-F9.96): *"primero que dé la
 * opción de meterlo, y si no se hace, entonces que mande los mensajes en amarillo"*. El aviso salió
 * de la entrada de la explosión y entró en la **revisión previa**.
 *
 * 🔴 **Por qué esta batería existe y no basta con la unitaria:** `avisosDeTelaSinColor` estaba
 * probada como función pura, y la pantalla probada con un plan escrito a mano — pero **la unión no
 * la sostenía nada**: cambiar `avisos: avisosDeTelaSinColor(proveedores)` por `avisos: []` dejaba
 * las 1,742 pruebas en verde. Es *"se construye y nadie lo ve"*, el patrón exacto que originó la
 * etapa, colado en el arreglo. Aquí se ata al `previoCompraDesdeExplosion` de verdad.
 */
describe('⭐⭐ V1-E4c (B) — la previa avisa de la tela sin color', () => {
  it('sin decir el color, la previa lo AVISA (con material, proveedor, cantidad y orden)', async () => {
    // Nadie dijo los colores: la felpa entera cae en un renglón «sin color».
    await explosionarOrden(sesion(), idOrden, bd());
    const plan = await previoCompraDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );

    // 🔴 El valor que la pone ROJA: `avisos: []` — o sea, el campo cableado a vacío o desconectado
    // del plan, que es como estaba y nadie se enteraba.
    expect(plan.avisos).toHaveLength(1);
    const aviso = plan.avisos[0] as string;
    expect(aviso).toContain('Felpa 280');
    expect(aviso).toContain('Alsatex');
    expect(aviso).toContain('60'); // 40 piezas × 1.5 m
    expect(aviso).toContain('orden 1');
    // …y NO bloquea: comprar sin color siempre se ha podido (así siguen las ~7,978 OC migradas).
    expect(plan.bloqueos).toEqual([]);
    expect(plan.proveedores.flatMap((p) => p.renglones)).not.toHaveLength(0);
  });

  it('con los colores YA dichos no hay nada que advertir (la alarma que suena siempre no se lee)', async () => {
    await amarrarLosDosColores();
    await explosionarOrden(sesion(), idOrden, bd());
    const plan = await previoCompraDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    // 🔴 **EL CANDADO, y no es adorno:** `avisos: []` también es lo que devuelve un plan que no
    // encontró NADA que comprar (snapshot ausente, todo ya neteado) — el tropiezo exacto que dejó
    // el CI en rojo en la primera vuelta. Sin comprobar que el plan de verdad trae renglones, esta
    // prueba puede pasar habiendo ejercitado cero. Es la misma línea que ya lleva su hermana de
    // arriba, y aquí faltaba.
    expect(plan.proveedores.flatMap((p) => p.renglones)).not.toHaveLength(0);
    expect(plan.avisos).toEqual([]);
  });

  it('avisa SÓLO por el color que falta, no por el que ya se dijo', async () => {
    // Sólo el ROJO queda amarrado; el AZUL se queda sin decir → un renglón con color y otro sin él.
    await asignarColorDeTela(
      sesion(),
      idOrden,
      { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: tonoGrana.id },
      bd(),
    );
    await explosionarOrden(sesion(), idOrden, bd());
    const plan = await previoCompraDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    expect(plan.avisos).toHaveLength(1);
    // 15 m = las 10 piezas del azul × 1.5 (y NO 60: eso sería avisar también por el grana).
    expect(plan.avisos[0]).toContain('15');
    expect(plan.avisos[0]).not.toContain('Grana');
  });
});

/**
 * ⭐⭐ **V1-E4c — HASTA CUÁNDO SE PUEDE CAMBIAR EL COLOR.**
 *
 * *Cambiar el color se puede mientras la OC esté en BORRADOR; con la OC ya AUTORIZADA, no.* ⚠️ Es un
 * **default que propuso el lead el 23-ago-2026 y que Daniel no objetó** (`DECISIONES.md`
 * §Post-F9.96(f)): **no es una cita suya**. Se aclara porque en este proyecto lo que se le atribuye
 * al dueño es fuente de verdad del negocio, y quien lea mañana esta batería no debe creer que él la
 * dictó. (Lo que sí dijo Daniel, el 20-ago-2026 y sobre la receta, es que *"una vez recibido no se
 * puede desautorizar"* — de ahí sale el segundo mensaje de la guarda.)
 *
 * Es la MISMA regla con la que §Post-F9.79 protegió la receta, leyendo la MISMA lista de estatus
 * (`ESTATUS_OC_COMPROMETIDA`). Con dos criterios paralelos, el primero que se corrigiera dejaría al
 * otro atrás.
 */
describe('⭐⭐ V1-E4c — con la OC AUTORIZADA ya no se cambia el color', () => {
  /**
   * Amarra los dos colores y genera la OC (nace en BORRADOR). Devuelve su id.
   *
   * 🔴 **`explosionarOrden` PRIMERO, y no es adorno** (la lección que costó el CI en rojo de la
   * primera vuelta): `planearCompra` lee el **SNAPSHOT** de requerimientos, así que sin explotar no
   * encuentra nada, no arma ningún proveedor y `generarOCDesdeExplosion` devuelve **cero OC sin
   * lanzar ningún error**. La primera versión de este helper se saltaba ese paso: las dos pruebas
   * que autorizaban explotaban con `id: undefined`, y —peor— las que *pasaban* lo hacían **en el
   * vacío**, sin ninguna OC que pudiera bloquear nada.
   *
   * Por eso el fixture ahora **se comprueba a sí mismo**: si la OC no nace, la prueba lo dice aquí
   * y con esas palabras, en vez de fallar cinco líneas después por un id vacío (o, peor, pasar).
   */
  async function comprarPorColor(): Promise<number> {
    await amarrarLosDosColores();
    await explosionarOrden(sesion(), idOrden, bd());
    const { ordenesCompra } = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    expect(ordenesCompra).toHaveLength(1);
    const idOc = ordenesCompra[0]?.idOrdenCompra as number;
    // Y es la OC que creemos: en BORRADOR (de ahí arranca la regla) y con los DOS colores pedidos,
    // que es lo que hace que "el bloqueo es por color" signifique algo.
    const oc = await obtenerOC(sesion(), idOc, bd());
    expect(oc.estatus).toBe('borrador');
    expect(oc.lineas.filter((l) => l.idTelaColor === tonoGrana.id)).toHaveLength(1);
    expect(oc.lineas.filter((l) => l.idTelaColor === tonoMarino.id)).toHaveLength(1);
    return idOc;
  }

  it('en BORRADOR el color se sigue cambiando libremente (ahí no hay compromiso con nadie)', async () => {
    await comprarPorColor();
    // 🔴 El valor que la pondría roja: que la guarda usara `ESTATUS_OC_QUE_CUBREN` (donde el
    // borrador SÍ cuenta) y cerrara la captura en cuanto se genera la OC.
    const salida = await asignarColorDeTela(
      sesion(),
      idOrden,
      { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: tonoMarino.id },
      bd(),
    );
    const felpa = salida.telas.find((t) => t.idTela === telaFelpa.id);
    const rojo = felpa?.colores.find((c) => c.idColor === colorRojo.id);
    expect(rojo?.idTelaColor).toBe(tonoMarino.id);
    expect(rojo?.puedeCambiar).toBe(true);
    expect(rojo?.motivoNoCambiar).toBeNull();
  });

  it('AUTORIZADA la OC, cambiar ese color se RECHAZA y el mensaje manda a des-autorizar', async () => {
    const idOc = await comprarPorColor();
    const autorizada = await autorizarOC(sesion([...PERM, 'compras.autorizar']), idOc, bd());
    expect(autorizada.estatus).toBe('autorizada');

    await expect(
      asignarColorDeTela(
        sesion(),
        idOrden,
        { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: tonoMarino.id },
        bd(),
      ),
    ).rejects.toThrow(/DES-AUTORIZAR/);

    // Y no escribió nada: el amarre sigue como estaba (una guarda que rechaza a medias es peor).
    const salida = await coloresDeTelaDeOrden(sesion(), idOrden, bd());
    const felpa = salida.telas.find((t) => t.idTela === telaFelpa.id);
    const rojo = felpa?.colores.find((c) => c.idColor === colorRojo.id);
    expect(rojo?.idTelaColor).toBe(tonoGrana.id);
    // La LECTURA lo dice ANTES de intentarlo, con la misma frase: la pantalla pinta la regla, no la
    // deduce (A1).
    expect(rojo?.puedeCambiar).toBe(false);
    expect(rojo?.motivoNoCambiar).toContain('DES-AUTORIZAR');
  });

  it('QUITAR el amarre de un color ya comprado también se rechaza (D3: no se deshace a escondidas)', async () => {
    const idOc = await comprarPorColor();
    const autorizada = await autorizarOC(sesion([...PERM, 'compras.autorizar']), idOc, bd());
    expect(autorizada.estatus).toBe('autorizada');
    await expect(
      asignarColorDeTela(
        sesion(),
        idOrden,
        { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: null },
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);
  });

  it('🔴 el bloqueo es POR COLOR: el otro color de la misma tela se sigue capturando', async () => {
    // Sólo el ROJO queda amarrado y comprado; el AZUL se queda sin decir.
    await asignarColorDeTela(
      sesion(),
      idOrden,
      { idTela: telaFelpa.id, idColor: colorRojo.id, idTelaColor: tonoGrana.id },
      bd(),
    );
    await explosionarOrden(sesion(), idOrden, bd());
    const { ordenesCompra } = await generarOCDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    // 🔴 Sin esta comprobación, un fixture que no genera NADA deja el bucle vacío y la prueba
    // "pasa" sin haber autorizado nunca nada — exactamente lo que pasó en la primera vuelta.
    expect(ordenesCompra).toHaveLength(1);
    for (const oc of ordenesCompra) {
      const autorizada = await autorizarOC(
        sesion([...PERM, 'compras.autorizar']),
        oc.idOrdenCompra,
        bd(),
      );
      expect(autorizada.estatus).toBe('autorizada');
    }

    // (1) CAPTURAR el azul se puede, aunque el grana de esa misma tela esté comprado.
    const salida = await asignarColorDeTela(
      sesion(),
      idOrden,
      { idTela: telaFelpa.id, idColor: colorAzul.id, idTelaColor: tonoMarino.id },
      bd(),
    );
    const felpa = salida.telas.find((t) => t.idTela === telaFelpa.id);
    expect(felpa?.colores.find((c) => c.idColor === colorAzul.id)?.idTelaColor).toBe(tonoMarino.id);
    // …y el rojo sí quedó cerrado.
    expect(felpa?.colores.find((c) => c.idColor === colorRojo.id)?.puedeCambiar).toBe(false);

    // ── (2) 🔴🔴 **EL ESCENARIO QUE DE VERDAD DECIDE SI LA LLAVE ES POR COLOR** ────────────────
    //
    // Capturar el azul NO lo prueba: un color **sin amarre previo** ni siquiera consulta el mapa de
    // compras (`idAnterior === null` corta antes), así que con una llave por TELA esa captura
    // pasaría igual. Lo que separa las dos llaves es **CORREGIR un color YA dicho mientras OTRO
    // tono de esa misma tela está comprado** — que es, además, el flujo que da nombre a la etapa.
    //
    // Aquí el azul está en Marino (nadie lo compró) y lo comprado en firme es el GRANA. Con la
    // llave `(tela, color)` la corrección pasa; **con una llave por TELA, el grana comprado cerraría
    // también al marino y esto se rechazaría**.
    expect(felpa?.colores.find((c) => c.idColor === colorAzul.id)?.puedeCambiar).toBe(true);
    const corregida = await asignarColorDeTela(
      sesion(),
      idOrden,
      { idTela: telaFelpa.id, idColor: colorAzul.id, idTelaColor: tonoGrana.id },
      bd(),
    );
    expect(
      corregida.telas
        .find((t) => t.idTela === telaFelpa.id)
        ?.colores.find((c) => c.idColor === colorAzul.id)?.idTelaColor,
    ).toBe(tonoGrana.id);
  });
});

/**
 * 🔴 **V1-E4c — LA ORDEN SIN MATRIZ COLOR×TALLA: el dato no es difícil, es IMPOSIBLE.**
 *
 * `OrdenTelaColor` amarra `(idOrdenTela, idColor)`: sin una sola línea de color en la orden no
 * existe `idColor` del que colgar el amarre. Antes de esta etapa el sistema se lo tragaba callado
 * (sin colores en la matriz, la tela ni siquiera entraba en `pendientesColor` y se compraba sin
 * color sin avisar). Ahora la lectura lo DICE, para que la pantalla mande a capturar la matriz en
 * vez de ofrecer un campo que no puede guardar nada.
 */
describe('🔴 V1-E4c — la orden SIN matriz color×talla lo dice', () => {
  it('`sinMatrizColores` es true y no hay ningún color que capturar', async () => {
    const orden = await cliente.orden.create({
      data: {
        folio: 777n,
        idEmpresa: empresa.id,
        idModelo: modelo.id,
        idCliente: clienteNegocioId,
        estado: 'capturada',
      },
    });
    await sembrarRecetaDeOrden(cliente, orden.id, modelo.id);

    const salida = await coloresDeTelaDeOrden(sesion(), orden.id, bd());
    expect(salida.sinMatrizColores).toBe(true);
    expect(salida.telas.find((t) => t.idTela === telaFelpa.id)?.colores).toEqual([]);
  });

  it('una orden CON matriz no se marca como sin matriz', async () => {
    const salida = await coloresDeTelaDeOrden(sesion(), idOrden, bd());
    expect(salida.sinMatrizColores).toBe(false);
  });
});
