/**
 * ⭐⭐⭐ **SI YA SE COMPRÓ, AVISA** (0.085, §Post-F9.173(a)) — unit SIN Postgres.
 *
 * Cubre las tres cosas que este módulo puede equivocar sin que nadie se entere:
 *  1. **El CRITERIO de "ya comprado"** (`ESTATUS_OC_COMPROMETIDA`, no el `<> 'cancelada'` de la
 *     bandeja): un `borrador` NO debe avisar, porque no hay tercero con quien negociar.
 *  2. **A quién cubre cada OC** — el desglose por material, que es lo que convierte *"cambió algo"*
 *     en *"cambió algo QUE YA ESTÁ COMPRADO"*.
 *  3. **La REDACCIÓN**, que es el entregable: el aviso tiene que nombrar folio y estado, y **no**
 *     mandar a nadie a un botón que va a rebotar (des-autorizar es de Dirección; sobre una OC
 *     recibida no existe para nadie).
 *
 * El bloqueo real contra la base (crear la OC, autorizarla y ver el aviso salir de la mutación) vive
 * en `produccion/receta-orden.int.test.ts`, que corre en CI.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ContextoBd } from '../../comun/transaccion.js';
import {
  avisoCambioSobreLoComprado,
  avisoReabrirConCompraComprometida,
  comprasComprometidasDeUnaOrden,
  comprasComprometidasPorOrden,
  listarOcs,
  ocsDeMaterial,
  type OcComprometida,
} from './aviso-ya-comprado.js';
import { ESTATUS_OC_COMPROMETIDA } from './comprometido-en-oc.js';

/** Una línea de OC como la devuelve el `select` real de {@link comprasComprometidasPorOrden}. */
function linea(over: {
  idOrden?: number | null;
  idTela?: number | null;
  idAvio?: number | null;
  idOrdenCompra?: number;
  folio?: number;
  estatus?: OcComprometida['estatus'];
}) {
  return {
    idOrden: over.idOrden ?? 1,
    idTela: over.idTela ?? null,
    idAvio: over.idAvio ?? null,
    idOrdenCompra: over.idOrdenCompra ?? 100,
    ordenCompra: {
      numCompra: BigInt(over.folio ?? 12),
      estatus: over.estatus ?? ('autorizada' as const),
    },
  };
}

/** Cliente falso: devuelve las líneas dadas y CAPTURA el `where` con el que se le preguntó. */
function bdFalsa(filas: ReturnType<typeof linea>[]): {
  bd: ContextoBd;
  wheres: Record<string, unknown>[];
} {
  const wheres: Record<string, unknown>[] = [];
  const cliente = {
    ordenCompraLinea: {
      findMany: vi.fn((args: { where: Record<string, unknown> }) => {
        wheres.push(args.where);
        return Promise.resolve(filas);
      }),
    },
  };
  return { bd: { cliente } as unknown as ContextoBd, wheres };
}

describe('⚖️ el CRITERIO de "ya comprado" sale de ESTATUS_OC_COMPROMETIDA, no de "<> cancelada"', () => {
  it('pregunta SOLO por autorizada/recibida_parcial/recibida_total, y por la empresa activa (A9)', async () => {
    const { bd, wheres } = bdFalsa([]);
    await comprasComprometidasPorOrden(7, [1, 2], bd);

    const oc = (wheres[0]?.ordenCompra ?? {}) as {
      idEmpresa?: number;
      estatus?: { in?: string[] };
    };
    expect(oc.idEmpresa).toBe(7);
    // 🔴 ROJO si alguien copia el `<> 'cancelada'` de `recetas-por-liberar.ts`: ahí entrarían
    // `borrador` y `pendiente_autorizacion`, y el aviso gritaría sobre papeles que nadie mandó.
    expect(oc.estatus?.in).toEqual([...ESTATUS_OC_COMPROMETIDA]);
    expect(oc.estatus?.in).not.toContain('borrador');
    expect(oc.estatus?.in).not.toContain('pendiente_autorizacion');
  });

  it('sin órdenes NO consulta nada (una lista vacía no es un `IN ()`)', async () => {
    const { bd, wheres } = bdFalsa([]);
    expect((await comprasComprometidasPorOrden(7, [], bd)).size).toBe(0);
    expect(wheres).toHaveLength(0);
  });
});

