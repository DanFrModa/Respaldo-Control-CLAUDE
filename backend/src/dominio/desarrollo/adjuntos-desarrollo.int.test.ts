import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { ServicioArchivos } from '../../comun/archivos.js';
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
import { crearDesarrollo } from './desarrollos.js';
import { crearProyecto } from './proyectos.js';
import { eliminarAdjunto, listarAdjuntos, solicitarSubidaAdjunto } from './adjuntos-desarrollo.js';

/**
 * Integración del dominio de ADJUNTOS del DESARROLLO (tech pack, B16) contra el Postgres efímero.
 *
 * 🔴 **Por qué nace este archivo (V1 «los nombres, en vez de los ids»).** `adjuntos-desarrollo.ts` es
 * la gemela CARÁCTER POR CARÁCTER de `produccion/adjuntos-orden.ts`, y no tenía **ninguna** prueba:
 * la gemela sí, y en la misma etapa recibió dos pruebas nuevas mientras ésta recibía cero. Ésa es
 * exactamente la asimetría que la etapa vino a cerrar, un piso más abajo — así que se cierra aquí.
 *
 * Cubre lo mismo que su gemela: ligado real `Archivo`↔`DesarrolloArchivo`, el scope de empresa (A9,
 * vía proyecto→empresa), permisos deny-by-default (A4), el borrado físico R2 best-effort (fake) y
 * la resolución server-side del nombre de quien subió. NO corre en local (usa Docker): el CI.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let clienteNegocio: Cliente;
let departamento: ClienteDepartamento;
let modelo: Modelo;

const PERM_TODOS: ClavePermiso[] = ['desarrollo.ver', 'desarrollo.administrar'];

function sesion(permisos: ClavePermiso[], idEmpresaActiva = empresa.id): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva, permisos });
}

const bd = () => ({ cliente });

/** Spy del borrado físico de R2 (best-effort). Se reinicia por test. */
let eliminarObjetoSpy: Mock<(key: string) => void>;

/**
 * Fake del servicio de archivos: NO toca R2, pero SÍ crea el registro `Archivo` en la transacción
 * (igual que el real) para que `DesarrolloArchivo` tenga su FK. Espejo del de la gemela.
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

/** Crea un desarrollo en la empresa dada y devuelve su id (pasa por el dominio). */
async function crearDesarrolloDePrueba(idEmpresa: number, codigo = 'A-100'): Promise<number> {
  const s = sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: [...PERM_TODOS] });
  const proyecto = await crearProyecto(
    s,
    {
      idCliente: clienteNegocio.id,
      idClienteDepartamento: departamento.id,
      nombre: `Joggers ${codigo}`,
    },
    bd(),
  );
  const mod =
    codigo === 'A-100'
      ? modelo
      : await cliente.modelo.create({ data: { codigo, descripcion: 'Otro' } });
  const desarrollo = await crearDesarrollo(s, proyecto.id, { idModelo: mod.id }, bd());
  return desarrollo.id;
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
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'C&A' } });
  departamento = await cliente.clienteDepartamento.create({
    data: { idCliente: clienteNegocio.id, nombre: 'Caballero' },
  });
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  eliminarObjetoSpy = vi.fn<(key: string) => void>();
});

