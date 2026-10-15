/**
 * ⭐ Fila 0.242 (§Post-F9.255) — EL TOPE DEL PRECIO DE MAQUILA, contra Postgres real.
 *
 * Lo que sólo la base demuestra: que la GUARDA del envío frena de verdad (la etapa no nace, el
 * rastro no nace), que el tope es `referencia × 1.05` en Decimal (pasa exacto, rebota un centavo
 * arriba), que la referencia de ARTE es la SUMA de sus renglones vivos, que la excepción reservada
 * deja su rastro en la MISMA transacción, y que la consulta de Daniel ve cambios y sobreprecios.
 *
 * ⚠️ Aquí NO se usa `abrirReferenciasDeMaquila` (el ayudante que abre el tope para las pruebas que
 * no tratan de él): cada referencia se pone a mano, con el acto que la pone en producción.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Proveedor,
  Talla,
  TipoProceso,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { validarCargoEsMa } from '../esma/cargos.js';
import { registrarCorte, registrarEnvioMaquila } from './etapas.js';
import { actualizarPreciosOrden } from './precios-orden.js';
import { editarRenglonReceta } from './receta-orden.js';
import { registrarReciboMaquila } from './recibos.js';
import {
  capturarReferenciaMaquila,
  listarCambiosDeReferencias,
  obtenerReferenciasOrden,
} from './referencias-maquila.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let tallaCH: Talla;
let cortador: Proveedor;
let maquilero: Proveedor;
let estampador: Proveedor;
let costura: TipoProceso;
let estampado: TipoProceso;
let bordado: TipoProceso;
let idOrden: number;
let idClienteNegocio: number;

/** Producción: captura el precio y la referencia, manda y recibe, valida cargos. SIN la llave. */
const PRODUCCION: ClavePermiso[] = [
  'ordenes.ver',
  'ordenes.precio-maquila',
  'ordenes.ver-precio-real-maquila',
  'produccion.corte',
  'produccion.envio',
  'produccion.recibo',
  'esma.cargo-validar',
];
/** Daniel: lo mismo MÁS la llave reservada. */
const DANIEL: ClavePermiso[] = [...PRODUCCION, 'ordenes.autorizar-sobreprecio'];

const sesion = (permisos: ClavePermiso[] = PRODUCCION): SesionUsuario =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
const bd = () => ({ cliente });

async function proveedorConRol(nombre: string, codigoRol: string): Promise<Proveedor> {
  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: codigoRol },
    update: {},
    create: { codigo: codigoRol, nombre: codigoRol },
  });
  return cliente.proveedor.create({
    data: {
      nombre,
      modalidadFacturacion: 'solo_sin',
      roles: { create: { idRolProveedor: rol.id } },
    },
  });
}

async function crearOrden(folio = 1n): Promise<number> {
  const pedido = await cliente.pedido.create({
    data: { folio, idEmpresa: empresa.id, idCliente: idClienteNegocio },
  });
  const linea = await cliente.pedidoLinea.create({
    data: { idPedido: pedido.id, idModelo: modelo.id, cantidadPedida: 20, precio: 100 },
  });
  const orden = await cliente.orden.create({
    data: {
      folio,
      idEmpresa: empresa.id,
      idPedidoLinea: linea.id,
      idModelo: modelo.id,
      idCliente: idClienteNegocio,
      estado: 'completa',
      lineas: {
        create: [
          { idColor: colorRojo.id, tallas: { create: [{ idTalla: tallaCH.id, cantidad: 20 }] } },
        ],
      },
    },
  });
  await registrarCorte(
    sesion(),
    {
      idOrden: orden.id,
      idCortador: cortador.id,
      fecha: '2026-10-01',
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 20 }] }],
    },
    bd(),
  );
  return orden.id;
}

/** Un envío de 5 piezas del proceso, con el precio pactado que se le pase. */
function enviar(
  s: SesionUsuario,
  proceso: TipoProceso,
  precioPactado?: number,
  orden = idOrden,
): ReturnType<typeof registrarEnvioMaquila> {
  return registrarEnvioMaquila(
    s,
    {
      idOrden: orden,
      idTipoProceso: proceso.id,
      idMaquilero: proceso.esArte ? estampador.id : maquilero.id,
      fecha: '2026-10-02',
      ...(precioPactado === undefined ? {} : { precioPactado }),
      lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
    },
    bd(),
  );
}

