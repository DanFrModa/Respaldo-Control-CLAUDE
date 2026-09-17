import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useContactosCliente, useDepartamentosCliente } from '@/api/clientes';
import { useGeneros } from '@/api/modelos';
import { useActualizarProyecto, useCrearProyecto } from '@/api/proyectos';
import type { Proyecto, ProyectoCrear, ProyectoEditar } from '@/api/proyectos';
import { useTemporadas } from '@/api/temporadas';
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  LeyendaObligatorios,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { esquemaProyectoFormulario, type DatosProyectoFormulario } from './esquemas';

/** Tope alto: trae las temporadas activas para su selector. (El de CLIENTE ya no carga catálogo:
 * desde V1-E4 busca en servidor, ver `FiltroCliente`.) */
const QUERY_TEMPORADAS = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Valores por defecto de un alta (todo vacío). */
const VALORES_INICIALES: DatosProyectoFormulario = {
  idCliente: '',
  idClienteDepartamento: '',
  nombre: '',
  idTemporada: '',
  idClienteContacto: '',
  idGenero: '',
  anioEntrega: '',
  notas: '',
};

/**
 * Diálogo de alta/edición de un proyecto de desarrollo (react-hook-form + Zod). El cliente sólo se
 * elige al DAR DE ALTA (en edición queda fijo: un proyecto es de un cliente). El departamento se
 * filtra por el cliente elegido. La validación de captura es sólo UX: el backend re-valida (A1),
 * incluido que el departamento pertenezca al cliente.
 *
 * ⭐ **fila 0.155 (§Post-F9.210)** — tres campos más, los tres OPCIONALES:
 *  • **Comprador**: la persona del cliente a la que va dirigido el proyecto (*«normalmente un
 *    proyecto va dirigido a un solo comprador»*). Sale del catálogo de contactos del cliente, que
 *    ya existía completo (§Post-F9.152); se filtra por el cliente elegido, igual que el
 *    departamento, y se vacía si el cliente cambia.
 *  • **Género** y **Año de entrega**: lo que los modelos nuevos del proyecto HEREDAN para no
 *    volver a preguntarlo. Se pueden dejar en blanco (el alta de modelo los pedirá como antes).
 */
