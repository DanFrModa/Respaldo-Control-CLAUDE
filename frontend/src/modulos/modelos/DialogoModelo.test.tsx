import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderConProveedores } from '@/pruebas/utilidades';

import type { Modelo } from '@/api/modelos';

import { DialogoModelo } from './DialogoModelo';

/**
 * Unit de los props que el IMPORTADOR de OC necesita del alta estándar (reuso, no duplica forms):
 * `prellenadoAlta` (proponer la descripción de la OC en el alta, dejando el código al usuario) y
 * `alCrear` (avisar al llamador el modelo creado, para dejarlo ligado). El resto del alta ya se
 * cubre por `ModelosPagina.test`.
 */

// `useCrearModelo`: espía del POST. La prueba que envía el alta le pone una implementación que
// simula el éxito (invoca `onSuccess` con el modelo creado); las demás lo dejan como espía inerte.
const crearMutate = vi.fn();
// Espía del PATCH (fila 0.249 parte C: qué manda la edición cuando el servidor tapó precios).
const actualizarMutate = vi.fn();

vi.mock('@/api/modelos', () => ({
  useCrearModelo: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarModelo: () => ({ mutate: actualizarMutate, isPending: false }),
  // ⭐ V1-E8j — el alta EXIGE género y tipo de prenda, así que los catálogos ya no pueden ir
  // vacíos: sin opciones no habría cómo cumplir la regla (y la prueba mediría el mock, no el alta).
  useGeneros: () => ({ data: [{ id: 1, nombre: 'Caballero', activo: true }], isPending: false }),
}));
vi.mock('@/api/temporadas', () => ({ useTemporadas: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/tallas', () => ({ useCurvas: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/calidad', () => ({
  useTiposProductoActivos: () => ({
    data: { datos: [{ id: 7, nombre: 'Pantalón', activo: true }] },
    isPending: false,
  }),
}));
vi.mock('@/api/dificultad', () => ({
  useDificultad: () => ({ data: undefined, isPending: false }),
}));
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [] }, isFetching: false }),
  // V1-E3f (§Post-F9.52 punto 7): los selectores de proveedor pasaron al `ComboboxBuscable` con
  // búsqueda en el SERVIDOR, que consume estos dos hooks.
  useProveedoresPorRol: () => ({ data: { datos: [] }, isPending: false, isError: false }),
  useRolesProveedor: () => ({ data: [], isPending: false }),
}));

/**
 * ⭐ V1-E8j (§Post-F9.134) — elige los DOS DÍGITOS, que el alta exige. Se hace *como lo haría
 * Daniel* (eligiéndolos en la pantalla), no aflojando el esquema: son el primer y el segundo dígito
 * del nº de producción y sin ellos el modelo no se podría promover.
 */
function elegirNomenclatura(): void {
  fireEvent.change(screen.getByLabelText(/Tipo de producto/), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText(/Género/), { target: { value: '1' } });
}

/**
 * 🔴 V1-E8j · H8 — LA MITAD FRONTEND DE LA DECISIÓN, QUE NO TENÍA QUIEN LA MATARA.
 *
 * `esquemaModeloFormularioAlta` (y el `resolver` que lo elige) estaba **entero sin cobertura**:
 * sustituirlo por el esquema de edición dejaba las 1,684 pruebas en verde. O sea, la regla que
 * Daniel va a ver —que el alta no deja guardar sin los dos dígitos— sólo la sostenía el backend, y
 * el usuario se habría llevado un 400 en vez de un aviso en el campo.
 *
 * La prueba es NEGATIVA a propósito: llena sólo el código, pulsa guardar y exige que **no se llame
 * al API** y que salga el mensaje del campo. Mutar el resolver la pone roja.
 */
