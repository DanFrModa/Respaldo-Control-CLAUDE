/**
 * Generación de códigos de barra de un modelo (F1-E5) — Módulo 2.
 *
 * Réplica EXACTA del formulario viejo `Codigo` (VBA `HacerCodigo`/`HacerDun`,
 * `Respaldo CLAUDE/Respaldo CLAUDEFormularios/Codigo.txt`), pero CORRIGIENDO su bug
 * de prefijos: el viejo HARDCODEABA el prefijo UPC por empresa
 * (`7500021`/`7509564`/`7500092`/`7500119`) pese a que la tabla `Empresas` ya tenía
 * `UPCEmp`. En v2 el prefijo SIEMPRE sale de `Empresa.upc` (capturable en
 * Administración → Empresas, E1). Así el código generado coincide dígito a dígito con
 * la etiqueta física real del negocio (FR Moda usa el prefijo `7500092`).
 *
 * Algoritmo (idéntico al VBA + estándar GS1, verificado en los tests):
 *  • **EAN-13**: se concatena `prefijo` (UPC de la empresa) + `codigo` del modelo y se
 *    exige que el resultado tenga EXACTAMENTE 12 dígitos (el viejo abortaba con
 *    "Debes meter 12 dígitos" si `Len(Texto1) <> 12`). El dígito verificador es el
 *    módulo 10 estándar: sumando, de IZQUIERDA a derecha, los dígitos en posición impar
 *    (1.ª, 3.ª…) por 1 y los de posición par por 3; `resto = suma mod 10`; el verificador
 *    es `0` si `resto = 0`, si no `10 - resto`. Resultado: 13 dígitos.
 *  • **DUN-14** (caja): dígito indicador `1` + los mismos 12 dígitos base + su verificador.
 *    El viejo lo calcula como `(Total + 3) mod 10` (el `+3` es el peso del indicador `1`,
 *    que en el GTIN-14 cae en posición impar-desde-la-derecha → peso 3): coincide con el
 *    verificador ITF-14 estándar.
 *
 * Funciones PURAS (A1): NO tocan la base de datos. El endpoint
 * `GET /api/modelos/:id/codigos-barra` (rutas) resuelve el prefijo desde la empresa
 * activa de la sesión y el `codigo` desde el modelo, y luego invoca estas funciones.
 * Doc funcional: `Documentacion_MJD/00-Arranque-Login-y-Menu.md` (menú 1, form `Codigo`)
 * y `Documentacion_MJD/01-Modelos.md`.
 */

/**
 * Error de DOMINIO al generar un código de barra: la combinación prefijo+modelo no da
 * los 12 dígitos requeridos, o la empresa no tiene prefijo UPC capturado. Mensaje en
 * español, listo para mostrarse al usuario (lo traduce el error handler global a 4xx).
 *
 * No extiende la jerarquía `ErrorDominio` de `comun/errores.ts` a propósito: este módulo
 * es PURO (sin dependencias de infraestructura). Las rutas/servicios que lo consumen
 * vuelven a lanzar un `ErrorValidacion` de dominio con el mismo mensaje (ver
 * `generarCodigosBarraModelo` en `bom-modelo`/rutas), para que el contrato de errores
 * (código estable → HTTP) se mantenga uniforme.
 */
export class ErrorCodigoBarra extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorCodigoBarra';
  }
}

/** Longitud obligatoria de la base del EAN-13 ANTES del dígito verificador (GS1). */
export const LARGO_BASE_EAN13 = 12;

/** Dígito indicador de caja del DUN-14 (réplica del viejo, que fija `"1"`). */
export const INDICADOR_DUN14 = '1';

/** Resultado del cálculo: los dos códigos legibles, con su base y verificadores. */
export interface CodigosBarra {
  /** Prefijo UPC de la empresa usado (de `Empresa.upc`). */
  prefijo: string;
  /** Código del modelo usado (de `Modelo.codigo`). */
  codigoModelo: string;
  /** Los 12 dígitos base (prefijo + código del modelo) sin verificador. */
  base12: string;
  /** EAN-13 completo (13 dígitos): base + dígito verificador módulo 10. */
  ean13: string;
  /** DUN-14 de caja (14 dígitos): indicador `1` + base + verificador módulo 10. */
  dun14: string;
}

/**
 * Suma ponderada del módulo 10 (GS1): de IZQUIERDA a derecha, posición impar (1.ª, 3.ª…)
 * por 1 y posición par por 3. Es la base del verificador del EAN-13 y del DUN-14.
 * Asume que `digitos` ya está validado como solo-dígitos.
 */
function sumaPonderadaModulo10(digitos: string): number {
  let total = 0;
  for (let i = 0; i < digitos.length; i += 1) {
    const valor = digitos.charCodeAt(i) - 48; // '0' = 48
    // i es 0-based: i=0 → posición 1 (impar, ×1); i=1 → posición 2 (par, ×3)…
    total += i % 2 === 0 ? valor : valor * 3;
  }
  return total;
}

