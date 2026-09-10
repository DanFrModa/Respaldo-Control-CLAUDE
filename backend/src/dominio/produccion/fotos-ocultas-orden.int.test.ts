import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Cliente, Empresa, Modelo, PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  leerIdsFotosOcultasOrden,
  listarFotosOcultasOrden,
  mostrarFotoModeloEnOrden,
  ocultarFotoModeloEnOrden,
} from './fotos-ocultas-orden.js';
import { crearOrden } from './ordenes.js';

/**
 * ⭐ §Post-F9.169(b) — integración contra el Postgres efímero (testcontainers) de QUITAR DE LA OP
 * UNA FOTO HEREDADA DEL MODELO. Cubre lo que SOLO la base puede decir:
 *
 *  • la LLAVE ÚNICA `(orden, foto)` de verdad (idempotencia sin doble marca);
 *  • que la FOTO DEL MODELO **sigue existiendo** tras ocultarla (la fila, no un mock);
 *  • que **otra orden del mismo modelo la sigue viendo**;
 *  • los dos Cascade: borrar la foto del catálogo se lleva la marca (esconderla en una OP **no
 *    secuestra** el catálogo del modelo) y borrar la orden también;
 *  • el scope de empresa (A9) contra filas reales.
 *
 * NO corre en local (usa Docker): el CI.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let clienteNegocio: Cliente;
let modelo: Modelo;

const PERM_TODOS: ClavePermiso[] = ['ordenes.ver', 'ordenes.administrar'];

function sesion(permisos: ClavePermiso[], idEmpresaActiva = empresa.id): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva, permisos });
}

const bd = () => ({ cliente });

/** Crea una orden de la empresa dada, del modelo dado, y devuelve su id (pasa por el dominio). */
async function crearOrdenDePrueba(idEmpresa: number, idModelo = modelo.id): Promise<number> {
  const pedido = await cliente.pedido.create({
    data: {
      folio: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
      idEmpresa,
      idCliente: clienteNegocio.id,
    },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo, cantidadPedida: 100, precio: 50 },
  });
  const orden = await crearOrden(
    sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: [...PERM_TODOS] }),
    { idPedidoLinea: linea.id },
    bd(),
  );
  return orden.id;
}

/** Crea una foto real del modelo (Archivo + ModeloFoto) y devuelve las dos identidades. */
async function crearFotoModelo(
  idModelo: number,
  nombre: string,
  orden = 0,
): Promise<{ idFoto: number; idArchivo: string }> {
  const archivo = await cliente.archivo.create({
    data: {
      bucket: 'control-v2-prueba',
      key: `modelos/${idModelo}/${nombre}`,
      nombreOriginal: nombre,
      tipoMime: 'image/jpeg',
      tamanoBytes: 1024,
    },
  });
  const foto = await cliente.modeloFoto.create({
    data: { idModelo, idArchivo: archivo.id, orden },
  });
  return { idFoto: foto.id, idArchivo: archivo.id };
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
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Marilyn Fitness');
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
});

