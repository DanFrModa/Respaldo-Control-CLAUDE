/**
 * Impreso del ESTADO DE CUENTA de un CLIENTE (CxC, F9-E4, R9; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §3.1). La línea de tiempo de movimientos del
 * cliente con su saldo derivado — el "por cobrar" en papel. Documento generado EN EL SERVIDOR con
 * `@react-pdf/renderer` (`renderToBuffer`): función pura `armarDatos…` + componente + render. Reusa
 * {@link estadoCuentaClienteCxc} (A1: la ruta solo valida permiso + Zod y delega; A9 + `cxc.ver` +
 * ocultamiento de importes + la vista fiscal ya los aplica el servicio). Espejo del impreso de CxP,
 * sin bloque de maquila (los clientes no maquilan).
 *
 * ACREEDOR/EMPRESA = la razón social de la EMPRESA activa (A9), nunca hardcodeado.
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
import { renderizarPdfEnWorker } from '../../../../comun/pdf-worker.js';
import {
  estilosDoc,
  FUENTE,
  PALETA,
  EncabezadoDocumento,
  PieDocumento,
  TituloSeccion,
  LeyendaTruncado,
} from '../../../../comun/impresos-estilos.js';
import { leyendaTruncado } from '../../../../comun/impreso-topes.js';
import { estadoCuentaClienteCxc } from '../cxc.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Todo lo que necesita el documento del estado de cuenta de CxC, ya resuelto (sin BD). */
export interface DatosImpresoCxc {
  /** Acreedor: razón social o nombre de la empresa (A9) — nunca hardcodeado. */
  acreedor: string;
  cuenta: EstadoCuentaTerceroSalida;
}

/** Dependencias inyectables (los tests inyectan `estadoCuentaClienteCxc` fake para no tocar BD). */
export interface DepsImpresoCxc {
  estadoCuentaClienteCxc?: typeof estadoCuentaClienteCxc;
}

/**
 * Resuelve los datos del estado de cuenta del cliente (A9). Para el impreso trae hasta 100 movimientos
 * (la página máxima del motor) respetando el periodo/vista solicitados.
 */
export async function armarDatosImpresoCxc(
  sesion: SesionUsuario,
  idCliente: number,
  query: Parameters<typeof estadoCuentaClienteCxc>[2] = {},
  bd?: ContextoBd,
  deps: DepsImpresoCxc = {},
): Promise<DatosImpresoCxc> {
  const obtener = deps.estadoCuentaClienteCxc ?? estadoCuentaClienteCxc;
  const cuenta = await obtener(sesion, idCliente, { ...query, pagina: 1, porPagina: 100 }, bd);

  const cliente = clienteLectura(bd);
  const empresa = await cliente.empresa.findUnique({
    where: { id: sesion.idEmpresaActiva },
    select: { razonSocial: true, nombre: true },
  });
  const acreedor = empresa?.razonSocial ?? empresa?.nombre ?? sesion.nombreEmpresaActiva;

  return { acreedor, cuenta };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

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
  // Estilos PROPIOS del estado de cuenta (lo compartido vive en `estilosDoc`).
  colFecha: { width: 60 },
  colConcepto: { width: 96 },
  colFlex: { flexGrow: 1, flexBasis: 0 },
  colMarca: { width: 40, textAlign: 'center' },
  colNum: { width: 70, textAlign: 'right' },
  cancelado: { color: PALETA.faint, textDecoration: 'line-through' },
  saldoBloque: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 24,
    borderTopWidth: 1,
    borderTopColor: PALETA.marca,
    paddingTop: 8,
  },
  saldoItem: { alignItems: 'flex-end' },
  saldoValor: { fontSize: 12, fontFamily: FUENTE.negrita },
  saldoTotal: { fontSize: 15, fontFamily: FUENTE.negrita, color: PALETA.marca },
});

/** Un campo etiqueta/valor del encabezado. */
function campo(etiqueta: string, valor: string): ReactElement {
  return h(
    View,
    { style: estilosDoc.campoTercio, key: etiqueta },
    h(Text, { style: estilosDoc.etiquetaCampo }, etiqueta),
    h(Text, { style: estilosDoc.valorFuerte }, valor),
  );
}

