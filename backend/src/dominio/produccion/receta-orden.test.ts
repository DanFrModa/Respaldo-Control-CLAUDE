/**
 * Tests UNITARIOS de la parte PURA de la receta congelada de la orden (V1-E3d, §Post-F9.43):
 * `calcularDesalineacion`, que es donde vive la regla fina de la etapa.
 *
 * LA REGLA QUE SE PRUEBA AQUÍ, y por qué importa tanto: la desalineación se calcula AL VUELO
 * comparando la receta CONGELADA con el BOM VIVO del modelo, y **un renglón `ajustado`,
 * `agregadoAMano` o `excluido` NO genera aviso** — esa diferencia la puso una persona a propósito.
 * Sin esa regla, el caso de negocio de la etapa (*"a este cliente le quitamos la jareta"*) sería
 * justo el que gritaría en rojo en cada pantalla, y la gente aprendería a ignorar el aviso.
 *
 * El flujo con BD (copiar del modelo, quitar/agregar/restaurar, liberar, la puerta del MRP) vive en
 * `receta-orden.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { RecetaOrdenArte, RecetaOrdenAvio, RecetaOrdenTela } from '../../contrato/index.js';

import { Prisma } from '../../datos/index.js';

import {
  calcularDesalineacion,
  laCulpaEsDeLaNormalizacion,
  medidasResultantes,
  requeridoDelRenglon,
  sacaDeLaCompra,
  type RenglonParaRequerido,
} from './receta-orden.js';

/** Renglón de tela de la receta, alineado con el modelo salvo lo que se pise. */
function tela(over: Partial<RecetaOrdenTela> = {}): RecetaOrdenTela {
  return {
    id: 1,
    tipo: 'tela',
    estado: 'revisado',
    agregadoAMano: false,
    excluido: false,
    notas: null,
    liberadoEn: null,
    liberadoPor: null,
    enElModelo: true,
    cambios: [],
    idTela: 10,
    nombre: 'Jersey',
    unidad: 'kg',
    consumoPorPrenda: 1.5,
    precio: 30,
    paraPreCosto: true,
    paraProduccion: true,
    paraCosto: true,
    idTelaProveedor: null,
    proveedorAmarrado: null,
    consumoModelo: 1.5,
    precioModelo: 30,
    precioModeloDeCompra: false,
    ...over,
  };
}

/** Renglón de avío de la receta (por default, la JARETA alineada con el modelo). */
function avio(over: Partial<RecetaOrdenAvio> = {}): RecetaOrdenAvio {
  return {
    id: 2,
    tipo: 'avio',
    estado: 'revisado',
    agregadoAMano: false,
    excluido: false,
    notas: null,
    liberadoEn: null,
    liberadoPor: null,
    enElModelo: true,
    cambios: [],
    idAvio: 20,
    clave: 'J01',
    descripcion: 'Jareta',
    unidad: 'pza',
    esGenerico: false,
    consumoPorPrenda: 1,
    precio: 0.85,
    paraPreCosto: true,
    paraProduccion: true,
    paraCosto: true,
    consumoPorTalla: false,
    modoCaptura: 'consumo',
    unidadMedida: null,
    avisoCaptura: null,
    capturaReparable: false,
    idAvioProveedor: null,
    proveedorAmarrado: null,
    tallas: [],
    tieneTallas: false,
    consumoModelo: 1,
    precioModelo: 0.85,
    precioModeloDeCompra: false,
    ...over,
  };
}

/** Renglón de arte de la receta. */
function arte(over: Partial<RecetaOrdenArte> = {}): RecetaOrdenArte {
  return {
    id: 3,
    tipo: 'arte',
    estado: 'revisado',
    agregadoAMano: false,
    excluido: false,
    notas: null,
    liberadoEn: null,
    liberadoPor: null,
    enElModelo: true,
    cambios: [],
    idModeloArte: 5,
    descripcion: 'Logo pecho',
    posicion: 'frente',
    puntadas: null,
    idTipoArte: 9,
    tipoArte: 'Bordado',
    codigoTipoArte: 'bordado',
    usaPuntadas: true,
    precio: 12,
    idProveedor: null,
    proveedor: null,
    precioModelo: 12,
    precioModeloDeCompra: false,
    ...over,
  };
}

