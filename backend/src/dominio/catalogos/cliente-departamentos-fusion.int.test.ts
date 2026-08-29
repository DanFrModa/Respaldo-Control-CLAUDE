/**
 * Integración de la FUSIÓN de departamentos duplicados (§Post-F9.122(a)) contra Postgres real.
 *
 * ⭐ **Lo que sólo esta prueba puede verificar, y es la razón de la etapa:** que después de fusionar
 * **NINGUNA** de las cuatro tablas que cuelgan del departamento se quede apuntando al absorbido. El
 * estado prohibido es un JOIN —«un dato apuntando a un departamento absorbido»— así que se barren las
 * CUATRO (proyectos, listas de precios, cotizaciones, factores), no la que se tocó.
 *
 * ⚖️ Y la colisión que es el corazón: cuando el canónico **y** el absorbido tienen factores propios,
 * ganan los del canónico y los del absorbido quedan escritos en la BITÁCORA antes de retirarse.
 *
 * Qué relaciones entran en la fusión NO se verifica a mano aquí, sino en el unit
 * `cliente-departamentos-fusion-referencias.test.ts`, que las deriva de `prisma/schema.prisma`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  fusionarDepartamentosCliente,
  previsualizarFusionDepartamentos,
} from './cliente-departamentos.js';

let cliente: PrismaClient;

const sesionAdmin = () =>
  sesionDePrueba({
    permisos: ['clientes.ver', 'clientes.administrar'],
    idEmpresaActiva: idEmpresa,
  });
const sesionSinPermiso = () => sesionDePrueba({ permisos: ['clientes.ver'] });
const bd = () => ({ cliente });

let idEmpresa: number;
let idCliente: number;
/** El que SE QUEDA (canónico) y los dos sinónimos que se absorben. */
let idCaballeros: number;
let idHombre: number;
let idVaron: number;
let idEstadoLista: number;

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
  const c = await cliente.cliente.create({ data: { nombre: 'C&A' } });
  idCliente = c.id;
  const [caballeros, hombre, varon] = await Promise.all([
    cliente.clienteDepartamento.create({ data: { idCliente, nombre: 'Caballeros' } }),
    cliente.clienteDepartamento.create({ data: { idCliente, nombre: '2-HOMBRE' } }),
    cliente.clienteDepartamento.create({ data: { idCliente, nombre: 'VARONIL' } }),
  ]);
  idCaballeros = caballeros.id;
  idHombre = hombre.id;
  idVaron = varon.id;
  const estado = await cliente.estadoLista.create({
    data: { codigo: 'borrador', nombre: 'Borrador' },
  });
  idEstadoLista = estado.id;
});

/** Un proyecto colgado del departamento (folio propio para no chocar con `@@unique`). */
async function crearProyecto(idClienteDepartamento: number, folio: number): Promise<number> {
  const p = await cliente.proyecto.create({
    data: {
      folio,
      idEmpresa,
      idCliente,
      idClienteDepartamento,
      nombre: `Proyecto ${String(folio)}`,
    },
  });
  return p.id;
}

/** Una lista de precios colgada del departamento. */
async function crearLista(idClienteDepartamento: number, folio: number): Promise<number> {
  const l = await cliente.listaPrecios.create({
    data: {
      folio,
      idEmpresa,
      idCliente,
      idClienteDepartamento,
      fecha: new Date('2026-08-01'),
      idEstadoLista,
      margenPct: 30,
      descuentosPct: 5,
      regaliasPct: 2,
      costoVentasPct: 3,
    },
  });
  return l.id;
}

/** Una cotización colgada del departamento, con su encabezado CONGELADO. */
async function crearCotizacion(
  idClienteDepartamento: number,
  folio: number,
  nombreDepartamento: string,
): Promise<number> {
  const q = await cliente.cotizacion.create({
    data: {
      folio,
      idEmpresa,
      fecha: new Date('2026-08-02'),
      idCliente,
      idClienteDepartamento,
      nombreCliente: 'C&A',
      nombreDepartamento,
      folioLista: BigInt(folio),
    },
  });
  return q.id;
}

/** Factores propios de un departamento (los cuatro porcentajes, todos NOT NULL). */
async function crearFactores(idClienteDepartamento: number, margenPct: number): Promise<number> {
  const f = await cliente.clienteFactores.create({
    data: {
      idCliente,
      idClienteDepartamento,
      margenPct,
      descuentosPct: 4,
      regaliasPct: 1,
      costoVentasPct: 2,
    },
  });
  return f.id;
}

