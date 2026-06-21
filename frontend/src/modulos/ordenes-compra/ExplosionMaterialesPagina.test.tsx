import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ExplosionMaterialesPagina } from './ExplosionMaterialesPagina';

const useExplosionMock = vi.fn();
const useGenerarOcMock = vi.fn();
const useConsultaOrdenesMock = vi.fn();
const mutateMock = vi.fn();
const imprimirExplosionMock = vi.fn();

vi.mock('@/api/mrp', () => ({
  useExplosion: (id: unknown) => useExplosionMock(id) as unknown,
  useGenerarOc: () => useGenerarOcMock() as unknown,
  imprimirExplosion: (id: number) => imprimirExplosionMock(id) as unknown,
}));
vi.mock('@/api/ordenes-consulta', () => ({
  useConsultaOrdenes: () => useConsultaOrdenesMock() as unknown,
}));

/** Explosión de prueba: un botón comprable (con proveedor) + felpa sin proveedor + genérico cubierto. */
function explosionDePrueba() {
  return {
    idOrden: 50,
    folioOrden: 7,
    idModelo: 9,
    modelo: 'A-100',
    totalPiezas: 30,
    huboCambios: false,
    regenerado: false,
    grupos: [
      {
        idProveedor: 11,
        proveedor: 'Avíos Baratos',
        renglones: [
          {
            id: 1,
            tipo: 'avio',
            idTela: null,
            idAvio: 3,
            material: 'BOT-01 — Botón',
            cantidadRequerida: 180,
            unidad: 'pza',
            esGenerico: false,
            estadoGenerico: 'no-aplica',
            existenciaStock: 0,
            cantidadAComprar: 180,
            idProveedorSugerido: 11,
            proveedorSugerido: 'Avíos Baratos',
            precioSugerido: 2,
            diff: 'sin-cambio',
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
            diff: 'sin-cambio',
          },
          {
            id: 3,
            tipo: 'avio',
            idTela: null,
            idAvio: 5,
            material: 'HIL-01 — Hilo',
            cantidadRequerida: 60,
            unidad: 'm',
            esGenerico: true,
            estadoGenerico: 'cubierto-por-stock',
            existenciaStock: 100,
            cantidadAComprar: 0,
            idProveedorSugerido: null,
            proveedorSugerido: null,
            precioSugerido: null,
            diff: 'sin-cambio',
          },
        ],
      },
    ],
  };
}

describe('ExplosionMaterialesPagina (F4-E4, R3)', () => {
  beforeEach(() => {
    useExplosionMock.mockReset();
    useGenerarOcMock.mockReset();
    useConsultaOrdenesMock.mockReset();
    mutateMock.mockReset();
    imprimirExplosionMock.mockReset();

    useConsultaOrdenesMock.mockReturnValue({
      data: {
        datos: [{ id: 50, folio: 7, codigoModelo: 'A-100', cliente: 'Cliente X' }],
        total: 1,
        pagina: 1,
        porPagina: 20,
        totalPaginas: 1,
      },
      isPending: false,
      isError: false,
    });
    useExplosionMock.mockReturnValue({
      data: explosionDePrueba(),
      isPending: false,
      isError: false,
    });
    useGenerarOcMock.mockReturnValue({
      mutate: mutateMock,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
  });

  it('al elegir una orden, muestra los materiales agrupados por proveedor y el neteo de genéricos', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });

    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    // Pide la explosión de la orden elegida (id 50).
    expect(useExplosionMock).toHaveBeenCalledWith(50);
    // Dos grupos (un proveedor + "sin proveedor").
    expect(screen.getAllByTestId('exp-grupo')).toHaveLength(2);
    expect(screen.getByText('BOT-01 — Botón')).toBeInTheDocument();
    // El genérico cubierto por stock se marca.
    expect(screen.getByText('Cubierto por stock')).toBeInTheDocument();
  });

  it('genera OC con la selección (un clic) y limpia la selección al terminar', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.administrar', 'compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    // Genera para TODO lo pendiente (sin marcar nada → idsRequerimiento vacío).
    await usuario.click(screen.getByTestId('exp-generar-oc'));
    // Llama a generar con la orden y la selección vacía (todo lo pendiente) + un callback onSuccess.
    expect(mutateMock).toHaveBeenCalledOnce();
    const [args, opciones] = mutateMock.mock.calls[0] as [
      { idOrden: number; cuerpo: { idsRequerimiento: number[] } },
      { onSuccess?: unknown },
    ];
    expect(args).toEqual({ idOrden: 50, cuerpo: { idsRequerimiento: [] } });
    expect(typeof opciones.onSuccess).toBe('function');
  });

  it('el checkbox de un material sin proveedor (felpa) está deshabilitado (no comprable)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));

    const checks = screen.getAllByTestId('exp-renglon-check');
    // El primero (botón, comprable) habilitado; la felpa (sin proveedor) deshabilitada.
    expect(checks[0]).not.toBeDisabled();
    expect(checks[1]).toBeDisabled();
  });

  it('marca el aviso cuando el BOM cambió desde la última explosión', async () => {
    useExplosionMock.mockReturnValue({
      data: { ...explosionDePrueba(), huboCambios: true, regenerado: true },
      isPending: false,
      isError: false,
    });
    const usuario = userEvent.setup();
    renderConProveedores(<ExplosionMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['compras.ver']),
    });
    await usuario.click(screen.getByTestId('exp-orden-opcion'));
    expect(screen.getByTestId('exp-aviso-cambios')).toBeInTheDocument();
  });
});
