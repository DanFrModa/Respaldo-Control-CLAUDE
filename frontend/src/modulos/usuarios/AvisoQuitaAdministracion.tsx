import { ShieldAlert } from 'lucide-react';

/**
 * Aviso de pantalla del guard anti-lockout del backend (V1-E6c).
 *
 * El servidor es quien BLOQUEA (§Post-F9.68): impide que el sistema se quede sin
 * ningún usuario activo capaz de administrarlo. La pantalla no repite esa
 * decisión —no sabe cuántos administradores hay ni puede saberlo sin la
 * paginación entera— y por eso **no esconde ni deshabilita nada**: avisa a
 * tiempo, para que quien opera entienda POR QUÉ el guardado puede rebotar y qué
 * hacer antes, en vez de toparse con un botón muerto o con un error a ciegas.
 *
 * Qué capacidad se pierde lo calculan los ayudantes de `gobierno.ts`; aquí solo
 * se redacta el aviso, diciendo la SALIDA (nombrar antes a otro administrador) y
 * no solo el "puede que no se pueda".
 */
export function AvisoQuitaAdministracion({
  capacidades,
}: {
  /** Capacidades que se pierden (de {@link capacidadesQueSePierden}); vacío = no se pinta. */
  capacidades: readonly string[];
}): React.JSX.Element | null {
  if (capacidades.length === 0) {
    return null;
  }
  return (
    // <span>, NO <div>: este aviso se pinta dentro del `DialogDescription` de
    // Radix, que renderiza un <p> — un <div> ahí es anidamiento inválido.
    <span
      className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
      data-testid="aviso-quita-administracion"
    >
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
      <span>
        Con este cambio esta persona dejará de poder{' '}
        <b className="text-foreground">{capacidades.join(' y ')}</b>. Si es la última que puede
        hacerlo, el servidor lo rechazará para no dejar al sistema sin administrador: nombra antes a
        alguien más dándole un rol con esos permisos.
      </span>
    </span>
  );
}
