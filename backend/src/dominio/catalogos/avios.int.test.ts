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
  actualizarAvio,
  crearAvio,
  desactivarAvio,
  listarAvios,
  listarProveedoresDeAvio,
  obtenerAvio,
  reactivarAvio,
} from './avios.js';

let cliente: PrismaClient;

const sesionAdmin = () => sesionDePrueba({ permisos: ['avios.ver', 'avios.administrar'] });

const bd = () => ({ cliente });

// Ids de proveedores sembrados en cada test (se rellenan en beforeEach).
let provA: number;
let provB: number;
let provC: number;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  // Proveedores base (los necesita el alta con proveedores: deben existir y estar activos).
  const a = await cliente.proveedor.create({ data: { nombre: 'Botones SA' } });
  const b = await cliente.proveedor.create({ data: { nombre: 'Hilos del Norte' } });
  const c = await cliente.proveedor.create({ data: { nombre: 'Cierres MX' } });
  provA = a.id;
  provB = b.id;
  provC = c.id;
});

describe('Catálogo Avíos (F1-E3, R1 — global ADR-0007)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba();
      await expect(
        crearAvio(sinPermisos, { clave: 'X', descripcion: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarAvios(sinPermisos, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['avios.ver'] });
      await expect(
        crearAvio(soloVer, { clave: 'X', descripcion: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarAvios(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear (con proveedores inline, transacción A2)', () => {
    it('crea con proveedores (precio/condiciones), auditoría y bitácora (A7)', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(
        sesion,
        {
          clave: 'BTN-01',
          descripcion: 'Botón 2 cm',
          unidad: 'pza',
          presentacion: 'caja',
          favorito: true,
          cantFav: 12,
          esGenerico: false,
          precioReferencia: 0.45,
          proveedores: [
            { idProveedor: provA, precio: 0.5, condiciones: 'contado' },
            { idProveedor: provB },
          ],
        },
        bd(),
      );

      expect(avio).toMatchObject({
        clave: 'BTN-01',
        descripcion: 'Botón 2 cm',
        unidad: 'pza',
        presentacion: 'caja',
        favorito: true,
        esGenerico: false,
        activo: true,
        creadoPorId: sesion.id,
      });
      expect(Number(avio.cantFav)).toBe(12);
      expect(Number(avio.precioReferencia)).toBe(0.45);
      expect(avio.proveedores.map((p) => p.idProveedor).sort()).toEqual([provA, provB].sort());
      const renglonA = avio.proveedores.find((p) => p.idProveedor === provA);
      expect(Number(renglonA?.precio)).toBe(0.5);
      expect(renglonA?.condiciones).toBe('contado');

      // Los renglones puente existen (transacción A2: o todo o nada).
      expect(await cliente.avioProveedor.count({ where: { idAvio: avio.id } })).toBe(2);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Avio', idEntidad: String(avio.id), accion: 'CREAR' },
      });
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    it('un avío PUEDE no tener proveedores (≥0) ni unidad/presentación (ETL E6, ADR-0009)', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(sesion, { clave: 'MIGRADO', descripcion: 'Sin datos' }, bd());
      expect(avio.unidad).toBeNull();
      expect(avio.presentacion).toBeNull();
      expect(avio.proveedores).toHaveLength(0);
    });

    it('favorito sin cantFav → ErrorValidacion (y NO crea el avío: A2)', async () => {
      await expect(
        crearAvio(sesionAdmin(), { clave: 'FAV', descripcion: 'X', favorito: true }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.avio.count({ where: { clave: 'FAV' } })).toBe(0);
    });

    it('rechaza clave duplicada, sin importar mayúsculas → ErrorConflicto', async () => {
      await crearAvio(sesionAdmin(), { clave: 'BTN-01', descripcion: 'Botón' }, bd());
      await expect(
        crearAvio(sesionAdmin(), { clave: 'btn-01', descripcion: 'Otro' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('rechaza un proveedor inexistente → ErrorValidacion (y NO crea el avío: A2)', async () => {
      await expect(
        crearAvio(
          sesionAdmin(),
          { clave: 'FANTASMA', descripcion: 'X', proveedores: [{ idProveedor: 999999 }] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.avio.count({ where: { clave: 'FANTASMA' } })).toBe(0);
    });

    it('no se puede asignar un proveedor DESACTIVADO → ErrorValidacion', async () => {
      await cliente.proveedor.update({ where: { id: provC }, data: { activo: false } });
      await expect(
        crearAvio(
          sesionAdmin(),
          { clave: 'CON-INACTIVO', descripcion: 'X', proveedores: [{ idProveedor: provC }] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });

  describe('actualizar (proveedores + campos en una transacción)', () => {
    it('reemplaza el set de proveedores (agrega/quita) y actualiza precio del que sigue', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(
        sesion,
        {
          clave: 'A',
          descripcion: 'A',
          proveedores: [
            { idProveedor: provA, precio: 1 },
            { idProveedor: provB, precio: 2 },
          ],
        },
        bd(),
      );

      // Quita B, deja A (cambia su precio), agrega C.
      const actualizado = await actualizarAvio(
        sesion,
        {
          id: avio.id,
          proveedores: [
            { idProveedor: provA, precio: 1.5 },
            { idProveedor: provC, precio: 3 },
          ],
        },
        bd(),
      );

      expect(actualizado.proveedores.map((p) => p.idProveedor).sort()).toEqual(
        [provA, provC].sort(),
      );
      expect(Number(actualizado.proveedores.find((p) => p.idProveedor === provA)?.precio)).toBe(
        1.5,
      );
      // El renglón de B se borró físicamente (el avío es el dueño, Cascade).
      expect(await cliente.avioProveedor.count({ where: { idAvio: avio.id } })).toBe(2);
      expect(
        await cliente.avioProveedor.count({ where: { idAvio: avio.id, idProveedor: provB } }),
      ).toBe(0);
    });

    it('mandar proveedores: [] deja el avío SIN proveedores (≥0 permitido)', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(
        sesion,
        { clave: 'A', descripcion: 'A', proveedores: [{ idProveedor: provA }] },
        bd(),
      );
      const actualizado = await actualizarAvio(sesion, { id: avio.id, proveedores: [] }, bd());
      expect(actualizado.proveedores).toHaveLength(0);
      expect(await cliente.avioProveedor.count({ where: { idAvio: avio.id } })).toBe(0);
    });

    it('omitir `proveedores` NO toca los proveedores existentes', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(
        sesion,
        {
          clave: 'A',
          descripcion: 'A',
          proveedores: [{ idProveedor: provA }, { idProveedor: provB }],
        },
        bd(),
      );
      await actualizarAvio(sesion, { id: avio.id, descripcion: 'Cambiada' }, bd());
      expect(await cliente.avioProveedor.count({ where: { idAvio: avio.id } })).toBe(2);
    });

    it('al poner favorito:true sin cantFav (ni en BD) → ErrorValidacion', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(sesion, { clave: 'A', descripcion: 'A' }, bd());
      await expect(
        actualizarAvio(sesion, { id: avio.id, favorito: true }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('poner favorito:true junto con cantFav funciona y queda registrado', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(sesion, { clave: 'A', descripcion: 'A' }, bd());
      const actualizado = await actualizarAvio(
        sesion,
        { id: avio.id, favorito: true, cantFav: 6 },
        bd(),
      );
      expect(actualizado.favorito).toBe(true);
      expect(Number(actualizado.cantFav)).toBe(6);
    });

    // M1: vaciar unidad (null) la BORRA; omitir presentación NO la toca.
    it('vaciar unidad (null) la BORRA; omitir presentación no la toca', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(
        sesion,
        { clave: 'A', descripcion: 'A', unidad: 'pza', presentacion: 'caja' },
        bd(),
      );
      const actualizado = await actualizarAvio(sesion, { id: avio.id, unidad: null }, bd());
      expect(actualizado.unidad).toBeNull();
      expect(actualizado.presentacion).toBe('caja');
    });

    it('cambiar la clave a una ya usada → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      await crearAvio(sesion, { clave: 'UNO', descripcion: 'Uno' }, bd());
      const segundo = await crearAvio(sesion, { clave: 'DOS', descripcion: 'Dos' }, bd());
      await expect(
        actualizarAvio(sesion, { id: segundo.id, clave: 'uno' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('sin cambio real es idempotente: no escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(sesion, { clave: 'A', descripcion: 'A' }, bd());
      const antes = await cliente.bitacora.count();
      await actualizarAvio(sesion, { id: avio.id, clave: 'A', descripcion: 'A' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(
        actualizarAvio(sesionAdmin(), { id: 9999, descripcion: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('desactivar / reactivar (borrado suave, PLANMAESTRO §4)', () => {
    it('desactiva con bitácora DESACTIVAR; el registro sigue existiendo', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(sesion, { clave: 'A', descripcion: 'A' }, bd());

      const desactivado = await desactivarAvio(sesion, avio.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.avio.count()).toBe(1);

      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Avio', idEntidad: String(avio.id), accion: 'DESACTIVAR' },
      });
    });

    it('desactivar dos veces → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(sesion, { clave: 'A', descripcion: 'A' }, bd());
      await desactivarAvio(sesion, avio.id, bd());
      await expect(desactivarAvio(sesion, avio.id, bd())).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('reactivar un avío desactivado funciona', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(sesion, { clave: 'A', descripcion: 'A' }, bd());
      await desactivarAvio(sesion, avio.id, bd());
      const reactivado = await reactivarAvio(sesion, avio.id, bd());
      expect(reactivado.activo).toBe(true);
    });

    it('crear con la clave de un avío desactivado choca (pide reactivarlo) → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(sesion, { clave: 'REPE', descripcion: 'Repe' }, bd());
      await desactivarAvio(sesion, avio.id, bd());
      await expect(
        crearAvio(sesion, { clave: 'REPE', descripcion: 'Nuevo' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('obtener / proveedores de un avío', () => {
    it('devuelve el avío con sus proveedores activos', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(
        sesion,
        {
          clave: 'A',
          descripcion: 'A',
          proveedores: [{ idProveedor: provA }, { idProveedor: provB }],
        },
        bd(),
      );
      const obtenido = await obtenerAvio(sesion, avio.id, bd());
      expect(obtenido.id).toBe(avio.id);
      expect(obtenido.proveedores).toHaveLength(2);
    });

    it('listarProveedoresDeAvio trae el precio por proveedor', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(
        sesion,
        { clave: 'A', descripcion: 'A', proveedores: [{ idProveedor: provA, precio: 7 }] },
        bd(),
      );
      const proveedores = await listarProveedoresDeAvio(sesion, avio.id, bd());
      expect(proveedores).toHaveLength(1);
      expect(Number(proveedores[0]?.precio)).toBe(7);
      expect(proveedores[0]?.proveedor.nombre).toBe('Botones SA');
    });

    // ⭐⭐ §Post-F9.97 — el precio del proveedor YA está por unidad de consumo y el selector de
    // amarre de la receta lo enseña tal cual. La columna muerta del factor se ceba a propósito (por
    // escritura directa: el contrato nunca la expuso) para exigir que NADIE la vuelva a leer.
    it('listarProveedoresDeAvio NO convierte: la columna muerta del factor se ignora', async () => {
      const sesion = sesionAdmin();
      const avio = await crearAvio(
        sesion,
        {
          clave: 'ROLLO',
          descripcion: 'Elástico',
          proveedores: [{ idProveedor: provA, precio: 500 }],
        },
        bd(),
      );
      await cliente.avioProveedor.update({
        where: { idAvio_idProveedor: { idAvio: avio.id, idProveedor: provA } },
        data: { factorConversion: 50 },
      });
      const proveedores = await listarProveedoresDeAvio(sesion, avio.id, bd());
      // Con el factor vivo esto habría dado 10 (500 ÷ 50).
      expect(Number(proveedores[0]?.precio)).toBe(500);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(obtenerAvio(sesionAdmin(), 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });
  });

  describe('listar (búsqueda + filtro esGenerico + paginación)', () => {
    it('filtra por esGenerico (R4)', async () => {
      const sesion = sesionAdmin();
      await crearAvio(sesion, { clave: 'GEN', descripcion: 'Genérico', esGenerico: true }, bd());
      await crearAvio(sesion, { clave: 'NORM', descripcion: 'Normal', esGenerico: false }, bd());

      expect((await listarAvios(sesion, { esGenerico: true }, bd())).total).toBe(1);
      expect((await listarAvios(sesion, { esGenerico: false }, bd())).total).toBe(1);
      // Sin filtro: ambos.
      expect((await listarAvios(sesion, {}, bd())).total).toBe(2);
    });

    it('busca por clave O por descripción (insensible a mayúsculas)', async () => {
      const sesion = sesionAdmin();
      await crearAvio(sesion, { clave: 'BTN-01', descripcion: 'Botón redondo' }, bd());
      await crearAvio(sesion, { clave: 'HIL-09', descripcion: 'Hilo poliéster' }, bd());

      expect((await listarAvios(sesion, { busqueda: 'btn' }, bd())).total).toBe(1);
      expect((await listarAvios(sesion, { busqueda: 'poliéster' }, bd())).total).toBe(1);
      expect((await listarAvios(sesion, { busqueda: 'zzz' }, bd())).total).toBe(0);
    });

    it('cada avío del listado trae sus proveedores activos', async () => {
      const sesion = sesionAdmin();
      await crearAvio(
        sesion,
        {
          clave: 'A',
          descripcion: 'A',
          proveedores: [{ idProveedor: provA }, { idProveedor: provB }, { idProveedor: provC }],
        },
        bd(),
      );
      const pagina = await listarAvios(sesion, {}, bd());
      expect(pagina.datos[0]?.proveedores).toHaveLength(3);
    });

    it('excluye inactivos por defecto', async () => {
      const sesion = sesionAdmin();
      await crearAvio(sesion, { clave: 'ACT', descripcion: 'A' }, bd());
      const inactivo = await crearAvio(sesion, { clave: 'INA', descripcion: 'I' }, bd());
      await desactivarAvio(sesion, inactivo.id, bd());

      expect((await listarAvios(sesion, {}, bd())).total).toBe(1);
      expect((await listarAvios(sesion, { incluirInactivos: true }, bd())).total).toBe(2);
    });

    it('pagina y respeta el orden por clave', async () => {
      const sesion = sesionAdmin();
      for (const clave of ['CCC', 'AAA', 'BBB']) {
        await crearAvio(sesion, { clave, descripcion: clave }, bd());
      }
      const p1 = await listarAvios(
        sesion,
        { pagina: 1, porPagina: 2, ordenarPor: 'clave', direccion: 'asc' },
        bd(),
      );
      expect(p1.total).toBe(3);
      expect(p1.totalPaginas).toBe(2);
      expect(p1.datos.map((a) => a.clave)).toEqual(['AAA', 'BBB']);
    });
  });

  /**
   * ⭐ V1-E3m (§Post-F9.82) — EL PROVEEDOR HABITUAL. Daniel: *"tener avíos sin proveedor asignado
   * está generando más problemas que beneficios"*. La explosión propone al HABITUAL (arriba del
   * "más barato" de F4), así que el catálogo tiene que poder marcarlo — y **uno solo**: dos
   * habituales harían que "a quién le compramos siempre" dependiera del orden de las filas. Lo
   * último lo cierra un índice único PARCIAL en la base, no la buena voluntad del dominio.
   */
  describe('proveedor HABITUAL del avío (§Post-F9.82)', () => {
    it('se guarda al crear y viaja en la lectura', async () => {
      const avio = await crearAvio(
        sesionAdmin(),
        {
          clave: 'HAB-01',
          descripcion: 'Elástico',
          proveedores: [
            { idProveedor: provA, precio: 3 },
            { idProveedor: provB, precio: 9, habitual: true },
          ],
        },
        bd(),
      );
      const filas = await listarProveedoresDeAvio(sesionAdmin(), avio.id, bd());
      // El habitual es el CARO: si el dominio lo dedujera del precio, aquí saldría provA.
      expect(filas.find((f) => f.idProveedor === provB)?.habitual).toBe(true);
      expect(filas.find((f) => f.idProveedor === provA)?.habitual).toBe(false);
    });

    it('MOVER el habitual de A a B apaga al anterior (y no revienta el índice único)', async () => {
      const avio = await crearAvio(
        sesionAdmin(),
        {
          clave: 'HAB-02',
          descripcion: 'Cierre',
          proveedores: [
            { idProveedor: provA, precio: 3, habitual: true },
            { idProveedor: provB, precio: 9 },
          ],
        },
        bd(),
      );
      // Encender el nuevo ANTES de apagar el viejo reventaría contra la base (el índice se verifica
      // por sentencia): esta prueba existe justo para fijar ese orden.
      await actualizarAvio(
        sesionAdmin(),
        {
          id: avio.id,
          proveedores: [
            { idProveedor: provA, precio: 3 },
            { idProveedor: provB, precio: 9, habitual: true },
          ],
        },
        bd(),
      );
      const filas = await listarProveedoresDeAvio(sesionAdmin(), avio.id, bd());
      expect(filas.filter((f) => f.habitual).map((f) => f.idProveedor)).toEqual([provB]);
    });

    it('DOS habituales se rechazan (el dominio es la autoridad, no solo el contrato)', async () => {
      await expect(
        crearAvio(
          sesionAdmin(),
          {
            clave: 'HAB-03',
            descripcion: 'Doble',
            proveedores: [
              { idProveedor: provA, precio: 3, habitual: true },
              { idProveedor: provB, precio: 9, habitual: true },
            ],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('quitar la bandera deja al avío sin habitual (y la explosión vuelve al más barato)', async () => {
      const avio = await crearAvio(
        sesionAdmin(),
        {
          clave: 'HAB-04',
          descripcion: 'Sin habitual',
          proveedores: [{ idProveedor: provA, precio: 3, habitual: true }],
        },
        bd(),
      );
      await actualizarAvio(
        sesionAdmin(),
        { id: avio.id, proveedores: [{ idProveedor: provA, precio: 3 }] },
        bd(),
      );
      const filas = await listarProveedoresDeAvio(sesionAdmin(), avio.id, bd());
      expect(filas.every((f) => !f.habitual)).toBe(true);
    });
  });
});
