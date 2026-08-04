/**
 * CONSTANCIA de los TERCEROS con SALDO EsMa que la ventana temporal deja FUERA (§7 — nada se
 * descarta en silencio).
 *
 * El criterio de recarga (decisión del DUEÑO, ver `comun/prescan-uso.ts` §7) retiene solo a los
 * terceros con ACTIVIDAD dentro de la ventana; el criterio grueso anterior ("cualquiera con cuenta
 * EsMa") quedó retirado porque retenía 334/496 maquileros por saldo viejo. Consecuencia: hay
 * maquileros que NO migran aunque su cuenta corriente cierre con saldo ≠ 0.
 *
 * Para modelos y telas ya existe la constancia `excluidos-sin-actividad-*.txt` (ver
 * `loaders/modelos.ts`); esto es su equivalente para TERCEROS: mismo patrón (archivo propio con el
 * MISMO prefijo — así el `.gitignore` existente `backend/excluidos-sin-actividad-*.txt` ya lo cubre —
 * más el conteo y la ruta en el `Reporte`). NO es una incidencia ni un error: es la decisión aplicada,
 * puesta por escrito para que quede registro de qué saldo se dejó de migrar.
 *
 * El saldo viejo se calcula con la MISMA fórmula derivada que v2 (D3, `dominio/esma/saldos.ts`):
 *   neto = Σ(CantRecEsMa × PrecioEsMa de cargos VALIDADOS) + Σabonos − Σpagos − Σdescuentos
 * ("ceronulo": nulos = 0). La FECHA del último movimiento es la mayor `EsMa.FechaEsMa` entre las
 * cabeceras del maquilero que traen al menos un movimiento hijo.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { leerCsv } from './csv.js';
import type { Reporte } from './reporte.js';
import { parsearBandera, parsearDinero, parsearFecha, parsearTexto } from './valores.js';

/** Saldo viejo (v1) de UN maquilero, con la fecha de su último movimiento. */
export interface SaldoEsMaViejo {
  /** Neto derivado (cargos validados + abonos − pagos − descuentos), redondeado a 2. */
  neto: number;
  /** Fecha del último movimiento EsMa (ISO `YYYY-MM-DD`), o null si ninguna era parseable. */
  ultimaFecha: string | null;
  /** # de movimientos (renglones hijos) que aportaron. */
  movimientos: number;
}

/** Redondeo monetario a 2 decimales (mismo criterio que `dominio/esma/saldos.ts`). */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calcula el saldo EsMa VIEJO por `IdMaquileros` (clave v1) leyendo los CSV del sistema anterior.
 * Devuelve solo los maquileros con al menos un movimiento. Función de solo lectura (no toca la BD).
 */
export function calcularSaldosEsMaViejos(): Map<string, SaldoEsMaViejo> {
  /** Cabecera EsMa: maquilero + fecha, por `IdEsMa`. */
  const cabeceras = new Map<string, { idMaquilero: string; fecha: Date | null }>();
  for (const f of leerCsv('EsMa.csv')) {
    const id = (f.IdEsMa ?? '').trim();
    if (id === '') continue;
    cabeceras.set(id, {
      idMaquilero: (f.IdMaquileros ?? '').trim(),
      fecha: parsearFecha(f.FechaEsMa),
    });
  }

  const saldos = new Map<string, SaldoEsMaViejo>();
  /** Aporta un movimiento (monto ya SIGNADO) al maquilero de la cabecera `idEsMa`. */
  const aportar = (idEsMa: string, monto: number): void => {
    const cab = cabeceras.get(idEsMa);
    if (cab === undefined) return;
    const idMaq = cab.idMaquilero;
    if (idMaq === '' || idMaq === '0') return;
    const s = saldos.get(idMaq) ?? { neto: 0, ultimaFecha: null, movimientos: 0 };
    s.neto += monto;
    s.movimientos += 1;
    if (cab.fecha !== null) {
      const iso = cab.fecha.toISOString().slice(0, 10);
      if (s.ultimaFecha === null || iso > s.ultimaFecha) s.ultimaFecha = iso;
    }
    saldos.set(idMaq, s);
  };

  // Cargos: SOLO los validados (igual que el saldo derivado de v2).
  for (const r of leerCsv('EsMa_Recibos.csv')) {
    if (parsearBandera(r.RevisionPendiente)) continue;
    const importe = (parsearDinero(r.CantRecEsMa) ?? 0) * (parsearDinero(r.PrecioEsMa) ?? 0);
    aportar((r.IdEsMa ?? '').trim(), importe);
  }
  for (const r of leerCsv('EsMa_Abonos.csv')) {
    aportar((r.IdEsMa ?? '').trim(), parsearDinero(r.AbonoEsMa) ?? 0);
  }
  for (const r of leerCsv('EsMa_Pagos.csv')) {
    aportar((r.IdEsMa ?? '').trim(), -(parsearDinero(r.PagoEsMa) ?? 0));
  }
  for (const r of leerCsv('EsMa_Desc.csv')) {
    aportar((r.IdEsMa ?? '').trim(), -(parsearDinero(r.DescuentoEsMa) ?? 0));
  }

  for (const [id, s] of saldos) {
    saldos.set(id, { ...s, neto: redondear2(s.neto) });
  }
  return saldos;
}

