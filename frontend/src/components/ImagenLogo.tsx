import { useContext, useState } from 'react';

import logoEmpaquetado from '@/assets/logo-frmoda.png';
import { ContextoSesion } from '@/sesion/contexto';

/**
 * Imagen del LOGO de la empresa (branding post-F9, petición de Daniel del 25-jul-2026) — **el único
 * sitio de la app que decide de dónde sale la marca**. Lo usan la {@link Marca} del riel y la
 * pantalla de inicio de sesión, para que las dos se actualicen solas al cambiar el logo en
 * Administración › Empresas.
 *
 * De dónde sale la imagen, en orden:
 *  1. **Con sesión y con logo propio** → `/api/empresas/logo?v=<idArchivoLogo>`. El `?v` viene de la
 *     sesión y cambia al cambiar el logo, así que la respuesta se puede cachear indefinidamente y a
 *     la vez el cambio se ve al instante. (Se pide al API y no a una URL prefirmada de R2 porque la
 *     prefirmada caduca a los 15 min y dejaría la marca rota en sesiones largas.)
 *  2. **Sin sesión** (el login) → `/api/empresas/logo` sin versión. El endpoint es público a
 *     propósito: si no, el login sería el único rincón que NUNCA se actualizaría. Como no hay
 *     versión, se cachea poco y revalida con ETag.
 *  3. **Con sesión pero sin logo propio** → el PNG EMPAQUETADO del repo, directo, sin pedir nada al
 *     servidor (es exactamente lo que respondería).
 *  4. Si una imagen NO carga, se intenta la siguiente; agotadas todas, se pinta `respaldo`.
 */
export function ImagenLogo({
  className,
  respaldo,
}: {
  className?: string;
  /** Qué pintar si NINGUNA imagen carga (p. ej. el cuadro con icono de la marca). */
  respaldo: React.ReactNode;
}): React.JSX.Element {
  // `useContext` directo (y no `useSesion`) a propósito: la marca también se pinta donde puede no
  // haber proveedor de sesión, y ahí debe caer al logo empaquetado en vez de lanzar.
  const contexto = useContext(ContextoSesion);
  const sesion = contexto?.sesion ?? null;
  const idArchivoLogo = sesion?.empresaActiva.idArchivoLogo ?? null;

  const candidatos: string[] =
    sesion === null
      ? // Login: la marca pública del servidor y, si no responde, la empaquetada.
        ['/api/empresas/logo', logoEmpaquetado]
      : idArchivoLogo === null
        ? [logoEmpaquetado]
        : [`/api/empresas/logo?v=${encodeURIComponent(idArchivoLogo)}`, logoEmpaquetado];

  const [fallidas, setFallidas] = useState<string[]>([]);
  const url = candidatos.find((candidata) => !fallidas.includes(candidata));

  if (url === undefined) {
    return <>{respaldo}</>;
  }
  return (
    <img
      src={url}
      alt=""
      data-testid="marca-logo"
      className={className}
      onError={() => setFallidas((previas) => [...previas, url])}
    />
  );
}
