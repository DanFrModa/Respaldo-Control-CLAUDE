import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrdenAdjunto } from '@/api/adjuntos-orden';
import type { ModeloFoto } from '@/api/modelos';
import { renderConProveedores } from '@/pruebas/utilidades';

import { FotosModeloOrden } from './FotosModeloOrden';

/**
 * Pruebas de `<FotosModeloOrden>` (ajuste jul-2026): una TIRA de MINIATURAS que COMBINA fotos del
 * modelo + imágenes subidas a la orden; clic abre el visor NAVEGABLE; con permiso se puede
 * subir/quitar fotos de la orden. La capa de datos va simulada (sin red).
 */
const useFotosModelo = vi.fn<() => { data: ModeloFoto[] | undefined }>();
const useAdjuntosOrden = vi.fn<() => { data: OrdenAdjunto[] | undefined }>();
const subirMutate = vi.fn();
const quitarMutate = vi.fn();

vi.mock('@/api/modelos', () => ({
  useFotosModelo: () => useFotosModelo(),
}));
vi.mock('@/api/adjuntos-orden', () => ({
  useAdjuntosOrden: () => useAdjuntosOrden(),
  useSubirAdjuntoOrden: () => ({ mutate: subirMutate, isPending: false }),
  useQuitarAdjuntoOrden: () => ({ mutate: quitarMutate, isPending: false }),
}));

function fotoModelo(idFoto: number, url: string): ModeloFoto {
  return {
    idFoto,
    idArchivo: `arch-${idFoto}`,
    tipo: 'OTRO',
    orden: idFoto,
    nombreOriginal: 'f.jpg',
    tipoMime: 'image/jpeg',
    tamanoBytes: 100,
    urlDescarga: url,
  };
}

function adjunto(idArchivo: string, tipoMime: string, url: string): OrdenAdjunto {
  return {
    idArchivo,
    nombreOriginal: `${idArchivo}.bin`,
    tipoMime,
    urlDescarga: url,
    tamanoBytes: 100,
    creadoEn: '2026-07-18T00:00:00Z',
    subidoPorId: 'u1',
  };
}

