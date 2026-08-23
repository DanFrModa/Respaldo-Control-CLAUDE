import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ContextoSesion, type EstadoSesion } from '@/sesion/contexto';
import { estadoSesionDePrueba } from '@/pruebas/utilidades';

import { Marca } from './Marca';

/**
 * Marca de la app (branding post-F9): el logo sale del archivo que se sube en Administración y
 * viaja en la sesión. Lo que se prueba es la cadena de respaldo que Daniel pidió: logo de la
 * EMPRESA → PNG EMPAQUETADO → cuadro con icono; y que el wordmark "Control v2" nunca desaparezca
 * (es el nombre accesible del componente).
 */

/** Estado de sesión con (o sin) logo de empresa. */
function sesionConLogo(idArchivoLogo: string | null): EstadoSesion {
  const base = estadoSesionDePrueba([]);
  if (base.sesion === null) {
    throw new Error('estadoSesionDePrueba debe traer sesión.');
  }
  return {
    ...base,
    sesion: {
      ...base.sesion,
      empresaActiva: { ...base.sesion.empresaActiva, idArchivoLogo },
    },
  };
}

/** Renderiza la marca con un estado de sesión dado (o sin proveedor, si es `null`). */
function renderMarca(estado: EstadoSesion | null, props: Parameters<typeof Marca>[0] = {}) {
  const marca = <Marca {...props} />;
  return render(
    estado === null ? (
      marca
    ) : (
      <ContextoSesion.Provider value={estado}>{marca}</ContextoSesion.Provider>
    ),
  );
}

describe('Marca', () => {
  it('con logo de empresa pide la imagen al API, versionada con el id del archivo', () => {
    renderMarca(sesionConLogo('arch_abc'));

    const img = screen.getByTestId('marca-logo');
    expect(img.getAttribute('src')).toBe('/api/empresas/logo?v=arch_abc');
  });

  it('sin logo de empresa usa el PNG EMPAQUETADO (no llama al API)', () => {
    renderMarca(sesionConLogo(null));

    const src = screen.getByTestId('marca-logo').getAttribute('src') ?? '';
    expect(src).not.toContain('/api/empresas/logo');
    expect(src).toContain('logo-frmoda');
  });

  it('sin sesión (login) pide el logo PÚBLICO del servidor, para verse siempre al día', () => {
    // El endpoint es público a propósito: si no, el login sería el único rincón que se quedaría
    // con el logo viejo al cambiarlo en Administración.
    renderMarca(null);

    expect(screen.getByTestId('marca-logo').getAttribute('src')).toBe('/api/empresas/logo');
  });

  it('sin sesión, si el servidor no responde la imagen, cae al PNG empaquetado', () => {
    renderMarca(null);

    fireEvent.error(screen.getByTestId('marca-logo'));

    expect(screen.getByTestId('marca-logo').getAttribute('src')).toContain('logo-frmoda');
  });

  it('sin proveedor de sesión no revienta (se pinta igual)', () => {
    expect(() => render(<Marca />)).not.toThrow();
  });

  it('si el logo de la empresa no carga, cae al empaquetado y luego al icono', () => {
    renderMarca(sesionConLogo('arch_abc'));

    // 1er fallo: la imagen del API no carga → se intenta el empaquetado.
    fireEvent.error(screen.getByTestId('marca-logo'));
    expect(screen.getByTestId('marca-logo').getAttribute('src')).toContain('logo-frmoda');

    // 2º fallo: tampoco carga el empaquetado → cuadro con icono (comportamiento original).
    fireEvent.error(screen.getByTestId('marca-logo'));
    expect(screen.queryByTestId('marca-logo')).toBeNull();
    expect(screen.getByTestId('marca-icono')).toBeInTheDocument();
  });

  it('mantiene el wordmark "Control v2" junto al logo', () => {
    renderMarca(sesionConLogo('arch_abc'));

    expect(screen.getByText(/Control/)).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('FR Moda')).toBeInTheDocument();
  });

  it('colapsado sigue mostrando el logo (el riel angosto conserva la marca)', () => {
    renderMarca(sesionConLogo('arch_abc'), { colapsado: true });

    expect(screen.getByTestId('marca-logo')).toBeInTheDocument();
    // El wordmark NO se desmonta al colapsar (se anima a ancho 0): sigue en el DOM.
    expect(screen.getByText('v2')).toBeInTheDocument();
  });

  it('con `soloIcono` desmonta el wordmark pero conserva el logo', () => {
    renderMarca(sesionConLogo('arch_abc'), { soloIcono: true });

    expect(screen.getByTestId('marca-logo')).toBeInTheDocument();
    expect(screen.queryByText('v2')).toBeNull();
  });
});
