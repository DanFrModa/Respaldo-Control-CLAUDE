import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Cliente,
  ClienteDepartamento,
  Empresa,
  Modelo,
  PrismaClient,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarDesarrollo,
  apagarDesarrollo,
  calcularEstadoDesarrollo,
  crearDesarrollo,
  obtenerDesarrollo,
  reactivarDesarrollo,
} from './desarrollos.js';
import { crearProyecto, obtenerProyecto } from './proyectos.js';

/**
 * Integración del dominio de Desarrollos (F8-E2) contra el Postgres efímero (testcontainers). Cubre
 * lo que la base valida: unique proyecto+modelo, estado derivado (en-desarrollo/apagado, lo poblable
 * en E2), apagar/reactivar con motivo+auditoría. NO corre en local (usa Docker): el CI.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let clienteNegocio: Cliente;
let departamento: ClienteDepartamento;
let modeloA: Modelo;
let modeloB: Modelo;

function sesion(permisos: ClavePermiso[]): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
}

const PERM_TODOS: ClavePermiso[] = ['desarrollo.ver', 'desarrollo.administrar'];
const bd = () => ({ cliente });

/** Crea un proyecto y devuelve su id (para colgarle desarrollos). */
async function proyectoNuevo(): Promise<number> {
  const p = await crearProyecto(
    sesion(PERM_TODOS),
    { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, nombre: 'Joggers' },
    bd(),
  );
  return p.id;
}

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
  modeloA = await cliente.modelo.create({ data: { codigo: 'A-100' } });
  modeloB = await cliente.modelo.create({ data: { codigo: 'B-200' } });
});

describe('calcularEstadoDesarrollo (estado derivado, precedencia)', () => {
  it('apagado manda sobre todo', () => {
    expect(
      calcularEstadoDesarrollo({
        apagado: true,
        precostos: [{ estado: 'congelado' }],
        ordenLigadas: [{ id: 1 }],
        listaLineas: [{ id: 1 }],
      }),
    ).toBe('apagado');
  });

  it('ligado-produccion gana a en-lista y cotizado', () => {
    expect(
      calcularEstadoDesarrollo({
        apagado: false,
        precostos: [{ estado: 'congelado' }],
        ordenLigadas: [{ id: 1 }],
        listaLineas: [{ id: 1 }],
      }),
    ).toBe('ligado-produccion');
  });

  it('en-lista gana a cotizado', () => {
    expect(
      calcularEstadoDesarrollo({
        apagado: false,
        precostos: [{ estado: 'congelado' }],
        ordenLigadas: [],
        listaLineas: [{ id: 1 }],
      }),
    ).toBe('en-lista');
  });

  it('cotizado si hay un precosto CONGELADO (un borrador no cuenta)', () => {
    expect(
      calcularEstadoDesarrollo({
        apagado: false,
        precostos: [{ estado: 'borrador' }],
        ordenLigadas: [],
        listaLineas: [],
      }),
    ).toBe('en-desarrollo');
    expect(
      calcularEstadoDesarrollo({
        apagado: false,
        precostos: [{ estado: 'congelado' }],
        ordenLigadas: [],
        listaLineas: [],
      }),
    ).toBe('cotizado');
  });

  it('en-desarrollo por defecto', () => {
    expect(
      calcularEstadoDesarrollo({
        apagado: false,
        precostos: [],
        ordenLigadas: [],
        listaLineas: [],
      }),
    ).toBe('en-desarrollo');
  });
});

