/**
 * Pruebas de integración de las rutas de Modelos (Módulo 2, F1-E4): el API REST de punta a
 * punta, incluido el BOM (telas/avíos), el ARTE del modelo, copiar BOM y el flujo de fotos con el motor
 * de archivos de F0.
 *
 * Levantan una app Fastify con SOLO el plugin de modelos montado bajo `/api`, apuntada al
 * Postgres efímero de testcontainers, con la autenticación real (better-auth) y el seed real
 * (admin `Control.2026!`, 9 roles, FR Moda, géneros sembrados). Se ejercita con `app.inject`
 * (sin abrir puerto). Las telas/avíos del BOM se crean directo en BD (este test no
 * monta sus rutas; el dominio de modelos solo necesita que existan). Cubren:
 *  - deny-by-default: rol `Basico` (sin permisos) → 403; sin sesión → 401;
 *  - alta y aparición en el listado (modo servidor: búsqueda + filtro temporada) + código dup 409;
 *  - PATCH parcial (FK + vaciar con null) + descontinuar/reactivar + filtro incluirInactivos;
 *  - selector de géneros (sembrados);
 *  - BOM: set de telas/avíos (consumo + 3 banderas persistidas), sin duplicados; ARTE por renglón;
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
import { rutasMedidasAvioTalla } from './medidas-avio-talla.rutas.js';
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
  // Sub-recurso de la receta: las medidas POR TALLA de un avío del BOM (R18) — la copia de BOM
  // debe conservarlas, y eso se verifica por su endpoint.
  await instancia.register(rutasMedidasAvioTalla, { prefix: '/api' });
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

/**
 * Id del tipo de arte «bordado» del catálogo ÚNICO (V1-E3f, §Post-F9.58). Lo siembra `sembrar()`
 * como cualquier otro tipo de proceso; se resuelve una vez por test porque el arte lo exige.
 */
let idTipoArte: number;

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await sembrar(cliente);
  idTipoArte = (await cliente.tipoProceso.findUniqueOrThrow({ where: { codigo: 'bordado' } })).id;
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

