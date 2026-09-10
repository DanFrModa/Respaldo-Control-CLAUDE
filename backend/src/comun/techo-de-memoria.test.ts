/**
 * ⭐⭐ GUARDIÁN DE LA FILA **0.092** — «la venda de la memoria».
 *
 * ## Qué vigila, y qué NO
 *
 * El heap de Node (`--max-old-space-size`) que se le fija al compilador. **No vigila el consumo**
 * —eso lo mide `tsc --extendedDiagnostics`—: vigila que **el número no vuelva a subir**.
 *
 * ## Por qué existe
 *
 * Dos veces se resolvió un OOM subiendo el techo (lint el 6-ago-2026, typecheck el 16-ago), y las
 * dos veces la cicatriz se repitió un paso más abajo. Desde agosto `ci.yml` lo dice con letras:
 * *«esto NO es la cura, es la venda… cuando 6 GB no alcancen, hay que ATACAR LA CAUSA (proyectos de
 * TS separados / `--build` incremental / adelgazar los tipos generados), no volver a subir el
 * número»*. Pero esa advertencia **depende de que alguien la lea**, y quien llega con el CI en rojo
 * y prisa edita el número, no el comentario. Esta prueba convierte la advertencia en un rojo.
 *
 * 🔴 **Y hay una rama gemela medida:** el techo NO está en un sitio, está en **cuatro**, repartidos
 * en **dos archivos** (`ci.yml` ×3 y `backend/Dockerfile` ×1). El de `ci.yml` **no alcanza** al del
 * Dockerfile —son procesos distintos: un `env:` de un paso del workflow no cruza a `docker build`—,
 * y precisamente por eso el arreglo de agosto dejó verde el job `backend` mientras
 * `imagenes-docker` seguía muriendo. Vigilar uno solo sería vigilar a medias.
 *
 * ## La medición que da contexto (1-sep-2026, fila 0.092)
 *
 * En CI los 6 GB **alcanzan**: `tsc --extendedDiagnostics` pidió **5 058 MiB** contra un techo de
 * **6 144** (~18 % de margen), y eso **con +20 % de trabajo** desde agosto (3.5 M → 4.2 M tipos;
 * 19.7 M → 23.3 M instanciaciones) y la memoria casi igual. O sea: no es urgente. Este guardián no
 * viene a apretar nada — viene a que el día que el margen se acabe, nadie ponga otra venda sin
 * enterarse.
 *
 * ## 🔴 Ese día llegó — para el LINT (5-sep-2026)
 *
 * **El guardián hizo su trabajo:** con el CI en rojo y prisa, el lead subió el techo a 8192 en los
 * tres sitios de `ci.yml`; esta prueba se puso roja, el cambio se revirtió y la decisión subió a
 * Gabriel en vez de quedarse en un `git push`. Es exactamente el desenlace para el que existe.
 *
 * Lo que se midió antes de mover nada:
 *  • el lint muere con **exit 134** contra 6144, **pico 6011 MiB**, reproducido dos veces;
 *  • **partirlo por carpetas NO ayuda**: `eslint src/dominio` a solas revienta con **4096 y con
 *    5120**. El costo no está en cuántos archivos se le den, está en el grafo de tipos que cada uno
 *    obliga a cargar entero;
 *  • las dos palancas de configuración **ya estaban puestas**: `parserOptions.projectService` y el
 *    ignore del cliente generado de Prisma (`src/datos/generated/`, 22 MB / 181 `.ts`);
 *  • a **8192 pasa**, con **pico 7034 MiB** (~14 % de margen).
 *
 * Decisión de Gabriel: subir **sólo el paso del lint**, dejando `typecheck`, `build` y el
 * `Dockerfile` en 6144 — el Dockerfile **no corre eslint**, así que no queda ningún hermano atrás
 * (que es la rama gemela que este guardián vigila), y la memoria del runner de GitHub **sí** es
 * medible (16 GB) mientras que la del contenedor que construye en Railway no lo es.
 *
 * ⛔ **Para el lint, la venda se acabó.** Con ~14 % de margen y sin salidas baratas, la próxima vez
 * toca la cura (adelgazar el programa de tipos), no el número.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RAIZ_REPO = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * El techo más alto que hoy fija cualquier sitio. **Ninguno puede pasar de aquí.**
 *
 * 6144 no era un número redondo por gusto: el `Dockerfile` lo bisecó (3072 muere, 4096 pasa por un
 * pelo, 6144 pasa) y eligió 6144 para no quedarse en el borde y para que el compilador tuviera UN
 * solo número en todos lados.
 *
 * 🔴 **Ese «un solo número» se rompió el 5-sep-2026, a propósito y por decisión de Gabriel** (ver el
 * registro de abajo): el **lint** subió a 8192 y los otros tres sitios se quedaron en 6144. El
 * máximo sube con él porque este guardián compara contra el registro sitio por sitio; lo que sigue
 * prohibido —y es lo que esta constante atrapa— es que un techo **suelto**, en un sitio que nadie
 * declaró, se cuele por encima del más alto que alguien miró.
 */
