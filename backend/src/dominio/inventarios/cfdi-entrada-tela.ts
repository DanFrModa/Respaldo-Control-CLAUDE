/**
 * LEER LA FACTURA (XML del CFDI) PARA LLENAR LA ENTRADA DE TELA (§Post-F9.20).
 *
 * Petición de Daniel (7-ago-2026): *"lo ideal es que pueda leer la factura y llenar los campos"* →
 * *"está perfecto que la información la tomes del XML para las dos cosas, y el PDF que se suba solo
 * como referencia para poder consultar siempre la factura"*.
 *
 * POR QUÉ EL XML Y NO EL PDF: el CFDI trae los datos **estructurados y exactos** (RFC del emisor,
 * UUID, fecha, y cada concepto con cantidad, valor unitario e importe); del PDF habría que
 * adivinarlos con OCR o con una plantilla por proveedor. El **PDF se sigue subiendo** como adjunto
 * del documento (`adjuntos-entrada-tela.ts`, que ya existía) para poder consultar la factura tal
 * cual — pero NO es de donde salen los datos.
 *
 * ESTO NO ESCRIBE NADA. Es una LECTURA que devuelve una **propuesta**: el proveedor por su RFC, los
 * conceptos de la factura y, para cada uno, el renglón de OC pendiente que probablemente surte. La
 * persona confirma y captura lo único que el CFDI no dice: **el COLOR** de la tela que llegó.
 *
 * PERMISO: `inventario-telas.mover` — quien captura la entrada. NO se pide `cxp.administrar`: leer
 * la factura para recibir mercancía es parte de recibir, no de finanzas (la CxP viene aparte).
 *
 * REUSA el parser de F9 (`terceros/cfdi/parser-cfdi.ts`) y su validación de receptor: un solo lugar
 * entiende de CFDI en todo el sistema.
 */
import type { z } from 'zod';

import { esquemaCfdiXml } from '../../contrato/index.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { servicioArchivos, type ServicioArchivos } from '../../comun/archivos.js';
import { ErrorConflicto, ErrorValidacion } from '../../comun/errores.js';
import { rfcEmpresaActiva, uuidYaImportado } from '../terceros/cfdi/cfdi-comun.js';
import { admiteCfdi, exigirProveedorQueFactura } from '../terceros/facturacion-proveedor.js';
import { validarReceptorCfdi } from '../terceros/cfdi/cfdi-proveedor.js';
import { normalizarRfc, parsearCfdi, type CfdiConcepto } from '../terceros/cfdi/parser-cfdi.js';
import { lineasTelaPendientesDeProveedor } from '../compras/recepciones.js';

/** Carpeta de R2 donde viven los XML de las facturas que entraron por el inventario de telas. */
const CARPETA_CFDI_ENTRADAS = 'cfdi/entradas-tela';

/** Renglón de OC que la propuesta sugiere para un concepto de la factura. */
export interface SugerenciaRenglonOc {
  idOrdenCompraLinea: number;
  numCompra: number;
  idTela: number;
  tela: string;
  unidad: string | null;
  /** Lo que falta por recibir de ese renglón (cuerpo y complemento). */
  pendiente: number;
  pendienteComplemento: number;
  /** Cómo se llama el complemento de la tela ("Cardigan"), o null si no lleva. */
  nombreComplemento: string | null;
  /** Por qué se sugirió: ayuda a la persona a decidir si acepta o corrige. */
  motivo: 'nombre-de-la-tela' | 'unico-pendiente' | 'cantidad-parecida';
}

/** Un concepto de la factura con su sugerencia (o sin ella). */
export interface ConceptoConSugerencia {
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
  importe: number;
  sugerencia: SugerenciaRenglonOc | null;
}

