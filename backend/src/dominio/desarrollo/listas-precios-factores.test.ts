/**
 * Tests UNIT de **V1-E8b (§Post-F9.125) — EL PRECIO DE VENTA ES SÓLO DEL DUEÑO**, sobre la lista de
 * precios. SIN Postgres: se inyecta un doble de `Tx` que se comporta como Prisma en lo que el dominio
 * usa (honra `where`, aplica `select`, guarda lo escrito). El flujo contra base va en
 * `listas-precios.int.test.ts`.
 *
 * Lo que se blinda aquí:
 *  • **(a)** mover los factores exige `listas.aprobar`. `listas.administrar` YA NO BASTA — que es
 *    justo lo que Aurora tenía.
 *  • **(b)** los cuatro factores salen en `null` para quien no los pueda mover, y el criterio es UNO
 *    (`puedeVerFactoresDePrecio`), no `consultas.ver-importes`.
 *  • **(d)** mover los factores TUMBA las aprobaciones, deja la firma vieja en el evento inmutable y
 *    en la bitácora, y NO tumba nada si los factores no cambiaron.
 */
import { describe, expect, it } from 'vitest';

import { Prisma, type EstadoRenglonLista } from '../../datos/index.js';
import { ErrorPermiso } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import {
  guardarFactoresCliente,
  listarFactoresCliente,
  puedeVerFactoresDePrecio,
} from './cliente-factores.js';
import { editarFactoresLista, obtenerLista } from './listas-precios.js';
import { simularNegociacion } from './negociacion.js';

// ── Sesiones (los repartos REALES del seed, no inventados) ──────────────────────────

/**
 * El DUEÑO: `listas.aprobar` (Administrador / AdministracionDireccion / Directivo). Se le dan los
 * permisos que esos roles TIENEN de verdad en el seed —`listas.negociar` incluido, que llega hasta
 * Gerencial y no más abajo—: una sesión de prueba más pobre que el rol real probaría un usuario que
 * no existe.
 */
const dueno = () =>
  sesionDePrueba({
    permisos: [
      'listas.ver',
      'listas.administrar',
      'listas.aprobar',
      'listas.negociar',
      'consultas.ver-importes',
    ],
  });

/**
 * AURORA (rol `Gerencial`): administra listas y ve importes —los necesita para su trabajo— pero
 * `listas.aprobar` se le quita en el seed. Es la sesión que esta etapa viene a acotar.
 */
const aurora = () =>
  sesionDePrueba({
    permisos: [
      'listas.ver',
      'listas.administrar',
      'listas.negociar',
      'consultas.ver-importes',
      'desarrollo.administrar',
    ],
  });

// ── Doble de Prisma ─────────────────────────────────────────────────────────────────

const D = (n: number): Prisma.Decimal => new Prisma.Decimal(n);

interface FilaLinea {
  id: number;
  idLista: number;
  idDesarrollo: number;
  idPrecosto: number;
  costoUnit: Prisma.Decimal;
  precioCalculado: Prisma.Decimal;
  precioAprobado: Prisma.Decimal | null;
  aprobadoPorId: string | null;
  aprobadoEn: Date | null;
  /**
   * ⭐ V1-E8x: el SEGUNDO eje del renglón. Vive en el fixture porque una de las pruebas de abajo
   * exige que mover los factores NO lo toque: es una decisión de negocio de Daniel, no un derivado
   * del cálculo, y perderla al recalcular sería un defecto.
   */
  estado: EstadoRenglonLista;
  estadoPorId: string | null;
  estadoEn: Date | null;
}

interface EstadoFake {
  idEmpresa: number;
  esCierre: boolean;
  factores: {
    margenPct: Prisma.Decimal;
    descuentosPct: Prisma.Decimal;
    regaliasPct: Prisma.Decimal;
    costoVentasPct: Prisma.Decimal;
  };
  lineas: FilaLinea[];
  /** `data` de cada `listaPreciosLinea.update` (para ver EXACTAMENTE qué se escribió). */
  updatesLinea: { id: number; data: Record<string, unknown> }[];
  /** Eventos de negociación creados (el libro INMUTABLE del renglón). */
  eventos: Record<string, unknown>[];
  bitacora: Record<string, unknown>[];
}

