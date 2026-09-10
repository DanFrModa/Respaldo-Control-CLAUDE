import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { ServicioArchivos } from '../../comun/archivos.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Almacen,
  Empresa,
  PrismaClient,
  Proveedor,
  Tela,
  TelaColor,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { autorizarOC, crearOC } from '../compras/ordenes-compra.js';
import { crearEntradaTela } from './entradas-tela.js';
import {
  eliminarAdjuntoEntradaTela,
  listarAdjuntosEntradaTela,
  solicitarSubidaAdjuntoEntradaTela,
} from './adjuntos-entrada-tela.js';

/**
 * Integración de los ADJUNTOS de la ENTRADA DE TELA (B1 — el PDF de la factura) contra el Postgres
 * efímero (testcontainers). Espejo de `produccion/adjuntos-orden.int.test.ts`: cubre lo que SOLO la
 * base valida — el ligado real `Archivo`↔`EntradaTelaArchivo`, el borrado por Cascade (borrar el
 * Archivo arrastra el puente), el scope de empresa (A9: un documento de otra empresa no se ve ni se
 * toca) y el borrado físico R2 best-effort (fake). NO corre en local (usa Docker): lo corre el CI.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let proveedor: Proveedor;
let tela: Tela;
let color: TelaColor;
let almacen: Almacen;
let idDireccionEntrega: number;

const PERM_TODOS: ClavePermiso[] = ['inventario-telas.ver', 'inventario-telas.mover'];
/** §Post-F9.159(a): ya no hay entrada sin OC, y levantarla exige los permisos de compras. */
const PERM_CON_COMPRAS: ClavePermiso[] = [
  ...PERM_TODOS,
  'compras.ver',
  'compras.administrar',
  'compras.autorizar',
];

function sesion(permisos: ClavePermiso[], idEmpresaActiva = empresa.id): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva, permisos });
}

const bd = () => ({ cliente });

/** Spy del borrado físico de R2 (best-effort). Se reinicia por test. */
let eliminarObjetoSpy: Mock<(key: string) => void>;

/**
 * Fake del servicio de archivos: NO toca R2, pero SÍ crea el registro `Archivo` en la transacción
 * (igual que el real) para que `EntradaTelaArchivo` tenga su FK.
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
    subirContenido() {
      throw new Error(
        'Este flujo usa solicitarSubida (presigned), no subirContenido (server-side).',
      );
    },
    urlDescarga(key) {
      return Promise.resolve(`https://r2.fake/get/${key}`);
    },
    descargarContenido(key) {
      return Promise.resolve(Buffer.from(`contenido-falso:${key}`, 'utf8'));
    },
    eliminarObjeto(key) {
      eliminarObjetoSpy(key);
      return Promise.resolve();
    },
  };
}

/**
 * Captura un documento de entrada (borrador) en la empresa dada y devuelve su id.
 *
 * §Post-F9.159(a) — no se recibe tela sin OC, así que le levanta y autoriza SU orden de compra en
 * ESA empresa (una entrada de la empresa B no se surte con la orden de la A, A9).
 */
async function crearEntradaDePrueba(idEmpresa: number): Promise<number> {
  const sesionCompras = sesion([...PERM_CON_COMPRAS], idEmpresa);
  const oc = await crearOC(
    sesionCompras,
    {
      fechaEntrega: '2026-09-30',
      idDireccionEntrega,
      idProveedor: proveedor.id,
      lineas: [{ idTela: tela.id, cantidad: 1_000, precio: 1, unidad: 'kg' }],
    },
    bd(),
  );
  await autorizarOC(sesionCompras, oc.id, bd());
  const idOrdenCompraLinea = oc.lineas[0]?.id;
  if (idOrdenCompraLinea === undefined) {
    throw new Error('Fixture roto: la OC no devolvió su renglón de tela.');
  }
  const entrada = await crearEntradaTela(
    sesion([...PERM_TODOS], idEmpresa),
    {
      tipoDocumento: 'factura',
      numeroDocumento: `F-${String(Math.floor(Math.random() * 100000))}`,
      idProveedor: proveedor.id,
      fecha: '2026-08-06',
      idAlmacen: almacen.id,
      lineas: [{ idTelaColor: color.id, cantidad: 10, idOrdenCompraLinea }],
    },
    bd(),
  );
  return entrada.id;
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
  proveedor = await cliente.proveedor.create({ data: { nombre: 'Textiles del Norte' } });
  tela = await cliente.tela.create({ data: { nombre: 'Felpa Suiza' } });
  color = await cliente.telaColor.create({ data: { idTela: tela.id, nombre: 'Marino' } });
  almacen = await cliente.almacen.create({ data: { nombre: 'Bodega Telas', tipo: 'TELA' } });
  const direccion = await cliente.direccionEntrega.create({
    data: { nombre: 'Bodega Naucalpan', direccion: 'Av. Siempre Viva 123', favorita: true },
  });
  idDireccionEntrega = direccion.id;
  eliminarObjetoSpy = vi.fn<(key: string) => void>();
});

