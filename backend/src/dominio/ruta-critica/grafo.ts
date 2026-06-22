/**
 * Lógica PURA del grafo (DAG) de dependencias de la Ruta Crítica (F5-E1; doc 08-Ruta-Critica).
 *
 * Se aísla aquí, sin Prisma ni sesión, para poder probar el RECHAZO DE CICLOS de forma directa
 * (tests unitarios sin BD) — la regla más delicada del catálogo configurable: el grafo de
 * dependencias DEBE permanecer acíclico (un CPM con un ciclo no tiene orden topológico).
 *
 * Modelo: una arista `antecesor → proceso` significa "el antecesor ocurre ANTES que el proceso".
 * Detectar si agregar las aristas de un proceso (sus antecesores) forma un ciclo = comprobar si
 * alguno de esos antecesores es ALCANZABLE desde el propio proceso siguiendo "quién va después"
 * (la relación inversa). Si lo es, cerrar la arista crearía un ciclo.
 */

/**
 * Adyacencia "antecesor → sucesores": para cada proceso, qué procesos dependen de él (van DESPUÉS).
 * Es el grafo dirigido en el sentido del tiempo (antecesor apunta a su sucesor).
 */
export type GrafoSucesores = ReadonlyMap<number, ReadonlySet<number>>;

/**
 * Construye el grafo de sucesores a partir de la lista de aristas existentes
 * `{ idProceso, idAntecesor }` (cada una: el antecesor va antes que el proceso). La arista
 * `antecesor → proceso` se guarda como "el antecesor tiene de sucesor al proceso".
 */
export function construirGrafoSucesores(
  aristas: readonly { idProceso: number; idAntecesor: number }[],
): Map<number, Set<number>> {
  const grafo = new Map<number, Set<number>>();
  for (const { idProceso, idAntecesor } of aristas) {
    const sucesores = grafo.get(idAntecesor);
    if (sucesores) {
      sucesores.add(idProceso);
    } else {
      grafo.set(idAntecesor, new Set([idProceso]));
    }
  }
  return grafo;
}

/**
 * ¿`objetivo` es alcanzable desde `origen` siguiendo las aristas "antecesor → sucesor"? (DFS
 * iterativo, sin recursión, para no desbordar con grafos grandes). `origen === objetivo` cuenta
 * como alcanzable (un proceso "se alcanza a sí mismo" en 0 pasos).
 */
export function esAlcanzable(grafo: GrafoSucesores, origen: number, objetivo: number): boolean {
  if (origen === objetivo) {
    return true;
  }
  const pila: number[] = [origen];
  const visitados = new Set<number>();
  while (pila.length > 0) {
    const actual = pila.pop();
    if (actual === undefined || visitados.has(actual)) {
      continue;
    }
    visitados.add(actual);
    const sucesores = grafo.get(actual);
    if (!sucesores) {
      continue;
    }
    for (const sucesor of sucesores) {
      if (sucesor === objetivo) {
        return true;
      }
      if (!visitados.has(sucesor)) {
        pila.push(sucesor);
      }
    }
  }
  return false;
}

/** Resultado de validar un set propuesto de antecesores para un proceso. */
export interface ResultadoValidacionDependencias {
  /** `true` si el set propuesto mantiene el grafo acíclico. */
  ok: boolean;
  /**
   * Si NO es ok, el primer antecesor problemático y por qué (auto-antecedente o ciclo
   * transitivo). `undefined` cuando `ok` es `true`.
   */
  conflicto?: { idAntecesor: number; razon: 'auto' | 'ciclo' };
}

/**
 * Valida que fijar `idsAntecesores` como antecesores de `idProceso` mantenga el grafo ACÍCLICO,
 * partiendo de las aristas EXISTENTES (sin las del propio `idProceso`, que se reemplazan por el
 * nuevo set). Reglas:
 *
 *  1. Un proceso no puede ser su propio antecesor (`idAntecesor === idProceso`) → `auto`.
 *  2. Agregar `antecesor → idProceso` forma un ciclo si `idProceso` ya alcanza a ese antecesor
 *     siguiendo "quién va después" (es decir, el antecesor ya depende, directa o transitivamente,
 *     de `idProceso`) → `ciclo`.
 *
 * @param idProceso        proceso cuyos antecesores se están fijando.
 * @param idsAntecesores   set propuesto de antecesores.
 * @param aristasExistentes aristas del grafo SIN incluir las de `idProceso` (se reemplazan).
 */
export function validarDependencias(
  idProceso: number,
  idsAntecesores: readonly number[],
  aristasExistentes: readonly { idProceso: number; idAntecesor: number }[],
): ResultadoValidacionDependencias {
  // El grafo base no debe contener las aristas del proceso que estamos re-definiendo.
  const base = aristasExistentes.filter((a) => a.idProceso !== idProceso);
  const grafo = construirGrafoSucesores(base);

  for (const idAntecesor of idsAntecesores) {
    if (idAntecesor === idProceso) {
      return { ok: false, conflicto: { idAntecesor, razon: 'auto' } };
    }
    // ¿El antecesor ya va DESPUÉS de idProceso (directa o transitivamente)? Entonces cerrar
    // `antecesor → idProceso` crearía un ciclo.
    if (esAlcanzable(grafo, idProceso, idAntecesor)) {
      return { ok: false, conflicto: { idAntecesor, razon: 'ciclo' } };
    }
    // Considera la nueva arista para detectar ciclos entre los antecesores del MISMO set
    // (p. ej. fijar a y b donde b ya alcanza a a vía el propio idProceso recién agregado).
    const sucesores = grafo.get(idAntecesor);
    if (sucesores) {
      sucesores.add(idProceso);
    } else {
      grafo.set(idAntecesor, new Set([idProceso]));
    }
  }
  return { ok: true };
}
