import { describe, expect, it } from 'vitest';

// El CÓDIGO FUENTE de App.tsx como texto (import `?raw` de Vite): la prueba de
// deriva lee las rutas REALES del archivo, no una copia que se quedaría atrás.
import fuenteApp from '@/App.tsx?raw';

import type { ClavePermiso } from '@/api/tipos';
import {
  declaracionDeRuta,
  esRutaComodin,
  exigenciaDeRuta,
  MODULOS_MENU,
  RUTAS_HUB,
  rutaPermitida,
} from '@/modulos/catalogo';

/**
 * LA CAPA DE RUTA (V1-E6b · `DECISIONES.md §Post-F9.68`).
 *
 * Dos cosas se prueban aquí:
 *
 *  1. Que el resolvedor de permisos por ruta hace lo que dice: hereda del padre,
 *     el literal le gana al `:param`, la portada `/` no es prefijo de todo.
 *  2. **La prueba de DERIVA**: recorre las rutas REALES de `App.tsx` y exige que
 *     TODAS resuelvan a una declaración. Sin esto, una pantalla nueva entraría
 *     sin gate y nadie lo notaría — que es exactamente como el agujero de esta
 *     etapa nació.
 */

/** Rutas de `App.tsx` leídas de su código fuente (la fuente real, no una copia). */
function rutasDeApp(): readonly string[] {
  return [...fuenteApp.matchAll(/\{\s*path: '([^']+)'/g)].flatMap((coincidencia) =>
    coincidencia[1] === undefined ? [] : [coincidencia[1]],
  );
}

/** Normaliza una ruta de `App.tsx` (son relativas, sin `/` inicial) a pathname. */
function comoPathname(ruta: string): `/${string}` {
  return (ruta.startsWith('/') ? ruta : `/${ruta}`) as `/${string}`;
}

function permisosDe(...claves: string[]): ReadonlySet<ClavePermiso> {
  return new Set(claves as ClavePermiso[]);
}

describe('exigenciaDeRuta', () => {
  it('toma el permiso de la hoja del catálogo', () => {
    expect(exigenciaDeRuta('/costos/costeo')).toEqual(['costos.ver']);
    expect(exigenciaDeRuta('/inventarios/movimientos')).toEqual(['inventario-pt.mover']);
  });

  it('una sub-pantalla hereda el gate de su pantalla padre', () => {
    // `/inventarios/telas/entradas/nueva` no se declara: hereda de `…/entradas`.
    expect(exigenciaDeRuta('/inventarios/telas/entradas/nueva')).toEqual(['inventario-telas.ver']);
    expect(exigenciaDeRuta('/inventarios/telas/entradas/7/editar')).toEqual([
      'inventario-telas.ver',
    ]);
    expect(exigenciaDeRuta('/calidad/auditorias/42')).toEqual(['calidad.ver']);
  });

  /**
   * ⭐ V1-E3j — LA RECETA DE LA ORDEN cuelga de `/produccion/ordenes` (que es `ordenes.ver`) pero su
   * permiso es OTRO: `desarrollo.ver`. Sin su línea propia heredaría del padre y quedaría mal por
   * los DOS lados a la vez — abierta a quien solo mira producción y CERRADA al usuario de Desarrollo
   * puro, que es justamente quien viene a firmarla (§Post-F9.72). La prueba de deriva de abajo NO
   * lo vería: la ruta "tiene declaración", solo que la equivocada.
   */
  it('⭐ la receta de la orden pide `desarrollo.ver`, NO el `ordenes.ver` de su padre', () => {
    expect(exigenciaDeRuta('/produccion/ordenes/50/receta')).toEqual(['desarrollo.ver']);
    expect(exigenciaDeRuta('/produccion/ordenes')).toEqual(['ordenes.ver']);
    // La pareja completa: Desarrollo puro entra; quien solo ve producción, no.
    expect(rutaPermitida('/produccion/ordenes/50/receta', permisosDe('desarrollo.ver'))).toBe(true);
    expect(rutaPermitida('/produccion/ordenes/50/receta', permisosDe('ordenes.ver'))).toBe(false);
  });

  it('gana la declaración MÁS específica, no la primera que coincide', () => {
    // `/calidad/auditorias/nueva` es hoja propia y le gana a `/calidad/auditorias`.
    expect(exigenciaDeRuta('/calidad/auditorias/nueva')).toEqual(['calidad.generar-auditorias']);
    // El literal `programar` le gana al `:idOrden` de la ruta de consulta.
    expect(exigenciaDeRuta('/ruta-critica/ordenes/9')).toEqual(['rc.ruta-ver']);
    expect(exigenciaDeRuta('/ruta-critica/ordenes/9/programar')).toEqual(['rc.programar']);
  });

  it('la portada `/` NO es prefijo de todo (si lo fuera, el gate se apagaría solo)', () => {
    expect(exigenciaDeRuta('/')).toBe('autenticado');
    expect(exigenciaDeRuta('/ruta-inventada-que-no-existe')).toBeUndefined();
  });
});

