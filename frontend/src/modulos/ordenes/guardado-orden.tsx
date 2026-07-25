import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * GUARDADO ÚNICO del diálogo de una orden (petición de Daniel, 24-jul-2026): «al modificar una
 * orden debería haber un solo botón para guardar cuando haya alguna modificación, no un botón de
 * guardar por sección; y si la cierras sin haber guardado, que te pregunte».
 *
 * Cada sección editable del diálogo (encabezado, matriz, referencias) se REGISTRA aquí con:
 *  • si tiene cambios sin guardar (`sucio`) — de ahí sale el "hay cambios" del pie y del guardia
 *    de cierre;
 *  • un `preparar()` que CAPTURA su payload en el momento y devuelve el ejecutor que lo manda.
 *
 * Las dos fases (preparar todo → ejecutar todo) NO son un capricho: cada mutación invalida el
 * detalle de la orden y las secciones se re-inicializan con lo que llega del servidor. Si se
 * guardara sección por sección, la primera respuesta pisaría la captura pendiente de las demás.
 * Al capturar TODOS los payloads antes de mandar el primero, ninguna re-inicialización puede
 * comerse lo que el usuario escribió.
 *
 * El orden de guardado lo fija `SECCIONES_GUARDABLES` (encabezado → matriz → referencias): la
 * matriz deriva el estado 'completa' de la orden, así que va después del encabezado.
 */

/** Secciones guardables del diálogo, EN EL ORDEN en que se guardan. */
export const SECCIONES_GUARDABLES = ['encabezado', 'matriz', 'referencias'] as const;

/** Clave de una sección guardable. */
export type ClaveSeccionGuardable = (typeof SECCIONES_GUARDABLES)[number];

/** Manda al servidor un payload ya capturado. Rechaza si el guardado falla. */
export type EjecutorGuardado = () => Promise<void>;

/**
 * Captura el payload de la sección AHORA y devuelve el ejecutor que lo manda. Devuelve `null` si
 * la captura es inválida (la sección ya avisó al usuario) → el guardado completo se aborta.
 */
export type PrepararGuardado = () => Promise<EjecutorGuardado | null>;

/** Lo que el diálogo sabe de cada sección registrada (parte reactiva). */
interface EstadoSeccion {
  /** Nombre legible para los mensajes ("el encabezado", "la matriz"…). */
  etiqueta: string;
  /** ¿Tiene cambios sin guardar? */
  sucio: boolean;
}

interface ValorContexto {
  registrar: (
    clave: ClaveSeccionGuardable,
    etiqueta: string,
    sucio: boolean,
    preparar: React.RefObject<PrepararGuardado>,
  ) => void;
  quitar: (clave: ClaveSeccionGuardable) => void;
  /** Ver `useReinicioBloqueado`. */
  reinicioBloqueado: boolean;
}

const ContextoGuardadoOrden = createContext<ValorContexto | null>(null);

/**
 * Proveedor del contexto para envolver el detalle de la orden.
 *
 * ⚠️ Es el `Provider` TAL CUAL, a propósito: un componente de identidad ESTABLE. Si en su lugar se
 * devolviera un wrapper creado con `useCallback`, cada cambio del valor del contexto (p. ej. al
 * empezar a guardar) cambiaría el TIPO del componente y React **remontaría todo el detalle**,
 * tirando lo que el usuario tuviera capturado. Ya pasó una vez; no repetirlo.
 */
export const ProveedorGuardadoOrden = ContextoGuardadoOrden.Provider;

/**
 * ¿La sección debe DEJAR DE re-inicializarse con lo que llega del servidor?
 *
 * Las secciones se reinician cuando cambia `orden.modificadoEn`. Durante un guardado múltiple eso
 * es una trampa: guardar el encabezado invalida el detalle, la orden se refresca y la matriz/las
 * referencias se reinicializarían **tirando lo que el usuario acababa de teclear** — y si el
 * guardado de la matriz falla después, ya no hay nada que reintentar: habría que recapturar.
 *
 * Por eso el reinicio se bloquea mientras dura el guardado Y mientras el último guardado haya
 * quedado FALLIDO: la pantalla conserva exactamente lo capturado para que "Guardar" lo reintente.
 * El bloqueo se levanta al terminar bien un guardado (ahí el servidor sí manda) o al arrancar el
 * siguiente intento.
 */
