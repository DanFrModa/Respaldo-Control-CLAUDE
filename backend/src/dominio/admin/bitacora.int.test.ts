/**
 * Tests de integración de la CONSULTA DE BITÁCORA (F6-E1, transversal; A7). Postgres efímero. La
 * lectura del log que F0 solo escribía: que liste los registros A7 reales (los que dejan los CRUD
 * al mutar), filtre por entidad/usuario/acción/fecha, resuelva el nombre del usuario, pagine en
 * servidor y se niegue sin `admin.ver-bitacora` (deny-by-default).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { ErrorPermiso } from '../../comun/errores.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { crearTipoProducto, desactivarTipoProducto } from '../calidad/tipos-producto.js';
import { listarBitacora } from './bitacora.js';

let cliente: PrismaClient;

const sesionAuditor = () => sesionDePrueba({ permisos: ['admin.ver-bitacora'] });
/** Quien muta el catálogo (deja registros A7 que la bitácora luego lee). */
const sesionCatalogo = () =>
  sesionDePrueba({
    id: 'usuario-prueba',
    permisos: ['calidad.ver', 'calidad.administrar-catalogo'],
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
});

describe('Bitácora — lectura del log A7 (F6-E1)', () => {
  it('sin admin.ver-bitacora se rechaza (deny-by-default)', async () => {
    await expect(listarBitacora(sesionDePrueba(), {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('lista los registros que dejó un CRUD real y filtra por entidad', async () => {
    const catalogo = sesionCatalogo();
    const tipo = await crearTipoProducto(catalogo, { nombre: 'Playera' }, bd());
    await desactivarTipoProducto(catalogo, tipo.id, bd());

    // Sin filtro: trae ambos registros (CREAR + DESACTIVAR).
    const todo = await listarBitacora(sesionAuditor(), {}, bd());
    expect(todo.total).toBe(2);

    // Filtra por entidad TipoProducto.
    const porEntidad = await listarBitacora(sesionAuditor(), { entidad: 'TipoProducto' }, bd());
    expect(porEntidad.total).toBe(2);
    expect(porEntidad.datos.every((r) => r.entidad === 'TipoProducto')).toBe(true);

    // Resuelve el id del registro afectado.
    const porFolio = await listarBitacora(
      sesionAuditor(),
      { entidad: 'TipoProducto', idEntidad: String(tipo.id) },
      bd(),
    );
    expect(porFolio.total).toBe(2);
  });

  it('filtra por acción y por usuario, y resuelve el nombre del usuario', async () => {
    // Un usuario real cuyo nombre la bitácora debe resolver.
    const usuario = await cliente.usuario.create({
      data: {
        id: 'usuario-prueba',
        username: 'auditado',
        displayUsername: 'auditado',
        nombre: 'Persona Auditada',
        email: 'auditado@control.local',
        emailVerified: true,
        activo: true,
      },
    });
    const catalogo = sesionDePrueba({
      id: usuario.id,
      permisos: ['calidad.ver', 'calidad.administrar-catalogo'],
    });
    const tipo = await crearTipoProducto(catalogo, { nombre: 'Sudadera' }, bd());
    await desactivarTipoProducto(catalogo, tipo.id, bd());

    const soloDesactivar = await listarBitacora(sesionAuditor(), { accion: 'DESACTIVAR' }, bd());
    expect(soloDesactivar.total).toBe(1);
    expect(soloDesactivar.datos[0]?.accion).toBe('DESACTIVAR');
    expect(soloDesactivar.datos[0]?.nombreUsuario).toBe('Persona Auditada');

    const porUsuario = await listarBitacora(sesionAuditor(), { idUsuario: usuario.id }, bd());
    expect(porUsuario.total).toBe(2);
  });

  it('pagina en servidor (forma estándar)', async () => {
    const catalogo = sesionCatalogo();
    for (let i = 0; i < 5; i++) {
      await crearTipoProducto(catalogo, { nombre: `Tipo ${String(i)}` }, bd());
    }
    const pagina = await listarBitacora(sesionAuditor(), { porPagina: 2 }, bd());
    expect(pagina.total).toBe(5);
    expect(pagina.datos).toHaveLength(2);
    expect(pagina.totalPaginas).toBe(3);
  });
});
