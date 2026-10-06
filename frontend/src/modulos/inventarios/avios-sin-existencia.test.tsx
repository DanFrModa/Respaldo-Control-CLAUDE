import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClavePermiso } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { AjusteMaterialesPagina } from './AjusteMaterialesPagina';
import { SalidaSinOrdenPagina } from './SalidaSinOrdenPagina';
import { TraspasoMaterialesPagina } from './TraspasoMaterialesPagina';

/**
 * ⭐⭐ FILA 0.233 — LAS OTRAS TRES PANTALLAS QUE SACAN AVÍOS YA NO DEJAN ELEGIR LO QUE NO HAY.
 *
 * Es el punto 07c del repaso de DANIEL (§Post-F9.243), que la fila 0.216 arregló en la nota de
 * salida: *«como me jala avíos que no hay stock, no me deja… estaría bien que no deje meter los
 * avíos que no hay stock, ANTES de meterlos»*. **Salida sin orden**, **Ajuste** y **Traspaso** de
 * avíos comparten `CapturaRenglonesAvio`, que no mencionaba stock en ninguna línea.
 *
 * Aquí la captura y el hook de stock son LOS DE VERDAD (no se simulan): sólo se simula la capa de
 * datos. Así cada prueba mide la pantalla entera — qué almacén mira, en qué dirección, y qué hace
 * la captura con ello.
 *
 * ⚠️ La guarda del servidor sigue intacta (A1): esto sólo evita llegar hasta ella.
 */

// ── Toasts: el rechazo se DICE; sin capturarlos no se distingue «lo rechazó» de «se calló». ──
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: (mensaje: string): void => {
      toastError(mensaje);
    },
  },
}));

// ── Catálogo de avíos: el servidor busca en TODO el catálogo y no sabe de existencias. ──
vi.mock('@/api/avios', () => ({
  useAvios: () => ({
    data: {
      datos: [
        { id: 3, clave: 'BOT-01', descripcion: 'Botón', esGenerico: false },
        { id: 4, clave: 'CIE-02', descripcion: 'Cierre', esGenerico: false },
      ],
    },
    isPending: false,
    isError: false,
    error: null,
  }),
}));

// ── Dos almacenes de AVIO (el traspaso necesita origen ≠ destino). ──
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({
    data: {
      datos: [
        { id: 7, nombre: 'Almacén de avíos', tipo: 'AVIO' },
        { id: 9, nombre: 'Bodega de avíos', tipo: 'AVIO' },
      ],
    },
  }),
}));

