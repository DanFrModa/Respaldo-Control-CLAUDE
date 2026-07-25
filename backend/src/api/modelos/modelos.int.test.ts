/**
 * Pruebas de integración de las rutas de Modelos (Módulo 2, F1-E4): el API REST de punta a
 * punta, incluido el BOM (telas/avíos/bordados), copiar BOM y el flujo de fotos con el motor
 * de archivos de F0.
 *
 * Levantan una app Fastify con SOLO el plugin de modelos montado bajo `/api`, apuntada al
 * Postgres efímero de testcontainers, con la autenticación real (better-auth) y el seed real
 * (admin `Control.2026!`, 9 roles, FR Moda, géneros sembrados). Se ejercita con `app.inject`
 * (sin abrir puerto). Las telas/avíos/bordados del BOM se crean directo en BD (este test no
 * monta sus rutas; el dominio de modelos solo necesita que existan). Cubren:
 *  - deny-by-default: rol `Basico` (sin permisos) → 403; sin sesión → 401;
 *  - alta y aparición en el listado (modo servidor: búsqueda + filtro temporada) + código dup 409;
 *  - PATCH parcial (FK + vaciar con null) + descontinuar/reactivar + filtro incluirInactivos;
 *  - selector de géneros (sembrados);
 *  - BOM: set de telas/avíos (consumo + 3 banderas persistidas), bordados (precio), sin duplicados;
 *  - copiar BOM (atómico, reemplazar y fusionar);
 *  - fotos: POST presigned (key por id), GET listar, PATCH metadatos, DELETE quitar.
 *
 * Las URLs prefirmadas se firman LOCALMENTE (no se toca R2): credenciales R2 FALSAS antes de
 * construir la app. NO se sube nada a R2 (eso es el PUT del navegador, fuera del backend).
 */
// Credenciales R2 FALSAS, fijadas ANTES de importar el dominio (servicioArchivos lazy).
process.env.R2_ACCOUNT_ID ??= 'cuenta-fake';
process.env.R2_ACCESS_KEY_ID ??= 'llave-fake';
process.env.R2_SECRET_ACCESS_KEY ??= 'secreto-fake';
process.env.R2_BUCKET ??= 'control-v2-prueba';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { hashPassword } from 'better-auth/crypto';

import { registrarManejadorErrores } from '../errores.js';
import { rutasModelos } from './modelos.rutas.js';
import { registrarAuth } from '../../auth/plugin.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrar } from '../../../prisma/seed.js';

/** Crea un usuario con el rol `Basico` (sembrado, SIN permisos de modelos) y su credencial. */
async function crearUsuarioBasico(username: string, password: string): Promise<void> {
  const rol = await cliente.rol.findUniqueOrThrow({ where: { nombre: 'Basico' } });
  const usuario = await cliente.usuario.create({
    data: {
      username,
      nombre: 'Usuario Básico',
      email: `${username}@control.local`,
      emailVerified: true,
      roles: { create: { idRol: rol.id } },
    },
  });
  await cliente.cuenta.create({
    data: {
      providerId: 'credential',
      accountId: usuario.id,
      userId: usuario.id,
      password: await hashPassword(password),
    },
  });
}

let cliente: PrismaClient;
let app: FastifyInstance;

const PASSWORD_ADMIN = 'Control.2026!';

interface ResultadoLogin {
  status: number;
  cookies: string[];
}

async function login(username: string, password: string): Promise<ResultadoLogin> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    payload: { username, password },
  });
  const set = res.headers['set-cookie'];
  const cookies = set === undefined ? [] : Array.isArray(set) ? set : [set];
  return { status: res.statusCode, cookies };
}

