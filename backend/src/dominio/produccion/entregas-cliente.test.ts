import { describe, expect, it } from 'vitest';

import { ErrorPermiso } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  cancelarEntregaCliente,
  listarEntregasOrden,
  obtenerEntrega,
  registrarEntregaCliente,
  seguimientoEntregaOrden,
} from './entregas-cliente.js';

/**
 * Unit del dominio de la ENTREGA a cliente (F3-E5) — SIN Postgres. Cubre las reglas PURAS: el guard
 * de permisos (deny-by-default, A4) de cada operación. La integridad transaccional real (salida de
 * PT, no-negativo estricto bajo lock, concurrencia, cancelación con inverso, seguimiento derivado,
 * folios A3) se prueba contra Postgres en `entregas-cliente.int.test.ts` (CI).
 */

const sesionSinNada = () => sesionDePrueba({ permisos: [] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['produccion.wip-ver'] });

const entradaEntrega = {
  idOrden: 1,
  idAlmacen: 1,
  fecha: '2026-06-19',
  lineas: [{ idColor: 1, tallas: [{ idTalla: 1, cantidad: 5 }] }],
};

describe('dominio Entrega a cliente (F3-E5) — permisos (deny-by-default, A4)', () => {
  it('registrar entrega sin produccion.entrega → ErrorPermiso', async () => {
    await expect(
      registrarEntregaCliente(sesionSoloVer(), entradaEntrega, {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('cancelar entrega sin produccion.cancelar → ErrorPermiso', async () => {
    await expect(
      cancelarEntregaCliente(sesionSoloVer(), 1, { motivo: 'error de captura' }, {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('obtener entrega sin produccion.wip-ver → ErrorPermiso', async () => {
    await expect(obtenerEntrega(sesionSinNada(), 1, {})).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('historial de entregas sin produccion.wip-ver → ErrorPermiso', async () => {
    await expect(listarEntregasOrden(sesionSinNada(), 1, {})).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('seguimiento de entrega sin produccion.wip-ver → ErrorPermiso', async () => {
    await expect(seguimientoEntregaOrden(sesionSinNada(), 1, {}, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});
