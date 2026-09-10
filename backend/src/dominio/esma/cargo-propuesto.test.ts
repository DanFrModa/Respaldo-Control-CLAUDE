/**
 * LA VALUACIÓN DEL CARGO PROPUESTO, ANTES DE TOCAR LA BASE DE DATOS (V1, fila 0.111).
 *
 * Igual que `formula-saldo.test.ts`, estas pruebas no miden lo que devuelve una consulta: miden que
 * **la regla no se pueda separar en dos**. El importe de un recibo sin validar se calcula ahora en
 * tres sitios —la cola de validación (`cargos.ts`), el saldo de uno (Prisma) y el agregado del
 * tablero/CxP (SQL crudo)— y lo único que impide que se separen es que los tres lo pidan aquí.
 *
 * Lo que se blinda:
 *  (1) el orden de caída del precio (orden por proceso → precio pactado → sin precio);
 *  (2) que «sin precio» sea `null` y NO un cero disfrazado (un cero se pagaría como «nada que ver»);
 *  (3) que la forma SQL nombre las MISMAS columnas y la MISMA constante de costura;
 *  (4) que el criterio del agregado salga de `formula-saldo.ts` y no esté escrito a mano;
 *  (5) ⭐ que un cargo de SERVICIO (corte/empaque, 0.114) vaya SÓLO con su precio pactado y no se
 *      caiga del agregado — su `id_tipo_proceso` es NULL, así que el proceso entra por LEFT JOIN y
 *      el `CASE` lo atiende ANTES de mirar el código del proceso.
 *
 * La comprobación de que el SQL y el TypeScript dan el MISMO número contra datos reales vive en
 * `saldo-fuente-unica.int.test.ts` (necesita Postgres).
 */
import { describe, expect, it } from 'vitest';

import { Prisma } from '../../datos/index.js';

import {
  CODIGO_PROCESO_COSTURA,
  importePropuestoDelCargo,
  precioDeReferenciaDelCargo,
  sqlCargosPropuestosPorMaquilero,
  sqlPrecioDeReferencia,
  type DatosPrecioCargo,
} from './cargo-propuesto.js';
import { sqlPendiente } from './formula-saldo.js';

/**
 * Los insumos del precio, en ceros: cada prueba sobre-escribe sólo el que mide. El tipo de retorno
 * es EXPLÍCITO a propósito: el día que la regla gane un insumo, esto deja de compilar hasta que la
 * prueba lo declare — nadie amplía la regla sin pasar por aquí.
 */
function datos(parcial: Partial<DatosPrecioCargo> = {}): DatosPrecioCargo {
  return {
    // Un cargo de MAQUILA por defecto: `servicio` en null y el proceso lleno (el CHECK
    // `esma_cargo_proceso_o_servicio` garantiza que exactamente uno de los dos viene).
    servicio: null,
    codigoProceso: CODIGO_PROCESO_COSTURA,
    maquilaOrd: null,
    aplicacionOrd: null,
    precioPactado: null,
    ...parcial,
  };
}

