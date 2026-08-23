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
  actualizarTelaProveedor,
  crearTelaProveedor,
  desactivarTelaProveedor,
  listarProveedoresDeTela,
  obtenerTelaProveedor,
  reactivarTelaProveedor,
} from './tela-proveedores.js';

let cliente: PrismaClient;

const sesionAdmin = () => sesionDePrueba({ permisos: ['telas.ver', 'telas.administrar'] });

const bd = () => ({ cliente });

// Ids sembrados en cada test (se rellenan en beforeEach).
let telaId: number;
let otraTelaId: number;
let provA: number;
let provB: number;
let provC: number;
let colNegro: number;
let colBlanco: number;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  const tela = await cliente.tela.create({ data: { nombre: 'Felpa 100% algodón' } });
  const otra = await cliente.tela.create({ data: { nombre: 'Jersey liso' } });
  telaId = tela.id;
  otraTelaId = otra.id;
  const a = await cliente.proveedor.create({ data: { nombre: 'Telas del Bajío' } });
  const b = await cliente.proveedor.create({ data: { nombre: 'Textiles MX' } });
  const c = await cliente.proveedor.create({ data: { nombre: 'Hilaturas SA' } });
  provA = a.id;
  provB = b.id;
  provC = c.id;
  const negro = await cliente.color.create({ data: { nombre: 'Negro' } });
  const blanco = await cliente.color.create({ data: { nombre: 'Blanco' } });
  colNegro = negro.id;
  colBlanco = blanco.id;
});