describe('Fotos ocultas de la OP (§Post-F9.169b) — permisos y empresa (A4/A9)', () => {
  it('quitar/traer de vuelta exigen ordenes.administrar; listar exige ordenes.ver', async () => {
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const { idFoto } = await crearFotoModelo(modelo.id, 'frente.jpg');

    await expect(
      ocultarFotoModeloEnOrden(sesion(['ordenes.ver']), idOrden, { idModeloFoto: idFoto }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(
      mostrarFotoModeloEnOrden(sesion(['ordenes.ver']), idOrden, idFoto, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(listarFotosOcultasOrden(sesion([]), idOrden, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('una orden de OTRA empresa no se ve ni se toca (A9)', async () => {
    const idOrdenAjena = await crearOrdenDePrueba(otraEmpresa.id);
    const { idFoto } = await crearFotoModelo(modelo.id, 'frente.jpg');

    await expect(
      ocultarFotoModeloEnOrden(
        sesion([...PERM_TODOS]),
        idOrdenAjena,
        { idModeloFoto: idFoto },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    await expect(
      listarFotosOcultasOrden(sesion([...PERM_TODOS]), idOrdenAjena, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(await cliente.ordenFotoOculta.count()).toBe(0);
  });
});

describe('⭐ Fotos ocultas de la OP — quitar NO es borrar (D3)', () => {
  it('⭐ la foto del MODELO sigue viva y en su galería después de quitarla de la OP', async () => {
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const { idFoto, idArchivo } = await crearFotoModelo(modelo.id, 'frente.jpg');

    await ocultarFotoModeloEnOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      { idModeloFoto: idFoto },
      bd(),
    );

    // La marca existe…
    expect(await cliente.ordenFotoOculta.count({ where: { idOrden } })).toBe(1);
    // …y la foto del modelo NO se movió ni un milímetro: sigue su fila, sigue su Archivo (o sea, su
    // objeto en R2 jamás estuvo en peligro) y sigue colgando del mismo modelo.
    const foto = await cliente.modeloFoto.findUnique({ where: { id: idFoto } });
    expect(foto).not.toBeNull();
    expect(foto?.idModelo).toBe(modelo.id);
    expect(await cliente.archivo.findUnique({ where: { id: idArchivo } })).not.toBeNull();
  });

  it('⭐ OTRA ORDEN DEL MISMO MODELO la sigue viendo', async () => {
    const idOrdenA = await crearOrdenDePrueba(empresa.id);
    const idOrdenB = await crearOrdenDePrueba(empresa.id);
    const { idFoto } = await crearFotoModelo(modelo.id, 'frente.jpg');

    await ocultarFotoModeloEnOrden(
      sesion([...PERM_TODOS]),
      idOrdenA,
      { idModeloFoto: idFoto },
      bd(),
    );

    expect(await leerIdsFotosOcultasOrden(cliente, idOrdenA)).toEqual([idFoto]);
    expect(await leerIdsFotosOcultasOrden(cliente, idOrdenB)).toEqual([]);
    expect(await listarFotosOcultasOrden(sesion([...PERM_TODOS]), idOrdenB, bd())).toEqual([]);
  });

  it('la LLAVE ÚNICA sostiene la idempotencia: quitarla dos veces deja UNA fila', async () => {
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const { idFoto } = await crearFotoModelo(modelo.id, 'frente.jpg');

    await ocultarFotoModeloEnOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      { idModeloFoto: idFoto },
      bd(),
    );
    const segunda = await ocultarFotoModeloEnOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      { idModeloFoto: idFoto },
      bd(),
    );

    expect(segunda.map((f) => f.idModeloFoto)).toEqual([idFoto]);
    expect(await cliente.ordenFotoOculta.count({ where: { idOrden } })).toBe(1);
  });

  it('🔴 una foto de OTRO modelo no se puede quitar de esta OP (404, y sin fila)', async () => {
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const otroModelo = await cliente.modelo.create({
      data: { codigo: 'B-200', descripcion: 'Pantalón' },
    });
    const { idFoto: fotoAjena } = await crearFotoModelo(otroModelo.id, 'ajena.jpg');

    await expect(
      ocultarFotoModeloEnOrden(sesion([...PERM_TODOS]), idOrden, { idModeloFoto: fotoAjena }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(await cliente.ordenFotoOculta.count()).toBe(0);
  });

  it('⭐⭐ una foto HEREDADA del modelo de desarrollo (hijo por color) sí se puede quitar', async () => {
    const hijo = await cliente.modelo.create({
      data: { codigo: 'A-101', descripcion: 'Playera roja', idModeloDesarrollo: modelo.id },
    });
    const idOrden = await crearOrdenDePrueba(empresa.id, hijo.id);
    // La foto es del PADRE; el hijo no tiene ninguna propia, así que en pantalla enseña ésta.
    const { idFoto } = await crearFotoModelo(modelo.id, 'frente.jpg');

    await ocultarFotoModeloEnOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      { idModeloFoto: idFoto },
      bd(),
    );

    expect(await leerIdsFotosOcultasOrden(cliente, idOrden)).toEqual([idFoto]);
  });
});

describe('⭐ Fotos ocultas de la OP — traerla de vuelta (reversible siempre)', () => {
  it('levanta la marca y la OP vuelve a enseñarla', async () => {
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const { idFoto } = await crearFotoModelo(modelo.id, 'frente.jpg');

    await ocultarFotoModeloEnOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      { idModeloFoto: idFoto },
      bd(),
    );
    const resultado = await mostrarFotoModeloEnOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      idFoto,
      bd(),
    );

    expect(resultado).toEqual([]);
    expect(await cliente.ordenFotoOculta.count({ where: { idOrden } })).toBe(0);
  });

  it('traer de vuelta algo que no estaba quitado no falla (idempotente)', async () => {
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const { idFoto } = await crearFotoModelo(modelo.id, 'frente.jpg');

    await expect(
      mostrarFotoModeloEnOrden(sesion([...PERM_TODOS]), idOrden, idFoto, bd()),
    ).resolves.toEqual([]);
  });
});

describe('Fotos ocultas de la OP — los dos Cascade', () => {
  it('⭐ esconder una foto NO secuestra el catálogo: borrarla del modelo se lleva la marca', async () => {
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const { idFoto, idArchivo } = await crearFotoModelo(modelo.id, 'frente.jpg');
    await ocultarFotoModeloEnOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      { idModeloFoto: idFoto },
      bd(),
    );

    // El dueño del modelo borra su foto (Archivo → Cascade → ModeloFoto → Cascade → marca). Con un
    // RESTRICT —el default de la casa para catálogos en uso— esto reventaría, y una OP cualquiera
    // habría dejado la galería del modelo inmovilizada.
    await expect(cliente.archivo.delete({ where: { id: idArchivo } })).resolves.toBeDefined();

    expect(await cliente.modeloFoto.count({ where: { id: idFoto } })).toBe(0);
    expect(await cliente.ordenFotoOculta.count()).toBe(0);
  });

  it('borrar la orden se lleva sus marcas (la decisión es de la orden)', async () => {
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const { idFoto } = await crearFotoModelo(modelo.id, 'frente.jpg');
    await ocultarFotoModeloEnOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      { idModeloFoto: idFoto },
      bd(),
    );

    await cliente.orden.delete({ where: { id: idOrden } });

    expect(await cliente.ordenFotoOculta.count()).toBe(0);
    // Y la foto del modelo sigue ahí: nunca fue suya para llevársela.
    expect(await cliente.modeloFoto.count({ where: { id: idFoto } })).toBe(1);
  });
});
