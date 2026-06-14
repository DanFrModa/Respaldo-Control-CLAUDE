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
  actualizarCortador,
  crearCortador,
  desactivarCortador,
  listarCortadores,
  obtenerCortador,
  reactivarCortador,
} from './cortadores.js';

let cliente: PrismaClient;

const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['cortadores.ver', 'cortadores.administrar'] });

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

describe('Catálogo Cortadores (CRUD patrón, F1-E1 — global ADR-0007)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba();
      await expect(crearCortador(sinPermisos, { nombre: 'X' }, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      await expect(listarCortadores(sinPermisos, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['cortadores.ver'] });
      await expect(crearCortador(soloVer, { nombre: 'X' }, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      await expect(listarCortadores(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear', () => {
    it('crea con precio de referencia (Decimal) y bitácora (A7)', async () => {
      const sesion = sesionAdmin();
      const cortador = await crearCortador(
        sesion,
        { nombre: 'Juan Corte', precioReferencia: 12.5, telefonos: '555' },
        bd(),
      );

      expect(cortador.nombre).toBe('Juan Corte');
      expect(cortador.precioReferencia?.toNumber()).toBe(12.5);
      expect(cortador.activo).toBe(true);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Cortador', idEntidad: String(cortador.id), accion: 'CREAR' },
      });
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    it('permite crear sin precio (queda null)', async () => {
      const cortador = await crearCortador(sesionAdmin(), { nombre: 'Sin Precio' }, bd());
      expect(cortador.precioReferencia).toBeNull();
    });

    it('rechaza precio negativo (Zod) → ErrorValidacion', async () => {
      await expect(
        crearCortador(sesionAdmin(), { nombre: 'X', precioReferencia: -5 }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza nombre duplicado, sin importar mayúsculas → ErrorConflicto', async () => {
      await crearCortador(sesionAdmin(), { nombre: 'Juan Corte' }, bd());
      await expect(
        crearCortador(sesionAdmin(), { nombre: 'juan corte' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('actualizar', () => {
    it('cambia el precio con bitácora del detalle', async () => {
      const sesion = sesionAdmin();
      const cortador = await crearCortador(sesion, { nombre: 'Corte', precioReferencia: 10 }, bd());

      const actualizado = await actualizarCortador(
        sesion,
        { id: cortador.id, precioReferencia: 20 },
        bd(),
      );
      expect(actualizado.precioReferencia?.toNumber()).toBe(20);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Cortador', idEntidad: String(cortador.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({ precioReferencia: { de: 10, a: 20 } });
    });

    it('mismo precio es idempotente: no escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const cortador = await crearCortador(sesion, { nombre: 'Corte', precioReferencia: 10 }, bd());
      const antes = await cliente.bitacora.count();

      await actualizarCortador(sesion, { id: cortador.id, precioReferencia: 10 }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('rechaza chocar con un nombre existente → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      await crearCortador(sesion, { nombre: 'Corte A' }, bd());
      const b = await crearCortador(sesion, { nombre: 'Corte B' }, bd());
      await expect(
        actualizarCortador(sesion, { id: b.id, nombre: 'CORTE A' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('desactivar / reactivar (borrado suave, PLANMAESTRO §4)', () => {
    it('desactiva con bitácora DESACTIVAR; el registro sigue existiendo', async () => {
      const sesion = sesionAdmin();
      const cortador = await crearCortador(sesion, { nombre: 'Corte' }, bd());

      const desactivado = await desactivarCortador(sesion, cortador.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.cortador.count()).toBe(1);

      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Cortador', idEntidad: String(cortador.id), accion: 'DESACTIVAR' },
      });
    });

    it('desactivar dos veces → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const cortador = await crearCortador(sesion, { nombre: 'Corte' }, bd());
      await desactivarCortador(sesion, cortador.id, bd());
      await expect(desactivarCortador(sesion, cortador.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });

    it('reactivar un cortador desactivado funciona', async () => {
      const sesion = sesionAdmin();
      const cortador = await crearCortador(sesion, { nombre: 'Corte' }, bd());
      await desactivarCortador(sesion, cortador.id, bd());
      const reactivado = await reactivarCortador(sesion, cortador.id, bd());
      expect(reactivado.activo).toBe(true);
    });
  });

  describe('obtener', () => {
    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(obtenerCortador(sesionAdmin(), 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });
  });

  describe('listar (búsqueda + orden + paginación EN SERVIDOR)', () => {
    it('busca, excluye inactivos por defecto y ordena', async () => {
      const sesion = sesionAdmin();
      await crearCortador(sesion, { nombre: 'Alfa' }, bd());
      const beta = await crearCortador(sesion, { nombre: 'Beta' }, bd());
      await crearCortador(sesion, { nombre: 'Zeta' }, bd());
      await desactivarCortador(sesion, beta.id, bd());

      expect((await listarCortadores(sesion, {}, bd())).total).toBe(2);
      expect((await listarCortadores(sesion, { incluirInactivos: true }, bd())).total).toBe(3);
      expect((await listarCortadores(sesion, { busqueda: 'alf' }, bd())).total).toBe(1);

      const desc = await listarCortadores(
        sesion,
        { ordenarPor: 'nombre', direccion: 'desc' },
        bd(),
      );
      expect(desc.datos.map((c) => c.nombre)).toEqual(['Zeta', 'Alfa']);
    });
  });
});
