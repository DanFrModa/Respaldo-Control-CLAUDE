/**
 * Tests de integración del CRUD de Tipos de proceso (F3-E1). Postgres efímero (testcontainers).
 * Cubre el patrón CRUD + la regla de la bandera `generaEntradaPt` editable SOLO por admin
 * (decisión (e)): un `tipos-proceso.administrar` SIN `roles.administrar` no puede tocarla.
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
  actualizarTipoProceso,
  crearTipoProceso,
  desactivarTipoProceso,
  listarTiposProceso,
  obtenerTipoProceso,
  reactivarTipoProceso,
} from './tipos-proceso.js';

let cliente: PrismaClient;

/** Admin total: tiene `roles.administrar` → puede editar `generaEntradaPt`. */
const sesionAdmin = () =>
  sesionDePrueba({
    permisos: ['tipos-proceso.ver', 'tipos-proceso.administrar', 'roles.administrar'],
  });
/** Administra el catálogo pero NO es admin total → NO puede tocar `generaEntradaPt`. */
const sesionGestor = () =>
  sesionDePrueba({ permisos: ['tipos-proceso.ver', 'tipos-proceso.administrar'] });

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

describe('CRUD Tipos de proceso (F3-E1, CRUD patrón)', () => {
  describe('permisos (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sin = sesionDePrueba();
      await expect(
        crearTipoProceso(sin, { codigo: 'x', nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarTiposProceso(sin, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['tipos-proceso.ver'] });
      await expect(
        crearTipoProceso(soloVer, { codigo: 'x', nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarTiposProceso(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear', () => {
    it('crea con default generaEntradaPt=false y bitácora (A7)', async () => {
      const sesion = sesionAdmin();
      const tipo = await crearTipoProceso(sesion, { codigo: 'lavado', nombre: 'Lavado' }, bd());
      expect(tipo).toMatchObject({ codigo: 'lavado', generaEntradaPt: false, activo: true });
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'TipoProceso', idEntidad: String(tipo.id), accion: 'CREAR' },
      });
    });

    it('un ADMIN sí puede crear con generaEntradaPt=true (decisión (e))', async () => {
      const tipo = await crearTipoProceso(
        sesionAdmin(),
        { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
        bd(),
      );
      expect(tipo.generaEntradaPt).toBe(true);
    });

    it('un GESTOR (no admin) NO puede fijar generaEntradaPt: queda en false', async () => {
      const tipo = await crearTipoProceso(
        sesionGestor(),
        { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
        bd(),
      );
      expect(tipo.generaEntradaPt).toBe(false); // el servidor descarta la bandera para no-admin
    });

    it('rechaza código duplicado → ErrorConflicto', async () => {
      // Unicidad REAL: el mismo código válido (lowercase) creado dos veces → conflicto.
      await crearTipoProceso(
        sesionAdmin(),
        { codigo: 'proceso-dup-test', nombre: 'Proceso dup' },
        bd(),
      );
      await expect(
        crearTipoProceso(sesionAdmin(), { codigo: 'proceso-dup-test', nombre: 'Otra' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('rechaza código en mayúsculas → ErrorValidacion (el código es lowercase-only por diseño)', async () => {
      // El `codigo` valida con regex `^[a-z][a-z0-9-]*$`: las mayúsculas se rechazan ANTES de la
      // comprobación de unicidad. Documenta que minúsculas-only es el diseño correcto.
      await expect(
        crearTipoProceso(sesionAdmin(), { codigo: 'COSTURA', nombre: 'Costura' }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });

  describe('actualizar', () => {
    it('un GESTOR puede cambiar el nombre pero NO la bandera', async () => {
      const tipo = await crearTipoProceso(
        sesionAdmin(),
        { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
        bd(),
      );
      const actualizado = await actualizarTipoProceso(
        sesionGestor(),
        { id: tipo.id, nombre: 'Costura premium', generaEntradaPt: false },
        bd(),
      );
      expect(actualizado.nombre).toBe('Costura premium');
      expect(actualizado.generaEntradaPt).toBe(true); // la bandera NO cambió (no es admin)
    });

    it('un ADMIN sí cambia la bandera y queda en bitácora', async () => {
      const tipo = await crearTipoProceso(
        sesionAdmin(),
        { codigo: 'estampado', nombre: 'Estampado' },
        bd(),
      );
      const actualizado = await actualizarTipoProceso(
        sesionAdmin(),
        { id: tipo.id, generaEntradaPt: true },
        bd(),
      );
      expect(actualizado.generaEntradaPt).toBe(true);
      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'TipoProceso', idEntidad: String(tipo.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({ generaEntradaPt: { de: false, a: true } });
    });

    it('sin cambio real es idempotente: no escribe bitácora', async () => {
      const tipo = await crearTipoProceso(
        sesionAdmin(),
        { codigo: 'costura', nombre: 'Costura' },
        bd(),
      );
      const antes = await cliente.bitacora.count();
      await actualizarTipoProceso(sesionAdmin(), { id: tipo.id, nombre: 'Costura' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(
        actualizarTipoProceso(sesionAdmin(), { id: 9999, nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('desactivar / reactivar (borrado suave)', () => {
    it('desactiva, conserva el registro y reserva el código', async () => {
      const sesion = sesionAdmin();
      const tipo = await crearTipoProceso(sesion, { codigo: 'lavado', nombre: 'Lavado' }, bd());
      const desactivado = await desactivarTipoProceso(sesion, tipo.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.tipoProceso.count()).toBe(1);
      await expect(
        crearTipoProceso(sesion, { codigo: 'lavado', nombre: 'Otro' }, bd()),
      ).rejects.toThrow(/desactivado.*reactivarlo/);
      const reactivado = await reactivarTipoProceso(sesion, tipo.id, bd());
      expect(reactivado.activo).toBe(true);
    });
  });

  describe('obtener / listar', () => {
    it('obtiene por id o lanza, y lista con búsqueda/orden/paginación', async () => {
      const sesion = sesionAdmin();
      const costura = await crearTipoProceso(
        sesion,
        { codigo: 'costura', nombre: 'Costura' },
        bd(),
      );
      await crearTipoProceso(sesion, { codigo: 'bordado', nombre: 'Bordado' }, bd());
      const lavado = await crearTipoProceso(sesion, { codigo: 'lavado', nombre: 'Lavado' }, bd());
      await desactivarTipoProceso(sesion, lavado.id, bd());

      expect((await obtenerTipoProceso(sesion, costura.id, bd())).codigo).toBe('costura');
      await expect(obtenerTipoProceso(sesion, 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );

      expect((await listarTiposProceso(sesion, {}, bd())).total).toBe(2); // solo activos
      expect((await listarTiposProceso(sesion, { incluirInactivos: true }, bd())).total).toBe(3);
      expect((await listarTiposProceso(sesion, { busqueda: 'cost' }, bd())).total).toBe(1);
    });
  });
});
