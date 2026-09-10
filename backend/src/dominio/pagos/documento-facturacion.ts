/**
 * ⭐ EL DOCUMENTO PARA FACTURAR (fila 0.118) — §Post-F9.186(k).
 *
 * Daniel: *«Nadie me factura si no le mando yo un documento con los datos con los que me tiene que
 * facturar… **no al revés**. Y eso debe salir del sistema.»* Y sobre qué lleva: *«Lo ideal es que
 * facture lo que es en total. Por eso quedamos que nosotros le vamos a dar un documento con el que
 * va a facturar.»* Es lo mismo que su cliente (C&A) le hace a él: **el que paga dicta**.
 *
 * ## Qué es y qué NO es
 * Es un IMPRESO, no un módulo: no hay tabla, ni folio, ni estado. Se arma al vuelo desde un renglón
 * de la corrida semanal y se manda. Todo lo que dice sale de datos ya guardados, así que
 * reimprimirlo mañana da exactamente lo mismo.
 *
 * ## Las tres reglas que sostiene
 *  1. **El IVA va EXPLÍCITO** (`comun/iva.ts`): subtotal, IVA y total impresos y sumando al centavo.
 *     En el Excel de producción va escondido dentro del total, y ése es justo el problema.
 *  2. **Sólo transferencias.** Daniel: *«las facturas son sólo transferencias»*. Un renglón en
 *     efectivo no produce documento.
 *  3. **Nada se inventa.** Si falta un dato fiscal —de él o del proveedor— el documento **NO se
 *     emite** y se dice CUÁL falta y DE QUIÉN: *«proveedor sin RFC ⇒ no se emite: hay que avisar
 *     cuál falta, nunca inventarlo»*. Es REGLA 0-B en su forma más literal.
 *
 * ## Un documento POR PAGO (y por qué no puede ser por orden)
 * El renglón de la corrida NO está amarrado a cargos concretos: el pago de maquila nace «a cuenta»
 * y el de proveedor es un movimiento de CxP sin aplicaciones. No hay, hoy, forma honesta de decir
 * «de este pago, tanto es de la orden 1234». Y tampoco hace falta: lo que se factura es lo que se
 * transfiere, que es lo que Daniel pidió.
 *
 * ## Los datos fiscales se leen VIVOS, no congelados
 * El renglón congela el DESTINO del dinero (banco, cuenta, beneficiario) porque reimprimir la
 * relación no puede cambiar a dónde salió el pago. Los datos FISCALES son lo contrario: si el
 * proveedor cambió de régimen la semana pasada, la factura que va a emitir hoy lleva el nuevo, y un
 * documento con el régimen viejo le impediría timbrar. Por eso el emisor se lee del catálogo y el
 * receptor de la empresa, siempre al día.
 */
import { ORDEN_RUBROS_PAGO } from '../../contrato/index.js';
import type {
  DocumentoFacturacion,
  DocumentoFacturacionSalida,
  FacturabilidadRenglon,
  FaltanteFiscal,
  FormaDePagoClave,
  MotivoNoFacturable,
  OrigenRenglonPagoClave,
  RubroPagoClave,
} from '../../contrato/index.js';
import type { PrismaClient } from '../../datos/index.js';

import { ErrorNoEncontrado } from '../../comun/errores.js';
import { desglosarIva, TASA_IVA_TEXTO } from '../../comun/iva.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd, type Tx } from '../../comun/transaccion.js';

import {
  exigirCorrida,
  exigirVerCorrida,
  type CorridaConRenglones,
  type RenglonFila,
} from './acceso-corrida.js';
import { aFechaIso } from './semana.js';
import { tieneMonto } from './totales.js';

// ── Las claves del SAT que el documento dicta ────────────────────────────────────────────────────

