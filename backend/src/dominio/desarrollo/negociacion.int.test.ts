/**
 * Integración de la NEGOCIACIÓN por versiones (F8-E5) contra el Postgres efímero (testcontainers).
 * Cubre: la ronda re-apunta a la versión nueva + recalcula + RESETEA el aprobado + bitacorea un evento
 * (anterior recuperable), el evento es INMUTABLE, el acuerdo NO re-costea, el guard `esCierre` bloquea
 * ronda/acuerdo/editar-factores/aprobar/ajustar, `cambiarEstadoLista` cambia y REABRE (auditado),
 * `listas.negociar` es exigido (403 sin él), el scope por empresa (A9), la ronda con precosto de OTRO
 * desarrollo/no-congelado se rechaza, y la ocultación de importes. NO corre en local (Docker): CI.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso, RenglonMesa } from '../../contrato/index.js';
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
  desgloseCostoLinea,
  editarFactoresLista,
  fijarPrecioTargetLinea,
  obtenerLista,
} from './listas-precios.js';
import {
  cambiarEstadoLista,
  guardarMesa,
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
    // ⭐ V1-E8w: EMPAQUE, la tercera ancla fija — sin él `generarPrecosto` truena.
    { codigo: 'empaque', nombre: 'Empaque', orden: 9, fijo: true },
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
    // ⭐ V1-E8w: 30 de tela + 60 de maquila + 2.20 del ancla de EMPAQUE = 92.20 (y 92.2/0.4 = 231).
    expect(renglon.costoUnit).toBe(92.2);
    expect(renglon.precioCalculado).toBe(231);
    // Aprobado RESETEADO tras la ronda (el costo cambió).
    expect(renglon.precioAprobado).toBeNull();
    expect(renglon.aprobado).toBe(false);

    // El evento quedó con el anterior recuperable (v1, precio 106) y el nuevo (v2, precio 231).
    const eventos = await listarEventosDeLinea(sesion(), idLinea, bd());
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.idPrecostoAnterior).toBe(idPrecostoV1);
    expect(eventos[0]!.idPrecostoNuevo).toBe(idPrecostoV2);
    expect(eventos[0]!.precioAnterior).toBe(106);
    expect(eventos[0]!.precioNuevo).toBe(231);
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
    const idV2 = await congelarNuevaVersion(idDesarrollo, 60); // calculado 231

    const conRonda = await registrarRonda(
      sesion(),
      idLinea,
      { idPrecostoNuevo: idV2, acuerdo: 'Precio pactado con el cliente', precioAcordado: 200 },
      bd(),
    );
    const renglon = conRonda.lineas[0]!;
    expect(renglon.precioCalculado).toBe(231);
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
    expect(renglon.precioAprobado).toBe(106);
    const eventos = await listarEventosDeLinea(sesion(), idLinea, bd());
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.idPrecostoAnterior).toBeNull();
    expect(eventos[0]!.idPrecostoNuevo).toBeNull();
    expect(eventos[0]!.precioAnterior).toBe(106);
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
  it('al precio de lista (106) el margen bruto iguala el objetivo (cumple)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-SIM');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;

    const sim = await simularNegociacion(sesion(), idLinea, { precioObjetivo: 106 }, bd());
    expect(sim.costo).toBe(42.2); // 40 de receta + 2.20 del ancla de EMPAQUE (V1-E8w)
    expect(sim.precioNeto).toBeCloseTo(84.8, 6); // 106 × (1 − 0.20)
    expect(sim.margenBrutoPct).toBeGreaterThanOrEqual(50); // (84.8 − 42.2) / 84.8 = 50.2 %
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
    const idV2 = await congelarNuevaVersion(idDesarrollo, 60); // costo 92.20

    const sim = await simularNegociacion(
      sesion(),
      idLinea,
      { precioObjetivo: 100, idPrecosto: idV2 },
      bd(),
    );
    expect(sim.costo).toBe(92.2); // el de la versión indicada, no el vigente (42.20)
    expect(sim.margenBrutoPct).toBeLessThan(0); // 80 neto < 92.20 costo → pérdida
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
    expect(sim.costo).toBe(42.2);
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
 * excel" que se persigue en las DOS direcciones. La receta sembrada cuesta **42.20** (tela 1.5×20 =
 * 30 + maquila 10 + ⭐ empaque 2.20, V1-E8w) y los factores del cliente son 50/10/5/5 ⇒ el precio de
 * lista es 106.
 */
