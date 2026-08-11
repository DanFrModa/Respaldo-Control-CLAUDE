import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { listarHistoricoOrdenes, obtenerHistoricoOrden } from './historico-ordenes.js';

/**
 * Integración del ARCHIVO HISTÓRICO DE ÓRDENES (§Post-F9.26): lo que solo se ve con Postgres de
 * verdad — el ORDEN de las columnas que admiten NULL.
 *
 * En Postgres `DESC` implica `NULLS FIRST`, y `fecha desc` es el orden POR DEFECTO del archivo:
 * sin `nulls: 'last'`, la primera página se llenaba con las órdenes viejas a las que el sistema
 * viejo nunca les capturó fecha, en vez de con las más recientes — que es exactamente lo que se
 * busca al abrir la pantalla.
 */

let cliente: PrismaClient;
let empresa: Empresa;

const sesion = (): SesionUsuario =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: ['ordenes.ver'] });
const bd = () => ({ cliente });

/** Alta directa en el archivo (es una tabla plana de solo lectura: el ETL escribe con Prisma). */
async function ordenArchivo(
  idOrdenV1: string,
  numero: string,
  fecha: string | null,
  cli: string | null,
  empresaV1: string | null = null,
): Promise<void> {
  await cliente.historicoOrdenV1.create({
    data: {
      idEmpresa: empresa.id,
      idOrdenV1,
      numero,
      fecha: fecha === null ? null : new Date(`${fecha}T00:00:00.000Z`),
      cliente: cli,
      empresaV1,
    },
  });
}

beforeEach(async () => {
  cliente = clientePruebas();
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  await ordenArchivo('1', '5001', '2019-03-15', 'Comercial Uno', 'FR Moda');
  await ordenArchivo('2', '5002', '2026-02-02', 'Zapatería Dos', 'FR Moda');
  // Rescatada de una empresa que ya no existe (§Post-F9.29): cuelga de la empresa principal, pero
  // `empresaV1` recuerda de quién era. El viejo además la dejó sin fecha ni cliente.
  await ordenArchivo('3', '5003', null, null, 'Zipora');
});

afterAll(async () => {
  await cliente.$disconnect();
});

describe('Orden del archivo con columnas NULLABLE', () => {
  it('por fecha descendente (el default) las SIN FECHA van al final, no primero', async () => {
    const pagina = await listarHistoricoOrdenes(sesion(), {}, bd());
    expect(pagina.datos.map((o) => o.numero)).toEqual(['5002', '5001', '5003']);
  });

  it('y ascendente también las deja al final (los nulos nunca encabezan)', async () => {
    const pagina = await listarHistoricoOrdenes(
      sesion(),
      { ordenarPor: 'fecha', direccion: 'asc' },
      bd(),
    );
    expect(pagina.datos.map((o) => o.numero)).toEqual(['5001', '5002', '5003']);
  });

  it('lo mismo al ordenar por CLIENTE (también nullable)', async () => {
    const pagina = await listarHistoricoOrdenes(
      sesion(),
      { ordenarPor: 'cliente', direccion: 'desc' },
      bd(),
    );
    expect(pagina.datos.map((o) => o.numero)).toEqual(['5002', '5001', '5003']);
  });

  it('ordenar por una columna NO nullable sigue funcionando igual', async () => {
    const pagina = await listarHistoricoOrdenes(
      sesion(),
      { ordenarPor: 'numero', direccion: 'asc' },
      bd(),
    );
    expect(pagina.datos.map((o) => o.numero)).toEqual(['5001', '5002', '5003']);
  });

  it('la caja libre encuentra por la EMPRESA del sistema viejo, y la ficha la muestra', async () => {
    // §Post-F9.29 — las rescatadas cuelgan de la empresa principal, así que `idEmpresa` ya no las
    // distingue: este texto es la única forma de volver a juntar la historia de Zipora.
    const pagina = await listarHistoricoOrdenes(sesion(), { busqueda: 'zipo' }, bd());
    expect(pagina.datos.map((o) => o.numero)).toEqual(['5003']);

    const ficha = await obtenerHistoricoOrden(sesion(), pagina.datos[0]?.id ?? 0, bd());
    expect(ficha.empresaV1).toBe('Zipora');
  });

  it('la ficha se obtiene por id y respeta la empresa activa (A9)', async () => {
    const pagina = await listarHistoricoOrdenes(sesion(), { busqueda: '5001' }, bd());
    const id = pagina.datos[0]?.id ?? 0;
    const ficha = await obtenerHistoricoOrden(sesion(), id, bd());
    expect(ficha.numero).toBe('5001');

    const otra = await crearEmpresaPrueba(cliente, 'Otra empresa');
    await expect(
      obtenerHistoricoOrden(
        sesionDePrueba({ idEmpresaActiva: otra.id, permisos: ['ordenes.ver'] }),
        id,
        bd(),
      ),
    ).rejects.toBeInstanceOf(Error);
  });
});
