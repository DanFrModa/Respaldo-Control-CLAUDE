import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * EL CANDADO DE LAS CABECERAS DE SEGURIDAD (V1-E6d).
 *
 * Las cabeceras de seguridad viven en `frontend/nginx.conf.template` y **no hay forma
 * de probarlas aquí de verdad**: exigirían levantar nginx y pedirle una respuesta, y en
 * este proyecto Docker local está prohibido. Lo que sí se puede hacer —y es justo donde
 * estas cabeceras se pierden en la vida real— es leer el archivo y exigir que digan lo
 * que deben decir. Esta prueba es una **red contra el borrado silencioso**, no una
 * comprobación de que nginx las emite; eso solo lo demuestra un `curl -I` contra el
 * servidor ya desplegado.
 *
 * Tapa cuatro formas concretas de romperlas sin darse cuenta:
 *
 *  1. **Que alguien las borre** en un refactor de la plantilla (o que un merge se las
 *     coma). Sin la cabecera no hay error ni log: simplemente el navegador deja de estar
 *     protegido y todo *se ve* igual.
 *  2. **LA TRAMPA DE LA HERENCIA de nginx.** `add_header` NO se hereda a una `location`
 *     que declara `add_header` propio: en cuanto un bloque hijo agrega uno —aunque sea un
 *     `Cache-Control` inocente— PIERDE TODAS las del padre, en silencio. Ya pasa hoy con
 *     `location = /index.html`, que es precisamente el bloque por el que sale el HTML
 *     principal de la SPA (el `try_files … /index.html` hace una redirección interna que
 *     vuelve a elegir location). Por eso la regla que se exige aquí es general: **todo
 *     bloque que declare `add_header` debe declarar el juego COMPLETO**.
 *  3. **Que se separen las dos copias**: que alguien afine el CSP del `server` y deje el
 *     de `index.html` viejo. Se exige que sean idénticos, carácter por carácter.
 *  4. **Que el hash del CSP deje de cuadrar.** El `script-src` lleva el SHA-256 del único
 *     script en línea de `index.html` (el que aplica el tema oscuro antes de pintar). Si
 *     alguien edita ese script —aunque sea un espacio— el hash deja de coincidir y el
 *     navegador bloquearía el script el día que el CSP pase a modo bloqueante: la página
 *     saldría con un parpadeo de tema y nadie sabría por qué. Aquí se recalcula el hash
 *     del archivo real y se compara con el que declara la plantilla.
 *
 * 🔴 **LO QUE ESTE CANDADO NO VE** (dicho para que nadie le suponga más alcance):
 *  - No prueba que nginx arranque, ni que la sintaxis sea válida (eso se validó aparte con
 *    `crossplane`, el parser oficial de nginx), ni que las cabeceras lleguen al navegador.
 *  - No sabe de precedencia de `location`: si alguien agrega un `location` con REGEX que
 *    atrape rutas y le pone su propio `add_header`, esta prueba lo obliga a traer el juego
 *    completo, pero no puede decidir si ese bloque debía existir.
 *  - No valida el CSP contra lo que la app realmente carga. Eso es lo que va a contar el
 *    **modo reporte** en la consola del navegador durante el arranque.
 */

/** Raíz del repo: se sube hasta topar con `PLANMAESTRO.md` (igual que `limite-cuerpo-api.test.ts`). */
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
const RUTA_INDEX = join(RAIZ, 'frontend', 'index.html');

function leer(ruta: string, paraQue: string): string {
  if (!existsSync(ruta)) {
    throw new Error(`No encontré ${ruta}. Esta prueba lo usa para ${paraQue}.`);
  }
  return readFileSync(ruta, 'utf8');
}

/**
 * La plantilla SIN comentarios. Se quitan antes de mirar nada porque los comentarios de
 * este archivo explican las cabeceras (y hasta traen llaves de ejemplo), y una prueba que
 * se conforma con encontrar el texto dentro de un comentario da verde con la protección
 * borrada — el falso verde más tonto posible.
 */
