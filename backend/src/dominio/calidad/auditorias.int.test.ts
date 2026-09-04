/**
 * Tests de INTEGRACIÓN del NÚCLEO de AUDITORÍAS (F6-E2). Postgres efímero (testcontainers). Cubre lo
 * que pide la ficha:
 *  • folio `numAuditoria` consecutivo (incl. bajo concurrencia, A3);
 *  • alta pre-carga TODOS los defectos favoritos ACTIVOS (ex InsertarFav) y propone el maquilero;
 *  • la captura calcula la sugerencia por nivel AQL como REFERENCIA, pero el `resultado` persistido es
 *    el MANUAL (decisión (a)); el override de muestra exige el permiso de captura (decisión (b));
 *  • una auditoría FINAL aprobada auto-completa el proceso `auditoria` de la RC; reprobada lo
 *    des-completa; una de PISO no lo completa (vía el outbox + auto-avance);
 *  • la reclasificación Primeras↔Segundas genera MOVIMIENTOS de kardex y NO edita existencias (D3).
 *
 * La cola/jobs están INACTIVOS en tests: el evento se ESCRIBE en el outbox al capturar (igual que en
 * prod) y aquí se DRENA invocando `procesarEventoAutoAvance` directo (igual que `autoAvance.int.test`).
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
} from '../../datos/index.js';
import type { ClavePermiso } from '../../contrato/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { registrarMovimientoPt as registrarMovimientoPtMotor } from '../../comun/kardex.js';
import { ORIGEN } from '../../comun/origenes.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { MensajeEventoDominio } from '../../comun/cola-eventos.js';
import { procesarEventoAutoAvance } from '../ruta-critica/autoAvance.js';
import {
  cancelarAuditoria,
  capturarResultado,
  crearAuditoria,
  historialPorMaquilero,
  listarAuditorias,
  modificarAuditoria,
  obtenerAuditoria,
  obtenerContextoOrden,
  reclasificar,
  resumenAuditorias,
} from './auditorias.js';
import { crearDefecto } from './defectos.js';
import { crearPlanAql } from './planes-aql.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let maquilero: Proveedor;
let almPrimeras: Almacen;
let almSegundas: Almacen;
let clienteNegocioId: number;
let idOrden: number;
let idFav1: number; // favorito nivel 1
let idFav25: number; // favorito nivel 2.5

const PERM: ClavePermiso[] = [
  'calidad.ver',
  'calidad.generar-auditorias',
  'calidad.actualizar-auditorias',
  'calidad.modificar-auditorias',
  'calidad.administrar-catalogo',
];

const sesion = () => sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM });
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
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  clienteNegocioId = clienteNegocio.id;
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  maquilero = await crearProveedorConRol('Maquila SA', 'maquila-costura');
  almPrimeras = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  almSegundas = await cliente.almacen.create({ data: { nombre: 'Segundas', tipo: 'PT' } });
  await sembrarTiposMovimiento();
  await sembrarPlan();
  await sembrarFavoritos();
  idOrden = await crearOrdenConMatriz(); // Rojo CH 10, M 20 (30 piezas); maquilero asignado.
});

// ── Helpers de mundo ──────────────────────────────────────────────────────────────────────────

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
      idMaquilero: maquilero.id,
      estado: 'completa',
      fechaCompletada: new Date(),
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
      { codigo: 'inventario-inicial', nombre: 'Inventario Inicial', direccion: 'entrada' },
      { codigo: 'transferencia-salida', nombre: 'Transferencia (salida)', direccion: 'salida' },
      { codigo: 'transferencia-entrada', nombre: 'Transferencia (entrada)', direccion: 'entrada' },
    ],
  });
}

/** Plan AQL default con un renglón que cubre el lote 30 (muestra 13). */
async function sembrarPlan(): Promise<void> {
  await crearPlanAql(
    sesion(),
    {
      nombre: 'ISO 2859 — prueba',
      renglones: [
        {
          loteMin: 2,
          loteMax: 100,
          tamanoMuestra: 13,
          limites: [
            { nivelAQL: 1, aceptar: 0, rechazar: 1 },
            { nivelAQL: 2.5, aceptar: 1, rechazar: 2 },
            { nivelAQL: 10, aceptar: 3, rechazar: 4 },
          ],
        },
      ],
    },
    bd(),
  );
}