describe('<FotosModeloOrden>', () => {
  beforeEach(() => {
    useFotosModelo.mockReset();
    useAdjuntosOrden.mockReset();
    subirMutate.mockReset();
    quitarMutate.mockReset();
    useFotosModelo.mockReturnValue({ data: [] });
    useAdjuntosOrden.mockReturnValue({ data: [] });
  });

  it('no pinta nada sin fotos y sin permiso', () => {
    const { container } = renderConProveedores(
      <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={9} puedeAdministrar={false} />,
    );
    expect(screen.queryByTestId('fotos-modelo-orden')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('sin fotos pero con permiso muestra SOLO el tile de subir (para tener al menos una)', () => {
    renderConProveedores(
      <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={9} puedeAdministrar />,
    );
    expect(screen.getByTestId('subir-foto-orden')).toBeInTheDocument();
    expect(screen.queryAllByTestId('foto-modelo-orden')).toHaveLength(0);
  });

  it('COMBINA fotos del modelo + imágenes de la orden, y FILTRA los adjuntos no-imagen (PDF)', () => {
    useFotosModelo.mockReturnValue({ data: [fotoModelo(1, 'https://ej.test/m1.jpg')] });
    useAdjuntosOrden.mockReturnValue({
      data: [
        adjunto('img1', 'image/png', 'https://ej.test/o1.png'),
        adjunto('doc1', 'application/pdf', 'https://ej.test/o1.pdf'),
      ],
    });
    renderConProveedores(
      <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={9} puedeAdministrar={false} />,
    );

    const tira = screen.getAllByTestId('foto-modelo-orden');
    // 1 del modelo + 1 imagen de la orden (el PDF NO cuenta).
    expect(tira).toHaveLength(2);
    expect(tira[0]).toHaveAttribute('data-origen', 'modelo');
    expect(tira[1]).toHaveAttribute('data-origen', 'orden');
  });

  it('clic en una miniatura abre el visor y se NAVEGA entre todas', async () => {
    const usuario = userEvent.setup();
    useFotosModelo.mockReturnValue({ data: [fotoModelo(1, 'https://ej.test/m1.jpg')] });
    useAdjuntosOrden.mockReturnValue({
      data: [adjunto('img1', 'image/png', 'https://ej.test/o1.png')],
    });
    renderConProveedores(
      <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={9} puedeAdministrar={false} />,
    );

    await usuario.click(screen.getByRole('button', { name: 'Ver foto 1 de 501 ampliada' }));
    expect(screen.getByTestId('imagen-foto-orden')).toHaveAttribute(
      'src',
      'https://ej.test/m1.jpg',
    );
    expect(screen.getByTestId('visor-foto-orden-posicion')).toHaveTextContent('1 / 2');
    // En la primera, no hay anterior.
    expect(screen.getByTestId('visor-foto-orden-anterior')).toBeDisabled();

    await usuario.click(screen.getByTestId('visor-foto-orden-siguiente'));
    expect(screen.getByTestId('imagen-foto-orden')).toHaveAttribute(
      'src',
      'https://ej.test/o1.png',
    );
    expect(screen.getByTestId('visor-foto-orden-posicion')).toHaveTextContent('2 / 2');
  });

  it('subir una imagen a la orden llama al hook con {idOrden, archivo}', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={42} puedeAdministrar />,
    );
    const archivo = new File(['x'], 'foto.png', { type: 'image/png' });
    await usuario.upload(screen.getByTestId('foto-orden-archivo'), archivo);

    expect(subirMutate).toHaveBeenCalledTimes(1);
    expect(subirMutate.mock.calls[0]?.[0]).toEqual({ idOrden: 42, archivo });
  });

  it('permite QUITAR una imagen de la orden, pero NO las del modelo', async () => {
    const usuario = userEvent.setup();
    useFotosModelo.mockReturnValue({ data: [fotoModelo(1, 'https://ej.test/m1.jpg')] });
    useAdjuntosOrden.mockReturnValue({
      data: [adjunto('img1', 'image/png', 'https://ej.test/o1.png')],
    });
    renderConProveedores(
      <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={42} puedeAdministrar />,
    );

    // Solo hay UN botón de quitar (el de la imagen de la orden; la del modelo no lo tiene).
    expect(screen.getAllByTestId('quitar-foto-orden')).toHaveLength(1);
    await usuario.click(screen.getByTestId('quitar-foto-orden'));
    expect(quitarMutate).toHaveBeenCalledTimes(1);
    expect(quitarMutate.mock.calls[0]?.[0]).toEqual({ idOrden: 42, idArchivo: 'img1' });
  });

  it('el tile de subir NO aparece sin permiso', () => {
    useFotosModelo.mockReturnValue({ data: [fotoModelo(1, 'https://ej.test/m1.jpg')] });
    renderConProveedores(
      <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={9} puedeAdministrar={false} />,
    );
    expect(screen.queryByTestId('subir-foto-orden')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quitar-foto-orden')).not.toBeInTheDocument();
  });

  // FOTO PRINCIPAL del modelo (Daniel, 25-jul-2026): es la PRIMERA de la galería del modelo, abre
  // la tira y lleva su distintivo; las imágenes de la ORDEN nunca son "la principal del modelo".
  it('marca la PRIMERA foto del modelo como principal y la pone al frente de la tira', () => {
    useFotosModelo.mockReturnValue({
      data: [fotoModelo(1, 'https://ej.test/m1.jpg'), fotoModelo(2, 'https://ej.test/m2.jpg')],
    });
    useAdjuntosOrden.mockReturnValue({
      data: [adjunto('img1', 'image/png', 'https://ej.test/o1.png')],
    });
    renderConProveedores(
      <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={9} puedeAdministrar={false} />,
    );

    // Un solo distintivo, y está en la PRIMERA miniatura de la tira.
    const distintivos = screen.getAllByTestId('foto-modelo-orden-principal');
    expect(distintivos).toHaveLength(1);
    const miniaturas = screen.getAllByTestId('foto-modelo-orden');
    expect(miniaturas[0]?.parentElement).toContainElement(distintivos[0] ?? null);
    // El texto accesible dice cuál es (no solo un icono de color).
    expect(screen.getByAltText('Foto principal de 501')).toBeInTheDocument();
    expect(screen.getAllByAltText('Foto de 501')).toHaveLength(2);
  });

  it('sin fotos del modelo, ninguna imagen de la ORDEN se marca como principal', () => {
    useAdjuntosOrden.mockReturnValue({
      data: [adjunto('img1', 'image/png', 'https://ej.test/o1.png')],
    });
    renderConProveedores(
      <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={9} puedeAdministrar={false} />,
    );
    expect(screen.getAllByTestId('foto-modelo-orden')).toHaveLength(1);
    expect(screen.queryByTestId('foto-modelo-orden-principal')).not.toBeInTheDocument();
  });
});
