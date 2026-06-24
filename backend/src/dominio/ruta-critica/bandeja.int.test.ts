/**
 * Tests de INTEGRACIÓN de la BANDEJA "mis tareas" + el conteo de alertas de la RC (F5-E5). Postgres
 * efímero (testcontainers). Cubre:
 *  • (a) un proceso con 2 antecesores, uno incompleto, NO aparece (no está 'activo').
 *  • (b) un usuario con un rol SECUNDARIO del proceso SÍ lo ve en su bandeja.
 *  • (c) `todas=true` (con permiso de supervisión) ve tareas de OTROS roles.
 *  • (d) el conteo de alertas cuenta atrasados / enRiesgo correctamente.
 *  • (e) `capturadoPorNombre` se resuelve en el GET de la ruta (campo aditivo del timeline).
 *  • scope por empresa (A9) y filtros opcionales.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { consultarBandeja, contarAlertas } from './bandeja.js';
import { completarProceso } from './cumplimiento.js';
import { obtenerRutaOrden } from './rutaOrden.js';

let cliente: PrismaClient;
let idEmpresa: number;

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

/** Crea una orden con RC activa (cliente + modelo) y devuelve { idOrden }. */
async function crearOrdenConRc(opciones?: {
  nombreCliente?: string;
  fechaEntregaRC?: string;
}): Promise<number> {
  const clienteNeg = await cliente.cliente.create({
    data: { nombre: opciones?.nombreCliente ?? `C ${String(Date.now())}-${String(Math.random())}` },
  });
  const modelo = await cliente.modelo.create({
    data: { codigo: `M-${String(Math.random())}`, descripcion: 'Modelo X' },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(Math.floor(Math.random() * 1_000_000)),
      idEmpresa,
      idModelo: modelo.id,
      idCliente: clienteNeg.id,
      rcActiva: true,
      ...(opciones?.fechaEntregaRC === undefined
        ? {}
        : { fechaEntregaRC: new Date(`${opciones.fechaEntregaRC}T00:00:00Z`) }),
    },
  });
  return orden.id;
}

async function crearProcesoDef(codigo: string): Promise<number> {
  const p = await cliente.procesoDef.create({ data: { codigo, nombre: codigo.toUpperCase() } });
  return p.id;
}

async function crearRenglon(
  idOrden: number,
  idProcesoDef: number,
  opciones: {
    secuencia: number;
    estado?: 'pendiente' | 'activo' | 'completado';
    fechaPlaneadaVigente?: string | null;
    ultimoProceso?: boolean;
  },
): Promise<number> {
  const r = await cliente.rutaOrden.create({
    data: {
      idOrden,
      idProcesoDef,
      secuencia: opciones.secuencia,
      duracionDias: 1,
      estado: opciones.estado ?? 'pendiente',
      ultimoProceso: opciones.ultimoProceso ?? false,
      ...(opciones.fechaPlaneadaVigente === undefined || opciones.fechaPlaneadaVigente === null
        ? {}
        : { fechaPlaneadaVigente: new Date(`${opciones.fechaPlaneadaVigente}T00:00:00Z`) }),
    },
  });
  return r.id;
}

async function ligar(idRuta: number, idAntecesor: number): Promise<void> {
  await cliente.rutaOrdenDep.create({ data: { idRutaOrden: idRuta, idAntecesor } });
}

/** Crea un rol y un usuario que lo tiene; devuelve { idRol, idUsuario }. */
async function crearUsuarioConRol(
  username: string,
  nombreRol: string,
): Promise<{ idRol: number; idUsuario: string }> {
  const rol = await cliente.rol.create({ data: { nombre: nombreRol, descripcion: 'x' } });
  const usuario = await cliente.usuario.create({
    data: {
      username,
      nombre: `Usuario ${username}`,
      email: `${username}@x.local`,
      roles: { create: [{ idRol: rol.id }] },
    },
  });
  return { idRol: rol.id, idUsuario: usuario.id };
}