/** Lo que la pantalla necesita para llenarse sola con la factura. */
export interface PropuestaCfdiEntradaTela {
  uuid: string;
  /** Serie+Folio del CFDI: el "número de factura" que el proveedor imprime. Vacío si no trae. */
  numeroDocumento: string;
  /** Fecha de emisión (YYYY-MM-DD): la propuesta de fecha del documento. */
  fecha: string;
  emisorRfc: string;
  emisorNombre: string | null;
  moneda: string;
  total: number;
  /** Proveedor del catálogo que coincide por RFC, o null si ninguno lo tiene capturado. */
  idProveedor: number | null;
  proveedor: string | null;
  /** `true` si ese UUID ya se usó (otra entrada de tela o una importación a CxP). */
  yaUsado: boolean;
  /** Lo que la persona debe saber antes de aceptar la propuesta (nunca truena en silencio). */
  avisos: string[];
  conceptos: ConceptoConSugerencia[];
}

/** Entrada del servicio: el XML + (opcional) la OC desde la que se está recibiendo. */
export interface EntradaLeerCfdi {
  xml: string;
  /** Acota las sugerencias a UNA orden de compra (la entrada arranca desde ella, §Post-F9.15). */
  idOrdenCompra?: number;
}

/**
 * Normaliza un texto para comparar descripciones: minúsculas, sin acentos y sin signos. El proveedor
 * escribe *"FELPA PERCHADA 100% ALG."* y el catálogo dice *"Felpa Perchada"*: sin normalizar, no
 * cruzan nunca.
 */
