/**
 * ⭐⭐ 0.156 (§Post-F9.214 / §Post-F9.219) — **CUÁNTO CÁRDIGAN PIDE UNA LÍNEA DE ORDEN DE COMPRA.**
 *
 * La parte PURA de la fila: dada la cantidad de CUERPO que esa línea va a comprar y la razón
 * complemento/cuerpo que trae la receta congelada de la orden, cuánto complemento se pide — y,
 * sobre todo, **cuándo NO se pide nada** y se deja pendiente como hasta hoy.
 *
 * Lo que aquí se mide es el borde peligroso: `OrdenCompraLinea.cantidadComplemento` es
 * `Decimal(14,2)` y el esquema de la línea la exige **POSITIVA**, así que una cantidad que se
 * guardaría como `0.00` no sería «una compra chiquita»: **reventaría la creación de la OC entera**.
 * El resto de la cadena (que la razón exista, que la tela declare complemento) vive en
 * `consumo-complemento.int.test.ts`, contra la base de datos.
 */
import { describe, expect, it } from 'vitest';

import { cantidadComplementoDeLinea, razonDeComplemento } from './mrp.js';
import { MINIMO_CANTIDAD_COMPRA, redondearCantidadCompra } from './reparto-ordenes.js';

describe('razonDeComplemento (0.156) — las tres puertas', () => {
  it('sin complemento en el CATÁLOGO no hay razón, aunque la receta traiga un número', () => {
    // 🔴 La puerta que evita romper la generación entera: el número quedó congelado en la orden,
    // pero al catálogo ya le quitaron el complemento. Mandarlo haría que `validarLineas` rechazara
    // la OC completa — incluidas sus otras líneas.
    expect(razonDeComplemento(null, 1.2, 0.15)).toBeNull();
  });

  it('sin consumo capturado no hay razón: la línea se queda pendiente, como antes de la fila', () => {
    // REGLA 0-B: la única pregunta válida es «¿funciona bien cuando el dato NO está?».
    expect(razonDeComplemento('Cardigan', 1.2, null)).toBeNull();
  });

  it('con el consumo del CUERPO en cero o negativo no hay razón (la aritmética se defiende sola)', () => {
    // Sin esta puerta la división daría `Infinity` —o una cantidad negativa— y ese valor viajaría
    // hasta la línea de OC. Que hoy la explosión no genere línea para un consumo cero es una
    // protección de OTRO módulo: no se apoya una en la otra.
    expect(razonDeComplemento('Cardigan', 0, 0.15)).toBeNull();
    expect(razonDeComplemento('Cardigan', -1.2, 0.15)).toBeNull();
  });

  it('con las tres condiciones, la razón es complemento ÷ cuerpo', () => {
    expect(razonDeComplemento('Cardigan', 1.2, 0.15)).toBeCloseTo(0.125);
  });
});

describe('cantidadComplementoDeLinea (0.156)', () => {
  it('sin razón (la receta no trajo complemento) deja la línea PENDIENTE, no en cero', () => {
    // `null` es lo que el sistema hacía SIEMPRE antes de esta fila: la OC nace pendiente y
    // `autorizarOC` la para hasta que alguien capture. Un `0` diría "no lleva cárdigan", que es
    // una afirmación distinta y falsa. Se aceptan las DOS ausencias: `undefined` es «el mapa no
    // tiene ese par» y `null` es «la regla dijo que no hay razón».
    expect(cantidadComplementoDeLinea(480, undefined)).toBeNull();
    expect(cantidadComplementoDeLinea(480, null)).toBeNull();
  });

  it('aplica la razón a lo que ESA línea compra de cuerpo', () => {
    // Felpa 1.2 kg/prenda + cárdigan 0.15 kg/prenda ⇒ razón 0.125. Sobre 480 kg de felpa: 60 kg.
    expect(cantidadComplementoDeLinea(480, 0.15 / 1.2)).toBe(60);
  });

  it('sigue al CUERPO cuando el comprador ajustó la cantidad (el cárdigan viaja con su felpa)', () => {
    // Daniel: «compré 480 en lugar de 481». El cárdigan que hace falta es el de esos 480, no el del
    // requerimiento original: los dos se compran en el mismo renglón y llegan en el mismo LOTE.
    const razon = 0.15 / 1.2;
    expect(cantidadComplementoDeLinea(481, razon)).toBe(60.13);
    expect(cantidadComplementoDeLinea(480, razon)).toBe(60);
  });

  it('redondea a la escala de la columna, con la MISMA función que redondea el cuerpo', () => {
    // `OrdenCompraLinea.cantidadComplemento` es Decimal(14,2): si aquí se dejaran 4 decimales,
    // Postgres redondearía al escribir y el documento no cuadraría con su propio renglón.
    const razon = 1 / 3;
    expect(cantidadComplementoDeLinea(100, razon)).toBe(33.33);
    expect(cantidadComplementoDeLinea(100, razon)).toBe(redondearCantidadCompra(100 / 3));
  });

  it('una astilla que se guardaría como 0.00 se deja PENDIENTE (el esquema exige positiva)', () => {
    // 🔴 El caso que rompe la generación entera: `esquemaCompraLineaEntrada.cantidadComplemento`
    // sólo acepta números > 0. Mandar el 0.00 al que Postgres iba a redondear haría fallar la OC
    // completa —incluidas sus otras líneas— por una cantidad que nadie quería comprar.
    expect(cantidadComplementoDeLinea(0.001, 0.001)).toBeNull();
    expect(cantidadComplementoDeLinea(1, MINIMO_CANTIDAD_COMPRA / 2)).toBeNull();
  });

  it('en el filo del mínimo guardable SÍ se pide (0.005 se guarda como 0.01)', () => {
    // El corte es exactamente `MINIMO_CANTIDAD_COMPRA`, no "algo chiquito": justo encima se
    // compra, justo debajo se deja pendiente. Sin esta pareja, mover el umbral no rompería nada.
    expect(cantidadComplementoDeLinea(1, MINIMO_CANTIDAD_COMPRA)).toBe(0.01);
    expect(cantidadComplementoDeLinea(1, MINIMO_CANTIDAD_COMPRA - 1e-9)).toBeNull();
  });
});
