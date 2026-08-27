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
          idColorPrenda: null,
          colorPrenda: null,
          colorAvio: null,
          medidas: [],
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

/**
 * ⭐⭐ V1-E3u (§Post-F9.89) — **EL COLOR Y LA PROPUESTA SOBREVIVEN A UNA EDICIÓN.**
 *
 * 🔴 Por qué esto es una prueba y no un detalle: editar una OC **borra y recrea** sus líneas en el
 * servidor. Si el editor no devolviera `idTelaColor`, corregir el precio de un renglón dejaría la OC
 * **sin color** — sin nada que cruzar al recibir y sin nada que decirle al proveedor en el impreso—
 * y sin `cantidadSugerida`, quien autoriza perdería el aviso de desvío. Los dos se pierden **en
 * silencio**, que es lo peor que puede pasarle a un dato.
 */
describe('captura de OC — V1-E3u: el color y la propuesta viajan de ida y vuelta', () => {
  it('capturaDesdeOc los recoge y renglonApi los devuelve intactos', () => {
    const oc = ocDePrueba({
      lineas: [
        {
          id: 1,
          idTela: 3,
          tela: 'Felpa 280',
          nombreComplementoTela: null,
          cantidadComplemento: null,
          precioComplemento: null,
          idAvio: null,
          avio: null,
          idAvioProveedor: null,
          idTelaColor: 77,
          telaColor: 'Grana 7700',
          idColorPrenda: null,
          colorPrenda: null,
          colorAvio: null,
          medidas: [],
          pantoneTelaColor: '19-1664 TCX',
          descripcionLibre: null,
          cantidad: 45,
          cantidadSugerida: 45,
          avisoDesvio: null,
          unidad: 'm',
          precio: 80,
          subtotal: 3600,
          idOrden: 4,
          folioOrden: 100,
          tallas: [],
        },
      ],
    });

    const [renglonCapturado] = capturaDesdeOc(oc);
    expect(renglonCapturado?.idTelaColor).toBe(77);
    expect(renglonCapturado?.telaColor).toBe('Grana 7700');
    expect(renglonCapturado?.cantidadSugerida).toBe(45);

    // Se corrige SÓLO el precio (lo que de verdad hace el usuario en el diálogo de edición)…
    const editado = { ...(renglonCapturado as RenglonOcCaptura), precio: '95' };
    const cuerpo = renglonApi(editado);
    // …y el color y la propuesta siguen ahí. 🔴 El valor que lo pondría ROJO es `null` en cualquiera
    // de los dos: sería exactamente la pérdida silenciosa que esta prueba existe para impedir.
    expect(cuerpo.idTelaColor).toBe(77);
    expect(cuerpo.cantidadSugerida).toBe(45);
    expect(cuerpo.precio).toBe(95);
  });

  it('un renglón de AVÍO nunca manda color (el color es de la tela)', () => {
    const cuerpo = renglonApi(renglon({ tipo: 'avio', idAvio: 5, idTelaColor: 77 }));
    expect(cuerpo.idTelaColor).toBeNull();
  });
});

/**
 * ⭐⭐ **V1-E8c (§Post-F9.126) — EL COLOR DEL AVÍO Y SU DESGLOSE POR MEDIDA TAMBIÉN VIAJAN.**
 *
 * 🔴 Mismo argumento que el color de la tela, y por eso mismo la prueba: editar una OC borra y
 * recrea sus líneas. Si el editor no los devolviera, corregir un precio dejaría al proveedor sin
 * saber de qué color son los cierres ni cómo cortarlos — **en silencio**.
 */
describe('captura de OC — V1-E8c: el color del avío y las medidas viajan de ida y vuelta', () => {
  /** Una línea de OC de avío con color y desglose, tal como la sirve el servidor. */
  function lineaCierre(over: Record<string, unknown> = {}) {
    return {
      id: 1,
      idTela: null,
      tela: null,
      nombreComplementoTela: null,
      cantidadComplemento: null,
      precioComplemento: null,
      idAvio: 7,
      avio: 'CIE-53 — Cierre',
      idAvioProveedor: null,
      idTelaColor: null,
      telaColor: null,
      idColorPrenda: 9,
      colorPrenda: 'Rojo',
      colorAvio: 'Rojo',
      medidas: [
        { idAvioMedida: 100, etiqueta: '53 cm', cantidad: 10, orden: 1 },
        { idAvioMedida: 200, etiqueta: '60 cm', cantidad: 20, orden: 2 },
      ],
      pantoneTelaColor: null,
      descripcionLibre: null,
      cantidad: 30,
      cantidadSugerida: 30,
      avisoDesvio: null,
      unidad: 'pza',
      precio: 6,
      subtotal: 180,
      idOrden: 4,
      folioOrden: 100,
      tallas: [],
      ...over,
    };
  }

  it('⭐ corregir el PRECIO no borra el color ni el desglose', () => {
    const [capturado] = capturaDesdeOc(ocDePrueba({ lineas: [lineaCierre()] }));
    expect(capturado?.idColorPrenda).toBe(9);
    expect(capturado?.colorAvio).toBe('Rojo');
    expect(capturado?.medidas).toHaveLength(2);

    const cuerpo = renglonApi({ ...(capturado as RenglonOcCaptura), precio: '7' });
    // 🔴 El valor que lo pone rojo: `null` / `undefined` en cualquiera de los tres.
    expect(cuerpo.idColorPrenda).toBe(9);
    expect(cuerpo.colorAvio).toBe('Rojo');
    expect(cuerpo.medidas).toHaveLength(2);
    expect(cuerpo.precio).toBe(7);
  });

  it('🔴 si la CANTIDAD se edita a mano, el desglose se SUELTA (mentiría sobre la cantidad)', () => {
    const [capturado] = capturaDesdeOc(ocDePrueba({ lineas: [lineaCierre()] }));
    const cuerpo = renglonApi({ ...(capturado as RenglonOcCaptura), cantidad: '50' });
    // El servidor rechazaría la OC entera con un desglose que suma 30 contra una cantidad de 50.
    // Se prefiere perder la tablita —que es informativa y se recupera al re-explotar— antes que
    // mandar un desglose que MIENTE. 🔴 Rojo si alguien "arregla" esto mandándolo siempre.
    expect(cuerpo.medidas).toBeUndefined();
    // El color NO se suelta: no depende de la cantidad.
    expect(cuerpo.colorAvio).toBe('Rojo');
  });

  it('un renglón de TELA nunca manda color de prenda ni desglose', () => {
    const cuerpo = renglonApi(
      renglon({
        tipo: 'tela',
        idTela: 3,
        idColorPrenda: 9,
        colorAvio: 'Rojo',
        medidas: [{ idAvioMedida: 100, etiqueta: '53 cm', cantidad: 5, orden: 1 }],
        cantidad: '5',
      }),
    );
    expect(cuerpo.idColorPrenda).toBeNull();
    expect(cuerpo.colorAvio).toBeNull();
    expect(cuerpo.medidas).toBeUndefined();
  });
});