function linea(
  id: number,
  precioAprobado: number | null,
  aprobadoPorId: string | null,
  estado: EstadoRenglonLista = 'en_negociacion',
): FilaLinea {
  return {
    id,
    idLista: 7,
    // ⭐ V1-E8x: NO `abierto` a propósito — con el default del enum, una mutación que borrara el
    // estado al recalcular pasaría desapercibida (el valor escrito coincidiría con el esperado).
    estado,
    estadoPorId: 'aurora',
    estadoEn: new Date('2026-08-12T18:00:00.000Z'),
    idDesarrollo: 100 + id,
    idPrecosto: 1000 + id,
    costoUnit: D(40),
    precioCalculado: D(100),
    precioAprobado: precioAprobado === null ? null : D(precioAprobado),
    aprobadoPorId,
    // ⚠️ Medianoche UTC del 13 = 18:00 del 12 en México (UTC-6). Está elegido A PROPÓSITO para que
    // los dos husos digan días DISTINTOS: si la fecha se formateara en UTC, la nota diría 13/8 y la
    // aserción de abajo se pondría roja. El fixture anterior (18:00Z) daba 12/8 en AMBOS husos, así
    // que la prueba pasaba igual con o sin `timeZone` — no probaba lo que su comentario afirmaba.
    aprobadoEn: aprobadoPorId === null ? null : new Date('2026-08-13T00:00:00.000Z'),
  };
}

function estadoInicial(): EstadoFake {
  return {
    idEmpresa: 1,
    esCierre: false,
    // Precio = 40 ÷ (1 − 0.50) ÷ (1 − 0.20) = 100.
    factores: {
      margenPct: D(50),
      descuentosPct: D(10),
      regaliasPct: D(5),
      costoVentasPct: D(5),
    },
    lineas: [linea(10, 137, 'daniel'), linea(11, null, null), linea(12, 210, 'daniel')],
    updatesLinea: [],
    eventos: [],
    bitacora: [],
  };
}

/** Aplica el `select` como Prisma: SÓLO los campos pedidos (recurriendo en los anidados). */
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

/** La fila cruda de la lista, tal como vive "en la base". */
function filaLista(estado: EstadoFake): Record<string, unknown> {
  return {
    id: 7,
    idEmpresa: estado.idEmpresa,
    folio: 7n,
    idCliente: 3,
    idClienteDepartamento: 4,
    cliente: { nombre: 'C&A' },
    clienteDepartamento: { nombre: 'NIÑOS' },
    fecha: new Date('2026-08-26T00:00:00.000Z'),
    idEstadoLista: 1,
    estadoLista: { codigo: 'abierta', nombre: 'Abierta', esCierre: estado.esCierre },
    ...estado.factores,
    notas: null,
    creadoEn: new Date('2026-08-01T00:00:00.000Z'),
    creadoPorId: 'daniel',
    modificadoEn: new Date('2026-08-01T00:00:00.000Z'),
    modificadoPorId: 'daniel',
  };
}

