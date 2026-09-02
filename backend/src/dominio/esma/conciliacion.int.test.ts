/**
 * Tests de integración de la CONCILIACIÓN EsMa vs recibos (`dominio/esma/conciliacion.ts`).
 * Postgres efímero (testcontainers), como el resto de `dominio/esma/` que toca BD.
 *
 * ⭐ POR QUÉ EXISTE ESTE ARCHIVO. Hasta V1-E8k lo único que tocaba `conciliarEsMa` era un caso
 * feliz dentro de `esma-movimientos.int.test.ts` (recibido − cargado + cargos sin recibo), y ahí
 * NUNCA aparecía una prenda incompleta. Pero desde §Post-F9.136 un recibo puede traer SÓLO prendas
 * incompletas: no genera cargo, no mete nada a inventario y aporta `cantidad = 0` — así que su
 * grupo sale con `recibido 0 / cargado 0 / faltantePorCargar 0`. Ese renglón **no es ruido: es la
 * única huella que esa entrega deja en la conciliación**, y nada lo defendía.
 *
 * Lo que se fija aquí:
 *  (a) el renglón de puras incompletas APARECE, y sin cargos en el grupo queda en cero
 *      (`faltantePorCargar === 0`) — la marca explica que no hubo cargo, no garantiza el cuadre;
 *  (b) `incompletas` y `soloIncompletas` los calcula el SERVIDOR (A1) y valen lo que deben en los
 *      TRES sabores de grupo, para que la prueba no pase por construcción del fixture:
 *        • MEZCLADO      — un recibo normal + uno de puras incompletas → marca APAGADA;
 *        • PURAS INCOMPLETAS — un solo recibo sin piezas buenas         → marca ENCENDIDA;
 *        • LIMPIO        — un recibo normal sin ninguna incompleta      → marca APAGADA y 0;
 *  (c) las incompletas NUNCA entran en `recibido`, en `cargado` ni en los totales de piezas;
 *  (d) validar el cargo del grupo mezclado cierra SU faltante sin mover al de incompletas;
 *  (e) REGLA 0-B: un recibo HISTÓRICO en ceros y con la columna en NULL (forma que sólo lo migrado
 *      puede tener) se lee sin romperse y NO se marca como "sólo incompletas".
 * Y de paso el guard de permiso (`esma.ver-pagos`), que tampoco tenía prueba.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Almacen,
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Proveedor,
  Talla,
  TipoProceso,
} from '../../datos/index.js';
import { TipoEtapaMovimiento } from '../../datos/index.js';
import { ErrorPermiso } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso, ConciliacionSalida } from '../../contrato/index.js';

import { registrarCorte, registrarEnvioMaquila } from '../produccion/etapas.js';
import { registrarReciboMaquila } from '../produccion/recibos.js';
import { listarCargosEsMa, validarCargoEsMa } from './cargos.js';
import { conciliarEsMa } from './conciliacion.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let cortador: Proveedor;
/** Maquilero del grupo MEZCLADO (recibo bueno + recibo de puras incompletas). */
let maquileroMezcla: Proveedor;
/** Maquilero del grupo LIMPIO (control negativo: nunca entrega incompletas). */
let maquileroLimpio: Proveedor;
/** Maquilero del grupo de PURAS INCOMPLETAS. */
let estampador: Proveedor;
/** Maquilero del grupo HISTÓRICO (recibo insertado a mano, sin pasar por el dominio). */
let maquileroHistorico: Proveedor;
let procesoCostura: TipoProceso;
let procesoEstampado: TipoProceso;
let almPrimeras: Almacen;
let clienteNegocioId: number;
let idOrden: number;

const PERM_TODOS: ClavePermiso[] = [
  'produccion.corte',
  'produccion.envio',
  'produccion.recibo',
  'produccion.wip-ver',
  'inventario-pt.ver',
  'esma.cargo-validar',
  'esma.ver-pagos',
  'consultas.ver-importes',
];

const sesion = (permisos: ClavePermiso[] = PERM_TODOS) =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

async function crearProveedorConRol(nombre: string, codigoRol: string): Promise<Proveedor> {
  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: codigoRol },
    update: {},
    create: { codigo: codigoRol, nombre: codigoRol },
  });
  return cliente.proveedor.create({
    data: { nombre, roles: { create: { idRolProveedor: rol.id } } },
  });
}

