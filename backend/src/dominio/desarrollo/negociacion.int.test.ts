/**
 * Integración de la NEGOCIACIÓN por versiones (F8-E5) contra el Postgres efímero (testcontainers).
 * Cubre: la ronda re-apunta a la versión nueva + recalcula + RESETEA el aprobado + bitacorea un evento
 * (anterior recuperable), el evento es INMUTABLE, el acuerdo NO re-costea, el guard `esCierre` bloquea
 * ronda/acuerdo/editar-factores/aprobar/ajustar, `cambiarEstadoLista` cambia y REABRE (auditado),
 * `listas.negociar` es exigido (403 sin él), el scope por empresa (A9), la ronda con precosto de OTRO
 * desarrollo/no-congelado se rechaza, y la ocultación de importes. NO corre en local (Docker): CI.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Cliente,
  ClienteDepartamento,
  Empresa,
  EstadoLista,
  PrismaClient,
  Tela,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { crearDesarrollo } from './desarrollos.js';
import { crearProyecto } from './proyectos.js';
import { congelarVersion, editarLinea, generarPrecosto, obtenerPrecosto } from './precostos.js';
import { guardarFactoresCliente } from './cliente-factores.js';
import {
  aprobarLinea,
  ajustarPrecioLinea,
  crearLista,
  editarFactoresLista,
  obtenerLista,
} from './listas-precios.js';
import {
  cambiarEstadoLista,
  listarEventosDeLinea,
  registrarAcuerdo,
  registrarRonda,
  simularMesa,
  simularNegociacion,
} from './negociacion.js';

let cliente: PrismaClient;
let empresa: Empresa;
let clienteNegocio: Cliente;
let departamento: ClienteDepartamento;
let estadoAbierta: EstadoLista;
let estadoCerrada: EstadoLista;
let estadoNegociacion: EstadoLista;

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

/** Siembra los conceptos base y los estados de lista (abierta / en-negociacion / cerrada). */
async function sembrarBase(): Promise<void> {
  const conceptos = [
    { codigo: 'tela', nombre: 'Tela', orden: 1, fijo: true },
    { codigo: 'avios', nombre: 'Avíos', orden: 2, fijo: true },
    { codigo: 'maquila', nombre: 'Maquila', orden: 3, fijo: true },
    { codigo: 'bordado', nombre: 'Bordado', orden: 5, fijo: false },
    { codigo: 'corte', nombre: 'Corte', orden: 8, fijo: true },
  ];
  for (const c of conceptos) {
    await cliente.conceptoCosto.create({ data: c });
  }
  estadoAbierta = await cliente.estadoLista.create({
    data: { codigo: 'abierta', nombre: 'Abierta', orden: 1, esCierre: false },
  });
  estadoNegociacion = await cliente.estadoLista.create({
    data: { codigo: 'en-negociacion', nombre: 'En negociación', orden: 2, esCierre: false },
  });
  estadoCerrada = await cliente.estadoLista.create({
    data: { codigo: 'cerrada', nombre: 'Cerrada', orden: 3, esCierre: true },
  });
}

/** Factores 50/10/5/5 → costo 40 ⇒ 100 (precioCalculado). */
async function sembrarFactores(): Promise<void> {
  await guardarFactoresCliente(
    sesion(),
    clienteNegocio.id,
    { margenPct: 50, descuentosPct: 10, regaliasPct: 5, costoVentasPct: 5 },
    bd(),
  );
}

/**
 * Crea un desarrollo con precosto CONGELADO (costo = tela 1.5×20 + maquila 10 = 40) y devuelve el
 * id del desarrollo. Deja UNA versión congelada (v1).
 */
async function desarrolloConPrecosto(
  codigoModelo: string,
  s: SesionUsuario = sesion(),
): Promise<number> {
  const tela: Tela = await cliente.tela.create({
    data: { nombre: `Felpa ${codigoModelo}`, precioSugerido: 20 },
  });
  const modelo = await cliente.modelo.create({
    data: {
      codigo: codigoModelo,
      maquilaBase: 10,
      telas: { create: [{ idTela: tela.id, consumoPorPrenda: 1.5 }] },
    },
  });
  const proyecto = await crearProyecto(
    s,
    { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, nombre: 'Joggers' },
    bd(),
  );
  const desarrollo = await crearDesarrollo(s, proyecto.id, { idModelo: modelo.id }, bd());
  const precosto = await generarPrecosto(s, desarrollo.id, bd());
  await congelarVersion(s, precosto.id, bd());
  return desarrollo.id;
}

