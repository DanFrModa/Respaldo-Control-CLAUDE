/**
 * Tests de integración de FAMILIAS/ARTÍCULOS, REGLAS DE DURACIÓN y CALENDARIO LABORAL de la RC
 * (F5-E2). Postgres efímero (testcontainers). Cubre CRUD + borrado suave, validaciones, permisos
 * (A4), bitácora (A7) y la carga del calendario PURO que usará el motor de E4.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../../datos/index.js';
import { ErrorConflicto, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { esDiaHabil } from '../../comun/diasHabiles.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarArticulo,
  actualizarFamilia,
  crearArticulo,
  crearFamilia,
  desactivarFamilia,
  listarArticulos,
  listarFamilias,
} from './familiasArticulos.js';
import {
  actualizarFactorCantidad,
  crearDuracionAplicacion,
  crearDuracionTela,
  crearFactorCantidad,
  desactivarFactorCantidad,
  listarDuracionesAplicacion,
  listarDuracionesTela,
  listarFactoresCantidad,
} from './reglasDuracion.js';
import {
  actualizarCalendario,
  cargarCalendarioLaboral,
  crearFestivo,
  listarFestivos,
  obtenerCalendario,
} from './calendarioLaboral.js';

let cliente: PrismaClient;
let empresa: Empresa;

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
  empresa = await crearEmpresaPrueba(cliente);
});

describe('Familias y artículos (F5-E2)', () => {
  it('CRUD de familia con bitácora y borrado suave', async () => {
    const sesion = sesionAdmin();
    const f = await crearFamilia(sesion, { nombre: 'Todos' }, bd());
    expect(f.activo).toBe(true);
    await expect(crearFamilia(sesion, { nombre: 'Todos' }, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    await actualizarFamilia(sesion, f.id, { nombre: 'Todas' }, bd());
    await desactivarFamilia(sesion, f.id, bd());
    expect(await listarFamilias(sesion, false, bd())).toHaveLength(0);
    expect(await listarFamilias(sesion, true, bd())).toHaveLength(1);
    const bit = await cliente.bitacora.findFirst({ where: { entidad: 'FamiliaArticulo' } });
    expect(bit).not.toBeNull();
  });

  it('crea artículo dentro de una familia y rechaza familia inexistente/inactiva', async () => {
    const sesion = sesionAdmin();
    const f = await crearFamilia(sesion, { nombre: 'Todos' }, bd());
    const a = await crearArticulo(
      sesion,
      { nombre: 'SENCILLO 1/6', idFamiliaArticulo: f.id },
      bd(),
    );
    expect(a.familia).toBe('Todos');
    await expect(
      crearArticulo(sesion, { nombre: 'X', idFamiliaArticulo: 999999 }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    await desactivarFamilia(sesion, f.id, bd());
    await expect(
      crearArticulo(sesion, { nombre: 'Y', idFamiliaArticulo: f.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // El artículo creado sigue listándose.
    expect(await listarArticulos(sesion, false, bd())).toHaveLength(1);
  });

  it('mueve un artículo de familia', async () => {
    const sesion = sesionAdmin();
    const f1 = await crearFamilia(sesion, { nombre: 'F1' }, bd());
    const f2 = await crearFamilia(sesion, { nombre: 'F2' }, bd());
    const a = await crearArticulo(sesion, { nombre: 'Art', idFamiliaArticulo: f1.id }, bd());
    const movido = await actualizarArticulo(sesion, a.id, { idFamiliaArticulo: f2.id }, bd());
    expect(movido.familia).toBe('F2');
  });
});

describe('Reglas de duración (F5-E2)', () => {
  it('CRUD de factor por cantidad con validación de rango', async () => {
    const sesion = sesionAdmin();
    const f = await crearFactorCantidad(sesion, { deCant: 1, aCant: 500, factor: 0.6 }, bd());
    expect(f.factor).toBe(0.6);
    await expect(
      crearFactorCantidad(sesion, { deCant: 500, aCant: 1, factor: 1 }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    await actualizarFactorCantidad(sesion, f.id, { factor: 0.7 }, bd());
    await desactivarFactorCantidad(sesion, f.id, bd());
    expect(await listarFactoresCantidad(sesion, false, bd())).toHaveLength(0);
  });

  it('CRUD de duración por tela (con factorTela) y por aplicación (factor opcional)', async () => {
    const sesion = sesionAdmin();
    const tela = await crearDuracionTela(
      sesion,
      { nombre: 'Existencia', dias: 2, factorTela: 0.07 },
      bd(),
    );
    expect(tela.factorTela).toBe(0.07);
    await expect(
      crearDuracionTela(sesion, { nombre: 'Existencia', dias: 1, factorTela: 1 }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    const aplic = await crearDuracionAplicacion(
      sesion,
      { nombre: 'Estampado Sencillo', clave: 'A1', dias: 3 },
      bd(),
    );
    expect(aplic.factor).toBeNull();
    expect(await listarDuracionesTela(sesion, false, bd())).toHaveLength(1);
    expect(await listarDuracionesAplicacion(sesion, false, bd())).toHaveLength(1);
  });

  it('sin permiso de administrar no se puede crear una regla', async () => {
    const soloVer = sesionDePrueba({ permisos: ['rc.catalogo-ver'] });
    await expect(
      crearFactorCantidad(soloVer, { deCant: 1, aCant: 2, factor: 1 }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('Calendario laboral por empresa (F5-E2)', () => {
  it('devuelve el default L–V cuando no hay calendario guardado', async () => {
    const sesion = sesionAdmin();
    const cal = await obtenerCalendario(sesion, empresa.id, bd());
    expect(cal.lunes).toBe(true);
    expect(cal.sabado).toBe(false);
    expect(cal.domingo).toBe(false);
  });

  it('fija el calendario (upsert) y lo refleja en cargarCalendarioLaboral', async () => {
    const sesion = sesionAdmin();
    await actualizarCalendario(
      sesion,
      empresa.id,
      {
        lunes: true,
        martes: true,
        miercoles: true,
        jueves: true,
        viernes: true,
        sabado: true,
        domingo: false,
      },
      bd(),
    );
    const cargado = await cargarCalendarioLaboral(sesion, empresa.id, bd());
    expect(cargado.diasSemana.sabado).toBe(true);
    // 2026-01-10 es sábado: con sábado hábil y sin festivo, es día hábil.
    expect(esDiaHabil(new Date('2026-01-10T00:00:00.000Z'), cargado)).toBe(true);
  });

  it('crea festivos, rechaza duplicado por fecha y los carga en el calendario puro', async () => {
    const sesion = sesionAdmin();
    await crearFestivo(
      sesion,
      { idEmpresa: empresa.id, fecha: '2026-01-01', descripcion: 'Año Nuevo' },
      bd(),
    );
    await expect(
      crearFestivo(
        sesion,
        { idEmpresa: empresa.id, fecha: '2026-01-01', descripcion: 'Dup' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(await listarFestivos(sesion, empresa.id, false, bd())).toHaveLength(1);

    const cargado = await cargarCalendarioLaboral(sesion, empresa.id, bd());
    // 2026-01-01 es jueves; con festivo deja de ser hábil.
    expect(esDiaHabil(new Date('2026-01-01T00:00:00.000Z'), cargado)).toBe(false);
  });

  it('rechaza calendario/festivo de empresa inexistente', async () => {
    const sesion = sesionAdmin();
    await expect(
      actualizarCalendario(
        sesion,
        999999,
        {
          lunes: true,
          martes: true,
          miercoles: true,
          jueves: true,
          viernes: true,
          sabado: false,
          domingo: false,
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
