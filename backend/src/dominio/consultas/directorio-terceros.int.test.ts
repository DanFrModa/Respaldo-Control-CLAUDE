import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { listarDirectorioTerceros } from './directorio-terceros.js';

/**
 * Integración del DIRECTORIO HISTÓRICO DE TERCEROS (§Post-F9.28): el orden por ÚLTIMA ACTIVIDAD.
 *
 * *"¿Hace cuánto que no trabajamos con este?"* es la consulta natural de esta libreta, y
 * `ultimaActividad` es NULLABLE (muchos terceros del Access nunca movieron un documento). Con el
 * `DESC` de Postgres —que implica `NULLS FIRST`— la primera página se llenaba justo con los que
 * nunca movieron nada: lo contrario de lo que se pregunta.
 */

let cliente: PrismaClient;

const sesion = (): SesionUsuario => sesionDePrueba({ permisos: ['proveedores.ver'] });
const bd = () => ({ cliente });

async function tercero(idViejo: string, nombre: string, ultima: string | null): Promise<void> {
  await cliente.directorioTerceroV1.create({
    data: {
      fuente: 'Maquileros',
      idViejo,
      nombre,
      telefono: `555-${idViejo}`,
      ultimaActividad: ultima === null ? null : new Date(`${ultima}T00:00:00.000Z`),
      documentos: ultima === null ? 0 : 5,
    },
  });
}

beforeEach(async () => {
  cliente = clientePruebas();
  await limpiarBaseDatos(cliente);
  await tercero('1', 'Taller Sosa', '2026-02-10');
  await tercero('2', 'Taller Viejo', '2018-05-01');
  await tercero('3', 'Nunca Movio Nada', null);
});

afterAll(async () => {
  await cliente.$disconnect();
});

describe('Orden del directorio por última actividad', () => {
  it('los que NUNCA movieron nada van al final, no encabezando la lista', async () => {
    const pagina = await listarDirectorioTerceros(
      sesion(),
      { ordenarPor: 'ultimaActividad', direccion: 'desc' },
      bd(),
    );
    expect(pagina.datos.map((d) => d.nombre)).toEqual([
      'Taller Sosa',
      'Taller Viejo',
      'Nunca Movio Nada',
    ]);
  });

  it('en ascendente tampoco encabezan (los nulos siempre al final)', async () => {
    const pagina = await listarDirectorioTerceros(
      sesion(),
      { ordenarPor: 'ultimaActividad', direccion: 'asc' },
      bd(),
    );
    expect(pagina.datos.map((d) => d.nombre)).toEqual([
      'Taller Viejo',
      'Taller Sosa',
      'Nunca Movio Nada',
    ]);
  });

  it('se busca también por TELÉFONO (a veces se llega al revés)', async () => {
    const pagina = await listarDirectorioTerceros(sesion(), { busqueda: '555-2' }, bd());
    expect(pagina.datos.map((d) => d.nombre)).toEqual(['Taller Viejo']);
  });
});
