import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { analizar, informe, type Resultado } from './eco-sin-reja.js';

/**
 * ⭐⭐ LA RED DE «ESCRIBIR Y LUEGO NEGAR», ENGANCHADA AL CI (fila 0.199).
 *
 * El analizador vive en `eco-sin-reja.ts` (ahí está la explicación larga del defecto, del modelo de
 * permisos y de lo que NO cubre). Esta prueba es lo que hace que **no dependa de que nadie se
 * acuerde de correrlo**: está en el proyecto `unit`, que corre en el job `backend` del CI, que es
 * bloqueante. Mismo criterio que `frontend/src/documentos.test.ts` con el cruce de documentos.
 *
 * Son TRES pruebas y las tres hacen falta:
 *
 *  1. **La red mide algo** (fixture sintético). Un repositorio de juguete con el patrón defectuoso,
 *     el patrón correcto y una puerta OR. Sin esto, cualquier avería del analizador se vería como
 *     «todo limpio» — que es exactamente lo que pasó durante el desarrollo de esta fila: un callback
 *     de `ts.forEachChild` que devolvía un valor truthy cortaba el recorrido en el primer hijo, y la
 *     red daba **cero hallazgos sobre el árbol de ANTES de los 48 arreglos**. Un verde que no mide
 *     nada es peor que un rojo.
 *  2. **El dominio real está limpio**: cero sitios. Si esta prueba se pone roja, el mensaje trae qué
 *     función, en qué archivo, qué permiso cobra y cuál pide de más, y la receta del arreglo.
 *  3. **Las canarios de tamaño**: si el índice se queda corto (una carpeta que se mueve, un patrón
 *     de rutas que cambia), la prueba 2 saldría verde por no haber mirado nada. Estas cotas —muy por
 *     debajo de lo medido el 16-sep-2026: 667 rutas y 2 909 funciones— cazan ese fallo silencioso.
 */

/** Sube desde el cwd hasta la carpeta `backend/` (la que tiene `src/dominio`). */
function raizBackend(): string {
  let directorio = process.cwd();
  for (;;) {
    if (existsSync(join(directorio, 'src', 'dominio'))) return directorio;
    const padre = dirname(directorio);
    if (padre === directorio) {
      throw new Error(`No encontré la raíz de backend/ subiendo desde ${process.cwd()}`);
    }
    directorio = padre;
  }
}

// ── 1 · La red mide algo ────────────────────────────────────────────────────────────────────────

const temporal = mkdtempSync(join(tmpdir(), 'eco-sin-reja-'));

function escribir(ruta: string, contenido: string): void {
  const completa = join(temporal, ruta);
  mkdirSync(dirname(completa), { recursive: true });
  writeFileSync(completa, contenido, 'utf8');
}

/**
 * Repositorio de juguete con los tres casos que importan: el defectuoso (debe salir), el arreglado
 * con `proyectarX` (no debe salir) y el de la puerta OR (no debe salir **aunque** la consulta pida
 * un permiso que el escritor no trae, porque la puerta deja pasar al que escribe).
 */
