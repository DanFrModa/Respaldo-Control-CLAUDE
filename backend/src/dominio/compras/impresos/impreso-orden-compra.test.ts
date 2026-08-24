/**
 * Pruebas unitarias del impreso de la orden de compra (F4-E2 + ⭐ V1-E4e). No tocan BD: ejercitan
 *  • `generarPdfOrdenCompra` — devuelve un Buffer PDF real (cabecera `%PDF`), incluso con matriz,
 *    OC cancelada, líneas libres, sin renglones o con facturasAmparadasLegacy.
 *  • `motivoNoImprimirOC` — ⭐ §Post-F9.101: quién SÍ se imprime, con su motivo en palabras.
 *  • `consolidarRenglonesParaProveedor` — ⭐⭐ §Post-F9.102: el papel del proveedor sale con UNA
 *    cantidad por material (y color), y NO se fusiona lo que tiene precios distintos.
 *  • `armarDatosImpresoOC` — reúsa `obtenerOC` (inyectado), proyecta material/importe/matriz, NIEGA
 *    el impreso de lo no autorizado (servidor), no deja ningún folio de OP en el documento y el
 *    total CUADRA con `CompraSalida.total`; propaga el 404 de `obtenerOC` (A9).
 */
import { describe, expect, it } from 'vitest';

import { ErrorNoEncontrado, ErrorValidacion } from '../../../comun/errores.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { CompraLineaSalida, CompraSalida } from '../../../contrato/index.js';

import {
  armarDatosImpresoOC,
  complementoDeLinea,
  consolidarRenglonesParaProveedor,
  generarPdfOrdenCompra,
  motivoNoImprimirOC,
  textosComplemento,
  type DatosImpresoOC,
  type DepsImpresoOC,
  type LineaImpresoOC,
  type RenglonParaConsolidar,
} from './impreso-orden-compra.js';

/** Sesión de prueba con el permiso `compras.ver`. */
function sesionConVer(): SesionUsuario {
  return {
    id: 'u1',
    username: 'tester',
    nombre: 'Tester',
    idEmpresaActiva: 1,
    nombreEmpresaActiva: 'FR Moda',
    permisos: new Set(['compras.ver']),
  } as unknown as SesionUsuario;
}

/** Datos de impreso mínimos, con overrides puntuales. */
function datosBase(over: Partial<DatosImpresoOC> = {}): DatosImpresoOC {
  return {
    empresa: 'FR Moda',
    numCompra: 42,
    estatus: 'autorizada',
    cancelada: false,
    motivoCancelacion: null,
    proveedor: 'Telas del Norte',
    fecha: '2026-06-20',
    fechaEntrega: '2026-07-01',
    entregaEn: 'Bodega central',
    observaciones: 'Urgente.',
    correspondeA: 'Pedido Liverpool',
    facturasAmparadasLegacy: null,
    lineas: [
      {
        material: 'Felpa',
        cantidad: 30,
        unidad: 'm',
        precio: 25,
        importe: 750,
        importeCuerpo: 750,
        complemento: null,
        matriz: [
          { color: 'Rojo', talla: 'CH', cantidad: 10 },
          { color: 'Rojo', talla: 'M', cantidad: 20 },
        ],
      },
      {
        material: 'Flete',
        cantidad: 1,
        unidad: null,
        precio: 300,
        importe: 300,
        importeCuerpo: 300,
        complemento: null,
        matriz: [],
      },
    ],
    total: 1050,
    ...over,
  };
}

