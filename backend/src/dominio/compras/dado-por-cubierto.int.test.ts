/**
 * ⭐⭐ **«CON ESTO QUEDA CUBIERTO»** (V1-E8e, §Post-F9.99) — integración contra Postgres efímero
 * (testcontainers). **NO corre en local** (usa Docker; lo corre el CI).
 *
 * Daniel, usando la explosión en `prueba`:
 *
 * > *"compré **480 en lugar de 481** que era el cálculo de la tela. Y me sigue poniendo que me falta
 * > comprar 1 kilo… **a veces pasa eso en la realidad**. Y **no voy a hacer otra OC por 1 kilo**."*
 *
 * ⭐ **LAS DOS PRUEBAS QUE SOSTIENEN LA ETAPA**, y por las que existe este archivo:
 *
 *  1. **Dar por cubierto → volver a EXPLOTAR → la marca sigue ahí.** Es la trampa técnica de la
 *     decisión: el snapshot (`RequerimientoOrden`) se **borra y se reescribe entero** en cada
 *     explosión, así que una bandera ahí se habría borrado sola y el faltante habría vuelto sin que
 *     nadie entendiera por qué. Sólo Postgres puede enseñar que la marca sobrevive.
 *  2. **El default NUNCA cierra.** Bajar la cantidad sin contestar deja el resto **pendiente**.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Avio,
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Proveedor,
  Talla,
  Tela,
} from '../../datos/index.js';
import type { ClavePermiso } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrarRecetaDeOrden } from '../../pruebas/receta.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { darPorCubierto } from './dado-por-cubierto.js';
import { explosionarOrden, generarOCDesdeExplosion, previoCompraDesdeExplosion } from './mrp.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let telaFelpa: Tela;
let avioBoton: Avio;
let proveedor: Proveedor;
let colorRojo: Color;
let tallaCH: Talla;
let idOrden: number;

/**
 * ⚠️ `compras.administrar` está en la lista **a propósito**: es el permiso que exigen
 * `darPorCubierto` y la generación de OC. Una sesión sin él convierte toda esta batería en verdes
 * que nunca llegaron a tocar el sistema (la cicatriz de V1-E8d, cazada por el CI).
 */
const PERM: ClavePermiso[] = ['compras.ver', 'compras.administrar'];

const sesion = (permisos: ClavePermiso[] = PERM): SesionUsuario =>
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
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  // §Post-F9.18: la OC generada toma la dirección FAVORITA del catálogo.
  await cliente.direccionEntrega.create({
    data: { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123', favorita: true },
  });
  proveedor = await cliente.proveedor.create({ data: { nombre: 'Telas del Norte' } });
  telaFelpa = await cliente.tela.create({ data: { nombre: 'Felpa', unidadMedida: 'KG' } });
  avioBoton = await cliente.avio.create({
    data: { clave: 'BOT-01', descripcion: 'Botón', unidad: 'pza' },
  });
  await cliente.avioProveedor.create({
    data: { idAvio: avioBoton.id, idProveedor: proveedor.id, precio: 2 },
  });

  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  // ⚠️ El BOM del modelo se siembra ANTES de crear la orden: `sembrarRecetaDeOrden` es idempotente
  // a propósito, así que un material agregado DESPUÉS no entraría en la receta ya congelada.
  await cliente.modeloTela.create({
    // 100 prendas × 4.81 kg = 481 kg — el número exacto de la queja de Daniel.
    data: { idModelo: modelo.id, idTela: telaFelpa.id, consumoPorPrenda: 4.81 },
  });
  await cliente.modeloAvio.create({
    data: { idModelo: modelo.id, idAvio: avioBoton.id, consumoPorPrenda: 6 },
  });
  // La tela no tiene proveedor por catálogo: se le asigna en la receta de la orden para que el
  // renglón sea COMPRABLE (si no, saldría omitido por `sin-proveedor` y nada de esto se mediría).
  const orden = await cliente.orden.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNegocio.id,
      estado: 'completa',
      fechaCompletada: new Date(),
      fechaEntrega: new Date('2026-09-30T00:00:00.000Z'),
      lineas: {
        create: [
          { idColor: colorRojo.id, tallas: { create: [{ idTalla: tallaCH.id, cantidad: 100 }] } },
        ],
      },
    },
  });
  idOrden = orden.id;
  await sembrarRecetaDeOrden(cliente, idOrden, modelo.id);
  await cliente.ordenTela.updateMany({
    where: { idOrden, idTela: telaFelpa.id },
    data: { idProveedorCompra: proveedor.id, precioCompra: 50 },
  });
});

