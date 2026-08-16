/**
 * Requisitos de "orden completa" en la UI (espejo del backend
 * `dominio/produccion/requisitos-orden.ts`, Daniel 26-jul-2026).
 *
 * El estado de la orden es AUTOMÁTICO —**tallas + receta liberada, y arte si aplica** (V1-E3d,
 * §Post-F9.43: el segundo requisito dejó de preguntarle al MODELO si tiene avíos y le pregunta a
 * ESTA orden si Desarrollo liberó su receta)— y el backend manda
 * qué le falta (`requisitos.faltantes` en el detalle, `faltantes` en la fila del centro de
 * órdenes). Aquí SOLO se traduce esa lista a la frase que ve el usuario: la regla NO se recalcula
 * en el cliente (A1), para que pantalla y servidor nunca digan cosas distintas.
 */

/** Claves de requisito tal como las manda el API. */
export type ClaveRequisitoOrden = 'tallas' | 'receta' | 'arte';

/** Etiqueta en lenguaje de negocio de cada requisito. */
const ETIQUETA_REQUISITO: Record<ClaveRequisitoOrden, string> = {
  tallas: 'tallas',
  receta: 'liberar la receta',
  arte: 'arte',
};

/**
 * Texto "Falta: …" con lo que le impide a la orden estar COMPLETA, o `null` si no le falta nada.
 * Es la respuesta a *"no sé en base a qué existe el estado"*: la pantalla lo dice.
 */
export function textoFaltantes(faltantes: readonly ClaveRequisitoOrden[]): string | null {
  if (faltantes.length === 0) return null;
  const etiquetas = faltantes.map((f) => ETIQUETA_REQUISITO[f]);
  // "tallas", "tallas y liberar la receta", … (coma hasta el penúltimo, "y" al final).
  const ultima = etiquetas.pop() as string;
  return `Falta: ${etiquetas.length === 0 ? ultima : `${etiquetas.join(', ')} y ${ultima}`}`;
}
