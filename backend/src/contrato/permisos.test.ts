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

  it('transcribe los accesos del sistema viejo sin repetir (ids 15 y 37 diferidos por la fusión de terceros)', () => {
    // Fusión de terceros (D12/R15): al eliminar el catálogo `maquileros` se quitaron sus
    // dos accesos LEGADO (idAcceso 15 "programar maquileros" y 37 "alta de asegurados"),
    // que pertenecen a flujos de PRODUCCIÓN/EsMa (F3/F6), no al catálogo. Se remapearán en
    // el ETL de `UsuAccesos` (F8). El resto de los ids del sistema viejo (1–38) siguen 1:1.
    const idsViejos = catalogo.flatMap((p) => (p.origen ? [p.origen.idAcceso] : []));
    const esperados = Array.from({ length: 38 }, (_, i) => i + 1).filter(
      (id) => id !== 15 && id !== 37,
    );
    expect([...idsViejos].sort((a, b) => a - b)).toEqual(esperados);
  });

  it('incluye los permisos nuevos de administración y de catálogos de v2', () => {
    const nuevos = catalogo.filter((p) => p.origen === undefined).map((p) => p.clave);
    expect(nuevos.sort()).toEqual([
      'almacenes.administrar',
      'almacenes.ver',
      // Catálogos de materiales (F1-E3): avíos (R1) + proveedores.
      'avios.administrar',
      'avios.ver',
      // Catálogos de materiales (F1-E3): bordados/estampados (R2) + foto.
      'bordados.administrar',
      'bordados.ver',
      // Catálogos estructurados (F1-E2): clientes (D7) + tallas/curvas (D4).
      // NOTA (fusión de terceros, D12/R15): maquileros/cortadores se fusionaron en proveedores.
      'clientes.administrar',
      'clientes.ver',
      // Catálogos maestros globales (F1-E1, ADR-0007): ver + administrar por catálogo.
      'colores.administrar',
      'colores.ver',
      'empresas.administrar',
      'etiquetas-marca.administrar',
      'etiquetas-marca.ver',
      // Modelos (Módulo 2, F1-E4): catálogo + receta/BOM + fotos.
      'modelos.administrar',
      // Generador de códigos de barra (F1-E5): EAN-13 + DUN-14 (sucesor del form `Codigo`).
      'modelos.codigos-barra',
      'modelos.ver',
      // Órdenes de producción (Módulo ÓRDENES, F2-E2): ver/administrar/cancelar (nuevos de v2).
      'ordenes.administrar',
      'ordenes.cancelar',
      'ordenes.ver',
      // Pedidos (Módulo PEDIDOS, F2-E1): ver/administrar/importes + pedidos reales.
      'pedidos-reales.administrar',
      'pedidos.administrar',
      'pedidos.importes',
      'pedidos.ver',
      'proveedores.administrar',
      'proveedores.ver',
      'roles.administrar',
      'tallas.administrar',
      'tallas.ver',
      // Catálogos de materiales (F1-E3): telas unificadas (D5) + categorías + colores.
      'telas.administrar',
      'telas.ver',
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
