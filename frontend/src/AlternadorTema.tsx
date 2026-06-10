import { useTema } from './useTema.ts';

/**
 * Boton para alternar entre tema claro y oscuro.
 *
 * Se ubica arriba (esquina superior derecha) de la pagina. Es accesible: tiene
 * `aria-label` en espanol que describe la accion que ocurrira al pulsarlo, y un
 * icono (sol/luna) que refleja a que tema se cambiara. El sistema de tema
 * subyacente (clase `dark` en `<html>` + variables CSS) es compatible con
 * shadcn/ui para que E4 lo herede sin refactor.
 */
export function AlternadorTema(): React.JSX.Element {
  const { tema, alternar } = useTema();
  const vaAOscuro = tema === 'claro';
  const etiqueta = vaAOscuro ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro';

  return (
    <button
      type="button"
      className="alternador-tema"
      onClick={alternar}
      aria-label={etiqueta}
      title={etiqueta}
    >
      {vaAOscuro ? <IconoLuna /> : <IconoSol />}
    </button>
  );
}

/** Icono de luna (se muestra en tema claro: pulsar lleva a oscuro). */
function IconoLuna(): React.JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/** Icono de sol (se muestra en tema oscuro: pulsar lleva a claro). */
function IconoSol(): React.JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}
