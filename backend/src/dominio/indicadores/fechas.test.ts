import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { DIAS_VENTANA_CAPTURA } from '../../comun/fecha-capturable.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { fechaAUtc, verificarFechaCapturable } from './fechas.js';
import { verificarFichaOrden } from './fichas.js';
import { crearMuestrario, entregarMuestrario } from './muestrarios.js';
import { registrarProductividad } from './productividad.js';

/**
 * ⭐ LA VENTANA DE CAPTURA DE INDICADORES, MEDIDA POR FIN (fila 0.174, pieza (b)).
 *
 * La regla —*sin la llave `indicadores.fecha-libre`, sólo los últimos N días y NUNCA el futuro*—
 * existe desde F7-E4 y hasta hoy **no tenía una sola prueba**. No es una sospecha: se midió con dos
 * mutaciones sobre el suite unitario completo, antes de escribir este archivo.
 *
 *  • Quitar el tope de la ventana (`dias > ventana`) en `comun/fecha-capturable.ts` dejaba
 *    **5 pruebas rojas, TODAS de producto terminado** (`movimientos-pt.test.ts`,
 *    `ventana-fecha-honesta.test.ts`). De Indicadores, cero: sus cuatro capturas seguían en verde
 *    aceptando cualquier fecha vieja.
 *  • Subir la constante de 7 a 10 dejaba **2 rojas, también de PT** (las descripciones publicadas
 *    del contrato, que escriben el número en letra). La ventana de Indicadores cambiaba en
 *    silencio, sin que nada la nombrara.
 *
 * O sea: la mitad del sistema que estrenó la regla era la que no la medía. Este archivo es esa red.
 *
 * ## Por qué el reloj va ANCLADO
 *
 * Se está midiendo una ventana que se calcula contra «hoy», y esta fila cambia justamente el huso
 * de ese «hoy». Una prueba que tome la hora real pasaría por la mañana y podría fallar por la
 * noche —o al revés—, que es peor que no tenerla. Así que el reloj se fija con `vi.setSystemTime`
 * y **las fechas de la prueba son literales**, no se recalculan con la misma aritmética que se está
 * midiendo. Sólo se falsea `Date` (`toFake: ['Date']`) para no congelar los temporizadores que usa
 * el código asíncrono.
 *
 * ## Qué se mide de cada llamador, y por qué así
 *
 * Los cuatro sitios donde Indicadores fecha un acto (`fichas.ts`, `muestrarios.ts` ×2,
 * `productividad.ts`) llaman a la guarda justo ANTES de abrir la transacción. Cada uno se mide con
 * un par: fuera de la ventana tiene que salir `ErrorPermiso`, y **dentro** tiene que llegar hasta
 * el rechazo SIGUIENTE —otro error, de otra clase— porque un `ErrorPermiso` ahí significaría que la
 * ventana se cerró de más. Sin la gemela positiva, una guarda que rechazara TODO también pasaría.
 */

/** El día del negocio en los dos anclajes de este archivo (miércoles cualquiera). */
const HOY = '2026-09-09';

/**
 * Mediodía en México. El día UTC y el día del negocio COINCIDEN, así que estas pruebas miden la
 * ventana y nada más: valen igual antes y después del cambio de huso de la pieza (a).
 */
const MEDIODIA_EN_MEXICO = '2026-09-09T18:00:00.000Z';

