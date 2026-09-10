import { describe, expect, it } from 'vitest';

import { CLAVE_SECUENCIA_ORDEN_COMPRA } from '../src/dominio/compras/ordenes-compra.js';
import { CLAVE_SECUENCIA_ORDEN } from '../src/dominio/produccion/ordenes.js';
import {
  corridaEscribe,
  formatearEscalon,
  leerOpciones,
  modoDeUso,
  type Plan,
} from './reparar-secuencias.js';

/**
 * Unit de la CÁSCARA del script (fila 0.187): las banderas del escalón de arranque y el cuadro que
 * se imprime antes de aplicarlo. Lo que toca la base —el plan, la guarda del escalón por lo bajo y
 * la idempotencia— se prueba contra Postgres en `reparar-secuencias.int.test.ts`.
 *
 * El escalón es IRREVERSIBLE una vez que alguien captura con la numeración nueva, así que la
 * cáscara tiene tanto que garantizar como el motor: que nada se escriba por un error de dedo.
 */
describe('leerOpciones', () => {
  it('sin banderas: corrida normal, sin escalón y escribiendo (lo de siempre)', () => {
    expect(leerOpciones([])).toEqual({
      escalones: new Map(),
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

  it('SÓLO OP y OC admiten escalón: las otras series ni siquiera tienen bandera', () => {
    for (const bandera of [
      '--escalon-pedido=100',
      '--escalon-auditoria=100',
      '--escalon-nota-salida=100',
      '--escalon-etapa-mov=100',
      '--escalon-movimiento-tercero=100',
    ]) {
      expect(() => leerOpciones([bandera])).toThrow(/Opción desconocida/);
    }
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

  it('--aplicar y --simular se contradicen', () => {
    expect(() => leerOpciones(['--escalon-orden=6000', '--aplicar', '--simular'])).toThrow(
      /se contradicen/,
    );
  });

  it('--aplicar sin escalón no significa nada: aborta en vez de dar falsa sensación', () => {
    expect(() => leerOpciones(['--aplicar'])).toThrow(/sólo tiene sentido con un escalón/);
  });

  it('--empresa sin escalón aborta: la reparación normal siempre corre para todas', () => {
    expect(() => leerOpciones(['--empresa=1'])).toThrow(/sólo acota el ESCALÓN/);
    expect(leerOpciones(['--escalon-orden=6000', '--empresa=2']).idEmpresa).toBe(2);
    expect(() => leerOpciones(['--escalon-orden=6000', '--empresa=0'])).toThrow(/--empresa/);
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
  it('lista las banderas de escalón que existen de verdad, y sólo ésas', () => {
    const texto = modoDeUso();
    expect(texto).toContain('--escalon-orden=<n>');
    expect(texto).toContain('--escalon-orden-compra=<n>');
    expect(texto).not.toContain('--escalon-pedido');
  });
});

describe('formatearEscalon', () => {
  const plan: Plan = {
    hayEscalon: true,
    series: [
      {
        clave: CLAVE_SECUENCIA_ORDEN,
        descripcion: 'órdenes de producción',
        etiqueta: 'órdenes de producción (OP)',
        renglones: [
          {
            idEmpresa: 1,
            nombreEmpresa: 'FR Moda SA de CV',
            maxTabla: 5847n,
            valorSecuencia: 5847n,
            comprometido: 5847n,
            escalon: 6000n,
            valorASembrar: 5999n,
            siguiente: 6000n,
          },
        ],
      },
    ],
  };

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

  it('distingue el ENSAYO del APLICADO y dice cómo seguir', () => {
    const ensayo = formatearEscalon(plan, false);
    expect(ensayo).toContain('ENSAYO EN SECO (no se escribió nada)');
    expect(ensayo).toContain('--aplicar');
    const aplicado = formatearEscalon(plan, true);
    expect(aplicado).toContain('APLICADO');
    expect(aplicado).not.toContain('ENSAYO EN SECO');
  });
});
