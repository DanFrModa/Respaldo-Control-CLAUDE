import { describe, expect, it } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarNotaSalida,
  cancelarNotaSalida,
  confirmarNotaSalida,
  crearNotaSalida,
  listarNotasSalida,
  obtenerNotaSalida,
} from './notas-salida.js';

/**
 * Unit del dominio de NOTAS DE SALIDA (F4-E5) — SIN Postgres. Cubre lo que NO necesita la base:
 *  • el guard de permisos (deny-by-default, A4): ver exige `notas.ver`; crear/editar/confirmar exigen
 *    `notas.administrar`; cancelar exige `notas.cancelar`;
 *  • la validación de captura por Zod que falla ANTES de tocar la base (crear sin renglones, cancelar
 *    sin motivo, cantidad inválida, fecha faltante).
 *
 * La lógica que toca la base (folio consecutivo bajo concurrencia, descuento exacto de AVÍOS al
 * confirmar, atomicidad, reverso, y el ANTI-DOBLE-DESCUENTO de telas) va en `notas-salida.int.test.ts`
 * (CI, contra Postgres efímero con testcontainers — NO corre en local).
 */

const sesionAdmin = () => sesionDePrueba({ permisos: ['notas.ver', 'notas.administrar'] });
const sesionVer = () => sesionDePrueba({ permisos: ['notas.ver'] });
const sesionCancelar = () => sesionDePrueba({ permisos: ['notas.ver', 'notas.cancelar'] });
const sinPermisos = () => sesionDePrueba({ permisos: [] });

const altaValida = () => ({
  idMaquilero: 1,
  idAlmacen: 1,
  fechaElaboracion: '2026-06-21',
  lineas: [{ idOrden: 1, idAvio: 1, cantidad: 10 }],
});

describe('Notas de salida unit — permisos (A4, deny-by-default)', () => {
  it('crearNotaSalida sin notas.administrar lanza ErrorPermiso (antes de la BD)', async () => {
    await expect(crearNotaSalida(sesionVer(), altaValida())).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('actualizarNotaSalida sin notas.administrar lanza ErrorPermiso', async () => {
    await expect(actualizarNotaSalida(sesionVer(), 1, {})).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('confirmarNotaSalida sin notas.administrar lanza ErrorPermiso', async () => {
    await expect(confirmarNotaSalida(sesionVer(), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('cancelarNotaSalida sin notas.cancelar lanza ErrorPermiso', async () => {
    await expect(cancelarNotaSalida(sesionAdmin(), 1, { motivo: 'error' })).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('obtenerNotaSalida sin notas.ver lanza ErrorPermiso', async () => {
    await expect(obtenerNotaSalida(sinPermisos(), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('listarNotasSalida sin notas.ver lanza ErrorPermiso', async () => {
    await expect(listarNotasSalida(sinPermisos())).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('Notas de salida unit — validación de captura (Zod, antes de la BD)', () => {
  it('crear sin renglones lanza ErrorValidacion', async () => {
    await expect(
      crearNotaSalida(sesionAdmin(), {
        idMaquilero: 1,
        idAlmacen: 1,
        fechaElaboracion: '2026-06-21',
        lineas: [],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear con cantidad cero lanza ErrorValidacion', async () => {
    await expect(
      crearNotaSalida(sesionAdmin(), {
        idMaquilero: 1,
        idAlmacen: 1,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: 1, idAvio: 1, cantidad: 0 }],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear sin fecha de elaboración lanza ErrorValidacion', async () => {
    const entradaSinFecha = {
      idMaquilero: 1,
      idAlmacen: 1,
      lineas: [{ idOrden: 1, idAvio: 1, cantidad: 10 }],
    } as unknown as Parameters<typeof crearNotaSalida>[1];
    await expect(crearNotaSalida(sesionAdmin(), entradaSinFecha)).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('crear con maquilero inválido (id 0) lanza ErrorValidacion', async () => {
    await expect(
      crearNotaSalida(sesionAdmin(), {
        idMaquilero: 0,
        idAlmacen: 1,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: 1, idAvio: 1, cantidad: 10 }],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear sin almacén origen lanza ErrorValidacion (decisión g)', async () => {
    const entradaSinAlmacen = {
      idMaquilero: 1,
      fechaElaboracion: '2026-06-21',
      lineas: [{ idOrden: 1, idAvio: 1, cantidad: 10 }],
    } as unknown as Parameters<typeof crearNotaSalida>[1];
    await expect(crearNotaSalida(sesionAdmin(), entradaSinAlmacen)).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('crear con almacén inválido (id 0) lanza ErrorValidacion', async () => {
    await expect(
      crearNotaSalida(sesionAdmin(), {
        idMaquilero: 1,
        idAlmacen: 0,
        fechaElaboracion: '2026-06-21',
        lineas: [{ idOrden: 1, idAvio: 1, cantidad: 10 }],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  // §Post-F9.38 (V1-E3b) — el ALTA es de AVÍOS: la tela se rechaza ANTES de tocar la BD (sin folio
  // ni escrituras). La EDICIÓN solo acepta la tela que YA estaba en la nota (se prueba en el int
  // test: re-guardar un borrador viejo la conserva, agregar una nueva se rechaza).
  it('crear con un renglón de TELA lanza ErrorValidacion (una nota nueva es de avíos)', async () => {
    await expect(
      crearNotaSalida(sesionAdmin(), {
        idMaquilero: 1,
        idAlmacen: 1,
        fechaElaboracion: '2026-08-13',
        lineas: [
          {
            idOrden: 1,
            idTela: 2,
            idLote: 3,
            idMovimientoSalidaTela: 4,
            cantidad: 10,
            unidad: 'm',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear con tela MEZCLADA entre avíos también lanza ErrorValidacion', async () => {
    await expect(
      crearNotaSalida(sesionAdmin(), {
        idMaquilero: 1,
        idAlmacen: 1,
        fechaElaboracion: '2026-08-13',
        lineas: [
          { idOrden: 1, idAvio: 1, cantidad: 5 },
          { idOrden: 1, idTela: 2, idLote: 3, idMovimientoSalidaTela: 4, cantidad: 10 },
        ],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('cancelar sin motivo lanza ErrorValidacion', async () => {
    const cuerpoSinMotivo = {} as unknown as Parameters<typeof cancelarNotaSalida>[2];
    await expect(cancelarNotaSalida(sesionCancelar(), 1, cuerpoSinMotivo)).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('cancelar con motivo vacío lanza ErrorValidacion', async () => {
    await expect(cancelarNotaSalida(sesionCancelar(), 1, { motivo: '   ' })).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });
});