describe('a QUÉ renglón cubre cada OC', () => {
  it('cada material se queda con LO SUYO, y no con lo del vecino', async () => {
    const { bd } = bdFalsa([
      linea({ idTela: 5, idOrdenCompra: 100, folio: 12 }),
      linea({ idAvio: 9, idOrdenCompra: 101, folio: 15, estatus: 'recibida_total' }),
    ]);
    const compras = await comprasComprometidasDeUnaOrden(7, 1, bd);

    expect(ocsDeMaterial(compras, { idTela: 5, idAvio: null }).map((o) => o.folio)).toEqual([12]);
    expect(ocsDeMaterial(compras, { idTela: null, idAvio: 9 }).map((o) => o.folio)).toEqual([15]);
    // El material que NADIE compró no hereda las OC del de al lado.
    expect(ocsDeMaterial(compras, { idTela: 6, idAvio: null })).toEqual([]);
  });

  it('la MISMA OC con dos líneas del mismo material se nombra UNA vez', async () => {
    const { bd } = bdFalsa([
      linea({ idTela: 5, idOrdenCompra: 100, folio: 12 }),
      linea({ idTela: 5, idOrdenCompra: 100, folio: 12 }),
    ]);
    const compras = await comprasComprometidasDeUnaOrden(7, 1, bd);
    expect(ocsDeMaterial(compras, { idTela: 5, idAvio: null })).toHaveLength(1);
    expect(compras.ocs).toHaveLength(1);
  });

  it('las OC de la ORDEN salen ordenadas por folio, aunque las líneas lleguen al revés', async () => {
    const { bd } = bdFalsa([
      linea({ idTela: 5, idOrdenCompra: 101, folio: 15 }),
      linea({ idAvio: 9, idOrdenCompra: 100, folio: 12 }),
    ]);
    const compras = await comprasComprometidasDeUnaOrden(7, 1, bd);
    expect(compras.ocs.map((o) => o.folio)).toEqual([12, 15]);
  });

  it('una línea LIBRE (sin tela ni avío) cuenta para la ORDEN pero no cubre ningún renglón', async () => {
    // Es el caso real de las OC capturadas a mano con texto suelto: comprometen dinero de la orden
    // —y por eso el diálogo de reabrir tiene que nombrarlas— pero no dicen de qué material son.
    const { bd } = bdFalsa([linea({ idTela: null, idAvio: null, folio: 20 })]);
    const compras = await comprasComprometidasDeUnaOrden(7, 1, bd);
    expect(compras.ocs.map((o) => o.folio)).toEqual([20]);
    expect(ocsDeMaterial(compras, { idTela: 5, idAvio: null })).toEqual([]);
  });

  it('⭐ `recibida` VIAJA calculado por el dominio, no lo deduce la pantalla', async () => {
    // 🔴 Es lo que decide el camino que se le ofrece a una persona (des-autorizar vs. devolución),
    // así que la regla vive en `algunaRecibida` y se manda hecha. Deducirla en el frontend sería
    // una segunda implementación de la misma regla, en otro lenguaje.
    const { bd } = bdFalsa([
      linea({ idTela: 5, idOrdenCompra: 100, folio: 12, estatus: 'autorizada' }),
      linea({ idAvio: 9, idOrdenCompra: 101, folio: 15, estatus: 'recibida_parcial' }),
      linea({ idAvio: 8, idOrdenCompra: 102, folio: 18, estatus: 'recibida_total' }),
    ]);
    const compras = await comprasComprometidasDeUnaOrden(7, 1, bd);
    expect(compras.ocs.map((o) => [o.folio, o.recibida])).toEqual([
      [12, false],
      [15, true],
      [18, true],
    ]);
  });

  it('una orden SIN compras comprometidas devuelve vacío, no undefined', async () => {
    const { bd } = bdFalsa([]);
    const compras = await comprasComprometidasDeUnaOrden(7, 99, bd);
    expect(compras.ocs).toEqual([]);
    expect(ocsDeMaterial(compras, { idTela: 5, idAvio: null })).toEqual([]);
  });
});

describe('listarOcs — el folio SIEMPRE con su estado (es lo que decide el camino)', () => {
  it('nombra el estado de cada una, en español', () => {
    expect(
      listarOcs([
        { idOrdenCompra: 1, folio: 12, estatus: 'autorizada', recibida: false },
        { idOrdenCompra: 2, folio: 15, estatus: 'recibida_parcial', recibida: true },
        { idOrdenCompra: 3, folio: 18, estatus: 'recibida_total', recibida: true },
      ]),
    ).toBe('#12 (autorizada), #15 (ya recibida en parte), #18 (ya recibida)');
  });
});

/** Una OC autorizada del material dado. */
const AUTORIZADA: OcComprometida = {
  idOrdenCompra: 100,
  folio: 12,
  estatus: 'autorizada',
  recibida: false,
};
/** Una OC ya recibida: sobre ella des-autorizar NO EXISTE para nadie. */
const RECIBIDA: OcComprometida = {
  idOrdenCompra: 101,
  folio: 15,
  estatus: 'recibida_parcial',
  recibida: true,
};

