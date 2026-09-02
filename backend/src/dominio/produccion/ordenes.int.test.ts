import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Cliente,
  ClienteCampo,
  Color,
  Empresa,
  Modelo,
  PedidoLinea,
  PrismaClient,
  Talla,
} from '../../datos/index.js';
import {
  clientePruebas,
  crearEmpresaPrueba,
  crearTipoArtePrueba,
  limpiarBaseDatos,
} from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { fusionarDepartamentosCliente } from '../catalogos/cliente-departamentos.js';
import { crearArte } from '../modelos/arte-modelo.js';
import { reemplazarAviosBom } from '../modelos/bom-modelo.js';
import { actualizarModelo } from '../modelos/modelos.js';
import {
  actualizarOrden,
  agregarComentarioOrden,
  cancelarOrden,
  copiarDetalleOrden,
  crearOrden,
  guardarMatrizOrden,
  guardarReferenciasOrden,
  listarOrdenes,
  obtenerOrden,
} from './ordenes.js';
import {
  agregarRenglonReceta,
  liberarReceta,
  marcarRecetaRevisada,
  obtenerRecetaOrden,
} from './receta-orden.js';

/**
 * Integración del dominio de Órdenes (F2-E2) contra el Postgres efímero (testcontainers). Cubre
 * lo que SOLO la base valida: folio por empresa sin colisión bajo concurrencia (A3/A9), totales
 * derivados de la matriz, color duplicado y talla fuera de catálogo rechazados, copiado de matriz
 * entre órdenes por etiqueta de talla, referencia con ClienteCampo de OTRO cliente rechazada,
 * búsqueda por valor de referencia (D7), orden desde pedido cancelado/no-producir rechazada, orden
 * SIN pedido rechazada en captura, estado 'completa'+fechaCompletada derivados solo al primer
 * guardado de matriz, y la bitácora de cambios de matriz. NO corre en local (usa Docker): el CI.
 */

let cliente: PrismaClient;
/** Id del tipo de arte «bordado» del catálogo único (V1-E3f): el arte no existe sin él. */
let idTipoArte: number;
let empresa: Empresa;
let clienteNegocio: Cliente;
let otroCliente: Cliente;
let modelo: Modelo;
let modeloInactivo: Modelo;
let colorRojo: Color;
let colorAzul: Color;
let tallaCH: Talla;
let tallaM: Talla;
let tallaG: Talla;
let lineaPedido: PedidoLinea;
let campoCliente: ClienteCampo;
let campoOtroCliente: ClienteCampo;

const PERM_TODOS: ClavePermiso[] = ['ordenes.ver', 'ordenes.administrar', 'ordenes.cancelar'];

function sesion(permisos: ClavePermiso[], idEmpresaActiva = empresa.id): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva, permisos });
}

const bd = () => ({ cliente });

