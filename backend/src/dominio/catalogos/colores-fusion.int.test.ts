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
import { crearColor, fusionarColores } from './colores.js';
import { crearTela } from './telas.js';

/**
 * Integración de la FUSIÓN de colores duplicados (F1-E6) contra Postgres efímero
 * (testcontainers). Cubre lo que el unit no puede: que las referencias `TelaColor`
 * sobrevivan reasignadas al destino, la COLISIÓN de PK `[idTela, idColor]` (el destino
 * ya tenía esa tela), el borrado suave de los orígenes, la bitácora (A7) y el permiso.
 *
 * ⭐ §Post-F9.129 — y que la fusión SE NIEGUE cuando el origen ya se usa fuera de las telas. Aquí se
 * prueba con un `Lote` porque es la referencia más barata de fabricar (clave + color, sin cadena de
 * fixture que se pueda romper); **qué relaciones entran en la guarda** no se verifica a mano aquí sino
 * en el unit `colores-fusion-referencias.test.ts`, que las deriva de `prisma/schema.prisma` — una lista
 * escrita a mano ya se equivocó tres veces.
 */

let cliente: PrismaClient;

const sesionAdmin = () => sesionDePrueba({ permisos: ['colores.ver', 'colores.administrar'] });
const sesionTelas = () =>
  sesionDePrueba({ permisos: ['telas.ver', 'telas.administrar', 'colores.ver'] });
const bd = () => ({ cliente });

let idCategoria: number;
let idProveedor: number;

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
  // El alta de tela ahora exige el proveedor DUEÑO (§Post-F9.11).
  const proveedor = await cliente.proveedor.create({ data: { nombre: 'Alsatex' } });
  idProveedor = proveedor.id;
});

/**
 * Crea una tela vía dominio y le cuelga colores con LIGA LEGACY `idColor` — así quedan las
 * filas MIGRADAS del ETL de F1-E6 (§Post-F9.11: los colores nuevos nacen SIN liga y la
 * fusión no los toca; solo las ligadas participan).
 */