describe('Precios de tela por proveedor (F8-E1, R17 — sub-recurso de la Tela)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba();
      await expect(
        crearTelaProveedor(sinPermisos, telaId, { idProveedor: provA }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarProveedoresDeTela(sinPermisos, telaId, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['telas.ver'] });
      await expect(
        crearTelaProveedor(soloVer, telaId, { idProveedor: provA }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarProveedoresDeTela(soloVer, telaId, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear (con grid de precio por color, transacción A2)', () => {
    it('crea con manejaPrecioPorColor y 2 colores a precio distinto (auditoría + bitácora A7)', async () => {
      const sesion = sesionAdmin();
      const tp = await crearTelaProveedor(
        sesion,
        telaId,
        {
          idProveedor: provA,
          precio: 95,
          manejaPrecioPorColor: true,
          condiciones: 'USD, LAB Manzanillo',
          colores: [
            { idColor: colNegro, precio: 98 },
            { idColor: colBlanco, precio: 92 },
          ],
        },
        bd(),
      );

      expect(tp).toMatchObject({
        idTela: telaId,
        idProveedor: provA,
        manejaPrecioPorColor: true,
        condiciones: 'USD, LAB Manzanillo',
        activo: true,
        creadoPorId: sesion.id,
      });
      expect(Number(tp.precio)).toBe(95);
      expect(tp.colores).toHaveLength(2);
      expect(Number(tp.colores.find((c) => c.idColor === colNegro)?.precio)).toBe(98);
      expect(Number(tp.colores.find((c) => c.idColor === colBlanco)?.precio)).toBe(92);
      // Nombre del color embebido (para la UI, sin cruzar catálogo).
      expect(tp.colores.find((c) => c.idColor === colNegro)?.color.nombre).toBe('Negro');

      // Renglones del grid existen (transacción A2: o todo o nada).
      expect(await cliente.telaProveedorColor.count({ where: { idTelaProveedor: tp.id } })).toBe(2);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'TelaProveedor', idEntidad: String(tp.id), accion: 'CREAR' },
      });
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    it('crea el mínimo: solo idProveedor (precio null, sin colores)', async () => {
      const tp = await crearTelaProveedor(sesionAdmin(), telaId, { idProveedor: provB }, bd());
      expect(tp.precio).toBeNull();
      expect(tp.manejaPrecioPorColor).toBe(false);
      expect(tp.colores).toHaveLength(0);
    });

    it('rechaza el mismo proveedor dos veces en la tela → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      await crearTelaProveedor(sesion, telaId, { idProveedor: provA }, bd());
      await expect(
        crearTelaProveedor(sesion, telaId, { idProveedor: provA }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('el mismo proveedor SÍ puede estar en otra tela (unicidad por tela)', async () => {
      const sesion = sesionAdmin();
      await crearTelaProveedor(sesion, telaId, { idProveedor: provA }, bd());
      const enOtra = await crearTelaProveedor(sesion, otraTelaId, { idProveedor: provA }, bd());
      expect(enOtra.idTela).toBe(otraTelaId);
    });

    it('tela inexistente → ErrorNoEncontrado', async () => {
      await expect(
        crearTelaProveedor(sesionAdmin(), 999999, { idProveedor: provA }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });

    it('proveedor inexistente → ErrorValidacion (y NO crea el renglón: A2)', async () => {
      await expect(
        crearTelaProveedor(sesionAdmin(), telaId, { idProveedor: 999999 }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.telaProveedor.count({ where: { idTela: telaId } })).toBe(0);
    });

    it('proveedor DESACTIVADO → ErrorValidacion', async () => {
      await cliente.proveedor.update({ where: { id: provC }, data: { activo: false } });
      await expect(
        crearTelaProveedor(sesionAdmin(), telaId, { idProveedor: provC }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('color inexistente en el grid → ErrorValidacion (y NO crea el renglón: A2)', async () => {
      await expect(
        crearTelaProveedor(
          sesionAdmin(),
          telaId,
          { idProveedor: provA, colores: [{ idColor: 999999, precio: 10 }] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.telaProveedor.count({ where: { idTela: telaId } })).toBe(0);
    });

    it('color DESACTIVADO en el grid → ErrorValidacion', async () => {
      await cliente.color.update({ where: { id: colBlanco }, data: { activo: false } });
      await expect(
        crearTelaProveedor(
          sesionAdmin(),
          telaId,
          { idProveedor: provA, colores: [{ idColor: colBlanco, precio: 10 }] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });

  describe('actualizar (precio + grid en una transacción)', () => {
    it('actualiza el precio base', async () => {
      const sesion = sesionAdmin();
      const tp = await crearTelaProveedor(sesion, telaId, { idProveedor: provA, precio: 80 }, bd());
      const actualizado = await actualizarTelaProveedor(
        sesion,
        telaId,
        { id: tp.id, precio: 88 },
        bd(),
      );
      expect(Number(actualizado.precio)).toBe(88);
    });

    it('vaciar el precio (null) lo BORRA', async () => {
      const sesion = sesionAdmin();
      const tp = await crearTelaProveedor(sesion, telaId, { idProveedor: provA, precio: 80 }, bd());
      const actualizado = await actualizarTelaProveedor(
        sesion,
        telaId,
        { id: tp.id, precio: null },
        bd(),
      );
      expect(actualizado.precio).toBeNull();
    });

    it('reemplaza el grid: agrega, actualiza precio del que sigue y quita el que sobra', async () => {
      const sesion = sesionAdmin();
      const tp = await crearTelaProveedor(
        sesion,
        telaId,
        {
          idProveedor: provA,
          manejaPrecioPorColor: true,
          colores: [
            { idColor: colNegro, precio: 10 },
            { idColor: colBlanco, precio: 20 },
          ],
        },
        bd(),
      );

      // Deja negro (cambia precio), quita blanco.
      const actualizado = await actualizarTelaProveedor(
        sesion,
        telaId,
        { id: tp.id, colores: [{ idColor: colNegro, precio: 15 }] },
        bd(),
      );
      expect(actualizado.colores).toHaveLength(1);
      expect(Number(actualizado.colores[0]?.precio)).toBe(15);
      expect(await cliente.telaProveedorColor.count({ where: { idTelaProveedor: tp.id } })).toBe(1);
    });

    it('mandar colores: [] vacía el grid; omitir colores no lo toca', async () => {
      const sesion = sesionAdmin();
      const tp = await crearTelaProveedor(
        sesion,
        telaId,
        { idProveedor: provA, colores: [{ idColor: colNegro, precio: 10 }] },
        bd(),
      );
      // omitir: no toca.
      await actualizarTelaProveedor(sesion, telaId, { id: tp.id, precio: 5 }, bd());
      expect(await cliente.telaProveedorColor.count({ where: { idTelaProveedor: tp.id } })).toBe(1);
      // []: vacía.
      const vaciado = await actualizarTelaProveedor(
        sesion,
        telaId,
        { id: tp.id, colores: [] },
        bd(),
      );
      expect(vaciado.colores).toHaveLength(0);
    });

    it('poner manejaPrecioPorColor en false se permite (los colores quedan)', async () => {
      const sesion = sesionAdmin();
      const tp = await crearTelaProveedor(
        sesion,
        telaId,
        {
          idProveedor: provA,
          manejaPrecioPorColor: true,
          colores: [{ idColor: colNegro, precio: 10 }],
        },
        bd(),
      );
      const actualizado = await actualizarTelaProveedor(
        sesion,
        telaId,
        { id: tp.id, manejaPrecioPorColor: false },
        bd(),
      );
      expect(actualizado.manejaPrecioPorColor).toBe(false);
      expect(actualizado.colores).toHaveLength(1);
    });

    it('cambiar a un proveedor ya asignado a la tela → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const tpA = await crearTelaProveedor(sesion, telaId, { idProveedor: provA }, bd());
      await crearTelaProveedor(sesion, telaId, { idProveedor: provB }, bd());
      await expect(
        actualizarTelaProveedor(sesion, telaId, { id: tpA.id, idProveedor: provB }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('un renglón de OTRA tela → ErrorNoEncontrado (no pertenece a la tela de la URL)', async () => {
      const sesion = sesionAdmin();
      const tp = await crearTelaProveedor(sesion, otraTelaId, { idProveedor: provA }, bd());
      await expect(
        actualizarTelaProveedor(sesion, telaId, { id: tp.id, precio: 5 }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });

    it('sin cambio real es idempotente: no escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const tp = await crearTelaProveedor(sesion, telaId, { idProveedor: provA, precio: 5 }, bd());
      const antes = await cliente.bitacora.count();
      await actualizarTelaProveedor(sesion, telaId, { id: tp.id, precio: 5 }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });
  });

  describe('desactivar / reactivar (borrado suave, PLANMAESTRO §4)', () => {
    it('desactiva con bitácora DESACTIVAR; el registro sigue existiendo', async () => {
      const sesion = sesionAdmin();
      const tp = await crearTelaProveedor(sesion, telaId, { idProveedor: provA }, bd());
      const desactivado = await desactivarTelaProveedor(sesion, telaId, tp.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.telaProveedor.count()).toBe(1);
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'TelaProveedor', idEntidad: String(tp.id), accion: 'DESACTIVAR' },
      });
    });

    it('desactivar dos veces → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const tp = await crearTelaProveedor(sesion, telaId, { idProveedor: provA }, bd());
      await desactivarTelaProveedor(sesion, telaId, tp.id, bd());
      await expect(desactivarTelaProveedor(sesion, telaId, tp.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });

    it('reactivar un renglón desactivado funciona', async () => {
      const sesion = sesionAdmin();
      const tp = await crearTelaProveedor(sesion, telaId, { idProveedor: provA }, bd());
      await desactivarTelaProveedor(sesion, telaId, tp.id, bd());
      const reactivado = await reactivarTelaProveedor(sesion, telaId, tp.id, bd());
      expect(reactivado.activo).toBe(true);
    });

    it('crear con el proveedor de un renglón desactivado choca (pide reactivarlo) → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const tp = await crearTelaProveedor(sesion, telaId, { idProveedor: provA }, bd());
      await desactivarTelaProveedor(sesion, telaId, tp.id, bd());
      await expect(
        crearTelaProveedor(sesion, telaId, { idProveedor: provA }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('obtener / listar', () => {
    it('lista los proveedores de la tela con sus colores (R17)', async () => {
      const sesion = sesionAdmin();
      await crearTelaProveedor(
        sesion,
        telaId,
        {
          idProveedor: provA,
          precio: 90,
          manejaPrecioPorColor: true,
          colores: [{ idColor: colNegro, precio: 91 }],
        },
        bd(),
      );
      await crearTelaProveedor(sesion, telaId, { idProveedor: provB, precio: 88 }, bd());

      const lista = await listarProveedoresDeTela(sesion, telaId, bd());
      expect(lista).toHaveLength(2);
      const conColor = lista.find((tp) => tp.idProveedor === provA);
      expect(conColor?.colores).toHaveLength(1);
      expect(Number(conColor?.colores[0]?.precio)).toBe(91);
      expect(conColor?.proveedor.nombre).toBe('Telas del Bajío');
    });

    it('la lista de una tela NO incluye los proveedores de otra tela', async () => {
      const sesion = sesionAdmin();
      await crearTelaProveedor(sesion, telaId, { idProveedor: provA }, bd());
      await crearTelaProveedor(sesion, otraTelaId, { idProveedor: provB }, bd());
      const lista = await listarProveedoresDeTela(sesion, telaId, bd());
      expect(lista).toHaveLength(1);
      expect(lista[0]?.idProveedor).toBe(provA);
    });

    it('obtener un renglón por id (dentro de su tela)', async () => {
      const sesion = sesionAdmin();
      const tp = await crearTelaProveedor(sesion, telaId, { idProveedor: provA, precio: 77 }, bd());
      const obtenido = await obtenerTelaProveedor(sesion, telaId, tp.id, bd());
      expect(obtenido.id).toBe(tp.id);
      expect(Number(obtenido.precio)).toBe(77);
    });

    it('obtener un renglón de otra tela → ErrorNoEncontrado', async () => {
      const sesion = sesionAdmin();
      const tp = await crearTelaProveedor(sesion, otraTelaId, { idProveedor: provA }, bd());
      await expect(obtenerTelaProveedor(sesion, telaId, tp.id, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });

    it('listar de una tela inexistente → ErrorNoEncontrado', async () => {
      await expect(listarProveedoresDeTela(sesionAdmin(), 999999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });
  });
});