const envios = (orden = idOrden) =>
  cliente.etapaMovimiento.count({ where: { idOrden: orden, tipo: 'envio_maquila' } });
const eventos = (accion?: 'captura' | 'arte' | 'sobreprecio' | 'prellenado') =>
  cliente.ordenReferenciaEvento.findMany({
    where: { idOrden, ...(accion === undefined ? {} : { accion }) },
    orderBy: { id: 'asc' },
  });

async function arte(
  descripcion: string,
  precio: number | null,
  tipo: TipoProceso = estampado,
): Promise<number> {
  const fila = await cliente.ordenArte.create({
    data: { idOrden, idTipoArte: tipo.id, descripcion, precio, agregadoAMano: true },
  });
  return fila.id;
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
  idClienteNegocio = (await cliente.cliente.create({ data: { nombre: 'C&A' } })).id;
  modelo = await cliente.modelo.create({ data: { codigo: 'T-100', descripcion: 'Playera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  cortador = await proveedorConRol('Corte SA', 'corte');
  maquilero = await proveedorConRol('Maquila SA', 'maquila-costura');
  estampador = await proveedorConRol('Estampados SA', 'estampado');
  costura = await cliente.tipoProceso.create({
    data: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  estampado = await cliente.tipoProceso.create({
    data: { codigo: 'estampado', nombre: 'Estampado', esArte: true },
  });
  bordado = await cliente.tipoProceso.create({
    data: { codigo: 'bordado', nombre: 'Bordado', esArte: true },
  });
  // El mismo taller estampa y borda (para mandarle los dos procesos).
  const rolBordado = await cliente.rolProveedor.upsert({
    where: { codigo: 'bordado' },
    update: {},
    create: { codigo: 'bordado', nombre: 'bordado' },
  });
  await cliente.proveedorRol.create({
    data: { idProveedor: estampador.id, idRolProveedor: rolBordado.id },
  });
  idOrden = await crearOrden();
});

// ── 1. La guarda del envío ────────────────────────────────────────────────────────────────────

describe('⭐ sin referencia NO sale a maquila (§Post-F9.253(2))', () => {
  it('costura sin referencia: rechaza y NO nace la etapa', async () => {
    await expect(enviar(sesion(), costura, 10)).rejects.toThrow(
      /no tiene precio de referencia de «Costura»/,
    );
    expect(await envios()).toBe(0);
  });

  it('…ni siquiera con la llave reservada (la llave autoriza pasarse del tope, no salir sin él)', async () => {
    await expect(enviar(sesion(DANIEL), costura)).rejects.toBeInstanceOf(ErrorConflicto);
    expect(await envios()).toBe(0);
  });

  it('…y tampoco sin precio pactado: la regla es la referencia, no el precio', async () => {
    await expect(enviar(sesion(), costura)).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('arte sin renglones en la receta: rechaza diciendo que falta el arte', async () => {
    await expect(enviar(sesion(), estampado, 3)).rejects.toThrow(
      /no lleva ningún arte de «Estampado».*definir que la OP lleva «Estampado»/,
    );
    expect(await envios()).toBe(0);
  });

  it('arte con un renglón SIN precio: rechaza aunque otro sí tenga (no se suma la mitad)', async () => {
    await arte('Logo pecho', 3);
    await arte('Logo espalda', null);
    await expect(enviar(sesion(), estampado, 3)).rejects.toThrow(/no tienen precio/);
    expect(await envios()).toBe(0);
  });

  it('un renglón de arte EXCLUIDO no cuenta: con sólo el excluido, no hay referencia', async () => {
    const id = await arte('Logo pecho', 3);
    await cliente.ordenArte.update({ where: { id }, data: { excluido: true } });
    await expect(enviar(sesion(), estampado, 3)).rejects.toThrow(/no lleva ningún arte/);
  });

  it('con la referencia capturada por PRODUCCIÓN, sale (la (b): el piso no depende de Daniel)', async () => {
    await capturarReferenciaMaquila(
      sesion(),
      idOrden,
      { idTipoProceso: costura.id, precio: 10 },
      bd(),
    );
    const envio = await enviar(sesion(), costura, 10);
    expect(envio.totalPiezas).toBe(5);
  });
});

// ── 2. El tope ────────────────────────────────────────────────────────────────────────────────

describe('⭐ el tope: referencia × 1.05, sin freno hacia abajo', () => {
  beforeEach(async () => {
    await capturarReferenciaMaquila(
      sesion(),
      idOrden,
      { idTipoProceso: costura.id, precio: 10 },
      bd(),
    );
  });

  it('EXACTO en el tope (10.50) pasa; por debajo (2.00) también', async () => {
    await enviar(sesion(), costura, 10.5);
    await enviar(sesion(), costura, 2);
    expect(await envios()).toBe(2);
  });

  it('UN CENTAVO arriba (10.51) sin la llave: rechaza, sin etapa y sin rastro de sobreprecio', async () => {
    await expect(enviar(sesion(), costura, 10.51)).rejects.toThrow(
      /rebasa el tope autorizado de «Costura» \(\$10\.51 contra un tope de \$10\.50/,
    );
    expect(await envios()).toBe(0);
    expect(await eventos('sobreprecio')).toHaveLength(0);
  });

  it('con la llave reservada PASA y deja el sobreprecio en el rastro y en la bitácora (misma tx)', async () => {
    await enviar(sesion(DANIEL), costura, 12);
    expect(await envios()).toBe(1);
    const [ev] = await eventos('sobreprecio');
    expect(ev?.punto).toBe('envio');
    expect(ev?.idTipoProceso).toBe(costura.id);
    expect(ev?.referenciaNueva?.toNumber()).toBe(10);
    expect(ev?.precioAutorizado?.toNumber()).toBe(12);
    const bita = await cliente.bitacora.findMany({
      where: { entidad: 'Orden', idEntidad: String(idOrden) },
    });
    expect(bita.some((b) => JSON.stringify(b.datos).includes('sobreprecio-autorizado'))).toBe(true);
  });

  it('el mensaje NO trae cifras a quien no ve referencias (la 0.249)', async () => {
    const sinVer = sesion(['ordenes.ver', 'produccion.envio']);
    const error = await enviar(sinVer, costura, 50).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorConflicto);
    expect((error as Error).message).toMatch(/rebasa el tope autorizado de «Costura»\./);
    expect((error as Error).message).not.toMatch(/\$/);
  });
});

describe('⭐ la referencia de ARTE es la SUMA de sus renglones vivos', () => {
  it('dos estampados de 3 y 4: referencia 7, tope 7.35 — 7.35 pasa, 7.36 rebota', async () => {
    await arte('Logo pecho', 3);
    await arte('Logo espalda', 4);
    await enviar(sesion(), estampado, 7.35);
    await expect(enviar(sesion(), estampado, 7.36)).rejects.toThrow(/tope de \$7\.35/);
    expect(await envios()).toBe(1);
  });
});

describe('⭐ D2 (reviewer 0.242): una fracción de centavo NO salta el tope', () => {
  beforeEach(async () => {
    await capturarReferenciaMaquila(
      sesion(),
      idOrden,
      { idTipoProceso: costura.id, precio: 33.33 },
      bd(),
    );
  });

  it('34.996 (se guardaría 35.00, arriba del tope 34.99): el esquema lo rechaza en el envío', async () => {
    await expect(enviar(sesion(), costura, 34.996)).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await envios()).toBe(0);
  });

  it('…y en el precio de la orden', async () => {
    await expect(
      actualizarPreciosOrden(sesion(), idOrden, { campo: 'maquila', precio: 34.996 }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('34.99 (el tope) sí pasa', async () => {
    await enviar(sesion(), costura, 34.99);
    expect(await envios()).toBe(1);
  });
});

// ── 3. El precio de la orden (maquilaOrd / aplicacionOrd) ─────────────────────────────────────

describe('⭐ los precios de la orden también se topan', () => {
  it('maquilaOrd sin referencia de costura: no se captura', async () => {
    await expect(
      actualizarPreciosOrden(sesion(), idOrden, { campo: 'maquila', precio: 10 }, bd()),
    ).rejects.toThrow(/no tiene precio de referencia de «Costura»/);
  });

  it('maquilaOrd: 10.50 pasa, 10.60 rebota sin la llave, y con ella pasa con su rastro', async () => {
    await capturarReferenciaMaquila(
      sesion(),
      idOrden,
      { idTipoProceso: costura.id, precio: 10 },
      bd(),
    );
    await actualizarPreciosOrden(sesion(), idOrden, { campo: 'maquila', precio: 10.5 }, bd());
    await expect(
      actualizarPreciosOrden(sesion(), idOrden, { campo: 'maquila', precio: 10.6 }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    await actualizarPreciosOrden(sesion(DANIEL), idOrden, { campo: 'maquila', precio: 10.6 }, bd());
    const [ev] = await eventos('sobreprecio');
    expect(ev?.punto).toBe('orden_maquila');
    // Re-teclear el MISMO precio (ya autorizado) no se re-topa.
    await actualizarPreciosOrden(sesion(), idOrden, { campo: 'maquila', precio: 10.6 }, bd());
  });

  it('aplicacionOrd se topa contra la suma de TODOS los artes, de TODOS los tipos', async () => {
    await arte('Logo pecho', 3);
    await arte('Escudo', 4, bordado);
    await actualizarPreciosOrden(sesion(), idOrden, { campo: 'aplicacion', precio: 7.35 }, bd());
    await expect(
      actualizarPreciosOrden(sesion(), idOrden, { campo: 'aplicacion', precio: 7.4 }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

// ── 4. Recibo escrito a mano y validación EsMa ────────────────────────────────────────────────

describe('⭐ el recibo y la validación del cargo EsMa', () => {
  beforeEach(async () => {
    await arte('Logo pecho', 10);
  });

  async function recibir(precioPactado?: number): Promise<number> {
    await registrarReciboMaquila(
      sesion(),
      {
        idOrden,
        idTipoProceso: estampado.id,
        idMaquilero: estampador.id,
        fecha: '2026-10-03',
        ...(precioPactado === undefined ? {} : { precioPactado }),
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 5 }] }],
      },
      bd(),
    );
    const cargo = await cliente.esMaCargo.findFirstOrThrow({
      where: { idOrden, estado: 'propuesto' },
      orderBy: { id: 'desc' },
    });
    return cargo.id;
  }

  it('el recibo HEREDA el precio autorizado del envío sin re-toparlo; escrito a mano, se topa', async () => {
    await enviar(sesion(DANIEL), estampado, 12);
    await enviar(sesion(DANIEL), estampado, 12);
    await recibir(); // hereda 12: no se re-topa
    await expect(recibir(12.5)).rejects.toThrow(/rebasa el tope/);
    await recibir(10.5); // escrito a mano, dentro del tope (10 × 1.05)
  });

  it('validar un sobreprecio que Daniel YA autorizó (ese precio, esa orden, ese proceso) no se lo vuelve a pedir', async () => {
    await enviar(sesion(DANIEL), estampado, 12);
    const idCargo = await recibir();
    await validarCargoEsMa(sesion(), idCargo, { cantidadReal: 5, precioReal: 12 }, bd());
    const cargo = await cliente.esMaCargo.findUniqueOrThrow({ where: { id: idCargo } });
    expect(cargo.estado).toBe('validado');
  });

  it('validar TECLEANDO otro precio: arriba del tope rebota sin la llave; con ella pasa con rastro', async () => {
    await enviar(sesion(), estampado, 10);
    const idCargo = await recibir();
    await expect(
      validarCargoEsMa(sesion(), idCargo, { cantidadReal: 5, precioReal: 10.6 }, bd()),
    ).rejects.toThrow(/rebasa el tope autorizado de «Estampado»/);
    await validarCargoEsMa(sesion(DANIEL), idCargo, { cantidadReal: 5, precioReal: 10.6 }, bd());
    const sobre = await eventos('sobreprecio');
    expect(sobre.map((e) => e.punto)).toEqual(['cargo_esma']);
  });

  it('⭐ D1 (reviewer 0.242): estampado $5 + bordado $8, aplicacionOrd $13: el PROPUESTO del estampado ($13) NO se valida sin la llave', async () => {
    // Este bloque ya trae un estampado de $10; se excluye para dejar el escenario exacto del reviewer.
    await cliente.ordenArte.updateMany({ where: { idOrden }, data: { excluido: true } });
    await arte('Logo', 5);
    await arte('Escudo', 8, bordado);
    await actualizarPreciosOrden(sesion(), idOrden, { campo: 'aplicacion', precio: 13 }, bd());
    await enviar(sesion(), estampado, 5);
    const idCargo = await recibir();
    // El propuesto del estampado sale de `aplicacionOrd` = $13 (su regla de dinero no cambió)…
    // …pero validarlo es pagar $13 por un estampado de referencia $5 (tope $5.25).
    await expect(
      validarCargoEsMa(sesion(), idCargo, { cantidadReal: 5, precioReal: 13 }, bd()),
    ).rejects.toThrow(/rebasa el tope autorizado de «Estampado»/);
    const cargo = await cliente.esMaCargo.findUniqueOrThrow({ where: { id: idCargo } });
    expect(cargo.estado).toBe('propuesto');
    expect(await eventos('sobreprecio')).toHaveLength(0);
    // Validarlo a su referencia sí pasa; y a $13, sólo con la llave (y deja rastro).
    await validarCargoEsMa(sesion(DANIEL), idCargo, { cantidadReal: 5, precioReal: 13 }, bd());
    expect((await eventos('sobreprecio')).map((e) => e.punto)).toEqual(['cargo_esma']);
  });

  it('se topa contra la referencia VIGENTE: si bajó después del envío, la validación lo nota', async () => {
    const idArte = (await cliente.ordenArte.findFirstOrThrow({ where: { idOrden } })).id;
    await enviar(sesion(), estampado, 10);
    const idCargo = await recibir();
    await capturarReferenciaMaquila(sesion(), idOrden, { idOrdenArte: idArte, precio: 8 }, bd());
    await expect(
      validarCargoEsMa(sesion(), idCargo, { cantidadReal: 5, precioReal: 10 }, bd()),
    ).rejects.toThrow(/rebasa el tope/);
    await validarCargoEsMa(sesion(), idCargo, { cantidadReal: 5, precioReal: 8.4 }, bd());
  });

  it('una autorización previa de OTRO precio no cuenta', async () => {
    await enviar(sesion(DANIEL), estampado, 12);
    const idCargo = await recibir();
    await expect(
      validarCargoEsMa(sesion(), idCargo, { cantidadReal: 5, precioReal: 12.5 }, bd()),
    ).rejects.toThrow(/rebasa el tope/);
  });

  // ⭐ S1/S2 (reviewer 0.242, ronda 3): el ALCANCE de la autorización previa. Sin estas pruebas, quitar
  // el filtro de orden o el de proceso de `sobreprecioYaAutorizado` seguía en verde — y una
  // autorización de CUALQUIER orden (hasta de otra empresa) habría abierto el tope en todas.
  it('S1: la autorización de la orden A NO sirve para validar ese precio en la orden B (misma empresa)', async () => {
    await enviar(sesion(DANIEL), estampado, 12); // A: Daniel autoriza estampado a $12
    idOrden = await crearOrden(2n); // B
    await arte('Logo B', 10);
    await enviar(sesion(), estampado, 10);
    const idCargo = await recibir();
    await expect(
      validarCargoEsMa(sesion(), idCargo, { cantidadReal: 5, precioReal: 12 }, bd()),
    ).rejects.toThrow(/rebasa el tope autorizado de «Estampado»/);
  });

  it('S1: …ni en una orden de OTRA EMPRESA (mismo proceso, mismo precio)', async () => {
    await enviar(sesion(DANIEL), estampado, 12); // A, empresa 1
    empresa = await crearEmpresaPrueba(cliente, 'Otra empresa'); // la sesión pasa a la empresa 2
    idOrden = await crearOrden(1n); // B, empresa 2
    await arte('Logo B', 10);
    await enviar(sesion(), estampado, 10);
    const idCargo = await recibir();
    await expect(
      validarCargoEsMa(sesion(), idCargo, { cantidadReal: 5, precioReal: 12 }, bd()),
    ).rejects.toThrow(/rebasa el tope autorizado de «Estampado»/);
  });

  it('S2: una autorización de COSTURA no sirve para validar ESTAMPADO en la misma orden', async () => {
    await capturarReferenciaMaquila(
      sesion(),
      idOrden,
      { idTipoProceso: costura.id, precio: 10 },
      bd(),
    );
    await enviar(sesion(DANIEL), costura, 12); // sobreprecio de COSTURA a $12
    await enviar(sesion(), estampado, 10);
    const idCargo = await recibir(); // cargo de ESTAMPADO
    await expect(
      validarCargoEsMa(sesion(), idCargo, { cantidadReal: 5, precioReal: 12 }, bd()),
    ).rejects.toThrow(/rebasa el tope autorizado de «Estampado»/);
  });

  it('M7: un precio ESCRITO en el recibo igual al heredado (ya autorizado) no se re-topa', async () => {
    await enviar(sesion(DANIEL), estampado, 12);
    await recibir(12);
    expect(await cliente.esMaCargo.count({ where: { idOrden, idTipoProceso: estampado.id } })).toBe(
      1,
    );
  });

  it('validar tecleando un precio DENTRO del tope pasa sin rastro', async () => {
    await enviar(sesion(), estampado, 10);
    const idCargo = await recibir();
    await validarCargoEsMa(sesion(), idCargo, { cantidadReal: 5, precioReal: 10.5 }, bd());
    expect(await eventos('sobreprecio')).toHaveLength(0);
  });
});

// ── 5. Captura de referencias y su rastro ─────────────────────────────────────────────────────

describe('⭐ capturar referencias deja rastro (anterior → nuevo, quién, cuándo)', () => {
  it('costura: nace (null → 10) y cambia (10 → 11); re-teclear igual no deja rastro', async () => {
    await capturarReferenciaMaquila(
      sesion(),
      idOrden,
      { idTipoProceso: costura.id, precio: 10 },
      bd(),
    );
    await capturarReferenciaMaquila(
      sesion(),
      idOrden,
      { idTipoProceso: costura.id, precio: 11, nota: 'renegociado' },
      bd(),
    );
    await capturarReferenciaMaquila(
      sesion(),
      idOrden,
      { idTipoProceso: costura.id, precio: 11 },
      bd(),
    );
    const evs = await eventos('captura');
    expect(
      evs.map((e) => [e.referenciaAnterior?.toNumber() ?? null, e.referenciaNueva?.toNumber()]),
    ).toEqual([
      [null, 10],
      [10, 11],
    ]);
    expect(evs[1]?.nota).toBe('renegociado');
    expect(evs[1]?.capturadoPorId).toBe('usuario-prueba');
  });

  it('arte por el panel: cambia el precio, lo marca AJUSTADO y NO revoca la firma de Desarrollo', async () => {
    const id = await arte('Logo pecho', 3);
    await arte('Logo espalda', 4);
    const firmado = new Date('2026-09-01T00:00:00Z');
    await cliente.ordenArte.update({ where: { id }, data: { liberadoEn: firmado } });
    await capturarReferenciaMaquila(sesion(), idOrden, { idOrdenArte: id, precio: 5 }, bd());
    const fila = await cliente.ordenArte.findUniqueOrThrow({ where: { id } });
    expect(fila.precio?.toNumber()).toBe(5);
    expect(fila.estado).toBe('ajustado');
    expect(fila.liberadoEn?.toISOString()).toBe(firmado.toISOString());
    const [ev] = await eventos('arte');
    expect(ev?.idTipoProceso).toBe(estampado.id);
    expect([ev?.referenciaAnterior?.toNumber(), ev?.referenciaNueva?.toNumber()]).toEqual([7, 9]);
  });

  it('un proceso de ARTE no se captura como fila de proceso', async () => {
    await expect(
      capturarReferenciaMaquila(
        sesion(),
        idOrden,
        { idTipoProceso: estampado.id, precio: 5 },
        bd(),
      ),
    ).rejects.toThrow(/es un proceso de arte/);
  });

  it('sin `ordenes.precio-maquila` no se captura', async () => {
    await expect(
      capturarReferenciaMaquila(
        sesion(['ordenes.ver']),
        idOrden,
        { idTipoProceso: costura.id, precio: 5 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('sobre una orden CERRADA no se captura', async () => {
    await cliente.orden.update({ where: { id: idOrden }, data: { cerradaEn: new Date() } });
    await expect(
      capturarReferenciaMaquila(sesion(), idOrden, { idTipoProceso: costura.id, precio: 5 }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(await cliente.ordenReferenciaProceso.count()).toBe(0);
  });

  it('M9: el precio de un arte EXCLUIDO no se captura (no suma a la referencia)', async () => {
    const id = await arte('Logo pecho', 3);
    await cliente.ordenArte.update({ where: { id }, data: { excluido: true } });
    await expect(
      capturarReferenciaMaquila(sesion(), idOrden, { idOrdenArte: id, precio: 9 }, bd()),
    ).rejects.toThrow(/está excluido/);
    expect((await cliente.ordenArte.findUniqueOrThrow({ where: { id } })).precio?.toNumber()).toBe(
      3,
    );
  });

  it('M18: una mutación de la receta que NO mueve la suma NO deja evento de arte', async () => {
    const id = await arte('Logo pecho', 3);
    await editarRenglonReceta(
      sesion([...PRODUCCION, 'desarrollo.administrar']),
      idOrden,
      'arte',
      id,
      { descripcion: 'Logo pecho grande' },
      bd(),
    );
    expect(await eventos('arte')).toHaveLength(0);
  });

  it('el precio del arte movido DESDE LA RECETA también deja su rastro', async () => {
    const id = await arte('Logo pecho', 3);
    await editarRenglonReceta(
      sesion([...PRODUCCION, 'desarrollo.administrar']),
      idOrden,
      'arte',
      id,
      { precio: 6 },
      bd(),
    );
    const [ev] = await eventos('arte');
    expect([ev?.referenciaAnterior?.toNumber(), ev?.referenciaNueva?.toNumber()]).toEqual([3, 6]);
    expect(ev?.nota).toBe('Desde la receta de la orden.');
  });
});

// ── 6. Lectura y consulta ─────────────────────────────────────────────────────────────────────

describe('⭐ quién ve las referencias, y la consulta de Daniel', () => {
  let idArte: number;
  beforeEach(async () => {
    await capturarReferenciaMaquila(
      sesion(),
      idOrden,
      { idTipoProceso: costura.id, precio: 10 },
      bd(),
    );
    idArte = await arte('Logo pecho', 3);
  });

  it('quien captura las ve con su tope; con sólo `ordenes.ver` van TAPADAS', async () => {
    const vistas = await obtenerReferenciasOrden(sesion(), idOrden, bd());
    const deCostura = vistas.procesos.find((p) => p.codigo === 'costura');
    const deArte = vistas.procesos.find((p) => p.codigo === 'estampado');
    expect([deCostura?.referencia, deCostura?.tope, deCostura?.estado]).toEqual([
      10,
      10.5,
      'lista',
    ]);
    expect([deArte?.referencia, deArte?.renglones[0]?.precio]).toEqual([3, 3]);

    const tapadas = await obtenerReferenciasOrden(sesion(['ordenes.ver']), idOrden, bd());
    expect(tapadas.ocultas).toBe(true);
    for (const p of tapadas.procesos) {
      expect([p.referencia, p.tope]).toEqual([null, null]);
      for (const r of p.renglones) expect(r.precio).toBeNull();
    }
  });

  it('la consulta pide la llave reservada', async () => {
    await expect(listarCambiosDeReferencias(sesion(), {}, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('ve los cambios Y los sobreprecios, filtra por sobreprecios y no cruza de empresa', async () => {
    await capturarReferenciaMaquila(sesion(), idOrden, { idOrdenArte: idArte, precio: 4 }, bd());
    await enviar(sesion(DANIEL), costura, 12);
    const todo = await listarCambiosDeReferencias(sesion(DANIEL), {}, bd());
    expect(todo.eventos.map((e) => e.accion).sort()).toEqual(
      ['arte', 'captura', 'sobreprecio'].sort(),
    );
    const sobre = todo.eventos.find((e) => e.accion === 'sobreprecio');
    expect(sobre).toMatchObject({
      folioOrden: 1,
      proceso: 'Costura',
      precioAutorizado: 12,
      punto: 'envio',
    });

    const soloSobre = await listarCambiosDeReferencias(
      sesion(DANIEL),
      { soloSobreprecios: true },
      bd(),
    );
    expect(soloSobre.eventos.map((e) => e.accion)).toEqual(['sobreprecio']);

    const otra = await crearEmpresaPrueba(cliente, 'Otra');
    const ajena = await listarCambiosDeReferencias(
      sesionDePrueba({ idEmpresaActiva: otra.id, permisos: DANIEL }),
      {},
      bd(),
    );
    expect(ajena.eventos).toEqual([]);
  });
});
