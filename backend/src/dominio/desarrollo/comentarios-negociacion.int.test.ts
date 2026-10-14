/**
 * ⭐⭐ Integración de los COMENTARIOS de la negociación (fila 0.238, §Post-F9.248(b)) contra
 * Postgres de verdad.
 *
 * Daniel, sobre Aurora: *«las listas negociar **solo de lectura y poder agregar comentarios**, pero
 * no modificar lo que yo hice»*. Lo que se mide aquí:
 *  • con SÓLO `listas.comentar` (+ `listas.ver`) el comentario SE GUARDA, con autor, fecha, lista y
 *    renglón opcional, y deja su bitácora (A7);
 *  • comentar NO altera nada de lo negociado: precios del renglón, eventos de ronda, el «último
 *    precio de la negociación», la calculadora y la mesa dan EXACTAMENTE lo mismo antes y después;
 *  • el renglón tiene que ser de ESA lista; una lista de otra empresa no existe (A9);
 *  • una lista CERRADA se sigue pudiendo comentar (un comentario no es el papel);
 *  • quitar el renglón o borrar la lista FOTOGRAFÍA sus comentarios en la bitácora antes de la
 *    cascada (D3: lo que muere no desaparece sin rastro).
 */
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import type { ClavePermiso, RenglonMesa } from '../../contrato/index.js';
import { ErrorNoEncontrado, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
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
import { guardarFactoresCliente } from './cliente-factores.js';
import { comentarNegociacion, listarComentariosNegociacion } from './comentarios-negociacion.js';
import { crearDesarrollo } from './desarrollos.js';
import {
  crearLista,
  eliminarLista,
  NAMESPACE_LOCK_LISTA,
  obtenerLista,
  quitarLineaLista,
} from './listas-precios.js';
import {
  cambiarEstadoLista,
  listarEventosDeLinea,
  registrarAcuerdo,
  simularMesa,
  simularNegociacion,
} from './negociacion.js';
import { congelarVersion, generarPrecosto } from './precostos.js';
import { crearProyecto } from './proyectos.js';

let cliente: PrismaClient;
let empresa: Empresa;
let clienteNegocio: Cliente;
let departamento: ClienteDepartamento;
let estadoCerrada: EstadoLista;

/** El dueño: todo lo de la lista. */
const PERM_DUENO: ClavePermiso[] = [
  'desarrollo.ver',
  'desarrollo.administrar',
  'desarrollo.precostear',
  'listas.ver',
  'listas.administrar',
  'listas.aprobar',
  'listas.negociar',
  'consultas.ver-importes',
];
/** Aurora: lee la negociación y COMENTA; no negocia. */
const PERM_AURORA: ClavePermiso[] = [
  'listas.ver',
  'listas.administrar',
  'listas.comentar',
  'consultas.ver-importes',
];

const bd = () => ({ cliente });
const dueno = (): SesionUsuario =>
  sesionDePrueba({ id: 'usuario-dueno', idEmpresaActiva: empresa.id, permisos: PERM_DUENO });
const aurora = (): SesionUsuario =>
  sesionDePrueba({ id: 'usuario-aurora', idEmpresaActiva: empresa.id, permisos: PERM_AURORA });

async function sembrarBase(): Promise<void> {
  const conceptos = [
    { codigo: 'tela', nombre: 'Tela', orden: 1, fijo: true },
    { codigo: 'avios', nombre: 'Avíos', orden: 2, fijo: true },
    { codigo: 'maquila', nombre: 'Maquila', orden: 3, fijo: true },
    { codigo: 'bordado', nombre: 'Bordado', orden: 5, fijo: false },
    { codigo: 'corte', nombre: 'Corte', orden: 8, fijo: true },
    { codigo: 'empaque', nombre: 'Empaque', orden: 9, fijo: true },
  ];
  for (const c of conceptos) {
    await cliente.conceptoCosto.create({ data: c });
  }
  await cliente.estadoLista.create({
    data: { codigo: 'abierta', nombre: 'Abierta', orden: 1, esCierre: false },
  });
  estadoCerrada = await cliente.estadoLista.create({
    data: { codigo: 'cerrada', nombre: 'Cerrada', orden: 3, esCierre: true },
  });
}

/** Desarrollo con precosto CONGELADO (tela 1.5×20 + maquila 10 + empaque). */
async function desarrolloConPrecosto(codigoModelo: string): Promise<number> {
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
    dueno(),
    { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, nombre: 'Joggers' },
    bd(),
  );
  const desarrollo = await crearDesarrollo(dueno(), proyecto.id, { idModelo: modelo.id }, bd());
  const precosto = await generarPrecosto(dueno(), desarrollo.id, bd());
  await congelarVersion(dueno(), precosto.id, bd());
  return desarrollo.id;
}