/** Agrega un ARTE a un modelo por la API (V1-E3d: el arte vive dentro del modelo) y da su id. */
async function crearArteApi(
  cookie: string,
  idModelo: number,
  nombre: string,
  precio: number,
): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/modelos/${String(idModelo)}/artes`,
    headers: { cookie },
    payload: { descripcion: nombre, idTipoArte, precio },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: number }>().id;
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

  describe('BOM (telas/avíos)', () => {
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

    it('reemplaza avíos (banderas por renglón)', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'BOM2' });
      const idAvio = await crearAvio('BTN-01');

      const avios = await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/avios`,
        headers: { cookie },
        payload: { avios: [{ idAvio, consumoPorPrenda: 4, paraCosto: false }] },
      });
      expect(avios.statusCode).toBe(200);
      expect(avios.json<{ datos: { paraCosto: boolean }[] }>().datos[0]?.paraCosto).toBe(false);
    });

    it('AMARRA el precio del renglón (R17): guarda proveedor de tela y de avío y los devuelve', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'BOM-AMARRE' });
      const idTela = await crearTela('Felpa amarrada');
      const idAvio = await crearAvio('CIE-AM');
      const proveedor = await cliente.proveedor.create({ data: { nombre: 'Alsatex' } });
      const telaProveedor = await cliente.telaProveedor.create({
        data: { idTela, idProveedor: proveedor.id, precio: 62.5 },
      });
      await cliente.avioProveedor.create({
        data: { idAvio, idProveedor: proveedor.id, precio: 100, factorConversion: 50 },
      });
      await cliente.tela.update({ where: { id: idTela }, data: { precioSugerido: 40 } });
      await cliente.avio.update({ where: { id: idAvio }, data: { precioReferencia: 3 } });

      const telas = await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/telas`,
        headers: { cookie },
        payload: {
          telas: [{ idTela, consumoPorPrenda: 1, idTelaProveedor: telaProveedor.id }],
        },
      });
      expect(telas.statusCode).toBe(200);
      expect(telas.json<{ datos: Record<string, unknown>[] }>().datos[0]).toMatchObject({
        idTelaProveedor: telaProveedor.id,
        proveedorAmarrado: 'Alsatex',
        // Lo que VA A COSTEAR (el amarre gana la cascada) + de dónde salió.
        precioCosteo: 62.5,
        origenPrecio: 'amarre',
        proveedorPrecio: 'Alsatex',
        precioReferencia: 40,
      });

      const avios = await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/avios`,
        headers: { cookie },
        payload: { avios: [{ idAvio, consumoPorPrenda: 1, idAvioProveedor: proveedor.id }] },
      });
      expect(avios.statusCode).toBe(200);
      // El precio del amarre sale NORMALIZADO a unidad de consumo (100 / 50 = 2 por metro).
      expect(avios.json<{ datos: Record<string, unknown>[] }>().datos[0]).toMatchObject({
        idAvioProveedor: proveedor.id,
        proveedorAmarrado: 'Alsatex',
        precioCosteo: 2,
        origenPrecio: 'amarre',
        proveedorPrecio: 'Alsatex',
        precioReferencia: 3,
      });

      // Persistido de verdad (lo que lee el precosto/MRP), no solo devuelto.
      const filaTela = await cliente.modeloTela.findUnique({
        where: { idModelo_idTela: { idModelo: body.id, idTela } },
      });
      expect(filaTela?.idTelaProveedor).toBe(telaProveedor.id);
      const filaAvio = await cliente.modeloAvio.findUnique({
        where: { idModelo_idAvio: { idModelo: body.id, idAvio } },
      });
      expect(filaAvio?.idAvioProveedor).toBe(proveedor.id);
    });

    it('⭐ SIN amarre la receta muestra lo que COSTEA: el más barato normalizado, con su proveedor', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'BOM-MAS-BARATO' });
      const idAvio = await crearAvio('ZIP-01');
      await cliente.avio.update({ where: { id: idAvio }, data: { precioReferencia: 9 } });
      const caro = await cliente.proveedor.create({ data: { nombre: 'Cierres Caros' } });
      const barato = await cliente.proveedor.create({ data: { nombre: 'Zippers MX' } });
      // El "caro" vende por caja: 500 la caja de 100 = 5 por pieza. El barato, 4.20 por pieza.
      await cliente.avioProveedor.create({
        data: { idAvio, idProveedor: caro.id, precio: 500, factorConversion: 100 },
      });
      await cliente.avioProveedor.create({
        data: { idAvio, idProveedor: barato.id, precio: 4.2 },
      });

      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/avios`,
        headers: { cookie },
        payload: { avios: [{ idAvio, consumoPorPrenda: 1 }] },
      });
      const ficha = await app.inject({
        method: 'GET',
        url: `/api/modelos/${body.id}`,
        headers: { cookie },
      });
      // Lo que costea el precosto SIN amarre es el más barato normalizado (4.20), NO el
      // `precioReferencia` del catálogo (9) que la receta enseñaba antes.
      expect(ficha.json<{ avios: Record<string, unknown>[] }>().avios[0]).toMatchObject({
        idAvioProveedor: null,
        precioCosteo: 4.2,
        origenPrecio: 'mas-barato',
        proveedorPrecio: 'Zippers MX',
        precioReferencia: 9,
      });
    });

    it('⭐ un avío POR MEDIDA se muestra con el PROMEDIO de sus medidas (gana al amarre)', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'BOM-POR-MEDIDA' });
      const idAvio = await crearAvio('CIE-MED');
      const proveedor = await cliente.proveedor.create({ data: { nombre: 'Cierres del Centro' } });
      await cliente.avioProveedor.create({
        data: { idAvio, idProveedor: proveedor.id, precio: 20 },
      });
      await cliente.avioMedida.createMany({
        data: [
          { idAvio, medida: '15 cm', precio: 5.8 },
          { idAvio, medida: '18 cm', precio: 6.2 },
          // Inactiva: no entra al promedio (5.8 + 6.2) / 2 = 6.00.
          { idAvio, medida: '22 cm', precio: 100, activo: false },
        ],
      });

      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/avios`,
        headers: { cookie },
        payload: { avios: [{ idAvio, consumoPorPrenda: 1, idAvioProveedor: proveedor.id }] },
      });
      const ficha = await app.inject({
        method: 'GET',
        url: `/api/modelos/${body.id}`,
        headers: { cookie },
      });
      // Aunque HAY amarre, el precosto costea con el promedio de las medidas: la receta lo dice.
      expect(ficha.json<{ avios: Record<string, unknown>[] }>().avios[0]).toMatchObject({
        idAvioProveedor: proveedor.id,
        precioCosteo: 6,
        origenPrecio: 'promedio-medidas',
        proveedorPrecio: null,
      });
    });

    it('un amarre SIN precio no costea: la receta cae al escalón que sí (y lo dice)', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'BOM-AMARRE-MUDO' });
      const idAvio = await crearAvio('AV-MUDO');
      const mudo = await cliente.proveedor.create({ data: { nombre: 'Proveedor sin lista' } });
      const conPrecio = await cliente.proveedor.create({ data: { nombre: 'Proveedor con lista' } });
      await cliente.avioProveedor.create({
        data: { idAvio, idProveedor: mudo.id, precio: null },
      });
      await cliente.avioProveedor.create({
        data: { idAvio, idProveedor: conPrecio.id, precio: 7 },
      });

      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/avios`,
        headers: { cookie },
        payload: { avios: [{ idAvio, consumoPorPrenda: 1, idAvioProveedor: mudo.id }] },
      });
      const ficha = await app.inject({
        method: 'GET',
        url: `/api/modelos/${body.id}`,
        headers: { cookie },
      });
      expect(ficha.json<{ avios: Record<string, unknown>[] }>().avios[0]).toMatchObject({
        idAvioProveedor: mudo.id,
        proveedorAmarrado: 'Proveedor sin lista',
        precioCosteo: 7,
        origenPrecio: 'mas-barato',
        proveedorPrecio: 'Proveedor con lista',
      });
    });

    it('⭐ la ficha ABRE aunque un factor de conversión esté corrupto (no 500)', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'BOM-FACTOR-MALO' });
      const idAvio = await crearAvio('AV-FACTOR');
      const proveedor = await cliente.proveedor.create({ data: { nombre: 'Proveedor factor 0' } });
      await cliente.avioProveedor.create({
        data: { idAvio, idProveedor: proveedor.id, precio: 30 },
      });
      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/avios`,
        headers: { cookie },
        payload: { avios: [{ idAvio, consumoPorPrenda: 1, idAvioProveedor: proveedor.id }] },
      });

      // Un factor 0 NO se puede capturar por el dominio, pero la columna es `Decimal?` sin CHECK
      // (pudo entrar por ETL o por una fila vieja): se fuerza a mano, como en producción.
      await cliente.avioProveedor.update({
        where: { idAvio_idProveedor: { idAvio, idProveedor: proveedor.id } },
        data: { factorConversion: 0 },
      });

      const ficha = await app.inject({
        method: 'GET',
        url: `/api/modelos/${body.id}`,
        headers: { cookie },
      });
      // La consulta NO revienta: el factor corrupto se lee como AUSENTE (1:1) y se muestra el
      // precio sin convertir. Costear con él sí tiene que reventar — esa regla no se toca.
      expect(ficha.statusCode).toBe(200);
      expect(ficha.json<{ avios: Record<string, unknown>[] }>().avios[0]).toMatchObject({
        precioCosteo: 30,
        origenPrecio: 'amarre',
        proveedorPrecio: 'Proveedor factor 0',
      });
    });

    it('rechaza un amarre que no es de esa tela / de ese avío (400)', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'BOM-AMARRE-MAL' });
      const idTela = await crearTela('Tela A');
      const otraTela = await crearTela('Tela B');
      const idAvio = await crearAvio('AV-MAL');
      const proveedor = await cliente.proveedor.create({ data: { nombre: 'Prov ajeno' } });
      const amarreDeOtraTela = await cliente.telaProveedor.create({
        data: { idTela: otraTela, idProveedor: proveedor.id, precio: 10 },
      });

      const telas = await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/telas`,
        headers: { cookie },
        payload: { telas: [{ idTela, consumoPorPrenda: 1, idTelaProveedor: amarreDeOtraTela.id }] },
      });
      expect(telas.statusCode).toBe(400);

      // El proveedor no surte ese avío (no hay par AvioProveedor).
      const avios = await app.inject({
        method: 'PUT',
        url: `/api/modelos/${body.id}/bom/avios`,
        headers: { cookie },
        payload: { avios: [{ idAvio, consumoPorPrenda: 1, idAvioProveedor: proveedor.id }] },
      });
      expect(avios.statusCode).toBe(400);
    });

    it('la FICHA publica las tallas de la curva del modelo (para capturar consumo por talla)', async () => {
      const cookie = await cookieAdmin();
      const ch = await cliente.talla.create({ data: { etiqueta: 'CH-F', orden: 1 } });
      const g = await cliente.talla.create({ data: { etiqueta: 'G-F', orden: 3 } });
      const curva = await cliente.curvaTalla.create({
        data: {
          nombre: 'Curva ficha',
          items: {
            create: [
              { idTalla: ch.id, posicion: 0 },
              { idTalla: g.id, posicion: 1 },
            ],
          },
        },
      });
      const sinCurva = (await crearModeloApi(cookie, { codigo: 'SIN-CURVA' })).body;
      const conCurva = (
        await crearModeloApi(cookie, { codigo: 'CON-CURVA', idCurvaTalla: curva.id })
      ).body;

      const fichaSin = await app.inject({
        method: 'GET',
        url: `/api/modelos/${sinCurva.id}`,
        headers: { cookie },
      });
      expect(fichaSin.json<{ tallasCurva: unknown[] }>().tallasCurva).toEqual([]);

      const fichaCon = await app.inject({
        method: 'GET',
        url: `/api/modelos/${conCurva.id}`,
        headers: { cookie },
      });
      expect(
        fichaCon.json<{ tallasCurva: { etiqueta: string }[] }>().tallasCurva.map((t) => t.etiqueta),
      ).toEqual(['CH-F', 'G-F']);
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
    it('copia telas/avíos/arte de otro modelo (reemplazar) y rechaza origen==destino', async () => {
      const cookie = await cookieAdmin();
      const origen = (await crearModeloApi(cookie, { codigo: 'ORIG' })).body;
      const destino = (await crearModeloApi(cookie, { codigo: 'DEST' })).body;
      const idTela = await crearTela('Jersey');
      const idAvio = await crearAvio('ETIQ-1');
      await crearArteApi(cookie, origen.id, 'Estampa', 12);

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
      const copia = await app.inject({
        method: 'POST',
        url: `/api/modelos/${destino.id}/copiar-bom`,
        headers: { cookie },
        payload: { idOrigen: origen.id, reemplazar: true },
      });
      expect(copia.statusCode).toBe(200);
      const bom = copia.json<{
        telas: unknown[];
        avios: unknown[];
        artes: { descripcion: string }[];
      }>();
      expect(bom.telas).toHaveLength(1);
      expect(bom.avios).toHaveLength(1);
      expect(bom.artes).toHaveLength(1);
      // La copia es un arte PROPIO del destino (no una referencia a un catálogo que ya no existe).
      expect(bom.artes[0]?.descripcion).toBe('Estampa');

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

    it('la copia CONSERVA el amarre de precio y las medidas por talla del avío', async () => {
      const cookie = await cookieAdmin();
      const origen = (await crearModeloApi(cookie, { codigo: 'ORIG-AM' })).body;
      const destino = (await crearModeloApi(cookie, { codigo: 'DEST-AM' })).body;
      const idTela = await crearTela('Felpa copiada');
      const idAvio = await crearAvio('CIE-COPIA');
      const proveedor = await cliente.proveedor.create({ data: { nombre: 'Proveedor copia' } });
      const telaProveedor = await cliente.telaProveedor.create({
        data: { idTela, idProveedor: proveedor.id, precio: 50 },
      });
      await cliente.avioProveedor.create({
        data: { idAvio, idProveedor: proveedor.id, precio: 7 },
      });
      const talla = await cliente.talla.create({ data: { etiqueta: 'U-COPIA', orden: 1 } });

      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${origen.id}/bom/telas`,
        headers: { cookie },
        payload: { telas: [{ idTela, consumoPorPrenda: 2, idTelaProveedor: telaProveedor.id }] },
      });
      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${origen.id}/bom/avios`,
        headers: { cookie },
        payload: { avios: [{ idAvio, consumoPorPrenda: 1, idAvioProveedor: proveedor.id }] },
      });
      const medidas = await app.inject({
        method: 'PUT',
        url: `/api/modelos/${origen.id}/avios/${idAvio}/medidas`,
        headers: { cookie },
        payload: { consumoPorTalla: true, tallas: [{ idTalla: talla.id, consumo: 0.75 }] },
      });
      expect(medidas.statusCode).toBe(200);

      const copia = await app.inject({
        method: 'POST',
        url: `/api/modelos/${destino.id}/copiar-bom`,
        headers: { cookie },
        payload: { idOrigen: origen.id, reemplazar: true },
      });
      expect(copia.statusCode).toBe(200);
      const bom = copia.json<{
        telas: { idTelaProveedor: number | null }[];
        avios: { idAvioProveedor: number | null; consumoPorTalla: boolean }[];
      }>();
      expect(bom.telas[0]?.idTelaProveedor).toBe(telaProveedor.id);
      expect(bom.avios[0]?.idAvioProveedor).toBe(proveedor.id);
      expect(bom.avios[0]?.consumoPorTalla).toBe(true);

      // El consumo POR TALLA viajó con la receta (si no, el destino diría "costeo por talla" con
      // la matriz vacía).
      const copiadas = await app.inject({
        method: 'GET',
        url: `/api/modelos/${destino.id}/avios/${idAvio}/medidas`,
        headers: { cookie },
      });
      const cuerpo = copiadas.json<{ tallas: { idTalla: number; consumo: number }[] }>();
      expect(cuerpo.tallas).toHaveLength(1);
      expect(cuerpo.tallas[0]).toMatchObject({ idTalla: talla.id, consumo: 0.75 });
    });

    it('TODO O NADA: un copiar-bom que falla deja el BOM del destino intacto (rollback)', async () => {
      const cookie = await cookieAdmin();
      const destino = (await crearModeloApi(cookie, { codigo: 'DEST-RB' })).body;
      const idTela = await crearTela('Intacta');

      // El destino YA tiene un BOM (la ruta destructiva reemplazar:true borraría esto primero).
      await app.inject({
        method: 'PUT',
        url: `/api/modelos/${destino.id}/bom/telas`,
        headers: { cookie },
        payload: { telas: [{ idTela, consumoPorPrenda: 2 }] },
      });
      const idArte = await crearArteApi(cookie, destino.id, 'Arte intacto', 20);

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
        artes: { id: number }[];
      }>();
      expect(bom.telas).toHaveLength(1);
      expect(bom.telas[0]?.idTela).toBe(idTela);
      expect(bom.artes).toHaveLength(1);
      expect(bom.artes[0]?.id).toBe(idArte);
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
   * REAL lo que el unit no puede: que la columna `modelo_arte.orden` persiste el orden (viene de
   * `20260725130000_modelo_bordado_orden` y la heredó `modelo_arte`), que las lecturas salen ordenadas y
   * que guardar la receta después NO desbanca al principal.
   */
  describe('principal (foto del modelo y arte del modelo)', () => {
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

    it('marca el arte principal del modelo y lo persiste en `modelo_arte.orden`', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'PRIN-ARTE' });
      // Los artes NUEVOS entran AL FINAL, en el orden en que se capturan (no alfabético).
      const a = await crearArteApi(cookie, body.id, 'Arte A', 10);
      const b = await crearArteApi(cookie, body.id, 'Arte B', 20);
      const c = await crearArteApi(cookie, body.id, 'Arte C', 30);

      const lista = await app.inject({
        method: 'GET',
        url: `/api/modelos/${body.id}/artes`,
        headers: { cookie },
      });
      expect(lista.json<{ datos: { id: number }[] }>().datos.map((x) => x.id)).toEqual([a, b, c]);

      // Marcar C como principal.
      const res = await app.inject({
        method: 'POST',
        url: `/api/modelos/${body.id}/artes/${String(c)}/principal`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ datos: { id: number }[] }>().datos.map((x) => x.id)).toEqual([c, a, b]);

      // La columna guarda el orden compacto.
      const enBd = await cliente.modeloArte.findMany({
        where: { idModelo: body.id },
        orderBy: { orden: 'asc' },
        select: { id: true, orden: true },
      });
      expect(enBd).toEqual([
        { id: c, orden: 0 },
        { id: a, orden: 1 },
        { id: b, orden: 2 },
      ]);

      // La FICHA del modelo también trae el arte con el principal al frente.
      const ficha = await app.inject({
        method: 'GET',
        url: `/api/modelos/${body.id}`,
        headers: { cookie },
      });
      expect(ficha.json<{ artes: { id: number }[] }>().artes.map((x) => x.id)).toEqual([c, a, b]);
    });

    it('el HISTÓRICO (todo el arte en `orden` 0) se lista por antigüedad y se puede marcar', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'PRIN-HIST' });
      // Datos como los deja la MIGRACIÓN: todos con el default `orden` 0 (el histórico migrado).
      // ⚠️ V1-E3f: el desempate ya NO es por nombre (se retiró) sino por `id`, así que el
      // histórico se lista por ANTIGÜEDAD DE CAPTURA, no alfabético. Zeta se creó primero.
      const zeta = await cliente.modeloArte.create({
        data: { idModelo: body.id, descripcion: 'Zeta', idTipoArte, precio: 30 },
        select: { id: true },
      });
      const alfa = await cliente.modeloArte.create({
        data: { idModelo: body.id, descripcion: 'Alfa', idTipoArte, precio: 10 },
        select: { id: true },
      });

      const ficha = await app.inject({
        method: 'GET',
        url: `/api/modelos/${body.id}`,
        headers: { cookie },
      });
      expect(ficha.json<{ artes: { id: number }[] }>().artes.map((x) => x.id)).toEqual([
        zeta.id,
        alfa.id,
      ]);

      // Marcar Zeta como principal compacta el orden y lo deja al frente.
      const res = await app.inject({
        method: 'POST',
        url: `/api/modelos/${body.id}/artes/${String(zeta.id)}/principal`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ datos: { id: number }[] }>().datos.map((x) => x.id)).toEqual([
        zeta.id,
        alfa.id,
      ]);
      const enBd = await cliente.modeloArte.findMany({
        where: { idModelo: body.id },
        orderBy: { orden: 'asc' },
        select: { id: true, orden: true },
      });
      expect(enBd).toEqual([
        { id: zeta.id, orden: 0 },
        { id: alfa.id, orden: 1 },
      ]);
    });

    it('agregar arte después NO desbanca al principal (el nuevo entra al final)', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'PRIN-ARTE2' });
      const a = await crearArteApi(cookie, body.id, 'Arte A', 10);
      const b = await crearArteApi(cookie, body.id, 'Arte B', 20);

      // B es el principal.
      await app.inject({
        method: 'POST',
        url: `/api/modelos/${body.id}/artes/${String(b)}/principal`,
        headers: { cookie },
      });

      // Se agrega un arte cuya DESCRIPCIÓN lo pondría primero por alfabético.
      const nuevo = await crearArteApi(cookie, body.id, 'Arte AA', 5);

      const lista = await app.inject({
        method: 'GET',
        url: `/api/modelos/${body.id}/artes`,
        headers: { cookie },
      });
      // B sigue siendo el principal y el nuevo quedó AL FINAL (no en `orden` 0).
      expect(lista.json<{ datos: { id: number }[] }>().datos.map((x) => x.id)).toEqual([
        b,
        a,
        nuevo,
      ]);
    });

    it('un arte de OTRO modelo → 404 al marcarlo principal', async () => {
      const cookie = await cookieAdmin();
      const { body } = await crearModeloApi(cookie, { codigo: 'PRIN-ARTE3' });
      const otro = (await crearModeloApi(cookie, { codigo: 'PRIN-ARTE3B' })).body;
      const ajeno = await crearArteApi(cookie, otro.id, 'Arte ajeno', 9);
      const res = await app.inject({
        method: 'POST',
        url: `/api/modelos/${body.id}/artes/${String(ajeno)}/principal`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(404);
    });

    it('sin permiso `modelos.administrar` los dos endpoints dan 403 (deny-by-default)', async () => {
      const cookieAdministra = await cookieAdmin();
      const { body } = await crearModeloApi(cookieAdministra, { codigo: 'PRIN-403' });
      const [foto] = await subirFotos(cookieAdministra, body.id, 1);
      const arte = await crearArteApi(cookieAdministra, body.id, 'Arte 403', 3);

      await crearUsuarioBasico('sinpermiso', 'Clave.1234!');
      const sesion = await login('sinpermiso', 'Clave.1234!');
      const cookie = comoHeaderCookie(sesion.cookies);

      for (const url of [
        `/api/modelos/${body.id}/fotos/${String(foto)}/principal`,
        `/api/modelos/${body.id}/artes/${String(arte)}/principal`,
      ]) {
        const res = await app.inject({ method: 'POST', url, headers: { cookie } });
        expect(res.statusCode).toBe(403);
      }
    });
  });
});
