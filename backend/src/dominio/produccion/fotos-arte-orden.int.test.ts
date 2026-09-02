import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { ServicioArchivos } from '../../comun/archivos.js';
import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Cliente, Empresa, Modelo, PrismaClient } from '../../datos/index.js';
import {
  clientePruebas,
  crearEmpresaPrueba,
  crearTipoArtePrueba,
  limpiarBaseDatos,
} from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  leerArteOrdenParaImpreso,
  listarFotosArteOrden,
  mostrarFotoArteEnOrden,
  ocultarFotoArteEnOrden,
  quitarFotoArteOrden,
  solicitarSubidaFotoArteOrden,
} from './fotos-arte-orden.js';
import { crearOrden } from './ordenes.js';

/**
 * ⭐ §Post-F9.177 — integración contra el Postgres efímero (testcontainers) de LAS FOTOS DEL ARTE
 * POR OP. Cubre lo que SÓLO la base puede decir:
 *
 *  • las dos LLAVES ÚNICAS de verdad: `(renglón, foto)` de la marca —idempotencia sin doble fila— y
 *    `(idArchivo)` de la foto propia, que es lo que permite borrar su objeto de R2 sin contar
 *    huérfanos;
 *  • que la foto del ARTE DEL MODELO **sigue existiendo** tras apagarla en una OP (la fila, no un
 *    doble), y que **otra orden del mismo modelo la sigue viendo**;
 *  • ⭐ que apagar una foto **NO se lleva por delante** un `Archivo` que OTRO arte del modelo
 *    comparte — el caso que hace inviable congelar las fotos por orden;
 *  • los Cascade: borrar la foto del arte se lleva la marca (apagarla en una OP **no secuestra** el
 *    catálogo), y borrar la orden se lleva el renglón con sus fotos propias;
 *  • ⭐ el HIJO POR COLOR (V1-E9a/b): la receta se copia del modelo de DESARROLLO, así que la traza
 *    del renglón apunta al arte del padre — y apagar una de SUS fotos tiene que funcionar;
 *  • el scope de empresa (A9) contra filas reales.
 *
 * NO corre en local (usa Docker): el CI.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let clienteNegocio: Cliente;
let modelo: Modelo;
let idTipoArte: number;

const PERM_ORDEN: ClavePermiso[] = ['ordenes.ver', 'ordenes.administrar'];
const PERM_TODOS: ClavePermiso[] = [
  'ordenes.ver',
  'ordenes.administrar',
  'desarrollo.ver',
  'desarrollo.administrar',
];

function sesion(permisos: ClavePermiso[], idEmpresaActiva = empresa.id): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva, permisos });
}

const bd = () => ({ cliente });

/**
 * Lista las fotos de arte de una orden inyectando SIEMPRE un servicio de archivos de mentira: el
 * real (`servicioArchivos()`) exige las variables de entorno de R2, que aquí no existen.
 */
function listar(permisos: ClavePermiso[], idOrden: number) {
  return listarFotosArteOrden(sesion(permisos), idOrden, bd(), archivosFalsos().servicio);
}

/** Servicio de archivos de mentira: registra el `Archivo` de verdad y anota los borrados de R2. */
function archivosFalsos(): { servicio: ServicioArchivos; eliminados: string[] } {
  const eliminados: string[] = [];
  const servicio = {
    solicitarSubida: async (
      tx: PrismaClient,
      _sesion: SesionUsuario,
      datos: { nombreOriginal: string; tipoMime: string; tamanoBytes: number; carpeta: string },
    ) => {
      const archivo = await tx.archivo.create({
        data: {
          bucket: 'control-v2-prueba',
          key: `${datos.carpeta}/${datos.nombreOriginal}`,
          nombreOriginal: datos.nombreOriginal,
          tipoMime: datos.tipoMime,
          tamanoBytes: datos.tamanoBytes,
        },
      });
      return { archivo, urlSubida: `https://r2.local/PUT/${archivo.key}`, expiraEnSegundos: 900 };
    },
    urlDescarga: (key: string) => Promise.resolve(`https://r2.local/GET/${key}`),
    eliminarObjeto: (key: string) => {
      eliminados.push(key);
      return Promise.resolve();
    },
  } as unknown as ServicioArchivos;
  return { servicio, eliminados };
}

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
    sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: [...PERM_ORDEN] }),
    { idPedidoLinea: linea.id },
    bd(),
  );
  return orden.id;
}

