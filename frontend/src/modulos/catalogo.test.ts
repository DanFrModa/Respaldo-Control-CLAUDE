import { describe, expect, it } from 'vitest';

import type { ClavePermiso } from '@/api/tipos';

import {
  buscarModuloPorClave,
  esEntradaVisible,
  esModuloVisible,
  filtrarCatalogoVisible,
  filtrarGruposVisibles,
  filtrarModulosVisibles,
  type GrupoMenu,
  GRUPOS_MENU,
  type ModuloMenu,
  MODULOS_MENU,
  RIEL_GRUPOS,
  tituloPorRuta,
} from './catalogo';

/** Construye un conjunto de permisos a partir de una lista (azucar para los tests). */
function permisos(...claves: ClavePermiso[]): ReadonlySet<ClavePermiso> {
  return new Set(claves);
}

/** TODOS los permisos que usa alguna hoja del catálogo (para "ver el riel completo"). */
function todosLosPermisos(): ReadonlySet<ClavePermiso> {
  const set = new Set<ClavePermiso>();
  for (const modulo of MODULOS_MENU) {
    if (modulo.permisos !== 'autenticado') {
      for (const clave of modulo.permisos) {
        set.add(clave);
      }
    }
  }
  return set;
}

/** Aplana las HOJAS de una estructura agrupada (padres → hijos, en orden). */
function hojasDe(grupos: readonly GrupoMenu[]): string[] {
  return grupos.flatMap((grupo) =>
    grupo.entradas.flatMap((entrada) =>
      entrada.hijos !== undefined ? entrada.hijos.map((h) => h.clave) : [entrada.clave],
    ),
  );
}

