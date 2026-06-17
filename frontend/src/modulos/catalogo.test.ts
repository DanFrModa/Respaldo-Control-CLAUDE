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
  it('define los 13 modulos del plan §5 (mas sub-vistas) con rutas y claves unicas', () => {
    // 13 módulos del plan + 6 sub-vistas (galería de modelos + códigos de barra, F1-E5; órdenes,
    // F2-E3; consulta de órdenes + incompletas + pedidos por mes, F2-E4).
    const planeados = MODULOS_MENU.filter((m) => m.subVista !== true);
    expect(planeados).toHaveLength(13);
    expect(MODULOS_MENU).toHaveLength(19);
    const claves = MODULOS_MENU.map((m) => m.clave);
    expect(new Set(claves).size).toBe(19);
    const rutas = MODULOS_MENU.map((m) => m.ruta);
    expect(new Set(rutas).size).toBe(19);
  });

  it('marca la galeria de modelos como sub-vista (no es un modulo del plan)', () => {
    const galeria = MODULOS_MENU.find((m) => m.clave === 'galeria-modelos');
    expect(galeria).toBeDefined();
    expect(galeria?.subVista).toBe(true);
    expect(galeria?.permisos).toEqual(['modelos.ver']);
  });

  it('marca el generador de codigos de barra como sub-vista con su propio permiso', () => {
    const barras = MODULOS_MENU.find((m) => m.clave === 'codigos-barra');
    expect(barras).toBeDefined();
    expect(barras?.subVista).toBe(true);
    expect(barras?.permisos).toEqual(['modelos.codigos-barra']);
    expect(barras?.ruta).toBe('/modelos/codigos-barra');
  });

  it('marca las ordenes de produccion como sub-vista con su propio permiso', () => {
    const ordenes = MODULOS_MENU.find((m) => m.clave === 'ordenes');
    expect(ordenes).toBeDefined();
    expect(ordenes?.subVista).toBe(true);
    expect(ordenes?.permisos).toEqual(['ordenes.ver']);
    expect(ordenes?.ruta).toBe('/produccion/ordenes');
  });

  it('marca la Ruta Critica como el modulo destacado', () => {
    const destacados = MODULOS_MENU.filter((m) => m.destacado);
    expect(destacados).toHaveLength(1);
    expect(destacados[0]?.clave).toBe('ruta-critica');
  });

  it('muestra los modulos "autenticado" con cualquier sesion (incluso sin permisos)', () => {
    const visibles = filtrarModulosVisibles(permisos());
    // Administracion (permisos admin), Modelos y Galería de modelos (modelos.ver), Códigos de
    // barra (modelos.codigos-barra), Pedidos (pedidos.ver, F2-E1) y Órdenes (ordenes.ver, F2-E3)
    // NO son "autenticado"; el resto sí -> 10 visibles sin permisos.
    expect(visibles.map((m) => m.clave)).not.toContain('administracion');
    expect(visibles.map((m) => m.clave)).not.toContain('modelos');
    expect(visibles.map((m) => m.clave)).not.toContain('galeria-modelos');
    expect(visibles.map((m) => m.clave)).not.toContain('codigos-barra');
    expect(visibles.map((m) => m.clave)).not.toContain('pedidos');
    expect(visibles.map((m) => m.clave)).not.toContain('ordenes');
    expect(visibles).toHaveLength(10);
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

  it('un usuario con todos los permisos ve los 13 modulos + las 6 sub-vistas', () => {
    const todos = permisos(
      'usuarios.administrar',
      'roles.administrar',
      'empresas.administrar',
      'almacenes.administrar',
      // Modelos (F1-E4) y su Galería (F1-E5) requieren `modelos.ver`; el generador de códigos de
      // barra (F1-E5) requiere `modelos.codigos-barra`; Pedidos (F2-E1) requiere `pedidos.ver`;
      // Órdenes (F2-E3) y las consultas/incompletas/tablero (F2-E4) requieren `ordenes.ver`.
      'modelos.ver',
      'modelos.codigos-barra',
      'pedidos.ver',
      'ordenes.ver',
    );
    // 13 módulos del plan + 6 sub-vistas (galería + códigos de barra + órdenes + consulta +
    // incompletas + pedidos por mes) = 19.
    expect(filtrarModulosVisibles(todos)).toHaveLength(19);
  });

  it('marca consulta/incompletas/pedidos-por-mes como sub-vistas con permiso ordenes.ver (F2-E4)', () => {
    for (const clave of ['consulta-ordenes', 'ordenes-incompletas', 'pedidos-por-mes']) {
      const entrada = MODULOS_MENU.find((m) => m.clave === clave);
      expect(entrada).toBeDefined();
      expect(entrada?.subVista).toBe(true);
      expect(entrada?.permisos).toEqual(['ordenes.ver']);
    }
  });

  it('busca un modulo por su clave de ruta', () => {
    expect(buscarModuloPorClave('ruta-critica')?.titulo).toBe('Ruta Crítica');
    expect(buscarModuloPorClave('inexistente')).toBeUndefined();
  });
});
