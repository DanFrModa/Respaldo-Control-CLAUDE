/**
 * Tests UNIT del GUARD de congelado del precosto (V1-E4 punto 2 + candado del empaque, 31-ago-2026).
 *
 * Por qué existe: congelar es IRREVERSIBLE (la versión queda inmutable, D3) y su `costoTotal` es la
 * base literal del `costoUnit` de la lista de precios y del precio que se le cotiza al cliente. Un
 * modelo sin receta capturada produce renglones en $0.00 y el congelado los sellaba sin decir nada:
 * probado a mano "funciona" — solo miente. De ahí que la regresión viva aquí.
 *
 * 🔴 Y por qué creció: la 0.060 metió el EMPAQUE como tercera ancla con un default de $2.20 que el
 * sistema pone en TODO precosto nuevo. Un precosto vacío dejó de sumar $0.00 —suma $2.20— y la
 * guarda del total dejó de atajarlo: seguía en pie, sin proteger de nada. Los casos de abajo miden
 * el CONTENIDO, no el monto.
 */
import { describe, expect, it } from 'vitest';

import { ErrorConflicto } from '../../comun/errores.js';
import { redondear2 } from '../costos/decimales.js';
import { exigirCostoCongelable, type RenglonCongelable } from './precostos.js';

/** Renglón de la RECETA del modelo (lo que `generarPrecosto` saca del BOM). */
function bom(
  importe: number,
  origen: 'bom_tela' | 'bom_avio' | 'bom_arte' = 'bom_tela',
): RenglonCongelable {
  const conceptoCodigo = { bom_tela: 'tela', bom_avio: 'avios', bom_arte: 'bordado' }[origen];
  return { origen, conceptoCodigo, importe };
}

/** Renglón ANCLA (los tres fijos por prenda: se editan, no se borran). */
function ancla(
  conceptoCodigo: 'maquila' | 'corte' | 'empaque',
  importe: number,
): RenglonCongelable {
  return { origen: 'manual', conceptoCodigo, importe };
}

/** Renglón MANUAL que una persona agregó en la calculadora de negociación (R5, B12). */
function manual(conceptoCodigo: string, importe: number): RenglonCongelable {
  return { origen: 'manual', conceptoCodigo, importe };
}

/**
 * Corre la guarda con el total REAL de esos renglones — nunca uno inventado: si el test pudiera
 * pasar un total que no cuadra con sus renglones, probaría una situación que la BD no produce.
 */
function congelar(renglones: RenglonCongelable[]): void {
  const total = redondear2(renglones.reduce((suma, l) => suma + l.importe, 0));
  exigirCostoCongelable(total, renglones);
}

/** El mensaje del `ErrorConflicto` que tiró la guarda (o '' si no tiró). */
function mensajeAlCongelar(renglones: RenglonCongelable[]): string {
  try {
    congelar(renglones);
  } catch (error) {
    return error instanceof Error ? error.message : '';
  }
  return '';
}

