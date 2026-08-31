/**
 * ⭐⭐ Tests UNIT de los CUATRO ESTADOS DEL MODELO dentro de la lista (V1-E8x, §Post-F9.151 /
 * §Post-F9.155) — SIN Postgres: se inyecta un doble de `Tx` que se comporta como Prisma en lo que el
 * dominio usa. El flujo real contra base va en `negociacion.int.test.ts`.
 *
 * Daniel:
 *
 * > *«seria bueno saber los modelos que ya cerre…. a veces de una lista de 10 modelos, cierro 5 y
 * > los otros ya no los vendo»* · *«Que empiece todo en "Abierto", y luego estan los otros 3
 * > estados. En negociacion, cerrado, dropeado. en total son 4 estados»*
 *
 * Lo que se blinda aquí:
 *  • 🔴 **El estado es un eje APARTE del de la lista** y no se confunde con él.
 *  • 🔴 **Cerrado/dropeado no admiten movimiento** — y el guard vive en UN solo sitio, así que lo
 *    tienen las SIETE mutaciones que pasan por `exigirLineaBloqueandoLista`.
 *  • 🔴 **Revivir conserva la historia** y **deja rastro** (evento INMUTABLE + bitácora, D3).
 *  • 🔴 **Quitar el renglón NO se bloquea**: si no, un dropeado dejaría su desarrollo atrapado para
 *    siempre por el `@@unique([idDesarrollo])` — la trampa que V1-E4 cerró.
 */
import { describe, expect, it } from 'vitest';

import { Prisma, type EstadoRenglonLista } from '../../datos/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import {
  aprobarLinea,
  ajustarPrecioLinea,
  exigirRenglonMovible,
  fijarPrecioTargetLinea,
  quitarLineaLista,
} from './listas-precios.js';
import {
  cambiarEstadoRenglon,
  guardarMesa,
  registrarAcuerdo,
  registrarRonda,
} from './negociacion.js';

const D = (n: number): Prisma.Decimal => new Prisma.Decimal(n);

/** Quien negocia (mismo permiso que mueve el estado de la LISTA: sin permiso nuevo). */
const negociador = () =>
  sesionDePrueba({
    permisos: ['listas.negociar', 'listas.ver', 'consultas.ver-importes'],
  });
/** El dueño: aprueba y teclea precios. */
const dueno = () =>
  sesionDePrueba({ permisos: ['listas.aprobar', 'listas.ver', 'consultas.ver-importes'] });
/** Aurora: administra la lista (target, quitar renglón). */
const aurora = () =>
  sesionDePrueba({
    permisos: ['listas.administrar', 'listas.ver', 'consultas.ver-importes'],
  });

interface EstadoFake {
  idEmpresa: number;
  esCierre: boolean;
  /** El renglón "en la base". */
  linea: {
    id: number;
    idLista: number;
    idDesarrollo: number;
    idPrecosto: number;
    costoUnit: Prisma.Decimal;
    precioCalculado: Prisma.Decimal;
    precioAprobado: Prisma.Decimal | null;
    aprobadoPorId: string | null;
    aprobadoEn: Date | null;
    precioTarget: Prisma.Decimal | null;
    estado: EstadoRenglonLista;
    estadoPorId: string | null;
    estadoEn: Date | null;
  };
  /** `data` de cada `listaPreciosLinea.update`. */
  updates: Record<string, unknown>[];
  /** Eventos de negociación creados (el libro INMUTABLE del renglón). */
  eventos: Record<string, unknown>[];
  bitacora: Record<string, unknown>[];
  /** ¿Se llamó a `delete` del renglón? (la prueba de que quitar NO se bloqueó). */
  borrados: number[];
}

function estadoInicial(estado: EstadoRenglonLista = 'abierto'): EstadoFake {
  return {
    idEmpresa: 1,
    esCierre: false,
    linea: {
      id: 10,
      idLista: 7,
      idDesarrollo: 100,
      idPrecosto: 1000,
      costoUnit: D(40),
      precioCalculado: D(100),
      precioAprobado: D(137),
      aprobadoPorId: 'daniel',
      aprobadoEn: new Date('2026-08-20T00:00:00.000Z'),
      precioTarget: D(130),
      estado,
      estadoPorId: null,
      estadoEn: null,
    },
    updates: [],
    eventos: [],
    bitacora: [],
    borrados: [],
  };
}

/**
 * Aplica el `select` como Prisma: SÓLO los campos pedidos (recurriendo en los anidados). Si el
 * dominio olvidara pedir un campo que después lee, aquí llega `undefined` — igual que en producción.
 */