vi.mock('@/api/inventarios', () => ({
  useTiposMovimiento: () => ({
    data: {
      datos: [
        { id: 14, codigo: 'ajuste-entrada', nombre: 'Ajuste (Entrada)', activo: true },
        { id: 15, codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', activo: true },
      ],
    },
  }),
}));

/**
 * Existencias por almacén, CRUZADAS a propósito para medir el traspaso: BOT-01 sólo hay en el 7 y
 * CIE-02 sólo en el 9. Si el traspaso mirara el DESTINO en vez del ORIGEN, las dos pruebas de
 * traspaso se invierten.
 *
 * ⚠️ Objetos CONSTANTES: el hook memoriza el mapa sobre `data`, y uno nuevo por render lo haría
 * recalcular en cada uno.
 */
const EXISTENCIAS_DEL_7 = {
  data: { filas: [{ idAvio: 3, idAlmacen: 7, existencia: 500, unidad: 'pza' }] },
  isError: false,
  isPlaceholderData: false,
};
const EXISTENCIAS_DEL_9 = {
  data: { filas: [{ idAvio: 4, idAlmacen: 9, existencia: 80, unidad: 'pza' }] },
  isError: false,
  isPlaceholderData: false,
};
const SIN_RESPUESTA = { data: undefined, isError: false, isPlaceholderData: false };
const EN_ERROR = { data: { filas: [] }, isError: true, isPlaceholderData: false };

/** Cómo contesta la consulta de existencias: normal, todavía en vuelo, o con error. */
let modoExistencias: 'normal' | 'en-vuelo' | 'error' = 'normal';
const consultasExistencias = vi.fn();

vi.mock('@/api/inventario-materiales', () => ({
  useExistenciasAvio: (query: { idAlmacen?: number }, opciones?: { habilitado?: boolean }) => {
    consultasExistencias(query, opciones);
    if (opciones?.habilitado === false) return SIN_RESPUESTA;
    if (modoExistencias === 'en-vuelo') return SIN_RESPUESTA;
    if (modoExistencias === 'error') return EN_ERROR;
    return query.idAlmacen === 9 ? EXISTENCIAS_DEL_9 : EXISTENCIAS_DEL_7;
  },
  useAjustarAvio: () => ({ mutate: vi.fn(), isPending: false }),
  useTraspasarAvio: () => ({ mutate: vi.fn(), isPending: false }),
  useSalidaAvioSinOrden: () => ({ mutate: vi.fn(), isPending: false }),
  useSalidaTelaColorSinOrden: () => ({ mutate: vi.fn(), isPending: false }),
}));

// La salida sin orden ARRANCA en la pestaña de telas; su captura no es de esta fila y se simula.
vi.mock('./CapturaRenglonesTelaColor', () => ({
  CapturaRenglonesTelaColor: () => <div data-testid="captura-renglones-tela-color" />,
}));

// ── Ayudas ────────────────────────────────────────────────────────────────────────────────────

/** Elige un avío en el combobox de la captura (enfocar abre la lista; se clickea SU opción). */
function elegirAvio(clave: string): void {
  fireEvent.focus(screen.getByTestId('captura-avio-busqueda'));
  const opciones = screen.getAllByTestId('captura-avio-opcion');
  const elegida = opciones.find((o) => (o.textContent ?? '').includes(clave));
  if (elegida === undefined) {
    throw new Error(`El combobox no ofreció "${clave}"`);
  }
  fireEvent.mouseDown(elegida);
}

/** Teclea la cantidad del avío elegido y lo agrega como renglón. */
function agregar(cantidad: string): void {
  fireEvent.change(screen.getByTestId('captura-avio-cantidad'), { target: { value: cantidad } });
  fireEvent.click(screen.getByTestId('captura-avio-agregar'));
}

/** El avío quedó RECHAZADO: lo dijo por su clave, no quedó elegido y el campo quedó vacío. */
function esperarRechazo(clave: string): void {
  expect(toastError).toHaveBeenCalledTimes(1);
  expect(toastError.mock.calls[0]?.[0]).toContain(clave);
  expect(toastError.mock.calls[0]?.[0]).toContain('no tiene existencia');
  // ⭐ El campo queda VACÍO: el combobox se REMONTA tras el rechazo (su `key`). Sin eso se quedaba
  // enseñando el avío que no entró y la pantalla mentía.
  expect(screen.getByTestId('captura-avio-busqueda')).toHaveValue('');
  // Y no hay avío elegido: ni campo de cantidad, ni botón de agregar encendido.
  expect(screen.queryByTestId('captura-avio-cantidad')).not.toBeInTheDocument();
  expect(screen.getByTestId('captura-avio-agregar')).toBeDisabled();
}

/** El avío ENTRÓ: sin toast de error y con el campo de cantidad a la vista. */
function esperarAceptado(clave: string): void {
  expect(toastError).not.toHaveBeenCalled();
  expect(screen.getByTestId('captura-avio-cantidad')).toBeInTheDocument();
  fireEvent.blur(screen.getByTestId('captura-avio-busqueda'));
  expect(screen.getByTestId('captura-avio-busqueda')).toHaveValue(clave);
}

const PERMISOS_SALIDA: ClavePermiso[] = ['salida-material.registrar', 'inventario-avios.ver'];
const PERMISOS_MOVER: ClavePermiso[] = ['inventario-avios.mover', 'inventario-avios.ver'];

beforeEach(() => {
  toastError.mockReset();
  consultasExistencias.mockReset();
  modoExistencias = 'normal';
});

// ── SALIDA SIN ORDEN ─────────────────────────────────────────────────────────────────────────

describe('Salida sin orden · avíos sin existencia (fila 0.233)', () => {
  function abrir(permisos: ClavePermiso[] = PERMISOS_SALIDA): void {
    renderConProveedores(<SalidaSinOrdenPagina />, { sesion: estadoSesionDePrueba(permisos) });
    fireEvent.click(screen.getByTestId('salida-sin-orden-dim-avio'));
  }

  function elegirAlmacen(id: string): void {
    fireEvent.change(screen.getByTestId('salida-sin-orden-almacen'), { target: { value: id } });
  }

  /**
   * 🔴 EL GUARDIÁN DE LA PUERTA. El combobox SÍ ofrece 'CIE-02' (el servidor no sabe de
   * existencias); la única defensa es no dejarlo quedar elegido.
   */
  it('⭐ elegir a mano un avío SIN existencia NO lo deja elegido, y dice por qué', () => {
    abrir();
    elegirAlmacen('7');
    elegirAvio('CIE-02');
    esperarRechazo('CIE-02');
  });

  it('y el que SÍ hay entra normal, con su existencia a la vista (gemela positiva)', () => {
    abrir();
    elegirAlmacen('7');
    elegirAvio('BOT-01');
    esperarAceptado('BOT-01');
    expect(screen.getByTestId('captura-avio-existencia')).toHaveTextContent('Hay 500 pza');

    agregar('40');
    expect(screen.getByTestId('captura-avio-existencia-3')).toHaveTextContent('Hay 500 pza');
  });

  it('pedir más de lo que hay se pinta «Excede · hay N» (avisa; el servidor decide)', () => {
    abrir();
    elegirAlmacen('7');
    elegirAvio('BOT-01');
    agregar('600');
    expect(screen.getByTestId('captura-avio-existencia-3')).toHaveTextContent(
      'Excede · hay 500 pza',
    );
  });

  /**
   * ⭐ EL CERO SE PINTA. Un renglón capturado cuando todavía no se sabía (sin almacén) y luego el
   * almacén elegido: CIE-02 no tiene renglón en el 7 ⇒ nunca entró ahí ⇒ CERO, y se dice — antes
   * la celda no existía y la captura parecía correcta.
   */
  it('⭐ el renglón de un avío que no hay se pinta «Sin existencia», no en blanco', () => {
    abrir();
    elegirAvio('CIE-02');
    agregar('10');
    // Sin almacén no se sabe nada: no hay columna de existencia.
    expect(screen.queryByTestId('captura-avio-existencia-4')).not.toBeInTheDocument();

    elegirAlmacen('7');
    expect(screen.getByTestId('captura-avio-existencia-4')).toHaveTextContent('Sin existencia');
  });

  /**
   * 🔑 «Agregar» VUELVE A MIRAR. El avío se eligió cuando no se sabía qué había (sin almacén) y
   * luego se escogió un almacén donde no hay: sin esta segunda puerta, entraba igual.
   */
  it('«Agregar» rechaza un avío elegido antes de saber que en ese almacén no hay', () => {
    abrir();
    elegirAvio('CIE-02');
    esperarAceptado('CIE-02');
    elegirAlmacen('7');
    agregar('10');

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]).toContain('CIE-02');
    expect(screen.queryByTestId('captura-avio-tabla')).not.toBeInTheDocument();
  });

  /**
   * ⭐ «NO SE SABE» DEJA PASAR. Sin almacén no hay a qué preguntarle: bloquear sería inventar un
   * cero y dejaría la captura entera muerta. Decide el servidor al guardar (A1).
   */
  it('⭐ sin almacén NO se bloquea la captura (no se sabe qué hay)', () => {
    abrir();
    elegirAvio('CIE-02');
    esperarAceptado('CIE-02');
    expect(screen.queryByTestId('captura-avio-existencia')).not.toBeInTheDocument();
  });

  it('con la consulta EN VUELO tampoco se bloquea (todavía no se sabe)', () => {
    modoExistencias = 'en-vuelo';
    abrir();
    elegirAlmacen('7');
    elegirAvio('CIE-02');
    esperarAceptado('CIE-02');
  });

  it('⚠️ con las existencias EN ERROR tampoco (un fallo no es un cero)', () => {
    modoExistencias = 'error';
    abrir();
    elegirAlmacen('7');
    elegirAvio('CIE-02');
    esperarAceptado('CIE-02');
  });

  /**
   * Quien no puede LEER existencias no las pregunta (la consulta le daría 403): para esa sesión no
   * se sabe, y decide el servidor. Hoy la llave de esta salida la llevan los tres perfiles de
   * acceso total del seed (`PERFILES_ACCESO_TOTAL`: Administrador, AdministracionDireccion y Director
   * General), que también leen existencias; esto fija que la pantalla no truene si mañana la lleva un
   * rol sin `.ver`.
   */
  it('sin `inventario-avios.ver` no pregunta existencias y no bloquea', () => {
    abrir(['salida-material.registrar']);
    elegirAlmacen('7');
    elegirAvio('CIE-02');
    esperarAceptado('CIE-02');
    expect(consultasExistencias).not.toHaveBeenCalledWith(
      expect.objectContaining({ idAlmacen: 7 }),
      expect.anything(),
    );
  });

  it('en la pestaña de TELAS no se pregunta la existencia de avíos', () => {
    renderConProveedores(<SalidaSinOrdenPagina />, {
      sesion: estadoSesionDePrueba(PERMISOS_SALIDA),
    });
    fireEvent.change(screen.getByTestId('salida-sin-orden-almacen'), { target: { value: '7' } });
    expect(consultasExistencias).not.toHaveBeenCalledWith(
      expect.objectContaining({ idAlmacen: 7 }),
      expect.anything(),
    );
  });
});

