import { describe, expect, it } from 'vitest';

import { ErrorConflicto } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import { TipoEventoProceso } from '../../datos/index.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { registrarHito, tipoEventoDeHito } from './hitosOrden.js';

/**
 * Unit del mapeo PURO hito → `TipoEventoProceso` (cierre del hueco de emisores, post-F9). Es la pieza
 * que decide qué proceso RC auto-completa cada hito; el consumidor del auto-avance depende de él.
 */
describe('tipoEventoDeHito', () => {
  it('mapea cada tipo de hito a su TipoEventoProceso', () => {
    expect(tipoEventoDeHito('revisionOp')).toBe(TipoEventoProceso.revisionOp);
    expect(tipoEventoDeHito('fit')).toBe(TipoEventoProceso.autorizacionFit);
    expect(tipoEventoDeHito('tonoTela')).toBe(TipoEventoProceso.autorizacionTono);
    expect(tipoEventoDeHito('avios')).toBe(TipoEventoProceso.autorizacionAvios);
    expect(tipoEventoDeHito('empaque')).toBe(TipoEventoProceso.empaque);
    // arte cierra el proceso `autorizacion-arte`, que ya era auto pero nadie emitía su evento.
    expect(tipoEventoDeHito('arte')).toBe(TipoEventoProceso.autorizacionArte);
  });
});

/**
 * Backstop de la CARRERA concurrente (post-F9): dos registros del mismo hito vivo a la vez pasan el
 * check secuencial (ambos ven "no hay hito") y el segundo choca contra el índice parcial
 * `hito_orden_vivo_unico` (P2002). `registrarHito` traduce ESE P2002 a `ErrorConflicto` (409, no 500);
 * un P2002 de OTRO constraint NO se traga. Se simula con una `tx` de mentira que lanza en el `create`.
 */
describe('registrarHito: traducción del P2002 del índice parcial', () => {
  /** Construye un error con forma de P2002 de Prisma (Error real + `code`/`meta.target`). */
  function p2002(target: string): Error {
    return Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target },
    });
  }

  /** `tx` mínima: la orden existe, no hay hito vivo, y el `create` rechaza con `errorCreate`. */
  function txQueLanzaEnCreate(errorCreate: Error): Tx {
    return {
      orden: { findFirst: () => Promise.resolve({ id: 1 }) },
      hitoOrden: {
        findFirst: () => Promise.resolve(null),
        create: () => Promise.reject(errorCreate),
      },
    } as unknown as Tx;
  }

  const sesion = () => sesionDePrueba({ permisos: ['rc.capturar'] });

  it('el P2002 del índice hito_orden_vivo_unico se traduce a ErrorConflicto', async () => {
    await expect(
      registrarHito(
        sesion(),
        1,
        { tipo: 'fit' },
        { tx: txQueLanzaEnCreate(p2002('hito_orden_vivo_unico')) },
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('un P2002 de OTRO constraint NO se traga: se re-lanza tal cual (catch específico)', async () => {
    const otro = p2002('otro_indice_cualquiera');
    await expect(
      registrarHito(sesion(), 1, { tipo: 'fit' }, { tx: txQueLanzaEnCreate(otro) }),
    ).rejects.toBe(otro);
  });
});
