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
  obtenerUsuario,
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

  /**
   * Guard anti-lockout (V1-E6c). Invariante GLOBAL: el sistema NUNCA puede quedar
   * sin ningún usuario ACTIVO con `usuarios.administrar`. Se protege que quede un
   * administrador vivo, no a una persona en concreto: aplica igual sobre uno mismo
   * que sobre otro, y por las TRES puertas de `actualizarUsuario` (quitar el rol,
   * desactivar, bloquear).
   *
   * El `pg_advisory_xact_lock` de clave CONSTANTE que serializa estas rutas entre
   * sí (y con las de `roles.ts`) es lo que cierra el write-skew de dos
   * transacciones solapadas; probarlo con 2 tx reales es inviable con el cliente
   * único de testcontainers, así que aquí se cubre la invariante con casos
   * single-tx y el lock queda documentado en `guard-administradores.ts`.
   */
  describe('CRÍTICO: guard anti-lockout (siempre queda un administrador vivo)', () => {
    let rolAdmin: Rol;

    beforeEach(async () => {
      rolAdmin = await cliente.rol.create({
        data: {
          nombre: 'Administrador',
          descripcion: 'Gobierno del sistema',
          permisos: {
            create: [
              { permiso: { connect: { clave: 'usuarios.administrar' } } },
              { permiso: { connect: { clave: 'roles.administrar' } } },
            ],
          },
        },
      });
    });

    /** Da de alta un usuario CON el rol administrador. */
    const nuevoAdmin = (username: string) =>
      crearUsuario(
        sesionAdmin(),
        {
          username,
          nombre: username,
          password: 'secreta-larga-1',
          idsRoles: [rolAdmin.id],
        },
        bd(),
      );

    /** Sesión que ES ese usuario de la BD (para los casos "a sí mismo"). */
    const sesionDe = (id: string) =>
      sesionDePrueba({ id, idEmpresaActiva: empresa.id, permisos: ['usuarios.administrar'] });

    it('(a) el ÚNICO administrador no puede quitarse a sí mismo su rol de admin', async () => {
      const daniel = await nuevoAdmin('daniel');

      await expect(
        actualizarUsuario(sesionDe(daniel.id), { id: daniel.id, idsRoles: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);

      // Rollback: conserva su rol y sus permisos siguen vivos.
      const recargado = await obtenerUsuario(sesionAdmin(), daniel.id, bd());
      expect(recargado.roles.map((rol) => rol.id)).toEqual([rolAdmin.id]);
      const permisos = await cargarPermisosDeUsuario(daniel.id, bd());
      expect(permisos.has('usuarios.administrar')).toBe(true);
    });

    it('(b) tampoco OTRO puede quitarle el rol al ÚLTIMO administrador', async () => {
      const daniel = await nuevoAdmin('daniel');

      // La sesión que opera es un administrador distinto (aquí, la de pruebas):
      // el guard NO es "sobre uno mismo", es sobre la invariante.
      await expect(
        actualizarUsuario(sesionAdmin(), { id: daniel.id, idsRoles: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('(c) no se puede DESACTIVAR al último administrador (ni por el atajo)', async () => {
      const daniel = await nuevoAdmin('daniel');

      await expect(
        actualizarUsuario(sesionAdmin(), { id: daniel.id, activo: false }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
      await expect(desactivarUsuario(sesionAdmin(), daniel.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );

      const recargado = await obtenerUsuario(sesionAdmin(), daniel.id, bd());
      expect(recargado.activo).toBe(true);
    });

    it('tampoco se puede BLOQUEAR al último administrador (bloqueado = sin permisos)', async () => {
      const daniel = await nuevoAdmin('daniel');

      await expect(
        actualizarUsuario(sesionAdmin(), { id: daniel.id, bloqueado: true }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('(d) con DOS administradores, quitarle el rol a uno SÍ se permite', async () => {
      const daniel = await nuevoAdmin('daniel');
      await nuevoAdmin('aurora');

      const sinRol = await actualizarUsuario(sesionAdmin(), { id: daniel.id, idsRoles: [] }, bd());
      expect(sinRol.roles).toEqual([]);

      // …y ahora que Aurora es la última, a ELLA ya no se le puede quitar.
      const aurora = await cliente.usuario.findFirstOrThrow({ where: { username: 'aurora' } });
      await expect(
        actualizarUsuario(sesionAdmin(), { id: aurora.id, idsRoles: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('(e) el atajo asignarRoles NO sortea el guard', async () => {
      const daniel = await nuevoAdmin('daniel');

      await expect(asignarRoles(sesionAdmin(), daniel.id, [], bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
      // Cambiarlo a un rol SIN gobierno también lo deja sin la capacidad → rechazado.
      await expect(
        asignarRoles(sesionAdmin(), daniel.id, [rolAlmacenista.id], bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('un administrador INACTIVO o BLOQUEADO no rescata al último activo', async () => {
      const daniel = await nuevoAdmin('daniel');
      const dormida = await nuevoAdmin('dormida');
      const trabado = await nuevoAdmin('trabado');
      await cliente.usuario.update({ where: { id: dormida.id }, data: { activo: false } });
      await cliente.usuario.update({ where: { id: trabado.id }, data: { bloqueado: true } });

      await expect(
        actualizarUsuario(sesionAdmin(), { id: daniel.id, idsRoles: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('el mensaje dice la SALIDA: nombrar antes a otro administrador', async () => {
      const daniel = await nuevoAdmin('daniel');

      await expect(
        actualizarUsuario(sesionAdmin(), { id: daniel.id, idsRoles: [] }, bd()),
      ).rejects.toThrow(/Primero nombra a otro administrador/);
    });

    it('el guard NO estorba a quien nunca fue administrador', async () => {
      const caro = await crearUsuario(
        sesionAdmin(),
        {
          username: 'caro',
          nombre: 'Carolina',
          password: 'secreta-larga-1',
          idsRoles: [rolAlmacenista.id],
        },
        bd(),
      );
      // Hay UN administrador en el sistema, pero Caro no es él: se le puede
      // quitar el rol y desactivarla sin que el guard se meta.
      await nuevoAdmin('daniel');

      expect((await asignarRoles(sesionAdmin(), caro.id, [], bd())).roles).toEqual([]);
      expect((await desactivarUsuario(sesionAdmin(), caro.id, bd())).activo).toBe(false);
    });

    it('el guard tampoco estorba cuando el cambio CONSERVA la capacidad', async () => {
      const daniel = await nuevoAdmin('daniel');
      const otroAdmin = await cliente.rol.create({
        data: {
          nombre: 'Administrador 2',
          descripcion: 'Otro camino al mismo permiso',
          permisos: {
            create: [
              { permiso: { connect: { clave: 'usuarios.administrar' } } },
              { permiso: { connect: { clave: 'roles.administrar' } } },
            ],
          },
        },
      });

      // Cambia de rol, pero el nuevo otorga lo mismo → permitido.
      const cambiado = await actualizarUsuario(
        sesionAdmin(),
        { id: daniel.id, idsRoles: [otroAdmin.id] },
        bd(),
      );
      expect(cambiado.roles.map((rol) => rol.id)).toEqual([otroAdmin.id]);

      // Y una edición que ni toca roles ni estado pasa sin problema.
      const renombrado = await actualizarUsuario(
        sesionAdmin(),
        { id: daniel.id, nombre: 'Daniel Masri' },
        bd(),
      );
      expect(renombrado.nombre).toBe('Daniel Masri');
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
