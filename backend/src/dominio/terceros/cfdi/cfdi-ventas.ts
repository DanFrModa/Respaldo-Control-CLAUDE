/**
 * ServicioCfdiVentas — IMPORTACIÓN de CFDI de VENTAS a CxC (Módulo 14, F9-E4; R12; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §2). Jala el XML ya TIMBRADO de las ventas
 * propias (emitido por fuera, SINUBE u otro), lo valida (parser puro `parser-cfdi.ts`, reusado TAL
 * CUAL), lo concilia con el cliente (por RFC del receptor) y un pedido (por total cercano), guarda el
 * XML en R2 y crea el cargo FISCAL de CxC por el TOTAL del CFDI. Es importación, NO emisión (R14/PAC es
 * posterior). Es el ESPEJO de la importación de CFDI de proveedores (F9-E3), con los roles del
 * comprobante INVERTIDOS: el EMISOR debe ser la empresa activa; el RECEPTOR es el cliente.
 *
 * COMPOSICIÓN (sin duplicar el motor): la alta del cargo DELEGA en `registrarMovimientoTercero`
 * (F9-E1). El XML se sube SERVER-SIDE (el servidor ya tiene los bytes): R2 PRIMERO → tx DESPUÉS
 * (Archivo + movimiento fiscal en A2). Un cargo FISCAL sin su XML sería IRRECUPERABLE (la unique del
 * UUID bloquea el re-import); si en cambio la tx falla tras subir, el objeto queda huérfano en R2
 * (inocuo). Anti-duplicado por UUID (chequeo previo + la unique de E1 como backstop). Los helpers de
 * empresa/UUID se comparten con CxP (`cfdi-comun.ts`).
 *
 * PERMISOS (A4, deny-by-default): importar/previsualizar un CFDI de venta ES administrar CxC → usa
 * `cxc.administrar`. Al delegar al motor se exige ADEMÁS `terceros.administrar` (defensa en profundidad;
 * mismo reparto en el seed). Empresa activa (A9).
 */
import {
  esquemaCfdiXml,
  esquemaCfdiVentaImportarEntrada,
  type CfdiVentaDatos,
  type CfdiCandidatoCliente,
  type CfdiCandidatoPedido,
  type CfdiVentaPrevisualizacion,
  type CfdiVentaImportarSalida,
  type DatosCfdiVentaImportar,
  type MovimientoTerceroSalida,
} from '../../../contrato/index.js';
import type { z } from 'zod';

import { servicioArchivos, type ServicioArchivos } from '../../../comun/archivos.js';
import { ErrorConflicto, ErrorValidacion } from '../../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, enTransaccion, type ContextoBd } from '../../../comun/transaccion.js';
import { validarEntrada } from '../../../comun/validacion.js';
import { Prisma } from '../../../datos/index.js';

import { registrarMovimientoTercero } from '../cuenta-terceros.js';
import { rfcEmpresaActiva, uuidYaImportado } from './cfdi-comun.js';
import {
  parsearCfdi,
  normalizarRfc,
  type CfdiParseado,
  type TipoComprobanteCfdi,
} from './parser-cfdi.js';

/** Carpeta R2 de los XML de CFDI de ventas (la key real la ordena el motor: carpeta/<uuid>/nombre). */
const CARPETA_CFDI = 'cfdi/ventas';

/** Máximo de pedidos candidatos devueltos (los más cercanos por total). */
const MAX_CANDIDATOS_PEDIDO = 8;

/** Umbral relativo para AVISAR de diferencia pedido↔CFDI (0.005 = 0.5%). */
const UMBRAL_DIFERENCIA_PEDIDO = 0.005;

/** Redondeo monetario a 2 decimales. */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Redondeo a 4 decimales (para la diferencia relativa). */
function redondear4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * ORIGEN de CxC según el tipo de comprobante: I (ingreso) → `factura_cliente` (cargo +); E (egreso) →
 * `nota_credito` (abono −). El signo lo aplica el motor por el origen (`signoDeOrigen`).
 */
function origenVentaDeTipoComprobante(
  tipo: TipoComprobanteCfdi,
): 'factura_cliente' | 'nota_credito' {
  return tipo === 'I' ? 'factura_cliente' : 'nota_credito';
}

/**
 * Valida el EMISOR del CFDI de venta contra el RFC de la empresa activa (A9). Si la empresa tiene RFC
 * capturado y NO coincide, lanza (no se importa como venta propia un CFDI de otro emisor). Si la empresa
 * aún no tiene RFC, NO rechaza: devuelve un AVISO. Devuelve la lista de avisos (vacía o con el aviso).
 */
