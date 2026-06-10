import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../../datos/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarAlmacen,
  crearAlmacen,
  desactivarAlmacen,
  listarAlmacenes,
  obtenerAlmacen,
  reactivarAlmacen,
} from './almacenes.js';

let cliente: PrismaClient;
let empresa: Empresa;

const sesionAdmin = () =>
  sesionDePrueba({
    idEmpresaActiva: empresa.id,
    permisos: ['almacenes.ver', 'almacenes.administrar'],
  });

const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
});

describe('CRUD patrón Almacenes (PLANMAESTRO §6 F0)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba({ idEmpresaActiva: empresa.id });
      await expect(
        crearAlmacen(sinPermisos, { nombre: 'X', tipo: 'PT' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarAlmacenes(sinPermisos, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({
        idEmpresaActiva: empresa.id,
        permisos: ['almacenes.ver'],
      });
      await expect(crearAlmacen(soloVer, { nombre: 'X', tipo: 'PT' }, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      await expect(listarAlmacenes(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear', () => {
    it('crea en la empresa activa con auditoría y bitácora (A7)', async () => {
      const sesion = sesionAdmin();
      const almacen = await crearAlmacen(sesion, { nombre: 'Bodega PT', tipo: 'PT' }, bd());

      expect(almacen).toMatchObject({
        nombre: 'Bodega PT',
        tipo: 'PT',
        activo: true,
        idEmpresa: empresa.id,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      });

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Almacen', idEntidad: String(almacen.id) },
      });
      expect(bitacora.accion).toBe('CREAR');
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    it('valida la entrada con el esquema compartido (Zod) → ErrorValidacion', async () => {
      await expect(
        crearAlmacen(sesionAdmin(), { nombre: '', tipo: 'PT' }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      await expect(
        // @ts-expect-error tipo inválido a propósito (entrada cruda de la red)
        crearAlmacen(sesionAdmin(), { nombre: 'Bodega', tipo: 'OTRO' }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza nombre duplicado en la empresa, sin importar mayúsculas → ErrorConflicto', async () => {
      await crearAlmacen(sesionAdmin(), { nombre: 'Bodega PT', tipo: 'PT' }, bd());
      await expect(
        crearAlmacen(sesionAdmin(), { nombre: 'bodega pt', tipo: 'TELA' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('permite el mismo nombre en OTRA empresa (multi-empresa A9)', async () => {
      const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa');
      await crearAlmacen(sesionAdmin(), { nombre: 'Bodega PT', tipo: 'PT' }, bd());
      const enOtra = await crearAlmacen(
        sesionAdmin(),
        { nombre: 'Bodega PT', tipo: 'PT', idEmpresa: otra.id },
        bd(),
      );
      expect(enOtra.idEmpresa).toBe(otra.id);
    });

    it('rechaza una empresa inexistente o desactivada → ErrorValidacion', async () => {
      await expect(
        crearAlmacen(sesionAdmin(), { nombre: 'X', tipo: 'PT', idEmpresa: 9999 }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });

  describe('actualizar', () => {
    it('cambia nombre y tipo con bitácora del detalle', async () => {
      const sesion = sesionAdmin();
      const almacen = await crearAlmacen(sesion, { nombre: 'Bodega', tipo: 'PT' }, bd());

      const actualizado = await actualizarAlmacen(
        sesion,
        { id: almacen.id, nombre: 'Bodega Central', tipo: 'TELA' },
        bd(),
      );
      expect(actualizado).toMatchObject({ nombre: 'Bodega Central', tipo: 'TELA' });

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Almacen', idEntidad: String(almacen.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({
        nombre: { de: 'Bodega', a: 'Bodega Central' },
        tipo: { de: 'PT', a: 'TELA' },
      });
    });

    it('sin cambio real es idempotente: no escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const almacen = await crearAlmacen(sesion, { nombre: 'Bodega', tipo: 'PT' }, bd());
      const antes = await cliente.bitacora.count();

      await actualizarAlmacen(sesion, { id: almacen.id, nombre: 'Bodega', tipo: 'PT' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('rechaza chocar con un nombre existente → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      await crearAlmacen(sesion, { nombre: 'Bodega A', tipo: 'PT' }, bd());
      const b = await crearAlmacen(sesion, { nombre: 'Bodega B', tipo: 'PT' }, bd());
      await expect(
        actualizarAlmacen(sesion, { id: b.id, nombre: 'BODEGA A' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('un almacén NO se mueve de empresa → ErrorValidacion', async () => {
      const sesion = sesionAdmin();
      const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa');
      const almacen = await crearAlmacen(sesion, { nombre: 'Bodega', tipo: 'PT' }, bd());
      await expect(
        actualizarAlmacen(sesion, { id: almacen.id, idEmpresa: otra.id }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('no encuentra almacenes de otra empresa (A9) → ErrorNoEncontrado', async () => {
      const sesion = sesionAdmin();
      const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa');
      const ajeno = await crearAlmacen(
        sesion,
        { nombre: 'Ajeno', tipo: 'PT', idEmpresa: otra.id },
        bd(),
      );
      await expect(
        actualizarAlmacen(sesion, { id: ajeno.id, nombre: 'Hackeado' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('desactivar / reactivar (borrado suave, PLANMAESTRO §4)', () => {
    it('desactiva con bitácora DESACTIVAR; el registro sigue existiendo', async () => {
      const sesion = sesionAdmin();
      const almacen = await crearAlmacen(sesion, { nombre: 'Bodega', tipo: 'PT' }, bd());

      const desactivado = await desactivarAlmacen(sesion, almacen.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.almacen.count()).toBe(1); // suave: nada se borra

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Almacen', idEntidad: String(almacen.id), accion: 'DESACTIVAR' },
      });
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    it('desactivar dos veces → ErrorConflicto (pantalla desactualizada)', async () => {
      const sesion = sesionAdmin();
      const almacen = await crearAlmacen(sesion, { nombre: 'Bodega', tipo: 'PT' }, bd());
      await desactivarAlmacen(sesion, almacen.id, bd());
      await expect(desactivarAlmacen(sesion, almacen.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });

    it('el nombre de un almacén desactivado sigue RESERVADO (se reactiva, no se duplica)', async () => {
      const sesion = sesionAdmin();
      const almacen = await crearAlmacen(sesion, { nombre: 'Bodega', tipo: 'PT' }, bd());
      await desactivarAlmacen(sesion, almacen.id, bd());

      // Crear otro "Bodega" chocaría con el historial del desactivado: el
      // mensaje guía a reactivarlo (su kardex se conserva, D3).
      await expect(crearAlmacen(sesion, { nombre: 'Bodega', tipo: 'PT' }, bd())).rejects.toThrow(
        /desactivado.*reactivarlo/,
      );
    });

    it('reactivar un almacén libre de choques funciona', async () => {
      const sesion = sesionAdmin();
      const almacen = await crearAlmacen(sesion, { nombre: 'Bodega', tipo: 'PT' }, bd());
      await desactivarAlmacen(sesion, almacen.id, bd());
      const reactivado = await reactivarAlmacen(sesion, almacen.id, bd());
      expect(reactivado.activo).toBe(true);
    });
  });

  describe('obtener', () => {
    it('devuelve el almacén de la empresa activa', async () => {
      const sesion = sesionAdmin();
      const almacen = await crearAlmacen(sesion, { nombre: 'Bodega', tipo: 'PT' }, bd());
      const obtenido = await obtenerAlmacen(sesion, almacen.id, bd());
      expect(obtenido.id).toBe(almacen.id);
    });

    it("lo de otra empresa 'no existe' para la sesión (A9) → ErrorNoEncontrado", async () => {
      const sesion = sesionAdmin();
      const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa');
      const ajeno = await crearAlmacen(
        sesion,
        { nombre: 'Ajeno', tipo: 'PT', idEmpresa: otra.id },
        bd(),
      );
      await expect(obtenerAlmacen(sesion, ajeno.id, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });
  });

  describe('listar (búsqueda + orden + paginación EN SERVIDOR)', () => {
    it('pagina con total y totalPaginas correctos', async () => {
      const sesion = sesionAdmin();
      for (let i = 1; i <= 5; i += 1) {
        await crearAlmacen(
          sesion,
          { nombre: `Almacen ${String(i).padStart(2, '0')}`, tipo: 'PT' },
          bd(),
        );
      }

      const pagina = await listarAlmacenes(sesion, { pagina: 2, porPagina: 2 }, bd());
      expect(pagina.total).toBe(5);
      expect(pagina.totalPaginas).toBe(3);
      expect(pagina.datos.map((a) => a.nombre)).toEqual(['Almacen 03', 'Almacen 04']);
    });

    it('busca por nombre sin distinguir mayúsculas', async () => {
      const sesion = sesionAdmin();
      await crearAlmacen(sesion, { nombre: 'Bodega Norte', tipo: 'PT' }, bd());
      await crearAlmacen(sesion, { nombre: 'Tienda Sur', tipo: 'PT' }, bd());

      const pagina = await listarAlmacenes(sesion, { busqueda: 'bodega' }, bd());
      expect(pagina.total).toBe(1);
      expect(pagina.datos[0]?.nombre).toBe('Bodega Norte');
    });

    it('filtra por tipo y excluye inactivos por defecto', async () => {
      const sesion = sesionAdmin();
      await crearAlmacen(sesion, { nombre: 'PT 1', tipo: 'PT' }, bd());
      const tela = await crearAlmacen(sesion, { nombre: 'Telas 1', tipo: 'TELA' }, bd());
      await crearAlmacen(sesion, { nombre: 'Avios 1', tipo: 'AVIO' }, bd());
      await desactivarAlmacen(sesion, tela.id, bd());

      expect((await listarAlmacenes(sesion, {}, bd())).total).toBe(2);
      expect((await listarAlmacenes(sesion, { incluirInactivos: true }, bd())).total).toBe(3);
      expect(
        (await listarAlmacenes(sesion, { tipo: 'TELA', incluirInactivos: true }, bd())).total,
      ).toBe(1);
    });

    it('ordena por la columna pedida en la dirección pedida', async () => {
      const sesion = sesionAdmin();
      await crearAlmacen(sesion, { nombre: 'Alfa', tipo: 'TELA' }, bd());
      await crearAlmacen(sesion, { nombre: 'Zeta', tipo: 'PT' }, bd());

      const desc = await listarAlmacenes(sesion, { ordenarPor: 'nombre', direccion: 'desc' }, bd());
      expect(desc.datos.map((a) => a.nombre)).toEqual(['Zeta', 'Alfa']);
    });

    it('no mezcla empresas, salvo vista de administración (todasLasEmpresas)', async () => {
      const sesion = sesionAdmin();
      const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa');
      await crearAlmacen(sesion, { nombre: 'Propio', tipo: 'PT' }, bd());
      await crearAlmacen(sesion, { nombre: 'Ajeno', tipo: 'PT', idEmpresa: otra.id }, bd());

      expect((await listarAlmacenes(sesion, {}, bd())).total).toBe(1);
      expect((await listarAlmacenes(sesion, { todasLasEmpresas: true }, bd())).total).toBe(2);
    });
  });
});
