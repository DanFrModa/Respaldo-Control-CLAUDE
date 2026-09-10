import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { completarProceso, DIAS_VENTANA_CAPTURA_RC } from './cumplimiento.js';

/**
 * ⭐ LA VENTANA DE CAPTURA DE LA FECHA REAL DE CUMPLIMIENTO (fila 0.175) — SIN Postgres.
 *
 * `RutaOrden.fechaReal` es **la base del KPI de puntualidad (D11)**: de ella sale si un proceso
 * salió a tiempo o tarde. Hasta esta fila llegaba del cliente **sin una sola validación** —ni
 * ventana, ni «nunca el futuro», ni permiso— mientras `rc.fecha-libre-cumplimiento` llevaba
 * sembrado desde F5 en ocho perfiles sin un solo llamador. Estas pruebas son la puerta que le
 * faltaba a esa llave.
 *
 * ## Cómo miden sin base de datos
 *
 * La guarda corre ANTES de `enTransaccion` (mismo orden que `registrarMovimientoPt` en PT), así que
 * las dos mitades se distinguen por **hasta dónde llega la llamada**:
 *
 *  • **rechazada por la ventana** → `ErrorPermiso` y el `tx` de mentiras **no se toca** (se afirma
 *    con el espía: cero lecturas).
 *  • **admitida por la ventana** → sigue de largo, hace la primera lectura y muere en
 *    `ErrorNoEncontrado` porque el renglón no existe. *Que llegue a leer ES la prueba de que pasó.*
 *
 * ⚠️ **El reloj va anclado, y en las dos franjas del día.** La ventana se mide contra el día del
 * NEGOCIO (México, −06:00), no contra el día UTC en que corre el servidor: entre las 18:00 y las
 * 23:59 de allá el día UTC ya avanzó. Una prueba de fechas que tomara la hora real pasaría por la
 * mañana y fallaría por la tarde, que es peor que no tenerla. Es la cicatriz de la fila 0.174 y aquí
 * aplica igual, porque el `hoyUtc()` local de este módulo —que fechaba el default y el
 * auto-completado por checklist— era uno de los cuatro huecos que aquella fila dejó declarados.
 */

/** El día que vive el negocio en los DOS anclajes de abajo. */
const HOY_EN_MEXICO = '2026-09-09';

/** Los dos anclajes: mediodía de México (día UTC = día del negocio) y 19:00 (día UTC adelantado). */
const ANCLAJES: readonly { nombre: string; instante: string }[] = [
  {
    nombre: 'a mediodía de México (el día UTC y el del negocio coinciden)',
    instante: `${HOY_EN_MEXICO}T18:00:00.000Z`,
  },
  {
    nombre: 'a las 19:00 de México (en UTC ya es el día siguiente)',
    instante: '2026-09-10T01:00:00.000Z',
  },
];

/** `Date` a medianoche UTC, `dias` días antes de {@link HOY_EN_MEXICO} (negativo = futuro). */
function diaDelNegocio(dias: number): Date {
  return new Date(Date.parse(`${HOY_EN_MEXICO}T00:00:00.000Z`) - dias * 86_400_000);
}

/** Quien captura, SIN la llave de fecha libre: se topa con la ventana. */
const sinLlave = () => sesionDePrueba({ permisos: ['rc.capturar'] });
/** La misma sesión CON la llave: la ventana no le aplica. */
const conLlave = () => sesionDePrueba({ permisos: ['rc.capturar', 'rc.fecha-libre-cumplimiento'] });

/**
 * `tx` de mentiras cuya única lectura (`rutaOrden.findFirst`) devuelve `null` → `ErrorNoEncontrado`.
 * El espía es el testigo: si tiene llamadas, la ventana dejó pasar la fecha; si no, la cortó antes.
 */
function bdEspia(): { bd: ContextoBd; leyoLaBase: () => boolean } {
  const findFirst = vi.fn(() => Promise.resolve(null));
  const tx = { rutaOrden: { findFirst } } as unknown as Tx;
  return { bd: { tx }, leyoLaBase: () => findFirst.mock.calls.length > 0 };
}

