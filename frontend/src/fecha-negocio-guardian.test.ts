import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * ⭐ EL GUARDIÁN DEL «HOY» Y DEL DÍA DE UN INSTANTE (fila 0.230).
 *
 * El negocio vive en México (−06:00) y el servidor —y Postgres— en UTC. Había dos defectos gemelos:
 *  • **«HOY» en UTC**: doce `function hoy()` en la pantalla, `hoyUtc()` en la Ruta Crítica,
 *    `fecha: new Date()` en columnas `@db.Date` (el kardex fechaba sus cancelaciones MAÑANA),
 *    `CURRENT_DATE` en el aging de CxP/CxC/EsMa. De 18:00 a 23:59 de México todo eso ya era mañana.
 *  • **El DÍA de un SELLO DE TIEMPO en UTC**: `creadoEn.toISOString().slice(0, 10)` como fecha del
 *    cargo de EsMa, `"creado_en"::date` en SQL, filtros «del día X» sobre `creadoEn` con bordes en
 *    `T00:00:00Z`. Un cargo de las 19:00 salía con la fecha del día siguiente y el filtro de su día no
 *    lo traía.
 *
 * Una sola fuente por lado: `frontend/src/lib/fecha-negocio.ts` y `backend/src/comun/fecha-negocio.ts`.
 * Esta prueba barre `frontend/src`, `backend/src` y `backend/migracion` (sin pruebas ni código
 * generado) y se pone ROJA con archivo y línea si reaparece una de las formas de {@link REGLAS}.
 *
 * ⚠️ **Lo que SÍ hace y lo que NO, dicho sin adornos.** Reconoce FORMAS DE TEXTO, no tipos ni flujo
 * de datos:
 *  • En la PANTALLA prohíbe, fuera del helper: leer el reloj (`new Date()`, `new Date(Date.now()…)`),
 *    cortar un `toISOString()`/`toJSON()`, los `getUTC*`/`setUTC*`/`Date.UTC`, leer un día como UTC
 *    (`T00:00:00.000Z`) y un `Intl.DateTimeFormat` sin `timeZone`.
 *  • En el SERVIDOR (y el ETL) no puede ser tan estricta: ~cien `toISOString().slice(0, 10)` son
 *    CORRECTOS —leen una columna `@db.Date`, cuya parte UTC ES el día—. Caza las formas de «hoy» del
 *    reloj (encadenado, por nombre `ahora`/`hoy`, como valor de un campo `fecha…`, como valor por
 *    omisión `?`/`??`, entregado a una función), el corte de un campo `…En` (sello de tiempo por
 *    convención), los bordes UTC de un filtro sobre `…En`, las formas de SQL que toman el día de la
 *    sesión de Postgres o el de una columna `…_en`, y las fechas formateadas sin huso.
 *  • NO ve: un `new Date()` que viaje por variables con otro nombre antes de cortarse; un sello de
 *    tiempo cuyo nombre no termine en `En` (`fechaAutorizado`); un filtro sobre un sello armado en
 *    otra función o con un objeto `fecha: {…}` repartido en varias líneas (`fecha: {\n lte: new
 *    Date() }`); un `Date` construido desde un string `YYYY-MM-DD` FUERA de un filtro `…En: {…}`; y en
 *    SQL, un sello de tiempo comparado contra un día cuyo nombre no termine en `_en`. Para esos están
 *    las pruebas de comportamiento con el reloj a las 23:30.
 *
 * Una excepción declarada que ya no casa con nada también es ROJA: la lista no se pudre en silencio.
 *
 * Vive en `tsconfig.node.json` (no en el proyecto de la app) porque lee archivos REALES del disco
 * con `node:fs`, igual que `selector-proveedor-unico.test.ts`.
 */

type Lado = 'frontend' | 'backend';

interface Regla {
  /** Clave corta (la que citan las excepciones). */
  clave: string;
  lados: readonly Lado[];
  patron: RegExp;
  /**
   * `linea` (por omisión): el patrón se prueba línea por línea. `llamada`: el patrón es la CABEZA de
   * una llamada, y hay hallazgo si la llamada completa (paréntesis balanceados) no dice `timeZone`.
   * `bloque`: el patrón es la cabeza de un objeto `…En: {`, y hay hallazgo si su cuerpo (llaves
   * balanceadas) arma un borde de día en UTC.
   */
  modo?: 'linea' | 'llamada' | 'bloque';
  /** Qué hacer en su lugar (sale en el mensaje de error). */
  remedio: string;
}