function comoHeaderCookie(cookies: string[]): string {
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function cookieAdmin(): Promise<string> {
  const sesion = await login('admin', PASSWORD_ADMIN);
  expect(sesion.status).toBe(200);
  return comoHeaderCookie(sesion.cookies);
}

async function construirAppModelos(): Promise<FastifyInstance> {
  const instancia = Fastify({ logger: false });
  instancia.setValidatorCompiler(validatorCompiler);
  instancia.setSerializerCompiler(serializerCompiler);
  registrarManejadorErrores(instancia);
  registrarAuth(instancia, {});
  await instancia.register(rutasModelos, { prefix: '/api' });
  await instancia.ready();
  return instancia;
}

beforeAll(async () => {
  cliente = clientePruebas();
  app = await construirAppModelos();
});

afterAll(async () => {
  await app.close();
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await sembrar(cliente);
});

/** Forma mínima de un modelo de la API que usan estas pruebas. */
interface ModeloApi {
  id: number;
  codigo: string;
  descripcion: string | null;
  maquilaBase: number | null;
  idTemporada: number | null;
  idGenero: number | null;
  cantidadFotos: number;
  activo: boolean;
}

/** Crea un modelo vía API con la cookie dada; devuelve el cuerpo parseado. */
async function crearModeloApi(
  cookie: string,
  cuerpo: Record<string, unknown>,
): Promise<{ status: number; body: ModeloApi }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/modelos',
    headers: { cookie },
    payload: cuerpo,
  });
  return { status: res.statusCode, body: res.json<ModeloApi>() };
}

/** Crea una tela en BD (este test no monta las rutas de telas) y devuelve su id. */
async function crearTela(nombre: string): Promise<number> {
  const tela = await cliente.tela.create({ data: { nombre } });
  return tela.id;
}

/** Crea un avío en BD y devuelve su id. */
async function crearAvio(clave: string): Promise<number> {
  const avio = await cliente.avio.create({ data: { clave, descripcion: `Avío ${clave}` } });
  return avio.id;
}

/** Crea un bordado en BD (con precio de catálogo) y devuelve su id. */
async function crearBordado(nombre: string, precio: number): Promise<number> {
  const bordado = await cliente.bordado.create({ data: { nombre, precio } });
  return bordado.id;
}