export function useReinicioBloqueado(): boolean {
  return useContext(ContextoGuardadoOrden)?.reinicioBloqueado ?? false;
}

/**
 * Registra una sección editable en el guardado único del diálogo. Fuera del diálogo (si la
 * sección se usara suelta) el contexto no existe y el hook no hace nada.
 *
 * @param clave    Sección (fija el orden de guardado).
 * @param etiqueta Nombre legible para los mensajes de error.
 * @param sucio    `true` si hay cambios sin guardar.
 * @param preparar Captura el payload y devuelve el ejecutor (o `null` si la captura es inválida).
 */
export function useSeccionGuardable(
  clave: ClaveSeccionGuardable,
  etiqueta: string,
  sucio: boolean,
  preparar: PrepararGuardado,
): void {
  const contexto = useContext(ContextoGuardadoOrden);
  const refPreparar = useRef<PrepararGuardado>(preparar);

  // Se refresca DESPUÉS de cada render (nunca durante): el ejecutor siempre lee el estado vigente
  // de la sección sin que el registro tenga que volver a correr.
  useEffect(() => {
    refPreparar.current = preparar;
  });

  const registrar = contexto?.registrar;
  const quitar = contexto?.quitar;
  useEffect(() => {
    if (registrar === undefined || quitar === undefined) {
      return;
    }
    registrar(clave, etiqueta, sucio, refPreparar);
    return () => quitar(clave);
  }, [registrar, quitar, clave, etiqueta, sucio]);
}

/** Lo que el diálogo obtiene del registro de secciones. */
export interface RegistroGuardado {
  /** Valor a pasarle a `<ProveedorGuardadoOrden value={…}>` alrededor del detalle. */
  valorContexto: ValorContexto;
  /** ¿Alguna sección tiene cambios sin guardar? */
  hayCambios: boolean;
  /** ¿Hay un guardado en curso? */
  guardando: boolean;
  /**
   * Guarda TODO lo pendiente (preparar todo → ejecutar en orden). `ok: false` = algo falló o una
   * captura era inválida (el llamador NO debe cerrar el diálogo). `error` trae el mensaje a
   * mostrar (ausente cuando la propia sección ya avisó de su captura inválida).
   */
  guardarTodo: () => Promise<{ ok: boolean; error?: string }>;
}

/** Mensaje legible de un error de guardado. */
function mensajeDeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Error inesperado.';
}

/**
 * Registro de secciones guardables del diálogo de la orden: entrega el proveedor de contexto, la
 * bandera "hay cambios" y el `guardarTodo` del botón único.
 *
 * @param idOrden Orden que se está editando. Sirve para OLVIDAR el "último guardado fallido" al
 *   pasar a otra orden: hoy el diálogo se desmonta al cerrarse, pero si algún día se reusara vivo,
 *   el bloqueo de reinicio de una orden no debe arrastrarse a la siguiente.
 */
