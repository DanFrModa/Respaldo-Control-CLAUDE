/**
 * Tests de integración de los SERVICIOS SOBRE LA ORDEN (0.114): el CORTE PAGABLE y el EMPAQUE.
 * Postgres efímero (testcontainers). Miden la BD, no un mock.
 *
 * Lo que dictó Daniel y esto verifica:
 *  (a) *«sólo hay que poner su cantidad y precio para meterlo en la OP»* → el corte con precio crea
 *      su `EsMaCargo` `propuesto` con `servicio = corte`, cantidad DERIVADA de la etapa y precio
 *      propuesto = el pactado;
 *  (b) *«el empaque no toca el inventario»* → el empaque NO escribe ni un `Movimiento` de kardex;
 *  (c) *«una maquila de empaque también»* → el empaque crea su cargo `servicio = empaque`;
 *  (d) el empacador tiene que tener el rol `empaque` (D12/R15);
 *  (e) la cantidad del empaque es PROPIA: empacar más de lo recibido NO se bloquea (regla C&A);
 *  (f) cancelar un corte se lleva su cargo `propuesto`, y con el cargo VALIDADO exige
 *      `esma.cargo-validar` (calco de la cancelación del recibo);
 *  (g) el CHECK `esma_cargo_proceso_o_servicio` de la BD: un cargo no puede tener los dos ni
 *      ninguno. Se prueba con SQL CRUDO, porque el dominio nunca lo intentaría.
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
import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { listarCargosEsMa } from '../esma/cargos.js';
import {
  cancelarEtapaMovimiento,
  listarEtapasOrden,
  registrarCorte,
  registrarEmpaque,
} from './etapas.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let cortador: Proveedor; // rol "corte"
let empacador: Proveedor; // rol "empaque"
let maquileroCostura: Proveedor; // rol "maquila-costura" (NO sirve para corte ni empaque)
let procesoCostura: TipoProceso;
let clienteNegocioId: number;
let idOrden: number;

const PERM_TODOS: ClavePermiso[] = [
  'produccion.corte',
  'produccion.empaque',
  'produccion.cancelar',
  'produccion.wip-ver',
  'esma.cargo-validar',
];

/** Sesión de captura SIN el permiso especial de cargos (el caso normal de quien captura). */
const PERM_CAPTURA: ClavePermiso[] = [
  'produccion.corte',
  'produccion.empaque',
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

/** Crea una orden con matriz: Rojo (CH 10, M 20). Devuelve su id. */
async function crearOrdenConMatriz(): Promise<number> {
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocioId },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 30, precio: 10 },
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
        ],
      },
    },
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
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Tienda Ejemplo Uno' } });
  clienteNegocioId = clienteNegocio.id;
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  cortador = await crearProveedorConRol('Taller Ejemplo Uno', 'corte');
  empacador = await crearProveedorConRol('Taller Ejemplo Dos', 'empaque');
  maquileroCostura = await crearProveedorConRol('Taller Ejemplo Tres', 'maquila-costura');
  procesoCostura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  idOrden = await crearOrdenConMatriz();
});