/** Crea un pedido + un renglón en la empresa dada y devuelve el renglón (origen de la orden). */
async function crearRenglonPedido(
  idEmpresa: number,
  idCliente: number,
  idModelo: number,
  opciones: { pedCancelado?: boolean; noProducir?: boolean } = {},
): Promise<PedidoLinea> {
  const pedido = await cliente.pedido.create({
    data: {
      folio: BigInt(Math.floor(Math.random() * 1_000_000) + 1),
      idEmpresa,
      idCliente,
      pedCancelado: opciones.pedCancelado ?? false,
      noProducir: opciones.noProducir ?? false,
    },
  });
  return cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo, cantidadPedida: 100, precio: 50 },
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
  idTipoArte = await crearTipoArtePrueba(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  otroCliente = await cliente.cliente.create({ data: { nombre: 'Coppel' } });
  // Modelo BASE de las pruebas: cumple los requisitos del estado automático (Daniel 26-jul-2026,
  // `requisitos-orden.ts`) — receta de avíos + `llevaArte: false` (prenda lisa). Ojo con el
  // default de la bandera: es `true`, así que un modelo recién creado EXIGE arte.
  modelo = await cliente.modelo.create({
    data: { codigo: 'A-100', descripcion: 'Playera', llevaArte: false },
  });
  const avio = await cliente.avio.create({ data: { clave: 'HIL-1', descripcion: 'Hilo' } });
  await cliente.modeloAvio.create({
    data: { idModelo: modelo.id, idAvio: avio.id, consumoPorPrenda: 1, paraProduccion: true },
  });
  modeloInactivo = await cliente.modelo.create({ data: { codigo: 'Z-999', activo: false } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  colorAzul = await cliente.color.create({ data: { nombre: 'Azul' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  tallaG = await cliente.talla.create({ data: { etiqueta: 'G', orden: 3 } });
  lineaPedido = await crearRenglonPedido(empresa.id, clienteNegocio.id, modelo.id);
  campoCliente = await cliente.clienteCampo.create({
    data: { idCliente: clienteNegocio.id, etiqueta: 'No. de pedido del cliente' },
  });
  campoOtroCliente = await cliente.clienteCampo.create({
    data: { idCliente: otroCliente.id, etiqueta: 'Referencia Coppel' },
  });
});

describe('Órdenes (F2-E2) — permisos (deny-by-default, A4)', () => {
  it('sin administrar no se crea; sin ver no se lista; cancelar exige su permiso propio', async () => {
    await expect(
      crearOrden(sesion(['ordenes.ver']), { idPedidoLinea: lineaPedido.id }, bd()),
    ).rejects.toBeInstanceOf(Error);
    await expect(listarOrdenes(sesion([]), {}, bd())).rejects.toBeInstanceOf(Error);
  });
});

describe('Órdenes (F2-E2) — alta desde pedido + autorrelleno (A2, A9)', () => {
  it('crea la orden autorrellenando modelo/cliente/empresa del renglón→pedido', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    expect(orden.idModelo).toBe(modelo.id);
    expect(orden.idCliente).toBe(clienteNegocio.id);
    expect(orden.idEmpresa).toBe(empresa.id);
    expect(orden.idPedidoLinea).toBe(lineaPedido.id);
    expect(orden.estado).toBe('capturada'); // sin matriz aún
    expect(orden.folio).toBe(1);
  });

  it('permite N órdenes por el mismo renglón (resurtidos)', async () => {
    const s = sesion([...PERM_TODOS]);
    const o1 = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    const o2 = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    expect(o1.id).not.toBe(o2.id);
    expect([o1.folio, o2.folio].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('RECHAZA crear una orden SIN pedido (orden sin pedido = solo histórico, no captura)', async () => {
    const s = sesion([...PERM_TODOS]);
    await expect(crearOrden(s, {} as never, bd())).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('RECHAZA crear desde un renglón de pedido CANCELADO', async () => {
    const s = sesion([...PERM_TODOS]);
    const renglon = await crearRenglonPedido(empresa.id, clienteNegocio.id, modelo.id, {
      pedCancelado: true,
    });
    await expect(crearOrden(s, { idPedidoLinea: renglon.id }, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('RECHAZA crear desde un renglón de pedido marcado NO PRODUCIR', async () => {
    const s = sesion([...PERM_TODOS]);
    const renglon = await crearRenglonPedido(empresa.id, clienteNegocio.id, modelo.id, {
      noProducir: true,
    });
    await expect(crearOrden(s, { idPedidoLinea: renglon.id }, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('RECHAZA producir un modelo descontinuado', async () => {
    const s = sesion([...PERM_TODOS]);
    const renglon = await crearRenglonPedido(empresa.id, clienteNegocio.id, modeloInactivo.id);
    await expect(crearOrden(s, { idPedidoLinea: renglon.id }, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  /**
   * ⭐⭐ V1-E3 — LA MISMA REGLA, POR LA PUERTA NUEVA. `opciones.idModeloDeLaOrden` sella la orden con
   * OTRO modelo que el del renglón (el hijo de producción por color de `salidaAProduccion`), y ese
   * modelo tiene que pasar por la MISMA guarda: producir un modelo dado de baja está prohibido, dé
   * igual por qué puerta llegue. Hoy `salidaAProduccion` ya lo comprueba antes —el reuso rebota un
   * hijo descontinuado—, así que esto es la red del SEAM de dominio, no de ese camino: aquí se
   * ejercita directamente para que sea una red PROBADA y no una rama que nadie pisa.
   */
  it('⭐⭐ RECHAZA sellar la orden con un modelo descontinuado pasado por `idModeloDeLaOrden`', async () => {
    const s = sesion([...PERM_TODOS]);
    // El renglón apunta a un modelo VIVO: lo que está de baja es el modelo que se le quiere poner
    // a la orden. Si la guarda se cayera, la OP nacería del modelo descontinuado sin una queja.
    const renglon = await crearRenglonPedido(empresa.id, clienteNegocio.id, modelo.id);
    await expect(
      crearOrden(s, { idPedidoLinea: renglon.id }, bd(), {
        idModeloDeLaOrden: modeloInactivo.id,
      }),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(await cliente.orden.count({ where: { idPedidoLinea: renglon.id } })).toBe(0);
  });

  it('⭐ y un modelo que NO EXISTE por esa misma puerta da 404 (no un 500 crudo de FK)', async () => {
    const s = sesion([...PERM_TODOS]);
    const renglon = await crearRenglonPedido(empresa.id, clienteNegocio.id, modelo.id);
    await expect(
      crearOrden(s, { idPedidoLinea: renglon.id }, bd(), { idModeloDeLaOrden: 999_999 }),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('un renglón de pedido de OTRA empresa no existe para esta sesión (A9)', async () => {
    const s = sesion([...PERM_TODOS]);
    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa');
    const renglonOtra = await crearRenglonPedido(otra.id, clienteNegocio.id, modelo.id);
    await expect(crearOrden(s, { idPedidoLinea: renglonOtra.id }, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });
});

describe('Órdenes (F2-E2) — folio por empresa (A3/A9)', () => {
  it('CRÍTICO: 10 órdenes CONCURRENTES no colisionan de folio', async () => {
    const s = sesion([...PERM_TODOS]);
    const ordenes = await Promise.all(
      Array.from({ length: 10 }, () => crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd())),
    );
    const folios = ordenes.map((o) => o.folio);
    expect(new Set(folios).size).toBe(10);
    expect([...folios].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('cada empresa lleva su propia numeración (A9)', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Segunda Empresa');
    const renglonOtra = await crearRenglonPedido(otra.id, clienteNegocio.id, modelo.id);
    await crearOrden(sesion([...PERM_TODOS]), { idPedidoLinea: lineaPedido.id }, bd());
    const enB = await crearOrden(
      sesion([...PERM_TODOS], otra.id),
      { idPedidoLinea: renglonOtra.id },
      bd(),
    );
    expect(enB.folio).toBe(1); // numeración independiente por empresa
  });
});

describe('Órdenes (F2-E2) — matriz: totales derivados y validaciones (D4)', () => {
  it('guarda la matriz y deriva el total por suma de tallas', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    const conMatriz = await guardarMatrizOrden(
      s,
      orden.id,
      {
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 10 },
              { idTalla: tallaM.id, cantidad: 20 },
            ],
          },
          { idColor: colorAzul.id, tallas: [{ idTalla: tallaG.id, cantidad: 5 }] },
        ],
      },
      bd(),
    );
    expect(conMatriz.lineas).toHaveLength(2);
    expect(conMatriz.totalPiezas).toBe(35); // 10 + 20 + 5
    const rojo = conMatriz.lineas.find((l) => l.idColor === colorRojo.id);
    expect(rojo?.totalPiezas).toBe(30);
  });

  it('RECHAZA color repetido en la misma orden', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    await expect(
      guardarMatrizOrden(
        s,
        orden.id,
        {
          lineas: [
            { idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] },
            { idColor: colorRojo.id, tallas: [{ idTalla: tallaM.id, cantidad: 1 }] },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('RECHAZA una talla fuera del catálogo', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    await expect(
      guardarMatrizOrden(
        s,
        orden.id,
        { lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: 999_999, cantidad: 1 }] }] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('sincroniza la matriz al re-guardar (agrega/edita/quita) conservando la orden', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    await guardarMatrizOrden(
      s,
      orden.id,
      {
        lineas: [
          { idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] },
          { idColor: colorAzul.id, tallas: [{ idTalla: tallaG.id, cantidad: 5 }] },
        ],
      },
      bd(),
    );
    const reguardado = await guardarMatrizOrden(
      s,
      orden.id,
      // quita Azul, cambia la cantidad de Rojo y le agrega una talla
      {
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 30 },
              { idTalla: tallaM.id, cantidad: 7 },
            ],
          },
        ],
      },
      bd(),
    );
    expect(reguardado.lineas).toHaveLength(1);
    expect(reguardado.totalPiezas).toBe(37);
  });
});

/**
 * ⭐ V1-E3d (§Post-F9.43): el segundo requisito de "orden completa" pasó de *"¿el modelo tiene
 * avíos?"* a *"¿la receta de la OP está LIBERADA?"*. Estas pruebas hablan del semáforo, así que
 * ahora liberan la receta con el mismo camino del dominio (revisar todo + liberar).
 *
 * ⭐ V1-E3k (§Post-F9.80): firmar exige NOMBRAR cada renglón —ya no hay `alcance: 'todo'`—, así que
 * el helper lee la receta y los enumera. Es la misma vuelta que da la pantalla, y a propósito.
 */
async function liberarRecetaDe(_s: SesionUsuario, idOrden: number): Promise<void> {
  // Tocar la receta exige `desarrollo.administrar` (permiso REUSADO, A4): la sesión de estas
  // pruebas es la de Órdenes, así que aquí se usa la de Desarrollo a propósito.
  const sDesarrollo = sesion(['desarrollo.administrar', ...PERM_TODOS]);
  await marcarRecetaRevisada(sDesarrollo, idOrden, bd());
  const receta = await obtenerRecetaOrden(sDesarrollo, idOrden, bd());
  // Las lápidas (renglones que ESTA orden decidió no llevar) quedan fuera: no se compran, así que
  // firmarlas no significaría nada — y el dominio las rechaza si se nombran.
  const renglones = [
    ...receta.telas.filter((t) => !t.excluido).map((t) => ({ tipo: 'tela' as const, id: t.id })),
    ...receta.avios.filter((a) => !a.excluido).map((a) => ({ tipo: 'avio' as const, id: a.id })),
    ...receta.artes.filter((a) => !a.excluido).map((a) => ({ tipo: 'arte' as const, id: a.id })),
  ];
  await liberarReceta(sDesarrollo, idOrden, { renglones }, bd());
}

describe('Órdenes (F2-E2) — estado derivado (paridad FechaDet)', () => {
  it("deriva 'completa' + fechaCompletada en el PRIMER guardado de matriz, y NO antes", async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    expect(orden.estado).toBe('capturada');
    expect(orden.fechaCompletada).toBeNull();

    // V1-E3d: con la matriz ya no basta — falta LIBERAR la receta de esta orden.
    const soloMatriz = await guardarMatrizOrden(
      s,
      orden.id,
      { lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }] },
      bd(),
    );
    expect(soloMatriz.estado).toBe('capturada');
    expect(soloMatriz.requisitos.faltantes).toEqual(['receta']);

    await liberarRecetaDe(s, orden.id);
    const conMatriz = await obtenerOrden(s, orden.id, bd());
    expect(conMatriz.estado).toBe('completa');
    expect(conMatriz.fechaCompletada).not.toBeNull();
    const selladaEn = conMatriz.fechaCompletada;

    // Un segundo guardado NO re-sella la fecha (paridad con FechaDet del viejo).
    const reguardado = await guardarMatrizOrden(
      s,
      orden.id,
      { lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaM.id, cantidad: 3 }] }] },
      bd(),
    );
    expect(reguardado.estado).toBe('completa');
    expect(reguardado.fechaCompletada).toBe(selladaEn);
  });

  it('SIN la receta LIBERADA no se completa, aunque tenga matriz, y dice qué le falta', async () => {
    const s = sesion([...PERM_TODOS]);
    const sinAvios = await cliente.modelo.create({ data: { codigo: 'SIN-AV', llevaArte: false } });
    const renglon = await crearRenglonPedido(empresa.id, clienteNegocio.id, sinAvios.id);
    const orden = await crearOrden(
      s,
      {
        idPedidoLinea: renglon.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
      },
      bd(),
    );
    expect(orden.estado).toBe('capturada');
    expect(orden.fechaCompletada).toBeNull();
    expect(orden.requisitos).toMatchObject({ tallas: true, receta: false, arte: 'no-aplica' });
    expect(orden.requisitos.faltantes).toEqual(['receta']);
  });

  it('vaciar la matriz de una orden completa la REGRESA a capturada, conservando la fecha', async () => {
    const s = sesion([...PERM_TODOS]);
    const creada = await crearOrden(
      s,
      {
        idPedidoLinea: lineaPedido.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
      },
      bd(),
    );
    await liberarRecetaDe(s, creada.id);
    const orden = await obtenerOrden(s, creada.id, bd());
    expect(orden.estado).toBe('completa');

    const vaciada = await guardarMatrizOrden(s, orden.id, { lineas: [] }, bd());
    expect(vaciada.estado).toBe('capturada');
    // El sello histórico NO se borra (es el "cuándo quedó lista por primera vez").
    expect(vaciada.fechaCompletada).toBe(orden.fechaCompletada);
    expect(vaciada.requisitos.faltantes).toEqual(['tallas']);
  });

  it('LIBERAR la receta completa la orden; y editar el BOM del modelo ya NO la alcanza (V1-E3d)', async () => {
    const s = sesion([...PERM_TODOS]);
    const modeloBase = await cliente.modelo.create({ data: { codigo: 'BOM-1', llevaArte: false } });
    const avio = await cliente.avio.create({ data: { clave: 'BTN-9', descripcion: 'Botón' } });
    await cliente.modeloAvio.create({
      data: { idModelo: modeloBase.id, idAvio: avio.id, consumoPorPrenda: 2 },
    });
    const renglon = await crearRenglonPedido(empresa.id, clienteNegocio.id, modeloBase.id);
    const matriz = [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }];
    const orden = await crearOrden(s, { idPedidoLinea: renglon.id, lineas: matriz }, bd());
    const cancelada = await crearOrden(s, { idPedidoLinea: renglon.id, lineas: matriz }, bd());
    await cancelarOrden(s, cancelada.id, { motivo: 'prueba' }, bd());
    expect(orden.estado).toBe('capturada');

    await liberarRecetaDe(s, orden.id);

    // La orden se completó al liberar su receta, con su bitácora propia (A7).
    const recalculada = await obtenerOrden(s, orden.id, bd());
    expect(recalculada.estado).toBe('completa');
    expect(recalculada.fechaCompletada).not.toBeNull();
    // A7: el acto que la completó (liberar la receta) queda rastreado CONTRA EL ID DE LA ORDEN.
    // La entidad es `RecetaOrden` porque eso fue lo que se tocó; el id sigue siendo el de la orden,
    // que es como se busca. No se duplica un renglón bajo `Orden` solo para repetir lo mismo.
    const rastro = await cliente.bitacora.findFirst({
      where: { entidad: 'RecetaOrden', idEntidad: String(orden.id), accion: 'MODIFICAR' },
      orderBy: { id: 'desc' },
    });
    expect(rastro?.datos).toMatchObject({ accion: 'liberar-receta' });
    // La cancelada sigue cancelada (cancelada siempre gana) y su receta no se puede tocar.
    expect((await obtenerOrden(s, cancelada.id, bd())).estado).toBe('cancelada');

    // ⭐ Y al VACIAR el BOM del MODELO, la orden ni se entera: su receta está congelada. Antes de
    // esta etapa el estado dependía del modelo y la pantalla decía "Falta: avíos".
    const sAdmin = sesion(['modelos.administrar', ...PERM_TODOS]);
    await reemplazarAviosBom(sAdmin, modeloBase.id, [], bd());
    const trasCambioDeModelo = await obtenerOrden(s, orden.id, bd());
    expect(trasCambioDeModelo.estado).toBe('completa');
    expect(trasCambioDeModelo.requisitos.faltantes).toEqual([]);
  });

  it('modelo que LLEVA arte (default) sin arte capturado: la orden queda INCOMPLETA por arte', async () => {
    const s = sesion([...PERM_TODOS]);
    // Default de Daniel: un modelo nuevo LLEVA arte mientras no lo desmarquen.
    const conArte = await cliente.modelo.create({ data: { codigo: 'ARTE-1' } });
    const avio = await cliente.avio.create({ data: { clave: 'ELA-1', descripcion: 'Elástico' } });
    await cliente.modeloAvio.create({
      data: { idModelo: conArte.id, idAvio: avio.id, consumoPorPrenda: 1, paraProduccion: true },
    });
    const renglon = await crearRenglonPedido(empresa.id, clienteNegocio.id, conArte.id);
    const orden = await crearOrden(
      s,
      {
        idPedidoLinea: renglon.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
      },
      bd(),
    );
    await liberarRecetaDe(s, orden.id);
    const sinArte = await obtenerOrden(s, orden.id, bd());
    expect(sinArte.estado).toBe('capturada');
    expect(sinArte.requisitos).toMatchObject({ tallas: true, receta: true, arte: false });
    expect(sinArte.requisitos.faltantes).toEqual(['arte']);

    // ⭐ V1-E3d: capturar el arte en el MODELO ya no alcanza a la orden (su receta está congelada);
    // el arte se agrega a la RECETA DE LA ORDEN, y ahí sí la completa.
    const sAdmin = sesion(['modelos.administrar', ...PERM_TODOS]);
    const arteModelo = await crearArte(
      sAdmin,
      conArte.id,
      { descripcion: 'Logo pecho', idTipoArte, precio: 10 },
      bd(),
    );
    expect((await obtenerOrden(s, orden.id, bd())).requisitos.arte).toBe(false);

    await agregarRenglonReceta(
      sesion(['desarrollo.administrar', ...PERM_TODOS]),
      orden.id,
      { tipo: 'arte', idModeloArte: arteModelo.id, precio: 10 },
      bd(),
    );
    // Meter material a una receta ya liberada la RE-ABRE (la firma de Desarrollo se revoca), así que
    // la orden vuelve a quedar incompleta hasta que Desarrollo la libere de nuevo.
    expect((await obtenerOrden(s, orden.id, bd())).requisitos).toMatchObject({
      arte: true,
      receta: false,
    });
    await liberarRecetaDe(s, orden.id);

    const conArteCapturado = await obtenerOrden(s, orden.id, bd());
    expect(conArteCapturado.estado).toBe('completa');
    expect(conArteCapturado.requisitos.arte).toBe(true);
  });

  it('DESMARCAR "lleva arte" en el modelo completa sus órdenes (prenda lisa)', async () => {
    const s = sesion([...PERM_TODOS]);
    const conArte = await cliente.modelo.create({ data: { codigo: 'ARTE-2' } });
    const avio = await cliente.avio.create({ data: { clave: 'ELA-2', descripcion: 'Elástico' } });
    await cliente.modeloAvio.create({
      data: { idModelo: conArte.id, idAvio: avio.id, consumoPorPrenda: 1, paraProduccion: true },
    });
    const renglon = await crearRenglonPedido(empresa.id, clienteNegocio.id, conArte.id);
    const orden = await crearOrden(
      s,
      {
        idPedidoLinea: renglon.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
      },
      bd(),
    );
    expect(orden.estado).toBe('capturada');
    await liberarRecetaDe(s, orden.id);

    await actualizarModelo(
      sesion(['modelos.administrar', ...PERM_TODOS]),
      { id: conArte.id, llevaArte: false },
      bd(),
    );

    const lista = await obtenerOrden(s, orden.id, bd());
    expect(lista.estado).toBe('completa');
    expect(lista.requisitos.arte).toBe('no-aplica');
  });

  it('una orden CON actividad de producción no se des-completa aunque le vacíen la matriz', async () => {
    const s = sesion([...PERM_TODOS]);
    const creada = await crearOrden(
      s,
      {
        idPedidoLinea: lineaPedido.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
      },
      bd(),
    );
    await liberarRecetaDe(s, creada.id);
    const orden = await obtenerOrden(s, creada.id, bd());
    expect(orden.estado).toBe('completa');

    // Un corte VIVO = la orden ya está en producción (no importa por qué camino se registró).
    await cliente.etapaMovimiento.create({
      data: {
        folio: 1n,
        idEmpresa: empresa.id,
        idOrden: orden.id,
        tipo: 'corte',
        fecha: new Date('2026-07-26T00:00:00.000Z'),
      },
    });

    const vaciada = await guardarMatrizOrden(s, orden.id, { lineas: [] }, bd());
    expect(vaciada.estado).toBe('completa'); // NO se degrada: está a medio producir
    expect(vaciada.requisitos.faltantes).toEqual(['tallas']); // pero la pantalla lo dice
  });

  it('crear con matriz en el alta nace CAPTURADA: falta que Desarrollo libere su receta', async () => {
    // V1-E3d: nacer "completa" de un tirón ya no puede pasar — la receta acaba de copiarse y nadie
    // la ha mirado. Es exactamente el control que Daniel pidió antes de comprar.
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(
      s,
      {
        idPedidoLinea: lineaPedido.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    expect(orden.estado).toBe('capturada');
    expect(orden.requisitos.faltantes).toEqual(['receta']);
    expect(orden.totalPiezas).toBe(10);

    await liberarRecetaDe(s, orden.id);
    expect((await obtenerOrden(s, orden.id, bd())).estado).toBe('completa');
  });
});

describe('Órdenes (F2-E2) — copiar matriz por etiqueta de talla (CopiarDetallesOrd)', () => {
  it('copia la matriz completa de otra orden (tallas por su etiqueta del catálogo)', async () => {
    const s = sesion([...PERM_TODOS]);
    const origen = await crearOrden(
      s,
      {
        idPedidoLinea: lineaPedido.id,
        lineas: [
          {
            idColor: colorRojo.id,
            tallas: [
              { idTalla: tallaCH.id, cantidad: 10 },
              { idTalla: tallaG.id, cantidad: 4 },
            ],
          },
        ],
      },
      bd(),
    );
    const destino = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());

    const copiada = await copiarDetalleOrden(s, destino.id, { idOrdenOrigen: origen.id }, bd());
    expect(copiada.lineas).toHaveLength(1);
    expect(copiada.totalPiezas).toBe(14);
    const etiquetas = copiada.lineas[0]?.tallas.map((t) => t.etiquetaTalla).sort();
    expect(etiquetas).toEqual(['CH', 'G']);
    // V1-E3d: copiar matriz cumple el requisito de tallas, pero falta liberar la receta.
    expect(copiada.requisitos.tallas).toBe(true);
    expect(copiada.requisitos.faltantes).toEqual(['receta']);
    await liberarRecetaDe(s, destino.id);
    expect((await obtenerOrden(s, destino.id, bd())).estado).toBe('completa');
  });

  it('RECHAZA copiar la matriz de una orden sobre sí misma', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    await expect(
      copiarDetalleOrden(s, orden.id, { idOrdenOrigen: orden.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe('Órdenes (F2-E2) — referencias por cliente (D7)', () => {
  it('guarda una referencia con un campo del cliente de la orden', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    const conRef = await guardarReferenciasOrden(
      s,
      orden.id,
      { referencias: [{ idClienteCampo: campoCliente.id, valor: 'PO-12345' }] },
      bd(),
    );
    expect(conRef.referencias).toHaveLength(1);
    expect(conRef.referencias[0]?.valor).toBe('PO-12345');
    expect(conRef.referencias[0]?.etiqueta).toBe('No. de pedido del cliente');
  });

  /**
   * Regresión (24-jul-2026): guardar referencias NO sellaba `modificadoEn`/`modificadoPorId` de la
   * orden aunque la orden sí cambiaba → el "Historial" del detalle mentía y la UI, que se
   * re-sincroniza por `modificadoEn`, se quedaba creyendo que había cambios sin guardar para
   * siempre (lo destapó el e2e `ordenes.spec.ts`). Las referencias son datos de la ORDEN (A7).
   */
  it('guardar referencias SELLA la auditoría de la orden y deja bitácora MODIFICAR', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    const antes = await cliente.orden.findUniqueOrThrow({ where: { id: orden.id } });

    // OTRO usuario guarda las referencias: así el sello es comprobable sin depender del reloj
    // (`modificadoEn` es `@updatedAt`; crear y guardar pueden caer en el mismo milisegundo).
    const otro = sesionDePrueba({
      id: 'usuario-referencias',
      idEmpresaActiva: empresa.id,
      permisos: [...PERM_TODOS],
    });
    await guardarReferenciasOrden(
      otro,
      orden.id,
      { referencias: [{ idClienteCampo: campoCliente.id, valor: 'PO-777' }] },
      bd(),
    );

    const despues = await cliente.orden.findUniqueOrThrow({ where: { id: orden.id } });
    expect(despues.modificadoPorId).toBe('usuario-referencias');
    expect(despues.modificadoEn.getTime()).toBeGreaterThanOrEqual(antes.modificadoEn.getTime());

    const eventos = await cliente.bitacora.findMany({
      where: { entidad: 'Orden', idEntidad: String(orden.id) },
      orderBy: { id: 'asc' },
    });
    // CREAR + MODIFICAR (referencias)
    expect(eventos.map((e) => e.accion)).toEqual(['CREAR', 'MODIFICAR']);
    expect((eventos[1]?.datos as { referencias?: number } | null)?.referencias).toBe(1);
  });

  it('RECHAZA una referencia con un ClienteCampo de OTRO cliente', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    await expect(
      guardarReferenciasOrden(
        s,
        orden.id,
        { referencias: [{ idClienteCampo: campoOtroCliente.id, valor: 'X' }] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe('Órdenes (F2-E2) — búsqueda combinada (folio/modelo/cliente/referencia)', () => {
  it('encuentra una orden por el VALOR de una referencia (D7, índice)', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    await guardarReferenciasOrden(
      s,
      orden.id,
      { referencias: [{ idClienteCampo: campoCliente.id, valor: 'MONARCH-778' }] },
      bd(),
    );
    const pagina = await listarOrdenes(s, { busqueda: 'MONARCH-778' }, bd());
    expect(pagina.datos.some((o) => o.id === orden.id)).toBe(true);
    const vacio = await listarOrdenes(s, { busqueda: 'no-existe-zzz' }, bd());
    expect(vacio.datos).toHaveLength(0);
  });

  it('encuentra por código de modelo y por folio', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    const porModelo = await listarOrdenes(s, { busqueda: 'A-100' }, bd());
    expect(porModelo.datos.some((o) => o.id === orden.id)).toBe(true);
    const porFolio = await listarOrdenes(s, { busqueda: String(orden.folio) }, bd());
    expect(porFolio.datos.some((o) => o.id === orden.id)).toBe(true);
  });
});

/**
 * ⭐⭐ LA BÚSQUEDA ENTIENDE LOS DOS NOMBRES (§Post-F9.172(a)) — contra Postgres de verdad.
 *
 * Es el cierre del defecto medido: el importador escribe la División DOS veces —al catálogo con FK y
 * como TEXTO CRUDO en `OrdenReferencia.valor`— y fusionar «2-HOMBRE» en «Caballeros» sólo movía el
 * catálogo. Aquí se reproduce tal cual: una orden cuya referencia dice «2-HOMBRE», una fusión de
 * verdad (por el dominio, no sembrada a mano) y la búsqueda por el nombre bueno.
 *
 * 🔴 Los DOS sentidos van en pruebas SEPARADAS: cubrir uno y no el otro pasaría en verde y fallaría
 * justo con quien tiene el papel viejo en la mano.
 */
describe('Órdenes — búsqueda por el SINÓNIMO del departamento fusionado (§Post-F9.172(a))', () => {
  const sesionFusion = () =>
    sesionDePrueba({
      idEmpresaActiva: empresa.id,
      permisos: ['ordenes.ver', 'ordenes.administrar', 'clientes.ver', 'clientes.administrar'],
    });

  /** Deja una orden cuya referencia dice `valorReferencia`, y devuelve su id. */
  async function ordenConReferencia(valorReferencia: string): Promise<number> {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    await guardarReferenciasOrden(
      s,
      orden.id,
      { referencias: [{ idClienteCampo: campoCliente.id, valor: valorReferencia }] },
      bd(),
    );
    return orden.id;
  }

  /** Fusiona de verdad «2-HOMBRE» dentro de «Caballeros» y devuelve los dos ids. */
  async function fusionarHombreEnCaballeros(): Promise<{ destino: number; origen: number }> {
    const destino = await cliente.clienteDepartamento.create({
      data: { idCliente: clienteNegocio.id, nombre: 'Caballeros' },
    });
    const origen = await cliente.clienteDepartamento.create({
      data: { idCliente: clienteNegocio.id, nombre: '2-HOMBRE' },
    });
    await fusionarDepartamentosCliente(
      sesionFusion(),
      clienteNegocio.id,
      { idDestino: destino.id, origenes: [origen.id] },
      bd(),
    );
    // El fixture NO miente: después de la fusión el absorbido tiene rastro de verdad.
    const absorbido = await cliente.clienteDepartamento.findUniqueOrThrow({
      where: { id: origen.id },
    });
    expect(absorbido.idFusionadoEn).toBe(destino.id);
    return { destino: destino.id, origen: origen.id };
  }

  it('DESTINO → ORIGEN: buscar «Caballeros» encuentra la orden que dice «2-hombre»', async () => {
    // 🔴 LA GRAFÍA ES DISTINTA A PROPÓSITO: la orden dice «2-hombre» y el catálogo «2-HOMBRE».
    // Es la PREMISA de la etapa —el texto de la OC y el nombre del catálogo se escriben distinto— y
    // es lo ÚNICO que ejercita de verdad el `mode: 'insensitive'` del `equals` CONTRA POSTGRES:
    // las unit fijan la FORMA de la cláusula, no su semántica en la base. Con las dos grafías
    // iguales, un `equals` sensible a mayúsculas pasaría esta prueba en verde.
    const idOrden = await ordenConReferencia('2-hombre');
    await fusionarHombreEnCaballeros();
    const pagina = await listarOrdenes(sesion([...PERM_TODOS]), { busqueda: 'Caballeros' }, bd());
    expect(pagina.datos.some((o) => o.id === idOrden)).toBe(true);
  });

  it('ORIGEN → DESTINO: buscar «2-HOMBRE» encuentra la orden que dice «Caballeros»', async () => {
    const idOrden = await ordenConReferencia('Caballeros');
    await fusionarHombreEnCaballeros();
    const pagina = await listarOrdenes(sesion([...PERM_TODOS]), { busqueda: '2-HOMBRE' }, bd());
    expect(pagina.datos.some((o) => o.id === idOrden)).toBe(true);
  });

  it('⭐ SIN fusionar, la misma búsqueda NO la encuentra (es la fusión la que la trae, no el texto)', async () => {
    // Misma grafía «2-hombre» que el caso de arriba: si el control usara otra, no controlaría nada.
    const idOrden = await ordenConReferencia('2-hombre');
    await cliente.clienteDepartamento.create({
      data: { idCliente: clienteNegocio.id, nombre: 'Caballeros' },
    });
    await cliente.clienteDepartamento.create({
      data: { idCliente: clienteNegocio.id, nombre: '2-HOMBRE' },
    });
    const pagina = await listarOrdenes(sesion([...PERM_TODOS]), { busqueda: 'Caballeros' }, bd());
    expect(pagina.datos.some((o) => o.id === idOrden)).toBe(false);
  });

  it('la CADENA de dos saltos también se entiende (A→B→C, buscando por la punta)', async () => {
    const idOrden = await ordenConReferencia('2-HOMBRE');
    const { destino, origen } = await fusionarHombreEnCaballeros();
    // Segundo salto: «Caballeros» se va dentro de «VARONIL».
    const final = await cliente.clienteDepartamento.create({
      data: { idCliente: clienteNegocio.id, nombre: 'VARONIL' },
    });
    await fusionarDepartamentosCliente(
      sesionFusion(),
      clienteNegocio.id,
      { idDestino: final.id, origenes: [destino] },
      bd(),
    );
    // La cadena NO se aplana: «2-HOMBRE» sigue apuntando a «Caballeros», que ahora apunta a «VARONIL».
    const eslabon = await cliente.clienteDepartamento.findUniqueOrThrow({ where: { id: origen } });
    expect(eslabon.idFusionadoEn).toBe(destino);

    const pagina = await listarOrdenes(sesion([...PERM_TODOS]), { busqueda: 'VARONIL' }, bd());
    expect(pagina.datos.some((o) => o.id === idOrden)).toBe(true);
  });
});

describe('Órdenes (F2-E2) — cancelación suave (motivo obligatorio)', () => {
  it('cancela con motivo, sigue consultable y no se cancela dos veces', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    const cancelada = await cancelarOrden(s, orden.id, { motivo: 'Cliente desistió' }, bd());
    expect(cancelada.estado).toBe('cancelada');
    expect(cancelada.motivoCancelada).toBe('Cliente desistió');

    const vista = await obtenerOrden(s, orden.id, bd());
    expect(vista.estado).toBe('cancelada');

    // por defecto el listado NO trae canceladas; con incluirCanceladas sí
    const sinCanceladas = await listarOrdenes(s, {}, bd());
    expect(sinCanceladas.datos.some((o) => o.id === orden.id)).toBe(false);
    const conCanceladas = await listarOrdenes(s, { incluirCanceladas: true }, bd());
    expect(conCanceladas.datos.some((o) => o.id === orden.id)).toBe(true);

    await expect(cancelarOrden(s, orden.id, { motivo: 'otra vez' }, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('no se puede editar ni cambiar la matriz de una orden cancelada', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    await cancelarOrden(s, orden.id, { motivo: 'x' }, bd());
    await expect(
      actualizarOrden(s, { id: orden.id, observaciones: 'nuevo' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(
      guardarMatrizOrden(
        s,
        orden.id,
        { lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] }] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('Órdenes (F2-E2) — comentarios inmutables (ComentaOrd)', () => {
  it('agrega comentarios cronológicos con su autor', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    await agregarComentarioOrden(s, orden.id, { comentario: 'El estampado lleva puff' }, bd());
    const conDos = await agregarComentarioOrden(s, orden.id, { comentario: 'Confirmado' }, bd());
    expect(conDos.comentarios).toHaveLength(2);
    expect(conDos.comentarios[0]?.comentario).toBe('El estampado lleva puff');
    expect(conDos.comentarios[0]?.idUsuario).toBe(s.id);
  });

  /**
   * ⭐ V1 «los nombres, en vez de los ids» — el panel de comentarios pintaba el id crudo porque el
   * contrato NO mandaba el nombre. `OrdenComentario.idUsuario` no tiene FK física (es un log
   * inmutable), así que el nombre no llega solo: lo resuelve el servidor. Mismo patrón que ya usaba
   * `NegociacionEvento` (V1-E8q).
   */
  it('🔴 cada comentario sale con el NOMBRE de quien lo escribió (resuelto en el servidor)', async () => {
    const autor = await cliente.usuario.create({
      data: {
        username: 'dmasri-comentarios',
        nombre: 'Daniel Masri',
        email: 'dmasri-comentarios@control.local',
      },
    });
    const s = sesion([...PERM_TODOS]);
    const sesionAutor = { ...s, id: autor.id };
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    await agregarComentarioOrden(
      sesionAutor,
      orden.id,
      { comentario: 'Adelantar la entrega' },
      bd(),
    );

    const conNombre = await obtenerOrden(s, orden.id, bd());
    expect(conNombre.comentarios[0]?.idUsuario).toBe(autor.id);
    expect(conNombre.comentarios[0]?.nombreUsuario).toBe('Daniel Masri');
  });

  /**
   * 🔴 D3 — un autor que ya no resuelve deja el nombre en `null` y el comentario SE SIGUE LEYENDO.
   * Dar de baja a alguien no borra lo que escribió. (`sesion()` usa el id 'usuario-prueba', que no
   * existe como fila en la BD: es justo el caso del id sin usuario.)
   */
  it('un autor desconocido deja el nombre en null pero NO pierde el comentario', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    await agregarComentarioOrden(s, orden.id, { comentario: 'sin autor resoluble' }, bd());

    const leida = await obtenerOrden(s, orden.id, bd());
    expect(leida.comentarios[0]?.nombreUsuario).toBeNull();
    expect(leida.comentarios[0]?.comentario).toBe('sin autor resoluble');
  });

  /**
   * El LISTADO también trae el nombre, y lo resuelve para la PÁGINA COMPLETA de una sola consulta:
   * `aOrdenSalida` es síncrona a propósito para que no se pueda colar un N+1 por renglón.
   *
   * 🔴 Por eso hay DOS órdenes con autores DISTINTOS y se asevera sobre la que NO va primera. El
   * orden por defecto es `folio desc`, así que una sola orden cae SIEMPRE en el renglón 0 y un
   * `datos.slice(0, 1).flatMap(...)` —resolver sólo el primer renglón— pasaría en verde. Con la
   * segunda orden abajo, esa mutación muere.
   */
  it('el listado resuelve la PÁGINA COMPLETA, no sólo el primer renglón', async () => {
    const gabriel = await cliente.usuario.create({
      data: {
        username: 'gabriel-listado',
        nombre: 'Gabriel Núñez',
        email: 'gabriel-listado@control.local',
      },
    });
    const ana = await cliente.usuario.create({
      data: { username: 'ana-listado', nombre: 'Ana Ruiz', email: 'ana-listado@control.local' },
    });
    const s = sesion([...PERM_TODOS]);

    // La PRIMERA que se crea lleva el folio menor ⇒ con `folio desc` queda ABAJO. Es sobre ésa
    // sobre la que se asevera.
    const vieja = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    await agregarComentarioOrden(
      { ...s, id: gabriel.id },
      vieja.id,
      { comentario: 'la de abajo' },
      bd(),
    );
    const nueva = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    await agregarComentarioOrden(
      { ...s, id: ana.id },
      nueva.id,
      { comentario: 'la de arriba' },
      bd(),
    );

    const pagina = await listarOrdenes(s, {}, bd());
    const posVieja = pagina.datos.findIndex((o) => o.id === vieja.id);
    const posNueva = pagina.datos.findIndex((o) => o.id === nueva.id);
    // Guardia de la propia prueba: si `vieja` cayera primera, el `slice(0, 1)` sobreviviría y esta
    // prueba no estaría probando lo que su nombre dice.
    expect(posNueva).toBeLessThan(posVieja);
    expect(posVieja).toBeGreaterThan(0);

    expect(pagina.datos[posNueva]?.comentarios[0]?.nombreUsuario).toBe('Ana Ruiz');
    expect(pagina.datos[posVieja]?.comentarios[0]?.nombreUsuario).toBe('Gabriel Núñez');
  });
});

describe('Órdenes (F2-E2) — bitácora (A7)', () => {
  it('registra el cambio de matriz en Bitacora', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    await guardarMatrizOrden(
      s,
      orden.id,
      { lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }] },
      bd(),
    );
    const eventos = await cliente.bitacora.findMany({
      where: { entidad: 'Orden', idEntidad: String(orden.id) },
      orderBy: { id: 'asc' },
    });
    // CREAR + MODIFICAR (matriz)
    expect(eventos.map((e) => e.accion)).toEqual(['CREAR', 'MODIFICAR']);
    const matriz = eventos[1]?.datos as { matriz?: number } | null;
    expect(matriz?.matriz).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐ EL PACK / TENDIDO EN LA MATRIZ DE LA OP (§Post-F9.10)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 DANIEL: *«Me gusta que exista **un solo Negro** y no esté fragmentado en miles de colores
// escritos de diferente manera.»* C&A pide varios TENDIDOS en una misma OP y antes la letra iba
// dentro del nombre del color («Negro A», «Negro B»). Desde §Post-F9.10 el renglón de la matriz es
// COLOR × PACK, y la llave `@@unique([idOrden, idColor, pack])` lo sostiene en la BD.
describe('Matriz de la OP por PACK (§Post-F9.10)', () => {
  const s = () => sesion([...PERM_TODOS]);

  const guardar = async (id: number, lineas: unknown[]) =>
    guardarMatrizOrden(s(), id, { lineas } as never, bd());

  it('el MISMO color puede ir dos veces si son tendidos distintos', async () => {
    const orden = await crearOrden(s(), { idPedidoLinea: lineaPedido.id }, bd());
    const conPacks = await guardar(orden.id, [
      { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
      { idColor: colorRojo.id, pack: 'B', tallas: [{ idTalla: tallaCH.id, cantidad: 3 }] },
    ]);
    expect(conPacks.lineas).toHaveLength(2);
    expect(conPacks.lineas.map((l) => l.pack).sort()).toEqual(['A', 'B']);
    expect(new Set(conPacks.lineas.map((l) => l.idColor)).size).toBe(1);
    expect(conPacks.totalPiezas).toBe(8);
  });

  it('…pero el mismo color CON EL MISMO pack sigue siendo un error de captura', async () => {
    const orden = await crearOrden(s(), { idPedidoLinea: lineaPedido.id }, bd());
    await expect(
      guardar(orden.id, [
        { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] },
        { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaM.id, cantidad: 1 }] },
      ]),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('🔴 la orden es CON packs o SIN packs, nunca mezclada', async () => {
    const orden = await crearOrden(s(), { idPedidoLinea: lineaPedido.id }, bd());
    await expect(
      guardar(orden.id, [
        { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] },
        { idColor: colorAzul.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] },
      ]),
    ).rejects.toThrow(/o todos los tendidos llevan su pack, o ninguno/);
  });

  it('los espacios no fabrican un tendido: "  " sigue siendo «sin pack»', async () => {
    const orden = await crearOrden(s(), { idPedidoLinea: lineaPedido.id }, bd());
    const sinPack = await guardar(orden.id, [
      { idColor: colorRojo.id, pack: '   ', tallas: [{ idTalla: tallaCH.id, cantidad: 4 }] },
    ]);
    expect(sinPack.lineas[0]?.pack).toBe('');
  });

  it('🔴 una orden SIN packs se guarda exactamente igual que antes (el campo sale vacío)', async () => {
    const orden = await crearOrden(s(), { idPedidoLinea: lineaPedido.id }, bd());
    const sinPacks = await guardar(orden.id, [
      { idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] },
      { idColor: colorAzul.id, tallas: [{ idTalla: tallaM.id, cantidad: 5 }] },
    ]);
    expect(sinPacks.lineas.map((l) => l.pack)).toEqual(['', '']);
    // Y la regla vieja sigue viva: un color no puede repetirse cuando no hay packs.
    await expect(
      guardar(orden.id, [
        { idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 1 }] },
        { idColor: colorRojo.id, tallas: [{ idTalla: tallaM.id, cantidad: 1 }] },
      ]),
    ).rejects.toThrow(/color no puede aparecer dos veces/);
  });

  it('el pack de un renglón YA EN PRODUCCIÓN no se puede cambiar', async () => {
    const orden = await crearOrden(s(), { idPedidoLinea: lineaPedido.id }, bd());
    const guardada = await guardar(orden.id, [
      { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
    ]);
    const idRenglon = guardada.lineas[0]?.id;

    // Una etapa VIVA cualquiera basta: el corte se guardó con el pack que tenía la matriz.
    await cliente.etapaMovimiento.create({
      data: {
        folio: 900n,
        idEmpresa: empresa.id,
        idOrden: orden.id,
        tipo: 'corte',
        fecha: new Date('2026-06-18'),
      },
    });

    await expect(
      guardar(orden.id, [
        {
          id: idRenglon,
          idColor: colorRojo.id,
          pack: 'B',
          tallas: [{ idTalla: tallaCH.id, cantidad: 5 }],
        },
      ]),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Dejarle SU pack sí se puede: lo que se bloquea es cambiarlo, no tocar el renglón.
    const igual = await guardar(orden.id, [
      {
        id: idRenglon,
        idColor: colorRojo.id,
        pack: 'A',
        tallas: [{ idTalla: tallaCH.id, cantidad: 7 }],
      },
    ]);
    expect(igual.lineas[0]?.pack).toBe('A');
    expect(igual.totalPiezas).toBe(7);
  });

  // ── Las DOS puertas por las que se colaba una guarda atada al `id` del renglón ────────────────
  //
  // La prueba de arriba sólo cubre el camino CON `id` (editar un renglón existente). Una matriz
  // puede re-empacar un color SIN tocar un solo `id`, y por ahí el daño entraba en silencio: el
  // corte queda llaveado con el pack viejo y esas piezas ya NO se pueden enviar nunca.

  /** Marca la orden como «ya en producción» con una etapa viva (basta una, `requisitos-orden.ts`). */
  async function conProduccionViva(idOrden: number, folio: bigint): Promise<void> {
    await cliente.etapaMovimiento.create({
      data: {
        folio,
        idEmpresa: empresa.id,
        idOrden,
        tipo: 'corte',
        fecha: new Date('2026-06-18'),
      },
    });
  }

  it('🔴 PUERTA A — borrar y recrear: re-empacar un color SIN mandar `id` tampoco se puede', async () => {
    const orden = await crearOrden(s(), { idPedidoLinea: lineaPedido.id }, bd());
    await guardar(orden.id, [
      { idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] },
    ]);
    await conProduccionViva(orden.id, 901n);

    // Mismo color, ahora partido en dos tendidos, SIN un solo `id`: el diff borra el renglón viejo
    // y crea dos nuevos. Atada al `id`, la guarda no veía ningún cambio y esto pasaba.
    await expect(
      guardar(orden.id, [
        { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
        { idColor: colorRojo.id, pack: 'B', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
      ]),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Y la matriz quedó como estaba: sin packs, un renglón. No se guardó nada a medias (A2).
    const despues = await obtenerOrden(s(), orden.id, bd());
    expect(despues.lineas).toHaveLength(1);
    expect(despues.lineas[0]?.pack).toBe('');

    // Recapturar el MISMO color con el MISMO pack (vacío) y otras cantidades sí se puede: lo que se
    // bloquea es re-empacar, no volver a teclear el renglón.
    const ok = await guardar(orden.id, [
      { idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 12 }] },
    ]);
    expect(ok.totalPiezas).toBe(12);
  });

  it('🔴 PUERTA B — `copiarDetalleOrden`: copiar una matriz CON packs sobre una orden ya cortada', async () => {
    // El origen se fabrica por tendidos…
    const origen = await crearOrden(s(), { idPedidoLinea: lineaPedido.id }, bd());
    await guardar(origen.id, [
      { idColor: colorRojo.id, pack: 'A', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
      { idColor: colorRojo.id, pack: 'B', tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] },
    ]);

    // …y el destino ya tiene ese color cortado SIN packs.
    const renglonDestino = await crearRenglonPedido(empresa.id, clienteNegocio.id, modelo.id);
    const destino = await crearOrden(s(), { idPedidoLinea: renglonDestino.id }, bd());
    await guardar(destino.id, [
      { idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] },
    ]);
    await conProduccionViva(destino.id, 902n);

    // `copiarDetalleOrden` arma su set SIN `id` en ningún renglón: una guarda por `id` NUNCA se
    // ejecutaba aquí, así que esto re-empacaba el destino en silencio, siempre.
    await expect(
      copiarDetalleOrden(s(), destino.id, { idOrdenOrigen: origen.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    const despues = await obtenerOrden(s(), destino.id, bd());
    expect(despues.lineas).toHaveLength(1);
    expect(despues.lineas[0]?.pack).toBe('');
  });

  it('copiar una matriz SIN packs sobre una orden cortada sin packs sigue funcionando', async () => {
    // La contraprueba: la guarda tiene que morder SÓLO cuando los packs de un color cambian. Sin
    // ella, esta copia —el flujo de siempre— quedaría rota por una regla demasiado ancha.
    const origen = await crearOrden(s(), { idPedidoLinea: lineaPedido.id }, bd());
    await guardar(origen.id, [
      { idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 4 }] },
    ]);
    const renglonDestino = await crearRenglonPedido(empresa.id, clienteNegocio.id, modelo.id);
    const destino = await crearOrden(s(), { idPedidoLinea: renglonDestino.id }, bd());
    await guardar(destino.id, [
      { idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] },
    ]);
    await conProduccionViva(destino.id, 903n);

    const copiada = await copiarDetalleOrden(s(), destino.id, { idOrdenOrigen: origen.id }, bd());
    expect(copiada.totalPiezas).toBe(4);
    expect(copiada.lineas[0]?.pack).toBe('');
  });
});
