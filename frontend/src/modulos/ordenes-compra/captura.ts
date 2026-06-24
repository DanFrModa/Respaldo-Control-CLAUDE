import type { MatrizLinea } from '@/componentes/matriz-color-talla/MatrizColorTalla';
import type { OrdenCompra, OrdenCompraLineaEntrada } from '@/api/tipos';

/**
 * Modelo de CAPTURA de los renglones de una OC (F4-E2, decisión c). El formulario edita renglones
 * con campos como TEXTO (precio/cantidad/unidad), un tipo de material (tela / avío / libre) y una
 * matriz talla×color OPCIONAL por renglón. Estos helpers convierten entre el modelo de captura y el
 * cuerpo del API; la validación REAL (XOR material, Σ matriz = cantidad, etc.) la hace el backend
 * (A1) — aquí solo se cuida la UX.
 */

/** Tipo de material de un renglón en captura. */
export type TipoMaterialOc = 'tela' | 'avio' | 'libre';

/** Un renglón en CAPTURA (campos numéricos como texto; matriz opcional con filas=color). */
export interface RenglonOcCaptura {
  /** Clave estable de fila para React (no se envía). */
  clave: string;
  tipo: TipoMaterialOc;
  /** Tela elegida (tipo = tela), o null. */
  idTela: number | null;
  /** Avío elegido (tipo = avio), o null. */
  idAvio: number | null;
  /** AvioProveedor del precio R1 (traza; solo en líneas de avío), o null. */
  idAvioProveedor: number | null;
  /** Descripción libre (tipo = libre). */
  descripcionLibre: string;
  /** Cantidad como texto (vacío = 0). Si hay matriz, debe ser Σ de la matriz. */
  cantidad: string;
  /** Unidad/presentación de compra (texto libre). */
  unidad: string;
  /** Precio unitario como texto (vacío = 0). */
  precio: string;
  /** Orden de producción ligada (R7), o null. */
  idOrden: number | null;
  /** ¿El renglón captura matriz talla×color? (decisión c). */
  usaMatriz: boolean;
  /** Filas (color) de la matriz del renglón. */
  matriz: MatrizLinea[];
}

let contador = 0;
/** Genera una clave de fila estable y única para un renglón nuevo. */
export function nuevaClaveRenglon(): string {
  contador += 1;
  return `r-${String(contador)}-${String(Date.now())}`;
}

/** Un renglón de captura vacío (tela por defecto, sin matriz). */
export function renglonVacio(): RenglonOcCaptura {
  return {
    clave: nuevaClaveRenglon(),
    tipo: 'tela',
    idTela: null,
    idAvio: null,
    idAvioProveedor: null,
    descripcionLibre: '',
    cantidad: '',
    unidad: '',
    precio: '',
    idOrden: null,
    usaMatriz: false,
    matriz: [],
  };
}

/** Normaliza un texto a número ≥ 0 (vacío/invalido = 0). */
export function aNumero(texto: string): number {
  const limpio = texto.trim();
  if (limpio === '') {
    return 0;
  }
  const valor = Number(limpio);
  return Number.isFinite(valor) && valor >= 0 ? valor : 0;
}

/** Suma todas las celdas de la matriz de un renglón (todas las filas/tallas). */
export function totalMatrizRenglon(matriz: readonly MatrizLinea[]): number {
  return matriz.reduce(
    (suma, fila) => suma + Object.values(fila.cantidades).reduce((s, c) => s + c, 0),
    0,
  );
}

/** Importe derivado de un renglón en captura (cantidad efectiva × precio). Solo UX. */
export function importeRenglon(renglon: RenglonOcCaptura): number {
  const cantidad = renglon.usaMatriz
    ? totalMatrizRenglon(renglon.matriz)
    : aNumero(renglon.cantidad);
  return cantidad * aNumero(renglon.precio);
}

/** Total derivado de toda la OC en captura (Σ importes). Solo UX; el backend deriva el real. */
export function totalCaptura(renglones: readonly RenglonOcCaptura[]): number {
  return renglones.reduce((suma, r) => suma + importeRenglon(r), 0);
}

/** Convierte la matriz de captura de un renglón a las celdas talla×color del API (sin ceros). */
function matrizApi(
  matriz: readonly MatrizLinea[],
): { idColor: number; idTalla: number; cantidad: number }[] {
  const celdas: { idColor: number; idTalla: number; cantidad: number }[] = [];
  for (const fila of matriz) {
    for (const [idTalla, cantidad] of Object.entries(fila.cantidades)) {
      if (cantidad > 0) {
        celdas.push({ idColor: fila.idColor, idTalla: Number(idTalla), cantidad });
      }
    }
  }
  return celdas;
}

/** Convierte un renglón de captura al cuerpo del API (cantidad = Σ matriz si usa matriz). */
export function renglonApi(renglon: RenglonOcCaptura): OrdenCompraLineaEntrada {
  const tallas = renglon.usaMatriz ? matrizApi(renglon.matriz) : [];
  const cantidad = renglon.usaMatriz
    ? totalMatrizRenglon(renglon.matriz)
    : aNumero(renglon.cantidad);
  const base: OrdenCompraLineaEntrada = {
    cantidad,
    precio: aNumero(renglon.precio),
    idTela: renglon.tipo === 'tela' ? renglon.idTela : null,
    idAvio: renglon.tipo === 'avio' ? renglon.idAvio : null,
    idAvioProveedor: renglon.tipo === 'avio' ? renglon.idAvioProveedor : null,
    descripcionLibre: renglon.tipo === 'libre' ? renglon.descripcionLibre.trim() || null : null,
    unidad: renglon.unidad.trim() || null,
    idOrden: renglon.idOrden,
    ...(tallas.length > 0 ? { tallas } : {}),
  };
  return base;
}

/** Reconstruye los renglones de captura desde una OC existente (para editar). */
export function capturaDesdeOc(oc: OrdenCompra): RenglonOcCaptura[] {
  return oc.lineas.map((linea) => {
    const tipo: TipoMaterialOc =
      linea.idTela !== null ? 'tela' : linea.idAvio !== null ? 'avio' : 'libre';
    // Agrupa la matriz por color (fila) -> { [idTalla]: cantidad }.
    const porColor = new Map<number, MatrizLinea>();
    for (const celda of linea.tallas) {
      const fila = porColor.get(celda.idColor) ?? {
        idColor: celda.idColor,
        color: celda.color,
        cantidades: {},
      };
      fila.cantidades[celda.idTalla] = celda.cantidad;
      porColor.set(celda.idColor, fila);
    }
    const matriz = [...porColor.values()];
    return {
      clave: nuevaClaveRenglon(),
      tipo,
      idTela: linea.idTela,
      idAvio: linea.idAvio,
      idAvioProveedor: linea.idAvioProveedor,
      descripcionLibre: linea.descripcionLibre ?? '',
      cantidad: String(linea.cantidad),
      unidad: linea.unidad ?? '',
      precio: String(linea.precio),
      idOrden: linea.idOrden,
      usaMatriz: matriz.length > 0,
      matriz,
    };
  });
}