async function crearListaCon(idsDesarrollo: number[]) {
  return crearLista(
    dueno(),
    { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo },
    bd(),
  );
}

const RENGLONES_MESA: RenglonMesa[] = [
  {
    conceptoCodigo: 'tela',
    conceptoNombre: 'Tela',
    etiqueta: 'Felpa',
    consumo: 1.5,
    precioUnit: 20,
  },
  {
    conceptoCodigo: 'maquila',
    conceptoNombre: 'Maquila',
    etiqueta: 'Costura',
    consumo: null,
    precioUnit: 10,
  },
];

/** Todo lo que «lo negociado» dice de una lista, para compararlo antes y después de comentar. */
async function fotoDeLoNegociado(idLista: number) {
  const lista = await obtenerLista(dueno(), idLista, bd());
  const porRenglon = [];
  for (const linea of lista.lineas) {
    porRenglon.push({
      eventos: await listarEventosDeLinea(dueno(), linea.id, bd()),
      calculadora: await simularNegociacion(dueno(), linea.id, { precioObjetivo: 120 }, bd()),
      mesa: await simularMesa(
        dueno(),
        linea.id,
        { renglones: RENGLONES_MESA, precioObjetivo: 120 },
        bd(),
      ),
    });
  }
  return {
    lineas: lista.lineas,
    estado: lista.idEstadoLista,
    porRenglon,
    eventosEnBase: await cliente.negociacionEvento.count(),
  };
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
  await guardarFactoresCliente(
    dueno(),
    clienteNegocio.id,
    { margenPct: 50, descuentosPct: 10, regaliasPct: 5, costoVentasPct: 5 },
    bd(),
  );
});

