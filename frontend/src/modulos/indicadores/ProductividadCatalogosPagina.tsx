import { useState } from 'react';
import { toast } from 'sonner';

import {
  useActividades,
  useActualizarActividad,
  useActualizarPersonal,
  useCrearActividad,
  useCrearPersonal,
  usePersonal,
} from '@/api/productividad';
import type { ActividadProductividad, PersonalArea } from '@/api/tipos';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

import { numero } from './comun';

type Area = 'ip' | 'almacen';

/**
 * CATÁLOGOS de productividad (F7-E4): personas del área (← IP_Personal) y actividades con sus
 * estándares por área (← IP_Actividades / Alm_Prd_Act). Un toggle elige el área; cada tabla tiene su
 * alta/edición y su des/reactivación (borrado suave). El backend re-verifica el permiso de captura
 * del área (A1/A4).
 */
export function ProductividadCatalogosPagina(): React.JSX.Element {
  const [area, setArea] = useState<Area>('ip');

  return (
    <div
      className="h-full overflow-y-auto space-y-6 p-4 md:p-6"
      data-testid="productividad-catalogos"
    >
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Catálogos de productividad
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Personas y actividades por área
          </p>
        </div>
        <SelectNativo
          className="h-8 w-auto text-sm"
          value={area}
          onChange={(e) => setArea(e.target.value as Area)}
          aria-label="Área"
          data-testid="cat-area"
        >
          <option value="ip">Ingeniería del Producto</option>
          <option value="almacen">Almacén</option>
        </SelectNativo>
      </header>

      <PersonalCard area={area} />
      <ActividadesCard area={area} />
    </div>
  );
}

// ── Personal ─────────────────────────────────────────────────────────────────

function PersonalCard({ area }: { area: Area }): React.JSX.Element {
  const consulta = usePersonal({ area, porPagina: 100, incluirInactivos: 'true' });
  const crear = useCrearPersonal();
  const actualizar = useActualizarPersonal();
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<PersonalArea | null>(null);
  const [nombre, setNombre] = useState('');
  const [horasBase, setHorasBase] = useState('');
  const [puesto, setPuesto] = useState('');

  function abrir(p: PersonalArea | null): void {
    setEditando(p);
    setNombre(p?.nombre ?? '');
    setHorasBase(p?.horasBase != null ? String(p.horasBase) : '');
    setPuesto(p?.puesto ?? '');
    setAbierto(true);
  }

  function guardar(e: React.FormEvent): void {
    e.preventDefault();
    if (nombre.trim() === '') {
      toast.error('El nombre es obligatorio.');
      return;
    }
    const base = {
      nombre: nombre.trim(),
      ...(horasBase === '' ? {} : { horasBase: Number(horasBase) }),
      ...(puesto.trim() === '' ? {} : { puesto: puesto.trim() }),
    };
    const alExito = (): void => {
      toast.success('Persona guardada.');
      setAbierto(false);
    };
    const alError = (err: Error): void => {
      toast.error(err.message);
    };
    if (editando === null) {
      crear.mutate({ ...base, area }, { onSuccess: alExito, onError: alError });
    } else {
      actualizar.mutate(
        { id: editando.id, cambios: base },
        { onSuccess: alExito, onError: alError },
      );
    }
  }

  const filas = consulta.data?.datos ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Personas</CardTitle>
          <CardDescription>Personal del área con su jornada base (IP).</CardDescription>
        </div>
        <Button type="button" onClick={() => abrir(null)} data-testid="personal-nuevo">
          Nueva persona
        </Button>
      </CardHeader>
      <CardContent>
        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : filas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin personas.</p>
        ) : (
          <div className="overflow-x-auto">
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Nombre</TablaDensaHead>
                  <TablaDensaHead>Puesto</TablaDensaHead>
                  <TablaDensaHead numerica>Horas base</TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                  <TablaDensaHead className="text-right">Acciones</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((p) => (
                  <TablaDensaFila key={p.id} data-testid={`personal-${p.id}`}>
                    <TablaDensaCelda>{p.nombre}</TablaDensaCelda>
                    <TablaDensaCelda className="text-muted-foreground">
                      {p.puesto ?? '—'}
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>{numero(p.horasBase)}</TablaDensaCelda>
                    <TablaDensaCelda>
                      <ChipEstado tono={p.activo ? 'ok' : 'neutro'}>
                        {p.activo ? 'Activa' : 'Inactiva'}
                      </ChipEstado>
                    </TablaDensaCelda>
                    <TablaDensaCelda className="text-right">
                      <Button type="button" variant="ghost" size="sm" onClick={() => abrir(p)}>
                        Editar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          actualizar.mutate(
                            { id: p.id, cambios: { activo: !p.activo } },
                            {
                              onSuccess: () =>
                                toast.success(p.activo ? 'Desactivada.' : 'Activada.'),
                              onError: (err) => toast.error(err.message),
                            },
                          )
                        }
                      >
                        {p.activo ? 'Desactivar' : 'Activar'}
                      </Button>
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          </div>
        )}
      </CardContent>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent>
          <form onSubmit={guardar}>
            <DialogHeader>
              <DialogTitle>{editando === null ? 'Nueva persona' : 'Editar persona'}</DialogTitle>
              <DialogDescription>Datos de la persona del área.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <Field>
                <FieldLabel htmlFor="per-nombre">Nombre</FieldLabel>
                <Input
                  id="per-nombre"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  data-testid="per-nombre"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="per-puesto">Puesto</FieldLabel>
                <Input id="per-puesto" value={puesto} onChange={(e) => setPuesto(e.target.value)} />
              </Field>
              {area === 'ip' && (
                <Field>
                  <FieldLabel htmlFor="per-horas">Horas base (jornada)</FieldLabel>
                  <Input
                    id="per-horas"
                    type="number"
                    min={0}
                    step="any"
                    value={horasBase}
                    onChange={(e) => setHorasBase(e.target.value)}
                  />
                </Field>
              )}
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={crear.isPending || actualizar.isPending}
                data-testid="per-guardar"
              >
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Actividades ──────────────────────────────────────────────────────────────