describe('⭐ El CORTE es pagable (0.114)', () => {
  it('(a) con precio pactado crea su CARGO EsMa propuesto, con cantidad y precio derivados', async () => {
    const corte = await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-09-04',
        precioPactado: 3.5,
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
    // El precio queda EN la etapa (es la base del cargo) y vuelve a quien lo capturó.
    expect(corte.precioPactado).toBe(3.5);

    const cargos = await cliente.esMaCargo.findMany({ where: { idOrden } });
    expect(cargos).toHaveLength(1);
    const cargo = cargos[0];
    expect(cargo?.servicio).toBe('corte');
    // La marca del servicio: NO hay proceso de maquila (no es una maquila de ida y vuelta).
    expect(cargo?.idTipoProceso).toBeNull();
    expect(cargo?.idMaquilero).toBe(cortador.id);
    expect(cargo?.idEtapaRecibo).toBe(corte.id);
    expect(cargo?.estado).toBe('propuesto');
    // Lo REAL se llena al validar, no al capturar (punto de control humano conservado).
    expect(cargo?.cantidadReal).toBeNull();
    expect(cargo?.precioReal).toBeNull();

    // Y la PROYECCIÓN (lo que ve quien valida): cantidad derivada de la etapa, precio = el pactado
    // —la orden no tiene precio de corte y no se le presta el de la maquila— y etiqueta "Corte".
    const cola = await listarCargosEsMa(sesion(), {}, bd());
    expect(cola.filas).toHaveLength(1);
    expect(cola.filas[0]?.cantidadPropuesta).toBe(30);
    expect(cola.filas[0]?.precioPropuesto).toBe(3.5);
    expect(cola.filas[0]?.importePropuesto).toBe(105);
    expect(cola.filas[0]?.tipoProceso).toBe('Corte');
    expect(cola.filas[0]?.servicio).toBe('corte');
    expect(cola.filas[0]?.idTipoProceso).toBeNull();
  });

  it('el precio de la ORDEN no se le presta al corte (su referencia es sólo la del pactado)', async () => {
    // La orden trae `maquilaOrd` (precio de COSTURA). Un cargo de corte NO debe valuarse con él:
    // cobrarle al cortador el precio de la maquila sería peor que no proponerle nada.
    await cliente.orden.update({ where: { id: idOrden }, data: { maquilaOrd: 99 } });
    await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-09-04',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const cola = await listarCargosEsMa(sesion(), {}, bd());
    expect(cola.filas[0]?.precioPropuesto).toBeNull();
    expect(cola.filas[0]?.importePropuesto).toBeNull();
  });

  it('un corte SIN precio igual genera el cargo (el precio se teclea al validarlo)', async () => {
    await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-09-04',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const cargos = await cliente.esMaCargo.findMany({ where: { idOrden } });
    expect(cargos).toHaveLength(1);
    expect(cargos[0]?.servicio).toBe('corte');
  });

  it('una captura de PURO CERO se rechaza, así que no puede nacer un cargo de 0 piezas', async () => {
    // La puerta `totalPiezas > 0` de `crearCargoDeServicio` es defensa en profundidad: hoy el
    // dominio ni siquiera deja llegar ahí (`aplanarYValidar` rechaza la captura vacía). Se mide el
    // efecto que importa: no queda ni etapa ni cargo.
    await expect(
      registrarCorte(
        sesion(),
        {
          idOrden,
          idCortador: cortador.id,
          fecha: '2026-09-04',
          precioPactado: 3,
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 0 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.esMaCargo.count()).toBe(0);
    expect(await cliente.etapaMovimiento.count()).toBe(0);
  });
});

describe('⭐ El EMPAQUE (0.114)', () => {
  it('(b)(c) NO toca el kardex y crea su cargo con servicio = empaque', async () => {
    const empaque = await registrarEmpaque(
      sesion(),
      {
        idOrden,
        idEmpacador: empacador.id,
        fecha: '2026-09-04',
        precioPactado: 1.25,
        observaciones: 'Empaque en cajas de 12',
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 8 },
              { idTalla: tallaM.id, cantidad: 12 },
            ],
          },
        ],
      },
      bd(),
    );

    expect(empaque.tipo).toBe('empaque');
    expect(empaque.idTipoProceso).toBeNull();
    expect(empaque.idTercero).toBe(empacador.id);
    expect(empaque.totalPiezas).toBe(20);
    expect(empaque.precioPactado).toBe(1.25);

    // (b) *«el empaque no toca el inventario»*: ni un movimiento de kardex, de ningún tipo.
    expect(await cliente.movimiento.count()).toBe(0);

    // (c) y sí genera el cargo del empacador.
    const cargos = await cliente.esMaCargo.findMany({ where: { idOrden } });
    expect(cargos).toHaveLength(1);
    expect(cargos[0]?.servicio).toBe('empaque');
    expect(cargos[0]?.idTipoProceso).toBeNull();
    expect(cargos[0]?.idMaquilero).toBe(empacador.id);

    const cola = await listarCargosEsMa(sesion(), {}, bd());
    expect(cola.filas[0]?.tipoProceso).toBe('Empaque');
    expect(cola.filas[0]?.cantidadPropuesta).toBe(20);
    expect(cola.filas[0]?.precioPropuesto).toBe(1.25);
  });

  it('(d) RECHAZA a un tercero sin el rol "empaque"', async () => {
    await expect(
      registrarEmpaque(
        sesion(),
        {
          idOrden,
          idEmpacador: maquileroCostura.id, // tiene rol de costura, no de empaque
          fecha: '2026-09-04',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.etapaMovimiento.count()).toBe(0);
    expect(await cliente.esMaCargo.count()).toBe(0);
  });

  it('(e) la cantidad es PROPIA: empacar más de lo que la orden pide NO se bloquea', async () => {
    // Regla de C&A que dictó Daniel: el empaque no se deriva de lo recibido. Aquí no hay ni un
    // corte capturado y aun así se pueden empacar 100 piezas sobre una orden de 30.
    const empaque = await registrarEmpaque(
      sesion(),
      {
        idOrden,
        idEmpacador: empacador.id,
        fecha: '2026-09-04',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 100 }] }],
      },
      bd(),
    );
    expect(empaque.totalPiezas).toBe(100);
  });

  it('exige el permiso propio `produccion.empaque` (no basta con el del corte)', async () => {
    await expect(
      registrarEmpaque(
        sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: ['produccion.corte'] }),
        {
          idOrden,
          idEmpacador: empacador.id,
          fecha: '2026-09-04',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('sale en el HISTORIAL de etapas de la orden, junto al corte', async () => {
    await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-09-04',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    await registrarEmpaque(
      sesion(),
      {
        idOrden,
        idEmpacador: empacador.id,
        fecha: '2026-09-05',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 9 }] }],
      },
      bd(),
    );
    const historial = await listarEtapasOrden(sesion(), idOrden, bd());
    expect(historial.etapas.map((e) => e.tipo).sort()).toEqual(['corte', 'empaque']);
  });

  it('NO emite evento de Ruta Crítica (su proceso RC ya lo gobierna el hito de orden)', async () => {
    await registrarEmpaque(
      sesion(),
      {
        idOrden,
        idEmpacador: empacador.id,
        fecha: '2026-09-04',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
      },
      bd(),
    );
    // Un corte SÍ escribe en el outbox; el empaque no debe escribir NINGUNA fila (ver el TSDoc de
    // `registrarEmpaque`: un segundo escritor sobre el proceso RC `empaque` des-completaría el hito).
    expect(await cliente.eventoOutbox.count()).toBe(0);
  });
});

