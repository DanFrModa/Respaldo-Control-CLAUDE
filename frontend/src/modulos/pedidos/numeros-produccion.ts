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

/**
 * ⭐ **QUÉ DECIR DEL «DESARROLLO» DE UN RENGLÓN DE PEDIDO CUANDO NO TIENE EXPEDIENTE** (fila 0.151).
 *
 * 🔴 El pedido apagaba ese nodo con la nota *«modelo anterior al módulo de Desarrollo»* en **tres
 * sitios medidos** (`PanelGenerarOP` y las dos veces de `PedidosMesPagina`: la columna de la tabla y
 * la cadena del cajón; el cuarto sitio vivía en el Centro de Órdenes y lo cura `nodoDesarrollo`),
 * una nota que **afirma la EDAD del modelo** — un dato que la pantalla no tiene y que
 * `idDesarrollo === null` no demuestra. Y es falso justo en el caso más común de hoy: los renglones
 * que nacen del importador de OC por PDF, que se crean **sin `idDesarrollo`** aunque su modelo sea
 * un modelo de DESARROLLO recién capturado. El usuario leía «este modelo es viejo» de un renglón
 * importado hace un minuto.
 *
 * 🔑 La cura es no adivinar: `origenModelo` ya viaja en el renglón y dice exactamente en qué
 * catálogo vive el modelo. Con eso se afirma sólo lo comprobable — en qué catálogo está y que este
 * renglón no trae expediente— y nunca cuándo se creó.
 *
 * ⚠️ Devuelve el texto SÓLO para el caso sin expediente. Con expediente el nodo se enciende y su
 * tooltip es otro (lo pone cada pantalla), así que aquí no hay nada que decir: `null`.
 */
export function notaSinExpedienteDesarrollo(renglon: {
  codigoModelo: string;
  origenModelo: 'desarrollo' | 'produccion';
  idDesarrollo: number | null;
}): string | null {
  if (renglon.idDesarrollo !== null) {
    return null;
  }
  return renglon.origenModelo === 'desarrollo'
    ? `El modelo ${renglon.codigoModelo} está en el catálogo de DESARROLLO, pero este renglón no ` +
        `está ligado a un expediente de Desarrollo (así nacen los renglones que llegan por el ` +
        `importador de OC del cliente).`
    : `El modelo ${renglon.codigoModelo} está en el catálogo de producción y este renglón no viene ` +
        `de un expediente de Desarrollo.`;
}
