import { describe, expect, it } from 'vitest';

import { ErrorPermiso } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  asignarProveedorDeMaterial,
  asignarProveedorDeMaterialEnBloque,
  renglonesUnicos,
} from './proveedor-de-orden.js';

/**
 * Unit de la asignación de proveedor POR ORDEN (V1-E3m, §Post-F9.82) — SIN Postgres: aquí solo vive
 * el guard de permisos, que se verifica ANTES de tocar la base (A4, deny-by-default). El
 * comportamiento real —qué escribe, qué rechaza, que NO toca el catálogo— va en `mrp.int.test.ts`.
 */
const cuerpo = { tipo: 'tela' as const, idMaterial: 1, idProveedor: 2 };

describe('asignarProveedorDeMaterial — permisos (A4)', () => {
  it('sin permisos lanza ErrorPermiso antes de llegar a la BD', async () => {
    await expect(
      asignarProveedorDeMaterial(sesionDePrueba({ permisos: [] }), 1, cuerpo),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('`compras.ver` NO alcanza: desatorar una compra es administrarla', async () => {
    await expect(
      asignarProveedorDeMaterial(sesionDePrueba({ permisos: ['compras.ver'] }), 1, cuerpo),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('con `compras.administrar` pasa el guard (falla después, por la BD inexistente)', async () => {
    await expect(
      asignarProveedorDeMaterial(sesionDePrueba({ permisos: ['compras.administrar'] }), 1, cuerpo),
    ).rejects.not.toBeInstanceOf(ErrorPermiso);
  });
});

/**
 * ⭐ V1-E3x (§Post-F9.88) — EL ACTO EN BLOQUE. Igual que arriba, sin Postgres sólo se puede
 * ejercitar lo que no toca la base: el guard de permisos (A4) y el DEDUPE, que es la única pieza
 * pura del acto. Lo demás —todo-o-nada, A9, excluido, bitácora del lote— vive en `mrp.int.test.ts`.
 */
const enBloque = {
  asignaciones: [{ idOrden: 1, tipo: 'tela' as const, idMaterial: 1 }],
  idProveedor: 2,
};

describe('asignarProveedorDeMaterialEnBloque — permisos (A4)', () => {
  it('sin permisos lanza ErrorPermiso antes de llegar a la BD', async () => {
    await expect(
      asignarProveedorDeMaterialEnBloque(sesionDePrueba({ permisos: [] }), enBloque),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('`compras.ver` NO alcanza: la vía rápida no puede ser la vía floja', async () => {
    await expect(
      asignarProveedorDeMaterialEnBloque(sesionDePrueba({ permisos: ['compras.ver'] }), enBloque),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('con `compras.administrar` pasa el guard (falla después, por la BD inexistente)', async () => {
    await expect(
      asignarProveedorDeMaterialEnBloque(
        sesionDePrueba({ permisos: ['compras.administrar'] }),
        enBloque,
      ),
    ).rejects.not.toBeInstanceOf(ErrorPermiso);
  });
});

describe('renglonesUnicos — el conteo del acto no se infla (A7)', () => {
  it('la misma (orden, tipo, material) repetida cuenta UNA vez', () => {
    expect(
      renglonesUnicos([
        { idOrden: 10, tipo: 'avio', idMaterial: 5 },
        { idOrden: 10, tipo: 'avio', idMaterial: 5 },
        { idOrden: 10, tipo: 'avio', idMaterial: 5 },
      ]),
    ).toEqual([{ idOrden: 10, tipo: 'avio', idMaterial: 5 }]);
  });

  it('el MISMO material en OTRA orden NO es duplicado (son dos renglones de receta)', () => {
    expect(
      renglonesUnicos([
        { idOrden: 10, tipo: 'avio', idMaterial: 5 },
        { idOrden: 11, tipo: 'avio', idMaterial: 5 },
      ]),
    ).toHaveLength(2);
  });

  it('⚠️ la tela 7 y el avío 7 son materiales DISTINTOS: el tipo entra en la clave', () => {
    const salida = renglonesUnicos([
      { idOrden: 10, tipo: 'tela', idMaterial: 7 },
      { idOrden: 10, tipo: 'avio', idMaterial: 7 },
    ]);
    expect(salida).toHaveLength(2);
    expect(salida.map((r) => r.tipo)).toEqual(['tela', 'avio']);
  });

  it('conserva el ORDEN en que llegaron (la posición del lote es reconstruible, A7)', () => {
    expect(
      renglonesUnicos([
        { idOrden: 1, tipo: 'avio', idMaterial: 3 },
        { idOrden: 1, tipo: 'avio', idMaterial: 1 },
        { idOrden: 1, tipo: 'avio', idMaterial: 3 },
        { idOrden: 1, tipo: 'avio', idMaterial: 2 },
      ]).map((r) => r.idMaterial),
    ).toEqual([3, 1, 2]);
  });

  it('una lista sin duplicados sale idéntica', () => {
    const entrada = [
      { idOrden: 1, tipo: 'tela' as const, idMaterial: 1 },
      { idOrden: 2, tipo: 'avio' as const, idMaterial: 2 },
    ];
    expect(renglonesUnicos(entrada)).toEqual(entrada);
  });
});
