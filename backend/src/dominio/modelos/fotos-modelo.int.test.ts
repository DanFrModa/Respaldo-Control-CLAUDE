/**
 * ⭐⭐ V1-E3 (§Post-F9.172(b)) — **LAS FOTOS DE UN MODELO NACIDO POR COLOR**, contra Postgres real.
 *
 * La regla pura vive en `fotos-modelo.test.ts` (`idModeloDeLasFotos`). Aquí se demuestra que la
 * aplican de verdad **los DOS caminos** por los que las fotos llegan a una pantalla, que son
 * consultas distintas y podrían divergir sin que nadie se entere:
 *
 *  1. `leerFotosModelo` — la FICHA del modelo y el **papel de la OP** (`impreso-orden.ts`).
 *  2. `listarModelos` → `adjuntarFotoPrincipal` — la **galería y el listado**, en lote y sin N+1.
 *
 * 🔴 Por qué importa que sea el listado: el filtro por default del catálogo es `origen = produccion`
 * (+ activo), así que **lo que se ve son exactamente los hijos por color** — y el padre que tiene
 * las fotos queda escondido. Sin esta regla los cuatro salían sin miniatura.
 */
// Credenciales R2 FALSAS: el servicio de archivos se construye de forma DIFERIDA (parámetro por
// defecto), así que para cuando se llama ya están puestas. Las URLs prefirmadas no salen a la red.
process.env.R2_ACCOUNT_ID ??= 'cuenta-fake';
process.env.R2_ACCESS_KEY_ID ??= 'llave-fake';
process.env.R2_SECRET_ACCESS_KEY ??= 'secreto-fake';
process.env.R2_BUCKET ??= 'control-v2-prueba';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { PrismaClient } from '../../datos/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { leerFotosModelo } from './fotos-modelo.js';
import { listarModelos } from './modelos.js';

let cliente: PrismaClient;
let idEmpresa: number;

const PERMISOS: ClavePermiso[] = ['modelos.ver'];
const sesion = (): SesionUsuario =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: [...PERMISOS] });
const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});
afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  const empresa = await crearEmpresaPrueba(cliente);
  idEmpresa = empresa.id;
});

/** Cuelga una foto (con su `Archivo`) del modelo dado y devuelve la key en R2. */
async function colgarFoto(idModelo: number, key: string): Promise<string> {
  const archivo = await cliente.archivo.create({
    data: {
      key,
      bucket: process.env.R2_BUCKET ?? 'control-v2-prueba',
      nombreOriginal: `${key}.jpg`,
      tipoMime: 'image/jpeg',
      tamanoBytes: 10,
    },
  });
  await cliente.modeloFoto.create({ data: { idModelo, idArchivo: archivo.id, orden: 0 } });
  return key;
}

/** Un desarrollo con su foto + un hijo de producción por color, SIN fotos propias. */
async function sembrarPadreEHijo(): Promise<{ idPadre: number; idHijo: number }> {
  const padre = await cliente.modelo.create({
    data: { codigo: 'CYA-26-71-001', origen: 'desarrollo', codigoDesarrollo: 'CYA-26-71-001' },
  });
  await colgarFoto(padre.id, 'fotos/padre');
  const color = await cliente.color.create({ data: { nombre: 'Rojo' } });
  const hijo = await cliente.modelo.create({
    data: {
      codigo: '71001',
      origen: 'produccion',
      numeroProduccion: 71_001,
      idModeloDesarrollo: padre.id,
      idColor: color.id,
    },
  });
  return { idPadre: padre.id, idHijo: hijo.id };
}

describe('leerFotosModelo — la ficha y el papel de la OP (V1-E3)', () => {
  it('⭐⭐ un HIJO por color SIN fotos propias enseña las del DESARROLLO', async () => {
    const { idHijo } = await sembrarPadreEHijo();

    const fotos = await leerFotosModelo(idHijo, bd());

    expect(fotos).toHaveLength(1);
    expect(fotos[0]?.nombreOriginal).toBe('fotos/padre.jpg');
  });

  it('⭐⭐ un HIJO CON foto propia enseña LA SUYA (la escritura no se la traga el sistema)', async () => {
    const { idHijo } = await sembrarPadreEHijo();
    await colgarFoto(idHijo, 'fotos/hijo-rojo');

    const fotos = await leerFotosModelo(idHijo, bd());

    // Sólo la suya: no se mezclan las dos (la propia GANA, no se suma a la del padre).
    expect(fotos).toHaveLength(1);
    expect(fotos[0]?.nombreOriginal).toBe('fotos/hijo-rojo.jpg');
  });

  it('un modelo SIN linaje y sin fotos sigue devolviendo lista vacía (conducta intacta)', async () => {
    const suelto = await cliente.modelo.create({ data: { codigo: 'M-18', origen: 'produccion' } });
    expect(await leerFotosModelo(suelto.id, bd())).toEqual([]);
  });

  it('un desarrollo PADRE sin fotos no hereda nada de nadie (no hay cadenas)', async () => {
    const padre = await cliente.modelo.create({
      data: { codigo: 'CYA-26-71-009', origen: 'desarrollo', codigoDesarrollo: 'CYA-26-71-009' },
    });
    const hijo = await cliente.modelo.create({
      data: { codigo: '71009', origen: 'produccion', idModeloDesarrollo: padre.id },
    });
    expect(await leerFotosModelo(hijo.id, bd())).toEqual([]);
  });
});

describe('listarModelos — la GALERÍA en lote (V1-E3)', () => {
  it('⭐⭐ el hijo por color trae la MINIATURA de su desarrollo, y el padre la suya', async () => {
    const { idPadre, idHijo } = await sembrarPadreEHijo();

    const pagina = await listarModelos(sesion(), { porPagina: 50 }, bd());
    const hijo = pagina.datos.find((m) => m.id === idHijo);
    const padre = pagina.datos.find((m) => m.id === idPadre);

    // 🔴 La aserción de la regresión: sin la regla, esto era `null` — y es lo ÚNICO que se ve, porque
    // el filtro por default del catálogo esconde al padre que tiene la foto.
    expect(hijo?.urlFotoPrincipal).not.toBeNull();
    expect(padre?.urlFotoPrincipal).not.toBeNull();
  });

  it('⭐ y si el hijo tiene foto propia, la miniatura es LA SUYA (no la del padre)', async () => {
    const { idHijo } = await sembrarPadreEHijo();
    await colgarFoto(idHijo, 'fotos/hijo-rojo');

    const pagina = await listarModelos(sesion(), { porPagina: 50 }, bd());
    const hijo = pagina.datos.find((m) => m.id === idHijo);

    expect(hijo?.urlFotoPrincipal).toContain('fotos/hijo-rojo');
  });

  it('un modelo sin fotos y sin padre sigue saliendo con miniatura nula', async () => {
    await cliente.modelo.create({ data: { codigo: 'M-18', origen: 'produccion' } });
    const pagina = await listarModelos(sesion(), { porPagina: 50 }, bd());
    expect(pagina.datos.find((m) => m.codigo === 'M-18')?.urlFotoPrincipal).toBeNull();
  });
});