describe('⭐ Cancelar un servicio se lleva su cargo (0.114)', () => {
  /** Registra un corte con precio y devuelve el id de la etapa y el del cargo que generó. */
  async function corteConCargo(): Promise<{ idEtapa: number; idCargo: number }> {
    const corte = await registrarCorte(
      sesion(),
      {
        idOrden,
        idCortador: cortador.id,
        fecha: '2026-09-04',
        precioPactado: 3,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    const cargo = await cliente.esMaCargo.findFirstOrThrow({ where: { idEtapaRecibo: corte.id } });
    return { idEtapa: corte.id, idCargo: cargo.id };
  }

  it('(f) cargo PROPUESTO: se cancela junto con el corte, en la misma transacción', async () => {
    const { idEtapa, idCargo } = await corteConCargo();
    // Sin el permiso especial: un cargo propuesto no lo necesita.
    const cancelado = await cancelarEtapaMovimiento(
      sesion(PERM_CAPTURA),
      idEtapa,
      { motivo: 'Se capturó en la orden equivocada' },
      bd(),
    );
    expect(cancelado.cancelado).toBe(true);
    const cargo = await cliente.esMaCargo.findUniqueOrThrow({ where: { id: idCargo } });
    expect(cargo.estado).toBe('cancelado');
  });

  it('(f) cargo VALIDADO: sin `esma.cargo-validar` NO se cancela NADA (una sola transacción)', async () => {
    const { idEtapa, idCargo } = await corteConCargo();
    await cliente.esMaCargo.update({
      where: { id: idCargo },
      data: { estado: 'validado', cantidadReal: 10, precioReal: 3, validadoEn: new Date() },
    });

    await expect(
      cancelarEtapaMovimiento(sesion(PERM_CAPTURA), idEtapa, { motivo: 'Ya no va' }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);

    // Lo que importa de "una sola transacción": el corte SIGUE VIVO y el cargo SIGUE VALIDADO.
    const etapa = await cliente.etapaMovimiento.findUniqueOrThrow({ where: { id: idEtapa } });
    expect(etapa.canceladoEn).toBeNull();
    const cargo = await cliente.esMaCargo.findUniqueOrThrow({ where: { id: idCargo } });
    expect(cargo.estado).toBe('validado');
  });

  it('(f) cargo VALIDADO: CON `esma.cargo-validar` sí se cancelan los dos', async () => {
    const { idEtapa, idCargo } = await corteConCargo();
    await cliente.esMaCargo.update({
      where: { id: idCargo },
      data: { estado: 'validado', cantidadReal: 10, precioReal: 3, validadoEn: new Date() },
    });
    await cancelarEtapaMovimiento(sesion(), idEtapa, { motivo: 'Se duplicó' }, bd());
    const etapa = await cliente.etapaMovimiento.findUniqueOrThrow({ where: { id: idEtapa } });
    expect(etapa.canceladoEn).not.toBeNull();
    const cargo = await cliente.esMaCargo.findUniqueOrThrow({ where: { id: idCargo } });
    expect(cargo.estado).toBe('cancelado');
  });

  it('cancelar un EMPAQUE también se lleva su cargo', async () => {
    const empaque = await registrarEmpaque(
      sesion(),
      {
        idOrden,
        idEmpacador: empacador.id,
        fecha: '2026-09-04',
        precioPactado: 1,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 6 }] }],
      },
      bd(),
    );
    await cancelarEtapaMovimiento(sesion(PERM_CAPTURA), empaque.id, { motivo: 'Se recontó' }, bd());
    const cargo = await cliente.esMaCargo.findFirstOrThrow({
      where: { idEtapaRecibo: empaque.id },
    });
    expect(cargo.estado).toBe('cancelado');
  });
});

