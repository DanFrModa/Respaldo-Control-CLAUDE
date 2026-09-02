/**
 * ⭐⭐ V1-E3 (§Post-F9.172(b)) — **cómo se escribe el nº de producción de un renglón de pedido.**
 *
 * 🔴 Desde V1-E3 el renglón sigue apuntando a su modelo de DESARROLLO —que ya nunca se promueve—,
 * así que `numeroProduccion` (el del modelo del renglón) es `null` **para siempre**: el número que
 * Daniel quiere ver, uno por color, vive en el modelo de cada OP y llega agregado desde el servidor
 * en `numerosProduccion`. Se cae a `numeroProduccion` sólo para el caso LEGADO: un renglón que ya
 * apuntaba a un modelo de producción y todavía no tiene ninguna OP.
 *
 * 🔑 **Vive aquí, y no dentro de una pantalla, porque lo usan DOS** (fila 0.089): la vista por MES
 * (`PedidosMesPagina`) y el detalle de `/pedidos/administrar` (`PedidosPagina`). Las dos contestan
 * la misma pregunta —*"¿qué número enseño en este renglón?"*— y dos copias de la regla es como
 * empiezan a contestarla distinto.
 *
 * Devuelve `''` cuando no hay nada que enseñar; **nunca un cero ni un guion**: cómo se pinta el
 * vacío lo decide cada pantalla (una escribe nada, la otra un `—`).
 */
export function numerosDeProduccion(renglon: {
  numerosProduccion: number[];
  numeroProduccion: number | null;
}): string {
  if (renglon.numerosProduccion.length > 0) {
    return renglon.numerosProduccion.join(' · #');
  }
  return renglon.numeroProduccion === null ? '' : String(renglon.numeroProduccion);
}