function aplicarSelect(
  fila: Record<string, unknown>,
  select: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (select === undefined) {
    return fila;
  }
  const salida: Record<string, unknown> = {};
  for (const [campo, pedido] of Object.entries(select)) {
    if (pedido === true) {
      salida[campo] = fila[campo];
    } else if (pedido !== null && typeof pedido === 'object') {
      const anidado = (pedido as { select?: Record<string, unknown> }).select;
      const valor = fila[campo];
      salida[campo] =
        valor === null || typeof valor !== 'object'
          ? valor
          : aplicarSelect(valor as Record<string, unknown>, anidado);
    }
  }
  return salida;
}

/** La fila cruda de la lista con sus joins (lo que `obtenerLista` lee al final). */
function filaLista(estado: EstadoFake): Record<string, unknown> {
  return {
    id: 7,
    idEmpresa: estado.idEmpresa,
    folio: 21n,
    idCliente: 3,
    idClienteDepartamento: 4,
    cliente: { nombre: 'C&A' },
    clienteDepartamento: { nombre: 'NIÑOS' },
    fecha: new Date('2026-08-26T00:00:00.000Z'),
    idEstadoLista: 1,
    estadoLista: { codigo: 'abierta', nombre: 'Abierta', esCierre: estado.esCierre },
    margenPct: D(50),
    descuentosPct: D(10),
    regaliasPct: D(5),
    costoVentasPct: D(5),
    notas: null,
    creadoEn: new Date('2026-08-01T00:00:00.000Z'),
    creadoPorId: 'daniel',
    modificadoEn: new Date('2026-08-01T00:00:00.000Z'),
    modificadoPorId: 'daniel',
  };
}

/** El renglón con los joins que `incluirLista` pide. */
function filaLineaConJoins(estado: EstadoFake): Record<string, unknown> {
  return {
    ...estado.linea,
    desarrollo: {
      numeroCliente: 'CA-114',
      modelo: {
        codigo: 'KM-114',
        descripcion: 'Playera Cherry',
        recetaTocadaEn: null,
        recetaTocadaCambio: null,
      },
    },
    precosto: { version: 1, congeladoEn: new Date('2026-08-01T00:00:00.000Z') },
    // ⭐ V1-E8y: el renglón trae ahora sus PENDIENTES (la libreta de la cita). Van vacíos: esta
    // prueba no habla de ellos, pero la proyección los lee y sin la clave reventaría — que es lo
    // que tiene que pasar si algún día alguien quita el `include`.
    pendientes: [],
  };
}

function txFake(estado: EstadoFake): Tx {
  const fake = {
    $executeRaw: () => Promise.resolve(1),
    listaPrecios: {
      findFirst: ({
        where,
        include,
        select,
      }: {
        where: { id: number; idEmpresa: number };
        include?: Record<string, unknown>;
        select?: Record<string, unknown>;
      }) => {
        // A9 de verdad: una lista de otra empresa NO EXISTE para esta sesión.
        if (where.idEmpresa !== estado.idEmpresa || where.id !== 7) {
          return Promise.resolve(null);
        }
        if (include !== undefined) {
          return Promise.resolve({ ...filaLista(estado), lineas: [filaLineaConJoins(estado)] });
        }
        return Promise.resolve(aplicarSelect(filaLista(estado), select));
      },
      update: () => Promise.resolve({ id: 7 }),
    },
    listaPreciosLinea: {
      findFirst: ({
        where,
        select,
      }: {
        where: { id: number; lista: { idEmpresa: number } };
        select?: Record<string, unknown>;
      }) => {
        if (where.id !== estado.linea.id || where.lista.idEmpresa !== estado.idEmpresa) {
          return Promise.resolve(null);
        }
        const fila = {
          ...estado.linea,
          lista: { estadoLista: { esCierre: estado.esCierre } },
        };
        return Promise.resolve(aplicarSelect(fila, select));
      },
      findUniqueOrThrow: () => Promise.resolve({ ...estado.linea }),
      update: ({ data }: { data: Record<string, unknown> }) => {
        estado.updates.push(data);
        // El doble APLICA la escritura: si no, la segunda lectura mentiría.
        if (typeof data.estado === 'string') {
          estado.linea.estado = data.estado as EstadoRenglonLista;
        }
        return Promise.resolve({ id: estado.linea.id });
      },
      delete: ({ where }: { where: { id: number } }) => {
        estado.borrados.push(where.id);
        return Promise.resolve({ id: where.id });
      },
    },
    negociacionEvento: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        estado.eventos.push(data);
        return Promise.resolve({ id: 900 + estado.eventos.length });
      },
      findMany: () => Promise.resolve([]),
    },
    // ⭐ V1-E8y: `quitarLineaLista` fotografía los PENDIENTES antes de que se los lleve la cascada
    // (misma trampa que los `NegociacionEventoCosto`), así que el doble tiene que contestar.
    listaPreciosLineaPendiente: {
      findMany: () => Promise.resolve([]),
    },
    bitacora: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        estado.bitacora.push(data);
        return Promise.resolve({ id: 1n });
      },
    },
  };
  return fake as unknown as Tx;
}

