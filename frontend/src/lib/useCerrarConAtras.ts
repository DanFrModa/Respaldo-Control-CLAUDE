import { useEffect, useRef } from 'react';

/**
 * Hace que el botón "atrás" del teléfono (o del navegador) CIERRE la capa flotante que está
 * encima —el cajón de detalle, un modal a pantalla completa— en vez de salirse de la pantalla.
 *
 * El problema que resuelve (reporte de Daniel, jul-2026): en el celular el detalle de una orden
 * vive en un cajón deslizante que NO es una ruta; al dar "regresar" el navegador retrocedía en el
 * historial y sacaba al usuario del Centro de Órdenes (aterrizando en la pantalla anterior, p. ej.
 * Almacenes). Lo esperado es volver al LISTADO, que es justo lo que hay debajo del cajón.
 *
 * ── Cómo funciona ────────────────────────────────────────────────────────────────────────────
 * Cada capa abierta ocupa una entrada CLON del historial: misma URL y mismo `state` interno de
 * React Router (`{usr, key, idx}`) más una MARCA propia con su nivel. React Router solo lee
 * `usr`/`key`/`idx`, así que la marca le es invisible: ni al apilar el clon ni al consumirlo hay
 * cambio de ruta, de `location.state` ni efectos de deep-link que se vuelvan a disparar.
 *
 * El estado del historial NO se lleva "a ciegas": el nivel se LEE de la entrada en la que está
 * parado el navegador y se compara contra las capas abiertas (`sincronizar`). Todo desajuste
 * —la capa se cerró con la ✕, el usuario retrocedió, quedó un clon huérfano— se corrige solo.
 * La sincronización se difiere UN TICK a propósito: así corren antes los efectos de los padres y
 * los `navigate(..., { replace: true })` con que varias pantallas limpian su deep-link (si el clon
 * se apilara primero, ese replace caería SOBRE el clon y descuadraría el historial). Diferirlo
 * también hace que abrir una capa mientras se cierra otra —el caso "botón de avance", que cierra
 * el cajón y abre el panel en el mismo commit— NO toque el historial: se compensan.
 *
 * Capas ANIDADAS (el cajón de "Avíos" o "Ruta crítica" abierto sobre el detalle de la orden): cada
 * una ocupa su nivel y un "atrás" cierra ÚNICAMENTE la de encima.
 *
 * Si se NAVEGA a otra pantalla con la capa abierta (p. ej. un mosaico del propio detalle), el clon
 * queda enterrado bajo la ruta nueva: nunca se retrocede a ciegas, porque deshacer esa navegación
 * sería mucho peor. Ese clon huérfano no estorba — al volver a pisarlo se salta solo. El botón
 * ADELANTE hacia un clon huérfano rebota por la misma razón: no debe reabrir una capa fantasma.
 *
 * El listener de `popstate` es ÚNICO para toda la app y, una vez instalado, ya no se quita: vive lo
 * que vive la SPA y no hace nada mientras no haya capas abiertas.
 *
 * ── Dos bordes conocidos, los dos benignos (nunca sacan al usuario de la pantalla) ───────────────
 * 1. Un `navigate(..., { replace: true })` / `setSearchParams(..., { replace: true })` disparado
 *    MIENTRAS la capa está abierta pisa la marca del clon (React Router reescribe el `state`
 *    limpio). La cuenta solo puede quedar por DEBAJO de la real —jamás por encima—, así que a lo
 *    sumo queda una entrada de más: un "atrás" que no hace nada visible. Hoy ninguna pantalla lo
 *    dispara (los `replace` son de deep-link y corren ANTES del clon, ver arriba); si alguna lo
 *    estrena, que sea sabiendo esto.
 * 2. Recargar (F5) parado sobre un clon: la marca sobrevive, pero como no hay capas abiertas nadie
 *    sincroniza hasta la siguiente apertura/cierre. El primer "atrás" tras esa recarga cae en la
 *    entrada real (misma URL, no se nota); abrir un cajón REUTILIZA el clon y todo vuelve a cuadrar.
 *    No se sincroniza al cargar a propósito: implicaría un `go(-1)` silencioso en cada arranque.
 */

/** Marca que este módulo pone en el `state` de sus entradas clon (con el nivel que ocupan). */
const MARCA = '__capaFlotante';

/** Una capa abierta: lo único que el módulo necesita de ella es cómo cerrarla. */
type Capa = { cerrar: () => void };

/** Capas abiertas, de la más vieja a la de ENCIMA (la última es la que cierra un "atrás"). */
const pila: Capa[] = [];

/** Retrocesos provocados por este módulo cuyo `popstate` todavía no llega. */
let popsPropiosPendientes = 0;

/**
 * Red de seguridad del contador de arriba. `sincronizar()` se queda quieto mientras hay un
 * retroceso en vuelo; si ese `popstate` NUNCA llegara (el navegador puede abortar un recorrido —
 * historial podado por la propia sesión, restore raro—), el módulo se quedaría mudo para siempre y
 * volvería el bug original EN SILENCIO. Pasado el plazo se da por perdido y se vuelve a empezar.
 * El plazo es holgado a propósito: un recorrido dentro del MISMO documento es inmediato, así que
 * llegar aquí con uno realmente en vuelo no es un escenario realista.
 */
const ESPERA_POP_PROPIO_MS = 2000;
let vigilantePopPropio: ReturnType<typeof setTimeout> | null = null;

