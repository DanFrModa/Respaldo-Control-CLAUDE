/**
 * Unit de los mapeos PUROS del ETL de calidad (F6-E6) — sin BD.
 *
 * Verifica que la traducción de códigos del viejo a los enums de v2 calca las funciones VBA
 * `QueResultado`/`QueTipoAudit` (módulo `Funciones CC`) y que la severidad se infiere del AQL
 * (metadato informativo, decisión (a) — NO veredicto).
 */
import { describe, expect, it } from 'vitest';

import { severidadDesdeAql } from './calidad-defectos.js';
import { resultadoDesdeViejo, tipoDesdeViejo } from './calidad-auditorias.js';

describe('calidad — mapeos puros del ETL (F6-E6)', () => {
  it('severidadDesdeAql: 1→crítico, 2.5→mayor, 10→menor (otros → menor)', () => {
    expect(severidadDesdeAql(1)).toBe('critico');
    expect(severidadDesdeAql(2.5)).toBe('mayor');
    expect(severidadDesdeAql(10)).toBe('menor');
    expect(severidadDesdeAql(4)).toBe('menor');
  });

  it('resultadoDesdeViejo: 1→aprobado, 2→reprobado, resto→no_calificado (QueResultado)', () => {
    expect(resultadoDesdeViejo('1')).toBe('aprobado');
    expect(resultadoDesdeViejo('2')).toBe('reprobado');
    expect(resultadoDesdeViejo('0')).toBe('no_calificado');
    expect(resultadoDesdeViejo('')).toBe('no_calificado');
    expect(resultadoDesdeViejo(undefined)).toBe('no_calificado');
  });

  it('tipoDesdeViejo: 1→en_piso, 2→final, resto→no_definida (QueTipoAudit)', () => {
    expect(tipoDesdeViejo('1')).toBe('en_piso');
    expect(tipoDesdeViejo('2')).toBe('final');
    expect(tipoDesdeViejo('0')).toBe('no_definida');
    expect(tipoDesdeViejo('')).toBe('no_definida');
    expect(tipoDesdeViejo(null)).toBe('no_definida');
  });
});
