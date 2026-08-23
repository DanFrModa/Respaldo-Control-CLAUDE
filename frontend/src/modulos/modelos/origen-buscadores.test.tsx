import { screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderConProveedores } from '@/pruebas/utilidades';

/**
 * ⭐ EL DEFAULT `origen: 'produccion'` DEL API NO PUEDE COMERSE LOS BUSCADORES (V1-E3n).
 *
 * §Post-F9.34 punto 2 pide que **el catálogo y la galería** —lo que se NAVEGA— enseñen producción por
 * default, para que las muestras que nunca salen no llenen la vitrina. Pero el default vive en el
 * servidor, así que se aplica también a las **cajas de búsqueda por texto**, donde alguien teclea un
 * código que ya conoce. Ahí esconder los de desarrollo no es limpieza: es romper el camino.
 *
 * En especial el **combo del renglón del pedido**: si un modelo de desarrollo no se puede poner en un
 * pedido, entonces *no hay manera manual de llegar a «generar la OP»* — que es justo lo que pasa el
 * modelo a producción, o sea lo que esta etapa construye.
 *
 * Cada prueba mira la query REAL que sale hacia el API, no que el componente pinte algo.
 */
let ultimaQuery: Record<string, unknown> | undefined;
const queriesVistas: Record<string, unknown>[] = [];

vi.mock('@/api/modelos', () => ({
  useModelos: (query: Record<string, unknown>) => {
    ultimaQuery = query;
    queriesVistas.push(query);
    return {
      data: { datos: [] },
      isPending: false,
      isFetching: false,
      isError: false,
      error: null,
    };
  },
  useCopiarBom: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/costos', () => ({ usePreCosto: () => ({ data: undefined, isPending: false }) }));

const { PreCostoPagina } = await import('@/modulos/costos/PreCostoPagina');
const { EditorRenglones } = await import('@/modulos/pedidos/EditorRenglones');
const { CopiarBomDialogo } = await import('@/modulos/modelos/CopiarBomDialogo');
const { SelectorModelo } = await import('@/modulos/inventarios/SelectorModelo');

/** Monta `EditorRenglones` con el formulario mínimo que necesita. */
function EditorRenglonesDePrueba(): React.JSX.Element {
  const formulario = useForm({ defaultValues: { renglones: [] } });
  return (
    <EditorRenglones
      control={formulario.control as never}
      registrar={formulario.register as never}
      errores={{}}
      puedeVerImportes={false}
      deshabilitado={false}
    />
  );
}

describe('el default de origen no puede esconder los modelos de desarrollo de los buscadores', () => {
  beforeEach(() => {
    ultimaQuery = undefined;
    queriesVistas.length = 0;
  });

  it('PRE-COSTO busca en los DOS catálogos (precostear un modelo de desarrollo es D13)', () => {
    renderConProveedores(<PreCostoPagina />, {
      sesion: { permisos: ['precostos.consultar'] } as never,
    });
    // 'todos', no 'produccion' ni undefined: con cualquiera de esos dos, teclear `CYA-26-71-001`
    // aquí no devuelve nada.
    expect(ultimaQuery?.origen).toBe('todos');
  });

  it('el COMBO DEL RENGLÓN del pedido ofrece también los de desarrollo', () => {
    renderConProveedores(<EditorRenglonesDePrueba />, {
      sesion: { permisos: ['pedidos.administrar'] } as never,
    });
    expect(ultimaQuery?.origen).toBe('todos');
  });

  it('COPIAR RECETA puede tomarla de un modelo de desarrollo', () => {
    renderConProveedores(<CopiarBomDialogo abierto alCambiarAbierto={() => {}} idDestino={1} />, {
      sesion: { permisos: ['modelos.administrar'] } as never,
    });
    expect(queriesVistas.some((q) => q.origen === 'todos')).toBe(true);
    // Y ninguna de las consultas de este diálogo se quedó con el default del servidor.
    expect(queriesVistas.every((q) => q.origen === 'todos')).toBe(true);
    expect(screen.getByTestId('copiar-bom-buscar')).toBeInTheDocument();
  });

  /**
   * El SELECTOR reutilizable (movimientos/traspasos/kardex/existencias de PT, inventarios cíclicos y
   * el alta de desarrollo con «modelo existente»). Era el único de los cinco buscadores sin candado:
   * volverle el default a `'produccion'` dejaba la suite entera en verde.
   */
  it('el SELECTOR DE MODELO reutilizable busca en los dos catálogos por default', () => {
    renderConProveedores(<SelectorModelo idSeleccionado={undefined} alSeleccionar={() => {}} />, {
      sesion: { permisos: ['inventario-pt.ver'] } as never,
    });
    expect(ultimaQuery?.origen).toBe('todos');
  });

  it('…y el llamador puede acotarlo cuando de verdad quiere una sola cara del catálogo', () => {
    renderConProveedores(
      <SelectorModelo idSeleccionado={undefined} alSeleccionar={() => {}} origen="produccion" />,
      { sesion: { permisos: ['inventario-pt.ver'] } as never },
    );
    expect(ultimaQuery?.origen).toBe('produccion');
  });
});
