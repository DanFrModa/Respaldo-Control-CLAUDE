/**
 * Tests de INTEGRACIÓN del ARTE del modelo (V1-E3d §Post-F9.35 + V1-E3f §Post-F9.52/.58) contra
 * Postgres efímero (corren en CI — NUNCA Docker local, regla §7 de `CLAUDE.md`).
 *
 * Cubren lo que el arte estrenó y NADIE más ejercita, que es justo lo delicado: **las FOTOS
 * COMPARTIDAS por varios artes**. Al sacar el arte del catálogo, la migración duplicó los artes
 * usados por varios modelos apuntando al MISMO `Archivo` (la key de R2 es única), y «copiar arte de
 * otro modelo» hace lo mismo. De ahí salen las reglas que se prueban aquí:
 *
 *  1. `borrarArchivoSiQuedoHuerfano`: quitar la foto de UN arte NO puede dejar sin imagen a los
 *     demás que la comparten, y cuando ya no queda ninguno, la fila `Archivo` sí se va.
 *  2. D3 — nada se borra en silencio: `eliminarArte` y «copiar receta con reemplazo» dejan en la
 *     bitácora TODO lo que decía el renglón (precio, proveedor y fotos incluidos). Al no haber
 *     catálogo, ese rastro es lo ÚNICO que queda de un arte borrado.
 *  3. Copiar un arte de otro modelo trae sus datos y sus fotos.
 *
 * Y lo NUEVO de V1-E3f:
 *  4. Las fotos son PLURALES: subir una segunda AGREGA (no reemplaza) y se quitan una por una.
 *  5. El TIPO sale del catálogo único y el servidor rechaza uno que no esté marcado `esArte`.
 *  6. **Dos artes con la misma descripción en un modelo son LEGALES** (el `nombre` único se
 *     retiró a propósito, §Post-F9.52 punto 1 — Daniel lo sabe).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ServicioArchivos } from '../../comun/archivos.js';
import { ErrorNoEncontrado, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ClavePermiso } from '../../contrato/index.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearTipoArtePrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import {
  copiarArteDeOtroModelo,
  crearArte,
  eliminarArte,
  galeriaArte,
  listarArtesModelo,
  listarFotosArte,
  quitarFotoArte,
  solicitarSubidaFotoArte,
  actualizarArte,
} from './arte-modelo.js';
import { copiarBom } from './bom-modelo.js';

let cliente: PrismaClient;

const PERMISOS: ClavePermiso[] = ['modelos.ver', 'modelos.administrar'];
const sesion = () => sesionDePrueba({ permisos: PERMISOS });
const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

/** Id del tipo de arte «bordado» del catálogo único (V1-E3f): el arte no se puede crear sin él. */
let idTipoArte: number;
/** Un segundo tipo, para probar el cambio de tipo y el filtro de la galería. */
let idTipoEstampado: number;

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  idTipoArte = await crearTipoArtePrueba(cliente);
  idTipoEstampado = await crearTipoArtePrueba(cliente, 'estampado', { nombre: 'Estampado' });
});

/**
 * Fake del servicio de archivos: NO toca R2, pero SÍ crea el registro `Archivo` en la transacción
 * (igual que el real) para que la FK `idArchivoFoto` tenga a qué apuntar.
 */
