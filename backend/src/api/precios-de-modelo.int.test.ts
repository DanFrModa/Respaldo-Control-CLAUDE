/**
 * ⭐ Pruebas de integración POR HTTP del DINERO del modelo y de la orden (fila 0.249 parte C).
 *
 * Lo que se mide es UNA frase: **con sólo la llave de VOCABULARIO (`modelos.ver`, `ordenes.ver`,
 * `desarrollo.ver`) el API NO entrega la maquila ni el corte base, ni el precio del arte, ni los
 * precios del BOM, ni la maquila de referencia de la orden, ni los precios congelados de su receta
 * —tampoco escritos dentro del TEXTO de un aviso—, ni el precio de la habilitación del histórico;
 * con las llaves de la regla los entrega completos.**
 *
 * Se levanta una app Fastify con las rutas reales bajo `/api`, contra el Postgres efímero, con la
 * autenticación REAL (better-auth) y el seed real: se mide lo que sale por el cable después del
 * serializador del contrato. Cada precio sembrado es un número ÚNICO y se busca en el TEXTO CRUDO
 * de la respuesta, no en un campo: si mañana se cuela por un campo nuevo (o por una frase), cae.
 */
// Credenciales R2 FALSAS, fijadas ANTES de llamar al dominio: el listado de modelos y la galería
// construyen el servicio de archivos (para las fotos) aunque aquí ningún modelo tiene fotos.
process.env.R2_ACCOUNT_ID ??= 'cuenta-fake';
process.env.R2_ACCESS_KEY_ID ??= 'llave-fake';
process.env.R2_SECRET_ACCESS_KEY ??= 'secreto-fake';
process.env.R2_BUCKET ??= 'control-v2-prueba';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { hashPassword } from 'better-auth/crypto';

import { registrarManejadorErrores } from './errores.js';
import { rutasHistoricoOrdenes } from './consultas/historico-ordenes.rutas.js';
import { rutasMedidasAvioTalla } from './modelos/medidas-avio-talla.rutas.js';
import { rutasModelos } from './modelos/modelos.rutas.js';
import { rutasOrdenes } from './produccion/ordenes.rutas.js';
import { rutasRecetaOrden } from './produccion/receta-orden.rutas.js';
import { registrarAuth } from '../auth/plugin.js';
import type { ClavePermiso } from '../contrato/index.js';
import type { PrismaClient } from '../datos/index.js';
import { clientePruebas, crearTipoArtePrueba, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sembrarRecetaDeOrden } from '../pruebas/receta.js';
import { definirRoles, sembrar } from '../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;

const PASSWORD = 'Control.2026!';

/** El dinero PROPIO del modelo (corte base y arte; la maquila tiene su propia regla). */
const PRECIOS_MODELO = { corte: '7222.22', arte: '7888.88' } as const;
/** La maquila de referencia (`Modelo.maquilaBase` = `maquilaReferencia` de la orden). */
const MAQUILA = '7111.11';
/** Los precios de catálogo que el BOM enseña (regla de la parte B). */
const PRECIOS_BOM = {
  telaSugerido: '7333.33',
  telaAmarre: '7444.44',
  avioReferencia: '7555.55',
  medida: '7777.77',
} as const;
/** Los precios CONGELADOS de la orden (receta) y del histórico. */
const PRECIOS_ORDEN = {
  tela: '6111.11',
  avio: '6222.22',
  arte: '6333.33',
  historico: '6444.44',
} as const;

const TODOS_LOS_DEL_MODELO = [
  MAQUILA,
  ...Object.values(PRECIOS_MODELO),
  ...Object.values(PRECIOS_BOM),
];

/** Crea un usuario con un rol NUEVO que tiene EXACTAMENTE las claves pedidas (ninguna más). */
async function crearUsuarioCon(username: string, claves: ClavePermiso[]): Promise<void> {
  const rol = await cliente.rol.create({
    data: {
      nombre: `Perfil ${username}`,
      descripcion: `Rol de prueba con ${String(claves.length)} permiso(s).`,
      permisos: { create: claves.map((clave) => ({ permiso: { connect: { clave } } })) },
    },
  });
  const usuario = await cliente.usuario.create({
    data: {
      username,
      nombre: `Usuario ${username}`,
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
      password: await hashPassword(PASSWORD),
    },
  });
}

