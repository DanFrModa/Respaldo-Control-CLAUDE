/**
 * Tests de integración de la IMPORTACIÓN de CFDI de VENTAS (F9-E4; R12). Postgres efímero
 * (testcontainers) + fake del motor de archivos (no toca R2). Espejo de la importación de proveedores,
 * con los roles del comprobante INVERTIDOS (emisor = empresa activa, receptor = cliente). Cubre:
 *  (a) importar crea el cargo FISCAL por el TOTAL del CFDI (`factura_cliente` +), con el XML en R2;
 *  (b) el UUID duplicado se rechaza (ErrorConflicto) SIN romper A2 (no queda cargo a medias);
 *  (c) la nota de crédito (E) BAJA el saldo (`nota_credito` −); importar sin pedido deja un aviso;
 *  (d) previsualizar concilia cliente por RFC + pedidos por total cercano, y marca `yaImportado`;
 *  (e) EMISOR ajeno rechazado (con RFC de empresa configurado); pedido de OTRO cliente → ErrorValidacion;
 *  (f) A4 (deny-by-default de cxc.administrar).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { ClavePermiso } from '../../../contrato/index.js';
import { ErrorConflicto, ErrorPermiso, ErrorValidacion } from '../../../comun/errores.js';
import type { ServicioArchivos } from '../../../comun/archivos.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { Cliente, Empresa, PrismaClient } from '../../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../../pruebas/contexto.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import { construirCfdi } from '../../../pruebas/cfdi-fixtures.js';

import { importarCfdiVenta, previsualizarCfdiVenta } from './cfdi-ventas.js';

let cliente: PrismaClient;
let empresa: Empresa;
let clienteFr: Cliente;

/** RFC del EMISOR de los CFDI de ejemplo = la empresa activa (venta propia). */
const RFC_EMPRESA = 'AAA010101AA1';
/** RFC del RECEPTOR de los CFDI de ejemplo = el cliente (lo lleva en su catálogo para el match). */
const RFC_CLIENTE = 'XAXX010101000';

const PERM_TODOS: ClavePermiso[] = [
  'cxc.ver',
  'cxc.administrar',
  'terceros.ver',
  'terceros.administrar',
  'terceros.fiscal',
  'consultas.ver-importes',
];

function sesion(
  permisos: ClavePermiso[] = PERM_TODOS,
  idEmpresaActiva = empresa.id,
): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva, permisos });
}
const bd = () => ({ cliente });

/** Spy de la subida SERVER-SIDE del XML (registra la solicitud; no toca R2). */
let subirContenidoSpy: Mock;

/** Fake del motor de archivos (server-side): NO toca R2, devuelve la key como si hubiera subido. */
function archivosFalsos(): ServicioArchivos {
  return {
    solicitarSubida() {
      throw new Error('La importación de CFDI de venta usa subirContenido (server-side).');
    },
    subirContenido(solicitud) {
      subirContenidoSpy(solicitud);
      const carpeta = solicitud.carpeta ?? 'general';
      return Promise.resolve({
        bucket: 'control-v2-prueba',
        key: `${carpeta}/fake/${solicitud.nombreOriginal}`,
        nombreOriginal: solicitud.nombreOriginal,
        tipoMime: solicitud.tipoMime,
        tamanoBytes: solicitud.contenido.byteLength,
      });
    },
    urlDescarga(key) {
      return Promise.resolve(`https://r2.fake/get/${key}`);
    },
    descargarContenido(key) {
      // El fake no guarda bytes: solo cumple el contrato del servicio (nadie lo usa aquí).
      return Promise.resolve(Buffer.from(`contenido-falso:${key}`, 'utf8'));
    },
    eliminarObjeto() {
      return Promise.resolve();
    },
  };
}

/** Importa un CFDI de venta con el motor de archivos falso (sin R2 real). */
function importar(entrada: Parameters<typeof importarCfdiVenta>[1], ses = sesion()) {
  return importarCfdiVenta(ses, entrada, bd(), archivosFalsos());
}

/** Captura el RFC de la empresa activa (para validar el emisor del CFDI, A9). */
async function ponerRfcEmpresa(rfc: string): Promise<void> {
  await cliente.empresa.update({ where: { id: empresa.id }, data: { rfc } });
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente, 'Empresa Ventas');
  clienteFr = await cliente.cliente.create({
    data: { nombre: 'Tiendas del Sur', rfc: RFC_CLIENTE, diasCredito: 30 },
  });
  subirContenidoSpy = vi.fn();
});

