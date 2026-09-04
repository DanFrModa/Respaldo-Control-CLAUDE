/**
 * ENTRADA DE TELA por FACTURA/REMISIÓN del proveedor (etapa B1; §Post-F9.11 para el modelo por
 * color). Toda la lógica vive AQUÍ (A1); las rutas sólo validan permiso + Zod y delegan.
 *
 * 🔴 **SIEMPRE CONTRA UNA ORDEN DE COMPRA — §Post-F9.159(a) (Daniel, 30-ago-2026).** El documento
 * nació como *"la vía sin OC"* (§Post-F9.9 punto 7). Esa línea quedó **SUPERADA**, textual:
 *
 *   > *«es imposible. Porque sin OC no podemos recibir tela. **¿De quién recibiríamos sin OC?** No
 *   > puede suceder.»*
 *
 * ⇒ **Se IMPIDE, no se avisa.** Lo que se cerró es el RENGLÓN suelto, no el documento: la
 * factura/remisión sigue siendo el soporte de lo que mandó el proveedor (su número, su PDF, su
 * CFDI, su cuenta por pagar), pero **cada renglón tiene que decir qué renglón de OC surte**. El
 * reencuadre de §Post-F9.144(d) es el porqué: recibir sin OC **no es una función que falte, es el
 * SÍNTOMA de que faltó la compra** — dejarlo pasar borra la única señal.
 *
 * DÓNDE SE EXIGE (embudo): {@link exigirRenglonesConOrdenDeCompra}, llamado desde
 * `validarCabeceraYLineas`, por el que pasan las TRES puertas de escritura —capturar, editar y
 * **confirmar**—; un borrador viejo con renglones sueltos tampoco se puede confirmar. El contrato
 * (`contrato/esquemas/entrada-tela.ts`) además lo exige antes de llegar a la base.
 *
 * ⚠️ **LEER NO SE ROMPE (D3).** `EntradaTelaLinea.idOrdenCompraLinea` sigue siendo NULLABLE en la
 * base **a propósito**: hay documentos anteriores a esta decisión con renglones sueltos y se
 * siguen listando, consultando e imprimiendo. Ponerla NOT NULL obligaría a tocar esos datos, que es
 * justo lo que la REGLA 0-B prohíbe (lo viejo se limpia, no se repara). La invariante la sostiene
 * el dominio, no la columna.
 *
 * Ciclo del documento (`EstatusEntradaTela`):
 *  1. `borrador` — se captura la cabecera (factura|remisión + número + proveedor + fecha + almacén)
 *     y sus N renglones. NO toca el inventario: se puede editar y se le puede adjuntar el PDF de la
 *     factura mientras se aclara lo que llegó.
 *  2. `confirmada` — en UNA transacción (A2): cada renglón crea SU `PartidaTela` (folio atómico A3)
 *     y el documento registra UN movimiento de kardex de entrada (`entrada-recepcion`, origen
 *     `entrada-tela`) por el motor `comun/kardex.ts`. A partir de aquí el documento es INMUTABLE.
 *  3. `cancelada` — cancelación SUAVE con motivo (A7). Si estaba confirmada, el kardex se
 *     neutraliza con el movimiento INVERSO auditado (`cancelarMovimientoMaterial`): NUNCA se edita
 *     ni se borra un movimiento (D3).
 *
 * Reglas del renglón (idénticas a las del ajuste por color de A2, reusando `resolverColores`):
 *  • El CUERPO (`cantidad`) admite 0 (compra de solo complemento) y el COMPLEMENTO viaja junto;
 *    una tela SIN complemento rechaza cantidad de complemento.
 *  • El MISMO tela+color puede repetirse en varios renglones: una factura con dos lotes del mismo
 *    color son DOS partidas (§Post-F9.11 punto 4).
 *
 * PRECIO → KARDEX (D1 — el costo vive en el movimiento): AMBOS precios viajan al renglón de
 * `MovimientoDetTela`. `precioUnit` (precio por unidad del CUERPO) va como `costoUnit` y
 * `precioUnitComplemento` (*"el cardigan es otro precio que la tela"*) va como
 * `costoUnitComplemento` (columna de B1): el renglón valúa CADA componente con SU costo
 * (`costoUnit × cuerpo` + `costoUnitComplemento × complemento`), así que un renglón de SOLO
 * complemento (cuerpo 0) TAMBIÉN queda valuado y §Post-F9.11 punto 6 (costo por consumo) no nace
 * cojo. Los precios se conservan además en `EntradaTelaLinea` (el documento es el soporte de lo
 * que se pagó, aunque el kardex ya sepa valuarlo).
 *
 * RUTA CRÍTICA — esta puerta NO dispara el hito `compraTela`, y es a propósito: ese proceso se
 * completa al **AUTORIZAR la OC** (`reevaluarCompraTela` mira `OrdenCompra`, evento
 * `ocTelaResuelta`), que ocurre ANTES de que llegue la tela; recibirla no lo vuelve a mover. Lo que
 * sí sale desde aquí es el evento `material-recibido` de cada recepción generada (§Post-F9.14),
 * igual que por la puerta de `dominio/compras/recepciones.ts`.
 *
 * A4 — permisos REUSADOS: `inventario-telas.ver` (leer) / `inventario-telas.mover` (capturar,
 * confirmar, cancelar). CERO permisos nuevos, cero seed. A9 — todo se filtra/sella por la empresa
 * activa de la sesión.
 */
import {
  esquemaEntradaTelaCrear,
  esquemaEntradaTelaActualizar,
  esquemaEntradaTelaCancelarCuerpo,
  esquemaEntradasTelaQuery,
  type esquemaMovimientoTerceroCrear,
  type DatosEntradaTelaCrear,
  type EntradaTelaLineaSalida,
  type EntradaTelaSalida,
  type EntradasTelaPagina,
} from '../../contrato/index.js';
import {
  EstatusEntradaTela,
  Prisma,
  type ModalidadFacturacion,
  type TipoDocumentoEntradaTela,
} from '../../datos/index.js';
import type { z } from 'zod';