describe('calcularDesalineacion — receta congelada vs. BOM vivo del modelo', () => {
  it('todo alineado: no hay nada que avisar', () => {
    const d = calcularDesalineacion([tela()], [avio()], [arte()], [], false);
    expect(d.hayCambios).toBe(false);
    expect(d.cambios).toEqual([]);
  });

  it('el modelo cambió la CANTIDAD: avisa, y dice de cuánto a cuánto', () => {
    const d = calcularDesalineacion([tela({ consumoModelo: 2 })], [], [], [], false);
    expect(d.hayCambios).toBe(true);
    expect(d.cambios).toHaveLength(1);
    expect(d.cambios[0]).toMatchObject({ tipo: 'tela', que: 'consumo', idRenglon: 1 });
    expect(d.cambios[0]?.detalle).toContain('1.5');
    expect(d.cambios[0]?.detalle).toContain('2');
  });

  it('el modelo cambió el PRECIO: avisa con las dos cifras', () => {
    const d = calcularDesalineacion([], [avio({ precioModelo: 0.9 })], [], [], false);
    expect(d.cambios).toHaveLength(1);
    expect(d.cambios[0]).toMatchObject({ que: 'precio' });
    expect(d.cambios[0]?.detalle).toContain('$0.85');
    expect(d.cambios[0]?.detalle).toContain('$0.90');
  });

  it('el modelo QUITÓ el insumo (ya no está en su BOM): avisa', () => {
    const d = calcularDesalineacion([], [avio({ enElModelo: false })], [], [], false);
    expect(d.cambios).toHaveLength(1);
    expect(d.cambios[0]).toMatchObject({ que: 'quitado' });
  });

  it('el modelo AGREGÓ un insumo que la orden no tiene: avisa sin renglón', () => {
    const d = calcularDesalineacion(
      [],
      [],
      [],
      [{ tipo: 'avio', material: 'E01 — Etiqueta de lavado', idMaterialModelo: 77 }],
      false,
    );
    expect(d.cambios).toEqual([
      {
        tipo: 'avio',
        idRenglon: null,
        material: 'E01 — Etiqueta de lavado',
        // V1-E3h: el faltante viaja con el id del material EN EL MODELO, para poder traerlo solo a él.
        idMaterialModelo: 77,
        que: 'agregado',
        detalle: 'El modelo ahora lleva "E01 — Etiqueta de lavado", y esta orden no lo tiene.',
      },
    ]);
  });

  // ── LA REGLA FINA: lo desviado A PROPÓSITO no grita ───────────────────────────────────────

  it('⭐ EL CASO DE LA JARETA: un renglón EXCLUIDO no genera aviso, ni aunque el modelo la lleve', () => {
    // La orden quitó la jareta a propósito; el modelo la sigue teniendo (`enElModelo: true`).
    const d = calcularDesalineacion(
      [],
      [avio({ excluido: true, estado: 'ajustado' })],
      [],
      [],
      false,
    );
    expect(d.hayCambios).toBe(false);
  });

  it('un renglón AJUSTADO a mano no grita aunque difiera del modelo en cantidad y precio', () => {
    const d = calcularDesalineacion(
      [],
      [
        avio({
          estado: 'ajustado',
          consumoPorPrenda: 3,
          precio: 2,
          consumoModelo: 1,
          precioModelo: 0.85,
        }),
      ],
      [],
      [],
      false,
    );
    expect(d.hayCambios).toBe(false);
  });

  it('un renglón AGREGADO A MANO no grita aunque el modelo no lo tenga', () => {
    const d = calcularDesalineacion(
      [],
      [avio({ agregadoAMano: true, estado: 'ajustado', enElModelo: false })],
      [],
      [],
      false,
    );
    expect(d.hayCambios).toBe(false);
  });

  it('pero un renglón SIN REVISAR sí grita: nadie lo tocó, la diferencia es del modelo', () => {
    const d = calcularDesalineacion(
      [],
      [avio({ estado: 'sin_revisar', consumoModelo: 2 })],
      [],
      [],
      false,
    );
    expect(d.cambios).toHaveLength(1);
    expect(d.cambios[0]).toMatchObject({ que: 'consumo' });
  });

  // ── Casos finos del precio ────────────────────────────────────────────────────────────────

  it('sin precio CONGELADO (recetas anteriores a V1-E3d) no se compara el precio', () => {
    // `precio: null` significa "esta orden no congeló precio", no "precio cero": contra eso no hay
    // diferencia que reportar. Es lo que deja tranquilas a las ~4,000 órdenes backfilleadas.
    const d = calcularDesalineacion([tela({ precio: null, precioModelo: 99 })], [], [], [], false);
    expect(d.hayCambios).toBe(false);
  });

  it('un precio congelado en 0 SÍ se compara (0 es un precio)', () => {
    const d = calcularDesalineacion([tela({ precio: 0, precioModelo: 30 })], [], [], [], false);
    expect(d.cambios).toHaveLength(1);
    expect(d.cambios[0]).toMatchObject({ que: 'precio' });
  });

  it('el modelo se quedó SIN precio y la orden sí lo tiene: es una diferencia, y se dice', () => {
    const d = calcularDesalineacion([tela({ precioModelo: null })], [], [], [], false);
    expect(d.cambios[0]?.detalle).toContain('sin precio');
  });

  it('diferencias por debajo de la tolerancia de redondeo NO cuentan', () => {
    const d = calcularDesalineacion([tela({ consumoModelo: 1.5 + 1e-9 })], [], [], [], false);
    expect(d.hayCambios).toBe(false);
  });

  it('un renglón puede acumular DOS cambios (cantidad y precio) y los reporta los dos', () => {
    const d = calcularDesalineacion(
      [tela({ consumoModelo: 2, precioModelo: 45 })],
      [],
      [],
      [],
      false,
    );
    expect(d.cambios.map((c) => c.que)).toEqual(['consumo', 'precio']);
  });

  it('el ARTE solo vigila existencia y precio (no tiene consumo)', () => {
    const alineado = calcularDesalineacion([], [], [arte()], [], false);
    expect(alineado.hayCambios).toBe(false);
    const conPrecio = calcularDesalineacion([], [], [arte({ precioModelo: 20 })], [], false);
    expect(conPrecio.cambios).toHaveLength(1);
    expect(conPrecio.cambios[0]).toMatchObject({ tipo: 'arte', que: 'precio' });
  });

  // ── ⭐ Precio del MERCADO vs. precio del MODELO (hallazgo del reviewer) ───────────────────

  it('⭐ si el precio del modelo viene de la ÚLTIMA COMPRA, el aviso NO dice "el modelo cambió"', () => {
    const d = calcularDesalineacion(
      [tela({ precio: 50, precioModelo: 52, precioModeloDeCompra: true })],
      [],
      [],
      [],
      false,
    );
    expect(d.cambios).toHaveLength(1);
    expect(d.cambios[0]).toMatchObject({ que: 'precio-mercado' });
    expect(d.cambios[0]?.detalle).toContain('El modelo no cambió');
  });

  it('⭐ y NO enciende el rojo aunque la orden ya tenga OC (si no, sería ruido de fondo)', () => {
    // El escenario exacto del reviewer: el comprador ajusta su propia OC a $52 y la autoriza; desde
    // ese instante la orden se pintaba en rojo, provocada por su propia compra.
    const d = calcularDesalineacion(
      [tela({ precio: 50, precioModelo: 52, precioModeloDeCompra: true })],
      [],
      [],
      [],
      true,
    );
    expect(d.hayCambios).toBe(true); // se informa
    expect(d.conOrdenCompra).toBe(true);
    expect(d.critico).toBe(false); // …pero NO en rojo
  });

  it('un cambio de PERSONA con OC hecha SÍ enciende el rojo', () => {
    const d = calcularDesalineacion([tela({ consumoModelo: 3 })], [], [], [], true);
    expect(d.critico).toBe(true);
  });

  it('mezcla: mercado + persona con OC hecha → rojo (lo enciende el de la persona)', () => {
    const d = calcularDesalineacion(
      [tela({ precio: 50, precioModelo: 52, precioModeloDeCompra: true })],
      [avio({ consumoModelo: 4 })],
      [],
      [],
      true,
    );
    expect(d.cambios.map((c) => c.que).sort()).toEqual(['consumo', 'precio-mercado']);
    expect(d.critico).toBe(true);
  });

  it('sin OC, ningún cambio es crítico (el aviso va en el lugar de la decisión)', () => {
    const d = calcularDesalineacion([tela({ consumoModelo: 3 })], [], [], [], false);
    expect(d.critico).toBe(false);
  });

  // ── Los DOS avisos de Daniel: lo que cambia es DÓNDE se enseñan ───────────────────────────

  it('`conOrdenCompra` viaja tal cual: decide DÓNDE se enseña el aviso, no SI se calcula', () => {
    // Mismo cálculo con y sin OC (§Post-F9.43(d): sin OC va en el lugar de la decisión; con OC, al
    // abrir la orden). Lo único que cambia es la bandera que la pantalla usa para decidir.
    const sinOc = calcularDesalineacion([tela({ consumoModelo: 2 })], [], [], [], false);
    const conOc = calcularDesalineacion([tela({ consumoModelo: 2 })], [], [], [], true);
    expect(sinOc.conOrdenCompra).toBe(false);
    expect(conOc.conOrdenCompra).toBe(true);
    expect(sinOc.cambios).toEqual(conOc.cambios);
  });

  it('⭐ criterio de cierre: dos órdenes del mismo modelo, una con jareta y otra sin, no se estorban', () => {
    // Orden A: lleva la jareta tal como el modelo. Orden B: se la quitó. El BOM del modelo es el
    // MISMO para las dos, y ninguna de las dos genera aviso — que es justo lo que se buscaba.
    const conJareta = calcularDesalineacion([], [avio()], [], [], false);
    const sinJareta = calcularDesalineacion(
      [],
      [avio({ excluido: true, estado: 'ajustado', notas: 'El cliente la negoció fuera' })],
      [],
      [],
      false,
    );
    expect(conJareta.hayCambios).toBe(false);
    expect(sinJareta.hayCambios).toBe(false);
  });
});

