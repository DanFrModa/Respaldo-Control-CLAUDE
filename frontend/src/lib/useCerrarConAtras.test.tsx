import { render, waitFor } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCerrarConAtras } from './useCerrarConAtras';

/** Capa de prueba: solo ocupa su entrada del historial mientras `abierto`. */
function Capa({ abierto = true, alCerrar }: { abierto?: boolean; alCerrar: () => void }): null {
  useCerrarConAtras(abierto, alCerrar);
  return null;
}

/**
 * Nivel que el hook marcó en la entrada del historial donde está parado el navegador.
 * Es la variable OBSERVABLE de todas las pruebas: si el hook no hiciera nada, sería siempre 0.
 */
function nivel(): number {
  const estado: unknown = window.history.state;
  if (typeof estado !== 'object' || estado === null) {
    return 0;
  }
  const marca = (estado as Record<string, unknown>).__capaFlotante;
  return typeof marca === 'number' ? marca : 0;
}

/**
 * Espera el `popstate` de un retroceso (jsdom encola el recorrido, no es síncrono). Si NO llega,
 * RECHAZA: una prueba que espera un retroceso no puede darse por buena porque se acabó el tiempo.
 */
function esperarPop(): Promise<void> {
  return new Promise<void>((listo, falla) => {
    const tope = setTimeout(() => {
      window.removeEventListener('popstate', fin);
      falla(new Error('no llegó el `popstate` del retroceso'));
    }, 1000);
    function fin(): void {
      clearTimeout(tope);
      window.removeEventListener('popstate', fin);
      listo();
    }
    window.addEventListener('popstate', fin);
  });
}

/** Dispara un "atrás" real del navegador (jsdom sí implementa el historial mismo-documento). */
async function atras(): Promise<void> {
  const llego = esperarPop();
  window.history.back();
  await llego;
}

beforeEach(() => {
  // Piso de historial: jsdom arranca con UNA sola entrada y `back()` no haría nada. Se dejan
  // entradas SIN marca (como las de una navegación normal de React Router).
  window.history.pushState({ usr: null, key: 'piso-1', idx: 0 }, '');
  window.history.pushState({ usr: null, key: 'piso-2', idx: 1 }, '');
});

