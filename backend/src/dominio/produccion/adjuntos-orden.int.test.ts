import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { ServicioArchivos } from '../../comun/archivos.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Cliente, Empresa, Modelo, PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { crearOrden } from './ordenes.js';
import { eliminarAdjunto, listarAdjuntos, solicitarSubidaAdjunto } from './adjuntos-orden.js';

/**
 * Integración del dominio de ADJUNTOS de la orden (F8-E6, R6) contra el Postgres efímero
 * (testcontainers). Cubre lo que SOLO la base valida: el ligado real `Archivo`↔`OrdenArchivo`, el
 * borrado por Cascade (borrar el Archivo arrastra el OrdenArchivo), el scope de empresa (A9: una
 * orden de otra empresa no se ve ni se toca) y el borrado físico R2 best-effort (fake). NO corre en
 * local (usa Docker): el CI.
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

/** Spy del borrado físico de R2 (best-effort). Se reinicia por test. */
let eliminarObjetoSpy: Mock<(key: string) => void>;

/**
 * Fake del servicio de archivos: NO toca R2, pero SÍ crea el registro `Archivo` en la transacción
 * (igual que el real) para que `OrdenArchivo` tenga su FK. Las URLs son ficticias; `eliminarObjeto`
 * es un spy para verificar el borrado físico best-effort.
 */
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
    eliminarObjeto(key) {
      eliminarObjetoSpy(key);
      return Promise.resolve();
    },
  };
}

/** Crea una orden en la empresa dada y devuelve su id (pasa por el dominio de órdenes). */
async function crearOrdenDePrueba(idEmpresa: number): Promise<number> {
  const pedido = await cliente.pedido.create({
    data: {
      folio: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
      idEmpresa,
      idCliente: clienteNegocio.id,
    },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 100, precio: 50 },
  });
  const orden = await crearOrden(
    sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: [...PERM_TODOS] }),
    { idPedidoLinea: linea.id },
    bd(),
  );
  return orden.id;
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
  eliminarObjetoSpy = vi.fn<(key: string) => void>();
});

describe('Adjuntos de orden (F8-E6) — permisos (deny-by-default, A4)', () => {
  it('subir/eliminar exigen ordenes.administrar; listar exige ordenes.ver', async () => {
    const idOrden = await crearOrdenDePrueba(empresa.id);
    await expect(
      solicitarSubidaAdjunto(
        sesion(['ordenes.ver']),
        idOrden,
        { nombreOriginal: 'f.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
        bd(),
        archivosFalsos(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(
      listarAdjuntos(sesion([]), idOrden, bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(
      eliminarAdjunto(sesion(['ordenes.ver']), idOrden, 'x', bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('Adjuntos de orden (F8-E6) — subir/listar/eliminar (A2, A9)', () => {
  it('sube, liga el Archivo y lo lista con su URL de descarga', async () => {
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const subida = await solicitarSubidaAdjunto(
      sesion([...PERM_TODOS]),
      idOrden,
      { nombreOriginal: 'ficha.pdf', tipoMime: 'application/pdf', tamanoBytes: 1234 },
      bd(),
      archivosFalsos(),
    );
    expect(subida.urlSubida).toContain('https://');

    // El OrdenArchivo quedó ligado al Archivo.
    const puente = await cliente.ordenArchivo.findFirst({ where: { idOrden } });
    expect(puente?.idArchivo).toBe(subida.idArchivo);

    const lista = await listarAdjuntos(sesion([...PERM_TODOS]), idOrden, bd(), archivosFalsos());
    expect(lista).toHaveLength(1);
    expect(lista[0]?.nombreOriginal).toBe('ficha.pdf');
    expect(lista[0]?.urlDescarga).toContain('https://');
  });

  it('eliminar borra el Archivo (Cascade arrastra el OrdenArchivo) y borra el objeto R2 (best-effort)', async () => {
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const subida = await solicitarSubidaAdjunto(
      sesion([...PERM_TODOS]),
      idOrden,
      { nombreOriginal: 'ficha.pdf', tipoMime: 'application/pdf', tamanoBytes: 1234 },
      bd(),
      archivosFalsos(),
    );

    await eliminarAdjunto(
      sesion([...PERM_TODOS]),
      idOrden,
      subida.idArchivo,
      bd(),
      archivosFalsos(),
    );

    // El registro Archivo y el puente OrdenArchivo desaparecieron; el objeto R2 se borró.
    expect(await cliente.archivo.findUnique({ where: { id: subida.idArchivo } })).toBeNull();
    expect(await cliente.ordenArchivo.count({ where: { idOrden } })).toBe(0);
    expect(eliminarObjetoSpy).toHaveBeenCalledTimes(1);
  });

  it('A9: una sesión de OTRA empresa no ve ni sube ni borra adjuntos de la orden ajena', async () => {
    const idOrden = await crearOrdenDePrueba(empresa.id);
    await solicitarSubidaAdjunto(
      sesion([...PERM_TODOS]),
      idOrden,
      { nombreOriginal: 'ficha.pdf', tipoMime: 'application/pdf', tamanoBytes: 1234 },
      bd(),
      archivosFalsos(),
    );

    const ajena = sesion([...PERM_TODOS], otraEmpresa.id);
    await expect(listarAdjuntos(ajena, idOrden, bd(), archivosFalsos())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
    await expect(
      solicitarSubidaAdjunto(
        ajena,
        idOrden,
        { nombreOriginal: 'x.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
        bd(),
        archivosFalsos(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    await expect(
      eliminarAdjunto(ajena, idOrden, 'x', bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('eliminar un adjunto que no pertenece a la orden → ErrorNoEncontrado', async () => {
    const idOrden = await crearOrdenDePrueba(empresa.id);
    await expect(
      eliminarAdjunto(sesion([...PERM_TODOS]), idOrden, 'no-existe', bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});
