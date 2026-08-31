/**
 * Reglas PURAS de la nomenclatura de modelos (§Post-F9.34 + §Post-F9.46, V1-E3n). Sin base de
 * datos: aquí se fija que los códigos se ARMEN y se LEAN bien, y que el aviso de congruencia
 * hable del par correcto — y, con una transacción de mentiras que emula la secuencia global, de
 * qué está hecha la CLAVE del consecutivo de desarrollo (§Post-F9.108 «✅ RESUELTO»: cliente + año,
 * sin el par) y DESDE DÓNDE arranca esa serie (V1-E7h: el piso del catálogo, el defecto que
 * reportó Daniel). La parte que necesita la ocupación real del catálogo (propuesta del hueco libre,
 * promoción) y la atomicidad de verdad contra Postgres viven en `nomenclatura.int.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  armarCodigoDesarrollo,
  avisosDeCongruencia,
  codigoDeNumeroProduccion,
  consecutivoDeCodigoDesarrollo,
  derivarModeloDeProduccion,
  digitosDeCodigoDesarrollo,
  MAX_INTENTOS_CODIGO_DESARROLLO,
  mintearCodigoDesarrollo,
  numeroProduccionDeCodigo,
  parDe,
  parTexto,
  promoverAProduccionNucleo,
  prefijoCodigoDesarrollo,
  type DigitosModelo,
} from './nomenclatura.js';

describe('numeroProduccionDeCodigo', () => {
  it('convierte un código de 5 dígitos en su número', () => {
    expect(numeroProduccionDeCodigo('71001')).toBe(71_001);
    // Concepto 2 + género 0 (Bebo): el par puede empezar bajo, nunca en 0.
    expect(numeroProduccionDeCodigo('20134')).toBe(20_134);
  });

  it('devuelve null para los códigos históricos que NO son 5 dígitos', () => {
    // Los 285 modelos del Access con variante o clave a mano: no ocupan consecutivo.
    for (const codigo of ['51783a', '71240-1', 'M-18', '501', '235713', '']) {
      expect(numeroProduccionDeCodigo(codigo)).toBeNull();
    }
  });

  it('respeta los ceros a la izquierda al ida y vuelta', () => {
    expect(numeroProduccionDeCodigo('00123')).toBe(123);
    expect(codigoDeNumeroProduccion(123)).toBe('00123');
    expect(codigoDeNumeroProduccion(71_001)).toBe('71001');
  });
});

describe('parDe / parTexto', () => {
  it('junta concepto y género en los dos dígitos del código', () => {
    expect(parDe(7, 1)).toBe(71);
    expect(parTexto(7, 1)).toBe('71');
    // Género 0 (Bebo): el par conserva el cero, no se colapsa a "2".
    expect(parTexto(2, 0)).toBe('20');
    expect(parDe(2, 0)).toBe(20);
  });
});

describe('armarCodigoDesarrollo', () => {
  it('arma el CYA-26-71-001 del ejemplo de Daniel', () => {
    expect(armarCodigoDesarrollo('CYA', 2026, 7, 1, 1)).toBe('CYA-26-71-001');
  });

  it('usa los DOS últimos dígitos del año de entrega y rellena el consecutivo a tres', () => {
    expect(armarCodigoDesarrollo('LIV', 2030, 5, 2, 47)).toBe('LIV-30-52-047');
    expect(armarCodigoDesarrollo('LIV', 2007, 5, 2, 47)).toBe('LIV-07-52-047');
  });

  it('no trunca un consecutivo de más de tres dígitos', () => {
    expect(armarCodigoDesarrollo('CYA', 2026, 7, 1, 1000)).toBe('CYA-26-71-1000');
  });
});

describe('digitosDeCodigoDesarrollo', () => {
  it('lee el concepto y el género de un código de desarrollo', () => {
    expect(digitosDeCodigoDesarrollo('CYA-26-71-001')).toEqual({ concepto: 7, genero: 1 });
    // El género 0 (Bebo) se lee como 0, no como "sin género".
    expect(digitosDeCodigoDesarrollo('LIV-27-20-013')).toEqual({ concepto: 2, genero: 0 });
  });

  it('devuelve null para lo que no tiene la forma de un código de desarrollo', () => {
    for (const codigo of ['71001', 'CYA-2026-71-001', 'CYA-26-7-001', 'M-18', 'CYA-26-71-01']) {
      expect(digitosDeCodigoDesarrollo(codigo)).toBeNull();
    }
  });
});

describe('avisosDeCongruencia', () => {
  const caballero: DigitosModelo = {
    concepto: 7,
    genero: 1,
    generoAlterno: 5,
    fuente: 'catalogo',
  };
  const dama: DigitosModelo = { concepto: 7, genero: 2, generoAlterno: null, fuente: 'catalogo' };

  it('no avisa nada cuando los dos primeros dígitos cuadran', () => {
    expect(avisosDeCongruencia(71_001, caballero)).toEqual([]);
  });

  it('no avisa cuando el número cae en la serie de CONTINUACIÓN del género (Caballero 1→5)', () => {
    expect(avisosDeCongruencia(75_004, caballero)).toEqual([]);
  });

  it('avisa —nombrando el par capturado y el esperado— cuando NO cuadran, pero no bloquea', () => {
    const avisos = avisosDeCongruencia(51_004, caballero);
    expect(avisos).toHaveLength(1);
    // El aviso tiene que decir QUÉ par se capturó (51) y CUÁL se esperaba (71); si sólo dijera
    // "no corresponde" no serviría para corregirlo.
    expect(avisos[0]).toContain('(51)');
    expect(avisos[0]).toContain('(71)');
    expect(avisos[0]).toContain('la excepción es tuya');
  });

  it('sin serie de continuación, el par alterno del OTRO género también avisa', () => {
    // 75xxx sería la continuación de Caballero; para DAMA (par 72) es un par ajeno y debe avisar.
    const avisos = avisosDeCongruencia(75_004, dama);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('(75)');
    expect(avisos[0]).toContain('(72)');
  });
});

// ── El consecutivo de DESARROLLO: de qué está hecha la clave ────────────────────────

/** Filtro de texto de Prisma, tal como los arma el dominio (`equals` o `startsWith`, con `mode`). */
interface FiltroTexto {
  equals?: string;
  startsWith?: string;
  mode?: string;
}

/**
 * Evalúa UN filtro de Prisma sobre UN valor, como lo haría Postgres. Dos cosas a propósito, que no
 * se pueden aflojar:
 *
 *  • **el `mode` se OBEDECE, no se da por hecho** — Postgres compara la caja salvo que el filtro
 *    pida `insensitive`, y si esta BD de mentiras ignorara la bandera, las pruebas del choque por
 *    CAJA pasarían igual con un dominio sensible: serían huecas (comprobado en su día mutando el
 *    `mode` del dominio);
 *  • **un filtro que no sabe emular REVIENTA** en vez de devolver `false`. Si mañana el dominio
 *    cambia a `contains`/`in`/`not`, estas pruebas tienen que morir ruidosamente y no seguir en
 *    verde probando una consulta que ya no es la que corre en producción.
 */
