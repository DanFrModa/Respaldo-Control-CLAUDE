/**
 * ⭐ FILA 0.128 — **DOS PERMISOS, NO UNO: capturar una partida y AUTORIZARLA son actos distintos.**
 *
 * Daniel, 4-sep-2026 (§Post-F9.192(1)), textual:
 *
 * > *«La entrada la da la persona responsable de recibos o de producción. Pero **la validación
 * > sólo la doy yo**. O sea, es **un permiso para meter lo recibido y otro para validarlo**.»*
 *
 * 🔴 **El defecto que esto cierra.** Hasta la 0.127, {@link revisarMovimiento} exigía
 * `esma.modificar` — el MISMO permiso con el que se capturan los abonos y los descuentos. O sea:
 * quien capturaba se auto-autorizaba, y el "punto de control del admin" no controlaba nada. Y no
 * era formal: desde la 0.115 **sólo lo revisado suma al saldo**, así que autorizar es exactamente
 * el acto de convertir un renglón capturado en deuda —o en pago— real.
 *
 * Estas pruebas son SIN Postgres (unit, sin Docker): fijan el guard (A4, deny-by-default) en las
 * cuatro direcciones que importan, y lo hacen con un `tx` falso para poder afirmar además **que el
 * permiso se niega ANTES de tocar la base**. La mecánica de la revisión (transición condicional,
 * conflicto 409, descuentos cancelados) se prueba contra Postgres en `esma-movimientos.int.test.ts`
 * y en las rutas en `api/esma.int.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { crearAbonoMaquilero, crearDescuentoMaquilero, revisarMovimiento } from './movimientos.js';

const sesion = (permisos: ClavePermiso[]) => sesionDePrueba({ permisos });

/**
 * `tx` falso cuyas lecturas devuelven SIEMPRE `null` (la partida / el proveedor "no existe"), y que
 * cuenta cuántas veces se le preguntó. Sirve para dos cosas a la vez: comprobar que el acto pasó el
 * guard —porque llega a preguntar y falla con `ErrorNoEncontrado`, no con `ErrorPermiso`— y que
 * cuando el guard niega, la base **no se toca**.
 */
function txQueNoEncuentraNada(): { tx: Tx; lecturas: () => number } {
  const findFirst = vi.fn(() => Promise.resolve(null));
  const findUnique = vi.fn(() => Promise.resolve(null));
  const tabla = { findFirst, findUnique, updateMany: vi.fn(), create: vi.fn() };
  const tx = {
    abonoMaquilero: tabla,
    descuentoMaquilero: tabla,
    pagoMaquilero: tabla,
    proveedor: tabla,
  } as unknown as Tx;
  return { tx, lecturas: () => findFirst.mock.calls.length + findUnique.mock.calls.length };
}

describe('⭐ revisarMovimiento — autorizar es `esma.revisar`, no `esma.modificar` (fila 0.128)', () => {
  it('sin ningún permiso → ErrorPermiso, y sin tocar la base', async () => {
    const { tx, lecturas } = txQueNoEncuentraNada();

    await expect(revisarMovimiento(sesion([]), 'abono', 1, { tx })).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
    expect(lecturas(), 'el guard tiene que negar ANTES de consultar').toBe(0);
  });

  it('⭐⭐ con SÓLO `esma.modificar` → ErrorPermiso (el permiso de CAPTURAR ya no autoriza)', async () => {
    // Ésta es la regresión de la fila: antes esto pasaba, y con ello quien captura un abono podía
    // meterlo al saldo él solo. Se prueban los tres conceptos porque revisar aplica a los tres.
    for (const concepto of ['abono', 'descuento', 'pago'] as const) {
      const { tx, lecturas } = txQueNoEncuentraNada();
      await expect(
        revisarMovimiento(sesion(['esma.modificar', 'esma.ver-pagos']), concepto, 1, { tx }),
        concepto,
      ).rejects.toBeInstanceOf(ErrorPermiso);
      expect(lecturas(), `${concepto}: negado antes de consultar`).toBe(0);
    }
  });

  it('con `esma.revisar` SÍ pasa el guard (llega a la base y falla por no encontrar la partida)', async () => {
    for (const concepto of ['abono', 'descuento', 'pago'] as const) {
      const { tx, lecturas } = txQueNoEncuentraNada();
      await expect(
        revisarMovimiento(sesion(['esma.revisar']), concepto, 99, { tx }),
        concepto,
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
      expect(lecturas(), `${concepto}: el acto tiene que llegar a consultar`).toBe(1);
    }
  });
});

describe('⭐ capturar sigue siendo `esma.modificar` — los dos permisos no se sustituyen', () => {
  const partida = { idMaquilero: 7, monto: 100, fecha: '2026-09-04' };

  it('⭐ `esma.revisar` NO alcanza para capturar un abono ni un descuento', async () => {
    // La otra mitad de la separación, y la que se olvida: si el permiso de validar sirviera además
    // para capturar, el círculo del dueño se llevaría el trabajo de quien recibe — y la frase de
    // Daniel («la entrada la da la persona responsable de recibos») dejaría de cumplirse.
    for (const crear of [crearAbonoMaquilero, crearDescuentoMaquilero]) {
      const { tx, lecturas } = txQueNoEncuentraNada();
      await expect(
        crear(sesion(['esma.revisar', 'esma.ver-pagos']), partida, { tx }),
        crear.name,
      ).rejects.toBeInstanceOf(ErrorPermiso);
      expect(lecturas(), `${crear.name}: negado antes de consultar`).toBe(0);
    }
  });

  it('con `esma.modificar` la captura pasa el guard (falla ya por el maquilero inexistente)', async () => {
    for (const crear of [crearAbonoMaquilero, crearDescuentoMaquilero]) {
      const { tx, lecturas } = txQueNoEncuentraNada();
      await expect(
        crear(sesion(['esma.modificar']), partida, { tx }),
        crear.name,
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
      expect(lecturas(), `${crear.name}: el acto tiene que llegar a consultar`).toBe(1);
    }
  });
});