/** Forma de pago del SAT: 03 = transferencia electrónica. Es la única que produce documento. */
const FORMA_PAGO_SAT = '03';
/** Su descripción, tal como se imprime. */
const FORMA_PAGO_TEXTO = 'Transferencia electrónica de fondos';
/** Método de pago: PUE = pago en una sola exhibición (el pago ya salió, no queda a crédito). */
const METODO_PAGO_SAT = 'PUE';
/** Su descripción, tal como se imprime. */
const METODO_PAGO_TEXTO = 'Pago en una sola exhibición';
/** Moneda del comprobante. */
const MONEDA = 'MXN';

/**
 * 🟡 **DEFAULT PENDIENTE DE CONFIRMAR POR DANIEL.** Uso de CFDI cuando el proveedor no tiene
 * capturado su `usoCfdiHabitual`.
 *
 * Va como **default visible** y no como faltante porque el uso de CFDI **no es un dato del
 * proveedor**: es lo que declara quien RECIBE la factura, o sea FR Moda. Negarse a emitir por un
 * dato que decide el propio receptor sería absurdo. Se imprime marcado como «sugerido» para que
 * quien mande el documento sepa que ahí hay una decisión y no un dato capturado.
 */
export const USO_CFDI_SUGERIDO = 'G03';

// ── Lo que se necesita para decidir, sin base de datos ───────────────────────────────────────────

/** Del renglón: lo que decide si produce documento y con qué cifras. */
export interface RenglonParaFacturar {
  origen: OrigenRenglonPagoClave;
  formaPago: FormaDePagoClave;
  /** Lo que se transfiere. Es el TOTAL con IVA (ver `comun/iva.ts`). */
  monto: number;
  rubro: RubroPagoClave;
  /** Nombre congelado con el que el renglón sale impreso. */
  nombre: string;
  /** La explicación del pago, si se capturó. */
  concepto: string | null;
  referencia: string | null;
}

/** Los datos fiscales del EMISOR (el proveedor), tal como están en el catálogo. */
export interface EmisorFiscal {
  nombre: string;
  razonSocial: string | null;
  rfc: string | null;
  regimenFiscalSat: string | null;
  codigoPostalExpedicion: string | null;
  usoCfdiHabitual: string | null;
}

/** Los datos fiscales del RECEPTOR (la empresa activa, A9). */
export interface ReceptorFiscal {
  nombre: string;
  razonSocial: string | null;
  rfc: string | null;
  regimenFiscalSat: string | null;
  codigoPostalFiscal: string | null;
}

/** Todo lo que hace falta para decidir y armar, ya resuelto (sin base). */
export interface EntradaDocumento {
  idCorrida: number;
  folioCorrida: number;
  semana: string;
  conFactura: boolean;
  estado: 'borrador' | 'cerrada' | 'ejecutada';
  idRenglon: number;
  renglon: RenglonParaFacturar;
  /** El proveedor del renglón, o `null` si el renglón es de un concepto del catálogo. */
  emisor: EmisorFiscal | null;
  receptor: ReceptorFiscal;
}

// ── Qué falta, y de quién ────────────────────────────────────────────────────────────────────────

/** ¿Este dato está capturado de verdad? Una cadena de espacios no es un RFC. */
function falta(valor: string | null): boolean {
  return valor === null || valor.trim() === '';
}

/**
 * Los datos fiscales que le faltan al EMISOR. Son los cuatro que el proveedor necesita para timbrar
 * a nuestro nombre; el `usoCfdiHabitual` NO entra (ver {@link USO_CFDI_SUGERIDO}).
 */
export function faltantesDelEmisor(emisor: EmisorFiscal): FaltanteFiscal[] {
  const quien = 'proveedor' as const;
  const de = `del proveedor ${emisor.nombre}`;
  const faltas: FaltanteFiscal[] = [];
  if (falta(emisor.razonSocial)) {
    faltas.push({ quien, campo: 'razonSocial', texto: `Falta la razón social ${de}` });
  }
  if (falta(emisor.rfc)) {
    faltas.push({ quien, campo: 'rfc', texto: `Falta el RFC ${de}` });
  }
  if (falta(emisor.regimenFiscalSat)) {
    faltas.push({ quien, campo: 'regimenFiscalSat', texto: `Falta el régimen fiscal ${de}` });
  }
  if (falta(emisor.codigoPostalExpedicion)) {
    faltas.push({
      quien,
      campo: 'codigoPostalExpedicion',
      texto: `Falta el código postal de expedición ${de}`,
    });
  }
  return faltas;
}

