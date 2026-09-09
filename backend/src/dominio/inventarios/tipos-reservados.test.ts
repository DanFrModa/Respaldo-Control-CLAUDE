import { describe, expect, it, vi } from 'vitest';

import { ErrorValidacion } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import { TIPOS_MOVIMIENTO_A_SEMBRAR } from '../../../prisma/seed.js';
import { CODIGOS_TIPO_RESERVADOS } from './salida-sin-orden.js';
import {
  CODIGOS_TIPO_DEL_SISTEMA,
  QUIEN_ESCRIBE_TIPO_DEL_SISTEMA,
  motivoReservaTipo,
  rechazarTipoReservado,
  tipoEsCapturableAMano,
} from './tipos-reservados.js';

/**
 * ⛔ FILA 0.171 (a) — QUÉ RÓTULO PUEDE ESCRIBIR UNA PERSONA A MANO EN EL KARDEX. Unit, SIN Postgres.
 *
 * El kardex ES el inventario (D3), y de cada movimiento sólo se lee el NOMBRE de su tipo: el rótulo
 * es la afirmación de qué pasó. Estas pruebas fijan que las DOS reservas se mantengan distintas
 * —los que sí captura la dirección por su pantalla, y los que no captura NADIE porque los escribe
 * el sistema— y que el rechazo del servidor exista de verdad, no sólo el filtro de la pantalla.
 *
 * Lo que necesita una base de datos —que el ajuste de tela, el de avíos, el legado por lote y el
 * movimiento manual de PT no escriban NADA al intentarlo— se mide en `salida-sin-orden.int.test.ts`
 * y en `movimientos-pt.int.test.ts`.
 */

/** `tx` que resuelve `idTipoMov` a un tipo con este código (lo único que mira la guarda). */
function txConTipo(codigo: string, nombre: string): Tx {
  return {
    tipoMovimientoInventario: { findUnique: vi.fn(() => Promise.resolve({ codigo, nombre })) },
  } as unknown as Tx;
}

/** `tx` donde el id no existe (el catálogo no lo tiene). */
function txSinTipo(): Tx {
  return {
    tipoMovimientoInventario: { findUnique: vi.fn(() => Promise.resolve(null)) },
  } as unknown as Tx;
}

describe('las DOS reservas son conceptos DISTINTOS y no se mezclan', () => {
  it('⭐ ningún código está en las dos listas a la vez', () => {
    // Si se cruzaran, el mensaje del rechazo mentiría: diría «lo autoriza la dirección» de algo que
    // no autoriza nadie, o al revés. Y peor: darle a alguien el permiso de la 0.104 le abriría de
    // paso los rótulos que sólo escribe el sistema.
    const enLasDos = [...CODIGOS_TIPO_DEL_SISTEMA].filter((c) => CODIGOS_TIPO_RESERVADOS.has(c));
    expect(enLasDos, `estos códigos están reservados dos veces: ${enLasDos.join(', ')}`).toEqual(
      [],
    );
  });

  it('la reserva de la DIRECCIÓN sigue teniendo exactamente sus dos rótulos (0.104)', () => {
    // Esta fila NO puede engordar la lista de la 0.104: los suyos SÍ se capturan, por una puerta.
    expect([...CODIGOS_TIPO_RESERVADOS].sort()).toEqual(['devolucion-proveedor', 'venta-material']);
  });

  it('la reserva del SISTEMA son los DOCE rótulos que sólo escribe el código', () => {
    // El número importa: la primera versión de esta fila cerró CINCO y dejó siete fuera —entre
    // ellos las dos patas del traspaso—. Escribir aquí la lista completa hace que añadir o quitar
    // uno sea una decisión deliberada y no un descuido.
    expect([...CODIGOS_TIPO_DEL_SISTEMA].sort()).toEqual([
      'ajuste-ciclico-entrada',
      'ajuste-ciclico-salida',
      'entrada-maquila',
      'entrada-recepcion',
      'entrega-cliente',
      'error-entrada',
      'error-salida',
      'merma-incompletas',
      'salida-a-orden',
      'salida-por-nota',
      'transferencia-entrada',
      'transferencia-salida',
    ]);
  });

  it('cada rótulo del sistema dice QUIÉN lo escribe (un rechazo sin destino es un portazo)', () => {
    for (const codigo of CODIGOS_TIPO_DEL_SISTEMA) {
      expect(QUIEN_ESCRIBE_TIPO_DEL_SISTEMA[codigo], `${codigo} no dice quién lo escribe`).toMatch(
        /lo escribe el sistema/,
      );
    }
  });

  it('`motivoReservaTipo` separa las dos razones, y deja pasar lo demás', () => {
    expect(motivoReservaTipo('venta-material')).toBe('direccion');
    expect(motivoReservaTipo('error-entrada')).toBe('sistema');
    expect(motivoReservaTipo('ajuste-salida')).toBeNull();
  });
});

