import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useAgregarColorDeTela } from '@/api/mrp';
import {
  esquemaColorDeTelaFormulario,
  numeroOpcionalACuerpo,
  type DatosColorDeTelaFormulario,
} from '@/api/esquemas';
import type { ColorTelaCreado } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  LeyendaObligatorios,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/**
 * ⭐⭐ **V1-E6b (§Post-F9.106) — DAR DE ALTA UN COLOR DE LA TELA, PRECARGADO CON EL PANTONE DE LA
 * OP.**
 *
 * Daniel, probando las OP 5562/5563/5564: *"ya jaló los pantones desde la OC del cliente. Ahora
 * quiero comprar con esos pantones pero no me deja. Porque me jala sólo algunos colores, que supongo
 * que son los que están dados de alta. **Pero me gustaría que acá pueda yo poner los colores que voy
 * a comprar**"*.
 *
 * Es el hermano del alta de dirección de V1-E4d/§Post-F9.104: **el catálogo se llena desde donde
 * hace falta**, no mandando al comprador a otra pantalla (de la que vuelve con la explosión y las OP
 * elegidas perdidas). Se abre desde la ÚLTIMA opción del desplegable de color del renglón —el mismo
 * patrón, no un tercero—.
 *
 * ⭐ **Precargado con el color de prenda de la OP y su pantone.** Ése es el punto entero de la
 * petición: el pantone ya viajó desde la OC del cliente hasta la pantalla (`OrdenLinea.pantone`), y
 * volver a teclearlo sería pedir dos veces el mismo dato. El comprador **confirma o corrige** — que
 * es justo lo que evita la fragmentación del catálogo por texto libre (§Post-F9.106: la cicatriz de
 * las medidas de avío, *"53 cm"* / *"53cm"* / *"53"*).
 *
 * 🔴 **El precio NO es obligatorio.** Se da de alta el color porque acaba de hacer falta: exigir un
 * precio que todavía no se tiene sería la misma puerta cerrada que esta etapa vino a quitar, y ese
 * precio es INFORMATIVO (el costo real va por lote). El del **complemento** sólo se pregunta si la
 * tela lleva complemento —lo dice el servidor (`nombreComplemento`), no lo adivina la pantalla—:
 * ofrecerlo cuando no lleva sería un campo que el backend rechaza (A1).
 *
 * Vive en el módulo de **Telas** —el catálogo al que escribe— y no en el de compras: el día que el
 * catálogo quiera "agregar un color" sin reeditar el grid entero, reusa ESTA forma en vez de que
 * nazca una segunda que se desincronice.
 *
 * ⚖️ **Pero el permiso que lo abre es `compras.administrar`, no `telas.administrar`** (25-ago-2026):
 * vivir en el módulo del catálogo dice a QUÉ escribe, no QUIÉN puede. Quien compra tiene que poder
 * dar de alta el color que va a comprar aunque no administre el catálogo de telas — que es el caso
 * de un perfil Gerencial.
 */
