/**
 * Pruebas unitarias del impreso de la EXPLOSIÓN de materiales (F4-E4). No tocan BD: ejercitan
 *  • `generarPdfExplosion` — devuelve un Buffer PDF real (cabecera `%PDF`), incluso con grupos
 *    vacíos, genéricos y sin proveedor.
 *  • `armarDatosImpresoExplosion` — reúsa `explosionarOrden` (inyectado), proyecta los grupos y
 *    propaga el 404 (A9).
 */
import { describe, expect, it } from 'vitest';

import { ErrorNoEncontrado } from '../../../comun/errores.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ExplosionSalida } from '../../../contrato/index.js';

import {
  armarDatosImpresoExplosion,
  generarPdfExplosion,
  type DepsImpresoExplosion,
} from './impreso-explosion.js';

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

function explosionBase(over: Partial<ExplosionSalida> = {}): ExplosionSalida {
  return {
    // V1-E3q (§Post-F9.86): la explosión ya es de un CONJUNTO de OP; con una sola, un elemento.
    ordenes: [
      {
        idOrden: 50,
        folio: 1001,
        idModelo: 9,
        modelo: 'A-100',
        totalPiezas: 30,
        idPedido: null,
        folioPedido: null,
        fechaEntrega: null,
      },
    ],
    idOrden: 50,
    folioOrden: 1001,
    idModelo: 9,
    modelo: 'A-100',
    totalPiezas: 30,
    huboCambios: false,
    regenerado: false,
    avisos: [],
    // V1-E3d: la explosión trae la desalineación contra el BOM vivo (el impreso no la pinta).
    desalineacion: { hayCambios: false, conOrdenCompra: false, critico: false, cambios: [] },
    // V1-E3h: y lo que quedó sin firmar (tampoco va al impreso: es de la pantalla del comprador).
    pendientesLiberar: [],
    // V1-E3u: tampoco va al impreso (es de la pantalla del comprador).
    pendientesColor: [],
    grupos: [
      {
        idProveedor: 7,
        proveedor: 'Avíos Baratos',
        renglones: [
          {
            id: 1,
            tipo: 'avio',
            idTela: null,
            idAvio: 3,
            idTelaColor: null,
            telaColor: null,
            idColorPrenda: null,
            colorPrenda: null,
            medidas: [],
            material: 'BOT-01 — Botón',
            cantidadRequerida: 180,
            unidad: 'pza',
            esGenerico: false,
            estadoGenerico: 'no-aplica',
            existenciaStock: 0,
            cantidadAComprar: 180,
            idProveedorSugerido: 7,
            proveedorSugerido: 'Avíos Baratos',
            precioSugerido: 2,
            // V1-E3m: de dónde salió el proveedor (el impreso no lo pinta; el contrato sí lo pide).
            origenProveedor: 'habitual',
            proveedorSugeridoInactivo: false,
            diff: 'sin-cambio',
            cambiosReceta: [],
            avisos: [],
            // V1-E3q: el neteo contra lo ya comprado + el reparto por OP.
            cantidadEnOc: 0,
            cantidadEnOcSinColor: 0,
            cantidadCubierta: 0,
            cantidadPendiente: 180,
            idsRequerimiento: [1],
            porOrden: [],
          },
        ],
      },
      {
        idProveedor: null,
        proveedor: 'Sin proveedor sugerido',
        renglones: [
          {
            id: 2,
            tipo: 'tela',
            idTelaColor: null,
            telaColor: null,
            idColorPrenda: null,
            colorPrenda: null,
            medidas: [],
            idTela: 4,
            idAvio: null,
            material: 'Felpa',
            cantidadRequerida: 45,
            unidad: 'm',
            esGenerico: false,
            estadoGenerico: 'no-aplica',
            existenciaStock: 0,
            cantidadAComprar: 45,
            idProveedorSugerido: null,
            proveedorSugerido: null,
            precioSugerido: null,
            origenProveedor: 'sin-proveedor',
            proveedorSugeridoInactivo: false,
            diff: 'sin-cambio',
            cambiosReceta: [],
            avisos: [],
            // V1-E3q: el neteo contra lo ya comprado + el reparto por OP.
            cantidadEnOc: 0,
            cantidadEnOcSinColor: 0,
            cantidadCubierta: 0,
            cantidadPendiente: 45,
            idsRequerimiento: [2],
            porOrden: [],
          },
        ],
      },
    ],
    ...over,
  };
}

function esPdf(buffer: Buffer): boolean {
  return buffer.length > 0 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

describe('generarPdfExplosion', () => {
  it('devuelve un Buffer no vacío con cabecera %PDF', async () => {
    const buffer = await generarPdfExplosion(
      await armarDatosImpresoExplosion(sesionConVer(), 50, undefined, {
        explosionarOrden: () => Promise.resolve(explosionBase()),
      }),
    );
    expect(esPdf(buffer)).toBe(true);
  });

  it('renderiza sin grupos (orden sin requerimientos)', async () => {
    const datos = await armarDatosImpresoExplosion(sesionConVer(), 50, undefined, {
      explosionarOrden: () => Promise.resolve(explosionBase({ grupos: [] })),
    });
    expect(esPdf(await generarPdfExplosion(datos))).toBe(true);
  });
});

describe('armarDatosImpresoExplosion', () => {
  it('reúsa explosionarOrden y proyecta los grupos', async () => {
    const datos = await armarDatosImpresoExplosion(sesionConVer(), 50, undefined, {
      explosionarOrden: () => Promise.resolve(explosionBase()),
    });
    expect(datos.empresa).toBe('FR Moda');
    expect(datos.folioOrden).toBe(1001);
    expect(datos.modelo).toBe('A-100');
    expect(datos.grupos).toHaveLength(2);
    expect(datos.grupos[0]?.lineas[0]?.material).toBe('BOT-01 — Botón');
    expect(datos.grupos[0]?.lineas[0]?.aComprar).toBe(180);
  });

  /**
   * ⭐ V1-E3q (§Post-F9.85) — el papel no puede decir otra cosa que la pantalla. Un impreso hecho
   * DESPUÉS de generar la OC tiene que enseñar lo que **de verdad falta**, no la demanda bruta:
   * *"compra 180"* de algo ya pedido es el mismo defecto de Daniel, pero sin nadie que lo
   * contradiga. 🔴 Con `cantidadAComprar` en la proyección, esto daría 180 y saldría rojo.
   */
  it('⭐ la columna "A comprar" trae lo PENDIENTE, no lo ya comprado', async () => {
    const base = explosionBase();
    const datos = await armarDatosImpresoExplosion(sesionConVer(), 50, undefined, {
      explosionarOrden: () =>
        Promise.resolve({
          ...base,
          grupos: base.grupos.map((g) => ({
            ...g,
            renglones: g.renglones.map((r) =>
              r.id === 1 ? { ...r, cantidadEnOc: 120, cantidadPendiente: 60 } : r,
            ),
          })),
        }),
    });
    expect(datos.grupos[0]?.lineas[0]?.aComprar).toBe(60);
    // Y el REQUERIDO no se toca: el impreso sigue diciendo cuánto lleva la orden en total.
    expect(datos.grupos[0]?.lineas[0]?.requerido).toBe(180);
  });

  it('propaga el ErrorNoEncontrado de explosionarOrden (orden de otra empresa → 404)', async () => {
    const deps: DepsImpresoExplosion = {
      explosionarOrden: () => Promise.reject(new ErrorNoEncontrado('Orden', 999)),
    };
    await expect(
      armarDatosImpresoExplosion(sesionConVer(), 999, undefined, deps),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});
