import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BandejaCotejo, ClavePermiso, DocumentosEmitidos } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';
import { GuardiaPermisoRuta } from '@/sesion/GuardiaPermisoRuta';

import { CotejoFacturasPagina } from './CotejoFacturasPagina';

/**
 * Tests de componente del COTEJO (fila 0.117, §Post-F9.232). Se mockean los hooks del API: el
 * veredicto y la tolerancia son del SERVIDOR, aquí sólo se mide qué hace la pantalla con ellos.
 *
 * 🔒 Nombres INVENTADOS (repo público).
 */

const FACTURA_EN_ROJO: BandejaCotejo['facturas'][number] = {
  idMovimiento: 91,
  folio: 44,
  fecha: '2026-09-10',
  idProveedor: 7,
  proveedor: 'TALLER NORTE',
  uuidCfdi: '11111111-1111-1111-1111-111111111111',
  total: 11_600,
  aplicado: 0,
  diferencia: 11_600,
  estado: 'descuadre',
  atendida: false,
  atendidaEn: null,
  atendidaPor: null,
  nota: null,
  cancelada: false,
  frenaElPago: true,
  aplicaciones: [],
};

const FACTURA_QUE_CUADRA: BandejaCotejo['facturas'][number] = {
  ...FACTURA_EN_ROJO,
  idMovimiento: 92,
  folio: 45,
  aplicado: 11_600,
  diferencia: 0,
  estado: 'cuadra',
  frenaElPago: false,
};

const DOCUMENTOS: DocumentosEmitidos = {
  documentos: [
    {
      idRenglon: 501,
      folioDocumento: 1001,
      folioCorrida: 12,
      semana: '2026-09-02',
      concepto: 'Maquila de la semana',
      total: 11_600,
      aplicado: 0,
      disponible: 11_600,
    },
  ],
  hayMas: false,
};

/** La misma factura, pero CANCELADA: sus ligas dejaron de contar y ya no frena nada. */
const FACTURA_CANCELADA: BandejaCotejo['facturas'][number] = {
  ...FACTURA_EN_ROJO,
  idMovimiento: 93,
  folio: 46,
  aplicado: 0,
  diferencia: 11_600,
  cancelada: true,
  frenaElPago: false,
  aplicaciones: [{ idRenglon: 501, folioDocumento: 1001, semana: '2026-09-02', importe: 11_600 }],
};

let bandeja: BandejaCotejo = {
  facturas: [FACTURA_EN_ROJO],
  enRojo: 1,
  hayMas: false,
  toleranciaPesos: 1,
};

const aplicarSpy = vi.fn();
const atenderSpy = vi.fn();

vi.mock('@/api/cotejo', () => ({
  useBandejaCotejo: () => ({ data: bandeja, isPending: false, isError: false, error: null }),
  useDocumentosEmitidos: () => ({
    data: DOCUMENTOS,
    isPending: false,
    isError: false,
    error: null,
  }),
  useAplicarCotejo: () => ({
    mutate: (vars: unknown) => {
      aplicarSpy(vars);
    },
    isPending: false,
  }),
  useAtenderCotejo: () => ({
    mutate: (vars: unknown) => {
      atenderSpy(vars);
    },
    isPending: false,
  }),
}));

const ADMIN: ClavePermiso[] = ['cxp.administrar', 'cxp.ver', 'consultas.ver-importes'];
const SOLO_VER: ClavePermiso[] = ['cxp.ver', 'consultas.ver-importes'];