/** Orden Rojo (CH 10, M 20), con maquilaOrd=10 (costura) y aplicacionOrd=5 (estampado). */
async function crearOrdenConMatriz(): Promise<number> {
  const pedido = await cliente.pedido.create({
    data: { folio: 1n, idEmpresa: empresa.id, idCliente: clienteNegocioId },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 30, precio: 10 },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idPedidoLinea: linea.id,
      idModelo: modelo.id,
      idCliente: clienteNegocioId,
      estado: 'completa',
      fechaCompletada: new Date(),
      maquilaOrd: 10,
      aplicacionOrd: 5,
      lineas: {
        create: [
          {
            idColor: colorRojo.id,
            tallas: {
              create: [
                { idTalla: tallaCH.id, cantidad: 10 },
                { idTalla: tallaM.id, cantidad: 20 },
              ],
            },
          },
        ],
      },
    },
  });
  return orden.id;
}

async function sembrarTiposMovimiento(): Promise<void> {
  await cliente.tipoMovimientoInventario.createMany({
    data: [
      { codigo: 'entrada-maquila', nombre: 'Entrada de Maquila', direccion: 'entrada' },
      { codigo: 'error-entrada', nombre: 'Error de Entrada', direccion: 'salida' },
    ],
  });
}

/** Corta TODA la matriz (CH 10 + M 20): el presupuesto contra el que se valida el sobre-envío. */
async function cortarBase(): Promise<void> {
  await registrarCorte(
    sesion(),
    {
      idOrden,
      idCortador: cortador.id,
      fecha: '2026-06-18',
      lineas: [
        {
          idColor: colorRojo.id,
          tallas: [
            { idTalla: tallaCH.id, cantidad: 10 },
            { idTalla: tallaM.id, cantidad: 20 },
          ],
        },
      ],
    },
    bd(),
  );
}

async function enviar(
  proceso: TipoProceso,
  maquilero: Proveedor,
  talla: Talla,
  cantidad: number,
): Promise<void> {
  await registrarEnvioMaquila(
    sesion(),
    {
      idOrden,
      idTipoProceso: proceso.id,
      idMaquilero: maquilero.id,
      fecha: '2026-06-19',
      precioPactado: 8,
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: talla.id, cantidad }] }],
    },
    bd(),
  );
}

/**
 * Recibe una celda del proceso. `buenas` va a `cantidad` (lo que se paga y lo que se cuadra);
 * `incompletas` va a su propio campo (§Post-F9.136: fuera de la cuenta, no se pagan).
 */
async function recibir(
  proceso: TipoProceso,
  maquilero: Proveedor,
  talla: Talla,
  buenas: number,
  incompletas = 0,
): Promise<void> {
  await registrarReciboMaquila(
    sesion(),
    {
      idOrden,
      idTipoProceso: proceso.id,
      idMaquilero: maquilero.id,
      fecha: '2026-06-20',
      precioPactado: 8,
      ...(proceso.generaEntradaPt ? { idAlmacenPrimeras: almPrimeras.id } : {}),
      lineas: [
        {
          idColor: colorRojo.id,
          tallas: [{ idTalla: talla.id, cantidad: buenas, cantidadIncompletas: incompletas }],
        },
      ],
    },
    bd(),
  );
}

/**
 * Arma los TRES grupos de la conciliación sobre la MISMA orden (la clave de grupo es
 * orden+maquilero+proceso, así que basta cambiar de maquilero/proceso):
 *  • MEZCLADO (costura, `maquileroMezcla`): 6 buenas + un segundo recibo de 4 incompletas.
 *  • PURAS INCOMPLETAS (estampado, `estampador`): un único recibo de 5 incompletas y nada más.
 *  • LIMPIO (costura, `maquileroLimpio`): 8 buenas de la talla M, cero incompletas.
 */
async function armarLosTresGrupos(): Promise<void> {
  await enviar(procesoCostura, maquileroMezcla, tallaCH, 10);
  await recibir(procesoCostura, maquileroMezcla, tallaCH, 6);
  await recibir(procesoCostura, maquileroMezcla, tallaCH, 0, 4);

  await enviar(procesoEstampado, estampador, tallaCH, 5);
  await recibir(procesoEstampado, estampador, tallaCH, 0, 5);

  await enviar(procesoCostura, maquileroLimpio, tallaM, 8);
  await recibir(procesoCostura, maquileroLimpio, tallaM, 8);
}