export function validarEmisorCfdi(parsed: CfdiParseado, esperado: string | null): string[] {
  if (esperado === null) {
    return [
      `No se validó el RFC del emisor (tu empresa aún no captura su RFC): el CFDI lo emite ` +
        `${parsed.emisorRfc}${parsed.emisorNombre === null ? '' : ` — ${parsed.emisorNombre}`}. ` +
        `Verifica que sea tu empresa (captúralo en Administración › Empresas para validarlo).`,
    ];
  }
  if (normalizarRfc(parsed.emisorRfc) !== normalizarRfc(esperado)) {
    throw new ErrorConflicto(
      `El CFDI lo emite el RFC ${parsed.emisorRfc}, no el de tu empresa (${esperado}). ` +
        `Solo se importan como venta los comprobantes emitidos por tu empresa.`,
    );
  }
  return [];
}

/** Proyecta el CFDI parseado a la forma del contrato de venta (agrega el `origen` derivado del tipo). */
function aDatosSalida(parsed: CfdiParseado): CfdiVentaDatos {
  return {
    version: parsed.version,
    tipoComprobante: parsed.tipoComprobante,
    origen: origenVentaDeTipoComprobante(parsed.tipoComprobante),
    uuid: parsed.uuid,
    fecha: parsed.fecha,
    fechaTimbrado: parsed.fechaTimbrado,
    emisorRfc: parsed.emisorRfc,
    emisorNombre: parsed.emisorNombre,
    receptorRfc: parsed.receptorRfc,
    receptorNombre: parsed.receptorNombre,
    moneda: parsed.moneda,
    subtotal: parsed.subtotal,
    total: parsed.total,
    ivaTrasladado: parsed.ivaTrasladado,
    isrRetenido: parsed.isrRetenido,
    ivaRetenido: parsed.ivaRetenido,
    conceptos: parsed.conceptos,
  };
}

/** Busca un cliente por el RFC del receptor (insensible a mayúsculas). Null si ninguno coincide. */
async function matchCliente(
  cliente: ReturnType<typeof clienteLectura>,
  receptorRfc: string,
): Promise<CfdiCandidatoCliente | null> {
  const encontrado = await cliente.cliente.findFirst({
    where: { rfc: { equals: receptorRfc, mode: 'insensitive' } },
    select: { id: true, nombre: true, rfc: true },
  });
  if (encontrado === null) {
    return null;
  }
  return { idCliente: encontrado.id, nombre: encontrado.nombre, rfc: encontrado.rfc };
}

/**
 * Pedidos candidatos de un cliente para ligar el CFDI de venta: mismo cliente + total cercano
 * (heurística honesta). El total de cada pedido se DERIVA por suma de líneas (Σ cantidad×precio), nunca
 * una columna editable; se ordenan por cercanía al total del CFDI. La elección la hace el usuario (no se
 * auto-liga). Se excluyen los pedidos cancelados.
 */
async function matchPedidos(
  cliente: ReturnType<typeof clienteLectura>,
  idEmpresa: number,
  idCliente: number,
  totalCfdi: number,
  puedeVerImportes: boolean,
): Promise<CfdiCandidatoPedido[]> {
  const pedidos = await cliente.pedido.findMany({
    where: { idEmpresa, idCliente, pedCancelado: false },
    include: { lineas: { select: { cantidadPedida: true, precio: true } } },
    orderBy: { folio: 'desc' },
    take: 100,
  });

  const conTotal = pedidos.map((p) => {
    const total = redondear2(
      p.lineas.reduce((s, l) => s + l.cantidadPedida * l.precio.toNumber(), 0),
    );
    const diferencia = redondear2(Math.abs(total - totalCfdi));
    const diferenciaRelativa = totalCfdi > 0 ? redondear4(diferencia / totalCfdi) : null;
    return { pedido: p, total, diferencia, diferenciaRelativa };
  });
  // Más cercano primero; empate → folio más reciente.
  conTotal.sort(
    (a, b) => a.diferencia - b.diferencia || (a.pedido.folio < b.pedido.folio ? 1 : -1),
  );

  return conTotal
    .slice(0, MAX_CANDIDATOS_PEDIDO)
    .map(({ pedido, total, diferencia, diferenciaRelativa }) => ({
      idPedido: pedido.id,
      folio: Number(pedido.folio),
      fecha: pedido.fechaPedido === null ? null : pedido.fechaPedido.toISOString().slice(0, 10),
      ocCliente: pedido.ocCliente,
      total: puedeVerImportes ? total : null,
      diferencia: puedeVerImportes ? diferencia : null,
      diferenciaRelativa: puedeVerImportes ? diferenciaRelativa : null,
    }));
}

// ── Previsualización ─────────────────────────────────────────────────────────────────────────────

/**
 * Previsualiza un CFDI de venta: lo parsea/valida (parser puro) y devuelve los datos + candidatos de
 * conciliación (cliente por RFC del receptor, pedidos por total cercano) + avisos (emisor, duplicado).
 * NO escribe nada. Permiso `cxc.administrar` (la previsualización es el primer paso del alta). A9.
 */
