/**
 * Arranque del worker de PDF en DEV y en los tests (tsx / vitest). Node “pelón” no sabe cargar
 * TypeScript, y `--import tsx` en el `execArgv` de un Worker NO aplica el loader a su propia entrada
 * (limitación conocida de tsx + worker_threads). Por eso el Worker arranca por este bootstrap en JS
 * PLANO: registra el loader de tsx y RECIÉN entonces importa el hilo trabajador escrito en TypeScript.
 *
 * En PRODUCCIÓN el hilo principal apunta directo al `.js` ya compilado (`pdf-worker-thread.js`) y NO usa
 * este archivo — ver `entradaWorker` en `pdf-worker.ts`. Es `.mjs` sin tipos a propósito: tsc no lo
 * compila (queda fuera de `dist/`) y ESLint le apaga las reglas que necesitan información de tipos.
 */
import { register } from 'tsx/esm/api';

register();
await import('./pdf-worker-thread.ts');