import { exigirAlmacenDelTipo } from '../../comun/almacenes.js';
import { type ServicioArchivos } from '../../comun/archivos.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  cancelarMovimientoMaterial,
  registrarMovimientoTela,
  type LineaMovimientoTela,
} from '../../comun/kardex.js';
import { ORIGEN } from '../../comun/origenes.js';
import { verificarPermiso, tienePermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import {
  bloquearOrdenesDeRenglones,
  registrarRecepcionesDesdeEntradaTela,
  reversarRecepcionesDeEntradaTela,
  type RenglonEntradaTelaRecibido,
} from '../compras/recepciones.js';
import {
  aLineasMotor,
  crearPartidaTela,
  resolverColores,
  type LineaColorBase,
} from './partidas-telas.js';
import { aDateColumna, aNumero, tipoPorCodigo } from './telas.js';
import {
  exigirRfcDelProveedor,
  exigirSelloCompatibleConProveedor,
  exigirUuidLibreEnEntradas,
  sellarCfdiEnEntrada,
  type SelloCfdi,
} from './cfdi-entrada-tela.js';
import { normalizarRfc } from '../terceros/cfdi/parser-cfdi.js';
import { uuidYaImportado } from '../terceros/cfdi/cfdi-comun.js';
import {
  cancelarMovimientoTerceroInterno,
  registrarMovimientoTerceroInterno,
} from '../terceros/cuenta-terceros.js';
import { exigirProveedorQueFactura, modalidadFactura } from '../terceros/facturacion-proveedor.js';

/**
 * QUÉ HACER cuando el folio fiscal ya está ocupado en Cuentas por pagar. Es UNA sola frase, usada
 * por los dos mensajes de choque, y dice **la única salida que de verdad existe** hoy.
 *
 * POR QUÉ SE REESCRIBIÓ (hallazgo de la revisión del 11-ago-2026): antes proponía dos caminos y
 * **ninguno** funcionaba —
 *  • *"quítale la factura a la entrada"*: ya no se puede. El `uuidCfdi` **salió del contrato del
 *    PUT** (arreglo 1 de §Post-F9.21) y el sello se conserva siempre al editar: no queda ningún
 *    camino que lo ponga en NULL. Y no se le agregó uno a propósito: soltar un dato fiscal desde la
 *    edición es justo la superficie que se acaba de cerrar, y un BORRADOR no cuesta nada de
 *    recapturar (no tocó inventario ni generó cargo).
 *  • *"cancela ese movimiento en Finanzas"*: no libera nada. La unique de `MovimientoTercero.uuidCfdi`
 *    es **global**, el movimiento inverso de la cancelación **no copia** el UUID y `uuidYaImportado`
 *    no filtra los cancelados: una vez importado, ese folio queda consumido para siempre.
 *
 * Un mensaje que manda a hacer algo imposible es peor que no decir nada: quien captura pierde el
 * rato y termina creyendo que el sistema está roto.
 */
const SALIDA_UUID_CONSUMIDO =
  'Ese folio fiscal ya quedó consumido y cancelar el movimiento en Finanzas NO lo libera. Para ' +
  'recibir la tela: CANCELA este borrador y vuelve a capturarlo SIN el XML (como remisión/captura ' +
  'a mano) — la deuda con el proveedor ya está registrada en Finanzas, así que no se pierde nada.';

/** Origen del cargo de CxP que nace al confirmar una entrada con su CFDI (§Post-F9.21). */
const ORIGEN_FACTURA_PROVEEDOR = 'factura_proveedor';
/** Discriminador de la operación ligada al cargo: la entrada de tela que lo originó. */
const REF_ENTRADA_TELA = 'entrada-tela';

/** Clave de la secuencia de folios del documento de entrada (A3 — por empresa, jamás Max()+1). */
export const CLAVE_SECUENCIA_ENTRADA_TELA = 'entrada-tela';

/** Tipo de movimiento de la ENTRADA al confirmar (ya sembrado en F4-E1; no se inventan tipos). */
const COD_ENTRADA_RECEPCION = 'entrada-recepcion';
/** Tipo INVERSO para neutralizar la entrada al cancelar (dirección salida). */
const COD_AJUSTE_SALIDA = 'ajuste-salida';

// ── Proyección a la salida ───────────────────────────────────────────────────────────────────────

/** `include` para proyectar un documento con todo lo que la UI necesita. */
const incluirEntradaTela = {
  proveedor: { select: { nombre: true } },
  almacen: { select: { nombre: true } },
  movimiento: { select: { folio: true } },
  lineas: {
    orderBy: { id: 'asc' },
    include: {
      telaColor: {
        select: {
          nombre: true,
          pantone: true,
          tela: {
            select: {
              id: true,
              nombre: true,
              unidadMedida: true,
              nombreCuerpo: true,
              nombreComplemento: true,
            },
          },
        },
      },
      partida: { select: { folio: true } },
      // §Post-F9.14: la OC que surte el renglón, para mostrar su folio en el documento.
      //
      // ⚠️ **DEUDA CONOCIDA — FUGA A9 DE UN FOLIO DE OC DE OTRA EMPRESA** (pre-existente, anterior a
      // §Post-F9.159(a); nombrada así por la revisión de la 0.078). Este `include` NO filtra por
      // empresa, y CAPTURAR tampoco valida de quién es el `idOrdenCompraLinea` que llega: quien
      // llame al API a mano puede guardar un borrador apuntando a la OC de OTRA empresa y la
      // lectura le devolverá su `numCompra`. No es sólo "falta una validación": **se filtra un dato
      // de otra empresa**, que es justo lo que A9 prohíbe.
      // Lo que SÍ está cerrado: CONFIRMAR lo rechaza (`registrarRecepcionesDesdeEntradaTela` exige
      // `ordenCompra.idEmpresa === cabecera.idEmpresa`, `compras/recepciones.ts:831-834`), así que
      // no puede convertirse en inventario ni en recepción. El arreglo es validar la OC (empresa +
      // proveedor) al capturar; no se hizo en esta etapa para no ampliar su alcance.
      ordenCompraLinea: { select: { ordenCompra: { select: { numCompra: true } } } },
    },
  },
  _count: { select: { archivos: true } },
} satisfies Prisma.EntradaTelaInclude;

type EntradaTelaConDetalle = Prisma.EntradaTelaGetPayload<{ include: typeof incluirEntradaTela }>;

/**
 * Proyecta un documento (con detalle) a la forma del contrato. `verImportes` (ex-acceso #7
 * `telas.ver-totales`) decide si viajan los precios/importes o van en null — el ocultamiento es
 * server-side (A4), igual que en el kardex de telas.
 */
function aEntradaTelaSalida(
  e: EntradaTelaConDetalle,
  verImportes: boolean,
  avisos: string[] = [],
): EntradaTelaSalida {
  let totalCuerpo = 0;
  let totalComplemento = 0;
  let totalImporte = 0;
  let hayImporte = false;

  const lineas: EntradaTelaLineaSalida[] = e.lineas.map((l) => {
    const cantidad = Number(l.cantidad);
    const cantidadComplemento = aNumero(l.cantidadComplemento);
    totalCuerpo += cantidad;
    totalComplemento += cantidadComplemento ?? 0;

    const precioUnit = verImportes ? aNumero(l.precioUnit) : null;
    const precioUnitComplemento = verImportes ? aNumero(l.precioUnitComplemento) : null;
    // El importe del renglón suma AMBOS componentes con su propio precio (el documento sí sabe
    // valuar el complemento; el kardex, hoy, sólo el cuerpo).
    const importeCuerpo = precioUnit === null ? null : precioUnit * cantidad;
    const importeComplemento =
      precioUnitComplemento === null ? null : precioUnitComplemento * (cantidadComplemento ?? 0);
    const importe =
      importeCuerpo === null && importeComplemento === null
        ? null
        : (importeCuerpo ?? 0) + (importeComplemento ?? 0);
    if (importe !== null) {
      totalImporte += importe;
      hayImporte = true;
    }

    return {
      id: l.id,
      idTela: l.telaColor.tela.id,
      tela: l.telaColor.tela.nombre,
      idTelaColor: l.idTelaColor,
      telaColor: l.telaColor.nombre,
      pantone: l.telaColor.pantone,
      unidadMedida: l.telaColor.tela.unidadMedida,
      nombreCuerpo: l.telaColor.tela.nombreCuerpo,
      nombreComplemento: l.telaColor.tela.nombreComplemento,
      cantidad,
      cantidadComplemento,
      precioUnit,
      precioUnitComplemento,
      importe,
      loteProveedor: l.loteProveedor,
      idPartida: l.idPartida,
      partidaFolio: l.partida === null ? null : Number(l.partida.folio),
      idOrdenCompraLinea: l.idOrdenCompraLinea,
      numCompra:
        l.ordenCompraLinea === null ? null : Number(l.ordenCompraLinea.ordenCompra.numCompra),
    };
  });

  return {
    id: e.id,
    folio: Number(e.folio),
    idEmpresa: e.idEmpresa,
    tipoDocumento: e.tipoDocumento,
    numeroDocumento: e.numeroDocumento,
    uuidCfdi: e.uuidCfdi,
    totalCfdi: e.totalCfdi === null ? null : e.totalCfdi.toNumber(),
    idProveedor: e.idProveedor,
    proveedor: e.proveedor.nombre,
    fecha: e.fecha.toISOString().slice(0, 10),
    idAlmacen: e.idAlmacen,
    almacen: e.almacen.nombre,
    observaciones: e.observaciones,
    estatus: e.estatus,
    idMovimiento: e.idMovimiento,
    folioMovimiento: e.movimiento === null ? null : Number(e.movimiento.folio),
    confirmadaEn: e.confirmadaEn === null ? null : e.confirmadaEn.toISOString(),
    confirmadaPorId: e.confirmadaPorId,
    canceladaEn: e.canceladaEn === null ? null : e.canceladaEn.toISOString(),
    canceladaPorId: e.canceladaPorId,
    motivoCancelacion: e.motivoCancelacion,
    lineas,
    totalCuerpo,
    totalComplemento,
    totalImporte: verImportes && hayImporte ? totalImporte : null,
    numeroAdjuntos: e._count.archivos,
    avisos,
    creadoEn: e.creadoEn.toISOString(),
    creadoPorId: e.creadoPorId,
  };
}

/** Lo mínimo que el detector de duplicados necesita de un documento. */
interface DocumentoParaAviso {
  id: number;
  idProveedor: number;
  numeroDocumento: string;
}

/**
 * AVISO SUAVE de FACTURA REPETIDA (B1): busca, para los documentos dados, si la empresa ya tiene
 * OTRO documento VIVO (no cancelado) del MISMO proveedor con el MISMO número — el caso típico de
 * capturar dos veces la misma factura y duplicar la entrada de tela.
 *
 * Es un AVISO, NO un bloqueo, y a propósito: no hay unicidad dura porque el número del documento lo
 * pone el proveedor y en la vida real se repite legítimamente (series distintas, remisión y factura
 * con el mismo folio, correcciones). El objetivo es que el capturista LO VEA, no impedirle
 * trabajar. Una sola consulta para toda la página (sin N+1). Devuelve `Map<idDocumento, avisos[]>`.
 */
async function avisosDuplicado(
  cliente: ReturnType<typeof clienteLectura>,
  idEmpresa: number,
  documentos: readonly DocumentoParaAviso[],
): Promise<Map<number, string[]>> {
  const avisos = new Map<number, string[]>();
  if (documentos.length === 0) {
    return avisos;
  }
  const hermanos = await cliente.entradaTela.findMany({
    where: {
      idEmpresa,
      estatus: { not: EstatusEntradaTela.cancelada },
      OR: documentos.map((d) => ({
        idProveedor: d.idProveedor,
        numeroDocumento: d.numeroDocumento,
      })),
    },
    select: { id: true, folio: true, idProveedor: true, numeroDocumento: true },
  });
  for (const documento of documentos) {
    const repetidos = hermanos.filter(
      (h) =>
        h.id !== documento.id &&
        h.idProveedor === documento.idProveedor &&
        h.numeroDocumento === documento.numeroDocumento,
    );
    if (repetidos.length > 0) {
      avisos.set(documento.id, [
        `Ojo: ya hay ${repetidos.length === 1 ? 'otra entrada' : `otras ${repetidos.length} entradas`} ` +
          `de este proveedor con el documento "${documento.numeroDocumento}" ` +
          `(folio ${repetidos.map((r) => Number(r.folio)).join(', ')}). Revisa que no sea la misma factura capturada dos veces.`,
      ]);
    }
  }
  return avisos;
}

/** Obtiene un documento de la empresa activa (A9) o lanza. */
async function obtener(
  id: number,
  idEmpresa: number,
  verImportes: boolean,
  bd?: ContextoBd,
): Promise<EntradaTelaSalida> {
  const cliente = clienteLectura(bd);
  const entrada = await cliente.entradaTela.findFirst({
    where: { id, idEmpresa },
    include: incluirEntradaTela,
  });
  if (entrada === null) {
    throw new ErrorNoEncontrado('EntradaTela', id);
  }
  // El aviso de factura repetida se calcula al LEER (así lo ve tanto quien captura como quien
  // revisa después); una entrada cancelada ya no molesta con él.
  const avisos =
    entrada.estatus === EstatusEntradaTela.cancelada
      ? new Map<number, string[]>()
      : await avisosDuplicado(cliente, idEmpresa, [entrada]);
  return aEntradaTelaSalida(entrada, verImportes, avisos.get(entrada.id) ?? []);
}

/**
 * Exige que el documento exista, sea de la empresa activa (A9) y esté en `borrador` (lo demás es
 * inmutable, D3). Devuelve su id, folio y el SELLO fiscal que ya trae (para conservarlo/re-validarlo).
 */
async function exigirBorrador(
  tx: Tx,
  id: number,
  idEmpresa: number,
): Promise<{
  id: number;
  folio: bigint;
  uuidCfdi: string | null;
  rfcCfdi: string | null;
  idProveedor: number;
}> {
  const entrada = await tx.entradaTela.findFirst({
    where: { id, idEmpresa },
    select: {
      id: true,
      folio: true,
      estatus: true,
      uuidCfdi: true,
      rfcCfdi: true,
      idProveedor: true,
    },
  });
  if (entrada === null) {
    throw new ErrorNoEncontrado('EntradaTela', id);
  }
  if (entrada.estatus !== EstatusEntradaTela.borrador) {
    throw new ErrorConflicto(
      entrada.estatus === EstatusEntradaTela.confirmada
        ? `La entrada ${Number(entrada.folio)} ya está confirmada: una entrada confirmada no se edita (cancélala y captura otra).`
        : `La entrada ${Number(entrada.folio)} está cancelada: ya no se puede modificar.`,
    );
  }
  return {
    id: entrada.id,
    folio: entrada.folio,
    uuidCfdi: entrada.uuidCfdi,
    rfcCfdi: entrada.rfcCfdi,
    idProveedor: entrada.idProveedor,
  };
}

/**
 * Renglón de entrada de tela tal como lo ven las validaciones: el color y sus cantidades
 * (`LineaColorBase`, que se comparte con ajustes/traspasos/salidas) MÁS el renglón de OC que lo
 * surte.
 *
 * `idOrdenCompraLinea` es OBLIGATORIO **en el tipo** —aunque su valor admita `null`— a propósito:
 * un llamador nuevo no puede omitirlo por descuido, tiene que escribir de qué OC viene; y si
 * escribe `null`, el embudo lo rechaza en tiempo de ejecución. Falla cerrada por los dos lados.
 */
type LineaEntradaTelaValidable = LineaColorBase & { idOrdenCompraLinea: number | null };

/** Enumera renglones para el mensaje: "el renglón 2", "los renglones 1, 2 y 4". */
function listarRenglones(posiciones: readonly number[]): string {
  if (posiciones.length === 1) {
    return `el renglón ${String(posiciones[0])}`;
  }
  const todos = posiciones.map(String);
  return `los renglones ${todos.slice(0, -1).join(', ')} y ${todos[todos.length - 1] ?? ''}`;
}

/**
 * 🔴 **NO SE RECIBE TELA SIN ORDEN DE COMPRA** (§Post-F9.159(a), Daniel: *«es imposible. Porque sin
 * OC no podemos recibir tela. ¿De quién recibiríamos sin OC? No puede suceder»*). Cada renglón
 * tiene que apuntar al renglón de OC que surte; el que no lo haga se RECHAZA — bloqueo, no aviso.
 *
 * EL MENSAJE NOMBRA LA CAUSA, no el campo: quien captura no tiene por qué saber qué es
 * `idOrdenCompraLinea`; tiene que enterarse de que **falta la compra** (§Post-F9.144(d): recibir sin
 * OC no es una función que falte, es el síntoma de que faltó levantar la orden).
 *
 * FALLA CERRADA de verdad: acepta el campo AUSENTE además del `null` y trata los dos igual. Si
 * mañana un llamador construye el renglón sin la propiedad, cae aquí en vez de colarse.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * QUÉ CIERRA Y QUÉ **NO** (medido, no supuesto — para que nadie lo descubra en seis meses creyendo
 * que la guarda falló):
 *
 * ✅ **Cierra la RECEPCIÓN de tela sin OC por las puertas VIVAS.** El tipo de movimiento
 *    `entrada-recepcion` tiene dos productores en `backend/src`: esta puerta y
 *    `dominio/compras/recepciones.ts` — que siempre nace de una línea de OC. Con esta guarda, las
 *    dos exigen orden de compra.
 *    ⚠️ **Y hay un TERCERO fuera de `src`**, que el absoluto anterior de este comentario ocultaba:
 *    `backend/migracion/loaders/entradas-salidas-telas.ts:70` (el ETL del histórico de Access) usa
 *    el mismo tipo por la vía `dominio/inventarios/migracion.ts`, sin pasar por este dominio. Es
 *    correcto que quede exento —carga historia, no recibe de un proveedor, y REGLA 0-B dice que el
 *    histórico llega incompleto a propósito—, pero **no se corre por la aplicación** y por eso no
 *    lo cubre esta guarda.
 *
 * ⬜ **NO cierra el AJUSTE DE ENTRADA** (`ajustarInventarioTelaColor`, `inventarios/partidas-telas.ts`)
 *    ni el inventario físico (`indicadores/inventario-ciclico.ts`). Los dos pueden SUBIR existencia
 *    de tela —el ajuste hasta guarda lote y factura del proveedor—, así que alguien decidido podría
 *    meter por ahí material que nunca se compró. **Se quedan abiertos A PROPÓSITO**, y no es un
 *    descuido:
 *      • un ajuste **no es recibir de un proveedor**: es una CORRECCIÓN, exige `motivo` obligatorio
 *        (A7), deja bitácora y entra con `origenTipo = movimiento-manual`, no `entrada-tela` — o
 *        sea, es visible y rastreable, no una puerta trasera silenciosa;
 *      • cerrarlo rompería la **toma de inventario físico**, que Daniel no tocó en §Post-F9.159(a).
 *    Si algún día hay que estrecharlo, es una decisión de Daniel, no de esta guarda.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
export function exigirRenglonesConOrdenDeCompra(
  // El `| undefined` explícito es necesario con `exactOptionalPropertyTypes` y además es el punto:
  // la guarda acepta que el campo NO venga, para poder rechazarlo.
  lineas: readonly { idOrdenCompraLinea?: number | null | undefined }[],
): void {
  const sueltos: number[] = [];
  lineas.forEach((linea, i) => {
    if (typeof linea.idOrdenCompraLinea !== 'number') {
      sueltos.push(i + 1);
    }
  });
  if (sueltos.length === 0) {
    return;
  }
  throw new ErrorValidacion(
    `No se puede recibir tela que no se haya comprado: ${listarRenglones(sueltos)} no ` +
      `${sueltos.length === 1 ? 'apunta' : 'apuntan'} a ninguna orden de compra. Captura la tela ` +
      `desde lo que está pendiente de su OC; si no aparece ahí, lo que falta es levantar (y ` +
      `autorizar) la orden de compra al proveedor.`,
  );
}

/**
 * Valida la CABECERA (proveedor vivo + almacén destino de la empresa activa, A9) y los RENGLONES
 * contra el catálogo (colores existentes + reglas del complemento, reusando `resolverColores` de
 * A2), y devuelve el mapa de colores ya resuelto (una sola lectura del catálogo). Se corre TANTO al
 * capturar/editar como al CONFIRMAR (defensa en profundidad: entre el borrador y la confirmación
 * alguien pudo desactivar el almacén o cambiarle el complemento a la tela).
 *
 * ⭐ **ES EL EMBUDO de §Post-F9.159(a).** Por aquí pasan las TRES puertas de escritura del módulo
 * —`crearEntradaTela`, `actualizarEntradaTela` y `confirmarEntradaTela`—, así que la guarda de "sin
 * OC no se recibe" se pone UNA vez y un llamador nuevo queda cubierto por omisión. Va PRIMERO, y
 * antes de tocar la base: es la regla que decide si la operación puede existir siquiera.
 */
async function validarCabeceraYLineas(
  tx: Tx,
  idEmpresa: number,
  idProveedor: number,
  idAlmacen: number,
  lineas: readonly LineaEntradaTelaValidable[],
  tipoDocumento?: TipoDocumentoEntradaTela,
): ReturnType<typeof resolverColores> {
  exigirRenglonesConOrdenDeCompra(lineas);
  const proveedor = await tx.proveedor.findUnique({
    where: { id: idProveedor },
    select: { id: true, activo: true, nombre: true, modalidadFacturacion: true },
  });
  if (proveedor === null) {
    throw new ErrorNoEncontrado('Proveedor', idProveedor);
  }
  if (!proveedor.activo) {
    throw new ErrorValidacion(`El proveedor "${proveedor.nombre}" está desactivado.`);
  }
  // §Post-F9.22 — el proveedor que NO factura no ampara su entrega con una factura: trae remisión o
  // nota. Se valida aquí (y no solo en la pantalla) porque de este tipo de documento depende cómo
  // nace su cuenta por pagar.
  if (tipoDocumento === 'factura') {
    exigirProveedorQueFactura(proveedor, 'capturar el documento como FACTURA');
  }
  // Fila 0.137 — el almacén destino tiene que ser de TELA (además de existir, estar activo y ser de
  // esta empresa, A9). Cubre alta, edición y confirmación: las tres pasan por este embudo.
  await exigirAlmacenDelTipo(tx, idAlmacen, 'TELA', idEmpresa);
  // Los renglones REPETIDOS por tela+color SÍ se permiten: cada uno es su propia partida.
  return resolverColores(tx, lineas, { permitirRepetidos: true });
}

// ── Operaciones de ESCRITURA ─────────────────────────────────────────────────────────────────────

/** Datos de alta del documento (forma del contrato). */
export type EntradaCrearEntradaTela = z.input<typeof esquemaEntradaTelaCrear>;
/** Datos de edición del documento (forma del contrato). */
export type EntradaActualizarEntradaTela = z.input<typeof esquemaEntradaTelaActualizar>;

/** Mapea los renglones validados a las columnas de `EntradaTelaLinea`. */
function aColumnasLinea(
  lineas: DatosEntradaTelaCrear['lineas'],
  llevaComplemento: (idTelaColor: number) => boolean,
  sesion: SesionUsuario,
): Prisma.EntradaTelaLineaCreateManyEntradaTelaInput[] {
  return lineas.map((l) => ({
    idTelaColor: l.idTelaColor,
    cantidad: l.cantidad,
    // NULL distingue "la tela no lleva complemento" de "llevó 0" (mismo criterio que el kardex).
    cantidadComplemento: llevaComplemento(l.idTelaColor) ? (l.cantidadComplemento ?? 0) : null,
    precioUnit: l.precioUnit ?? null,
    precioUnitComplemento: llevaComplemento(l.idTelaColor)
      ? (l.precioUnitComplemento ?? null)
      : null,
    loteProveedor: l.loteProveedor?.trim() || null,
    // §Post-F9.14 + §Post-F9.159(a): qué renglón de OC surte este renglón. Ya no puede faltar —
    // el contrato lo exige y `validarCabeceraYLineas` lo volvió a verificar antes de llegar aquí.
    idOrdenCompraLinea: l.idOrdenCompraLinea,
    ...datosCreacion(sesion),
  }));
}

/**
 * Da de alta un documento de ENTRADA de tela en `borrador` (A2: cabecera + renglones en UNA
 * transacción). Folio atómico por empresa (A3). NO toca el inventario: eso pasa al confirmar.
 * Permiso `inventario-telas.mover`.
 */
export async function crearEntradaTela(
  sesion: SesionUsuario,
  entrada: EntradaCrearEntradaTela,
  bd?: ContextoBd,
  /**
   * Inyectable para probar sin R2 real (mismo patrón que `importarCfdi` de F9). Se pasa TAL CUAL:
   * el servicio se resuelve solo si de verdad hay XML que subir, para que capturar una entrada sin
   * factura no exija tener R2 configurado.
   */
  archivos?: ServicioArchivos,
): Promise<EntradaTelaSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaEntradaTelaCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  // §Post-F9.21 — si la captura trae el XML, se RE-PARSEA en el servidor (el total fiscal jamás se
  // acepta del cliente) y el XML se sube a R2 ANTES de la transacción: si la tx falla, el objeto
  // queda huérfano (inocuo); al revés —un cargo fiscal sin su XML— sería irrecuperable.
  const sello: SelloCfdi | null = await sellarCfdiEnEntrada(
    { xml: datos.xmlCfdi ?? null, idProveedor: datos.idProveedor, idEmpresa },
    bd,
    archivos,
  );
  // La pantalla puede mandar SOLO el uuid (captura que nació de leer la factura pero cuyo XML no
  // viaja): ese folio tampoco puede estar ya en otra entrada. Sin este chequeo el choque salía como
  // un P2002 opaco (500) en vez de decir en qué entrada está la otra captura.
  const uuidSuelto = datos.uuidCfdi?.trim();
  if (sello === null && uuidSuelto !== undefined && uuidSuelto !== '') {
    const lectura = clienteLectura(bd);
    await exigirUuidLibreEnEntradas(lectura, idEmpresa, uuidSuelto);
    // …y ese folio fiscal tampoco puede ser de un proveedor marcado como que NO factura (hallazgo de
    // la revisión del 11-ago-2026). No es solo dato contradictorio: al confirmar, ese documento cae
    // en la rama del proveedor sin factura y nace un cargo **NO fiscal** por los precios capturados,
    // que NO lleva el UUID al `MovimientoTercero` — así que Finanzas podría importar ESE MISMO CFDI
    // y cobrarlo otra vez: dos cargos por lo mismo. La edición ya lo prohibía
    // (`exigirSelloCompatibleConProveedor`); el alta se había quedado sin esta puerta.
    const proveedor = await lectura.proveedor.findUnique({
      where: { id: datos.idProveedor },
      select: { nombre: true, modalidadFacturacion: true },
    });
    // Si no existe, `validarCabeceraYLineas` truena enseguida con mejor mensaje (mismo criterio que
    // `exigirSelloCompatibleConProveedor`).
    if (proveedor !== null) {
      exigirProveedorQueFactura(
        proveedor,
        'capturar la entrada con el folio fiscal (UUID) de una factura',
      );
    }
  }

  const id = await enTransaccion(async (tx) => {
    const colores = await validarCabeceraYLineas(
      tx,
      idEmpresa,
      datos.idProveedor,
      datos.idAlmacen,
      datos.lineas,
      datos.tipoDocumento,
    );

    const folio = await siguienteFolio(tx, idEmpresa, CLAVE_SECUENCIA_ENTRADA_TELA);
    const creada = await tx.entradaTela.create({
      data: {
        folio,
        idEmpresa,
        tipoDocumento: datos.tipoDocumento,
        numeroDocumento: datos.numeroDocumento,
        // §Post-F9.20/21: si la captura nació de leer el XML, la entrada recuerda DE QUÉ factura
        // salió, POR CUÁNTO (verdad fiscal) y con qué XML — con eso nace la CxP al confirmar.
        // El unique (idEmpresa, uuidCfdi) impide recibir dos veces el mismo CFDI.
        uuidCfdi: sello?.uuid ?? datos.uuidCfdi ?? null,
        ...(sello === null
          ? {}
          : {
              totalCfdi: sello.total,
              idArchivoCfdi: sello.idArchivo,
              // El RFC del emisor viaja al cargo de CxP (el reporte del contador lo imprime) y es
              // lo que permite re-validar el sello si después se edita el borrador.
              rfcCfdi: sello.emisorRfc,
            }),
        idProveedor: datos.idProveedor,
        fecha: aDateColumna(datos.fecha),
        idAlmacen: datos.idAlmacen,
        observaciones: datos.observaciones ?? null,
        estatus: EstatusEntradaTela.borrador,
        lineas: {
          createMany: {
            data: aColumnasLinea(
              datos.lineas,
              (idTelaColor) => colores.get(idTelaColor)?.nombreComplemento !== null,
              sesion,
            ),
          },
        },
        ...datosCreacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'EntradaTela',
      idEntidad: creada.id,
      accion: 'CREAR',
      datos: {
        folio: Number(folio),
        tipoDocumento: datos.tipoDocumento,
        numeroDocumento: datos.numeroDocumento,
        renglones: datos.lineas.length,
      },
    });
    return creada.id;
  }, bd);

  return obtener(id, idEmpresa, tienePermiso(sesion, 'telas.ver-totales'), bd);
}

/**
 * Edita un documento EN BORRADOR (una confirmada es inmutable, D3): reemplaza la cabecera y TODOS
 * sus renglones en UNA transacción (A2). Los renglones viejos se borran y se recrean (todavía no
 * existe ninguna partida ni movimiento colgando de ellos — eso sólo nace al confirmar). Permiso
 * `inventario-telas.mover`.
 *
 * EL SELLO DEL CFDI NO SE PIERDE POR EDITAR (arreglo del ciclo de revisión de §Post-F9.21). Antes,
 * la edición escribía `uuidCfdi` con lo que mandara la pantalla y no tocaba `totalCfdi` /
 * `idArchivoCfdi`: editar un borrador que había nacido de un XML lo dejaba SIN folio fiscal pero CON
 * su total colgando, y al confirmar la cuenta por pagar **no nacía**, en silencio. Ahora:
 *
 *  • **Sin XML nuevo** → el sello (uuid + total + XML + RFC) se CONSERVA tal cual, y se RE-VALIDA
 *    contra el proveedor con el que va a quedar el documento: el emisor de la factura y el
 *    proveedor al que se le va a deber tienen que ser el mismo.
 *  • **Con `xmlCfdi`** → se re-sella con las MISMAS guardas del alta (`sellarCfdiEnEntrada`:
 *    receptor = empresa activa, emisor = proveedor, proveedor que sí factura, UUID no repetido ni
 *    en otra entrada ni en CxP) y el sello viejo se reemplaza completo.
 */
export async function actualizarEntradaTela(
  sesion: SesionUsuario,
  id: number,
  entrada: EntradaActualizarEntradaTela,
  bd?: ContextoBd,
  /** Inyectable para probar sin R2 real (igual que en el alta). Solo se usa si viene XML nuevo. */
  archivos?: ServicioArchivos,
): Promise<EntradaTelaSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaEntradaTelaActualizar, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  // El re-sellado va ANTES de la transacción porque sube el XML a R2 (mismo orden deliberado que el
  // alta: un objeto huérfano en R2 es inocuo; un cargo fiscal sin su XML, irrecuperable).
  const selloNuevo: SelloCfdi | null = await sellarCfdiEnEntrada(
    {
      xml: datos.xmlCfdi ?? null,
      idProveedor: datos.idProveedor,
      idEmpresa,
      idEntradaActual: id,
    },
    bd,
    archivos,
  );

  await enTransaccion(async (tx) => {
    const anterior = await exigirBorrador(tx, id, idEmpresa);
    // Sin XML nuevo, el sello guardado manda — y tiene que seguir cuadrando con el proveedor con el
    // que va a quedar el documento (si no, el cargo fiscal nacería contra quien no facturó).
    if (selloNuevo === null) {
      await exigirSelloCompatibleConProveedor(anterior, datos.idProveedor, { tx });
    }
    const colores = await validarCabeceraYLineas(
      tx,
      idEmpresa,
      datos.idProveedor,
      datos.idAlmacen,
      datos.lineas,
      datos.tipoDocumento,
    );

    await tx.entradaTelaLinea.deleteMany({ where: { idEntradaTela: id } });
    await tx.entradaTela.update({
      where: { id },
      data: {
        tipoDocumento: datos.tipoDocumento,
        numeroDocumento: datos.numeroDocumento,
        // Las columnas del CFDI SOLO se tocan cuando la edición trae un XML nuevo (si no, ni
        // aparecen en el `data`: lo guardado se queda como está).
        ...(selloNuevo === null
          ? {}
          : {
              uuidCfdi: selloNuevo.uuid,
              totalCfdi: selloNuevo.total,
              idArchivoCfdi: selloNuevo.idArchivo,
              rfcCfdi: selloNuevo.emisorRfc,
            }),
        idProveedor: datos.idProveedor,
        fecha: aDateColumna(datos.fecha),
        idAlmacen: datos.idAlmacen,
        observaciones: datos.observaciones ?? null,
        lineas: {
          createMany: {
            data: aColumnasLinea(
              datos.lineas,
              (idTelaColor) => colores.get(idTelaColor)?.nombreComplemento !== null,
              sesion,
            ),
          },
        },
        ...datosModificacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'EntradaTela',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: {
        renglones: datos.lineas.length,
        numeroDocumento: datos.numeroDocumento,
        // A7 — que se haya re-sellado la factura (o no) es justo lo que hay que poder auditar.
        ...(selloNuevo === null ? {} : { cfdiResellado: selloNuevo.uuid }),
      },
    });
  }, bd);

  return obtener(id, idEmpresa, tienePermiso(sesion, 'telas.ver-totales'), bd);
}

/** Lo que el cálculo del cargo necesita del documento (evita arrastrar todo el payload). */
interface DocumentoParaCxP {
  folio: bigint;
  fecha: Date;
  numeroDocumento: string;
  idProveedor: number;
  uuidCfdi: string | null;
  totalCfdi: Prisma.Decimal | null;
  rfcCfdi: string | null;
  idArchivoCfdi: string | null;
  proveedor: {
    nombre: string;
    rfc: string | null;
    modalidadFacturacion: ModalidadFacturacion | null;
  };
  lineas: readonly {
    cantidad: Prisma.Decimal;
    cantidadComplemento: Prisma.Decimal | null;
    precioUnit: Prisma.Decimal | null;
    precioUnitComplemento: Prisma.Decimal | null;
  }[];
}

/**
 * ¿QUÉ CUENTA POR PAGAR nace al confirmar esta entrada? Los dos tipos de proveedor de Daniel
 * (§Post-F9.22) se contestan aquí, en un solo lugar:
 *
 *  • **Proveedor que FACTURA, con su CFDI capturado** → cargo **FISCAL** por el TOTAL del
 *    comprobante (con impuestos — NO la suma de renglones, que va sin IVA), respaldado con el XML.
 *  • **Proveedor que FACTURA, sin CFDI todavía** (llegó con remisión y la factura viene después) →
 *    NO se inventa cargo: se registrará con la factura, que es la que trae el importe bueno.
 *  • **Proveedor que NO factura** → nunca va a haber CFDI, así que esperar la factura sería no
 *    registrarle NUNCA la deuda. El cargo nace **NO FISCAL** por lo capturado a mano: la suma de
 *    cantidad×precio del cuerpo y del complemento. Sin IVA que sumar, esa suma ES lo que se le debe.
 *  • **Proveedor sin la modalidad definida** (los migrados de Access) → se trata como los que
 *    facturan: se espera su CFDI. Nada se inventa sobre un dato que nadie capturó.
 *
 * Devuelve `null` cuando no hay nada que cobrar. En particular, un documento sin precios capturados
 * da importe 0 y NO genera cargo: registrar una deuda de cero sería ruido, y el motor de terceros
 * exige importe ≥ 0.01. Queda visible en el documento (los renglones sin precio se ven), no callado.
 */
function cargoDeCuentaPorPagar(
  documento: DocumentoParaCxP,
  idEntrada: number,
): z.input<typeof esquemaMovimientoTerceroCrear> | null {
  const fecha = documento.fecha.toISOString().slice(0, 10);
  const comun = {
    tipoTercero: 'proveedor',
    idTercero: documento.idProveedor,
    fecha,
    origen: ORIGEN_FACTURA_PROVEEDOR,
    refTipo: REF_ENTRADA_TELA,
    refId: idEntrada,
  } as const;

  if (documento.uuidCfdi !== null && documento.totalCfdi !== null) {
    // ÚLTIMO CERROJO antes de escribir un cargo FISCAL (A4, deny-by-default): el cargo viaja con el
    // RFC del EMISOR como `rfcTercero`, así que el proveedor al que se le va a deber tiene que ser
    // ese mismo. Las dos puertas de captura ya lo exigen (`sellarCfdiEnEntrada` al subir el XML y
    // `exigirSelloCompatibleConProveedor` al editar el borrador); esto es la red por si mañana
    // apareciera un tercer camino que selle un CFDI — un cargo fiscal a nombre de quien no facturó
    // no se puede corregir: el UUID queda consumido para siempre.
    // Y la red FALLA CERRADA (revisión del 11-ago-2026): si el cargo es fiscal pero no se sabe QUÉ
    // RFC lo emitió, no hay nada que comparar — y una comprobación que no puede comprobar no debe
    // dejar pasar (A4, deny-by-default). Hoy es inalcanzable (`rfcCfdi === null ⇒ totalCfdi === null`
    // porque los dos los escribe el mismo sello), pero condicionar la validación a que el RFC exista
    // convertía la última red en un colador el día que ese invariante se rompiera.
    if (documento.rfcCfdi === null) {
      throw new ErrorValidacion(
        `La entrada ${String(documento.folio)} trae el total de la factura (UUID ${documento.uuidCfdi}) ` +
          `pero no el RFC de quien la emitió: no se puede confirmar un cargo fiscal sin saber a ` +
          `nombre de quién nace. Vuelve a subir el XML de la factura en el borrador.`,
      );
    }
    const rfcProveedor = exigirRfcDelProveedor(
      documento.proveedor,
      'confirmar la entrada con su factura (CFDI)',
    );
    if (normalizarRfc(rfcProveedor) !== normalizarRfc(documento.rfcCfdi)) {
      throw new ErrorValidacion(
        `La factura de esta entrada la emitió el RFC ${documento.rfcCfdi}, pero el documento ` +
          `está a nombre del proveedor "${documento.proveedor.nombre}" (RFC ${rfcProveedor}): ` +
          `la cuenta por pagar nacería a nombre de quien no facturó.`,
      );
    }
    return {
      ...comun,
      importe: documento.totalCfdi.toNumber(),
      esFiscal: true,
      uuidCfdi: documento.uuidCfdi,
      // El RFC del EMISOR viaja al cargo igual que en una importación de CFDI de F9: es lo que el
      // reporte fiscal del contador imprime. Sin él, la misma factura se veía distinta según por
      // dónde hubiera entrado (con RFC desde Finanzas, con "—" desde el almacén de telas). Aquí ya
      // no puede faltar: el cerrojo de arriba truena si es null.
      rfcTercero: documento.rfcCfdi,
      ...(documento.idArchivoCfdi === null ? {} : { idArchivoCfdi: documento.idArchivoCfdi }),
      observaciones: `Entrada de tela ${String(documento.folio)} · factura ${documento.numeroDocumento}`,
    };
  }

  if (modalidadFactura(documento.proveedor.modalidadFacturacion) !== 'sin-factura') {
    return null;
  }

  const importe = documento.lineas.reduce((suma, l) => {
    const cuerpo = l.precioUnit === null ? 0 : l.cantidad.toNumber() * l.precioUnit.toNumber();
    const complemento =
      l.cantidadComplemento === null || l.precioUnitComplemento === null
        ? 0
        : l.cantidadComplemento.toNumber() * l.precioUnitComplemento.toNumber();
    return suma + cuerpo + complemento;
  }, 0);
  // Se redondea a centavos: el importe vive en DECIMAL(14,2) y cantidad×precio puede traer cola.
  const aPagar = Math.round(importe * 100) / 100;
  if (aPagar < 0.01) return null;

  return {
    ...comun,
    importe: aPagar,
    esFiscal: false,
    observaciones:
      `Entrada de tela ${String(documento.folio)} · ${documento.numeroDocumento} · ` +
      `proveedor sin factura (importe capturado a mano)`,
  };
}

/**
 * CONFIRMA un documento en borrador: en UNA transacción (A2) crea UNA `PartidaTela` por renglón
 * (folio atómico A3 — primero las partidas, luego el folio del movimiento, para no interbloquear) y
 * registra UN movimiento de kardex de ENTRADA (`entrada-recepcion`, origen `entrada-tela`) por el
 * motor, con el precio del cuerpo como `costoUnit` (D1). Liga documento ↔ movimiento y renglón ↔
 * partida, y marca `confirmada` (A7). Una entrada confirmada ya no se edita: se cancela.
 * Permiso `inventario-telas.mover`.
 *
 * §Post-F9.14: los renglones que traen `idOrdenCompraLinea` generan además la RECEPCIÓN de su orden
 * de compra (una por OC surtida) — misma contabilidad que la recepción de F4, sin mover inventario
 * otra vez: la tela entra UNA sola vez al kardex y suma UNA sola vez a lo recibido de la OC. Con
 * eso la orden pasa sola a `recibida_parcial`/`recibida_total` y la Ruta Crítica se entera.
 */
export async function confirmarEntradaTela(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<EntradaTelaSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const idEmpresa = sesion.idEmpresaActiva;

  try {
    await confirmarEnTransaccion(sesion, id, idEmpresa, bd);
  } catch (error) {
    // Backstop de la carrera con Finanzas: si esa MISMA factura se importó a CxP justo entre el
    // re-chequeo y el INSERT, la unique global del UUID lanza P2002. Traducirlo importa: sin esto,
    // la tela no puede entrar al almacén y quien captura solo ve un 500 sin explicación.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      JSON.stringify(error.meta?.target ?? '').includes('uuid_cfdi')
    ) {
      throw new ErrorConflicto(
        'Esa factura ya está registrada en Cuentas por pagar: no se puede duplicar el cargo. ' +
          SALIDA_UUID_CONSUMIDO,
      );
    }
    throw error;
  }

  return obtener(id, idEmpresa, tienePermiso(sesion, 'telas.ver-totales'), bd);
}

