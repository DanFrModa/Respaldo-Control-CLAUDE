import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { crearCliente, desactivarCliente } from './clientes.js';
import {
  actualizarDepartamentoCliente,
  agregarDepartamentoCliente,
  desactivarDepartamentoCliente,
  listarDepartamentosCliente,
  reactivarDepartamentoCliente,
} from './cliente-departamentos.js';

let cliente: PrismaClient;

const sesionAdmin = () => sesionDePrueba({ permisos: ['clientes.ver', 'clientes.administrar'] });

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

describe('Departamentos del cliente (F8-E1a D13/R16 — sub-recurso del Cliente)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('agregar un departamento exige permiso de administrar', async () => {
      const admin = sesionAdmin();
      const c = await crearCliente(admin, { nombre: 'C&A' }, bd());
      const soloVer = sesionDePrueba({ permisos: ['clientes.ver'] });
      await expect(
        agregarDepartamentoCliente(soloVer, c.id, { nombre: 'NIÑOS' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('listar departamentos exige al menos lectura', async () => {
      const c = await crearCliente(sesionAdmin(), { nombre: 'C&A' }, bd());
      const sinPermisos = sesionDePrueba();
      await expect(listarDepartamentosCliente(sinPermisos, c.id, {}, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
    });
  });

  describe('agregar', () => {
    it('agrega dos departamentos, con bitácora MODIFICAR (entidad Cliente)', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'C&A' }, bd());

      const ninos = await agregarDepartamentoCliente(sesion, c.id, { nombre: 'NIÑOS' }, bd());
      const damas = await agregarDepartamentoCliente(sesion, c.id, { nombre: 'DAMAS' }, bd());

      expect(ninos).toMatchObject({ nombre: 'NIÑOS', activo: true, idCliente: c.id });
      expect(damas).toMatchObject({ nombre: 'DAMAS', activo: true, idCliente: c.id });

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Cliente', idEntidad: String(c.id), accion: 'MODIFICAR' },
        orderBy: { fecha: 'asc' },
      });
      expect(bitacora.datos).toMatchObject({ departamento: 'agregar', nombre: 'NIÑOS' });
    });

    it('nombre DUPLICADO en el mismo cliente → ErrorConflicto (insensible a mayúsculas)', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'C&A' }, bd());
      await agregarDepartamentoCliente(sesion, c.id, { nombre: 'NIÑOS' }, bd());
      await expect(
        agregarDepartamentoCliente(sesion, c.id, { nombre: 'niños' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('el MISMO nombre SÍ puede existir en clientes distintos', async () => {
      const sesion = sesionAdmin();
      const a = await crearCliente(sesion, { nombre: 'C&A' }, bd());
      const b = await crearCliente(sesion, { nombre: 'Suburbia' }, bd());
      await agregarDepartamentoCliente(sesion, a.id, { nombre: 'NIÑOS' }, bd());
      await expect(
        agregarDepartamentoCliente(sesion, b.id, { nombre: 'NIÑOS' }, bd()),
      ).resolves.toMatchObject({ nombre: 'NIÑOS' });
    });

    it('no se pueden agregar departamentos a un cliente DESACTIVADO → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'C&A' }, bd());
      await desactivarCliente(sesion, c.id, bd());
      await expect(
        agregarDepartamentoCliente(sesion, c.id, { nombre: 'NIÑOS' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('agregar departamento a un cliente inexistente → ErrorNoEncontrado', async () => {
      await expect(
        agregarDepartamentoCliente(sesionAdmin(), 9999, { nombre: 'NIÑOS' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('actualizar', () => {
    it('cambia el nombre con bitácora del detalle', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'C&A' }, bd());
      const dep = await agregarDepartamentoCliente(sesion, c.id, { nombre: 'Viejo' }, bd());

      const actualizado = await actualizarDepartamentoCliente(
        sesion,
        c.id,
        { id: dep.id, nombre: 'Nuevo' },
        bd(),
      );
      expect(actualizado.nombre).toBe('Nuevo');

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Cliente', idEntidad: String(c.id), accion: 'MODIFICAR' },
        orderBy: { fecha: 'desc' },
      });
      expect(bitacora.datos).toMatchObject({
        departamento: 'modificar',
        nombre: { de: 'Viejo', a: 'Nuevo' },
      });
    });

    it('cambiar el nombre a uno ya usado en el mismo cliente → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'C&A' }, bd());
      await agregarDepartamentoCliente(sesion, c.id, { nombre: 'Uno' }, bd());
      const dos = await agregarDepartamentoCliente(sesion, c.id, { nombre: 'Dos' }, bd());
      await expect(
        actualizarDepartamentoCliente(sesion, c.id, { id: dos.id, nombre: 'Uno' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('un departamento de OTRO cliente no se toca → ErrorNoEncontrado', async () => {
      const sesion = sesionAdmin();
      const a = await crearCliente(sesion, { nombre: 'C&A' }, bd());
      const b = await crearCliente(sesion, { nombre: 'Suburbia' }, bd());
      const depA = await agregarDepartamentoCliente(sesion, a.id, { nombre: 'NIÑOS' }, bd());
      await expect(
        actualizarDepartamentoCliente(sesion, b.id, { id: depA.id, nombre: 'OTRO' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });

    it('sin cambio real es idempotente: no escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'C&A' }, bd());
      const dep = await agregarDepartamentoCliente(sesion, c.id, { nombre: 'NIÑOS' }, bd());
      const antes = await cliente.bitacora.count();
      await actualizarDepartamentoCliente(sesion, c.id, { id: dep.id, nombre: 'NIÑOS' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });
  });

  describe('desactivar / reactivar (borrado suave)', () => {
    it('desactiva y reactiva un departamento; el registro sigue existiendo', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'C&A' }, bd());
      const dep = await agregarDepartamentoCliente(sesion, c.id, { nombre: 'NIÑOS' }, bd());

      const desactivado = await desactivarDepartamentoCliente(sesion, c.id, dep.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.clienteDepartamento.count()).toBe(1);

      const reactivado = await reactivarDepartamentoCliente(sesion, c.id, dep.id, bd());
      expect(reactivado.activo).toBe(true);
    });

    it('desactivar un departamento dos veces → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'C&A' }, bd());
      const dep = await agregarDepartamentoCliente(sesion, c.id, { nombre: 'NIÑOS' }, bd());
      await desactivarDepartamentoCliente(sesion, c.id, dep.id, bd());
      await expect(
        desactivarDepartamentoCliente(sesion, c.id, dep.id, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('no se puede agregar un nombre que choca con un departamento DESACTIVADO (avisa reactivar)', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'C&A' }, bd());
      const dep = await agregarDepartamentoCliente(sesion, c.id, { nombre: 'NIÑOS' }, bd());
      await desactivarDepartamentoCliente(sesion, c.id, dep.id, bd());
      await expect(
        agregarDepartamentoCliente(sesion, c.id, { nombre: 'NIÑOS' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('listar', () => {
    it('excluye inactivos por defecto, los incluye si se pide; ordenado por nombre', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'C&A' }, bd());
      await agregarDepartamentoCliente(sesion, c.id, { nombre: 'DAMAS' }, bd());
      const ninos = await agregarDepartamentoCliente(sesion, c.id, { nombre: 'NIÑOS' }, bd());
      await desactivarDepartamentoCliente(sesion, c.id, ninos.id, bd());

      const activos = await listarDepartamentosCliente(sesion, c.id, {}, bd());
      expect(activos.map((d) => d.nombre)).toEqual(['DAMAS']);

      const todos = await listarDepartamentosCliente(
        sesion,
        c.id,
        { incluirInactivos: true },
        bd(),
      );
      expect(todos.map((d) => d.nombre)).toEqual(['DAMAS', 'NIÑOS']);
    });

    it('listar departamentos de un cliente inexistente → ErrorNoEncontrado', async () => {
      await expect(
        listarDepartamentosCliente(sesionAdmin(), 9999, {}, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('alta del cliente CON departamentos (A2 — misma transacción)', () => {
    it('crea el cliente y sus 2 departamentos juntos (mismo idCliente, activos)', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(
        sesion,
        { nombre: 'C&A', departamentos: ['NIÑOS', 'DAMAS'] },
        bd(),
      );

      const deps = await listarDepartamentosCliente(sesion, c.id, {}, bd());
      expect(deps.map((d) => d.nombre)).toEqual(['DAMAS', 'NIÑOS']); // listar ordena por nombre
      expect(deps.every((d) => d.activo && d.idCliente === c.id)).toBe(true);
      expect(await cliente.clienteDepartamento.count()).toBe(2);

      // Cada departamento deja su bitácora MODIFICAR (entidad Cliente), como el alta manual.
      const bitacoras = await cliente.bitacora.findMany({
        where: { entidad: 'Cliente', idEntidad: String(c.id), accion: 'MODIFICAR' },
      });
      expect(bitacoras).toHaveLength(2);
    });

    it('sin departamentos se comporta igual que antes (ninguno en BD)', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Liverpool' }, bd());
      expect(await listarDepartamentosCliente(sesion, c.id, {}, bd())).toEqual([]);
      expect(await cliente.clienteDepartamento.count()).toBe(0);
    });

    it('deduplica los nombres insensible a mayúsculas (conserva el primero)', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(
        sesion,
        { nombre: 'C&A', departamentos: ['NIÑOS', 'niños', 'DAMAS'] },
        bd(),
      );
      const deps = await listarDepartamentosCliente(sesion, c.id, { incluirInactivos: true }, bd());
      expect(deps.map((d) => d.nombre)).toEqual(['DAMAS', 'NIÑOS']);
      expect(await cliente.clienteDepartamento.count()).toBe(2);
    });

    it('un departamento inválido aborta TODA el alta: ni cliente ni departamentos (A2)', async () => {
      await expect(
        crearCliente(sesionAdmin(), { nombre: 'C&A', departamentos: ['NIÑOS', '   '] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.cliente.count()).toBe(0);
      expect(await cliente.clienteDepartamento.count()).toBe(0);
    });
  });
});
