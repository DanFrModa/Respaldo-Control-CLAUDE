import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { GaleriaArteItem } from '@/api/artes';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

/**
 * 🔒 Fila 0.249 parte C — el diálogo «copiar arte de otro modelo» pinta el precio de cada arte
 * (al copiar se copia SU precio). Si el servidor lo TAPÓ, se dice «—», nunca «sin precio».
 */
const items = vi.hoisted(() => ({ datos: [] as unknown[] }));
vi.mock('@/api/artes', () => ({
  useCopiarArte: () => ({ mutate: vi.fn(), isPending: false }),
  useGaleriaArte: () => ({
    data: { datos: items.datos, total: items.datos.length, pagina: 1, porPagina: 24 },
    isPending: false,
    isError: false,
    isFetching: false,
  }),
}));

const { CopiarArteDialogo } = await import('./CopiarArteDialogo');

function celda(id: number, sobre: Partial<GaleriaArteItem>): GaleriaArteItem {
  return {
    id,
    descripcion: `Arte ${String(id)}`,
    posicion: null,
    idTipoArte: 9,
    tipoArte: 'Bordado',
    precio: null,
    preciosOcultos: false,
    idArchivoFoto: null,
    idModelo: 100 + id,
    claveModelo: `M-${String(id)}`,
    nombreModelo: null,
    ...sobre,
  };
}

describe('<CopiarArteDialogo> con el precio TAPADO (0.249 parte C)', () => {
  it('tapado ⇒ «—»; sin la marca, un null es «sin precio» y un precio se pinta', () => {
    items.datos = [celda(1, { preciosOcultos: true }), celda(2, {}), celda(3, { precio: 45 })];
    renderConProveedores(<CopiarArteDialogo abierto alCambiarAbierto={vi.fn()} idModelo={1} />, {
      sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']),
    });
    expect(screen.getByTestId('copiar-arte-1')).toHaveTextContent('—');
    expect(screen.getByTestId('copiar-arte-1')).not.toHaveTextContent('sin precio');
    expect(screen.getByTestId('copiar-arte-2')).toHaveTextContent('sin precio');
    expect(screen.getByTestId('copiar-arte-3')).toHaveTextContent('$45.00');
  });
});