/** Cambia el estado del renglón con el doble ya listo. */
async function cambiarConFake(
  estado: EstadoFake,
  destino: EstadoRenglonLista,
  sesion = negociador(),
): Promise<Awaited<ReturnType<typeof cambiarEstadoRenglon>>> {
  return cambiarEstadoRenglon(sesion, estado.linea.id, { estado: destino }, { tx: txFake(estado) });
}

// ── ⭐ Las transiciones ─────────────────────────────────────────────────────────────

describe('⭐⭐ V1-E8x — los cuatro estados del MODELO (§Post-F9.151)', () => {
  it('todo renglón nace ABIERTO y avanza a «en negociación» dejando la firma de quién y cuándo', async () => {
    const estado = estadoInicial('abierto');
    const lista = await cambiarConFake(estado, 'en_negociacion');

    expect(estado.updates[0]).toMatchObject({ estado: 'en_negociacion' });
    expect(estado.updates[0]!.estadoPorId).toBe('usuario-prueba');
    expect(estado.updates[0]!.estadoEn).toBeInstanceOf(Date);
    // Y el renglón que vuelve lo dice con su nombre legible (lo redacta el servidor).
    expect(lista.lineas[0]!.estado).toBe('en_negociacion');
    expect(lista.lineas[0]!.nombreEstado).toBe('En negociación');
  });

  it('🔴 «Dropeado» sale con la palabra de DANIEL, sin traducir ni «mejorar»', async () => {
    const estado = estadoInicial('en_negociacion');
    const lista = await cambiarConFake(estado, 'dropeado');
    expect(lista.lineas[0]!.nombreEstado).toBe('Dropeado');
  });

  it('los cuatro nombres son los que Daniel dictó, en su orden', async () => {
    const nombres: string[] = [];
    for (const destino of ['en_negociacion', 'cerrado'] as const) {
      const estado = estadoInicial('abierto');
      const lista = await cambiarConFake(estado, destino);
      nombres.push(lista.lineas[0]!.nombreEstado);
    }
    const abierto = await cambiarConFake(estadoInicial('cerrado'), 'abierto');
    const dropeado = await cambiarConFake(estadoInicial('abierto'), 'dropeado');
    expect([abierto.lineas[0]!.nombreEstado, ...nombres, dropeado.lineas[0]!.nombreEstado]).toEqual(
      ['Abierto', 'En negociación', 'Cerrado', 'Dropeado'],
    );
  });

  it('mover al MISMO estado se rechaza (no hay nada que registrar)', async () => {
    const estado = estadoInicial('cerrado');
    await expect(cambiarConFake(estado, 'cerrado')).rejects.toBeInstanceOf(ErrorConflicto);
    expect(estado.updates).toHaveLength(0);
    expect(estado.eventos).toHaveLength(0);
  });

  it('🔴 desde CERRADO o DROPEADO sólo se puede REVIVIR (abierto / en negociación)', async () => {
    // cerrado → dropeado también es movimiento: primero se revive.
    await expect(cambiarConFake(estadoInicial('cerrado'), 'dropeado')).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    await expect(cambiarConFake(estadoInicial('dropeado'), 'cerrado')).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    // Y las dos vueltas SÍ pasan.
    await expect(cambiarConFake(estadoInicial('dropeado'), 'abierto')).resolves.toBeDefined();
    await expect(cambiarConFake(estadoInicial('cerrado'), 'en_negociacion')).resolves.toBeDefined();
  });

  it('el mensaje del rechazo dice CÓMO salir (revivir), no sólo que no se puede', async () => {
    let mensaje = '';
    try {
      await cambiarConFake(estadoInicial('dropeado'), 'cerrado');
    } catch (error) {
      mensaje = error instanceof Error ? error.message : '';
    }
    expect(mensaje).toMatch(/REVIVIR/i);
    expect(mensaje).toMatch(/historial se conserva/i);
  });

  it('una lista en estado de CIERRE no deja mover el estado de sus renglones', async () => {
    const estado = estadoInicial('abierto');
    estado.esCierre = true;
    await expect(cambiarConFake(estado, 'cerrado')).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('A9 — un renglón de otra empresa NO EXISTE para esta sesión (404, no 409)', async () => {
    const estado = estadoInicial('abierto');
    estado.idEmpresa = 99;
    await expect(cambiarConFake(estado, 'cerrado')).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('permiso: `listas.negociar` — y se verifica ANTES de tocar la base (A4)', async () => {
    const estado = estadoInicial('abierto');
    await expect(cambiarConFake(estado, 'cerrado', dueno())).rejects.toBeInstanceOf(ErrorPermiso);
    expect(estado.updates).toHaveLength(0);
    // Sin permiso nuevo: el que ya movía el estado de la LISTA mueve el del renglón.
    await expect(cambiarConFake(estadoInicial('abierto'), 'cerrado')).resolves.toBeDefined();
  });
});

// ── ⭐ El RASTRO (§Post-F9.155 punto 3) ─────────────────────────────────────────────

describe('⭐ V1-E8x — el rastro del dropeo y del revivir (D3: se agrega, no se edita)', () => {
  it('🔴 DROPEAR deja un evento INMUTABLE que dice quién, cuándo y qué pasa con el papel', async () => {
    const estado = estadoInicial('en_negociacion');
    await cambiarConFake(estado, 'dropeado');

    expect(estado.eventos).toHaveLength(1);
    const evento = estado.eventos[0]!;
    expect(evento.idListaLinea).toBe(10);
    expect(evento.registradoPorId).toBe('usuario-prueba');
    expect(String(evento.acuerdo)).toContain('DROPEÓ');
    // Dice de dónde venía (el rastro es de dónde a dónde, no sólo dónde quedó).
    expect(String(evento.acuerdo)).toContain('En negociación');
    // Y avisa el efecto real: deja de salir en el papel.
    expect(String(evento.acuerdo)).toMatch(/PDF/);
  });

  it('🔴 el evento va SIN precios: aquí no se movió ningún precio', async () => {
    const estado = estadoInicial('abierto');
    await cambiarConFake(estado, 'dropeado');
    const evento = estado.eventos[0]!;
    expect(evento.precioAnterior).toBeNull();
    expect(evento.precioNuevo).toBeNull();
    expect(evento.idPrecostoAnterior).toBeNull();
    expect(evento.idPrecostoNuevo).toBeNull();
  });

  it('🔴 REVIVIR conserva TODA la historia: no se borra el precio aprobado ni el target', async () => {
    const estado = estadoInicial('dropeado');
    await cambiarConFake(estado, 'en_negociacion');

    const update = estado.updates[0]!;
    // El update toca el estado y su firma… y NADA más del renglón.
    expect(update).not.toHaveProperty('precioAprobado');
    expect(update).not.toHaveProperty('aprobadoPorId');
    expect(update).not.toHaveProperty('precioTarget');
    expect(update).not.toHaveProperty('idPrecosto');
    // La firma vieja del precio sigue en pie.
    expect(estado.linea.precioAprobado?.toNumber()).toBe(137);
  });

  it('revivir deja su propio evento, distinto del de dropeo (quién lo revivió)', async () => {
    const estado = estadoInicial('dropeado');
    await cambiarConFake(estado, 'abierto');
    expect(String(estado.eventos[0]!.acuerdo)).toContain('REVIVIÓ');
    expect(String(estado.eventos[0]!.acuerdo)).toMatch(/conserva toda su historia/i);
  });

  it('la BITÁCORA registra de→a (A7)', async () => {
    const estado = estadoInicial('abierto');
    await cambiarConFake(estado, 'cerrado');
    const registro = estado.bitacora[0]!;
    expect(registro.entidad).toBe('ListaPrecios');
    expect(registro.datos).toMatchObject({
      operacion: 'cambiar-estado-renglon',
      idLinea: 10,
      de: 'abierto',
      a: 'cerrado',
    });
  });
});

// ── 🔴 El GUARD: cerrado/dropeado no admiten movimiento ─────────────────────────────

describe('🔴 V1-E8x — un modelo cerrado o dropeado NO admite movimiento', () => {
  it('`exigirRenglonMovible` deja pasar sólo abierto y en negociación', () => {
    expect(() => exigirRenglonMovible('abierto', 'aprobar su precio')).not.toThrow();
    expect(() => exigirRenglonMovible('en_negociacion', 'aprobar su precio')).not.toThrow();
    expect(() => exigirRenglonMovible('cerrado', 'aprobar su precio')).toThrow(ErrorConflicto);
    expect(() => exigirRenglonMovible('dropeado', 'aprobar su precio')).toThrow(ErrorConflicto);
  });

  it('el mensaje nombra la ACCIÓN que se intentó y dice cómo salir', () => {
    let mensaje = '';
    try {
      exigirRenglonMovible('dropeado', 'rondas de re-costeo');
    } catch (error) {
      mensaje = error instanceof Error ? error.message : '';
    }
    expect(mensaje).toContain('rondas de re-costeo');
    expect(mensaje).toMatch(/dropeado/i);
    expect(mensaje).toMatch(/[Rr]evívelo/);
  });

  it('🔴 APROBAR un modelo cerrado se rechaza (y no escribe nada)', async () => {
    const estado = estadoInicial('cerrado');
    await expect(
      aprobarLinea(dueno(), estado.linea.id, { tx: txFake(estado) }),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(estado.updates).toHaveLength(0);
  });

  it('🔴 TECLEAR precio a un modelo dropeado se rechaza', async () => {
    const estado = estadoInicial('dropeado');
    await expect(
      ajustarPrecioLinea(dueno(), estado.linea.id, { precio: 150 }, { tx: txFake(estado) }),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(estado.updates).toHaveLength(0);
  });

  it('🔴 capturar TARGET a un modelo dropeado se rechaza', async () => {
    const estado = estadoInicial('dropeado');
    await expect(
      fijarPrecioTargetLinea(
        aurora(),
        estado.linea.id,
        { precioTarget: 120 },
        { tx: txFake(estado) },
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(estado.updates).toHaveLength(0);
  });

  it('🔴 una RONDA sobre un modelo cerrado se rechaza ANTES de mirar el precosto', async () => {
    const estado = estadoInicial('cerrado');
    await expect(
      registrarRonda(
        negociador(),
        estado.linea.id,
        { idPrecostoNuevo: 2000, acuerdo: 'baja de tela' },
        { tx: txFake(estado) },
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(estado.updates).toHaveLength(0);
    expect(estado.eventos).toHaveLength(0);
  });

  it('🔴 un ACUERDO sobre un modelo dropeado se rechaza', async () => {
    const estado = estadoInicial('dropeado');
    await expect(
      registrarAcuerdo(
        negociador(),
        estado.linea.id,
        { acuerdo: 'quedamos en 130' },
        { tx: txFake(estado) },
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(estado.eventos).toHaveLength(0);
  });

  it('🔴 GUARDAR LA MESA de un modelo cerrado se rechaza', async () => {
    const estado = estadoInicial('cerrado');
    await expect(
      guardarMesa(
        negociador(),
        estado.linea.id,
        {
          acuerdo: 'quedó en 130 con tela más barata',
          precioObjetivo: 130,
          renglones: [
            {
              conceptoCodigo: 'tela',
              conceptoNombre: 'Tela',
              etiqueta: 'Felpa perchada',
              consumo: 1.2,
              precioUnit: 20,
            },
          ],
        },
        { tx: txFake(estado) },
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(estado.eventos).toHaveLength(0);
  });

  it('y con el renglón ABIERTO las mismas operaciones SÍ pasan (el guard no bloquea de más)', async () => {
    const estado = estadoInicial('abierto');
    await expect(
      ajustarPrecioLinea(dueno(), estado.linea.id, { precio: 150 }, { tx: txFake(estado) }),
    ).resolves.toBeDefined();
    expect(estado.updates).toHaveLength(1);
  });

  /**
   * 🔴 LA EXCEPCIÓN DELIBERADA. `lista_precios_linea` tiene `@@unique([idDesarrollo])`: si un
   * renglón dropeado tampoco se pudiera QUITAR, su desarrollo quedaría atrapado para siempre y no
   * podría entrar NUNCA a otra lista — exactamente la trampa que V1-E4 vino a cerrar. Dropear no
   * puede resucitarla, así que `quitarLineaLista` NO lleva el guard.
   */
  it('⭐ QUITAR un renglón dropeado SÍ se puede (o su desarrollo quedaría atrapado)', async () => {
    const estado = estadoInicial('dropeado');
    await expect(
      quitarLineaLista(aurora(), estado.linea.id, { tx: txFake(estado) }),
    ).resolves.toBeDefined();
    expect(estado.borrados).toEqual([10]);
  });
});
