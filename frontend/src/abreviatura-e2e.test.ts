import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { generarAbreviaturaCliente, LETRAS_ABREVIATURA } from '../e2e/abreviatura';

/**
 * EL CANDADO ENTRE EL GENERADOR DEL E2E Y EL CONTRATO DE VERDAD.
 *
 * Esta prueba nace de un CI en rojo. El e2e de pedidos fabricaba la abreviatura del cliente como
 * `E` + 5 caracteres en base 36 (`E4K7M2`): válido con la regla vieja (2–6, letras o dígitos) y
 * RECHAZADO por la nueva (3 letras A–Z, §Post-F9.112). El alta del cliente dejó de pasar y con
 * ella se cayó el flujo entero. Ni las pruebas unitarias ni dos revisores lo vieron, porque
 * ninguno recorre la pantalla de verdad; lo encontró el CI, que es justo su trabajo.
 *
 * ⚠️ **Contra qué se valida, y por qué así.** No contra un regex copiado aquí —una copia es lo
 * que hace que estas cosas se desincronicen en silencio, que es el defecto original otra vez—
 * sino contra el **`pattern` que viaja en `openapi.json`**, que se GENERA desde el Zod real de
 * `backend/src/contrato/esquemas/cliente.ts`. Si mañana Daniel cambia la regla, `npm run gen:api`
 * reescribe ese pattern y esta prueba se entera sola.
 *
 * ⚠️ **Y por qué NO se importa el Zod del backend directamente:** backend y frontend son paquetes
 * AUTÓNOMOS (CLAUDE.md §1) y lo único que comparten es el contrato OpenAPI (ADR-0002). Un import
 * cruzado ataría el typecheck de un lado al árbol del otro —y rompería el `docker build` del
 * backend, cuyo contexto es sólo `backend/`—. El OpenAPI es el canal que SÍ existe para esto.
 *
 * Vive en `tsconfig.node.json` (no en el de la app) porque lee un archivo REAL con `node:fs`,
 * igual que `version.test.ts` y `limite-cuerpo-api.test.ts`.
 */

/** Sube desde el cwd hasta toparse con `PLANMAESTRO.md`, el marcador estable de la raíz. */
function raizDelRepo(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, 'PLANMAESTRO.md'))) {
      return dir;
    }
    const padre = dirname(dir);
    if (padre === dir) {
      break;
    }
    dir = padre;
  }
  throw new Error('No se encontró la raíz del repo (PLANMAESTRO.md)');
}

/**
 * Los `pattern` de un esquema de campo, BAJANDO por los combinadores de JSON Schema.
 *
 * ⚠️ Hace falta bajar, y esto lo aprendió el reviewer rompiéndolo: los dos esquemas de ESCRITURA
 * NO tienen la misma forma. El alta declara el campo plano —`{type:'string', pattern}`— pero la
 * edición lo envuelve en `anyOf` porque `cliente.ts` le aplica `.nullable()` (poder VACIAR el dato
 * ya capturado, M1): `{anyOf:[{type:'string', pattern}, {type:'null'}]}`. Un colector que sólo
 * mirara la propiedad DIRECTA se saltaba el de edición sin decir nada, y entonces «alta y edición
 * declaran la misma regla» comparaba un conjunto de UN elemento contra sí mismo: una tautología
 * que no podía fallar. Con `{3}` en el alta y `{4}` en la edición, seguía verde.
 *
 * Baja SÓLO por `anyOf`/`oneOf`/`allOf` —los tres combinadores del estándar— y sólo lee `pattern`.
 * Nada de adivinar formas.
 */
function patronesDeEsquema(esquema: unknown): string[] {
  if (typeof esquema !== 'object' || esquema === null) {
    return [];
  }
  const obj = esquema as Record<string, unknown>;
  const encontrados: string[] = [];
  if (typeof obj.pattern === 'string') {
    encontrados.push(obj.pattern);
  }
  for (const combinador of ['anyOf', 'oneOf', 'allOf']) {
    const ramas = obj[combinador];
    if (Array.isArray(ramas)) {
      for (const rama of ramas) {
        encontrados.push(...patronesDeEsquema(rama));
      }
    }
  }
  return encontrados;
}

/**
 * Los `pattern` que el contrato declara para `abreviatura`, separados por LADO: lo que el cliente
 * MANDA (`requestBody`) y lo que el servidor DEVUELVE (`responses`).
 *
 * ⚠️ **La separación no es adorno, la obliga el dato.** El campo aparece 7 veces en el contrato:
 * 2 de escritura (alta y edición), que SÍ traen el patrón, y 5 de lectura (listado, alta-201,
 * detalle, edición-200 y baja), que NO traen ninguno — a propósito, porque la regla de 3 letras es
 * PROSPECTIVA (§Post-F9.112): aprieta la captura y NO puede apretar la lectura, o un cliente viejo
 * de otra longitud reventaría al listarse. Metidas en un solo saco, esas 5 ausencias se leerían
 * como una divergencia que no existe.
 */
