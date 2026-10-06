/**
 * Tests de INTEGRACIÓN de VENTAS (proto vVentas; F7-E2) contra Postgres efímero (testcontainers).
 * Ejercita el DOMINIO (`listarVentas`, SQL crudo) sembrando el EDR directamente (encabezado `Edr` +
 * líneas `EdrLinea`), sin pasar por la generación. Verifica:
 *  (a) resumen agregado en servidor (importe = Σ cant×precio, unidades, ticket promedio, # líneas);
 *  (b) el mes omitido abarca todo el año; el mes fijado filtra a ese mes;
 *  (c) la búsqueda casa por cliente / código de modelo / folio de la OP;
 *  (d) una línea manual (sin orden) sale con `folioOrden` null; el orden es período reciente primero;
 *  (e) la paginación (total + página) y `edr.ver` obligatorio.
 *  (f) ⭐ fila 0.251: `ventas.ver` a secas abre Ventas —y sólo enseña lo facturado, sin costo ni
 *      utilidad— pero NO el EDR; `edr.ver` la sigue abriendo.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { ErrorPermiso } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { calcularEdr, edrPorAnio, edrPorMes, listarLineasEdr } from './edr.js';
import { listarVentas } from './ventas.js';

let cliente: PrismaClient;
let idEmpresa: number;

const sesion = (permisos: ClavePermiso[] = ['edr.ver']) => sesionDePrueba({ permisos });
const bd = () => ({ cliente });

/** Siembra un Edr(anio,mes) con una línea de venta (orden opcional → líneas manuales con idOrden null). */
async function sembrarLinea(opciones: {
  anio: number;
  mes: number;
  clienteNombre: string;
  modeloCodigo: string;
  folio: number | null;
  cantidad: number;
  precio: number;
}): Promise<void> {
  const clienteNeg = await cliente.cliente.create({ data: { nombre: opciones.clienteNombre } });
  const modelo = await cliente.modelo.create({ data: { codigo: opciones.modeloCodigo } });
  const idOrden =
    opciones.folio === null
      ? null
      : (
          await cliente.orden.create({
            data: {
              folio: BigInt(opciones.folio),
              idEmpresa,
              idModelo: modelo.id,
              idCliente: clienteNeg.id,
              estado: 'completa',
            },
          })
        ).id;
  const edr = await cliente.edr.upsert({
    where: { anio_mes: { anio: opciones.anio, mes: opciones.mes } },
    create: { anio: opciones.anio, mes: opciones.mes },
    update: {},
    select: { id: true },
  });
  await cliente.edrLinea.create({
    data: {
      idEdr: edr.id,
      idOrden,
      idEmpresa,
      idCliente: clienteNeg.id,
      idModelo: modelo.id,
      cantVendida: opciones.cantidad,
      precioVenta: opciones.precio,
      origen: idOrden === null ? 'manual' : 'automatica',
    },
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
  const empresa = await crearEmpresaPrueba(cliente);
  idEmpresa = empresa.id;
});

describe('listarVentas', () => {
  it('agrega el resumen del mes en servidor (importe/unidades/ticket/# líneas)', async () => {
    await sembrarLinea({
      anio: 2026,
      mes: 7,
      clienteNombre: 'C&A',
      modeloCodigo: '62182',
      folio: 8842,
      cantidad: 1726,
      precio: 148,
    });
    await sembrarLinea({
      anio: 2026,
      mes: 7,
      clienteNombre: 'Venta manual',
      modeloCodigo: 'MAN-1',
      folio: null,
      cantidad: 500,
      precio: 100,
    });

    const salida = await listarVentas(sesion(), { anio: 2026, mes: 7 }, bd());
    // importe = 1726×148 + 500×100 = 255,448 + 50,000 = 305,448
    expect(salida.resumen.importe).toBe(305448);
    expect(salida.resumen.unidades).toBe(2226);
    expect(salida.resumen.lineas).toBe(2);
    // ticket = 305448 / 2226 = 137.22 (2 decimales)
    expect(salida.resumen.ticketPromedio).toBe(137.22);
    expect(salida.total).toBe(2);
    expect(salida.lineas).toHaveLength(2);
    // La línea manual (sin orden) sale con folioOrden null.
    const manual = salida.lineas.find((l) => l.cliente === 'Venta manual');
    expect(manual?.folioOrden).toBeNull();
    const conOrden = salida.lineas.find((l) => l.cliente === 'C&A');
    expect(conOrden?.folioOrden).toBe(8842);
    expect(conOrden?.importe).toBe(255448);
    expect(conOrden?.mes).toBe(7);
  });

  it('el mes omitido abarca todo el año; fijar el mes filtra a ese mes', async () => {
    await sembrarLinea({
      anio: 2026,
      mes: 7,
      clienteNombre: 'Julio',
      modeloCodigo: 'J-1',
      folio: 1,
      cantidad: 10,
      precio: 100,
    });
    await sembrarLinea({
      anio: 2026,
      mes: 6,
      clienteNombre: 'Junio',
      modeloCodigo: 'M-1',
      folio: 2,
      cantidad: 5,
      precio: 100,
    });

    const anio = await listarVentas(sesion(), { anio: 2026 }, bd());
    expect(anio.resumen.lineas).toBe(2);
    expect(anio.mes).toBeNull();
    // Orden: período reciente primero → julio antes que junio.
    expect(anio.lineas[0]?.mes).toBe(7);
    expect(anio.lineas[1]?.mes).toBe(6);

    const junio = await listarVentas(sesion(), { anio: 2026, mes: 6 }, bd());
    expect(junio.resumen.lineas).toBe(1);
    expect(junio.lineas[0]?.cliente).toBe('Junio');
  });

  it('la búsqueda casa por cliente, código de modelo o folio de la OP', async () => {
    await sembrarLinea({
      anio: 2026,
      mes: 7,
      clienteNombre: 'Liverpool',
      modeloCodigo: '62330',
      folio: 8838,
      cantidad: 900,
      precio: 132,
    });
    await sembrarLinea({
      anio: 2026,
      mes: 7,
      clienteNombre: 'Coppel',
      modeloCodigo: '62171',
      folio: 8830,
      cantidad: 2704,
      precio: 92,
    });

    const porCliente = await listarVentas(sesion(), { anio: 2026, busqueda: 'Liver' }, bd());
    expect(porCliente.resumen.lineas).toBe(1);
    expect(porCliente.lineas[0]?.cliente).toBe('Liverpool');

    const porModelo = await listarVentas(sesion(), { anio: 2026, busqueda: '62171' }, bd());
    expect(porModelo.resumen.lineas).toBe(1);
    expect(porModelo.lineas[0]?.cliente).toBe('Coppel');

    const porFolio = await listarVentas(sesion(), { anio: 2026, busqueda: '8838' }, bd());
    expect(porFolio.resumen.lineas).toBe(1);
    expect(porFolio.lineas[0]?.folioOrden).toBe(8838);
  });

  it('sin edr.ver ni ventas.ver rechaza (A4)', async () => {
    await expect(listarVentas(sesion([]), { anio: 2026 }, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
    // `edr.capturar` (generar/conciliar el mes) tampoco abre Ventas: nunca la abrió.
    await expect(
      listarVentas(sesion(['edr.capturar']), { anio: 2026 }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

/**
 * ⭐⭐ Fila 0.251 (§Post-F9.260(b)): Ventas con llave propia. Daniel negó `edr.ver` a Administración
 * por su regla del dinero —abre el estado de resultados entero, a costo actual y con utilidad bruta—
 * y esa llave era la única puerta de Ventas. Lo que aquí se mide contra Postgres es la promesa en sus
 * tres partes: la llave nueva ABRE Ventas, NO abre el EDR, y lo que enseña no trae costo ni margen.
 */
describe('⭐ 0.251 — `ventas.ver`: la facturación sin el estado de resultados', () => {
  it('con SÓLO `ventas.ver` lista las ventas con sus mismos números', async () => {
    await sembrarLinea({
      anio: 2026,
      mes: 7,
      clienteNombre: 'C&A',
      modeloCodigo: '62182',
      folio: 8842,
      cantidad: 10,
      precio: 148,
    });
    const conVentas = await listarVentas(sesion(['ventas.ver']), { anio: 2026, mes: 7 }, bd());
    const conEdr = await listarVentas(sesion(['edr.ver']), { anio: 2026, mes: 7 }, bd());
    expect(conVentas.resumen.importe).toBe(1480);
    // Las dos llaves ven EXACTAMENTE lo mismo en esta pantalla: `edr.ver` no pierde nada.
    expect(conVentas).toEqual(conEdr);
  });

  it('⭐ lo que enseña es SÓLO lo facturado: ningún campo de costo, margen ni resultado', async () => {
    // Si un día alguien le agrega el costo a esta vista, la llave nueva empezaría a filtrar justo lo
    // que Daniel negó. Esta prueba fija las columnas: agregarle una obliga a decidirlo de nuevo.
    await sembrarLinea({
      anio: 2026,
      mes: 7,
      clienteNombre: 'Coppel',
      modeloCodigo: '62171',
      folio: 8838,
      cantidad: 3,
      precio: 100,
    });
    const salida = await listarVentas(sesion(['ventas.ver']), { anio: 2026, mes: 7 }, bd());
    expect(Object.keys(salida.resumen).sort()).toEqual(
      ['importe', 'lineas', 'ticketPromedio', 'unidades'].sort(),
    );
    expect(Object.keys(salida.lineas[0] ?? {}).sort()).toEqual(
      [
        'anio',
        'cantidad',
        'cliente',
        'descripcion',
        'folioOrden',
        'id',
        'idCliente',
        'idModelo',
        'idOrden',
        'importe',
        'mes',
        'modelo',
        'precio',
      ].sort(),
    );
    const texto = JSON.stringify(salida).toLowerCase();
    for (const prohibida of ['costo', 'margen', 'utilidad', 'resultado']) {
      expect(texto, `Ventas enseña «${prohibida}»`).not.toContain(prohibida);
    }
  });

  it('⛔ con SÓLO `ventas.ver` el EDR sigue cerrado en el dominio (A1), lectura por lectura', async () => {
    await sembrarLinea({
      anio: 2026,
      mes: 7,
      clienteNombre: 'C&A',
      modeloCodigo: '62182',
      folio: 8842,
      cantidad: 10,
      precio: 148,
    });
    const { id: idEdr } = await cliente.edr.findUniqueOrThrow({
      where: { anio_mes: { anio: 2026, mes: 7 } },
      select: { id: true },
    });
    const soloVentas = sesion(['ventas.ver']);
    await expect(calcularEdr(soloVentas, idEdr, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(edrPorMes(soloVentas, 2026, 7, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    // Un mes SIN generar no llega a `calcularEdr` (que re-exige `edr.ver`): así se mide la reja
    // propia de `edrPorMes`, no la de su delegado — si no, aflojarla pasaría sin que nadie lo vea.
    await expect(edrPorMes(soloVentas, 2026, 8, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(edrPorAnio(soloVentas, 2026, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(listarLineasEdr(soloVentas, idEdr, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    // Y con `edr.ver` las cuatro siguen abiertas (control: no es que la sesión estuviera rota).
    const conEdr = sesion(['edr.ver']);
    await expect(calcularEdr(conEdr, idEdr, bd())).resolves.toBeDefined();
    await expect(edrPorMes(conEdr, 2026, 7, bd())).resolves.toBeDefined();
    await expect(edrPorAnio(conEdr, 2026, bd())).resolves.toBeDefined();
    await expect(listarLineasEdr(conEdr, idEdr, {}, bd())).resolves.toBeDefined();
  });
});
