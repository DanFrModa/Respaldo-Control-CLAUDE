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
