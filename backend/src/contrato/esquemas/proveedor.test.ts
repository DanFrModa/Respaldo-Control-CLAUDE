/**
 * Contrato del proveedor — la MODALIDAD DE FACTURACIÓN es obligatoria (fila 0.110).
 *
 * Daniel (3-sep-2026, §Post-F9.186(a)): *"es un campo **obligatorio** de llenar. **A fuerzas hay que
 * definir si es con, sin o ambas**"*. Decide de dónde sale el pago del proveedor (§Post-F9.184(f)),
 * así que se pregunta al darlo de alta y no se puede vaciar después.
 */
import { describe, expect, it } from 'vitest';

import {
  esquemaProveedorCrear,
  esquemaProveedorCrearMigrado,
  esquemaProveedorEditar,
} from './proveedor.js';

/** Alta mínima válida salvo por la modalidad, que cada prueba pone (o no). */
const ALTA_BASE = { nombre: 'Maquilas del Norte', roles: [1] } as const;

describe('esquemaProveedorCrear — la modalidad de facturación es OBLIGATORIA', () => {
  it('⭐ un alta SIN modalidad se RECHAZA', () => {
    const r = esquemaProveedorCrear.safeParse({ ...ALTA_BASE });
    expect(r.success).toBe(false);
  });

  it('el mensaje dice qué hay que elegir, no un genérico', () => {
    const r = esquemaProveedorCrear.safeParse({ ...ALTA_BASE });
    expect(r.success).toBe(false);
    if (!r.success) {
      const mensajes = r.error.issues.map((i) => i.message).join(' | ');
      expect(mensajes).toContain('solo con factura');
    }
  });

  it('un alta con modalidad NULA se rechaza (null tampoco vale como "ya contesté")', () => {
    const r = esquemaProveedorCrear.safeParse({ ...ALTA_BASE, modalidadFacturacion: null });
    expect(r.success).toBe(false);
  });

  it('los tres valores válidos pasan, y ninguno otro', () => {
    for (const modalidad of ['solo_con', 'solo_sin', 'ambos'] as const) {
      expect(
        esquemaProveedorCrear.safeParse({ ...ALTA_BASE, modalidadFacturacion: modalidad }).success,
      ).toBe(true);
    }
    // No se inventa un cuarto valor: los tres del enum son los que Daniel nombró.
    expect(
      esquemaProveedorCrear.safeParse({ ...ALTA_BASE, modalidadFacturacion: 'a_veces' }).success,
    ).toBe(false);
  });

  // ⭐ FILA 0.124 — la casilla `factura` salió del contrato de escritura: la modalidad es la única
  // que contesta si el proveedor factura, y con ella se fue la regla R15 `factura ⇒ RFC + régimen`
  // (no se remapeó a propósito: habría bloqueado clasificar a los migrados, que no traen RFC).
  it('⭐ `factura` ya no se captura: el alta la descarta y no exige RFC', () => {
    const r = esquemaProveedorCrear.parse({
      ...ALTA_BASE,
      modalidadFacturacion: 'solo_con',
      factura: true,
    });
    expect('factura' in r).toBe(false);
    expect(r.modalidadFacturacion).toBe('solo_con');
    expect(r.rfc).toBeUndefined();
  });
});

describe('esquemaProveedorCrearMigrado — el ETL SÍ puede crear sin modalidad (REGLA 0-B)', () => {
  it('un alta migrada sin modalidad pasa: Access nunca hizo la pregunta', () => {
    const r = esquemaProveedorCrearMigrado.safeParse({ ...ALTA_BASE });
    expect(r.success).toBe(true);
  });

  it('y si el histórico la trae, se respeta', () => {
    const r = esquemaProveedorCrearMigrado.safeParse({
      ...ALTA_BASE,
      modalidadFacturacion: 'solo_sin',
    });
    expect(r.success).toBe(true);
  });

  it('⭐ y tampoco al ETL le acepta ya la casilla `factura` (fila 0.124)', () => {
    const r = esquemaProveedorCrearMigrado.parse({ ...ALTA_BASE, factura: true });
    expect('factura' in r).toBe(false);
  });
});

describe('esquemaProveedorEditar — la modalidad no se puede VACIAR', () => {
  it('⭐ mandar `null` para borrarla se RECHAZA', () => {
    const r = esquemaProveedorEditar.safeParse({
      id: 1,
      nombre: 'Maquilas del Norte',
      modalidadFacturacion: null,
    });
    expect(r.success).toBe(false);
  });

  it('cambiarla a otro valor válido sí pasa', () => {
    const r = esquemaProveedorEditar.safeParse({
      id: 1,
      nombre: 'Maquilas del Norte',
      modalidadFacturacion: 'ambos',
    });
    expect(r.success).toBe(true);
  });

  it('OMITIRLA sigue siendo válido: los PATCH parciales no se rompen (REGLA 0-B)', () => {
    // Desactivar/reactivar un proveedor y la fusión de roles del ETL mandan PATCH parciales que no
    // hablan de la modalidad. Si esto exigiera el campo, un proveedor migrado no se podría ni
    // desactivar — y la regla dice que los migrados se LEEN y se operan con normalidad.
    expect(esquemaProveedorEditar.safeParse({ id: 1, activo: false }).success).toBe(true);
    expect(esquemaProveedorEditar.safeParse({ id: 1, roles: [1, 2] }).success).toBe(true);
  });
});
