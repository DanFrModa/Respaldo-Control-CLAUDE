/**
 * Tests de INTEGRACIÓN del ARTE del modelo (V1-E3d, §Post-F9.35) contra Postgres efímero
 * (testcontainers; corren SOLO en CI — NUNCA Docker local, regla §7 de `CLAUDE.md`).
 *
 * Cubren lo que la pieza estrenó y NADIE más ejercita, que es justo lo delicado: **la FOTO
 * COMPARTIDA por varios artes**. Al sacar el arte del catálogo, la migración duplicó los artes
 * usados por varios modelos apuntando al MISMO `Archivo` (la key de R2 es única), y «copiar arte de
 * otro modelo» hace lo mismo. De ahí salen las tres reglas que se prueban aquí:
 *
 *  1. `borrarArchivoSiQuedoHuerfano`: quitar la foto de UN arte NO puede dejar sin imagen a los
 *     demás que la comparten, y cuando ya no queda ninguno, la fila `Archivo` sí se va.
 *  2. D3 — nada se borra en silencio: `eliminarArte` y «copiar receta con reemplazo» dejan en la
 *     bitácora TODO lo que decía el renglón (precio, proveedor y foto incluidos). Al no haber
 *     catálogo, ese rastro es lo ÚNICO que queda de un arte borrado.
 *  3. Copiar un arte de otro modelo trae sus datos y su foto, y respeta la unicidad por modelo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ServicioArchivos } from '../../comun/archivos.js';
import { ErrorConflicto, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ClavePermiso } from '../../contrato/index.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import {
  copiarArteDeOtroModelo,
  crearArte,
  eliminarArte,
  galeriaArte,
  listarArtesModelo,
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

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
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

/** Sube (fake) la foto de un arte y devuelve el id del `Archivo` que quedó ligado. */
async function subirFoto(idModelo: number, idArte: number): Promise<string> {
  const subida = await solicitarSubidaFotoArte(
    sesion(),
    idModelo,
    idArte,
    { nombreOriginal: 'arte.png', tipoMime: 'image/png', tamanoBytes: 10 },
    bd(),
    archivosFalsos(),
  );
  return subida.idArchivo;
}

describe('foto COMPARTIDA por varios artes (borrarArchivoSiQuedoHuerfano)', () => {
  it('quitar la foto de un arte NO se lleva la del otro que la comparte; el último sí borra el Archivo', async () => {
    const idModeloA = await crearModelo('MOD-A');
    const idModeloB = await crearModelo('MOD-B');
    const arteA = await crearArte(sesion(), idModeloA, { nombre: 'Logo', precio: 45 }, bd());
    const idArchivo = await subirFoto(idModeloA, arteA.id);

    // La copia COMPARTE el mismo Archivo (el objeto de R2 no se duplica).
    const copia = await copiarArteDeOtroModelo(
      sesion(),
      idModeloB,
      { idArteOrigen: arteA.id },
      bd(),
    );
    expect(copia.idArchivoFoto).toBe(idArchivo);

    // Quitar la foto de A: el Archivo SIGUE porque B lo usa, y B conserva su foto.
    await quitarFotoArte(sesion(), idModeloA, arteA.id, undefined, bd());
    expect(await cliente.archivo.count({ where: { id: idArchivo } })).toBe(1);
    const bTrasQuitarA = await cliente.modeloArte.findUniqueOrThrow({ where: { id: copia.id } });
    expect(bTrasQuitarA.idArchivoFoto).toBe(idArchivo);

    // Quitar la de B: ya no queda nadie → la fila `Archivo` sí se borra.
    await quitarFotoArte(sesion(), idModeloB, copia.id, undefined, bd());
    expect(await cliente.archivo.count({ where: { id: idArchivo } })).toBe(0);
  });

  it('eliminar un arte con foto compartida deja intacta la foto del otro', async () => {
    const idModeloA = await crearModelo('MOD-A');
    const idModeloB = await crearModelo('MOD-B');
    const arteA = await crearArte(sesion(), idModeloA, { nombre: 'Logo' }, bd());
    const idArchivo = await subirFoto(idModeloA, arteA.id);
    const copia = await copiarArteDeOtroModelo(
      sesion(),
      idModeloB,
      { idArteOrigen: arteA.id },
      bd(),
    );

    await eliminarArte(sesion(), idModeloA, arteA.id, bd());

    expect(await cliente.archivo.count({ where: { id: idArchivo } })).toBe(1);
    const restante = await cliente.modeloArte.findUniqueOrThrow({ where: { id: copia.id } });
    expect(restante.idArchivoFoto).toBe(idArchivo);

    // Y al irse el ÚLTIMO arte que la usaba, la fila `Archivo` se va con él.
    await eliminarArte(sesion(), idModeloB, copia.id, bd());
    expect(await cliente.archivo.count({ where: { id: idArchivo } })).toBe(0);
  });

  it('reemplazar la foto de un arte no borra el Archivo si otro arte lo comparte', async () => {
    const idModeloA = await crearModelo('MOD-A');
    const idModeloB = await crearModelo('MOD-B');
    const arteA = await crearArte(sesion(), idModeloA, { nombre: 'Logo' }, bd());
    const idArchivo = await subirFoto(idModeloA, arteA.id);
    await copiarArteDeOtroModelo(sesion(), idModeloB, { idArteOrigen: arteA.id }, bd());

    const idNuevo = await subirFoto(idModeloA, arteA.id); // reemplazo

    expect(idNuevo).not.toBe(idArchivo);
    expect(await cliente.archivo.count({ where: { id: idArchivo } })).toBe(1); // la usa B
  });
});

