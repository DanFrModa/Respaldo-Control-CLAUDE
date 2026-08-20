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
import { sembrarCalidad } from '../../../prisma/seed-calidad.js';

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

/**
 * ⭐ EL SEED TIENE QUE TRAER LOS NUEVE CONCEPTOS DE DANIEL (V1-E3n).
 *
 * En la primera vuelta faltaban **Chamarra (8) y Gorra (9)** — 356 y 73 modelos en el Access, el 9 %
 * del catálogo—, así que no había tipo que elegir para desarrollarlas: un callejón sin salida en el
 * camino que la etapa construye. Esta prueba corre el seed REAL, no una copia de la lista.
 */
describe('Calidad — el seed de tipos de producto y sus dígitos de concepto', () => {
  it('siembra los 8 tipos con el dígito de la tabla de Daniel, Chamarra y Gorra incluidas', async () => {
    await sembrarCalidad(cliente);

    const tipos = await cliente.tipoProducto.findMany({
      select: { nombre: true, digitoConcepto: true },
      orderBy: { nombre: 'asc' },
    });
    const porNombre = new Map(tipos.map((t) => [t.nombre, t.digitoConcepto]));

    // Los dígitos CONCRETOS de la tabla de 2014: si alguno se moviera, el código de sus modelos
    // saldría con el concepto equivocado y nada más lo notaría.
    expect(porNombre.get('Conjunto')).toBe(2);
    expect(porNombre.get('Short')).toBe(3);
    expect(porNombre.get('Vestido')).toBe(4);
    expect(porNombre.get('Playera')).toBe(5);
    expect(porNombre.get('Sudadera')).toBe(6);
    expect(porNombre.get('Pantalón')).toBe(7);
    expect(porNombre.get('Chamarra')).toBe(8);
    expect(porNombre.get('Gorra')).toBe(9);
    // "Ropa interior" NO está en la tabla de Daniel: se queda sin dígito a propósito.
    expect(porNombre.has('Ropa interior')).toBe(true);
    expect(porNombre.get('Ropa interior')).toBeNull();

    // Ningún dígito repetido entre los activos (cada concepto es su propia serie de 999).
    const digitos = tipos.map((t) => t.digitoConcepto).filter((d): d is number => d !== null);
    expect(new Set(digitos).size).toBe(digitos.length);
  });

  it('el seed es idempotente: re-correrlo no duplica ni pierde los dígitos', async () => {
    await sembrarCalidad(cliente);
    await sembrarCalidad(cliente);
    const chamarras = await cliente.tipoProducto.findMany({ where: { nombre: 'Chamarra' } });
    expect(chamarras).toHaveLength(1);
    expect(chamarras[0]?.digitoConcepto).toBe(8);
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

  /**
   * V1-E3n: el `digitoConcepto` (1er dígito del código de producción, §Post-F9.34) se captura AQUÍ.
   * Antes no existía el campo en ningún lado, y el alta de un modelo de desarrollo mandaba a
   * *"captúralo en su catálogo"* — un catálogo que no lo tenía.
   */
  it('captura, edita y QUITA el dígito de concepto, dejándolo en la bitácora', async () => {
    const sesion = sesionAdmin();
    const tipo = await crearTipoProducto(sesion, { nombre: 'Chamarra', digitoConcepto: 8 }, bd());
    expect(tipo.digitoConcepto).toBe(8);

    const editado = await actualizarTipoProducto(sesion, { id: tipo.id, digitoConcepto: 9 }, bd());
    expect(editado.digitoConcepto).toBe(9);

    const sinDigito = await actualizarTipoProducto(
      sesion,
      { id: tipo.id, digitoConcepto: null },
      bd(),
    );
    expect(sinDigito.digitoConcepto).toBeNull();

    // El cambio queda auditado con el ANTES y el DESPUÉS (no basta con que exista el renglón).
    const bitacora = await cliente.bitacora.findMany({
      where: { entidad: 'TipoProducto', idEntidad: String(tipo.id), accion: 'MODIFICAR' },
      orderBy: { id: 'asc' },
    });
    expect((bitacora[0]?.datos as Record<string, unknown>).digitoConcepto).toEqual({ de: 8, a: 9 });
    expect((bitacora[1]?.datos as Record<string, unknown>).digitoConcepto).toEqual({
      de: 9,
      a: null,
    });
  });

  it('rechaza un dígito fuera del 2–9 (el 0 y el 1 no se usan)', async () => {
    const sesion = sesionAdmin();
    for (const digito of [0, 1, 10]) {
      await expect(
        crearTipoProducto(sesion, { nombre: `T-${String(digito)}`, digitoConcepto: digito }, bd()),
      ).rejects.toThrow();
    }
    expect(await cliente.tipoProducto.count()).toBe(0);
  });

  /**
   * Cada concepto es una serie INDEPENDIENTE de 999: dos tipos activos con el mismo dígito se
   * repartirían la misma serie sin saberlo, y el generador propondría para uno un número que el
   * otro ya usó.
   */
  it('no deja repetir el dígito entre tipos ACTIVOS, y dice de quién es', async () => {
    const sesion = sesionAdmin();
    await crearTipoProducto(sesion, { nombre: 'Chamarra', digitoConcepto: 8 }, bd());
    await expect(
      crearTipoProducto(sesion, { nombre: 'Chaleco', digitoConcepto: 8 }, bd()),
    ).rejects.toThrow(/ya es el concepto del tipo de producto "Chamarra"/);

    // Editar otro tipo hacia un dígito tomado tampoco se puede.
    const gorra = await crearTipoProducto(sesion, { nombre: 'Gorra', digitoConcepto: 9 }, bd());
    await expect(
      actualizarTipoProducto(sesion, { id: gorra.id, digitoConcepto: 8 }, bd()),
    ).rejects.toThrow(ErrorConflicto);
    // Y no se quedó a medias.
    const tras = await cliente.tipoProducto.findUniqueOrThrow({ where: { id: gorra.id } });
    expect(tras.digitoConcepto).toBe(9);
  });

  it('un tipo DESACTIVADO libera su dígito, y reactivarlo con el dígito ya tomado se rechaza', async () => {
    const sesion = sesionAdmin();
    const viejo = await crearTipoProducto(sesion, { nombre: 'Chamarra', digitoConcepto: 8 }, bd());
    await desactivarTipoProducto(sesion, viejo.id, bd());

    // Apagado ya no numera nada: el 8 queda libre para el tipo nuevo.
    const nuevo = await crearTipoProducto(sesion, { nombre: 'Chaleco', digitoConcepto: 8 }, bd());
    expect(nuevo.digitoConcepto).toBe(8);

    // Pero encender el viejo partiría la serie 8 en dos, y el mensaje nombra al CULPABLE
    // ("Chaleco"), no al tipo que se intenta encender.
    //
    // ⚠️ Esto ejercita la GUARDA DEL DOMINIO (`exigirDigitoLibre`), NO el `catch` de P2002 — el
    // dominio se adelanta y la base nunca llega a quejarse. El `catch`, que es el que elige el
    // mensaje cuando dos altas simultáneas se cuelan, tiene su propia prueba más abajo
    // («el catch de P2002 culpa al constraint QUE chocó»). Decirlo importa: antes este comentario
    // afirmaba cubrir el caso del `catch` y no lo cubría.
    await expect(reactivarTipoProducto(sesion, viejo.id, bd())).rejects.toThrow(ErrorConflicto);
    await expect(reactivarTipoProducto(sesion, viejo.id, bd())).rejects.toThrow(
      /El dígito 8 ya es el concepto del tipo de producto "Chaleco"/,
    );
    const sigueApagado = await cliente.tipoProducto.findUniqueOrThrow({ where: { id: viejo.id } });
    expect(sigueApagado.activo).toBe(false);
  });

  /**
   * ⭐ EL `catch` DE P2002 CULPA AL CONSTRAINT QUE DE VERDAD CHOCÓ.
   *
   * `tipos_producto` tiene DOS únicos —el `nombre` y el índice parcial del `digito_concepto` entre
   * activos— y el `catch` es quien decide el mensaje cuando la guarda del dominio no alcanza a
   * adelantarse. Culpar siempre al nombre manda a corregir el campo equivocado.
   *
   * Se llega ahí con dos altas SIMULTÁNEAS: las dos leen antes de que la otra commitee, las dos
   * pasan la guarda, y la que pierde choca contra la base. Es la única forma de ejercitar el
   * `catch` — la guarda del dominio tapa cualquier intento secuencial.
   */
  it('el catch de P2002 culpa al constraint QUE chocó: el DÍGITO cuando choca el dígito', async () => {
    const sesion = sesionAdmin();
    const resultados = await Promise.allSettled([
      crearTipoProducto(sesion, { nombre: 'Chamarra', digitoConcepto: 8 }, bd()),
      crearTipoProducto(sesion, { nombre: 'Chaleco', digitoConcepto: 8 }, bd()),
    ]);

    // Una gana y la otra cae: el índice parcial impide que las dos entren.
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const perdedora = resultados.find((r) => r.status === 'rejected');
    expect(perdedora).toBeDefined();
    // `find` con el predicado ya lo estrecha a `PromiseRejectedResult | undefined`: repetirlo con
    // un `as` no cambia el tipo y el lint lo marca. El `toBeDefined()` de arriba es la red.
    const razon = perdedora?.reason as Error;
    expect(razon).toBeInstanceOf(ErrorConflicto);
    // El mensaje habla del DÍGITO. Los nombres son distintos, así que un mensaje de nombre sería
    // una mentira redonda: mandaría a cambiar un nombre que no chocó con nada.
    expect(razon.message).toBe('Ese dígito de concepto ya es de otro tipo de producto activo.');
    expect(razon.message).not.toMatch(/nombre/i);
    // Y la base quedó con UNO solo.
    expect(await cliente.tipoProducto.count()).toBe(1);
  });

  it('…y el NOMBRE cuando choca el nombre (la dirección simétrica)', async () => {
    const sesion = sesionAdmin();
    const resultados = await Promise.allSettled([
      // Mismo nombre, dígitos DISTINTOS: lo único que puede chocar es el nombre.
      crearTipoProducto(sesion, { nombre: 'Chamarra', digitoConcepto: 8 }, bd()),
      crearTipoProducto(sesion, { nombre: 'Chamarra', digitoConcepto: 9 }, bd()),
    ]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const razon = (resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult)
      .reason as Error;
    expect(razon).toBeInstanceOf(ErrorConflicto);
    expect(razon.message).toBe('Ya existe un tipo de producto llamado "Chamarra".');
    expect(razon.message).not.toMatch(/dígito/i);
    expect(await cliente.tipoProducto.count()).toBe(1);
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
