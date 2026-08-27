/**
 * Integración de la LISTA DE PRECIOS + FACTORES del cliente (F8-E4) contra el Postgres efímero
 * (testcontainers). Cubre: crear exige precosto CONGELADO (faltantes listados), snapshot de factores,
 * precioCalculado por la fórmula, folio A3, estado `abierta`, el desarrollo pasa a "en-lista", editar
 * factores recalcula sin pisar aprobados, aprobar/ajustar sellan quién/cuándo, candidatos, ocultación
 * de importes, unicidad lista+desarrollo (dedup) y scope por empresa A9. NO corre en local (Docker): CI.
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
  PrismaClient,
  Tela,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { actualizarModelo } from '../modelos/modelos.js';
import { reemplazarTelasBom } from '../modelos/bom-modelo.js';
import { apagarDesarrollo, crearDesarrollo, obtenerDesarrollo } from './desarrollos.js';
import { crearProyecto } from './proyectos.js';
import { congelarVersion, generarPrecosto } from './precostos.js';
import { guardarFactoresCliente } from './cliente-factores.js';
import { registrarRonda } from './negociacion.js';
import {
  ajustarPrecioLinea,
  aprobarLinea,
  candidatosParaLista,
  crearLista,
  desgloseCostoLinea,
  diagnosticoCandidatosLista,
  editarFactoresLista,
  eliminarLista,
  listarListas,
  obtenerLista,
  quitarLineaLista,
} from './listas-precios.js';

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
    { codigo: 'bordado', nombre: 'Bordado', orden: 5, fijo: false },
    { codigo: 'corte', nombre: 'Corte', orden: 8, fijo: true },
  ];
  for (const c of conceptos) {
    await cliente.conceptoCosto.create({ data: c });
  }
  await cliente.estadoLista.create({
    data: { codigo: 'abierta', nombre: 'Abierta', orden: 1, esCierre: false },
  });
  // Estado de CIERRE (espejo del seed real, `prisma/seed.ts`): sin él, la prueba de la guarda
  // `esCierre` moría en su `findFirstOrThrow` ANTES de ejercitar nada — o sea, la promesa "una
  // lista cerrada no se toca" no la verificaba nadie. (Hallazgo del reviewer de V1-E4.)
  await cliente.estadoLista.create({
    data: { codigo: 'cerrada', nombre: 'Cerrada', orden: 3, esCierre: true },
  });
}

/**
 * Crea un desarrollo con precosto CONGELADO de costoTotal = 40 (tela 1.5×20 + maquila 10). Devuelve el
 * id del desarrollo. Si `congelar=false`, deja el precosto en borrador (para el caso "sin congelado").
 */
async function desarrolloConPrecosto(
  codigoModelo: string,
  congelar = true,
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
  if (congelar) {
    await congelarVersion(s, precosto.id, bd());
  }
  return desarrollo.id;
}

/**
 * Crea un desarrollo con precosto CONGELADO de costo 0 (modelo sin tela y maquila 0).
 *
 * ⚠️ El congelado se sella DIRECTO EN BD, no por `congelarVersion`: desde V1-E4 (punto 2) el
 * dominio ya NO deja congelar en cero (`exigirCostoCongelable`), justamente porque esa versión
 * inmutable acababa de base de un precio al cliente. La situación sigue siendo alcanzable con
 * datos VIEJOS (congelados antes del guard, o traídos por ETL), así que la defensa de aguas abajo
 * —"aprobar rechaza el renglón en 0"— se conserva y se prueba sembrando ese estado a mano.
 */
async function desarrolloCostoCero(codigoModelo: string): Promise<number> {
  const modelo = await cliente.modelo.create({ data: { codigo: codigoModelo, maquilaBase: 0 } });
  const proyecto = await crearProyecto(
    sesion(),
    { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, nombre: 'Cero' },
    bd(),
  );
  const desarrollo = await crearDesarrollo(sesion(), proyecto.id, { idModelo: modelo.id }, bd());
  const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());
  await cliente.precosto.update({
    where: { id: precosto.id },
    data: {
      estado: 'congelado',
      congeladoEn: new Date(),
      congeladoPorId: 'usuario-prueba',
      costoTotal: 0,
    },
  });
  return desarrollo.id;
}

/** Factores 50/10/5/5 → costo 40 ⇒ base 80, suma 20 ⇒ 80/0.8 = 100 (precioCalculado). */
async function sembrarFactores(
  margenPct = 50,
  descuentosPct = 10,
  regaliasPct = 5,
  costoVentasPct = 5,
): Promise<void> {
  await guardarFactoresCliente(
    sesion(),
    clienteNegocio.id,
    { margenPct, descuentosPct, regaliasPct, costoVentasPct },
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
});