/** ¿El Buffer empieza con la firma de un PDF? */
function esPdf(buffer: Buffer): boolean {
  return buffer.length > 0 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

describe('generarPdfOrdenCompra', () => {
  it('devuelve un Buffer no vacío con cabecera %PDF', async () => {
    const buffer = await generarPdfOrdenCompra(datosBase());
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(esPdf(buffer)).toBe(true);
  });

  it('renderiza una OC CANCELADA con su motivo, sin truncar', async () => {
    // ⚠️ §Post-F9.101 impide LLEGAR aquí con una OC cancelada (`armarDatosImpresoOC` la niega), pero
    // la banda se conserva a propósito: si Daniel prefiriera conservar el impreso de las canceladas
    // para archivo, se revierte en una línea del criterio y el papel ya sale marcado.
    const buffer = await generarPdfOrdenCompra(
      datosBase({ cancelada: true, estatus: 'cancelada', motivoCancelacion: 'duplicada' }),
    );
    expect(esPdf(buffer)).toBe(true);
  });

  it('renderiza con facturasAmparadasLegacy (dato histórico solo lectura)', async () => {
    const buffer = await generarPdfOrdenCompra(
      datosBase({ facturasAmparadasLegacy: 'F-100, F-101' }),
    );
    expect(esPdf(buffer)).toBe(true);
  });

  it('renderiza un renglón CON complemento (Cardigan) sin romper el documento', async () => {
    const buffer = await generarPdfOrdenCompra(
      datosBase({
        lineas: [
          {
            material: 'Felpa 280 · Rojo',
            cantidad: 100,
            unidad: 'kg',
            precio: 185,
            importe: 19400,
            importeCuerpo: 18500,
            complemento: { nombre: 'Cardigan', cantidad: 20, precio: 45, importe: 900 },
            matriz: [],
          },
        ],
        total: 19400,
      }),
    );
    expect(esPdf(buffer)).toBe(true);
  });

  it('renderiza sin renglones (OC vacía)', async () => {
    const buffer = await generarPdfOrdenCompra(datosBase({ lineas: [], total: 0 }));
    expect(esPdf(buffer)).toBe(true);
  });
});

// ── ⭐ §Post-F9.101 — una OC sin autorizar no se imprime ─────────────────────────────────────────

describe('motivoNoImprimirOC (§Post-F9.101)', () => {
  it('deja imprimir la AUTORIZADA y las RECIBIDAS (el criterio compartido, no uno nuevo)', () => {
    expect(motivoNoImprimirOC('autorizada')).toBeNull();
    expect(motivoNoImprimirOC('recibida_parcial')).toBeNull();
    expect(motivoNoImprimirOC('recibida_total')).toBeNull();
  });

  it('NIEGA borrador y pendiente_autorizacion, y dice cuándo se imprime', () => {
    for (const estatus of ['borrador', 'pendiente_autorizacion']) {
      const motivo = motivoNoImprimirOC(estatus);
      expect(motivo).not.toBeNull();
      // El mensaje tiene que decir qué hacer, no sólo que no se puede (Daniel: "ni aunque diga
      // borrador"; §Post-F9.101(c): dice POR QUÉ).
      expect(motivo).toContain('Se imprime cuando la orden esté autorizada');
    }
  });

  it('NIEGA la cancelada, con su propio motivo (§Post-F9.101(d))', () => {
    expect(motivoNoImprimirOC('cancelada')).toContain('cancelada');
    // Y no le da el mensaje de "autorízala": una cancelada ya no se arregla autorizando.
    expect(motivoNoImprimirOC('cancelada')).not.toContain('esté autorizada');
  });
});

// ── ⭐⭐ §Post-F9.102 — el impreso se consolida para el proveedor ────────────────────────────────

describe('consolidarRenglonesParaProveedor (§Post-F9.102)', () => {
  /** Renglón guardado de OC (una línea por material × OP), con overrides. */
  function renglon(over: Partial<RenglonParaConsolidar> = {}): RenglonParaConsolidar {
    return {
      idTela: 3,
      idTelaColor: 9,
      idAvio: null,
      descripcionLibre: null,
      material: 'Felpa 280 · Rojo (18-1664 TCX)',
      cantidad: 100,
      unidad: 'm',
      precio: 25,
      complemento: null,
      importe: 2500,
      matriz: [],
      ...over,
    };
  }

  /** Un complemento de tela (Cardigan) para el fixture, con overrides. */
  function cardigan(over: Partial<{ nombre: string; cantidad: number; precio: number }> = {}) {
    return { nombre: 'Cardigan', cantidad: 20, precio: 20, ...over };
  }

  it('sin renglones devuelve una lista vacía', () => {
    expect(consolidarRenglonesParaProveedor([])).toEqual([]);
  });

  it('⭐ FUSIONA dos renglones del mismo material+color: una sola cantidad para el proveedor', () => {
    // El caso de Daniel (OC 7965): el mismo rojo pedido para DOS órdenes de producción.
    const lineas = consolidarRenglonesParaProveedor([
      renglon({ cantidad: 100, importe: 2500 }),
      renglon({ cantidad: 60, importe: 1500 }),
    ]);

    expect(lineas).toHaveLength(1);
    expect(lineas[0]?.cantidad).toBe(160);
    expect(lineas[0]?.importe).toBe(4000);
    expect(lineas[0]?.material).toBe('Felpa 280 · Rojo (18-1664 TCX)');
    expect(lineas[0]?.unidad).toBe('m');
    expect(lineas[0]?.precio).toBe(25);
  });

  it('al fusionar, SUMA también las matrices talla×color (o el desglose mentiría)', () => {
    const lineas = consolidarRenglonesParaProveedor([
      renglon({
        cantidad: 30,
        importe: 750,
        matriz: [
          { color: 'Rojo', talla: 'CH', cantidad: 10 },
          { color: 'Rojo', talla: 'M', cantidad: 20 },
        ],
      }),
      renglon({
        cantidad: 25,
        importe: 625,
        matriz: [
          { color: 'Rojo', talla: 'M', cantidad: 5 },
          { color: 'Rojo', talla: 'G', cantidad: 20 },
        ],
      }),
    ]);

    expect(lineas).toHaveLength(1);
    expect(lineas[0]?.cantidad).toBe(55);
    // Orden de aparición, con la M sumada (20 + 5) y la G agregada al final.
    expect(lineas[0]?.matriz).toEqual([
      { color: 'Rojo', talla: 'CH', cantidad: 10 },
      { color: 'Rojo', talla: 'M', cantidad: 25 },
      { color: 'Rojo', talla: 'G', cantidad: 20 },
    ]);
    // 🔴 El desglose CUADRA con la cantidad del renglón fusionado.
    expect(lineas[0]?.matriz.reduce((s, c) => s + c.cantidad, 0)).toBe(lineas[0]?.cantidad);
  });

  it('la matriz distingue COLOR y talla: la misma talla en dos colores no se colapsa', () => {
    const lineas = consolidarRenglonesParaProveedor([
      renglon({
        cantidad: 15,
        importe: 375,
        matriz: [
          { color: 'Rojo', talla: 'CH', cantidad: 10 },
          { color: 'Marino', talla: 'CH', cantidad: 5 },
        ],
      }),
      renglon({
        cantidad: 3,
        importe: 75,
        matriz: [{ color: 'Rojo', talla: 'CH', cantidad: 3 }],
      }),
    ]);

    expect(lineas[0]?.matriz).toEqual([
      { color: 'Rojo', talla: 'CH', cantidad: 13 },
      { color: 'Marino', talla: 'CH', cantidad: 5 },
    ]);
  });

  it('el renglón consolidado es DUEÑO de su matriz: ni la aliasa ni la muta', () => {
    const celda = { color: 'Rojo', talla: 'CH', cantidad: 10 };
    const matrizOriginal = [celda];

    // Con UN solo renglón del grupo (el caso donde es fácil devolver la de entrada tal cual).
    const [sola] = consolidarRenglonesParaProveedor([renglon({ matriz: matrizOriginal })]);
    expect(sola?.matriz).toEqual(matrizOriginal);
    // 🔴 …pero NO es el mismo arreglo ni las mismas celdas: lo que se manda a imprimir no puede
    // quedar enganchado a la estructura que lo alimentó (una suma posterior lo cambiaría por detrás).
    expect(sola?.matriz).not.toBe(matrizOriginal);
    expect(sola?.matriz[0]).not.toBe(celda);

    // Y al fusionar, la matriz de entrada queda intacta.
    consolidarRenglonesParaProveedor([
      renglon({ matriz: matrizOriginal }),
      renglon({ matriz: [{ color: 'Rojo', talla: 'CH', cantidad: 7 }] }),
    ]);
    expect(matrizOriginal).toEqual([{ color: 'Rojo', talla: 'CH', cantidad: 10 }]);
  });

  it('🔴 con PRECIOS DISTINTOS no fusiona (no se promedia ni se inventa un precio)', () => {
    const lineas = consolidarRenglonesParaProveedor([
      renglon({ cantidad: 100, precio: 25, importe: 2500 }),
      renglon({ cantidad: 60, precio: 27, importe: 1620 }),
    ]);

    expect(lineas).toHaveLength(2);
    expect(lineas.map((l) => l.precio)).toEqual([25, 27]);
    expect(lineas.map((l) => l.cantidad)).toEqual([100, 60]);
    // Y cada renglón se sigue leyendo solo: cantidad × precio = importe.
    for (const l of lineas) {
      expect(l.cantidad * l.precio).toBe(l.importe);
    }
  });

  it('con COLORES distintos no fusiona (el color sí le importa al proveedor)', () => {
    const lineas = consolidarRenglonesParaProveedor([
      renglon({ idTelaColor: 9, material: 'Felpa 280 · Rojo' }),
      renglon({ idTelaColor: 11, material: 'Felpa 280 · Marino' }),
    ]);
    expect(lineas).toHaveLength(2);
    expect(lineas.map((l) => l.material)).toEqual(['Felpa 280 · Rojo', 'Felpa 280 · Marino']);
  });

  it('la misma tela SIN color no se fusiona con la que SÍ lo dice (no se adivina el tono)', () => {
    const lineas = consolidarRenglonesParaProveedor([
      renglon({ idTelaColor: null, material: 'Felpa 280' }),
      renglon({ idTelaColor: 9, material: 'Felpa 280 · Rojo' }),
    ]);
    expect(lineas).toHaveLength(2);
  });

  it('materiales distintos (tela vs avío vs línea libre) nunca se fusionan', () => {
    const lineas = consolidarRenglonesParaProveedor([
      renglon(),
      renglon({ idTela: null, idTelaColor: null, idAvio: 7, material: 'BOT-01 — Botón' }),
      renglon({
        idTela: null,
        idTelaColor: null,
        idAvio: null,
        descripcionLibre: 'Flete',
        material: 'Flete',
      }),
      renglon({
        idTela: null,
        idTelaColor: null,
        idAvio: null,
        descripcionLibre: 'Maniobras',
        material: 'Maniobras',
      }),
    ]);
    expect(lineas).toHaveLength(4);
  });

  it('dos líneas libres con el MISMO texto y precio sí se fusionan', () => {
    const libre = {
      idTela: null,
      idTelaColor: null,
      idAvio: null,
      descripcionLibre: 'Flete',
      material: 'Flete',
      unidad: null,
    };
    const lineas = consolidarRenglonesParaProveedor([
      renglon({ ...libre, cantidad: 1, precio: 300, importe: 300 }),
      renglon({ ...libre, cantidad: 2, precio: 300, importe: 600 }),
    ]);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]?.cantidad).toBe(3);
    expect(lineas[0]?.importe).toBe(900);
  });

  it('dos TELAS distintas no se fusionan aunque coincidan color-nulo, unidad y precio', () => {
    const lineas = consolidarRenglonesParaProveedor([
      renglon({ idTela: 3, idTelaColor: null, material: 'Felpa 280' }),
      renglon({ idTela: 4, idTelaColor: null, material: 'Jersey 180' }),
    ]);
    expect(lineas).toHaveLength(2);
    expect(lineas.map((l) => l.material)).toEqual(['Felpa 280', 'Jersey 180']);
  });

  it('dos AVÍOS distintos no se fusionan aunque coincidan unidad y precio', () => {
    const avio = { idTela: null, idTelaColor: null, descripcionLibre: null };
    const lineas = consolidarRenglonesParaProveedor([
      renglon({ ...avio, idAvio: 7, material: 'BOT-01 — Botón' }),
      renglon({ ...avio, idAvio: 8, material: 'ETQ-02 — Etiqueta' }),
    ]);
    expect(lineas).toHaveLength(2);
    expect(lineas.map((l) => l.material)).toEqual(['BOT-01 — Botón', 'ETQ-02 — Etiqueta']);
  });

  it('con UNIDADES distintas no fusiona (sumar metros con kilos no es una cantidad)', () => {
    const lineas = consolidarRenglonesParaProveedor([
      renglon({ unidad: 'm' }),
      renglon({ unidad: 'kg' }),
    ]);
    expect(lineas).toHaveLength(2);
  });

  it('con precios de COMPLEMENTO distintos no fusiona (es otro precio del mismo importe)', () => {
    const lineas = consolidarRenglonesParaProveedor([
      renglon({ complemento: cardigan({ precio: 20 }), cantidad: 100, importe: 2900 }),
      renglon({ complemento: cardigan({ precio: 22 }), cantidad: 100, importe: 2940 }),
    ]);
    expect(lineas).toHaveLength(2);
  });

  it('un renglón CON complemento no se fusiona con uno SIN complemento', () => {
    const lineas = consolidarRenglonesParaProveedor([
      renglon({ complemento: cardigan(), cantidad: 100, importe: 2900 }),
      renglon({ complemento: null, cantidad: 100, importe: 2500 }),
    ]);
    expect(lineas).toHaveLength(2);
  });

  it('⭐ al fusionar, el COMPLEMENTO se suma igual que la cantidad', () => {
    // Dos OP piden el mismo rojo, y cada una su Cardigan. El proveedor tiene que ver UNA tela y UN
    // Cardigan, no cuatro renglones.
    const lineas = consolidarRenglonesParaProveedor([
      renglon({
        cantidad: 100,
        precio: 185,
        complemento: cardigan({ cantidad: 20, precio: 45 }),
        importe: 19400,
      }),
      renglon({
        cantidad: 60,
        precio: 185,
        complemento: cardigan({ cantidad: 12, precio: 45 }),
        importe: 11640,
      }),
    ]);

    expect(lineas).toHaveLength(1);
    expect(lineas[0]?.cantidad).toBe(160);
    expect(lineas[0]?.complemento).toEqual({
      nombre: 'Cardigan',
      cantidad: 32,
      precio: 45,
      importe: 1440,
    });
    // 🔴 Y la cuenta que se imprime CIERRA: 160 × 185 = 29,600 · + 32 × 45 = 1,440 · = 31,040.
    expect(lineas[0]?.importeCuerpo).toBe(29600);
    expect(lineas[0]?.importe).toBe(31040);
    expect((lineas[0]?.importeCuerpo ?? 0) + (lineas[0]?.complemento?.importe ?? 0)).toBe(
      lineas[0]?.importe,
    );
  });

  it('🔴 el desglose del importe CIERRA siempre, con y sin complemento', () => {
    const lineas = consolidarRenglonesParaProveedor([
      renglon({
        cantidad: 100,
        precio: 185,
        complemento: cardigan({ precio: 45 }),
        importe: 19400,
      }),
      renglon({ idTelaColor: 11, material: 'Marino', cantidad: 40, precio: 185, importe: 7400 }),
      renglon({
        idTela: null,
        idTelaColor: null,
        idAvio: 7,
        material: 'BOT-01',
        cantidad: 5000,
        precio: 0.8,
        importe: 4000,
      }),
    ]);

    expect(lineas).toHaveLength(3);
    for (const l of lineas) {
      expect(l.importeCuerpo + (l.complemento?.importe ?? 0)).toBe(l.importe);
    }
    // Sin complemento, el cuerpo ES el importe (no hay nada que partir).
    expect(lineas[1]?.complemento).toBeNull();
    expect(lineas[1]?.importeCuerpo).toBe(lineas[1]?.importe);
  });

  it('🔴 el renglón consolidado es DUEÑO de su complemento: no muta el de entrada', () => {
    // El acumulador suma la cantidad del complemento EN SITIO. Si el primer grupo se quedara con el
    // objeto del renglón de entrada en vez de una copia, fusionar le cambiaría la cantidad **al dato
    // que le pasaron** — un efecto de lado invisible en una función que se anuncia como PURA.
    const complementoEntrada = { nombre: 'Cardigan', cantidad: 20, precio: 45 };
    const lineas = consolidarRenglonesParaProveedor([
      renglon({ cantidad: 100, precio: 185, complemento: complementoEntrada, importe: 19400 }),
      renglon({
        cantidad: 60,
        precio: 185,
        complemento: cardigan({ cantidad: 12, precio: 45 }),
        importe: 11640,
      }),
    ]);

    expect(complementoEntrada).toEqual({ nombre: 'Cardigan', cantidad: 20, precio: 45 });
    expect(lineas[0]?.complemento).not.toBe(complementoEntrada);
    expect(lineas[0]?.complemento?.cantidad).toBe(32);
  });

  it('conserva el orden de aparición del PRIMER renglón de cada grupo', () => {
    const lineas = consolidarRenglonesParaProveedor([
      renglon({ idTelaColor: 9, material: 'Rojo' }),
      renglon({ idTelaColor: 11, material: 'Marino' }),
      renglon({ idTelaColor: 9, material: 'Rojo' }),
    ]);
    expect(lineas.map((l) => l.material)).toEqual(['Rojo', 'Marino']);
  });

  it('redondea a la escala de cada columna (nada de polvo de coma flotante en el papel)', () => {
    const lineas = consolidarRenglonesParaProveedor([
      renglon({ cantidad: 0.1, importe: 0.1 }),
      renglon({ cantidad: 0.2, importe: 0.2 }),
    ]);
    expect(lineas[0]?.cantidad).toBe(0.3);
    expect(lineas[0]?.importe).toBe(0.3);
  });
});