describe('rutaPermitida', () => {
  it('cierra la pantalla sin el permiso y la abre con él (la pareja completa)', () => {
    expect(rutaPermitida('/costos/costeo', permisosDe())).toBe(false);
    expect(rutaPermitida('/costos/costeo', permisosDe('costos.ver'))).toBe(true);
  });

  it('basta UNA de las claves declaradas', () => {
    expect(rutaPermitida('/indicadores/productividad/captura', permisosDe())).toBe(false);
    expect(
      rutaPermitida(
        '/indicadores/productividad/captura',
        permisosDe('indicadores.ip-productividad'),
      ),
    ).toBe(true);
    expect(
      rutaPermitida(
        '/indicadores/productividad/captura',
        permisosDe('indicadores.almacen-productividad'),
      ),
    ).toBe(true);
  });

  // ⭐ V1-E3t (hallazgo del reviewer, D3) — el AND (`{ todos }`) en LA CAPA DE RUTA.
  //
  // `catalogo.test.ts` ya afirmaba el AND del MENÚ (`esModuloVisible`), pero el menú y la ruta son
  // funciones distintas: degradando `cumpleExigencia` a un OR, el suite entero seguía verde y quien
  // tecleara `/indicadores/ruta-critica` con sólo `indicadores.ver` ABRÍA la pantalla y se comía un
  // 403 — la puerta rota que §Post-F9.68 manda matar, y en la capa que existe justo para eso.
  //
  // 🔴 El valor que pone ROJA la línea clave es `true`: es lo que devuelve un OR con una sola de
  // las dos llaves. Por eso se afirman las DOS direcciones (sólo `indicadores.ver` y sólo
  // `rc.ruta-ver`) y también el caso positivo — con una sola de las tres, un OR o un AND roto
  // pasarían por buenos.
  it('exige TODAS las claves cuando la ruta declara `{ todos }` (KPIs de RC)', () => {
    expect(rutaPermitida('/indicadores/ruta-critica', permisosDe())).toBe(false);
    expect(rutaPermitida('/indicadores/ruta-critica', permisosDe('indicadores.ver'))).toBe(false);
    expect(rutaPermitida('/indicadores/ruta-critica', permisosDe('rc.ruta-ver'))).toBe(false);
    expect(
      rutaPermitida('/indicadores/ruta-critica', permisosDe('indicadores.ver', 'rc.ruta-ver')),
    ).toBe(true);
  });

  it('una ruta sin declaración NO se cierra (la capa es de presentación, A4)', () => {
    expect(rutaPermitida('/ruta-inventada-que-no-existe', permisosDe())).toBe(true);
  });
});

