/**
 * ⭐ Pruebas de integración POR HTTP del TAPADO de la bitácora (fila 0.249 parte D + fila 0.255).
 *
 * Lo que se mide: **`GET /api/admin/bitacora` no entrega ningún importe que la pantalla de ese
 * importe le niega a quien consulta**, para los roles SEMBRADOS que leen la bitácora y no tienen
 * todas las llaves (Ventas, Logistica, Asistente, Secretarial y Gerencial), con Administrador de
 * control (lo ve todo). Y que lo GUARDADO sigue completo.
 *
 * Se levanta una app Fastify con la ruta de la bitácora bajo `/api`, contra el Postgres efímero,
 * con la autenticación REAL (better-auth) y el seed real; cada usuario lleva el ROL SEMBRADO por su
 * nombre (no una copia de sus permisos). Cada cifra se busca en el TEXTO CRUDO de la respuesta: si
 * mañana se cuela por un campo nuevo, también cae.
 *
 * Los renglones de bitácora se siembran DIRECTO en la tabla, uno por entidad del mapa con una cifra
 * distinta por clave: la garantía vive en la LECTURA, no en cómo se escribió. Además se recorre un
 * escritor REAL (alta de un renglón de corrida, fila 0.255) para no medir sólo lo sembrado.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { hashPassword } from 'better-auth/crypto';

import { registrarManejadorErrores } from './errores.js';
import { rutasBitacora } from './admin/bitacora.rutas.js';
import { registrarAuth } from '../auth/plugin.js';
import type { ClavePermiso } from '../contrato/index.js';
import type { Prisma, PrismaClient } from '../datos/index.js';
import {
  MAPA_BITACORA,
  REGLAS_BITACORA,
  type ReglaBitacora,
} from '../dominio/admin/bitacora-tapado.js';
import { crearCorrida, guardarRenglonCorrida } from '../dominio/pagos/corrida.js';
import { clientePruebas, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sesionDePrueba } from '../pruebas/sesiones.js';
import { definirRoles, PERFILES_EDITABLES, sembrar } from '../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;

const PASSWORD = 'Control.2026!';

/** Los roles que se miden (los que leen la bitácora sin todas las llaves) + el de control. */
const ROLES = ['Ventas', 'Logistica', 'Asistente', 'Secretarial', 'Gerencial', 'Administrador'];

/** Permisos SEMBRADOS de un rol (para calcular qué reglas cumple). */
function permisosDe(nombre: string): readonly string[] {
  const r = [...definirRoles(), ...PERFILES_EDITABLES].find((x) => x.nombre === nombre);
  if (r === undefined) throw new Error(`No existe el rol sembrado «${nombre}».`);
  return r.permisos;
}

/** ¿El rol cumple la regla? */
function cumple(nombre: string, regla: ReglaBitacora): boolean {
  return REGLAS_BITACORA[regla](
    sesionDePrueba({ permisos: [...permisosDe(nombre)] as ClavePermiso[] }),
  );
}

/** Una cifra que no puede aparecer por casualidad en la respuesta (ni como id ni como fecha). */
function cifra(i: number): number {
  return Number(`86420${String(i).padStart(3, '0')}.19`);
}

/** Una entrada sembrada: qué cifra lleva cada (entidad, clave) y con qué regla se ve. */
interface Sembrada {
  entidad: string;
  clave: string;
  regla: ReglaBitacora;
  valor: number;
}

/** Siembra UN renglón de bitácora por entidad del mapa, con una cifra distinta por clave. */
async function sembrarBitacoraDesdeElMapa(): Promise<Sembrada[]> {
  const sembradas: Sembrada[] = [];
  let i = 0;
  for (const [entidad, claves] of Object.entries(MAPA_BITACORA)) {
    const datos: Record<string, Prisma.InputJsonValue | null> = { nota: `fila ${entidad}` };
    for (const [clave, regla] of Object.entries(claves)) {
      i += 1;
      const valor = cifra(i);
      // La mitad anidada en `{de,a}` (como la escriben las ediciones), la otra plana.
      datos[clave] = i % 2 === 0 ? { de: null, a: valor } : valor;
      sembradas.push({ entidad, clave, regla, valor });
    }
    await cliente.bitacora.create({
      data: { entidad, idEntidad: '1', accion: 'MODIFICAR', datos },
    });
  }
  return sembradas;
}

