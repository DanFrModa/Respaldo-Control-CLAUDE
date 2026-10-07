/**
 * ⭐ QUIÉN VE LOS PRECIOS DE COMPRA (fila 0.249 parte D): las llaves EXACTAS de cada regla, y casos en
 * las dos direcciones (abre / no abre).
 */
import { describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  LLAVES_PRECIO_COMPRA,
  LLAVES_PRECIO_RECEPCION,
  puedeVerPreciosDeCompra,
  puedeVerPreciosDeRecepcion,
} from './precios-de-compra.js';

const sesion = (permisos: ClavePermiso[]) => sesionDePrueba({ permisos });

describe('precios de compra', () => {
  it('las llaves son EXACTAMENTE las decididas', () => {
    expect([...LLAVES_PRECIO_COMPRA].sort()).toEqual(['compras.administrar', 'compras.ver']);
    expect([...LLAVES_PRECIO_RECEPCION].sort()).toEqual([
      'compras.administrar',
      'compras.recibir',
      'compras.ver',
    ]);
  });

  it.each(['compras.ver', 'compras.administrar'] as const)(
    'con sólo %s se ven la compra y la recepción',
    (llave) => {
      expect(puedeVerPreciosDeCompra(sesion([llave]))).toBe(true);
      expect(puedeVerPreciosDeRecepcion(sesion([llave]))).toBe(true);
    },
  );

  it('con sólo compras.recibir: la RECEPCIÓN se ve (quien recibe corrige el precio) y la compra NO', () => {
    expect(puedeVerPreciosDeRecepcion(sesion(['compras.recibir']))).toBe(true);
    expect(puedeVerPreciosDeCompra(sesion(['compras.recibir']))).toBe(false);
  });

  it.each(['ordenes.ver', 'consultas.ver-importes', 'telas.administrar'] as const)(
    'con sólo %s no se ve nada',
    (llave) => {
      expect(puedeVerPreciosDeCompra(sesion([llave]))).toBe(false);
      expect(puedeVerPreciosDeRecepcion(sesion([llave]))).toBe(false);
    },
  );

  it('sin llaves, nada', () => {
    expect(puedeVerPreciosDeCompra(sesion([]))).toBe(false);
    expect(puedeVerPreciosDeRecepcion(sesion([]))).toBe(false);
  });
});