/**
 * Genera y congela una NUEVA versión del precosto de un desarrollo, con la maquila puesta en
 * `maquilaNueva` (para forzar un costo distinto). Devuelve el id del precosto congelado nuevo.
 */
async function congelarNuevaVersion(idDesarrollo: number, maquilaNueva: number): Promise<number> {
  const borrador = await generarPrecosto(sesion(), idDesarrollo, bd());
  const maquila = borrador.lineas.find((l) => l.conceptoCodigo === 'maquila');
  if (maquila === undefined) {
    throw new Error('El precosto no trae renglón de maquila (bug de la siembra).');
  }
  await editarLinea(sesion(), borrador.id, maquila.id, { precioUnit: maquilaNueva }, bd());
  const congelado = await congelarVersion(sesion(), borrador.id, bd());
  return congelado.id;
}

/** Crea una lista con un renglón (el desarrollo dado). Devuelve la lista completa. */
async function crearListaCon(idDesarrollo: number) {
  return crearLista(
    sesion(),
    {
      idCliente: clienteNegocio.id,
      idClienteDepartamento: departamento.id,
      idsDesarrollo: [idDesarrollo],
    },
    bd(),
  );
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
  await sembrarFactores();
});

describe('registrarRonda — re-costeo por versiones', () => {
  it('re-apunta a la versión nueva, recalcula el precio, resetea el aprobado y bitacorea el evento', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-RONDA');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const idPrecostoV1 = lista.lineas[0]!.idPrecosto;

    // Aprueba el renglón en v1 (precio 100) — la ronda debe RESETEARLO.
    await aprobarLinea(sesion(), idLinea, bd());

    // Nueva versión con maquila 60 → costo 40−10+60 = 90 → precio 90/0.5=180 /0.8 = 225.
    const idPrecostoV2 = await congelarNuevaVersion(idDesarrollo, 60);
    const conRonda = await registrarRonda(
      sesion(),
      idLinea,
      { idPrecostoNuevo: idPrecostoV2, acuerdo: 'Se sube la maquila' },
      bd(),
    );

    const renglon = conRonda.lineas[0]!;
    expect(renglon.idPrecosto).toBe(idPrecostoV2);
    expect(renglon.costoUnit).toBe(90);
    expect(renglon.precioCalculado).toBe(225);
    // Aprobado RESETEADO tras la ronda (el costo cambió).
    expect(renglon.precioAprobado).toBeNull();
    expect(renglon.aprobado).toBe(false);

    // El evento quedó con el anterior recuperable (v1, precio 100) y el nuevo (v2, precio 225).
    const eventos = await listarEventosDeLinea(sesion(), idLinea, bd());
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.idPrecostoAnterior).toBe(idPrecostoV1);
    expect(eventos[0]!.idPrecostoNuevo).toBe(idPrecostoV2);
    expect(eventos[0]!.precioAnterior).toBe(100);
    expect(eventos[0]!.precioNuevo).toBe(225);
    expect(eventos[0]!.versionNueva).toBe(2);
    expect(eventos[0]!.acuerdo).toBe('Se sube la maquila');
    // La versión ANTERIOR sigue existiendo (recuperable, D3).
    const v1 = await obtenerPrecosto(sesion(), idPrecostoV1, bd());
    expect(v1.congelado).toBe(true);
  });

  it('el precio acordado (si viene) va al evento, no al precioAprobado', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-ACOR');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const idV2 = await congelarNuevaVersion(idDesarrollo, 60); // calculado 225

    const conRonda = await registrarRonda(
      sesion(),
      idLinea,
      { idPrecostoNuevo: idV2, acuerdo: 'Precio pactado con el cliente', precioAcordado: 200 },
      bd(),
    );
    const renglon = conRonda.lineas[0]!;
    expect(renglon.precioCalculado).toBe(225);
    expect(renglon.precioAprobado).toBeNull(); // la ronda NO fija el aprobado
    const eventos = await listarEventosDeLinea(sesion(), idLinea, bd());
    expect(eventos[0]!.precioNuevo).toBe(200); // el ACORDADO ganó en el evento
  });

  it('rechaza un precosto de OTRO desarrollo', async () => {
    const idA = await desarrolloConPrecosto('MOD-A');
    const idB = await desarrolloConPrecosto('MOD-B');
    const listaA = await crearListaCon(idA);
    const idLineaA = listaA.lineas[0]!.id;
    const idV2B = await congelarNuevaVersion(idB, 60);
    await expect(
      registrarRonda(sesion(), idLineaA, { idPrecostoNuevo: idV2B, acuerdo: 'x' }, bd()),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('rechaza un precosto NO congelado (borrador)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-BORR');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const borrador = await generarPrecosto(sesion(), idDesarrollo, bd()); // v2 en BORRADOR
    await expect(
      registrarRonda(sesion(), idLinea, { idPrecostoNuevo: borrador.id, acuerdo: 'x' }, bd()),
    ).rejects.toThrow(ErrorConflicto);
  });

  it('rechaza la MISMA versión que el renglón ya usa', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-MISMA');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const idActual = lista.lineas[0]!.idPrecosto;
    await expect(
      registrarRonda(sesion(), idLinea, { idPrecostoNuevo: idActual, acuerdo: 'x' }, bd()),
    ).rejects.toThrow(ErrorConflicto);
  });

  it('sin listas.negociar → ErrorPermiso', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-NOPERM');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const idV2 = await congelarNuevaVersion(idDesarrollo, 60);
    const sinNegociar = sesion(['listas.ver', 'listas.administrar']);
    await expect(
      registrarRonda(sinNegociar, idLinea, { idPrecostoNuevo: idV2, acuerdo: 'x' }, bd()),
    ).rejects.toThrow(ErrorPermiso);
  });

  it('un renglón de OTRA empresa no existe (A9)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-A9');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const idV2 = await congelarNuevaVersion(idDesarrollo, 60);
    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa Neg');
    const sesionOtra = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM });
    await expect(
      registrarRonda(sesionOtra, idLinea, { idPrecostoNuevo: idV2, acuerdo: 'x' }, bd()),
    ).rejects.toThrow(ErrorNoEncontrado);
  });
});

