import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
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
import { listarRecepcionesDeOC, recibirCompra, reversarRecepcion } from './recepciones.js';

/**
 * Integración del dominio de RECEPCIÓN de compras (F4-E3) contra Postgres efímero (testcontainers).
 * Cubre lo que SOLO la base valida (NO corre en local — usa Docker; lo corre el CI):
 *  • Atomicidad (A2): si falla la partida/movimiento NO queda recepción ni movimiento.
 *  • Recepciones parciales acumuladas: dos recepciones suman; estatus parcial→total (R7).
 *  • Existencia = Σ movimientos (D3) tras recibir, y valuación cuadra (cantidad×costo == importe OC).
 *  • OUTBOX: la fila se escribe en la MISMA transacción (existe tras commit; NO si hace rollback).
 *  • Reverso: la existencia baja vía inverso visible en kardex; nada se borra (D3).
 *  • Regla (b): recibir contra una OC no autorizada → error.
 *  • Conversión de avío (R1): cantidad × factor / costo ÷ factor.
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
              telaColor: { idTelaColor: colorFelpaRojo.id },
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('Recepción (B1) — entrada de tela POR COLOR: partida + Σ movimientos + valuación (D3, D1)', () => {
  it('recibe total: crea la PARTIDA, mueve el kardex por color (cuerpo+complemento) y deja existencia', async () => {
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
            telaColor: {
              idTelaColor: colorFelpaRojo.id,
              cantidadComplemento: 120, // el cardigan viaja JUNTO en el mismo renglón
              loteProveedor: 'LOTE-A7',
            },
          },
        ],
      },
      bd(),
    );

    const linea = rec.lineas[0]!;
    expect(linea.tipo).toBe('tela');
    // B1: ya NO se crea lote; la traza es la PARTIDA (con su folio y el lote del proveedor).
    expect(linea.idLote).toBeNull();
    expect(linea.idPartida).not.toBeNull();
    expect(linea.partidaFolio).toBe(1);
    expect(linea.loteProveedor).toBe('LOTE-A7');
    expect(linea.idTelaColor).toBe(colorFelpaRojo.id);
    expect(linea.idMovimiento).not.toBeNull();
    expect(linea.cantidadRecibida).toBe(750);
    expect(linea.cantidadComplemento).toBe(120);
    expect(linea.costoUnit).toBe(10); // factor 1 para tela

    // Existencia = Σ movimientos (D3), por tela×COLOR: cuerpo 750 y complemento 120.
    expect(await existenciaColor(colorFelpaRojo.id)).toEqual({ cuerpo: 750, complemento: 120 });

    // Valuación cuadra: cuerpo × costo == cantidad × precio de la línea de OC (importe 7500).
    expect(linea.cantidadRecibida * linea.costoUnit!).toBe(750 * 10);

    // El renglón de kardex trae la dimensión nueva completa (color + partida + complemento) y el
    // costo del CUERPO (el complemento entra sin valuación propia: la OC trae un solo precio).
    const dets = await cliente.movimientoDetTela.findMany({
      where: { idMovimiento: linea.idMovimiento! },
    });
    expect(dets).toHaveLength(1);
    expect(dets[0]!.idTelaColor).toBe(colorFelpaRojo.id);
    expect(dets[0]!.idPartida).toBe(linea.idPartida);
    expect(dets[0]!.idLote).toBeNull();
    expect(Number(dets[0]!.costoUnit)).toBe(10);

    // La partida quedó sellada con la factura de la recepción y su lote del proveedor.
    const partida = await cliente.partidaTela.findUniqueOrThrow({
      where: { id: linea.idPartida! },
    });
    expect(partida.factura).toBe('F-555');
    expect(partida.idTelaColor).toBe(colorFelpaRojo.id);

    // Estatus de la OC → recibida_total (R7): el COMPLEMENTO no cuenta contra lo pedido.
    const ocBd = await cliente.ordenCompra.findUnique({ where: { id: oc.id } });
    expect(ocBd?.estatus).toBe('recibida_total');
  });

  it('sin COLOR la línea de tela se RECHAZA (la OC no lo determina — regla explícita de B1)', async () => {
    const oc = await ocTelaAutorizada(100, 3);
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
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // Nada se escribió (rollback completo, A2).
    expect(await cliente.recepcionCompra.count({ where: { idOrdenCompra: oc.id } })).toBe(0);
    expect(await cliente.movimiento.count({ where: { idEmpresa: empresa.id } })).toBe(0);
    expect(await cliente.partidaTela.count()).toBe(0);
  });

  it('un color de OTRA tela se RECHAZA (no se recibe una tela y se inventaría otra)', async () => {
    const otraTela = await cliente.tela.create({ data: { nombre: 'Jersey' } });
    const colorAjeno = await cliente.telaColor.create({
      data: { idTela: otraTela.id, nombre: 'Azul' },
    });
    const oc = await ocTelaAutorizada(100, 3);
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
              telaColor: { idTelaColor: colorAjeno.id },
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.movimiento.count({ where: { idEmpresa: empresa.id } })).toBe(0);
  });

  it('el COMPLEMENTO puede traer su propio precio y viaja al kardex (costoUnitComplemento, B1)', async () => {
    const oc = await ocTelaAutorizada(200, 10);
    const rec = await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [
          {
            idOrdenCompraLinea: oc.lineas[0]!.id,
            cantidad: 200,
            telaColor: {
              idTelaColor: colorFelpaRojo.id,
              cantidadComplemento: 30,
              // La OC trae UN precio por línea (el del cuerpo); el del cardigan se captura aquí.
              precioUnitComplemento: 140,
            },
          },
        ],
      },
      bd(),
    );
    const det = await cliente.movimientoDetTela.findFirstOrThrow({
      where: { idMovimiento: rec.lineas[0]!.idMovimiento! },
    });
    expect(Number(det.costoUnit)).toBe(10); // cuerpo: precio de la línea de OC ÷ factor
    expect(Number(det.costoUnitComplemento)).toBe(140); // cardigan: su propio precio
  });

  it('sin precio del complemento, el complemento entra SIN valuar (NULL, hueco visible)', async () => {
    const oc = await ocTelaAutorizada(100, 5);
    const rec = await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: oc.id,
        idAlmacen: almacen.id,
        fecha: '2026-06-20',
        lineas: [
          {
            idOrdenCompraLinea: oc.lineas[0]!.id,
            cantidad: 100,
            telaColor: { idTelaColor: colorFelpaRojo.id, cantidadComplemento: 10 },
          },
        ],
      },
      bd(),
    );
    const det = await cliente.movimientoDetTela.findFirstOrThrow({
      where: { idMovimiento: rec.lineas[0]!.idMovimiento! },
    });
    expect(Number(det.costoUnit)).toBe(5);
    expect(det.costoUnitComplemento).toBeNull();
  });

  it('un bloque `telaColor` en una línea de AVÍO o LIBRE se RECHAZA (error de captura, no se ignora)', async () => {
    // AVÍO.
    const ocAvio = await crearOC(
      sesion(PERM),
      {
        idProveedor: proveedor.id,
        lineas: [{ idAvio: avioBoton.id, cantidad: 10, precio: 3, unidad: 'pza' }],
      },
      bd(),
    );
    await autorizarOC(sesion(PERM_AUTORIZAR), ocAvio.id, bd());
    await expect(
      recibirCompra(
        sesion(PERM),
        {
          idOrdenCompra: ocAvio.id,
          idAlmacen: almacen.id,
          fecha: '2026-06-20',
          lineas: [
            {
              idOrdenCompraLinea: ocAvio.lineas[0]!.id,
              cantidad: 10,
              telaColor: { idTelaColor: colorFelpaRojo.id },
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    // LIBRE.
    const ocLibre = await crearOC(
      sesion(PERM),
      {
        idProveedor: proveedor.id,
        lineas: [{ descripcionLibre: 'Flete', cantidad: 1, precio: 300 }],
      },
      bd(),
    );
    await autorizarOC(sesion(PERM_AUTORIZAR), ocLibre.id, bd());
    await expect(
      recibirCompra(
        sesion(PERM),
        {
          idOrdenCompra: ocLibre.id,
          idAlmacen: almacen.id,
          fecha: '2026-06-20',
          lineas: [
            {
              idOrdenCompraLinea: ocLibre.lineas[0]!.id,
              cantidad: 1,
              telaColor: { idTelaColor: colorFelpaRojo.id },
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    // Nada se inventarió por ninguna de las dos.
    expect(await cliente.movimiento.count({ where: { idEmpresa: empresa.id } })).toBe(0);
  });

  it('una tela SIN complemento rechaza la cantidad de complemento', async () => {
    const lisa = await cliente.tela.create({ data: { nombre: 'Popelina' } });
    const colorLisa = await cliente.telaColor.create({
      data: { idTela: lisa.id, nombre: 'Blanco' },
    });
    const oc = await crearOC(
      sesion(PERM),
      { idProveedor: proveedor.id, lineas: [{ idTela: lisa.id, cantidad: 50, precio: 2 }] },
      bd(),
    );
    await autorizarOC(sesion(PERM_AUTORIZAR), oc.id, bd());
    await expect(
      recibirCompra(
        sesion(PERM),
        {
          idOrdenCompra: oc.id,
          idAlmacen: almacen.id,
          fecha: '2026-06-20',
          lineas: [
            {
              idOrdenCompraLinea: oc.lineas[0]!.id,
              cantidad: 50,
              telaColor: { idTelaColor: colorLisa.id, cantidadComplemento: 10 },
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
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
            telaColor: { idTelaColor: colorFelpaRojo.id },
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
            telaColor: { idTelaColor: colorFelpaRojo.id },
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
            telaColor: { idTelaColor: colorFelpaRojo.id },
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
            {
              idOrdenCompraLinea: idLineaOC,
              cantidad: 100,
              telaColor: { idTelaColor: 999999 },
            },
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
            telaColor: { idTelaColor: colorFelpaRojo.id },
          },
        ],
      },
      bd(),
    );
    expect(await existenciaColor(colorFelpaRojo.id)).toEqual({ cuerpo: 500, complemento: 0 });

    const reversada = await reversarRecepcion(
      sesion(PERM),
      rec.id,
      { motivo: 'llegó dañada' },
      bd(),
    );
    expect(reversada.reversada).toBe(true);
    expect(reversada.motivoReverso).toBe('llegó dañada');

    // Existencia de nuevo en 0 (entrada + su inverso se neutralizan POR COLOR), pero los DOS
    // movimientos siguen existiendo (D3) y la PARTIDA se conserva como traza de lo que llegó.
    expect(await existenciaColor(colorFelpaRojo.id)).toEqual({ cuerpo: 0, complemento: 0 });
    expect(await cliente.partidaTela.count()).toBe(1);
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
            telaColor: { idTelaColor: colorFelpaRojo.id },
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

describe('Resumen de cabecera (R9) — OC abiertas + $ por recibir', () => {
  /** Recibe una cantidad de tela contra una línea de OC (helper local). */
  async function recibir(idOc: number, idLineaOC: number, cantidad: number, fecha: string) {
    await recibirCompra(
      sesion(PERM),
      {
        idOrdenCompra: idOc,
        idAlmacen: almacen.id,
        fecha,
        lineas: [
          {
            idOrdenCompraLinea: idLineaOC,
            cantidad,
            telaColor: { idTelaColor: colorFelpaRojo.id },
          },
        ],
      },
      bd(),
    );
  }

  it('cuenta las abiertas y suma (cantidad − recibido) × precio (criterio de recepciones)', async () => {
    // A: autorizada, 100 @ 5, nada recibido → pendiente 500.
    await ocTelaAutorizada(100, 5);
    // B: autorizada, 200 @ 3, recibe 50 → parcial; pendiente 150 × 3 = 450.
    const ocB = await ocTelaAutorizada(200, 3);
    await recibir(ocB.id, ocB.lineas[0]!.id, 50, '2026-06-20');
    // C: borrador (NO autorizada) → no entra en el resumen.
    await crearOC(
      sesion(PERM),
      { idProveedor: proveedor.id, lineas: [{ idTela: telaFelpa.id, cantidad: 999, precio: 9 }] },
      bd(),
    );

    const resumen = await resumenOC(sesion(PERM), {}, bd());
    expect(resumen.ocAbiertas).toBe(2); // autorizada + recibida_parcial
    expect(resumen.porRecibir).toBe(950); // 500 + 450
  });

  it('una OC totalmente recibida deja de contar (sin pendiente)', async () => {
    const oc = await ocTelaAutorizada(100, 4);
    await recibir(oc.id, oc.lineas[0]!.id, 100, '2026-06-20'); // completa → recibida_total
    const resumen = await resumenOC(sesion(PERM), {}, bd());
    expect(resumen.ocAbiertas).toBe(0);
    expect(resumen.porRecibir).toBe(0);
  });

  it('el filtro por proveedor acota el universo del resumen', async () => {
    const otro = await cliente.proveedor.create({ data: { nombre: 'Otro Proveedor' } });
    await ocTelaAutorizada(100, 5); // proveedor base → pendiente 500
    // OC autorizada de OTRO proveedor: 10 @ 7 = 70 pendiente.
    const ocOtro = await crearOC(
      sesion(PERM),
      { idProveedor: otro.id, lineas: [{ idTela: telaFelpa.id, cantidad: 10, precio: 7 }] },
      bd(),
    );
    await autorizarOC(sesion(PERM_AUTORIZAR), ocOtro.id, bd());

    const soloOtro = await resumenOC(sesion(PERM), { idProveedor: otro.id }, bd());
    expect(soloOtro.ocAbiertas).toBe(1);
    expect(soloOtro.porRecibir).toBe(70);

    const todas = await resumenOC(sesion(PERM), {}, bd());
    expect(todas.ocAbiertas).toBe(2);
    expect(todas.porRecibir).toBe(570);
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
              telaColor: { idTelaColor: colorFelpaRojo.id },
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
              telaColor: { idTelaColor: colorFelpaRojo.id },
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
              telaColor: { idTelaColor: colorFelpaRojo.id },
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
    // Dos partidas (una por recepción) y la existencia del COLOR suma las dos.
    expect(recs.recepciones.every((r) => r.lineas[0]!.idPartida !== null)).toBe(true);
    expect(await existenciaColor(colorFelpaRojo.id)).toEqual({ cuerpo: 1000, complemento: 0 });
  });
});
