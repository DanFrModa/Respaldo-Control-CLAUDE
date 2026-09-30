// ⚠️ Import RELATIVO a propósito, no con el alias `@/`: este archivo lo compila TAMBIÉN
// `tsconfig.node.json` (lo arrastra `src/ventana-fecha-pt.test.ts`, que lee el `openapi.json` con
// `node:fs`), y ese proyecto no declara `baseUrl`/`paths` — con el alias, el typecheck del
// frontend truena con «Cannot find module '@/lib/fecha-negocio'» (medido).
import { hoy } from '../../lib/fecha-negocio';

/**
 * La VENTANA de fecha de la captura de PT (fila 0.171; el huso, fila 0.174) — el lado de la
 * pantalla.
 *
 * ⚠️ **Esto es cortesía, no la guarda.** La regla vive en el servidor
 * (`dominio/inventarios/movimientos-pt.ts` → `comun/fecha-capturable.ts`): sin el permiso
 * `ipt.fecha-libre` —el acceso #28 del sistema viejo, *«poder meter la fecha que sea en los
 * movimientos de almacen de PT»*— sólo se aceptan los últimos días y nunca una fecha futura. Aquí
 * sólo se acota el selector para no ofrecer una fecha que el servidor va a rechazar; A1: la
 * pantalla esconde, el servidor decide.
 *
 * Los DOS lados tienen que decir el mismo número: si el dominio cambia la ventana, éste se cambia
 * con él (por eso está en un solo sitio y no copiado en cada pantalla).
 *
 * 📌 **Fila 0.216 — el día del negocio se mudó a `lib/fecha-negocio.ts`** (y se re-exporta aquí para
 * no tocar a sus consumidores): lo necesitaba también la nota de salida de avíos, y la zona escrita
 * dos veces es exactamente el dato repetido que acaba divergiendo.
 */

/** Días hacia atrás que puede fechar quien NO tiene `ipt.fecha-libre` (espejo del backend). */
export const DIAS_VENTANA_CAPTURA_PT = 7;

export { hoy };

/** El día más viejo que acepta el servidor sin `ipt.fecha-libre`, en YYYY-MM-DD. */
export function inicioVentanaCapturaPt(): string {
  const base = Date.parse(`${hoy()}T00:00:00.000Z`);
  return new Date(base - DIAS_VENTANA_CAPTURA_PT * 86_400_000).toISOString().slice(0, 10);
}

/**
 * `min`/`max` del `<input type="date">` según la llave: con `ipt.fecha-libre`, ninguno (cualquier
 * fecha); sin ella, la ventana. Se devuelven como objeto para esparcirlo en el input y que las
 * props ni existan cuando no aplican.
 */
export function limitesFechaCapturaPt(puedeFechaLibre: boolean): { min?: string; max?: string } {
  return puedeFechaLibre ? {} : { min: inicioVentanaCapturaPt(), max: hoy() };
}
