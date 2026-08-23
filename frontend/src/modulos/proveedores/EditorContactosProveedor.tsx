import { Loader2Icon, Plus, UserRoundX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useActualizarContactoProveedor, useCrearContactoProveedor } from '@/api/proveedores';
import type { ProveedorContacto } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/**
 * EDITOR de los CONTACTOS de un proveedor (§Post-F9.56 punto 1 / §Post-F9.57 punto 1).
 *
 * Daniel: *"A veces es importante ir registrando al vendedor, a la de crédito y cobranza, al
 * encargado del taller, a la supervisora… Depende qué tipo de proveedor y qué tipo de puestos se
 * requieren."* Y sobre el puesto: *"deja el campo abierto qué rol tiene cada persona"* — por eso el
 * puesto es un `<input>` de texto y NO un selector: no hay catálogo que ofrecer.
 *
 * Vive dentro del diálogo del proveedor y solo en EDICIÓN (necesita el id, igual que los adjuntos).
 * Cada alta/archivado es su propia llamada al API —no viaja en el cuerpo del proveedor—, así que
 * NO depende de que se guarde el formulario: lo que se agrega aquí ya quedó guardado.
 *
 * Nada se BORRA (D3): un contacto que se fue se ARCHIVA y se puede revivir. Presentación pura (A1):
 * el backend valida y decide.
 */
export function EditorContactosProveedor({
  idProveedor,
  contactos,
}: {
  idProveedor: number;
  /** Contactos ACTIVOS que vienen en la ficha del proveedor. */
  contactos: ProveedorContacto[];
}): React.JSX.Element {
  const crear = useCrearContactoProveedor();
  const actualizar = useActualizarContactoProveedor();
  const ocupado = crear.isPending || actualizar.isPending;

  const [nombre, setNombre] = useState('');
  const [puesto, setPuesto] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  function agregar(): void {
    if (nombre.trim() === '') {
      setError('Escribe el nombre de la persona.');
      return;
    }
    setError(null);
    crear.mutate(
      {
        id: idProveedor,
        cuerpo: {
          nombre: nombre.trim(),
          ...(puesto.trim() === '' ? {} : { puesto: puesto.trim() }),
          ...(telefono.trim() === '' ? {} : { telefono: telefono.trim() }),
          ...(email.trim() === '' ? {} : { email: email.trim() }),
        },
      },
      {
        onSuccess: (c) => {
          toast.success(`Contacto "${c.nombre}" agregado.`);
          setNombre('');
          setPuesto('');
          setTelefono('');
          setEmail('');
        },
        onError: (e) => setError(e.message),
      },
    );
  }

  function archivar(contacto: ProveedorContacto): void {
    actualizar.mutate(
      { id: idProveedor, idContacto: contacto.id, cuerpo: { activo: false } },
      {
        onSuccess: () => toast.success(`Contacto "${contacto.nombre}" archivado.`),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div className="space-y-3" data-testid="editor-contactos">
      {contactos.length === 0 ? (
        <FieldDescription data-testid="sin-contactos">
          Todavía no hay contactos. Agrega al vendedor, a crédito y cobranza, al encargado del
          taller…
        </FieldDescription>
      ) : (
        <ul className="divide-y rounded-lg border">
          {contactos.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
              data-testid="contacto-proveedor"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.nombre}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[c.puesto, c.telefono, c.email]
                    .filter((v) => v !== null && v !== '')
                    .join(' · ')}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={ocupado}
                onClick={() => archivar(c)}
                aria-label={`Archivar contacto ${c.nombre}`}
                data-testid="archivar-contacto"
              >
                <UserRoundX aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="contacto-nombre" required>
            Nombre
          </FieldLabel>
          <Input
            id="contacto-nombre"
            value={nombre}
            disabled={ocupado}
            onChange={(e) => setNombre(e.target.value)}
            data-testid="contacto-nombre"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="contacto-puesto">Puesto</FieldLabel>
          <Input
            id="contacto-puesto"
            placeholder="Ej. crédito y cobranza"
            value={puesto}
            disabled={ocupado}
            onChange={(e) => setPuesto(e.target.value)}
            data-testid="contacto-puesto"
          />
          <FieldDescription>Texto libre: escribe lo que hace esa persona.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="contacto-telefono">Teléfono</FieldLabel>
          <Input
            id="contacto-telefono"
            value={telefono}
            disabled={ocupado}
            onChange={(e) => setTelefono(e.target.value)}
            data-testid="contacto-telefono"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="contacto-email">Email</FieldLabel>
          <Input
            id="contacto-email"
            type="email"
            value={email}
            disabled={ocupado}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="contacto-email"
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
        data-testid="agregar-contacto"
      >
        {crear.isPending ? (
          <Loader2Icon className="animate-spin" aria-hidden />
        ) : (
          <Plus aria-hidden />
        )}
        Agregar contacto
      </Button>
    </div>
  );
}
