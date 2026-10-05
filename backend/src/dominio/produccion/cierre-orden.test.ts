/**
 * 0.226a (§Post-F9.244) — la guarda de la orden CERRADA, en lo que se puede probar sin Postgres: el
 * MENSAJE único y central (una y varias órdenes) y que el error siga siendo un `ErrorConflicto` (409,
 * contrato de errores intacto). El candado y las puertas viven en `orden-cerrada-puertas.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  esErrorDominio,
} from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { ClavePermiso } from '../../contrato/index.js';

import * as cierreOrden from './cierre-orden.js';
import {
  cerrarOrden,
  ErrorOrdenCerrada,
  exigirOrdenesAbiertas,
  mensajeOrdenCerrada,
  NAMESPACE_LOCK_CIERRE_ORDEN,
  reabrirOrden,
} from './cierre-orden.js';
import type { Tx } from '../../comun/transaccion.js';

describe('mensajeOrdenCerrada: le dice al usuario QUÉ orden y CÓMO salir', () => {
  it('con UNA orden nombra el folio, qué se intentaba y que hay que reabrirla', () => {
    const m = mensajeOrdenCerrada([1515n], 'le puede sacar tela');
    expect(m).toBe(
      'La orden 1515 está CERRADA (su costo quedó congelado): no se le puede sacar tela. Si de ' +
        'verdad hay que moverla, primero hay que reabrirla; eso sólo lo puede hacer quien tiene ' +
        'el permiso de reabrir órdenes cerradas — queda auditado.',
    );
  });

  it('⭐ 0.228: NO manda a reabrir con la llave de CERRAR (reabrir es de Daniel, §Post-F9.244(4))', () => {
    // Hasta la 0.228 el mensaje decía «reábrela primero (permiso "ordenes.cerrar")»: mandaba a quien
    // cierra a reabrir, que es justo lo que Daniel separó. Ni una clave técnica, ni la equivocada.
    for (const m of [mensajeOrdenCerrada([1n], 'x'), mensajeOrdenCerrada([1n, 2n], 'x')]) {
      expect(m).not.toContain('ordenes.cerrar');
      expect(m).toContain('permiso de reabrir órdenes cerradas');
    }
  });

  it('con VARIAS órdenes las nombra TODAS, en plural y sin repetir', () => {
    const m = mensajeOrdenCerrada([12n, 15n, 12n, 20n], 'le puede comprar material');
    expect(m).toContain('Las órdenes 12, 15 y 20 están CERRADAS');
    expect(m).toContain('no se le puede comprar material');
    expect(m).toContain('primero hay que reabrirlas');
  });

  it('con DOS usa «y» sin coma', () => {
    expect(mensajeOrdenCerrada([3, 4], 'x')).toContain('Las órdenes 3 y 4 están CERRADAS');
  });
});

describe('ErrorOrdenCerrada', () => {
  it('ES un ErrorConflicto (409, código CONFLICTO) con nombre propio y sus folios', () => {
    const e = new ErrorOrdenCerrada([7n, 9n], 'algo');
    expect(e).toBeInstanceOf(ErrorConflicto);
    expect(esErrorDominio(e)).toBe(true);
    expect(e.codigo).toBe('CONFLICTO');
    expect(e.name).toBe('ErrorOrdenCerrada');
    expect(e.folios).toEqual(['7', '9']);
  });

  it('🔴 la guarda «pura» SIN candado ya no existe (era una trampa a un import de distancia)', () => {
    expect(Object.keys(cierreOrden)).not.toContain('exigirOrdenAbierta');
  });
});

describe('exigirOrdenesAbiertas (con un tx simulado): candado ANTES de leer, ascendente, sin repetir', () => {
  function txFalso(cerradas: { folio: bigint }[]): { tx: Tx; pasos: string[] } {
    const pasos: string[] = [];
    const tx = {
      $executeRaw: (sql: TemplateStringsArray, ...valores: unknown[]) => {
        pasos.push(
          `${sql.join('?').includes('_shared') ? 'shared' : 'excl'}:${String(valores[1])}`,
        );
        expect(valores[0]).toBe(NAMESPACE_LOCK_CIERRE_ORDEN);
        return Promise.resolve(1);
      },
      orden: {
        findMany: () => {
          pasos.push('leer');
          return Promise.resolve(cerradas);
        },
      },
    } as unknown as Tx;
    return { tx, pasos };
  }

  it('toma el COMPARTIDO por cada orden en orden ascendente y DESPUÉS lee', async () => {
    const { tx, pasos } = txFalso([]);
    await exigirOrdenesAbiertas(tx, 1, [9, null, 3, 9, undefined, 5], 'x');
    expect(pasos).toEqual(['shared:3', 'shared:5', 'shared:9', 'leer']);
  });

  it('sin órdenes (todo null) no toca la base', async () => {
    const { tx, pasos } = txFalso([]);
    await exigirOrdenesAbiertas(tx, 1, [null, undefined], 'x');
    expect(pasos).toEqual([]);
  });

  it('si hay cerradas lanza UN error que las nombra todas', async () => {
    const { tx } = txFalso([{ folio: 15n }, { folio: 12n }]);
    await expect(exigirOrdenesAbiertas(tx, 1, [1, 2], 'le puede comprar material')).rejects.toThrow(
      /Las órdenes 15 y 12 están CERRADAS/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⭐⭐ 0.228 (§Post-F9.244 decisión 4) — REABRIR ES DE DANIEL: dos llaves, no una.
// Hasta aquí cerrar y reabrir iban con `ordenes.cerrar`. Daniel: *«solo yo (o el que yo autorice…
// un permiso que de entrada solo yo tengo activo)»* ⇒ `ordenes.reabrir`, en SOLO_ADMINISTRADOR. Se
// prueba SIN Postgres: el permiso se exige ANTES de la transacción, y con un tx simulado cuya orden
// «no existe» se distingue «rebotó en la puerta» (`ErrorPermiso`) de «pasó la puerta»
// (`ErrorNoEncontrado`, que sólo puede salir de DENTRO de la transacción).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('0.228 — cerrar y reabrir piden llaves DISTINTAS (A4, en el dominio)', () => {
  function sesionCon(claves: ClavePermiso[]): SesionUsuario {
    return {
      id: 'u-prueba',
      username: 'prueba',
      nombre: 'Prueba',
      idEmpresaActiva: 1,
      nombreEmpresaActiva: 'FR Moda',
      permisos: new Set(claves),
      puedeCorregirSinFactura: false,
    };
  }
  /** Un tx cuya orden NO existe: si el acto llega a leerla, sale `ErrorNoEncontrado`. */
  const bdSinOrden = () => ({
    tx: {
      $executeRaw: () => Promise.resolve(1),
      orden: { findFirst: () => Promise.resolve(null) },
    } as unknown as Tx,
  });

  it('⭐ REABRIR exige `ordenes.reabrir`: con sólo `ordenes.cerrar` (+ ver) rebota en la puerta', async () => {
    await expect(
      reabrirOrden(sesionCon(['ordenes.cerrar', 'ordenes.ver']), 1, { motivo: 'x' }, bdSinOrden()),
    ).rejects.toMatchObject({ permiso: 'ordenes.reabrir' });
    await expect(
      reabrirOrden(sesionCon(['ordenes.cerrar', 'ordenes.ver']), 1, { motivo: 'x' }, bdSinOrden()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('…y con `ordenes.reabrir` (+ ver) PASA la puerta, aunque NO tenga `ordenes.cerrar`', async () => {
    // No se le exige además la llave de cerrar: son dos facultades separables.
    await expect(
      reabrirOrden(sesionCon(['ordenes.reabrir', 'ordenes.ver']), 1, { motivo: 'x' }, bdSinOrden()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('⭐ CERRAR sigue con `ordenes.cerrar` y NO pide `ordenes.reabrir` (Directivo cierra)', async () => {
    await expect(
      cerrarOrden(sesionCon(['ordenes.cerrar', 'ordenes.ver']), 1, {}, bdSinOrden()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    // …y la llave de reabrir NO sirve para cerrar.
    await expect(
      cerrarOrden(sesionCon(['ordenes.reabrir', 'ordenes.ver']), 1, {}, bdSinOrden()),
    ).rejects.toMatchObject({ permiso: 'ordenes.cerrar' });
  });
});
