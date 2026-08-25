/**
 * Reglas PURAS de la nomenclatura de modelos (§Post-F9.34 + §Post-F9.46, V1-E3n). Sin base de
 * datos: aquí se fija que los códigos se ARMEN y se LEAN bien, y que el aviso de congruencia
 * hable del par correcto — y, con una transacción de mentiras que emula la secuencia global, de
 * qué está hecha la CLAVE del consecutivo de desarrollo (§Post-F9.108 «✅ RESUELTO»: cliente + año,
 * sin el par). La parte que necesita la ocupación real del catálogo (propuesta del hueco libre,
 * promoción) y la atomicidad de verdad contra Postgres viven en `nomenclatura.int.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import { ErrorConflicto } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import {
  armarCodigoDesarrollo,
  avisosDeCongruencia,
  codigoDeNumeroProduccion,
  digitosDeCodigoDesarrollo,
  mintearCodigoDesarrollo,
  numeroProduccionDeCodigo,
  parDe,
  parTexto,
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

/**
 * Transacción de mentiras que emula lo MÍNIMO que `mintearCodigoDesarrollo` toca:
 *
 *  • `cliente.findUnique` → los clientes que le pasemos;
 *  • `$queryRaw` → la tabla `secuencias_globales`: un contador por CLAVE, +1 por llamada. Es la
 *    sentencia que arma {@link siguienteFolioGlobal}, y la clave es su PRIMER valor interpolado
 *    (`VALUES (${clave}, 1)`), así que aquí queda a la vista: es lo que estas pruebas miran. Se
 *    usa la función REAL (no un mock del módulo), así que de paso se comprueba que la clave nueva
 *    pasa su validación de formato;
 *  • `modelo.findFirst` → el centinela anti-colisión: decimos qué códigos están OCUPADOS.
 *
 * La atomicidad de la secuencia bajo concurrencia NO se prueba aquí (eso sólo lo demuestra
 * Postgres, en `nomenclatura.int.test.ts`): aquí se prueba QUÉ serie se pide.
 */
function txFalsa(opciones?: {
  clientes?: Record<number, { nombre: string; abreviatura: string | null }>;
  ocupados?: string[];
}) {
  const clientes = opciones?.clientes ?? { 1: { nombre: 'C&A', abreviatura: 'CYA' } };
  const ocupados = opciones?.ocupados ?? [];
  const secuencias = new Map<string, number>();
  const claves: string[] = [];

  const tx = {
    cliente: {
      findUnique: vi.fn((args: { where: { id: number } }) =>
        Promise.resolve(clientes[args.where.id] ?? null),
      ),
    },
    $queryRaw: vi.fn((_sql: TemplateStringsArray, ...valores: unknown[]) => {
      const clave = String(valores[0]);
      claves.push(clave);
      const valor = (secuencias.get(clave) ?? 0) + 1;
      secuencias.set(clave, valor);
      return Promise.resolve([{ valor: BigInt(valor) }]);
    }),
    modelo: {
      findFirst: vi.fn(
        (args: { where: { OR: { codigo?: { equals: string; mode?: string } }[] } }) => {
          const filtro = args.where.OR[0]?.codigo;
          const codigo = filtro?.equals ?? '';
          // ⚠️ El `mode` se OBEDECE, no se da por hecho: Postgres compara la caja salvo que el
          // filtro pida `insensitive`, y si esta BD de mentiras ignorara la bandera, la prueba del
          // choque por CAJA pasaría igual con el centinela sensible — sería una prueba hueca
          // (comprobado: mutar `mode` a exacto no la ponía roja hasta que se emuló bien).
          const igual = (ocupado: string) =>
            filtro?.mode === 'insensitive'
              ? ocupado.toUpperCase() === codigo.toUpperCase()
              : ocupado === codigo;
          return Promise.resolve(ocupados.some(igual) ? { id: 1 } : null);
        },
      ),
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

describe('mintearCodigoDesarrollo — el centinela que absorbe el cambio de criterio', () => {
  /**
   * ⭐ La pieza que hace SEGURO el cambio sin migración: la serie nueva de un cliente+año que ya
   * tiene modelos arranca otra vez en 1 y vuelve a pasar por códigos que el criterio viejo ya
   * entregó. El bucle los salta pidiendo otro número.
   */
  it('salta los códigos que el criterio VIEJO ya entregó, sin renumerar nada', async () => {
    // Lo que dejó el criterio viejo en ese cliente+año: dos joggers de caballero y uno de dama.
    const { tx } = txFalsa({ ocupados: ['CYA-26-71-001', 'CYA-26-71-002', 'CYA-26-72-001'] });

    // El primer minteo del criterio nuevo pide el 1 y el 2 (ocupados) y se queda con el 3.
    const { codigo, consecutivo } = await mintearCodigoDesarrollo(tx, {
      idCliente: 1,
      anioEntrega: 2026,
      concepto: 7,
      genero: 1,
    });
    expect(codigo).toBe('CYA-26-71-003');
    expect(consecutivo).toBe(3);

    // El de dama sigue la misma serie: el 4 está libre aunque el 72-001 viejo exista.
    expect(await mintear(tx, { concepto: 7, genero: 2 })).toBe('CYA-26-72-004');
  });

  it('el choque también cuenta si el código viejo se guardó con OTRA caja', async () => {
    // `crearModelo` bloquea duplicados sin importar mayúsculas: si el centinela mirara sólo la
    // caja exacta, devolvería un código que el alta rechazaría después, abortando la transacción.
    const { tx } = txFalsa({ ocupados: ['cya-26-71-001'] });
    expect(await mintear(tx, { concepto: 7, genero: 1 })).toBe('CYA-26-71-002');
  });

  it('si se agotan los intentos avisa del CLIENTE y el AÑO, no de una "serie" por par', async () => {
    const todos = Array.from(
      { length: 60 },
      (_, i) => `CYA-26-71-${String(i + 1).padStart(3, '0')}`,
    );
    const { tx } = txFalsa({ ocupados: todos });
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
  });
});
