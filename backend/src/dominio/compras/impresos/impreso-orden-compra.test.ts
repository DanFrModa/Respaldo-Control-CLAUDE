/**
 * Pruebas unitarias del impreso de la orden de compra (F4-E2). No tocan BD: ejercitan
 *  • `generarPdfOrdenCompra` — devuelve un Buffer PDF real (cabecera `%PDF`), incluso con matriz,
 *    OC cancelada, líneas libres, sin renglones o con facturasAmparadasLegacy.
 *  • `armarDatosImpresoOC` — reúsa `obtenerOC` (inyectado), proyecta material/importe/matriz y el
 *    total CUADRA con CompraSalida.total; propaga el 404 de `obtenerOC` (A9).
 */
import { describe, expect, it } from 'vitest';

import { ErrorNoEncontrado } from '../../../comun/errores.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { CompraSalida } from '../../../contrato/index.js';

import {
  armarDatosImpresoOC,
  generarPdfOrdenCompra,
  type DatosImpresoOC,
  type DepsImpresoOC,
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
        folioOrden: 1001,
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
        folioOrden: null,
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

  it('renderiza sin renglones (OC vacía)', async () => {
    const buffer = await generarPdfOrdenCompra(datosBase({ lineas: [], total: 0 }));
    expect(esPdf(buffer)).toBe(true);
  });
});

describe('armarDatosImpresoOC', () => {
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
        {
          id: 1,
          idTela: 7,
          tela: 'Felpa',
          idAvio: null,
          avio: null,
          idAvioProveedor: null,
          descripcionLibre: null,
          cantidad: 30,
          unidad: 'm',
          precio: 25,
          subtotal: 750,
          idOrden: 50,
          folioOrden: 1001,
          tallas: [
            { idColor: 1, color: 'Rojo', idTalla: 1, etiquetaTalla: 'CH', cantidad: 10 },
            { idColor: 1, color: 'Rojo', idTalla: 2, etiquetaTalla: 'M', cantidad: 20 },
          ],
        },
        {
          id: 2,
          idTela: null,
          tela: null,
          idAvio: null,
          avio: null,
          idAvioProveedor: null,
          descripcionLibre: 'Flete',
          cantidad: 1,
          unidad: null,
          precio: 300,
          subtotal: 300,
          idOrden: null,
          folioOrden: null,
          tallas: [],
        },
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
    expect(datos.lineas[0]?.folioOrden).toBe(1001);
    expect(datos.lineas[0]?.matriz).toEqual([
      { color: 'Rojo', talla: 'CH', cantidad: 10 },
      { color: 'Rojo', talla: 'M', cantidad: 20 },
    ]);
    // Línea libre: material = descripcionLibre; sin matriz; sin orden.
    expect(datos.lineas[1]?.material).toBe('Flete');
    expect(datos.lineas[1]?.matriz).toEqual([]);
    expect(datos.lineas[1]?.folioOrden).toBeNull();
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
        {
          id: 1,
          idTela: null,
          tela: null,
          nombreComplementoTela: null,
          cantidadComplemento: null,
          precioComplemento: null,
          idAvio: 3,
          avio: 'BOT-01 — Botón',
          idAvioProveedor: 3,
          descripcionLibre: null,
          cantidad: 100,
          unidad: 'pza',
          precio: 2,
          subtotal: 200,
          idOrden: null,
          folioOrden: null,
          tallas: [],
        },
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
});
