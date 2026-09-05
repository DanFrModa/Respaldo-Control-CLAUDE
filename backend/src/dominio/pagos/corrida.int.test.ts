/**
 * Tests de integración de LA CORRIDA SEMANAL DE PAGOS (fila 0.113). Postgres efímero
 * (testcontainers). Cubre lo que decide dinero y no se puede medir sin base:
 *
 *  (a) el alta carga los conceptos PREDETERMINADOS en cero y toma folio de la secuencia (A3);
 *  (b) un solo BORRADOR por semana y segmento;
 *  (c) el renglón CONGELA los datos del depósito (editar la cuenta después no cambia la corrida);
 *  (d) ⭐ la guarda fiscal BLOQUEA el cierre y dice el NOMBRE (§Post-F9.189(d));
 *  (e) el segmento contra la modalidad del proveedor (un `solo_sin` no cabe en la relación CON);
 *  (f) partir un pago son DOS renglones y NO se colapsan en el concentrado (§Post-F9.185(e));
 *  (g) ⭐ ejecutar hace nacer el pago EsMa a cuenta y el movimiento de CxP, y baja los saldos;
 *  (h) una corrida cerrada NO se edita (D3), y una ejecutada no se vuelve a ejecutar;
 *  (i) el concentrado sale ordenado por monto y sin los renglones en cero;
 *  (n) V1 fila 0.111: el «por revisar» de la fila incluye los RECIBOS SIN VALIDAR del maquilero, y
 *      `pideDecision` lo sube arriba aunque su saldo sea 0.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient, Proveedor } from '../../datos/index.js';
import { ErrorConflicto, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { crearConceptoPago, listarConceptosPago } from '../catalogos/conceptos-pago.js';
import { crearCuentaConcepto } from '../catalogos/conceptos-pago-cuentas.js';
import { crearCuentaPagoProveedor } from '../catalogos/proveedor-cuentas-pago.js';
import { saldoDeMaquilero } from '../esma/saldos.js';
import { registrarMovimientoCxp } from '../terceros/cxp/cxp.js';
import {
  cerrarCorrida,
  concentradoDeCorrida,
  crearCorrida,
  ejecutarCorrida,
  eliminarRenglonCorrida,
  guardarRenglonCorrida,
  listarCorridas,
  obtenerCorridaDetalle,
  pideDecision,
} from './corrida.js';

let cliente: PrismaClient;
let empresa: Empresa;
let taller: Proveedor;
let transportista: Proveedor;

/**
 * CLABEs de PRUEBA: válidas (dígito de control correcto) y **evidentemente sintéticas** — todo el
 * cuerpo es un dígito repetido. El repo es público (fila 0.123) y una CLABE con pinta de real
 * invita a preguntarse de quién es; éstas no engañan a nadie ni un segundo.
 */
const CLABE_FISCAL = '002010077777777771';
const CLABE_PERSONAL = '002010055555555551';

/**
 * Todos los permisos que la corrida necesita, incluidos los de EsMa y CxP que exige al DELEGAR
 * (defensa en profundidad: el seed se los da a los mismos perfiles).
 */
const PERM_TODOS: ClavePermiso[] = [
  'pagos.corrida-armar',
  'pagos.corrida-ver',
  'conceptos-pago.ver',
  'conceptos-pago.administrar',
  'proveedores.ver',
  'proveedores.administrar',
  'esma.ver-pagos',
  // Ejecutar la corrida acuña pagos que nacen `revisado`, y eso es VALIDAR (fila 0.128):
  // `crearPagoACuentaMaquilero` lo exige dentro del acto, no sólo en el llamador.
  'esma.revisar',
  'cxp.ver',
  'cxp.administrar',
  'terceros.ver',
  'terceros.administrar',
  'consultas.ver-importes',
];

const sesion = (permisos: ClavePermiso[] = PERM_TODOS) =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

