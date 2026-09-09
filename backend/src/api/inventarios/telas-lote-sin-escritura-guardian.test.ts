/**
 * ⭐ **EL GUARDIÁN DE LA PUERTA VIEJA DE TELA** (fila 0.170).
 *
 * El inventario de telas se rehízo POR COLOR. El flujo viejo iba POR LOTE y grababa renglones **sin
 * `idTelaColor`**; la vista `existencia_tela_color` —la que alimenta la pantalla de existencias que
 * se mira hoy— **excluye** esas filas. Consecuencia: sacar tela por una puerta del flujo viejo
 * **descontaba existencia que la pantalla vigente nunca veía moverse**. No es un desajuste de datos:
 * las dos vistas son incompatibles por construcción.
 *
 * 🔴 **Y el defecto iba por su TERCERA aparición cuando se cerró.** Las pantallas del flujo por lote
 * se fueron retirando de una en una —el AJUSTE el 13-ago-2026, el TRASPASO en la fila 0.098— pero
 * **sus endpoints se quedaron vivos** cada vez, alcanzables con el `inventario-telas.mover` que
 * tienen seis perfiles. La tercera, «Salida a orden por lote (legado)», siguió capturando desde ⌘K
 * hasta la 0.170. El patrón es siempre el mismo: *se retira la pantalla y se olvida la ruta*.
 *
 * ⇒ **Esta prueba existe para que la cuarta vez se ponga ROJA.** Sin ella, volver a exponer
 * cualquiera de las tres rutas no rompe nada: ningún otro test del backend las nombra, ninguno
 * enumera la tabla de rutas, y el `git diff --exit-code` que el CI hace sobre `openapi.json` es de
 * **frescura, no de ausencia** (quien añada una ruta Y regenere el contrato lo deja verde).
 *
 * ## Por qué mide el CONTRATO GENERADO y no el archivo de rutas
 *
 * `openapi.json` es el inventario de TODO lo que el servidor expone, lo registre el archivo que lo
 * registre: si mañana alguien revive `POST /inventarios/telas/ajustes` desde otro plugin, aquí sale
 * igual. Un `grep` sobre `telas.rutas.ts` sólo vigilaría ese archivo.
 *
 * 🔑 **Y el par cubre las dos formas de reabrirlo**, que es lo que hace que la red no tenga hueco:
 *  • Reabre la ruta **y regenera** el contrato → esta prueba se pone roja.
 *  • Reabre la ruta y **NO regenera** → el contrato queda obsoleto y lo caza el `git diff` del CI.
 *
 * ⚠️ **Lo que esta prueba NO dice:** que las funciones del dominio estén borradas. No lo están, a
 * propósito (`dominio/inventarios/telas.ts`): son el andamio con el que las pruebas de integración
 * fabrican movimientos con la forma LEGADA —la misma que dejó el ETL de Access— para comprobar que
 * el flujo por color los tolera sin contaminarse. Lo que se cerró es la **exposición**: sin ruta,
 * ningún cliente las alcanza. Esta prueba vigila exactamente eso y nada más.
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** Raíz de `backend/` (este archivo vive en `src/api/inventarios/`). */
const RAIZ_BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Las tres puertas de ESCRITURA del flujo por lote, con el método que las abría. Cada una escribía
 * `MovimientoDetTela` sin color; ninguna puede volver a existir.
 */
const PUERTAS_CERRADAS = [
  { metodo: 'post', ruta: '/api/inventarios/telas/ajustes', que: 'ajuste (retirado 13-ago-2026)' },
  {
    metodo: 'post',
    ruta: '/api/inventarios/telas/salidas-orden',
    que: 'salida a orden (retirada en la fila 0.170)',
  },
  {
    metodo: 'post',
    ruta: '/api/inventarios/telas/traspasos',
    que: 'traspaso (retirado en la fila 0.098)',
  },
] as const;

/**
 * Las que SÍ siguen vivas del flujo por lote, y por qué. Van aquí para que la prueba mida
 * *ausencia de escritura*, no *ausencia de todo*: si alguien borrara de más, esto se pone rojo
 * igual. Las dos consultas son la ventana al histórico migrado de Access; la cancelación es el
 * botón del kardex y además NO es sólo del legado (acepta cualquier movimiento con renglones de
 * tela, los del flujo por color incluidos — por eso conserva las guardas de la 0.099/0.104).
 */
const PUERTAS_VIVAS = [
  { metodo: 'get', ruta: '/api/inventarios/telas/existencias' },
  { metodo: 'get', ruta: '/api/inventarios/telas/kardex' },
  { metodo: 'post', ruta: '/api/inventarios/telas/movimientos/{id}/cancelar' },
] as const;

interface ContratoOpenApi {
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

function leerContrato(): ContratoOpenApi {
  const crudo = readFileSync(path.join(RAIZ_BACKEND, 'openapi.json'), 'utf8');
  return JSON.parse(crudo) as ContratoOpenApi;
}

describe('🔒 el flujo de telas POR LOTE no puede volver a ESCRIBIR (fila 0.170)', () => {
  const contrato = leerContrato();

  it('el contrato se lee y trae rutas (si esto falla, el resto no mide nada)', () => {
    expect(Object.keys(contrato.paths).length).toBeGreaterThan(100);
  });

  it.each(PUERTAS_CERRADAS)(
    'NO expone $metodo $ruta — $que',
    ({ metodo, ruta }: { readonly metodo: string; readonly ruta: string }) => {
      const operaciones = contrato.paths[ruta];
      expect(
        operaciones?.[metodo],
        `${metodo.toUpperCase()} ${ruta} volvió a existir. Esa puerta escribe tela SIN color y la ` +
          'pantalla de existencias vigente NO la enseña: descontaría existencia que nadie ve ' +
          'moverse. Lo que captura tela es el flujo por COLOR (`/api/inventarios/telas/color/*`). ' +
          'Si de verdad hay que reabrirla, hay que resolver antes el color — no quitar esta prueba.',
      ).toBeUndefined();
    },
  );

  it.each(PUERTAS_VIVAS)(
    'SIGUE exponiendo $metodo $ruta (consulta del histórico / cancelación)',
    ({ metodo, ruta }: { readonly metodo: string; readonly ruta: string }) => {
      expect(
        contrato.paths[ruta]?.[metodo],
        `${metodo.toUpperCase()} ${ruta} desapareció. El flujo por lote se cerró para ESCRIBIR, no ` +
          'para leerse: sin esto, el histórico migrado de Access se queda sin ventana.',
      ).toBeDefined();
    },
  );

  it('ninguna ruta de telas FUERA de `/color/` acepta POST, salvo la cancelación', () => {
    // La red ancha: no depende de acertar el nombre de la puerta nueva. Cualquier POST que alguien
    // cuelgue de `/api/inventarios/telas/*` sin pasar por `/color/` cae aquí.
    const escritoresSinColor = Object.entries(contrato.paths)
      .filter(([ruta]) => ruta.startsWith('/api/inventarios/telas/'))
      .filter(([ruta]) => !ruta.startsWith('/api/inventarios/telas/color/'))
      // Las ENTRADAS por factura/remisión (B1) sí escriben, y escriben CON color: crean partidas
      // sobre `TelaColor`. No son el flujo por lote.
      .filter(([ruta]) => !ruta.startsWith('/api/inventarios/telas/entradas'))
      .filter(([, ops]) => Object.keys(ops).includes('post'))
      .map(([ruta]) => ruta)
      .sort();

    expect(escritoresSinColor).toEqual(['/api/inventarios/telas/movimientos/{id}/cancelar']);
  });
});
