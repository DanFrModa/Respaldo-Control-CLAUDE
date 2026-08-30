import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListaDetalle, ListaLinea } from '@/api/listas-precios';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoEmitirCotizacion } from './DialogoEmitirCotizacion';

/**
 * Unit del diálogo de EMITIR COTIZACIÓN (V1-E7c). Blinda las dos reglas de negocio que el usuario ve
 * antes de mandarle el papel al cliente:
 *  • 🔴 **Van TODOS los modelos** — no hay forma de quitar ninguno, y el cuerpo que se manda al API
 *    lleva sólo `idLista` (es el backend quien mete los renglones, A1).
 *  • 🔴 **No se emite con un precio sin aprobar**, y se dice CUÁL falta.
 */
const emitirMutate = vi.fn();

vi.mock('@/api/cotizaciones', () => ({
  useEmitirCotizacion: () => ({ mutate: emitirMutate, isPending: false }),
}));

function renglon(id: number, codigo: string, precioAprobado: number | null): ListaLinea {
  return {
    id,
    idDesarrollo: id * 10,
    idPrecosto: id * 100,
    versionPrecosto: 1,
    avisoCostoViejo: null,
    codigoModelo: codigo,
    descripcionModelo: `Modelo ${codigo}`,
    numeroCliente: `CA-${codigo}`,
    costoUnit: 40,
    precioCalculado: 100,
    precioAprobado,
    // ⭐ V1-E8w (§Post-F9.150): el target del cliente NO participa en la cotización. Va ≠ null a
    // propósito, para que la prueba muerda si algún día se colara al documento.
    precioTarget: 95,
    tieneTarget: true,
    aprobado: precioAprobado !== null,
    aprobadoPorId: precioAprobado === null ? null : 'u1',
    aprobadoEn: precioAprobado === null ? null : '2026-03-12T00:00:00.000Z',
  };
}

function lista(lineas: ListaLinea[]): ListaDetalle {
  return {
    id: 5,
    folio: 7,
    idCliente: 1,
    nombreCliente: 'C&A',
    idClienteDepartamento: 1,
    nombreDepartamento: 'NIÑOS',
    fecha: '2026-03-12',
    idEstadoLista: 1,
    codigoEstado: 'abierta',
    nombreEstado: 'Abierta',
    margenPct: 50,
    descuentosPct: 10,
    regaliasPct: 5,
    costoVentasPct: 5,
    notas: null,
    lineas,
    creadoEn: '2026-03-12T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-03-12T00:00:00.000Z',
    modificadoPorId: null,
  };
}

/** Cinco modelos, todos con precio aprobado (el caso de Daniel). */
const CINCO = [
  renglon(1, 'MOD-A', 137),
  renglon(2, 'MOD-B', 210),
  renglon(3, 'MOD-C', 95),
  renglon(4, 'MOD-D', 60),
  renglon(5, 'MOD-E', 180),
];