function plantillaSinComentarios(): string {
  return leer(RUTA_NGINX, 'comprobar las cabeceras de seguridad')
    .split('\n')
    .filter((linea) => !/^\s*#/.test(linea))
    .join('\n');
}

interface BloqueNginx {
  /** Encabezado del bloque, ej. `server` o `location = /index.html`. */
  nombre: string;
  /** Directivas declaradas DIRECTAMENTE en el bloque (sin las de los bloques anidados). */
  propias: string;
}

/**
 * Descompone la plantilla en bloques `{ … }` y devuelve, para cada uno, solo sus
 * directivas propias. Es un escáner de llaves, no un parser de nginx: alcanza porque en
 * esta plantilla ninguna cadena entrecomillada contiene llaves (los comentarios, que sí
 * las tienen, ya se quitaron).
 */
function bloques(texto: string): BloqueNginx[] {
  const encontrados: BloqueNginx[] = [];
  const pila: { nombre: string; desde: number; propias: string[] }[] = [];
  let ultimoCorte = 0;

  for (let i = 0; i < texto.length; i += 1) {
    const caracter = texto[i];
    if (caracter === '{') {
      const encabezado = texto.slice(ultimoCorte, i).trim().split('\n').pop() ?? '';
      if (pila.length > 0) {
        // Lo que iba antes de este hijo pertenece al padre.
        pila[pila.length - 1]?.propias.push(texto.slice(pila[pila.length - 1]?.desde ?? 0, i));
      }
      pila.push({ nombre: encabezado.trim(), desde: i + 1, propias: [] });
      ultimoCorte = i + 1;
    } else if (caracter === '}') {
      const bloque = pila.pop();
      if (bloque === undefined) {
        throw new Error(`Llave de cierre sin abrir en ${RUTA_NGINX} (posición ${String(i)}).`);
      }
      bloque.propias.push(texto.slice(bloque.desde, i));
      encontrados.push({ nombre: bloque.nombre, propias: bloque.propias.join('\n') });
      const padre = pila[pila.length - 1];
      if (padre !== undefined) {
        padre.desde = i + 1;
      }
      ultimoCorte = i + 1;
    }
  }
  if (pila.length > 0) {
    throw new Error(`Quedaron ${String(pila.length)} bloques sin cerrar en ${RUTA_NGINX}.`);
  }
  return encontrados;
}

/**
 * Las cabeceras que TODO bloque con `add_header` debe declarar, con el valor exacto que
 * se espera. La clave es el nombre de la cabecera; el valor, lo que debe venir después.
 */
const CABECERAS_OBLIGATORIAS: Record<string, string> = {
  'Strict-Transport-Security': '$hsts_valor',
  'X-Frame-Options': '"DENY"',
  'X-Content-Type-Options': '"nosniff"',
  'Referrer-Policy': '"same-origin"',
};

/**
 * Extrae los `add_header` de un texto: nombre, valor y si lleva `always`.
 *
 * El valor se lee ENTRECOMILLADO a propósito: el CSP trae `;` DENTRO de sus comillas
 * (`default-src 'self'; base-uri 'self'; …`), así que cortar en el primer `;` —el reflejo
 * natural— parte la política en pedazos y la prueba empieza a mentir (lo comprobé: daba
 * por ausente el `always` que sí estaba escrito).
 */
function addHeaders(texto: string): { nombre: string; valor: string; always: boolean }[] {
  return [...texto.matchAll(/add_header\s+(\S+)\s+("[^"]*"|[^;\s]+)\s*(always)?\s*;/g)].map(
    (m) => ({
      nombre: m[1] ?? '',
      valor: m[2] ?? '',
      always: m[3] === 'always',
    }),
  );
}

/** El valor del CSP (modo reporte) declarado en un bloque, sin comillas. */
function cspDe(texto: string): string {
  const csp = addHeaders(texto).find((h) => h.nombre === 'Content-Security-Policy-Report-Only');
  if (csp === undefined) {
    return '';
  }
  return csp.valor.replace(/^"|"$/g, '');
}

const PLANTILLA = plantillaSinComentarios();
const BLOQUES = bloques(PLANTILLA);
const CON_ADD_HEADER = BLOQUES.filter((b) => b.propias.includes('add_header'));

describe('cabeceras de seguridad en nginx.conf.template', () => {
  it('el bloque `server` declara las cuatro cabeceras fijas y el CSP', () => {
    const servidor = BLOQUES.find((b) => b.nombre === 'server');
    expect(servidor, 'ya no hay un bloque `server` en la plantilla').toBeDefined();
    const propias = servidor?.propias ?? '';
    for (const [cabecera, valor] of Object.entries(CABECERAS_OBLIGATORIAS)) {
      expect(propias, `falta \`add_header ${cabecera}\` en el bloque server`).toContain(
        `add_header ${cabecera} ${valor}`,
      );
    }
    expect(propias).toContain('add_header Content-Security-Policy-Report-Only');
  });

  it('TODO bloque que declara `add_header` trae el juego COMPLETO (trampa de la herencia)', () => {
    // La regla de oro de nginx: un `add_header` propio TUMBA todos los del padre. Así que
    // cualquier bloque que declare uno tiene que traerlas todas o se queda desnudo.
    expect(
      CON_ADD_HEADER.length,
      'ningún bloque declara add_header: se borraron todas',
    ).toBeGreaterThan(0);
    for (const bloque of CON_ADD_HEADER) {
      for (const [cabecera, valor] of Object.entries(CABECERAS_OBLIGATORIAS)) {
        expect(
          bloque.propias,
          `el bloque \`${bloque.nombre}\` declara add_header pero le falta ${cabecera}. ` +
            'En nginx un add_header propio ANULA los del padre: hay que copiar el juego ' +
            'completo (las 4 cabeceras + el CSP) en cada bloque que declare alguno.',
        ).toContain(`add_header ${cabecera} ${valor}`);
      }
      expect(
        cspDe(bloque.propias),
        `el bloque \`${bloque.nombre}\` declara add_header pero no el CSP.`,
      ).not.toBe('');
    }
  });

  it('todas las cabeceras de seguridad llevan `always` (también en los errores)', () => {
    // Sin `always`, nginx solo las agrega a 200/204/301/302/304: un 401, un 404 o un 500
    // saldrían SIN protección, que es justo cuando el navegador ve contenido inesperado.
    const deSeguridad = new Set([
      ...Object.keys(CABECERAS_OBLIGATORIAS),
      'Content-Security-Policy-Report-Only',
    ]);
    for (const bloque of CON_ADD_HEADER) {
      for (const cabecera of addHeaders(bloque.propias)) {
        if (deSeguridad.has(cabecera.nombre)) {
          expect(
            cabecera.always,
            `\`${cabecera.nombre}\` en el bloque \`${bloque.nombre}\` no lleva \`always\`: ` +
              'las respuestas de error saldrían sin esa cabecera.',
          ).toBe(true);
        }
      }
    }
  });

  it('el CSP es idéntico en todos los bloques que lo declaran', () => {
    const politicas = [...new Set(CON_ADD_HEADER.map((b) => cspDe(b.propias)))];
    expect(
      politicas.length,
      'hay DOS políticas CSP distintas en la plantilla. Cuando se afina una hay que afinar ' +
        'la otra: si no, la protección depende de por qué location salió la respuesta.',
    ).toBe(1);
  });

  it('el CSP sigue en modo REPORTE (decisión de Daniel para el arranque)', () => {
    // Si algún día se pasa a bloqueante, ES A PROPÓSITO y esta prueba se actualiza a mano:
    // el cambio no puede colarse sin que alguien lo decida y lo escriba.
    expect(PLANTILLA).toContain('add_header Content-Security-Policy-Report-Only');
    expect(
      /add_header\s+Content-Security-Policy\s/.test(PLANTILLA),
      'apareció un CSP BLOQUEANTE. Si es intencional, actualiza esta prueba y avisa: hay que ' +
        'verificar antes que los PDF/Excel de /api sigan abriéndose en Chrome, Edge y Firefox.',
    ).toBe(false);
  });

  it('el CSP declara las directivas esperadas, incluidas las que R2 necesita', () => {
    const csp = cspDe(CON_ADD_HEADER[0]?.propias ?? '');
    const esperadas = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "style-src 'self' 'unsafe-inline'",
      "worker-src 'none'",
    ];
    for (const directiva of esperadas) {
      expect(csp, `al CSP le falta \`${directiva}\``).toContain(directiva);
    }
    // R2 en connect-src NO es opcional: el navegador sube los archivos con fetch PUT
    // DIRECTO al bucket (src/api/subida-archivo.ts) y el visor hace fetch de la URL
    // prefirmada para descargar (VisorImagen.tsx). Sin esto, el día que el CSP bloquee se
    // caen TODAS las subidas y descargas de foto.
    expect(csp).toMatch(/connect-src [^;]*https:\/\/\*\.r2\.cloudflarestorage\.com/);
    // Y en img-src, porque las fotos de modelos/bordados se pintan desde el bucket.
    expect(csp).toMatch(/img-src [^;]*https:\/\/\*\.r2\.cloudflarestorage\.com/);
  });

  it('el hash del `script-src` es el del script en línea REAL de index.html', () => {
    const html = leer(RUTA_INDEX, 'recalcular el hash del script en línea del tema');
    const enLinea = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
    expect(
      enLinea.length,
      'index.html ya no tiene exactamente UN script en línea. Si se agregó otro, necesita su ' +
        'propio hash en el CSP; si se quitó el del tema, hay que quitar el hash de la plantilla.',
    ).toBe(1);

    const contenido = enLinea[0]?.[1] ?? '';
    const hash = `sha256-${createHash('sha256').update(contenido, 'utf8').digest('base64')}`;
    const csp = cspDe(CON_ADD_HEADER[0]?.propias ?? '');
    expect(
      csp,
      `el hash del CSP no corresponde al script en línea de index.html. El correcto hoy es ` +
        `'${hash}'. Ese script (el que aplica el tema oscuro antes de pintar) cambió: hasta un ` +
        'espacio cambia el hash. Actualízalo en nginx.conf.template — si no, el día que el CSP ' +
        'bloquee, el tema oscuro dejará de aplicarse y la página parpadeará sin explicación.',
    ).toContain(`'${hash}'`);
  });

  it('el HSTS se emite solo si la petición vino por HTTPS (map de X-Forwarded-Proto)', () => {
    // En Railway el TLS lo termina el edge: dentro del contenedor $scheme siempre es "http".
    // Lo que decide es X-Forwarded-Proto; si falta (healthcheck interno), el valor queda
    // vacío y nginx NO agrega la cabecera.
    expect(PLANTILLA).toMatch(/map\s+\$http_x_forwarded_proto\s+\$hsts_valor\s*\{/);
    expect(PLANTILLA).toMatch(/max-age=\d+/);
    expect(
      PLANTILLA.includes('preload'),
      'apareció `preload` en el HSTS: es prácticamente irreversible y exige control del ' +
        'dominio. Hoy el dominio es de Railway.',
    ).toBe(false);
  });

  it('nginx no anuncia su versión (`server_tokens off`)', () => {
    expect(PLANTILLA).toMatch(/server_tokens\s+off\s*;/);
  });

  it('el `Cache-Control` de index.html sigue intacto', () => {
    // Se agregaron cabeceras a ese bloque; lo que ya estaba no se toca.
    const indexHtml = BLOQUES.find((b) => b.nombre === 'location = /index.html');
    expect(indexHtml?.propias).toContain('add_header Cache-Control "no-cache"');
  });
});