function cumpleFiltro(valor: string | null, filtro: FiltroTexto | undefined): boolean {
  if (filtro === undefined || valor === null) {
    return false;
  }
  const insensible = filtro.mode === 'insensitive';
  const izquierda = insensible ? valor.toUpperCase() : valor;
  if (filtro.equals !== undefined) {
    return izquierda === (insensible ? filtro.equals.toUpperCase() : filtro.equals);
  }
  if (filtro.startsWith !== undefined) {
    return izquierda.startsWith(insensible ? filtro.startsWith.toUpperCase() : filtro.startsWith);
  }
  throw new Error(`Filtro no emulado por la tx falsa: ${JSON.stringify(filtro)}`);
}

/** Un modelo de la base de mentiras, con las dos columnas que pueden llevar código de desarrollo. */
interface ModeloFalso {
  codigo: string;
  codigoDesarrollo: string | null;
}

/**
 * ¿Alguna rama del `OR` casa con este modelo?
 *
 * ⚠️ Se recorren TODAS las ramas y cada una mira SU columna. Mirar sólo `OR[0].codigo` colapsaría
 * las dos ramas en una: la de `codigoDesarrollo` no la ejercitaría nadie y se podría borrar del
 * dominio con la suite en verde (así estaba, y así lo cazó el reviewer).
 */
function casaConElOr(
  modelo: ModeloFalso,
  ramas: Record<string, FiltroTexto | undefined>[],
): boolean {
  return ramas.some((rama) =>
    Object.entries(rama).some(([columna, filtro]) =>
      cumpleFiltro(columna === 'codigo' ? modelo.codigo : modelo.codigoDesarrollo, filtro),
    ),
  );
}

/**
 * Transacción de mentiras que emula lo MÍNIMO que `mintearCodigoDesarrollo` toca:
 *
 *  • `cliente.findUnique` → los clientes que le pasemos;
 *  • `$queryRaw` → la tabla `secuencias_globales`, con la semántica EXACTA de la sentencia que arma
 *    {@link siguienteFolioGlobal}: `valor = GREATEST(valorActual, piso) + 1`. Sus tres valores
 *    interpolados son `clave, piso, piso` (V1-E7h) y aquí quedan a la vista: son lo que estas
 *    pruebas miran. Se usa la función REAL (no un mock del módulo), así que de paso se comprueba
 *    que la clave pasa su validación de formato; y si el dominio dejara de mandar el piso, el
 *    emulador REVIENTA por la forma de la llamada en vez de quedarse callado;
 *  • `modelo.findMany` → el PISO: qué códigos ve el dominio al preguntar "¿en qué número va de
 *    verdad este cliente+año?";
 *  • `modelo.findFirst` → el centinela anti-colisión: decimos qué códigos están OCUPADOS.
 *
 * La atomicidad de la secuencia bajo concurrencia NO se prueba aquí (eso sólo lo demuestra
 * Postgres, en `nomenclatura.int.test.ts`): aquí se prueba QUÉ serie se pide y DESDE DÓNDE.
 */
function txFalsa(opciones?: {
  clientes?: Record<number, { nombre: string; abreviatura: string | null }>;
  /**
   * Modelos que YA ocupan un código. Un texto suelto = un modelo de desarrollo sin promover (el
   * mismo valor en las DOS columnas, como lo deja el alta); la forma larga permite lo que de
   * verdad distingue las dos ramas del `OR`: un modelo **promovido**, cuyo `codigo` es el de
   * producción (`71001`) y cuyo código de desarrollo vive SÓLO en `codigoDesarrollo`.
   */
  ocupados?: (string | { codigo: string; codigoDesarrollo?: string | null })[];
  /**
   * Estado de arranque de `secuencias_globales`, para reproducir un cliente+año cuyo contador YA
   * avanzó con el criterio anterior (el de Daniel iba en 3 con el catálogo en 007).
   */
  secuencias?: Record<string, number>;
  /**
   * Deja CIEGO al piso (su consulta no devuelve nada) sin tocar al centinela. Es una mentira
   * deliberada y sirve SÓLO para sostener la rama del error "se agotaron los intentos", que con el
   * piso puesto ya no se alcanza por el camino normal. Ninguna prueba de NUMERACIÓN debe usarla.
   */
  pisoCiego?: boolean;
}) {
  const clientes = opciones?.clientes ?? { 1: { nombre: 'C&A', abreviatura: 'CYA' } };
  const ocupados: ModeloFalso[] = (opciones?.ocupados ?? []).map((o) =>
    typeof o === 'string' ? { codigo: o, codigoDesarrollo: o } : { codigoDesarrollo: null, ...o },
  );
  const secuencias = new Map<string, number>(Object.entries(opciones?.secuencias ?? {}));
  const claves: string[] = [];

  const tx = {
    cliente: {
      findUnique: vi.fn((args: { where: { id: number } }) =>
        Promise.resolve(clientes[args.where.id] ?? null),
      ),
    },
    $queryRaw: vi.fn((sql: TemplateStringsArray, ...valores: unknown[]) => {
      // ⚠️ GUARDA DE FORMA. Este emulador no interpreta SQL: aplica de memoria la semántica de UNA
      // sentencia concreta. Por eso comprueba que la sentencia que le llega SEA ésa —tres valores
      // (clave, piso, piso) y un `GREATEST` que adelanta sin retroceder— y REVIENTA si no. Sin la
      // guarda, cambiar el SQL del dominio (quitar el `GREATEST`, dejar de mandar el piso) dejaría
      // estas pruebas en verde emulando una sentencia que ya no existe: probarían la suposición del
      // emulador, no el sistema. Lo que la sentencia HACE de verdad sólo lo demuestra Postgres, en
      // `nomenclatura.int.test.ts`.
      const texto = sql.join('?');
      if (valores.length !== 3 || !texto.includes('GREATEST(')) {
        throw new Error(
          `Este emulador sólo sabe emular el INSERT … ON CONFLICT … GREATEST(valor, piso) + 1 de ` +
            `la secuencia global, con clave + piso + piso; llegaron ${String(valores.length)} ` +
            `valores y el SQL ${texto.includes('GREATEST(') ? 'sí' : 'NO'} lleva GREATEST. Si el ` +
            `dominio cambió el SQL, este emulador cambia con él (y la semántica se re-verifica en ` +
            `la prueba de integración).`,
        );
      }
      const clave = String(valores[0]);
      claves.push(clave);
      // `GREATEST(valor, piso) + 1`: la secuencia ADELANTA hasta el piso, pero nunca retrocede.
      const piso = Number(valores[1]);
      const valor = Math.max(secuencias.get(clave) ?? 0, piso) + 1;
      secuencias.set(clave, valor);
      return Promise.resolve([{ valor: BigInt(valor) }]);
    }),
    modelo: {
      findMany: vi.fn((args: { where: { OR: Record<string, FiltroTexto | undefined>[] } }) =>
        Promise.resolve(
          opciones?.pisoCiego === true
            ? []
            : ocupados.filter((modelo) => casaConElOr(modelo, args.where.OR)),
        ),
      ),
      findFirst: vi.fn((args: { where: { OR: Record<string, FiltroTexto | undefined>[] } }) => {
        const hallado = ocupados.find((modelo) => casaConElOr(modelo, args.where.OR));
        return Promise.resolve(hallado === undefined ? null : { id: 1 });
      }),
    },
  } as unknown as Tx;

  return { tx, claves };
}

