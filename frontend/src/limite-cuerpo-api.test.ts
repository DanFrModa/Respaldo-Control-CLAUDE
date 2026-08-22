import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * EL CANDADO CONTRA EL LÍMITE QUE MIENTE.
 *
 * El importador de OC del cliente manda VARIOS PDFs en base64 dentro del JSON, y el
 * backend sube el `bodyLimit` de esas rutas a 64 MiB (`LIMITE_CUERPO_IMPORTACION`).
 * Pero entre el navegador y el backend está **nginx**, y si su `location /api/` no
 * declara `client_max_body_size`, rige su default: **1 MB**.
 *
 * Ese es el defecto que reportó Daniel («Failed to fetch» al importar varios PDFs) y
 * lo que lo hace peligroso no es el número, es la **forma en que falla**: nginx corta
 * el cuerpo ANTES de que llegue al backend y cierra la conexión, así que el navegador
 * no recibe un 413 con cuerpo ni con cabeceras CORS — recibe nada. El `fetch` revienta
 * a nivel de red y la pantalla no tiene qué explicarle al usuario. El backend, además,
 * **ni se entera**: en sus logs no hay error, porque la petición nunca llegó.
 *
 * Un límite así se rompe en silencio de dos maneras, y esta prueba tapa las dos:
 *
 *  1. **Que la línea desaparezca** (un refactor de la plantilla, un merge desafortunado)
 *     → el techo real vuelve a ser 1 MB sin que nadie lo note hasta que un usuario lo
 *     pise.
 *  2. **Que los dos números se separen**: si el backend sube su `bodyLimit` a 128 MiB y
 *     nginx se queda en 64m, el límite verdadero sigue siendo 64 — pero la constante del
 *     backend, que es la que todo el mundo lee, dice otra cosa. Un límite documentado que
 *     no es el límite es peor que no documentarlo.
 *
 * Por eso lee los DOS archivos reales (con `node:fs`, igual que `version.test.ts`: así
 * nunca entran al bundle ni al `docker build`, cuyo contexto es sólo `frontend/`) y exige
 * que declaren **el mismo número de bytes**. Y si algo no parsea, truena: un candado que
 * no encuentra qué comparar tiene que ponerse ROJO, nunca verde por omisión.
 */

/**
 * Raíz del repo: se sube desde el directorio de trabajo hasta topar con `PLANMAESTRO.md`
 * (marcador estable). Igual que en `version.test.ts` y por lo mismo: bajo Vitest
 * `import.meta.url` no siempre es una URL `file:`, y el runner puede invocarse desde
 * `frontend/` o desde la raíz.
 */
function raizDelRepo(): string {
  let directorio = process.cwd();
  for (;;) {
    if (existsSync(join(directorio, 'PLANMAESTRO.md'))) {
      return directorio;
    }
    const padre = dirname(directorio);
    if (padre === directorio) {
      throw new Error(
        `No encontré la raíz del repo (PLANMAESTRO.md) subiendo desde ${process.cwd()}`,
      );
    }
    directorio = padre;
  }
}

const RAIZ = raizDelRepo();
const RUTA_NGINX = join(RAIZ, 'frontend', 'nginx.conf.template');
const RUTA_RUTAS_BACKEND = join(
  RAIZ,
  'backend',
  'src',
  'api',
  'pedidos',
  'importacion-pdf.rutas.ts',
);

/** Lee un archivo del repo, o truena diciendo cuál falta y para qué se usaba. */
function leer(ruta: string, paraQue: string): string {
  if (!existsSync(ruta)) {
    throw new Error(`No encontré ${ruta}. Esta prueba lo usa para ${paraQue}.`);
  }
  return readFileSync(ruta, 'utf8');
}

/**
 * El bloque `location /api/ { … }` de la plantilla de nginx. Se acota al bloque a
 * propósito: un `client_max_body_size` declarado en OTRA `location` (o suelto en el
 * `server`) no protege a la API, y dar por buena una coincidencia de cualquier parte del
 * archivo sería justo el falso verde que esto viene a evitar.
 */
function bloqueLocationApi(): string {
  const texto = leer(RUTA_NGINX, 'comprobar el límite de cuerpo del proxy de la API');
  const inicio = texto.indexOf('location /api/');
  if (inicio === -1) {
    throw new Error(
      `${RUTA_NGINX} ya no tiene un bloque \`location /api/\`: si el proxy de la API se movió, ` +
        'esta prueba tiene que apuntar al bloque nuevo (y alguien debe confirmar que el límite ' +
        'de cuerpo se movió con él).',
    );
  }
  const cierre = texto.indexOf('\n    }', inicio);
  if (cierre === -1) {
    throw new Error(`No encontré el cierre del bloque \`location /api/\` en ${RUTA_NGINX}.`);
  }
  return texto.slice(inicio, cierre);
}

