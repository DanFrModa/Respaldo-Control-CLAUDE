import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Cliente,
  ClienteDepartamento,
  Empresa,
  PrismaClient,
  Temporada,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarProyecto,
  archivarProyecto,
  crearProyecto,
  desarchivarProyecto,
  listarProyectos,
  obtenerProyecto,
} from './proyectos.js';

/**
 * Integración del dominio de Proyectos de desarrollo (F8-E2) contra el Postgres efímero
 * (testcontainers). Cubre lo que SÓLO la base valida: folio por empresa sin colisión (A3/A9),
 * validación depto↔cliente (A1), filtros/orden, archivar/desarchivar (borrado suave) y los conteos
 * de desarrollos por estado derivado. NO corre en local (usa Docker): el CI.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let clienteNegocio: Cliente;
let departamento: ClienteDepartamento;
let temporada: Temporada;

/** Sesión sobre la empresa de prueba con los permisos dados. */
function sesion(permisos: ClavePermiso[]): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
}

const PERM_TODOS: ClavePermiso[] = ['desarrollo.ver', 'desarrollo.administrar'];
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
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'C&A' } });
  departamento = await cliente.clienteDepartamento.create({
    data: { idCliente: clienteNegocio.id, nombre: 'NIÑOS' },
  });
  temporada = await cliente.temporada.create({ data: { nombre: 'PV-26' } });
});

/** Alta base de un proyecto válido (cliente + su departamento). */
function entradaProyecto(overrides: Record<string, unknown> = {}): {
  idCliente: number;
  idClienteDepartamento: number;
  nombre: string;
} {
  return {
    idCliente: clienteNegocio.id,
    idClienteDepartamento: departamento.id,
    nombre: 'Joggers',
    ...overrides,
  };
}

