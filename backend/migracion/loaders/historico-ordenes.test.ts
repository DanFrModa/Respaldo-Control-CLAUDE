/**
 * Unit (sin BD ni CSV) del campo abierto con TODOS los talleres del archivo histórico (§Post-F9.27).
 *
 * Daniel, corrigiendo la primera versión: *"es importante que vayan todos. Y no solo el primero.
 * Lo mismo para estampadores."* Este test fija justo eso.
 */
import { describe, expect, it } from 'vitest';

import { nombresDistintos, type ProcesoCrudo } from './historico-ordenes.js';

/** Arma un proceso mínimo (lo demás no lo mira la función). */
function proceso(tipo: ProcesoCrudo['tipo'], tercero: string | null): ProcesoCrudo {
  return { idOrdenV1: '1', tipo, fecha: null, tercero, cantidad: 0, observaciones: null };
}

describe('nombresDistintos', () => {
  const procesos: ProcesoCrudo[] = [
    proceso('corte', 'Oscar Aragón'),
    proceso('envio_maquila', 'Taller Sosa'),
    proceso('recibo_maquila', 'Taller Sosa'), // el mismo taller, dos documentos
    proceso('envio_maquila', 'Taller Montaño'), // una orden pasa por VARIOS talleres
    proceso('envio_estampado', 'Serigrafía López'),
  ];

  it('junta TODOS los talleres de un rol, no solo el primero', () => {
    expect(nombresDistintos(procesos, ['envio_maquila', 'recibo_maquila'])).toBe(
      'Taller Montaño · Taller Sosa',
    );
  });

  it('separa por rol: el que corta no se mezcla con el que cose ni con el que estampa', () => {
    expect(nombresDistintos(procesos, ['corte'])).toBe('Oscar Aragón');
    expect(nombresDistintos(procesos, ['envio_estampado', 'recibo_estampado'])).toBe(
      'Serigrafía López',
    );
  });

  it('no repite un taller que aparece en varios documentos', () => {
    const repetido = [proceso('corte', 'Ana'), proceso('corte', 'Ana'), proceso('corte', 'Ana')];
    expect(nombresDistintos(repetido, ['corte'])).toBe('Ana');
  });

  it('ordena alfabéticamente para que dos corridas den el MISMO texto', () => {
    const desordenado = [
      proceso('corte', 'Zúñiga'),
      proceso('corte', 'Álvarez'),
      proceso('corte', 'Méndez'),
    ];
    expect(nombresDistintos(desordenado, ['corte'])).toBe('Álvarez · Méndez · Zúñiga');
  });

  it('sin terceros con nombre devuelve null (no una cadena vacía ni " · ")', () => {
    expect(nombresDistintos([proceso('corte', null), proceso('corte', '')], ['corte'])).toBeNull();
    expect(nombresDistintos([], ['corte'])).toBeNull();
  });
});