// ── ⭐ V1-E4e — el COMPLEMENTO (Cardigan) en el papel ───────────────────────────────────────────

describe('complementoDeLinea (V1-E4e)', () => {
  const base = {
    nombreComplementoTela: 'Cardigan',
    cantidadComplemento: 20,
    precioComplemento: 45,
    precio: 185,
  };

  it('devuelve el complemento con su nombre, cantidad y precio propio', () => {
    expect(complementoDeLinea(base)).toEqual({ nombre: 'Cardigan', cantidad: 20, precio: 45 });
  });

  it('sin precio propio se cobra al precio del cuerpo (la regla del subtotal)', () => {
    expect(complementoDeLinea({ ...base, precioComplemento: null })?.precio).toBe(185);
  });

  it('🔴 vacío o EN CERO = no hay complemento (nada de renglones fantasma)', () => {
    // El caso real: las OC que genera el MRP pueden traer la cantidad sin capturar.
    expect(complementoDeLinea({ ...base, cantidadComplemento: null })).toBeNull();
    expect(complementoDeLinea({ ...base, cantidadComplemento: 0 })).toBeNull();
    expect(complementoDeLinea({ ...base, cantidadComplemento: -5 })).toBeNull();
  });

  it('sin nombre no se calla el material: lo llama "Complemento"', () => {
    expect(complementoDeLinea({ ...base, nombreComplementoTela: null })?.nombre).toBe(
      'Complemento',
    );
  });
});