const TECHO_MAXIMO = 8192;

interface SitioConTecho {
  /** Ruta relativa a la raíz del repo, con `/`. */
  archivo: string;
  /** Valores registrados hoy, en orden de aparición. Nadie puede SUBIR de estos. */
  valores: number[];
  /** Para qué corre ahí el compilador (sirve al lector, no a la aserción). */
  paraQue: string;
}

/**
 * 🔴 **El registro — se toca A MANO.** Es la declaración de que alguien miró cada sitio donde se le
 * fija memoria al compilador. Si aparece uno nuevo, o desaparece uno de éstos, la primera prueba se
 * pone roja: un techo suelto que nadie vigile es exactamente cómo empezó esta fila.
 */
const SITIOS_CON_TECHO: SitioConTecho[] = [
  {
    archivo: '.github/workflows/ci.yml',
    // 🔴 EL LINT VA APARTE DESDE EL 5-sep-2026 (decisión de Gabriel). Tercera muerte por OOM del
    // mismo paso (exit 134 contra 6144, pico 6011 MiB, reproducido dos veces) y la primera en la
    // que las dos salidas baratas se midieron MUERTAS antes de mover el número: partir el lint por
    // carpetas no ayuda (`eslint src/dominio` a solas revienta con 4096 y con 5120 — el costo está
    // en el grafo de tipos, no en cuántos archivos se le den) y `eslint.config.js` YA usa
    // `parserOptions.projectService` y YA ignora el cliente generado de Prisma (22 MB). A 8192
    // pasa, con un pico de 7034 MiB (~14 % de margen).
    //
    // Sube SÓLO aquí porque el `Dockerfile` NO corre eslint: no queda ningún hermano atrás, que es
    // la rama gemela que este guardián vigila. Y sube aquí y no allá porque la memoria del runner
    // de GitHub es medible (16 GB) y la del contenedor que construye en Railway no lo es.
    valores: [8192, 6144, 6144],
    paraQue:
      'los tres pasos del job `backend` que cargan el grafo de tipos: lint (8192 desde el ' +
      '5-sep-2026), typecheck y build',
  },
  {
    archivo: 'backend/Dockerfile',
    valores: [6144],
    paraQue:
      'el `RUN npm run build` de la etapa builder — el MISMO `tsc`, en otro proceso, y el que ' +
      'construye la imagen que va a producción (un CI rojo bloquea un PR; esto bloquea el despliegue)',
  },
];