let sincronizacionProgramada = false;
let listenerInstalado = false;

/** Nivel de la entrada del historial en la que está parado el navegador (0 = entrada real). */
function nivelActual(): number {
  const estado: unknown = window.history.state;
  if (typeof estado !== 'object' || estado === null || !(MARCA in estado)) {
    return 0;
  }
  const nivel = (estado as Record<string, unknown>)[MARCA];
  return typeof nivel === 'number' && Number.isInteger(nivel) && nivel > 0 ? nivel : 0;
}

/** Copia del `state` actual (el de React Router) para heredarlo en el clon. */
function estadoActual(): Record<string, unknown> {
  const estado: unknown = window.history.state;
  return typeof estado === 'object' && estado !== null
    ? { ...(estado as Record<string, unknown>) }
    : {};
}

/** Empareja el historial con las capas abiertas: apila los clones que falten o consume los que sobren. */
function sincronizar(): void {
  if (typeof window === 'undefined') {
    // La sincronización va diferida un tick: si en ese hueco desapareció el documento (el desmontaje
    // de un entorno de pruebas, un render de servidor), no hay historial que emparejar.
    return;
  }
  if (popsPropiosPendientes > 0) {
    // Hay un retroceso propio EN VUELO: `window.history` todavía no refleja el destino. Se decide
    // cuando llegue su `popstate` (que vuelve a sincronizar) — si no, se retrocedería de más.
    return;
  }
  const deseado = pila.length;
  const actual = nivelActual();
  if (actual === deseado) {
    return;
  }
  if (actual < deseado) {
    for (let nivel = actual + 1; nivel <= deseado; nivel += 1) {
      try {
        window.history.pushState({ ...estadoActual(), [MARCA]: nivel }, '');
      } catch {
        // Algunos navegadores limitan la FRECUENCIA de `pushState` (Safari, ~100 por 30 s) y tiran
        // SecurityError. Las capas siguen funcionando; solo se quedan sin "cerrar con atrás".
        return;
      }
    }
    return;
  }
  // Sobran clones: la capa se cerró por la UI, o se pisó un clon huérfano de una visita anterior.
  // `go()` dispara UN solo `popstate` aunque recorra varios pasos.
  popsPropiosPendientes += 1;
  armarVigilante();
  window.history.go(deseado - actual);
}

function armarVigilante(): void {
  if (vigilantePopPropio !== null) {
    clearTimeout(vigilantePopPropio);
  }
  vigilantePopPropio = setTimeout(() => {
    vigilantePopPropio = null;
    if (popsPropiosPendientes === 0) {
      return;
    }
    // El `popstate` se dio por perdido: se recupera el conteo y se vuelve a emparejar contra lo
    // que diga el historial REAL (que a estas alturas ya está quieto).
    popsPropiosPendientes = 0;
    programarSincronizacion();
  }, ESPERA_POP_PROPIO_MS);
}

function desarmarVigilante(): void {
  if (popsPropiosPendientes === 0 && vigilantePopPropio !== null) {
    clearTimeout(vigilantePopPropio);
    vigilantePopPropio = null;
  }
}

function programarSincronizacion(): void {
  if (sincronizacionProgramada) {
    return;
  }
  sincronizacionProgramada = true;
  setTimeout(() => {
    sincronizacionProgramada = false;
    sincronizar();
  }, 0);
}

function alRetroceder(): void {
  const propio = popsPropiosPendientes > 0;
  try {
    if (propio) {
      popsPropiosPendientes -= 1;
      desarmarVigilante();
      return;
    }
    // Retroceso del USUARIO: se cierran las capas que quedaron por encima del nivel al que llegó.
    // La pila se recorta AQUÍ MISMO (no cuando React desmonte la capa): la contabilidad del
    // historial no puede esperar al siguiente render, o la próxima sincronización creería que
    // falta un clon y volvería a apilarlo.
    const nivel = nivelActual();
    while (pila.length > nivel) {
      pila.pop()?.cerrar();
    }
  } finally {
    // Pase lo que pase —incluso si el `cerrar()` de una pantalla revienta— hay que volver a
    // emparejar: si no, la pila quedaría recortada a medias y el historial descuadrado.
    programarSincronizacion();
  }
}

function registrarCapa(capa: Capa): void {
  if (!listenerInstalado) {
    listenerInstalado = true;
    window.addEventListener('popstate', alRetroceder);
  }
  pila.push(capa);
  programarSincronizacion();
}

function quitarCapa(capa: Capa): void {
  const indice = pila.indexOf(capa);
  if (indice !== -1) {
    pila.splice(indice, 1);
  }
  programarSincronizacion();
}

/**
 * @param abierto  Si la capa está visible (mientras lo esté, ocupa una entrada del historial).
 * @param alCerrar Qué hacer cuando el usuario da "atrás" (cerrar la capa).
 */
export function useCerrarConAtras(abierto: boolean, alCerrar: () => void): void {
  // El callback se guarda en un ref: si el efecto dependiera de él, cada render con una función
  // nueva volvería a registrar la capa.
  const refCerrar = useRef(alCerrar);
  refCerrar.current = alCerrar;

  useEffect(() => {
    if (!abierto) {
      return;
    }
    const capa: Capa = { cerrar: () => refCerrar.current() };
    registrarCapa(capa);
    return () => {
      quitarCapa(capa);
    };
  }, [abierto]);
}
