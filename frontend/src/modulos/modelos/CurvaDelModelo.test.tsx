import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CurvasSugeridas, ModeloFicha } from '@/api/modelos';
import { renderConProveedores } from '@/pruebas/utilidades';

import { CurvaDelModelo } from './CurvaDelModelo';

/**
 * Pruebas del bloque de CURVA de la ficha del modelo (V1-E3r, §Post-F9.81).
 *
 * 🔴 Lo que defienden, más allá de que pinte: que la pantalla **no redacte** el aviso (el texto
 * viaja hecho del servidor), que la asignación **se confirme** y que cuando varias OP usan curvas
 * distintas **se enseñen todas** en vez de elegir por el usuario.
 */
const asignarMutate = vi.fn();
let sugeridas: CurvasSugeridas = { idModelo: 1, yaTieneCurva: false, sugerencias: [] };

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/api/modelos', () => ({
  useCurvasSugeridas: () => ({ data: sugeridas }),
  useAsignarCurvaDesdeOrdenes: () => ({ mutate: asignarMutate, isPending: false }),
}));

function ficha(extra: Partial<ModeloFicha> = {}): ModeloFicha {
  return {
    id: 1,
    tallasCurva: [],
    avisosCurva: [],
    ...extra,
  } as unknown as ModeloFicha;
}

beforeEach(() => {
  asignarMutate.mockClear();
  sugeridas = { idModelo: 1, yaTieneCurva: false, sugerencias: [] };
});

