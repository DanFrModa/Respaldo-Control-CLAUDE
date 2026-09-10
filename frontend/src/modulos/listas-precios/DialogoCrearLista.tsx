import { Loader2Icon, PercentIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useDepartamentosCliente } from '@/api/clientes';
import { useCandidatosLista, useCrearLista, type DescartadoLista } from '@/api/listas-precios';
import { FiltroCliente } from '@/components/dominio/FiltroCliente';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { formatearMoneda } from '@/lib/formato';
import {
  estadoDeepLinkFactores,
  puedeCapturarFactoresDePrecio,
  RUTA_FICHA_CLIENTE,
} from '@/modulos/clientes/factores-precio';
import { useSesion } from '@/sesion/useSesion';

import { agruparDescartados, etiquetaDescartado } from './motivos-candidatura';
import { puedeIrAPrecosteos, RUTA_PRECOSTEOS } from './puerta-precosteos';

/**
 * Contexto de un PROYECTO desde el que se genera la lista (Daniel, ago-2026): fija cliente +
 * departamento
 * (ya se conocen) y acota los candidatos a ESE proyecto.
 */
export interface ContextoProyectoLista {
  id: number;
  folio: number;
  nombre: string;
  idCliente: number;
  cliente: string;
  idClienteDepartamento: number;
  departamento: string;
}

/**
 * Diálogo para CREAR una lista de precios (F8-E4): elige cliente + departamento → carga los desarrollos
 * CANDIDATOS (cotizados, sin renglón en otra lista) → seleccionar → crear. Los candidatos sin precosto
 * congelado no aparecen; si el backend rechaza alguno (carrera), su mensaje se muestra en un toast.
 *
 * Con `proyecto` (Daniel, ago-2026) el diálogo llega PRECARGADO desde la página del proyecto:
 * cliente y
 * departamento fijos (los selectores quedan deshabilitados) y candidatos SÓLO de ese proyecto.
 */
