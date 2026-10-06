/**
 * ⭐ 0.226b (§Post-F9.244 / §Post-F9.261): ¿la orden está CERRADA? — la cortesía de la PANTALLA.
 *
 * Una orden cerrada se consulta libre pero NO admite movimientos. Quien decide es el SERVIDOR
 * (`exigirOrdenesAbiertas`, `backend/src/dominio/produccion/cierre-orden.ts`, A1): esto sólo sirve
 * para apagar la captura y avisar ANTES, en vez de dejar que alguien llene un formulario y se entere
 * al pulsar Guardar.
 *
 * Acepta las tres formas en que el dato llega a las pantallas:
 *  • `cerradaEn` (la verdad autoritativa de la orden, `OrdenSalida`);
 *  • `estado === 'cerrada'` (su espejo);
 *  • `ordenCerrada` (el booleano ADITIVO que traen las respuestas que no cargan la orden entera:
 *    costeo, auditorías, renglones de OC/nota, existencias de PT…).
 *
 * ⚠️ Si el dato NO viene (respuesta vieja, campo ausente), devuelve `false`: la pantalla no inventa
 * un bloqueo; el servidor sigue rechazando igual.
 */
export function estaCerrada(
  o:
    | {
        cerradaEn?: string | null | undefined;
        estado?: string | null | undefined;
        ordenCerrada?: boolean | null | undefined;
      }
    | null
    | undefined,
): boolean {
  if (o === null || o === undefined) return false;
  if (o.ordenCerrada === true) return true;
  if (o.cerradaEn !== null && o.cerradaEn !== undefined) return true;
  return o.estado === 'cerrada';
}

/** Une folios en español: «12», «12 y 15», «12, 15 y 20». */
function listaDeFolios(folios: readonly string[]): string {
  if (folios.length <= 1) return folios.join('');
  return `${folios.slice(0, -1).join(', ')} y ${folios.at(-1) ?? ''}`;
}

/**
 * ⭐ EL TEXTO ÚNICO del aviso de orden cerrada en pantalla (lenguaje de negocio, sin permisos ni
 * jerga). Vive aquí, en un solo lugar, para que todas las pantallas digan lo mismo. Sin repetidos.
 *
 * ⭐ 0.228 (§Post-F9.244(4)): reabrir es de Daniel —permiso propio, ya no el de cerrar—, así que el
 * aviso dice lo mismo que el servidor (`mensajeOrdenCerrada`): quién puede reabrir, no «desde la
 * ficha», porque quien no tenga ese permiso no verá ahí el botón.
 */
export function textoAvisoOrdenCerrada(folios: readonly (number | string)[]): string {
  const lista = [...new Set(folios.map(String))];
  if (lista.length <= 1) {
    return (
      `La orden ${lista[0] ?? ''} está cerrada: se puede consultar, pero no admite movimientos. ` +
      'Para moverla primero hay que reabrirla, y eso sólo lo puede hacer quien tiene el permiso ' +
      'de reabrir órdenes cerradas.'
    );
  }
  return (
    `Las órdenes ${listaDeFolios(lista)} están cerradas: se pueden consultar, pero no admiten ` +
    'movimientos. Para moverlas primero hay que reabrirlas, y eso sólo lo puede hacer quien tiene ' +
    'el permiso de reabrir órdenes cerradas.'
  );
}

/**
 * Folios (sin repetir) de las órdenes CERRADAS que tocan los renglones de un documento —OC, nota,
 * recepción—: cada renglón trae su `ordenCerrada` del servidor. Sin folio, se usa el id (nunca se
 * pierde una orden del aviso por no tener folio a mano).
 */
export function foliosDeOrdenesCerradas(
  renglones: readonly {
    ordenCerrada?: boolean | null | undefined;
    folioOrden?: number | null | undefined;
    idOrden?: number | null | undefined;
  }[],
): (number | string)[] {
  const folios: (number | string)[] = [];
  for (const r of renglones) {
    if (r.ordenCerrada !== true) continue;
    folios.push(r.folioOrden ?? r.idOrden ?? '—');
  }
  return [...new Set(folios)];
}

// ── 0.227 (§Post-F9.244, etapa 2): las listas de CAPTURA ocultan las cerradas ──────────────────

/**
 * ⭐ 0.227 — la etiqueta ÚNICA del interruptor que vuelve a mostrar las órdenes cerradas en un
 * selector de captura. Una sola, porque el aviso la cita entre comillas: si una pantalla la
 * rotulara distinto, el aviso mandaría a buscar un botón que no existe.
 */
export const ETIQUETA_MOSTRAR_CERRADAS = 'Mostrar cerradas';

/**
 * ⭐ 0.227 — EL AVISO de que lo buscado existe pero está CERRADO (y por eso no aparece). Nunca un
 * «no hay coincidencias» mudo: ése es el precedente del 26-jul-2026 (`SelectorOrden.tsx`), cuando
 * filtrar el selector por estado dejó órdenes inoperables sin explicación. Dice las dos salidas:
 * consultarla (el interruptor) y moverla (reabrirla, que es de quien tiene ese permiso).
 *
 * `total` es cuántas cerradas coinciden en total; `folios`, las que se nombran (las primeras). Si
 * hay más de las nombradas, se dice cuántas más — nunca se callan.
 */
export function textoAvisoCerradasOcultas(
  folios: readonly (number | string)[],
  total: number = folios.length,
): string {
  const lista = [...new Set(folios.map(String))];
  const resto = Math.max(total - lista.length, 0);
  const interruptor = `“${ETIQUETA_MOSTRAR_CERRADAS}”`;
  if (lista.length === 0) return '';
  if (lista.length === 1 && resto === 0) {
    return (
      `La orden ${lista[0] ?? ''} está cerrada: actívala con ${interruptor} para consultarla; ` +
      'para moverla hay que reabrirla.'
    );
  }
  const nombradas = resto > 0 ? `${lista.join(', ')} y ${resto} más` : listaDeFolios(lista);
  return (
    `Las órdenes ${nombradas} están cerradas: actívalas con ${interruptor} para consultarlas; ` +
    'para moverlas hay que reabrirlas.'
  );
}