/** Un renglón con los joins que `obtenerLista` incluye. */
function filaLineaConJoins(l: FilaLinea): Record<string, unknown> {
  return {
    ...l,
    desarrollo: {
      numeroCliente: `CA-${String(l.id)}`,
      // V1-E8d: la marca de agua de la receta viaja en el mismo `include`. Aquí va en NULL —esta
      // suite no habla del aviso de costo viejo (eso es `listas-precios-costo-viejo.test.ts`)— pero
      // el campo tiene que estar: sin él, la proyección leería `undefined` y probaría otra cosa.
      modelo: {
        codigo: `MOD-${String(l.id)}`,
        descripcion: 'Jogger',
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
      // A9 de verdad: una lista de otra empresa NO EXISTE para esta sesión.
      findFirst: ({
        where,
        select,
        include,
      }: {
        where: { id: number; idEmpresa: number };
        select?: Record<string, unknown>;
        include?: Record<string, unknown>;
      }) => {
        if (where.idEmpresa !== estado.idEmpresa || where.id !== 7) {
          return Promise.resolve(null);
        }
        if (include !== undefined) {
          // La lectura del detalle (`obtenerLista`): trae los renglones con sus joins.
          return Promise.resolve({
            ...filaLista(estado),
            lineas: estado.lineas.map(filaLineaConJoins),
          });
        }
        return Promise.resolve(aplicarSelect(filaLista(estado), select));
      },
      findUniqueOrThrow: ({ select }: { select?: Record<string, unknown> }) =>
        Promise.resolve(aplicarSelect(filaLista(estado), select)),
      update: ({ data }: { data: Record<string, unknown> }) => {
        for (const campo of [
          'margenPct',
          'descuentosPct',
          'regaliasPct',
          'costoVentasPct',
        ] as const) {
          if (typeof data[campo] === 'number') {
            estado.factores[campo] = D(data[campo]);
          }
        }
        return Promise.resolve({ id: 7 });
      },
    },
    listaPreciosLinea: {
      // La usa `simularNegociacion` (lee el costo del renglón + el snapshot de factores de su lista).
      findFirst: ({
        where,
        select,
      }: {
        where: { id: number; lista: { idEmpresa: number } };
        select?: Record<string, unknown>;
      }) => {
        const fila = estado.lineas.find((l) => l.id === where.id);
        if (fila === undefined || where.lista.idEmpresa !== estado.idEmpresa) {
          return Promise.resolve(null);
        }
        return Promise.resolve(aplicarSelect({ ...fila, lista: { ...estado.factores } }, select));
      },
      findMany: ({ select }: { select?: Record<string, unknown> }) =>
        Promise.resolve(
          estado.lineas.map((l) => aplicarSelect(l as unknown as Record<string, unknown>, select)),
        ),
      /**
       * 🔴 El doble APLICA de verdad lo que el dominio escribe, campo por campo — no una versión
       * "de lo que esperamos que escriba".
       *
       * Por qué importa (cicatriz de la ronda de corrección de V1-E8x): antes sólo aplicaba
       * `precioCalculado` y forzaba a `null` la firma en cuanto veía `precioAprobado` en el `data`.
       * Con eso, la aserción «el estado del renglón sigue siendo cerrado» **no probaba nada**: el
       * doble jamás tocaba `estado`, así que habría pasado igual si el dominio escribiera
       * `estado: 'abierto'`. Un doble que ignora un campo vuelve inalcanzable cualquier mutación
       * sobre ese campo.
       */
      update: ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        estado.updatesLinea.push({ id: where.id, data });
        const fila = estado.lineas.find((l) => l.id === where.id);
        if (fila !== undefined) {
          if (typeof data.precioCalculado === 'number') {
            fila.precioCalculado = D(data.precioCalculado);
          }
          if ('precioAprobado' in data) {
            fila.precioAprobado =
              typeof data.precioAprobado === 'number' ? D(data.precioAprobado) : null;
          }
          if ('aprobadoPorId' in data) {
            fila.aprobadoPorId = data.aprobadoPorId as string | null;
          }
          if ('aprobadoEn' in data) {
            fila.aprobadoEn = data.aprobadoEn as Date | null;
          }
          // ⭐ V1-E8x: los tres campos del estado del renglón, aplicados igual que los demás.
          if ('estado' in data) {
            fila.estado = data.estado as EstadoRenglonLista;
          }
          if ('estadoPorId' in data) {
            fila.estadoPorId = data.estadoPorId as string | null;
          }
          if ('estadoEn' in data) {
            fila.estadoEn = data.estadoEn as Date | null;
          }
        }
        return Promise.resolve({ id: where.id });
      },
    },
    negociacionEvento: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        estado.eventos.push(data);
        return Promise.resolve({ id: estado.eventos.length });
      },
    },
    bitacora: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        estado.bitacora.push(data);
        return Promise.resolve({ id: estado.bitacora.length });
      },
    },
  };
  return fake as unknown as Tx;
}

const FACTORES_NUEVOS = {
  margenPct: 60,
  descuentosPct: 10,
  regaliasPct: 5,
  costoVentasPct: 5,
};

async function editarConFake(
  estado: EstadoFake,
  sesion = dueno(),
  factores: typeof FACTORES_NUEVOS = FACTORES_NUEVOS,
): Promise<Awaited<ReturnType<typeof editarFactoresLista>>> {
  return editarFactoresLista(sesion, 7, factores, { tx: txFake(estado) });
}

// ── (a) Mover los factores es del DUEÑO ─────────────────────────────────────────────