/** Cuerpo transaccional de {@link confirmarEntradaTela} (separado solo para traducir el P2002). */
async function confirmarEnTransaccion(
  sesion: SesionUsuario,
  id: number,
  idEmpresa: number,
  bd?: ContextoBd,
): Promise<void> {
  await enTransaccion(async (tx) => {
    // Lee el documento BAJO la transacción y exige borrador: dos confirmaciones concurrentes se
    // serializan en el UPDATE final (la segunda ya ve `confirmada` y se rechaza).
    await exigirBorrador(tx, id, idEmpresa);
    const documento = await tx.entradaTela.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        folio: true,
        fecha: true,
        idAlmacen: true,
        idProveedor: true,
        numeroDocumento: true,
        tipoDocumento: true,
        // §Post-F9.21 — con esto nace la CUENTA POR PAGAR del proveedor al confirmar.
        uuidCfdi: true,
        totalCfdi: true,
        rfcCfdi: true,
        idArchivoCfdi: true,
        // §Post-F9.22 — y la modalidad del catálogo decide SI el cargo es fiscal o no (fila
        // 0.124: una sola pregunta, `modalidadFacturacion`). El `rfc` va
        // para el cerrojo final: el cargo fiscal no puede nacer a nombre de quien no facturó.
        proveedor: { select: { nombre: true, rfc: true, modalidadFacturacion: true } },
        lineas: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            idTelaColor: true,
            cantidad: true,
            cantidadComplemento: true,
            precioUnit: true,
            precioUnitComplemento: true,
            loteProveedor: true,
            idOrdenCompraLinea: true,
          },
        },
      },
    });
    if (documento.lineas.length === 0) {
      throw new ErrorValidacion('La entrada no tiene renglones: no hay nada que dar de alta.');
    }

    // §Post-F9.14 — los locks de las OCs surtidas se toman AQUÍ, ANTES de crear partidas y de mover
    // el kardex: así esta puerta y `recibirCompra` toman los recursos en el MISMO orden (primero la
    // OC, luego el inventario) y no pueden interbloquearse entre sí.
    const idsLineaOC = documento.lineas
      .map((l) => l.idOrdenCompraLinea)
      .filter((id): id is number => id !== null);
    await bloquearOrdenesDeRenglones(tx, idsLineaOC);

    const fecha = documento.fecha.toISOString().slice(0, 10);
    // La liga con la OC VIAJA en el renglón que se le pasa al embudo (antes se caía en este mapeo):
    // es lo que permite que CONFIRMAR también rechace un borrador viejo con renglones sueltos
    // (§Post-F9.159(a)) — si sólo se validara al capturar, el borrador de ayer entraría por atrás.
    const lineas: LineaEntradaTelaValidable[] = documento.lineas.map((l) => ({
      idTelaColor: l.idTelaColor,
      cantidad: Number(l.cantidad),
      cantidadComplemento: aNumero(l.cantidadComplemento) ?? undefined,
      idOrdenCompraLinea: l.idOrdenCompraLinea,
    }));
    const colores = await validarCabeceraYLineas(
      tx,
      idEmpresa,
      documento.idProveedor,
      documento.idAlmacen,
      lineas,
      documento.tipoDocumento,
    );

    // 1) Una PARTIDA por renglón (la unidad de entrada; dos lotes del mismo color = dos partidas).
    const idPartidaPorLinea: number[] = [];
    for (const linea of documento.lineas) {
      const partida = await crearPartidaTela(tx, sesion, {
        idEmpresa,
        idTelaColor: linea.idTelaColor,
        loteProveedor: linea.loteProveedor,
        factura: documento.numeroDocumento,
        fecha,
      });
      idPartidaPorLinea.push(partida.id);
      await tx.entradaTelaLinea.update({
        where: { id: linea.id },
        data: { idPartida: partida.id, ...datosModificacion(sesion) },
      });
    }

    // 2) UN movimiento de kardex por documento, con los DOS precios como costo (D1): el del
    //    cuerpo y el del complemento, cada uno valuando su propia cantidad.
    const tipoEntrada = await tipoPorCodigo(tx, COD_ENTRADA_RECEPCION);
    const lineasMotor: LineaMovimientoTela[] = aLineasMotor(lineas, colores, idPartidaPorLinea).map(
      (l, i) => {
        const origen = documento.lineas[i];
        return {
          ...l,
          costoUnit: origen === undefined ? null : aNumero(origen.precioUnit),
          // El complemento solo se valúa si la tela lo lleva (si no, la cantidad va NULL).
          costoUnitComplemento:
            origen === undefined || l.cantidadComplemento === null
              ? null
              : aNumero(origen.precioUnitComplemento),
        };
      },
    );
    const movimiento = await registrarMovimientoTela(
      sesion,
      {
        idEmpresa,
        idTipoMov: tipoEntrada.id,
        idAlmacen: documento.idAlmacen,
        fecha: aDateColumna(fecha),
        origenTipo: ORIGEN.entradaTela,
        origenId: String(documento.id),
        lineas: lineasMotor,
        observaciones: `Entrada de tela ${Number(documento.folio)} · ${documento.tipoDocumento} ${documento.numeroDocumento}`,
      },
      { tx },
    );

    // 3) Sella el documento (el UPDATE con `estatus: borrador` en el WHERE serializa las
    //    confirmaciones concurrentes: la segunda no encuentra fila y truena antes de duplicar).
    const sellado = await tx.entradaTela.updateMany({
      where: { id, idEmpresa, estatus: EstatusEntradaTela.borrador },
      data: {
        estatus: EstatusEntradaTela.confirmada,
        idMovimiento: movimiento.id,
        confirmadaEn: new Date(),
        confirmadaPorId: sesion.id,
        ...datosModificacion(sesion),
      },
    });
    if (sellado.count !== 1) {
      throw new ErrorConflicto('Esa entrada ya fue confirmada por otra captura.');
    }

    // 4) §Post-F9.14 — RECEPCIÓN contra las OCs surtidas (si algún renglón las trae). No mueve
    //    inventario: reusa la partida y el movimiento que ya se crearon arriba.
    const renglonesConOC: RenglonEntradaTelaRecibido[] = [];
    documento.lineas.forEach((linea, i) => {
      if (linea.idOrdenCompraLinea === null) {
        return;
      }
      const color = colores.get(linea.idTelaColor);
      const idPartida = idPartidaPorLinea[i];
      if (color === undefined || idPartida === undefined) {
        return; // inalcanzable: `validarCabeceraYLineas` ya resolvió todos los colores.
      }
      renglonesConOC.push({
        idOrdenCompraLinea: linea.idOrdenCompraLinea,
        idTelaColor: linea.idTelaColor,
        idTela: color.idTela,
        cantidad: Number(linea.cantidad),
        cantidadComplemento: aNumero(linea.cantidadComplemento),
        costoUnit: aNumero(linea.precioUnit),
        idPartida,
      });
    });
    await registrarRecepcionesDesdeEntradaTela(
      tx,
      sesion,
      {
        idEmpresa,
        idEntradaTela: id,
        folioEntrada: Number(documento.folio),
        idAlmacen: documento.idAlmacen,
        idProveedor: documento.idProveedor,
        factura: documento.numeroDocumento,
        fecha,
        idMovimiento: movimiento.id,
      },
      renglonesConOC,
    );

    // 5) CUENTA POR PAGAR del proveedor, en la MISMA transacción (A2).
    //
    //    PERMISO (cierra el punto (a) de §Post-F9.15): se usa la variante INTERNA del motor de
    //    terceros — quien confirma tiene `inventario-telas.mover`, y el cargo nace como CONSECUENCIA
    //    de ese acto ya autorizado. Exigirle `terceros.administrar` obligaría a Finanzas a recapturar
    //    a mano cada factura ya recibida, que es justo lo que se pidió evitar.
    //
    //    CARRERA CONTRA FINANZAS (arreglo del ciclo de revisión): el UUID se verifica al GUARDAR la
    //    entrada, pero el cargo nace al CONFIRMAR, que puede ser días después. Si en medio alguien
    //    importó esa MISMA factura desde Finanzas, la unique global de `MovimientoTercero.uuidCfdi`
    //    dispara un P2002 y la transacción entera se aborta: la TELA no podría entrar al almacén por
    //    un problema de contabilidad, y con un 500 opaco. Se re-checa aquí dentro (mismo backstop de
    //    `importarCfdi`, F9) para poder explicarlo; el `catch` de abajo cubre la carrera exacta.
    const cargo = cargoDeCuentaPorPagar(documento, id);
    if (cargo !== null) {
      if (documento.uuidCfdi !== null && (await uuidYaImportado(tx, documento.uuidCfdi))) {
        throw new ErrorConflicto(
          `Esta factura (UUID ${documento.uuidCfdi}) ya está registrada en Cuentas por pagar ` +
            `(se importó desde Finanzas después de capturar la entrada): no se puede duplicar el ` +
            `cargo. ${SALIDA_UUID_CONSUMIDO}`,
        );
      }
      await registrarMovimientoTerceroInterno(sesion, cargo, { tx });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'EntradaTela',
      idEntidad: id,
      accion: 'OTRO',
      datos: {
        confirmada: true,
        idMovimiento: movimiento.id,
        partidas: idPartidaPorLinea.length,
        recepcionesGeneradas: renglonesConOC.length > 0,
      },
    });
  }, bd);
}