describe('D3 — el arte borrado deja rastro COMPLETO (ya no hay catálogo del que recuperarlo)', () => {
  it('eliminarArte registra nombre, tipo, precio, proveedor, puntadas, descripción, orden y foto', async () => {
    const idModelo = await crearModelo('MOD-D3');
    const proveedor = await cliente.proveedor.create({ data: { nombre: 'Bordados SA' } });
    const arte = await crearArte(
      sesion(),
      idModelo,
      {
        nombre: 'Escudo',
        descripcion: 'al frente',
        puntadas: 12000,
        precio: 45.5,
        tipo: 'ESTAMPADO',
        idProveedor: proveedor.id,
      },
      bd(),
    );
    const idArchivo = await subirFoto(idModelo, arte.id);

    await eliminarArte(sesion(), idModelo, arte.id, bd());

    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'ModeloArte', idEntidad: String(arte.id), accion: 'MODIFICAR' },
      orderBy: { id: 'desc' },
    });
    expect(bitacora.datos).toMatchObject({
      operacion: 'quitar',
      idModelo,
      nombre: 'Escudo',
      descripcion: 'al frente',
      tipo: 'ESTAMPADO',
      puntadas: 12000,
      precio: 45.5,
      idProveedor: proveedor.id,
      idArchivoFoto: idArchivo,
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
    await crearArte(sesion(), idOrigen, { nombre: 'Del origen', precio: 10 }, bd());

    const proveedor = await cliente.proveedor.create({ data: { nombre: 'Bordados SA' } });
    const victima = await crearArte(
      sesion(),
      idDestino,
      { nombre: 'Del destino', precio: 60, puntadas: 900, idProveedor: proveedor.id },
      bd(),
    );
    const idArchivo = await subirFoto(idDestino, victima.id);

    await copiarBom(sesion(), idDestino, { idOrigen, reemplazar: true }, bd());

    // El arte del destino se fue y quedó el del origen.
    const artes = await listarArtesModelo(sesion(), idDestino, bd());
    expect(artes.map((a) => a.nombre)).toEqual(['Del origen']);

    return { idDestino, idArteVictima: victima.id, idProveedor: proveedor.id, idArchivo };
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
      nombre: 'Del destino',
      precio: 60,
      puntadas: 900,
      idProveedor,
      idArchivoFoto: idArchivo,
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
    const arteOrigen = await crearArte(sesion(), idOrigen, { nombre: 'Compartido' }, bd());
    const idArchivo = await subirFoto(idOrigen, arteOrigen.id);
    // El destino tiene una COPIA de ese arte (misma foto), con otro nombre.
    await copiarArteDeOtroModelo(
      sesion(),
      idDestino,
      { idArteOrigen: arteOrigen.id, nombre: 'Copia vieja' },
      bd(),
    );

    await copiarBom(sesion(), idDestino, { idOrigen, reemplazar: true }, bd());

    // El `Archivo` sigue: lo usa el arte del origen (y el recién copiado al destino).
    expect(await cliente.archivo.count({ where: { id: idArchivo } })).toBe(1);
    const artes = await listarArtesModelo(sesion(), idDestino, bd());
    expect(artes).toHaveLength(1);
    expect(artes[0]?.idArchivoFoto).toBe(idArchivo);
  });
});