function patronesDeAbreviatura(): { entrada: string[]; salida: string[] } {
  const ruta = join(raizDelRepo(), 'frontend', 'openapi.json');
  const contrato: unknown = JSON.parse(readFileSync(ruta, 'utf8'));
  const entrada: string[] = [];
  const salida: string[] = [];

  const recorrer = (nodo: unknown, destino: string[] | null): void => {
    if (Array.isArray(nodo)) {
      nodo.forEach((hijo) => {
        recorrer(hijo, destino);
      });
      return;
    }
    if (typeof nodo !== 'object' || nodo === null) {
      return;
    }
    const obj = nodo as Record<string, unknown>;
    const props = obj.properties;
    if (destino !== null && typeof props === 'object' && props !== null) {
      const abrev = (props as Record<string, unknown>).abreviatura;
      if (abrev !== undefined) {
        destino.push(...patronesDeEsquema(abrev));
      }
    }
    for (const [clave, valor] of Object.entries(obj)) {
      // A partir de aquí se sabe de qué lado va lo que cuelgue: lo que se manda o lo que se lee.
      const siguiente =
        clave === 'requestBody' ? entrada : clave === 'responses' ? salida : destino;
      recorrer(valor, siguiente);
    }
  };

  recorrer(contrato, null);
  return { entrada, salida };
}

describe('la abreviatura que fabrica el e2e cumple el contrato REAL', () => {
  it('el contrato declara un patrón de ENTRADA para la abreviatura (si no, esto no probaría nada)', () => {
    // Guarda contra el fallo silencioso: si el campo se renombra o el pattern desaparece, la
    // búsqueda devolvería [] y todo lo de abajo pasaría en vacío. Eso sería peor que un rojo.
    const { entrada } = patronesDeAbreviatura();
    expect(entrada.length).toBeGreaterThan(0);
  });

  it('⭐ el ALTA y la EDICIÓN declaran la MISMA regla', () => {
    // Si divergieran, el e2e podría pasar el alta y romper la edición (o al revés). Los dos
    // esquemas salen hoy del MISMO campo Zod (`camposContacto.abreviatura`), así que divergir es
    // estructuralmente difícil — pero «difícil» no es «comprobado», y esta aserción estuvo un
    // tiempo comparando un conjunto de un elemento consigo mismo (ver `patronesDeEsquema`).
    const { entrada } = patronesDeAbreviatura();
    expect(entrada.length).toBeGreaterThanOrEqual(2);
    expect(new Set(entrada).size).toBe(1);
  });

  it('⭐ la SALIDA no lleva patrón: la regla es PROSPECTIVA y no puede apretar la lectura', () => {
    // §Post-F9.112. Si la regla se colara a las respuestas, el PRIMER cliente viejo con otra
    // longitud reventaría al serializarse y se caería el catálogo entero — el listado valida la
    // respuesta como un todo, así que no sería un renglón, sería la pantalla. La misma garantía
    // está sujeta en el Zod (`backend/src/contrato/esquemas/cliente.test.ts`); aquí se sujeta en
    // el CONTRATO, que es lo que ven los clientes generados.
    const { salida } = patronesDeAbreviatura();
    expect(salida).toEqual([]);
  });

  it('⭐ lo que genera el e2e PASA el patrón del contrato, en muchos instantes distintos', () => {
    const patron = patronesDeAbreviatura().entrada[0] ?? '';
    const regla = new RegExp(patron, 'u');

    // No se prueba sólo «ahora»: si el generador fallara para ciertos milisegundos, correr una vez
    // sería una moneda al aire. Se barre un rango ancho, incluidos los bordes.
    const instantes = [0, 1, 25, 26, 675, 676, 17_575, 17_576, Date.now(), Date.now() + 12_345];
    for (let i = 0; i < 500; i += 1) {
      instantes.push(1_700_000_000_000 + i * 997);
    }

    for (const t of instantes) {
      const abreviatura = generarAbreviaturaCliente(t);
      expect(abreviatura, `instante ${String(t)} produjo "${abreviatura}"`).toMatch(regla);
      expect(abreviatura).toHaveLength(LETRAS_ABREVIATURA);
    }
  });

  it('no es una constante disfrazada: dos milisegundos seguidos dan abreviaturas distintas', () => {
    // Un generador que devolviera siempre 'AAA' pasaría el patrón y sería inútil: `@unique` lo
    // convertiría en un 409 en la segunda corrida.
    expect(generarAbreviaturaCliente(1_756_000_000_000)).not.toBe(
      generarAbreviaturaCliente(1_756_000_000_001),
    );
  });

  it('el ciclo se cierra a los 26³ ms — el margen que el comentario promete', () => {
    // La afirmación de «~17.6 s» del comentario, comprobada en vez de asumida.
    const t = 1_756_000_000_000;
    expect(generarAbreviaturaCliente(t + 17_576)).toBe(generarAbreviaturaCliente(t));
    expect(generarAbreviaturaCliente(t + 17_575)).not.toBe(generarAbreviaturaCliente(t));
  });
});
