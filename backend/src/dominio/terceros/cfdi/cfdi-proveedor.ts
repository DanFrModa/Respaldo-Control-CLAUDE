/**
 * ServicioCfdiProveedor — IMPORTACIÓN de CFDI de proveedores a CxP (Módulo 14, F9-E3; R11; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §2). Jala el XML ya SELLADO del proveedor,
 * lo valida (parser puro `parser-cfdi.ts`), lo concilia con el proveedor (por RFC) y una OC (por total
 * cercano), guarda el XML en R2 y crea el cargo FISCAL de CxP por el TOTAL del CFDI. Es importación,
 * NO emisión (R14/PAC es posterior).
 *
 * COMPOSICIÓN (sin duplicar el motor): la alta del cargo DELEGA en `registrarMovimientoTercero`
 * (F9-E1) — mismo folio A3, mismo signo por origen, misma bitácora A7, misma transacción A2. El XML se
 * guarda por el MOTOR DE ARCHIVOS de F0, pero SERVER-SIDE (el servidor ya tiene los bytes: los recibe
 * y parsea): se sube el objeto a R2 PRIMERO y LUEGO, en la transacción, se crea el registro `Archivo`
 * + el movimiento (o TODO o NADA). Se hace server-side —no presigned del navegador— porque un cargo
 * FISCAL sin su XML sería IRRECUPERABLE (la unique del UUID bloquea el re-import): si en cambio la tx
 * falla tras subir, el objeto queda huérfano en R2, que es inocuo (trade-off ya aceptado en el repo).
 *
 * REGLA DE ORO (R11): el XML es la VERDAD FISCAL → el cargo entra por el TOTAL del CFDI; las
 * diferencias con la OC NO se fuerzan (viajan como AVISOS). El UUID es único (anti-duplicado): chequeo
 * previo para un error limpio + la unique de E1 como backstop ante carreras.
 *
 * PERMISOS (A4, deny-by-default): importar/previsualizar un CFDI de proveedor ES administrar CxP →
 * REUSA `cxp.administrar` (SIN permiso nuevo, SIN seed nuevo). Al delegar al motor se exige ADEMÁS
 * `terceros.administrar` (defensa en profundidad; mismo reparto en el seed). Empresa activa (A9).
 */
import {
  esquemaCfdiXml,
  esquemaCfdiImportarEntrada,
  type CfdiDatos,
  type CfdiCandidatoProveedor,
  type CfdiCandidatoOc,
  type CfdiPrevisualizacion,
  type CfdiImportarSalida,
  type DatosCfdiImportar,
  type MovimientoTerceroSalida,
} from '../../../contrato/index.js';
import type { z } from 'zod';

import { servicioArchivos, type ServicioArchivos } from '../../../comun/archivos.js';
import { ErrorConflicto, ErrorValidacion } from '../../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, enTransaccion, type ContextoBd } from '../../../comun/transaccion.js';
import { validarEntrada } from '../../../comun/validacion.js';
import { Prisma, type EstatusOrdenCompra } from '../../../datos/index.js';

import { registrarMovimientoTercero } from '../cuenta-terceros.js';
import { rfcEmpresaActiva, uuidYaImportado } from './cfdi-comun.js';
import {
  parsearCfdi,
  origenDeTipoComprobante,
  normalizarRfc,
  type CfdiParseado,
} from './parser-cfdi.js';

/** Carpeta R2 de los XML de CFDI de proveedores (la key real la ordena el motor: carpeta/<uuid>/nombre). */
const CARPETA_CFDI = 'cfdi/proveedores';

/** Estatus de OC conciliables con un CFDI (ya autorizadas / con recepción; nunca borrador/cancelada). */
const ESTATUS_OC_CONCILIABLES: readonly EstatusOrdenCompra[] = [
  'autorizada',
  'recibida_parcial',
  'recibida_total',
];

/** Máximo de OCs candidatas devueltas (las más cercanas por total). */
const MAX_CANDIDATOS_OC = 8;

/** Umbral relativo para AVISAR de diferencia OC↔CFDI (0.005 = 0.5%). */
const UMBRAL_DIFERENCIA_OC = 0.005;

/** Redondeo monetario a 2 decimales. */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Redondeo a 4 decimales (para la diferencia relativa). */
function redondear4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Valida el RECEPTOR del CFDI contra el RFC de la empresa activa. Si la empresa tiene RFC capturado y
 * NO coincide, lanza (no se importa un CFDI ajeno). Si la empresa aún no tiene RFC, NO rechaza:
 * devuelve un AVISO. Devuelve la lista de avisos (vacía o con el aviso de "no validado").
 */
