import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ExistenciasTelaColor, KardexTelaColor } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ExistenciasTelasColorPagina } from './ExistenciasTelasColorPagina';

/** Existencias agrupadas TELA PADRE → colores (una tela CON complemento y una SIN). */
const existencias: ExistenciasTelaColor = {
  telas: [
    {
      idTela: 1,
      nombre: 'Felpa Suiza',
      categoria: 'Felpa',
      idProveedor: 2,
      proveedor: 'Alsatex',
      nombreProveedor: 'Felpa Suiza',
      unidadMedida: 'KG',
      nombreCuerpo: 'Felpa',
      nombreComplemento: 'Cardigan',
      totalCuerpo: 120,
      totalComplemento: 45,
      colores: [
        {
          idTelaColor: 11,
          nombre: 'Marino Alsa 3040',
          pantone: '19-3920',
          existenciaCuerpo: 100,
          existenciaComplemento: 40,
          almacenes: [{ idAlmacen: 5, almacen: 'Bodega A', cuerpo: 100, complemento: 40 }],
        },
        {
          idTelaColor: 12,
          nombre: 'Blanco',
          pantone: null,
          existenciaCuerpo: 20,
          existenciaComplemento: 5,
          almacenes: [{ idAlmacen: 5, almacen: 'Bodega A', cuerpo: 20, complemento: 5 }],
        },
      ],
    },
    {
      idTela: 2,
      nombre: 'Lisa Algodón',
      categoria: null,
      idProveedor: null,
      proveedor: null,
      nombreProveedor: null,
      unidadMedida: 'M',
      nombreCuerpo: null,
      nombreComplemento: null,
      totalCuerpo: 33,
      totalComplemento: 0,
      colores: [
        {
          idTelaColor: 21,
          nombre: 'Negro',
          pantone: null,
          existenciaCuerpo: 33,
          existenciaComplemento: 0,
          almacenes: [{ idAlmacen: 5, almacen: 'Bodega A', cuerpo: 33, complemento: 0 }],
        },
      ],
    },
  ],
  totalCuerpo: 153,
  totalComplemento: 45,
};

const kardex: KardexTelaColor = {
  idTela: 1,
  tela: 'Felpa Suiza',
  idTelaColor: 11,
  telaColor: 'Marino Alsa 3040',
  pantone: '19-3920',
  unidadMedida: 'KG',
  nombreCuerpo: 'Felpa',
  nombreComplemento: 'Cardigan',
  renglones: [
    {
      idMovimiento: 1,
      folio: 1,
      fecha: '2026-08-06',
      idTipoMov: 1,
      tipoMov: 'Ajuste (Entrada)',
      direccion: 'entrada',
      idAlmacen: 5,
      almacen: 'Bodega A',
      idPartida: 1,
      partidaFolio: 1,
      loteProveedor: 'L-778',
      entradaCuerpo: 100,
      salidaCuerpo: 0,
      saldoCuerpo: 100,
      entradaComplemento: 40,
      salidaComplemento: 0,
      saldoComplemento: 40,
      costoUnit: null,
      costoUnitComplemento: null,
      importe: null,
      origenTipo: 'movimiento-manual',
      origenId: null,
      cancelado: false,
      observaciones: 'Conteo físico inicial',
    },
  ],
};

const useKardexTelaColor = vi.fn<(q: unknown) => unknown>();
const cancelarMutate = vi.fn();

