import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

/**
 * ⭐ Fila 0.242 — la consulta de REFERENCIAS CAMBIADAS: enseña cambios y sobreprecios en una sola
 * lista (en un sobreprecio, «De» es la referencia y «A» el precio autorizado) y manda los filtros tal
 * cual al servidor. La capa de datos va simulada.
 */
const estado = vi.hoisted((): { ultimaQuery: unknown } => ({ ultimaQuery: null }));

vi.mock('@/api/referencias-maquila', () => ({
  useReferenciasCambiadas: (query: unknown) => {
    estado.ultimaQuery = query;
    return {
      data: {
        limite: 500,
        truncado: false,
        eventos: [
          {
            id: 2,
            idOrden: 9,
            folioOrden: 5424,
            idTipoProceso: 1,
            proceso: 'Costura',
            accion: 'sobreprecio',
            referenciaAnterior: null,
            referenciaNueva: 10,
            precioAutorizado: 12,
            punto: 'envio',
            nota: null,
            capturadoPor: 'Daniel Masri',
            capturadoEn: '2026-10-02T12:00:00.000Z',
          },
          {
            id: 1,
            idOrden: 9,
            folioOrden: 5424,
            idTipoProceso: 1,
            proceso: 'Costura',
            accion: 'captura',
            referenciaAnterior: 8,
            referenciaNueva: 10,
            precioAutorizado: null,
            punto: null,
            nota: 'renegociado',
            capturadoPor: 'Producción',
            capturadoEn: '2026-10-01T12:00:00.000Z',
          },
        ],
      },
      isPending: false,
      isError: false,
    };
  },
}));

const { ReferenciasCambiadasPagina } = await import('./ReferenciasCambiadasPagina');

describe('ReferenciasCambiadasPagina (fila 0.242)', () => {
  it('lista cambios y sobreprecios: de cuánto a cuánto, quién y dónde', () => {
    renderConProveedores(<ReferenciasCambiadasPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.autorizar-sobreprecio']),
    });
    const [sobre, cambio] = screen.getAllByTestId('referencias-fila');
    expect(sobre).toHaveTextContent('Sobreprecio autorizado (salida a maquila)');
    expect(sobre).toHaveTextContent('$10.00');
    expect(sobre).toHaveTextContent('$12.00');
    expect(cambio).toHaveTextContent('Referencia cambiada');
    expect(cambio).toHaveTextContent('$8.00');
    expect(cambio).toHaveTextContent('renegociado');
    expect(cambio).toHaveTextContent('Producción');
  });

  it('los filtros viajan al servidor (folio y sólo sobreprecios)', () => {
    renderConProveedores(<ReferenciasCambiadasPagina />, {
      sesion: estadoSesionDePrueba(['ordenes.autorizar-sobreprecio']),
    });
    fireEvent.change(screen.getByTestId('referencias-filtro-folio'), { target: { value: '5424' } });
    fireEvent.click(screen.getByTestId('referencias-solo-sobreprecios'));
    expect(estado.ultimaQuery).toEqual({ folio: 5424, soloSobreprecios: 'true' });
  });
});