describe('CurvaDelModelo', () => {
  it('sin aviso ni propuesta no pinta nada (no ocupa espacio de balde)', () => {
    renderConProveedores(<CurvaDelModelo ficha={ficha()} puedeAdministrar />);
    expect(screen.queryByTestId('curva-del-modelo')).not.toBeInTheDocument();
  });

  describe('el AVISO de curva distinta', () => {
    it('pinta el texto TAL CUAL viene del servidor (la pantalla no lo redacta)', () => {
      const texto =
        'La curva del modelo («Caballero básica»: XC, CH, M) no coincide con las tallas de 2 ' +
        'órdenes de producción («Curva 3M-6M»: 3M, 6M): … No bloquea.';
      renderConProveedores(
        <CurvaDelModelo
          ficha={ficha({
            tallasCurva: [{ idTalla: 1, etiqueta: 'XC', posicion: 0 }],
            avisosCurva: [texto],
          })}
          puedeAdministrar
        />,
      );
      expect(screen.getByTestId('modelo-avisos-curva')).toHaveTextContent('Caballero básica');
      expect(screen.getByText(texto)).toBeInTheDocument();
    });

    it('con varios conjuntos distintos pinta un renglón por cada uno', () => {
      renderConProveedores(
        <CurvaDelModelo
          ficha={ficha({
            tallasCurva: [{ idTalla: 1, etiqueta: 'XC', posicion: 0 }],
            avisosCurva: ['aviso uno', 'aviso dos'],
          })}
          puedeAdministrar
        />,
      );
      expect(screen.getByTestId('modelo-avisos-curva').querySelectorAll('li')).toHaveLength(2);
    });

    /*
     * 🔴 **QUE EL AVISO NO BLOQUEE ES LA GARANTÍA CENTRAL** (§Post-F9.81 + §Post-F9.64: *la curva es
     * una GUÍA, no una jaula*), y hay que probarla con un estado donde **haya algo que bloquear**.
     *
     * ⚠️ La versión anterior de esta prueba renderizaba con aviso y SIN propuesta y afirmaba que no
     * había botón — pero en ese estado no hay **ningún** botón que pintar, así que pasaba por la
     * razón equivocada: el reviewer mutó el componente a
     * `disabled={asignar.isPending || avisos.length > 0}` —el aviso deshabilitando literalmente la
     * acción— y las 45 pruebas del archivo **sobrevivieron**.
     *
     * Por eso ahora se renderiza con aviso **Y** propuesta a la vez y se afirma que el botón sigue
     * **habilitado**. Hoy la ficha no puede llegar a ese estado (el servidor devuelve `[]` de avisos
     * cuando el modelo no tiene curva: ahí no hay dos curvas que se contradigan, hay un hueco). Se
     * prueba igual, y a propósito: el componente recibe las dos cosas como props independientes, así
     * que **la garantía tiene que vivir en el componente**, no depender de que el servidor no cambie.
     * El día que el servidor avise por otra razón, esta prueba ya está puesta.
     */
    it('🔴 NO bloquea: con aviso Y propuesta a la vez, «Asignar esta curva» sigue HABILITADO', () => {
      sugeridas = {
        idModelo: 1,
        yaTieneCurva: false,
        sugerencias: [
          {
            idsTalla: [7, 8, 9],
            etiquetas: ['CH', 'M', 'G'],
            ordenes: 3,
            folios: [11, 12, 13],
            idCurvaExistente: null,
            nombre: 'Curva CH-M-G',
          },
        ],
      };
      renderConProveedores(
        <CurvaDelModelo ficha={ficha({ avisosCurva: ['aviso'] })} puedeAdministrar />,
      );

      // El aviso está pintado (si no, la prueba no estaría probando lo que dice).
      expect(screen.getByTestId('modelo-avisos-curva')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Asignar esta curva/ })).toBeEnabled();
    });

    it('el aviso es un BANNER: no mete botones ni acciones propias', () => {
      renderConProveedores(
        <CurvaDelModelo
          ficha={ficha({
            tallasCurva: [{ idTalla: 1, etiqueta: 'XC', posicion: 0 }],
            avisosCurva: ['aviso'],
          })}
          puedeAdministrar
        />,
      );
      expect(screen.getByTestId('modelo-avisos-curva')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('la PROPUESTA (jalar la curva de la OP)', () => {
    const unaSugerencia = {
      idsTalla: [7, 8, 9],
      etiquetas: ['CH', 'M', 'G'],
      ordenes: 3,
      folios: [11, 12, 13],
      idCurvaExistente: null,
      nombre: 'Curva CH-M-G',
    };

    it('propone la curva de las OP y dice cuántas la usan', () => {
      sugeridas = { idModelo: 1, yaTieneCurva: false, sugerencias: [unaSugerencia] };
      renderConProveedores(<CurvaDelModelo ficha={ficha()} puedeAdministrar />);

      expect(screen.getByTestId('modelo-curva-sugerida')).toHaveTextContent('CH · M · G');
      expect(screen.getByTestId('modelo-curva-sugerida')).toHaveTextContent('3 órdenes');
      expect(screen.getByTestId('modelo-curva-sugerida')).toHaveTextContent('11, 12, 13');
    });

    it('NO se aplica sola: hace falta confirmar', async () => {
      sugeridas = { idModelo: 1, yaTieneCurva: false, sugerencias: [unaSugerencia] };
      renderConProveedores(<CurvaDelModelo ficha={ficha()} puedeAdministrar />);
      expect(asignarMutate).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: /asignar esta curva/i }));
      expect(asignarMutate).toHaveBeenCalledTimes(1);
      expect(asignarMutate.mock.calls[0]?.[0]).toEqual({ id: 1, idsTalla: [7, 8, 9] });
    });

    /*
     * ⚠️ El caso que da sentido a la decisión: si varias OP usan curvas distintas, la pantalla las
     * enseña TODAS y elige la persona. Quedarse con "la más usada" fallaría en silencio justo aquí.
     */
    it('si hay VARIAS curvas distintas las enseña todas, con un botón por cada una', () => {
      sugeridas = {
        idModelo: 1,
        yaTieneCurva: false,
        sugerencias: [
          unaSugerencia,
          {
            idsTalla: [1, 2],
            etiquetas: ['3M', '6M'],
            ordenes: 1,
            folios: [20],
            idCurvaExistente: 44,
            nombre: 'Curva bebé',
          },
        ],
      };
      renderConProveedores(<CurvaDelModelo ficha={ficha()} puedeAdministrar />);

      expect(screen.getByTestId('curva-sugerida-7-8-9')).toBeInTheDocument();
      expect(screen.getByTestId('curva-sugerida-1-2')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /asignar esta curva/i })).toHaveLength(2);
      expect(screen.getByTestId('modelo-curva-sugerida')).toHaveTextContent(
        'usan curvas distintas',
      );
    });

    it('dice si la curva se va a CREAR en el catálogo o si ya existe', () => {
      sugeridas = { idModelo: 1, yaTieneCurva: false, sugerencias: [unaSugerencia] };
      const { unmount } = renderConProveedores(<CurvaDelModelo ficha={ficha()} puedeAdministrar />);
      expect(screen.getByTestId('curva-sugerida-7-8-9')).toHaveTextContent(
        'se creará en el catálogo',
      );
      unmount();

      sugeridas = {
        idModelo: 1,
        yaTieneCurva: false,
        sugerencias: [{ ...unaSugerencia, idCurvaExistente: 9 }],
      };
      renderConProveedores(<CurvaDelModelo ficha={ficha()} puedeAdministrar />);
      expect(screen.getByTestId('curva-sugerida-7-8-9')).not.toHaveTextContent('se creará');
    });

    // §Post-F9.68: esconder Y bloquear. Aquí el esconder; el bloquear lo hace el servidor.
    it('sin permiso de administrar NO ofrece el botón', () => {
      sugeridas = { idModelo: 1, yaTieneCurva: false, sugerencias: [unaSugerencia] };
      renderConProveedores(<CurvaDelModelo ficha={ficha()} puedeAdministrar={false} />);
      expect(screen.getByTestId('modelo-curva-sugerida')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /asignar esta curva/i })).not.toBeInTheDocument();
    });

    it('si el modelo YA tiene curva no propone nada (esta puerta sólo llena huecos)', () => {
      sugeridas = { idModelo: 1, yaTieneCurva: true, sugerencias: [] };
      renderConProveedores(
        <CurvaDelModelo
          ficha={ficha({ tallasCurva: [{ idTalla: 1, etiqueta: 'XC', posicion: 0 }] })}
          puedeAdministrar
        />,
      );
      expect(screen.queryByTestId('modelo-curva-sugerida')).not.toBeInTheDocument();
    });
  });
});