export function DialogoNuevoColorDeTela({
  abierto,
  alCambiarAbierto,
  idTela,
  tela,
  nombreComplemento,
  nombrePrecargado,
  pantonePrecargado,
  alCrear,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Tela a la que se le agrega el color. */
  idTela: number;
  /** Nombre de la tela (para decir a cuál se le está agregando). */
  tela: string;
  /** Nombre del complemento ("Cardigan") o `null` si la tela no lleva: lo manda el servidor. */
  nombreComplemento: string | null;
  /** ⭐ Nombre del color de PRENDA de la OP con el que se precarga el nombre. */
  nombrePrecargado: string;
  /** ⭐ Pantone que la OP trajo de la OC del cliente (`OrdenLinea.pantone`), o `null`. */
  pantonePrecargado: string | null;
  /**
   * ⭐ Se avisa con el color RECIÉN CREADO para que quede **elegido** en el caso desde el que se
   * dio de alta. Sin esto, el comprador da de alta el color y tiene que volver a buscarlo — que es
   * preguntar dos veces lo mismo.
   */
  alCrear: (color: ColorTelaCreado) => void;
}): React.JSX.Element {
  const agregar = useAgregarColorDeTela();
  const guardando = agregar.isPending;
  // `typeof` y no `!== null`: una respuesta vieja en cache (o un doble de prueba) puede no traer el
  // campo, y un `undefined.trim()` tumbaría el diálogo entero por un dato informativo.
  const llevaComplemento = typeof nombreComplemento === 'string' && nombreComplemento.trim() !== '';

  const formulario = useForm<DatosColorDeTelaFormulario>({
    resolver: zodResolver(esquemaColorDeTelaFormulario),
    defaultValues: { nombre: '', pantone: '', precio: '', precioComplemento: '' },
  });

  // La precarga se aplica CADA VEZ que se abre (y por caso): el mismo diálogo sirve al «Marino» de
  // una OP y al «Grana» de la siguiente, y arrastrar lo tecleado del anterior sería peor que no
  // precargar nada.
  useEffect(() => {
    if (!abierto) {
      return;
    }
    formulario.reset({
      nombre: nombrePrecargado,
      pantone: pantonePrecargado ?? '',
      precio: '',
      precioComplemento: '',
    });
  }, [abierto, formulario, nombrePrecargado, pantonePrecargado]);

  const enviar = formulario.handleSubmit((datos) => {
    const precio = numeroOpcionalACuerpo(datos.precio);
    const precioComplemento = numeroOpcionalACuerpo(datos.precioComplemento);
    agregar.mutate(
      {
        idTela,
        cuerpo: {
          nombre: datos.nombre,
          ...(datos.pantone.trim() === '' ? {} : { pantone: datos.pantone }),
          ...(precio === undefined ? {} : { precio }),
          // Si la tela no lleva complemento el campo ni se pinta; el guard evita mandar un número
          // que el servidor rechazaría (y que la pantalla no pudo capturar).
          ...(llevaComplemento && precioComplemento !== undefined ? { precioComplemento } : {}),
        },
      },
      {
        onSuccess: (creado) => {
          toast.success(`Color "${creado.nombre}" dado de alta en «${tela}».`);
          alCrear(creado);
          alCambiarAbierto(false);
        },
        // El mensaje es el del SERVIDOR (el del nombre repetido dice qué elegir): la pantalla no
        // redacta reglas (A1).
        onError: (error) => toast.error(error.message),
      },
    );
  });

  const { errors } = formulario.formState;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent data-testid="dialogo-nuevo-color-tela">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>Nuevo color de «{tela}»</DialogTitle>
            <DialogDescription>
              El nombre es el del proveedor («Marino Alsa 3040»), no el de la prenda. Viene
              precargado con el color y el pantone de la orden: confírmalo o corrígelo.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <LeyendaObligatorios />
            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="nuevo-color-nombre" required>
                Nombre del color
              </FieldLabel>
              <Input
                id="nuevo-color-nombre"
                autoFocus
                placeholder="Ej. Marino Alsa 3040"
                aria-invalid={Boolean(errors.nombre)}
                disabled={guardando}
                data-testid="nuevo-color-nombre"
                {...formulario.register('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field data-invalid={Boolean(errors.pantone)}>
              <FieldLabel htmlFor="nuevo-color-pantone">Pantone</FieldLabel>
              <Input
                id="nuevo-color-pantone"
                placeholder="Ej. 19-4027"
                disabled={guardando}
                data-testid="nuevo-color-pantone"
                {...formulario.register('pantone')}
              />
              <FieldDescription>
                El que trae la orden, si la OC del cliente lo dijo.
              </FieldDescription>
              <FieldError errors={[errors.pantone]} />
            </Field>

            <Field data-invalid={Boolean(errors.precio)}>
              <FieldLabel htmlFor="nuevo-color-precio">Precio</FieldLabel>
              <Input
                id="nuevo-color-precio"
                type="number"
                step="0.01"
                min="0"
                placeholder="Opcional"
                disabled={guardando}
                data-testid="nuevo-color-precio"
                {...formulario.register('precio')}
              />
              <FieldDescription>
                Si todavía no lo sabes, déjalo vacío: se puede capturar después y el costo real va
                por lote.
              </FieldDescription>
              <FieldError errors={[errors.precio]} />
            </Field>

            {llevaComplemento ? (
              <Field data-invalid={Boolean(errors.precioComplemento)}>
                <FieldLabel htmlFor="nuevo-color-precio-complemento">
                  Precio {nombreComplemento}
                </FieldLabel>
                <Input
                  id="nuevo-color-precio-complemento"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Opcional"
                  disabled={guardando}
                  data-testid="nuevo-color-precio-complemento"
                  {...formulario.register('precioComplemento')}
                />
                <FieldError errors={[errors.precioComplemento]} />
              </Field>
            ) : null}
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => alCambiarAbierto(false)}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={guardando}
              data-testid="guardar-nuevo-color-tela"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Dar de alta el color
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
