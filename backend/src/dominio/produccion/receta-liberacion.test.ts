/**
 * Tests UNITARIOS de LA PUERTA DE COMPRA cuando la receta se libera POR PARTES — V1-E3h
 * (§Post-F9.72). Sin base de datos: el `Tx` va mockeado, que es lo que permite fijar aquí las
 * reglas finas sin pagar un contenedor.
 *
 * LO QUE SE PRUEBA, y por qué importa cada cosa:
 *
 *  • `exigirRecetaLiberada` **dejó de ser todo-o-nada**. Con ALGO firmado pasa y devuelve lo que
 *    quedó fuera, con nombre y cantidad (requisito textual de Daniel: *"transparentemente qué le
 *    falta de liberar"*). Con NADA firmado frena, y el mensaje **dice dónde se libera** — el hueco
 *    de navegación que la decisión nombra aparte.
 *  • `exigirMaterialesLiberados` es la otra mitad: que la orden tenga algo firmado NO autoriza la
 *    línea que se está comprando. Sin esta segunda puerta, la compra parcial abriría exactamente el
 *    agujero que la firma existe para tapar.
 *  • **La LÁPIDA no falta.** Un renglón excluido no se compra, así que no se pide firmarlo — ni en
 *    la puerta, ni en el resumen, ni en la bandeja. Las tres tienen que coincidir o el sistema
 *    mandaría a firmar algo que a nadie le falta.
 *
 * El flujo con BD (firmar por secciones, el re-cierre por renglón, la explosión parcial y la
 * bandeja) vive en `receta-orden.int.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { Prisma } from '../../datos/index.js';
import type { Tx } from '../../comun/transaccion.js';

import {
  exigirMaterialesLiberados,
  exigirRecetaLiberada,
  recetaCompletamenteLiberada,
  resumirReceta,
} from './receta-orden.js';

/** Renglón de tela pendiente, tal como lo devuelve el `select` de `leerPorLiberar`. */
function filaTela(over: { id?: number; idTela?: number; nombre?: string; consumo?: number } = {}) {
  return {
    id: over.id ?? 1,
    idTela: over.idTela ?? 10,
    consumoPorPrenda: new Prisma.Decimal(over.consumo ?? 1.5),
    tela: { nombre: over.nombre ?? 'Jersey', unidadMedida: 'KG' },
  };
}

/** Renglón de avío pendiente. */
function filaAvio(over: { id?: number; idAvio?: number; clave?: string } = {}) {
  return {
    id: over.id ?? 2,
    idAvio: over.idAvio ?? 20,
    consumoPorPrenda: new Prisma.Decimal(1),
    avio: { clave: over.clave ?? 'J01', descripcion: 'Jareta', unidad: 'pza' },
  };
}

/** Contexto mockeado: la orden existe (o no) y cada tabla responde lo que se le diga. */
function txFalso(opciones: {
  ordenExiste?: boolean;
  telas?: ReturnType<typeof filaTela>[];
  avios?: ReturnType<typeof filaAvio>[];
  artes?: { id: number; descripcion: string }[];
  /** Cuántos renglones VIVOS ya están firmados (lo que decide si la puerta frena). */
  liberados?: number;
}): { tx: Tx; wheres: Record<string, unknown>[]; wheresConteo: Record<string, unknown>[] } {
  const wheres: Record<string, unknown>[] = [];
  const wheresConteo: Record<string, unknown>[] = [];
  const tabla = <T>(filas: T[], cuantos = 0) => ({
    findMany: vi.fn((args: { where: Record<string, unknown> }) => {
      wheres.push(args.where);
      return Promise.resolve(filas);
    }),
    // El `where` del COUNT también se captura: es el que decide si una LÁPIDA firmada cuenta como
    // "hay algo liberado" (si contara, una orden sin nada vivo autorizado abriría la puerta).
    count: vi.fn((args: { where: Record<string, unknown> }) => {
      wheresConteo.push(args.where);
      return Promise.resolve(cuantos);
    }),
  });
  const tx = {
    orden: {
      findFirst: vi.fn(() =>
        Promise.resolve((opciones.ordenExiste ?? true) ? { folio: 777n } : null),
      ),
    },
    ordenTela: tabla(opciones.telas ?? [], opciones.liberados ?? 0),
    ordenAvio: tabla(opciones.avios ?? []),
    ordenArte: tabla(opciones.artes ?? []),
  } as unknown as Tx;
  return { tx, wheres, wheresConteo };
}

