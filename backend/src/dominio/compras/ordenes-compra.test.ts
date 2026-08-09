import { describe, expect, it } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { cancelarOC, crearOC, listarOC } from './ordenes-compra.js';

/**
 * Unit del dominio de Órdenes de COMPRA (F4-E2) — SIN Postgres. Cubre lo que NO necesita la base: el
 * guard de permisos (deny-by-default, A4) y la validación de captura por Zod que falla ANTES de
 * tocar la base (cancelar sin motivo, precio/cantidad inválidos). La integridad transaccional real
 * (folio por empresa, XOR, matriz suma=cantidad, autorización, duplicado, total derivado) se prueba
 * contra Postgres en `ordenes-compra.int.test.ts` (CI).
 */

const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['compras.ver', 'compras.administrar', 'compras.cancelar'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['compras.ver'] });

/**
 * Encabezado mínimo que TODA OC nueva exige desde §Post-F9.18: fecha de entrega obligatoria y
 * dirección de entrega del catálogo. Aquí los ids son ficticios: estas pruebas fallan por permiso o
 * por Zod ANTES de tocar la base, así que nunca se resuelven contra el catálogo real.
 */
const encabezadoOc = { fechaEntrega: '2026-09-30', idDireccionEntrega: 1 } as const;

describe('OC unit — permisos (A4, deny-by-default)', () => {
  it('crearOC sin compras.administrar lanza ErrorPermiso (antes de la BD)', async () => {
    await expect(
      crearOC(sesionSoloVer(), { ...encabezadoOc, idProveedor: 1, lineas: [] }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('listarOC sin compras.ver lanza ErrorPermiso', async () => {
    await expect(listarOC(sesionDePrueba({ permisos: [] }))).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('cancelarOC sin compras.cancelar lanza ErrorPermiso', async () => {
    await expect(cancelarOC(sesionSoloVer(), 1, { motivo: 'x' })).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});

describe('OC unit — validación de captura (Zod, antes de la BD)', () => {
  it('cancelarOC sin motivo lanza ErrorValidacion', async () => {
    await expect(
      // @ts-expect-error: motivo es obligatorio; probamos la validación en runtime
      cancelarOC(sesionDePrueba({ permisos: ['compras.cancelar'] }), 1, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crearOC con precio negativo lanza ErrorValidacion', async () => {
    await expect(
      crearOC(sesionAdmin(), {
        ...encabezadoOc,
        idProveedor: 1,
        lineas: [{ idTela: 1, cantidad: 1, precio: -5 }],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crearOC con cantidad cero lanza ErrorValidacion', async () => {
    await expect(
      crearOC(sesionAdmin(), {
        ...encabezadoOc,
        idProveedor: 1,
        lineas: [{ idTela: 1, cantidad: 0, precio: 5 }],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
