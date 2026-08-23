import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '@/components/ui/button';

import { CajonDetalle } from './CajonDetalle';

describe('<CajonDetalle>', () => {
  it('abierto muestra encabezado (titulo + subtitulo + acciones) y cuerpo', () => {
    render(
      <CajonDetalle
        abierto
        alCambiarAbierto={() => undefined}
        titulo="OP-1024 · Playera polo"
        subtitulo="Corte del 3 de julio"
        acciones={<Button size="sm">Imprimir</Button>}
      >
        <p>Contenido del detalle</p>
      </CajonDetalle>,
    );
    expect(screen.getByText('OP-1024 · Playera polo')).toBeInTheDocument();
    expect(screen.getByText('Corte del 3 de julio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeInTheDocument();
    expect(screen.getByText('Contenido del detalle')).toBeInTheDocument();
  });

  it('cerrado no monta el contenido', () => {
    render(
      <CajonDetalle abierto={false} alCambiarAbierto={() => undefined} titulo="Oculto">
        <p>Nada que ver</p>
      </CajonDetalle>,
    );
    expect(screen.queryByText('Nada que ver')).not.toBeInTheDocument();
  });

  it('al cerrar (X del sheet) avisa con `alCambiarAbierto(false)`', async () => {
    const usuario = userEvent.setup();
    const alCambiar = vi.fn();
    render(
      <CajonDetalle abierto alCambiarAbierto={alCambiar} titulo="Con cierre">
        <p>Cuerpo</p>
      </CajonDetalle>,
    );
    await usuario.click(screen.getByRole('button', { name: 'Close' }));
    expect(alCambiar).toHaveBeenCalledWith(false);
  });
});
