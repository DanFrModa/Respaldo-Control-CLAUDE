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
  actualizarColor,
  crearColor,
  desactivarColor,
  listarColores,
  normalizarNombreColor,
  obtenerColor,
  reactivarColor,
} from './colores.js';

let cliente: PrismaClient;

const sesionAdmin = () => sesionDePrueba({ permisos: ['colores.ver', 'colores.administrar'] });

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

describe('Catálogo Colores (CRUD patrón, F1-E1 — global ADR-0007)', () => {
  describe('normalizarNombreColor (regla de dominio, sin BD)', () => {
    it('recorta extremos y colapsa espacios internos', () => {
      expect(normalizarNombreColor('  NEGRO   AZUL ')).toBe('NEGRO AZUL');
      expect(normalizarNombreColor('ROJO')).toBe('ROJO');
      expect(normalizarNombreColor('VERDE\t\tLIMA')).toBe('VERDE LIMA');
    });
  });

  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba();
      await expect(crearColor(sinPermisos, { nombre: 'NEGRO' }, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      await expect(listarColores(sinPermisos, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['colores.ver'] });
      await expect(crearColor(soloVer, { nombre: 'NEGRO' }, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      await expect(listarColores(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear', () => {
    it('crea con auditoría y bitácora (A7)', async () => {
      const sesion = sesionAdmin();
      const color = await crearColor(sesion, { nombre: 'NEGRO' }, bd());

      expect(color).toMatchObject({ nombre: 'NEGRO', activo: true, creadoPorId: sesion.id });

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Color', idEntidad: String(color.id), accion: 'CREAR' },
      });
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    it('REGLA: normaliza espacios internos antes de guardar', async () => {
      const color = await crearColor(sesionAdmin(), { nombre: 'NEGRO   AZUL' }, bd());
      expect(color.nombre).toBe('NEGRO AZUL');
    });

    it('REGLA: dos variantes que normalizan igual chocan → ErrorConflicto', async () => {
      await crearColor(sesionAdmin(), { nombre: 'NEGRO AZUL' }, bd());
      // "NEGRO   AZUL" (espacios extra) normaliza a "NEGRO AZUL" → duplicado.
      await expect(
        crearColor(sesionAdmin(), { nombre: 'NEGRO   AZUL' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('valida la entrada (Zod) → ErrorValidacion', async () => {
      await expect(crearColor(sesionAdmin(), { nombre: '   ' }, bd())).rejects.toBeInstanceOf(
        ErrorValidacion,
      );
    });

    it('rechaza nombre duplicado, sin importar mayúsculas → ErrorConflicto', async () => {
      await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      await expect(crearColor(sesionAdmin(), { nombre: 'negro' }, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });
  });

  describe('actualizar', () => {
    it('cambia el nombre (normalizado) con bitácora del detalle', async () => {
      const sesion = sesionAdmin();
      const color = await crearColor(sesion, { nombre: 'NEGRO' }, bd());

      const actualizado = await actualizarColor(
        sesion,
        { id: color.id, nombre: 'AZUL  REY' },
        bd(),
      );
      expect(actualizado.nombre).toBe('AZUL REY');

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Color', idEntidad: String(color.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({ nombre: { de: 'NEGRO', a: 'AZUL REY' } });
    });

    it('cambiar solo a la forma normalizada del mismo nombre es idempotente', async () => {
      const sesion = sesionAdmin();
      const color = await crearColor(sesion, { nombre: 'AZUL REY' }, bd());
      const antes = await cliente.bitacora.count();

      // "AZUL  REY" normaliza a "AZUL REY" (= actual): nada cambia, sin bitácora.
      await actualizarColor(sesion, { id: color.id, nombre: 'AZUL  REY' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });
  });

  describe('desactivar / reactivar (borrado suave, PLANMAESTRO §4)', () => {
    it('desactiva y el registro sigue existiendo', async () => {
      const sesion = sesionAdmin();
      const color = await crearColor(sesion, { nombre: 'NEGRO' }, bd());

      const desactivado = await desactivarColor(sesion, color.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.color.count()).toBe(1);

      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Color', idEntidad: String(color.id), accion: 'DESACTIVAR' },
      });
    });

    it('el nombre de un color desactivado sigue RESERVADO', async () => {
      const sesion = sesionAdmin();
      const color = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      await desactivarColor(sesion, color.id, bd());

      await expect(crearColor(sesion, { nombre: 'NEGRO' }, bd())).rejects.toThrow(
        /desactivado.*reactivarlo/,
      );
    });

    it('reactivar funciona', async () => {
      const sesion = sesionAdmin();
      const color = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      await desactivarColor(sesion, color.id, bd());
      const reactivado = await reactivarColor(sesion, color.id, bd());
      expect(reactivado.activo).toBe(true);
    });
  });

  describe('obtener / listar', () => {
    it('obtiene por id o lanza ErrorNoEncontrado', async () => {
      const sesion = sesionAdmin();
      const color = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      expect((await obtenerColor(sesion, color.id, bd())).id).toBe(color.id);
      await expect(obtenerColor(sesion, 9999, bd())).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });

    it('busca, pagina y ordena EN SERVIDOR', async () => {
      const sesion = sesionAdmin();
      await crearColor(sesion, { nombre: 'AMARILLO' }, bd());
      const beta = await crearColor(sesion, { nombre: 'BLANCO' }, bd());
      await crearColor(sesion, { nombre: 'ZAFIRO' }, bd());
      await desactivarColor(sesion, beta.id, bd());

      expect((await listarColores(sesion, {}, bd())).total).toBe(2);
      expect((await listarColores(sesion, { incluirInactivos: true }, bd())).total).toBe(3);
      expect((await listarColores(sesion, { busqueda: 'amar' }, bd())).total).toBe(1);

      const desc = await listarColores(sesion, { ordenarPor: 'nombre', direccion: 'desc' }, bd());
      expect(desc.datos.map((c) => c.nombre)).toEqual(['ZAFIRO', 'AMARILLO']);
    });
  });
});
