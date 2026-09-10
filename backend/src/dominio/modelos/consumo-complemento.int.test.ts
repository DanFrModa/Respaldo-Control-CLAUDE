/**
 * ⭐⭐ 0.156 (§Post-F9.214 / §Post-F9.219) — **EL CONSUMO DEL COMPLEMENTO, DE PUNTA A PUNTA.**
 *
 * DANIEL, corrigiendo una clasificación mal hecha del lead: *«sí es importante meterlo como
 * complemento porque hay proveedores que así lo manejan y para el control de la tela siempre es
 * mejor ponerla como un complemento de su tela»*. Y antes, mirando la receta: *«no se ve el campo
 * de la segunda tela para meter la info. Sólo se ve el campo de la tela principal»*.
 *
 * El hueco era una CADENA rota, no un campo: la TELA declaraba su complemento
 * (`Tela.nombreComplemento`) y la COMPRA lo exigía (`exigirComplementosCapturados`), pero la RECETA
 * guardaba **un solo consumo por tela** — así que cada OC que generaba la explosión nacía con el
 * cárdigan PENDIENTE y alguien lo tecleaba a mano, orden por orden.
 *
 * Esta batería recorre la cadena entera contra Postgres, porque cada eslabón es un salto de tabla
 * que ninguna prueba pura puede ver:
 *   1. la receta del MODELO lo guarda y lo devuelve (con el nombre que le da el catálogo);
 *   2. no se puede capturar en una tela que NO lleva complemento (el catálogo manda);
 *   3. cambiar SÓLO el complemento se persiste (el diff del set-completo lo mira);
 *   4. copiar la receta se lo lleva;
 *   5. crear la orden lo CONGELA (`OrdenTela`) — sin esto el MRP nunca lo vería;
 *   6. la OC que genera la explosión nace con la cantidad puesta **y se puede autorizar**;
 *   7. sin capturar, todo sigue exactamente como antes (REGLA 0-B: funciona cuando el dato falta);
 *   8. si el catálogo le quita el complemento a la tela DESPUÉS de congelar, la generación no se
 *      rompe: no se pide complemento.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Cliente,
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
import { ErrorConflicto, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrarRecetaDeOrden } from '../../pruebas/receta.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { autorizarOC } from '../compras/ordenes-compra.js';
import {
  explosionarOrden,
  generarOCDesdeExplosion,
  previoCompraDesdeExplosion,
} from '../compras/mrp.js';
import {
  agregarRenglonReceta,
  copiarRecetaDelModelo,
  restaurarRenglonReceta,
  traerDelModelo,
} from '../produccion/receta-orden.js';
import { copiarBom, listarTelasBom, reemplazarTelasBom } from './bom-modelo.js';
import { copiarRecetaAModeloNuevo } from './versiones.js';

let cliente: PrismaClient;
let empresa: Empresa;
let clienteNegocio: Cliente;
let modelo: Modelo;
let felpa: Tela; // CON complemento ("Cardigan")
let forro: Tela; // SIN complemento
let proveedorTelas: Proveedor;
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;

const PERM: ClavePermiso[] = [
  'modelos.ver',
  'modelos.administrar',
  'compras.ver',
  'compras.administrar',
  'compras.autorizar',
  // Las tres puertas de la receta de la ORDEN (agregar / restaurar / traer del modelo) piden esto.
  'ordenes.ver',
  'desarrollo.ver',
  'desarrollo.administrar',
];

const sesion = (): SesionUsuario => sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM });
const bd = () => ({ cliente });

/** Orden de 30 piezas (Rojo: CH 10 + M 20) con su receta ya congelada desde el BOM del modelo. */
async function crearOrdenConReceta(folio = 1n): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio,
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNegocio.id,
      estado: 'completa',
      fechaCompletada: new Date(),
      fechaEntrega: new Date('2026-10-30T00:00:00.000Z'),
      lineas: {
        create: [
          {
            idColor: colorRojo.id,
            tallas: {
              create: [
                { idTalla: tallaCH.id, cantidad: 10 },
                { idTalla: tallaM.id, cantidad: 20 },
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

/** Guarda la receta del modelo con UNA tela (la felpa) y el consumo de complemento que se le pase. */
async function recetaConFelpa(consumoComplemento: number | null): Promise<void> {
  await reemplazarTelasBom(
    sesion(),
    modelo.id,
    [{ idTela: felpa.id, consumoPorPrenda: 1.2, consumoComplementoPorPrenda: consumoComplemento }],
    bd(),
  );
}

/** Genera las OC de la orden y devuelve sus líneas (una por material comprado). */
async function generarYLeerLineas(idOrden: number) {
  await explosionarOrden(sesion(), idOrden, bd());
  const resultado = await generarOCDesdeExplosion(
    sesion(),
    { fechaEntrega: '2026-10-30', idsOrden: [idOrden], idsRequerimiento: [] },
    bd(),
  );
  const ids = resultado.ordenesCompra.map((oc) => oc.idOrdenCompra);
  const lineas = await cliente.ordenCompraLinea.findMany({
    where: { idOrdenCompra: { in: ids } },
    orderBy: { id: 'asc' },
  });
  return { resultado, lineas, ids };
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
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  // §Post-F9.18: la OC generada toma la dirección FAVORITA del catálogo (sin ella, se bloquea).
  await cliente.direccionEntrega.create({
    data: { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123', favorita: true },
  });
  proveedorTelas = await cliente.proveedor.create({ data: { nombre: 'Telas del Norte' } });

  // La felpa lleva su cárdigan (lo dice el CATÁLOGO) y tiene DUEÑO, que es lo que le da proveedor
  // sugerido en la explosión (§Post-F9.82) y hace que llegue a nacer una OC.
  felpa = await cliente.tela.create({
    data: {
      nombre: 'Felpa 50/50',
      unidadMedida: 'KG',
      nombreComplemento: 'Cardigan',
      idProveedor: proveedorTelas.id,
      precioSugerido: 90,
    },
  });
  forro = await cliente.tela.create({
    data: { nombre: 'Forro', unidadMedida: 'M', idProveedor: proveedorTelas.id },
  });

  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Sudadera' } });
});

describe('La receta del modelo guarda el consumo del complemento (0.156)', () => {
  it('lo guarda, lo devuelve y dice cómo se llama según el catálogo', async () => {
    const salida = await reemplazarTelasBom(
      sesion(),
      modelo.id,
      [{ idTela: felpa.id, consumoPorPrenda: 1.2, consumoComplementoPorPrenda: 0.15 }],
      bd(),
    );

    expect(salida).toHaveLength(1);
    expect(salida[0]?.consumoPorPrenda).toBeCloseTo(1.2);
    expect(salida[0]?.consumoComplementoPorPrenda).toBeCloseTo(0.15);
    // El NOMBRE lo pone el catálogo, no la receta: es lo que deja a la pantalla rotular el campo
    // «Cardigan» en vez de la palabra genérica «complemento».
    expect(salida[0]?.nombreComplemento).toBe('Cardigan');

    // Y de verdad está en la base (no sólo en la respuesta que se devolvió).
    const fila = await cliente.modeloTela.findUniqueOrThrow({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: felpa.id } },
    });
    expect(fila.consumoComplementoPorPrenda?.toNumber()).toBeCloseTo(0.15);

    // Y la lectura suelta (el GET de la sección) lo trae igual.
    const leido = await listarTelasBom(sesion(), modelo.id, bd());
    expect(leido[0]?.consumoComplementoPorPrenda).toBeCloseTo(0.15);
  });

  it('omitirlo lo deja en NULL: nadie está obligado a capturarlo', async () => {
    await reemplazarTelasBom(
      sesion(),
      modelo.id,
      [{ idTela: felpa.id, consumoPorPrenda: 1.2 }],
      bd(),
    );
    const fila = await cliente.modeloTela.findUniqueOrThrow({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: felpa.id } },
    });
    expect(fila.consumoComplementoPorPrenda).toBeNull();
  });

  it('RECHAZA capturarlo en una tela que no lleva complemento, y no escribe nada', async () => {
    // 🔑 Quién lleva complemento lo dice el CATÁLOGO; cuánto lleva, la receta. Sin esta guarda el
    // número viajaría congelado hasta la orden y reventaría la creación de la OC en `validarLineas`
    // —con un error sobre una orden de compra que el usuario no estaba haciendo—.
    await expect(
      reemplazarTelasBom(
        sesion(),
        modelo.id,
        [{ idTela: forro.id, consumoPorPrenda: 1, consumoComplementoPorPrenda: 0.2 }],
        bd(),
      ),
    ).rejects.toThrow(ErrorValidacion);
    expect(await cliente.modeloTela.count({ where: { idModelo: modelo.id } })).toBe(0);
  });

  it('cambiar SÓLO el complemento se persiste (el diff del set-completo lo mira)', async () => {
    // 🔴 Sin el término del complemento en el diff, este guardado no tenía NADA que actualizar: la
    // pantalla decía «guardado» y el número se quedaba en el anterior, en silencio.
    await recetaConFelpa(0.15);
    await recetaConFelpa(0.3);
    const fila = await cliente.modeloTela.findUniqueOrThrow({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: felpa.id } },
    });
    expect(fila.consumoComplementoPorPrenda?.toNumber()).toBeCloseTo(0.3);

    // Y borrarlo (dejarlo en blanco) también es un cambio: el set-completo no conserva lo que no
    // viene.
    await recetaConFelpa(null);
    const despues = await cliente.modeloTela.findUniqueOrThrow({
      where: { idModelo_idTela: { idModelo: modelo.id, idTela: felpa.id } },
    });
    expect(despues.consumoComplementoPorPrenda).toBeNull();
  });

  it('copiar la receta de otro modelo se lleva el complemento', async () => {
    await recetaConFelpa(0.15);
    const destino = await cliente.modelo.create({
      data: { codigo: 'A-200', descripcion: 'Sudadera niño' },
    });
    await copiarBom(sesion(), destino.id, { idOrigen: modelo.id }, bd());
    const copiada = await cliente.modeloTela.findUniqueOrThrow({
      where: { idModelo_idTela: { idModelo: destino.id, idTela: felpa.id } },
    });
    expect(copiada.consumoComplementoPorPrenda?.toNumber()).toBeCloseTo(0.15);
  });
});

