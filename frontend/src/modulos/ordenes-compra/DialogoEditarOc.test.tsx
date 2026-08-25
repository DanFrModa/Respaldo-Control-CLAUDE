import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoEditarOc } from './DialogoEditarOc';
import { ocDePrueba } from './fixtures';

/**
 * Pruebas del selector de PROVEEDOR del diálogo de OC (ajuste 07-ago-2026): la lista se acota al
 * rol que piden los renglones (solo telas → «Vende telas»; solo avíos → «Vende avíos»; mezclada o
 * libre → todos) y NUNCA pierde el proveedor ya capturado aunque no cumpla el rol vigente.
 */

// Espía del código de rol con el que el diálogo pide los proveedores + catálogo simulado por rol.
const { espiaRolProveedor, toastError } = vi.hoisted(() => ({
  espiaRolProveedor: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: (mensaje: string): void => {
      toastError(mensaje);
    },
  },
}));

const PROVEEDORES_POR_ROL: Record<string, { id: number; nombre: string }[]> = {
  'vende-telas': [
    { id: 5, nombre: 'Telas del Norte' },
    { id: 21, nombre: 'Bloom Textil' },
  ],
  'vende-avios': [{ id: 9, nombre: 'Avíos Monterrey' }],
  // Sin acotar: el catálogo completo (incluye un maquilero, que no vende material).
  todos: [
    { id: 5, nombre: 'Telas del Norte' },
    { id: 9, nombre: 'Avíos Monterrey' },
    { id: 12, nombre: 'Taller Montaño' },
  ],
};

/**
 * El mock EMULA AL SERVIDOR: filtra por `busqueda` con «contiene», que es exactamente lo que hace
 * `idsPorNombreSinAcentos` (`LIKE %texto%`). Sin esto, la prueba de «buscar por cualquier palabra»
 * pasaría aunque el filtro no llegara nunca al API.
 */
vi.mock('@/api/proveedores', () => ({
  COD_ROL_PROVEEDOR: { vendeTelas: 'vende-telas', vendeAvios: 'vende-avios' },
  useProveedoresPorRol: (codigo: string | undefined, filtros?: { busqueda?: string }) => {
    espiaRolProveedor(codigo);
    const todos = PROVEEDORES_POR_ROL[codigo ?? 'todos'] ?? [];
    const busqueda = (filtros?.busqueda ?? '').toLowerCase();
    return {
      data: {
        datos:
          busqueda === '' ? todos : todos.filter((p) => p.nombre.toLowerCase().includes(busqueda)),
      },
      isPending: false,
    };
  },
}));

vi.mock('@/api/ordenes-compra', () => ({
  useCrearOc: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarOc: () => ({ mutate: vi.fn(), isPending: false }),
}));
const espiaTelasQuery = vi.fn<(query: { idProveedor?: number }, opciones?: unknown) => void>();
/**
 * Telas por proveedor. La de Bloom lleva COMPLEMENTO (§Post-F9.18) y las dos declaran su
 * `unidadMedida`: en un renglón de tela la unidad la manda la tela, no se teclea.
 */
const TELAS_POR_PROVEEDOR: Record<
  number,
  { id: number; nombre: string; unidadMedida: 'KG' | 'M'; nombreComplemento: string | null }[]
> = {
  5: [{ id: 30, nombre: 'Felpa Alsatex', unidadMedida: 'KG', nombreComplemento: null }],
  21: [{ id: 40, nombre: 'Mesh Bloom', unidadMedida: 'M', nombreComplemento: 'Cardigan' }],
};
vi.mock('@/api/telas', () => ({
  etiquetaUnidadTela: (unidad: 'KG' | 'M') => (unidad === 'KG' ? 'kg' : 'm'),
  useTelas: (query: { idProveedor?: number }, opciones?: { enabled?: boolean }) => {
    espiaTelasQuery(query, opciones);
    return {
      data: {
        datos:
          query.idProveedor === undefined ? [] : (TELAS_POR_PROVEEDOR[query.idProveedor] ?? []),
      },
    };
  },
}));