describe('0.238 — comentar la negociación', () => {
  it('⭐ con SÓLO `listas.comentar` se guarda (lista y renglón), con autor y bitácora', async () => {
    const lista = await crearListaCon([await desarrolloConPrecosto('MOD-COM-1')]);
    const idLinea = lista.lineas[0]!.id;

    const deLista = await comentarNegociacion(
      aurora(),
      lista.id,
      { texto: '  El cliente quiere ver la muestra antes del jueves  ' },
      bd(),
    );
    const deRenglon = await comentarNegociacion(
      aurora(),
      lista.id,
      { texto: 'Este modelo lo quiere en dos colores', idLinea },
      bd(),
    );

    expect(deLista.texto).toBe('El cliente quiere ver la muestra antes del jueves');
    expect(deLista.idListaLinea).toBeNull();
    expect(deLista.codigoModelo).toBeNull();
    expect(deLista.registradoPorId).toBe('usuario-aurora');
    expect(deRenglon.idListaLinea).toBe(idLinea);
    expect(deRenglon.codigoModelo).toBe('MOD-COM-1');

    // Se LEEN con sólo `listas.ver`, en orden cronológico.
    const soloVer = sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: ['listas.ver'] });
    const leidos = await listarComentariosNegociacion(soloVer, lista.id, bd());
    expect(leidos.map((c) => c.id)).toEqual([deLista.id, deRenglon.id]);

    // Bitácora sobre la LISTA (A7), una por comentario.
    const bitacora = await cliente.bitacora.findMany({
      where: { entidad: 'ListaPrecios', idEntidad: String(lista.id) },
      orderBy: { id: 'asc' },
    });
    const deComentar = bitacora.filter(
      (b) => (b.datos as { operacion?: string } | null)?.operacion === 'comentar',
    );
    expect(deComentar).toHaveLength(2);
    expect(deComentar[1]!.datos).toMatchObject({ idComentario: deRenglon.id, idLinea });
    expect(deComentar[1]!.idUsuario).toBe('usuario-aurora');
  });

  it('⭐⭐ comentar NO altera nada de lo negociado: precios, eventos, último negociado, calculadora y mesa', async () => {
    const lista = await crearListaCon([
      await desarrolloConPrecosto('MOD-COM-A'),
      await desarrolloConPrecosto('MOD-COM-B'),
    ]);
    const idLinea = lista.lineas[0]!.id;
    // Un acuerdo CON precio: así el «último precio de la negociación» no es null y se puede medir.
    await registrarAcuerdo(
      dueno(),
      idLinea,
      { acuerdo: 'Pactado a 118', precioAcordado: 118 },
      bd(),
    );

    const antes = await fotoDeLoNegociado(lista.id);
    expect(antes.lineas[0]!.precioNegociado).toBe(118);
    expect(antes.eventosEnBase).toBe(1);

    await comentarNegociacion(aurora(), lista.id, { texto: 'Le pareció caro' }, bd());
    await comentarNegociacion(aurora(), lista.id, { texto: 'Pide bajar a 110', idLinea }, bd());

    const despues = await fotoDeLoNegociado(lista.id);
    expect(despues).toEqual(antes);
    // Ni un evento de negociación nuevo: el comentario vive en su propia tabla.
    expect(await cliente.negociacionEvento.count()).toBe(1);
    expect(await cliente.negociacionComentario.count()).toBe(2);
  });

  it('⛔ sin `listas.comentar` ni `listas.negociar` se niega; con `listas.negociar` pasa', async () => {
    const lista = await crearListaCon([await desarrolloConPrecosto('MOD-COM-P')]);
    const soloVer = sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: ['listas.ver'] });
    await expect(
      comentarNegociacion(soloVer, lista.id, { texto: 'No debería entrar' }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    const negociador = await comentarNegociacion(
      dueno(),
      lista.id,
      { texto: 'El dueño también comenta' },
      bd(),
    );
    expect(negociador.registradoPorId).toBe('usuario-dueno');
    expect(await cliente.negociacionComentario.count()).toBe(1);
  });

  it('el renglón tiene que ser de ESA lista; una lista de otra empresa no existe (A9); texto vacío no', async () => {
    const lista1 = await crearListaCon([await desarrolloConPrecosto('MOD-COM-X')]);
    const lista2 = await crearListaCon([await desarrolloConPrecosto('MOD-COM-Y')]);

    await expect(
      comentarNegociacion(
        aurora(),
        lista1.id,
        { texto: 'Renglón ajeno', idLinea: lista2.lineas[0]!.id },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    await expect(
      comentarNegociacion(aurora(), lista1.id, { texto: 'No existe', idLinea: 999_999 }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    await expect(
      comentarNegociacion(aurora(), lista1.id, { texto: '   ' }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    const otra = await crearEmpresaPrueba(cliente, 'Otra SA');
    const deOtra = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM_AURORA });
    await expect(
      comentarNegociacion(deOtra, lista1.id, { texto: 'De otra empresa' }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    await expect(listarComentariosNegociacion(deOtra, lista1.id, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
    expect(await cliente.negociacionComentario.count()).toBe(0);
  });

  it('una lista CERRADA se sigue pudiendo comentar (un comentario no es el papel)', async () => {
    const lista = await crearListaCon([await desarrolloConPrecosto('MOD-COM-C')]);
    await cambiarEstadoLista(dueno(), lista.id, { idEstadoLista: estadoCerrada.id }, bd());
    const comentario = await comentarNegociacion(
      aurora(),
      lista.id,
      { texto: 'El cliente pidió reabrir', idLinea: lista.lineas[0]!.id },
      bd(),
    );
    expect(comentario.id).toBeGreaterThan(0);
  });

  it('quitar el renglón y borrar la lista FOTOGRAFÍAN sus comentarios antes de la cascada (D3)', async () => {
    const lista = await crearListaCon([
      await desarrolloConPrecosto('MOD-COM-Q1'),
      await desarrolloConPrecosto('MOD-COM-Q2'),
    ]);
    const [linea1, linea2] = lista.lineas;
    const deLista = await comentarNegociacion(aurora(), lista.id, { texto: 'General' }, bd());
    const delQuitado = await comentarNegociacion(
      aurora(),
      lista.id,
      { texto: 'Del modelo que se va', idLinea: linea1!.id },
      bd(),
    );
    await comentarNegociacion(
      aurora(),
      lista.id,
      { texto: 'Del que se queda', idLinea: linea2!.id },
      bd(),
    );

    await quitarLineaLista(dueno(), linea1!.id, bd());
    const quitar = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'ListaPrecios', idEntidad: String(lista.id) },
      orderBy: { id: 'desc' },
    });
    const datosQuitar = quitar.datos as { operacion: string; comentarios: { id: number }[] };
    expect(datosQuitar.operacion).toBe('quitar-linea');
    expect(datosQuitar.comentarios.map((c) => c.id)).toEqual([delQuitado.id]);
    // El de la lista y el del otro renglón siguen ahí.
    const quedan = await listarComentariosNegociacion(aurora(), lista.id, bd());
    expect(quedan.map((c) => c.texto)).toEqual(['General', 'Del que se queda']);

    await eliminarLista(dueno(), lista.id, bd());
    const borrar = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'ListaPrecios', idEntidad: String(lista.id) },
      orderBy: { id: 'desc' },
    });
    const datosBorrar = borrar.datos as {
      operacion: string;
      antes: { comentarios: { id: number }[] };
    };
    expect(datosBorrar.operacion).toBe('eliminar-lista');
    expect(datosBorrar.antes.comentarios.map((c) => c.id)).toContain(deLista.id);
    expect(datosBorrar.antes.comentarios).toHaveLength(2);
    expect(await cliente.negociacionComentario.count()).toBe(0);
  });
});

