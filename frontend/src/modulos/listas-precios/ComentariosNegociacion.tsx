import { Loader2Icon, MessageSquarePlusIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useComentariosLista, useComentarNegociacion } from '@/api/negociacion';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { SelectNativo } from '@/components/ui/native-select';
import { autorDeEvento, formatearFechaHora } from '@/lib/formato';
import { useSesion } from '@/sesion/useSesion';

import { puedeComentarNegociacion } from './permisos-negociacion';

/** Clases del textarea (mismo estilo que el resto de formularios). */
const CLASES_TEXTAREA =
  'w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30';

/**
 * ⭐⭐ Fila 0.238 (§Post-F9.248(b)) — LOS COMENTARIOS de la negociación de una lista.
 *
 * Daniel, sobre Aurora: *«las listas negociar **solo de lectura y poder agregar comentarios**, pero
 * no modificar lo que yo hice»*. Aquí se leen (con `listas.ver`, como el resto de la lista) y, con
 * `listas.comentar` o `listas.negociar`, se agrega uno —a la lista entera o a un modelo—.
 *
 * 🔴 Un comentario es un registro NUEVO e INMUTABLE: no edita el acuerdo de ninguna ronda ni toca
 * precios, estados, la mesa ni cotizaciones. Por eso aquí no hay lápiz ni bote de basura: si alguien
 * se equivoca, escribe otro. Los botones de negociar siguen gateados SÓLO con `listas.negociar`.
 *
 * Presentación pura (A1): el backend valida y decide.
 */
export function ComentariosNegociacion({
  idLista,
  lineas,
}: {
  idLista: number;
  /** Los modelos de la lista, para poder dirigir el comentario a uno. */
  lineas: readonly { id: number; codigoModelo: string }[];
}): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeComentar = puedeComentarNegociacion(tienePermiso);
  const comentarios = useComentariosLista(idLista);
  const comentar = useComentarNegociacion();

  const [texto, setTexto] = useState('');
  const [idLinea, setIdLinea] = useState('');

  function agregar(): void {
    const limpio = texto.trim();
    if (limpio === '') return;
    comentar.mutate(
      {
        idLista,
        cuerpo: { texto: limpio, idLinea: idLinea === '' ? null : Number(idLinea) },
      },
      {
        onSuccess: () => {
          setTexto('');
          setIdLinea('');
          toast.success('Comentario agregado');
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  const lista = comentarios.data ?? [];

  return (
    <section
      className="shrink-0 rounded-xl border bg-card px-4 py-3.5"
      data-testid="comentarios-negociacion"
    >
      <h4 className="text-[13px] font-semibold">Comentarios de la negociación</h4>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
        Notas sobre la negociación. No cambian precios, estados, acuerdos ni cotizaciones, y no se
        editan ni se borran.
      </p>

      <div className="mt-3 space-y-2">
        {comentarios.isPending ? (
          <p className="text-sm text-muted-foreground">Cargando comentarios…</p>
        ) : comentarios.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {comentarios.error.message}
          </p>
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="comentarios-vacio">
            Sin comentarios todavía.
          </p>
        ) : (
          <ul className="space-y-2">
            {lista.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border px-3 py-2"
                data-testid="comentario-negociacion"
              >
                <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground">
                  <b className="text-foreground">{autorDeEvento(c)}</b>
                  <span>{formatearFechaHora(c.registradoEn)}</span>
                  {c.codigoModelo === null ? null : (
                    <span className="rounded-md bg-secondary px-1.5 py-0.5 font-semibold">
                      {c.codigoModelo}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap">{c.texto}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {puedeComentar ? (
        <div className="mt-3 space-y-2 border-t pt-3" data-testid="nuevo-comentario">
          <Field>
            <FieldLabel htmlFor="comentario-texto">Agregar comentario</FieldLabel>
            <textarea
              id="comentario-texto"
              rows={2}
              className={CLASES_TEXTAREA}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              maxLength={2000}
              data-testid="comentario-texto"
            />
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <Field className="min-w-48 flex-1">
              <FieldLabel htmlFor="comentario-modelo">Sobre</FieldLabel>
              <SelectNativo
                id="comentario-modelo"
                value={idLinea}
                onChange={(e) => setIdLinea(e.target.value)}
                data-testid="comentario-modelo"
              >
                <option value="">Toda la lista</option>
                {lineas.map((ln) => (
                  <option key={ln.id} value={String(ln.id)}>
                    {ln.codigoModelo}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Button
              type="button"
              onClick={agregar}
              disabled={comentar.isPending || texto.trim() === ''}
              data-testid="agregar-comentario"
            >
              {comentar.isPending ? (
                <Loader2Icon className="animate-spin" aria-hidden />
              ) : (
                <MessageSquarePlusIcon aria-hidden />
              )}
              Agregar comentario
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
