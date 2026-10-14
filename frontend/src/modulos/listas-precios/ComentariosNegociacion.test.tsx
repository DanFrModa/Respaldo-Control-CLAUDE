import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComentarioNegociacion } from '@/api/negociacion';
import type { ClavePermiso } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ComentariosNegociacion } from './ComentariosNegociacion';

/**
 * ⭐⭐ Fila 0.238 (§Post-F9.248(b)) — la sección de COMENTARIOS de la negociación de una lista.
 * Presentación pura: lo que se mide es qué se pinta (quién, cuándo, texto, modelo), a quién se le
 * ofrece el cuadro y QUÉ se le manda al servidor.
 */

const comentarMutate = vi.fn();
const comentariosMock = vi.fn();

vi.mock('@/api/negociacion', () => ({
  useComentariosLista: (idLista: number | null) => comentariosMock(idLista) as unknown,
  useComentarNegociacion: () => ({ mutate: comentarMutate, isPending: false }),
}));

const COMENTARIOS: ComentarioNegociacion[] = [
  {
    id: 1,
    idLista: 3,
    idListaLinea: null,
    codigoModelo: null,
    texto: 'El cliente quiere ver la muestra',
    registradoPorId: 'u-aurora',
    nombreRegistradoPor: 'Aurora',
    registradoEn: '2026-10-10T16:00:00.000Z',
  },
  {
    id: 2,
    idLista: 3,
    idListaLinea: 91,
    codigoModelo: 'KM-114',
    texto: 'Lo quiere en dos colores',
    registradoPorId: 'u-dueno',
    nombreRegistradoPor: 'Daniel',
    registradoEn: '2026-10-11T16:00:00.000Z',
  },
];

const LINEAS = [
  { id: 91, codigoModelo: 'KM-114' },
  { id: 92, codigoModelo: 'KM-115' },
];

function pintar(permisos: ClavePermiso[]): void {
  renderConProveedores(<ComentariosNegociacion idLista={3} lineas={LINEAS} />, {
    sesion: estadoSesionDePrueba(permisos),
  });
}

describe('⭐⭐ 0.238 — ComentariosNegociacion', () => {
  beforeEach(() => {
    comentarMutate.mockReset();
    comentariosMock.mockReset();
    comentariosMock.mockReturnValue({ data: COMENTARIOS, isPending: false, isError: false });
  });

  it('pinta cada comentario con su autor, su texto y el modelo al que apunta', () => {
    pintar(['listas.ver']);

    expect(comentariosMock).toHaveBeenCalledWith(3);
    const items = screen.getAllByTestId('comentario-negociacion');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Aurora');
    expect(items[0]).toHaveTextContent('El cliente quiere ver la muestra');
    expect(items[0]).not.toHaveTextContent('KM-114');
    expect(items[1]).toHaveTextContent('Daniel');
    expect(items[1]).toHaveTextContent('KM-114');
    // Inmutables: ni lápiz ni bote de basura.
    expect(screen.queryByRole('button', { name: /editar|borrar|eliminar/i })).toBeNull();
  });

  it('sin comentarios lo DICE en vez de pintar una caja vacía', () => {
    comentariosMock.mockReturnValue({ data: [], isPending: false, isError: false });
    pintar(['listas.ver']);
    expect(screen.getByTestId('comentarios-vacio')).toBeInTheDocument();
  });

  it('⛔ con sólo `listas.ver` NO se ofrece el cuadro para comentar', () => {
    pintar(['listas.ver']);
    expect(screen.queryByTestId('nuevo-comentario')).not.toBeInTheDocument();
  });

  it('⭐ con `listas.comentar` comenta a la LISTA entera (idLinea null)', async () => {
    const usuario = userEvent.setup();
    pintar(['listas.ver', 'listas.comentar']);

    expect(screen.getByTestId('agregar-comentario')).toBeDisabled();
    await usuario.type(screen.getByTestId('comentario-texto'), '  Pide bajar a 110  ');
    await usuario.click(screen.getByTestId('agregar-comentario'));

    expect(comentarMutate).toHaveBeenCalledWith(
      { idLista: 3, cuerpo: { texto: 'Pide bajar a 110', idLinea: null } },
      expect.anything(),
    );
  });

  it('⭐ con `listas.negociar` también comenta, y puede dirigirlo a UN modelo', async () => {
    const usuario = userEvent.setup();
    pintar(['listas.ver', 'listas.negociar']);

    await usuario.type(screen.getByTestId('comentario-texto'), 'Sólo en azul');
    await usuario.selectOptions(screen.getByTestId('comentario-modelo'), '92');
    await usuario.click(screen.getByTestId('agregar-comentario'));

    expect(comentarMutate).toHaveBeenCalledWith(
      { idLista: 3, cuerpo: { texto: 'Sólo en azul', idLinea: 92 } },
      expect.anything(),
    );
  });
});
