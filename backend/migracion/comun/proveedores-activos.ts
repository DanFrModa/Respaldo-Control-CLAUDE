/**
 * ¿QUÉ PROVEEDORES SIGUEN VIVOS? — depuración del catálogo al migrar (§Post-F9.23).
 *
 * Daniel (10-ago-2026): *"Me gustaría depurar el catálogo de proveedores… creo que lo mejor va a
 * ser empezar desde cero. Hay demasiados proveedores con los que ya no se trabaja… la decisión que
 * te dio Gabriel es trabajar con información de 2025 y 2026 de Control. Solo vamos a jalar esos
 * proveedores y corregirlos porque les falta mucha información."*
 *
 * El Access acumuló **1,052 filas** entre sus cuatro catálogos de terceros (443 Proveedores + 69
 * Cortadores + 496 Maquileros + 44 Estampadores) en ~20 años. Un tercero **no se declara vivo por
 * estar en el catálogo, sino por haber MOVIDO algo**: por eso aquí no se mira ninguna bandera
 * `Activo` del viejo (nadie la mantuvo), sino los documentos con fecha.
 *
 * DE DÓNDE SALE "MOVIÓ ALGO", por tipo de tercero:
 *  • **Comercial** (vende telas/avíos/servicios) → `OrdCompra.IdProveedor`.
 *  • **Cortador** → `Corte.IdCortadores`.
 *  • **Taller** (costura y/o estampado) → `Entregas`, `Recibos`, `Notas` y **`EntregasEst` /
 *    `RecibosEst`**.
 *
 * ⚠️ HALLAZGO IMPORTANTE (verificado en el dump, 10-ago-2026): **`EntregasEst.IdMaquileros` y
 * `RecibosEst.IdMaquileros` apuntan a `Maquileros`, NO a `Estampadores`** — de los 15 ids que
 * estampan en 2025/26, 14 existen en `Maquileros` y **ninguno** en `Estampadores` (el 15º es `0`,
 * el nulo del viejo). Es decir: **`Estampadores.csv` es un catálogo MUERTO** — 44 filas que hoy el
 * ETL crea como proveedores y que nadie usa. Quien estampa es un taller del catálogo de maquileros.
 * Por eso el estampado suma al conjunto de TALLERES y `Estampadores` se queda, correctamente, en
 * cero. Se reporta explícito (§7 del plan: nada se descarta en silencio).
 *
 * CONFIGURABLE, y por defecto **NO recorta** — igual que `ventana.ts`: quien corre el ETL decide.
 *  • Lo normal es NO poner nada aquí: el año sale de **`ETL_DESDE`**, el interruptor de toda la
 *    migración (§Post-F9.24), para que el catálogo y los documentos no puedan desalinearse.
 *  • `ETL_PROVEEDORES_DESDE` (año) lo sobreescribe, por si alguna vez conviene depurar el catálogo
 *    con un criterio distinto al de los documentos. Sin ninguna de las dos, se cargan **todos**.
 */
import { leerCsv } from './csv.js';
import { parsearFecha } from './valores.js';
import { leerDesdeAnio } from './ventana.js';

/** Fuentes de terceros del sistema viejo (una por catálogo del Access). */
export type FuenteTercero = 'comercial' | 'cortador' | 'taller' | 'estampador';

/** Conjunto de ids vivos por fuente + la configuración con la que se calcularon. */
export interface ProveedoresActivos {
  /** Año de corte (`0` = sin recorte: todos vivos). */
  desde: number;
  /** ¿Este tercero movió algo dentro de la ventana? Con `desde = 0` siempre `true`. */
  activo(fuente: FuenteTercero, idViejo: string | undefined): boolean;
  /** Cuántos ids distintos movieron algo, por fuente (para el reporte). */
  conteos: Record<FuenteTercero, number>;
}

/**
 * Año de corte. Sale de `ETL_DESDE` —el interruptor de TODA la migración (§Post-F9.24)— para que
 * el catálogo de proveedores y los documentos que lo usan no puedan quedar desalineados: si la
 * migración lleva 2025-2026, los proveedores son los de 2025-2026.
 *
 * `ETL_PROVEEDORES_DESDE` sigue existiendo y **gana** si se pone: sirve para depurar el catálogo
 * con un criterio distinto al de los documentos (p. ej. cargar más historia pero solo los
 * proveedores recientes). Inválido o ausente en ambas → 0 = no se depura.
 */
function leerDesde(): number {
  const crudo = (process.env.ETL_PROVEEDORES_DESDE ?? '').trim();
  if (crudo === '') return leerDesdeAnio();
  const n = Number(crudo);
  return Number.isInteger(n) && n >= 1900 ? n : 0;
}