describe('simularMesa — el negociador en vivo (§Post-F9.138)', () => {
  /**
   * Los dos renglones que la mesa trae precargados de la receta (tela 1.5 × 20 = 30 + maquila 10 =
   * 40). ⭐ V1-E8w: la tela viaja con **consumo y precio separados** —las dos perillas que Daniel
   * mueve por su cuenta— y la maquila con `consumo: null` (su precio ES el importe). El fixture usa
   * `satisfies` y NUNCA un cast: un `as unknown as` habría tapado los campos nuevos justo aquí.
   */
  const RECETA = [
    {
      conceptoCodigo: 'tela',
      conceptoNombre: 'Tela',
      etiqueta: 'Tela',
      consumo: 1.5,
      precioUnit: 20,
    },
    {
      conceptoCodigo: 'maquila',
      conceptoNombre: 'Maquila',
      etiqueta: 'Maquila',
      consumo: null,
      precioUnit: 10,
    },
    // ⭐ V1-E8w: el ancla de EMPAQUE ($2.20 por defecto) también nace en la receta, así que la mesa
    // la trae precargada como cualquier otro concepto. Va con importe ≠ 0 a propósito: un fixture
    // que la pusiera en cero dejaría de probar que el sumando nuevo llega hasta la línea base.
    {
      conceptoCodigo: 'empaque',
      conceptoNombre: 'Empaque',
      etiqueta: 'Empaque',
      consumo: null,
      precioUnit: 2.2,
    },
  ] satisfies RenglonMesa[];

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
      { renglones: RECETA, precioObjetivo: 106 },
      bd(),
    );
    expect(mesa.costoVigente).toBe(42.2);
    expect(mesa.costoSimulado).toBe(42.2); // los campos NACEN cargados con los costos de la receta
    expect(mesa.deltaCosto).toBe(0);
    expect(mesa.precioNeto).toBeCloseTo(84.8, 6); // 106 × (1 − 0.20)
    expect(mesa.margenBrutoPct).toBeGreaterThanOrEqual(50);
    expect(mesa.cumpleObjetivo).toBe(true);

    /**
     * ⭐⭐ V1-E8w — **EL PRODUCTO LO HACE EL SERVIDOR**, y por eso vuelve resuelto: la tela entró
     * como `consumo 1.5 × precio 20` y sale como un importe de 30. Es lo que permite que la pantalla
     * tenga las dos perillas de Daniel *"precio de la tela, y consumo"* sin multiplicar nada (A1).
     */
    expect(mesa.renglones.map((r) => r.importe)).toEqual([30, 10, 2.2]);
    expect(mesa.renglones[0]?.etiqueta).toBe('Tela');
    // Y los SUBTOTALES por concepto también son del servidor (lo que abre los avíos "desglosados").
    expect(mesa.grupos).toEqual([
      { codigo: 'tela', nombre: 'Tela', subtotal: 30 },
      { codigo: 'maquila', nombre: 'Maquila', subtotal: 10 },
      { codigo: 'empaque', nombre: 'Empaque', subtotal: 2.2 },
    ]);
  });

  /**
   * ⭐⭐ **LA PERILLA DEL CONSUMO, sola.** Textual de Daniel (§Post-F9.153): *«muchas veces voy
   * estimando el nuevo peso en lugar del costo de multiplicar el consumo por el precio de la tela. O
   * a veces decido meter una tela mas barata, pero el consumo es el mismo.»* Son DOS movimientos
   * distintos, y aquí se hace cada uno por su lado sobre la misma tela.
   */
  it('⭐ tela: mover SÓLO el consumo, o SÓLO el precio, mueve el costo por separado', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-MESATELA');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;

    // (a) "estimo el nuevo peso": el consumo baja a 1.2, el precio de la tela NO se toca.
    const menosPeso = await simularMesa(
      sesion(),
      idLinea,
      {
        renglones: [
          { ...RECETA[0]!, consumo: 1.2 },
          RECETA[1]!,
          RECETA[2]!,
        ] satisfies RenglonMesa[],
        precioObjetivo: 106,
      },
      bd(),
    );
    expect(menosPeso.renglones[0]?.importe).toBe(24); // 1.2 × 20
    expect(menosPeso.costoSimulado).toBe(36.2);

    // (b) "meto una tela mas barata, pero el consumo es el mismo": el precio baja a 16, consumo 1.5.
    const telaBarata = await simularMesa(
      sesion(),
      idLinea,
      {
        renglones: [
          { ...RECETA[0]!, precioUnit: 16 },
          RECETA[1]!,
          RECETA[2]!,
        ] satisfies RenglonMesa[],
        precioObjetivo: 106,
      },
      bd(),
    );
    expect(telaBarata.renglones[0]?.importe).toBe(24); // 1.5 × 16 — mismo importe, otro camino
    expect(telaBarata.costoSimulado).toBe(36.2);
    // Y en los dos casos el margen SUBE contra la línea base, que es lo que el instrumento promete.
    expect(menosPeso.margenBrutoPct!).toBeGreaterThan(50);
    expect(telaBarata.margenBrutoPct!).toBeGreaterThan(50);
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
      { renglones: RECETA, precioObjetivo: 106 },
      bd(),
    );
    // "la maquila costará 5 pesos menos": 10 → 5.
    const despues = await simularMesa(
      sesion(),
      idLinea,
      {
        renglones: [
          RECETA[0]!,
          {
            conceptoCodigo: 'maquila',
            conceptoNombre: 'Maquila',
            etiqueta: 'Maquila (estimado: sin cierre)',
            consumo: null,
            precioUnit: 5,
          },
          RECETA[2]!,
        ] satisfies RenglonMesa[],
        precioObjetivo: 106,
      },
      bd(),
    );

    expect(despues.costoSimulado).toBe(37.2);
    expect(despues.deltaCosto).toBe(-5); // contra el costo VIGENTE (42.20), que el servidor lee solo
    // El margen SUBE al mismo precio…
    expect(despues.margenBrutoPct!).toBeGreaterThan(antes.margenBrutoPct!);
    // …y el precio que ese costo pediría BAJA (dirección 2 completa).
    expect(despues.precioSugerido!).toBeLessThan(antes.precioSugerido!);
    expect(antes.precioSugerido).toBe(106); // 42.2 / 0.5 / 0.8 = 105.5 → al alza (D2 #4)
    expect(despues.precioSugerido).toBe(93); // 37.2 / 0.5 / 0.8 = 93
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
        renglones: [
          ...RECETA,
          {
            conceptoCodigo: 'avios',
            conceptoNombre: 'Avíos',
            etiqueta: 'Jareta más barata (estimado)',
            consumo: null,
            precioUnit: 3.25,
          },
        ] satisfies RenglonMesa[],
        precioObjetivo: 110,
      },
      bd(),
    );

    expect(mesa.costoSimulado).toBe(45.45); // 42.20 de receta + 3.25 del estimado
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
          {
            conceptoCodigo: 'tela',
            conceptoNombre: 'Tela',
            etiqueta: 'Tela',
            consumo: 1.37,
            precioUnit: 20,
          },
          {
            conceptoCodigo: 'maquila',
            conceptoNombre: 'Maquila',
            etiqueta: 'Maquila (estimado)',
            consumo: null,
            precioUnit: 5,
          },
          {
            conceptoCodigo: 'avios',
            conceptoNombre: 'Avíos',
            etiqueta: 'Jareta que no existe',
            consumo: null,
            precioUnit: 2,
          },
        ] satisfies RenglonMesa[],
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
    expect(mesa.costoVigente).toBe(42.2);
    expect(mesa.costoSimulado).toBe(42.2);
    expect(mesa.deltaCosto).toBe(0);
    expect(mesa.precioObjetivo).toBe(100);
    // ⭐ V1-E8w: los renglones y los subtotales tampoco son factores — son sus propios números.
    expect(mesa.renglones.map((r) => r.importe)).toEqual([30, 10, 2.2]);
    expect(mesa.grupos.map((g) => g.subtotal)).toEqual([30, 10, 2.2]);
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

  /**
   * ⭐ §Post-F9.150 — el TARGET del cliente **aparece en la mesa** y **NO bloquea nada**. Daniel:
   * *«aveces los clientes nos dan sus target prices…. y es importante saberlo a la hora de la
   * negociacion»*. Se prueba el ciclo entero: sin target → null; con target → el veredicto; por
   * debajo → `cumpleTarget: false` **y la mesa sigue calculando todo lo demás igual** (informa, no
   * bloquea); y borrarlo lo devuelve a null.
   */
  it('⭐ el TARGET del cliente sale en la mesa, INFORMA y no bloquea (§Post-F9.150)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-TARGET');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;

    // Sin target: null, y ningún veredicto inventado.
    const sinTarget = await simularMesa(
      sesion(),
      idLinea,
      { renglones: RECETA, precioObjetivo: 106 },
      bd(),
    );
    expect(sinTarget.precioTarget).toBeNull();
    expect(sinTarget.cumpleTarget).toBeNull();

    // Aurora lo captura al armar la lista.
    await fijarPrecioTargetLinea(sesion(), idLinea, { precioTarget: 95 }, bd());
    const conTarget = await simularMesa(
      sesion(),
      idLinea,
      { renglones: RECETA, precioObjetivo: 106 },
      bd(),
    );
    expect(conTarget.precioTarget).toBe(95);
    expect(conTarget.cumpleTarget).toBe(true); // 106 ≥ 95

    // 🔴 INFORMA, NO BLOQUEA: por debajo del target la mesa contesta igual de completa, y aprobar
    // el precio por debajo se PERMITE (no hay candado en ningún lado).
    const debajo = await simularMesa(
      sesion(),
      idLinea,
      { renglones: RECETA, precioObjetivo: 90 },
      bd(),
    );
    expect(debajo.cumpleTarget).toBe(false);
    expect(debajo.margenBrutoPct).not.toBeNull();
    const aprobada = await ajustarPrecioLinea(sesion(), idLinea, { precio: 90 }, bd());
    expect(aprobada.lineas[0]?.precioAprobado).toBe(90);
    expect(aprobada.lineas[0]?.precioTarget).toBe(95);
    expect(aprobada.lineas[0]?.tieneTarget).toBe(true);

    // Y se puede BORRAR (*"si es que nos lo dio"*: un número capturado por error no atrapa a nadie).
    const sin = await fijarPrecioTargetLinea(sesion(), idLinea, { precioTarget: null }, bd());
    expect(sin.lineas[0]?.precioTarget).toBeNull();
    expect(sin.lineas[0]?.tieneTarget).toBe(false);
  });

  /**
   * 🔴 **EL TARGET LO CAPTURA AURORA, NO EL DUEÑO** — el permiso es `listas.administrar`, que es lo
   * que ella tiene (Gerencial administra listas y negocia, pero **no** aprueba precios). Con
   * `listas.aprobar` el dato habría quedado del lado equivocado del reparto y ella no habría podido
   * ponerlo, que es exactamente lo que la decisión dice que tiene que pasar.
   */
  it('🔴 el target lo pone quien ADMINISTRA la lista (Aurora), no quien aprueba precios', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-TARGETPERM');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;

    // El perfil de Aurora: administra y negocia, SIN `listas.aprobar`. Puede ponerlo.
    const aurora = sesion([
      'listas.ver',
      'listas.administrar',
      'listas.negociar',
      'consultas.ver-importes',
    ]);
    const conTarget = await fijarPrecioTargetLinea(aurora, idLinea, { precioTarget: 99 }, bd());
    expect(conTarget.lineas[0]?.precioTarget).toBe(99);

    // Quien sólo APRUEBA precios (sin administrar la lista) NO lo captura.
    await expect(
      fijarPrecioTargetLinea(
        sesion(['listas.ver', 'listas.aprobar', 'consultas.ver-importes']),
        idLinea,
        { precioTarget: 80 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);

    // A9: un renglón de otra empresa no existe.
    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa Target');
    await expect(
      fijarPrecioTargetLinea(
        sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM }),
        idLinea,
        { precioTarget: 80 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  /**
   * 🔴 **LA QUINTA PUERTA A LOS FACTORES, comprobada cerrada.** El target es un número del CLIENTE y
   * el objetivo lo teclea quien pregunta, así que ninguno de los dos pasa por los porcentajes — pero
   * eso hay que **verlo**, no suponerlo: sin `listas.aprobar` el target y su veredicto SÍ se ven, y
   * los cinco derivados de los factores siguen en null. Si alguien colara un `cumpleTarget` calculado
   * contra el `precioSugerido`, esto moriría.
   */
  it('🔴 el target NO abre la quinta puerta: se ve sin `listas.aprobar`, los factores no', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-TARGETFACT');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    await fijarPrecioTargetLinea(sesion(), idLinea, { precioTarget: 95 }, bd());
    const enLaMesa = sesion([
      'listas.ver',
      'listas.administrar',
      'listas.negociar',
      'consultas.ver-importes',
    ]);

    const mesa = await simularMesa(
      enLaMesa,
      idLinea,
      { renglones: RECETA, precioObjetivo: 100 },
      bd(),
    );
    expect(mesa.precioTarget).toBe(95);
    expect(mesa.cumpleTarget).toBe(true); // 100 ≥ 95 — aritmética limpia, sin factores de por medio
    expect(mesa.precioSugerido).toBeNull();
    expect(mesa.margenBrutoPct).toBeNull();
    expect(mesa.margenObjetivoPct).toBeNull();
    expect(mesa.cumpleObjetivo).toBeNull();
    expect(mesa.precioNeto).toBeNull();
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

/**
 * ⭐⭐ **EL GUARDADO DE LA MESA** (§Post-F9.149). Daniel, textual:
 *
 * > *«En la negociación terminó con ciertos costos estimados. Esos son los que dices que se borran??
 * > Estos son indispensables que se queden. Fue con la información que vendí. O sea. Entre los costos
 * > que fui dando u los comentarios que voy metiendo es como se va a armar la nueva receta.»*
 *
 * Y sobre CUÁNDO: *«Sin exacto. Voy jugando y al terminar la negociación guardo la última información
 * que metí.»*
 */
describe('⭐⭐ guardarMesa — los estimados SE QUEDAN (§Post-F9.149)', () => {
  const RECETA_MESA = [
    {
      conceptoCodigo: 'tela',
      conceptoNombre: 'Tela',
      etiqueta: 'Felpa',
      consumo: 1.2,
      precioUnit: 20,
    },
    {
      conceptoCodigo: 'maquila',
      conceptoNombre: 'Maquila',
      etiqueta: 'Maquila (estimado: sin cierre)',
      consumo: null,
      precioUnit: 5,
    },
    {
      conceptoCodigo: 'avios',
      conceptoNombre: 'Avíos',
      etiqueta: 'Jareta más barata',
      consumo: null,
      precioUnit: 3.25,
    },
    {
      conceptoCodigo: 'empaque',
      conceptoNombre: 'Empaque',
      etiqueta: 'Empaque',
      consumo: null,
      precioUnit: 2.2,
    },
  ] satisfies RenglonMesa[];

  /**
   * 🔴 **LA PRUEBA CENTRAL: el DESGLOSE se queda, no el total.** Un total no sirve para lo que Daniel
   * lo quiere (*"es como se va a armar la nueva receta"*), así que se exige renglón por renglón —con
   * su concepto, su etiqueta libre, su consumo y su precio— además del costo sumado.
   */
  it('🔴 persiste el DESGLOSE por concepto (no sólo el total) y lo devuelve en el hilo', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-GUARDA1');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;

    await guardarMesa(
      sesion(),
      idLinea,
      {
        acuerdo: 'Le quitamos el cierre y estimamos la maquila 5 pesos abajo',
        renglones: RECETA_MESA,
        precioObjetivo: 92,
      },
      bd(),
    );

    const eventos = await listarEventosDeLinea(sesion(), idLinea, bd());
    expect(eventos).toHaveLength(1);
    const evento = eventos[0]!;
    expect(evento.acuerdo).toBe('Le quitamos el cierre y estimamos la maquila 5 pesos abajo');
    expect(evento.precioNuevo).toBe(92);
    // 1.2×20 = 24 + 5 + 3.25 + 2.20 = 34.45 (el producto lo hizo el servidor, no el cliente).
    expect(evento.costoEstimado).toBe(34.45);
    expect(evento.costos).toEqual([
      {
        conceptoCodigo: 'tela',
        conceptoNombre: 'Tela',
        etiqueta: 'Felpa',
        consumo: 1.2,
        precioUnit: 20,
        importe: 24,
      },
      {
        conceptoCodigo: 'maquila',
        conceptoNombre: 'Maquila',
        etiqueta: 'Maquila (estimado: sin cierre)',
        consumo: null,
        precioUnit: 5,
        importe: 5,
      },
      {
        conceptoCodigo: 'avios',
        conceptoNombre: 'Avíos',
        etiqueta: 'Jareta más barata',
        consumo: null,
        precioUnit: 3.25,
        importe: 3.25,
      },
      {
        conceptoCodigo: 'empaque',
        conceptoNombre: 'Empaque',
        etiqueta: 'Empaque',
        consumo: null,
        precioUnit: 2.2,
        importe: 2.2,
      },
    ]);
    // Y el autor y la fecha, que ya eran del hilo: el guardado es una entrada más, no un anexo.
    expect(evento.registradoPorId).toBe('usuario-prueba');
    expect(evento.registradoEn).not.toBe('');
  });

  /**
   * 🔴 **Lo que el guardado NO toca.** Guardar la mesa no aprueba precios, no re-costea, no crea
   * avíos y no mueve el renglón de la lista: es la CONSTANCIA de con qué se vendió, no una decisión.
   */
  it('🔴 no toca el renglón, ni el precosto, ni el catálogo: sólo deja constancia', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-GUARDA2');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const antes = lista.lineas[0]!;
    const aviosAntes = await cliente.avio.count();
    const lineasPrecostoAntes = await cliente.precostoLinea.count();

    const despues = await guardarMesa(
      sesion(),
      idLinea,
      { acuerdo: 'Así quedó', renglones: RECETA_MESA, precioObjetivo: 92 },
      bd(),
    );

    const renglon = despues.lineas[0]!;
    expect(renglon.idPrecosto).toBe(antes.idPrecosto);
    expect(renglon.costoUnit).toBe(antes.costoUnit);
    expect(renglon.precioCalculado).toBe(antes.precioCalculado);
    expect(renglon.precioAprobado).toBeNull();
    expect(renglon.aprobado).toBe(false);
    expect(await cliente.avio.count()).toBe(aviosAntes);
    expect(await cliente.precostoLinea.count()).toBe(lineasPrecostoAntes);
  });

  /**
   * 🔴 **INMUTABLE (D3) y ÚLTIMO ESTADO.** *«Voy jugando y al terminar la negociación guardo la
   * última información que metí»*: volver a guardar **AGREGA** otra constancia, jamás pisa la
   * anterior. Las dos quedan legibles, en orden, con lo que decía cada una.
   */
  it('🔴 guardar otra vez AGREGA una constancia nueva; la anterior queda intacta (D3)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-GUARDA3');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;

    await guardarMesa(
      sesion(),
      idLinea,
      { acuerdo: 'Primera vuelta', renglones: RECETA_MESA, precioObjetivo: 92 },
      bd(),
    );
    await guardarMesa(
      sesion(),
      idLinea,
      {
        acuerdo: 'Segunda vuelta: aceptó subir la tela',
        renglones: [{ ...RECETA_MESA[0]!, precioUnit: 25 }, ...RECETA_MESA.slice(1)],
        precioObjetivo: 99,
      },
      bd(),
    );

    const eventos = await listarEventosDeLinea(sesion(), idLinea, bd());
    expect(eventos).toHaveLength(2);
    expect(eventos.map((e) => e.acuerdo)).toEqual([
      'Primera vuelta',
      'Segunda vuelta: aceptó subir la tela',
    ]);
    expect(eventos[0]!.costoEstimado).toBe(34.45); // la primera NO se movió
    expect(eventos[1]!.costoEstimado).toBe(40.45); // 1.2×25 = 30 + 5 + 3.25 + 2.20
    expect(eventos[0]!.costos[0]?.precioUnit).toBe(20);
    expect(eventos[1]!.costos[0]?.precioUnit).toBe(25);
  });

  /**
   * ⭐ **El guardado suma EXACTAMENTE lo que la pantalla enseñó.** Simulador y guardado comparten
   * `resolverRenglonesMesa`; si cada uno multiplicara o redondeara por su lado, el desglose guardado
   * no cuadraría con el costo con el que Daniel dijo que vendió. Se compara con los MISMOS renglones.
   */
  it('⭐ el costo guardado es EL MISMO que el que enseñó el simulador (misma aritmética)', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-GUARDA4');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    // Consumos que obligan a redondear (1.333 × 17.99 = 23.98... por renglón).
    const conDecimales = [
      { ...RECETA_MESA[0]!, consumo: 1.333, precioUnit: 17.99 },
      ...RECETA_MESA.slice(1),
    ] satisfies RenglonMesa[];

    const simulada = await simularMesa(
      sesion(),
      idLinea,
      { renglones: conDecimales, precioObjetivo: 92 },
      bd(),
    );
    await guardarMesa(
      sesion(),
      idLinea,
      { acuerdo: 'Así quedó', renglones: conDecimales, precioObjetivo: 92 },
      bd(),
    );

    const evento = (await listarEventosDeLinea(sesion(), idLinea, bd()))[0]!;
    expect(evento.costoEstimado).toBe(simulada.costoSimulado);
    expect(evento.costos.map((c) => c.importe)).toEqual(simulada.renglones.map((r) => r.importe));
  });

  it('sin `consultas.ver-importes` el desglose guardado sale SIN números, pero se lee', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-GUARDA5');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    await guardarMesa(
      sesion(),
      idLinea,
      { acuerdo: 'Así quedó', renglones: RECETA_MESA, precioObjetivo: 92 },
      bd(),
    );

    const evento = (await listarEventosDeLinea(sesion(['listas.ver']), idLinea, bd()))[0]!;
    expect(evento.costoEstimado).toBeNull();
    expect(evento.costos).toHaveLength(4);
    expect(evento.costos[0]?.etiqueta).toBe('Felpa'); // QUÉ era, sí
    expect(evento.costos[0]?.consumo).toBe(1.2); // el consumo no es dinero
    expect(evento.costos[0]?.precioUnit).toBeNull();
    expect(evento.costos[0]?.importe).toBeNull();
  });

  it('una lista CERRADA no admite guardar la mesa; sin `listas.negociar` tampoco', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-GUARDA6');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    const cuerpo = { acuerdo: 'Así quedó', renglones: RECETA_MESA, precioObjetivo: 92 };

    await expect(
      guardarMesa(sesion(['listas.ver', 'consultas.ver-importes']), idLinea, cuerpo, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);

    await cambiarEstadoLista(sesion(), lista.id, { idEstadoLista: estadoCerrada.id }, bd());
    await expect(guardarMesa(sesion(), idLinea, cuerpo, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  /**
   * 🔴 **Y el SIMULADOR sigue sin escribir.** Es la propiedad que §Post-F9.139 le exige, y ahora hay
   * un hermano suyo que SÍ escribe: la huella md5 de toda la base tiene que seguir intacta después
   * de simular, aunque a un renglón de distancia exista `guardarMesa`.
   */
  it('🔴 el SIMULADOR sigue sin escribir nada aunque ya exista el guardado', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-GUARDA7');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    await guardarMesa(
      sesion(),
      idLinea,
      { acuerdo: 'Así quedó', renglones: RECETA_MESA, precioObjetivo: 92 },
      bd(),
    );

    const antes = await huellaDeToda();
    await simularMesa(sesion(), idLinea, { renglones: RECETA_MESA, precioObjetivo: 96 }, bd());
    expect(await huellaDeToda()).toBe(antes);
  });

  /** Huella md5 de todas las tablas (misma técnica que la del simulador, arriba). */
  async function huellaDeToda(): Promise<string> {
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
});

/**
 * ⭐ V1-E8w — LA FOTO del modelo en el desglose del renglón. Daniel: *«Me gustaria ir viendo la foto
 * del modelo. La principal.»* La "principal" es la PRIMERA por `orden`, el mismo criterio del
 * carrusel y del impreso de la orden; un modelo sin fotos sale en `null` y la mesa no se rompe.
 */
describe('⭐ la FOTO del modelo llega a la mesa (V1-E8w)', () => {
  it('devuelve la URL de la PRIMERA foto por orden; sin fotos, null', async () => {
    const idDesarrollo = await desarrolloConPrecosto('MOD-FOTO');
    const lista = await crearListaCon(idDesarrollo);
    const idLinea = lista.lineas[0]!.id;
    // Servicio de archivos FALSO: la prueba es de qué foto se elige, no de firmar contra R2.
    const archivos = {
      urlDescarga: (key: string) => Promise.resolve(`https://r2.falso/${key}`),
    } as unknown as Parameters<typeof desgloseCostoLinea>[3];

    // Sin fotos.
    const sinFoto = await desgloseCostoLinea(sesion(), idLinea, bd(), archivos);
    expect(sinFoto.urlFotoModelo).toBeNull();
    expect(sinFoto.codigoModelo).toBe('MOD-FOTO');

    // Dos fotos: la principal es la de `orden` menor, aunque se haya creado después.
    const idModelo = (await cliente.desarrollo.findUniqueOrThrow({ where: { id: idDesarrollo } }))
      .idModelo;
    for (const [orden, key] of [
      [2, 'modelos/1/espalda.jpg'],
      [1, 'modelos/1/frente.jpg'],
    ] as const) {
      const archivo = await cliente.archivo.create({
        data: {
          bucket: 'pruebas',
          key,
          nombreOriginal: key,
          tipoMime: 'image/jpeg',
          tamanoBytes: 10,
        },
      });
      await cliente.modeloFoto.create({
        data: { idModelo, idArchivo: archivo.id, orden, tipo: 'OTRO' },
      });
    }

    const conFoto = await desgloseCostoLinea(sesion(), idLinea, bd(), archivos);
    expect(conFoto.urlFotoModelo).toBe('https://r2.falso/modelos/1/frente.jpg');
  });
});
