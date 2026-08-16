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

import { calcularDesalineacion } from './receta-orden.js';

/** Renglón de tela de la receta, alineado con el modelo salvo lo que se pise. */
function tela(over: Partial<RecetaOrdenTela> = {}): RecetaOrdenTela {
  return {
    id: 1,
    tipo: 'tela',
    estado: 'revisado',
    agregadoAMano: false,
    excluido: false,
    notas: null,
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
    enElModelo: true,
    cambios: [],
    idModeloArte: 5,
    nombre: 'Logo pecho',
    descripcion: null,
    puntadas: null,
    tipo_arte: 'BORDADO',
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
      [{ tipo: 'avio', material: 'E01 — Etiqueta de lavado' }],
      false,
    );
    expect(d.cambios).toEqual([
      {
        tipo: 'avio',
        idRenglon: null,
        material: 'E01 — Etiqueta de lavado',
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