describe('🔴 (a) Los cuatro factores sólo los mueve el dueño (§Post-F9.125)', () => {
  it('AURORA (listas.administrar, sin listas.aprobar) ya NO puede: 403 y NADA escrito', async () => {
    const estado = estadoInicial();
    await expect(editarConFake(estado, aurora())).rejects.toBeInstanceOf(ErrorPermiso);
    // El permiso se verifica ANTES de tocar la base: ni un update, ni un renglón de bitácora.
    expect(estado.updatesLinea).toHaveLength(0);
    expect(estado.bitacora).toHaveLength(0);
    expect(estado.factores.margenPct.toNumber()).toBe(50);
  });

  it('el DUEÑO sí puede, y los precios se recalculan', async () => {
    const estado = estadoInicial();
    await editarConFake(estado);
    expect(estado.factores.margenPct.toNumber()).toBe(60);
    // 40 ÷ (1 − 0.60) ÷ (1 − 0.20) = 125.
    for (const u of estado.updatesLinea) {
      expect(u.data.precioCalculado).toBe(125);
    }
  });
});

// ── (b) Nadie más los VE ────────────────────────────────────────────────────────────

describe('🔴 (b) Los factores no son visibles para nadie más (§Post-F9.125)', () => {
  it('el criterio es `listas.aprobar`, NO `consultas.ver-importes`', () => {
    expect(puedeVerFactoresDePrecio(dueno())).toBe(true);
    // Aurora ve importes (los necesita) y aun así NO ve factores: ésa es toda la etapa.
    expect(puedeVerFactoresDePrecio(aurora())).toBe(false);
    expect(
      puedeVerFactoresDePrecio(
        sesionDePrueba({ permisos: ['listas.ver', 'consultas.ver-importes'] }),
      ),
    ).toBe(false);
  });

  it('a AURORA los cuatro le llegan en null, pero los PRECIOS no (su trabajo sigue)', async () => {
    const estado = estadoInicial();
    const lista = await obtenerLista(aurora(), 7, { tx: txFake(estado) });
    expect(lista.margenPct).toBeNull();
    expect(lista.descuentosPct).toBeNull();
    expect(lista.regaliasPct).toBeNull();
    expect(lista.costoVentasPct).toBeNull();
    // El límite declarado y aceptado: el costo y el precio SÍ se ven (con ellos saca el margen
    // dividiendo, y Daniel lo eligió a sabiendas). Lo que no hay es el número servido.
    expect(lista.lineas[0]?.costoUnit).toBe(40);
    expect(lista.lineas[0]?.precioAprobado).toBe(137);
  });

  it('al DUEÑO le llegan los cuatro con su valor', async () => {
    const estado = estadoInicial();
    const lista = await obtenerLista(dueno(), 7, { tx: txFake(estado) });
    expect(lista.margenPct).toBe(50);
    expect(lista.descuentosPct).toBe(10);
    expect(lista.regaliasPct).toBe(5);
    expect(lista.costoVentasPct).toBe(5);
  });
});

// ── (d) Se mueven los factores, la firma se cae ─────────────────────────────────────