function archivosFalsos(): ServicioArchivos {
  return {
    async solicitarSubida(tx, sesionSubida, solicitud) {
      const carpeta = solicitud.carpeta ?? 'general';
      const archivo = await tx.archivo.create({
        data: {
          bucket: 'control-v2-prueba',
          key: `${carpeta}/fake/${String(Date.now())}-${solicitud.nombreOriginal}`,
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
      return { archivo, urlSubida: `https://r2.fake/put/${archivo.key}`, expiraEnSegundos: 900 };
    },
    subirContenido() {
      throw new Error('Este flujo usa solicitarSubida (presigned), no subirContenido.');
    },
    urlDescarga(key) {
      return Promise.resolve(`https://r2.fake/get/${key}`);
    },
    descargarContenido(key) {
      return Promise.resolve(Buffer.from(`contenido-falso:${key}`, 'utf8'));
    },
    eliminarObjeto() {
      return Promise.resolve();
    },
  };
}

/** Crea un modelo suelto (el arte solo necesita eso). */
async function crearModelo(codigo: string): Promise<number> {
  const modelo = await cliente.modelo.create({ data: { codigo } });
  return modelo.id;
}

/** Sube (fake) una foto de un arte y devuelve el renglón creado (id de foto + id del `Archivo`). */
async function subirFoto(
  idModelo: number,
  idArte: number,
  nombreOriginal = 'arte.png',
): Promise<{ idFoto: number; idArchivo: string }> {
  const subida = await solicitarSubidaFotoArte(
    sesion(),
    idModelo,
    idArte,
    { nombreOriginal, tipoMime: 'image/png', tamanoBytes: 10 },
    bd(),
    archivosFalsos(),
  );
  return { idFoto: subida.idFoto, idArchivo: subida.idArchivo };
}

/** Los `idArchivo` de las fotos de un arte, en su orden. */
async function archivosDelArte(idArte: number): Promise<string[]> {
  const filas = await cliente.modeloArteFoto.findMany({
    where: { idModeloArte: idArte },
    orderBy: [{ orden: 'asc' }, { id: 'asc' }],
    select: { idArchivo: true },
  });
  return filas.map((f) => f.idArchivo);
}

describe('fotos COMPARTIDAS por varios artes (borrarArchivoSiQuedoHuerfano)', () => {
  it('quitar la foto de un arte NO se lleva la del otro que la comparte; el último sí borra el Archivo', async () => {
    const idModeloA = await crearModelo('MOD-A');
    const idModeloB = await crearModelo('MOD-B');
    const arteA = await crearArte(
      sesion(),
      idModeloA,
      { descripcion: 'Logo', idTipoArte, precio: 45 },
      bd(),
    );
    const foto = await subirFoto(idModeloA, arteA.id);

    // La copia COMPARTE el mismo Archivo (el objeto de R2 no se duplica).
    const copia = await copiarArteDeOtroModelo(
      sesion(),
      idModeloB,
      { idArteOrigen: arteA.id },
      bd(),
    );
    expect(copia.fotos.map((f) => f.idArchivo)).toEqual([foto.idArchivo]);

    // Quitar la foto de A: el Archivo SIGUE porque B lo usa, y B conserva su foto.
    await quitarFotoArte(sesion(), idModeloA, arteA.id, foto.idFoto, bd());
    expect(await cliente.archivo.count({ where: { id: foto.idArchivo } })).toBe(1);
    expect(await archivosDelArte(copia.id)).toEqual([foto.idArchivo]);

    // Quitar la de B: ya no queda nadie → la fila `Archivo` sí se borra.
    const suya = copia.fotos[0];
    expect(suya).toBeDefined();
    await quitarFotoArte(sesion(), idModeloB, copia.id, suya?.idFoto ?? 0, bd());
    expect(await cliente.archivo.count({ where: { id: foto.idArchivo } })).toBe(0);
  });

  it('eliminar un arte con foto compartida deja intacta la foto del otro', async () => {
    const idModeloA = await crearModelo('MOD-A');
    const idModeloB = await crearModelo('MOD-B');
    const arteA = await crearArte(sesion(), idModeloA, { descripcion: 'Logo', idTipoArte }, bd());
    const foto = await subirFoto(idModeloA, arteA.id);
    const copia = await copiarArteDeOtroModelo(
      sesion(),
      idModeloB,
      { idArteOrigen: arteA.id },
      bd(),
    );

    await eliminarArte(sesion(), idModeloA, arteA.id, bd());

    expect(await cliente.archivo.count({ where: { id: foto.idArchivo } })).toBe(1);
    expect(await archivosDelArte(copia.id)).toEqual([foto.idArchivo]);

    // Y al irse el ÚLTIMO arte que la usaba, la fila `Archivo` se va con él.
    await eliminarArte(sesion(), idModeloB, copia.id, bd());
    expect(await cliente.archivo.count({ where: { id: foto.idArchivo } })).toBe(0);
  });

  it('V1-E3f: subir una segunda foto la AGREGA (ya no reemplaza) y cada una se quita aparte', async () => {
    const idModelo = await crearModelo('MOD-PLURAL');
    const arte = await crearArte(sesion(), idModelo, { descripcion: 'Logo', idTipoArte }, bd());

    const primera = await subirFoto(idModelo, arte.id, 'frente.png');
    const segunda = await subirFoto(idModelo, arte.id, 'espalda.png');

    expect(primera.idArchivo).not.toBe(segunda.idArchivo);
    expect(await archivosDelArte(arte.id)).toEqual([primera.idArchivo, segunda.idArchivo]);
    // Las DOS filas `Archivo` siguen vivas: subir la segunda no borró la primera.
    expect(
      await cliente.archivo.count({
        where: { id: { in: [primera.idArchivo, segunda.idArchivo] } },
      }),
    ).toBe(2);

    const conUrl = await listarFotosArte(sesion(), idModelo, arte.id, bd(), archivosFalsos());
    expect(conUrl.map((f) => f.nombreOriginal)).toEqual(['frente.png', 'espalda.png']);
    expect(conUrl.every((f) => f.urlDescarga.startsWith('https://r2.fake/get/'))).toBe(true);

    // Quitar UNA deja la otra (y borra solo su Archivo, que nadie más comparte).
    await quitarFotoArte(sesion(), idModelo, arte.id, primera.idFoto, bd());
    expect(await archivosDelArte(arte.id)).toEqual([segunda.idArchivo]);
    expect(await cliente.archivo.count({ where: { id: primera.idArchivo } })).toBe(0);
    expect(await cliente.archivo.count({ where: { id: segunda.idArchivo } })).toBe(1);
  });

  it('quitar una foto que NO es de ese arte (o de ese modelo) → ErrorNoEncontrado (A9)', async () => {
    const idModeloA = await crearModelo('MOD-A');
    const idModeloB = await crearModelo('MOD-B');
    const arteA = await crearArte(sesion(), idModeloA, { descripcion: 'A', idTipoArte }, bd());
    const arteB = await crearArte(sesion(), idModeloB, { descripcion: 'B', idTipoArte }, bd());
    const fotoA = await subirFoto(idModeloA, arteA.id);

    // La foto existe, pero no es del arte B…
    await expect(
      quitarFotoArte(sesion(), idModeloB, arteB.id, fotoA.idFoto, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    // …ni el arte A es del modelo B.
    await expect(
      quitarFotoArte(sesion(), idModeloB, arteA.id, fotoA.idFoto, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    // Nada se borró.
    expect(await cliente.archivo.count({ where: { id: fotoA.idArchivo } })).toBe(1);
  });
});

describe('D3 — el arte borrado deja rastro COMPLETO (ya no hay catálogo del que recuperarlo)', () => {
  it('eliminarArte registra descripción, posición, tipo, precio, proveedor, puntadas, orden y fotos', async () => {
    const idModelo = await crearModelo('MOD-D3');
    const proveedor = await cliente.proveedor.create({ data: { nombre: 'Bordados SA' } });
    const arte = await crearArte(
      sesion(),
      idModelo,
      {
        descripcion: 'Escudo',
        posicion: 'frente',
        puntadas: 12000,
        precio: 45.5,
        idTipoArte: idTipoEstampado,
        idProveedor: proveedor.id,
      },
      bd(),
    );
    const foto = await subirFoto(idModelo, arte.id);

    await eliminarArte(sesion(), idModelo, arte.id, bd());

    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'ModeloArte', idEntidad: String(arte.id), accion: 'MODIFICAR' },
      orderBy: { id: 'desc' },
    });
    expect(bitacora.datos).toMatchObject({
      operacion: 'quitar',
      idModelo,
      descripcion: 'Escudo',
      posicion: 'frente',
      idTipoArte: idTipoEstampado,
      puntadas: 12000,
      precio: 45.5,
      idProveedor: proveedor.id,
      fotos: [foto.idArchivo],
      orden: 0,
    });
  });

  /**
   * Escenario del reemplazo: el destino tiene UN arte completo (precio, proveedor y foto propia)
   * y se le copia encima la receta de otro modelo. El arte del destino desaparece de verdad.
   */
  async function reemplazarRecetaDelDestino(): Promise<{
    idDestino: number;
    idArteVictima: number;
    idProveedor: number;
    idArchivo: string;
  }> {
    const idOrigen = await crearModelo('MOD-ORIGEN');
    const idDestino = await crearModelo('MOD-DESTINO');
    await crearArte(
      sesion(),
      idOrigen,
      { descripcion: 'Del origen', idTipoArte, precio: 10 },
      bd(),
    );

    const proveedor = await cliente.proveedor.create({ data: { nombre: 'Bordados SA' } });
    const victima = await crearArte(
      sesion(),
      idDestino,
      {
        descripcion: 'Del destino',
        idTipoArte,
        precio: 60,
        puntadas: 900,
        idProveedor: proveedor.id,
      },
      bd(),
    );
    const foto = await subirFoto(idDestino, victima.id);

    await copiarBom(sesion(), idDestino, { idOrigen, reemplazar: true }, bd());

    // El arte del destino se fue y quedó el del origen.
    const artes = await listarArtesModelo(sesion(), idDestino, bd());
    expect(artes.map((a) => a.descripcion)).toEqual(['Del origen']);

    return {
      idDestino,
      idArteVictima: victima.id,
      idProveedor: proveedor.id,
      idArchivo: foto.idArchivo,
    };
  }

  it('«copiar receta con reemplazo» registra ÍNTEGRO el arte que barre', async () => {
    const { idDestino, idArteVictima, idProveedor, idArchivo } = await reemplazarRecetaDelDestino();

    // NO se fue en silencio: el renglón completo quedó en la bitácora del modelo.
    const bitacoras = await cliente.bitacora.findMany({
      where: { entidad: 'Modelo', idEntidad: String(idDestino), accion: 'MODIFICAR' },
    });
    const rastro = bitacoras
      .map((b) => b.datos as { operacion?: string; artesQueSeFueron?: unknown[] } | null)
      .find((d) => d?.operacion === 'arte-reemplazado');
    expect(rastro?.artesQueSeFueron).toHaveLength(1);
    expect(rastro?.artesQueSeFueron?.[0]).toMatchObject({
      id: idArteVictima,
      descripcion: 'Del destino',
      precio: 60,
      puntadas: 900,
      idProveedor,
      fotos: [idArchivo],
    });
  });

  it('«copiar receta con reemplazo» limpia la foto que quedó sin dueño', async () => {
    const { idArchivo } = await reemplazarRecetaDelDestino();

    // Nadie más usaba esa foto: la fila `Archivo` no queda huérfana.
    expect(await cliente.archivo.count({ where: { id: idArchivo } })).toBe(0);
  });

  it('la foto del destino SOBREVIVE al reemplazo si el origen la comparte', async () => {
    const idOrigen = await crearModelo('MOD-ORIGEN');
    const idDestino = await crearModelo('MOD-DESTINO');
    const arteOrigen = await crearArte(
      sesion(),
      idOrigen,
      { descripcion: 'Compartido', idTipoArte },
      bd(),
    );
    const foto = await subirFoto(idOrigen, arteOrigen.id);
    // El destino tiene una COPIA de ese arte (misma foto), con otra descripción.
    await copiarArteDeOtroModelo(
      sesion(),
      idDestino,
      { idArteOrigen: arteOrigen.id, descripcion: 'Copia vieja' },
      bd(),
    );

    await copiarBom(sesion(), idDestino, { idOrigen, reemplazar: true }, bd());

    // El `Archivo` sigue: lo usa el arte del origen (y el recién copiado al destino).
    expect(await cliente.archivo.count({ where: { id: foto.idArchivo } })).toBe(1);
    const artes = await listarArtesModelo(sesion(), idDestino, bd());
    expect(artes).toHaveLength(1);
    expect(artes[0]?.fotos.map((f) => f.idArchivo)).toEqual([foto.idArchivo]);
  });
});

describe('copiar arte de otro modelo', () => {
  it('trae los datos y las FOTOS del origen', async () => {
    const idModeloA = await crearModelo('MOD-A');
    const idModeloB = await crearModelo('MOD-B');
    const proveedor = await cliente.proveedor.create({ data: { nombre: 'Bordados SA' } });
    const origen = await crearArte(
      sesion(),
      idModeloA,
      {
        descripcion: 'Escudo',
        posicion: 'manga izquierda',
        puntadas: 500,
        precio: 33.25,
        idTipoArte: idTipoEstampado,
        idProveedor: proveedor.id,
      },
      bd(),
    );
    const a = await subirFoto(idModeloA, origen.id, 'a.png');
    const b = await subirFoto(idModeloA, origen.id, 'b.png');

    const copia = await copiarArteDeOtroModelo(
      sesion(),
      idModeloB,
      { idArteOrigen: origen.id },
      bd(),
    );
    expect(copia).toMatchObject({
      idModelo: idModeloB,
      descripcion: 'Escudo',
      posicion: 'manga izquierda',
      puntadas: 500,
      precio: 33.25,
      idTipoArte: idTipoEstampado,
      codigoTipoArte: 'estampado',
      idProveedor: proveedor.id,
    });
    // Las DOS fotos viajan, en orden, compartiendo los mismos `Archivo`.
    expect(copia.fotos.map((f) => f.idArchivo)).toEqual([a.idArchivo, b.idArchivo]);

    // V1-E3f: repetir la misma descripción en el mismo modelo YA NO choca (el nombre único se
    // retiró a propósito, §Post-F9.52 punto 1). Antes esto era un 409.
    const segunda = await copiarArteDeOtroModelo(
      sesion(),
      idModeloB,
      { idArteOrigen: origen.id },
      bd(),
    );
    expect(segunda.descripcion).toBe('Escudo');
    expect(await listarArtesModelo(sesion(), idModeloB, bd())).toHaveLength(2);
  });

  it('copiar un arte del MISMO modelo se rechaza, y sin permiso no se puede', async () => {
    const idModelo = await crearModelo('MOD-A');
    const arte = await crearArte(sesion(), idModelo, { descripcion: 'Logo', idTipoArte }, bd());

    await expect(
      copiarArteDeOtroModelo(sesion(), idModelo, { idArteOrigen: arte.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    const soloVer = sesionDePrueba({ permisos: ['modelos.ver'] });
    await expect(
      copiarArteDeOtroModelo(soloVer, idModelo, { idArteOrigen: arte.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('el TIPO sale del catálogo ÚNICO (V1-E3f, §Post-F9.58)', () => {
  it('rechaza un tipo de proceso que NO está marcado como arte (p. ej. costura)', async () => {
    const idModelo = await crearModelo('MOD-TIPO');
    const costura = await cliente.tipoProceso.create({
      data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true, esArte: false },
      select: { id: true },
    });

    await expect(
      crearArte(sesion(), idModelo, { descripcion: 'X', idTipoArte: costura.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    await expect(
      crearArte(sesion(), idModelo, { descripcion: 'X', idTipoArte: 99_999 }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza un tipo DESACTIVADO, y editar a un tipo inválido tampoco pasa', async () => {
    const idModelo = await crearModelo('MOD-TIPO2');
    const apagado = await cliente.tipoProceso.create({
      data: { codigo: 'embosado', nombre: 'Embosado', esArte: true, activo: false },
      select: { id: true },
    });

    await expect(
      crearArte(sesion(), idModelo, { descripcion: 'X', idTipoArte: apagado.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    const arte = await crearArte(sesion(), idModelo, { descripcion: 'Ok', idTipoArte }, bd());
    await expect(
      actualizarArte(sesion(), idModelo, { id: arte.id, idTipoArte: apagado.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // El arte NO se movió.
    const [vigente] = await listarArtesModelo(sesion(), idModelo, bd());
    expect(vigente?.idTipoArte).toBe(idTipoArte);
  });

  it('el arte trae resuelto el nombre/código del tipo y su bandera de puntadas', async () => {
    const idModelo = await crearModelo('MOD-TIPO3');
    const bordado = await crearArte(sesion(), idModelo, { descripcion: 'B', idTipoArte }, bd());
    expect(bordado).toMatchObject({
      tipoArte: 'Bordado',
      codigoTipoArte: 'bordado',
      usaPuntadas: true,
    });

    const estampado = await crearArte(
      sesion(),
      idModelo,
      { descripcion: 'E', idTipoArte: idTipoEstampado },
      bd(),
    );
    expect(estampado).toMatchObject({
      tipoArte: 'Estampado',
      codigoTipoArte: 'estampado',
      usaPuntadas: false,
    });
  });
});

describe('galería y edición', () => {
  it('la galería dice de qué modelo es cada arte y busca por clave del modelo', async () => {
    const idModeloA = await crearModelo('MOD-A');
    const idModeloB = await crearModelo('MOD-B');
    await crearArte(sesion(), idModeloA, { descripcion: 'Uno', idTipoArte }, bd());
    await crearArte(sesion(), idModeloB, { descripcion: 'Dos', idTipoArte }, bd());

    const todas = await galeriaArte(sesion(), {}, bd());
    expect(todas.total).toBe(2);

    const soloB = await galeriaArte(sesion(), { busqueda: 'MOD-B' }, bd());
    expect(soloB.datos.map((d) => d.descripcion)).toEqual(['Dos']);
    expect(soloB.datos[0]?.claveModelo).toBe('MOD-B');
  });

  it('la galería filtra por TIPO y por "solo con foto", y trae la PRIMERA foto como miniatura', async () => {
    const idModelo = await crearModelo('MOD-GAL');
    const bordado = await crearArte(sesion(), idModelo, { descripcion: 'Bord', idTipoArte }, bd());
    await crearArte(sesion(), idModelo, { descripcion: 'Est', idTipoArte: idTipoEstampado }, bd());
    const primera = await subirFoto(idModelo, bordado.id, '1.png');
    await subirFoto(idModelo, bordado.id, '2.png');

    const porTipo = await galeriaArte(sesion(), { idTipoArte: idTipoEstampado }, bd());
    expect(porTipo.datos.map((d) => d.descripcion)).toEqual(['Est']);

    const conFoto = await galeriaArte(sesion(), { soloConFoto: true }, bd());
    expect(conFoto.total).toBe(1);
    expect(conFoto.datos[0]?.idArchivoFoto).toBe(primera.idArchivo);
  });

  it('editar el precio deja el de→a en la bitácora (A7)', async () => {
    const idModelo = await crearModelo('MOD-A');
    const arte = await crearArte(
      sesion(),
      idModelo,
      { descripcion: 'Logo', idTipoArte, precio: 10 },
      bd(),
    );

    const editado = await actualizarArte(sesion(), idModelo, { id: arte.id, precio: 12.5 }, bd());
    expect(editado.precio).toBe(12.5);

    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'ModeloArte', idEntidad: String(arte.id), accion: 'MODIFICAR' },
      orderBy: { id: 'desc' },
    });
    expect(bitacora.datos).toMatchObject({ precio: { de: 10, a: 12.5 } });
  });

  it('la POSICIÓN es texto libre: se guarda, se cambia y se vacía con null (M1)', async () => {
    const idModelo = await crearModelo('MOD-POS');
    const arte = await crearArte(
      sesion(),
      idModelo,
      { descripcion: 'Logo', idTipoArte, posicion: 'frente' },
      bd(),
    );
    expect(arte.posicion).toBe('frente');

    const movido = await actualizarArte(
      sesion(),
      idModelo,
      { id: arte.id, posicion: 'manga derecha, arriba del codo' },
      bd(),
    );
    expect(movido.posicion).toBe('manga derecha, arriba del codo');

    const vaciado = await actualizarArte(sesion(), idModelo, { id: arte.id, posicion: null }, bd());
    expect(vaciado.posicion).toBeNull();
  });

  it('V1-E3f: dos artes con la MISMA descripción en un modelo son legales (ya no hay unique)', async () => {
    const idModelo = await crearModelo('MOD-DUP');
    await crearArte(sesion(), idModelo, { descripcion: 'Logo', idTipoArte }, bd());
    await crearArte(sesion(), idModelo, { descripcion: 'Logo', idTipoArte }, bd());

    const artes = await listarArtesModelo(sesion(), idModelo, bd());
    expect(artes.map((a) => a.descripcion)).toEqual(['Logo', 'Logo']);
    // Y se distinguen por su id: el orden es determinista (orden, luego id).
    expect(artes[0]?.id).toBeLessThan(artes[1]?.id ?? 0);
  });
});