/** Dos favoritos activos (nivel 1 y 2.5), un favorito DESACTIVADO y un no-favorito. */
async function sembrarFavoritos(): Promise<void> {
  const fav1 = await crearDefecto(
    sesion(),
    {
      clave: 'F-1',
      descripcion: 'Crítico nivel 1',
      nivelAQL: 1,
      favorito: true,
      aplicaGeneral: true,
    },
    bd(),
  );
  idFav1 = fav1.id;
  const fav25 = await crearDefecto(
    sesion(),
    {
      clave: 'F-25',
      descripcion: 'Mayor nivel 2.5',
      nivelAQL: 2.5,
      favorito: true,
      aplicaGeneral: true,
    },
    bd(),
  );
  idFav25 = fav25.id;
  // Favorito DESACTIVADO: no debe pre-cargarse.
  const favOff = await crearDefecto(
    sesion(),
    {
      clave: 'F-OFF',
      descripcion: 'Favorito apagado',
      nivelAQL: 10,
      favorito: true,
      aplicaGeneral: true,
    },
    bd(),
  );
  await cliente.defectoCatalogo.update({ where: { id: favOff.id }, data: { activo: false } });
  // No favorito: tampoco se pre-carga.
  await crearDefecto(
    sesion(),
    {
      clave: 'NOFAV',
      descripcion: 'No favorito',
      nivelAQL: 10,
      favorito: false,
      aplicaGeneral: true,
    },
    bd(),
  );
}

/** Crea un proceso de RC con `tipoEvento='auditoria'` y su renglón ACTIVO en la orden. Devuelve idRuta. */
async function crearProcesoAuditoriaRC(): Promise<number> {
  const proc = await cliente.procesoDef.create({
    data: { codigo: 'aud-cal', nombre: 'Auditoría de calidad', tipoEvento: 'auditoria' },
  });
  const r = await cliente.rutaOrden.create({
    data: { idOrden, idProcesoDef: proc.id, secuencia: 0, duracionDias: 1, estado: 'activo' },
  });
  return r.id;
}

/** Mete existencia a Primeras (Rojo CH 10, M 20) por el motor de kardex, ETIQUETADA con la orden
 * auditada (F6-E2 "PT por orden": la reclasificación valida/mueve contra el bucket de ESA orden). */
async function sembrarExistenciaPrimeras(): Promise<void> {
  const tipo = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
    where: { codigo: 'inventario-inicial' },
    select: { id: true },
  });
  await registrarMovimientoPtMotor(
    sesion(),
    {
      idEmpresa: empresa.id,
      idTipoMov: tipo.id,
      idAlmacen: almPrimeras.id,
      fecha: new Date('2026-06-20T00:00:00Z'),
      origenTipo: ORIGEN.movimientoManual,
      lineas: [
        { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaCH.id, idOrden, cantidad: 10 },
        { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, idOrden, cantidad: 20 },
      ],
    },
    bd(),
  );
}

/** Existencia por almacén de un artículo (lee la vista, NO edita nada). */
async function existenciaEnAlmacen(idAlmacen: number, idTalla: number): Promise<number> {
  const filas = await cliente.$queryRaw<{ existencia: bigint | null }[]>`
    SELECT COALESCE(SUM(e."existencia"), 0)::bigint AS existencia
    FROM "existencia_pt" e
    WHERE e."id_empresa" = ${empresa.id}
      AND e."id_modelo" = ${modelo.id}
      AND e."id_color" = ${colorRojo.id}
      AND e."id_talla" = ${idTalla}
      AND e."id_almacen" = ${idAlmacen}
  `;
  return Number(filas[0]?.existencia ?? 0n);
}

/** Existencia de un artículo en un almacén DENTRO de un bucket de orden (NULL = bucket sin orden). */
async function existenciaBucket(
  idAlmacen: number,
  idTalla: number,
  idOrdenBucket: number | null,
): Promise<number> {
  const filas = await cliente.$queryRaw<{ existencia: bigint | null }[]>`
    SELECT COALESCE(SUM(e."existencia"), 0)::bigint AS existencia
    FROM "existencia_pt" e
    WHERE e."id_empresa" = ${empresa.id}
      AND e."id_modelo" = ${modelo.id}
      AND e."id_color" = ${colorRojo.id}
      AND e."id_talla" = ${idTalla}
      AND e."id_almacen" = ${idAlmacen}
      AND e."id_orden" IS NOT DISTINCT FROM ${idOrdenBucket}
  `;
  return Number(filas[0]?.existencia ?? 0n);
}