// ── AJUSTE DE AVÍOS ──────────────────────────────────────────────────────────────────────────

describe('Ajuste de avíos · avíos sin existencia (fila 0.233)', () => {
  function abrir(): void {
    renderConProveedores(<AjusteMaterialesPagina />, {
      sesion: estadoSesionDePrueba(PERMISOS_MOVER),
    });
    fireEvent.change(screen.getByTestId('ajuste-almacen'), { target: { value: '7' } });
  }

  /**
   * 🔴 EL AJUSTE DE ENTRADA NO SE BLOQUEA. Sube la existencia: es justo como entra al almacén un
   * avío que no estaba (conteo físico). Si la pantalla mirara el stock también aquí, el conteo
   * inicial de un avío nuevo sería imposible.
   */
  it('⭐ un ajuste de ENTRADA deja elegir un avío que no hay (es como entra)', () => {
    abrir();
    elegirAvio('CIE-02');
    esperarAceptado('CIE-02');
    agregar('25');
    expect(screen.getByTestId('captura-avio-tabla')).toHaveTextContent('CIE-02');
    // Y no se pinta existencia: en una entrada no limita nada.
    expect(screen.queryByTestId('captura-avio-existencia-4')).not.toBeInTheDocument();
  });

  it('⭐ un ajuste de SALIDA NO deja elegir un avío que no hay', () => {
    abrir();
    fireEvent.click(screen.getByTestId('ajuste-dir-salida'));
    elegirAvio('CIE-02');
    esperarRechazo('CIE-02');
  });

  it('y en SALIDA el que sí hay entra, con su existencia', () => {
    abrir();
    fireEvent.click(screen.getByTestId('ajuste-dir-salida'));
    elegirAvio('BOT-01');
    esperarAceptado('BOT-01');
    expect(screen.getByTestId('captura-avio-existencia')).toHaveTextContent('Hay 500 pza');
  });

  /**
   * ⭐ El renglón capturado como ENTRADA y luego pasado a SALIDA se pinta «Sin existencia»: ahora
   * sí saca, y de ese avío no hay nada.
   */
  it('⭐ al pasar de ENTRADA a SALIDA, el renglón de un avío que no hay se pinta en cero', () => {
    abrir();
    elegirAvio('CIE-02');
    agregar('25');
    fireEvent.click(screen.getByTestId('ajuste-dir-salida'));
    expect(screen.getByTestId('captura-avio-existencia-4')).toHaveTextContent('Sin existencia');
  });

  /**
   * Gemela de la de Salida sin orden: quien mueve avíos pero no puede LEER existencias no las
   * pregunta (le daría 403). Para esa sesión no se sabe, y decide el servidor.
   */
  it('en SALIDA sin `inventario-avios.ver` no pregunta existencias y no bloquea', () => {
    renderConProveedores(<AjusteMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.mover']),
    });
    fireEvent.change(screen.getByTestId('ajuste-almacen'), { target: { value: '7' } });
    fireEvent.click(screen.getByTestId('ajuste-dir-salida'));
    elegirAvio('CIE-02');
    esperarAceptado('CIE-02');
    expect(consultasExistencias).not.toHaveBeenCalledWith(
      expect.objectContaining({ idAlmacen: 7 }),
      expect.anything(),
    );
  });

  it('en SALIDA con la consulta en vuelo NO se bloquea (no se sabe)', () => {
    modoExistencias = 'en-vuelo';
    abrir();
    fireEvent.click(screen.getByTestId('ajuste-dir-salida'));
    elegirAvio('CIE-02');
    esperarAceptado('CIE-02');
  });
});