describe('useCerrarConAtras', () => {
  it('el "atrás" cierra la capa en vez de salirse de la pantalla', async () => {
    const cerrar = vi.fn();
    render(<Capa alCerrar={cerrar} />);

    // Se apiló el clon (misma URL, un nivel arriba).
    await waitFor(() => expect(nivel()).toBe(1));

    await atras();
    expect(cerrar).toHaveBeenCalledTimes(1);
    // Y el navegador quedó en la entrada REAL de la pantalla: nadie se salió de ella.
    expect(nivel()).toBe(0);
    expect((window.history.state as { key?: string }).key).toBe('piso-2');
  });

  it('cerrada NO apila nada en el historial', async () => {
    const largoInicial = window.history.length;
    render(<Capa abierto={false} alCerrar={vi.fn()} />);

    await new Promise((listo) => setTimeout(listo, 20));
    expect(nivel()).toBe(0);
    expect(window.history.length).toBe(largoInicial);
  });

  it('al cerrarse por la UI consume su entrada (sin avisar de un "atrás" que no hubo)', async () => {
    const cerrar = vi.fn();
    const { rerender } = render(<Capa alCerrar={cerrar} />);
    await waitFor(() => expect(nivel()).toBe(1));

    rerender(<Capa abierto={false} alCerrar={cerrar} />);

    // El clon se devuelve solo: el historial vuelve a la entrada real de la pantalla…
    await waitFor(() => expect(nivel()).toBe(0));
    expect((window.history.state as { key?: string }).key).toBe('piso-2');
    // …y el retroceso propio NO se confunde con un "atrás" del usuario.
    expect(cerrar).not.toHaveBeenCalled();
  });

  it('con capas ANIDADAS el "atrás" cierra SOLO la de encima', async () => {
    const cerrarFuera = vi.fn();
    const cerrarDentro = vi.fn();
    render(
      <>
        <Capa alCerrar={cerrarFuera} />
        <Capa alCerrar={cerrarDentro} />
      </>,
    );
    await waitFor(() => expect(nivel()).toBe(2));

    await atras();
    expect(cerrarDentro).toHaveBeenCalledTimes(1);
    expect(cerrarFuera).not.toHaveBeenCalled();
    expect(nivel()).toBe(1);

    await atras();
    expect(cerrarFuera).toHaveBeenCalledTimes(1);
    expect(cerrarDentro).toHaveBeenCalledTimes(1);
    expect(nivel()).toBe(0);
  });

  it('cerrar DOS capas anidadas a la vez devuelve las DOS entradas (sin huérfanas)', async () => {
    const cerrar = vi.fn();
    const { rerender } = render(
      <>
        <Capa alCerrar={cerrar} />
        <Capa alCerrar={cerrar} />
      </>,
    );
    await waitFor(() => expect(nivel()).toBe(2));

    rerender(<></>);

    await waitFor(() => expect(nivel()).toBe(0));
    expect((window.history.state as { key?: string }).key).toBe('piso-2');
  });

  // El caso del "botón de avance": el cajón se cierra y el panel se abre en el MISMO commit.
  // Las dos capas llevan `key` DISTINTA a propósito: así React desmonta una y monta la otra de
  // verdad (con el mismo elemento en la misma posición se reconciliaría en sitio y la prueba no
  // ejercería nada — hallazgo del reviewer).
  it('cerrar una capa y abrir otra a la vez NO mueve el historial', async () => {
    const cerrarCajon = vi.fn();
    const cerrarPanel = vi.fn();
    const { rerender } = render(<Capa key="cajon" alCerrar={cerrarCajon} />);
    await waitFor(() => expect(nivel()).toBe(1));
    const largoConCajon = window.history.length;

    rerender(<Capa key="panel" alCerrar={cerrarPanel} />);
    await new Promise((listo) => setTimeout(listo, 20));
    // Se compensan: sigue habiendo UNA capa y UN clon (ni retroceso en falso ni entrada de más).
    expect(nivel()).toBe(1);
    expect(window.history.length).toBe(largoConCajon);

    // Y el "atrás" cierra la capa NUEVA, no la que ya se había ido.
    await atras();
    expect(cerrarPanel).toHaveBeenCalledTimes(1);
    expect(cerrarCajon).not.toHaveBeenCalled();
  });

  it('bajo StrictMode (efectos dobles en dev) apila UN solo clon y el primer "atrás" cierra', async () => {
    const cerrar = vi.fn();
    render(
      <StrictMode>
        <Capa alCerrar={cerrar} />
      </StrictMode>,
    );
    await waitFor(() => expect(nivel()).toBe(1));
    await new Promise((listo) => setTimeout(listo, 20));
    expect(nivel()).toBe(1);

    await atras();
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  // Varias pantallas abren su cajón por deep-link en el PRIMER render y, en un efecto del padre,
  // limpian el `state` con un replace. Si el clon se apilara antes, ese replace caería SOBRE él.
  it('el replace del deep-link del padre NO se pierde bajo el clon', async () => {
    const cerrar = vi.fn();
    function PadreConDeepLink(): React.JSX.Element {
      // Equivale al `navigate(location.pathname, { replace: true, state: null })` de las páginas.
      useEffect(() => {
        window.history.replaceState({ usr: null, key: 'limpia', idx: 1 }, '');
      }, []);
      return <Capa alCerrar={cerrar} />;
    }
    render(<PadreConDeepLink />);

    await waitFor(() => expect(nivel()).toBe(1));

    await atras();
    expect(cerrar).toHaveBeenCalledTimes(1);
    // Debajo del clon quedó la entrada LIMPIA del padre (si el replace hubiera pisado al clon,
    // aquí aparecería `piso-2` y el deep-link se volvería a disparar).
    expect((window.history.state as { key?: string }).key).toBe('limpia');
  });

  it('si se NAVEGA encima con la capa abierta, al desmontarla no se deshace esa navegación', async () => {
    const cerrar = vi.fn();
    const { unmount } = render(<Capa alCerrar={cerrar} />);
    await waitFor(() => expect(nivel()).toBe(1));

    // Navegación normal de React Router encima del clon (otra ruta, sin marca).
    window.history.pushState({ usr: null, key: 'otra-ruta', idx: 2 }, '', '/otra-ruta');

    unmount();
    await new Promise((listo) => setTimeout(listo, 20));

    expect(window.location.pathname).toBe('/otra-ruta');
    expect((window.history.state as { key?: string }).key).toBe('otra-ruta');
    expect(cerrar).not.toHaveBeenCalled();
  });

  // Sin esta red, un recorrido que el navegador aborte dejaría al módulo esperando un `popstate`
  // que nunca llega: no volvería a apilar clones y el "atrás" dejaría de cerrar capas EN SILENCIO.
  it('si el retroceso propio se pierde, se recupera solo (no se queda mudo)', async () => {
    const cerrar = vi.fn();
    const { rerender } = render(<Capa alCerrar={cerrar} />);
    await waitFor(() => expect(nivel()).toBe(1));

    // Se sabotea el recorrido: `go()` no hace nada, así que el `popstate` nunca llega.
    const espia = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    rerender(<Capa abierto={false} alCerrar={cerrar} />);
    await new Promise((listo) => setTimeout(listo, 50));
    expect(nivel()).toBe(1); // el clon sigue ahí: el retroceso se perdió
    espia.mockRestore();

    // Pasado el plazo del vigilante, el módulo vuelve a emparejar el historial por su cuenta.
    await waitFor(() => expect(nivel()).toBe(0), { timeout: 5000 });
    expect(cerrar).not.toHaveBeenCalled();
  }, 10000);

  it('un clon HUÉRFANO se salta solo al volver a pisarlo', async () => {
    const cerrar = vi.fn();
    const { unmount } = render(<Capa alCerrar={cerrar} />);
    await waitFor(() => expect(nivel()).toBe(1));

    // Se navega encima (el clon queda enterrado) y la capa desaparece con la pantalla.
    window.history.pushState({ usr: null, key: 'otra-ruta-2', idx: 2 }, '', '/otra-ruta-2');
    unmount();
    await new Promise((listo) => setTimeout(listo, 20));

    // Al regresar, el navegador cae en el clon huérfano… y el hook lo consume solo, sin dejar un
    // "atrás" muerto: el usuario acaba en la entrada REAL de la pantalla.
    await atras();
    await waitFor(() => expect(nivel()).toBe(0));
    expect((window.history.state as { key?: string }).key).toBe('piso-2');
    expect(cerrar).not.toHaveBeenCalled();
  });
});
