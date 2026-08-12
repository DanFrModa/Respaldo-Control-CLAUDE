import { describe, expect, it } from 'vitest';

import {
  aNumero,
  capturaDesdeNota,
  renglonApi,
  renglonCompleto,
  renglonVacio,
  type RenglonNotaCaptura,
} from './captura';
import { notaDePrueba, renglonMigradoDePrueba } from './fixtures';

/** Renglón de captura base, sobrescribible. */
function renglon(over: Partial<RenglonNotaCaptura> = {}): RenglonNotaCaptura {
  return { ...renglonVacio(), ...over };
}

describe('captura de notas de salida (F4-E5)', () => {
  describe('renglonCompleto', () => {
    it('un avío exige orden + avío + cantidad > 0', () => {
      expect(
        renglonCompleto(renglon({ tipo: 'avio', idOrden: 50, idAvio: 3, cantidad: '5' })),
      ).toBe(true);
      // Sin avío.
      expect(renglonCompleto(renglon({ tipo: 'avio', idOrden: 50, cantidad: '5' }))).toBe(false);
      // Sin orden.
      expect(renglonCompleto(renglon({ tipo: 'avio', idAvio: 3, cantidad: '5' }))).toBe(false);
      // Cantidad 0.
      expect(
        renglonCompleto(renglon({ tipo: 'avio', idOrden: 50, idAvio: 3, cantidad: '0' })),
      ).toBe(false);
    });

    it('una tela exige orden + tela + lote + movimiento de salida-a-orden + cantidad', () => {
      const completo = renglon({
        tipo: 'tela',
        idOrden: 50,
        idTela: 7,
        idLote: 11,
        idMovimientoSalidaTela: 300,
        cantidad: '30',
      });
      expect(renglonCompleto(completo)).toBe(true);
      // Sin el movimiento de salida-a-orden (decisión e) → incompleto.
      expect(renglonCompleto({ ...completo, idMovimientoSalidaTela: null })).toBe(false);
      // Sin lote → incompleto.
      expect(renglonCompleto({ ...completo, idLote: null })).toBe(false);
    });

    // V1-E3b — el renglón MIGRADO no se puede enviar (no tiene avío ni tela: el contrato de
    // captura lo rechazaría). No es un caso vivo (las notas migradas nacen confirmadas y no se
    // editan), pero vale más deshabilitar el guardar que comerse un 400.
    it('un renglón migrado NUNCA está completo (no se puede re-enviar)', () => {
      expect(
        renglonCompleto(
          renglon({
            tipo: 'historico',
            idOrden: 50,
            cantidad: '5',
            descripcionLegacy: 'texto viejo',
          }),
        ),
      ).toBe(false);
    });
  });

  describe('renglonApi', () => {
    it('proyecta un renglón de avío (sin campos de tela)', () => {
      const cuerpo = renglonApi(
        renglon({ tipo: 'avio', idOrden: 50, idAvio: 3, cantidad: '5', unidad: 'pza' }),
      );
      expect(cuerpo).toMatchObject({ idOrden: 50, idAvio: 3, cantidad: 5, unidad: 'pza' });
      expect('idTela' in cuerpo).toBe(false);
    });

    it('proyecta un renglón de tela con su movimiento de salida-a-orden', () => {
      const cuerpo = renglonApi(
        renglon({
          tipo: 'tela',
          idOrden: 50,
          idTela: 7,
          idLote: 11,
          idMovimientoSalidaTela: 300,
          cantidad: '30',
        }),
      );
      expect(cuerpo).toMatchObject({
        idOrden: 50,
        idTela: 7,
        idLote: 11,
        idMovimientoSalidaTela: 300,
        cantidad: 30,
      });
      expect('idAvio' in cuerpo).toBe(false);
    });
  });

  describe('aNumero', () => {
    it('vacío/negativo/no numérico → 0; positivo → su valor', () => {
      expect(aNumero('')).toBe(0);
      expect(aNumero('-3')).toBe(0);
      expect(aNumero('abc')).toBe(0);
      expect(aNumero('12.5')).toBe(12.5);
    });
  });

  describe('capturaDesdeNota', () => {
    it('reconstruye los renglones (avío y tela) desde una nota existente', () => {
      const renglones = capturaDesdeNota(notaDePrueba());
      expect(renglones).toHaveLength(2);
      expect(renglones[0]).toMatchObject({ tipo: 'avio', idAvio: 3, idOrden: 50, cantidad: '120' });
      expect(renglones[1]).toMatchObject({
        tipo: 'tela',
        idTela: 7,
        idLote: 11,
        idMovimientoSalidaTela: 300,
        cantidad: '30',
      });
      // Los nombres viajan para poder MOSTRAR el renglón viejo sin volver a pedir el catálogo.
      expect(renglones[1]).toMatchObject({ telaNombre: 'Felpa francesa', loteClave: 'L-2026-09' });
    });

    it('conserva el texto libre del renglón MIGRADO (es lo único que tiene)', () => {
      const nota = notaDePrueba({ lineas: [renglonMigradoDePrueba()] });
      const [renglonUno] = capturaDesdeNota(nota);
      expect(renglonUno).toMatchObject({
        tipo: 'historico',
        descripcionLegacy: '3 conos hilo negro y etiquetas',
      });
    });
  });
});
