/**
 * Pruebas de integración de las rutas REST de EsMa — corazón contable (F6-E4). Levantan la app
 * Fastify REAL apuntada al Postgres efímero (testcontainers), reusando el seed real (admin
 * `Control.2026!`, FR Moda). Cubren:
 *  - deny-by-default (A4): un usuario solo con `esma.ver-pagos` NO puede crear abonos/descuentos (403),
 *    pero SÍ ver el saldo y meter pagos;
 *  - la separación CAPTURAR / VALIDAR de la fila 0.128: `esma.modificar` captura pero NO autoriza
 *    (403 al revisar) y `esma.revisar` autoriza pero NO captura (403 al crear el abono);
 *  - alta de cada concepto (abono/descuento/pago) por HTTP con el admin;
 *  - ocultamiento de importes sin `consultas.ver-importes` (el saldo y los montos salen en null);
 *  - el recibo de pago responde 200 application/pdf.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { construirApp } from '../app.js';
import type { PrismaClient } from '../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sembrar } from '../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;
let idMaquilero: number;
let idCargo: number;

const PASSWORD_ADMIN = 'Control.2026!';

async function login(username: string, password: string): Promise<string[]> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    payload: { username, password },
  });
  const set = res.headers['set-cookie'];
  return set === undefined ? [] : Array.isArray(set) ? set : [set];
}

function comoHeaderCookie(cookies: string[]): string {
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function cookieAdmin(): Promise<string> {
  return comoHeaderCookie(await login('admin', PASSWORD_ADMIN));
}

async function idRol(nombre: string): Promise<number> {
  const rol = await cliente.rol.findUniqueOrThrow({ where: { nombre }, select: { id: true } });
  return rol.id;
}

/** Crea un usuario con permisos exactos (rol nuevo) y devuelve su cookie de sesión. */
async function usuarioConPermisos(
  cookieAdmin: string,
  username: string,
  permisos: string[],
): Promise<string> {
  const perms = await cliente.permiso.findMany({
    where: { clave: { in: permisos } },
    select: { id: true },
  });
  const rol = await cliente.rol.create({
    data: {
      nombre: `rol-${username}`,
      descripcion: 'rol de prueba',
      permisos: { create: perms.map((p) => ({ idPermiso: p.id })) },
    },
  });
  const creado = await app.inject({
    method: 'POST',
    url: '/api/usuarios',
    headers: { cookie: cookieAdmin },
    payload: { username, nombre: username, password: 'Clave.1234!', idsRoles: [rol.id] },
  });
  expect(creado.statusCode).toBe(201);
  return comoHeaderCookie(await login(username, 'Clave.1234!'));
}

/** Siembra una orden + un maquilero + un cargo VALIDADO (10 × 8) para probar pagos/saldo. */
async function sembrarCargoValidado(): Promise<void> {
  const empresa = await cliente.empresa.findFirstOrThrow({ select: { id: true } });
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  const modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  const color = await cliente.color.create({ data: { nombre: 'Rojo' } });
  const talla = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  // El TipoProceso 'costura' YA lo siembra el seed (F3-E1): se REUSA (crearlo choca con su @unique).
  const proceso = await cliente.tipoProceso.findFirstOrThrow({ where: { codigo: 'costura' } });
  // Modalidad de facturación (fila 0.110): sin ella no se le puede capturar NINGÚN movimiento.
  // `solo_sin` es la de deriva cero aquí: ninguna aserción de este archivo mira el segmento, y
  // `conFactura` pasa de `null` a `false`, que el segmento "sin factura" ya contaba igual.
  const maquilero = await cliente.proveedor.create({
    data: { nombre: 'Maquila Costura SA', modalidadFacturacion: 'solo_sin' },
  });
  idMaquilero = maquilero.id;
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocio.id },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 10, precio: 10 },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idPedidoLinea: linea.id,
      idModelo: modelo.id,
      idCliente: clienteNegocio.id,
      estado: 'completa',
      fechaCompletada: new Date(),
      lineas: {
        create: [{ idColor: color.id, tallas: { create: [{ idTalla: talla.id, cantidad: 10 }] } }],
      },
    },
  });
  const cargo = await cliente.esMaCargo.create({
    data: {
      idEmpresa: empresa.id,
      idMaquilero: maquilero.id,
      idOrden: orden.id,
      idTipoProceso: proceso.id,
      cantidadReal: 10,
      precioReal: 8,
      estado: 'validado',
      validadoEn: new Date(),
    },
  });
  idCargo = cargo.id;
}

