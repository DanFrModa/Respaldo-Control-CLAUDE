import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as ReactRouterDom from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CandidatoLista, DescartadoLista, DiagnosticoCandidatos } from '@/api/listas-precios';
import type { ClavePermiso } from '@/api/tipos';
import { elegirEnCombobox, estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoCrearLista } from './DialogoCrearLista';

/**
 * ⭐ V1-E8f (§Post-F9.128) — «NO HAY DESARROLLOS DISPONIBLES» TIENE QUE DECIR POR QUÉ.
 *
 * Daniel llegó hasta aquí y se quedó parado: *"si tengo el permiso. Sí veo el botón. Justo me sale la
 * leyenda de que no hay desarrollos disponibles."* El diálogo funcionaba; lo que faltaba era que
 * dijera qué le faltaba a SU modelo (congelar el precosto) y por dónde ir.
 *
 * Lo que se blinda: con cero candidatos, el aviso NOMBRA cada modelo descartado, su motivo y el
 * remedio; y cuando SÍ hay candidatos, aparecen y el aviso desaparece (la gemela).
 */
const navegar = vi.fn();
vi.mock('react-router-dom', async (importarOriginal) => {
  const real = await importarOriginal<typeof ReactRouterDom>();
  return { ...real, useNavigate: () => navegar };
});

let diagnostico: DiagnosticoCandidatos;
vi.mock('@/api/listas-precios', () => ({
  useCandidatosLista: () => ({ data: diagnostico, isPending: false, isError: false }),
  useCrearLista: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/clientes', () => ({
  // V1-E8t: el camino de Daniel es el de ELEGIR el cliente aquí (no el de llegar desde un
  // proyecto), así que el combobox necesita su listado y el departamento su renglón.
  useClientes: () => ({
    data: { datos: [{ id: 77, nombre: 'C&A', activo: true, campos: [] }], total: 1 },
    isPending: false,
    isFetching: false,
    isError: false,
  }),
  useDepartamentosCliente: () => ({
    data: [{ id: 4, idCliente: 77, nombre: 'Caballero', activo: true }],
    isPending: false,
  }),
}));

/** El contexto de proyecto precarga cliente+departamento: el diálogo consulta sin tocar selectores. */
const PROYECTO = {
  id: 7,
  folio: 101,
  nombre: 'Joggers',
  idCliente: 3,
  cliente: 'C&A',
  idClienteDepartamento: 4,
  departamento: 'Caballero',
};

function descartado(
  idDesarrollo: number,
  codigoModelo: string,
  motivo: DescartadoLista['motivo'],
  extra: Partial<DescartadoLista> = {},
): DescartadoLista {
  return {
    idDesarrollo,
    idProyecto: PROYECTO.id,
    folioProyecto: PROYECTO.folio,
    nombreProyecto: PROYECTO.nombre,
    codigoModelo,
    numeroCliente: null,
    motivo,
    versionPrecosto: null,
    idLista: null,
    folioLista: null,
    ...extra,
  };
}

function candidato(idDesarrollo: number, codigoModelo: string): CandidatoLista {
  return {
    idDesarrollo,
    idProyecto: PROYECTO.id,
    folioProyecto: PROYECTO.folio,
    nombreProyecto: PROYECTO.nombre,
    codigoModelo,
    descripcionModelo: null,
    numeroCliente: null,
    idPrecosto: 500,
    versionPrecosto: 2,
    costoTotal: 40,
  };
}

/**
 * Abre el diálogo con los PERMISOS dados. Por defecto los de quien trabaja el flujo (ve Desarrollo
 * y arma listas) — desde V1-E8t los permisos ya no son decorado: deciden qué PUERTAS se pintan.
 */
function abrir(permisos: ClavePermiso[] = ['listas.ver', 'desarrollo.ver']): void {
  renderConProveedores(
    <DialogoCrearLista abierto alCambiarAbierto={vi.fn()} proyecto={PROYECTO} />,
    {
      sesion: estadoSesionDePrueba(permisos),
    },
  );
}

