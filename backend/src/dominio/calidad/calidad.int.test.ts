/**
 * Tests de integración de CALIDAD — base configurable (F6-E1). Postgres efímero (testcontainers).
 * Cubre: el patrón CRUD con borrado SUAVE de tipos de producto y defectos (incl. el etiquetado M:N
 * y la regla `aplicaGeneral`), la RESOLUCIÓN del plan AQL (muestra + límite por nivel para casos de
 * tabla conocidos), la unicidad insensible a mayúsculas, los permisos deny-by-default y la bitácora
 * (A7) escrita en la misma transacción.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { ErrorConflicto, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarTipoProducto,
  crearTipoProducto,
  desactivarTipoProducto,
  listarTiposProducto,
  reactivarTipoProducto,
} from './tipos-producto.js';
import { actualizarDefecto, crearDefecto, desactivarDefecto, listarDefectos } from './defectos.js';
import { crearPlanAql, resolverPlan } from './planes-aql.js';

let cliente: PrismaClient;

/** Administra el catálogo (alta/edición/des-reactivar) + consulta. */
const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['calidad.ver', 'calidad.administrar-catalogo'] });
/** Solo consulta. */
const sesionVer = () => sesionDePrueba({ permisos: ['calidad.ver'] });

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

describe('Calidad — permisos (deny-by-default, §9.2)', () => {
  it('sin permiso no se puede ni leer ni escribir', async () => {
    const sin = sesionDePrueba();
    await expect(crearTipoProducto(sin, { nombre: 'X' }, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
    await expect(listarTiposProducto(sin, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(listarDefectos(sin, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('con solo lectura no se puede escribir, pero sí leer', async () => {
    await expect(
      crearTipoProducto(sesionVer(), { nombre: 'Playera' }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(listarTiposProducto(sesionVer(), {}, bd())).resolves.toBeTruthy();
  });
});

describe('Calidad — tipos de producto (CRUD + borrado suave)', () => {
  it('crea, escribe bitácora (A7), edita, desactiva y reactiva', async () => {
    const sesion = sesionAdmin();
    const tipo = await crearTipoProducto(sesion, { nombre: 'Playera' }, bd());
    expect(tipo).toMatchObject({ nombre: 'Playera', activo: true });

    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'TipoProducto', idEntidad: String(tipo.id), accion: 'CREAR' },
    });
    expect(bitacora.idUsuario).toBe(sesion.id);

    const editado = await actualizarTipoProducto(sesion, { id: tipo.id, nombre: 'Playeras' }, bd());
    expect(editado.nombre).toBe('Playeras');

    const desactivado = await desactivarTipoProducto(sesion, tipo.id, bd());
    expect(desactivado.activo).toBe(false);
    // Desactivar dos veces es conflicto.
    await expect(desactivarTipoProducto(sesion, tipo.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    const reactivado = await reactivarTipoProducto(sesion, tipo.id, bd());
    expect(reactivado.activo).toBe(true);
  });

  it('rechaza nombre duplicado (insensible a mayúsculas)', async () => {
    const sesion = sesionAdmin();
    await crearTipoProducto(sesion, { nombre: 'Sudadera' }, bd());
    await expect(crearTipoProducto(sesion, { nombre: 'sudadera' }, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('por defecto el listado solo trae activos; incluirInactivos los muestra', async () => {
    const sesion = sesionAdmin();
    const t = await crearTipoProducto(sesion, { nombre: 'Short' }, bd());
    await desactivarTipoProducto(sesion, t.id, bd());
    expect((await listarTiposProducto(sesion, {}, bd())).total).toBe(0);
    expect((await listarTiposProducto(sesion, { incluirInactivos: true }, bd())).total).toBe(1);
  });
});

describe('Calidad — defectos (etiquetado por tipo de producto, decisión (d))', () => {
  it('crea un defecto ligado a tipos de producto y los devuelve', async () => {
    const sesion = sesionAdmin();
    const playera = await crearTipoProducto(sesion, { nombre: 'Playera' }, bd());
    const pantalon = await crearTipoProducto(sesion, { nombre: 'Pantalón' }, bd());

    const defecto = await crearDefecto(
      sesion,
      {
        clave: 'COST-01',
        descripcion: 'Costura abierta',
        nivelAQL: 2.5,
        severidad: 'mayor',
        favorito: true,
        aplicaGeneral: false,
        tiposProducto: [playera.id, pantalon.id],
      },
      bd(),
    );
    expect(defecto.clave).toBe('COST-01');
    expect(defecto.favorito).toBe(true);
    expect(defecto.tiposLigados.map((l) => l.tipoProducto.nombre).sort()).toEqual([
      'Pantalón',
      'Playera',
    ]);
  });

  it('aplicaGeneral=true ignora las ligas (defecto universal)', async () => {
    const sesion = sesionAdmin();
    const playera = await crearTipoProducto(sesion, { nombre: 'Playera' }, bd());
    const defecto = await crearDefecto(
      sesion,
      {
        clave: 'GEN-01',
        descripcion: 'Mancha',
        nivelAQL: 10,
        aplicaGeneral: true,
        tiposProducto: [playera.id], // se ignora
      },
      bd(),
    );
    expect(defecto.aplicaGeneral).toBe(true);
    expect(defecto.tiposLigados).toHaveLength(0);
  });

  it('rechaza un tipo de producto inexistente o desactivado', async () => {
    const sesion = sesionAdmin();
    const t = await crearTipoProducto(sesion, { nombre: 'Vestido' }, bd());
    await desactivarTipoProducto(sesion, t.id, bd());
    await expect(
      crearDefecto(
        sesion,
        {
          clave: 'X-01',
          descripcion: 'X',
          nivelAQL: 1,
          aplicaGeneral: false,
          tiposProducto: [t.id],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('al editar reescribe el set de tipos ligados', async () => {
    const sesion = sesionAdmin();
    const a = await crearTipoProducto(sesion, { nombre: 'A' }, bd());
    const b = await crearTipoProducto(sesion, { nombre: 'B' }, bd());
    const defecto = await crearDefecto(
      sesion,
      {
        clave: 'R-01',
        descripcion: 'R',
        nivelAQL: 2.5,
        aplicaGeneral: false,
        tiposProducto: [a.id],
      },
      bd(),
    );
    const editado = await actualizarDefecto(
      sesion,
      { id: defecto.id, tiposProducto: [b.id] },
      bd(),
    );
    expect(editado.tiposLigados.map((l) => l.tipoProducto.nombre)).toEqual(['B']);
  });

  it('un defecto desactivado NO se borra físico (borrado suave) y filtra/busca', async () => {
    const sesion = sesionAdmin();
    const d = await crearDefecto(
      sesion,
      { clave: 'SUAVE-01', descripcion: 'Hilo suelto', nivelAQL: 10, aplicaGeneral: true },
      bd(),
    );
    await desactivarDefecto(sesion, d.id, bd());
    // Sigue existiendo en BD.
    expect(await cliente.defectoCatalogo.findUnique({ where: { id: d.id } })).not.toBeNull();
    // No aparece en el listado por defecto.
    expect((await listarDefectos(sesion, {}, bd())).total).toBe(0);
    // Búsqueda por descripción (incluyendo inactivos).
    const busqueda = await listarDefectos(
      sesion,
      { busqueda: 'hilo', incluirInactivos: true },
      bd(),
    );
    expect(busqueda.total).toBe(1);
  });

  it('rechaza clave duplicada (insensible a mayúsculas)', async () => {
    const sesion = sesionAdmin();
    await crearDefecto(
      sesion,
      { clave: 'DUP-01', descripcion: 'A', nivelAQL: 1, aplicaGeneral: true },
      bd(),
    );
    await expect(
      crearDefecto(
        sesion,
        { clave: 'dup-01', descripcion: 'B', nivelAQL: 1, aplicaGeneral: true },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('Calidad — resolución del plan AQL (muestra + límite por nivel)', () => {
  /** Crea un plan con los renglones de los casos de la verificación de Gabriel. */
  async function planDePrueba() {
    const sesion = sesionAdmin();
    return crearPlanAql(
      sesion,
      {
        nombre: 'Plan prueba',
        renglones: [
          {
            loteMin: 151,
            loteMax: 280,
            tamanoMuestra: 32,
            limites: [
              { nivelAQL: 1, aceptar: 1, rechazar: 2 },
              { nivelAQL: 2.5, aceptar: 2, rechazar: 3 },
              { nivelAQL: 10, aceptar: 7, rechazar: 8 },
            ],
          },
          {
            loteMin: 281,
            loteMax: 500,
            tamanoMuestra: 50,
            limites: [
              { nivelAQL: 1, aceptar: 1, rechazar: 2 },
              { nivelAQL: 2.5, aceptar: 3, rechazar: 4 },
              { nivelAQL: 10, aceptar: 10, rechazar: 11 },
            ],
          },
          {
            loteMin: 501,
            loteMax: null, // rango abierto
            tamanoMuestra: 80,
            limites: [{ nivelAQL: 2.5, aceptar: 5, rechazar: 6 }],
          },
        ],
      },
      bd(),
    );
  }

  it('resuelve muestra 50 y límite 3/4 para lote 400 nivel 2.5 (caso de Gabriel)', async () => {
    await planDePrueba();
    const r = await resolverPlan(sesionVer(), { tamanoLote: 400, nivelAQL: 2.5 }, bd());
    expect(r.tamanoMuestra).toBe(50);
    expect(r.aceptar).toBe(3);
    expect(r.rechazar).toBe(4);
  });

  it('cada nivel tiene su PROPIO límite en el mismo renglón', async () => {
    await planDePrueba();
    const r10 = await resolverPlan(sesionVer(), { tamanoLote: 400, nivelAQL: 10 }, bd());
    expect(r10.tamanoMuestra).toBe(50);
    expect(r10.aceptar).toBe(10);
    expect(r10.rechazar).toBe(11);
  });

  it('el rango abierto (loteMax null) cubre cualquier lote grande', async () => {
    await planDePrueba();
    const r = await resolverPlan(sesionVer(), { tamanoLote: 99999, nivelAQL: 2.5 }, bd());
    expect(r.tamanoMuestra).toBe(80);
    expect(r.aceptar).toBe(5);
  });

  it('lote fuera de todo rango → ErrorValidacion', async () => {
    await planDePrueba();
    await expect(
      resolverPlan(sesionVer(), { tamanoLote: 10, nivelAQL: 2.5 }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('nivel sin límite en el renglón → ErrorValidacion', async () => {
    await planDePrueba();
    // El rango abierto solo definió el nivel 2.5; pedir el 10 ahí falla.
    await expect(
      resolverPlan(sesionVer(), { tamanoLote: 1000, nivelAQL: 10 }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza renglones con rangos solapados al crear el plan', async () => {
    const sesion = sesionAdmin();
    await expect(
      crearPlanAql(
        sesion,
        {
          nombre: 'Plan inválido',
          renglones: [
            {
              loteMin: 1,
              loteMax: 100,
              tamanoMuestra: 5,
              limites: [{ nivelAQL: 1, aceptar: 0, rechazar: 1 }],
            },
            {
              loteMin: 50, // solapa con el anterior
              loteMax: 200,
              tamanoMuestra: 8,
              limites: [{ nivelAQL: 1, aceptar: 0, rechazar: 1 }],
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
