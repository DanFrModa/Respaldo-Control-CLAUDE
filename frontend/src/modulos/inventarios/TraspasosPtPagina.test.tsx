import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiInventarios from '@/api/inventarios';
import type { Modelo } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { hoy } from './fecha-captura-pt';
import { TOPE_EXISTENCIAS_PT } from './tope-existencias';
import { TraspasosPtPagina } from './TraspasosPtPagina';

const crearMutate = vi.fn();
// §Post-F9.40 — las existencias del ORIGEN alimentan el selector de orden; configurable por test.
// Reenvía los ARGUMENTOS (fila 0.143): la prueba del techo mide con qué `limite` se pide, y un
// mock que los tira dejaba esa garantía sin forma de comprobarse.
const useExistenciasPtMock =
  vi.fn<(query?: Record<string, unknown>, habilitado?: boolean) => Record<string, unknown>>();
vi.mock('@/api/inventarios', async (importarOriginal) => {
  // Solo se sustituyen los hooks (los que tocan la red). `urlImpresoTraspasoPt` se toma DEL MÓDULO
  // REAL: re-escribir aquí su literal haría que esta prueba afirmara su propio texto y no el del
  // código — con una copia, apuntar el helper a la ruta de TELA dejaba este archivo en VERDE. La
  // ruta en sí la fija `src/api/inventarios.impreso-traspaso.test.ts` contra el contrato.
  const real = await importarOriginal<typeof ApiInventarios>();
  return {
    useCrearTraspasoPt: () => ({ mutate: crearMutate, isPending: false }),
    useExistenciasPt: (query: Record<string, unknown>, habilitado?: boolean) =>
      useExistenciasPtMock(query, habilitado),
    urlImpresoTraspasoPt: real.urlImpresoTraspasoPt,
  };
});

/** Sin existencias (el caso base de los tests viejos). */
const EXISTENCIAS_VACIAS = {
  data: { filas: [], totalExistencia: 0 },
  refetch: vi.fn(),
  isPending: false,
  isError: false,
};

/** En el origen (almacén 3): 15 pzas de la orden 55 (folio 9001) y 4 «sin orden». */
const EXISTENCIAS_CON_ORDEN = {
  data: {
    filas: [
      { idColor: 7, idTalla: 11, idAlmacen: 3, idOrden: 55, folioOrden: 9001, existencia: 15 },
      { idColor: 7, idTalla: 11, idAlmacen: 3, idOrden: null, folioOrden: null, existencia: 4 },
    ],
    totalExistencia: 19,
  },
  refetch: vi.fn(),
  isPending: false,
  isError: false,
};

vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({
    data: {
      datos: [
        { id: 3, nombre: 'Primeras' },
        { id: 4, nombre: 'Segundas' },
      ],
    },
  }),
}));
vi.mock('@/api/colores', () => ({
  useColores: () => ({ data: { datos: [{ id: 7, nombre: 'Rojo' }] } }),
}));
vi.mock('@/api/tallas', () => ({
  useTallas: () => ({ data: { datos: [{ id: 11, etiqueta: 'CH', orden: 1 }] } }),
}));

const modelo: Modelo = {
  id: 1,
  codigo: 'A-100',
  descripcion: 'Playera',
  activo: true,
} as unknown as Modelo;

vi.mock('@/api/modelos', () => ({
  useModelos: () => ({
    data: { datos: [modelo], total: 1, pagina: 1, porPagina: 8, totalPaginas: 1 },
    isPending: false,
    isError: false,
  }),
}));

const sesion = () => estadoSesionDePrueba(['inventario-pt.ver', 'inventario-pt.mover']);
/** La misma sesión CON la llave de fecha libre (ex acceso #28 del viejo, fila 0.171). */
const sesionConFechaLibre = () =>
  estadoSesionDePrueba(['inventario-pt.ver', 'inventario-pt.mover', 'ipt.fecha-libre']);

/** Fila 0.100 — el motivo es OBLIGATORIO: sin él el botón de guardar no se habilita. */
async function ponerMotivo(
  usuario: ReturnType<typeof userEvent.setup>,
  texto = 'Embarque del viernes',
): Promise<void> {
  await usuario.type(screen.getByTestId('traspaso-motivo'), texto);
}

async function elegirModelo(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  // El selector es un combobox POPOVER (R9): la lista abre al enfocar el input de búsqueda.
  await usuario.click(screen.getByTestId('selector-modelo-busqueda'));
  await usuario.click(screen.getByTestId('selector-modelo-opcion'));
}