vi.mock('@/api/inventario-materiales', () => ({
  useExistenciasTelaColor: () => ({
    data: existencias,
    isPending: false,
    isError: false,
    error: null,
  }),
  useKardexTelaColor: (q: unknown) => useKardexTelaColor(q),
  // Partidas del color (para el filtro del cajón) y cancelación (inverso auditado).
  usePartidasTela: () => ({
    data: {
      datos: [
        {
          id: 1,
          folio: 1,
          idTelaColor: 11,
          telaColor: 'Marino Alsa 3040',
          idTela: 1,
          tela: 'Felpa Suiza',
          loteProveedor: 'L-778',
          factura: null,
          fecha: '2026-08-06',
          creadoEn: '2026-08-06T12:00:00.000Z',
        },
      ],
    },
    isPending: false,
    isError: false,
  }),
  useCancelarTelaColor: () => ({ mutate: cancelarMutate, isPending: false }),
}));
// `etiquetaUnidadTela` salió de la pantalla a `@/api/telas` para que todas escriban igual la
// unidad (kg/m) — el mock la incluye porque la tabla la usa en cada renglón.
vi.mock('@/api/telas', () => ({
  useTelasCategorias: () => ({ data: { datos: [] } }),
  etiquetaUnidadTela: (unidad: 'KG' | 'M') => (unidad === 'KG' ? 'kg' : 'm'),
}));
vi.mock('@/api/proveedores', () => ({ useProveedores: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/almacenes', () => ({ useAlmacenes: () => ({ data: { datos: [] } }) }));

describe('ExistenciasTelasColorPagina (A2 — inventario nuevo por color)', () => {
  it('agrupa TELA PADRE → colores con cuerpo y complemento juntos', () => {
    useKardexTelaColor.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    // Tabla (escritorio) y tarjetas (móvil) montadas a la vez (la visibilidad es de Tailwind).
    expect(screen.getByTestId('telas-color-tabla')).toBeInTheDocument();
    expect(screen.getByTestId('telas-color-tarjetas')).toBeInTheDocument();
    // Las telas padre y sus colores (arrancan desplegadas).
    expect(screen.getAllByText('Felpa Suiza').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Marino Alsa 3040').length).toBeGreaterThan(0);
    // El pantone del color se ve.
    expect(screen.getAllByText('19-3920').length).toBeGreaterThan(0);
    // Totales del pie (cuerpo y complemento).
    expect(screen.getByText('Cuerpo:')).toBeInTheDocument();
    expect(screen.getByText('Complemento:')).toBeInTheDocument();
  });

  it('la tela SIN complemento muestra "—" en esa columna', () => {
    useKardexTelaColor.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    const filaNegro = screen.getByTestId('telas-color-fila-21');
    expect(filaNegro).toHaveTextContent('—');
  });

  it('colapsa y re-expande los colores de una tela con el toggle', () => {
    useKardexTelaColor.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    expect(screen.getByTestId('telas-color-fila-11')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('telas-color-toggle-1'));
    expect(screen.queryByTestId('telas-color-fila-11')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('telas-color-toggle-1'));
    expect(screen.getByTestId('telas-color-fila-11')).toBeInTheDocument();
  });

  it('el botón de kardex (y el doble clic) abren el cajón con el saldo de ambos componentes', () => {
    useKardexTelaColor.mockImplementation((q) =>
      q === undefined
        ? { data: undefined, isPending: true, isError: false }
        : { data: kardex, isPending: false, isError: false },
    );
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    // El botón explícito (móvil y escritorio)…
    const [botonKardex] = screen.getAllByLabelText('Kardex de Felpa Suiza Marino Alsa 3040');
    expect(botonKardex).toBeDefined();
    if (botonKardex === undefined) return; // estrecha el tipo (sin `!`)
    fireEvent.click(botonKardex);
    // …abre el cajón con el kardex del color (partida + saldos corridos).
    expect(screen.getByText('Kardex · Felpa Suiza · Marino Alsa 3040')).toBeInTheDocument();
    expect(screen.getByTestId('kardex-color-tabla')).toBeInTheDocument();
    expect(screen.getByText('#1 · L-778')).toBeInTheDocument();
    // La consulta se pidió con el color correcto.
    expect(useKardexTelaColor).toHaveBeenCalledWith(expect.objectContaining({ idTelaColor: 11 }));
  });

  it('con permiso de mover, el kardex ofrece cancelar (inverso auditado) y filtrar por partida', () => {
    useKardexTelaColor.mockImplementation((q) =>
      q === undefined
        ? { data: undefined, isPending: true, isError: false }
        : { data: kardex, isPending: false, isError: false },
    );
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-telas.mover']),
    });
    fireEvent.doubleClick(screen.getByTestId('telas-color-fila-11'));
    // El filtro por partida está montado con la partida del color.
    expect(screen.getByTestId('kardex-color-partida')).toBeInTheDocument();
    expect(screen.getByText('Partida #1 · L-778')).toBeInTheDocument();
    // El botón de cancelar abre el diálogo (motivo obligatorio) y dispara la mutación.
    fireEvent.click(screen.getByTestId('kardex-color-cancelar-1'));
    fireEvent.change(screen.getByTestId('mat-motivo-cancelar'), {
      target: { value: 'Captura equivocada' },
    });
    fireEvent.click(screen.getByTestId('confirmar-cancelar-material'));
    expect(cancelarMutate).toHaveBeenCalledWith(
      { id: 1, cuerpo: { motivo: 'Captura equivocada' } },
      expect.anything(),
    );
  });

  it('sin permiso de mover, el kardex NO ofrece cancelar', () => {
    useKardexTelaColor.mockImplementation((q) =>
      q === undefined
        ? { data: undefined, isPending: true, isError: false }
        : { data: kardex, isPending: false, isError: false },
    );
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.doubleClick(screen.getByTestId('telas-color-fila-11'));
    expect(screen.queryByTestId('kardex-color-cancelar-1')).not.toBeInTheDocument();
  });

  it('el doble clic en el renglón del color también abre el kardex', () => {
    useKardexTelaColor.mockImplementation((q) =>
      q === undefined
        ? { data: undefined, isPending: true, isError: false }
        : { data: kardex, isPending: false, isError: false },
    );
    renderConProveedores(<ExistenciasTelasColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.doubleClick(screen.getByTestId('telas-color-fila-11'));
    expect(screen.getByText('Kardex · Felpa Suiza · Marino Alsa 3040')).toBeInTheDocument();
  });
});
