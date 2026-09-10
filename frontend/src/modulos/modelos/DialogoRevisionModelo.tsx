import { CheckIcon, Loader2Icon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  useAprobarRevisionModelo,
  useMetaPrometida,
  useRechazarRevisionModelo,
  type DesenlaceMeta,
  type Modelo,
} from '@/api/modelos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { formatearMoneda } from '@/lib/formato';

/**
 * ⭐ V1-E7d — LA REVISIÓN DE LA RECETA NEGOCIADA (§Post-F9.110). Este diálogo es donde alguien con
 * «Aprobar receta» firma esa revisión —o la devuelve con observaciones—.
 *
 * Daniel: *"después de la negociación con el cliente, debe de haber una revisión antes de mandar a
 * producir. Porque luego en la negociación enfrente del cliente puede ser que se cometa una
 * imprudencia o un error"*.
 *
 * 🔴🔴 **V1-E9c (§Post-F9.169) — LO QUE ESTE DIÁLOGO DICE ES PARTE DE LA REGLA, NO ADORNO.** Daniel
 * disolvió la compuerta: *«Todo lo que no está firmado simplemente no se puede comprar. **Pero no
 * detiene ni la producción** ni los demás renglones ya firmados.»* Hasta esa decisión, el texto de
 * abajo prometía —con todas sus letras— que rechazar impedía producir y que aprobar *"deja la
 * versión lista para mandarse a producir"*. **Las dos frases ya son falsas**, y son las que la
 * persona lee **en el segundo en que decide**.
 *
 * 🔑 **Por qué esto es un defecto y no una imprecisión.** Quien revisa rechaza *confiando* en que
 * eso frena algo; la OP se genera igual esa misma tarde (lo prueba
 * `produccion/salida-produccion.test.ts`: *"una versión RECHAZADA también genera su OP"*). Un texto
 * que promete un freno que no existe es peor que no decir nada: sustituye una decisión real —ir a
 * frenar el gasto en la receta de la ORDEN, renglón por renglón— por una falsa sensación de haberla
 * tomado. Es la misma mentira que obligó a renombrar `revisionBloqueaProduccion`, sólo que aquí la
 * lee un usuario y no un programador.
 *
 * ⚠️ **Esta copia está aseverada palabra por palabra en `DialogoRevisionModelo.test.tsx`.** No es
 * celo: no había NINGUNA prueba sobre ella, y por eso pudo quedarse mintiendo veinte líneas debajo
 * de los toasts que sí se actualizaron.
 *
 * `aprobar` lleva nota OPCIONAL; `rechazar` exige MOTIVO (el backend lo vuelve a exigir).
 *
 * ⭐⭐ **V1-E9p (§Post-F9.144(b)) — Y AL APROBAR SE CONTESTA LA OTRA PREGUNTA: «¿se logró lo
 * prometido?»**. Daniel: *«me quitan un cierre y yo le pongo que estimo que la maquila costará 5
 * pesos menos… pero ya en la oficina se tiene que **buscar** una maquila de ese costo… **no es
 * seguro que se consiga**»*. El estimado de la mesa no es un dato pendiente de captura: es una
 * PROMESA, con DOS finales. Hasta aquí sólo cabía uno —«listo»—, así que un incumplimiento se
 * volvía un silencio.
 *
 * 🔴 **El «no» NO es un rechazo, y por eso vive aquí dentro y no en el otro botón.** Rechazar dice
 * *«corrige la receta»* y devuelve el renglón a la cola; «no se consiguió» dice *«la receta está
 * bien, el que no se logró fue el COSTO»*: la firma se da igual, la versión sale de la cola, y la
 * brecha aparece en «Promesas incumplidas», que es la lista del dueño.
 *
 * ⚠️ **Contestar es OPCIONAL** (*avisar no es bloquear*, §Post-F9.64): sin tocar nada se firma
 * exactamente como antes. Lo único que se exige es la coherencia del «no»: cuánto SÍ se consiguió
 * (sin número no hay brecha) y por qué (sin porqué, el dueño ve un número peor y nada más).
 */