/** Convierte un tamaño de nginx (`64m`, `1024k`, `500`) a bytes. */
function bytesDeNginx(valor: string): number {
  const coincidencia = /^(\d+)([kKmMgG]?)$/.exec(valor.trim());
  if (coincidencia?.[1] === undefined) {
    throw new Error(`No entendí el tamaño de nginx \`${valor}\` (esperaba algo como \`64m\`).`);
  }
  const cantidad = Number(coincidencia[1]);
  const factores: Record<string, number> = {
    '': 1,
    k: 1024,
    m: 1024 * 1024,
    g: 1024 * 1024 * 1024,
  };
  const factor = factores[(coincidencia[2] ?? '').toLowerCase()];
  if (factor === undefined) {
    throw new Error(`Sufijo de tamaño desconocido en \`${valor}\`.`);
  }
  return cantidad * factor;
}

/** El `client_max_body_size` declarado DENTRO de `location /api/`, en bytes. */
function limiteDeNginxEnBytes(): number {
  const coincidencia = /client_max_body_size\s+([^;\s]+)\s*;/.exec(bloqueLocationApi());
  if (coincidencia?.[1] === undefined) {
    throw new Error(
      `El bloque \`location /api/\` de ${RUTA_NGINX} NO declara \`client_max_body_size\`. ` +
        'Sin esa línea rige el default de nginx (1 MB) y el importador de PDFs vuelve a morir ' +
        'con «Failed to fetch» en cuanto se manden 3 o 4 archivos.',
    );
  }
  return bytesDeNginx(coincidencia[1]);
}

/**
 * El `LIMITE_CUERPO_IMPORTACION` del backend, en bytes. Se lee del código fuente (no se
 * importa) porque este archivo vive en el proyecto del frontend y no compila el backend:
 * lo que se compara es lo que está ESCRITO en el archivo que gobierna la ruta.
 */
function limiteDelBackendEnBytes(): number {
  const texto = leer(RUTA_RUTAS_BACKEND, 'leer el límite de cuerpo que declara el backend');
  const coincidencia = /const\s+LIMITE_CUERPO_IMPORTACION\s*=\s*([^;]+);/.exec(texto);
  if (coincidencia?.[1] === undefined) {
    throw new Error(
      `No encontré \`LIMITE_CUERPO_IMPORTACION\` en ${RUTA_RUTAS_BACKEND}. Si se renombró, hay ` +
        'que actualizar esta prueba — y de paso revisar que nginx siga alineado.',
    );
  }
  const expresion = coincidencia[1].trim();
  if (!/^[\d\s*+]+$/.test(expresion)) {
    throw new Error(
      `\`LIMITE_CUERPO_IMPORTACION\` dejó de ser una cuenta de números (\`${expresion}\`): esta ` +
        'prueba sólo sabe evaluar cosas como `64 * 1024 * 1024`.',
    );
  }
  // Sólo dígitos, `*`, `+` y espacios: la cuenta es aritmética pura, no código ajeno.
  return expresion
    .split('+')
    .reduce(
      (total, sumando) =>
        total +
        sumando.split('*').reduce((producto, factor) => producto * Number(factor.trim()), 1),
      0,
    );
}

describe('el límite de cuerpo del proxy de la API (nginx) contra el del backend', () => {
  it('nginx declara `client_max_body_size` dentro de `location /api/`', () => {
    // Si falta, el techo real es 1 MB — y el síntoma no es un error legible, es que la
    // petición muere en la red y el backend ni se entera.
    expect(limiteDeNginxEnBytes()).toBeGreaterThan(0);
  });

  it('es EXACTAMENTE el mismo número que `LIMITE_CUERPO_IMPORTACION` del backend', () => {
    const nginx = limiteDeNginxEnBytes();
    const backend = limiteDelBackendEnBytes();
    expect(
      nginx,
      `nginx acepta ${String(nginx)} bytes y el backend declara ${String(backend)}: el límite ` +
        'REAL es el más chico de los dos, así que el número grande miente. Muévelos JUNTOS ' +
        '(`frontend/nginx.conf.template` y `backend/src/api/pedidos/importacion-pdf.rutas.ts`).',
    ).toBe(backend);
  });

  it('alcanza para el lote más grande que el contrato permite', () => {
    // MAX_ARCHIVOS_PDF = 40 y el dominio topa cada archivo en 10 MiB. El peor caso teórico
    // (40 × 10 MiB, ya inflados ~33% por base64) rebasa cualquier límite razonable, así que
    // lo que se comprueba es el caso REAL que Daniel vive: OCs de ~200 KB. Con 40 de ésas,
    // el JSON ronda los 11 MiB. Si el límite bajara de ahí, el importador volvería a
    // romperse en el uso normal, no en un extremo inventado.
    const cuarentaOcTipicas = Math.ceil(40 * 200 * 1024 * 1.37);
    expect(
      limiteDeNginxEnBytes(),
      'el límite ya no alcanza para 40 OC típicas (~200 KB c/u) en base64: o sube el límite, ' +
        'o baja MAX_ARCHIVOS_PDF, pero que el contrato y la realidad digan lo mismo.',
    ).toBeGreaterThanOrEqual(cuarentaOcTipicas);
  });
});