export async function previsualizarCfdiVenta(
  sesion: SesionUsuario,
  entrada: z.input<typeof esquemaCfdiXml>,
  bd?: ContextoBd,
): Promise<CfdiVentaPrevisualizacion> {
  verificarPermiso(sesion, 'cxc.administrar');
  const datos = validarEntrada(esquemaCfdiXml, entrada);
  const parsed = parsearCfdi(datos.xml);

  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const avisos = validarEmisorCfdi(parsed, await rfcEmpresaActiva(cliente, idEmpresa));

  const candidatoCliente = await matchCliente(cliente, parsed.receptorRfc);
  const yaImportado = await uuidYaImportado(cliente, parsed.uuid);
  if (yaImportado) {
    avisos.push(`Este CFDI (UUID ${parsed.uuid}) YA fue importado: no se puede duplicar.`);
  }
  if (candidatoCliente === null) {
    avisos.push(
      `Ningún cliente del catálogo tiene el RFC del receptor (${parsed.receptorRfc}). ` +
        `Elige el cliente a mano o captura su RFC en el catálogo.`,
    );
  }

  const candidatosPedido =
    candidatoCliente === null
      ? []
      : await matchPedidos(
          cliente,
          idEmpresa,
          candidatoCliente.idCliente,
          parsed.total,
          puedeVerImportes,
        );

  return {
    datos: aDatosSalida(parsed),
    candidatoCliente,
    candidatosPedido,
    yaImportado,
    avisos,
  };
}

// ── Importación ──────────────────────────────────────────────────────────────────────────────────

/**
 * Importa un CFDI de venta a CxC: valida el XML, guarda el XML en R2 y crea el cargo FISCAL por el TOTAL
 * del CFDI (I → `factura_cliente` +, E → `nota_credito` −), ligado al pedido elegido (o sin pedido, con
 * aviso), TODO en una transacción (A2). El UUID duplicado se rechaza (`ErrorConflicto`), sin dejar el
 * cargo a medias. Las diferencias de monto pedido↔CFDI NO se fuerzan (avisos). Permiso `cxc.administrar`.
 * Empresa activa (A9). El servicio de archivos se inyecta (default lazy) para tests sin R2 real.
 */
