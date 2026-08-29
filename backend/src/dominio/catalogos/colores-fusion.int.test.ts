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
  colorCanonico,
  crearColor,
  desactivarColor,
  fusionarColores,
  reactivarColor,
} from './colores.js';
import { crearTela } from './telas.js';

/**
 * Integración de la FUSIÓN de colores duplicados (F1-E6) contra Postgres efímero
 * (testcontainers). Cubre lo que el unit no puede: que las referencias `TelaColor`
 * sobrevivan reasignadas al destino, la COLISIÓN de PK `[idTela, idColor]` (el destino
 * ya tenía esa tela), el borrado suave de los orígenes, la bitácora (A7) y el permiso.
 *
 * ⭐ V1-E8s (§Post-F9.143) — y que la fusión deje RASTRO de a dónde se fue cada absorbido
 * (`Color.idFusionadoEn`), que `colorCanonico` sepa seguir esa cadena, y que reactivar a mano lo
 * borre: de ese rastro depende que el importador de OC no resucite un color fusionado.
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

  describe('⭐ V1-E8s (§Post-F9.143) — el RASTRO: a dónde se fue cada color absorbido', () => {
    it('sella en el ORIGEN a quién se lo llevó, y deja al DESTINO sin rastro', async () => {
      const sesion = sesionAdmin();
      const destino = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const a = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      const b = await crearColor(sesion, { nombre: 'NEGRO B' }, bd());

      await fusionarColores(sesion, { idDestino: destino.id, origenes: [a.id, b.id] }, bd());

      // Cada absorbido apunta al canónico: eso es lo que el importador de OC va a seguir.
      expect((await cliente.color.findUniqueOrThrow({ where: { id: a.id } })).idFusionadoEn).toBe(
        destino.id,
      );
      expect((await cliente.color.findUniqueOrThrow({ where: { id: b.id } })).idFusionadoEn).toBe(
        destino.id,
      );
      // Al canónico no lo absorbió nadie (y así ninguna cadena se cierra en círculo).
      expect(
        (await cliente.color.findUniqueOrThrow({ where: { id: destino.id } })).idFusionadoEn,
      ).toBeNull();
    });

    it('sella el rastro AUNQUE el origen ya estuviera apagado (el dato nuevo es a dónde se fue)', async () => {
      const sesion = sesionAdmin();
      const destino = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      await cliente.color.update({ where: { id: origen.id }, data: { activo: false } });

      await fusionarColores(sesion, { idDestino: destino.id, origenes: [origen.id] }, bd());

      const despues = await cliente.color.findUniqueOrThrow({ where: { id: origen.id } });
      expect(despues.activo).toBe(false);
      expect(despues.idFusionadoEn).toBe(destino.id);
    });

    it('`colorCanonico` sigue la cadena A→B→C hasta el que de verdad sobrevivió', async () => {
      const sesion = sesionAdmin();
      const c = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const b = await crearColor(sesion, { nombre: 'NEGRO B' }, bd());
      const a = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());

      await fusionarColores(sesion, { idDestino: b.id, origenes: [a.id] }, bd());
      await fusionarColores(sesion, { idDestino: c.id, origenes: [b.id] }, bd());

      const canonico = await colorCanonico(cliente, a.id);
      expect(canonico).toMatchObject({ id: c.id, nombre: 'NEGRO', activo: true });
    });

    it('devuelve el MISMO color si nunca lo absorbieron — apagado a mano incluido', async () => {
      const sesion = sesionAdmin();
      const suelto = await crearColor(sesion, { nombre: 'AZUL REY' }, bd());
      await desactivarColor(sesion, suelto.id, bd());

      // Apagado, pero sin rastro: nadie se lo llevó. Quien llama decide si lo reactiva.
      const canonico = await colorCanonico(cliente, suelto.id);
      expect(canonico).toMatchObject({ id: suelto.id, activo: false });
    });

    it('reactivar a mano al absorbido BORRA el rastro (deshacer la fusión se respeta)', async () => {
      const sesion = sesionAdmin();
      const destino = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      await fusionarColores(sesion, { idDestino: destino.id, origenes: [origen.id] }, bd());

      const reactivado = await reactivarColor(sesion, origen.id, bd());

      expect(reactivado.activo).toBe(true);
      expect(reactivado.idFusionadoEn).toBeNull();
      // …y queda dicho en la bitácora de quién se lo desamarró (A7).
      const bit = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Color', idEntidad: String(origen.id), accion: 'MODIFICAR' },
        orderBy: { id: 'desc' },
      });
      expect(bit.datos).toMatchObject({ operacion: 'reactivar', deshaceFusionDe: destino.id });
      // Y ya no se redirige: el color vive por su cuenta otra vez.
      expect(await colorCanonico(cliente, origen.id)).toMatchObject({ id: origen.id });
    });

    it('un color ACTIVO con rastro colgando se devuelve TAL CUAL (gana lo que se ve)', async () => {
      const sesion = sesionAdmin();
      const destino = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      // Estado imposible por dominio (reactivar limpia el rastro), fabricado a mano como red:
      // si alguna vez quedara uno colgando, el color activo manda sobre la historia.
      await cliente.color.update({
        where: { id: origen.id },
        data: { activo: true, idFusionadoEn: destino.id },
      });

      expect(await colorCanonico(cliente, origen.id)).toMatchObject({
        id: origen.id,
        activo: true,
      });
    });

    it('una cadena en CÍRCULO no cuelga: se corta con un error que dice cómo romperla', async () => {
      const sesion = sesionAdmin();
      const a = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      const b = await crearColor(sesion, { nombre: 'NEGRO B' }, bd());
      // El dominio no puede fabricar esto (fusionar limpia el rastro del destino); se arma a mano
      // porque el BACKFILL de `20260829120000_a_donde_se_fue_el_color` SÍ podía dejarlo así —lee la
      // bitácora, que guarda también fusiones ya deshechas—. Esa migración lo rompe ella misma; esto
      // de aquí prueba el PARACAÍDAS, por si otro dato viejo dejara un anillo.
      await cliente.color.update({
        where: { id: a.id },
        data: { activo: false, idFusionadoEn: b.id },
      });
      await cliente.color.update({
        where: { id: b.id },
        data: { activo: false, idFusionadoEn: a.id },
      });

      await expect(colorCanonico(cliente, a.id)).rejects.toBeInstanceOf(ErrorConflicto);
      await expect(colorCanonico(cliente, a.id)).rejects.toThrow(/no termina|círculo/);
    });

    it('fusionar DE VUELTA (A→B y luego B→A) no deja un círculo: el destino pierde su rastro', async () => {
      const sesion = sesionAdmin();
      const a = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const b = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      // Daniel se equivoca de lado…
      await fusionarColores(sesion, { idDestino: b.id, origenes: [a.id] }, bd());
      // …y lo corrige fusionando al revés. `a` vuelve a ser el canónico y su rastro se borra.
      await fusionarColores(sesion, { idDestino: a.id, origenes: [b.id] }, bd());

      expect(
        (await cliente.color.findUniqueOrThrow({ where: { id: a.id } })).idFusionadoEn,
      ).toBeNull();
      // Si el destino conservara su rastro, `a→b` y `b→a` cerrarían el círculo y esto reventaría.
      expect(await colorCanonico(cliente, b.id)).toMatchObject({ id: a.id, activo: true });
    });

    it('la relación reflexiva NO bloquea la fusión: un canónico se puede volver a fusionar', async () => {
      const sesion = sesionAdmin();
      const b = await crearColor(sesion, { nombre: 'NEGRO B' }, bd());
      const a = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      const c = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      await fusionarColores(sesion, { idDestino: b.id, origenes: [a.id] }, bd());

      // `b` ya absorbió a `a`; eso NO es un uso de `b`, así que puede fusionarse en `c`.
      await expect(
        fusionarColores(sesion, { idDestino: c.id, origenes: [b.id] }, bd()),
      ).resolves.toMatchObject({ id: c.id });
    });
  });
});
