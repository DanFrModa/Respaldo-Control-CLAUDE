import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { existenciaAvioBloqueada, existenciaTelaColorBloqueada } from '../../comun/kardex.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Almacen,
  Avio,
  Empresa,
  PrismaClient,
  Proveedor,
  Tela,
  TelaColor,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { autorizarOC, cancelarOC, crearOC, resumenOC } from './ordenes-compra.js';
import {
  lineasPendientesDeOC,
  listarRecepcionesDeOC,
  ocsRecibibles,
  recibirCompra,
  reversarRecepcion,
} from './recepciones.js';

/**
 * Integración del dominio de RECEPCIÓN de compras (F4-E3) contra Postgres efímero (testcontainers).
 * Cubre lo que SOLO la base valida (NO corre en local — usa Docker; lo corre el CI):
 *  • Atomicidad (A2): si falla la partida/movimiento NO queda recepción ni movimiento.
 *  • Recepciones parciales acumuladas: dos recepciones suman; estatus parcial→total (R7).
 *  • Existencia = Σ movimientos (D3) tras recibir, y valuación cuadra (cantidad×costo == importe OC).
 *  • OUTBOX: la fila se escribe en la MISMA transacción (existe tras commit; NO si hace rollback).
 *  • Reverso: la existencia baja vía inverso visible en kardex; nada se borra (D3).
 *  • Regla (b): recibir contra una OC no autorizada → error.
 *  • §Post-F9.97: la línea de OC va en unidad de consumo y se recibe TAL CUAL — ni siquiera
 *    con las columnas muertas del factor de conversión cebadas a mano.
 *  • B1 — la TELA entra por COLOR/PARTIDA: la recepción crea la partida, el kardex se mueve por
 *    tela×color (cuerpo + complemento juntos) y el reverso lo neutraliza por color.
 *
 * La cola pg-boss se deja INACTIVA en tests (`EVENTOS_COLA_ACTIVA=false` por env del CI): lo
 * testeable aquí es la ESCRITURA atómica del outbox, no el transporte (ADR-0011).
 */

let cliente: PrismaClient;
let empresa: Empresa;
let proveedor: Proveedor;
let telaFelpa: Tela;
let avioBoton: Avio;
let colorFelpaRojo: TelaColor;
let almacen: Almacen;
let direccionEntrega: { id: number };

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
  // La tela LLEVA complemento (cardigan): B1 mete cuerpo y complemento en el MISMO renglón.
  telaFelpa = await cliente.tela.create({
    data: { nombre: 'Felpa', nombreCuerpo: 'Felpa', nombreComplemento: 'Cardigan' },
  });
  colorFelpaRojo = await cliente.telaColor.create({
    data: { idTela: telaFelpa.id, nombre: 'Rojo' },
  });
  avioBoton = await cliente.avio.create({ data: { clave: 'BOT-01', descripcion: 'Botón' } });
  almacen = await cliente.almacen.create({ data: { nombre: 'Bodega', tipo: 'TELA' } });
  // §Post-F9.18: toda OC nueva exige dirección de entrega del catálogo.
  direccionEntrega = await cliente.direccionEntrega.create({
    data: { nombre: 'Bodega', direccion: 'Av. Siempre Viva 123', favorita: true },
  });
  // Tipos de movimiento que el dominio de recepción resuelve por código.
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'entrada-recepcion', nombre: 'Entrada por Recepción', direccion: 'entrada' },
      { codigo: 'ajuste-salida', nombre: 'Ajuste (Salida)', direccion: 'salida' },
    ],
  });
});

/**
 * Encabezado mínimo que TODA OC nueva exige desde §Post-F9.18 (fecha de entrega + dirección del
 * catálogo). La fecha de EMISIÓN ya no se manda: la pone el servidor.
 */
function encabezadoOc(): { fechaEntrega: string; idDireccionEntrega: number } {
  return { fechaEntrega: '2026-09-30', idDireccionEntrega: direccionEntrega.id };
}

/** Crea una OC autorizada con una línea de tela (felpa). Devuelve la OC. */
async function ocTelaAutorizada(cantidad = 750, precio = 10) {
  const oc = await crearOC(
    sesion(PERM),
    {
      ...encabezadoOc(),
      idProveedor: proveedor.id,
      // La felpa lleva Cardigan: desde §Post-F9.18 el renglón exige su cantidad (misma unidad).
      lineas: [{ idTela: telaFelpa.id, cantidad, precio, unidad: 'm', cantidadComplemento: 10 }],
    },
    bd(),
  );
  await autorizarOC(sesion(PERM_AUTORIZAR), oc.id, bd());
  return oc;
}

/**
 * Crea una OC autorizada con una línea de AVÍO. Desde §Post-F9.14 es la vía que se recibe DESDE la
 * orden de compra: la tela se recibe capturando su factura (`entradas-tela`), no aquí.
 */
