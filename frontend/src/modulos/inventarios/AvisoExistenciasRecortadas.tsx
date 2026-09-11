/**
 * EL AVISO DE QUE LA LISTA DE EXISTENCIAS VIENE CORTADA (fila 0.143).
 *
 * ⭐ Es la MITAD de la cura, no un adorno. Desde la 0.143 `GET /inventarios/pt/existencias` devuelve
 * como mucho `limite` renglones — antes devolvía la vista entera (56 860 filas medidas contra una
 * base sintética de 525 000 renglones). Acotar sin decirlo convertiría un problema de peso en un
 * problema de VERDAD: una pantalla que enseña 1 000 renglones y calla que hay 56 860 miente peor
 * que la lenta que los traía todos.
 *
 * 🔑 Vive en un componente compartido porque **la frase tiene que ser la misma en las tres
 * pantallas** que consumen ese endpoint (Existencias, Movimientos y Traspasos) — mismo criterio con
 * el que `PeriodoKardex.tsx` reúne la línea del periodo de los cuatro kardex. Lo que cambia entre
 * ellas es qué hacer al respecto, y eso entra por `consejo`.
 *
 * ⚠️ La redacción evita a propósito cualquier frase que se pueda leer como «esto es todo»: dice
 * cuántos se enseñan, cuántos hay, por qué esos y qué hacer para ver el resto.
 */

/** Lo que la respuesta de existencias trae para poder ser honesta. */
export interface RecorteDeExistencias {
  /** true si el filtro tiene más renglones de los que caben en `limite`. */
  truncado: boolean;
  /** Cuántos renglones cumplen el filtro EN TOTAL (no cuántos llegaron). */
  totalFilas: number;
  /** Tope de renglones que aplicó el servidor. */
  limite: number;
}

export function AvisoExistenciasRecortadas({
  idBase,
  datos,
  mostrados,
  consejo,
  className = 'border-b border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive',
}: {
  /** Prefijo del `data-testid` (cada pantalla el suyo). */
  idBase: string;
  /** El encabezado de recorte de la respuesta; `undefined` mientras carga. */
  datos: RecorteDeExistencias | undefined;
  /** Renglones que la pantalla tiene en la mano (se dicen tal cual, no se deducen del `limite`). */
  mostrados: number;
  /** Qué puede hacer quien lo lee para llegar al resto. Propio de cada pantalla. */
  consejo: string;
  /**
   * Envoltura visual. Por omisión es la FRANJA de ancho completo de la pantalla de Existencias
   * (va pegada bajo la barra de filtros); las dos pantallas de captura la pasan en caja redondeada,
   * porque ahí el aviso vive suelto dentro de un formulario y una franja con borde inferior
   * partiría la hoja en dos. Mismo texto en las tres — lo único que cambia es el marco.
   */
  className?: string;
}): React.JSX.Element | null {
  if (datos === undefined || !datos.truncado) return null;
  return (
    <p className={className} role="status" data-testid={`${idBase}-truncado`}>
      No caben todos: se muestran{' '}
      <span className="num font-medium">{mostrados.toLocaleString('es-MX')}</span> de{' '}
      <span className="num font-medium">{datos.totalFilas.toLocaleString('es-MX')}</span> renglones
      — los de MAYOR existencia (también los negativos). {consejo}
    </p>
  );
}