// ── ⭐ V1-E3y — la parte PURA del bloqueo "no se saca de la receta lo ya comprado" ───────────────

/**
 * ⭐ EL CRITERIO ES EL REQUERIDO REAL, NO DOS CAMPOS — y esa distinción tiene una cicatriz.
 *
 * La primera versión de esta guarda miraba `paraProduccion` y `consumoPorPrenda`, y el reviewer la
 * tumbó con un caso que esos dos campos no ven: un avío **por talla** (R18) comprado, con sus
 * MEDIDAS puestas todas en **0**. Los dos campos quedan intactos, el requerido se va a cero y el
 * material desaparece del *"qué tengo / qué falta"* — la misma contradicción, por una tercera
 * puerta. Su espejo también fallaba: un avío con `consumoPorPrenda = 0` y medidas > 0 SÍ pide
 * material, y el criterio viejo lo daba por fuera y no lo protegía.
 *
 * Ahora el criterio es uno solo y real: **antes pedía algo y después no pide nada**, calculado con
 * `requeridoAvioReceta`, la misma función que usan el MRP y la habilitación.
 */
describe('requeridoDelRenglon / sacaDeLaCompra (§Post-F9.79)', () => {
  /** 100 piezas: 40 CH (id 1), 60 M (id 2). */
  const PIEZAS = { total: 100, porTalla: new Map([[1, 40] as const, [2, 60] as const]) };

  /** Una TELA de la receta (sin medidas por talla). */
  function tela(over: Partial<RenglonParaRequerido> = {}): RenglonParaRequerido {
    return { excluido: false, paraProduccion: true, consumoPorPrenda: 1.5, ...over };
  }

  /** Un AVÍO POR TALLA con medida 1 en cada talla de la orden. */
  function avioPorTalla(over: Partial<RenglonParaRequerido> = {}): RenglonParaRequerido {
    return {
      excluido: false,
      paraProduccion: true,
      consumoPorPrenda: 2,
      consumoPorTalla: true,
      tallas: [
        { idTalla: 1, consumo: 1 },
        { idTalla: 2, consumo: 1 },
      ],
      ...over,
    };
  }

  it('el requerido de una tela es consumo × piezas, y cero si está fuera', () => {
    expect(requeridoDelRenglon(tela(), PIEZAS)).toBe(150);
    expect(requeridoDelRenglon(tela({ excluido: true }), PIEZAS)).toBe(0);
    expect(requeridoDelRenglon(tela({ paraProduccion: false }), PIEZAS)).toBe(0);
    expect(requeridoDelRenglon(tela({ consumoPorPrenda: 0 }), PIEZAS)).toBe(0);
  });

  it('⭐ en un avío POR TALLA el requerido sale de las MEDIDAS, no del consumo por prenda', () => {
    // 40×1 + 60×1 = 100, aunque `consumoPorPrenda` valga 2 (sería 200 si mandara él).
    expect(requeridoDelRenglon(avioPorTalla(), PIEZAS)).toBe(100);
    // Medidas en CERO → requerido CERO, con `paraProduccion` y `consumoPorPrenda` intactos.
    expect(
      requeridoDelRenglon(
        avioPorTalla({
          tallas: [
            { idTalla: 1, consumo: 0 },
            { idTalla: 2, consumo: 0 },
          ],
        }),
        PIEZAS,
      ),
    ).toBe(0);
    // Y el ESPEJO: consumo por prenda 0 pero medidas > 0 → SÍ pide material.
    expect(requeridoDelRenglon(avioPorTalla({ consumoPorPrenda: 0 }), PIEZAS)).toBe(100);
  });

  it('una talla SIN medida capturada cae al consumo por prenda (R18), y eso también cuenta', () => {
    // Sólo la talla 1 tiene medida; la 2 usa `consumoPorPrenda`: 40×1 + 60×2 = 160.
    expect(
      requeridoDelRenglon(avioPorTalla({ tallas: [{ idTalla: 1, consumo: 1 }] }), PIEZAS),
    ).toBe(160);
    // Con las dos sin medida y el consumo en 0, no pide nada.
    expect(requeridoDelRenglon(avioPorTalla({ tallas: [], consumoPorPrenda: 0 }), PIEZAS)).toBe(0);
  });

  it('quitar (despues = null) saca al renglón si HOY pedía algo', () => {
    expect(sacaDeLaCompra(tela(), null, PIEZAS)).toBe(true);
    expect(sacaDeLaCompra(avioPorTalla(), null, PIEZAS)).toBe(true);
  });

  it('un renglón que YA no pedía nada no se puede "sacar" otra vez (no se atrapa a nadie)', () => {
    expect(sacaDeLaCompra(tela({ paraProduccion: false }), null, PIEZAS)).toBe(false);
    expect(sacaDeLaCompra(tela({ consumoPorPrenda: 0 }), null, PIEZAS)).toBe(false);
    // Ni siquiera con una orden SIN matriz capturada: ahí nadie pide nada, así que nada se saca.
    expect(sacaDeLaCompra(tela(), null, { total: 0, porTalla: new Map() })).toBe(false);
  });

  it('las puertas de atrás CLÁSICAS siguen cerradas: `paraProduccion` en false y consumo 0', () => {
    expect(sacaDeLaCompra(tela(), tela({ paraProduccion: false }), PIEZAS)).toBe(true);
    expect(sacaDeLaCompra(tela(), tela({ consumoPorPrenda: 0 }), PIEZAS)).toBe(true);
  });

  it('⭐ y la TERCERA: dejar en 0 las MEDIDAS POR TALLA de un avío comprado', () => {
    const enCero = avioPorTalla({
      tallas: [
        { idTalla: 1, consumo: 0 },
        { idTalla: 2, consumo: 0 },
      ],
    });
    expect(sacaDeLaCompra(avioPorTalla(), enCero, PIEZAS)).toBe(true);
    // ⚠️ Y con el criterio VIEJO esto no se veía: los dos campos que miraba no cambian.
    expect(enCero.paraProduccion).toBe(true);
    expect(enCero.consumoPorPrenda).toBe(2);
  });

  it('⭐ el ESPEJO: un avío con consumo 0 y medidas > 0 SÍ está protegido', () => {
    const vivoPorSusMedidas = avioPorTalla({ consumoPorPrenda: 0 });
    // El criterio viejo (`consumoPorPrenda > 0`) lo daba por fuera y no lo bloqueaba al quitarlo.
    expect(sacaDeLaCompra(vivoPorSusMedidas, null, PIEZAS)).toBe(true);
  });

  it('cambiar las medidas sin vaciarlas NO saca nada (ajustar lo comprado es legítimo)', () => {
    const masAlto = avioPorTalla({
      tallas: [
        { idTalla: 1, consumo: 3 },
        { idTalla: 2, consumo: 5 },
      ],
    });
    expect(sacaDeLaCompra(avioPorTalla(), masAlto, PIEZAS)).toBe(false);
    // Dejar UNA talla en 0 y las otras con medida tampoco: la orden sigue pidiendo material.
    const unaEnCero = avioPorTalla({
      tallas: [
        { idTalla: 1, consumo: 0 },
        { idTalla: 2, consumo: 1 },
      ],
    });
    expect(sacaDeLaCompra(avioPorTalla(), unaEnCero, PIEZAS)).toBe(false);
  });

  it('apagar el toggle POR TALLA no saca nada si el consumo por prenda sostiene el requerido', () => {
    // De medidas (100) a consumo por prenda (2×100 = 200): cambia el número, no la pertenencia.
    expect(sacaDeLaCompra(avioPorTalla(), avioPorTalla({ consumoPorTalla: false }), PIEZAS)).toBe(
      false,
    );
    // Pero si además el consumo por prenda es 0, ahí sí queda en nada.
    expect(
      sacaDeLaCompra(
        avioPorTalla(),
        avioPorTalla({ consumoPorTalla: false, consumoPorPrenda: 0 }),
        PIEZAS,
      ),
    ).toBe(true);
  });
});

