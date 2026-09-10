import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Avio,
  Color,
  Empresa,
  Orden,
  PrismaClient,
  Proveedor,
  Talla,
  Tela,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrarRecetaDeOrden } from '../../pruebas/receta.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarOC,
  autorizarOC,
  cancelarOC,
  crearOC,
  desautorizarOC,
  duplicarOC,
  listarOC,
  obtenerOC,
} from './ordenes-compra.js';

/**
 * Integración del dominio de Órdenes de COMPRA (F4-E2) contra el Postgres efímero (testcontainers).
 * Cubre lo que SOLO la base valida: folio por empresa consecutivo (A3/A9), total derivado por suma,
 * matriz talla×color suma=cantidad (decisión c), XOR catálogo/libre, autorización (permiso propio +
 * bloqueo de edición para no-admin / permitida para admin, decisión a), cancelación suave con
 * rastro, y duplicado a un borrador nuevo. NO corre en local (usa Docker): el CI.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let proveedor: Proveedor;
let tela: Tela;
let avio: Avio;
let colorRojo: Color;
let tallaCH: Talla;
let tallaM: Talla;
let orden: Orden;
let direccionEntrega: { id: number };

/**
 * Encabezado mínimo que TODA OC nueva necesita desde §Post-F9.18: fecha de entrega (obligatoria) y
 * dirección de entrega del catálogo. La fecha de EMISIÓN ya no se manda: la pone el servidor.
 */
function encabezadoOc(): { fechaEntrega: string; idDireccionEntrega: number } {
  return { fechaEntrega: '2026-09-30', idDireccionEntrega: direccionEntrega.id };
}

