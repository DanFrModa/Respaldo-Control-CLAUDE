import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { KardexAvio, KardexTela } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { KardexMaterialesPagina } from './KardexMaterialesPagina';

/** Encabezado del periodo que TODO kardex devuelve desde la fila 0.173 (ventana + tope + corte). */
const PERIODO = {
  desde: '2025-09-05',
  hasta: null,
  ventanaPorOmision: true,
  limite: 1000,
  truncado: false,
} as const;

const kardexTela: KardexTela = {
  idTela: 1,
  tela: 'Felpa',
  ...PERIODO,
  saldosIniciales: [],
  renglones: [
    {
      idMovimiento: 10,
      folio: 1,
      fecha: '2026-06-20',
      idTipoMov: 14,
      tipoMov: 'Ajuste (Entrada)',
      direccion: 'entrada',
      idAlmacen: 5,
      almacen: 'Bodega A',
      idLote: 7,
      loteClave: 'LOTE-A',
      entrada: 100,
      salida: 0,
      saldo: 100,
      costoUnit: null,
      importe: null,
      origenTipo: 'movimiento-manual',
      origenId: null,
      cancelado: false,
      observaciones: 'inventario inicial',
    },
  ],
};

/** Kardex de tela SIN movimientos legados: el caso que producía la pantalla vacía y muda. */
const kardexTelaVacio: KardexTela = {
  idTela: 1,
  tela: 'Felpa',
  ...PERIODO,
  saldosIniciales: [],
  renglones: [],
};

/**
 * Kardex de AVÍO con un movimiento. Antes era una respuesta vacía y eso bastaba, porque de esta
 * pestaña sólo se comprobaba que las fechas viajaran; desde la corrección de la 0.173 se le mide lo
 * mismo que a la de telas (ver el bloque «la pestaña de AVÍOS…» de abajo).
 */
const kardexAvio: KardexAvio = {
  idAvio: 3,
  avio: 'CIERRE-1',
  descripcion: 'Cierre metálico',
  ...PERIODO,
  saldosIniciales: [],
  renglones: [
    {
      idMovimiento: 20,
      folio: 2,
      fecha: '2026-06-21',
      idTipoMov: 14,
      tipoMov: 'Ajuste (Entrada)',
      direccion: 'entrada',
      idAlmacen: 9,
      almacen: 'Avíos A',
      idLote: null,
      entrada: 40,
      salida: 0,
      saldo: 40,
      costoUnit: null,
      importe: null,
      origenTipo: 'movimiento-manual',
      origenId: null,
      cancelado: false,
      observaciones: null,
    },
  ],
};

/** Kardex de avío SIN movimientos en el periodo (el vacío de esa pestaña). */
const kardexAvioVacio: KardexAvio = { ...kardexAvio, renglones: [] };

/** Lo que devuelve `useKardexTela` en cada prueba (por defecto, el kardex con un movimiento). */
const datosKardexTela = vi.fn<() => KardexTela>(() => kardexTela);
/** Lo mismo para AVÍOS: la pestaña se mide igual que la de telas, así que su doble también varía. */
const datosKardexAvio = vi.fn<() => KardexAvio>(() => kardexAvio);
/** La consulta con la que se llamó `useKardexTela` (para comprobar que las fechas VIAJAN). */
const consultaKardexTela = vi.fn<(q: unknown) => void>();
const consultaKardexAvio = vi.fn<(q: unknown) => void>();