/** El renglón de la FELPA tal como lo enseña la explosión (con sus ids de snapshot). */
async function renglonDeFelpa(): Promise<{
  ids: number[];
  pendiente: number;
  cubierta: number;
  enOc: number;
}> {
  const ex = await explosionarOrden(sesion(), idOrden, bd());
  const r = ex.grupos.flatMap((g) => g.renglones).find((x) => x.idTela === telaFelpa.id);
  return {
    ids: r?.idsRequerimiento ?? [],
    pendiente: r?.cantidadPendiente ?? -1,
    cubierta: r?.cantidadCubierta ?? -1,
    enOc: r?.cantidadEnOc ?? -1,
  };
}

/** Cuerpo de compra de la felpa, con la cantidad que el comprador teclea (y su respuesta). */
function cuerpoDeCompra(cantidadTotal: number, restoCubierto?: boolean) {
  return {
    idsOrden: [idOrden],
    idsRequerimiento: [] as number[],
    fechaEntrega: '2026-09-01',
    ajustes: [
      {
        tipo: 'tela' as const,
        idMaterial: telaFelpa.id,
        idColor: null,
        idProveedor: proveedor.id,
        cantidadTotal,
        ...(restoCubierto === undefined ? {} : { restoCubierto }),
      },
    ],
  };
}

describe('V1-E8e — «con esto queda cubierto» desde la REVISIÓN PREVIA (§Post-F9.99)', () => {
  it('el faltante SE ANUNCIA en cuanto se baja la cantidad, sin umbral ninguno', async () => {
    await explosionarOrden(sesion(), idOrden, bd());
    const plan = await previoCompraDesdeExplosion(sesion(), cuerpoDeCompra(480), bd());
    const renglon = plan.proveedores[0]?.renglones[0];
    expect(renglon?.cantidadPropuesta).toBe(481);
    expect(renglon?.cantidadTotal).toBe(480);
    // 🔴 El valor que la pone roja: 0 — la previa no tendría por qué preguntar nada.
    expect(renglon?.cantidadFaltante).toBe(1);
    expect(renglon?.restoCubierto).toBe(false);
  });

  it('🔴 EL DEFAULT NUNCA CIERRA: comprar 480 sin contestar deja el kilo PENDIENTE', async () => {
    await explosionarOrden(sesion(), idOrden, bd());
    await generarOCDesdeExplosion(sesion(), cuerpoDeCompra(480), bd());
    // Nadie contestó ⇒ no hay ni un acto escrito…
    expect(await cliente.requerimientoCubierto.count()).toBe(0);
    // …y el faltante sigue vivo: es EXACTAMENTE la queja de Daniel, y tiene que seguir pasando
    // mientras nadie diga lo contrario.
    const despues = await renglonDeFelpa();
    expect(despues.enOc).toBe(480);
    expect(despues.pendiente).toBe(1);
    expect(despues.cubierta).toBe(0);
  });

  it('⭐⭐ contestando «con esto queda cubierto», el kilo DEJA de pedirse', async () => {
    await explosionarOrden(sesion(), idOrden, bd());
    await generarOCDesdeExplosion(sesion(), cuerpoDeCompra(480, true), bd());

    const acto = await cliente.requerimientoCubierto.findFirstOrThrow();
    expect(Number(acto.cantidad)).toBe(1);
    expect(acto.idTela).toBe(telaFelpa.id);
    expect(acto.origen).toBe('previa');
    // RASTRO (A7): quién, contra qué requerido y con qué cantidad comprada — el *"pediste 480 de
    // los 481"* literal, guardado.
    expect(acto.creadoPorId).not.toBeNull();
    expect(Number(acto.cantidadRequerida)).toBe(481);
    expect(Number(acto.cantidadComprada)).toBe(480);

    const despues = await renglonDeFelpa();
    expect(despues.cubierta).toBe(1);
    // 🔴 El valor que la pone roja: 1 — el kilo persiguiéndolo para siempre.
    expect(despues.pendiente).toBe(0);
  });

  it('⭐⭐⭐ LA TRAMPA TÉCNICA: volver a EXPLOTAR no borra la marca', async () => {
    await explosionarOrden(sesion(), idOrden, bd());
    await generarOCDesdeExplosion(sesion(), cuerpoDeCompra(480, true), bd());

    // El snapshot se BORRA y se reescribe entero en cada explosión: los ids de renglón cambian.
    const idsAntes = (await renglonDeFelpa()).ids;
    await explosionarOrden(sesion(), idOrden, bd());
    await explosionarOrden(sesion(), idOrden, bd());
    const despues = await renglonDeFelpa();
    expect(despues.ids).not.toEqual(idsAntes);

    // 🔴 Y la marca sigue en pie. Si viviera en `RequerimientoOrden`, aquí `cubierta` sería 0 y
    // `pendiente` volvería a 1 — el faltante resucitado sin que nadie entendiera por qué.
    expect(despues.cubierta).toBe(1);
    expect(despues.pendiente).toBe(0);
    // Y no se duplicó por explotar tres veces: la marca es un acto, no un efecto de la explosión.
    expect(await cliente.requerimientoCubierto.count()).toBe(1);
  });

  it('el renglón cerrado SALE de la compra con SU razón, no con la de otro', async () => {
    await explosionarOrden(sesion(), idOrden, bd());
    await generarOCDesdeExplosion(sesion(), cuerpoDeCompra(480, true), bd());
    await explosionarOrden(sesion(), idOrden, bd());

    const plan = await previoCompraDesdeExplosion(
      sesion(),
      { idsOrden: [idOrden], idsRequerimiento: [], fechaEntrega: '2026-09-01' },
      bd(),
    );
    const omitido = plan.omitidos.find((o) => o.material.startsWith('Felpa'));
    // 🔴 `ya-en-oc` diría *"si esa OC se cancela, vuelve a aparecer"* — mandaría a cancelar una
    // compra correcta; `menor-al-minimo` diría que falta menos de 0.01, y falta un kilo entero.
    expect(omitido?.motivo).toBe('dado-por-cubierto');
    expect(omitido?.cantidadCubierta).toBe(1);
    expect(omitido?.detalle).toContain('volver a pedirlo');
  });

  it('marcarlo NO se cuela sin compra: sin `restoCubierto` el cuerpo no escribe nada', async () => {
    await explosionarOrden(sesion(), idOrden, bd());
    await previoCompraDesdeExplosion(sesion(), cuerpoDeCompra(480, true), bd());
    // La REVISIÓN PREVIA no escribe NADA — ni el plan ni la marca. Sólo generar compromete.
    expect(await cliente.requerimientoCubierto.count()).toBe(0);
  });
});

