/**
 * Impreso de una AUDITORÍA de calidad (F6-E3, R9; ref. viejo `FormatoAuditorias`/`FormatoAuditoriasDet`,
 * doc `09-Control-de-Calidad.md` §3): la hoja que documenta la inspección de una muestra de una orden.
 * Encabezado (nº de auditoría, orden, modelo, cantidad, muestra, tipo, maquilero, elaboró/auditó,
 * fechas) + detalle de defectos (clave, pág, descripción, nivel AQL, nº de fallas) + el RESULTADO
 * grande (ACEPTADO / RECHAZADO / NO CALIFICADO) con el total de prendas rechazadas y las observaciones.
 *
 * Documento generado EN EL SERVIDOR con `@react-pdf/renderer` (`renderToBuffer`), MISMO motor y patrón
 * que `produccion/impresos/impreso-recibo-maquila.ts` (A1: la ruta solo valida permiso+Zod y delega).
 * Reusa `obtenerAuditoria` (A9: filtra por la empresa activa → 404 si no) y resuelve `pag` de cada
 * defecto y el nombre de usuario de quien elaboró/auditó, que no viajan en la proyección del núcleo.
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

import { renderizarPdfEnWorker } from '../../../comun/pdf-worker.js';
import {
  estilosDoc,
  FUENTE,
  PALETA,
  EncabezadoDocumento,
  PieDocumento,
  TituloSeccion,
  BandaEstado,
} from '../../../comun/impresos-estilos.js';

import {
  ETIQUETAS_TIPO_AUDITORIA,
  type ResultadoAuditoriaClave,
  type TipoAuditoriaClave,
} from '../../../contrato/index.js';
import { nombreDeUsuario, nombresDeUsuarios } from '../../../comun/nombres-usuario.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../../comun/transaccion.js';
import { obtenerAuditoria } from '../auditorias.js';

// ── Datos resueltos del impreso (forma PURA: ya sin BD) ──────────────────────────────────────────

/** Un renglón de defecto del impreso (con `pag` resuelto). */
export interface RenglonImpresoAuditoria {
  clave: string;
  pag: string | null;
  descripcion: string;
  nivelAQL: number;
  numFallas: number;
}

/** Todo lo que necesita el documento de auditoría, ya resuelto (sin BD) → función pura. */
export interface DatosImpresoAuditoria {
  empresa: string;
  numAuditoria: number;
  folioOrden: number | null;
  codigoModelo: string | null;
  cantidadOrden: number;
  tamanoMuestra: number;
  muestraManual: boolean;
  tipoAuditoria: TipoAuditoriaClave;
  maquilero: string | null;
  elaboro: string | null;
  auditor: string | null;
  fechaElaboracion: string;
  fechaAuditoria: string;
  resultado: ResultadoAuditoriaClave;
  observaciones: string | null;
  cancelada: boolean;
  totalFallas: number;
  renglones: RenglonImpresoAuditoria[];
}

/** Dependencias inyectables (los tests inyectan `obtenerAuditoria` fake para no tocar BD). */
export interface DepsImpresoAuditoria {
  obtenerAuditoria?: typeof obtenerAuditoria;
}

/**
 * Resuelve los datos del impreso de una auditoría (A9, vía `obtenerAuditoria`). Consulta aparte la
 * cantidad de la orden, el `pag` de cada defecto y el nombre de quien elaboró/auditó (no viajan en la
 * proyección del núcleo). Acción de impresión → esas lecturas extra son aceptables.
 */
export async function armarDatosImpresoAuditoria(
  sesion: SesionUsuario,
  idAuditoria: number,
  bd?: ContextoBd,
  deps: DepsImpresoAuditoria = {},
): Promise<DatosImpresoAuditoria> {
  const obtener = deps.obtenerAuditoria ?? obtenerAuditoria;
  const auditoria = await obtener(sesion, idAuditoria, bd);
  const cliente = clienteLectura(bd);

  const cantidadAgg = await cliente.ordenLineaTalla.aggregate({
    where: { ordenLinea: { idOrden: auditoria.idOrden } },
    _sum: { cantidad: true },
  });
  const cantidadOrden = cantidadAgg._sum.cantidad ?? 0;

  const idsDefecto = auditoria.defectos.map((d) => d.idDefecto);
  const pags = await cliente.defectoCatalogo.findMany({
    where: { id: { in: idsDefecto } },
    select: { id: true, pag: true },
  });
  const pagPorId = new Map(pags.map((p) => [p.id, p.pag]));

  const nombrePorId = await nombresDeUsuarios(cliente, [
    auditoria.elaboroPorId,
    auditoria.auditorPorId,
  ]);
  const nombreUsuario = (id: string | null): string | null => nombreDeUsuario(nombrePorId, id);

  return {
    empresa: sesion.nombreEmpresaActiva,
    numAuditoria: auditoria.numAuditoria,
    folioOrden: auditoria.folioOrden,
    codigoModelo: auditoria.codigoModelo,
    cantidadOrden,
    tamanoMuestra: auditoria.tamanoMuestra,
    muestraManual: auditoria.muestraManual,
    tipoAuditoria: auditoria.tipoAuditoria,
    maquilero: auditoria.maquilero,
    elaboro: nombreUsuario(auditoria.elaboroPorId),
    auditor: nombreUsuario(auditoria.auditorPorId),
    fechaElaboracion: auditoria.fechaElaboracion,
    fechaAuditoria: auditoria.fechaAuditoria,
    resultado: auditoria.resultado,
    observaciones: auditoria.observaciones,
    cancelada: auditoria.cancelada,
    totalFallas: auditoria.totalFallas,
    renglones: auditoria.defectos.map((d) => ({
      clave: d.clave,
      pag: pagPorId.get(d.idDefecto) ?? null,
      descripcion: d.descripcion,
      nivelAQL: d.nivelAQL,
      numFallas: d.numFallas,
    })),
  };
}

