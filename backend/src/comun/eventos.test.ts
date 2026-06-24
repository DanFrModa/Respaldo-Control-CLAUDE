/**
 * Tests unitarios del despachador de eventos de dominio (F3-E1, ADR-0010 §6). Sin BD.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EVENTOS_PRODUCCION,
  emitir,
  limpiarSuscriptores,
  suscribir,
  type EventoEtapaProduccion,
} from './eventos.js';

const cargaEjemplo: EventoEtapaProduccion = {
  idEtapaMovimiento: 1,
  idOrden: 2,
  idEmpresa: 3,
  tipo: 'corte',
  idTipoProceso: null,
};

afterEach(() => {
  limpiarSuscriptores();
});

describe('eventos de dominio (gancho de la RC de F5)', () => {
  it('sin suscriptores, emitir es no-op (caso de F3-E1)', async () => {
    await expect(emitir(EVENTOS_PRODUCCION.corteRegistrado, cargaEjemplo)).resolves.toBeUndefined();
  });

  it('entrega la carga a los suscriptores del evento', async () => {
    const manejador = vi.fn();
    suscribir(EVENTOS_PRODUCCION.reciboRegistrado, manejador);
    await emitir(EVENTOS_PRODUCCION.reciboRegistrado, {
      ...cargaEjemplo,
      tipo: 'recibo_maquila',
      idTipoProceso: 7,
    });
    expect(manejador).toHaveBeenCalledTimes(1);
    expect(manejador).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'recibo_maquila', idTipoProceso: 7 }),
    );
  });

  it('solo notifica al evento correspondiente', async () => {
    const corte = vi.fn();
    const envio = vi.fn();
    suscribir(EVENTOS_PRODUCCION.corteRegistrado, corte);
    suscribir(EVENTOS_PRODUCCION.envioRegistrado, envio);
    await emitir(EVENTOS_PRODUCCION.corteRegistrado, cargaEjemplo);
    expect(corte).toHaveBeenCalledTimes(1);
    expect(envio).not.toHaveBeenCalled();
  });

  it('BEST-EFFORT: si un manejador lanza, no propaga y sigue con los demás', async () => {
    const errores: unknown[] = [];
    const malo = vi.fn(() => {
      throw new Error('consumidor roto');
    });
    const bueno = vi.fn();
    suscribir(EVENTOS_PRODUCCION.corteRegistrado, malo);
    suscribir(EVENTOS_PRODUCCION.corteRegistrado, bueno);

    await expect(
      emitir(EVENTOS_PRODUCCION.corteRegistrado, cargaEjemplo, (_ev, err) => errores.push(err)),
    ).resolves.toBeUndefined(); // NO propaga: el negocio ya está consumado

    expect(malo).toHaveBeenCalledTimes(1);
    expect(bueno).toHaveBeenCalledTimes(1); // se siguió pese al fallo del anterior
    expect(errores).toHaveLength(1);
  });

  it('des-suscribir deja de notificar', async () => {
    const manejador = vi.fn();
    const quitar = suscribir(EVENTOS_PRODUCCION.corteRegistrado, manejador);
    quitar();
    await emitir(EVENTOS_PRODUCCION.corteRegistrado, cargaEjemplo);
    expect(manejador).not.toHaveBeenCalled();
  });
});
