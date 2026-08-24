import { describe, expect, it } from 'vitest';

import type { EstatusOrdenCompra } from '@/api/tipos';

import { descripcionMaterial, motivoNoImprimirOc } from './piezas';

/**
 * Piezas compartidas del módulo Órdenes de compra: los helpers PUROS de presentación. Fijar aquí lo
 * que deciden —y no sólo cómo se ven pintados— es lo que evita que un cambio de una línea en el
 * texto se lleve por delante una regla del dueño.
 */
describe('descripcionMaterial (§Post-F9.89)', () => {
  it('tela con color se lee "Tela · Color"; sin color, igual que siempre', () => {
    expect(
      descripcionMaterial({
        tela: 'Felpa 280',
        telaColor: 'Marino Alsa',
        avio: null,
        descripcionLibre: null,
      }),
    ).toBe('Felpa 280 · Marino Alsa');
    expect(descripcionMaterial({ tela: 'Felpa 280', avio: null, descripcionLibre: null })).toBe(
      'Felpa 280',
    );
  });

  it('sin tela usa el avío, y sin avío la descripción libre', () => {
    expect(
      descripcionMaterial({ tela: null, avio: 'BOT-01 — Botón', descripcionLibre: null }),
    ).toBe('BOT-01 — Botón');
    expect(descripcionMaterial({ tela: null, avio: null, descripcionLibre: 'Flete' })).toBe(
      'Flete',
    );
    expect(descripcionMaterial({ tela: null, avio: null, descripcionLibre: null })).toBe(
      'Renglón sin material',
    );
  });
});

/**
 * ⭐ V1-E4e (§Post-F9.101) — DANIEL: *"Nunca debe de dejar imprimir una orden que no esté
 * autorizada… ni aunque diga borrador."* Esta función sólo ESCONDE el botón y explica; el que niega
 * de verdad es el servidor (§Post-F9.68: esconder Y bloquear).
 */
describe('motivoNoImprimirOc (§Post-F9.101)', () => {
  it('deja imprimir la AUTORIZADA y las RECIBIDAS', () => {
    expect(motivoNoImprimirOc('autorizada')).toBeNull();
    expect(motivoNoImprimirOc('recibida_parcial')).toBeNull();
    expect(motivoNoImprimirOc('recibida_total')).toBeNull();
  });

  it('NIEGA borrador y pendiente, y dice cuándo se imprime (ni botón muerto ni error seco)', () => {
    for (const estatus of ['borrador', 'pendiente_autorizacion'] as EstatusOrdenCompra[]) {
      expect(motivoNoImprimirOc(estatus)).toBe('Se imprime cuando la orden esté autorizada.');
    }
  });

  it('NIEGA la cancelada con su propio motivo, no con el de "autorízala"', () => {
    expect(motivoNoImprimirOc('cancelada')).toContain('cancelada');
    expect(motivoNoImprimirOc('cancelada')).not.toContain('esté autorizada');
  });
});
