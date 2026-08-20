import { describe, expect, it } from 'vitest';

import { ErrorPermiso } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { ErrorValidacion } from '../../comun/errores.js';
import {
  calcularEstatusMaterial,
  estadoGenerico,
  estatusMaterialesOrden,
  explosionarOrden,
  generarOCDesdeExplosion,
  resolverFechasDeOc,
} from './mrp.js';

/**
 * Unit del dominio del MRP / EXPLOSIÓN (F4-E4) — SIN Postgres. Cubre lo que NO necesita la base:
 *  • el guard de permisos (deny-by-default, A4): explosionar/estatus exigen `compras.ver`,
 *    generar OC exige `compras.administrar`;
 *  • las funciones PURAS del semáforo (R7) y del estado de genéricos (decisión d).
 *
 * El cálculo real de la explosión (BOM × matriz), el neteo contra el kardex, la persistencia del
 * snapshot/diff, la generación de OC por proveedor y el cruce requerido/en-oc/recibido contra
 * Postgres van en `mrp.int.test.ts` (CI).
 */

const sesionVer = () => sesionDePrueba({ permisos: ['compras.ver'] });
const sesionSinNada = () => sesionDePrueba({ permisos: [] });
const sesionAdmin = () => sesionDePrueba({ permisos: ['compras.administrar'] });

