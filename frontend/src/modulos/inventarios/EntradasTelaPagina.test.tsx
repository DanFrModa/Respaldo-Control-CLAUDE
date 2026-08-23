import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

/**
 * Pruebas de la lista de ENTRADAS DE TELA por factura/remisión (etapa B1). Verifican lo que decide
 * la UI: qué acciones ofrece el cajón según el ESTADO del documento (editar/confirmar sólo en
 * borrador; cancelar mientras no esté cancelada), que confirmar y cancelar llamen al API con lo
 * correcto, y que sin `inventario-telas.mover` no se ofrezca ninguna escritura (el backend
 * re-decide, A1).
 */

const useEntradasTelaMock = vi.fn();
const confirmarMutate = vi.fn();
const cancelarMutate = vi.fn();

vi.mock('@/api/entradas-tela', () => ({
  useEntradasTela: (q: unknown) => useEntradasTelaMock(q) as unknown,
  useConfirmarEntradaTela: () => ({ mutate: confirmarMutate, isPending: false }),
  useCancelarEntradaTela: () => ({ mutate: cancelarMutate, isPending: false }),
  useAdjuntosEntradaTela: () => ({ data: [], isPending: false, isError: false }),
  useSubirAdjuntoEntradaTela: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarAdjuntoEntradaTela: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { EntradasTelaPagina } = await import('./EntradasTelaPagina');

/** Documento de prueba (borrador por defecto). */
function entradaDePrueba(extras: Record<string, unknown> = {}) {
  return {
    id: 5,
    folio: 12,
    idEmpresa: 1,
    tipoDocumento: 'factura',
    numeroDocumento: 'A-1001',
    idProveedor: 3,
    proveedor: 'Textiles del Norte',
    fecha: '2026-08-06',
    idAlmacen: 2,
    almacen: 'Bodega Telas',
    observaciones: null,
    estatus: 'borrador',
    idMovimiento: null,
    folioMovimiento: null,
    confirmadaEn: null,
    confirmadaPorId: null,
    canceladaEn: null,
    canceladaPorId: null,
    motivoCancelacion: null,
    lineas: [
      {
        id: 51,
        idTela: 7,
        tela: 'Felpa Suiza',
        idTelaColor: 71,
        telaColor: 'Marino',
        pantone: '19-3920',
        unidadMedida: 'KG',
        nombreCuerpo: 'Felpa',
        nombreComplemento: 'Cardigan',
        cantidad: 300,
        cantidadComplemento: 45,
        precioUnit: 90,
        precioUnitComplemento: 120,
        importe: 32400,
        loteProveedor: 'L-A',
        idPartida: null,
        partidaFolio: null,
      },
    ],
    totalCuerpo: 300,
    totalComplemento: 45,
    totalImporte: 32400,
    numeroAdjuntos: 0,
    avisos: [],
    creadoEn: '2026-08-06T10:00:00.000Z',
    creadoPorId: null,
    ...extras,
  };
}

function pagina(datos: unknown[]) {
  return {
    data: { datos, total: datos.length, pagina: 1, porPagina: 20, totalPaginas: 1 },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
}

describe('EntradasTelaPagina (B1)', () => {
  beforeEach(() => {
    useEntradasTelaMock.mockReset();
    confirmarMutate.mockReset();
    cancelarMutate.mockReset();
    useEntradasTelaMock.mockReturnValue(pagina([entradaDePrueba()]));
  });

  it('lista los documentos con su folio, factura y estado', () => {
    renderConProveedores(<EntradasTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    const fila = screen.getByTestId('fila-entrada-5');
    expect(within(fila).getByText('12')).toBeInTheDocument();
    expect(within(fila).getByText('A-1001')).toBeInTheDocument();
    expect(within(fila).getByText('Borrador')).toBeInTheDocument();
  });

  it('el cajón de un BORRADOR ofrece editar y confirmar, y confirmar llama al API', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EntradasTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    await usuario.click(screen.getByTestId('fila-entrada-5'));

    expect(screen.getByTestId('entrada-editar')).toBeInTheDocument();
    // Las partidas del documento se ven en el cajón.
    expect(screen.getByText('Felpa Suiza')).toBeInTheDocument();

    await usuario.click(screen.getByTestId('entrada-confirmar'));
    expect(confirmarMutate).toHaveBeenCalledTimes(1);
    expect(confirmarMutate.mock.calls[0]?.[0]).toBe(5);
  });

  it('una CONFIRMADA ya no se edita ni se re-confirma; sólo se cancela (con motivo)', async () => {
    const usuario = userEvent.setup();
    useEntradasTelaMock.mockReturnValue(
      pagina([entradaDePrueba({ estatus: 'confirmada', idMovimiento: 44, folioMovimiento: 9 })]),
    );
    const preguntar = vi.spyOn(window, 'prompt').mockReturnValue('la factura venía mal');
    renderConProveedores(<EntradasTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    await usuario.click(screen.getByTestId('fila-entrada-5'));

    expect(screen.queryByTestId('entrada-editar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('entrada-confirmar')).not.toBeInTheDocument();
    // La traza del movimiento de kardex se muestra.
    expect(screen.getByText(/Movimiento de kardex #9/)).toBeInTheDocument();

    await usuario.click(screen.getByTestId('entrada-cancelar'));
    expect(cancelarMutate).toHaveBeenCalledTimes(1);
    expect(cancelarMutate.mock.calls[0]?.[0]).toMatchObject({
      id: 5,
      cuerpo: { motivo: 'la factura venía mal' },
    });
    preguntar.mockRestore();
  });

  it('B1: el AVISO de factura repetida se ve en el cajón (informa, no bloquea)', async () => {
    const usuario = userEvent.setup();
    useEntradasTelaMock.mockReturnValue(
      pagina([
        entradaDePrueba({
          avisos: [
            'Ojo: ya hay otra entrada de este proveedor con el documento "A-1001" (folio 7).',
          ],
        }),
      ]),
    );
    renderConProveedores(<EntradasTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    await usuario.click(screen.getByTestId('fila-entrada-5'));
    expect(screen.getByTestId('entrada-aviso')).toHaveTextContent('A-1001');
    // Sigue pudiéndose confirmar (es un aviso, no un bloqueo).
    expect(screen.getByTestId('entrada-confirmar')).toBeEnabled();
  });

  it('una CANCELADA no ofrece ninguna acción y muestra el motivo', async () => {
    const usuario = userEvent.setup();
    useEntradasTelaMock.mockReturnValue(
      pagina([entradaDePrueba({ estatus: 'cancelada', motivoCancelacion: 'devuelta' })]),
    );
    renderConProveedores(<EntradasTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    await usuario.click(screen.getByTestId('fila-entrada-5'));
    expect(screen.queryByTestId('entrada-confirmar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('entrada-cancelar')).not.toBeInTheDocument();
    expect(screen.getByText(/Cancelada: devuelta/)).toBeInTheDocument();
  });

  it('sin `inventario-telas.mover` no se ofrece capturar ni confirmar (solo lectura)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EntradasTelaPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    expect(screen.queryByTestId('nueva-entrada-tela')).not.toBeInTheDocument();
    await usuario.click(screen.getByTestId('fila-entrada-5'));
    expect(screen.queryByTestId('entrada-confirmar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('entrada-cancelar')).not.toBeInTheDocument();
  });
});