describe.each(ANCLAJES)('la ventana de captura del cumplimiento $nombre', ({ instante }) => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instante));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('⭐ una fecha más vieja que la ventana se rechaza, SIN llegar a la base', async () => {
    const { bd, leyoLaBase } = bdEspia();
    await expect(
      completarProceso(sinLlave(), 1, diaDelNegocio(DIAS_VENTANA_CAPTURA_RC + 1), bd),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(leyoLaBase(), 'la guarda debe cortar antes de abrir la transacción').toBe(false);
  });

  it('⭐ el error nombra el permiso de la RC, no el de otro módulo', async () => {
    // La prueba que caza el copy-paste: este molde se estrenó en el inventario de PT, y traerse
    // `ipt.fecha-libre` pegado dejaría la puerta pidiendo la llave de otra casa. Ya pasó una vez.
    const { bd } = bdEspia();
    await expect(
      completarProceso(sinLlave(), 1, diaDelNegocio(DIAS_VENTANA_CAPTURA_RC + 1), bd),
    ).rejects.toMatchObject({ permiso: 'rc.fecha-libre-cumplimiento' });
  });

  it('⭐ con la llave, esa MISMA fecha pasa (llega a leer la base)', async () => {
    const { bd, leyoLaBase } = bdEspia();
    await expect(
      completarProceso(conLlave(), 1, diaDelNegocio(DIAS_VENTANA_CAPTURA_RC + 1), bd),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(leyoLaBase(), 'con la llave la ventana no aplica: debe seguir de largo').toBe(true);
  });

  it('⭐ MAÑANA no se puede fechar: un cumplimiento futuro envenenaría el KPI de D11', async () => {
    // Regla NUEVA respecto al Access: aquel `RC_MeterDatosDet` sólo miraba el retraso y aceptaba
    // una fecha futura sin chistar.
    const { bd } = bdEspia();
    await expect(completarProceso(sinLlave(), 1, diaDelNegocio(-1), bd)).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('HOY (día del negocio) se puede fechar sin la llave', async () => {
    const { bd, leyoLaBase } = bdEspia();
    await expect(completarProceso(sinLlave(), 1, diaDelNegocio(0), bd)).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
    expect(leyoLaBase()).toBe(true);
  });

  it('sin fecha, el default del servidor siempre cabe en la ventana', async () => {
    // Si el default se anclara en el día UTC (como hasta esta fila), en la franja de las 19:00
    // sería MAÑANA en México y la guarda rechazaría su propia fecha por defecto.
    const { bd, leyoLaBase } = bdEspia();
    await expect(completarProceso(sinLlave(), 1, undefined, bd)).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
    expect(leyoLaBase()).toBe(true);
  });

  it('⭐ el borde: el día N todavía entra y el N+1 ya no', async () => {
    const dentro = bdEspia();
    await expect(
      completarProceso(sinLlave(), 1, diaDelNegocio(DIAS_VENTANA_CAPTURA_RC), dentro.bd),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(dentro.leyoLaBase()).toBe(true);

    const fuera = bdEspia();
    await expect(
      completarProceso(sinLlave(), 1, diaDelNegocio(DIAS_VENTANA_CAPTURA_RC + 1), fuera.bd),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(fuera.leyoLaBase()).toBe(false);
  });
});

describe('el número de la ventana', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(ANCLAJES[0]?.instante ?? ''));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * 📌 Fija el número EN DÍAS CONCRETOS, no contra la constante: si sólo se midiera con
   * `DIAS_VENTANA_CAPTURA_RC`, cambiar la constante movería la prueba con ella y el cambio pasaría
   * en verde. Aquí mover la ventana **cuesta venir a escribirlo**, que es lo que se quiere: el 2
   * sale del Access (`RC_MeterDatosDet`: `If FechaReal + 2 < QueFechaHoy`) y **la ventana definitiva
   * la contesta Daniel** — mientras no conteste, cambiarla no debe poder colarse sin que se note.
   */
  it('⭐ son 2 días: el 7-sep entra y el 6-sep ya no (hoy del negocio = 9-sep)', async () => {
    const dentro = bdEspia();
    await expect(
      completarProceso(sinLlave(), 1, new Date('2026-09-07T00:00:00.000Z'), dentro.bd),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);

    const fuera = bdEspia();
    await expect(
      completarProceso(sinLlave(), 1, new Date('2026-09-06T00:00:00.000Z'), fuera.bd),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('la constante dice el mismo número que se acaba de medir', () => {
    expect(DIAS_VENTANA_CAPTURA_RC).toBe(2);
  });
});
