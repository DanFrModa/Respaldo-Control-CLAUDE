/**
 * ⭐⭐ V1-E8y (§Post-F9.152) — **LA MESA ABIERTA**, contra el Postgres efímero (testcontainers).
 *
 * Tres cosas que hasta esta etapa no se podían hacer, y la que sí se podía pero salía mal:
 *
 *  1. **AGREGAR modelos a una lista ya creada** — el único escritor de renglones era el alta de la
 *     lista. Se prueba con las mismas reglas de `crearLista` y, sobre todo, que el precio nuevo sale
 *     del **snapshot de la lista** y no de los factores vigentes del cliente.
 *  2. **DAR DE ALTA UN MODELO EN LA CITA**, desde cero o copiando otro. La prueba central es la del
 *     defecto medido: **la copia tiene que traerse la maquila y el corte**, o el precosto nace en
 *     cero sin decirlo.
 *  3. **EL ENCABEZADO DE LA CITA** (lugar + notas, que sólo se podían escribir al crear).
 *  4. **LOS PENDIENTES POR MODELO**, con su regla propia: no son el papel, así que la lista cerrada
 *     no los frena — y al quitar el renglón quedan fotografiados en la bitácora.
 *
 * NO corre en local (usa Docker): lo juzga el CI.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Cliente, ClienteDepartamento, Empresa, PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { guardarFactoresCliente } from './cliente-factores.js';
import { crearDesarrollo } from './desarrollos.js';
import {
  agregarLineasLista,
  crearLista,
  editarEncabezadoLista,
  obtenerLista,
  quitarLineaLista,
} from './listas-precios.js';
import { crearModeloEnLista } from './modelo-en-la-mesa.js';
import {
  crearPendienteDeRenglon,
  editarPendienteDeRenglon,
  eliminarPendienteDeRenglon,
  listarPendientesDeRenglon,
} from './pendientes-linea.js';
import { congelarVersion, generarPrecosto, obtenerPrecosto } from './precostos.js';
import { crearProyecto } from './proyectos.js';

let cliente: PrismaClient;
let empresa: Empresa;
let clienteNegocio: Cliente;
let departamento: ClienteDepartamento;
let pantalon: { id: number };
let caballero: { id: number };

const PERM: ClavePermiso[] = [
  'desarrollo.ver',
  'desarrollo.administrar',
  'desarrollo.precostear',
  'modelos.administrar',
  'modelos.ver',
  'listas.ver',
  'listas.administrar',
  'listas.aprobar',
  'consultas.ver-importes',
];
const bd = () => ({ cliente });
function sesion(permisos: ClavePermiso[] = PERM): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
}

/** Conceptos de costo + estados de lista (los del seed de F8-E1 + el empaque de V1-E8w). */
async function sembrarBase(): Promise<void> {
  for (const c of [
    { codigo: 'tela', nombre: 'Tela', orden: 1, fijo: true },
    { codigo: 'avios', nombre: 'Avíos', orden: 2, fijo: true },
    { codigo: 'maquila', nombre: 'Maquila', orden: 3, fijo: true },
    { codigo: 'bordado', nombre: 'Bordado', orden: 5, fijo: false },
    { codigo: 'corte', nombre: 'Corte', orden: 8, fijo: true },
    { codigo: 'empaque', nombre: 'Empaque', orden: 9, fijo: true },
  ]) {
    await cliente.conceptoCosto.create({ data: c });
  }
  await cliente.estadoLista.create({
    data: { codigo: 'abierta', nombre: 'Abierta', orden: 1, esCierre: false },
  });
  await cliente.estadoLista.create({
    data: { codigo: 'cerrada', nombre: 'Cerrada', orden: 3, esCierre: true },
  });
}

/** Factores 50/10/5/5 → costo 42.20 ⇒ 42.2/0.5 = 84.4 → /0.8 = 105.5 → 106 (redondeo al alza). */
async function sembrarFactores(margenPct = 50): Promise<void> {
  await guardarFactoresCliente(
    sesion(),
    clienteNegocio.id,
    { margenPct, descuentosPct: 10, regaliasPct: 5, costoVentasPct: 5 },
    bd(),
  );
}