describe('registrarAcuerdo — sin re-costeo', () => {
  it('registra un evento sin tocar el precosto ni el precioAprobado', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-AC');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const idV1 = lista.lineas[0]!.idPrecosto;
    await aprobarLinea(sesion(), idLinea, bd()); // aprobado en 100

    const conAcuerdo = await registrarAcuerdo(
      sesion(),
      idLinea,
      { acuerdo: 'Cliente pide muestra', precioAcordado: 95 },
      bd(),
    );
    const renglon = conAcuerdo.lineas[0]!;
    // NO cambió el precosto ni el aprobado.
    expect(renglon.idPrecosto).toBe(idV1);
    expect(renglon.precioAprobado).toBe(100);
    const eventos = await listarEventosDeLinea(sesion(), idLinea, bd());
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.idPrecostoAnterior).toBeNull();
    expect(eventos[0]!.idPrecostoNuevo).toBeNull();
    expect(eventos[0]!.precioAnterior).toBe(100);
    expect(eventos[0]!.precioNuevo).toBe(95);
  });
});

describe('estados de la lista — cierre y reapertura', () => {
  it('cambiarEstadoLista mueve el estado y bitacorea de→a', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-EST');
    const lista = await crearListaCon(idDesarrollo);
    const enNeg = await cambiarEstadoLista(
      sesion(),
      lista.id,
      { idEstadoLista: estadoNegociacion.id },
      bd(),
    );
    expect(enNeg.codigoEstado).toBe('en-negociacion');

    const bitacora = await cliente.bitacora.findMany({
      where: { entidad: 'ListaPrecios', idEntidad: String(lista.id) },
    });
    const cambio = bitacora.find(
      (b) => (b.datos as { operacion?: string } | null)?.operacion === 'cambiar-estado',
    );
    expect(cambio).toBeDefined();
    expect((cambio!.datos as { de: string; a: string }).de).toBe('abierta');
    expect((cambio!.datos as { de: string; a: string }).a).toBe('en-negociacion');
  });

  it('una lista CERRADA rechaza ronda/acuerdo/editar-factores/aprobar/ajustar; reabrir la desbloquea', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-CIERRE');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const idV2 = await congelarNuevaVersion(idDesarrollo, 60);

    await cambiarEstadoLista(sesion(), lista.id, { idEstadoLista: estadoCerrada.id }, bd());

    await expect(
      registrarRonda(sesion(), idLinea, { idPrecostoNuevo: idV2, acuerdo: 'x' }, bd()),
    ).rejects.toThrow(ErrorConflicto);
    await expect(registrarAcuerdo(sesion(), idLinea, { acuerdo: 'x' }, bd())).rejects.toThrow(
      ErrorConflicto,
    );
    await expect(
      editarFactoresLista(
        sesion(),
        lista.id,
        { margenPct: 60, descuentosPct: 10, regaliasPct: 5, costoVentasPct: 5 },
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);
    await expect(aprobarLinea(sesion(), idLinea, bd())).rejects.toThrow(ErrorConflicto);
    await expect(ajustarPrecioLinea(sesion(), idLinea, { precio: 120 }, bd())).rejects.toThrow(
      ErrorConflicto,
    );

    // Reabrir (auditado) → la ronda ya procede.
    await cambiarEstadoLista(sesion(), lista.id, { idEstadoLista: estadoAbierta.id }, bd());
    const conRonda = await registrarRonda(
      sesion(),
      idLinea,
      { idPrecostoNuevo: idV2, acuerdo: 'ok tras reabrir' },
      bd(),
    );
    expect(conRonda.lineas[0]!.idPrecosto).toBe(idV2);
  });

  it('sin listas.negociar no se puede cambiar el estado', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-ESTPERM');
    const lista = await crearListaCon(idDesarrollo);
    const sinNegociar = sesion(['listas.ver', 'listas.administrar']);
    await expect(
      cambiarEstadoLista(sinNegociar, lista.id, { idEstadoLista: estadoCerrada.id }, bd()),
    ).rejects.toThrow(ErrorPermiso);
  });

  it('una lista de OTRA empresa no se puede mover (A9)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-ESTA9');
    const lista = await crearListaCon(idDesarrollo);
    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa Estado');
    const sesionOtra = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM });
    await expect(
      cambiarEstadoLista(sesionOtra, lista.id, { idEstadoLista: estadoCerrada.id }, bd()),
    ).rejects.toThrow(ErrorNoEncontrado);
  });
});

