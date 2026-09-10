/**
 * REGISTRO de los adaptadores del cíclico por dimensión (fila 0.099). El motor NUNCA menciona una
 * dimensión por su nombre: pide el adaptador aquí y trabaja contra el contrato de `tipos.ts`. Sumar
 * una cuarta dimensión mañana es escribir su adaptador y añadirlo a este mapa.
 */
import type { DimensionCiclicoValor } from '../../../contrato/index.js';
import type { TipoAlmacen } from '../../../datos/index.js';

import { adaptadorAvio } from './avio.js';
import { adaptadorPt } from './pt.js';
import { adaptadorTela } from './tela.js';
import type { AdaptadorCiclico } from './tipos.js';

/** Los tres adaptadores, por dimensión. */
export const ADAPTADORES: Record<DimensionCiclicoValor, AdaptadorCiclico> = {
  PT: adaptadorPt,
  TELA: adaptadorTela,
  AVIO: adaptadorAvio,
};

/**
 * De QUÉ GUARDA un almacén a QUÉ CUENTA su hoja. Es la traducción de la regla del lead: la
 * dimensión la manda el TIPO DEL ALMACÉN, no un campo que elija el usuario. `TipoAlmacen` y
 * `DimensionInventarioCiclico` son enums distintos a propósito (uno es de la bodega, el otro de la
 * hoja), y este mapa es el ÚNICO puente entre ellos.
 */
const DIMENSION_POR_TIPO: Record<TipoAlmacen, DimensionCiclicoValor> = {
  PT: 'PT',
  TELA: 'TELA',
  AVIO: 'AVIO',
};

/** Adaptador de una dimensión. */
export function adaptadorDe(dimension: DimensionCiclicoValor): AdaptadorCiclico {
  return ADAPTADORES[dimension];
}

/** Qué dimensión cuenta la hoja de un almacén de este tipo. */
export function dimensionDeAlmacen(tipo: TipoAlmacen): DimensionCiclicoValor {
  return DIMENSION_POR_TIPO[tipo];
}