describe('Desarrollos (F8-E2)', () => {
  describe('permisos', () => {
    it('sin administrar no se crea', async () => {
      const idProyecto = await proyectoNuevo();
      await expect(
        crearDesarrollo(sesion(['desarrollo.ver']), idProyecto, { idModelo: modeloA.id }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
    });
  });

  describe('crear', () => {
    it('crea un desarrollo con estado "en-desarrollo" y bitácora (A7)', async () => {
      const idProyecto = await proyectoNuevo();
      const d = await crearDesarrollo(
        sesion(PERM_TODOS),
        idProyecto,
        { idModelo: modeloA.id, numeroCliente: 'CLI-77' },
        bd(),
      );
      expect(d).toMatchObject({
        idProyecto,
        idModelo: modeloA.id,
        codigoModelo: 'A-100',
        numeroCliente: 'CLI-77',
        estado: 'en-desarrollo',
        apagado: false,
      });
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Desarrollo', idEntidad: String(d.id), accion: 'CREAR' },
      });
    });

    it('la salida trae el CLIENTE y el departamento HEREDADOS del proyecto', async () => {
      const idProyecto = await proyectoNuevo();
      const d = await crearDesarrollo(
        sesion(PERM_TODOS),
        idProyecto,
        { idModelo: modeloA.id },
        bd(),
      );
      // El desarrollo NO guarda cliente propio: se lee del proyecto (su dueño natural).
      expect(d).toMatchObject({
        idCliente: clienteNegocio.id,
        cliente: 'C&A',
        idClienteDepartamento: departamento.id,
        departamento: 'NIÑOS',
      });
      // Y también viaja al leerlo suelto y dentro del detalle del proyecto.
      await expect(obtenerDesarrollo(sesion(PERM_TODOS), d.id, bd())).resolves.toMatchObject({
        cliente: 'C&A',
        departamento: 'NIÑOS',
      });
      const proyecto = await obtenerProyecto(sesion(PERM_TODOS), idProyecto, bd());
      expect(proyecto.desarrollos[0]).toMatchObject({ cliente: 'C&A', departamento: 'NIÑOS' });
    });

    it('rechaza repetir el MISMO modelo en el mismo proyecto → ErrorConflicto (unique)', async () => {
      const idProyecto = await proyectoNuevo();
      await crearDesarrollo(sesion(PERM_TODOS), idProyecto, { idModelo: modeloA.id }, bd());
      await expect(
        crearDesarrollo(sesion(PERM_TODOS), idProyecto, { idModelo: modeloA.id }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
      // El MISMO modelo SÍ puede estar en OTRO proyecto.
      const otroProyecto = await proyectoNuevo();
      await expect(
        crearDesarrollo(sesion(PERM_TODOS), otroProyecto, { idModelo: modeloA.id }, bd()),
      ).resolves.toMatchObject({ idModelo: modeloA.id });
    });

    it('rechaza un modelo DESCONTINUADO → ErrorConflicto', async () => {
      const idProyecto = await proyectoNuevo();
      await cliente.modelo.update({ where: { id: modeloB.id }, data: { activo: false } });
      await expect(
        crearDesarrollo(sesion(PERM_TODOS), idProyecto, { idModelo: modeloB.id }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('rechaza agregar a un proyecto ARCHIVADO → ErrorConflicto', async () => {
      const idProyecto = await proyectoNuevo();
      await cliente.proyecto.update({ where: { id: idProyecto }, data: { archivado: true } });
      await expect(
        crearDesarrollo(sesion(PERM_TODOS), idProyecto, { idModelo: modeloA.id }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('apagar / reactivar (borrado suave con motivo)', () => {
    it('apaga con motivo (auditado: quién/cuándo/por qué) y reactiva limpiando los campos', async () => {
      const idProyecto = await proyectoNuevo();
      const d = await crearDesarrollo(
        sesion(PERM_TODOS),
        idProyecto,
        { idModelo: modeloA.id },
        bd(),
      );

      const apagado = await apagarDesarrollo(
        sesion(PERM_TODOS),
        d.id,
        { motivo: 'Cliente lo canceló' },
        bd(),
      );
      expect(apagado).toMatchObject({
        estado: 'apagado',
        apagado: true,
        motivoApagado: 'Cliente lo canceló',
        apagadoPorId: 'usuario-prueba',
      });
      expect(apagado.apagadoEn).not.toBeNull();
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Desarrollo', idEntidad: String(d.id), accion: 'DESACTIVAR' },
      });

      const reactivado = await reactivarDesarrollo(sesion(PERM_TODOS), d.id, bd());
      expect(reactivado).toMatchObject({
        estado: 'en-desarrollo',
        apagado: false,
        motivoApagado: null,
        apagadoPorId: null,
        apagadoEn: null,
      });
    });

    it('apagar dos veces → ErrorConflicto; reactivar uno activo → ErrorConflicto', async () => {
      const idProyecto = await proyectoNuevo();
      const d = await crearDesarrollo(
        sesion(PERM_TODOS),
        idProyecto,
        { idModelo: modeloA.id },
        bd(),
      );
      await apagarDesarrollo(sesion(PERM_TODOS), d.id, { motivo: 'x' }, bd());
      await expect(
        apagarDesarrollo(sesion(PERM_TODOS), d.id, { motivo: 'y' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);

      await reactivarDesarrollo(sesion(PERM_TODOS), d.id, bd());
      await expect(reactivarDesarrollo(sesion(PERM_TODOS), d.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });
  });

  describe('actualizar', () => {
    it('cambia numeroCliente/notas; idempotente sin cambios (sin bitácora vacía)', async () => {
      const idProyecto = await proyectoNuevo();
      const d = await crearDesarrollo(
        sesion(PERM_TODOS),
        idProyecto,
        { idModelo: modeloA.id },
        bd(),
      );
      const actualizado = await actualizarDesarrollo(
        sesion(PERM_TODOS),
        d.id,
        { numeroCliente: 'NUEVO', notas: 'con lavado' },
        bd(),
      );
      expect(actualizado).toMatchObject({ numeroCliente: 'NUEVO', notas: 'con lavado' });

      const antes = await cliente.bitacora.count();
      await actualizarDesarrollo(sesion(PERM_TODOS), d.id, { numeroCliente: 'NUEVO' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });
  });

  describe('aislamiento por empresa (A9)', () => {
    it('un desarrollo cuyo proyecto es de OTRA empresa no se ve ni se muta → ErrorNoEncontrado', async () => {
      const idProyecto = await proyectoNuevo();
      const d = await crearDesarrollo(
        sesion(PERM_TODOS),
        idProyecto,
        { idModelo: modeloA.id },
        bd(),
      );
      const otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra empresa');
      const sesionOtra = sesionDePrueba({ idEmpresaActiva: otraEmpresa.id, permisos: PERM_TODOS });

      await expect(obtenerDesarrollo(sesionOtra, d.id, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
      await expect(
        apagarDesarrollo(sesionOtra, d.id, { motivo: 'ajeno' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('conteos en el proyecto', () => {
    it('el detalle del proyecto refleja los desarrollos y sus conteos por estado', async () => {
      const idProyecto = await proyectoNuevo();
      await crearDesarrollo(sesion(PERM_TODOS), idProyecto, { idModelo: modeloA.id }, bd());
      const d2 = await crearDesarrollo(
        sesion(PERM_TODOS),
        idProyecto,
        { idModelo: modeloB.id },
        bd(),
      );
      await apagarDesarrollo(sesion(PERM_TODOS), d2.id, { motivo: 'fuera' }, bd());

      const proyecto = await obtenerProyecto(sesion(PERM_TODOS), idProyecto, bd());
      expect(proyecto.desarrollos).toHaveLength(2);
      expect(proyecto.conteos).toMatchObject({ total: 2, enDesarrollo: 1, apagado: 1 });
    });

    it('obtener un desarrollo inexistente → ErrorNoEncontrado', async () => {
      await expect(obtenerDesarrollo(sesion(PERM_TODOS), 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });
  });
});