// Catálogo de direcciones de entrega (§Post-F9.18): la OC ya no teclea la dirección, la elige.
vi.mock('@/api/direcciones-entrega', () => ({
  useDireccionesEntregaActivas: () => ({
    data: {
      datos: [
        { id: 7, nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123', favorita: true },
        { id: 8, nombre: 'Bodega Montaño', direccion: 'Calle 5 #10', favorita: false },
      ],
    },
    isPending: false,
  }),
}));
vi.mock('@/api/avios', () => ({ useAvios: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/colores', () => ({ useColores: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/tallas', () => ({ useTallasActivas: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/ordenes-consulta', () => ({
  useConsultaOrdenes: () => ({ data: { datos: [] } }),
}));

/** Renderiza el diálogo abierto (alta si no se pasa `oc`). */
function montar(oc?: ReturnType<typeof ocDePrueba>): void {
  renderConProveedores(
    <DialogoEditarOc
      abierto
      alCambiarAbierto={vi.fn()}
      alGuardada={vi.fn()}
      {...(oc === undefined ? {} : { oc })}
    />,
    { sesion: estadoSesionDePrueba(['compras.administrar']) },
  );
}

/**
 * V1-E7g: el proveedor ya NO se elige de un `<select>` nativo sino del `SelectorProveedor`
 * (combobox con búsqueda EN SERVIDOR). La lista vive en un PORTAL fuera del diálogo, así que se
 * lee desde `screen`, no desde el contenedor; y el combobox elige en `mousedown`, no en `click`.
 */
function abrirProveedor(): HTMLElement {
  const input = screen.getByTestId('oc-proveedor-busqueda');
  fireEvent.focus(input);
  return input;
}

/** Nombres de las opciones ofrecidas por el selector de proveedor con la lista abierta. */
async function opcionesProveedor(): Promise<string[]> {
  abrirProveedor();
  const opciones = await screen.findAllByTestId('oc-proveedor-opcion');
  return opciones.map((opcion) => opcion.textContent ?? '');
}

/** Teclea `texto` en el selector y elige la opción cuyo nombre coincide. */
async function elegirProveedor(texto: string, nombre = texto): Promise<void> {
  const input = abrirProveedor();
  fireEvent.change(input, { target: { value: texto } });
  // `findAll…` cubre el debounce de 300 ms de la búsqueda server-side.
  const opciones = await screen.findAllByTestId('oc-proveedor-opcion');
  const elegida = opciones.find((opcion) => (opcion.textContent ?? '').includes(nombre));
  if (elegida === undefined) {
    throw new Error(`El selector no ofreció "${nombre}" al teclear "${texto}"`);
  }
  fireEvent.mouseDown(elegida);
}

describe('DialogoEditarOc · proveedor acotado por los renglones', () => {
  it('en una OC nueva (renglón de tela por defecto) solo lista proveedores de telas', async () => {
    montar();
    expect(espiaRolProveedor).toHaveBeenCalledWith('vende-telas');
    expect(await opcionesProveedor()).toEqual(['Telas del Norte', 'Bloom Textil']);
    expect(screen.getByTestId('oc-proveedor-ayuda')).toHaveTextContent('«Vende telas»');
  });

  it('al cambiar el renglón a avío, cambia a proveedores de avíos', async () => {
    montar();
    fireEvent.change(screen.getByLabelText('Tipo de material del renglón 1'), {
      target: { value: 'avio' },
    });
    expect(espiaRolProveedor).toHaveBeenCalledWith('vende-avios');
    expect(await opcionesProveedor()).toEqual(['Avíos Monterrey']);
    expect(screen.getByTestId('oc-proveedor-ayuda')).toHaveTextContent('«Vende avíos»');
  });

  it('con renglones de tela Y de avío no acota: la OC mixta es legítima', async () => {
    montar();
    fireEvent.click(screen.getByTestId('agregar-renglon-oc'));
    fireEvent.change(screen.getByLabelText('Tipo de material del renglón 2'), {
      target: { value: 'avio' },
    });
    expect(espiaRolProveedor).toHaveBeenCalledWith(undefined);
    expect(await opcionesProveedor()).toEqual([
      'Telas del Norte',
      'Avíos Monterrey',
      'Taller Montaño',
    ]);
    expect(screen.queryByTestId('oc-proveedor-ayuda')).not.toBeInTheDocument();
  });

  it('conserva el proveedor ya capturado aunque no cumpla el rol vigente', () => {
    // OC migrada: su proveedor (id 12) no tiene el rol «Vende telas», pero la OC pide tela. El
    // combobox lo sigue MOSTRANDO por su `nombreSeleccionado` aunque la búsqueda acotada al rol
    // no lo devuelva (antes hacía falta inyectarle un `<option>` extra a mano).
    montar(ocDePrueba({ idProveedor: 12, proveedor: 'Taller Montaño' }));
    expect(screen.getByTestId('oc-proveedor-busqueda')).toHaveValue('Taller Montaño');
  });
});

/**
 * ⭐ EL DEFECTO QUE REPORTÓ DANIEL (§Post-F9.52 punto 7, cuarta reaparición): «para seleccionar a un
 * proveedor al dar de alta una nueva OC independiente, el proveedor no busca por todas sus
 * palabras. Busca sólo por orden alfabético».
 *
 * La causa nunca estuvo en el servidor —`idsPorNombreSinAcentos` hace `LIKE %texto%`, casa en
 * MEDIO del nombre— sino en la pantalla: un `<select>` nativo solo deja «buscar tecleando» con el
 * typeahead del navegador, que pega ÚNICAMENTE por prefijo (y encima topaba en 100 proveedores).
 *
 * Estas pruebas mueren si el campo vuelve a ser un `<select>`: un `<select>` no tiene dónde teclear
 * «norte», y el helper no encontraría la opción.
 */
describe('DialogoEditarOc · el proveedor se busca por CUALQUIER palabra (§Post-F9.52 punto 7)', () => {
  it('teclear una palabra de EN MEDIO del nombre encuentra al proveedor', async () => {
    montar();
    // "norte" es la TERCERA palabra de «Telas del Norte»: el typeahead por prefijo del `<select>`
    // nativo jamás lo habría encontrado.
    await elegirProveedor('norte', 'Telas del Norte');
    expect(screen.getByTestId('oc-proveedor-busqueda')).toHaveValue('Telas del Norte');
  });

  it('lo tecleado viaja como búsqueda al servidor y acota la lista', async () => {
    montar();
    fireEvent.focus(screen.getByTestId('oc-proveedor-busqueda'));
    fireEvent.change(screen.getByTestId('oc-proveedor-busqueda'), { target: { value: 'textil' } });
    // De los dos proveedores de telas, «textil» solo casa con Bloom Textil — y casa al FINAL.
    await waitFor(async () => {
      const opciones = await screen.findAllByTestId('oc-proveedor-opcion');
      expect(opciones.map((o) => o.textContent)).toEqual(['Bloom Textil']);
    });
  });
});

describe('DialogoEditarOc · la tela es DEL proveedor (§Post-F9.15)', () => {
  it('sin proveedor NO consulta telas y el combo lo explica', () => {
    montar();

    // La consulta queda APAGADA: pedir "todas" ofrecería telas que esta OC no puede comprar.
    const primeraLlamada = espiaTelasQuery.mock.calls[0];
    expect(primeraLlamada?.[0]).not.toHaveProperty('idProveedor');
    expect(primeraLlamada?.[1]).toEqual({ enabled: false });
    expect(screen.getByTestId('selector-tela-oc')).toHaveTextContent('Elige primero el proveedor');
  });

  it('al elegir proveedor solo ofrece SUS telas', async () => {
    montar();
    await elegirProveedor('Telas del Norte');

    const selector = screen.getByTestId('selector-tela-oc');
    expect(within(selector).getByRole('option', { name: 'Felpa Alsatex' })).toBeInTheDocument();
    expect(within(selector).queryByRole('option', { name: 'Mesh Bloom' })).not.toBeInTheDocument();
  });

  it('cambiar de proveedor LIMPIA las telas capturadas (eran de otro) y avisa', async () => {
    montar();
    await elegirProveedor('Telas del Norte');
    fireEvent.change(screen.getByTestId('selector-tela-oc'), { target: { value: '30' } });
    expect(screen.getByTestId('selector-tela-oc')).toHaveValue('30');

    await elegirProveedor('Bloom Textil');
    // El renglón se conserva, pero su tela se vacía: hay que elegir una del proveedor nuevo.
    expect(screen.getByTestId('selector-tela-oc')).toHaveValue('');
    expect(
      within(screen.getByTestId('selector-tela-oc')).getByRole('option', {
        name: 'Mesh Bloom',
      }),
    ).toBeInTheDocument();
  });
});

describe('DialogoEditarOc · reglas de captura de Daniel (§Post-F9.18)', () => {
  it('la fecha de emisión NO es un campo: dice que la pone el sistema', () => {
    montar();
    const fecha = screen.getByTestId('oc-fecha');
    // Antes era un <input type="date"> editable; ahora es texto.
    expect(fecha.tagName).toBe('P');
    expect(fecha).toHaveTextContent('Hoy');
  });

  it('al editar una OC muestra SU fecha de emisión, tampoco editable', () => {
    montar(ocDePrueba({ fecha: '2026-06-20' }));
    expect(screen.getByTestId('oc-fecha')).toHaveTextContent('2026-06-20');
  });

  it('la dirección de entrega es un catálogo y preselecciona la favorita con su texto', () => {
    montar();
    expect(screen.getByTestId('oc-direccion-entrega')).toHaveValue('7');
    expect(screen.getByTestId('oc-direccion-entrega-texto')).toHaveTextContent(
      'Av. Siempre Viva 123',
    );
    // El texto libre "Entregar en" desapareció: la dirección ya no se teclea.
    expect(screen.queryByTestId('oc-entrega-en')).not.toBeInTheDocument();
  });

  it('al cambiar de dirección se actualiza el texto que saldrá impreso', () => {
    montar();
    fireEvent.change(screen.getByTestId('oc-direccion-entrega'), { target: { value: '8' } });
    expect(screen.getByTestId('oc-direccion-entrega-texto')).toHaveTextContent('Calle 5 #10');
  });

  it('sin fecha de entrega no guarda (es obligatoria)', async () => {
    montar();
    // El botón se habilita al elegir proveedor; la fecha de entrega es el siguiente candado.
    await elegirProveedor('Telas del Norte');
    fireEvent.click(screen.getByTestId('confirmar-oc'));
    expect(toastError).toHaveBeenCalledWith('Captura la fecha de entrega: es obligatoria.');
  });

  it('la unidad de un renglón de tela la manda la tela y no se teclea', async () => {
    montar();
    await elegirProveedor('Telas del Norte');
    fireEvent.change(screen.getByTestId('selector-tela-oc'), { target: { value: '30' } });
    // Felpa Alsatex se compra en KG.
    const unidad = screen.getByTestId('unidad-oc');
    expect(unidad).toHaveValue('kg');
    expect(unidad).toBeDisabled();
  });

  it('una tela CON complemento abre el campo del Cardigan; una sin él, no', async () => {
    montar();
    // Bloom (21) vende "Mesh Bloom", que lleva Cardigan.
    await elegirProveedor('Bloom Textil');
    expect(screen.queryByTestId('complemento-oc')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('selector-tela-oc'), { target: { value: '40' } });
    expect(screen.getByTestId('complemento-oc')).toHaveTextContent('Cardigan');
    expect(screen.getByTestId('cantidad-complemento-oc')).toBeInTheDocument();
  });

  it('dice que cada renglón se liga a su propia OP (una OC puede surtir varias)', () => {
    montar();
    expect(screen.getByTestId('ayuda-varias-ordenes-oc')).toHaveTextContent('varias OP');
  });
});
