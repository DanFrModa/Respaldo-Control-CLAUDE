/**
 * Tests de integración de la IMPORTACIÓN de CFDI de proveedores (F9-E3; R11). Postgres efímero
 * (testcontainers) + fake del motor de archivos (no toca R2). Cubre:
 *  (a) importar crea el cargo FISCAL por el TOTAL del CFDI, ligado a la operación y con el XML en R2;
 *  (b) el UUID duplicado se rechaza (ErrorConflicto) SIN romper A2 (no queda cargo a medias);
 *  (c) importar SIN OC deja un aviso; la nota de crédito (E) BAJA el saldo;
 *  (d) previsualizar concilia proveedor por RFC + OCs por total cercano, y marca `yaImportado`;
 *  (e) receptor ajeno rechazado (con RFC esperado configurado); proveedor≠emisor deja aviso;
 *  (f) A9 (el cargo es de la empresa activa) y A4 (deny-by-default de cxp.administrar).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { ClavePermiso } from '../../../contrato/index.js';
import { ErrorConflicto, ErrorPermiso, ErrorValidacion } from '../../../comun/errores.js';
import type { ServicioArchivos } from '../../../comun/archivos.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { Empresa, PrismaClient, Proveedor } from '../../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../../pruebas/contexto.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import { construirCfdi } from '../../../pruebas/cfdi-fixtures.js';

import { importarCfdi, previsualizarCfdi } from './cfdi-proveedor.js';

let cliente: PrismaClient;
let empresa: Empresa;
let proveedor: Proveedor;

/** RFC del emisor de los CFDI de ejemplo (el proveedor lo lleva en su catálogo para el match). */
const RFC_EMISOR = 'AAA010101AA1';
/** RFC del receptor de los CFDI de ejemplo (la "empresa activa"). */
const RFC_RECEPTOR = 'XAXX010101000';

const PERM_TODOS: ClavePermiso[] = [
  'cxp.ver',
  'cxp.administrar',
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

/**
 * Fake del motor de archivos. La importación usa `subirContenido` (server-side): NO toca R2, devuelve la
 * key como si hubiera subido. El registro `Archivo` lo crea el DOMINIO en su tx (no el motor). El
 * `solicitarSubida` presigned NO se usa aquí → stub que falla si alguien lo invocara.
 */
function archivosFalsos(): ServicioArchivos {
  return {
    solicitarSubida() {
      throw new Error(
        'La importación de CFDI usa subirContenido (server-side), no solicitarSubida.',
      );
    },
    subirContenido(solicitud) {
      subirContenidoSpy(solicitud);
      const carpeta = solicitud.carpeta ?? 'general';
      const key = `${carpeta}/fake/${solicitud.nombreOriginal}`;
      return Promise.resolve({
        bucket: 'control-v2-prueba',
        key,
        nombreOriginal: solicitud.nombreOriginal,
        tipoMime: solicitud.tipoMime,
        tamanoBytes: solicitud.contenido.byteLength,
      });
    },
    urlDescarga(key) {
      return Promise.resolve(`https://r2.fake/get/${key}`);
    },
    eliminarObjeto() {
      return Promise.resolve();
    },
  };
}

/** Importa un CFDI con el motor de archivos falso (sin R2 real). */
function importar(entrada: Parameters<typeof importarCfdi>[1], ses = sesion()) {
  return importarCfdi(ses, entrada, bd(), archivosFalsos());
}

/** Captura el RFC de la empresa activa (para validar el receptor del CFDI, A9). */
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
  empresa = await crearEmpresaPrueba(cliente, 'Empresa CFDI');
  proveedor = await cliente.proveedor.create({
    data: { nombre: 'Telas del Norte SA', corto: 'TDN', rfc: RFC_EMISOR, diasCredito: 30 },
  });
  subirContenidoSpy = vi.fn();
});