describe('fusionarDepartamentosCliente', () => {
  it('🔴 BARRIDO POR ESTADO: después de fusionar, NINGUNA de las cuatro tablas queda apuntando al absorbido', async () => {
    await crearProyecto(idHombre, 1);
    await crearProyecto(idHombre, 2);
    await crearProyecto(idVaron, 3);
    await crearLista(idHombre, 10);
    await crearLista(idVaron, 11);
    await crearCotizacion(idHombre, 20, '2-HOMBRE');
    await crearFactores(idHombre, 33);

    await fusionarDepartamentosCliente(
      sesionAdmin(),
      idCliente,
      { idDestino: idCaballeros, origenes: [idHombre, idVaron] },
      bd(),
    );

    // El estado prohibido es un JOIN: se barren LAS CUATRO, no la que se tocó.
    const absorbidos = { in: [idHombre, idVaron] };
    expect(await cliente.proyecto.count({ where: { idClienteDepartamento: absorbidos } })).toBe(0);
    expect(await cliente.listaPrecios.count({ where: { idClienteDepartamento: absorbidos } })).toBe(
      0,
    );
    expect(await cliente.cotizacion.count({ where: { idClienteDepartamento: absorbidos } })).toBe(
      0,
    );
    expect(
      await cliente.clienteFactores.count({ where: { idClienteDepartamento: absorbidos } }),
    ).toBe(0);

    // Y llegaron TODAS al canónico (nada se perdió por el camino).
    expect(await cliente.proyecto.count({ where: { idClienteDepartamento: idCaballeros } })).toBe(
      3,
    );
    expect(
      await cliente.listaPrecios.count({ where: { idClienteDepartamento: idCaballeros } }),
    ).toBe(2);
    expect(await cliente.cotizacion.count({ where: { idClienteDepartamento: idCaballeros } })).toBe(
      1,
    );
    expect(
      await cliente.clienteFactores.count({ where: { idClienteDepartamento: idCaballeros } }),
    ).toBe(1);
  });

  it('los absorbidos quedan DESACTIVADOS, nunca borrados (D3), y el canónico activo', async () => {
    await cliente.clienteDepartamento.update({
      where: { id: idCaballeros },
      data: { activo: false }, // el canónico puede venir apagado: la fusión lo reactiva
    });

    await fusionarDepartamentosCliente(
      sesionAdmin(),
      idCliente,
      { idDestino: idCaballeros, origenes: [idHombre] },
      bd(),
    );

    const absorbido = await cliente.clienteDepartamento.findUnique({ where: { id: idHombre } });
    expect(absorbido).not.toBeNull(); // 🔴 sigue EXISTIENDO: borrado suave, jamás físico
    expect(absorbido?.activo).toBe(false);
    expect(absorbido?.nombre).toBe('2-HOMBRE');

    const canonico = await cliente.clienteDepartamento.findUnique({ where: { id: idCaballeros } });
    expect(canonico?.activo).toBe(true);
  });

  it('⚖️ COLISIÓN DE FACTORES: ganan los del que SE QUEDA, y los del absorbido quedan en la bitácora', async () => {
    await crearFactores(idCaballeros, 30); // los del canónico
    await crearFactores(idHombre, 77); // los del absorbido: se descartan

    await fusionarDepartamentosCliente(
      sesionAdmin(),
      idCliente,
      { idDestino: idCaballeros, origenes: [idHombre] },
      bd(),
    );

    const delCanonico = await cliente.clienteFactores.findFirst({
      where: { idClienteDepartamento: idCaballeros },
    });
    // 🔴 El canónico sale de la fusión con SUS factores: el precio no cambia de espaldas al usuario.
    expect(delCanonico?.margenPct.toString()).toBe('30');
    // Y no quedó una segunda fila colgando del absorbido.
    expect(await cliente.clienteFactores.count()).toBe(1);

    // Los descartados quedan ESCRITOS, con sus cuatro valores: auditable y rehacible a mano.
    const entrada = await cliente.bitacora.findFirst({
      where: { entidad: 'Cliente', accion: 'OTRO' },
      orderBy: { id: 'desc' },
    });
    const datos = entrada?.datos as Record<string, unknown>;
    expect(datos['departamento']).toBe('fusionar');
    const descartados = datos['descartados'] as Record<string, unknown>[];
    expect(descartados).toHaveLength(1);
    expect(descartados[0]?.['margenPct']).toBe('77');
    expect(descartados[0]?.['descuentosPct']).toBe('4');
    expect(descartados[0]?.['regaliasPct']).toBe('1');
    expect(descartados[0]?.['costoVentasPct']).toBe('2');
    expect(descartados[0]?.['referencia']).toBe('factores');
  });

  it('sin colisión, los factores del absorbido se MUEVEN tal cual al canónico', async () => {
    await crearFactores(idHombre, 77); // el canónico NO tiene: no hay nada que elegir

    await fusionarDepartamentosCliente(
      sesionAdmin(),
      idCliente,
      { idDestino: idCaballeros, origenes: [idHombre] },
      bd(),
    );

    const delCanonico = await cliente.clienteFactores.findFirst({
      where: { idClienteDepartamento: idCaballeros },
    });
    expect(delCanonico?.margenPct.toString()).toBe('77');
    expect(await cliente.clienteFactores.count()).toBe(1);
  });

  it('el DEFAULT del cliente (factores con departamento NULL) no lo toca la fusión', async () => {
    await cliente.clienteFactores.create({
      data: {
        idCliente,
        idClienteDepartamento: null,
        margenPct: 25,
        descuentosPct: 4,
        regaliasPct: 1,
        costoVentasPct: 2,
      },
    });
    await crearFactores(idHombre, 77);

    await fusionarDepartamentosCliente(
      sesionAdmin(),
      idCliente,
      { idDestino: idCaballeros, origenes: [idHombre] },
      bd(),
    );

    const porDefecto = await cliente.clienteFactores.findFirst({
      where: { idCliente, idClienteDepartamento: null },
    });
    expect(porDefecto?.margenPct.toString()).toBe('25');
  });

  it('🔴 el snapshot `nombreDepartamento` de la cotización NO se reescribe (el papel impreso se respeta)', async () => {
    const idCot = await crearCotizacion(idHombre, 20, '2-HOMBRE');

    await fusionarDepartamentosCliente(
      sesionAdmin(),
      idCliente,
      { idDestino: idCaballeros, origenes: [idHombre] },
      bd(),
    );

    const cot = await cliente.cotizacion.findUnique({ where: { id: idCot } });
    expect(cot?.idClienteDepartamento).toBe(idCaballeros); // la LLAVE sí se movió
    expect(cot?.nombreDepartamento).toBe('2-HOMBRE'); // el TEXTO congelado, no
  });

  it('deja bitácora por cada absorbido y una de resumen en el que se queda (A7)', async () => {
    await crearProyecto(idHombre, 1);
    await crearProyecto(idVaron, 2);

    await fusionarDepartamentosCliente(
      sesionAdmin(),
      idCliente,
      { idDestino: idCaballeros, origenes: [idHombre, idVaron] },
      bd(),
    );

    const porAbsorbido = await cliente.bitacora.findMany({
      where: { entidad: 'Cliente', accion: 'OTRO' },
      orderBy: { id: 'asc' },
    });
    expect(porAbsorbido).toHaveLength(2);
    for (const b of porAbsorbido) {
      const d = b.datos as Record<string, unknown>;
      expect(d['departamento']).toBe('fusionar');
      expect((d['fusionadoEn'] as Record<string, unknown>)['id']).toBe(idCaballeros);
    }

    const resumen = await cliente.bitacora.findFirst({
      where: { entidad: 'Cliente', accion: 'MODIFICAR' },
      orderBy: { id: 'desc' },
    });
    const d = resumen?.datos as Record<string, unknown>;
    expect(d['departamento']).toBe('fusionar');
    expect(d['referenciasReasignadas']).toBe(2);
    expect(d['absorbio']).toHaveLength(2);
  });

  it('NO se puede fusionar un departamento de OTRO cliente', async () => {
    const otro = await cliente.cliente.create({ data: { nombre: 'Suburbia' } });
    const ajeno = await cliente.clienteDepartamento.create({
      data: { idCliente: otro.id, nombre: 'Caballeros' },
    });

    await expect(
      fusionarDepartamentosCliente(
        sesionAdmin(),
        idCliente,
        { idDestino: idCaballeros, origenes: [ajeno.id] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    // Y nada se tocó: la tx entera se abortó (A2).
    const sigue = await cliente.clienteDepartamento.findUnique({ where: { id: ajeno.id } });
    expect(sigue?.activo).toBe(true);
  });

  it('exige el permiso `clientes.administrar` (RBAC en el SERVIDOR, A4)', async () => {
    await expect(
      fusionarDepartamentosCliente(
        sesionSinPermiso(),
        idCliente,
        { idDestino: idCaballeros, origenes: [idHombre] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('no fusiona departamentos de un cliente DESACTIVADO', async () => {
    await cliente.cliente.update({ where: { id: idCliente }, data: { activo: false } });
    await expect(
      fusionarDepartamentosCliente(
        sesionAdmin(),
        idCliente,
        { idDestino: idCaballeros, origenes: [idHombre] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('previsualizarFusionDepartamentos (la guarda GEMELA)', () => {
  it('⭐⭐ VARIOS absorbidos con factores: el PRIMERO se los lleva, el SEGUNDO choca — y la previa lo dice', async () => {
    // El canónico NO tiene factores; los dos absorbidos SÍ. Los orígenes se procesan en orden, así
    // que «2-HOMBRE» se los lleva y «VARONIL» ya choca contra los recién llegados. Leyendo la base a
    // secas, la previa diría "ninguno choca" y prometería mover los dos: exactamente la mentira que
    // esta prueba impide.
    await crearFactores(idHombre, 77);
    await crearFactores(idVaron, 88);

    const previa = await previsualizarFusionDepartamentos(
      sesionAdmin(),
      idCliente,
      { idDestino: idCaballeros, origenes: [idHombre, idVaron] },
      bd(),
    );
    expect(previa.origenes.map((o) => o.factoresSeDescartan)).toEqual([false, true]);
    // Y promete mover UNO, que es lo que de verdad se mueve.
    expect(previa.totales.find((t) => t.relacion === 'factores')?.cuenta).toBe(1);

    await fusionarDepartamentosCliente(
      sesionAdmin(),
      idCliente,
      { idDestino: idCaballeros, origenes: [idHombre, idVaron] },
      bd(),
    );

    const quedaron = await cliente.clienteFactores.findMany();
    expect(quedaron).toHaveLength(1);
    expect(quedaron[0]?.margenPct.toString()).toBe('77'); // los del primero, no los del segundo
    expect(quedaron[0]?.idClienteDepartamento).toBe(idCaballeros);

    // Y los descartados del segundo quedaron escritos con sus cuatro valores.
    const bitacoras = await cliente.bitacora.findMany({
      where: { entidad: 'Cliente', accion: 'OTRO' },
      orderBy: { id: 'asc' },
    });
    const delSegundo = bitacoras[1]?.datos as Record<string, unknown>;
    const descartados = delSegundo['descartados'] as Record<string, unknown>[];
    expect(descartados).toHaveLength(1);
    expect(descartados[0]?.['margenPct']).toBe('88');
  });

  it('AVISA de la colisión de factores ANTES de apretar el botón', async () => {
    await crearFactores(idCaballeros, 30);
    await crearFactores(idHombre, 77);

    const previa = await previsualizarFusionDepartamentos(
      sesionAdmin(),
      idCliente,
      { idDestino: idCaballeros, origenes: [idHombre] },
      bd(),
    );
    expect(previa.origenes[0]?.factoresSeDescartan).toBe(true);
  });

  it('no escribe NADA (es de sólo lectura)', async () => {
    await crearProyecto(idHombre, 1);
    const antes = await cliente.bitacora.count();

    await previsualizarFusionDepartamentos(
      sesionAdmin(),
      idCliente,
      { idDestino: idCaballeros, origenes: [idHombre] },
      bd(),
    );

    expect(await cliente.bitacora.count()).toBe(antes);
    expect(await cliente.proyecto.count({ where: { idClienteDepartamento: idHombre } })).toBe(1);
    const sigue = await cliente.clienteDepartamento.findUnique({ where: { id: idHombre } });
    expect(sigue?.activo).toBe(true);
  });

  it('exige el mismo permiso que la fusión que previsualiza', async () => {
    await expect(
      previsualizarFusionDepartamentos(
        sesionSinPermiso(),
        idCliente,
        { idDestino: idCaballeros, origenes: [idHombre] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});