/**
 * Los datos fiscales que le faltan al RECEPTOR (esta empresa). Se capturan en Administración ›
 * Empresas, y el aviso lo dice para que quien lo lea sepa a dónde ir.
 */
export function faltantesDelReceptor(receptor: ReceptorFiscal): FaltanteFiscal[] {
  const quien = 'empresa' as const;
  const de = `de ${receptor.razonSocial ?? receptor.nombre} (Administración › Empresas)`;
  const faltas: FaltanteFiscal[] = [];
  if (falta(receptor.razonSocial)) {
    faltas.push({
      quien,
      campo: 'razonSocial',
      texto: `Falta la razón social de ${receptor.nombre} (Administración › Empresas)`,
    });
  }
  if (falta(receptor.rfc)) {
    faltas.push({ quien, campo: 'rfc', texto: `Falta el RFC ${de}` });
  }
  if (falta(receptor.regimenFiscalSat)) {
    faltas.push({ quien, campo: 'regimenFiscalSat', texto: `Falta el régimen fiscal ${de}` });
  }
  if (falta(receptor.codigoPostalFiscal)) {
    faltas.push({
      quien,
      campo: 'codigoPostalFiscal',
      texto: `Falta el código postal fiscal ${de}`,
    });
  }
  return faltas;
}

/** El texto de cada motivo, en las palabras que se leen en la pantalla y en el impreso. */
function textoMotivo(motivo: MotivoNoFacturable, entrada: EntradaDocumento): string {
  switch (motivo) {
    case 'sinFactura':
      return 'Esta corrida es la relación SIN factura: no lleva comprobante.';
    case 'concepto':
      return 'Es un concepto del catálogo, no un proveedor: no hay quién facture.';
    case 'proveedorNoLegible':
      return 'No se pudieron leer los datos del proveedor de este renglón.';
    case 'efectivo':
      return 'El pago sale en efectivo, y las facturas son sólo transferencias.';
    case 'sinMonto':
      return 'El renglón está en cero: no hay nada que facturar.';
    case 'estado':
      return 'La corrida sigue en borrador: ciérrala para que los montos queden finales.';
    case 'faltantes':
      return `Faltan datos fiscales (${String(faltantesDe(entrada).length)}): sin ellos el proveedor no puede timbrar.`;
  }
}

/** Los faltantes de los DOS lados, primero el emisor (que es de quien Daniel quiere el aviso). */
function faltantesDe(entrada: EntradaDocumento): FaltanteFiscal[] {
  const delEmisor = entrada.emisor === null ? [] : faltantesDelEmisor(entrada.emisor);
  return [...delEmisor, ...faltantesDelReceptor(entrada.receptor)];
}

/**
 * ⭐ ¿Este renglón produce documento? Y si no, ¿por qué?
 *
 * Los motivos se evalúan **en el orden de `MOTIVOS_NO_FACTURABLE`** y gana el primero: primero lo
 * que no va a ser facturable nunca (es la relación sin factura, es un concepto, sale en efectivo,
 * está en cero), después lo que se arregla cerrando la corrida, y al final lo que se arregla
 * capturando datos. Uno solo, para que la pantalla diga UNA cosa.
 *
 * ⚠️ Es una función PURA: recibe todo resuelto. La reja de permisos y la lectura viven abajo.
 */
