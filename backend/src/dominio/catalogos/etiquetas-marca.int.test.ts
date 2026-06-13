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
  actualizarEtiquetaMarca,
  crearEtiquetaMarca,
  desactivarEtiquetaMarca,
  listarEtiquetasMarca,
  obtenerEtiquetaMarca,
  reactivarEtiquetaMarca,
} from './etiquetas-marca.js';

let cliente: PrismaClient;

const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['etiquetas-marca.ver', 'etiquetas-marca.administrar'] });

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

describe('Catálogo Etiquetas de marca (CRUD patrón, F1-E1 — global ADR-0007)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba();
      await expect(
        crearEtiquetaMarca(sinPermisos, { nombre: 'X', regalias: 5 }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarEtiquetasMarca(sinPermisos, {}, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['etiquetas-marca.ver'] });
      await expect(
        crearEtiquetaMarca(soloVer, { nombre: 'X', regalias: 5 }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarEtiquetasMarca(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear', () => {
    it('crea con regalías (Decimal) y bitácora (A7)', async () => {
      const sesion = sesionAdmin();
      const etiqueta = await crearEtiquetaMarca(
        sesion,
        { nombre: 'Marilyn', regalias: 12.5 },
        bd(),
      );

      expect(etiqueta.nombre).toBe('Marilyn');
      expect(etiqueta.regalias.toNumber()).toBe(12.5);
      expect(etiqueta.activo).toBe(true);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'EtiquetaMarca', idEntidad: String(etiqueta.id), accion: 'CREAR' },
      });
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    it('por omisión las regalías son 0', async () => {
      const etiqueta = await crearEtiquetaMarca(sesionAdmin(), { nombre: 'MJD' }, bd());
      expect(etiqueta.regalias.toNumber()).toBe(0);
    });

    it('acepta los extremos válidos 0 y 100', async () => {
      const cero = await crearEtiquetaMarca(sesionAdmin(), { nombre: 'Cero', regalias: 0 }, bd());
      const cien = await crearEtiquetaMarca(sesionAdmin(), { nombre: 'Cien', regalias: 100 }, bd());
      expect(cero.regalias.toNumber()).toBe(0);
      expect(cien.regalias.toNumber()).toBe(100);
    });

    it('REGLA: rechaza regalías fuera de 0–100 → ErrorValidacion', async () => {
      await expect(
        crearEtiquetaMarca(sesionAdmin(), { nombre: 'Alta', regalias: 150 }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      await expect(
        crearEtiquetaMarca(sesionAdmin(), { nombre: 'Negativa', regalias: -1 }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza nombre duplicado, sin importar mayúsculas → ErrorConflicto', async () => {
      await crearEtiquetaMarca(sesionAdmin(), { nombre: 'Marilyn', regalias: 5 }, bd());
      await expect(
        crearEtiquetaMarca(sesionAdmin(), { nombre: 'marilyn', regalias: 10 }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('actualizar', () => {
    it('cambia las regalías con bitácora del detalle', async () => {
      const sesion = sesionAdmin();
      const etiqueta = await crearEtiquetaMarca(sesion, { nombre: 'Marca', regalias: 10 }, bd());

      const actualizado = await actualizarEtiquetaMarca(
        sesion,
        { id: etiqueta.id, regalias: 15 },
        bd(),
      );
      expect(actualizado.regalias.toNumber()).toBe(15);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'EtiquetaMarca', idEntidad: String(etiqueta.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({ regalias: { de: 10, a: 15 } });
    });

    it('REGLA: rechaza regalías fuera de 0–100 en edición → ErrorValidacion', async () => {
      const sesion = sesionAdmin();
      const etiqueta = await crearEtiquetaMarca(sesion, { nombre: 'Marca', regalias: 10 }, bd());
      await expect(
        actualizarEtiquetaMarca(sesion, { id: etiqueta.id, regalias: 200 }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('mismas regalías es idempotente: no escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const etiqueta = await crearEtiquetaMarca(sesion, { nombre: 'Marca', regalias: 10 }, bd());
      const antes = await cliente.bitacora.count();

      await actualizarEtiquetaMarca(sesion, { id: etiqueta.id, regalias: 10 }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });
  });

  describe('desactivar / reactivar (borrado suave, PLANMAESTRO §4)', () => {
    it('desactiva y el registro sigue existiendo', async () => {
      const sesion = sesionAdmin();
      const etiqueta = await crearEtiquetaMarca(sesion, { nombre: 'Marca', regalias: 5 }, bd());

      const desactivado = await desactivarEtiquetaMarca(sesion, etiqueta.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.etiquetaMarca.count()).toBe(1);

      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'EtiquetaMarca', idEntidad: String(etiqueta.id), accion: 'DESACTIVAR' },
      });
    });

    it('desactivar dos veces → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const etiqueta = await crearEtiquetaMarca(sesion, { nombre: 'Marca', regalias: 5 }, bd());
      await desactivarEtiquetaMarca(sesion, etiqueta.id, bd());
      await expect(desactivarEtiquetaMarca(sesion, etiqueta.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });

    it('reactivar funciona', async () => {
      const sesion = sesionAdmin();
      const etiqueta = await crearEtiquetaMarca(sesion, { nombre: 'Marca', regalias: 5 }, bd());
      await desactivarEtiquetaMarca(sesion, etiqueta.id, bd());
      const reactivado = await reactivarEtiquetaMarca(sesion, etiqueta.id, bd());
      expect(reactivado.activo).toBe(true);
    });
  });

  describe('obtener / listar', () => {
    it('obtiene por id o lanza ErrorNoEncontrado', async () => {
      const sesion = sesionAdmin();
      const etiqueta = await crearEtiquetaMarca(sesion, { nombre: 'Marca', regalias: 5 }, bd());
      expect((await obtenerEtiquetaMarca(sesion, etiqueta.id, bd())).id).toBe(etiqueta.id);
      await expect(obtenerEtiquetaMarca(sesion, 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });

    it('busca, excluye inactivos por defecto y ordena por regalías', async () => {
      const sesion = sesionAdmin();
      await crearEtiquetaMarca(sesion, { nombre: 'Alfa', regalias: 30 }, bd());
      const beta = await crearEtiquetaMarca(sesion, { nombre: 'Beta', regalias: 20 }, bd());
      await crearEtiquetaMarca(sesion, { nombre: 'Gama', regalias: 10 }, bd());
      await desactivarEtiquetaMarca(sesion, beta.id, bd());

      expect((await listarEtiquetasMarca(sesion, {}, bd())).total).toBe(2);
      expect((await listarEtiquetasMarca(sesion, { incluirInactivos: true }, bd())).total).toBe(3);

      const porReg = await listarEtiquetasMarca(
        sesion,
        { ordenarPor: 'regalias', direccion: 'asc' },
        bd(),
      );
      expect(porReg.datos.map((e) => e.nombre)).toEqual(['Gama', 'Alfa']);
    });
  });
});
