import { describe, expect, it } from 'vitest';

import { CLAVE_SECUENCIA_AUDITORIA } from '../src/dominio/calidad/auditorias.js';
import { CLAVE_SECUENCIA_ORDEN_COMPRA } from '../src/dominio/compras/ordenes-compra.js';
import { CLAVE_SECUENCIA_NOTA_SALIDA } from '../src/dominio/notas/notas-salida.js';
import { CLAVE_SECUENCIA_PEDIDO } from '../src/dominio/pedidos/pedidos.js';
import { CLAVE_SECUENCIA_ETAPA } from '../src/dominio/produccion/etapas.js';
import { CLAVE_SECUENCIA_ORDEN } from '../src/dominio/produccion/ordenes.js';
import { CLAVE_SECUENCIA_TERCERO } from '../src/dominio/terceros/cuenta-terceros.js';
import {
  corridaEscribe,
  formatearEscalon,
  leerOpciones,
  modoDeUso,
  siguienteMillar,
  type Plan,
} from './reparar-secuencias.js';

/**
 * Unit de la CÁSCARA del script (fila 0.187): las banderas del escalón de arranque y el cuadro que
 * se imprime antes de aplicarlo. Lo que toca la base —el plan, la guarda del escalón por lo bajo y
 * la idempotencia— se prueba contra Postgres en `reparar-secuencias.int.test.ts`.
 *
 * El escalón es IRREVERSIBLE una vez que alguien captura con la numeración nueva, así que la
 * cáscara tiene tanto que garantizar como el motor: que nada se escriba por un error de dedo.
 *
 * Desde la fila 0.194 (§Post-F9.233) la cáscara lleva además **la regla del siguiente millar** y la
 * precedencia del número explícito sobre ella.
 */

