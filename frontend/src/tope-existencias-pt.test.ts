import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TOPE_EXISTENCIAS_PT } from './modulos/inventarios/tope-existencias';

/**
 * ⭐ LAS PANTALLAS DE CAPTURA NO PUEDEN PEDIR UN `limite` QUE LA API YA NO ACEPTE (fila 0.143).
 *
 * {@link TOPE_EXISTENCIAS_PT} es un ESPEJO, igual que `DIAS_VENTANA_CAPTURA_PT` en
 * `ventana-fecha-pt.test.ts`: el techo de verdad vive en el backend
 * (`TOPE_RENGLONES_EXISTENCIAS_PT`) y no se puede importar desde aquí — son dos paquetes distintos,
 * sin workspace. Lo único que los dos lados comparten es **el contrato**, así que ése es el sitio
 * contra el que se cruza.
 *
 * **Por qué el espejo importa aquí más que en otros sitios:** Movimientos y Traspasos mandan
 * `limite` en TODAS sus consultas (piden el techo porque necesitan la lista completa de órdenes de
 * un modelo, no una ventana — el porqué está en `modulos/inventarios/tope-existencias.ts`). Si el
 * backend bajara su techo y este número no, **cada carga de las dos pantallas se contestaría con un
 * 400**: no un caso raro, todas. Ruidoso, sí, pero llegaría a `prueba` sin que nadie lo midiera.
 *
 * La cadena queda cerrada de punta a punta:
 *   constante del dominio → (`tope-existencias-honesto.test.ts`) → `.max()` del contrato →
 *   `openapi.json` → (esta prueba) → espejo de las pantallas.
 *
 * Vive en la raíz de `src/` y en `tsconfig.node.json` (no en el de la app) porque lee un archivo
 * REAL con `node:fs`, igual que `ventana-fecha-pt.test.ts` y `abreviatura-e2e.test.ts`.
 *
 * ⚠️ Si algo no se encuentra o no parsea, **truena**: un candado que no halla qué comparar tiene
 * que ponerse ROJO, jamás verde por omisión.
 */

/** Sube desde el cwd hasta toparse con `PLANMAESTRO.md`, el marcador estable de la raíz. */
function raizDelRepo(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, 'PLANMAESTRO.md'))) return dir;
    const padre = dirname(dir);
    if (padre === dir) break;
    dir = padre;
  }
  throw new Error('No se encontró la raíz del repo (PLANMAESTRO.md)');
}

/** Forma mínima del OpenAPI que aquí interesa (el archivo entero es generado y enorme). */
interface ContratoMinimo {
  paths?: Record<
    string,
    { get?: { parameters?: { name?: string; in?: string; schema?: { maximum?: number } }[] } }
  >;
}

const RUTA_EXISTENCIAS = '/api/inventarios/pt/existencias';

/** El `maximum` del `limite` tal como el backend lo publica (lo que lee cualquier cliente). */
function topePublicado(): number {
  const ruta = join(raizDelRepo(), 'frontend', 'openapi.json');
  if (!existsSync(ruta)) {
    throw new Error(`No encontré ${ruta}: es el contrato generado (npm run gen:api).`);
  }
  const contrato = JSON.parse(readFileSync(ruta, 'utf8')) as ContratoMinimo;
  const parametros = contrato.paths?.[RUTA_EXISTENCIAS]?.get?.parameters;
  if (parametros === undefined) {
    throw new Error(`El contrato no describe GET ${RUTA_EXISTENCIAS}. ¿Se renombró la ruta?`);
  }
  const limite = parametros.find((p) => p.name === 'limite' && p.in === 'query');
  const maximo = limite?.schema?.maximum;
  if (maximo === undefined) {
    throw new Error(
      `GET ${RUTA_EXISTENCIAS} ya no publica un \`limite\` con \`maximum\`. Si el tope desapareció ` +
        'del contrato, estas pantallas están pidiendo algo que la API no ofrece: hay que cruzar el ' +
        'espejo contra otra cosa, no borrar esta prueba.',
    );
  }
  return maximo;
}

describe('el `limite` de las pantallas de captura es el que publica el contrato (fila 0.143)', () => {
  it('⭐ el espejo del frontend coincide con el `maximum` publicado del querystring', () => {
    expect(TOPE_EXISTENCIAS_PT).toBe(topePublicado());
  });

  it('y ese techo es un entero positivo (un techo de 0 o negativo sería un 400 en cada carga)', () => {
    expect(Number.isInteger(TOPE_EXISTENCIAS_PT)).toBe(true);
    expect(TOPE_EXISTENCIAS_PT).toBeGreaterThan(0);
  });
});