async function cookieDe(username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    payload: { username, password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  const set = res.headers['set-cookie'];
  const cookies = set === undefined ? [] : Array.isArray(set) ? set : [set];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function get(cookie: string, url: string): Promise<{ status: number; body: string }> {
  const res = await app.inject({ method: 'GET', url, headers: { cookie } });
  return { status: res.statusCode, body: res.body };
}

interface Sembrado {
  idModelo: number;
  idAvio: number;
  idArte: number;
  idOrden: number;
  idHistorico: number;
  idOrdenTela: number;
}

/** Un modelo con TODO su dinero lleno, su orden con la receta congelada y una orden histórica. */
async function sembrarEscenario(): Promise<Sembrado> {
  const empresa = await cliente.empresa.findFirstOrThrow({ select: { id: true } });
  const rol = await cliente.rolProveedor.findFirstOrThrow({ select: { id: true } });
  const proveedor = await cliente.proveedor.create({
    data: { nombre: 'Textiles 0.249C', roles: { create: { idRolProveedor: rol.id } } },
  });
  const tela = await cliente.tela.create({
    data: { nombre: 'Felpa 0.249C', precioSugerido: PRECIOS_BOM.telaSugerido },
  });
  const telaProveedor = await cliente.telaProveedor.create({
    data: { idTela: tela.id, idProveedor: proveedor.id, precio: PRECIOS_BOM.telaAmarre },
  });
  const avio = await cliente.avio.create({
    data: {
      clave: 'CIE-0249C',
      descripcion: 'Cierre 0.249C',
      unidad: 'pza',
      unidadMedida: 'cm',
      precioReferencia: PRECIOS_BOM.avioReferencia,
      medidas: { create: { medida: '53 cm', valor: 53, precio: PRECIOS_BOM.medida, orden: 0 } },
    },
    include: { medidas: true },
  });
  const talla = await cliente.talla.create({ data: { etiqueta: 'CH-0249C', orden: 1 } });
  const color = await cliente.color.create({ data: { nombre: 'Marino 0.249C' } });

  const modelo = await cliente.modelo.create({
    data: {
      codigo: 'M-0249C',
      descripcion: 'Sudadera 0.249C',
      maquilaBase: MAQUILA,
      corteBase: PRECIOS_MODELO.corte,
    },
  });
  await cliente.modeloTela.create({
    data: {
      idModelo: modelo.id,
      idTela: tela.id,
      consumoPorPrenda: 1,
      idTelaProveedor: telaProveedor.id,
    },
  });
  await cliente.modeloAvio.create({
    data: { idModelo: modelo.id, idAvio: avio.id, consumoPorPrenda: 1 },
  });
  await cliente.modeloAvioTalla.create({
    data: {
      idModelo: modelo.id,
      idAvio: avio.id,
      idTalla: talla.id,
      consumo: 1,
      idAvioMedida: avio.medidas[0]?.id ?? null,
    },
  });
  const idTipoArte = await crearTipoArtePrueba(cliente, 'bordado-0249c');
  const arte = await cliente.modeloArte.create({
    data: {
      idModelo: modelo.id,
      descripcion: 'Logo 0.249C',
      idTipoArte,
      precio: PRECIOS_MODELO.arte,
    },
  });

  const clienteNeg = await cliente.cliente.create({ data: { nombre: 'Cliente 0.249C' } });
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(249_003),
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNeg.id,
      lineas: {
        create: [{ idColor: color.id, tallas: { create: [{ idTalla: talla.id, cantidad: 10 }] } }],
      },
    },
  });
  await sembrarRecetaDeOrden(cliente, orden.id, modelo.id);
  // Precios CONGELADOS distintos de los del modelo ⇒ la desalineación escribe un aviso de PRECIO
  // con las dos cifras dentro del texto (que es lo que hay que tapar).
  const ordenTela = await cliente.ordenTela.findFirstOrThrow({ where: { idOrden: orden.id } });
  await cliente.ordenTela.update({
    where: { id: ordenTela.id },
    data: { precio: PRECIOS_ORDEN.tela },
  });
  await cliente.ordenAvio.updateMany({
    where: { idOrden: orden.id },
    data: { precio: PRECIOS_ORDEN.avio },
  });
  await cliente.ordenArte.updateMany({
    where: { idOrden: orden.id },
    data: { precio: PRECIOS_ORDEN.arte },
  });

  const historico = await cliente.historicoOrdenV1.create({
    data: {
      idEmpresa: empresa.id,
      idOrdenV1: 'V1-0249C',
      numero: '0249C',
      habilitacion: {
        create: {
          avio: 'Botón viejo',
          claveV1: 'BOT-V1',
          cantidad: 2,
          precio: PRECIOS_ORDEN.historico,
        },
      },
    },
  });

  return {
    idModelo: modelo.id,
    idAvio: avio.id,
    idArte: arte.id,
    idOrden: orden.id,
    idHistorico: historico.id,
    idOrdenTela: ordenTela.id,
  };
}

