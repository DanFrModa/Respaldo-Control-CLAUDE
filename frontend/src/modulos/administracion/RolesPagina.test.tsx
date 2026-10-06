import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from 'sonner';

import type { CatalogoPermisos } from '@/api/roles';
import { ErrorDeApi } from '@/api/errores';
import type { Rol } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { RolesPagina } from './RolesPagina';

type EstadoRoles = {
  data: Rol[] | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: ErrorDeApi | null;
  refetch: () => void;
};
type EstadoCatalogo = {
  data: CatalogoPermisos | undefined;
  isPending: boolean;
  isError: boolean;
  error: ErrorDeApi | null;
};

const useRoles = vi.fn<() => EstadoRoles>();
const usePermisosCatalogo = vi.fn<() => EstadoCatalogo>();
const asignarMutate = vi.fn();
const eliminarMutate = vi.fn();
const crearMutate = vi.fn();
const actualizarMutate = vi.fn();

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/api/roles', () => ({
  useRoles: () => useRoles(),
  usePermisosCatalogo: () => usePermisosCatalogo(),
  useAsignarPermisos: () => ({ mutate: asignarMutate, isPending: false }),
  useEliminarRol: () => ({ mutate: eliminarMutate, isPending: false }),
  useCrearRol: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarRol: () => ({ mutate: actualizarMutate, isPending: false }),
}));

function rol(
  id: number,
  nombre: string,
  esSistema: boolean,
  totalUsuarios: number,
  clavesPermisos: string[],
): Rol {
  return { id, nombre, descripcion: `Rol ${nombre}`, esSistema, clavesPermisos, totalUsuarios };
}

const CATALOGO: CatalogoPermisos = [
  {
    modulo: 'almacenes',
    etiqueta: 'Almacenes',
    permisos: [
      { clave: 'almacenes.ver', descripcion: 'Ver almacenes', modulo: 'almacenes' },
      { clave: 'almacenes.administrar', descripcion: 'Administrar almacenes', modulo: 'almacenes' },
    ],
  },
  {
    modulo: 'roles',
    etiqueta: 'Administración de roles',
    permisos: [{ clave: 'roles.administrar', descripcion: 'Administrar roles', modulo: 'roles' }],
  },
];