/**
 * CANCELA un documento de entrada (cancelación SUAVE con motivo, A7): si está en `borrador` sólo lo
 * marca (nunca tocó el inventario); si está `confirmada`, genera el movimiento INVERSO auditado del
 * kardex (D3: el original NUNCA se edita ni se borra) en la MISMA transacción. Las partidas creadas
 * se CONSERVAN (son la traza de lo que entró; su efecto en la existencia lo neutraliza el inverso,
 * que copia `idTelaColor`/`idPartida`/`cantidadComplemento`/`costoUnit*`). Una entrada ya cancelada
 * no se re-cancela. Permiso `inventario-telas.mover`.
 *
 * ⚠️ EL INVERSO NO VALIDA NO-NEGATIVO — decisión de diseño EXPLÍCITA (misma regla que
 * `cancelarMovimientoTelaColor` de A2): un inverso es una CORRECCIÓN contable, no una salida de
 * negocio; bloquearlo dejaría un documento erróneo imposible de anular (y empujaría a "arreglarlo"
 * editando movimientos, que es justo lo que D3 prohíbe). CONSECUENCIA OPERATIVA que hay que conocer:
 * si la tela de esa entrada YA SE CONSUMIÓ (salió a una orden o se traspasó), cancelar el documento
 * deja el color con existencia NEGATIVA, y a partir de ahí TODA salida de ese color queda bloqueada
 * (las salidas sí validan no-negativo bajo lock) hasta que alguien lo corrija con un ajuste de
 * entrada. Lo correcto en ese caso es no cancelar la entrada, sino ajustar por conteo físico.
 */