describe('cargo-propuesto · el precio de referencia (decisión (e) de F6-E4)', () => {
  it('COSTURA se valúa con el precio de costura de la orden, nunca con el de aplicación', () => {
    expect(precioDeReferenciaDelCargo(datos({ maquilaOrd: 8, aplicacionOrd: 99 }))).toBe(8);
  });

  it('todo lo que NO es costura se valúa con el de aplicación', () => {
    // Es el defecto de v1 que esta regla corrige: `EsMaRecibosSemEstCon` usaba `MaquilaOrd` también
    // para el estampado y le pagaba de más al taller. Si alguien voltea el CASE, esto se pone rojo.
    for (const proceso of ['estampado', 'bordado', 'lavado', 'aplicacion']) {
      expect(
        precioDeReferenciaDelCargo(
          datos({ codigoProceso: proceso, maquilaOrd: 99, aplicacionOrd: 8 }),
        ),
        proceso,
      ).toBe(8);
    }
  });

  it('sin precio en la orden CAE al pactado del envío; el de la orden manda cuando está', () => {
    expect(precioDeReferenciaDelCargo(datos({ precioPactado: 7.5 }))).toBe(7.5);
    expect(precioDeReferenciaDelCargo(datos({ maquilaOrd: 8, precioPactado: 7.5 }))).toBe(8);
    // Y para un proceso que no es costura, la caída es la misma.
    expect(
      precioDeReferenciaDelCargo(datos({ codigoProceso: 'estampado', precioPactado: 3 })),
    ).toBe(3);
  });

  it('sin precio en ningún lado devuelve NULL, jamás 0', () => {
    // Un 0 se leería como «este recibo no vale nada» y el maquilero no cobraría; `null` dice la
    // verdad: no se puede valuar, y la partida se cuenta aparte (`cargosSinPrecio`).
    expect(precioDeReferenciaDelCargo(datos())).toBeNull();
    expect(importePropuestoDelCargo(10, null)).toBeNull();
    // Un precio de 0 SÍ es un precio (alguien lo capturó así): 0 × 10 = 0, no `null`.
    expect(precioDeReferenciaDelCargo(datos({ maquilaOrd: 0 }))).toBe(0);
    expect(importePropuestoDelCargo(10, 0)).toBe(0);
  });

  it('⭐ un cargo de SERVICIO (corte/empaque) se valúa SÓLO con su precio pactado', () => {
    // 0.114: corte y empaque se pagan como maquila pero NO son procesos de maquila. La orden trae
    // `maquilaOrd`/`aplicacionOrd`, que son precios de MAQUILA: no hay en ella un precio de corte
    // ni uno de empaque. Si el `if (servicio)` desapareciera, el cortador se valuaría con el precio
    // de aplicación de la orden — un número inventado, que es peor que no proponer ninguno.
    for (const servicio of ['corte', 'empaque'] as const) {
      expect(
        precioDeReferenciaDelCargo(
          datos({
            servicio,
            codigoProceso: null,
            maquilaOrd: 99,
            aplicacionOrd: 77,
            precioPactado: 6,
          }),
        ),
        servicio,
      ).toBe(6);
    }
  });

  it('⭐ un SERVICIO sin precio pactado NO hereda el de la orden: es null', () => {
    // Sin pactado en su etapa, el cargo de corte simplemente no se puede valuar: cuenta como
    // partida esperando decisión y se anota en `cargosSinPrecio`. Nunca cae al precio de la orden.
    for (const servicio of ['corte', 'empaque'] as const) {
      expect(
        precioDeReferenciaDelCargo(
          datos({ servicio, codigoProceso: null, maquilaOrd: 99, aplicacionOrd: 77 }),
        ),
        servicio,
      ).toBeNull();
      expect(importePropuestoDelCargo(30, null)).toBeNull();
    }
  });

  it('el importe es cantidad × precio, SIN redondear (el redondeo va al final de la suma)', () => {
    expect(importePropuestoDelCargo(10, 8)).toBe(80);
    // Se deja el producto crudo a propósito: redondear cada renglón y luego sumar da otro número
    // que redondear la suma, y el agregado del tablero suma en SQL antes de redondear en JS.
    expect(importePropuestoDelCargo(3, 0.005)).toBe(0.015);
    expect(importePropuestoDelCargo(0, 8)).toBe(0);
  });
});

describe('cargo-propuesto · la forma SQL dice lo mismo que la de TypeScript', () => {
  const sql = sqlPrecioDeReferencia('o', 'tp', 'em', 'ec').sql;

  it('nombra las CUATRO columnas de la regla y en el orden de caída', () => {
    expect(sql).toContain('ec."servicio"');
    expect(sql).toContain('tp."codigo"');
    expect(sql).toContain('o."maquila_ord"');
    expect(sql).toContain('o."aplicacion_ord"');
    expect(sql).toContain('em."precio_pactado"');
    // El `COALESCE` es la caída: primero el CASE de la orden, después el pactado.
    expect(sql.indexOf('COALESCE')).toBeLessThan(sql.indexOf('em."precio_pactado"'));
    expect(sql.indexOf('o."maquila_ord"')).toBeLessThan(sql.indexOf('em."precio_pactado"'));
  });

  it('⭐ el SERVICIO se decide ANTES que el proceso, y sale por NULL para caer al pactado', () => {
    // El orden del `CASE` ES la regla (0.114). Si `tp."codigo" = 'costura'` se evaluara primero,
    // para un cargo de corte —que llega por LEFT JOIN con el código en NULL— la comparación daría
    // NULL, que no es TRUE, y el CASE caería al `ELSE`: el corte se valuaría con el precio de
    // APLICACIÓN de la orden. La forma TypeScript sale por `servicio` antes de mirar el proceso.
    expect(sql).toMatch(/WHEN\s+ec\."servicio"\s+IS NOT NULL\s+THEN NULL/);
    expect(sql.indexOf('ec."servicio"')).toBeLessThan(sql.indexOf('tp."codigo"'));
    // Y esa rama devuelve NULL para que el `COALESCE` caiga al pactado — que es su único precio.
    expect(sql.indexOf('ec."servicio"')).toBeLessThan(sql.indexOf('em."precio_pactado"'));
  });

  it('el código de costura viaja como PARÁMETRO y sale de la misma constante', () => {
    // No se literaliza dentro del SQL: va como valor ligado, así que no hay forma de que el SQL y
    // el TypeScript comparen contra códigos distintos.
    expect(sqlPrecioDeReferencia('o', 'tp', 'em', 'ec').values).toEqual([CODIGO_PROCESO_COSTURA]);
    expect(sql).not.toContain(`'${CODIGO_PROCESO_COSTURA}'`);
  });

  it('los alias que entran CRUDOS al SQL se validan, en las CUATRO posiciones', () => {
    for (const malo of ['o"; DROP TABLE x --', 'O', '1o', 'con espacio', '']) {
      expect(() => sqlPrecioDeReferencia(malo, 'tp', 'em', 'ec'), malo).toThrow(
        /Alias no literalizable/,
      );
      expect(() => sqlPrecioDeReferencia('o', malo, 'em', 'ec'), malo).toThrow(
        /Alias no literalizable/,
      );
      expect(() => sqlPrecioDeReferencia('o', 'tp', malo, 'ec'), malo).toThrow(
        /Alias no literalizable/,
      );
      expect(() => sqlPrecioDeReferencia('o', 'tp', 'em', malo), malo).toThrow(
        /Alias no literalizable/,
      );
    }
  });
});