/** Busca el renglón de un grupo (orden+maquilero+proceso). */
function filaDe(
  conciliacion: ConciliacionSalida,
  maquilero: Proveedor,
  proceso: TipoProceso,
): ConciliacionSalida['filas'][number] | undefined {
  return conciliacion.filas.find(
    (f) => f.idMaquilero === maquilero.id && f.idTipoProceso === proceso.id,
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
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  clienteNegocioId = clienteNegocio.id;
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  cortador = await crearProveedorConRol('Corte SA', 'corte');
  maquileroMezcla = await crearProveedorConRol('Maquila Mezcla SA', 'maquila-costura');
  maquileroLimpio = await crearProveedorConRol('Maquila Limpia SA', 'maquila-costura');
  estampador = await crearProveedorConRol('Estampados SA', 'estampado');
  maquileroHistorico = await crearProveedorConRol('Maquila Histórica SA', 'maquila-costura');
  procesoCostura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  procesoEstampado = await cliente.tipoProceso.create({
    data: { codigo: 'estampado', nombre: 'Estampado', generaEntradaPt: false },
  });
  almPrimeras = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  await sembrarTiposMovimiento();
  idOrden = await crearOrdenConMatriz();
  await cortarBase();
});

describe('Conciliación EsMa — permiso (A4, deny-by-default)', () => {
  it('sin `esma.ver-pagos` → ErrorPermiso (ni siquiera consulta la BD)', async () => {
    await expect(conciliarEsMa(sesionDePrueba({ permisos: [] }), {}, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});

describe('Conciliación EsMa — prendas INCOMPLETAS (V1-E8k, §Post-F9.136)', () => {
  it('el grupo de PURAS incompletas tiene renglón, lo dice, y no genera cargo', async () => {
    await armarLosTresGrupos();

    const conc = await conciliarEsMa(sesion(), {}, bd());

    // (a) El renglón EXISTE. Sin él, la entrega de esas 5 prendas no dejaría rastro aquí.
    const soloInc = filaDe(conc, estampador, procesoEstampado);
    expect(soloInc).toBeDefined();
    expect(soloInc?.recibido).toBe(0);
    expect(soloInc?.cargado).toBe(0);
    // (a) …y aquí queda en cero porque ese grupo no tiene NINGÚN cargo: los recibos de puras
    // incompletas no lo generan y no hay cargos migrados/manuales en el fixture. Ojo: la marca no
    // garantiza el cero — un cargo validado sin recibo del mismo grupo lo pondría en negativo.
    expect(soloInc?.faltantePorCargar).toBe(0);
    // (b) …pero la fila DICE por qué está ahí, con la cuenta que la explica.
    expect(soloInc?.incompletas).toBe(5);
    expect(soloInc?.soloIncompletas).toBe(true);

    // (b) MEZCLADO: mismas incompletas, pero también piezas buenas → la marca NO se enciende.
    // Éste es el renglón que impide que la prueba pase por construcción: si `soloIncompletas`
    // fuera "tiene incompletas", aquí saldría true.
    const mezcla = filaDe(conc, maquileroMezcla, procesoCostura);
    expect(mezcla?.recibido).toBe(6);
    expect(mezcla?.incompletas).toBe(4);
    expect(mezcla?.soloIncompletas).toBe(false);
    expect(mezcla?.faltantePorCargar).toBe(6);

    // (b) LIMPIO: control negativo. Un grupo normal sigue en 0 incompletas y sin marca.
    const limpio = filaDe(conc, maquileroLimpio, procesoCostura);
    expect(limpio?.recibido).toBe(8);
    expect(limpio?.incompletas).toBe(0);
    expect(limpio?.soloIncompletas).toBe(false);
    expect(limpio?.faltantePorCargar).toBe(8);

    // (c) Las incompletas NO se cuelan en las piezas: 6 + 0 + 8, nunca 6 + 5 + 8 ni 10 + 5 + 8.
    expect(conc.totales.recibido).toBe(14);
    expect(conc.totales.incompletas).toBe(9);
    expect(conc.totales.cargado).toBe(0);
    expect(conc.totales.faltantePorCargar).toBe(14);
    // …y los totales siguen siendo la suma exacta de lo que se ve, renglón por renglón.
    const suma = (dato: (fila: ConciliacionSalida['filas'][number]) => number): number =>
      conc.filas.reduce((s, fila) => s + dato(fila), 0);
    expect(conc.totales.recibido).toBe(suma((f) => f.recibido));
    expect(conc.totales.incompletas).toBe(suma((f) => f.incompletas));
    expect(conc.totales.faltantePorCargar).toBe(suma((f) => f.faltantePorCargar));
    expect(conc.filas.every((f) => f.faltantePorCargar === f.recibido - f.cargado)).toBe(true);

    // El cuadre da 0 porque NO NACIÓ un cargo, no porque alguien lo tapara: de los CUATRO recibos
    // sólo los dos con piezas buenas dejaron cargo en la cola de validación.
    const cola = await listarCargosEsMa(sesion(), { estado: 'propuesto' }, bd());
    expect(cola.filas).toHaveLength(2);
  });

  /**
   * REGLA 0-B — «¿funciona bien cuando el dato NO está?». `cantidadIncompletas` es NULLABLE y lo
   * migrado de Access llega SIN ella: un recibo histórico puede traer `cantidad 0` y la columna en
   * NULL, algo que `registrarReciboMaquila` hoy no dejaría capturar. Ese renglón NO debe marcarse
   * como "sólo incompletas" —no hay ninguna incompleta que enseñar— y tampoco debe descuadrar.
   * Aquí el recibo se inserta A MANO, saltándose el dominio, que es justo lo único que puede
   * producir esa forma. Es lo que sostiene la segunda mitad de la condición (`incompletas > 0`):
   * sin ella, este renglón mentiría.
   */
  it('un recibo histórico en ceros y sin la columna NO se marca como "solo incompletas"', async () => {
    await cliente.etapaMovimiento.create({
      data: {
        folio: 9001n,
        idEmpresa: empresa.id,
        idOrden,
        tipo: TipoEtapaMovimiento.recibo_maquila,
        idTipoProceso: procesoCostura.id,
        idTercero: maquileroHistorico.id,
        fecha: new Date('2026-06-20T00:00:00.000Z'),
        detalles: {
          // Sin `cantidadIncompletas`: queda NULL, como en lo migrado.
          create: [{ idColor: colorRojo.id, idTalla: tallaCH.id, cantidad: 0 }],
        },
      },
    });

    const conc = await conciliarEsMa(sesion(), {}, bd());
    const historico = filaDe(conc, maquileroHistorico, procesoCostura);
    expect(historico).toBeDefined();
    expect(historico?.recibido).toBe(0);
    expect(historico?.incompletas).toBe(0); // NULL se lee como 0, no truena
    expect(historico?.soloIncompletas).toBe(false); // ← no hay incompletas que declarar
    expect(historico?.faltantePorCargar).toBe(0);
    expect(conc.totales.incompletas).toBe(0);
  });

  it('(d) validar el cargo del grupo mezclado cierra SU faltante y no toca al de incompletas', async () => {
    await armarLosTresGrupos();

    const cola = await listarCargosEsMa(
      sesion(),
      { estado: 'propuesto', idMaquilero: maquileroMezcla.id },
      bd(),
    );
    expect(cola.filas).toHaveLength(1);
    // La cantidad propuesta son las 6 BUENAS: las 4 incompletas no llegaron nunca al cargo.
    expect(cola.filas[0]?.cantidadPropuesta).toBe(6);
    await validarCargoEsMa(
      sesion(),
      cola.filas[0]?.id as number,
      { cantidadReal: 6, precioReal: 8 },
      bd(),
    );

    const conc = await conciliarEsMa(sesion(), {}, bd());
    const mezcla = filaDe(conc, maquileroMezcla, procesoCostura);
    expect(mezcla?.cargado).toBe(6);
    expect(mezcla?.faltantePorCargar).toBe(0);
    // Sigue trayendo sus 4 incompletas y sigue SIN marca (tuvo piezas buenas).
    expect(mezcla?.incompletas).toBe(4);
    expect(mezcla?.soloIncompletas).toBe(false);

    // El de puras incompletas no se movió ni un dígito: nada que cargar, nada que pagar.
    const soloInc = filaDe(conc, estampador, procesoEstampado);
    expect(soloInc?.cargado).toBe(0);
    expect(soloInc?.faltantePorCargar).toBe(0);
    expect(soloInc?.incompletas).toBe(5);
    expect(soloInc?.soloIncompletas).toBe(true);

    expect(conc.totales.cargado).toBe(6);
    expect(conc.totales.faltantePorCargar).toBe(8); // sólo el grupo limpio queda por cargar
    expect(conc.totales.incompletas).toBe(9); // intacto: cargar no consume incompletas
  });
});