describe('crearLista — precostos congelados + snapshot de factores', () => {
  it('crea una lista abierta con un renglón por desarrollo y el precio calculado', async () => {
    await sembrarFactores();
    const idA = await desarrolloConPrecosto('MOD-A');
    const idB = await desarrolloConPrecosto('MOD-B');

    const lista = await crearLista(
      sesion(),
      {
        idCliente: clienteNegocio.id,
        idClienteDepartamento: departamento.id,
        idsDesarrollo: [idA, idB],
      },
      bd(),
    );

    expect(lista.folio).toBe(1);
    expect(lista.codigoEstado).toBe('abierta');
    expect(lista.margenPct).toBe(50);
    expect(lista.lineas).toHaveLength(2);
    for (const linea of lista.lineas) {
      expect(linea.costoUnit).toBe(40);
      expect(linea.precioCalculado).toBe(100); // 40/(1-0.5)=80 → 80/(1-0.20)=100
      expect(linea.precioAprobado).toBeNull();
      expect(linea.aprobado).toBe(false);
    }
  });

  it('el folio es consecutivo por empresa (A3)', async () => {
    await sembrarFactores();
    const id1 = await desarrolloConPrecosto('MOD-1');
    const id2 = await desarrolloConPrecosto('MOD-2');
    const l1 = await crearLista(
      sesion(),
      {
        idCliente: clienteNegocio.id,
        idClienteDepartamento: departamento.id,
        idsDesarrollo: [id1],
      },
      bd(),
    );
    const l2 = await crearLista(
      sesion(),
      {
        idCliente: clienteNegocio.id,
        idClienteDepartamento: departamento.id,
        idsDesarrollo: [id2],
      },
      bd(),
    );
    expect(l1.folio).toBe(1);
    expect(l2.folio).toBe(2);
  });

  it('el desarrollo pasa a estado "en-lista" al entrar en un renglón', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-EST');
    const antes = await obtenerDesarrollo(sesion(), id, bd());
    expect(antes.estado).toBe('cotizado');
    await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const despues = await obtenerDesarrollo(sesion(), id, bd());
    expect(despues.estado).toBe('en-lista');
  });

  it('rechaza con la LISTA de faltantes si algún desarrollo no tiene precosto congelado', async () => {
    await sembrarFactores();
    const bueno = await desarrolloConPrecosto('MOD-OK');
    const malo = await desarrolloConPrecosto('MOD-SINCONGELAR', false);
    await expect(
      crearLista(
        sesion(),
        {
          idCliente: clienteNegocio.id,
          idClienteDepartamento: departamento.id,
          idsDesarrollo: [bueno, malo],
        },
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);
    await expect(
      crearLista(
        sesion(),
        {
          idCliente: clienteNegocio.id,
          idClienteDepartamento: departamento.id,
          idsDesarrollo: [bueno, malo],
        },
        bd(),
      ),
    ).rejects.toThrow(/MOD-SINCONGELAR/);
  });

  it('sin factores capturados → ErrorValidacion claro', async () => {
    const id = await desarrolloConPrecosto('MOD-NF');
    await expect(
      crearLista(
        sesion(),
        {
          idCliente: clienteNegocio.id,
          idClienteDepartamento: departamento.id,
          idsDesarrollo: [id],
        },
        bd(),
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('usa el OVERRIDE del departamento sobre el DEFAULT del cliente', async () => {
    await sembrarFactores(); // default 50/10/5/5 → 100
    await guardarFactoresCliente(
      sesion(),
      clienteNegocio.id,
      {
        idClienteDepartamento: departamento.id,
        margenPct: 0,
        descuentosPct: 0,
        regaliasPct: 0,
        costoVentasPct: 0,
      },
      bd(),
    );
    const id = await desarrolloConPrecosto('MOD-OVR');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    // Override todo-cero: precio = costo = 40.
    expect(lista.margenPct).toBe(0);
    expect(lista.lineas[0]?.precioCalculado).toBe(40);
  });

  it('dedup: el mismo desarrollo dos veces produce UN solo renglón', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-DUP');
    const lista = await crearLista(
      sesion(),
      {
        idCliente: clienteNegocio.id,
        idClienteDepartamento: departamento.id,
        idsDesarrollo: [id, id],
      },
      bd(),
    );
    expect(lista.lineas).toHaveLength(1);
  });

  it('rechaza un desarrollo que YA está en otra lista (a lo más una lista por desarrollo)', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-YAENLISTA');
    await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    await expect(
      crearLista(
        sesion(),
        {
          idCliente: clienteNegocio.id,
          idClienteDepartamento: departamento.id,
          idsDesarrollo: [id],
        },
        bd(),
      ),
    ).rejects.toThrow(/ya está en otra lista/);
  });

  it('rechaza un desarrollo que no es del cliente/departamento indicado', async () => {
    await sembrarFactores();
    const otroDepto = await cliente.clienteDepartamento.create({
      data: { idCliente: clienteNegocio.id, nombre: 'DAMAS' },
    });
    const id = await desarrolloConPrecosto('MOD-OTRO');
    await expect(
      crearLista(
        sesion(),
        { idCliente: clienteNegocio.id, idClienteDepartamento: otroDepto.id, idsDesarrollo: [id] },
        bd(),
      ),
    ).rejects.toThrow(ErrorValidacion);
  });
});

/**
 * ⭐ **V1-E8b (§Post-F9.125(a)+(d)).** Esta suite AFIRMABA LO CONTRARIO hasta la 0.038 —«recalcula
 * sin pisar aprobados»— y se invierte a propósito.
 *
 * La regla vieja se escribió como una cortesía (*no pisarle la firma al dueño*) y su efecto era el
 * contrario del propósito: dejaba un precio APROBADO que ya no correspondía a los factores con que
 * se calculó, y el sistema lo seguía presentando como firmado. Encima había DOS criterios para el
 * mismo hecho: `registrarRonda` sí reseteaba el aprobado al cambiar el costo. Hoy son uno.
 */
describe('editarFactoresLista — mueve los factores y TUMBA las aprobaciones (§Post-F9.125)', () => {
  it('recalcula TODOS los precioCalculado y limpia los precioAprobado que hubiera', async () => {
    await sembrarFactores();
    const idA = await desarrolloConPrecosto('MOD-EA');
    const idB = await desarrolloConPrecosto('MOD-EB');
    const lista = await crearLista(
      sesion(),
      {
        idCliente: clienteNegocio.id,
        idClienteDepartamento: departamento.id,
        idsDesarrollo: [idA, idB],
      },
      bd(),
    );

    // Aprueba el primer renglón (queda aprobado en 100).
    const idLineaA = lista.lineas[0]!.id;
    const conAprobado = await aprobarLinea(sesion(), idLineaA, bd());
    expect(conAprobado.lineas.find((l) => l.id === idLineaA)?.precioAprobado).toBe(100);

    // Edita factores a margen 60 (base 40/0.4=100, suma 20 → 125).
    const recalc = await editarFactoresLista(
      sesion(),
      lista.id,
      { margenPct: 60, descuentosPct: 10, regaliasPct: 5, costoVentasPct: 5 },
      bd(),
    );
    for (const linea of recalc.lineas) {
      expect(linea.precioCalculado).toBe(125);
    }
    // 🔴 La firma se CAE: el renglón A vuelve a quedar como uno sin aprobar (no hay estado muerto).
    const renglonA = recalc.lineas.find((l) => l.id === idLineaA);
    expect(renglonA?.precioAprobado).toBeNull();
    expect(renglonA?.aprobado).toBe(false);
    expect(renglonA?.aprobadoPorId).toBeNull();
    expect(renglonA?.aprobadoEn).toBeNull();
    expect(recalc.lineas.find((l) => l.id !== idLineaA)?.precioAprobado).toBeNull();
  });

  it('la firma vieja NO se borra: queda en el evento inmutable del renglón (D3)', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-EV');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const idLinea = lista.lineas[0]!.id;
    await aprobarLinea(sesion(), idLinea, bd());
    await editarFactoresLista(
      sesion(),
      lista.id,
      { margenPct: 60, descuentosPct: 10, regaliasPct: 5, costoVentasPct: 5 },
      bd(),
    );

    const eventos = await cliente.negociacionEvento.findMany({
      where: { idListaLinea: idLinea },
      orderBy: { id: 'asc' },
    });
    expect(eventos).toHaveLength(1);
    expect(Number(eventos[0]!.precioAnterior)).toBe(100);
    expect(Number(eventos[0]!.precioNuevo)).toBe(125);
    // Sin re-costeo: los factores se movieron, el costo no.
    expect(eventos[0]!.idPrecostoAnterior).toBeNull();
    expect(eventos[0]!.idPrecostoNuevo).toBeNull();
    expect(eventos[0]!.acuerdo).toContain('INVALIDÓ');

    // Y se puede volver a aprobar normalmente: no hay estado muerto.
    const revivida = await aprobarLinea(sesion(), idLinea, bd());
    expect(revivida.lineas[0]?.precioAprobado).toBe(125);
  });

  it('guardar los MISMOS factores no tumba ninguna firma', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-EI');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const idLinea = lista.lineas[0]!.id;
    await aprobarLinea(sesion(), idLinea, bd());
    const igual = await editarFactoresLista(
      sesion(),
      lista.id,
      { margenPct: 50, descuentosPct: 10, regaliasPct: 5, costoVentasPct: 5 },
      bd(),
    );
    expect(igual.lineas[0]?.precioAprobado).toBe(100);
    expect(await cliente.negociacionEvento.count({ where: { idListaLinea: idLinea } })).toBe(0);
  });

  it('🔴 (a) sin `listas.aprobar` NO se mueven los factores, aunque se administre la lista', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-EP');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    // El perfil de Desarrollo: administra listas y ve importes, pero no aprueba precios.
    const desarrollo = sesion(['listas.ver', 'listas.administrar', 'consultas.ver-importes']);
    await expect(
      editarFactoresLista(
        desarrollo,
        lista.id,
        { margenPct: 60, descuentosPct: 10, regaliasPct: 5, costoVentasPct: 5 },
        bd(),
      ),
    ).rejects.toThrow(ErrorPermiso);
    // Y no se movió nada.
    const intacta = await obtenerLista(sesion(), lista.id, bd());
    expect(intacta.margenPct).toBe(50);
  });

  it('🔴 (b) a quien ve importes pero no aprueba, los cuatro factores le llegan en null', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-EB2');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const desarrollo = sesion(['listas.ver', 'listas.administrar', 'consultas.ver-importes']);
    const vista = await obtenerLista(desarrollo, lista.id, bd());
    expect(vista.margenPct).toBeNull();
    expect(vista.descuentosPct).toBeNull();
    expect(vista.regaliasPct).toBeNull();
    expect(vista.costoVentasPct).toBeNull();
    // Su trabajo sigue: el COSTO y el PRECIO sí los ve (el límite que Daniel aceptó a sabiendas).
    expect(vista.lineas[0]?.costoUnit).toBe(40);
    expect(vista.lineas[0]?.precioCalculado).toBe(100);
  });
});