/** Un desarrollo con precosto CONGELADO (tela 1.5×20 + maquila 10 + empaque 2.20 = 42.20). */
async function desarrolloConPrecosto(codigoModelo: string): Promise<number> {
  const tela = await cliente.tela.create({
    data: { nombre: `Felpa ${codigoModelo}`, precioSugerido: 20 },
  });
  const modelo = await cliente.modelo.create({
    data: {
      codigo: codigoModelo,
      maquilaBase: 10,
      idTipoProducto: pantalon.id,
      idGenero: caballero.id,
      telas: { create: [{ idTela: tela.id, consumoPorPrenda: 1.5 }] },
    },
  });
  const proyecto = await crearProyecto(
    sesion(),
    { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, nombre: 'Joggers' },
    bd(),
  );
  const desarrollo = await crearDesarrollo(sesion(), proyecto.id, { idModelo: modelo.id }, bd());
  const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());
  await congelarVersion(sesion(), precosto.id, bd());
  return desarrollo.id;
}

/** Una lista con UN renglón, para tener mesa donde trabajar. */
async function listaConUnModelo(): Promise<{ idLista: number; idDesarrollo: number }> {
  await sembrarFactores();
  const idDesarrollo = await desarrolloConPrecosto('MOD-BASE');
  const lista = await crearLista(
    sesion(),
    {
      idCliente: clienteNegocio.id,
      idClienteDepartamento: departamento.id,
      idsDesarrollo: [idDesarrollo],
    },
    bd(),
  );
  return { idLista: lista.id, idDesarrollo };
}

/** Deja la lista en el estado de CIERRE (sin pasar por el dominio de estados). */
async function cerrarLista(idLista: number): Promise<void> {
  const cerrada = await cliente.estadoLista.findUniqueOrThrow({ where: { codigo: 'cerrada' } });
  await cliente.listaPrecios.update({
    where: { id: idLista },
    data: { idEstadoLista: cerrada.id },
  });
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
  clienteNegocio = await cliente.cliente.create({
    data: { nombre: 'C&A', abreviatura: 'CYA' },
  });
  departamento = await cliente.clienteDepartamento.create({
    data: { idCliente: clienteNegocio.id, nombre: 'NIÑOS' },
  });
  pantalon = await cliente.tipoProducto.create({
    data: { nombre: 'Pantalón', digitoConcepto: 7 },
  });
  caballero = await cliente.genero.create({
    data: { nombre: 'Caballero', digitoNomenclatura: 1 },
  });
  await sembrarBase();
});

