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
  actualizarTemporada,
  crearTemporada,
  desactivarTemporada,
  listarTemporadas,
  obtenerTemporada,
  reactivarTemporada,
} from './temporadas.js';

let cliente: PrismaClient;

const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['temporadas.ver', 'temporadas.administrar'] });

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

describe('Catálogo Temporadas (CRUD patrón, F1-E1 — global ADR-0007)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba();
      await expect(crearTemporada(sinPermisos, { nombre: 'X' }, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      await expect(listarTemporadas(sinPermisos, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['temporadas.ver'] });
      await expect(crearTemporada(soloVer, { nombre: 'X' }, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      await expect(listarTemporadas(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear', () => {
    it('crea con auditoría y bitácora (A7)', async () => {
      const sesion = sesionAdmin();
      const temporada = await crearTemporada(sesion, { nombre: 'Primavera 2026' }, bd());

      expect(temporada).toMatchObject({
        nombre: 'Primavera 2026',
        activo: true,
        creadoPorId: sesion.id,
      });

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Temporada', idEntidad: String(temporada.id), accion: 'CREAR' },
      });
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    it('valida la entrada (Zod) → ErrorValidacion', async () => {
      await expect(crearTemporada(sesionAdmin(), { nombre: '' }, bd())).rejects.toBeInstanceOf(
        ErrorValidacion,
      );
    });

    it('rechaza nombre duplicado, sin importar mayúsculas → ErrorConflicto', async () => {
      await crearTemporada(sesionAdmin(), { nombre: 'Verano' }, bd());
      await expect(
        crearTemporada(sesionAdmin(), { nombre: 'VERANO' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('actualizar', () => {
    it('cambia el nombre con bitácora del detalle', async () => {
      const sesion = sesionAdmin();
      const temporada = await crearTemporada(sesion, { nombre: 'Verano' }, bd());

      const actualizado = await actualizarTemporada(
        sesion,
        { id: temporada.id, nombre: 'Verano 2026' },
        bd(),
      );
      expect(actualizado.nombre).toBe('Verano 2026');

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Temporada', idEntidad: String(temporada.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({ nombre: { de: 'Verano', a: 'Verano 2026' } });
    });

    it('sin cambio real es idempotente: no escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const temporada = await crearTemporada(sesion, { nombre: 'Verano' }, bd());
      const antes = await cliente.bitacora.count();

      await actualizarTemporada(sesion, { id: temporada.id, nombre: 'Verano' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(
        actualizarTemporada(sesionAdmin(), { id: 9999, nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('desactivar / reactivar (borrado suave, PLANMAESTRO §4)', () => {
    it('desactiva con bitácora y el registro sigue existiendo', async () => {
      const sesion = sesionAdmin();
      const temporada = await crearTemporada(sesion, { nombre: 'Verano' }, bd());

      const desactivado = await desactivarTemporada(sesion, temporada.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.temporada.count()).toBe(1);

      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Temporada', idEntidad: String(temporada.id), accion: 'DESACTIVAR' },
      });
    });

    it('el nombre de una temporada desactivada sigue RESERVADO', async () => {
      const sesion = sesionAdmin();
      const temporada = await crearTemporada(sesion, { nombre: 'Verano' }, bd());
      await desactivarTemporada(sesion, temporada.id, bd());

      await expect(crearTemporada(sesion, { nombre: 'Verano' }, bd())).rejects.toThrow(
        /desactivada.*reactivarla/,
      );
    });

    it('reactivar funciona', async () => {
      const sesion = sesionAdmin();
      const temporada = await crearTemporada(sesion, { nombre: 'Verano' }, bd());
      await desactivarTemporada(sesion, temporada.id, bd());
      const reactivado = await reactivarTemporada(sesion, temporada.id, bd());
      expect(reactivado.activo).toBe(true);
    });
  });

  describe('obtener / listar', () => {
    it('obtiene por id o lanza ErrorNoEncontrado', async () => {
      const sesion = sesionAdmin();
      const temporada = await crearTemporada(sesion, { nombre: 'Verano' }, bd());
      expect((await obtenerTemporada(sesion, temporada.id, bd())).id).toBe(temporada.id);
      await expect(obtenerTemporada(sesion, 9999, bd())).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });

    it('busca, pagina y ordena EN SERVIDOR', async () => {
      const sesion = sesionAdmin();
      await crearTemporada(sesion, { nombre: 'Alfa' }, bd());
      const beta = await crearTemporada(sesion, { nombre: 'Beta' }, bd());
      await crearTemporada(sesion, { nombre: 'Zeta' }, bd());
      await desactivarTemporada(sesion, beta.id, bd());

      expect((await listarTemporadas(sesion, {}, bd())).total).toBe(2);
      expect((await listarTemporadas(sesion, { incluirInactivos: true }, bd())).total).toBe(3);
      expect((await listarTemporadas(sesion, { busqueda: 'alf' }, bd())).total).toBe(1);

      const desc = await listarTemporadas(
        sesion,
        { ordenarPor: 'nombre', direccion: 'desc' },
        bd(),
      );
      expect(desc.datos.map((t) => t.nombre)).toEqual(['Zeta', 'Alfa']);
    });
  });
});
