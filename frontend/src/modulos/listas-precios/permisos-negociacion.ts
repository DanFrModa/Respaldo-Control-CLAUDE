import type { ClavePermiso } from '@/api/tipos';

/**
 * ⭐ **QUIÉN COMENTA LA NEGOCIACIÓN** — fila 0.238 (§Post-F9.248(b)).
 *
 * Daniel, sobre Aurora: *«las listas negociar **solo de lectura y poder agregar comentarios**, pero
 * no modificar lo que yo hice»*. Comentar se abre con `listas.comentar` **o** con `listas.negociar`
 * (quien negocia, comenta). ⚠️ La inversa NO: rondas, acuerdos, estados, la mesa y las cotizaciones
 * siguen gateados SÓLO con `listas.negociar`.
 *
 * Gemela de `exigirComentarNegociacion` del backend (`dominio/desarrollo/comentarios-negociacion.ts`),
 * que es la que decide: la pantalla sólo esconde. Si el criterio cambia, cambia en los dos lados.
 */
export function puedeComentarNegociacion(tienePermiso: (clave: ClavePermiso) => boolean): boolean {
  return tienePermiso('listas.negociar') || tienePermiso('listas.comentar');
}
