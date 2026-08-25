/**
 * Integración de la COTIZACIÓN (V1-E7c, §Post-F9.109) contra el Postgres efímero (testcontainers):
 * el DOCUMENTO que se le manda al cliente, con base de datos de verdad.
 *
 * Cubre lo que sólo se puede probar contra la base:
 *  • 🔴 **El CONGELADO de verdad**: se emite, se MUEVE el precio en la lista, y la cotización sigue
 *    diciendo lo de antes al releerla. Es LA prueba de la etapa.
 *  • 🔴 **Los cinco modelos completos**: aunque en la segunda vuelta sólo cambien algunos, la
 *    cotización nueva vuelve a llevar TODOS.
 *  • **Folio A3** consecutivo por empresa, con el unique `(idEmpresa, folio)` real detrás.
 *  • **Inmutabilidad + cancelación** como registro (nunca borrado), y el `Restrict` que impide
 *    quitar de la lista —o borrar la lista— algo ya cotizado.
 *  • **Scope por empresa (A9)** y el guard de "precio sin aprobar".
 *
 * NO corre en local (Docker prohibido): la juzga CI.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Cliente,
  ClienteDepartamento,
  Empresa,
  PrismaClient,
  Tela,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { guardarFactoresCliente } from './cliente-factores.js';
import {
  cancelarCotizacion,
  emitirCotizacion,
  listarCotizaciones,
  obtenerCotizacion,
} from './cotizaciones.js';
import { crearDesarrollo } from './desarrollos.js';
import {
  ajustarPrecioLinea,
  aprobarLinea,
  crearLista,
  eliminarLista,
  quitarLineaLista,
} from './listas-precios.js';
import { congelarVersion, generarPrecosto } from './precostos.js';
import { crearProyecto } from './proyectos.js';

let cliente: PrismaClient;
let empresa: Empresa;
let clienteNegocio: Cliente;
let departamento: ClienteDepartamento;

const PERM: ClavePermiso[] = [
  'desarrollo.ver',
  'desarrollo.administrar',
  'desarrollo.precostear',
  'listas.ver',
  'listas.administrar',
  'listas.aprobar',
  'listas.negociar',
  'consultas.ver-importes',
];
const bd = () => ({ cliente });
function sesion(permisos: ClavePermiso[] = PERM): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
}

/** Siembra los conceptos base y el estado `abierta` (los del seed de F8-E1). */
async function sembrarBase(): Promise<void> {
  const conceptos = [
    { codigo: 'tela', nombre: 'Tela', orden: 1, fijo: true },
    { codigo: 'avios', nombre: 'Avíos', orden: 2, fijo: true },
    { codigo: 'maquila', nombre: 'Maquila', orden: 3, fijo: true },
    { codigo: 'corte', nombre: 'Corte', orden: 8, fijo: true },
  ];
  for (const c of conceptos) {
    await cliente.conceptoCosto.create({ data: c });
  }
  await cliente.estadoLista.create({
    data: { codigo: 'abierta', nombre: 'Abierta', orden: 1, esCierre: false },
  });
  await guardarFactoresCliente(
    sesion(),
    clienteNegocio.id,
    { margenPct: 50, descuentosPct: 10, regaliasPct: 5, costoVentasPct: 5 },
    bd(),
  );
}

/** Desarrollo con precosto CONGELADO de costoTotal = 40 (tela 1.5×20 + maquila 10). */
async function desarrolloConPrecosto(codigoModelo: string): Promise<number> {
  const tela: Tela = await cliente.tela.create({
    data: { nombre: `Felpa ${codigoModelo}`, precioSugerido: 20 },
  });
  const modelo = await cliente.modelo.create({
    data: {
      codigo: codigoModelo,
      descripcion: `Modelo ${codigoModelo}`,
      maquilaBase: 10,
      telas: { create: [{ idTela: tela.id, consumoPorPrenda: 1.5 }] },
    },
  });
  const proyecto = await crearProyecto(
    sesion(),
    {
      idCliente: clienteNegocio.id,
      idClienteDepartamento: departamento.id,
      nombre: `Proyecto ${codigoModelo}`,
    },
    bd(),
  );
  const desarrollo = await crearDesarrollo(sesion(), proyecto.id, { idModelo: modelo.id }, bd());
  const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());
  await congelarVersion(sesion(), precosto.id, bd());
  return desarrollo.id;
}

