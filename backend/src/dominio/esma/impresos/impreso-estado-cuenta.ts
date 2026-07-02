/**
 * Impreso del ESTADO DE CUENTA de un maquilero por periodo (F6-E5, R9; doc 07-EsMa §4, ex
 * `EsMa_EdoDesglosado` + fila "estado de cuenta" de REQUISITOS §R9): el desglosado por orden/modelo/
 * cantidad/precio/importe + los abonos/descuentos/pagos del periodo + el saldo final.
 *
 * PAGADOR/EMPRESA = la razón social de la EMPRESA activa (A9), nunca hardcodeado — mismo criterio y
 * misma helper `pagadorDeEmpresa` que el recibo de pago. Documento generado EN EL SERVIDOR con
 * `@react-pdf/renderer` (`renderToBuffer`), función pura `armarDatos…` + componente + render. Reusa
 * {@link estadoCuentaDesglosado} (A1: la ruta solo valida permiso + Zod y delega; A9 + `esma.ver-pagos`
 * + ocultamiento de importes ya los aplica el servicio de dominio).
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

import type { DesglosadoSalida } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';
import { estadoCuentaDesglosado } from '../estado-cuenta.js';
import type { z } from 'zod';
import type { esquemaEstadoCuentaQuery } from '../../../contrato/index.js';

import { pagadorDeEmpresa } from './impreso-recibo-pago.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Todo lo que necesita el documento del estado de cuenta, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoEstadoCuenta {
  /** Pagador: razón social o nombre de la empresa (A9) — nunca hardcodeado. */
  pagador: string;
  desglosado: DesglosadoSalida;
}

/** Dependencias inyectables (los tests inyectan `estadoCuentaDesglosado` fake para no tocar BD). */
export interface DepsImpresoEstadoCuenta {
  estadoCuentaDesglosado?: typeof estadoCuentaDesglosado;
}

/**
 * Resuelve los datos del estado de cuenta (A9, vía `estadoCuentaDesglosado`). Consulta aparte la razón
 * social/nombre de la EMPRESA activa para el encabezado (no viaja en la proyección del desglosado).
 */
export async function armarDatosImpresoEstadoCuenta(
  sesion: SesionUsuario,
  idMaquilero: number,
  query: z.input<typeof esquemaEstadoCuentaQuery> = {},
  bd?: ContextoBd,
  deps: DepsImpresoEstadoCuenta = {},
): Promise<DatosImpresoEstadoCuenta> {
  const obtener = deps.estadoCuentaDesglosado ?? estadoCuentaDesglosado;
  const desglosado = await obtener(sesion, idMaquilero, query, bd);
  const cliente = clienteLectura(bd);

  const empresa = await cliente.empresa.findUnique({
    where: { id: sesion.idEmpresaActiva },
    select: { razonSocial: true, nombre: true },
  });
  const pagador = pagadorDeEmpresa(
    empresa ?? { razonSocial: null, nombre: sesion.nombreEmpresaActiva },
  );

  return { pagador, desglosado };
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

/** Segmento de facturación legible para el encabezado. */
function facturaTexto(seg: 'con' | 'sin' | null): string {
  return seg === null ? 'Todo (con y sin factura)' : seg === 'con' ? 'Con factura' : 'Sin factura';
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
  seccion: { marginTop: 12 },
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
  colChica: { width: 44 },
  colMedia: { width: 90 },
  colFlex: { flexGrow: 1, flexBasis: 0 },
  colNum: { width: 62, textAlign: 'right' },
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

/** Tabla de CARGOS desglosados (orden/modelo/proceso/cantidad/precio/importe). */
function tablaCargos(datos: DatosImpresoEstadoCuenta): ReactElement {
  const cargos = datos.desglosado.cargos;
  if (cargos.length === 0) {
    return h(
      View,
      { style: estilos.seccion },
      h(Text, { style: estilos.tituloSeccion }, 'Cargos (maquila)'),
      h(Text, { style: estilos.vacio }, 'Sin cargos en el periodo.'),
    );
  }
  const encabezado = h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colChica] }, 'Orden'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colFlex] }, 'Modelo'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colMedia] }, 'Proceso'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Cant.'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Precio'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Importe'),
  );
  const filas = cargos.map((c, i) =>
    h(
      View,
      { style: estilos.filaTabla, key: `c-${i}` },
      h(Text, { style: [estilos.celda, estilos.colChica] }, `#${String(c.folioOrden)}`),
      h(
        Text,
        { style: [estilos.celda, estilos.colFlex] },
        c.descripcionModelo ? `${c.codigoModelo} — ${c.descripcionModelo}` : c.codigoModelo,
      ),
      h(
        Text,
        { style: [estilos.celda, estilos.colMedia] },
        `${c.tipoProceso}${c.sinCosto ? ' (sin costo)' : ''}`,
      ),
      h(
        Text,
        { style: [estilos.celda, estilos.colNum] },
        c.cantidad === null ? '—' : String(c.cantidad),
      ),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(c.precio)),
      h(Text, { style: [estilos.celda, estilos.colNum] }, c.sinCosto ? pesos(0) : pesos(c.importe)),
    ),
  );
  return h(
    View,
    { style: estilos.seccion },
    h(Text, { style: estilos.tituloSeccion }, 'Cargos (maquila)'),
    encabezado,
    ...filas,
  );
}

