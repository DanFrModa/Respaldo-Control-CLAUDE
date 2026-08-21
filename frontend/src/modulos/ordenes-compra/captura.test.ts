import { describe, expect, it } from 'vitest';

import {
  capturaDesdeOc,
  importeRenglon,
  renglonApi,
  renglonVacio,
  totalCaptura,
  totalMatrizRenglon,
  type RenglonOcCaptura,
} from './captura';
import { ocDePrueba } from './fixtures';

/** Renglón de captura base para las pruebas (tela, sin matriz). */
function renglon(sobrescribir: Partial<RenglonOcCaptura> = {}): RenglonOcCaptura {
  return { ...renglonVacio(), idTela: 3, cantidad: '10', precio: '5', ...sobrescribir };
}

describe('captura de OC (helpers F4-E2)', () => {
  it('renglonApi mapea una línea de TELA con XOR de material', () => {
    const cuerpo = renglonApi(renglon({ tipo: 'tela', idTela: 3 }));
    expect(cuerpo.idTela).toBe(3);
    expect(cuerpo.idAvio).toBeNull();
    expect(cuerpo.descripcionLibre).toBeNull();
    expect(cuerpo.cantidad).toBe(10);
    expect(cuerpo.precio).toBe(5);
  });

  it('renglonApi de un AVÍO conserva idAvio + idAvioProveedor y limpia tela/libre', () => {
    const cuerpo = renglonApi(
      renglon({ tipo: 'avio', idTela: null, idAvio: 7, idAvioProveedor: 9 }),
    );
    expect(cuerpo.idAvio).toBe(7);
    expect(cuerpo.idAvioProveedor).toBe(9);
    expect(cuerpo.idTela).toBeNull();
  });

  it('renglonApi de LÍNEA LIBRE manda descripcionLibre y nulos en tela/avío', () => {
    const cuerpo = renglonApi(
      renglon({ tipo: 'libre', idTela: null, descripcionLibre: 'Servicio especial' }),
    );
    expect(cuerpo.descripcionLibre).toBe('Servicio especial');
    expect(cuerpo.idTela).toBeNull();
    expect(cuerpo.idAvio).toBeNull();
  });

  it('con matriz, la cantidad del API es la Σ de la matriz y manda las celdas (sin ceros)', () => {
    const conMatriz = renglon({
      usaMatriz: true,
      cantidad: '999', // se ignora: se usa la Σ de la matriz
      matriz: [{ idColor: 1, color: 'Rojo', cantidades: { 11: 3, 12: 0, 13: 4 } }],
    });
    expect(totalMatrizRenglon(conMatriz.matriz)).toBe(7);
    const cuerpo = renglonApi(conMatriz);
    expect(cuerpo.cantidad).toBe(7);
    expect(cuerpo.tallas).toEqual([
      { idColor: 1, idTalla: 11, cantidad: 3 },
      { idColor: 1, idTalla: 13, cantidad: 4 },
    ]);
  });

  it('importe y total derivan cantidad × precio (matriz o cantidad directa)', () => {
    expect(importeRenglon(renglon({ cantidad: '10', precio: '5' }))).toBe(50);
    const conMatriz = renglon({
      usaMatriz: true,
      precio: '2',
      matriz: [{ idColor: 1, color: 'Rojo', cantidades: { 11: 5 } }],
    });
    expect(importeRenglon(conMatriz)).toBe(10);
    expect(totalCaptura([renglon({ cantidad: '10', precio: '5' }), conMatriz])).toBe(60);
  });

  it('capturaDesdeOc reconstruye el tipo de material y la matriz por color', () => {
    const oc = ocDePrueba({
      lineas: [
        {
          id: 10,
          idTela: null,
          tela: null,
          nombreComplementoTela: null,
          cantidadComplemento: null,
          precioComplemento: null,
          idAvio: 7,
          avio: 'Botón',
          idAvioProveedor: 9,
          descripcionLibre: null,
          idTelaColor: null,
          telaColor: null,
          pantoneTelaColor: null,
          cantidadSugerida: null,
          avisoDesvio: null,
          cantidad: 8,
          unidad: 'pza',
          precio: 1.5,
          subtotal: 12,
          idOrden: 4,
          folioOrden: 100,
          tallas: [
            { idColor: 1, color: 'Rojo', idTalla: 11, etiquetaTalla: 'CH', cantidad: 5 },
            { idColor: 1, color: 'Rojo', idTalla: 12, etiquetaTalla: 'M', cantidad: 3 },
          ],
        },
      ],
    });
    const [r] = capturaDesdeOc(oc);
    expect(r?.tipo).toBe('avio');
    expect(r?.idAvio).toBe(7);
    expect(r?.idAvioProveedor).toBe(9);
    expect(r?.usaMatriz).toBe(true);
    expect(r?.matriz).toHaveLength(1);
    expect(r?.matriz[0]?.cantidades).toEqual({ 11: 5, 12: 3 });
  });
});