describe('exigirCostoCongelable — el total', () => {
  it('RECHAZA congelar en cero (la versión quedaría inmutable y sale de ahí el precio al cliente)', () => {
    expect(() => congelar([ancla('maquila', 0), ancla('corte', 0), ancla('empaque', 0)])).toThrow(
      ErrorConflicto,
    );
  });

  it('el mensaje del cero dice QUÉ hacer (capturar la receta), no solo que falló', () => {
    const mensaje = mensajeAlCongelar([
      ancla('maquila', 0),
      ancla('corte', 0),
      ancla('empaque', 0),
    ]);
    expect(mensaje).toContain('receta');
    expect(mensaje).toContain('maquila');
    // Y es el mensaje DEL CERO, no el del empaque: los dos avisan, pero no dicen lo mismo.
    expect(mensaje).toContain('suma $0.00');
    expect(mensaje).toContain('INMUTABLE en cero');
  });

  it('RECHAZA un total negativo (renglones mal capturados)', () => {
    expect(() => congelar([ancla('maquila', -12.5), ancla('empaque', 0)])).toThrow(ErrorConflicto);
    expect(mensajeAlCongelar([ancla('maquila', -12.5), ancla('empaque', 0)])).toContain('NEGATIVO');
  });

  it('RECHAZA un precosto sin un solo renglón', () => {
    expect(() => congelar([])).toThrow(ErrorConflicto);
  });

  /**
   * Tener contenido capturado NO basta si el total se anula: la versión quedaría igual de inmutable
   * en $0.00. Las dos condiciones son independientes y las dos tienen que sostenerse.
   *
   * ⚠️ Aquí muerden LAS DOS (fuera del empaque tampoco queda nada); el mismo contenido anulado CON
   * el empaque en su valor real lo cubre el bloque de abajo. Quien fija la del total ella sola es
   * la prueba que sigue.
   */
  it('total $0.00 → rechaza aunque haya contenido capturado', () => {
    expect(() => congelar([bom(30), manual('descuento', -30), ancla('empaque', 0)])).toThrow(
      ErrorConflicto,
    );
  });

  /**
   * 🔴 La guarda del TOTAL tiene que morder ELLA SOLA: contenido de sobra ($30 de tela, que pasa de
   * largo el candado del empaque) pero un total que se anula. Hoy sólo se llega ahí con un empaque
   * NEGATIVO —imposible desde el API, donde `precioUnit` es `.nonnegative()`—, y aun así se fija:
   * sin esta prueba, borrar la guarda del cero por "ya la cubre el candado del empaque" dejaría
   * congelar una versión INMUTABLE en $0.00 sin que nada se ponga rojo. Se comprobó midiendo: al
   * quitar la guarda del cero, la suite entera seguía verde.
   */
  it('contenido de sobra pero total $0.00: la guarda del TOTAL muerde sola', () => {
    expect(() => congelar([bom(30), ancla('empaque', -30)])).toThrow(ErrorConflicto);
  });
});

describe('exigirCostoCongelable — el candado del EMPAQUE (0.060 dejó la guarda desdentada)', () => {
  /**
   * ⭐⭐ EL DEFECTO. Modelo con la receta vacía y sin costos capturados: antes de la 0.060 sumaba
   * $0.00 y la guarda lo atajaba. Con el ancla de empaque suma $2.20 —un número que nadie tecleó—,
   * pasaba la guarda y se congelaba INMUTABLE. De ahí salía el precio al cliente: la prenda
   * cotizada al costo de su bolsa.
   */
  it('⭐ RECHAZA un precosto cuyo único importe es el ancla AUTOMÁTICA de empaque', () => {
    expect(() => congelar([ancla('maquila', 0), ancla('corte', 0), ancla('empaque', 2.2)])).toThrow(
      ErrorConflicto,
    );
  });

  it('el mensaje nombra el EMPAQUE, su importe y qué falta capturar', () => {
    const mensaje = mensajeAlCongelar([
      ancla('maquila', 0),
      ancla('corte', 0),
      ancla('empaque', 2.2),
    ]);
    expect(mensaje).toContain('EMPAQUE');
    expect(mensaje).toContain('2.20');
    expect(mensaje).toContain('receta');
    expect(mensaje).toContain('maquila');
  });

  /** La regla es sobre el CONTENIDO, no sobre el monto: un empaque grande sigue siendo empaque. */
  it('el empaque subido a mano a $50 TAMPOCO alcanza (no es el costo de la prenda)', () => {
    expect(() => congelar([ancla('maquila', 0), ancla('corte', 0), ancla('empaque', 50)])).toThrow(
      ErrorConflicto,
    );
  });

  /**
   * El OTRO caso que la guarda de V1-E4 ya atajaba y el empaque volvió a abrir: la receta SÍ está
   * capturada, pero ninguno de sus insumos tiene precio, así que todos sus renglones valen $0.00.
   * El total vuelve a ser puro empaque y el precio al cliente sería igual de falso.
   */
  it('receta capturada pero con TODOS los insumos sin precio: sigue sin haber nada costeado', () => {
    expect(() =>
      congelar([
        bom(0),
        bom(0, 'bom_avio'),
        ancla('maquila', 0),
        ancla('corte', 0),
        ancla('empaque', 2.2),
      ]),
    ).toThrow(ErrorConflicto);
  });

  /** Un borrador viejo que recibió su empaque A MANO (V1-E8w) es el mismo renglón: tampoco cuenta. */
  it('el empaque agregado a mano en un borrador viejo cuenta igual que el automático', () => {
    expect(() => congelar([manual('empaque', 2.2)])).toThrow(ErrorConflicto);
  });

  /**
   * H1 — el importe del mensaje sale del RENGLÓN, no de un 2.20 clavado. Pesa porque el default es
   * configurable por empresa (`ConfiguracionEmpresa.costoEmpaqueBase`): una empresa con $7.50
   * leería un mensaje que miente, y hasta esta prueba nada lo notaba.
   */
  it('el importe del mensaje es el REAL de la empresa, no un 2.20 clavado', () => {
    const mensaje = mensajeAlCongelar([ancla('maquila', 0), ancla('empaque', 7.5)]);
    expect(mensaje).toContain('7.50');
    expect(mensaje).not.toContain('2.20');
  });

  /**
   * ⭐ H2 — el candado suma lo que NO es empaque, no busca "algún renglón > 0". Con contenido que se
   * anula entre sí (tela $30 − descuento $30), el total vuelve a ser puro empaque: congelarlo sería
   * exactamente el defecto que este hotfix cierra, con un renglón de tela de adorno.
   *
   * Hoy el caso es INALCANZABLE desde el API (`precioUnit`/`consumo` son `.nonnegative()`), pero la
   * guarda no debe depender de esa suposición: un renglón de descuento en la mesa o un ETL de
   * precostos la rompen sin avisar.
   */
  it('⭐ contenido que se ANULA entre sí + empaque real: el total vuelve a ser la bolsa → rechaza', () => {
    expect(() => congelar([bom(30), manual('descuento', -30), ancla('empaque', 2.2)])).toThrow(
      ErrorConflicto,
    );
  });
});

