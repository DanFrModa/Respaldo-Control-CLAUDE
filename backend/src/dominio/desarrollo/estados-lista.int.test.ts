/**
 * Tests de integración del CRUD de Estados de lista de precios (F8-E1a). Postgres efímero
 * (testcontainers). Cubre el patrón CRUD + la bandera `esCierre` editable por API (config).
 */
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
  actualizarEstadoLista,
  crearEstadoLista,
  desactivarEstadoLista,
  listarEstadosLista,
  obtenerEstadoLista,
  reactivarEstadoLista,
} from './estados-lista.js';

let cliente: PrismaClient;

/** Puede administrar el catálogo (`estado-lista.administrar` incluye `.ver`). */
const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['estado-lista.ver', 'estado-lista.administrar'] });

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

describe('CRUD Estados de lista (F8-E1a, CRUD patrón)', () => {
  describe('permisos (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sin = sesionDePrueba();
      await expect(
        crearEstadoLista(sin, { codigo: 'x', nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarEstadosLista(sin, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['estado-lista.ver'] });
      await expect(
        crearEstadoLista(soloVer, { codigo: 'x', nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarEstadosLista(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear', () => {
    it('crea con defaults (esCierre=false, orden=0, activo=true) y bitácora (A7)', async () => {
      const estado = await crearEstadoLista(
        sesionAdmin(),
        { codigo: 'abierta', nombre: 'Abierta' },
        bd(),
      );
      expect(estado).toMatchObject({ codigo: 'abierta', esCierre: false, orden: 0, activo: true });
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'EstadoLista', idEntidad: String(estado.id), accion: 'CREAR' },
      });
    });

    it('respeta esCierre=true y orden al crear', async () => {
      const estado = await crearEstadoLista(
        sesionAdmin(),
        { codigo: 'cerrada', nombre: 'Cerrada', esCierre: true, orden: 3 },
        bd(),
      );
      expect(estado.esCierre).toBe(true);
      expect(estado.orden).toBe(3);
    });

    it('rechaza código duplicado → ErrorConflicto', async () => {
      await crearEstadoLista(sesionAdmin(), { codigo: 'dup-test', nombre: 'Dup' }, bd());
      await expect(
        crearEstadoLista(sesionAdmin(), { codigo: 'dup-test', nombre: 'Otro' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('rechaza código en mayúsculas → ErrorValidacion (lowercase-only por diseño)', async () => {
      await expect(
        crearEstadoLista(sesionAdmin(), { codigo: 'ABIERTA', nombre: 'Abierta' }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });

  describe('actualizar', () => {
    it('cambia esCierre (config editable) y deja bitácora MODIFICAR', async () => {
      const estado = await crearEstadoLista(
        sesionAdmin(),
        { codigo: 'en-negociacion', nombre: 'En negociación' },
        bd(),
      );
      const actualizado = await actualizarEstadoLista(
        sesionAdmin(),
        { id: estado.id, esCierre: true },
        bd(),
      );
      expect(actualizado.esCierre).toBe(true);
      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'EstadoLista', idEntidad: String(estado.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({ esCierre: { de: false, a: true } });
    });

    it('sin cambio real es idempotente: no escribe bitácora', async () => {
      const estado = await crearEstadoLista(
        sesionAdmin(),
        { codigo: 'abierta', nombre: 'Abierta' },
        bd(),
      );
      const antes = await cliente.bitacora.count();
      await actualizarEstadoLista(sesionAdmin(), { id: estado.id, nombre: 'Abierta' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(
        actualizarEstadoLista(sesionAdmin(), { id: 9999, nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('desactivar / reactivar (borrado suave)', () => {
    it('desactiva, conserva el registro y reserva el código', async () => {
      const sesion = sesionAdmin();
      const estado = await crearEstadoLista(sesion, { codigo: 'abierta', nombre: 'Abierta' }, bd());
      const desactivado = await desactivarEstadoLista(sesion, estado.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.estadoLista.count()).toBe(1);
      await expect(
        crearEstadoLista(sesion, { codigo: 'abierta', nombre: 'Otra' }, bd()),
      ).rejects.toThrow(/desactivado.*reactivarlo/);
      const reactivado = await reactivarEstadoLista(sesion, estado.id, bd());
      expect(reactivado.activo).toBe(true);
    });
  });

  describe('obtener / listar', () => {
    it('obtiene por id o lanza, y lista con búsqueda/orden/paginación', async () => {
      const sesion = sesionAdmin();
      const abierta = await crearEstadoLista(
        sesion,
        { codigo: 'abierta', nombre: 'Abierta' },
        bd(),
      );
      await crearEstadoLista(sesion, { codigo: 'en-negociacion', nombre: 'En negociación' }, bd());
      const cerrada = await crearEstadoLista(
        sesion,
        { codigo: 'cerrada', nombre: 'Cerrada' },
        bd(),
      );
      await desactivarEstadoLista(sesion, cerrada.id, bd());

      expect((await obtenerEstadoLista(sesion, abierta.id, bd())).codigo).toBe('abierta');
      await expect(obtenerEstadoLista(sesion, 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );

      expect((await listarEstadosLista(sesion, {}, bd())).total).toBe(2); // solo activos
      expect((await listarEstadosLista(sesion, { incluirInactivos: true }, bd())).total).toBe(3);
      expect((await listarEstadosLista(sesion, { busqueda: 'abier' }, bd())).total).toBe(1);
    });
  });
});
