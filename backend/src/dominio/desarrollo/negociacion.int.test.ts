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