/** Crea un usuario con el ROL SEMBRADO de ese nombre. */
async function crearUsuarioConRol(username: string, nombreRol: string): Promise<void> {
  const rol = await cliente.rol.findFirstOrThrow({ where: { nombre: nombreRol } });
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

/** Lee la bitácora completa (una página) como ese usuario. */
async function leerBitacora(username: string): Promise<{
  body: string;
  total: number;
  ocultos: number;
}> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/admin/bitacora?porPagina=100',
    headers: { cookie: await cookieDe(username) },
  });
  expect(res.statusCode).toBe(200);
  const pagina = res.json<{ total: number; datos: { datosOcultos: number }[] }>();
  expect(pagina.total, 'todo cabe en una página').toBeLessThanOrEqual(100);
  return {
    body: res.body,
    total: pagina.total,
    ocultos: pagina.datos.reduce((s, r) => s + r.datosOcultos, 0),
  };
}

// ── Lo que se escribe con un escritor REAL ───────────────────────────────────────────────────────
const NOMBRE_TALLER = 'TALLER BITACORA CERO DOS CINCO CINCO';
const MONTO_CORRIDA = 48213.77;

/** Abre una corrida y le agrega un renglón por el DOMINIO (escribe `RenglonCorridaPago`). */
async function renglonDeCorridaReal(): Promise<void> {
  const empresa = await cliente.empresa.findFirstOrThrow({ select: { id: true } });
  const rolProveedor = await cliente.rolProveedor.upsert({
    where: { codigo: 'maquila-costura' },
    update: {},
    create: { codigo: 'maquila-costura', nombre: 'Maquila (costura)' },
  });
  const taller = await cliente.proveedor.create({
    data: {
      nombre: NOMBRE_TALLER,
      modalidadFacturacion: 'ambos',
      roles: { create: { idRolProveedor: rolProveedor.id } },
    },
  });
  const sesion = sesionDePrueba({
    idEmpresaActiva: empresa.id,
    permisos: ['pagos.corrida-armar', 'pagos.corrida-ver', 'consultas.ver-importes'],
  });
  const detalle = await crearCorrida(
    sesion,
    { semana: '2026-09-02', conFactura: false },
    { cliente },
  );
  await guardarRenglonCorrida(
    sesion,
    detalle.corrida.id,
    { idProveedor: taller.id, monto: MONTO_CORRIDA, formaPago: 'efectivo' },
    undefined,
    { cliente },
  );
}

/** El volcado de `eliminar-lista`: la lista con sus factores y renglones (columnas de Prisma). */
const FACTOR_MARGEN = 31.4159;
const PRECIO_APROBADO_VOLCADO = 8642999.19;
async function volcadoDeListaEliminada(): Promise<void> {
  await cliente.bitacora.create({
    data: {
      entidad: 'ListaPrecios',
      idEntidad: '77',
      accion: 'OTRO',
      datos: {
        operacion: 'eliminar-lista',
        antes: {
          margenPct: FACTOR_MARGEN,
          lineas: [{ costoUnit: 8642998.19, precioAprobado: PRECIO_APROBADO_VOLCADO }],
          eventosNegociacion: [{ acuerdo: 'texto', costos: [{ importe: 8642997.19 }] }],
        },
      },
    },
  });
}

