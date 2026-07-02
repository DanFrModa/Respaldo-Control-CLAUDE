import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useAuditoria, useModificarAuditoria } from '@/api/calidad';
import { ETIQUETAS_TIPO_AUDITORIA, TIPOS_AUDITORIA } from '@/api/esquemas';
import { useProveedores } from '@/api/proveedores';
import type { AuditoriaModificar, TipoAuditoria } from '@/api/tipos';
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

/**
 * Diálogo para MODIFICAR los datos de ENCABEZADO de una auditoría (F6-E3 — ex `CC_ModificarDatos`):
 * maquilero, fechas, tipo y observaciones. NO toca las fallas (eso es la captura). Carga el detalle
 * actual con `useAuditoria` para sembrar los campos; el backend valida (A1) que el maquilero elegido
 * sea uno de los que participaron en la orden. Gobernado por `calidad.modificar-auditorias`.
 */
export function DialogoModificarAuditoria({
  idAuditoria,
  abierto,
  alCambiarAbierto,
}: {
  idAuditoria: number | undefined;
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
}): React.JSX.Element {
  const consulta = useAuditoria(abierto ? idAuditoria : undefined);
  const auditoria = consulta.data;
  const modificar = useModificarAuditoria();
  const proveedores = useProveedores({ pagina: 1, porPagina: 100, ordenarPor: 'nombre' });

  const [idMaquilero, setIdMaquilero] = useState('');
  const [fechaElaboracion, setFechaElaboracion] = useState('');
  const [fechaAuditoria, setFechaAuditoria] = useState('');
  const [tipoAuditoria, setTipoAuditoria] = useState<TipoAuditoria>('no_definida');
  const [observaciones, setObservaciones] = useState('');
  const [sembradoId, setSembradoId] = useState<number | undefined>(undefined);

  // Siembra los campos desde el detalle actual (una vez por auditoría/apertura).
  useEffect(() => {
    if (abierto && auditoria !== undefined && sembradoId !== auditoria.id) {
      setIdMaquilero(auditoria.idMaquilero === null ? '' : String(auditoria.idMaquilero));
      setFechaElaboracion(auditoria.fechaElaboracion);
      setFechaAuditoria(auditoria.fechaAuditoria);
      setTipoAuditoria(auditoria.tipoAuditoria);
      setObservaciones(auditoria.observaciones ?? '');
      setSembradoId(auditoria.id);
    }
    if (!abierto) {
      setSembradoId(undefined);
    }
  }, [abierto, auditoria, sembradoId]);

  // Opciones de maquilero: catálogo + el maquilero actual (por si no está entre los primeros 100).
  const opciones = proveedores.data?.datos ?? [];
  const actualFaltante =
    auditoria?.idMaquilero != null && !opciones.some((p) => p.id === auditoria.idMaquilero)
      ? [
          {
            id: auditoria.idMaquilero,
            nombre: auditoria.maquilero ?? `Proveedor ${auditoria.idMaquilero}`,
          },
        ]
      : [];

  function guardar(): void {
    if (idAuditoria === undefined) return;
    const cuerpo: AuditoriaModificar = {
      idMaquilero: idMaquilero === '' ? null : Number(idMaquilero),
      fechaElaboracion,
      fechaAuditoria,
      tipoAuditoria,
      observaciones: observaciones.trim() === '' ? null : observaciones.trim(),
    };
    modificar.mutate(
      { id: idAuditoria, cuerpo },
      {
        onSuccess: (a) => {
          toast.success(`Auditoría #${a.numAuditoria} actualizada.`);
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modificar auditoría</DialogTitle>
          <DialogDescription>
            Cambia el maquilero, las fechas, el tipo y las observaciones. No edita las fallas.
          </DialogDescription>
        </DialogHeader>

        {consulta.isPending ? (
          <p className="py-4 text-sm text-muted-foreground">Cargando auditoría…</p>
        ) : consulta.isError || auditoria === undefined ? (
          <p className="py-4 text-sm text-destructive" role="alert">
            {consulta.error?.message ?? 'No se pudo cargar la auditoría.'}
          </p>
        ) : (
          <div className="space-y-4 py-4">
            <Field>
              <FieldLabel htmlFor="mod-maquilero">Maquilero</FieldLabel>
              <SelectNativo
                id="mod-maquilero"
                value={idMaquilero}
                onChange={(e) => setIdMaquilero(e.target.value)}
                data-testid="modificar-maquilero"
              >
                <option value="">Sin maquilero</option>
                {[...actualFaltante, ...opciones].map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>

            <Field>
              <FieldLabel htmlFor="mod-tipo">Tipo</FieldLabel>
              <SelectNativo
                id="mod-tipo"
                value={tipoAuditoria}
                onChange={(e) => setTipoAuditoria(e.target.value as TipoAuditoria)}
                data-testid="modificar-tipo"
              >
                {TIPOS_AUDITORIA.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETAS_TIPO_AUDITORIA[t]}
                  </option>
                ))}
              </SelectNativo>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="mod-fecha-elab">Fecha de elaboración</FieldLabel>
                <Input
                  id="mod-fecha-elab"
                  type="date"
                  value={fechaElaboracion}
                  onChange={(e) => setFechaElaboracion(e.target.value)}
                  data-testid="modificar-fecha-elaboracion"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="mod-fecha-aud">Fecha de auditoría</FieldLabel>
                <Input
                  id="mod-fecha-aud"
                  type="date"
                  value={fechaAuditoria}
                  onChange={(e) => setFechaAuditoria(e.target.value)}
                  data-testid="modificar-fecha-auditoria"
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="mod-observaciones">Observaciones</FieldLabel>
              <Input
                id="mod-observaciones"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Notas del encabezado (opcional)"
                data-testid="modificar-observaciones"
              />
            </Field>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={modificar.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={guardar}
            disabled={modificar.isPending || auditoria === undefined}
            data-testid="modificar-guardar"
          >
            {modificar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
