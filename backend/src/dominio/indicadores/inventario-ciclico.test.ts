/**
 * Tests UNITARIOS del inventario cíclico (F7-E5): rechazos que ocurren ANTES de tocar la base
 * (permisos A4 + validación de entrada) — no requieren Postgres. La fórmula de exactitud, el
 * congelamiento del teórico (D6), el estado y el ajuste como MOVIMIENTO (D3) se verifican
 * END-TO-END en `inventario-ciclico.int.test.ts` (contra la BD real).
 */
import { describe, expect, it } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import {
  cancelarInventarioCiclico,
  capturarConteo,
  consultarExactitud,
  crearInventarioCiclico,
  generarAjusteCiclico,
  listarInventariosCiclicos,
  obtenerConteo,
  obtenerResumen,
} from './inventario-ciclico.js';

const sesion = (permisos: ClavePermiso[] = []) => sesionDePrueba({ idEmpresaActiva: 1, permisos });

describe('Inventario cíclico — permisos (A4)', () => {
  it('el ALTA exige indicadores.ciclicos-alta', async () => {
    await expect(crearInventarioCiclico(sesion([]), { idAlmacen: 1 })).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('el CONTEO exige indicadores.ciclicos-conteo', async () => {
    await expect(
      capturarConteo(sesion([]), 1, { renglones: [{ idDet: 1, cantReal: 0 }] }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('la EXACTITUD exige indicadores.ciclicos-consulta', async () => {
    await expect(consultarExactitud(sesion([]), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('el AJUSTE exige indicadores.ciclicos-consulta', async () => {
    await expect(generarAjusteCiclico(sesion([]), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('CANCELAR exige indicadores.ciclicos-alta', async () => {
    await expect(
      cancelarInventarioCiclico(sesion([]), 1, { motivo: 'ya no' }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('el LISTADO y el RESUMEN exigen AL MENOS UNO de los tres permisos', async () => {
    await expect(listarInventariosCiclicos(sesion([]), {})).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(obtenerResumen(sesion([]), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('el CONTEO ciego exige indicadores.ciclicos-conteo', async () => {
    await expect(obtenerConteo(sesion([]), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('Inventario cíclico — validación de entrada', () => {
  it('rechaza capturar el MISMO renglón dos veces en una sola captura', async () => {
    await expect(
      capturarConteo(sesion(['indicadores.ciclicos-conteo']), 1, {
        renglones: [
          { idDet: 7, cantReal: 3 },
          { idDet: 7, cantReal: 4 },
        ],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza una captura vacía (sin renglones)', async () => {
    await expect(
      capturarConteo(sesion(['indicadores.ciclicos-conteo']), 1, { renglones: [] }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza una cantidad contada negativa', async () => {
    await expect(
      capturarConteo(sesion(['indicadores.ciclicos-conteo']), 1, {
        renglones: [{ idDet: 1, cantReal: -2 }],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza un motivo de cancelación demasiado corto', async () => {
    await expect(
      cancelarInventarioCiclico(sesion(['indicadores.ciclicos-alta']), 1, { motivo: 'x' }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
