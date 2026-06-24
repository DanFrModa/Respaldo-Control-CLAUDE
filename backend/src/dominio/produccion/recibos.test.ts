import { describe, expect, it } from 'vitest';

import { ErrorPermiso } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  cancelarReciboMaquila,
  obtenerRecibo,
  pendientesPorRecibir,
  recibosSemanalesPorMaquilero,
  registrarReciboMaquila,
} from './recibos.js';

/**
 * Unit del dominio del RECIBO de maquila (F3-E4) — SIN Postgres. Cubre las reglas PURAS: el guard de
 * permisos (deny-by-default, A4) de cada operación. La integridad transaccional real (3 efectos
 * atómicos de costura, estampado sin kardex, recibido ≤ enviado bajo lock, cancelación con inverso,
 * folios A3, concurrencia) se prueba contra Postgres en `recibos.int.test.ts` (CI).
 */

const sesionSinNada = () => sesionDePrueba({ permisos: [] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['produccion.wip-ver'] });

const entradaRecibo = {
  idOrden: 1,
  idTipoProceso: 1,
  idMaquilero: 1,
  fecha: '2026-06-19',
  lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
};

describe('dominio Recibo de maquila (F3-E4) — permisos (deny-by-default, A4)', () => {
  it('registrar recibo sin produccion.recibo → ErrorPermiso', async () => {
    await expect(registrarReciboMaquila(sesionSoloVer(), entradaRecibo, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('cancelar recibo sin produccion.cancelar → ErrorPermiso', async () => {
    await expect(
      cancelarReciboMaquila(sesionSoloVer(), 1, { motivo: 'error de captura' }, {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('obtener recibo sin produccion.wip-ver → ErrorPermiso', async () => {
    await expect(obtenerRecibo(sesionSinNada(), 1, {})).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('pendientes por recibir sin produccion.wip-ver → ErrorPermiso', async () => {
    await expect(pendientesPorRecibir(sesionSinNada(), 1, {})).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('recibos semanales sin produccion.wip-ver → ErrorPermiso', async () => {
    await expect(recibosSemanalesPorMaquilero(sesionSinNada(), {}, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});
