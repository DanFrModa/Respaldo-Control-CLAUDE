import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  type RenderOptions,
  type RenderResult,
  screen,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { EstadoSesion } from '@/sesion/contexto';
import { ContextoSesion } from '@/sesion/contexto';
import type { ClavePermiso, Sesion } from '@/api/tipos';

/** Crea un QueryClient aislado para una prueba (sin reintentos ni cache compartida). */
export function crearQueryClientDePrueba(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** Sesion de ejemplo (admin con todos los permisos) para las pruebas de UI. */
export function sesionDePrueba(permisos: ClavePermiso[]): Sesion {
  return {
    id: 'usuario-prueba',
    username: 'admin',
    nombre: 'Administrador',
    empresaActiva: { id: 1, nombre: 'FR Moda', idArchivoLogo: null },
    permisos,
  };
}

/**
 * Construye un `EstadoSesion` para inyectar via `ContextoSesion.Provider` en las
 * pruebas de componentes, sin tocar la red. Por defecto representa una sesion
 * cargada con los permisos dados.
 */
export function estadoSesionDePrueba(
  permisos: ClavePermiso[] = [],
  sobrescribir: Partial<EstadoSesion> = {},
): EstadoSesion {
  const conjunto = new Set(permisos);
  return {
    sesion: sesionDePrueba(permisos),
    cargando: false,
    // Por defecto, una sesión resuelta y presente (V1-E3i: hay cuatro estados, no dos).
    estado: 'con-sesion',
    errorConsulta: null,
    permisos: conjunto,
    tienePermiso: (clave) => conjunto.has(clave),
    refrescar: () => Promise.resolve(),
    ...sobrescribir,
  };
}

/** Entrada inicial del router en memoria: una ruta (string) o un objeto con `state` (deep-links). */
export type EntradaRuta = string | { pathname: string; state?: unknown };

/** Opciones para {@link renderConProveedores}. */
interface OpcionesRender extends Omit<RenderOptions, 'wrapper'> {
  /** Estado de sesion a proveer (por defecto: sesion cargada sin permisos). */
  sesion?: EstadoSesion;
  /** Ruta inicial del router en memoria (string o `{ pathname, state }` para deep-links). */
  rutaInicial?: EntradaRuta;
  /** QueryClient a usar (por defecto uno nuevo y aislado). */
  queryClient?: QueryClient;
}

/**
 * Renderiza un componente con los proveedores de la app (TanStack Query, router
 * en memoria y contexto de sesion), para probarlo de forma aislada y sin red.
 */
export function renderConProveedores(
  ui: React.ReactNode,
  { sesion, rutaInicial = '/', queryClient, ...opciones }: OpcionesRender = {},
): RenderResult {
  const cliente = queryClient ?? crearQueryClientDePrueba();
  const estado = sesion ?? estadoSesionDePrueba();
  return render(
    <QueryClientProvider client={cliente}>
      <ContextoSesion.Provider value={estado}>
        <MemoryRouter initialEntries={[rutaInicial]}>{ui}</MemoryRouter>
      </ContextoSesion.Provider>
    </QueryClientProvider>,
    opciones,
  );
}

/**
 * Elige una opción en un {@link ComboboxBuscable} (o en cualquiera de los selectores que lo
 * envuelven: `SelectorProveedor`, `FiltroProveedor`, `SelectorCliente`…).
 *
 * Nace con V1-E7g, cuando los `<select>` nativos de proveedor pasaron a comboboxes con búsqueda en
 * SERVIDOR y una docena de pruebas tuvo que dejar de usar `fireEvent.change` sobre un `<select>`.
 * Encapsula las tres trampas del combobox, para no re-tropezarlas en cada archivo:
 *
 *  - la lista SOLO existe con el campo enfocado (`focus` la abre);
 *  - vive en un PORTAL colgado del `body`, así que se busca desde `screen` y NO desde el
 *    contenedor ni desde el diálogo que la contiene;
 *  - elige en `mousedown`, no en `click` (gana antes del `blur` del input); y en jsdom, sin CSS,
 *    un diálogo de radix le pone `pointer-events: none` a todo lo que cuelga del body, con lo que
 *    un `click` de `userEvent` ni siquiera llegaría.
 *
 * `findAllByTestId` cubre además el debounce de 300 ms de la búsqueda server-side.
 *
 * @param testid  el `testid` base del selector (el input es `${testid}-busqueda`).
 * @param texto   lo que se TECLEA (puede casar en MEDIO del nombre: eso es justo lo que se prueba).
 * @param nombre  nombre de la opción a elegir; por defecto, el mismo `texto`.
 */
export async function elegirEnCombobox(
  testid: string,
  texto: string,
  nombre = texto,
): Promise<void> {
  const input = screen.getByTestId(`${testid}-busqueda`);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: texto } });
  const opciones = await screen.findAllByTestId(`${testid}-opcion`);
  const elegida = opciones.find((opcion) => (opcion.textContent ?? '').includes(nombre));
  if (elegida === undefined) {
    throw new Error(
      `El combobox "${testid}" no ofreció "${nombre}" al teclear "${texto}"; ofreció: ${opciones
        .map((o) => o.textContent)
        .join(' · ')}`,
    );
  }
  fireEvent.mouseDown(elegida);
}

/** Limpia la selección de un combobox (el botón ✕ que sale cuando hay algo elegido). */
export function limpiarCombobox(testid: string): void {
  fireEvent.mouseDown(screen.getByTestId(`${testid}-limpiar`));
  fireEvent.click(screen.getByTestId(`${testid}-limpiar`));
}