export async function cancelarEntradaTela(
  sesion: SesionUsuario,
  id: number,
  cuerpo: z.input<typeof esquemaEntradaTelaCancelarCuerpo>,
  bd?: ContextoBd,
): Promise<EntradaTelaSalida> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const datos = validarEntrada(esquemaEntradaTelaCancelarCuerpo, cuerpo);
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    const documento = await tx.entradaTela.findFirst({
      where: { id, idEmpresa },
      select: {
        id: true,
        folio: true,
        estatus: true,
        idMovimiento: true,
        lineas: { select: { idOrdenCompraLinea: true } },
      },
    });
    if (documento === null) {
      throw new ErrorNoEncontrado('EntradaTela', id);
    }
    if (documento.estatus === EstatusEntradaTela.cancelada) {
      throw new ErrorConflicto(`La entrada ${Number(documento.folio)} ya está cancelada.`);
    }

    // Mismo orden de recursos que al confirmar (OC primero): los locks van ANTES de tocar nada.
    await bloquearOrdenesDeRenglones(
      tx,
      documento.lineas
        .map((l) => l.idOrdenCompraLinea)
        .filter((idLinea): idLinea is number => idLinea !== null),
    );

    // El WHERE con el estatus previo serializa dos cancelaciones concurrentes: la segunda no
    // encuentra fila y truena ANTES de generar un segundo inverso.
    const marcada = await tx.entradaTela.updateMany({
      where: { id, idEmpresa, estatus: documento.estatus },
      data: {
        estatus: EstatusEntradaTela.cancelada,
        canceladaEn: new Date(),
        canceladaPorId: sesion.id,
        motivoCancelacion: datos.motivo,
        ...datosModificacion(sesion),
      },
    });
    if (marcada.count !== 1) {
      throw new ErrorConflicto('Esa entrada acaba de cambiar de estado: vuelve a intentarlo.');
    }

    if (documento.estatus === EstatusEntradaTela.confirmada && documento.idMovimiento !== null) {
      const tipoInverso = await tipoPorCodigo(tx, COD_AJUSTE_SALIDA);
      await cancelarMovimientoMaterial(sesion, documento.idMovimiento, tipoInverso.id, { tx });
      // §Post-F9.14: y las OCs que había surtido vuelven a quedar pendientes de recibir.
      await reversarRecepcionesDeEntradaTela(
        tx,
        sesion,
        id,
        `Cancelación de la entrada de tela ${Number(documento.folio)}: ${datos.motivo}`,
      );
      // §Post-F9.21: y la CUENTA POR PAGAR que nació al confirmar se cancela por su INVERSO
      // auditado (D3: nunca se edita ni se borra). Si no se hiciera, quedaría un cargo vivo de una
      // entrada cancelada — le deberíamos al proveedor una tela que devolvimos.
      const cargo = await tx.movimientoTercero.findFirst({
        where: {
          idEmpresa,
          refTipo: REF_ENTRADA_TELA,
          refId: id,
          cancelado: false,
          idMovimientoInverso: null,
        },
        select: { id: true },
      });
      if (cargo !== null) {
        await cancelarMovimientoTerceroInterno(
          sesion,
          cargo.id,
          {
            motivo: `Cancelación de la entrada de tela ${Number(documento.folio)}: ${datos.motivo}`,
          },
          { tx },
        );
      }
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'EntradaTela',
      idEntidad: id,
      accion: 'CANCELAR',
      datos: { motivo: datos.motivo, estatusPrevio: documento.estatus },
    });
  }, bd);

  return obtener(id, idEmpresa, tienePermiso(sesion, 'telas.ver-totales'), bd);
}