/** Atajo: mintea con el par que se le diga, sobre la misma tx de mentiras. */
async function mintear(
  tx: Tx,
  entrada: { idCliente?: number; anioEntrega?: number; concepto: number; genero: number },
): Promise<string> {
  const { codigo } = await mintearCodigoDesarrollo(tx, {
    idCliente: entrada.idCliente ?? 1,
    anioEntrega: entrada.anioEntrega ?? 2026,
    concepto: entrada.concepto,
    genero: entrada.genero,
  });
  return codigo;
}

describe('mintearCodigoDesarrollo — el consecutivo corre por CLIENTE + AÑO', () => {
  /**
   * ⭐ LA decisión de Daniel (25-ago-2026): *"Me gusta solo por cliente por año. O sea 71-001 y el
   * siguiente 72-002"*. Sustituye a §Post-F9.34/§Post-F9.46, donde cada par arrancaba en 001.
   */
  it('dos pares DISTINTOS del mismo cliente+año siguen la MISMA serie: 71-001 → 72-002', async () => {
    const { tx } = txFalsa();
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-001');
    expect(await mintear(tx, { concepto: 7, genero: 2 })).toBe('CYA-26-72-002');
    // Y un tercer par cualquiera sigue contando de corrido, no reinicia.
    expect(await mintear(tx, { concepto: 9, genero: 1 })).toBe('CYA-26-91-003');
  });

  it('el MISMO par también avanza de uno en uno: 71-001 → 71-002', async () => {
    const { tx } = txFalsa();
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-001');
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-002');
  });

  it('la CLAVE de la secuencia es cliente+año y no menciona el par', async () => {
    const { tx, claves } = txFalsa();
    await mintear(tx, { concepto: 7, genero: 1 });
    await mintear(tx, { concepto: 7, genero: 2 });
    // Una sola serie para los dos pares. Si el par volviera a la clave habría DOS claves distintas
    // (`…-2026-71` y `…-2026-72`) y cada una arrancaría en 001 — el criterio viejo.
    expect(claves).toEqual(['modelo-desarrollo-1-2026', 'modelo-desarrollo-1-2026']);
  });

  it('clientes distintos NO comparten contador', async () => {
    const { tx, claves } = txFalsa({
      clientes: {
        1: { nombre: 'C&A', abreviatura: 'CYA' },
        2: { nombre: 'Liverpool', abreviatura: 'LIV' },
      },
    });
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-001');
    expect(await mintear(tx, { idCliente: 2, concepto: 7, genero: 1 })).toBe('LIV-26-71-001');
    expect(claves).toEqual(['modelo-desarrollo-1-2026', 'modelo-desarrollo-2-2026']);
  });

  it('años distintos NO comparten contador (el reinicio anual se conserva)', async () => {
    const { tx, claves } = txFalsa();
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-001');
    expect(await mintear(tx, { anioEntrega: 2027, concepto: 7, genero: 1 })).toBe('CYA-27-71-001');
    expect(claves).toEqual(['modelo-desarrollo-1-2026', 'modelo-desarrollo-1-2027']);
  });
});

// ── ⭐ V1-E7h: DÓNDE ARRANCA la serie ───────────────────────────────────────────────