describe('<DialogoCrearLista> · por qué no hay candidatos (V1-E8f)', () => {
  beforeEach(() => {
    navegar.mockClear();
    diagnostico = { datos: [], descartados: [], faltanFactores: false };
  });

  // ⭐ EL CASO DE DANIEL.
  it('con el precosto en BORRADOR nombra el modelo, la versión y el acto de congelarlo', () => {
    diagnostico = {
      datos: [],
      descartados: [descartado(1, 'A-100', 'precosto-borrador', { versionPrecosto: 3 })],
      faltanFactores: false,
    };
    abrir();

    const aviso = screen.getByTestId('candidatos-vacio');
    expect(aviso).toHaveTextContent('A-100');
    expect(aviso).toHaveTextContent(/v3 en borrador/i);
    expect(aviso).toHaveTextContent(/Congelar versión/i);
    // Y ya NO se limita a decir que no hay nada disponible.
    expect(aviso).not.toHaveTextContent(/^No hay desarrollos cotizados disponibles/i);
  });

  it('con motivos MEZCLADOS los separa por grupo, cada uno con su remedio', () => {
    diagnostico = {
      datos: [],
      descartados: [
        descartado(1, 'A-100', 'precosto-borrador', { versionPrecosto: 1 }),
        descartado(2, 'B-200', 'ya-en-lista', { idLista: 9, folioLista: 12 }),
        descartado(3, 'C-300', 'sin-precosto'),
        descartado(4, 'D-400', 'apagado'),
      ],
      faltanFactores: false,
    };
    abrir();

    expect(screen.getByTestId('motivo-precosto-borrador')).toHaveTextContent('A-100');
    // El que ya está colocado dice EN CUÁL lista: es el dato que permite ir a buscarla.
    expect(screen.getByTestId('motivo-ya-en-lista')).toHaveTextContent(/lista #12/i);
    expect(screen.getByTestId('motivo-sin-precosto')).toHaveTextContent('C-300');
    expect(screen.getByTestId('motivo-apagado')).toHaveTextContent(/Reactívalos/i);
  });

  it('sin NINGÚN modelo dice que hay que capturarlo antes, no que "no hay disponibles"', () => {
    diagnostico = { datos: [], descartados: [], faltanFactores: false };
    abrir();

    const aviso = screen.getByTestId('candidatos-vacio');
    expect(aviso).toHaveTextContent(/todavía no tiene modelos en desarrollo/i);
    expect(aviso).toHaveTextContent(/precosto congelado/i);
  });

  it('lleva a Pre-costeos: el aviso no deja al usuario sin salida', async () => {
    const usuario = userEvent.setup();
    diagnostico = {
      datos: [],
      descartados: [descartado(1, 'A-100', 'precosto-borrador', { versionPrecosto: 1 })],
      faltanFactores: false,
    };
    abrir();

    await usuario.click(screen.getByRole('button', { name: 'Ir a Pre-costeos' }));
    expect(navegar).toHaveBeenCalledWith('/desarrollo');
  });

  // ⭐ V1-E8t (§Post-F9.145) — LA PUERTA SE MIDE. El aviso se sirve con `listas.ver` y el destino
  // exige `desarrollo.ver`: dos permisos distintos, uno pintando la puerta del otro. ⚠️ Medido en el
  // seed: HOY ningún rol sembrado tiene uno sin el otro, así que esto no arregla un caso vivo —
  // blinda uno alcanzable, porque los roles son datos editables desde la pantalla de roles.
  it('sin `desarrollo.ver` NO se le pinta la puerta a Pre-costeos (se mide, no se supone)', () => {
    diagnostico = {
      datos: [],
      descartados: [descartado(1, 'A-100', 'precosto-borrador', { versionPrecosto: 1 })],
      faltanFactores: false,
    };
    abrir(['listas.ver']);

    // El aviso sigue diciendo QUÉ falta y DÓNDE se arregla…
    expect(screen.getByTestId('candidatos-vacio')).toHaveTextContent(/Congelar versión/i);
    // …pero sin el botón que no lleva a ningún lado.
    expect(screen.queryByRole('button', { name: 'Ir a Pre-costeos' })).not.toBeInTheDocument();
  });

  // Lo que sólo INFORMA (ya colocado / apagado) no se arregla en Pre-costeos: ofrecer ahí una
  // puerta falsa sería mandar al usuario a dar la vuelta para nada.
  it('sin nada que congelar, NO ofrece la puerta a Pre-costeos', () => {
    diagnostico = {
      datos: [],
      descartados: [descartado(2, 'B-200', 'ya-en-lista', { idLista: 9, folioLista: 12 })],
      faltanFactores: false,
    };
    abrir();

    expect(screen.queryByRole('button', { name: 'Ir a Pre-costeos' })).not.toBeInTheDocument();
  });

  // LA GEMELA: cuando el modelo SÍ califica, aparece y el aviso se va.
  it('con candidatos aparecen las filas y el aviso desaparece', () => {
    diagnostico = { datos: [candidato(1, 'A-100')], descartados: [], faltanFactores: false };
    abrir();

    expect(screen.queryByTestId('candidatos-vacio')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('fila-candidato')).toHaveLength(1);
    expect(screen.getByTestId('candidatos-lista')).toHaveTextContent('A-100');
  });
});

/**
 * ⭐⭐ V1-E8t (§Post-F9.145) — EL AVISO DE LOS FACTORES TIENE PUERTA. Daniel, 29-ago-2026, siendo
 * él el dueño que el propio mensaje nombraba: *«estaría bueno desde ahí poder acceder al botón
 * donde necesito llenar los datos»*.
 *
 * Lo que se blinda, y por qué cada uno mata una mutación distinta:
 *  • que el aviso SE VEA y NOMBRE al cliente/departamento (quitarlo lo mata);
 *  • que la puerta lleve al LUGAR EXACTO, con el cliente preseleccionado (mandarla al catálogo
 *    pelón, o perder el `state`, la mata);
 *  • que NO se pinte a quien no puede capturarlos (pintarla siempre la mata);
 *  • que sin faltar factores NO aparezca nada (la gemela: pintarla siempre la mata).
 */
describe('<DialogoCrearLista> · faltan los factores del cliente (V1-E8t)', () => {
  /** Los tres permisos que hacen falta para CRUZAR la puerta (ficha del cliente + capturar). */
  const DUENO: ClavePermiso[] = ['listas.ver', 'listas.aprobar', 'clientes.ver', 'desarrollo.ver'];

  beforeEach(() => {
    navegar.mockClear();
    diagnostico = { datos: [candidato(1, 'A-100')], descartados: [], faltanFactores: true };
  });

  it('AL DUEÑO le dice qué falta —nombrando cliente y departamento— y le da el botón', () => {
    abrir(DUENO);

    const aviso = screen.getByTestId('aviso-faltan-factores');
    // Habla del cliente por su NOMBRE, no por su id (el id es 3; el nombre, "C&A").
    expect(aviso).toHaveTextContent('C&A / Caballero');
    expect(aviso).toHaveTextContent(/factores de precio/i);
    expect(screen.getByTestId('ir-a-capturar-factores')).toBeInTheDocument();
  });

  it('la puerta lleva a la FICHA DE ESE CLIENTE, en su sección de factores', async () => {
    const usuario = userEvent.setup();
    abrir(DUENO);

    await usuario.click(screen.getByTestId('ir-a-capturar-factores'));
    expect(navegar).toHaveBeenCalledWith('/catalogos/clientes', {
      state: { idCliente: PROYECTO.idCliente, seccion: 'factores' },
    });
  });

  it('sin `listas.aprobar` NO hay botón: se le dice a QUIÉN pedírselo', () => {
    abrir(['listas.ver', 'clientes.ver', 'desarrollo.ver']);

    const aviso = screen.getByTestId('aviso-faltan-factores');
    expect(screen.queryByTestId('ir-a-capturar-factores')).not.toBeInTheDocument();
    expect(aviso).toHaveTextContent(/dueño/i);
  });

  it('con factores capturados no hay aviso ni botón (la gemela)', () => {
    diagnostico = { datos: [candidato(1, 'A-100')], descartados: [], faltanFactores: false };
    abrir(DUENO);

    expect(screen.queryByTestId('aviso-faltan-factores')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ir-a-capturar-factores')).not.toBeInTheDocument();
  });

  /**
   * ⭐ **EL CAMINO DE DANIEL, tal cual lo anduvo**: no llegó desde un proyecto — abrió «Nueva lista»
   * en Listas de precios y eligió cliente y departamento a mano. Ese camino arma el nombre del
   * cliente de otra fuente (el combobox, no el contexto del proyecto), así que si se rompe, el
   * aviso pierde el nombre **sólo en la pantalla donde él lo vio**.
   */
  it('ELIGIENDO cliente y departamento a mano, el aviso también los nombra y trae la puerta', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<DialogoCrearLista abierto alCambiarAbierto={vi.fn()} />, {
      sesion: estadoSesionDePrueba(DUENO),
    });

    await elegirEnCombobox('crear-lista-cliente', 'C&A');
    await usuario.selectOptions(screen.getByLabelText('Departamento'), '4');

    const aviso = await screen.findByTestId('aviso-faltan-factores');
    expect(aviso).toHaveTextContent('C&A / Caballero');

    await usuario.click(screen.getByTestId('ir-a-capturar-factores'));
    expect(navegar).toHaveBeenCalledWith('/catalogos/clientes', {
      state: { idCliente: 77, seccion: 'factores' },
    });
  });

  it('sin factores, «Crear lista» queda apagado (el servidor lo rechazaría igual)', async () => {
    const usuario = userEvent.setup();
    abrir(DUENO);

    // Se selecciona un candidato: sin factores, ni así se puede crear.
    await usuario.click(screen.getByRole('checkbox'));
    expect(screen.getByTestId('confirmar-crear-lista')).toBeDisabled();
  });
});