describe('aprobar / ajustar precio de un renglón', () => {
  it('aprobar fija precioAprobado = precioCalculado y sella quién/cuándo', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-AP');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const idLinea = lista.lineas[0]!.id;
    const s = sesion();
    const aprobada = await aprobarLinea(s, idLinea, bd());
    const linea = aprobada.lineas[0]!;
    expect(linea.precioAprobado).toBe(100);
    expect(linea.aprobado).toBe(true);
    expect(linea.aprobadoPorId).toBe(s.id);
    expect(linea.aprobadoEn).not.toBeNull();
  });

  it('ajustar teclea el precioAprobado (distinto del calculado) y sella', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-AJ');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const idLinea = lista.lineas[0]!.id;
    const ajustada = await ajustarPrecioLinea(sesion(), idLinea, { precio: 137 }, bd());
    const linea = ajustada.lineas[0]!;
    expect(linea.precioAprobado).toBe(137);
    expect(linea.precioCalculado).toBe(100); // el calculado no cambia
    expect(linea.aprobado).toBe(true);
  });

  it('ajustar con precio ≤ 0 lo rechaza', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-AJ0');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const idLinea = lista.lineas[0]!.id;
    await expect(ajustarPrecioLinea(sesion(), idLinea, { precio: 0 }, bd())).rejects.toThrow();
  });

  it('aprobar rechaza un renglón con precio calculado 0 (costo 0)', async () => {
    await sembrarFactores();
    const id = await desarrolloCostoCero('MOD-CERO');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    expect(lista.lineas[0]?.precioCalculado).toBe(0);
    const idLinea = lista.lineas[0]!.id;
    await expect(aprobarLinea(sesion(), idLinea, bd())).rejects.toThrow(ErrorConflicto);
  });

  it('sin listas.aprobar no se puede aprobar ni teclear', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-SINAP');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const idLinea = lista.lineas[0]!.id;
    const sinAprobar = sesion(['listas.ver']);
    await expect(aprobarLinea(sinAprobar, idLinea, bd())).rejects.toThrow(ErrorPermiso);
    await expect(ajustarPrecioLinea(sinAprobar, idLinea, { precio: 120 }, bd())).rejects.toThrow(
      ErrorPermiso,
    );
  });

  it('un renglón de OTRA empresa no se puede aprobar ni teclear (A9)', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-A9LIN');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const idLinea = lista.lineas[0]!.id;
    const otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa Linea');
    const sesionOtra = sesionDePrueba({ idEmpresaActiva: otraEmpresa.id, permisos: PERM });
    await expect(aprobarLinea(sesionOtra, idLinea, bd())).rejects.toThrow(ErrorNoEncontrado);
    await expect(ajustarPrecioLinea(sesionOtra, idLinea, { precio: 120 }, bd())).rejects.toThrow(
      ErrorNoEncontrado,
    );
  });
});