function estadoRoles(datos: Rol[]): EstadoRoles {
  return {
    data: datos,
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
}

function estadoCatalogo(): EstadoCatalogo {
  return { data: CATALOGO, isPending: false, isError: false, error: null };
}

describe('<RolesPagina>', () => {
  beforeEach(() => {
    useRoles.mockReset();
    usePermisosCatalogo.mockReset();
    asignarMutate.mockReset();
    eliminarMutate.mockReset();
    crearMutate.mockReset();
    actualizarMutate.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    usePermisosCatalogo.mockReturnValue(estadoCatalogo());
  });

  /** Abre el cajón de detalle del primer renglón. */
  function abrirPrimero(): void {
    fireEvent.click(screen.getAllByTestId('fila-rol')[0] as HTMLElement);
  }

  it('lista los roles con badge "Sistema" y conteo de usuarios', () => {
    useRoles.mockReturnValue(
      estadoRoles([
        rol(1, 'Administrador', true, 2, ['roles.administrar']),
        rol(2, 'Almacenista', false, 0, ['almacenes.ver']),
      ]),
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    expect(screen.getAllByTestId('fila-rol')).toHaveLength(2);
    expect(screen.getByText('Administrador')).toBeInTheDocument();
    // Tabla-first: al abrir el cajón, su TÍTULO trae Sistema + conteo de usuarios.
    abrirPrimero();
    const cajon = screen.getByTestId('detalle-rol').closest('[data-slot="cajon-detalle"]');
    expect(cajon).not.toBeNull();
    expect(within(cajon as HTMLElement).getByText('Sistema')).toBeInTheDocument();
    expect(within(cajon as HTMLElement).getByText(/2 usuarios/)).toBeInTheDocument();
  });

  it('muestra el árbol de permisos con lo del rol ya marcado', () => {
    useRoles.mockReturnValue(
      estadoRoles([rol(1, 'Administrador', true, 2, ['roles.administrar'])]),
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    abrirPrimero();
    expect(screen.getAllByTestId('grupo-permisos')).toHaveLength(2);
    expect(screen.getAllByTestId('permiso-checkbox')).toHaveLength(3);
    // El rol NO tiene almacenes.ver pero SÍ roles.administrar.
    expect(screen.getByRole('checkbox', { name: /almacenes\.ver/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /roles\.administrar/ })).toBeChecked();
    // Sin cambios, Guardar arranca deshabilitado.
    expect(screen.getByTestId('guardar-permisos')).toBeDisabled();
  });

  it('marcar un permiso habilita Guardar y lo envía como reemplazo', () => {
    useRoles.mockReturnValue(
      estadoRoles([rol(1, 'Administrador', true, 2, ['roles.administrar'])]),
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    abrirPrimero();
    fireEvent.click(screen.getByRole('checkbox', { name: /almacenes\.ver/ })); // marca almacenes.ver

    const guardar = screen.getByTestId('guardar-permisos');
    expect(guardar).toBeEnabled();
    fireEvent.click(guardar);

    expect(asignarMutate).toHaveBeenCalledTimes(1);
    const arg = asignarMutate.mock.calls[0]?.[0] as { id: number; clavesPermisos: string[] };
    expect(arg.id).toBe(1);
    expect(arg.clavesPermisos).toEqual(
      expect.arrayContaining(['roles.administrar', 'almacenes.ver']),
    );
    expect(arg.clavesPermisos).toHaveLength(2);
  });

  it('un rol de SISTEMA no se puede eliminar (botón deshabilitado)', () => {
    useRoles.mockReturnValue(
      estadoRoles([rol(1, 'Administrador', true, 2, ['roles.administrar'])]),
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    abrirPrimero();
    // Editar/Eliminar viven en el encabezado del cajón (acciones).
    expect(screen.getByTestId('eliminar-rol')).toBeDisabled();
    // Editar sí está disponible (se puede editar su descripción y permisos).
    expect(screen.getByTestId('editar-rol')).toBeEnabled();
  });

  it('un rol propio sin usuarios sí se puede eliminar', () => {
    useRoles.mockReturnValue(estadoRoles([rol(2, 'Almacenista', false, 0, ['almacenes.ver'])]));
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    abrirPrimero();
    expect(screen.getByTestId('eliminar-rol')).toBeEnabled();
  });

  it('un rol con usuarios asignados no se puede eliminar', () => {
    useRoles.mockReturnValue(estadoRoles([rol(2, 'Ventas', false, 3, ['almacenes.ver'])]));
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    abrirPrimero();
    expect(screen.getByTestId('eliminar-rol')).toBeDisabled();
  });

  it('sin roles.administrar los checkboxes van deshabilitados y no hay Guardar', () => {
    useRoles.mockReturnValue(
      estadoRoles([rol(1, 'Administrador', true, 2, ['roles.administrar'])]),
    );
    renderConProveedores(<RolesPagina />, { sesion: estadoSesionDePrueba([]) });

    abrirPrimero();
    expect(screen.getByRole('checkbox', { name: /almacenes\.ver/ })).toBeDisabled();
    expect(screen.queryByTestId('guardar-permisos')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nuevo-rol')).not.toBeInTheDocument();
  });

  // ── ⚠️ Los 9 perfiles de SISTEMA se restablecen solos (3-sep-2026) ──────────────
  //
  // El seed los re-sincroniza con `definirRoles()` en cada arranque con `SEED_ON_START=true`
  // (`deleteMany` de lo que sobre + `createMany` de lo que falte), así que un permiso palomeado
  // aquí a mano se borra CALLADO en el siguiente deploy. La pantalla no lo bloquea —guardar sirve
  // para probar algo en el momento—, pero tiene que decirlo. Los roles PROPIOS no se tocan nunca:
  // si el aviso les saliera a ellos también, sería mentira y la gente dejaría de leerlo.

  it('⭐ un perfil de SISTEMA avisa que sus permisos se restablecen en el siguiente deploy', () => {
    useRoles.mockReturnValue(estadoRoles([rol(1, 'Secretarial', true, 3, ['almacenes.ver'])]));
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    abrirPrimero();
    const aviso = screen.getByTestId('aviso-rol-sistema');
    expect(aviso).toHaveAttribute('role', 'alert');
    expect(aviso).toHaveTextContent('«Secretarial» es un perfil de sistema.');
    // Lo que la persona tiene que llevarse: qué pasa, y qué hacer en su lugar.
    expect(aviso).toHaveTextContent(/vuelven a su definición de fábrica/);
    expect(aviso).toHaveTextContent(/crea un perfil propio/);
    // 🔴 Y LA EXCEPCIÓN, que es la mitad que de verdad quema: `sembrarRoles` NUNCA revoca
    // `usuarios.administrar` ni `roles.administrar` (guard anti-lockout del seed). El escenario
    // que el propio seed documenta —darle «administrar roles» a Gerencial desde ESTA pantalla— se
    // queda para siempre; un aviso que dijera «todo se borra» mentiría justo ahí, y sobre el
    // permiso de gobierno del RBAC. (Hasta la fila 0.120 hacía además de marcador de «es admin»
    // en la Ruta Crítica, en compras y en tipos de proceso; ya no: cada facultad tiene su llave.)
    expect(aviso).toHaveTextContent(/salvo administrar usuarios y administrar roles/);
    expect(aviso).toHaveTextContent(/nunca retira/);
    // Y NO se bloquea la edición: guardar sigue disponible (el backend lo permite, A1).
    expect(screen.getByRole('checkbox', { name: /almacenes\.ver/ })).toBeEnabled();
    expect(screen.getByTestId('guardar-permisos')).toBeInTheDocument();
  });

  it('⭐ un perfil PROPIO no lleva ese aviso (a ése no se lo pisa nadie)', () => {
    useRoles.mockReturnValue(estadoRoles([rol(2, 'Almacenista', false, 0, ['almacenes.ver'])]));
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    abrirPrimero();
    expect(screen.queryByTestId('aviso-rol-sistema')).not.toBeInTheDocument();
  });

  // ── ⭐ Fila 0.248 · «Duplicar» un rol (Daniel, 1-oct-2026) ──────────────────────
  //
  // *«Pon una opción de copiar un rol en otro que haga nuevo.»* Va a sacar variantes de 16 perfiles
  // y hoy palomea cada casilla a mano. Duplicar abre el ALTA (nunca la edición del origen) con el
  // árbol ya marcado y el nombre «Copia de …»; guardar va a CREAR, y el origen no se toca.

  /** Abre el cajón del primer rol y pulsa «Duplicar»; devuelve el diálogo. */
  function duplicarPrimero(): HTMLElement {
    abrirPrimero();
    fireEvent.click(screen.getByTestId('duplicar-rol'));
    return screen.getByRole('dialog', { name: 'Duplicar rol' });
  }

  it('⭐ «Duplicar» abre el ALTA con «Copia de …» y el árbol marcado con las claves del origen', () => {
    useRoles.mockReturnValue(
      estadoRoles([rol(2, 'Almacenista', false, 0, ['almacenes.ver', 'roles.administrar'])]),
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    const dialogo = duplicarPrimero();
    // Es el alta, no la edición del origen: el botón dice «Crear rol».
    expect(within(dialogo).getByTestId('guardar-rol')).toHaveTextContent('Crear rol');
    expect(within(dialogo).getByLabelText(/Nombre/)).toHaveValue('Copia de Almacenista');
    expect(within(dialogo).getByLabelText(/Nombre/)).toBeEnabled();
    expect(within(dialogo).getByLabelText('Descripción')).toHaveValue('Rol Almacenista');
    // El árbol DEL DIÁLOGO trae lo del origen: marcadas sus dos claves y SÓLO ésas.
    expect(within(dialogo).getByRole('checkbox', { name: /almacenes\.ver/ })).toBeChecked();
    expect(within(dialogo).getByRole('checkbox', { name: /roles\.administrar/ })).toBeChecked();
    expect(
      within(dialogo).getByRole('checkbox', { name: /almacenes\.administrar/ }),
    ).not.toBeChecked();
  });

  it('⭐ guardar la copia llama a CREAR con el nombre y las claves (nunca edita el origen)', () => {
    useRoles.mockReturnValue(
      estadoRoles([rol(2, 'Almacenista', false, 0, ['almacenes.ver', 'roles.administrar'])]),
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    const dialogo = duplicarPrimero();
    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), {
      target: { value: 'Almacenista turno B' },
    });
    // Ajuste en la copia: quita una clave y agrega otra.
    fireEvent.click(within(dialogo).getByRole('checkbox', { name: /roles\.administrar/ }));
    fireEvent.click(within(dialogo).getByRole('checkbox', { name: /almacenes\.administrar/ }));
    fireEvent.click(within(dialogo).getByTestId('guardar-rol'));

    return vi.waitFor(() => {
      expect(crearMutate).toHaveBeenCalledTimes(1);
      const cuerpo = crearMutate.mock.calls[0]?.[0] as {
        nombre: string;
        descripcion: string;
        clavesPermisos: string[];
      };
      expect(cuerpo.nombre).toBe('Almacenista turno B');
      expect(cuerpo.descripcion).toBe('Rol Almacenista');
      expect([...cuerpo.clavesPermisos].sort()).toEqual(['almacenes.administrar', 'almacenes.ver']);
      // El origen NO se toca: ni renombrar ni reemplazar sus permisos.
      expect(actualizarMutate).not.toHaveBeenCalled();
      expect(asignarMutate).not.toHaveBeenCalled();
    });
  });

  it('⭐ un rol de SISTEMA también se duplica (la copia nace propia, editable de nombre)', () => {
    useRoles.mockReturnValue(
      estadoRoles([rol(1, 'Administrador', true, 2, ['roles.administrar', 'almacenes.ver'])]),
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    const dialogo = duplicarPrimero();
    // El candado de «no se renombra» es del rol de sistema en EDICIÓN, no de su copia.
    expect(within(dialogo).getByLabelText(/Nombre/)).toBeEnabled();
    expect(within(dialogo).queryByText(/no se puede cambiar/)).not.toBeInTheDocument();
    fireEvent.click(within(dialogo).getByTestId('guardar-rol'));

    return vi.waitFor(() => {
      const cuerpo = crearMutate.mock.calls[0]?.[0] as { nombre: string; clavesPermisos: string[] };
      expect(cuerpo.nombre).toBe('Copia de Administrador');
      expect([...cuerpo.clavesPermisos].sort()).toEqual(['almacenes.ver', 'roles.administrar']);
    });
  });

  it('⭐ sin roles.administrar NO aparece «Duplicar»', () => {
    useRoles.mockReturnValue(estadoRoles([rol(2, 'Almacenista', false, 0, ['almacenes.ver'])]));
    renderConProveedores(<RolesPagina />, { sesion: estadoSesionDePrueba([]) });

    abrirPrimero();
    // Testigo: el cajón SÍ abrió (si no, la ausencia del botón no probaría nada).
    expect(screen.getByTestId('detalle-rol')).toBeInTheDocument();
    expect(screen.queryByTestId('duplicar-rol')).not.toBeInTheDocument();
  });

  it('⭐ «Nuevo rol» sigue siendo el alta EN BLANCO (sin árbol ni nombre precargado)', () => {
    useRoles.mockReturnValue(estadoRoles([rol(2, 'Almacenista', false, 0, ['almacenes.ver'])]));
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    // Primero se duplica y se cancela: el alta siguiente NO debe arrastrar al origen.
    const dialogo = duplicarPrimero();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByTestId('nuevo-rol'));
    const alta = screen.getByRole('dialog', { name: 'Nuevo rol' });
    expect(within(alta).getByLabelText(/Nombre/)).toHaveValue('');
    expect(within(alta).queryByTestId('arbol-duplicado')).not.toBeInTheDocument();
  });

  it('⭐ un nombre repetido muestra el mensaje del servidor y el diálogo sigue abierto', () => {
    useRoles.mockReturnValue(estadoRoles([rol(2, 'Almacenista', false, 0, ['almacenes.ver'])]));
    crearMutate.mockImplementation(
      (_cuerpo: unknown, opciones: { onError: (e: ErrorDeApi) => void }) => {
        opciones.onError(
          new ErrorDeApi({
            codigo: 'CONFLICTO',
            mensaje: 'Ya existe un rol llamado "Copia de Almacenista".',
          }),
        );
      },
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    const dialogo = duplicarPrimero();
    fireEvent.click(within(dialogo).getByTestId('guardar-rol'));

    return vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Ya existe un rol llamado "Copia de Almacenista".');
      expect(toast.success).not.toHaveBeenCalled();
      // No se cerró: la persona corrige el nombre ahí mismo, con su árbol intacto.
      const abierto = screen.getByRole('dialog', { name: 'Duplicar rol' });
      expect(within(abierto).getByRole('checkbox', { name: /almacenes\.ver/ })).toBeChecked();
    });
  });

  it('⭐ un origen de nombre largo precarga «Copia de …» recortado al tope de 60', () => {
    const largo = 'Supervisor de almacén de producto terminado turno noct';
    useRoles.mockReturnValue(estadoRoles([rol(2, largo, false, 0, [])]));
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    const dialogo = duplicarPrimero();
    // 9 de «Copia de » + 55 del origen = 64 → se recorta a los 60 que acepta el backend.
    expect(within(dialogo).getByLabelText(/Nombre/)).toHaveValue(
      'Copia de Supervisor de almacén de producto terminado turno n',
    );
  });

  it('⭐ una clave del origen que no está en el catálogo NO se manda (el backend la rechazaría)', () => {
    useRoles.mockReturnValue(
      estadoRoles([rol(2, 'Almacenista', false, 0, ['almacenes.ver', 'modulo.retirado'])]),
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    const dialogo = duplicarPrimero();
    fireEvent.click(within(dialogo).getByTestId('guardar-rol'));

    return vi.waitFor(() => {
      const cuerpo = crearMutate.mock.calls[0]?.[0] as { clavesPermisos: string[] };
      expect(cuerpo.clavesPermisos).toEqual(['almacenes.ver']);
    });
  });

  it('⭐ al crear la copia, el cajón pasa a la COPIA (no se queda abierto en el origen)', () => {
    const copia = rol(9, 'Copia de Almacenista', false, 0, ['almacenes.ver']);
    // La lista ya trae la copia (como tras el refetch que dispara la mutación).
    useRoles.mockReturnValue(
      estadoRoles([rol(2, 'Almacenista', false, 0, ['almacenes.ver']), copia]),
    );
    crearMutate.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess: (r: Rol) => void }) => {
        opciones.onSuccess(copia);
      },
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    const dialogo = duplicarPrimero();
    fireEvent.click(within(dialogo).getByTestId('guardar-rol'));

    return vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Rol "Copia de Almacenista" creado con 1 permiso.',
      );
      expect(screen.queryByRole('dialog', { name: 'Duplicar rol' })).not.toBeInTheDocument();
      expect(screen.getByTestId('detalle-rol')).toHaveTextContent('Copia de Almacenista');
    });
  });

  it('⭐ el cajón NUNCA queda abierto vacío: mientras la lista no recarga, muestra lo que devolvió el alta', () => {
    const copia = rol(9, 'Copia de Almacenista', false, 0, ['almacenes.ver']);
    // La lista TODAVÍA no trae la copia (el refetch no ha vuelto).
    useRoles.mockReturnValue(estadoRoles([rol(2, 'Almacenista', false, 0, ['almacenes.ver'])]));
    crearMutate.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess: (r: Rol) => void }) => {
        opciones.onSuccess(copia);
      },
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    const dialogo = duplicarPrimero();
    fireEvent.click(within(dialogo).getByTestId('guardar-rol'));

    return vi.waitFor(() => {
      expect(crearMutate).toHaveBeenCalledTimes(1);
      // Abierto Y con contenido: el detalle de la copia, con su árbol.
      const detalle = screen.getByTestId('detalle-rol');
      expect(detalle).toHaveTextContent('Copia de Almacenista');
      expect(within(detalle).getByRole('checkbox', { name: /almacenes\.ver/ })).toBeChecked();
    });
  });

  it('⭐ con la búsqueda ocultando la copia, el cajón muestra el rol VIVO, no la foto del alta', () => {
    const copia = rol(9, 'Copia de Almacenista', false, 0, ['almacenes.ver']);
    useRoles.mockReturnValue(estadoRoles([rol(2, 'Almacenista', false, 0, ['almacenes.ver'])]));
    crearMutate.mockImplementation(
      (_cuerpo: unknown, opciones: { onSuccess: (r: Rol) => void }) => {
        opciones.onSuccess(copia);
      },
    );
    renderConProveedores(<RolesPagina />, {
      sesion: estadoSesionDePrueba(['roles.administrar']),
    });

    fireEvent.change(screen.getByTestId('buscar-rol'), { target: { value: 'Almacenista' } });
    const dialogo = duplicarPrimero();
    fireEvent.click(within(dialogo).getByTestId('guardar-rol'));

    return vi
      .waitFor(() => {
        expect(screen.getByTestId('detalle-rol')).toHaveTextContent('Copia de Almacenista');
      })
      .then(() => {
        // La lista viva ya trae la copia RENOMBRADA: la búsqueda «almacenista» ya no la
        // encuentra (ni por nombre ni por descripción).
        useRoles.mockReturnValue(
          estadoRoles([
            rol(2, 'Almacenista', false, 0, ['almacenes.ver']),
            rol(9, 'Turno B', false, 0, ['almacenes.ver']),
          ]),
        );
        // Cualquier cambio de la búsqueda vuelve a pintar la pantalla con la lista nueva.
        fireEvent.change(screen.getByTestId('buscar-rol'), { target: { value: 'almacenista' } });

        expect(screen.getAllByTestId('fila-rol')).toHaveLength(1); // la copia quedó oculta
        const detalle = screen.getByTestId('detalle-rol');
        expect(detalle).toHaveTextContent('Turno B');
        expect(detalle).not.toHaveTextContent('Copia de Almacenista');
        // Y las acciones del cajón trabajan sobre el rol VIVO: «Duplicar» parte de «Turno B».
        fireEvent.click(screen.getByTestId('duplicar-rol'));
        const otra = screen.getByRole('dialog', { name: 'Duplicar rol' });
        expect(within(otra).getByLabelText(/Nombre/)).toHaveValue('Copia de Turno B');
      });
  });

  it.each([
    [
      'cargando',
      { data: undefined, isPending: true, isError: false, error: null } satisfies EstadoCatalogo,
    ],
    [
      'con error',
      {
        data: undefined,
        isPending: false,
        isError: true,
        error: new ErrorDeApi({ codigo: 'INTERNO', mensaje: 'Falló el catálogo.' }),
      } satisfies EstadoCatalogo,
    ],
  ])(
    '⭐ con el catálogo %s, «Crear rol» de la COPIA queda deshabilitado (no nace con 0 permisos a ciegas)',
    (_caso, estado) => {
      usePermisosCatalogo.mockReturnValue(estado);
      useRoles.mockReturnValue(estadoRoles([rol(2, 'Almacenista', false, 0, ['almacenes.ver'])]));
      renderConProveedores(<RolesPagina />, {
        sesion: estadoSesionDePrueba(['roles.administrar']),
      });

      const dialogo = duplicarPrimero();
      expect(within(dialogo).getByTestId('guardar-rol')).toBeDisabled();
      fireEvent.click(within(dialogo).getByTestId('guardar-rol'));
      expect(crearMutate).not.toHaveBeenCalled();
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));

      // El alta EN BLANCO no depende del catálogo (nace sin permisos): ahí sí se puede crear.
      fireEvent.click(screen.getByTestId('nuevo-rol'));
      const alta = screen.getByRole('dialog', { name: 'Nuevo rol' });
      expect(within(alta).getByTestId('guardar-rol')).toBeEnabled();
    },
  );
});