describe('Adjuntos de desarrollo (B16) — permisos (deny-by-default, A4)', () => {
  it('subir/eliminar exigen desarrollo.administrar; listar exige desarrollo.ver', async () => {
    const idDesarrollo = await crearDesarrolloDePrueba(empresa.id);

    await expect(
      solicitarSubidaAdjunto(
        sesion(['desarrollo.ver']),
        idDesarrollo,
        { nombreOriginal: 'x.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
        bd(),
        archivosFalsos(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);

    await expect(
      listarAdjuntos(sesion([]), idDesarrollo, bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorPermiso);

    // 🔴 La reja de ELIMINAR, que el nombre de este `it()` promete. Sin esta línea, borrar
    // `verificarPermiso(sesion, 'desarrollo.administrar')` de `eliminarAdjunto` sobrevive el
    // archivo entero: cualquiera con `desarrollo.ver` borrando tech packs.
    await expect(
      eliminarAdjunto(sesion(['desarrollo.ver']), idDesarrollo, 'x', bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('Adjuntos de desarrollo (B16) — ligado, listado y borrado', () => {
  it('sube, liga el Archivo y lo lista con su URL de descarga', async () => {
    const idDesarrollo = await crearDesarrolloDePrueba(empresa.id);
    const subida = await solicitarSubidaAdjunto(
      sesion([...PERM_TODOS]),
      idDesarrollo,
      { nombreOriginal: 'techpack.pdf', tipoMime: 'application/pdf', tamanoBytes: 1234 },
      bd(),
      archivosFalsos(),
    );
    expect(subida.urlSubida).toContain('https://');

    const puente = await cliente.desarrolloArchivo.findFirst({ where: { idDesarrollo } });
    expect(puente?.idArchivo).toBe(subida.idArchivo);

    const lista = await listarAdjuntos(
      sesion([...PERM_TODOS]),
      idDesarrollo,
      bd(),
      archivosFalsos(),
    );
    expect(lista).toHaveLength(1);
    expect(lista[0]?.nombreOriginal).toBe('techpack.pdf');
    expect(lista[0]?.urlDescarga).toContain('https://');
  });

  it('A9: una sesión de OTRA empresa no ve ni sube ni borra adjuntos del desarrollo ajeno', async () => {
    const idDesarrollo = await crearDesarrolloDePrueba(empresa.id);
    const ajena = sesion([...PERM_TODOS], otraEmpresa.id);

    await expect(
      listarAdjuntos(ajena, idDesarrollo, bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);

    await expect(
      solicitarSubidaAdjunto(
        ajena,
        idDesarrollo,
        { nombreOriginal: 'x.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
        bd(),
        archivosFalsos(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    await expect(
      eliminarAdjunto(ajena, idDesarrollo, 'x', bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('eliminar un adjunto que no pertenece al desarrollo → ErrorNoEncontrado', async () => {
    const idDesarrollo = await crearDesarrolloDePrueba(empresa.id);
    await expect(
      eliminarAdjunto(sesion([...PERM_TODOS]), idDesarrollo, 'no-existe', bd(), archivosFalsos()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('eliminar borra el Archivo (Cascade arrastra el DesarrolloArchivo) y borra el objeto R2', async () => {
    const idDesarrollo = await crearDesarrolloDePrueba(empresa.id);
    const subida = await solicitarSubidaAdjunto(
      sesion([...PERM_TODOS]),
      idDesarrollo,
      { nombreOriginal: 'viejo.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
      bd(),
      archivosFalsos(),
    );

    await eliminarAdjunto(
      sesion([...PERM_TODOS]),
      idDesarrollo,
      subida.idArchivo,
      bd(),
      archivosFalsos(),
    );

    expect(await cliente.archivo.findUnique({ where: { id: subida.idArchivo } })).toBeNull();
    expect(await cliente.desarrolloArchivo.findFirst({ where: { idDesarrollo } })).toBeNull();
    expect(eliminarObjetoSpy).toHaveBeenCalledOnce();
  });
});

describe('Adjuntos de desarrollo (V1) — el NOMBRE de quien subió', () => {
  /**
   * ⭐ V1 «los nombres, en vez de los ids» — `Archivo.subidoPorId` no tiene FK al usuario, así que
   * el nombre lo resuelve el servidor, en bloque para todos los adjuntos (nunca uno por fila).
   *
   * 🔴 Si el servidor devolviera `null` aquí, la pantalla NO cae al id: pinta «Usuario dado de
   * baja» en TODOS los renglones —dejaría por escrito que dieron de baja a quien ahí sigue—. Las
   * pruebas de frontend no pueden verlo porque mockean el API; por eso esta aserción es de
   * integración.
   */
  it('🔴 cada adjunto sale con el NOMBRE de quien lo subió (resuelto en el servidor)', async () => {
    const autor = await cliente.usuario.create({
      data: {
        username: 'ana-techpack',
        nombre: 'Ana Ruiz',
        email: 'ana-techpack@control.local',
      },
    });
    const idDesarrollo = await crearDesarrolloDePrueba(empresa.id);
    const sesionAutor = { ...sesion([...PERM_TODOS]), id: autor.id };
    await solicitarSubidaAdjunto(
      sesionAutor,
      idDesarrollo,
      { nombreOriginal: 'techpack-v2.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
      bd(),
      archivosFalsos(),
    );

    const lista = await listarAdjuntos(
      sesion([...PERM_TODOS]),
      idDesarrollo,
      bd(),
      archivosFalsos(),
    );
    expect(lista[0]?.subidoPorId).toBe(autor.id);
    expect(lista[0]?.nombreSubidoPor).toBe('Ana Ruiz');
  });

  /** 🔴 D3 — sin autor resoluble el nombre es null, pero el adjunto SIGUE listándose y descargable. */
  it('un autor desconocido deja el nombre en null pero NO esconde el adjunto', async () => {
    const idDesarrollo = await crearDesarrolloDePrueba(empresa.id);
    // `sesion()` usa el id 'usuario-prueba', que no existe como fila en la BD.
    await solicitarSubidaAdjunto(
      sesion([...PERM_TODOS]),
      idDesarrollo,
      { nombreOriginal: 'huerfano.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
      bd(),
      archivosFalsos(),
    );

    const lista = await listarAdjuntos(
      sesion([...PERM_TODOS]),
      idDesarrollo,
      bd(),
      archivosFalsos(),
    );
    expect(lista).toHaveLength(1);
    expect(lista[0]?.nombreSubidoPor).toBeNull();
    expect(lista[0]?.nombreOriginal).toBe('huerfano.pdf');
    expect(lista[0]?.urlDescarga).toContain('https://');
  });
});
