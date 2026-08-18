import { describe, expect, it } from 'vitest';

// El CÓDIGO FUENTE de App.tsx como texto (import `?raw` de Vite): la prueba de
// deriva lee las rutas REALES del archivo, no una copia que se quedaría atrás.
import fuenteApp from '@/App.tsx?raw';

import type { ClavePermiso } from '@/api/tipos';
import { esRutaComodin, exigenciaDeRuta, rutaPermitida } from '@/modulos/catalogo';

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