async function ocAvioAutorizada(cantidad = 750, precio = 10) {
  const oc = await crearOC(
    sesion(PERM),
    {
      ...encabezadoOc(),
      idProveedor: proveedor.id,
      lineas: [{ idAvio: avioBoton.id, cantidad, precio, unidad: 'pza' }],
    },
    bd(),
  );
  await autorizarOC(sesion(PERM_AUTORIZAR), oc.id, bd());
  return oc;
}

/**
 * Existencia (cuerpo + complemento) de un COLOR de tela en el almacén, leyendo la BD directa
 * (Σ movimientos, D3 — nunca la vista).
 */
async function existenciaColor(
  idTelaColor: number,
): Promise<{ cuerpo: number; complemento: number }> {
  return cliente.$transaction((tx) =>
    existenciaTelaColorBloqueada(tx, empresa.id, almacen.id, idTelaColor),
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
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idAvio: avioBoton.id, cantidad: 100, precio: 5 }],
      },
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
          lineas: [{ idOrdenCompraLinea: idLineaOC, cantidad: 100 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('Recepción — §Post-F9.14: la TELA ya no se recibe desde la orden de compra', () => {
  it('un renglón de tela se RECHAZA y el mensaje apunta a la factura', async () => {
    const oc = await ocTelaAutorizada(750, 10);
    const idLineaOC = oc.lineas[0]!.id;

    // Decisión de Daniel (7-ago-2026): una sola puerta para la tela. Si esta siguiera viva, la
    // misma tela podría recibirse dos veces (una por cada camino) e inflar el inventario.
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
              cantidad: 750,
              telaColor: { idTelaColor: colorFelpaRojo.id },
            },
          ],
        },
        bd(),
      ),
    ).rejects.toThrow(/factura o remisión/);

    // Y NADA se escribió: ni recepción, ni partida, ni existencia (A2).
    expect(await cliente.recepcionCompra.count({ where: { idOrdenCompra: oc.id } })).toBe(0);
    expect(await cliente.partidaTela.count()).toBe(0);
    expect(await existenciaColor(colorFelpaRojo.id)).toEqual({ cuerpo: 0, complemento: 0 });
    const ocBd = await cliente.ordenCompra.findUnique({ where: { id: oc.id } });
    expect(ocBd?.estatus).toBe('autorizada');
  });

  it('el renglón se rechaza AUNQUE no se mande color (no es un problema de captura)', async () => {
    const oc = await ocTelaAutorizada(100, 1);
    await expect(
      recibirCompra(
        sesion(PERM),
        {
          idOrdenCompra: oc.id,
          idAlmacen: almacen.id,
          fecha: '2026-06-20',
          lineas: [{ idOrdenCompraLinea: oc.lineas[0]!.id, cantidad: 100 }],
        },
        bd(),
      ),
    ).rejects.toThrow(/factura o remisión/);
  });
});

