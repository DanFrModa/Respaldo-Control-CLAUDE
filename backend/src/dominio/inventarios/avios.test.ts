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

  it('traspaso rechaza origen y destino iguales', async () => {
    await expect(
      traspasarAvio(sesionMover(), {
        idAlmacenOrigen: 1,
        idAlmacenDestino: 1,
        fecha: '2026-06-20',
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
