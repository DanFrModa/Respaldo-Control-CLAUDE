import { describe, expect, it } from 'vitest';

import { ErrorPermiso } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { listarCargosEsMa, obtenerCargoEsMa, validarCargoEsMa } from './cargos.js';

/**
 * Unit del dominio de los CARGOS EsMa (F3-E4) — SIN Postgres. Cubre el guard de permisos
 * (deny-by-default, A4): todo lo de la cola de validación exige `esma.cargo-validar`. La lógica de
 * validación real (propuesto→validado, derivación de la propuesta, estados) se prueba contra
 * Postgres en `recibos.int.test.ts` (el cargo nace de un recibo).
 */

const sesionSinNada = () => sesionDePrueba({ permisos: [] });

describe('dominio Cargos EsMa (F3-E4) — permisos (deny-by-default, A4)', () => {
  it('listar cargos sin esma.cargo-validar → ErrorPermiso', async () => {
    await expect(listarCargosEsMa(sesionSinNada(), {}, {})).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('obtener cargo sin esma.cargo-validar → ErrorPermiso', async () => {
    await expect(obtenerCargoEsMa(sesionSinNada(), 1, {})).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('validar cargo sin esma.cargo-validar → ErrorPermiso', async () => {
    await expect(
      validarCargoEsMa(sesionSinNada(), 1, { cantidadReal: 10, precioReal: 5 }, {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});