export function DialogoCrearLista({
  abierto,
  alCambiarAbierto,
  alCreada,
  proyecto,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  alCreada?: (idLista: number) => void;
  /** Proyecto de origen: precarga cliente/departamento y acota los candidatos (opcional). */
  proyecto?: ContextoProyectoLista | undefined;
}): React.JSX.Element {
  const navegar = useNavigate();
  const { tienePermiso } = useSesion();
  const [idCliente, setIdCliente] = useState('');
  // El NOMBRE del cliente elegido: los avisos hablan de "C&A / Damas", no de "#42". Un aviso que
  // enseña un id crudo obliga a la persona a traducir lo que el sistema ya sabe.
  const [nombreCliente, setNombreCliente] = useState('');
  const [idDepartamento, setIdDepartamento] = useState('');
  const [fecha, setFecha] = useState('');
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());

  const departamentos = useDepartamentosCliente(idCliente === '' ? undefined : Number(idCliente));
  const candidatos = useCandidatosLista(
    idCliente === '' ? undefined : Number(idCliente),
    idDepartamento === '' ? undefined : Number(idDepartamento),
    proyecto?.id,
  );
  const crear = useCrearLista();

  // Reinicia al cerrar; al abrir DESDE UN PROYECTO precarga su cliente + departamento.
  useEffect(() => {
    if (!abierto) {
      setIdCliente('');
      setNombreCliente('');
      setIdDepartamento('');
      setFecha('');
      setSeleccion(new Set());
      return;
    }
    if (proyecto !== undefined) {
      setIdCliente(String(proyecto.idCliente));
      setNombreCliente(proyecto.cliente);
      setIdDepartamento(String(proyecto.idClienteDepartamento));
    }
  }, [abierto, proyecto]);

  // Al cambiar cliente/departamento, limpia la selección (los candidatos cambian).
  function cambiarCliente(valor: string, nombre: string): void {
    setIdCliente(valor);
    setNombreCliente(nombre);
    setIdDepartamento('');
    setSeleccion(new Set());
  }
  function cambiarDepartamento(valor: string): void {
    setIdDepartamento(valor);
    setSeleccion(new Set());
  }

  function alternar(idDesarrollo: number): void {
    setSeleccion((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(idDesarrollo)) {
        siguiente.delete(idDesarrollo);
      } else {
        siguiente.add(idDesarrollo);
      }
      return siguiente;
    });
  }

  const listaCandidatos = candidatos.data?.datos ?? [];
  const descartados = candidatos.data?.descartados ?? [];
  // ⭐ V1-E8t (§Post-F9.145) — el SEGUNDO requisito de la lista, dicho ANTES de apretar el botón.
  // Lo contesta el servidor con la MISMA función que después bloquea (`buscarFactoresResueltos`):
  // aquí no se re-implementa la cascada override→default, sólo se pinta lo que el dominio dictó.
  // Mientras la consulta carga vale `false`: no se acusa de faltar algo que todavía no se preguntó.
  const faltanFactores = candidatos.data?.faltanFactores ?? false;
  const nombreDepartamento =
    proyecto?.departamento ??
    (departamentos.data ?? []).find((d) => String(d.id) === idDepartamento)?.nombre ??
    '';

  function crearLista(): void {
    if (idCliente === '' || idDepartamento === '' || seleccion.size === 0) {
      return;
    }
    crear.mutate(
      {
        idCliente: Number(idCliente),
        idClienteDepartamento: Number(idDepartamento),
        idsDesarrollo: [...seleccion],
        ...(fecha === '' ? {} : { fecha }),
      },
      {
        onSuccess: (lista) => {
          toast.success(`Lista #${String(lista.folio)} creada.`);
          alCambiarAbierto(false);
          alCreada?.(lista.id);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva lista de precios</DialogTitle>
          <DialogDescription>
            {proyecto === undefined
              ? 'Elige el cliente y el departamento — no un proyecto: una lista se arma por CLIENTE + DEPARTAMENTO, y puede juntar modelos de varios proyectos. Se listan los desarrollos cotizados que aún no están en una lista.'
              : `Del proyecto #${String(proyecto.folio)} · ${proyecto.nombre} (${proyecto.cliente} / ${proyecto.departamento}): se listan sus modelos cotizados que aún no están en una lista.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto py-2">
          {/* Desde un PROYECTO el cliente y el departamento ya se conocen: se muestran fijos (no
              hay nada que elegir ni forma de equivocarse). Desde Listas de precios, se eligen. */}
          {proyecto === undefined ? (
            <>
              <Field>
                <FieldLabel htmlFor="crear-lista-cliente">Cliente</FieldLabel>
                {/* V1-E4 (punto 7): búsqueda server-side; el <select> se llenaba con la primera
                    página del catálogo (100) y con ~117 clientes había inalcanzables. */}
                <FiltroCliente
                  idCliente={idCliente === '' ? null : Number(idCliente)}
                  alCambiar={(c) => cambiarCliente(c === null ? '' : String(c.id), c?.nombre ?? '')}
                  etiqueta="Cliente"
                  placeholder="Elige un cliente…"
                  idInput="crear-lista-cliente"
                  testid="crear-lista-cliente"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="crear-lista-departamento">Departamento</FieldLabel>
                <SelectNativo
                  id="crear-lista-departamento"
                  value={idDepartamento}
                  disabled={idCliente === ''}
                  onChange={(e) => cambiarDepartamento(e.target.value)}
                >
                  <option value="">Elige un departamento…</option>
                  {(departamentos.data ?? [])
                    .filter((d) => d.activo)
                    .map((d) => (
                      <option key={d.id} value={String(d.id)}>
                        {d.nombre}
                      </option>
                    ))}
                </SelectNativo>
              </Field>
            </>
          ) : (
            <p
              className="rounded-lg border bg-muted/30 px-3 py-2 text-sm"
              data-testid="crear-lista-contexto-proyecto"
            >
              Cliente <span className="font-semibold">{proyecto.cliente}</span>
              <span className="text-muted-foreground"> / {proyecto.departamento}</span>
            </p>
          )}

          <Field>
            <FieldLabel htmlFor="crear-lista-fecha">Fecha (opcional)</FieldLabel>
            <Input
              id="crear-lista-fecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </Field>

          {idDepartamento !== '' && faltanFactores ? (
            <AvisoFactoresFaltantes
              cliente={nombreCliente}
              departamento={nombreDepartamento}
              puedeCapturar={puedeCapturarFactoresDePrecio(tienePermiso)}
              alCapturarFactores={() => {
                alCambiarAbierto(false);
                // Al LUGAR EXACTO: la ficha de ESTE cliente, con su sección de factores a la vista
                // (no el catálogo de clientes a que lo busque de nuevo).
                void navegar(RUTA_FICHA_CLIENTE, {
                  state: estadoDeepLinkFactores(Number(idCliente)),
                });
              }}
            />
          ) : null}

          {idDepartamento !== '' ? (
            <div data-testid="candidatos-lista">
              <p className="mb-1 text-sm font-medium">Desarrollos a incluir</p>
              {candidatos.isPending ? (
                <p className="text-sm text-muted-foreground">Cargando desarrollos…</p>
              ) : listaCandidatos.length === 0 ? (
                <SinCandidatos
                  descartados={descartados}
                  desdeProyecto={proyecto !== undefined}
                  puedeIrAPrecosteos={puedeIrAPrecosteos(tienePermiso)}
                  alIrAPrecosteos={() => {
                    alCambiarAbierto(false);
                    void navegar(RUTA_PRECOSTEOS);
                  }}
                />
              ) : (
                <ul className="space-y-1.5">
                  {listaCandidatos.map((c) => (
                    <li
                      key={c.idDesarrollo}
                      className="flex items-center gap-2 rounded-lg border p-2"
                      data-testid="fila-candidato"
                    >
                      <input
                        type="checkbox"
                        id={`cand-${String(c.idDesarrollo)}`}
                        checked={seleccion.has(c.idDesarrollo)}
                        onChange={() => alternar(c.idDesarrollo)}
                        className="size-4"
                      />
                      <label htmlFor={`cand-${String(c.idDesarrollo)}`} className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {c.codigoModelo}
                          {c.numeroCliente ? ` · ${c.numeroCliente}` : ''}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Proyecto #{c.folioProyecto} · v{c.versionPrecosto}
                          {c.costoTotal !== null ? ` · costo ${formatearMoneda(c.costoTotal)}` : ''}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={crear.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={crearLista}
            // Sin factores el servidor RECHAZA la creación (`resolverFactores`): el botón se
            // apaga para no ofrecer un clic que sólo devuelve un error (§Post-F9.68 al revés:
            // aquí se niega en el servidor Y se explica en la pantalla, con su puerta).
            disabled={crear.isPending || seleccion.size === 0 || faltanFactores}
            data-testid="confirmar-crear-lista"
          >
            {crear.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Crear lista ({seleccion.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * ⭐ V1-E8f (§Post-F9.128) — EL AVISO QUE SÍ SIRVE. Antes, cuando no había candidatos, aquí se leía
 * *"No hay desarrollos cotizados disponibles para este departamento."* y punto: Daniel se quedó ahí,
 * sin saber que a su modelo sólo le faltaba CONGELAR el precosto. Ahora el servidor manda cada modelo
 * descartado con su motivo, y esto los agrupa, los NOMBRA y dice el siguiente paso — con una puerta a
 * Pre-costeos, que es donde se arregla (§Post-F9.96: capturar es el proceso normal; el aviso sólo si
 * de verdad no se puede, y diciendo por qué).
 *
 * ⭐ **V1-E8t (§Post-F9.145): esa puerta ahora se MIDE.** Se pinta sólo si quien la ve puede entrar a
 * Pre-costeos (`puedeIrAPrecosteos`, que lo decide en un solo lugar para las tres apariciones del
 * aviso). Sin el permiso, el texto —qué le falta a cada modelo y qué acto lo arregla— **se conserva
 * entero**: lo que se quita es el clic que terminaría en un muro, no la explicación.
 */
function SinCandidatos({
  descartados,
  desdeProyecto,
  puedeIrAPrecosteos: puedeIr,
  alIrAPrecosteos,
}: {
  descartados: readonly DescartadoLista[];
  desdeProyecto: boolean;
  /** ⭐ V1-E8t: ¿este usuario puede ENTRAR a Pre-costeos? (`puerta-precosteos.ts`). */
  puedeIrAPrecosteos: boolean;
  alIrAPrecosteos: () => void;
}): React.JSX.Element {
  const donde = desdeProyecto ? 'Este proyecto' : 'Este cliente y departamento';

  // Sin NI UN modelo: no hay nada que explicar modelo por modelo — falta capturar antes.
  if (descartados.length === 0) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed p-3" data-testid="candidatos-vacio">
        <p className="text-sm text-muted-foreground">
          {donde} todavía no tiene modelos en desarrollo. Una lista de precios se arma con modelos
          que ya tienen su <b>precosto congelado</b>: captúralos en <b>Pre-costeos</b> y congela la
          versión.
        </p>
        {puedeIr ? (
          <Button type="button" variant="outline" size="sm" onClick={alIrAPrecosteos}>
            Ir a Pre-costeos
          </Button>
        ) : null}
      </div>
    );
  }

  const grupos = agruparDescartados(descartados);
  const hayQueArreglar = grupos.some(
    (g) => g.motivo === 'precosto-borrador' || g.motivo === 'sin-precosto',
  );

  return (
    <div className="space-y-2.5 rounded-lg border border-dashed p-3" data-testid="candidatos-vacio">
      <p className="text-sm">
        Ningún modelo de {desdeProyecto ? 'este proyecto' : 'este cliente y departamento'} puede
        entrar a una lista ahora mismo. Esto es lo que le falta a cada uno:
      </p>
      {grupos.map((g) => (
        <div key={g.motivo} data-testid={`motivo-${g.motivo}`}>
          <p className="text-sm font-medium">
            {g.titulo} ({g.modelos.length})
          </p>
          <ul className="mt-0.5 ml-4 list-disc text-sm text-muted-foreground">
            {g.modelos.map((d) => (
              <li key={d.idDesarrollo}>
                {etiquetaDescartado(d)}
                <span className="text-faint"> · proyecto #{d.folioProyecto}</span>
              </li>
            ))}
          </ul>
          <p className="mt-0.5 text-xs text-muted-foreground">{g.remedio}</p>
        </div>
      ))}
      {hayQueArreglar && puedeIr ? (
        <Button type="button" variant="outline" size="sm" onClick={alIrAPrecosteos}>
          Ir a Pre-costeos
        </Button>
      ) : null}
    </div>
  );
}

/**
 * ⭐⭐ **V1-E8t (§Post-F9.145) — EL AVISO DE LOS FACTORES, AHORA CON PUERTA.** Daniel, 29-ago-2026,
 * al intentar armar una lista y recibir *"Este cliente/departamento no tiene factores de precio
 * capturados… Los captura el DUEÑO (quien aprueba precios) desde la ficha del cliente"*:
 *
 * > *«estaría bueno desde ahí poder acceder al botón donde necesito llenar los datos»*
 *
 * **Y él ES el dueño**: el aviso le nombraba a la persona que estaba leyéndolo y la mandaba a
 * buscar una pantalla a mano. En este MISMO diálogo, dos secciones abajo, `SinCandidatos` ya
 * llevaba su botón «Ir a Pre-costeos» desde V1-E8f — dos avisos hermanos con dos criterios
 * distintos.
 *
 * Tres cosas que este aviso hace y el toast del servidor no podía hacer:
 *  • **Llega ANTES**, en cuanto se elige el departamento — no después de llenar la selección y
 *    apretar «Crear lista» para que un 400 tire el trabajo (§Post-F9.96: capturar es el proceso
 *    normal; el aviso es la consecuencia, y se dice donde se va a avanzar).
 *  • **Nombra al cliente y al departamento** con su nombre, no con su id.
 *  • **Lleva al lugar exacto**: la ficha de ESE cliente con su sección de factores a la vista.
 *
 * 🔴 **Y la puerta se pinta SÓLO a quien puede cruzarla** (`puedeCapturarFactoresDePrecio`). A
 * quien no —los factores son facultad del dueño, §Post-F9.125— se le dice **a quién pedírselo**,
 * que es lo único accionable que le queda: un botón que termina en 403 es peor que no tener botón.
 */
function AvisoFactoresFaltantes({
  cliente,
  departamento,
  puedeCapturar,
  alCapturarFactores,
}: {
  cliente: string;
  departamento: string;
  puedeCapturar: boolean;
  alCapturarFactores: () => void;
}): React.JSX.Element {
  const quien =
    cliente === ''
      ? 'Este cliente y departamento'
      : departamento === ''
        ? cliente
        : `${cliente} / ${departamento}`;
  return (
    <div
      className="space-y-2 rounded-lg border border-warn/40 bg-warn-soft p-3"
      role="status"
      data-testid="aviso-faltan-factores"
    >
      <p className="flex items-start gap-1.5 text-sm">
        <PercentIcon className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <span>
          <b>{quien}</b> todavía no tiene sus <b>factores de precio</b> (margen · descuentos ·
          regalías · costo de ventas). Con ellos se calcula el precio de cada modelo, así que sin
          capturarlos la lista no se puede armar.
        </span>
      </p>
      {puedeCapturar ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={alCapturarFactores}
          data-testid="ir-a-capturar-factores"
        >
          Capturar factores
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Los captura el <b>dueño</b> (quien aprueba precios) en la ficha del cliente: pídeselos y
          vuelve a esta pantalla.
        </p>
      )}
    </div>
  );
}