describe('DialogoModelo · el alta exige los dos dígitos (V1-E8j)', () => {
  beforeEach(() => crearMutate.mockReset());

  it('sin tipo de prenda ni género NO envía el alta, y lo dice en el campo', async () => {
    renderConProveedores(
      <DialogoModelo abierto alCambiarAbierto={() => {}} modelo={undefined} />,
      {},
    );

    fireEvent.change(screen.getByLabelText(/Código/), { target: { value: 'SIN-DIGITOS' } });
    fireEvent.click(screen.getByTestId('guardar-modelo'));

    await waitFor(() => {
      expect(
        screen.getByText('Elige el tipo de prenda: es el primer dígito del número del modelo'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText('Elige el género: es el segundo dígito del número del modelo'),
    ).toBeInTheDocument();
    // Lo que de verdad importa: NO se mandó nada al servidor.
    expect(crearMutate).not.toHaveBeenCalled();
  });

  it('con los dos elegidos, el alta SÍ se envía (la regla no bloquea de más)', async () => {
    renderConProveedores(
      <DialogoModelo abierto alCambiarAbierto={() => {}} modelo={undefined} />,
      {},
    );

    fireEvent.change(screen.getByLabelText(/Código/), { target: { value: 'CON-DIGITOS' } });
    elegirNomenclatura();
    fireEvent.click(screen.getByTestId('guardar-modelo'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalled());
    const cuerpo = crearMutate.mock.calls[0]?.[0] as { idTipoProducto: number; idGenero: number };
    // Y viajan los ids REALES, no el `?? 0` del traductor.
    expect(cuerpo.idTipoProducto).toBe(7);
    expect(cuerpo.idGenero).toBe(1);
  });
});

describe('DialogoModelo · props del importador', () => {
  beforeEach(() => crearMutate.mockReset());

  it('en alta, precarga la descripción propuesta y deja el código vacío (lo captura el usuario)', () => {
    renderConProveedores(
      <DialogoModelo
        abierto
        alCambiarAbierto={vi.fn()}
        modelo={undefined}
        prellenadoAlta={{ descripcion: 'PLAYERA ML SINGLE JERSEY' }}
      />,
    );

    expect(screen.getByLabelText('Descripción')).toHaveValue('PLAYERA ML SINGLE JERSEY');
    expect(screen.getByLabelText(/Código/)).toHaveValue('');
  });

  it('al crear, invoca alCrear con el modelo recién creado', async () => {
    // El alta llama `crear.mutate(cuerpo, { onSuccess, onError })`; simulamos el éxito devolviendo
    // el modelo creado (con el código capturado) para que dispare el `onSuccess` interno → `alCrear`.
    crearMutate.mockImplementation(
      (
        cuerpo?: { codigo: string; descripcion?: string },
        opciones?: { onSuccess: (m: unknown) => void },
      ) => {
        opciones?.onSuccess?.({
          id: 999,
          codigo: cuerpo?.codigo ?? '',
          descripcion: cuerpo?.descripcion ?? null,
        });
      },
    );
    const alCrear = vi.fn();
    renderConProveedores(
      <DialogoModelo
        abierto
        alCambiarAbierto={vi.fn()}
        modelo={undefined}
        prellenadoAlta={{ descripcion: 'PLAYERA ML' }}
        alCrear={alCrear}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Código/), { target: { value: 'CYA-NUEVO' } });
    elegirNomenclatura();
    fireEvent.click(screen.getByTestId('guardar-modelo'));

    await waitFor(() =>
      expect(alCrear).toHaveBeenCalledWith(
        expect.objectContaining({ id: 999, codigo: 'CYA-NUEVO' }),
      ),
    );
  });
});

describe('DialogoModelo · composición del desarrollo (Daniel 24-jul-2026)', () => {
  beforeEach(() => crearMutate.mockReset());

  it('captura la composición en la ficha del modelo y la manda en el alta', async () => {
    renderConProveedores(<DialogoModelo abierto alCambiarAbierto={vi.fn()} modelo={undefined} />);

    const campo = screen.getByLabelText('Composición');
    expect(screen.getByText(/Las órdenes de este modelo la heredan solas/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Código/), { target: { value: 'M-COMP' } });
    fireEvent.change(campo, { target: { value: '60% algodón 40% poliéster' } });
    elegirNomenclatura();
    fireEvent.click(screen.getByTestId('guardar-modelo'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    expect(crearMutate.mock.calls[0]?.[0]).toMatchObject({
      codigo: 'M-COMP',
      composicion: '60% algodón 40% poliéster',
    });
  });

  // ── ¿Lleva arte? (Daniel 26-jul-2026: "por default sí lleva") ──
  it('la casilla "Lleva arte" nace MARCADA y el alta manda llevaArte: true', async () => {
    renderConProveedores(<DialogoModelo abierto alCambiarAbierto={vi.fn()} modelo={undefined} />);

    const casilla = screen.getByTestId('modelo-lleva-arte');
    expect(casilla).toBeChecked();
    expect(
      screen.getByText(/desmárcala; si no, la orden quedará incompleta hasta capturar el arte/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Código/), { target: { value: 'M-ARTE' } });
    elegirNomenclatura();
    fireEvent.click(screen.getByTestId('guardar-modelo'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    expect(crearMutate.mock.calls[0]?.[0]).toMatchObject({ codigo: 'M-ARTE', llevaArte: true });
  });

  it('desmarcarla manda llevaArte: false (prenda lisa)', async () => {
    renderConProveedores(<DialogoModelo abierto alCambiarAbierto={vi.fn()} modelo={undefined} />);

    fireEvent.change(screen.getByLabelText(/Código/), { target: { value: 'M-LISA' } });
    fireEvent.click(screen.getByTestId('modelo-lleva-arte'));
    expect(screen.getByTestId('modelo-lleva-arte')).not.toBeChecked();
    elegirNomenclatura();
    fireEvent.click(screen.getByTestId('guardar-modelo'));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    expect(crearMutate.mock.calls[0]?.[0]).toMatchObject({ codigo: 'M-LISA', llevaArte: false });
  });
});

/**
 * 🔒 Fila 0.249 parte C — EL FORMULARIO NO PISA LO QUE NO VIO. En la edición un campo vacío viaja como
 * `null` = BORRAR; si el servidor tapó la maquila o el corte (vienen `null` con su marca), mandarlos
 * borraría el dato de verdad. La prueba edita SÓLO la descripción y mira el cuerpo del PATCH.
 */
describe('DialogoModelo · edición con precios TAPADOS (fila 0.249 parte C)', () => {
  /** Modelo con cada marca por separado: maquila (su propia regla) y corte (la del modelo). */
  function modeloDePrueba(ocultos: { maquila: boolean; corte: boolean }): Modelo {
    return {
      id: 41,
      codigo: 'M-249',
      descripcion: 'Antes',
      composicion: null,
      maquilaBase: ocultos.maquila ? null : 23.5,
      maquilaOculta: ocultos.maquila,
      corteBase: ocultos.corte ? null : 4.25,
      preciosOcultos: ocultos.corte,
      numOperaciones: null,
      secuenciaEstampado: 'antes',
      llevaArte: true,
      idTemporada: null,
      idCurvaTalla: null,
      idGenero: 1,
      idTipoProducto: 7,
      idMaquileroCotizado: null,
    } as unknown as Modelo;
  }

  beforeEach(() => {
    actualizarMutate.mockReset();
  });

  async function editarSoloDescripcion(modelo: Modelo): Promise<Record<string, unknown>> {
    renderConProveedores(<DialogoModelo abierto alCambiarAbierto={vi.fn()} modelo={modelo} />);
    fireEvent.change(screen.getByLabelText(/Descripción/), { target: { value: 'Después' } });
    fireEvent.click(screen.getByTestId('guardar-modelo'));
    await waitFor(() => expect(actualizarMutate).toHaveBeenCalled());
    const [{ cuerpo }] = actualizarMutate.mock.calls[0] as [{ cuerpo: Record<string, unknown> }];
    return cuerpo;
  }

  it('con maquila y corte TAPADOS el PATCH no los manda (no los borra)', async () => {
    const cuerpo = await editarSoloDescripcion(modeloDePrueba({ maquila: true, corte: true }));
    expect(cuerpo.descripcion).toBe('Después');
    expect(cuerpo).not.toHaveProperty('maquilaBase');
    expect(cuerpo).not.toHaveProperty('corteBase');
  });

  it('MIXTO (perfil de Producción: maquila visible, corte tapado): manda la maquila, no el corte', async () => {
    const cuerpo = await editarSoloDescripcion(modeloDePrueba({ maquila: false, corte: true }));
    expect(cuerpo.maquilaBase).toBe(23.5);
    expect(cuerpo).not.toHaveProperty('corteBase');
  });

  it('MIXTO inverso (maquila tapada, corte visible): manda el corte, no la maquila', async () => {
    const cuerpo = await editarSoloDescripcion(modeloDePrueba({ maquila: true, corte: false }));
    expect(cuerpo).not.toHaveProperty('maquilaBase');
    expect(cuerpo.corteBase).toBe(4.25);
  });

  it('control: VISIBLES, el PATCH sí los manda con su valor', async () => {
    const cuerpo = await editarSoloDescripcion(modeloDePrueba({ maquila: false, corte: false }));
    expect(cuerpo.maquilaBase).toBe(23.5);
    expect(cuerpo.corteBase).toBe(4.25);
  });

  it.each([
    [{ maquila: true, corte: false }, true, false],
    [{ maquila: false, corte: true }, false, true],
    [{ maquila: true, corte: true }, true, true],
    [{ maquila: false, corte: false }, false, false],
  ] as const)(
    'marcas %o ⇒ maquila deshabilitada: %s · corte deshabilitado: %s',
    (ocultos, maquilaDeshabilitada, corteDeshabilitado) => {
      renderConProveedores(
        <DialogoModelo abierto alCambiarAbierto={vi.fn()} modelo={modeloDePrueba(ocultos)} />,
      );
      const maquila = screen.getByLabelText(/Maquila base/);
      const corte = screen.getByLabelText(/^Corte$/);
      if (maquilaDeshabilitada) expect(maquila).toBeDisabled();
      else expect(maquila).toBeEnabled();
      if (corteDeshabilitado) expect(corte).toBeDisabled();
      else expect(corte).toBeEnabled();
    },
  );
});
