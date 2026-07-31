import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CfdiPrevisualizacion, ClavePermiso } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ImportarCfdiPagina } from './ImportarCfdiPagina';

/**
 * Tests de componente de la pantalla "Importar CFDI" (F9-E3). Se mockean los hooks del API (parseo y
 * conciliación son BACKEND) y el catálogo de proveedores del selector. Cubre: gate por permiso, el
 * flujo previsualizar→importar y que el import mande el proveedor sugerido.
 */

const PREVIEW: CfdiPrevisualizacion = {
  datos: {
    version: '4.0',
    tipoComprobante: 'I',
    origen: 'factura_proveedor',
    uuid: '11111111-1111-1111-1111-111111111111',
    fecha: '2026-07-01',
    fechaTimbrado: null,
    emisorRfc: 'AAA010101AA1',
    emisorNombre: 'Telas del Norte SA',
    receptorRfc: 'XAXX010101000',
    receptorNombre: 'FR Moda SA de CV',
    moneda: 'MXN',
    subtotal: 1000,
    total: 1060,
    ivaTrasladado: 160,
    isrRetenido: 100,
    ivaRetenido: 0,
    conceptos: [{ descripcion: 'Tela algodon', cantidad: 10, valorUnitario: 100, importe: 1000 }],
  },
  candidatoProveedor: {
    idProveedor: 7,
    nombre: 'Telas del Norte SA',
    rfc: 'AAA010101AA1',
    corto: 'TDN',
  },
  candidatosOc: [
    {
      idOrdenCompra: 5,
      numCompra: 10,
      fecha: '2026-06-01',
      estatus: 'autorizada',
      total: 1000,
      diferencia: 60,
      diferenciaRelativa: 0.0566,
    },
  ],
  yaImportado: false,
  avisos: ['No se validó el RFC del receptor (la empresa no tiene RFC configurado).'],
};

const importarSpy = vi.fn();

vi.mock('@/api/cfdi', () => ({
  usePrevisualizarCfdi: () => ({
    mutate: (_xml: string, opts: { onSuccess: (r: CfdiPrevisualizacion) => void }) =>
      opts.onSuccess(PREVIEW),
    isPending: false,
  }),
  useImportarCfdi: () => ({
    mutate: (vars: unknown, opts: { onSuccess: (r: unknown) => void }) => {
      importarSpy(vars);
      // El servidor sube el XML; el hook resuelve con la salida (el cargo), sin flag de subida.
      opts.onSuccess({ movimiento: { origen: 'factura_proveedor' } });
    },
    isPending: false,
  }),
}));

// El selector de proveedor consulta el catálogo; lo mockeamos vacío (el candidato se pre-selecciona).
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [] }, isPending: false, isError: false, error: null }),
}));

const ADMIN: ClavePermiso[] = ['cxp.administrar', 'cxp.ver', 'consultas.ver-importes'];

/** Sube un XML de ejemplo por el input de archivo (con contenido leído por `.text()`). */
async function subirXml(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  const archivo = new File(['<cfdi/>'], 'factura.xml', { type: 'application/xml' });
  await usuario.upload(screen.getByTestId('cfdi-archivo'), archivo);
  await waitFor(() => expect(screen.getByTestId('cfdi-previsualizar')).toBeEnabled());
}

describe('ImportarCfdiPagina (F9-E3)', () => {
  beforeEach(() => {
    importarSpy.mockClear();
  });

  it('sin cxp.administrar muestra el aviso de permiso', () => {
    renderConProveedores(<ImportarCfdiPagina />, { sesion: estadoSesionDePrueba(['cxp.ver']) });
    expect(screen.getByText(/No tienes permiso para importar CFDI/i)).toBeInTheDocument();
  });

  it('previsualiza y muestra emisor, receptor, total, UUID y conceptos', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ImportarCfdiPagina />, { sesion: estadoSesionDePrueba(ADMIN) });

    await subirXml(usuario);
    await usuario.click(screen.getByTestId('cfdi-previsualizar'));

    const datos = await screen.findByTestId('cfdi-datos');
    expect(datos).toHaveTextContent('Telas del Norte SA');
    expect(datos).toHaveTextContent('AAA010101AA1');
    expect(datos).toHaveTextContent('XAXX010101000');
    expect(datos).toHaveTextContent('$1,060.00');
    expect(datos).toHaveTextContent('11111111-1111-1111-1111-111111111111');
    expect(screen.getByTestId('cfdi-conceptos')).toHaveTextContent('Tela algodon');
    // El aviso del receptor se muestra.
    expect(screen.getByTestId('cfdi-avisos')).toHaveTextContent(
      /no se validó el rfc del receptor/i,
    );
  });

  it('importa con el proveedor sugerido (sin OC por defecto)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ImportarCfdiPagina />, { sesion: estadoSesionDePrueba(ADMIN) });

    await subirXml(usuario);
    await usuario.click(screen.getByTestId('cfdi-previsualizar'));
    await screen.findByTestId('cfdi-datos');

    await usuario.click(screen.getByTestId('cfdi-importar-confirmar'));
    expect(importarSpy).toHaveBeenCalledWith(
      expect.objectContaining({ xml: '<cfdi/>', idProveedor: 7 }),
    );
    // Sin OC elegida → no viaja refTipo.
    expect(importarSpy.mock.calls[0]?.[0]).not.toHaveProperty('refTipo');
  });

  it('liga la OC elegida al importar', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<ImportarCfdiPagina />, { sesion: estadoSesionDePrueba(ADMIN) });

    await subirXml(usuario);
    await usuario.click(screen.getByTestId('cfdi-previsualizar'));
    await screen.findByTestId('cfdi-datos');

    await usuario.click(screen.getByTestId('cfdi-oc-5'));
    await usuario.click(screen.getByTestId('cfdi-importar-confirmar'));
    expect(importarSpy).toHaveBeenCalledWith(
      expect.objectContaining({ idProveedor: 7, refTipo: 'orden-compra', refId: 5 }),
    );
  });
});
