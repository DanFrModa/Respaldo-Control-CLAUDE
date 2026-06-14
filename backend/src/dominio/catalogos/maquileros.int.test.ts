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
  actualizarMaquilero,
  crearMaquilero,
  desactivarMaquilero,
  listarMaquileros,
  listarTiposProceso,
  obtenerMaquilero,
  reactivarMaquilero,
} from './maquileros.js';

let cliente: PrismaClient;

const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['maquileros.ver', 'maquileros.administrar'] });

const bd = () => ({ cliente });

// Ids de tipos de proceso sembrados en cada test (se rellenan en beforeEach).
let tipoCostura: number;
let tipoEstampado: number;
let tipoBordado: number;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  // Tipos de proceso base (los necesita el alta: el dominio exige ≥1).
  const costura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura' },
  });
  const estampado = await cliente.tipoProceso.create({
    data: { codigo: 'estampado', nombre: 'Estampado' },
  });
  const bordado = await cliente.tipoProceso.create({
    data: { codigo: 'bordado', nombre: 'Bordado' },
  });
  tipoCostura = costura.id;
  tipoEstampado = estampado.id;
  tipoBordado = bordado.id;
});

describe('Catálogo Maquileros (F1-E2, maquila unificada — global ADR-0007)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba();
      await expect(
        crearMaquilero(sinPermisos, { corto: 'X', nombre: 'X', tipos: [tipoCostura] }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarMaquileros(sinPermisos, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarTiposProceso(sinPermisos, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['maquileros.ver'] });
      await expect(
        crearMaquilero(soloVer, { corto: 'X', nombre: 'X', tipos: [tipoCostura] }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarMaquileros(soloVer, {}, bd())).resolves.toBeTruthy();
      await expect(listarTiposProceso(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear (con tipos de proceso, transacción A2)', () => {
    it('crea con tipos, campos opcionales, auditoría y bitácora (A7)', async () => {
      const sesion = sesionAdmin();
      const maquilero = await crearMaquilero(
        sesion,
        {
          corto: 'Intersew',
          nombre: 'Intersew',
          apellidos: 'A',
          telefonos: '01718-1240-395',
          direccion: 'Naucalpan',
          observaciones: 'Buena calidad',
          obsPago: 'Pago semanal',
          asegurado: true,
          tipos: [tipoCostura, tipoEstampado],
        },
        bd(),
      );

      expect(maquilero).toMatchObject({
        corto: 'Intersew',
        nombre: 'Intersew',
        apellidos: 'A',
        telefonos: '01718-1240-395',
        asegurado: true,
        activo: true,
        creadoPorId: sesion.id,
      });
      expect(maquilero.tipos.map((t) => t.tipoProceso.codigo).sort()).toEqual([
        'costura',
        'estampado',
      ]);

      // El renglón puente MaquileroTipoProceso existe (transacción A2: o todo o nada).
      expect(
        await cliente.maquileroTipoProceso.count({ where: { idMaquilero: maquilero.id } }),
      ).toBe(2);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Maquilero', idEntidad: String(maquilero.id), accion: 'CREAR' },
      });
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    it('exige al menos un tipo de proceso: alta sin tipos → ErrorValidacion', async () => {
      await expect(
        crearMaquilero(sesionAdmin(), { corto: 'Sin tipo', nombre: 'Sin tipo', tipos: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza un tipo inexistente → ErrorValidacion (y NO crea el maquilero: A2)', async () => {
      await expect(
        crearMaquilero(
          sesionAdmin(),
          { corto: 'Tipo fantasma', nombre: 'X', tipos: [999999] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.maquilero.count({ where: { corto: 'Tipo fantasma' } })).toBe(0);
    });

    it('no se puede asignar un tipo DESACTIVADO → ErrorValidacion', async () => {
      await cliente.tipoProceso.update({ where: { id: tipoBordado }, data: { activo: false } });
      await expect(
        crearMaquilero(
          sesionAdmin(),
          { corto: 'Con tipo inactivo', nombre: 'X', tipos: [tipoBordado] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza corto duplicado, sin importar mayúsculas → ErrorConflicto', async () => {
      await crearMaquilero(
        sesionAdmin(),
        { corto: 'Intersew', nombre: 'Intersew', tipos: [tipoCostura] },
        bd(),
      );
      await expect(
        crearMaquilero(
          sesionAdmin(),
          { corto: 'intersew', nombre: 'Otro', tipos: [tipoCostura] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('el nombre NO es único: dos maquileros pueden compartir nombre (homónimos del viejo)', async () => {
      await crearMaquilero(
        sesionAdmin(),
        { corto: 'Oscar1', nombre: 'Oscar', tipos: [tipoCostura] },
        bd(),
      );
      const segundo = await crearMaquilero(
        sesionAdmin(),
        { corto: 'Oscar2', nombre: 'Oscar', tipos: [tipoCostura] },
        bd(),
      );
      expect(segundo.nombre).toBe('Oscar');
      expect(await cliente.maquilero.count({ where: { nombre: 'Oscar' } })).toBe(2);
    });
  });

  describe('actualizar (tipos + campos en una transacción)', () => {
    it('reemplaza el set de tipos (diff) en la misma transacción', async () => {
      const sesion = sesionAdmin();
      const maquilero = await crearMaquilero(
        sesion,
        { corto: 'Taller', nombre: 'Taller', tipos: [tipoCostura] },
        bd(),
      );

      const actualizado = await actualizarMaquilero(
        sesion,
        { id: maquilero.id, tipos: [tipoEstampado, tipoBordado] },
        bd(),
      );
      expect(actualizado.tipos.map((t) => t.tipoProceso.codigo).sort()).toEqual([
        'bordado',
        'estampado',
      ]);
      // El de costura se quitó, los otros dos se agregaron.
      expect(
        await cliente.maquileroTipoProceso.count({ where: { idMaquilero: maquilero.id } }),
      ).toBe(2);
    });

    it('en edición los tipos no pueden quedar en 0 → ErrorValidacion', async () => {
      const sesion = sesionAdmin();
      const maquilero = await crearMaquilero(
        sesion,
        { corto: 'Taller', nombre: 'Taller', tipos: [tipoCostura] },
        bd(),
      );
      await expect(
        actualizarMaquilero(sesion, { id: maquilero.id, tipos: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      // sigue con su tipo original (no se vació)
      expect(
        await cliente.maquileroTipoProceso.count({ where: { idMaquilero: maquilero.id } }),
      ).toBe(1);
    });

    it('omitir `tipos` NO toca los tipos existentes', async () => {
      const sesion = sesionAdmin();
      const maquilero = await crearMaquilero(
        sesion,
        { corto: 'Taller', nombre: 'Taller', tipos: [tipoCostura, tipoEstampado] },
        bd(),
      );
      await actualizarMaquilero(sesion, { id: maquilero.id, telefonos: '555' }, bd());
      expect(
        await cliente.maquileroTipoProceso.count({ where: { idMaquilero: maquilero.id } }),
      ).toBe(2);
    });

    it('cambia campos opcionales con bitácora del detalle', async () => {
      const sesion = sesionAdmin();
      const maquilero = await crearMaquilero(
        sesion,
        { corto: 'Prov', nombre: 'Prov', tipos: [tipoCostura], asegurado: false },
        bd(),
      );

      const actualizado = await actualizarMaquilero(
        sesion,
        { id: maquilero.id, telefonos: '555-9999', asegurado: true },
        bd(),
      );
      expect(actualizado).toMatchObject({ telefonos: '555-9999', asegurado: true });

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Maquilero', idEntidad: String(maquilero.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({ asegurado: { de: false, a: true } });
    });

    // M1: en edición, mandar `null` en un campo opcional ya capturado lo BORRA
    // (lo pone a null). Omitirlo NO lo toca. Nunca se guarda ''.
    it('vaciar un campo opcional (null) en edición lo BORRA; omitirlo no lo toca', async () => {
      const sesion = sesionAdmin();
      const maquilero = await crearMaquilero(
        sesion,
        {
          corto: 'Con datos',
          nombre: 'Con datos',
          tipos: [tipoCostura],
          telefonos: '555-1234',
          direccion: 'Naucalpan',
          observaciones: 'una nota',
        },
        bd(),
      );

      // Vaciar telefonos y direccion (null), y NO mandar observaciones (omitir = no tocar).
      const actualizado = await actualizarMaquilero(
        sesion,
        { id: maquilero.id, telefonos: null, direccion: null },
        bd(),
      );

      expect(actualizado.telefonos).toBeNull();
      expect(actualizado.direccion).toBeNull();
      // observaciones NO se tocó (se omitió).
      expect(actualizado.observaciones).toBe('una nota');

      // La bitácora registra el borrado (de: valor, a: null).
      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Maquilero', idEntidad: String(maquilero.id), accion: 'MODIFICAR' },
        orderBy: { fecha: 'desc' },
      });
      expect(bitacora.datos).toMatchObject({ telefonos: { de: '555-1234', a: null } });
    });

    it('un texto opcional que llega vacío ("") se normaliza a null (nunca se guarda "")', async () => {
      const sesion = sesionAdmin();
      const maquilero = await crearMaquilero(
        sesion,
        { corto: 'Prov vacío', nombre: 'Prov', tipos: [tipoCostura], observaciones: 'algo' },
        bd(),
      );

      const actualizado = await actualizarMaquilero(
        sesion,
        { id: maquilero.id, observaciones: '' },
        bd(),
      );
      expect(actualizado.observaciones).toBeNull();

      // Verificación directa en BD: el valor es null, no ''.
      const enBd = await cliente.maquilero.findUniqueOrThrow({ where: { id: maquilero.id } });
      expect(enBd.observaciones).toBeNull();
    });

    it('cambiar el corto a uno ya usado → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      await crearMaquilero(sesion, { corto: 'Uno', nombre: 'Uno', tipos: [tipoCostura] }, bd());
      const segundo = await crearMaquilero(
        sesion,
        { corto: 'Dos', nombre: 'Dos', tipos: [tipoCostura] },
        bd(),
      );
      await expect(
        actualizarMaquilero(sesion, { id: segundo.id, corto: 'uno' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('sin cambio real es idempotente: no escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const maquilero = await crearMaquilero(
        sesion,
        { corto: 'Prov', nombre: 'Prov', tipos: [tipoCostura] },
        bd(),
      );
      const antes = await cliente.bitacora.count();
      await actualizarMaquilero(sesion, { id: maquilero.id, corto: 'Prov', nombre: 'Prov' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(
        actualizarMaquilero(sesionAdmin(), { id: 9999, nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('desactivar / reactivar (borrado suave, PLANMAESTRO §4)', () => {
    it('desactiva con bitácora DESACTIVAR; el registro sigue existiendo', async () => {
      const sesion = sesionAdmin();
      const maquilero = await crearMaquilero(
        sesion,
        { corto: 'Prov', nombre: 'Prov', tipos: [tipoCostura] },
        bd(),
      );

      const desactivado = await desactivarMaquilero(sesion, maquilero.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.maquilero.count()).toBe(1);

      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Maquilero', idEntidad: String(maquilero.id), accion: 'DESACTIVAR' },
      });
    });

    it('desactivar dos veces → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const maquilero = await crearMaquilero(
        sesion,
        { corto: 'Prov', nombre: 'Prov', tipos: [tipoCostura] },
        bd(),
      );
      await desactivarMaquilero(sesion, maquilero.id, bd());
      await expect(desactivarMaquilero(sesion, maquilero.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });

    it('reactivar un maquilero desactivado funciona', async () => {
      const sesion = sesionAdmin();
      const maquilero = await crearMaquilero(
        sesion,
        { corto: 'Prov', nombre: 'Prov', tipos: [tipoCostura] },
        bd(),
      );
      await desactivarMaquilero(sesion, maquilero.id, bd());
      const reactivado = await reactivarMaquilero(sesion, maquilero.id, bd());
      expect(reactivado.activo).toBe(true);
    });

    it('reactivar choca si el corto fue reutilizado por otro activo → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const maquilero = await crearMaquilero(
        sesion,
        { corto: 'Repe', nombre: 'Repe', tipos: [tipoCostura] },
        bd(),
      );
      await desactivarMaquilero(sesion, maquilero.id, bd());
      // Otro maquilero activo toma el mismo corto.
      await crearMaquilero(sesion, { corto: 'Repe', nombre: 'Nuevo', tipos: [tipoCostura] }, bd());
      await expect(reactivarMaquilero(sesion, maquilero.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });
  });

  describe('obtener', () => {
    it('devuelve el maquilero con sus tipos', async () => {
      const sesion = sesionAdmin();
      const maquilero = await crearMaquilero(
        sesion,
        { corto: 'Prov', nombre: 'Prov', tipos: [tipoCostura, tipoEstampado] },
        bd(),
      );
      const obtenido = await obtenerMaquilero(sesion, maquilero.id, bd());
      expect(obtenido.id).toBe(maquilero.id);
      expect(obtenido.tipos).toHaveLength(2);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(obtenerMaquilero(sesionAdmin(), 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });
  });

  describe('listar (búsqueda + filtro por tipo de proceso + paginación)', () => {
    it('filtra por tipo de proceso (some)', async () => {
      const sesion = sesionAdmin();
      await crearMaquilero(
        sesion,
        { corto: 'SoloCostura', nombre: 'A', tipos: [tipoCostura] },
        bd(),
      );
      await crearMaquilero(
        sesion,
        { corto: 'SoloEstampado', nombre: 'B', tipos: [tipoEstampado] },
        bd(),
      );
      await crearMaquilero(
        sesion,
        { corto: 'Mixto', nombre: 'C', tipos: [tipoCostura, tipoBordado] },
        bd(),
      );

      expect((await listarMaquileros(sesion, { tipoProceso: tipoCostura }, bd())).total).toBe(2);
      expect((await listarMaquileros(sesion, { tipoProceso: tipoEstampado }, bd())).total).toBe(1);
      expect((await listarMaquileros(sesion, { tipoProceso: tipoBordado }, bd())).total).toBe(1);
    });

    it('busca por corto O por nombre (insensible a mayúsculas)', async () => {
      const sesion = sesionAdmin();
      await crearMaquilero(
        sesion,
        { corto: 'Intersew', nombre: 'Empresa Norte', tipos: [tipoCostura] },
        bd(),
      );
      await crearMaquilero(
        sesion,
        { corto: 'Karil', nombre: 'David Ilgo', tipos: [tipoCostura] },
        bd(),
      );

      // Coincide por corto
      expect((await listarMaquileros(sesion, { busqueda: 'inter' }, bd())).total).toBe(1);
      // Coincide por nombre
      expect((await listarMaquileros(sesion, { busqueda: 'david' }, bd())).total).toBe(1);
      // No coincide
      expect((await listarMaquileros(sesion, { busqueda: 'zzz' }, bd())).total).toBe(0);
    });

    it('cada maquilero del listado trae sus tipos', async () => {
      const sesion = sesionAdmin();
      await crearMaquilero(
        sesion,
        { corto: 'Multi', nombre: 'Multi', tipos: [tipoCostura, tipoEstampado, tipoBordado] },
        bd(),
      );
      const pagina = await listarMaquileros(sesion, {}, bd());
      expect(pagina.datos[0]?.tipos).toHaveLength(3);
    });

    it('excluye inactivos por defecto', async () => {
      const sesion = sesionAdmin();
      await crearMaquilero(sesion, { corto: 'Activo', nombre: 'A', tipos: [tipoCostura] }, bd());
      const inactivo = await crearMaquilero(
        sesion,
        { corto: 'Inactivo', nombre: 'I', tipos: [tipoCostura] },
        bd(),
      );
      await desactivarMaquilero(sesion, inactivo.id, bd());

      expect((await listarMaquileros(sesion, {}, bd())).total).toBe(1);
      expect((await listarMaquileros(sesion, { incluirInactivos: true }, bd())).total).toBe(2);
    });

    it('pagina y respeta el orden por corto', async () => {
      const sesion = sesionAdmin();
      for (const corto of ['Ccc', 'Aaa', 'Bbb']) {
        await crearMaquilero(sesion, { corto, nombre: corto, tipos: [tipoCostura] }, bd());
      }
      const p1 = await listarMaquileros(
        sesion,
        { pagina: 1, porPagina: 2, ordenarPor: 'corto', direccion: 'asc' },
        bd(),
      );
      expect(p1.total).toBe(3);
      expect(p1.totalPaginas).toBe(2);
      expect(p1.datos.map((m) => m.corto)).toEqual(['Aaa', 'Bbb']);
    });
  });

  describe('tipos de proceso (selector)', () => {
    it('lista solo los activos por defecto', async () => {
      const sesion = sesionAdmin();
      await cliente.tipoProceso.update({ where: { id: tipoBordado }, data: { activo: false } });
      const activos = await listarTiposProceso(sesion, {}, bd());
      expect(activos.map((t) => t.codigo)).not.toContain('bordado');
      const todos = await listarTiposProceso(sesion, { incluirInactivos: true }, bd());
      expect(todos.map((t) => t.codigo)).toContain('bordado');
    });
  });
});
