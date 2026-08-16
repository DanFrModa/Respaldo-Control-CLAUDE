import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Orden } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoOrden } from './DialogoOrden';

// Capa de datos controlada: las pruebas no tocan la red. `useOrden` alimenta el diálogo.
type EstadoOrden = {
  data: Orden | undefined;
  isPending: boolean;
  isError: boolean;
  error: { message: string } | null;
};
const useOrden = vi.fn<() => EstadoOrden>();

/** Argumentos con que el guardado único llama a cada mutación. */
type ArgsMutacion = { id: number; cuerpo: Record<string, unknown> };

// Mutaciones del guardado único: `mutateAsync` resuelve para que el flujo complete.
const actualizarOrden = vi.fn<(args: ArgsMutacion) => Promise<void>>(() => Promise.resolve());
const guardarReferencias = vi.fn<(args: ArgsMutacion) => Promise<void>>(() => Promise.resolve());

vi.mock('@/api/ordenes', () => ({
  useOrden: () => useOrden(),
  useActualizarOrden: () => ({ mutateAsync: actualizarOrden, isPending: false }),
  useGuardarMatriz: () => ({ mutateAsync: vi.fn(() => Promise.resolve()), isPending: false }),
  useCopiarMatriz: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarOrden: () => ({ mutate: vi.fn(), isPending: false }),
  useGuardarReferencias: () => ({ mutateAsync: guardarReferencias, isPending: false }),
  useAgregarComentario: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Campo de referencia D7 activo, para las pruebas que capturan referencias. */
const CAMPO_REF = { id: 1, etiqueta: 'Orden de compra', tipo: 'TEXTO', activo: true, orden: 0 };

// Catálogos/selectores de los paneles del detalle: inertes.
vi.mock('@/api/modelos', () => ({
  useFichaModelo: () => ({ data: { idCurvaTalla: null }, isPending: false, isError: false }),
  useFotosModelo: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/api/colores', () => ({
  useColores: () => ({ data: { datos: [] }, isPending: false }),
  // El alta de color al vuelo de la matriz (§Post-F9.11) usa este hook; aquí no se ejercita.
  useCrearColor: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/tallas', () => ({
  useTallasActivas: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('@/api/etiquetas-marca', () => ({
  useEtiquetasMarca: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('@/api/telas', () => ({
  useTelas: () => ({ data: { datos: [] }, isPending: false }),
}));
// Campos de referencia del cliente (D7) — controlado por prueba.
const useCamposCliente = vi.fn<(id: number | undefined) => unknown>(() => ({
  data: [],
  isPending: false,
  isError: false,
  error: null,
}));
vi.mock('@/api/clientes', () => ({
  useCamposCliente: (id: number | undefined) => useCamposCliente(id),
}));
// Sección "Adjuntos" del detalle (F8-E6): se renderiza siempre; se mockea para no tocar la red.
vi.mock('@/api/adjuntos-orden', () => ({
  useAdjuntosOrden: () => ({ data: [], isPending: false, isError: false }),
  useSubirAdjuntoOrden: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarAdjuntoOrden: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Una orden de ejemplo. */
function orden(
  id: number,
  folio: number,
  opciones: {
    estado?: Orden['estado'];
    idCliente?: number;
    requisitos?: Orden['requisitos'];
  } = {},
): Orden {
  return {
    id,
    folio,
    idEmpresa: 1,
    estado: opciones.estado ?? 'capturada',
    idPedidoLinea: 500 + id,
    idModelo: 10,
    codigoModelo: 'A-100',
    descripcionModelo: 'Playera',
    idCliente: opciones.idCliente ?? 3,
    cliente: 'Liverpool',
    idMaquilero: null,
    maquilero: null,
    idEtiquetaMarca: null,
    etiquetaMarca: null,
    idTela: null,
    tela: null,
    fecha: '2026-06-15',
    fechaEntrega: '2026-06-30',
    observaciones: null,
    composicion: null,
    compForzada: false,
    obsMaquila: null,
    noCostear: false,
    fechaCompletada: null,
    requisitos: opciones.requisitos ?? {
      tallas: true,
      receta: true,
      arte: 'no-aplica' as const,
      completa: true,
      faltantes: [],
    },
    motivoCancelada: opciones.estado === 'cancelada' ? 'Cliente canceló' : null,
    ocCliente: null,
    tallasV1: null,
    maquilaOrd: null,
    aplicacionOrd: null,
    pagada: null,
    enRiesgo: null,
    siRC: null,
    rcViva: null,
    lineas: [],
    totalPiezas: 0,
    referencias: [],
    comentarios: [],
    creadoEn: '2026-06-15T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-06-15T00:00:00.000Z',
    modificadoPorId: null,
  };
}

function consultaConOrden(datos: Orden): EstadoOrden {
  return { data: datos, isPending: false, isError: false, error: null };
}

// La edición completa exige `ordenes.administrar`; cancelar exige `ordenes.cancelar`.
const PERM_TODOS = ['ordenes.ver', 'ordenes.administrar', 'ordenes.cancelar'] as const;

/** Renderiza el diálogo abierto para la orden dada, con la sesión indicada. */
function renderDialogo(
  o: Orden,
  permisos: Parameters<typeof estadoSesionDePrueba>[0],
  alCerrar: () => void = vi.fn(),
): void {
  useOrden.mockReturnValue(consultaConOrden(o));
  renderConProveedores(<DialogoOrden abierto idOrden={o.id} alCerrar={alCerrar} />, {
    sesion: estadoSesionDePrueba(permisos),
  });
}

describe('<DialogoOrden>', () => {
  beforeEach(() => {
    useOrden.mockReset();
    actualizarOrden.mockClear();
    guardarReferencias.mockClear();
    useCamposCliente.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      error: null,
    });
  });

  it('muestra el detalle de la orden (encabezado + matriz)', () => {
    renderDialogo(orden(1, 101), [...PERM_TODOS]);

    expect(screen.getByTestId('dialogo-orden')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Orden 101/ })).toBeInTheDocument();
    expect(screen.getByTestId('detalle-orden')).toBeInTheDocument();
  });

  it('oculta las acciones de escritura para quien solo puede ver', () => {
    renderDialogo(orden(1, 101), ['ordenes.ver']);

    expect(screen.queryByTestId('cancelar-orden')).not.toBeInTheDocument();
    // Guardado único (Daniel 24-jul-2026): ya no hay un botón por sección, y el pie con el botón
    // único ni siquiera se pinta sin `ordenes.administrar`.
    expect(screen.queryByTestId('guardar-encabezado')).not.toBeInTheDocument();
    expect(screen.queryByTestId('guardar-matriz')).not.toBeInTheDocument();
    expect(screen.queryByTestId('guardar-referencias')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pie-orden')).not.toBeInTheDocument();
  });

  it('muestra el badge de estado DERIVADO (sin botón "marcar completa")', () => {
    renderDialogo(orden(1, 101, { estado: 'completa' }), [...PERM_TODOS]);

    const detalle = screen.getByTestId('detalle-orden');
    expect(within(detalle).getAllByTestId('estado-orden')[0]).toHaveTextContent('Completa');
    expect(
      within(detalle).queryByRole('button', { name: /marcar completa/i }),
    ).not.toBeInTheDocument();
  });

  it('dice QUÉ LE FALTA a la orden para completarse (estado automático, 26-jul-2026)', () => {
    renderDialogo(
      orden(1, 101, {
        estado: 'capturada',
        requisitos: {
          tallas: true,
          receta: false,
          arte: 'no-aplica' as const,
          completa: false,
          faltantes: ['receta'],
        },
      }),
      [...PERM_TODOS],
    );

    const detalle = screen.getByTestId('detalle-orden');
    expect(within(detalle).getAllByTestId('estado-orden')[0]).toHaveTextContent('Capturada');
    expect(within(detalle).getAllByTestId('faltantes-orden')[0]).toHaveTextContent(
      'Falta: liberar la receta',
    );
  });

  it('una orden CANCELADA no lista requisitos pendientes', () => {
    renderDialogo(
      orden(3, 103, {
        estado: 'cancelada',
        requisitos: {
          tallas: false,
          receta: false,
          arte: 'no-aplica' as const,
          completa: false,
          faltantes: ['tallas', 'receta'],
        },
      }),
      [...PERM_TODOS],
    );

    expect(screen.queryByTestId('faltantes-orden')).not.toBeInTheDocument();
  });

  it('una orden cancelada muestra su motivo y no ofrece cancelar', () => {
    renderDialogo(orden(3, 103, { estado: 'cancelada' }), [...PERM_TODOS]);

    const detalle = screen.getByTestId('detalle-orden');
    expect(within(detalle).getByText(/Cliente canceló/)).toBeInTheDocument();
    expect(screen.queryByTestId('cancelar-orden')).not.toBeInTheDocument();
  });

  it('cancelar exige un motivo: el botón de confirmar arranca deshabilitado', async () => {
    const usuario = userEvent.setup();
    renderDialogo(orden(7, 107), [...PERM_TODOS]);

    await usuario.click(screen.getByTestId('cancelar-orden'));
    // El diálogo de cancelación (Radix) se identifica por su encabezado, no por rol genérico:
    // el propio panel de edición también es un `dialog`.
    expect(await screen.findByRole('heading', { name: /Cancelar orden/ })).toBeInTheDocument();
    // Sin motivo, confirmar está deshabilitado.
    expect(screen.getByTestId('confirmar-cancelar-orden')).toBeDisabled();
    // Con motivo, se habilita.
    await usuario.type(screen.getByTestId('orden-motivo-cancelar'), 'Falta de tela');
    expect(screen.getByTestId('confirmar-cancelar-orden')).toBeEnabled();
  });

  it('muestra los campos de referencia ACTIVOS del cliente de la orden (D7)', () => {
    useCamposCliente.mockReturnValue({
      data: [
        { id: 1, etiqueta: 'Orden de compra', tipo: 'TEXTO', activo: true, orden: 0 },
        { id: 2, etiqueta: 'Temporada', tipo: 'TEXTO', activo: false, orden: 1 },
      ],
      isPending: false,
      isError: false,
      error: null,
    });
    renderDialogo(orden(1, 101), [...PERM_TODOS]);

    const detalle = screen.getByTestId('detalle-orden');
    // El campo activo aparece; el inactivo NO.
    expect(within(detalle).getByLabelText('Orden de compra')).toBeInTheDocument();
    expect(within(detalle).queryByLabelText('Temporada')).not.toBeInTheDocument();
  });
});

describe('<DialogoOrden> — guardado ÚNICO (Daniel 24-jul-2026)', () => {
  beforeEach(() => {
    useOrden.mockReset();
    actualizarOrden.mockClear();
    guardarReferencias.mockClear();
    useCamposCliente.mockReturnValue({ data: [], isPending: false, isError: false, error: null });
  });

  it('hay UN solo botón "Guardar" en el pie y arranca deshabilitado (sin cambios)', () => {
    renderDialogo(orden(1, 101), [...PERM_TODOS]);

    expect(screen.getByTestId('pie-orden')).toBeInTheDocument();
    expect(screen.getByTestId('guardar-orden')).toBeDisabled();
    expect(screen.getByTestId('aviso-cambios-orden')).toHaveTextContent('Sin cambios pendientes');
    // Los botones por sección desaparecieron.
    expect(screen.queryByTestId('guardar-encabezado')).not.toBeInTheDocument();
    expect(screen.queryByTestId('guardar-matriz')).not.toBeInTheDocument();
    expect(screen.queryByTestId('guardar-referencias')).not.toBeInTheDocument();
  });

  it('abrir una orden CON matriz y referencias no anuncia cambios que nadie hizo', async () => {
    useCamposCliente.mockReturnValue({
      data: [{ id: 1, etiqueta: 'Orden de compra', tipo: 'TEXTO', activo: true, orden: 0 }],
      isPending: false,
      isError: false,
      error: null,
    });
    renderDialogo(
      {
        ...orden(1, 101),
        lineas: [
          {
            id: 11,
            idColor: 2,
            color: 'Rojo',
            pantone: null,
            totalPiezas: 10,
            tallas: [{ idTalla: 1, etiquetaTalla: 'CH', cantidad: 10 }],
          },
        ],
        totalPiezas: 10,
        referencias: [{ id: 7, idClienteCampo: 1, etiqueta: 'Orden de compra', valor: 'OC-1' }],
      },
      [...PERM_TODOS],
    );

    // Ni al montar ni tras estabilizarse: nada está sucio hasta que el usuario toque algo.
    expect(screen.getByTestId('guardar-orden')).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByTestId('aviso-cambios-orden')).toHaveTextContent('Sin cambios pendientes'),
    );
    expect(screen.getByTestId('guardar-orden')).toBeDisabled();
  });

  it('al editar el encabezado se habilita y guarda TODO con un clic', async () => {
    const usuario = userEvent.setup();
    renderDialogo(orden(1, 101), [...PERM_TODOS]);

    await usuario.type(screen.getByLabelText('Composición'), '60% algodón');
    const guardarBoton = screen.getByTestId('guardar-orden');
    await waitFor(() => expect(guardarBoton).toBeEnabled());
    expect(screen.getByTestId('aviso-cambios-orden')).toHaveTextContent('cambios sin guardar');

    await usuario.click(guardarBoton);
    await waitFor(() => expect(actualizarOrden).toHaveBeenCalledTimes(1));
    const args = actualizarOrden.mock.calls[0]?.[0];
    expect(args).toMatchObject({ id: 1, cuerpo: { composicion: '60% algodón' } });
    // La bandera `compForzada` YA NO viaja desde la UI: la deriva el backend.
    expect(args?.cuerpo).not.toHaveProperty('compForzada');
  });

  it('cerrar con cambios pregunta antes de salir (Guardar y salir / Salir sin guardar)', async () => {
    const usuario = userEvent.setup();
    const alCerrar = vi.fn();
    renderDialogo(orden(1, 101), [...PERM_TODOS], alCerrar);

    await usuario.type(screen.getByLabelText('Composición'), 'algo');
    await waitFor(() => expect(screen.getByTestId('guardar-orden')).toBeEnabled());

    await usuario.click(screen.getByTestId('dialogo-orden-cerrar'));
    expect(await screen.findByRole('heading', { name: /Cambios sin guardar/ })).toBeInTheDocument();
    expect(alCerrar).not.toHaveBeenCalled();

    // "Salir sin guardar" cierra sin mandar nada.
    await usuario.click(screen.getByTestId('salir-sin-guardar-orden'));
    expect(alCerrar).toHaveBeenCalledTimes(1);
    expect(actualizarOrden).not.toHaveBeenCalled();
  });

  it('sin cambios, cerrar NO pregunta', async () => {
    const usuario = userEvent.setup();
    const alCerrar = vi.fn();
    renderDialogo(orden(1, 101), [...PERM_TODOS], alCerrar);

    await usuario.click(screen.getByTestId('dialogo-orden-cerrar'));
    expect(alCerrar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: /Cambios sin guardar/ })).not.toBeInTheDocument();
  });

  it('un doble clic NO dispara dos rondas de guardado', async () => {
    const usuario = userEvent.setup();
    // El PATCH tarda: da tiempo al segundo clic mientras la primera ronda sigue en vuelo.
    let resolver: (() => void) | undefined;
    actualizarOrden.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolver = r;
        }),
    );
    renderDialogo(orden(1, 101), [...PERM_TODOS]);

    await usuario.type(screen.getByLabelText('Composición'), 'algo');
    const guardarBoton = screen.getByTestId('guardar-orden');
    await waitFor(() => expect(guardarBoton).toBeEnabled());

    await usuario.click(guardarBoton);
    await usuario.click(guardarBoton);
    resolver?.();

    await waitFor(() => expect(guardarBoton).toBeDisabled());
    expect(actualizarOrden).toHaveBeenCalledTimes(1);
  });

  it('si una sección falla, lo capturado en las OTRAS sigue en pantalla para reintentar', async () => {
    const usuario = userEvent.setup();
    useCamposCliente.mockReturnValue({
      data: [CAMPO_REF],
      isPending: false,
      isError: false,
      error: null,
    });
    // El encabezado se guarda bien; las referencias truenan (el 2º paso de la tanda).
    guardarReferencias.mockRejectedValueOnce(new Error('La red falló'));
    renderDialogo(orden(1, 101), [...PERM_TODOS]);

    await usuario.type(screen.getByLabelText('Composición'), '60% algodón');
    const campoRef = screen.getByLabelText('Orden de compra');
    await usuario.type(campoRef, 'OC-999');
    await waitFor(() => expect(screen.getByTestId('guardar-orden')).toBeEnabled());

    expect(screen.getByLabelText('Orden de compra')).toHaveValue('OC-999');
    await usuario.click(screen.getByTestId('guardar-orden'));
    await waitFor(() => expect(guardarReferencias).toHaveBeenCalledTimes(1));

    // Lo tecleado NO se perdió (ni el encabezado ya guardado ni la referencia que falló) y el
    // diálogo sigue anunciando cambios pendientes: se puede reintentar sin recapturar.
    await waitFor(() => expect(screen.getByLabelText('Orden de compra')).toHaveValue('OC-999'));
    expect(screen.getByLabelText('Composición')).toHaveValue('60% algodón');
    expect(screen.getByTestId('aviso-cambios-orden')).toHaveTextContent('cambios sin guardar');
    expect(screen.getByTestId('guardar-orden')).toBeEnabled();
  });
});

describe('<DialogoOrden> — composición heredada del modelo (Daniel 24-jul-2026)', () => {
  beforeEach(() => {
    useOrden.mockReset();
    useCamposCliente.mockReturnValue({ data: [], isPending: false, isError: false, error: null });
  });

  it('sin override explica que se hereda del modelo y no ofrece "volver a la del modelo"', () => {
    renderDialogo(orden(1, 101), [...PERM_TODOS]);

    expect(screen.getByTestId('orden-composicion-origen')).toHaveTextContent(
      /Se hereda de la ficha del modelo/,
    );
    expect(screen.queryByTestId('orden-composicion-del-modelo')).not.toBeInTheDocument();
    // La casilla manual "Composición capturada a mano" se retiró (la deriva el backend).
    expect(screen.queryByTestId('orden-comp-forzada')).not.toBeInTheDocument();
  });

  it('con override avisa y ofrece volver a la del modelo (vacía el campo)', async () => {
    const usuario = userEvent.setup();
    renderDialogo({ ...orden(1, 101), composicion: 'MEZCLA ESPECIAL', compForzada: true }, [
      ...PERM_TODOS,
    ]);

    expect(screen.getByTestId('orden-composicion-origen')).toHaveTextContent(
      /Editada en esta orden/,
    );
    const campo = screen.getByLabelText('Composición');
    expect(campo).toHaveValue('MEZCLA ESPECIAL');

    await usuario.click(screen.getByTestId('orden-composicion-del-modelo'));
    expect(campo).toHaveValue('');
    // Vaciar es un cambio pendiente: el guardado único se habilita.
    await waitFor(() => expect(screen.getByTestId('guardar-orden')).toBeEnabled());
  });
});

// ── Reinicio tras el REFETCH ─────────────────────────────────────────────────────────────────
// El resto del archivo mockea `useOrden` con un valor ESTÁTICO, así que el ciclo real —guardar →
// invalidar → la orden VUELVE del servidor— nunca se ejerce en unitarias y su único guardián era
// el e2e (que no corre en local). Aquí `useOrden` se alimenta de un STORE EXTERNO: publicar una
// orden nueva aterriza el refetch de verdad sobre el diálogo YA montado, que es donde vivía el
// defecto de jul-2026 (la sección de referencias se quedaba "sucia" para siempre porque su clave
// de reinicio solo miraba `modificadoEn`).

/** Suscriptores del store (los `useSyncExternalStore` montados). */
const suscriptoresOrden = new Set<() => void>();
/** Lo que "responde el servidor" ahora mismo. */
let ordenServidor: Orden;

/** `useOrden` respaldado por el store externo (nombre `use*`: es el hook del componente). */
function useOrdenDelStore(): EstadoOrden {
  const datos = useSyncExternalStore(
    (avisar: () => void) => {
      suscriptoresOrden.add(avisar);
      return () => {
        suscriptoresOrden.delete(avisar);
      };
    },
    () => ordenServidor,
  );
  return consultaConOrden(datos);
}

describe('<DialogoOrden> — el refetch re-sincroniza las referencias', () => {
  /** Publica lo que responde el servidor y despierta al diálogo montado (el refetch). */
  function publicar(nueva: Orden): void {
    ordenServidor = nueva;
    act(() => {
      for (const avisar of suscriptoresOrden) {
        avisar();
      }
    });
  }

  /** La orden del servidor con ESA referencia capturada (y, si se pide, otro sello A7). */
  function conReferencia(valor: string, modificadoEn?: string): Orden {
    return {
      ...ordenServidor,
      referencias: [{ id: 1, idClienteCampo: CAMPO_REF.id, etiqueta: CAMPO_REF.etiqueta, valor }],
      ...(modificadoEn === undefined ? {} : { modificadoEn }),
    };
  }

  beforeEach(() => {
    suscriptoresOrden.clear();
    ordenServidor = orden(1, 101);
    guardarReferencias.mockReset();
    guardarReferencias.mockImplementation(() => Promise.resolve());
    useCamposCliente.mockReturnValue({
      data: [CAMPO_REF],
      isPending: false,
      isError: false,
      error: null,
    });
    useOrden.mockReset();
    useOrden.mockImplementation(useOrdenDelStore);
    renderConProveedores(<DialogoOrden abierto idOrden={1} alCerrar={vi.fn()} />, {
      sesion: estadoSesionDePrueba([...PERM_TODOS]),
    });
  });

  it('(A) tras guardar, el refetch con la referencia nueva deja la sección LIMPIA aunque el sello no se mueva', async () => {
    const usuario = userEvent.setup();
    await usuario.type(screen.getByLabelText('Orden de compra'), 'OC-1');
    await waitFor(() => expect(screen.getByTestId('guardar-orden')).toBeEnabled());

    await usuario.click(screen.getByTestId('guardar-orden'));
    await waitFor(() => expect(guardarReferencias).toHaveBeenCalledTimes(1));
    // El servidor YA tiene la referencia; en este escenario `modificadoEn` no cambió para nosotros
    // (p. ej. la respuesta que aterriza es la de otro guardado). La firma de valores lo delata.
    publicar(conReferencia('OC-1'));

    await waitFor(() => expect(screen.getByTestId('guardar-orden')).toBeDisabled());
    expect(screen.getByTestId('aviso-cambios-orden')).toHaveTextContent('Sin cambios pendientes');
  });

  // (D) es el caso DISCRIMINANTE de la firma de valores en la clave de reinicio: sin ella (clave
  // solo por `modificadoEn`) esta prueba falla, aunque (A) y (C) sigan pasando. No la quites.
  it('(D) sin tocar nada, un refetch con OTRAS referencias re-sincroniza la pantalla', async () => {
    expect(screen.getByLabelText('Orden de compra')).toHaveValue('');

    publicar(conReferencia('OC-9'));

    await waitFor(() => expect(screen.getByLabelText('Orden de compra')).toHaveValue('OC-9'));
    expect(screen.getByTestId('guardar-orden')).toBeDisabled();
  });

  it('(C) si el guardado FALLA, un refetch posterior NO pisa lo capturado', async () => {
    const usuario = userEvent.setup();
    guardarReferencias.mockRejectedValueOnce(new Error('La red falló'));
    await usuario.type(screen.getByLabelText('Orden de compra'), 'OC-7');
    await waitFor(() => expect(screen.getByTestId('guardar-orden')).toBeEnabled());

    await usuario.click(screen.getByTestId('guardar-orden'));
    await waitFor(() => expect(guardarReferencias).toHaveBeenCalledTimes(1));
    // Aterriza un refetch (el servidor sigue SIN la referencia y con otro sello): el bloqueo de
    // reinicio debe conservar lo tecleado para poder reintentar sin recapturar.
    publicar({ ...ordenServidor, modificadoEn: '2026-06-20T00:00:00.000Z' });

    await waitFor(() =>
      expect(screen.getByTestId('aviso-cambios-orden')).toHaveTextContent('cambios sin guardar'),
    );
    expect(screen.getByLabelText('Orden de compra')).toHaveValue('OC-7');
    expect(screen.getByTestId('guardar-orden')).toBeEnabled();
  });
});