const LAS_TRES_CURAS =
  'FILA 0.092 — el techo de memoria del compilador subió, o apareció en un sitio nuevo.\n' +
  'SUBIRLO ES LA VENDA, NO LA CURA. Las curas, las que `ci.yml` lleva escritas desde agosto:\n' +
  '  1. separar el proyecto de TypeScript en proyectos más chicos;\n' +
  '  2. compilar con `--build` incremental;\n' +
  '  3. adelgazar los tipos generados (Prisma y Zod son los que pesan).\n' +
  'Y si de verdad hay que mover el número, muévelo en TODOS los sitios que corren EL MISMO ' +
  'PROGRAMA —`ci.yml` y `backend/Dockerfile` son procesos distintos y el uno no alcanza al ' +
  'otro— y actualiza el registro de `comun/techo-de-memoria.test.ts` diciendo por qué.\n' +
  '⚠️ «El mismo programa» NO es «todos»: el lint subió solo a 8192 el 5-sep-2026 porque el ' +
  'Dockerfile no corre eslint, y ahí no quedaba ningún hermano atrás. Un `tsc` que suba, en ' +
  'cambio, tiene que subir en los tres sitios que lo corren.\n' +
  '⛔ Y para el LINT esta venda ya se gastó: con ~14 % de margen y las dos salidas baratas ' +
  'medidas muertas (partirlo no ayuda; `projectService` y el ignore del cliente de Prisma ya ' +
  'están puestos), la próxima vez toca la cura, no el número.\n' +
  '⚠️ Un techo POR ENCIMA de la memoria que el contenedor puede dar no protege, EMPEORA: cambia ' +
  'un OOM limpio de V8 (exit 134) por el OOM-killer del kernel (exit 137, «Killed»).';

/**
 * Ficheros del repo donde un techo PUEDE quedar fijado: workflows, Dockerfiles, compose, scripts de
 * shell y `package.json`.
 *
 * ⚠️ **Lo que entra, dicho con exactitud** (una versión anterior de este guardián se dejaba fuera
 * `railway.json` y los `.mjs`, y en un guardián cuyo sentido es *«que ningún sitio se escape»* un
 * hueco sin declarar ES el defecto): workflows y cualquier `.yml`/`.yaml`, todos los `Dockerfile*`,
 * los `.sh` (incluido `docker-entrypoint.sh`), los `package.json` (ahí cabría un `NODE_OPTIONS=…`
 * dentro de un script), **los `railway.json`** (`startCommand`/`buildCommand`) y **los
 * `.mjs`/`.cjs`** (`frontend/scripts/gen-api.mjs`, `backend/src/comun/pdf-worker-boot.mjs`, que
 * lanzan procesos). Medido hoy: esos cuatro últimos ficheros **no fijan ningún techo** — entran para
 * que el día que lo hagan no pase inadvertido.
 *
 * ⚠️ **Lo que queda FUERA, y por qué:**
 *  • el **Markdown** — `docs/` y `HOJA-DE-RUTA.md` hablan del techo en prosa, y la prosa no fija nada;
 *  • los `.ts` — ninguno lanza el compilador con techo propio hoy, y meterlos traería el ruido de
 *    este mismo archivo, que escribe la cadena para poder buscarla;
 *  • **el panel de Railway**: un `NODE_OPTIONS` puesto a mano ahí no vive en el repo y **ningún
 *    escaneo puede verlo**. Ése sigue dependiendo de que alguien lo recuerde.
 */
function ficherosQuePuedenFijarElTecho(dir: string): string[] {
  const IGNORAR = new Set([
    'node_modules',
    '.git',
    'dist',
    'coverage',
    'test-results',
    'playwright-report',
  ]);
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR.has(entrada)) continue;
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      salida.push(...ficherosQuePuedenFijarElTecho(ruta));
      continue;
    }
    const nombre = basename(ruta);
    const esDockerfile = nombre === 'Dockerfile' || nombre.startsWith('Dockerfile.');
    const esConfig = ['.yml', '.yaml', '.sh', '.mjs', '.cjs'].includes(extname(ruta));
    const esJsonDeArranque = nombre === 'package.json' || nombre === 'railway.json';
    if (esDockerfile || esConfig || esJsonDeArranque) salida.push(ruta);
  }
  return salida;
}

/** Todos los `--max-old-space-size=N` del repo, por archivo. */
function techosEncontrados(): Map<string, number[]> {
  const porArchivo = new Map<string, number[]>();
  for (const ruta of ficherosQuePuedenFijarElTecho(RAIZ_REPO)) {
    const contenido = readFileSync(ruta, 'utf8');
    // ⚠️ LA GEMELA DEL PROPIO REGEX: Node acepta las dos grafías, `--max-old-space-size` y
    // `--max_old_space_size`. Vigilar sólo la de guiones dejaría una puerta abierta que ni siquiera
    // parecería un rodeo — quien la usara creería estar escribiendo lo mismo.
    const valores = [...contenido.matchAll(/--max[-_]old[-_]space[-_]size=(\d+)/g)].map((golpe) =>
      Number(golpe[1]),
    );
    if (valores.length === 0) continue;
    porArchivo.set(relative(RAIZ_REPO, ruta).split('\\').join('/'), valores);
  }
  return porArchivo;
}