export function DialogoRevisionModelo({
  abierto,
  alCambiarAbierto,
  modelo,
  accion,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  modelo: Modelo | null;
  accion: 'aprobar' | 'rechazar';
}): React.JSX.Element {
  const aprobar = useAprobarRevisionModelo();
  const rechazar = useRechazarRevisionModelo();
  const [texto, setTexto] = useState('');
  // ⭐⭐ V1-E9p — la respuesta a «¿se logró lo prometido?». `null` = no se contestó (conducta de
  // siempre); NUNCA se asume «sí» por no haber contestado — eso sería otra vez el silencio.
  const [logrado, setLogrado] = useState<boolean | null>(null);
  const [conseguido, setConseguido] = useState('');
  const [porQueNo, setPorQueNo] = useState('');
  // ⭐ V1-E9p — LA META, EN VIVO. No se lee de `modelo.metaCostoPrometido`: esa columna es la meta
  // CONGELADA con un desenlace ya declarado, o sea `null` en la PRIMERA firma — justo cuando se hace
  // la pregunta. Sólo se pide al aprobar y con el diálogo abierto.
  const meta = useMetaPrometida(modelo?.id, abierto && accion === 'aprobar');
  const costoPrometido = meta.data?.costoPrometido ?? null;

  useEffect(() => {
    if (abierto) {
      setTexto('');
      setLogrado(null);
      setConseguido('');
      setPorQueNo('');
    }
  }, [abierto, accion]);

  const esRechazo = accion === 'rechazar';
  const mutacion = esRechazo ? rechazar : aprobar;
  const faltaMotivo = esRechazo && texto.trim().length === 0;

  const costoConseguido = Number.parseFloat(conseguido.replace(',', '.'));
  const conseguidoValido = conseguido.trim() !== '' && Number.isFinite(costoConseguido);
  // Las DOS exigencias del «no», y sólo del «no»: sin el número no hay brecha, y sin el porqué la
  // brecha no le dice nada al que ya vendió con el costo anterior. El backend las vuelve a exigir.
  const faltaDesenlace =
    !esRechazo && logrado === false && (!conseguidoValido || porQueNo.trim() === '');

  /** El desenlace declarado, o `undefined` si no se contestó la pregunta. */
  function desenlace(): DesenlaceMeta | undefined {
    if (esRechazo || logrado === null) {
      return undefined;
    }
    if (logrado) {
      return {
        lograda: true,
        ...(conseguidoValido ? { costoConseguido } : {}),
        ...(porQueNo.trim() === '' ? {} : { nota: porQueNo.trim() }),
      };
    }
    return { lograda: false, costoConseguido, nota: porQueNo.trim() };
  }

  function confirmar(): void {
    if (modelo === null || faltaMotivo || faltaDesenlace) {
      return;
    }
    const meta = desenlace();
    mutacion.mutate(
      { id: modelo.id, texto: texto.trim(), ...(meta === undefined ? {} : { meta }) },
      {
        onSuccess: () => {
          toast.success(
            esRechazo
              ? `Revisión de ${modelo.codigo} rechazada. Queda en «Recetas por revisar».`
              : meta !== undefined && !meta.lograda
                ? `Revisión de ${modelo.codigo} aprobada. Queda anotado que NO se consiguió lo ` +
                  `prometido: sale en «Promesas incumplidas».`
                : `Revisión de ${modelo.codigo} aprobada.`,
          );
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-md" data-testid="dialogo-revision-modelo">
        <DialogHeader>
          <DialogTitle>{esRechazo ? 'Rechazar la revisión' : 'Aprobar la revisión'}</DialogTitle>
          <DialogDescription>
            {modelo === null
              ? ''
              : esRechazo
                ? `La versión ${modelo.codigo} se devuelve con observaciones: se conserva, se ` +
                  `puede seguir corrigiendo y queda en «Recetas por revisar» hasta que se firme. ` +
                  `Ojo: rechazarla NO detiene su producción. El gasto se frena renglón por renglón ` +
                  `en la receta de la orden: lo que Desarrollo no libera, no se compra.`
                : `Queda constancia de que revisaste la receta de ${modelo.codigo}, con tu nombre ` +
                  `y la fecha. La firma no habilita ni bloquea nada por sí sola; si alguien le ` +
                  `mueve la receta después, se cae y vuelve a «Recetas por revisar».`}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field data-invalid={faltaMotivo}>
            <FieldLabel htmlFor="modelo-revision-texto" required={esRechazo}>
              {esRechazo ? 'Motivo' : 'Nota (opcional)'}
            </FieldLabel>
            <textarea
              id="modelo-revision-texto"
              rows={3}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              maxLength={500}
              placeholder={
                esRechazo
                  ? 'Qué se observó en la receta y hay que corregir'
                  : 'Algo que quede anotado de esta revisión'
              }
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              data-testid="modelo-revision-texto"
            />
            <FieldDescription>
              {esRechazo
                ? 'Sin motivo, quien tiene que corregir la receta no sabe qué se observó.'
                : 'Queda guardado con tu nombre y la fecha.'}
            </FieldDescription>
          </Field>
        </div>

        {/* ⭐⭐ V1-E9p — LA OTRA PREGUNTA. Sólo al aprobar: el desenlace habla de una receta ya
            cuadrada, y un rechazo dice que todavía no lo está. */}
        {esRechazo ? null : (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3" data-testid="bloque-meta">
            <div>
              <p className="text-sm font-medium">¿Se logró lo que se prometió en la negociación?</p>
              <p className="text-[12.5px] text-muted-foreground">
                Lo que se estimó en la mesa es una <span className="font-medium">meta</span>, no un
                dato: se salió a buscar esa maquila, esos avíos, esa tela. Si no se consiguió,
                decirlo aquí <span className="font-medium">no rechaza nada</span> ni detiene la
                producción — sólo hace que la brecha se vea.
                {costoPrometido === null
                  ? ''
                  : ` Se vendió con un costo de ${formatearMoneda(costoPrometido)}.`}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={logrado === true ? 'default' : 'outline'}
                onClick={() => setLogrado(logrado === true ? null : true)}
                data-testid="meta-si"
              >
                Sí se consiguió
              </Button>
              <Button
                type="button"
                size="sm"
                variant={logrado === false ? 'destructive' : 'outline'}
                onClick={() => setLogrado(logrado === false ? null : false)}
                data-testid="meta-no"
              >
                NO se consiguió
              </Button>
              {logrado === null ? (
                <span className="self-center text-[12px] text-muted-foreground">
                  Opcional: si no contestas, se firma sin declarar nada.
                </span>
              ) : null}
            </div>

            {logrado === null ? null : (
              <div className="space-y-3">
                <Field data-invalid={logrado === false && !conseguidoValido}>
                  <FieldLabel htmlFor="meta-conseguido" required={logrado === false}>
                    ¿Con qué costo se quedó?
                  </FieldLabel>
                  <Input
                    id="meta-conseguido"
                    inputMode="decimal"
                    value={conseguido}
                    onChange={(e) => setConseguido(e.target.value)}
                    placeholder="45.00"
                    data-testid="meta-conseguido"
                  />
                  <FieldDescription>
                    {logrado === false
                      ? 'Sin este número no hay brecha que enseñar: «prometí 5, conseguí…».'
                      : 'Opcional: confirmar el número también es información.'}
                  </FieldDescription>
                </Field>

                <Field data-invalid={logrado === false && porQueNo.trim() === ''}>
                  <FieldLabel htmlFor="meta-porque" required={logrado === false}>
                    {logrado === false ? '¿Por qué no se consiguió?' : 'Observación (opcional)'}
                  </FieldLabel>
                  <textarea
                    id="meta-porque"
                    rows={2}
                    value={porQueNo}
                    onChange={(e) => setPorQueNo(e.target.value)}
                    maxLength={500}
                    placeholder="Ninguna maquila bajó de $18 con la jareta nueva"
                    className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                    data-testid="meta-porque"
                  />
                  <FieldDescription>
                    {logrado === false
                      ? 'Un costo peor sin explicación no le dice nada a quien ya le dio ese precio al cliente.'
                      : 'Queda guardado con la firma.'}
                  </FieldDescription>
                </Field>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={mutacion.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant={esRechazo ? 'destructive' : 'default'}
            onClick={confirmar}
            disabled={mutacion.isPending || faltaMotivo || faltaDesenlace}
            data-testid="confirmar-revision-modelo"
          >
            {mutacion.isPending ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : esRechazo ? (
              <XIcon aria-hidden />
            ) : (
              <CheckIcon aria-hidden />
            )}
            {esRechazo ? 'Rechazar' : 'Aprobar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
