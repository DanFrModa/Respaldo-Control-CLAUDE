/**
 * Detección DETERMINISTA de los PARES DE TRASPASO de tela del sistema viejo (F4-E6, Pieza B).
 *
 * El viejo NO tenía un tipo "traspaso": un traspaso entre almacenes se grababa como DOS documentos
 * creados en la MISMA transacción (VBA `ITelas_TransferAlmSub`):
 *   • una `Entradas` con `Factura='Transferencia'` (la pata que ENTRA al almacén destino), y
 *   • una `Salidas` SIN `IdOrdenes` (la pata que SALE del almacén origen),
 * con la MISMA `Fecha` e `IdTela` y las MISMAS cantidades por color (`TelaEnt#`==`TelaSal#`). El
 * almacén de cada pata viene de su `IdTelasColAlm → IdAlmacenes` (no del texto `Referencia`, que solo
 * guarda el nombre del otro almacén como etiqueta).
 *
 * Emparejar bien importa para NO migrar un traspaso como una recepción + una salida sueltas (eso
 * inflaría las entradas y descuadraría el inventario entre almacenes). La clave de emparejado es la
 * FIRMA de detalle: `(fecha, idTela, [(idTelasColores, cant1, cant2)] ordenado])` — IGNORA el
 * almacén (origen y destino difieren a propósito) y ordena los renglones para ser estable. Dentro de
 * un mismo grupo de firma con N entradas y N salidas, se parean por ORDEN (entrada i-ésima ↔ salida
 * i-ésima, cada lado ordenado por su id viejo): es determinista y reproducible.
 *
 * Grupos donde #entradas ≠ #salidas (o firmas de entrada sin salida / al revés) quedan SIN parear y
 * se DEVUELVEN aparte para que el loader los REPORTE (§7: nada se infiere a la fuerza). Esta función
 * es PURA (no toca BD ni CSV): recibe las filas ya leídas y devuelve los pares + los sobrantes.
 */

/** Renglón de detalle ya normalizado (de EntradasDet o SalidasDet) para construir la firma. */
export interface RenglonDetalleTela {
  /** `IdTelasColAlm` del renglón (resuelve color + almacén). */
  idTelasColAlm: string;
  /** `IdTelasColores` (color) al que pertenece el `IdTelasColAlm` — parte de la firma. */
  idTelasColores: string;
  /** Almacén del renglón (`IdTelasColAlm → IdAlmacenes`) — NO entra en la firma. */
  idAlmacen: string;
  /** Cantidad del primer componente (`TelaEnt1`/`TelaSal1`) como texto crudo del viejo. */
  cant1: string;
  /** Cantidad del segundo componente (`TelaEnt2`/`TelaSal2`) como texto crudo del viejo. */
  cant2: string;
}

/** Un documento (entrada o salida) con su cabecera y sus renglones de detalle. */
export interface DocumentoTela {
  /** Id viejo del documento (`IdEntradas` o `IdSalidas`). */
  id: string;
  /** `Fecha` cruda del viejo (parte de la firma). */
  fecha: string;
  /** `IdTela` de la cabecera (parte de la firma). */
  idTela: string;
  /** Renglones de detalle del documento. */
  renglones: RenglonDetalleTela[];
}

/** Un par de traspaso emparejado (entrada destino + salida origen). */
export interface ParTraspasoTela {
  /** La pata de ENTRADA (`Entradas` con `Factura='Transferencia'`). */
  entrada: DocumentoTela;
  /** La pata de SALIDA (`Salidas` sin `IdOrdenes`). */
  salida: DocumentoTela;
}

/** Resultado del emparejado: pares limpios + entradas/salidas que no se pudieron parear. */
export interface ResultadoPares {
  pares: ParTraspasoTela[];
  /** Entradas 'Transferencia' que no encontraron salida gemela (se reportan). */
  entradasSinPar: DocumentoTela[];
  /** Salidas que se consumieron como pata de un par (para que el loader NO las migre como salida). */
  idsSalidaUsados: Set<string>;
}

/** Firma de detalle de un documento (estable): fecha + tela + renglones (color+cant1+cant2) ordenados. */
export function firmaDocumento(doc: DocumentoTela): string {
  const renglones = doc.renglones
    .map((r) => `${r.idTelasColores}|${r.cant1}|${r.cant2}`)
    .sort()
    .join(';');
  return `${doc.fecha}#${doc.idTela}#${renglones}`;
}

/**
 * Empareja las `entradasTransferencia` con las `salidasSinOrden` por firma de detalle + orden.
 * DETERMINISTA: dentro de cada grupo de firma con igual número de entradas y salidas, parea la
 * i-ésima entrada (ordenada por id numérico) con la i-ésima salida. Los grupos con cardinalidades
 * distintas (o firmas presentes solo de un lado) quedan sin parear.
 */
export function emparejarTraspasos(
  entradasTransferencia: DocumentoTela[],
  salidasSinOrden: DocumentoTela[],
): ResultadoPares {
  const salidasPorFirma = new Map<string, DocumentoTela[]>();
  for (const s of salidasSinOrden) {
    const f = firmaDocumento(s);
    const lista = salidasPorFirma.get(f) ?? [];
    lista.push(s);
    salidasPorFirma.set(f, lista);
  }

  const entradasPorFirma = new Map<string, DocumentoTela[]>();
  for (const e of entradasTransferencia) {
    const f = firmaDocumento(e);
    const lista = entradasPorFirma.get(f) ?? [];
    lista.push(e);
    entradasPorFirma.set(f, lista);
  }

  const ordenarPorId = (a: DocumentoTela, b: DocumentoTela): number =>
    Number(a.id) - Number(b.id) || a.id.localeCompare(b.id);

  const pares: ParTraspasoTela[] = [];
  const entradasSinPar: DocumentoTela[] = [];
  const idsSalidaUsados = new Set<string>();

  for (const [firma, entradas] of entradasPorFirma) {
    const salidas = salidasPorFirma.get(firma) ?? [];
    if (salidas.length === entradas.length && salidas.length > 0) {
      const es = [...entradas].sort(ordenarPorId);
      const ss = [...salidas].sort(ordenarPorId);
      for (let i = 0; i < es.length; i += 1) {
        const entrada = es[i];
        const salida = ss[i];
        if (entrada === undefined || salida === undefined) continue;
        pares.push({ entrada, salida });
        idsSalidaUsados.add(salida.id);
      }
    } else {
      // Cardinalidad distinta o sin contraparte: ninguna entrada de esta firma se parea.
      for (const e of entradas) entradasSinPar.push(e);
    }
  }

  return { pares, entradasSinPar, idsSalidaUsados };
}
