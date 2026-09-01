/**
 * Integración del enganche Desarrollo↔Producción (F8-E6) contra Postgres efímero (testcontainers). NO
 * corre en local (usa Docker; lo corre el CI). Cubre lo que la base valida:
 *  • ligar: coherencia (mismo modelo Y cliente, A9), unique idOrden, desarrollo apagado; el estado del
 *    desarrollo pasa a `ligado-produccion` (derivado).
 *  • quitar: borra la fila; quitar dos veces → ErrorNoEncontrado.
 *  • sugerencia: candidato + precioSugeridoPedido (aprobado ?? calculado); importes ocultos sin permiso.
 *  • expediente 360: proyecto + precosto vigente + lista/precio + acuerdos; importes ocultos.
 *  • tablero: conteos por estado derivado, agregados en el servidor, filtrables.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Cliente,
  ClienteDepartamento,
  Empresa,
  Modelo,
  PrismaClient,
} from '../../datos/index.js';
import type { ClavePermiso } from '../../contrato/index.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  expedienteOrden,
  ligarOrden,
  quitarLiga,
  sugerenciaLigaOrden,
  tableroDesarrollos,
} from './liga-orden.js';

let cliente: PrismaClient;
let empresa: Empresa;
let clienteNegocio: Cliente;
let clienteOtro: Cliente;
let departamento: ClienteDepartamento;
let modeloA: Modelo;
let modeloB: Modelo;
let folioSeq = 1;
let codigoSeq = 1;

const PERM_TODOS: ClavePermiso[] = [
  'desarrollo.ver',
  'desarrollo.administrar',
  'consultas.ver-importes',
];
const sesion = (permisos: ClavePermiso[] = PERM_TODOS): SesionUsuario =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

async function nuevoProyecto(
  idCliente: number,
  opts: { idTemporada?: number } = {},
): Promise<number> {
  const p = await cliente.proyecto.create({
    data: {
      folio: BigInt(folioSeq++),
      idEmpresa: empresa.id,
      idCliente,
      idClienteDepartamento: departamento.id,
      nombre: 'Joggers',
      idTemporada: opts.idTemporada ?? null,
    },
  });
  return p.id;
}

async function nuevoDesarrollo(
  idModelo: number,
  opts: { idCliente?: number; apagado?: boolean; idTemporada?: number } = {},
): Promise<number> {
  const idProyecto = await nuevoProyecto(
    opts.idCliente ?? clienteNegocio.id,
    opts.idTemporada === undefined ? {} : { idTemporada: opts.idTemporada },
  );
  const d = await cliente.desarrollo.create({
    data: { idProyecto, idModelo, apagado: opts.apagado ?? false },
  });
  return d.id;
}

async function nuevaOrden(idModelo: number, idClienteOrden: number): Promise<number> {
  const o = await cliente.orden.create({
    data: {
      folio: BigInt(folioSeq++),
      idEmpresa: empresa.id,
      idModelo,
      idCliente: idClienteOrden,
      estado: 'capturada',
    },
  });
  return o.id;
}

async function congelarPrecosto(idDesarrollo: number, costoTotal: number): Promise<number> {
  const p = await cliente.precosto.create({
    data: { idDesarrollo, version: 1, estado: 'congelado', congeladoEn: new Date(), costoTotal },
  });
  return p.id;
}

async function crearListaLinea(
  idDesarrollo: number,
  idPrecosto: number,
  datos: { costoUnit: number; precioCalculado: number; precioAprobado?: number },
): Promise<{ idLista: number; idLinea: number }> {
  const estado = await cliente.estadoLista.create({
    data: { codigo: `abierta-${codigoSeq++}`, nombre: 'Abierta' },
  });
  const lista = await cliente.listaPrecios.create({
    data: {
      folio: BigInt(folioSeq++),
      idEmpresa: empresa.id,
      idCliente: clienteNegocio.id,
      idClienteDepartamento: departamento.id,
      fecha: new Date('2026-07-01'),
      idEstadoLista: estado.id,
      margenPct: 0,
      descuentosPct: 0,
      regaliasPct: 0,
      costoVentasPct: 0,
    },
  });
  const linea = await cliente.listaPreciosLinea.create({
    data: {
      idLista: lista.id,
      idDesarrollo,
      idPrecosto,
      costoUnit: datos.costoUnit,
      precioCalculado: datos.precioCalculado,
      precioAprobado: datos.precioAprobado ?? null,
    },
  });
  return { idLista: lista.id, idLinea: linea.id };
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  folioSeq = 1;
  codigoSeq = 1;
  empresa = await crearEmpresaPrueba(cliente);
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'C&A' } });
  clienteOtro = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  departamento = await cliente.clienteDepartamento.create({
    data: { idCliente: clienteNegocio.id, nombre: 'NIÑOS' },
  });
  modeloA = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Jogger' } });
  modeloB = await cliente.modelo.create({ data: { codigo: 'B-200' } });
});

describe('ligarOrden — coherencia + estado derivado', () => {
  it('liga una orden a un desarrollo del mismo modelo y cliente (estado → ligado-produccion)', async () => {
    const idDesarrollo = await nuevoDesarrollo(modeloA.id);
    const idOrden = await nuevaOrden(modeloA.id, clienteNegocio.id);
    const liga = await ligarOrden(sesion(), idOrden, { idDesarrollo }, bd());
    expect(liga.idDesarrollo).toBe(idDesarrollo);
    expect(liga.idOrden).toBe(idOrden);
    expect(liga.estadoDesarrollo).toBe('ligado-produccion');
    const fila = await cliente.desarrolloOrden.findUnique({ where: { idOrden } });
    expect(fila?.idDesarrollo).toBe(idDesarrollo);
  });

  it('rechaza si la orden ya está ligada (ErrorConflicto)', async () => {
    const idDesarrollo = await nuevoDesarrollo(modeloA.id);
    const otro = await nuevoDesarrollo(modeloA.id);
    const idOrden = await nuevaOrden(modeloA.id, clienteNegocio.id);
    await ligarOrden(sesion(), idOrden, { idDesarrollo }, bd());
    await expect(
      ligarOrden(sesion(), idOrden, { idDesarrollo: otro }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  /**
   * ⭐⭐ V1-E3 — **LA ORDEN DE UN MODELO NACIDO POR COLOR SE LIGA AL DESARROLLO DE SU PADRE.**
   *
   * 🔴 Ésta es la prueba del bloqueante que la etapa vino a quitar: `ligarOrdenNucleo` comparaba
   * `desarrollo.idModelo !== orden.idModelo` a pelo, y desde V1-E3 la orden lleva el HIJO mientras
   * el desarrollo apunta al PADRE ⇒ **el paso 4 de la propia `salidaAProduccion` reventaba**, con
   * la OP y todo lo demás dentro de la misma transacción. La coherencia se mide contra el LINAJE.
   */
  it('⭐⭐ liga la orden de un modelo HIJO (nacido por color) al desarrollo de su PADRE', async () => {
    const hijo = await cliente.modelo.create({
      data: {
        codigo: `71${String(codigoSeq++).padStart(3, '0')}`,
        origen: 'produccion',
        idModeloDesarrollo: modeloA.id,
      },
    });
    const idDesarrollo = await nuevoDesarrollo(modeloA.id);
    const idOrden = await nuevaOrden(hijo.id, clienteNegocio.id);

    const liga = await ligarOrden(sesion(), idOrden, { idDesarrollo }, bd());

    expect(liga.idDesarrollo).toBe(idDesarrollo);
    expect(liga.estadoDesarrollo).toBe('ligado-produccion');
  });

  /**
   * El control negativo del de arriba: que la regla se mida por el linaje NO la afloja. Un hijo de
   * OTRO desarrollo sigue rebotando — si `idModeloDeLaReceta` se hubiera cambiado por "cualquiera",
   * esta prueba caería y la de arriba no.
   */
  it('⭐ rechaza ligar la orden de un hijo al desarrollo de OTRO modelo (ErrorValidacion)', async () => {
    const hijo = await cliente.modelo.create({
      data: {
        codigo: `71${String(codigoSeq++).padStart(3, '0')}`,
        origen: 'produccion',
        idModeloDesarrollo: modeloA.id,
      },
    });
    const idDesarrollo = await nuevoDesarrollo(modeloB.id);
    const idOrden = await nuevaOrden(hijo.id, clienteNegocio.id);

    await expect(ligarOrden(sesion(), idOrden, { idDesarrollo }, bd())).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('rechaza si el desarrollo es de OTRO modelo (ErrorValidacion)', async () => {
    const idDesarrollo = await nuevoDesarrollo(modeloB.id); // modelo B
    const idOrden = await nuevaOrden(modeloA.id, clienteNegocio.id); // modelo A
    await expect(ligarOrden(sesion(), idOrden, { idDesarrollo }, bd())).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('rechaza si el desarrollo es de OTRO cliente (ErrorValidacion)', async () => {
    const idDesarrollo = await nuevoDesarrollo(modeloA.id, { idCliente: clienteNegocio.id });
    const idOrden = await nuevaOrden(modeloA.id, clienteOtro.id); // otro cliente
    await expect(ligarOrden(sesion(), idOrden, { idDesarrollo }, bd())).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it('rechaza ligar un desarrollo APAGADO (ErrorConflicto)', async () => {
    const idDesarrollo = await nuevoDesarrollo(modeloA.id, { apagado: true });
    const idOrden = await nuevaOrden(modeloA.id, clienteNegocio.id);
    await expect(ligarOrden(sesion(), idOrden, { idDesarrollo }, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('rechaza ligar una orden CANCELADA (ErrorConflicto)', async () => {
    const idDesarrollo = await nuevoDesarrollo(modeloA.id);
    const idOrden = await nuevaOrden(modeloA.id, clienteNegocio.id);
    await cliente.orden.update({ where: { id: idOrden }, data: { estado: 'cancelada' } });
    await expect(ligarOrden(sesion(), idOrden, { idDesarrollo }, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('orden inexistente → ErrorNoEncontrado', async () => {
    const idDesarrollo = await nuevoDesarrollo(modeloA.id);
    await expect(ligarOrden(sesion(), 999999, { idDesarrollo }, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });
});

describe('quitarLiga', () => {
  it('quita la liga y quitar dos veces lanza ErrorNoEncontrado', async () => {
    const idDesarrollo = await nuevoDesarrollo(modeloA.id);
    const idOrden = await nuevaOrden(modeloA.id, clienteNegocio.id);
    await ligarOrden(sesion(), idOrden, { idDesarrollo }, bd());
    const res = await quitarLiga(sesion(), idOrden, bd());
    expect(res.ligado).toBe(false);
    expect(await cliente.desarrolloOrden.findUnique({ where: { idOrden } })).toBeNull();
    await expect(quitarLiga(sesion(), idOrden, bd())).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

describe('sugerenciaLigaOrden — candidato + precio propuesto', () => {
  it('sugiere el desarrollo del mismo modelo/cliente con el precio de su lista', async () => {
    const idDesarrollo = await nuevoDesarrollo(modeloA.id);
    const idPrecosto = await congelarPrecosto(idDesarrollo, 50);
    await crearListaLinea(idDesarrollo, idPrecosto, {
      costoUnit: 50,
      precioCalculado: 100,
      precioAprobado: 130,
    });
    const idOrden = await nuevaOrden(modeloA.id, clienteNegocio.id);

    const sug = await sugerenciaLigaOrden(sesion(), idOrden, bd());
    expect(sug.yaLigada).toBe(false);
    expect(sug.candidato?.idDesarrollo).toBe(idDesarrollo);
    expect(sug.candidato?.precioSugeridoPedido).toBeCloseTo(130); // aprobado gana al calculado
    expect(sug.candidato?.estado).toBe('en-lista');
  });

  it('oculta el precio propuesto sin consultas.ver-importes', async () => {
    const idDesarrollo = await nuevoDesarrollo(modeloA.id);
    const idPrecosto = await congelarPrecosto(idDesarrollo, 50);
    await crearListaLinea(idDesarrollo, idPrecosto, { costoUnit: 50, precioCalculado: 100 });
    const idOrden = await nuevaOrden(modeloA.id, clienteNegocio.id);

    const sug = await sugerenciaLigaOrden(sesion(['desarrollo.ver']), idOrden, bd());
    expect(sug.candidato?.idDesarrollo).toBe(idDesarrollo);
    expect(sug.candidato?.precioSugeridoPedido).toBeNull();
  });

  it('sin desarrollo coherente → candidato null', async () => {
    const idOrden = await nuevaOrden(modeloB.id, clienteNegocio.id); // no hay desarrollo de B
    const sug = await sugerenciaLigaOrden(sesion(), idOrden, bd());
    expect(sug.candidato).toBeNull();
  });

  /**
   * ⭐⭐ V1-E3 — la orden de un HIJO encuentra el desarrollo de su PADRE.
   *
   * 🔴 El segundo bloqueante de la etapa, y el de síntoma más traicionero: con `idModelo:
   * orden.idModelo` a pelo, esta consulta devolvía **CERO candidatos** para toda orden nacida por
   * color. No un error — una lista vacía, que la pantalla enseña como *"esta orden no tiene
   * desarrollo"*. La prueba de arriba (`candidato null`) es su control negativo: las dos caen por
   * separado.
   */
  it('⭐⭐ propone el desarrollo del PADRE para la orden de un modelo nacido por color', async () => {
    const idDesarrollo = await nuevoDesarrollo(modeloA.id);
    const idPrecosto = await congelarPrecosto(idDesarrollo, 50);
    await crearListaLinea(idDesarrollo, idPrecosto, {
      costoUnit: 50,
      precioCalculado: 100,
      precioAprobado: 130,
    });
    const hijo = await cliente.modelo.create({
      data: {
        codigo: `71${String(codigoSeq++).padStart(3, '0')}`,
        origen: 'produccion',
        idModeloDesarrollo: modeloA.id,
      },
    });
    const idOrden = await nuevaOrden(hijo.id, clienteNegocio.id);

    const sug = await sugerenciaLigaOrden(sesion(), idOrden, bd());

    expect(sug.candidato?.idDesarrollo).toBe(idDesarrollo);
    expect(sug.candidato?.precioSugeridoPedido).toBeCloseTo(130);
  });
});

describe('expedienteOrden — vista 360', () => {
  it('arma el expediente completo de una orden ligada', async () => {
    const idDesarrollo = await nuevoDesarrollo(modeloA.id);
    const idPrecosto = await congelarPrecosto(idDesarrollo, 55);
    const { idLinea } = await crearListaLinea(idDesarrollo, idPrecosto, {
      costoUnit: 55,
      precioCalculado: 110,
      precioAprobado: 120,
    });
    await cliente.negociacionEvento.create({
      data: { idListaLinea: idLinea, precioAnterior: 100, precioNuevo: 120, acuerdo: 'cerrado' },
    });
    const idOrden = await nuevaOrden(modeloA.id, clienteNegocio.id);
    await ligarOrden(sesion(), idOrden, { idDesarrollo }, bd());

    const exp = await expedienteOrden(sesion(), idOrden, bd());
    expect(exp.idDesarrollo).toBe(idDesarrollo);
    expect(exp.codigoModelo).toBe('A-100');
    expect(exp.nombreCliente).toBe('C&A');
    expect(exp.nombreDepartamento).toBe('NIÑOS');
    expect(exp.estadoDesarrollo).toBe('ligado-produccion');
    expect(exp.precostoVigente?.costoTotal).toBeCloseTo(55);
    expect(exp.lista?.precio).toBeCloseTo(120);
    expect(exp.lista?.aprobado).toBe(true);
    expect(exp.acuerdos).toHaveLength(1);
    expect(exp.acuerdos[0]?.precioNuevo).toBeCloseTo(120);
  });

  it('oculta importes sin consultas.ver-importes', async () => {
    const idDesarrollo = await nuevoDesarrollo(modeloA.id);
    const idPrecosto = await congelarPrecosto(idDesarrollo, 55);
    const { idLinea } = await crearListaLinea(idDesarrollo, idPrecosto, {
      costoUnit: 55,
      precioCalculado: 110,
      precioAprobado: 120,
    });
    await cliente.negociacionEvento.create({
      data: { idListaLinea: idLinea, precioAnterior: 100, precioNuevo: 120, acuerdo: 'cerrado' },
    });
    const idOrden = await nuevaOrden(modeloA.id, clienteNegocio.id);
    await ligarOrden(sesion(), idOrden, { idDesarrollo }, bd());

    const exp = await expedienteOrden(sesion(['desarrollo.ver']), idOrden, bd());
    expect(exp.precostoVigente?.costoTotal).toBeNull();
    expect(exp.lista?.precio).toBeNull();
    expect(exp.acuerdos[0]?.precioNuevo).toBeNull();
  });

  it('orden sin liga → ErrorNoEncontrado', async () => {
    const idOrden = await nuevaOrden(modeloA.id, clienteNegocio.id);
    await expect(expedienteOrden(sesion(), idOrden, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });
});

describe('tableroDesarrollos — conteos por estado (agregado en el servidor)', () => {
  it('cuenta por estado derivado y filtra por cliente', async () => {
    // en-desarrollo (sin precosto)
    await nuevoDesarrollo(modeloA.id);
    // cotizado (congelado, sin lista)
    const cotizado = await nuevoDesarrollo(modeloB.id);
    await congelarPrecosto(cotizado, 40);
    // apagado
    await nuevoDesarrollo(modeloA.id, { apagado: true });
    // de OTRO cliente (no debe contar al filtrar por clienteNegocio)
    const departamentoOtro = await cliente.clienteDepartamento.create({
      data: { idCliente: clienteOtro.id, nombre: 'DAMA' },
    });
    const proyectoOtro = await cliente.proyecto.create({
      data: {
        folio: BigInt(folioSeq++),
        idEmpresa: empresa.id,
        idCliente: clienteOtro.id,
        idClienteDepartamento: departamentoOtro.id,
        nombre: 'Otro',
      },
    });
    await cliente.desarrollo.create({
      data: { idProyecto: proyectoOtro.id, idModelo: modeloA.id },
    });

    const todos = await tableroDesarrollos(sesion(), {}, bd());
    expect(todos.total).toBe(4);
    expect(todos.enDesarrollo).toBe(2); // el de clienteNegocio + el de clienteOtro
    expect(todos.cotizado).toBe(1);
    expect(todos.apagado).toBe(1);

    const soloCliente = await tableroDesarrollos(sesion(), { idCliente: clienteNegocio.id }, bd());
    expect(soloCliente.total).toBe(3);
    expect(soloCliente.enDesarrollo).toBe(1);
    expect(soloCliente.cotizado).toBe(1);
    expect(soloCliente.apagado).toBe(1);
  });
});

describe('A9 — aislamiento cross-empresa', () => {
  /** Monta una empresa B con su propio cliente/proyecto/desarrollo/orden (modelo global A). */
  async function montarEmpresaB(): Promise<{
    sesionB: SesionUsuario;
    idDesarrolloB: number;
    idOrdenB: number;
  }> {
    const empresaB = await crearEmpresaPrueba(cliente, `Empresa B ${codigoSeq++}`);
    const clienteB = await cliente.cliente.create({ data: { nombre: `ClienteB ${codigoSeq++}` } });
    const deptoB = await cliente.clienteDepartamento.create({
      data: { idCliente: clienteB.id, nombre: 'DEPB' },
    });
    const proyB = await cliente.proyecto.create({
      data: {
        folio: BigInt(folioSeq++),
        idEmpresa: empresaB.id,
        idCliente: clienteB.id,
        idClienteDepartamento: deptoB.id,
        nombre: 'PB',
      },
    });
    const desB = await cliente.desarrollo.create({
      data: { idProyecto: proyB.id, idModelo: modeloA.id },
    });
    const ordB = await cliente.orden.create({
      data: {
        folio: BigInt(folioSeq++),
        idEmpresa: empresaB.id,
        idModelo: modeloA.id,
        idCliente: clienteB.id,
        estado: 'capturada',
      },
    });
    const sesionB = sesionDePrueba({ idEmpresaActiva: empresaB.id, permisos: PERM_TODOS });
    return { sesionB, idDesarrolloB: desB.id, idOrdenB: ordB.id };
  }

  it('A no puede ligar una orden de B (ErrorNoEncontrado)', async () => {
    const b = await montarEmpresaB();
    const idDesarrolloA = await nuevoDesarrollo(modeloA.id);
    await expect(
      ligarOrden(sesion(), b.idOrdenB, { idDesarrollo: idDesarrolloA }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('A no puede ligar a un desarrollo de B (ErrorNoEncontrado)', async () => {
    const b = await montarEmpresaB();
    const idOrdenA = await nuevaOrden(modeloA.id, clienteNegocio.id);
    await expect(
      ligarOrden(sesion(), idOrdenA, { idDesarrollo: b.idDesarrolloB }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('A no ve el expediente/sugerencia/quitar de una orden ligada de B', async () => {
    const b = await montarEmpresaB();
    await ligarOrden(b.sesionB, b.idOrdenB, { idDesarrollo: b.idDesarrolloB }, bd());
    await expect(expedienteOrden(sesion(), b.idOrdenB, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
    await expect(sugerenciaLigaOrden(sesion(), b.idOrdenB, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
    await expect(quitarLiga(sesion(), b.idOrdenB, bd())).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('el tablero de A no cuenta desarrollos de B', async () => {
    await nuevoDesarrollo(modeloA.id); // 1 en A
    await montarEmpresaB(); // 1 en B (no debe contar)
    const t = await tableroDesarrollos(sesion(), {}, bd());
    expect(t.total).toBe(1);
  });

  it('MUST-FIX 1: un renglón de lista de OTRA empresa NO filtra el precio propuesto', async () => {
    // Desarrollo D en empresa A, pero con su ÚNICO renglón de lista en una empresa B (construido directo).
    const idDesarrollo = await nuevoDesarrollo(modeloA.id);
    const idPrecosto = await congelarPrecosto(idDesarrollo, 50);
    const empresaB = await crearEmpresaPrueba(cliente, `Empresa B lista ${codigoSeq++}`);
    const estadoB = await cliente.estadoLista.create({
      data: { codigo: `abierta-${codigoSeq++}`, nombre: 'Abierta' },
    });
    const listaB = await cliente.listaPrecios.create({
      data: {
        folio: BigInt(folioSeq++),
        idEmpresa: empresaB.id,
        idCliente: clienteNegocio.id,
        idClienteDepartamento: departamento.id,
        fecha: new Date('2026-07-01'),
        idEstadoLista: estadoB.id,
        margenPct: 0,
        descuentosPct: 0,
        regaliasPct: 0,
        costoVentasPct: 0,
      },
    });
    await cliente.listaPreciosLinea.create({
      data: {
        idLista: listaB.id,
        idDesarrollo,
        idPrecosto,
        costoUnit: 50,
        precioCalculado: 100,
        precioAprobado: 999,
      },
    });
    const idOrden = await nuevaOrden(modeloA.id, clienteNegocio.id);

    // Candidato encontrado (mismo modelo/cliente/empresa A), pero SIN precio: la lista es de B (se filtra).
    const sug = await sugerenciaLigaOrden(sesion(), idOrden, bd());
    expect(sug.candidato?.idDesarrollo).toBe(idDesarrollo);
    expect(sug.candidato?.precioSugeridoPedido).toBeNull();
    expect(sug.candidato?.idListaLinea).toBeNull();
  });
});
