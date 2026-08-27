/**
 * ⭐ V1-E8d (§Post-F9.127) — **QUE EL AVISO LLEGUE AL RENGLÓN**, que es la mitad que se olvida.
 *
 * El criterio puro vive en `costo-viejo.test.ts` y la señal (la marca de agua de la receta) en
 * `../modelos/revision-modelo.test.ts`. Aquí se prueba el eslabón de en medio: que `obtenerLista`
 * LEA las dos columnas del modelo y la fecha del congelado, y que el aviso salga **por renglón** en
 * la proyección que consume la pantalla. Cicatriz de este proyecto: *"la frase del servidor nunca
 * llega a la pantalla"*.
 *
 * SIN Postgres: un doble de `Tx` que devuelve la lista con sus renglones tal como los arma el
 * `include` real. El flujo contra base va en `listas-precios.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { Prisma } from '../../datos/index.js';
import type { Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { obtenerLista } from './listas-precios.js';

const D = (n: number): Prisma.Decimal => new Prisma.Decimal(n);

const CONGELADO = new Date('2026-08-20T15:00:00.000Z');
const TOCADA_DESPUES = new Date('2026-08-27T15:00:00.000Z');

/** Sesión que ve todo: lo que se prueba aquí es el aviso, no las rejas (ésas son de V1-E8b). */
const dueno = sesionDePrueba({
  permisos: ['listas.ver', 'listas.aprobar', 'consultas.ver-importes'],
});

/** Lo que distingue a un renglón en cada caso. */
interface CasoRenglon {
  id: number;
  precioAprobado: number | null;
  congeladoEn: Date | null;
  recetaTocadaEn: Date | null;
  recetaTocadaCambio: string | null;
}

/** Un renglón con los joins EXACTOS que `incluirLista` pide (versión + congeladoEn + marca de agua). */
function filaLinea(caso: CasoRenglon): Record<string, unknown> {
  return {
    id: caso.id,
    idDesarrollo: 100 + caso.id,
    idPrecosto: 1000 + caso.id,
    costoUnit: D(40),
    precioCalculado: D(100),
    precioAprobado: caso.precioAprobado === null ? null : D(caso.precioAprobado),
    aprobadoPorId: caso.precioAprobado === null ? null : 'daniel',
    aprobadoEn: caso.precioAprobado === null ? null : new Date('2026-08-21T00:00:00.000Z'),
    desarrollo: {
      numeroCliente: `CA-${String(caso.id)}`,
      modelo: {
        codigo: `MOD-${String(caso.id)}`,
        descripcion: 'Jogger',
        recetaTocadaEn: caso.recetaTocadaEn,
        recetaTocadaCambio: caso.recetaTocadaCambio,
      },
    },
    precosto: { version: 3, congeladoEn: caso.congeladoEn },
  };
}

function txFake(casos: CasoRenglon[]): Tx {
  const fake = {
    listaPrecios: {
      findFirst: () =>
        Promise.resolve({
          id: 7,
          idEmpresa: 1,
          folio: 7n,
          idCliente: 3,
          idClienteDepartamento: 4,
          cliente: { nombre: 'C&A' },
          clienteDepartamento: { nombre: 'NIÑOS' },
          fecha: new Date('2026-08-26T00:00:00.000Z'),
          idEstadoLista: 1,
          estadoLista: { codigo: 'abierta', nombre: 'Abierta', esCierre: false },
          margenPct: D(50),
          descuentosPct: D(10),
          regaliasPct: D(5),
          costoVentasPct: D(5),
          notas: null,
          lineas: casos.map(filaLinea),
          creadoEn: new Date('2026-08-01T00:00:00.000Z'),
          creadoPorId: 'daniel',
          modificadoEn: new Date('2026-08-01T00:00:00.000Z'),
          modificadoPorId: 'daniel',
        }),
    },
  };
  return fake as unknown as Tx;
}

async function avisos(casos: CasoRenglon[]): Promise<(string | null)[]> {
  const lista = await obtenerLista(dueno, 7, { tx: txFake(casos) });
  return lista.lineas.map((l) => l.avisoCostoViejo);
}

/** Renglón base: aprobado, congelado el 20, receta sin tocar. */
function base(extra: Partial<CasoRenglon> = {}): CasoRenglon {
  return {
    id: 10,
    precioAprobado: 137,
    congeladoEn: CONGELADO,
    recetaTocadaEn: null,
    recetaTocadaCambio: null,
    ...extra,
  };
}

describe('⭐ V1-E8d — el aviso de costo viejo sale POR RENGLÓN en la lista', () => {
  it('⭐ receta tocada DESPUÉS del congelado ⇒ el renglón trae la frase, con qué y cuándo', async () => {
    const [aviso] = await avisos([
      base({ recetaTocadaEn: TOCADA_DESPUES, recetaTocadaCambio: 'telas' }),
    ]);
    expect(aviso).not.toBeNull();
    expect(aviso).toContain('las TELAS');
    expect(aviso).toContain('27/8/2026');
    expect(aviso).toContain('APROBADO');
  });

  it('⭐ receta SIN tocar ⇒ null: el aviso no se enciende solo', async () => {
    expect(await avisos([base()])).toEqual([null]);
  });

  it('⭐ cada renglón se juzga por SU modelo y SU precosto, no la lista entera', async () => {
    // Si el criterio se aplicara a nivel lista, un solo modelo movido pintaría de amarillo los
    // cinco renglones y el aviso dejaría de señalar dónde está el problema.
    const salida = await avisos([
      base({ id: 10, recetaTocadaEn: TOCADA_DESPUES, recetaTocadaCambio: 'avios' }),
      base({ id: 11, recetaTocadaEn: null }),
      base({ id: 12, recetaTocadaEn: new Date('2026-08-19T15:00:00.000Z') }),
    ]);
    expect(salida[0]).toContain('los AVÍOS');
    expect(salida[1]).toBeNull();
    expect(salida[2]).toBeNull();
  });

  it('un renglón SIN aprobar también avisa (para que no se firme sobre el costo viejo)', async () => {
    const [aviso] = await avisos([
      base({ precioAprobado: null, recetaTocadaEn: TOCADA_DESPUES, recetaTocadaCambio: 'arte' }),
    ]);
    expect(aviso).toContain('antes de aprobar');
  });

  it('el aviso NO va tras la reja de importes: quien no ve precios sí ve que el costo es viejo', async () => {
    const sinImportes = sesionDePrueba({ permisos: ['listas.ver'] });
    const lista = await obtenerLista(sinImportes, 7, {
      tx: txFake([base({ recetaTocadaEn: TOCADA_DESPUES, recetaTocadaCambio: 'telas' })]),
    });
    expect(lista.lineas[0]?.costoUnit).toBeNull();
    expect(lista.lineas[0]?.avisoCostoViejo).toContain('las TELAS');
  });
});