export async function importarCfdiVenta(
  sesion: SesionUsuario,
  entrada: z.input<typeof esquemaCfdiVentaImportarEntrada>,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<CfdiVentaImportarSalida> {
  verificarPermiso(sesion, 'cxc.administrar');
  const datos: DatosCfdiVentaImportar = validarEntrada(esquemaCfdiVentaImportarEntrada, entrada);
  const parsed = parsearCfdi(datos.xml);

  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const origen = origenVentaDeTipoComprobante(parsed.tipoComprobante);

  // Rechaza (o avisa) según el RFC de la empresa activa (A9) — ANTES de escribir nada.
  const avisos = validarEmisorCfdi(parsed, await rfcEmpresaActiva(cliente, idEmpresa));

  // Anti-duplicado: chequeo previo para un error limpio (la unique global de E1 es el backstop).
  if (await uuidYaImportado(cliente, parsed.uuid)) {
    throw new ErrorConflicto(
      `Este CFDI (UUID ${parsed.uuid}) ya fue importado: no se puede duplicar.`,
    );
  }

  // Aviso si el cliente elegido no coincide con el receptor del CFDI (el usuario eligió a mano).
  const clienteElegido = await cliente.cliente.findUnique({
    where: { id: datos.idCliente },
    select: { nombre: true, rfc: true },
  });
  if (
    clienteElegido !== null &&
    clienteElegido.rfc !== null &&
    normalizarRfc(clienteElegido.rfc) !== normalizarRfc(parsed.receptorRfc)
  ) {
    avisos.push(
      `El cliente elegido (${clienteElegido.nombre}, RFC ${clienteElegido.rfc}) no coincide con el ` +
        `receptor del CFDI (RFC ${parsed.receptorRfc}). Verifica que sea el correcto.`,
    );
  }

  // Liga a la operación real. Si se liga un PEDIDO, DEBE ser del cliente elegido y de la empresa activa
  // (A9). Que el pedido sea de OTRO cliente NO es un simple aviso: ligar el cargo al pedido ajeno
  // descuadraría la conciliación de CxC → ErrorValidacion (ANTES de escribir/subir). Sin liga, solo avisa.
  if (datos.refTipo === undefined) {
    avisos.push('El cargo se registró SIN ligarse a un pedido.');
  } else if (datos.refTipo === 'pedido' && datos.refId !== undefined) {
    const pedido = await cliente.pedido.findFirst({
      where: { id: datos.refId, idEmpresa },
      include: { lineas: { select: { cantidadPedida: true, precio: true } } },
    });
    if (pedido === null) {
      throw new ErrorValidacion('El pedido ligado no existe o no es de tu empresa.');
    }
    if (pedido.idCliente !== datos.idCliente) {
      throw new ErrorValidacion(
        `El pedido ${Number(pedido.folio)} es de otro cliente: no se puede ligar el CFDI al cliente ` +
          `elegido. Elige un pedido de ese cliente o impórtalo sin pedido.`,
      );
    }
    avisarDiferenciaPedido(pedido, parsed.total, avisos);
  }

  const observaciones = datos.observaciones ?? `CFDI ${parsed.tipoComprobante} ${parsed.uuid}`;
  const anio = parsed.fecha.slice(0, 4);

  // Sube el XML a R2 SERVER-SIDE ANTES de la transacción (orden seguro): el servidor ya tiene los bytes.
  // Si la tx falla luego, el objeto queda huérfano en R2 (inocuo); NUNCA al revés (un cargo fiscal sin
  // su XML sería irrecuperable por la unique del UUID). Se llega aquí solo tras pasar TODAS las
  // validaciones (emisor, duplicado, pedido↔cliente): no se sube nada de una importación que se rechaza.
  const subido = await archivos.subirContenido({
    nombreOriginal: `cfdi-venta-${parsed.uuid}.xml`,
    tipoMime: 'application/xml',
    carpeta: `${CARPETA_CFDI}/${anio}`,
    contenido: Buffer.from(datos.xml, 'utf8'),
  });

  let movimiento: MovimientoTerceroSalida;
  try {
    movimiento = await enTransaccion(async (tx) => {
      // 1) Registro `Archivo` del XML ya subido a R2, en la MISMA tx que el movimiento (A2).
      const archivo = await tx.archivo.create({
        data: {
          bucket: subido.bucket,
          key: subido.key,
          nombreOriginal: subido.nombreOriginal,
          tipoMime: subido.tipoMime,
          tamanoBytes: subido.tamanoBytes,
          subidoPorId: sesion.id,
        },
        select: { id: true },
      });

      // 2) Cargo FISCAL de CxC por el TOTAL del CFDI (delega al motor: folio A3, signo por origen,
      //    bitácora A7). El importe llega POSITIVO; el motor le pone el signo (factura + / NC −).
      return registrarMovimientoTercero(
        sesion,
        {
          tipoTercero: 'cliente',
          idTercero: datos.idCliente,
          fecha: parsed.fecha,
          origen,
          importe: parsed.total,
          esFiscal: true,
          uuidCfdi: parsed.uuid,
          rfcTercero: parsed.receptorRfc,
          idArchivoCfdi: archivo.id,
          ...(datos.refTipo === undefined ? {} : { refTipo: datos.refTipo }),
          ...(datos.refId === undefined ? {} : { refId: datos.refId }),
          observaciones,
        },
        { tx },
      );
    }, bd);
  } catch (error) {
    // Backstop ante carrera: dos importaciones del mismo UUID → la unique de E1 lanza P2002.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ErrorConflicto(
        `Este CFDI (UUID ${parsed.uuid}) ya fue importado: no se puede duplicar.`,
      );
    }
    throw error;
  }

  return { movimiento, avisos };
}

/** Línea de pedido con lo mínimo para derivar su total. */
interface LineaPedidoTotal {
  cantidadPedida: number;
  precio: { toNumber(): number };
}

/**
 * Agrega un aviso si el total del PEDIDO LIGADO (derivado por suma de líneas, nunca una columna
 * editable) difiere del total del CFDI. NO se fuerza: el cargo entra por el CFDI (verdad fiscal,
 * §7/R12). El pedido ya viene cargado y validado (misma empresa + mismo cliente), no vuelve a tocar BD.
 */
function avisarDiferenciaPedido(
  pedido: { folio: bigint; lineas: LineaPedidoTotal[] },
  totalCfdi: number,
  avisos: string[],
): void {
  const totalPedido = redondear2(
    pedido.lineas.reduce((s, l) => s + l.cantidadPedida * l.precio.toNumber(), 0),
  );
  const diferencia = redondear2(Math.abs(totalPedido - totalCfdi));
  const relativa = totalCfdi > 0 ? diferencia / totalCfdi : 0;
  if (diferencia >= 0.005 && relativa >= UMBRAL_DIFERENCIA_PEDIDO) {
    avisos.push(
      `El total del CFDI (${totalCfdi.toFixed(2)}) difiere del del pedido ${Number(pedido.folio)} ` +
        `(${totalPedido.toFixed(2)}) por ${diferencia.toFixed(2)}. El cargo entra por el CFDI (verdad fiscal).`,
    );
  }
}
