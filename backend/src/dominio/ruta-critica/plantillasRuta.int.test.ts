/**
 * Tests de integración de las PLANTILLAS DE RUTA (F5-E2). Postgres efímero (testcontainers).
 * Cubre: CRUD + borrado suave, encadenamiento PROPIO de la plantilla (distinto al DAG genérico de
 * E1), RECHAZO DE CICLOS, validaciones (proceso inactivo, antecesor fuera del set, duplicado),
 * permisos (A4) y bitácora (A7).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { ErrorConflicto, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarPlantilla,
  crearPlantilla,
  desactivarPlantilla,
  listarPlantillas,
  obtenerPlantilla,
} from './plantillasRuta.js';

let cliente: PrismaClient;

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

/** Crea procesos del catálogo (F5-E1) y devuelve un mapa codigo→id. */
async function crearProcesos(...codigos: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  for (const codigo of codigos) {
    const p = await cliente.procesoDef.create({ data: { codigo, nombre: codigo.toUpperCase() } });
    mapa.set(codigo, p.id);
  }
  return mapa;
}

describe('Plantillas de ruta (F5-E2)', () => {
  describe('permisos (A4)', () => {
    it('sin permiso no se lee ni se escribe', async () => {
      const sin = sesionDePrueba();
      await expect(crearPlantilla(sin, { nombre: 'X', procesos: [] }, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      await expect(listarPlantillas(sin, false, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['rc.catalogo-ver'] });
      await expect(
        crearPlantilla(soloVer, { nombre: 'X', procesos: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarPlantillas(soloVer, false, bd())).resolves.toEqual([]);
    });
  });

  describe('CRUD + encadenamiento propio', () => {
    it('crea una plantilla con su set de procesos, tiempo y encadenamiento; escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const p = await crearProcesos('a', 'b', 'c');
      const plantilla = await crearPlantilla(
        sesion,
        {
          nombre: 'Ruta básica',
          procesos: [
            { idProcesoDef: p.get('a')!, tiempoEstandar: 1, idsAntecesores: [] },
            { idProcesoDef: p.get('b')!, tiempoEstandar: 3, idsAntecesores: [p.get('a')!] },
            { idProcesoDef: p.get('c')!, tiempoEstandar: 2, idsAntecesores: [p.get('b')!] },
          ],
        },
        bd(),
      );
      expect(plantilla.nombre).toBe('Ruta básica');
      expect(plantilla.activo).toBe(true);
      expect(plantilla.procesos).toHaveLength(3);
      // El orden se asigna por posición.
      expect(plantilla.procesos.map((r) => r.codigoProceso)).toEqual(['a', 'b', 'c']);
      const c = plantilla.procesos.find((r) => r.codigoProceso === 'c')!;
      expect(c.tiempoEstandar).toBe(2);
      expect(c.idsAntecesores).toEqual([p.get('b')!]);

      const bit = await cliente.bitacora.findFirst({
        where: { entidad: 'PlantillaRuta', accion: 'CREAR' },
      });
      expect(bit).not.toBeNull();
    });

    it('el encadenamiento de la plantilla puede DIFERIR del DAG genérico de E1', async () => {
      // DAG genérico de E1: a → b → c (proceso_dep). En la PLANTILLA encadenamos a → c directo
      // (c depende de a, NO de b) — debe permitirse y guardarse tal cual.
      const sesion = sesionAdmin();
      const p = await crearProcesos('a', 'b', 'c');
      // DAG genérico distinto (a antes de b, b antes de c).
      await cliente.procesoDep.createMany({
        data: [
          { idProceso: p.get('b')!, idAntecesor: p.get('a')! },
          { idProceso: p.get('c')!, idAntecesor: p.get('b')! },
        ],
      });

      const plantilla = await crearPlantilla(
        sesion,
        {
          nombre: 'Ruta con atajo',
          procesos: [
            { idProcesoDef: p.get('a')!, tiempoEstandar: 1, idsAntecesores: [] },
            { idProcesoDef: p.get('b')!, tiempoEstandar: 1, idsAntecesores: [p.get('a')!] },
            // c depende de a directamente (atajo distinto al DAG genérico b→c).
            { idProcesoDef: p.get('c')!, tiempoEstandar: 1, idsAntecesores: [p.get('a')!] },
          ],
        },
        bd(),
      );
      const c = plantilla.procesos.find((r) => r.codigoProceso === 'c')!;
      expect(c.idsAntecesores).toEqual([p.get('a')!]);
    });

    it('reemplaza el set completo de procesos al editar', async () => {
      const sesion = sesionAdmin();
      const p = await crearProcesos('a', 'b', 'c');
      const plantilla = await crearPlantilla(
        sesion,
        {
          nombre: 'Ruta',
          procesos: [{ idProcesoDef: p.get('a')!, tiempoEstandar: 1, idsAntecesores: [] }],
        },
        bd(),
      );
      const editada = await actualizarPlantilla(
        sesion,
        plantilla.id,
        {
          procesos: [
            { idProcesoDef: p.get('b')!, tiempoEstandar: 2, idsAntecesores: [] },
            { idProcesoDef: p.get('c')!, tiempoEstandar: 4, idsAntecesores: [p.get('b')!] },
          ],
        },
        bd(),
      );
      expect(editada.procesos.map((r) => r.codigoProceso)).toEqual(['b', 'c']);
    });

    it('desactiva (borrado suave) y deja de listarse salvo que se pidan inactivos', async () => {
      const sesion = sesionAdmin();
      const p = await crearProcesos('a');
      const plantilla = await crearPlantilla(
        sesion,
        {
          nombre: 'Ruta',
          procesos: [{ idProcesoDef: p.get('a')!, tiempoEstandar: 1, idsAntecesores: [] }],
        },
        bd(),
      );
      await desactivarPlantilla(sesion, plantilla.id, bd());
      expect(await listarPlantillas(sesion, false, bd())).toHaveLength(0);
      expect(await listarPlantillas(sesion, true, bd())).toHaveLength(1);
      await expect(desactivarPlantilla(sesion, plantilla.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
      // Se sigue obteniendo por id.
      const obtenida = await obtenerPlantilla(sesion, plantilla.id, bd());
      expect(obtenida.activo).toBe(false);
    });
  });

  describe('validaciones', () => {
    it('rechaza un proceso repetido en la misma plantilla', async () => {
      const sesion = sesionAdmin();
      const p = await crearProcesos('a');
      await expect(
        crearPlantilla(
          sesion,
          {
            nombre: 'Dup',
            procesos: [
              { idProcesoDef: p.get('a')!, tiempoEstandar: 1, idsAntecesores: [] },
              { idProcesoDef: p.get('a')!, tiempoEstandar: 2, idsAntecesores: [] },
            ],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza un proceso inexistente o inactivo', async () => {
      const sesion = sesionAdmin();
      const p = await crearProcesos('a');
      await cliente.procesoDef.update({ where: { id: p.get('a')! }, data: { activo: false } });
      await expect(
        crearPlantilla(
          sesion,
          {
            nombre: 'Inactivo',
            procesos: [{ idProcesoDef: p.get('a')!, tiempoEstandar: 1, idsAntecesores: [] }],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      await expect(
        crearPlantilla(
          sesion,
          {
            nombre: 'Inexistente',
            procesos: [{ idProcesoDef: 999999, tiempoEstandar: 1, idsAntecesores: [] }],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza un antecesor que no pertenece a la plantilla', async () => {
      const sesion = sesionAdmin();
      const p = await crearProcesos('a', 'b');
      await expect(
        crearPlantilla(
          sesion,
          {
            nombre: 'Fuera',
            // Solo 'a' está en la plantilla, pero pide a 'b' como antecesor.
            procesos: [
              { idProcesoDef: p.get('a')!, tiempoEstandar: 1, idsAntecesores: [p.get('b')!] },
            ],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('RECHAZA un ciclo en el encadenamiento de la plantilla', async () => {
      const sesion = sesionAdmin();
      const p = await crearProcesos('a', 'b', 'c');
      await expect(
        crearPlantilla(
          sesion,
          {
            nombre: 'Ciclo',
            procesos: [
              { idProcesoDef: p.get('a')!, tiempoEstandar: 1, idsAntecesores: [p.get('c')!] },
              { idProcesoDef: p.get('b')!, tiempoEstandar: 1, idsAntecesores: [p.get('a')!] },
              { idProcesoDef: p.get('c')!, tiempoEstandar: 1, idsAntecesores: [p.get('b')!] },
            ],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza un proceso que es su propio antecesor', async () => {
      const sesion = sesionAdmin();
      const p = await crearProcesos('a');
      await expect(
        crearPlantilla(
          sesion,
          {
            nombre: 'Auto',
            procesos: [
              { idProcesoDef: p.get('a')!, tiempoEstandar: 1, idsAntecesores: [p.get('a')!] },
            ],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });
});