export function evaluarFacturabilidad(entrada: EntradaDocumento): FacturabilidadRenglon {
  const noFacturable = (motivo: MotivoNoFacturable): FacturabilidadRenglon => ({
    facturable: false,
    motivo,
    motivoTexto: textoMotivo(motivo, entrada),
    faltantes: motivo === 'faltantes' ? faltantesDe(entrada) : [],
  });

  if (!entrada.conFactura) {
    return noFacturable('sinFactura');
  }
  if (entrada.renglon.origen === 'concepto') {
    return noFacturable('concepto');
  }
  // Un renglón de PROVEEDOR sin emisor legible acaba igual de sin-documento, pero por otra razón y
  // con otro arreglo: decirle «es un concepto del catálogo» mandaría a mirar el catálogo de
  // conceptos, donde no hay nada que hacer.
  if (entrada.emisor === null) {
    return noFacturable('proveedorNoLegible');
  }
  if (entrada.renglon.formaPago === 'efectivo') {
    return noFacturable('efectivo');
  }
  if (!tieneMonto(entrada.renglon.monto)) {
    return noFacturable('sinMonto');
  }
  if (entrada.estado === 'borrador') {
    return noFacturable('estado');
  }
  if (faltantesDe(entrada).length > 0) {
    return noFacturable('faltantes');
  }
  return { facturable: true, motivo: null, motivoTexto: null, faltantes: [] };
}

// ── El concepto que se factura ───────────────────────────────────────────────────────────────────

/** Cómo se llama cada sección de la relación cuando hay que armar un concepto con ella. */
const CONCEPTO_POR_RUBRO: Record<RubroPagoClave, string> = {
  maquila: 'Servicios de maquila',
  proveedores: 'Servicios y suministros',
  nomina: 'Nómina por fuera',
  servicios: 'Servicios',
  caja_chica: 'Caja chica',
  otros: 'Otros servicios',
};

/**
 * QUÉ dice que se está facturando. Si el renglón trae su concepto capturado —la columna que
 * finanzas lee para ejecutar la transferencia— se usa ése tal cual: es la explicación real del pago
 * y nadie la va a redactar mejor. Si no, se arma uno por rubro con la semana, que al menos ubica el
 * pago en el tiempo.
 *
 * ⚠️ Nunca queda vacío: un CFDI sin descripción de concepto no se puede timbrar.
 */
export function conceptoDelDocumento(renglon: RenglonParaFacturar, semana: string): string {
  const capturado = renglon.concepto?.trim() ?? '';
  if (capturado !== '') {
    return capturado;
  }
  return `${CONCEPTO_POR_RUBRO[renglon.rubro]} — semana del ${semana}`;
}

// ── El documento ya armado ───────────────────────────────────────────────────────────────────────

/** Toma un valor que YA se comprobó presente (los faltantes se validaron antes). */
function presente(valor: string | null): string {
  return valor?.trim() ?? '';
}

/**
 * Arma el documento a partir de una entrada que ya pasó {@link evaluarFacturabilidad}. Es PURA.
 *
 * ⚠️ Sólo se llama cuando `facturable` es `true`: si se llamara antes, los campos que faltan
 * saldrían en blanco y el proveedor recibiría un documento a medias — que es exactamente lo que
 * este módulo existe para impedir.
 */
