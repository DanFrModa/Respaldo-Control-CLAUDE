/**
 * "Marcar como PRINCIPAL" (jul-2026, petición de Daniel: *"debe de haber una foto principal del
 * modelo… ¿chance que se pueda marcar como la importante? Y la primera del arte también"*).
 *
 * La regla es deliberadamente simple: **la principal es la PRIMERA**. No hay bandera "esPrincipal"
 * en ninguna tabla — la única fuente de verdad es el `orden` (`ModeloFoto.orden` para las fotos,
 * `ModeloBordado.orden` para el arte del BOM), así que es IMPOSIBLE que una bandera contradiga al
 * orden de despliegue. Marcar principal = mover el renglón elegido al primer lugar y reindexar el
 * resto conservando su orden relativo.
 *
 * Este módulo es la parte PURA del cálculo (sin BD): recibe los renglones YA en su orden de
 * despliegue y devuelve los cambios mínimos a aplicar. Los dominios de fotos (`fotos-modelo.ts`) y
 * de arte del BOM (`bom-modelo.ts`) lo usan dentro de su transacción (A2) para escribir solo lo que
 * de verdad cambia y para saber si la operación fue un no-op (idempotencia: sin cambios no se
 * escribe ni se registra bitácora vacía).
 */

/** Un renglón ordenable: su clave (id de foto, id de bordado…) y su `orden` actual en BD. */
export interface RenglonOrdenado<T> {
  clave: T;
  orden: number;
}

/** Resultado del cálculo de "mover al primer lugar y reindexar". */
export interface ReordenPrincipal<T> {
  /** SOLO los renglones cuyo `orden` cambia (vacío = ya estaba así: la operación es un no-op). */
  cambios: RenglonOrdenado<T>[];
  /** Las claves en el orden resultante (la principal primero). */
  resultado: T[];
}

/**
 * Calcula el reordenamiento que deja `elegida` en el PRIMER lugar: el renglón elegido pasa a
 * `orden` 0 y los demás se reindexan 1..N-1 **conservando su orden relativo actual** (reindexado
 * determinista y compacto: sin huecos ni empates que dependan del desempate de la lectura).
 *
 * - `actuales` debe venir YA en el orden de despliegue (el mismo `orderBy` que usan las lecturas);
 *   de ahí sale el orden relativo que se conserva.
 * - Es **idempotente**: aplicado dos veces, la segunda no produce cambios (`cambios: []`).
 * - Si `elegida` no está en `actuales` (el llamador ya la validó), no hay nada que mover: se
 *   devuelve sin cambios.
 */
export function reordenarComoPrincipal<T>(
  actuales: RenglonOrdenado<T>[],
  elegida: T,
): ReordenPrincipal<T> {
  const elegido = actuales.find((r) => r.clave === elegida);
  if (elegido === undefined) {
    return { cambios: [], resultado: actuales.map((r) => r.clave) };
  }

  const deseado = [elegido, ...actuales.filter((r) => r.clave !== elegida)];
  const cambios = deseado.flatMap((renglon, indice) =>
    renglon.orden === indice ? [] : [{ clave: renglon.clave, orden: indice }],
  );
  return { cambios, resultado: deseado.map((r) => r.clave) };
}
