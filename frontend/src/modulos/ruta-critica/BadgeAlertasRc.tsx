import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useConteoAlertasRc } from '@/api/ruta-critica-programacion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

/**
 * BADGE DE ALERTAS de la Ruta Crítica en el header (F5-E5): muestra el total de MIS tareas atrasadas
 * + en riesgo, con color (rojo si hay atrasadas, ámbar si solo en riesgo) y lleva a la bandeja al
 * hacer clic. Se refresca solo (cada ~60 s, vía el hook) y al invalidar tras una captura. Solo se
 * monta para quien tiene `rc.ruta-ver`. CERO lógica de negocio (A1): el conteo lo DERIVA el backend.
 */
export function BadgeAlertasRc(): React.JSX.Element | null {
  const { tienePermiso } = useSesion();
  const navigate = useNavigate();
  const puedeVer = tienePermiso('rc.ruta-ver');

  // El hook se llama siempre (regla de hooks), pero se apaga sin permiso.
  const consulta = useConteoAlertasRc({ habilitado: puedeVer });

  if (!puedeVer) {
    return null;
  }

  const conteo = consulta.data;
  const atrasados = conteo?.atrasados ?? 0;
  const enRiesgo = conteo?.enRiesgo ?? 0;
  const total = atrasados + enRiesgo;

  // Tokens semanticos del rediseño (R1): critico/atencion separados de la marca.
  const tono =
    atrasados > 0
      ? 'bg-crit text-white'
      : enRiesgo > 0
        ? 'bg-warn text-white'
        : 'bg-muted text-muted-foreground';

  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative"
      onClick={() => void navigate('/ruta-critica/pendientes')}
      aria-label={
        total > 0 ? `${total} tareas con alerta de Ruta Crítica` : 'Mis pendientes de Ruta Crítica'
      }
      title="Mis pendientes de Ruta Crítica"
      data-testid="badge-alertas-rc"
      data-total={total}
    >
      <Bell className="size-5" aria-hidden />
      {total > 0 ? (
        <span
          className={cn(
            'absolute -top-0.5 -right-0.5 grid min-w-4.5 place-items-center rounded-full px-1 text-[0.65rem] font-semibold tabular-nums',
            tono,
          )}
          data-testid="badge-alertas-rc-conteo"
        >
          {total > 99 ? '99+' : total}
        </span>
      ) : null}
    </Button>
  );
}