describe('<DialogoEmitirCotizacion>', () => {
  beforeEach(() => {
    emitirMutate.mockReset();
  });

  it('🔴 muestra LOS CINCO modelos y emite con la lista entera (sin selección de renglones)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoEmitirCotizacion abierto alCambiarAbierto={() => {}} lista={lista(CINCO)} />,
      { sesion: estadoSesionDePrueba(['listas.negociar', 'listas.ver']) },
    );

    expect(screen.getByTestId('renglones-cotizacion').children).toHaveLength(5);
    // No hay casillas que desmarcar: la regla es que van todos, siempre.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    await usuario.click(screen.getByTestId('confirmar-emitir-cotizacion'));
    expect(emitirMutate).toHaveBeenCalledTimes(1);
    expect(emitirMutate.mock.calls[0]?.[0]).toEqual({ idLista: 5 });
  });

  it('🔴 bloquea la emisión si algún modelo NO tiene precio aprobado, y lo nombra', () => {
    // MOD-D pierde su aprobación: el dueño no lo ha visto, así que ese precio no sale al cliente.
    const conFaltante = CINCO.map((l) =>
      l.codigoModelo === 'MOD-D' ? renglon(4, 'MOD-D', null) : l,
    );
    renderConProveedores(
      <DialogoEmitirCotizacion abierto alCambiarAbierto={() => {}} lista={lista(conFaltante)} />,
      { sesion: estadoSesionDePrueba(['listas.negociar', 'listas.ver']) },
    );

    expect(screen.getByTestId('confirmar-emitir-cotizacion')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('MOD-D');
    expect(emitirMutate).not.toHaveBeenCalled();
  });

  it('🔴 H5 — sin `consultas.ver-importes` la suma dice «—», nunca «$0.00»', () => {
    // El backend oculta los importes (null) a quien no puede verlos, pero `aprobado` sigue siendo
    // true. Sumar con `?? 0` anunciaba «$0.00» mientras cada renglón mostraba «—»: un total
    // inventado, y encima uno que sugiere que se está cotizando gratis.
    const sinImportes = CINCO.map((l) => ({ ...l, precioAprobado: null }));
    renderConProveedores(
      <DialogoEmitirCotizacion abierto alCambiarAbierto={() => {}} lista={lista(sinImportes)} />,
      { sesion: estadoSesionDePrueba(['listas.negociar', 'listas.ver']) },
    );

    const resumen = screen.getByText(/Suma de precios/);
    expect(resumen).toHaveTextContent('—');
    expect(resumen).not.toHaveTextContent('$0.00');
    // Y se puede emitir igual: no ver precios no impide mandar el documento.
    expect(screen.getByTestId('confirmar-emitir-cotizacion')).toBeEnabled();
  });

  it('con `consultas.ver-importes` sí muestra la suma', () => {
    renderConProveedores(
      <DialogoEmitirCotizacion abierto alCambiarAbierto={() => {}} lista={lista(CINCO)} />,
      {
        sesion: estadoSesionDePrueba(['listas.negociar', 'listas.ver', 'consultas.ver-importes']),
      },
    );
    // 137 + 210 + 95 + 60 + 180 = 682
    expect(screen.getByText(/Suma de precios/)).toHaveTextContent('$682.00');
  });

  it('una lista sin modelos no se puede cotizar (no hay hoja en blanco)', () => {
    renderConProveedores(
      <DialogoEmitirCotizacion abierto alCambiarAbierto={() => {}} lista={lista([])} />,
      { sesion: estadoSesionDePrueba(['listas.negociar', 'listas.ver']) },
    );
    expect(screen.getByTestId('confirmar-emitir-cotizacion')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('no tiene modelos');
  });

  it('las notas viajan en el cuerpo cuando se capturan', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <DialogoEmitirCotizacion abierto alCambiarAbierto={() => {}} lista={lista(CINCO)} />,
      { sesion: estadoSesionDePrueba(['listas.negociar', 'listas.ver']) },
    );
    await usuario.type(screen.getByLabelText(/Notas/), 'Vigencia 30 días');
    await usuario.click(screen.getByTestId('confirmar-emitir-cotizacion'));
    expect(emitirMutate.mock.calls[0]?.[0]).toEqual({
      idLista: 5,
      notas: 'Vigencia 30 días',
    });
  });
});

// ── ⭐ V1-E8d (§Post-F9.127): el aviso de costo viejo también en la puerta de salida ──
//
// Éste es el documento por el que un precio calculado sobre un costo viejo SALE hacia el cliente.
// Daniel pidió *"que me avise"*, no que se bloquee: la cotización se sigue pudiendo emitir.
describe('⭐ V1-E8d — costo viejo al emitir la cotización', () => {
  it('avisa nombrando los modelos, y NO bloquea la emisión', () => {
    const conAviso = CINCO.map((l) =>
      l.codigoModelo === 'MOD-B'
        ? { ...l, avisoCostoViejo: 'Cambió las TELAS de este modelo el 27/8/2026.' }
        : l,
    );
    renderConProveedores(
      <DialogoEmitirCotizacion abierto alCambiarAbierto={() => {}} lista={lista(conAviso)} />,
      { sesion: estadoSesionDePrueba(['listas.negociar', 'listas.ver', 'consultas.ver-importes']) },
    );

    const aviso = screen.getByTestId('aviso-costo-viejo-cotizacion');
    expect(aviso).toHaveTextContent('MOD-B');
    expect(aviso).not.toHaveTextContent('MOD-A');
    expect(aviso).toHaveTextContent(/sale igual/i);
    // Es un AVISO, no un candado: Daniel pidió que le avise, no que se bloquee (§Post-F9.127).
    expect(screen.getByTestId('confirmar-emitir-cotizacion')).toBeEnabled();
  });

  it('sin renglones marcados no se pinta ningún aviso', () => {
    renderConProveedores(
      <DialogoEmitirCotizacion abierto alCambiarAbierto={() => {}} lista={lista(CINCO)} />,
      { sesion: estadoSesionDePrueba(['listas.negociar', 'listas.ver']) },
    );
    expect(screen.queryByTestId('aviso-costo-viejo-cotizacion')).not.toBeInTheDocument();
  });
});
