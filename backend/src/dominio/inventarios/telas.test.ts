import { describe, expect, it } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  ajustarInventarioTela,
  cancelarMovimientoTela,
  consultarExistenciasTela,
  kardexTela,
  registrarSalidaTelaAOrden,
  traspasarTela,
} from './telas.js';

/**
 * Unit del dominio de Inventario de TELAS (F4-E1) — SIN Postgres. Cubre las reglas PURAS: guard de
 * permisos (deny-by-default, A4) y validación de captura (Zod + xor lote/líneas). La integridad
 * transaccional (no-negativo bajo lock, traspaso atómico, inverso, lote multi-componente, existencia
 * = suma) se prueba contra Postgres en `materiales.int.test.ts` (CI).
 */
const sesionMover = () =>
  sesionDePrueba({ permisos: ['inventario-telas.ver', 'inventario-telas.mover'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['inventario-telas.ver'] });
const sesionSinNada = () => sesionDePrueba({ permisos: [] });

describe('Inventario de telas — permisos (A4, deny-by-default)', () => {
  it('rechaza ajustar sin inventario-telas.mover', async () => {
    await expect(
      ajustarInventarioTela(sesionSinNada(), {
        idTipoMov: 1,
        idAlmacen: 1,
        fecha: '2026-06-20',
        motivo: 'conteo',
        lineas: [{ idTela: 1, idLote: 1, cantidad: 5 }],
      }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('rechaza salida a orden sin permiso', async () => {
    await expect(
      registrarSalidaTelaAOrden(sesionSoloVer(), {
        idOrden: 1,
        idAlmacen: 1,
        fecha: '2026-06-20',
        lineas: [{ idTela: 1, idLote: 1, cantidad: 5 }],
      }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('rechaza traspaso sin permiso', async () => {
    await expect(
      traspasarTela(sesionSoloVer(), {
        idAlmacenOrigen: 1,
        idAlmacenDestino: 2,
        fecha: '2026-06-20',
        lineas: [{ idTela: 1, idLote: 1, cantidad: 5 }],
      }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('rechaza cancelar sin permiso', async () => {
    await expect(
      cancelarMovimientoTela(sesionSoloVer(), 1, { motivo: 'error' }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('rechaza consultar existencias sin inventario-telas.ver', async () => {
    await expect(consultarExistenciasTela(sesionSinNada())).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('rechaza kardex sin inventario-telas.ver', async () => {
    await expect(kardexTela(sesionSinNada(), { idTela: 1 })).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('Inventario de telas — validación de captura', () => {
  it('ajuste rechaza traer lote Y líneas a la vez (xor)', async () => {
    await expect(
      ajustarInventarioTela(sesionMover(), {
        idTipoMov: 1,
        idAlmacen: 1,
        fecha: '2026-06-20',
        motivo: 'conteo',
        lote: { idColor: 1, componentes: [{ idTela: 1, cantidad: 10 }] },
        lineas: [{ idTela: 1, idLote: 1, cantidad: 5 }],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('ajuste rechaza no traer ni lote ni líneas', async () => {
    await expect(
      ajustarInventarioTela(sesionMover(), {
        idTipoMov: 1,
        idAlmacen: 1,
        fecha: '2026-06-20',
        motivo: 'conteo',
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('ajuste rechaza motivo vacío (A7)', async () => {
    await expect(
      ajustarInventarioTela(sesionMover(), {
        idTipoMov: 1,
        idAlmacen: 1,
        fecha: '2026-06-20',
        motivo: '',
        lineas: [{ idTela: 1, idLote: 1, cantidad: 5 }],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('cancelación rechaza motivo demasiado corto', async () => {
    await expect(cancelarMovimientoTela(sesionMover(), 1, { motivo: 'x' })).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });
});
