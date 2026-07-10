/**
 * Impreso del ESTADO DE CUENTA de un PROVEEDOR (CxP, F9-E2, R9; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §3.2). La línea de tiempo de movimientos del
 * proveedor (motor + convivencia EsMa) con su saldo derivado — el "por pagar" en papel. Documento
 * generado EN EL SERVIDOR con `@react-pdf/renderer` (`renderToBuffer`): función pura `armarDatos…` +
 * componente + render. Reusa {@link estadoCuentaProveedorCxp} (A1: la ruta solo valida permiso + Zod y
 * delega; A9 + `cxp.ver` + ocultamiento de importes + la vista fiscal ya los aplica el servicio).
 *
 * PAGADOR/EMPRESA = la razón social de la EMPRESA activa (A9), nunca hardcodeado.
 */
import { createElement as h, type ReactElement } from 'react';

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
  type DocumentProps,
} from '@react-pdf/renderer';

import {
  ETIQUETAS_ORIGEN_MOVIMIENTO_TERCERO,
  type EstadoCuentaTerceroSalida,
  type OrigenMovimientoTerceroClave,
} from '../../../../contrato/index.js';
import type { SesionUsuario } from '../../../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../../../comun/transaccion.js';
import { estadoCuentaProveedorCxp } from '../cxp.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Todo lo que necesita el documento del estado de cuenta de CxP, ya resuelto (sin BD). */
export interface DatosImpresoCxp {
  /** Pagador: razón social o nombre de la empresa (A9) — nunca hardcodeado. */
  pagador: string;
  cuenta: EstadoCuentaTerceroSalida;
}

/** Dependencias inyectables (los tests inyectan `estadoCuentaProveedorCxp` fake para no tocar BD). */
export interface DepsImpresoCxp {
  estadoCuentaProveedorCxp?: typeof estadoCuentaProveedorCxp;
}

/**
 * Resuelve los datos del estado de cuenta del proveedor (A9). Para el impreso trae hasta 100
 * movimientos (la página máxima del motor) respetando el periodo/vista solicitados.
 */
export async function armarDatosImpresoCxp(
  sesion: SesionUsuario,
  idProveedor: number,
  query: Parameters<typeof estadoCuentaProveedorCxp>[2] = {},
  bd?: ContextoBd,
  deps: DepsImpresoCxp = {},
): Promise<DatosImpresoCxp> {
  const obtener = deps.estadoCuentaProveedorCxp ?? estadoCuentaProveedorCxp;
  const cuenta = await obtener(sesion, idProveedor, { ...query, pagina: 1, porPagina: 100 }, bd);

  const cliente = clienteLectura(bd);
  const empresa = await cliente.empresa.findUnique({
    where: { id: sesion.idEmpresaActiva },
    select: { razonSocial: true, nombre: true },
  });
  const pagador = empresa?.razonSocial ?? empresa?.nombre ?? sesion.nombreEmpresaActiva;

  return { pagador, cuenta };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

const TEAL = '#0d9488';
const GRIS = '#64748b';
const GRIS_BORDE = '#e2e8f0';
const TINTA = '#0f172a';

/** Formatea un importe en pesos (o "—" si es null). */
function pesos(n: number | null): string {
  if (n === null) {
    return '—';
  }
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Etiqueta legible de un origen (usa el catálogo del motor; cae al valor crudo si no lo conoce). */
function origenTexto(origen: string): string {
  return ETIQUETAS_ORIGEN_MOVIMIENTO_TERCERO[origen as OrigenMovimientoTerceroClave] ?? origen;
}

const estilos = StyleSheet.create({
  pagina: {
    paddingVertical: 36,
    paddingHorizontal: 40,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: TINTA,
  },
  encabezado: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: TEAL,
    paddingBottom: 8,
    marginBottom: 12,
  },
  empresa: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: TEAL },
  subtitulo: { fontSize: 8, color: GRIS, marginTop: 2 },
  bloqueDerecha: { alignItems: 'flex-end' },
  etiqueta: { fontSize: 7, color: GRIS, textTransform: 'uppercase' },
  valorFuerte: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  filaCampos: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  campo: { width: '33%', marginBottom: 4, paddingRight: 8 },
  seccion: { marginTop: 4 },
  tituloSeccion: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: TEAL,
    textTransform: 'uppercase',
    marginBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: GRIS_BORDE,
    paddingBottom: 2,
  },
  filaTabla: { flexDirection: 'row' },
  celda: {
    borderWidth: 0.5,
    borderColor: GRIS_BORDE,
    paddingVertical: 3,
    paddingHorizontal: 4,
    fontSize: 8,
  },
  celdaEncabezado: { backgroundColor: '#f1f5f9', fontFamily: 'Helvetica-Bold' },
  colFecha: { width: 60 },
  colConcepto: { width: 96 },
  colFlex: { flexGrow: 1, flexBasis: 0 },
  colMarca: { width: 40, textAlign: 'center' },
  colNum: { width: 70, textAlign: 'right' },
  cancelado: { color: '#94a3b8', textDecoration: 'line-through' },
  saldoBloque: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 24,
    borderTopWidth: 1,
    borderTopColor: TEAL,
    paddingTop: 8,
  },
  saldoItem: { alignItems: 'flex-end' },
  saldoValor: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  saldoTotal: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: TEAL },
  vacio: { fontSize: 8, color: GRIS, marginTop: 2 },
  pie: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 7,
    color: '#94a3b8',
    textAlign: 'center',
  },
});

/** Un campo etiqueta/valor del encabezado. */
function campo(etiqueta: string, valor: string): ReactElement {
  return h(
    View,
    { style: estilos.campo, key: etiqueta },
    h(Text, { style: estilos.etiqueta }, etiqueta),
    h(Text, { style: estilos.valorFuerte }, valor),
  );
}

