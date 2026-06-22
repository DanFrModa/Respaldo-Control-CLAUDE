/**
 * Tests de integración del catálogo configurable de la Ruta Crítica (F5-E1). Postgres efímero
 * (testcontainers). Cubre: CRUD + borrado suave, asignación N:M de roles, dependencias con
 * RECHAZO DE CICLOS (directo y transitivo), checklist con borrado suave, permisos y bitácora (A7).
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
  actualizarProceso,
  asignarRolesResponsables,
  crearProceso,
  definirDependencias,
  desactivarProceso,
  editarChecklist,
  listarProcesos,
  obtenerProceso,
  reactivarProceso,
} from './catalogoProcesos.js';

let cliente: PrismaClient;

/** Sesión que administra el catálogo de la RC. */
const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['rc.catalogo-ver', 'rc.catalogo-administrar'] });

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

/** Crea N roles de prueba y devuelve sus ids. */
async function crearRoles(...nombres: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const nombre of nombres) {
    const rol = await cliente.rol.create({ data: { nombre, descripcion: nombre } });
    ids.push(rol.id);
  }
  return ids;
}

describe('Catálogo configurable de la Ruta Crítica (F5-E1)', () => {
  describe('permisos (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sin = sesionDePrueba();
      await expect(
        crearProceso(sin, { codigo: 'corte', nombre: 'Corte' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarProcesos(sin, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['rc.catalogo-ver'] });
      await expect(
        crearProceso(soloVer, { codigo: 'corte', nombre: 'Corte' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarProcesos(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('CRUD + borrado suave', () => {
    it('crea con defaults, escribe bitácora (A7) y lo lee completo', async () => {
      const sesion = sesionAdmin();
      const proceso = await crearProceso(sesion, { codigo: 'corte', nombre: 'Corte' }, bd());
      expect(proceso).toMatchObject({
        codigo: 'corte',
        critico: false,
        ultimoProceso: false,
        condicionAplicabilidad: 'ninguna',
        tipoEvento: 'manual',
        tipoDuracion: 'fija',
        activo: true,
        roles: [],
        antecesores: [],
        checklist: [],
      });
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'ProcesoDef', idEntidad: String(proceso.id), accion: 'CREAR' },
      });
    });

    it('crea con banderas/tipos explícitos', async () => {
      const proceso = await crearProceso(
        sesionAdmin(),
        {
          codigo: 'recepcion-tela',
          nombre: 'Recepción de tela',
          critico: true,
          tipoEvento: 'recepcionTela',
          tipoDuracion: 'porCantidad',
          condicionAplicabilidad: 'soloSiLlevaAplicacion',
        },
        bd(),
      );
      expect(proceso).toMatchObject({
        critico: true,
        tipoEvento: 'recepcionTela',
        tipoDuracion: 'porCantidad',
        condicionAplicabilidad: 'soloSiLlevaAplicacion',
      });
    });

    it('rechaza código duplicado → ErrorConflicto', async () => {
      await crearProceso(sesionAdmin(), { codigo: 'corte', nombre: 'Corte' }, bd());
      await expect(
        crearProceso(sesionAdmin(), { codigo: 'corte', nombre: 'Otro' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('actualiza banderas con bitácora de cambios e idempotencia', async () => {
      const sesion = sesionAdmin();
      const p = await crearProceso(sesion, { codigo: 'corte', nombre: 'Corte' }, bd());
      const actualizado = await actualizarProceso(
        sesion,
        { id: p.id, critico: true, nombre: 'Corte (auditado)' },
        bd(),
      );
      expect(actualizado.critico).toBe(true);
      expect(actualizado.nombre).toBe('Corte (auditado)');

      const antes = await cliente.bitacora.count();
      await actualizarProceso(sesion, { id: p.id, nombre: 'Corte (auditado)' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes); // sin cambio real → sin bitácora
    });

    it('desactiva (suave), reserva el código y reactiva', async () => {
      const sesion = sesionAdmin();
      const p = await crearProceso(sesion, { codigo: 'corte', nombre: 'Corte' }, bd());
      const desactivado = await desactivarProceso(sesion, p.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.procesoDef.count()).toBe(1); // no se borra físico

      await expect(crearProceso(sesion, { codigo: 'corte', nombre: 'Otro' }, bd())).rejects.toThrow(
        /desactivado.*reactivarlo/,
      );

      const reactivado = await reactivarProceso(sesion, p.id, bd());
      expect(reactivado.activo).toBe(true);
    });

    it('lista con búsqueda/paginación (solo activos por defecto) y obtiene por id', async () => {
      const sesion = sesionAdmin();
      const corte = await crearProceso(sesion, { codigo: 'corte', nombre: 'Corte' }, bd());
      await crearProceso(sesion, { codigo: 'empaque', nombre: 'Empaque' }, bd());
      const lavado = await crearProceso(sesion, { codigo: 'lavado', nombre: 'Lavado' }, bd());
      await desactivarProceso(sesion, lavado.id, bd());

      expect((await obtenerProceso(sesion, corte.id, bd())).codigo).toBe('corte');
      await expect(obtenerProceso(sesion, 9999, bd())).rejects.toBeInstanceOf(ErrorNoEncontrado);

      expect((await listarProcesos(sesion, {}, bd())).total).toBe(2);
      expect((await listarProcesos(sesion, { incluirInactivos: true }, bd())).total).toBe(3);
      expect((await listarProcesos(sesion, { busqueda: 'corte' }, bd())).total).toBe(1);
    });
  });

  describe('roles responsables (N:M, A4)', () => {
    it('asigna y reemplaza el set de roles, con bitácora', async () => {
      const sesion = sesionAdmin();
      const [r1, r2, r3] = await crearRoles('Corte', 'Calidad', 'Producción');
      const p = await crearProceso(sesion, { codigo: 'corte', nombre: 'Corte' }, bd());

      const conRoles = await asignarRolesResponsables(sesion, p.id, { idsRoles: [r1!, r2!] }, bd());
      expect(conRoles.roles.map((x) => x.idRol).sort()).toEqual([r1, r2].sort());

      // Reemplaza el set: ahora solo r3.
      const reemplazado = await asignarRolesResponsables(sesion, p.id, { idsRoles: [r3!] }, bd());
      expect(reemplazado.roles.map((x) => x.idRol)).toEqual([r3]);

      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'ProcesoDef', idEntidad: String(p.id), accion: 'MODIFICAR' },
      });
    });

    it('rechaza un rol inexistente → ErrorValidacion', async () => {
      const sesion = sesionAdmin();
      const p = await crearProceso(sesion, { codigo: 'corte', nombre: 'Corte' }, bd());
      await expect(
        asignarRolesResponsables(sesion, p.id, { idsRoles: [99999] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });

  describe('dependencias (DAG) — RECHAZO DE CICLOS', () => {
    it('fija antecesores válidos y los devuelve con código/nombre', async () => {
      const sesion = sesionAdmin();
      const a = await crearProceso(sesion, { codigo: 'corte', nombre: 'Corte' }, bd());
      const b = await crearProceso(sesion, { codigo: 'envio', nombre: 'Envío' }, bd());
      const conDep = await definirDependencias(sesion, b.id, { idsAntecesores: [a.id] }, bd());
      expect(conDep.antecesores).toEqual([{ idProceso: a.id, codigo: 'corte', nombre: 'Corte' }]);
    });

    it('rechaza la auto-antecedencia', async () => {
      const sesion = sesionAdmin();
      const a = await crearProceso(sesion, { codigo: 'corte', nombre: 'Corte' }, bd());
      await expect(
        definirDependencias(sesion, a.id, { idsAntecesores: [a.id] }, bd()),
      ).rejects.toThrow(/su propio antecesor/);
    });

    it('rechaza un ciclo DIRECTO (A↔B)', async () => {
      const sesion = sesionAdmin();
      const a = await crearProceso(sesion, { codigo: 'a', nombre: 'A' }, bd());
      const b = await crearProceso(sesion, { codigo: 'b', nombre: 'B' }, bd());
      await definirDependencias(sesion, b.id, { idsAntecesores: [a.id] }, bd()); // a → b
      await expect(
        definirDependencias(sesion, a.id, { idsAntecesores: [b.id] }, bd()), // b → a cerraría ciclo
      ).rejects.toThrow(/ciclo/i);
    });

    it('rechaza un ciclo TRANSITIVO (A→B→C→A)', async () => {
      const sesion = sesionAdmin();
      const a = await crearProceso(sesion, { codigo: 'a', nombre: 'A' }, bd());
      const b = await crearProceso(sesion, { codigo: 'b', nombre: 'B' }, bd());
      const c = await crearProceso(sesion, { codigo: 'c', nombre: 'C' }, bd());
      await definirDependencias(sesion, b.id, { idsAntecesores: [a.id] }, bd()); // a → b
      await definirDependencias(sesion, c.id, { idsAntecesores: [b.id] }, bd()); // b → c
      await expect(
        definirDependencias(sesion, a.id, { idsAntecesores: [c.id] }, bd()), // c → a cerraría ciclo
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('un antecesor inexistente → ErrorValidacion', async () => {
      const sesion = sesionAdmin();
      const a = await crearProceso(sesion, { codigo: 'corte', nombre: 'Corte' }, bd());
      await expect(
        definirDependencias(sesion, a.id, { idsAntecesores: [99999] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });

  describe('checklist (borrado suave)', () => {
    it('crea, reordena, conserva por id y DESACTIVA los quitados', async () => {
      const sesion = sesionAdmin();
      const p = await crearProceso(sesion, { codigo: 'ficha', nombre: 'Ficha' }, bd());

      const conItems = await editarChecklist(
        sesion,
        p.id,
        { items: [{ descripcion: 'Punto 1' }, { descripcion: 'Punto 2' }] },
        bd(),
      );
      expect(conItems.checklist.map((c) => c.descripcion)).toEqual(['Punto 1', 'Punto 2']);
      const [item1, item2] = conItems.checklist;

      // Conserva el 1º (por id, reordenado al final), quita el 2º (se desactiva), agrega uno nuevo.
      const reeditado = await editarChecklist(
        sesion,
        p.id,
        {
          items: [
            { descripcion: 'Nuevo punto' },
            { id: item1!.id, descripcion: 'Punto 1 (editado)' },
          ],
        },
        bd(),
      );
      expect(reeditado.checklist.map((c) => c.descripcion)).toEqual([
        'Nuevo punto',
        'Punto 1 (editado)',
      ]);
      // El 2º quedó desactivado (borrado suave), no borrado físico.
      const item2EnBd = await cliente.procesoChecklist.findUniqueOrThrow({
        where: { id: item2!.id },
      });
      expect(item2EnBd.activo).toBe(false);
    });

    it('rechaza un ítem con id que no pertenece al proceso', async () => {
      const sesion = sesionAdmin();
      const p = await crearProceso(sesion, { codigo: 'ficha', nombre: 'Ficha' }, bd());
      await expect(
        editarChecklist(sesion, p.id, { items: [{ id: 99999, descripcion: 'X' }] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });
});