describe('La orden CONGELA el consumo del complemento (0.156)', () => {
  it('copiar la receta del modelo a la orden lo trae (sin esto el MRP nunca lo vería)', async () => {
    await recetaConFelpa(0.15);
    const orden = await cliente.orden.create({
      data: {
        folio: 7n,
        idEmpresa: empresa.id,
        idModelo: modelo.id,
        idCliente: clienteNegocio.id,
        estado: 'capturada',
      },
    });
    await copiarRecetaDelModelo(cliente, sesion(), {
      id: orden.id,
      idEmpresa: empresa.id,
      idModelo: modelo.id,
    });
    const congelada = await cliente.ordenTela.findFirstOrThrow({
      where: { idOrden: orden.id, idTela: felpa.id },
    });
    expect(congelada.consumoPorPrenda.toNumber()).toBeCloseTo(1.2);
    expect(congelada.consumoComplementoPorPrenda?.toNumber()).toBeCloseTo(0.15);
  });

  /**
   * ⭐⭐ **LAS CINCO PUERTAS, UNA POR UNA.** El complemento sólo llega a la orden si TODAS las
   * copias del modelo lo llevan, y cada una es un `create`/`update` que enumera sus campos a mano:
   * omitirlo no rompe nada —Prisma escribe NULL— y el cárdigan **se pierde en silencio**.
   *
   * 🔴 Así se coló la QUINTA (`versiones.ts::copiarRecetaAModeloNuevo`) en la primera vuelta de esta
   * fila: el reviewer destripó tres de las otras cuatro **a la vez** y la suite entera se quedó en
   * verde. Por eso cada puerta tiene aquí su propia prueba, y no una que las cubra «de paso».
   */

  /** Deja la orden SIN el renglón de la felpa, para poder volver a meterlo por una puerta. */
  async function quitarLaFelpaDeLaOrden(idOrden: number): Promise<void> {
    await cliente.ordenTela.deleteMany({ where: { idOrden, idTela: felpa.id } });
  }

  /** El consumo de complemento congelado en la orden para la felpa (null = no llegó). */
  async function complementoCongelado(idOrden: number): Promise<number | null> {
    const fila = await cliente.ordenTela.findFirstOrThrow({
      where: { idOrden, idTela: felpa.id },
    });
    return fila.consumoComplementoPorPrenda === null
      ? null
      : fila.consumoComplementoPorPrenda.toNumber();
  }

  it('PUERTA 2 · AGREGAR el renglón a la receta de la orden lo hereda del modelo', async () => {
    await recetaConFelpa(0.15);
    const idOrden = await crearOrdenConReceta();
    await quitarLaFelpaDeLaOrden(idOrden);

    await agregarRenglonReceta(
      sesion(),
      idOrden,
      { tipo: 'tela', idTela: felpa.id, consumoPorPrenda: 1.2 },
      bd(),
    );

    // El cuerpo lo trajo el cuerpo del PATCH; el complemento sólo puede venir del BOM (H5 del
    // encabezado de `receta-orden.ts`: lo que el cuerpo no dice, se hereda del modelo).
    expect(await complementoCongelado(idOrden)).toBeCloseTo(0.15);
  });

  it('PUERTA 3 · RESTAURAR pisa el complemento con lo que dice el modelo HOY', async () => {
    await recetaConFelpa(0.15);
    const idOrden = await crearOrdenConReceta();
    // Alguien dejó la orden con OTRO número (o sin él): restaurar promete traer el del modelo.
    const renglon = await cliente.ordenTela.findFirstOrThrow({
      where: { idOrden, idTela: felpa.id },
      select: { id: true },
    });
    await cliente.ordenTela.update({
      where: { id: renglon.id },
      data: { consumoComplementoPorPrenda: null },
    });

    await restaurarRenglonReceta(sesion(), idOrden, 'tela', renglon.id, bd());

    // Restaurar es «déjalo como el modelo», y el modelo dice 0.15. Dejarlo en NULL habría hecho que
    // el renglón restaurado NO fuera el del modelo — lo único que ese botón promete.
    expect(await complementoCongelado(idOrden)).toBeCloseTo(0.15);
  });

  it('PUERTA 4 · TRAER DEL MODELO lo trae con todo lo suyo, complemento incluido', async () => {
    await recetaConFelpa(0.15);
    const idOrden = await crearOrdenConReceta();
    await quitarLaFelpaDeLaOrden(idOrden);

    await traerDelModelo(sesion(), idOrden, {}, bd());

    expect(await complementoCongelado(idOrden)).toBeCloseTo(0.15);
  });

  it('🔴 PUERTA 5 · COPIAR LA RECETA A UN MODELO NUEVO (versión / «copiar un modelo ya desarrollado»)', async () => {
    // 🔴 LA QUE SE ESCAPÓ EN LA PRIMERA VUELTA. Sus dos llamadores son reales
    // (`crearVersionDeModelo` y `desarrollo/modelo-en-la-mesa.ts`): sin esto el modelo nuevo nace
    // sin cárdigan y **sus órdenes vuelven a nacer con el complemento pendiente**, en silencio.
    await recetaConFelpa(0.15);
    const hijo = await cliente.modelo.create({
      data: { codigo: 'A-100-V2', descripcion: 'Sudadera v2' },
    });

    await copiarRecetaAModeloNuevo(cliente, sesion(), modelo.id, hijo.id);

    const heredada = await cliente.modeloTela.findUniqueOrThrow({
      where: { idModelo_idTela: { idModelo: hijo.id, idTela: felpa.id } },
    });
    expect(heredada.consumoPorPrenda.toNumber()).toBeCloseTo(1.2);
    expect(heredada.consumoComplementoPorPrenda?.toNumber()).toBeCloseTo(0.15);
  });
});

