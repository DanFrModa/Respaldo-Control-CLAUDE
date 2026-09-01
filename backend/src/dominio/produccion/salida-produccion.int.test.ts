/**
 * Tests de INTEGRACIÓN de la SALIDA A PRODUCCIÓN (rediseño R3, B4) contra el Postgres efímero
 * (testcontainers). Cubre lo que pidió la ficha:
 *  • ⭐⭐ **V1-E3 (§Post-F9.172(b)): UN MODELO DE PRODUCCIÓN POR COLOR.** Cuatro OC de cuatro colores
 *    del mismo desarrollo dan **cuatro modelos**, cada uno con su nº de 5 dígitos, **compartiendo
 *    UNA receta** — y el desarrollo se queda intacto y en su catálogo. Con el color repetido se
 *    REUSA el modelo que ya existe (*«se reúsa cuando sea el mismo modelo»*), que es también la
 *    IDEMPOTENCIA del doble clic — y se prueba **llamando dos veces**, no razonando.
 *  • 🔴 la RAMA LEGADO: un renglón que ya apunta a un modelo de PRODUCCIÓN (los ~4,987 migrados del
 *    Access) genera su OP con él, sin que nazca nada,
 *  • SNAPSHOT `Pedido.ocCliente` → `Orden.ocCliente` (B3: editar el pedido después NO re-escribe),
 *  • LIGA `DesarrolloOrden` (núcleo de F8-E6) — y OP sin liga cuando el renglón no tiene desarrollo,
 *  • EVENTO outbox `orden-creada` encolado en la MISMA tx (B5),
 *  • modo MIGRACIÓN (`crearOrdenMigrada`) NO encola ni mintea,
 *  • TRANSACCIONALIDAD (A2): matriz inválida → rollback total (ni orden, ni liga, ni promoción, ni evento),
 *  • referencias del cliente (D7) capturadas en la misma operación.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { crearOrdenMigrada } from './migracion.js';
import { salidaAProduccion } from './salida-produccion.js';

let cliente: PrismaClient;
let idEmpresa: number;
let idClienteNegocio: number;
let idColor: number;
/** Los otros tres colores del caso de Daniel (Azul/Negro/Blanco). */
let otrosColores: number[];
let idTalla: number;
let idTipoProducto: number;
let idGenero: number;

const PERMISOS: ClavePermiso[] = [
  'ordenes.ver',
  'ordenes.administrar',
  'pedidos.ver',
  'pedidos.administrar',
  'pedidos.importes',
];

const sesion = (): SesionUsuario =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: [...PERMISOS] });
const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});
afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  const empresa = await crearEmpresaPrueba(cliente);
  idEmpresa = empresa.id;
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'C&A' } });
  idClienteNegocio = clienteNegocio.id;
  const color = await cliente.color.create({ data: { nombre: 'Rojo' } });
  idColor = color.id;
  // V1-E3: los colores del caso de Daniel — cuatro OC, cuatro colores, cuatro modelos.
  otrosColores = [];
  for (const nombre of ['Azul', 'Negro', 'Blanco']) {
    const otro = await cliente.color.create({ data: { nombre } });
    otrosColores.push(otro.id);
  }
  const talla = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  idTalla = talla.id;
  // Dígitos de la nomenclatura (§Post-F9.34): pantalón (7) + caballero (1) → serie 71.
  const tipo = await cliente.tipoProducto.create({
    data: { nombre: 'Pantalón', digitoConcepto: 7 },
  });
  idTipoProducto = tipo.id;
  const genero = await cliente.genero.create({
    data: { nombre: 'Caballero', digitoNomenclatura: 1, digitoAlterno: 5 },
  });
  idGenero = genero.id;
});