export function validarReceptorCfdi(parsed: CfdiParseado, esperado: string | null): string[] {
  if (esperado === null) {
    return [
      `No se validó el RFC del receptor (la empresa aún no captura su RFC): el CFDI está dirigido ` +
        `a ${parsed.receptorRfc}${parsed.receptorNombre === null ? '' : ` — ${parsed.receptorNombre}`}. ` +
        `Verifica que sea tu empresa (captúralo en Administración › Empresas para validarlo).`,
    ];
  }
  if (normalizarRfc(parsed.receptorRfc) !== normalizarRfc(esperado)) {
    throw new ErrorConflicto(
      `El CFDI está dirigido al RFC ${parsed.receptorRfc}, no al de tu empresa (${esperado}). ` +
        `No se puede importar un comprobante ajeno.`,
    );
  }
  return [];
}

/** Proyecta el CFDI parseado a la forma del contrato (agrega el `origen` derivado del tipo). */
function aDatosSalida(parsed: CfdiParseado): CfdiDatos {
  return {
    version: parsed.version,
    tipoComprobante: parsed.tipoComprobante,
    origen: origenDeTipoComprobante(parsed.tipoComprobante),
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

/** Busca un proveedor por el RFC del emisor (insensible a mayúsculas). Null si ninguno coincide. */
async function matchProveedor(
  cliente: ReturnType<typeof clienteLectura>,
  emisorRfc: string,
): Promise<CfdiCandidatoProveedor | null> {
  const proveedor = await cliente.proveedor.findFirst({
    where: { rfc: { equals: emisorRfc, mode: 'insensitive' } },
    select: { id: true, nombre: true, rfc: true, nombreCorto: true },
  });
  if (proveedor === null) {
    return null;
  }
  return {
    idProveedor: proveedor.id,
    nombre: proveedor.nombre,
    rfc: proveedor.rfc,
    nombreCorto: proveedor.nombreCorto,
  };
}

/**
 * Órdenes de compra candidatas de un proveedor para ligar el CFDI: mismo proveedor + total cercano
 * (heurística honesta). El total de cada OC se DERIVA por suma de líneas (nunca una columna editable);
 * se ordenan por cercanía al total del CFDI. La elección la hace el usuario (no se auto-liga).
 */
async function matchOcs(
  cliente: ReturnType<typeof clienteLectura>,
  idEmpresa: number,
  idProveedor: number,
  totalCfdi: number,
  puedeVerImportes: boolean,
): Promise<CfdiCandidatoOc[]> {
  const ocs = await cliente.ordenCompra.findMany({
    where: { idEmpresa, idProveedor, estatus: { in: [...ESTATUS_OC_CONCILIABLES] } },
    include: { lineas: { select: { cantidad: true, precio: true } } },
    orderBy: { numCompra: 'desc' },
    take: 100,
  });

  const conTotal = ocs.map((oc) => {
    const total = redondear2(
      oc.lineas.reduce((s, l) => s + l.cantidad.toNumber() * l.precio.toNumber(), 0),
    );
    const diferencia = redondear2(Math.abs(total - totalCfdi));
    const diferenciaRelativa = totalCfdi > 0 ? redondear4(diferencia / totalCfdi) : null;
    return { oc, total, diferencia, diferenciaRelativa };
  });
  // Más cercano primero; empate → folio más reciente.
  conTotal.sort(
    (a, b) => a.diferencia - b.diferencia || (a.oc.numCompra < b.oc.numCompra ? 1 : -1),
  );

  return conTotal
    .slice(0, MAX_CANDIDATOS_OC)
    .map(({ oc, total, diferencia, diferenciaRelativa }) => ({
      idOrdenCompra: oc.id,
      numCompra: Number(oc.numCompra),
      fecha: oc.fecha === null ? null : oc.fecha.toISOString().slice(0, 10),
      estatus: oc.estatus,
      total: puedeVerImportes ? total : null,
      diferencia: puedeVerImportes ? diferencia : null,
      diferenciaRelativa: puedeVerImportes ? diferenciaRelativa : null,
    }));
}

// ── Previsualización ─────────────────────────────────────────────────────────────────────────────

/**
 * Previsualiza un CFDI: lo parsea/valida (parser puro) y devuelve los datos + candidatos de
 * conciliación (proveedor por RFC, OCs por total cercano) + avisos (receptor, duplicado). NO escribe
 * nada. Permiso `cxp.administrar` (la previsualización es el primer paso del alta). Empresa activa (A9).
 */
export async function previsualizarCfdi(
  sesion: SesionUsuario,
  entrada: z.input<typeof esquemaCfdiXml>,
  bd?: ContextoBd,
): Promise<CfdiPrevisualizacion> {
  verificarPermiso(sesion, 'cxp.administrar');
  const datos = validarEntrada(esquemaCfdiXml, entrada);
  const parsed = parsearCfdi(datos.xml);

  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const avisos = validarReceptorCfdi(parsed, await rfcEmpresaActiva(cliente, idEmpresa));

  const candidatoProveedor = await matchProveedor(cliente, parsed.emisorRfc);
  const yaImportado = await uuidYaImportado(cliente, parsed.uuid);
  if (yaImportado) {
    avisos.push(`Este CFDI (UUID ${parsed.uuid}) YA fue importado: no se puede duplicar.`);
  }
  if (candidatoProveedor === null) {
    avisos.push(
      `Ningún proveedor del catálogo tiene el RFC del emisor (${parsed.emisorRfc}). ` +
        `Elige el proveedor a mano o captura su RFC en el catálogo.`,
    );
  }

  const candidatosOc =
    candidatoProveedor === null
      ? []
      : await matchOcs(
          cliente,
          idEmpresa,
          candidatoProveedor.idProveedor,
          parsed.total,
          puedeVerImportes,
        );

  return {
    datos: aDatosSalida(parsed),
    candidatoProveedor,
    candidatosOc,
    yaImportado,
    avisos,
  };
}

// ── Importación ──────────────────────────────────────────────────────────────────────────────────

/**
 * Importa un CFDI a CxP: valida el XML, guarda el XML en R2 y crea el cargo FISCAL por el TOTAL del
 * CFDI (I → `factura_proveedor` +, E → `nota_credito` −), ligado a la operación elegida (o sin OC, con
 * aviso), TODO en una transacción (A2). El UUID duplicado se rechaza (`ErrorConflicto`), sin dejar el
 * cargo a medias. Las diferencias de monto OC↔CFDI NO se fuerzan (avisos). Permiso `cxp.administrar`.
 * Empresa activa (A9). El servicio de archivos se inyecta (default lazy) para tests sin R2 real.
 */
export async function importarCfdi(
  sesion: SesionUsuario,
  entrada: z.input<typeof esquemaCfdiImportarEntrada>,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<CfdiImportarSalida> {
  verificarPermiso(sesion, 'cxp.administrar');
  const datos: DatosCfdiImportar = validarEntrada(esquemaCfdiImportarEntrada, entrada);
  const parsed = parsearCfdi(datos.xml);

  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const origen = origenDeTipoComprobante(parsed.tipoComprobante);

  // Rechaza (o avisa) según el RFC de la empresa activa (A9) — ANTES de escribir nada.
  const avisos = validarReceptorCfdi(parsed, await rfcEmpresaActiva(cliente, idEmpresa));

  // Anti-duplicado: chequeo previo para un error limpio (la unique global de E1 es el backstop).
  if (await uuidYaImportado(cliente, parsed.uuid)) {
    throw new ErrorConflicto(
      `Este CFDI (UUID ${parsed.uuid}) ya fue importado: no se puede duplicar.`,
    );
  }

  // Aviso si el proveedor elegido no coincide con el emisor del CFDI (el usuario eligió a mano).
  const proveedor = await cliente.proveedor.findUnique({
    where: { id: datos.idProveedor },
    select: { nombre: true, rfc: true },
  });
  if (
    proveedor !== null &&
    proveedor.rfc !== null &&
    normalizarRfc(proveedor.rfc) !== normalizarRfc(parsed.emisorRfc)
  ) {
    avisos.push(
      `El proveedor elegido (${proveedor.nombre}, RFC ${proveedor.rfc}) no coincide con el emisor ` +
        `del CFDI (RFC ${parsed.emisorRfc}). Verifica que sea el correcto.`,
    );
  }

  // Liga a la operación real. S2: si se liga una OC, DEBE ser del proveedor elegido y de la empresa
  // activa (A9). Que la OC sea de OTRO proveedor NO es un simple aviso: ligar el cargo a la OC ajena
  // descuadraría la conciliación de CxP → ErrorValidacion (ANTES de escribir/subir). Sin liga, solo avisa.
  if (datos.refTipo === undefined) {
    avisos.push('El cargo se registró SIN ligarse a una OC/recepción.');
  } else if (datos.refTipo === 'orden-compra' && datos.refId !== undefined) {
    const oc = await cliente.ordenCompra.findFirst({
      where: { id: datos.refId, idEmpresa },
      include: { lineas: { select: { cantidad: true, precio: true } } },
    });
    if (oc === null) {
      throw new ErrorValidacion('La orden de compra ligada no existe o no es de tu empresa.');
    }
    if (oc.idProveedor !== datos.idProveedor) {
      throw new ErrorValidacion(
        `La orden de compra ${Number(oc.numCompra)} es de otro proveedor: no se puede ligar el CFDI ` +
          `al proveedor elegido. Elige una OC de ese proveedor o impórtalo sin OC.`,
      );
    }
    avisarDiferenciaOc(oc, parsed.total, avisos);
  }

  const observaciones = datos.observaciones ?? `CFDI ${parsed.tipoComprobante} ${parsed.uuid}`;
  const anio = parsed.fecha.slice(0, 4);

  // Sube el XML a R2 SERVER-SIDE ANTES de la transacción (orden seguro): el servidor ya tiene los bytes.
  // Si la tx falla luego, el objeto queda huérfano en R2 (inocuo); NUNCA al revés (un cargo fiscal sin
  // su XML sería irrecuperable por la unique del UUID). Se llega aquí solo tras pasar TODAS las
  // validaciones (receptor, duplicado, OC↔proveedor): no se sube nada de una importación que se rechaza.
  const subido = await archivos.subirContenido({
    nombreOriginal: `cfdi-${parsed.uuid}.xml`,
    tipoMime: 'application/xml',
    carpeta: `${CARPETA_CFDI}/${anio}`,
    contenido: Buffer.from(datos.xml, 'utf8'),
  });

  let movimiento: MovimientoTerceroSalida;
  try {
    movimiento = await enTransaccion(async (tx) => {
      // 1) Registro `Archivo` del XML ya subido a R2, en la MISMA tx que el movimiento (A2): si el alta
      //    falla, el registro se revierte (el objeto en R2 queda huérfano, inocuo).
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

      // 2) Cargo FISCAL de CxP por el TOTAL del CFDI (delega al motor: folio A3, signo por origen,
      //    bitácora A7). El importe llega POSITIVO; el motor le pone el signo (factura + / NC −).
      return registrarMovimientoTercero(
        sesion,
        {
          tipoTercero: 'proveedor',
          idTercero: datos.idProveedor,
          fecha: parsed.fecha,
          origen,
          importe: parsed.total,
          esFiscal: true,
          uuidCfdi: parsed.uuid,
          rfcTercero: parsed.emisorRfc,
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

/** Línea de OC con lo mínimo para derivar su total (Decimal expone `toNumber`). */
interface LineaOcTotal {
  cantidad: { toNumber(): number };
  precio: { toNumber(): number };
}

/**
 * Agrega un aviso si el total de la OC LIGADA (derivado por suma de líneas, nunca una columna editable)
 * difiere del total del CFDI. NO se fuerza: el cargo entra por el CFDI (verdad fiscal, §7/R11). La OC ya
 * viene cargada y validada (misma empresa + mismo proveedor, S2), así que no vuelve a tocar la BD.
 */
function avisarDiferenciaOc(
  oc: { numCompra: bigint; lineas: LineaOcTotal[] },
  totalCfdi: number,
  avisos: string[],
): void {
  const totalOc = redondear2(
    oc.lineas.reduce((s, l) => s + l.cantidad.toNumber() * l.precio.toNumber(), 0),
  );
  const diferencia = redondear2(Math.abs(totalOc - totalCfdi));
  const relativa = totalCfdi > 0 ? diferencia / totalCfdi : 0;
  if (diferencia >= 0.005 && relativa >= UMBRAL_DIFERENCIA_OC) {
    avisos.push(
      `El total del CFDI (${totalCfdi.toFixed(2)}) difiere del de la OC ${Number(oc.numCompra)} ` +
        `(${totalOc.toFixed(2)}) por ${diferencia.toFixed(2)}. El cargo entra por el CFDI (verdad fiscal).`,
    );
  }
}
