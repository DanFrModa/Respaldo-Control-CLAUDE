/**
 * ⭐ V1-E8y (§Post-F9.152) — CONTACTOS DEL CLIENTE (la compradora) contra el Postgres efímero.
 *
 * Lo que se prueba, que es exactamente lo que decidió Daniel y lo que la base tiene que sostener:
 *  • el DEPARTAMENTO es OPCIONAL («Carlos, crédito» no necesita departamento inventado) y, cuando
 *    viene, tiene que ser **de ese cliente**;
 *  • nada se borra: se ARCHIVA y se puede revivir (D3);
 *  • la FUSIÓN de departamentos (§Post-F9.122a) **repunta los contactos** como a las otras cuatro
 *    referencias — si no, la compradora se quedaría colgada de un departamento apagado.
 *
 * NO corre en local (usa Docker): lo juzga el CI.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Cliente, ClienteDepartamento, Empresa, PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarContactoCliente,
  crearContactoCliente,
  listarContactosCliente,
} from './cliente-contactos.js';
import { fusionarDepartamentosCliente } from './cliente-departamentos.js';

let cliente: PrismaClient;
let empresa: Empresa;
let clienteNegocio: Cliente;
let ninos: ClienteDepartamento;

const PERM: ClavePermiso[] = ['clientes.ver', 'clientes.administrar'];
const bd = () => ({ cliente });
function sesion(permisos: ClavePermiso[] = PERM): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
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
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'C&A', abreviatura: 'CYA' } });
  ninos = await cliente.clienteDepartamento.create({
    data: { idCliente: clienteNegocio.id, nombre: 'NIÑOS' },
  });
});

describe('contactos del cliente', () => {
  it('⭐ el departamento es OPCIONAL: la compradora lo lleva, crédito y cobranza no', async () => {
    const laura = await crearContactoCliente(
      sesion(),
      clienteNegocio.id,
      {
        nombre: 'Laura',
        puesto: 'compradora',
        idClienteDepartamento: ninos.id,
        telefono: '55-1234',
      },
      bd(),
    );
    const carlos = await crearContactoCliente(
      sesion(),
      clienteNegocio.id,
      { nombre: 'Carlos', puesto: 'crédito y cobranza' },
      bd(),
    );

    expect(laura.idClienteDepartamento).toBe(ninos.id);
    expect(laura.clienteDepartamento?.nombre).toBe('NIÑOS');
    expect(carlos.idClienteDepartamento).toBeNull();
    expect(carlos.clienteDepartamento).toBeNull();

    const todos = await listarContactosCliente(sesion(), clienteNegocio.id, false, bd());
    expect(todos.map((c) => c.nombre)).toEqual(['Carlos', 'Laura']); // orden por nombre
  });

  it('🔴 un departamento de OTRO cliente se rechaza (la ficha diría una mentira)', async () => {
    const otro = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
    const damasAjeno = await cliente.clienteDepartamento.create({
      data: { idCliente: otro.id, nombre: 'DAMAS' },
    });

    await expect(
      crearContactoCliente(
        sesion(),
        clienteNegocio.id,
        { nombre: 'Intrusa', idClienteDepartamento: damasAjeno.id },
        bd(),
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('un departamento DESACTIVADO no recibe contactos nuevos (apagarlo es cómo la fusión retira duplicados)', async () => {
    await cliente.clienteDepartamento.update({ where: { id: ninos.id }, data: { activo: false } });
    await expect(
      crearContactoCliente(
        sesion(),
        clienteNegocio.id,
        { nombre: 'Laura', idClienteDepartamento: ninos.id },
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);
  });

  it('se ARCHIVA y se revive; nunca se borra (D3)', async () => {
    const laura = await crearContactoCliente(
      sesion(),
      clienteNegocio.id,
      { nombre: 'Laura' },
      bd(),
    );

    const archivada = await actualizarContactoCliente(
      sesion(),
      clienteNegocio.id,
      laura.id,
      { activo: false },
      bd(),
    );
    expect(archivada.activo).toBe(false);
    expect(await listarContactosCliente(sesion(), clienteNegocio.id, false, bd())).toHaveLength(0);
    expect(await listarContactosCliente(sesion(), clienteNegocio.id, true, bd())).toHaveLength(1);

    const revivida = await actualizarContactoCliente(
      sesion(),
      clienteNegocio.id,
      laura.id,
      { activo: true },
      bd(),
    );
    expect(revivida.activo).toBe(true);
  });

  it('`idClienteDepartamento: null` DESLIGA a la persona (pasa a atender al cliente completo)', async () => {
    const laura = await crearContactoCliente(
      sesion(),
      clienteNegocio.id,
      { nombre: 'Laura', idClienteDepartamento: ninos.id },
      bd(),
    );
    const suelta = await actualizarContactoCliente(
      sesion(),
      clienteNegocio.id,
      laura.id,
      { idClienteDepartamento: null },
      bd(),
    );
    expect(suelta.idClienteDepartamento).toBeNull();
    expect(suelta.nombre).toBe('Laura');
  });

  it('un contacto de OTRO cliente responde 404 (nunca se opera sobre lo ajeno)', async () => {
    const otro = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
    const ajeno = await crearContactoCliente(sesion(), otro.id, { nombre: 'Ajeno' }, bd());
    await expect(
      actualizarContactoCliente(sesion(), clienteNegocio.id, ajeno.id, { nombre: 'X' }, bd()),
    ).rejects.toThrow(ErrorNoEncontrado);
  });

  it('🔴 la FUSIÓN de departamentos REPUNTA los contactos (o la compradora quedaría en el apagado)', async () => {
    const nino = await cliente.clienteDepartamento.create({
      data: { idCliente: clienteNegocio.id, nombre: 'NIÑO' },
    });
    const laura = await crearContactoCliente(
      sesion(),
      clienteNegocio.id,
      { nombre: 'Laura', idClienteDepartamento: nino.id },
      bd(),
    );

    await fusionarDepartamentosCliente(
      sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM }),
      clienteNegocio.id,
      { idDestino: ninos.id, origenes: [nino.id] },
      bd(),
    );

    const movida = await cliente.clienteContacto.findUniqueOrThrow({ where: { id: laura.id } });
    expect(movida.idClienteDepartamento).toBe(ninos.id);
  });
});