describe('agregarLineasLista — la lista deja de estar cerrada al nacer', () => {
  it('agrega un modelo cotizado a una lista que ya existe, sin tocar los renglones que ya tenía', async () => {
    const { idLista } = await listaConUnModelo();
    const idNuevo = await desarrolloConPrecosto('MOD-NUEVO');

    const lista = await agregarLineasLista(sesion(), idLista, { idsDesarrollo: [idNuevo] }, bd());

    expect(lista.lineas).toHaveLength(2);
    const agregado = lista.lineas.find((l) => l.idDesarrollo === idNuevo);
    expect(agregado?.costoUnit).toBe(42.2);
    expect(agregado?.precioCalculado).toBe(106);
    // Nace ABIERTO y sin firma, como cualquier renglón (§Post-F9.151).
    expect(agregado?.estado).toBe('abierto');
    expect(agregado?.aprobado).toBe(false);
  });

  it('🔴 calcula el precio con el SNAPSHOT DE LA LISTA, no con los factores vigentes del cliente', async () => {
    const { idLista } = await listaConUnModelo(); // snapshot: margen 50 → precio 106
    // El cliente cambia de margen DESPUÉS de crearse la lista. La lista no se entera (y no debe).
    await sembrarFactores(70);
    const idNuevo = await desarrolloConPrecosto('MOD-NUEVO');

    const lista = await agregarLineasLista(sesion(), idLista, { idsDesarrollo: [idNuevo] }, bd());

    const agregado = lista.lineas.find((l) => l.idDesarrollo === idNuevo);
    // Con margen 70 el precio sería 176; con el snapshot de la lista (50) son 106, igual que sus
    // hermanos. Un renglón con otro margen dentro de la misma lista sería invisible en pantalla.
    expect(agregado?.precioCalculado).toBe(106);
    expect(lista.margenPct).toBe(50);
  });

  it('🔴 rechaza (409) el que YA está en ESTA lista, y lo DICE (no manda a buscarlo por las demás)', async () => {
    const { idLista, idDesarrollo } = await listaConUnModelo();
    // El caso real: dos clics seguidos en «Agregar a la lista» desde la tira del modelo nuevo.
    await expect(
      agregarLineasLista(sesion(), idLista, { idsDesarrollo: [idDesarrollo] }, bd()),
    ).rejects.toThrow(ErrorConflicto);
    await expect(
      agregarLineasLista(sesion(), idLista, { idsDesarrollo: [idDesarrollo] }, bd()),
    ).rejects.toThrow(/MOD-BASE: ya está en ESTA lista/);
  });

  it('rechaza (409) el desarrollo cuyo precosto sigue en BORRADOR, diciendo la versión', async () => {
    const { idLista } = await listaConUnModelo();
    const tela = await cliente.tela.create({
      data: { nombre: 'Felpa borrador', precioSugerido: 5 },
    });
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'MOD-BORRADOR',
        maquilaBase: 3,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 1 }] },
      },
    });
    const proyecto = await crearProyecto(
      sesion(),
      { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, nombre: 'Otro' },
      bd(),
    );
    const desarrollo = await crearDesarrollo(sesion(), proyecto.id, { idModelo: modelo.id }, bd());
    await generarPrecosto(sesion(), desarrollo.id, bd());

    await expect(
      agregarLineasLista(sesion(), idLista, { idsDesarrollo: [desarrollo.id] }, bd()),
    ).rejects.toThrow(/BORRADOR/);
  });

  it('rechaza (400) un desarrollo de OTRO cliente: no es de esta mesa', async () => {
    const { idLista } = await listaConUnModelo();
    const otro = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
    const otroDepto = await cliente.clienteDepartamento.create({
      data: { idCliente: otro.id, nombre: 'DAMAS' },
    });
    const modelo = await cliente.modelo.create({ data: { codigo: 'MOD-AJENO', maquilaBase: 1 } });
    const proyecto = await crearProyecto(
      sesion(),
      { idCliente: otro.id, idClienteDepartamento: otroDepto.id, nombre: 'Ajeno' },
      bd(),
    );
    const desarrollo = await crearDesarrollo(sesion(), proyecto.id, { idModelo: modelo.id }, bd());

    await expect(
      agregarLineasLista(sesion(), idLista, { idsDesarrollo: [desarrollo.id] }, bd()),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('🔴 una lista CERRADA no admite renglones nuevos (hay que reabrirla, y eso queda auditado)', async () => {
    const { idLista } = await listaConUnModelo();
    const idNuevo = await desarrolloConPrecosto('MOD-NUEVO');
    await cerrarLista(idLista);

    await expect(
      agregarLineasLista(sesion(), idLista, { idsDesarrollo: [idNuevo] }, bd()),
    ).rejects.toThrow(ErrorConflicto);
  });

  it('una lista de OTRA empresa no existe para esta sesión (A9 → 404)', async () => {
    const { idLista } = await listaConUnModelo();
    const idNuevo = await desarrolloConPrecosto('MOD-NUEVO');
    const otraEmpresa = sesionDePrueba({ idEmpresaActiva: empresa.id + 999, permisos: PERM });

    await expect(
      agregarLineasLista(otraEmpresa, idLista, { idsDesarrollo: [idNuevo] }, bd()),
    ).rejects.toThrow(ErrorNoEncontrado);
  });
});

describe('crearModeloEnLista — cotizar en la cita un modelo que no existe', () => {
  it('DESDE CERO: crea el proyecto, mintea el código, deja el desarrollo y su precosto BORRADOR', async () => {
    const { idLista } = await listaConUnModelo();

    const creado = await crearModeloEnLista(
      sesion(),
      idLista,
      {
        anioEntrega: 2026,
        idTipoProducto: pantalon.id,
        idGenero: caballero.id,
        descripcion: 'Sudadera estimada en la cita',
        nombreProyectoNuevo: 'Cita 31-ago',
      },
      bd(),
    );

    expect(creado.proyectoCreado).toBe(true);
    expect(creado.nombreProyecto).toBe('Cita 31-ago');
    // `CYA` (abreviatura) + `26` (año) + `71` (pantalón 7 + caballero 1) + consecutivo.
    expect(creado.codigoModelo).toMatch(/^CYA-26-71-\d{3}$/);
    expect(creado.copiadoDeIdModelo).toBeNull();
    expect(creado.receta).toEqual({ telas: 0, avios: 0, medidas: 0, artes: 0 });

    const precosto = await obtenerPrecosto(sesion(), creado.idPrecosto, bd());
    expect(precosto.estado).toBe('borrador');
    // El modelo nació vacío: sólo las anclas. Y el EMPAQUE solo NO alcanza para congelar (0.063).
    await expect(congelarVersion(sesion(), creado.idPrecosto, bd())).rejects.toThrow(/EMPAQUE/);
  });

  it('⭐⭐ COPIANDO: se lleva la RECETA **y los COSTOS de la ficha** (maquila y corte), que el BOM no trae', async () => {
    const { idLista } = await listaConUnModelo();
    const tela = await cliente.tela.create({
      data: { nombre: 'Felpa origen', precioSugerido: 30 },
    });
    const origen = await cliente.modelo.create({
      data: {
        codigo: 'MOD-ORIGEN',
        descripcion: 'Sudadera con jareta',
        composicion: '80% algodón',
        maquilaBase: 38.5,
        corteBase: 7.25,
        numOperaciones: 14,
        idTipoProducto: pantalon.id,
        idGenero: caballero.id,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 2 }] },
      },
    });

    const creado = await crearModeloEnLista(
      sesion(),
      idLista,
      { anioEntrega: 2026, idModeloOrigen: origen.id, nombreProyectoNuevo: 'Cita copia' },
      bd(),
    );

    expect(creado.copiadoDeCodigo).toBe('MOD-ORIGEN');
    expect(creado.receta.telas).toBe(1);

    // La FICHA viajó: si no, el precosto nacería con maquila $0 y corte $0 EN SILENCIO.
    const copia = await cliente.modelo.findUniqueOrThrow({ where: { id: creado.idModelo } });
    expect(copia.maquilaBase?.toNumber()).toBe(38.5);
    expect(copia.corteBase?.toNumber()).toBe(7.25);
    expect(copia.numOperaciones).toBe(14);
    expect(copia.composicion).toBe('80% algodón');
    // Y el ORIGINAL no se tocó (es una copia, no una mudanza).
    expect((await cliente.modelo.findUniqueOrThrow({ where: { id: origen.id } })).codigo).toBe(
      'MOD-ORIGEN',
    );

    // El precosto generado lo demuestra de punta a punta: tela 2×30 = 60 + maquila 38.50 + corte
    // 7.25 + empaque 2.20 = **107.95**. Con `copiarBom` a secas serían 62.20 (sólo tela + empaque)
    // y nadie lo notaría: la diferencia son exactamente los 45.75 de maquila y corte que esta
    // etapa vino a rescatar.
    const precosto = await obtenerPrecosto(sesion(), creado.idPrecosto, bd());
    const total = precosto.lineas.reduce((suma, l) => suma + (l.importe ?? 0), 0);
    expect(total).toBeCloseTo(107.95, 2);
    // Y se comprueba la RESTA, que es el corazón del defecto: lo que aporta la ficha copiada
    // (maquila + corte) no puede ser cero.
    expect(total - (2 * 30 + 2.2)).toBeCloseTo(45.75, 2);
  });

  it('el modelo copiado ENTRA a la lista en cuanto se congela su precosto (el ciclo de la cita, completo)', async () => {
    const { idLista } = await listaConUnModelo();
    const tela = await cliente.tela.create({ data: { nombre: 'Felpa ciclo', precioSugerido: 30 } });
    const origen = await cliente.modelo.create({
      data: {
        codigo: 'MOD-CICLO',
        maquilaBase: 20,
        idTipoProducto: pantalon.id,
        idGenero: caballero.id,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 1 }] },
      },
    });

    const creado = await crearModeloEnLista(
      sesion(),
      idLista,
      { anioEntrega: 2026, idModeloOrigen: origen.id, nombreProyectoNuevo: 'Cita ciclo' },
      bd(),
    );
    await congelarVersion(sesion(), creado.idPrecosto, bd());
    const lista = await agregarLineasLista(
      sesion(),
      idLista,
      { idsDesarrollo: [creado.idDesarrollo] },
      bd(),
    );

    expect(lista.lineas).toHaveLength(2);
    const nuevo = lista.lineas.find((l) => l.idDesarrollo === creado.idDesarrollo);
    expect(nuevo?.codigoModelo).toBe(creado.codigoModelo);
    expect(nuevo?.costoUnit).toBe(52.2); // 30 + 20 + 2.20
  });

  it('🔴 copiar un modelo SIN GÉNERO (los migrados de Access) se rechaza nombrándolo — no se inventa nada', async () => {
    const { idLista } = await listaConUnModelo();
    const migrado = await cliente.modelo.create({
      data: { codigo: '71001', maquilaBase: 5, idTipoProducto: pantalon.id },
    });

    await expect(
      crearModeloEnLista(
        sesion(),
        idLista,
        { anioEntrega: 2026, idModeloOrigen: migrado.id, nombreProyectoNuevo: 'Cita migrado' },
        bd(),
      ),
    ).rejects.toThrow(/71001/);
  });

  it('un modelo DESCONTINUADO no se copia (reactivarlo tiene que ser un acto que alguien decide)', async () => {
    const { idLista } = await listaConUnModelo();
    const baja = await cliente.modelo.create({
      data: {
        codigo: 'MOD-BAJA',
        activo: false,
        idTipoProducto: pantalon.id,
        idGenero: caballero.id,
      },
    });

    await expect(
      crearModeloEnLista(
        sesion(),
        idLista,
        { anioEntrega: 2026, idModeloOrigen: baja.id, nombreProyectoNuevo: 'Cita baja' },
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);
  });

  it('un PROYECTO de otro cliente se rechaza ANTES de crear nada (el modelo no podría entrar a esta lista)', async () => {
    const { idLista } = await listaConUnModelo();
    const otro = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
    const otroDepto = await cliente.clienteDepartamento.create({
      data: { idCliente: otro.id, nombre: 'DAMAS' },
    });
    const ajeno = await crearProyecto(
      sesion(),
      { idCliente: otro.id, idClienteDepartamento: otroDepto.id, nombre: 'Ajeno' },
      bd(),
    );

    const modelosAntes = await cliente.modelo.count();
    await expect(
      crearModeloEnLista(
        sesion(),
        idLista,
        {
          anioEntrega: 2026,
          idTipoProducto: pantalon.id,
          idGenero: caballero.id,
          idProyecto: ajeno.id,
        },
        bd(),
      ),
    ).rejects.toThrow(ErrorValidacion);
    // A2: no quedó un modelo huérfano de la transacción abortada.
    expect(await cliente.modelo.count()).toBe(modelosAntes);
  });

  it('🔴 un cliente SIN ABREVIATURA lo dice con su nombre (y sin ella el código no se puede armar)', async () => {
    const sinAbrev = await cliente.cliente.update({
      where: { id: clienteNegocio.id },
      data: { abreviatura: null },
    });
    const { idLista } = await listaConUnModelo();

    await expect(
      crearModeloEnLista(
        sesion(),
        idLista,
        {
          anioEntrega: 2026,
          idTipoProducto: pantalon.id,
          idGenero: caballero.id,
          nombreProyectoNuevo: 'Cita sin abreviatura',
        },
        bd(),
      ),
    ).rejects.toThrow(new RegExp(sinAbrev.nombre.replace('&', '&')));
  });

  it('en una lista CERRADA no nacen modelos nuevos', async () => {
    const { idLista } = await listaConUnModelo();
    await cerrarLista(idLista);

    await expect(
      crearModeloEnLista(
        sesion(),
        idLista,
        {
          anioEntrega: 2026,
          idTipoProducto: pantalon.id,
          idGenero: caballero.id,
          nombreProyectoNuevo: 'Cita cerrada',
        },
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);
  });
});

