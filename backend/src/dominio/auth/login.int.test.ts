import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ErrorBloqueado } from '../../comun/errores.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import {
  evaluarAccesoPrevio,
  MAX_INTENTOS,
  MENSAJE_BLOQUEADO,
  MENSAJE_DESACTIVADO,
  registrarAccesoExitoso,
  registrarIntentoFallido,
} from './login.js';

let cliente: PrismaClient;
const bd = () => ({ cliente });

/** Crea un usuario mínimo (sin cuenta de credenciales: aquí solo importa el estado). */
async function crearUsuario(
  username: string,
  estado: { activo?: boolean; bloqueado?: boolean; intentosFallidos?: number } = {},
): Promise<string> {
  const usuario = await cliente.usuario.create({
    data: {
      username,
      displayUsername: username,
      nombre: username,
      email: `${username}@control.local`,
      activo: estado.activo ?? true,
      bloqueado: estado.bloqueado ?? false,
      intentosFallidos: estado.intentosFallidos ?? 0,
    },
  });
  return usuario.id;
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
});

describe('bloqueo por intentos (dominio, doc 00 §1.1)', () => {
  describe('evaluarAccesoPrevio', () => {
    it('permite a un usuario activo y no bloqueado', async () => {
      const id = await crearUsuario('admin');
      await expect(evaluarAccesoPrevio('admin', bd())).resolves.toEqual({
        estado: 'permitido',
        idUsuario: id,
      });
    });

    it('no revela a un usuario inexistente (estado desconocido)', async () => {
      await expect(evaluarAccesoPrevio('fantasma', bd())).resolves.toEqual({
        estado: 'desconocido',
      });
    });

    it('rechaza a un usuario desactivado con su mensaje', async () => {
      await crearUsuario('inactivo', { activo: false });
      await expect(evaluarAccesoPrevio('inactivo', bd())).rejects.toMatchObject({
        constructor: ErrorBloqueado,
        message: MENSAJE_DESACTIVADO,
      });
    });

    it('rechaza a un usuario bloqueado con el mensaje exacto', async () => {
      await crearUsuario('bloqueado', { bloqueado: true });
      await expect(evaluarAccesoPrevio('bloqueado', bd())).rejects.toMatchObject({
        constructor: ErrorBloqueado,
        message: MENSAJE_BLOQUEADO,
      });
    });
  });

  describe('registrarIntentoFallido', () => {
    it('incrementa el contador en cada fallo', async () => {
      await crearUsuario('admin');
      const r1 = await registrarIntentoFallido('admin', bd());
      expect(r1).toEqual({ intentosFallidos: 1, bloqueado: false });
      const r2 = await registrarIntentoFallido('admin', bd());
      expect(r2).toEqual({ intentosFallidos: 2, bloqueado: false });
    });

    it(`al ${MAX_INTENTOS}º fallo bloquea la cuenta y lo deja en bitácora`, async () => {
      const id = await crearUsuario('admin');
      let ultimo;
      for (let i = 0; i < MAX_INTENTOS; i += 1) {
        ultimo = await registrarIntentoFallido('admin', bd());
      }
      expect(ultimo).toEqual({ intentosFallidos: MAX_INTENTOS, bloqueado: true });

      const usuario = await cliente.usuario.findUniqueOrThrow({ where: { id } });
      expect(usuario.bloqueado).toBe(true);
      expect(usuario.intentosFallidos).toBe(MAX_INTENTOS);

      const bitacora = await cliente.bitacora.findFirst({
        where: { entidad: 'Usuario', idEntidad: id, accion: 'OTRO' },
      });
      expect(bitacora?.datos).toMatchObject({ evento: 'bloqueo-por-intentos' });
    });

    it('no registra dos veces el bloqueo si ya estaba bloqueado', async () => {
      const id = await crearUsuario('admin', { bloqueado: true, intentosFallidos: MAX_INTENTOS });
      await registrarIntentoFallido('admin', bd());
      const bitacoras = await cliente.bitacora.count({
        where: { entidad: 'Usuario', idEntidad: id },
      });
      expect(bitacoras).toBe(0); // ya estaba bloqueado: no hay transición que registrar
    });

    it('es un no-op para un usuario inexistente', async () => {
      await expect(registrarIntentoFallido('fantasma', bd())).resolves.toBeNull();
    });
  });

  describe('registrarAccesoExitoso', () => {
    it('reinicia los intentos y registra el acceso en bitácora', async () => {
      const id = await crearUsuario('admin', { intentosFallidos: 3 });
      await registrarAccesoExitoso(id, bd());

      const usuario = await cliente.usuario.findUniqueOrThrow({ where: { id } });
      expect(usuario.intentosFallidos).toBe(0);

      const bitacora = await cliente.bitacora.findFirst({
        where: { entidad: 'Usuario', idEntidad: id, accion: 'OTRO' },
      });
      expect(bitacora?.datos).toMatchObject({ evento: 'inicio-sesion' });
    });
  });
});
