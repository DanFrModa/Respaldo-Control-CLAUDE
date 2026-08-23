import { describe, expect, it } from 'vitest';

import { ErrorPermiso } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  expedienteOrden,
  ligarOrden,
  quitarLiga,
  sugerenciaLigaOrden,
  tableroDesarrollos,
} from './liga-orden.js';

/**
 * Unit del enganche Desarrollo↔Producción (F8-E6) — SIN Postgres. Cubre el guard de permisos
 * (deny-by-default, A4): ligar/quitar exigen `desarrollo.administrar`; sugerencia/expediente/tablero
 * exigen `desarrollo.ver`. El flujo real (coherencia, unique, 360, conteos) va en `liga-orden.int.test.ts`.
 */

const sinNada = () => sesionDePrueba({ permisos: [] });
const soloVer = () => sesionDePrueba({ permisos: ['desarrollo.ver'] });
const admin = () => sesionDePrueba({ permisos: ['desarrollo.administrar'] });

describe('Enganche unit — permisos (A4, deny-by-default)', () => {
  it('ligarOrden sin desarrollo.administrar lanza ErrorPermiso (antes de la BD)', async () => {
    await expect(ligarOrden(sinNada(), 1, { idDesarrollo: 1 })).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
    // `desarrollo.ver` no alcanza para mutar.
    await expect(ligarOrden(soloVer(), 1, { idDesarrollo: 1 })).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('quitarLiga sin desarrollo.administrar lanza ErrorPermiso', async () => {
    await expect(quitarLiga(soloVer(), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('sugerenciaLigaOrden sin desarrollo.ver lanza ErrorPermiso', async () => {
    await expect(sugerenciaLigaOrden(sinNada(), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('expedienteOrden sin desarrollo.ver lanza ErrorPermiso', async () => {
    await expect(expedienteOrden(sinNada(), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('tableroDesarrollos sin desarrollo.ver lanza ErrorPermiso', async () => {
    await expect(tableroDesarrollos(sinNada(), {})).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('ligarOrden con desarrollo.administrar pasa el guard (falla luego por BD/orden)', async () => {
    // No debe ser ErrorPermiso: el guard pasó; cualquier otro error viene de la BD inexistente.
    await expect(ligarOrden(admin(), 999999, { idDesarrollo: 999999 })).rejects.not.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});
