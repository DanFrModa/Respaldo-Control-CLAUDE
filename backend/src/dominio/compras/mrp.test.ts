import { describe, expect, it } from 'vitest';

import { ErrorPermiso } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { ErrorValidacion } from '../../comun/errores.js';
import {
  avisosDeMaterialSinLiberar,
  avisosDeTelaSinColor,
  calcularEstatusMaterial,
  estadoGenerico,
  estatusMaterialesOrden,
  explosionarOrden,
  generarOCDesdeExplosion,
  resolverFechasDeOc,
} from './mrp.js';

/**
 * Unit del dominio del MRP / EXPLOSIÓN (F4-E4) — SIN Postgres. Cubre lo que NO necesita la base:
 *  • el guard de permisos (deny-by-default, A4): explosionar/estatus exigen `compras.ver`,
 *    generar OC exige `compras.administrar`;
 *  • las funciones PURAS del semáforo (R7) y del estado de genéricos (decisión d).
 *
 * El cálculo real de la explosión (BOM × matriz), el neteo contra el kardex, la persistencia del
 * snapshot/diff, la generación de OC por proveedor y el cruce requerido/en-oc/recibido contra
 * Postgres van en `mrp.int.test.ts` (CI).
 */

const sesionVer = () => sesionDePrueba({ permisos: ['compras.ver'] });
const sesionSinNada = () => sesionDePrueba({ permisos: [] });
const sesionAdmin = () => sesionDePrueba({ permisos: ['compras.administrar'] });

