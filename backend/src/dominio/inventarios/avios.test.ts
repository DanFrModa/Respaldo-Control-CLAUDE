import { describe, expect, it } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  ajustarInventarioAvio,
  cancelarMovimientoAvio,
  consultarExistenciasAvio,
  kardexAvio,
  traspasarAvio,
} from './avios.js';

/**
 * Unit del dominio de Inventario de AVÍOS (F4-E1) — SIN Postgres. Reglas PURAS: guard de permisos
 * (A4) y validación de captura. La integridad transaccional se prueba contra Postgres en
 * `materiales.int.test.ts`.
 */
const sesionMover = () =>
  sesionDePrueba({ permisos: ['inventario-avios.ver', 'inventario-avios.mover'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['inventario-avios.ver'] });
const sesionSinNada = () => sesionDePrueba({ permisos: [] });

describe('Inventario de avíos — permisos (A4, deny-by-default)', () => {
  it('rechaza ajustar sin inventario-avios.mover', async () => {
    await expect(
      ajustarInventarioAvio(sesionSoloVer(), {
        idTipoMov: 1,
        idAlmacen: 1,
        fecha: '2026-06-20',
        motivo: 'conteo',
        lineas: [{ idAvio: 1, cantidad: 100 }],
      }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('rechaza traspaso sin permiso', async () => {
    await expect(
      traspasarAvio(sesionSoloVer(), {
        idAlmacenOrigen: 1,
        idAlmacenDestino: 2,
        fecha: '2026-06-20',
        motivo: 'Surtido al taller',
        lineas: [{ idAvio: 1, cantidad: 100 }],
      }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('rechaza cancelar sin permiso', async () => {
    await expect(
      cancelarMovimientoAvio(sesionSoloVer(), 1, { motivo: 'error' }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('rechaza consultar existencias sin inventario-avios.ver', async () => {
    await expect(consultarExistenciasAvio(sesionSinNada())).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('rechaza kardex sin inventario-avios.ver', async () => {
    await expect(kardexAvio(sesionSinNada(), { idAvio: 1 })).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('Inventario de avíos — validación de captura', () => {
  it('ajuste rechaza renglones vacíos', async () => {
    await expect(
      ajustarInventarioAvio(sesionMover(), {
        idTipoMov: 1,
        idAlmacen: 1,
        fecha: '2026-06-20',
        motivo: 'conteo',
        lineas: [],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  // ⚠️ CON motivo a propósito: desde la fila 0.172 el traspaso lo exige, así que sin él esta
  // prueba seguiría verde por el motivo que falta y NO por los almacenes iguales, que es lo que dice
  // medir.
  it('traspaso rechaza origen y destino iguales', async () => {
    await expect(
      traspasarAvio(sesionMover(), {
        idAlmacenOrigen: 1,
        idAlmacenDestino: 1,
        fecha: '2026-06-20',
        motivo: 'Surtido al taller',
        lineas: [{ idAvio: 1, cantidad: 100 }],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('ajuste rechaza motivo vacío', async () => {
    await expect(
      ajustarInventarioAvio(sesionMover(), {
        idTipoMov: 1,
        idAlmacen: 1,
        fecha: '2026-06-20',
        motivo: '',
        lineas: [{ idAvio: 1, cantidad: 100 }],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

/**
 * ⭐ FILA 0.172 — el MOTIVO también en el TRASPASO de avíos. Hasta esta fila el ajuste lo exigía y
 * el traspaso no (llevaba unas `observaciones` opcionales), así que mover avío de un almacén a otro
 * no pedía una palabra. La forma es la del ajuste, calcada: mínimo 3 caracteres ya recortados.
 *
 * El motivo lo exige el DOMINIO (`validarEntrada` corre AQUÍ, no sólo en el Zod de la ruta — A1),
 * así que estas pruebas revientan ANTES de tocar la base (no hay `bd`).
 */
describe('Motivo OBLIGATORIO al traspasar avíos (fila 0.172)', () => {
  const traspaso = {
    idAlmacenOrigen: 1,
    idAlmacenDestino: 2,
    fecha: '2026-09-09',
    lineas: [{ idAvio: 1, cantidad: 100 }],
  };

  /** Captura el error de una promesa para poder inspeccionar sus `detalles` (patrón de telas). */
  async function errorDe(promesa: Promise<unknown>): Promise<unknown> {
    return promesa.then(
      () => null,
      (e: unknown) => e,
    );
  }

  it('un traspaso SIN motivo se rechaza', async () => {
    await expect(traspasarAvio(sesionMover(), traspaso as never)).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('un traspaso con motivo DEMASIADO CORTO se rechaza (mínimo 3, como en el ajuste)', async () => {
    // El mensaje LEGIBLE por campo viaja en `detalles.fieldErrors` (formato de `validarEntrada`):
    // el `message` del error es siempre el genérico, así que afirmar sobre él no probaría nada.
    const error = await errorDe(traspasarAvio(sesionMover(), { ...traspaso, motivo: 'ab' }));
    expect(error).toBeInstanceOf(ErrorValidacion);
    expect((error as ErrorValidacion).detalles).toMatchObject({
      fieldErrors: { motivo: ['Explica el motivo (mínimo 3 caracteres)'] },
    });
  });

  it('un motivo de PUROS ESPACIOS se rechaza (se recorta antes de medir)', async () => {
    await expect(
      traspasarAvio(sesionMover(), { ...traspaso, motivo: '     ' }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
