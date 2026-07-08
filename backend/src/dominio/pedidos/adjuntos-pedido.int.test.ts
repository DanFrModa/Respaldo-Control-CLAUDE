import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { ServicioArchivos } from '../../comun/archivos.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Cliente, Empresa, PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  eliminarAdjuntoPedido,
  listarAdjuntosPedido,
  solicitarSubidaAdjuntoPedido,
} from './adjuntos-pedido.js';

/**
 * Integración del dominio de ADJUNTOS del pedido (rediseño R3, B3 — espejo de los adjuntos de
 * orden F8-E6) contra el Postgres efímero. Cubre: el ligado real `Archivo`↔`PedidoArchivo`, el
 * borrado por Cascade, el scope de empresa (A9), los permisos `pedidos.*` (deny-by-default, A4)
 * y el borrado físico R2 best-effort (fake). Corre en CI.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let clienteNegocio: Cliente;

const PERM_TODOS: ClavePermiso[] = ['pedidos.ver', 'pedidos.administrar'];

function sesion(permisos: ClavePermiso[], idEmpresaActiva = empresa.id): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva, permisos });
}

const bd = () => ({ cliente });

/** Spy del borrado físico de R2 (best-effort). Se reinicia por test. */
let eliminarObjetoSpy: Mock<(key: string) => void>;

/** Fake del servicio de archivos (igual al de adjuntos de orden): crea el `Archivo`, no toca R2. */
function archivosFalsos(): ServicioArchivos {
  return {
    async solicitarSubida(tx, sesionSubida, solicitud) {
      const carpeta = solicitud.carpeta ?? 'general';
      const key = `${carpeta}/fake/${solicitud.nombreOriginal}`;
      const archivo = await tx.archivo.create({
        data: {
          bucket: 'control-v2-prueba',
          key,
          nombreOriginal: solicitud.nombreOriginal,
          tipoMime: solicitud.tipoMime,
          tamanoBytes: solicitud.tamanoBytes,
          subidoPorId: sesionSubida.id,
        },
        select: {
          id: true,
          bucket: true,
          key: true,
          nombreOriginal: true,
          tipoMime: true,
          tamanoBytes: true,
        },
      });
      return { archivo, urlSubida: `https://r2.fake/put/${key}`, expiraEnSegundos: 900 };
    },
    urlDescarga(key) {
      return Promise.resolve(`https://r2.fake/get/${key}`);
    },
    subirObjeto() {
      throw new Error('subirObjeto no se usa en este test');
    },
    eliminarObjeto(key) {
      eliminarObjetoSpy(key);
      return Promise.resolve();
    },
  };
}

/** Crea un pedido de la empresa dada y devuelve su id. */
async function crearPedidoDePrueba(idEmpresa: number): Promise<number> {
  const pedido = await cliente.pedido.create({
    data: {
      folio: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
      idEmpresa,
      idCliente: clienteNegocio.id,
      ocCliente: 'OC-CA-4471',
    },
  });
  return pedido.id;
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
  eliminarObjetoSpy = vi.fn<(key: string) => void>();
});

describe('Adjuntos de pedido (R3, B3) — permisos (deny-by-default, A4)', () => {
  it('subir/eliminar exigen pedidos.administrar; listar exige pedidos.ver', async () => {
    const idPedido = await crearPedidoDePrueba(empresa.id);
    await expect(
      solicitarSubidaAdjuntoPedido(
        sesion(['pedidos.ver']),
        idPedido,
        { nombreOriginal: 'oc.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
        bd(),
        archivosFalsos(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(
      listarAdjuntosPedido(sesion([]), idPedido, bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(
      eliminarAdjuntoPedido(sesion(['pedidos.ver']), idPedido, 'x', bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('Adjuntos de pedido (R3, B3) — subir/listar/eliminar (A2, A9)', () => {
  it('sube, liga el Archivo y lo lista con su URL de descarga', async () => {
    const idPedido = await crearPedidoDePrueba(empresa.id);
    const subida = await solicitarSubidaAdjuntoPedido(
      sesion([...PERM_TODOS]),
      idPedido,
      { nombreOriginal: 'oc-cliente.pdf', tipoMime: 'application/pdf', tamanoBytes: 1234 },
      bd(),
      archivosFalsos(),
    );
    expect(subida.urlSubida).toContain('https://');

    const puente = await cliente.pedidoArchivo.findFirst({ where: { idPedido } });
    expect(puente?.idArchivo).toBe(subida.idArchivo);

    const lista = await listarAdjuntosPedido(
      sesion([...PERM_TODOS]),
      idPedido,
      bd(),
      archivosFalsos(),
    );
    expect(lista).toHaveLength(1);
    expect(lista[0]?.nombreOriginal).toBe('oc-cliente.pdf');
    expect(lista[0]?.urlDescarga).toContain('https://');
  });

  it('eliminar borra el Archivo (Cascade arrastra el PedidoArchivo) y borra el objeto R2 (best-effort)', async () => {
    const idPedido = await crearPedidoDePrueba(empresa.id);
    const subida = await solicitarSubidaAdjuntoPedido(
      sesion([...PERM_TODOS]),
      idPedido,
      { nombreOriginal: 'oc.pdf', tipoMime: 'application/pdf', tamanoBytes: 1234 },
      bd(),
      archivosFalsos(),
    );

    await eliminarAdjuntoPedido(
      sesion([...PERM_TODOS]),
      idPedido,
      subida.idArchivo,
      bd(),
      archivosFalsos(),
    );

    expect(await cliente.archivo.findUnique({ where: { id: subida.idArchivo } })).toBeNull();
    expect(await cliente.pedidoArchivo.count({ where: { idPedido } })).toBe(0);
    expect(eliminarObjetoSpy).toHaveBeenCalledTimes(1);
  });

  it('A9: una sesión de OTRA empresa no ve ni sube ni borra adjuntos del pedido ajeno', async () => {
    const idPedido = await crearPedidoDePrueba(empresa.id);
    await solicitarSubidaAdjuntoPedido(
      sesion([...PERM_TODOS]),
      idPedido,
      { nombreOriginal: 'oc.pdf', tipoMime: 'application/pdf', tamanoBytes: 1234 },
      bd(),
      archivosFalsos(),
    );

    const ajena = sesion([...PERM_TODOS], otraEmpresa.id);
    await expect(
      listarAdjuntosPedido(ajena, idPedido, bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    await expect(
      solicitarSubidaAdjuntoPedido(
        ajena,
        idPedido,
        { nombreOriginal: 'x.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
        bd(),
        archivosFalsos(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    await expect(
      eliminarAdjuntoPedido(ajena, idPedido, 'x', bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});
