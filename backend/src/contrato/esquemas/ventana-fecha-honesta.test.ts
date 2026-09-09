import { describe, expect, it } from 'vitest';

import { DIAS_VENTANA_CAPTURA } from '../../comun/fecha-capturable.js';
import {
  registrarMovimientoPt,
  registrarTraspasoPt,
} from '../../dominio/inventarios/movimientos-pt.js';
import { ErrorPermiso } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { esquemaMovimientoPtCrear, esquemaTraspasoPtCrear } from './movimiento-pt.js';

/**
 * ⭐ EL CONTRATO NO PUEDE ANUNCIAR UNA VENTANA QUE EL DOMINIO NO APLICA (fila 0.171).
 *
 * La ventana de captura de fecha del inventario de PT vive en CUATRO sitios: la constante
 * {@link DIAS_VENTANA_CAPTURA} (`comun/fecha-capturable.ts`, la única que MANDA), las DOS
 * descripciones del contrato que la escriben en letra —y que viajan al OpenAPI y de ahí a quien lo
 * lea— y el espejo del frontend (`fecha-captura-pt.ts`, que acota el selector; ése lo cruza
 * `frontend/src/ventana-fecha-pt.test.ts` contra el mismo OpenAPI — vive en la RAÍZ de `src/`, no junto al módulo, porque necesita `node:fs` y el proyecto de la app no trae los tipos de Node a propósito; misma convención que `abreviatura-e2e.test.ts`).
 *
 * 🔴 **Y el número es PROVISIONAL**: 7 es un default propuesto por simetría con Indicadores, a la
 * espera de que Daniel diga cuál es el bueno para el almacén de PT. O sea que el cambio no es
 * hipotético, es lo esperado — y el día que ocurra, sin esta prueba, el OpenAPI seguiría
 * anunciando 7 **sin que nada se ponga rojo**.
 *
 * ⚠️ LO IMPORTANTE ES CÓMO SE COMPARA. La ventana real se **descubre probando el dominio** en vez
 * de afirmarse contra un número escrito aquí: se busca el último día que acepta y el primero que
 * rechaza. Copiar el literal dejaría la prueba pegada al valor viejo justo el día en que tiene que
 * sonar. La técnica se toma de `tope-kardex-honesto.test.ts` (fila 0.138), que cerró el mismo
 * modo de fallo con el tope de renglones del kardex.
 */

/** Sesión que SÍ pasa por el candado: tiene `.mover` pero no la llave de fecha libre. */
const sinLlave = () => sesionDePrueba({ permisos: ['inventario-pt.ver', 'inventario-pt.mover'] });

/** `YYYY-MM-DD` de hace `dias` días, medido en UTC igual que la guarda. */
function fechaHaceDias(dias: number): string {
  const hoy = new Date();
  const base = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return new Date(base - dias * 86_400_000).toISOString().slice(0, 10);
}

/** Captura mínima válida por Zod, fechada hace `dias` días. */
const movimiento = (dias: number) => ({
  idTipoMov: 1,
  idAlmacen: 1,
  idModelo: 1,
  fecha: fechaHaceDias(dias),
  motivo: 'Sonda de la ventana de captura',
  lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 1 }] }],
});

/**
 * ¿El DOMINIO deja pasar el candado con una fecha de hace `dias` días? Se mide por la clase del
 * error: `ErrorPermiso` = lo cortó la ventana. Cualquier otro rechazo (la BD ausente, el tipo
 * inexistente) significa que la fecha pasó y el fallo vino DESPUÉS — que es lo que aquí cuenta
 * como «aceptada». Se pasa `{}` como contexto: no hay Postgres en un unit.
 */
async function laVentanaAcepta(dias: number): Promise<boolean> {
  const error: unknown = await registrarMovimientoPt(sinLlave(), movimiento(dias), {}).then(
    () => null,
    (e: unknown) => e,
  );
  return !(error instanceof ErrorPermiso);
}

/** Lo mismo para el TRASPASO, que lleva el mismo candado con su propio esquema. */
async function laVentanaDelTraspasoAcepta(dias: number): Promise<boolean> {
  const error: unknown = await registrarTraspasoPt(
    sinLlave(),
    {
      idAlmacenOrigen: 1,
      idAlmacenDestino: 2,
      idModelo: 1,
      fecha: fechaHaceDias(dias),
      motivo: 'Sonda de la ventana de captura',
      lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 1 }] }],
    },
    {},
  ).then(
    () => null,
    (e: unknown) => e,
  );
  return !(error instanceof ErrorPermiso);
}

/** El último día hacia atrás que el dominio acepta. Busca hasta muy lejos para delatar «sin tope». */
async function ventanaReal(acepta: (dias: number) => Promise<boolean>): Promise<number> {
  const TOPE_BUSQUEDA = 400;
  for (let dias = 0; dias <= TOPE_BUSQUEDA; dias += 1) {
    if (!(await acepta(dias))) return dias - 1;
  }
  return TOPE_BUSQUEDA;
}

describe('la ventana de captura de fecha de PT no se anuncia distinta de como se aplica', () => {
  it('⭐ la ventana que APLICA el dominio es la constante compartida (ancla el número UNA vez)', async () => {
    expect(await ventanaReal(laVentanaAcepta)).toBe(DIAS_VENTANA_CAPTURA);
  });

  it('⭐ el traspaso aplica EXACTAMENTE la misma ventana que el movimiento manual', async () => {
    // Si alguien le pusiera su propio número a una de las dos pantallas, el usuario vería dos
    // reglas para el mismo dato — y una de las dos descripciones del contrato mentiría.
    expect(await ventanaReal(laVentanaDelTraspasoAcepta)).toBe(DIAS_VENTANA_CAPTURA);
  });

  it('⭐ la DESCRIPCIÓN publicada del movimiento no puede quedarse en el número viejo', () => {
    // El texto viaja al OpenAPI: si dice «7 días» cuando la ventana ya es otra, miente igual que un
    // `.max()` desalineado, y en silencio.
    const descripcion = esquemaMovimientoPtCrear.shape.fecha.description ?? '';
    expect(descripcion).toContain(`${String(DIAS_VENTANA_CAPTURA)} días`);
  });

  it('⭐ y la del TRASPASO tampoco (es el otro sitio donde el número está escrito en letra)', () => {
    const descripcion = esquemaTraspasoPtCrear.shape.fecha.description ?? '';
    expect(descripcion).toContain(`${String(DIAS_VENTANA_CAPTURA)} días`);
  });

  it('la ventana la fija el DOMINIO, no el contrato (A1): el esquema acepta cualquier fecha', () => {
    // Si el contrato le pusiera su propio recorte de fechas habría dos reglas, y ganaría la de la
    // ruta en silencio. El esquema sólo exige que sea una fecha; quién puede fecharla, el dominio.
    expect(esquemaMovimientoPtCrear.safeParse(movimiento(3650)).success).toBe(true);
  });
});