describe('🔴 (d) Mover los factores TUMBA la aprobación (§Post-F9.125)', () => {
  it('limpia precio/quién/cuándo SÓLO en los renglones que estaban firmados', async () => {
    const estado = estadoInicial();
    await editarConFake(estado);

    const porId = new Map(estado.updatesLinea.map((u) => [u.id, u.data]));
    // 10 y 12 estaban aprobados → se les tumba la firma COMPLETA (las tres columnas juntas).
    for (const id of [10, 12]) {
      expect(porId.get(id)).toMatchObject({
        precioAprobado: null,
        aprobadoPorId: null,
        aprobadoEn: null,
      });
    }
    // 11 nunca tuvo firma: no se le "limpia" nada (no hay tupla mentirosa que arreglar).
    expect(porId.get(11)).not.toHaveProperty('precioAprobado');
  });

  it('la firma vieja NO se borra: vive en el evento INMUTABLE y en la bitácora (D3)', async () => {
    const estado = estadoInicial();
    await editarConFake(estado);

    expect(estado.eventos).toHaveLength(2);
    const evento = estado.eventos[0]!;
    expect(evento.idListaLinea).toBe(10);
    // Sin re-costeo: los factores se movieron, el COSTO no. Por eso no hay precostos en el evento.
    expect(evento.idPrecostoAnterior).toBeNull();
    expect(evento.idPrecostoNuevo).toBeNull();
    expect(Number(evento.precioAnterior)).toBe(137);
    expect(evento.precioNuevo).toBe(125);
    expect(String(evento.acuerdo)).toContain('INVALIDÓ');
    expect(String(evento.acuerdo)).toContain('FACTORES');
    // Dice DE CUÁNDO era la firma que tumbó, no sólo que la tumbó. Y lo dice en el huso del
    // NEGOCIO: la aprobación es del 12 de agosto a las 18:00 de México, que en UTC ya es el día 13.
    // Si esto se formateara en UTC diría 13/8/2026 y aquí moriría.
    expect(String(evento.acuerdo)).toContain('12/8/2026');
    expect(String(evento.acuerdo)).not.toContain('13/8/2026');

    const renglon = estado.bitacora[0]!.datos as Record<string, unknown>;
    expect(renglon.operacion).toBe('editar-factores');
    expect(renglon.factoresCambiaron).toBe(true);
    const firmas = renglon.firmasInvalidadas as Record<string, unknown>[];
    expect(firmas).toHaveLength(2);
    expect(firmas[0]).toMatchObject({
      idLinea: 10,
      precioAprobadoAnterior: 137,
      aprobadoPorId: 'daniel',
    });
  });

  /**
   * ⭐⭐ V1-E8x — **MOVER LOS FACTORES NO TOCA EL ESTADO DEL MODELO.** Tumbar la firma del precio es
   * correcto (el precio se calculó con otros porcentajes, §Post-F9.125(d)); tumbar el ESTADO no lo
   * sería: que Daniel haya cerrado o dropeado un modelo es una decisión suya sobre el negocio, no
   * un derivado del cálculo. Perderla al recalcular sería un defecto silencioso —el renglón
   * volvería «abierto» y reaparecería en el papel—, así que se blinda aquí.
   */
  it('⭐ NO toca el ESTADO del renglón: la firma es del cálculo, el estado es de Daniel', async () => {
    const estado = estadoInicial();
    estado.lineas[0]!.estado = 'cerrado';
    estado.lineas[1]!.estado = 'dropeado';

    const lista = await editarConFake(estado);

    // Ni un solo UPDATE menciona las columnas del estado del renglón…
    for (const update of estado.updatesLinea) {
      expect(update.data).not.toHaveProperty('estado');
      expect(update.data).not.toHaveProperty('estadoPorId');
      expect(update.data).not.toHaveProperty('estadoEn');
    }
    // …y la lista que vuelve los conserva tal cual (el dropeado sigue fuera del papel).
    // 🔴 Esta mitad MUERDE porque el doble de `listaPreciosLinea.update` aplica `estado` de verdad:
    // si el dominio escribiera `estado: 'abierto'`, la fila en memoria cambiaría y esto saldría
    // rojo. Con el doble anterior —que ignoraba el campo— la aserción era decorativa.
    expect(lista.lineas.find((l) => l.id === 10)?.estado).toBe('cerrado');
    expect(lista.lineas.find((l) => l.id === 11)?.estado).toBe('dropeado');
  });

  /**
   * 🔴🔴 **V1-E8x — LO CERRADO NO SE TOCA, Y ÉSTE ES EL CALLEJÓN QUE EVITA.** Daniel, textual: *«No
   * se tocan: lo cerrado es un compromiso»*.
   *
   * El defecto que cierra no era una incoherencia estética: tumbarle la firma a un renglón
   * `cerrado` lo dejaba sin precio aprobado **y sin forma de volver a firmarlo** (`aprobarLinea` y
   * `ajustarPrecioLinea` rechazan un terminal). Y como `cerrado` **sí es vigente**, el guard del
   * papel lo nombraba como faltante ⇒ **la lista entera se quedaba sin PDF, sin Excel y sin
   * cotización**. Es el mismo agujero de §Post-F9.155, abierto por el otro lado.
   */
  it('🔴 un renglón CERRADO conserva su firma y su precio: mover un factor NO lo toca', async () => {
    const estado = estadoInicial();
    estado.lineas[0]!.estado = 'cerrado'; // el 10, firmado por Daniel en 137
    estado.lineas[1]!.estado = 'dropeado'; // el 11, sin firma
    // el 12 queda vivo y firmado: control positivo de que el salto no bloquea de más.

    const lista = await editarConFake(estado);

    // 1. Al cerrado NO se le escribió NADA (ni el precio calculado nuevo).
    expect(estado.updatesLinea.map((u) => u.id)).toEqual([12]);

    // 2. Su firma sigue en pie — y con ella el papel puede salir.
    const cerrado = lista.lineas.find((l) => l.id === 10);
    expect(cerrado?.aprobado).toBe(true);
    expect(cerrado?.precioAprobado).toBe(137);
    expect(cerrado?.aprobadoPorId).toBe('daniel');
    // Y su precio calculado se quedó en el viejo (100), no en el nuevo (125).
    expect(cerrado?.precioCalculado).toBe(100);

    // 3. NO se le escribió el evento de invalidación — que además termina diciendo "Hay que volver
    //    a aprobarlo", una instrucción imposible sobre un cerrado (y absurda sobre un dropeado).
    expect(estado.eventos.map((e) => e.idListaLinea)).toEqual([12]);

    // 4. El renglón VIVO sí se recalculó y sí perdió la firma (§Post-F9.125(d) intacto).
    const vivo = lista.lineas.find((l) => l.id === 12);
    expect(vivo?.aprobado).toBe(false);
    expect(vivo?.precioCalculado).toBe(125);

    // 5. La bitácora no miente sobre cuántos tocó, y NOMBRA a los que respetó.
    const registro = estado.bitacora[0]!.datos as Record<string, unknown>;
    expect(registro.renglonesRecalculados).toBe(1);
    expect(registro.terminalesRespetados).toEqual([
      { idLinea: 10, estado: 'cerrado', precioAprobado: 137 },
      { idLinea: 11, estado: 'dropeado', precioAprobado: null },
    ]);
    // Y la firma del cerrado NO aparece entre las invalidadas (porque no se invalidó).
    expect(registro.firmasInvalidadas).toEqual([
      expect.objectContaining({ idLinea: 12, aprobadoPorId: 'daniel' }),
    ]);
  });

  it('🔴 el aviso «hay que volver a aprobarlo» ya NO alcanza a un DROPEADO', async () => {
    const estado = estadoInicial();
    estado.lineas[0]!.estado = 'dropeado'; // el 10 viene firmado en 137

    await editarConFake(estado);

    // A un dropeado no se le va a aprobar nada nunca: pedírselo por escrito era ruido con
    // instrucción imposible en el historial que Daniel lee.
    const paraElDropeado = estado.eventos.filter((e) => e.idListaLinea === 10);
    expect(paraElDropeado).toHaveLength(0);
    // El resto de la lista sí recibió el suyo (el criterio no se aflojó para todos).
    expect(
      estado.eventos.some((e) => String(e.acuerdo).includes('Hay que volver a aprobarlo')),
    ).toBe(true);
  });

  it('NO hay estado muerto: el renglón queda como uno nuevo, listo para re-aprobar', async () => {
    const estado = estadoInicial();
    const lista = await editarConFake(estado);
    const renglon = lista.lineas.find((l) => l.id === 10);
    expect(renglon?.aprobado).toBe(false);
    expect(renglon?.precioAprobado).toBeNull();
    expect(renglon?.precioCalculado).toBe(125);
  });

  it('guardar los MISMOS factores no tumba ninguna firma (no hubo hecho detrás)', async () => {
    const estado = estadoInicial();
    await editarConFake(estado, dueno(), {
      margenPct: 50,
      descuentosPct: 10,
      regaliasPct: 5,
      costoVentasPct: 5,
    });
    expect(estado.eventos).toHaveLength(0);
    for (const u of estado.updatesLinea) {
      expect(u.data).not.toHaveProperty('precioAprobado');
    }
    expect((estado.bitacora[0]!.datos as Record<string, unknown>).factoresCambiaron).toBe(false);
  });

  it('mover CUALQUIERA de los cuatro cuenta, no sólo el margen', async () => {
    for (const cambio of [
      { margenPct: 50, descuentosPct: 11, regaliasPct: 5, costoVentasPct: 5 },
      { margenPct: 50, descuentosPct: 10, regaliasPct: 6, costoVentasPct: 5 },
      { margenPct: 50, descuentosPct: 10, regaliasPct: 5, costoVentasPct: 6 },
    ]) {
      const estado = estadoInicial();
      await editarConFake(estado, dueno(), cambio);
      expect(estado.eventos).toHaveLength(2);
    }
  });
});

