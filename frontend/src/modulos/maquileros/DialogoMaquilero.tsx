import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { type DatosMaquileroFormulario, esquemaMaquileroFormulario } from '@/api/esquemas';
import { useActualizarMaquilero, useCrearMaquilero, useTiposProceso } from '@/api/maquileros';
import type { Maquilero, MaquileroCrear, MaquileroEditar } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { SelectorTiposProceso } from './SelectorTiposProceso';

/** Valores por defecto de un alta (todo vacio; los tipos se manejan aparte). */
const VALORES_INICIALES: DatosMaquileroFormulario = {
  corto: '',
  nombre: '',
  apellidos: '',
  telefonos: '',
  direccion: '',
  observaciones: '',
  obsPago: '',
  asegurado: false,
};

/** Lee un campo de texto opcional del maquilero para el formulario (`null` -> ''). */
function texto(valor: string | null): string {
  return valor ?? '';
}

/**
 * Traduce la captura al cuerpo del API para ALTA (POST): `corto`/`nombre` siempre van;
 * los textos opcionales vacios se OMITEN (el backend los deja como null); `asegurado`
 * viaja siempre como boolean. Los `tipos` los inyecta `enviar` (estado local, ≥1).
 */
function aCuerpoCrear(datos: DatosMaquileroFormulario): Omit<MaquileroCrear, 'tipos'> {
  const cuerpo: Omit<MaquileroCrear, 'tipos'> = {
    corto: datos.corto,
    nombre: datos.nombre,
    asegurado: datos.asegurado,
  };
  const textos: Array<[keyof MaquileroCrear, string]> = [
    ['apellidos', datos.apellidos],
    ['telefonos', datos.telefonos],
    ['direccion', datos.direccion],
    ['observaciones', datos.observaciones],
    ['obsPago', datos.obsPago],
  ];
  for (const [clave, valor] of textos) {
    if (valor.length > 0) {
      // Asignacion segura: todas estas claves son `string | undefined` en MaquileroCrear.
      (cuerpo as Record<string, unknown>)[clave] = valor;
    }
  }
  return cuerpo;
}

/** Texto opcional para EDICION: vacio -> `null` (BORRA el dato); con valor -> el texto. */
function textoONull(valor: string): string | null {
  return valor.length > 0 ? valor : null;
}

/**
 * Traduce la captura al cuerpo del PATCH (EDICION). A diferencia del alta, los campos
 * opcionales que quedan VACIOS viajan como `null` para BORRAR el dato (M1): en un PATCH
 * parcial, un campo OMITIDO no se tocaria, así que omitirlo nunca permitiría vaciar un
 * valor ya capturado. `corto`/`nombre` siempre van; `asegurado` como boolean. Los `tipos`
 * los inyecta `enviar` (estado local, nunca `[]`).
 */
function aCuerpoEditar(datos: DatosMaquileroFormulario): Omit<MaquileroEditar, 'tipos'> {
  return {
    corto: datos.corto,
    nombre: datos.nombre,
    apellidos: textoONull(datos.apellidos),
    telefonos: textoONull(datos.telefonos),
    direccion: textoONull(datos.direccion),
    observaciones: textoONull(datos.observaciones),
    obsPago: textoONull(datos.obsPago),
    asegurado: datos.asegurado,
  };
}

/**
 * Dialogo de alta y edicion de maquilero (maquila unificada, F1-E2). Replica el patron de
 * Cortadores (react-hook-form + Zod) sumando el selector MULTIPLE de tipos de proceso
 * (capacidades, ≥1 obligatorio) que el Proveedor usa para sus roles. Si recibe un
 * `maquilero` edita (PATCH); si no, da de alta (POST).
 *
 * - Los `tipos` van INLINE en el cuerpo de crear/editar (misma transaccion A2). El estado
 *   de ids seleccionados vive aqui; en alta se exige ≥1; en edicion, si no se tocan, se
 *   mandan los actuales (nunca `[]`, que el backend trataria como "quitar todos").
 * - En edicion, los campos opcionales vacios viajan como `null` para BORRARLOS (M1).
 *
 * La validacion de captura es solo UX: el backend re-valida y es la autoridad (A1). Al
 * guardar con exito cierra y avisa con un toast.
 */