// ── (a) importar crea el cargo fiscal + XML en R2 ──────────────────────────────────────────────────
describe('importarCfdi (factura I)', () => {
  it('crea un cargo FISCAL por el total del CFDI, ligado al Archivo del XML en R2', async () => {
    const xml = construirCfdi({ uuid: 'A0000000-0000-0000-0000-000000000001' });
    const res = await importar({ xml, idProveedor: proveedor.id });

    expect(res.movimiento).toMatchObject({
      tipoTercero: 'proveedor',
      idTercero: proveedor.id,
      origen: 'factura_proveedor',
      esFiscal: true,
      uuidCfdi: 'A0000000-0000-0000-0000-000000000001',
      rfcTercero: RFC_EMISOR,
      monto: 1060, // total del CFDI, cargo (+)
    });
    expect(res.movimiento.idArchivoCfdi).not.toBeNull();
    // El XML se sube SERVER-SIDE; la key se ordena por año (carpeta cfdi/proveedores/<año>).
    expect(subirContenidoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ carpeta: 'cfdi/proveedores/2026', tipoMime: 'application/xml' }),
    );

    // El cargo es de la empresa activa (A9) y su Archivo existe con la key ordenada.
    const mov = await cliente.movimientoTercero.findFirstOrThrow({
      where: { uuidCfdi: 'A0000000-0000-0000-0000-000000000001' },
      include: { archivoCfdi: true },
    });
    expect(mov.idEmpresa).toBe(empresa.id);
    expect(mov.archivoCfdi?.key).toContain('cfdi/proveedores/2026/');

    // El saldo del proveedor sube por el total.
    const saldo = await cliente.movimientoTercero.aggregate({
      where: { idEmpresa: empresa.id, idProveedor: proveedor.id },
      _sum: { monto: true },
    });
    expect(saldo._sum.monto?.toNumber()).toBe(1060);
  });

  it('sin OC ligada deja un aviso (el cargo entra igual)', async () => {
    const res = await importar({
      xml: construirCfdi({ uuid: 'A0000000-0000-0000-0000-000000000002' }),
      idProveedor: proveedor.id,
    });
    expect(res.avisos.some((a) => /SIN ligarse a una OC/i.test(a))).toBe(true);
  });

  it('liga la OC elegida (refTipo/refId)', async () => {
    const oc = await cliente.ordenCompra.create({
      data: {
        numCompra: 7n,
        idEmpresa: empresa.id,
        idProveedor: proveedor.id,
        estatus: 'autorizada',
      },
    });
    const res = await importar({
      xml: construirCfdi({ uuid: 'A0000000-0000-0000-0000-000000000003' }),
      idProveedor: proveedor.id,
      refTipo: 'orden-compra',
      refId: oc.id,
    });
    expect(res.movimiento).toMatchObject({ refTipo: 'orden-compra', refId: oc.id });
  });
});

// ── (b) UUID duplicado ─────────────────────────────────────────────────────────────────────────────
describe('anti-duplicado por UUID', () => {
  it('rechaza el mismo UUID una segunda vez, sin dejar un segundo cargo (A2)', async () => {
    const xml = construirCfdi({ uuid: 'B0000000-0000-0000-0000-000000000001' });
    await importar({ xml, idProveedor: proveedor.id });
    await expect(importar({ xml, idProveedor: proveedor.id })).rejects.toBeInstanceOf(
      ErrorConflicto,
    );

    const n = await cliente.movimientoTercero.count({
      where: { uuidCfdi: 'B0000000-0000-0000-0000-000000000001' },
    });
    expect(n).toBe(1);
    // El fallo del 2º import no dejó un Archivo huérfano de más (solo el del 1º import correcto).
    const archivos = await cliente.archivo.count();
    expect(archivos).toBe(1);
  });
});

// ── (c) nota de crédito (E) baja el saldo ─────────────────────────────────────────────────────────
describe('nota de crédito (E)', () => {
  it('registra un abono (−) que baja el saldo del proveedor', async () => {
    await importar({
      xml: construirCfdi({ uuid: 'C0000000-0000-0000-0000-000000000001' }),
      idProveedor: proveedor.id,
    }); // +1060
    const nc = await importar({
      xml: construirCfdi({
        tipo: 'E',
        uuid: 'C0000000-0000-0000-0000-000000000002',
        total: '1060.00',
        conRetencion: false,
      }),
      idProveedor: proveedor.id,
    });
    expect(nc.movimiento).toMatchObject({ origen: 'nota_credito', esFiscal: true, monto: -1060 });

    const saldo = await cliente.movimientoTercero.aggregate({
      where: { idEmpresa: empresa.id, idProveedor: proveedor.id },
      _sum: { monto: true },
    });
    expect(saldo._sum.monto?.toNumber()).toBe(0);
  });
});

