/**
 * Tests de integración del seed de fundación contra Postgres real (el efímero de
 * testcontainers, migrado por entorno-global.ts). Verifican el requisito clave del
 * plan §4/A4: seed IDEMPOTENTE y catálogo de permisos/roles bien sembrado.
 *
 * Limpia la base antes de sembrar para que los conteos sean deterministas
 * (las suites de integración comparten el contenedor y corren en serie).
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { sembrar } from '../../prisma/seed.js';
import { CATALOGO_PERMISOS, CLAVES_PERMISO } from '../contrato/index.js';
import { limpiarBaseDatos } from '../pruebas/contexto.js';
import { crearClientePrisma, type PrismaClient } from './index.js';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = crearClientePrisma(inject('urlBaseDatosPruebas'));
  await limpiarBaseDatos(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function conteos() {
  const [
    empresas,
    configuraciones,
    permisos,
    roles,
    rolesPermisos,
    usuarios,
    cuentas,
    usuariosRoles,
  ] = await Promise.all([
    prisma.empresa.count(),
    prisma.configuracionEmpresa.count(),
    prisma.permiso.count(),
    prisma.rol.count(),
    prisma.rolPermiso.count(),
    prisma.usuario.count(),
    prisma.cuenta.count(),
    prisma.usuarioRol.count(),
  ]);
  return {
    empresas,
    configuraciones,
    permisos,
    roles,
    rolesPermisos,
    usuarios,
    cuentas,
    usuariosRoles,
  };
}

describe('seed de fundación', () => {
  it('es idempotente: correrlo dos veces deja exactamente lo mismo', async () => {
    await sembrar(prisma);
    const primera = await conteos();
    await sembrar(prisma);
    const segunda = await conteos();

    expect(segunda).toEqual(primera);
    expect(primera.permisos).toBe(CATALOGO_PERMISOS.length);
    expect(primera.roles).toBe(9);
    expect(primera.empresas).toBeGreaterThanOrEqual(1);
  });

  it('siembra la empresa FR Moda favorita con su configuración (datos de Propiedades.csv)', async () => {
    const empresa = await prisma.empresa.findUniqueOrThrow({
      where: { nombre: 'FR Moda' },
      include: { configuracion: true },
    });
    expect(empresa.favorita).toBe(true);
    expect(empresa.paraIpt).toBe(true);
    expect(empresa.paraEdr).toBe(true);
    expect(empresa.configuracion?.utilidadSugerida?.toNumber()).toBe(50);
    expect(empresa.configuracion?.regaliasBase?.toNumber()).toBe(10);
    expect(empresa.configuracion?.colchonCostura).toBe(1);
  });

  it('la BD queda sincronizada con el catálogo de permisos de src/contrato', async () => {
    const claves = await prisma.permiso.findMany({ select: { clave: true } });
    expect(claves.map((p) => p.clave).sort()).toEqual([...CLAVES_PERMISO].sort());
  });

  it('siembra los roles de proveedor base (F1-E1B, R15) de forma idempotente', async () => {
    const roles = await prisma.rolProveedor.findMany({ select: { codigo: true } });
    const codigos = roles.map((r) => r.codigo).sort();
    // Fusión de terceros (D12/R15): el seed siembra 9 roles de servicio. `estampado` y
    // `aplicacion` se sembraron por separado (el viejo `estampado-aplicacion` ya NO se
    // siembra; en BD fresca de CI no existe, así que no va en la lista esperada).
    expect(codigos).toEqual(
      [
        'maquila-costura',
        'corte',
        'estampado',
        'bordado',
        'lavado',
        'aplicacion',
        'vende-telas',
        'vende-avios',
        'otros-servicios',
      ].sort(),
    );
  });

  it('siembra los 8 géneros base (F1-E4) de forma idempotente', async () => {
    const generos = await prisma.genero.findMany({ select: { nombre: true } });
    const nombres = generos.map((g) => g.nombre).sort();
    // Los 8 géneros del sistema viejo (doc 01-Modelos §3, lista de precios por género).
    expect(nombres).toEqual(
      [
        'Caballero',
        'Dama',
        'Niño Infantil',
        'Niña Infantil',
        'Niño Juvenil',
        'Niña Juvenil',
        'Bebo',
        'Beba',
      ].sort(),
    );
  });

  it('el admin queda con cuenta credential (hash, nunca texto plano) y rol Administrador completo', async () => {
    const admin = await prisma.usuario.findUniqueOrThrow({
      where: { username: 'admin' },
      include: { cuentas: true, roles: { include: { rol: true } } },
    });
    expect(admin.activo).toBe(true);
    expect(admin.bloqueado).toBe(false);

    const credencial = admin.cuentas.find((c) => c.providerId === 'credential');
    expect(credencial?.accountId).toBe(admin.id);
    // Hash scrypt de better-auth ("salt:hash"); jamás la contraseña en claro (doc 10 §6.3).
    expect(credencial?.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);

    expect(admin.roles.map((r) => r.rol.nombre)).toContain('Administrador');
    const rolAdmin = await prisma.rol.findUniqueOrThrow({
      where: { nombre: 'Administrador' },
      include: { _count: { select: { permisos: true } } },
    });
    expect(rolAdmin.esSistema).toBe(true);
    expect(rolAdmin._count.permisos).toBe(CATALOGO_PERMISOS.length);
  });

  it('la cascada de roles respeta el orden de niveles del sistema viejo (doc 00 §2)', async () => {
    const roles = await prisma.rol.findMany({
      include: { _count: { select: { permisos: true } } },
    });
    const cuenta = new Map(roles.map((r) => [r.nombre, r._count.permisos]));
    const admin = cuenta.get('Administrador') ?? -1;
    const directivo = cuenta.get('Directivo') ?? -1;
    const gerencial = cuenta.get('Gerencial') ?? -1;
    const ventas = cuenta.get('Ventas') ?? -1;
    const logistica = cuenta.get('Logistica') ?? -1;

    expect(cuenta.get('AdministracionDireccion')).toBe(admin);
    expect(directivo).toBeLessThan(admin);
    expect(gerencial).toBeLessThan(directivo);
    expect(ventas).toBeLessThan(gerencial);
    expect(logistica).toBeLessThan(ventas);
    expect(cuenta.get('Asistente')).toBe(logistica);
    expect(cuenta.get('Secretarial')).toBe(logistica);
    expect(cuenta.get('Basico')).toBe(0);
  });
});
