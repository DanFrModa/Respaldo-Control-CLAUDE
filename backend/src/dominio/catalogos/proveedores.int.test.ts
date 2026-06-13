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
  actualizarProveedor,
  crearProveedor,
  desactivarProveedor,
  listarProveedores,
  obtenerProveedor,
  reactivarProveedor,
} from './proveedores.js';

let cliente: PrismaClient;

const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['proveedores.ver', 'proveedores.administrar'] });

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

describe('Catálogo Proveedores (CRUD patrón, F1-E1 — global ADR-0007)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba();
      await expect(
        crearProveedor(sinPermisos, { nombre: 'X', tipo: 'TELAS' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarProveedores(sinPermisos, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['proveedores.ver'] });
      await expect(
        crearProveedor(soloVer, { nombre: 'X', tipo: 'TELAS' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarProveedores(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear', () => {
    it('crea con auditoría y bitácora (A7)', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        { nombre: 'Textiles SA', tipo: 'TELAS', telefono: '555-1234' },
        bd(),
      );

      expect(proveedor).toMatchObject({
        nombre: 'Textiles SA',
        tipo: 'TELAS',
        telefono: '555-1234',
        activo: true,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      });

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Proveedor', idEntidad: String(proveedor.id) },
      });
      expect(bitacora.accion).toBe('CREAR');
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    it('por omisión nace SIN_CLASIFICAR', async () => {
      const proveedor = await crearProveedor(sesionAdmin(), { nombre: 'Genérico' }, bd());
      expect(proveedor.tipo).toBe('SIN_CLASIFICAR');
    });

    it('valida la entrada con el esquema compartido (Zod) → ErrorValidacion', async () => {
      await expect(crearProveedor(sesionAdmin(), { nombre: '' }, bd())).rejects.toBeInstanceOf(
        ErrorValidacion,
      );
      await expect(
        // @ts-expect-error tipo inválido a propósito (entrada cruda de la red)
        crearProveedor(sesionAdmin(), { nombre: 'X', tipo: 'OTRO' }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza nombre duplicado, sin importar mayúsculas → ErrorConflicto', async () => {
      await crearProveedor(sesionAdmin(), { nombre: 'Textiles SA', tipo: 'TELAS' }, bd());
      await expect(
        crearProveedor(sesionAdmin(), { nombre: 'textiles sa', tipo: 'AVIOS' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('actualizar', () => {
    it('cambia datos con bitácora del detalle', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(sesion, { nombre: 'Prov', tipo: 'TELAS' }, bd());

      const actualizado = await actualizarProveedor(
        sesion,
        { id: proveedor.id, telefono: '999', tipo: 'SERVICIOS' },
        bd(),
      );
      expect(actualizado).toMatchObject({ telefono: '999', tipo: 'SERVICIOS' });

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Proveedor', idEntidad: String(proveedor.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({ tipo: { de: 'TELAS', a: 'SERVICIOS' } });
    });

    it('sin cambio real es idempotente: no escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(sesion, { nombre: 'Prov', tipo: 'TELAS' }, bd());
      const antes = await cliente.bitacora.count();

      await actualizarProveedor(sesion, { id: proveedor.id, nombre: 'Prov', tipo: 'TELAS' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('rechaza chocar con un nombre existente → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      await crearProveedor(sesion, { nombre: 'Prov A', tipo: 'TELAS' }, bd());
      const b = await crearProveedor(sesion, { nombre: 'Prov B', tipo: 'TELAS' }, bd());
      await expect(
        actualizarProveedor(sesion, { id: b.id, nombre: 'PROV A' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(
        actualizarProveedor(sesionAdmin(), { id: 9999, nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('desactivar / reactivar (borrado suave, PLANMAESTRO §4)', () => {
    it('desactiva con bitácora DESACTIVAR; el registro sigue existiendo', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(sesion, { nombre: 'Prov', tipo: 'TELAS' }, bd());

      const desactivado = await desactivarProveedor(sesion, proveedor.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.proveedor.count()).toBe(1);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Proveedor', idEntidad: String(proveedor.id), accion: 'DESACTIVAR' },
      });
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    it('desactivar dos veces → ErrorConflicto (pantalla desactualizada)', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(sesion, { nombre: 'Prov', tipo: 'TELAS' }, bd());
      await desactivarProveedor(sesion, proveedor.id, bd());
      await expect(desactivarProveedor(sesion, proveedor.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });

    it('el nombre de un proveedor desactivado sigue RESERVADO (se reactiva, no se duplica)', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(sesion, { nombre: 'Prov', tipo: 'TELAS' }, bd());
      await desactivarProveedor(sesion, proveedor.id, bd());

      await expect(crearProveedor(sesion, { nombre: 'Prov', tipo: 'TELAS' }, bd())).rejects.toThrow(
        /desactivado.*reactivarlo/,
      );
    });

    it('reactivar un proveedor libre de choques funciona', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(sesion, { nombre: 'Prov', tipo: 'TELAS' }, bd());
      await desactivarProveedor(sesion, proveedor.id, bd());
      const reactivado = await reactivarProveedor(sesion, proveedor.id, bd());
      expect(reactivado.activo).toBe(true);
    });
  });

  describe('obtener', () => {
    it('devuelve el proveedor por id', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(sesion, { nombre: 'Prov', tipo: 'TELAS' }, bd());
      const obtenido = await obtenerProveedor(sesion, proveedor.id, bd());
      expect(obtenido.id).toBe(proveedor.id);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(obtenerProveedor(sesionAdmin(), 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });
  });

  describe('listar (búsqueda + filtro por tipo + orden + paginación EN SERVIDOR)', () => {
    it('pagina con total y totalPaginas correctos', async () => {
      const sesion = sesionAdmin();
      for (let i = 1; i <= 5; i += 1) {
        await crearProveedor(
          sesion,
          { nombre: `Prov ${String(i).padStart(2, '0')}`, tipo: 'TELAS' },
          bd(),
        );
      }

      const pagina = await listarProveedores(sesion, { pagina: 2, porPagina: 2 }, bd());
      expect(pagina.total).toBe(5);
      expect(pagina.totalPaginas).toBe(3);
      expect(pagina.datos.map((p) => p.nombre)).toEqual(['Prov 03', 'Prov 04']);
    });

    it('busca por nombre sin distinguir mayúsculas', async () => {
      const sesion = sesionAdmin();
      await crearProveedor(sesion, { nombre: 'Textiles Norte', tipo: 'TELAS' }, bd());
      await crearProveedor(sesion, { nombre: 'Avíos Sur', tipo: 'AVIOS' }, bd());

      const pagina = await listarProveedores(sesion, { busqueda: 'textiles' }, bd());
      expect(pagina.total).toBe(1);
      expect(pagina.datos[0]?.nombre).toBe('Textiles Norte');
    });

    it('filtra por tipo y excluye inactivos por defecto', async () => {
      const sesion = sesionAdmin();
      await crearProveedor(sesion, { nombre: 'Telas 1', tipo: 'TELAS' }, bd());
      const avio = await crearProveedor(sesion, { nombre: 'Avíos 1', tipo: 'AVIOS' }, bd());
      await crearProveedor(sesion, { nombre: 'Servicios 1', tipo: 'SERVICIOS' }, bd());
      await desactivarProveedor(sesion, avio.id, bd());

      expect((await listarProveedores(sesion, {}, bd())).total).toBe(2);
      expect((await listarProveedores(sesion, { incluirInactivos: true }, bd())).total).toBe(3);
      expect(
        (await listarProveedores(sesion, { tipo: 'AVIOS', incluirInactivos: true }, bd())).total,
      ).toBe(1);
      expect((await listarProveedores(sesion, { tipo: 'TELAS' }, bd())).total).toBe(1);
    });

    it('ordena por la columna pedida en la dirección pedida', async () => {
      const sesion = sesionAdmin();
      await crearProveedor(sesion, { nombre: 'Alfa', tipo: 'TELAS' }, bd());
      await crearProveedor(sesion, { nombre: 'Zeta', tipo: 'AVIOS' }, bd());

      const desc = await listarProveedores(
        sesion,
        { ordenarPor: 'nombre', direccion: 'desc' },
        bd(),
      );
      expect(desc.datos.map((p) => p.nombre)).toEqual(['Zeta', 'Alfa']);
    });
  });
});
