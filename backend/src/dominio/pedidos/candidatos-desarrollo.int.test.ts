/**
 * Tests de INTEGRACIÓN de los CANDIDATOS DE DESARROLLO del constructor (rediseño R3, B6) contra
 * el Postgres efímero (la extensión `unaccent` viene de la migración R2). Cubre: búsqueda SIN
 * acentos por código/descripción del modelo, nº del cliente, proyecto y cliente; el scope A9
 * (empresa activa); la exclusión de apagados; el filtro por cliente; y el permiso.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { ErrorPermiso } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { candidatosDesarrollo } from './candidatos-desarrollo.js';

let cliente: PrismaClient;
let idEmpresa: number;
let idOtraEmpresa: number;
let idClienteNegocio: number;

const sesion = () =>
  sesionDePrueba({ idEmpresaActiva: idEmpresa, permisos: ['pedidos.administrar'] });
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
  const otra = await crearEmpresaPrueba(cliente, 'Marilyn Fitness');
  idOtraEmpresa = otra.id;
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Cañón Textil' } });
  idClienteNegocio = clienteNegocio.id;
});

/** Siembra un desarrollo completo (modelo + depto + proyecto). Devuelve su id. */
async function sembrarDesarrollo(opciones: {
  codigo: string;
  descripcion?: string;
  numeroCliente?: string;
  proyecto?: string;
  apagado?: boolean;
  idEmpresaProyecto?: number;
  idClienteProyecto?: number;
}): Promise<number> {
  const idClienteProy = opciones.idClienteProyecto ?? idClienteNegocio;
  const modelo = await cliente.modelo.create({
    data: { codigo: opciones.codigo, descripcion: opciones.descripcion ?? null },
  });
  const depto = await cliente.clienteDepartamento.create({
    data: { idCliente: idClienteProy, nombre: `Depto ${opciones.codigo}` },
  });
  const proyecto = await cliente.proyecto.create({
    data: {
      folio: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
      idEmpresa: opciones.idEmpresaProyecto ?? idEmpresa,
      idCliente: idClienteProy,
      idClienteDepartamento: depto.id,
      nombre: opciones.proyecto ?? 'Básicos',
    },
  });
  const desarrollo = await cliente.desarrollo.create({
    data: {
      idProyecto: proyecto.id,
      idModelo: modelo.id,
      numeroCliente: opciones.numeroCliente ?? null,
      apagado: opciones.apagado ?? false,
    },
  });
  return desarrollo.id;
}

describe('candidatosDesarrollo (R3, B6)', () => {
  it('exige pedidos.administrar', async () => {
    await expect(
      candidatosDesarrollo(sesionDePrueba({ idEmpresaActiva: 1, permisos: [] }), {}, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('busca SIN acentos por descripción del modelo, nº del cliente, proyecto y cliente', async () => {
    const idCereza = await sembrarDesarrollo({
      codigo: 'KM-114',
      descripcion: 'Playera Algodón Cereza',
      numeroCliente: 'CA-KM-114',
      proyecto: 'Niños PV26',
    });
    await sembrarDesarrollo({ codigo: 'KM-115', descripcion: 'Short felpa' });

    // "algodon" (sin acento) encuentra "Algodón".
    const porDescripcion = await candidatosDesarrollo(sesion(), { busqueda: 'algodon' }, bd());
    expect(porDescripcion.map((c) => c.idDesarrollo)).toEqual([idCereza]);

    // Por nº del cliente.
    const porNumero = await candidatosDesarrollo(sesion(), { busqueda: 'ca-km-114' }, bd());
    expect(porNumero.map((c) => c.idDesarrollo)).toEqual([idCereza]);

    // "ninos" (sin ñ) encuentra el proyecto "Niños PV26" (unaccent pliega la ñ).
    const porProyecto = await candidatosDesarrollo(sesion(), { busqueda: 'ninos' }, bd());
    expect(porProyecto.map((c) => c.idDesarrollo)).toEqual([idCereza]);

    // "canon" encuentra a "Cañón Textil" (los DOS desarrollos son de ese cliente).
    const porCliente = await candidatosDesarrollo(sesion(), { busqueda: 'canon' }, bd());
    expect(porCliente).toHaveLength(2);

    // La proyección trae lo que el selector muestra.
    const candidato = porDescripcion[0];
    expect(candidato?.codigoModelo).toBe('KM-114');
    expect(candidato?.numeroCliente).toBe('CA-KM-114');
    expect(candidato?.nombreProyecto).toBe('Niños PV26');
    expect(candidato?.nombreCliente).toBe('Cañón Textil');
    expect(candidato?.numeroProduccion).toBeNull();
    expect(candidato?.precioSugerido).toBeNull(); // sin lista de precios ni permiso de importes
  });

  it('excluye apagados y desarrollos de OTRA empresa (A9); filtra por cliente', async () => {
    const idVivo = await sembrarDesarrollo({ codigo: 'V-1' });
    await sembrarDesarrollo({ codigo: 'V-2', apagado: true });
    await sembrarDesarrollo({ codigo: 'V-3', idEmpresaProyecto: idOtraEmpresa });
    const otroCliente = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
    const idDeOtro = await sembrarDesarrollo({ codigo: 'V-4', idClienteProyecto: otroCliente.id });

    const todos = await candidatosDesarrollo(sesion(), {}, bd());
    expect(todos.map((c) => c.idDesarrollo).sort((a, b) => a - b)).toEqual(
      [idVivo, idDeOtro].sort((a, b) => a - b),
    );

    const deCliente = await candidatosDesarrollo(sesion(), { idCliente: idClienteNegocio }, bd());
    expect(deCliente.map((c) => c.idDesarrollo)).toEqual([idVivo]);
  });
});
