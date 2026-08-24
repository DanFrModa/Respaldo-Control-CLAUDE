import { describe, expect, it } from 'vitest';

import { ErrorPermiso } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { ErrorValidacion } from '../../comun/errores.js';
import { Prisma } from '../../datos/index.js';

import {
  avisosDeAvioPorMedida,
  avisosDeMaterialSinLiberar,
  contradiccionesDeLasOrdenes,
  motivoDeOmision,
  avisosDeTelaSinColor,
  calcularEstatusMaterial,
  estadoGenerico,
  estatusMaterialesOrden,
  explosionarOrden,
  generarOCDesdeExplosion,
  requeridoAvio,
  resolverFechasDeOc,
  type AvioDeLaExplosion,
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
    // §Post-F9.105: avisos del renglón (aquí, ninguno).
    avisos: [],
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
 * ⭐⭐ **V1-E4d, 3ª vuelta — POR QUÉ UN RENGLÓN NO ENTRA EN LA COMPRA** (`motivoDeOmision`).
 *
 * La escalera vivía como un ternario dentro de `planearCompra`, así que su único guardián posible
 * era una prueba de INTEGRACIÓN —o sea, sólo el CI—. Y ahí se coló el hueco que encontró el
 * reviewer: la mitad de *"seleccionable"* que mira `cantidadPendiente` **no la cubría nadie**, y es
 * la del caso que sale a diario (el material **ya comprado**). Sacada a función pura, las dos
 * mitades se fijan aquí, en unit.
 */
describe('V1-E4d — el motivo de una omisión (función pura)', () => {
  /** Renglón COMPRABLE: tiene proveedor y queda pendiente. */
  function renglon(over: Record<string, unknown> = {}) {
    return {
      idProveedorSugerido: 11,
      cantidadPendiente: 180,
      cantidadAComprar: 180,
      cantidadEnOc: 0,
      esGenerico: false,
      ...over,
    };
  }
  const SIN_SELECCION = { haySeleccion: false, marcado: false };
  const NO_MARCADO = { haySeleccion: true, marcado: false };

  it('lo comprable y marcado (o sin selección) entra: no hay motivo', () => {
    expect(motivoDeOmision(renglon(), SIN_SELECCION)).toBeNull();
    expect(motivoDeOmision(renglon(), { haySeleccion: true, marcado: true })).toBeNull();
  });

  it('lo comprable que NO se marcó dice exactamente eso', () => {
    expect(motivoDeOmision(renglon(), NO_MARCADO)).toBe('no-seleccionado');
  });

  /** 🔴 Mitad 1 de "seleccionable": sin proveedor la casilla viene apagada — no se pudo marcar. */
  it('🔴 SIN PROVEEDOR, con selección hecha, dice «sin-proveedor» (no «no lo marcaste»)', () => {
    expect(motivoDeOmision(renglon({ idProveedorSugerido: null }), NO_MARCADO)).toBe(
      'sin-proveedor',
    );
  });

  /**
   * 🔴 **Mitad 2 de "seleccionable", la que faltaba y es la más frecuente**: un material **ya
   * cubierto por una OC viva** tiene la casilla apagada igual. Sin esta prueba, dejar
   * `seleccionable = idProveedorSugerido !== null` a secas pasaba en verde — incluso en CI.
   */
  it('🔴 YA COMPRADO, con selección hecha, dice «ya-en-oc» (no «no lo marcaste»)', () => {
    const yaComprado = renglon({ cantidadPendiente: 0, cantidadEnOc: 180 });
    expect(motivoDeOmision(yaComprado, NO_MARCADO)).toBe('ya-en-oc');
    // …y sin selección de por medio decía lo mismo: la corrección no cambió este camino.
    expect(motivoDeOmision(yaComprado, SIN_SELECCION)).toBe('ya-en-oc');
  });

  it('lo que falta por debajo del mínimo SIN OC detrás no miente diciendo «ya-en-oc»', () => {
    const migaja = renglon({ cantidadPendiente: 0, cantidadEnOc: 0, cantidadAComprar: 0.003 });
    expect(motivoDeOmision(migaja, NO_MARCADO)).toBe('menor-al-minimo');
  });

  /**
   * ⚠️ `cantidadPendiente` va en 0 con `cantidadAComprar` en 0 **porque una sale de la otra** (el
   * pendiente es lo requerido menos lo que ya está en OC): un renglón que no requiere nada y que a
   * la vez tiene 180 pendientes no existe, y montarlo aquí probaría un estado imposible.
   */
  it('el genérico cubierto por el kardex se distingue del que no requiere nada', () => {
    const sinRequerir = { cantidadAComprar: 0, cantidadPendiente: 0 };
    expect(motivoDeOmision(renglon({ ...sinRequerir, esGenerico: true }), NO_MARCADO)).toBe(
      'cubierto-por-stock',
    );
    expect(motivoDeOmision(renglon({ ...sinRequerir, esGenerico: false }), NO_MARCADO)).toBe(
      'sin-cantidad',
    );
  });

  /**
   * 🔴 **LA INVARIANTE QUE IMPIDE QUE ESTO CAMBIE QUÉ SE COMPRA**: sólo lo SELECCIONABLE puede
   * devolver `null` (= entra en la compra). Si alguien reordenara la escalera y un renglón no
   * seleccionable se volviera elegible, la OC compraría algo que la pantalla ni siquiera dejaba
   * marcar — y esto se pone rojo.
   */
  it('🔴 nada NO seleccionable puede entrar en la compra (ningún `null` por esa puerta)', () => {
    const noSeleccionables = [
      renglon({ idProveedorSugerido: null }),
      renglon({ cantidadPendiente: 0, cantidadEnOc: 180 }),
      renglon({ cantidadPendiente: 0, cantidadEnOc: 0, cantidadAComprar: 0.003 }),
      renglon({ cantidadAComprar: 0, cantidadPendiente: 0, esGenerico: true }),
    ];
    for (const r of noSeleccionables) {
      expect(motivoDeOmision(r, SIN_SELECCION)).not.toBeNull();
      expect(motivoDeOmision(r, NO_MARCADO)).not.toBeNull();
      expect(motivoDeOmision(r, { haySeleccion: true, marcado: true })).not.toBeNull();
    }
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
      tipo: 'avio' as 'tela' | 'avio' | 'arte',
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
   * ⚠️ **ESTO CUBRE UNA DEFENSA, NO UN CASO DE HOY** (corrección de la 2ª vuelta: la primera lo
   * presentó como el escenario real y **era imposible**). Un renglón sin firmar que sí tuviera
   * requerimiento elegible **jamás llega a los avisos**: `exigirMaterialesLiberados` rechaza la
   * compra entera con un 409 antes. Se prueba igual porque la defensa existe y tiene que seguir
   * diciendo la verdad el día que esa puerta se mueva: *"no entra"* de algo que sí entra es la
   * mentira que §Post-F9.85 vino a cerrar.
   */
  it('🔴 defensa: no avisa por lo que —de llegar el caso— esta OC SÍ fuera a escribir', () => {
    expect(avisosDeMaterialSinLiberar([pendiente()], ocQueSiEscribe())).toEqual([]);
  });

  /**
   * ⭐ **EL ARTE NO SE COMPRA POR MRP**, así que nombrarlo aquí sería ruido en una pantalla de
   * materiales. El filtro vive DENTRO de esta función (2ª vuelta): mientras estaba en el sitio de
   * llamada, ninguna prueba unitaria lo sostenía — sólo la de integración, que corre en CI.
   */
  it('⭐ el ARTE sin firmar NO produce aviso (no se compra por MRP)', () => {
    const arte = pendiente({
      tipo: 'arte' as const,
      idTela: null,
      idAvio: null,
      material: 'Bordado del pecho',
    });
    expect(avisosDeMaterialSinLiberar([arte], [])).toEqual([]);
    // …y no es que se calle TODO: la tela de al lado sí sale.
    const conTela = pendiente({
      tipo: 'tela' as const,
      idTela: 4,
      idAvio: null,
      material: 'Felpa',
    });
    expect(avisosDeMaterialSinLiberar([arte, conTela], [])).toHaveLength(1);
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

/**
 * ⭐⭐ §Post-F9.105 — **LA EXPLOSIÓN AVISA.** Daniel: *"la compra de los cierres me está dando una
 * cantidad muchísimo mayor de la que necesito"*. Hasta hoy la explosión no podía decirlo: su
 * `select` ni siquiera traía el conteo de medidas activas del avío, que es el único hecho del que
 * sale "es por medida". Estas pruebas fijan las dos mitades: que lo diga cuando pasa, y que NO lo
 * diga cuando no pasa (un aviso que grita en falso se aprende a ignorar, y entonces deja de servir
 * el día que tiene razón).
 */
describe('MRP unit — aviso de avío POR MEDIDA con cantidades por talla (§Post-F9.105)', () => {
  const D = (n: number): Prisma.Decimal => new Prisma.Decimal(n);
  /** Orden de 30 pzas: CH 10 + M 20. */
  const piezas = new Map([
    [1, { piezas: 10, etiqueta: 'CH' }],
    [2, { piezas: 20, etiqueta: 'M' }],
  ]);
  /** El cierre de 53 cm: 1 pza por prenda, pero la longitud quedó en el campo de cantidad. */
  function cierre(over: Partial<AvioDeLaExplosion> = {}): AvioDeLaExplosion {
    return {
      consumoPorPrenda: D(1),
      consumoPorTalla: true,
      tallas: [
        { idTalla: 1, consumo: D(53) },
        { idTalla: 2, consumo: D(53) },
      ],
      avio: {
        clave: 'CIE-53',
        descripcion: 'Cierre 53 cm',
        unidad: 'pza',
        _count: { medidas: 2 },
      },
      ...over,
    };
  }

  it('⭐ avío por medida + consumo por talla: avisa EN EL RENGLÓN y dice cuánto se pide de más', () => {
    const avisos: string[] = [];
    const { requerido, avisosRenglon } = requeridoAvio(cierre(), 30, piezas, avisos);
    // El requerido NO se corrige aquí (D3: una lectura no cambia datos): 53×30.
    expect(requerido).toBe(1590);
    expect(avisosRenglon).toHaveLength(1);
    expect(avisosRenglon[0]).toContain('POR MEDIDA');
    expect(avisosRenglon[0]).toContain('1,590 pza');
    expect(avisosRenglon[0]).toContain('en vez de 30 pza');
    expect(avisosRenglon[0]).toContain('receta de la orden');
    // 🔴 Y NO se cuela en la caja gris del pie ("notas de precios y proveedores"): ahí se perdería.
    expect(avisos).toEqual([]);
  });

  it('avío por medida SIN la bandera encendida (lo normal desde V1-E3g): NO avisa', () => {
    const { avisosRenglon } = requeridoAvio(
      cierre({ consumoPorTalla: false, tallas: [] }),
      30,
      piezas,
      [],
    );
    expect(avisosRenglon).toEqual([]);
  });

  it('avío que SÍ se consume por talla de verdad (elástico, sin medidas en catálogo): NO avisa', () => {
    // Un elástico con 0.75 m en CH y 0.80 en M es una captura legítima, no una contradicción.
    const { requerido, avisosRenglon } = requeridoAvio(
      {
        consumoPorPrenda: D(0.8),
        consumoPorTalla: true,
        tallas: [
          { idTalla: 1, consumo: D(0.75) },
          { idTalla: 2, consumo: D(0.8) },
        ],
        avio: {
          clave: 'ELA-01',
          descripcion: 'Elástico',
          unidad: 'm',
          _count: { medidas: 0 },
        },
      },
      30,
      piezas,
      [],
    );
    expect(requerido).toBeCloseTo(23.5, 6);
    expect(avisosRenglon).toEqual([]);
  });

  it('el aviso de TALLA SIN MEDIDA sigue yendo al pie (es un apunte de valuación, no una alarma)', () => {
    const avisos: string[] = [];
    const { avisosRenglon } = requeridoAvio(
      cierre({ tallas: [{ idTalla: 1, consumo: D(53) }] }),
      30,
      piezas,
      avisos,
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('sin medida por talla');
    // …y el de la contradicción sigue yendo al renglón: son dos avisos distintos, en dos sitios.
    expect(avisosRenglon).toHaveLength(1);
  });
});

/**
 * ⭐⭐ **§Post-F9.105 — EL AVISO EN LA REVISIÓN PREVIA (funciones puras).**
 *
 * La previa es la pantalla donde se firma la compra: *"una revisión previa es indispensable"*
 * (Daniel). Que ahí saliera un renglón 53 veces inflado **sin una palabra** era el mismo defecto de
 * la etapa, en el momento en que más caro cuesta — el renglón de la explosión sí lo avisa, pero
 * quien pulsa «Revisar y generar OC» de corrido nunca pasa por esa línea.
 */
describe('§Post-F9.105 — la contradicción en la REVISIÓN PREVIA (funciones puras)', () => {
  const D = (n: number): Prisma.Decimal => new Prisma.Decimal(n);

  /** Un renglón de receta contradictorio: cierre por medida con la longitud como cantidad. */
  function renglonCierre(over: Record<string, unknown> = {}) {
    return {
      idOrden: 50,
      idAvio: 3,
      consumoPorPrenda: D(1),
      consumoPorTalla: true,
      tallas: [
        { idTalla: 1, consumo: D(53) },
        { idTalla: 2, consumo: D(53) },
      ],
      avio: { clave: 'CIE-53', descripcion: 'Cierre 53 cm', unidad: 'pza' },
      ...over,
    };
  }

  /** La matriz de la OP 50: CH 10 + M 20 = 30 piezas. */
  const ordenes = [
    {
      id: 50,
      lineas: [
        {
          tallas: [
            { idTalla: 1, cantidad: 10 },
            { idTalla: 2, cantidad: 20 },
          ],
        },
      ],
    },
  ];
  const folioDe = new Map([[50, 5559]]);

  /** Un renglón del PLAN (avío), con lo mínimo que la función mira. */
  function renglonPlan(over: Record<string, unknown> = {}) {
    return {
      tipo: 'avio' as const,
      idMaterial: 3,
      idTelaColor: null,
      telaColor: null,
      cantidadEnOcSinColor: 0,
      material: 'CIE-53 — Cierre 53 cm',
      unidad: 'pza',
      cantidadTotal: 1590,
      cantidadPropuesta: 1590,
      ajustado: false,
      precioUnitario: 6,
      precioPropuesto: 6,
      precioAjustado: false,
      importe: 9540,
      porOrden: [
        {
          idRequerimiento: 2,
          idOrden: 50,
          folioOrden: 5559,
          cantidad: 1590,
          cantidadPropuesta: 1590,
          precio: 6,
          importe: 9540,
          seEscribe: true,
        },
      ],
      ...over,
    };
  }

  const plan = (renglones: ReturnType<typeof renglonPlan>[]) => [
    {
      idProveedor: 11,
      proveedor: 'Cierres del Norte',
      fechaEntrega: '2026-09-01',
      renglones,
      total: 9540,
      ordenes: [5559],
    },
  ];

  it('mide la contradicción con las piezas de la MATRIZ de la OP y la redacta una sola vez', () => {
    const halladas = contradiccionesDeLasOrdenes([renglonCierre()], ordenes, folioDe);
    expect(halladas).toHaveLength(1);
    expect(halladas[0]?.folioOrden).toBe(5559);
    // 53 × 30 piezas contra 1 × 30: el mismo cálculo (y el mismo texto) que el del renglón.
    expect(halladas[0]?.aviso).toContain('1,590 pza');
    expect(halladas[0]?.aviso).toContain('en vez de 30 pza');
  });

  it('🔴 SUMA las tallas de TODAS las líneas de la OP (una por color), no la última', () => {
    // 🔴 Una OP real trae una línea POR COLOR y la MISMA talla en varias. Con la matriz partida en
    // dos colores (10+20 en rojo, 5+5 en azul) son 40 piezas: si el conteo pisara en vez de sumar,
    // la magnitud saldría de 30 y el aviso mentiría en el caso MÁS común que hay.
    const dosColores = [
      {
        id: 50,
        lineas: [
          {
            tallas: [
              { idTalla: 1, cantidad: 10 },
              { idTalla: 2, cantidad: 20 },
            ],
          },
          {
            tallas: [
              { idTalla: 1, cantidad: 5 },
              { idTalla: 2, cantidad: 5 },
            ],
          },
        ],
      },
    ];
    const halladas = contradiccionesDeLasOrdenes([renglonCierre()], dosColores, folioDe);
    expect(halladas[0]?.aviso).toContain('2,120 pza'); // 53 × 40
    expect(halladas[0]?.aviso).toContain('en vez de 40 pza'); // 1 × 40
  });

  it('se abstiene si el renglón NO trae la bandera (no hay contradicción que medir)', () => {
    expect(
      contradiccionesDeLasOrdenes([renglonCierre({ consumoPorTalla: false })], ordenes, folioDe),
    ).toEqual([]);
  });

  it('⭐ avisa en la previa, nombrando el material y la OP, por lo que SÍ se va a escribir', () => {
    const avisos = avisosDeAvioPorMedida(
      contradiccionesDeLasOrdenes([renglonCierre()], ordenes, folioDe),
      plan([renglonPlan()]),
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('CIE-53 — Cierre 53 cm');
    expect(avisos[0]).toContain('orden 5559');
    expect(avisos[0]).toContain('POR MEDIDA');
    expect(avisos[0]).toContain('1,590 pza');
  });

  it('🔴 NO avisa por un avío que esta OC no compra: no es dinero que se vaya a gastar hoy', () => {
    const sinEscribir = renglonPlan({
      porOrden: [
        {
          idRequerimiento: 2,
          idOrden: 50,
          folioOrden: 5559,
          cantidad: 0,
          cantidadPropuesta: 1590,
          precio: 6,
          importe: 0,
          seEscribe: false,
        },
      ],
    });
    expect(
      avisosDeAvioPorMedida(
        contradiccionesDeLasOrdenes([renglonCierre()], ordenes, folioDe),
        plan([sinEscribir]),
      ),
    ).toEqual([]);
  });

  it('🔴 una TELA con el mismo id de material no dispara el aviso del avío', () => {
    // La clave del plan es (orden, idMaterial), y tela y avío numeran aparte: sin mirar el `tipo`,
    // la tela #3 haría hablar del cierre #3 — un aviso sobre un material que nadie está comprando.
    const tela = renglonPlan({ tipo: 'tela' as const, material: 'Felpa' });
    expect(
      avisosDeAvioPorMedida(
        contradiccionesDeLasOrdenes([renglonCierre()], ordenes, folioDe),
        plan([tela]),
      ),
    ).toEqual([]);
  });

  it('🔴 y NO avisa por la OP equivocada: la contradicción viaja con su orden', () => {
    const otraOp = renglonPlan({
      porOrden: [
        {
          idRequerimiento: 9,
          idOrden: 51,
          folioOrden: 5561,
          cantidad: 1590,
          cantidadPropuesta: 1590,
          precio: 6,
          importe: 9540,
          seEscribe: true,
        },
      ],
    });
    expect(
      avisosDeAvioPorMedida(
        contradiccionesDeLasOrdenes([renglonCierre()], ordenes, folioDe),
        plan([otraOp]),
      ),
    ).toEqual([]);
  });
});
