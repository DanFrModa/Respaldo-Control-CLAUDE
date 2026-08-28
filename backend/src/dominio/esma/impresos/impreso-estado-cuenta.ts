/**
 * Impreso del ESTADO DE CUENTA de un maquilero por periodo (F6-E5, R9; doc 07-EsMa §4, ex
 * `EsMa_EdoDesglosado` + fila "estado de cuenta" de REQUISITOS §R9): el desglosado por orden/modelo/
 * cantidad/precio/importe + los abonos/descuentos/pagos del periodo + el saldo final, y —si las
 * hubo— las PRENDAS INCOMPLETAS que el maquilero entregó (V1-E8k, §Post-F9.136), en su propia
 * sección sin importe: se ven al revisar el pago, pero no suman al saldo.
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
import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';
import { MAX_FILAS_PDF } from '../../../comun/impreso-topes.js';
import {
  estilosDoc,
  FUENTE,
  PALETA,
  EncabezadoDocumento,
  PieDocumento,
  TituloSeccion,
  LeyendaTruncado,
} from '../../../comun/impresos-estilos.js';
import { estadoCuentaDesglosado } from '../estado-cuenta.js';
import type { z } from 'zod';
import type { esquemaEstadoCuentaQuery } from '../../../contrato/index.js';

import { pagadorDeEmpresa } from './impreso-recibo-pago.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Conteos del universo COMPLETO por sección (para el aviso de truncado; el saldo NO depende de esto). */
export interface TotalesDesglosado {
  cargos: number;
  abonos: number;
  descuentos: number;
  pagos: number;
  /** Entregas de prendas incompletas del universo completo (V1-E8k). */
  incompletas: number;
}

/** Todo lo que necesita el documento del estado de cuenta, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoEstadoCuenta {
  /** Pagador: razón social o nombre de la empresa (A9) — nunca hardcodeado. */
  pagador: string;
  /** Desglosado con cada sección YA topada a `MAX_FILAS_PDF` (el saldo sigue siendo del universo). */
  desglosado: DesglosadoSalida;
  /** Conteos completos por sección (para avisar cuando alguna se truncó). */
  totales: TotalesDesglosado;
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

  // Blindaje: cada sección se DIBUJA a lo más `MAX_FILAS_PDF`; el saldo (all-time) NO cambia porque lo
  // calcula el dominio sobre el universo completo.
  const totales: TotalesDesglosado = {
    cargos: desglosado.cargos.length,
    abonos: desglosado.abonos.length,
    descuentos: desglosado.descuentos.length,
    pagos: desglosado.pagos.length,
    incompletas: desglosado.incompletas.filas.length,
  };
  const desglosadoTopado: DesglosadoSalida = {
    ...desglosado,
    cargos: desglosado.cargos.slice(0, MAX_FILAS_PDF),
    abonos: desglosado.abonos.slice(0, MAX_FILAS_PDF),
    descuentos: desglosado.descuentos.slice(0, MAX_FILAS_PDF),
    pagos: desglosado.pagos.slice(0, MAX_FILAS_PDF),
    // Se topan las FILAS pero NO `totalPiezas`: el total dice cuántas incompletas entregó de
    // verdad, igual que el saldo del pie es del universo completo aunque la tabla se corte.
    incompletas: {
      ...desglosado.incompletas,
      filas: desglosado.incompletas.filas.slice(0, MAX_FILAS_PDF),
    },
  };

  return { pagador, desglosado: desglosadoTopado, totales };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

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
  // Anchos de columna y bloque de saldo PROPIOS (lo compartido vive en `estilosDoc`).
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
    borderTopColor: PALETA.marca,
    paddingTop: 8,
  },
  saldoItem: { alignItems: 'flex-end' },
  saldoValor: { fontSize: 12, fontFamily: FUENTE.negrita, color: PALETA.tinta },
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

/** Tabla de CARGOS desglosados (orden/modelo/proceso/cantidad/precio/importe). */
function tablaCargos(datos: DatosImpresoEstadoCuenta): ReactElement {
  const cargos = datos.desglosado.cargos;
  if (cargos.length === 0) {
    return h(
      View,
      { style: estilosDoc.seccion },
      TituloSeccion('Cargos (maquila)'),
      h(Text, { style: estilosDoc.vacio }, 'Sin cargos en el periodo.'),
    );
  }
  const encabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colChica] }, 'Orden'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colFlex] }, 'Modelo'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colMedia] }, 'Proceso'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Cant.'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Precio'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Importe'),
  );
  const filas = cargos.map((c, i) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `c-${i}` },
      h(Text, { style: [estilosDoc.celda, estilos.colChica] }, `#${String(c.folioOrden)}`),
      h(
        Text,
        { style: [estilosDoc.celda, estilos.colFlex] },
        c.descripcionModelo ? `${c.codigoModelo} — ${c.descripcionModelo}` : c.codigoModelo,
      ),
      h(
        Text,
        { style: [estilosDoc.celda, estilos.colMedia] },
        `${c.tipoProceso}${c.sinCosto ? ' (sin costo)' : ''}`,
      ),
      h(
        Text,
        { style: [estilosDoc.celda, estilos.colNum] },
        c.cantidad === null ? '—' : String(c.cantidad),
      ),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pesos(c.precio)),
      h(
        Text,
        { style: [estilosDoc.celda, estilos.colNum] },
        c.sinCosto ? pesos(0) : pesos(c.importe),
      ),
    ),
  );
  return h(
    View,
    { style: estilosDoc.seccion },
    TituloSeccion('Cargos (maquila)'),
    encabezado,
    ...filas,
  );
}