// ── Documento PDF (react-pdf, sin JSX) ──────────────────────────────────────────────────────────

/** Etiqueta grande del resultado + su color (ACEPTADO / RECHAZADO / NO CALIFICADO). */
const RESULTADO_IMPRESO: Record<ResultadoAuditoriaClave, { texto: string; color: string }> = {
  aprobado: { texto: 'ACEPTADO', color: PALETA.ok },
  reprobado: { texto: 'RECHAZADO', color: PALETA.crit },
  no_calificado: { texto: 'NO CALIFICADO', color: PALETA.muted },
};

const estilos = StyleSheet.create({
  // Estilos PROPIOS de la auditoría (lo compartido vive en `estilosDoc`).
  celdaClave: { width: 70 },
  celdaPag: { width: 40, textAlign: 'center' },
  celdaDescripcion: { flexGrow: 1, flexBasis: 0, textAlign: 'left' },
  celdaNivel: { width: 42, textAlign: 'center' },
  celdaFallas: { width: 42, textAlign: 'center', fontFamily: FUENTE.negrita },
  totalEtiqueta: { flexGrow: 1, flexBasis: 0, textAlign: 'right' },
  resultadoBloque: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PALETA.borde,
    borderRadius: 4,
    padding: 10,
  },
  resultadoTexto: { fontSize: 20, fontFamily: FUENTE.negrita },
  rechazadasValor: { fontSize: 16, fontFamily: FUENTE.negrita, textAlign: 'right' },
});

/** Un campo etiqueta/valor del encabezado. */
function campo(etiqueta: string, valor: string | null, ancho = false): ReactElement {
  return h(
    View,
    { style: ancho ? estilosDoc.campoDosTercios : estilosDoc.campoTercio, key: etiqueta },
    h(Text, { style: estilosDoc.etiquetaCampo }, etiqueta),
    h(Text, { style: estilosDoc.valorCampo }, valor ?? '—'),
  );
}

/** Banda roja "AUDITORÍA CANCELADA" (solo si está cancelada). */
function bandaCancelada(datos: DatosImpresoAuditoria): ReactElement | null {
  if (!datos.cancelada) {
    return null;
  }
  return BandaEstado({ titulo: 'AUDITORÍA CANCELADA' });
}

/** Tabla de DETALLE de defectos (clave, pág, descripción, nivel AQL, nº de fallas) + total. */
function tablaDefectos(datos: DatosImpresoAuditoria): ReactElement {
  const filaEncabezado = h(
    View,
    { style: estilosDoc.filaTabla, key: 'enc' },
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaClave] }, 'Clave'),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaPag] }, 'Pág'),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaDescripcion] },
      'Defecto',
    ),
    h(Text, { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaNivel] }, 'AQL'),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaEncabezado, estilos.celdaFallas] },
      'Fallas',
    ),
  );

  const filas = datos.renglones.map((r, i) =>
    h(
      View,
      { style: estilosDoc.filaTabla, key: `fila-${i}` },
      h(Text, { style: [estilosDoc.celda, estilos.celdaClave] }, r.clave),
      h(Text, { style: [estilosDoc.celda, estilos.celdaPag] }, r.pag ?? ''),
      h(Text, { style: [estilosDoc.celda, estilos.celdaDescripcion] }, r.descripcion),
      h(Text, { style: [estilosDoc.celda, estilos.celdaNivel] }, String(r.nivelAQL)),
      h(
        Text,
        { style: [estilosDoc.celda, estilos.celdaFallas] },
        r.numFallas === 0 ? '' : String(r.numFallas),
      ),
    ),
  );

  const filaTotales = h(
    View,
    { style: [estilosDoc.filaTabla, estilosDoc.filaTotal], key: 'tot' },
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.totalEtiqueta] },
      'Total de prendas rechazadas',
    ),
    h(
      Text,
      { style: [estilosDoc.celda, estilosDoc.celdaTotal, estilos.celdaFallas] },
      String(datos.totalFallas),
    ),
  );

  const cuerpo =
    datos.renglones.length === 0
      ? [h(Text, { style: estilosDoc.vacio, key: 'vacio' }, 'Sin defectos capturados.')]
      : [filaEncabezado, ...filas, filaTotales];

  return h(View, { style: estilosDoc.seccion }, TituloSeccion('Defectos encontrados'), ...cuerpo);
}