/** Dígito verificador módulo 10 a partir de la suma ponderada (`0` si el resto es 0). */
function verificadorDesdeSuma(total: number): number {
  const resto = total % 10;
  return resto === 0 ? 0 : 10 - resto;
}

/** ¿La cadena es SOLO dígitos (0-9) y no vacía? */
function soloDigitos(valor: string): boolean {
  return valor.length > 0 && /^[0-9]+$/.test(valor);
}

/**
 * Normaliza un fragmento (prefijo o código de modelo) para componer la base numérica:
 * recorta espacios. NO rellena ni recorta dígitos: la longitud total debe cuadrar a 12
 * exactos (igual que el viejo, que exigía 12 dígitos justos).
 */
function normalizar(valor: string): string {
  return valor.trim();
}

/**
 * Calcula EAN-13 + DUN-14 de un modelo a partir del prefijo UPC de la empresa y el
 * código del modelo. PURA (sin BD).
 *
 * Reglas (réplica del viejo + GS1):
 *  • `prefijo` debe venir no vacío y ser solo dígitos (si la empresa no capturó su UPC,
 *    el llamador debe haber lanzado ya el error "la empresa no tiene prefijo UPC"; aquí
 *    se vuelve a validar por defensa en profundidad).
 *  • `codigoModelo` debe ser solo dígitos (los modelos del negocio son numéricos).
 *  • `prefijo + codigoModelo` debe sumar EXACTAMENTE 12 dígitos; si no, `ErrorCodigoBarra`
 *    con un mensaje claro (cuántos faltan/sobran), equivalente al "Debes meter 12 dígitos"
 *    del viejo pero accionable.
 *
 * @example
 * calcularCodigosBarra("7500092", "00501");
 * // → { base12: "750009200501", ean13: "7500092005011", dun14: "17500092005018", … }
 */
export function calcularCodigosBarra(prefijo: string, codigoModelo: string): CodigosBarra {
  const prefijoLimpio = normalizar(prefijo);
  const codigoLimpio = normalizar(codigoModelo);

  if (prefijoLimpio === '') {
    throw new ErrorCodigoBarra(
      'La empresa activa no tiene capturado su prefijo UPC. Captúralo en Administración → Empresas para poder generar códigos de barra.',
    );
  }
  if (!soloDigitos(prefijoLimpio)) {
    throw new ErrorCodigoBarra(
      `El prefijo UPC de la empresa ("${prefijoLimpio}") debe contener solo dígitos. Corrígelo en Administración → Empresas.`,
    );
  }
  if (codigoLimpio === '') {
    throw new ErrorCodigoBarra('El modelo no tiene un código para generar el código de barra.');
  }
  if (!soloDigitos(codigoLimpio)) {
    throw new ErrorCodigoBarra(
      `El código del modelo ("${codigoLimpio}") debe contener solo dígitos para generar un EAN-13 válido.`,
    );
  }

  const base12 = prefijoLimpio + codigoLimpio;
  if (base12.length !== LARGO_BASE_EAN13) {
    const diferencia = base12.length - LARGO_BASE_EAN13;
    const detalle =
      diferencia > 0 ? `sobran ${diferencia} dígito(s)` : `faltan ${-diferencia} dígito(s)`;
    throw new ErrorCodigoBarra(
      `El prefijo de la empresa ("${prefijoLimpio}", ${prefijoLimpio.length} dígitos) más el código del modelo ` +
        `("${codigoLimpio}", ${codigoLimpio.length} dígitos) deben sumar exactamente ${LARGO_BASE_EAN13} dígitos; ` +
        `${detalle} (total ${base12.length}).`,
    );
  }

  // El EAN-13 pondera los 12 dígitos base desde la IZQUIERDA (impar ×1, par ×3).
  const totalEan = sumaPonderadaModulo10(base12);
  const verificadorEan = verificadorDesdeSuma(totalEan);
  const ean13 = `${base12}${verificadorEan}`;

  // DUN-14: indicador "1" + base12 + verificador. El viejo lo deriva como (Total + 3) % 10
  // REUSANDO la MISMA suma del EAN (la de los 12 dígitos base): el "+3" es el peso del dígito
  // indicador "1", que en el GTIN-14 cae en posición impar-DESDE-LA-DERECHA → peso 3. Esto
  // coincide dígito a dígito con el verificador ITF-14 estándar (verificado en los tests) y con
  // el form viejo `Codigo`. NO se vuelve a ponderar la cadena de 13 desde la izquierda (daría
  // otro número): se replica el cálculo exacto del negocio.
  const verificadorDun = verificadorDesdeSuma(totalEan + 3 * Number(INDICADOR_DUN14));
  const dun14 = `${INDICADOR_DUN14}${base12}${verificadorDun}`;

  return {
    prefijo: prefijoLimpio,
    codigoModelo: codigoLimpio,
    base12,
    ean13,
    dun14,
  };
}
