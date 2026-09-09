import { Input } from '@/components/ui/input';

/**
 * EL PERIODO DE UN KARDEX, lado pantalla: el par de fechas que se manda al servidor y la línea que
 * dice —sin adornos— qué pedazo se está viendo.
 *
 * ⭐ Nació en producto terminado con la fila 0.138 y la 0.173 lo sacó aquí para los otros tres
 * kardex (tela por color, tela por lote y avíos). No es reutilización por ahorro: es que **la frase
 * tiene que ser la misma en los cuatro**. La línea del periodo es la única de la pantalla cuyo
 * trabajo es no mentir, y ya mintió una vez —decía «a hoy» cuando el servidor no puso techo, con un
 * movimiento de 2027 visible en la tabla—. Con una sola copia, ese arreglo vale para todos.
 *
 * 🔑 Lo que la pantalla NO hace: filtrar. Las fechas VIAJAN al servidor (A1); aquí nunca se recorta
 * lo que ya llegó. Y los tres datos que se pintan —periodo efectivo, ventana por omisión y si hubo
 * corte— vienen de la RESPUESTA, no se deducen de lo que el usuario escribió.
 */

/** Lo que la respuesta de cualquier kardex con periodo trae para poder ser honesta. */
export interface PeriodoDeKardex {
  /** Primer día consultado (YYYY-MM-DD, inclusive). Siempre hay uno. */
  desde: string;
  /** Último día consultado, o null si no se puso techo. */
  hasta: string | null;
  /** true cuando el `desde` lo puso el servidor porque nadie pidió periodo. */
  ventanaPorOmision: boolean;
  /** Tope de renglones que se aplicó. */
  limite: number;
  /** true si el periodo tiene más movimientos de los que caben en `limite`. */
  truncado: boolean;
}

/** Los dos campos de fecha de la barra de filtros. Vacío = el servidor pone su ventana. */
export function FiltroPeriodoKardex({
  idBase,
  desde,
  hasta,
  alCambiarDesde,
  alCambiarHasta,
}: {
  /** Prefijo de `id`/`data-testid` (una pantalla puede tener más de un kardex). */
  idBase: string;
  desde: string;
  hasta: string;
  alCambiarDesde: (valor: string) => void;
  alCambiarHasta: (valor: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={`${idBase}-desde`} className="text-xs text-muted-foreground">
        Desde
      </label>
      <Input
        id={`${idBase}-desde`}
        type="date"
        className="h-8 w-36 text-sm"
        value={desde}
        onChange={(e) => alCambiarDesde(e.target.value)}
        data-testid={`${idBase}-desde`}
      />
      <label htmlFor={`${idBase}-hasta`} className="text-xs text-muted-foreground">
        Hasta
      </label>
      <Input
        id={`${idBase}-hasta`}
        type="date"
        className="h-8 w-36 text-sm"
        value={hasta}
        onChange={(e) => alCambiarHasta(e.target.value)}
        data-testid={`${idBase}-hasta`}
      />
    </div>
  );
}

/**
 * Qué periodo se está viendo REALMENTE — y si la lista vino cortada. Sin esta línea, una ventana por
 * omisión se leería como «esto no tiene más movimientos».
 */
export function LineaPeriodoKardex({
  idBase,
  periodo,
  className = 'border-b px-3 py-1.5 text-xs text-muted-foreground',
}: {
  idBase: string;
  periodo: PeriodoDeKardex;
  className?: string;
}): React.JSX.Element {
  return (
    <p className={className} data-testid={`${idBase}-periodo`}>
      {/* ⚠️ Decía «a hoy» cuando no hay techo, y el techo se deja abierto A PROPÓSITO para que
          salgan los movimientos con fecha futura (los hay: el histórico migrado trae fechas
          capturadas mal, hasta 2029). Con uno fechado el año que viene, la línea decía «a hoy» y la
          tabla enseñaba ese renglón. */}
      Periodo: <span className="num text-foreground">{periodo.desde}</span>
      {periodo.hasta === null ? (
        <> en adelante (sin fecha de corte: también salen los movimientos con fecha futura)</>
      ) : (
        <>
          {' '}
          a <span className="num text-foreground">{periodo.hasta}</span>
        </>
      )}
      {/* ⚠️ Y el aviso de la ventana por omisión tiene DOS casos, no uno: con sólo «hasta», la
          ventana son los 12 meses que TERMINAN ahí — ni son «los últimos 12 meses», ni es verdad
          que el usuario no puso fechas. */}
      {periodo.ventanaPorOmision
        ? periodo.hasta === null
          ? ' · últimos 12 meses por omisión — pon fechas para ver otro periodo'
          : ' · son los 12 meses ANTERIORES a esa fecha (no se pidió «desde»)'
        : ''}
      {periodo.truncado ? (
        <span className="ml-1.5 font-medium text-destructive" data-testid={`${idBase}-truncado`}>
          · El periodo no cabe: se muestran los {periodo.limite.toLocaleString('es-MX')} más
          RECIENTES. Lo anterior queda fuera (el saldo sí lo cuenta): acota las fechas para verlo.
        </span>
      ) : null}
    </p>
  );
}