// ── (b) La CALCULADORA de la mesa era la tercera puerta a los factores ───────────────

describe('🔴 (b) La calculadora no entrega el margen digerido (§Post-F9.125)', () => {
  /** La sesión de la mesa: negocia y ve importes, pero no aprueba precios. Es Aurora. */
  const enLaMesa = aurora();

  it('al DUEÑO le da los números completos (la herramienta sigue viva para él)', async () => {
    const estado = estadoInicial();
    const sim = await simularNegociacion(
      dueno(),
      10,
      { precioObjetivo: 200 },
      { tx: txFake(estado) },
    );
    expect(sim.costo).toBe(40);
    // Neto = 200 × (1 − 0.20) = 160 ⇒ margen bruto = (160 − 40) ÷ 160 = 75 %.
    expect(sim.precioNeto).toBe(160);
    expect(sim.margenBrutoPct).toBe(75);
    expect(sim.margenObjetivoPct).toBe(50);
    expect(sim.cumpleObjetivo).toBe(true);
  });

  it('a AURORA los CUATRO le llegan en null — cada uno delataba un factor', async () => {
    const estado = estadoInicial();
    const sim = await simularNegociacion(
      enLaMesa,
      10,
      { precioObjetivo: 200 },
      { tx: txFake(estado) },
    );
    // `margenObjetivoPct` ES el factor `margenPct` servido tal cual: no es derivable de nada.
    expect(sim.margenObjetivoPct).toBeNull();
    // `precioNeto` ÷ objetivo = 1 − suma/100 ⇒ entrega la suma de los otros TRES factores.
    expect(sim.precioNeto).toBeNull();
    // Sale del neto, así que arrastra la misma fuga.
    expect(sim.margenBrutoPct).toBeNull();
    // Es un ORÁCULO: moviendo el objetivo hasta que cambia se reconstruye el margen a voluntad.
    expect(sim.cumpleObjetivo).toBeNull();
  });

  it('el COSTO y el precio que ella tecleó NO se ocultan (el límite aceptado)', async () => {
    const estado = estadoInicial();
    const sim = await simularNegociacion(
      enLaMesa,
      10,
      { precioObjetivo: 200 },
      { tx: txFake(estado) },
    );
    expect(sim.costo).toBe(40);
    expect(sim.precioObjetivo).toBe(200);
  });
});

