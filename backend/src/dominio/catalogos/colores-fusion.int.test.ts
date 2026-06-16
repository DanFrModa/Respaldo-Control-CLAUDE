import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { ErrorNoEncontrado, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { crearColor, fusionarColores } from './colores.js';
import { crearTela } from './telas.js';

/**
 * Integración de la FUSIÓN de colores duplicados (F1-E6) contra Postgres efímero
 * (testcontainers). Cubre lo que el unit no puede: que las referencias `TelaColor`
 * sobrevivan reasignadas al destino, la COLISIÓN de PK `[idTela, idColor]` (el destino
 * ya tenía esa tela), el borrado suave de los orígenes, la bitácora (A7) y el permiso.
 */

let cliente: PrismaClient;

const sesionAdmin = () => sesionDePrueba({ permisos: ['colores.ver', 'colores.administrar'] });
const sesionTelas = () =>
  sesionDePrueba({ permisos: ['telas.ver', 'telas.administrar', 'colores.ver'] });
const bd = () => ({ cliente });

let idCategoria: number;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  const felpa = await cliente.telaCategoria.create({ data: { nombre: 'Felpa' } });
  idCategoria = felpa.id;
});

describe('Fusión de colores duplicados (F1-E6)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin colores.administrar no se puede fusionar', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      const soloVer = sesionDePrueba({ permisos: ['colores.ver'] });
      await expect(
        fusionarColores(soloVer, { idDestino: destino.id, origenes: [origen.id] }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
    });
  });

  describe('validación de entrada (Zod)', () => {
    it('rechaza fusionar un color consigo mismo', async () => {
      const c = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      await expect(
        fusionarColores(sesionAdmin(), { idDestino: c.id, origenes: [c.id] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza una lista de orígenes vacía', async () => {
      const c = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      await expect(
        fusionarColores(sesionAdmin(), { idDestino: c.id, origenes: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza orígenes repetidos', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      await expect(
        fusionarColores(
          sesionAdmin(),
          { idDestino: destino.id, origenes: [origen.id, origen.id] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });

  describe('color inexistente', () => {
    it('lanza ErrorNoEncontrado si el destino no existe', async () => {
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      await expect(
        fusionarColores(sesionAdmin(), { idDestino: 9999, origenes: [origen.id] }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });

    it('lanza ErrorNoEncontrado si un origen no existe', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      await expect(
        fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [9999] }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('reasignación de referencias TelaColor', () => {
    it('mueve las telas del origen al destino (sin colisión) y desactiva el origen', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());

      // Una tela usa SOLO el color origen.
      const tela = await crearTela(
        sesionTelas(),
        { nombre: 'Felpa lisa', idCategoria, colores: [{ idColor: origen.id, precio: 50 }] },
        bd(),
      );

      const sobreviviente = await fusionarColores(
        sesionAdmin(),
        { idDestino: destino.id, origenes: [origen.id] },
        bd(),
      );

      expect(sobreviviente.id).toBe(destino.id);
      expect(sobreviviente.activo).toBe(true);

      // La referencia se reasignó: ya no apunta al origen, apunta al destino.
      expect(await cliente.telaColor.count({ where: { idColor: origen.id } })).toBe(0);
      const reasignada = await cliente.telaColor.findUniqueOrThrow({
        where: { idTela_idColor: { idTela: tela.id, idColor: destino.id } },
      });
      expect(reasignada.precio?.toNumber()).toBe(50);

      // El origen quedó desactivado (borrado suave: sigue existiendo).
      const origenTras = await cliente.color.findUniqueOrThrow({ where: { id: origen.id } });
      expect(origenTras.activo).toBe(false);
    });

    it('resuelve la COLISIÓN de PK: gana el destino, pero rellena su precio nulo desde el origen', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());

      // La MISMA tela tiene ambos colores: destino SIN precio, origen CON precio → colisión.
      const tela = await crearTela(
        sesionTelas(),
        {
          nombre: 'Felpa colisión',
          idCategoria,
          colores: [{ idColor: destino.id }, { idColor: origen.id, precio: 77 }],
        },
        bd(),
      );

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd());

      // Queda UN solo renglón para esa tela (el del destino); el del origen se eliminó.
      expect(await cliente.telaColor.count({ where: { idTela: tela.id } })).toBe(1);
      expect(await cliente.telaColor.count({ where: { idColor: origen.id } })).toBe(0);

      // El destino tenía precio nulo → toma el del origen (no se pierde el dato).
      const final = await cliente.telaColor.findUniqueOrThrow({
        where: { idTela_idColor: { idTela: tela.id, idColor: destino.id } },
      });
      expect(final.precio?.toNumber()).toBe(77);
    });

    it('en colisión con AMBOS precios, conserva el del destino (gana el canónico)', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      const tela = await crearTela(
        sesionTelas(),
        {
          nombre: 'Felpa ambos precios',
          idCategoria,
          colores: [
            { idColor: destino.id, precio: 100 },
            { idColor: origen.id, precio: 200 },
          ],
        },
        bd(),
      );

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd());

      const final = await cliente.telaColor.findUniqueOrThrow({
        where: { idTela_idColor: { idTela: tela.id, idColor: destino.id } },
      });
      expect(final.precio?.toNumber()).toBe(100);
    });

    it('fusiona VARIOS orígenes de golpe en un solo destino', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const a = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      const b = await crearColor(sesionAdmin(), { nombre: 'NEGRO B' }, bd());

      const telaA = await crearTela(
        sesionTelas(),
        { nombre: 'Tela A', idCategoria, colores: [{ idColor: a.id }] },
        bd(),
      );
      const telaB = await crearTela(
        sesionTelas(),
        { nombre: 'Tela B', idCategoria, colores: [{ idColor: b.id }] },
        bd(),
      );

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [a.id, b.id] }, bd());

      // Las dos telas ahora apuntan al destino; ambos orígenes desactivados.
      expect(await cliente.telaColor.count({ where: { idColor: destino.id } })).toBe(2);
      expect(await cliente.telaColor.count({ where: { idColor: a.id } })).toBe(0);
      expect(await cliente.telaColor.count({ where: { idColor: b.id } })).toBe(0);
      expect((await cliente.color.findUniqueOrThrow({ where: { id: a.id } })).activo).toBe(false);
      expect((await cliente.color.findUniqueOrThrow({ where: { id: b.id } })).activo).toBe(false);
      // Confirma que las telas correctas se movieron.
      await cliente.telaColor.findUniqueOrThrow({
        where: { idTela_idColor: { idTela: telaA.id, idColor: destino.id } },
      });
      await cliente.telaColor.findUniqueOrThrow({
        where: { idTela_idColor: { idTela: telaB.id, idColor: destino.id } },
      });
    });

    it('reactiva el destino si estaba desactivado (sobrevive como canónico)', async () => {
      const sesion = sesionAdmin();
      const destino = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      await cliente.color.update({ where: { id: destino.id }, data: { activo: false } });

      const sobreviviente = await fusionarColores(
        sesion,
        { idDestino: destino.id, origenes: [origen.id] },
        bd(),
      );
      expect(sobreviviente.activo).toBe(true);
    });
  });

  describe('bitácora (A7)', () => {
    it('registra la fusión en el origen (OTRO) y el resumen en el destino (MODIFICAR)', async () => {
      const sesion = sesionAdmin();
      const destino = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      await crearTela(
        sesionTelas(),
        { nombre: 'Tela', idCategoria, colores: [{ idColor: origen.id }] },
        bd(),
      );

      await fusionarColores(sesion, { idDestino: destino.id, origenes: [origen.id] }, bd());

      const bitOrigen = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Color', idEntidad: String(origen.id), accion: 'OTRO' },
      });
      expect(bitOrigen.idUsuario).toBe(sesion.id);
      expect(bitOrigen.datos).toMatchObject({
        operacion: 'fusionar',
        fusionadoEn: { id: destino.id, nombre: 'NEGRO' },
      });

      const bitDestino = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Color', idEntidad: String(destino.id), accion: 'MODIFICAR' },
      });
      expect(bitDestino.datos).toMatchObject({
        operacion: 'fusionar',
        referenciasReasignadas: 1,
      });
    });
  });
});
