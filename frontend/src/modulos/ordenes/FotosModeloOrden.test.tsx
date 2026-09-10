import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrdenAdjunto } from '@/api/adjuntos-orden';
import type { OrdenFotoOculta } from '@/api/fotos-ocultas-orden';
import type { ModeloFoto } from '@/api/modelos';
import { renderConProveedores } from '@/pruebas/utilidades';

import { FotosModeloOrden } from './FotosModeloOrden';

/**
 * Pruebas de `<FotosModeloOrden>` (ajuste jul-2026 + §Post-F9.169(b)): una TIRA de MINIATURAS que
 * COMBINA fotos del modelo + imágenes subidas a la orden; clic abre el visor NAVEGABLE; con permiso
 * se puede subir/quitar fotos de la orden y **QUITAR de esta OP las heredadas del modelo** (sin
 * borrarlas del modelo, y con vuelta atrás). La capa de datos va simulada (sin red).
 */
const useFotosModelo = vi.fn<() => { data: ModeloFoto[] | undefined }>();
const useAdjuntosOrden = vi.fn<() => { data: OrdenAdjunto[] | undefined }>();
const useFotosOcultasOrden = vi.fn<() => { data: OrdenFotoOculta[] | undefined }>();
const subirMutate = vi.fn();
const quitarMutate = vi.fn();
const ocultarMutate = vi.fn();
const mostrarMutate = vi.fn();