/** Tabla simple de abonos o descuentos (fecha/observaciones/importe). */
function tablaMovimientos(titulo: string, filasDatos: DesglosadoSalida['abonos']): ReactElement {
  if (filasDatos.length === 0) {
    return h(
      View,
      { style: estilos.seccion },
      h(Text, { style: estilos.tituloSeccion }, titulo),
      h(Text, { style: estilos.vacio }, 'Sin movimientos en el periodo.'),
    );
  }
  const encabezado = h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colMedia] }, 'Fecha'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colFlex] }, 'Observaciones'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Importe'),
  );
  const filas = filasDatos.map((m, i) =>
    h(
      View,
      { style: estilos.filaTabla, key: `m-${i}` },
      h(Text, { style: [estilos.celda, estilos.colMedia] }, m.fecha),
      h(Text, { style: [estilos.celda, estilos.colFlex] }, m.observaciones ?? '—'),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(m.monto)),
    ),
  );
  return h(
    View,
    { style: estilos.seccion },
    h(Text, { style: estilos.tituloSeccion }, titulo),
    encabezado,
    ...filas,
  );
}

/** Tabla de pagos (fecha/órdenes/importe). */
function tablaPagos(datos: DatosImpresoEstadoCuenta): ReactElement {
  const pagos = datos.desglosado.pagos;
  if (pagos.length === 0) {
    return h(
      View,
      { style: estilos.seccion },
      h(Text, { style: estilos.tituloSeccion }, 'Pagos'),
      h(Text, { style: estilos.vacio }, 'Sin pagos en el periodo.'),
    );
  }
  const encabezado = h(
    View,
    { style: estilos.filaTabla, key: 'enc' },
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colMedia] }, 'Fecha'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colFlex] }, 'Órdenes'),
    h(Text, { style: [estilos.celda, estilos.celdaEncabezado, estilos.colNum] }, 'Importe'),
  );
  const filas = pagos.map((p, i) => {
    const folios = [...new Set(p.aplicaciones.map((a) => a.folioOrden))]
      .sort((x, y) => x - y)
      .map((f) => `#${String(f)}`)
      .join(', ');
    return h(
      View,
      { style: estilos.filaTabla, key: `p-${i}` },
      h(Text, { style: [estilos.celda, estilos.colMedia] }, p.fecha),
      h(Text, { style: [estilos.celda, estilos.colFlex] }, folios || `Pago #${String(p.id)}`),
      h(Text, { style: [estilos.celda, estilos.colNum] }, pesos(p.monto)),
    );
  });
  return h(
    View,
    { style: estilos.seccion },
    h(Text, { style: estilos.tituloSeccion }, 'Pagos'),
    encabezado,
    ...filas,
  );
}