/** El reloj: `new Date()` y `new Date(Date.now() …)` con o sin desplazamiento (igual que en la pantalla). */
const RELOJ = String.raw`new\s+Date\s*\(\s*(?:Date\.now\s*\(\s*\)[^()]*)?\)`;
const RELOJ_POR_NOMBRE = String.raw`\b(?:ahora|hoy|now)\s*\.\s*`;
const GETTER_DE_DIA = String.raw`get(?:UTC)?(?:FullYear|Month|Date|Day)\s*\(`;
const CORTE = String.raw`(?:toISOString|toJSON)\(\s*\)\s*\.\s*(?:slice|substring|substr|split)\s*\(`;
/** Lo que delata un borde de día armado en UTC dentro de un filtro. */
const BORDE_UTC =
  /T00:00(?::00(?:\.000)?)?Z|T23:59|86_?400_?000|aDateColumna\s*\(|new\s+Date\s*\(\s*[\w.]+\s*\)/;

const REGLAS: readonly Regla[] = [
  // ── PANTALLA ───────────────────────────────────────────────────────────────────────────────────
  {
    clave: 'iso-cortado',
    lados: ['frontend'],
    patron: new RegExp(CORTE),
    remedio:
      'el día de hoy es `hoy()` y la aritmética de calendario es `sumarDias()` de `@/lib/fecha-negocio`',
  },
  {
    clave: 'getters-utc',
    lados: ['frontend'],
    patron: /\.\s*(?:getUTC|setUTC)\w*\s*\(|\bDate\.UTC\s*\(/,
    remedio:
      'la cuenta de calendario vive en `@/lib/fecha-negocio` (`sumarDias`, `lunesDeLaSemana`, `diaDeLaSemana`)',
  },
  {
    clave: 'reloj',
    lados: ['frontend'],
    // `new Date()` y cualquier `new Date(Date.now() …)`, con o sin desplazamiento.
    patron: /new\s+Date\s*\(\s*(?:\)|Date\.now\b)/,
    remedio:
      'el día lo da `hoy()` (o `anioDelNegocio()`/`mesDelNegocio()`/`hoyLegible()`) de `@/lib/fecha-negocio`: el reloj del navegador no sabe en qué huso vive el negocio',
  },
  {
    clave: 'dia-como-utc',
    lados: ['frontend'],
    patron: /T00:00(?::00(?:\.000)?)?Z|T23:59(?::59(?:\.999)?)?Z/,
    remedio:
      'un día del negocio NO empieza a las 00:00 UTC: usa `inicioDelDiaDelNegocio()`/`finDelDiaDelNegocio()` de `@/lib/fecha-negocio`',
  },
  // ── SERVIDOR Y ETL ─────────────────────────────────────────────────────────────────────────────
  {
    clave: 'hoy-del-reloj',
    lados: ['backend'],
    patron: new RegExp(String.raw`${RELOJ}\s*\.\s*(?:${CORTE}|toJSON\s*\(|${GETTER_DE_DIA})`),
    remedio:
      '«hoy» es `hoyDelNegocio()` (texto) o `hoyDelNegocioUtc()` (para una columna `@db.Date`) de `comun/fecha-negocio.ts`',
  },
  {
    clave: 'hoy-por-nombre',
    lados: ['backend'],
    patron: new RegExp(String.raw`${RELOJ_POR_NOMBRE}(?:${GETTER_DE_DIA}|${CORTE})`),
    remedio:
      'el día de un instante es `diaDelNegocio(ahora)`/`diaDelNegocioUtc(ahora)` de `comun/fecha-negocio.ts`, no su parte UTC',
  },
  {
    clave: 'hoy-crudo',
    lados: ['backend'],
    patron: new RegExp(String.raw`\bhoy\w*\s*(?::\s*Date\s*)?=\s*${RELOJ}`),
    remedio:
      'una variable que se llama «hoy» no es el instante del reloj: es `hoyDelNegocioUtc()` de `comun/fecha-negocio.ts`',
  },
  {
    clave: 'reloj-a-funcion',
    lados: ['backend'],
    // `aFechaIso(new Date())`, `inicioSemana(new Date())`: el reloj crudo entregado a quien lo corta.
    patron: new RegExp(
      String.raw`\b(?!hoyDelNegocio\b|hoyDelNegocioUtc\b|diaDelNegocio\b|diaDelNegocioUtc\b|fechaDelActo\b)\w+\s*\(\s*${RELOJ}\s*\)`,
    ),
    remedio:
      'si lo que hace falta es el DÍA, es `hoyDelNegocio()`/`hoyDelNegocioUtc()` de `comun/fecha-negocio.ts`',
  },
  {
    clave: 'reloj-en-fecha',
    lados: ['backend'],
    // El caso del kardex: un campo `fecha…` (casi siempre `@db.Date`) recibe el instante crudo.
    // También dentro de un filtro de la MISMA línea: `fecha: { lte: new Date() }`.
    patron: new RegExp(String.raw`\bfecha\w*\s*:\s*(?:\{[^}]*?)?${RELOJ}`),
    remedio:
      'una columna de DÍA se llena con `hoyDelNegocioUtc()`; si de verdad es un sello de tiempo, decláralo en las excepciones',
  },
  {
    clave: 'reloj-por-omision',
    lados: ['backend'],
    // `datos.fecha === undefined ? new Date() : …` y `opciones.corte ?? new Date()`.
    patron: new RegExp(String.raw`(?:\?\?|\?)\s*${RELOJ}`),
    remedio:
      'el «hoy» por omisión es `hoyDelNegocioUtc()`; si es un sello de tiempo, decláralo en las excepciones',
  },
  {
    clave: 'instante-cortado',
    lados: ['backend'],
    // Los campos `…En` son SELLOS DE TIEMPO por convención (`creadoEn`, `cerradaEn`, …): su día no es
    // su parte UTC. (Las columnas `@db.Date` sí se leen así, y no se llaman `…En`.)
    patron: new RegExp(String.raw`\b\w+En\b\)?\s*\??\s*\.\s*${CORTE}`),
    remedio:
      'el día de un sello de tiempo es `diaDelNegocio(x)` (texto) o `diaDelNegocioUtc(x)`; para un mensaje, `fechaDelActo(x)` — todos de `comun/fecha-negocio.ts`',
  },
  {
    clave: 'borde-utc-de-instante',
    lados: ['backend'],
    modo: 'bloque',
    patron: /\b\w+En\s*:\s*\{/,
    remedio:
      'un filtro «del día X» sobre un sello de tiempo va de `inicioDelDiaDelNegocio(x)` a `inicioDelDiaSiguienteDelNegocio(y)`, no de `T00:00:00Z` a `+ 86_400_000`',
  },
  {
    clave: 'dia-de-postgres',
    lados: ['backend'],
    patron: new RegExp(
      [
        String.raw`\bCURRENT_DATE\b`,
        String.raw`\b(?:now\s*\(\s*\)|current_timestamp|localtimestamp)\s*::\s*date\b`,
        String.raw`\b\w+_en"?\s*::\s*date\b`,
        String.raw`\bDATE\s*\(\s*[\w."]*_en"?\s*\)`,
        String.raw`\bCAST\s*\(\s*[\w."]*_en"?\s+AS\s+date\b`,
        String.raw`\bdate_trunc\s*\(\s*'\w+'\s*,\s*(?:now\s*\(\s*\)|current_timestamp|[\w."]*_en"?)`,
        String.raw`\b(?:EXTRACT\s*\(\s*\w+\s+FROM|date_part\s*\(\s*'\w+'\s*,)\s*"?[\w.]*_en\b`,
        String.raw`\bCOALESCE\s*\([^)]*,\s*"?[\w.]*_en"?\s*\)`,
        String.raw`\b\w+_en"?\s*::\s*timestamp\w*\s*::\s*date\b`,
        String.raw`\bto_char\s*\(\s*"?[\w.]*_en\b`,
        String.raw`\b\w+_en"?\s*(?:>=?|<=?|=|BETWEEN)\s*(?:\$\{[^}]*\}|\$\d+)\s*::\s*date\b`,
      ].join('|'),
      'i',
    ),
    remedio:
      "Postgres corre en UTC: «hoy» es `${hoyDelNegocio()}::date`, y el día de una columna `*_en` es `((x_en AT TIME ZONE 'UTC') AT TIME ZONE ${ZONA_DEL_NEGOCIO})::date`",
  },
  {
    clave: 'fecha-sin-huso',
    lados: ['backend'],
    modo: 'llamada',
    patron:
      /\b(?:toLocaleDateString|toLocaleTimeString)\s*\(|new\s+Date\s*\([^()]*\)\s*\.\s*toLocaleString\s*\(/,
    remedio:
      'el servidor corre en UTC: pásale `timeZone: ZONA_DEL_NEGOCIO` (o usa `fechaDelActo`), o la fecha sale en el día y la hora de Londres',
  },
  // ── LOS DOS LADOS ──────────────────────────────────────────────────────────────────────────────
  {
    clave: 'intl-sin-huso',
    lados: ['frontend', 'backend'],
    modo: 'llamada',
    // Con y sin `new` (los dos construyen el formateador).
    patron: /\b(?:new\s+)?Intl\.DateTimeFormat\s*\(/,
    remedio: 'un `Intl.DateTimeFormat` de fechas lleva `timeZone: ZONA_DEL_NEGOCIO`',
  },
];

interface Excepcion {
  archivo: string;
  regla: string;
  /** Si viene, la excepción cubre SÓLO los hallazgos cuya línea contiene este texto. */
  contiene?: string;
  razon: string;
}

/**
 * Las ÚNICAS excepciones, cada una con su razón. Si una deja de casar con algún hallazgo, sobra y la
 * prueba lo dice.
 */
const EXCEPCIONES: readonly Excepcion[] = [
  ...['iso-cortado', 'getters-utc', 'reloj', 'dia-como-utc'].map((regla) => ({
    archivo: 'frontend/src/lib/fecha-negocio.ts',
    regla,
    razon:
      'ES la fuente: lee el reloj UNA vez con el huso del negocio, y hace la aritmética de calendario sobre el día anclado a medianoche UTC (donde un día dura siempre 24 h).',
  })),
  {
    archivo: 'frontend/src/modulos/empresas/DialogoConfiguracion.tsx',
    regla: 'dia-como-utc',
    razon:
      'convierte una FECHA tecleada (sin hora) al date-time que pide el contrato y la lee de vuelta con `.slice(0, 10)`: es la representación del día, no un instante ni «hoy».',
  },
  {
    archivo: 'backend/src/dominio/ruta-critica/cpm.ts',
    regla: 'hoy-por-nombre',
    razon:
      '`proyectarColchonForward` trunca el `hoy` que RECIBE; quien llama (`analisisRc`) ya se lo pasa como día del negocio (`hoyDelNegocioUtc`), así que el truncado es identidad.',
  },
  // ── Sellos de tiempo de verdad (columna sin `@db.Date`): un instante, no un día. ──────────────
  {
    archivo: 'backend/src/dominio/compras/ordenes-compra.ts',
    regla: 'reloj-en-fecha',
    contiene: 'fechaAutorizado: new Date()',
    razon:
      '`OrdenCompra.fechaAutorizado` es un SELLO DE TIEMPO (columna sin `@db.Date`) de cuándo se autorizó; quien necesita su DÍA lo pasa por `diaDelNegocioUtc` (la RC, fila 0.230).',
  },
  {
    archivo: 'backend/src/dominio/ruta-critica/rutaOrden.ts',
    regla: 'reloj-en-fecha',
    contiene: 'fechaProgramada: new Date()',
    razon:
      '`Orden.fechaProgramada` es un SELLO DE TIEMPO (columna sin `@db.Date`) de cuándo se programó la RC; viaja como date-time completo.',
  },
  {
    archivo: 'backend/src/dominio/ruta-critica/cumplimiento.ts',
    regla: 'reloj-en-fecha',
    contiene: 'fechaHecho: new Date()',
    razon:
      '`RutaOrdenChecklist.fechaHecho` es un SELLO DE TIEMPO (columna sin `@db.Date`) de cuándo se palomeó el renglón.',
  },
  {
    archivo: 'backend/src/dominio/desarrollo/pendientes-linea.ts',
    regla: 'reloj-por-omision',
    contiene: "cambios['resueltoEn']",
    razon: '`resueltoEn` es un SELLO DE TIEMPO (cuándo se resolvió el pendiente), no un día.',
  },
  {
    archivo: 'backend/migracion/loaders/ordenes-compra.ts',
    regla: 'reloj-por-omision',
    contiene: 'const canceladaEn',
    razon:
      '`OrdenCompra.canceladaEn` es un SELLO DE TIEMPO; el ETL usa la hora de la carga sólo cuando el histórico no trae fecha de cancelación.',
  },
];

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

/** Los `.ts`/`.tsx` de código (las pruebas, los `.d.ts` y lo generado no cuentan). */
function fuentes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      return entrada.name === 'generated' || entrada.name === 'node_modules' ? [] : fuentes(ruta);
    }
    const esCodigo = /\.tsx?$/.test(entrada.name) && !/\.d\.ts$/.test(entrada.name);
    const esPrueba = /\.test\.tsx?$/.test(entrada.name);
    const esGenerado = entrada.name === 'esquema.gen.ts';
    return esCodigo && !esPrueba && !esGenerado ? [ruta] : [];
  });
}

/**
 * Quita los comentarios conservando los saltos de línea (para que los números de línea sigan
 * siendo los del archivo). Los comentarios hablan del defecto —«no es `toISOString()`»— y no
 * deben contar como uso. Un `//` precedido de `:` o de comilla (una URL, un texto) se respeta.
 */
function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** Desde `inicio` (justo DESPUÉS del delimitador que abre), el texto hasta su cierre balanceado. */
function hastaElCierre(texto: string, inicio: number, abre: string, cierra: string): string {
  let profundidad = 1;
  let i = inicio;
  for (; i < texto.length && profundidad > 0; i += 1) {
    if (texto[i] === abre) profundidad += 1;
    else if (texto[i] === cierra) profundidad -= 1;
  }
  return texto.slice(inicio, i);
}

/** Números de línea de las cabezas de `patron` cuyo cuerpo cumple `delata`. */
function cabezasQue(
  texto: string,
  patron: RegExp,
  abre: string,
  cierra: string,
  delata: (cuerpo: string) => boolean,
): number[] {
  const lineas: number[] = [];
  const cabeza = new RegExp(patron.source, `${patron.flags.replace('g', '')}g`);
  for (let m = cabeza.exec(texto); m !== null; m = cabeza.exec(texto)) {
    if (delata(hastaElCierre(texto, m.index + m[0].length, abre, cierra))) {
      lineas.push(texto.slice(0, m.index).split('\n').length);
    }
  }
  return lineas;
}

interface Hallazgo {
  archivo: string;
  linea: number;
  regla: string;
  texto: string;
}

/** Aplica las reglas de un lado a un texto. PURA: la usa también el control. */
function hallazgosEn(archivo: string, lado: Lado, crudo: string): Hallazgo[] {
  const texto = sinComentarios(crudo);
  const lineas = texto.split('\n');
  const hallazgos: Hallazgo[] = [];
  for (const regla of REGLAS.filter((r) => r.lados.includes(lado))) {
    const numeros =
      regla.modo === 'llamada'
        ? cabezasQue(texto, regla.patron, '(', ')', (cuerpo) => !/\btimeZone\s*:/.test(cuerpo))
        : regla.modo === 'bloque'
          ? cabezasQue(texto, regla.patron, '{', '}', (cuerpo) => BORDE_UTC.test(cuerpo))
          : lineas.flatMap((l, i) => (regla.patron.test(l) ? [i + 1] : []));
    for (const linea of numeros) {
      hallazgos.push({
        archivo,
        linea,
        regla: regla.clave,
        texto: (crudo.split('\n')[linea - 1] ?? '').trim(),
      });
    }
  }
  return hallazgos;
}

const ARBOLES: readonly { ruta: string; lado: Lado }[] = [
  { ruta: 'frontend/src', lado: 'frontend' },
  { ruta: 'backend/src', lado: 'backend' },
  { ruta: 'backend/migracion', lado: 'backend' },
];

function barrer(
  raiz: string,
  ruta: string,
  lado: Lado,
): { archivos: number; hallazgos: Hallazgo[] } {
  const archivos = fuentes(join(raiz, ruta));
  const hallazgos = archivos.flatMap((r) =>
    hallazgosEn(relative(raiz, r).split('\\').join('/'), lado, readFileSync(r, 'utf8')),
  );
  return { archivos: archivos.length, hallazgos };
}

function excepcionDe(h: Hallazgo): Excepcion | undefined {
  return EXCEPCIONES.find(
    (e) =>
      e.archivo === h.archivo &&
      e.regla === h.regla &&
      (e.contiene === undefined || h.texto.includes(e.contiene)),
  );
}

function describir(h: Hallazgo): string {
  const remedio = REGLAS.find((r) => r.clave === h.regla)?.remedio ?? '';
  return `${h.archivo}:${String(h.linea)} [${h.regla}] ${h.texto}\n    → ${remedio}`;
}

describe('ninguna fecha de negocio se calcula en UTC fuera de su fuente (fila 0.230)', () => {
  const raiz = raizDelRepo();
  const barridos = ARBOLES.map((a) => ({ ...a, ...barrer(raiz, a.ruta, a.lado) }));
  const todos = barridos.flatMap((b) => b.hallazgos);

  it('barrió los tres árboles de verdad (una ruta mal puesta daría «cero hallazgos» en verde)', () => {
    const [front, back, etl] = barridos;
    expect(front?.archivos).toBeGreaterThan(200);
    expect(back?.archivos).toBeGreaterThan(200);
    expect(etl?.archivos).toBeGreaterThan(20);
  });

  it.each(ARBOLES.map((a) => a.ruta))(
    '⭐ `%s` no calcula días en UTC fuera de su fuente',
    (ruta) => {
      const fuera = (barridos.find((b) => b.ruta === ruta)?.hallazgos ?? [])
        .filter((h) => excepcionDe(h) === undefined)
        .map(describir);
      expect(fuera, `Cálculos de fecha en UTC:\n${fuera.join('\n')}`).toEqual([]);
    },
  );

  it('cada excepción declarada sigue haciendo falta (si sobra, se quita de la lista)', () => {
    const sobrantes = EXCEPCIONES.filter((e) => !todos.some((h) => excepcionDe(h) === e)).map(
      (e) => `${e.archivo} [${e.regla}]${e.contiene === undefined ? '' : ` «${e.contiene}»`}`,
    );
    expect(sobrantes, `Excepciones que ya no casan con nada:\n${sobrantes.join('\n')}`).toEqual([]);
  });

  it('cada excepción dice por qué', () => {
    for (const e of EXCEPCIONES) {
      expect(e.razon.length, e.archivo).toBeGreaterThan(40);
    }
  });
});

/**
 * CONTROL: el guardián NO es ciego. Cada forma del defecto —las que existieron en el código y las
 * que metió el reviewer de la 0.230— tiene que salir como hallazgo de SU regla, y su versión
 * correcta no.
 */
describe('control: el guardián reconoce el defecto en cada una de sus formas', () => {
  const casos: readonly [Lado, string, string][] = [
    ['frontend', 'iso-cortado', 'return new Date().toISOString().slice(0, 10);'],
    ['frontend', 'iso-cortado', "const dia = fecha.toISOString().split('T')[0];"],
    ['frontend', 'iso-cortado', 'const dia = d.toJSON().slice(0, 10);'],
    ['frontend', 'getters-utc', 'const d = new Date(Date.UTC(f.getUTCFullYear(), 0, 1));'],
    ['frontend', 'getters-utc', 'd.setUTCDate(d.getUTCDate() + 6);'],
    ['frontend', 'reloj', 'const [anio] = useState(new Date().getFullYear());'],
    ['frontend', 'reloj', 'const ahora = new Date(Date.now());'],
    ['frontend', 'reloj', 'const manana = new Date(Date.now() + 86_400_000);'],
    ['frontend', 'dia-como-utc', 'desde: new Date(`${desde}T00:00:00.000Z`).toISOString(),'],
    [
      'frontend',
      'intl-sin-huso',
      "const f = new Intl.DateTimeFormat('es-MX', { day: 'numeric' });",
    ],
    ['backend', 'hoy-del-reloj', 'fecha: new Date().toISOString().slice(0, 10),'],
    ['backend', 'hoy-del-reloj', 'const anio = new Date().getFullYear();'],
    ['backend', 'hoy-del-reloj', 'const dia = new Date(Date.now()).toISOString().slice(0, 10);'],
    [
      'backend',
      'hoy-del-reloj',
      'const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);',
    ],
    ['backend', 'hoy-por-nombre', 'return new Date(Date.UTC(ahora.getUTCFullYear(), 0, 1));'],
    ['backend', 'hoy-por-nombre', 'const iso = hoy.toISOString().slice(0, 10);'],
    ['backend', 'hoy-crudo', 'const hoy = new Date();'],
    ['backend', 'hoy-crudo', '  hoy: Date = new Date(),'],
    ['backend', 'reloj-a-funcion', 'const hoy = aFechaIso(new Date());'],
    ['backend', 'reloj-en-fecha', '        fecha: new Date(),'],
    ['backend', 'reloj-en-fecha', 'where: { fecha: { lte: new Date() } },'],
    ['backend', 'reloj-en-fecha', 'fecha: new Date(Date.now() + 3 * 86_400_000),'],
    ['backend', 'reloj-por-omision', 'const fecha = datos.fecha === undefined ? new Date() : x;'],
    ['backend', 'reloj-por-omision', 'const corte = opciones.corte ?? new Date();'],
    ['backend', 'instante-cortado', 'fecha: c.creadoEn.toISOString().slice(0, 10),'],
    ['backend', 'instante-cortado', "const dia = x.cerradaEn?.toISOString().split('T')[0];"],
    ['backend', 'instante-cortado', 'const dia = x.creadoEn.toJSON().slice(0, 10);'],
    [
      'backend',
      'borde-utc-de-instante',
      'creadoEn: {\n  gte: new Date(`${desde}T00:00:00.000Z`),\n  lt: x,\n},',
    ],
    [
      'backend',
      'borde-utc-de-instante',
      'creadoEn: { gte: aDateColumna(d), lt: new Date(aDateColumna(h).getTime() + 86_400_000) },',
    ],
    ['backend', 'dia-de-postgres', '(CURRENT_DATE - m."fecha_vencimiento")::int AS "diasAtraso",'],
    ['backend', 'dia-de-postgres', '"creado_en"::date AS "fecha_base",'],
    ['backend', 'dia-de-postgres', 'SELECT creado_en::date FROM esma_cargo'],
    ['backend', 'dia-de-postgres', 'WHERE fecha <= now()::date'],
    ['backend', 'dia-de-postgres', 'SELECT DATE("creado_en") FROM x'],
    ['backend', 'dia-de-postgres', 'SELECT CAST("creado_en" AS date) FROM x'],
    ['backend', 'dia-de-postgres', "WHERE x > date_trunc('day', now())"],
    ['backend', 'dia-de-postgres', 'SELECT creado_en::timestamp::date FROM x'],
    ['backend', 'dia-de-postgres', "SELECT to_char(c.creado_en, 'YYYY-MM-DD') FROM x"],
    ['backend', 'dia-de-postgres', 'WHERE "creado_en" >= ${desde}::date'],
    ['backend', 'dia-de-postgres', 'WHERE creado_en < $2::date'],
    ['backend', 'dia-de-postgres', 'EXTRACT(MONTH FROM creado_en) = 10'],
    ['backend', 'dia-de-postgres', "date_part('year', p.creado_en) = 2026"],
    [
      'backend',
      'dia-de-postgres',
      'const f = Prisma.sql`COALESCE(fecha_hasta, fecha_de, fecha_pedido, creado_en)`;',
    ],
    [
      'backend',
      'fecha-sin-huso',
      "return new Date().toLocaleDateString('es-MX', {\n  day: '2-digit',\n});",
    ],
    [
      'backend',
      'fecha-sin-huso',
      "return `Datos al: ${new Date(datosAl).toLocaleString('es-MX')}`;",
    ],
    ['backend', 'intl-sin-huso', "new Intl.DateTimeFormat('es-MX', {\n  month: 'long',\n})"],
    ['backend', 'intl-sin-huso', "const f = Intl.DateTimeFormat('es-MX', { month: 'long' });"],
    ['frontend', 'intl-sin-huso', "Intl.DateTimeFormat('es-MX').format(x)"],
    ['backend', 'borde-utc-de-instante', 'creadoEn: { gte: new Date(desde), lt: x },'],
    // `timeZoneName` NO es `timeZone`: pide el NOMBRE del huso del navegador, no lo fija.
    [
      'backend',
      'intl-sin-huso',
      "new Intl.DateTimeFormat('en-US', { timeZoneName: 'longOffset' })",
    ],
  ];

  it.each(casos)('[%s] %s caza: %s', (lado, regla, codigo) => {
    const reglas = hallazgosEn('x.ts', lado, codigo).map((h) => h.regla);
    expect(reglas).toContain(regla);
  });

  const limpios: readonly [Lado, string][] = [
    ['frontend', 'const [fecha] = useState(hoy());'],
    ['frontend', '// antes: new Date().toISOString().slice(0, 10) proponía mañana'],
    ['frontend', '/* nada de new Date() aquí */ const x = 1;'],
    ['frontend', "const url = 'https://ejemplo.mx//ruta';"],
    ['frontend', 'const f = new Date(a, m - 1, d);'],
    ['frontend', "new Intl.DateTimeFormat('es-MX', { timeZone: ZONA_DEL_NEGOCIO })"],
    ['backend', 'fecha: m.fecha.toISOString().slice(0, 10),'],
    ['backend', 'hora: new Date().toISOString(),'],
    ['backend', 'canceladoEn: new Date(),'],
    ['backend', "return fecha.toLocaleDateString('es-MX', { timeZone: ZONA_DEL_NEGOCIO });"],
    ['backend', 'const hoy = hoyDelNegocioUtc(ahora);'],
    ['backend', 'const fecha = hoyDelNegocioUtc(new Date());'],
    ['backend', 'const ahora = new Date();'],
    ['backend', "const total = valor.toLocaleString('es-MX');"],
    ['backend', "texto: new Date(x).toLocaleString('es-MX', { timeZone: ZONA_DEL_NEGOCIO }),"],
    ['backend', 'creadoEn: c.creadoEn.toISOString(),'],
    ['backend', 'fecha: diaDelNegocio(c.creadoEn),'],
    ['backend', 'fecha: datos.fecha === undefined ? hoyDelNegocioUtc() : new Date(datos.fecha),'],
    [
      'backend',
      'creadoEn: { gte: inicioDelDiaDelNegocio(d), lt: inicioDelDiaSiguienteDelNegocio(h) },',
    ],
    ['backend', 'fecha: { gte: aDateColumna(d), lte: aDateColumna(h) },'],
    ['backend', 'const hoy = Prisma.sql`${hoyDelNegocio()}::date`;'],
    ['backend', "((creado_en AT TIME ZONE 'UTC') AT TIME ZONE ${ZONA_DEL_NEGOCIO})::date"],
    ['backend', 'SELECT m."fecha"::date FROM movimientos m'],
    ['backend', 'EXTRACT(MONTH FROM ${fechaEntrega}) = ${filtros.mes}'],
    ['backend', 'COALESCE(fecha_hasta, fecha_de)'],
    ['backend', 'const x = obj?.campo ?? null;'],
    ['backend', 'const limite = new Date(Date.now() - 60_000);'],
    ['backend', 'fecha: { lte: hoyDelNegocioUtc() },'],
    ['backend', 'creadoEn: { gte: inicioDelDiaDelNegocio(desde) },'],
    ['backend', "SELECT to_char(fecha, 'YYYY-MM-DD') FROM movimientos"],
    ['backend', 'WHERE "fecha" >= ${desde}::date'],
    ['backend', 'const opciones: Intl.DateTimeFormatOptions = { day: "numeric" };'],
    ['backend', "Intl.DateTimeFormat('es-MX', { timeZone: ZONA_DEL_NEGOCIO }).format(x)"],
  ];

  it.each(limpios)('[%s] no confunde lo correcto con el defecto: %s', (lado, codigo) => {
    expect(hallazgosEn('x.ts', lado, codigo)).toEqual([]);
  });
});
