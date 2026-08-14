import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import type { ServicioArchivos } from '../../comun/archivos.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarBordado,
  confirmarFotoBordado,
  crearBordado,
  desactivarBordado,
  listarBordados,
  obtenerBordado,
  quitarFoto,
  reactivarBordado,
  solicitarSubidaFoto,
  urlFoto,
} from './bordados.js';

let cliente: PrismaClient;

const sesionAdmin = () => sesionDePrueba({ permisos: ['bordados.ver', 'bordados.administrar'] });
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
 * Fake del servicio de archivos: NO toca R2, pero SÍ crea el registro `Archivo` en la
 * transacción (igual que el real) para que la FK `idArchivoFoto` tenga a qué apuntar.
 * La key respeta la carpeta que le pasa el dominio (`bordados/<id>/...`), de modo que
 * el test puede verificar que se ordenó por id. Las URLs son ficticias.
 */
function archivosFalsos(): ServicioArchivos {
  return {
    async solicitarSubida(tx, sesion, solicitud) {
      const carpeta = solicitud.carpeta ?? 'general';
      const key = `${carpeta}/fake/${solicitud.nombreOriginal}`;
      const archivo = await tx.archivo.create({
        data: {
          bucket: 'control-v2-prueba',
          key,
          nombreOriginal: solicitud.nombreOriginal,
          tipoMime: solicitud.tipoMime,
          tamanoBytes: solicitud.tamanoBytes,
          subidoPorId: sesion.id,
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
      // El fake no guarda bytes: solo cumple el contrato del servicio (nadie lo usa aquí).
      return Promise.resolve(Buffer.from(`contenido-falso:${key}`, 'utf8'));
    },
    eliminarObjeto() {
      return Promise.resolve();
    },
  };
}

describe('Catálogo Bordados/estampados (F1-E3, R2 — global ADR-0007)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba();
      await expect(
        crearBordado(sinPermisos, { nombre: 'X', tipo: 'BORDADO' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarBordados(sinPermisos, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['bordados.ver'] });
      await expect(crearBordado(soloVer, { nombre: 'X' }, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      await expect(listarBordados(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear', () => {
    it('crea con tipo/puntadas/precio, auditoría y bitácora (A7)', async () => {
      const sesion = sesionAdmin();
      const bordado = await crearBordado(
        sesion,
        {
          nombre: 'Logo Marilyn',
          tipo: 'ESTAMPADO',
          descripcion: 'Logo bordado al frente',
          puntadas: 12000,
          precio: 45.5,
        },
        bd(),
      );

      expect(bordado).toMatchObject({
        nombre: 'Logo Marilyn',
        tipo: 'ESTAMPADO',
        descripcion: 'Logo bordado al frente',
        puntadas: 12000,
        activo: true,
        idArchivoFoto: null,
        creadoPorId: sesion.id,
      });
      expect(Number(bordado.precio)).toBe(45.5);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Bordado', idEntidad: String(bordado.id), accion: 'CREAR' },
      });
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    it('por defecto el tipo es BORDADO', async () => {
      const bordado = await crearBordado(sesionAdmin(), { nombre: 'Sencillo' }, bd());
      expect(bordado.tipo).toBe('BORDADO');
    });

    it('rechaza nombre duplicado, sin importar mayúsculas → ErrorConflicto', async () => {
      await crearBordado(sesionAdmin(), { nombre: 'Escudo' }, bd());
      await expect(crearBordado(sesionAdmin(), { nombre: 'escudo' }, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });
  });

  describe('actualizar', () => {
    it('cambia campos con bitácora del detalle (precio Decimal por valor)', async () => {
      const sesion = sesionAdmin();
      const bordado = await crearBordado(
        sesion,
        { nombre: 'Bordado', puntadas: 1000, precio: 10 },
        bd(),
      );

      const actualizado = await actualizarBordado(
        sesion,
        { id: bordado.id, tipo: 'ESTAMPADO', puntadas: 2500, precio: 20 },
        bd(),
      );
      expect(actualizado).toMatchObject({ tipo: 'ESTAMPADO', puntadas: 2500 });
      expect(Number(actualizado.precio)).toBe(20);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Bordado', idEntidad: String(bordado.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({ precio: { de: 10, a: 20 } });
    });

    // M1: en edición, mandar `null` en un campo opcional ya capturado lo BORRA.
    it('vaciar un campo opcional (null) lo BORRA; omitirlo no lo toca', async () => {
      const sesion = sesionAdmin();
      const bordado = await crearBordado(
        sesion,
        { nombre: 'Con datos', descripcion: 'algo', puntadas: 500, precio: 5 },
        bd(),
      );

      const actualizado = await actualizarBordado(
        sesion,
        { id: bordado.id, descripcion: null, precio: null },
        bd(),
      );
      expect(actualizado.descripcion).toBeNull();
      expect(actualizado.precio).toBeNull();
      // puntadas NO se tocó (se omitió).
      expect(actualizado.puntadas).toBe(500);
    });

    it('un texto opcional que llega vacío ("") se normaliza a null', async () => {
      const sesion = sesionAdmin();
      const bordado = await crearBordado(sesion, { nombre: 'Prov', descripcion: 'x' }, bd());
      const actualizado = await actualizarBordado(
        sesion,
        { id: bordado.id, descripcion: '' },
        bd(),
      );
      expect(actualizado.descripcion).toBeNull();
    });

    it('sin cambio real es idempotente: no escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const bordado = await crearBordado(sesion, { nombre: 'Prov', tipo: 'BORDADO' }, bd());
      const antes = await cliente.bitacora.count();
      await actualizarBordado(sesion, { id: bordado.id, nombre: 'Prov', tipo: 'BORDADO' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(
        actualizarBordado(sesionAdmin(), { id: 9999, nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('desactivar / reactivar (borrado suave, PLANMAESTRO §4)', () => {
    it('desactiva con bitácora DESACTIVAR; el registro sigue existiendo', async () => {
      const sesion = sesionAdmin();
      const bordado = await crearBordado(sesion, { nombre: 'B' }, bd());
      const desactivado = await desactivarBordado(sesion, bordado.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.bordado.count()).toBe(1);
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Bordado', idEntidad: String(bordado.id), accion: 'DESACTIVAR' },
      });
    });

    it('desactivar dos veces → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const bordado = await crearBordado(sesion, { nombre: 'B' }, bd());
      await desactivarBordado(sesion, bordado.id, bd());
      await expect(desactivarBordado(sesion, bordado.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });

    it('reactivar un bordado desactivado funciona', async () => {
      const sesion = sesionAdmin();
      const bordado = await crearBordado(sesion, { nombre: 'B' }, bd());
      await desactivarBordado(sesion, bordado.id, bd());
      const reactivado = await reactivarBordado(sesion, bordado.id, bd());
      expect(reactivado.activo).toBe(true);
    });

    it('no deja crear un nombre que choca con uno desactivado', async () => {
      const sesion = sesionAdmin();
      const bordado = await crearBordado(sesion, { nombre: 'Único' }, bd());
      await desactivarBordado(sesion, bordado.id, bd());
      await expect(crearBordado(sesion, { nombre: 'único' }, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });
  });

  describe('listar (búsqueda + filtro por tipo + paginación, modo servidor)', () => {
    it('filtra por tipo y por búsqueda; excluye inactivos por defecto', async () => {
      const sesion = sesionAdmin();
      await crearBordado(sesion, { nombre: 'Bordado Aguila', tipo: 'BORDADO' }, bd());
      await crearBordado(sesion, { nombre: 'Estampado Sol', tipo: 'ESTAMPADO' }, bd());
      const inactivo = await crearBordado(sesion, { nombre: 'Viejo', tipo: 'BORDADO' }, bd());
      await desactivarBordado(sesion, inactivo.id, bd());

      expect((await listarBordados(sesion, { tipo: 'BORDADO' }, bd())).total).toBe(1);
      expect((await listarBordados(sesion, { tipo: 'ESTAMPADO' }, bd())).total).toBe(1);
      expect((await listarBordados(sesion, { busqueda: 'sol' }, bd())).total).toBe(1);
      // Inactivos: ocultos por defecto, visibles con incluirInactivos.
      expect((await listarBordados(sesion, {}, bd())).total).toBe(2);
      expect((await listarBordados(sesion, { incluirInactivos: true }, bd())).total).toBe(3);
    });

    it('pagina en servidor (porPagina/totalPaginas)', async () => {
      const sesion = sesionAdmin();
      for (let i = 0; i < 5; i += 1) {
        await crearBordado(sesion, { nombre: `Bordado ${i}` }, bd());
      }
      const pagina = await listarBordados(sesion, { pagina: 1, porPagina: 2 }, bd());
      expect(pagina.datos).toHaveLength(2);
      expect(pagina.total).toBe(5);
      expect(pagina.totalPaginas).toBe(3);
    });
  });

  describe('obtener', () => {
    it('devuelve el bordado por id', async () => {
      const sesion = sesionAdmin();
      const bordado = await crearBordado(sesion, { nombre: 'B' }, bd());
      const obtenido = await obtenerBordado(sesion, bordado.id, bd());
      expect(obtenido.id).toBe(bordado.id);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(obtenerBordado(sesionAdmin(), 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });
  });

  describe('foto en R2 (con servicio de archivos FALSO inyectado)', () => {
    it('sube la foto en una transacción: crea Archivo, liga idArchivoFoto y bitácora', async () => {
      const sesion = sesionAdmin();
      const archivos = archivosFalsos();
      const bordado = await crearBordado(sesion, { nombre: 'Sin foto' }, bd());

      const subida = await solicitarSubidaFoto(
        sesion,
        bordado.id,
        { nombreOriginal: 'logo.jpg', tipoMime: 'image/jpeg', tamanoBytes: 4096 },
        bd(),
        archivos,
      );

      expect(subida.idArchivo).toBeTruthy();
      expect(subida.urlSubida).toContain('r2.fake');

      // Archivo creado y ligado al bordado.
      expect(await cliente.archivo.count()).toBe(1);
      const recargado = await obtenerBordado(sesion, bordado.id, bd());
      expect(recargado.idArchivoFoto).toBe(subida.idArchivo);

      // La key se ordena por id del bordado (carpeta bordados/<id>), NO por nombre (A5).
      const archivo = await cliente.archivo.findFirstOrThrow();
      expect(archivo.key.startsWith(`bordados/${bordado.id}/`)).toBe(true);
      expect(archivo.key).not.toContain('sin foto');
    });

    it('reemplaza la foto: borra el Archivo anterior y deja solo el nuevo', async () => {
      const sesion = sesionAdmin();
      const archivos = archivosFalsos();
      const bordado = await crearBordado(sesion, { nombre: 'Con foto' }, bd());

      const primera = await solicitarSubidaFoto(
        sesion,
        bordado.id,
        { nombreOriginal: 'vieja.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
        bd(),
        archivos,
      );
      const segunda = await solicitarSubidaFoto(
        sesion,
        bordado.id,
        { nombreOriginal: 'nueva.png', tipoMime: 'image/png', tamanoBytes: 20 },
        bd(),
        archivos,
      );

      // Solo queda el Archivo nuevo (el viejo se borró en la misma transacción).
      expect(await cliente.archivo.count()).toBe(1);
      expect(await cliente.archivo.findUnique({ where: { id: primera.idArchivo } })).toBeNull();
      const recargado = await obtenerBordado(sesion, bordado.id, bd());
      expect(recargado.idArchivoFoto).toBe(segunda.idArchivo);
    });

    it('urlFoto devuelve la URL de descarga cuando hay foto, y vacío cuando no', async () => {
      const sesion = sesionAdmin();
      const archivos = archivosFalsos();
      const bordado = await crearBordado(sesion, { nombre: 'B' }, bd());

      // Sin foto: todo null.
      const sinFoto = await urlFoto(sesion, bordado.id, bd(), archivos);
      expect(sinFoto).toMatchObject({ idArchivo: null, urlDescarga: null });

      // Con foto: trae la URL GET prefirmada.
      await solicitarSubidaFoto(
        sesion,
        bordado.id,
        { nombreOriginal: 'logo.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
        bd(),
        archivos,
      );
      const conFoto = await urlFoto(sesion, bordado.id, bd(), archivos);
      expect(conFoto.urlDescarga).toContain('r2.fake/get');
      expect(conFoto.nombreOriginal).toBe('logo.jpg');
    });

    it('quitar la foto borra el Archivo y deja idArchivoFoto en null (transacción A2)', async () => {
      const sesion = sesionAdmin();
      const archivos = archivosFalsos();
      const bordado = await crearBordado(sesion, { nombre: 'B' }, bd());
      await solicitarSubidaFoto(
        sesion,
        bordado.id,
        { nombreOriginal: 'logo.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
        bd(),
        archivos,
      );

      await quitarFoto(sesion, bordado.id, undefined, bd());
      expect(await cliente.archivo.count()).toBe(0);
      const recargado = await obtenerBordado(sesion, bordado.id, bd());
      expect(recargado.idArchivoFoto).toBeNull();
    });

    it('quitar la foto cuando no hay → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const bordado = await crearBordado(sesion, { nombre: 'B' }, bd());
      await expect(quitarFoto(sesion, bordado.id, undefined, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });

    it('acotado al idArchivo: si la foto vigente ya es OTRA, NO borra nada (ErrorConflicto)', async () => {
      // El caso real: el PUT a R2 del primer intento falla tarde; entre medias alguien subió una
      // foto BUENA al mismo arte. La limpieza del intento fallido NO debe llevarse esa foto.
      const sesion = sesionAdmin();
      const archivos = archivosFalsos();
      const bordado = await crearBordado(sesion, { nombre: 'B' }, bd());
      const primera = await solicitarSubidaFoto(
        sesion,
        bordado.id,
        { nombreOriginal: 'vieja.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
        bd(),
        archivos,
      );
      const segunda = await solicitarSubidaFoto(
        sesion,
        bordado.id,
        { nombreOriginal: 'buena.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
        bd(),
        archivos,
      );

      await expect(quitarFoto(sesion, bordado.id, primera.idArchivo, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );

      const recargado = await obtenerBordado(sesion, bordado.id, bd());
      expect(recargado.idArchivoFoto).toBe(segunda.idArchivo);
      expect(await cliente.archivo.count()).toBe(1);
    });

    it('acotado al idArchivo: si la foto vigente ES esa, la quita', async () => {
      const sesion = sesionAdmin();
      const archivos = archivosFalsos();
      const bordado = await crearBordado(sesion, { nombre: 'B' }, bd());
      const subida = await solicitarSubidaFoto(
        sesion,
        bordado.id,
        { nombreOriginal: 'logo.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
        bd(),
        archivos,
      );

      await quitarFoto(sesion, bordado.id, subida.idArchivo, bd());

      const recargado = await obtenerBordado(sesion, bordado.id, bd());
      expect(recargado.idArchivoFoto).toBeNull();
      expect(await cliente.archivo.count()).toBe(0);
    });

    it('solicitar subida para un bordado inexistente → ErrorNoEncontrado', async () => {
      await expect(
        solicitarSubidaFoto(
          sesionAdmin(),
          999999,
          { nombreOriginal: 'x.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
          bd(),
          archivosFalsos(),
        ),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });

    it('confirmarFotoBordado es idempotente cuando la foto ya está ligada', async () => {
      const sesion = sesionAdmin();
      const archivos = archivosFalsos();
      const bordado = await crearBordado(sesion, { nombre: 'B' }, bd());
      const subida = await solicitarSubidaFoto(
        sesion,
        bordado.id,
        { nombreOriginal: 'logo.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
        bd(),
        archivos,
      );

      // Ya está ligada por la solicitud: confirmar no cambia nada ni borra el Archivo.
      const confirmado = await confirmarFotoBordado(sesion, bordado.id, subida.idArchivo, bd());
      expect(confirmado.idArchivoFoto).toBe(subida.idArchivo);
      expect(await cliente.archivo.count()).toBe(1);
    });

    it('quitar foto borra solo el Archivo de la foto, no el bordado', async () => {
      const sesion = sesionAdmin();
      const archivos = archivosFalsos();
      const bordado = await crearBordado(sesion, { nombre: 'B' }, bd());
      await solicitarSubidaFoto(
        sesion,
        bordado.id,
        { nombreOriginal: 'logo.jpg', tipoMime: 'image/jpeg', tamanoBytes: 10 },
        bd(),
        archivos,
      );
      await quitarFoto(sesion, bordado.id, undefined, bd());
      expect(await cliente.bordado.count()).toBe(1);
    });
  });
});
