/**
 * Tests de INTEGRACIÓN de la SALIDA A PRODUCCIÓN (rediseño R3, B4) contra el Postgres efímero
 * (testcontainers). Cubre lo que pidió la ficha:
 *  • PASO A PRODUCCIÓN del modelo la 1ª vez (§Post-F9.34 / §Post-F9.46: nº de 5 dígitos, código
 *    sustituido, nº de desarrollo conservado) + REUSO del número en la 2ª OP,
 *  • SNAPSHOT `Pedido.ocCliente` → `Orden.ocCliente` (B3: editar el pedido después NO re-escribe),
 *  • LIGA `DesarrolloOrden` (núcleo de F8-E6) — y OP sin liga cuando el renglón no tiene desarrollo,
 *  • EVENTO outbox `orden-creada` encolado en la MISMA tx (B5),
 *  • modo MIGRACIÓN (`crearOrdenMigrada`) NO encola ni mintea,
 *  • TRANSACCIONALIDAD (A2): matriz inválida → rollback total (ni orden, ni liga, ni promoción, ni evento),
 *  • referencias del cliente (D7) capturadas en la misma operación.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorValidacion } from '../../comun/errores.js';
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

    // ⭐ El modelo PASÓ A PRODUCCIÓN aquí (§Post-F9.34 punto 4): esto es lo que Daniel echó de
    // menos en la OP 5558 — la OP se quedaba con el modelo de desarrollo.
    expect(resultado.numeroProduccionMinteado).toBe(true);
    // Serie 71 (pantalón + caballero) sin nada ocupado → el primer libre es el 001.
    expect(resultado.numeroProduccion).toBe(71_001);
    expect(resultado.codigoModeloAnterior).toBe('DEV-114');
    expect(resultado.avisosNumeroProduccion).toEqual([]);
    const modelo = await cliente.modelo.findUnique({ where: { id: idModelo } });
    expect(modelo?.numeroProduccion).toBe(71_001);
    expect(modelo?.codigo).toBe('71001');
    expect(modelo?.origen).toBe('produccion');
    // …y su nº de desarrollo se CONSERVA (D3).
    expect(modelo?.codigoDesarrollo).toBe('DEV-114');

    // Evento outbox `orden-creada` en la MISMA tx (B5).
    const eventos = await cliente.eventoOutbox.findMany({ where: { tipo: 'orden-creada' } });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.payload).toMatchObject({ idOrden: resultado.orden.id, idEmpresa });
  });

  it('la 2ª salida del MISMO renglón (resurtido) reusa el nº de producción y liga la 2ª OP al mismo desarrollo', async () => {
    const { idLinea, idDesarrollo } = await sembrarPedidoConDesarrollo({ codigoModelo: 'DEV-115' });

    const primera = await salidaAProduccion(sesion(), idLinea, { lineas: matriz(60) }, bd());
    const segunda = await salidaAProduccion(sesion(), idLinea, { lineas: matriz(40) }, bd());

    expect(primera.numeroProduccionMinteado).toBe(true);
    expect(primera.numeroProduccion).toBe(71_001);
    // La 2ª OP NO vuelve a promover: hereda el mismo número y no consume otro consecutivo.
    expect(segunda.numeroProduccionMinteado).toBe(false);
    expect(segunda.numeroProduccion).toBe(71_001);
    expect(segunda.codigoModeloAnterior).toBeNull();
    // Un desarrollo tiene N órdenes (resurtidos): ambas OPs quedan ligadas al MISMO desarrollo.
    expect(segunda.ligaCreada).toBe(true);
    expect(
      await cliente.desarrolloOrden.count({ where: { idDesarrollo: idDesarrollo ?? 0 } }),
    ).toBe(2);
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

  it('renglón SIN desarrollo pero con modelo de desarrollo: sin liga, pero el modelo SÍ se promueve', async () => {
    const { idLinea, idModelo } = await sembrarPedidoConDesarrollo({
      codigoModelo: 'LEG-001',
      conDesarrollo: false,
    });

    const resultado = await salidaAProduccion(sesion(), idLinea, { lineas: matriz() }, bd());

    expect(resultado.ligaCreada).toBe(false);
    expect(resultado.idDesarrollo).toBeNull();
    expect(resultado.numeroProduccionMinteado).toBe(true);
    expect(await cliente.desarrolloOrden.count()).toBe(0);
    const modelo = await cliente.modelo.findUnique({ where: { id: idModelo } });
    expect(modelo?.numeroProduccion).toBe(71_001);
  });

  /**
   * Modelo HISTÓRICO del Access (`M-18`, `51783a`): ya está en producción y su código no es
   * numérico de 5 dígitos, así que no tiene —ni estrena— número. La OP sale igual; lo que NO
   * puede pasar es que se le invente uno.
   */
  it('modelo histórico YA de producción sin nº: la OP sale y el modelo no se toca', async () => {
    const { idLinea, idModelo } = await sembrarPedidoConDesarrollo({
      codigoModelo: 'M-18',
      conDesarrollo: false,
      origen: 'produccion',
    });

    const resultado = await salidaAProduccion(sesion(), idLinea, { lineas: matriz() }, bd());

    expect(resultado.numeroProduccionMinteado).toBe(false);
    expect(resultado.numeroProduccion).toBeNull();
    expect(resultado.codigoModeloAnterior).toBeNull();
    const modelo = await cliente.modelo.findUnique({ where: { id: idModelo } });
    expect(modelo?.codigo).toBe('M-18');
    expect(modelo?.numeroProduccion).toBeNull();
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
    expect(resultado.numeroProduccionMinteado).toBe(false);
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
    const modelo = await cliente.modelo.findUnique({ where: { id: idModelo } });
    expect(modelo?.codigo).toBe('52010');
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
