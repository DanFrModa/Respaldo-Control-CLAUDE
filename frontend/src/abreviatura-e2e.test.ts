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
 * Todos los `pattern` que el contrato declara para un campo `abreviatura`, mirando el JSON entero
 * (el esquema va EMBEBIDO en el cuerpo de la petición, no en `components/schemas`).
 */
function patronesDeAbreviatura(): string[] {
  const ruta = join(raizDelRepo(), 'frontend', 'openapi.json');
  const contrato: unknown = JSON.parse(readFileSync(ruta, 'utf8'));
  const encontrados: string[] = [];

  const recorrer = (nodo: unknown): void => {
    if (Array.isArray(nodo)) {
      nodo.forEach(recorrer);
      return;
    }
    if (typeof nodo !== 'object' || nodo === null) {
      return;
    }
    const obj = nodo as Record<string, unknown>;
    const props = obj.properties;
    if (typeof props === 'object' && props !== null) {
      const abrev = (props as Record<string, unknown>).abreviatura;
      if (typeof abrev === 'object' && abrev !== null) {
        const patron = (abrev as Record<string, unknown>).pattern;
        if (typeof patron === 'string') {
          encontrados.push(patron);
        }
      }
    }
    Object.values(obj).forEach(recorrer);
  };

  recorrer(contrato);
  return encontrados;
}

describe('la abreviatura que fabrica el e2e cumple el contrato REAL', () => {
  it('el contrato declara un patrón para la abreviatura (si no, esta prueba no probaría nada)', () => {
    // Guarda contra el fallo silencioso: si el campo se renombra o el pattern desaparece, la
    // búsqueda devolvería [] y todo lo de abajo pasaría en vacío. Eso sería peor que un rojo.
    const patrones = patronesDeAbreviatura();
    expect(patrones.length).toBeGreaterThan(0);
    // Alta y edición declaran la MISMA regla: si divergen, el e2e podría pasar el alta y romper
    // la edición (o al revés).
    expect(new Set(patrones).size).toBe(1);
  });

  it('⭐ lo que genera el e2e PASA el patrón del contrato, en muchos instantes distintos', () => {
    const patron = patronesDeAbreviatura()[0] ?? '';
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
