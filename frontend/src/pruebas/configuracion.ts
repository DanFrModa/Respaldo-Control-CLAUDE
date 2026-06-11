import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Configuracion global de las pruebas con Vitest + Testing Library:
 *  - Registra los matchers de `@testing-library/jest-dom` (p. ej.
 *    `toBeInTheDocument`, `toHaveTextContent`).
 *  - Desmonta el arbol de React despues de cada prueba para que no se filtre
 *    estado entre casos.
 */
afterEach(() => {
  cleanup();
});