describe('🔴 los DOCE del sistema EXISTEN en el seed (si no, la reserva no reserva nada)', () => {
  it('⭐ un código mal escrito aquí no reservaría nada y nadie se enteraría', () => {
    // La guarda compara por `codigo`: un dedazo (`error_entrada`) la deja muda, la pantalla sigue
    // ofreciendo el rótulo y ninguna prueba de dominio lo caza. Por eso se cruza contra la lista
    // que el seed siembra de verdad — el mismo cruce mecánico que ya hace la 0.104.
    const sembrados = new Set(TIPOS_MOVIMIENTO_A_SEMBRAR.map((t) => t.codigo));
    const inventados = [...CODIGOS_TIPO_DEL_SISTEMA].filter((c) => !sembrados.has(c));
    expect(
      inventados,
      `estos códigos se reservan pero el seed NO los siembra: ${inventados.join(', ')}. ` +
        `La reserva sería letra muerta.`,
    ).toEqual([]);
  });
});

describe('la bandera `capturaManual` del catálogo sale de las dos reservas juntas', () => {
  it('es FALSA para los CATORCE reservados (por cualquiera de las dos razones)', () => {
    for (const codigo of [...CODIGOS_TIPO_RESERVADOS, ...CODIGOS_TIPO_DEL_SISTEMA]) {
      expect(tipoEsCapturableAMano(codigo), `${codigo} no debería ofrecerse`).toBe(false);
    }
  });

  it('sigue siendo VERDADERA para las salidas y entradas legítimas de siempre', () => {
    // La reserva no puede llevarse por delante lo que el almacén usa todos los días.
    //
    // ⚠️ `transferencia-salida` ESTUVO en esta lista, y era el peor renglón de toda la fila: una
    // prueba que AFIRMABA que se puede capturar media transferencia a mano. Un hueco abierto se
    // numera; un hueco declarado correcto pelea contra su propio arreglo — el día que alguien lo
    // cerrara, esta prueba se habría puesto roja diciéndole que rompió algo.
    //
    // Los que quedan son legítimos por una razón concreta, no por omisión: `ajuste-entrada` y
    // `ajuste-salida` son el ajuste manual de toda la vida (y lo que recomiendan los mensajes de
    // rechazo de esta misma fila — reservarlos dejaría al almacén sin cómo corregir), aunque el
    // código también los resuelva por `codigo` en algún flujo automático; `otras-salidas` /
    // `otras-entradas` vienen del sistema viejo y el PT las usa a diario (la 0.104 ya decidió no
    // reservar la primera: «sería quitarle una capacidad que ya tenía»); e `inventario-inicial` es
    // con lo que se captura el arranque.
    for (const codigo of [
      'otras-salidas',
      'otras-entradas',
      'ajuste-entrada',
      'ajuste-salida',
      'inventario-inicial',
      'venta-mostrador',
    ]) {
      expect(tipoEsCapturableAMano(codigo), `${codigo} dejó de poder capturarse`).toBe(true);
    }
  });
});