/** Tabla simple de abonos o descuentos (fecha/observaciones/importe). */
function tablaMovimientos(titulo: string, filasDatos: DesglosadoSalida['abonos']): ReactElement {
  if (filasDatos.length === 0) {
    return h(
      View,
      { style: estilosDoc.seccion },
      TituloSeccion(titulo),
      h(Text, { style: estilosDoc.vacio }, 'Sin movimientos en el periodo.'),
    );
  }
  const encabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colMedia] }, 'Fecha'),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colFlex] },
      'Observaciones',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Importe'),
  );
  const filas = filasDatos.map((m, i) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `m-${i}` },
      h(Text, { style: [estilosDoc.celda, estilos.colMedia] }, m.fecha),
      h(Text, { style: [estilosDoc.celda, estilos.colFlex] }, m.observaciones ?? '—'),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pesos(m.monto)),
    ),
  );
  return h(View, { style: estilosDoc.seccion }, TituloSeccion(titulo), encabezado, ...filas);
}

/** Tabla de pagos (fecha/órdenes/importe). */
function tablaPagos(datos: DatosImpresoEstadoCuenta): ReactElement {
  const pagos = datos.desglosado.pagos;
  if (pagos.length === 0) {
    return h(
      View,
      { style: estilosDoc.seccion },
      TituloSeccion('Pagos'),
      h(Text, { style: estilosDoc.vacio }, 'Sin pagos en el periodo.'),
    );
  }
  const encabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colMedia] }, 'Fecha'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colFlex] }, 'Órdenes'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Importe'),
  );
  const filas = pagos.map((p, i) => {
    const folios = [...new Set(p.aplicaciones.map((a) => a.folioOrden))]
      .sort((x, y) => x - y)
      .map((f) => `#${String(f)}`)
      .join(', ');
    return h(
      View,
      { style: estilosDoc.filaTabla, key: `p-${i}` },
      h(Text, { style: [estilosDoc.celda, estilos.colMedia] }, p.fecha),
      h(Text, { style: [estilosDoc.celda, estilos.colFlex] }, folios || `Pago #${String(p.id)}`),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, pesos(p.monto)),
    );
  });
  return h(View, { style: estilosDoc.seccion }, TituloSeccion('Pagos'), encabezado, ...filas);
}

/**
 * Tabla de PRENDAS INCOMPLETAS entregadas (V1-E8k, §Post-F9.136). Va DESPUÉS de los pagos y ANTES
 * del saldo, y no lleva columna de importe a propósito: es la respuesta a *"¿me trajiste las 5 que
 * faltaban?"*, no un renglón de dinero. Si no hubo ninguna, la sección ni se dibuja: en el 99 % de
 * los estados de cuenta sería una línea vacía sin nada que decir.
 */