function ActividadesCard({ area }: { area: Area }): React.JSX.Element {
  const consulta = useActividades({ area, porPagina: 100, incluirInactivos: 'true' });
  const crear = useCrearActividad();
  const actualizar = useActualizarActividad();
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<ActividadProductividad | null>(null);
  const [nombre, setNombre] = useState('');
  const [porcentajeD, setPorcentajeD] = useState('');
  const [pzPersDia, setPzPersDia] = useState('');
  const [porcenPzas, setPorcenPzas] = useState('');

  function abrir(a: ActividadProductividad | null): void {
    setEditando(a);
    setNombre(a?.nombre ?? '');
    setPorcentajeD(a?.porcentajeD != null ? String(a.porcentajeD) : '');
    setPzPersDia(a?.pzPersDia != null ? String(a.pzPersDia) : '');
    setPorcenPzas(a?.porcenPzas != null ? String(a.porcenPzas) : '');
    setAbierto(true);
  }

  function guardar(e: React.FormEvent): void {
    e.preventDefault();
    if (nombre.trim() === '') {
      toast.error('El nombre es obligatorio.');
      return;
    }
    if (area === 'almacen' && (pzPersDia === '' || Number(pzPersDia) <= 0)) {
      toast.error('El estándar de piezas/persona/día debe ser mayor a cero.');
      return;
    }
    const base =
      area === 'ip'
        ? {
            nombre: nombre.trim(),
            ...(porcentajeD === '' ? {} : { porcentajeD: Number(porcentajeD) }),
          }
        : {
            nombre: nombre.trim(),
            pzPersDia: Number(pzPersDia),
            ...(porcenPzas === '' ? {} : { porcenPzas: Number(porcenPzas) }),
          };
    const alExito = (): void => {
      toast.success('Actividad guardada.');
      setAbierto(false);
    };
    const alError = (err: Error): void => {
      toast.error(err.message);
    };
    if (editando === null) {
      crear.mutate({ ...base, area }, { onSuccess: alExito, onError: alError });
    } else {
      actualizar.mutate(
        { id: editando.id, cambios: base },
        { onSuccess: alExito, onError: alError },
      );
    }
  }

  const filas = consulta.data?.datos ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Actividades</CardTitle>
          <CardDescription>Actividades y su estándar por área.</CardDescription>
        </div>
        <Button type="button" onClick={() => abrir(null)} data-testid="actividad-nueva">
          Nueva actividad
        </Button>
      </CardHeader>
      <CardContent>
        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : filas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin actividades.</p>
        ) : (
          <div className="overflow-x-auto">
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Nombre</TablaDensaHead>
                  <TablaDensaHead numerica>
                    {area === 'ip' ? 'Peso (%D)' : 'Pz/pers/día'}
                  </TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                  <TablaDensaHead className="text-right">Acciones</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((a) => (
                  <TablaDensaFila key={a.id} data-testid={`actividad-${a.id}`}>
                    <TablaDensaCelda>{a.nombre}</TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      {numero(area === 'ip' ? a.porcentajeD : a.pzPersDia)}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <ChipEstado tono={a.activo ? 'ok' : 'neutro'}>
                        {a.activo ? 'Activa' : 'Inactiva'}
                      </ChipEstado>
                    </TablaDensaCelda>
                    <TablaDensaCelda className="text-right">
                      <Button type="button" variant="ghost" size="sm" onClick={() => abrir(a)}>
                        Editar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          actualizar.mutate(
                            { id: a.id, cambios: { activo: !a.activo } },
                            {
                              onSuccess: () =>
                                toast.success(a.activo ? 'Desactivada.' : 'Activada.'),
                              onError: (err) => toast.error(err.message),
                            },
                          )
                        }
                      >
                        {a.activo ? 'Desactivar' : 'Activar'}
                      </Button>
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          </div>
        )}
      </CardContent>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent>
          <form onSubmit={guardar}>
            <DialogHeader>
              <DialogTitle>
                {editando === null ? 'Nueva actividad' : 'Editar actividad'}
              </DialogTitle>
              <DialogDescription>Estándar de la actividad del área.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <Field>
                <FieldLabel htmlFor="act-nombre">Nombre</FieldLabel>
                <Input
                  id="act-nombre"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  data-testid="act-nombre"
                />
              </Field>
              {area === 'ip' ? (
                <Field>
                  <FieldLabel htmlFor="act-peso">Peso / estándar (%D)</FieldLabel>
                  <Input
                    id="act-peso"
                    type="number"
                    min={0}
                    step="any"
                    value={porcentajeD}
                    onChange={(e) => setPorcentajeD(e.target.value)}
                  />
                </Field>
              ) : (
                <>
                  <Field>
                    <FieldLabel htmlFor="act-pzdia">Piezas / persona / día</FieldLabel>
                    <Input
                      id="act-pzdia"
                      type="number"
                      min={0}
                      step="any"
                      value={pzPersDia}
                      onChange={(e) => setPzPersDia(e.target.value)}
                      data-testid="act-pzdia"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="act-porcenpz">Peso de piezas (opcional)</FieldLabel>
                    <Input
                      id="act-porcenpz"
                      type="number"
                      min={0}
                      step="any"
                      value={porcenPzas}
                      onChange={(e) => setPorcenPzas(e.target.value)}
                    />
                  </Field>
                </>
              )}
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={crear.isPending || actualizar.isPending}
                data-testid="act-guardar"
              >
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