beforeAll(async () => {
  cliente = clientePruebas();
  const instancia = Fastify({ logger: false });
  instancia.setValidatorCompiler(validatorCompiler);
  instancia.setSerializerCompiler(serializerCompiler);
  registrarManejadorErrores(instancia);
  registrarAuth(instancia, {});
  await instancia.register(rutasBitacora, { prefix: '/api' });
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

describe('La bitácora tapa los importes AL LEERLA, por HTTP, con los roles sembrados (0.249 D)', () => {
  it.each(ROLES)(
    '%s: cada cifra aparece en el texto crudo SÓLO si su pantalla se la enseña',
    async (nombreRol) => {
      const sembradas = await sembrarBitacoraDesdeElMapa();
      const username = `lector${nombreRol.toLowerCase()}`;
      await crearUsuarioConRol(username, nombreRol);

      const { body, ocultos } = await leerBitacora(username);
      // La bitácora no se volvió ciega: los registros llegan.
      expect(body).toContain('fila CostoOrden');

      let negadas = 0;
      for (const { entidad, clave, regla, valor } of sembradas) {
        const ve = cumple(nombreRol, regla);
        if (!ve) negadas += 1;
        const texto = String(valor);
        if (ve) {
          expect(body, `${nombreRol} debería ver ${entidad}.${clave}`).toContain(texto);
        } else {
          expect(body, `${nombreRol} NO debe ver ${entidad}.${clave}`).not.toContain(texto);
        }
      }
      expect(ocultos).toBe(negadas);
      if (nombreRol === 'Administrador') {
        // Control: si el administrador no lo viera todo, la prueba no distinguiría nada.
        expect(negadas).toBe(0);
      } else {
        expect(negadas).toBeGreaterThan(0);
        expect(body).toContain('"oculto":true');
      }
    },
  );

  it('Gerencial: el EDR, el costo de la orden y los factores no salen; los precios de lista sí', async () => {
    // Renglones FIJOS, independientes del mapa: si alguien borrara una regla del mapa, esta prueba
    // no se queda midiendo en vacío (las cifras están escritas aquí, no derivadas de él).
    const fijos: [string, string, number][] = [
      ['Edr', 'gastos', 7531001.11],
      ['EdrLinea', 'precioVenta', 7531002.22],
      ['CostoOrden', 'telaCost', 7531003.33],
      ['Orden', 'costoUnitarioCongelado', 7531004.44],
      ['ListaPrecios', 'margenPct', 7531005.55],
    ];
    for (const [entidad, clave, valor] of fijos) {
      await cliente.bitacora.create({
        data: { entidad, idEntidad: '9', accion: 'MODIFICAR', datos: { [clave]: valor } },
      });
    }
    await volcadoDeListaEliminada();
    await crearUsuarioConRol('gerencial', 'Gerencial');
    const { body } = await leerBitacora('gerencial');

    expect(body).toContain('costoUnitarioCongelado');
    for (const [entidad, clave, valor] of fijos) {
      expect(body, `${entidad}.${clave}`).not.toContain(String(valor));
    }
    // El volcado de una lista eliminada: el factor tapado, los precios a la vista (tiene importes).
    expect(body).not.toContain(String(FACTOR_MARGEN));
    expect(body).toContain(String(PRECIO_APROBADO_VOLCADO));
  });

  it('H3 · casos FIJOS (no derivados del mapa): EsMa y la configuración no salen a Logística', async () => {
    const fijos: [string, Record<string, Prisma.InputJsonValue>, string][] = [
      ['EsMaCargo', { precioReal: 7532001.11, cantidadReal: 40 }, '7532001.11'],
      ['PagoMaquilero', { monto: 7532002.22 }, '7532002.22'],
      ['ConfiguracionEmpresa', { utilidadSugerida: 7532003.33 }, '7532003.33'],
    ];
    for (const [entidad, datos] of fijos) {
      await cliente.bitacora.create({
        data: { entidad, idEntidad: '5', accion: 'MODIFICAR', datos },
      });
    }
    await crearUsuarioConRol('hlogistica', 'Logistica');
    const logistica = await leerBitacora('hlogistica');
    expect(logistica.body).toContain('EsMaCargo');
    // Las piezas no son dinero: siguen a la vista.
    expect(logistica.body).toContain('"cantidadReal":40');
    for (const [entidad, , cifraTexto] of fijos) {
      expect(logistica.body, entidad).not.toContain(cifraTexto);
    }
    expect(logistica.ocultos).toBe(3);
    // Control: el Administrador las ve.
    await crearUsuarioConRol('hadmin', 'Administrador');
    const admin = await leerBitacora('hadmin');
    for (const [entidad, , cifraTexto] of fijos) expect(admin.body, entidad).toContain(cifraTexto);
  });

  it('H1 · los factores descartados al fusionar departamentos (entidad Cliente) no salen a Gerencial', async () => {
    await cliente.bitacora.create({
      data: {
        entidad: 'Cliente',
        idEntidad: '3',
        accion: 'OTRO',
        datos: {
          departamento: 'fusionar',
          descartados: [
            {
              margenPct: 7533001.11,
              descuentosPct: 7533002.22,
              regaliasPct: 7533003.33,
              costoVentasPct: 7533004.44,
              porQue: 'ganan los suyos',
            },
          ],
        },
      },
    });
    await crearUsuarioConRol('fgerencial', 'Gerencial');
    const { body } = await leerBitacora('fgerencial');
    expect(body).toContain('ganan los suyos');
    for (const cifraTexto of ['7533001.11', '7533002.22', '7533003.33', '7533004.44']) {
      expect(body, cifraTexto).not.toContain(cifraTexto);
    }
  });

  it('DEFAULT por nombre: una clave de dinero que NADIE declaró se tapa a quien no ve importes', async () => {
    await cliente.bitacora.create({
      data: {
        entidad: 'EntidadQueNadieDeclaro',
        idEntidad: '1',
        accion: 'CREAR',
        datos: { descripcion: 'empaque nuevo', costoDeEmpaqueNuevo: 7539999.99 },
      },
    });
    await crearUsuarioConRol('dventas', 'Ventas');
    const ventas = await leerBitacora('dventas');
    expect(ventas.body).toContain('empaque nuevo');
    expect(ventas.body).not.toContain('7539999.99');
    expect(ventas.ocultos).toBe(1);
    // Control: con `consultas.ver-importes` (Gerencial) se ve.
    await crearUsuarioConRol('dgerencial', 'Gerencial');
    expect((await leerBitacora('dgerencial')).body).toContain('7539999.99');
  });

  it('Ventas/Logistica: el volcado de una lista eliminada no deja ver ni precios ni factores (default por nombre)', async () => {
    await volcadoDeListaEliminada();
    for (const nombreRol of ['Ventas', 'Logistica']) {
      const username = `v${nombreRol.toLowerCase()}`;
      await crearUsuarioConRol(username, nombreRol);
      const { body } = await leerBitacora(username);
      expect(body).toContain('eliminar-lista');
      for (const secreto of [FACTOR_MARGEN, PRECIO_APROBADO_VOLCADO, 8642998.19, 8642997.19]) {
        expect(body, `${nombreRol}: ${String(secreto)}`).not.toContain(String(secreto));
      }
    }
  });

  it('0.255 · escritor REAL: el renglón de corrida no dice a quién ni cuánto a quien no tiene su llave', async () => {
    await renglonDeCorridaReal();
    for (const nombreRol of ['Ventas', 'Logistica', 'Asistente', 'Secretarial']) {
      const username = `c${nombreRol.toLowerCase()}`;
      await crearUsuarioConRol(username, nombreRol);
      const { body } = await leerBitacora(username);
      expect(body).toContain('RenglonCorridaPago');
      expect(body, nombreRol).not.toContain(NOMBRE_TALLER);
      expect(body, nombreRol).not.toContain(String(MONTO_CORRIDA));
    }
    // Control: quien tiene la llave de la corrida y ve importes lo ve todo.
    await crearUsuarioConRol('cgerencial', 'Gerencial');
    const { body } = await leerBitacora('cgerencial');
    expect(body).toContain(NOMBRE_TALLER);
    expect(body).toContain(String(MONTO_CORRIDA));
  });

  it('lo GUARDADO sigue completo: la lectura tapada no toca la tabla', async () => {
    const sembradas = await sembrarBitacoraDesdeElMapa();
    await renglonDeCorridaReal();
    await crearUsuarioConRol('lectorventas', 'Ventas');
    const { ocultos } = await leerBitacora('lectorventas');
    expect(ocultos).toBeGreaterThan(0);

    const guardado = JSON.stringify(await cliente.bitacora.findMany({ select: { datos: true } }));
    for (const { valor } of sembradas) expect(guardado).toContain(String(valor));
    expect(guardado).toContain(NOMBRE_TALLER);
    expect(guardado).toContain(String(MONTO_CORRIDA));
    expect(guardado).not.toContain('oculto');
  });
});
