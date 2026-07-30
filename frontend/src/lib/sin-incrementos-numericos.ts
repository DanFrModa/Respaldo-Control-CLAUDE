/**
 * Apaga el INCREMENTO AUTOMÁTICO de los campos numéricos por las vías que no se pueden apagar con
 * CSS: la RUEDA del mouse y las FLECHAS del teclado.
 *
 * Petición de Daniel (28-jul-2026), sobre los campos de captura de corte, maquilas y la OP:
 * *"pones una casilla con flechitas arriba y abajo para ir aumentando con el mouse… no funciona.
 * Siempre se van a meter escribiendo o copiando los datos. Nunca se usarán esas flechitas"*.
 *
 * Un `input[type="number"]` ofrece TRES caminos para subir/bajar el valor con un gesto, y los tres
 * son el mismo control:
 *   1. el widget de flechitas → se apaga con CSS (`index.css`, `@layer base`);
 *   2. la RUEDA del mouse con el campo enfocado;
 *   3. las FLECHAS ↑/↓ del teclado.
 *
 * Los dos últimos son los peligrosos, porque cambian la cantidad **sin que nadie lo note**: el
 * usuario creía estar haciendo scroll, o bajando al siguiente renglón de la matriz color×talla. El
 * caso de las flechas ya mordía hoy: la matriz de captura (`MatrizColorTalla`) mueve el foco con
 * ↑/↓ y solo cancela el default CUANDO HAY celda destino — en el ÚLTIMO renglón, un ↓ por costumbre
 * dejaba 120 en 119, en silencio (hallazgo del reviewer).
 *
 * Se resuelve con DOS listeners únicos para toda la app, en captura, así que cubre los ~123 campos
 * numéricos del sistema —incluidos los `<input>` crudos que no pasan por el componente `Input`— sin
 * tocar ni una pantalla. Se usa `preventDefault` (no `stopPropagation`): la navegación por teclado
 * de las matrices sigue corriendo su propio manejador y moviendo el foco igual que siempre.
 *
 * Trade-off ACEPTADO en la rueda: se le quita el foco al campo en vez de cancelar el evento, porque
 * cancelarlo apagaría también el SCROLL de la página mientras el puntero esté encima de esa celda —
 * y el usuario que gira la rueda quiere justamente scrollear. El costo es que el siguiente Tab
 * arranca desde el principio del documento; en las matrices se navega con ↑/↓ y con el clic, no con
 * Tab, y el gesto es recuperable de un clic. Perder la posición del Tab se ve; una cantidad
 * cambiada en silencio, no.
 */

/** Se instala UNA sola vez (HMR en desarrollo y las pruebas pueden llamarlo varias veces). */
let instalado = false;

function alGirarLaRueda(evento: WheelEvent): void {
  // Scroll HORIZONTAL (shift+rueda, trackpad lateral): nunca cambió un valor → no estorbar. Las
  // matrices anchas se navegan así cuando hay muchas tallas.
  if (evento.deltaY === 0) {
    return;
  }
  const objetivo = evento.target;
  if (
    objetivo instanceof HTMLInputElement &&
    objetivo.type === 'number' &&
    objetivo === document.activeElement
  ) {
    objetivo.blur();
  }
}

function alTeclear(evento: KeyboardEvent): void {
  if (evento.key !== 'ArrowUp' && evento.key !== 'ArrowDown') {
    return;
  }
  const objetivo = evento.target;
  if (objetivo instanceof HTMLInputElement && objetivo.type === 'number') {
    // Solo se cancela el INCREMENTO nativo del navegador. El manejador de la pantalla (p. ej. la
    // navegación entre celdas de la matriz) recibe la tecla igual y hace lo suyo.
    evento.preventDefault();
  }
}

/**
 * Instala los dos guardas. Idempotente. Devuelve la función que los quita (para pruebas; en la app
 * viven lo que vive la SPA).
 */
export function instalarSinIncrementosNumericos(): () => void {
  if (typeof document === 'undefined' || instalado) {
    return () => undefined;
  }
  instalado = true;
  // En captura: se atiende antes de que el evento llegue al campo. La rueda va PASIVA a propósito
  // (no se cancela el scroll, solo se suelta el foco); el teclado NO puede serlo, porque ahí sí se
  // cancela el default.
  document.addEventListener('wheel', alGirarLaRueda, { capture: true, passive: true });
  document.addEventListener('keydown', alTeclear, { capture: true });
  return () => {
    document.removeEventListener('wheel', alGirarLaRueda, { capture: true });
    document.removeEventListener('keydown', alTeclear, { capture: true });
    instalado = false;
  };
}