export function armarDocumento(entrada: EntradaDocumento): DocumentoFacturacion {
  const emisor = entrada.emisor;
  if (emisor === null) {
    throw new Error('armarDocumento: el renglón no tiene emisor (evaluarFacturabilidad primero).');
  }
  const { subtotal, iva, total } = desglosarIva(entrada.renglon.monto);
  const usoCapturado = presente(emisor.usoCfdiHabitual);
  return {
    idCorrida: entrada.idCorrida,
    idRenglon: entrada.idRenglon,
    folioCorrida: entrada.folioCorrida,
    semana: entrada.semana,
    receptor: {
      razonSocial: presente(entrada.receptor.razonSocial),
      rfc: presente(entrada.receptor.rfc),
      regimenFiscalSat: presente(entrada.receptor.regimenFiscalSat),
      codigoPostal: presente(entrada.receptor.codigoPostalFiscal),
    },
    emisor: {
      razonSocial: presente(emisor.razonSocial),
      rfc: presente(emisor.rfc),
      regimenFiscalSat: presente(emisor.regimenFiscalSat),
      codigoPostal: presente(emisor.codigoPostalExpedicion),
    },
    nombreProveedor: emisor.nombre,
    usoCfdi: usoCapturado === '' ? USO_CFDI_SUGERIDO : usoCapturado,
    usoCfdiSugerido: usoCapturado === '',
    concepto: conceptoDelDocumento(entrada.renglon, entrada.semana),
    referencia: entrada.renglon.referencia,
    formaPagoSat: FORMA_PAGO_SAT,
    formaPagoTexto: FORMA_PAGO_TEXTO,
    metodoPagoSat: METODO_PAGO_SAT,
    metodoPagoTexto: METODO_PAGO_TEXTO,
    moneda: MONEDA,
    subtotal,
    iva,
    tasaIvaTexto: TASA_IVA_TEXTO,
    total,
  };
}

/** Decide y, si procede, arma. Es el par {@link evaluarFacturabilidad} + {@link armarDocumento}. */
export function documentoDe(entrada: EntradaDocumento): DocumentoFacturacionSalida {
  const veredicto = evaluarFacturabilidad(entrada);
  return {
    ...veredicto,
    documento: veredicto.facturable ? armarDocumento(entrada) : null,
  };
}

// ── Lo que sí toca la base ───────────────────────────────────────────────────────────────────────

/** Los campos fiscales del proveedor que el documento necesita. */
const SELECT_EMISOR = {
  id: true,
  nombre: true,
  razonSocial: true,
  rfc: true,
  regimenFiscalSat: true,
  codigoPostalExpedicion: true,
  usoCfdiHabitual: true,
} as const;

/** Los campos fiscales de la empresa (el receptor). */
const SELECT_RECEPTOR = {
  nombre: true,
  razonSocial: true,
  rfc: true,
  regimenFiscalSat: true,
  codigoPostalFiscal: true,
} as const;

/**
 * Lee el RECEPTOR (la empresa activa, A9). Si la empresa no estuviera, se cae al nombre de la
 * sesión con todo lo fiscal vacío: el documento no se emite y la lista de faltantes lo dice — que
 * es la respuesta correcta y no un 500.
 */
async function leerReceptor(
  cliente: Tx | PrismaClient,
  sesion: SesionUsuario,
): Promise<ReceptorFiscal> {
  const empresa = await cliente.empresa.findUnique({
    where: { id: sesion.idEmpresaActiva },
    select: SELECT_RECEPTOR,
  });
  return (
    empresa ?? {
      nombre: sesion.nombreEmpresaActiva,
      razonSocial: null,
      rfc: null,
      regimenFiscalSat: null,
      codigoPostalFiscal: null,
    }
  );
}

/** Pasa un renglón de Prisma a la forma pura que las reglas necesitan. */
function aRenglonParaFacturar(r: RenglonFila): RenglonParaFacturar {
  return {
    origen: r.origen,
    formaPago: r.formaPago,
    monto: r.monto.toNumber(),
    rubro: r.rubro,
    nombre: r.nombre,
    concepto: r.concepto,
    referencia: r.referencia,
  };
}

/** Arma la entrada pura de un renglón con la corrida, el emisor y el receptor ya leídos. */
function entradaDe(
  corrida: CorridaConRenglones,
  renglon: RenglonFila,
  emisores: Map<number, EmisorFiscal>,
  receptor: ReceptorFiscal,
): EntradaDocumento {
  return {
    idCorrida: corrida.id,
    folioCorrida: Number(corrida.folio),
    semana: aFechaIso(corrida.semana),
    conFactura: corrida.conFactura,
    estado: corrida.estado,
    idRenglon: renglon.id,
    renglon: aRenglonParaFacturar(renglon),
    emisor: renglon.idProveedor === null ? null : (emisores.get(renglon.idProveedor) ?? null),
    receptor,
  };
}