describe('⭐ El CHECK de exclusividad de la BD (0.114)', () => {
  /** Un cargo crudo con proceso y/o servicio a la carta, para probar el CHECK sin pasar por el dominio. */
  async function insertarCargoCrudo(
    idTipoProceso: number | null,
    servicio: 'corte' | 'empaque' | null,
  ): Promise<void> {
    // Cada parámetro va CASTEADO a mano: dos de ellos pueden llegar en NULL, y un parámetro NULL sin
    // tipo deja a Postgres sin poder resolver el tipo del placeholder ("could not determine data
    // type of parameter"). El cast también documenta contra qué columna física se está probando.
    await cliente.$executeRawUnsafe(
      `INSERT INTO "esma_cargo" ("id_empresa", "id_maquilero", "id_orden", "id_tipo_proceso", "servicio", "estado", "modificado_en")
       VALUES ($1::int, $2::int, $3::int, $4::int, $5::"servicio_orden", 'propuesto'::"estado_cargo_esma", NOW())`,
      empresa.id,
      cortador.id,
      idOrden,
      idTipoProceso,
      servicio,
    );
  }

  it('rechaza un cargo con LOS DOS (proceso y servicio)', async () => {
    await expect(insertarCargoCrudo(procesoCostura.id, 'corte')).rejects.toThrow(
      /esma_cargo_proceso_o_servicio/,
    );
    expect(await cliente.esMaCargo.count()).toBe(0);
  });

  it('rechaza un cargo con NINGUNO de los dos', async () => {
    await expect(insertarCargoCrudo(null, null)).rejects.toThrow(/esma_cargo_proceso_o_servicio/);
    expect(await cliente.esMaCargo.count()).toBe(0);
  });

  it('acepta los dos casos legítimos: sólo proceso, o sólo servicio', async () => {
    await insertarCargoCrudo(procesoCostura.id, null);
    await insertarCargoCrudo(null, 'empaque');
    expect(await cliente.esMaCargo.count()).toBe(2);
  });
});