describe('Proyectos de desarrollo (F8-E2)', () => {
  describe('permisos (deny-by-default, A4)', () => {
    it('sin administrar no se crea; sin ver no se lista', async () => {
      await expect(
        crearProyecto(sesion(['desarrollo.ver']), entradaProyecto(), bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarProyectos(sesionDePrueba(), {}, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
    });
  });

  describe('crear', () => {
    it('crea con folio por secuencia atómica (A3) y bitácora (A7)', async () => {
      const p1 = await crearProyecto(sesion(PERM_TODOS), entradaProyecto(), bd());
      const p2 = await crearProyecto(
        sesion(PERM_TODOS),
        entradaProyecto({ nombre: 'Básicos' }),
        bd(),
      );
      expect(p1.folio).toBe(1);
      expect(p2.folio).toBe(2);
      expect(p1).toMatchObject({
        idCliente: clienteNegocio.id,
        cliente: 'C&A',
        departamento: 'NIÑOS',
        nombre: 'Joggers',
        archivado: false,
      });
      expect(p1.conteos.total).toBe(0);
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Proyecto', idEntidad: String(p1.id), accion: 'CREAR' },
      });
    });

    it('permite varios proyectos del MISMO cliente+departamento (sólo el folio es único)', async () => {
      await crearProyecto(sesion(PERM_TODOS), entradaProyecto(), bd());
      await expect(
        crearProyecto(sesion(PERM_TODOS), entradaProyecto(), bd()),
      ).resolves.toMatchObject({ nombre: 'Joggers' });
    });

    it('guarda la temporada cuando se especifica', async () => {
      const p = await crearProyecto(
        sesion(PERM_TODOS),
        entradaProyecto({ idTemporada: temporada.id }),
        bd(),
      );
      expect(p.idTemporada).toBe(temporada.id);
      expect(p.temporada).toBe('PV-26');
    });

    it('rechaza un departamento de OTRO cliente → ErrorValidacion', async () => {
      const otro = await cliente.cliente.create({ data: { nombre: 'Suburbia' } });
      const deptoOtro = await cliente.clienteDepartamento.create({
        data: { idCliente: otro.id, nombre: 'DAMAS' },
      });
      await expect(
        crearProyecto(
          sesion(PERM_TODOS),
          entradaProyecto({ idClienteDepartamento: deptoOtro.id }),
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza un cliente DESACTIVADO → ErrorConflicto', async () => {
      await cliente.cliente.update({ where: { id: clienteNegocio.id }, data: { activo: false } });
      await expect(
        crearProyecto(sesion(PERM_TODOS), entradaProyecto(), bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('rechaza una temporada inexistente → ErrorNoEncontrado', async () => {
      await expect(
        crearProyecto(sesion(PERM_TODOS), entradaProyecto({ idTemporada: 9999 }), bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('actualizar', () => {
    it('cambia el nombre y deja bitácora MODIFICAR', async () => {
      const p = await crearProyecto(sesion(PERM_TODOS), entradaProyecto(), bd());
      const actualizado = await actualizarProyecto(
        sesion(PERM_TODOS),
        p.id,
        { nombre: 'Joggers PV' },
        bd(),
      );
      expect(actualizado.nombre).toBe('Joggers PV');
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Proyecto', idEntidad: String(p.id), accion: 'MODIFICAR' },
      });
    });

    it('al cambiar el departamento valida que sea del MISMO cliente', async () => {
      const p = await crearProyecto(sesion(PERM_TODOS), entradaProyecto(), bd());
      const otro = await cliente.cliente.create({ data: { nombre: 'Walmart' } });
      const deptoOtro = await cliente.clienteDepartamento.create({
        data: { idCliente: otro.id, nombre: 'BEBÉS' },
      });
      await expect(
        actualizarProyecto(sesion(PERM_TODOS), p.id, { idClienteDepartamento: deptoOtro.id }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('vacía la temporada con null', async () => {
      const p = await crearProyecto(
        sesion(PERM_TODOS),
        entradaProyecto({ idTemporada: temporada.id }),
        bd(),
      );
      const actualizado = await actualizarProyecto(
        sesion(PERM_TODOS),
        p.id,
        { idTemporada: null },
        bd(),
      );
      expect(actualizado.idTemporada).toBeNull();
      expect(actualizado.temporada).toBeNull();
    });

    it('sin cambio real es idempotente: no escribe bitácora ni bumpea la modificación', async () => {
      const p = await crearProyecto(sesion(PERM_TODOS), entradaProyecto(), bd());
      const antesBitacora = await cliente.bitacora.count();
      const antes = await cliente.proyecto.findUniqueOrThrow({ where: { id: p.id } });

      // Mismo nombre + mismo departamento: nada cambia.
      await actualizarProyecto(
        sesion(PERM_TODOS),
        p.id,
        { nombre: p.nombre, idClienteDepartamento: departamento.id },
        bd(),
      );

      expect(await cliente.bitacora.count()).toBe(antesBitacora);
      const despues = await cliente.proyecto.findUniqueOrThrow({ where: { id: p.id } });
      expect(despues.modificadoEn.getTime()).toBe(antes.modificadoEn.getTime());
    });

    it('un proyecto de otra empresa no se actualiza → ErrorNoEncontrado (A9)', async () => {
      const p = await crearProyecto(sesion(PERM_TODOS), entradaProyecto(), bd());
      const otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra empresa');
      const sesionOtra = sesionDePrueba({ idEmpresaActiva: otraEmpresa.id, permisos: PERM_TODOS });
      await expect(
        actualizarProyecto(sesionOtra, p.id, { nombre: 'Ajeno' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('archivar / desarchivar (borrado suave)', () => {
    it('archiva y desarchiva; el registro sigue existiendo', async () => {
      const p = await crearProyecto(sesion(PERM_TODOS), entradaProyecto(), bd());
      const archivado = await archivarProyecto(sesion(PERM_TODOS), p.id, bd());
      expect(archivado.archivado).toBe(true);
      expect(await cliente.proyecto.count()).toBe(1);
      const desarchivado = await desarchivarProyecto(sesion(PERM_TODOS), p.id, bd());
      expect(desarchivado.archivado).toBe(false);
    });

    it('archivar dos veces → ErrorConflicto', async () => {
      const p = await crearProyecto(sesion(PERM_TODOS), entradaProyecto(), bd());
      await archivarProyecto(sesion(PERM_TODOS), p.id, bd());
      await expect(archivarProyecto(sesion(PERM_TODOS), p.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });

    it('archivar/desarchivar un proyecto de otra empresa → ErrorNoEncontrado (A9)', async () => {
      const p = await crearProyecto(sesion(PERM_TODOS), entradaProyecto(), bd());
      const otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra empresa');
      const sesionOtra = sesionDePrueba({ idEmpresaActiva: otraEmpresa.id, permisos: PERM_TODOS });
      await expect(archivarProyecto(sesionOtra, p.id, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
      await expect(desarchivarProyecto(sesionOtra, p.id, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });
  });

  describe('listar / obtener', () => {
    it('excluye archivados por defecto y filtra por cliente/departamento/temporada', async () => {
      const p1 = await crearProyecto(sesion(PERM_TODOS), entradaProyecto(), bd());
      const p2 = await crearProyecto(
        sesion(PERM_TODOS),
        entradaProyecto({ nombre: 'Con temporada', idTemporada: temporada.id }),
        bd(),
      );
      await archivarProyecto(sesion(PERM_TODOS), p2.id, bd());

      const activos = await listarProyectos(sesion(PERM_TODOS), {}, bd());
      expect(activos.total).toBe(1);
      expect(activos.datos[0]?.id).toBe(p1.id);

      const todos = await listarProyectos(sesion(PERM_TODOS), { incluirArchivados: true }, bd());
      expect(todos.total).toBe(2);

      const porTemporada = await listarProyectos(
        sesion(PERM_TODOS),
        { incluirArchivados: true, idTemporada: temporada.id },
        bd(),
      );
      expect(porTemporada.total).toBe(1);
      expect(porTemporada.datos[0]?.id).toBe(p2.id);

      const porDepartamento = await listarProyectos(
        sesion(PERM_TODOS),
        { idClienteDepartamento: departamento.id },
        bd(),
      );
      expect(porDepartamento.total).toBe(1);
    });

    it('obtener uno de otra empresa → ErrorNoEncontrado (A9)', async () => {
      const p = await crearProyecto(sesion(PERM_TODOS), entradaProyecto(), bd());
      const otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra empresa');
      const sesionOtra = sesionDePrueba({ idEmpresaActiva: otraEmpresa.id, permisos: PERM_TODOS });
      await expect(obtenerProyecto(sesionOtra, p.id, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });
  });
});