describe('candidatosParaLista', () => {
  it('lista los cotizados sin renglón en una lista y los excluye al meterlos', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-CAND');
    const antes = await candidatosParaLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id },
      bd(),
    );
    expect(antes.map((c) => c.idDesarrollo)).toContain(id);
    expect(antes.find((c) => c.idDesarrollo === id)?.costoTotal).toBe(40);

    await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const despues = await candidatosParaLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id },
      bd(),
    );
    expect(despues.map((c) => c.idDesarrollo)).not.toContain(id);
  });

  it('con idProyecto acota los candidatos a ESE proyecto (Daniel, ago-2026)', async () => {
    await sembrarFactores();
    // Dos proyectos del MISMO cliente+departamento, cada uno con su modelo cotizado.
    const idA = await desarrolloConPrecosto('MOD-PROY-A');
    const idB = await desarrolloConPrecosto('MOD-PROY-B');
    const a = await obtenerDesarrollo(sesion(), idA, bd());

    const todos = await candidatosParaLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id },
      bd(),
    );
    expect(todos.map((c) => c.idDesarrollo)).toEqual(expect.arrayContaining([idA, idB]));

    const soloA = await candidatosParaLista(
      sesion(),
      {
        idCliente: clienteNegocio.id,
        idClienteDepartamento: departamento.id,
        idProyecto: a.idProyecto,
      },
      bd(),
    );
    expect(soloA.map((c) => c.idDesarrollo)).toEqual([idA]);
  });

  it('un desarrollo SIN precosto congelado no es candidato', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-NOCAND', false);
    const candidatos = await candidatosParaLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id },
      bd(),
    );
    expect(candidatos.map((c) => c.idDesarrollo)).not.toContain(id);
  });
});

/**
 * ⭐ V1-E8f (§Post-F9.128) — POR QUÉ no hay candidatos. Daniel: *"Justo me sale la leyenda de que no
 * hay desarrollos disponibles"*. El diagnóstico trae a TODOS los desarrollos del cliente+departamento
 * (incluidos los apagados y los ya colocados, que el `where` viejo ni veía) y a cada uno le pone su
 * motivo. Estas pruebas van CONTRA BASE porque lo que se blinda aquí no es la regla (eso es unit, en
 * `listas-precios-candidatura.test.ts`) sino que la CONSULTA de verdad los traiga.
 */