/** Mete `cantidad` piezas de Rojo/CH a Primeras en el bucket SIN ORDEN (movimiento manual). */
async function sembrarSinOrdenPrimeras(cantidad: number): Promise<void> {
  const tipo = await cliente.tipoMovimientoInventario.findUniqueOrThrow({
    where: { codigo: 'inventario-inicial' },
    select: { id: true },
  });
  await registrarMovimientoPtMotor(
    sesion(),
    {
      idEmpresa: empresa.id,
      idTipoMov: tipo.id,
      idAlmacen: almPrimeras.id,
      fecha: new Date('2026-06-20T00:00:00Z'),
      origenTipo: ORIGEN.movimientoManual,
      lineas: [{ idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaCH.id, cantidad }],
    },
    bd(),
  );
}

/** Drena la ÚLTIMA fila del outbox de un tipo y la pasa al auto-avance (cola inactiva en tests). */
async function drenarUltimoEvento(tipo: string): Promise<void> {
  const fila = await cliente.eventoOutbox.findFirstOrThrow({
    where: { tipo },
    orderBy: { id: 'desc' },
  });
  const mensaje: MensajeEventoDominio = {
    id: fila.id,
    tipo: fila.tipo,
    version: fila.version,
    idEmpresa: fila.idEmpresa,
    payload: fila.payload,
  };
  await procesarEventoAutoAvance(mensaje, bd());
}

// ── Tests ──────────────────────────────────────────────────────────────────────────────────────

