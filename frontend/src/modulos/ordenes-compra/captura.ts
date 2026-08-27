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
  /**
   * ⭐⭐ V1-E3u (§Post-F9.89) — COLOR de la tela que se pide. **No se edita aquí** (se dice en la
   * explosión, en la receta de la orden): este editor lo TRANSPORTA. Y transportarlo no es un
   * detalle: la edición de una OC borra y recrea sus líneas, así que un renglón que llegara sin
   * color lo perdería en silencio — y con él, lo que la recepción cruza y lo que el proveedor lee
   * en el impreso.
   */
  idTelaColor: number | null;
  /** Nombre del color (sólo para verlo mientras se edita; no se manda). */
  telaColor: string | null;
  /**
   * ⭐⭐ V1-E8c (§Post-F9.126) — COLOR DE PRENDA con el que se pidió el AVÍO, y su DESGLOSE POR
   * MEDIDA. **Mismo argumento que el color de la tela: se TRANSPORTAN.** La edición de una OC borra
   * y recrea sus líneas, así que un renglón que llegara sin ellos perdería en silencio el color que
   * el proveedor lee y la tablita de medidas con la que corta los cierres.
   */
  idColorPrenda: number | null;
  /** El TEXTO del color del avío (editable en la previa; aquí se conserva tal cual). */
  colorAvio: string | null;
  /** El desglose por medida del renglón (Σ = cantidad). Se conserva tal cual. */
  medidas: { idAvioMedida: number | null; etiqueta: string; cantidad: number; orden: number }[];
  /**
   * ⭐ V1-E3u (§Post-F9.89(a)) — lo que el sistema propuso para esta línea. Mismo argumento que el
   * color: se TRANSPORTA para que corregir un precio no borre el aviso de desvío que ve quien
   * autoriza. `null` = la línea se capturó a mano y no hay contra qué medirla.
   */
  cantidadSugerida: number | null;
  /** Descripción libre (tipo = libre). */
  descripcionLibre: string;
  /** Cantidad como texto (vacío = 0). Si hay matriz, debe ser Σ de la matriz. */
  cantidad: string;
  /**
   * Unidad/presentación de compra. En renglones de TELA NO se captura: la manda la tela
   * (§Post-F9.18); el editor la muestra en solo lectura y el servidor la vuelve a fijar.
   */
  unidad: string;
  /** Precio unitario como texto (vacío = 0). En tela con complemento, del CUERPO. */
  precio: string;
  /**
   * Cantidad del COMPLEMENTO (Cardigan) como texto. Solo aplica a telas que definen complemento
   * (§Post-F9.18: *"la tela se debe de comprar con su complemento en caso de tenerlo"*); en
   * cualquier otro renglón queda vacía y NO se manda.
   */
  cantidadComplemento: string;
  /** Precio unitario del complemento como texto. Vacío = al mismo precio que el cuerpo. */
  precioComplemento: string;
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
    idTelaColor: null,
    telaColor: null,
    idColorPrenda: null,
    colorAvio: null,
    medidas: [],
    cantidadSugerida: null,
    descripcionLibre: '',
    cantidad: '',
    unidad: '',
    precio: '',
    cantidadComplemento: '',
    precioComplemento: '',
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

/**
 * Importe derivado de un renglón en captura (cantidad × precio, MÁS el complemento si lo lleva).
 * Solo UX: el backend deriva el real de la misma manera.
 */
export function importeRenglon(renglon: RenglonOcCaptura): number {
  const cantidad = renglon.usaMatriz
    ? totalMatrizRenglon(renglon.matriz)
    : aNumero(renglon.cantidad);
  const precio = aNumero(renglon.precio);
  const cantidadComplemento = aNumero(renglon.cantidadComplemento);
  // Sin precio propio, el complemento se cobra al precio del cuerpo (igual que en el servidor).
  const precioComplemento =
    renglon.precioComplemento.trim() === '' ? precio : aNumero(renglon.precioComplemento);
  return cantidad * precio + cantidadComplemento * precioComplemento;
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

/**
 * ⭐⭐ V1-E8c (§Post-F9.126) — ¿el desglose por medida sigue cuadrando con la cantidad del renglón?
 * Es la MISMA invariante que el servidor exige (Σ medidas = cantidad, a 2 decimales). Se comprueba
 * aquí para poder **soltar** el desglose cuando alguien edita la cantidad a mano, en vez de mandar
 * uno que ya no describe lo que se pide y comerse un rechazo de la OC entera.
 */
function desgloseCuadra(medidas: readonly { cantidad: number }[], cantidad: number): boolean {
  if (medidas.length === 0) return false;
  const suma = Math.round(medidas.reduce((s, m) => s + m.cantidad, 0) * 100) / 100;
  return suma === Math.round(cantidad * 100) / 100;
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
    // ⭐⭐ V1-E3u: el color viaja de vuelta tal cual llegó (el editor no lo cambia, lo conserva).
    idTelaColor: renglon.tipo === 'tela' ? renglon.idTelaColor : null,
    // ⭐⭐ V1-E8c: el color del AVÍO y su desglose por medida viajan de vuelta tal cual llegaron.
    // 🔴 Si la cantidad del renglón se editó a mano, el desglose YA NO cuadra con ella y el
    // servidor rechazaría la OC entera; en ese caso se manda vacío (se pierde la tablita, que es
    // informativa) en vez de mandar un desglose que MIENTE sobre la cantidad. Se vuelve a tener al
    // regenerar la compra desde la explosión.
    idColorPrenda: renglon.tipo === 'avio' ? renglon.idColorPrenda : null,
    colorAvio: renglon.tipo === 'avio' ? renglon.colorAvio : null,
    ...(renglon.tipo === 'avio' && desgloseCuadra(renglon.medidas, cantidad)
      ? { medidas: renglon.medidas }
      : {}),
    cantidadSugerida: renglon.cantidadSugerida,
    descripcionLibre: renglon.tipo === 'libre' ? renglon.descripcionLibre.trim() || null : null,
    unidad: renglon.unidad.trim() || null,
    // El complemento viaja SOLO en renglones de tela (§Post-F9.18); el dominio rechaza lo demás.
    ...(renglon.tipo === 'tela' && renglon.cantidadComplemento.trim() !== ''
      ? {
          cantidadComplemento: aNumero(renglon.cantidadComplemento),
          ...(renglon.precioComplemento.trim() === ''
            ? {}
            : { precioComplemento: aNumero(renglon.precioComplemento) }),
        }
      : {}),
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
      idTelaColor: linea.idTelaColor,
      telaColor: linea.telaColor,
      idColorPrenda: linea.idColorPrenda,
      colorAvio: linea.colorAvio,
      medidas: linea.medidas.map((m) => ({ ...m })),
      cantidadSugerida: linea.cantidadSugerida,
      descripcionLibre: linea.descripcionLibre ?? '',
      cantidad: String(linea.cantidad),
      unidad: linea.unidad ?? '',
      precio: String(linea.precio),
      cantidadComplemento:
        linea.cantidadComplemento === null ? '' : String(linea.cantidadComplemento),
      precioComplemento: linea.precioComplemento === null ? '' : String(linea.precioComplemento),
      idOrden: linea.idOrden,
      usaMatriz: matriz.length > 0,
      matriz,
    };
  });
}