describe('MRP unit — permisos (A4, deny-by-default)', () => {
  it('explosionarOrden sin compras.ver lanza ErrorPermiso (antes de la BD)', async () => {
    await expect(explosionarOrden(sesionSinNada(), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('estatusMaterialesOrden sin compras.ver lanza ErrorPermiso', async () => {
    await expect(estatusMaterialesOrden(sesionSinNada(), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('generarOCDesdeExplosion sin compras.administrar lanza ErrorPermiso', async () => {
    // `compras.ver` no alcanza para mutar (generar OC).
    await expect(
      generarOCDesdeExplosion(sesionVer(), { idsOrden: [1], idsRequerimiento: [] }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('generarOCDesdeExplosion con compras.administrar pasa el guard (falla luego por BD/orden)', async () => {
    // No debe ser ErrorPermiso: el guard pasó; cualquier otro error viene de la BD inexistente.
    await expect(
      generarOCDesdeExplosion(sesionAdmin(), { idsOrden: [999999], idsRequerimiento: [] }),
    ).rejects.not.toBeInstanceOf(ErrorPermiso);
  });
});

describe('MRP unit — semáforo de estatus de material (R7, función pura)', () => {
  it('sin OC ni recibido → pendiente', () => {
    expect(calcularEstatusMaterial(100, 0, 0, false)).toBe('pendiente');
  });

  it('en OC pero nada recibido → en-oc', () => {
    expect(calcularEstatusMaterial(100, 100, 0, false)).toBe('en-oc');
  });

  it('algo recibido pero no todo → recibido-parcial', () => {
    expect(calcularEstatusMaterial(100, 100, 40, false)).toBe('recibido-parcial');
  });

  it('recibido ≥ a comprar → completo', () => {
    expect(calcularEstatusMaterial(100, 100, 100, false)).toBe('completo');
    expect(calcularEstatusMaterial(100, 100, 120, false)).toBe('completo');
  });

  it('genérico cubierto por stock (a comprar 0) → cubierto-por-stock, gana a todo lo demás', () => {
    expect(calcularEstatusMaterial(0, 0, 0, true)).toBe('cubierto-por-stock');
  });

  it('a comprar 0 sin ser genérico cubierto → no es "completo" (evita falso completo)', () => {
    // aComprar = 0 y no es genérico cubierto: no hay nada que comprar ni recibir → pendiente.
    expect(calcularEstatusMaterial(0, 0, 0, false)).toBe('pendiente');
  });

  it('respeta la tolerancia de redondeo en "completo"', () => {
    expect(calcularEstatusMaterial(100, 100, 100 - 1e-9, false)).toBe('completo');
  });

  it('§Post-F9.19: aplica la banda del 5% en tela Y en avío', () => {
    // Sin la banda, el tablero diría "recibido parcial" para siempre, aunque la OC ya se haya dado
    // por recibida: *"nunca se recibe la cantidad exacta"* y *"en avíos también puede haber una
    // diferencia"*.
    expect(calcularEstatusMaterial(400, 400, 380, false, 'tela')).toBe('completo');
    expect(calcularEstatusMaterial(400, 400, 379, false, 'tela')).toBe('recibido-parcial');
    expect(calcularEstatusMaterial(180, 180, 171, false, 'avio')).toBe('completo');
    expect(calcularEstatusMaterial(180, 180, 170, false, 'avio')).toBe('recibido-parcial');
  });
});

describe('MRP unit — estado de genérico tras netear (decisión d, función pura)', () => {
  const base = {
    tipo: 'avio' as const,
    idTela: null,
    idAvio: 1,
    material: 'BOT-01',
    cantidadRequerida: 100,
    unidad: 'pza',
    existenciaStock: 0,
    idProveedorSugerido: null,
    proveedorSugerido: null,
    precioSugerido: null,
    origenProveedor: 'sin-proveedor' as const,
    proveedorSugeridoInactivo: false,
    // V1-E3u: los avíos no llevan color (ver la nota del dominio).
    idTelaColor: null,
    telaColor: null,
  };

  it('no genérico → no-aplica (va completo a compra)', () => {
    expect(estadoGenerico({ ...base, esGenerico: false, cantidadAComprar: 100 })).toBe('no-aplica');
  });

  it('genérico con stock que cubre todo (a comprar 0) → cubierto-por-stock', () => {
    expect(
      estadoGenerico({ ...base, esGenerico: true, existenciaStock: 120, cantidadAComprar: 0 }),
    ).toBe('cubierto-por-stock');
  });

  it('genérico con stock parcial (faltante > 0) → faltante-parcial', () => {
    expect(
      estadoGenerico({ ...base, esGenerico: true, existenciaStock: 30, cantidadAComprar: 70 }),
    ).toBe('faltante-parcial');
  });
});

/**
 * ⭐ §Post-F9.71 (V1-E3i) — LA FECHA DE CADA OC. Daniel: *"cada OC interna va a tener una fecha de
 * entrega diferente"*. La regla es pura (no toca BD) para poder probarla aquí; el efecto real sobre
 * las OC creadas va en `mrp.int.test.ts`.
 */
describe('MRP unit — fecha de entrega POR PROVEEDOR (§Post-F9.71)', () => {
  it('cada proveedor recibe la SUYA cuando la manda la pantalla', () => {
    const { fechas, sinFecha } = resolverFechasDeOc([1, 2], '2026-11-30', [
      { idProveedor: 1, fechaEntrega: '2026-10-05' },
      { idProveedor: 2, fechaEntrega: '2026-12-20' },
    ]);
    expect(fechas.get(1)).toBe('2026-10-05');
    expect(fechas.get(2)).toBe('2026-12-20');
    expect(sinFecha).toEqual([]);
  });

  it('el que no trae la suya cae a la de arriba (valor inicial, no imposición)', () => {
    const { fechas } = resolverFechasDeOc([1, 2], '2026-11-30', [
      { idProveedor: 1, fechaEntrega: '2026-10-05' },
    ]);
    expect(fechas.get(1)).toBe('2026-10-05');
    expect(fechas.get(2)).toBe('2026-11-30');
  });

  it('sin fecha de arriba, basta con que cada uno traiga la suya', () => {
    const { fechas, sinFecha } = resolverFechasDeOc([1, 2], null, [
      { idProveedor: 1, fechaEntrega: '2026-10-05' },
      { idProveedor: 2, fechaEntrega: '2026-12-20' },
    ]);
    expect(sinFecha).toEqual([]);
    expect(fechas.size).toBe(2);
  });

  it('el que se queda sin ninguna sale nombrado en `sinFecha` (para decirlo con su nombre)', () => {
    const { fechas, sinFecha } = resolverFechasDeOc([1, 2], null, [
      { idProveedor: 1, fechaEntrega: '2026-10-05' },
    ]);
    expect(sinFecha).toEqual([2]);
    expect(fechas.has(2)).toBe(false);
  });

  it('la fecha de un proveedor que NO está comprando se ignora (no revienta una compra parcial)', () => {
    const { fechas, sinFecha } = resolverFechasDeOc([1], '2026-11-30', [
      { idProveedor: 99, fechaEntrega: '2026-10-05' },
    ]);
    expect(fechas.get(1)).toBe('2026-11-30');
    expect(fechas.has(99)).toBe(false);
    expect(sinFecha).toEqual([]);
  });

  it('dos fechas DISTINTAS para el mismo proveedor se rechazan (D3, no se elige en silencio)', () => {
    expect(() =>
      resolverFechasDeOc([1], '2026-11-30', [
        { idProveedor: 1, fechaEntrega: '2026-10-05' },
        { idProveedor: 1, fechaEntrega: '2026-10-06' },
      ]),
    ).toThrow(ErrorValidacion);
  });

  it('la MISMA fecha repetida no estorba (no es una contradicción)', () => {
    const { fechas } = resolverFechasDeOc([1], null, [
      { idProveedor: 1, fechaEntrega: '2026-10-05' },
      { idProveedor: 1, fechaEntrega: '2026-10-05' },
    ]);
    expect(fechas.get(1)).toBe('2026-10-05');
  });

  it('sin fechas por proveedor, todos caen a la de arriba (comportamiento previo intacto)', () => {
    const { fechas, sinFecha } = resolverFechasDeOc([1, 2], '2026-11-30', undefined);
    expect([...fechas.values()]).toEqual(['2026-11-30', '2026-11-30']);
    expect(sinFecha).toEqual([]);
  });
});

/**
 * ⭐⭐ **V1-E4d (§Post-F9.96) — LO QUE NO ENTRA POR NO ESTAR LIBERADO, DICHO EN EL PASO DE AVANZAR.**
 *
 * Hermano del aviso del color: la explosión ofrece el lugar (la lista de lo que falta firmar, con
 * su botón para ir a liberarlo) y **esto es la consecuencia**, en el momento de comprometer dinero.
 * Función pura sobre el plan ya armado: se prueba sin base.
 */
describe('V1-E4d — avisos de material sin liberar en la revisión previa (función pura)', () => {
  /** Un renglón de receta que Desarrollo todavía no firma. */
  function pendiente(over: Record<string, unknown> = {}) {
    return {
      tipo: 'avio' as const,
      idRenglon: 9,
      idOrden: 50,
      folioOrden: 7,
      idTela: null,
      idAvio: 21,
      material: 'CIE-53 — Cierre 53 cm',
      consumoPorPrenda: 1,
      unidad: 'pza',
      ...over,
    };
  }

  /** Una OC del plan que SÍ escribe el material 21 de la orden 50 (para el descuento). */
  function ocQueSiEscribe(seEscribe = true, tipo: 'tela' | 'avio' = 'avio') {
    return [
      {
        idProveedor: 11,
        proveedor: 'Avíos Baratos',
        fechaEntrega: '2026-09-01',
        renglones: [
          {
            tipo,
            idMaterial: 21,
            idTelaColor: null,
            telaColor: null,
            cantidadEnOcSinColor: 0,
            material: 'CIE-53 — Cierre 53 cm',
            unidad: 'pza',
            cantidadTotal: 30,
            cantidadPropuesta: 30,
            ajustado: false,
            precioUnitario: 3,
            precioPropuesto: 3,
            precioAjustado: false,
            importe: 90,
            porOrden: [
              {
                idRequerimiento: 8,
                idOrden: 50,
                folioOrden: 7,
                cantidad: 30,
                cantidadPropuesta: 30,
                precio: 3,
                importe: 90,
                seEscribe,
              },
            ],
          },
        ],
        total: 90,
        ordenes: [7],
      },
    ];
  }

  it('avisa por lo que falta firmar, con su material, su orden y su consumo', () => {
    const avisos = avisosDeMaterialSinLiberar([pendiente()], []);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('CIE-53 — Cierre 53 cm');
    expect(avisos[0]).toContain('NO entra en esta compra');
    expect(avisos[0]).toContain('orden 7');
    expect(avisos[0]).toContain('1 pza por prenda');
  });

  it('sin nada pendiente no dice nada (el aviso es la excepción, no el saludo)', () => {
    expect(avisosDeMaterialSinLiberar([], ocQueSiEscribe())).toEqual([]);
  });

  /**
   * 🔴 **EL CASO QUE OBLIGA A MIRAR EL PLAN Y NO SÓLO LA RECETA.** La explosión se calculó con el
   * renglón liberado y la liberación se revocó DESPUÉS: su requerimiento sigue en el snapshot, así
   * que esta OC **sí lo va a escribir**. Decir "no entra" sería mentirle a quien está firmando —
   * exactamente lo que §Post-F9.85 vino a cerrar.
   */
  it('🔴 NO avisa por lo que, pese a estar sin firmar, esta OC SÍ va a escribir', () => {
    expect(avisosDeMaterialSinLiberar([pendiente()], ocQueSiEscribe())).toEqual([]);
  });

  /** Y si esa línea NO se escribe (no llega al mínimo guardable), el material sí se queda fuera. */
  it('una línea que no se escribe no descuenta el aviso', () => {
    const avisos = avisosDeMaterialSinLiberar([pendiente()], ocQueSiEscribe(false));
    expect(avisos).toHaveLength(1);
  });

  /** El descuento es POR ORDEN: comprarlo para la 7 no dice nada de lo que falta firmar en la 8. */
  it('🔴 el descuento no cruza órdenes: otra OP con el mismo material sigue avisando', () => {
    const avisos = avisosDeMaterialSinLiberar(
      [pendiente({ idOrden: 88, folioOrden: 5560 })],
      ocQueSiEscribe(),
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('orden 5560');
  });

  /**
   * 🔴 **EL TIPO ENTRA EN LA CLAVE**: la tela 21 y el avío 21 son materiales distintos. Las dos
   * mitades se prueban aparte porque una sola las confunde: si la función mirara siempre `idAvio`
   * (o siempre `idTela`), una de las dos pasaría igual.
   */
  it('la tela sin liberar NO se descuenta con el avío del mismo número', () => {
    const tela = pendiente({ tipo: 'tela' as const, idTela: 21, idAvio: null, material: 'Felpa' });
    // El plan escribe el AVÍO 21 de la misma orden: la tela 21 es otro material y sigue faltando.
    const avisos = avisosDeMaterialSinLiberar([tela], ocQueSiEscribe());
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('Felpa');
  });

  it('…y una TELA que la OC sí va a escribir tampoco avisa (se lee por `idTela`)', () => {
    const tela = pendiente({ tipo: 'tela' as const, idTela: 21, idAvio: null, material: 'Felpa' });
    expect(avisosDeMaterialSinLiberar([tela], ocQueSiEscribe(true, 'tela'))).toEqual([]);
  });
});

/**
 * ⭐⭐ **V1-E4c — EL AVISO DEL COLOR, EN EL PASO DE AVANZAR** (Daniel, 23-ago-2026: *"primero que
 * dé la opción de meterlo, y si no se hace, entonces que mande los mensajes en amarillo"*).
 *
 * Se calcula sobre el PLAN ya armado —no sobre la explosión— porque sólo debe avisar por lo que **de
 * verdad se va a escribir**. Función pura: se prueba sin base.
 */
describe('V1-E4c — avisos de tela sin color en la revisión previa (función pura)', () => {
  /** Un renglón del plan con lo mínimo que la función mira. */
  function renglon(over: Record<string, unknown> = {}) {
    return {
      tipo: 'tela' as const,
      idMaterial: 4,
      idTelaColor: null,
      telaColor: null,
      cantidadEnOcSinColor: 0,
      material: 'Felpa',
      unidad: 'm',
      cantidadTotal: 45,
      cantidadPropuesta: 45,
      ajustado: false,
      precioUnitario: 50,
      precioPropuesto: 50,
      precioAjustado: false,
      importe: 2250,
      porOrden: [
        {
          idRequerimiento: 2,
          idOrden: 50,
          folioOrden: 7,
          cantidad: 45,
          cantidadPropuesta: 45,
          precio: 50,
          importe: 2250,
          seEscribe: true,
        },
      ],
      ...over,
    };
  }

  /** Una OC del plan con los renglones dados. */
  function oc(renglones: ReturnType<typeof renglon>[]) {
    return [
      {
        idProveedor: 11,
        proveedor: 'Alsatex',
        fechaEntrega: '2026-09-01',
        renglones,
        total: 2250,
        ordenes: [7],
      },
    ];
  }

  it('avisa por la tela que se va a pedir SIN color, nombrando proveedor, cantidad y orden', () => {
    const avisos = avisosDeTelaSinColor(oc([renglon()]));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('Felpa');
    expect(avisos[0]).toContain('Alsatex');
    expect(avisos[0]).toContain('45');
    expect(avisos[0]).toContain('orden 7');
  });

  it('🔴 NO avisa por lo que sí tiene color dicho (el aviso es la excepción, no el saludo)', () => {
    expect(
      avisosDeTelaSinColor(oc([renglon({ idTelaColor: 77, telaColor: 'Grana 7700' })])),
    ).toEqual([]);
  });

  it('🔴 NO avisa por un renglón que no genera ninguna línea: eso no es un dato que falte', () => {
    const sinEscribir = renglon({
      porOrden: [
        {
          idRequerimiento: 2,
          idOrden: 50,
          folioOrden: 7,
          cantidad: 0,
          cantidadPropuesta: 45,
          precio: 50,
          importe: 0,
          // Su cantidad no llega al mínimo guardable: la generación la salta.
          seEscribe: false,
        },
      ],
    });
    expect(avisosDeTelaSinColor(oc([sinEscribir]))).toEqual([]);
  });

  it('los AVÍOS no avisan: en el modelo de datos no llevan color (hueco distinto, V1-E3u)', () => {
    expect(avisosDeTelaSinColor(oc([renglon({ tipo: 'avio' as const })]))).toEqual([]);
  });

  it('con varias OP nombra todas las órdenes del renglón, ordenadas y sin repetir', () => {
    const dosOp = renglon({
      porOrden: [
        {
          idRequerimiento: 9,
          idOrden: 92,
          folioOrden: 5560,
          cantidad: 20,
          cantidadPropuesta: 20,
          precio: 50,
          importe: 1000,
          seEscribe: true,
        },
        {
          idRequerimiento: 2,
          idOrden: 50,
          folioOrden: 7,
          cantidad: 45,
          cantidadPropuesta: 45,
          precio: 50,
          importe: 2250,
          seEscribe: true,
        },
      ],
    });
    const avisos = avisosDeTelaSinColor(oc([dosOp]));
    expect(avisos[0]).toContain('órdenes 7, 5560');
    // Y la cantidad es la SUMA de lo que sí se escribe.
    expect(avisos[0]).toContain('65');
  });
});
