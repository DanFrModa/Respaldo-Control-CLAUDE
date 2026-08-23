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
  actualizarRangoDificultad,
  crearDuracionAplicacion,
  crearDuracionTela,
  crearFactorCantidad,
  crearRangoDificultad,
  desactivarFactorCantidad,
  desactivarRangoDificultad,
  listarDuracionesAplicacion,
  listarDuracionesTela,
  listarFactoresCantidad,
  listarRangosDificultad,
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
describe('Rangos de dificultad por # de operaciones (R4, B7)', () => {
  it('CRUD con borrado suave, bitácora y permisos', async () => {
    const sesion = sesionAdmin();
    const r = await crearRangoDificultad(
      sesion,
      { opsDesde: 1, opsHasta: 8, nombre: 'Muy sencillo', diasCostura: 6 },
      bd(),
    );
    expect(r.opsHasta).toBe(8);
    await actualizarRangoDificultad(sesion, r.id, { diasCostura: 7 }, bd());
    expect((await listarRangosDificultad(sesion, false, bd()))[0]!.diasCostura).toBe(7);
    await desactivarRangoDificultad(sesion, r.id, bd());
    expect(await listarRangosDificultad(sesion, false, bd())).toHaveLength(0);
    expect(await listarRangosDificultad(sesion, true, bd())).toHaveLength(1);
    // Desactivar dos veces es conflicto.
    await expect(desactivarRangoDificultad(sesion, r.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    // Bitácora del alta (A7).
    const bit = await cliente.bitacora.findFirst({
      where: { entidad: 'RangoDificultad', idEntidad: String(r.id), accion: 'CREAR' },
    });
    expect(bit).not.toBeNull();
    // Permisos (A4): sin rc.catalogo-administrar no se crea.
    await expect(
      crearRangoDificultad(
        sesionDePrueba(),
        { opsDesde: 9, opsHasta: 14, nombre: 'Sencillo', diasCostura: 8 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('rechaza SOLAPES entre rangos activos (incluye el rango abierto)', async () => {
    const sesion = sesionAdmin();
    await crearRangoDificultad(
      sesion,
      { opsDesde: 1, opsHasta: 8, nombre: 'Muy sencillo', diasCostura: 6 },
      bd(),
    );
    const abierto = await crearRangoDificultad(
      sesion,
      { opsDesde: 33, opsHasta: null, nombre: 'Muy complejo', diasCostura: 20 },
      bd(),
    );
    // Se encima con [1,8].
    await expect(
      crearRangoDificultad(
        sesion,
        { opsDesde: 5, opsHasta: 12, nombre: 'Choca', diasCostura: 9 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // Se encima con el abierto 33+.
    await expect(
      crearRangoDificultad(
        sesion,
        { opsDesde: 30, opsHasta: 40, nombre: 'Choca 2', diasCostura: 16 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // Editar un rango hacia un solape tambien se rechaza…
    await expect(
      actualizarRangoDificultad(sesion, abierto.id, { opsDesde: 8 }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // …pero un rango INACTIVO no bloquea (el solape solo cuenta entre activos).
    await desactivarRangoDificultad(sesion, abierto.id, bd());
    const nuevo = await crearRangoDificultad(
      sesion,
      { opsDesde: 33, opsHasta: null, nombre: 'Nuevo abierto', diasCostura: 22 },
      bd(),
    );
    expect(nuevo.opsHasta).toBeNull();
    // Reactivar el viejo ahora si chocaria con el nuevo → se rechaza.
    await expect(
      actualizarRangoDificultad(sesion, abierto.id, { activo: true }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('CONCURRENCIA: dos altas solapadas A LA VEZ → solo una entra (advisory lock del catálogo)', async () => {
    // Regresión del TOCTOU del reviewer: sin el lock, ambas transacciones pasan `exigirSinSolape`
    // bajo Read Committed y quedan DOS rangos activos traslapados. Con el lock, la segunda espera
    // a que la primera comitee y su chequeo la rechaza.
    const sesion = sesionAdmin();
    const resultados = await Promise.allSettled([
      crearRangoDificultad(
        sesion,
        { opsDesde: 1, opsHasta: 10, nombre: 'Carrera A', diasCostura: 5 },
        bd(),
      ),
      crearRangoDificultad(
        sesion,
        { opsDesde: 5, opsHasta: 15, nombre: 'Carrera B', diasCostura: 7 },
        bd(),
      ),
    ]);
    const exitosos = resultados.filter((r) => r.status === 'fulfilled');
    const fallidos = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(exitosos).toHaveLength(1);
    expect(fallidos).toHaveLength(1);
    expect(fallidos[0]!.reason).toBeInstanceOf(ErrorValidacion);
    // Y en la BD quedó UN solo rango activo (jamás los dos traslapados).
    expect(await cliente.rangoDificultad.count({ where: { activo: true } })).toBe(1);
  });

  it('rechaza opsDesde > opsHasta', async () => {
    const sesion = sesionAdmin();
    await expect(
      crearRangoDificultad(
        sesion,
        { opsDesde: 10, opsHasta: 5, nombre: 'Invertido', diasCostura: 3 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