describe('siguienteMillar (la REGLA del arranque, §Post-F9.233)', () => {
  it('sube al millar de arriba — el ejemplo textual de Daniel', () => {
    // *"una Nota de salida… si van en la 4804, ubícate en la 5000"*.
    expect(siguienteMillar(4804n)).toBe(5000n);
    expect(siguienteMillar(312n)).toBe(1000n);
    expect(siguienteMillar(5847n)).toBe(6000n); // la OP del ejemplo de §Post-F9.36 → 6,000
    expect(siguienteMillar(7920n)).toBe(8000n);
  });

  it('la tabla vacía arranca en 1,000 (también salta: es un conteo más)', () => {
    expect(siguienteMillar(0n)).toBe(1000n);
    expect(siguienteMillar(1n)).toBe(1000n);
    expect(siguienteMillar(999n)).toBe(1000n);
  });

  /**
   * ⭐ EL CASO QUE DECIDE EL DISEÑO: un máximo que YA cae justo en un millar.
   *
   * Quedarse en 5,000 sería "redondear hacia arriba" en el sentido matemático… y repetiría el folio
   * 5,000, que ya está usado — la guarda del escalón por lo bajo abortaría la corrida del arranque.
   * Por eso la regla es SIEMPRE estrictamente mayor: sube al millar siguiente.
   */
  it('un máximo que YA es millar exacto sube al SIGUIENTE, no se queda', () => {
    expect(siguienteMillar(1000n)).toBe(2000n);
    expect(siguienteMillar(5000n)).toBe(6000n);
    expect(siguienteMillar(10000n)).toBe(11000n);
  });

  it('es SIEMPRE estrictamente mayor que su entrada (la propiedad que la hace segura)', () => {
    for (const n of [0n, 1n, 999n, 1000n, 1001n, 4804n, 999999n, 1000000n]) {
      expect(siguienteMillar(n) > n).toBe(true);
    }
  });
});
describe('leerOpciones', () => {
  it('sin banderas: corrida normal, sin escalón y escribiendo (lo de siempre)', () => {
    expect(leerOpciones([])).toEqual({
      escalones: new Map(),
      millar: false,
      aplicar: false,
      simular: false,
      ayuda: false,
    });
  });

  it('lee el escalón de OP y el de OC por separado (son números distintos)', () => {
    const opciones = leerOpciones(['--escalon-orden=6000', '--escalon-orden-compra=8000']);
    expect(opciones.escalones.get(CLAVE_SECUENCIA_ORDEN)).toBe(6000n);
    expect(opciones.escalones.get(CLAVE_SECUENCIA_ORDEN_COMPRA)).toBe(8000n);
  });

  it('ignora el separador "--" que enseña el README', () => {
    expect(leerOpciones(['--', '--escalon-orden=6000']).escalones.get(CLAVE_SECUENCIA_ORDEN)).toBe(
      6000n,
    );
  });

  /**
   * §Post-F9.233 (Daniel, 14-sep-2026): *"me gustaría hacer saltos en TODOS los conteos"*. Hasta la
   * fila 0.194 sólo OP y OC tenían bandera; las otras cinco arrancaban pegadas a "último + 1", y el
   * día del go-live esa ventana se cierra para siempre.
   */
  it('LAS SIETE series admiten escalón explícito, cada una con su bandera', () => {
    const esperadas: [string, string][] = [
      ['--escalon-pedido=100', CLAVE_SECUENCIA_PEDIDO],
      ['--escalon-orden=100', CLAVE_SECUENCIA_ORDEN],
      ['--escalon-etapa=100', CLAVE_SECUENCIA_ETAPA],
      ['--escalon-auditoria=100', CLAVE_SECUENCIA_AUDITORIA],
      ['--escalon-orden-compra=100', CLAVE_SECUENCIA_ORDEN_COMPRA],
      ['--escalon-nota-salida=100', CLAVE_SECUENCIA_NOTA_SALIDA],
      ['--escalon-tercero=100', CLAVE_SECUENCIA_TERCERO],
    ];
    for (const [bandera, clave] of esperadas) {
      expect(leerOpciones([bandera]).escalones.get(clave)).toBe(100n);
    }
    // Y las siete de una vez, que es como se teclearían en el arranque.
    expect(leerOpciones(esperadas.map(([b]) => b)).escalones.size).toBe(7);
  });

  it('--escalon-millar es la REGLA: se pide sola, sin número pegado', () => {
    const opciones = leerOpciones(['--escalon-millar']);
    expect(opciones.millar).toBe(true);
    expect(opciones.escalones.size).toBe(0);
    // Llevar un número sería confundirla con un escalón explícito: la regla NO se parametriza.
    expect(() => leerOpciones(['--escalon-millar=1000'])).toThrow(/Opción desconocida/);
  });

  it('la regla y el número explícito CONVIVEN: es el comando del arranque', () => {
    // §Post-F9.233: OP 6000 y OC 10000 los dijo Daniel; las otras cinco salen de la regla.
    const opciones = leerOpciones([
      '--escalon-millar',
      '--escalon-orden=6000',
      '--escalon-orden-compra=10000',
    ]);
    expect(opciones.millar).toBe(true);
    expect(opciones.escalones.get(CLAVE_SECUENCIA_ORDEN)).toBe(6000n);
    expect(opciones.escalones.get(CLAVE_SECUENCIA_ORDEN_COMPRA)).toBe(10000n);
    expect(opciones.escalones.has(CLAVE_SECUENCIA_NOTA_SALIDA)).toBe(false);
  });

  it('una bandera desconocida ABORTA: nunca se ignora en silencio', () => {
    expect(() => leerOpciones(['--escalon-ordenes=6000'])).toThrow(/Opción desconocida/);
    expect(() => leerOpciones(['--dry_run'])).toThrow(/Opción desconocida/);
    expect(() => leerOpciones(['6000'])).toThrow(/Opción desconocida/);
  });

  it('el olvido más probable —espacio en vez de "="— aborta Y dice cómo se escribe', () => {
    // `--escalon-orden 6000` llega como dos argumentos: la bandera suelta y el número.
    expect(() => leerOpciones(['--escalon-orden', '6000'])).toThrow(/--escalon-orden=6000/);
  });

  it('rechaza un escalón que no sea un entero limpio (6,000 no es 6)', () => {
    expect(() => leerOpciones(['--escalon-orden=6,000'])).toThrow(/sin comas ni puntos/);
    expect(() => leerOpciones(['--escalon-orden=6_000'])).toThrow(/sin comas ni puntos/);
    expect(() => leerOpciones(['--escalon-orden=abc'])).toThrow(/sin comas ni puntos/);
    expect(() => leerOpciones(['--escalon-orden=0'])).toThrow(/≥ 1/);
  });

  it('la MISMA bandera dos veces ABORTA: no se queda con la última en silencio', () => {
    // `valores.set` sobrescribía: `--escalon-orden=6000 --escalon-orden=7000` salía con 7000 y sin
    // una palabra. En una operación irreversible, "la última gana" es adivinar.
    expect(() => leerOpciones(['--escalon-orden=6000', '--escalon-orden=7000'])).toThrow(
      /viene dos veces/,
    );
    // Y el mensaje canta LOS DOS valores, para que se vea cuál sobraba.
    expect(() => leerOpciones(['--escalon-orden=6000', '--escalon-orden=7000'])).toThrow(/7000/);
    expect(() => leerOpciones(['--escalon-orden=6000', '--escalon-orden=6000'])).toThrow(
      /viene dos veces/,
    );
    expect(() => leerOpciones(['--escalon-orden=6000', '--empresa=1', '--empresa=2'])).toThrow(
      /--empresa viene dos veces/,
    );
    // Dos banderas DISTINTAS siguen conviviendo (es el uso normal: OP y OC a la vez).
    expect(
      leerOpciones(['--escalon-orden=6000', '--escalon-orden-compra=8000']).escalones.size,
    ).toBe(2);
  });

  it('--aplicar y --simular se contradicen', () => {
    expect(() => leerOpciones(['--escalon-orden=6000', '--aplicar', '--simular'])).toThrow(
      /se contradicen/,
    );
  });

  it('--aplicar sin escalón no significa nada: aborta en vez de dar falsa sensación', () => {
    expect(() => leerOpciones(['--aplicar'])).toThrow(/sólo tiene sentido con un escalón/);
    // …pero la REGLA sí es un escalón: `--escalon-millar --aplicar` es una corrida legítima.
    expect(leerOpciones(['--escalon-millar', '--aplicar']).aplicar).toBe(true);
    expect(leerOpciones(['--escalon-millar', '--empresa=1']).idEmpresa).toBe(1);
  });

  it('--empresa sin escalón aborta: la reparación normal siempre corre para todas', () => {
    expect(() => leerOpciones(['--empresa=1'])).toThrow(/sólo acota el ESCALÓN/);
    expect(leerOpciones(['--escalon-orden=6000', '--empresa=2']).idEmpresa).toBe(2);
    expect(() => leerOpciones(['--escalon-orden=6000', '--empresa=0'])).toThrow(/--empresa/);
  });

  it('--empresa se lee TAN estricto como el escalón: "4abc" no es la empresa 4', () => {
    // `Number.parseInt` a secas devolvía 4 para "4abc" y 2 para "2.9" — o sea, un dedazo aplicaba
    // el salto irreversible a OTRA empresa sin decir nada.
    for (const malo of ['4abc', '2.9', ' 2', '2 ', '+2', '2e1', '']) {
      expect(() => leerOpciones(['--escalon-orden=6000', `--empresa=${malo}`])).toThrow(
        /--empresa/,
      );
    }
    expect(leerOpciones(['--escalon-orden=6000', '--empresa=12']).idEmpresa).toBe(12);
  });

  it('--simular y --dry-run son la misma cosa (el repo usa las dos palabras)', () => {
    expect(leerOpciones(['--simular']).simular).toBe(true);
    expect(leerOpciones(['--dry-run']).simular).toBe(true);
  });
});

