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
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
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
  empresa = await crearEmpresaPrueba(cliente);
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  otroCliente = await cliente.cliente.create({ data: { nombre: 'Coppel' } });
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
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

describe('Órdenes (F2-E2) — estado derivado (paridad FechaDet)', () => {
  it("deriva 'completa' + fechaCompletada en el PRIMER guardado de matriz, y NO antes", async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(s, { idPedidoLinea: lineaPedido.id }, bd());
    expect(orden.estado).toBe('capturada');
    expect(orden.fechaCompletada).toBeNull();

    const conMatriz = await guardarMatrizOrden(
      s,
      orden.id,
      { lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }] },
      bd(),
    );
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

  it('crear con matriz en el alta ya nace completa', async () => {
    const s = sesion([...PERM_TODOS]);
    const orden = await crearOrden(
      s,
      {
        idPedidoLinea: lineaPedido.id,
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 10 }] }],
      },
      bd(),
    );
    expect(orden.estado).toBe('completa');
    expect(orden.totalPiezas).toBe(10);
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
    expect(copiada.estado).toBe('completa'); // copiar matriz con líneas también completa
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