describe('V1-E8e — «dar por cubierto» / «volver a pedirlo» desde la EXPLOSIÓN (§Post-F9.99)', () => {
  it('⭐ cierra lo que hoy falta — el caso que YA se escapó', async () => {
    // La OC de 480 ya se hizo (sin contestar nada): es el escenario que originó la decisión.
    await explosionarOrden(sesion(), idOrden, bd());
    await generarOCDesdeExplosion(sesion(), cuerpoDeCompra(480), bd());
    const antes = await renglonDeFelpa();
    expect(antes.pendiente).toBe(1);

    const salida = await darPorCubierto(
      sesion(),
      { idsRequerimiento: antes.ids, cubierto: true },
      bd(),
    );
    expect(salida.afectados).toHaveLength(1);
    expect(salida.afectados[0]?.cantidad).toBe(1);
    expect(salida.afectados[0]?.material).toBe('Felpa');

    const acto = await cliente.requerimientoCubierto.findFirstOrThrow();
    expect(acto.origen).toBe('explosion');
    expect(Number(acto.cantidadComprada)).toBe(480);

    const despues = await renglonDeFelpa();
    expect(despues.pendiente).toBe(0);
    expect(despues.cubierta).toBe(1);
  });

  it('es IDEMPOTENTE: darlo por cubierto dos veces no cubre de más', async () => {
    await explosionarOrden(sesion(), idOrden, bd());
    await generarOCDesdeExplosion(sesion(), cuerpoDeCompra(480), bd());
    const { ids } = await renglonDeFelpa();

    await darPorCubierto(sesion(), { idsRequerimiento: ids, cubierto: true }, bd());
    const segunda = await darPorCubierto(
      sesion(),
      { idsRequerimiento: (await renglonDeFelpa()).ids, cubierto: true },
      bd(),
    );
    // La segunda vez ya no falta nada: no hay qué cubrir y no se inventa un acto de cero.
    expect(segunda.afectados).toEqual([]);
    expect(await cliente.requerimientoCubierto.count()).toBe(1);
  });

  it('⭐ «VOLVER A PEDIRLO» devuelve el faltante — y NO borra el rastro (D3)', async () => {
    await explosionarOrden(sesion(), idOrden, bd());
    await generarOCDesdeExplosion(sesion(), cuerpoDeCompra(480), bd());
    const { ids } = await renglonDeFelpa();
    await darPorCubierto(sesion(), { idsRequerimiento: ids, cubierto: true }, bd());

    const deshecho = await darPorCubierto(
      sesion(),
      { idsRequerimiento: (await renglonDeFelpa()).ids, cubierto: false },
      bd(),
    );
    expect(deshecho.afectados[0]?.cantidad).toBe(1);

    const despues = await renglonDeFelpa();
    expect(despues.cubierta).toBe(0);
    expect(despues.pendiente).toBe(1);
    // D3: el acto no se BORRA, se sella. El rastro de quién lo había cerrado sobrevive.
    const acto = await cliente.requerimientoCubierto.findFirstOrThrow();
    expect(acto.canceladoEn).not.toBeNull();
    expect(acto.canceladoPorId).not.toBeNull();
  });

  it('cubrir la FELPA no toca al BOTÓN: la marca es de un renglón, no del material entero', async () => {
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const felpa = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idTela === telaFelpa.id);
    await darPorCubierto(
      sesion(),
      { idsRequerimiento: felpa?.idsRequerimiento ?? [], cubierto: true },
      bd(),
    );
    const despues = await explosionarOrden(sesion(), idOrden, bd());
    const boton = despues.grupos.flatMap((g) => g.renglones).find((r) => r.idAvio === avioBoton.id);
    expect(boton?.cantidadCubierta).toBe(0);
    expect(boton?.cantidadPendiente).toBe(600);
  });

  it('A9: un renglón de otra empresa no existe para esta sesión (404)', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra SA');
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const felpa = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idTela === telaFelpa.id);
    const ajena = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM });
    await expect(
      darPorCubierto(
        ajena,
        { idsRequerimiento: felpa?.idsRequerimiento ?? [], cubierto: true },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('A4: sin `compras.administrar` no se puede decidir qué NO se compra', async () => {
    const ex = await explosionarOrden(sesion(), idOrden, bd());
    const felpa = ex.grupos.flatMap((g) => g.renglones).find((r) => r.idTela === telaFelpa.id);
    await expect(
      darPorCubierto(
        sesion(['compras.ver']),
        { idsRequerimiento: felpa?.idsRequerimiento ?? [], cubierto: true },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

/**
 * ⭐⭐ **fila 0.162 — LAS MARCAS HUÉRFANAS: el renglón que CAMBIA DE FORMA después de decidir.**
 *
 * La mitad gemela de la fila 0.158. Aquélla cerró el hueco en lo COMPROMETIDO EN OC; éste es el
 * mismo hueco en el OTRO sumando del mismo criterio: **lo dado por cubierto**.
 *
 * El acto se guarda por *(orden, material, color)* y se buscaba por **igualdad exacta**. Pero el
 * color del renglón puede cambiar DESPUÉS de que alguien decidió:
 *  • se marca *«se compra sin tomar en cuenta el color»* en un avío que ya tenía renglones por
 *    color (la casilla que estrenó la 0.158), o
 *  • se le quita a una tela el amarre de color de la orden.
 *
 * En ese instante la explosión emite **un renglón sin color** y las marcas de Rojo/Azul se quedan
 * **sin dueño**: nadie las encuentra y el faltante que alguien ya había cerrado **vuelve a
 * pedirse**. Es dinero: la explosión es la pantalla que dice qué comprar.
 *
 * ⚠️ Estas pruebas van por el CAMINO REAL (explosión → OC → cambio de forma → re-explosión) y
 * afirman sobre **el número de la pantalla** (`cantidadPendiente`), no sobre que la marca exista.
 */
describe('⭐⭐ fila 0.162 — las marcas huérfanas de «con esto queda cubierto»', () => {
  let azul: Color;
  let etiqueta: Avio;
  let popelina: Tela;
  let tcRojo: { id: number };
  let tcAzul: { id: number };
  let idOrdenDos: number;

  /** Los renglones de UN avío en la orden de dos colores. */
  async function renglonesAvio(idAvio: number) {
    const ex = await explosionarOrden(sesion(), idOrdenDos, bd());
    return ex.grupos.flatMap((g) => g.renglones).filter((r) => r.idAvio === idAvio);
  }

  /** Los renglones de UNA tela en la orden que se le pida. */
  async function renglonesTela(idTela: number, idOrdenLeer: number) {
    const ex = await explosionarOrden(sesion(), idOrdenLeer, bd());
    return ex.grupos.flatMap((g) => g.renglones).filter((r) => r.idTela === idTela);
  }

  beforeEach(async () => {
    azul = await cliente.color.create({ data: { nombre: 'Azul' } });
    // La etiqueta de lavado: es la MISMA en los dos colores, y es la que Daniel acabó marcando
    // «se compra sin tomar en cuenta el color» (fila 0.158). Arranca SIN marcar.
    etiqueta = await cliente.avio.create({
      data: { clave: 'ETI-LAV', descripcion: 'Etiqueta de lavado', unidad: 'pza' },
    });
    await cliente.avioProveedor.create({
      data: { idAvio: etiqueta.id, idProveedor: proveedor.id, precio: 0.5, habitual: true },
    });
    popelina = await cliente.tela.create({ data: { nombre: 'Popelina', unidadMedida: 'M' } });
    tcRojo = await cliente.telaColor.create({
      data: { idTela: popelina.id, nombre: 'Rojo tela' },
    });
    tcAzul = await cliente.telaColor.create({
      data: { idTela: popelina.id, nombre: 'Azul tela' },
    });
    // ⚠️ El BOM se amplía ANTES de crear la orden: `sembrarRecetaDeOrden` copia lo que haya en ese
    // momento y es idempotente, así que un material agregado después no entraría en la receta.
    await cliente.modeloAvio.create({
      data: { idModelo: modelo.id, idAvio: etiqueta.id, consumoPorPrenda: 1 },
    });
    await cliente.modeloTela.create({
      data: { idModelo: modelo.id, idTela: popelina.id, consumoPorPrenda: 1 },
    });

    // Una OP de DOS colores: Rojo 60 piezas, Azul 40. Con consumo 1, los números son las piezas.
    const orden = await cliente.orden.create({
      data: {
        folio: 700n,
        idEmpresa: empresa.id,
        idModelo: modelo.id,
        idCliente: (await cliente.cliente.findFirstOrThrow()).id,
        estado: 'completa',
        fechaCompletada: new Date(),
        fechaEntrega: new Date('2026-10-31T00:00:00.000Z'),
        lineas: {
          create: [
            { idColor: colorRojo.id, tallas: { create: [{ idTalla: tallaCH.id, cantidad: 60 }] } },
            { idColor: azul.id, tallas: { create: [{ idTalla: tallaCH.id, cantidad: 40 }] } },
          ],
        },
      },
    });
    idOrdenDos = orden.id;
    await sembrarRecetaDeOrden(cliente, idOrdenDos, modelo.id);
    // Las telas de esta OP se compran a `proveedor` (si no, saldrían omitidas por «sin-proveedor»
    // y no habría nada que medir).
    await cliente.ordenTela.updateMany({
      where: { idOrden: idOrdenDos },
      data: { idProveedorCompra: proveedor.id, precioCompra: 10 },
    });
    // Y los amarres de color de la POPELINA: Rojo→«Rojo tela», Azul→«Azul tela».
    const ot = await cliente.ordenTela.findFirstOrThrow({
      where: { idOrden: idOrdenDos, idTela: popelina.id },
    });
    await cliente.ordenTelaColor.createMany({
      data: [
        { idOrdenTela: ot.id, idColor: colorRojo.id, idTelaColor: tcRojo.id },
        { idOrdenTela: ot.id, idColor: azul.id, idTelaColor: tcAzul.id },
      ],
    });
  });

  /**
   * ⭐⭐ **EL CASO DEL AVÍO — el que nace de la casilla que estrenó la 0.158.**
   *
   * Se compran 50 de las 60 piezas del Rojo y se contesta *«con esto queda cubierto»*: quedan 10
   * cerradas. El Azul (40) no se compra. Después Daniel marca la casilla y la explosión colapsa a
   * UN renglón sin color de 100 piezas.
   *
   * 🔴 **Medido antes de corregirlo: `cubierta: 0` y `pendiente: 50`** — el sistema pidiendo
   * comprar 50 donde de verdad faltan 40, porque las 10 que alguien cerró expresamente volvieron a
   * perseguirse.
   */
  async function comprarRojoYCerrarDiez(): Promise<void> {
    const antes = await renglonesAvio(etiqueta.id);
    const rojo = antes.find((r) => r.idColorPrenda === colorRojo.id);
    await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrdenDos],
        idsRequerimiento: rojo?.idsRequerimiento ?? [],
        fechaEntrega: '2026-09-01',
        ajustes: [
          {
            tipo: 'avio',
            idMaterial: etiqueta.id,
            idColor: colorRojo.id,
            idProveedor: proveedor.id,
            cantidadTotal: 50,
            restoCubierto: true,
          },
        ],
      },
      bd(),
    );
  }

  it('⭐⭐ AVÍO: marcar «se compra sin color» NO tira lo que alguien dio por cubierto', async () => {
    await explosionarOrden(sesion(), idOrdenDos, bd());
    const porColor = await renglonesAvio(etiqueta.id);
    expect(porColor).toHaveLength(2);
    expect(porColor.map((r) => r.cantidadAComprar).sort((a, b) => a - b)).toEqual([40, 60]);

    await comprarRojoYCerrarDiez();
    // La marca nació CON color: es justo lo que la deja huérfana al colapsar el renglón.
    const acto = await cliente.requerimientoCubierto.findFirstOrThrow();
    expect(acto.idAvio).toBe(etiqueta.id);
    expect(acto.idColorPrenda).toBe(colorRojo.id);
    expect(Number(acto.cantidad)).toBe(10);

    // Y AHORA se marca la casilla: un solo renglón, sin color, de 100 piezas.
    await cliente.avio.update({ where: { id: etiqueta.id }, data: { seCompraSinColor: true } });
    const colapsado = await renglonesAvio(etiqueta.id);
    expect(colapsado).toHaveLength(1);
    expect(colapsado[0]?.idColorPrenda).toBeNull();
    expect(colapsado[0]?.cantidadAComprar).toBeCloseTo(100);
    expect(colapsado[0]?.cantidadEnOc).toBeCloseTo(50);

    // 🔴 LOS VALORES QUE LA PONEN ROJA: `cubierta: 0` y `pendiente: 50` — las 10 piezas que
    // alguien cerró, resucitadas, y el sistema invitando a comprarlas otra vez.
    expect(colapsado[0]?.cantidadCubierta).toBe(10);
    expect(colapsado[0]?.cantidadPendiente).toBe(40);
  });

  it('⭐⭐ AVÍO: la REVISIÓN PREVIA dice el MISMO número que la explosión', async () => {
    // Las dos pantallas leen el mismo criterio por caminos distintos (`planearCompra` tiene su
    // propio reparto): si sólo se arreglara una, el comprador vería 40 en una y 50 en la otra.
    await explosionarOrden(sesion(), idOrdenDos, bd());
    await comprarRojoYCerrarDiez();
    await cliente.avio.update({ where: { id: etiqueta.id }, data: { seCompraSinColor: true } });
    const colapsado = await renglonesAvio(etiqueta.id);

    const plan = await previoCompraDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrdenDos],
        idsRequerimiento: colapsado[0]?.idsRequerimiento ?? [],
        fechaEntrega: '2026-09-01',
      },
      bd(),
    );
    const renglon = plan.proveedores
      .flatMap((p) => p.renglones)
      .find((r) => r.tipo === 'avio' && r.idMaterial === etiqueta.id);
    // 🔴 El valor que la pone roja: 50 — la previa ofreciendo comprar lo que ya se dio por cubierto.
    expect(renglon?.cantidadPropuesta).toBe(40);
  });

  it('⭐⭐ AVÍO: «volver a pedirlo» SUELTA la marca que la lectura le atribuyó', async () => {
    await explosionarOrden(sesion(), idOrdenDos, bd());
    await comprarRojoYCerrarDiez();
    await cliente.avio.update({ where: { id: etiqueta.id }, data: { seCompraSinColor: true } });
    const colapsado = await renglonesAvio(etiqueta.id);
    expect(colapsado[0]?.cantidadCubierta).toBe(10);

    const deshecho = await darPorCubierto(
      sesion(),
      { idsRequerimiento: colapsado[0]?.idsRequerimiento ?? [], cubierto: false },
      bd(),
    );
    // 🔴 El valor que la pone roja: `[]` — el botón mudo, el faltante cerrado y sin manera de
    // reabrirlo, porque la búsqueda exacta tampoco encuentra la marca para cancelarla.
    expect(deshecho.afectados).toHaveLength(1);
    expect(deshecho.afectados[0]?.cantidad).toBe(10);

    const acto = await cliente.requerimientoCubierto.findFirstOrThrow();
    expect(acto.canceladoEn).not.toBeNull(); // D3: se sella, no se borra.
    const despues = await renglonesAvio(etiqueta.id);
    expect(despues[0]?.cantidadCubierta).toBe(0);
    expect(despues[0]?.cantidadPendiente).toBe(50);
  });

  it('⭐ AVÍO: cerrar lo que queda NO cuenta dos veces lo ya cerrado', async () => {
    await explosionarOrden(sesion(), idOrdenDos, bd());
    await comprarRojoYCerrarDiez();
    await cliente.avio.update({ where: { id: etiqueta.id }, data: { seCompraSinColor: true } });
    const colapsado = await renglonesAvio(etiqueta.id);

    const salida = await darPorCubierto(
      sesion(),
      { idsRequerimiento: colapsado[0]?.idsRequerimiento ?? [], cubierto: true },
      bd(),
    );
    // 🔴 El valor que la pone roja: 50 — el acto nuevo cerrando otra vez las 10 ya cerradas, y el
    // renglón quedando con 60 cubiertos sobre 100 requeridos.
    expect(salida.afectados[0]?.cantidad).toBe(40);
    const despues = await renglonesAvio(etiqueta.id);
    expect(despues[0]?.cantidadCubierta).toBe(50);
    expect(despues[0]?.cantidadPendiente).toBe(0);
  });

  /**
   * ⭐⭐ **EL CASO DE LA TELA — la otra dimensión, y no es la misma puerta.** Aquí el renglón pierde
   * el color porque se le quita el AMARRE a la orden (`OrdenTelaColor`), no por una casilla de
   * catálogo. Es la queja literal de Daniel —*«compré 480 en lugar de 481»*— sobrevivida a que
   * alguien corrija los tonos de la OP.
   */
  it('⭐⭐ TELA: quitarle el amarre de color NO tira lo que se dio por cubierto', async () => {
    // Una OP de UN color con amarre: el renglón de popelina sale con su color de tela.
    const ot = await cliente.ordenTela.findFirstOrThrow({
      where: { idOrden, idTela: telaFelpa.id },
    });
    const marino = await cliente.telaColor.create({
      data: { idTela: telaFelpa.id, nombre: 'Marino Alsa' },
    });
    await cliente.ordenTelaColor.create({
      data: { idOrdenTela: ot.id, idColor: colorRojo.id, idTelaColor: marino.id },
    });

    const conColor = await renglonesTela(telaFelpa.id, idOrden);
    expect(conColor).toHaveLength(1);
    expect(conColor[0]?.idTelaColor).toBe(marino.id);
    expect(conColor[0]?.cantidadAComprar).toBeCloseTo(481);

    // Se compran 480 de los 481 y se contesta «con esto queda cubierto» (el kilo de Daniel).
    await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrden],
        idsRequerimiento: conColor[0]?.idsRequerimiento ?? [],
        fechaEntrega: '2026-09-01',
        ajustes: [
          {
            tipo: 'tela',
            idMaterial: telaFelpa.id,
            idColor: marino.id,
            idProveedor: proveedor.id,
            cantidadTotal: 480,
            restoCubierto: true,
          },
        ],
      },
      bd(),
    );
    const acto = await cliente.requerimientoCubierto.findFirstOrThrow();
    expect(acto.idTelaColor).toBe(marino.id);
    expect(Number(acto.cantidad)).toBe(1);

    // Y ahora alguien quita el amarre (se capturó mal, o se va a decidir el tono al comprar).
    await cliente.ordenTelaColor.deleteMany({ where: { idOrdenTela: ot.id } });

    const sinColor = await renglonesTela(telaFelpa.id, idOrden);
    expect(sinColor).toHaveLength(1);
    expect(sinColor[0]?.idTelaColor).toBeNull();
    expect(sinColor[0]?.cantidadEnOc).toBeCloseTo(480);
    // 🔴 LOS VALORES QUE LA PONEN ROJA: `cubierta: 0` y `pendiente: 1` — el kilo persiguiéndolo
    // otra vez, que es exactamente lo que §Post-F9.99 vino a cerrar.
    expect(sinColor[0]?.cantidadCubierta).toBe(1);
    expect(sinColor[0]?.cantidadPendiente).toBe(0);
  });

  /**
   * 🔴 **LA GUARDA, MEDIDA — y por qué no es opcional** (el hallazgo del reviewer de la 0.158,
   * que aplica IGUAL aquí).
   *
   * Una tela puede emitir a la vez renglones CON color y uno SIN color: los tonos que nadie amarró
   * caen todos en el grupo `sin`. Ese renglón sin color es **una PARTE de la orden, no toda**, así
   * que darle una marca que se decidió sobre OTRO tono le bajaría el faltante sin que nadie lo
   * haya dicho — y **ese material dejaría de comprarse**. Una sobre-compra visible (el faltante
   * reaparece y se vuelve a cerrar con un clic) es mejor negocio que una sub-compra silenciosa que
   * para la producción.
   */
  it('🔴 TELA MIXTA: con un hermano CON color, la marca huérfana NO se absorbe', async () => {
    const porColor = await renglonesTela(popelina.id, idOrdenDos);
    expect(porColor).toHaveLength(2);
    const rojo = porColor.find((r) => r.idTelaColor === tcRojo.id);
    const azulRen = porColor.find((r) => r.idTelaColor === tcAzul.id);
    expect(rojo?.cantidadAComprar).toBeCloseTo(60);
    expect(azulRen?.cantidadAComprar).toBeCloseTo(40);

    // Se compran 35 de los 40 del Azul y se cierran los 5 que faltan.
    await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrdenDos],
        idsRequerimiento: azulRen?.idsRequerimiento ?? [],
        fechaEntrega: '2026-09-01',
        ajustes: [
          {
            tipo: 'tela',
            idMaterial: popelina.id,
            idColor: tcAzul.id,
            idProveedor: proveedor.id,
            cantidadTotal: 35,
            restoCubierto: true,
          },
        ],
      },
      bd(),
    );
    expect(await cliente.requerimientoCubierto.count()).toBe(1);

    // Se quita SÓLO el amarre del Azul: quedan un renglón Rojo (60) y uno sin color (40).
    const ot = await cliente.ordenTela.findFirstOrThrow({
      where: { idOrden: idOrdenDos, idTela: popelina.id },
    });
    await cliente.ordenTelaColor.deleteMany({
      where: { idOrdenTela: ot.id, idColor: azul.id },
    });

    const mixta = await renglonesTela(popelina.id, idOrdenDos);
    expect(mixta).toHaveLength(2);
    const huerfano = mixta.find((r) => r.idTelaColor === null);
    expect(huerfano?.cantidadAComprar).toBeCloseTo(40);
    // 🔴 LOS VALORES QUE LA PONEN ROJA: `cubierta: 5` y `pendiente: 35` — la marca del Azul
    // absorbida por un renglón que no es sólo Azul, y 5 metros que ya no se comprarían nunca.
    expect(huerfano?.cantidadCubierta).toBe(0);
    expect(huerfano?.cantidadEnOc).toBe(0);
    expect(huerfano?.cantidadPendiente).toBe(40);
    // Y el hermano Rojo sigue intacto: la marca de otro tono no le toca nada.
    expect(mixta.find((r) => r.idTelaColor === tcRojo.id)?.cantidadPendiente).toBe(60);
  });

  it('🔴 TELA MIXTA: «volver a pedirlo» tampoco cancela la marca de otro tono', async () => {
    // La otra mitad de la guarda: si el deshacer absorbiera lo que la lectura NO absorbe, un clic
    // en el renglón sin color reabriría un faltante que su dueño (el renglón Azul) no pidió abrir.
    const porColor = await renglonesTela(popelina.id, idOrdenDos);
    const azulRen = porColor.find((r) => r.idTelaColor === tcAzul.id);
    await generarOCDesdeExplosion(
      sesion(),
      {
        idsOrden: [idOrdenDos],
        idsRequerimiento: azulRen?.idsRequerimiento ?? [],
        fechaEntrega: '2026-09-01',
        ajustes: [
          {
            tipo: 'tela',
            idMaterial: popelina.id,
            idColor: tcAzul.id,
            idProveedor: proveedor.id,
            cantidadTotal: 35,
            restoCubierto: true,
          },
        ],
      },
      bd(),
    );
    const ot = await cliente.ordenTela.findFirstOrThrow({
      where: { idOrden: idOrdenDos, idTela: popelina.id },
    });
    await cliente.ordenTelaColor.deleteMany({ where: { idOrdenTela: ot.id, idColor: azul.id } });

    const mixta = await renglonesTela(popelina.id, idOrdenDos);
    const huerfano = mixta.find((r) => r.idTelaColor === null);
    const deshecho = await darPorCubierto(
      sesion(),
      { idsRequerimiento: huerfano?.idsRequerimiento ?? [], cubierto: false },
      bd(),
    );
    // 🔴 El valor que la pone roja: un afectado de 5 — la marca del Azul cancelada por un renglón
    // que no es su dueño.
    expect(deshecho.afectados).toEqual([]);
    const acto = await cliente.requerimientoCubierto.findFirstOrThrow();
    expect(acto.canceladoEn).toBeNull();
  });
});
