/**
 * Cálculo PURO de la DURACIÓN estimada (en días) de un proceso de la Ruta Crítica (F5-E3 — doc
 * `08-Ruta-Critica.md` §2.3 "tiempos"; D10/D11). Es la fórmula que el viejo tenía repartida en
 * `RC_ProgramacionSub` (`FactCant`, `FactCantAp`, `TelasDias`, `AplicDias`) — aquí UNIFICADA,
 * corregida y sin números a fuego: TODOS los parámetros (factores por cantidad, días por tela, días
 * por aplicación, colchón de costura) se leen de los catálogos en VIVO (E2), porque Daniel pide
 * poder ajustarlos desde la pantalla de Reglas de duración sin re-desplegar (decisión (b), 22-jun).
 *
 * Se aísla aquí, sin Prisma ni sesión, para probarla directamente con números calculados a mano
 * (tests unitarios sin BD). Quien la llama (`generarRutaOrden`) carga los catálogos de la BD y los
 * pasa por parámetro.
 *
 * Las CUATRO reglas (según `ProcesoDef.tipoDuracion`):
 *  • `fija`         → `tiempoEstandar` tal cual (días fijos de la plantilla).
 *  • `porCantidad`  → `max(1, round(tiempoEstandar × factorCantidad(cant) + colchon))`. El colchón
 *                     es `ConfiguracionEmpresa.colchonCostura` (ex `TiempoColchonCostura`).
 *  • `porTipoTela`  → los `dias` del catálogo del tipo de tela elegido, DIRECTOS. NO se multiplica
 *                     por `factorTela` (se conserva como referencia; multiplicarlo doble-contaría —
 *                     decisión de Daniel 22-jun).
 *  • `porAplicacion`→ `max(0, round(diasAplicacion × factorCantidad(cant)))`. PRENDE el factor de
 *                     cantidad que el viejo tenía MUERTO (`FactCantAp` ignoraba el factor — bug). La
 *                     columna `DuracionPorAplicacion.factor` NO se usa (referencia, como factorTela).
 *                     Si la aplicación es "Sin Aplicación" (dias 0) → 0 días.
 *
 * Redondeo: `Math.round` (el viejo usaba `CInt`, redondeo bancario; `Math.round` es lo bastante
 * cercano y predecible para una estimación de planeación — los ejemplos de la spec cuadran).
 */

/** Un rango de factor por cantidad ya cargado del catálogo (Decimal → number). */
export interface RangoFactorCantidad {
  deCant: number;
  aCant: number;
  factor: number;
}

/** Días por tipo de tela del catálogo (ya cargado). `factorTela` se conserva pero NO se aplica. */
export interface DiasPorTela {
  dias: number;
}

/** Días por aplicación del catálogo (ya cargado). `factor` se conserva pero NO se aplica. */
export interface DiasPorAplicacion {
  dias: number;
}

/** Cómo se calcula la duración del proceso (espejo de `TipoDuracionProceso`). */
export type TipoDuracion = 'fija' | 'porCantidad' | 'porTipoTela' | 'porAplicacion';

/** Datos del proceso + de la orden + catálogos que necesita el cálculo. */
export interface EntradaCalculoDuracion {
  /** Cómo se calcula la duración de este proceso. */
  tipoDuracion: TipoDuracion;
  /** Tiempo estándar del proceso en la plantilla (días). Base de `fija` y `porCantidad`. */
  tiempoEstandar: number;
  /** Cantidad total de piezas de la orden (Σ de la matriz color×talla). */
  cantidad: number;
  /** Colchón de costura de la empresa (días), o `null`/`undefined` → 0. */
  colchonCostura?: number | null;
  /** Rangos de factor por cantidad del catálogo (ex CP_Cant). */
  factoresCantidad: readonly RangoFactorCantidad[];
  /** Días del tipo de tela ELEGIDO para la orden (o `null` si no se eligió). */
  tela?: DiasPorTela | null;
  /** Días de la aplicación ELEGIDA para la orden (o `null` si no se eligió). */
  aplicacion?: DiasPorAplicacion | null;
}

/** Resultado del cálculo: días + advertencias (no fatales) sobre supuestos tomados. */
export interface ResultadoDuracion {
  /** Días estimados del proceso (entero ≥ 0). */
  dias: number;
  /** Advertencias informativas (p. ej. la cantidad no cayó en ningún rango → factor 1). */
  advertencias: string[];
}

/**
 * Factor por cantidad: el `factor` del rango `[deCant, aCant]` donde cae `cantidad`. Si la cantidad
 * NO cae en ningún rango, devuelve `1` (sin factor) y deja una advertencia — mismo comportamiento
 * que el viejo (`FactCant` mostraba un MsgBox y devolvía el tiempo sin factor).
 */
export function factorPorCantidad(
  cantidad: number,
  rangos: readonly RangoFactorCantidad[],
): { factor: number; enRango: boolean } {
  for (const r of rangos) {
    if (cantidad >= r.deCant && cantidad <= r.aCant) {
      return { factor: r.factor, enRango: true };
    }
  }
  return { factor: 1, enRango: false };
}

/**
 * Calcula la duración (días) de un proceso según su `tipoDuracion` y los catálogos en vivo. Función
 * PURA. Ver el encabezado del archivo para las cuatro reglas y la decisión (b).
 */
export function calcularDuracion(entrada: EntradaCalculoDuracion): ResultadoDuracion {
  const advertencias: string[] = [];
  const colchon = entrada.colchonCostura ?? 0;

  switch (entrada.tipoDuracion) {
    case 'fija':
      return { dias: Math.max(0, entrada.tiempoEstandar), advertencias };

    case 'porCantidad': {
      const { factor, enRango } = factorPorCantidad(entrada.cantidad, entrada.factoresCantidad);
      if (!enRango) {
        advertencias.push(
          `La cantidad (${String(entrada.cantidad)}) no cae en ningún rango de factor; ` +
            'se usó factor 1 (sin factor).',
        );
      }
      const dias = Math.max(1, Math.round(entrada.tiempoEstandar * factor + colchon));
      return { dias, advertencias };
    }

    case 'porTipoTela': {
      if (entrada.tela == null) {
        advertencias.push(
          'No se eligió tipo de tela; se usó el tiempo estándar del proceso como duración.',
        );
        return { dias: Math.max(0, entrada.tiempoEstandar), advertencias };
      }
      // Días del catálogo, DIRECTOS (NO se multiplica por factorTela — decisión (b)).
      return { dias: Math.max(0, entrada.tela.dias), advertencias };
    }

    case 'porAplicacion': {
      if (entrada.aplicacion == null) {
        advertencias.push(
          'No se eligió aplicación; se usó el tiempo estándar del proceso como duración.',
        );
        return { dias: Math.max(0, entrada.tiempoEstandar), advertencias };
      }
      const { factor, enRango } = factorPorCantidad(entrada.cantidad, entrada.factoresCantidad);
      if (!enRango) {
        advertencias.push(
          `La cantidad (${String(entrada.cantidad)}) no cae en ningún rango de factor; ` +
            'se usó factor 1 sobre los días de aplicación.',
        );
      }
      // PRENDE el factor de cantidad sobre los días de aplicación (ex-bug FactCantAp). Si la
      // aplicación es "Sin Aplicación" (dias 0) → 0 (el proceso se auto-completará al generar).
      const dias = Math.max(0, Math.round(entrada.aplicacion.dias * factor));
      return { dias, advertencias };
    }
  }
}
