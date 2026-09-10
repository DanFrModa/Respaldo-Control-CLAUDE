import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClavePermiso, ConceptoPago, ConceptosPagoPagina } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ConceptosPagoPagina as Pagina } from './ConceptosPagoPagina';

/**
 * EL CATÁLOGO DE CONCEPTOS DE PAGO QUE NO SON PROVEEDORES (fila 0.125), medido donde importa:
 *
 *  • ⭐ `predeterminado` se VE y se puede alternar — es la marca que hace que «caja chica» o «nómina
 *    por fuera» se carguen solas, en cero, en cada corrida nueva: *«no quiero que se me vaya a
 *    olvidar ponerlo»*. Si no se ve cuál está marcado, la marca no sirve de nada;
 *  • el alta manda el cuerpo correcto (rubro incluido: decide en qué sección de la relación cae);
 *  • ⭐ **la reja del permiso**: con sólo `conceptos-pago.ver` la lista se ve pero no hay forma de
 *    tocar nada. Dar de alta un concepto es dar de alta A DÓNDE puede salir dinero fuera del padrón
 *    de proveedores, y por eso `administrar` es sólo del administrador.
 *
 * Los hooks se mockean: aquí se mide la PANTALLA (qué pinta y qué manda), no la capa de datos.
 */

/** Estado mutable de los hooks mockeados (objeto estable para el factory de `vi.mock`). */
const estado: { lista: unknown } = { lista: null };
const creado = { cuerpos: [] as unknown[] };
const editado = { llamadas: [] as unknown[] };