/**
 * ⭐ LA CASCADA DE LAS MEDIDAS POR TALLA — la escribe `reemplazarMedidasAvio` y la lee la guarda de
 * V1-E3y para saber qué quedaría. **Es una sola definición**, y estas pruebas son las que impiden
 * que se toque a la ligera.
 *
 * Nació de una mutación que SOBREVIVIÓ: al romper la cascada (`t.consumo ?? 0`) la suite seguía
 * verde, porque ninguna prueba la ejercitaba. Un instrumento ciego en el punto exacto donde la
 * guarda decide si el requerido se va a cero.
 */
describe('medidasResultantes — la cascada de una medida por talla', () => {
  /** Medidas PREVIAS del renglón, como vienen de la base. */
  const previas = [
    { idTalla: 1, consumo: new Prisma.Decimal(7) },
    { idTalla: 2, consumo: new Prisma.Decimal(9) },
  ];

  it('un `consumo` explícito manda sobre todo — incluido el CERO', () => {
    expect(medidasResultantes([{ idTalla: 1, consumo: 3 }], previas, 99)).toEqual([
      { idTalla: 1, consumo: 3 },
    ]);
    // El 0 es un valor, no un "no vino": `esquemaRecetaTallaEntrada.consumo` es `nonnegative`.
    expect(medidasResultantes([{ idTalla: 1, consumo: 0 }], previas, 99)).toEqual([
      { idTalla: 1, consumo: 0 },
    ]);
  });

  it('sin `consumo`, conserva la medida PREVIA de esa talla', () => {
    expect(medidasResultantes([{ idTalla: 2 }], previas, 99)).toEqual([{ idTalla: 2, consumo: 9 }]);
  });

  it('sin `consumo` y sin medida previa, cae al consumo por prenda RESULTANTE', () => {
    // Talla nueva (3): no había medida, así que hereda el consumo por prenda — y tiene que ser el
    // RESULTANTE, no el viejo, porque el mismo PATCH pudo cambiarlo.
    expect(medidasResultantes([{ idTalla: 3 }], previas, 99)).toEqual([
      { idTalla: 3, consumo: 99 },
    ]);
  });

  it('resuelve cada talla por su cuenta y conserva el orden pedido', () => {
    expect(
      medidasResultantes([{ idTalla: 2 }, { idTalla: 3 }, { idTalla: 1, consumo: 0 }], previas, 99),
    ).toEqual([
      { idTalla: 2, consumo: 9 },
      { idTalla: 3, consumo: 99 },
      { idTalla: 1, consumo: 0 },
    ]);
  });
});

