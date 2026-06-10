import { describe, expect, it } from 'vitest';

import { sesionDePrueba } from '../pruebas/sesiones.js';
import { ErrorPermiso } from './errores.js';
import { tienePermiso, verificarPermiso } from './permisos.js';

describe('permisos (RBAC, MEJORAS A4)', () => {
  it('tienePermiso refleja exactamente el set de la sesión', () => {
    const sesion = sesionDePrueba({ permisos: ['almacenes.ver'] });
    expect(tienePermiso(sesion, 'almacenes.ver')).toBe(true);
    expect(tienePermiso(sesion, 'almacenes.administrar')).toBe(false);
  });

  it('verificarPermiso deja pasar cuando la sesión tiene el permiso', () => {
    const sesion = sesionDePrueba({ permisos: ['usuarios.administrar'] });
    expect(() => verificarPermiso(sesion, 'usuarios.administrar')).not.toThrow();
  });

  it('verificarPermiso lanza ErrorPermiso (código PERMISO) con la clave faltante', () => {
    const sesion = sesionDePrueba({ permisos: [] });
    try {
      verificarPermiso(sesion, 'empresas.administrar');
      expect.unreachable('debió lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorPermiso);
      const errorPermiso = error as ErrorPermiso;
      expect(errorPermiso.codigo).toBe('PERMISO');
      expect(errorPermiso.permiso).toBe('empresas.administrar');
      expect(errorPermiso.message).toBe('No tienes permiso para realizar esta operación.');
    }
  });

  it('una sesión sin permisos no pasa ninguna verificación (denegar por defecto)', () => {
    const sesion = sesionDePrueba();
    expect(tienePermiso(sesion, 'almacenes.ver')).toBe(false);
    expect(() => verificarPermiso(sesion, 'almacenes.ver')).toThrow(ErrorPermiso);
  });
});