describe('MRP unit — permisos (A4, deny-by-default)', () => {
  it('explosionarOrden sin compras.ver lanza ErrorPermiso (antes de la BD)', async () => {
    await expect(explosionarOrden(sesionSinNada(), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('estatusMaterialesOrden sin compras.ver lanza ErrorPermiso', async () => {
    await expect(estatusMaterialesOrden(sesionSinNada(), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('generarOCDesdeExplosion sin compras.administrar lanza ErrorPermiso', async () => {
    // `compras.ver` no alcanza para mutar (generar OC).
    await expect(
      generarOCDesdeExplosion(sesionVer(), { idsOrden: [1], idsRequerimiento: [] }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('generarOCDesdeExplosion con compras.administrar pasa el guard (falla luego por BD/orden)', async () => {
    // No debe ser ErrorPermiso: el guard pasó; cualquier otro error viene de la BD inexistente.
    await expect(
      generarOCDesdeExplosion(sesionAdmin(), { idsOrden: [999999], idsRequerimiento: [] }),
    ).rejects.not.toBeInstanceOf(ErrorPermiso);
  });
});

describe('MRP unit — semáforo de estatus de material (R7, función pura)', () => {
  it('sin OC ni recibido → pendiente', () => {
    expect(calcularEstatusMaterial(100, 0, 0, false)).toBe('pendiente');
  });

  it('en OC pero nada recibido → en-oc', () => {
    expect(calcularEstatusMaterial(100, 100, 0, false)).toBe('en-oc');
  });

  it('algo recibido pero no todo → recibido-parcial', () => {
    expect(calcularEstatusMaterial(100, 100, 40, false)).toBe('recibido-parcial');
  });

  it('recibido ≥ a comprar → completo', () => {
    expect(calcularEstatusMaterial(100, 100, 100, false)).toBe('completo');
    expect(calcularEstatusMaterial(100, 100, 120, false)).toBe('completo');
  });

  it('genérico cubierto por stock (a comprar 0) → cubierto-por-stock, gana a todo lo demás', () => {
    expect(calcularEstatusMaterial(0, 0, 0, true)).toBe('cubierto-por-stock');
  });

  it('a comprar 0 sin ser genérico cubierto → no es "completo" (evita falso completo)', () => {
    // aComprar = 0 y no es genérico cubierto: no hay nada que comprar ni recibir → pendiente.
    expect(calcularEstatusMaterial(0, 0, 0, false)).toBe('pendiente');
  });

  it('respeta la tolerancia de redondeo en "completo"', () => {
    expect(calcularEstatusMaterial(100, 100, 100 - 1e-9, false)).toBe('completo');
  });

  it('§Post-F9.19: aplica la banda del 5% en tela Y en avío', () => {
    // Sin la banda, el tablero diría "recibido parcial" para siempre, aunque la OC ya se haya dado
    // por recibida: *"nunca se recibe la cantidad exacta"* y *"en avíos también puede haber una
    // diferencia"*.
    expect(calcularEstatusMaterial(400, 400, 380, false, 'tela')).toBe('completo');
    expect(calcularEstatusMaterial(400, 400, 379, false, 'tela')).toBe('recibido-parcial');
    expect(calcularEstatusMaterial(180, 180, 171, false, 'avio')).toBe('completo');
    expect(calcularEstatusMaterial(180, 180, 170, false, 'avio')).toBe('recibido-parcial');
  });
});

describe('MRP unit — estado de genérico tras netear (decisión d, función pura)', () => {
  const base = {
    tipo: 'avio' as const,
    idTela: null,
    idAvio: 1,
    material: 'BOT-01',
    cantidadRequerida: 100,
    unidad: 'pza',
    existenciaStock: 0,
    idProveedorSugerido: null,
    proveedorSugerido: null,
    precioSugerido: null,
    origenProveedor: 'sin-proveedor' as const,
    proveedorSugeridoInactivo: false,
  };

  it('no genérico → no-aplica (va completo a compra)', () => {
    expect(estadoGenerico({ ...base, esGenerico: false, cantidadAComprar: 100 })).toBe('no-aplica');
  });

  it('genérico con stock que cubre todo (a comprar 0) → cubierto-por-stock', () => {
    expect(
      estadoGenerico({ ...base, esGenerico: true, existenciaStock: 120, cantidadAComprar: 0 }),
    ).toBe('cubierto-por-stock');
  });

  it('genérico con stock parcial (faltante > 0) → faltante-parcial', () => {
    expect(
      estadoGenerico({ ...base, esGenerico: true, existenciaStock: 30, cantidadAComprar: 70 }),
    ).toBe('faltante-parcial');
  });
});

/**
 * ⭐ §Post-F9.71 (V1-E3i) — LA FECHA DE CADA OC. Daniel: *"cada OC interna va a tener una fecha de
 * entrega diferente"*. La regla es pura (no toca BD) para poder probarla aquí; el efecto real sobre
 * las OC creadas va en `mrp.int.test.ts`.
 */
describe('MRP unit — fecha de entrega POR PROVEEDOR (§Post-F9.71)', () => {
  it('cada proveedor recibe la SUYA cuando la manda la pantalla', () => {
    const { fechas, sinFecha } = resolverFechasDeOc([1, 2], '2026-11-30', [
      { idProveedor: 1, fechaEntrega: '2026-10-05' },
      { idProveedor: 2, fechaEntrega: '2026-12-20' },
    ]);
    expect(fechas.get(1)).toBe('2026-10-05');
    expect(fechas.get(2)).toBe('2026-12-20');
    expect(sinFecha).toEqual([]);
  });

  it('el que no trae la suya cae a la de arriba (valor inicial, no imposición)', () => {
    const { fechas } = resolverFechasDeOc([1, 2], '2026-11-30', [
      { idProveedor: 1, fechaEntrega: '2026-10-05' },
    ]);
    expect(fechas.get(1)).toBe('2026-10-05');
    expect(fechas.get(2)).toBe('2026-11-30');
  });

  it('sin fecha de arriba, basta con que cada uno traiga la suya', () => {
    const { fechas, sinFecha } = resolverFechasDeOc([1, 2], null, [
      { idProveedor: 1, fechaEntrega: '2026-10-05' },
      { idProveedor: 2, fechaEntrega: '2026-12-20' },
    ]);
    expect(sinFecha).toEqual([]);
    expect(fechas.size).toBe(2);
  });

  it('el que se queda sin ninguna sale nombrado en `sinFecha` (para decirlo con su nombre)', () => {
    const { fechas, sinFecha } = resolverFechasDeOc([1, 2], null, [
      { idProveedor: 1, fechaEntrega: '2026-10-05' },
    ]);
    expect(sinFecha).toEqual([2]);
    expect(fechas.has(2)).toBe(false);
  });

  it('la fecha de un proveedor que NO está comprando se ignora (no revienta una compra parcial)', () => {
    const { fechas, sinFecha } = resolverFechasDeOc([1], '2026-11-30', [
      { idProveedor: 99, fechaEntrega: '2026-10-05' },
    ]);
    expect(fechas.get(1)).toBe('2026-11-30');
    expect(fechas.has(99)).toBe(false);
    expect(sinFecha).toEqual([]);
  });

  it('dos fechas DISTINTAS para el mismo proveedor se rechazan (D3, no se elige en silencio)', () => {
    expect(() =>
      resolverFechasDeOc([1], '2026-11-30', [
        { idProveedor: 1, fechaEntrega: '2026-10-05' },
        { idProveedor: 1, fechaEntrega: '2026-10-06' },
      ]),
    ).toThrow(ErrorValidacion);
  });

  it('la MISMA fecha repetida no estorba (no es una contradicción)', () => {
    const { fechas } = resolverFechasDeOc([1], null, [
      { idProveedor: 1, fechaEntrega: '2026-10-05' },
      { idProveedor: 1, fechaEntrega: '2026-10-05' },
    ]);
    expect(fechas.get(1)).toBe('2026-10-05');
  });

  it('sin fechas por proveedor, todos caen a la de arriba (comportamiento previo intacto)', () => {
    const { fechas, sinFecha } = resolverFechasDeOc([1, 2], '2026-11-30', undefined);
    expect([...fechas.values()]).toEqual(['2026-11-30', '2026-11-30']);
    expect(sinFecha).toEqual([]);
  });
});