/** Bloque grande del RESULTADO (ACEPTADO / RECHAZADO / NO CALIFICADO) + prendas rechazadas. */
function bloqueResultado(datos: DatosImpresoAuditoria): ReactElement {
  const r = RESULTADO_IMPRESO[datos.resultado];
  return h(
    View,
    { style: estilos.resultadoBloque },
    h(
      View,
      {},
      h(Text, { style: estilosDoc.etiquetaMenor }, 'Resultado (manual)'),
      h(Text, { style: [estilos.resultadoTexto, { color: r.color }] }, r.texto),
    ),
    h(
      View,
      {},
      h(Text, { style: estilosDoc.etiquetaMenor }, 'Prendas rechazadas'),
      h(Text, { style: estilos.rechazadasValor }, String(datos.totalFallas)),
    ),
  );
}

/** Una página del documento de AUDITORÍA. */
function paginaAuditoria(datos: DatosImpresoAuditoria, clave: string): ReactElement {
  const hijos: (ReactElement | null)[] = [
    EncabezadoDocumento({
      empresa: datos.empresa,
      titulo: 'Auditoría de calidad — CONTROL v2',
      derecha: { etiqueta: 'No. auditoría', valor: String(datos.numAuditoria), grande: true },
    }),
    bandaCancelada(datos),
    h(
      View,
      { style: estilosDoc.filaCampos, key: 'campos' },
      campo('Orden', datos.folioOrden === null ? '—' : String(datos.folioOrden)),
      campo('Modelo', datos.codigoModelo),
      campo('Tipo', ETIQUETAS_TIPO_AUDITORIA[datos.tipoAuditoria]),
      campo('Cantidad de la orden', datos.cantidadOrden.toLocaleString('es-MX')),
      campo(
        'Tamaño de muestra',
        `${String(datos.tamanoMuestra)}${datos.muestraManual ? ' (manual)' : ''}`,
      ),
      campo('Maquilero', datos.maquilero),
      campo('Elaboró', datos.elaboro),
      campo('Auditó', datos.auditor),
      campo('Fecha de elaboración', datos.fechaElaboracion),
      campo('Fecha de auditoría', datos.fechaAuditoria),
    ),
    tablaDefectos(datos),
    bloqueResultado(datos),
    datos.observaciones
      ? h(
          View,
          { style: [estilosDoc.campoCompleto, { marginTop: 10 }], key: 'obs' },
          h(Text, { style: estilosDoc.etiquetaCampo }, 'Observaciones'),
          h(Text, { style: estilosDoc.valorCampoTexto }, datos.observaciones),
        )
      : null,
    PieDocumento({
      contexto: `CONTROL v2 · ${datos.empresa} · Auditoría ${datos.numAuditoria} · ${datos.totalFallas} prendas rechazadas`,
    }),
  ];
  return h(
    Page,
    { key: clave, size: 'A4', style: estilosDoc.pagina },
    ...hijos.filter((x) => x !== null),
  );
}

/** Documento de UNA auditoría de calidad. */
function documentoAuditoria(datos: DatosImpresoAuditoria): ReactElement<DocumentProps> {
  return h(
    Document,
    {
      title: `Auditoría ${datos.numAuditoria}`,
      author: datos.empresa,
      subject: 'Auditoría de calidad',
    },
    paginaAuditoria(datos, 'auditoria'),
  );
}

/** Genera el PDF (Buffer) del documento de auditoría a partir de sus datos resueltos. */
export async function generarPdfAuditoria(datos: DatosImpresoAuditoria): Promise<Buffer> {
  return renderToBuffer(documentoAuditoria(datos));
}

/** Resultado de generar un impreso de auditoría (Buffer + folio para el `filename`). */
export interface ImpresoAuditoria {
  buffer: Buffer;
  folio: number;
}

/** Resuelve los datos de la auditoría (A9) y devuelve su PDF + el folio para el nombre del archivo. */
export async function impresoAuditoria(
  sesion: SesionUsuario,
  idAuditoria: number,
  bd?: ContextoBd,
  deps: DepsImpresoAuditoria = {},
): Promise<ImpresoAuditoria> {
  const datos = await armarDatosImpresoAuditoria(sesion, idAuditoria, bd, deps);
  return {
    buffer: await renderizarPdfEnWorker('auditoria', datos, { idEmpresa: sesion.idEmpresaActiva }),
    folio: datos.numAuditoria,
  };
}