describe('cargo-propuesto · el agregado por maquilero', () => {
  // Sin segmento de facturación: el fragmento va vacío, como cuando el tablero no filtra.
  const agregado = sqlCargosPropuestosPorMaquilero(7, Prisma.empty);

  it('devuelve las tres columnas que el saldo necesita, agrupadas por maquilero', () => {
    expect(agregado.sql).toContain('"partidas"');
    expect(agregado.sql).toContain('"importe"');
    expect(agregado.sql).toContain('"sin_precio"');
    expect(agregado.sql).toContain('GROUP BY cp."id_maquilero"');
  });

  it('⭐ el criterio de «pendiente» NO se escribe aquí: sale de formula-saldo', () => {
    // Si alguien lo copiara a mano, este fragmento dejaría de aparecer y la guardia de
    // `formula-saldo.test.ts` cazaría el literal — pero se afirma también aquí, en positivo.
    expect(agregado.sql).toContain(sqlPendiente('cargo').sql);
  });

  it('acota por EMPRESA (A9) y filtra el recibo dentro de una subconsulta de UNA sola tabla', () => {
    expect(agregado.values).toContain(7);
    // El fragmento del criterio emite `"estado"` sin calificar: si viviera en el nivel donde están
    // unidas `ordenes` y `etapa_movimiento`, sería ambiguo o —peor— resolvería a otra columna.
    const filtro = agregado.sql.indexOf(sqlPendiente('cargo').sql);
    expect(agregado.sql.slice(0, filtro)).toContain('FROM "esma_cargo"');
    expect(agregado.sql.slice(0, filtro)).not.toContain('JOIN "ordenes"');
  });

  it('⭐ el cargo de SERVICIO no se cae del agregado: el proceso entra por LEFT JOIN', () => {
    // 🔴 El defecto que la 0.114 dejó servido. Un `JOIN "tipos_proceso"` a secas descarta toda fila
    // con `id_tipo_proceso` NULL — o sea, TODOS los cargos de corte y de empaque—, que son justo
    // los que esta fila vino a hacer visibles: el maquilero con sólo cortes por validar volvería a
    // tener partidas 0 y a desaparecer del tablero, de la bandeja de CxP y de la corrida.
    const linea = agregado.sql.split('\n').find((l) => l.includes('JOIN "tipos_proceso"'));
    expect(linea).toBeDefined();
    expect(linea).toContain('LEFT JOIN "tipos_proceso"');
  });

  it('la subconsulta trae el `servicio` del cargo (sin él, el precio no se puede decidir)', () => {
    // El `CASE` del precio pregunta por `ec."servicio"`: si la subconsulta de una sola tabla dejara
    // de proyectarlo, la consulta ni siquiera correría.
    const filtro = agregado.sql.indexOf(sqlPendiente('cargo').sql);
    expect(agregado.sql.slice(0, filtro)).toContain('"servicio"');
  });

  it('no suma las prendas incompletas (§Post-F9.136: tampoco se pagan)', () => {
    // La cantidad sale de `cantidad`, que ya excluye las incompletas. Si alguien metiera
    // `cantidad_incompletas` al SUM, acabarían multiplicadas por un precio.
    expect(agregado.sql).not.toContain('cantidad_incompletas');
  });
});
