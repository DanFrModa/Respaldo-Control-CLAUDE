import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelectorProveedoresAvio, type RenglonProveedorAvio } from './SelectorProveedoresAvio';

/**
 * ⭐ V1-E3m (§Post-F9.82) — EL PROVEEDOR HABITUAL DEL AVÍO, en la captura.
 *
 * Daniel: *"tener avíos sin proveedor asignado está generando más problemas que beneficios"*. La
 * explosión de compras dejó de proponer «el más barato» y propone **al habitual**, así que el
 * catálogo tiene que poder marcarlo — y marcarlo **uno solo**, porque dos habituales harían que "a
 * quién le compramos siempre" dependiera del orden de las filas.
 *
 * El combobox de proveedor busca en el servidor; aquí se sustituye por botones que eligen ids fijos.
 */
vi.mock('@/modulos/cxp/SelectorProveedor', () => ({
  SelectorProveedor: ({
    alSeleccionar,
  }: {
    alSeleccionar: (proveedor: { id: number; nombre: string }) => void;
  }) => (
    <>
      <button
        type="button"
        data-testid="stub-agregar-1"
        onClick={() => alSeleccionar({ id: 1, nombre: 'Botones SA' })}
      >
        Agregar 1
      </button>
      <button
        type="button"
        data-testid="stub-agregar-2"
        onClick={() => alSeleccionar({ id: 2, nombre: 'Hilos del Norte' })}
      >
        Agregar 2
      </button>
    </>
  ),
}));

/** Renglón de captura ya cargado (como al abrir «Editar» un avío que ya tiene proveedores). */
function renglon(idProveedor: number, habitual: boolean): RenglonProveedorAvio {
  return { idProveedor, precio: '', condiciones: '', habitual };
}

function pintar(renglones: RenglonProveedorAvio[]): ReturnType<typeof vi.fn> {
  const alCambiar = vi.fn();
  render(
    <SelectorProveedoresAvio
      // El catálogo va VACÍO a propósito: aquí solo resuelve el NOMBRE para pintar, y estas pruebas
      // identifican cada renglón por su id (`#1`), que es lo que el componente muestra sin catálogo.
      proveedores={[]}
      cargando={false}
      error={null}
      renglones={renglones}
      alCambiar={alCambiar}
    />,
  );
  return alCambiar;
}

describe('SelectorProveedoresAvio — el proveedor HABITUAL (§Post-F9.82)', () => {
  it('el PRIMER proveedor que se agrega nace como habitual (un avío con uno solo no tiene dilema)', () => {
    const alCambiar = pintar([]);
    fireEvent.click(screen.getByTestId('stub-agregar-1'));
    expect(alCambiar).toHaveBeenCalledWith([
      { idProveedor: 1, precio: '', condiciones: '', habitual: true },
    ]);
  });

  it('el SEGUNDO no le quita el habitual al primero (cambiar de habitual es una decisión, no un efecto)', () => {
    const alCambiar = pintar([renglon(1, true)]);
    fireEvent.click(screen.getByTestId('stub-agregar-2'));
    const [nuevos] = alCambiar.mock.calls[0] as [RenglonProveedorAvio[]];
    expect(nuevos.map((r) => [r.idProveedor, r.habitual])).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it('marcar uno DESMARCA al anterior: el habitual es UNO por avío', () => {
    const alCambiar = pintar([renglon(1, true), renglon(2, false)]);
    fireEvent.click(screen.getByTestId('habitual-proveedor-avio-2'));
    const [nuevos] = alCambiar.mock.calls[0] as [RenglonProveedorAvio[]];
    // Si solo encendiera el nuevo (sin apagar el viejo) quedarían DOS marcados → rojo.
    expect(nuevos.map((r) => [r.idProveedor, r.habitual])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('al quitar al habitual, el primero que queda toma el relevo (no se queda el avío sin habitual)', () => {
    const alCambiar = pintar([renglon(1, true), renglon(2, false)]);
    fireEvent.click(screen.getByLabelText('Quitar #1'));
    const [nuevos] = alCambiar.mock.calls[0] as [RenglonProveedorAvio[]];
    // Sin el relevo, este avío volvería en silencio a la regla del "más barato".
    expect(nuevos).toEqual([{ idProveedor: 2, precio: '', condiciones: '', habitual: true }]);
  });

  it('al quitar a uno que NO es el habitual, el habitual no se mueve', () => {
    const alCambiar = pintar([renglon(1, true), renglon(2, false)]);
    fireEvent.click(screen.getByLabelText('Quitar #2'));
    const [nuevos] = alCambiar.mock.calls[0] as [RenglonProveedorAvio[]];
    expect(nuevos).toEqual([{ idProveedor: 1, precio: '', condiciones: '', habitual: true }]);
  });

  it('quitar a un tercero NO convierte al primero en un SEGUNDO habitual', () => {
    // El habitual (2) no es el primero de la lista: si el relevo se disparara siempre —y no solo
    // cuando el avío se quedó SIN habitual— aquí quedarían DOS marcados, que es justo la ambigüedad
    // que la bandera vino a matar.
    const alCambiar = pintar([renglon(1, false), renglon(2, true), renglon(3, false)]);
    fireEvent.click(screen.getByLabelText('Quitar #3'));
    const [nuevos] = alCambiar.mock.calls[0] as [RenglonProveedorAvio[]];
    expect(nuevos.map((r) => [r.idProveedor, r.habitual])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('QUITAR el habitual deja al avío sin ninguno (acción explícita, no rebote)', () => {
    // El backend, el contrato y la base lo soportan; la UI solo dejaba MOVERLO. Sin habitual, la
    // explosión vuelve a la regla del "más barato" de F4 — y eso lo decide una persona, a la vista.
    const alCambiar = pintar([renglon(1, true), renglon(2, false)]);
    fireEvent.click(screen.getByTestId('quitar-habitual-avio'));
    const [nuevos] = alCambiar.mock.calls[0] as [RenglonProveedorAvio[]];
    expect(nuevos.every((r) => !r.habitual)).toBe(true);
  });

  it('el botón de quitar solo se ofrece en el renglón que ES el habitual', () => {
    pintar([renglon(1, false), renglon(2, true)]);
    // Uno solo, y en el marcado: pintarlo en todos invitaría a "quitar" algo que ese renglón no tiene.
    const botones = screen.getAllByTestId('quitar-habitual-avio');
    expect(botones).toHaveLength(1);
    expect(botones[0]?.closest('label')).toContainElement(
      screen.getByTestId('habitual-proveedor-avio-2'),
    );
  });

  it('el radio refleja quién es el habitual', () => {
    pintar([renglon(1, false), renglon(2, true)]);
    expect(screen.getByTestId('habitual-proveedor-avio-1')).not.toBeChecked();
    expect(screen.getByTestId('habitual-proveedor-avio-2')).toBeChecked();
  });
});
