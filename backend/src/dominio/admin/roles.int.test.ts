import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../../datos/index.js';
import { ErrorConflicto, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import {
  clientePruebas,
  crearEmpresaPrueba,
  limpiarBaseDatos,
  sembrarPermisos,
} from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarRol,
  asignarPermisos,
  crearRol,
  eliminarRol,
  listarRoles,
  obtenerRol,
} from './roles.js';
import { crearUsuario } from './usuarios.js';

let cliente: PrismaClient;
let empresa: Empresa;

const sesionAdmin = () =>
  sesionDePrueba({
    idEmpresaActiva: empresa.id,
    permisos: ['roles.administrar', 'usuarios.administrar'],
  });

const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  await sembrarPermisos(cliente);
});

describe('administración de roles (A4)', () => {
  it('crea un rol con permisos del catálogo y bitácora', async () => {
    const sesion = sesionAdmin();
    const rol = await crearRol(
      sesion,
      {
        nombre: 'Almacenista',
        descripcion: 'Opera almacenes',
        clavesPermisos: ['almacenes.ver', 'almacenes.administrar'],
      },
      bd(),
    );

    expect(rol.nombre).toBe('Almacenista');
    expect(rol.esSistema).toBe(false);
    expect(rol.clavesPermisos).toEqual(['almacenes.administrar', 'almacenes.ver']);
    expect(rol.totalUsuarios).toBe(0);

    await expect(
      cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Rol', idEntidad: String(rol.id), accion: 'CREAR' },
      }),
    ).resolves.toBeTruthy();
  });

  it('rechaza claves fuera del catálogo tipado → ErrorValidacion', async () => {
    await expect(
      crearRol(sesionAdmin(), { nombre: 'Roto', clavesPermisos: ['inventado.permiso'] }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('nombre duplicado (sin importar mayúsculas) → ErrorConflicto', async () => {
    await crearRol(sesionAdmin(), { nombre: 'Almacenista' }, bd());
    await expect(crearRol(sesionAdmin(), { nombre: 'ALMACENISTA' }, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('sin permiso roles.administrar → ErrorPermiso', async () => {
    const sinPermiso = sesionDePrueba({ idEmpresaActiva: empresa.id });
    await expect(crearRol(sinPermiso, { nombre: 'X' }, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(listarRoles(sinPermiso, bd())).rejects.toBeInstanceOf(ErrorPermiso);
  });

  describe('roles de sistema (sembrados desde los niveles del viejo, doc 00 §2)', () => {
    it('NO se renombran ni se borran; su descripción y permisos SÍ se ajustan', async () => {
      const sesion = sesionAdmin();
      const sistema = await cliente.rol.create({
        data: { nombre: 'Directivo', descripcion: 'Nivel 30 del viejo', esSistema: true },
      });

      await expect(
        actualizarRol(sesion, sistema.id, { nombre: 'Otro nombre' }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      await expect(eliminarRol(sesion, sistema.id, bd())).rejects.toBeInstanceOf(ErrorValidacion);

      const conDescripcion = await actualizarRol(
        sesion,
        sistema.id,
        { descripcion: 'Dirección general' },
        bd(),
      );
      expect(conDescripcion.descripcion).toBe('Dirección general');

      const conPermisos = await asignarPermisos(sesion, sistema.id, ['rc.ver-botones'], bd());
      expect(conPermisos.clavesPermisos).toEqual(['rc.ver-botones']);
    });
  });

  it('asignarPermisos REEMPLAZA el conjunto', async () => {
    const sesion = sesionAdmin();
    const rol = await crearRol(
      sesion,
      { nombre: 'Almacenista', clavesPermisos: ['almacenes.ver'] },
      bd(),
    );

    const cambiado = await asignarPermisos(sesion, rol.id, ['usuarios.administrar'], bd());
    expect(cambiado.clavesPermisos).toEqual(['usuarios.administrar']);
  });

  it('eliminar un rol con usuarios asignados → ErrorConflicto; sin usuarios se borra', async () => {
    const sesion = sesionAdmin();
    const rol = await crearRol(sesion, { nombre: 'Temporal' }, bd());
    await crearUsuario(
      sesion,
      { username: 'caro', nombre: 'Carolina', password: 'secreta-larga-1', idsRoles: [rol.id] },
      bd(),
    );

    await expect(eliminarRol(sesion, rol.id, bd())).rejects.toBeInstanceOf(ErrorConflicto);

    const sinUsuarios = await crearRol(sesion, { nombre: 'Borrable' }, bd());
    await eliminarRol(sesion, sinUsuarios.id, bd());
    await expect(obtenerRol(sesion, sinUsuarios.id, bd())).rejects.toThrow();
  });

  it('renombrar un rol propio funciona y respeta unicidad', async () => {
    const sesion = sesionAdmin();
    const rol = await crearRol(sesion, { nombre: 'Almacenista' }, bd());
    await crearRol(sesion, { nombre: 'Consulta' }, bd());

    const renombrado = await actualizarRol(sesion, rol.id, { nombre: 'Bodeguero' }, bd());
    expect(renombrado.nombre).toBe('Bodeguero');

    await expect(
      actualizarRol(sesion, rol.id, { nombre: 'consulta' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});