describe('listarEventosDeLinea — inmutabilidad y ocultación', () => {
  it('los eventos son INMUTABLES: cada ronda AGREGA, nunca reemplaza (orden cronológico)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-INM');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const idV2 = await congelarNuevaVersion(idDesarrollo, 60);
    await registrarRonda(sesion(), idLinea, { idPrecostoNuevo: idV2, acuerdo: 'ronda 1' }, bd());
    await registrarAcuerdo(sesion(), idLinea, { acuerdo: 'acuerdo 2' }, bd());
    const idV3 = await congelarNuevaVersion(idDesarrollo, 30);
    await registrarRonda(sesion(), idLinea, { idPrecostoNuevo: idV3, acuerdo: 'ronda 3' }, bd());

    const eventos = await listarEventosDeLinea(sesion(), idLinea, bd());
    expect(eventos).toHaveLength(3);
    expect(eventos.map((e) => e.acuerdo)).toEqual(['ronda 1', 'acuerdo 2', 'ronda 3']);
  });

  /**
   * ⭐ V1-E8q (§Post-F9.141) — el hilo tiene que decir QUIÉN, no un id crudo.
   *
   * `NegociacionEvento` no tiene FK física al usuario (es un log inmutable, como `OrdenComentario`),
   * así que el nombre NO llega solo: lo resuelve el servidor. Sin esto el frontend no tiene de dónde
   * sacarlo y el hilo quedaba "anónimo con fecha".
   */
  it('🔴 cada evento sale con el NOMBRE de quien lo escribió (resuelto en el servidor)', async () => {
    const autor = await cliente.usuario.create({
      data: {
        username: 'dmasri-e8q',
        nombre: 'Daniel Masri',
        email: 'dmasri-e8q@control.local',
      },
    });
    const idDesarrollo = await desarrolloConPrecosto('MOD-AUT');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const sesionAutor = sesion();
    sesionAutor.id = autor.id;

    await registrarAcuerdo(
      sesionAutor,
      idLinea,
      { acuerdo: 'Le bajaron dos colores al estampado' },
      bd(),
    );

    const eventos = await listarEventosDeLinea(sesion(), idLinea, bd());
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.registradoPorId).toBe(autor.id);
    expect(eventos[0]!.nombreRegistradoPor).toBe('Daniel Masri');
    expect(eventos[0]!.acuerdo).toBe('Le bajaron dos colores al estampado');
  });

  /**
   * Un autor que ya no está (o un evento sin autor) NO puede romper el hilo: la historia se sigue
   * leyendo completa. Borrar gente jamás borra el porqué de un precio (D3).
   */
  it('un autor desconocido deja el nombre en null pero NO pierde el comentario', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-AUT2');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    // `sesion()` usa el id 'usuario-prueba', que no existe como fila en la BD.
    await registrarAcuerdo(sesion(), idLinea, { acuerdo: 'sin autor resoluble' }, bd());

    const eventos = await listarEventosDeLinea(sesion(), idLinea, bd());
    expect(eventos[0]!.nombreRegistradoPor).toBeNull();
    expect(eventos[0]!.acuerdo).toBe('sin autor resoluble');
  });

  /**
   * El hilo es DE ESTE renglón. Un comentario de otra negociación colándose aquí sería peor que no
   * tener hilo: atribuiría a este modelo un porqué que nunca fue suyo.
   */
  it('🔴 un comentario de OTRA negociación no se cuela en este hilo', async () => {
    const idDesA = await desarrolloConPrecosto('MOD-HILO-A');
    const idDesB = await desarrolloConPrecosto('MOD-HILO-B');
    const listaA = await crearListaCon(idDesA);
    const listaB = await crearListaCon(idDesB);
    const idLineaA = listaA.lineas[0]!.id;
    const idLineaB = listaB.lineas[0]!.id;

    await registrarAcuerdo(sesion(), idLineaA, { acuerdo: 'sólo de A' }, bd());
    await registrarAcuerdo(sesion(), idLineaB, { acuerdo: 'sólo de B' }, bd());

    const eventosA = await listarEventosDeLinea(sesion(), idLineaA, bd());
    expect(eventosA.map((e) => e.acuerdo)).toEqual(['sólo de A']);
    expect(eventosA.every((e) => e.idListaLinea === idLineaA)).toBe(true);
  });

  it('sin consultas.ver-importes oculta los precios del evento (versiones y acuerdo se ven)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-OCU');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const idV2 = await congelarNuevaVersion(idDesarrollo, 60);
    await registrarRonda(
      sesion(),
      idLinea,
      { idPrecostoNuevo: idV2, acuerdo: 'sin importes' },
      bd(),
    );

    const sinImportes = sesion(['listas.ver']);
    const eventos = await listarEventosDeLinea(sinImportes, idLinea, bd());
    expect(eventos[0]!.precioAnterior).toBeNull();
    expect(eventos[0]!.precioNuevo).toBeNull();
    expect(eventos[0]!.versionNueva).toBe(2);
    expect(eventos[0]!.acuerdo).toBe('sin importes');
  });
});

