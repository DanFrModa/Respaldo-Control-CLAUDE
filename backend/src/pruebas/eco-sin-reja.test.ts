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
  // ⭐ Las tres formas de esconder el eco que el reviewer de la fila 0.199 midió. Van en el fixture
  // porque un arreglo sin prueba vuelve a nacer — es la misma lección del `forEachChild`.
  escribir(
    'src/dominio/consultas.ts',
    `import { verificarPermiso, type SesionUsuario } from '../comun/permisos.js';

export async function obtenerConAlias(sesion: SesionUsuario, id: number): Promise<number> {
  verificarPermiso(sesion, 'alias.ver');
  return id;
}

export async function obtenerEnLote(sesion: SesionUsuario, id: number): Promise<number> {
  verificarPermiso(sesion, 'lote.ver');
  return id;
}

export async function obtenerPorBarril(sesion: SesionUsuario, id: number): Promise<number> {
  verificarPermiso(sesion, 'barril.ver');
  return id;
}

export async function obtenerDosSaltos(sesion: SesionUsuario, id: number): Promise<number> {
  verificarPermiso(sesion, 'dossaltos.ver');
  return id;
}

export async function obtenerAnidado(sesion: SesionUsuario, id: number): Promise<number> {
  verificarPermiso(sesion, 'anidado.ver');
  return id;
}

export async function obtenerEnvuelto(sesion: SesionUsuario, id: number): Promise<number> {
  verificarPermiso(sesion, 'envoltorio.ver');
  return id;
}

export async function obtenerCrudo(sesion: SesionUsuario, id: number): Promise<number> {
  verificarPermiso(sesion, 'crudo.ver');
  return id;
}
`,
  );
  escribir(
    'src/dominio/barril.ts',
    `export { obtenerPorBarril } from './consultas.js';
export { obtenerDosSaltos as reexportado } from './consultas.js';
`,
  );
  escribir(
    'src/dominio/barril2.ts',
    `export { reexportado } from './barril.js';
`,
  );
  // El envoltorio transaccional que NO se llama `enTransaccion`: su callback ES el cuerpo de una
  // transacción, y por eso lo que pase dentro NO es «escribir y luego negar» (el ROLLBACK cubre).
  // Es el caso real de `produccion/receta-orden.ts:1799` (`enRecetaEditable`), con sus 10 llamadores.
  escribir(
    'src/dominio/envoltorio.ts',
    `import { verificarPermiso, type SesionUsuario } from '../comun/permisos.js';
import { enTransaccion, type ContextoBd } from '../comun/transaccion.js';

import { obtenerEnvuelto } from './consultas.js';

export async function enCosaEditable<T>(
  sesion: SesionUsuario,
  accion: () => Promise<T>,
  bd?: ContextoBd,
): Promise<T> {
  verificarPermiso(sesion, 'envoltorio.administrar');
  return enTransaccion(async () => accion(), bd);
}

/** BIEN: la consulta con reja vive DENTRO de la transacción del envoltorio ⇒ no se reporta. */
export async function mutarConEnvoltorio(sesion: SesionUsuario, bd?: ContextoBd): Promise<number> {
  return enCosaEditable(sesion, async () => obtenerEnvuelto(sesion, 1), bd);
}
`,
  );
  escribir(
    'src/dominio/escondites.ts',
    `import { type SesionUsuario, verificarPermiso } from '../comun/permisos.js';
import { enTransaccion, type ContextoBd } from '../comun/transaccion.js';

import {
  obtenerAnidado,
  obtenerConAlias as leer,
  obtenerCrudo,
  obtenerEnLote,
} from './consultas.js';
import { obtenerPorBarril as porBarril } from './barril.js';
import { reexportado as porDosSaltos } from './barril2.js';

/** MAL, con ALIAS: el eco va por un nombre distinto del de la consulta. */
export async function crearConAlias(sesion: SesionUsuario, bd?: ContextoBd): Promise<number> {
  verificarPermiso(sesion, 'alias.administrar');
  const id = await enTransaccion(async () => 1, bd);
  return leer(sesion, id);
}

/** MAL, en un CIERRE después del commit: el 403 llega con el dato ya guardado. */
export async function crearEnLote(sesion: SesionUsuario, bd?: ContextoBd): Promise<number[]> {
  verificarPermiso(sesion, 'lote.administrar');
  const ids = await enTransaccion(async () => [1, 2], bd);
  return Promise.all(ids.map(async (id) => obtenerEnLote(sesion, id)));
}

/** MAL, por BARRIL: la consulta se re-exporta desde otro archivo. */
export async function crearPorBarril(sesion: SesionUsuario, bd?: ContextoBd): Promise<number> {
  verificarPermiso(sesion, 'barril.administrar');
  const id = await enTransaccion(async () => 1, bd);
  return porBarril(sesion, id);
}

/** MAL, por barril de DOS saltos y con alias en el re-export. */
export async function crearPorDosSaltos(sesion: SesionUsuario, bd?: ContextoBd): Promise<number> {
  verificarPermiso(sesion, 'dossaltos.administrar');
  const id = await enTransaccion(async () => 1, bd);
  return porDosSaltos(sesion, id);
}

/** MAL, en un cierre anidado a DOS niveles después del commit. */
export async function crearAnidado(sesion: SesionUsuario, bd?: ContextoBd): Promise<number[][]> {
  verificarPermiso(sesion, 'anidado.administrar');
  const grupos = await enTransaccion(async () => [[1, 2]], bd);
  return Promise.all(
    grupos.map(async (g) => Promise.all(g.map(async (id) => obtenerAnidado(sesion, id)))),
  );
}

/** MAL, reja A PELO dentro de un CIERRE posterior al commit (sonda s1 de la 3ª ronda). */
export async function crearRejaEnCierre(
  sesion: SesionUsuario,
  bd?: ContextoBd,
): Promise<number[]> {
  verificarPermiso(sesion, 'cierre.administrar');
  const ids = await enTransaccion(async () => [1, 2], bd);
  return Promise.all(
    ids.map(async (id) => {
      verificarPermiso(sesion, 'cierre.ver');
      return id;
    }),
  );
}

/** MAL, cuya ÚNICA escritura es SQL CRUDO: no es una llamada, es una plantilla etiquetada. */
export async function crearConSqlCrudo(sesion: SesionUsuario, tx: any, id: number): Promise<number> {
  verificarPermiso(sesion, 'crudo.administrar');
  await tx.$executeRaw\`UPDATE "cosa" SET "x" = 1\`;
  return obtenerCrudo(sesion, id);
}

/** BIEN: un $executeRaw que sólo serializa (advisory lock) NO es una escritura. */
export async function soloSerializa(sesion: SesionUsuario, tx: any, id: number): Promise<number> {
  verificarPermiso(sesion, 'crudo.administrar');
  await tx.$executeRaw\`SELECT pg_advisory_xact_lock(1, 2)\`;
  return obtenerCrudo(sesion, id);
}

/** MAL, con la reja escrita A PELO después del commit: la forma más literal del defecto. */
export async function crearConRejaDirecta(
  sesion: SesionUsuario,
  bd?: ContextoBd,
): Promise<number> {
  verificarPermiso(sesion, 'directa.administrar');
  const id = await enTransaccion(async () => 1, bd);
  verificarPermiso(sesion, 'directa.ver');
  return id;
}
`,
  );
  escribir(
    'src/api/escondites.rutas.ts',
    `import {
  crearAnidado,
  crearConAlias,
  crearConRejaDirecta,
  crearConSqlCrudo,
  crearEnLote,
  crearPorBarril,
  crearPorDosSaltos,
  crearRejaEnCierre,
  soloSerializa,
} from '../dominio/escondites.js';
import { mutarConEnvoltorio } from '../dominio/envoltorio.js';

export function registrarEscondites(app: any): void {
  app.route({
    method: 'POST',
    url: '/alias',
    preHandler: app.conPermiso('alias.administrar'),
    handler: async (request: any) => crearConAlias(request.sesion),
  });
  app.route({
    method: 'POST',
    url: '/lote',
    preHandler: app.conPermiso('lote.administrar'),
    handler: async (request: any) => crearEnLote(request.sesion),
  });
  app.route({
    method: 'POST',
    url: '/barril',
    preHandler: app.conPermiso('barril.administrar'),
    handler: async (request: any) => crearPorBarril(request.sesion),
  });
  app.route({
    method: 'POST',
    url: '/dos-saltos',
    preHandler: app.conPermiso('dossaltos.administrar'),
    handler: async (request: any) => crearPorDosSaltos(request.sesion),
  });
  app.route({
    method: 'POST',
    url: '/anidado',
    preHandler: app.conPermiso('anidado.administrar'),
    handler: async (request: any) => crearAnidado(request.sesion),
  });
  app.route({
    method: 'POST',
    url: '/reja-directa',
    preHandler: app.conPermiso('directa.administrar'),
    handler: async (request: any) => crearConRejaDirecta(request.sesion),
  });
  app.route({
    method: 'POST',
    url: '/envoltorio',
    preHandler: app.conPermiso('envoltorio.administrar'),
    handler: async (request: any) => mutarConEnvoltorio(request.sesion),
  });
  app.route({
    method: 'POST',
    url: '/reja-en-cierre',
    preHandler: app.conPermiso('cierre.administrar'),
    handler: async (request: any) => crearRejaEnCierre(request.sesion),
  });
  app.route({
    method: 'POST',
    url: '/sql-crudo',
    preHandler: app.conPermiso('crudo.administrar'),
    handler: async (request: any) => crearConSqlCrudo(request.sesion, null, 1),
  });
  app.route({
    method: 'POST',
    url: '/solo-serializa',
    preHandler: app.conPermiso('crudo.administrar'),
    handler: async (request: any) => soloSerializa(request.sesion, null, 1),
  });
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

    // Sale el defectuoso a la vista Y las tres formas de esconderlo; NO sale ninguno de los
    // correctos (el de `proyectarX` ni el que pasa por la puerta OR).
    expect(hallazgos.map((h) => `${h.funcion}->${h.llamada}`).sort()).toEqual([
      'crearAnidado->obtenerAnidado',
      'crearConAlias->obtenerConAlias',
      'crearConRejaDirecta->verificarPermiso',
      'crearConSqlCrudo->obtenerCrudo',
      'crearCosa->obtenerCosa',
      'crearEnLote->obtenerEnLote',
      'crearPorBarril->obtenerPorBarril',
      'crearPorDosSaltos->obtenerDosSaltos',
      'crearRejaEnCierre->verificarPermiso',
    ]);
    // Y `soloSerializa` NO está: su `$executeRaw` es un advisory lock, que no escribe nada. Tomarlo
    // por escritura pondría en rojo lecturas que sólo se serializan (39 así en el dominio).
    expect(hallazgos.map((h) => h.funcion)).not.toContain('soloSerializa');
    // ⭐ Y `mutarConEnvoltorio` NO está: su consulta con reja vive dentro de la transacción de un
    // envoltorio que no se llama `enTransaccion` (el caso de `enRecetaEditable`, 10 llamadores
    // reales). Reportarla sería poner el CI en rojo sobre código correcto.
    expect(hallazgos.map((h) => h.funcion)).not.toContain('mutarConEnvoltorio');
    const unico = hallazgos.find((h) => h.funcion === 'crearCosa');
    expect(unico?.archivo).toBe('src/dominio/mal.ts');
    expect(unico?.faltante).toEqual(['cosas.ver']);
    expect(unico?.garantizados).toContain('cosas.administrar');
    expect(unico?.rutas.join(' ')).toContain('POST /cosas');

    // Y cada escondite se nombra por el permiso que pide de más, no por uno genérico.
    const porFuncion = new Map(hallazgos.map((h) => [h.funcion, h] as const));
    expect(porFuncion.get('crearConAlias')?.faltante).toEqual(['alias.ver']);
    expect(porFuncion.get('crearEnLote')?.faltante).toEqual(['lote.ver']);
    expect(porFuncion.get('crearPorBarril')?.faltante).toEqual(['barril.ver']);
    expect(porFuncion.get('crearPorDosSaltos')?.faltante).toEqual(['dossaltos.ver']);
    expect(porFuncion.get('crearAnidado')?.faltante).toEqual(['anidado.ver']);
    // La reja a pelo se marca aparte, porque su arreglo NO es partir nada en `proyectarX`.
    expect(porFuncion.get('crearConRejaDirecta')?.faltante).toEqual(['directa.ver']);
    expect(porFuncion.get('crearConRejaDirecta')?.directa).toBe(true);
    expect(porFuncion.get('crearCosa')?.directa).toBe(false);
    expect(porFuncion.get('crearRejaEnCierre')?.faltante).toEqual(['cierre.ver']);
    expect(porFuncion.get('crearRejaEnCierre')?.directa).toBe(true);
    expect(porFuncion.get('crearConSqlCrudo')?.faltante).toEqual(['crudo.ver']);

    // Y el informe explica el arreglo por su nombre, no sólo el síntoma.
    const texto = (): string =>
      informe({
        hallazgos,
        excepcionesPodridas: [],
        rutasAnalizadas: 14,
        funcionesIndexadas: 30,
        exoneradas: 1,
      });
    expect(texto()).toContain('proyectarX');
    expect(texto()).toContain('src/dominio/mal.ts');
    // Y la reja a pelo se explica DISTINTO: ahí no hay nada que partir en `proyectarX`.
    expect(texto()).toContain('MOVERLA delante de la escritura');
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
    // Y la cota que de verdad dice que la red MIDE los caminos difíciles en vez de callarse: los
    // sitios que recorre y exonera (43 el 16-sep-2026 — los 22 del `preHandler` encadenado, los 13
    // de las tres puertas OR y 8 más). Si esto se desploma, la red dejó de recorrerlos.
    expect(resultado.exoneradas).toBeGreaterThan(30);
  });
});