describe('⭐ fila 0.092 — el techo de memoria no vuelve a subir a escondidas', () => {
  const encontrados = techosEncontrados();

  it('el escaneo ve los sitios que ya sabemos que existen (si no, no está midiendo nada)', () => {
    // Red de seguridad del propio guardián: sin esto, un escaneo roto encontraría CERO sitios y
    // las aserciones de abajo pasarían por vacías — el guardián mudo, que es peor que ninguno.
    expect(encontrados.has('.github/workflows/ci.yml')).toBe(true);
    expect(encontrados.has('backend/Dockerfile')).toBe(true);
    // Y que de verdad alcanza los ficheros que O3 sumó: si el filtro los dejara fuera otra vez, el
    // guardián volvería a tener un hueco mudo. Se comprueba sobre la LISTA de candidatos, no sobre
    // los que fijan techo (hoy ninguno de éstos lo fija — y ése es justo el punto).
    const candidatos = ficherosQuePuedenFijarElTecho(RAIZ_REPO).map((r) =>
      relative(RAIZ_REPO, r).split('\\').join('/'),
    );
    expect(candidatos).toContain('backend/railway.json');
    expect(candidatos).toContain('frontend/scripts/gen-api.mjs');
    expect(candidatos).toContain('backend/docker-entrypoint.sh');

    const total = [...encontrados.values()].reduce((suma, v) => suma + v.length, 0);
    expect(
      total,
      'la rama gemela: el techo vive en cuatro sitios, no en uno',
    ).toBeGreaterThanOrEqual(4);
  });

  it('🔴 no hay ningún sitio con techo fuera del registro (ni falta ninguno del registro)', () => {
    expect([...encontrados.keys()].sort(), LAS_TRES_CURAS).toEqual(
      SITIOS_CON_TECHO.map((s) => s.archivo).sort(),
    );
  });

  it('🔴 ningún techo SUBE del valor registrado', () => {
    for (const sitio of SITIOS_CON_TECHO) {
      const valores = encontrados.get(sitio.archivo);
      expect(valores, `${sitio.archivo} ya no fija ningún techo`).toBeDefined();
      // El CONTEO también se vigila: un cuarto paso del workflow con su propio techo es un sitio
      // nuevo aunque traiga el mismo número, y tiene que pasar por el registro.
      expect(valores, `${sitio.archivo}: cambió cuántos sitios fijan el techo`).toHaveLength(
        sitio.valores.length,
      );
      for (const [i, valor] of valores!.entries()) {
        // Se compara con `<=` y no con `===` a propósito: SUBIR es la venda que esta fila persigue;
        // BAJAR es una de las salidas legítimas (el propio `backend/Dockerfile` la pide con letras
        // para un builder de menos de ~8 GB, donde un techo alto trae el OOM-killer del kernel).
        expect(valor, `${sitio.archivo} [${String(i)}] — ${LAS_TRES_CURAS}`).toBeLessThanOrEqual(
          sitio.valores[i]!,
        );
      }
    }
  });

  it('🔴 y ninguno pasa del techo máximo, venga de donde venga', () => {
    for (const [archivo, valores] of encontrados) {
      for (const valor of valores) {
        expect(valor, `${archivo} — ${LAS_TRES_CURAS}`).toBeLessThanOrEqual(TECHO_MAXIMO);
      }
    }
  });

  it('el registro explica para qué corre el compilador en cada sitio', () => {
    // Prosa que sí se comprueba: un renglón sin explicación es un renglón que el siguiente lector
    // no sabe si puede tocar.
    for (const sitio of SITIOS_CON_TECHO) {
      expect(sitio.paraQue.trim().length).toBeGreaterThan(20);
      expect(sitio.valores.length).toBeGreaterThan(0);
    }
  });
});
