import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
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
    empresaActiva: { id: 1, nombre: 'FR Moda' },
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
    permisos: conjunto,
    tienePermiso: (clave) => conjunto.has(clave),
    refrescar: () => Promise.resolve(),
    ...sobrescribir,
  };
}

/** Opciones para {@link renderConProveedores}. */
interface OpcionesRender extends Omit<RenderOptions, 'wrapper'> {
  /** Estado de sesion a proveer (por defecto: sesion cargada sin permisos). */
  sesion?: EstadoSesion;
  /** Ruta inicial del router en memoria. */
  rutaInicial?: string;
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
