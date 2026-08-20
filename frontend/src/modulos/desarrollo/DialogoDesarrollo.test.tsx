import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoDesarrollo } from './DialogoDesarrollo';

/**
 * El selector de modelo del alta de desarrollo (Daniel, ago-2026). El catálogo real tiene ~5,000
 * modelos:
 * el `<select>` anterior sólo traía la PRIMERA página (tope 100) y el modelo recién dado de alta no
 * aparecía. Ahora es un combobox con búsqueda SERVER-SIDE — estas pruebas fijan que (a) sin teclear
 * nada ya ofrece opciones y (b) lo tecleado viaja al API como `busqueda`.
 */
let ultimaQueryModelos: Record<string, unknown> | undefined;
const crearDesarrolloMutate = vi.fn();
const crearModeloNuevoMutate = vi.fn();

vi.mock('@/api/modelos', () => ({
  useModelos: (query: Record<string, unknown>) => {
    ultimaQueryModelos = query;
    const busqueda = typeof query['busqueda'] === 'string' ? query['busqueda'] : '';
    const catalogo = [
      { id: 1, codigo: 'A-100', descripcion: 'Jogger niño' },
      { id: 2, codigo: 'Z-999', descripcion: 'Sudadera dama' },
    ];
    return {
      data: {
        datos:
          busqueda === ''
            ? catalogo
            : catalogo.filter(
                (m) => m.codigo.includes(busqueda) || m.descripcion.includes(busqueda),
              ),
      },
      isPending: false,
      isError: false,
    };
  },
  useGeneros: () => ({ data: [{ id: 3, nombre: 'Caballero' }], isPending: false }),
}));

vi.mock('@/api/calidad', () => ({
  useTiposProductoActivos: () => ({
    data: {
      datos: [
        { id: 4, nombre: 'Pantalón', digitoConcepto: 7 },
        // Sin dígito: el catálogo lo permite, pero un modelo suyo no se puede numerar.
        { id: 6, nombre: 'Ropa interior', digitoConcepto: null },
      ],
    },
    isPending: false,
  }),
}));

vi.mock('@/api/desarrollos', () => ({
  useCrearDesarrollo: () => ({ mutateAsync: crearDesarrolloMutate, isPending: false }),
  useCrearDesarrolloModeloNuevo: () => ({ mutateAsync: crearModeloNuevoMutate, isPending: false }),
}));

describe('<DialogoDesarrollo>', () => {
  beforeEach(() => {
    ultimaQueryModelos = undefined;
    crearDesarrolloMutate.mockReset();
    crearDesarrolloMutate.mockResolvedValue({ id: 9 });
    crearModeloNuevoMutate.mockReset();
    crearModeloNuevoMutate.mockResolvedValue({ id: 9, codigoModelo: 'CYA-26-71-001' });
  });

  it('el selector de modelo ofrece opciones SIN teclear nada (no arranca vacío)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoDesarrollo abierto alCambiarAbierto={() => {}} idProyecto={1} />, {
      sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']),
    });

    await usuario.click(screen.getByTestId('desarrollo-modelo-busqueda'));
    expect(await screen.findAllByTestId('desarrollo-modelo-opcion')).toHaveLength(2);
    // Sin texto no se manda `busqueda`: el servidor devuelve la primera página del catálogo.
    expect(ultimaQueryModelos?.['busqueda']).toBeUndefined();
  });

  it('lo tecleado se BUSCA EN EL SERVIDOR y al elegir se manda el modelo al alta', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoDesarrollo abierto alCambiarAbierto={() => {}} idProyecto={1} />, {
      sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']),
    });

    await usuario.type(screen.getByTestId('desarrollo-modelo-busqueda'), 'Z-999');
    await vi.waitFor(() => expect(ultimaQueryModelos?.['busqueda']).toBe('Z-999'));

    const opciones = await screen.findAllByTestId('desarrollo-modelo-opcion');
    expect(opciones).toHaveLength(1);
    // `fireEvent`: la lista vive en un PORTAL y en jsdom hereda el `pointer-events:none` de radix.
    fireEvent.mouseDown(opciones[0] as HTMLElement);

    await usuario.click(screen.getByTestId('guardar-desarrollo'));
    await vi.waitFor(() =>
      expect(crearDesarrolloMutate).toHaveBeenCalledWith({
        idProyecto: 1,
        cuerpo: { idModelo: 2 },
      }),
    );
  });

  /**
   * Modo «modelo nuevo» tras V1-E3n (§Post-F9.34): el código ya NO se teclea — lo arma el sistema
   * con el cliente del proyecto, el año de ENTREGA y los dos dígitos de tipo de prenda + género.
   */
  it('en «modelo nuevo» NO pide el código: manda tipo, género y año de entrega en UNA llamada', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoDesarrollo abierto alCambiarAbierto={() => {}} idProyecto={7} />, {
      sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']),
    });

    await usuario.selectOptions(screen.getByLabelText('Modelo'), 'nuevo');

    // El campo de código desapareció: si alguien lo repusiera, esta aserción se pone roja.
    expect(screen.queryByLabelText(/Código del modelo nuevo/)).toBeNull();
    expect(screen.getByTestId('aviso-codigo-automatico')).toHaveTextContent('CYA-26-71-001');

    await usuario.selectOptions(screen.getByTestId('desarrollo-tipo-producto'), '4');
    await usuario.selectOptions(screen.getByTestId('desarrollo-genero'), '3');
    await usuario.clear(screen.getByTestId('desarrollo-anio-entrega'));
    await usuario.type(screen.getByTestId('desarrollo-anio-entrega'), '2027');

    await usuario.click(screen.getByTestId('guardar-desarrollo'));

    await vi.waitFor(() =>
      // UNA llamada, con los tres datos de los que sale el código — y NINGÚN código en el cuerpo.
      expect(crearModeloNuevoMutate).toHaveBeenCalledWith({
        idProyecto: 7,
        cuerpo: { anioEntrega: 2027, idTipoProducto: 4, idGenero: 3 },
      }),
    );
    // Y el alta "modelo existente" NO se usó en este camino.
    expect(crearDesarrolloMutate).not.toHaveBeenCalled();
  });

  /**
   * Un tipo de prenda SIN dígito de concepto no puede numerar un modelo. Antes se ofrecía como
   * cualquier otro y el alta reventaba al enviar con *"captúralo en su catálogo"*; ahora se ve, pero
   * no se puede elegir, y el texto dice por qué.
   */
  it('los tipos de prenda SIN dígito se ven deshabilitados, no ofrecidos como buenos', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoDesarrollo abierto alCambiarAbierto={() => {}} idProyecto={1} />, {
      sesion: estadoSesionDePrueba(['desarrollo.ver', 'desarrollo.administrar']),
    });
    await usuario.selectOptions(screen.getByLabelText('Modelo'), 'nuevo');

    const opciones = Array.from(
      screen.getByTestId('desarrollo-tipo-producto').querySelectorAll('option'),
    );
    const conDigito = opciones.find((o) => o.value === '4');
    const sinDigito = opciones.find((o) => o.value === '6');

    // El que sí tiene dígito se puede elegir y lo enseña: "Pantalón (7)".
    expect(conDigito?.disabled).toBe(false);
    expect(conDigito?.textContent).toContain('(7)');
    // El que no, está deshabilitado y dice el motivo — no desaparece (§Post-F9.68: se ve y no se usa).
    expect(sinDigito?.disabled).toBe(true);
    expect(sinDigito?.textContent).toContain('sin dígito');
  });
});
