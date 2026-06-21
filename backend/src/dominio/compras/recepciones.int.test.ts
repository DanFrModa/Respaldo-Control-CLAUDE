import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { existenciaAvioBloqueada, existenciaTelaBloqueada } from '../../comun/kardex.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Almacen,
  Avio,
  Color,
  Empresa,
  PrismaClient,
  Proveedor,
  Tela,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { autorizarOC, cancelarOC, crearOC } from './ordenes-compra.js';
import { listarRecepcionesDeOC, recibirCompra, reversarRecepcion } from './recepciones.js';

/**
 * Integración del dominio de RECEPCIÓN de compras (F4-E3) contra Postgres efímero (testcontainers).
 * Cubre lo que SOLO la base valida (NO corre en local — usa Docker; lo corre el CI):
 *  • Atomicidad (A2): si falla la creación del lote/movimiento NO queda recepción ni movimiento.
 *  • Recepciones parciales acumuladas: dos recepciones suman; estatus parcial→total (R7).
 *  • Existencia = Σ movimientos (D3) tras recibir, y valuación cuadra (cantidad×costo == importe OC).
 *  • OUTBOX: la fila se escribe en la MISMA transacción (existe tras commit; NO si hace rollback).
 *  • Reverso: la existencia baja vía inverso visible en kardex; nada se borra (D3).
 *  • Regla (b): recibir contra una OC no autorizada → error.
 *  • Conversión de avío (R1): cantidad × factor / costo ÷ factor.
 *
 * La cola pg-boss se deja INACTIVA en tests (`EVENTOS_COLA_ACTIVA=false` por env del CI): lo
 * testeable aquí es la ESCRITURA atómica del outbox, no el transporte (ADR-0011).
 */

let cliente: PrismaClient;
let empresa: Empresa;
let proveedor: Proveedor;
let telaFelpa: Tela;
let telaCardigan: Tela;
let avioBoton: Avio;
let colorRojo: Color;
let almacen: Almacen;

const PERM: ClavePermiso[] = ['compras.ver', 'compras.administrar', 'compras.recibir'];
const PERM_AUTORIZAR: ClavePermiso[] = ['compras.ver', 'compras.autorizar'];
const PERM_CANCELAR: ClavePermiso[] = ['compras.ver', 'compras.cancelar'];

function sesion(permisos: ClavePermiso[], idEmpresaActiva = empresa.id): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva, permisos });
}

const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  proveedor = await cliente.proveedor.create({ data: { nombre: 'Textiles del Norte' } });
  telaFelpa = await cliente.tela.create({ data: { nombre: 'Felpa' } });
  telaCardigan = await cliente.tela.create({ data: { nombre: 'Cardigan' } });
  avioBoton = await cliente.avio.create({ data: { clave: 'BOT-01', descripcion: 'Botón' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  almacen = await cliente.almacen.create({ data: { nombre: 'Bodega', tipo: 'TELA' } });
  // Tipos de movimiento que el dominio de recepción resuelve por código.
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'entrada-recepcion', nombre: 'Entrada por Recepción', direccion: 'entrada' },
      { codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', direccion: 'salida' },
    ],
  });
});

/** Crea una OC autorizada con una línea de tela (felpa). Devuelve la OC. */
async function ocTelaAutorizada(cantidad = 750, precio = 10) {
  const oc = await crearOC(
    sesion(PERM),
    {
      idProveedor: proveedor.id,
      lineas: [{ idTela: telaFelpa.id, cantidad, precio, unidad: 'm' }],
    },
    bd(),
  );
  await autorizarOC(sesion(PERM_AUTORIZAR), oc.id, bd());
  return oc;
}

/** Existencia de una tela/lote en el almacén, leyendo la BD directa (Σ movimientos, D3). */
async function existenciaTela(idTela: number, idLote: number): Promise<number> {
  return cliente.$transaction((tx) =>
    existenciaTelaBloqueada(tx, empresa.id, almacen.id, idTela, idLote),
  );
}

/** Existencia de un avío en el almacén (Σ movimientos, D3). */
async function existenciaAvio(idAvio: number): Promise<number> {
  return cliente.$transaction((tx) => existenciaAvioBloqueada(tx, empresa.id, almacen.id, idAvio));
}

