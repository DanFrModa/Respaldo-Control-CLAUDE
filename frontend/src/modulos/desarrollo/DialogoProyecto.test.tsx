import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Proyecto } from '@/api/proyectos';
import { renderConProveedores } from '@/pruebas/utilidades';

import { DialogoProyecto } from './DialogoProyecto';

/**
 * ⭐ fila 0.155, RONDA 2 — **la etiqueta «(archivado)» no puede mentir mientras carga.**
 *
 * El selector de COMPRADOR (§Post-F9.210 punto 1) marca «(archivado)» al comprador guardado que ya
 * NO aparece entre los contactos activos del cliente. El problema medido: mientras la consulta de
 * contactos está EN VUELO la lista está vacía, así que «no está entre los activos» es cierto para
 * todos ⇒ cualquier proyecto con comprador pintaba «Ana Ruiz (archivado)» durante ese instante.
 * Transitorio, pero es una etiqueta afirmando algo falso sobre una persona.
 *
 * Este archivo no existía: el diálogo sólo se probaba de refilón desde `ProyectosPagina`.
 */

/** Estado del mock de `useContactosCliente`, que cada prueba ajusta. */
let contactos: {
  data: { id: number; nombre: string; puesto: string | null }[] | undefined;
  isPending: boolean;
};

vi.mock('@/api/clientes', () => ({
  useDepartamentosCliente: () => ({ data: [{ id: 5, nombre: 'NIÑOS', activo: true }] }),
  useContactosCliente: () => contactos,
}));
vi.mock('@/api/temporadas', () => ({
  useTemporadas: () => ({ data: { datos: [] }, isPending: false }),
}));
vi.mock('@/api/modelos', () => ({
  useGeneros: () => ({ data: [{ id: 1, nombre: 'Caballero' }], isPending: false }),
}));
vi.mock('@/api/proyectos', () => ({
  useCrearProyecto: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarProyecto: () => ({ mutate: vi.fn(), isPending: false }),
}));
// El combobox de cliente tiene su propia prueba; aquí sólo estorba.
vi.mock('@/components/dominio/FiltroCliente', () => ({
  FiltroCliente: () => <div data-testid="filtro-cliente" />,
}));

/** Un proyecto con comprador guardado (id 7), que es el caso donde la etiqueta puede aparecer. */
function proyectoConComprador(): Proyecto {
  return {
    id: 1,
    folio: 12,
    idEmpresa: 1,
    idCliente: 3,
    cliente: 'C&A',
    idClienteDepartamento: 5,
    departamento: 'NIÑOS',
    nombre: 'Joggers',
    idTemporada: null,
    temporada: null,
    idClienteContacto: 7,
    comprador: 'Ana Ruiz',
    compradorPuesto: 'compradora',
    idGenero: null,
    genero: null,
    anioEntrega: null,
    notas: null,
    archivado: false,
    conteos: {
      total: 0,
      enDesarrollo: 0,
      cotizado: 0,
      enLista: 0,
      ligadoProduccion: 0,
      apagado: 0,
    },
    creadoEn: '2026-09-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-09-01T00:00:00.000Z',
    modificadoPorId: null,
  };
}

describe('<DialogoProyecto> — el selector de comprador (fila 0.155)', () => {
  beforeEach(() => {
    contactos = { data: [], isPending: false };
  });

  it('🟡 MIENTRAS CARGAN los contactos NO dice «(archivado)» de nadie', () => {
    contactos = { data: undefined, isPending: true };
    renderConProveedores(
      <DialogoProyecto abierto alCambiarAbierto={() => {}} proyecto={proyectoConComprador()} />,
    );

    expect(screen.queryByText(/archivado/i)).not.toBeInTheDocument();
  });

  it('ya cargados, al comprador que YA NO está activo sí lo marca «(archivado)»', () => {
    contactos = { data: [{ id: 9, nombre: 'Luis Mora', puesto: null }], isPending: false };
    renderConProveedores(
      <DialogoProyecto abierto alCambiarAbierto={() => {}} proyecto={proyectoConComprador()} />,
    );

    expect(screen.getByText(/Ana Ruiz \(archivado\)/)).toBeInTheDocument();
  });

  it('al comprador que SÍ sigue activo no lo marca, y lo ofrece con su puesto', () => {
    contactos = { data: [{ id: 7, nombre: 'Ana Ruiz', puesto: 'compradora' }], isPending: false };
    renderConProveedores(
      <DialogoProyecto abierto alCambiarAbierto={() => {}} proyecto={proyectoConComprador()} />,
    );

    expect(screen.queryByText(/archivado/i)).not.toBeInTheDocument();
    expect(screen.getByText('Ana Ruiz · compradora')).toBeInTheDocument();
  });
});