describe('Auditorías — permisos (deny-by-default)', () => {
  it('sin permiso no se puede generar, capturar, leer ni reclasificar', async () => {
    const sin = sesionDePrueba({ idEmpresaActiva: empresa.id });
    await expect(crearAuditoria(sin, { idOrden }, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(obtenerContextoOrden(sin, idOrden, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(obtenerAuditoria(sin, 1, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(
      capturarResultado(sin, 1, { resultado: 'aprobado', defectos: [] }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(
      reclasificar(sin, 1, { sentido: 'a-segundas', lineas: [] }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('generar-auditorias NO basta para capturar (eso exige actualizar-auditorias)', async () => {
    const soloGenerar = sesionDePrueba({
      idEmpresaActiva: empresa.id,
      permisos: ['calidad.ver', 'calidad.generar-auditorias'],
    });
    const a = await crearAuditoria(soloGenerar, { idOrden }, bd());
    await expect(
      capturarResultado(soloGenerar, a.id, { resultado: 'aprobado', defectos: [] }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('Auditorías — alta', () => {
  it('genera folio, propone maquilero, calcula muestra y pre-carga TODOS los favoritos ACTIVOS', async () => {
    const a = await crearAuditoria(sesion(), { idOrden, tipoAuditoria: 'final' }, bd());
    expect(a.numAuditoria).toBe(1);
    expect(a.idMaquilero).toBe(maquilero.id); // sugerido del maquilero de la orden.
    expect(a.tamanoMuestra).toBe(13); // del plan AQL para lote 30.
    // Solo los 2 favoritos ACTIVOS (el desactivado y el no-favorito NO entran).
    expect(a.defectos.map((d) => d.idDefecto).sort((x, y) => x - y)).toEqual(
      [idFav1, idFav25].sort((x, y) => x - y),
    );
    expect(a.defectos.every((d) => d.numFallas === 0)).toBe(true);

    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'Auditoria', idEntidad: String(a.id), accion: 'CREAR' },
    });
    expect(bitacora.idUsuario).toBe(sesion().id);
  });

  it('el contexto de la orden trae cantidad, muestra y maquilero propuesto', async () => {
    const ctx = await obtenerContextoOrden(sesion(), idOrden, bd());
    expect(ctx.cantidad).toBe(30);
    expect(ctx.muestra.resoluble).toBe(true);
    expect(ctx.muestra.tamanoMuestra).toBe(13);
    expect(ctx.maquileros.some((m) => m.id === maquilero.id && m.sugerido)).toBe(true);
  });

  it('folios consecutivos bajo concurrencia (A3, NUNCA Max()+1)', async () => {
    const [a, b, c] = await Promise.all([
      crearAuditoria(sesion(), { idOrden }, bd()),
      crearAuditoria(sesion(), { idOrden }, bd()),
      crearAuditoria(sesion(), { idOrden }, bd()),
    ]);
    const folios = [a.numAuditoria, b.numAuditoria, c.numAuditoria];
    expect(new Set(folios).size).toBe(3); // tres folios DISTINTOS.
    expect(folios.sort((x, y) => x - y)).toEqual([1, 2, 3]);
  });
});

describe('Auditorías — captura (resultado MANUAL, sugerencia informativa)', () => {
  it('persiste el resultado MANUAL aunque la sugerencia por nivel diga lo contrario', async () => {
    const a = await crearAuditoria(sesion(), { idOrden, tipoAuditoria: 'final' }, bd());
    // 5 fallas del defecto nivel 1 (Ac=0): la sugerencia es REPROBAR, pero el auditor APRUEBA a mano.
    const cap = await capturarResultado(
      sesion(),
      a.id,
      {
        resultado: 'aprobado',
        observaciones: 'Se acepta con nota de mejora',
        defectos: [
          { idDefecto: idFav1, numFallas: 5 },
          { idDefecto: idFav25, numFallas: 0 },
        ],
      },
      bd(),
    );
    expect(cap.resultado).toBe('aprobado'); // el MANUAL gana (decisión (a)).
    expect(cap.resultadoManual).toBe(true);
    expect(cap.totalFallas).toBe(5);
    // La sugerencia es informativa: nivel 1 sugiere reprobar; la global reprueba.
    const nivel1 = cap.sugerencia.niveles.find((n) => n.nivelAQL === 1);
    expect(nivel1?.totalFallas).toBe(5);
    expect(nivel1?.sugerencia).toBe('reprobar');
    expect(cap.sugerencia.sugerenciaGlobal).toBe('reprobar');
  });

  it('override de muestra enciende muestraManual y queda en bitácora', async () => {
    const a = await crearAuditoria(sesion(), { idOrden }, bd());
    expect(a.muestraManual).toBe(false);
    const cap = await capturarResultado(
      sesion(),
      a.id,
      { resultado: 'no_calificado', defectos: [], tamanoMuestra: 5 },
      bd(),
    );
    expect(cap.tamanoMuestra).toBe(5);
    expect(cap.muestraManual).toBe(true);
    const bit = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'Auditoria', idEntidad: String(a.id), accion: 'MODIFICAR' },
      orderBy: { id: 'desc' },
    });
    expect((bit.datos as { muestraSobreescrita?: unknown }).muestraSobreescrita).toBeTruthy();
  });
});

describe('Auditorías — integración con la Ruta Crítica', () => {
  it('una auditoría FINAL aprobada auto-completa el proceso `auditoria`; reprobarla lo des-completa', async () => {
    const idRuta = await crearProcesoAuditoriaRC();
    const a = await crearAuditoria(sesion(), { idOrden, tipoAuditoria: 'final' }, bd());

    await capturarResultado(sesion(), a.id, { resultado: 'aprobado', defectos: [] }, bd());
    await drenarUltimoEvento('auditoria-calidad-resuelta');
    let r = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: idRuta } });
    expect(r.estado).toBe('completado');
    expect(r.origenCaptura).toBe('evento');

    // Cambiar a REPROBADO → des-completa (decisión (f)).
    await capturarResultado(sesion(), a.id, { resultado: 'reprobado', defectos: [] }, bd());
    await drenarUltimoEvento('auditoria-calidad-resuelta');
    r = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: idRuta } });
    expect(r.estado).not.toBe('completado');
    expect(r.fechaReal).toBeNull();
  });

  it('una auditoría DE PISO aprobada NO completa el proceso (solo la final)', async () => {
    const idRuta = await crearProcesoAuditoriaRC();
    const a = await crearAuditoria(sesion(), { idOrden, tipoAuditoria: 'en_piso' }, bd());
    await capturarResultado(sesion(), a.id, { resultado: 'aprobado', defectos: [] }, bd());
    await drenarUltimoEvento('auditoria-calidad-resuelta');
    const r = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: idRuta } });
    expect(r.estado).toBe('activo'); // sigue activo (la de piso no cuenta).
  });
});

describe('Auditorías — reclasificación Primeras↔Segundas (kardex, D3)', () => {
  it('genera un TRASPASO de kardex y mueve la existencia, sin editarla', async () => {
    await sembrarExistenciaPrimeras(); // Primeras: CH 10, M 20.
    const a = await crearAuditoria(sesion(), { idOrden }, bd());

    await reclasificar(
      sesion(),
      a.id,
      {
        sentido: 'a-segundas',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 4 }] }],
      },
      bd(),
    );

    // La existencia se MOVIÓ (no se editó): Primeras CH 6, Segundas CH 4; total intacto (10).
    expect(await existenciaEnAlmacen(almPrimeras.id, tallaCH.id)).toBe(6);
    expect(await existenciaEnAlmacen(almSegundas.id, tallaCH.id)).toBe(4);

    // Se crearon DOS movimientos de traspaso (salida del origen + entrada al destino).
    const movs = await cliente.movimiento.count({
      where: { idEmpresa: empresa.id, origenTipo: ORIGEN.traspaso },
    });
    expect(movs).toBe(2);
  });

  /**
   * Fila 0.137 (hallazgo R4) — `almacenPtPorNombre` exigía el TIPO pero no el ESTADO: con Segundas
   * desactivado, la reclasificación seguía mandando prendas ahí. Ningún otro flujo acepta un
   * almacén inactivo (`exigirAlmacen`), así que esa existencia quedaba atrapada sin forma de
   * sacarla. Ahora la reclasificación se planta antes de mover nada.
   */
  it('NO reclasifica hacia un almacén DESACTIVADO (R4): se planta y no mueve kardex', async () => {
    await sembrarExistenciaPrimeras(); // Primeras: CH 10, M 20.
    const a = await crearAuditoria(sesion(), { idOrden }, bd());
    await cliente.almacen.update({ where: { id: almSegundas.id }, data: { activo: false } });
    const movimientosAntes = await cliente.movimiento.count();

    await expect(
      reclasificar(
        sesion(),
        a.id,
        {
          sentido: 'a-segundas',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 4 }] }],
        },
        bd(),
      ),
    ).rejects.toThrow(/Falta el almacén de PT "Segundas" activo/);

    // Ni un movimiento, y la existencia de Primeras intacta.
    expect(await cliente.movimiento.count()).toBe(movimientosAntes);
    expect(await existenciaEnAlmacen(almPrimeras.id, tallaCH.id)).toBe(10);
  });

  it('rechaza reclasificar más de lo que hay en el almacén origen (no-negativo, D3)', async () => {
    await sembrarExistenciaPrimeras(); // Primeras CH 10.
    const a = await crearAuditoria(sesion(), { idOrden }, bd());
    await expect(
      reclasificar(
        sesion(),
        a.id,
        {
          sentido: 'a-segundas',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 99 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('PT por orden: reclasifica SOLO lo de la orden auditada; el stock SIN orden no se toca ni cuenta', async () => {
    await sembrarExistenciaPrimeras(); // bucket de `idOrden`: Primeras CH 10.
    await sembrarSinOrdenPrimeras(5); // bucket SIN orden: Primeras CH 5 (mismo artículo, otra "bolsa").
    // Primeras CH total = 15, pero solo 10 pertenecen a la orden auditada.
    expect(await existenciaEnAlmacen(almPrimeras.id, tallaCH.id)).toBe(15);

    const a = await crearAuditoria(sesion(), { idOrden }, bd());

    // No puede mover 11 (> 10 de la orden) aunque el almacén tenga 15 en total: valida por orden.
    await expect(
      reclasificar(
        sesion(),
        a.id,
        {
          sentido: 'a-segundas',
          lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 11 }] }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Mueve 4 de la orden auditada: salen del bucket de la orden, no del bucket sin orden.
    await reclasificar(
      sesion(),
      a.id,
      {
        sentido: 'a-segundas',
        lineas: [{ idColor: colorRojo.id, tallas: [{ idTalla: tallaCH.id, cantidad: 4 }] }],
      },
      bd(),
    );

    // Bucket de la orden: Primeras 6, Segundas 4. Bucket SIN orden: Primeras 5 INTACTO.
    expect(await existenciaBucket(almPrimeras.id, tallaCH.id, idOrden)).toBe(6);
    expect(await existenciaBucket(almSegundas.id, tallaCH.id, idOrden)).toBe(4);
    expect(await existenciaBucket(almPrimeras.id, tallaCH.id, null)).toBe(5);
    expect(await existenciaBucket(almSegundas.id, tallaCH.id, null)).toBe(0);
  });
});

describe('Auditorías — consulta/listado (F6-E3)', () => {
  it('filtra por resultado y ordena determinista (numAuditoria desc)', async () => {
    const a1 = await crearAuditoria(sesion(), { idOrden, tipoAuditoria: 'final' }, bd());
    const a2 = await crearAuditoria(sesion(), { idOrden, tipoAuditoria: 'final' }, bd());
    const a3 = await crearAuditoria(sesion(), { idOrden, tipoAuditoria: 'final' }, bd());
    await capturarResultado(sesion(), a1.id, { resultado: 'aprobado', defectos: [] }, bd());
    await capturarResultado(sesion(), a2.id, { resultado: 'reprobado', defectos: [] }, bd());
    // a3 queda sin calificar.

    const todas = await listarAuditorias(sesion(), {}, bd());
    expect(todas.total).toBe(3);
    // Orden determinista: folio descendente.
    expect(todas.datos.map((a) => a.numAuditoria)).toEqual([a3, a2, a1].map((x) => x.numAuditoria));

    const soloAprobadas = await listarAuditorias(sesion(), { resultado: 'aprobado' }, bd());
    expect(soloAprobadas.total).toBe(1);
    expect(soloAprobadas.datos[0]?.id).toBe(a1.id);
  });

  it('trae Σ de fallas por fila y NO incluye canceladas por defecto', async () => {
    const a = await crearAuditoria(sesion(), { idOrden }, bd());
    await capturarResultado(
      sesion(),
      a.id,
      { resultado: 'reprobado', defectos: [{ idDefecto: idFav1, numFallas: 3 }] },
      bd(),
    );
    const b = await crearAuditoria(sesion(), { idOrden }, bd());
    await cancelarAuditoria(sesion(), b.id, { motivo: 'duplicada' }, bd());

    const vivas = await listarAuditorias(sesion(), {}, bd());
    expect(vivas.total).toBe(1);
    expect(vivas.datos[0]?.totalFallas).toBe(3);

    const conCanceladas = await listarAuditorias(sesion(), { incluirCanceladas: true }, bd());
    expect(conCanceladas.total).toBe(2);
  });

  it('lista solo con calidad.ver; sin permiso lanza ErrorPermiso', async () => {
    const sin = sesionDePrueba({ idEmpresaActiva: empresa.id });
    await expect(listarAuditorias(sin, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('Auditorías — defecto principal + AQL por auditoría (R9, KPIs vCalidad)', () => {
  it('nivelAqlPrincipal por fila = nivel del defecto con más fallas; null si no hay fallas', async () => {
    // Defecto F-1 (nivelAQL 1) con más fallas que F-25 (nivelAQL 2.5) → nivel principal = 1.
    const conFallas = await crearAuditoria(sesion(), { idOrden }, bd());
    await capturarResultado(
      sesion(),
      conFallas.id,
      {
        resultado: 'reprobado',
        defectos: [
          { idDefecto: idFav1, numFallas: 5 },
          { idDefecto: idFav25, numFallas: 2 },
        ],
      },
      bd(),
    );
    // Auditoría calificada aprobada sin fallas → nivelAqlPrincipal null.
    const sinFallas = await crearAuditoria(sesion(), { idOrden }, bd());
    await capturarResultado(sesion(), sinFallas.id, { resultado: 'aprobado', defectos: [] }, bd());

    const lista = await listarAuditorias(sesion(), {}, bd());
    const filaConFallas = lista.datos.find((a) => a.id === conFallas.id);
    const filaSinFallas = lista.datos.find((a) => a.id === sinFallas.id);
    expect(filaConFallas?.totalFallas).toBe(7);
    expect(filaConFallas?.nivelAqlPrincipal).toBe(1);
    expect(filaSinFallas?.nivelAqlPrincipal).toBeNull();
  });

  it('empate en fallas → el nivel AQL más estricto (menor)', async () => {
    const a = await crearAuditoria(sesion(), { idOrden }, bd());
    await capturarResultado(
      sesion(),
      a.id,
      {
        resultado: 'reprobado',
        defectos: [
          { idDefecto: idFav1, numFallas: 3 },
          { idDefecto: idFav25, numFallas: 3 },
        ],
      },
      bd(),
    );
    const lista = await listarAuditorias(sesion(), {}, bd());
    expect(lista.datos.find((x) => x.id === a.id)?.nivelAqlPrincipal).toBe(1);
  });

  it('resumen: defectoPrincipal = el defecto con más fallas acumuladas del conjunto filtrado', async () => {
    // F-25 acumula 6 (5+1) contra 2 de F-1 → defecto principal = F-25.
    const a1 = await crearAuditoria(sesion(), { idOrden }, bd());
    await capturarResultado(
      sesion(),
      a1.id,
      {
        resultado: 'reprobado',
        defectos: [
          { idDefecto: idFav1, numFallas: 2 },
          { idDefecto: idFav25, numFallas: 5 },
        ],
      },
      bd(),
    );
    const a2 = await crearAuditoria(sesion(), { idOrden }, bd());
    await capturarResultado(
      sesion(),
      a2.id,
      { resultado: 'reprobado', defectos: [{ idDefecto: idFav25, numFallas: 1 }] },
      bd(),
    );

    const resumen = await resumenAuditorias(sesion(), {}, bd());
    expect(resumen.defectoPrincipal?.totalFallas).toBe(6);
    expect(resumen.defectoPrincipal?.idDefecto).toBe(idFav25);
  });

  it('resumen: empate exacto de fallas → gana el idDefecto menor (desempate determinista)', async () => {
    // Los dos favoritos con la MISMA Σ de fallas (7 = 7): sin desempate el ganador sería aleatorio;
    // con el orderBy secundario por idDefecto asc gana siempre el id menor.
    const a = await crearAuditoria(sesion(), { idOrden }, bd());
    await capturarResultado(
      sesion(),
      a.id,
      {
        resultado: 'reprobado',
        defectos: [
          { idDefecto: idFav1, numFallas: 7 },
          { idDefecto: idFav25, numFallas: 7 },
        ],
      },
      bd(),
    );
    const idMenor = Math.min(idFav1, idFav25);
    const resumen = await resumenAuditorias(sesion(), {}, bd());
    expect(resumen.defectoPrincipal?.totalFallas).toBe(7);
    expect(resumen.defectoPrincipal?.idDefecto).toBe(idMenor);
  });

  it('resumen: sin fallas en el conjunto → defectoPrincipal null', async () => {
    const a = await crearAuditoria(sesion(), { idOrden }, bd());
    await capturarResultado(sesion(), a.id, { resultado: 'aprobado', defectos: [] }, bd());
    const resumen = await resumenAuditorias(sesion(), {}, bd());
    expect(resumen.defectoPrincipal).toBeNull();
  });

  it('resumen: las auditorías canceladas no cuentan por defecto', async () => {
    const viva = await crearAuditoria(sesion(), { idOrden }, bd());
    await capturarResultado(
      sesion(),
      viva.id,
      { resultado: 'reprobado', defectos: [{ idDefecto: idFav1, numFallas: 4 }] },
      bd(),
    );
    const aCancelar = await crearAuditoria(sesion(), { idOrden }, bd());
    await capturarResultado(
      sesion(),
      aCancelar.id,
      { resultado: 'reprobado', defectos: [{ idDefecto: idFav25, numFallas: 9 }] },
      bd(),
    );
    await cancelarAuditoria(sesion(), aCancelar.id, { motivo: 'duplicada' }, bd());

    const resumen = await resumenAuditorias(sesion(), {}, bd());
    // A pesar de las 9 fallas de F-25 en la cancelada, el principal vivo es F-1 con 4.
    expect(resumen.defectoPrincipal?.idDefecto).toBe(idFav1);
    expect(resumen.defectoPrincipal?.totalFallas).toBe(4);
  });

  it('resumen exige calidad.ver (deny-by-default)', async () => {
    const sin = sesionDePrueba({ idEmpresaActiva: empresa.id });
    await expect(resumenAuditorias(sin, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('Auditorías — modificar encabezado (F6-E3)', () => {
  it('cambia tipo/fechas/observaciones y deja bitácora MODIFICAR', async () => {
    const a = await crearAuditoria(sesion(), { idOrden, tipoAuditoria: 'en_piso' }, bd());
    const mod = await modificarAuditoria(
      sesion(),
      a.id,
      { tipoAuditoria: 'final', fechaAuditoria: '2026-07-15', observaciones: 'revisada' },
      bd(),
    );
    expect(mod.tipoAuditoria).toBe('final');
    expect(mod.fechaAuditoria).toBe('2026-07-15');
    expect(mod.observaciones).toBe('revisada');
    const bit = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'Auditoria', idEntidad: String(a.id), accion: 'MODIFICAR' },
      orderBy: { id: 'desc' },
    });
    expect((bit.datos as { operacion?: string }).operacion).toBe('modificar-datos');
  });

  it('rechaza un maquilero que no participó en la orden (ErrorValidacion)', async () => {
    const otro = await crearProveedorConRol('Ajeno SA', 'maquila-estampado');
    const a = await crearAuditoria(sesion(), { idOrden }, bd());
    await expect(
      modificarAuditoria(sesion(), a.id, { idMaquilero: otro.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('exige calidad.modificar-auditorias (deny-by-default)', async () => {
    const soloVer = sesionDePrueba({
      idEmpresaActiva: empresa.id,
      permisos: ['calidad.ver', 'calidad.generar-auditorias'],
    });
    const a = await crearAuditoria(soloVer, { idOrden }, bd());
    await expect(
      modificarAuditoria(soloVer, a.id, { observaciones: 'x' }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('no permite modificar una auditoría cancelada (ErrorConflicto)', async () => {
    const a = await crearAuditoria(sesion(), { idOrden }, bd());
    await cancelarAuditoria(sesion(), a.id, { motivo: 'error' }, bd());
    await expect(
      modificarAuditoria(sesion(), a.id, { observaciones: 'x' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('cambiar el TIPO re-evalúa la RC: final aprobada (completada) → en_piso la des-completa', async () => {
    const idRuta = await crearProcesoAuditoriaRC();
    const a = await crearAuditoria(sesion(), { idOrden, tipoAuditoria: 'final' }, bd());
    await capturarResultado(sesion(), a.id, { resultado: 'aprobado', defectos: [] }, bd());
    await drenarUltimoEvento('auditoria-calidad-resuelta');
    let r = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: idRuta } });
    expect(r.estado).toBe('completado');

    // Al bajar el tipo a en_piso, ya no hay auditoría FINAL aprobada viva → des-completa.
    await modificarAuditoria(sesion(), a.id, { tipoAuditoria: 'en_piso' }, bd());
    await drenarUltimoEvento('auditoria-calidad-resuelta');
    r = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: idRuta } });
    expect(r.estado).not.toBe('completado');
    expect(r.fechaReal).toBeNull();
  });
});

describe('Auditorías — cancelar (borrado suave, F6-E3)', () => {
  it('marca cancelada, anexa el motivo a observaciones y lo deja en bitácora', async () => {
    const a = await crearAuditoria(sesion(), { idOrden }, bd());
    const cancelada = await cancelarAuditoria(sesion(), a.id, { motivo: 'orden duplicada' }, bd());
    expect(cancelada.cancelada).toBe(true);
    expect(cancelada.observaciones).toContain('orden duplicada');

    const bit = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'Auditoria', idEntidad: String(a.id), accion: 'CANCELAR' },
    });
    expect((bit.datos as { motivo?: string }).motivo).toBe('orden duplicada');

    // No se puede cancelar dos veces.
    await expect(
      cancelarAuditoria(sesion(), a.id, { motivo: 'otra vez' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('exige calidad.modificar-auditorias (deny-by-default)', async () => {
    const soloVer = sesionDePrueba({
      idEmpresaActiva: empresa.id,
      permisos: ['calidad.ver', 'calidad.generar-auditorias'],
    });
    const a = await crearAuditoria(soloVer, { idOrden }, bd());
    await expect(cancelarAuditoria(soloVer, a.id, { motivo: 'x' }, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('des-completa el proceso `auditoria` de la RC al cancelar una FINAL aprobada', async () => {
    const idRuta = await crearProcesoAuditoriaRC();
    const a = await crearAuditoria(sesion(), { idOrden, tipoAuditoria: 'final' }, bd());
    await capturarResultado(sesion(), a.id, { resultado: 'aprobado', defectos: [] }, bd());
    await drenarUltimoEvento('auditoria-calidad-resuelta');
    let r = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: idRuta } });
    expect(r.estado).toBe('completado');

    await cancelarAuditoria(sesion(), a.id, { motivo: 'se rehará' }, bd());
    await drenarUltimoEvento('auditoria-calidad-resuelta');
    r = await cliente.rutaOrden.findUniqueOrThrow({ where: { id: idRuta } });
    expect(r.estado).not.toBe('completado');
    expect(r.fechaReal).toBeNull();
  });
});

describe('Auditorías — historial por maquilero (F6-E3)', () => {
  it('% de aprobación = aprobadas / calificadas (1 aprobada + 1 reprobada = 50)', async () => {
    const a1 = await crearAuditoria(sesion(), { idOrden }, bd());
    const a2 = await crearAuditoria(sesion(), { idOrden }, bd());
    await crearAuditoria(sesion(), { idOrden }, bd()); // sin calificar → NO cuenta en el porcentaje.
    await capturarResultado(sesion(), a1.id, { resultado: 'aprobado', defectos: [] }, bd());
    await capturarResultado(sesion(), a2.id, { resultado: 'reprobado', defectos: [] }, bd());

    const h = await historialPorMaquilero(sesion(), { idMaquilero: maquilero.id }, bd());
    expect(h.total).toBe(3);
    expect(h.aprobadas).toBe(1);
    expect(h.reprobadas).toBe(1);
    expect(h.noCalificadas).toBe(1);
    expect(h.porcentajeAprobacion).toBe(50);
    expect(h.auditorias).toHaveLength(3);
  });

  it('sin auditorías calificadas → porcentaje null; canceladas no cuentan', async () => {
    const a = await crearAuditoria(sesion(), { idOrden }, bd());
    await capturarResultado(sesion(), a.id, { resultado: 'aprobado', defectos: [] }, bd());
    await cancelarAuditoria(sesion(), a.id, { motivo: 'anulada' }, bd());

    const h = await historialPorMaquilero(sesion(), { idMaquilero: maquilero.id }, bd());
    expect(h.total).toBe(0);
    expect(h.porcentajeAprobacion).toBeNull();
  });

  it('maquilero inexistente → ErrorNoEncontrado', async () => {
    await expect(
      historialPorMaquilero(sesion(), { idMaquilero: 999999 }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});
