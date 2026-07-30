import { afterEach, describe, expect, it, vi } from 'vitest';

import { instalarSinIncrementosNumericos } from './sin-incrementos-numericos';

let desinstalar: (() => void) | null = null;

/** Instala los guardas y deja programada su baja (idempotencia entre pruebas). */
function instalar(): void {
  desinstalar = instalarSinIncrementosNumericos();
}

afterEach(() => {
  desinstalar?.();
  desinstalar = null;
  document.body.innerHTML = '';
});

/** Crea un input en el documento y le pone el foco. */
function campoEnfocado(tipo: string): HTMLInputElement {
  const campo = document.createElement('input');
  campo.type = tipo;
  document.body.appendChild(campo);
  campo.focus();
  return campo;
}

function rueda(campo: HTMLElement, deltaY = 100): void {
  campo.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY }));
}

function tecla(campo: HTMLElement, key: string): KeyboardEvent {
  const evento = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key });
  campo.dispatchEvent(evento);
  return evento;
}

describe('instalarSinIncrementosNumericos · rueda del mouse', () => {
  it('la rueda sobre un campo NUMÉRICO enfocado le quita el foco (no cambia el valor)', () => {
    instalar();
    const campo = campoEnfocado('number');
    expect(document.activeElement).toBe(campo);

    rueda(campo);

    expect(document.activeElement).not.toBe(campo);
  });

  it('no estorba en los campos de TEXTO (ahí la rueda nunca cambió nada)', () => {
    instalar();
    const campo = campoEnfocado('text');
    const espia = vi.spyOn(campo, 'blur');

    rueda(campo);

    expect(espia).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(campo);
  });

  it('no toca un campo numérico SIN foco (solo el enfocado cambia de valor con la rueda)', () => {
    instalar();
    const numerico = campoEnfocado('number');
    const espia = vi.spyOn(numerico, 'blur');
    campoEnfocado('text'); // se lleva el foco

    rueda(numerico);

    // Se afirma sobre el `blur()`, no sobre `activeElement`: soltar el foco de un campo que no lo
    // tiene es un no-op, así que mirar `activeElement` daría la prueba por buena SIN la guarda
    // (hallazgo del reviewer: la prueba pasaba de gratis).
    expect(espia).not.toHaveBeenCalled();
  });

  it('el scroll HORIZONTAL (deltaY 0) no suelta el foco', () => {
    instalar();
    const campo = campoEnfocado('number');
    const espia = vi.spyOn(campo, 'blur');

    campo.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaX: 120, deltaY: 0 }));

    expect(espia).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(campo);
  });
});

describe('instalarSinIncrementosNumericos · flechas del teclado', () => {
  it('↑/↓ sobre un campo NUMÉRICO cancelan el incremento nativo', () => {
    instalar();
    const campo = campoEnfocado('number');

    expect(tecla(campo, 'ArrowUp').defaultPrevented).toBe(true);
    expect(tecla(campo, 'ArrowDown').defaultPrevented).toBe(true);
  });

  it('deja pasar la tecla al manejador de la pantalla (la matriz sigue navegando)', () => {
    instalar();
    const campo = campoEnfocado('number');
    const visto: string[] = [];
    campo.addEventListener('keydown', (e) => visto.push(e.key));

    tecla(campo, 'ArrowDown');

    // `preventDefault` ≠ `stopPropagation`: el manejador de la matriz recibe la tecla igual.
    expect(visto).toEqual(['ArrowDown']);
  });

  it('no toca ←/→ (ahí el default mueve el cursor dentro del texto) ni otras teclas', () => {
    instalar();
    const campo = campoEnfocado('number');

    expect(tecla(campo, 'ArrowLeft').defaultPrevented).toBe(false);
    expect(tecla(campo, 'ArrowRight').defaultPrevented).toBe(false);
    expect(tecla(campo, 'Enter').defaultPrevented).toBe(false);
  });

  it('no toca los campos de TEXTO (↑/↓ ahí no incrementan nada)', () => {
    instalar();
    const campo = campoEnfocado('text');

    expect(tecla(campo, 'ArrowUp').defaultPrevented).toBe(false);
  });
});

describe('instalarSinIncrementosNumericos · instalación', () => {
  it('es idempotente: dos llamadas no dejan dos guardas', () => {
    instalar();
    const segunda = instalarSinIncrementosNumericos();
    const campo = campoEnfocado('number');
    const espia = vi.spyOn(campo, 'blur');

    rueda(campo);
    expect(espia).toHaveBeenCalledTimes(1);

    // La segunda instalación no instaló nada, así que su "baja" tampoco desarma la primera.
    segunda();
    campo.focus();
    rueda(campo);
    expect(espia).toHaveBeenCalledTimes(2);
  });
});