function tablaIncompletas(datos: DatosImpresoEstadoCuenta): ReactElement | null {
  const bloque = datos.desglosado.incompletas;
  if (bloque.totalPiezas === 0 && bloque.filas.length === 0) {
    return null;
  }
  const encabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colMedia] }, 'Fecha'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colChica] }, 'Orden'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colFlex] }, 'Modelo'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colMedia] }, 'Proceso'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.colNum] }, 'Piezas'),
  );
  const filas = bloque.filas.map((f, i) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `i-${i}` },
      h(Text, { style: [estilosDoc.celda, estilos.colMedia] }, f.fecha),
      h(Text, { style: [estilosDoc.celda, estilos.colChica] }, `#${String(f.folioOrden)}`),
      h(
        Text,
        { style: [estilosDoc.celda, estilos.colFlex] },
        f.descripcionModelo ? `${f.codigoModelo} — ${f.descripcionModelo}` : f.codigoModelo,
      ),
      h(Text, { style: [estilosDoc.celda, estilos.colMedia] }, f.tipoProceso),
      h(Text, { style: [estilosDoc.celda, estilos.colNum] }, String(f.piezas)),
    ),
  );
  const total = h(
    View,
    { style: [estilosDoc.filaTabla, estilosDoc.filaTotal], key: 'tot' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.colMedia] }, 'Total'),
    h(Text, { style: [estilosDoc.celda, estilos.colChica] }, ''),
    h(Text, { style: [estilosDoc.celda, estilos.colFlex] }, ''),
    h(Text, { style: [estilosDoc.celda, estilos.colMedia] }, ''),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.colNum] },
      String(bloque.totalPiezas),
    ),
  );
  return h(
    View,
    { style: estilosDoc.seccion },
    TituloSeccion('Prendas incompletas entregadas'),
    h(
      Text,
      { style: estilosDoc.vacio },
      'Prendas que llegaron sin terminar de coser: se entregaron, pero NO se pagan ni entran a ' +
        'inventario. No suman al saldo de abajo.',
    ),
    encabezado,
    ...filas,
    total,
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
      h(Text, { style: estilosDoc.etiquetaMenor }, 'Cargos'),
      h(Text, { style: estilos.saldoValor }, pesos(s.totalCargos)),
    ),
    h(
      View,
      { style: estilos.saldoItem, key: 'a' },
      h(Text, { style: estilosDoc.etiquetaMenor }, 'Abonos'),
      h(Text, { style: estilos.saldoValor }, pesos(s.totalAbonos)),
    ),
    h(
      View,
      { style: estilos.saldoItem, key: 'p' },
      h(Text, { style: estilosDoc.etiquetaMenor }, 'Pagos'),
      h(Text, { style: estilos.saldoValor }, pesos(s.totalPagos)),
    ),
    h(
      View,
      { style: estilos.saldoItem, key: 'd' },
      h(Text, { style: estilosDoc.etiquetaMenor }, 'Descuentos'),
      h(Text, { style: estilos.saldoValor }, pesos(s.totalDescuentos)),
    ),
    h(
      View,
      { style: estilos.saldoItem, key: 's' },
      h(Text, { style: estilosDoc.etiquetaMenor }, 'Saldo'),
      h(Text, { style: estilos.saldoTotal }, pesos(s.saldo)),
    ),
  );
}

/**
 * Aviso de truncado (o `null`): lista las secciones que se topó a `MAX_FILAS_PDF`. El saldo del pie NO
 * se ve afectado (es del universo completo). Pura, para testearse sin react-pdf.
 */
export function avisoTruncadoTexto(datos: DatosImpresoEstadoCuenta): string | null {
  const d = datos.desglosado;
  const t = datos.totales;
  const partes: string[] = [];
  const revisar = (nombre: string, mostrados: number, total: number): void => {
    if (total > mostrados) {
      partes.push(`${nombre} ${String(mostrados)} de ${String(total)}`);
    }
  };
  revisar('cargos', d.cargos.length, t.cargos);
  revisar('abonos', d.abonos.length, t.abonos);
  revisar('descuentos', d.descuentos.length, t.descuentos);
  revisar('pagos', d.pagos.length, t.pagos);
  revisar('prendas incompletas', d.incompletas.filas.length, t.incompletas);
  if (partes.length === 0) {
    return null;
  }
  return `Detalle truncado (${partes.join('; ')}) — usa el export a Excel para el detalle completo.`;
}

/** Una página del estado de cuenta. */
function paginaEstadoCuenta(datos: DatosImpresoEstadoCuenta): ReactElement {
  const d = datos.desglosado;
  const periodo = `${d.desde ?? '—'} a ${d.hasta ?? '—'}`;
  return h(
    Page,
    { size: 'A4', style: estilosDoc.pagina },
    EncabezadoDocumento({
      empresa: datos.pagador,
      titulo: 'Estado de cuenta de maquilero — CONTROL v2',
      derecha: { etiqueta: 'Maquilero', valor: d.maquilero },
    }),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Periodo', periodo),
      campo('Facturación', facturaTexto(d.conFactura)),
      campo('Maquilero', d.maquilero),
    ),
    tablaCargos(datos),
    tablaMovimientos('Abonos', d.abonos),
    tablaMovimientos('Descuentos', d.descuentos),
    tablaPagos(datos),
    // Sección opcional: se omite del árbol (no se dibuja vacía) cuando no hubo incompletas.
    ...(() => {
      const tabla = tablaIncompletas(datos);
      return tabla === null ? [] : [tabla];
    })(),
    ...(() => {
      const texto = avisoTruncadoTexto(datos);
      return texto === null ? [] : [LeyendaTruncado(texto)];
    })(),
    bloqueSaldo(datos),
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.pagador} · Estado de cuenta de ${d.maquilero} · Saldo ${pesos(d.saldo.saldo)}`,
    }),
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
  return {
    buffer: await renderizarPdfEnWorker('esma-estado-cuenta', datos, {
      idEmpresa: sesion.idEmpresaActiva,
    }),
    idMaquilero,
  };
}
