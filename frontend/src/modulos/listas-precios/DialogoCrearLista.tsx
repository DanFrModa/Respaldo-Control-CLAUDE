import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useClientes, useDepartamentosCliente } from '@/api/clientes';
import { useCandidatosLista, useCrearLista } from '@/api/listas-precios';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { formatearMoneda } from '@/lib/formato';

/** Tope alto para el selector de clientes. */
const QUERY_CLIENTES = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/**
 * Diálogo para CREAR una lista de precios (F8-E4): elige cliente + departamento → carga los desarrollos
 * CANDIDATOS (cotizados, sin renglón en otra lista) → seleccionar → crear. Los candidatos sin precosto
 * congelado no aparecen; si el backend rechaza alguno (carrera), su mensaje se muestra en un toast.
 */
export function DialogoCrearLista({
  abierto,
  alCambiarAbierto,
  alCreada,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  alCreada?: (idLista: number) => void;
}): React.JSX.Element {
  const [idCliente, setIdCliente] = useState('');
  const [idDepartamento, setIdDepartamento] = useState('');
  const [fecha, setFecha] = useState('');
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());

  const clientes = useClientes(QUERY_CLIENTES);
  const departamentos = useDepartamentosCliente(idCliente === '' ? undefined : Number(idCliente));
  const candidatos = useCandidatosLista(
    idCliente === '' ? undefined : Number(idCliente),
    idDepartamento === '' ? undefined : Number(idDepartamento),
  );
  const crear = useCrearLista();

  // Reinicia todo al abrir/cerrar.
  useEffect(() => {
    if (!abierto) {
      setIdCliente('');
      setIdDepartamento('');
      setFecha('');
      setSeleccion(new Set());
    }
  }, [abierto]);

  // Al cambiar cliente/departamento, limpia la selección (los candidatos cambian).
  function cambiarCliente(valor: string): void {
    setIdCliente(valor);
    setIdDepartamento('');
    setSeleccion(new Set());
  }
  function cambiarDepartamento(valor: string): void {
    setIdDepartamento(valor);
    setSeleccion(new Set());
  }

  function alternar(idDesarrollo: number): void {
    setSeleccion((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(idDesarrollo)) {
        siguiente.delete(idDesarrollo);
      } else {
        siguiente.add(idDesarrollo);
      }
      return siguiente;
    });
  }

  const listaCandidatos = candidatos.data ?? [];

  function crearLista(): void {
    if (idCliente === '' || idDepartamento === '' || seleccion.size === 0) {
      return;
    }
    crear.mutate(
      {
        idCliente: Number(idCliente),
        idClienteDepartamento: Number(idDepartamento),
        idsDesarrollo: [...seleccion],
        ...(fecha === '' ? {} : { fecha }),
      },
      {
        onSuccess: (lista) => {
          toast.success(`Lista #${String(lista.folio)} creada.`);
          alCambiarAbierto(false);
          alCreada?.(lista.id);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva lista de precios</DialogTitle>
          <DialogDescription>
            Elige el cliente y el departamento; se listan los desarrollos cotizados que aún no están
            en una lista.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto py-2">
          <Field>
            <FieldLabel htmlFor="crear-lista-cliente">Cliente</FieldLabel>
            <SelectNativo
              id="crear-lista-cliente"
              value={idCliente}
              onChange={(e) => cambiarCliente(e.target.value)}
            >
              <option value="">Elige un cliente…</option>
              {(clientes.data?.datos ?? []).map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.nombre}
                </option>
              ))}
            </SelectNativo>
          </Field>

          <Field>
            <FieldLabel htmlFor="crear-lista-departamento">Departamento</FieldLabel>
            <SelectNativo
              id="crear-lista-departamento"
              value={idDepartamento}
              disabled={idCliente === ''}
              onChange={(e) => cambiarDepartamento(e.target.value)}
            >
              <option value="">Elige un departamento…</option>
              {(departamentos.data ?? [])
                .filter((d) => d.activo)
                .map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.nombre}
                  </option>
                ))}
            </SelectNativo>
          </Field>

          <Field>
            <FieldLabel htmlFor="crear-lista-fecha">Fecha (opcional)</FieldLabel>
            <Input
              id="crear-lista-fecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </Field>

          {idDepartamento !== '' ? (
            <div data-testid="candidatos-lista">
              <p className="mb-1 text-sm font-medium">Desarrollos a incluir</p>
              {candidatos.isPending ? (
                <p className="text-sm text-muted-foreground">Cargando desarrollos…</p>
              ) : listaCandidatos.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="candidatos-vacio">
                  No hay desarrollos cotizados disponibles para este departamento.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {listaCandidatos.map((c) => (
                    <li
                      key={c.idDesarrollo}
                      className="flex items-center gap-2 rounded-lg border p-2"
                      data-testid="fila-candidato"
                    >
                      <input
                        type="checkbox"
                        id={`cand-${String(c.idDesarrollo)}`}
                        checked={seleccion.has(c.idDesarrollo)}
                        onChange={() => alternar(c.idDesarrollo)}
                        className="size-4"
                      />
                      <label htmlFor={`cand-${String(c.idDesarrollo)}`} className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {c.codigoModelo}
                          {c.numeroCliente ? ` · ${c.numeroCliente}` : ''}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Proyecto #{c.folioProyecto} · v{c.versionPrecosto}
                          {c.costoTotal !== null ? ` · costo ${formatearMoneda(c.costoTotal)}` : ''}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={crear.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={crearLista}
            disabled={crear.isPending || seleccion.size === 0}
            data-testid="confirmar-crear-lista"
          >
            {crear.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Crear lista ({seleccion.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
