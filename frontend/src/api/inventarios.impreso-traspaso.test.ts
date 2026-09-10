import { describe, expect, it } from 'vitest';

import { urlImpresoTraspasoPt } from './inventarios';

import type { paths } from './esquema.gen';

/**
 * A QUÉ RUTA APUNTA la hoja del traspaso de PT (fila 0.100, §Post-F9.193 decisión 2).
 *
 * ⚠️ POR QUÉ ESTA PRUEBA EXISTE APARTE: los dos tests de pantalla que usan el helper
 * (`TraspasosPtPagina` y `KardexPtPagina`) mockean `@/api/inventarios` entero, así que la URL que
 * afirman es la que ellos mismos escribieron en el mock. Con eso, apuntar el helper REAL a otra
 * ruta los dejaba a los dos en VERDE. Aquí no hay mock: se importa el helper de verdad.
 *
 * Y el literal no se copia a mano: sale de la clave del CONTRATO (`satisfies keyof paths`), así que
 * si el backend renombra o retira la ruta esto deja de COMPILAR — antes de llegar a fallar en vivo.
 *
 * La confusión que se está evitando es concreta: la hoja de TELA tiene su propia ruta gemela, a un
 * `pt`/`telas` de distancia, y también existe. Apuntar a la equivocada no da 404: da el papel de
 * otro almacén.
 */

/** La hoja de traspaso de PRODUCTO TERMINADO, tal cual la declara el contrato. */
const RUTA_PT = '/api/inventarios/pt/traspasos/{id}/impreso' satisfies keyof paths;
/** Su gemela de TELA (§Post-F9.38): existe de verdad, por eso confundirlas es fácil. */
const RUTA_TELA = '/api/inventarios/telas/traspasos/{id}/impreso' satisfies keyof paths;

/** La ruta del contrato con el `{id}` ya sustituido. */
function conId(plantilla: string, id: number): string {
  return plantilla.replace('{id}', String(id));
}

describe('urlImpresoTraspasoPt · fila 0.100 (la hoja del traspaso de PT)', () => {
  it('⭐ apunta a la ruta de PT del contrato, con el id del movimiento sustituido', () => {
    expect(urlImpresoTraspasoPt(200)).toBe(conId(RUTA_PT, 200));
    // Y el id que viaja es el que se pidió, no uno fijo del helper.
    expect(urlImpresoTraspasoPt(9911)).toBe(conId(RUTA_PT, 9911));
  });

  it('NO es la hoja de TELA (la gemela que sí existe y sí respondería)', () => {
    expect(urlImpresoTraspasoPt(200)).not.toBe(conId(RUTA_TELA, 200));
    expect(urlImpresoTraspasoPt(200)).not.toContain('/telas/');
  });
});