/** Todas las lecturas de `modelos.ver` que traen dinero del modelo o del BOM. */
function urlsModelo(s: Sembrado): string[] {
  const id = String(s.idModelo);
  return [
    '/api/modelos',
    `/api/modelos/${id}`,
    `/api/modelos/${id}/bom/telas`,
    `/api/modelos/${id}/bom/avios`,
    `/api/modelos/${id}/artes`,
    '/api/artes',
    `/api/modelos/${id}/avios/${String(s.idAvio)}/medidas`,
  ];
}

beforeAll(async () => {
  cliente = clientePruebas();
  const instancia = Fastify({ logger: false });
  instancia.setValidatorCompiler(validatorCompiler);
  instancia.setSerializerCompiler(serializerCompiler);
  registrarManejadorErrores(instancia);
  registrarAuth(instancia, {});
  await instancia.register(rutasModelos, { prefix: '/api' });
  await instancia.register(rutasMedidasAvioTalla, { prefix: '/api' });
  await instancia.register(rutasOrdenes, { prefix: '/api' });
  await instancia.register(rutasRecetaOrden, { prefix: '/api' });
  await instancia.register(rutasHistoricoOrdenes, { prefix: '/api' });
  await instancia.ready();
  app = instancia;
});

afterAll(async () => {
  await app.close();
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await sembrar(cliente);
});