describe('corridaEscribe (el cinturón nº 2: ensayo en seco por omisión)', () => {
  const cli = (aplicar: boolean, simular: boolean): { aplicar: boolean; simular: boolean } => ({
    aplicar,
    simular,
  });

  it('CON escalón: NO escribe si no se dijo --aplicar', () => {
    expect(corridaEscribe(cli(false, false), true)).toBe(false);
    expect(corridaEscribe(cli(true, false), true)).toBe(true);
  });

  it('SIN escalón: escribe como siempre (la reparación normal es inocua)', () => {
    expect(corridaEscribe(cli(false, false), false)).toBe(true);
  });

  it('--simular manda sobre todo lo demás', () => {
    expect(corridaEscribe(cli(false, true), false)).toBe(false);
    expect(corridaEscribe(cli(false, true), true)).toBe(false);
  });
});

describe('modoDeUso', () => {
  it('lista LAS SIETE banderas de escalón y la regla del millar', () => {
    const texto = modoDeUso();
    for (const bandera of [
      '--escalon-pedido=<n>',
      '--escalon-orden=<n>',
      '--escalon-etapa=<n>',
      '--escalon-auditoria=<n>',
      '--escalon-orden-compra=<n>',
      '--escalon-nota-salida=<n>',
      '--escalon-tercero=<n>',
    ]) {
      expect(texto).toContain(bandera);
    }
    expect(texto).toContain('--escalon-millar');
    // Y el comando del arranque, copiable: es el que se teclea una sola vez en la vida.
    expect(texto).toContain('--escalon-millar --escalon-orden=6000 --escalon-orden-compra=10000');
  });

  it('no inventa banderas: las que anuncia son exactamente las que el parser acepta', () => {
    // El modo de uso se construye desde SERIES; si alguien lo escribiera a mano, esto lo cazaría.
    const anunciadas = [...modoDeUso().matchAll(/--(escalon-[a-z-]+)=<n>/g)].map((m) => m[1] ?? '');
    expect(anunciadas).toHaveLength(7);
    for (const bandera of anunciadas) {
      expect(() => leerOpciones([`--${bandera}=1000`])).not.toThrow();
    }
  });
});

