import { describe, expect, it } from 'vitest';

import {
  CATALOGO_PERMISOS,
  CLAVES_PERMISO,
  MODULOS_PERMISO,
  esClavePermiso,
  permisosPorModulo,
  type DefinicionPermiso,
} from './permisos.js';

// Vista con el tipo ancho: el union de literales solo expone `origen` en las
// entradas que lo tienen; para filtrar por su presencia se necesita la interfaz.
const catalogo: readonly DefinicionPermiso[] = CATALOGO_PERMISOS;

describe('catálogo de permisos', () => {
  it('no tiene claves repetidas', () => {
    const unicas = new Set(CLAVES_PERMISO);
    expect(unicas.size).toBe(CATALOGO_PERMISOS.length);
  });

  it('toda clave tiene formato `modulo.accion` y su prefijo coincide con el módulo', () => {
    // El módulo y la acción son kebab-case (minúsculas, dígitos y guiones); p. ej.
    // el catálogo de etiquetas de marca usa el módulo `etiquetas-marca` (F1-E1).
    for (const permiso of CATALOGO_PERMISOS) {
      expect(permiso.clave).toMatch(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/);
      expect(permiso.clave.startsWith(`${permiso.modulo}.`)).toBe(true);
      expect(Object.keys(MODULOS_PERMISO)).toContain(permiso.modulo);
    }
  });

  it('transcribe los 38 accesos del sistema viejo (ids 1–38, sin repetir ni faltar)', () => {
    const idsViejos = catalogo.flatMap((p) => (p.origen ? [p.origen.idAcceso] : []));
    expect([...idsViejos].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 38 }, (_, i) => i + 1),
    );
  });

  it('incluye los permisos nuevos de administración y de catálogos de v2', () => {
    const nuevos = catalogo.filter((p) => p.origen === undefined).map((p) => p.clave);
    expect(nuevos.sort()).toEqual([
      'almacenes.administrar',
      'almacenes.ver',
      // Catálogos estructurados (F1-E2): clientes (D7) + maquileros + tallas/curvas (D4).
      'clientes.administrar',
      'clientes.ver',
      // Catálogos maestros globales (F1-E1, ADR-0007): ver + administrar por catálogo.
      'colores.administrar',
      'colores.ver',
      'cortadores.administrar',
      'cortadores.ver',
      'empresas.administrar',
      'etiquetas-marca.administrar',
      'etiquetas-marca.ver',
      'maquileros.administrar',
      'maquileros.ver',
      'proveedores.administrar',
      'proveedores.ver',
      'roles.administrar',
      'tallas.administrar',
      'tallas.ver',
      'temporadas.administrar',
      'temporadas.ver',
      'usuarios.administrar',
    ]);
  });

  it('esClavePermiso distingue claves del catálogo de strings arbitrarios', () => {
    expect(esClavePermiso('compras.autorizar')).toBe(true);
    expect(esClavePermiso('compras.inexistente')).toBe(false);
    expect(esClavePermiso('')).toBe(false);
  });

  it('permisosPorModulo reparte el catálogo completo sin perder permisos', () => {
    const grupos = permisosPorModulo();
    const total = [...grupos.values()].reduce((suma, lista) => suma + lista.length, 0);
    expect(total).toBe(CATALOGO_PERMISOS.length);
    expect(grupos.get('rc')?.map((p) => p.clave)).toContain('rc.ver-botones');
  });
});