describe('mintearCodigoDesarrollo — el piso: la serie arranca donde va el catálogo', () => {
  /**
   * ⭐⭐ **EL DEFECTO QUE REPORTÓ DANIEL** (25-ago-2026), reproducido tal cual: un cliente+año cuyos
   * modelos ya llegaban al `007`; mete dos sudaderas y un jogger.
   *
   * Lo que pasaba: el contador ERA por cliente+año (V1-E7a) pero la secuencia de ese cliente
   * NACÍA EN 1, y como el código lleva el par, el centinela sólo choca dentro del MISMO par. Las
   * sudaderas (par 71, sin modelos previos) se llevaron `001` y `002` sin chocar con nadie, y el
   * jogger (par 72, ocupado hasta el 007) fue saltando hasta el `008`. Resultado: **001, 002, 008**
   * — que es EXACTAMENTE lo que producía el criterio viejo por par, con la regla nueva rota.
   *
   * Lo que Daniel espera y lo que esta prueba fija: **008, 009, 010**, de corrido y sin importar la
   * prenda.
   */
  it('⭐ el caso de Daniel: con el catálogo en 007, dos sudaderas y un jogger dan 008, 009 y 010', async () => {
    // Lo que ya tenía ese cliente+año (criterio viejo): joggers de dama hasta el 007.
    const { tx } = txFalsa({
      ocupados: Array.from({ length: 7 }, (_, i) => `CYA-26-72-${String(i + 1).padStart(3, '0')}`),
    });

    const sudadera1 = await mintear(tx, { concepto: 7, genero: 1 });
    const sudadera2 = await mintear(tx, { concepto: 7, genero: 1 });
    const jogger = await mintear(tx, { concepto: 7, genero: 2 });

    expect([sudadera1, sudadera2, jogger]).toEqual([
      'CYA-26-71-008',
      'CYA-26-71-009',
      'CYA-26-72-010',
    ]);
    // Y explícitamente: NO puede volver a salir lo que salió mal. Si la serie arranca en 1 otra
    // vez, las sudaderas se llevan el 001 y el 002 aunque el jogger acabe en el 008.
    expect([sudadera1, sudadera2]).not.toContain('CYA-26-71-001');
    expect([sudadera1, sudadera2]).not.toContain('CYA-26-71-002');
  });

  it('un cliente+año SIN modelos previos sigue arrancando en 001', async () => {
    const { tx } = txFalsa();
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-001');
  });

  /**
   * ⭐ El caso REAL de Daniel al momento de reportarlo: su contador ya había avanzado a 3 (las dos
   * sudaderas y el jogger) mientras el catálogo iba en 7. Sin re-sembrar, la siguiente alta habría
   * pedido el 4. La regla es **la secuencia nunca retrocede, pero sí adelanta**: el piso se
   * recalcula en cada alta, así que el caso de Daniel se corrige SOLO en su próximo modelo, sin
   * script de reparación.
   */
  it('re-siembra al vuelo: si el catálogo va por delante del contador, la serie ADELANTA', async () => {
    const { tx } = txFalsa({
      ocupados: Array.from({ length: 7 }, (_, i) => `CYA-26-72-${String(i + 1).padStart(3, '0')}`),
      secuencias: { 'modelo-desarrollo-1-2026': 3 },
    });
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-008');
  });

  /**
   * La otra mitad de la regla, y la que protege A3: si el contador va POR DELANTE del catálogo
   * —números ya entregados en altas que aún no comitean, o modelos borrados— el piso NO lo baja.
   * Un `GREATEST` cambiado por un `SET valor = piso + 1` re-repartiría números ya dados.
   */
  it('pero NUNCA retrocede: si el contador va por delante del catálogo, manda el contador', async () => {
    const { tx } = txFalsa({
      ocupados: ['CYA-26-71-002'],
      secuencias: { 'modelo-desarrollo-1-2026': 20 },
    });
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-021');
  });

  /**
   * ⭐ El caso MÁS probable de los códigos viejos: un modelo del criterio anterior que YA se pasó a
   * producción. Su `codigo` es el de 5 dígitos (`71001`) y el `CYA-26-71-007` sobrevive **sólo** en
   * `codigoDesarrollo` (D3: el nº de desarrollo se conserva). Si el piso no mirara esa columna,
   * volvería a repartir números que ese cliente+año ya usó.
   */
  it('el piso ve el código de un modelo YA PROMOVIDO, que sólo vive en `codigoDesarrollo`', async () => {
    const { tx } = txFalsa({ ocupados: [{ codigo: '71001', codigoDesarrollo: 'CYA-26-71-007' }] });
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-008');
  });

  /** La rama espejo: un código de desarrollo capturado a mano en `codigo`, sin nº de desarrollo. */
  it('el piso ve un código capturado a mano aunque no tenga `codigoDesarrollo`', async () => {
    const { tx } = txFalsa({
      ocupados: [{ codigo: 'CYA-26-71-007', codigoDesarrollo: null }],
    });
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-008');
  });

  it('el piso cuenta los códigos guardados con OTRA caja', async () => {
    // En la base conviven `CYA-…` y `cya-…`; los dos ocupan el mismo número (el control de
    // duplicados de `crearModelo` es insensible a la caja). Si el piso mirara sólo la caja exacta,
    // este cliente+año volvería a repartir del 001.
    const { tx } = txFalsa({ ocupados: ['cya-26-71-007'] });
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-008');
  });

  it('el piso NO se contagia de otro cliente ni de otro año', async () => {
    const { tx } = txFalsa({
      clientes: {
        1: { nombre: 'C&A', abreviatura: 'CYA' },
        2: { nombre: 'Liverpool', abreviatura: 'LIV' },
      },
      ocupados: ['LIV-26-71-050', 'CYA-27-71-050'],
    });
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-001');
  });

  /**
   * El sufijo de VERSIÓN (V1-E7b) no quema consecutivo: `CYA-26-71-045-02` cuenta como el 45 de su
   * raíz. Leer "los últimos dígitos" del texto daría 2 y hundiría el piso de toda la serie.
   */
  it('una VERSIÓN no infla el piso: cuenta el consecutivo de su raíz', async () => {
    const { tx } = txFalsa({ ocupados: ['CYA-26-71-045', 'CYA-26-71-045-02'] });
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-046');
  });

  /** Pasando de 999 el consecutivo degrada a 4 dígitos; el piso tiene que leerlo igual. */
  it('el piso lee un consecutivo de 4 dígitos', async () => {
    const { tx } = txFalsa({ ocupados: ['CYA-26-71-1000'] });
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-1001');
  });

  /**
   * Lo que no cumple la forma se IGNORA en silencio: el catálogo tiene códigos capturados a mano y
   * migrados del Access que no siguen el patrón, y ninguno puede tumbar un alta ni disparar el piso
   * por un dedazo. El `…-71-99999999999` es el caso feo: si contara, este cliente se quedaría sin
   * poder dar de alta nada.
   */
  it('los códigos que NO siguen el patrón se ignoran, sin reventar y sin mover el piso', async () => {
    const { tx } = txFalsa({
      ocupados: [
        'CYA-26-71-003',
        'CYA-26-M18',
        'CYA-26-712-001',
        'CYA-26-71-99999999999',
        'CYA-26-71-045-BIS',
      ],
    });
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-004');
  });

  /** Nada se renumera: el cambio es PROSPECTIVO (los códigos viejos siguen donde están). */
  it('no renumera nada: los códigos viejos se quedan como están', async () => {
    const { tx } = txFalsa({ ocupados: ['CYA-26-71-001', 'CYA-26-71-002', 'CYA-26-72-001'] });
    const { codigo, consecutivo } = await mintearCodigoDesarrollo(tx, {
      idCliente: 1,
      anioEntrega: 2026,
      concepto: 7,
      genero: 1,
    });
    expect(codigo).toBe('CYA-26-71-003');
    expect(consecutivo).toBe(3);
  });
});

describe('consecutivoDeCodigoDesarrollo — leer el NÚMERO, no el texto', () => {
  // El prefijo sale de la MISMA función que arma los códigos: leerlos y armarlos no pueden
  // separarse (si se separaran, el piso dejaría de ver los códigos que el sistema mismo entrega).
  const prefijo = prefijoCodigoDesarrollo('CYA', 2026);

  it('es el prefijo que arma el propio código', () => {
    expect(prefijo).toBe('CYA-26-');
    expect(armarCodigoDesarrollo('CYA', 2026, 7, 1, 1).startsWith(prefijo)).toBe(true);
  });

  it('lee el consecutivo de un código canónico, con 3 y con 4 dígitos', () => {
    expect(consecutivoDeCodigoDesarrollo('CYA-26-71-001', prefijo)).toBe(1);
    expect(consecutivoDeCodigoDesarrollo('CYA-26-72-007', prefijo)).toBe(7);
    expect(consecutivoDeCodigoDesarrollo('CYA-26-71-1000', prefijo)).toBe(1000);
  });

  it('en una VERSIÓN lee la RAÍZ, no el sufijo', () => {
    expect(consecutivoDeCodigoDesarrollo('CYA-26-71-045-02', prefijo)).toBe(45);
  });

  it('el prefijo se compara sin importar la caja', () => {
    expect(consecutivoDeCodigoDesarrollo('cya-26-71-007', prefijo)).toBe(7);
  });

  it('devuelve null —nunca revienta— para todo lo que no cumple la forma', () => {
    for (const codigo of [
      'LIV-26-71-001', // otro cliente
      'CYA-27-71-001', // otro año
      '71001', // un modelo de producción
      'CYA-26-M18', // capturado a mano
      'CYA-26-71-1', // consecutivo de menos de 3 dígitos
      'CYA-26-712-001', // par de 3 dígitos
      'CYA-26-7A-001', // par no numérico
      'CYA-26-71-045-BIS', // sufijo no numérico
      'CYA-26-71-001-02-03', // más partes de las que existen
      'CYA-26-71-99999999999', // dedazo que dispararía el piso de toda la serie
      'CYA-26-', // sólo el prefijo
    ]) {
      expect(consecutivoDeCodigoDesarrollo(codigo, prefijo)).toBeNull();
    }
  });
});

