import { CheckIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useCrearPendiente,
  useEditarPendiente,
  useEliminarPendiente,
  type PendienteLinea,
} from '@/api/listas-precios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * ⭐ V1-E8y (§Post-F9.152) — LOS PENDIENTES DE **ESTE MODELO** dentro de la lista.
 *
 * Daniel los quiso **por modelo, no por cita**: *«falta muestra de color»*, *«pedir precio de
 * jareta»* son de un modelo concreto, y una nota general de la junta los revolvería todos.
 *
 * 🔴 Es la **LIBRETA**, no la bitácora de la negociación: el texto **se corrige en la misma fila**
 * (lápiz → Enter guarda, Escape cancela), el pendiente se tacha y se puede borrar (lo borrado queda
 * íntegro en la bitácora del servidor). Lo que NO se toca es `NegociacionEvento.acuerdo`, que es
 * inmutable y vive en el historial del renglón.
 *
 * ⚠️ **No los frena que la lista esté cerrada ni que el modelo esté cerrado/dropeado** —lo decide
 * el servidor, aquí sólo se pinta—: tachar *"falta la muestra de color"* dos semanas después de
 * cerrar el modelo es exactamente para lo que sirven.
 *
 * Presentación pura (A1): el backend valida y decide.
 */
export function PendientesRenglon({
  idLinea,
  codigoModelo,
  pendientes,
  puedeEditar,
}: {
  idLinea: number;
  codigoModelo: string;
  /** Los pendientes vienen EMBEBIDOS en el renglón (no hay una segunda llamada por fila). */
  pendientes: PendienteLinea[];
  /** `listas.administrar` — sin él la libreta se lee, pero no se escribe. */
  puedeEditar: boolean;
}): React.JSX.Element {
  const crear = useCrearPendiente();
  const editar = useEditarPendiente();
  const eliminar = useEliminarPendiente();
  const ocupado = crear.isPending || editar.isPending || eliminar.isPending;

  const [texto, setTexto] = useState('');
  // ⭐ El EDITOR INLINE: qué pendiente se está corrigiendo y con qué texto. Se abre uno a la vez —
  // corregir un recado es un acto puntual, no una edición masiva.
  const [idEditando, setIdEditando] = useState<number | null>(null);
  const [textoEditado, setTextoEditado] = useState('');

  function agregar(): void {
    const limpio = texto.trim();
    if (limpio === '') return;
    crear.mutate(
      { idLinea, cuerpo: { texto: limpio } },
      {
        onSuccess: () => setTexto(''),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  function abrirEdicion(pendiente: PendienteLinea): void {
    setIdEditando(pendiente.id);
    setTextoEditado(pendiente.texto);
  }

  function cerrarEdicion(): void {
    setIdEditando(null);
    setTextoEditado('');
  }

  /**
   * Guarda el texto corregido. Si quedó vacío o igual que antes **no se llama al servidor**: un
   * `PATCH` que no cambia nada sólo ensucia la bitácora (mismo criterio que el dominio, que
   * devuelve el pendiente tal cual cuando no hay cambios).
   */
  function guardarEdicion(pendiente: PendienteLinea): void {
    const limpio = textoEditado.trim();
    if (limpio === '' || limpio === pendiente.texto) {
      cerrarEdicion();
      return;
    }
    editar.mutate(
      { idLinea, idPendiente: pendiente.id, cuerpo: { texto: limpio } },
      { onSuccess: cerrarEdicion, onError: (e) => toast.error(e.message) },
    );
  }

  function alternar(pendiente: PendienteLinea): void {
    editar.mutate(
      { idLinea, idPendiente: pendiente.id, cuerpo: { resuelto: !pendiente.resuelto } },
      { onError: (e) => toast.error(e.message) },
    );
  }

  function borrar(pendiente: PendienteLinea): void {
    eliminar.mutate(
      { idLinea, idPendiente: pendiente.id },
      {
        onSuccess: () => toast.success('Pendiente borrado (queda en la bitácora).'),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div className="space-y-2" data-testid="pendientes-renglon">
      <p className="text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">
        Pendientes de {codigoModelo}
      </p>

      {pendientes.length === 0 ? (
        <p className="text-[11.5px] text-muted-foreground" data-testid="sin-pendientes">
          Sin pendientes. Anota aquí lo que falte de este modelo («falta muestra de color», «pedir
          precio de la jareta»).
        </p>
      ) : (
        <ul className="space-y-1">
          {pendientes.map((p) => (
            <li key={p.id} className="flex items-center gap-2" data-testid="pendiente">
              {/* Casilla nativa, el mismo patrón que el resto del proyecto (no hay componente
                  `Checkbox` propio): `accent-primary` la pinta con el verde del tema. */}
              <input
                type="checkbox"
                className="size-4 shrink-0 rounded border-input accent-primary"
                checked={p.resuelto}
                disabled={!puedeEditar || ocupado}
                onChange={() => alternar(p)}
                aria-label={`${p.resuelto ? 'Reabrir' : 'Tachar'} pendiente: ${p.texto}`}
                data-testid="alternar-pendiente"
              />
              {idEditando === p.id ? (
                <>
                  <Input
                    autoFocus
                    value={textoEditado}
                    disabled={ocupado}
                    onChange={(e) => setTextoEditado(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter guarda, Escape cancela: se corrige a la carrera, sin ratón.
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        guardarEdicion(p);
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cerrarEdicion();
                      }
                    }}
                    className="h-7 flex-1"
                    aria-label={`Corregir pendiente: ${p.texto}`}
                    data-testid="editar-texto-pendiente"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={ocupado}
                    onClick={() => guardarEdicion(p)}
                    aria-label={`Guardar el pendiente corregido`}
                    data-testid="guardar-pendiente"
                  >
                    <CheckIcon className="size-3.5" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={ocupado}
                    onClick={cerrarEdicion}
                    aria-label="Cancelar la corrección"
                    data-testid="cancelar-pendiente"
                  >
                    <XIcon className="size-3.5" aria-hidden />
                  </Button>
                </>
              ) : (
                <>
                  <span
                    className={
                      p.resuelto
                        ? 'flex-1 text-[12.5px] text-muted-foreground line-through'
                        : 'flex-1 text-[12.5px]'
                    }
                    data-testid="texto-pendiente"
                    data-resuelto={p.resuelto}
                  >
                    {p.texto}
                  </span>
                  {puedeEditar ? (
                    <>
                      {/* ⭐ CORREGIR el texto: es una libreta, y en la cita se escribe a la carrera
                          («jareat»). El endpoint existía desde el primer día de la etapa y sin este
                          botón quedaba muerto — y el historial ya le prometía a Daniel que se
                          podían corregir. */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={ocupado}
                        onClick={() => abrirEdicion(p)}
                        aria-label={`Corregir pendiente: ${p.texto}`}
                        data-testid="corregir-pendiente"
                      >
                        <PencilIcon className="size-3.5" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={ocupado}
                        onClick={() => borrar(p)}
                        aria-label={`Borrar pendiente: ${p.texto}`}
                        data-testid="borrar-pendiente"
                      >
                        <Trash2Icon className="size-3.5" aria-hidden />
                      </Button>
                    </>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {puedeEditar ? (
        <div className="flex items-center gap-2">
          <Input
            value={texto}
            disabled={ocupado}
            placeholder="Qué falta de este modelo"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter agrega: en la cita se teclea a la carrera y no hay tiempo de buscar el botón.
              if (e.key === 'Enter') {
                e.preventDefault();
                agregar();
              }
            }}
            className="h-8"
            aria-label={`Nuevo pendiente para ${codigoModelo}`}
            data-testid="nuevo-pendiente"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={ocupado || texto.trim() === ''}
            onClick={agregar}
            data-testid="agregar-pendiente"
          >
            {crear.isPending ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <PlusIcon aria-hidden />
            )}
            Anotar
          </Button>
        </div>
      ) : null}
    </div>
  );
}