const hoy = new Date('2026-06-22T00:00:00Z');

describe('consultarBandeja — "mis tareas"', () => {
  it('(a) un proceso con 2 antecesores, uno incompleto, NO aparece (no está activo)', async () => {
    const idOrden = await crearOrdenConRc();
    const a = await crearProcesoDef('a');
    const b = await crearProcesoDef('b');
    const c = await crearProcesoDef('c');
    const ra = await crearRenglon(idOrden, a, { secuencia: 0, estado: 'completado' });
    const rb = await crearRenglon(idOrden, b, { secuencia: 1, estado: 'activo' });
    // c depende de a (completado) y b (activo, sin completar) → c sigue 'pendiente'.
    const rc = await crearRenglon(idOrden, c, { secuencia: 2, estado: 'pendiente' });
    await ligar(rc, ra);
    await ligar(rc, rb);

    const { idRol } = await crearUsuarioConRol('todero', 'Todero');
    // El rol es responsable de TODOS los procesos.
    for (const p of [a, b, c]) {
      await cliente.procesoDefRol.create({ data: { idProcesoDef: p, idRol } });
    }
    const usuario = await cliente.usuario.findFirstOrThrow({ where: { username: 'todero' } });
    const sesion = sesionDePrueba({
      id: usuario.id,
      idEmpresaActiva: idEmpresa,
      permisos: ['rc.ruta-ver'],
    });

    const pagina = await consultarBandeja(sesion, {}, bd(), hoy);
    const ids = pagina.datos.map((t) => t.idRutaOrden);
    expect(ids).toContain(rb); // b está activo → aparece.
    expect(ids).not.toContain(rc); // c pendiente (falta b) → NO aparece.
    expect(ids).not.toContain(ra); // a completado → no es tarea.
  });

  it('(b) un usuario con un rol SECUNDARIO del proceso SÍ lo ve', async () => {
    const idOrden = await crearOrdenConRc();
    const proc = await crearProcesoDef('corte');
    const idRuta = await crearRenglon(idOrden, proc, { secuencia: 0, estado: 'activo' });

    // El proceso tiene DOS roles responsables; el usuario solo tiene el SEGUNDO.
    const rolPrincipal = await cliente.rol.create({
      data: { nombre: 'Principal', descripcion: 'x' },
    });
    const { idRol: rolSecundario, idUsuario } = await crearUsuarioConRol('aux', 'Secundario');
    await cliente.procesoDefRol.create({ data: { idProcesoDef: proc, idRol: rolPrincipal.id } });
    await cliente.procesoDefRol.create({ data: { idProcesoDef: proc, idRol: rolSecundario } });

    const sesion = sesionDePrueba({
      id: idUsuario,
      idEmpresaActiva: idEmpresa,
      permisos: ['rc.ruta-ver'],
    });
    const pagina = await consultarBandeja(sesion, {}, bd(), hoy);
    expect(pagina.datos.map((t) => t.idRutaOrden)).toEqual([idRuta]);
  });

  it('un usuario SIN rol responsable NO ve la tarea (pero con todas=true + supervisión sí)', async () => {
    const idOrden = await crearOrdenConRc();
    const proc = await crearProcesoDef('corte');
    const idRuta = await crearRenglon(idOrden, proc, { secuencia: 0, estado: 'activo' });
    const rolDelProceso = await cliente.rol.create({
      data: { nombre: 'Cortadores', descripcion: 'x' },
    });
    await cliente.procesoDefRol.create({ data: { idProcesoDef: proc, idRol: rolDelProceso.id } });

    // Usuario SIN ese rol.
    const { idUsuario } = await crearUsuarioConRol('forastero', 'OtraCosa');
    const base = sesionDePrueba({
      id: idUsuario,
      idEmpresaActiva: idEmpresa,
      permisos: ['rc.ruta-ver'],
    });
    expect((await consultarBandeja(base, {}, bd(), hoy)).datos).toHaveLength(0);

    // (c) Con todas=true Y permiso de supervisión (rc.programar) sí la ve.
    const supervisor = sesionDePrueba({
      id: idUsuario,
      idEmpresaActiva: idEmpresa,
      permisos: ['rc.ruta-ver', 'rc.programar'],
    });
    const conTodas = await consultarBandeja(supervisor, { todas: true }, bd(), hoy);
    expect(conTodas.datos.map((t) => t.idRutaOrden)).toEqual([idRuta]);

    // Sin el permiso de supervisión, todas=true se IGNORA (sigue acotado a lo propio = nada).
    const sinPermiso = await consultarBandeja(base, { todas: true }, bd(), hoy);
    expect(sinPermiso.datos).toHaveLength(0);
  });

  it('el admin (roles.administrar) ve todas las tareas activas sin filtro de rol', async () => {
    const idOrden = await crearOrdenConRc();
    const proc = await crearProcesoDef('corte');
    const idRuta = await crearRenglon(idOrden, proc, { secuencia: 0, estado: 'activo' });
    // Sin roles responsables definidos.
    const admin = sesionDePrueba({
      idEmpresaActiva: idEmpresa,
      permisos: ['rc.ruta-ver', 'roles.administrar'],
    });
    const pagina = await consultarBandeja(admin, {}, bd(), hoy);
    expect(pagina.datos.map((t) => t.idRutaOrden)).toEqual([idRuta]);
  });

  it('scope por empresa (A9): no muestra tareas de otra empresa', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra SA');
    const clienteNeg = await cliente.cliente.create({ data: { nombre: 'CliOtra' } });
    const modelo = await cliente.modelo.create({ data: { codigo: 'M-OTRA', descripcion: 'x' } });
    const ordenOtra = await cliente.orden.create({
      data: {
        folio: 12_345n,
        idEmpresa: otra.id,
        idModelo: modelo.id,
        idCliente: clienteNeg.id,
        rcActiva: true,
      },
    });
    const proc = await crearProcesoDef('corte');
    await crearRenglon(ordenOtra.id, proc, { secuencia: 0, estado: 'activo' });

    const admin = sesionDePrueba({
      idEmpresaActiva: idEmpresa, // empresa por defecto del test, NO `otra`.
      permisos: ['rc.ruta-ver', 'roles.administrar'],
    });
    expect((await consultarBandeja(admin, {}, bd(), hoy)).datos).toHaveLength(0);
  });

  it('filtra por busquedaCliente e idOrden', async () => {
    const idOrden1 = await crearOrdenConRc({ nombreCliente: 'Boutique Aurora' });
    const idOrden2 = await crearOrdenConRc({ nombreCliente: 'Tienda Zeta' });
    const proc = await crearProcesoDef('corte');
    const r1 = await crearRenglon(idOrden1, proc, { secuencia: 0, estado: 'activo' });
    const r2 = await crearRenglon(idOrden2, proc, { secuencia: 0, estado: 'activo' });
    const admin = sesionDePrueba({
      idEmpresaActiva: idEmpresa,
      permisos: ['rc.ruta-ver', 'roles.administrar'],
    });

    const porCliente = await consultarBandeja(admin, { busquedaCliente: 'aurora' }, bd(), hoy);
    expect(porCliente.datos.map((t) => t.idRutaOrden)).toEqual([r1]);

    const porOrden = await consultarBandeja(admin, { idOrden: idOrden2 }, bd(), hoy);
    expect(porOrden.datos.map((t) => t.idRutaOrden)).toEqual([r2]);
  });

  it('ordena por urgencia: atrasado primero', async () => {
    const idOrden = await crearOrdenConRc();
    const a = await crearProcesoDef('a');
    const b = await crearProcesoDef('b');
    const rAtiempo = await crearRenglon(idOrden, a, {
      secuencia: 0,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-07-15', // lejos → aTiempo
    });
    const rAtrasado = await crearRenglon(idOrden, b, {
      secuencia: 1,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-06-10', // vencido → atrasado
    });
    const admin = sesionDePrueba({
      idEmpresaActiva: idEmpresa,
      permisos: ['rc.ruta-ver', 'roles.administrar'],
    });
    const pagina = await consultarBandeja(admin, {}, bd(), hoy);
    expect(pagina.datos[0]?.idRutaOrden).toBe(rAtrasado);
    expect(pagina.datos[1]?.idRutaOrden).toBe(rAtiempo);
    expect(pagina.datos[0]?.semaforo).toBe('atrasado');
    expect(pagina.datos[0]?.diasAtraso).toBeGreaterThan(0);
  });
});

