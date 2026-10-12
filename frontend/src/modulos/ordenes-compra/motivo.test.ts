import { describe, expect, it } from 'vitest';

import { paramsFiltroMotivo } from './motivo';

/** ⭐ Fila 0.231 — la traducción del filtro de la pantalla a los parámetros del servidor. */
describe('paramsFiltroMotivo', () => {
  it('sin filtro no manda nada', () => {
    expect(paramsFiltroMotivo('')).toEqual({});
  });
  it('compra normal = sin motivo; compras extra = con alguno', () => {
    expect(paramsFiltroMotivo('normal')).toEqual({ conMotivo: 'false' });
    expect(paramsFiltroMotivo('extra')).toEqual({ conMotivo: 'true' });
  });
  it('un motivo en particular viaja por su id', () => {
    expect(paramsFiltroMotivo('7')).toEqual({ idMotivoCompra: 7 });
  });
});