/** Crea modelo + desarrollo (proyecto/departamento del cliente) y un pedido con un renglón. */
async function sembrarPedidoConDesarrollo(opciones: {
  codigoModelo: string;
  ocCliente?: string | null;
  conDesarrollo?: boolean;
  /** `desarrollo` (default) = el modelo todavía NO tiene nº de producción y la OP se lo asigna. */
  origen?: 'desarrollo' | 'produccion';
}): Promise<{ idModelo: number; idDesarrollo: number | null; idPedido: number; idLinea: number }> {
  // El modelo nace CUMPLIENDO los requisitos del estado automático de la orden
  // (`requisitos-orden.ts`): receta de avíos de producción y `llevaArte: false` (prenda lisa), para
  // que la OP que salga a producción con su matriz nazca `completa` como espera esta prueba.
  const esDesarrollo = (opciones.origen ?? 'desarrollo') === 'desarrollo';
  const modelo = await cliente.modelo.create({
    data: {
      codigo: opciones.codigoModelo,
      descripcion: 'Playera',
      llevaArte: false,
      origen: esDesarrollo ? 'desarrollo' : 'produccion',
      ...(esDesarrollo
        ? { codigoDesarrollo: opciones.codigoModelo, idTipoProducto, idGenero }
        : {}),
    },
  });
  const avio = await cliente.avio.create({
    data: { clave: `AV-${opciones.codigoModelo}`, descripcion: 'Hilo' },
  });
  await cliente.modeloAvio.create({
    data: { idModelo: modelo.id, idAvio: avio.id, consumoPorPrenda: 1, paraProduccion: true },
  });
  let idDesarrollo: number | null = null;
  if (opciones.conDesarrollo !== false) {
    const depto = await cliente.clienteDepartamento.create({
      data: { idCliente: idClienteNegocio, nombre: `Niños ${opciones.codigoModelo}` },
    });
    const proyecto = await cliente.proyecto.create({
      data: {
        folio: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
        idEmpresa,
        idCliente: idClienteNegocio,
        idClienteDepartamento: depto.id,
        nombre: 'Joggers PV26',
      },
    });
    const desarrollo = await cliente.desarrollo.create({
      data: { idProyecto: proyecto.id, idModelo: modelo.id, numeroCliente: 'CA-KM-114' },
    });
    idDesarrollo = desarrollo.id;
  }
  const pedido = await cliente.pedido.create({
    data: {
      folio: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
      idEmpresa,
      idCliente: idClienteNegocio,
      ocCliente: opciones.ocCliente ?? null,
      fechaHasta: new Date('2026-08-15T00:00:00.000Z'),
    },
  });
  const linea = await cliente.pedidoLinea.create({
    data: {
      idPedido: pedido.id,
      idModelo: modelo.id,
      cantidadPedida: 100,
      precio: 148,
      idDesarrollo,
    },
  });
  return { idModelo: modelo.id, idDesarrollo, idPedido: pedido.id, idLinea: linea.id };
}

/** Matriz mínima válida (Rojo/CH con `cantidad`). */
const matriz = (cantidad = 100) => [{ idColor, tallas: [{ idTalla, cantidad }] }];

/** Matriz de UN color concreto (V1-E3: cada OC del cliente trae el suyo). */
const matrizDe = (color: number, cantidad = 100) => [
  { idColor: color, tallas: [{ idTalla, cantidad }] },
];

