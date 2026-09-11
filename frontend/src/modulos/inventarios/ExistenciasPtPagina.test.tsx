import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExistenciasPt } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { ExistenciasPtPagina } from './ExistenciasPtPagina';

const filaBase: ExistenciasPt['filas'][number] = {
  idModelo: 1,
  modelo: 'A-100',
  idColor: 7,
  color: 'Rojo',
  idTalla: 11,
  etiquetaTalla: 'CH',
  ordenTalla: 1,
  idAlmacen: 3,
  almacen: 'Primeras',
  idOrden: 9,
  folioOrden: 42,
  existencia: 30,
};

/** Respuesta de existencias con el encabezado de recorte que declara el contrato (fila 0.143). */
function respuesta(sobrescribir: Partial<ExistenciasPt> = {}): ExistenciasPt {
  const filas = sobrescribir.filas ?? [filaBase];
  return {
    filas,
    totalExistencia: 30,
    totalFilas: filas.length,
    limite: 1000,
    truncado: false,
    ...sobrescribir,
  };
}

const useExistenciasMock = vi.fn();

vi.mock('@/api/inventarios', () => ({
  useExistenciasPt: (...args: unknown[]) => useExistenciasMock(...args) as unknown,
}));
vi.mock('@/api/colores', () => ({ useColores: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/tallas', () => ({ useTallas: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/almacenes', () => ({ useAlmacenes: () => ({ data: { datos: [] } }) }));
vi.mock('@/api/modelos', () => ({
  useModelos: () => ({ data: { datos: [] }, isPending: false, isError: false }),
}));

beforeEach(() => {
  useExistenciasMock.mockReturnValue({
    data: respuesta(),
    isPending: false,
    isError: false,
    error: null,
  });
});

describe('ExistenciasPtPagina (F3-E3)', () => {
  it('muestra la fila de existencia y el total (tabla de escritorio + tarjetas móvil)', () => {
    renderConProveedores(<ExistenciasPtPagina />, {
      sesion: estadoSesionDePrueba(['inventario-pt.ver']),
    });
    // El total aparece en el resumen.
    expect(screen.getByText(/Total:/)).toBeInTheDocument();
    // Tanto la tabla (escritorio) como las tarjetas (móvil) existen en el DOM (la visibilidad la
    // controla Tailwind con clases responsive).
    expect(screen.getByTestId('exist-tabla')).toBeInTheDocument();
    expect(screen.getByTestId('exist-tarjetas')).toBeInTheDocument();
    // El dato de la fila se pinta (modelo/color/talla/almacén/existencia).
    expect(screen.getAllByText('A-100').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Primeras').length).toBeGreaterThan(0);
    expect(screen.getAllByText('30').length).toBeGreaterThan(0);
    // PT por orden (F6-E2): la fila muestra a qué orden pertenecen las prendas.
    expect(screen.getAllByText('Orden #42').length).toBeGreaterThan(0);
  });
});

/**
 * ⭐ FILA 0.143 — QUE LA PANTALLA NO SE CREA QUE VE TODO EL INVENTARIO.
 *
 * El recorte lo hace el servidor; a esta pantalla le toca **decirlo**. No es adorno: sin el aviso,
 * una lista de 1 000 renglones se lee como «el almacén tiene 1 000 renglones» — y el problema de
 * peso se habría cambiado por uno de VERDAD, que es peor.
 */
describe('ExistenciasPtPagina · el TOPE (fila 0.143)', () => {
  const sesion = () => estadoSesionDePrueba(['inventario-pt.ver']);

  /** Deja la pantalla como si el servidor hubiera cortado la lista. */
  function conRecorte(): void {
    useExistenciasMock.mockReturnValue({
      data: respuesta({ truncado: true, limite: 1000, totalFilas: 56_860 }),
      isPending: false,
      isError: false,
      error: null,
    });
  }

  it('⭐ si la lista vino CORTADA lo dice, con las DOS cifras y qué hacer', () => {
    conRecorte();
    renderConProveedores(<ExistenciasPtPagina />, { sesion: sesion() });

    const aviso = screen.getByTestId('exist-truncado');
    // Cuántos se enseñan y cuántos hay: sin la segunda cifra el aviso no dice nada útil.
    expect(aviso).toHaveTextContent('56,860');
    // Y qué hacer para llegar al resto (el filtro es la herramienta, no un paginador).
    expect(aviso).toHaveTextContent(/[Ff]iltra/);
    // ⚠️ Y NO puede leerse como «esto es todo»: el aviso dice que NO caben todos.
    expect(aviso).toHaveTextContent(/No caben todos/);
  });

  it('⭐ el conteo de la barra cuenta el UNIVERSO, no lo que cupo', () => {
    conRecorte();
    renderConProveedores(<ExistenciasPtPagina />, { sesion: sesion() });

    // «1 de 56,860», nunca «1 renglones» a secas: ese número suelto es la mentira que se evita.
    expect(screen.getByTestId('exist-conteo')).toHaveTextContent('1 de 56,860 renglones');
  });

  it('⭐ el KPI «Renglones» también cuenta el universo (es el número que se lee de un vistazo)', () => {
    conRecorte();
    renderConProveedores(<ExistenciasPtPagina />, { sesion: sesion() });

    // El pie de la tarjeta de KPIs dice cuántos se listan de verdad (texto único en la pantalla).
    expect(screen.getByText(/se listan 1$/)).toBeInTheDocument();
    // Y el universo se pinta en los TRES sitios que antes decían `filas.length`: el valor del KPI,
    // el aviso de recorte y la barra de totales. Un conteo exacto caza que alguno se quede atrás.
    expect(screen.getAllByText('56,860')).toHaveLength(3);
  });

  /**
   * ⭐⭐ LA GEMELA EN NEGATIVO — el único sitio donde la simetría se rompe a propósito.
   *
   * Las TRES pantallas de captura piden el techo (5 000) porque necesitan la lista completa de
   * órdenes de un modelo, y eso está fijado por sus propias pruebas. **Ésta, no.** Existencias es
   * un INFORME sobre todo el almacén: su universo es el inventario entero, y pedir el techo aquí
   * traería 5 000 renglones en cada carga — que es exactamente el defecto que la fila 0.143 vino a
   * matar, sólo que con otro número.
   *
   * 🔑 Sin esta prueba, alguien que copiara el patrón de las pantallas de captura a esta pantalla
   * —un cambio de una línea, y plausible, porque son vecinas y se parecen— **dejaría la suite
   * entera en verde** mientras la fila pierde su razón de ser. Un guardián en positivo («las de
   * captura SÍ lo mandan») no ve ese cambio: hace falta el que dice «ésta NO».
   */
  it('⭐⭐ la pantalla de EXISTENCIAS **no** manda `limite`: se queda con el default del dominio', () => {
    // Se limpia para medir SÓLO las consultas de este render (los `mock.calls` se acumulan entre
    // pruebas del archivo: sin esto, el conteo de abajo arrastraría las de las pruebas anteriores).
    useExistenciasMock.mockClear();
    renderConProveedores(<ExistenciasPtPagina />, { sesion: sesion() });

    const consultas = useExistenciasMock.mock.calls.map(([q]) => q as Record<string, unknown>);
    // Sin esto el `for` de abajo pasaría con CERO consultas, que es la vacuidad de siempre.
    expect(consultas.length).toBeGreaterThan(0);
    // A1: el tope de esta pantalla lo pone el DOMINIO (1 000). Mandar `limite` desde aquí sería
    // decidir en el cliente una regla que es del servidor — y, con el techo, resucitar el defecto.
    for (const q of consultas) expect(q.limite).toBeUndefined();
  });

  it('sin corte no hay aviso, y el conteo es una sola cifra (el aviso tiene que significar algo)', () => {
    renderConProveedores(<ExistenciasPtPagina />, { sesion: sesion() });

    expect(screen.queryByTestId('exist-truncado')).not.toBeInTheDocument();
    expect(screen.getByTestId('exist-conteo')).toHaveTextContent('1 renglones');
    expect(screen.getByTestId('exist-conteo')).not.toHaveTextContent(/ de /);
  });
});