describe('simularNegociacion — calculadora de margen en vivo (§4.8)', () => {
  it('al precio de lista (100) el margen bruto iguala el objetivo (cumple)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-SIM');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;

    const sim = await simularNegociacion(sesion(), idLinea, { precioObjetivo: 100 }, bd());
    expect(sim.costo).toBe(40);
    expect(sim.precioNeto).toBeCloseTo(80, 6); // 100 × (1 − 0.20)
    expect(sim.margenBrutoPct).toBeCloseTo(50, 6); // (80 − 40) / 80
    expect(sim.margenObjetivoPct).toBe(50);
    expect(sim.cumpleObjetivo).toBe(true);
  });

  it('un objetivo por debajo del de lista NO cumple (margen bruto < objetivo)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-SIMBAJO');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;

    const sim = await simularNegociacion(sesion(), idLinea, { precioObjetivo: 90 }, bd());
    expect(sim.precioNeto).toBeCloseTo(72, 6); // 90 × 0.80
    expect(sim.margenBrutoPct).toBeLessThan(50);
    expect(sim.cumpleObjetivo).toBe(false);
  });

  it('con idPrecosto usa el costo de ESA versión congelada (preview de una ronda)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-SIMVER');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const idV2 = await congelarNuevaVersion(idDesarrollo, 60); // costo 90

    const sim = await simularNegociacion(
      sesion(),
      idLinea,
      { precioObjetivo: 100, idPrecosto: idV2 },
      bd(),
    );
    expect(sim.costo).toBe(90); // el de la versión indicada, no el vigente (40)
    expect(sim.margenBrutoPct).toBeLessThan(0); // 80 neto < 90 costo → pérdida
    expect(sim.cumpleObjetivo).toBe(false);
  });

  it('rechaza un idPrecosto de OTRO desarrollo', async () => {
    const idA = await desarrolloConPrecosto('MOD-SIMA');
    const idB = await desarrolloConPrecosto('MOD-SIMB');
    const listaA = await crearListaCon(idA);
    const idLineaA = listaA.lineas[0]!.id;
    const idV2B = await congelarNuevaVersion(idB, 60);
    await expect(
      simularNegociacion(sesion(), idLineaA, { precioObjetivo: 100, idPrecosto: idV2B }, bd()),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('sin listas.negociar → ErrorPermiso', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-SIMPERM');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const sinNegociar = sesion(['listas.ver', 'consultas.ver-importes']);
    await expect(
      simularNegociacion(sinNegociar, idLinea, { precioObjetivo: 100 }, bd()),
    ).rejects.toThrow(ErrorPermiso);
  });

  it('un renglón de OTRA empresa no existe (A9)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-SIMA9');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa Sim');
    const sesionOtra = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM });
    await expect(
      simularNegociacion(sesionOtra, idLinea, { precioObjetivo: 100 }, bd()),
    ).rejects.toThrow(ErrorNoEncontrado);
  });

  /**
   * ⭐ **V1-E8b (§Post-F9.125(b)) — esta calculadora era la TERCERA puerta a los factores.**
   * Ocultarlos en la lista no servía de nada mientras aquí se sirvieran, y se servían TODOS:
   * `margenObjetivoPct` ES el factor; `precioNeto ÷ objetivo` entrega la suma de los otros tres;
   * `margenBrutoPct` arrastra esa fuga; y `cumpleObjetivo` es un oráculo que reconstruye el margen
   * a fuerza de preguntar. Quien negocia sigue simulando —el `costo` y su propio precio los ve—,
   * pero el sistema ya no le entrega el número digerido.
   */
  it('🔴 sin `listas.aprobar` los CUATRO campos del margen salen en null', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-SIMFACT');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    // El perfil de Desarrollo: negocia y ve importes, pero no aprueba precios.
    const enLaMesa = sesion(['listas.ver', 'listas.negociar', 'consultas.ver-importes']);

    const sim = await simularNegociacion(enLaMesa, idLinea, { precioObjetivo: 100 }, bd());
    expect(sim.precioNeto).toBeNull();
    expect(sim.margenBrutoPct).toBeNull();
    expect(sim.margenObjetivoPct).toBeNull();
    expect(sim.cumpleObjetivo).toBeNull();
    // Lo que NO se oculta (el límite declarado): el costo y el precio que ella misma tecleó.
    expect(sim.costo).toBe(40);
    expect(sim.precioObjetivo).toBe(100);
  });
});

