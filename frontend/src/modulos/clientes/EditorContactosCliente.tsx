import { Loader2Icon, Plus, UserRoundCheck, UserRoundX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useActualizarContactoCliente,
  useContactosCliente,
  useCrearContactoCliente,
  useDepartamentosCliente,
} from '@/api/clientes';
import type { ClienteContacto } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';

/** Valor del selector cuando la persona atiende al cliente COMPLETO (no a un departamento). */
const SIN_DEPARTAMENTO = '';

/**
 * ⭐ EDITOR de los CONTACTOS de un cliente (V1-E8y, §Post-F9.152) — **la compradora**.
 *
 * Es el espejo de `EditorContactosProveedor`, con la diferencia que decidió Daniel: el
 * **DEPARTAMENTO es OPCIONAL**. Así «Laura, compradora, NIÑOS» se distingue de la compradora de
 * DAMAS, y «Carlos, crédito y cobranza» —que atiende a todo el cliente— no necesita que le inventen
 * un departamento. Por eso el selector trae «(todo el cliente)» como primera opción y NO como un
 * hueco por llenar.
 *
 * El PUESTO es un `<input>` de texto y no un selector: no hay catálogo que ofrecer (*"deja el campo
 * abierto qué rol tiene cada persona"*).
 *
 * Vive en el panel de DETALLE del cliente (necesita su id), como el editor de departamentos. Cada
 * alta/archivado es su propia llamada al API: lo que se agrega aquí ya quedó guardado.
 *
 * Nada se BORRA (D3): quien se fue se ARCHIVA y se puede revivir. Presentación pura (A1): el
 * backend valida y decide (que el departamento sea del cliente, que esté activo, etc.).
 */
