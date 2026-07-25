import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Empresa, EmpresaLogo } from '@/api/tipos';
import { renderConProveedores } from '@/pruebas/utilidades';

import { LogoEmpresa } from './LogoEmpresa';

/**
 * Control del LOGO en Administración › Empresas (branding post-F9). Es el único punto donde se
 * cambia la marca de todo el sistema, así que lo que se prueba es: que muestre el logo actual,
 * que suba/quite llamando a los hooks con el id correcto, que solo acepte PNG/JPG (react-pdf no
 * sabe incrustar otra cosa) y que sin `empresas.administrar` no se pueda tocar.
 */

const consultaLogo =
  vi.fn<() => { data: EmpresaLogo | undefined; isError: boolean; error: Error | null }>();
const subirMutate = vi.fn();
const quitarMutate = vi.fn();

vi.mock('@/api/empresas', () => ({
  useLogoEmpresa: () => consultaLogo(),
  useSubirLogoEmpresa: () => ({ mutate: subirMutate, isPending: false }),
  useQuitarLogoEmpresa: () => ({ mutate: quitarMutate, isPending: false }),
}));

/** Empresa de ejemplo (solo se usan `id` y `nombre`). */
const EMPRESA = { id: 7, nombre: 'FR Moda' } as Empresa;

/** Logo "vacío": la empresa aún no subió uno (el sistema usa el empaquetado). */
const SIN_LOGO: EmpresaLogo = {
  idArchivo: null,
  nombreOriginal: null,
  tipoMime: null,
  tamanoBytes: null,
  urlDescarga: null,
};

/** Logo ya subido, con su URL prefirmada. */
const CON_LOGO: EmpresaLogo = {
  idArchivo: 'arch1',
  nombreOriginal: 'FR Moda.png',
  tipoMime: 'image/png',
  tamanoBytes: 34_859,
  urlDescarga: 'https://r2.fake/get/logo.png',
};

/** Archivo de prueba con tipo y tamaño controlados. */
function archivo(nombre: string, tipo: string, bytes: number): File {
  const file = new File(['x'], nombre, { type: tipo });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

describe('<LogoEmpresa>', () => {
  beforeEach(() => {
    consultaLogo.mockReset();
    subirMutate.mockReset();
    quitarMutate.mockReset();
    consultaLogo.mockReturnValue({ data: SIN_LOGO, isError: false, error: null });
  });

  it('sin logo propio explica que se usa el que trae el sistema', () => {
    renderConProveedores(<LogoEmpresa empresa={EMPRESA} />);

    expect(screen.getByTestId('placeholder-logo-empresa')).toHaveTextContent('Sin logo propio');
    expect(screen.getByText(/se usa el que trae el sistema/i)).toBeInTheDocument();
  });

  it('muestra el logo actual cuando la empresa ya tiene uno', () => {
    consultaLogo.mockReturnValue({ data: CON_LOGO, isError: false, error: null });
    renderConProveedores(<LogoEmpresa empresa={EMPRESA} />);

    expect(screen.getByTestId('imagen-logo-empresa')).toHaveAttribute(
      'src',
      'https://r2.fake/get/logo.png',
    );
  });

  it('dice que el logo alimenta los impresos y el sistema (lo que pidió Daniel)', () => {
    renderConProveedores(<LogoEmpresa empresa={EMPRESA} />);

    expect(screen.getByText(/formatos de impresión/i)).toBeInTheDocument();
  });

  it('subir un PNG llama a la mutación con el id de la empresa y el archivo', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<LogoEmpresa empresa={EMPRESA} />);

    const png = archivo('logo.png', 'image/png', 20_000);
    await usuario.upload(screen.getByTestId('archivo-logo-empresa'), png);

    expect(subirMutate).toHaveBeenCalledTimes(1);
    expect(subirMutate.mock.calls[0]?.[0]).toMatchObject({ idEmpresa: 7, archivo: png });
  });

  it('solo ofrece PNG/JPG: los demás formatos ni siquiera llegan a subirse', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<LogoEmpresa empresa={EMPRESA} />);

    // El selector de archivos ya filtra por los dos formatos imprimibles…
    const input = screen.getByTestId('archivo-logo-empresa');
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg');

    // …y si aun así llegara un WEBP, no se sube.
    await usuario.upload(input, archivo('logo.webp', 'image/webp', 20_000));
    expect(subirMutate).not.toHaveBeenCalled();
  });

  it('rechaza en el navegador un archivo de más de 5 MB', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<LogoEmpresa empresa={EMPRESA} />);

    await usuario.upload(
      screen.getByTestId('archivo-logo-empresa'),
      archivo('enorme.png', 'image/png', 6 * 1024 * 1024),
    );

    expect(subirMutate).not.toHaveBeenCalled();
    expect(screen.getByTestId('error-logo-empresa')).toHaveTextContent(/5 MB/);
  });

  it('quitar el logo llama a la mutación con el id de la empresa', async () => {
    consultaLogo.mockReturnValue({ data: CON_LOGO, isError: false, error: null });
    const usuario = userEvent.setup();
    renderConProveedores(<LogoEmpresa empresa={EMPRESA} />);

    await usuario.click(screen.getByTestId('quitar-logo-empresa'));

    expect(quitarMutate).toHaveBeenCalledTimes(1);
    expect(quitarMutate.mock.calls[0]?.[0]).toBe(7);
  });

  it('sin permiso de administrar: se ve el logo pero no se puede cambiar ni quitar', () => {
    consultaLogo.mockReturnValue({ data: CON_LOGO, isError: false, error: null });
    renderConProveedores(<LogoEmpresa empresa={EMPRESA} deshabilitado />);

    expect(screen.getByTestId('imagen-logo-empresa')).toBeInTheDocument();
    expect(screen.getByTestId('subir-logo-empresa')).toBeDisabled();
    expect(screen.queryByTestId('quitar-logo-empresa')).toBeNull();
  });
});
