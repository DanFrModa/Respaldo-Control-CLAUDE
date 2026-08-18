import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HabilitacionOrden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { PanelHabilitacionOrden } from './PanelHabilitacionOrden';

// ── Mocks (sin red) ──────────────────────────────────────────────────────────
const useHabilitacionOrdenMock = vi.fn();
vi.mock('@/api/habilitacion', () => ({
  useHabilitacionOrden: (id: unknown, o: unknown) => useHabilitacionOrdenMock(id, o) as unknown,
}));
// El "Pasar a nota" abre el constructor; se simplifica (sus hooks no interesan aquí).
vi.mock('./DialogoEditarNota', () => ({ DialogoEditarNota: () => null }));

function habDePrueba(over: Partial<HabilitacionOrden> = {}): HabilitacionOrden {
  return {
    idOrden: 50,
    folioOrden: 1001,
    idModelo: 5,
    modelo: 'MOD-1',
    totalPiezas: 30,
    idMaquilero: 9,
    maquilero: 'Costuras del Bajío',
    porcentajeGlobal: 55.5,
    totalRequerido: 240,
    totalEnviado: 133,
    completos: 1,
    parciales: 1,
    pendientes: 1,
    faltaTotal: 140,
    faltanAvios: 2,
    aviosSinMedida: 0,
    avios: [
      {
        idAvio: 3,
        clave: 'BOT-01',
        descripcion: 'Botón',
        unidad: 'pza',
        esGenerico: false,
        requerido: 180,
        enviado: 100,
        falta: 80,
        porcentaje: 55.5,
        esExtra: false,
        estado: 'parcial',
        consumoPorTalla: false,
        tallasSinMedida: [],
      },
      {
        idAvio: 4,
        clave: 'HIL-01',
        descripcion: 'Hilo',
        unidad: 'm',
        esGenerico: true,
        requerido: 60,
        enviado: 0,
        falta: 60,
        porcentaje: 0,
        esExtra: false,
        estado: 'pendiente',
        consumoPorTalla: false,
        tallasSinMedida: [],
      },
      {
        idAvio: 6,
        clave: 'ELA-01',
        descripcion: 'Elástico',
        unidad: 'm',
        esGenerico: false,
        requerido: 50,
        enviado: 60,
        falta: 0,
        porcentaje: 120,
        esExtra: false,
        estado: 'sobre-surtido',
        consumoPorTalla: false,
        tallasSinMedida: [],
      },
      {
        idAvio: 5,
        clave: 'ZIP-01',
        descripcion: 'Cierre',
        unidad: 'pza',
        esGenerico: false,
        requerido: 0,
        enviado: 20,
        falta: 0,
        porcentaje: 100,
        esExtra: true,
        estado: 'extra',
        consumoPorTalla: false,
        tallasSinMedida: [],
      },
    ],
    ...over,
  };
}

function renderPanel(sesionPermisos = ['notas.ver', 'notas.administrar']) {
  return renderConProveedores(
    <PanelHabilitacionOrden idOrden={50} abierto alCerrar={() => undefined} />,
    { sesion: estadoSesionDePrueba(sesionPermisos as never) },
  );
}

describe('PanelHabilitacionOrden (R6, B13)', () => {
  beforeEach(() => {
    useHabilitacionOrdenMock.mockReset();
  });

  it('muestra el % global, un renglón por avío y el estado de cada uno', () => {
    useHabilitacionOrdenMock.mockReturnValue({ data: habDePrueba(), isPending: false });
    renderPanel();

    expect(screen.getByTestId('hab-pct-global')).toHaveTextContent('56%'); // 55.5 → 56
    expect(screen.getAllByTestId('surtido-fila')).toHaveLength(4);
    // El sobre-surtido y el extra son estados VÁLIDOS visibles.
    const estados = screen.getAllByTestId('surtido-estado').map((e) => e.textContent);
    expect(estados).toContain('Sobre-surtido');
    expect(estados).toContain('Extra');
    expect(screen.getByTestId('hab-aviso-extra')).toBeInTheDocument();
  });

  it('⭐ §Post-F9.64: avisa (sin bloquear) las tallas de la orden sin medida capturada', () => {
    useHabilitacionOrdenMock.mockReturnValue({
      data: habDePrueba({
        aviosSinMedida: 1,
        avios: [
          {
            idAvio: 3,
            clave: 'ELA-01',
            descripcion: 'Elástico',
            unidad: 'm',
            esGenerico: false,
            requerido: 70,
            enviado: 0,
            falta: 70,
            porcentaje: 0,
            esExtra: false,
            estado: 'pendiente',
            consumoPorTalla: true,
            tallasSinMedida: ['M', 'G'],
          },
        ],
      }),
      isPending: false,
    });
    renderPanel();

    expect(screen.getByTestId('hab-sin-medida')).toHaveTextContent('M, G');
    expect(screen.getByTestId('hab-sin-medida-total')).toHaveTextContent('1');
    // AVISA, NO BLOQUEA: el renglón se puede marcar y pasar a nota igual.
    fireEvent.click(screen.getByLabelText('Surtir ELA-01'));
    expect(screen.getByTestId('hab-pasar-nota')).toBeEnabled();
  });

  it('sin tallas faltantes no aparece ningún aviso (no mete ruido)', () => {
    useHabilitacionOrdenMock.mockReturnValue({ data: habDePrueba(), isPending: false });
    renderPanel();
    expect(screen.queryByTestId('hab-sin-medida')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hab-sin-medida-total')).not.toBeInTheDocument();
  });

  it('"Pasar a nota" arranca deshabilitado y se habilita al marcar un renglón', () => {
    useHabilitacionOrdenMock.mockReturnValue({ data: habDePrueba(), isPending: false });
    renderPanel();

    const pasar = screen.getByTestId('hab-pasar-nota');
    expect(pasar).toBeDisabled();

    // Marcar el botón (trae su "A surtir" = falta pre-cargado) habilita el botón con el conteo.
    fireEvent.click(screen.getByLabelText('Surtir BOT-01'));
    expect(pasar).toBeEnabled();
    expect(pasar).toHaveTextContent('(1)');
  });

  it('escribir una cantidad en "A surtir" auto-marca el renglón (re-envío)', () => {
    useHabilitacionOrdenMock.mockReturnValue({ data: habDePrueba(), isPending: false });
    renderPanel();

    // El elástico está sobre-surtido (falta 0, A surtir vacío): escribir una cantidad lo marca (re-envío).
    const chk = screen.getByLabelText('Surtir ELA-01');
    expect(chk).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('A surtir de ELA-01'), { target: { value: '10' } });
    expect(chk).toBeChecked();
    expect(screen.getByTestId('hab-pasar-nota')).toBeEnabled();
  });

  it('sin notas.administrar NO ofrece "Pasar a nota"', () => {
    useHabilitacionOrdenMock.mockReturnValue({ data: habDePrueba(), isPending: false });
    renderPanel(['notas.ver']);
    expect(screen.queryByTestId('hab-pasar-nota')).not.toBeInTheDocument();
    // Pero sí puede consultar y ver las notas de la orden.
    expect(screen.getByTestId('hab-ver-notas')).toBeInTheDocument();
  });
});