export function EditorContactosCliente({
  idCliente,
  deshabilitado = false,
}: {
  idCliente: number;
  deshabilitado?: boolean;
}): React.JSX.Element {
  // Se piden los ARCHIVADOS también: revivir a alguien exige poder verlo (mismo criterio que el
  // editor de departamentos, que pinta los inactivos atenuados).
  const consulta = useContactosCliente(idCliente, true);
  const departamentos = useDepartamentosCliente(idCliente);
  const crear = useCrearContactoCliente();
  const actualizar = useActualizarContactoCliente();
  const ocupado = deshabilitado || crear.isPending || actualizar.isPending;

  const [nombre, setNombre] = useState('');
  const [puesto, setPuesto] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [idDepto, setIdDepto] = useState<string>(SIN_DEPARTAMENTO);
  const [error, setError] = useState<string | null>(null);

  const contactos = consulta.data ?? [];
  const activos = departamentos.data?.filter((d) => d.activo) ?? [];

  function agregar(): void {
    if (nombre.trim() === '') {
      setError('Escribe el nombre de la persona.');
      return;
    }
    setError(null);
    crear.mutate(
      {
        idCliente,
        cuerpo: {
          nombre: nombre.trim(),
          ...(puesto.trim() === '' ? {} : { puesto: puesto.trim() }),
          ...(telefono.trim() === '' ? {} : { telefono: telefono.trim() }),
          ...(email.trim() === '' ? {} : { email: email.trim() }),
          ...(idDepto === SIN_DEPARTAMENTO
            ? {}
            : { idClienteDepartamento: Number.parseInt(idDepto, 10) }),
        },
      },
      {
        onSuccess: (c) => {
          toast.success(`Contacto "${c.nombre}" agregado.`);
          setNombre('');
          setPuesto('');
          setTelefono('');
          setEmail('');
          setIdDepto(SIN_DEPARTAMENTO);
        },
        onError: (e) => setError(e.message),
      },
    );
  }

  function cambiarArchivado(contacto: ClienteContacto, activo: boolean): void {
    actualizar.mutate(
      { idCliente, idContacto: contacto.id, cuerpo: { activo } },
      {
        onSuccess: () =>
          toast.success(`Contacto "${contacto.nombre}" ${activo ? 'reactivado' : 'archivado'}.`),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  if (consulta.isPending) {
    return <Skeleton className="h-20 w-full" data-testid="contactos-cliente-cargando" />;
  }

  return (
    <div className="space-y-3" data-testid="editor-contactos-cliente">
      {contactos.length === 0 ? (
        <FieldDescription data-testid="sin-contactos-cliente">
          Todavía no hay contactos. Agrega a la compradora de cada departamento, a crédito y
          cobranza, a tráfico…
        </FieldDescription>
      ) : (
        <ul className="divide-y rounded-lg border">
          {contactos.map((c) => (
            <li
              key={c.id}
              className={`flex items-center justify-between gap-2 px-3 py-2 ${
                c.activo ? '' : 'opacity-60'
              }`}
              data-testid="contacto-cliente"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {c.nombre}
                  {c.activo ? null : (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      (archivado)
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[
                    c.puesto,
                    // El departamento se lee como parte de quién es la persona: «compradora ·
                    // NIÑOS». Sin departamento no se pinta nada (atiende al cliente completo) —
                    // nada de un «(sin departamento)» que parezca un dato faltante.
                    c.nombreDepartamento,
                    c.telefono,
                    c.email,
                  ]
                    .filter((v) => v !== null && v !== '')
                    .join(' · ')}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={ocupado}
                onClick={() => cambiarArchivado(c, !c.activo)}
                aria-label={`${c.activo ? 'Archivar' : 'Reactivar'} contacto ${c.nombre}`}
                data-testid={c.activo ? 'archivar-contacto-cliente' : 'reactivar-contacto-cliente'}
              >
                {c.activo ? <UserRoundX aria-hidden /> : <UserRoundCheck aria-hidden />}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {deshabilitado ? null : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="contacto-cliente-nombre" required>
                Nombre
              </FieldLabel>
              <Input
                id="contacto-cliente-nombre"
                value={nombre}
                disabled={ocupado}
                onChange={(e) => setNombre(e.target.value)}
                data-testid="contacto-cliente-nombre"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="contacto-cliente-puesto">Puesto</FieldLabel>
              <Input
                id="contacto-cliente-puesto"
                placeholder="Ej. compradora"
                value={puesto}
                disabled={ocupado}
                onChange={(e) => setPuesto(e.target.value)}
                data-testid="contacto-cliente-puesto"
              />
              <FieldDescription>Texto libre: escribe lo que hace esa persona.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="contacto-cliente-depto">Departamento</FieldLabel>
              <SelectNativo
                id="contacto-cliente-depto"
                value={idDepto}
                disabled={ocupado}
                onChange={(e) => setIdDepto(e.target.value)}
                data-testid="contacto-cliente-depto"
              >
                <option value={SIN_DEPARTAMENTO}>(todo el cliente)</option>
                {activos.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.nombre}
                  </option>
                ))}
              </SelectNativo>
              <FieldDescription>
                Opcional. Déjalo en «todo el cliente» para quien no atiende un departamento en
                particular (crédito, tráfico…).
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="contacto-cliente-telefono">Teléfono</FieldLabel>
              <Input
                id="contacto-cliente-telefono"
                value={telefono}
                disabled={ocupado}
                onChange={(e) => setTelefono(e.target.value)}
                data-testid="contacto-cliente-telefono"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="contacto-cliente-email">Email</FieldLabel>
              <Input
                id="contacto-cliente-email"
                type="email"
                value={email}
                disabled={ocupado}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="contacto-cliente-email"
              />
            </Field>
          </div>

          <FieldError errors={error === null ? [] : [{ message: error }]} />

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={ocupado}
            onClick={agregar}
            data-testid="agregar-contacto-cliente"
          >
            {crear.isPending ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <Plus aria-hidden />
            )}
            Agregar contacto
          </Button>
        </>
      )}
    </div>
  );
}