/** Tabla de movimientos (fecha/concepto/observaciones/vence/fiscal/importe). */
function tablaMovimientos(datos: DatosImpresoCxp): ReactElement {
  const movs = datos.cuenta.movimientos;
  if (movs.length === 0) {
    return h(
      View,
      { style: estilos.seccion },
      h(Text, { style: estilos.tituloSeccion }, 'Movimientos'),
      h(Text, { style: estilos.vacio }, 'Sin movimientos en el periodo.'),
    );
  }
  const encabezado = h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colFecha] }, 'Fecha'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colConcepto] }, 'Concepto'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colFlex] }, 'Observaciones'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colFecha] }, 'Vence'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colMarca] }, 'Fiscal'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Importe'),
  );
  const filas = movs.map((m, i) => {
    const estiloCelda = m.cancelado ? [estilos.celda, estilos.cancelado] : [estilos.celda];
    return h(
      View,
      { style: estilos.filaTabla, key: `m-${i}` },
      h(Text, { style: [...estiloCelda, estilos.colFecha] }, m.fecha),
      h(Text, { style: [...estiloCelda, estilos.colConcepto] }, origenTexto(m.origen)),
      h(Text, { style: [...estiloCelda, estilos.colFlex] }, m.observaciones ?? '—'),
      h(Text, { style: [...estiloCelda, estilos.colFecha] }, m.fechaVencimiento ?? '—'),
      h(Text, { style: [...estiloCelda, estilos.colMarca] }, m.esFiscal ? 'Sí' : '—'),
      h(Text, { style: [...estiloCelda, estilos.colNum] }, pesos(m.monto)),
    );
  });
  return h(
    View,
    { style: estilos.seccion },
    h(Text, { style: estilos.tituloSeccion }, 'Movimientos'),
    encabezado,
    ...filas,
  );
}

/** Bloque final con el saldo derivado. */
function bloqueSaldo(datos: DatosImpresoCxp): ReactElement {
  const s = datos.cuenta.saldo;
  const items: ReactElement[] = [
    h(
      View,
      { style: estilos.saldoItem, key: 'f' },
      h(Text, { style: estilos.etiqueta }, 'Saldo fiscal'),
      h(Text, { style: estilos.saldoValor }, pesos(s.saldoFiscal)),
    ),
  ];
  if (s.incluyeEsMa) {
    items.unshift(
      h(
        View,
        { style: estilos.saldoItem, key: 'e' },
        h(Text, { style: estilos.etiqueta }, 'Maquila (EsMa)'),
        h(Text, { style: estilos.saldoValor }, pesos(s.saldoEsMa)),
      ),
    );
  }
  items.push(
    h(
      View,
      { style: estilos.saldoItem, key: 's' },
      h(Text, { style: estilos.etiqueta }, 'Saldo por pagar'),
      h(Text, { style: estilos.saldoTotal }, pesos(s.saldo)),
    ),
  );
  return h(View, { style: estilos.saldoBloque }, ...items);
}

/** Una página del estado de cuenta de CxP. */
function paginaCxp(datos: DatosImpresoCxp): ReactElement {
  const c = datos.cuenta;
  const periodo = `${c.desde ?? '—'} a ${c.hasta ?? '—'}`;
  const vista = c.vista === 'fiscal' ? 'Fiscal (solo CFDI)' : 'Operativa (todo)';
  return h(
    Page,
    { size: 'A4', style: estilos.pagina },
    h(
      View,
      { style: estilos.encabezado, key: 'enc' },
      h(
        View,
        {},
        h(Text, { style: estilos.empresa }, datos.pagador),
        h(Text, { style: estilos.subtitulo }, 'Estado de cuenta de proveedor (CxP) — CONTROL v2'),
      ),
      h(
        View,
        { style: estilos.bloqueDerecha },
        h(Text, { style: estilos.etiqueta }, 'Proveedor'),
        h(Text, { style: estilos.valorFuerte }, c.tercero),
      ),
    ),
    h(
      View,
      { style: estilos.filaCampos, key: 'campos' },
      campo('Periodo', periodo),
      campo('Vista', vista),
      campo('Proveedor', c.tercero),
    ),
    tablaMovimientos(datos),
    bloqueSaldo(datos),
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.pagador} · Estado de cuenta de ${c.tercero} · Saldo ${pesos(c.saldo.saldo)}`,
    ),
  );
}

/** Documento del estado de cuenta de CxP. */
function documentoCxp(datos: DatosImpresoCxp): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Estado de cuenta ${datos.cuenta.tercero}`,
      author: datos.pagador,
      subject: 'Estado de cuenta de proveedor (CxP)',
    },
    paginaCxp(datos),
  );
}

/** Genera el PDF (Buffer) del estado de cuenta de CxP a partir de sus datos resueltos. */
export async function generarPdfCxp(datos: DatosImpresoCxp): Promise<Buffer> {
  return renderToBuffer(documentoCxp(datos));
}

/** Resultado de generar el impreso (Buffer + id del proveedor para el `filename`). */
export interface ImpresoCxp {
  buffer: Buffer;
  idProveedor: number;
}

/** Resuelve los datos (A9) y devuelve el PDF + el id del proveedor para el nombre del archivo. */
export async function impresoEstadoCuentaCxp(
  sesion: SesionUsuario,
  idProveedor: number,
  query: Parameters<typeof estadoCuentaProveedorCxp>[2] = {},
  bd?: ContextoBd,
  deps: DepsImpresoCxp = {},
): Promise<ImpresoCxp> {
  const datos = await armarDatosImpresoCxp(sesion, idProveedor, query, bd, deps);
  return { buffer: await generarPdfCxp(datos), idProveedor };
}