describe('@@unique([idDesarrollo]) — un desarrollo en a lo más una lista', () => {
  it('la BD rechaza dos renglones del mismo desarrollo (defensa en profundidad)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-UNIQ');
    const lista = await crearListaCon(idDesarrollo);
    // Intento de INSERT directo de un segundo renglón del mismo desarrollo en OTRA lista → viola el
    // unique global de `id_desarrollo` (no sólo el compuesto lista+desarrollo).
    const otraLista = await cliente.listaPrecios.create({
      data: {
        folio: BigInt(999),
        idEmpresa: empresa.id,
        idCliente: clienteNegocio.id,
        idClienteDepartamento: departamento.id,
        fecha: new Date(),
        idEstadoLista: estadoAbierta.id,
        margenPct: 50,
        descuentosPct: 10,
        regaliasPct: 5,
        costoVentasPct: 5,
      },
    });
    const precosto = lista.lineas[0]!.idPrecosto;
    await expect(
      cliente.listaPreciosLinea.create({
        data: {
          idLista: otraLista.id,
          idDesarrollo,
          idPrecosto: precosto,
          costoUnit: 40,
          precioCalculado: 100,
        },
      }),
    ).rejects.toThrow();
    // La lista original sigue intacta.
    const original = await obtenerLista(sesion(), lista.id, bd());
    expect(original.lineas).toHaveLength(1);
  });
});

/**
 * ⭐⭐ EL NEGOCIADOR EN VIVO de la mesa (§Post-F9.138/.139/.144) — el renglón "casi como si fuera un
 * excel" que se persigue en las DOS direcciones. La receta sembrada cuesta 40 (tela 1.5×20 = 30 +
 * maquila 10) y los factores del cliente son 50/10/5/5 ⇒ el precio de lista es 100.
 */