describe('Recepción (F4-E3) — regla (b): solo OC autorizada/recibida_parcial', () => {
  it('recibir contra una OC en borrador (no autorizada) → ErrorConflicto', async () => {
    const oc = await crearOC(
      sesion(PERM),
      { idProveedor: proveedor.id, lineas: [{ idTela: telaFelpa.id, cantidad: 100, precio: 5 }] },
      bd(),
    );
    const idLineaOC = oc.lineas[0]!.id;
    await expect(
      recibirCompra(
        sesion(PERM),
        {
          idOrdenCompra: oc.id,
          idAlmacen: almacen.id,
          fecha: '2026-06-20',
          lineas: [
            {
              idOrdenCompraLinea: idLineaOC,
              cantidad: 100,
              lote: {
                idColor: colorRojo.id,
                componentes: [{ idTela: telaFelpa.id, cantidad: 100 }],
              },
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('Recepción (F4-E3) — entrada de tela: existencia = Σ movimientos + valuación (D3, D1)', () => {
  it('recibe total: crea lote, mueve kardex y deja existencia = lo recibido; estatus total', async () => {
    const oc = await ocTelaAutorizada(750, 10);
    const idLineaOC = oc.lineas[0]!.id;

    const rec = await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        factura: 'F-555',
        fecha: '2026-06-20',
        lineas: [
          {
            idOrdenCompraLinea: idLineaOC,
            cantidad: 750,
            lote: {
              idColor: colorRojo.id,
              componentes: [
                { idTela: telaFelpa.id, cantidad: 750 },
                { idTela: telaCardigan.id, cantidad: 750 }, // acompañante mismo lote (D5)
              ],
            },
          },
        ],
      },
      bd(),
    );

    const linea = rec.lineas[0]!;
    expect(linea.tipo).toBe('tela');
    expect(linea.idLote).not.toBeNull();
    expect(linea.idMovimiento).not.toBeNull();
    expect(linea.cantidadRecibida).toBe(750);
    expect(linea.costoUnit).toBe(10); // factor 1 para tela

    // Existencia = Σ movimientos (D3): la felpa quedó con 750 en el almacén.
    expect(await existenciaTela(telaFelpa.id, linea.idLote!)).toBe(750);
    // El acompañante del lote también entró (D5).
    expect(await existenciaTela(telaCardigan.id, linea.idLote!)).toBe(750);

    // Valuación cuadra: cantidad × costo == cantidad × precio de la línea de OC (importe 7500).
    expect(linea.cantidadRecibida * linea.costoUnit!).toBe(750 * 10);

    // M2: solo la TELA COMPRADA (felpa) lleva el costo de la línea; el ACOMPAÑANTE (cardigan)
    // entra con costoUnit NULL (no se infla la valuación cobrando el acompañante).
    const dets = await cliente.movimientoDetTela.findMany({
      where: { idMovimiento: linea.idMovimiento! },
      orderBy: { idTela: 'asc' },
    });
    const detFelpa = dets.find((d) => d.idTela === telaFelpa.id)!;
    const detCardigan = dets.find((d) => d.idTela === telaCardigan.id)!;
    expect(Number(detFelpa.costoUnit)).toBe(10);
    expect(detCardigan.costoUnit).toBeNull();

    // Estatus de la OC → recibida_total (R7).
    const ocBd = await cliente.ordenCompra.findUnique({ where: { id: oc.id } });
    expect(ocBd?.estatus).toBe('recibida_total');
  });
});

describe('Recepción (F4-E3) — parciales acumuladas: estatus parcial → total (R7)', () => {
  it('dos recepciones suman y el estatus pasa de parcial a total', async () => {
    const oc = await ocTelaAutorizada(1000, 4);
    const idLineaOC = oc.lineas[0]!.id;

    // Primera recepción: 400 de 1000 → parcial.
    await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [
          {
            idOrdenCompraLinea: idLineaOC,
            cantidad: 400,
            lote: { idColor: colorRojo.id, componentes: [{ idTela: telaFelpa.id, cantidad: 400 }] },
          },
        ],
      },
      bd(),
    );
    let ocBd = await cliente.ordenCompra.findUnique({ where: { id: oc.id } });
    expect(ocBd?.estatus).toBe('recibida_parcial');

    // Segunda recepción: 600 más → completa (1000) → total.
    await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        lineas: [
          {
            idOrdenCompraLinea: idLineaOC,
            cantidad: 600,
            lote: { idColor: colorRojo.id, componentes: [{ idTela: telaFelpa.id, cantidad: 600 }] },
          },
        ],
      },
      bd(),
    );
    ocBd = await cliente.ordenCompra.findUnique({ where: { id: oc.id } });
    expect(ocBd?.estatus).toBe('recibida_total');

    // Dos recepciones en el historial.
    const lista = await listarRecepcionesDeOC(sesion(PERM), oc.id, bd());
    expect(lista.recepciones).toHaveLength(2);
  });
});

describe('Recepción (F4-E3) — avío con conversión (R1)', () => {
  it('15 cajas × factor 144 → 2160 pzas; costo ÷ factor; existencia = Σ', async () => {
    // Avío con factor por proveedor (caja de 144). Precio por caja $288 → $2/pza.
    await cliente.avioProveedor.create({
      data: { idAvio: avioBoton.id, idProveedor: proveedor.id, precio: 288, factorConversion: 144 },
    });
    const oc = await crearOC(
      sesion(PERM),
      {
        idProveedor: proveedor.id,
        lineas: [
          {
            idAvio: avioBoton.id,
            idAvioProveedor: avioBoton.id,
            cantidad: 15,
            precio: 288,
            unidad: 'caja',
          },
        ],
      },
      bd(),
    );
    await autorizarOC(sesion(PERM_AUTORIZAR), oc.id, bd());
    const idLineaOC = oc.lineas[0]!.id;

    const rec = await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [{ idOrdenCompraLinea: idLineaOC, cantidad: 15 }],
      },
      bd(),
    );
    const linea = rec.lineas[0]!;
    expect(linea.tipo).toBe('avio');
    expect(linea.idLote).toBeNull();
    expect(linea.cantidadRecibida).toBe(2160); // 15 × 144
    expect(linea.costoUnit).toBe(2); // 288 ÷ 144
    // Importe cuadra (15 × 288 = 4320 == 2160 × 2).
    expect(linea.cantidadRecibida * linea.costoUnit!).toBe(15 * 288);
    // Existencia del avío = Σ movimientos.
    expect(await existenciaAvio(avioBoton.id)).toBe(2160);
  });
});

describe('Recepción (F4-E3) — OUTBOX atómico (ADR-0011)', () => {
  it('la fila EventoOutbox existe tras un commit exitoso', async () => {
    const oc = await ocTelaAutorizada(100, 1);
    const idLineaOC = oc.lineas[0]!.id;
    const rec = await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [
          {
            idOrdenCompraLinea: idLineaOC,
            cantidad: 100,
            lote: { idColor: colorRojo.id, componentes: [{ idTela: telaFelpa.id, cantidad: 100 }] },
          },
        ],
      },
      bd(),
    );
    const eventos = await cliente.eventoOutbox.findMany({
      where: { idEmpresa: empresa.id, tipo: 'material-recibido' },
    });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.publicadoEn).toBeNull(); // pendiente (cola inactiva en tests)
    const payload = eventos[0]?.payload as { idRecepcion: number; idOrdenCompra: number };
    expect(payload.idRecepcion).toBe(rec.id);
    expect(payload.idOrdenCompra).toBe(oc.id);
  });

  it('si la transacción hace ROLLBACK, NO queda recepción ni outbox ni movimiento (A2)', async () => {
    const oc = await ocTelaAutorizada(100, 1);
    const idLineaOC = oc.lineas[0]!.id;

    // Falla provocada: el lote NO incluye la tela comprada → ErrorValidacion DESPUÉS de haber
    // creado el encabezado de la recepción dentro de la tx → debe revertirse TODO.
    await expect(
      recibirCompra(
        sesion(PERM),
        {
          idOrdenCompra: oc.id,
          idAlmacen: almacen.id,
          fecha: '2026-06-20',
          lineas: [
            {
              idOrdenCompraLinea: idLineaOC,
              cantidad: 100,
              // lote SIN la tela felpa (solo cardigan) → el dominio lo rechaza.
              lote: {
                idColor: colorRojo.id,
                componentes: [{ idTela: telaCardigan.id, cantidad: 100 }],
              },
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    // Nada quedó: ni recepción, ni outbox, ni movimiento de kardex, ni cambió el estatus.
    expect(await cliente.recepcionCompra.count({ where: { idOrdenCompra: oc.id } })).toBe(0);
    expect(await cliente.eventoOutbox.count({ where: { idEmpresa: empresa.id } })).toBe(0);
    expect(await cliente.movimiento.count({ where: { idEmpresa: empresa.id } })).toBe(0);
    const ocBd = await cliente.ordenCompra.findUnique({ where: { id: oc.id } });
    expect(ocBd?.estatus).toBe('autorizada');
  });
});

describe('Recepción (F4-E3) — reverso (D3): inverso visible, nada se borra', () => {
  it('reversa la recepción: existencia vuelve a 0 vía inverso, recepción marcada (no borrada)', async () => {
    const oc = await ocTelaAutorizada(500, 3);
    const idLineaOC = oc.lineas[0]!.id;
    const rec = await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [
          {
            idOrdenCompraLinea: idLineaOC,
            cantidad: 500,
            lote: { idColor: colorRojo.id, componentes: [{ idTela: telaFelpa.id, cantidad: 500 }] },
          },
        ],
      },
      bd(),
    );
    const idLote = rec.lineas[0]!.idLote!;
    expect(await existenciaTela(telaFelpa.id, idLote)).toBe(500);

    const reversada = await reversarRecepcion(
      sesion(PERM),
      rec.id,
      { motivo: 'llegó dañada' },
      bd(),
    );
    expect(reversada.reversada).toBe(true);
    expect(reversada.motivoReverso).toBe('llegó dañada');

    // Existencia de nuevo en 0 (entrada + su inverso = 0), pero los DOS movimientos siguen (D3).
    expect(await existenciaTela(telaFelpa.id, idLote)).toBe(0);
    expect(await cliente.movimiento.count({ where: { idEmpresa: empresa.id } })).toBe(2);

    // La recepción NO se borró (reverso suave).
    expect(await cliente.recepcionCompra.count({ where: { id: rec.id } })).toBe(1);

    // El estatus de la OC volvió a autorizada (ya no cuenta el material reversado, R7).
    const ocBd = await cliente.ordenCompra.findUnique({ where: { id: oc.id } });
    expect(ocBd?.estatus).toBe('autorizada');

    // No se puede reversar dos veces.
    await expect(
      reversarRecepcion(sesion(PERM), rec.id, { motivo: 'otra vez' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('destraba la cancelación de la OC: con recepción activa NO se cancela; reversada SÍ', async () => {
    const oc = await ocTelaAutorizada(200, 2);
    const idLineaOC = oc.lineas[0]!.id;
    const rec = await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [
          {
            idOrdenCompraLinea: idLineaOC,
            cantidad: 200,
            lote: { idColor: colorRojo.id, componentes: [{ idTela: telaFelpa.id, cantidad: 200 }] },
          },
        ],
      },
      bd(),
    );

    // Con la recepción ACTIVA, la OC no se puede cancelar.
    await expect(
      cancelarOC(sesion(PERM_CANCELAR), oc.id, { motivo: 'ya no' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Tras reversar, sí se cancela.
    await reversarRecepcion(sesion(PERM), rec.id, { motivo: 'devuelta' }, bd());
    const cancelada = await cancelarOC(sesion(PERM_CANCELAR), oc.id, { motivo: 'ya no' }, bd());
    expect(cancelada.estatus).toBe('cancelada');
  });
});

describe('Recepción (F4-E3) — línea LIBRE no inventaría', () => {
  it('una línea libre se registra sin lote ni movimiento de kardex', async () => {
    const oc = await crearOC(
      sesion(PERM),
      {
        idProveedor: proveedor.id,
        lineas: [{ descripcionLibre: 'Flete', cantidad: 1, precio: 300 }],
      },
      bd(),
    );
    await autorizarOC(sesion(PERM_AUTORIZAR), oc.id, bd());
    const idLineaOC = oc.lineas[0]!.id;
    const rec = await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [{ idOrdenCompraLinea: idLineaOC, cantidad: 1 }],
      },
      bd(),
    );
    const linea = rec.lineas[0]!;
    expect(linea.tipo).toBe('libre');
    expect(linea.idLote).toBeNull();
    expect(linea.idMovimiento).toBeNull();
    // No movió kardex.
    expect(await cliente.movimiento.count({ where: { idEmpresa: empresa.id } })).toBe(0);
  });

  it('recibir contra una OC inexistente → ErrorNoEncontrado', async () => {
    await expect(
      recibirCompra(
        sesion(PERM),
        {
          idOrdenCompra: 999999,
          idAlmacen: almacen.id,
          fecha: '2026-06-20',
          lineas: [{ idOrdenCompraLinea: 1, cantidad: 1 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

describe('Recepción (F4-E3) — B1: el almacén destino se valida por empresa (A9)', () => {
  it('recibir hacia el almacén PRIVADO de OTRA empresa → rechazado (no fuga cross-empresa)', async () => {
    const otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa');
    // Almacén PRIVADO de la otra empresa (idEmpresa != la empresa de la sesión).
    const almacenAjeno = await cliente.almacen.create({
      data: { nombre: 'Bodega ajena', tipo: 'TELA', idEmpresa: otraEmpresa.id },
    });
    const oc = await ocTelaAutorizada(100, 1);
    const idLineaOC = oc.lineas[0]!.id;

    await expect(
      recibirCompra(
        sesion(PERM), // sesión en `empresa`, NO en `otraEmpresa`
        {
          idOrdenCompra: oc.id,
          idAlmacen: almacenAjeno.id,
          fecha: '2026-06-20',
          lineas: [
            {
              idOrdenCompraLinea: idLineaOC,
              cantidad: 100,
              lote: {
                idColor: colorRojo.id,
                componentes: [{ idTela: telaFelpa.id, cantidad: 100 }],
              },
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    // Nada se escribió (la validación ocurre ANTES de cualquier write).
    expect(await cliente.recepcionCompra.count({ where: { idOrdenCompra: oc.id } })).toBe(0);
    expect(await cliente.movimiento.count()).toBe(0);
  });

  it('almacén desactivado → rechazado', async () => {
    const almacenInactivo = await cliente.almacen.create({
      data: { nombre: 'Bodega vieja', tipo: 'TELA', activo: false },
    });
    const oc = await ocTelaAutorizada(50, 1);
    const idLineaOC = oc.lineas[0]!.id;
    await expect(
      recibirCompra(
        sesion(PERM),
        {
          idOrdenCompra: oc.id,
          idAlmacen: almacenInactivo.id,
          fecha: '2026-06-20',
          lineas: [
            {
              idOrdenCompraLinea: idLineaOC,
              cantidad: 50,
              lote: {
                idColor: colorRojo.id,
                componentes: [{ idTela: telaFelpa.id, cantidad: 50 }],
              },
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe('Recepción (F4-E3) — B2: recepciones concurrentes de la misma OC (estatus correcto)', () => {
  it('dos recepciones EN PARALELO que entre ambas completan la OC → recibida_total (sin carrera)', async () => {
    const oc = await ocTelaAutorizada(1000, 2);
    const idLineaOC = oc.lineas[0]!.id;

    const recepcion = (cantidad: number, fecha: string) =>
      recibirCompra(
        sesion(PERM),
        {
          idOrdenCompra: oc.id,
          idAlmacen: almacen.id,
          fecha,
          lineas: [
            {
              idOrdenCompraLinea: idLineaOC,
              cantidad,
              lote: {
                idColor: colorRojo.id,
                componentes: [{ idTela: telaFelpa.id, cantidad }],
              },
            },
          ],
        },
        bd(),
      );

    // 500 + 500 = 1000 (el total) EN PARALELO. Sin el lock de B2, ambas verían solo su propio
    // INSERT y calcularían "parcial" → la OC quedaría parcial pese a estar completa. Con el lock,
    // la 2ª espera a la 1ª y su groupBy ve la suma real → recibida_total.
    await Promise.all([recepcion(500, '2026-06-20'), recepcion(500, '2026-06-21')]);

    const ocBd = await cliente.ordenCompra.findUnique({ where: { id: oc.id } });
    expect(ocBd?.estatus).toBe('recibida_total');

    // Las dos recepciones existen y la existencia total = 1000 (Σ movimientos, D3).
    const recs = await listarRecepcionesDeOC(sesion(PERM), oc.id, bd());
    expect(recs.recepciones).toHaveLength(2);
    const lotes = recs.recepciones.map((r) => r.lineas[0]!.idLote!);
    const total = (await Promise.all(lotes.map((l) => existenciaTela(telaFelpa.id, l)))).reduce(
      (s, n) => s + n,
      0,
    );
    expect(total).toBe(1000);
  });
});
