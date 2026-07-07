import { describe, expect, it } from 'vitest';

import type { ClavePermiso } from '@/api/tipos';

import {
  buscarModuloPorClave,
  esEntradaVisible,
  esModuloVisible,
  filtrarGruposVisibles,
  filtrarModulosVisibles,
  GRUPOS_MENU,
  MODULOS_MENU,
} from './catalogo';

/** Construye un conjunto de permisos a partir de una lista (azucar para los tests). */
function permisos(...claves: ClavePermiso[]): ReadonlySet<ClavePermiso> {
  return new Set(claves);
}

describe('catalogo del menu (rediseño R1: grupos + desplegables)', () => {
  it('tiene los 7 grupos aprobados por Daniel, en orden', () => {
    // Estructura aprobada 4-jul-2026 (spec §3.1): Resumen suelto + 6 grupos.
    expect(GRUPOS_MENU.map((g) => g.titulo)).toEqual([
      null, // Resumen (sin rotulo)
      'Operación',
      'Inventarios',
      'Comercial',
      'Finanzas',
      'Análisis',
      'Sistema',
    ]);
  });

  it('define 99 hojas y 15 padres con claves unicas (padres incluidos)', () => {
    // 99 hojas = las 91 entradas del menú plano anterior − 10 que se volvieron padres
    // (catalogos, produccion, compras, inventarios, ruta-critica, calidad, esma, costos, edr,
    // indicadores) + 18 nuevas (resumen; bordados y su galería y etiquetas-marca, que antes solo
    // vivían dentro del hub Catálogos; catálogos de telas/avíos/clientes; colores, tallas,
    // temporadas y almacenes como hojas propias; el duplicado deliberado de listas de precios en
    // Clientes; el panel de administración; y las 5 hojas «Próximamente»: Ventas, CxC, CxP,
    // Análisis RC y Auditores).
    expect(MODULOS_MENU).toHaveLength(99);
    const padres = GRUPOS_MENU.flatMap((g) => g.entradas.filter((e) => e.hijos !== undefined));
    expect(padres).toHaveLength(15);
    // Un padre nunca queda vacío (no navega: solo despliega a sus hijos).
    for (const padre of padres) {
      expect(padre.hijos.length).toBeGreaterThan(0);
    }
    const claves = [...MODULOS_MENU.map((m) => m.clave), ...padres.map((p) => p.clave)];
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('las rutas son unicas salvo /listas-precios (duplicado DELIBERADO en Clientes)', () => {
    const rutas = MODULOS_MENU.map((m) => m.ruta);
    const repetidas = rutas.filter((ruta, i) => rutas.indexOf(ruta) !== i);
    expect(repetidas).toEqual(['/listas-precios']);
  });

  it('los hijos aprobados van PRIMERO en cada desplegable (el principal al frente)', () => {
    const primerHijo = (clave: string): string | undefined => {
      const padre = GRUPOS_MENU.flatMap((g) => g.entradas).find((e) => e.clave === clave);
      return padre?.hijos?.[0]?.clave;
    };
    expect(primerHijo('g-desarrollo')).toBe('modelos');
    expect(primerHijo('produccion')).toBe('ordenes');
    expect(primerHijo('ruta-critica')).toBe('rc-bandeja');
    expect(primerHijo('calidad')).toBe('calidad-consulta-auditorias');
    expect(primerHijo('inventarios')).toBe('inventario-existencias');
    expect(primerHijo('catalogos')).toBe('colores');
  });

  it('marca la Ruta Critica como la entrada destacada', () => {
    const entradas = GRUPOS_MENU.flatMap((g) => g.entradas);
    const destacados = entradas.filter((e) => e.destacado);
    expect(destacados).toHaveLength(1);
    expect(destacados[0]?.clave).toBe('ruta-critica');
  });

  it('las hojas sin pantalla llevan su nota de "Proximamente" y ruta de un segmento', () => {
    // Van a la página comodín (`:modulo`), que solo captura UN segmento de ruta.
    for (const [clave, nota] of [
      ['ventas', 'Llega en R9'],
      ['auditores', 'Llega en R9'],
      ['cxc', 'Llega con Finanzas (F9)'],
      ['cxp', 'Llega con Finanzas (F9)'],
      ['analisis-rc', 'Llega en R7'],
    ] as const) {
      const hoja = MODULOS_MENU.find((m) => m.clave === clave);
      expect(hoja, clave).toBeDefined();
      expect(hoja?.proximamente).toBe(nota);
      expect(hoja?.ruta.slice(1).includes('/'), clave).toBe(false);
    }
  });

  it('muestra las hojas "autenticado" con cualquier sesion (incluso sin permisos)', () => {
    const visibles = filtrarModulosVisibles(permisos());
    // Sin permisos solo quedan las hojas de uso general: el resumen, los catálogos que heredaron
    // el gate del hub Catálogos (bordados + galería, telas, avíos, clientes, proveedores, colores,
    // tallas, temporadas, almacenes, etiquetas de marca), Documental y las 5 «Próximamente».
    expect(visibles.map((m) => m.clave).sort()).toEqual(
      [
        'almacenes',
        'analisis-rc',
        'auditores',
        'bordados',
        'catalogo-avios',
        'catalogo-telas',
        'clientes-catalogo',
        'colores',
        'cxc',
        'cxp',
        'documental',
        'etiquetas-marca',
        'galeria-bordados',
        'proveedores',
        'resumen',
        'tallas',
        'temporadas',
        'ventas',
      ].sort(),
    );
  });

  it('filtrarGruposVisibles poda hijos sin permiso y elimina padres/grupos vacios', () => {
    const grupos = filtrarGruposVisibles(permisos());
    const porClave = new Map(grupos.map((g) => [g.clave, g]));

    // FINANZAS: quedan CxC/CxP pero EsMa (todas sus hojas con permiso) desaparece.
    expect(porClave.get('finanzas')?.entradas.map((e) => e.clave)).toEqual(['cxc', 'cxp']);
    // OPERACIÓN: Ruta Crítica y Pedidos desaparecen (sin permisos); Desarrollo queda solo con
    // sus hojas "autenticado" (bordados y su galería); Calidad solo con Auditores.
    const operacion = porClave.get('operacion');
    expect(operacion?.entradas.map((e) => e.clave)).toEqual([
      'g-desarrollo',
      'produccion',
      'calidad',
    ]);
    const desarrollo = operacion?.entradas.find((e) => e.clave === 'g-desarrollo');
    expect(desarrollo?.hijos?.map((h) => h.clave)).toEqual(['bordados', 'galeria-bordados']);
    // SISTEMA: Catálogos base pierde "Tipos de proceso" (permiso propio); Administración y
    // Procesos y responsables desaparecen.
    const sistema = porClave.get('sistema');
    expect(sistema?.entradas.map((e) => e.clave)).toEqual(['catalogos']);
    const catalogos = sistema?.entradas.find((e) => e.clave === 'catalogos');
    expect(catalogos?.hijos?.map((h) => h.clave)).not.toContain('tipos-proceso');
  });

  it('un padre es visible si ALGUNA hoja hija es visible (basta una)', () => {
    const administracion = GRUPOS_MENU.flatMap((g) => g.entradas).find(
      (e) => e.clave === 'administracion',
    );
    expect(administracion).toBeDefined();
    if (!administracion) return; // estrecha el tipo (sin `!`)
    expect(esEntradaVisible(administracion, permisos())).toBe(false);
    // Con solo la bitácora, "Usuarios y accesos" aparece (con esa única hoja).
    expect(esEntradaVisible(administracion, permisos('admin.ver-bitacora'))).toBe(true);
    expect(esEntradaVisible(administracion, permisos('usuarios.administrar'))).toBe(true);
  });

  it('cada hoja conserva el permiso de su entrada equivalente anterior', () => {
    const casos: ReadonlyArray<[string, readonly ClavePermiso[] | 'autenticado']> = [
      ['modelos', ['modelos.ver']],
      ['galeria-modelos', ['modelos.ver']],
      ['desarrollo', ['desarrollo.ver']],
      ['listas-precios', ['listas.ver']],
      ['clientes-listas-precios', ['listas.ver']],
      ['pedidos', ['pedidos.ver']],
      ['ordenes', ['ordenes.ver']],
      ['notas-salida', ['notas.ver']],
      ['tipos-proceso', ['tipos-proceso.ver']],
      ['rc-bandeja', ['rc.ruta-ver']],
      ['rc-procesos', ['rc.catalogo-ver']],
      ['calidad-consulta-auditorias', ['calidad.ver']],
      ['bitacora', ['admin.ver-bitacora']],
      ['config-ruta-critica', ['empresas.administrar']],
      ['inventario-existencias', ['inventario-pt.ver']],
      ['edr-por-mes', ['edr.ver']],
      // Los catálogos que vivían bajo el hub Catálogos conservan su gate "autenticado".
      ['clientes-catalogo', 'autenticado'],
      ['proveedores', 'autenticado'],
      ['catalogo-telas', 'autenticado'],
      ['colores', 'autenticado'],
    ];
    for (const [clave, esperado] of casos) {
      const hoja = MODULOS_MENU.find((m) => m.clave === clave);
      expect(hoja, clave).toBeDefined();
      expect(hoja?.permisos, clave).toEqual(esperado);
    }
  });

  it('los hubs siguen encontrando sus sub-vistas por prefijo de ruta (compatibilidad)', () => {
    // `InventariosPagina` y `RutaCriticaPagina` listan tarjetas filtrando el menú plano.
    const inventarios = MODULOS_MENU.filter(
      (m) => m.subVista === true && m.ruta.startsWith('/inventarios/'),
    );
    expect(inventarios).toHaveLength(10);
    const rutaCritica = MODULOS_MENU.filter(
      (m) => m.subVista === true && m.ruta.startsWith('/ruta-critica/'),
    );
    expect(rutaCritica.map((m) => m.clave).sort()).toEqual(
      [
        'rc-bandeja',
        'rc-concentrado',
        'rc-dependencias',
        'rc-plantillas',
        'rc-procesos',
        'rc-reglas-duracion',
      ].sort(),
    );
  });

  it('busca por clave: hojas, padres (rutas legadas /produccion y /compras) e inexistentes', () => {
    expect(buscarModuloPorClave('rc-bandeja')?.titulo).toBe('Bandeja de tareas');
    // Los padres se encuentran porque /produccion y /compras siguen cayendo en la página
    // comodín (no tienen pantalla propia) y esta debe poder presentarlos.
    const produccion = buscarModuloPorClave('produccion');
    expect(produccion?.titulo).toBe('Producción');
    expect(produccion?.hijos).toBeDefined();
    expect(buscarModuloPorClave('compras')?.titulo).toBe('Compras / MRP');
    expect(buscarModuloPorClave('documental')?.hijos).toBeUndefined();
    expect(buscarModuloPorClave('inexistente')).toBeUndefined();
  });

  it('esModuloVisible respeta el gate por permisos de una hoja (A4)', () => {
    const bitacora = MODULOS_MENU.find((m) => m.clave === 'bitacora');
    expect(bitacora).toBeDefined();
    if (!bitacora) return;
    expect(esModuloVisible(bitacora, permisos())).toBe(false);
    expect(esModuloVisible(bitacora, permisos('admin.ver-bitacora'))).toBe(true);
  });
});