export function DialogoProyecto({
  abierto,
  alCambiarAbierto,
  proyecto,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Proyecto a editar; `undefined` -> alta. */
  proyecto: Proyecto | undefined;
}): React.JSX.Element {
  const esEdicion = proyecto !== undefined;
  const crear = useCrearProyecto();
  const actualizar = useActualizarProyecto();
  const guardando = crear.isPending || actualizar.isPending;

  const temporadas = useTemporadas(QUERY_TEMPORADAS);
  const generos = useGeneros();

  const formulario = useForm<DatosProyectoFormulario>({
    resolver: zodResolver(esquemaProyectoFormulario),
    defaultValues: VALORES_INICIALES,
  });

  const idClienteElegido = formulario.watch('idCliente');
  const idClienteNum = idClienteElegido === '' ? undefined : Number(idClienteElegido);
  const departamentos = useDepartamentosCliente(idClienteNum);
  // ⭐ fila 0.155 — los contactos del cliente elegido (el comprador). Mismo patrón que los
  // departamentos: la consulta se queda apagada mientras no haya cliente.
  const contactos = useContactosCliente(idClienteNum);

  useEffect(() => {
    if (!abierto) {
      return;
    }
    formulario.reset(
      proyecto
        ? {
            idCliente: String(proyecto.idCliente),
            idClienteDepartamento: String(proyecto.idClienteDepartamento),
            nombre: proyecto.nombre,
            idTemporada: proyecto.idTemporada === null ? '' : String(proyecto.idTemporada),
            idClienteContacto:
              proyecto.idClienteContacto === null ? '' : String(proyecto.idClienteContacto),
            idGenero: proyecto.idGenero === null ? '' : String(proyecto.idGenero),
            anioEntrega: proyecto.anioEntrega === null ? '' : String(proyecto.anioEntrega),
            notas: proyecto.notas ?? '',
          }
        : VALORES_INICIALES,
    );
  }, [abierto, proyecto, formulario]);

  const enviar = formulario.handleSubmit((datos) => {
    if (esEdicion) {
      const cuerpo: ProyectoEditar = {
        idClienteDepartamento: Number(datos.idClienteDepartamento),
        nombre: datos.nombre,
        idTemporada: datos.idTemporada === '' ? null : Number(datos.idTemporada),
        // ⭐ fila 0.155 — M1: `null` vacía el campo; nunca se omite en la edición, porque quitar
        // el comprador (o el género, o el año) tiene que poder hacerse desde aquí.
        idClienteContacto: datos.idClienteContacto === '' ? null : Number(datos.idClienteContacto),
        idGenero: datos.idGenero === '' ? null : Number(datos.idGenero),
        anioEntrega: datos.anioEntrega.trim() === '' ? null : Number(datos.anioEntrega.trim()),
        notas: datos.notas.trim() === '' ? null : datos.notas,
      };
      actualizar.mutate(
        { id: proyecto.id, cuerpo },
        {
          onSuccess: (res) => {
            toast.success(`Proyecto ${res.folio} actualizado.`);
            alCambiarAbierto(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    const cuerpo: ProyectoCrear = {
      idCliente: Number(datos.idCliente),
      idClienteDepartamento: Number(datos.idClienteDepartamento),
      nombre: datos.nombre,
      ...(datos.idTemporada === '' ? {} : { idTemporada: Number(datos.idTemporada) }),
      ...(datos.idClienteContacto === ''
        ? {}
        : { idClienteContacto: Number(datos.idClienteContacto) }),
      ...(datos.idGenero === '' ? {} : { idGenero: Number(datos.idGenero) }),
      ...(datos.anioEntrega.trim() === '' ? {} : { anioEntrega: Number(datos.anioEntrega.trim()) }),
      ...(datos.notas.trim() === '' ? {} : { notas: datos.notas }),
    };
    crear.mutate(cuerpo, {
      onSuccess: (res) => {
        toast.success(`Proyecto ${res.folio} creado.`);
        alCambiarAbierto(false);
      },
      onError: (error) => toast.error(error.message),
    });
  });

  const { errors } = formulario.formState;
  const registrar = formulario.register;
  const departamentosActivos = (departamentos.data ?? []).filter(
    (d) => d.activo || String(d.id) === formulario.getValues('idClienteDepartamento'),
  );
  // ⭐ fila 0.155 — `useContactosCliente` ya pide sólo los ACTIVOS. El proyecto viejo cuyo
  // comprador se archivó conservaría un id que no está en la lista: se muestra su nombre igual
  // (abajo) para que editar el nombre del proyecto no lo borre sin avisar.
  //
  // 🟡 RONDA 2 — **`!contactos.isPending` no es cosmética: sin ella la etiqueta MIENTE.**
  // Mientras la consulta está en vuelo, `contactos.data` es `undefined` ⇒ la lista está vacía ⇒
  // «no está entre los activos» es cierto para TODOS, y cualquier proyecto con comprador pintaba
  // «Ana Ruiz (archivado)» hasta que resolvía. Es transitorio, pero es una etiqueta afirmando algo
  // falso sobre una persona, y quien la lea de reojo se lo cree.
  const contactosActivos = contactos.data ?? [];
  const idCompradorActual = formulario.watch('idClienteContacto');
  const compradorArchivado =
    !contactos.isPending &&
    idCompradorActual !== '' &&
    !contactosActivos.some((c) => String(c.id) === idCompradorActual) &&
    proyecto?.comprador !== null &&
    proyecto?.comprador !== undefined;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <DialogHeader>
            <DialogTitle>{esEdicion ? 'Editar proyecto' : 'Nuevo proyecto'}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? 'Cambia el departamento, el tema, la temporada y las notas del proyecto.'
                : 'Un proyecto agrupa desarrollos de un cliente y su departamento. El folio se asigna automáticamente.'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4 pr-1">
            <LeyendaObligatorios />
            <Field data-invalid={Boolean(errors.idCliente)}>
              <FieldLabel htmlFor="proyecto-cliente" required>
                Cliente
              </FieldLabel>
              {/* V1-E4 (punto 7): búsqueda server-side. El valor sigue viviendo en el
                  formulario (`setValue` con validación), solo cambia el control que lo captura. */}
              <FiltroCliente
                idCliente={idClienteElegido === '' ? null : Number(idClienteElegido)}
                /* El cliente NO se cambia en EDICIÓN: el departamento del proyecto cuelga de él y
                   el backend rechaza el guardado si dejan de casar (`proyectos.ts`). El `<select>`
                   llevaba este mismo candado; al pasar al combobox se había perdido. */
                deshabilitado={guardando || esEdicion}
                nombreInicial={proyecto?.cliente}
                alCambiar={(c) => {
                  formulario.setValue('idCliente', c === null ? '' : String(c.id), {
                    shouldValidate: true,
                    shouldDirty: true,
                  });
                  formulario.setValue('idClienteDepartamento', '');
                }}
                etiqueta="Cliente"
                placeholder="Elige un cliente…"
                idInput="proyecto-cliente"
                testid="proyecto-cliente"
              />
              <FieldError errors={[errors.idCliente]} />
            </Field>

            <Field data-invalid={Boolean(errors.idClienteDepartamento)}>
              <FieldLabel htmlFor="proyecto-departamento" required>
                Departamento
              </FieldLabel>
              <SelectNativo
                id="proyecto-departamento"
                disabled={guardando || idClienteNum === undefined}
                aria-invalid={Boolean(errors.idClienteDepartamento)}
                {...registrar('idClienteDepartamento')}
              >
                <option value="">
                  {idClienteNum === undefined
                    ? 'Elige primero un cliente…'
                    : 'Elige un departamento…'}
                </option>
                {departamentosActivos.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.nombre}
                    {d.activo ? '' : ' (desactivado)'}
                  </option>
                ))}
              </SelectNativo>
              <FieldError errors={[errors.idClienteDepartamento]} />
            </Field>

            <Field data-invalid={Boolean(errors.nombre)}>
              <FieldLabel htmlFor="proyecto-nombre" required>
                Nombre / tema
              </FieldLabel>
              <Input
                id="proyecto-nombre"
                placeholder="Ej. Joggers, Disney, básicos…"
                disabled={guardando}
                aria-invalid={Boolean(errors.nombre)}
                {...registrar('nombre')}
              />
              <FieldError errors={[errors.nombre]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="proyecto-temporada">Temporada</FieldLabel>
              <SelectNativo
                id="proyecto-temporada"
                disabled={guardando}
                {...registrar('idTemporada')}
              >
                <option value="">Sin temporada</option>
                {(temporadas.data?.datos ?? []).map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>

            {/* ⭐ fila 0.155 — el COMPRADOR (§Post-F9.210 punto 1). */}
            <Field>
              <FieldLabel htmlFor="proyecto-comprador">Comprador</FieldLabel>
              <SelectNativo
                id="proyecto-comprador"
                disabled={guardando || idClienteNum === undefined}
                {...registrar('idClienteContacto')}
              >
                <option value="">
                  {idClienteNum === undefined ? 'Elige primero un cliente…' : 'Sin comprador'}
                </option>
                {compradorArchivado ? (
                  <option value={idCompradorActual}>{proyecto.comprador} (archivado)</option>
                ) : null}
                {contactosActivos.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.nombre}
                    {c.puesto === null || c.puesto === '' ? '' : ` · ${c.puesto}`}
                  </option>
                ))}
              </SelectNativo>
              <FieldDescription>
                La persona del cliente a la que va dirigido el proyecto. Se captura en la ficha del
                cliente.
              </FieldDescription>
            </Field>

            {/* ⭐⭐ fila 0.155 — GÉNERO y AÑO: lo que heredan los modelos nuevos (§Post-F9.210
                punto 2). */}
            <Field>
              <FieldLabel htmlFor="proyecto-genero">Género</FieldLabel>
              <SelectNativo id="proyecto-genero" disabled={guardando} {...registrar('idGenero')}>
                <option value="">Sin género</option>
                {(generos.data ?? []).map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.nombre}
                  </option>
                ))}
              </SelectNativo>
              <FieldDescription>
                Los modelos nuevos de este proyecto lo toman de aquí y no lo vuelven a preguntar (se
                puede cambiar modelo por modelo).
              </FieldDescription>
            </Field>

            <Field data-invalid={Boolean(errors.anioEntrega)}>
              <FieldLabel htmlFor="proyecto-anio">Año de entrega</FieldLabel>
              <Input
                id="proyecto-anio"
                inputMode="numeric"
                placeholder="Ej. 2026"
                disabled={guardando}
                aria-invalid={Boolean(errors.anioEntrega)}
                {...registrar('anioEntrega')}
              />
              <FieldDescription>
                El año que va en el código del modelo (el 26 de CYA-26-71-001). También lo heredan
                los modelos nuevos.
              </FieldDescription>
              <FieldError errors={[errors.anioEntrega]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="proyecto-notas">Notas</FieldLabel>
              <textarea
                id="proyecto-notas"
                rows={3}
                disabled={guardando}
                className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
                {...registrar('notas')}
              />
            </Field>
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
            <Button
              type="submit"
              disabled={guardando}
              data-testid="guardar-proyecto"
              className="w-full sm:w-auto"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear proyecto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
