import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { AjusteTelaColorPagina } from './AjusteTelaColorPagina';

/**
 * 🔴 PRIMERA red de esta pantalla (fila 0.098): «Ajuste de telas por color» —la que va a
 * INICIALIZAR todo el inventario de telas el día del arranque— NO tenía ninguna prueba, de ningún
 * tipo. Lo que se vigila aquí es lo que cambió: que arranque en CONTEO, que lo que viaja al backend
 * sea LO CONTADO (no una resta hecha a mano) y que los modos de ajuste sigan mandando lo suyo.
 */
const mutateConteo = vi.fn();
const mutateAjuste = vi.fn();

vi.mock('@/api/inventario-materiales', () => ({
  useAjustarTelaColor: () => ({ mutate: mutateAjuste, isPending: false }),
  useRegistrarConteoTelaColor: () => ({ mutate: mutateConteo, isPending: false }),
}));
vi.mock('@/api/inventarios', () => ({
  useTiposMovimiento: () => ({
    data: {
      datos: [
        { id: 14, codigo: 'ajuste-entrada' },
        { id: 15, codigo: 'ajuste-salida' },
      ],
    },
  }),
}));
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({
    data: {
      datos: [
        { id: 5, nombre: 'Naucalpan' },
        { id: 8, nombre: 'Bodega Montaño' },
      ],
    },
  }),
}));

// Las dos capturas se simulan: cada una emite el renglón con SU forma (contado vs cantidad). Así se
// puede comprobar QUÉ forma sale hacia el backend en cada modo.
vi.mock('./CapturaConteoTelaColor', () => ({
  CapturaConteoTelaColor: ({
    idAlmacen,
    onChange,
  }: {
    idAlmacen: number | undefined;
    onChange: (r: unknown[]) => void;
  }) => (
    <button
      type="button"
      data-testid="captura-conteo-simulada"
      data-almacen={idAlmacen === undefined ? 'sin-almacen' : String(idAlmacen)}
      onClick={() =>
        onChange([
          {
            idTelaColor: 11,
            tela: 'Felpa',
            color: 'Negro',
            nombreComplemento: 'Cardigan',
            unidad: 'kg',
            contadoCuerpo: 130,
            contadoComplemento: 50,
            loteProveedor: 'L-778',
          },
          {
            idTelaColor: 21,
            tela: 'Lisa',
            color: 'Blanco',
            nombreComplemento: null,
            unidad: 'm',
            contadoCuerpo: 0,
            contadoComplemento: 0,
          },
        ])
      }
    >
      contar
    </button>
  ),
}));
vi.mock('./CapturaRenglonesTelaColor', () => ({
  CapturaRenglonesTelaColor: ({ onChange }: { onChange: (r: unknown[]) => void }) => (
    <button
      type="button"
      data-testid="captura-ajuste-simulada"
      onClick={() =>
        onChange([
          {
            idTelaColor: 11,
            tela: 'Felpa',
            color: 'Negro',
            nombreComplemento: 'Cardigan',
            cantidad: 30,
            cantidadComplemento: 10,
          },
        ])
      }
    >
      capturar
    </button>
  ),
}));

const SESION = () => estadoSesionDePrueba(['inventario-telas.mover']);

beforeEach(() => {
  mutateConteo.mockClear();
  mutateAjuste.mockClear();
});

/** Llena almacén + motivo (los dos obligatorios) para poder guardar. */
function llenarEncabezado(): void {
  fireEvent.change(screen.getByTestId('ajuste-color-almacen'), { target: { value: '5' } });
  fireEvent.change(screen.getByTestId('ajuste-color-motivo'), {
    target: { value: 'conteo físico de arranque' },
  });
}