describe('contarAlertas', () => {
  it('(d) cuenta atrasados / enRiesgo de mis tareas activas', async () => {
    const idOrden = await crearOrdenConRc();
    const a = await crearProcesoDef('a');
    const b = await crearProcesoDef('b');
    const c = await crearProcesoDef('c');
    await crearRenglon(idOrden, a, {
      secuencia: 0,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-06-10', // atrasado
    });
    await crearRenglon(idOrden, b, {
      secuencia: 1,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-06-24', // dentro de 3 días → enRiesgo
    });
    await crearRenglon(idOrden, c, {
      secuencia: 2,
      estado: 'activo',
      fechaPlaneadaVigente: '2026-07-15', // aTiempo (no cuenta)
    });

    const admin = sesionDePrueba({
      idEmpresaActiva: idEmpresa,
      permisos: ['rc.ruta-ver', 'roles.administrar'],
    });
    const conteo = await contarAlertas(admin, bd(), hoy);
    expect(conteo).toEqual({ atrasados: 1, enRiesgo: 1 });
  });
});

describe('capturadoPorNombre en GET ruta (aditivo, F5-E5)', () => {
  it('(e) resuelve el nombre de quién capturó el proceso', async () => {
    const idOrden = await crearOrdenConRc({ fechaEntregaRC: '2026-06-29' });
    const proc = await crearProcesoDef('corte');
    const idRuta = await crearRenglon(idOrden, proc, { secuencia: 0, estado: 'activo' });

    // Usuario con rol responsable que captura el proceso.
    const { idRol, idUsuario } = await crearUsuarioConRol('capturador', 'Cortadores');
    await cliente.procesoDefRol.create({ data: { idProcesoDef: proc, idRol } });
    const usuario = await cliente.usuario.findFirstOrThrow({ where: { id: idUsuario } });

    const sesionCaptura = sesionDePrueba({
      id: idUsuario,
      nombre: usuario.nombre,
      idEmpresaActiva: idEmpresa,
      permisos: ['rc.capturar'],
    });
    await completarProceso(sesionCaptura, idRuta, new Date('2026-06-20T00:00:00Z'), bd());

    const lector = sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: ['rc.ruta-ver'] });
    const ruta = await obtenerRutaOrden(lector, idOrden, bd());
    const renglon = ruta.procesos.find((p) => p.id === idRuta);
    expect(renglon?.capturadoPorId).toBe(idUsuario);
    expect(renglon?.capturadoPorNombre).toBe(usuario.nombre);
  });

  it('capturadoPorNombre es null si el proceso no se ha capturado', async () => {
    const idOrden = await crearOrdenConRc();
    const proc = await crearProcesoDef('corte');
    const idRuta = await crearRenglon(idOrden, proc, { secuencia: 0, estado: 'activo' });
    const lector = sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: ['rc.ruta-ver'] });
    const ruta = await obtenerRutaOrden(lector, idOrden, bd());
    const renglon = ruta.procesos.find((p) => p.id === idRuta);
    expect(renglon?.capturadoPorNombre).toBeNull();
  });
});