describe('Recepción (F4-E3) — parciales acumuladas: estatus parcial → total (R7)', () => {
  it('dos recepciones suman y el estatus pasa de parcial a total', async () => {
    const oc = await ocAvioAutorizada(1000, 4);
    const idLineaOC = oc.lineas[0]!.id;

    // Primera recepción: 400 de 1000 → parcial.
    await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [{ idOrdenCompraLinea: idLineaOC, cantidad: 400 }],
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
        lineas: [{ idOrdenCompraLinea: idLineaOC, cantidad: 600 }],
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

describe('Recepción (F4-E3) — la línea de OC se recibe en unidad de consumo (§Post-F9.97)', () => {
  /**
   * ⭐⭐ LA REGLA, y la prueba que impide que la dualidad vuelva. La línea de OC va SIEMPRE en
   * unidad de consumo (pza), así que se recibe TAL CUAL: 2,160 pzas a $2 c/u.
   *
   * Las columnas MUERTAS del factor de conversión se ceban a propósito con 144 —por escritura
   * directa, el único camino que existe: el contrato nunca las expuso—. Si alguien volviera a
   * leerlas al recibir, esto entraría al kardex como 2,160 × 144 = 311,040 pzas a $0.0139 c/u:
   * el importe total seguiría cuadrando en $4,320 (por eso el defecto vivió tanto) pero el
   * inventario quedaría inflado 144 veces. La aserción que lo caza es la de la EXISTENCIA, no la
   * del importe.
   */
  it('recibe la cantidad y el costo tal cual, ignorando las columnas muertas del factor', async () => {
    await cliente.avioProveedor.create({
      data: { idAvio: avioBoton.id, idProveedor: proveedor.id, precio: 2, factorConversion: 144 },
    });
    const oc = await crearOC(
      sesion(PERM),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [
          {
            idAvio: avioBoton.id,
            idAvioProveedor: avioBoton.id,
            cantidad: 2160,
            precio: 2,
            unidad: 'pza',
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
        lineas: [{ idOrdenCompraLinea: idLineaOC, cantidad: 2160 }],
      },
      bd(),
    );
    const linea = rec.lineas[0]!;
    expect(linea.tipo).toBe('avio');
    expect(linea.idLote).toBeNull();
    expect(linea.cantidadRecibida).toBe(2160);
    expect(linea.costoUnit).toBe(2);
    expect(linea.cantidadRecibida * linea.costoUnit!).toBe(4320);
    // 🔴 LA aserción de esta prueba: la existencia NO se infló por el factor cebado.
    expect(await existenciaAvio(avioBoton.id)).toBe(2160);
  });
});

describe('Recepción (F4-E3) — OUTBOX atómico (ADR-0011)', () => {
  it('la fila EventoOutbox existe tras un commit exitoso', async () => {
    const oc = await ocAvioAutorizada(100, 1);
    const idLineaOC = oc.lineas[0]!.id;
    const rec = await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [{ idOrdenCompraLinea: idLineaOC, cantidad: 100 }],
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
    const oc = await ocAvioAutorizada(100, 1);
    const idLineaOC = oc.lineas[0]!.id;

    // Falla provocada: el COLOR no existe → ErrorNoEncontrado DESPUÉS de haber creado el
    // encabezado de la recepción dentro de la tx → debe revertirse TODO.
    await expect(
      recibirCompra(
        sesion(PERM),
        {
          idOrdenCompra: oc.id,
          idAlmacen: almacen.id,
          fecha: '2026-06-20',
          lineas: [
            { idOrdenCompraLinea: idLineaOC, cantidad: 100 },
            // Renglón inexistente: revienta DESPUÉS de que el primero ya escribió → rollback.
            { idOrdenCompraLinea: 999999, cantidad: 1 },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);

    // Nada quedó: ni recepción, ni outbox, ni movimiento, ni partida, ni cambió el estatus.
    expect(await cliente.recepcionCompra.count({ where: { idOrdenCompra: oc.id } })).toBe(0);
    expect(await cliente.eventoOutbox.count({ where: { idEmpresa: empresa.id } })).toBe(0);
    expect(await cliente.movimiento.count({ where: { idEmpresa: empresa.id } })).toBe(0);
    expect(await cliente.partidaTela.count()).toBe(0);
    const ocBd = await cliente.ordenCompra.findUnique({ where: { id: oc.id } });
    expect(ocBd?.estatus).toBe('autorizada');
  });
});

describe('Recepción (F4-E3) — reverso (D3): inverso visible, nada se borra', () => {
  it('reversa la recepción: existencia vuelve a 0 vía inverso, recepción marcada (no borrada)', async () => {
    const oc = await ocAvioAutorizada(500, 3);
    const idLineaOC = oc.lineas[0]!.id;
    const rec = await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [{ idOrdenCompraLinea: idLineaOC, cantidad: 500 }],
      },
      bd(),
    );
    expect(await existenciaAvio(avioBoton.id)).toBe(500);

    const reversada = await reversarRecepcion(
      sesion(PERM),
      rec.id,
      { motivo: 'llegó dañada' },
      bd(),
    );
    expect(reversada.reversada).toBe(true);
    expect(reversada.motivoReverso).toBe('llegó dañada');

    // Existencia de nuevo en 0 (entrada + su inverso se neutralizan), pero los DOS movimientos
    // siguen existiendo (D3): nada se borra.
    expect(await existenciaAvio(avioBoton.id)).toBe(0);
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
    const oc = await ocAvioAutorizada(200, 2);
    const idLineaOC = oc.lineas[0]!.id;
    const rec = await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [{ idOrdenCompraLinea: idLineaOC, cantidad: 200 }],
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

describe('Resumen de cabecera (R9) — OC abiertas + $ por recibir', () => {
  /** Recibe una cantidad de AVÍO contra una línea de OC (helper local). */
  async function recibir(idOc: number, idLineaOC: number, cantidad: number, fecha: string) {
    await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: idOc,
        idAlmacen: almacen.id,
        fecha,
        lineas: [{ idOrdenCompraLinea: idLineaOC, cantidad }],
      },
      bd(),
    );
  }

  it('cuenta las abiertas y suma (cantidad − recibido) × precio (criterio de recepciones)', async () => {
    // A: autorizada, 100 @ 5, nada recibido → pendiente 500.
    await ocAvioAutorizada(100, 5);
    // B: autorizada, 200 @ 3, recibe 50 → parcial; pendiente 150 × 3 = 450.
    const ocB = await ocAvioAutorizada(200, 3);
    await recibir(ocB.id, ocB.lineas[0]!.id, 50, '2026-06-20');
    // C: borrador (NO autorizada) → no entra en el resumen.
    await crearOC(
      sesion(PERM),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idTela: telaFelpa.id, cantidad: 999, precio: 9, cantidadComplemento: 1 }],
      },
      bd(),
    );

    const resumen = await resumenOC(sesion(PERM), {}, bd());
    expect(resumen.ocAbiertas).toBe(2); // autorizada + recibida_parcial
    expect(resumen.porRecibir).toBe(950); // 500 + 450
  });

  it('una OC totalmente recibida deja de contar (sin pendiente)', async () => {
    const oc = await ocAvioAutorizada(100, 4);
    await recibir(oc.id, oc.lineas[0]!.id, 100, '2026-06-20'); // completa → recibida_total
    const resumen = await resumenOC(sesion(PERM), {}, bd());
    expect(resumen.ocAbiertas).toBe(0);
    expect(resumen.porRecibir).toBe(0);
  });

  it('el filtro por proveedor acota el universo del resumen', async () => {
    const otro = await cliente.proveedor.create({ data: { nombre: 'Otro Proveedor' } });
    await ocAvioAutorizada(100, 5); // proveedor base → pendiente 500
    // OC autorizada de OTRO proveedor: 10 @ 7 = 70 pendiente.
    const ocOtro = await crearOC(
      sesion(PERM),
      {
        ...encabezadoOc(),
        idProveedor: otro.id,
        lineas: [{ idTela: telaFelpa.id, cantidad: 10, precio: 7, cantidadComplemento: 1 }],
      },
      bd(),
    );
    await autorizarOC(sesion(PERM_AUTORIZAR), ocOtro.id, bd());

    // §Post-F9.19: el COMPLEMENTO que pidió la OC también es material por recibir, y se valúa al
    // precio del cuerpo cuando no trae propio → 10×7 (cuerpo) + 1×7 (Cardigan) = 77.
    const soloOtro = await resumenOC(sesion(PERM), { idProveedor: otro.id }, bd());
    expect(soloOtro.ocAbiertas).toBe(1);
    expect(soloOtro.porRecibir).toBe(77);

    const todas = await resumenOC(sesion(PERM), {}, bd());
    expect(todas.ocAbiertas).toBe(2);
    expect(todas.porRecibir).toBe(577); // 500 del avío + 77 de la tela con su Cardigan
  });
});

describe('Recepción (F4-E3) — línea LIBRE no inventaría', () => {
  it('una línea libre se registra sin lote ni movimiento de kardex', async () => {
    const oc = await crearOC(
      sesion(PERM),
      {
        ...encabezadoOc(),
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
    const oc = await ocAvioAutorizada(100, 1);
    const idLineaOC = oc.lineas[0]!.id;

    await expect(
      recibirCompra(
        sesion(PERM), // sesión en `empresa`, NO en `otraEmpresa`
        {
          idOrdenCompra: oc.id,
          idAlmacen: almacenAjeno.id,
          fecha: '2026-06-20',
          lineas: [{ idOrdenCompraLinea: idLineaOC, cantidad: 100 }],
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
    const oc = await ocAvioAutorizada(50, 1);
    const idLineaOC = oc.lineas[0]!.id;
    await expect(
      recibirCompra(
        sesion(PERM),
        {
          idOrdenCompra: oc.id,
          idAlmacen: almacenInactivo.id,
          fecha: '2026-06-20',
          lineas: [{ idOrdenCompraLinea: idLineaOC, cantidad: 50 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe('Recepción (F4-E3) — B2: recepciones concurrentes de la misma OC (estatus correcto)', () => {
  it('dos recepciones EN PARALELO que entre ambas completan la OC → recibida_total (sin carrera)', async () => {
    const oc = await ocAvioAutorizada(1000, 2);
    const idLineaOC = oc.lineas[0]!.id;

    const recepcion = (cantidad: number, fecha: string) =>
      recibirCompra(
        sesion(PERM),
        {
          idOrdenCompra: oc.id,
          idAlmacen: almacen.id,
          fecha,
          lineas: [{ idOrdenCompraLinea: idLineaOC, cantidad }],
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
    expect(await existenciaAvio(avioBoton.id)).toBe(1000);
  });
});

describe('Recepción (§Post-F9.19) — en AVÍOS también se admite diferencia', () => {
  /** Recibe una cantidad contra el primer renglón de la OC (helper local de este bloque). */
  async function recibirAvio(idOc: number, idLineaOC: number, cantidad: number) {
    await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: idOc,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [{ idOrdenCompraLinea: idLineaOC, cantidad }],
      },
      bd(),
    );
  }

  it('171 de 180 piezas (−5%) YA cierra la orden; 170 la deja abierta', async () => {
    // Daniel: *"en avíos también puede haber una diferencia. Siempre debe de haber un campo para
    // definir lo que se recibe realmente"* — el campo existe (la cantidad se captura y NO se asume
    // igual a la pedida), y la diferencia dentro de la banda cierra la orden.
    const corta = await ocAvioAutorizada(180, 2);
    await recibirAvio(corta.id, corta.lineas[0]!.id, 170);
    expect((await cliente.ordenCompra.findUnique({ where: { id: corta.id } }))?.estatus).toBe(
      'recibida_parcial',
    );

    const enBanda = await ocAvioAutorizada(180, 2);
    await recibirAvio(enBanda.id, enBanda.lineas[0]!.id, 171);
    expect((await cliente.ordenCompra.findUnique({ where: { id: enBanda.id } }))?.estatus).toBe(
      'recibida_total',
    );
  });

  it('recibir MÁS de lo pedido también cierra (y no truena)', async () => {
    const oc = await ocAvioAutorizada(100, 2);
    await recibirAvio(oc.id, oc.lineas[0]!.id, 115);
    expect((await cliente.ordenCompra.findUnique({ where: { id: oc.id } }))?.estatus).toBe(
      'recibida_total',
    );
  });
});

describe('Recepción — pendiente por renglón (lo que precarga la captura)', () => {
  /**
   * El pendiente lo calcula el DOMINIO (A1). La pantalla de recepción precargaba lo PEDIDO
   * COMPLETO ignorando lo ya recibido, y como `recibirCompra` solo impide repetir un renglón
   * DENTRO de la misma recepción, recibir tres veces el 100 % pasaba en silencio.
   */
  it('descuenta lo ya recibido y llega a 0 (surtido) cuando la orden se completa', async () => {
    const oc = await ocAvioAutorizada(100, 2);
    const idLinea = oc.lineas[0]!.id;

    const [inicial] = await lineasPendientesDeOC(sesion(PERM), oc.id, bd());
    expect(inicial).toMatchObject({
      idOrdenCompraLinea: idLinea,
      tipo: 'avio',
      cantidad: 100,
      recibido: 0,
      pendiente: 100,
      surtido: false,
    });

    await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [{ idOrdenCompraLinea: idLinea, cantidad: 40 }],
      },
      bd(),
    );
    const [parcial] = await lineasPendientesDeOC(sesion(PERM), oc.id, bd());
    expect(parcial).toMatchObject({ recibido: 40, pendiente: 60, surtido: false });

    await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        lineas: [{ idOrdenCompraLinea: idLinea, cantidad: 60 }],
      },
      bd(),
    );
    const [completo] = await lineasPendientesDeOC(sesion(PERM), oc.id, bd());
    expect(completo).toMatchObject({ recibido: 100, pendiente: 0, surtido: true });
  });

  it('una recepción REVERSADA deja de contar (D3: el pendiente vuelve)', async () => {
    const oc = await ocAvioAutorizada(100, 2);
    const idLinea = oc.lineas[0]!.id;
    const recepcion = await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [{ idOrdenCompraLinea: idLinea, cantidad: 100 }],
      },
      bd(),
    );
    await reversarRecepcion(sesion(PERM), recepcion.id, { motivo: 'llegó equivocado' }, bd());

    const [tras] = await lineasPendientesDeOC(sesion(PERM), oc.id, bd());
    expect(tras).toMatchObject({ recibido: 0, pendiente: 100, surtido: false });
  });

  it('una OC de otra empresa (o inexistente) → ErrorNoEncontrado (A9)', async () => {
    await expect(lineasPendientesDeOC(sesion(PERM), 999_999, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );

    // Lo que A9 protege de verdad: la OC EXISTE, pero es de otra empresa → para esta sesión no
    // existe (ni siquiera se filtra a vacío: se niega).
    const oc = await ocAvioAutorizada(100, 2);
    const otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa');
    await expect(
      lineasPendientesDeOC(sesion(PERM, otraEmpresa.id), oc.id, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

/**
 * §Post-F9.87 — RECIBIR EMPIEZA POR EL PROVEEDOR. Daniel: *"en la realidad cuando vas a recibir
 * algo, buscas al proveedor que llegó a entregar"*. Lo que se prueba aquí es lo que la pantalla
 * NO puede decidir sola (A1): qué OC se ofrecen, de quién son, y —sobre todo— que la lista NO
 * esconda nada en silencio (el defecto vivo era un `<select>` topado a 100 que volvía
 * INALCANZABLES las OC de más abajo).
 */
describe('ocsRecibibles (§Post-F9.87) — las OC abiertas del proveedor que llegó', () => {
  /** Crea una OC AUTORIZADA de un proveedor dado, con una línea de avío. */
  async function ocAbiertaDe(idProveedor: number, cantidad = 100) {
    const oc = await crearOC(
      sesion(PERM),
      {
        ...encabezadoOc(),
        idProveedor,
        lineas: [{ idAvio: avioBoton.id, cantidad, precio: 5, unidad: 'pza' }],
      },
      bd(),
    );
    await autorizarOC(sesion(PERM_AUTORIZAR), oc.id, bd());
    return oc;
  }

  /** Crea una OC AUTORIZADA con VARIOS renglones de avío (uno por avío dado). */
  async function ocAbiertaConAvios(
    idProveedor: number,
    avios: { idAvio: number; cantidad: number }[],
  ) {
    const oc = await crearOC(
      sesion(PERM),
      {
        ...encabezadoOc(),
        idProveedor,
        lineas: avios.map((a) => ({
          idAvio: a.idAvio,
          cantidad: a.cantidad,
          precio: 5,
          unidad: 'pza',
        })),
      },
      bd(),
    );
    await autorizarOC(sesion(PERM_AUTORIZAR), oc.id, bd());
    return oc;
  }

  /** Da de alta un avío del catálogo (clave — descripción es lo que la fila muestra). */
  async function avio(clave: string, descripcion: string) {
    return cliente.avio.create({ data: { clave, descripcion } });
  }

  it('FILTRA por el proveedor elegido: no asoma ni una OC de otro proveedor', async () => {
    const otroProveedor = await cliente.proveedor.create({ data: { nombre: 'Avíos del Sur' } });
    const ocPropia = await ocAbiertaDe(proveedor.id);
    const ocAjena = await ocAbiertaDe(otroProveedor.id);

    const salida = await ocsRecibibles(sesion(PERM), { idProveedor: proveedor.id }, bd());

    // La aserción que importa: SOLO la del proveedor pedido. Si el filtro se ignorara, aquí
    // vendrían las dos (2 !== 1) y además aparecería `ocAjena`.
    expect(salida.datos.map((o) => o.id)).toEqual([ocPropia.id]);
    expect(salida.datos.every((o) => o.idProveedor === proveedor.id)).toBe(true);
    expect(salida.datos.some((o) => o.id === ocAjena.id)).toBe(false);
    expect(salida.total).toBe(1);
  });

  it('devuelve TODAS las OC abiertas del proveedor sin recortar, y lo declara (truncado=false)', async () => {
    const creadas = [await ocAbiertaDe(proveedor.id), await ocAbiertaDe(proveedor.id)];
    creadas.push(await ocAbiertaDe(proveedor.id));

    const salida = await ocsRecibibles(sesion(PERM), { idProveedor: proveedor.id }, bd());

    // El tope POR OMISIÓN no puede esconder ninguna de las tres. (Con el tope bajado a 1 o 2 esta
    // aserción se cae: `datos` traería menos ids que `creadas`.)
    expect(salida.datos).toHaveLength(creadas.length);
    expect(new Set(salida.datos.map((o) => o.id))).toEqual(new Set(creadas.map((c) => c.id)));
    expect(salida.total).toBe(creadas.length);
    expect(salida.truncado).toBe(false);
  });

  it('si SÍ se recorta, lo DICE: total real + truncado=true (nada de topes silenciosos)', async () => {
    await ocAbiertaDe(proveedor.id);
    await ocAbiertaDe(proveedor.id);
    await ocAbiertaDe(proveedor.id);

    const salida = await ocsRecibibles(
      sesion(PERM),
      { idProveedor: proveedor.id, limite: 2 },
      bd(),
    );

    expect(salida.datos).toHaveLength(2);
    // `total` NO es lo devuelto: es cuántas cumplen el filtro de verdad. Ahí está la honestidad.
    expect(salida.total).toBe(3);
    expect(salida.truncado).toBe(true);
    expect(salida.limite).toBe(2);
  });

  it('A9: una OC de OTRA empresa no se ofrece jamás', async () => {
    const oc = await ocAbiertaDe(proveedor.id);
    const otraEmpresa = await crearEmpresaPrueba(cliente, 'Empresa Ajena');

    const salida = await ocsRecibibles(
      sesion(PERM, otraEmpresa.id),
      { idProveedor: proveedor.id },
      bd(),
    );

    expect(salida.datos).toEqual([]);
    expect(salida.total).toBe(0);
    // Y desde la empresa dueña sí está (la prueba no pasa por estar todo vacío).
    const propia = await ocsRecibibles(sesion(PERM), { idProveedor: proveedor.id }, bd());
    expect(propia.datos.map((o) => o.id)).toEqual([oc.id]);
  });

  it('solo ofrece OC ABIERTAS: ni borrador, ni cancelada, ni recibida_total', async () => {
    const abierta = await ocAbiertaDe(proveedor.id);
    // Borrador: creada y NO autorizada.
    await crearOC(
      sesion(PERM),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idAvio: avioBoton.id, cantidad: 50, precio: 5, unidad: 'pza' }],
      },
      bd(),
    );
    // Cancelada: autorizada y luego cancelada.
    const paraCancelar = await ocAbiertaDe(proveedor.id);
    await cancelarOC(sesion(PERM_CANCELAR), paraCancelar.id, { motivo: 'Ya no' }, bd());
    // Recibida total: se recibe el 100 % de su único renglón.
    const paraRecibir = await ocAbiertaDe(proveedor.id, 100);
    await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: paraRecibir.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [{ idOrdenCompraLinea: paraRecibir.lineas[0]!.id, cantidad: 100 }],
      },
      bd(),
    );

    const salida = await ocsRecibibles(sesion(PERM), { idProveedor: proveedor.id }, bd());

    expect(salida.datos.map((o) => o.id)).toEqual([abierta.id]);
  });

  it('ATAJO por número: `numCompra` exacto trae esa OC sin pasar por el proveedor', async () => {
    const primera = await ocAbiertaDe(proveedor.id);
    const segunda = await ocAbiertaDe(proveedor.id);

    const salida = await ocsRecibibles(sesion(PERM), { numCompra: segunda.numCompra }, bd());

    expect(salida.datos.map((o) => o.numCompra)).toEqual([segunda.numCompra]);
    expect(salida.datos.some((o) => o.id === primera.id)).toBe(false);
  });

  it('dice QUÉ TRAE PENDIENTE: el material por nombre, y deja de contarlo al recibirlo', async () => {
    // DOS renglones: así el renglón que se surte puede DEJAR de contarse sin que la OC se cierre
    // (con uno solo la OC pasaría a recibida_total y desaparecería de la lista, y la segunda mitad
    // del nombre de esta prueba se quedaría sin afirmar — que es como estaba).
    const avio2 = await avio('AV-02', 'Avio 2');
    const oc = await ocAbiertaConAvios(proveedor.id, [
      { idAvio: avioBoton.id, cantidad: 100 },
      { idAvio: avio2.id, cantidad: 100 },
    ]);

    const antes = await ocsRecibibles(sesion(PERM), { idProveedor: proveedor.id }, bd());
    const filaAntes = antes.datos[0]!;
    expect(filaAntes.renglones).toBe(2);
    expect(filaAntes.renglonesPendientes).toBe(2);
    // El nombre sale del catálogo del avío (clave — descripción), no de un texto inventado.
    expect(filaAntes.materialesPendientes).toEqual(['BOT-01 — Botón', 'AV-02 — Avio 2']);
    expect(filaAntes.materialesPendientesMas).toBe(0);
    expect(filaAntes.estatus).toBe('autorizada');

    // Recepción PARCIAL del primer renglón: 40 de 100 NO lo surte, así que sigue contándose.
    await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [{ idOrdenCompraLinea: oc.lineas[0]!.id, cantidad: 40 }],
      },
      bd(),
    );

    const aMedias = await ocsRecibibles(sesion(PERM), { idProveedor: proveedor.id }, bd());
    const filaAMedias = aMedias.datos[0]!;
    expect(filaAMedias.id).toBe(oc.id);
    expect(filaAMedias.estatus).toBe('recibida_parcial');
    expect(filaAMedias.renglonesPendientes).toBe(2);
    expect(filaAMedias.materialesPendientes).toEqual(['BOT-01 — Botón', 'AV-02 — Avio 2']);

    // Y ahora SÍ: llega el resto del primer renglón (60 más = 100 de 100) y DEJA de contarse.
    await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-21',
        lineas: [{ idOrdenCompraLinea: oc.lineas[0]!.id, cantidad: 60 }],
      },
      bd(),
    );

    const despues = await ocsRecibibles(sesion(PERM), { idProveedor: proveedor.id }, bd());
    const filaDespues = despues.datos[0]!;
    expect(filaDespues.id).toBe(oc.id);
    expect(filaDespues.estatus).toBe('recibida_parcial');
    // La segunda mitad del nombre, afirmada: el renglón surtido ya NO cuenta ni se nombra.
    expect(filaDespues.renglonesPendientes).toBe(1);
    expect(filaDespues.materialesPendientes).toEqual(['AV-02 — Avio 2']);
  });

  /**
   * ⭐ A1 — EL CRITERIO DEL PENDIENTE ES EL MISMO DEL ESTATUS, no una derivación paralela. Tres
   * textos lo prometen (el módulo, la ficha y el JSDoc de `ocsRecibibles`) y hasta esta prueba
   * NADA lo sostenía: cambiar `faltantePorRecibir` por una resta cruda `pedido − recibido > 0`
   * dejaba el suite entero en verde.
   *
   * 96 de 100 cae DENTRO de la banda del 5% (§Post-F9.19) ⇒ el renglón está SURTIDO. Con resta
   * cruda faltarían 4 y el renglón seguiría contándose: la pantalla diría "1 de 2 renglones por
   * recibir" de algo que el ESTATUS ya da por surtido — justo la incoherencia que §Post-F9.19
   * existe para impedir.
   */
  it('el pendiente usa la BANDA de tolerancia del estatus (96 de 100 ya está surtido)', async () => {
    const avio2 = await avio('AV-02', 'Avio 2');
    const oc = await ocAbiertaConAvios(proveedor.id, [
      { idAvio: avioBoton.id, cantidad: 100 },
      // El segundo renglón se queda intacto: mantiene la OC ABIERTA para poder observarla.
      { idAvio: avio2.id, cantidad: 100 },
    ]);

    await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [{ idOrdenCompraLinea: oc.lineas[0]!.id, cantidad: 96 }],
      },
      bd(),
    );

    const salida = await ocsRecibibles(sesion(PERM), { idProveedor: proveedor.id }, bd());
    const fila = salida.datos[0]!;
    expect(fila.id).toBe(oc.id);
    expect(fila.estatus).toBe('recibida_parcial');
    // 1, NO 2: con una resta cruda esto valdría 2 y la prueba se pone roja.
    expect(fila.renglonesPendientes).toBe(1);
    expect(fila.materialesPendientes).toEqual(['AV-02 — Avio 2']);
  });

  /**
   * `materialesPendientesMas` es lo que impide que la fila diga "faltan 3" cuando faltan 5. La
   * única aserción que tenía era `toBe(0)`, que un `0` cableado satisface.
   */
  it('nombra 3 materiales y CUENTA el resto (5 pendientes → 3 + 2)', async () => {
    const avios = [
      avioBoton,
      await avio('AV-02', 'Avio 2'),
      await avio('AV-03', 'Avio 3'),
      await avio('AV-04', 'Avio 4'),
      await avio('AV-05', 'Avio 5'),
    ];
    const oc = await ocAbiertaConAvios(
      proveedor.id,
      avios.map((a) => ({ idAvio: a.id, cantidad: 100 })),
    );

    const salida = await ocsRecibibles(sesion(PERM), { idProveedor: proveedor.id }, bd());
    const fila = salida.datos[0]!;
    expect(fila.id).toBe(oc.id);
    expect(fila.renglones).toBe(5);
    expect(fila.renglonesPendientes).toBe(5);
    // Se NOMBRAN los tres primeros (orden de los renglones de la OC)…
    expect(fila.materialesPendientes).toEqual([
      'BOT-01 — Botón',
      'AV-02 — Avio 2',
      'AV-03 — Avio 3',
    ]);
    // …y los otros DOS se cuentan. Con un 0 cableado (o nombrando otros tantos) esto se pone rojo.
    expect(fila.materialesPendientesMas).toBe(2);
  });

  /**
   * ⭐ EL ORDEN NO PUEDE COLGAR DEL FOLIO. Hoy en `prueba` el folio NO es monótono con la creación:
   * los ETL dejaron las secuencias en cero, así que las OC nuevas toman folios 1, 2, 3… mientras
   * las ~7,978 migradas (todas `autorizada`, o sea ABIERTAS para siempre) llevan folios altos
   * (§Post-F9.85, arreglo MANUAL todavía pendiente). Con `numCompra desc`, la OC que Daniel acaba
   * de crear se iría al final y el recorte la dejaría FUERA — el defecto que la etapa vino a matar,
   * con un número más chico.
   */
  it('ordena por CREACIÓN, no por folio: la OC nueva de folio bajo sale en la primera página', async () => {
    // Tres OC del mismo proveedor. Las dos primeras (las "históricas") se reetiquetan con folios
    // ALTOS, como las migradas; la tercera —la más nueva— se queda con su folio bajo.
    const vieja1 = await ocAbiertaDe(proveedor.id);
    const vieja2 = await ocAbiertaDe(proveedor.id);
    const nueva = await ocAbiertaDe(proveedor.id);
    await cliente.ordenCompra.update({ where: { id: vieja1.id }, data: { numCompra: 9001n } });
    await cliente.ordenCompra.update({ where: { id: vieja2.id }, data: { numCompra: 9002n } });
    const folioNueva = nueva.numCompra;
    expect(folioNueva).toBeLessThan(9001);

    // Con el recorte más duro posible, la que tiene que salir es la MÁS NUEVA.
    const recortada = await ocsRecibibles(
      sesion(PERM),
      { idProveedor: proveedor.id, limite: 1 },
      bd(),
    );
    // Ordenando por folio esto valdría [9002] y la prueba se pone roja.
    expect(recortada.datos.map((o) => o.numCompra)).toEqual([folioNueva]);
    expect(recortada.total).toBe(3);
    expect(recortada.truncado).toBe(true);
  });

  it('el orden completo es por creación descendente (explícito, no incidental)', async () => {
    const vieja1 = await ocAbiertaDe(proveedor.id);
    const vieja2 = await ocAbiertaDe(proveedor.id);
    const nueva = await ocAbiertaDe(proveedor.id);
    await cliente.ordenCompra.update({ where: { id: vieja1.id }, data: { numCompra: 9001n } });
    await cliente.ordenCompra.update({ where: { id: vieja2.id }, data: { numCompra: 9002n } });

    const salida = await ocsRecibibles(sesion(PERM), { idProveedor: proveedor.id }, bd());

    // Por folio esto sería [9002, 9001, folioNueva]: el orden queda AFIRMADO, no supuesto.
    expect(salida.datos.map((o) => o.numCompra)).toEqual([nueva.numCompra, 9002, 9001]);
  });

  it('sin permiso `compras.ver` no se ofrece nada (A4)', async () => {
    await ocAbiertaDe(proveedor.id);
    await expect(
      ocsRecibibles(sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: [] }), {}, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});