describe('diagnosticoCandidatosLista (V1-E8f)', () => {
  /** Un desarrollo sin NINGÚN precosto (el helper de arriba siempre genera uno). */
  async function desarrolloSinPrecosto(codigoModelo: string): Promise<number> {
    const modelo = await cliente.modelo.create({ data: { codigo: codigoModelo, maquilaBase: 10 } });
    const proyecto = await crearProyecto(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, nombre: 'Sin costo' },
      bd(),
    );
    const desarrollo = await crearDesarrollo(sesion(), proyecto.id, { idModelo: modelo.id }, bd());
    return desarrollo.id;
  }

  /** Motivo con el que salió UN desarrollo (o `undefined` si no está entre los descartados). */
  function motivoDe(
    diagnostico: Awaited<ReturnType<typeof diagnosticoCandidatosLista>>,
    id: number,
  ): string | undefined {
    return diagnostico.descartados.find((d) => d.idDesarrollo === id)?.motivo;
  }

  // ⭐ EL CASO DE DANIEL, de punta a punta: el modelo existe, el precosto existe, pero se quedó en
  // BORRADOR — y hasta hoy el sistema sólo sabía decir "no hay desarrollos disponibles".
  it('el precosto en BORRADOR sale como descartado, con su motivo y su nº de versión', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-DIAG-BORR', false);
    const diagnostico = await diagnosticoCandidatosLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id },
      bd(),
    );
    expect(diagnostico.candidatos.map((c) => c.idDesarrollo)).not.toContain(id);
    const descartado = diagnostico.descartados.find((d) => d.idDesarrollo === id);
    expect(descartado?.motivo).toBe('precosto-borrador');
    // La versión se NOMBRA: el aviso puede decir "la v1 sigue en borrador", no una generalidad.
    expect(descartado?.versionPrecosto).toBe(1);
    expect(descartado?.codigoModelo).toBe('MOD-DIAG-BORR');
  });

  it('congelar el precosto lo MUEVE de descartado a candidato (la gemela)', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-DIAG-GEMELA', false);
    const antes = await diagnosticoCandidatosLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id },
      bd(),
    );
    expect(motivoDe(antes, id)).toBe('precosto-borrador');

    const precostos = await cliente.precosto.findMany({ where: { idDesarrollo: id } });
    await congelarVersion(sesion(), precostos[0]?.id ?? 0, bd());

    const despues = await diagnosticoCandidatosLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id },
      bd(),
    );
    expect(despues.candidatos.map((c) => c.idDesarrollo)).toContain(id);
    expect(motivoDe(despues, id)).toBeUndefined();
  });

  it('sin ningún precosto → «sin-precosto» (remedio distinto: precostear primero)', async () => {
    await sembrarFactores();
    const id = await desarrolloSinPrecosto('MOD-DIAG-SIN');
    const diagnostico = await diagnosticoCandidatosLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id },
      bd(),
    );
    expect(motivoDe(diagnostico, id)).toBe('sin-precosto');
  });

  it('el que YA está en una lista sale con el folio de ESA lista (para poder llevar ahí)', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-DIAG-ENLISTA');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const diagnostico = await diagnosticoCandidatosLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id },
      bd(),
    );
    const descartado = diagnostico.descartados.find((d) => d.idDesarrollo === id);
    expect(descartado?.motivo).toBe('ya-en-lista');
    expect(descartado?.idLista).toBe(lista.id);
    expect(descartado?.folioLista).toBe(lista.folio);
  });

  it('el APAGADO aparece (antes ni se veía) y gana a cualquier otro motivo', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-DIAG-APAG');
    await apagarDesarrollo(sesion(), id, { motivo: 'El cliente lo canceló' }, bd());
    const diagnostico = await diagnosticoCandidatosLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id },
      bd(),
    );
    expect(diagnostico.candidatos.map((c) => c.idDesarrollo)).not.toContain(id);
    expect(motivoDe(diagnostico, id)).toBe('apagado');
  });

  it('scope por empresa (A9): otra empresa no ve NI candidatos NI descartados', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-DIAG-A9', false);
    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa Diagnostico');
    const sesionOtra = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM });
    const diagnostico = await diagnosticoCandidatosLista(
      sesionOtra,
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id },
      bd(),
    );
    expect(diagnostico.candidatos).toHaveLength(0);
    expect(diagnostico.descartados.map((d) => d.idDesarrollo)).not.toContain(id);
  });
});

describe('ocultación de importes y scope por empresa (A9)', () => {
  // ⚠️ Dos rejas DISTINTAS sobre la misma respuesta: los importes se ocultan sin
  // `consultas.ver-importes`; los cuatro FACTORES, sin `listas.aprobar` (§Post-F9.125(b)). Esta sesión
  // (`listas.ver` a secas) no tiene ninguna de las dos, así que se apagan las dos cosas. El caso que
  // de verdad separa las rejas —ver importes pero NO factores— vive en la suite de `editarFactoresLista`.
  it('sin consultas.ver-importes ni listas.aprobar, oculta costo/precio y factores', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-OCU');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const sinImportes = sesion(['listas.ver']);
    const oculta = await obtenerLista(sinImportes, lista.id, bd());
    expect(oculta.margenPct).toBeNull();
    expect(oculta.lineas[0]?.costoUnit).toBeNull();
    expect(oculta.lineas[0]?.precioCalculado).toBeNull();
    // El modelo y el estado SIEMPRE se ven.
    expect(oculta.codigoEstado).toBe('abierta');
    expect(oculta.lineas[0]?.codigoModelo).toBe('MOD-OCU');
  });

  it('una lista de OTRA empresa no existe para esta sesión', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-A9');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa');
    const sesionOtra = sesionDePrueba({ idEmpresaActiva: otraEmpresa.id, permisos: PERM });
    await expect(obtenerLista(sesionOtra, lista.id, bd())).rejects.toThrow(ErrorNoEncontrado);
    const listado = await listarListas(sesionOtra, {}, bd());
    expect(listado).toHaveLength(0);
  });

  it('sin listas.administrar no se puede crear una lista', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-PERM');
    await expect(
      crearLista(
        sesion(['listas.ver']),
        {
          idCliente: clienteNegocio.id,
          idClienteDepartamento: departamento.id,
          idsDesarrollo: [id],
        },
        bd(),
      ),
    ).rejects.toThrow(ErrorPermiso);
  });
});

