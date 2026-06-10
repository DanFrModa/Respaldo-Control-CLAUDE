import { verifyPassword } from 'better-auth/crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient, Rol } from '../../datos/index.js';
import { ErrorConflicto, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { cargarPermisosDeUsuario } from '../../comun/permisos.js';
import {
  clientePruebas,
  crearEmpresaPrueba,
  limpiarBaseDatos,
  sembrarPermisos,
} from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarUsuario,
  asignarRoles,
  crearUsuario,
  desactivarUsuario,
  desbloquearUsuario,
  listarUsuarios,
  reactivarUsuario,
} from './usuarios.js';

let cliente: PrismaClient;
let empresa: Empresa;
let rolAlmacenista: Rol;

const sesionAdmin = () =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: ['usuarios.administrar'] });

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
  rolAlmacenista = await cliente.rol.create({
    data: {
      nombre: 'Almacenista',
      descripcion: 'Rol de pruebas',
      permisos: {
        create: [
          { permiso: { connect: { clave: 'almacenes.ver' } } },
          { permiso: { connect: { clave: 'almacenes.administrar' } } },
        ],
      },
    },
  });
});

describe('administración de usuarios (doc 00 §1.1, doc 10 §4, A4)', () => {
  describe('crear', () => {
    it('crea usuario + credencial scrypt + roles + bitácora en UNA transacción', async () => {
      const sesion = sesionAdmin();
      const usuario = await crearUsuario(
        sesion,
        {
          username: 'Caro',
          nombre: 'Carolina',
          password: 'secreta-larga-1',
          idsRoles: [rolAlmacenista.id],
        },
        bd(),
      );

      // username normalizado; forma original conservada; email sintético.
      expect(usuario.username).toBe('caro');
      expect(usuario.email).toBe('caro@control.local');
      expect(usuario.roles.map((rol) => rol.nombre)).toEqual(['Almacenista']);
      const enBd = await cliente.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
      expect(enBd.displayUsername).toBe('Caro');
      expect(enBd.creadoPorId).toBe(sesion.id);

      // La credencial es un hash scrypt VERIFICABLE por better-auth (ADR-0003)…
      const cuenta = await cliente.cuenta.findFirstOrThrow({
        where: { userId: usuario.id, providerId: 'credential' },
      });
      expect(cuenta.accountId).toBe(usuario.id);
      expect(cuenta.password).not.toBeNull();
      expect(cuenta.password).not.toContain('secreta-larga-1'); // jamás en claro
      await expect(
        verifyPassword({ hash: cuenta.password ?? '', password: 'secreta-larga-1' }),
      ).resolves.toBe(true);

      // …y ni el DTO ni la bitácora exponen secretos.
      expect(JSON.stringify(usuario)).not.toContain(cuenta.password);
      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Usuario', idEntidad: usuario.id, accion: 'CREAR' },
      });
      expect(JSON.stringify(bitacora.datos)).not.toContain('secreta');
    });

    it('username repetido → ErrorConflicto', async () => {
      await crearUsuario(
        sesionAdmin(),
        { username: 'caro', nombre: 'Carolina', password: 'secreta-larga-1' },
        bd(),
      );
      await expect(
        crearUsuario(
          sesionAdmin(),
          { username: 'CARO', nombre: 'Otra Caro', password: 'secreta-larga-2' },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('rol inexistente → ErrorValidacion y NO crea el usuario (atomicidad)', async () => {
      await expect(
        crearUsuario(
          sesionAdmin(),
          { username: 'caro', nombre: 'Carolina', password: 'secreta-larga-1', idsRoles: [9999] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.usuario.count()).toBe(0);
      expect(await cliente.cuenta.count()).toBe(0);
    });

    it('sin permiso usuarios.administrar → ErrorPermiso', async () => {
      const sinPermiso = sesionDePrueba({ idEmpresaActiva: empresa.id });
      await expect(
        crearUsuario(sinPermiso, { username: 'x', nombre: 'X', password: 'secreta-larga-1' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
    });
  });

  describe('CRÍTICO: desbloqueo manual (doc 00 §1.1)', () => {
    it('desbloquear pone bloqueado=false e intentosFallidos=0, con bitácora', async () => {
      const sesion = sesionAdmin();
      const usuario = await crearUsuario(
        sesion,
        { username: 'lulu', nombre: 'Lulú', password: 'secreta-larga-1' },
        bd(),
      );
      // El login (E3) lo dejó bloqueado al 5º intento fallido.
      await cliente.usuario.update({
        where: { id: usuario.id },
        data: { bloqueado: true, intentosFallidos: 5 },
      });

      const desbloqueado = await desbloquearUsuario(sesion, usuario.id, bd());
      expect(desbloqueado.bloqueado).toBe(false);
      expect(desbloqueado.intentosFallidos).toBe(0);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Usuario', idEntidad: usuario.id, accion: 'MODIFICAR' },
        orderBy: { fecha: 'desc' },
      });
      expect(bitacora.datos).toMatchObject({ operacion: 'desbloquear' });
    });

    it('también limpia intentos acumulados aunque aún no llegue al bloqueo', async () => {
      const sesion = sesionAdmin();
      const usuario = await crearUsuario(
        sesion,
        { username: 'tile', nombre: 'Tile', password: 'secreta-larga-1' },
        bd(),
      );
      await cliente.usuario.update({
        where: { id: usuario.id },
        data: { intentosFallidos: 3 },
      });

      const limpio = await desbloquearUsuario(sesion, usuario.id, bd());
      expect(limpio.intentosFallidos).toBe(0);
    });

    it('desbloquear a alguien no bloqueado → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const usuario = await crearUsuario(
        sesion,
        { username: 'caro', nombre: 'Carolina', password: 'secreta-larga-1' },
        bd(),
      );
      await expect(desbloquearUsuario(sesion, usuario.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });
  });

  describe('desactivar / reactivar (borrado suave)', () => {
    it('desactiva con bitácora DESACTIVAR; reactivar lo regresa', async () => {
      const sesion = sesionAdmin();
      const usuario = await crearUsuario(
        sesion,
        { username: 'caro', nombre: 'Carolina', password: 'secreta-larga-1' },
        bd(),
      );

      const inactivo = await desactivarUsuario(sesion, usuario.id, bd());
      expect(inactivo.activo).toBe(false);
      await expect(
        cliente.bitacora.findFirstOrThrow({
          where: { entidad: 'Usuario', idEntidad: usuario.id, accion: 'DESACTIVAR' },
        }),
      ).resolves.toBeTruthy();

      const activo = await reactivarUsuario(sesion, usuario.id, bd());
      expect(activo.activo).toBe(true);
    });

    it('nadie puede desactivarse a sí mismo → ErrorValidacion', async () => {
      const sesion = sesionAdmin();
      const usuario = await crearUsuario(
        sesion,
        { username: 'admin2', nombre: 'Admin', password: 'secreta-larga-1' },
        bd(),
      );
      const sesionPropia = sesionDePrueba({
        id: usuario.id,
        idEmpresaActiva: empresa.id,
        permisos: ['usuarios.administrar'],
      });
      await expect(desactivarUsuario(sesionPropia, usuario.id, bd())).rejects.toBeInstanceOf(
        ErrorValidacion,
      );
    });
  });

  describe('actualizar y roles', () => {
    it('actualiza datos generales y reemplaza el conjunto de roles', async () => {
      const sesion = sesionAdmin();
      const otroRol = await cliente.rol.create({
        data: { nombre: 'Consulta', descripcion: 'Solo lectura' },
      });
      const usuario = await crearUsuario(
        sesion,
        {
          username: 'caro',
          nombre: 'Carolina',
          password: 'secreta-larga-1',
          idsRoles: [rolAlmacenista.id],
        },
        bd(),
      );

      const actualizado = await actualizarUsuario(
        sesion,
        { id: usuario.id, nombre: 'Carolina M.', esAuditor: true, idsRoles: [otroRol.id] },
        bd(),
      );
      expect(actualizado.nombre).toBe('Carolina M.');
      expect(actualizado.esAuditor).toBe(true);
      expect(actualizado.roles.map((rol) => rol.id)).toEqual([otroRol.id]);
    });

    it('asignarRoles([]) deja al usuario sin roles (y sin permisos)', async () => {
      const sesion = sesionAdmin();
      const usuario = await crearUsuario(
        sesion,
        {
          username: 'caro',
          nombre: 'Carolina',
          password: 'secreta-larga-1',
          idsRoles: [rolAlmacenista.id],
        },
        bd(),
      );

      const sinRoles = await asignarRoles(sesion, usuario.id, [], bd());
      expect(sinRoles.roles).toEqual([]);
      expect(await cargarPermisosDeUsuario(usuario.id, bd())).toEqual(new Set());
    });
  });

  describe('cargarPermisosDeUsuario (roles→permisos)', () => {
    it('devuelve la unión de permisos de los roles del usuario activo', async () => {
      const sesion = sesionAdmin();
      const usuario = await crearUsuario(
        sesion,
        {
          username: 'caro',
          nombre: 'Carolina',
          password: 'secreta-larga-1',
          idsRoles: [rolAlmacenista.id],
        },
        bd(),
      );

      const permisos = await cargarPermisosDeUsuario(usuario.id, bd());
      expect(permisos).toEqual(new Set(['almacenes.ver', 'almacenes.administrar']));
    });

    it('usuario BLOQUEADO o INACTIVO no conserva ningún permiso (denegar por defecto)', async () => {
      const sesion = sesionAdmin();
      const usuario = await crearUsuario(
        sesion,
        {
          username: 'caro',
          nombre: 'Carolina',
          password: 'secreta-larga-1',
          idsRoles: [rolAlmacenista.id],
        },
        bd(),
      );

      await cliente.usuario.update({ where: { id: usuario.id }, data: { bloqueado: true } });
      expect(await cargarPermisosDeUsuario(usuario.id, bd())).toEqual(new Set());

      await cliente.usuario.update({
        where: { id: usuario.id },
        data: { bloqueado: false, activo: false },
      });
      expect(await cargarPermisosDeUsuario(usuario.id, bd())).toEqual(new Set());
    });

    it('usuario inexistente → set vacío', async () => {
      expect(await cargarPermisosDeUsuario('no-existe', bd())).toEqual(new Set());
    });
  });

  describe('listar', () => {
    it('busca, filtra bloqueados y NUNCA expone hashes', async () => {
      const sesion = sesionAdmin();
      await crearUsuario(
        sesion,
        { username: 'caro', nombre: 'Carolina', password: 'secreta-larga-1' },
        bd(),
      );
      const bloqueada = await crearUsuario(
        sesion,
        { username: 'lulu', nombre: 'Lulú', password: 'secreta-larga-2' },
        bd(),
      );
      await cliente.usuario.update({
        where: { id: bloqueada.id },
        data: { bloqueado: true, intentosFallidos: 5 },
      });

      const todos = await listarUsuarios(sesion, {}, bd());
      expect(todos.total).toBe(2);
      expect(JSON.stringify(todos)).not.toContain('password');

      const bloqueados = await listarUsuarios(sesion, { soloBloqueados: true }, bd());
      expect(bloqueados.total).toBe(1);
      expect(bloqueados.datos[0]?.username).toBe('lulu');

      const busqueda = await listarUsuarios(sesion, { busqueda: 'carol' }, bd());
      expect(busqueda.total).toBe(1);
    });
  });
});
