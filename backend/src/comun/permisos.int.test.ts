/**
 * Puente dominio ↔ seed REAL de `backend/prisma`.
 *
 * Los demás tests de integración siembran datos propios mínimos (aislados del
 * contenido de negocio del seed, que Daniel ajustará). ESTE archivo valida lo
 * contrario: que los motores de dominio funcionan sobre la base TAL COMO LA DEJA
 * el seed de fundación (empresa FR Moda, catálogo de permisos, 9 roles de
 * niveles viejos, usuario admin) — si el seed y el dominio se desalinearan (p. ej.
 * claves sembradas fuera del catálogo tipado, que `cargarPermisosDeUsuario`
 * filtra en silencio), aquí se ve.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CLAVES_PERMISO } from '../contrato/index.js';
import type { PrismaClient } from '../datos/index.js';
import { listarRoles } from '../dominio/admin/roles.js';
import { clientePruebas, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sesionDePrueba } from '../pruebas/sesiones.js';
import { sembrar } from '../../prisma/seed.js';
import { cargarPermisosDeUsuario } from './permisos.js';

let cliente: PrismaClient;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await sembrar(cliente);
});

describe('dominio sobre el seed real de fundación (backend/prisma/seed)', () => {
  it('todo permiso sembrado pertenece al catálogo tipado (nada se filtraría en silencio)', async () => {
    const sembrados = await cliente.permiso.findMany({ select: { clave: true } });
    const catalogo = new Set<string>(CLAVES_PERMISO);
    const fueraDeCatalogo = sembrados
      .map((permiso) => permiso.clave)
      .filter((clave) => !catalogo.has(clave));
    expect(fueraDeCatalogo).toEqual([]);
    expect(sembrados.length).toBe(CLAVES_PERMISO.length);
  });

  it('el admin sembrado obtiene permisos efectivos vía cargarPermisosDeUsuario', async () => {
    const admin = await cliente.usuario.findUniqueOrThrow({ where: { username: 'admin' } });
    expect(admin.activo).toBe(true);
    expect(admin.bloqueado).toBe(false);

    const permisos = await cargarPermisosDeUsuario(admin.id, { cliente });
    expect(permisos.size).toBeGreaterThan(0);
    // Sin esto, el admin no podría administrar el sistema recién instalado.
    expect(permisos.has('usuarios.administrar')).toBe(true);
    expect(permisos.has('roles.administrar')).toBe(true);
  });

  it('los servicios de dominio leen los roles de sistema sembrados (niveles viejos, doc 00 §2)', async () => {
    const sesion = sesionDePrueba({ permisos: ['roles.administrar'] });
    const roles = await listarRoles(sesion, { cliente });

    expect(roles.length).toBeGreaterThanOrEqual(9); // los 9 niveles absorbidos como roles
    // F5-E1 agregó roles funcionales de la RC con esSistema=false; los de sistema (niveles
    // viejos) siguen marcados, así que ya no TODOS son de sistema, pero sí al menos los 9.
    expect(roles.filter((rol) => rol.esSistema).length).toBeGreaterThanOrEqual(9);
    const administrador = roles.find((rol) => rol.nombre === 'Administrador');
    expect(administrador).toBeDefined();
    expect(administrador?.clavesPermisos.length).toBeGreaterThan(0);
  });
});