// La tela seleccionada se fija al elegir en el SelectorTela (mockeado abajo).
vi.mock('@/api/inventario-materiales', () => ({
  useKardexTela: (q: unknown) => {
    consultaKardexTela(q);
    return { data: datosKardexTela(), isPending: false, isError: false, error: null };
  },
  useKardexAvio: (q: unknown) => {
    consultaKardexAvio(q);
    return { data: datosKardexAvio(), isPending: false, isError: false, error: null };
  },
  useCancelarTela: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelarAvio: () => ({ mutate: vi.fn(), isPending: false }),
}));
// El selector emite la tela al hacer click en su opción.
vi.mock('./SelectorTela', () => ({
  SelectorTela: ({
    alSeleccionar,
  }: {
    alSeleccionar: (t: { id: number; nombre: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="sel-tela"
      onClick={() => alSeleccionar({ id: 1, nombre: 'Felpa' })}
    >
      elegir Felpa
    </button>
  ),
}));
vi.mock('./SelectorAvio', () => ({
  SelectorAvio: ({
    alSeleccionar,
  }: {
    alSeleccionar: (a: { id: number; clave: string; descripcion: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="sel-avio"
      onClick={() => alSeleccionar({ id: 3, clave: 'CIERRE-1', descripcion: 'Cierre metálico' })}
    >
      elegir avío
    </button>
  ),
}));

// El doble se restaura ANTES de cada prueba, no a mano al final de la que lo cambió: así una
// prueba nueva insertada en medio no hereda el kardex vacío de la anterior.
beforeEach(() => {
  datosKardexTela.mockReturnValue(kardexTela);
  datosKardexAvio.mockReturnValue(kardexAvio);
  consultaKardexTela.mockClear();
  consultaKardexAvio.mockClear();
});

/** Abre la pestaña de avíos y elige uno (las dos pestañas son excluyentes: sólo una se pinta). */
function abrirAvios(): void {
  fireEvent.click(screen.getByTestId('kardex-mat-dim-avio'));
  fireEvent.click(screen.getByTestId('sel-avio'));
}

describe('KardexMaterialesPagina (F4-E1)', () => {
  it('muestra el kardex de la tela elegida con tabla (escritorio) y tarjetas (móvil)', () => {
    renderConProveedores(<KardexMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    // Elegir una tela activa la consulta.
    fireEvent.click(screen.getByTestId('sel-tela'));
    expect(screen.getByTestId('kardex-tela-tabla')).toBeInTheDocument();
    expect(screen.getByTestId('kardex-tela-tarjetas')).toBeInTheDocument();
    expect(screen.getAllByText('Ajuste (Entrada)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('LOTE-A').length).toBeGreaterThan(0);
  });

  it('cambia entre las dimensiones telas/avíos con el toggle', () => {
    renderConProveedores(<KardexMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-avios.ver']),
    });
    expect(screen.getByTestId('sel-tela')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('kardex-mat-dim-avio'));
    expect(screen.getByTestId('sel-avio')).toBeInTheDocument();
  });

  it('sin inventario-telas.mover NO muestra el botón de cancelar', () => {
    renderConProveedores(<KardexMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.click(screen.getByTestId('sel-tela'));
    expect(screen.queryByTestId('kardex-tela-cancelar-10')).not.toBeInTheDocument();
  });

  // ── fila 0.098: la pestaña de telas es la del flujo LEGADO y tiene que decirlo ──────────────
  //
  // 🔴 `kardexTela` filtra `idTelaColor: null` en el servidor: aquí SOLO salen los movimientos por
  // lote. Quien entraba buscando los de una tela del inventario vigente se llevaba una pantalla
  // vacía y MUDA. La pestaña no se retiró (sigue siendo la única ventana al histórico por lote):
  // se le quitó la mentira.
  it('la pestaña de telas se presenta como LEGADA por lote', () => {
    renderConProveedores(<KardexMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver', 'inventario-avios.ver']),
    });
    expect(screen.getByTestId('kardex-mat-dim-tela')).toHaveTextContent(/lote.*legado/i);
  });

  it('avisa SIEMPRE (aunque haya movimientos) que el kardex vigente va por color', () => {
    datosKardexTela.mockReturnValue(kardexTela);
    renderConProveedores(<KardexMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.click(screen.getByTestId('sel-tela'));
    // Hay renglones…
    expect(screen.getByTestId('kardex-tela-tabla')).toBeInTheDocument();
    // …y aun así el aviso está, con su puerta a la pantalla vigente.
    const nota = screen.getByTestId('kardex-tela-nota-legado');
    expect(nota.querySelector('a')).toHaveAttribute('href', '/inventarios/telas/existencias');
  });

  it('el vacío ya no es mudo: dice de qué flujo habla y a dónde ir', () => {
    datosKardexTela.mockReturnValue(kardexTelaVacio);
    renderConProveedores(<KardexMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.ver']),
    });
    fireEvent.click(screen.getByTestId('sel-tela'));
    expect(screen.queryByTestId('kardex-tela-tabla')).not.toBeInTheDocument();
    const vacio = screen.getByTestId('kardex-tela-vacio');
    expect(vacio).toHaveTextContent(/LEGADO por lote/);
    expect(vacio.querySelector('a')).toHaveAttribute('href', '/inventarios/telas/existencias');
    // El texto mudo de antes ("Esta tela no tiene movimientos." a secas) no vuelve.
    expect(screen.queryByText('Esta tela no tiene movimientos.')).not.toBeInTheDocument();
  });

  // ── fila 0.173: el PERIODO (mecanismo de la 0.138, ahora también en materiales) ─────────────
  //
  // ⭐ Los dos kardex de esta pantalla pedían el histórico ENTERO: ni fechas ni tope. Ahora el
  // servidor recorta, y lo que se prueba aquí es lo que la PANTALLA tiene que hacer con eso:
  // mandar las fechas (no filtrar ella) y decir sin adornos qué pedazo está enseñando.
  describe('el periodo del kardex (fila 0.173)', () => {
    it('⭐ las fechas VIAJAN al servidor (la pantalla no recorta lo que ya llegó)', () => {
      renderConProveedores(<KardexMaterialesPagina />, {
        sesion: estadoSesionDePrueba(['inventario-telas.ver']),
      });
      fireEvent.click(screen.getByTestId('sel-tela'));
      // Sin fechas escritas no se mandan: el servidor pone su ventana por omisión.
      expect(consultaKardexTela).toHaveBeenLastCalledWith({ idTela: 1 });

      fireEvent.change(screen.getByTestId('kardex-tela-desde'), {
        target: { value: '2026-06-01' },
      });
      fireEvent.change(screen.getByTestId('kardex-tela-hasta'), {
        target: { value: '2026-06-30' },
      });
      expect(consultaKardexTela).toHaveBeenLastCalledWith({
        idTela: 1,
        desde: '2026-06-01',
        hasta: '2026-06-30',
      });
    });

    it('y en AVÍOS igual (las dos pestañas, no sólo la primera)', () => {
      renderConProveedores(<KardexMaterialesPagina />, {
        sesion: estadoSesionDePrueba(['inventario-avios.ver']),
      });
      fireEvent.click(screen.getByTestId('kardex-mat-dim-avio'));
      fireEvent.click(screen.getByTestId('sel-avio'));
      expect(consultaKardexAvio).toHaveBeenLastCalledWith({ idAvio: 3 });

      fireEvent.change(screen.getByTestId('kardex-avio-desde'), {
        target: { value: '2026-01-01' },
      });
      expect(consultaKardexAvio).toHaveBeenLastCalledWith({ idAvio: 3, desde: '2026-01-01' });
    });

    it('⭐ dice QUÉ periodo está viendo, y avisa cuando es el de por omisión', () => {
      renderConProveedores(<KardexMaterialesPagina />, {
        sesion: estadoSesionDePrueba(['inventario-telas.ver']),
      });
      fireEvent.click(screen.getByTestId('sel-tela'));
      const periodo = screen.getByTestId('kardex-tela-periodo');
      expect(periodo).toHaveTextContent('2025-09-05');
      expect(periodo).toHaveTextContent(/últimos 12 meses por omisión/);
      // Sin techo NO se dice «a hoy»: el servidor deja el techo abierto a propósito y el histórico
      // migrado trae fechas capturadas mal (hasta 2029) que sí salen.
      expect(periodo).not.toHaveTextContent(/hoy/);
    });

    it('⭐ si la lista vino CORTADA lo dice — nadie debe creer que está viendo todo', () => {
      datosKardexTela.mockReturnValue({ ...kardexTela, truncado: true, limite: 1000 });
      renderConProveedores(<KardexMaterialesPagina />, {
        sesion: estadoSesionDePrueba(['inventario-telas.ver']),
      });
      fireEvent.click(screen.getByTestId('sel-tela'));
      expect(screen.getByTestId('kardex-tela-truncado')).toHaveTextContent(/más\s+RECIENTES/);
    });

    it('sin corte, no hay aviso (el aviso tiene que significar algo)', () => {
      renderConProveedores(<KardexMaterialesPagina />, {
        sesion: estadoSesionDePrueba(['inventario-telas.ver']),
      });
      fireEvent.click(screen.getByTestId('sel-tela'));
      expect(screen.queryByTestId('kardex-tela-truncado')).not.toBeInTheDocument();
    });

    /**
     * ⭐⭐ EL SALDO ANTERIOR SE PINTA, o la columna «Saldo» miente. Con periodo, el primer renglón
     * visible NO arranca de cero: arranca de lo que el lote×almacén ya traía. Si esta fila no
     * estuviera, el usuario leería 100 donde el saldo real es 400 — y sin nada raro a la vista.
     */
    it('⭐⭐ pinta el SALDO ANTERIOR de donde arranca la columna Saldo', () => {
      datosKardexTela.mockReturnValue({
        ...kardexTela,
        saldosIniciales: [
          { idLote: 7, loteClave: 'LOTE-A', idAlmacen: 5, almacen: 'Bodega A', saldo: 300 },
        ],
      });
      renderConProveedores(<KardexMaterialesPagina />, {
        sesion: estadoSesionDePrueba(['inventario-telas.ver']),
      });
      fireEvent.click(screen.getByTestId('sel-tela'));
      // ⚠️ Las DOS superficies, no «la primera que aparezca»: la pantalla pinta tarjetas en móvil y
      // tabla en escritorio, y con un `getAllByTestId(...)[0]` borrar una de las dos seguía en
      // verde porque la otra la tapaba.
      const enTabla = within(screen.getByTestId('kardex-tela-tabla')).getByTestId(
        'kardex-tela-saldo-inicial',
      );
      expect(enTabla).toHaveTextContent('300');
      expect(enTabla).toHaveTextContent('LOTE-A');
      const enTarjetas = within(screen.getByTestId('kardex-tela-tarjetas')).getByTestId(
        'kardex-tela-saldo-inicial',
      );
      expect(enTarjetas).toHaveTextContent('300');
      expect(enTarjetas).toHaveTextContent('LOTE-A');
    });

    /**
     * 🔴 EL VACÍO DEL KARDEX LEGADO TIENE QUE DECIR QUE ES DEL PERIODO. Esta pestaña es un archivo
     * CONGELADO (sólo histórico migrado, fila 0.170): con una ventana por omisión de 12 meses, su
     * vacío más probable es «no hay nada en estos doce meses», no «esta tela no tiene nada». Decir
     * lo segundo mandaría a buscar a otra pantalla que tampoco lo tiene.
     */
    /**
     * 🔴 LA PESTAÑA DE AVÍOS ES UNA COPIA A MANO, Y HASTA AQUÍ ESTABA SIN GUARDAR.
     *
     * El JSX de avíos no es el de telas: tiene **otro número de columnas** (7+1 contra 8+1) y sus
     * `data-testid` se escribieron uno por uno. De ella sólo se medía que las fechas viajaran ⇒
     * borrar su línea del periodo, su aviso de corte o su fila de «Saldo anterior» dejaba las 13
     * pruebas del archivo **en verde**, y ningún otro archivo del repo —unit o e2e— nombra
     * `kardex-avio-periodo`, `-truncado`, `-saldo-inicial` ni `-vacio`. En una fila cuyo producto
     * es justamente que la pantalla no mienta, eso salía a `prueba` sin que nadie lo notara.
     *
     * Estas cuatro aserciones son las mismas que las de telas, calcadas sobre la otra pestaña.
     */
    describe('la pestaña de AVÍOS se mide igual que la de telas (no es un adorno copiado)', () => {
      it('⭐ dice QUÉ periodo está viendo, y avisa cuando es el de por omisión', () => {
        renderConProveedores(<KardexMaterialesPagina />, {
          sesion: estadoSesionDePrueba(['inventario-avios.ver']),
        });
        abrirAvios();
        const periodo = screen.getByTestId('kardex-avio-periodo');
        expect(periodo).toHaveTextContent('2025-09-05');
        expect(periodo).toHaveTextContent(/últimos 12 meses por omisión/);
        // Sin techo NO se dice «a hoy»: el servidor lo deja abierto a propósito.
        expect(periodo).not.toHaveTextContent(/hoy/);
      });

      it('⭐ si la lista vino CORTADA lo dice, y sin corte no hay aviso', () => {
        datosKardexAvio.mockReturnValue({ ...kardexAvio, truncado: true, limite: 1000 });
        const { unmount } = renderConProveedores(<KardexMaterialesPagina />, {
          sesion: estadoSesionDePrueba(['inventario-avios.ver']),
        });
        abrirAvios();
        expect(screen.getByTestId('kardex-avio-truncado')).toHaveTextContent(/más\s+RECIENTES/);
        unmount();

        // El aviso tiene que significar algo: sin corte, no está.
        datosKardexAvio.mockReturnValue(kardexAvio);
        renderConProveedores(<KardexMaterialesPagina />, {
          sesion: estadoSesionDePrueba(['inventario-avios.ver']),
        });
        abrirAvios();
        expect(screen.queryByTestId('kardex-avio-truncado')).not.toBeInTheDocument();
      });

      it('⭐⭐ pinta el SALDO ANTERIOR por almacén, de donde arranca la columna Saldo', () => {
        datosKardexAvio.mockReturnValue({
          ...kardexAvio,
          saldosIniciales: [{ idAlmacen: 9, almacen: 'Avíos A', saldo: 250 }],
        });
        renderConProveedores(<KardexMaterialesPagina />, {
          sesion: estadoSesionDePrueba(['inventario-avios.ver']),
        });
        abrirAvios();
        // Las DOS superficies (tarjetas en móvil, tabla en escritorio): con `getAllByTestId(...)[0]`
        // borrar una de las dos se quedaba en verde porque la otra la tapaba.
        const enTabla = within(screen.getByTestId('kardex-avio-tabla')).getByTestId(
          'kardex-avio-saldo-inicial',
        );
        expect(enTabla).toHaveTextContent('Avíos A');
        expect(enTabla).toHaveTextContent('250');
        const enTarjetas = within(screen.getByTestId('kardex-avio-tarjetas')).getByTestId(
          'kardex-avio-saldo-inicial',
        );
        expect(enTarjetas).toHaveTextContent('Avíos A');
        expect(enTarjetas).toHaveTextContent('250');
      });

      it('🔴 y su vacío también dice que es DEL PERIODO (no «este avío no tiene nada»)', () => {
        datosKardexAvio.mockReturnValue(kardexAvioVacio);
        renderConProveedores(<KardexMaterialesPagina />, {
          sesion: estadoSesionDePrueba(['inventario-avios.ver']),
        });
        abrirAvios();
        expect(screen.queryByTestId('kardex-avio-tabla')).not.toBeInTheDocument();
        const vacio = screen.getByTestId('kardex-avio-vacio');
        expect(vacio).toHaveTextContent(/en el periodo/);
        expect(vacio).toHaveTextContent(/amplía las fechas/);
      });
    });

    it('🔴 el vacío del legado dice que es DEL PERIODO y que hay más atrás', () => {
      datosKardexTela.mockReturnValue(kardexTelaVacio);
      renderConProveedores(<KardexMaterialesPagina />, {
        sesion: estadoSesionDePrueba(['inventario-telas.ver']),
      });
      fireEvent.click(screen.getByTestId('sel-tela'));
      const vacio = screen.getByTestId('kardex-tela-vacio');
      expect(vacio).toHaveTextContent(/en el periodo/);
      expect(vacio).toHaveTextContent(/amplía las fechas/);
    });
  });

  /**
   * ⭐⭐ FILA 0.176 — EL MOTIVO SE PUEDE LEER, EN LAS CUATRO SUPERFICIES.
   *
   * La 0.172 volvió OBLIGATORIO escribir un motivo al mover material (el traspaso de avíos que
   * opera esta misma dimensión, entre otros) y lo guarda en las `observaciones` del movimiento…
   * que no salía en NINGUNA pantalla. Pedir una explicación obligatoria que después nadie consulta
   * es la forma más rápida de que se degrade a «.», «x» o «traspaso» — y entonces el campo
   * obligatorio deja de servir para lo que se puso.
   *
   * ⚠️ Esta pantalla pinta CUATRO superficies (tarjetas en móvil + tabla en escritorio, por cada
   * una de las dos pestañas) y las dos de una pestaña están montadas A LA VEZ: la visibilidad la
   * decide Tailwind, no el DOM. Por eso cada aserción va anclada con `within(<esa superficie>)`
   * — un `getAllByTestId(...)[0]` dejaba en verde borrar una de las dos porque la otra tapaba el
   * hueco (la misma cicatriz que ya cobró el «Saldo anterior» de arriba).
   */
  describe('el motivo del movimiento se LEE (fila 0.176)', () => {
    it('⭐⭐ TELAS: el motivo sale en la tabla Y en las tarjetas', () => {
      datosKardexTela.mockReturnValue({
        ...kardexTela,
        renglones: kardexTela.renglones.map((r) => ({
          ...r,
          observaciones: 'Se lo llevó el cortador Ríos',
        })),
      });
      renderConProveedores(<KardexMaterialesPagina />, {
        sesion: estadoSesionDePrueba(['inventario-telas.ver']),
      });
      fireEvent.click(screen.getByTestId('sel-tela'));

      const enTabla = within(screen.getByTestId('kardex-tela-tabla')).getByTestId(
        'kardex-tela-obs',
      );
      expect(enTabla).toHaveTextContent('Se lo llevó el cortador Ríos');
      const enTarjetas = within(screen.getByTestId('kardex-tela-tarjetas')).getByTestId(
        'kardex-tela-obs',
      );
      expect(enTarjetas).toHaveTextContent('Se lo llevó el cortador Ríos');
    });

    it('⭐⭐ AVÍOS: el motivo sale en la tabla Y en las tarjetas', () => {
      datosKardexAvio.mockReturnValue({
        ...kardexAvio,
        renglones: kardexAvio.renglones.map((r) => ({
          ...r,
          observaciones: 'Se mandaron al taller para la OP 4471',
        })),
      });
      renderConProveedores(<KardexMaterialesPagina />, {
        sesion: estadoSesionDePrueba(['inventario-avios.ver']),
      });
      abrirAvios();

      const enTabla = within(screen.getByTestId('kardex-avio-tabla')).getByTestId(
        'kardex-avio-obs',
      );
      expect(enTabla).toHaveTextContent('Se mandaron al taller para la OP 4471');
      const enTarjetas = within(screen.getByTestId('kardex-avio-tarjetas')).getByTestId(
        'kardex-avio-obs',
      );
      expect(enTarjetas).toHaveTextContent('Se mandaron al taller para la OP 4471');
    });

    /**
     * Sin motivo, la COLUMNA sigue estando (con su «—»): el histórico migrado de Access no trae
     * observaciones y la tabla no puede descuadrarse por eso. En las TARJETAS, en cambio, la línea
     * NO se pinta — una línea vacía en una tarjeta es ruido, no información.
     */
    it('sin motivo la columna dice «—», y la tarjeta no pinta una línea vacía', () => {
      // El renglón de avíos de la base ya trae `observaciones: null`.
      renderConProveedores(<KardexMaterialesPagina />, {
        sesion: estadoSesionDePrueba(['inventario-avios.ver']),
      });
      abrirAvios();
      expect(
        within(screen.getByTestId('kardex-avio-tabla')).getByTestId('kardex-avio-obs'),
      ).toHaveTextContent('—');
      expect(
        within(screen.getByTestId('kardex-avio-tarjetas')).queryByTestId('kardex-avio-obs'),
      ).not.toBeInTheDocument();
    });
  });
});