/** Tabla de movimientos (fecha/concepto/observaciones/vence/fiscal/importe). */
function tablaMovimientos(datos: DatosImpresoCxc): ReactElement {
  const movs = datos.cuenta.movimientos;
  if (movs.length === 0) {
    return h(
      View,
      { style: estilosDoc.seccion },
      TituloSeccion('Movimientos'),
      h(Text, { style: estilosDoc.vacio }, 'Sin movimientos en el periodo.'),
    );
  }
  const encabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colFecha] }, 'Fecha'),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colConcepto] },
      'Concepto',
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colFlex] },
      'Observaciones',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colFecha] }, 'Vence'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colMarca] }, 'Fiscal'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Importe'),
  );
  const filas = movs.map((m, i) => {
    const estiloCelda = m.cancelado ? [estilosDoc.celda, estilos.cancelado] : [estilosDoc.celda];
    return h(
      View,
      { style: estilosDoc.filaTabla, key: `m-${i}` },
      h(Text, { style: [...estiloCelda, estilos.colFecha] }, m.fecha),
      h(Text, { style: [...estiloCelda, estilos.colConcepto] }, origenTexto(m.origen)),
      h(Text, { style: [...estiloCelda, estilos.colFlex] }, m.observaciones ?? '—'),
      h(Text, { style: [...estiloCelda, estilos.colFecha] }, m.fechaVencimiento ?? '—'),
      h(Text, { style: [...estiloCelda, estilos.colMarca] }, m.esFiscal ? 'Sí' : '—'),
      h(Text, { style: [...estiloCelda, estilos.colNum] }, pesos(m.monto)),
    );
  });
  return h(View, { style: estilosDoc.seccion }, TituloSeccion('Movimientos'), encabezado, ...filas);
}

/** Bloque final con el saldo derivado (operativo + fiscal). */
function bloqueSaldo(datos: DatosImpresoCxc): ReactElement {
  const s = datos.cuenta.saldo;
  const items: ReactElement[] = [
    h(
      View,
      { style: estilos.saldoItem, key: 'f' },
      h(Text, { style: estilosDoc.etiquetaMenor }, 'Saldo fiscal'),
      h(Text, { style: estilos.saldoValor }, pesos(s.saldoFiscal)),
    ),
    h(
      View,
      { style: estilos.saldoItem, key: 's' },
      h(Text, { style: estilosDoc.etiquetaMenor }, 'Saldo por cobrar'),
      h(Text, { style: estilos.saldoTotal }, pesos(s.saldo)),
    ),
  ];
  return h(View, { style: estilos.saldoBloque }, ...items);
}

/** Una página del estado de cuenta de CxC. */
function paginaCxc(datos: DatosImpresoCxc): ReactElement {
  const c = datos.cuenta;
  const periodo = `${c.desde ?? '—'} a ${c.hasta ?? '—'}`;
  const vista = c.vista === 'fiscal' ? 'Fiscal (solo CFDI)' : 'Operativa (todo)';
  const textoTruncado = leyendaTruncado(c.movimientos.length, c.total);
  const aviso = textoTruncado === null ? [] : [LeyendaTruncado(textoTruncado)];
  return h(
    Page,
    { size: 'A4', style: estilosDoc.pagina },
    EncabezadoDocumento({
      empresa: datos.acreedor,
      titulo: 'Estado de cuenta de cliente (CxC) — CONTROL v2',
      derecha: { etiqueta: 'Cliente', valor: c.tercero },
    }),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Periodo', periodo),
      campo('Vista', vista),
      campo('Cliente', c.tercero),
    ),
    tablaMovimientos(datos),
    ...aviso,
    bloqueSaldo(datos),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.acreedor} · Estado de cuenta de ${c.tercero} · Saldo ${pesos(c.saldo.saldo)}`,
    }),
  );
}

/** Documento del estado de cuenta de CxC. */
function documentoCxc(datos: DatosImpresoCxc): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Estado de cuenta ${datos.cuenta.tercero}`,
      author: datos.acreedor,
      subject: 'Estado de cuenta de cliente (CxC)',
    },
    paginaCxc(datos),
  );
}

/** Genera el PDF (Buffer) del estado de cuenta de CxC a partir de sus datos resueltos. */
export async function generarPdfCxc(datos: DatosImpresoCxc): Promise<Buffer> {
  return renderToBuffer(documentoCxc(datos));
}

/** Resultado de generar el impreso (Buffer + id del cliente para el `filename`). */
export interface ImpresoCxc {
  buffer: Buffer;
  idCliente: number;
}

/** Resuelve los datos (A9) y devuelve el PDF + el id del cliente para el nombre del archivo. */
export async function impresoEstadoCuentaCxc(
  sesion: SesionUsuario,
  idCliente: number,
  query: Parameters<typeof estadoCuentaClienteCxc>[2] = {},
  bd?: ContextoBd,
  deps: DepsImpresoCxc = {},
): Promise<ImpresoCxc> {
  const datos = await armarDatosImpresoCxc(sesion, idCliente, query, bd, deps);
  return {
    buffer: await renderizarPdfEnWorker('cxc-estado-cuenta', datos, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
    idCliente,
  };
}