describe('AjusteTelaColorPagina — modo CONTEO (fila 0.098)', () => {
  it('arranca en CONTEO, no en la captura de la resta', () => {
    renderConProveedores(<AjusteTelaColorPagina />, { sesion: SESION() });
    expect(screen.getByTestId('captura-conteo-simulada')).toBeInTheDocument();
    expect(screen.queryByTestId('captura-ajuste-simulada')).not.toBeInTheDocument();
    expect(screen.getByTestId('ajuste-color-guardar')).toHaveTextContent('Aplicar conteo');
  });

  it('⭐ manda LO CONTADO, no la diferencia: la resta la hace el servidor', () => {
    renderConProveedores(<AjusteTelaColorPagina />, { sesion: SESION() });
    llenarEncabezado();
    fireEvent.click(screen.getByTestId('captura-conteo-simulada'));
    fireEvent.click(screen.getByTestId('ajuste-color-guardar'));

    expect(mutateConteo).toHaveBeenCalledTimes(1);
    expect(mutateAjuste).not.toHaveBeenCalled();
    const cuerpo = mutateConteo.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(cuerpo).toMatchObject({ idAlmacen: 5, motivo: 'conteo físico de arranque' });
    // El contrato NO tiene `idTipoMov`: la dirección la decide el servidor por el signo de cada
    // diferencia (una tela puede faltar y otra sobrar en el mismo conteo).
    expect(cuerpo).not.toHaveProperty('idTipoMov');
    expect(cuerpo.lineas).toEqual([
      {
        idTelaColor: 11,
        contadoCuerpo: 130,
        contadoComplemento: 50,
        loteProveedor: 'L-778',
      },
      // Contar CERO es un conteo legítimo ("no quedó nada") y tiene que VIAJAR: si se filtrara por
      // "cantidad > 0" —como hace la captura de ajuste—, vaciar una tela sería imposible.
      { idTelaColor: 21, contadoCuerpo: 0 },
    ]);
  });

  it('le pasa el almacén elegido a la captura (sin él no hay saldo que enseñar)', () => {
    renderConProveedores(<AjusteTelaColorPagina />, { sesion: SESION() });
    expect(screen.getByTestId('captura-conteo-simulada')).toHaveAttribute(
      'data-almacen',
      'sin-almacen',
    );
    fireEvent.change(screen.getByTestId('ajuste-color-almacen'), { target: { value: '5' } });
    expect(screen.getByTestId('captura-conteo-simulada')).toHaveAttribute('data-almacen', '5');
  });

  it('no deja guardar sin almacén, sin motivo o sin renglones', () => {
    renderConProveedores(<AjusteTelaColorPagina />, { sesion: SESION() });
    expect(screen.getByTestId('ajuste-color-guardar')).toBeDisabled();
    llenarEncabezado();
    // Encabezado completo pero sin nada contado: sigue apagado.
    expect(screen.getByTestId('ajuste-color-guardar')).toBeDisabled();
    fireEvent.click(screen.getByTestId('captura-conteo-simulada'));
    expect(screen.getByTestId('ajuste-color-guardar')).toBeEnabled();
  });

  it('🔴 cambiar de ALMACÉN vacía lo contado (no se aplica el conteo de A contra B)', () => {
    // Con 80 colores capturados en Bodega A, tocar el select y pulsar «Aplicar conteo» habría
    // escrito esas 80 cantidades contra Bodega B —sobrescribiéndola con lo de A y dejando A
    // intacta—. Lo contado sólo significa algo contra UN almacén.
    renderConProveedores(<AjusteTelaColorPagina />, { sesion: SESION() });
    llenarEncabezado();
    fireEvent.click(screen.getByTestId('captura-conteo-simulada'));
    expect(screen.getByTestId('ajuste-color-guardar')).toBeEnabled();

    fireEvent.change(screen.getByTestId('ajuste-color-almacen'), { target: { value: '8' } });

    // Lo capturado se fue: sin renglones no hay conteo que aplicar.
    expect(screen.getByTestId('ajuste-color-guardar')).toBeDisabled();
    fireEvent.click(screen.getByTestId('ajuste-color-guardar'));
    expect(mutateConteo).not.toHaveBeenCalled();
  });

  it('re-elegir el MISMO almacén no tira lo contado (no es un cambio)', () => {
    renderConProveedores(<AjusteTelaColorPagina />, { sesion: SESION() });
    llenarEncabezado();
    fireEvent.click(screen.getByTestId('captura-conteo-simulada'));
    // El mismo valor: no hay nada que invalidar.
    fireEvent.change(screen.getByTestId('ajuste-color-almacen'), { target: { value: '5' } });
    expect(screen.getByTestId('ajuste-color-guardar')).toBeEnabled();
  });

  it('sin inventario-telas.mover no se puede capturar (A4)', () => {
    renderConProveedores(<AjusteTelaColorPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    expect(screen.getByTestId('ajuste-color-almacen')).toBeDisabled();
    expect(screen.getByTestId('ajuste-color-guardar')).toBeDisabled();
  });
});

describe('AjusteTelaColorPagina — los modos de ajuste siguen enteros', () => {
  it('«Entrada» vuelve a la captura por cantidad y manda su idTipoMov', () => {
    renderConProveedores(<AjusteTelaColorPagina />, { sesion: SESION() });
    fireEvent.click(screen.getByTestId('ajuste-color-dir-entrada'));
    expect(screen.getByTestId('captura-ajuste-simulada')).toBeInTheDocument();
    expect(screen.queryByTestId('captura-conteo-simulada')).not.toBeInTheDocument();
    expect(screen.getByTestId('ajuste-color-guardar')).toHaveTextContent('Registrar ajuste');

    llenarEncabezado();
    fireEvent.click(screen.getByTestId('captura-ajuste-simulada'));
    fireEvent.click(screen.getByTestId('ajuste-color-guardar'));
    expect(mutateConteo).not.toHaveBeenCalled();
    const cuerpo = mutateAjuste.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(cuerpo).toMatchObject({ idTipoMov: 14, idAlmacen: 5 });
    expect(cuerpo.lineas).toEqual([{ idTelaColor: 11, cantidad: 30, cantidadComplemento: 10 }]);
  });

  it('«Salida» usa el tipo de salida (y no el de entrada)', () => {
    renderConProveedores(<AjusteTelaColorPagina />, { sesion: SESION() });
    fireEvent.click(screen.getByTestId('ajuste-color-dir-salida'));
    llenarEncabezado();
    fireEvent.click(screen.getByTestId('captura-ajuste-simulada'));
    fireEvent.click(screen.getByTestId('ajuste-color-guardar'));
    expect(mutateAjuste.mock.calls[0]?.[0]).toMatchObject({ idTipoMov: 15 });
  });
});