describe('exigirRecetaLiberada — "se compra LO LIBERADO" (§Post-F9.72)', () => {
  it('con NADA firmado frena, y el mensaje dice DÓNDE se libera', async () => {
    const { tx } = txFalso({ telas: [filaTela()], liberados: 0 });
    const error = await exigirRecetaLiberada(tx, 1, 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorConflicto);
    // El hueco de navegación que §Post-F9.72 nombra aparte: antes frenaba sin decir a dónde ir.
    expect((error as ErrorConflicto).message).toContain('Recetas por liberar');
    expect((error as ErrorConflicto).message).toContain('777');
  });

  it('⭐ con ALGO firmado NO frena, y devuelve lo que quedó fuera con nombre y cantidad', async () => {
    const { tx } = txFalso({
      telas: [filaTela({ id: 5, nombre: 'Felpa', consumo: 2.25 })],
      avios: [filaAvio({ id: 6, clave: 'C53' })],
      liberados: 1,
    });
    const pendientes = await exigirRecetaLiberada(tx, 1, 1);
    expect(pendientes).toEqual([
      {
        tipo: 'tela',
        idRenglon: 5,
        idTela: 10,
        idAvio: null,
        material: 'Felpa',
        consumoPorPrenda: 2.25,
        unidad: 'KG',
      },
      {
        tipo: 'avio',
        idRenglon: 6,
        idTela: null,
        idAvio: 20,
        material: 'C53 — Jareta',
        consumoPorPrenda: 1,
        unidad: 'pza',
      },
    ]);
  });

  it('todo firmado: pasa y no reporta nada pendiente', async () => {
    const { tx } = txFalso({ liberados: 3 });
    await expect(exigirRecetaLiberada(tx, 1, 1)).resolves.toEqual([]);
  });

  it('⭐ la LÁPIDA no falta: lo pendiente se lee con `excluido: false` y `liberadoEn: null`', async () => {
    const { tx, wheres } = txFalso({ liberados: 1 });
    await exigirRecetaLiberada(tx, 42, 1);
    // Las TRES tablas se consultan con el mismo criterio (si una se desviara, la bandeja y la
    // puerta dejarían de coincidir y se pediría firmar algo que a nadie le falta).
    expect(wheres).toHaveLength(3);
    for (const w of wheres) {
      expect(w).toEqual({ idOrden: 42, excluido: false, liberadoEn: null });
    }
  });

  it('una orden de OTRA empresa es 404, nunca 409 (A9)', async () => {
    const { tx } = txFalso({ ordenExiste: false });
    await expect(exigirRecetaLiberada(tx, 1, 99)).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('⭐ "hay algo liberado" cuenta SOLO renglones VIVOS firmados (la lápida firmada no abre la puerta)', async () => {
    // El backfill firmó TODOS los renglones, lápidas incluidas. Si el conteo no las excluyera, una
    // orden cuyos únicos renglones firmados están QUITADOS pasaría la puerta con nada vivo
    // autorizado — y la explosión saldría vacía sin que nadie pudiera explicar por qué.
    const { tx, wheresConteo } = txFalso({ liberados: 1 });
    await exigirRecetaLiberada(tx, 42, 1);

    expect(wheresConteo).toHaveLength(3);
    for (const w of wheresConteo) {
      expect(w).toEqual({ idOrden: 42, excluido: false, liberadoEn: { not: null } });
    }
  });
});

describe('exigirMaterialesLiberados — la puerta POR MATERIAL (§Post-F9.72)', () => {
  it('comprar un material que Desarrollo NO ha firmado se rechaza, y se dice CUÁL', async () => {
    const { tx } = txFalso({ telas: [filaTela({ idTela: 10, nombre: 'Jersey' })] });
    const error = await exigirMaterialesLiberados(tx, 1, 1, [{ idTela: 10 }]).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ErrorConflicto);
    expect((error as ErrorConflicto).message).toContain('"Jersey"');
    expect((error as ErrorConflicto).message).toContain('777');
  });

  it('⭐ EL CASO DE DANIEL: la tela firmada SÍ se compra aunque el avío siga pendiente', async () => {
    // Pendiente: solo el avío. Se está comprando la tela (que ya está firmada, por eso no aparece).
    const { tx } = txFalso({ avios: [filaAvio({ idAvio: 20 })] });
    await expect(exigirMaterialesLiberados(tx, 1, 1, [{ idTela: 10 }])).resolves.toBeUndefined();
  });

  it('⭐ EL CASO QUE ORIGINÓ LA DECISIÓN: comprar un AVÍO sin firmar se rechaza, y se dice cuál', async () => {
    // Daniel recorrió el flujo y no encontró dónde autorizar **los avíos**. La mitad `idAvio` de
    // esta puerta es literalmente ese caso, y hasta esta ronda no la probaba nadie: el reviewer
    // borró su línea y las 14 pruebas siguieron en verde.
    const { tx } = txFalso({ avios: [filaAvio({ idAvio: 21, clave: 'CIE-53' })] });
    const error = await exigirMaterialesLiberados(tx, 1, 1, [{ idAvio: 21 }]).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ErrorConflicto);
    expect((error as ErrorConflicto).message).toContain('"CIE-53 — Jareta"');
  });

  it('y con tela Y avío pendientes, los nombra a LOS DOS (no solo al primero)', async () => {
    const { tx } = txFalso({
      telas: [filaTela({ idTela: 10, nombre: 'Jersey' })],
      avios: [filaAvio({ idAvio: 21, clave: 'CIE-53' })],
    });
    const error = await exigirMaterialesLiberados(tx, 1, 1, [{ idTela: 10 }, { idAvio: 21 }]).catch(
      (e: unknown) => e,
    );
    expect((error as ErrorConflicto).message).toContain('"Jersey"');
    expect((error as ErrorConflicto).message).toContain('"CIE-53 — Jareta"');
  });

  it('un material que NO está en la receta no se rechaza (la receta no es lista blanca de compra)', async () => {
    const { tx } = txFalso({ telas: [filaTela({ idTela: 10 })] });
    await expect(exigirMaterialesLiberados(tx, 1, 1, [{ idTela: 999 }])).resolves.toBeUndefined();
  });

  it('sin nada pendiente pasa de largo (y ni siquiera mira los materiales)', async () => {
    const { tx } = txFalso({});
    await expect(
      exigirMaterialesLiberados(tx, 1, 1, [{ idTela: 10 }, { idAvio: 20 }]),
    ).resolves.toBeUndefined();
  });

  it('una línea SIN material (descripción libre) no choca con nada', async () => {
    const { tx } = txFalso({ telas: [filaTela({ idTela: 10 })] });
    await expect(
      exigirMaterialesLiberados(tx, 1, 1, [{ idTela: null, idAvio: null }]),
    ).resolves.toBeUndefined();
  });

  it('una orden de OTRA empresa es 404 antes de decir nada de su receta (A9)', async () => {
    const { tx } = txFalso({ ordenExiste: false, telas: [filaTela()] });
    await expect(exigirMaterialesLiberados(tx, 1, 99, [{ idTela: 10 }])).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });
});

