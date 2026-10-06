import { useEffect, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

import type { ErrorDeApi } from '@/api/errores';
import { useConsultaOrdenes } from '@/api/ordenes-consulta';
import type { OrdenesConsultaPagina } from '@/api/tipos';
import { estaCerrada } from '@/lib/orden-cerrada';

/**
 * ⭐⭐ 0.227 (§Post-F9.244, etapa 2) — LAS ÓRDENES QUE SE OFRECEN EN UN `<select>` DE CAPTURA (renglón
 * de OC, renglón de nota de salida, «Traer avíos de la orden»).
 *
 * Por omisión **sólo las ABIERTAS**, filtradas en el SERVIDOR (`cerradas: 'ocultar'`): la lista es
 * una página (las primeras 100) y filtrarla en el cliente escondería órdenes sin decirlo — peor, una
 * cerrada le quitaría el lugar a una abierta. Con el interruptor «Mostrar cerradas» vuelven todas.
 *
 * Y dos cosas que un filtro ingenuo rompería, y por eso viven aquí y no en cada pantalla:
 *  1. **Lo ya elegido nunca desaparece del desplegable.** Un renglón que apunta a una orden que la
 *     página no trae (una cerrada con el interruptor apagado, o una OC/nota vieja) se pintaría como
 *     «Sin ligar» en un `<select>` nativo —un valor sin `<option>`—, y el usuario creería que no
 *     tiene orden. {@link ordenesConElegidas} la añade con lo que se sepa de ella.
 *  2. **Lo cerrado no se olvida al apagar el interruptor.** El aviso de la etapa 1 (y el guardar
 *     apagado) se calcula sobre TODAS las órdenes vistas en la sesión del diálogo, no sólo sobre la
 *     página actual: si alguien elige una cerrada con el interruptor y luego lo apaga, la pantalla
 *     sigue sabiendo que esa orden está cerrada.
 */

/** Lo mínimo que un `<select>` de orden necesita de cada opción. */
export interface OrdenElegible {
  id: number;
  /** `null` = no se sabe (una orden elegida que no vino en ninguna respuesta): se rotula por id. */
  folio: number | null;
  /** Código del modelo (se omite si no se conoce — p. ej. una orden que sólo trae el renglón). */
  codigoModelo?: string | null;
  estado?: string | null;
  cerradaEn?: string | null;
  ordenCerrada?: boolean | null;
}

/** Rótulo de la opción: «Orden 5424 · A-100 · Cerrada». */
export function rotuloOrdenElegible(o: OrdenElegible): string {
  const modelo =
    o.codigoModelo !== undefined && o.codigoModelo !== null ? ` · ${o.codigoModelo}` : '';
  const folio = o.folio === null ? `(id ${o.id})` : String(o.folio);
  return `Orden ${folio}${modelo}${estaCerrada(o) ? ' · Cerrada' : ''}`;
}

/**
 * La lista del `<select>`: la página que mandó el servidor + cada orden ELEGIDA que no viene en ella
 * (al final, con lo que se sepa: lo visto en la sesión o el respaldo que da el documento guardado).
 * Función PURA.
 */
export function ordenesConElegidas(
  lista: readonly OrdenElegible[],
  elegidas: Iterable<number | null | undefined>,
  conocidas: ReadonlyMap<number, OrdenElegible>,
): OrdenElegible[] {
  const salida: OrdenElegible[] = [...lista];
  const presentes = new Set(lista.map((o) => o.id));
  for (const id of elegidas) {
    if (id === null || id === undefined || presentes.has(id)) continue;
    presentes.add(id);
    salida.push(conocidas.get(id) ?? { id, folio: null });
  }
  return salida;
}

/** ¿Dicen lo mismo (para el desplegable y el aviso)? */
function mismaOrden(a: OrdenElegible | undefined, b: OrdenElegible): boolean {
  return (
    a !== undefined &&
    a.folio === b.folio &&
    a.codigoModelo === b.codigoModelo &&
    estaCerrada(a) === estaCerrada(b)
  );
}

/**
 * La consulta de órdenes de un diálogo de captura, con el interruptor aplicado en el servidor, más
 * el registro de TODAS las órdenes vistas mientras el diálogo vive (para el punto 2 de arriba).
 */
export function useOrdenesDeCaptura(mostrarCerradas: boolean): {
  consulta: UseQueryResult<OrdenesConsultaPagina, ErrorDeApi>;
  lista: readonly OrdenElegible[];
  vistas: ReadonlyMap<number, OrdenElegible>;
} {
  const consulta = useConsultaOrdenes({
    pagina: 1,
    porPagina: 100,
    incluirCanceladas: 'false',
    cerradas: mostrarCerradas ? 'incluir' : 'ocultar',
  });
  const datos = consulta.data?.datos;
  const [vistas, setVistas] = useState<ReadonlyMap<number, OrdenElegible>>(() => new Map());
  useEffect(() => {
    if (datos === undefined) return;
    setVistas((previas) => {
      // Sin cambios de fondo ⇒ el MISMO mapa (React no re-pinta): una respuesta re-armada con los
      // mismos datos no debe disparar otra vuelta.
      if (datos.every((o) => mismaOrden(previas.get(o.id), o))) return previas;
      const unidas = new Map(previas);
      for (const o of datos) unidas.set(o.id, o);
      return unidas;
    });
  }, [datos]);
  return { consulta, lista: datos ?? [], vistas };
}