function montarFixture(): void {
  escribir(
    'src/comun/permisos.ts',
    `export interface SesionUsuario { permisos: Set<string> }
export function tienePermiso(sesion: SesionUsuario, clave: string): boolean {
  return sesion.permisos.has(clave);
}
export function verificarPermiso(sesion: SesionUsuario, clave: string): void {
  if (!sesion.permisos.has(clave)) throw new Error(clave);
}
`,
  );
  escribir(
    'src/comun/transaccion.ts',
    `export async function enTransaccion<T>(fn: () => Promise<T>): Promise<T> { return fn(); }
`,
  );
  escribir(
    'src/dominio/mal.ts',
    `import { verificarPermiso, type SesionUsuario } from '../comun/permisos.js';
import { enTransaccion } from '../comun/transaccion.js';

export async function obtenerCosa(sesion: SesionUsuario, id: number): Promise<number> {
  verificarPermiso(sesion, 'cosas.ver');
  return id;
}

export async function crearCosa(sesion: SesionUsuario): Promise<number> {
  verificarPermiso(sesion, 'cosas.administrar');
  const id = await enTransaccion(async () => 1);
  return obtenerCosa(sesion, id);
}
`,
  );
  escribir(
    'src/dominio/bien.ts',
    `import { verificarPermiso, type SesionUsuario } from '../comun/permisos.js';
import { enTransaccion } from '../comun/transaccion.js';

export async function proyectarOtra(sesion: SesionUsuario, id: number): Promise<number> {
  return id + (sesion.permisos.size > 0 ? 0 : 0);
}

export async function obtenerOtra(sesion: SesionUsuario, id: number): Promise<number> {
  verificarPermiso(sesion, 'otras.ver');
  return proyectarOtra(sesion, id);
}

export async function crearOtra(sesion: SesionUsuario): Promise<number> {
  verificarPermiso(sesion, 'otras.administrar');
  const id = await enTransaccion(async () => 2);
  return proyectarOtra(sesion, id);
}
`,
  );
  escribir(
    'src/dominio/puerta.ts',
    `import { tienePermiso, verificarPermiso, type SesionUsuario } from '../comun/permisos.js';
import { enTransaccion } from '../comun/transaccion.js';

export function exigirVerPuerta(sesion: SesionUsuario): void {
  if (tienePermiso(sesion, 'puerta.armar')) return;
  verificarPermiso(sesion, 'puerta.ver');
}

export async function obtenerPuerta(sesion: SesionUsuario, id: number): Promise<number> {
  exigirVerPuerta(sesion);
  return id;
}

export async function armarPuerta(sesion: SesionUsuario): Promise<number> {
  verificarPermiso(sesion, 'puerta.armar');
  const id = await enTransaccion(async () => 3);
  return obtenerPuerta(sesion, id);
}
`,
  );
  escribir(
    'src/api/juguete.rutas.ts',
    `import { crearCosa } from '../dominio/mal.js';
import { crearOtra } from '../dominio/bien.js';
import { armarPuerta } from '../dominio/puerta.js';

export function registrar(app: any): void {
  app.route({
    method: 'POST',
    url: '/cosas',
    preHandler: app.conPermiso('cosas.administrar'),
    handler: async (request: any) => crearCosa(request.sesion),
  });
  app.route({
    method: 'POST',
    url: '/otras',
    preHandler: app.conPermiso('otras.administrar'),
    handler: async (request: any) => crearOtra(request.sesion),
  });
  app.route({
    method: 'POST',
    url: '/puertas',
    preHandler: app.conPermiso('puerta.armar'),
    handler: async (request: any) => armarPuerta(request.sesion),
  });
}
`,
  );
}

afterAll(() => {
  rmSync(temporal, { recursive: true, force: true });
});

describe('la red de «escribir y luego negar» mide algo', () => {
  it('caza el patrón defectuoso y deja pasar el correcto y la puerta OR', () => {
    montarFixture();
    const { hallazgos } = analizar(temporal);

    // El defectuoso sale, con su función, su llamada y el permiso que pide de más.
    expect(hallazgos.map((h) => `${h.funcion}->${h.llamada}`)).toEqual(['crearCosa->obtenerCosa']);
    const unico = hallazgos[0];
    expect(unico?.archivo).toBe('src/dominio/mal.ts');
    expect(unico?.faltante).toEqual(['cosas.ver']);
    expect(unico?.garantizados).toContain('cosas.administrar');
    expect(unico?.rutas.join(' ')).toContain('POST /cosas');

    // Y el informe explica el arreglo por su nombre, no sólo el síntoma.
    const texto = informe({
      hallazgos,
      excepcionesPodridas: [],
      rutasAnalizadas: 3,
      funcionesIndexadas: 9,
    });
    expect(texto).toContain('proyectarX');
    expect(texto).toContain('src/dominio/mal.ts');
  });
});

// ── 2 y 3 · El dominio real ─────────────────────────────────────────────────────────────────────

describe('el dominio real no escribe y luego niega', () => {
  const resultado: Resultado = analizar(raizBackend());

  it('no hay ningún sitio que escriba y después pida un permiso que quien escribe no trae', () => {
    expect(informe(resultado)).toBe('');
    expect(resultado.hallazgos).toEqual([]);
  });

  it('no hay excepciones declaradas que ya no correspondan a ningún sitio real', () => {
    // Una lista de excepciones que nadie limpia acaba tapando defectos nuevos: si una entrada sobra,
    // el CI lo dice el mismo día, no seis meses después.
    expect(resultado.excepcionesPodridas).toEqual([]);
  });

  it('el análisis recorrió el repositorio entero (canario contra un verde vacío)', () => {
    // Medido el 16-sep-2026: 667 rutas y 2 909 funciones. Las cotas van holgadas por debajo: sólo
    // cazan que el índice se quede CORTO (una carpeta que se mueve, un patrón de rutas que cambia),
    // que es como una avería del analizador se disfrazaría de «todo limpio».
    expect(resultado.rutasAnalizadas).toBeGreaterThan(400);
    expect(resultado.funcionesIndexadas).toBeGreaterThan(2000);
  });
});