vi.mock('@/api/pagos', () => ({
  useConceptosPago: () => estado.lista,
  useCrearConceptoPago: () => ({
    mutate: (cuerpo: unknown) => creado.cuerpos.push(cuerpo),
    isPending: false,
  }),
  useEditarConceptoPago: () => ({
    mutate: (args: unknown) => editado.llamadas.push(args),
    isPending: false,
  }),
  useCrearCuentaConcepto: () => ({ mutate: vi.fn(), isPending: false }),
  useEditarCuentaConcepto: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Un concepto del catálogo tal como lo manda el servidor. */
function concepto(parcial: Partial<ConceptoPago> = {}): ConceptoPago {
  return {
    id: 1,
    nombre: 'Caja chica',
    rubro: 'caja_chica',
    formaPagoPreferida: 'efectivo',
    predeterminado: true,
    notas: null,
    activo: true,
    cuentas: [],
    ...parcial,
  };
}

const CATALOGO: ConceptosPagoPagina = {
  datos: [
    concepto(),
    concepto({
      id: 2,
      nombre: 'Agua',
      rubro: 'servicios',
      formaPagoPreferida: 'transferencia',
      // Éste NO se carga solo: se agrega a mano cuando hace falta.
      predeterminado: false,
    }),
  ],
  total: 2,
  pagina: 1,
  porPagina: 100,
  totalPaginas: 1,
};

function pintar(
  permisos: ClavePermiso[] = ['conceptos-pago.ver', 'conceptos-pago.administrar'],
): void {
  renderConProveedores(<Pagina />, { sesion: estadoSesionDePrueba(permisos) });
}

/**
 * El renglón de un concepto, buscado por su NOMBRE y no por su posición. Además de evitar el `!`
 * que el proyecto prohíbe, es más honesto: si mañana cambia el orden del catálogo (hoy los
 * predeterminados salen primero), la prueba sigue midiendo lo que dice medir.
 */
function filaDe(nombre: string): HTMLElement {
  const fila = screen
    .getAllByTestId('conceptos-fila')
    .find((f) => within(f).queryAllByText(nombre).length > 0);
  if (fila === undefined) {
    throw new Error(`No hay ningún renglón para el concepto "${nombre}".`);
  }
  return fila;
}

beforeEach(() => {
  creado.cuerpos = [];
  editado.llamadas = [];
  estado.lista = { data: CATALOGO, isPending: false, isError: false };
});

describe('la lista del catálogo', () => {
  it('pinta un renglón por concepto, con su rubro y su forma de pago', () => {
    pintar();
    expect(screen.getAllByTestId('conceptos-fila')).toHaveLength(2);
    const cajaChica = filaDe('Caja chica');
    const agua = filaDe('Agua');
    // «Caja chica» sale DOS veces en su renglón —es el nombre y también la etiqueta del rubro—, y
    // eso es correcto: el concepto se llama igual que su sección. Se afirma el par para que la
    // prueba no se vuelva ambigua ni tape un renglón que perdiera una de las dos columnas.
    expect(within(cajaChica).getAllByText('Caja chica')).toHaveLength(2);
    expect(within(cajaChica).getByText('Efectivo')).toBeInTheDocument();
    expect(within(agua).getByText('Agua')).toBeInTheDocument();
    expect(within(agua).getByText('Servicios')).toBeInTheDocument();
    expect(within(agua).getByText('Transferencia')).toBeInTheDocument();
  });

  it('⭐ el PREDETERMINADO se distingue del que no lo es', () => {
    pintar();
    // El que se carga solo lleva su marca visible y el botón ofrece QUITARLO de la corrida…
    const cajaChica = filaDe('Caja chica');
    expect(within(cajaChica).getByLabelText('Se carga solo en cada corrida')).toBeInTheDocument();
    expect(within(cajaChica).getByTestId('conceptos-predeterminado')).toHaveTextContent(
      'Quitar de la corrida',
    );
    // …y el que no, ofrece ponerlo.
    const agua = filaDe('Agua');
    expect(within(agua).queryByLabelText('Se carga solo en cada corrida')).not.toBeInTheDocument();
    expect(within(agua).getByTestId('conceptos-predeterminado')).toHaveTextContent(
      'Cargar siempre',
    );
  });

  it('sin conceptos invita a dar de alta el primero', () => {
    estado.lista = {
      data: { ...CATALOGO, datos: [], total: 0 },
      isPending: false,
      isError: false,
    };
    pintar();
    expect(screen.getByText(/Todavía no hay conceptos/i)).toBeInTheDocument();
  });

  it('el error del servidor se enseña, no se traga', () => {
    estado.lista = { data: undefined, isPending: false, isError: true, error: new Error('tronó') };
    pintar();
    expect(screen.getByRole('alert')).toHaveTextContent('tronó');
  });
});

describe('dar de alta un concepto', () => {
  it('⭐ manda el cuerpo completo: nombre, rubro, forma de pago y la marca', async () => {
    const usuario = userEvent.setup();
    pintar();
    await usuario.type(screen.getByTestId('concepto-nombre'), 'Nómina por fuera');
    await usuario.selectOptions(screen.getByTestId('concepto-rubro'), 'nomina');
    await usuario.selectOptions(screen.getByTestId('concepto-forma'), 'efectivo');
    await usuario.click(screen.getByTestId('concepto-predeterminado'));
    await usuario.click(screen.getByTestId('concepto-guardar'));

    expect(creado.cuerpos).toEqual([
      {
        nombre: 'Nómina por fuera',
        rubro: 'nomina',
        formaPagoPreferida: 'efectivo',
        predeterminado: true,
      },
    ]);
  });

  it('«sin preferencia» viaja como null, no como cadena vacía', async () => {
    const usuario = userEvent.setup();
    pintar();
    await usuario.type(screen.getByTestId('concepto-nombre'), 'Gratificación');
    await usuario.click(screen.getByTestId('concepto-guardar'));
    expect(creado.cuerpos[0]).toMatchObject({ formaPagoPreferida: null, predeterminado: false });
  });

  it('sin nombre no se puede guardar (el servidor lo re-valida igual)', () => {
    pintar();
    expect(screen.getByTestId('concepto-guardar')).toBeDisabled();
  });
});

describe('⭐ alternar el predeterminado', () => {
  it('al que YA se carga solo, se lo quita', async () => {
    const usuario = userEvent.setup();
    pintar();
    await usuario.click(within(filaDe('Caja chica')).getByTestId('conceptos-predeterminado'));
    expect(editado.llamadas[0]).toMatchObject({ id: 1, cuerpo: { predeterminado: false } });
  });

  it('al que no, se lo pone', async () => {
    const usuario = userEvent.setup();
    pintar();
    await usuario.click(within(filaDe('Agua')).getByTestId('conceptos-predeterminado'));
    expect(editado.llamadas[0]).toMatchObject({ id: 2, cuerpo: { predeterminado: true } });
  });

  it('retirar manda el borrado SUAVE (activo:false), nunca un borrado de verdad', async () => {
    // D3: nada se borra. Retirar un concepto lo saca de las corridas nuevas y conserva su historial.
    const usuario = userEvent.setup();
    pintar();
    await usuario.click(within(filaDe('Caja chica')).getByTestId('conceptos-retirar'));
    expect(editado.llamadas[0]).toMatchObject({ id: 1, cuerpo: { activo: false } });
  });
});

describe('⭐ la reja del permiso', () => {
  it('con sólo `conceptos-pago.ver` la lista SÍ se ve', () => {
    pintar(['conceptos-pago.ver']);
    expect(screen.getByTestId('conceptos-tabla')).toBeInTheDocument();
    expect(screen.getAllByTestId('conceptos-fila')).toHaveLength(2);
  });

  it('⭐ …pero no hay forma de tocar nada: ni alta ni acciones de fila', () => {
    // Dar de alta un concepto es dar de alta A DÓNDE puede salir dinero fuera del padrón de
    // proveedores: por eso `administrar` es sólo del administrador (SOLO_ADMINISTRADOR del seed).
    pintar(['conceptos-pago.ver']);
    expect(screen.queryByTestId('concepto-guardar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('concepto-nombre')).not.toBeInTheDocument();
    expect(screen.queryByTestId('conceptos-predeterminado')).not.toBeInTheDocument();
    expect(screen.queryByTestId('conceptos-retirar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('conceptos-cuentas')).not.toBeInTheDocument();
  });

  it('con `administrar` sí aparece todo', () => {
    pintar();
    expect(screen.getByTestId('concepto-guardar')).toBeInTheDocument();
    expect(screen.getAllByTestId('conceptos-predeterminado')).toHaveLength(2);
  });
});