/** Lee de una sola vez los proveedores de todos los renglones que los tienen. */
async function leerEmisores(
  cliente: Tx | PrismaClient,
  renglones: readonly RenglonFila[],
): Promise<Map<number, EmisorFiscal>> {
  const ids = [
    ...new Set(renglones.flatMap((r) => (r.idProveedor === null ? [] : [r.idProveedor]))),
  ];
  if (ids.length === 0) {
    return new Map();
  }
  const filas = await cliente.proveedor.findMany({
    where: { id: { in: ids } },
    select: SELECT_EMISOR,
  });
  return new Map(filas.map((p) => [p.id, p]));
}

/**
 * Veredicto de respaldo: NO facturable, sin motivo.
 *
 * El mapa de {@link facturabilidadDeRenglones} se arma con los MISMOS renglones que el llamador
 * recorre, así que un `get` fallido no puede ocurrir — pero un `Map` no sabe prometérselo al
 * compilador. Existe para que ese hueco imposible falle del lado seguro (sin botón) en vez de con
 * un `undefined` que reviente el contrato.
 */
export const SIN_FACTURACION: FacturabilidadRenglon = {
  facturable: false,
  motivo: null,
  // Lleva TEXTO aunque el caso sea inalcanzable: la pantalla lo pone en el `title` y en el
  // `aria-label` del botón, y un `null` aquí dejaría un tooltip vacío y un «No se puede facturar
  // X: » colgando. Un respaldo que se ve tiene que poder leerse.
  motivoTexto: 'Sin información de facturación para este renglón.',
  faltantes: [],
};

/**
 * ⭐ La facturabilidad de TODOS los renglones de una corrida, de dos consultas (los proveedores y la
 * empresa). La usa el CONCENTRADO para pintar sus botones sin una llamada por renglón.
 *
 * No verifica permisos: la llama quien ya los verificó (el concentrado exige `pagos.corrida-ver` +
 * `consultas.ver-importes`). Se documenta aquí porque una función de dominio sin reja es justo la
 * que un día se llama desde otro sitio sin ella.
 */
export async function facturabilidadDeRenglones(
  cliente: Tx | PrismaClient,
  sesion: SesionUsuario,
  corrida: CorridaConRenglones,
  renglones: readonly RenglonFila[],
): Promise<Map<number, FacturabilidadRenglon>> {
  const [emisores, receptor] = await Promise.all([
    leerEmisores(cliente, renglones),
    leerReceptor(cliente, sesion),
  ]);
  return new Map(
    renglones.map((r) => [r.id, evaluarFacturabilidad(entradaDe(corrida, r, emisores, receptor))]),
  );
}

/**
 * ⭐ EL DOCUMENTO de UN renglón: o los datos con los que el proveedor debe facturar, o el motivo por
 * el que no se emite.
 *
 * Exige los MISMOS permisos que la relación ejecutable (`pagos.corrida-ver` **o** `-armar`, más
 * `consultas.ver-importes`): el documento lleva importes, y sin poder ver dinero no tiene sentido.
 */
export async function datosDocumentoFacturacion(
  sesion: SesionUsuario,
  idCorrida: number,
  idRenglon: number,
  bd?: ContextoBd,
): Promise<DocumentoFacturacionSalida> {
  exigirVerCorrida(sesion);
  verificarPermiso(sesion, 'consultas.ver-importes');
  const cliente = clienteLectura(bd);
  const corrida = await exigirCorrida(cliente, sesion.idEmpresaActiva, idCorrida);

  const renglon = corrida.renglones.find((r) => r.id === idRenglon);
  if (renglon === undefined) {
    // 404 y no 400: desde fuera, un renglón de otra corrida y uno inexistente son lo mismo.
    throw new ErrorNoEncontrado('RenglonCorridaPago', idRenglon);
  }

  const [emisores, receptor] = await Promise.all([
    leerEmisores(cliente, [renglon]),
    leerReceptor(cliente, sesion),
  ]);
  return documentoDe(entradaDe(corrida, renglon, emisores, receptor));
}