export function DialogoMaquilero({
  abierto,
  alCambiarAbierto,
  maquilero,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Maquilero a editar; `undefined` -> alta. */
  maquilero: Maquilero | undefined;
}): React.JSX.Element {
  const esEdicion = maquilero !== undefined;
  const crear = useCrearMaquilero();
  const actualizar = useActualizarMaquilero();
  const guardando = crear.isPending || actualizar.isPending;

  const tiposCatalogo = useTiposProceso();

  // Tipos seleccionados: estado local (no son texto del schema). Se validan al enviar
  // (≥1) y se envian inline en el cuerpo del API.
  const [idsTipos, setIdsTipos] = useState<number[]>([]);
  const [errorTipos, setErrorTipos] = useState<string | null>(null);

  const formulario = useForm<DatosMaquileroFormulario>({
    resolver: zodResolver(esquemaMaquileroFormulario),
    defaultValues: VALORES_INICIALES,
  });

  // Al abrir, sincroniza el formulario y los tipos con el maquilero en edicion (o limpia).
  useEffect(() => {
    if (!abierto) {
      return;
    }
    setErrorTipos(null);
    if (maquilero) {
      formulario.reset({
        corto: maquilero.corto,
        nombre: maquilero.nombre,
        apellidos: texto(maquilero.apellidos),
        telefonos: texto(maquilero.telefonos),
        direccion: texto(maquilero.direccion),
        observaciones: texto(maquilero.observaciones),
        obsPago: texto(maquilero.obsPago),
        asegurado: maquilero.asegurado,
      });
      setIdsTipos(maquilero.tipos.map((tipo) => tipo.id));
    } else {
      formulario.reset(VALORES_INICIALES);
      setIdsTipos([]);
    }
  }, [abierto, maquilero, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    // Validacion de captura de tipos (≥1). El backend es la autoridad, pero asi el
    // usuario ve el error sin un viaje al servidor.
    if (idsTipos.length === 0) {
      setErrorTipos('Elige al menos un tipo de proceso.');
      return;
    }
    setErrorTipos(null);

    if (esEdicion) {
      // Los tipos SIEMPRE viajan (el usuario eligio ≥1; si no los toco, son los que se
      // poblaron al abrir). Nunca `[]`.
      const cuerpo: MaquileroEditar = { ...aCuerpoEditar(datos), tipos: idsTipos };
      actualizar.mutate(
        { id: maquilero.id, cuerpo },
        {
          onSuccess: (resultado) => {
            toast.success(`Maquilero "${resultado.corto}" actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    const cuerpo: MaquileroCrear = { ...aCuerpoCrear(datos), tipos: idsTipos };
    crear.mutate(cuerpo, {
      onSuccess: (resultado) => {
        toast.success(`Maquilero "${resultado.corto}" creado.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;
  const registrar = formulario.register;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar maquilero' : 'Nuevo maquilero'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia los datos de este maquilero.'
                : 'Captura los datos del nuevo maquilero del catálogo.'}
            </DialogDescription>
          </DialogHeader>

          {/* Cuerpo desplazable: el formulario puede crecer. */}
          <div className="max-h-[60vh] overflow-y-auto py-4 pr-1">
            <FieldGroup>
              <Field data-invalid={Boolean(errors.corto)}>
                <FieldLabel htmlFor="maquilero-corto">Código corto</FieldLabel>
                <Input
                  id="maquilero-corto"
                  autoFocus
                  aria-invalid={Boolean(errors.corto)}
                  disabled={guardando}
                  {...registrar('corto')}
                />
                <FieldError errors={[errors.corto]} />
              </Field>

              <Field data-invalid={Boolean(errors.nombre)}>
                <FieldLabel htmlFor="maquilero-nombre">Nombre</FieldLabel>
                <Input
                  id="maquilero-nombre"
                  aria-invalid={Boolean(errors.nombre)}
                  disabled={guardando}
                  {...registrar('nombre')}
                />
                <FieldError errors={[errors.nombre]} />
              </Field>

              <Field data-invalid={Boolean(errors.apellidos)}>
                <FieldLabel htmlFor="maquilero-apellidos">Apellidos</FieldLabel>
                <Input
                  id="maquilero-apellidos"
                  aria-invalid={Boolean(errors.apellidos)}
                  disabled={guardando}
                  {...registrar('apellidos')}
                />
                <FieldError errors={[errors.apellidos]} />
              </Field>

              <Field data-invalid={Boolean(errors.telefonos)}>
                <FieldLabel htmlFor="maquilero-telefonos">Teléfonos</FieldLabel>
                <Input
                  id="maquilero-telefonos"
                  aria-invalid={Boolean(errors.telefonos)}
                  disabled={guardando}
                  {...registrar('telefonos')}
                />
                <FieldError errors={[errors.telefonos]} />
              </Field>

              <Field data-invalid={Boolean(errors.direccion)}>
                <FieldLabel htmlFor="maquilero-direccion">Dirección</FieldLabel>
                <Input
                  id="maquilero-direccion"
                  aria-invalid={Boolean(errors.direccion)}
                  disabled={guardando}
                  {...registrar('direccion')}
                />
                <FieldError errors={[errors.direccion]} />
              </Field>

              {/* Tipos de proceso (inline, ≥1). */}
              <SelectorTiposProceso
                tipos={tiposCatalogo.data ?? []}
                cargando={tiposCatalogo.isPending}
                error={tiposCatalogo.isError ? tiposCatalogo.error.message : null}
                seleccionados={idsTipos}
                alCambiar={(ids) => {
                  setIdsTipos(ids);
                  if (ids.length > 0) {
                    setErrorTipos(null);
                  }
                }}
                mensajeError={errorTipos}
                deshabilitado={guardando}
              />

              <Field orientation="horizontal">
                <input
                  id="maquilero-asegurado"
                  type="checkbox"
                  className="size-4 rounded border-input accent-primary"
                  disabled={guardando}
                  data-testid="maquilero-asegurado"
                  {...registrar('asegurado')}
                />
                <FieldLabel htmlFor="maquilero-asegurado" className="font-normal">
                  ¿Está asegurado?
                </FieldLabel>
              </Field>

              <Field data-invalid={Boolean(errors.observaciones)}>
                <FieldLabel htmlFor="maquilero-observaciones">Observaciones</FieldLabel>
                <textarea
                  id="maquilero-observaciones"
                  rows={3}
                  aria-invalid={Boolean(errors.observaciones)}
                  disabled={guardando}
                  className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"
                  {...registrar('observaciones')}
                />
                <FieldError errors={[errors.observaciones]} />
              </Field>

              <Field data-invalid={Boolean(errors.obsPago)}>
                <FieldLabel htmlFor="maquilero-obs-pago">Observaciones de pago</FieldLabel>
                <textarea
                  id="maquilero-obs-pago"
                  rows={2}
                  aria-invalid={Boolean(errors.obsPago)}
                  disabled={guardando}
                  className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"
                  {...registrar('obsPago')}
                />
                <FieldError errors={[errors.obsPago]} />
              </Field>
            </FieldGroup>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => alCambiarAbierto(false)}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando} data-testid="guardar-maquilero">
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear maquilero'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
