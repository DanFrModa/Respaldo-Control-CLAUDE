import { CalculatorIcon, Loader2Icon, PlusIcon, SparklesIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useDesarrollo } from '@/api/desarrollos';
import { useAgregarLineasLista, type ModeloNuevoCreado } from '@/api/listas-precios';
import { Button } from '@/components/ui/button';
import { DialogoPrecosto } from '@/modulos/desarrollo/DialogoPrecosto';

/**
 * ⭐⭐ V1-E8y (§Post-F9.152) — LA TIRA DEL MODELO RECIÉN CREADO EN LA CITA.
 *
 * Cuando se da de alta un modelo desde la mesa, **todavía no puede entrar a la lista**: un renglón
 * necesita un precosto CONGELADO y el modelo acaba de nacer con el suyo en borrador. En vez de
 * dejar al usuario adivinando dónde quedó lo que acaba de crear, la mesa le enseña esta tira con
 * los dos actos que faltan, en orden:
 *
 *  1. **Costear** — abre el editor de precosto (el mismo de Desarrollo, sin duplicar nada) para
 *     teclear los estimados y CONGELAR.
 *  2. **Agregar a la lista** — cuando ya está congelado. Si todavía no lo está, el servidor
 *     responde con la frase exacta de qué falta (*"su precosto sigue en BORRADOR: congélalo"*), que
 *     es mejor guía que un botón apagado sin explicación.
 *
 * ⚠️ La tira **no bloquea nada**: se puede ocultar y seguir trabajando. El modelo no se pierde —
 * vive en su proyecto y sale en «Ya cotizados» en cuanto se congele su precosto.
 */
export function ModeloNuevoEnMesa({
  creado,
  idLista,
  alOcultar,
}: {
  creado: ModeloNuevoCreado;
  idLista: number;
  alOcultar: () => void;
}): React.JSX.Element {
  const desarrollo = useDesarrollo(creado.idDesarrollo);
  const agregar = useAgregarLineasLista();
  const [precostoAbierto, setPrecostoAbierto] = useState(false);

  function agregarALista(): void {
    agregar.mutate(
      { id: idLista, cuerpo: { idsDesarrollo: [creado.idDesarrollo] } },
      {
        onSuccess: () => {
          toast.success(`${creado.codigoModelo} agregado a la lista.`);
          alOcultar();
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary-soft px-3.5 py-2.5"
      role="status"
      data-testid="modelo-nuevo-en-mesa"
    >
      <SparklesIcon className="size-4 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1 text-[12.5px]">
        <b>{creado.codigoModelo}</b>
        {creado.descripcionModelo === null ? '' : ` · ${creado.descripcionModelo}`} creado en el
        proyecto <b>#{creado.folioProyecto}</b> {creado.nombreProyecto}
        {creado.copiadoDeCodigo === null
          ? ''
          : ` · copiado de ${creado.copiadoDeCodigo} (${String(creado.receta.telas)} tela(s), ${String(creado.receta.avios)} avío(s))`}
        . Ponle sus costos estimados y congélalos: entonces entra a la lista.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setPrecostoAbierto(true)}
        data-testid="costear-modelo-nuevo"
      >
        <CalculatorIcon aria-hidden />
        Costear
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={agregarALista}
        disabled={agregar.isPending}
        data-testid="agregar-modelo-nuevo-a-lista"
      >
        {agregar.isPending ? (
          <Loader2Icon className="animate-spin" aria-hidden />
        ) : (
          <PlusIcon aria-hidden />
        )}
        Agregar a la lista
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={alOcultar}
        aria-label="Ocultar el aviso del modelo nuevo"
        data-testid="ocultar-modelo-nuevo"
      >
        <XIcon aria-hidden />
      </Button>

      <DialogoPrecosto
        abierto={precostoAbierto}
        alCambiarAbierto={setPrecostoAbierto}
        desarrollo={desarrollo.data}
      />
    </div>
  );
}