describe('TraspasosPtPagina (F3-E3)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    useExistenciasPtMock.mockReset();
    useExistenciasPtMock.mockReturnValue(EXISTENCIAS_VACIAS);
  });

  it('avisa y NO permite guardar si origen = destino', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    await usuario.selectOptions(screen.getByTestId('traspaso-origen'), '3');
    await usuario.selectOptions(screen.getByTestId('traspaso-destino'), '3');
    expect(screen.getByText(/almacenes distintos/i)).toBeInTheDocument();
    expect(screen.getByTestId('traspaso-guardar')).toBeDisabled();
  });

  it('habilita guardar con origen≠destino y una captura, y envía al servicio', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    await usuario.selectOptions(screen.getByTestId('traspaso-origen'), '3');
    await usuario.selectOptions(screen.getByTestId('traspaso-destino'), '4');
    await usuario.selectOptions(screen.getByTestId('traspaso-matriz-agregar-color'), '7');
    await usuario.selectOptions(screen.getByTestId('traspaso-matriz-agregar-talla'), '11');
    const celda = screen.getByTestId('traspaso-matriz-celda');
    await usuario.clear(celda);
    await usuario.type(celda, '5');
    await ponerMotivo(usuario);

    const guardar = screen.getByTestId('traspaso-guardar');
    expect(guardar).toBeEnabled();
    await usuario.click(guardar);
    expect(crearMutate).toHaveBeenCalledTimes(1);
    const [cuerpo] = crearMutate.mock.calls[0] as [Record<string, unknown>];
    expect(cuerpo.idAlmacenOrigen).toBe(3);
    expect(cuerpo.idAlmacenDestino).toBe(4);
    expect(cuerpo.idModelo).toBe(1);
  });

  // ── §Post-F9.40: se traspasa el bucket de una ORDEN, no solo «sin orden» ────
  it('ofrece las órdenes con existencia en el ORIGEN y traspasa el bucket elegido', async () => {
    const usuario = userEvent.setup();
    useExistenciasPtMock.mockReturnValue(EXISTENCIAS_CON_ORDEN);
    renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    await usuario.selectOptions(screen.getByTestId('traspaso-origen'), '3');
    await usuario.selectOptions(screen.getByTestId('traspaso-destino'), '4');
    const opciones = [...screen.getByTestId('traspaso-orden').querySelectorAll('option')];
    expect(opciones.map((o) => o.value)).toEqual(['sin', '55']);

    await usuario.selectOptions(screen.getByTestId('traspaso-orden'), '55');
    await usuario.selectOptions(screen.getByTestId('traspaso-matriz-agregar-color'), '7');
    await usuario.selectOptions(screen.getByTestId('traspaso-matriz-agregar-talla'), '11');
    const celda = screen.getByTestId('traspaso-matriz-celda');
    await usuario.clear(celda);
    await usuario.type(celda, '5');
    await ponerMotivo(usuario);

    await usuario.click(screen.getByTestId('traspaso-guardar'));
    const [cuerpo] = crearMutate.mock.calls[0] as [{ lineas: { idOrden?: number }[] }];
    expect(cuerpo.lineas[0]?.idOrden).toBe(55);
  });

  it('el aviso de sobre-traspaso compara contra el bucket ELEGIDO, no contra el total del modelo', async () => {
    const usuario = userEvent.setup();
    useExistenciasPtMock.mockReturnValue(EXISTENCIAS_CON_ORDEN);
    renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
    await elegirModelo(usuario);

    await usuario.selectOptions(screen.getByTestId('traspaso-origen'), '3');
    await usuario.selectOptions(screen.getByTestId('traspaso-destino'), '4');
    await usuario.selectOptions(screen.getByTestId('traspaso-matriz-agregar-color'), '7');
    await usuario.selectOptions(screen.getByTestId('traspaso-matriz-agregar-talla'), '11');
    const celda = screen.getByTestId('traspaso-matriz-celda');
    await usuario.clear(celda);
    // 6 pzas: caben en la orden 55 (15) pero NO en el bucket «sin orden» (4), que es el default.
    await usuario.type(celda, '6');
    expect(screen.getByTestId('traspaso-aviso-excede')).toBeInTheDocument();

    await usuario.selectOptions(screen.getByTestId('traspaso-orden'), '55');
    expect(screen.queryByTestId('traspaso-aviso-excede')).not.toBeInTheDocument();
  });

  /**
   * ⭐ FILA 0.143 — ESTA PANTALLA TAMBIÉN SE ENTERA DE QUE LA LISTA VINO CORTADA.
   *
   * El desplegable de órdenes y el «disponible» se arman con las FILAS de existencias, y desde la
   * 0.143 esas filas vienen topadas. Si el tope alcanzara, faltaría un bucket del desplegable y el
   * operador leería «esa orden no tiene piezas» donde en realidad dice «no cupo». El servidor sigue
   * validando el saldo bajo bloqueo (D3), así que no se cuela un traspaso indebido — pero sí se
   * engañaría al que lo captura.
   */
  describe('el TOPE de existencias (fila 0.143)', () => {
    it('⭐ pide el TECHO del contrato, no el `limite` por omisión', async () => {
      // Aquí los renglones no se pintan: de ellos salen el desplegable de órdenes y el
      // «disponible». Con el default (1 000, pensado para todo el almacén) un modelo con muchas
      // órdenes×colores×tallas perdería buckets en silencio. Ver `tope-existencias.ts`.
      const usuario = userEvent.setup();
      useExistenciasPtMock.mockReturnValue(EXISTENCIAS_CON_ORDEN);
      renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('traspaso-origen'), '3');

      const consultas = useExistenciasPtMock.mock.calls.map(([q]) => q);
      expect(consultas.length).toBeGreaterThan(0);
      // TODAS las consultas, no «alguna»: una sola sin techo ya deja el desplegable corto.
      for (const q of consultas) expect(q?.limite).toBe(TOPE_EXISTENCIAS_PT);
    });

    it('⭐ avisa cuando la lista de existencias vino recortada', async () => {
      const usuario = userEvent.setup();
      useExistenciasPtMock.mockReturnValue({
        ...EXISTENCIAS_CON_ORDEN,
        data: { ...EXISTENCIAS_CON_ORDEN.data, truncado: true, totalFilas: 4321, limite: 1000 },
      });
      renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('traspaso-origen'), '3');

      const aviso = screen.getByTestId('traspaso-truncado');
      expect(aviso).toHaveTextContent('4,321');
      expect(aviso).toHaveTextContent(/lista de órdenes/);
    });

    it('y NO avisa cuando cupo todo (el aviso tiene que significar algo)', async () => {
      const usuario = userEvent.setup();
      useExistenciasPtMock.mockReturnValue({
        ...EXISTENCIAS_CON_ORDEN,
        data: { ...EXISTENCIAS_CON_ORDEN.data, truncado: false, totalFilas: 2, limite: 1000 },
      });
      renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('traspaso-origen'), '3');

      expect(screen.queryByTestId('traspaso-truncado')).not.toBeInTheDocument();
    });
  });

  // ── Fila 0.100: motivo obligatorio + hoja del traspaso (§Post-F9.193) ───────
  describe('Fila 0.100 · el traspaso deja rastro', () => {
    /** Deja la pantalla lista para guardar (modelo, almacenes y una celda capturada). */
    async function capturaCompleta(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
      await elegirModelo(usuario);
      await usuario.selectOptions(screen.getByTestId('traspaso-origen'), '3');
      await usuario.selectOptions(screen.getByTestId('traspaso-destino'), '4');
      await usuario.selectOptions(screen.getByTestId('traspaso-matriz-agregar-color'), '7');
      await usuario.selectOptions(screen.getByTestId('traspaso-matriz-agregar-talla'), '11');
      const celda = screen.getByTestId('traspaso-matriz-celda');
      await usuario.clear(celda);
      await usuario.type(celda, '5');
    }

    it('SIN motivo no deja guardar, aunque todo lo demás esté capturado', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
      await capturaCompleta(usuario);

      expect(screen.getByTestId('traspaso-guardar')).toBeDisabled();
      expect(crearMutate).not.toHaveBeenCalled();
    });

    it('un motivo DEMASIADO CORTO tampoco habilita (mismo mínimo que el servidor)', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
      await capturaCompleta(usuario);
      await ponerMotivo(usuario, 'ab');

      expect(screen.getByTestId('traspaso-guardar')).toBeDisabled();
    });

    it('⭐ con motivo habilita, lo MANDA recortado y al guardar el campo QUEDA VACÍO', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
      await capturaCompleta(usuario);
      await ponerMotivo(usuario, '  Embarque del viernes  ');

      await usuario.click(screen.getByTestId('traspaso-guardar'));
      const [cuerpo, opciones] = crearMutate.mock.calls[0] as [
        Record<string, unknown>,
        { onSuccess: (t: unknown) => void },
      ];
      expect(cuerpo.motivo).toBe('Embarque del viernes');
      // El campo viejo `observaciones` ya no existe en el cuerpo: el motivo lo sustituye.
      expect(cuerpo.observaciones).toBeUndefined();

      // ⭐ Y el campo se VACÍA al guardar. Si ese reset se perdiera, el motivo del traspaso
      // anterior quedaría pegado, seguiría siendo válido (≥3 caracteres) y se adjuntaría EN
      // SILENCIO al siguiente — y aquí además SALDRÍA IMPRESO en la hoja que acompaña las
      // prendas: una palabra equivocada en el rastro es peor que ninguna.
      act(() => {
        opciones.onSuccess({
          salida: { id: 200, folio: 9910 },
          entrada: { id: 201, folio: 9911 },
        });
      });
      expect(screen.getByTestId('traspaso-motivo')).toHaveValue('');
    });

    it('al guardar ofrece la HOJA del traspaso con el folio QUE YA EXISTE', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
      await capturaCompleta(usuario);
      await ponerMotivo(usuario);

      // Antes de guardar no hay hoja que ofrecer.
      expect(screen.queryByTestId('traspaso-pt-imprimir')).not.toBeInTheDocument();

      await usuario.click(screen.getByTestId('traspaso-guardar'));
      // El componente responde al `onSuccess` de la mutación: se dispara a mano con la respuesta.
      const [, opciones] = crearMutate.mock.calls[0] as [
        unknown,
        { onSuccess: (t: unknown) => void },
      ];
      act(() => {
        opciones.onSuccess({
          salida: { id: 200, folio: 9910 },
          entrada: { id: 201, folio: 9911 },
        });
      });

      expect(screen.getByTestId('traspaso-pt-guardado')).toHaveTextContent('9910');
      const boton = screen.getByTestId('traspaso-pt-imprimir');
      const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
      await usuario.click(boton);
      // El id de la pata de SALIDA es el que viaja: la hoja imprime el folio que ya existe.
      expect(abrir).toHaveBeenCalledWith(
        '/api/inventarios/pt/traspasos/200/impreso',
        '_blank',
        'noopener',
      );
      abrir.mockRestore();
    });
  });

  /**
   * ⏳ Fila 0.171 — el traspaso escribe DOS movimientos de kardex fechados por quien captura, así
   * que lleva el MISMO candado que el movimiento manual. La guarda está en el dominio; esto sólo
   * fija que la pantalla no ofrezca una fecha que el servidor va a rebotar.
   */
  describe('la fecha del traspaso (fila 0.171, ex acceso #28)', () => {
    it('SIN `ipt.fecha-libre` el selector se acota a la ventana', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<TraspasosPtPagina />, { sesion: sesion() });
      // El campo de fecha sólo se pinta con un modelo elegido (la captura arranca por ahí).
      await elegirModelo(usuario);
      const campo = screen.getByTestId('traspaso-fecha');
      // ⚠️ El `min` se calcula APARTE, no con la misma función que lo produce: si se afirmara con
      // `inicioVentanaCapturaPt()` la prueba diría «el helper es igual a sí mismo» y un error de
      // aritmética pasaría en verde. Aquí se mide lo que importa: son 7 días completos hacia atrás.
      // ⏳ Fila 0.174: se cuenta sobre el día DEL NEGOCIO (México), no sobre el día UTC. Contarlo
      // en UTC ataba esta prueba a la hora a la que corriera: de 18:00 a 23:59 de México el día
      // UTC va uno adelante y el `min` esperado salía corrido un día.
      const hoyDelNegocio = new Date().toLocaleDateString('en-CA', {
        timeZone: 'America/Mexico_City',
      });
      const sieteAtras = new Date(Date.parse(`${hoyDelNegocio}T00:00:00.000Z`) - 7 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(campo).toHaveAttribute('max', hoy());
      expect(campo).toHaveAttribute('min', sieteAtras);
    });

    it('CON `ipt.fecha-libre` no hay tope (gemela positiva)', async () => {
      const usuario = userEvent.setup();
      renderConProveedores(<TraspasosPtPagina />, { sesion: sesionConFechaLibre() });
      await elegirModelo(usuario);
      const campo = screen.getByTestId('traspaso-fecha');
      expect(campo).not.toHaveAttribute('min');
      expect(campo).not.toHaveAttribute('max');
    });
  });
});