vi.mock('@/api/modelos', () => ({
  useFotosModelo: () => useFotosModelo(),
}));
vi.mock('@/api/adjuntos-orden', () => ({
  useAdjuntosOrden: () => useAdjuntosOrden(),
  useSubirAdjuntoOrden: () => ({ mutate: subirMutate, isPending: false }),
  useQuitarAdjuntoOrden: () => ({ mutate: quitarMutate, isPending: false }),
}));
vi.mock('@/api/fotos-ocultas-orden', () => ({
  useFotosOcultasOrden: () => useFotosOcultasOrden(),
  useOcultarFotoModeloOrden: () => ({ mutate: ocultarMutate, isPending: false }),
  useMostrarFotoModeloOrden: () => ({ mutate: mostrarMutate, isPending: false }),
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
    nombreSubidoPor: 'Daniel Masri',
  };
}

describe('<FotosModeloOrden>', () => {
  beforeEach(() => {
    useFotosModelo.mockReset();
    useAdjuntosOrden.mockReset();
    useFotosOcultasOrden.mockReset();
    subirMutate.mockReset();
    quitarMutate.mockReset();
    ocultarMutate.mockReset();
    mostrarMutate.mockReset();
    useFotosModelo.mockReturnValue({ data: [] });
    useAdjuntosOrden.mockReturnValue({ data: [] });
    // Por omisión la OP no quitó ninguna foto del modelo: el caso normal, y el que describen todas
    // las expectativas históricas de este archivo.
    useFotosOcultasOrden.mockReturnValue({ data: [] });
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

  it('el BORRADO (papelera) es solo para las imágenes de la orden, nunca para las del modelo', async () => {
    const usuario = userEvent.setup();
    useFotosModelo.mockReturnValue({ data: [fotoModelo(1, 'https://ej.test/m1.jpg')] });
    useAdjuntosOrden.mockReturnValue({
      data: [adjunto('img1', 'image/png', 'https://ej.test/o1.png')],
    });
    renderConProveedores(
      <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={42} puedeAdministrar />,
    );

    // Solo hay UNA papelera (la de la imagen de la orden). La del modelo lleva otro botón, el de
    // QUITARLA de esta OP (§Post-F9.169(b)) — que no borra nada.
    expect(screen.getAllByTestId('quitar-foto-orden')).toHaveLength(1);
    expect(screen.getAllByTestId('ocultar-foto-modelo-orden')).toHaveLength(1);
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

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ⭐ §Post-F9.169(b) — QUITAR de la OP una foto HEREDADA del modelo (sin borrarla del modelo)
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  describe('quitar de la OP una foto heredada del modelo', () => {
    /** Las dos fotos del modelo + una imagen subida a la orden: el escenario completo. */
    function conDosFotosDelModelo(): void {
      useFotosModelo.mockReturnValue({
        data: [fotoModelo(1, 'https://ej.test/m1.jpg'), fotoModelo(2, 'https://ej.test/m2.jpg')],
      });
    }

    it('quien SOLO MIRA no ve la foto que esta OP quitó (ni en la tira ni en el visor)', () => {
      conDosFotosDelModelo();
      useFotosOcultasOrden.mockReturnValue({
        data: [{ idModeloFoto: 1, ocultadaEn: '2026-09-01T00:00:00Z' }],
      });
      renderConProveedores(
        <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={9} puedeAdministrar={false} />,
      );

      const miniaturas = screen.getAllByTestId('foto-modelo-orden');
      expect(miniaturas).toHaveLength(1);
      // La que queda es la SEGUNDA (la quitada no se coló apagada ni de ninguna otra forma).
      expect(screen.getByRole('img', { name: 'Foto de 501' })).toHaveAttribute(
        'src',
        'https://ej.test/m2.jpg',
      );
      expect(screen.queryByTestId('foto-modelo-orden-oculta')).not.toBeInTheDocument();
    });

    it('quien ADMINISTRA la sigue viendo APAGADA, con su botón de traerla de vuelta', () => {
      conDosFotosDelModelo();
      useFotosOcultasOrden.mockReturnValue({
        data: [{ idModeloFoto: 1, ocultadaEn: '2026-09-01T00:00:00Z' }],
      });
      renderConProveedores(
        <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={9} puedeAdministrar />,
      );

      // Las DOS siguen en la tira, y solo una lleva el distintivo de "quitada de esta orden".
      expect(screen.getAllByTestId('foto-modelo-orden')).toHaveLength(2);
      expect(screen.getAllByTestId('foto-modelo-orden-oculta')).toHaveLength(1);
      // Reversible: la quitada ofrece VOLVER, y ya no ofrece quitarse otra vez.
      expect(screen.getAllByTestId('mostrar-foto-modelo-orden')).toHaveLength(1);
      // La otra (viva) sí ofrece quitarse: hay exactamente UN botón de quitar, no dos.
      expect(screen.getAllByTestId('ocultar-foto-modelo-orden')).toHaveLength(1);
      // Y el texto accesible dice cuál es cuál (no solo un icono apagado).
      expect(screen.getByAltText('Foto de 501 quitada de esta orden')).toBeInTheDocument();
    });

    it('quitarla llama a la mutación con {idOrden, idModeloFoto} y NO borra nada (no toca R2)', async () => {
      const usuario = userEvent.setup();
      useFotosModelo.mockReturnValue({ data: [fotoModelo(7, 'https://ej.test/m7.jpg')] });
      renderConProveedores(
        <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={42} puedeAdministrar />,
      );

      await usuario.click(screen.getByTestId('ocultar-foto-modelo-orden'));

      expect(ocultarMutate).toHaveBeenCalledTimes(1);
      expect(ocultarMutate.mock.calls[0]?.[0]).toEqual({ idOrden: 42, idModeloFoto: 7 });
      // ⭐ LO QUE **NO** PASA: no se borró ningún archivo de la orden (esa es la vía que sí toca R2)
      // ni se llamó a la vuelta atrás. Quitar de la OP es SOLO poner la marca.
      expect(quitarMutate).not.toHaveBeenCalled();
      expect(mostrarMutate).not.toHaveBeenCalled();
    });

    it('traerla de vuelta llama a la OTRA mutación (la rama gemela, con su propio botón)', async () => {
      const usuario = userEvent.setup();
      useFotosModelo.mockReturnValue({ data: [fotoModelo(7, 'https://ej.test/m7.jpg')] });
      useFotosOcultasOrden.mockReturnValue({
        data: [{ idModeloFoto: 7, ocultadaEn: '2026-09-01T00:00:00Z' }],
      });
      renderConProveedores(
        <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={42} puedeAdministrar />,
      );

      await usuario.click(screen.getByTestId('mostrar-foto-modelo-orden'));

      expect(mostrarMutate).toHaveBeenCalledTimes(1);
      expect(mostrarMutate.mock.calls[0]?.[0]).toEqual({ idOrden: 42, idModeloFoto: 7 });
      expect(ocultarMutate).not.toHaveBeenCalled();
      expect(quitarMutate).not.toHaveBeenCalled();
    });

    it('SER PRINCIPAL NO SE TRANSFIERE: si se quita la principal, la segunda NO hereda la estrella', () => {
      conDosFotosDelModelo();
      useFotosOcultasOrden.mockReturnValue({
        data: [{ idModeloFoto: 1, ocultadaEn: '2026-09-01T00:00:00Z' }],
      });
      renderConProveedores(
        <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={9} puedeAdministrar={false} />,
      );

      // La única que queda es la segunda, y NO lleva estrella: esta OP se queda sin principal.
      expect(screen.getAllByTestId('foto-modelo-orden')).toHaveLength(1);
      expect(screen.queryByTestId('foto-modelo-orden-principal')).not.toBeInTheDocument();
      expect(screen.queryByAltText('Foto principal de 501')).not.toBeInTheDocument();
    });

    it('una principal quitada conserva SU estrella para quien administra (no se le quita al modelo)', () => {
      conDosFotosDelModelo();
      useFotosOcultasOrden.mockReturnValue({
        data: [{ idModeloFoto: 1, ocultadaEn: '2026-09-01T00:00:00Z' }],
      });
      renderConProveedores(
        <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={9} puedeAdministrar />,
      );

      // Sigue siendo la principal DEL MODELO (quitarla de la OP no la desmarca, D3): lleva las dos
      // marcas a la vez, estrella y "quitada", en la MISMA miniatura.
      const distintivo = screen.getByTestId('foto-modelo-orden-principal');
      const marcaOculta = screen.getByTestId('foto-modelo-orden-oculta');
      expect(distintivo.parentElement).toBe(marcaOculta.parentElement);
    });

    it('sin idOrden (captura) no se puede quitar nada de la OP, ni con permiso', () => {
      conDosFotosDelModelo();
      renderConProveedores(<FotosModeloOrden idModelo={1} codigoModelo="501" puedeAdministrar />);

      expect(screen.getAllByTestId('foto-modelo-orden')).toHaveLength(2);
      expect(screen.queryByTestId('ocultar-foto-modelo-orden')).not.toBeInTheDocument();
      expect(screen.queryByTestId('mostrar-foto-modelo-orden')).not.toBeInTheDocument();
    });

    it('sin permiso NO aparece el botón de quitar la foto del modelo', () => {
      conDosFotosDelModelo();
      renderConProveedores(
        <FotosModeloOrden idModelo={1} codigoModelo="501" idOrden={9} puedeAdministrar={false} />,
      );
      expect(screen.queryByTestId('ocultar-foto-modelo-orden')).not.toBeInTheDocument();
    });
  });
});