// ── Consultas de SOLO LECTURA ────────────────────────────────────────────────────────────────────

/** Parámetros del listado (forma de dominio). */
export type ParametrosListarEntradasTela = z.input<typeof esquemaEntradasTelaQuery>;

/**
 * Lista PAGINADA de los documentos de entrada de tela de la empresa activa (A9), con filtros por
 * estado, tipo de documento, proveedor, almacén y rango de fechas, y búsqueda por folio / número de
 * documento / nombre del proveedor. Permiso `inventario-telas.ver`.
 */
export async function listarEntradasTela(
  sesion: SesionUsuario,
  parametros: ParametrosListarEntradasTela = {},
  bd?: ContextoBd,
): Promise<EntradasTelaPagina> {
  verificarPermiso(sesion, 'inventario-telas.ver');
  const filtros = validarEntrada(esquemaEntradasTelaQuery, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const verImportes = tienePermiso(sesion, 'telas.ver-totales');

  const condiciones: Prisma.EntradaTelaWhereInput[] = [{ idEmpresa }];
  if (filtros.estatus !== undefined) condiciones.push({ estatus: filtros.estatus });
  if (filtros.tipoDocumento !== undefined)
    condiciones.push({ tipoDocumento: filtros.tipoDocumento });
  if (filtros.idProveedor !== undefined) condiciones.push({ idProveedor: filtros.idProveedor });
  if (filtros.idAlmacen !== undefined) condiciones.push({ idAlmacen: filtros.idAlmacen });
  if (filtros.fechaDesde !== undefined)
    condiciones.push({ fecha: { gte: aDateColumna(filtros.fechaDesde) } });
  if (filtros.fechaHasta !== undefined)
    condiciones.push({ fecha: { lte: aDateColumna(filtros.fechaHasta) } });
  const busqueda = filtros.busqueda;
  if (busqueda !== undefined && busqueda.length > 0) {
    const or: Prisma.EntradaTelaWhereInput[] = [
      { numeroDocumento: { contains: busqueda, mode: 'insensitive' } },
      { proveedor: { nombre: { contains: busqueda, mode: 'insensitive' } } },
    ];
    if (/^\d+$/.test(busqueda)) or.push({ folio: BigInt(busqueda) });
    condiciones.push({ OR: or });
  }
  const where: Prisma.EntradaTelaWhereInput = { AND: condiciones };

  const orden: Prisma.EntradaTelaOrderByWithRelationInput[] = [
    { [filtros.ordenarPor]: filtros.direccion },
    // Desempate DETERMINISTA (dos documentos del mismo día no pueden alternar de página).
    { id: filtros.direccion },
  ];

  const [total, datos] = await Promise.all([
    cliente.entradaTela.count({ where }),
    cliente.entradaTela.findMany({
      where,
      include: incluirEntradaTela,
      orderBy: orden,
      skip: (filtros.pagina - 1) * filtros.porPagina,
      take: filtros.porPagina,
    }),
  ]);

  const avisos = await avisosDuplicado(
    cliente,
    idEmpresa,
    datos.filter((d) => d.estatus !== EstatusEntradaTela.cancelada),
  );

  return {
    datos: datos.map((e) => aEntradaTelaSalida(e, verImportes, avisos.get(e.id) ?? [])),
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.porPagina)),
  };
}

/** Obtiene un documento de entrada de tela por id (empresa activa, A9). Permiso `inventario-telas.ver`. */
export async function obtenerEntradaTela(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<EntradaTelaSalida> {
  verificarPermiso(sesion, 'inventario-telas.ver');
  return obtener(id, sesion.idEmpresaActiva, tienePermiso(sesion, 'telas.ver-totales'), bd);
}
