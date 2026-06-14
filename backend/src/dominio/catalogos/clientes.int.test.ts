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
import {
  actualizarCampoCliente,
  actualizarCliente,
  agregarCampoCliente,
  crearCliente,
  desactivarCampoCliente,
  desactivarCliente,
  listarCamposCliente,
  listarClientes,
  obtenerCliente,
  reactivarCampoCliente,
  reactivarCliente,
} from './clientes.js';

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

describe('Catálogo Clientes con campos de referencia (F1-E2 D7 — global ADR-0007)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba();
      await expect(crearCliente(sinPermisos, { nombre: 'X' }, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      await expect(listarClientes(sinPermisos, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['clientes.ver'] });
      await expect(crearCliente(soloVer, { nombre: 'X' }, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      await expect(listarClientes(soloVer, {}, bd())).resolves.toBeTruthy();
    });

    it('agregar un campo exige permiso de administrar', async () => {
      const admin = sesionAdmin();
      const c = await crearCliente(admin, { nombre: 'Liverpool' }, bd());
      const soloVer = sesionDePrueba({ permisos: ['clientes.ver'] });
      await expect(
        agregarCampoCliente(soloVer, c.id, { etiqueta: 'No. pedido' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
    });
  });

  describe('crear', () => {
    it('crea con datos de contacto, auditoría y bitácora (A7); nace sin campos', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(
        sesion,
        { nombre: 'Liverpool', contacto: 'Ana', telefono: '555-1', email: 'a@liver.mx' },
        bd(),
      );

      expect(c).toMatchObject({
        nombre: 'Liverpool',
        contacto: 'Ana',
        telefono: '555-1',
        email: 'a@liver.mx',
        activo: true,
        creadoPorId: sesion.id,
      });
      expect(c.campos).toEqual([]);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Cliente', idEntidad: String(c.id), accion: 'CREAR' },
      });
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    it('permite crear solo con nombre (contacto queda null)', async () => {
      const c = await crearCliente(sesionAdmin(), { nombre: 'Pumas' }, bd());
      expect(c.contacto).toBeNull();
      expect(c.email).toBeNull();
    });

    it('rechaza email inválido (Zod) → ErrorValidacion', async () => {
      await expect(
        crearCliente(sesionAdmin(), { nombre: 'X', email: 'no-es-email' }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza nombre duplicado, sin importar mayúsculas → ErrorConflicto', async () => {
      await crearCliente(sesionAdmin(), { nombre: 'Liverpool' }, bd());
      await expect(
        crearCliente(sesionAdmin(), { nombre: 'liverpool' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('actualizar (contacto M1 + activo)', () => {
    it('vaciar un campo opcional (null) lo BORRA; omitirlo no lo toca', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(
        sesion,
        { nombre: 'Con datos', telefono: '555-1234', email: 'x@y.mx', contacto: 'Ana' },
        bd(),
      );

      const actualizado = await actualizarCliente(
        sesion,
        { id: c.id, telefono: null, email: null },
        bd(),
      );
      expect(actualizado.telefono).toBeNull();
      expect(actualizado.email).toBeNull();
      // contacto no se tocó (se omitió).
      expect(actualizado.contacto).toBe('Ana');

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Cliente', idEntidad: String(c.id), accion: 'MODIFICAR' },
        orderBy: { fecha: 'desc' },
      });
      expect(bitacora.datos).toMatchObject({ telefono: { de: '555-1234', a: null } });
    });

    it('un texto opcional que llega vacío ("") se normaliza a null (nunca se guarda "")', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Vacío', contacto: 'Beto' }, bd());

      const actualizado = await actualizarCliente(sesion, { id: c.id, contacto: '' }, bd());
      expect(actualizado.contacto).toBeNull();

      const enBd = await cliente.cliente.findUniqueOrThrow({ where: { id: c.id } });
      expect(enBd.contacto).toBeNull();
    });

    it('sin cambio real es idempotente: no escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Pumas' }, bd());
      const antes = await cliente.bitacora.count();
      await actualizarCliente(sesion, { id: c.id, nombre: 'Pumas' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('rechaza chocar con un nombre existente → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      await crearCliente(sesion, { nombre: 'Cliente A' }, bd());
      const b = await crearCliente(sesion, { nombre: 'Cliente B' }, bd());
      await expect(
        actualizarCliente(sesion, { id: b.id, nombre: 'CLIENTE A' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(
        actualizarCliente(sesionAdmin(), { id: 9999, nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('desactivar / reactivar (borrado suave, PLANMAESTRO §4)', () => {
    it('desactiva con bitácora DESACTIVAR; el registro sigue existiendo', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Pumas' }, bd());

      const desactivado = await desactivarCliente(sesion, c.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.cliente.count()).toBe(1);

      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Cliente', idEntidad: String(c.id), accion: 'DESACTIVAR' },
      });
    });

    it('desactivar dos veces → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Pumas' }, bd());
      await desactivarCliente(sesion, c.id, bd());
      await expect(desactivarCliente(sesion, c.id, bd())).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('reactivar un cliente desactivado funciona', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Pumas' }, bd());
      await desactivarCliente(sesion, c.id, bd());
      const reactivado = await reactivarCliente(sesion, c.id, bd());
      expect(reactivado.activo).toBe(true);
    });
  });

  describe('obtener', () => {
    it('devuelve el cliente con sus campos ordenados por orden', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Liverpool' }, bd());
      await agregarCampoCliente(sesion, c.id, { etiqueta: 'B', orden: 2 }, bd());
      await agregarCampoCliente(sesion, c.id, { etiqueta: 'A', orden: 1 }, bd());

      const obtenido = await obtenerCliente(sesion, c.id, bd());
      expect(obtenido.campos.map((campo) => campo.etiqueta)).toEqual(['A', 'B']);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(obtenerCliente(sesionAdmin(), 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });
  });

  describe('listar (búsqueda + orden + paginación EN SERVIDOR)', () => {
    it('busca, excluye inactivos por defecto y ordena', async () => {
      const sesion = sesionAdmin();
      await crearCliente(sesion, { nombre: 'Alfa' }, bd());
      const beta = await crearCliente(sesion, { nombre: 'Beta' }, bd());
      await crearCliente(sesion, { nombre: 'Zeta' }, bd());
      await desactivarCliente(sesion, beta.id, bd());

      expect((await listarClientes(sesion, {}, bd())).total).toBe(2);
      expect((await listarClientes(sesion, { incluirInactivos: true }, bd())).total).toBe(3);
      expect((await listarClientes(sesion, { busqueda: 'alf' }, bd())).total).toBe(1);

      const desc = await listarClientes(sesion, { ordenarPor: 'nombre', direccion: 'desc' }, bd());
      expect(desc.datos.map((c) => c.nombre)).toEqual(['Zeta', 'Alfa']);
    });

    it('pagina en servidor', async () => {
      const sesion = sesionAdmin();
      for (let i = 1; i <= 5; i += 1) {
        await crearCliente(sesion, { nombre: `Cliente ${String(i).padStart(2, '0')}` }, bd());
      }
      const pagina = await listarClientes(sesion, { pagina: 1, porPagina: 2 }, bd());
      expect(pagina.datos).toHaveLength(2);
      expect(pagina.total).toBe(5);
      expect(pagina.totalPaginas).toBe(3);
    });
  });

  describe('campos de referencia (D7)', () => {
    it('agrega un campo: coloca al final, con bitácora MODIFICAR', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Liverpool' }, bd());

      const primero = await agregarCampoCliente(
        sesion,
        c.id,
        { etiqueta: 'No. pedido', tipo: 'TEXTO' },
        bd(),
      );
      const segundo = await agregarCampoCliente(sesion, c.id, { etiqueta: 'Cedis' }, bd());

      expect(primero.orden).toBe(0);
      expect(segundo.orden).toBe(1);
      expect(segundo.tipo).toBe('TEXTO'); // default

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Cliente', idEntidad: String(c.id), accion: 'MODIFICAR' },
        orderBy: { fecha: 'asc' },
      });
      expect(bitacora.datos).toMatchObject({ campo: 'agregar', etiqueta: 'No. pedido' });
    });

    it('respeta un orden explícito al agregar', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Liverpool' }, bd());
      const campo = await agregarCampoCliente(sesion, c.id, { etiqueta: 'X', orden: 7 }, bd());
      expect(campo.orden).toBe(7);
    });

    it('etiqueta DUPLICADA en el mismo cliente → ErrorConflicto (insensible a mayúsculas)', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Liverpool' }, bd());
      await agregarCampoCliente(sesion, c.id, { etiqueta: 'No. pedido' }, bd());
      await expect(
        agregarCampoCliente(sesion, c.id, { etiqueta: 'NO. PEDIDO' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('la MISMA etiqueta SÍ puede existir en clientes distintos', async () => {
      const sesion = sesionAdmin();
      const a = await crearCliente(sesion, { nombre: 'Liverpool' }, bd());
      const b = await crearCliente(sesion, { nombre: 'Pumas' }, bd());
      await agregarCampoCliente(sesion, a.id, { etiqueta: 'No. pedido' }, bd());
      await expect(
        agregarCampoCliente(sesion, b.id, { etiqueta: 'No. pedido' }, bd()),
      ).resolves.toMatchObject({ etiqueta: 'No. pedido' });
    });

    it('no se pueden agregar campos a un cliente DESACTIVADO → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Liverpool' }, bd());
      await desactivarCliente(sesion, c.id, bd());
      await expect(
        agregarCampoCliente(sesion, c.id, { etiqueta: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('agregar campo a un cliente inexistente → ErrorNoEncontrado', async () => {
      await expect(
        agregarCampoCliente(sesionAdmin(), 9999, { etiqueta: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });

    it('actualiza etiqueta/tipo/orden con bitácora del detalle', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Liverpool' }, bd());
      const campo = await agregarCampoCliente(sesion, c.id, { etiqueta: 'Viejo' }, bd());

      const actualizado = await actualizarCampoCliente(
        sesion,
        c.id,
        { id: campo.id, etiqueta: 'Nuevo', tipo: 'NUMERO', orden: 3 },
        bd(),
      );
      expect(actualizado).toMatchObject({ etiqueta: 'Nuevo', tipo: 'NUMERO', orden: 3 });

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Cliente', idEntidad: String(c.id), accion: 'MODIFICAR' },
        orderBy: { fecha: 'desc' },
      });
      expect(bitacora.datos).toMatchObject({
        campo: 'modificar',
        etiqueta: { de: 'Viejo', a: 'Nuevo' },
        tipo: { de: 'TEXTO', a: 'NUMERO' },
      });
    });

    it('cambiar la etiqueta a una ya usada en el mismo cliente → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Liverpool' }, bd());
      await agregarCampoCliente(sesion, c.id, { etiqueta: 'Uno' }, bd());
      const dos = await agregarCampoCliente(sesion, c.id, { etiqueta: 'Dos' }, bd());
      await expect(
        actualizarCampoCliente(sesion, c.id, { id: dos.id, etiqueta: 'Uno' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('actualizar un campo que es de OTRO cliente → ErrorNoEncontrado', async () => {
      const sesion = sesionAdmin();
      const a = await crearCliente(sesion, { nombre: 'Liverpool' }, bd());
      const b = await crearCliente(sesion, { nombre: 'Pumas' }, bd());
      const campoA = await agregarCampoCliente(sesion, a.id, { etiqueta: 'X' }, bd());
      await expect(
        actualizarCampoCliente(sesion, b.id, { id: campoA.id, etiqueta: 'Y' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });

    it('sin cambio real el campo es idempotente: no escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Liverpool' }, bd());
      const campo = await agregarCampoCliente(sesion, c.id, { etiqueta: 'X', tipo: 'TEXTO' }, bd());
      const antes = await cliente.bitacora.count();
      await actualizarCampoCliente(
        sesion,
        c.id,
        { id: campo.id, etiqueta: 'X', tipo: 'TEXTO' },
        bd(),
      );
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('desactiva y reactiva un campo (borrado suave); el registro sigue existiendo', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Liverpool' }, bd());
      const campo = await agregarCampoCliente(sesion, c.id, { etiqueta: 'X' }, bd());

      const desactivado = await desactivarCampoCliente(sesion, c.id, campo.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.clienteCampo.count()).toBe(1);

      const reactivado = await reactivarCampoCliente(sesion, c.id, campo.id, bd());
      expect(reactivado.activo).toBe(true);
    });

    it('desactivar un campo dos veces → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Liverpool' }, bd());
      const campo = await agregarCampoCliente(sesion, c.id, { etiqueta: 'X' }, bd());
      await desactivarCampoCliente(sesion, c.id, campo.id, bd());
      await expect(desactivarCampoCliente(sesion, c.id, campo.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });

    it('no se puede agregar una etiqueta que choca con un campo DESACTIVADO (avisa reactivar)', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Liverpool' }, bd());
      const campo = await agregarCampoCliente(sesion, c.id, { etiqueta: 'X' }, bd());
      await desactivarCampoCliente(sesion, c.id, campo.id, bd());
      await expect(
        agregarCampoCliente(sesion, c.id, { etiqueta: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('listar campos: excluye inactivos por defecto, los incluye si se pide; ordenado', async () => {
      const sesion = sesionAdmin();
      const c = await crearCliente(sesion, { nombre: 'Liverpool' }, bd());
      await agregarCampoCliente(sesion, c.id, { etiqueta: 'A', orden: 1 }, bd());
      const b = await agregarCampoCliente(sesion, c.id, { etiqueta: 'B', orden: 2 }, bd());
      await desactivarCampoCliente(sesion, c.id, b.id, bd());

      const activos = await listarCamposCliente(sesion, c.id, {}, bd());
      expect(activos.map((campo) => campo.etiqueta)).toEqual(['A']);

      const todos = await listarCamposCliente(sesion, c.id, { incluirInactivos: true }, bd());
      expect(todos.map((campo) => campo.etiqueta)).toEqual(['A', 'B']);
    });

    it('listar campos de un cliente inexistente → ErrorNoEncontrado', async () => {
      await expect(listarCamposCliente(sesionAdmin(), 9999, {}, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });
  });
});
