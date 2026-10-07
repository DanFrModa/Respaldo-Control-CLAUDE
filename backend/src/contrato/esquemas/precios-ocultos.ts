import { z } from 'zod';

/**
 * ⭐ Fila 0.249 parte B — la marca de PRECIOS TAPADOS. Viaja en cada objeto que trae precio porque
 * un precio escalar `null` no distingue «no te toca verlo» de «no tiene precio capturado». Con
 * `true` la pantalla pinta «—» y el formulario NO manda el precio al guardar (mandar `null` lo
 * borraría). Quién ve los precios lo decide el dominio (`catalogos/precios-de-catalogo.ts`).
 */
export const esquemaPreciosOcultos = z
  .boolean()
  .describe(
    '¿El servidor TAPÓ los precios de este objeto para esta sesión? (fila 0.249 parte B). true = ' +
      'los precios van null porque no te toca verlos; false = un precio null es «no tiene».',
  );