describe('El dinero del MODELO por HTTP (fila 0.249 parte C)', () => {
  it('con SÓLO `modelos.ver`: ni listado, ni ficha, ni BOM, ni arte, ni galería, ni medidas traen un precio', async () => {
    await crearUsuarioCon('lector', ['modelos.ver']);
    const s = await sembrarEscenario();
    const cookie = await cookieDe('lector');

    for (const url of urlsModelo(s)) {
      const res = await get(cookie, url);
      expect(res.status, url).toBe(200);
      for (const precio of TODOS_LOS_DEL_MODELO) {
        expect(res.body, `${url} filtró ${precio}`).not.toContain(precio);
      }
      expect(res.body, url).toMatch(/"(preciosOcultos|maquilaOculta)":true/);
      expect(res.body, url).not.toMatch(/"(preciosOcultos|maquilaOculta)":false/);
    }

    // Y el VOCABULARIO sí llega: el modelo, su tela, su avío, el arte, el amarre y la medida.
    const ficha = await get(cookie, `/api/modelos/${String(s.idModelo)}`);
    for (const texto of ['Sudadera 0.249C', 'Felpa 0.249C', 'CIE-0249C', 'Logo 0.249C']) {
      expect(ficha.body).toContain(texto);
    }
    expect(ficha.body).toContain('Textiles 0.249C');
    const medidas = await get(
      cookie,
      `/api/modelos/${String(s.idModelo)}/avios/${String(s.idAvio)}/medidas`,
    );
    expect(medidas.body).toContain('53 cm');
  });

  // Escritas a mano a propósito (no importadas de la regla): si alguien quita una, esto lo dice.
  it.each(['consultas.ver-importes', 'modelos.administrar'] as const)(
    'con `modelos.ver` + %s: TODO el dinero del modelo llega completo',
    async (llave) => {
      await crearUsuarioCon('conllave', ['modelos.ver', llave]);
      const s = await sembrarEscenario();
      const cookie = await cookieDe('conllave');

      const ficha = await get(cookie, `/api/modelos/${String(s.idModelo)}`);
      expect(ficha.status).toBe(200);
      for (const precio of TODOS_LOS_DEL_MODELO.filter((p) => p !== PRECIOS_BOM.medida)) {
        expect(ficha.body, `falta ${precio}`).toContain(precio);
      }
      expect(ficha.body).not.toMatch(/"(preciosOcultos|maquilaOculta)":true/);

      const medidas = await get(
        cookie,
        `/api/modelos/${String(s.idModelo)}/avios/${String(s.idAvio)}/medidas`,
      );
      expect(medidas.body).toContain(PRECIOS_BOM.medida);
      const lista = await get(cookie, '/api/modelos');
      expect(lista.body).toContain(MAQUILA);
      expect(lista.body).toContain(PRECIOS_MODELO.corte);
      const galeria = await get(cookie, '/api/artes');
      expect(galeria.body).toContain(PRECIOS_MODELO.arte);
    },
  );

  it('con `modelos.ver` + `ordenes.precio-maquila` (Producción): la MAQUILA sí, el corte, el arte y el BOM no', async () => {
    await crearUsuarioCon('produccion', ['modelos.ver', 'ordenes.precio-maquila']);
    const s = await sembrarEscenario();
    const cookie = await cookieDe('produccion');

    const ficha = await get(cookie, `/api/modelos/${String(s.idModelo)}`);
    expect(ficha.body).toContain(MAQUILA);
    expect(ficha.body).toContain('"maquilaOculta":false');
    for (const precio of [...Object.values(PRECIOS_MODELO), ...Object.values(PRECIOS_BOM)]) {
      expect(ficha.body, `filtró ${precio}`).not.toContain(precio);
    }
  });

  it('con `modelos.ver` + `compras.administrar`: el BOM SÍ (ve precios de catálogo), el corte y el arte NO', async () => {
    await crearUsuarioCon('compras', ['modelos.ver', 'compras.administrar']);
    const s = await sembrarEscenario();
    const cookie = await cookieDe('compras');

    const telas = await get(cookie, `/api/modelos/${String(s.idModelo)}/bom/telas`);
    expect(telas.body).toContain(PRECIOS_BOM.telaAmarre);
    expect(telas.body).toContain(PRECIOS_BOM.telaSugerido);
    const avios = await get(cookie, `/api/modelos/${String(s.idModelo)}/bom/avios`);
    expect(avios.body).toContain(PRECIOS_BOM.avioReferencia);
    const ficha = await get(cookie, `/api/modelos/${String(s.idModelo)}`);
    expect(ficha.body).not.toContain(PRECIOS_MODELO.corte);
    expect(ficha.body).not.toContain(PRECIOS_MODELO.arte);
    expect(ficha.body).not.toContain(MAQUILA);
  });

  /**
   * H4 del reviewer: el ECO de una mutación sale con la MISMA tapa que la lectura, desde el dominio.
   * La única mutación de modelos alcanzable SIN llave de precio es la versión
   * (`modelos.aprobar-receta`): las demás exigen `modelos.administrar`, que lo ve todo.
   */
  it('el ECO de crear una VERSIÓN con `modelos.aprobar-receta` (sin llave de precio) sale tapado', async () => {
    await crearUsuarioCon('aprobador', ['modelos.ver', 'modelos.aprobar-receta']);
    await sembrarEscenario();
    const padre = await cliente.modelo.create({
      data: {
        codigo: 'CYA-26-71-249',
        codigoDesarrollo: 'CYA-26-71-249',
        origen: 'desarrollo',
        descripcion: 'Desarrollo 0.249C',
        idTipoProducto: (await cliente.tipoProducto.findFirstOrThrow({ select: { id: true } })).id,
        idGenero: (await cliente.genero.findFirstOrThrow({ select: { id: true } })).id,
        maquilaBase: MAQUILA,
        corteBase: PRECIOS_MODELO.corte,
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/modelos/${String(padre.id)}/version`,
      headers: { cookie: await cookieDe('aprobador') },
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.body).not.toContain(MAQUILA);
    expect(res.body).not.toContain(PRECIOS_MODELO.corte);
    expect(res.body).toContain('"maquilaOculta":true');
    expect(res.body).toContain('"preciosOcultos":true');
  });

  it('editar el modelo y el arte SIN mandar precios (lo que hace el formulario si no los vio) NO los borra', async () => {
    await crearUsuarioCon('admin249', ['modelos.ver', 'modelos.administrar']);
    const s = await sembrarEscenario();
    const cookie = await cookieDe('admin249');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/modelos/${String(s.idModelo)}`,
      headers: { cookie },
      payload: { descripcion: 'Cambió la descripción' },
    });
    expect(res.statusCode).toBe(200);
    const arte = await app.inject({
      method: 'PATCH',
      url: `/api/modelos/${String(s.idModelo)}/artes/${String(s.idArte)}`,
      headers: { cookie },
      payload: { descripcion: 'Logo corregido' },
    });
    expect(arte.statusCode).toBe(200);

    const enBd = await cliente.modelo.findUniqueOrThrow({ where: { id: s.idModelo } });
    expect(enBd.maquilaBase?.toFixed(2)).toBe(MAQUILA);
    expect(enBd.corteBase?.toFixed(2)).toBe(PRECIOS_MODELO.corte);
    const arteBd = await cliente.modeloArte.findUniqueOrThrow({ where: { id: s.idArte } });
    expect(arteBd.precio?.toFixed(2)).toBe(PRECIOS_MODELO.arte);
  });
});

describe('El dinero de la ORDEN por HTTP (fila 0.249 parte C)', () => {
  /** Todos los números que la receta de la orden y su resumen de precios NO pueden soltar. */
  const DE_LA_RECETA = [
    PRECIOS_ORDEN.tela,
    PRECIOS_ORDEN.avio,
    PRECIOS_ORDEN.arte,
    PRECIOS_BOM.telaAmarre, // precioModelo de la tela
    PRECIOS_BOM.medida, // precioModelo del avío (promedio de medidas) y precioMedida
    PRECIOS_MODELO.arte, // precioModelo del arte
  ];

  it.each([['ordenes.ver'], ['desarrollo.ver']] as const)(
    'con SÓLO `%s`: la receta no trae ni un precio — tampoco DENTRO del texto de los avisos',
    async (llave) => {
      await crearUsuarioCon('lector', [llave]);
      const s = await sembrarEscenario();
      const cookie = await cookieDe('lector');

      const receta = await get(cookie, `/api/ordenes/${String(s.idOrden)}/receta`);
      expect(receta.status).toBe(200);
      for (const precio of DE_LA_RECETA) {
        expect(receta.body, `la receta filtró ${precio}`).not.toContain(precio);
      }
      expect(receta.body).toContain('"preciosOcultos":true');
      // El HECHO de que el precio se movió sí llega (sin cuánto): la desalineación es real.
      expect(receta.body).toContain('cambió en el modelo');
      // Y el vocabulario: qué lleva la orden.
      expect(receta.body).toContain('Felpa 0.249C');
      expect(receta.body).toContain('CIE-0249C');
    },
  );

  it('con `ordenes.ver` + `desarrollo.administrar` A SOLAS: ve los CONGELADOS que escribe, no lo que repite del origen', async () => {
    await crearUsuarioCon('editor', ['ordenes.ver', 'desarrollo.administrar']);
    const s = await sembrarEscenario();
    const cookie = await cookieDe('editor');

    const receta = await get(cookie, `/api/ordenes/${String(s.idOrden)}/receta`);
    expect(receta.status).toBe(200);
    for (const precio of [PRECIOS_ORDEN.tela, PRECIOS_ORDEN.avio, PRECIOS_ORDEN.arte]) {
      expect(receta.body, `falta el congelado ${precio}`).toContain(precio);
    }
    for (const precio of [PRECIOS_BOM.telaAmarre, PRECIOS_BOM.medida, PRECIOS_MODELO.arte]) {
      expect(receta.body, `filtró el origen ${precio}`).not.toContain(precio);
    }
    expect(receta.body).toContain('"preciosOcultos":false');
    expect(receta.body).toContain('"precioModeloOculto":true');
    // Sin el origen, el aviso NO lleva cifras (ni la congelada).
    expect(receta.body).not.toContain(`$${PRECIOS_ORDEN.tela}`);
  });

  /**
   * 🔴 H1 del reviewer, con los permisos EXACTOS de Ventas sembrados (`desarrollo.administrar` y
   * `compras.administrar`, sin `consultas.ver-importes` ni `modelos.administrar`). Antes veía aquí el
   * precio del ARTE DEL MODELO —y en el texto del aviso— que en la ficha del modelo le sale tapado.
   */
  it('con los permisos EXACTOS de Ventas: el precio del arte del modelo no sale ni en la receta ni en su aviso — igual que en la ficha', async () => {
    const ventas = definirRoles().find((rol) => rol.nombre === 'Ventas');
    expect(ventas).toBeDefined();
    await crearUsuarioCon('ventas', [...(ventas?.permisos ?? [])] as ClavePermiso[]);
    const s = await sembrarEscenario();
    const cookie = await cookieDe('ventas');

    const receta = await get(cookie, `/api/ordenes/${String(s.idOrden)}/receta`);
    expect(receta.status).toBe(200);
    expect(receta.body, 'precio del arte del MODELO').not.toContain(PRECIOS_MODELO.arte);
    // Lo que sí ve en su origen (catálogo de tela, por compras) sí llega, con su aviso con cifras.
    expect(receta.body).toContain(PRECIOS_BOM.telaAmarre);
    expect(receta.body).toContain(`$${PRECIOS_ORDEN.tela}`);
    // Y su propio congelado del arte (lo escribe) también.
    expect(receta.body).toContain(PRECIOS_ORDEN.arte);
    expect(receta.body).not.toContain(`$${PRECIOS_ORDEN.arte}`);

    // Coherencia: en la ficha del modelo el mismo precio también le sale tapado.
    const ficha = await get(cookie, `/api/modelos/${String(s.idModelo)}`);
    expect(ficha.status).toBe(200);
    expect(ficha.body).not.toContain(PRECIOS_MODELO.arte);
  });

  it.each(['consultas.ver-importes', 'modelos.administrar'] as const)(
    'con `ordenes.ver` + %s: la receta llega completa',
    async (llave) => {
      await crearUsuarioCon('conllave', ['ordenes.ver', llave]);
      const s = await sembrarEscenario();
      const cookie = await cookieDe('conllave');
      const receta = await get(cookie, `/api/ordenes/${String(s.idOrden)}/receta`);
      for (const precio of DE_LA_RECETA) expect(receta.body).toContain(precio);
    },
  );

  it('editar un renglón de la receta SIN mandar `precio` no lo borra', async () => {
    await crearUsuarioCon('editor', ['ordenes.ver', 'desarrollo.administrar']);
    const s = await sembrarEscenario();
    const cookie = await cookieDe('editor');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/ordenes/${String(s.idOrden)}/receta/renglones/tela/${String(s.idOrdenTela)}`,
      headers: { cookie },
      payload: { consumoPorPrenda: 2 },
    });
    expect(res.statusCode, res.body).toBe(200);
    const enBd = await cliente.ordenTela.findUniqueOrThrow({ where: { id: s.idOrdenTela } });
    expect(enBd.precio?.toFixed(2)).toBe(PRECIOS_ORDEN.tela);
  });

  it('el resumen de precios: con SÓLO `ordenes.ver` la maquila de referencia va tapada; con `ordenes.precio-maquila`, no', async () => {
    await crearUsuarioCon('lector', ['ordenes.ver']);
    await crearUsuarioCon('produccion', ['ordenes.ver', 'ordenes.precio-maquila']);
    const s = await sembrarEscenario();

    const tapado = await get(await cookieDe('lector'), `/api/ordenes/${String(s.idOrden)}/precios`);
    expect(tapado.status).toBe(200);
    expect(tapado.body).not.toContain(MAQUILA);
    expect(tapado.body).toContain('"maquilaReferenciaOculta":true');

    const visible = await get(
      await cookieDe('produccion'),
      `/api/ordenes/${String(s.idOrden)}/precios`,
    );
    expect(visible.body).toContain(MAQUILA);
    expect(visible.body).toContain('"maquilaReferenciaOculta":false');
  });

  it('el histórico: con SÓLO `ordenes.ver` el precio de la habilitación va tapado; con `consultas.ver-importes`, no', async () => {
    await crearUsuarioCon('lector', ['ordenes.ver']);
    await crearUsuarioCon('importes', ['ordenes.ver', 'consultas.ver-importes']);
    const s = await sembrarEscenario();

    const tapado = await get(
      await cookieDe('lector'),
      `/api/historico-ordenes/${String(s.idHistorico)}`,
    );
    expect(tapado.status).toBe(200);
    expect(tapado.body).toContain('Botón viejo');
    expect(tapado.body).not.toContain(PRECIOS_ORDEN.historico);
    expect(tapado.body).toContain('"preciosOcultos":true');

    const visible = await get(
      await cookieDe('importes'),
      `/api/historico-ordenes/${String(s.idHistorico)}`,
    );
    expect(visible.body).toContain(PRECIOS_ORDEN.historico);
    expect(visible.body).toContain('"preciosOcultos":false');
  });
});
