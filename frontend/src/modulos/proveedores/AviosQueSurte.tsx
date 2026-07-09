import { Loader2Icon, PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useAvios } from '@/api/avios';
import {
  useAsignarAvioProveedor,
  useAviosProveedor,
  useQuitarAvioProveedor,
} from '@/api/proveedores';
import { ComboboxBuscable, type OpcionCombobox } from '@/components/dominio/ComboboxBuscable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';

/** Formatea un precio (number | null) como moneda es-MX, o "— sin precio". */
function formatearPrecio(valor: number | null): string {
  if (valor === null) {
    return '— sin precio';
  }
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(valor);
}

/**
 * "Avíos que surte" — administra el vínculo avío↔proveedor DESDE EL LADO DEL PROVEEDOR (B17, R9,
 * proto `drawerProveedor`). Es la MISMA relación `AvioProveedor` que se edita desde el catálogo de
 * avíos, pero vista desde el proveedor: lista los avíos que surte (con su precio) y permite
 * asignar/quitar. Justo para cuando un proveedor te ofrece un avío que YA tienes dado de alta.
 *
 * El selector de avío es SOLO de lista (no texto libre — evita duplicados de catálogo): busca en
 * servidor sobre `GET /avios` y descarta los que el proveedor ya surte. Escribir/quitar exige
 * `proveedores.administrar` (lo re-decide el backend, A1); en modo lectura solo se ve la lista.
 */
export function AviosQueSurte({
  idProveedor,
  puedeAdministrar,
}: {
  idProveedor: number;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const consulta = useAviosProveedor(idProveedor);
  const asignar = useAsignarAvioProveedor();
  const quitar = useQuitarAvioProveedor();

  // ── Formulario "asignar" (inline, dentro del cajón) ─────────────────────────
  const [formAbierto, setFormAbierto] = useState(false);
  const [idAvioSel, setIdAvioSel] = useState<number | null>(null);
  const [textoAvio, setTextoAvio] = useState('');
  const [precio, setPrecio] = useState('');
  const busquedaAvio = useDebounce(textoAvio.trim(), 300);

  // Catálogo de avíos para el selector (búsqueda server-side); se descartan los ya surtidos.
  const catalogo = useAvios({
    pagina: 1,
    porPagina: 20,
    ordenarPor: 'clave',
    direccion: 'asc',
    incluirInactivos: 'false',
    ...(busquedaAvio.length > 0 ? { busqueda: busquedaAvio } : {}),
  });

  const surtidos = consulta.data ?? [];
  const yaSurte = new Set(surtidos.map((a) => a.idAvio));
  const opciones: OpcionCombobox[] = (catalogo.data?.datos ?? [])
    .filter((a) => !yaSurte.has(a.id))
    .map((a) => ({ id: a.id, nombre: `${a.clave} · ${a.descripcion}` }));

  function cerrarForm(): void {
    setFormAbierto(false);
    setIdAvioSel(null);
    setTextoAvio('');
    setPrecio('');
  }

  function alAsignar(): void {
    if (idAvioSel === null) {
      toast.error('Elige el avío que te surte.');
      return;
    }
    const precioNum = precio.trim() === '' ? undefined : Number(precio);
    if (precioNum !== undefined && (Number.isNaN(precioNum) || precioNum < 0)) {
      toast.error('El precio debe ser un número ≥ 0.');
      return;
    }
    asignar.mutate(
      {
        idProveedor,
        cuerpo: { idAvio: idAvioSel, ...(precioNum === undefined ? {} : { precio: precioNum }) },
      },
      {
        onSuccess: () => {
          toast.success('Avío asignado.');
          cerrarForm();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function alQuitar(idAvio: number, clave: string): void {
    quitar.mutate(
      { idProveedor, idAvio },
      {
        onSuccess: () => toast.success(`Avío "${clave}" desvinculado.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  if (consulta.isPending) {
    return <p className="text-sm text-muted-foreground">Cargando avíos que surte…</p>;
  }
  if (consulta.isError) {
    return <p className="text-sm text-destructive">{consulta.error.message}</p>;
  }

  return (
    <div className="space-y-3" data-testid="avios-que-surte">
      {surtidos.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="avios-surte-vacio">
          Aún no surte avíos.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" data-testid="avios-surte-lista">
          {surtidos.map((a) => (
            <li
              key={a.idAvio}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-1.5"
              data-testid="avio-surtido"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">{a.descripcion}</div>
                <div className="num text-xs text-faint">
                  {a.clave} · {formatearPrecio(a.precio)} · su precio
                  {a.condiciones !== null && a.condiciones.trim() !== ''
                    ? ` · ${a.condiciones}`
                    : ''}
                </div>
              </div>
              {puedeAdministrar ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => alQuitar(a.idAvio, a.clave)}
                  disabled={quitar.isPending}
                  aria-label={`Quitar el avío ${a.clave}`}
                  data-testid="quitar-avio-surtido"
                >
                  <XIcon className="text-destructive" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {puedeAdministrar ? (
        formAbierto ? (
          <div
            className="space-y-2 rounded-lg border bg-muted/20 p-3"
            data-testid="form-asignar-avio"
          >
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Avío</label>
              <ComboboxBuscable
                opciones={opciones}
                valor={idAvioSel}
                onChange={setIdAvioSel}
                alCambiarTexto={setTextoAvio}
                placeholder="Buscar avío que ya tienes dado de alta…"
                textoVacio={
                  catalogo.isFetching ? 'Buscando…' : 'Sin avíos disponibles para asignar.'
                }
                testid="combo-avio-surtir"
                etiqueta="Avío que surte el proveedor"
              />
            </div>
            <div className="w-40">
              <label className="mb-1 block text-xs text-muted-foreground">
                Precio al que lo surte
              </label>
              <Input
                className="text-right"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                placeholder="0.00 (opcional)"
                aria-label="Precio al que el proveedor surte el avío"
                data-testid="precio-avio-surtir"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={alAsignar}
                disabled={asignar.isPending}
                data-testid="confirmar-asignar-avio"
              >
                {asignar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                Asignar
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={cerrarForm}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFormAbierto(true)}
            data-testid="asignar-avio-surtido"
          >
            <PlusIcon aria-hidden /> Asignar avío que surte
          </Button>
        )
      ) : null}
    </div>
  );
}