describe('simularMesa — el negociador en vivo (§Post-F9.138)', () => {
  /** Los dos renglones que la mesa trae precargados de la receta (tela 30 + maquila 10 = 40). */
  const RECETA = [
    { etiqueta: 'Tela', importe: 30 },
    { etiqueta: 'Maquila', importe: 10 },
  ];

  /**
   * Huella COMPLETA de la base: por cada tabla, un md5 de todas sus filas serializadas y ordenadas.
   * Detecta INSERT, UPDATE y DELETE en cualquier tabla —no sólo conteos—, que es lo que hace falta
   * para afirmar "el simulador no escribió nada" sin creerle a la lectura del código.
   */
  async function huellaBase(): Promise<string> {
    const tablas = await cliente.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      ORDER BY tablename
    `;
    const partes: string[] = [];
    for (const { tablename } of tablas) {
      const [fila] = await cliente.$queryRawUnsafe<{ h: string | null }[]>(
        `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${tablename}" t`,
      );
      partes.push(`${tablename}:${fila?.h ?? ''}`);
    }
    return partes.join('\n');
  }

  it('dirección 1 — escribo el PRECIO y sale el MARGEN, con todas las condiciones del cliente', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-MESA1');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;

    const mesa = await simularMesa(
      sesion(),
      idLinea,
      { renglones: RECETA, precioObjetivo: 100 },
      bd(),
    );
    expect(mesa.costoVigente).toBe(40);
    expect(mesa.costoSimulado).toBe(40); // los campos NACEN cargados con los costos de la receta
    expect(mesa.deltaCosto).toBe(0);
    expect(mesa.precioNeto).toBeCloseTo(80, 6); // 100 × (1 − 0.20)
    expect(mesa.margenBrutoPct).toBeCloseTo(50, 6);
    expect(mesa.cumpleObjetivo).toBe(true);
  });

  /**
   * ⭐ **LA OTRA DIRECCIÓN — la mitad que NO existía.** Textual de Daniel (§Post-F9.144(b)): *"me
   * quitan un cierre y yo le pongo que estimos que la maquila costara 5 pesos menos"*. Ni ese costo
   * ni esa receta existen en ninguna versión congelada, así que `simularNegociacion` NO puede
   * simularlos (sólo acepta el costo vigente o el de un precosto congelado). Aquí sí: al mover el
   * costo se mueven **el margen Y el precio sugerido**, que es lo que el instrumento promete.
   */
  it('dirección 2 ⭐ — muevo un COSTO y se mueven el MARGEN y el PRECIO sugerido', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-MESA2');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;

    const antes = await simularMesa(
      sesion(),
      idLinea,
      { renglones: RECETA, precioObjetivo: 100 },
      bd(),
    );
    // "la maquila costará 5 pesos menos": 10 → 5.
    const despues = await simularMesa(
      sesion(),
      idLinea,
      {
        renglones: [
          { etiqueta: 'Tela', importe: 30 },
          { etiqueta: 'Maquila (estimado: sin cierre)', importe: 5 },
        ],
        precioObjetivo: 100,
      },
      bd(),
    );

    expect(despues.costoSimulado).toBe(35);
    expect(despues.deltaCosto).toBe(-5); // contra el costo VIGENTE (40), que el servidor lee solo
    // El margen SUBE al mismo precio…
    expect(despues.margenBrutoPct!).toBeGreaterThan(antes.margenBrutoPct!);
    // …y el precio que ese costo pediría BAJA (dirección 2 completa).
    expect(despues.precioSugerido!).toBeLessThan(antes.precioSugerido!);
    expect(antes.precioSugerido).toBe(100); // 40 / 0.5 / 0.8
    expect(despues.precioSugerido).toBe(88); // 35 / 0.5 / 0.8 = 87.5 → al alza (D2 #4)
  });

  /**
   * 🔴 §Post-F9.139: *"no esta dado de alta en el catalogo. No puedo ponerme a dar de alta una jareta
   * ahi, que ni certeza tengo de cuanto cuesta"*. El renglón entra por su ETIQUETA y su IMPORTE, sin
   * pedir que exista nada — y sin dejar nada creado detrás.
   */
  it('acepta un ESTIMADO que no existe en ningún catálogo, y no lo da de alta', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-MESA3');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const aviosAntes = await cliente.avio.count();

    const mesa = await simularMesa(
      sesion(),
      idLinea,
      {
        renglones: [...RECETA, { etiqueta: 'Jareta más barata (estimado)', importe: 3.25 }],
        precioObjetivo: 110,
      },
      bd(),
    );

    expect(mesa.costoSimulado).toBe(43.25);
    expect(await cliente.avio.count()).toBe(aviosAntes); // NO CREA NADA
  });

  /**
   * 🔴🔴 **EL ESTADO PROHIBIDO: "el simulador escribió algo".** No se afirma leyendo el código: se
   * toma la huella md5 de TODAS las tablas antes y después, con el peor caso posible —costos movidos
   * a mano y un estimado que no existe en ningún catálogo—. Cualquier INSERT/UPDATE/DELETE en
   * cualquier tabla (catálogo, receta, precosto, renglón de la lista o bitácora) la mueve.
   */
  it('🔴 NO ESCRIBE NADA: la huella de TODA la base es idéntica antes y después', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-MESA4');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;

    const antes = await huellaBase();
    await simularMesa(
      sesion(),
      idLinea,
      {
        renglones: [
          { etiqueta: 'Tela', importe: 27.4 },
          { etiqueta: 'Maquila (estimado)', importe: 5 },
          { etiqueta: 'Jareta que no existe', importe: 2 },
        ],
        precioObjetivo: 96,
      },
      bd(),
    );
    expect(await huellaBase()).toBe(antes);
  });

  /**
   * 🔴 **LA CUARTA PUERTA A LOS FACTORES, cerrada al nacer.** V1-E8b (§Post-F9.125(b)) cerró tres;
   * ésta se abría sola con `precioSugerido`: el costo lo teclea quien pregunta, así que
   * `precioSugerido ÷ costoSimulado` entrega el multiplicador combinado de los cuatro factores.
   * Daniel, el 29-ago-2026: *«Nadie mas que yo ve los factores por favor….»*
   */
  it('🔴 sin `listas.aprobar` el margen Y el precio sugerido salen en null', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-MESAFACT');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const enLaMesa = sesion(['listas.ver', 'listas.negociar', 'consultas.ver-importes']);

    const mesa = await simularMesa(
      enLaMesa,
      idLinea,
      { renglones: RECETA, precioObjetivo: 100 },
      bd(),
    );
    expect(mesa.precioSugerido).toBeNull(); // ← la puerta nueva
    expect(mesa.precioNeto).toBeNull();
    expect(mesa.margenBrutoPct).toBeNull();
    expect(mesa.margenObjetivoPct).toBeNull();
    expect(mesa.cumpleObjetivo).toBeNull();
    // El límite declarado y aceptado: el costo que ella misma tecleó y el precio que escribió, sí.
    expect(mesa.costoVigente).toBe(40);
    expect(mesa.costoSimulado).toBe(40);
    expect(mesa.deltaCosto).toBe(0);
    expect(mesa.precioObjetivo).toBe(100);
  });

  /**
   * ⭐ **GUARDA GEMELA.** La mesa y la calculadora de §4.8 enseñan el margen del MISMO renglón al
   * MISMO dueño; si cada una hiciera su cuenta, divergirían en la primera corrección. Con el mismo
   * costo tienen que dar EXACTAMENTE lo mismo — las dos pasan por `proyectarMargen`.
   */
  it('⭐ el margen de la mesa es EL MISMO que el de la calculadora (misma función)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-MESAGEM');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;

    const calculadora = await simularNegociacion(sesion(), idLinea, { precioObjetivo: 93 }, bd());
    const mesa = await simularMesa(
      sesion(),
      idLinea,
      { renglones: RECETA, precioObjetivo: 93 },
      bd(),
    );

    expect(mesa.costoSimulado).toBe(calculadora.costo); // misma línea base
    expect(mesa.precioNeto).toBe(calculadora.precioNeto);
    expect(mesa.margenBrutoPct).toBe(calculadora.margenBrutoPct);
    expect(mesa.margenObjetivoPct).toBe(calculadora.margenObjetivoPct);
    expect(mesa.cumpleObjetivo).toBe(calculadora.cumpleObjetivo);
  });

  it('sin `listas.negociar` → ErrorPermiso', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-MESAPERM');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    await expect(
      simularMesa(
        sesion(['listas.ver', 'consultas.ver-importes']),
        idLinea,
        { renglones: RECETA, precioObjetivo: 100 },
        bd(),
      ),
    ).rejects.toThrow(ErrorPermiso);
  });

  it('un renglón de OTRA empresa no existe (A9)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-MESAA9');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa Mesa');
    const sesionOtra = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM });
    await expect(
      simularMesa(sesionOtra, idLinea, { renglones: RECETA, precioObjetivo: 100 }, bd()),
    ).rejects.toThrow(ErrorNoEncontrado);
  });

  it('una mesa VACÍA se rechaza (un costo de 0 no es una negociación)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-MESAVACIA');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    await expect(
      simularMesa(sesion(), idLinea, { renglones: [], precioObjetivo: 100 }, bd()),
    ).rejects.toThrow(ErrorValidacion);
  });
});