async function telaConLigas(
  nombre: string,
  ligas: {
    nombre: string;
    idColor: number;
    precio?: number;
    pantone?: string;
    precioComplemento?: number;
  }[],
): Promise<{ id: number }> {
  const tela = await crearTela(
    sesionTelas(),
    { nombre, unidadMedida: 'KG', idCategoria, idProveedor, colores: [] },
    { cliente },
  );
  for (const liga of ligas) {
    await cliente.telaColor.create({
      data: {
        idTela: tela.id,
        nombre: liga.nombre,
        idColor: liga.idColor,
        precio: liga.precio ?? null,
        pantone: liga.pantone ?? null,
        precioComplemento: liga.precioComplemento ?? null,
      },
    });
  }
  return tela;
}

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

      // Una tela MIGRADA ligada SOLO al color origen.
      const tela = await telaConLigas('Felpa lisa', [
        { nombre: 'Negro A', idColor: origen.id, precio: 50 },
      ]);

      const sobreviviente = await fusionarColores(
        sesionAdmin(),
        { idDestino: destino.id, origenes: [origen.id] },
        bd(),
      );

      expect(sobreviviente.id).toBe(destino.id);
      expect(sobreviviente.activo).toBe(true);

      // La LIGA se reasignó: ya no apunta al origen, apunta al destino. El color de la
      // tela conserva su nombre propio y su precio (solo cambió la liga legacy).
      expect(await cliente.telaColor.count({ where: { idColor: origen.id } })).toBe(0);
      const reasignada = await cliente.telaColor.findFirstOrThrow({
        where: { idTela: tela.id, idColor: destino.id },
      });
      expect(reasignada.precio?.toNumber()).toBe(50);
      expect(reasignada.nombre).toBe('Negro A');

      // El origen quedó desactivado (borrado suave: sigue existiendo).
      const origenTras = await cliente.color.findUniqueOrThrow({ where: { id: origen.id } });
      expect(origenTras.activo).toBe(false);
    });

    it('resuelve la COLISIÓN de PK: gana el destino, pero rellena su precio nulo desde el origen', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());

      // La MISMA tela está ligada a ambos: destino SIN precio, origen CON precio → colisión.
      const tela = await telaConLigas('Felpa colisión', [
        { nombre: 'Negro', idColor: destino.id },
        { nombre: 'Negro A', idColor: origen.id, precio: 77 },
      ]);

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd());

      // Queda UN solo renglón para esa tela (el del destino); el del origen se eliminó.
      expect(await cliente.telaColor.count({ where: { idTela: tela.id } })).toBe(1);
      expect(await cliente.telaColor.count({ where: { idColor: origen.id } })).toBe(0);

      // El destino tenía precio nulo → toma el del origen (no se pierde el dato).
      const final = await cliente.telaColor.findFirstOrThrow({
        where: { idTela: tela.id, idColor: destino.id },
      });
      expect(final.precio?.toNumber()).toBe(77);
    });

    // §Post-F9.11: el relleno-si-nulo del duplicado cubre TODOS los datos del color de
    // tela — pantone y precio del complemento por igual (extensión pedida en la ronda 2).
    it('en colisión también rellena pantone y precioComplemento nulos desde el origen', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      const tela = await telaConLigas('Felpa relleno', [
        { nombre: 'Negro', idColor: destino.id, precio: 100 },
        {
          nombre: 'Negro A',
          idColor: origen.id,
          precio: 200,
          pantone: '19-4005 TCX',
          precioComplemento: 60,
        },
      ]);

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd());

      const final = await cliente.telaColor.findFirstOrThrow({
        where: { idTela: tela.id, idColor: destino.id },
      });
      // El precio del destino GANA (no era nulo); pantone y precioComplemento estaban
      // nulos → se rellenan del origen antes de eliminar el duplicado.
      expect(final.precio?.toNumber()).toBe(100);
      expect(final.pantone).toBe('19-4005 TCX');
      expect(final.precioComplemento?.toNumber()).toBe(60);
      expect(await cliente.telaColor.count({ where: { idTela: tela.id } })).toBe(1);
    });

    it('en colisión con AMBOS precios, conserva el del destino (gana el canónico)', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      const tela = await telaConLigas('Felpa ambos precios', [
        { nombre: 'Negro', idColor: destino.id, precio: 100 },
        { nombre: 'Negro A', idColor: origen.id, precio: 200 },
      ]);

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd());

      const final = await cliente.telaColor.findFirstOrThrow({
        where: { idTela: tela.id, idColor: destino.id },
      });
      expect(final.precio?.toNumber()).toBe(100);
    });

    it('fusiona VARIOS orígenes de golpe en un solo destino', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const a = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      const b = await crearColor(sesionAdmin(), { nombre: 'NEGRO B' }, bd());

      const telaA = await telaConLigas('Tela A', [{ nombre: 'Negro A', idColor: a.id }]);
      const telaB = await telaConLigas('Tela B', [{ nombre: 'Negro B', idColor: b.id }]);

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [a.id, b.id] }, bd());

      // Las dos telas ahora apuntan al destino; ambos orígenes desactivados.
      expect(await cliente.telaColor.count({ where: { idColor: destino.id } })).toBe(2);
      expect(await cliente.telaColor.count({ where: { idColor: a.id } })).toBe(0);
      expect(await cliente.telaColor.count({ where: { idColor: b.id } })).toBe(0);
      expect((await cliente.color.findUniqueOrThrow({ where: { id: a.id } })).activo).toBe(false);
      expect((await cliente.color.findUniqueOrThrow({ where: { id: b.id } })).activo).toBe(false);
      // Confirma que las telas correctas se re-ligaron.
      await cliente.telaColor.findFirstOrThrow({
        where: { idTela: telaA.id, idColor: destino.id },
      });
      await cliente.telaColor.findFirstOrThrow({
        where: { idTela: telaB.id, idColor: destino.id },
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
      await telaConLigas('Tela', [{ nombre: 'Negro A', idColor: origen.id }]);

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

  describe('⭐ §Post-F9.129 — se NIEGA si el origen ya se usa fuera de las telas', () => {
    it('rechaza con ErrorConflicto y NO toca nada (el origen sigue activo y su tela no se movió)', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      const tela = await telaConLigas('Felpa lisa', [{ nombre: 'Negro A', idColor: origen.id }]);
      // El origen se usa fuera de las telas: un lote teñido en ese color.
      await cliente.lote.create({ data: { clave: 'LOTE-NEGRO-A-1', idColor: origen.id } });

      await expect(
        fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);

      // A2: la tx entera se revirtió. El origen sigue ACTIVO (no quedó apagado a medias)…
      const origenDespues = await cliente.color.findUniqueOrThrow({ where: { id: origen.id } });
      expect(origenDespues.activo).toBe(true);
      // …su tela sigue ligada a ÉL (no se movió al destino)…
      const ligas = await cliente.telaColor.findMany({ where: { idTela: tela.id } });
      expect(ligas.map((l) => l.idColor)).toEqual([origen.id]);
      // …y no se escribió bitácora de fusión.
      expect(
        await cliente.bitacora.count({
          where: { entidad: 'Color', idEntidad: String(origen.id), accion: 'OTRO' },
        }),
      ).toBe(0);
    });

    it('el mensaje nombra el color, el uso que estorba y el camino de salida', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      await cliente.lote.create({ data: { clave: 'LOTE-NEGRO-A-2', idColor: origen.id } });

      await expect(
        fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd()),
      ).rejects.toThrow(/NEGRO A[\s\S]*lotes de tela[\s\S]*§Post-F9\.129/);
    });

    it('un origen LIMPIO se sigue fusionando (la guarda no estorba a la depuración legítima)', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      await telaConLigas('Felpa lisa', [{ nombre: 'Negro A', idColor: origen.id }]);

      const sobreviviente = await fusionarColores(
        sesionAdmin(),
        { idDestino: destino.id, origenes: [origen.id] },
        bd(),
      );

      expect(sobreviviente.id).toBe(destino.id);
      const origenDespues = await cliente.color.findUniqueOrThrow({ where: { id: origen.id } });
      expect(origenDespues.activo).toBe(false);
    });
  });
});