describe('Adjuntos de entrada de tela (B1) — permisos (deny-by-default, A4)', () => {
  it('subir/eliminar exigen inventario-telas.mover; listar exige inventario-telas.ver', async () => {
    const id = await crearEntradaDePrueba(empresa.id);
    await expect(
      solicitarSubidaAdjuntoEntradaTela(
        sesion(['inventario-telas.ver']),
        id,
        { nombreOriginal: 'f.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
        bd(),
        archivosFalsos(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(
      listarAdjuntosEntradaTela(sesion([]), id, bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(
      eliminarAdjuntoEntradaTela(sesion(['inventario-telas.ver']), id, 'x', bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('Adjuntos de entrada de tela (B1) — subir/listar/eliminar (A2, A9)', () => {
  it('sube, liga el Archivo y lo lista con su URL de descarga', async () => {
    const id = await crearEntradaDePrueba(empresa.id);
    const subida = await solicitarSubidaAdjuntoEntradaTela(
      sesion([...PERM_TODOS]),
      id,
      { nombreOriginal: 'factura.pdf', tipoMime: 'application/pdf', tamanoBytes: 1234 },
      bd(),
      archivosFalsos(),
    );
    expect(subida.urlSubida).toContain('https://');

    const puente = await cliente.entradaTelaArchivo.findFirst({ where: { idEntradaTela: id } });
    expect(puente?.idArchivo).toBe(subida.idArchivo);

    const lista = await listarAdjuntosEntradaTela(
      sesion([...PERM_TODOS]),
      id,
      bd(),
      archivosFalsos(),
    );
    expect(lista).toHaveLength(1);
    expect(lista[0]?.nombreOriginal).toBe('factura.pdf');
    expect(lista[0]?.urlDescarga).toContain('https://');
  });

  it('eliminar borra el Archivo (Cascade arrastra el puente) y borra el objeto R2 (best-effort)', async () => {
    const id = await crearEntradaDePrueba(empresa.id);
    const subida = await solicitarSubidaAdjuntoEntradaTela(
      sesion([...PERM_TODOS]),
      id,
      { nombreOriginal: 'factura.pdf', tipoMime: 'application/pdf', tamanoBytes: 1234 },
      bd(),
      archivosFalsos(),
    );

    await eliminarAdjuntoEntradaTela(
      sesion([...PERM_TODOS]),
      id,
      subida.idArchivo,
      bd(),
      archivosFalsos(),
    );

    expect(await cliente.archivo.findUnique({ where: { id: subida.idArchivo } })).toBeNull();
    expect(await cliente.entradaTelaArchivo.count({ where: { idEntradaTela: id } })).toBe(0);
    expect(eliminarObjetoSpy).toHaveBeenCalledTimes(1);
  });

  it('A9: una sesión de OTRA empresa no ve ni sube ni borra adjuntos del documento ajeno', async () => {
    const id = await crearEntradaDePrueba(empresa.id);
    await solicitarSubidaAdjuntoEntradaTela(
      sesion([...PERM_TODOS]),
      id,
      { nombreOriginal: 'factura.pdf', tipoMime: 'application/pdf', tamanoBytes: 1234 },
      bd(),
      archivosFalsos(),
    );

    const ajena = sesion([...PERM_TODOS], otraEmpresa.id);
    await expect(
      listarAdjuntosEntradaTela(ajena, id, bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    await expect(
      solicitarSubidaAdjuntoEntradaTela(
        ajena,
        id,
        { nombreOriginal: 'x.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
        bd(),
        archivosFalsos(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    await expect(
      eliminarAdjuntoEntradaTela(ajena, id, 'x', bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    // El adjunto sigue vivo (la sesión ajena no borró nada).
    expect(await cliente.entradaTelaArchivo.count({ where: { idEntradaTela: id } })).toBe(1);
  });

  it('eliminar un adjunto que NO pertenece a ese documento → ErrorNoEncontrado', async () => {
    const id = await crearEntradaDePrueba(empresa.id);
    const otroId = await crearEntradaDePrueba(empresa.id);
    // El adjunto vive en OTRO documento de la MISMA empresa.
    const subida = await solicitarSubidaAdjuntoEntradaTela(
      sesion([...PERM_TODOS]),
      otroId,
      { nombreOriginal: 'ajena.pdf', tipoMime: 'application/pdf', tamanoBytes: 100 },
      bd(),
      archivosFalsos(),
    );

    await expect(
      eliminarAdjuntoEntradaTela(
        sesion([...PERM_TODOS]),
        id,
        subida.idArchivo,
        bd(),
        archivosFalsos(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    // Y el adjunto del otro documento sigue intacto.
    expect(await cliente.entradaTelaArchivo.count({ where: { idEntradaTela: otroId } })).toBe(1);
    expect(eliminarObjetoSpy).not.toHaveBeenCalled();
  });
});
