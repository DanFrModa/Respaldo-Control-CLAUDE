import { describe, expect, it } from 'vitest';

import { ErrorPermiso } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { asignarProveedorDeMaterial } from './proveedor-de-orden.js';

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