// ── (d) previsualización ───────────────────────────────────────────────────────────────────────────
describe('previsualizarCfdi', () => {
  it('extrae datos, sugiere el proveedor por RFC y las OCs por total cercano', async () => {
    // OC del proveedor con total 1000 (cercana al 1060 del CFDI) + una lejana.
    const oc = await cliente.ordenCompra.create({
      data: {
        numCompra: 10n,
        idEmpresa: empresa.id,
        idProveedor: proveedor.id,
        estatus: 'autorizada',
        lineas: { create: [{ cantidad: 10, precio: 100 }] }, // total 1000
      },
    });
    await cliente.ordenCompra.create({
      data: {
        numCompra: 11n,
        idEmpresa: empresa.id,
        idProveedor: proveedor.id,
        estatus: 'autorizada',
        lineas: { create: [{ cantidad: 100, precio: 100 }] }, // total 10000 (lejana)
      },
    });

    const prev = await previsualizarCfdi(
      sesion(),
      { xml: construirCfdi({ uuid: 'D0000000-0000-0000-0000-000000000001' }) },
      bd(),
    );

    expect(prev.datos).toMatchObject({
      total: 1060,
      emisorRfc: RFC_EMISOR,
      receptorRfc: RFC_RECEPTOR,
      origen: 'factura_proveedor',
    });
    expect(prev.candidatoProveedor?.idProveedor).toBe(proveedor.id);
    expect(prev.yaImportado).toBe(false);
    // La OC más cercana (1000) va primero.
    expect(prev.candidatosOc[0]).toMatchObject({
      idOrdenCompra: oc.id,
      total: 1000,
      diferencia: 60,
    });
  });

  it('marca yaImportado=true y avisa cuando el UUID ya se importó', async () => {
    const xml = construirCfdi({ uuid: 'D0000000-0000-0000-0000-000000000002' });
    await importar({ xml, idProveedor: proveedor.id });
    const prev = await previsualizarCfdi(sesion(), { xml }, bd());
    expect(prev.yaImportado).toBe(true);
    expect(prev.avisos.some((a) => /ya fue importado/i.test(a))).toBe(true);
  });

  it('sin proveedor con ese RFC: candidato null + aviso', async () => {
    const prev = await previsualizarCfdi(
      sesion(),
      {
        xml: construirCfdi({
          emisorRfc: 'ZZZ991231ZZ9',
          uuid: 'D0000000-0000-0000-0000-000000000003',
        }),
      },
      bd(),
    );
    expect(prev.candidatoProveedor).toBeNull();
    expect(prev.candidatosOc).toHaveLength(0);
    expect(prev.avisos.some((a) => /Ningún proveedor/i.test(a))).toBe(true);
  });
});

// ── (e) receptor contra la EMPRESA ACTIVA + proveedor≠emisor ───────────────────────────────────────
describe('validación del receptor (contra el RFC de la empresa activa) y del proveedor elegido', () => {
  it('rechaza un CFDI dirigido a otro RFC (receptor ajeno) cuando la empresa tiene RFC capturado', async () => {
    await ponerRfcEmpresa(RFC_RECEPTOR); // la empresa activa es XAXX010101000
    const xml = construirCfdi({
      receptorRfc: 'XEXX010101000', // dirigido a OTRA empresa
      uuid: 'E0000000-0000-0000-0000-000000000001',
    });
    await expect(importar({ xml, idProveedor: proveedor.id })).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    // No dejó cargo (rechazo ANTES de escribir).
    const n = await cliente.movimientoTercero.count();
    expect(n).toBe(0);
  });

  it('con la empresa SIN RFC capturado NO rechaza: deja un aviso "no se validó el receptor"', async () => {
    // beforeEach deja la empresa sin RFC (null).
    const res = await importar({
      xml: construirCfdi({ uuid: 'E0000000-0000-0000-0000-000000000003' }),
      idProveedor: proveedor.id,
    });
    expect(res.avisos.some((a) => /no se validó el rfc del receptor/i.test(a))).toBe(true);
    expect(res.movimiento.esFiscal).toBe(true); // el cargo entró igual
  });

  it('con el receptor que SÍ coincide con la empresa: importa sin aviso de receptor', async () => {
    await ponerRfcEmpresa(RFC_RECEPTOR);
    const res = await importar({
      xml: construirCfdi({ uuid: 'E0000000-0000-0000-0000-000000000004' }),
      idProveedor: proveedor.id,
    });
    expect(res.avisos.some((a) => /receptor/i.test(a))).toBe(false);
  });

  it('avisa si el proveedor elegido no coincide con el emisor del CFDI (pero importa)', async () => {
    const otro = await cliente.proveedor.create({
      data: { nombre: 'Otro Proveedor', rfc: 'BBB020202BB2' },
    });
    const res = await importar({
      xml: construirCfdi({ uuid: 'E0000000-0000-0000-0000-000000000002' }),
      idProveedor: otro.id,
    });
    expect(res.avisos.some((a) => /no coincide con el emisor/i.test(a))).toBe(true);
    expect(res.movimiento.idTercero).toBe(otro.id);
  });
});