describe('copiar arte de otro modelo', () => {
  it('trae los datos del origen y respeta la unicidad dentro del modelo', async () => {
    const idModeloA = await crearModelo('MOD-A');
    const idModeloB = await crearModelo('MOD-B');
    const proveedor = await cliente.proveedor.create({ data: { nombre: 'Bordados SA' } });
    const origen = await crearArte(
      sesion(),
      idModeloA,
      {
        nombre: 'Escudo',
        descripcion: 'al frente',
        puntadas: 500,
        precio: 33.25,
        tipo: 'ESTAMPADO',
        idProveedor: proveedor.id,
      },
      bd(),
    );

    const copia = await copiarArteDeOtroModelo(
      sesion(),
      idModeloB,
      { idArteOrigen: origen.id },
      bd(),
    );
    expect(copia).toMatchObject({
      idModelo: idModeloB,
      nombre: 'Escudo',
      descripcion: 'al frente',
      puntadas: 500,
      precio: 33.25,
      tipo: 'ESTAMPADO',
      idProveedor: proveedor.id,
    });

    // Repetir el mismo nombre en el mismo modelo → 409 (no se inventa sufijo).
    await expect(
      copiarArteDeOtroModelo(sesion(), idModeloB, { idArteOrigen: origen.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Con nombre distinto sí entra.
    const segunda = await copiarArteDeOtroModelo(
      sesion(),
      idModeloB,
      { idArteOrigen: origen.id, nombre: 'Escudo chico' },
      bd(),
    );
    expect(segunda.nombre).toBe('Escudo chico');
  });

  it('copiar un arte del MISMO modelo se rechaza, y sin permiso no se puede', async () => {
    const idModelo = await crearModelo('MOD-A');
    const arte = await crearArte(sesion(), idModelo, { nombre: 'Logo' }, bd());

    await expect(
      copiarArteDeOtroModelo(sesion(), idModelo, { idArteOrigen: arte.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    const soloVer = sesionDePrueba({ permisos: ['modelos.ver'] });
    await expect(
      copiarArteDeOtroModelo(soloVer, idModelo, { idArteOrigen: arte.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('galería y edición', () => {
  it('la galería dice de qué modelo es cada arte y busca por clave del modelo', async () => {
    const idModeloA = await crearModelo('MOD-A');
    const idModeloB = await crearModelo('MOD-B');
    await crearArte(sesion(), idModeloA, { nombre: 'Uno' }, bd());
    await crearArte(sesion(), idModeloB, { nombre: 'Dos' }, bd());

    const todas = await galeriaArte(sesion(), {}, bd());
    expect(todas.total).toBe(2);

    const soloB = await galeriaArte(sesion(), { busqueda: 'MOD-B' }, bd());
    expect(soloB.datos.map((d) => d.nombre)).toEqual(['Dos']);
    expect(soloB.datos[0]?.claveModelo).toBe('MOD-B');
  });

  it('editar el precio deja el de→a en la bitácora (A7)', async () => {
    const idModelo = await crearModelo('MOD-A');
    const arte = await crearArte(sesion(), idModelo, { nombre: 'Logo', precio: 10 }, bd());

    const editado = await actualizarArte(sesion(), idModelo, { id: arte.id, precio: 12.5 }, bd());
    expect(editado.precio).toBe(12.5);

    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'ModeloArte', idEntidad: String(arte.id), accion: 'MODIFICAR' },
      orderBy: { id: 'desc' },
    });
    expect(bitacora.datos).toMatchObject({ precio: { de: 10, a: 12.5 } });
  });
});