describe('mintearCodigoDesarrollo — el centinela, última red DETRÁS del piso', () => {
  /**
   * ⚠️ Estas pruebas dejan CIEGO al piso a propósito (`pisoCiego`). Con el piso puesto, el código
   * armado ya casi no puede chocar: chocaría sólo con algo que el piso no alcanza a ver (un código
   * fuera de la forma canónica, un alta simultánea sin comitear). El centinela SIGUE siendo
   * necesario —si entregara un código ocupado, el `@unique` reventaría al insertar y **abortaría la
   * transacción entera del alta**—, y sin cegar el piso no habría forma de ejercitarlo: quedaría
   * como código muerto y se podría borrar con la suite en verde.
   */
  it('con el piso ciego, el centinela salta los códigos ocupados de uno en uno', async () => {
    const { tx } = txFalsa({
      ocupados: ['CYA-26-71-001', 'CYA-26-71-002'],
      pisoCiego: true,
    });
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-003');
  });

  it('el centinela mira las DOS columnas: también el código de un modelo PROMOVIDO', async () => {
    const { tx } = txFalsa({
      ocupados: [{ codigo: '71001', codigoDesarrollo: 'CYA-26-71-001' }],
      pisoCiego: true,
    });
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-002');
  });

  it('el centinela cuenta el choque aunque el código viejo se haya guardado con OTRA caja', async () => {
    // `crearModelo` bloquea duplicados sin importar mayúsculas: si el centinela mirara sólo la
    // caja exacta, devolvería un código que el alta rechazaría después, abortando la transacción.
    const { tx } = txFalsa({ ocupados: ['cya-26-71-001'], pisoCiego: true });
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-002');
  });

  /**
   * El tope tiene que dejar la pared **inalcanzable por construcción**: el consecutivo son 3
   * dígitos, así que un cliente+año no puede tener más de 999 códigos de desarrollo vivos. Con un
   * tope menor (estaba en 50) bastaba un cliente+año con dos pares poblados para agotarlo — y
   * agotarlo es IRRECUPERABLE, porque la secuencia se revierte con la transacción.
   */
  it('el tope de intentos cubre la serie ENTERA de un cliente+año', () => {
    expect(MAX_INTENTOS_CODIGO_DESARROLLO).toBeGreaterThanOrEqual(1000);
  });

  it('si se agotan los intentos avisa del CLIENTE y el AÑO, no de una "serie" por par', async () => {
    // Ocupar la serie entera del par 71 CON el piso ciego: con el piso viendo, esta pared ya no se
    // alcanza (arrancaría en el 1001, libre) — pero el mensaje del error sigue vivo y hay que
    // sostenerlo.
    const todos = Array.from(
      { length: MAX_INTENTOS_CODIGO_DESARROLLO },
      (_, i) => `CYA-26-71-${String(i + 1).padStart(3, '0')}`,
    );
    const { tx } = txFalsa({ ocupados: todos, pisoCiego: true });
    const fallo = mintearCodigoDesarrollo(tx, {
      idCliente: 1,
      anioEntrega: 2026,
      concepto: 7,
      genero: 1,
    });
    await expect(fallo).rejects.toThrow(ErrorConflicto);
    // El mensaje ya NO puede hablar de la "serie 71": esa serie dejó de existir.
    await expect(fallo).rejects.toThrow(/CYA/);
    await expect(fallo).rejects.toThrow(/2026/);
    await expect(fallo).rejects.not.toThrow(/serie 71/);
    // Y tiene que ser ACCIONABLE: quien lo lee necesita saber qué hacer AHORA (capturar el código a
    // mano) y que reintentar no sirve — la secuencia se revierte con la transacción que falló.
    await expect(fallo).rejects.toThrow(/a mano/);
    await expect(fallo).rejects.toThrow(/AVISA/);
    await expect(fallo).rejects.toThrow(/volver a intentarlo va a fallar igual/);
  });
});

// ── ⭐⭐ V1-E9c: LA REVISIÓN **NO** DETIENE LA PROMOCIÓN (§Post-F9.169) ──────

/**
 * 🔴 **Este bloque afirmaba lo contrario hasta V1-E9c, y se invirtió a propósito.** V1-E7d había
 * puesto aquí una COMPUERTA: una VERSIÓN sin revisar no pasaba a producción. Daniel la disolvió
 * (31-ago-2026, §Post-F9.169): *«**Todo lo que no está firmado simplemente no se puede comprar.
 * Pero no detiene ni la producción ni los demás renglones ya firmados.**»*
 *
 * Las pruebas no se borraron: se **dieron vuelta**. Siguen recorriendo exactamente las mismas
 * poblaciones —versión pendiente, sin estado, rechazada, aprobada y modelo normal— pero ahora
 * exigen que **TODAS promuevan**. Así, si alguien vuelve a poner una guarda de revisión en este
 * camino, este bloque muere en vez de quedarse callado. Lo que sí frena el gasto —la liberación por
 * renglón— vive en `../produccion/receta-orden*.test.ts` y no se tocó.
 *
 * El OTRO camino que comparte este núcleo —generar la OP, que promueve el modelo sola— se prueba en
 * `../produccion/salida-produccion.test.ts`.
 *
 * La transacción de mentiras emula lo mínimo que `promoverAProduccionNucleo` toca: el modelo, los
 * dígitos del par (tipo/género), el lock, la ocupación de la serie (`$queryRaw`, vacía = todo
 * libre), el centinela de choque y la escritura + bitácora. No filtra `where`: por eso lo que se
 * afirma es QUÉ se llamó y qué NO, nunca el resultado de una consulta.
 */
function txPromocion(modelo: Record<string, unknown> | null): {
  tx: Tx;
  llamadas: { metodo: string; args: unknown }[];
} {
  const llamadas: { metodo: string; args: unknown }[] = [];
  const reg = <T>(metodo: string, args: unknown, resultado: T): Promise<T> => {
    llamadas.push({ metodo, args });
    return Promise.resolve(resultado);
  };
  const tx = {
    modelo: {
      findUnique: (args: unknown) => reg('modelo.findUnique', args, modelo),
      findFirst: (args: unknown) => reg('modelo.findFirst', args, null),
      update: (args: unknown) => reg('modelo.update', args, {}),
    },
    tipoProducto: {
      findUnique: (args: unknown) =>
        reg('tipoProducto.findUnique', args, { nombre: 'Pantalón', digitoConcepto: 7 }),
    },
    genero: {
      findUnique: (args: unknown) =>
        reg('genero.findUnique', args, {
          nombre: 'Caballero',
          digitoNomenclatura: 1,
          digitoAlterno: 5,
        }),
    },
    $executeRaw: (plantilla: TemplateStringsArray, ...valores: unknown[]) =>
      reg('$executeRaw', { sql: plantilla.join('?'), valores }, 1),
    $queryRaw: (plantilla: TemplateStringsArray, ...valores: unknown[]) =>
      reg('$queryRaw', { sql: plantilla.join('?'), valores }, []),
    bitacora: { create: (args: unknown) => reg('bitacora.create', args, {}) },
  };
  return { tx: tx as unknown as Tx, llamadas };
}