describe('editarEncabezadoLista — el lugar de la cita', () => {
  it('🔴 el LUGAR se guarda desde el ALTA (el esquema lo acepta: no puede aceptarlo y tirarlo)', async () => {
    await sembrarFactores();
    const idDesarrollo = await desarrolloConPrecosto('MOD-ALTA-LUGAR');
    const lista = await crearLista(
      sesion(),
      {
        idCliente: clienteNegocio.id,
        idClienteDepartamento: departamento.id,
        idsDesarrollo: [idDesarrollo],
        lugar: 'Zoom',
        notas: 'Junta corta',
      },
      bd(),
    );
    expect(lista.lugar).toBe('Zoom');
    expect(lista.notas).toBe('Junta corta');
  });

  it('sin lugar en el alta la lista nace sin él (la ausencia es lo normal, no un hueco)', async () => {
    const { idLista } = await listaConUnModelo();
    expect((await obtenerLista(sesion(), idLista, bd())).lugar).toBeNull();
  });

  it('guarda el lugar y corrige las notas (que sólo se podían escribir al crear la lista)', async () => {
    const { idLista } = await listaConUnModelo();

    const lista = await editarEncabezadoLista(
      sesion(),
      idLista,
      { lugar: 'Oficinas de C&A, Santa Fe', notas: 'Junta de temporada' },
      bd(),
    );
    expect(lista.lugar).toBe('Oficinas de C&A, Santa Fe');
    expect(lista.notas).toBe('Junta de temporada');

    // `null` vacía; omitir no toca.
    const sinLugar = await editarEncabezadoLista(sesion(), idLista, { lugar: null }, bd());
    expect(sinLugar.lugar).toBeNull();
    expect(sinLugar.notas).toBe('Junta de temporada');
  });

  it('una lista CERRADA no se re-encabeza sin reabrirla', async () => {
    const { idLista } = await listaConUnModelo();
    await cerrarLista(idLista);
    await expect(editarEncabezadoLista(sesion(), idLista, { lugar: 'Zoom' }, bd())).rejects.toThrow(
      ErrorConflicto,
    );
  });
});

