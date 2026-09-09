import { describe, expect, it, vi } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { hoyDelNegocio } from '../../comun/fecha-negocio.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  cancelarMovimientoPt,
  consultarExistenciasPt,
  kardexPt,
  registrarMovimientoPt,
  registrarTraspasoPt,
} from './movimientos-pt.js';
import {
  MESES_VENTANA_KARDEX,
  resolverVentanaKardex,
  TOPE_RENGLONES_KARDEX,
} from './periodo-kardex.js';

/**
 * Unit del dominio de Inventario PT (F3-E3) — SIN Postgres. Cubre las reglas PURAS: el guard de
 * permisos (deny-by-default, A4), la validación de captura (Zod) y el rechazo de la dirección
 * `traspaso` como movimiento manual. La integridad transaccional real (no-negativo bajo lock,
 * traspaso atómico, inverso de cancelación, concurrencia, existencia = suma) se prueba contra
 * Postgres en `movimientos-pt.int.test.ts` (CI).
 */

/**
 * Quien captura movimientos de PT. Lleva `ipt.fecha-libre` a propósito (fila 0.171): estas pruebas
 * fechan a mano días concretos de 2026 para medir OTRAS reglas —la dirección `traspaso`, el motivo,
 * la matriz—, y sin la llave el candado de la ventana las cortaría antes de llegar a lo que miden.
 * No es un atajo: los 6 perfiles del seed que pueden mover PT llevan hoy ese permiso.
 * El candado se mide aparte, con {@link sesionSinFechaLibre}.
 */
const sesionMover = () =>
  sesionDePrueba({ permisos: ['inventario-pt.ver', 'inventario-pt.mover', 'ipt.fecha-libre'] });