/** Bloque final con el saldo derivado. */
function bloqueSaldo(datos: DatosImpresoEstadoCuenta): ReactElement {
  const s = datos.desglosado.saldo;
  return h(
    View,
    { style: estilos.saldoBloque },
    h(
      View,
      { style: estilos.saldoItem, key: 'c' },
      h(Text, { style: estilos.etiqueta }, 'Cargos'),
      h(Text, { style: estilos.saldoValor }, pesos(s.totalCargos)),
    ),
    h(
      View,
      { style: estilos.saldoItem, key: 'a' },
      h(Text, { style: estilos.etiqueta }, 'Abonos'),
      h(Text, { style: estilos.saldoValor }, pesos(s.totalAbonos)),
    ),
    h(
      View,
      { style: estilos.saldoItem, key: 'p' },
      h(Text, { style: estilos.etiqueta }, 'Pagos'),
      h(Text, { style: estilos.saldoValor }, pesos(s.totalPagos)),
    ),
    h(
      View,
      { style: estilos.saldoItem, key: 'd' },
      h(Text, { style: estilos.etiqueta }, 'Descuentos'),
      h(Text, { style: estilos.saldoValor }, pesos(s.totalDescuentos)),
    ),
    h(
      View,
      { style: estilos.saldoItem, key: 's' },
      h(Text, { style: estilos.etiqueta }, 'Saldo'),
      h(Text, { style: estilos.saldoTotal }, pesos(s.saldo)),
    ),
  );
}

/** Una página del estado de cuenta. */
function paginaEstadoCuenta(datos: DatosImpresoEstadoCuenta): ReactElement {
  const d = datos.desglosado;
  const periodo = `${d.desde ?? '—'} a ${d.hasta ?? '—'}`;
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
        h(Text, { style: estilos.subtitulo }, 'Estado de cuenta de maquilero — CONTROL v2'),
      ),
      h(
        View,
        { style: estilos.bloqueDerecha },
        h(Text, { style: estilos.etiqueta }, 'Maquilero'),
        h(Text, { style: estilos.valorFuerte }, d.maquilero),
      ),
    ),
    h(
      View,
      { style: estilos.filaCampos, key: 'campos' },
      campo('Periodo', periodo),
      campo('Facturación', facturaTexto(d.conFactura)),
      campo('Maquilero', d.maquilero),
    ),
    tablaCargos(datos),
    tablaMovimientos('Abonos', d.abonos),
    tablaMovimientos('Descuentos', d.descuentos),
    tablaPagos(datos),
    bloqueSaldo(datos),
    h(
      Text,
      { style: estilos.pie, key: 'pie', fixed: true },
      `CONTROL v2 · ${datos.pagador} · Estado de cuenta de ${d.maquilero} · Saldo ${pesos(d.saldo.saldo)}`,
    ),
  );
}

/** Documento del estado de cuenta. */
function documentoEstadoCuenta(datos: DatosImpresoEstadoCuenta): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Estado de cuenta ${datos.desglosado.maquilero}`,
      author: datos.pagador,
      subject: 'Estado de cuenta de maquilero',
    },
    paginaEstadoCuenta(datos),
  );
}

/** Genera el PDF (Buffer) del estado de cuenta a partir de sus datos resueltos. */
export async function generarPdfEstadoCuenta(datos: DatosImpresoEstadoCuenta): Promise<Buffer> {
  return renderToBuffer(documentoEstadoCuenta(datos));
}

/** Resultado de generar el impreso del estado de cuenta (Buffer + maquilero para el `filename`). */
export interface ImpresoEstadoCuenta {
  buffer: Buffer;
  idMaquilero: number;
}

/** Resuelve los datos (A9) y devuelve el PDF + el id del maquilero para el nombre del archivo. */
export async function impresoEstadoCuenta(
  sesion: SesionUsuario,
  idMaquilero: number,
  query: z.input<typeof esquemaEstadoCuentaQuery> = {},
  bd?: ContextoBd,
  deps: DepsImpresoEstadoCuenta = {},
): Promise<ImpresoEstadoCuenta> {
  const datos = await armarDatosImpresoEstadoCuenta(sesion, idMaquilero, query, bd, deps);
  return { buffer: await generarPdfEstadoCuenta(datos), idMaquilero };
}
