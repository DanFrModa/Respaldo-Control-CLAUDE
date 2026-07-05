/**
 * Tests de integración del CRUD de Conceptos de costo (F8-E1a). Postgres efímero (testcontainers).
 * Cubre el patrón CRUD + la regla de negocio: un concepto FIJO (`fijo=true`: tela/avíos/maquila)
 * NO se puede DESACTIVAR, y `fijo` NO se toca por API.
 */
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
  actualizarConceptoCosto,
  crearConceptoCosto,
  desactivarConceptoCosto,
  listarConceptosCosto,
  obtenerConceptoCosto,
  reactivarConceptoCosto,
} from './conceptos-costo.js';

let cliente: PrismaClient;

/** Puede administrar el catálogo (`concepto-costo.administrar` incluye `.ver`). */
const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['concepto-costo.ver', 'concepto-costo.administrar'] });

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

describe('CRUD Conceptos de costo (F8-E1a, CRUD patrón)', () => {
  describe('permisos (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sin = sesionDePrueba();
      await expect(
        crearConceptoCosto(sin, { codigo: 'x', nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarConceptosCosto(sin, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['concepto-costo.ver'] });
      await expect(
        crearConceptoCosto(soloVer, { codigo: 'x', nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarConceptosCosto(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear', () => {
    it('crea con defaults (fijo=false, orden=0, activo=true) y bitácora (A7)', async () => {
      const concepto = await crearConceptoCosto(
        sesionAdmin(),
        { codigo: 'estampado', nombre: 'Estampado' },
        bd(),
      );
      expect(concepto).toMatchObject({
        codigo: 'estampado',
        fijo: false,
        orden: 0,
        activo: true,
      });
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'ConceptoCosto', idEntidad: String(concepto.id), accion: 'CREAR' },
      });
    });

    it('respeta el orden cuando se envía', async () => {
      const concepto = await crearConceptoCosto(
        sesionAdmin(),
        { codigo: 'flete', nombre: 'Flete', orden: 5 },
        bd(),
      );
      expect(concepto.orden).toBe(5);
    });

    it('rechaza código duplicado → ErrorConflicto', async () => {
      await crearConceptoCosto(sesionAdmin(), { codigo: 'dup-test', nombre: 'Dup' }, bd());
      await expect(
        crearConceptoCosto(sesionAdmin(), { codigo: 'dup-test', nombre: 'Otro' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('rechaza código en mayúsculas → ErrorValidacion (lowercase-only por diseño)', async () => {
      await expect(
        crearConceptoCosto(sesionAdmin(), { codigo: 'TELA', nombre: 'Tela' }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });

  describe('actualizar', () => {
    it('cambia nombre y orden, y deja bitácora MODIFICAR', async () => {
      const concepto = await crearConceptoCosto(
        sesionAdmin(),
        { codigo: 'flete', nombre: 'Flete', orden: 1 },
        bd(),
      );
      const actualizado = await actualizarConceptoCosto(
        sesionAdmin(),
        { id: concepto.id, nombre: 'Flete terrestre', orden: 9 },
        bd(),
      );
      expect(actualizado.nombre).toBe('Flete terrestre');
      expect(actualizado.orden).toBe(9);
      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'ConceptoCosto', idEntidad: String(concepto.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({ orden: { de: 1, a: 9 } });
    });

    it('sin cambio real es idempotente: no escribe bitácora', async () => {
      const concepto = await crearConceptoCosto(
        sesionAdmin(),
        { codigo: 'flete', nombre: 'Flete' },
        bd(),
      );
      const antes = await cliente.bitacora.count();
      await actualizarConceptoCosto(sesionAdmin(), { id: concepto.id, nombre: 'Flete' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(
        actualizarConceptoCosto(sesionAdmin(), { id: 9999, nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('regla: concepto FIJO no se puede desactivar', () => {
    it('desactivar un concepto fijo (tela) FALLA con ErrorConflicto', async () => {
      // El seed siembra los fijos; aquí lo creamos directo en BD para el test (fijo no es editable por API).
      const fijo = await cliente.conceptoCosto.create({
        data: { codigo: 'tela', nombre: 'Tela', fijo: true },
      });
      await expect(desactivarConceptoCosto(sesionAdmin(), fijo.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
      // Sigue activo: la desactivación se rechazó por completo.
      expect(
        (await cliente.conceptoCosto.findUniqueOrThrow({ where: { id: fijo.id } })).activo,
      ).toBe(true);
    });

    it('un concepto NO fijo sí se desactiva y reactiva (borrado suave)', async () => {
      const sesion = sesionAdmin();
      const concepto = await crearConceptoCosto(sesion, { codigo: 'flete', nombre: 'Flete' }, bd());
      const desactivado = await desactivarConceptoCosto(sesion, concepto.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.conceptoCosto.count()).toBe(1);
      await expect(
        crearConceptoCosto(sesion, { codigo: 'flete', nombre: 'Otro' }, bd()),
      ).rejects.toThrow(/desactivado.*reactivarlo/);
      const reactivado = await reactivarConceptoCosto(sesion, concepto.id, bd());
      expect(reactivado.activo).toBe(true);
    });
  });

  describe('obtener / listar', () => {
    it('obtiene por id o lanza, y lista con búsqueda/orden/paginación', async () => {
      const sesion = sesionAdmin();
      const estampado = await crearConceptoCosto(
        sesion,
        { codigo: 'estampado', nombre: 'Estampado' },
        bd(),
      );
      await crearConceptoCosto(sesion, { codigo: 'bordado', nombre: 'Bordado' }, bd());
      const flete = await crearConceptoCosto(sesion, { codigo: 'flete', nombre: 'Flete' }, bd());
      await desactivarConceptoCosto(sesion, flete.id, bd());

      expect((await obtenerConceptoCosto(sesion, estampado.id, bd())).codigo).toBe('estampado');
      await expect(obtenerConceptoCosto(sesion, 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );

      expect((await listarConceptosCosto(sesion, {}, bd())).total).toBe(2); // solo activos
      expect((await listarConceptosCosto(sesion, { incluirInactivos: true }, bd())).total).toBe(3);
      expect((await listarConceptosCosto(sesion, { busqueda: 'estamp' }, bd())).total).toBe(1);
    });
  });
});