function normalizar(texto: string): string {
  return (
    texto
      .normalize('NFD')
      // Marcas diacríticas (acentos) en escapes explícitos: en el código fuente son invisibles.
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * ¿La descripción de la factura menciona a esta tela? Se pide que TODAS las palabras del nombre de la
 * tela (de 3+ letras) aparezcan en la descripción. Es deliberadamente conservador: preferimos no
 * sugerir a sugerir mal — la persona corrige un renglón vacío en un clic, pero un amarre equivocado
 * puede pasar desapercibido y descuadrar la orden de compra.
 */
function descripcionMencionaTela(descripcion: string, nombreTela: string): boolean {
  const texto = normalizar(descripcion);
  const palabras = normalizar(nombreTela)
    .split(' ')
    .filter((p) => p.length >= 3);
  return palabras.length > 0 && palabras.every((p) => texto.includes(p));
}

/** ¿La cantidad del concepto se parece a lo que falta del renglón (±10%)? */
function cantidadParecida(cantidadCfdi: number, pendiente: number): boolean {
  if (pendiente <= 0) {
    return false;
  }
  return Math.abs(cantidadCfdi - pendiente) <= pendiente * 0.1;
}

/** Renglón pendiente tal como lo devuelve `lineasTelaPendientesDeProveedor`. */
type LineaPendiente = Awaited<ReturnType<typeof lineasTelaPendientesDeProveedor>>[number];

/** Proyecta un renglón pendiente a la sugerencia que ve la pantalla. */
function aSugerencia(linea: LineaPendiente, motivo: SugerenciaRenglonOc['motivo']) {
  return {
    idOrdenCompraLinea: linea.idOrdenCompraLinea,
    numCompra: linea.numCompra,
    idTela: linea.idTela,
    tela: linea.tela,
    unidad: linea.unidad,
    pendiente: linea.pendiente,
    pendienteComplemento: linea.pendienteComplemento,
    nombreComplemento: linea.nombreComplemento,
    motivo,
  };
}

/**
 * Cruza los conceptos de la factura con los renglones de OC pendientes del proveedor. Cada renglón
 * de OC se usa UNA sola vez (dos conceptos no pueden surtir el mismo renglón por accidente), y se
 * resuelve en dos pasadas para que la señal fuerte gane: primero los que se reconocen **por el
 * nombre de la tela**, después los que solo cuadran **por cantidad**.
 */
function cruzarConceptos(
  conceptos: CfdiConcepto[],
  pendientes: LineaPendiente[],
): ConceptoConSugerencia[] {
  const usados = new Set<number>();
  const sugerencias = new Map<number, SugerenciaRenglonOc>();

  // 1ª pasada — por NOMBRE de la tela (la señal más confiable).
  conceptos.forEach((concepto, indice) => {
    const candidato = pendientes.find(
      (l) =>
        !usados.has(l.idOrdenCompraLinea) && descripcionMencionaTela(concepto.descripcion, l.tela),
    );
    if (candidato !== undefined) {
      usados.add(candidato.idOrdenCompraLinea);
      sugerencias.set(indice, aSugerencia(candidato, 'nombre-de-la-tela'));
    }
  });

  // 2ª pasada — lo que quedó: si solo hay UN renglón pendiente sin usar, o si la cantidad cuadra.
  conceptos.forEach((concepto, indice) => {
    if (sugerencias.has(indice)) {
      return;
    }
    const libres = pendientes.filter((l) => !usados.has(l.idOrdenCompraLinea));
    const unico = libres.length === 1 ? libres[0] : undefined;
    const porCantidad = libres.find((l) => cantidadParecida(concepto.cantidad, l.pendiente));
    const elegido = unico ?? porCantidad;
    if (elegido !== undefined) {
      usados.add(elegido.idOrdenCompraLinea);
      sugerencias.set(
        indice,
        aSugerencia(elegido, unico !== undefined ? 'unico-pendiente' : 'cantidad-parecida'),
      );
    }
  });

  return conceptos.map((c, indice) => ({
    descripcion: c.descripcion,
    cantidad: c.cantidad,
    valorUnitario: c.valorUnitario,
    importe: c.importe,
    sugerencia: sugerencias.get(indice) ?? null,
  }));
}

/**
 * Lee un CFDI y devuelve la propuesta para llenar la captura de la entrada de tela. **No escribe
 * nada**: la persona revisa, corrige y captura el color antes de guardar.
 */
export async function leerCfdiParaEntradaTela(
  sesion: SesionUsuario,
  entrada: EntradaLeerCfdi,
  bd?: ContextoBd,
): Promise<PropuestaCfdiEntradaTela> {
  verificarPermiso(sesion, 'inventario-telas.mover');
  const { xml } = validarEntrada(esquemaCfdiXml, {
    xml: entrada.xml,
  } satisfies z.input<typeof esquemaCfdiXml>);
  const parsed = parsearCfdi(xml);

  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  // El receptor DEBE ser la empresa activa: `validarReceptorCfdi` (F9) RECHAZA el comprobante ajeno
  // —recibir mercancía contra la factura de alguien más no es un aviso, es un error— y solo devuelve
  // aviso cuando la empresa todavía no captura su RFC (ahí no hay contra qué validar).
  const avisos = validarReceptorCfdi(parsed, await rfcEmpresaActiva(cliente, idEmpresa));

  const proveedor = await cliente.proveedor.findFirst({
    where: { rfc: { equals: parsed.emisorRfc, mode: 'insensitive' } },
    select: { id: true, nombre: true, activo: true, factura: true },
  });
  if (proveedor === null) {
    avisos.push(
      `Ningún proveedor del catálogo tiene el RFC del emisor (${parsed.emisorRfc}). ` +
        `Elige el proveedor a mano, o captúrale su RFC para que la próxima factura se reconozca sola.`,
    );
  } else if (!proveedor.activo) {
    avisos.push(`El proveedor "${proveedor.nombre}" está desactivado en el catálogo.`);
  }
  // §Post-F9.22 — contradicción entre el catálogo y la realidad: el proveedor está marcado como que
  // NO factura, pero acaba de mandar un CFDI. AQUÍ solo se AVISA (leer no escribe nada, y el XML es
  // prueba de que sí timbra): guardar la entrada con esa factura sí lo rechaza. Se pide corregir el
  // catálogo en vez de corregirlo solos, porque la casilla la define quien da de alta al proveedor.
  if (proveedor !== null && !admiteCfdi(proveedor.factura)) {
    avisos.push(
      `El proveedor "${proveedor.nombre}" está dado de alta como que NO emite factura, pero este ` +
        `CFDI es suyo. Corrige la casilla "¿Emite factura (CFDI)?" en el catálogo de proveedores: ` +
        `si no, no vas a poder guardar la entrada con esta factura.`,
    );
  }

  // El MISMO UUID no se recibe dos veces: ni como otra entrada de tela, ni ya importado a CxP.
  const [entradaConEseUuid, yaEnCxp] = await Promise.all([
    cliente.entradaTela.findFirst({
      where: { uuidCfdi: parsed.uuid, idEmpresa },
      select: { folio: true, estatus: true },
    }),
    uuidYaImportado(cliente, parsed.uuid),
  ]);
  if (entradaConEseUuid !== null) {
    avisos.push(
      `Esta factura (UUID ${parsed.uuid}) ya se capturó en la entrada ${String(entradaConEseUuid.folio)} ` +
        `(${entradaConEseUuid.estatus}): no la captures dos veces.`,
    );
  }
  if (yaEnCxp) {
    avisos.push(`Esta factura ya está registrada en Cuentas por pagar (UUID ${parsed.uuid}).`);
  }

  // Renglones de OC pendientes contra los que se puede cruzar (solo si se reconoció al proveedor).
  const pendientes =
    proveedor === null
      ? []
      : await lineasTelaPendientesDeProveedor(sesion, proveedor.id, entrada.idOrdenCompra, bd);
  const conceptos = cruzarConceptos(parsed.conceptos, pendientes);

  if (proveedor !== null && pendientes.length === 0) {
    avisos.push(
      'Ese proveedor no tiene renglones de tela pendientes en órdenes de compra abiertas: la tela ' +
        'de esta factura entrará como tela SUELTA (sin cerrar ninguna orden).',
    );
  }
  const sinCruce = conceptos.filter((c) => c.sugerencia === null).length;
  if (pendientes.length > 0 && sinCruce > 0) {
    avisos.push(
      `${String(sinCruce)} concepto(s) de la factura no se pudieron cruzar con un renglón de la ` +
        `orden de compra: elígelos a mano (puede ser flete, otro material o un nombre distinto).`,
    );
  }

  return {
    uuid: parsed.uuid,
    numeroDocumento: `${parsed.serie ?? ''}${parsed.folio ?? ''}`.trim(),
    fecha: parsed.fecha,
    emisorRfc: parsed.emisorRfc,
    emisorNombre: parsed.emisorNombre,
    moneda: parsed.moneda,
    total: parsed.total,
    idProveedor: proveedor?.id ?? null,
    proveedor: proveedor?.nombre ?? null,
    yaUsado: entradaConEseUuid !== null || yaEnCxp,
    avisos,
    conceptos,
  };
}

// ── Sellar el CFDI en la entrada, para que al confirmar nazca la CxP (§Post-F9.21) ───────────────

/** Lo que queda sellado en la entrada cuando la captura vino de un XML. */
export interface SelloCfdi {
  uuid: string;
  /** TOTAL del comprobante (con impuestos): la verdad fiscal con la que nace el cargo de CxP. */
  total: number;
  /**
   * RFC del EMISOR, tal como venía en el XML. Viaja al cargo de CxP (`rfcTercero`) —el reporte
   * fiscal del contador lo imprime, y sin él la misma factura se veía distinta según por dónde
   * hubiera entrado— y queda en la entrada para poder re-validar el sello al editarla.
   */
  emisorRfc: string;
  /** `Archivo` del XML ya subido a R2 (respalda el cargo, igual que una importación de F9). */
  idArchivo: string;
}

/**
 * Re-parsea el XML en el SERVIDOR, valida que sea del proveedor de la entrada y de esta empresa, lo
 * sube a R2 y devuelve lo que hay que sellar. Devuelve `null` si la captura no trajo XML.
 *
 * POR QUÉ SE RE-PARSEA: el total fiscal **jamás** se acepta del cliente — es el importe que se le va
 * a deber al proveedor. La pantalla ya lo vio al leer la factura, pero quien manda es el XML.
 *
 * ORDEN DELIBERADO: la subida a R2 va ANTES de la transacción del llamador. Si la tx falla después,
 * el objeto queda huérfano en R2 (inocuo). Al revés —un cargo fiscal sin su XML— sería
 * irrecuperable. Es el mismo criterio que `importarCfdi` de F9.
 */
export async function sellarCfdiEnEntrada(
  datos: {
    xml: string | null;
    idProveedor: number;
    idEmpresa: number;
    /**
     * Entrada que se está RE-sellando (edición de un borrador). Se excluye de la búsqueda de
     * "ese UUID ya se capturó": volver a subir el MISMO XML a la MISMA entrada no es duplicarla.
     */
    idEntradaActual?: number;
  },
  bd?: ContextoBd,
  /**
   * Inyectable para probar sin R2 real. Se resuelve PEREZOSAMENTE (después del early return): una
   * entrada SIN factura no debe exigir que R2 esté configurado — `servicioArchivos()` valida el
   * entorno y truena si faltan las llaves.
   */
  archivos?: ServicioArchivos,
): Promise<SelloCfdi | null> {
  if (datos.xml === null || datos.xml.trim() === '') {
    return null;
  }
  const servicio = archivos ?? servicioArchivos();
  const parsed = parsearCfdi(datos.xml);
  const cliente = clienteLectura(bd);

  // Comprobante ajeno → se rechaza (misma regla que al leerlo).
  validarReceptorCfdi(parsed, await rfcEmpresaActiva(cliente, datos.idEmpresa));

  // El emisor DEBE ser el proveedor de la entrada: si no, la cuenta por pagar nacería a nombre de
  // quien no facturó. Se valida aquí porque el proveedor lo elige la pantalla, no el XML.
  const proveedor = await cliente.proveedor.findUnique({
    where: { id: datos.idProveedor },
    select: { nombre: true, rfc: true, factura: true },
  });
  // §Post-F9.22 — el que NO factura no puede traer factura. Se corta antes de subir nada a R2.
  if (proveedor !== null) {
    exigirProveedorQueFactura(proveedor, 'guardar la entrada con una factura (CFDI)');
  }
  if (
    proveedor !== null &&
    proveedor.rfc !== null &&
    normalizarRfc(proveedor.rfc) !== normalizarRfc(parsed.emisorRfc)
  ) {
    throw new ErrorValidacion(
      `La factura la emitió el RFC ${parsed.emisorRfc}, pero la entrada es del proveedor ` +
        `"${proveedor.nombre}" (RFC ${proveedor.rfc}). Corrige el proveedor o sube la factura correcta.`,
    );
  }

  // El MISMO CFDI no puede estar ya en Cuentas por pagar (la unique del UUID es el backstop).
  if (await uuidYaImportado(cliente, parsed.uuid)) {
    throw new ErrorConflicto(
      `Esta factura (UUID ${parsed.uuid}) ya está registrada en Cuentas por pagar: no se puede duplicar.`,
    );
  }

  // Ni puede estar ya capturado en OTRA entrada de tela (se corta ANTES de subir nada a R2).
  await exigirUuidLibreEnEntradas(cliente, datos.idEmpresa, parsed.uuid, datos.idEntradaActual);

  const subido = await servicio.subirContenido({
    nombreOriginal: `cfdi-${parsed.uuid}.xml`,
    tipoMime: 'application/xml',
    carpeta: `${CARPETA_CFDI_ENTRADAS}/${parsed.fecha.slice(0, 4)}`,
    contenido: Buffer.from(datos.xml, 'utf8'),
  });
  const archivo = await cliente.archivo.create({
    data: {
      bucket: subido.bucket,
      key: subido.key,
      nombreOriginal: subido.nombreOriginal,
      tipoMime: subido.tipoMime,
      tamanoBytes: subido.tamanoBytes,
    },
    select: { id: true },
  });

  return {
    uuid: parsed.uuid,
    total: parsed.total,
    emisorRfc: parsed.emisorRfc,
    idArchivo: archivo.id,
  };
}

/**
 * Exige que ese folio fiscal no esté ya capturado en OTRA entrada de tela de la empresa.
 *
 * El unique `(idEmpresa, uuidCfdi)` lo impediría de todos modos, pero con un **P2002 opaco** (500)
 * —y, en el caso del sellado, después de haber subido ya el XML a R2—. Aquí se corta antes y con un
 * mensaje que dice DÓNDE está la otra captura, que es lo que la persona necesita saber.
 *
 * `idEntradaActual` se excluye: volver a subir el MISMO XML a la MISMA entrada no es duplicarla.
 */
export async function exigirUuidLibreEnEntradas(
  cliente: ReturnType<typeof clienteLectura>,
  idEmpresa: number,
  uuid: string,
  idEntradaActual?: number,
): Promise<void> {
  const otra = await cliente.entradaTela.findFirst({
    where: {
      idEmpresa,
      uuidCfdi: uuid,
      ...(idEntradaActual === undefined ? {} : { id: { not: idEntradaActual } }),
    },
    select: { folio: true },
  });
  if (otra !== null) {
    throw new ErrorConflicto(
      `Esta factura (UUID ${uuid}) ya se capturó en la entrada ${String(otra.folio)}: ` +
        `no se recibe dos veces.`,
    );
  }
}

/** El sello que ya vive en una entrada (lo que queda del CFDI cuando la edición no trae XML). */
export interface SelloGuardado {
  uuidCfdi: string | null;
  rfcCfdi: string | null;
  idProveedor: number;
}

/**
 * RE-VALIDA un sello YA GUARDADO contra el proveedor con el que va a quedar el documento
 * (§Post-F9.21/22 — se estrenó al arreglar la edición del borrador).
 *
 * EL AGUJERO QUE TAPA: al editar un borrador, la factura NO se vuelve a subir (el sello se
 * conserva — un dato fiscal no se pierde por editar), pero el PROVEEDOR sí se puede cambiar. Sin
 * esta validación se podía capturar con el XML de "Textiles X", editar poniendo "Avíos Y" y
 * confirmar: el cargo FISCAL nacía contra Y respaldado con la factura de X. El emisor del
 * comprobante y el proveedor al que se le debe TIENEN que ser el mismo.
 *
 * Es la misma regla que aplica `sellarCfdiEnEntrada` cuando sí viene el XML; aquí se comprueba
 * contra el RFC que quedó guardado, sin volver a bajar el XML de R2.
 *
 * Con el sello vacío (entrada sin CFDI) no hay nada que validar.
 */
export async function exigirSelloCompatibleConProveedor(
  sello: SelloGuardado,
  idProveedorNuevo: number,
  bd?: ContextoBd,
): Promise<void> {
  if (sello.uuidCfdi === null) {
    return;
  }
  const cliente = clienteLectura(bd);
  const proveedor = await cliente.proveedor.findUnique({
    where: { id: idProveedorNuevo },
    select: { nombre: true, rfc: true, factura: true },
  });
  if (proveedor === null) {
    return; // `validarCabeceraYLineas` ya truena por proveedor inexistente, con mejor mensaje.
  }
  // §Post-F9.22 — el que NO factura no puede quedarse con una factura amarrada.
  exigirProveedorQueFactura(proveedor, 'dejar la entrada con una factura (CFDI)');

  if (sello.rfcCfdi === null) {
    // Entrada sellada ANTES de que se guardara el RFC del emisor: no hay contra qué comparar. Se
    // permite seguir editándola mientras el proveedor NO cambie; para cambiarlo hay que volver a
    // subir el XML, que es lo único que puede probar quién facturó.
    if (idProveedorNuevo !== sello.idProveedor) {
      throw new ErrorValidacion(
        `Esta entrada trae una factura (UUID ${sello.uuidCfdi}) capturada sin el RFC del emisor: ` +
          `para cambiarle el proveedor hay que volver a subir el XML de la factura.`,
      );
    }
    return;
  }
  if (proveedor.rfc !== null && normalizarRfc(proveedor.rfc) !== normalizarRfc(sello.rfcCfdi)) {
    throw new ErrorValidacion(
      `La factura capturada la emitió el RFC ${sello.rfcCfdi}, pero la entrada quedaría a nombre ` +
        `del proveedor "${proveedor.nombre}" (RFC ${proveedor.rfc}). Corrige el proveedor o sube ` +
        `la factura correcta.`,
    );
  }
}