/** Crea una lista con N modelos y (opcionalmente) aprueba TODOS sus renglones. */
async function listaConModelos(
  codigos: string[],
  aprobarTodos = true,
): Promise<{ idLista: number; idsLinea: number[] }> {
  const idsDesarrollo: number[] = [];
  for (const codigo of codigos) {
    idsDesarrollo.push(await desarrolloConPrecosto(codigo));
  }
  const lista = await crearLista(
    sesion(),
    {
      idCliente: clienteNegocio.id,
      idClienteDepartamento: departamento.id,
      idsDesarrollo,
    },
    bd(),
  );
  if (aprobarTodos) {
    for (const linea of lista.lineas) {
      await aprobarLinea(sesion(), linea.id, bd());
    }
  }
  return { idLista: lista.id, idsLinea: lista.lineas.map((l) => l.id) };
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'C&A' } });
  departamento = await cliente.clienteDepartamento.create({
    data: { idCliente: clienteNegocio.id, nombre: 'NIÑOS' },
  });
  await sembrarBase();
});

describe('emitirCotizacion — el papel que sale de la mesa', () => {
  it('emite con TODOS los modelos de la lista, congelando precio, código y versión de receta', async () => {
    const { idLista } = await listaConModelos(['MOD-A', 'MOD-B', 'MOD-C', 'MOD-D', 'MOD-E']);

    const cotizacion = await emitirCotizacion(
      sesion(),
      { idLista, fecha: '2026-03-12', notas: 'Vigencia 30 días' },
      bd(),
    );

    expect(cotizacion.folio).toBe(1);
    expect(cotizacion.estado).toBe('emitida');
    expect(cotizacion.fecha).toBe('2026-03-12');
    expect(cotizacion.notas).toBe('Vigencia 30 días');
    expect(cotizacion.nombreCliente).toBe('C&A');
    expect(cotizacion.nombreDepartamento).toBe('NIÑOS');
    expect(cotizacion.lineas).toHaveLength(5);
    // Costo 40 con factores 50/10/5/5 ⇒ precio calculado 100 (aprobado tal cual).
    expect(cotizacion.lineas.map((l) => l.precioUnit)).toEqual([100, 100, 100, 100, 100]);
    expect(cotizacion.lineas.map((l) => l.codigoModelo)).toEqual([
      'MOD-A',
      'MOD-B',
      'MOD-C',
      'MOD-D',
      'MOD-E',
    ]);
    expect(cotizacion.lineas[0]?.descripcionModelo).toBe('Modelo MOD-A');
    expect(cotizacion.lineas[0]?.versionPrecosto).toBe(1);
    expect(cotizacion.total).toBe(500);
  });

  it('🔴 mover el precio de la LISTA después de emitir NO cambia la cotización', async () => {
    const { idLista, idsLinea } = await listaConModelos(['MOD-A', 'MOD-B']);
    const cotizacion = await emitirCotizacion(sesion(), { idLista }, bd());
    expect(cotizacion.lineas.map((l) => l.precioUnit)).toEqual([100, 100]);

    // La mesa sigue negociando: el primer renglón baja a 77 y el modelo se renombra.
    const idLinea = idsLinea[0];
    if (idLinea === undefined) {
      throw new Error('La lista de prueba no trajo renglones.');
    }
    await ajustarPrecioLinea(sesion(), idLinea, { precio: 77 }, bd());
    await cliente.modelo.updateMany({
      where: { codigo: 'MOD-A' },
      data: { codigo: 'MOD-A-V2', descripcion: 'Renombrado' },
    });

    // El documento emitido se relee IGUAL: es la foto de aquel momento.
    const releida = await obtenerCotizacion(sesion(), cotizacion.id, bd());
    expect(releida.lineas.map((l) => l.precioUnit)).toEqual([100, 100]);
    expect(releida.lineas[0]?.codigoModelo).toBe('MOD-A');
    expect(releida.lineas[0]?.descripcionModelo).toBe('Modelo MOD-A');
    expect(releida.total).toBe(200);
  });

  it('🔴 la segunda vuelta lleva LOS CINCO otra vez, con los precios nuevos', async () => {
    const { idLista, idsLinea } = await listaConModelos(['M1', 'M2', 'M3', 'M4', 'M5']);
    const primera = await emitirCotizacion(sesion(), { idLista }, bd());

    // Sólo cambian TRES de los cinco.
    for (const idLinea of idsLinea.slice(0, 3)) {
      await ajustarPrecioLinea(sesion(), idLinea, { precio: 88 }, bd());
    }
    const segunda = await emitirCotizacion(sesion(), { idLista }, bd());

    expect(segunda.folio).toBe(2);
    // Los cinco, no los tres que cambiaron: el cliente la lee sola.
    expect(segunda.lineas).toHaveLength(5);
    expect(segunda.lineas.map((l) => l.precioUnit)).toEqual([88, 88, 88, 100, 100]);
    // Y la primera sigue intacta.
    const primeraRe = await obtenerCotizacion(sesion(), primera.id, bd());
    expect(primeraRe.lineas.map((l) => l.precioUnit)).toEqual([100, 100, 100, 100, 100]);
  });

  it('🔴 rechaza emitir si algún renglón NO tiene precio aprobado, y lo nombra', async () => {
    const { idLista } = await listaConModelos(['MOD-A', 'MOD-B'], false);
    await expect(emitirCotizacion(sesion(), { idLista }, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    let mensaje = '';
    try {
      await emitirCotizacion(sesion(), { idLista }, bd());
    } catch (error) {
      mensaje = error instanceof Error ? error.message : '';
    }
    expect(mensaje).toContain('MOD-A');
    expect(mensaje).toContain('MOD-B');
    // Y no quemó folio: al emitir bien después, el primero es el 1.
    const lista = await cliente.listaPreciosLinea.findMany({ where: { idLista } });
    for (const linea of lista) {
      await aprobarLinea(sesion(), linea.id, bd());
    }
    const ok = await emitirCotizacion(sesion(), { idLista }, bd());
    expect(ok.folio).toBe(1);
  });

  it('folio A3 consecutivo por empresa (el unique (idEmpresa, folio) lo respalda)', async () => {
    const { idLista } = await listaConModelos(['MOD-A']);
    const primera = await emitirCotizacion(sesion(), { idLista }, bd());
    const segunda = await emitirCotizacion(sesion(), { idLista }, bd());
    const tercera = await emitirCotizacion(sesion(), { idLista }, bd());
    expect([primera.folio, segunda.folio, tercera.folio]).toEqual([1, 2, 3]);
  });

  it('A9 — una lista de otra empresa no existe: 404', async () => {
    const { idLista } = await listaConModelos(['MOD-A']);
    const otra = sesionDePrueba({ idEmpresaActiva: empresa.id + 999, permisos: PERM });
    await expect(emitirCotizacion(otra, { idLista }, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });
});

describe('cancelarCotizacion — sello, nunca borrado', () => {
  it('cancela con motivo y conserva íntegro el contenido del documento', async () => {
    const { idLista } = await listaConModelos(['MOD-A', 'MOD-B']);
    const cotizacion = await emitirCotizacion(sesion(), { idLista }, bd());

    const cancelada = await cancelarCotizacion(
      sesion(),
      cotizacion.id,
      { motivo: 'El cliente cambió la curva de tallas' },
      bd(),
    );

    expect(cancelada.estado).toBe('cancelada');
    expect(cancelada.motivoCancelacion).toBe('El cliente cambió la curva de tallas');
    expect(cancelada.canceladaPorId).toBe('usuario-prueba');
    expect(cancelada.canceladaEn).not.toBeNull();
    // El papel sigue diciendo lo que decía.
    expect(cancelada.lineas).toHaveLength(2);
    expect(cancelada.lineas.map((l) => l.precioUnit)).toEqual([100, 100]);
    // Y sigue en la base: cancelar no borra.
    expect(await cliente.cotizacion.count()).toBe(1);
    expect(await cliente.cotizacionLinea.count()).toBe(2);
  });

  it('re-cancelar se rechaza (el motivo original manda)', async () => {
    const { idLista } = await listaConModelos(['MOD-A']);
    const cotizacion = await emitirCotizacion(sesion(), { idLista }, bd());
    await cancelarCotizacion(sesion(), cotizacion.id, { motivo: 'Primera' }, bd());
    await expect(
      cancelarCotizacion(sesion(), cotizacion.id, { motivo: 'Segunda' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    const releida = await obtenerCotizacion(sesion(), cotizacion.id, bd());
    expect(releida.motivoCancelacion).toBe('Primera');
  });
});

describe('🔴 H1 — el documento es AUTOSUFICIENTE: la lista NO queda atrapada', () => {
  it('⭐ quitar de la lista un renglón ya cotizado se PERMITE, y el papel no cambia', async () => {
    const { idLista, idsLinea } = await listaConModelos(['MOD-A', 'MOD-B']);
    const cotizacion = await emitirCotizacion(sesion(), { idLista }, bd());
    const idLinea = idsLinea[0];
    if (idLinea === undefined) {
      throw new Error('La lista de prueba no trajo renglones.');
    }

    // La primera versión de esta etapa lo BLOQUEABA con un `Restrict`, y eso no protegía el papel:
    // atrapaba el desarrollo. Con `@@unique([idDesarrollo])` en `lista_precios_linea`, ese modelo no
    // podría entrar NUNCA a otra lista — y sin salida, porque una cotización no se borra ni
    // cancelándola. Es el mismo defecto que V1-E4 tuvo que ir a arreglar.
    await quitarLineaLista(sesion(), idLinea, bd());
    expect(await cliente.listaPreciosLinea.count({ where: { idLista } })).toBe(1);

    // El documento sigue diciendo EXACTAMENTE lo mismo: cliente, departamento, folio de lista y los
    // DOS renglones con sus precios. Sólo el puntero de procedencia se fue a null (SetNull).
    const releida = await obtenerCotizacion(sesion(), cotizacion.id, bd());
    expect(releida.nombreCliente).toBe('C&A');
    expect(releida.nombreDepartamento).toBe('NIÑOS');
    expect(releida.folioLista).toBe(cotizacion.folioLista);
    expect(releida.lineas).toHaveLength(2);
    expect(releida.lineas.map((l) => l.codigoModelo)).toEqual(['MOD-A', 'MOD-B']);
    expect(releida.lineas.map((l) => l.precioUnit)).toEqual([100, 100]);
    expect(releida.lineas[0]?.idListaLinea).toBeNull();
    // Y el desarrollo queda LIBRE para entrar a otra lista (era justo lo que se perdía).
    expect(await cliente.listaPreciosLinea.count({ where: { id: idLinea } })).toBe(0);
  });

  it('⭐ BORRAR la lista entera se permite y la cotización sobrevive íntegra', async () => {
    const { idLista } = await listaConModelos(['MOD-A', 'MOD-B']);
    const cotizacion = await emitirCotizacion(sesion(), { idLista }, bd());

    await eliminarLista(sesion(), idLista, bd());
    expect(await cliente.listaPrecios.count()).toBe(0);

    const releida = await obtenerCotizacion(sesion(), cotizacion.id, bd());
    expect(releida.idLista).toBeNull();
    expect(releida.folioLista).toBe(cotizacion.folioLista);
    expect(releida.nombreCliente).toBe('C&A');
    expect(releida.nombreDepartamento).toBe('NIÑOS');
    expect(releida.lineas).toHaveLength(2);
    expect(releida.lineas.map((l) => l.precioUnit)).toEqual([100, 100]);
    expect(releida.total).toBe(200);
    // El listado también la sigue mostrando (no se apoya en la lista para nada).
    const listado = await listarCotizaciones(sesion(), {}, bd());
    expect(listado.map((c) => c.nombreCliente)).toEqual(['C&A']);
    expect(listado[0]?.folioLista).toBe(cotizacion.folioLista);
  });

  it('renombrar al cliente NO reescribe el papel ya emitido', async () => {
    const { idLista } = await listaConModelos(['MOD-A']);
    const cotizacion = await emitirCotizacion(sesion(), { idLista }, bd());
    await cliente.cliente.update({
      where: { id: clienteNegocio.id },
      data: { nombre: 'C&A México (antes C&A)' },
    });
    const releida = await obtenerCotizacion(sesion(), cotizacion.id, bd());
    expect(releida.nombreCliente).toBe('C&A');
  });
});

describe('listarCotizaciones', () => {
  it('lista las de la empresa, más nueva primero, filtrando por lista y estado', async () => {
    const { idLista } = await listaConModelos(['MOD-A']);
    const primera = await emitirCotizacion(sesion(), { idLista }, bd());
    await emitirCotizacion(sesion(), { idLista }, bd());
    await cancelarCotizacion(sesion(), primera.id, { motivo: 'Duplicada' }, bd());

    const todas = await listarCotizaciones(sesion(), { idLista }, bd());
    expect(todas.map((c) => c.folio)).toEqual([2, 1]);
    expect(todas[0]?.totalRenglones).toBe(1);
    expect(todas[0]?.total).toBe(100);

    const canceladas = await listarCotizaciones(sesion(), { estado: 'cancelada' }, bd());
    expect(canceladas.map((c) => c.folio)).toEqual([1]);

    // A9: otra empresa no ve nada.
    const otra = sesionDePrueba({ idEmpresaActiva: empresa.id + 999, permisos: PERM });
    expect(await listarCotizaciones(otra, {}, bd())).toEqual([]);
  });

  it('sin `consultas.ver-importes` se ocultan los precios pero se ven los modelos', async () => {
    const { idLista } = await listaConModelos(['MOD-A']);
    const cotizacion = await emitirCotizacion(sesion(), { idLista }, bd());
    const sinImportes = sesion(['listas.ver', 'listas.negociar']);
    const vista = await obtenerCotizacion(sinImportes, cotizacion.id, bd());
    expect(vista.lineas[0]?.precioUnit).toBeNull();
    expect(vista.total).toBeNull();
    expect(vista.lineas[0]?.codigoModelo).toBe('MOD-A');
  });
});
