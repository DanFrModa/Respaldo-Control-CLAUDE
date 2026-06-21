import type { OrdenCompra } from '@/api/tipos';

/**
 * Fixtures de OC para las pruebas de componente del módulo Órdenes de compra (F4-E2). Construye una
 * OC con valores por defecto razonables, sobrescribibles por prueba.
 */
export function ocDePrueba(sobrescribir: Partial<OrdenCompra> = {}): OrdenCompra {
  return {
    id: 1,
    numCompra: 1001,
    idEmpresa: 1,
    estatus: 'borrador',
    idProveedor: 5,
    proveedor: 'Telas del Norte',
    fecha: '2026-06-20',
    fechaEntrega: '2026-06-30',
    entregaEn: 'Almacén central',
    observaciones: null,
    correspondeA: null,
    facturasAmparadasLegacy: null,
    idUsuAutorizado: null,
    fechaAutorizado: null,
    canceladaEn: null,
    canceladaPorId: null,
    motivoCancelacion: null,
    lineas: [
      {
        id: 10,
        idTela: 3,
        tela: 'Felpa francesa',
        idAvio: null,
        avio: null,
        idAvioProveedor: null,
        descripcionLibre: null,
        cantidad: 100,
        unidad: 'm',
        precio: 25,
        subtotal: 2500,
        idOrden: null,
        folioOrden: null,
        tallas: [],
      },
    ],
    ordenesLigadas: [],
    total: 2500,
    creadoEn: '2026-06-20T10:00:00.000Z',
    creadoPorId: 'u1',
    modificadoEn: '2026-06-20T10:00:00.000Z',
    modificadoPorId: 'u1',
    ...sobrescribir,
  };
}