describe('catálogo COMPLETO (registro exhaustivo de pantallas)', () => {
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

  it('define 107 hojas y 15 padres con claves unicas (padres incluidos)', () => {
    // El catálogo completo NO cambia con la poda del riel: sigue conteniendo TODAS las pantallas
    // (107 hojas + 15 padres; +4 en A2: ajuste/traspaso por color y las vistas legadas por lote
    // de existencias y salida a orden; +1 en B1: entradas de tela por factura; +1 en §Post-F9.26:
    // el archivo histórico de órdenes del sistema viejo). Lo que cambia es SOLO qué se ve en el riel.
    expect(MODULOS_MENU).toHaveLength(107);
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
    expect(primerHijo('g-rc-config')).toBe('rc-procesos-responsables');
    expect(primerHijo('calidad')).toBe('calidad-consulta-auditorias');
    expect(primerHijo('inventarios')).toBe('inventario-existencias');
    expect(primerHijo('telas')).toBe('inventario-telas-existencias');
    expect(primerHijo('catalogos')).toBe('colores');
  });

  it('las hojas sin pantalla llevan su nota de "Proximamente" y ruta de un segmento', () => {
    // Van a la página comodín (`:modulo`), que solo captura UN segmento de ruta. (Ventas ya es una
    // pantalla real gateada por `edr.ver`, F9; Documental sigue "Próximamente".)
    for (const [clave, nota] of [['documental', 'Llega en una fase posterior del plan']] as const) {
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
    // tallas, temporadas, almacenes, etiquetas de marca) y la «Próximamente» Documental.
    // (CxC ya NO: es pantalla real gateada por `cxc.ver`, F9-E4. Auditores tampoco: `calidad.ver`, R9.
    // Ventas tampoco: es pantalla real gateada por `edr.ver`, F9.)
    expect(visibles.map((m) => m.clave).sort()).toEqual(
      [
        'almacenes',
        'bordados',
        'catalogo-avios',
        'catalogo-telas',
        'clientes-catalogo',
        'colores',
        'documental',
        'etiquetas-marca',
        'galeria-bordados',
        'proveedores',
        'resumen',
        'tallas',
        'temporadas',
      ].sort(),
    );
  });

  it('cada hoja conserva EXACTAMENTE el permiso de su entrada equivalente (A4, no cambia)', () => {
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
      ['ruta-critica', ['rc.ruta-ver']],
      ['rc-concentrado', ['rc.ruta-ver']],
      ['analisis-rc', ['rc.ruta-ver']],
      ['rc-procesos-responsables', ['rc.catalogo-ver']],
      ['rc-procesos', ['rc.catalogo-ver']],
      ['calidad-consulta-auditorias', ['calidad.ver']],
      ['calidad-defectos', ['calidad.ver']],
      ['bitacora', ['admin.ver-bitacora']],
      ['config-ruta-critica', ['empresas.administrar']],
      ['inventario-existencias', ['inventario-pt.ver']],
      ['inventario-movimientos', ['inventario-pt.mover']],
      ['edr-por-mes', ['edr.ver']],
      // Ventas comparte el gate del EDR (es su misma data, F9).
      ['ventas', ['edr.ver']],
      // Los catálogos que vivían bajo el hub Catálogos conservan su gate "autenticado".
      ['clientes-catalogo', 'autenticado'],
      ['proveedores', 'autenticado'],
      ['catalogo-telas', 'autenticado'],
      ['colores', 'autenticado'],
      ['etiquetas-marca', 'autenticado'],
    ];
    for (const [clave, esperado] of casos) {
      const hoja = MODULOS_MENU.find((m) => m.clave === clave);
      expect(hoja, clave).toBeDefined();
      expect(hoja?.permisos, clave).toEqual(esperado);
    }
  });

  it('los hubs siguen encontrando sus sub-vistas por prefijo de ruta (compatibilidad)', () => {
    const inventarios = MODULOS_MENU.filter(
      (m) => m.subVista === true && m.ruta.startsWith('/inventarios/'),
    );
    // +4 en A2: ajuste/traspaso de telas por color y las vistas legadas por lote (existencias y
    // salida a orden); +1 en B1: entradas de tela por factura/remisión.
    expect(inventarios).toHaveLength(15);
  });

  it('busca por clave: hojas, padres (rutas legadas /produccion y /compras) e inexistentes', () => {
    expect(buscarModuloPorClave('rc-procesos-responsables')?.titulo).toBe(
      'Procesos y responsables',
    );
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

  it('un padre del catálogo es visible si ALGUNA hoja hija es visible (basta una)', () => {
    const administracion = GRUPOS_MENU.flatMap((g) => g.entradas).find(
      (e) => e.clave === 'administracion',
    );
    expect(administracion).toBeDefined();
    if (!administracion) return; // estrecha el tipo (sin `!`)
    expect(esEntradaVisible(administracion, permisos())).toBe(false);
    // Con solo la bitácora, el padre aparece (con esa única hoja).
    expect(esEntradaVisible(administracion, permisos('admin.ver-bitacora'))).toBe(true);
    expect(esEntradaVisible(administracion, permisos('usuarios.administrar'))).toBe(true);
  });
});

describe('EL RIEL (proyección podada — estructura EXACTA de Daniel §3.1)', () => {
  // Lo que Daniel aprobó, ni una entrada de más. `padre: true` = desplegable (2 niveles).
  const RIEL_ESPERADO: ReadonlyArray<{
    titulo: string | null;
    entradas: ReadonlyArray<{ clave: string; padre: boolean; hijos?: readonly string[] }>;
  }> = [
    { titulo: null, entradas: [{ clave: 'resumen', padre: false }] },
    {
      titulo: 'Operación',
      entradas: [
        { clave: 'g-desarrollo', padre: true, hijos: ['modelos', 'desarrollo', 'listas-precios'] },
        { clave: 'pedidos', padre: false },
        { clave: 'produccion', padre: true, hijos: ['ordenes', 'notas-salida'] },
        { clave: 'ruta-critica', padre: false },
        { clave: 'calidad', padre: true, hijos: ['calidad-consulta-auditorias', 'auditores'] },
      ],
    },
    {
      titulo: 'Inventarios',
      entradas: [
        { clave: 'inventarios', padre: false },
        {
          // A2 (Daniel, 6-ago-2026): Telas pasó a DESPLEGABLE para que el catálogo de telas se
          // vea en el menú. Hijos curados: existencias por color (principal) + catálogo +
          // salida a orden + ajuste; el resto sigue por ⌘K.
          clave: 'telas',
          padre: true,
          hijos: [
            'inventario-telas-existencias',
            'catalogo-telas',
            // +1 en B1: la entrada por factura/remisión (la otra puerta del inventario de telas).
            'inventario-telas-entradas',
            'inventario-telas-salida-orden',
            'inventario-telas-ajuste',
          ],
        },
        { clave: 'avios', padre: false },
        { clave: 'compras', padre: false },
      ],
    },
    {
      titulo: 'Comercial',
      entradas: [
        {
          clave: 'clientes',
          padre: true,
          hijos: ['clientes-catalogo', 'clientes-listas-precios', 'ventas'],
        },
        { clave: 'proveedores', padre: false },
      ],
    },
    {
      titulo: 'Finanzas',
      entradas: [
        { clave: 'cxc', padre: false },
        { clave: 'cxp', padre: false },
        { clave: 'reportes-fiscales', padre: false }, // F9-E5: reporte del contador (gate terceros.fiscal)
        { clave: 'esma', padre: false }, // desviación interina (F9): hoja directa, NO desplegable
      ],
    },
    {
      titulo: 'Análisis',
      entradas: [
        { clave: 'analisis-rc', padre: false },
        { clave: 'costos', padre: false },
        { clave: 'edr', padre: false },
        { clave: 'indicadores', padre: false },
      ],
    },
    {
      titulo: 'Sistema',
      entradas: [
        {
          clave: 'catalogos',
          padre: true,
          hijos: ['colores', 'tallas', 'temporadas', 'tipos-proceso', 'almacenes'],
        },
        { clave: 'g-rc-config', padre: false },
        { clave: 'administracion', padre: false },
      ],
    },
  ];

  it('el riel es EXACTAMENTE la estructura de Daniel (grupos, entradas, hijos)', () => {
    expect(RIEL_GRUPOS.map((g) => g.titulo)).toEqual(RIEL_ESPERADO.map((g) => g.titulo));
    RIEL_ESPERADO.forEach((grupoEsperado, i) => {
      const grupo = RIEL_GRUPOS[i];
      expect(
        grupo?.entradas.map((e) => e.clave),
        grupoEsperado.titulo ?? 'inicio',
      ).toEqual(grupoEsperado.entradas.map((e) => e.clave));
      grupoEsperado.entradas.forEach((entradaEsperada, j) => {
        const entrada = grupo?.entradas[j];
        // padre ⇔ tiene `hijos`; hoja ⇔ navega (hijos undefined).
        expect(entrada?.hijos !== undefined, `${entradaEsperada.clave} padre?`).toBe(
          entradaEsperada.padre,
        );
        if (entradaEsperada.hijos !== undefined) {
          expect(
            entrada?.hijos?.map((h) => h.clave),
            entradaEsperada.clave,
          ).toEqual(entradaEsperada.hijos);
        }
      });
    });
  });

  it('el riel tiene 6 padres y marca SOLO la Ruta Crítica como destacada', () => {
    const padres = RIEL_GRUPOS.flatMap((g) => g.entradas.filter((e) => e.hijos !== undefined));
    expect(padres.map((p) => p.clave)).toEqual([
      'g-desarrollo',
      'produccion',
      'calidad',
      'telas', // A2: desplegable (el catálogo de telas tenía que verse en el menú)
      'clientes',
      'catalogos',
    ]);
    const destacadas = RIEL_GRUPOS.flatMap((g) => g.entradas).filter((e) => e.destacado);
    expect(destacadas).toHaveLength(1);
    expect(destacadas[0]?.clave).toBe('ruta-critica');
  });

  it('las hojas colapsadas navegan a su pantalla principal con el gate correcto', () => {
    const hojaRiel = (clave: string): ModuloMenu | undefined => {
      const entrada = RIEL_GRUPOS.flatMap((g) => g.entradas).find((e) => e.clave === clave);
      // `hijos === undefined` estrecha EntradaMenu → ModuloMenu (tiene `ruta`/`permisos`).
      return entrada !== undefined && entrada.hijos === undefined ? entrada : undefined;
    };
    const casos: ReadonlyArray<[string, string, readonly ClavePermiso[]]> = [
      ['inventarios', '/inventarios/existencias', ['inventario-pt.ver']],
      // «telas» ya NO es hoja colapsada: pasó a padre desplegable en A2 (ver el test del riel).
      ['avios', '/inventarios/avios/existencias', ['inventario-avios.ver']],
      ['compras', '/compras/ordenes', ['compras.ver']],
      ['costos', '/costos', ['costos.ver', 'precostos.consultar']],
      ['edr', '/edr', ['edr.ver', 'edr.capturar']],
      ['esma', '/esma', ['esma.ver-pagos', 'esma.cargo-validar', 'esma.modificar']],
      ['g-rc-config', '/ruta-critica/procesos-responsables', ['rc.catalogo-ver']],
      [
        'administracion',
        '/administracion',
        [
          'usuarios.administrar',
          'roles.administrar',
          'empresas.administrar',
          'almacenes.administrar',
          // El hub /administracion tiene una tarjeta Bitácora (solo `admin.ver-bitacora`): entra a
          // la unión para que los roles con solo ese permiso conserven su vía por menú.
          'admin.ver-bitacora',
        ],
      ],
    ];
    for (const [clave, ruta, gate] of casos) {
      const hoja = hojaRiel(clave);
      expect(hoja, clave).toBeDefined();
      expect(hoja?.ruta, clave).toBe(ruta);
      expect(hoja?.permisos, clave).toEqual(gate);
    }
  });

  it('cada colapsar-HUB aparece a EXACTAMENTE quien veía el padre (gate ⊇ unión de hijos)', () => {
    // Invariante clave: si el destino es un HUB que auto-filtra sus tarjetas, el gate de la hoja
    // directa DEBE ser superconjunto de la unión de permisos de las tarjetas hijas — así la entrada
    // aparece a TODOS los que veían el padre antes (sin regresión de menú) y el hub muestra solo lo
    // accesible. Las 4 hojas de Inventarios NO entran aquí: apuntan a una PANTALLA ESPECÍFICA
    // (Existencias), no a un hub, y gatean por el permiso de esa pantalla a propósito (ver el test
    // anterior); esa excepción la ratificó el reviewer.
    const HUBS = ['costos', 'edr', 'indicadores', 'esma', 'g-rc-config', 'administracion'];
    const hojaRiel = (clave: string): ModuloMenu | undefined => {
      const entrada = RIEL_GRUPOS.flatMap((g) => g.entradas).find((e) => e.clave === clave);
      return entrada !== undefined && entrada.hijos === undefined ? entrada : undefined;
    };
    for (const clave of HUBS) {
      const padre = GRUPOS_MENU.flatMap((g) => g.entradas).find((e) => e.clave === clave);
      expect(padre?.hijos, `${clave} debe ser padre en el catálogo`).toBeDefined();
      const union = new Set<ClavePermiso>();
      for (const hijo of padre?.hijos ?? []) {
        if (hijo.permisos !== 'autenticado') {
          for (const p of hijo.permisos) union.add(p);
        }
      }
      const hoja = hojaRiel(clave);
      expect(hoja, clave).toBeDefined();
      const gate = hoja?.permisos;
      expect(gate, `${clave}: la hoja colapsada no debe ser 'autenticado'`).not.toBe('autenticado');
      const gateSet = new Set(gate === undefined || gate === 'autenticado' ? [] : gate);
      for (const p of union) {
        expect(
          gateSet.has(p),
          `${clave}: el gate del riel debe incluir "${p}" (una tarjeta hija del hub lo exige)`,
        ).toBe(true);
      }
    }
  });

  it('lo legado sale del RIEL pero sigue en el CATÁLOGO (⌘K no pierde nada)', () => {
    const clavesRiel = new Set(hojasDe(RIEL_GRUPOS));
    const clavesCatalogo = new Set(hojasDe(filtrarCatalogoVisible(todosLosPermisos())));
    // Muestra representativa de lo que R2–R4 sacó del riel (corte/envíos/recibos/WIP, el
    // concentrado, galerías, catálogos de referencia, sub-vistas de compras/costos/edr/esma).
    for (const clave of [
      'corte',
      'envios',
      'recibos',
      'entregas',
      'wip',
      'rc-concentrado',
      'galeria-modelos',
      'bordados',
      'etiquetas-marca',
      'calidad-defectos',
      'inventario-movimientos',
      // 'catalogo-telas' ya NO está aquí: en A2 entró al riel como hijo del padre «Telas»
      // (pedido de Daniel, 6-ago-2026 — el catálogo tenía que verse en el menú).
      'ordenes-compra',
      'costos-margenes',
      'edr-por-anio',
      'esma-pagos',
    ]) {
      expect(clavesRiel.has(clave), `${clave} NO debe estar en el riel`).toBe(false);
      expect(clavesCatalogo.has(clave), `${clave} SÍ debe estar en ⌘K`).toBe(true);
    }
  });

  it('filtrarGruposVisibles poda por permiso (riel) y elimina padres/grupos vacios', () => {
    const grupos = filtrarGruposVisibles(permisos());
    const porClave = new Map(grupos.map((g) => [g.clave, g]));

    // FINANZAS: sin permisos, el grupo entero desaparece — CxC (gate `cxc.ver`, F9-E4), CxP (gate
    // `cxp.ver`, F9-E2) y EsMa (gate) están todos gateados; no queda ninguna hoja "autenticado".
    expect(porClave.get('finanzas')).toBeUndefined();
    // INVENTARIOS: las 3 hojas colapsadas tienen gate y desaparecen; el padre «Telas» (A2)
    // SOBREVIVE con su único hijo "autenticado" — el Catálogo de telas (pedido de Daniel: que
    // siempre se vea en el menú, como los demás catálogos de uso general).
    const inventarios = porClave.get('inventarios');
    expect(inventarios?.entradas.map((e) => e.clave)).toEqual(['telas']);
    expect(inventarios?.entradas[0]?.hijos?.map((h) => h.clave)).toEqual(['catalogo-telas']);
    // OPERACIÓN: sin permisos ya no sobrevive nada — Auditores ahora exige `calidad.ver` (antes era
    // "autenticado" y mantenía viva a Calidad/Operación); las dos hojas de Calidad quedan gateadas.
    expect(porClave.get('operacion')).toBeUndefined();
    // SISTEMA: Catálogos base pierde "Tipos de proceso" (permiso propio); las 2 hojas directas
    // (Procesos y responsables, Usuarios y accesos) desaparecen.
    const sistema = porClave.get('sistema');
    expect(sistema?.entradas.map((e) => e.clave)).toEqual(['catalogos']);
    const catalogos = sistema?.entradas.find((e) => e.clave === 'catalogos');
    expect(catalogos?.hijos?.map((h) => h.clave)).toEqual([
      'colores',
      'tallas',
      'temporadas',
      'almacenes',
    ]);
  });

  it('con todos los permisos, el riel muestra la estructura completa de Daniel', () => {
    const grupos = filtrarGruposVisibles(todosLosPermisos());
    expect(grupos.map((g) => g.titulo)).toEqual(RIEL_ESPERADO.map((g) => g.titulo));
    grupos.forEach((grupo, i) => {
      expect(grupo.entradas.map((e) => e.clave)).toEqual(
        RIEL_ESPERADO[i]?.entradas.map((e) => e.clave),
      );
    });
  });
});

describe('tituloPorRuta (breadcrumb de la topbar)', () => {
  it('resuelve la raíz, rutas exactas y rutas de detalle (prefijo)', () => {
    expect(tituloPorRuta('/')).toBe('Resumen');
    expect(tituloPorRuta('/pedidos')).toBe('Pedidos');
    // Una ruta de detalle hereda el título de su lista.
    expect(tituloPorRuta('/modelos/123')).toBe('Modelos');
  });

  it('gana la hoja MÁS específica cuando hay rutas anidadas', () => {
    // `/produccion/notas-salida/consulta` es hoja propia; no debe caer en "Notas de salida".
    expect(tituloPorRuta('/produccion/notas-salida')).toBe('Notas de salida');
    expect(tituloPorRuta('/produccion/notas-salida/consulta')).toBe('Consulta de notas');
  });

  it('devuelve undefined para rutas fuera del catálogo (la raíz "/" NO es prefijo de todo)', () => {
    expect(tituloPorRuta('/no-existe')).toBeUndefined();
  });

  it('las PORTADAS-HUB (que no son hoja) pintan su título en vez de dejar el breadcrumb vacío', () => {
    // Bug 9-jul-2026: en los hubs la topbar decía solo «Control v2».
    expect(tituloPorRuta('/costos')).toBe('Costos');
    expect(tituloPorRuta('/edr')).toBe('Estado de Resultados');
    expect(tituloPorRuta('/indicadores')).toBe('Indicadores');
    expect(tituloPorRuta('/inventarios')).toBe('Inventarios');
    expect(tituloPorRuta('/calidad')).toBe('Calidad');
    expect(tituloPorRuta('/esma')).toBe('EsMa');
    expect(tituloPorRuta('/catalogos')).toBe('Catálogos');
    // Rutas legadas de la página comodín: presentan al padre.
    expect(tituloPorRuta('/produccion')).toBe('Producción');
  });

  it('una hoja del catálogo SIEMPRE le gana a la portada (la portada es solo fallback)', () => {
    // `/administracion` SÍ tiene hoja propia; no cae en el mapa de portadas.
    expect(tituloPorRuta('/administracion')).toBe('Panel de administración');
    // `/inventarios/existencias` es hoja propia; no debe caer en "Inventarios".
    expect(tituloPorRuta('/inventarios/existencias')).not.toBe('Inventarios');
    // Una sub-ruta del hub SIN hoja propia hereda el título de la portada.
    expect(tituloPorRuta('/costos/orden/123')).toBeDefined();
  });
});