/**
 * Año de una fecha del Access. Delega en el parser OFICIAL del ETL (`comun/valores.ts`) en vez de
 * cortar la cadena a mano: ese acepta `d/m/yyyy` sin ceros a la izquierda y valida el rango, que es
 * como el Access puede exportar según la configuración regional de quien haga el volcado. Un
 * segundo parser divergente habría depurado terceros VIVOS en cuanto el dump cambiara de formato,
 * sin avisar de nada.
 *
 * Devuelve `null` si no se puede leer — y un movimiento sin fecha legible **NO** declara vivo a
 * nadie: preferimos dejar fuera a un tercero dudoso (se vuelve a dar de alta en un minuto) que
 * arrastrar de vuelta la basura que se está depurando.
 */
function anioDe(valor: string | undefined): number | null {
  const fecha = parsearFecha(valor);
  return fecha === null ? null : fecha.getUTCFullYear();
}

/** Ids de una columna de un CSV cuyas filas caen en `desde` o después. Ignora vacíos y `"0"`. */
function idsConMovimiento(
  archivo: string,
  columnaId: string,
  columnaFecha: string,
  desde: number,
): Set<string> {
  const vivos = new Set<string>();
  for (const fila of leerCsv(archivo)) {
    const id = (fila[columnaId] ?? '').trim();
    // `"0"` es el nulo del viejo (no hay tercero #0); dejarlo entrar crearía un fantasma.
    if (id === '' || id === '0') continue;
    const anio = anioDe(fila[columnaFecha]);
    if (anio !== null && anio >= desde) vivos.add(id);
  }
  return vivos;
}

/**
 * Calcula quién movió algo desde `ETL_PROVEEDORES_DESDE`. Se llama UNA vez por corrida (lee seis
 * CSV; el loader comparte el resultado entre todas sus filas).
 */
export function resolverProveedoresActivos(): ProveedoresActivos {
  const desde = leerDesde();
  if (desde === 0) {
    return {
      desde,
      activo: () => true,
      conteos: { comercial: 0, cortador: 0, taller: 0, estampador: 0 },
    };
  }

  const comercial = idsConMovimiento('OrdCompra.csv', 'IdProveedor', 'Fecha', desde);
  const cortador = idsConMovimiento('Corte.csv', 'IdCortadores', 'Fecha', desde);
  // Los cinco documentos del taller: costura (Entregas/Recibos), envío (Notas) y estampado
  // (EntregasEst/RecibosEst — que apuntan a Maquileros, ver TSDoc del módulo).
  const taller = new Set<string>([
    ...idsConMovimiento('Entregas.csv', 'IdMaquileros', 'Fecha', desde),
    ...idsConMovimiento('Recibos.csv', 'IdMaquileros', 'Fecha', desde),
    ...idsConMovimiento('Notas.csv', 'IdMaquileros', 'FechaElaboracion', desde),
    ...idsConMovimiento('EntregasEst.csv', 'IdMaquileros', 'Fecha', desde),
    ...idsConMovimiento('RecibosEst.csv', 'IdMaquileros', 'Fecha', desde),
  ]);
  // `Estampadores` no tiene NINGÚN documento que le apunte por id: su conjunto vivo es vacío
  // por construcción, no por descuido. Ver el hallazgo en el TSDoc del módulo.
  const estampador = new Set<string>();

  const porFuente: Record<FuenteTercero, Set<string>> = {
    comercial,
    cortador,
    taller,
    estampador,
  };

  return {
    desde,
    activo: (fuente, idViejo) => {
      const id = (idViejo ?? '').trim();
      return id !== '' && porFuente[fuente].has(id);
    },
    conteos: {
      comercial: comercial.size,
      cortador: cortador.size,
      taller: taller.size,
      estampador: estampador.size,
    },
  };
}

/** Frase para el reporte de cuadre: qué ventana se aplicó (o que no se aplicó ninguna). */
export function describirProveedoresActivos(cfg: ProveedoresActivos): string {
  if (cfg.desde === 0) {
    return 'Proveedores: SIN depuración (se cargan todos los del Access). Para depurar, corre el ETL con ETL_DESDE=2025.';
  }
  const { comercial, cortador, taller } = cfg.conteos;
  return (
    `Proveedores: solo los que movieron algo desde ${String(cfg.desde)} — ` +
    `${String(comercial)} comerciales, ${String(cortador)} cortadores, ${String(taller)} talleres ` +
    `(el catálogo Estampadores queda fuera completo: ningún documento le apunta).`
  );
}
