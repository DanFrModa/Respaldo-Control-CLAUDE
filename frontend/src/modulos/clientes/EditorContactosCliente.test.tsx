import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClienteContacto } from '@/api/tipos';
import { renderConProveedores } from '@/pruebas/utilidades';

import { EditorContactosCliente } from './EditorContactosCliente';

const crearMutate = vi.fn();
const actualizarMutate = vi.fn();

let contactos: { isPending: boolean; data: ClienteContacto[] | undefined };

vi.mock('@/api/clientes', () => ({
  useContactosCliente: () => contactos,
  useDepartamentosCliente: () => ({
    data: [
      { id: 2, idCliente: 1, nombre: 'NIÑOS', activo: true },
      { id: 3, idCliente: 1, nombre: 'VIEJO', activo: false },
    ],
  }),
  useCrearContactoCliente: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarContactoCliente: () => ({ mutate: actualizarMutate, isPending: false }),
}));

function contacto(
  over: Partial<ClienteContacto> & Pick<ClienteContacto, 'id' | 'nombre'>,
): ClienteContacto {
  return {
    idCliente: 1,
    idClienteDepartamento: null,
    nombreDepartamento: null,
    puesto: null,
    telefono: null,
    email: null,
    notas: null,
    activo: true,
    ...over,
  };
}

describe('<EditorContactosCliente> — la compradora (§Post-F9.152)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    actualizarMutate.mockReset();
    contactos = { isPending: false, data: [] };
  });

  it('sin contactos dice a quién se agrega aquí', () => {
    renderConProveedores(<EditorContactosCliente idCliente={1} />);
    expect(screen.getByTestId('sin-contactos-cliente')).toHaveTextContent(/compradora/i);
  });

  it('🔴 el DEPARTAMENTO es opcional: por defecto se manda SIN él', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EditorContactosCliente idCliente={1} />);

    await usuario.type(screen.getByTestId('contacto-cliente-nombre'), 'Carlos');
    await usuario.type(screen.getByTestId('contacto-cliente-puesto'), 'crédito y cobranza');
    await usuario.click(screen.getByTestId('agregar-contacto-cliente'));

    const args = crearMutate.mock.calls[0]?.[0] as { cuerpo: Record<string, unknown> };
    expect(args.cuerpo).toMatchObject({ nombre: 'Carlos', puesto: 'crédito y cobranza' });
    expect(args.cuerpo['idClienteDepartamento']).toBeUndefined();
  });

  it('🔴 con departamento elegido lo manda como número (la compradora de NIÑOS)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EditorContactosCliente idCliente={1} />);

    await usuario.type(screen.getByTestId('contacto-cliente-nombre'), 'Laura');
    await usuario.selectOptions(screen.getByTestId('contacto-cliente-depto'), '2');
    await usuario.click(screen.getByTestId('agregar-contacto-cliente'));

    expect(
      (crearMutate.mock.calls[0]?.[0] as { cuerpo: Record<string, unknown> }).cuerpo,
    ).toMatchObject({ nombre: 'Laura', idClienteDepartamento: 2 });
  });

  it('🔴 el selector NO ofrece departamentos apagados (apagar es cómo la fusión retira duplicados)', () => {
    renderConProveedores(<EditorContactosCliente idCliente={1} />);
    const opciones = [...screen.getByTestId('contacto-cliente-depto').querySelectorAll('option')];
    expect(opciones.map((o) => o.textContent)).toEqual(['(todo el cliente)', 'NIÑOS']);
  });

  it('sin nombre no llama al servidor y lo dice', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<EditorContactosCliente idCliente={1} />);

    await usuario.click(screen.getByTestId('agregar-contacto-cliente'));

    expect(crearMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Escribe el nombre/i)).toBeInTheDocument();
  });

  it('🔴 archivar manda `activo: false` (no borra) y el archivado se puede REVIVIR', async () => {
    const usuario = userEvent.setup();
    contactos = {
      isPending: false,
      data: [
        contacto({ id: 10, nombre: 'Laura', puesto: 'compradora', nombreDepartamento: 'NIÑOS' }),
        contacto({ id: 11, nombre: 'Fue', activo: false }),
      ],
    };
    renderConProveedores(<EditorContactosCliente idCliente={1} />);

    await usuario.click(screen.getByTestId('archivar-contacto-cliente'));
    expect(actualizarMutate.mock.calls[0]?.[0]).toMatchObject({
      idContacto: 10,
      cuerpo: { activo: false },
    });

    await usuario.click(screen.getByTestId('reactivar-contacto-cliente'));
    expect(actualizarMutate.mock.calls[1]?.[0]).toMatchObject({
      idContacto: 11,
      cuerpo: { activo: true },
    });
  });

  it('enseña puesto y departamento juntos («Laura · compradora · NIÑOS»)', () => {
    contactos = {
      isPending: false,
      data: [
        contacto({ id: 10, nombre: 'Laura', puesto: 'compradora', nombreDepartamento: 'NIÑOS' }),
      ],
    };
    renderConProveedores(<EditorContactosCliente idCliente={1} />);
    expect(screen.getByTestId('contacto-cliente')).toHaveTextContent('compradora · NIÑOS');
  });

  it('🔴 deshabilitado (sin permiso o cliente inactivo) se LEE pero no se captura', () => {
    contactos = { isPending: false, data: [contacto({ id: 10, nombre: 'Laura' })] };
    renderConProveedores(<EditorContactosCliente idCliente={1} deshabilitado />);
    expect(screen.getByTestId('contacto-cliente')).toHaveTextContent('Laura');
    expect(screen.queryByTestId('agregar-contacto-cliente')).toBeNull();
    expect(screen.getByTestId('archivar-contacto-cliente')).toBeDisabled();
  });
});