/**
 * ⭐⭐ **§Post-F9.105 (2ª vuelta) — DE QUIÉN ES LA CULPA cuando el requerido se va a cero.**
 *
 * La guarda de lo ya comprado no se relaja nunca; lo que esto decide es **qué error se explica**. El
 * defecto que el reviewer encontró era de ALCANCE: la decisión miraba si el PATCH había mandado la
 * bandera, y **el remedio que §Post-F9.105 documenta la manda explícita**, así que por el camino
 * recomendado salía el mensaje viejo (*"des-autoriza la OC"*).
 */
describe('laCulpaEsDeLaNormalizacion (§Post-F9.105)', () => {
  it('⭐ es NUESTRA si el avío es por medida, traía la bandera y sin normalizar NO se salía', () => {
    expect(laCulpaEsDeLaNormalizacion(true, true, false)).toBe(true);
  });

  it('es del USUARIO si su cambio, sin tocar la bandera, ya lo sacaba de la compra', () => {
    expect(laCulpaEsDeLaNormalizacion(true, true, true)).toBe(false);
  });

  it('🔴 NO es nuestra en un avío por talla LEGÍTIMO (elástico, sin medidas en catálogo)', () => {
    // Sin el término `porMedida`, apagar a mano el consumo por talla de un elástico recibiría el
    // texto de la normalización y mandaría a capturar un consumo que nadie tiene que capturar.
    expect(laCulpaEsDeLaNormalizacion(false, true, false)).toBe(false);
  });

  it('no es nuestra si el renglón no traía la bandera encendida (no había nada que normalizar)', () => {
    expect(laCulpaEsDeLaNormalizacion(true, false, false)).toBe(false);
  });
});