/** La misma sesión SIN la llave de fecha libre: sólo puede fechar dentro de la ventana. */
const sesionSinFechaLibre = () =>
  sesionDePrueba({ permisos: ['inventario-pt.ver', 'inventario-pt.mover'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['inventario-pt.ver'] });
const sesionSinNada = () => sesionDePrueba({ permisos: [] });

/** Stub de `tx` donde el tipo de movimiento dado es de dirección `traspaso` (para el rechazo). */
function bdTipoTraspaso(): ContextoBd {
  const tx = {
    tipoMovimientoInventario: {
      findUnique: vi.fn(() =>
        Promise.resolve({
          id: 9,
          nombre: 'Transferencia entre almacenes',
          direccion: 'traspaso',
          activo: true,
        }),
      ),
    },
  } as unknown as Tx;
  return { tx };
}

describe('dominio Inventario PT (F3-E3) — permisos (deny-by-default, A4)', () => {
  it('registrar movimiento sin inventario-pt.mover → ErrorPermiso', async () => {
    await expect(
      registrarMovimientoPt(
        sesionSoloVer(),
        {
          idTipoMov: 1,
          idAlmacen: 1,
          idModelo: 1,
          fecha: '2026-06-19',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('traspaso sin inventario-pt.mover → ErrorPermiso', async () => {
    await expect(
      registrarTraspasoPt(
        sesionSoloVer(),
        {
          idAlmacenOrigen: 1,
          idAlmacenDestino: 2,
          idModelo: 1,
          fecha: '2026-06-19',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('cancelar sin inventario-pt.mover → ErrorPermiso', async () => {
    await expect(
      cancelarMovimientoPt(sesionSoloVer(), 1, { motivo: 'error de captura' }, {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('consultar existencias sin inventario-pt.ver → ErrorPermiso', async () => {
    await expect(consultarExistenciasPt(sesionSinNada(), {}, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('kardex sin inventario-pt.ver → ErrorPermiso', async () => {
    await expect(kardexPt(sesionSinNada(), { idModelo: 1 }, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});

describe('dominio Inventario PT (F3-E3) — validación de captura (A1)', () => {
  it('movimiento manual con un tipo de dirección "traspaso" → ErrorValidacion', async () => {
    await expect(
      registrarMovimientoPt(
        sesionMover(),
        {
          idTipoMov: 9, // el stub lo resuelve como dirección "traspaso"
          idAlmacen: 1,
          idModelo: 1,
          fecha: '2026-06-19',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
        },
        bdTipoTraspaso(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('traspaso con origen = destino → ErrorValidacion (no toca BD)', async () => {
    await expect(
      registrarTraspasoPt(
        sesionMover(),
        {
          idAlmacenOrigen: 1,
          idAlmacenDestino: 1, // mismo almacén
          idModelo: 1,
          fecha: '2026-06-19',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('movimiento manual sin renglones → ErrorValidacion (Zod)', async () => {
    await expect(
      registrarMovimientoPt(
        sesionMover(),
        {
          idTipoMov: 1,
          idAlmacen: 1,
          idModelo: 1,
          fecha: '2026-06-19',
          motivo: 'Ajuste de la prueba',
          lineas: [],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('movimiento manual con cantidad negativa → ErrorValidacion (Zod)', async () => {
    await expect(
      registrarMovimientoPt(
        sesionMover(),
        {
          idTipoMov: 1,
          idAlmacen: 1,
          idModelo: 1,
          fecha: '2026-06-19',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: -3 }] }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('movimiento manual con fecha mal formada → ErrorValidacion (Zod)', async () => {
    await expect(
      registrarMovimientoPt(
        sesionMover(),
        {
          idTipoMov: 1,
          idAlmacen: 1,
          idModelo: 1,
          fecha: '19-06-2026',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('kardex sin idModelo → ErrorValidacion (Zod)', async () => {
    await expect(kardexPt(sesionMover(), {} as never, {})).rejects.toBeInstanceOf(ErrorValidacion);
  });

  // §Post-F9.40 — la ORDEN del renglón (de qué producción salen las piezas).
  it('movimiento manual con un idOrden inválido (0/negativo) → ErrorValidacion (Zod)', async () => {
    await expect(
      registrarMovimientoPt(
        sesionMover(),
        {
          idTipoMov: 1,
          idAlmacen: 1,
          idModelo: 1,
          fecha: '2026-08-12',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: 1, idOrden: 0, tallas: [{ idTalla: 1, cantidad: 5 }] }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('traspaso con un idOrden inválido → ErrorValidacion (Zod), sin tocar BD', async () => {
    await expect(
      registrarTraspasoPt(
        sesionMover(),
        {
          idAlmacenOrigen: 1,
          idAlmacenDestino: 2,
          idModelo: 1,
          fecha: '2026-08-12',
          motivo: 'Ajuste de la prueba',
          lineas: [{ idColor: 1, idOrden: -7, tallas: [{ idTalla: 1, cantidad: 5 }] }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

/**
 * `tx` de mentiras que resuelve los tipos de movimiento del traspaso y devuelve, para cada id de
 * almacén, la fila que diga `porAlmacen` (o una de PT usable, si no está en el mapa). Sirve para
 * pinchar el guard de tipo (fila 0.137) SIN Postgres: se corta en la primera lectura de almacén.
 */
function bdConAlmacenes(porAlmacen: Record<number, { nombre: string; tipo: string }>): {
  bd: ContextoBd;
  almacenesLeidos: number[];
} {
  const almacenesLeidos: number[] = [];
  const tx = {
    tipoMovimientoInventario: {
      findUnique: vi.fn(({ where }: { where: { codigo: string } }) =>
        Promise.resolve({
          id: where.codigo === 'transferencia-salida' ? 1 : 2,
          nombre: where.codigo,
          direccion: where.codigo === 'transferencia-salida' ? 'salida' : 'entrada',
          activo: true,
        }),
      ),
    },
    almacen: {
      findUnique: vi.fn(({ where }: { where: { id: number } }) => {
        almacenesLeidos.push(where.id);
        const fila = porAlmacen[where.id] ?? { nombre: `Almacén ${String(where.id)}`, tipo: 'PT' };
        return Promise.resolve({ ...fila, activo: true, idEmpresa: null });
      }),
    },
  } as unknown as Tx;
  return { bd: { tx }, almacenesLeidos };
}

describe('Motivo OBLIGATORIO al mover PT a mano (fila 0.100, §Post-F9.193 decisión 3)', () => {
  // El motivo lo exige el DOMINIO (`validarEntrada` corre AQUÍ, no solo en el Zod de la ruta — A1),
  // así que estas pruebas pasan `{}` como `bd`: revientan ANTES de tocar la base.
  const movimiento = {
    idTipoMov: 1,
    idAlmacen: 1,
    idModelo: 1,
    fecha: '2026-09-04',
    lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
  };
  const traspaso = {
    idAlmacenOrigen: 1,
    idAlmacenDestino: 2,
    idModelo: 1,
    fecha: '2026-09-04',
    lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
  };

  it('un movimiento manual SIN motivo se rechaza', async () => {
    await expect(
      registrarMovimientoPt(sesionMover(), movimiento as never, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  /** Captura el error de una promesa para poder inspeccionar sus `detalles` (patrón de telas). */
  async function errorDe(promesa: Promise<unknown>): Promise<unknown> {
    return promesa.then(
      () => null,
      (e: unknown) => e,
    );
  }

  it('un movimiento manual con motivo DEMASIADO CORTO se rechaza (mínimo 3, como en telas)', async () => {
    // El mensaje LEGIBLE por campo viaja en `detalles.fieldErrors` (formato de `validarEntrada`):
    // el `message` del error es siempre el genérico, así que afirmar sobre él no probaría nada.
    const error = await errorDe(
      registrarMovimientoPt(sesionMover(), { ...movimiento, motivo: 'ab' }, {}),
    );
    expect(error).toBeInstanceOf(ErrorValidacion);
    expect((error as ErrorValidacion).detalles).toMatchObject({
      fieldErrors: { motivo: ['Explica el motivo (mínimo 3 caracteres)'] },
    });
  });

  it('un motivo de PUROS ESPACIOS se rechaza (se recorta antes de medir)', async () => {
    await expect(
      registrarMovimientoPt(sesionMover(), { ...movimiento, motivo: '     ' }, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('un traspaso SIN motivo se rechaza', async () => {
    await expect(registrarTraspasoPt(sesionMover(), traspaso as never, {})).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('un traspaso con motivo DEMASIADO CORTO se rechaza', async () => {
    const error = await errorDe(
      registrarTraspasoPt(sesionMover(), { ...traspaso, motivo: 'ab' }, {}),
    );
    expect(error).toBeInstanceOf(ErrorValidacion);
    expect((error as ErrorValidacion).detalles).toMatchObject({
      fieldErrors: { motivo: ['Explica el motivo (mínimo 3 caracteres)'] },
    });
  });

  it('un motivo de MÁS de 500 caracteres se rechaza', async () => {
    const error = await errorDe(
      registrarMovimientoPt(sesionMover(), { ...movimiento, motivo: 'x'.repeat(501) }, {}),
    );
    expect(error).toBeInstanceOf(ErrorValidacion);
    expect((error as ErrorValidacion).detalles).toMatchObject({
      fieldErrors: { motivo: ['El motivo no puede tener más de 500 caracteres'] },
    });
  });
});

describe('Traspaso de PT — el guard de TIPO cubre LAS DOS patas (fila 0.137)', () => {
  const traspaso = {
    idModelo: 1,
    fecha: '2026-06-20',
    motivo: 'Ajuste de la prueba',
    lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
  };

  it('el ORIGEN de TELA se rechaza', async () => {
    const { bd } = bdConAlmacenes({ 1: { nombre: 'Naucalpan', tipo: 'TELA' } });
    await expect(
      registrarTraspasoPt(
        sesionMover(),
        { ...traspaso, idAlmacenOrigen: 1, idAlmacenDestino: 2 },
        bd,
      ),
    ).rejects.toThrow(/"Naucalpan" es de telas; este movimiento es de producto terminado/);
  });

  it('el DESTINO de TELA se rechaza (el origen sí es de PT)', async () => {
    // Éste es el que se cuela si alguien valida solo el origen: el destino no se lee nunca.
    const { bd, almacenesLeidos } = bdConAlmacenes({ 2: { nombre: 'Naucalpan', tipo: 'TELA' } });
    await expect(
      registrarTraspasoPt(
        sesionMover(),
        { ...traspaso, idAlmacenOrigen: 1, idAlmacenDestino: 2 },
        bd,
      ),
    ).rejects.toThrow(/"Naucalpan" es de telas; este movimiento es de producto terminado/);
    expect(almacenesLeidos).toEqual([1, 2]);
  });
});

/**
 * ⭐ FILA 0.138 — EL PERIODO DEL KARDEX. Aquí se prueba la parte PURA: qué ventana queda cuando el
 * usuario pide una, cuando pide media, y cuando no pide nada. Que el `WHERE` de verdad recorte (y
 * que los bordes se comporten como dice este archivo) se prueba contra Postgres en el `.int.test`.
 *
 * Nació de un defecto medido: sin ventana, el kardex de un modelo con diez años cargados devolvía
 * 25 000 renglones y 8.3 MB en UNA respuesta. La regla que lo evita es la de abajo, y vive en el
 * dominio (A1) — ni la ruta ni la pantalla deciden el periodo.
 */
describe('dominio Inventario PT — el PERIODO del kardex (fila 0.138)', () => {
  /** Un instante cualquiera del 5 de septiembre de 2026, ya de día en México. */
  const cincoDeSeptiembre = new Date('2026-09-05T18:00:00.000Z');

  it('⭐ sin `desde`: la ventana son los últimos 12 meses — el kardex NUNCA arranca sin piso', () => {
    const ventana = resolverVentanaKardex({}, cincoDeSeptiembre);
    expect(ventana.desde).toBe('2025-09-05');
    expect(ventana.porOmision).toBe(true);
    // Sin techo: un movimiento con fecha futura (se capturan con la fecha del documento) sigue saliendo.
    expect(ventana.hasta).toBeNull();
    expect(MESES_VENTANA_KARDEX).toBe(12);
  });

  it('con `desde` explícito, manda el usuario (y deja de ser ventana por omisión)', () => {
    const ventana = resolverVentanaKardex(
      { desde: '2016-01-01', hasta: '2016-12-31' },
      cincoDeSeptiembre,
    );
    expect(ventana).toEqual({ desde: '2016-01-01', hasta: '2016-12-31', porOmision: false });
  });

  it('`hasta` sin `desde`: son los 12 meses que TERMINAN en `hasta`, no «todo hasta esa fecha»', () => {
    // La garantía de piso vale también aquí: pedir solo el techo no puede destapar diez años.
    const ventana = resolverVentanaKardex({ hasta: '2020-03-31' }, cincoDeSeptiembre);
    expect(ventana).toEqual({ desde: '2019-03-31', hasta: '2020-03-31', porOmision: true });
  });

  it('el ancla es el día del NEGOCIO (México), no el del servidor en UTC', () => {
    // 05-sep 03:00 UTC son todavía las 21:00 del 04-sep en Ciudad de México. El servidor corre en
    // UTC; si la ventana se anclara en su día, el periodo se correría 24 h respecto a lo que la
    // gente ve en la pantalla — el mismo desfase que `comun/fecha-negocio` vino a cerrar.
    const ventana = resolverVentanaKardex({}, new Date('2026-09-05T03:00:00.000Z'));
    expect(ventana.desde).toBe('2025-09-04');
  });

  it('un periodo AL REVÉS (desde > hasta) → ErrorValidacion (no se consulta nada)', async () => {
    await expect(
      kardexPt(sesionSoloVer(), { idModelo: 1, desde: '2026-09-01', hasta: '2026-08-01' }, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('una fecha que no es fecha → ErrorValidacion', async () => {
    await expect(
      kardexPt(sesionSoloVer(), { idModelo: 1, desde: '01/09/2026' }, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('el TOPE de renglones no se puede desbordar por parámetro', async () => {
    await expect(
      kardexPt(sesionSoloVer(), { idModelo: 1, limite: TOPE_RENGLONES_KARDEX + 1 }, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    await expect(kardexPt(sesionSoloVer(), { idModelo: 1, limite: 0 }, {})).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⏳ FILA 0.171 (b) — LA FECHA DEL MOVIMIENTO VUELVE A TENER CANDADO
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// En el viejo era el acceso #28 («Poder meter la fecha que sea en los movimientos de almacen de
// PT»). v2 se trajo el permiso `ipt.fecha-libre` al catálogo y NO la guarda: el esquema aceptaba
// cualquier fecha sin mirar nada, y el permiso no tenía un solo llamador. Estas pruebas son la
// guarda; se escribieron viéndolas fallar contra el código de antes.
//
// 🔑 Las fechas se calculan DESDE HOY a propósito. Una constante ('2026-06-19') haría que la prueba
// se pusiera roja sola el día que la ventana la deje atrás — y sobre todo, una prueba de «hace 30
// días» tiene que seguir significando «hace 30 días» dentro de un año.

/**
 * `YYYY-MM-DD` de hace `dias` días (negativo = futuro), contado sobre el calendario **del negocio**
 * —el mismo con el que mide la guarda desde la fila 0.174—.
 *
 * ⚠️ Antes se contaba sobre el día **UTC**, y eso volvía estas pruebas dependientes de LA HORA A LA
 * QUE CORRIERAN: entre las 18:00 y las 23:59 de México el día UTC va uno adelante, así que
 * `fechaHaceDias(0)` devolvía «mañana» y la gemela positiva se ponía roja sin que nada cambiara en
 * el código. Medido: con el reloj anclado a las 19:00 de México, tres pruebas de PT caían.
 */
function fechaHaceDias(dias: number): string {
  const base = Date.parse(`${hoyDelNegocio()}T00:00:00.000Z`);
  return new Date(base - dias * 86_400_000).toISOString().slice(0, 10);
}

/** Movimiento manual válido salvo por la fecha, que la pone quien llama. */
const movimientoEnFecha = (fecha: string) => ({
  idTipoMov: 1,
  idAlmacen: 1,
  idModelo: 1,
  fecha,
  motivo: 'Ajuste de la prueba',
  lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
});

/** Traspaso válido salvo por la fecha. */
const traspasoEnFecha = (fecha: string) => ({
  idAlmacenOrigen: 1,
  idAlmacenDestino: 2,
  idModelo: 1,
  fecha,
  motivo: 'Ajuste de la prueba',
  lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
});

describe('dominio Inventario PT — la fecha LIBRE es un privilegio (fila 0.171, ex acceso #28)', () => {
  it('⭐ SIN `ipt.fecha-libre`, backdatear un movimiento → ErrorPermiso (y NO toca la BD)', async () => {
    // 30 días atrás: muy fuera de la ventana. Que no llegue a la BD lo prueba el `{}` como
    // contexto — cualquier consulta reventaría por otro motivo.
    await expect(
      registrarMovimientoPt(sesionSinFechaLibre(), movimientoEnFecha(fechaHaceDias(30)), {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('⭐ el error NOMBRA el permiso que falta (para que la pantalla pueda decir qué pedir)', async () => {
    await expect(
      registrarMovimientoPt(sesionSinFechaLibre(), movimientoEnFecha(fechaHaceDias(30)), {}),
    ).rejects.toMatchObject({ permiso: 'ipt.fecha-libre' });
  });

  it('SIN el permiso, una fecha FUTURA tampoco pasa (el inventario no se adivina)', async () => {
    await expect(
      registrarMovimientoPt(sesionSinFechaLibre(), movimientoEnFecha(fechaHaceDias(-1)), {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('SIN el permiso, DENTRO de la ventana sí pasa el candado (gemela positiva)', async () => {
    // La guarda no puede estar bloqueando la captura normal. Se mide con el stub del tipo
    // `traspaso`: si el candado deja pasar, la captura llega hasta el rechazo de la dirección
    // (ErrorValidacion). Un ErrorPermiso aquí significaría que la ventana se cerró de más.
    for (const dias of [0, 7]) {
      await expect(
        registrarMovimientoPt(
          sesionSinFechaLibre(),
          movimientoEnFecha(fechaHaceDias(dias)),
          bdTipoTraspaso(),
        ),
        `la fecha de hace ${String(dias)} días está dentro de la ventana y no debería toparse con el permiso`,
      ).rejects.toBeInstanceOf(ErrorValidacion);
    }
  });

  it('CON `ipt.fecha-libre` una fecha de hace un AÑO pasa el candado (el privilegio sirve)', async () => {
    await expect(
      registrarMovimientoPt(sesionMover(), movimientoEnFecha(fechaHaceDias(400)), bdTipoTraspaso()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('⭐ el TRASPASO lleva el mismo candado (son dos movimientos con esa fecha)', async () => {
    // Sin esto, la puerta de al lado quedaba abierta: el traspaso escribe DOS renglones de kardex
    // fechados por quien captura, con el mismo permiso de por medio.
    await expect(
      registrarTraspasoPt(sesionSinFechaLibre(), traspasoEnFecha(fechaHaceDias(30)), {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('el traspaso DENTRO de la ventana pasa el candado (gemela positiva)', async () => {
    // Origen = destino: una regla que se valida DESPUÉS del candado y ANTES de tocar la BD. Si sale
    // ErrorValidacion, el candado dejó pasar la fecha; si saliera ErrorPermiso, se habría cerrado.
    await expect(
      registrarTraspasoPt(
        sesionSinFechaLibre(),
        { ...traspasoEnFecha(fechaHaceDias(1)), idAlmacenDestino: 1 },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
