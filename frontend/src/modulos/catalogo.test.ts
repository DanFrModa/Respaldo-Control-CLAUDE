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

  it('define 104 hojas y 15 padres con claves unicas (padres incluidos)', () => {
    // El catálogo completo NO cambia con la poda del riel: sigue conteniendo TODAS las pantallas
    // (105 hojas + 15 padres; +4 en A2: ajuste/traspaso por color y las vistas legadas por lote
    // de existencias y salida a orden; +1 en B1: entradas de tela por factura; +1 en §Post-F9.26:
    // el archivo histórico de órdenes; +1 en §Post-F9.28: el directorio histórico de terceros;
    // −3 en V1-E3a: se RETIRARON «Captura de corte», «Envío a maquila» y «Recibo de maquila», las
    // tres pantallas del mismo acto que ya vive en el panel de avance — una sola pantalla por acto,
    // §Post-F9.36 punto 2); −1 en V1-E3d: el CATÁLOGO de arte desapareció —el arte vive dentro
    // del modelo (§Post-F9.35)— y solo sobrevive su galería. Lo que cambia es SOLO qué se ve en
    // el riel.
    expect(MODULOS_MENU).toHaveLength(104);
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
    expect(primerHijo('compras')).toBe('ordenes-compra');
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
    // el gate del hub Catálogos (telas, avíos, clientes, proveedores, colores,
    // tallas, temporadas, almacenes, etiquetas de marca) y la «Próximamente» Documental.
    // (CxC ya NO: es pantalla real gateada por `cxc.ver`, F9-E4. Auditores tampoco: `calidad.ver`, R9.
    // Ventas tampoco: es pantalla real gateada por `edr.ver`, F9.)
    // Los 10 catálogos de uso general siguen "autenticado" aunque el backend exija su
    // `<catálogo>.ver`: el desajuste es de la FAMILIA COMPLETA y se arregla parejo o no se arregla
    // (pedido de Daniel en A2: que siempre se vean). Deuda anotada en `HOJA-DE-RUTA.md` §4.
    expect(visibles.map((m) => m.clave).sort()).toEqual(
      [
        'almacenes',
        'catalogo-avios',
        'catalogo-telas',
        'clientes-catalogo',
        'colores',
        'documental',
        'etiquetas-marca',
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
      // Los catálogos que vivían bajo el hub Catálogos conservan su gate "autenticado" — TODA la
      // familia, incluidos telas y avíos ya dentro del riel (pedido de Daniel en A2: que se vean
      // siempre, «como los demás catálogos de uso general»). Que el backend exija su
      // `<catálogo>.ver` es una deuda de la familia entera, anotada en `HOJA-DE-RUTA.md` §4.
      ['clientes-catalogo', 'autenticado'],
      ['proveedores', 'autenticado'],
      ['colores', 'autenticado'],
      ['etiquetas-marca', 'autenticado'],
      ['catalogo-telas', 'autenticado'],
      ['catalogo-avios', 'autenticado'],
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

  it('busca por clave: hojas, padres (ruta legada /compras) e inexistentes', () => {
    expect(buscarModuloPorClave('rc-procesos-responsables')?.titulo).toBe(
      'Procesos y responsables',
    );
    // Los padres se encuentran porque /compras sigue cayendo en la página comodín (no tiene
    // pantalla propia) y esta debe poder presentarlo. (`/produccion` ya tiene portada-hub desde
    // V1-E3a, pero su padre debe seguir siendo localizable por clave.)
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
        {
          // V1-E3a (13-ago-2026): Producción DESTAPADA. Tenía 2 hijos de 17 y el resto no tenía
          // ENTRADA EN EL MENÚ — lo mismo que ya se destapó en Compras/Inventario PT/Telas/Avíos.
          // Hijos curados: el Centro de Órdenes (desde su panel de avance se capturan corte, envío
          // y recibo), la ENTREGA A CLIENTE (que antes no la enlazaba NADA), los dos tableros de la
          // operación diaria, la consulta de órdenes (por su impresión EN LOTE, ver abajo) y las
          // notas de salida. Las consultas restantes —archivo histórico, corte/recibos semanales,
          // incompletas, pedidos por mes y las dos de notas— siguen en ⌘K y en la portada-hub
          // `/produccion`.
          clave: 'produccion',
          padre: true,
          hijos: [
            'ordenes',
            'entregas',
            'wip',
            'existencias-maquilero',
            // +«Consulta de órdenes» (decisión del lead, V1-E3a): NO es una consulta duplicada —
            // es la única pantalla que IMPRIME ÓRDENES EN LOTE (el Centro imprime de a una), así
            // que esa capacidad no puede vivir solo en ⌘K.
            'consulta-ordenes',
            'notas-salida',
          ],
        },
        { clave: 'ruta-critica', padre: false },
        // V1-E3a: Calidad pasó de PADRE (con 2 de sus 7 hijos) a HOJA COLAPSADA a su hub. Como
        // padre, `PadreNav` no navega → defectos, tipos de producto, planes AQL y auditorías por
        // maquilero eran INALCANZABLES desde toda la app y `/calidad` no la enlazaba nadie.
        { clave: 'calidad', padre: false },
      ],
    },
    {
      titulo: 'Inventarios',
      entradas: [
        {
          // Daniel, 12-ago-2026 («destapa las cosas de una vez»): Inventario PT pasó a
          // DESPLEGABLE con sus CUATRO hijos (todos los que tiene el padre en el catálogo).
          clave: 'inventarios',
          padre: true,
          hijos: [
            'inventario-existencias',
            'inventario-movimientos',
            'inventario-traspasos',
            'inventario-kardex',
          ],
        },
        {
          // A2 (Daniel, 6-ago-2026): Telas pasó a DESPLEGABLE para que el catálogo de telas se
          // vea en el menú. Hijos: los flujos vigentes POR COLOR primero; solo las vistas por
          // lote LEGADAS (existencias y salida a orden) siguen por ⌘K.
          clave: 'telas',
          padre: true,
          hijos: [
            'inventario-telas-existencias',
            'catalogo-telas',
            // +1 en B1: la entrada por factura/remisión (la otra puerta del inventario de telas).
            'inventario-telas-entradas',
            'inventario-telas-salida-orden',
            'inventario-telas-ajuste',
            // +1 el 12-ago-2026: el traspaso POR COLOR («El traspaso se hace por color. No siempre
            // hay un lote completo para traspasar», Daniel — `DECISIONES.md §Post-F9.32`). El de
            // lote ya no opera —graba `id_tela_color = NULL` y `existencia_tela_color` lo excluye—,
            // así que ofrecer solo aquél mandaba al usuario a un flujo que no mueve las
            // existencias que ve arriba.
            'inventario-telas-traspaso',
            // +2 el 12-ago-2026: las vistas de «materiales» que sirven a las DOS dimensiones (tela
            // por lote Y avío), AL FINAL. Cuelgan del padre «Telas» en el catálogo y el riel solo
            // admite hijos del MISMO padre, así que no pueden ir bajo Avíos. Eran TRES: el ajuste
            // se volvió solo-avíos y se mudó a «Avíos» el 13-ago-2026.
            'inventario-materiales-kardex',
            'inventario-materiales-traspasos',
          ],
        },
        {
          // Daniel, 12-ago-2026: Avíos pasó a DESPLEGABLE — como hoja colapsada, el «Catálogo de
          // avíos» no tenía ENTRADA EN EL MENÚ (mismo defecto que el catálogo de telas en A2).
          // +1 el 13-ago-2026: «Ajuste de avíos» (antes «Ajuste de materiales», bajo Telas): al
          // dejar de tocar tela, bajo Telas se escondía justo de quien la busca.
          clave: 'avios',
          padre: true,
          hijos: [
            'inventario-avios-existencias',
            'catalogo-avios',
            'inventario-materiales-ajustes',
          ],
        },
        {
          // Daniel, 11-ago-2026: Compras pasó a DESPLEGABLE — como hoja colapsada, Recepción /
          // Estatus / Explosión no tenían ENTRADA EN EL MENÚ ni enlace estable (solo ⌘K/URL; la
          // Recepción, además, el deep-link condicional de Mis pendientes de RC). Hijos
          // curados: órdenes de compra (principal) + recepción + semáforo + explosión; la
          // autorización y «compras por orden» siguen por ⌘K.
          clave: 'compras',
          padre: true,
          hijos: [
            'ordenes-compra',
            'recepcion-compras',
            'estatus-materiales',
            'explosion-materiales',
          ],
        },
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

  it('el riel tiene 8 padres y marca SOLO la Ruta Crítica como destacada', () => {
    const padres = RIEL_GRUPOS.flatMap((g) => g.entradas.filter((e) => e.hijos !== undefined));
    expect(padres.map((p) => p.clave)).toEqual([
      'g-desarrollo',
      'produccion',
      // 'calidad' ya NO es padre: en V1-E3a pasó a hoja colapsada a su hub (`PadreNav` no navega y
      // sus 5 hijos restantes eran inalcanzables desde toda la app).
      'inventarios', // 12-ago-2026: desplegable (Movimientos/Traspasos/Kardex PT sin entrada de menú)
      'telas', // A2: desplegable (el catálogo de telas tenía que verse en el menú)
      'avios', // 12-ago-2026: desplegable (el catálogo de avíos tampoco tenía entrada de menú)
      'compras', // 11-ago-2026: desplegable (Recepción/Estatus/Explosión no tenían enlace alguno)
      'clientes',
      'catalogos',
    ]);
    const destacadas = RIEL_GRUPOS.flatMap((g) => g.entradas).filter((e) => e.destacado);
    expect(destacadas).toHaveLength(1);
    expect(destacadas[0]?.clave).toBe('ruta-critica');
  });

  it('«Compras» es desplegable y lleva a Recepción de compras (Daniel, 11-ago-2026)', () => {
    // Regresión del defecto reportado por Daniel: con Compras como hoja colapsada a
    // /compras/ordenes, las pantallas de Recepción, Estatus y Explosión de materiales no tenían
    // ENTRADA EN EL MENÚ ni enlace estable — solo ⌘K/URL (la Recepción tenía además el deep-link
    // condicional de «Registrar» en Mis pendientes de RC). El riel debe desplegarlas.
    const compras = RIEL_GRUPOS.flatMap((g) => g.entradas).find((e) => e.clave === 'compras');
    expect(compras?.hijos, 'Compras debe ser padre desplegable en el riel').toBeDefined();
    const recepcion = compras?.hijos?.find((h) => h.clave === 'recepcion-compras');
    expect(recepcion, 'Recepción de compras debe estar en el riel').toBeDefined();
    expect(recepcion?.ruta).toBe('/compras/recepcion');
    expect(recepcion?.permisos).toEqual(['compras.recibir']); // gate heredado del catálogo (A4)
    // Las otras dos pantallas huérfanas también entran, con su ruta real.
    const porClave = new Map(compras?.hijos?.map((h) => [h.clave, h.ruta]));
    expect(porClave.get('estatus-materiales')).toBe('/compras/estatus-materiales');
    expect(porClave.get('explosion-materiales')).toBe('/compras/explosion');
  });

  it('«Inventario PT» y «Avíos» son desplegables y ninguna entrada del grupo queda colapsada (12-ago-2026)', () => {
    // Regresión del tercer reporte de Daniel («destapa las cosas de una vez, para no dejar
    // pendientes»): como hojas colapsadas, Movimientos/Traspasos/Kardex PT y el Catálogo de avíos
    // no tenían ENTRADA EN EL MENÚ (los tres primeros sí tenían enlace desde Existencias PT
    // —pestañas y botón «Kardex»—; el catálogo de avíos, solo la tarjeta del hub /catalogos, que
    // tampoco es entrada del riel).
    const entradaRiel = (clave: string) =>
      RIEL_GRUPOS.flatMap((g) => g.entradas).find((e) => e.clave === clave);

    const pt = entradaRiel('inventarios');
    expect(pt?.hijos, 'Inventario PT debe ser padre desplegable en el riel').toBeDefined();
    expect(pt?.hijos?.map((h) => [h.clave, h.ruta])).toEqual([
      ['inventario-existencias', '/inventarios/existencias'],
      ['inventario-movimientos', '/inventarios/movimientos'],
      ['inventario-traspasos', '/inventarios/traspasos'],
      ['inventario-kardex', '/inventarios/kardex'],
    ]);
    // Gates HEREDADOS del catálogo, sin ensancharlos (A4).
    expect(pt?.hijos?.map((h) => h.permisos)).toEqual([
      ['inventario-pt.ver'],
      ['inventario-pt.mover'],
      ['inventario-pt.mover'],
      ['inventario-pt.ver'],
    ]);

    const avios = entradaRiel('avios');
    expect(avios?.hijos, 'Avíos debe ser padre desplegable en el riel').toBeDefined();
    // +«Ajuste de avíos» el 13-ago-2026: la pantalla dejó de tocar tela, así que su lugar es este
    // padre. Bajo «Telas» (donde vivía como «Ajuste de materiales») se escondía de quien la busca.
    expect(avios?.hijos?.map((h) => [h.clave, h.ruta])).toEqual([
      ['inventario-avios-existencias', '/inventarios/avios/existencias'],
      ['catalogo-avios', '/catalogos/avios'],
      ['inventario-materiales-ajustes', '/inventarios/materiales/ajustes'],
    ]);
    // Gates HEREDADOS del catálogo, sin ensancharlos ni estrecharlos: el catálogo de avíos sigue
    // "autenticado" como toda su familia (deuda de paridad front/back en `HOJA-DE-RUTA.md` §4).
    expect(avios?.hijos?.map((h) => h.permisos)).toEqual([
      ['inventario-avios.ver'],
      'autenticado',
      ['inventario-avios.mover'],
    ]);

    // Las vistas de «materiales» que sirven a las DOS dimensiones (tela por lote Y avío) cuelgan
    // del padre «Telas» en el catálogo y el riel solo admite hijos del MISMO padre: por eso van ahí
    // y no bajo Avíos. El AJUSTE ya no está entre ellas (es solo-avíos y se mudó a «Avíos»).
    const telas = entradaRiel('telas');
    const clavesTelas = telas?.hijos?.map((h) => h.clave) ?? [];
    for (const clave of ['inventario-materiales-kardex', 'inventario-materiales-traspasos']) {
      expect(clavesTelas, clave).toContain(clave);
    }
    expect(clavesTelas, 'el ajuste de avíos ya NO cuelga de Telas').not.toContain(
      'inventario-materiales-ajustes',
    );
    // …y el traspaso POR COLOR —el flujo VIGENTE de telas— tiene que estar, o el menú sólo ofrecería
    // el de lote, que graba `id_tela_color = NULL` y por tanto no mueve «Existencias de telas»
    // (vista `existencia_tela_color`). Daniel: «El traspaso se hace por color» (§Post-F9.32).
    expect(clavesTelas, 'el traspaso por color debe estar en el riel').toContain(
      'inventario-telas-traspaso',
    );

    // Ninguna de las 4 entradas del grupo Inventarios navega ya: todas despliegan.
    const grupo = RIEL_GRUPOS.find((g) => g.clave === 'inventarios');
    expect(grupo?.entradas.map((e) => e.clave)).toEqual([
      'inventarios',
      'telas',
      'avios',
      'compras',
    ]);
    for (const entrada of grupo?.entradas ?? []) {
      expect(entrada.hijos, `${entrada.clave} debe ser desplegable`).toBeDefined();
    }
  });

  it('«Producción» destapa la captura diaria y la ENTREGA A CLIENTE (V1-E3a)', () => {
    // Regresión del hallazgo B5/B1 del diagnóstico del 13-ago-2026: el padre «Producción» mostraba
    // 2 de sus 17 sub-vistas y las otras 15 no tenían ENTRADA EN EL MENÚ. La peor consecuencia era
    // B1: la ENTREGA A CLIENTE —el cierre del ciclo— existía, funcionaba y NO LA ENLAZABA NADA (ni
    // el riel, ni el panel de avance, ni el tablero WIP), así que el producto entraba a PT y no
    // salía nunca.
    const produccion = RIEL_GRUPOS.flatMap((g) => g.entradas).find((e) => e.clave === 'produccion');
    expect(produccion?.hijos, 'Producción debe seguir siendo padre desplegable').toBeDefined();
    expect(produccion?.hijos?.map((h) => [h.clave, h.ruta])).toEqual([
      ['ordenes', '/produccion/ordenes'],
      ['entregas', '/produccion/entregas'],
      ['wip', '/produccion/wip'],
      ['existencias-maquilero', '/produccion/existencias-maquilero'],
      // La impresión EN LOTE de órdenes solo existe aquí: es capacidad propia, no consulta duplicada.
      ['consulta-ordenes', '/produccion/consulta'],
      ['notas-salida', '/produccion/notas-salida'],
    ]);
    // Gates HEREDADOS del catálogo, sin ensancharlos (A4).
    expect(produccion?.hijos?.map((h) => h.permisos)).toEqual([
      ['ordenes.ver'],
      ['produccion.entrega'],
      ['produccion.wip-ver'],
      ['produccion.wip-ver'],
      ['ordenes.ver'],
      ['notas.ver'],
    ]);
    // Las TRES pantallas del mismo acto se retiraron del catálogo entero (una sola pantalla por
    // acto, §Post-F9.36 punto 2): ni riel, ni ⌘K, ni hub — el corte/envío/recibo se capturan en el
    // panel de avance del Centro de Órdenes.
    for (const clave of ['corte', 'envios', 'recibos']) {
      expect(
        buscarModuloPorClave(clave),
        `${clave} debe estar retirado del catálogo`,
      ).toBeUndefined();
    }
  });

  it('«Calidad» navega a su hub: sus 7 tarjetas dejan de ser inalcanzables (V1-E3a)', () => {
    // Regresión del hallazgo B6: en el riel «Calidad» era PADRE con solo 2 hijos y `PadreNav` NO
    // NAVEGA (es un `<button>` que solo expande) → defectos, tipos de producto, planes AQL y
    // auditorías por maquilero eran inalcanzables desde TODA la app, y `CalidadPagina` —que tiene
    // las 7 tarjetas— no la enlazaba nadie.
    const calidad = RIEL_GRUPOS.flatMap((g) => g.entradas).find((e) => e.clave === 'calidad');
    expect(
      calidad?.hijos,
      'Calidad ya NO debe ser desplegable (su padre no navegaba)',
    ).toBeUndefined();
    expect(calidad?.hijos === undefined ? calidad?.ruta : undefined).toBe('/calidad');
    // Y las hojas que estaban atrapadas siguen en el catálogo (⌘K) y en las tarjetas del hub.
    for (const clave of [
      'calidad-defectos',
      'calidad-tipos-producto',
      'calidad-planes-aql',
      'calidad-historial-maquilero',
    ]) {
      expect(buscarModuloPorClave(clave), clave).toBeDefined();
    }
  });

  it('las hojas colapsadas navegan a su pantalla principal con el gate correcto', () => {
    const hojaRiel = (clave: string): ModuloMenu | undefined => {
      const entrada = RIEL_GRUPOS.flatMap((g) => g.entradas).find((e) => e.clave === clave);
      // `hijos === undefined` estrecha EntradaMenu → ModuloMenu (tiene `ruta`/`permisos`).
      return entrada !== undefined && entrada.hijos === undefined ? entrada : undefined;
    };
    const casos: ReadonlyArray<[string, string, readonly ClavePermiso[]]> = [
      // El grupo Inventarios ya NO tiene ninguna hoja colapsada: «telas» pasó a padre desplegable
      // en A2, «compras» el 11-ago-2026 y «inventarios» (PT) + «avios» el 12-ago-2026 (Daniel:
      // «destapa las cosas de una vez»). Ver el test del riel y el de regresión de más abajo.
      // V1-E3a: Calidad al hub que YA tenía las 7 tarjetas, con la unión de los permisos de sus
      // hijos (el patrón de Costos/EDR/Indicadores/EsMa/Administración).
      ['calidad', '/calidad', ['calidad.ver', 'calidad.generar-auditorias']],
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
    // accesible. El grupo Inventarios ya no aporta ninguna hoja colapsada (sus 4 entradas son
    // desplegables desde el 12-ago-2026), así que la lista son puros hubs.
    const HUBS = [
      // +'calidad' en V1-E3a: es el caso que MOTIVÓ el arreglo (sus 4 catálogos eran inalcanzables).
      'calidad',
      'costos',
      'edr',
      'indicadores',
      'esma',
      'g-rc-config',
      'administracion',
    ];
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
    // Muestra representativa de lo que R2–R4 sacó del riel (el concentrado, galerías, catálogos de
    // referencia, sub-vistas de compras/costos/edr/esma).
    //
    // 'corte' / 'envios' / 'recibos' ya NO están aquí: en V1-E3a se retiraron del CATÁLOGO entero
    // (una sola pantalla por acto). Y 'entregas' / 'wip' tampoco: ese mismo día ENTRARON al riel
    // como hijos del padre «Producción» — la entrega a cliente no la enlazaba nada.
    for (const clave of [
      // Consultas de Producción que siguen fuera del riel (vivas por ⌘K y en el hub /produccion).
      // 'consulta-ordenes' ya NO está aquí: entró al riel por su impresión EN LOTE.
      'ordenes-incompletas',
      'corte-semanal',
      'recibos-semanales',
      'archivo-ordenes',
      'rc-concentrado',
      'galeria-modelos',
      // La GALERÍA de arte (V1-E3d): sigue fuera del riel, viva por ⌘K y en el hub.
      'galeria-arte',
      'etiquetas-marca',
      'calidad-defectos',
      // 'inventario-movimientos' ya NO está aquí: el 12-ago-2026 entró al riel como hijo del
      // padre «Inventario PT» (junto con traspasos y kardex). Tampoco 'inventario-telas-traspaso':
      // ese mismo día entró como hijo de «Telas», porque es el flujo VIGENTE (por color) y el riel
      // no puede ofrecer únicamente el de lote, que ya no mueve existencias. Lo que SÍ sigue fuera
      // del riel en Inventarios son las dos vistas LEGADAS de telas por lote:
      'inventario-telas-existencias-lote',
      'inventario-telas-salida-orden-lote',
      // 'catalogo-telas' ya NO está aquí: en A2 entró al riel como hijo del padre «Telas»
      // (pedido de Daniel, 6-ago-2026 — el catálogo tenía que verse en el menú).
      // 'catalogo-avios' tampoco: el 12-ago-2026 entró como hijo del padre «Avíos».
      // 'ordenes-compra' tampoco: el 11-ago-2026 entró al riel como hijo del padre «Compras»
      // (junto con recepción/estatus/explosión). Lo que sigue fuera del riel en Compras:
      'compras-por-orden',
      'autorizacion-compras',
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
    // INVENTARIOS: sin permisos desaparecen el padre «Inventario PT» (sus 4 hijos están gateados
    // por `inventario-pt.*`) y el padre «Compras» (sus 4 hijos, por `compras.ver`/`compras.recibir`),
    // porque un padre sin hijos visibles no se pinta. SOBREVIVEN «Telas» (A2) y «Avíos»
    // (12-ago-2026), cada uno con su único hijo "autenticado": el catálogo — es el pedido de
    // Daniel, que los catálogos de uso general siempre se vean en el menú.
    const inventarios = porClave.get('inventarios');
    expect(inventarios?.entradas.map((e) => e.clave)).toEqual(['telas', 'avios']);
    expect(inventarios?.entradas[0]?.hijos?.map((h) => h.clave)).toEqual(['catalogo-telas']);
    expect(inventarios?.entradas[1]?.hijos?.map((h) => h.clave)).toEqual(['catalogo-avios']);
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
