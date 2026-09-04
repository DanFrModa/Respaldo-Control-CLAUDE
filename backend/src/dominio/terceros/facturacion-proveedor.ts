/**
 * ¿ESTE PROVEEDOR FACTURA O NO? — la regla general de TODO el sistema (§Post-F9.22), con **UNA
 * sola fuente de verdad** desde la fila 0.124.
 *
 * Daniel (10-ago-2026): *"tenemos dos tipos de proveedores. Los que nos facturan y los que no
 * facturan. Esto aplica para todo tipo de proveedores (maquila, arte, avíos, servicios, telas,
 * etc). Entonces todo esto aplica para los proveedores que manejan facturas. Pero para los que no
 * (eso se define desde que se da de alta el proveedor) todo se tiene que meter manual."*
 *
 * 🔴 DE DÓNDE SALE LA RESPUESTA (fila 0.124, Daniel 3-sep-2026 — §Post-F9.188(d): *"es un error que
 * existan"*). Hasta esta fila la misma pregunta se contestaba DOS veces y en dos campos distintos:
 *  • `Proveedor.factura` (bandera de F1-E1B/R15) — la leía la entrada de tela y el CFDI;
 *  • `Proveedor.modalidadFacturacion` (`solo_con`/`solo_sin`/`ambos`, F6-E4 decisión (h)) — la leen
 *    EsMa, CxP y la corrida semanal de pagos, y desde la fila 0.110 es OBLIGATORIA en el alta.
 * Nada las ataba, así que un proveedor `factura=false` + `solo_con` mandaba su entrada de tela por
 * el camino SIN factura y su captura de CxP por el camino CON factura: **sus pagos se partían en
 * dos según la puerta por la que entraran**. Hoy manda `modalidadFacturacion` y punto; `factura`
 * ya no se captura (sale del contrato de escritura) y donde aún se lea se **deriva** aquí.
 *
 * POR QUÉ VIVE EN `terceros/` Y NO EN `inventarios/`: la distinción es del TERCERO, no del
 * documento. Hoy la usa la entrada de tela (el único flujo que lee CFDI); mañana la usará cualquier
 * otro documento de compra o servicio. Un solo lugar decide, para que no se conteste distinto en
 * cada módulo.
 *
 * LOS TRES ESTADOS (y por qué son tres y no dos):
 *  • `factura`      — emite CFDI (`solo_con` o `ambos`). Camino fiscal: se lee el XML y la cuenta
 *                     por pagar nace por el TOTAL del comprobante (con impuestos).
 *  • `sin-factura`  — no emite (`solo_sin`). Todo se captura a mano y NUNCA hay XML ni UUID.
 *  • `no-definida`  — la modalidad está en NULL. NO es lo mismo que "no factura": son los
 *                     proveedores migrados de Access, donde la pregunta jamás se hizo (REGLA 0-B:
 *                     el histórico llega con huecos A PROPÓSITO y no se rellena). Se les deja pasar
 *                     por el camino fiscal (si mandan un CFDI, el CFDI manda), pero el sistema NO
 *                     decide por ellos lo que nadie capturó: se avisa para que se defina en el
 *                     catálogo. Tratar el NULL como "no factura" habría apagado en silencio la
 *                     lectura de facturas de casi todos los proveedores que ya existen.
 *
 * ⚠️ `ambos` cae en `factura` a propósito: un proveedor que factura *unas cosas sí y otras no* SÍ
 * timbra, así que su CFDI se puede leer y guardar. Qué es con y qué sin factura lo decide
 * `resolverConFactura` **movimiento por movimiento** (`dominio/esma/facturacion.ts`), no esta
 * puerta — que solo pregunta si el camino del CFDI está abierto para él.
 */
import type { ModalidadFacturacion } from '../../datos/index.js';

import { ErrorValidacion } from '../../comun/errores.js';

/** Cómo opera un proveedor respecto al CFDI. */
export type ModalidadFactura = 'factura' | 'sin-factura' | 'no-definida';

/**
 * ⭐ LA ÚNICA DERIVACIÓN (fila 0.124). ¿Emite CFDI este proveedor? `true` si factura (`solo_con` o
 * `ambos`), `false` si nunca (`solo_sin`), `null` si nadie lo definió todavía (proveedor migrado).
 *
 * Todo el sistema pregunta por aquí. Quien lea `Proveedor.factura` directamente estará leyendo la
 * columna HISTÓRICA que ya nadie escribe.
 */
export function emiteFactura(modalidad: ModalidadFacturacion | null | undefined): boolean | null {
  switch (modalidad) {
    case 'solo_con':
    case 'ambos':
      return true;
    case 'solo_sin':
      return false;
    default:
      return null;
  }
}

/** Traduce la modalidad del catálogo a los tres estados con los que se opera. */
export function modalidadFactura(
  modalidad: ModalidadFacturacion | null | undefined,
): ModalidadFactura {
  const emite = emiteFactura(modalidad);
  if (emite === true) return 'factura';
  if (emite === false) return 'sin-factura';
  return 'no-definida';
}

/** ¿Se le puede recibir un CFDI? Solo los que NUNCA facturan quedan fuera. */
export function admiteCfdi(modalidad: ModalidadFacturacion | null | undefined): boolean {
  return modalidadFactura(modalidad) !== 'sin-factura';
}

/**
 * Corta el paso si se intenta meter una factura a nombre de un proveedor cuya modalidad dice que
 * NUNCA factura. Es una validación de SERVIDOR a propósito: la pantalla ya esconde el camino del
 * XML, pero esconder no es impedir (A4, deny-by-default) — y esta contradicción ensuciaría la
 * contabilidad con un cargo fiscal de alguien que no timbra.
 *
 * `queSeIntento` completa la frase "No se puede …": se le pasa la acción concreta para que el
 * mensaje diga qué se estaba haciendo, no un genérico. Y el mensaje manda a **el campo que hoy
 * manda** (*«¿Cómo factura?»*), no a la casilla vieja que ya no se captura.
 */
export function exigirProveedorQueFactura(
  proveedor: { nombre: string; modalidadFacturacion: ModalidadFacturacion | null },
  queSeIntento: string,
): void {
  if (admiteCfdi(proveedor.modalidadFacturacion)) return;
  throw new ErrorValidacion(
    `No se puede ${queSeIntento}: el proveedor "${proveedor.nombre}" está dado de alta como que ` +
      `NUNCA factura (solo sin factura), así que su documentación se captura a mano. Si sí ` +
      `factura, corrige "¿Cómo factura?" en el catálogo de proveedores.`,
  );
}