describe('resumirReceta — el conteo de firmas', () => {
  const fila = (
    over: Partial<{ estado: string; excluido: boolean; liberadoEn: Date | null }> = {},
  ) =>
    ({
      estado: 'revisado',
      excluido: false,
      liberadoEn: null,
      ...over,
    }) as Parameters<typeof resumirReceta>[0][number];

  it('separa lo firmado de lo pendiente entre los renglones VIVOS', () => {
    const r = resumirReceta([
      fila({ liberadoEn: new Date('2026-08-19T10:00:00Z') }),
      fila(),
      fila(),
    ]);
    expect(r.liberados).toBe(1);
    expect(r.porLiberar).toBe(2);
    expect(r.total).toBe(3);
  });

  it('⭐ una LÁPIDA no suma ni de un lado ni del otro, esté firmada o no', () => {
    const r = resumirReceta([
      fila({ excluido: true, liberadoEn: new Date('2026-08-19T10:00:00Z') }),
      fila({ excluido: true }),
      fila({ liberadoEn: new Date('2026-08-19T10:00:00Z') }),
    ]);
    expect(r.excluidos).toBe(2);
    expect(r.liberados).toBe(1);
    expect(r.porLiberar).toBe(0);
    expect(r.total).toBe(1);
  });

  it('una receta vacía no tiene nada firmado ni nada pendiente', () => {
    const r = resumirReceta([]);
    expect(r).toMatchObject({ total: 0, liberados: 0, porLiberar: 0 });
  });
});

/**
 * LA INVARIANTE DEL DERIVADO `Orden.recetaLiberadaEn` (V1-E3h). De ella cuelga el semáforo de
 * "orden completa", así que su caso degenerado —la receta VACÍA— tiene que estar clavado: sin el
 * `length > 0`, `[].every(...)` contesta `true` y una orden sin nada que comprar se sellaría como
 * receta liberada completa.
 */
describe('recetaCompletamenteLiberada', () => {
  const firmado = { liberadoEn: new Date('2026-08-19T10:00:00Z') };
  const pendiente = { liberadoEn: null };

  it('todos firmados → completa', () => {
    expect(recetaCompletamenteLiberada([firmado, firmado])).toBe(true);
  });

  it('uno solo sin firmar → NO completa', () => {
    expect(recetaCompletamenteLiberada([firmado, pendiente])).toBe(false);
  });

  it('⭐ una receta VACÍA NO está "liberada completa" (liberar nada sería mentir)', () => {
    expect(recetaCompletamenteLiberada([])).toBe(false);
  });
});