describe('API de modelos (F1-E4)', () => {
  describe('autorización (deny-by-default)', () => {
    it('un usuario con rol Basico (sin permisos) recibe 403', async () => {
      await crearUsuarioBasico('consulta', 'Clave.1234!');
      const sesion = await login('consulta', 'Clave.1234!');
      expect(sesion.status).toBe(200);
      const cookie = comoHeaderCookie(sesion.cookies);

      const lectura = await app.inject({ method: 'GET', url: '/api/modelos', headers: { cookie } });
      expect(lectura.statusCode).toBe(403);
      const escritura = await app.inject({
        method: 'POST',
        url: '/api/modelos',
        headers: { cookie },
        payload: { codigo: 'X' },
      });
      expect(escritura.statusCode).toBe(403);
    });

    it('sin sesión, las rutas responden 401', async () => {
      for (const url of [
        '/api/modelos',
        '/api/modelos/1',
        '/api/generos',
        '/api/modelos/1/bom/telas',
      ]) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode).toBe(401);
      }
    });
  });

  describe('selector de géneros', () => {
    it('lista los 8 géneros sembrados', async () => {
      const cookie = await cookieAdmin();
      const res = await app.inject({ method: 'GET', url: '/api/generos', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const generos = res.json<{ nombre: string }[]>();
      expect(generos.length).toBe(8);
      expect(generos.map((g) => g.nombre)).toContain('Caballero');
      expect(generos.map((g) => g.nombre)).toContain('Beba');
    });
  });

  describe('CRUD', () => {
    it('crea un modelo y aparece en el listado; código duplicado → 409', async () => {
      const cookie = await cookieAdmin();
      const { status, body } = await crearModeloApi(cookie, {
        codigo: '501',
        descripcion: 'Sudadera',
        maquilaBase: 35,
      });
      expect(status).toBe(201);
      expect(body).toMatchObject({ codigo: '501', descripcion: 'Sudadera', maquilaBase: 35 });
      expect(body.cantidadFotos).toBe(0);

      const lista = await app.inject({
        method: 'GET',
        url: '/api/modelos?busqueda=sudadera',
        headers: { cookie },
      });
      expect(lista.statusCode).toBe(200);
      const pagina = lista.json<{ datos: { codigo: string }[]; total: number }>();
      expect(pagina.total).toBe(1);
      expect(pagina.datos[0]?.codigo).toBe('501');

      // Código duplicado (insensible a mayúsculas) → 409.
      const dup = await crearModeloApi(cookie, { codigo: '501' });
      expect(dup.status).toBe(409);
    });

    it('PATCH parcial cambia descripción y vacía maquila con null; descontinúa y reactiva', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'M1', maquilaBase: 20 });

      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/modelos/${body.id}`,
        headers: { cookie },
        payload: { descripcion: 'Playera', maquilaBase: null },
      });
      expect(patch.statusCode).toBe(200);
      const actualizado = patch.json<ModeloApi>();
      expect(actualizado.descripcion).toBe('Playera');
      expect(actualizado.maquilaBase).toBeNull();

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/modelos/${body.id}`,
        headers: { cookie },
      });
      expect(del.statusCode).toBe(200);
      expect(del.json<ModeloApi>().activo).toBe(false);

      const ocultos = await app.inject({ method: 'GET', url: '/api/modelos', headers: { cookie } });
      expect(ocultos.json<{ total: number }>().total).toBe(0);
      const todos = await app.inject({
        method: 'GET',
        url: '/api/modelos?incluirInactivos=true',
        headers: { cookie },
      });
      expect(todos.json<{ total: number }>().total).toBe(1);

      const re = await app.inject({
        method: 'PATCH',
        url: `/api/modelos/${body.id}`,
        headers: { cookie },
        payload: { activo: true },
      });
      expect(re.json<ModeloApi>().activo).toBe(true);
    });

    it('rechaza asignar una temporada desactivada (400)', async () => {
      const cookie = await cookieAdmin();
      const temporada = await cliente.temporada.create({ data: { nombre: 'V25', activo: false } });
      const res = await crearModeloApi(cookie, { codigo: 'M2', idTemporada: temporada.id });
      expect(res.status).toBe(400);
    });

    it('maquilero cotizado (R5/B9): acepta un proveedor de costura, rechaza uno sin ese rol', async () => {
      const cookie = await cookieAdmin();
      const rolCostura = await cliente.rolProveedor.findUniqueOrThrow({
        where: { codigo: 'maquila-costura' },
        select: { id: true },
      });
      const maquilero = await cliente.proveedor.create({
        data: {
          nombre: 'Costuras del Norte',
          roles: { create: [{ idRolProveedor: rolCostura.id }] },
        },
      });
      const noMaquilero = await cliente.proveedor.create({
        data: { nombre: 'Telas SA (sin rol)' },
      });

      // Con un maquilero de costura → 201 y queda amarrado.
      const ok = await crearModeloApi(cookie, {
        codigo: 'MAQ-OK',
        idMaquileroCotizado: maquilero.id,
      });
      expect(ok.status).toBe(201);

      // Con un proveedor SIN el rol de costura → 400 (la autoridad es el servidor, A1).
      const mal = await crearModeloApi(cookie, {
        codigo: 'MAQ-MAL',
        idMaquileroCotizado: noMaquilero.id,
      });
      expect(mal.status).toBe(400);
    });
  });

  describe('BOM (telas/avíos/bordados)', () => {
    it('reemplaza el set de telas con consumo + 3 banderas; las persiste y rechaza duplicados', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'BOM1' });
      const idTela = await crearTela('Felpa');

      // PUT con banderas MIXTAS (costear sin producir — doc 01-Modelos §2).
      const put = await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/telas`,
        headers: { cookie },
        payload: {
          telas: [
            {
              idTela,
              consumoPorPrenda: 1.5,
              paraPreCosto: true,
              paraProduccion: false,
              paraCosto: true,
            },
          ],
        },
      });
      expect(put.statusCode).toBe(200);
      const datos = put.json<{
        datos: {
          idTela: number;
          consumoPorPrenda: number;
          paraProduccion: boolean;
          paraCosto: boolean;
        }[];
      }>();
      expect(datos.datos).toHaveLength(1);
      expect(datos.datos[0]).toMatchObject({
        idTela,
        consumoPorPrenda: 1.5,
        paraProduccion: false,
        paraCosto: true,
      });

      // Aparece en la ficha.
      const ficha = await app.inject({
        method: 'GET',
        url: `/api/modelos/${body.id}`,
        headers: { cookie },
      });
      expect(ficha.json<{ telas: unknown[] }>().telas).toHaveLength(1);

      // Duplicados rechazados (400).
      const dup = await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/telas`,
        headers: { cookie },
        payload: {
          telas: [
            { idTela, consumoPorPrenda: 1 },
            { idTela, consumoPorPrenda: 2 },
          ],
        },
      });
      expect(dup.statusCode).toBe(400);

      // Vaciar el set.
      const vacio = await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/telas`,
        headers: { cookie },
        payload: { telas: [] },
      });
      expect(vacio.json<{ datos: unknown[] }>().datos).toHaveLength(0);
    });

    it('reemplaza avíos y bordados (con precio por renglón)', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'BOM2' });
      const idAvio = await crearAvio('BTN-01');
      const idBordado = await crearBordado('Logo', 30);

      const avios = await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/avios`,
        headers: { cookie },
        payload: { avios: [{ idAvio, consumoPorPrenda: 4, paraCosto: false }] },
      });
      expect(avios.statusCode).toBe(200);
      expect(avios.json<{ datos: { paraCosto: boolean }[] }>().datos[0]?.paraCosto).toBe(false);

      const bordados = await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/bordados`,
        headers: { cookie },
        payload: { bordados: [{ idBordado, precio: 45 }] },
      });
      expect(bordados.statusCode).toBe(200);
      expect(
        bordados.json<{ datos: { idBordado: number; precio: number }[] }>().datos[0],
      ).toMatchObject({ idBordado, precio: 45 });
    });

    it('rechaza meter al BOM una tela desactivada (400)', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'BOM3' });
      const tela = await cliente.tela.create({ data: { nombre: 'Vieja', activo: false } });
      const res = await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/telas`,
        headers: { cookie },
        payload: { telas: [{ idTela: tela.id, consumoPorPrenda: 1 }] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('copiar BOM (atómico)', () => {
    it('copia telas/avíos/bordados de otro modelo (reemplazar) y rechaza origen==destino', async () => {
      const cookie = await cookieAdmin();
      const origen = (await crearModeloApi(cookie, { codigo: 'ORIG' })).body;
      const destino = (await crearModeloApi(cookie, { codigo: 'DEST' })).body;
      const idTela = await crearTela('Jersey');
      const idAvio = await crearAvio('ETIQ-1');
      const idBordado = await crearBordado('Estampa', 12);

      // Carga el BOM del origen.
      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${origen.id}/bom/telas`,
        headers: { cookie },
        payload: { telas: [{ idTela, consumoPorPrenda: 2 }] },
      });
      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${origen.id}/bom/avios`,
        headers: { cookie },
        payload: { avios: [{ idAvio, consumoPorPrenda: 1 }] },
      });
      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${origen.id}/bom/bordados`,
        headers: { cookie },
        payload: { bordados: [{ idBordado, precio: 12 }] },
      });

      const copia = await app.inject({
        method: 'POST',
        url: `/api/modelos/${destino.id}/copiar-bom`,
        headers: { cookie },
        payload: { idOrigen: origen.id, reemplazar: true },
      });
      expect(copia.statusCode).toBe(200);
      const bom = copia.json<{ telas: unknown[]; avios: unknown[]; bordados: unknown[] }>();
      expect(bom.telas).toHaveLength(1);
      expect(bom.avios).toHaveLength(1);
      expect(bom.bordados).toHaveLength(1);

      // Origen == destino → 400.
      const mismo = await app.inject({
        method: 'POST',
        url: `/api/modelos/${destino.id}/copiar-bom`,
        headers: { cookie },
        payload: { idOrigen: destino.id },
      });
      expect(mismo.statusCode).toBe(400);
    });

    it('FUSIÓN (reemplazar:false): conserva lo del destino y añade lo del origen, sin pisar', async () => {
      const cookie = await cookieAdmin();
      const origen = (await crearModeloApi(cookie, { codigo: 'ORIG-F' })).body;
      const destino = (await crearModeloApi(cookie, { codigo: 'DEST-F' })).body;
      const telaComun = await crearTela('Comun');
      const telaSoloOrigen = await crearTela('SoloOrigen');
      const telaSoloDestino = await crearTela('SoloDestino');

      // Origen: tela común (consumo 9) + una tela propia.
      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${origen.id}/bom/telas`,
        headers: { cookie },
        payload: {
          telas: [
            { idTela: telaComun, consumoPorPrenda: 9 },
            { idTela: telaSoloOrigen, consumoPorPrenda: 3 },
          ],
        },
      });
      // Destino: tela común con OTRO consumo (5) + una tela propia.
      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${destino.id}/bom/telas`,
        headers: { cookie },
        payload: {
          telas: [
            { idTela: telaComun, consumoPorPrenda: 5 },
            { idTela: telaSoloDestino, consumoPorPrenda: 7 },
          ],
        },
      });

      // Fusión: NO reemplaza.
      const copia = await app.inject({
        method: 'POST',
        url: `/api/modelos/${destino.id}/copiar-bom`,
        headers: { cookie },
        payload: { idOrigen: origen.id, reemplazar: false },
      });
      expect(copia.statusCode).toBe(200);

      // El destino queda con las 3 telas: las 2 suyas + la nueva del origen.
      const ficha = await app.inject({
        method: 'GET',
        url: `/api/modelos/${destino.id}`,
        headers: { cookie },
      });
      const telas = ficha.json<{ telas: { idTela: number; consumoPorPrenda: number }[] }>().telas;
      expect(telas).toHaveLength(3);
      const porId = new Map(telas.map((t) => [t.idTela, t.consumoPorPrenda]));
      // La común CONSERVA el consumo del destino (5), NO se pisó con el del origen (9).
      expect(porId.get(telaComun)).toBe(5);
      // La propia del destino sigue (7) y se añadió la del origen (3).
      expect(porId.get(telaSoloDestino)).toBe(7);
      expect(porId.get(telaSoloOrigen)).toBe(3);
    });

    it('TODO O NADA: un copiar-bom que falla deja el BOM del destino intacto (rollback)', async () => {
      const cookie = await cookieAdmin();
      const destino = (await crearModeloApi(cookie, { codigo: 'DEST-RB' })).body;
      const idTela = await crearTela('Intacta');
      const idBordado = await crearBordado('IntactoBordado', 20);

      // El destino YA tiene un BOM (la ruta destructiva reemplazar:true borraría esto primero).
      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${destino.id}/bom/telas`,
        headers: { cookie },
        payload: { telas: [{ idTela, consumoPorPrenda: 2 }] },
      });
      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${destino.id}/bom/bordados`,
        headers: { cookie },
        payload: { bordados: [{ idBordado, precio: 20 }] },
      });

      // Copiar desde un origen INEXISTENTE (la operación falla dentro de la transacción A2).
      const idOrigenInexistente = 999_999;
      const copia = await app.inject({
        method: 'POST',
        url: `/api/modelos/${destino.id}/copiar-bom`,
        headers: { cookie },
        payload: { idOrigen: idOrigenInexistente, reemplazar: true },
      });
      expect(copia.statusCode).toBe(404);

      // Nada quedó a medias: el BOM original del destino sigue completo (no se borró ni cambió).
      const ficha = await app.inject({
        method: 'GET',
        url: `/api/modelos/${destino.id}`,
        headers: { cookie },
      });
      const bom = ficha.json<{
        telas: { idTela: number }[];
        bordados: { idBordado: number }[];
      }>();
      expect(bom.telas).toHaveLength(1);
      expect(bom.telas[0]?.idTela).toBe(idTela);
      expect(bom.bordados).toHaveLength(1);
      expect(bom.bordados[0]?.idBordado).toBe(idBordado);
    });
  });

  describe('fotos en R2 (URL prefirmada, sin tocar R2)', () => {
    it('POST prepara la subida (key por id), GET lista, PATCH ordena y DELETE quita', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'FOTO1' });

      const post = await app.inject({
        method: 'POST',
        url: `/api/modelos/${body.id}/fotos`,
        headers: { cookie },
        payload: {
          nombreOriginal: 'frente.jpg',
          tipoMime: 'image/jpeg',
          tamanoBytes: 4096,
          tipo: 'FRENTE',
        },
      });
      expect(post.statusCode).toBe(201);
      const subida = post.json<{ idFoto: number; idArchivo: string; urlSubida: string }>();
      expect(subida.idArchivo).toBeTruthy();
      const url = new URL(subida.urlSubida);
      expect(url.hostname).toContain('r2.cloudflarestorage.com');
      expect(url.pathname).toContain(`modelos/${body.id}/`);
      expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();

      // GET lista la foto con su URL de descarga.
      const lista = await app.inject({
        method: 'GET',
        url: `/api/modelos/${body.id}/fotos`,
        headers: { cookie },
      });
      const fotos = lista.json<{
        datos: { idFoto: number; tipo: string; urlDescarga: string }[];
      }>();
      expect(fotos.datos).toHaveLength(1);
      expect(fotos.datos[0]?.tipo).toBe('FRENTE');
      expect(fotos.datos[0]?.urlDescarga).toContain('r2.cloudflarestorage.com');

      // El conteo de fotos del modelo sube a 1.
      const ficha = await app.inject({
        method: 'GET',
        url: `/api/modelos/${body.id}`,
        headers: { cookie },
      });
      expect(ficha.json<{ cantidadFotos: number }>().cantidadFotos).toBe(1);

      // PATCH metadatos (tipo/orden).
      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/modelos/${body.id}/fotos/${subida.idFoto}`,
        headers: { cookie },
        payload: { tipo: 'ESPALDA', orden: 5 },
      });
      expect(patch.statusCode).toBe(204);

      // DELETE quita la foto.
      const del = await app.inject({
        method: 'DELETE',
        url: `/api/modelos/${body.id}/fotos/${subida.idFoto}`,
        headers: { cookie },
      });
      expect(del.statusCode).toBe(204);
      const vacio = await app.inject({
        method: 'GET',
        url: `/api/modelos/${body.id}/fotos`,
        headers: { cookie },
      });
      expect(vacio.json<{ datos: unknown[] }>().datos).toHaveLength(0);
    });

    it('rechaza una foto que no es imagen (400)', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'FOTO2' });
      const res = await app.inject({
        method: 'POST',
        url: `/api/modelos/${body.id}/fotos`,
        headers: { cookie },
        payload: { nombreOriginal: 'doc.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  /**
   * Foto PRINCIPAL y arte PRINCIPAL (jul-2026, petición de Daniel). "Principal" = ser el PRIMERO;
   * marcarlo mueve el renglón al lugar 0 y reindexa el resto. Aquí se verifica contra Postgres
   * REAL lo que el unit no puede: que la columna `modelo_bordado.orden` (migración
   * `20260725130000_modelo_bordado_orden`) persiste el orden, que las lecturas salen ordenadas y
   * que guardar la receta después NO desbanca al principal.
   */
  describe('principal (foto del modelo y arte del BOM)', () => {
    /** Sube N fotos por API (quedan en `orden` 0..N-1) y devuelve sus `idFoto` en ese orden. */
    async function subirFotos(
      cookie: string,
      idModelo: number,
      cuantas: number,
    ): Promise<number[]> {
      const ids: number[] = [];
      for (let i = 0; i < cuantas; i += 1) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/modelos/${idModelo}/fotos`,
          headers: { cookie },
          payload: {
            nombreOriginal: `f${String(i)}.jpg`,
            tipoMime: 'image/jpeg',
            tamanoBytes: 100,
            tipo: 'OTRO',
          },
        });
        expect(res.statusCode).toBe(201);
        ids.push(res.json<{ idFoto: number }>().idFoto);
      }
      return ids;
    }

    it('marca la foto principal: la mueve al frente, reindexa y es idempotente', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'PRIN-FOTO' });
      const [f1, f2, f3] = await subirFotos(cookie, body.id, 3);

      const res = await app.inject({
        method: 'POST',
        url: `/api/modelos/${body.id}/fotos/${String(f3)}/principal`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      // La respuesta ya trae la galería reordenada (la principal primero).
      expect(res.json<{ datos: { idFoto: number }[] }>().datos.map((f) => f.idFoto)).toEqual([
        f3,
        f1,
        f2,
      ]);

      // Persistido: `orden` compacto 0..N-1, sin huecos ni empates.
      const enBd = await cliente.modeloFoto.findMany({
        where: { idModelo: body.id },
        orderBy: { orden: 'asc' },
        select: { id: true, orden: true },
      });
      expect(enBd).toEqual([
        { id: f3, orden: 0 },
        { id: f1, orden: 1 },
        { id: f2, orden: 2 },
      ]);

      // El GET de fotos devuelve el mismo orden…
      const lista = await app.inject({
        method: 'GET',
        url: `/api/modelos/${body.id}/fotos`,
        headers: { cookie },
      });
      expect(lista.json<{ datos: { idFoto: number }[] }>().datos.map((f) => f.idFoto)).toEqual([
        f3,
        f1,
        f2,
      ]);

      // …y repetirlo es IDEMPOTENTE (mismo resultado, sin reordenar de nuevo).
      const otraVez = await app.inject({
        method: 'POST',
        url: `/api/modelos/${body.id}/fotos/${String(f3)}/principal`,
        headers: { cookie },
      });
      expect(otraVez.statusCode).toBe(200);
      expect(otraVez.json<{ datos: { idFoto: number }[] }>().datos.map((f) => f.idFoto)).toEqual([
        f3,
        f1,
        f2,
      ]);
    });

    it('una foto de OTRO modelo (o inexistente) → 404', async () => {
      const cookie = await cookieAdmin();
      const uno = (await crearModeloApi(cookie, { codigo: 'PRIN-A' })).body;
      const otro = (await crearModeloApi(cookie, { codigo: 'PRIN-B' })).body;
      const [ajena] = await subirFotos(cookie, otro.id, 1);

      const res = await app.inject({
        method: 'POST',
        url: `/api/modelos/${uno.id}/fotos/${String(ajena)}/principal`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(404);
    });

    it('marca el arte principal del BOM y lo persiste en `modelo_bordado.orden`', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'PRIN-ARTE' });
      const a = await crearBordado('Arte A', 10);
      const b = await crearBordado('Arte B', 20);
      const c = await crearBordado('Arte C', 30);
      // Al guardar la receta, los renglones NUEVOS toman el orden en que vienen en el cuerpo (es
      // el orden que el usuario ve en la pantalla), no el alfabético.
      const put = await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/bordados`,
        headers: { cookie },
        payload: {
          bordados: [
            { idBordado: a, precio: 10 },
            { idBordado: b, precio: 20 },
            { idBordado: c, precio: 30 },
          ],
        },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json<{ datos: { idBordado: number }[] }>().datos.map((x) => x.idBordado)).toEqual([
        a,
        b,
        c,
      ]);

      // Marcar C como principal.
      const res = await app.inject({
        method: 'POST',
        url: `/api/modelos/${body.id}/bom/bordados/${String(c)}/principal`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ datos: { idBordado: number }[] }>().datos.map((x) => x.idBordado)).toEqual([
        c,
        a,
        b,
      ]);

      // La columna nueva guarda el orden compacto.
      const enBd = await cliente.modeloBordado.findMany({
        where: { idModelo: body.id },
        orderBy: { orden: 'asc' },
        select: { idBordado: true, orden: true },
      });
      expect(enBd).toEqual([
        { idBordado: c, orden: 0 },
        { idBordado: a, orden: 1 },
        { idBordado: b, orden: 2 },
      ]);

      // La FICHA del modelo también trae el arte con el principal al frente.
      const ficha = await app.inject({
        method: 'GET',
        url: `/api/modelos/${body.id}`,
        headers: { cookie },
      });
      expect(
        ficha.json<{ bordados: { idBordado: number }[] }>().bordados.map((x) => x.idBordado),
      ).toEqual([c, a, b]);
    });

    it('el HISTÓRICO (todo el arte en `orden` 0) se sigue listando alfabético y se puede marcar', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'PRIN-HIST' });
      const c = await crearBordado('Zeta', 30);
      const a = await crearBordado('Alfa', 10);
      // Datos como quedan tras la migración aditiva: TODOS con el default `orden` 0 (así están los
      // BOM que ya existían). El desempate por nombre los deja como se listaban antes del cambio.
      await cliente.modeloBordado.createMany({
        data: [
          { idModelo: body.id, idBordado: c, precio: 30 },
          { idModelo: body.id, idBordado: a, precio: 10 },
        ],
      });

      const ficha = await app.inject({
        method: 'GET',
        url: `/api/modelos/${body.id}`,
        headers: { cookie },
      });
      expect(
        ficha.json<{ bordados: { idBordado: number }[] }>().bordados.map((x) => x.idBordado),
      ).toEqual([a, c]);

      // Marcar el segundo (Zeta) como principal compacta el orden y lo pone al frente.
      const res = await app.inject({
        method: 'POST',
        url: `/api/modelos/${body.id}/bom/bordados/${String(c)}/principal`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ datos: { idBordado: number }[] }>().datos.map((x) => x.idBordado)).toEqual([
        c,
        a,
      ]);
      const enBd = await cliente.modeloBordado.findMany({
        where: { idModelo: body.id },
        orderBy: { orden: 'asc' },
        select: { idBordado: true, orden: true },
      });
      expect(enBd).toEqual([
        { idBordado: c, orden: 0 },
        { idBordado: a, orden: 1 },
      ]);
    });

    it('guardar la receta después NO desbanca al arte principal (el nuevo entra al final)', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'PRIN-ARTE2' });
      const a = await crearBordado('Arte A', 10);
      const b = await crearBordado('Arte B', 20);
      const nuevo = await crearBordado('Arte AA', 5); // alfabéticamente iría ANTES de "Arte B"

      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/bordados`,
        headers: { cookie },
        payload: {
          bordados: [
            { idBordado: a, precio: 10 },
            { idBordado: b, precio: 20 },
          ],
        },
      });
      // B es el principal.
      await app.inject({
        method: 'POST',
        url: `/api/modelos/${body.id}/bom/bordados/${String(b)}/principal`,
        headers: { cookie },
      });

      // Se guarda la receta agregando un arte cuyo NOMBRE lo pondría primero por alfabético.
      const put = await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/bordados`,
        headers: { cookie },
        payload: {
          bordados: [
            { idBordado: a, precio: 11 },
            { idBordado: b, precio: 20 },
            { idBordado: nuevo, precio: 5 },
          ],
        },
      });
      expect(put.statusCode).toBe(200);
      // B sigue siendo el principal y el nuevo quedó AL FINAL (no en `orden` 0).
      expect(put.json<{ datos: { idBordado: number }[] }>().datos.map((x) => x.idBordado)).toEqual([
        b,
        a,
        nuevo,
      ]);
    });

    it('un arte que no está en el BOM del modelo → 404', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'PRIN-ARTE3' });
      const suelto = await crearBordado('Arte suelto', 9);
      const res = await app.inject({
        method: 'POST',
        url: `/api/modelos/${body.id}/bom/bordados/${String(suelto)}/principal`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(404);
    });

    it('sin permiso `modelos.administrar` los dos endpoints dan 403 (deny-by-default)', async () => {
      const cookieAdministra = await cookieAdmin();
      const { body } = await crearModeloApi(cookieAdministra, { codigo: 'PRIN-403' });
      const [foto] = await subirFotos(cookieAdministra, body.id, 1);
      const arte = await crearBordado('Arte 403', 3);
      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/bordados`,
        headers: { cookie: cookieAdministra },
        payload: { bordados: [{ idBordado: arte, precio: 3 }] },
      });

      await crearUsuarioBasico('sinpermiso', 'Clave.1234!');
      const sesion = await login('sinpermiso', 'Clave.1234!');
      const cookie = comoHeaderCookie(sesion.cookies);

      for (const url of [
        `/api/modelos/${body.id}/fotos/${String(foto)}/principal`,
        `/api/modelos/${body.id}/bom/bordados/${String(arte)}/principal`,
      ]) {
        const res = await app.inject({ method: 'POST', url, headers: { cookie } });
        expect(res.statusCode).toBe(403);
      }
    });
  });
});