describe('exigirCostoCongelable — lo que SÍ tiene que poder congelarse', () => {
  /** ⚠️ Costeo por proceso: no toda prenda lleva BOM. Con maquila capturada, se congela. */
  it('maquila capturada y receta VACÍA: congela (costeo por proceso)', () => {
    expect(() =>
      congelar([ancla('maquila', 18), ancla('corte', 0), ancla('empaque', 2.2)]),
    ).not.toThrow();
  });

  it('sólo el CORTE capturado (maquila en cero): congela', () => {
    expect(() =>
      congelar([ancla('maquila', 0), ancla('corte', 3.5), ancla('empaque', 2.2)]),
    ).not.toThrow();
  });

  /** ⚠️ La regla NO es sobre el monto: un centavo de contenido real basta. */
  it('receta real con un importe minúsculo ($0.01): congela', () => {
    expect(() =>
      congelar([bom(0.01), ancla('maquila', 0), ancla('corte', 0), ancla('empaque', 2.2)]),
    ).not.toThrow();
  });

  it('un renglón de ARTE del modelo también es contenido: congela', () => {
    expect(() =>
      congelar([
        bom(35, 'bom_arte'),
        ancla('maquila', 0),
        ancla('corte', 0),
        ancla('empaque', 2.2),
      ]),
    ).not.toThrow();
  });

  it('un renglón MANUAL que capturó la persona (flete, estampado…) es contenido: congela', () => {
    expect(() =>
      congelar([
        manual('estampado', 12),
        ancla('maquila', 0),
        ancla('corte', 0),
        ancla('empaque', 2.2),
      ]),
    ).not.toThrow();
  });

  it('un precosto normal (tela + maquila + corte + empaque) congela sin ruido', () => {
    expect(() =>
      congelar([
        bom(30),
        bom(4, 'bom_avio'),
        ancla('maquila', 18),
        ancla('corte', 3.5),
        ancla('empaque', 2.2),
      ]),
    ).not.toThrow();
  });

  /** Un descuento no borra el contenido: hay renglones capturados y el total sigue arriba de cero. */
  it('contenido real con un renglón NEGATIVO de por medio: congela mientras el total sea > 0', () => {
    expect(() =>
      congelar([bom(30), manual('descuento', -10), ancla('empaque', 2.2)]),
    ).not.toThrow();
  });
});