/** Un modelo de desarrollo listo para promoverse; `extra` dice qué lo distingue. */
function paraPromover(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 42,
    codigo: 'CYA-26-71-001',
    codigoDesarrollo: 'CYA-26-71-001',
    origen: 'desarrollo',
    numeroProduccion: null,
    idTipoProducto: 5,
    idGenero: 4,
    idModeloPadre: null,
    versionDesarrollo: null,
    idModeloDesarrollo: null,
    revisionEstado: null,
    revisadoEn: null,
    revisionNota: null,
    ...extra,
  };
}

/** Marca los campos que hacen de un modelo una VERSIÓN nacida de la negociación. */
function version(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return paraPromover({
    codigo: 'CYA-26-71-001-01',
    codigoDesarrollo: 'CYA-26-71-001-01',
    idModeloPadre: 7,
    versionDesarrollo: 1,
    revisionEstado: 'pendiente',
    ...extra,
  });
}

const SESION_PROMOCION = sesionDePrueba({ permisos: ['modelos.administrar'] });

describe('promoverAProduccionNucleo — la REVISIÓN ya NO detiene producir (V1-E9c)', () => {
  /** Promueve y comprueba que de verdad se escribió el número, no sólo que no lanzó. */
  async function promueveYEscribe(fila: Record<string, unknown>): Promise<void> {
    const { tx, llamadas } = txPromocion(fila);
    const resultado = await promoverAProduccionNucleo(tx, SESION_PROMOCION, 42);

    expect(resultado.numeroProduccion).toBe(71_001);
    expect(resultado.codigo).toBe('71001');
    expect(llamadas.find((l) => l.metodo === 'modelo.update')?.args).toMatchObject({
      data: { origen: 'produccion', numeroProduccion: 71_001 },
    });
  }

  it('⭐⭐ una VERSIÓN sin revisar SÍ pasa a producción (la compuerta se retiró)', async () => {
    // 🔴 LA PRUEBA DE LA ETAPA. Antes esto era `rejects.toThrow(ErrorConflicto)`.
    await promueveYEscribe(version());
  });

  it('⭐ una versión SIN estado de revisión (null) también pasa', async () => {
    await promueveYEscribe(version({ revisionEstado: null }));
  });

  it('⭐⭐ una versión RECHAZADA también pasa: el rechazo no detiene producir, sólo comprar', async () => {
    // El caso más fuerte de §Post-F9.169: ni siquiera un rechazo explícito frena la producción.
    // Lo que no se puede es COMPRARLE material al renglón sin liberar (`receta-orden.ts`).
    await promueveYEscribe(
      version({
        revisionEstado: 'rechazada',
        revisadoEn: new Date('2026-08-25T00:00:00.000Z'),
        revisionNota: 'el cierre que se quitó sí costaba',
      }),
    );
  });

  it('una versión APROBADA pasa, como siempre', async () => {
    await promueveYEscribe(version({ revisionEstado: 'aprobada' }));
  });

  it('⭐ un modelo que NO es versión pasa igual que siempre (los ~4,987 migrados del Access)', async () => {
    await promueveYEscribe(paraPromover());
  });

  it('el modelo YA en producción sigue rebotando por su propio motivo', async () => {
    // Control negativo: la promoción NO se quedó sin guardas — la suya, la de "ya está promovido",
    // sigue entera. Si esta prueba cayera, lo que se rompió no es la revisión.
    const { tx } = txPromocion(
      version({ origen: 'produccion', numeroProduccion: 71_001, revisionEstado: 'pendiente' }),
    );
    await expect(promoverAProduccionNucleo(tx, SESION_PROMOCION, 42)).rejects.toThrow(
      /ya está en el catálogo de producción/,
    );
  });
});

// ── ⭐⭐ V1-E9a · derivarModeloDeProduccion: LAS GUARDAS y LA MARCA ───────────────────────────

/**
 * §Post-F9.135 — de un desarrollo nacen N modelos de producción (uno por color de la OC) que
 * COMPARTEN su receta. Aquí se fijan, sin base de datos, las guardas y **qué se escribe**;
 * lo que sólo Postgres puede demostrar (los N números distintos bajo el lock, los CHECK y que la
 * receta de verdad no se copia) vive en `nomenclatura.int.test.ts`.
 *
 * La `tx` de mentiras emula además lo que recorre el ALTA (`crearModeloNucleo`): el centinela de
 * código libre, las FKs y el `create` + `findUniqueOrThrow` del final.
 */
