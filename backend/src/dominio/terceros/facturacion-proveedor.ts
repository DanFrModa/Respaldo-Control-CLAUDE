/**
 * ¿ESTE PROVEEDOR FACTURA O NO? — la regla general de TODO el sistema (§Post-F9.22).
 *
 * Daniel (10-ago-2026): *"tenemos dos tipos de proveedores. Los que nos facturan y los que no
 * facturan. Esto aplica para todo tipo de proveedores (maquila, arte, avíos, servicios, telas,
 * etc). Entonces todo esto aplica para los proveedores que manejan facturas. Pero para los que no
 * (eso se define desde que se da de alta el proveedor) todo se tiene que meter manual."*
 *
 * La bandera ya existía desde F1-E1B (R15 §4): `Proveedor.factura`, capturada en el alta con la
 * casilla *"¿Emite factura (CFDI)?"* y con la regla `factura ⇒ RFC + régimen fiscal`. Lo que este
 * módulo agrega es que esa casilla **MANDE**: quién puede pasar por el camino del CFDI y quién no.
 *
 * POR QUÉ VIVE EN `terceros/` Y NO EN `inventarios/`: la distinción es del TERCERO, no del
 * documento. Hoy la usa la entrada de tela (el único flujo que lee CFDI); mañana la usará cualquier
 * otro documento de compra o servicio. Un solo lugar decide, para que no se conteste distinto en
 * cada módulo.
 *
 * LOS TRES ESTADOS (y por qué son tres y no dos):
 *  • `factura`      — emite CFDI. Camino fiscal: se lee el XML y la cuenta por pagar nace por el
 *                     TOTAL del comprobante (con impuestos).
 *  • `sin-factura`  — no emite. Todo se captura a mano y NUNCA hay XML ni UUID.
 *  • `no-definida`  — la bandera está en NULL. NO es lo mismo que "no factura": son los proveedores
 *                     que venían migrados de Access, donde la pregunta jamás se hizo. Se les deja
 *                     pasar por el camino fiscal (si mandan un CFDI, el CFDI manda), pero el sistema
 *                     NO decide por ellos lo que nadie capturó: se avisa para que se defina en el
 *                     catálogo. Tratar el NULL como "no factura" habría apagado en silencio la
 *                     lectura de facturas de casi todos los proveedores que ya existen.
 */
import { ErrorValidacion } from '../../comun/errores.js';

/** Cómo opera un proveedor respecto al CFDI. */
export type ModalidadFactura = 'factura' | 'sin-factura' | 'no-definida';

/** Traduce la bandera del catálogo (`Proveedor.factura`) a la modalidad con la que se opera. */
export function modalidadFactura(factura: boolean | null | undefined): ModalidadFactura {
  if (factura === true) return 'factura';
  if (factura === false) return 'sin-factura';
  return 'no-definida';
}

/** ¿Se le puede recibir un CFDI? Solo los que NO facturan quedan fuera. */
export function admiteCfdi(factura: boolean | null | undefined): boolean {
  return modalidadFactura(factura) !== 'sin-factura';
}

/**
 * Corta el paso si se intenta meter una factura a nombre de un proveedor marcado como que NO
 * factura. Es una validación de SERVIDOR a propósito: la pantalla ya esconde el camino del XML,
 * pero esconder no es impedir (A4, deny-by-default) — y esta contradicción ensuciaría la
 * contabilidad con un cargo fiscal de alguien que no timbra.
 *
 * `queSeIntento` completa la frase "No se puede …": se le pasa la acción concreta para que el
 * mensaje diga qué se estaba haciendo, no un genérico.
 */
export function exigirProveedorQueFactura(
  proveedor: { nombre: string; factura: boolean | null },
  queSeIntento: string,
): void {
  if (admiteCfdi(proveedor.factura)) return;
  throw new ErrorValidacion(
    `No se puede ${queSeIntento}: el proveedor "${proveedor.nombre}" está dado de alta como que ` +
      `NO emite factura, así que su documentación se captura a mano. Si sí factura, corrígelo en ` +
      `el catálogo de proveedores (casilla "¿Emite factura (CFDI)?").`,
  );
}