describe('La OC del MRP ya no nace con el complemento pendiente (0.156)', () => {
  it('calcula la cantidad del cárdigan y deja AUTORIZAR la orden de compra', async () => {
    await recetaConFelpa(0.15);
    const idOrden = await crearOrdenConReceta();

    const { lineas, ids } = await generarYLeerLineas(idOrden);

    // Cuerpo: 1.2 kg × 30 pz = 36 kg. Razón 0.15/1.2 = 0.125 ⇒ cárdigan 4.5 kg.
    expect(lineas).toHaveLength(1);
    expect(lineas[0]?.cantidad.toNumber()).toBeCloseTo(36);
    expect(lineas[0]?.cantidadComplemento?.toNumber()).toBeCloseTo(4.5);

    // 🔑 LA PRUEBA DE QUE LA FILA SIRVE PARA ALGO: antes de ella, esto tronaba con
    // «Falta la cantidad de Cardigan…» y había que teclearla a mano, orden por orden.
    await expect(autorizarOC(sesion(), ids[0] as number, bd())).resolves.toBeDefined();
  });

  it('🔑 LA PREVIA PROMETE EL MISMO TOTAL QUE LA OC GUARDA (el cárdigan también cuesta)', async () => {
    // ⭐ §Post-F9.85: *«una revisión previa que no fuera el mismo cálculo sería una promesa que el
    // sistema no cumple»*. El subtotal de una línea de OC es
    // `cantidad × precio + complemento × (precioComplemento ?? precio)`, así que en cuanto el
    // cárdigan deja de nacer en NULL, el importe de la previa TIENE que incluirlo. Si el
    // complemento se calculara en la generación en vez de en el plan, la previa prometería menos
    // dinero del que la orden acabaría pidiendo — y nadie lo vería hasta abrir la OC.
    await recetaConFelpa(0.15);
    const idOrden = await crearOrdenConReceta();
    await explosionarOrden(sesion(), idOrden, bd());

    const previa = await previoCompraDesdeExplosion(
      sesion(),
      { fechaEntrega: '2026-10-30', idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    const renglonPrevia = previa.proveedores[0]?.renglones[0];
    expect(renglonPrevia?.porOrden[0]?.cantidadComplemento).toBeCloseTo(4.5);
    // 🔑 Y EL NOMBRE, que es lo que deja a la pantalla explicar la diferencia. Sin él, la previa
    // sigue cobrando el cárdigan pero **deja de decir de qué es**: la última pantalla antes de
    // comprometer el dinero enseñaría una cuenta inexplicada. Lo dice el CATÁLOGO, no la UI.
    expect(renglonPrevia?.nombreComplemento).toBe('Cardigan');

    const resultado = await generarOCDesdeExplosion(
      sesion(),
      { fechaEntrega: '2026-10-30', idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    // El total prometido y el guardado son EL MISMO número, cárdigan incluido.
    expect(resultado.ordenesCompra[0]?.total).toBeCloseTo(previa.proveedores[0]?.total ?? -1);
    // Y no es una coincidencia por valer cero: 36 kg × $90 + 4.5 kg × $90 = 3,645.
    expect(previa.proveedores[0]?.total).toBeCloseTo(3645);
  });

  it('SIN capturar el complemento, todo sigue como antes: nace pendiente y autorizar lo exige', async () => {
    // REGLA 0-B — la pregunta que sí vale: «¿esto funciona bien cuando el dato NO está?». Sí: se
    // comporta exactamente como el sistema de ayer, sin inventar cantidades.
    await recetaConFelpa(null);
    const idOrden = await crearOrdenConReceta();

    const { lineas, ids } = await generarYLeerLineas(idOrden);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]?.cantidadComplemento).toBeNull();
    await expect(autorizarOC(sesion(), ids[0] as number, bd())).rejects.toThrow(ErrorConflicto);
  });

  it('si el catálogo le QUITA el complemento a la tela, la generación no se rompe ni lo pide', async () => {
    // 🔴 La puerta que evita romper la generación entera: el número quedó congelado en la orden,
    // pero el catálogo ya dice que esa tela no lleva complemento. Mandarlo haría que
    // `validarLineas` rechazara la OC completa —incluidas sus otras líneas—.
    await recetaConFelpa(0.15);
    const idOrden = await crearOrdenConReceta();
    await cliente.tela.update({ where: { id: felpa.id }, data: { nombreComplemento: null } });

    const { lineas, ids } = await generarYLeerLineas(idOrden);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]?.cantidadComplemento).toBeNull();
    await expect(autorizarOC(sesion(), ids[0] as number, bd())).resolves.toBeDefined();
  });

  it('con el consumo del CUERPO en cero no hay razón que aplicar: se deja pendiente', async () => {
    // Una razón necesita un denominador. En vez de dividir entre cero (o inventar un número), se
    // deja pendiente y `autorizarOC` lo pide, que es la conducta segura.
    await recetaConFelpa(0.15);
    const idOrden = await crearOrdenConReceta();
    await cliente.ordenTela.updateMany({
      where: { idOrden, idTela: felpa.id },
      data: { consumoPorPrenda: 0 },
    });

    await explosionarOrden(sesion(), idOrden, bd());
    const resultado = await generarOCDesdeExplosion(
      sesion(),
      { fechaEntrega: '2026-10-30', idsOrden: [idOrden], idsRequerimiento: [] },
      bd(),
    );
    // Con consumo 0 no hay nada que comprar: la explosión no genera OC. Lo que se comprueba es que
    // no truena (que era el riesgo de una división entre cero colada hasta la línea).
    expect(resultado.ordenesCompra).toHaveLength(0);
  });
});
