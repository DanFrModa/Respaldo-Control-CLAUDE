/**
 * Tests de INTEGRACIÓN del catálogo de AUDITORES (rediseño R9). Postgres efímero (testcontainers).
 * Cubre el CRUD con borrado SUAVE, la unicidad de nombre insensible a mayúsculas, los permisos
 * deny-by-default (§9.2), la bitácora (A7) en la misma transacción y —lo propio de este catálogo—
 * el conteo DERIVADO `numeroAuditorias` (auditorías NO canceladas cuyo `auditorPorId` coincide con
 * el nombre).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../../datos/index.js';
import { ErrorConflicto, ErrorPermiso } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarAuditor,
  crearAuditor,
  desactivarAuditor,
  listarAuditores,
  obtenerAuditor,
  reactivarAuditor,
} from './auditores.js';

let cliente: PrismaClient;

/** Administra el catálogo (alta/edición/des-reactivar) + consulta. */
const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['calidad.ver', 'calidad.administrar-catalogo'] });
/** Solo consulta. */
const sesionVer = () => sesionDePrueba({ permisos: ['calidad.ver'] });

const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
});

describe('Auditores — permisos (deny-by-default, §9.2)', () => {
  it('sin permiso no se puede ni leer ni escribir', async () => {
    const sin = sesionDePrueba();
    await expect(
      crearAuditor(sin, { nombre: 'X', rol: 'Auditor', nivelAql: '2.5' }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(listarAuditores(sin, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('con solo lectura no se puede escribir, pero sí leer', async () => {
    await expect(
      crearAuditor(sesionVer(), { nombre: 'Laura', rol: 'Sr. Auditor', nivelAql: '2.5' }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(listarAuditores(sesionVer(), {}, bd())).resolves.toBeTruthy();
  });
});

describe('Auditores — CRUD + borrado suave', () => {
  it('crea, escribe bitácora (A7), edita, desactiva y reactiva', async () => {
    const sesion = sesionAdmin();
    const auditor = await crearAuditor(
      sesion,
      { nombre: 'Laura Hernández', rol: 'Sr. Auditor', nivelAql: '2.5' },
      bd(),
    );
    expect(auditor).toMatchObject({
      nombre: 'Laura Hernández',
      rol: 'Sr. Auditor',
      nivelAql: '2.5',
      activo: true,
      numeroAuditorias: 0,
    });

    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'Auditor', idEntidad: String(auditor.id), accion: 'CREAR' },
    });
    expect(bitacora.idUsuario).toBe(sesion.id);

    const editado = await actualizarAuditor(
      sesion,
      { id: auditor.id, rol: 'Auditor', nivelAql: '4.0' },
      bd(),
    );
    expect(editado.rol).toBe('Auditor');
    expect(editado.nivelAql).toBe('4.0');

    const desactivado = await desactivarAuditor(sesion, auditor.id, bd());
    expect(desactivado.activo).toBe(false);
    // Desactivar dos veces es conflicto.
    await expect(desactivarAuditor(sesion, auditor.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    const reactivado = await reactivarAuditor(sesion, auditor.id, bd());
    expect(reactivado.activo).toBe(true);
  });

  it('rechaza nombre duplicado (insensible a mayúsculas)', async () => {
    const sesion = sesionAdmin();
    await crearAuditor(sesion, { nombre: 'Miguel Ríos', rol: 'Auditor', nivelAql: '2.5' }, bd());
    await expect(
      crearAuditor(sesion, { nombre: 'miguel ríos', rol: 'Auditor', nivelAql: '1.0' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('por defecto el listado solo trae activos; incluirInactivos los muestra', async () => {
    const sesion = sesionAdmin();
    const a = await crearAuditor(
      sesion,
      { nombre: 'Ana Gómez', rol: 'Auditor', nivelAql: '4.0' },
      bd(),
    );
    await desactivarAuditor(sesion, a.id, bd());
    expect((await listarAuditores(sesion, {}, bd())).total).toBe(0);
    expect((await listarAuditores(sesion, { incluirInactivos: true }, bd())).total).toBe(1);
  });

  it('la búsqueda filtra por nombre (insensible a mayúsculas)', async () => {
    const sesion = sesionAdmin();
    await crearAuditor(
      sesion,
      { nombre: 'Laura Hernández', rol: 'Sr. Auditor', nivelAql: '2.5' },
      bd(),
    );
    await crearAuditor(sesion, { nombre: 'Miguel Ríos', rol: 'Auditor', nivelAql: '2.5' }, bd());
    const r = await listarAuditores(sesion, { busqueda: 'laura' }, bd());
    expect(r.total).toBe(1);
    expect(r.datos[0]?.nombre).toBe('Laura Hernández');
  });
});

describe('Auditores — numeroAuditorias (conteo derivado del histórico)', () => {
  /** Crea una empresa + una orden mínima y devuelve sus ids para colgar auditorías. */
  async function sembrarOrden(empresa: Empresa): Promise<number> {
    const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
    const modelo = await cliente.modelo.create({
      data: { codigo: 'A-100', descripcion: 'Playera' },
    });
    const pedido = await cliente.pedido.create({
      data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocio.id },
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
        idCliente: clienteNegocio.id,
      },
    });
    return orden.id;
  }

  /** Inserta una auditoría histórica atribuida a `auditorPorId`. */
  async function sembrarAuditoria(
    empresa: Empresa,
    idOrden: number,
    num: bigint,
    auditorPorId: string,
    cancelada = false,
  ): Promise<void> {
    await cliente.auditoria.create({
      data: {
        numAuditoria: num,
        idEmpresa: empresa.id,
        idOrden,
        fechaElaboracion: new Date('2026-01-10'),
        fechaAuditoria: new Date('2026-01-10'),
        tamanoMuestra: 13,
        auditorPorId,
        cancelada,
      },
    });
  }

  it('cuenta las auditorías NO canceladas atribuidas al nombre del auditor', async () => {
    const sesion = sesionAdmin();
    const empresa = await crearEmpresaPrueba(cliente);
    const idOrden = await sembrarOrden(empresa);

    await crearAuditor(
      sesion,
      { nombre: 'Laura Hernández', rol: 'Sr. Auditor', nivelAql: '2.5' },
      bd(),
    );
    await crearAuditor(sesion, { nombre: 'Ana Gómez', rol: 'Auditor', nivelAql: '4.0' }, bd());

    // Dos auditorías vivas de Laura + una cancelada; una de Ana; una de un nombre sin auditor.
    await sembrarAuditoria(empresa, idOrden, 1n, 'Laura Hernández');
    await sembrarAuditoria(empresa, idOrden, 2n, 'Laura Hernández');
    await sembrarAuditoria(empresa, idOrden, 3n, 'Laura Hernández', true);
    await sembrarAuditoria(empresa, idOrden, 4n, 'Ana Gómez');
    await sembrarAuditoria(empresa, idOrden, 5n, 'Fantasma');

    const pagina = await listarAuditores(sesion, {}, bd());
    const laura = pagina.datos.find((a) => a.nombre === 'Laura Hernández');
    const ana = pagina.datos.find((a) => a.nombre === 'Ana Gómez');
    expect(laura?.numeroAuditorias).toBe(2); // la cancelada NO cuenta
    expect(ana?.numeroAuditorias).toBe(1);

    // También en el detalle individual.
    const detalle = await obtenerAuditor(sesion, laura!.id, bd());
    expect(detalle.numeroAuditorias).toBe(2);
  });
});