/** Crea un proveedor con el rol dado (o sin rol) y su modalidad de facturación. */
async function crearProveedor(
  nombre: string,
  codigoRol: string | null,
  modalidad: 'solo_con' | 'solo_sin' | 'ambos',
): Promise<Proveedor> {
  const roles =
    codigoRol === null
      ? undefined
      : {
          create: {
            idRolProveedor: (
              await cliente.rolProveedor.upsert({
                where: { codigo: codigoRol },
                update: {},
                create: { codigo: codigoRol, nombre: codigoRol },
              })
            ).id,
          },
        };
  return cliente.proveedor.create({
    data: { nombre, modalidadFacturacion: modalidad, ...(roles === undefined ? {} : { roles }) },
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
  // «TALLER NORTE» y «TRANSPORTES DEL BAJÍO» son INVENTADOS (fila 0.123: el repo es público).
  taller = await crearProveedor('TALLER NORTE', 'maquila-costura', 'ambos');
  transportista = await crearProveedor('TRANSPORTES DEL BAJIO', null, 'ambos');
});

/** Abre la corrida de la semana del lunes 31-ago-2026. */
async function abrirCorrida(conFactura: boolean): Promise<number> {
  const detalle = await crearCorrida(sesion(), { semana: '2026-09-02', conFactura }, bd());
  return detalle.corrida.id;
}

describe('(a) el alta de la corrida', () => {
  it('normaliza la semana al LUNES y toma folio de la secuencia', async () => {
    const primera = await crearCorrida(sesion(), { semana: '2026-09-02', conFactura: false }, bd());
    expect(primera.corrida.semana).toBe('2026-08-31');
    expect(primera.corrida.folio).toBe(1);
    expect(primera.corrida.estado).toBe('borrador');

    // La otra corrida de la MISMA semana (el otro segmento) es otra corrida, con otro folio.
    const segunda = await crearCorrida(sesion(), { semana: '2026-09-04', conFactura: true }, bd());
    expect(segunda.corrida.semana).toBe('2026-08-31');
    expect(segunda.corrida.folio).toBe(2);
  });

  it('⭐ carga los conceptos PREDETERMINADOS en CERO, y no los demás', async () => {
    await crearConceptoPago(
      sesion(),
      { nombre: 'Caja chica', rubro: 'caja_chica', predeterminado: true },
      bd(),
    );
    await crearConceptoPago(
      sesion(),
      { nombre: 'Nómina por fuera', rubro: 'nomina', predeterminado: true },
      bd(),
    );
    await crearConceptoPago(
      sesion(),
      { nombre: 'Agua', rubro: 'servicios', predeterminado: false },
      bd(),
    );

    const detalle = await crearCorrida(sesion(), { semana: '2026-09-02', conFactura: false }, bd());
    const renglones = detalle.secciones.flatMap((s) => s.filas.flatMap((f) => f.renglones));
    expect(renglones.map((r) => r.nombre).sort()).toEqual(['Caja chica', 'Nómina por fuera']);
    // EN CERO: *«para que siempre se carguen en cero para que yo le ponga la cantidad»*.
    expect(renglones.every((r) => r.monto === 0)).toBe(true);
    // Y por eso los totales siguen en cero: un renglón sin monto no es un pago.
    expect(detalle.corrida.totales).toEqual({
      efectivo: 0,
      transferencia: 0,
      total: 0,
      renglones: 0,
    });

    // ⭐ El que NO es predeterminado **no sale como fila**: la corrida sólo carga sola los
    // predeterminados (doc `pagos-corrida.md` §4: *«los demás se agregan desde el catálogo cuando
    // hacen falta»*). Meterlo como fila vacía llenaría la relación de renglones que nadie pidió.
    //
    // 🔴 Esta prueba afirmaba lo contrario —que «Agua» salía con `renglones: []`— y el CI la puso
    // roja: era la ASERCIÓN la que estaba mal, no el código. Se escribió sin Postgres, describiendo
    // lo que yo creía que hacía el dominio en vez de lo que hace.
    const nombresDeFila = detalle.secciones.flatMap((x) => x.filas).map((f) => f.nombre);
    expect(nombresDeFila).toEqual(expect.arrayContaining(['Caja chica', 'Nómina por fuera']));
    expect(nombresDeFila).not.toContain('Agua');
  });

  it('⭐ …pero el NO predeterminado sí está en el catálogo, listo para agregarse', async () => {
    // La otra mitad de la regla: que no sea fila no puede significar que sea inalcanzable. La
    // pantalla lo ofrece desde el catálogo (`useConceptosPago` → `listarConceptosPago`), y de ahí
    // sale el «agregar concepto». Sin esta prueba, «no está en las filas» sería compatible con «no
    // está en ningún lado», que es un defecto y no un diseño.
    await crearConceptoPago(sesion(), { nombre: 'Agua', rubro: 'servicios' }, bd());
    const catalogo = await listarConceptosPago(sesion(), {}, bd());
    const agua = catalogo.datos.find((c) => c.nombre === 'Agua');
    expect(agua).toBeDefined();
    expect(agua?.predeterminado).toBe(false);
    expect(agua?.activo).toBe(true);
  });
});

describe('(b) un solo borrador por semana y segmento', () => {
  it('abrir dos borradores del mismo segmento y semana se rechaza nombrando el folio', async () => {
    await abrirCorrida(false);
    await expect(
      crearCorrida(sesion(), { semana: '2026-09-03', conFactura: false }, bd()),
    ).rejects.toThrow(ErrorConflicto);
  });

  it('el OTRO segmento de la misma semana sí se puede abrir', async () => {
    const sinFactura = await abrirCorrida(false);
    const conFactura = await abrirCorrida(true);
    // Que resuelva no basta: son DOS corridas distintas, de la misma semana y de segmentos opuestos.
    expect(conFactura).not.toBe(sinFactura);
    const lista = await listarCorridas(sesion(), {}, bd());
    expect(lista.filas.map((c) => c.conFactura).sort()).toEqual([false, true]);
    expect(new Set(lista.filas.map((c) => c.semana)).size).toBe(1);
  });

  it('⭐ tras CERRAR una, se puede abrir otra de la misma semana (así se corrige, D3)', async () => {
    const id = await abrirCorrida(false);
    await guardarRenglonCorrida(
      sesion(),
      id,
      { idProveedor: taller.id, monto: 1000, formaPago: 'efectivo' },
      undefined,
      bd(),
    );
    await cerrarCorrida(sesion(), id, bd());
    // La segunda corrida del MISMO segmento y semana nace de verdad, con su folio propio: es la
    // marcha atrás de D3 (lo cerrado no se edita, se corrige con otra).
    const otra = await crearCorrida(sesion(), { semana: '2026-09-02', conFactura: false }, bd());
    expect(otra.corrida.estado).toBe('borrador');
    expect(otra.corrida.semana).toBe('2026-08-31');
    expect(otra.corrida.id).not.toBe(id);
  });
});

describe('(c) el renglón CONGELA los datos del depósito', () => {
  it('editar la cuenta después NO cambia lo que dice la corrida', async () => {
    const cuenta = await crearCuentaPagoProveedor(
      sesion(),
      taller.id,
      { beneficiario: 'Fulana de Tal', banco: 'BBVA', tipoCuenta: 'clabe', cuenta: CLABE_PERSONAL },
      bd(),
    );
    const id = await abrirCorrida(false);
    await guardarRenglonCorrida(
      sesion(),
      id,
      {
        idProveedor: taller.id,
        monto: 30_000,
        formaPago: 'transferencia',
        idCuenta: cuenta.id,
      },
      undefined,
      bd(),
    );

    // Alguien renombra al beneficiario en el catálogo…
    await cliente.proveedorCuentaPago.update({
      where: { id: cuenta.id },
      data: { beneficiario: 'OTRA PERSONA' },
    });

    // …y la corrida sigue diciendo lo que decía (reimprimir el martes = lo del lunes).
    const detalle = await obtenerCorridaDetalle(sesion(), id, bd());
    const renglon = detalle.secciones.flatMap((s) => s.filas.flatMap((f) => f.renglones))[0];
    expect(renglon?.beneficiario).toBe('Fulana de Tal');
    expect(renglon?.banco).toBe('BBVA');
    expect(renglon?.ultimos4).toBe(CLABE_PERSONAL.slice(-4));
  });

  it('en EFECTIVO el beneficiario es el proveedor mismo, y no lleva cuenta', async () => {
    const id = await abrirCorrida(false);
    await guardarRenglonCorrida(
      sesion(),
      id,
      { idProveedor: taller.id, monto: 5_000, formaPago: 'efectivo' },
      undefined,
      bd(),
    );
    const detalle = await obtenerCorridaDetalle(sesion(), id, bd());
    const renglon = detalle.secciones.flatMap((s) => s.filas.flatMap((f) => f.renglones))[0];
    expect(renglon?.beneficiario).toBe('TALLER NORTE');
    expect(renglon?.ultimos4).toBeNull();
    expect(renglon?.idCuenta).toBeNull();
  });

  it('una transferencia SIN cuenta se rechaza (no se puede transferir a ningún lado)', async () => {
    const id = await abrirCorrida(false);
    await expect(
      guardarRenglonCorrida(
        sesion(),
        id,
        { idProveedor: taller.id, monto: 100, formaPago: 'transferencia' },
        undefined,
        bd(),
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('una cuenta que NO es del beneficiario se rechaza', async () => {
    const ajena = await crearCuentaPagoProveedor(
      sesion(),
      transportista.id,
      { beneficiario: 'Fulana de Tal', tipoCuenta: 'clabe', cuenta: CLABE_PERSONAL },
      bd(),
    );
    const id = await abrirCorrida(false);
    await expect(
      guardarRenglonCorrida(
        sesion(),
        id,
        {
          idProveedor: taller.id,
          monto: 100,
          formaPago: 'transferencia',
          idCuenta: ajena.id,
        },
        undefined,
        bd(),
      ),
    ).rejects.toThrow(ErrorValidacion);
  });
});

describe('(d) ⭐ la guarda fiscal', () => {
  it('en la corrida CON factura no se puede elegir una cuenta NO fiscal', async () => {
    const noFiscal = await crearCuentaPagoProveedor(
      sesion(),
      taller.id,
      { beneficiario: 'Fulana de Tal', tipoCuenta: 'clabe', cuenta: CLABE_PERSONAL },
      bd(),
    );
    const id = await abrirCorrida(true);
    await expect(
      guardarRenglonCorrida(
        sesion(),
        id,
        {
          idProveedor: taller.id,
          monto: 1_000,
          formaPago: 'transferencia',
          idCuenta: noFiscal.id,
        },
        undefined,
        bd(),
      ),
    ).rejects.toThrow(/fiscal/i);
  });

  it('⭐ cerrar la relación CON factura con un pago en EFECTIVO se bloquea, DICIENDO SU NOMBRE', async () => {
    const id = await abrirCorrida(true);
    await guardarRenglonCorrida(
      sesion(),
      id,
      { idProveedor: taller.id, monto: 1_000, formaPago: 'efectivo' },
      undefined,
      bd(),
    );

    // La pantalla lo anuncia ANTES de intentar cerrar (para que se pueda arreglar).
    const detalle = await obtenerCorridaDetalle(sesion(), id, bd());
    expect(detalle.bloqueos).toHaveLength(1);
    expect(detalle.bloqueos[0]?.nombre).toBe('TALLER NORTE');

    // Y el cierre lo rechaza, con el nombre en el mensaje.
    await expect(cerrarCorrida(sesion(), id, bd())).rejects.toThrow(/TALLER NORTE/);
  });

  it('con su cuenta FISCAL capturada, la relación CON factura sí cierra', async () => {
    const fiscal = await crearCuentaPagoProveedor(
      sesion(),
      taller.id,
      {
        beneficiario: 'TALLER NORTE',
        tipoCuenta: 'clabe',
        cuenta: CLABE_FISCAL,
        esFiscal: true,
      },
      bd(),
    );
    const id = await abrirCorrida(true);
    await guardarRenglonCorrida(
      sesion(),
      id,
      {
        idProveedor: taller.id,
        monto: 1_000,
        formaPago: 'transferencia',
        idCuenta: fiscal.id,
      },
      undefined,
      bd(),
    );
    const cerrada = await cerrarCorrida(sesion(), id, bd());
    expect(cerrada.corrida.estado).toBe('cerrada');
    expect(cerrada.bloqueos).toEqual([]);
  });

  it('la relación SIN factura sale a cualquier cuenta (y en efectivo)', async () => {
    const noFiscal = await crearCuentaPagoProveedor(
      sesion(),
      taller.id,
      { beneficiario: 'Fulana de Tal', tipoCuenta: 'clabe', cuenta: CLABE_PERSONAL },
      bd(),
    );
    const id = await abrirCorrida(false);
    await guardarRenglonCorrida(
      sesion(),
      id,
      {
        idProveedor: taller.id,
        monto: 1_000,
        formaPago: 'transferencia',
        idCuenta: noFiscal.id,
      },
      undefined,
      bd(),
    );
    // Que resuelva no basta: se comprueba que de verdad quedó CERRADA.
    const cerrada = await cerrarCorrida(sesion(), id, bd());
    expect(cerrada.corrida.estado).toBe('cerrada');
  });

  it('una corrida sin ningún renglón con monto no se cierra', async () => {
    const id = await abrirCorrida(false);
    await expect(cerrarCorrida(sesion(), id, bd())).rejects.toThrow(ErrorValidacion);
  });
});

describe('(e) el segmento contra la modalidad del proveedor', () => {
  it('⭐ un proveedor que NUNCA factura no cabe en la relación CON factura', async () => {
    const informal = await crearProveedor('TALLER PONIENTE', 'maquila-costura', 'solo_sin');
    const id = await abrirCorrida(true);
    // Sin esta guarda, `resolverConFactura` ignoraría lo pedido al ejecutar y el pago habría
    // saltado EN SILENCIO a la otra relación.
    await expect(
      guardarRenglonCorrida(
        sesion(),
        id,
        { idProveedor: informal.id, monto: 100, formaPago: 'efectivo' },
        undefined,
        bd(),
      ),
    ).rejects.toThrow(/NUNCA factura/);
  });

  it('un proveedor que SIEMPRE factura no cabe en la relación sin factura', async () => {
    const formal = await crearProveedor('TALLER SUR', 'maquila-costura', 'solo_con');
    const id = await abrirCorrida(false);
    await expect(
      guardarRenglonCorrida(
        sesion(),
        id,
        { idProveedor: formal.id, monto: 100, formaPago: 'efectivo' },
        undefined,
        bd(),
      ),
    ).rejects.toThrow(/factura SIEMPRE/);
  });

  it('un proveedor SIN modalidad definida no se puede pagar, y el mensaje dice qué hacer', async () => {
    // REGLA 0-B: los migrados sin modalidad se TOLERAN al leer (salen en el universo con su saldo);
    // lo que no se puede es crear un pago sin saber en cuál de las dos relaciones va.
    const migrado = await cliente.proveedor.create({
      data: { nombre: 'TALLER MIGRADO', modalidadFacturacion: null },
    });
    const id = await abrirCorrida(false);
    await expect(
      guardarRenglonCorrida(
        sesion(),
        id,
        { idProveedor: migrado.id, monto: 100, formaPago: 'efectivo' },
        undefined,
        bd(),
      ),
    ).rejects.toThrow(/modalidad de facturación/);
  });
});

describe('(f) partir un pago son DOS renglones', () => {
  it('⭐ el mismo proveedor con dos cuentas da dos renglones que NO se colapsan', async () => {
    const cuenta1 = await crearCuentaPagoProveedor(
      sesion(),
      taller.id,
      {
        beneficiario: 'Fulana de Tal',
        tipoCuenta: 'clabe',
        cuenta: CLABE_PERSONAL,
        alias: '1',
      },
      bd(),
    );
    const cuenta2 = await crearCuentaPagoProveedor(
      sesion(),
      taller.id,
      { beneficiario: 'Zutano de Tal', tipoCuenta: 'clabe', cuenta: CLABE_FISCAL, alias: '2' },
      bd(),
    );
    const id = await abrirCorrida(false);
    await guardarRenglonCorrida(
      sesion(),
      id,
      {
        idProveedor: taller.id,
        monto: 30_000,
        formaPago: 'transferencia',
        idCuenta: cuenta1.id,
      },
      undefined,
      bd(),
    );
    await guardarRenglonCorrida(
      sesion(),
      id,
      {
        idProveedor: taller.id,
        monto: 20_000,
        formaPago: 'transferencia',
        idCuenta: cuenta2.id,
      },
      undefined,
      bd(),
    );

    const detalle = await obtenerCorridaDetalle(sesion(), id, bd());
    const fila = detalle.secciones.flatMap((s) => s.filas).find((f) => f.idProveedor === taller.id);
    expect(fila?.renglones).toHaveLength(2);
    expect(fila?.totalCapturado).toBe(50_000);

    // Y en la relación ejecutable siguen siendo DOS: *«así debe salir para poder hacer las dos
    // transferencias»*. Se distinguen por beneficiario + alias.
    await cerrarCorrida(sesion(), id, bd());
    const concentrado = await concentradoDeCorrida(sesion(), id, bd());
    const renglones = concentrado.secciones.flatMap((s) => s.renglones);
    expect(renglones).toHaveLength(2);
    expect(renglones.map((r) => r.aliasCuenta)).toEqual(['1', '2']);
    expect(concentrado.totales.transferencia).toBe(50_000);
  });
});

describe('(g) ⭐ ejecutar: nacen los movimientos', () => {
  it('un renglón de maquilero nace como PAGO EsMa a cuenta y BAJA el saldo', async () => {
    const id = await abrirCorrida(false);
    await guardarRenglonCorrida(
      sesion(),
      id,
      { idProveedor: taller.id, monto: 7_500, formaPago: 'efectivo' },
      undefined,
      bd(),
    );
    await cerrarCorrida(sesion(), id, bd());
    const ejecutada = await ejecutarCorrida(sesion(), id, bd());
    expect(ejecutada.corrida.estado).toBe('ejecutada');

    const pagos = await cliente.pagoMaquilero.findMany({ where: { idMaquilero: taller.id } });
    expect(pagos).toHaveLength(1);
    expect(pagos[0]?.monto.toNumber()).toBe(7_500);
    expect(pagos[0]?.conFactura).toBe(false);
    // Nace `revisado`: el dinero salió y el saldo tiene que reflejarlo (ejecutar ES la decisión).
    expect(pagos[0]?.estadoRevision).toBe('revisado');
    // SIN aplicaciones a cargos: el monto lo decidió Daniel, no se derivó de los cargos.
    const aplicaciones = await cliente.pagoAplicacion.count({ where: { idPago: pagos[0]!.id } });
    expect(aplicaciones).toBe(0);

    // ⭐ El ANTICIPO: sin cargos, el saldo queda NEGATIVO — es lo que le debe a la casa.
    const saldo = await saldoDeMaquilero(sesion(), taller.id, {}, bd());
    expect(saldo.saldo).toBe(-7_500);

    // Y el renglón sabe qué movimiento creó (trazabilidad + idempotencia).
    const renglon = await cliente.renglonCorridaPago.findFirst({ where: { idCorrida: id } });
    // ⚠️ Los DOS lados se exigen presentes ANTES de compararlos: con `renglon?.x` contra
    // `pagos[0]?.id`, si faltaran los dos la aserción sería `undefined === undefined` y pasaría en
    // vacío. Es el mismo defecto que dejó rojas tres pruebas de este archivo, en su versión
    // silenciosa — ésta habría pasado en verde sin comprobar nada.
    const pago = pagos[0];
    expect(pago).toBeDefined();
    expect(renglon).not.toBeNull();
    expect(renglon?.idPagoMaquilero).toBe(pago?.id);
  });

  it('un renglón de proveedor de estado de cuenta nace como movimiento de CxP', async () => {
    const id = await abrirCorrida(false);
    await guardarRenglonCorrida(
      sesion(),
      id,
      { idProveedor: transportista.id, monto: 2_300, formaPago: 'efectivo' },
      undefined,
      bd(),
    );
    await cerrarCorrida(sesion(), id, bd());
    await ejecutarCorrida(sesion(), id, bd());

    const movimientos = await cliente.movimientoTercero.findMany({
      where: { idProveedor: transportista.id },
    });
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]?.origen).toBe('pago');
    // El motor le pone el signo: un pago BAJA lo que se le debe.
    expect(movimientos[0]?.monto.toNumber()).toBe(-2_300);
    expect(movimientos[0]?.refTipo).toBe('corrida-pago');
  });

  it('un renglón de CONCEPTO no crea ningún movimiento (no tiene cuenta corriente)', async () => {
    const concepto = await crearConceptoPago(
      sesion(),
      { nombre: 'Caja chica', rubro: 'caja_chica' },
      bd(),
    );
    const id = await abrirCorrida(false);
    await guardarRenglonCorrida(
      sesion(),
      id,
      { idConcepto: concepto.id, monto: 3_000, formaPago: 'efectivo' },
      undefined,
      bd(),
    );
    await cerrarCorrida(sesion(), id, bd());
    await ejecutarCorrida(sesion(), id, bd());

    expect(await cliente.movimientoTercero.count()).toBe(0);
    expect(await cliente.pagoMaquilero.count()).toBe(0);
    // Su registro ES el renglón, y sigue ahí con su monto.
    const renglon = await cliente.renglonCorridaPago.findFirst({ where: { idCorrida: id } });
    expect(renglon?.monto.toNumber()).toBe(3_000);
  });

  it('⭐ los renglones en CERO no crean movimiento (ni de maquila ni de concepto)', async () => {
    const concepto = await crearConceptoPago(
      sesion(),
      { nombre: 'Caja chica', rubro: 'caja_chica', predeterminado: true },
      bd(),
    );
    expect(concepto.predeterminado).toBe(true);
    // Un SEGUNDO maquilero con renglón EN CERO: es el caso que de verdad prueba la regla. Con sólo
    // el concepto en cero la prueba pasaría igual aunque `tieneMonto` estuviera roto, porque un
    // concepto nunca crea movimiento — se leería como cazada sin serlo.
    const enCero = await crearProveedor('TALLER PONIENTE', 'maquila-costura', 'ambos');
    const id = await abrirCorrida(false);
    await guardarRenglonCorrida(
      sesion(),
      id,
      { idProveedor: taller.id, monto: 100, formaPago: 'efectivo' },
      undefined,
      bd(),
    );
    await guardarRenglonCorrida(
      sesion(),
      id,
      { idProveedor: enCero.id, monto: 0, formaPago: 'efectivo' },
      undefined,
      bd(),
    );
    await cerrarCorrida(sesion(), id, bd());
    await ejecutarCorrida(sesion(), id, bd());

    // Sólo UN pago: el del maquilero con monto. El de cero y el predeterminado no se pagaron.
    expect(await cliente.pagoMaquilero.count()).toBe(1);
    expect(await cliente.pagoMaquilero.count({ where: { idMaquilero: enCero.id } })).toBe(0);
  });
});

describe('(h) lo cerrado no se toca (D3)', () => {
  it('una corrida CERRADA no admite renglones nuevos ni ediciones ni borrados', async () => {
    const id = await abrirCorrida(false);
    const detalle = await guardarRenglonCorrida(
      sesion(),
      id,
      { idProveedor: taller.id, monto: 100, formaPago: 'efectivo' },
      undefined,
      bd(),
    );
    const idRenglon = detalle.secciones.flatMap((s) => s.filas.flatMap((f) => f.renglones))[0]!.id;
    await cerrarCorrida(sesion(), id, bd());

    await expect(
      guardarRenglonCorrida(
        sesion(),
        id,
        { idProveedor: taller.id, monto: 200, formaPago: 'efectivo' },
        undefined,
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);
    await expect(eliminarRenglonCorrida(sesion(), id, idRenglon, bd())).rejects.toThrow(
      ErrorConflicto,
    );
  });

  it('una corrida en BORRADOR no se puede ejecutar', async () => {
    const id = await abrirCorrida(false);
    await expect(ejecutarCorrida(sesion(), id, bd())).rejects.toThrow(/borrador/i);
  });

  it('⭐ una corrida EJECUTADA no se vuelve a ejecutar (nada de pagar dos veces)', async () => {
    const id = await abrirCorrida(false);
    await guardarRenglonCorrida(
      sesion(),
      id,
      { idProveedor: taller.id, monto: 100, formaPago: 'efectivo' },
      undefined,
      bd(),
    );
    await cerrarCorrida(sesion(), id, bd());
    await ejecutarCorrida(sesion(), id, bd());
    await expect(ejecutarCorrida(sesion(), id, bd())).rejects.toThrow(/ya se ejecutó/);
    expect(await cliente.pagoMaquilero.count()).toBe(1);
  });
});

describe('(l) ⭐⭐ el ORIGEN se DERIVA del destino, no se acepta del cliente', () => {
  /**
   * 🔴 El defecto que esta prueba fija (hallazgo B1 de la revisión): el `origen` decide EN QUÉ LIBRO
   * nace el pago al ejecutar —`PagoMaquilero` (EsMa) o `MovimientoTercero` (CxP)— y venía en el
   * cuerpo. Un cliente que mandara `{origen:'proveedor', idProveedor:<un maquilero>}` conseguía que
   * la fila se pintara en Maquileros (el `rubro` sí se derivaba) y que el dinero cayera en CxP: el
   * saldo de EsMa del maquilero no bajaba nunca. No hacía falta mala fe, bastaba un `curl`.
   */
  it('un cuerpo con el origen CRUZADO no cambia el libro: el maquilero paga en EsMa', async () => {
    const id = await abrirCorrida(false);
    await guardarRenglonCorrida(
      sesion(),
      id,
      // Se manda el origen equivocado A PROPÓSITO (hoy ni siquiera está en el contrato: viaja como
      // campo desconocido). El servidor lo ignora y lo deriva de los roles del beneficiario.
      { origen: 'proveedor', idProveedor: taller.id, monto: 4_000, formaPago: 'efectivo' } as never,
      undefined,
      bd(),
    );

    const detalle = await obtenerCorridaDetalle(sesion(), id, bd());
    const renglon = detalle.secciones.flatMap((x) => x.filas.flatMap((f) => f.renglones))[0];
    // El taller tiene rol de maquila ⇒ origen `maquila` y sección Maquileros, dijera lo que dijera
    // el cuerpo.
    expect(renglon?.origen).toBe('maquila');
    expect(renglon?.rubro).toBe('maquila');

    await cerrarCorrida(sesion(), id, bd());
    await ejecutarCorrida(sesion(), id, bd());

    // ⭐ Y el dinero cae en el libro correcto: EsMa, no CxP.
    expect(await cliente.pagoMaquilero.count({ where: { idMaquilero: taller.id } })).toBe(1);
    expect(await cliente.movimientoTercero.count({ where: { idProveedor: taller.id } })).toBe(0);
  });

  it('y al revés: un proveedor SIN rol de maquila paga en CxP aunque le manden `maquila`', async () => {
    const id = await abrirCorrida(false);
    await guardarRenglonCorrida(
      sesion(),
      id,
      {
        origen: 'maquila',
        idProveedor: transportista.id,
        monto: 2_000,
        formaPago: 'efectivo',
      } as never,
      undefined,
      bd(),
    );
    const detalle = await obtenerCorridaDetalle(sesion(), id, bd());
    const renglon = detalle.secciones.flatMap((x) => x.filas.flatMap((f) => f.renglones))[0];
    expect(renglon?.origen).toBe('proveedor');
    expect(renglon?.rubro).toBe('proveedores');

    await cerrarCorrida(sesion(), id, bd());
    await ejecutarCorrida(sesion(), id, bd());
    expect(
      await cliente.movimientoTercero.count({ where: { idProveedor: transportista.id } }),
    ).toBe(1);
    expect(await cliente.pagoMaquilero.count({ where: { idMaquilero: transportista.id } })).toBe(0);
  });

  it('un concepto del catálogo siempre es origen `concepto`, aunque le manden otro', async () => {
    const concepto = await crearConceptoPago(
      sesion(),
      { nombre: 'Caja chica', rubro: 'caja_chica' },
      bd(),
    );
    const id = await abrirCorrida(false);
    await guardarRenglonCorrida(
      sesion(),
      id,
      { origen: 'maquila', idConcepto: concepto.id, monto: 500, formaPago: 'efectivo' } as never,
      undefined,
      bd(),
    );
    const detalle = await obtenerCorridaDetalle(sesion(), id, bd());
    const renglon = detalle.secciones.flatMap((x) => x.filas.flatMap((f) => f.renglones))[0];
    expect(renglon?.origen).toBe('concepto');
    await cerrarCorrida(sesion(), id, bd());
    await ejecutarCorrida(sesion(), id, bd());
    // Un concepto no tiene cuenta corriente: no nace movimiento en ningún libro.
    expect(await cliente.pagoMaquilero.count()).toBe(0);
    expect(await cliente.movimientoTercero.count()).toBe(0);
  });
});

describe('(m) ⭐ `cuentaEsFiscal` queda CONGELADO en el renglón (R4)', () => {
  it('des-marcar la cuenta como fiscal DESPUÉS no cambia lo que la corrida ya decidió', async () => {
    const fiscal = await crearCuentaPagoProveedor(
      sesion(),
      taller.id,
      {
        beneficiario: 'TALLER NORTE',
        tipoCuenta: 'clabe',
        cuenta: CLABE_FISCAL,
        esFiscal: true,
      },
      bd(),
    );
    const id = await abrirCorrida(true);
    await guardarRenglonCorrida(
      sesion(),
      id,
      { idProveedor: taller.id, monto: 1_000, formaPago: 'transferencia', idCuenta: fiscal.id },
      undefined,
      bd(),
    );

    // Alguien le quita la marca fiscal a la cuenta en el catálogo…
    await cliente.proveedorCuentaPago.update({
      where: { id: fiscal.id },
      data: { esFiscal: false },
    });

    // …y la corrida sigue diciendo lo que decidió: el renglón guarda su COPIA, así que ni aparece
    // un bloqueo nuevo ni el cierre se cae. Lo contrario —releer el catálogo al cerrar— haría que
    // una relación válida el lunes dejara de serlo el martes sin que nadie tocara la corrida.
    const detalle = await obtenerCorridaDetalle(sesion(), id, bd());
    const renglon = detalle.secciones.flatMap((x) => x.filas.flatMap((f) => f.renglones))[0];
    expect(renglon?.cuentaEsFiscal).toBe(true);
    expect(detalle.bloqueos).toEqual([]);
    const cerrada = await cerrarCorrida(sesion(), id, bd());
    expect(cerrada.corrida.estado).toBe('cerrada');
  });
});

describe('(j) ⭐ el beneficiario: proveedor O concepto, nunca ambos ni ninguno', () => {
  it('mandar los DOS se rechaza en el dominio', async () => {
    const concepto = await crearConceptoPago(
      sesion(),
      { nombre: 'Caja chica', rubro: 'caja_chica' },
      bd(),
    );
    const id = await abrirCorrida(false);
    await expect(
      guardarRenglonCorrida(
        sesion(),
        id,
        {
          idProveedor: taller.id,
          idConcepto: concepto.id,
          monto: 100,
          formaPago: 'efectivo',
        },
        undefined,
        bd(),
      ),
    ).rejects.toThrow(/no de los dos/);
  });

  it('no mandar NINGUNO se rechaza en el dominio', async () => {
    const id = await abrirCorrida(false);
    await expect(
      guardarRenglonCorrida(sesion(), id, { monto: 100, formaPago: 'efectivo' }, undefined, bd()),
    ).rejects.toThrow(/Falta a quién se le paga/);
  });

  it('⭐ y LA BASE lo impide aunque alguien se salte el dominio (CHECK de exclusividad)', async () => {
    const concepto = await crearConceptoPago(
      sesion(),
      { nombre: 'Caja chica', rubro: 'caja_chica' },
      bd(),
    );
    const id = await abrirCorrida(false);
    // INSERT directo con los DOS dueños: el dominio no participa, el CHECK sí.
    await expect(
      cliente.$executeRawUnsafe(
        `INSERT INTO "renglon_corrida_pago"
           ("id_corrida","origen","id_proveedor","id_concepto","rubro","nombre","monto",
            "forma_pago","beneficiario","modificado_en")
         VALUES ($1,'maquila',$2,$3,'maquila','X',100,'efectivo','X',NOW())`,
        id,
        taller.id,
        concepto.id,
      ),
    ).rejects.toThrow(/renglon_corrida_pago_beneficiario_check/);
  });
});

describe('(k) ⭐ los CHECK de la migración muerden de verdad', () => {
  /** Inserta un renglón crudo (sin dominio) con los campos que le pasen encima del mínimo válido. */
  async function insertarCrudo(
    idCorrida: number,
    extra: {
      monto?: number;
      formaPago?: string;
      numeroCuenta?: string | null;
      tipo?: string | null;
    },
  ): Promise<number> {
    // ⚠️ `RETURNING id` + `$queryRawUnsafe`, no `$executeRawUnsafe`: el caso FELIZ tiene que poder
    // comprobar que la fila QUEDÓ, no sólo que la promesa resolvió. `$executeRawUnsafe` devuelve el
    // número de filas y con `.resolves.toBeDefined()` una prueba pasaba en verde sin mirar nada —
    // que es exactamente cómo estas tres llegaron rojas al CI.
    const filas = await cliente.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO "renglon_corrida_pago"
         ("id_corrida","origen","id_proveedor","rubro","nombre","monto","forma_pago",
          "beneficiario","numero_cuenta","tipo_cuenta","modificado_en")
       VALUES ($1,'maquila',$2,'maquila','X',$3,$4::"forma_de_pago",'X',$5,$6::"tipo_cuenta_pago",NOW())
       RETURNING "id"`,
      idCorrida,
      taller.id,
      extra.monto ?? 100,
      extra.formaPago ?? 'efectivo',
      extra.numeroCuenta ?? null,
      extra.tipo ?? null,
    );
    const fila = filas[0];
    if (fila === undefined) {
      throw new Error('El INSERT no devolvió id: la fila no se creó.');
    }
    return fila.id;
  }

  it('un renglón en CERO sí se admite (así nacen los predeterminados)', async () => {
    const id = await abrirCorrida(false);
    const idRenglon = await insertarCrudo(id, { monto: 0 });
    // Se comprueba que la fila EXISTE y con el monto que se pidió: que la promesa resolviera no
    // dice nada sobre lo que quedó en la base.
    const guardado = await cliente.renglonCorridaPago.findUnique({ where: { id: idRenglon } });
    expect(guardado?.monto.toNumber()).toBe(0);
  });

  it('⭐ un monto NEGATIVO lo rechaza la base', async () => {
    // Un pago negativo sería un cargo disfrazado, y ésos tienen su propio camino.
    const id = await abrirCorrida(false);
    await expect(insertarCrudo(id, { monto: -1 })).rejects.toThrow(
      /renglon_corrida_pago_monto_check/,
    );
  });

  it('⭐ una TRANSFERENCIA sin número de cuenta la rechaza la base', async () => {
    // Es el renglón que llegaría al banco sin a dónde ir.
    const id = await abrirCorrida(false);
    await expect(insertarCrudo(id, { formaPago: 'transferencia' })).rejects.toThrow(
      /renglon_corrida_pago_forma_pago_check/,
    );
  });

  it('⭐ un EFECTIVO con número de cuenta lo rechaza la base', async () => {
    const id = await abrirCorrida(false);
    await expect(
      insertarCrudo(id, {
        formaPago: 'efectivo',
        numeroCuenta: '00201005555555555',
        tipo: 'clabe',
      }),
    ).rejects.toThrow(/renglon_corrida_pago_forma_pago_check/);
  });

  it('una transferencia CON cuenta y tipo sí pasa', async () => {
    const id = await abrirCorrida(false);
    const idRenglon = await insertarCrudo(id, {
      formaPago: 'transferencia',
      numeroCuenta: '002010055555555551',
      tipo: 'clabe',
    });
    const guardado = await cliente.renglonCorridaPago.findUnique({ where: { id: idRenglon } });
    expect(guardado?.formaPago).toBe('transferencia');
    expect(guardado?.numeroCuenta).toBe('002010055555555551');
  });

  it('⭐ un renglón de MAQUILA no puede apuntar a un movimiento de CxP', async () => {
    // El CHECK de idempotencia: el libro donde nace el pago va atado al origen del renglón.
    //
    // ⚠️ El movimiento es REAL, no un id inventado. Con un id inexistente la fila la rebotaba la
    // FOREIGN KEY antes de llegar al CHECK, así que la prueba habría seguido verde aunque alguien
    // borrara el CHECK: mediría la FK, no lo que dice medir.
    const movimiento = await registrarMovimientoCxp(
      sesion(),
      transportista.id,
      { fecha: '2026-08-31', origen: 'pago', importe: 500, esFiscal: false },
      bd(),
    );
    const id = await abrirCorrida(false);
    await expect(
      cliente.$executeRawUnsafe(
        `INSERT INTO "renglon_corrida_pago"
           ("id_corrida","origen","id_proveedor","rubro","nombre","monto","forma_pago",
            "beneficiario","id_movimiento_tercero","modificado_en")
         VALUES ($1,'maquila',$2,'maquila','X',100,'efectivo','X',$3,NOW())`,
        id,
        taller.id,
        movimiento.id,
      ),
    ).rejects.toThrow(/renglon_corrida_pago_movimiento_check/);
  });

  it('⭐ la CUENTA destino es de un solo lado (CHECK de exclusividad de la cuenta)', async () => {
    // Un renglón de proveedor no puede salir a la cuenta de un CONCEPTO del catálogo: serían dos
    // dueños para un solo depósito, y el dinero acabaría en la cuenta de otro.
    const concepto = await crearConceptoPago(
      sesion(),
      { nombre: 'Caja chica', rubro: 'caja_chica' },
      bd(),
    );
    const cuentaDelConcepto = await crearCuentaConcepto(
      sesion(),
      concepto.id,
      { beneficiario: 'Fulana de Tal', tipoCuenta: 'clabe', cuenta: CLABE_PERSONAL },
      bd(),
    );
    const id = await abrirCorrida(false);
    await expect(
      cliente.$executeRawUnsafe(
        `INSERT INTO "renglon_corrida_pago"
           ("id_corrida","origen","id_proveedor","rubro","nombre","monto","forma_pago",
            "beneficiario","numero_cuenta","tipo_cuenta","id_cuenta_concepto","modificado_en")
         VALUES ($1,'maquila',$2,'maquila','X',100,'transferencia','X','002010055555555551',
                 'clabe'::"tipo_cuenta_pago",$3,NOW())`,
        id,
        taller.id,
        cuentaDelConcepto.id,
      ),
    ).rejects.toThrow(/renglon_corrida_pago_cuenta_check/);
  });
});

describe('(i) el concentrado', () => {
  it('sale por monto DESCENDENTE, sin los renglones en cero, con totales por rubro', async () => {
    const concepto = await crearConceptoPago(
      sesion(),
      { nombre: 'Caja chica', rubro: 'caja_chica', predeterminado: true },
      bd(),
    );
    await crearCuentaConcepto(
      sesion(),
      concepto.id,
      { beneficiario: 'Fulana de Tal', tipoCuenta: 'clabe', cuenta: CLABE_PERSONAL },
      bd(),
    );
    const otroTaller = await crearProveedor('TALLER PONIENTE', 'maquila-costura', 'ambos');

    const id = await abrirCorrida(false);
    await guardarRenglonCorrida(
      sesion(),
      id,
      { idProveedor: taller.id, monto: 10_000, formaPago: 'efectivo' },
      undefined,
      bd(),
    );
    await guardarRenglonCorrida(
      sesion(),
      id,
      { idProveedor: otroTaller.id, monto: 25_000, formaPago: 'efectivo' },
      undefined,
      bd(),
    );
    await guardarRenglonCorrida(
      sesion(),
      id,
      { idProveedor: transportista.id, monto: 4_000, formaPago: 'efectivo' },
      undefined,
      bd(),
    );
    await cerrarCorrida(sesion(), id, bd());

    const concentrado = await concentradoDeCorrida(sesion(), id, bd());
    // Las secciones vienen en el orden de su Excel: maquilas primero. La de caja chica NO sale:
    // su renglón predeterminado se quedó en cero.
    expect(concentrado.secciones.map((s) => s.rubro)).toEqual(['maquila', 'proveedores']);
    expect(concentrado.secciones[0]?.renglones.map((r) => r.monto)).toEqual([25_000, 10_000]);
    expect(concentrado.secciones[0]?.totales.efectivo).toBe(35_000);
    expect(concentrado.totales).toEqual({
      efectivo: 39_000,
      transferencia: 0,
      total: 39_000,
      renglones: 3,
    });
  });

  it('la lista de corridas trae las dos de la semana con sus totales', async () => {
    await abrirCorrida(false);
    await abrirCorrida(true);
    const lista = await listarCorridas(sesion(), {}, bd());
    expect(lista.total).toBe(2);
    expect(lista.filas.map((c) => c.conFactura).sort()).toEqual([false, true]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// (n) ⭐ LOS RECIBOS SIN VALIDAR LLEGAN HASTA LA CORRIDA (V1, fila 0.111)
//
// La corrida es la tercera puerta del mismo dato: enseña el «por revisar» del maquilero al lado de
// su saldo, y `pideDecision` decide qué filas suben arriba. Como el universo se lo pide al MISMO
// agregado que la bandeja de CxP, un recibo sin validar tiene que llegar hasta aquí SOLO — y esta
// prueba existe para que no deje de llegar el día que alguien toque el camino.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('(n) el maquilero con recibos por validar pide decisión en la corrida', () => {
  /** Recibo de maquila SIN VALIDAR (cargo `propuesto`) de `piezas` × el precio de costura de la orden. */
  async function sembrarReciboSinValidar(
    idMaquilero: number,
    piezas: number,
    precioOrden: number,
  ): Promise<void> {
    const tipoProceso = await cliente.tipoProceso.create({
      data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
    });
    const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Cliente Corrida' } });
    const pedido = await cliente.pedido.create({
      data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocio.id },
    });
    const modelo = await cliente.modelo.create({
      data: { codigo: 'MOD-C', descripcion: 'Modelo corrida' },
    });
    const linea = await cliente.pedidoLinea.create({
      data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: piezas, precio: 100 },
    });
    const orden = await cliente.orden.create({
      data: {
        folio: 1n,
        idEmpresa: empresa.id,
        idPedidoLinea: linea.id,
        idModelo: modelo.id,
        idCliente: clienteNegocio.id,
        maquilaOrd: precioOrden,
      },
    });
    const color = await cliente.color.create({ data: { nombre: 'Verde corrida' } });
    const talla = await cliente.talla.create({ data: { etiqueta: 'CH' } });
    const recibo = await cliente.etapaMovimiento.create({
      data: {
        folio: 1n,
        idEmpresa: empresa.id,
        idOrden: orden.id,
        tipo: 'recibo_maquila',
        idTipoProceso: tipoProceso.id,
        idTercero: idMaquilero,
        fecha: new Date('2026-09-01T00:00:00Z'),
        detalles: { create: { idColor: color.id, idTalla: talla.id, cantidad: piezas } },
      },
    });
    await cliente.esMaCargo.create({
      data: {
        idEmpresa: empresa.id,
        idEtapaRecibo: recibo.id,
        idMaquilero,
        idOrden: orden.id,
        idTipoProceso: tipoProceso.id,
        estado: 'propuesto',
      },
    });
  }

  it('su fila trae el «por revisar» con el recibo, y `pideDecision` la sube', async () => {
    await sembrarReciboSinValidar(taller.id, 10, 8);

    const id = await abrirCorrida(false);
    const detalle = await obtenerCorridaDetalle(sesion(), id, bd());
    const fila = detalle.secciones.flatMap((s) => s.filas).find((f) => f.idProveedor === taller.id);
    if (fila === undefined) throw new Error('la corrida no trajo al taller');
    // El saldo sigue en 0 (nadie ha validado cuánto se le paga) y aun así hay una decisión encima.
    expect(fila.saldo).toBe(0);
    expect(fila.porRevisarPartidas).toBe(1);
    expect(fila.porRevisarNeto).toBe(80);
    expect(pideDecision(fila)).toBe(true);
  });

  it('el transportista (que no es maquila) sigue sin «por revisar» aunque SÍ esté en la corrida', async () => {
    // La cubeta es de EsMa: un proveedor que no es maquilero no puede heredar partidas de nadie.
    //
    // ⚠️ Hay que SEMBRARLE una deuda primero. El universo de la corrida es «saldo ≠ 0 **o** algo
    // pendiente», así que sin movimientos el transportista NI SIQUIERA SALE, `fila` es `undefined`
    // y `fila?.porRevisarPartidas` también — con lo que la prueba pasaba en verde sin mirar nada y
    // habría seguido verde aunque el «por revisar» se le colara a un proveedor. Con la factura de
    // CxP la fila EXISTE, y entonces sus dos campos sí significan algo.
    await registrarMovimientoCxp(
      sesion(),
      transportista.id,
      // `entrada_sin_factura` es el CARGO que sí se captura a mano (la `factura_proveedor` nace del
      // CFDI importado). Sube el saldo del proveedor y cae en el segmento SIN factura, que es el de
      // esta corrida.
      { fecha: '2026-09-01', origen: 'entrada_sin_factura', importe: 1_500, esFiscal: false },
      bd(),
    );
    // Y un maquilero CON recibo sin validar en la misma corrida: si el agregado se desbordara a
    // todas las filas, éste tendría partidas y el transportista también.
    await sembrarReciboSinValidar(taller.id, 10, 8);

    const id = await abrirCorrida(false);
    const detalle = await obtenerCorridaDetalle(sesion(), id, bd());
    const filas = detalle.secciones.flatMap((s) => s.filas);

    const fila = filas.find((f) => f.idProveedor === transportista.id);
    if (fila === undefined) throw new Error('la corrida no trajo al transportista');
    expect(fila.saldo).toBe(1_500);
    expect(fila.porRevisarPartidas).toBe(0);
    expect(fila.porRevisarNeto).toBeNull();
    // Sí pide decisión —se le deben 1,500— pero por su SALDO, no por un «por revisar» heredado.
    // Es la distinción que importa: `pideDecision` mira tres cosas y sólo una es la de esta fila.
    expect(pideDecision(fila)).toBe(true);
    expect(pideDecision({ ...fila, saldo: 0 })).toBe(false);

    // El maquilero de al lado sí lo trae: la diferencia es del rubro, no de que nadie lo tenga.
    const filaTaller = filas.find((f) => f.idProveedor === taller.id);
    if (filaTaller === undefined) throw new Error('la corrida no trajo al taller');
    expect(filaTaller.porRevisarPartidas).toBe(1);
  });
});