describe('⭐⭐ avisoCambioSobreLoComprado — "ya está comprado, y acabas de cambiarlo"', () => {
  it('sin nada comprado NO dice nada (el silencio es la respuesta correcta)', () => {
    expect(avisoCambioSobreLoComprado([])).toBeNull();
    expect(avisoCambioSobreLoComprado([{ material: 'Jersey', ocs: [] }])).toBeNull();
  });

  it('con la OC AUTORIZADA nombra material, folio y estado, y dice a quién pedirle qué', () => {
    const aviso = avisoCambioSobreLoComprado([{ material: 'Cierre 5', ocs: [AUTORIZADA] }])!;
    expect(aviso).toContain('"Cierre 5"');
    expect(aviso).toContain('#12 (autorizada)');
    expect(aviso).toContain('YA ESTÁ COMPRADO');
    // 🔴 La frase de Daniel, textual: cancelar se negocia, no se hace con un botón.
    expect(aviso).toContain('negociarlo con el proveedor');
    // §Post-F9.145(f): NO se manda a nadie a un botón que le va a dar 403 en la cara.
    expect(aviso).toContain('perfil de Dirección');
    expect(aviso).toContain('pídeselo a quien lo tenga');
    // Y se le dice DÓNDE lo va a ver el comprador (la bandeja que él sí abre).
    expect(aviso).toContain('Recetas por liberar');
  });

  it('⭐ con la OC ya RECIBIDA cambia el camino: NO manda a des-autorizar (ahí no existe)', () => {
    const aviso = avisoCambioSobreLoComprado([{ material: 'Cierre 5', ocs: [RECIBIDA] }])!;
    expect(aviso).toContain('ya se RECIBIÓ');
    expect(aviso).toContain('devolución o un ajuste');
    // 🔴 ROJO si las dos ramas se colapsan en una: sobre una OC recibida no hay botón que pedir.
    expect(aviso).not.toContain('perfil de Dirección');
    expect(aviso).not.toContain('Cancelarla NO es automático');
  });

  it('con varias OC del mismo material las nombra TODAS, y basta UNA recibida para cambiar el camino', () => {
    const aviso = avisoCambioSobreLoComprado([
      { material: 'Cierre 5', ocs: [AUTORIZADA, RECIBIDA] },
    ])!;
    expect(aviso).toContain('las órdenes de compra #12 (autorizada), #15 (ya recibida en parte)');
    expect(aviso).toContain('devolución o un ajuste');
  });

  it('con VARIOS materiales los enumera todos y dice cuántos son', () => {
    const aviso = avisoCambioSobreLoComprado([
      { material: 'Cierre 5', ocs: [AUTORIZADA] },
      { material: 'Felpa 280', ocs: [RECIBIDA] },
    ])!;
    expect(aviso).toContain('2 materiales que YA ESTÁN COMPRADOS');
    expect(aviso).toContain('"Cierre 5"');
    expect(aviso).toContain('"Felpa 280"');
  });

  it('los materiales SIN compra no se cuelan en la lista', () => {
    const aviso = avisoCambioSobreLoComprado([
      { material: 'Cierre 5', ocs: [AUTORIZADA] },
      { material: 'Jersey', ocs: [] },
    ])!;
    expect(aviso).toContain('un material que YA ESTÁ COMPRADO');
    expect(aviso).not.toContain('Jersey');
  });
});

describe('⭐⭐ avisoReabrirConCompraComprometida — el aviso llega ANTES de confirmar', () => {
  it('sin compra comprometida no hay nada que avisar', () => {
    expect(avisoReabrirConCompraComprometida([])).toBeNull();
  });

  it('nombra las OC con su estado y deja claro que reabrir NO las cancela', () => {
    const aviso = avisoReabrirConCompraComprometida([AUTORIZADA])!;
    expect(aviso).toContain('#12 (autorizada)');
    // 🔴 Lo que la etapa vino a impedir: creer que congelar la compra deshace lo ya comprado.
    expect(aviso).toContain('NO las cancela');
    expect(aviso).toContain('negociarlo con el proveedor');
  });

  it('⭐ con una RECIBIDA de por medio no promete un camino que no existe', () => {
    const aviso = avisoReabrirConCompraComprometida([AUTORIZADA, RECIBIDA])!;
    expect(aviso).toContain('las órdenes de compra #12 (autorizada), #15 (ya recibida en parte)');
    expect(aviso).toContain('devolución o un ajuste');
    expect(aviso).not.toContain('perfil de Dirección');
  });

  it('🔴 el techo honesto es "ya se recibió": NUNCA dice "ya se pagó"', () => {
    // Ningún modelo de CxP liga a una OC, así que el sistema no puede saberlo. Decirlo sería
    // inventar, y es el error más caro de un aviso: el que hace que se deje de creer en él.
    for (const texto of [
      avisoReabrirConCompraComprometida([AUTORIZADA, RECIBIDA]),
      avisoCambioSobreLoComprado([{ material: 'Cierre 5', ocs: [RECIBIDA] }]),
    ]) {
      expect(texto).not.toMatch(/pag[óa]/i);
    }
  });
});