// ── TRASPASO DE AVÍOS ────────────────────────────────────────────────────────────────────────

describe('Traspaso de avíos · avíos sin existencia en el ORIGEN (fila 0.233)', () => {
  function abrir(origen: string, destino: string): void {
    renderConProveedores(<TraspasoMaterialesPagina />, {
      sesion: estadoSesionDePrueba(PERMISOS_MOVER),
    });
    fireEvent.change(screen.getByTestId('traspaso-origen'), { target: { value: origen } });
    fireEvent.change(screen.getByTestId('traspaso-destino'), { target: { value: destino } });
  }

  /**
   * 🔴 LA EXISTENCIA QUE IMPORTA ES LA DEL ORIGEN. CIE-02 hay en el 9 (el destino) pero no en el 7
   * (el origen): se rechaza. Si la pantalla mirara el destino, entraría.
   */
  it('⭐ del 7 al 9: CIE-02 (que sólo hay en el DESTINO) se rechaza', () => {
    abrir('7', '9');
    elegirAvio('CIE-02');
    esperarRechazo('CIE-02');
  });

  it('del 7 al 9: BOT-01 (que hay en el origen) entra con SU existencia', () => {
    abrir('7', '9');
    elegirAvio('BOT-01');
    esperarAceptado('BOT-01');
    expect(screen.getByTestId('captura-avio-existencia')).toHaveTextContent('Hay 500 pza');
  });

  it('y al revés, del 9 al 7: BOT-01 se rechaza y CIE-02 entra', () => {
    abrir('9', '7');
    elegirAvio('BOT-01');
    esperarRechazo('BOT-01');
    toastError.mockReset();
    elegirAvio('CIE-02');
    esperarAceptado('CIE-02');
    expect(screen.getByTestId('captura-avio-existencia')).toHaveTextContent('Hay 80 pza');
  });

  it('sin ORIGEN elegido no se sabe nada y no se bloquea', () => {
    renderConProveedores(<TraspasoMaterialesPagina />, {
      sesion: estadoSesionDePrueba(PERMISOS_MOVER),
    });
    fireEvent.change(screen.getByTestId('traspaso-destino'), { target: { value: '9' } });
    elegirAvio('BOT-01');
    esperarAceptado('BOT-01');
    expect(screen.queryByTestId('captura-avio-existencia')).not.toBeInTheDocument();
  });

  /** Gemela de la de Salida sin orden: sin `.ver` no se preguntan existencias del origen. */
  it('sin `inventario-avios.ver` no pregunta existencias del origen y no bloquea', () => {
    renderConProveedores(<TraspasoMaterialesPagina />, {
      sesion: estadoSesionDePrueba(['inventario-avios.mover']),
    });
    fireEvent.change(screen.getByTestId('traspaso-origen'), { target: { value: '7' } });
    fireEvent.change(screen.getByTestId('traspaso-destino'), { target: { value: '9' } });
    elegirAvio('CIE-02');
    esperarAceptado('CIE-02');
    expect(consultasExistencias).not.toHaveBeenCalledWith(
      expect.objectContaining({ idAlmacen: 7 }),
      expect.anything(),
    );
  });

  it('⚠️ con las existencias EN ERROR no se bloquea (un fallo no es un cero)', () => {
    modoExistencias = 'error';
    abrir('7', '9');
    elegirAvio('CIE-02');
    esperarAceptado('CIE-02');
  });
});
