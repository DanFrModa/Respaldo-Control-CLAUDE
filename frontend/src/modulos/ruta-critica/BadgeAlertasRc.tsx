import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useConteoAlertasRc } from '@/api/ruta-critica-programacion';
import { claseBotonIcono, cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

/**
 * CAMPANA DE ALERTAS de la Ruta Crítica en la topbar (F5-E5, look R9 fiel al
 * prototipo): un `.icon-btn` con un PUNTITO de 7px (rojo si hay atrasadas,
 * ámbar si solo en riesgo, nada si no hay alertas) — el NÚMERO vive en el badge
 * del riel y en el `aria-label`/`data-total`. Lleva a la bandeja al hacer clic.
 * Se refresca solo (cada ~60 s, vía el hook) y al invalidar tras una captura.
 * Solo se monta para quien tiene `rc.ruta-ver`. CERO lógica de negocio (A1):
 * el conteo lo DERIVA el backend.
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

  return (
    <button
      type="button"
      className={cn(claseBotonIcono, 'relative')}
      onClick={() => void navigate('/ruta-critica/pendientes')}
      aria-label={
        total > 0 ? `${total} tareas con alerta de Ruta Crítica` : 'Mis pendientes de Ruta Crítica'
      }
      title="Mis pendientes de Ruta Crítica"
      data-testid="badge-alertas-rc"
      data-total={total}
    >
      <Bell className="size-[17px]" aria-hidden />
      {total > 0 ? (
        // Punto del proto: 7px con borde de 1.5px del color del panel (lo recorta
        // de la campana). Severidad con los tokens semánticos (R1).
        <span
          aria-hidden
          className={cn(
            'absolute top-[5px] right-1.5 size-[7px] rounded-full border-[1.5px] border-card',
            atrasados > 0 ? 'bg-crit' : 'bg-warn',
          )}
          data-testid="badge-alertas-rc-conteo"
        />
      ) : null}
    </button>
  );
}
