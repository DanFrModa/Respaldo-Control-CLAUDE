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
  prefijarConLaOrden,
  avisosDeTelaSinColor,
  calcularEstatusMaterial,
  claveAgrupada,
  estadoGenerico,
  estatusMaterialesOrden,
  explosionarOrden,
  generarOCDesdeExplosion,
  previoCompraDesdeExplosion,
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
    // V1-E3u: el color de TELA no aplica a un avío.
    idTelaColor: null,
    telaColor: null,
    // ⭐⭐ V1-E8c: el avío SÍ lleva color desde §Post-F9.126 — el de la prenda. Aquí, ninguno.
    idColorPrenda: null,
    colorPrenda: null,
    desglose: [],
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
 *
 * 🔴 **V1-E7f (§Post-F9.120): la cascada tiene DOS peldaños, no tres.** Había un tercero —la fecha
 * de entrega de las OP— y se retiró: es la fecha del CLIENTE, no la del proveedor. Aquí eso se ve
 * en negativo (la función ya ni siquiera recibe las OP); **lo que fija la regla es la prueba de
 * `generarOCDesdeExplosion` de más abajo**, que entra por la puerta de verdad — el respaldo vivía
 * en QUIEN LLAMABA, así que sólo ahí se puede matar.
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
      // ⭐⭐ V1-E8e (§Post-F9.99): el default de la marca — nadie dio nada por cubierto.
      cantidadCubierta: 0,
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
   * 🔴 **V1-E8m — EL ORDEN ENTRE «SIN PROVEEDOR» Y EL PELDAÑO DE LO QUE YA NO SE PIDE**, que hasta
   * hoy no fijaba nadie (cabo declarado por el reviewer del #209: *no bloqueante, pero no menor*).
   *
   * `sin-proveedor` se pregunta **DESPUÉS** de lo que ya está en una OC viva / se dio por cubierto /
   * es una migaja, y **el estado que los distingue existe en producción**: un material cubierto por
   * una OC viva **al que después le QUITARON el proveedor** — la pantalla lo permite
   * (`guardarProveedor(…, null)`). Con la escalera al revés, la previa le diría al comprador *"No
   * hay a quién comprarle"* sobre algo **YA COMPRADO**, mandándolo a buscar proveedor para una
   * compra que ya hizo. Es §Post-F9.85 otra vez: **no basta con no callarse; hay que no mentir.**
   *
   * Ninguna de las pruebas de arriba lo veía: todas dejan el proveedor puesto (`11`), así que subir
   * `sin-proveedor` un peldaño pasaba en verde — incluso la invariante de "nada no seleccionable
   * entra", porque el motivo cambiado sigue sin ser `null`.
   */
  it('🔴 sin proveedor PERO ya comprado dice «ya-en-oc»: el hecho de la compra manda sobre la falta de proveedor (si se invierte el orden, la previa miente sobre algo YA COMPRADO)', () => {
    const yaCompradoSinProveedor = renglon({
      idProveedorSugerido: null,
      cantidadPendiente: 0,
      cantidadEnOc: 180,
    });
    expect(motivoDeOmision(yaCompradoSinProveedor, NO_MARCADO)).toBe('ya-en-oc');
    // …y sin selección de por medio, igual: el orden no depende de la marca.
    expect(motivoDeOmision(yaCompradoSinProveedor, SIN_SELECCION)).toBe('ya-en-oc');

    // La segunda rama del mismo peldaño: la migaja sin OC detrás sigue siendo «menor-al-minimo».
    // Pedirle proveedor a alguien para comprar 0.003 es mandarlo a trabajar en balde.
    const migajaSinProveedor = renglon({
      idProveedorSugerido: null,
      cantidadPendiente: 0,
      cantidadEnOc: 0,
      cantidadAComprar: 0.003,
    });
    expect(motivoDeOmision(migajaSinProveedor, NO_MARCADO)).toBe('menor-al-minimo');

    // Y la tercera —la marca de una PERSONA (§Post-F9.99)—, que tampoco la borra la falta de
    // proveedor: quien lo dio por cubierto necesita leer eso, no "no hay a quién comprarle".
    const dadoPorCubiertoSinProveedor = renglon({
      idProveedorSugerido: null,
      cantidadPendiente: 0,
      cantidadCubierta: 180,
    });
    expect(motivoDeOmision(dadoPorCubiertoSinProveedor, NO_MARCADO)).toBe('dado-por-cubierto');
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
            idColorPrenda: null,
            colorPrenda: null,
            colorTexto: null,
            colorAjustado: false,
            medidas: [],
            cantidadEnOcSinColor: 0,
            material: 'CIE-53 — Cierre 53 cm',
            unidad: 'pza',
            cantidadTotal: 30,
            cantidadPropuesta: 30,
            ajustado: false,
            cantidadFaltante: 0,
            restoCubierto: false,
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
                medidas: [],
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
      idColorPrenda: null,
      colorPrenda: null,
      colorTexto: null,
      colorAjustado: false,
      medidas: [],
      cantidadEnOcSinColor: 0,
      material: 'Felpa',
      unidad: 'm',
      cantidadTotal: 45,
      cantidadPropuesta: 45,
      ajustado: false,
      cantidadFaltante: 0,
      restoCubierto: false,
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
          medidas: [],
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
          medidas: [],
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
    expect(avisosRenglon[0]).toContain('Esta orden pide 1,590 pza y deberían ser 30 pza');
    // ⭐⭐ V1-E8h (§Post-F9.130): el remedio NOMBRA EL BOTÓN. El texto viejo mandaba a «guardar el
    // renglón (con eso se normaliza)» — un conjuro que un no-programador no puede adivinar.
    expect(avisosRenglon[0]).toContain('receta de esta orden');
    expect(avisosRenglon[0]).toContain('«Corregir»');
    expect(avisosRenglon[0]).not.toContain('normaliza');
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

  it('🔴 bandera encendida pero SIN cantidades por talla: el número sale bien y NO se avisa', () => {
    // R18 cae al consumo por prenda: 1 × 30 = 30, que es el requerido CORRECTO. La bandera sigue
    // mal puesta (y la RECETA lo avisa, que es donde se arregla), pero colgar aquí un aviso
    // amarillo de un número bueno es el ruido que §Post-F9.96 vino a quitar de esta pantalla.
    const { requerido, avisosRenglon } = requeridoAvio(cierre({ tallas: [] }), 30, piezas, []);
    expect(requerido).toBe(30);
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
 * ⭐⭐ §Post-F9.105 — **DE QUÉ OP HABLA UN AVISO.** Vivía como closure dentro de `proyectarRenglones`
 * y ninguna prueba lo sostenía: el reviewer lo mutó a "nunca prefijar" y **todo siguió en verde**
 * (mutación 14). Justo el caso en que el aviso sirve —varias OP en pantalla, sólo una descuadrada—
 * era el que nadie fijaba.
 */
describe('§Post-F9.105 — el aviso dice de qué ORDEN habla (prefijarConLaOrden)', () => {
  it('con VARIAS OP en pantalla nombra la suya', () => {
    expect(prefijarConLaOrden('estás pidiendo de más', 5559, true)).toBe(
      'Orden 5559: estás pidiendo de más',
    );
  });

  it('con UNA sola no repite el encabezado en cada línea', () => {
    expect(prefijarConLaOrden('estás pidiendo de más', 5559, false)).toBe('estás pidiendo de más');
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
      idColorPrenda: null,
      colorPrenda: null,
      colorTexto: null,
      colorAjustado: false,
      medidas: [],
      cantidadEnOcSinColor: 0,
      material: 'CIE-53 — Cierre 53 cm',
      unidad: 'pza',
      cantidadTotal: 1590,
      cantidadPropuesta: 1590,
      ajustado: false,
      cantidadFaltante: 0,
      restoCubierto: false,
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
          medidas: [],
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
    expect(halladas[0]?.aviso).toContain('Esta orden pide 1,590 pza y deberían ser 30 pza');
    // El mismo remedio con botón que en el renglón (V1-E8h): una sola redacción para las dos.
    expect(halladas[0]?.aviso).toContain('«Corregir»');
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
    // 53 × 40 contra 1 × 40.
    expect(halladas[0]?.aviso).toContain('Esta orden pide 2,120 pza y deberían ser 40 pza');
  });

  it('se abstiene si el renglón NO trae la bandera (no hay contradicción que medir)', () => {
    expect(
      contradiccionesDeLasOrdenes([renglonCierre({ consumoPorTalla: false })], ordenes, folioDe),
    ).toEqual([]);
  });

  it('🔴 se abstiene también si la bandera está encendida pero NO descuadra el requerido', () => {
    // Sin cantidades por talla, R18 cae al consumo por prenda: el número que se va a comprar es el
    // correcto. Avisar en la pantalla donde se FIRMA de algo que no cuesta un peso es el ruido que
    // §Post-F9.96 quitó de aquí — la RECETA sí lo avisa, que es donde se arregla.
    expect(contradiccionesDeLasOrdenes([renglonCierre({ tallas: [] })], ordenes, folioDe)).toEqual(
      [],
    );
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
          medidas: [],
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

/**
 * 🔴🔴🔴 **V1-E7f (§Post-F9.120) — LA FECHA DE LA OC NO SE HEREDA DE LA ORDEN DE PRODUCCIÓN.**
 *
 * Ésta es LA prueba de la etapa, y por eso NO se conformó con la parte pura: `resolverFechasDeOc`
 * ya no puede heredar nada —le quitaron el parámetro—, pero el defecto que Daniel encontró no vivía
 * ahí, vivía en **quien la llamaba** (`planearCompra` armaba el respaldo con la fecha de las OP y se
 * lo pasaba). Una prueba de la función pura se quedaría verde con el respaldo de vuelta: hay que
 * entrar por la puerta de verdad, `generarOCDesdeExplosion`.
 *
 * Se entra con un **doble de la transacción**, no con Postgres, porque el rechazo ocurre ANTES de
 * escribir una sola fila: el plan devuelve el bloqueo y la generación lo convierte en error. El
 * doble no inventa comportamiento — responde a las mismas consultas que hace `planearCompra`,
 * honrando su `where` (una OP que no está en el `in` no existe, un `count` de firmados cuenta lo
 * firmado) — y **cualquier tabla o método que no implemente REVIENTA con su nombre**: si mañana el
 * plan consulta algo nuevo, esta prueba lo dice en vez de seguir con un `undefined` que se parezca
 * a un dato.
 *
 * 🔴 El caso es EXACTAMENTE el de Daniel: la OP **sí** trae fecha de entrega (la 7970 la traía) y
 * aun así la compra se rechaza. Devolver el respaldo pone esta prueba en rojo por partida doble: no
 * lanzaría, y el doble tronaría al intentar ESCRIBIR la OC.
 */
describe('MRP unit — la fecha de la OC NO se hereda de la OP (§Post-F9.120)', () => {
  const ID_ORDEN = 50;
  const ID_PROVEEDOR = 11;
  /** La fecha de entrega AL CLIENTE de la OP. La que se colaba a la OC. */
  const ENTREGA_AL_CLIENTE = new Date('2026-09-30T00:00:00.000Z');

  /**
   * Doble de `Tx` con lo que `planearCompra` consulta, y NADA más. Cada tabla responde como
   * responde Prisma para este escenario: una OP viva de la empresa 1, con la receta firmada (1
   * renglón liberado, 0 pendientes) y un requerimiento de botones con proveedor y precio.
   */
  function txFalso(): { tx: never; consultadas: string[] } {
    const consultadas: string[] = [];
    const orden = {
      id: ID_ORDEN,
      folio: 7970,
      idEmpresa: 1,
      idModelo: 900,
      fechaEntrega: ENTREGA_AL_CLIENTE,
      modelo: { codigo: 'MJD-1' },
      pedidoLinea: null,
      lineas: [{ tallas: [{ idTalla: 1, cantidad: 100 }] }],
    };
    const tablas: Record<string, Record<string, (args?: never) => Promise<unknown>>> = {
      orden: {
        // Honra el `where`: sólo devuelve la OP si de verdad la están pidiendo (y de su empresa).
        findMany: (args?: never) => {
          const w = (args as unknown as { where: { id: { in: number[] }; idEmpresa: number } })
            .where;
          const casa = w.id.in.includes(ID_ORDEN) && w.idEmpresa === orden.idEmpresa;
          return Promise.resolve(casa ? [orden] : []);
        },
        findFirst: (args?: never) => {
          const w = (args as unknown as { where: { id: number; idEmpresa: number } }).where;
          const casa = w.id === ID_ORDEN && w.idEmpresa === orden.idEmpresa;
          return Promise.resolve(casa ? { folio: orden.folio } : null);
        },
      },
      // La receta: NADA pendiente de liberar y UN renglón de tela ya firmado (así la puerta de
      // `exigirRecetaLiberada` abre, que es lo que pasa en el caso real de Daniel).
      ordenTela: { findMany: () => Promise.resolve([]), count: () => Promise.resolve(1) },
      ordenAvio: { findMany: () => Promise.resolve([]), count: () => Promise.resolve(0) },
      ordenArte: { findMany: () => Promise.resolve([]), count: () => Promise.resolve(0) },
      direccionEntrega: { findFirst: () => Promise.resolve({ id: 3 }) },
      requerimientoOrden: {
        findMany: (args?: never) => {
          const w = (args as unknown as { where: { idOrden: { in: number[] } } }).where;
          if (!w.idOrden.in.includes(ID_ORDEN)) return Promise.resolve([]);
          return Promise.resolve([
            {
              id: 1,
              idOrden: ID_ORDEN,
              idTela: null,
              idAvio: 20,
              idTelaColor: null,
              // ⭐⭐ V1-E8c: el botón de este doble no se pide por color ni por medida.
              idColorPrenda: null,
              unidad: 'pza',
              esGenerico: false,
              cantidadAComprar: new Prisma.Decimal(100),
              idProveedorSugerido: ID_PROVEEDOR,
              precioSugerido: new Prisma.Decimal(2),
              tela: null,
              avio: { clave: 'BOT-01', descripcion: 'Botón' },
              telaColor: null,
              colorPrenda: null,
              medidas: [],
            },
          ]);
        },
      },
      // Nada comprometido en OC vivas: el botón entero está pendiente de comprar.
      ordenCompraLinea: { findMany: () => Promise.resolve([]) },
      // ⭐⭐ V1-E8e (§Post-F9.99): esta OP no tiene nada dado por cubierto — el DEFAULT.
      requerimientoCubierto: { findMany: () => Promise.resolve([]) },
      proveedor: {
        findMany: (args?: never) => {
          const w = (args as unknown as { where: { id: { in: number[] } } }).where;
          return Promise.resolve(
            w.id.in.includes(ID_PROVEEDOR) ? [{ id: ID_PROVEEDOR, nombre: 'Avíos Baratos' }] : [],
          );
        },
      },
    };
    // 🔴 Todo lo que no esté arriba TRUENA con su nombre: un doble que devuelve `undefined` en
    // silencio prueba la suposición de quien lo escribió, no el sistema.
    const tx = new Proxy(
      {},
      {
        get(_destino, tabla: string) {
          const metodos = tablas[tabla];
          if (metodos === undefined) {
            throw new Error(`El doble de la transacción no implementa la tabla "${tabla}"`);
          }
          return new Proxy(
            {},
            {
              get(_d, metodo: string) {
                const fn = metodos[metodo];
                if (fn === undefined) {
                  throw new Error(`El doble no implementa "${tabla}.${metodo}"`);
                }
                return (args?: never) => {
                  consultadas.push(`${tabla}.${metodo}`);
                  return fn(args);
                };
              },
            },
          );
        },
      },
    ) as never;
    return { tx, consultadas };
  }

  it('🔴🔴🔴 la OP CON fecha de entrega NO se la presta: sin capturarla, se RECHAZA', async () => {
    const { tx, consultadas } = txFalso();

    const error: unknown = await generarOCDesdeExplosion(
      sesionAdmin(),
      { idsOrden: [ID_ORDEN], idsRequerimiento: [] },
      { tx },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorValidacion);
    const mensaje = (error as Error).message;
    expect(mensaje).toMatch(/Falta la fecha de entrega de la compra/);
    // Nombra a quién le falta (no obliga a adivinar) …
    expect(mensaje).toMatch(/Avíos Baratos/);
    // … dice dónde SÍ se captura …
    expect(mensaje).toMatch(/al generar las compras/);
    // … y 🔴 NO manda a capturarla en la orden: eso ya no desbloquea nada.
    expect(mensaje).not.toMatch(/Captúrala en la orden/);

    // La OP se leyó de verdad (con su fecha dentro) y aun así no sirvió de nada: la prueba no está
    // pasando porque el plan se cayera antes de mirarla.
    expect(consultadas).toContain('orden.findMany');
    // Y NADA se escribió: ni la OC ni su bitácora (el doble ni siquiera tiene con qué).
    expect(consultadas.filter((c) => c.includes('create') || c.includes('update'))).toEqual([]);
  });

  it('con la fecha capturada arriba, el mismo plan SÍ avanza a escribir la OC', async () => {
    const { tx } = txFalso();

    // Ahora sí hay *cuándo*, así que el plan pasa el bloqueo y llega a la escritura — donde el
    // doble truena a propósito. Ese trueno es la prueba de que la fecha era LO ÚNICO que faltaba:
    // sin él, el rechazo de arriba podría venir de cualquier otro hueco del escenario.
    const error: unknown = await generarOCDesdeExplosion(
      sesionAdmin(),
      { idsOrden: [ID_ORDEN], idsRequerimiento: [], fechaEntrega: '2026-08-20' },
      { tx },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/Falta la fecha de entrega/);
    expect((error as Error).message).toMatch(/El doble .*no implementa/);
  });
});

// ── ⭐⭐ V1-E8c (§Post-F9.126) — el COLOR parte el renglón; la MEDIDA va en la tablita ───────────

/**
 * ⭐⭐ **V1-E8c — LA REGLA DE DANIEL, EN UNA CLAVE.** *"Ese modelo nos lo piden en 4 variantes de
 * color. Se generan 4 órdenes de producción. A la hora de comprar, vamos a juntar las 4 OP en una
 * sola OC. Los cierres se compran todos al mismo proveedor, pero **cada color es diferente**"*.
 *
 * `claveAgrupada` es lo ÚNICO que decide si dos renglones se funden en uno o salen separados. Hasta
 * esta etapa sólo la cubrían pruebas de integración (que necesitan Postgres): aquí se puede mutar.
 */
describe('V1-E8c — claveAgrupada: el color parte el renglón, también en los avíos', () => {
  const avio = (idColorPrenda: number | null, idProveedorSugerido = 11) => ({
    idTela: null,
    idAvio: 3,
    idTelaColor: null,
    idColorPrenda,
    idProveedorSugerido,
  });

  it('⭐ MISMO avío, MISMO proveedor, colores DISTINTOS ⇒ claves distintas (4 renglones)', () => {
    // 🔴 EL VALOR QUE LO PONE ROJO: que `claveAgrupada` ignore el color de prenda (lo que hacía
    // antes de esta etapa) — las cuatro OP de Daniel caerían en UN renglón y el proveedor recibiría
    // "3,200 cierres" sin saber de qué color es cada cuál.
    const claves = new Set([9, 10, 11, 12].map((c) => claveAgrupada(avio(c))));
    expect(claves.size).toBe(4);
  });

  it('⭐ MISMO avío, MISMO color, MISMO proveedor (dos OP) ⇒ UNA sola clave: se suman', () => {
    expect(claveAgrupada(avio(9))).toBe(claveAgrupada(avio(9)));
  });

  it('el proveedor sigue partiendo (V1-E3q): mismo color, dos proveedores ⇒ dos renglones', () => {
    expect(claveAgrupada(avio(9, 11))).not.toBe(claveAgrupada(avio(9, 22)));
  });

  it('un avío SIN color no se funde con el MISMO avío CON color (no se adivina el tono)', () => {
    expect(claveAgrupada(avio(null))).not.toBe(claveAgrupada(avio(9)));
  });

  it('🔴 el color de TELA y el de PRENDA no se confunden: el material ya separa los dos mundos', () => {
    // Una tela con `idTelaColor: 9` y un avío con `idColorPrenda: 9` son ids de catálogos DISTINTOS
    // que valen lo mismo. Si la clave no llevara el material, se pisarían.
    const tela = {
      idTela: 3,
      idAvio: null,
      idTelaColor: 9,
      idColorPrenda: null,
      idProveedorSugerido: 11,
    };
    expect(claveAgrupada(tela)).not.toBe(claveAgrupada(avio(9)));
  });
});

/**
 * ⭐⭐ **V1-E8c — el requerido ABIERTO POR TALLA**, que es de donde sale el desglose por medida.
 * Vive en la MISMA llamada que el requerido (`requeridoAvioReceta`) para que no puedan decir cosas
 * distintas: la Σ del desglose tiene que ser el requerido, siempre.
 */
describe('V1-E8c — requeridoAvio abre el requerido por talla (base del desglose por medida)', () => {
  const D = (n: number): Prisma.Decimal => new Prisma.Decimal(n);
  const piezas = new Map([
    [1, { piezas: 10, etiqueta: 'CH' }],
    [2, { piezas: 20, etiqueta: 'M' }],
  ]);

  /** Un cierre NORMAL: 1 pza por prenda, sin cantidades por talla (el caso sano). */
  function cierreSano(over: Partial<AvioDeLaExplosion> = {}): AvioDeLaExplosion {
    return {
      consumoPorPrenda: D(1),
      consumoPorTalla: false,
      tallas: [],
      avio: { clave: 'CIE', descripcion: 'Cierre', unidad: 'pza', _count: { medidas: 2 } },
      ...over,
    };
  }

  it('⭐ SIN consumo por talla también hay desglose: cada talla lleva SU medida', () => {
    // 🔴 Rojo si el brazo "no es por talla" devolviera `porTalla: []`: el cierre de consumo plano
    // —el caso NORMAL— saldría a la OC sin desglose, que es lo que Daniel reportó.
    const { requerido, porTalla } = requeridoAvio(cierreSano(), 30, piezas, []);
    expect(requerido).toBe(30);
    expect(porTalla).toEqual([
      { idTalla: 1, requerido: 10 },
      { idTalla: 2, requerido: 20 },
    ]);
  });

  it('🔴 Σ porTalla = requerido (la invariante que hace que el desglose cuadre)', () => {
    const { requerido, porTalla } = requeridoAvio(
      cierreSano({ consumoPorPrenda: D(2) }),
      30,
      piezas,
      [],
    );
    expect(porTalla.reduce((s, t) => s + t.requerido, 0)).toBe(requerido);
  });

  it('CON consumo por talla, cada talla aporta su propio consumo (y la Σ sigue cerrando)', () => {
    const porTallaAvio = cierreSano({
      consumoPorTalla: true,
      tallas: [
        { idTalla: 1, consumo: D(1) },
        { idTalla: 2, consumo: D(3) },
      ],
    });
    const { requerido, porTalla } = requeridoAvio(porTallaAvio, 30, piezas, []);
    expect(porTalla).toEqual([
      { idTalla: 1, requerido: 10 },
      { idTalla: 2, requerido: 60 },
    ]);
    expect(porTalla.reduce((s, t) => s + t.requerido, 0)).toBe(requerido);
  });

  it('una talla con CERO piezas no aporta renglón (nadie la va a cortar)', () => {
    const conCero = new Map([...piezas, [3, { piezas: 0, etiqueta: 'G' }]]);
    const { porTalla } = requeridoAvio(cierreSano(), 30, conCero, []);
    expect(porTalla.map((t) => t.idTalla)).toEqual([1, 2]);
  });
});

// ── ⭐⭐ V1-E8c — EL PLAN COMPLETO, SIN POSTGRES (el hueco que dejó pasar 8 rojas en CI) ──────────

/**
 * 🔴 **POR QUÉ EXISTE ESTA BATERÍA.** V1-E8c partió el renglón de avío por color, y con eso la clave
 * del ajuste del comprador pasó a llevar el color. Ocho pruebas de INTEGRACIÓN se cayeron en CI y
 * ninguna prueba de unidad podía verlo: `planearCompra` necesita una transacción. El resultado fue
 * el peor posible — el sistema **se tragaba el ajuste en silencio** y compraba `180` donde el
 * comprador había tecleado `0.1`.
 *
 * Se usa el MISMO doble de transacción que la batería de la fecha (arriba): responde lo que
 * `planearCompra` consulta y **truena con nombre** ante cualquier tabla que no esté prevista. Con él
 * la conducta que sólo vivía en Postgres se puede **poner roja aquí**, en 300 ms.
 */
describe('V1-E8c — el ajuste del comprador contra un renglón CON color (§Post-F9.126)', () => {
  const ID_ORDEN = 4242;
  const ID_PROVEEDOR = 77;
  const ID_AVIO = 20;
  const ID_COLOR = 9;

  /** Una línea de OC **VIEJA**: pide el avío sin decir de qué color (todas las previas a V1-E8c). */
  const lineaDeOcSinColor = (cantidad: number) => ({
    idOrden: ID_ORDEN,
    idTela: null,
    idAvio: ID_AVIO,
    idTelaColor: null,
    idColorPrenda: null,
    descripcionLibre: null,
    cantidad: new Prisma.Decimal(cantidad),
    tela: null,
    avio: { clave: 'BOT-01', descripcion: 'Botón' },
    recepcionLineas: [],
  });

  /**
   * Doble de `Tx` para `planearCompra`: una OP viva con receta firmada y UN requerimiento de botón
   * de 100 pza. `idColorPrenda` y las líneas de OC vivas se parametrizan — son las dos variables de
   * todo lo que esta batería mide.
   */
  function txFalso(
    idColorPrenda: number | null,
    lineasOc: unknown[] = [],
    // ⭐⭐ V1-E8e (§Post-F9.99): los actos de «con esto queda cubierto» vivos de esa OP. Vacío = el
    // DEFAULT (nadie decidió nada), que es como corre el resto de esta batería.
    cubiertos: unknown[] = [],
  ): never {
    const orden = {
      id: ID_ORDEN,
      folio: 7970,
      idEmpresa: 1,
      idModelo: 900,
      fechaEntrega: new Date('2026-09-30T00:00:00.000Z'),
      modelo: { codigo: 'MJD-1' },
      pedidoLinea: null,
      lineas: [{ tallas: [{ idTalla: 1, cantidad: 100 }] }],
    };
    const tablas: Record<string, Record<string, () => Promise<unknown>>> = {
      orden: {
        findMany: () => Promise.resolve([orden]),
        findFirst: () => Promise.resolve({ folio: orden.folio }),
      },
      ordenTela: { findMany: () => Promise.resolve([]), count: () => Promise.resolve(1) },
      ordenAvio: { findMany: () => Promise.resolve([]), count: () => Promise.resolve(0) },
      ordenArte: { findMany: () => Promise.resolve([]), count: () => Promise.resolve(0) },
      direccionEntrega: { findFirst: () => Promise.resolve({ id: 3 }) },
      requerimientoOrden: {
        findMany: () =>
          Promise.resolve([
            {
              id: 1,
              idOrden: ID_ORDEN,
              idTela: null,
              idAvio: ID_AVIO,
              idTelaColor: null,
              idColorPrenda,
              unidad: 'pza',
              esGenerico: false,
              cantidadAComprar: new Prisma.Decimal(100),
              idProveedorSugerido: ID_PROVEEDOR,
              precioSugerido: new Prisma.Decimal(2),
              tela: null,
              avio: { clave: 'BOT-01', descripcion: 'Botón' },
              telaColor: null,
              colorPrenda: idColorPrenda === null ? null : { nombre: 'Rojo' },
              medidas: [],
            },
          ]),
      },
      ordenCompraLinea: { findMany: () => Promise.resolve(lineasOc) },
      // ⭐⭐ V1-E8e: la tabla DURABLE de la marca — la que sobrevive a reescribir el snapshot.
      requerimientoCubierto: { findMany: () => Promise.resolve(cubiertos) },
      proveedor: {
        findMany: () => Promise.resolve([{ id: ID_PROVEEDOR, nombre: 'Avíos Baratos' }]),
      },
    };
    return new Proxy(
      {},
      {
        get(_destino, tabla: string) {
          const metodos = tablas[tabla];
          if (metodos === undefined) {
            throw new Error(`El doble de la transacción no implementa la tabla "${tabla}"`);
          }
          return new Proxy(
            {},
            {
              get(_d, metodo: string) {
                const f = metodos[metodo];
                if (f === undefined) {
                  throw new Error(`El doble no implementa "${tabla}.${metodo}"`);
                }
                return f;
              },
            },
          );
        },
      },
    ) as never;
  }

  const sesionCompras = () =>
    sesionDePrueba({ idEmpresaActiva: 1, permisos: ['compras.ver', 'compras.administrar'] });

  /** Pide el plan con (o sin) un ajuste de cantidad a 40. */
  async function plan(
    idColorPrenda: number | null,
    ajuste?: { idColor?: number | null; restoCubierto?: boolean },
    lineasOc: unknown[] = [],
    cubiertos: unknown[] = [],
  ) {
    return previoCompraDesdeExplosion(
      sesionCompras(),
      {
        idsOrden: [ID_ORDEN],
        idsRequerimiento: [],
        fechaEntrega: '2026-09-30',
        ...(ajuste === undefined
          ? {}
          : {
              ajustes: [
                {
                  tipo: 'avio' as const,
                  idMaterial: ID_AVIO,
                  ...(ajuste.idColor === undefined ? {} : { idColor: ajuste.idColor }),
                  idProveedor: ID_PROVEEDOR,
                  cantidadTotal: 40,
                  ...(ajuste.restoCubierto === undefined
                    ? {}
                    : { restoCubierto: ajuste.restoCubierto }),
                },
              ],
            }),
      },
      { tx: txFalso(idColorPrenda, lineasOc, cubiertos) },
    );
  }

  it('⭐ un ajuste que NOMBRA el color se aplica (el camino que usa la pantalla)', async () => {
    const p = await plan(ID_COLOR, { idColor: ID_COLOR });
    expect(p.proveedores[0]?.renglones[0]?.cantidadTotal).toBe(40);
    expect(p.proveedores[0]?.renglones[0]?.ajustado).toBe(true);
    expect(p.bloqueos).toEqual([]);
  });

  it('🔴🔴 un ajuste SIN color sobre un renglón CON color **BLOQUEA** (antes se tragaba callado)', async () => {
    const p = await plan(ID_COLOR, {});
    // 🔴 EL VALOR QUE LA PONE ROJA: `bloqueos: []` — el estado MEDIDO antes del arreglo, con el que
    // la compra salía en 100 (lo que propone el sistema) en vez de los 40 que se tecleron.
    expect(p.bloqueos).toHaveLength(1);
    expect(p.bloqueos[0]).toContain('BOT-01 — Botón · Rojo');
    // Y el renglón NO adoptó el número: por eso el bloqueo es lo único que evita gastar de más.
    expect(p.proveedores[0]?.renglones[0]?.cantidadTotal).toBe(100);
    expect(p.proveedores[0]?.renglones[0]?.ajustado).toBe(false);
  });

  it('un avío SIN color sigue aceptando el ajuste sin color (cero regresión donde no hay matriz)', async () => {
    const p = await plan(null, {});
    expect(p.proveedores[0]?.renglones[0]?.cantidadTotal).toBe(40);
    expect(p.bloqueos).toEqual([]);
  });

  /**
   * ⭐⭐ **EL ESCENARIO GRAVE, ANCLADO SIN POSTGRES.** Daniel tiene órdenes de compra REALES en
   * `prueba`, y todas nacieron antes de esta etapa: piden el avío **sin decir el color**. Si el
   * acervo sin color dejara de netear, la explosión diría *"cómpralo otra vez"* sobre material ya
   * comprado — el defecto exacto que §Post-F9.85 cerró, resucitado.
   *
   * 🔴 Antes de esta batería, eso **sólo lo cubría integración**. Ahora se cae aquí.
   */
  it('⭐⭐ una OC VIEJA sin color SIGUE neteando contra el renglón CON color (lo migrado no se recompra)', async () => {
    const p = await plan(ID_COLOR, undefined, [lineaDeOcSinColor(60)]);
    const renglon = p.proveedores[0]?.renglones[0];
    // 100 requeridos − 60 ya comprados = 40. 🔴 El valor que la pone roja: 100 (el neteo caído).
    expect(renglon?.cantidadTotal).toBe(40);
    // Y se DICE que esos 60 el sistema se los atribuyó (la OC vieja no dice de qué color era).
    expect(renglon?.cantidadEnOcSinColor).toBe(60);
  });

  // ── ⭐⭐ V1-E8e (§Post-F9.99) — «CON ESTO QUEDA CUBIERTO», POR EL CAMINO REAL DEL PLAN ──────────

  /** Un acto VIVO de «dado por cubierto» sobre ESTE renglón (avío + color de prenda). */
  const marcaCubierta = (cantidad: number, idColorPrenda: number | null = ID_COLOR) => ({
    idOrden: ID_ORDEN,
    idTela: null,
    idAvio: ID_AVIO,
    idTelaColor: null,
    idColorPrenda,
    cantidad: new Prisma.Decimal(cantidad),
  });

  it('⭐⭐ EL CASO DE DANIEL: comprado + dado por cubierto ⇒ el renglón deja de pedirse', async () => {
    // 100 requeridos, 99 ya en una OC viva y 1 dado por cubierto: no queda nada que comprar.
    const p = await plan(ID_COLOR, undefined, [lineaDeOcSinColor(99)], [marcaCubierta(1)]);
    // 🔴 El valor que la pone roja: un renglón con `cantidadTotal: 1` — el kilo persiguiéndolo.
    expect(p.proveedores).toEqual([]);
    const omitido = p.omitidos[0];
    expect(omitido?.motivo).toBe('dado-por-cubierto');
    expect(omitido?.cantidadCubierta).toBe(1);
    // 🔴 Y la frase NO puede ser la de `ya-en-oc` (*"si esa OC se cancela, vuelve a aparecer"*):
    // mandaría a cancelar una compra correcta. Dice quién lo cerró y cómo se deshace.
    expect(omitido?.detalle).toContain('DADO POR CUBIERTO');
    expect(omitido?.detalle).toContain('volver a pedirlo');
  });

  it('la marca RESTA, no cierra de más: cubrir 1 de 100 deja 99 por comprar', async () => {
    const p = await plan(ID_COLOR, undefined, [], [marcaCubierta(1)]);
    expect(p.proveedores[0]?.renglones[0]?.cantidadTotal).toBe(99);
  });

  it('⭐ la marca de OTRO color NO cubre a éste (el color está en la identidad)', async () => {
    // El sistema cerró el faltante del color 12; este renglón es del 9 y sigue pidiendo sus 100.
    const p = await plan(ID_COLOR, undefined, [], [marcaCubierta(100, 12)]);
    expect(p.proveedores[0]?.renglones[0]?.cantidadTotal).toBe(100);
  });

  it('⭐ bajar la cantidad ANUNCIA el faltante — y el default NO lo cierra', async () => {
    const p = await plan(ID_COLOR, { idColor: ID_COLOR });
    const renglon = p.proveedores[0]?.renglones[0];
    // 100 propuestos − 40 tecleados = 60 que se van a quedar sin comprar: es lo que dispara la
    // pregunta en pantalla. 🔴 Rojo si valiera 0: la previa no tendría por qué preguntar nada.
    expect(renglon?.cantidadFaltante).toBe(60);
    // 🔴 EL DEFAULT: sin respuesta, el resto SIGUE PENDIENTE. Nunca se cierra solo.
    expect(renglon?.restoCubierto).toBe(false);
  });

  it('comprar COMPLETO no dispara la pregunta (no hay faltante que interpretar)', async () => {
    const p = await plan(ID_COLOR, undefined);
    expect(p.proveedores[0]?.renglones[0]?.cantidadFaltante).toBe(0);
  });

  it('la respuesta «con esto queda cubierto» VIAJA hasta el plan que se va a ejecutar', async () => {
    const p = await plan(ID_COLOR, { idColor: ID_COLOR, restoCubierto: true });
    expect(p.proveedores[0]?.renglones[0]?.restoCubierto).toBe(true);
    expect(p.proveedores[0]?.renglones[0]?.cantidadFaltante).toBe(60);
  });
});