describe('textosComplemento (V1-E4e)', () => {
  /** Un renglón impreso ya consolidado, con overrides. */
  function lineaImpresa(over: Partial<LineaImpresoOC> = {}): LineaImpresoOC {
    return {
      material: 'Felpa 280 · Rojo',
      cantidad: 100,
      unidad: 'kg',
      precio: 185,
      importe: 19400,
      importeCuerpo: 18500,
      complemento: { nombre: 'Cardigan', cantidad: 20, precio: 45, importe: 900 },
      matriz: [],
      ...over,
    };
  }

  it('sin complemento NO imprime nada', () => {
    expect(textosComplemento(lineaImpresa({ complemento: null }))).toBeNull();
  });

  it('dice qué más hay que surtir, con su cantidad, unidad y precio', () => {
    const textos = textosComplemento(lineaImpresa());
    expect(textos?.[0]).toBe('+ Cardigan (material adicional a surtir): 20 kg a $45.00');
  });

  it('🔴 ENSEÑA LA SUMA: cuerpo + complemento = importe del renglón', () => {
    const textos = textosComplemento(lineaImpresa());
    expect(textos?.[1]).toBe(
      'Importe del renglón: $18,500.00 de Felpa 280 · Rojo + $900.00 de Cardigan = $19,400.00',
    );
  });

  it('sin unidad no inventa una', () => {
    const textos = textosComplemento(lineaImpresa({ unidad: null }));
    expect(textos?.[0]).toBe('+ Cardigan (material adicional a surtir): 20 a $45.00');
  });
});