describe('deriva: toda ruta de App.tsx declara su permiso', () => {
  const rutas = rutasDeApp().filter((ruta) => ruta !== '/login' && !esRutaComodin(ruta));

  it('lee las rutas reales de App.tsx (si esto falla, el regex se quedó atrás)', () => {
    expect(rutas.length).toBeGreaterThan(100);
  });

  it('NINGUNA ruta se quedó sin declaración', () => {
    const sinGate = rutas.filter((ruta) => exigenciaDeRuta(comoPathname(ruta)) === undefined);
    expect(sinGate).toEqual([]);
  });

  /**
   * TERCERA ASERCIÓN (hallazgo ALTA del reviewer, 18-ago-2026). Las otras dos
   * cubren *sin declaración* y *abierta por herencia*, pero son CIEGAS a un
   * tercer hueco: **gateada DE MÁS por herencia**.
   *
   * Una PORTADA-HUB se abre con la UNIÓN de los permisos de sus tarjetas —para
   * que quien tenga una sola aterrice ahí y vea esa tarjeta—. Esa unión es
   * correcta para el hub y VENENOSA hacia abajo: heredada, abre cada pantalla
   * hija a cualquiera que tenga el permiso de OTRA. Pasó de verdad: las cinco
   * pantallas de Administración heredaban de `/administracion` y un usuario de
   * pura bitácora entraba a Usuarios, Roles y Empresas. Esas rutas se veían
   * perfectamente "gateadas" y pasaban las dos aserciones de arriba.
   *
   * La regla: ninguna ruta puede resolver contra un HUB que no sea ella misma.
   */
  /**
   * ⭐ V1-E3t (hallazgo del reviewer, D5) — CUARTA aserción: una ruta con exigencia `{ todos }` (AND)
   * no puede llegar DEGRADADA a un OR.
   *
   * Si esa ruta se declarara dos veces, `unirExigencias` tendría que fusionar un AND con un OR —algo
   * que el tipo no sabe expresar—. Antes lo resolvía a la callada devolviendo la lista de claves, y
   * con eso **el tablero de la RC reabría con sólo `indicadores.ver` estando el módulo apagado**.
   * Ahora lanza, y esta aserción lo fija por el lado del resultado: lo que se resuelve debe seguir
   * siendo el MISMO `{ todos }` que se declaró.
   *
   * 🔴 El valor que la pone roja es el array degradado `['indicadores.ver','rc.ruta-ver']` en vez de
   * `{ todos: [...] }` (y una declaración duplicada la pone roja aún antes, al lanzar).
   */
  it('una ruta con exigencia `{ todos }` NO se degrada a OR al resolverse', () => {
    const conAnd = MODULOS_MENU.filter(
      (m): m is typeof m & { permisos: { todos: readonly ClavePermiso[] } } =>
        typeof m.permisos === 'object' && !Array.isArray(m.permisos) && 'todos' in m.permisos,
    );
    // Hoy hay exactamente una (los KPIs de Ruta Crítica). Si llegara a cero, la prueba estaría
    // pasando en el vacío y hay que revisar por qué desapareció el AND.
    expect(conAnd.map((m) => m.ruta)).toEqual(['/indicadores/ruta-critica']);
    for (const modulo of conAnd) {
      expect(exigenciaDeRuta(modulo.ruta), modulo.ruta).toEqual(modulo.permisos);
    }
  });

  it('ninguna pantalla hereda el gate de una portada-hub (unión de tarjetas)', () => {
    const heredadas = rutas
      .map((ruta) => ({ ruta, origen: declaracionDeRuta(comoPathname(ruta))?.ruta }))
      .filter(
        ({ ruta, origen }) =>
          origen !== undefined && RUTAS_HUB.includes(origen) && comoPathname(ruta) !== origen,
      )
      .map(({ ruta, origen }) => `${ruta} ← ${String(origen)}`);
    expect(heredadas).toEqual([]);
  });

  /**
   * Regresión del hallazgo ALTA, medida como la midió el reviewer: con SOLO
   * `admin.ver-bitacora` se entra a la Bitácora y a NADA más de Administración.
   */
  it('un usuario de pura bitácora no entra a las otras pantallas de Administración', () => {
    const soloBitacora = permisosDe('admin.ver-bitacora');
    expect(rutaPermitida('/administracion/bitacora', soloBitacora)).toBe(true);
    // El HUB sí (aterriza con su única tarjeta) — la unión es correcta ahí.
    expect(rutaPermitida('/administracion', soloBitacora)).toBe(true);
    for (const hija of [
      '/administracion/usuarios',
      '/administracion/roles',
      '/administracion/empresas',
      '/administracion/conceptos-costo',
      '/administracion/estados-lista',
    ]) {
      expect(rutaPermitida(hija, soloBitacora)).toBe(false);
    }
    // Gemelas positivas: con SU permiso, cada una sí abre.
    expect(rutaPermitida('/administracion/usuarios', permisosDe('usuarios.administrar'))).toBe(
      true,
    );
    expect(rutaPermitida('/administracion/roles', permisosDe('roles.administrar'))).toBe(true);
    expect(rutaPermitida('/administracion/empresas', permisosDe('empresas.administrar'))).toBe(
      true,
    );
    expect(
      rutaPermitida('/administracion/conceptos-costo', permisosDe('concepto-costo.administrar')),
    ).toBe(true);
    expect(
      rutaPermitida('/administracion/estados-lista', permisosDe('estado-lista.administrar')),
    ).toBe(true);
  });

  /**
   * Las rutas que quedan en 'autenticado' son las que a propósito no gatean:
   * portadas-hub cuyas tarjetas se filtran solas, y redirecciones que no pintan
   * nada. La lista es EXACTA: si una pantalla nueva cae aquí por herencia (p.
   * ej. cualquier `/produccion/loquesea`), esta prueba se pone roja y obliga a
   * declararle su permiso en vez de dejarla abierta en silencio.
   */
  it('la lista de rutas SIN gate es exactamente la esperada', () => {
    const abiertas = rutas
      .filter((ruta) => exigenciaDeRuta(comoPathname(ruta)) === 'autenticado')
      .sort();
    expect(abiertas).toEqual(
      [
        'catalogos',
        'catalogos/almacenes',
        'catalogos/avios',
        'catalogos/clientes',
        'catalogos/colores',
        'catalogos/etiquetas-marca',
        'catalogos/proveedores',
        'catalogos/tallas',
        'catalogos/telas',
        'catalogos/temporadas',
        'inventarios',
        'produccion',
        'produccion/corte',
        'produccion/envios',
        'produccion/recibos',
        'ruta-critica',
        'ruta-critica/bandeja',
      ].sort(),
    );
  });
});