// ── (S2) la OC ligada debe ser del proveedor elegido y de la empresa activa ────────────────────────
describe('validación de la OC ligada (S2)', () => {
  it('rechaza (ErrorValidacion) ligar una OC de OTRO proveedor, sin dejar cargo', async () => {
    const otro = await cliente.proveedor.create({
      data: { nombre: 'Proveedor Ajeno', rfc: 'CCC030303CC3' },
    });
    const ocAjena = await cliente.ordenCompra.create({
      data: {
        numCompra: 55n,
        idEmpresa: empresa.id,
        idProveedor: otro.id, // OC de otro proveedor
        estatus: 'autorizada',
      },
    });
    await expect(
      importar({
        xml: construirCfdi({ uuid: 'F2000000-0000-0000-0000-000000000001' }),
        idProveedor: proveedor.id, // pero el cargo va al proveedor del CFDI
        refTipo: 'orden-compra',
        refId: ocAjena.id,
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.movimientoTercero.count()).toBe(0);
    expect(await cliente.archivo.count()).toBe(0); // ni siquiera se subió el XML (rechazo antes)
  });

  it('rechaza (ErrorValidacion) ligar una OC inexistente / de otra empresa', async () => {
    await expect(
      importar({
        xml: construirCfdi({ uuid: 'F2000000-0000-0000-0000-000000000002' }),
        idProveedor: proveedor.id,
        refTipo: 'orden-compra',
        refId: 999_999,
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.movimientoTercero.count()).toBe(0);
  });

  it('acepta ligar una OC del MISMO proveedor (S2 no estorba el camino feliz)', async () => {
    const oc = await cliente.ordenCompra.create({
      data: {
        numCompra: 56n,
        idEmpresa: empresa.id,
        idProveedor: proveedor.id,
        estatus: 'autorizada',
      },
    });
    const res = await importar({
      xml: construirCfdi({ uuid: 'F2000000-0000-0000-0000-000000000003' }),
      idProveedor: proveedor.id,
      refTipo: 'orden-compra',
      refId: oc.id,
    });
    expect(res.movimiento).toMatchObject({ refTipo: 'orden-compra', refId: oc.id });
  });
});

// ── (f) A4 deny-by-default ─────────────────────────────────────────────────────────────────────────
describe('RBAC (A4)', () => {
  it('sin cxp.administrar no se puede previsualizar ni importar', async () => {
    const soloVer = sesion(['cxp.ver', 'terceros.ver']);
    await expect(
      previsualizarCfdi(soloVer, { xml: construirCfdi({}) }, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(
      importarCfdi(
        soloVer,
        { xml: construirCfdi({}), idProveedor: proveedor.id },
        bd(),
        archivosFalsos(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('defensa en profundidad: cxp.administrar SIN terceros.administrar falla cerrado al importar', async () => {
    const sinMotor = sesion(['cxp.administrar', 'consultas.ver-importes']);
    await expect(
      importarCfdi(
        sinMotor,
        {
          xml: construirCfdi({ uuid: 'F0000000-0000-0000-0000-000000000001' }),
          idProveedor: proveedor.id,
        },
        bd(),
        archivosFalsos(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});
