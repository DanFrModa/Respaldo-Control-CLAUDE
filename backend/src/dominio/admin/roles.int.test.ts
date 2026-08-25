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

  /**
   * Guard anti-lockout a nivel USUARIO. Un `pg_advisory_xact_lock` de clave
   * CONSTANTE serializa `asignarPermisos` y `eliminarRol` entre sí: eso es lo que
   * cierra el write-skew de dos transacciones solapadas (probarlo con 2 tx reales
   * es inviable con el cliente único de testcontainers, por eso aquí se cubre la
   * invariante con casos single-tx y el lock queda documentado en el dominio).
   */
  describe('guard anti-lockout de roles.administrar (seguridad RBAC, nivel usuario)', () => {
    const nuevoUsuario = (username: string, idRol: number) =>
      crearUsuario(
        sesionAdmin(),
        { username, nombre: username, password: 'secreta-larga-1', idsRoles: [idRol] },
        bd(),
      );

    it('rechaza quitar la clave admin del último rol con un usuario activo que la tiene', async () => {
      const sesion = sesionAdmin();
      const adminRol = await crearRol(
        sesion,
        { nombre: 'Admin', clavesPermisos: ['roles.administrar'] },
        bd(),
      );
      await nuevoUsuario('jefa', adminRol.id);

      await expect(
        asignarPermisos(sesion, adminRol.id, ['usuarios.administrar'], bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);

      // La transacción hizo rollback: el rol conserva intacto su permiso.
      const recargado = await obtenerRol(sesion, adminRol.id, bd());
      expect(recargado.clavesPermisos).toContain('roles.administrar');
    });

    it('permite quitarla si OTRO rol con usuario activo conserva la capacidad', async () => {
      const sesion = sesionAdmin();
      const admin1 = await crearRol(
        sesion,
        { nombre: 'Admin1', clavesPermisos: ['roles.administrar'] },
        bd(),
      );
      const admin2 = await crearRol(
        sesion,
        { nombre: 'Admin2', clavesPermisos: ['roles.administrar'] },
        bd(),
      );
      await nuevoUsuario('ana', admin1.id);
      await nuevoUsuario('beto', admin2.id);

      const cambiado = await asignarPermisos(sesion, admin1.id, ['usuarios.administrar'], bd());
      expect(cambiado.clavesPermisos).toEqual(['usuarios.administrar']);
    });

    it('un rol admin con 0 usuarios NO cuenta como quien administra (huérfano)', async () => {
      const sesion = sesionAdmin();
      const conUsuarios = await crearRol(
        sesion,
        { nombre: 'AdminConUsuarios', clavesPermisos: ['roles.administrar'] },
        bd(),
      );
      await nuevoUsuario('cata', conUsuarios.id);
      // Rol admin huérfano: tiene la clave pero NADIE lo usa (0 usuarios).
      await crearRol(
        sesion,
        { nombre: 'AdminHuerfano', clavesPermisos: ['roles.administrar'] },
        bd(),
      );

      // Quitar admin al ÚNICO rol con usuarios deja al sistema sin administradores reales.
      await expect(
        asignarPermisos(sesion, conUsuarios.id, ['usuarios.administrar'], bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('un usuario INACTIVO no sostiene la capacidad de administrar', async () => {
      const sesion = sesionAdmin();
      const adminRol = await crearRol(
        sesion,
        { nombre: 'Admin', clavesPermisos: ['roles.administrar'] },
        bd(),
      );
      const usuario = await nuevoUsuario('zoe', adminRol.id);
      await cliente.usuario.update({ where: { id: usuario.id }, data: { activo: false } });

      await expect(
        asignarPermisos(sesion, adminRol.id, ['usuarios.administrar'], bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('no bloquea a un rol que NUNCA tuvo roles.administrar', async () => {
      const sesion = sesionAdmin();
      const rol = await crearRol(
        sesion,
        { nombre: 'Ventas', clavesPermisos: ['almacenes.ver'] },
        bd(),
      );
      const cambiado = await asignarPermisos(sesion, rol.id, ['usuarios.administrar'], bd());
      expect(cambiado.clavesPermisos).toEqual(['usuarios.administrar']);
    });

    it('protege TAMBIÉN usuarios.administrar, no solo roles.administrar', async () => {
      const sesion = sesionAdmin();
      // Rol que SOLO otorga la administración de usuarios: si esta clave no
      // estuviera protegida aquí, el guard de `actualizarUsuario` se podría
      // sortear en dos clics desde la pantalla de Roles.
      const soloUsuarios = await crearRol(
        sesion,
        { nombre: 'AdminUsuarios', clavesPermisos: ['usuarios.administrar'] },
        bd(),
      );
      // Otro rol conserva `roles.administrar`, así que ESA clave no es la que salta.
      const soloRoles = await crearRol(
        sesion,
        { nombre: 'AdminRoles', clavesPermisos: ['roles.administrar'] },
        bd(),
      );
      await nuevoUsuario('uni', soloUsuarios.id);
      await nuevoUsuario('rola', soloRoles.id);

      await expect(
        asignarPermisos(sesion, soloUsuarios.id, ['almacenes.ver'], bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);

      const recargado = await obtenerRol(sesion, soloUsuarios.id, bd());
      expect(recargado.clavesPermisos).toContain('usuarios.administrar');
    });

    it('un usuario BLOQUEADO tampoco sostiene la capacidad de administrar', async () => {
      const sesion = sesionAdmin();
      const adminRol = await crearRol(
        sesion,
        { nombre: 'Admin', clavesPermisos: ['roles.administrar'] },
        bd(),
      );
      const usuario = await nuevoUsuario('trabado', adminRol.id);
      await cliente.usuario.update({ where: { id: usuario.id }, data: { bloqueado: true } });

      await expect(
        asignarPermisos(sesion, adminRol.id, ['usuarios.administrar'], bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    describe('eliminarRol (guard simétrico)', () => {
      it('rechaza borrar el último rol no-sistema que otorga admin', async () => {
        const sesion = sesionAdmin();
        const soloAdmin = await crearRol(
          sesion,
          { nombre: 'SoloAdmin', clavesPermisos: ['roles.administrar'] },
          bd(),
        );

        await expect(eliminarRol(sesion, soloAdmin.id, bd())).rejects.toBeInstanceOf(
          ErrorConflicto,
        );
        await expect(obtenerRol(sesion, soloAdmin.id, bd())).resolves.toBeTruthy();
      });

      it('permite borrar un rol admin sin usuarios si OTRO rol con usuario activo administra', async () => {
        const sesion = sesionAdmin();
        const conUsuarios = await crearRol(
          sesion,
          { nombre: 'AdminVivo', clavesPermisos: ['roles.administrar'] },
          bd(),
        );
        await nuevoUsuario('dani', conUsuarios.id);
        const borrable = await crearRol(
          sesion,
          { nombre: 'AdminExtra', clavesPermisos: ['roles.administrar'] },
          bd(),
        );

        await eliminarRol(sesion, borrable.id, bd());
        await expect(obtenerRol(sesion, borrable.id, bd())).rejects.toThrow();
      });

      it('borra sin guard un rol que NO otorga admin', async () => {
        const sesion = sesionAdmin();
        const rol = await crearRol(
          sesion,
          { nombre: 'Bodega', clavesPermisos: ['almacenes.ver'] },
          bd(),
        );
        await eliminarRol(sesion, rol.id, bd());
        await expect(obtenerRol(sesion, rol.id, bd())).rejects.toThrow();
      });
    });
  });
});