/**
 * ⭐⭐ LA CARRERA CONTRA EL BORRADO (hallazgo del reviewer de la 0.238).
 *
 * `comentarNegociacion` toma el advisory lock de la lista —el mismo de `quitarLineaLista` y
 * `eliminarLista`— y RE-LEE la lista (y el renglón) bajo él. Aquí OTRA conexión (un `pg.Client`
 * aparte, fuera del pool de Prisma) toma ese lock, borra y confirma MIENTRAS el comentario espera.
 *
 * Lo esperado: el comentario sale con el 404 del dominio (`ErrorNoEncontrado`), nunca con el error
 * crudo de la FK (`negociacion_comentario_id_lista_fkey`, un 500), y no queda ningún comentario
 * huérfano ni a medias. Sin el lock —o sin la re-lectura— el `create` llega a la FK y revienta.
 */
describe('0.238 — concurrencia: comentar mientras otro borra', () => {
  /** Espera a que haya ALGUNA espera de lock en la base: el comentario ya está bloqueado. */
  async function esperarQueAlguienEspere(): Promise<void> {
    for (let intento = 0; intento < 200; intento += 1) {
      const filas = await cliente.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_locks WHERE NOT granted
      `;
      if (Number(filas[0]?.n ?? 0) > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('el comentario nunca se quedó esperando un lock');
  }

  /**
   * Abre otra conexión, toma el lock de la lista, ejecuta `borrar` y deja la transacción ABIERTA;
   * devuelve la función que la confirma.
   */
  async function borrarBajoElLock(
    idLista: number,
    borrar: (c: pg.Client) => Promise<unknown>,
  ): Promise<{ confirmar: () => Promise<void> }> {
    const otra = new pg.Client({ connectionString: inject('urlBaseDatosPruebas') });
    await otra.connect();
    await otra.query('BEGIN');
    await otra.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [
      NAMESPACE_LOCK_LISTA,
      idLista,
    ]);
    await borrar(otra);
    return {
      confirmar: async () => {
        await otra.query('COMMIT');
        await otra.end();
      },
    };
  }

  it('⭐ si BORRAN LA LISTA mientras espera el lock, sale 404 (no el 500 de la FK)', async () => {
    const lista = await crearListaCon([await desarrolloConPrecosto('MOD-CARRERA-L')]);
    const otra = await borrarBajoElLock(lista.id, (c) =>
      c.query('DELETE FROM "lista_precios" WHERE "id" = $1', [lista.id]),
    );

    const comentando = comentarNegociacion(
      aurora(),
      lista.id,
      { texto: 'Llegó tarde' },
      bd(),
    ).catch((e: unknown) => e);
    await esperarQueAlguienEspere();
    await otra.confirmar();

    const resultado = await comentando;
    expect(resultado).toBeInstanceOf(ErrorNoEncontrado);
    expect((resultado as ErrorNoEncontrado).entidad).toBe('Lista de precios');
    expect(await cliente.listaPrecios.count({ where: { id: lista.id } })).toBe(0);
    expect(await cliente.negociacionComentario.count()).toBe(0);
  });

  it('⭐ si QUITAN EL RENGLÓN mientras espera el lock, sale 404 del renglón; la lista queda sana', async () => {
    const lista = await crearListaCon([
      await desarrolloConPrecosto('MOD-CARRERA-R1'),
      await desarrolloConPrecosto('MOD-CARRERA-R2'),
    ]);
    const idLinea = lista.lineas[0]!.id;
    const otra = await borrarBajoElLock(lista.id, (c) =>
      c.query('DELETE FROM "lista_precios_linea" WHERE "id" = $1', [idLinea]),
    );

    const comentando = comentarNegociacion(
      aurora(),
      lista.id,
      { texto: 'Sobre el modelo que se va', idLinea },
      bd(),
    ).catch((e: unknown) => e);
    await esperarQueAlguienEspere();
    await otra.confirmar();

    const resultado = await comentando;
    expect(resultado).toBeInstanceOf(ErrorNoEncontrado);
    expect((resultado as ErrorNoEncontrado).entidad).toBe('Renglón de lista de precios');
    expect(await cliente.negociacionComentario.count()).toBe(0);
    // La lista sigue, con su otro renglón, y se puede seguir comentando.
    const despues = await comentarNegociacion(aurora(), lista.id, { texto: 'Sigue viva' }, bd());
    expect(despues.idLista).toBe(lista.id);
  });
});