function txDerivacion(
  padre: Record<string, unknown> | null,
  /**
   * La fila que "ocupa" el número, para el centinela del número repetido.
   *
   * 🔴 **Este doble SÍ mira el `where`, y es la diferencia entre una red y un adorno.** El método
   * `modelo.findFirst` lo comparten DOS centinelas: el del NÚMERO repetido (dentro de
   * `derivarModeloDeProduccion`) y el del CÓDIGO libre (dentro de `crearModeloNucleo`). Con un
   * doble que devolviera lo mismo a los dos —como estaba escrito primero—, **quitarle al centinela
   * del número su condición por `numeroProduccion` dejaba la prueba EN VERDE**: seguía habiendo
   * "choque", seguía lanzando su mensaje, y la mutación sobrevivía sin que nadie se enterara. Lo
   * midió el reviewer de esta etapa. Distinguirlos por su `OR` cuesta tres líneas y hace que la
   * unitaria muerda de verdad.
   */
  choque: Record<string, unknown> | null = null,
): {
  tx: Tx;
  llamadas: { metodo: string; args: unknown }[];
} {
  const llamadas: { metodo: string; args: unknown }[] = [];
  const reg = <T>(metodo: string, args: unknown, resultado: T): Promise<T> => {
    llamadas.push({ metodo, args });
    return Promise.resolve(resultado);
  };
  const activo = { nombre: 'X', activo: true };
  const tx = {
    modelo: {
      findUnique: (args: unknown) => reg('modelo.findUnique', args, padre),
      // Sólo el centinela del NÚMERO pregunta por `numeroProduccion` en su `OR`; el del código
      // libre mira `codigo`/`codigoDesarrollo` y nada más. Por ahí se distinguen (ver `choque`).
      findFirst: (args: unknown) => {
        const donde = (args as { where?: { OR?: Record<string, unknown>[] } }).where;
        const preguntaPorElNumero = (donde?.OR ?? []).some((c) => 'numeroProduccion' in c);
        return reg('modelo.findFirst', args, preguntaPorElNumero ? choque : null);
      },
      create: (args: unknown) => reg('modelo.create', args, { id: 77, codigo: '71001' }),
      findUniqueOrThrow: (args: unknown) =>
        reg('modelo.findUniqueOrThrow', args, { id: 77, codigo: '71001' }),
      update: (args: unknown) => reg('modelo.update', args, {}),
    },
    tipoProducto: {
      findUnique: (args: unknown) =>
        reg('tipoProducto.findUnique', args, {
          nombre: 'Pantalón',
          digitoConcepto: 7,
          activo: true,
        }),
    },
    genero: {
      findUnique: (args: unknown) =>
        reg('genero.findUnique', args, {
          nombre: 'Caballero',
          digitoNomenclatura: 1,
          digitoAlterno: 5,
          activo: true,
        }),
    },
    temporada: { findUnique: (args: unknown) => reg('temporada.findUnique', args, activo) },
    curvaTalla: { findUnique: (args: unknown) => reg('curvaTalla.findUnique', args, activo) },
    proveedor: { findFirst: (args: unknown) => reg('proveedor.findFirst', args, activo) },
    $executeRaw: (plantilla: TemplateStringsArray, ...valores: unknown[]) =>
      reg('$executeRaw', { sql: plantilla.join('?'), valores }, 1),
    $queryRaw: (plantilla: TemplateStringsArray, ...valores: unknown[]) =>
      reg('$queryRaw', { sql: plantilla.join('?'), valores }, []),
    bitacora: { create: (args: unknown) => reg('bitacora.create', args, {}) },
  };
  return { tx: tx as unknown as Tx, llamadas };
}

/** Un modelo de DESARROLLO listo para derivar hijos; `extra` dice qué lo distingue. */
function paraDerivar(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 42,
    codigo: 'CYA-26-71-001',
    codigoDesarrollo: 'CYA-26-71-001',
    origen: 'desarrollo',
    activo: true,
    idTipoProducto: 5,
    idGenero: 4,
    idModeloPadre: null,
    versionDesarrollo: null,
    idModeloDesarrollo: null,
    revisionEstado: null,
    revisadoEn: null,
    revisionNota: null,
    descripcion: 'Sudadera con cierre',
    composicion: null,
    maquilaBase: null,
    corteBase: null,
    idTemporada: null,
    idCurvaTalla: null,
    idMaquileroCotizado: null,
    numOperaciones: null,
    secuenciaEstampado: 'antes',
    llevaArte: true,
    ...extra,
  };
}

