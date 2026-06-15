import { describe, expect, it } from 'vitest';

import type { ClavePermiso } from '@/api/tipos';

import {
  buscarModuloPorClave,
  esModuloVisible,
  filtrarModulosVisibles,
  MODULOS_MENU,
} from './catalogo';

/** Construye un conjunto de permisos a partir de una lista (azucar para los tests). */
function permisos(...claves: ClavePermiso[]): ReadonlySet<ClavePermiso> {
  return new Set(claves);
}

describe('catalogo de modulos del menu', () => {
  it('define los 13 modulos del plan §5 con rutas y claves unicas', () => {
    expect(MODULOS_MENU).toHaveLength(13);
    const claves = MODULOS_MENU.map((m) => m.clave);
    expect(new Set(claves).size).toBe(13);
    const rutas = MODULOS_MENU.map((m) => m.ruta);
    expect(new Set(rutas).size).toBe(13);
  });

  it('marca la Ruta Critica como el modulo destacado', () => {
    const destacados = MODULOS_MENU.filter((m) => m.destacado);
    expect(destacados).toHaveLength(1);
    expect(destacados[0]?.clave).toBe('ruta-critica');
  });

  it('muestra los modulos "autenticado" con cualquier sesion (incluso sin permisos)', () => {
    const visibles = filtrarModulosVisibles(permisos());
    // Administracion (permisos admin) y Modelos (modelos.ver, F1-E4) NO son "autenticado";
    // el resto sí -> 11 visibles sin permisos.
    expect(visibles.map((m) => m.clave)).not.toContain('administracion');
    expect(visibles.map((m) => m.clave)).not.toContain('modelos');
    expect(visibles).toHaveLength(11);
  });

  it('oculta Administracion sin un permiso administrativo', () => {
    const admin = MODULOS_MENU.find((m) => m.clave === 'administracion');
    expect(admin).toBeDefined();
    if (!admin) return; // estrecha el tipo a ModuloMenu (sin `!`)
    expect(esModuloVisible(admin, permisos())).toBe(false);
  });

  it('muestra Administracion con cualquiera de sus permisos (basta uno)', () => {
    const admin = MODULOS_MENU.find((m) => m.clave === 'administracion');
    expect(admin).toBeDefined();
    if (!admin) return; // estrecha el tipo a ModuloMenu (sin `!`)
    expect(esModuloVisible(admin, permisos('almacenes.administrar'))).toBe(true);
    expect(esModuloVisible(admin, permisos('usuarios.administrar'))).toBe(true);
  });

  it('un usuario con todos los permisos ve los 13 modulos', () => {
    const todos = permisos(
      'usuarios.administrar',
      'roles.administrar',
      'empresas.administrar',
      'almacenes.administrar',
      // Modelos (F1-E4) requiere `modelos.ver` para verse en el menú.
      'modelos.ver',
    );
    expect(filtrarModulosVisibles(todos)).toHaveLength(13);
  });

  it('busca un modulo por su clave de ruta', () => {
    expect(buscarModuloPorClave('ruta-critica')?.titulo).toBe('Ruta Crítica');
    expect(buscarModuloPorClave('inexistente')).toBeUndefined();
  });
});
