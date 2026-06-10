import { useEffect, useState } from 'react';

import { AlternadorTema } from './AlternadorTema.tsx';

/**
 * Forma de la respuesta de GET /api/health del backend.
 *
 * En E1 se declara aqui a mano. En E4 este tipo (y el resto del cliente del
 * API) se generara automaticamente desde el contrato OpenAPI del backend.
 */
interface RespuestaSalud {
  estado: string;
  servicio: string;
  hora: string;
}

/** Estado de la consulta de salud al backend. */
type EstadoSalud =
  | { fase: 'cargando' }
  | { fase: 'ok'; datos: RespuestaSalud }
  | { fase: 'error'; mensaje: string };

/**
 * Pantalla inicial de CONTROL v2.
 *
 * Hace un fetch a `/api/health` y muestra el resultado. Sirve como prueba de
 * extremo a extremo del esqueleto: en produccion la peticion viaja
 * navegador -> nginx -> backend por la red interna del compose; en desarrollo
 * viaja por el proxy de Vite. Si se ve "ok", el cableado funciona.
 */
export function App(): React.JSX.Element {
  const [estado, setEstado] = useState<EstadoSalud>({ fase: 'cargando' });

  useEffect(() => {
    const controlador = new AbortController();

    async function consultarSalud(): Promise<void> {
      try {
        const respuesta = await fetch('/api/health', { signal: controlador.signal });
        if (!respuesta.ok) {
          throw new Error(`El backend respondio ${respuesta.status}`);
        }
        const datos = (await respuesta.json()) as RespuestaSalud;
        setEstado({ fase: 'ok', datos });
      } catch (error) {
        if (controlador.signal.aborted) {
          return;
        }
        const mensaje = error instanceof Error ? error.message : 'Error desconocido';
        setEstado({ fase: 'error', mensaje });
      }
    }

    void consultarSalud();
    return () => {
      controlador.abort();
    };
  }, []);

  return (
    <div className="pagina">
      <header className="cabecera">
        <AlternadorTema />
      </header>

      <main className="contenedor">
        <h1>CONTROL v2</h1>
        <p className="subtitulo">ERP textil Marilyn / MJD &mdash; Fundacion (F0)</p>

        <section className="tarjeta" aria-live="polite">
          <h2>Estado del backend</h2>
          <BloqueEstado estado={estado} />
        </section>
      </main>
    </div>
  );
}

/** Renderiza el detalle del estado de salud segun la fase. */
function BloqueEstado({ estado }: { estado: EstadoSalud }): React.JSX.Element {
  switch (estado.fase) {
    case 'cargando':
      return <p className="estado estado--cargando">Consultando&hellip;</p>;
    case 'error':
      return (
        <div>
          <p className="estado estado--error">Sin conexion con el backend</p>
          <p className="detalle">{estado.mensaje}</p>
        </div>
      );
    case 'ok':
      return (
        <div>
          <p className="estado estado--ok">
            {estado.datos.estado} &middot; {estado.datos.servicio}
          </p>
          <p className="detalle">Hora del servidor: {estado.datos.hora}</p>
        </div>
      );
  }
}