describe('CotejoFacturasPagina (fila 0.117)', () => {
  beforeEach(() => {
    aplicarSpy.mockClear();
    atenderSpy.mockClear();
    bandeja = { facturas: [FACTURA_EN_ROJO], enRojo: 1, hayMas: false, toleranciaPesos: 1 };
  });

  it('sin cxp.ver la pantalla NO se monta (la cierra la capa de ruta)', () => {
    renderConProveedores(
      <GuardiaPermisoRuta>
        <CotejoFacturasPagina />
      </GuardiaPermisoRuta>,
      { sesion: estadoSesionDePrueba(['terceros.ver']), rutaInicial: '/cxp/cotejo' },
    );
    expect(screen.queryByTestId('cotejo-fila-91')).toBeNull();
  });

  it('con cxp.ver la pantalla sí se monta (gemela positiva)', () => {
    renderConProveedores(
      <GuardiaPermisoRuta>
        <CotejoFacturasPagina />
      </GuardiaPermisoRuta>,
      { sesion: estadoSesionDePrueba(SOLO_VER), rutaInicial: '/cxp/cotejo' },
    );
    expect(screen.getByTestId('cotejo-fila-91')).toBeInTheDocument();
  });

  it('⭐ la factura que frena el pago sale marcada como que NO cuadra', () => {
    renderConProveedores(<CotejoFacturasPagina />, { sesion: estadoSesionDePrueba(ADMIN) });
    const fila = screen.getByTestId('cotejo-fila-91');
    expect(within(fila).getByText('No cuadra')).toBeInTheDocument();
  });

  it('…y la que cuadra NO sale marcada', () => {
    bandeja = { facturas: [FACTURA_QUE_CUADRA], enRojo: 0, hayMas: false, toleranciaPesos: 1 };
    renderConProveedores(<CotejoFacturasPagina />, { sesion: estadoSesionDePrueba(ADMIN) });
    const fila = screen.getByTestId('cotejo-fila-92');
    expect(within(fila).queryByText('No cuadra')).toBeNull();
    expect(within(fila).getByText('Cuadra')).toBeInTheDocument();
  });

  it('⭐ la tolerancia que se enseña viene del SERVIDOR, no escrita en la pantalla', () => {
    bandeja = { facturas: [FACTURA_EN_ROJO], enRojo: 1, hayMas: false, toleranciaPesos: 7 };
    renderConProveedores(<CotejoFacturasPagina />, { sesion: estadoSesionDePrueba(ADMIN) });
    expect(screen.getByText('$7.00')).toBeInTheDocument();
  });

  it('⭐ la factura CANCELADA se pinta como cancelada, no como que cuadra', () => {
    // Sus ligas ya no ocupan sitio en el documento, así que ni «Cuadra» ni «No cuadra» dirían de
    // ella algo cierto.
    bandeja = { facturas: [FACTURA_CANCELADA], enRojo: 0, hayMas: false, toleranciaPesos: 1 };
    renderConProveedores(<CotejoFacturasPagina />, { sesion: estadoSesionDePrueba(ADMIN) });
    const fila = screen.getByTestId('cotejo-fila-93');
    expect(within(fila).getByText('Cancelada')).toBeInTheDocument();
    expect(within(fila).queryByText('Cuadra')).toBeNull();
    expect(within(fila).queryByText('No cuadra')).toBeNull();
  });

  it('⭐ cuando la lista se RECORTA, la pantalla lo dice (§Post-F9.87: sin topes silenciosos)', () => {
    bandeja = { facturas: [FACTURA_EN_ROJO], enRojo: 640, hayMas: true, toleranciaPesos: 1 };
    renderConProveedores(<CotejoFacturasPagina />, { sesion: estadoSesionDePrueba(ADMIN) });
    expect(screen.getByTestId('cotejo-hay-mas')).toBeInTheDocument();
  });

  it('…y sin recorte no enseña el aviso (gemela negativa)', () => {
    renderConProveedores(<CotejoFacturasPagina />, { sesion: estadoSesionDePrueba(ADMIN) });
    expect(screen.queryByTestId('cotejo-hay-mas')).toBeNull();
  });

  it('⭐ el número de «frenan un pago» es el del SERVIDOR, no el largo de la lista recortada', () => {
    // Con 640 en rojo y una sola fila visible, la pantalla tiene que decir 640: contar lo que se ve
    // sería afirmar «1» como si fuera el dato.
    bandeja = { facturas: [FACTURA_EN_ROJO], enRojo: 640, hayMas: true, toleranciaPesos: 1 };
    renderConProveedores(<CotejoFacturasPagina />, { sesion: estadoSesionDePrueba(ADMIN) });
    expect(screen.getByText('640')).toBeInTheDocument();
  });

  it('⭐ sin cxp.administrar no hay forma de ligar ni de atender', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CotejoFacturasPagina />, { sesion: estadoSesionDePrueba(SOLO_VER) });
    await usuario.click(screen.getByTestId('cotejo-abrir-91'));
    expect(screen.queryByTestId('cotejo-guardar-91')).toBeNull();
    expect(screen.queryByTestId('cotejo-atender-91')).toBeNull();
  });

  it('⭐ guardar manda sólo los documentos con importe (los vacíos no viajan)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CotejoFacturasPagina />, { sesion: estadoSesionDePrueba(ADMIN) });
    await usuario.click(screen.getByTestId('cotejo-abrir-91'));
    await usuario.click(screen.getByTestId('cotejo-guardar-91'));
    expect(aplicarSpy).toHaveBeenCalledWith(
      expect.objectContaining({ idMovimiento: 91, cuerpo: { aplicaciones: [] } }),
    );

    aplicarSpy.mockClear();
    await usuario.type(screen.getByTestId('cotejo-importe-501'), '11600');
    await usuario.click(screen.getByTestId('cotejo-guardar-91'));
    expect(aplicarSpy).toHaveBeenCalledWith({
      idMovimiento: 91,
      cuerpo: { aplicaciones: [{ idRenglon: 501, importe: 11_600 }] },
    });
  });

  it('⭐ un importe BORRADO no viaja como cero: el documento sale de la lista', async () => {
    // Un `0` sí llegaría al servidor (la liga en cero está prohibida por CHECK) y volvería como
    // error; la pantalla lo quita antes. Se teclea y se borra, que es como pasa de verdad.
    const usuario = userEvent.setup();
    renderConProveedores(<CotejoFacturasPagina />, { sesion: estadoSesionDePrueba(ADMIN) });
    await usuario.click(screen.getByTestId('cotejo-abrir-91'));
    await usuario.type(screen.getByTestId('cotejo-importe-501'), '500');
    await usuario.clear(screen.getByTestId('cotejo-importe-501'));
    await usuario.click(screen.getByTestId('cotejo-guardar-91'));
    expect(aplicarSpy).toHaveBeenCalledWith({ idMovimiento: 91, cuerpo: { aplicaciones: [] } });
  });

  it('⭐ atender EXIGE la explicación: sin nota el botón no deja', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CotejoFacturasPagina />, { sesion: estadoSesionDePrueba(ADMIN) });
    await usuario.click(screen.getByTestId('cotejo-abrir-91'));
    expect(screen.getByTestId('cotejo-atender-91')).toBeDisabled();
  });

  it('…y con la explicación, atender manda la nota', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<CotejoFacturasPagina />, { sesion: estadoSesionDePrueba(ADMIN) });
    await usuario.click(screen.getByTestId('cotejo-abrir-91'));
    await usuario.type(screen.getByTestId('cotejo-nota-91'), 'Facturó de más por un flete');
    await usuario.click(screen.getByTestId('cotejo-atender-91'));
    expect(atenderSpy).toHaveBeenCalledWith({
      idMovimiento: 91,
      cuerpo: { nota: 'Facturó de más por un flete' },
    });
  });
});
