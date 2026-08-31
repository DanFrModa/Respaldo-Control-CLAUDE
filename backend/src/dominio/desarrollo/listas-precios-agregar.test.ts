/**
 * ⭐ V1-E8y — LA CLASIFICACIÓN QUE COMPARTEN LAS DOS PUERTAS DE LA LISTA.
 *
 * `crearLista` (F8-E4) y `agregarLineasLista` (V1-E8y) deciden lo MISMO —quién puede entrar como
 * renglón y por qué no— y desde esta etapa lo deciden con la MISMA función. Estas pruebas la fijan
 * sin base de datos, que es donde se puede razonar cada mutación:
 *
 *  • si el orden dejara de ser el PEDIDO, el usuario leería los problemas contra otra lista;
 *  • si `hayEntradaInvalida` dejara de distinguir, un id ajeno saldría como 409 («conflicto de
 *    estado») en vez de 400 («eso no es de este cliente»);
 *  • si el texto dejara de nombrar el MODELO, el mensaje volvería a ser el «no hay desarrollos
 *    disponibles» que dejó a Daniel sin salida (§Post-F9.128).
 */
import { describe, expect, it } from 'vitest';

import { problemasDeCandidatura, type DesarrolloParaCandidatura } from './listas-precios.js';

/** Un desarrollo que SÍ califica: activo, con precosto congelado y sin renglón en ninguna lista. */
function candidato(codigo: string): DesarrolloParaCandidatura {
  return {
    apagado: false,
    modelo: { codigo },
    precostos: [{ estado: 'congelado', version: 2 }],
    listaLineas: [],
  };
}

describe('problemasDeCandidatura', () => {
  it('no dice nada cuando todos califican', () => {
    const porId = new Map([
      [1, candidato('CYA-26-71-001')],
      [2, candidato('CYA-26-71-002')],
    ]);
    expect(problemasDeCandidatura([1, 2], porId)).toEqual({
      problemas: [],
      hayEntradaInvalida: false,
    });
  });

  it('🔴 un id que la consulta NO devolvió es ENTRADA INVÁLIDA (400), no un conflicto de estado', () => {
    const porId = new Map([[1, candidato('CYA-26-71-001')]]);
    const { problemas, hayEntradaInvalida } = problemasDeCandidatura([1, 99], porId);
    expect(hayEntradaInvalida).toBe(true);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain('#99');
  });

  it('🔴 lo que existe pero no califica es CONFLICTO (409), no entrada inválida', () => {
    const porId = new Map<number, DesarrolloParaCandidatura>([
      [1, { ...candidato('CYA-26-71-001'), apagado: true }],
    ]);
    const { problemas, hayEntradaInvalida } = problemasDeCandidatura([1], porId);
    expect(hayEntradaInvalida).toBe(false);
    expect(problemas[0]).toContain('CYA-26-71-001');
    expect(problemas[0]).toContain('apagado');
  });

  it('🔴 nombra la VERSIÓN que se quedó sin congelar (§Post-F9.96: no sirve saber que algo falta sin saber qué)', () => {
    const porId = new Map<number, DesarrolloParaCandidatura>([
      [
        1,
        {
          apagado: false,
          modelo: { codigo: 'CYA-26-71-007' },
          precostos: [{ estado: 'borrador', version: 3 }],
          listaLineas: [],
        },
      ],
    ]);
    const { problemas } = problemasDeCandidatura([1], porId);
    expect(problemas[0]).toContain('v3');
    expect(problemas[0]).toContain('BORRADOR');
  });

  it('distingue «no tiene ni un precosto» de «lo tiene en borrador»', () => {
    const porId = new Map<number, DesarrolloParaCandidatura>([
      [1, { apagado: false, modelo: { codigo: 'MOD-SIN' }, precostos: [], listaLineas: [] }],
    ]);
    const { problemas } = problemasDeCandidatura([1], porId);
    expect(problemas[0]).toContain('todavía no tiene precosto');
  });

  it('🔴 el texto es NEUTRO: no dice «otra» lista, porque puede ser la que el usuario tiene enfrente', () => {
    const porId = new Map<number, DesarrolloParaCandidatura>([
      [1, { ...candidato('MOD-YA'), listaLineas: [{ idLista: 7 }] }],
    ]);
    const { problemas } = problemasDeCandidatura([1], porId);
    expect(problemas[0]).toContain('ya está en una lista de precios');
    expect(problemas[0]).not.toContain('otra lista');
  });

  it('🔴 cuando el renglón es de ESTA lista, lo dice (dos clics en «Agregar a la lista»)', () => {
    const porId = new Map<number, DesarrolloParaCandidatura>([
      [1, { ...candidato('MOD-YA'), listaLineas: [{ idLista: 7 }] }],
    ]);
    const { problemas } = problemasDeCandidatura([1], porId, { idListaActual: 7 });
    expect(problemas[0]).toBe('MOD-YA: ya está en ESTA lista');
  });

  it('🔴 y si el renglón es de OTRA lista, NO dice «ésta» (el aviso tiene que ser cierto)', () => {
    const porId = new Map<number, DesarrolloParaCandidatura>([
      [1, { ...candidato('MOD-YA'), listaLineas: [{ idLista: 99 }] }],
    ]);
    const { problemas } = problemasDeCandidatura([1], porId, { idListaActual: 7 });
    expect(problemas[0]).not.toContain('ESTA lista');
    expect(problemas[0]).toContain('ya está en una lista de precios');
  });

  it('🔴 el que YA está en una lista se rechaza primero (el remedio empieza por quitarlo de ahí)', () => {
    // Apagado Y ya-en-lista a la vez: gana `ya-en-lista`, porque reactivarlo no lo desatasca.
    const porId = new Map<number, DesarrolloParaCandidatura>([
      [
        1,
        {
          apagado: true,
          modelo: { codigo: 'MOD-DOBLE' },
          precostos: [{ estado: 'congelado', version: 1 }],
          listaLineas: [{}],
        },
      ],
    ]);
    const { problemas } = problemasDeCandidatura([1], porId);
    expect(problemas[0]).toContain('ya está en una lista');
  });

  it('🔴 conserva el ORDEN EN QUE SE PIDIERON los ids (el usuario los lee contra su selección)', () => {
    const porId = new Map<number, DesarrolloParaCandidatura>([
      [1, { ...candidato('AAA-1'), apagado: true }],
      [2, { ...candidato('BBB-2'), apagado: true }],
      [3, { ...candidato('CCC-3'), apagado: true }],
    ]);
    const { problemas } = problemasDeCandidatura([3, 1, 2], porId);
    expect(problemas.map((p) => p.split(':')[0])).toEqual(['CCC-3', 'AAA-1', 'BBB-2']);
  });

  it('junta TODOS los problemas de una vez (no se detiene en el primero)', () => {
    const porId = new Map<number, DesarrolloParaCandidatura>([
      [1, { ...candidato('AAA-1'), apagado: true }],
      [2, { apagado: false, modelo: { codigo: 'BBB-2' }, precostos: [], listaLineas: [] }],
    ]);
    const { problemas, hayEntradaInvalida } = problemasDeCandidatura([1, 2, 77], porId);
    expect(problemas).toHaveLength(3);
    expect(hayEntradaInvalida).toBe(true);
  });
});
