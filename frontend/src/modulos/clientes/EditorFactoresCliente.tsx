import { zodResolver } from '@hookform/resolvers/zod';
import { Building, Loader2Icon, PencilIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { useDepartamentosCliente } from '@/api/clientes';
import {
  useFactoresCliente,
  useGuardarFactoresCliente,
  type ClienteFactores,
} from '@/api/cliente-factores';
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
import { Skeleton } from '@/components/ui/skeleton';
import { useSesion } from '@/sesion/useSesion';

/** Un porcentaje de factor (UX; el backend re-valida el tope fino de la suma, A1). */
const porcentaje = z
  .number({ error: 'Captura un número' })
  .min(0, { error: 'No puede ser negativo' })
  .max(100, { error: 'No puede pasar de 100' });

/** Esquema del formulario de factores. */
const esquemaFactoresFormulario = z.object({
  margenPct: porcentaje.max(99.99, { error: 'El margen debe ser menor a 100' }),
  descuentosPct: porcentaje,
  regaliasPct: porcentaje,
  costoVentasPct: porcentaje,
});

type DatosFactoresFormulario = z.infer<typeof esquemaFactoresFormulario>;

/** Los cuatro campos numéricos de factores, reutilizados por el default y por el override. */
function CamposFactores({
  formulario,
  guardando,
}: {
  formulario: ReturnType<typeof useForm<DatosFactoresFormulario>>;
  guardando: boolean;
}): React.JSX.Element {
  const { errors } = formulario.formState;
  const campos: { nombre: keyof DatosFactoresFormulario; etiqueta: string }[] = [
    { nombre: 'margenPct', etiqueta: 'Margen %' },
    { nombre: 'descuentosPct', etiqueta: 'Descuentos %' },
    { nombre: 'regaliasPct', etiqueta: 'Regalías %' },
    { nombre: 'costoVentasPct', etiqueta: 'Costo de ventas %' },
  ];
  return (
    <FieldGroup className="grid grid-cols-2 gap-3">
      {campos.map((campo) => (
        <Field key={campo.nombre} data-invalid={Boolean(errors[campo.nombre])}>
          <FieldLabel htmlFor={`factor-${campo.nombre}`}>{campo.etiqueta}</FieldLabel>
          <Input
            id={`factor-${campo.nombre}`}
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            aria-invalid={Boolean(errors[campo.nombre])}
            disabled={guardando}
            {...formulario.register(campo.nombre, { valueAsNumber: true })}
          />
          <FieldError errors={[errors[campo.nombre]]} />
        </Field>
      ))}
    </FieldGroup>
  );
}

/** Valores por defecto de captura (0) o los de una fila existente. */
function valoresDe(factores: ClienteFactores | undefined): DatosFactoresFormulario {
  return {
    margenPct: factores?.margenPct ?? 0,
    descuentosPct: factores?.descuentosPct ?? 0,
    regaliasPct: factores?.regaliasPct ?? 0,
    costoVentasPct: factores?.costoVentasPct ?? 0,
  };
}

/**
 * Editor de los FACTORES de lista de precios del cliente (F8-E4, D13/R20a): un DEFAULT por cliente
 * (`idClienteDepartamento` null) y overrides opcionales por departamento. Vive en el DETALLE del
 * cliente (necesita su id). Solo se puede editar con `listas.administrar` (`deshabilitado`).
 *
 * §Post-F9.68 — esconder, no negar: sin `consultas.ver-importes` NO hay nada que enseñar aquí (los
 * factores SON el dato de dinero), así que la SECCIÓN ENTERA —con su rótulo— desaparece del detalle
 * del cliente (`ClientesPagina`) en vez de mostrar un letrero de permiso. Este `null` es la segunda
 * barrera por si alguien monta el editor sin ese gate.
 *
 * La fórmula (margen + descuentos + regalías + costo de ventas, en cascada sobre la venta) la aplica
 * el backend al crear/editar la lista (A1); aquí solo se capturan los factores.
 */
export function EditorFactoresCliente({
  idCliente,
  deshabilitado = false,
}: {
  idCliente: number;
  deshabilitado?: boolean;
}): React.JSX.Element | null {
  const { tienePermiso } = useSesion();
  const verImportes = tienePermiso('consultas.ver-importes');

  const factoresConsulta = useFactoresCliente(idCliente);
  const departamentosConsulta = useDepartamentosCliente(idCliente);
  const guardar = useGuardarFactoresCliente();

  const [overrideEnEdicion, setOverrideEnEdicion] = useState<{
    idDepartamento: number;
    nombre: string;
    factores: ClienteFactores | undefined;
  } | null>(null);

  const factores = factoresConsulta.data ?? [];
  const porDefecto = factores.find((f) => f.idClienteDepartamento === null);
  const overridePorDepto = new Map(
    factores
      .filter((f) => f.idClienteDepartamento !== null)
      .map((f) => [f.idClienteDepartamento as number, f]),
  );
  const departamentos = (departamentosConsulta.data ?? []).filter((d) => d.activo);

  // Formulario del DEFAULT (inline).
  const formularioDefault = useForm<DatosFactoresFormulario>({
    resolver: zodResolver(esquemaFactoresFormulario),
    defaultValues: valoresDe(undefined),
  });

  useEffect(() => {
    formularioDefault.reset(valoresDe(porDefecto));
    // Se re-sincroniza si cambia CUALQUIER factor del default que trae el servidor (los cuatro).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    porDefecto?.id,
    porDefecto?.margenPct,
    porDefecto?.descuentosPct,
    porDefecto?.regaliasPct,
    porDefecto?.costoVentasPct,
  ]);

  function guardarDefault(datos: DatosFactoresFormulario): void {
    guardar.mutate(
      { idCliente, cuerpo: { idClienteDepartamento: null, ...datos } },
      {
        onSuccess: () => toast.success('Factores por defecto guardados.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  // Segunda barrera (la primera es que la sección no se pinta): sin permiso de
  // importes no hay factores que mostrar, y NO se pone un letrero en su lugar.
  if (!verImportes) {
    return null;
  }
  if (factoresConsulta.isPending) {
    return (
      <div className="space-y-2" data-testid="factores-cargando">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (factoresConsulta.isError) {
    return <p className="text-sm text-destructive">{factoresConsulta.error.message}</p>;
  }

  return (
    <div className="space-y-4" data-testid="editor-factores-cliente">
      <p className="text-sm text-muted-foreground">
        Factores de la lista de precios: margen, descuentos, regalías y costo de ventas (en % sobre
        la venta). El default aplica a todo el cliente; cada departamento puede tener su propio
        ajuste.
      </p>

      <form
        onSubmit={(e) => void formularioDefault.handleSubmit(guardarDefault)(e)}
        noValidate
        className="rounded-lg border p-3"
        data-testid="form-factores-default"
      >
        <p className="mb-2 text-sm font-medium">Factores por defecto del cliente</p>
        <CamposFactores formulario={formularioDefault} guardando={guardar.isPending} />
        {!deshabilitado ? (
          <div className="mt-3 flex justify-end">
            <Button
              type="submit"
              disabled={guardar.isPending}
              data-testid="guardar-factores-default"
            >
              {guardar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Guardar factores
            </Button>
          </div>
        ) : null}
      </form>

      {departamentos.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Ajustes por departamento</p>
          <ul className="space-y-2" data-testid="lista-factores-departamento">
            {departamentos.map((departamento) => {
              const override = overridePorDepto.get(departamento.id);
              return (
                <li
                  key={departamento.id}
                  className="flex items-center gap-3 rounded-lg border p-2.5"
                  data-testid="fila-factores-departamento"
                >
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
                  >
                    <Building className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="truncate text-sm font-medium">{departamento.nombre}</span>
                    <span className="block text-xs text-muted-foreground">
                      {override
                        ? `Margen ${String(override.margenPct)}% · Desc ${String(override.descuentosPct)}% · Reg ${String(override.regaliasPct)}% · CV ${String(override.costoVentasPct)}%`
                        : 'Usa el default del cliente'}
                    </span>
                  </div>
                  {!deshabilitado ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Editar factores del departamento ${departamento.nombre}`}
                      data-testid="editar-factores-departamento"
                      onClick={() =>
                        setOverrideEnEdicion({
                          idDepartamento: departamento.id,
                          nombre: departamento.nombre,
                          factores: override,
                        })
                      }
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <DialogoFactoresDepartamento
        idCliente={idCliente}
        override={overrideEnEdicion}
        alCerrar={() => setOverrideEnEdicion(null)}
      />
    </div>
  );
}

/** Diálogo para capturar/editar el override de factores de UN departamento. */
function DialogoFactoresDepartamento({
  idCliente,
  override,
  alCerrar,
}: {
  idCliente: number;
  override: {
    idDepartamento: number;
    nombre: string;
    factores: ClienteFactores | undefined;
  } | null;
  alCerrar: () => void;
}): React.JSX.Element {
  const guardar = useGuardarFactoresCliente();
  const formulario = useForm<DatosFactoresFormulario>({
    resolver: zodResolver(esquemaFactoresFormulario),
    defaultValues: valoresDe(undefined),
  });

  useEffect(() => {
    if (override !== null) {
      formulario.reset(valoresDe(override.factores));
    }
  }, [override, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (override === null) {
      return;
    }
    guardar.mutate(
      { idCliente, cuerpo: { idClienteDepartamento: override.idDepartamento, ...datos } },
      {
        onSuccess: () => {
          toast.success(`Factores de "${override.nombre}" guardados.`);
          alCerrar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  });

  return (
    <Dialog open={override !== null} onOpenChange={(abierto) => (abierto ? null : alCerrar())}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>Factores de {override?.nombre}</DialogTitle>
            <DialogDescription>
              Ajuste de los factores para este departamento (sobrescribe el default del cliente).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <CamposFactores formulario={formulario} guardando={guardar.isPending} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={alCerrar} disabled={guardar.isPending}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={guardar.isPending}
              data-testid="guardar-factores-departamento"
            >
              {guardar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