// ── (a)+(b) La OTRA puerta: los factores del CLIENTE ────────────────────────────────

/**
 * Blindar sólo el snapshot de la lista habría dejado esta puerta abierta: quien mueve los factores
 * del CLIENTE mueve el precio de la próxima lista que se cree de ese cliente. Un candado que se
 * rodea por el catálogo de al lado no es un candado.
 */
describe('🔴 (a)+(b) Los factores del CLIENTE también son del dueño (§Post-F9.125)', () => {
  /** Doble mínimo para el catálogo de factores del cliente. */
  function txFactoresCliente(): Tx {
    return {
      cliente: { findUnique: () => Promise.resolve({ id: 3 }) },
      clienteFactores: {
        findMany: () =>
          Promise.resolve([
            {
              id: 1,
              idCliente: 3,
              idClienteDepartamento: null,
              margenPct: D(50),
              descuentosPct: D(10),
              regaliasPct: D(5),
              costoVentasPct: D(5),
              creadoEn: new Date('2026-08-01T00:00:00.000Z'),
              creadoPorId: 'daniel',
              modificadoEn: new Date('2026-08-01T00:00:00.000Z'),
              modificadoPorId: 'daniel',
            },
          ]),
      },
    } as unknown as Tx;
  }

  it('AURORA no puede GUARDARLOS: 403 antes de tocar la base', async () => {
    await expect(
      guardarFactoresCliente(
        aurora(),
        3,
        { margenPct: 60, descuentosPct: 10, regaliasPct: 5, costoVentasPct: 5 },
        { tx: txFactoresCliente() },
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('AURORA sí los LISTA (la pantalla del cliente vive), pero los % le llegan en null', async () => {
    const filas = await listarFactoresCliente(aurora(), 3, { tx: txFactoresCliente() });
    expect(filas).toHaveLength(1);
    expect(filas[0]?.margenPct).toBeNull();
    expect(filas[0]?.descuentosPct).toBeNull();
    expect(filas[0]?.regaliasPct).toBeNull();
    expect(filas[0]?.costoVentasPct).toBeNull();
  });

  it('al DUEÑO le llegan con su valor', async () => {
    const filas = await listarFactoresCliente(dueno(), 3, { tx: txFactoresCliente() });
    expect(filas[0]?.margenPct).toBe(50);
    expect(filas[0]?.costoVentasPct).toBe(5);
  });
});