/** Crea un ARTE del modelo con N fotos reales (Archivo + ModeloArteFoto). */
async function crearArteModelo(
  idModelo: number,
  descripcion: string,
  nombresFoto: string[],
): Promise<{ idArte: number; fotos: { idFoto: number; idArchivo: string }[] }> {
  const arte = await cliente.modeloArte.create({
    data: { idModelo, descripcion, idTipoArte },
  });
  const fotos: { idFoto: number; idArchivo: string }[] = [];
  for (const [i, nombre] of nombresFoto.entries()) {
    const archivo = await cliente.archivo.create({
      data: {
        bucket: 'control-v2-prueba',
        key: `modelo-arte/${String(arte.id)}/${nombre}`,
        nombreOriginal: nombre,
        tipoMime: 'image/jpeg',
        tamanoBytes: 1024,
      },
    });
    const foto = await cliente.modeloArteFoto.create({
      data: { idModeloArte: arte.id, idArchivo: archivo.id, orden: i },
    });
    fotos.push({ idFoto: foto.id, idArchivo: archivo.id });
  }
  return { idArte: arte.id, fotos };
}

/** El renglón de arte que la orden congeló para ESE arte del modelo. */
async function renglonDe(idOrden: number, idModeloArte: number | null): Promise<number> {
  const renglon = await cliente.ordenArte.findFirstOrThrow({
    where: { idOrden, idModeloArte },
    select: { id: true },
  });
  return renglon.id;
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
  idTipoArte = await crearTipoArtePrueba(cliente);
});

