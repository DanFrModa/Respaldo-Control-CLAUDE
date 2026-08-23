import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ErrorConflicto } from '../../comun/errores.js';
import type { ClavePermiso } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Empresa, PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarDireccionEntrega,
  crearDireccionEntrega,
  desactivarDireccionEntrega,
  listarDireccionesEntrega,
  reactivarDireccionEntrega,
} from './direcciones-entrega.js';

/**
 * Integración del catálogo de DIRECCIONES DE ENTREGA (§Post-F9.18). El CRUD es el patrón de
 * Temporadas, así que aquí solo se prueba lo PROPIO de este catálogo:
 *  • se gobierna con los permisos de COMPRAS (no tiene permisos propios, ADR-0009);
 *  • la FAVORITA es única: prender una apaga la anterior, en la misma transacción;
 *  • la favorita NO se puede desactivar a secas (la UI la preseleccionaría apagada), pero el atajo
 *    "Desactivar" sí funciona porque apaga la bandera junto con la baja;
 *  • el listado saca la favorita PRIMERO (así la captura de la OC la preselecciona sin buscarla).
 */

let cliente: PrismaClient;
let empresa: Empresa;

const PERM_ADMIN: ClavePermiso[] = ['compras.ver', 'compras.administrar'];

function sesion(permisos: ClavePermiso[] = PERM_ADMIN): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
}

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
});

describe('Direcciones de entrega (§Post-F9.18)', () => {
  it('se gobierna con los permisos de COMPRAS (deny-by-default, A4)', async () => {
    await expect(
      crearDireccionEntrega(
        sesion(['compras.ver']),
        { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(Error);
    await expect(listarDireccionesEntrega(sesion([]), {}, bd())).rejects.toBeInstanceOf(Error);
  });

  it('la FAVORITA es única: al prender una, se apaga la anterior', async () => {
    const primera = await crearDireccionEntrega(
      sesion(),
      { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123', favorita: true },
      bd(),
    );
    const segunda = await crearDireccionEntrega(
      sesion(),
      { nombre: 'Bodega Montaño', direccion: 'Calle 5 #10', favorita: true },
      bd(),
    );

    const pagina = await listarDireccionesEntrega(sesion(), {}, bd());
    const favoritas = pagina.datos.filter((d) => d.favorita).map((d) => d.id);
    expect(favoritas).toEqual([segunda.id]);
    // Y sale PRIMERO en el listado, aunque alfabéticamente vaya después.
    expect(pagina.datos[0]?.id).toBe(segunda.id);

    // Devolverle la corona a la primera vuelve a apagar la otra.
    await actualizarDireccionEntrega(sesion(), { id: primera.id, favorita: true }, bd());
    const despues = await listarDireccionesEntrega(sesion(), {}, bd());
    expect(despues.datos.filter((d) => d.favorita).map((d) => d.id)).toEqual([primera.id]);
  });

  it('la favorita no se apaga a secas, pero el atajo "Desactivar" sí la da de baja', async () => {
    const favorita = await crearDireccionEntrega(
      sesion(),
      { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123', favorita: true },
      bd(),
    );

    // Mandar solo `activo: false` dejaría una favorita apagada: se rechaza con el porqué.
    await expect(
      actualizarDireccionEntrega(sesion(), { id: favorita.id, activo: false }, bd()),
    ).rejects.toThrow(/favorita/);

    // El atajo apaga la bandera junto con la baja, así que sí procede.
    const dadaDeBaja = await desactivarDireccionEntrega(sesion(), favorita.id, bd());
    expect(dadaDeBaja.activo).toBe(false);
    expect(dadaDeBaja.favorita).toBe(false);

    // Desactivar dos veces es conflicto (pantalla desactualizada); reactivar la devuelve.
    await expect(desactivarDireccionEntrega(sesion(), favorita.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    expect((await reactivarDireccionEntrega(sesion(), favorita.id, bd())).activo).toBe(true);
  });

  it('el nombre es único global, sin importar mayúsculas', async () => {
    await crearDireccionEntrega(
      sesion(),
      { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123' },
      bd(),
    );
    await expect(
      crearDireccionEntrega(sesion(), { nombre: 'naucalpan', direccion: 'Otra' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('por omisión lista solo activas y busca por nombre o por dirección', async () => {
    await crearDireccionEntrega(
      sesion(),
      { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123' },
      bd(),
    );
    const otra = await crearDireccionEntrega(
      sesion(),
      { nombre: 'Bodega Montaño', direccion: 'Calle 5 #10, Tlalnepantla' },
      bd(),
    );
    await desactivarDireccionEntrega(sesion(), otra.id, bd());

    expect((await listarDireccionesEntrega(sesion(), {}, bd())).total).toBe(1);
    expect((await listarDireccionesEntrega(sesion(), { incluirInactivos: true }, bd())).total).toBe(
      2,
    );
    // La búsqueda pega en la calle, no solo en el nombre.
    const porCalle = await listarDireccionesEntrega(sesion(), { busqueda: 'Siempre Viva' }, bd());
    expect(porCalle.datos.map((d) => d.nombre)).toEqual(['Naucalpan']);
  });
});