describe('pendientes por modelo — la libreta de la cita', () => {
  /** El renglón de la lista base (el único que tiene). */
  async function renglonBase(): Promise<{ idLista: number; idLinea: number }> {
    const { idLista } = await listaConUnModelo();
    const lista = await obtenerLista(sesion(), idLista, bd());
    return { idLista, idLinea: lista.lineas[0]!.id };
  }

  it('se anotan, se tachan y viajan EMBEBIDOS en el renglón de la lista', async () => {
    const { idLista, idLinea } = await renglonBase();

    const pendiente = await crearPendienteDeRenglon(
      sesion(),
      idLinea,
      { texto: 'Falta muestra de color' },
      bd(),
    );
    expect(pendiente.resuelto).toBe(false);
    expect(pendiente.resueltoEn).toBeNull();

    const conPendiente = await obtenerLista(sesion(), idLista, bd());
    expect(conPendiente.lineas[0]?.pendientes).toHaveLength(1);
    expect(conPendiente.lineas[0]?.pendientes[0]?.texto).toBe('Falta muestra de color');

    const tachado = await editarPendienteDeRenglon(
      sesion(),
      idLinea,
      pendiente.id,
      { resuelto: true },
      bd(),
    );
    expect(tachado.resuelto).toBe(true);
    expect(tachado.resueltoEn).not.toBeNull();
    expect(tachado.resueltoPorId).not.toBeNull();
  });

  it('🔴 destachar LIMPIA la firma (una firma que no corresponde al estado es un adorno)', async () => {
    const { idLinea } = await renglonBase();
    const pendiente = await crearPendienteDeRenglon(
      sesion(),
      idLinea,
      { texto: 'Pedir precio de jareta' },
      bd(),
    );
    await editarPendienteDeRenglon(sesion(), idLinea, pendiente.id, { resuelto: true }, bd());
    const reabierto = await editarPendienteDeRenglon(
      sesion(),
      idLinea,
      pendiente.id,
      { resuelto: false },
      bd(),
    );
    expect(reabierto.resuelto).toBe(false);
    expect(reabierto.resueltoEn).toBeNull();
    expect(reabierto.resueltoPorId).toBeNull();
  });

  it('el texto SE CORRIGE (es libreta, no la bitácora inmutable de la negociación)', async () => {
    const { idLinea } = await renglonBase();
    const pendiente = await crearPendienteDeRenglon(sesion(), idLinea, { texto: 'jareat' }, bd());
    const corregido = await editarPendienteDeRenglon(
      sesion(),
      idLinea,
      pendiente.id,
      { texto: 'Pedir precio de la jareta' },
      bd(),
    );
    expect(corregido.texto).toBe('Pedir precio de la jareta');
  });

  it('🔴 la lista CERRADA no frena la libreta: los pendientes no son el papel', async () => {
    const { idLista, idLinea } = await renglonBase();
    await cerrarLista(idLista);

    const pendiente = await crearPendienteDeRenglon(
      sesion(),
      idLinea,
      { texto: 'Falta la muestra de color' },
      bd(),
    );
    const tachado = await editarPendienteDeRenglon(
      sesion(),
      idLinea,
      pendiente.id,
      { resuelto: true },
      bd(),
    );
    expect(tachado.resuelto).toBe(true);
  });

  it('borrar deja el pendiente ÍNTEGRO en la bitácora (D3: se retira, no se pierde)', async () => {
    const { idLista, idLinea } = await renglonBase();
    const pendiente = await crearPendienteDeRenglon(
      sesion(),
      idLinea,
      { texto: 'Recado mal escrito' },
      bd(),
    );

    await eliminarPendienteDeRenglon(sesion(), idLinea, pendiente.id, bd());
    expect(await listarPendientesDeRenglon(sesion(), idLinea, bd())).toHaveLength(0);

    const renglones = await cliente.bitacora.findMany({
      where: { entidad: 'ListaPrecios', idEntidad: String(idLista) },
    });
    const borrado = renglones.find(
      (r) => (r.datos as { operacion?: string } | null)?.operacion === 'eliminar-pendiente',
    );
    expect(JSON.stringify(borrado?.datos)).toContain('Recado mal escrito');
  });

  it('🔴 QUITAR el renglón fotografía sus pendientes antes de que se los lleve la cascada', async () => {
    const { idLista, idLinea } = await renglonBase();
    await crearPendienteDeRenglon(sesion(), idLinea, { texto: 'Falta el sketch' }, bd());

    await quitarLineaLista(sesion(), idLinea, bd());

    const renglones = await cliente.bitacora.findMany({
      where: { entidad: 'ListaPrecios', idEntidad: String(idLista) },
    });
    const quitado = renglones.find(
      (r) => (r.datos as { operacion?: string } | null)?.operacion === 'quitar-linea',
    );
    expect(JSON.stringify(quitado?.datos)).toContain('Falta el sketch');
  });

  it('un renglón de OTRA empresa no existe para esta sesión (A9 → 404)', async () => {
    const { idLinea } = await renglonBase();
    const otraEmpresa = sesionDePrueba({ idEmpresaActiva: empresa.id + 999, permisos: PERM });
    await expect(
      crearPendienteDeRenglon(otraEmpresa, idLinea, { texto: 'x' }, bd()),
    ).rejects.toThrow(ErrorNoEncontrado);
  });
});
