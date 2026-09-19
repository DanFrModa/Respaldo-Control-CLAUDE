import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderConProveedores } from '@/pruebas/utilidades';

/**
 * ⭐ NINGÚN DEFAULT DE `origen` PUEDE COMERSE LOS BUSCADORES (V1-E3n).
 *
 * §Post-F9.34 punto 2 pedía que **el catálogo y la galería** —lo que se NAVEGA— enseñaran producción por
 * default, para que las muestras que nunca salen no llenen la vitrina. Pero el default vive en el
 * servidor, así que se aplicaba también a las **cajas de búsqueda por texto**, donde alguien teclea un
 * código que ya conoce. Ahí esconder los de desarrollo no es limpieza: es romper el camino.
 *
 * 🔁 **V1-E8j (§Post-F9.134): el default del servidor pasó a `'todos'`**, así que hoy estos buscadores
 * no dependen de él para funcionar. **Las aserciones se quedan, y a propósito:** son el candado de que
 * ninguno de los cinco vuelva a heredar un default que los acote. Que el peligro esté dormido no es
 * razón para quitarle la reja — y el `'produccion'` de la última prueba sigue midiendo lo mismo: que el
 * llamador PUEDE acotar cuando de verdad quiere una sola cara.
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

/**
 * Monta `EditorRenglones` con el formulario mínimo que necesita.
 *
 * ⚠️ **Arranca CON un renglón, y es deliberado (fila 0.209).** Antes montaba con la lista vacía y aun
 * así había consulta, porque el editor pedía el catálogo entero UNA vez desde arriba. Desde que cada
 * renglón lleva su propio buscador, sin renglones no hay buscador que medir: con `renglones: []` esta
 * prueba no comprobaría nada y pasaría igual.
 */
function EditorRenglonesDePrueba(): React.JSX.Element {
  const formulario = useForm({
    defaultValues: { renglones: [{ idModelo: '', cantidadPedida: '', precio: '0' }] },
  });
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

  /**
   * 🔴 **LA MITAD QUE ESTA PRUEBA NO MEDÍA — y por la que estuvo verde sobre una garantía rota
   * (fila 0.209).**
   *
   * La aserción de arriba comprueba que los modelos de desarrollo estén **INVITADOS** (`origen:
   * 'todos'` viaja en la query). No comprobaba que fueran **ALCANZABLES**. Y no lo eran: el combo
   * pedía `porPagina: 100` **sin `busqueda`** contra un catálogo de ~5,400 modelos (Daniel,
   * 19-sep-2026), así que el de desarrollo entraba en la consulta y **se caía en el lugar 101**. La
   * invitación se cumplía, el candado seguía verde, y la garantía que el encabezado de este archivo
   * dice proteger —*«que haya manera manual de llegar a generar la OP»*— llevaba tiempo rota.
   *
   * Hermana exacta de la cicatriz del localizador laxo (`CLAUDE.md` §8, 7-sep-2026): *una aserción
   * que se cumple por el motivo equivocado no avisa de nada.*
   */
  it('…y se puede LLEGAR a ellos: lo tecleado en el renglón viaja al servidor', async () => {
    renderConProveedores(<EditorRenglonesDePrueba />, {
      sesion: { permisos: ['pedidos.administrar'] } as never,
    });

    const input = screen.getByTestId('renglon-modelo-0-busqueda');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'CYA-26-71-001' } });

    // `waitFor` absorbe el debounce de 300 ms del typeahead. Sin búsqueda server-side esto nunca
    // aparece en la query: el filtro sería sólo de la página ya cargada, que es exactamente el
    // defecto que la fila 0.209 vino a matar.
    await waitFor(() => {
      expect(queriesVistas.some((q) => q.busqueda === 'CYA-26-71-001')).toBe(true);
    });
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
   * ⛔ **LA FRONTERA DE DANIEL, VERIFICADA EN EL COMPONENTE QUE ÉL NOMBRÓ (fila 0.209).**
   *
   * **Daniel, 19-sep-2026:** *«es importante **siempre poder jalar un modelo de desarrollo aunque sea
   * muy viejo**… para copiar su receta… en cualquier momento del futuro»*. El renglón del pedido sí
   * ordena por «lo más reciente primero» (§Post-F9.235(d)); **copiar receta NO**, y eso está prometido
   * en TRES sitios —`SelectorModelo.tsx`, `§Post-F9.235(d)` y la fila 0.209— **y no lo comprobaba
   * ninguno**.
   *
   * ⚖️ **Honestidad sobre la severidad:** con el orden cambiado el requisito de Daniel **se seguiría
   * cumpliendo**, porque aquí hay buscador server-side y un desarrollo viejo se alcanza tecleando. Es
   * un hueco **documentación-contra-prueba**, no un defecto vivo. Se cierra igual, porque es la
   * cicatriz de la casa: *una decisión escrita en un comentario que ninguna prueba verifica es una
   * decisión que el siguiente cambio borra en silencio.*
   */
  it('COPIAR RECETA no hereda el orden por reciente (Daniel: «aunque sea muy viejo»)', () => {
    renderConProveedores(<CopiarBomDialogo abierto alCambiarAbierto={() => {}} idDestino={1} />, {
      sesion: { permisos: ['modelos.administrar'] } as never,
    });
    expect(queriesVistas.every((q) => q.ordenarPor === 'codigo')).toBe(true);
    expect(queriesVistas.every((q) => q.direccion === 'asc')).toBe(true);
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

  /**
   * ⛔ **LA FRONTERA DE LA FILA 0.209, fijada por Daniel (19-sep-2026).** El orden «lo más reciente
   * primero» es del RENGLÓN DEL PEDIDO, no de todo el mundo: de los modelos de desarrollo dijo
   * *«es importante siempre poder jalar un modelo de desarrollo aunque sea muy viejo… para copiar su
   * receta»*. Si este default se volviera «reciente primero», ese requisito quedaría torcido en las
   * demás pantallas sin que nadie lo notara.
   */
  it('el SELECTOR reutilizable NO hereda el orden por reciente (ése es del renglón del pedido)', () => {
    renderConProveedores(<SelectorModelo idSeleccionado={undefined} alSeleccionar={() => {}} />, {
      sesion: { permisos: ['inventario-pt.ver'] } as never,
    });
    expect(ultimaQuery?.ordenarPor).toBe('codigo');
    expect(ultimaQuery?.direccion).toBe('asc');
  });

  it('…y el llamador puede acotarlo cuando de verdad quiere una sola cara del catálogo', () => {
    renderConProveedores(
      <SelectorModelo idSeleccionado={undefined} alSeleccionar={() => {}} origen="produccion" />,
      { sesion: { permisos: ['inventario-pt.ver'] } as never },
    );
    expect(ultimaQuery?.origen).toBe('produccion');
  });
});