describe('formatearEscalon', () => {
  /** Un plan con UN renglón, para no repetir el andamio en cada caso. */
  const planCon = (renglon: Partial<Plan['series'][number]['renglones'][number]>): Plan => ({
    hayEscalon: true,
    sinDatosConRegla: [],
    series: [
      {
        clave: CLAVE_SECUENCIA_ORDEN,
        descripcion: 'órdenes de producción',
        etiqueta: 'órdenes de producción (OP)',
        flagEscalon: 'escalon-orden',
        renglones: [
          {
            idEmpresa: 1,
            nombreEmpresa: 'FR Moda SA de CV',
            maxTabla: 5847n,
            valorSecuencia: 5847n,
            comprometido: 5847n,
            escalon: 6000n,
            origenEscalon: 'explicito',
            millarRegla: 6000n,
            valorASembrar: 5999n,
            siguiente: 6000n,
            ...renglon,
          },
        ],
      },
    ],
  });
  const plan: Plan = planCon({});

  it('canta los cuatro números del salto, con la empresa por su nombre', () => {
    const texto = formatearEscalon(plan, false);
    expect(texto).toContain('FR Moda SA de CV');
    expect(texto).toContain('5,847'); // último comprometido
    expect(texto).toContain('5,848'); // lo que sería sin escalón
    expect(texto).toContain('6,000'); // lo que será con escalón
    expect(texto).toContain('152'); // folios que quedan sin usar
  });

  it('avisa de la irreversibilidad siempre, ensayo o no', () => {
    expect(formatearEscalon(plan, false)).toContain('IRREVERSIBLE');
    expect(formatearEscalon(plan, true)).toContain('IRREVERSIBLE');
  });

  /**
   * ⭐ EL GUARDIÁN DE LA PROPIEDAD MÁS CARA DE LA FILA: el cuadro que el operador LEE en el ensayo
   * tiene que ser EXACTAMENTE el que se imprime al aplicar. Si no, confirma una operación
   * IRREVERSIBLE mirando unos números y el sistema escribe otros.
   *
   * Lo único que puede cambiar entre las dos ramas es el ESTADO: el rótulo del encabezado y la
   * línea final que dice cómo seguir. Todo lo demás —los cuatro números, la empresa, el aviso de
   * irreversibilidad— va calcado.
   *
   * POR QUÉ EXISTE: hasta la revisión de la 0.187 la propiedad se cumplía pero NADIE la sostenía.
   * `formatearEscalon` recibe `escrito` y sólo se comprobaba que cambiara el rótulo. El reviewer
   * envolvió el `push` del "último folio ya comprometido" en un `if (!escrito)` y la suite entera
   * se quedó VERDE mientras ese número desaparecía de la pantalla de confirmación.
   */
  const ESTADO = /APLICADO|ENSAYO EN SECO|^ Aplicado\.|^ NO se escribió nada/;
  const cuerpo = (texto: string): string[] =>
    texto.split('\n').filter((linea) => !ESTADO.test(linea));

  it('el cuadro es IDÉNTICO en el ensayo y al aplicar (salvo las líneas de estado)', () => {
    const ensayo = formatearEscalon(plan, false);
    const aplicado = formatearEscalon(plan, true);
    expect(cuerpo(aplicado)).toEqual(cuerpo(ensayo));
    // Y que el filtro no se haya comido medio cuadro: cada rama quita EXACTAMENTE 2 líneas de
    // estado (encabezado + cierre). Si mañana se agrega otra, hay que sumarla al regex Y a este
    // número — a propósito, para que ninguna línea nueva se cuele disfrazada de "estado".
    expect(ensayo.split('\n').length - cuerpo(ensayo).length).toBe(2);
    expect(aplicado.split('\n').length - cuerpo(aplicado).length).toBe(2);
  });

  it('los cuatro números salen TAMBIÉN al aplicar, no sólo en el ensayo', () => {
    const aplicado = formatearEscalon(plan, true);
    expect(aplicado).toContain('FR Moda SA de CV');
    expect(aplicado).toContain('5,847'); // último comprometido
    expect(aplicado).toContain('5,848'); // lo que sería sin escalón
    expect(aplicado).toContain('6,000'); // lo que será con escalón
    expect(aplicado).toContain('152'); // folios que quedan sin usar
  });

  it('distingue el ENSAYO del APLICADO y dice cómo seguir', () => {
    const ensayo = formatearEscalon(plan, false);
    expect(ensayo).toContain('ENSAYO EN SECO (no se escribió nada)');
    expect(ensayo).toContain('--aplicar');
    const aplicado = formatearEscalon(plan, true);
    expect(aplicado).toContain('APLICADO');
    expect(aplicado).not.toContain('ENSAYO EN SECO');
  });

  /**
   * ⭐ LA PROPIEDAD QUE PIDE §Post-F9.233 (a): el número explícito manda sobre la regla, y eso **no
   * puede pasar en silencio**. El cuadro dice de dónde sale cada número y, cuando el explícito y la
   * regla no coinciden, lo marca — en la MISMA pantalla que se lee antes de aplicar algo
   * irreversible. Sin esta línea, mezclar `--escalon-millar` con una cifra a mano sería una decisión
   * invisible.
   */
  describe('de dónde sale el número (la precedencia, visible)', () => {
    it('explícito que COINCIDE con la regla: lo dice, sin alarma', () => {
      const texto = formatearEscalon(planCon({ escalon: 6000n, millarRegla: 6000n }), false);
      expect(texto).toContain('NÚMERO EXPLÍCITO --escalon-orden=6000');
      expect(texto).toContain('que aquí decía lo mismo (6,000)');
      expect(texto).not.toContain('⚠️  manda sobre la regla');
    });

    it('explícito que DIFIERE de la regla: lo canta con los dos números', () => {
      // Escalón a mano 5,900 sobre un comprometido de 5,847: es válido (va por encima), pero la
      // regla habría dicho 6,000. Quien aplica tiene que VER esa diferencia.
      const texto = formatearEscalon(
        planCon({ escalon: 5900n, millarRegla: 6000n, valorASembrar: 5899n, siguiente: 5900n }),
        false,
      );
      expect(texto).toContain('NÚMERO EXPLÍCITO --escalon-orden=5900');
      expect(texto).toContain('que decía 6,000');
      expect(texto).toContain('se usa el explícito');
    });

    it('cuando sale de la REGLA, nombra la regla y de qué número la calculó', () => {
      const texto = formatearEscalon(planCon({ origenEscalon: 'millar' }), false);
      expect(texto).toContain('REGLA --escalon-millar');
      expect(texto).toContain('el millar siguiente a 5,847');
      expect(texto).not.toContain('NÚMERO EXPLÍCITO');
    });

    it('el origen sale TAMBIÉN al aplicar, no sólo en el ensayo', () => {
      expect(formatearEscalon(planCon({ origenEscalon: 'millar' }), true)).toContain(
        'REGLA --escalon-millar',
      );
    });

    /**
     * La regla recalcula contra el máximo del MOMENTO: repetirla después de capturar volvería a
     * saltar. El escalón explícito no puede (su número ya está comprometido y aborta), así que el
     * aviso es exclusivo de la regla — y va en la pantalla donde se decide aplicar, no en un .md.
     */
    it('avisa de que la regla es de UNA SOLA VEZ — y sólo cuando la regla está en juego', () => {
      expect(formatearEscalon(planCon({ origenEscalon: 'millar' }), false)).toContain(
        '--escalon-millar es de UNA SOLA VEZ',
      );
      expect(formatearEscalon(planCon({ origenEscalon: 'explicito' }), false)).not.toContain(
        'UNA SOLA VEZ',
      );
    });
  });

  it('las series SIN NI UN FOLIO que no saltan se nombran: no se deducen de una ausencia', () => {
    const conVacias: Plan = { ...plan, sinDatosConRegla: ['notas de salida', 'auditorías'] };
    const texto = formatearEscalon(conVacias, false);
    expect(texto).toContain('Series que NO saltan porque NO TIENEN NI UN FOLIO');
    expect(texto).toContain('notas de salida');
    expect(texto).toContain('auditorías');
    expect(texto).toContain('--empresa=<id>');
    // Y si no hay ninguna, el bloque ni aparece (no se anuncia una lista vacía).
    expect(formatearEscalon(plan, false)).not.toContain('Series que NO saltan');
  });
});
