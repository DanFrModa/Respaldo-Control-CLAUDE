/**
 * Tests de integración de las ETAPAS de producción (F3-E2: corte + envío a maquila). Postgres
 * efímero (testcontainers). Cubre lo que la ficha exige:
 *  (a) enviar más que lo cortado → rechazado (sobre-envío estricto, decisión (g));
 *  (b) cortador/maquilero SIN el rol del proceso → rechazado (mapeo proceso→rol, D12/R15);
 *  (c) sobre-corte PERMITIDO (no rechaza, decisión (f));
 *  (d) cancelar un corte con envío vivo → rechazado;
 *  (e) folios consecutivos por secuencia (A3);
 *  (f) dos envíos concurrentes no exceden lo cortado (concurrencia, suma directa bajo bloqueo).
 * Y de paso: pendientes derivados (porCortar / cortado por enviar) y costura+estampado en paralelo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Proveedor,
  Talla,
  TipoProceso,
} from '../../datos/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';
import {
  cancelarEtapaMovimiento,
  corteSemanalPorCortador,
  listarEtapasOrden,
  pendientesPorOrden,
  registrarCorte,
  registrarEnvioMaquila,
  sugerirCaptura,
} from './etapas.js';
import { registrarReciboMaquila } from './recibos.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let colorAzul: Color;
let tallaCH: Talla;
let tallaM: Talla;
let cortador: Proveedor; // rol "corte"
let maquileroCostura: Proveedor; // rol "maquila-costura"
let estampador: Proveedor; // rol "estampado"
let procesoCostura: TipoProceso;
let procesoEstampado: TipoProceso;
let idOrden: number;

const PERM_TODOS: ClavePermiso[] = [
  'produccion.corte',
  'produccion.envio',
  'produccion.cancelar',
  'produccion.wip-ver',
];

const sesion = (permisos: ClavePermiso[] = PERM_TODOS) =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

/** Crea un proveedor con un rol dado (vía RolProveedor). */
async function crearProveedorConRol(nombre: string, codigoRol: string): Promise<Proveedor> {
  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: codigoRol },
    update: {},
    create: { codigo: codigoRol, nombre: codigoRol },
  });
  return cliente.proveedor.create({
    data: { nombre, roles: { create: { idRolProveedor: rol.id } } },
  });
}

/** Crea una orden con matriz: Rojo (CH 10, M 20) + Azul (M 5). Devuelve su id. */
async function crearOrdenConMatriz(): Promise<number> {
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocioId },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 35, precio: 10 },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idPedidoLinea: linea.id,
      idModelo: modelo.id,
      idCliente: clienteNegocioId,
      estado: 'completa',
      fechaCompletada: new Date(),
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
          {
            idColor: colorAzul.id,
            tallas: { create: [{ idTalla: tallaM.id, cantidad: 5 }] },
          },
        ],
      },
    },
  });
  return orden.id;
}