export function useRegistroGuardadoOrden(idOrden?: number | null): RegistroGuardado {
  const [estados, setEstados] = useState<Partial<Record<ClaveSeccionGuardable, EstadoSeccion>>>({});
  const [guardando, setGuardando] = useState(false);
  // El último guardado quedó a medias: la pantalla debe CONSERVAR lo capturado (ver
  // `useReinicioBloqueado`) hasta que un guardado termine bien.
  const [ultimoFallido, setUltimoFallido] = useState(false);
  // Los `preparar` viven en un ref (cambian en cada render): fuera del estado no provocan renders.
  const preparadores = useRef(new Map<ClaveSeccionGuardable, React.RefObject<PrepararGuardado>>());
  // Candado SÍNCRONO contra el doble clic: `setGuardando` no surte efecto hasta el siguiente
  // render, así que dos clics seguidos podrían disparar dos rondas de guardado.
  const enCurso = useRef(false);

  const registrar = useCallback<ValorContexto['registrar']>((clave, etiqueta, sucio, preparar) => {
    preparadores.current.set(clave, preparar);
    setEstados((previo) => {
      const actual = previo[clave];
      if (actual !== undefined && actual.etiqueta === etiqueta && actual.sucio === sucio) {
        return previo; // Sin cambio real: no se re-renderiza (evita el bucle registrar→render).
      }
      return { ...previo, [clave]: { etiqueta, sucio } };
    });
  }, []);

  const quitar = useCallback<ValorContexto['quitar']>((clave) => {
    preparadores.current.delete(clave);
    setEstados((previo) => {
      if (previo[clave] === undefined) {
        return previo;
      }
      const copia = { ...previo };
      delete copia[clave];
      return copia;
    });
  }, []);

  // Al cambiar de orden se olvida el fallo de la anterior (su captura ya no está en pantalla).
  useEffect(() => {
    setUltimoFallido(false);
  }, [idOrden]);

  const reinicioBloqueado = guardando || ultimoFallido;
  const valorContexto = useMemo<ValorContexto>(
    () => ({ registrar, quitar, reinicioBloqueado }),
    [registrar, quitar, reinicioBloqueado],
  );

  const hayCambios = SECCIONES_GUARDABLES.some((clave) => estados[clave]?.sucio === true);

  const guardarTodo = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (enCurso.current) {
      return { ok: false }; // Doble clic: la ronda que ya corre es la buena.
    }
    // El candado y el "guardando" se ponen ANTES de la fase 1: mientras se capturan los payloads
    // el botón ya está deshabilitado y las secciones dejan de re-inicializarse.
    enCurso.current = true;
    setGuardando(true);
    setUltimoFallido(false);

    let resultado: { ok: boolean; error?: string } = { ok: true };
    try {
      // FASE 1 — capturar los payloads de TODAS las secciones sucias, antes de mandar nada. Va en
      // su propio try: si un `preparar` REVENTARA (no debería), se trata como un fallo normal —con
      // su aviso y su bloqueo de reinicio— en vez de escaparse como rechazo sin manejar.
      const pendientes: { etiqueta: string; ejecutar: EjecutorGuardado }[] = [];
      try {
        for (const clave of SECCIONES_GUARDABLES) {
          const estado = estados[clave];
          if (estado?.sucio !== true) {
            continue;
          }
          const preparar = preparadores.current.get(clave)?.current;
          if (preparar === undefined) {
            continue;
          }
          const ejecutar = await preparar();
          if (ejecutar === null) {
            // Captura inválida: la sección ya marcó sus errores; no se manda NADA.
            return (resultado = { ok: false });
          }
          pendientes.push({ etiqueta: estado.etiqueta, ejecutar });
        }
      } catch (error) {
        return (resultado = {
          ok: false,
          error: `No se pudieron preparar los cambios: ${mensajeDeError(error)}`,
        });
      }

      // FASE 2 — mandarlos en orden. Si uno falla se corta ahí y se dice QUÉ sí quedó guardado (el
      // diálogo NO se cierra ni finge que todo salió bien).
      const guardadas: string[] = [];
      for (const pendiente of pendientes) {
        try {
          await pendiente.ejecutar();
        } catch (error) {
          const yaGuardado = guardadas.length > 0 ? ` Sí se guardó: ${guardadas.join(', ')}.` : '';
          return (resultado = {
            ok: false,
            error: `No se pudo guardar ${pendiente.etiqueta}: ${mensajeDeError(error)}${yaGuardado}`,
          });
        }
        guardadas.push(pendiente.etiqueta);
      }
      return (resultado = { ok: true });
    } finally {
      enCurso.current = false;
      setGuardando(false);
      // Solo un guardado COMPLETO devuelve el mando al servidor; si quedó a medias, la pantalla
      // sigue conservando lo capturado para que el usuario reintente sin recapturar.
      setUltimoFallido(!resultado.ok);
    }
  }, [estados]);

  return { valorContexto, hayCambios, guardando, guardarTodo };
}