/** Un renglón que NO produjo documento, con su porqué (lo que ve Daniel de un vistazo). */
export interface RenglonNoEmitido {
  nombre: string;
  beneficiario: string;
  monto: number;
  motivo: MotivoNoFacturable;
  motivoTexto: string;
  faltantes: FaltanteFiscal[];
}

/** Todos los documentos de una corrida, más la lista de los que no se emitieron y por qué. */
export interface DocumentosDeCorrida {
  /** Membrete del impreso: razón social de la empresa, o su nombre (A9). */
  membrete: string;
  folioCorrida: number;
  semana: string;
  conFactura: boolean;
  estado: 'borrador' | 'cerrada' | 'ejecutada';
  documentos: DocumentoFacturacion[];
  noEmitidos: RenglonNoEmitido[];
}

/**
 * ⭐ LA CORRIDA ENTERA: un documento por cada renglón facturable, y la lista de los que se quedaron
 * fuera con su motivo.
 *
 * Los renglones EN CERO se saltan del todo (ni documento ni aviso): no salen en la relación
 * ejecutable, así que anunciar que «no se facturan» sería ruido sobre algo que no es un pago.
 *
 * El orden es el de la relación: por rubro y, dentro del rubro, por monto descendente — el mismo
 * con el que Daniel lee su Excel, para que la pila de hojas salga en el orden que espera.
 */
export async function documentosDeCorrida(
  sesion: SesionUsuario,
  idCorrida: number,
  bd?: ContextoBd,
): Promise<DocumentosDeCorrida> {
  exigirVerCorrida(sesion);
  verificarPermiso(sesion, 'consultas.ver-importes');
  const cliente = clienteLectura(bd);
  const corrida = await exigirCorrida(cliente, sesion.idEmpresaActiva, idCorrida);

  // ⚠️ El rubro se ordena por la POSICIÓN en `ORDEN_RUBROS_PAGO` (maquileros primero), no
  // alfabéticamente: es el orden del Excel de Daniel y el mismo con el que sale el concentrado. Un
  // `localeCompare` sobre la clave del enum daría «caja_chica, maquila, nomina…», que no es el suyo.
  const conMonto = corrida.renglones
    .filter((r) => tieneMonto(r.monto.toNumber()))
    .sort(
      (a, b) =>
        ORDEN_RUBROS_PAGO.indexOf(a.rubro) - ORDEN_RUBROS_PAGO.indexOf(b.rubro) ||
        b.monto.toNumber() - a.monto.toNumber() ||
        a.nombre.localeCompare(b.nombre, 'es'),
    );

  const [emisores, receptor] = await Promise.all([
    leerEmisores(cliente, conMonto),
    leerReceptor(cliente, sesion),
  ]);

  const documentos: DocumentoFacturacion[] = [];
  const noEmitidos: RenglonNoEmitido[] = [];
  for (const renglon of conMonto) {
    const entrada = entradaDe(corrida, renglon, emisores, receptor);
    const salida = documentoDe(entrada);
    if (salida.documento !== null) {
      documentos.push(salida.documento);
    } else {
      noEmitidos.push({
        nombre: renglon.nombre,
        beneficiario: renglon.beneficiario,
        monto: renglon.monto.toNumber(),
        motivo: salida.motivo ?? 'faltantes',
        motivoTexto: salida.motivoTexto ?? '',
        faltantes: salida.faltantes,
      });
    }
  }

  return {
    membrete: receptor.razonSocial ?? receptor.nombre,
    folioCorrida: Number(corrida.folio),
    semana: aFechaIso(corrida.semana),
    conFactura: corrida.conFactura,
    estado: corrida.estado,
    documentos,
    noEmitidos,
  };
}