describe('armarDatosImpresoOC', () => {
  /** Renglón de OC tal como lo sirve `obtenerOC`, con overrides. */
  function lineaSalida(over: Partial<CompraLineaSalida> = {}): CompraLineaSalida {
    return {
      id: 1,
      idTela: 7,
      tela: 'Felpa',
      nombreComplementoTela: null,
      cantidadComplemento: null,
      precioComplemento: null,
      idAvio: null,
      avio: null,
      idAvioProveedor: null,
      idTelaColor: null,
      telaColor: null,
      pantoneTelaColor: null,
      descripcionLibre: null,
      cantidad: 30,
      cantidadSugerida: null,
      avisoDesvio: null,
      unidad: 'm',
      precio: 25,
      subtotal: 750,
      idOrden: 50,
      folioOrden: 1001,
      tallas: [],
      ...over,
    };
  }

  /** OC mínima tal como la devuelve `obtenerOC` (solo los campos que usa el impreso). */
  function compraSalida(over: Partial<CompraSalida> = {}): CompraSalida {
    return {
      id: 5,
      numCompra: 42,
      idEmpresa: 1,
      estatus: 'autorizada',
      idProveedor: 9,
      proveedor: 'Telas del Norte',
      fecha: '2026-06-20',
      fechaEntrega: '2026-07-01',
      idDireccionEntrega: 7,
      direccionEntregaNombre: 'Naucalpan',
      entregaEn: 'Bodega',
      observaciones: null,
      correspondeA: null,
      facturasAmparadasLegacy: null,
      idUsuAutorizado: 'u9',
      fechaAutorizado: '2026-06-20T10:00:00.000Z',
      canceladaEn: null,
      canceladaPorId: null,
      motivoCancelacion: null,
      lineas: [
        lineaSalida({
          tallas: [
            { idColor: 1, color: 'Rojo', idTalla: 1, etiquetaTalla: 'CH', cantidad: 10 },
            { idColor: 1, color: 'Rojo', idTalla: 2, etiquetaTalla: 'M', cantidad: 20 },
          ],
        }),
        lineaSalida({
          id: 2,
          idTela: null,
          tela: null,
          descripcionLibre: 'Flete',
          cantidad: 1,
          unidad: null,
          precio: 300,
          subtotal: 300,
          idOrden: null,
          folioOrden: null,
        }),
      ],
      ordenesLigadas: [{ idOrden: 50, folio: 1001 }],
      total: 1050,
      creadoEn: '2026-06-20T09:00:00.000Z',
      creadoPorId: 'u1',
      modificadoEn: '2026-06-20T09:00:00.000Z',
      modificadoPorId: 'u1',
      ...over,
    } as unknown as CompraSalida;
  }

  function depsCon(oc: CompraSalida): DepsImpresoOC {
    return { obtenerOC: () => Promise.resolve(oc) };
  }

  it('reúsa obtenerOC, proyecta material/importe/matriz y el total cuadra', async () => {
    const datos = await armarDatosImpresoOC(sesionConVer(), 5, undefined, depsCon(compraSalida()));

    expect(datos.empresa).toBe('FR Moda');
    expect(datos.numCompra).toBe(42);
    expect(datos.proveedor).toBe('Telas del Norte');
    expect(datos.lineas).toHaveLength(2);
    // Línea de tela: material = nombre de la tela; importe = subtotal; matriz proyectada.
    expect(datos.lineas[0]?.material).toBe('Felpa');
    expect(datos.lineas[0]?.importe).toBe(750);
    expect(datos.lineas[0]?.matriz).toEqual([
      { color: 'Rojo', talla: 'CH', cantidad: 10 },
      { color: 'Rojo', talla: 'M', cantidad: 20 },
    ]);
    // Línea libre: material = descripcionLibre; sin matriz.
    expect(datos.lineas[1]?.material).toBe('Flete');
    expect(datos.lineas[1]?.matriz).toEqual([]);
    // El total cuadra con CompraSalida.total y la suma de importes.
    expect(datos.total).toBe(1050);
    expect(datos.lineas.reduce((s, l) => s + l.importe, 0)).toBe(datos.total);

    // El PDF se genera con esos datos.
    const buffer = await generarPdfOrdenCompra(datos);
    expect(esPdf(buffer)).toBe(true);
  });

  it('material usa el avío cuando la línea es de avío', async () => {
    const oc = compraSalida({
      lineas: [
        lineaSalida({
          idTela: null,
          tela: null,
          idAvio: 3,
          avio: 'BOT-01 — Botón',
          idAvioProveedor: 3,
          cantidad: 100,
          unidad: 'pza',
          precio: 2,
          subtotal: 200,
          idOrden: null,
          folioOrden: null,
        }),
      ],
      total: 200,
    });
    const datos = await armarDatosImpresoOC(sesionConVer(), 5, undefined, depsCon(oc));
    expect(datos.lineas[0]?.material).toBe('BOT-01 — Botón');
  });

  it('propaga el ErrorNoEncontrado de obtenerOC (OC de otra empresa → 404)', async () => {
    const deps: DepsImpresoOC = {
      obtenerOC: () => Promise.reject(new ErrorNoEncontrado('OrdenCompra', 999)),
    };
    await expect(armarDatosImpresoOC(sesionConVer(), 999, undefined, deps)).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });

  // ── ⭐ §Post-F9.101 — el bloqueo, EN EL SERVIDOR ─────────────────────────────────────────────

  it('🔴 NO imprime una OC en BORRADOR (el servidor la niega, no sólo el botón escondido)', async () => {
    const oc = compraSalida({ estatus: 'borrador' });
    await expect(
      armarDatosImpresoOC(sesionConVer(), 5, undefined, depsCon(oc)),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // Y el error dice el folio y qué hacer.
    await expect(armarDatosImpresoOC(sesionConVer(), 5, undefined, depsCon(oc))).rejects.toThrow(
      /42.*autorizada/,
    );
  });

  it('🔴 NO imprime una OC pendiente de autorización', async () => {
    const oc = compraSalida({ estatus: 'pendiente_autorizacion' });
    await expect(
      armarDatosImpresoOC(sesionConVer(), 5, undefined, depsCon(oc)),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('🔴 NO imprime una OC CANCELADA (§Post-F9.101(d))', async () => {
    const oc = compraSalida({ estatus: 'cancelada', motivoCancelacion: 'duplicada' });
    await expect(armarDatosImpresoOC(sesionConVer(), 5, undefined, depsCon(oc))).rejects.toThrow(
      /cancelada/,
    );
  });

  it('SÍ imprime la autorizada y las recibidas (parcial y total)', async () => {
    for (const estatus of ['autorizada', 'recibida_parcial', 'recibida_total'] as const) {
      const datos = await armarDatosImpresoOC(
        sesionConVer(),
        5,
        undefined,
        depsCon(compraSalida({ estatus })),
      );
      expect(datos.estatus).toBe(estatus);
      expect(datos.lineas.length).toBeGreaterThan(0);
    }
  });

  // ── ⭐⭐ §Post-F9.102 — el papel del proveedor ───────────────────────────────────────────────

  it('⭐ consolida el mismo material+color pedido para DOS órdenes (el caso de la OC 7965)', async () => {
    const oc = compraSalida({
      lineas: [
        lineaSalida({
          id: 1,
          idTelaColor: 4,
          telaColor: 'Rojo',
          pantoneTelaColor: '18-1664 TCX',
          cantidad: 100,
          subtotal: 2500,
          idOrden: 50,
          folioOrden: 7001,
          tallas: [{ idColor: 4, color: 'Rojo', idTalla: 1, etiquetaTalla: 'CH', cantidad: 100 }],
        }),
        lineaSalida({
          id: 2,
          idTelaColor: 4,
          telaColor: 'Rojo',
          pantoneTelaColor: '18-1664 TCX',
          cantidad: 60,
          subtotal: 1500,
          idOrden: 51,
          folioOrden: 7002,
          tallas: [{ idColor: 4, color: 'Rojo', idTalla: 1, etiquetaTalla: 'CH', cantidad: 60 }],
        }),
      ],
      total: 4000,
    });

    const datos = await armarDatosImpresoOC(sesionConVer(), 5, undefined, depsCon(oc));

    // UN solo renglón: "todo el rojo" en una cantidad.
    expect(datos.lineas).toHaveLength(1);
    expect(datos.lineas[0]?.material).toBe('Felpa · Rojo (18-1664 TCX)');
    expect(datos.lineas[0]?.cantidad).toBe(160);
    expect(datos.lineas[0]?.importe).toBe(4000);
    expect(datos.lineas[0]?.matriz).toEqual([{ color: 'Rojo', talla: 'CH', cantidad: 160 }]);
  });

  it('🔴 el TOTAL de la OC NO cambia al consolidar (es la misma suma agrupada de otra forma)', async () => {
    const oc = compraSalida({
      lineas: [
        lineaSalida({ id: 1, cantidad: 100, subtotal: 2500, idOrden: 50, folioOrden: 7001 }),
        lineaSalida({ id: 2, cantidad: 60, subtotal: 1500, idOrden: 51, folioOrden: 7002 }),
        lineaSalida({
          id: 3,
          idTela: null,
          tela: null,
          descripcionLibre: 'Flete',
          cantidad: 1,
          unidad: null,
          precio: 300,
          subtotal: 300,
          idOrden: null,
          folioOrden: null,
        }),
      ],
      total: 4300,
    });

    const datos = await armarDatosImpresoOC(sesionConVer(), 5, undefined, depsCon(oc));

    expect(datos.lineas).toHaveLength(2); // las dos de tela fusionadas + el flete
    expect(datos.total).toBe(4300);
    expect(datos.lineas.reduce((s, l) => s + l.importe, 0)).toBe(4300);
  });

  it('🔴 NO deja ningún folio de orden de producción en el documento', async () => {
    const oc = compraSalida({
      lineas: [
        lineaSalida({ id: 1, cantidad: 100, subtotal: 2500, idOrden: 50, folioOrden: 987654 }),
        lineaSalida({ id: 2, cantidad: 60, subtotal: 1500, idOrden: 51, folioOrden: 876543 }),
      ],
      ordenesLigadas: [
        { idOrden: 50, folio: 987654 },
        { idOrden: 51, folio: 876543 },
      ],
      total: 4000,
    });

    const datos = await armarDatosImpresoOC(sesionConVer(), 5, undefined, depsCon(oc));

    // Ni en las líneas ni en el encabezado: el documento COMPLETO no menciona los folios internos.
    const documento = JSON.stringify(datos);
    expect(documento).not.toContain('987654');
    expect(documento).not.toContain('876543');
    expect(documento).not.toContain('folioOrden');
  });

  it('con PRECIOS distintos para el mismo material deja los renglones separados', async () => {
    const oc = compraSalida({
      lineas: [
        lineaSalida({ id: 1, cantidad: 100, precio: 25, subtotal: 2500 }),
        lineaSalida({ id: 2, cantidad: 60, precio: 27, subtotal: 1620 }),
      ],
      total: 4120,
    });

    const datos = await armarDatosImpresoOC(sesionConVer(), 5, undefined, depsCon(oc));

    expect(datos.lineas).toHaveLength(2);
    expect(datos.lineas.map((l) => l.precio)).toEqual([25, 27]);
    expect(datos.lineas.reduce((s, l) => s + l.importe, 0)).toBe(datos.total);
  });

  it('el complemento entra en la decisión de fusionar (mismo precio de cuerpo, distinto Cardigan)', async () => {
    const oc = compraSalida({
      lineas: [
        lineaSalida({
          id: 1,
          nombreComplementoTela: 'Cardigan',
          cantidadComplemento: 20,
          precioComplemento: 20,
          cantidad: 100,
          subtotal: 2900,
        }),
        lineaSalida({
          id: 2,
          nombreComplementoTela: 'Cardigan',
          cantidadComplemento: 20,
          precioComplemento: 22,
          cantidad: 100,
          subtotal: 2940,
        }),
      ],
      total: 5840,
    });

    const datos = await armarDatosImpresoOC(sesionConVer(), 5, undefined, depsCon(oc));

    expect(datos.lineas).toHaveLength(2);
    expect(datos.lineas.reduce((s, l) => s + l.importe, 0)).toBe(datos.total);
  });

  it('⭐ el COMPLEMENTO llega al papel desde el dato guardado, y el TOTAL no cambia', async () => {
    const oc = compraSalida({
      lineas: [
        lineaSalida({
          id: 1,
          nombreComplementoTela: 'Cardigan',
          cantidadComplemento: 20,
          precioComplemento: 45,
          cantidad: 100,
          precio: 185,
          subtotal: 19400,
          idOrden: 50,
          folioOrden: 7101,
        }),
        lineaSalida({
          id: 2,
          nombreComplementoTela: 'Cardigan',
          cantidadComplemento: 12,
          precioComplemento: 45,
          cantidad: 60,
          precio: 185,
          subtotal: 11640,
          idOrden: 51,
          folioOrden: 7102,
        }),
      ],
      total: 31040,
    });

    const datos = await armarDatosImpresoOC(sesionConVer(), 5, undefined, depsCon(oc));

    // Un renglón para el proveedor, con su Cardigan sumado.
    expect(datos.lineas).toHaveLength(1);
    expect(datos.lineas[0]?.cantidad).toBe(160);
    expect(datos.lineas[0]?.complemento?.cantidad).toBe(32);
    // 🔴 El total NO cambia: el complemento SIEMPRE estuvo dentro del importe, sólo que sin decirlo.
    expect(datos.total).toBe(31040);
    expect(datos.lineas.reduce((s, l) => s + l.importe, 0)).toBe(31040);
    // Y lo que se imprime cuadra a la vista.
    expect(textosComplemento(datos.lineas[0] as LineaImpresoOC)?.[1]).toContain('= $31,040.00');
  });

  it('con la cantidad de complemento VACÍA (OC del MRP) no se pinta complemento', async () => {
    const oc = compraSalida({
      lineas: [
        lineaSalida({
          id: 1,
          nombreComplementoTela: 'Cardigan',
          cantidadComplemento: null,
          precioComplemento: null,
          cantidad: 100,
          precio: 185,
          subtotal: 18500,
        }),
      ],
      total: 18500,
    });

    const datos = await armarDatosImpresoOC(sesionConVer(), 5, undefined, depsCon(oc));

    expect(datos.lineas[0]?.complemento).toBeNull();
    expect(datos.lineas[0]?.importeCuerpo).toBe(18500);
    expect(datos.total).toBe(18500);
  });

  it('sin precio de complemento propio, el del cuerpo: dos renglones así SÍ se fusionan', async () => {
    const oc = compraSalida({
      lineas: [
        lineaSalida({
          id: 1,
          nombreComplementoTela: 'Cardigan',
          cantidadComplemento: 20,
          precioComplemento: null,
          cantidad: 100,
          subtotal: 3000,
        }),
        lineaSalida({
          id: 2,
          nombreComplementoTela: 'Cardigan',
          cantidadComplemento: 10,
          precioComplemento: 25,
          cantidad: 50,
          subtotal: 1500,
        }),
      ],
      total: 4500,
    });

    const datos = await armarDatosImpresoOC(sesionConVer(), 5, undefined, depsCon(oc));

    // 25 (cuerpo) y `null` → el mismo precio efectivo: se suman.
    expect(datos.lineas).toHaveLength(1);
    expect(datos.lineas[0]?.cantidad).toBe(150);
    expect(datos.lineas[0]?.importe).toBe(4500);
    expect(datos.total).toBe(4500);
  });
});