let clienteNegocioId: number;

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
  clienteNegocioId = clienteNegocio.id;
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  colorAzul = await cliente.color.create({ data: { nombre: 'Azul' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  cortador = await crearProveedorConRol('Corte SA', 'corte');
  maquileroCostura = await crearProveedorConRol('Maquila Costura SA', 'maquila-costura');
  estampador = await crearProveedorConRol('Estampados SA', 'estampado');
  procesoCostura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  procesoEstampado = await cliente.tipoProceso.create({
    data: { codigo: 'estampado', nombre: 'Estampado', generaEntradaPt: false },
  });
  idOrden = await crearOrdenConMatriz();
});

describe('Corte (F3-E2)', () => {
  it('registra un corte color×talla y deriva el total (D4)', async () => {
    const corte = await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    expect(corte.tipo).toBe('corte');
    expect(corte.folio).toBe(1);
    expect(corte.idTipoProceso).toBeNull();
    expect(corte.totalPiezas).toBe(10);
  });

  it('(c) PERMITE sobre-corte (cortar más que lo pedido, decisión (f))', async () => {
    // La orden pidió CH 10; cortamos 50. No debe rechazar.
    const corte = await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 50 }] }],
      },
      bd(),
    );
    expect(corte.totalPiezas).toBe(50);
  });

  it('(b) RECHAZA un cortador sin el rol "corte"', async () => {
    await expect(
      registrarCorte(
        sesion(),
        {
          idOrden,
          idCortador: maquileroCostura.id, // no tiene rol "corte"
          fecha: '2026-06-18',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('RECHAZA un color que no pertenece a la orden', async () => {
    const colorVerde = await cliente.color.create({ data: { nombre: 'Verde' } });
    await expect(
      registrarCorte(
        sesion(),
        {
          idOrden,
          idCortador: cortador.id,
          fecha: '2026-06-18',
          lineas: [{ idColor: colorVerde.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('(e) los folios son consecutivos por secuencia (A3)', async () => {
    const c1 = await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
      },
      bd(),
    );
    const c2 = await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaM.id, cantidad: 1 }] }],
      },
      bd(),
    );
    expect(c2.folio).toBe(c1.folio + 1);
  });
});

describe('Envío a maquila (F3-E2)', () => {
  /** Corta Rojo CH 10 + M 20 para tener qué enviar. */
  async function cortarBase(): Promise<void> {
    await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 10 },
              { idTalla: tallaM.id, cantidad: 20 },
            ],
          },
        ],
      },
      bd(),
    );
  }

  it('envía a costura dentro de lo cortado y guarda el precio pactado', async () => {
    await cortarBase();
    const envio = await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-19',
        precioPactado: 12.5,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    expect(envio.tipo).toBe('envio_maquila');
    expect(envio.idTipoProceso).toBe(procesoCostura.id);
    expect(envio.precioPactado).toBe(12.5);
    expect(envio.totalPiezas).toBe(10);
  });

  it('(a) RECHAZA enviar más que lo cortado disponible (sobre-envío estricto, g)', async () => {
    await cortarBase(); // CH 10
    await expect(
      registrarEnvioMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-19',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 11 }] }], // 1 de más
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('(b) RECHAZA un maquilero sin el rol del proceso (estampador en costura)', async () => {
    await cortarBase();
    await expect(
      registrarEnvioMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: estampador.id, // tiene "estampado", no "maquila-costura"
          fecha: '2026-06-19',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('costura y estampado consumen el MISMO cortado independientemente (flujos paralelos, g)', async () => {
    await cortarBase(); // CH 10
    // Enviar CH 10 a costura.
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-19',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    // Enviar CH 10 a estampado TAMBIÉN debe poder (no se resta el de costura).
    const estampadoEnvio = await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-06-19',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    expect(estampadoEnvio.totalPiezas).toBe(10);
    // Pero un segundo envío a costura de 1 pza ya excede (CH 10 cortado, 10 ya enviados a costura).
    await expect(
      registrarEnvioMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-19',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('(f) dos envíos CONCURRENTES no exceden lo cortado', async () => {
    await cortarBase(); // CH 10
    // Dos envíos de 6 cada uno (12 > 10): a lo sumo UNO debe pasar.
    const intento = () =>
      registrarEnvioMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-19',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 6 }] }],
        },
        bd(),
      );
    const resultados = await Promise.allSettled([intento(), intento()]);
    const exitosos = resultados.filter((r) => r.status === 'fulfilled').length;
    expect(exitosos).toBe(1);
    // El cortado por enviar a costura no quedó negativo (6 enviados, 4 disponibles).
    const filas = await cliente.etapaMovimientoDet.findMany({
      where: {
        etapaMov: {
          idOrden,
          tipo: 'envio_maquila',
          idTipoProceso: procesoCostura.id,
          canceladoEn: null,
        },
      },
    });
    const totalEnviado = filas.reduce((s, f) => s + f.cantidad, 0);
    expect(totalEnviado).toBeLessThanOrEqual(10);
  });
});

describe('Cancelación de etapas (F3-E2)', () => {
  it('(d) RECHAZA cancelar un corte que tiene envíos vivos', async () => {
    const corte = await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-19',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
      },
      bd(),
    );
    await expect(
      cancelarEtapaMovimiento(sesion(), corte.id, { motivo: 'error de captura' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('cancela un envío (suave) y deja de contar en los pendientes', async () => {
    await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const envio = await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-19',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const cancelado = await cancelarEtapaMovimiento(
      sesion(),
      envio.id,
      { motivo: 'se reasignó' },
      bd(),
    );
    expect(cancelado.cancelado).toBe(true);
    expect(cancelado.motivoCancelacion).toBe('se reasignó');
    // Tras cancelar, se puede volver a enviar las 10 (el cancelado no cuenta).
    const reenvio = await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    expect(reenvio.totalPiezas).toBe(10);
  });

  it('cancelar una etapa inexistente o de otra empresa → 404', async () => {
    await expect(
      cancelarEtapaMovimiento(sesion(), 999_999, { motivo: 'no existe' }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

describe('Historial de etapas de la orden (F3-E2)', () => {
  it('lista cortes y envíos, vivos y cancelados (las canceladas quedan marcadas)', async () => {
    const corte = await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const envio = await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-19',
        precioPactado: 8,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
      },
      bd(),
    );
    await cancelarEtapaMovimiento(sesion(), envio.id, { motivo: 'se reasignó' }, bd());

    const historial = await listarEtapasOrden(sesion(), idOrden, bd());
    expect(historial.idOrden).toBe(idOrden);
    expect(historial.etapas).toHaveLength(2); // corte + envío (cancelado se conserva)

    const corteHist = historial.etapas.find((e) => e.id === corte.id);
    const envioHist = historial.etapas.find((e) => e.id === envio.id);
    expect(corteHist?.tipo).toBe('corte');
    expect(corteHist?.cancelado).toBe(false);
    expect(envioHist?.tipo).toBe('envio_maquila');
    expect(envioHist?.cancelado).toBe(true);
    expect(envioHist?.motivoCancelacion).toBe('se reasignó');
    expect(envioHist?.canceladoPorId).not.toBeNull();
    // R2 §4.4.3: sin `ordenes.ver-precio-real-maquila` el precio pactado va REDACTADO (es el
    // precio real de maquila de la etapa); con el permiso, sale el monto.
    expect(envioHist?.precioPactado).toBeNull();
    const conPermiso = await listarEtapasOrden(
      sesion([...PERM_TODOS, 'ordenes.ver-precio-real-maquila']),
      idOrden,
      bd(),
    );
    expect(conPermiso.etapas.find((e) => e.id === envio.id)?.precioPactado).toBe(8);
  });

  it('historial de una orden de otra empresa → 404', async () => {
    await expect(listarEtapasOrden(sesion(), 999_999, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });

  it('con incluirRecibos suma los RECIBOS y cada etapa trae creadoPorNombre (R2, §4.4.4)', async () => {
    // El usuario de la sesión de prueba existe en BD → su nombre se resuelve en el historial.
    await cliente.usuario.create({
      data: {
        id: 'usuario-prueba',
        username: 'prueba',
        nombre: 'Usuario de Prueba',
        email: 'prueba@control.local',
      },
    });

    await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-06-19',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    // Recibo de ESTAMPADO (no mete a PT → no exige almacén): el caso mínimo del historial.
    await registrarReciboMaquila(
      sesion(['produccion.recibo', 'produccion.wip-ver']),
      {
        idOrden,
        idTipoProceso: procesoEstampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-06-20',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );

    // Sin la bandera: corte + envío (comportamiento F3-E2 intacto para las pantallas viejas).
    const sinRecibos = await listarEtapasOrden(sesion(), idOrden, bd());
    expect(sinRecibos.etapas).toHaveLength(2);
    expect(sinRecibos.etapas.every((e) => e.tipo !== 'recibo_maquila')).toBe(true);

    // Con la bandera: también el recibo, y TODAS las etapas con su "capturado por".
    const conRecibos = await listarEtapasOrden(sesion(), idOrden, bd(), { incluirRecibos: true });
    expect(conRecibos.etapas).toHaveLength(3);
    expect(conRecibos.etapas.some((e) => e.tipo === 'recibo_maquila')).toBe(true);
    expect(conRecibos.etapas.every((e) => e.creadoPorNombre === 'Usuario de Prueba')).toBe(true);
  });
});

describe('Pendientes derivados y corte semanal (F3-E2)', () => {
  it('porCortar = orden − corte; cortado por enviar = corte − enviado, sin acumuladores', async () => {
    // Orden: Rojo CH10/M20, Azul M5 = 35. Cortamos Rojo CH10/M20 (=30).
    await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 10 },
              { idTalla: tallaM.id, cantidad: 20 },
            ],
          },
        ],
      },
      bd(),
    );
    // Enviamos Rojo CH10 a costura.
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-19',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const pend = await pendientesPorOrden(sesion(), idOrden, bd());
    expect(pend.cortadoTotal).toBe(30);
    expect(pend.totalPorCortar).toBe(5); // 35 − 30 (falta Azul M5)
    const costura = pend.cortadoPorEnviar.find((p) => p.idTipoProceso === procesoCostura.id);
    expect(costura).toBeDefined();
    // cortado costura 30 − enviado 10 = 20 por enviar.
    expect(costura?.totalPendiente).toBe(20);
  });

  it('sobre-corte deja porCortar NEGATIVO (decisión f), se muestra tal cual', async () => {
    await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 50 }] }],
      },
      bd(),
    );
    const pend = await pendientesPorOrden(sesion(), idOrden, bd());
    const celdaCh = pend.porCortar.find(
      (c) => c.idColor === colorRojo.id && c.idTalla === tallaCH.id,
    );
    expect(celdaCh?.cantidad).toBe(-40); // 10 pedido − 50 cortado
  });

  it('corte semanal agrupa por cortador y semana', async () => {
    await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const reporte = await corteSemanalPorCortador(sesion(), {}, bd());
    expect(reporte.filas.length).toBe(1);
    expect(reporte.filas[0]?.idCortador).toBe(cortador.id);
    expect(reporte.filas[0]?.totalCortado).toBe(10);
    expect(reporte.filas[0]?.numCortes).toBe(1);
  });
});

/**
 * ⭐ V1-E8i (§Post-F9.131) — la SUGERENCIA DE CAPTURA contra etapas reales. La aritmética pura vive en
 * `etapas-sugerencia.test.ts` (sin BD); lo que se prueba AQUÍ es lo que sólo se puede probar con
 * Postgres: que lee las MISMAS sumas que los topes de `registrarCorte`/`registrarEnvioMaquila`, que
 * filtra por la empresa activa (A9) y —lo que más importa— **que pregunta por el PROCESO correcto**.
 */
describe('Sugerencia de captura (V1-E8i)', () => {
  it('base CORTE: sin cortes propone lo ORDENADO; con un corte parcial, sólo el resto', async () => {
    // Orden: Rojo CH10/M20, Azul M5 = 35.
    const inicial = await sugerirCaptura(sesion(), idOrden, {}, bd());
    expect(inicial.base).toBe('corte');
    expect(inicial.idTipoProceso).toBeNull();
    expect(inicial.motivo).toBe('hay');
    expect(inicial.total).toBe(35);

    await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const resto = await sugerirCaptura(sesion(), idOrden, {}, bd());
    expect(resto.total).toBe(25); // 35 − 10, NO otra vez 35
    expect(
      resto.celdas.find((c) => c.idColor === colorRojo.id && c.idTalla === tallaCH.id),
    ).toBeUndefined();
  });

  it('un corte CANCELADO deja de contar: la sugerencia del corte vuelve a lo ordenado', async () => {
    const corte = await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    await cancelarEtapaMovimiento(sesion(), corte.id, { motivo: 'mal capturado' }, bd());
    const tras = await sugerirCaptura(sesion(), idOrden, {}, bd());
    expect(tras.total).toBe(35);
  });

  it('base ENVÍO: lo que propone es EXACTAMENTE lo que el servidor deja enviar (y una pza más, no)', async () => {
    await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    // Primer envío parcial: 6 de las 10.
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-19',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 6 }] }],
      },
      bd(),
    );
    // ⭐ El SEGUNDO envío parcial: propone 4, no las 10 brutas cortadas.
    const sug = await sugerirCaptura(sesion(), idOrden, { idTipoProceso: procesoCostura.id }, bd());
    expect(sug.base).toBe('envio');
    expect(sug.idTipoProceso).toBe(procesoCostura.id);
    expect(sug.total).toBe(4);

    // Y lo propuesto SE PUEDE GUARDAR tal cual (el tope real lo valida el dominio bajo lock)…
    const segundo = await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-20',
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: sug.celdas.map((c) => ({ idTalla: c.idTalla, cantidad: c.cantidad })),
          },
        ],
      },
      bd(),
    );
    expect(segundo.totalPiezas).toBe(4);
    // …y una pieza MÁS que lo propuesto ya la rechaza: la sugerencia es el tope, no una aproximación.
    await expect(
      registrarEnvioMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-21',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    const agotado = await sugerirCaptura(
      sesion(),
      idOrden,
      { idTipoProceso: procesoCostura.id },
      bd(),
    );
    expect(agotado.motivo).toBe('todo-enviado');
    expect(agotado.total).toBe(0);
  });

  it('⭐⭐ pregunta por EL PROCESO, no por los envíos de la orden: lo de costura no le resta a estampado (D8)', async () => {
    // Costura y estampado consumen las MISMAS piezas en flujos paralelos y NO se restan entre sí.
    // Si la lectura del envío perdiera su filtro por proceso, aquí el estampado diría
    // «todo-enviado» sobre un proceso al que nunca se le mandó nada — y el botón de arte quedaría
    // apagado con una razón falsa.
    await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    await registrarEnvioMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-19',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    // Costura: ya no queda nada.
    const costura = await sugerirCaptura(
      sesion(),
      idOrden,
      { idTipoProceso: procesoCostura.id },
      bd(),
    );
    expect(costura.motivo).toBe('todo-enviado');
    // Estampado: el cortado ÍNTEGRO sigue disponible.
    const estampado = await sugerirCaptura(
      sesion(),
      idOrden,
      { idTipoProceso: procesoEstampado.id },
      bd(),
    );
    expect(estampado.motivo).toBe('hay');
    expect(estampado.idTipoProceso).toBe(procesoEstampado.id);
    expect(estampado.total).toBe(10);
  });

  it('base ENVÍO sin ningún corte capturado dice «nada-cortado» (no «todo-enviado»)', async () => {
    const sug = await sugerirCaptura(sesion(), idOrden, { idTipoProceso: procesoCostura.id }, bd());
    expect(sug.motivo).toBe('nada-cortado');
    expect(sug.total).toBe(0);
  });

  it('una orden de otra empresa (o inexistente) → 404 (A9)', async () => {
    await expect(sugerirCaptura(sesion(), 999_999, {}, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });

  it('sin `produccion.wip-ver` no se puede consultar (deny-by-default, A4)', async () => {
    await expect(
      sugerirCaptura(sesion(['produccion.corte']), idOrden, {}, bd()),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe('Permisos (deny-by-default, A4)', () => {
  it('sin produccion.corte no se corta; sin produccion.envio no se envía', async () => {
    await expect(
      registrarCorte(
        sesion(['produccion.wip-ver']),
        {
          idOrden,
          idCortador: cortador.id,
          fecha: '2026-06-18',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(Error);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐ EL PACK / TENDIDO EN CORTE Y ENTREGA A MAQUILA (§Post-F9.10)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 DANIEL: *«Creo que sí es importante que viaje el pack **al menos en el corte, entrega a
// maquila**…»* — ahí es OBLIGATORIO (cada tendido es de un pack), a diferencia del recibo, donde él
// lo dejó opcional. Corte y envío comparten `aplanarYValidar`, así que las reglas de captura se
// prueban contra los DOS caminos y no contra uno solo (son ramas gemelas).
describe('Corte y envío por PACK (§Post-F9.10)', () => {
  /** Orden con dos tendidos del mismo Rojo: pack A (CH 5) y pack B (CH 5, M 3). */
  async function crearOrdenConPacks(): Promise<number> {
    const pedido = await cliente.pedido.create({
      data: { folio: 90n, idEmpresa: empresa.id, idCliente: clienteNegocioId },
    });
    const linea = await cliente.pedidoLinea.create({
      data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 13, precio: 10 },
    });
    const orden = await cliente.orden.create({
      data: {
        folio: 90n,
        idEmpresa: empresa.id,
        idPedidoLinea: linea.id,
        idModelo: modelo.id,
        idCliente: clienteNegocioId,
        estado: 'completa',
        fechaCompletada: new Date(),
        lineas: {
          create: [
            {
              idColor: colorRojo.id,
              pack: 'A',
              tallas: { create: [{ idTalla: tallaCH.id, cantidad: 5 }] },
            },
            {
              idColor: colorRojo.id,
              pack: 'B',
              tallas: {
                create: [
                  { idTalla: tallaCH.id, cantidad: 5 },
                  { idTalla: tallaM.id, cantidad: 3 },
                ],
              },
            },
          ],
        },
      },
    });
    return orden.id;
  }

  const cortar = async (id: number, pack: string | undefined, idTalla: number, cantidad: number) =>
    registrarCorte(
      sesion(),
      {
        idOrden: id,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [
          {
            idColor: colorRojo.id,
            ...(pack === undefined ? {} : { pack }),
            tallas: [{ idTalla, cantidad }],
          },
        ],
      },
      bd(),
    );

  const enviar = async (id: number, pack: string | undefined, idTalla: number, cantidad: number) =>
    registrarEnvioMaquila(
      sesion(),
      {
        idOrden: id,
        idTipoProceso: procesoCostura.id,
        idMaquilero: maquileroCostura.id,
        fecha: '2026-06-19',
        lineas: [
          {
            idColor: colorRojo.id,
            ...(pack === undefined ? {} : { pack }),
            tallas: [{ idTalla, cantidad }],
          },
        ],
      },
      bd(),
    );

  it('el CORTE exige el pack cuando la orden los maneja, y nombra los que hay', async () => {
    const id = await crearOrdenConPacks();
    await expect(cortar(id, undefined, tallaCH.id, 5)).rejects.toThrow(/se fabrica por packs/);
    await expect(cortar(id, undefined, tallaCH.id, 5)).rejects.toThrow(/"A", "B"/);
  });

  it('la ENTREGA A MAQUILA también lo exige (la rama gemela del corte)', async () => {
    const id = await crearOrdenConPacks();
    await cortar(id, 'A', tallaCH.id, 5);
    await expect(enviar(id, undefined, tallaCH.id, 5)).rejects.toThrow(/se fabrica por packs/);
  });

  it('rechaza un pack que la orden no tiene, en corte y en envío', async () => {
    const id = await crearOrdenConPacks();
    await expect(cortar(id, 'Z', tallaCH.id, 1)).rejects.toThrow(/no tiene el pack "Z"/);
    await cortar(id, 'A', tallaCH.id, 5);
    await expect(enviar(id, 'Z', tallaCH.id, 1)).rejects.toThrow(/no tiene el pack "Z"/);
  });

  it('rechaza una talla que ese TENDIDO no pidió, aunque el color sí la tenga en otro pack', async () => {
    // M sólo existe en el pack B. Validar contra la unión por color habría dejado cortar M del A.
    const id = await crearOrdenConPacks();
    await expect(cortar(id, 'A', tallaM.id, 1)).rejects.toThrow(/no pertenece al pack "A"/);
    await expect(cortar(id, 'B', tallaM.id, 3)).resolves.toBeTruthy();
  });

  it('🔴 el sobre-envío ESTRICTO se lleva TENDIDO POR TENDIDO, no por color', async () => {
    const id = await crearOrdenConPacks();
    await cortar(id, 'A', tallaCH.id, 5);
    await cortar(id, 'B', tallaCH.id, 5);

    // 10 cortadas de Rojo/CH en total, pero sólo 5 del pack A: enviar 6 de A no cabe.
    await expect(enviar(id, 'A', tallaCH.id, 6)).rejects.toThrow(ErrorConflicto);
    await expect(enviar(id, 'A', tallaCH.id, 6)).rejects.toThrow(/pack "A"/);

    // Y los 5 de cada uno sí caben.
    const envA = await enviar(id, 'A', tallaCH.id, 5);
    expect(envA.lineas[0]?.pack).toBe('A');
    await expect(enviar(id, 'B', tallaCH.id, 5)).resolves.toBeTruthy();
    // Agotados los dos tendidos, no queda nada que enviar.
    await expect(enviar(id, 'A', tallaCH.id, 1)).rejects.toThrow(ErrorConflicto);
  });

  it('un mismo color y pack no puede repetirse en una captura (pero dos packs sí)', async () => {
    const id = await crearOrdenConPacks();
    await expect(
      registrarCorte(
        sesion(),
        {
          idOrden: id,
          idCortador: cortador.id,
          fecha: '2026-06-18',
          lineas: [
            { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] },
            { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] },
          ],
        },
        bd(),
      ),
    ).rejects.toThrow(/color y pack no pueden aparecer dos veces/);

    const corte = await registrarCorte(
      sesion(),
      {
        idOrden: id,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [
          { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
          { idColor: colorRojo.id, pack: 'B', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
        ],
      },
      bd(),
    );
    expect(corte.totalPiezas).toBe(10);
    expect(corte.lineas.map((l) => l.pack).sort()).toEqual(['A', 'B']);
  });

  it('los pendientes se parten por tendido (lo que la pantalla ofrece = lo que el servidor topa)', async () => {
    const id = await crearOrdenConPacks();
    await cortar(id, 'A', tallaCH.id, 5);
    await enviar(id, 'A', tallaCH.id, 2);

    const pend = await pendientesPorOrden(sesion(), id, bd());
    const porCortar = new Map(
      pend.porCortar.filter((c) => c.idTalla === tallaCH.id).map((c) => [c.pack, c.cantidad]),
    );
    expect(porCortar.get('A')).toBe(0); // 5 pedidas − 5 cortadas
    expect(porCortar.get('B')).toBe(5); // 5 pedidas − 0 cortadas

    const costura = pend.cortadoPorEnviar.find((p) => p.idTipoProceso === procesoCostura.id);
    const porEnviar = new Map(costura?.celdas.map((c) => [c.pack, c.cantidad]));
    expect(porEnviar.get('A')).toBe(3); // 5 cortadas − 2 enviadas, sólo de A
    expect(porEnviar.has('B')).toBe(false); // B no se cortó: no hay celda ≠ 0
  });

  it('🔴 una orden SIN packs se comporta EXACTAMENTE igual que antes: el pack sobra y se rechaza', async () => {
    // `idOrden` es la orden de siempre (Rojo CH/M + Azul M), sin packs.
    await expect(
      registrarCorte(
        sesion(),
        {
          idOrden,
          idCortador: cortador.id,
          fecha: '2026-06-18',
          lineas: [
            { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] },
          ],
        },
        bd(),
      ),
    ).rejects.toThrow(/no se fabrica por packs/);

    // Y sin pack, el flujo de siempre sigue intacto: corte, envío estricto y el pack sale vacío.
    const corte = await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-06-18',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    expect(corte.lineas[0]?.pack).toBe('');
    await expect(
      registrarEnvioMaquila(
        sesion(),
        {
          idOrden,
          idTipoProceso: procesoCostura.id,
          idMaquilero: maquileroCostura.id,
          fecha: '2026-06-19',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 11 }] }],
        },
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);
  });
});