describe('⛔ el SERVIDOR rechaza (la pantalla no es la única defensa, A1)', () => {
  it('⭐ «Error de Entrada» a mano → ErrorValidacion que dice quién lo escribe', async () => {
    // 🔴 De los peores: es el rótulo que el sistema estampa al CANCELAR. Puesto a mano, el
    // kardex afirma una cancelación que nunca ocurrió, sin movimiento cancelado del otro lado.
    await expect(
      rechazarTipoReservado(txConTipo('error-entrada', 'Error de Entrada'), 11),
    ).rejects.toThrow(/al CANCELAR un movimiento de entrada/);
  });

  it('«Merma por prendas incompletas» a mano → ErrorValidacion (su seed ya lo decía)', async () => {
    await expect(
      rechazarTipoReservado(txConTipo('merma-incompletas', 'Merma por prendas incompletas'), 20),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('⭐ media TRANSFERENCIA a mano tampoco: las dos patas van juntas o no van', async () => {
    // El peor de los siete que la 1ª versión de esta fila dejó fuera. `transferencia-salida` es la
    // pata que saca del origen; el motor la escribe SIEMPRE junto con su pata de entrada, en la
    // misma transacción. Sola, a mano, la mercancía sale de un almacén y no llega a ninguno: no es
    // un rótulo equivocado, es existencia colgando en el aire.
    await expect(
      rechazarTipoReservado(
        txConTipo('transferencia-salida', 'Transferencia entre Almacenes (Salida)'),
        21,
      ),
    ).rejects.toThrow(/junto con su pata de entrada/);
    await expect(
      rechazarTipoReservado(
        txConTipo('transferencia-entrada', 'Transferencia entre Almacenes (Entrada)'),
        22,
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('un ajuste por CÍCLICO a mano tampoco: afirmaría un conteo que nadie hizo', async () => {
    // F7-E5 estrenó estos dos «para poder rastrear en el kardex qué diferencias vinieron de un
    // cíclico». Capturarlos a mano contamina justo la medición para la que nacieron — y el ajuste
    // genérico (`ajuste-entrada`/`-salida`) sigue disponible para corregir.
    await expect(
      rechazarTipoReservado(txConTipo('ajuste-ciclico-salida', 'Ajuste por Cíclico (Salida)'), 27),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('el consumo de material a mano tampoco (recepción, salida a orden, nota de avíos)', async () => {
    // `salida-a-orden` es, según su propio seed, «LA única vía que descuenta tela hacia una orden».
    for (const [codigo, nombre] of [
      ['entrada-recepcion', 'Entrada por Recepción de Compra'],
      ['salida-a-orden', 'Salida de Tela a Orden'],
      ['salida-por-nota', 'Salida de Avío por Nota'],
    ] as const) {
      await expect(
        rechazarTipoReservado(txConTipo(codigo, nombre), 23),
        `${codigo} se puede capturar a mano`,
      ).rejects.toBeInstanceOf(ErrorValidacion);
    }
  });

  it('«Entrada de Maquila» y «Entrega a Cliente» a mano tampoco pasan', async () => {
    await expect(
      rechazarTipoReservado(txConTipo('entrada-maquila', 'Entrada de Maquila'), 2),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    await expect(
      rechazarTipoReservado(txConTipo('entrega-cliente', 'Entrega a Cliente'), 5),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('el rótulo de la DIRECCIÓN sigue rechazándose con SU mensaje (manda a la pantalla buena)', async () => {
    // Los dos mensajes tienen que ser distintos: uno dice a dónde ir, el otro dice que no hay a
    // dónde ir. Confundirlos mandaría a alguien a buscar una pantalla que no existe.
    await expect(
      rechazarTipoReservado(txConTipo('venta-material', 'Venta de Material'), 31),
    ).rejects.toThrow(/Salida de material sin orden/);
  });

  it('un tipo normal pasa sin ruido, y un id inexistente no revienta aquí', async () => {
    await expect(
      rechazarTipoReservado(txConTipo('ajuste-salida', 'Ajuste de Inventario (Salida)'), 15),
    ).resolves.toBeUndefined();
    // Que el id no exista lo dirá la FK o el `tipoPorId` de cada dominio, con su propio mensaje.
    await expect(rechazarTipoReservado(txSinTipo(), 9999)).resolves.toBeUndefined();
  });
});
