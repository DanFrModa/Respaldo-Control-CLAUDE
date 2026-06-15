import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SubidaImagen } from './SubidaImagen';

/**
 * Pruebas del componente REUTILIZABLE `SubidaImagen` (lo reutilizará F1-E4). Es
 * autonomo (sin contrato ni red): se prueba con callbacks espia. Cubre: placeholder
 * cuando no hay imagen, preview cuando si, elegir un archivo valido (llama al callback),
 * rechazo de tipo y de tamaño (NO llama al callback, muestra error), el boton quitar
 * (solo si hay imagen y `alQuitar`), y los estados deshabilitado/subiendo.
 */

/** Crea un `File` de prueba con tipo y tamaño dados (rellena el contenido). */
function archivoDePrueba(nombre: string, tipo: string, bytes: number): File {
  const contenido = new Uint8Array(bytes);
  return new File([contenido], nombre, { type: tipo });
}

describe('<SubidaImagen>', () => {
  it('muestra el placeholder NoFoto cuando no hay imagen', () => {
    render(<SubidaImagen urlImagen={null} textoAlt="Sin imagen" alElegirArchivo={vi.fn()} />);
    expect(screen.getByTestId('placeholder-imagen')).toBeInTheDocument();
    expect(screen.queryByTestId('imagen-imagen')).not.toBeInTheDocument();
  });

  it('muestra la imagen (preview) cuando hay url', () => {
    render(
      <SubidaImagen
        urlImagen="https://r2.fake/get/foto.jpg"
        textoAlt="Mi bordado"
        alElegirArchivo={vi.fn()}
      />,
    );
    const img = screen.getByTestId('imagen-imagen');
    expect(img).toHaveAttribute('src', 'https://r2.fake/get/foto.jpg');
    expect(img).toHaveAttribute('alt', 'Mi bordado');
  });

  it('al elegir una imagen válida llama a alElegirArchivo con el File', async () => {
    const usuario = userEvent.setup();
    const alElegir = vi.fn();
    render(<SubidaImagen urlImagen={null} textoAlt="x" alElegirArchivo={alElegir} testid="foto" />);

    const input = screen.getByTestId('archivo-foto');
    await usuario.upload(input, archivoDePrueba('logo.png', 'image/png', 1024));

    expect(alElegir).toHaveBeenCalledTimes(1);
    expect(alElegir.mock.calls[0]?.[0]).toBeInstanceOf(File);
  });

  it('rechaza un archivo que no es imagen: no llama al callback y muestra error', () => {
    const alElegir = vi.fn();
    render(<SubidaImagen urlImagen={null} textoAlt="x" alElegirArchivo={alElegir} testid="foto" />);

    // `userEvent.upload` respeta el `accept` del input (no dispararía un PDF), así que
    // se dispara el change directo para ejercitar la validación de tipo del handler.
    const input = screen.getByTestId('archivo-foto');
    fireEvent.change(input, {
      target: { files: [archivoDePrueba('doc.pdf', 'application/pdf', 1024)] },
    });

    expect(alElegir).not.toHaveBeenCalled();
    expect(screen.getByTestId('error-foto')).toBeInTheDocument();
  });

  it('rechaza una imagen demasiado grande (tope de tamaño)', async () => {
    const usuario = userEvent.setup();
    const alElegir = vi.fn();
    render(
      <SubidaImagen
        urlImagen={null}
        textoAlt="x"
        alElegirArchivo={alElegir}
        tamanoMaximoBytes={1000}
        testid="foto"
      />,
    );

    await usuario.upload(
      screen.getByTestId('archivo-foto'),
      archivoDePrueba('grande.jpg', 'image/jpeg', 2000),
    );

    expect(alElegir).not.toHaveBeenCalled();
    expect(screen.getByTestId('error-foto')).toHaveTextContent('muy grande');
  });

  it('muestra el botón quitar solo si hay imagen y alQuitar; lo llama al pulsar', async () => {
    const usuario = userEvent.setup();
    const alQuitar = vi.fn();
    const { rerender } = render(
      <SubidaImagen
        urlImagen={null}
        textoAlt="x"
        alElegirArchivo={vi.fn()}
        alQuitar={alQuitar}
        testid="foto"
      />,
    );
    // Sin imagen: no hay boton quitar.
    expect(screen.queryByTestId('quitar-foto')).not.toBeInTheDocument();

    // Con imagen: aparece y al pulsarlo llama a alQuitar.
    rerender(
      <SubidaImagen
        urlImagen="https://r2.fake/get/foto.jpg"
        textoAlt="x"
        alElegirArchivo={vi.fn()}
        alQuitar={alQuitar}
        testid="foto"
      />,
    );
    await usuario.click(screen.getByTestId('quitar-foto'));
    expect(alQuitar).toHaveBeenCalledTimes(1);
  });

  it('no muestra el botón quitar si no se pasa alQuitar (p. ej. en alta)', () => {
    render(
      <SubidaImagen
        urlImagen="https://r2.fake/get/foto.jpg"
        textoAlt="x"
        alElegirArchivo={vi.fn()}
        testid="foto"
      />,
    );
    expect(screen.queryByTestId('quitar-foto')).not.toBeInTheDocument();
  });

  it('deshabilita los controles cuando deshabilitado o subiendo', () => {
    const { rerender } = render(
      <SubidaImagen
        urlImagen={null}
        textoAlt="x"
        alElegirArchivo={vi.fn()}
        deshabilitado
        testid="foto"
      />,
    );
    expect(screen.getByTestId('subir-foto')).toBeDisabled();
    expect(screen.getByTestId('archivo-foto')).toBeDisabled();

    rerender(
      <SubidaImagen
        urlImagen={null}
        textoAlt="x"
        alElegirArchivo={vi.fn()}
        subiendo
        testid="foto"
      />,
    );
    expect(screen.getByTestId('subir-foto')).toBeDisabled();
    expect(screen.getByTestId('subir-foto')).toHaveTextContent('Subiendo…');
  });

  it('muestra el mensaje de error externo (del padre) si se pasa', () => {
    render(
      <SubidaImagen
        urlImagen={null}
        textoAlt="x"
        alElegirArchivo={vi.fn()}
        error="No se pudo cargar la foto."
        testid="foto"
      />,
    );
    expect(screen.getByTestId('error-foto')).toHaveTextContent('No se pudo cargar la foto.');
  });
});
