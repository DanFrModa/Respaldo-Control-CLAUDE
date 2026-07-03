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
    // 13 módulos del plan + 19 sub-vistas (galería de modelos, F1-E5; órdenes, F2-E3; consulta de
    // órdenes + incompletas + pedidos por mes, F2-E4; tipos de proceso, F3-E1; captura de corte +
    // envío a maquila + corte semanal, F3-E2; movimientos + traspasos + existencias + kardex de
    // inventario PT, F3-E3; recibo + recibos semanales + validación de cargos EsMa, F3-E4; entrega a
    // cliente + tablero WIP + existencias en poder del maquilero, F3-E5).
    // 13 módulos del plan + 29 sub-vistas (recepción de compras, F4-E3) + 2 sub-vistas de F4-E4
    // (explosión de materiales y "qué tengo / qué falta") + 3 sub-vistas de F4-E5 (notas de salida:
    // captura, consulta de notas y notas por orden) + 2 sub-vistas de F5-E1 (Ruta Crítica: procesos
    // y dependencias) + 3 sub-vistas de F5-E2 (plantillas de ruta, reglas de duración y
    // configuración de RC por empresa) + 1 sub-vista de F5-E5 (bandeja de tareas) + 1 sub-vista de
    // F5-E7 (concentrado planeado vs real) = 41 sub-vistas.
    // F6-E1: +3 sub-vistas de Calidad (defectos, tipos de producto, planes AQL) + 1 sub-vista de
    // Administración (bitácora) = 45 sub-vistas → 58 entradas. F6-E2: +1 sub-vista de Calidad
    // (auditorías de calidad, `calidad.generar-auditorias`) = 46 sub-vistas → 59 entradas. F6-E3:
    // +2 sub-vistas de Calidad (consulta de auditorías e historial por maquilero, `calidad.ver`) =
    // 48 sub-vistas → 61 entradas. F6-E4: +4 sub-vistas de EsMa (conciliación y pagos con
    // `esma.ver-pagos`; abonos y descuentos con `esma.modificar`) = 52 sub-vistas → 65 entradas.
    // F6-E5: +5 sub-vistas de EsMa (estado de cuenta, saldos, desglosado, pagos y recibos semanales,
    // todas con `esma.ver-pagos`) = 57 sub-vistas → 70 entradas.
    // F7-E1: +5 sub-vistas de Costos (pre-costo y lista de precios con `precostos.consultar`; costeo
    // de orden, lista de costos y márgenes con `costos.ver`) = 62 sub-vistas → 75 entradas. El módulo
    // Costos deja de ser "autenticado": ahora lo gobiernan `precostos.consultar`/`costos.ver`.
    // F7-E2: +1 módulo EDR (`edr.ver`) → 14 planeados, +4 sub-vistas del EDR (gestión del mes con
    // `edr.capturar`; conciliación, por mes y por año con `edr.ver`) = 66 sub-vistas → 80 entradas.
    const planeados = MODULOS_MENU.filter((m) => m.subVista !== true);
    expect(planeados).toHaveLength(14);
    expect(MODULOS_MENU).toHaveLength(80);
    const claves = MODULOS_MENU.map((m) => m.clave);
    expect(new Set(claves).size).toBe(80);
    const rutas = MODULOS_MENU.map((m) => m.ruta);
    expect(new Set(rutas).size).toBe(80);
  });

  it('marca la galeria de modelos como sub-vista (no es un modulo del plan)', () => {
    const galeria = MODULOS_MENU.find((m) => m.clave === 'galeria-modelos');
    expect(galeria).toBeDefined();
    expect(galeria?.subVista).toBe(true);
    expect(galeria?.permisos).toEqual(['modelos.ver']);
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
    // Administracion (permisos admin), Modelos y Galería de modelos (modelos.ver), Pedidos
    // (pedidos.ver, F2-E1) y Órdenes (ordenes.ver, F2-E3) NO son "autenticado"; Calidad
    // (calidad.ver, F6-E1) y Costos (precostos.consultar/costos.ver, F7-E1) tampoco; el resto sí
    // -> 8 visibles sin permisos.
    expect(visibles.map((m) => m.clave)).not.toContain('administracion');
    expect(visibles.map((m) => m.clave)).not.toContain('modelos');
    expect(visibles.map((m) => m.clave)).not.toContain('galeria-modelos');
    expect(visibles.map((m) => m.clave)).not.toContain('codigos-barra');
    expect(visibles.map((m) => m.clave)).not.toContain('pedidos');
    expect(visibles.map((m) => m.clave)).not.toContain('ordenes');
    expect(visibles.map((m) => m.clave)).not.toContain('calidad');
    expect(visibles.map((m) => m.clave)).not.toContain('costos');
    expect(visibles).toHaveLength(8);
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

  it('un usuario con todos los permisos ve los 13 modulos + las 19 sub-vistas', () => {
    const todos = permisos(
      'usuarios.administrar',
      'roles.administrar',
      'empresas.administrar',
      'almacenes.administrar',
      // Modelos (F1-E4) y su Galería (F1-E5) requieren `modelos.ver`; Pedidos (F2-E1) requiere
      // `pedidos.ver`; Órdenes (F2-E3) y las consultas/incompletas/tablero (F2-E4) requieren
      // `ordenes.ver`; Tipos de proceso (F3-E1) requiere `tipos-proceso.ver`; corte/envío/corte
      // semanal (F3-E2) requieren `produccion.*`; inventario PT (F3-E3) requiere `inventario-pt.*`;
      // recibo + recibos semanales (F3-E4) requieren `produccion.recibo`/`.wip-ver`; la validación
      // de cargos EsMa (F3-E4) requiere `esma.cargo-validar`; la entrega a cliente (F3-E5) requiere
      // `produccion.entrega` (el tablero WIP y existencias del maquilero usan `produccion.wip-ver`).
      'modelos.ver',
      'pedidos.ver',
      'ordenes.ver',
      'tipos-proceso.ver',
      'produccion.corte',
      'produccion.envio',
      'produccion.recibo',
      'produccion.entrega',
      'produccion.wip-ver',
      'inventario-pt.ver',
      'inventario-pt.mover',
      // Inventario de telas/avíos (F4-E1): sus 6 sub-vistas requieren `inventario-telas/avios.*`.
      'inventario-telas.ver',
      'inventario-telas.mover',
      'inventario-avios.ver',
      'inventario-avios.mover',
      'esma.cargo-validar',
    );
    // 13 módulos del plan + 25 sub-vistas (las 19 previas + las 6 de inventario de telas/avíos de
    // F4-E1) + la Configuración de RC por empresa (F5-E2, gobernada por `empresas.administrar`,
    // que sí está en este set) = 39. Las sub-vistas de RC `rc.catalogo-ver` (procesos/dependencias
    // de F5-E1 y plantillas/reglas de F5-E2) NO entran: ese permiso no está en este set.
    // F6-E1: Calidad y sus 3 sub-vistas requieren `calidad.ver` (no en este set); bitácora
    // requiere `admin.ver-bitacora` (no en este set) → el total baja de 39 a 38 (calidad
    // ya no es "autenticado").
    // F7-E1: el módulo Costos requiere `precostos.consultar`/`costos.ver` (no en este set) y sus 5
    // sub-vistas también → Costos ya no cuenta (antes era "autenticado") → 38 baja a 37.
    expect(filtrarModulosVisibles(todos)).toHaveLength(37);
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