describe('salidaAProduccion (R3, B4)', () => {
  it('crea la OP con matriz, snapshot de la OC, liga al desarrollo, mintea el nº y encola el evento', async () => {
    const { idModelo, idDesarrollo, idLinea } = await sembrarPedidoConDesarrollo({
      codigoModelo: 'DEV-114',
      ocCliente: 'OC-CA-4471',
    });

    const resultado = await salidaAProduccion(sesion(), idLinea, { lineas: matriz() }, bd());

    // La orden nació con su matriz y el SNAPSHOT de la OC del cliente (B3).
    expect(resultado.orden.idPedidoLinea).toBe(idLinea);
    expect(resultado.orden.totalPiezas).toBe(100);
    // V1-E3d (§Post-F9.43): la OP nace `capturada` — su receta acaba de copiarse del modelo y
    // Desarrollo todavía no la libera. Ése es el control nuevo, no una regresión.
    expect(resultado.orden.estado).toBe('capturada');
    expect(resultado.orden.requisitos.faltantes).toEqual(['receta']);
    expect(resultado.orden.ocCliente).toBe('OC-CA-4471');
    // La OP hereda la ventana de entrega del pedido (fechaHasta).
    expect(resultado.orden.fechaEntrega).toBe('2026-08-15');

    // Liga al desarrollo (núcleo F8-E6).
    expect(resultado.ligaCreada).toBe(true);
    expect(resultado.idDesarrollo).toBe(idDesarrollo);
    const liga = await cliente.desarrolloOrden.findUnique({
      where: { idOrden: resultado.orden.id },
    });
    expect(liga?.idDesarrollo).toBe(idDesarrollo);

    // ⭐⭐ V1-E3: NACIÓ el modelo de producción de ese color. Esto es lo que Daniel echó de menos
    // en la OP 5558 (la OP se quedaba con el modelo de desarrollo) — y desde §Post-F9.172(b) el que
    // entra a producción es un modelo NUEVO por color, no el desarrollo transformado.
    expect(resultado.modeloDeProduccion).toBe('nacido');
    // Serie 71 (pantalón + caballero) sin nada ocupado → el primer libre es el 001.
    expect(resultado.numeroProduccion).toBe(71_001);
    expect(resultado.codigoModeloProduccion).toBe('71001');
    expect(resultado.idModeloDesarrollo).toBe(idModelo);
    expect(resultado.codigoModeloDesarrollo).toBe('DEV-114');
    expect(resultado.avisosNumeroProduccion).toEqual([]);

    // 🔴 EL DESARROLLO NO SE TOCA — es lo único que permite que de él salgan cuatro modelos.
    const padre = await cliente.modelo.findUnique({ where: { id: idModelo } });
    expect(padre?.origen).toBe('desarrollo');
    expect(padre?.codigo).toBe('DEV-114');
    expect(padre?.numeroProduccion).toBeNull();
    expect(padre?.codigoDesarrollo).toBe('DEV-114');

    // …y el HIJO nace en producción, con su número, su color y apuntando al padre.
    const hijo = await cliente.modelo.findUniqueOrThrow({
      where: { id: resultado.idModeloProduccion },
    });
    expect(hijo.origen).toBe('produccion');
    expect(hijo.codigo).toBe('71001');
    expect(hijo.numeroProduccion).toBe(71_001);
    expect(hijo.idModeloDesarrollo).toBe(idModelo);
    expect(hijo.idColor).toBe(idColor);
    // El código de desarrollo NO se copia (es `@unique` y sigue siendo del padre, D3).
    expect(hijo.codigoDesarrollo).toBeNull();

    // 🔴 Y LA ORDEN LLEVA EL HIJO, mientras el RENGLÓN sigue apuntando a su desarrollo.
    const ordenBd = await cliente.orden.findUniqueOrThrow({ where: { id: resultado.orden.id } });
    expect(ordenBd.idModelo).toBe(hijo.id);
    const renglon = await cliente.pedidoLinea.findUniqueOrThrow({ where: { id: idLinea } });
    expect(renglon.idModelo).toBe(idModelo);

    // ⭐ LA RECETA ES COMPARTIDA, no copiada: la OP del hijo nace con el avío del PADRE, aunque el
    // hijo no tenga ni una fila de `ModeloAvio` propia (resolver de V1-E9b).
    expect(await cliente.modeloAvio.count({ where: { idModelo: hijo.id } })).toBe(0);
    expect(await cliente.ordenAvio.count({ where: { idOrden: resultado.orden.id } })).toBe(1);

    // Evento outbox `orden-creada` en la MISMA tx (B5).
    const eventos = await cliente.eventoOutbox.findMany({ where: { tipo: 'orden-creada' } });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.payload).toMatchObject({ idOrden: resultado.orden.id, idEmpresa });
  });

  /**
   * ⭐⭐ **LA IDEMPOTENCIA, PROBADA LLAMANDO DOS VECES** (no razonando). Antes de V1-E3 el freno del
   * doble clic era un EFECTO DE BORDE —la 1ª salida promovía el modelo, así que la 2ª ya no
   * entraba—; con el linaje el desarrollo se queda en `desarrollo` para siempre, así que sin el
   * reuso *cada* llamada derivaría y dos clics quemarían dos de los 999 números del par.
   */
  it('la 2ª salida del MISMO renglón y MISMO color (resurtido) REUSA el modelo: 2 OPs, 1 modelo', async () => {
    const { idLinea, idDesarrollo, idModelo } = await sembrarPedidoConDesarrollo({
      codigoModelo: 'DEV-115',
    });

    const primera = await salidaAProduccion(sesion(), idLinea, { lineas: matriz(60) }, bd());
    const segunda = await salidaAProduccion(sesion(), idLinea, { lineas: matriz(40) }, bd());

    expect(primera.modeloDeProduccion).toBe('nacido');
    expect(primera.numeroProduccion).toBe(71_001);
    // La 2ª OP NO estrena modelo ni número: lleva el MISMO que ya existía para ese color.
    expect(segunda.modeloDeProduccion).toBe('reusado');
    expect(segunda.numeroProduccion).toBe(71_001);
    expect(segunda.idModeloProduccion).toBe(primera.idModeloProduccion);
    // 🔴 Y de verdad hay UN solo hijo en la base (la aserción que cae si el reuso se rompe).
    expect(await cliente.modelo.count({ where: { idModeloDesarrollo: idModelo } })).toBe(1);
    // Un desarrollo tiene N órdenes (resurtidos): ambas OPs quedan ligadas al MISMO desarrollo.
    expect(segunda.ligaCreada).toBe(true);
    expect(
      await cliente.desarrolloOrden.count({ where: { idDesarrollo: idDesarrollo ?? 0 } }),
    ).toBe(2);
  });

  /**
   * ⭐⭐⭐ **EL CASO DE DANIEL, ENTERO**: cuatro órdenes de compra del cliente para cuatro colores del
   * mismo modelo ⇒ **cuatro modelos de producción**, uno por color, cada uno con su número de 5
   * dígitos, y **UNA SOLA RECETA**, la del desarrollo del que salieron.
   *
   * Va por CUATRO renglones (que es como llega: un PDF de C&A = un renglón = una OP) y comprueba
   * las tres mitades del resultado: los cuatro números, el desarrollo intacto, y que las cuatro
   * OPs leen la receta del padre sin que ninguno de los hijos tenga receta propia.
   */
  it('⭐⭐⭐ cuatro OC de cuatro colores → CUATRO modelos de producción y UNA receta', async () => {
    const { idModelo, idPedido, idLinea } = await sembrarPedidoConDesarrollo({
      codigoModelo: 'DEV-CYA',
    });
    const colores = [idColor, ...otrosColores];
    const lineas = [idLinea];
    for (const _ of otrosColores) {
      const otra = await cliente.pedidoLinea.create({
        data: { idPedido, idModelo, cantidadPedida: 100, precio: 148 },
      });
      lineas.push(otra.id);
    }

    const salidas = [];
    for (let i = 0; i < 4; i++) {
      salidas.push(
        await salidaAProduccion(sesion(), lineas[i]!, { lineas: matrizDe(colores[i]!) }, bd()),
      );
    }

    // Cuatro modelos DISTINTOS, con cuatro números CORRELATIVOS de la serie 71.
    expect(salidas.map((s) => s.modeloDeProduccion)).toEqual([
      'nacido',
      'nacido',
      'nacido',
      'nacido',
    ]);
    expect(salidas.map((s) => s.numeroProduccion)).toEqual([71_001, 71_002, 71_003, 71_004]);
    expect(new Set(salidas.map((s) => s.idModeloProduccion)).size).toBe(4);

    const hijos = await cliente.modelo.findMany({
      where: { idModeloDesarrollo: idModelo },
      orderBy: { numeroProduccion: 'asc' },
    });
    expect(hijos).toHaveLength(4);
    // Cada hijo con SU color, todos apuntando al mismo padre, todos en producción.
    expect(hijos.map((h) => h.idColor)).toEqual(colores);
    expect(hijos.every((h) => h.origen === 'produccion')).toBe(true);

    // 🔴 UNA SOLA RECETA: ninguno de los cuatro tiene fila propia de `ModeloAvio`…
    expect(
      await cliente.modeloAvio.count({ where: { idModelo: { in: hijos.map((h) => h.id) } } }),
    ).toBe(0);
    // …y aun así las CUATRO OPs nacieron con el avío del padre (resolver de la receta compartida).
    for (const salida of salidas) {
      expect(await cliente.ordenAvio.count({ where: { idOrden: salida.orden.id } })).toBe(1);
    }

    // Y el desarrollo sigue intacto, en su catálogo y con su código.
    const padre = await cliente.modelo.findUniqueOrThrow({ where: { id: idModelo } });
    expect(padre.origen).toBe('desarrollo');
    expect(padre.codigo).toBe('DEV-CYA');
    expect(padre.numeroProduccion).toBeNull();
  });

  /**
   * ⭐⭐ **UNA OC NUEVA DEL MISMO COLOR REUSA — y ésta es la mitad que distingue la llave (B) de la
   * (A)**. Con la llave puesta en el RENGLÓN, este caso estrenaría un número nuevo y la misma prenda
   * acabaría con DOS números de catálogo. La decisión de Daniel (*«se reúsa cuando sea el mismo
   * modelo»*) es lo que esta prueba fija.
   */
  it('⭐⭐ otro RENGLÓN (otra OC) del mismo color reusa el modelo: la prenda tiene UN número', async () => {
    const { idModelo, idPedido, idLinea } = await sembrarPedidoConDesarrollo({
      codigoModelo: 'DEV-MISMO-COLOR',
    });
    const otroRenglon = await cliente.pedidoLinea.create({
      data: { idPedido, idModelo, cantidadPedida: 50, precio: 148 },
    });

    const primera = await salidaAProduccion(sesion(), idLinea, { lineas: matriz(100) }, bd());
    const segunda = await salidaAProduccion(sesion(), otroRenglon.id, { lineas: matriz(50) }, bd());

    expect(primera.modeloDeProduccion).toBe('nacido');
    expect(segunda.modeloDeProduccion).toBe('reusado');
    expect(segunda.idModeloProduccion).toBe(primera.idModeloProduccion);
    expect(await cliente.modelo.count({ where: { idModeloDesarrollo: idModelo } })).toBe(1);
  });

  /**
   * ⭐ La matriz MULTICOLOR (el importador por EXCEL agrupa por MODELO): no hay "el color del que
   * nació", así que el hijo nace SIN color y cubre los de su matriz — igual que antes de V1-E3.
   */
  it('⭐ matriz MULTICOLOR: nace UN hijo sin color, y una 2ª salida multicolor lo REUSA', async () => {
    const { idModelo, idLinea } = await sembrarPedidoConDesarrollo({ codigoModelo: 'DEV-XLS' });
    const dosColores = [
      { idColor, tallas: [{ idTalla, cantidad: 60 }] },
      { idColor: otrosColores[0]!, tallas: [{ idTalla, cantidad: 40 }] },
    ];

    const primera = await salidaAProduccion(sesion(), idLinea, { lineas: dosColores }, bd());
    const segunda = await salidaAProduccion(sesion(), idLinea, { lineas: dosColores }, bd());

    expect(primera.modeloDeProduccion).toBe('nacido');
    expect(segunda.modeloDeProduccion).toBe('reusado');
    const hijos = await cliente.modelo.findMany({ where: { idModeloDesarrollo: idModelo } });
    expect(hijos).toHaveLength(1);
    expect(hijos[0]?.idColor).toBeNull();
  });

  it('editar la OC del pedido DESPUÉS no re-escribe el snapshot de la orden (B3)', async () => {
    const { idLinea, idPedido } = await sembrarPedidoConDesarrollo({
      codigoModelo: 'DEV-116',
      ocCliente: 'OC-ORIGINAL',
    });
    const resultado = await salidaAProduccion(sesion(), idLinea, { lineas: matriz() }, bd());

    await cliente.pedido.update({ where: { id: idPedido }, data: { ocCliente: 'OC-CAMBIADA' } });

    const orden = await cliente.orden.findUnique({ where: { id: resultado.orden.id } });
    expect(orden?.ocCliente).toBe('OC-ORIGINAL');
  });

  it('renglón SIN desarrollo pero con modelo de desarrollo: sin liga, pero el modelo del color SÍ nace', async () => {
    const { idLinea, idModelo } = await sembrarPedidoConDesarrollo({
      codigoModelo: 'LEG-001',
      conDesarrollo: false,
    });

    const resultado = await salidaAProduccion(sesion(), idLinea, { lineas: matriz() }, bd());

    expect(resultado.ligaCreada).toBe(false);
    expect(resultado.idDesarrollo).toBeNull();
    // El expediente de Desarrollo y el LINAJE del modelo son cosas distintas: sin `DesarrolloOrden`
    // el modelo del color nace igual, porque quien decide eso es el ORIGEN del modelo del renglón.
    expect(resultado.modeloDeProduccion).toBe('nacido');
    expect(resultado.idModeloDesarrollo).toBe(idModelo);
    expect(await cliente.desarrolloOrden.count()).toBe(0);
    const hijo = await cliente.modelo.findUniqueOrThrow({
      where: { id: resultado.idModeloProduccion },
    });
    expect(hijo.numeroProduccion).toBe(71_001);
  });

  /**
   * Modelo HISTÓRICO del Access (`M-18`, `51783a`): ya está en producción y su código no es
   * numérico de 5 dígitos, así que no tiene —ni estrena— número. La OP sale igual; lo que NO
   * puede pasar es que se le invente uno.
   */
  it('🔴 modelo histórico YA de producción sin nº: la OP sale, el modelo se HEREDA y nada nace', async () => {
    const { idLinea, idModelo } = await sembrarPedidoConDesarrollo({
      codigoModelo: 'M-18',
      conDesarrollo: false,
      origen: 'produccion',
    });

    const resultado = await salidaAProduccion(sesion(), idLinea, { lineas: matriz() }, bd());

    // 🔴 LA RAMA LEGADO. Sin ella, `derivarModeloDeProduccion` lanzaría 409 (exige un padre de
    // DESARROLLO) y NINGUNO de los ~4,987 migrados del Access podría generar una OP.
    expect(resultado.modeloDeProduccion).toBe('heredado');
    expect(resultado.numeroProduccion).toBeNull();
    expect(resultado.idModeloProduccion).toBe(idModelo);
    expect(resultado.idModeloDesarrollo).toBeNull();
    expect(resultado.codigoModeloDesarrollo).toBeNull();
    const modelo = await cliente.modelo.findUnique({ where: { id: idModelo } });
    expect(modelo?.codigo).toBe('M-18');
    expect(modelo?.numeroProduccion).toBeNull();
    // Nada nació: el catálogo tiene exactamente el modelo que ya tenía.
    expect(await cliente.modelo.count({ where: { idModeloDesarrollo: { not: null } } })).toBe(0);
    const orden = await cliente.orden.findUniqueOrThrow({ where: { id: resultado.orden.id } });
    expect(orden.idModelo).toBe(idModelo);
  });

  /** Un modelo de producción CON número (los 4,702 migrados de 5 dígitos): la OP lo hereda. */
  it('modelo de producción con nº de 5 dígitos: la OP HEREDA su número, sin promover', async () => {
    const { idLinea } = await sembrarPedidoConDesarrollo({
      codigoModelo: '71050',
      conDesarrollo: false,
      origen: 'produccion',
    });
    await cliente.modelo.update({
      where: { codigo: '71050' },
      data: { numeroProduccion: 71_050 },
    });

    const resultado = await salidaAProduccion(sesion(), idLinea, { lineas: matriz() }, bd());

    expect(resultado.numeroProduccion).toBe(71_050);
    expect(resultado.modeloDeProduccion).toBe('heredado');
    expect(resultado.codigoModeloProduccion).toBe('71050');
  });

  /**
   * §Post-F9.46: el nº llega precargado a la pantalla y Daniel lo puede cambiar. Si lo cambia, es
   * el suyo el que se guarda — y si además no cuadra con el tipo/género, se AVISA sin bloquear.
   */
  it('acepta el nº de producción CONFIRMADO por el usuario y avisa si los dígitos no cuadran', async () => {
    const { idLinea, idModelo } = await sembrarPedidoConDesarrollo({ codigoModelo: 'DEV-777' });

    const resultado = await salidaAProduccion(
      sesion(),
      idLinea,
      { lineas: matriz(), numeroProduccion: 52_010 },
      bd(),
    );

    expect(resultado.numeroProduccion).toBe(52_010);
    expect(resultado.avisosNumeroProduccion).toHaveLength(1);
    expect(resultado.avisosNumeroProduccion[0]).toContain('(52)');
    // El número capturado es del HIJO que nace; el desarrollo conserva su código (V1-E3).
    const hijo = await cliente.modelo.findUniqueOrThrow({
      where: { id: resultado.idModeloProduccion },
    });
    expect(hijo.codigo).toBe('52010');
    const padre = await cliente.modelo.findUniqueOrThrow({ where: { id: idModelo } });
    expect(padre.codigo).toBe('DEV-777');
  });

  /**
   * ⭐ El nº capturado cuando el color YA tiene modelo: se REUSA el suyo y el número tecleado **no se
   * usa**. Sale por `avisos` —que nunca bloquean— porque ignorarlo en silencio sería mentirle a
   * quien lo escribió, y pisárselo renombraría un modelo que ya puede tener órdenes e inventario.
   */
  it('⭐ nº capturado sobre un color que YA tiene modelo: se reusa el suyo y se AVISA', async () => {
    const { idLinea, idModelo } = await sembrarPedidoConDesarrollo({ codigoModelo: 'DEV-779' });
    const primera = await salidaAProduccion(sesion(), idLinea, { lineas: matriz(50) }, bd());

    const segunda = await salidaAProduccion(
      sesion(),
      idLinea,
      { lineas: matriz(50), numeroProduccion: 71_099 },
      bd(),
    );

    expect(segunda.modeloDeProduccion).toBe('reusado');
    expect(segunda.numeroProduccion).toBe(primera.numeroProduccion);
    expect(segunda.avisosNumeroProduccion).toHaveLength(1);
    expect(segunda.avisosNumeroProduccion[0]).toContain('71099');
    // Y no nació un segundo modelo con el número tecleado.
    expect(await cliente.modelo.count({ where: { idModeloDesarrollo: idModelo } })).toBe(1);
    expect(await cliente.modelo.count({ where: { numeroProduccion: 71_099 } })).toBe(0);
  });

  /** El número repetido SÍ bloquea, y con él se cae TODA la operación (A2): no nace la OP. */
  it('nº de producción ya ocupado: no se crea la OP ni se promueve el modelo', async () => {
    await cliente.modelo.create({
      data: { codigo: '71001', origen: 'produccion', numeroProduccion: 71_001 },
    });
    const { idLinea, idModelo } = await sembrarPedidoConDesarrollo({ codigoModelo: 'DEV-778' });

    await expect(
      salidaAProduccion(sesion(), idLinea, { lineas: matriz(), numeroProduccion: 71_001 }, bd()),
    ).rejects.toThrow();

    expect(await cliente.orden.count()).toBe(0);
    const modelo = await cliente.modelo.findUnique({ where: { id: idModelo } });
    expect(modelo?.origen).toBe('desarrollo');
    expect(modelo?.codigo).toBe('DEV-778');
    // Y no quedó ningún hijo a medias: el rollback se lleva el modelo nuevo igual que la orden.
    expect(await cliente.modelo.count({ where: { idModeloDesarrollo: idModelo } })).toBe(0);
  });

  it('captura las referencias del cliente (D7) en la misma operación', async () => {
    const { idLinea } = await sembrarPedidoConDesarrollo({ codigoModelo: 'DEV-117' });
    const campo = await cliente.clienteCampo.create({
      data: { idCliente: idClienteNegocio, etiqueta: 'Ref. Monarch' },
    });

    const resultado = await salidaAProduccion(
      sesion(),
      idLinea,
      { lineas: matriz(), referencias: [{ idClienteCampo: campo.id, valor: 'MNCH-7' }] },
      bd(),
    );

    expect(resultado.orden.referencias).toHaveLength(1);
    expect(resultado.orden.referencias[0]?.valor).toBe('MNCH-7');
  });

  it('A2: matriz inválida (color repetido) → rollback TOTAL (ni orden, ni liga, ni promoción, ni evento)', async () => {
    const { idLinea, idModelo } = await sembrarPedidoConDesarrollo({ codigoModelo: 'DEV-118' });

    await expect(
      salidaAProduccion(
        sesion(),
        idLinea,
        {
          lineas: [
            { idColor, tallas: [{ idTalla, cantidad: 50 }] },
            { idColor, tallas: [{ idTalla, cantidad: 50 }] },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    expect(await cliente.orden.count()).toBe(0);
    expect(await cliente.desarrolloOrden.count()).toBe(0);
    expect(await cliente.eventoOutbox.count({ where: { tipo: 'orden-creada' } })).toBe(0);
    const modelo = await cliente.modelo.findUnique({ where: { id: idModelo } });
    expect(modelo?.numeroProduccion).toBeNull();
    expect(modelo?.origen).toBe('desarrollo');
    expect(modelo?.codigo).toBe('DEV-118');
    // ⭐ V1-E3: el modelo del color se hace nacer DENTRO de la misma transacción, así que el
    // rollback también se lo lleva — ni modelo huérfano ni número quemado.
    expect(await cliente.modelo.count({ where: { idModeloDesarrollo: idModelo } })).toBe(0);
  });

  /**
   * 🔴 **UN COLOR QUE NO EXISTE ES UN 404 DE DOMINIO, NO UN 500.**
   *
   * Medido como REGRESIÓN de V1-E3: hasta esta etapa el id inventado lo rechazaba
   * `sincronizarMatriz` con un error limpio, porque la matriz se escribía antes que nada. Desde
   * V1-E3 el **modelo nace primero**, así que el id viajaba hasta el `create` del hijo y lo que
   * saltaba era la **FK (P2003)** — que el `catch` de `resolverModeloDeLaOp` no mapea (sólo mira
   * unicidad) ⇒ salía como *"Ocurrió un error inesperado"*, **HTTP 500**.
   */
  it('🔴 idColor INEXISTENTE: ErrorNoEncontrado (no un 500 de FK) y no queda nada a medias', async () => {
    const { idLinea, idModelo } = await sembrarPedidoConDesarrollo({ codigoModelo: 'DEV-COLOR' });

    await expect(
      salidaAProduccion(
        sesion(),
        idLinea,
        { lineas: [{ idColor: 999_999, tallas: [{ idTalla, cantidad: 10 }] }] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);

    // A2: ni orden, ni modelo nuevo, ni número quemado.
    expect(await cliente.orden.count()).toBe(0);
    expect(await cliente.modelo.count({ where: { idModeloDesarrollo: idModelo } })).toBe(0);
  });

  it('matriz sin piezas (todo 0) → ErrorValidacion', async () => {
    const { idLinea } = await sembrarPedidoConDesarrollo({ codigoModelo: 'DEV-119' });
    await expect(
      salidaAProduccion(sesion(), idLinea, { lineas: matriz(0) }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('modo migración (crearOrdenMigrada) NO encola el evento ni asigna números (B5)', async () => {
    const modelo = await cliente.modelo.create({ data: { codigo: 'HIS-001' } });
    await crearOrdenMigrada(
      sesion(),
      {
        folio: 987654,
        idEmpresa,
        idPedidoLinea: null,
        idModelo: modelo.id,
        idCliente: idClienteNegocio,
        estado: 'completa',
        celdas: [{ idColor, idTalla, cantidad: 10 }],
      },
      bd(),
    );

    expect(await cliente.eventoOutbox.count({ where: { tipo: 'orden-creada' } })).toBe(0);
    const modeloTras = await cliente.modelo.findUnique({ where: { id: modelo.id } });
    expect(modeloTras?.numeroProduccion).toBeNull();
  });
});