/** `YYYY-MM-DD` a `dias` días de {@link HOY} hacia atrás (negativo = futuro). */
function dia(dias: number): string {
  return new Date(Date.parse(`${HOY}T00:00:00.000Z`) - dias * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Sesión SIN la llave de fecha libre: la que se topa con la ventana. */
const sinLlave = (permisos: ClavePermiso[] = []) => sesionDePrueba({ permisos });

const CAPTURA_FICHAS: ClavePermiso[] = ['indicadores.ip-confiabilidad'];
const CAPTURA_MUESTRARIOS: ClavePermiso[] = ['indicadores.ip-muestrarios'];

/** Un `tx` de mentira: la tabla que consulta el llamador justo después de la guarda no trae nada. */
function bdVacia(tabla: 'cliente' | 'muestrario' | 'actividadProductividad'): ContextoBd {
  return {
    tx: {
      [tabla]: { findUnique: vi.fn(() => Promise.resolve(null)) },
    } as unknown as Tx,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(MEDIODIA_EN_MEXICO));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Indicadores — la fecha LIBRE es un privilegio (F7-E4, anclado en la fila 0.174)', () => {
  const sesion = () => sinLlave(CAPTURA_FICHAS);

  it('⭐ HOY pasa (el borde de adentro: la captura normal no se puede estar bloqueando)', () => {
    expect(() => {
      verificarFechaCapturable(sesion(), fechaAUtc(dia(0)));
    }).not.toThrow();
  });

  it('⭐ EXACTAMENTE los días de la ventana pasan (el último día de adentro)', () => {
    expect(() => {
      verificarFechaCapturable(sesion(), fechaAUtc(dia(DIAS_VENTANA_CAPTURA)));
    }).not.toThrow();
  });

  it('⭐ un día MÁS atrás ya NO pasa (el primer día de afuera)', () => {
    expect(() => {
      verificarFechaCapturable(sesion(), fechaAUtc(dia(DIAS_VENTANA_CAPTURA + 1)));
    }).toThrow(ErrorPermiso);
  });

  it('⭐ el error NOMBRA `indicadores.fecha-libre` (la pantalla tiene que poder decir qué falta)', () => {
    expect(() => {
      verificarFechaCapturable(sesion(), fechaAUtc(dia(30)));
    }).toThrow(expect.objectContaining({ permiso: 'indicadores.fecha-libre' }));
  });

  it('⭐ MAÑANA no pasa: un indicador no se captura antes de que ocurra', () => {
    expect(() => {
      verificarFechaCapturable(sesion(), fechaAUtc(dia(-1)));
    }).toThrow(ErrorPermiso);
  });

  it('CON la llave, una fecha de hace un AÑO pasa (el privilegio sirve para algo)', () => {
    const conLlave = sinLlave(['indicadores.ip-confiabilidad', 'indicadores.fecha-libre']);
    expect(() => {
      verificarFechaCapturable(conLlave, fechaAUtc(dia(365)));
    }).not.toThrow();
    expect(() => {
      verificarFechaCapturable(conLlave, fechaAUtc(dia(-365)));
    }).not.toThrow();
  });
});

describe('Indicadores — los CUATRO llamadores aplican la ventana de verdad (fila 0.174)', () => {
  // ── 1/4 · fichas confiables ────────────────────────────────────────────────────────────────
  //
  // El par positivo se apoya en la regla que viene JUSTO después de la guarda y que no toca la BD:
  // un reactivo repetido en la misma captura es `ErrorConflicto`. Por eso el contexto es `{}`.
  const fichaConItemsRepetidos = (fecha: string) => ({
    fecha,
    items: [
      { idReactivo: 1, hecho: true },
      { idReactivo: 1, hecho: false },
    ],
  });

  it('⭐ verificarFichaOrden: FUERA de la ventana → ErrorPermiso (y no llega a la BD)', async () => {
    await expect(
      verificarFichaOrden(sinLlave(CAPTURA_FICHAS), 1, fichaConItemsRepetidos(dia(30)), {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('verificarFichaOrden: DENTRO de la ventana pasa el candado (gemela positiva)', async () => {
    await expect(
      verificarFichaOrden(
        sinLlave(CAPTURA_FICHAS),
        1,
        fichaConItemsRepetidos(dia(DIAS_VENTANA_CAPTURA)),
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  // ── 2/4 · muestrario solicitado ────────────────────────────────────────────────────────────
  const muestrarioEnFecha = (fechaSolicitado: string) => ({
    idCliente: 1,
    cantBoards: 1,
    cantMuestras: 1,
    fechaSolicitado,
    fechaRequerida: dia(-30),
  });

  it('⭐ crearMuestrario: FUERA de la ventana → ErrorPermiso', async () => {
    await expect(
      crearMuestrario(sinLlave(CAPTURA_MUESTRARIOS), muestrarioEnFecha(dia(30)), {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('crearMuestrario: DENTRO de la ventana pasa el candado (gemela positiva)', async () => {
    // Pasado el candado, lo siguiente que hace es exigir el cliente: con el `tx` vacío eso es
    // `ErrorNoEncontrado`. Un `ErrorPermiso` aquí sería la ventana cerrándose de más.
    await expect(
      crearMuestrario(
        sinLlave(CAPTURA_MUESTRARIOS),
        muestrarioEnFecha(dia(DIAS_VENTANA_CAPTURA)),
        bdVacia('cliente'),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('crearMuestrario: una fecha de solicitud FUTURA tampoco pasa', async () => {
    await expect(
      crearMuestrario(sinLlave(CAPTURA_MUESTRARIOS), muestrarioEnFecha(dia(-1)), {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  // ── 3/4 · muestrario entregado ─────────────────────────────────────────────────────────────
  it('⭐ entregarMuestrario: FUERA de la ventana → ErrorPermiso', async () => {
    await expect(
      entregarMuestrario(sinLlave(CAPTURA_MUESTRARIOS), 1, { fechaEntregado: dia(30) }, {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('entregarMuestrario: DENTRO de la ventana pasa el candado (gemela positiva)', async () => {
    await expect(
      entregarMuestrario(
        sinLlave(CAPTURA_MUESTRARIOS),
        1,
        { fechaEntregado: dia(DIAS_VENTANA_CAPTURA) },
        bdVacia('muestrario'),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  // ── 4/4 · productividad del día ────────────────────────────────────────────────────────────
  //
  // ⚠️ Aquí la fecha es OBLIGATORIA y la guarda corre ANTES de cualquier verificación de permiso
  // de captura (el área la determina la actividad, que se lee dentro de la transacción). Por eso
  // la sesión va sin permisos: lo que se mide es la ventana, y es lo primero que se topa.
  const registroEnFecha = (fecha: string) => ({
    fecha,
    idActividad: 1,
    cantidad: 10,
    horasTrabajadas: 8,
    personas: 1,
  });

  it('⭐ registrarProductividad: FUERA de la ventana → ErrorPermiso', async () => {
    await expect(
      registrarProductividad(sinLlave(), registroEnFecha(dia(30)), {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('registrarProductividad: DENTRO de la ventana pasa el candado (gemela positiva)', async () => {
    await expect(
      registrarProductividad(
        sinLlave(),
        registroEnFecha(dia(DIAS_VENTANA_CAPTURA)),
        bdVacia('actividadProductividad'),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('registrarProductividad: una fecha FUTURA tampoco pasa', async () => {
    await expect(
      registrarProductividad(sinLlave(), registroEnFecha(dia(-1)), {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});
