/**
 * ⭐ FILA 0.128 — **UN PAGO QUE NACE `revisado` ES UNA VALIDACIÓN, Y SU GUARDA VIVE EN EL ACTO.**
 *
 * `crearPagoACuentaMaquilero` es el pago «a cuenta» de la corrida semanal (0.113): sin aplicaciones
 * a cargos, y con el `estadoRevision` que le pida el llamador. Cuando ese estado es `revisado`, el
 * importe entra al saldo del maquilero en el acto —desde la 0.115 sólo lo revisado suma—, o sea que
 * la llamada **acuña deuda ya autorizada**. Eso es exactamente lo que Daniel reservó para sí
 * (§Post-F9.192(1): *«la validación sólo la doy yo»*).
 *
 * 🔴 **Por qué estas pruebas existen aunque hoy no haya agujero.** El único llamador es
 * `ejecutarCorrida`, que va bajo `pagos.corrida-armar` (de `SOLO_ADMINISTRADOR`), así que en la
 * versión de hoy nadie fuera del círculo llega aquí. Pero la guarda propia de la función era
 * `esma.ver-pagos`, que en el seed tienen los OCHO perfiles: la única razón por la que no se podía
 * acuñar deuda validada a nombre de cualquiera era **quién resulta llamarla**. Un segundo llamador
 * heredaría el agujero en silencio. Estas pruebas fijan la garantía DENTRO del acto, que es donde
 * se puede cumplir siempre — y son las que caen si alguien borra la línea por «redundante».
 *
 * Unit, sin Postgres: un `tx` falso cuyas lecturas devuelven `null` permite además distinguir
 * «negado por permiso» (ni siquiera consulta) de «pasó el guard» (consulta y falla por no encontrar
 * al proveedor).
 */
import { describe, expect, it, vi } from 'vitest';

import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { crearPagoACuentaMaquilero } from './pagos.js';

const sesion = (permisos: ClavePermiso[]) => sesionDePrueba({ permisos });

/** `tx` falso: el proveedor "no existe" y se cuenta si llegó a preguntarse por él. */
function txQueNoEncuentraNada(): { tx: Tx; lecturas: () => number } {
  const findUnique = vi.fn(() => Promise.resolve(null));
  const tx = {
    proveedor: { findUnique },
    pagoMaquilero: { create: vi.fn() },
  } as unknown as Tx;
  return { tx, lecturas: () => findUnique.mock.calls.length };
}

/** Datos mínimos del pago a cuenta; sólo cambia el `estadoRevision` entre casos. */
const pago = (estadoRevision: 'capturado' | 'revisado') => ({
  idMaquilero: 7,
  monto: 1000,
  fecha: '2026-09-04',
  conFactura: false,
  estadoRevision,
  origenAuditoria: { prueba: true },
});

describe('⭐ crearPagoACuentaMaquilero — nacer `revisado` exige `esma.revisar` (fila 0.128)', () => {
  it('⭐⭐ con SÓLO `esma.ver-pagos` NO puede acuñar un pago ya revisado, y no toca la base', async () => {
    // `esma.ver-pagos` lo tienen los OCHO perfiles del seed: si esta guarda no estuviera, cualquiera
    // que alcanzara esta función metería deuda autorizada al saldo del maquilero.
    const { tx, lecturas } = txQueNoEncuentraNada();

    await expect(
      crearPagoACuentaMaquilero(tx, sesion(['esma.ver-pagos']), pago('revisado')),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(lecturas(), 'el guard tiene que negar ANTES de consultar').toBe(0);
  });

  it('con `esma.ver-pagos` + `esma.revisar` sí pasa el guard (llega a buscar al maquilero)', async () => {
    const { tx, lecturas } = txQueNoEncuentraNada();

    await expect(
      crearPagoACuentaMaquilero(tx, sesion(['esma.ver-pagos', 'esma.revisar']), pago('revisado')),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(lecturas(), 'el acto tiene que llegar a consultar').toBe(1);
  });

  it('⭐ y CAPTURAR no se endureció: un pago `capturado` sigue bastando con `esma.ver-pagos`', async () => {
    // La otra mitad, y la que evita que el arreglo se pase de frenada: capturar nunca fue validar.
    const { tx, lecturas } = txQueNoEncuentraNada();

    await expect(
      crearPagoACuentaMaquilero(tx, sesion(['esma.ver-pagos']), pago('capturado')),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(lecturas(), 'capturar tiene que llegar a consultar').toBe(1);
  });

  it('sin ningún permiso tampoco entra (deny-by-default, A4)', async () => {
    const { tx, lecturas } = txQueNoEncuentraNada();

    await expect(
      crearPagoACuentaMaquilero(tx, sesion([]), pago('capturado')),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(lecturas()).toBe(0);
  });
});