describe('Fotos del arte de la OP — permisos y empresa (A4/A9)', () => {
  it('mutar exige desarrollo.administrar; ordenes.administrar NO alcanza (§Post-F9.72)', async () => {
    const { idArte, fotos } = await crearArteModelo(modelo.id, 'Logo pecho', ['frente.jpg']);
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const idRenglon = await renglonDe(idOrden, idArte);
    const idFoto = fotos[0]?.idFoto as number;

    await expect(
      ocultarFotoArteEnOrden(
        sesion([...PERM_ORDEN]),
        idOrden,
        idRenglon,
        { idModeloArteFoto: idFoto },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(await cliente.ordenArteFotoOculta.count()).toBe(0);
  });

  it('⭐ LEER acepta ordenes.ver O desarrollo.ver (la pareja de la receta, V1-E3j)', async () => {
    await crearArteModelo(modelo.id, 'Logo pecho', ['frente.jpg']);
    const idOrden = await crearOrdenDePrueba(empresa.id);

    await expect(listar(['ordenes.ver'], idOrden)).resolves.toHaveLength(1);
    await expect(listar(['desarrollo.ver'], idOrden)).resolves.toHaveLength(1);
    await expect(listar([], idOrden)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('una orden de OTRA empresa no se ve ni se toca (A9)', async () => {
    await crearArteModelo(modelo.id, 'Logo pecho', ['frente.jpg']);
    const idOrdenAjena = await crearOrdenDePrueba(otraEmpresa.id);
    const idRenglon = (
      await cliente.ordenArte.findFirstOrThrow({ where: { idOrden: idOrdenAjena } })
    ).id;

    await expect(listar([...PERM_TODOS], idOrdenAjena)).rejects.toBeInstanceOf(ErrorNoEncontrado);
    await expect(
      ocultarFotoArteEnOrden(
        sesion([...PERM_TODOS]),
        idOrdenAjena,
        idRenglon,
        { idModeloArteFoto: 1 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(await cliente.ordenArteFotoOculta.count()).toBe(0);
  });
});

describe('⭐ Apagar una heredada NO es borrar (D3)', () => {
  it('⭐ la foto del ARTE DEL MODELO sigue viva, con su Archivo, tras apagarla en la OP', async () => {
    const { idArte, fotos } = await crearArteModelo(modelo.id, 'Logo pecho', ['a.jpg', 'b.jpg']);
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const idRenglon = await renglonDe(idOrden, idArte);
    const primera = fotos[0] as { idFoto: number; idArchivo: string };

    await ocultarFotoArteEnOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      idRenglon,
      { idModeloArteFoto: primera.idFoto },
      bd(),
    );

    expect(await cliente.ordenArteFotoOculta.count({ where: { idOrdenArte: idRenglon } })).toBe(1);
    // La foto del modelo NO se movió: sigue su fila, sigue su Archivo (su objeto de R2 jamás
    // estuvo en peligro) y sigue colgando del mismo arte.
    const foto = await cliente.modeloArteFoto.findUnique({ where: { id: primera.idFoto } });
    expect(foto?.idModeloArte).toBe(idArte);
    expect(await cliente.archivo.findUnique({ where: { id: primera.idArchivo } })).not.toBeNull();
    expect(await cliente.modeloArteFoto.count({ where: { idModeloArte: idArte } })).toBe(2);
  });

  it('⭐ OTRA ORDEN del mismo modelo la sigue enseñando (la marca es por RENGLÓN)', async () => {
    const { idArte, fotos } = await crearArteModelo(modelo.id, 'Logo pecho', ['a.jpg']);
    const idOrdenA = await crearOrdenDePrueba(empresa.id);
    const idOrdenB = await crearOrdenDePrueba(empresa.id);
    const idRenglonA = await renglonDe(idOrdenA, idArte);
    const idFoto = fotos[0]?.idFoto as number;

    await ocultarFotoArteEnOrden(
      sesion([...PERM_TODOS]),
      idOrdenA,
      idRenglonA,
      { idModeloArteFoto: idFoto },
      bd(),
    );

    const [arteA] = await listar([...PERM_TODOS], idOrdenA);
    const [arteB] = await listar([...PERM_TODOS], idOrdenB);
    expect(arteA?.fotos.map((f) => f.oculta)).toEqual([true]);
    expect(arteB?.fotos.map((f) => f.oculta)).toEqual([false]);
    expect(await leerArteOrdenParaImpreso(cliente, idOrdenB)).toEqual([
      expect.objectContaining({ ocultas: [] }),
    ]);
  });

  it('la LLAVE ÚNICA sostiene la idempotencia: apagar dos veces deja UNA fila', async () => {
    const { idArte, fotos } = await crearArteModelo(modelo.id, 'Logo pecho', ['a.jpg']);
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const idRenglon = await renglonDe(idOrden, idArte);
    const idFoto = fotos[0]?.idFoto as number;

    await ocultarFotoArteEnOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      idRenglon,
      { idModeloArteFoto: idFoto },
      bd(),
    );
    const segunda = await ocultarFotoArteEnOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      idRenglon,
      { idModeloArteFoto: idFoto },
      bd(),
    );

    expect(segunda).toEqual([idFoto]);
    expect(await cliente.ordenArteFotoOculta.count({ where: { idOrdenArte: idRenglon } })).toBe(1);
  });

  it('🔴 una foto de OTRO arte del modelo no se puede apagar en este renglón (404, y sin fila)', async () => {
    const { idArte } = await crearArteModelo(modelo.id, 'Logo pecho', ['a.jpg']);
    const otro = await crearArteModelo(modelo.id, 'Etiqueta', ['ajena.jpg']);
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const idRenglon = await renglonDe(idOrden, idArte);

    await expect(
      ocultarFotoArteEnOrden(
        sesion([...PERM_TODOS]),
        idOrden,
        idRenglon,
        { idModeloArteFoto: otro.fotos[0]?.idFoto as number },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(await cliente.ordenArteFotoOculta.count()).toBe(0);
  });

  it('⭐⭐ el HIJO POR COLOR: la traza va al arte del PADRE y apagar su foto FUNCIONA', async () => {
    const { idArte, fotos } = await crearArteModelo(modelo.id, 'Bordado pecho', ['padre.jpg']);
    const hijo = await cliente.modelo.create({
      data: { codigo: 'A-101', descripcion: 'Playera roja', idModeloDesarrollo: modelo.id },
    });
    const idOrden = await crearOrdenDePrueba(empresa.id, hijo.id);
    // La receta del hijo se copió del PADRE: su renglón traza al arte del padre.
    const idRenglon = await renglonDe(idOrden, idArte);
    const idFoto = fotos[0]?.idFoto as number;

    await expect(
      ocultarFotoArteEnOrden(
        sesion([...PERM_TODOS]),
        idOrden,
        idRenglon,
        { idModeloArteFoto: idFoto },
        bd(),
      ),
    ).resolves.toEqual([idFoto]);
  });

  it('traerla de vuelta la vuelve a enseñar, y hacerlo dos veces no falla', async () => {
    const { idArte, fotos } = await crearArteModelo(modelo.id, 'Logo pecho', ['a.jpg']);
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const idRenglon = await renglonDe(idOrden, idArte);
    const idFoto = fotos[0]?.idFoto as number;

    await ocultarFotoArteEnOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      idRenglon,
      { idModeloArteFoto: idFoto },
      bd(),
    );
    await expect(
      mostrarFotoArteEnOrden(sesion([...PERM_TODOS]), idOrden, idRenglon, idFoto, bd()),
    ).resolves.toEqual([]);
    await expect(
      mostrarFotoArteEnOrden(sesion([...PERM_TODOS]), idOrden, idRenglon, idFoto, bd()),
    ).resolves.toEqual([]);
    expect(await cliente.ordenArteFotoOculta.count()).toBe(0);
  });
});

describe('⭐ Fotos PROPIAS de la OP (R2) — y el arte AGREGADO A MANO', () => {
  it('⭐ un arte AGREGADO A MANO por fin puede llevar foto', async () => {
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const renglon = await cliente.ordenArte.create({
      data: {
        idOrden,
        idModeloArte: null,
        descripcion: 'Etiqueta especial',
        idTipoArte,
        agregadoAMano: true,
      },
    });
    const { servicio } = archivosFalsos();

    const subida = await solicitarSubidaFotoArteOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      renglon.id,
      { nombreOriginal: 'etiqueta.jpg', tipoMime: 'image/jpeg', tamanoBytes: 2048 },
      bd(),
      servicio,
    );

    expect(subida.urlSubida).toContain(`orden-arte/${String(renglon.id)}`);
    const [arte] = await listarFotosArteOrden(sesion([...PERM_TODOS]), idOrden, bd(), servicio);
    expect(arte?.agregadoAMano).toBe(true);
    expect(arte?.fotos.map((f) => [f.origen, f.idFoto])).toEqual([['orden', subida.idFoto]]);
  });

  it('quitar una propia borra su Archivo y su objeto de R2 (0.081a), sin tocar el modelo', async () => {
    const { idArte, fotos } = await crearArteModelo(modelo.id, 'Logo pecho', ['a.jpg']);
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const idRenglon = await renglonDe(idOrden, idArte);
    const { servicio, eliminados } = archivosFalsos();

    const subida = await solicitarSubidaFotoArteOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      idRenglon,
      { nombreOriginal: 'propia.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
      bd(),
      servicio,
    );
    await quitarFotoArteOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      idRenglon,
      subida.idFoto,
      bd(),
      servicio,
    );

    expect(await cliente.ordenArteFoto.count()).toBe(0);
    expect(await cliente.archivo.findUnique({ where: { id: subida.idArchivo } })).toBeNull();
    expect(eliminados).toEqual([`orden-arte/${String(idRenglon)}/propia.jpg`]);
    // Y la foto del ARTE DEL MODELO ni se enteró.
    expect(await cliente.modeloArteFoto.count({ where: { idModeloArte: idArte } })).toBe(1);
    expect(
      await cliente.archivo.findUnique({ where: { id: fotos[0]?.idArchivo as string } }),
    ).not.toBeNull();
  });

  it('🔴 el id de una foto HEREDADA no sirve para quitar: 404 y el modelo intacto', async () => {
    const { idArte, fotos } = await crearArteModelo(modelo.id, 'Logo pecho', ['a.jpg']);
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const idRenglon = await renglonDe(idOrden, idArte);
    const { servicio, eliminados } = archivosFalsos();

    await expect(
      quitarFotoArteOrden(
        sesion([...PERM_TODOS]),
        idOrden,
        idRenglon,
        fotos[0]?.idFoto as number,
        bd(),
        servicio,
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    expect(eliminados).toEqual([]);
    expect(await cliente.modeloArteFoto.count()).toBe(1);
  });

  it('la lectura ordena: heredadas primero (orden del modelo), propias después', async () => {
    const { idArte } = await crearArteModelo(modelo.id, 'Logo pecho', ['a.jpg', 'b.jpg']);
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const idRenglon = await renglonDe(idOrden, idArte);
    const { servicio } = archivosFalsos();

    await solicitarSubidaFotoArteOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      idRenglon,
      { nombreOriginal: 'p1.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
      bd(),
      servicio,
    );
    await solicitarSubidaFotoArteOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      idRenglon,
      { nombreOriginal: 'p2.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
      bd(),
      servicio,
    );

    const [arte] = await listarFotosArteOrden(sesion([...PERM_TODOS]), idOrden, bd(), servicio);
    expect(arte?.fotos.map((f) => [f.origen, f.nombreOriginal, f.principal])).toEqual([
      ['modelo', 'a.jpg', true],
      ['modelo', 'b.jpg', false],
      ['orden', 'p1.jpg', false],
      ['orden', 'p2.jpg', false],
    ]);
  });
});

describe('⭐ Lo que hace inviable CONGELAR: el Archivo compartido entre artes', () => {
  it('⭐⭐ apagar una foto NO toca un Archivo que OTRO arte del modelo comparte', async () => {
    // «Copiar arte de otro modelo» crea filas nuevas de `ModeloArteFoto` que apuntan al MISMO
    // `Archivo` (el objeto de R2 no se clona desde SQL). Ésa es la razón por la que congelar las
    // fotos en la orden sería peligroso: borrar una del modelo se llevaría las copias congeladas.
    // Aquí se comprueba que la marca no participa de ese juego: no toca archivos, punto.
    const { idArte, fotos } = await crearArteModelo(modelo.id, 'Logo pecho', ['compartida.jpg']);
    const compartida = fotos[0] as { idFoto: number; idArchivo: string };
    const gemelo = await cliente.modeloArte.create({
      data: { idModelo: modelo.id, descripcion: 'Logo pecho (copia)', idTipoArte },
    });
    await cliente.modeloArteFoto.create({
      data: { idModeloArte: gemelo.id, idArchivo: compartida.idArchivo, orden: 0 },
    });

    const idOrden = await crearOrdenDePrueba(empresa.id);
    const idRenglon = await renglonDe(idOrden, idArte);
    await ocultarFotoArteEnOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      idRenglon,
      { idModeloArteFoto: compartida.idFoto },
      bd(),
    );

    // Las DOS filas de foto siguen vivas y el archivo compartido también.
    expect(await cliente.modeloArteFoto.count({ where: { idArchivo: compartida.idArchivo } })).toBe(
      2,
    );
    expect(
      await cliente.archivo.findUnique({ where: { id: compartida.idArchivo } }),
    ).not.toBeNull();
  });
});

describe('Fotos del arte de la OP — los Cascade', () => {
  it('⭐ apagar una foto NO secuestra el catálogo: borrarla del arte se lleva la marca', async () => {
    const { idArte, fotos } = await crearArteModelo(modelo.id, 'Logo pecho', ['a.jpg']);
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const idRenglon = await renglonDe(idOrden, idArte);
    const foto = fotos[0] as { idFoto: number; idArchivo: string };

    await ocultarFotoArteEnOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      idRenglon,
      { idModeloArteFoto: foto.idFoto },
      bd(),
    );

    // El dueño del modelo borra su foto. Con un RESTRICT —el default de la casa para catálogos en
    // uso— esto reventaría, y una OP cualquiera habría inmovilizado la galería del arte.
    await expect(cliente.archivo.delete({ where: { id: foto.idArchivo } })).resolves.toBeDefined();
    expect(await cliente.modeloArteFoto.count({ where: { id: foto.idFoto } })).toBe(0);
    expect(await cliente.ordenArteFotoOculta.count()).toBe(0);
  });

  it('borrar la orden se lleva sus marcas y sus fotos propias; el arte del modelo sigue', async () => {
    const { idArte, fotos } = await crearArteModelo(modelo.id, 'Logo pecho', ['a.jpg']);
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const idRenglon = await renglonDe(idOrden, idArte);
    const { servicio } = archivosFalsos();

    await ocultarFotoArteEnOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      idRenglon,
      { idModeloArteFoto: fotos[0]?.idFoto as number },
      bd(),
    );
    await solicitarSubidaFotoArteOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      idRenglon,
      { nombreOriginal: 'propia.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
      bd(),
      servicio,
    );

    await cliente.orden.delete({ where: { id: idOrden } });

    expect(await cliente.ordenArteFotoOculta.count()).toBe(0);
    expect(await cliente.ordenArteFoto.count()).toBe(0);
    // Nunca fue suya para llevársela.
    expect(await cliente.modeloArteFoto.count({ where: { idModeloArte: idArte } })).toBe(1);
  });

  it('la LLAVE ÚNICA de `idArchivo` impide que dos renglones compartan una foto propia', async () => {
    const { idArte } = await crearArteModelo(modelo.id, 'Logo pecho', ['a.jpg']);
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const idRenglon = await renglonDe(idOrden, idArte);
    const otroRenglon = await cliente.ordenArte.create({
      data: { idOrden, idModeloArte: null, descripcion: 'A mano', idTipoArte, agregadoAMano: true },
    });
    const { servicio } = archivosFalsos();

    const subida = await solicitarSubidaFotoArteOrden(
      sesion([...PERM_TODOS]),
      idOrden,
      idRenglon,
      { nombreOriginal: 'propia.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
      bd(),
      servicio,
    );

    // Es lo que permite borrar el objeto de R2 sin contar huérfanos: nadie más lo puede referenciar.
    await expect(
      cliente.ordenArteFoto.create({
        data: { idOrdenArte: otroRenglon.id, idArchivo: subida.idArchivo, orden: 0 },
      }),
    ).rejects.toThrow();
  });
});

describe('Lo que ve el IMPRESO', () => {
  it('un renglón EXCLUIDO no llega al papel (pero sí a la pantalla)', async () => {
    const { idArte } = await crearArteModelo(modelo.id, 'Logo pecho', ['a.jpg']);
    const idOrden = await crearOrdenDePrueba(empresa.id);
    const idRenglon = await renglonDe(idOrden, idArte);
    await cliente.ordenArte.update({ where: { id: idRenglon }, data: { excluido: true } });

    expect(await leerArteOrdenParaImpreso(cliente, idOrden)).toEqual([]);
    expect(await listar([...PERM_TODOS], idOrden)).toHaveLength(1);
  });

  it('una OP sin decisiones devuelve las dos listas vacías (REGLA 0-B)', async () => {
    const { idArte } = await crearArteModelo(modelo.id, 'Logo pecho', ['a.jpg']);
    const idOrden = await crearOrdenDePrueba(empresa.id);

    expect(await leerArteOrdenParaImpreso(cliente, idOrden)).toEqual([
      {
        idOrdenArte: await renglonDe(idOrden, idArte),
        idModeloArte: idArte,
        descripcion: 'Logo pecho',
        ocultas: [],
        propias: [],
      },
    ]);
  });
});