beforeAll(async () => {
  cliente = clientePruebas();
  app = await construirApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await sembrar(cliente);
  await sembrarCargoValidado();
});

describe('API EsMa (F6-E4)', () => {
  it('deny-by-default: solo esma.ver-pagos NO crea abonos/descuentos (403) pero SÍ ve saldo y paga', async () => {
    const admin = await cookieAdmin();
    const cookie = await usuarioConPermisos(admin, 'solopagos', ['esma.ver-pagos']);

    const abono = await app.inject({
      method: 'POST',
      url: '/api/esma/abonos',
      headers: { cookie },
      payload: { idMaquilero, monto: 10, fecha: '2026-07-01' },
    });
    expect(abono.statusCode).toBe(403);

    const descuento = await app.inject({
      method: 'POST',
      url: '/api/esma/descuentos',
      headers: { cookie },
      payload: { idMaquilero, monto: 10, fecha: '2026-07-01' },
    });
    expect(descuento.statusCode).toBe(403);

    // Ver saldo: 200 (sin importes porque no tiene consultas.ver-importes → null).
    const saldo = await app.inject({
      method: 'GET',
      url: `/api/esma/maquileros/${String(idMaquilero)}/saldo`,
      headers: { cookie },
    });
    expect(saldo.statusCode).toBe(200);
    expect(saldo.json<{ saldo: number | null }>().saldo).toBeNull();

    // Meter un pago: 201 (esma.ver-pagos es el permiso #24 "ver y meter SOLO pagos").
    const pago = await app.inject({
      method: 'POST',
      url: '/api/esma/pagos',
      headers: { cookie },
      payload: { idMaquilero, fecha: '2026-07-01', aplicaciones: [{ idCargo, cantidad: 4 }] },
    });
    expect(pago.statusCode).toBe(201);
  });

  it('admin: alta de abono/descuento/pago (201) y saldo con importes', async () => {
    const cookie = await cookieAdmin();

    const abono = await app.inject({
      method: 'POST',
      url: '/api/esma/abonos',
      headers: { cookie },
      payload: { idMaquilero, monto: 15, fecha: '2026-07-01' },
    });
    expect(abono.statusCode).toBe(201);

    const descuento = await app.inject({
      method: 'POST',
      url: '/api/esma/descuentos',
      headers: { cookie },
      payload: { idMaquilero, monto: 5, fecha: '2026-07-01' },
    });
    expect(descuento.statusCode).toBe(201);

    const pago = await app.inject({
      method: 'POST',
      url: '/api/esma/pagos',
      headers: { cookie },
      payload: { idMaquilero, fecha: '2026-07-01', aplicaciones: [{ idCargo, cantidad: 6 }] },
    });
    expect(pago.statusCode).toBe(201);
    expect(pago.json<{ monto: number }>().monto).toBe(48); // 6 × 8

    // Recién capturados, los TRES nacen `capturado`: el saldo sigue siendo el de los cargos y los
    // importes esperan decisión aparte (V1, fila 0.115 — el estado de revisión manda en los cuatro
    // conceptos, no sólo en los cargos).
    const saldoAntes = await app.inject({
      method: 'GET',
      url: `/api/esma/maquileros/${String(idMaquilero)}/saldo`,
      headers: { cookie },
    });
    expect(saldoAntes.statusCode).toBe(200);
    const antes = saldoAntes.json<{
      saldo: number;
      pendienteRevision: { abonos: number; pagos: number; descuentos: number; neto: number };
    }>();
    expect(antes.saldo).toBe(80); // sólo los cargos
    expect(antes.pendienteRevision.abonos).toBe(15);
    expect(antes.pendienteRevision.pagos).toBe(48);
    expect(antes.pendienteRevision.descuentos).toBe(5);
    expect(antes.pendienteRevision.neto).toBe(-38); // 15 − 48 − 5

    // Se revisan las tres partidas por el mismo endpoint que usa la pantalla.
    for (const [concepto, respuesta] of [
      ['abono', abono],
      ['descuento', descuento],
      ['pago', pago],
    ] as const) {
      const revision = await app.inject({
        method: 'POST',
        url: `/api/esma/movimientos/${concepto}/${String(respuesta.json<{ id: number }>().id)}/revisar`,
        headers: { cookie },
      });
      expect(revision.statusCode).toBe(200);
    }

    // Saldo = cargos(80) + abonos(15) − pagos(48) − descuentos(5) = 42, y ya no queda pendiente.
    const saldo = await app.inject({
      method: 'GET',
      url: `/api/esma/maquileros/${String(idMaquilero)}/saldo`,
      headers: { cookie },
    });
    expect(saldo.statusCode).toBe(200);
    const despues = saldo.json<{
      saldo: number;
      pendienteRevision: { neto: number };
    }>();
    expect(despues.saldo).toBe(42);
    expect(despues.pendienteRevision.neto).toBe(0);
  });

  it('el recibo de pago responde 200 application/pdf', async () => {
    const cookie = await cookieAdmin();
    const pago = await app.inject({
      method: 'POST',
      url: '/api/esma/pagos',
      headers: { cookie },
      payload: { idMaquilero, fecha: '2026-07-01', aplicaciones: [{ idCargo, cantidad: 10 }] },
    });
    expect(pago.statusCode).toBe(201);
    const idPago = pago.json<{ id: number }>().id;

    const pdf = await app.inject({
      method: 'GET',
      url: `/api/esma/pagos/${String(idPago)}/impreso`,
      headers: { cookie },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('deny-by-default: sin esma.ver-pagos no ve el saldo (403)', async () => {
    const admin = await cookieAdmin();
    const creado = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      headers: { cookie: admin },
      payload: {
        username: 'sinesma',
        nombre: 'Sin EsMa',
        password: 'Clave.1234!',
        idsRoles: [await idRol('Basico')],
      },
    });
    expect(creado.statusCode).toBe(201);
    const cookie = comoHeaderCookie(await login('sinesma', 'Clave.1234!'));

    const saldo = await app.inject({
      method: 'GET',
      url: `/api/esma/maquileros/${String(idMaquilero)}/saldo`,
      headers: { cookie },
    });
    expect(saldo.statusCode).toBe(403);
  });
});

describe('API EsMa — estado de cuenta (F6-E5)', () => {
  it('las consultas responden 200 con esma.ver-pagos', async () => {
    const admin = await cookieAdmin();
    const cookie = await usuarioConPermisos(admin, 'consultaesma', ['esma.ver-pagos']);
    const rutas = [
      `/api/esma/maquileros/${String(idMaquilero)}/estado-cuenta`,
      `/api/esma/maquileros/${String(idMaquilero)}/desglosado`,
      '/api/esma/saldos',
      '/api/esma/pagos-semanales',
      '/api/esma/recibos-semanales',
      '/api/esma/maquileros?tipo=costura',
    ];
    for (const url of rutas) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.statusCode).toBe(200);
    }
  });

  /** Crea un abono con el admin y devuelve su id (una partida `capturado` que revisar). */
  async function abonoParaRevisar(admin: string): Promise<number> {
    const abono = await app.inject({
      method: 'POST',
      url: '/api/esma/abonos',
      headers: { cookie: admin },
      payload: { idMaquilero, monto: 30, fecha: '2026-07-01' },
    });
    expect(abono.statusCode).toBe(201);
    return abono.json<{ id: number }>().id;
  }

  it('deny-by-default: solo esma.ver-pagos NO puede revisar una partida (403); el admin sí (200)', async () => {
    const admin = await cookieAdmin();
    const idAbono = await abonoParaRevisar(admin);

    const soloVer = await usuarioConPermisos(admin, 'soloverpagos', ['esma.ver-pagos']);
    const negado = await app.inject({
      method: 'POST',
      url: `/api/esma/movimientos/abono/${String(idAbono)}/revisar`,
      headers: { cookie: soloVer },
    });
    expect(negado.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: `/api/esma/movimientos/abono/${String(idAbono)}/revisar`,
      headers: { cookie: admin },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ estadoRevision: string }>().estadoRevision).toBe('revisado');
  });

  /**
   * ⭐ FILA 0.128 — «un permiso para meter lo recibido y otro para validarlo» (Daniel,
   * §Post-F9.192(1)). Por HTTP, que es donde vive el `preHandler`: quien CAPTURA abonos y
   * descuentos (`esma.modificar`) ya no puede AUTORIZARLOS, y quien autoriza (`esma.revisar`) sí,
   * aunque no pueda capturar. Hasta la 0.127 el mismo permiso hacía las dos cosas.
   */
  it('⭐ el que CAPTURA no AUTORIZA: esma.modificar da 403 al revisar y esma.revisar da 200', async () => {
    const admin = await cookieAdmin();

    // Quien captura: puede crear el abono (201) pero NO autorizarlo (403).
    const capturista = await usuarioConPermisos(admin, 'capturaesma', [
      'esma.modificar',
      'esma.ver-pagos',
    ]);
    const suyo = await app.inject({
      method: 'POST',
      url: '/api/esma/abonos',
      headers: { cookie: capturista },
      payload: { idMaquilero, monto: 40, fecha: '2026-07-02' },
    });
    expect(suyo.statusCode, 'capturar sigue siendo de esma.modificar').toBe(201);
    const idSuyo = suyo.json<{ id: number }>().id;

    const autoAutorizar = await app.inject({
      method: 'POST',
      url: `/api/esma/movimientos/abono/${String(idSuyo)}/revisar`,
      headers: { cookie: capturista },
    });
    expect(autoAutorizar.statusCode, 'nadie se auto-autoriza lo que capturó').toBe(403);

    // Quien valida: autoriza esa misma partida (200) aunque NO tenga `esma.modificar`…
    //
    // ⚠️ NO SIMPLIFIQUES ESTA MITAD: es la ÚNICA aserción del repo que caza una ruta desalineada
    // del dominio. El caso negativo de arriba seguiría en verde con el `preHandler` mal puesto
    // —porque el dominio también lanza 403 y el HTTP se ve idéntico—; sólo el caso POSITIVO
    // distingue «la ruta pide el permiso correcto» de «la ruta pide otro y el dominio la salva».
    const validador = await usuarioConPermisos(admin, 'validaesma', [
      'esma.revisar',
      'esma.ver-pagos',
    ]);
    const autorizado = await app.inject({
      method: 'POST',
      url: `/api/esma/movimientos/abono/${String(idSuyo)}/revisar`,
      headers: { cookie: validador },
    });
    expect(autorizado.statusCode).toBe(200);
    expect(autorizado.json<{ estadoRevision: string }>().estadoRevision).toBe('revisado');

    // …y sin `esma.modificar` NO puede capturar: la separación corta en los dos sentidos.
    const capturaDelValidador = await app.inject({
      method: 'POST',
      url: '/api/esma/abonos',
      headers: { cookie: validador },
      payload: { idMaquilero, monto: 50, fecha: '2026-07-03' },
    });
    expect(capturaDelValidador.statusCode, 'validar no da permiso de capturar').toBe(403);
  });

  it('el desglosado responde 200 en PDF y en Excel con su content-type', async () => {
    const cookie = await cookieAdmin();

    const pdf = await app.inject({
      method: 'GET',
      url: `/api/esma/maquileros/${String(idMaquilero)}/desglosado/impreso`,
      headers: { cookie },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString('latin1')).toBe('%PDF');

    const xlsx = await app.inject({
      method: 'GET',
      url: `/api/esma/maquileros/${String(idMaquilero)}/desglosado/excel`,
      headers: { cookie },
    });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});
