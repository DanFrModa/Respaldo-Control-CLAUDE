import { describe, expect, it } from 'vitest';

import { ErrorConflicto, ErrorValidacion } from '../../src/comun/errores.js';

import { Reporte } from './reporte.js';
import {
  crearConNombreUnico,
  intentarCrear,
  LIMITES,
  truncarTexto,
  truncarYReportar,
} from './saneo.js';

describe('migración · saneo (robustez de data legacy)', () => {
  describe('truncarTexto (puro)', () => {
    it('recorta al máximo y deja intacto lo que cabe', () => {
      expect(truncarTexto('abcdef', 3)).toBe('abc');
      expect(truncarTexto('abc', 3)).toBe('abc');
      expect(truncarTexto('ab', 3)).toBe('ab');
    });
    it('propaga null', () => {
      expect(truncarTexto(null, 5)).toBeNull();
    });
  });

  describe('truncarYReportar', () => {
    it('recorta y REPORTA cuando excede el máximo (con longitudes en el detalle)', () => {
      const reporte = new Reporte();
      const largo = 'x'.repeat(137);
      const resultado = truncarYReportar(reporte, 'Proveedor', 42, 'telefono', largo, 100);
      expect(resultado).toHaveLength(100);
      expect(reporte.tieneIncidencias).toBe(true);
      const secciones = reporte.obtenerSecciones();
      expect(secciones[0]?.titulo).toContain('truncado');
      expect(secciones[0]?.renglones[0]).toContain('telefono');
      expect(secciones[0]?.renglones[0]).toContain('clave=42');
      expect(secciones[0]?.renglones[0]).toContain('137');
      expect(secciones[0]?.renglones[0]).toContain('100');
    });
    it('NO reporta ni recorta cuando el texto cabe', () => {
      const reporte = new Reporte();
      expect(truncarYReportar(reporte, 'Cliente', 1, 'nombre', 'Liverpool', 200)).toBe('Liverpool');
      expect(reporte.tieneIncidencias).toBe(false);
    });
    it('propaga null sin reportar', () => {
      const reporte = new Reporte();
      expect(truncarYReportar(reporte, 'Cliente', 1, 'contacto', null, 150)).toBeNull();
      expect(reporte.tieneIncidencias).toBe(false);
    });
  });

  describe('intentarCrear (skip-on-error por fila)', () => {
    it('devuelve el resultado cuando la acción tiene éxito', async () => {
      const reporte = new Reporte();
      const r = await intentarCrear(reporte, 'Cliente', 1, () => Promise.resolve({ id: 7 }));
      expect(r).toEqual({ id: 7 });
      expect(reporte.tieneIncidencias).toBe(false);
    });

    it('ante ErrorValidacion: NO relanza, reporta con código+mensaje y devuelve null', async () => {
      const reporte = new Reporte();
      const r = await intentarCrear(reporte, 'Proveedor', 99, () =>
        Promise.reject(new ErrorValidacion('El teléfono no puede tener más de 100 caracteres')),
      );
      expect(r).toBeNull();
      const secciones = reporte.obtenerSecciones();
      expect(secciones[0]?.titulo).toContain('OMITIDA');
      expect(secciones[0]?.renglones[0]).toContain('clave=99');
      expect(secciones[0]?.renglones[0]).toContain('VALIDACION');
      expect(secciones[0]?.renglones[0]).toContain('100 caracteres');
    });

    it('ante un Error genérico (no de dominio): tampoco relanza, devuelve null y reporta', async () => {
      const reporte = new Reporte();
      const r = await intentarCrear(reporte, 'Tela', 5, () =>
        Promise.reject(new Error('algo raro')),
      );
      expect(r).toBeNull();
      expect(reporte.obtenerSecciones()[0]?.renglones[0]).toContain('algo raro');
    });

    it('una fila mala NO impide procesar las siguientes (continúa el loop)', async () => {
      const reporte = new Reporte();
      const entradas = [1, 2, 3];
      const creados: number[] = [];
      for (const n of entradas) {
        const r = await intentarCrear(reporte, 'Avio', n, () => {
          if (n === 2) {
            return Promise.reject(new ErrorValidacion('fila 2 sucia'));
          }
          return Promise.resolve(n);
        });
        if (r !== null) {
          creados.push(r);
        }
      }
      expect(creados).toEqual([1, 3]); // la 2 se omitió, las otras siguieron
      expect(reporte.totalIncidencias).toBe(1);
    });
  });

  describe('LIMITES', () => {
    it('refleja los topes Zod de los esquemas (puntos clave)', () => {
      expect(LIMITES.proveedor.telefono).toBe(100);
      expect(LIMITES.proveedor.notas).toBe(2000);
      expect(LIMITES.cliente.nombre).toBe(200);
      expect(LIMITES.color.nombre).toBe(80);
      expect(LIMITES.avio.clave).toBe(50);
      expect(LIMITES.tela.descripcion).toBe(500);
      expect(LIMITES.bordado.nombre).toBe(150);
    });
  });

  describe('crearConNombreUnico (desambiguación tolerante a carreras)', () => {
    it('crea con el nombre base si está libre', async () => {
      const r = await crearConNombreUnico(
        'Felpa',
        (base) => Promise.resolve(base), // siempre libre
        (nombre) => Promise.resolve({ id: nombre === 'Felpa' ? 1 : 99 }),
      );
      expect(r).toEqual({ id: 1, nombre: 'Felpa' });
    });

    it('ante ErrorConflicto (carrera): RECOMPUTA un nombre libre y reintenta', async () => {
      // Simula que "Felpa" lo tomó otra tarea: el 1er create choca; el `nombreLibre` ya
      // devuelve "Felpa (2)" y el 2º create gana.
      let intentos = 0;
      const r = await crearConNombreUnico(
        'Felpa',
        (base) => Promise.resolve(intentos === 0 ? base : `${base} (2)`),
        (nombre) => {
          intentos += 1;
          if (nombre === 'Felpa') {
            return Promise.reject(new ErrorConflicto('ya existe'));
          }
          return Promise.resolve({ id: 7 });
        },
      );
      expect(r).toEqual({ id: 7, nombre: 'Felpa (2)' });
      expect(intentos).toBe(2);
    });

    it('relanza un error que NO es de conflicto (lo maneja el llamador)', async () => {
      await expect(
        crearConNombreUnico(
          'X',
          (base) => Promise.resolve(base),
          () => Promise.reject(new ErrorValidacion('nombre inválido')),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('si se agotan los intentos por conflicto persistente, relanza el conflicto', async () => {
      await expect(
        crearConNombreUnico(
          'X',
          (base) => Promise.resolve(base),
          () => Promise.reject(new ErrorConflicto('siempre choca')),
          3,
        ),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });
});