describe('derivarModeloDeProduccion — qué escribe', () => {
  it('⭐ el hijo nace en PRODUCCIÓN, con su número, apuntando al desarrollo y SIN receta', async () => {
    const { tx, llamadas } = txDerivacion(paraDerivar());

    const salida = await derivarModeloDeProduccion(tx, SESION_PROMOCION, 42, {
      descripcion: 'Sudadera con cierre — Negro',
    });

    expect(salida).toMatchObject({
      idModelo: 77,
      idModeloDesarrollo: 42,
      numeroProduccion: 71_001,
      codigo: '71001',
      numeroCapturado: false,
    });

    const create = llamadas.find((l) => l.metodo === 'modelo.create')?.args as {
      data: Record<string, unknown>;
    };
    // La MARCA completa, campo por campo — es lo que define el linaje:
    expect(create.data).toMatchObject({
      codigo: '71001',
      origen: 'produccion',
      numeroProduccion: 71_001,
      // @unique: los cuatro hermanos no pueden llevarse el código del padre (y sigue en él, D3).
      codigoDesarrollo: null,
      idModeloDesarrollo: 42,
      descripcion: 'Sudadera con cierre — Negro',
    });
    // Un hijo NO es una versión: nada del otro linaje se escribe.
    expect(create.data.idModeloPadre).toBeUndefined();
    expect(create.data.versionDesarrollo).toBeUndefined();
    expect(create.data.revisionEstado).toBeUndefined();
    // 🔑 Y NO COPIA RECETA: ninguna relación de receta viaja en el `create` anidado. Si alguien
    // "mejorara" esto copiándola —que es lo que hace `mintearVersionDeModelo`— las cuatro se
    // desincronizarían a la semana, que es justo lo que la decisión de Daniel vino a impedir.
    for (const relacion of ['telas', 'avios', 'artes', 'fotos']) {
      expect(create.data[relacion]).toBeUndefined();
    }
    // Y el PADRE no recibe ni un `update`: leerlo es lo único que se hace con él.
    expect(llamadas.filter((l) => l.metodo === 'modelo.update')).toEqual([]);

    // A7 — el renglón que cuenta EL ACTO de derivar (el `CREAR` genérico del núcleo no dice de qué
    // padre salió, y sin esto la bitácora no podría contestar "¿de dónde salió el 71001?").
    const renglones = llamadas
      .filter((l) => l.metodo === 'bitacora.create')
      .map((l) => (l.args as { data: { datos: Record<string, unknown> } }).data.datos);
    expect(renglones).toContainEqual(
      expect.objectContaining({
        operacion: 'derivar-modelo-de-produccion',
        idModeloDesarrollo: 42,
        codigoModeloDesarrollo: 'CYA-26-71-001',
        numeroProduccion: 71_001,
        numeroCapturado: false,
      }),
    );
  });

  it('⭐ el número capturado a mano se guarda con su AVISO de congruencia (avisa, no bloquea)', async () => {
    // §Post-F9.34 punto 7, vigente tras §Post-F9.46: *"si Daniel quiere una excepción, la excepción
    // es suya"*. Se afirma el CONTENIDO del aviso, no que la lista no esté vacía: sin eso, perder
    // los avisos de congruencia —que es lo único que le dice al usuario que se salió del par— no
    // rompería nada, y el número se guardaría igual sin que nadie se enterara.
    const { tx } = txDerivacion(paraDerivar());
    const salida = await derivarModeloDeProduccion(tx, SESION_PROMOCION, 42, {
      numeroCapturado: 39_500,
    });

    expect(salida.numeroProduccion).toBe(39_500);
    expect(salida.numeroCapturado).toBe(true);
    expect(salida.avisos.join(' ')).toContain('(39)');
    expect(salida.avisos.join(' ')).toContain('(71)');
  });

  /**
   * 🔴 H1 — LA FRONTERA QUE ESTA FUNCIÓN NO TIENE. `promoverAProduccionNucleo` recibe su número ya
   * pasado por `esquemaNumeroProduccion` en la ruta REST; ésta **no tiene ruta**: la va a llamar
   * `salidaAProduccion`, dominio→dominio, sin Zod por medio. Sin la validación de dentro, un
   * `123456` nace como modelo de producción con código de SEIS dígitos —`codigoDeNumeroProduccion`
   * no recorta— y queda fuera de `PATRON_CODIGO_PRODUCCION`: invisible para el generador de
   * consecutivos, para el centinela de choque y para los dos CHECK de la base, que sólo miran el
   * linaje. **Se afirman los dos extremos**, porque un `min` sin `max` (o al revés) dejaría medio
   * agujero abierto y una sola aserción no lo enseñaría.
   */
  it('⭐ un número capturado FUERA de los 5 dígitos se rechaza (aquí no hay capa API que lo filtre)', async () => {
    for (const fuera of [123_456, 5, 9_999, 100_000, 0, -71_001]) {
      const { tx, llamadas } = txDerivacion(paraDerivar());
      await expect(
        derivarModeloDeProduccion(tx, SESION_PROMOCION, 42, { numeroCapturado: fuera }),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      // Y no nace nada a medias: el número se valida antes de escribir.
      expect(llamadas.filter((l) => l.metodo === 'modelo.create')).toEqual([]);
    }

    // El control: el primero y el último número VÁLIDOS de la serie sí pasan. Sin esto, un
    // validador que rechazara todo dejaría la prueba de arriba en verde.
    for (const dentro of [10_000, 99_999]) {
      const { tx } = txDerivacion(paraDerivar());
      await expect(
        derivarModeloDeProduccion(tx, SESION_PROMOCION, 42, { numeroCapturado: dentro }),
      ).resolves.toMatchObject({ numeroProduccion: dentro });
    }
  });

  it('el lock del par se toma ANTES de elegir el número (es lo que sustituye a A3)', async () => {
    const { tx, llamadas } = txDerivacion(paraDerivar());
    await derivarModeloDeProduccion(tx, SESION_PROMOCION, 42);

    const orden = llamadas.map((l) => l.metodo);
    const lock = orden.indexOf('$executeRaw');
    const ocupacion = orden.indexOf('$queryRaw');
    const create = orden.indexOf('modelo.create');
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(ocupacion);
    expect(ocupacion).toBeLessThan(create);
    // Y es el lock del par 71 (Pantalón 7 + Caballero 1), no otro.
    const args = llamadas[lock]?.args as { valores: unknown[] };
    expect(args.valores).toEqual([20_546, 71]);
  });
});

describe('derivarModeloDeProduccion — las guardas', () => {
  /** Nada se escribió y el par NO se serializó: la guarda rebotó antes de tocar nada. */
  function nadaPaso(llamadas: { metodo: string }[]): string[] {
    return llamadas.map((l) => l.metodo).filter((m) => m !== 'modelo.findUnique');
  }

  it('el desarrollo tiene que existir', async () => {
    const { tx, llamadas } = txDerivacion(null);
    await expect(derivarModeloDeProduccion(tx, SESION_PROMOCION, 42)).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
    expect(nadaPaso(llamadas)).toEqual([]);
  });

  it('⭐ un modelo que YA es de producción no deriva hijos (así no hay cadenas)', async () => {
    const { tx, llamadas } = txDerivacion(
      paraDerivar({ origen: 'produccion', codigo: '71001', idModeloDesarrollo: 9 }),
    );
    await expect(derivarModeloDeProduccion(tx, SESION_PROMOCION, 42)).rejects.toThrow(
      /YA está en el catálogo de producción/,
    );
    expect(nadaPaso(llamadas)).toEqual([]);
  });

  it('un desarrollo DESCONTINUADO no deriva hijos (§Post-F9.119)', async () => {
    const { tx, llamadas } = txDerivacion(paraDerivar({ activo: false }));
    await expect(derivarModeloDeProduccion(tx, SESION_PROMOCION, 42)).rejects.toThrow(
      /descontinuado/,
    );
    expect(nadaPaso(llamadas)).toEqual([]);
  });

  it('⭐⭐ una VERSIÓN sin revisar SÍ deriva hijos (V1-E9c: la guarda 4 se retiró)', async () => {
    // 🔴 Antes esto era `rejects.toThrow(/REVISIÓN/)`. **Este llamador no estaba en la medición**
    // de §Post-F9.164 —que contó UN solo llamador de la compuerta— porque V1-E9a lo añadió después.
    // Dejarlo habría devuelto el muro entero por la puerta más nueva: justo la que V1-E3 va a usar
    // para hacer nacer un modelo de producción por cada color de la OC.
    const { tx } = txDerivacion(
      paraDerivar({ idModeloPadre: 7, versionDesarrollo: 1, revisionEstado: 'pendiente' }),
    );
    const hijo = await derivarModeloDeProduccion(tx, SESION_PROMOCION, 42);
    expect(hijo.numeroProduccion).toBe(71_001);
  });

  /**
   * 🔴 EL CENTINELA DEL NÚMERO REPETIDO, y por qué NO es redundante con el del código libre que ya
   * trae `crearModeloNucleo`. Los dos miran `codigo` y `codigoDesarrollo`; sólo éste mira además
   * **`numeroProduccion`**, que puede estar ocupado por un modelo cuyo CÓDIGO es otro (el número es
   * editable a mano desde §Post-F9.46, y ahí las dos columnas se pueden desalinear). Sin él, ese
   * caso llegaría al `@unique` de la base y **abortaría la transacción entera** de la salida a
   * producción, con las otras tres órdenes dentro.
   *
   * ⚠️ **Esta prueba muerde porque el doble mira el `where`** (ver `txDerivacion`): quitarle al
   * centinela su condición por `numeroProduccion` hace que el doble devuelva `null` y el modelo
   * nazca, y la aserción cae. Sin esa distinción —como estaba escrito primero— la mutación
   * sobrevivía en verde. Y la prueba que cubre el caso **con datos reales** es la de integración
   * *«⭐ rebota el número ocupado aunque el que lo ocupa tenga OTRO código»*, donde la fila existe
   * de verdad y el `where` lo resuelve Postgres, no un doble.
   */
  it('⭐ el número REPETIDO se rebota diciendo de qué número habla (no lo tapa el código libre)', async () => {
    const { tx } = txDerivacion(paraDerivar(), { codigo: 'MODELO-VIEJO', activo: true });
    await expect(
      derivarModeloDeProduccion(tx, SESION_PROMOCION, 42, { numeroCapturado: 71_003 }),
    ).rejects.toThrow(
      'El número de producción 71003 ya está ocupado por el modelo "MODELO-VIEJO".',
    );
  });

  it('la versión APROBADA sí deriva (si no, la prueba de arriba pasaría con todo roto)', async () => {
    const { tx } = txDerivacion(
      paraDerivar({ idModeloPadre: 7, versionDesarrollo: 1, revisionEstado: 'aprobada' }),
    );
    await expect(derivarModeloDeProduccion(tx, SESION_PROMOCION, 42)).resolves.toMatchObject({
      numeroProduccion: 71_001,
    });
  });
});