// ── (a) importar crea el cargo fiscal + XML en R2 ──────────────────────────────────────────────────
describe('importarCfdiVenta (factura I)', () => {
  it('crea un cargo FISCAL `factura_cliente` por el total del CFDI, con el XML en R2', async () => {
    const xml = construirCfdi({
      uuid: 'B0000000-0000-0000-0000-000000000001',
      emisorRfc: RFC_EMPRESA,
      receptorRfc: RFC_CLIENTE,
      total: '1160.00',
    });
    const res = await importar({ xml, idCliente: clienteFr.id });

    expect(res.movimiento).toMatchObject({
      tipoTercero: 'cliente',
      idTercero: clienteFr.id,
      origen: 'factura_cliente',
      esFiscal: true,
      uuidCfdi: 'B0000000-0000-0000-0000-000000000001',
      monto: 1160,
    });
    expect(res.movimiento.idArchivoCfdi).not.toBeNull();
    expect(subirContenidoSpy).toHaveBeenCalledTimes(1);
    // El XML quedó registrado como Archivo.
    const archivos = await cliente.archivo.count();
    expect(archivos).toBe(1);
  });

  // ── (b) UUID duplicado ────────────────────────────────────────────────────────────────────────
  it('rechaza el mismo UUID dos veces (ErrorConflicto) sin dejar cargo a medias', async () => {
    const xml = construirCfdi({
      uuid: 'B0000000-0000-0000-0000-000000000002',
      emisorRfc: RFC_EMPRESA,
      receptorRfc: RFC_CLIENTE,
    });
    await importar({ xml, idCliente: clienteFr.id });
    await expect(importar({ xml, idCliente: clienteFr.id })).rejects.toBeInstanceOf(ErrorConflicto);

    const cargos = await cliente.movimientoTercero.count({
      where: { uuidCfdi: 'B0000000-0000-0000-0000-000000000002' },
    });
    expect(cargos).toBe(1);
  });

  // ── (c) nota de crédito + importar sin pedido ─────────────────────────────────────────────────
  it('la nota de crédito (E) baja el saldo del cliente', async () => {
    await importar({
      xml: construirCfdi({
        uuid: 'B0000000-0000-0000-0000-000000000003',
        emisorRfc: RFC_EMPRESA,
        receptorRfc: RFC_CLIENTE,
        total: '500.00',
      }),
      idCliente: clienteFr.id,
    });
    const nc = await importar({
      xml: construirCfdi({
        uuid: 'B0000000-0000-0000-0000-000000000004',
        emisorRfc: RFC_EMPRESA,
        receptorRfc: RFC_CLIENTE,
        tipo: 'E',
        total: '200.00',
      }),
      idCliente: clienteFr.id,
    });
    expect(nc.movimiento.origen).toBe('nota_credito');
    expect(nc.movimiento.monto).toBe(-200);

    const suma = await cliente.movimientoTercero.aggregate({
      where: { idEmpresa: empresa.id, idCliente: clienteFr.id },
      _sum: { monto: true },
    });
    expect(suma._sum.monto?.toNumber()).toBe(300);
    expect(nc.avisos.some((a) => a.includes('SIN ligarse a un pedido'))).toBe(true);
  });
});

// ── (d) previsualización ───────────────────────────────────────────────────────────────────────
describe('previsualizarCfdiVenta', () => {
  it('concilia el cliente por RFC del receptor y sugiere pedidos por total cercano', async () => {
    await ponerRfcEmpresa(RFC_EMPRESA);
    const pedido = await cliente.pedido.create({
      data: { idEmpresa: empresa.id, idCliente: clienteFr.id, folio: 1n },
    });

    const prev = await previsualizarCfdiVenta(
      sesion(),
      { xml: construirCfdi({ emisorRfc: RFC_EMPRESA, receptorRfc: RFC_CLIENTE }) },
      bd(),
    );
    expect(prev.candidatoCliente?.idCliente).toBe(clienteFr.id);
    expect(prev.candidatosPedido.some((p) => p.idPedido === pedido.id)).toBe(true);
    expect(prev.yaImportado).toBe(false);
    expect(prev.datos.origen).toBe('factura_cliente');
  });

  it('marca yaImportado cuando el UUID ya está en el libro', async () => {
    await ponerRfcEmpresa(RFC_EMPRESA);
    const xml = construirCfdi({
      uuid: 'B0000000-0000-0000-0000-000000000005',
      emisorRfc: RFC_EMPRESA,
      receptorRfc: RFC_CLIENTE,
    });
    await importar({ xml, idCliente: clienteFr.id });
    const prev = await previsualizarCfdiVenta(sesion(), { xml }, bd());
    expect(prev.yaImportado).toBe(true);
    expect(prev.avisos.some((a) => a.includes('YA fue importado'))).toBe(true);
  });
});

// ── (e) emisor validado + pedido de otro cliente ──────────────────────────────────────────────────
describe('validaciones de conciliación', () => {
  it('rechaza el CFDI cuyo EMISOR no es la empresa activa (RFC configurado)', async () => {
    await ponerRfcEmpresa(RFC_EMPRESA);
    const ajeno = construirCfdi({
      uuid: 'B0000000-0000-0000-0000-000000000006',
      emisorRfc: 'ZZZ991231ZZ9', // otro emisor
      receptorRfc: RFC_CLIENTE,
    });
    await expect(importar({ xml: ajeno, idCliente: clienteFr.id })).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });

  it('ligar un pedido de OTRO cliente lanza ErrorValidacion (antes de escribir/subir)', async () => {
    const otroCliente = await cliente.cliente.create({ data: { nombre: 'Otro Cliente' } });
    const pedidoAjeno = await cliente.pedido.create({
      data: { idEmpresa: empresa.id, idCliente: otroCliente.id, folio: 2n },
    });
    await expect(
      importar({
        xml: construirCfdi({
          uuid: 'B0000000-0000-0000-0000-000000000007',
          emisorRfc: RFC_EMPRESA,
          receptorRfc: RFC_CLIENTE,
        }),
        idCliente: clienteFr.id,
        refTipo: 'pedido',
        refId: pedidoAjeno.id,
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // No se subió nada (falla ANTES del R2).
    expect(subirContenidoSpy).not.toHaveBeenCalled();
  });
});

// ── (f) A4 RBAC ────────────────────────────────────────────────────────────────────────────────
describe('RBAC (deny-by-default, A4)', () => {
  it('sin `cxc.administrar` no se importa', async () => {
    await expect(
      importar(
        {
          xml: construirCfdi({ emisorRfc: RFC_EMPRESA, receptorRfc: RFC_CLIENTE }),
          idCliente: clienteFr.id,
        },
        sesion(['cxc.ver', 'terceros.ver']),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});