describe('desgloseCostoLinea — desglose de costo por concepto (§4.8)', () => {
  it('agrupa y suma los conceptos del precosto congelado (tela + corte + maquila = 40)', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-DESG');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const idLinea = lista.lineas[0]!.id;

    const desglose = await desgloseCostoLinea(sesion(), idLinea, bd());
    expect(desglose.costoTotal).toBe(40);
    // Ordenados por el `orden` del catálogo: tela(1) · maquila(3) · corte(8). No hay avíos/bordado.
    expect(desglose.grupos.map((g) => g.codigo)).toEqual(['tela', 'maquila', 'corte']);
    const porCodigo = new Map(desglose.grupos.map((g) => [g.codigo, g.subtotal]));
    expect(porCodigo.get('tela')).toBe(30); // 1.5 × 20
    expect(porCodigo.get('maquila')).toBe(10);
    expect(porCodigo.get('corte')).toBe(0);
  });

  it('sin consultas.ver-importes oculta los subtotales y el total (null), pero da la estructura', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-DESG-OCU');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const idLinea = lista.lineas[0]!.id;

    const desglose = await desgloseCostoLinea(sesion(['listas.ver']), idLinea, bd());
    expect(desglose.costoTotal).toBeNull();
    expect(desglose.grupos.every((g) => g.subtotal === null)).toBe(true);
    expect(desglose.grupos.map((g) => g.codigo)).toContain('tela');
  });

  it('un renglón de OTRA empresa no existe (A9)', async () => {
    await sembrarFactores();
    const id = await desarrolloConPrecosto('MOD-DESG-A9');
    const lista = await crearLista(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, idsDesarrollo: [id] },
      bd(),
    );
    const idLinea = lista.lineas[0]!.id;
    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa Desglose');
    const sesionOtra = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM });
    await expect(desgloseCostoLinea(sesionOtra, idLinea, bd())).rejects.toThrow(ErrorNoEncontrado);
  });
});

/**
 * ⭐ V1-E4 punto 4 — un desarrollo metido POR ERROR en una lista quedaba ATRAPADO PARA SIEMPRE:
 * `lista_precios_linea` tiene `@@unique([idDesarrollo])`, así que sin forma de quitar el renglón
 * (ni de borrar la lista) ese desarrollo no podía entrar NUNCA a la lista correcta.
 */
describe('⭐ quitar un renglón / borrar una lista (V1-E4)', () => {
  /** Crea una lista con un solo renglón y devuelve la lista + el id del renglón. */
  async function listaConUnRenglon(codigo: string) {
    await sembrarFactores();
    const idDesarrollo = await desarrolloConPrecosto(codigo);
    const lista = await crearLista(
      sesion(),
      {
        idCliente: clienteNegocio.id,
        idClienteDepartamento: departamento.id,
        idsDesarrollo: [idDesarrollo],
      },
      bd(),
    );
    return { lista, idLinea: lista.lineas[0]!.id, idDesarrollo };
  }

  it('quitar el renglón LIBERA al desarrollo: ya puede entrar a la lista correcta', async () => {
    const { lista, idLinea, idDesarrollo } = await listaConUnRenglon('MOD-QUITAR');

    const despues = await quitarLineaLista(sesion(), idLinea, bd());
    expect(despues.lineas).toHaveLength(0);

    // LA PRUEBA DE QUE LA TRAMPA SE ABRIÓ: el desarrollo entra a otra lista.
    const otraLista = await crearLista(
      sesion(),
      {
        idCliente: clienteNegocio.id,
        idClienteDepartamento: departamento.id,
        idsDesarrollo: [idDesarrollo],
      },
      bd(),
    );
    expect(otraLista.lineas).toHaveLength(1);
    expect(otraLista.id).not.toBe(lista.id);
  });

  it('D3: lo que se quita queda ÍNTEGRO en la bitácora (el objeto, no un conteo)', async () => {
    const { lista, idLinea } = await listaConUnRenglon('MOD-QUITAR-BIT');
    // Se aprueba antes de quitar, para que el `antes` tenga algo que perder.
    await aprobarLinea(sesion(), idLinea, bd());
    const antesEnBd = await cliente.listaPreciosLinea.findUniqueOrThrow({ where: { id: idLinea } });

    await quitarLineaLista(sesion(), idLinea, bd());

    const registro = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'ListaPrecios', idEntidad: String(lista.id) },
      orderBy: { id: 'desc' },
    });
    const datos = registro.datos as {
      operacion: string;
      antes: Record<string, unknown>;
      eventosNegociacion: unknown[];
    };
    expect(datos.operacion).toBe('quitar-linea');
    // El objeto COMPLETO: id, desarrollo, precosto, costo, precio calculado y el APROBADO.
    expect(datos.antes.id).toBe(idLinea);
    expect(datos.antes.idDesarrollo).toBe(antesEnBd.idDesarrollo);
    expect(datos.antes.idPrecosto).toBe(antesEnBd.idPrecosto);
    expect(datos.antes.costoUnit).toBe(antesEnBd.costoUnit.toNumber());
    expect(datos.antes.precioCalculado).toBe(antesEnBd.precioCalculado.toNumber());
    expect(datos.antes.precioAprobado).toBe(antesEnBd.precioAprobado?.toNumber());
    expect(datos.antes.aprobadoPorId).toBe('usuario-prueba');
    // Los importes son NÚMEROS, no cadenas. Se asevera el TIPO además del valor porque el bug que
    // esto cazó era exactamente ése: el `replacer` de `JSON.stringify` recibe el valor DESPUÉS de
    // `toJSON()`, así que los `Decimal` entraban como `"40"` y la conversión nunca corría.
    expect(typeof datos.antes.costoUnit).toBe('number');
    expect(typeof datos.antes.precioAprobado).toBe('number');
    // Las fechas quedan en ISO 8601 (cadena), no como objeto vacío.
    expect(datos.antes.creadoEn).toBe(antesEnBd.creadoEn.toISOString());
    expect(Array.isArray(datos.eventosNegociacion)).toBe(true);
  });

  it('borrar la lista se lleva sus renglones y los deja íntegros en la bitácora', async () => {
    const { lista, idDesarrollo } = await listaConUnRenglon('MOD-BORRAR');

    await eliminarLista(sesion(), lista.id, bd());

    expect(await cliente.listaPrecios.count({ where: { id: lista.id } })).toBe(0);
    expect(await cliente.listaPreciosLinea.count({ where: { idLista: lista.id } })).toBe(0);
    // El desarrollo quedó libre.
    const otra = await crearLista(
      sesion(),
      {
        idCliente: clienteNegocio.id,
        idClienteDepartamento: departamento.id,
        idsDesarrollo: [idDesarrollo],
      },
      bd(),
    );
    expect(otra.lineas).toHaveLength(1);

    const registro = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'ListaPrecios', idEntidad: String(lista.id), accion: 'OTRO' },
      orderBy: { id: 'desc' },
    });
    const datos = registro.datos as {
      operacion: string;
      antes: { folio: string; lineas: unknown[] };
    };
    expect(datos.operacion).toBe('eliminar-lista');
    expect(datos.antes.folio).toBe(String(lista.folio));
    expect(datos.antes.lineas).toHaveLength(1);
  });

  it('una lista en estado de CIERRE no se toca (hay que reabrirla primero)', async () => {
    const { lista, idLinea } = await listaConUnRenglon('MOD-CERRADA');
    const cerrada = await cliente.estadoLista.findFirstOrThrow({ where: { codigo: 'cerrada' } });
    await cliente.listaPrecios.update({
      where: { id: lista.id },
      data: { idEstadoLista: cerrada.id },
    });

    await expect(quitarLineaLista(sesion(), idLinea, bd())).rejects.toThrow(ErrorConflicto);
    await expect(eliminarLista(sesion(), lista.id, bd())).rejects.toThrow(ErrorConflicto);
    expect(await cliente.listaPrecios.count({ where: { id: lista.id } })).toBe(1);
  });

  it('A9: un renglón/lista de OTRA empresa da 404 (nunca 409: un 409 confirmaría que existe)', async () => {
    const { lista, idLinea } = await listaConUnRenglon('MOD-A9-BORRAR');
    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa Borrar');
    const sesionOtra = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM });

    await expect(quitarLineaLista(sesionOtra, idLinea, bd())).rejects.toThrow(ErrorNoEncontrado);
    await expect(eliminarLista(sesionOtra, lista.id, bd())).rejects.toThrow(ErrorNoEncontrado);
    expect(await cliente.listaPreciosLinea.count({ where: { id: idLinea } })).toBe(1);
  });

  it('RBAC: sin listas.administrar no se quita ni se borra', async () => {
    const { lista, idLinea } = await listaConUnRenglon('MOD-RBAC-BORRAR');
    const soloVer = sesion(['listas.ver']);

    await expect(quitarLineaLista(soloVer, idLinea, bd())).rejects.toThrow(ErrorPermiso);
    await expect(eliminarLista(soloVer, lista.id, bd())).rejects.toThrow(ErrorPermiso);
  });
});

