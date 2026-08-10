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
import { rfcEmpresaActiva, uuidYaImportado } from '../terceros/cfdi/cfdi-comun.js';
import { validarReceptorCfdi } from '../terceros/cfdi/cfdi-proveedor.js';
import { parsearCfdi, type CfdiConcepto } from '../terceros/cfdi/parser-cfdi.js';
import { lineasTelaPendientesDeProveedor } from '../compras/recepciones.js';

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

  // El receptor DEBE ser la empresa activa: una factura de otra empresa no se recibe aquí.
  const avisos = validarReceptorCfdi(parsed, await rfcEmpresaActiva(cliente, idEmpresa));

  const proveedor = await cliente.proveedor.findFirst({
    where: { rfc: { equals: parsed.emisorRfc, mode: 'insensitive' } },
    select: { id: true, nombre: true, activo: true },
  });
  if (proveedor === null) {
    avisos.push(
      `Ningún proveedor del catálogo tiene el RFC del emisor (${parsed.emisorRfc}). ` +
        `Elige el proveedor a mano, o captúrale su RFC para que la próxima factura se reconozca sola.`,
    );
  } else if (!proveedor.activo) {
    avisos.push(`El proveedor "${proveedor.nombre}" está desactivado en el catálogo.`);
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