/** Un tercero excluido con saldo, ya resuelto (para el archivo). */
export interface TerceroExcluidoConSaldo {
  idViejo: string;
  nombre: string;
  neto: number;
  ultimaFecha: string | null;
  movimientos: number;
}

/**
 * Arma la lista de terceros EXCLUIDOS por la ventana que traían saldo EsMa ≠ 0. `estaUsado` es el
 * predicado del prescan (true = el tercero SÍ migra). Ordena por |neto| descendente (lo más gordo
 * primero, que es lo que Daniel querría revisar).
 */
export function listarTercerosExcluidosConSaldo(
  estaUsado: (idViejo: string) => boolean,
): TerceroExcluidoConSaldo[] {
  const saldos = calcularSaldosEsMaViejos();
  const nombres = new Map<string, string>();
  for (const f of leerCsv('Maquileros.csv')) {
    const id = (f.IdMaquileros ?? '').trim();
    if (id === '') continue;
    const nombre = [parsearTexto(f.Nombre), parsearTexto(f.Apellidos)]
      .filter((p) => p !== null)
      .join(' ')
      .trim();
    nombres.set(id, nombre === '' ? (parsearTexto(f.Corto) ?? '(sin nombre)') : nombre);
  }

  const fuera: TerceroExcluidoConSaldo[] = [];
  for (const [idViejo, s] of saldos) {
    if (s.neto === 0 || estaUsado(idViejo)) continue;
    fuera.push({
      idViejo,
      nombre: nombres.get(idViejo) ?? '(sin fila en Maquileros.csv)',
      neto: s.neto,
      ultimaFecha: s.ultimaFecha,
      movimientos: s.movimientos,
    });
  }
  fuera.sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto));
  return fuera;
}

/**
 * Escribe la CONSTANCIA de los terceros excluidos con saldo EsMa y anota conteo + ruta en el
 * `Reporte`. No-op (devuelve null) si no hay ninguno. Archivo
 * `excluidos-sin-actividad-terceros-<timestamp>.txt` (mismo prefijo que la constancia de inventario
 * → ya cubierto por el `.gitignore` existente).
 */
export function escribirConstanciaTercerosConSaldo(
  fuera: TerceroExcluidoConSaldo[],
  reporte: Reporte,
): string | null {
  if (fuera.length === 0) return null;

  const sumaAbs = fuera.reduce((t, x) => t + Math.abs(x.neto), 0);
  // Desglose por año del último movimiento (contexto de antigüedad, como pidió Gabriel).
  const porAnio = new Map<string, number>();
  for (const x of fuera) {
    const anio = x.ultimaFecha === null ? '(sin fecha)' : x.ultimaFecha.slice(0, 4);
    porAnio.set(anio, (porAnio.get(anio) ?? 0) + 1);
  }
  const anios = [...porAnio.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  const ruta = join(
    process.cwd(),
    `excluidos-sin-actividad-terceros-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
  );
  const texto = [
    'TERCEROS CON SALDO QUE NO SE MIGRAN — constancia para Daniel',
    '',
    'Criterio vigente (decisión del DUEÑO): a la recarga por ventana solo entran los terceros con',
    'ACTIVIDAD dentro de la ventana. Los de abajo quedaron FUERA aunque su cuenta corriente de',
    'maquila (EsMa) cierra con saldo ≠ 0. NO es una incidencia ni un error: es la decisión aplicada,',
    'y se deja por escrito para que quede registro de qué saldo se dejó de migrar.',
    '',
    'El neto usa la MISMA fórmula derivada que v2 (D3): cargos VALIDADOS (cant × precio) + abonos',
    '− pagos − descuentos, con "ceronulo". Signo positivo = se le debía al maquilero.',
    '',
    `TERCEROS excluidos con saldo ≠ 0: ${String(fuera.length)} (Σ|neto| = ${sumaAbs.toFixed(2)})`,
    `Antigüedad (año del último movimiento EsMa): ${anios.map(([a, n]) => `${a}=${String(n)}`).join(' · ')}`,
    'Columnas: IdMaquileros (clave v1) <TAB> nombre <TAB> neto <TAB> último movimiento <TAB> # movs',
    '─'.repeat(80),
    ...fuera.map(
      (x) =>
        `${x.idViejo}\t${x.nombre}\t${x.neto.toFixed(2)}\t${x.ultimaFecha ?? '(sin fecha)'}\t${String(x.movimientos)}`,
    ),
    '',
  ].join('\n');
  writeFileSync(ruta, texto, { encoding: 'utf-8' });

  reporte.nota(
    `Terceros con SALDO EsMa ≠ 0 NO migrados por falta de actividad en la ventana (decisión del ` +
      `dueño): ${String(fuera.length)} (Σ|neto| ${sumaAbs.toFixed(2)}). Constancia COMPLETA en: ${ruta}`,
  );
  return ruta;
}