// ── ⭐ V1-E8d (§Post-F9.127): EL AVISO DE QUE EL COSTO QUEDÓ VIEJO ─────────────────────
//
// Daniel: *"Si. Ok. Que me avise."* El renglón guarda un precosto CONGELADO (inmutable, D3), así
// que cambiar la receta del modelo NO lo mueve: hay que congelar una versión nueva y registrar una
// ronda, las dos a mano. Estas pruebas recorren el ciclo COMPLETO contra Postgres, por las PUERTAS
// REALES —el PUT de telas del BOM y el editor del modelo—, porque el agujero sólo aparece
// recorriéndolas en orden.
//
// ⚠️ NO SE CORRIERON EN LOCAL (Docker: regla del proyecto). Viajan al CI, que es el único juez.

describe('⭐ V1-E8d — avisar cuando la receta cambia bajo un precio ya aprobado', () => {
  /** Sesión que además puede mover la RECETA (el permiso de modelos, distinto del de listas). */
  function sesionConModelos(): SesionUsuario {
    return sesion([...PERM, 'modelos.ver', 'modelos.administrar']);
  }

  /**
   * Sesión que además puede NEGOCIAR (`listas.negociar`), que es lo que exige `registrarRonda`.
   *
   * 🔴 Lo cazó el CI: `PERM` —la sesión "completa" de este archivo— NO lo trae, así que la prueba
   * del recosteo moría con `ErrorPermiso` **antes** de comprobar que el aviso se apaga. Un fixture
   * que revienta es una prueba que nunca corrió.
   *
   * ⚠️ Va aparte y NO se mete a `PERM`: aprobar un precio y negociarlo son permisos distintos a
   * propósito (§Post-F9.125 los separa), y ensancharlos a todos borraría esa distinción de los
   * demás casos de este archivo.
   */
  function sesionQueNegocia(): SesionUsuario {
    return sesion([...PERM, 'listas.negociar']);
  }

  /** Crea desarrollo + lista con el renglón YA APROBADO. Devuelve los ids que hacen falta. */
  async function listaAprobada(codigoModelo: string): Promise<{
    idLista: number;
    idLinea: number;
    idModelo: number;
    idDesarrollo: number;
  }> {
    await sembrarFactores();
    const idDesarrollo = await desarrolloConPrecosto(codigoModelo);
    const lista = await crearLista(
      sesion(),
      {
        idCliente: clienteNegocio.id,
        idClienteDepartamento: departamento.id,
        idsDesarrollo: [idDesarrollo],
      },
      bd(),
    );
    const idLinea = lista.lineas[0]!.id;
    await aprobarLinea(sesion(), idLinea, bd());
    const desarrollo = await cliente.desarrollo.findUniqueOrThrow({
      where: { id: idDesarrollo },
      select: { idModelo: true },
    });
    return { idLista: lista.id, idLinea, idModelo: desarrollo.idModelo, idDesarrollo };
  }

  it('⭐ LA PRUEBA DE LA ETAPA: aprobar el precio → tocar la RECETA → el sistema lo dice', async () => {
    const { idLista, idModelo } = await listaAprobada('MOD-CV1');

    // Antes de tocar nada, el renglón está limpio: el aviso no se enciende solo.
    const antes = await obtenerLista(sesion(), idLista, bd());
    expect(antes.lineas[0]!.avisoCostoViejo).toBeNull();
    expect(antes.lineas[0]!.aprobado).toBe(true);

    // Se le cambia el CONSUMO de la tela por la puerta REAL del BOM (no tocando la columna a mano).
    const telaBom = await cliente.modeloTela.findFirstOrThrow({ where: { idModelo } });
    await reemplazarTelasBom(
      sesionConModelos(),
      idModelo,
      [{ idTela: telaBom.idTela, consumoPorPrenda: 2.5 }],
      bd(),
    );

    const despues = await obtenerLista(sesion(), idLista, bd());
    const aviso = despues.lineas[0]!.avisoCostoViejo;
    expect(aviso).not.toBeNull();
    // Dice QUÉ cambió y que hay una firma en pie sobre ese costo — no un símbolo mudo.
    expect(aviso).toContain('las TELAS');
    expect(aviso).toContain('APROBADO');
    // Y es un AVISO, no un candado: la firma NO se cayó (§Post-F9.127).
    expect(despues.lineas[0]!.aprobado).toBe(true);
    expect(despues.lineas[0]!.precioAprobado).toBe(100);
  });

  it('⭐ SU GEMELA: tocar algo que NO es la receta (renombrar el modelo) NO dispara nada', async () => {
    // Ésta es la prueba que separa la opción (B) de la (A) y justifica la columna nueva. Con
    // `Modelo.modificadoEn` —que es `@updatedAt`— esta línea saldría ROJA: renombrar mueve la
    // fecha igual que cambiar una tela, y el aviso nacería gritando en falso.
    const { idLista, idModelo } = await listaAprobada('MOD-CV2');

    await actualizarModelo(
      sesionConModelos(),
      { id: idModelo, descripcion: 'Jogger felpa — nombre corregido' },
      bd(),
    );

    const despues = await obtenerLista(sesion(), idLista, bd());
    expect(despues.lineas[0]!.avisoCostoViejo).toBeNull();
  });

  it('recostear (congelar versión nueva + ronda) APAGA el aviso: no hay estado muerto', async () => {
    const { idLista, idLinea, idModelo, idDesarrollo } = await listaAprobada('MOD-CV3');

    const telaBom = await cliente.modeloTela.findFirstOrThrow({ where: { idModelo } });
    await reemplazarTelasBom(
      sesionConModelos(),
      idModelo,
      [{ idTela: telaBom.idTela, consumoPorPrenda: 2.5 }],
      bd(),
    );
    expect((await obtenerLista(sesion(), idLista, bd())).lineas[0]!.avisoCostoViejo).not.toBeNull();

    // El camino que el aviso pide: versión nueva congelada + ronda que re-apunta el renglón.
    const nuevo = await generarPrecosto(sesion(), idDesarrollo, bd());
    await congelarVersion(sesion(), nuevo.id, bd());
    await registrarRonda(
      sesionQueNegocia(),
      idLinea,
      { idPrecostoNuevo: nuevo.id, acuerdo: 'Recosteo por cambio de consumo de tela' },
      bd(),
    );

    const despues = await obtenerLista(sesion(), idLista, bd());
    expect(despues.lineas[0]!.avisoCostoViejo).toBeNull();
    // Y la ronda hizo lo suyo desde F8-E5: el precio se re-aprueba.
    expect(despues.lineas[0]!.aprobado).toBe(false);
  });

  it('un renglón SIN aprobar también avisa, para que no se firme sobre el costo viejo', async () => {
    await sembrarFactores();
    const idDesarrollo = await desarrolloConPrecosto('MOD-CV4');
    const lista = await crearLista(
      sesion(),
      {
        idCliente: clienteNegocio.id,
        idClienteDepartamento: departamento.id,
        idsDesarrollo: [idDesarrollo],
      },
      bd(),
    );
    const { idModelo } = await cliente.desarrollo.findUniqueOrThrow({
      where: { id: idDesarrollo },
      select: { idModelo: true },
    });
    const telaBom = await cliente.modeloTela.findFirstOrThrow({ where: { idModelo } });
    await reemplazarTelasBom(
      sesionConModelos(),
      idModelo,
      [{ idTela: telaBom.idTela, consumoPorPrenda: 2.5 }],
      bd(),
    );

    const despues = await obtenerLista(sesion(), lista.id, bd());
    expect(despues.lineas[0]!.avisoCostoViejo).toContain('antes de aprobar');
  });
});