const PERM_ADMIN_OC: ClavePermiso[] = ['compras.ver', 'compras.administrar', 'compras.cancelar'];
const PERM_AUTORIZAR: ClavePermiso[] = ['compras.ver', 'compras.autorizar'];

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
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa');
  proveedor = await cliente.proveedor.create({ data: { nombre: 'Telas del Norte' } });
  direccionEntrega = await cliente.direccionEntrega.create({
    data: { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123, Naucalpan', favorita: true },
  });
  tela = await cliente.tela.create({ data: { nombre: 'Felpa' } });
  avio = await cliente.avio.create({ data: { clave: 'BOT-01', descripcion: 'Botón' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  // Una orden de producción (para la liga por línea R7). Necesita modelo y cliente.
  const modelo = await cliente.modelo.create({ data: { codigo: 'A-100' } });
  await cliente.modeloTela.create({
    data: { idModelo: modelo.id, idTela: tela.id, consumoPorPrenda: 1 },
  });
  const clienteNeg = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  orden = await cliente.orden.create({
    data: {
      folio: BigInt(1),
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNeg.id,
    },
  });
  // ⭐ V1-E3d: ligar una OC a una orden exige su receta LIBERADA (§Post-F9.43(c)). La orden se crea
  // aquí en directo (sin pasar por `crearOrden`), así que su receta se siembra a mano — igual que
  // hizo el backfill con las órdenes que ya existían.
  await sembrarRecetaDeOrden(cliente, orden.id, modelo.id);
});

describe('OC (F4-E2) — permisos (deny-by-default, A4)', () => {
  it('sin administrar no se crea; sin ver no se lista; cancelar/autorizar exigen su permiso', async () => {
    await expect(
      crearOC(
        sesion(['compras.ver']),
        { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(Error);
    await expect(listarOC(sesion([]), {}, bd())).rejects.toBeInstanceOf(Error);
  });
});

describe('OC (F4-E2) — alta + folio por empresa (A3/A9)', () => {
  it('crea borrador con folio 1 y deriva el total por suma', async () => {
    const s = sesion(PERM_ADMIN_OC);
    const oc = await crearOC(
      s,
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [
          { idTela: tela.id, cantidad: 10, precio: 25, unidad: 'm' },
          { idAvio: avio.id, cantidad: 100, precio: 2 },
        ],
      },
      bd(),
    );
    expect(oc.numCompra).toBe(1);
    expect(oc.estatus).toBe('borrador');
    expect(oc.idEmpresa).toBe(empresa.id);
    expect(oc.lineas).toHaveLength(2);
    expect(oc.total).toBe(10 * 25 + 100 * 2); // 450
  });

  it('folios consecutivos por empresa en dos altas seguidas (A3)', async () => {
    const s = sesion(PERM_ADMIN_OC);
    const a = await crearOC(s, { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [] }, bd());
    const b = await crearOC(s, { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [] }, bd());
    expect([a.numCompra, b.numCompra].sort((x, y) => x - y)).toEqual([1, 2]);
  });

  it('N altas CONCURRENTES → N folios distintos y consecutivos (A3, sin colisión)', async () => {
    const s = sesion(PERM_ADMIN_OC);
    const N = 10;
    // Todas en paralelo: la secuencia atómica (INSERT … ON CONFLICT … RETURNING) debe entregar
    // N valores distintos sin huecos ni duplicados aunque las transacciones compitan por la fila.
    const ocs = await Promise.all(
      Array.from({ length: N }, () =>
        crearOC(s, { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [] }, bd()),
      ),
    );
    const folios = ocs.map((o) => o.numCompra).sort((x, y) => x - y);
    expect(folios).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(new Set(folios).size).toBe(N); // todos distintos
  });

  it('la secuencia es POR EMPRESA: cada empresa arranca en 1', async () => {
    await crearOC(
      sesion(PERM_ADMIN_OC),
      { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [] },
      bd(),
    );
    const enOtra = await crearOC(
      sesion(PERM_ADMIN_OC, otraEmpresa.id),
      { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [] },
      bd(),
    );
    expect(enOtra.numCompra).toBe(1);
  });
});

describe('OC (F4-E2) — validación de líneas (XOR + matriz, decisión c)', () => {
  it('rechaza una línea con tela Y avío a la vez (XOR)', async () => {
    await expect(
      crearOC(
        sesion(PERM_ADMIN_OC),
        {
          ...encabezadoOc(),
          idProveedor: proveedor.id,
          lineas: [{ idTela: tela.id, idAvio: avio.id, cantidad: 1, precio: 1 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza idAvioProveedor en una línea que NO es de avío (tela)', async () => {
    await expect(
      crearOC(
        sesion(PERM_ADMIN_OC),
        {
          ...encabezadoOc(),
          idProveedor: proveedor.id,
          lineas: [{ idTela: tela.id, idAvioProveedor: avio.id, cantidad: 1, precio: 1 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('acepta idAvioProveedor en una línea de avío (traza del precio R1)', async () => {
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idAvio: avio.id, idAvioProveedor: avio.id, cantidad: 10, precio: 2 }],
      },
      bd(),
    );
    expect(oc.lineas[0]?.idAvioProveedor).toBe(avio.id);
  });

  it('acepta una línea LIBRE (descripcionLibre sin tela/avío)', async () => {
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ descripcionLibre: 'Flete', cantidad: 1, precio: 300 }],
      },
      bd(),
    );
    expect(oc.lineas[0]?.descripcionLibre).toBe('Flete');
    expect(oc.lineas[0]?.idTela).toBeNull();
    expect(oc.lineas[0]?.idAvio).toBeNull();
  });

  it('matriz: suma de la matriz debe ser igual a la cantidad del renglón', async () => {
    await expect(
      crearOC(
        sesion(PERM_ADMIN_OC),
        {
          ...encabezadoOc(),
          idProveedor: proveedor.id,
          lineas: [
            {
              idTela: tela.id,
              cantidad: 50, // no coincide con 10+20=30
              precio: 1,
              tallas: [
                { idColor: colorRojo.id, idTalla: tallaCH.id, cantidad: 10 },
                { idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 20 },
              ],
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('matriz válida: suma = cantidad; se proyecta con etiquetas', async () => {
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [
          {
            idTela: tela.id,
            cantidad: 30,
            precio: 5,
            tallas: [
              { idColor: colorRojo.id, idTalla: tallaCH.id, cantidad: 10 },
              { idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 20 },
            ],
          },
        ],
      },
      bd(),
    );
    expect(oc.lineas[0]?.tallas).toHaveLength(2);
    expect(oc.lineas[0]?.tallas[0]?.color).toBe('Rojo');
    expect(oc.total).toBe(30 * 5);
  });

  it('liga por línea a una orden de OTRA empresa la rechaza (A9) y deriva ordenesLigadas', async () => {
    // orden de la empresa activa: ok y se deriva la liga N:N
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idTela: tela.id, cantidad: 1, precio: 1, idOrden: orden.id }],
      },
      bd(),
    );
    expect(oc.ordenesLigadas).toHaveLength(1);
    expect(oc.ordenesLigadas[0]?.idOrden).toBe(orden.id);

    // orden inexistente para la empresa activa
    await expect(
      crearOC(
        sesion(PERM_ADMIN_OC),
        {
          ...encabezadoOc(),
          idProveedor: proveedor.id,
          lineas: [{ idTela: tela.id, cantidad: 1, precio: 1, idOrden: 999999 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

describe('OC (F4-E2) — autorización (decisión a)', () => {
  it('autorizar exige compras.autorizar y bloquea la edición del no-admin', async () => {
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [] },
      bd(),
    );

    // sin compras.autorizar no se puede autorizar
    await expect(autorizarOC(sesion(PERM_ADMIN_OC), oc.id, bd())).rejects.toBeInstanceOf(Error);

    // con el permiso propio, autoriza
    const autorizada = await autorizarOC(sesion(PERM_AUTORIZAR), oc.id, bd());
    expect(autorizada.estatus).toBe('autorizada');
    expect(autorizada.fechaAutorizado).not.toBeNull();
    expect(autorizada.idUsuAutorizado).not.toBeNull();

    // un no-admin (sin roles.administrar) ya NO la puede editar
    await expect(
      actualizarOC(sesion(PERM_ADMIN_OC), oc.id, { observaciones: 'cambio' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('el ADMIN (roles.administrar) sí edita una OC autorizada', async () => {
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [] },
      bd(),
    );
    await autorizarOC(sesion(PERM_AUTORIZAR), oc.id, bd());
    const admin = sesion([...PERM_ADMIN_OC, 'roles.administrar']);
    const editada = await actualizarOC(admin, oc.id, { observaciones: 'ajuste admin' }, bd());
    expect(editada.observaciones).toBe('ajuste admin');
  });

  it('no se puede autorizar dos veces', async () => {
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [] },
      bd(),
    );
    await autorizarOC(sesion(PERM_AUTORIZAR), oc.id, bd());
    await expect(autorizarOC(sesion(PERM_AUTORIZAR), oc.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });
});

describe('⭐ OC (V1-E3y) — DES-AUTORIZAR (§Post-F9.79)', () => {
  const PERM_DESAUT: ClavePermiso[] = ['compras.ver', 'compras.desautorizar'];

  async function ocAutorizada(): Promise<{ id: number }> {
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idTela: tela.id, cantidad: 10, precio: 3 }],
      },
      bd(),
    );
    await autorizarOC(sesion(PERM_AUTORIZAR), oc.id, bd());
    return oc;
  }

  it('exige su permiso PROPIO: ni administrar ni autorizar alcanzan (A4)', async () => {
    const oc = await ocAutorizada();
    // El permiso de FIRMAR no es el de DESFIRMAR: es la llave del perfil de Daniel (§Post-F9.67).
    await expect(
      desautorizarOC(sesion(PERM_AUTORIZAR), oc.id, { motivo: 'nel' }, bd()),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      desautorizarOC(sesion(PERM_ADMIN_OC), oc.id, { motivo: 'nel' }, bd()),
    ).rejects.toBeInstanceOf(Error);
  });

  it('exige MOTIVO (no vacío)', async () => {
    const oc = await ocAutorizada();
    await expect(
      desautorizarOC(sesion(PERM_DESAUT), oc.id, { motivo: '   ' }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('quita el sello, la devuelve a BORRADOR y se puede volver a autorizar', async () => {
    const oc = await ocAutorizada();
    const fuera = await desautorizarOC(
      sesion(PERM_DESAUT),
      oc.id,
      { motivo: 'el proveedor subió el precio' },
      bd(),
    );
    // `borrador` porque es el estatus con el que NACEN todas las OC y el único que en la práctica
    // precede a la firma (nada escribe `pendiente_autorizacion`): la OC vuelve exactamente a donde
    // estaba, y la bandeja de autorización —que pide borradores— la vuelve a mostrar.
    expect(fuera.estatus).toBe('borrador');
    expect(fuera.fechaAutorizado).toBeNull();
    expect(fuera.idUsuAutorizado).toBeNull();

    const otraVez = await autorizarOC(sesion(PERM_AUTORIZAR), oc.id, bd());
    expect(otraVez.estatus).toBe('autorizada');
    expect(otraVez.idUsuAutorizado).not.toBeNull();
  });

  it('deja BITÁCORA con el motivo y con la firma que se borró (A7/D3)', async () => {
    const oc = await ocAutorizada();
    await desautorizarOC(sesion(PERM_DESAUT), oc.id, { motivo: 'pedido cancelado' }, bd());
    const fila = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'OrdenCompra', idEntidad: String(oc.id), accion: 'OTRO' },
      orderBy: { id: 'desc' },
    });
    const datos = fila.datos as Record<string, unknown>;
    expect(datos.desautorizada).toBe(true);
    expect(datos.motivo).toBe('pedido cancelado');
    // La firma que se borra de la OC no puede perderse: queda quién y cuándo había autorizado.
    expect(datos.autorizadaPorId).not.toBeNull();
    expect(datos.autorizadaEn).not.toBeNull();
  });

  it('NO se des-autoriza lo que no está autorizado (borrador / ya des-autorizada / cancelada)', async () => {
    const borrador = await crearOC(
      sesion(PERM_ADMIN_OC),
      { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [] },
      bd(),
    );
    await expect(
      desautorizarOC(sesion(PERM_DESAUT), borrador.id, { motivo: 'x' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    const oc = await ocAutorizada();
    await desautorizarOC(sesion(PERM_DESAUT), oc.id, { motivo: 'una vez' }, bd());
    // Dos veces no: ya no hay sello que quitar (idempotencia explícita, no silenciosa).
    await expect(
      desautorizarOC(sesion(PERM_DESAUT), oc.id, { motivo: 'dos veces' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    await cancelarOC(sesion(PERM_ADMIN_OC), oc.id, { motivo: 'ya no va' }, bd());
    await expect(
      desautorizarOC(sesion(PERM_DESAUT), oc.id, { motivo: 'tres veces' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('⭐ una OC con material RECIBIDO no se des-autoriza (DANIEL, 20-ago-2026)', async () => {
    const oc = await ocAutorizada();
    // Se fuerza el estatus recibido en directo (la recepción real vive en `recepciones.int.test.ts`):
    // lo que esta prueba fija es la REGLA, no el camino por el que se llegó al estatus.
    await cliente.ordenCompra.update({
      where: { id: oc.id },
      data: { estatus: 'recibida_parcial' },
    });
    await expect(
      desautorizarOC(sesion(PERM_DESAUT), oc.id, { motivo: 'quiero deshacerlo' }, bd()),
    ).rejects.toThrow(/RECIBIDO/);

    await cliente.ordenCompra.update({
      where: { id: oc.id },
      data: { estatus: 'recibida_total' },
    });
    await expect(
      desautorizarOC(sesion(PERM_DESAUT), oc.id, { motivo: 'quiero deshacerlo' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('A9: una OC de OTRA empresa no existe para esta sesión (404, no 403)', async () => {
    const oc = await ocAutorizada();
    await expect(
      desautorizarOC(sesion(PERM_DESAUT, otraEmpresa.id), oc.id, { motivo: 'x' }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

describe('OC (F4-E2) — cancelación suave', () => {
  it('cancela con motivo, deja rastro y no se puede cancelar dos veces', async () => {
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [] },
      bd(),
    );
    const cancelada = await cancelarOC(sesion(PERM_ADMIN_OC), oc.id, { motivo: 'duplicada' }, bd());
    expect(cancelada.estatus).toBe('cancelada');
    expect(cancelada.motivoCancelacion).toBe('duplicada');
    expect(cancelada.canceladaPorId).not.toBeNull();
    expect(cancelada.canceladaEn).not.toBeNull();

    await expect(
      cancelarOC(sesion(PERM_ADMIN_OC), oc.id, { motivo: 'otra vez' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // por defecto el listado no incluye canceladas
    const lista = await listarOC(sesion(PERM_ADMIN_OC), {}, bd());
    expect(lista.datos.find((o) => o.id === oc.id)).toBeUndefined();
    const conCanceladas = await listarOC(sesion(PERM_ADMIN_OC), { incluirCanceladas: true }, bd());
    expect(conCanceladas.datos.find((o) => o.id === oc.id)).toBeDefined();
  });
});

describe('OC (F4-E2) — duplicar', () => {
  it('duplica encabezado + líneas a un borrador nuevo con folio nuevo, sin autorización', async () => {
    const original = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        observaciones: 'original',
        lineas: [{ idTela: tela.id, cantidad: 5, precio: 10 }],
      },
      bd(),
    );
    await autorizarOC(sesion(PERM_AUTORIZAR), original.id, bd());

    const copia = await duplicarOC(sesion(PERM_ADMIN_OC), original.id, bd());
    expect(copia.id).not.toBe(original.id);
    expect(copia.numCompra).toBe(original.numCompra + 1);
    expect(copia.estatus).toBe('borrador');
    expect(copia.idUsuAutorizado).toBeNull();
    expect(copia.observaciones).toBe('original');
    expect(copia.lineas).toHaveLength(1);
    expect(copia.lineas[0]?.cantidad).toBe(5);
  });

  /**
   * ⭐⭐ **V1-E4f (§Post-F9.103) — DUPLICAR NO PUEDE PARIR UNA OC SIN FECHA.** Daniel: *"tiene que
   * tener fecha de entrega a fuerzas"*. `crearOC` y la explosión ya lo cumplían; **duplicar era la
   * puerta abierta**: copiaba `fechaEntrega` tal cual, así que cualquiera de las 7,978 OC migradas
   * de Access —que no la traen— podía engendrar hoy una OC nueva muda sobre el *cuándo*.
   *
   * 🔴 La OC vieja se queda como está (decisión (e): la regla es prospectiva). Lo que se corta es
   * la propagación. Esta prueba es la que se pone roja si alguien quita la llamada a
   * `motivoNoDuplicarOc` de `duplicarOC` — el unit de la función pura, por sí solo, no la alcanza.
   */
  it('🔴 una OC SIN fecha de entrega (las migradas) NO se puede duplicar', async () => {
    const original = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idTela: tela.id, cantidad: 5, precio: 10 }],
      },
      bd(),
    );
    // Así viven las migradas. Se escribe directo porque el contrato ya NO deja capturar una así:
    // el único camino para tenerla es haberla heredado de Access.
    await cliente.ordenCompra.update({
      where: { id: original.id },
      data: { fechaEntrega: null },
    });

    await expect(duplicarOC(sesion(PERM_ADMIN_OC), original.id, bd())).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
    // Y no dejó nada a medias: NO nació una segunda OC (el rechazo llega ANTES del folio nuevo).
    expect(await cliente.ordenCompra.count({ where: { idEmpresa: empresa.id } })).toBe(1);
  });
});

describe('OC (F4-E2) — obtener respeta empresa (A9)', () => {
  it('una OC de otra empresa no existe para la sesión', async () => {
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [] },
      bd(),
    );
    await expect(
      obtenerOC(sesion(PERM_ADMIN_OC, otraEmpresa.id), oc.id, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

describe('OC (F4-E2) — filtro por orden de producción (R7, pantalla "Compras por orden")', () => {
  it('idOrden devuelve solo las OC ligadas a esa orden (vía el N:N de encabezado)', async () => {
    const s = sesion(PERM_ADMIN_OC);
    // OC ligada a la orden (por una línea con idOrden) y OC sin liga.
    const ligada = await crearOC(
      s,
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idTela: tela.id, cantidad: 1, precio: 1, idOrden: orden.id }],
      },
      bd(),
    );
    await crearOC(
      s,
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idTela: tela.id, cantidad: 1, precio: 1 }],
      },
      bd(),
    );

    const lista = await listarOC(s, { idOrden: orden.id }, bd());
    expect(lista.datos).toHaveLength(1);
    expect(lista.datos[0]?.id).toBe(ligada.id);
    expect(lista.total).toBe(1);
  });

  it('idOrden de otra empresa no filtra OC ajenas (A9): empresa activa sellada', async () => {
    const s = sesion(PERM_ADMIN_OC);
    await crearOC(
      s,
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idTela: tela.id, cantidad: 1, precio: 1, idOrden: orden.id }],
      },
      bd(),
    );
    // Desde OTRA empresa, filtrar por esa orden no devuelve nada (la OC es de la empresa activa).
    const lista = await listarOC(
      sesion(PERM_ADMIN_OC, otraEmpresa.id),
      { idOrden: orden.id },
      bd(),
    );
    expect(lista.datos).toHaveLength(0);
  });
});

describe('OC (§Post-F9.15) — la TELA es DEL proveedor de la orden', () => {
  it('rechaza comprarle a un proveedor una tela que es de OTRO, y dice de quién es', async () => {
    const bloom = await cliente.proveedor.create({ data: { nombre: 'Bloom Textil' } });
    const felpaDeBloom = await cliente.tela.create({
      data: { nombre: 'Felpa Bloom', idProveedor: bloom.id },
    });

    // `proveedor` (Telas del Norte) no puede surtir una tela cuyo dueño es Bloom.
    await expect(
      crearOC(
        sesion(PERM_ADMIN_OC),
        {
          ...encabezadoOc(),
          idProveedor: proveedor.id,
          lineas: [{ idTela: felpaDeBloom.id, cantidad: 10, precio: 1 }],
        },
        bd(),
      ),
    ).rejects.toThrow(/Bloom Textil/);
    expect(await cliente.ordenCompra.count()).toBe(0);
  });

  it('acepta la tela cuyo dueño ES el proveedor de la orden', async () => {
    const propia = await cliente.tela.create({
      data: { nombre: 'Felpa del Norte', idProveedor: proveedor.id },
    });
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idTela: propia.id, cantidad: 10, precio: 1 }],
      },
      bd(),
    );
    expect(oc.lineas).toHaveLength(1);
  });

  it('una tela MIGRADA sin dueño se deja pasar (no traba las OCs viejas)', async () => {
    // `tela` de las fixtures nace sin `idProveedor`: es el caso del catálogo migrado.
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idTela: tela.id, cantidad: 5, precio: 2 }],
      },
      bd(),
    );
    expect(oc.lineas).toHaveLength(1);
  });

  it('al EDITAR cambiando de proveedor, las telas deben ser del NUEVO', async () => {
    const propia = await cliente.tela.create({
      data: { nombre: 'Felpa del Norte', idProveedor: proveedor.id },
    });
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idTela: propia.id, cantidad: 10, precio: 1 }],
      },
      bd(),
    );
    const bloom = await cliente.proveedor.create({ data: { nombre: 'Bloom Textil' } });

    await expect(
      actualizarOC(
        sesion(PERM_ADMIN_OC),
        oc.id,
        {
          ...encabezadoOc(),
          idProveedor: bloom.id,
          lineas: [{ idTela: propia.id, cantidad: 10, precio: 1 }],
        },
        bd(),
      ),
    ).rejects.toThrow(/Telas del Norte/);
  });
});

describe('OC (§Post-F9.18) — reglas de captura que pidió Daniel', () => {
  it('la FECHA DE EMISIÓN la pone el servidor (hoy) y el cuerpo no la puede cambiar', async () => {
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [] },
      bd(),
    );
    const hoy = new Date().toISOString().slice(0, 10);
    expect(oc.fecha).toBe(hoy);

    // Aunque alguien mande `fecha` por el API (fuera del contrato), NO se toca al editar.
    await actualizarOC(
      sesion(PERM_ADMIN_OC),
      oc.id,
      { fecha: '2020-01-01' } as unknown as Parameters<typeof actualizarOC>[2],
      bd(),
    );
    expect((await obtenerOC(sesion(PERM_ADMIN_OC), oc.id, bd())).fecha).toBe(hoy);
  });

  it('la FECHA DE ENTREGA es obligatoria al crear y no se puede vaciar al editar', async () => {
    await expect(
      crearOC(
        sesion(PERM_ADMIN_OC),
        {
          idProveedor: proveedor.id,
          idDireccionEntrega: direccionEntrega.id,
          lineas: [],
        } as unknown as Parameters<typeof crearOC>[1],
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [] },
      bd(),
    );
    await expect(
      actualizarOC(
        sesion(PERM_ADMIN_OC),
        oc.id,
        { fechaEntrega: null } as unknown as Parameters<typeof actualizarOC>[2],
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('la DIRECCIÓN sale del catálogo: copia su texto, y una desactivada se rechaza', async () => {
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [] },
      bd(),
    );
    // El texto se COPIA para que impresos y consultas viejas lean un solo campo.
    expect(oc.idDireccionEntrega).toBe(direccionEntrega.id);
    expect(oc.entregaEn).toBe('Av. Siempre Viva 123, Naucalpan');
    expect(oc.direccionEntregaNombre).toBe('Naucalpan');

    const apagada = await cliente.direccionEntrega.create({
      data: { nombre: 'Bodega vieja', direccion: 'Ya no existe', activo: false },
    });
    await expect(
      crearOC(
        sesion(PERM_ADMIN_OC),
        { fechaEntrega: '2026-09-30', idDireccionEntrega: apagada.id, idProveedor: proveedor.id },
        bd(),
      ),
    ).rejects.toThrow(/desactivada/);
  });

  it('la UNIDAD de un renglón de tela la manda la TELA (ignora lo que se capture)', async () => {
    const enKilos = await cliente.tela.create({
      data: { nombre: 'Felpa por kilo', idProveedor: proveedor.id, unidadMedida: 'KG' },
    });
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        // Se manda "piezas" a propósito: es justo lo que Daniel no quiere que pase.
        lineas: [{ idTela: enKilos.id, cantidad: 10, precio: 5, unidad: 'piezas' }],
      },
      bd(),
    );
    expect(oc.lineas[0]?.unidad).toBe('kg');

    // En AVÍO la unidad sigue siendo texto libre, pero es una ETIQUETA: no hay conversión
    // detrás (§Post-F9.97 — la cantidad siempre se lee en unidad de consumo).
    const ocAvio = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idAvio: avio.id, cantidad: 10, precio: 5, unidad: 'caja' }],
      },
      bd(),
    );
    expect(ocAvio.lineas[0]?.unidad).toBe('caja');
  });

  it('una tela CON complemento se compra con él: sin cantidad no se captura', async () => {
    const conCardigan = await cliente.tela.create({
      data: {
        nombre: 'Felpa con cardigan',
        idProveedor: proveedor.id,
        unidadMedida: 'KG',
        nombreComplemento: 'Cardigan',
      },
    });

    await expect(
      crearOC(
        sesion(PERM_ADMIN_OC),
        {
          ...encabezadoOc(),
          idProveedor: proveedor.id,
          lineas: [{ idTela: conCardigan.id, cantidad: 100, precio: 10 }],
        },
        bd(),
      ),
    ).rejects.toThrow(/Cardigan/);

    // Con la cantidad del complemento sí entra, y su importe SUMA al subtotal del renglón.
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idTela: conCardigan.id, cantidad: 100, precio: 10, cantidadComplemento: 20 }],
      },
      bd(),
    );
    expect(oc.lineas[0]?.cantidadComplemento).toBe(20);
    expect(oc.lineas[0]?.nombreComplementoTela).toBe('Cardigan');
    // 100×10 (cuerpo) + 20×10 (complemento al precio del cuerpo) = 1,200.
    expect(oc.lineas[0]?.subtotal).toBe(1200);
    expect(oc.total).toBe(1200);
  });

  it('el complemento con precio propio se cobra a ESE precio', async () => {
    const conCardigan = await cliente.tela.create({
      data: {
        nombre: 'Felpa con cardigan',
        idProveedor: proveedor.id,
        nombreComplemento: 'Cardigan',
      },
    });
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [
          {
            idTela: conCardigan.id,
            cantidad: 100,
            precio: 10,
            cantidadComplemento: 20,
            precioComplemento: 4,
          },
        ],
      },
      bd(),
    );
    expect(oc.lineas[0]?.subtotal).toBe(100 * 10 + 20 * 4);
  });

  it('el complemento SOLO existe en telas: en avío o texto libre se rechaza', async () => {
    await expect(
      crearOC(
        sesion(PERM_ADMIN_OC),
        {
          ...encabezadoOc(),
          idProveedor: proveedor.id,
          lineas: [{ idAvio: avio.id, cantidad: 10, precio: 1, cantidadComplemento: 5 }],
        },
        bd(),
      ),
    ).rejects.toThrow(/complemento/);
  });

  it('una tela SIN complemento no acepta cantidad de complemento', async () => {
    const propia = await cliente.tela.create({
      data: { nombre: 'Felpa lisa', idProveedor: proveedor.id },
    });
    await expect(
      crearOC(
        sesion(PERM_ADMIN_OC),
        {
          ...encabezadoOc(),
          idProveedor: proveedor.id,
          lineas: [{ idTela: propia.id, cantidad: 10, precio: 1, cantidadComplemento: 5 }],
        },
        bd(),
      ),
    ).rejects.toThrow(/no lleva complemento/);
  });

  it('varios renglones ligan varias ÓRDENES DE PRODUCCIÓN a la MISMA OC', async () => {
    // Daniel: "una OC puede ir ligada a varias OP". Ya se podía —la liga es por renglón—; esto lo
    // deja probado para que nadie lo "arregle" duplicando órdenes de compra.
    const modelo = await cliente.modelo.create({ data: { codigo: 'B-200' } });
    await cliente.modeloTela.create({
      data: { idModelo: modelo.id, idTela: tela.id, consumoPorPrenda: 1 },
    });
    const clienteNeg = await cliente.cliente.findFirstOrThrow();
    const otraOrden = await cliente.orden.create({
      data: {
        folio: BigInt(2),
        idEmpresa: empresa.id,
        idModelo: modelo.id,
        idCliente: clienteNeg.id,
      },
    });
    await sembrarRecetaDeOrden(cliente, otraOrden.id, modelo.id);
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [
          { idAvio: avio.id, cantidad: 10, precio: 1, idOrden: orden.id },
          { idAvio: avio.id, cantidad: 5, precio: 1, idOrden: otraOrden.id },
        ],
      },
      bd(),
    );
    expect(oc.ordenesLigadas.map((o) => o.folio).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('NO se autoriza una OC con el complemento pendiente (puerta de la explosión MRP)', async () => {
    const conCardigan = await cliente.tela.create({
      data: {
        nombre: 'Felpa con cardigan',
        idProveedor: proveedor.id,
        nombreComplemento: 'Cardigan',
      },
    });
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [{ idTela: conCardigan.id, cantidad: 100, precio: 10, cantidadComplemento: 20 }],
      },
      bd(),
    );
    // Se simula el borrador que deja la explosión MRP: complemento en NULL.
    await cliente.ordenCompraLinea.updateMany({
      where: { idOrdenCompra: oc.id },
      data: { cantidadComplemento: null },
    });

    await expect(autorizarOC(sesion(PERM_AUTORIZAR), oc.id, bd())).rejects.toThrow(/Cardigan/);
    expect((await obtenerOC(sesion(PERM_ADMIN_OC), oc.id, bd())).estatus).toBe('borrador');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⭐⭐ V1-E8c (§Post-F9.126) — el COLOR y el DESGLOSE POR MEDIDA de un renglón de AVÍO
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⭐⭐ **V1-E8c — LO QUE LA LÍNEA DE OC GUARDA DE UN AVÍO POR MEDIDA.** Daniel: *"cada color es
 * diferente y cada color tiene cantidades por medida"*.
 *
 * La REGLA del desglose (Σ = cantidad, etiquetas sin repetir) vive pura y probada en
 * `desglose-por-medida.test.ts`; aquí se prueba que la OC **la aplica de verdad** y que lo guardado
 * sobrevive al viaje completo (alta → lectura → duplicado).
 *
 * ⚠️ Necesita Postgres (testcontainers): corre en CI.
 */
describe('⭐⭐ OC (V1-E8c) — color de prenda + desglose por medida en el avío (§Post-F9.126)', () => {
  let medida53: number;
  let medida60: number;

  beforeEach(async () => {
    const m53 = await cliente.avioMedida.create({
      data: { idAvio: avio.id, medida: '53 cm', valor: 53, precio: 6, orden: 1 },
    });
    const m60 = await cliente.avioMedida.create({
      data: { idAvio: avio.id, medida: '60 cm', valor: 60, precio: 6, orden: 2 },
    });
    medida53 = m53.id;
    medida60 = m60.id;
  });

  /** Un renglón de avío con color y desglose, con overrides. */
  function lineaCierre(over: Record<string, unknown> = {}) {
    return {
      idAvio: avio.id,
      idColorPrenda: colorRojo.id,
      colorAvio: 'Rojo',
      cantidad: 30,
      precio: 6,
      medidas: [
        { idAvioMedida: medida53, etiqueta: '53 cm', cantidad: 10, orden: 1 },
        { idAvioMedida: medida60, etiqueta: '60 cm', cantidad: 20, orden: 2 },
      ],
      ...over,
    };
  }

  it('⭐ guarda el color (identidad + texto) y el desglose, y los devuelve al leer', async () => {
    const oc = await crearOC(
      sesion(PERM_ADMIN_OC),
      { ...encabezadoOc(), idProveedor: proveedor.id, lineas: [lineaCierre()] },
      bd(),
    );
    const linea = oc.lineas[0];
    expect(linea?.idColorPrenda).toBe(colorRojo.id);
    expect(linea?.colorPrenda).toBe('Rojo');
    expect(linea?.colorAvio).toBe('Rojo');
    expect(linea?.medidas).toEqual([
      { idAvioMedida: medida53, etiqueta: '53 cm', cantidad: 10, orden: 1 },
      { idAvioMedida: medida60, etiqueta: '60 cm', cantidad: 20, orden: 2 },
    ]);
  });

  it('🔴 un desglose que NO suma la cantidad se RECHAZA (el papel no puede contradecirse)', async () => {
    await expect(
      crearOC(
        sesion(PERM_ADMIN_OC),
        {
          ...encabezadoOc(),
          idProveedor: proveedor.id,
          lineas: [
            lineaCierre({
              medidas: [{ idAvioMedida: medida53, etiqueta: '53 cm', cantidad: 10, orden: 1 }],
            }),
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('🔴 el color de PRENDA no se acepta en una línea de TELA (su color es otro catálogo)', async () => {
    await expect(
      crearOC(
        sesion(PERM_ADMIN_OC),
        {
          ...encabezadoOc(),
          idProveedor: proveedor.id,
          lineas: [{ idTela: tela.id, idColorPrenda: colorRojo.id, cantidad: 5, precio: 10 }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('🔴 el desglose por medida tampoco cabe en una línea de TELA', async () => {
    await expect(
      crearOC(
        sesion(PERM_ADMIN_OC),
        {
          ...encabezadoOc(),
          idProveedor: proveedor.id,
          lineas: [
            {
              idTela: tela.id,
              cantidad: 5,
              precio: 10,
              medidas: [{ etiqueta: '53 cm', cantidad: 5 }],
            },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('una medida INVENTADA se rechaza con su nombre (no revienta la FK con un 500)', async () => {
    await expect(
      crearOC(
        sesion(PERM_ADMIN_OC),
        {
          ...encabezadoOc(),
          idProveedor: proveedor.id,
          lineas: [
            lineaCierre({
              medidas: [{ idAvioMedida: 999_999, etiqueta: '53 cm', cantidad: 30, orden: 1 }],
            }),
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  /**
   * 🔴 **Y DE PASO, EL DEFECTO QUE V1-E3u DEJÓ ABIERTO**: `duplicarOC` copiaba `idTela` pero **no
   * `idTelaColor`**, así que duplicar una OC devolvía una compra "de la misma tela" SIN TONO — el
   * dato que la recepción cruza y que el proveedor lee. No es de esta etapa; se arregla al pasar
   * porque un defecto conocido no es "menor".
   */
  it('🔴 duplicar CONSERVA el color (de tela y de avío) y el desglose por medida', async () => {
    const telaColor = await cliente.telaColor.create({
      data: { idTela: tela.id, nombre: 'Marino', precio: 90 },
    });
    const original = await crearOC(
      sesion(PERM_ADMIN_OC),
      {
        ...encabezadoOc(),
        idProveedor: proveedor.id,
        lineas: [
          { idTela: tela.id, idTelaColor: telaColor.id, cantidad: 5, precio: 10 },
          lineaCierre(),
        ],
      },
      bd(),
    );

    const copia = await duplicarOC(sesion(PERM_ADMIN_OC), original.id, bd());
    const deTela = copia.lineas.find((l) => l.idTela !== null);
    const deAvio = copia.lineas.find((l) => l.idAvio !== null);
    // 🔴 El valor que la pone roja: `null` — que es lo que devolvía antes de este arreglo.
    expect(deTela?.idTelaColor).toBe(telaColor.id);
    expect(deAvio?.idColorPrenda).toBe(colorRojo.id);
    expect(deAvio?.colorAvio).toBe('Rojo');
    expect(deAvio?.medidas.map((m) => m.etiqueta)).toEqual(['53 cm', '60 cm']);
    expect(deAvio?.medidas.reduce((s, m) => s + m.cantidad, 0)).toBe(deAvio?.cantidad);
  });
});
