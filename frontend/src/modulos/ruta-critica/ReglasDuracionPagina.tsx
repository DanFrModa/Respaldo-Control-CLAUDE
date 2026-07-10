import { Loader2Icon, Pencil, Plus, Power, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useActualizarDuracionAplicacionRc,
  useActualizarDuracionTelaRc,
  useActualizarFactorCantidadRc,
  useCrearDuracionAplicacionRc,
  useCrearDuracionTelaRc,
  useCrearFactorCantidadRc,
  useDesactivarDuracionAplicacionRc,
  useDesactivarDuracionTelaRc,
  useDesactivarFactorCantidadRc,
  useDuracionesAplicacionRc,
  useDuracionesTelaRc,
  useFactoresCantidadRc,
} from '@/api/ruta-critica-plantillas';
import type { DuracionAplicacionRc, DuracionTelaRc, FactorCantidadRc } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSesion } from '@/sesion/useSesion';

type Pestana = 'cantidad' | 'tela' | 'aplicacion';

/**
 * Pantalla de REGLAS DE DURACIÓN de la Ruta Crítica (F5-E2): una pantalla con 3 pestañas
 * (factores por cantidad / días por tipo de tela / días por aplicación). El motor de E4 las usará
 * para estimar fechas. `rc.catalogo-ver` da acceso; `rc.catalogo-administrar` habilita las
 * escrituras. CERO lógica: el backend valida (rangos, unicidad) y devuelve errores en español.
 */
export function ReglasDuracionPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('rc.catalogo-administrar');
  const [pestana, setPestana] = useState<Pestana>('cantidad');

  const PESTANAS: { clave: Pestana; titulo: string }[] = [
    { clave: 'cantidad', titulo: 'Por cantidad' },
    { clave: 'tela', titulo: 'Por tipo de tela' },
    { clave: 'aplicacion', titulo: 'Por aplicación' },
  ];

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="reglas-duracion-pagina">
      <header>
        <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
          Reglas de duración de la Ruta Crítica
        </h1>
        <p className="text-[12.5px] text-muted-foreground">
          Factores y días de espera que el motor de fechas usará para estimar la ruta.
        </p>
      </header>

      <div className="flex gap-1 border-b" role="tablist">
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            type="button"
            role="tab"
            aria-selected={pestana === p.clave}
            onClick={() => setPestana(p.clave)}
            data-testid={`tab-${p.clave}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              pestana === p.clave
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {p.titulo}
          </button>
        ))}
      </div>

      {pestana === 'cantidad' ? <TabCantidad puedeAdministrar={puedeAdministrar} /> : null}
      {pestana === 'tela' ? <TabTela puedeAdministrar={puedeAdministrar} /> : null}
      {pestana === 'aplicacion' ? <TabAplicacion puedeAdministrar={puedeAdministrar} /> : null}
    </div>
  );
}

/** Botonera de acciones por fila (editar / des-reactivar), visible solo con permiso. */
function AccionesFila({
  activo,
  puedeAdministrar,
  alEditar,
  alAlternar,
}: {
  activo: boolean;
  puedeAdministrar: boolean;
  alEditar: () => void;
  alAlternar: () => void;
}): React.JSX.Element | null {
  if (!puedeAdministrar) return null;
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon" onClick={alEditar} aria-label="Editar">
        <Pencil className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={alAlternar}
        aria-label={activo ? 'Desactivar' : 'Reactivar'}
      >
        {activo ? <Power className="size-4" /> : <RotateCcw className="size-4" />}
      </Button>
    </div>
  );
}

// ── Pestaña: factor por cantidad ──────────────────────────────────────────────

function TabCantidad({ puedeAdministrar }: { puedeAdministrar: boolean }): React.JSX.Element {
  const consulta = useFactoresCantidadRc(true);
  const crear = useCrearFactorCantidadRc();
  const actualizar = useActualizarFactorCantidadRc();
  const desactivar = useDesactivarFactorCantidadRc();

  const [dialogo, setDialogo] = useState(false);
  const [edicion, setEdicion] = useState<FactorCantidadRc | null>(null);
  const [deCant, setDeCant] = useState('');
  const [aCant, setACant] = useState('');
  const [factor, setFactor] = useState('');

  function abrir(fila: FactorCantidadRc | null): void {
    setEdicion(fila);
    setDeCant(fila ? String(fila.deCant) : '');
    setACant(fila ? String(fila.aCant) : '');
    setFactor(fila ? String(fila.factor) : '');
    setDialogo(true);
  }

  function guardar(): void {
    const cuerpo = { deCant: Number(deCant), aCant: Number(aCant), factor: Number(factor) };
    const opciones = {
      onSuccess: () => {
        toast.success('Factor guardado.');
        setDialogo(false);
      },
      onError: (e: Error) => toast.error(e.message),
    };
    if (edicion) {
      actualizar.mutate({ id: edicion.id, cuerpo }, opciones);
    } else {
      crear.mutate(cuerpo, opciones);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      {puedeAdministrar ? (
        <div>
          <Button size="sm" onClick={() => abrir(null)} data-testid="nuevo-factor">
            <Plus className="size-4" /> Nuevo rango
          </Button>
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Desde</TableHead>
            <TableHead>Hasta</TableHead>
            <TableHead>Factor</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(consulta.data ?? []).map((f) => (
            <TableRow key={f.id} className={f.activo ? '' : 'opacity-50'}>
              <TableCell>{f.deCant}</TableCell>
              <TableCell>{f.aCant}</TableCell>
              <TableCell>{f.factor}</TableCell>
              <TableCell>{f.activo ? 'Activo' : 'Inactivo'}</TableCell>
              <TableCell>
                <AccionesFila
                  activo={f.activo}
                  puedeAdministrar={puedeAdministrar}
                  alEditar={() => abrir(f)}
                  alAlternar={() =>
                    f.activo
                      ? desactivar.mutate(f.id, { onError: (e) => toast.error(e.message) })
                      : actualizar.mutate(
                          { id: f.id, cuerpo: { activo: true } },
                          { onError: (e) => toast.error(e.message) },
                        )
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={dialogo} onOpenChange={setDialogo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edicion ? 'Editar rango' : 'Nuevo rango'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="f-de">Desde (piezas)</FieldLabel>
              <Input
                id="f-de"
                type="number"
                value={deCant}
                onChange={(e) => setDeCant(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="f-a">Hasta (piezas)</FieldLabel>
              <Input
                id="f-a"
                type="number"
                value={aCant}
                onChange={(e) => setACant(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="f-factor">Factor</FieldLabel>
              <Input
                id="f-factor"
                type="number"
                step="0.01"
                value={factor}
                onChange={(e) => setFactor(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              onClick={guardar}
              disabled={crear.isPending || actualizar.isPending}
              data-testid="guardar-factor"
            >
              {crear.isPending || actualizar.isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ── Pestaña: días por tipo de tela ────────────────────────────────────────────

function TabTela({ puedeAdministrar }: { puedeAdministrar: boolean }): React.JSX.Element {
  const consulta = useDuracionesTelaRc(true);
  const crear = useCrearDuracionTelaRc();
  const actualizar = useActualizarDuracionTelaRc();
  const desactivar = useDesactivarDuracionTelaRc();

  const [dialogo, setDialogo] = useState(false);
  const [edicion, setEdicion] = useState<DuracionTelaRc | null>(null);
  const [nombre, setNombre] = useState('');
  const [dias, setDias] = useState('');
  const [factorTela, setFactorTela] = useState('');

  function abrir(fila: DuracionTelaRc | null): void {
    setEdicion(fila);
    setNombre(fila?.nombre ?? '');
    setDias(fila ? String(fila.dias) : '');
    setFactorTela(fila ? String(fila.factorTela) : '');
    setDialogo(true);
  }

  function guardar(): void {
    const cuerpo = { nombre, dias: Number(dias), factorTela: Number(factorTela) };
    const opciones = {
      onSuccess: () => {
        toast.success('Tipo de tela guardado.');
        setDialogo(false);
      },
      onError: (e: Error) => toast.error(e.message),
    };
    if (edicion) {
      actualizar.mutate({ id: edicion.id, cuerpo }, opciones);
    } else {
      crear.mutate(cuerpo, opciones);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      {puedeAdministrar ? (
        <div>
          <Button size="sm" onClick={() => abrir(null)} data-testid="nuevo-tela">
            <Plus className="size-4" /> Nuevo tipo de tela
          </Button>
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tipo de tela</TableHead>
            <TableHead>Días</TableHead>
            <TableHead>Factor tela</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(consulta.data ?? []).map((t) => (
            <TableRow key={t.id} className={t.activo ? '' : 'opacity-50'}>
              <TableCell>{t.nombre}</TableCell>
              <TableCell>{t.dias}</TableCell>
              <TableCell>{t.factorTela}</TableCell>
              <TableCell>{t.activo ? 'Activo' : 'Inactivo'}</TableCell>
              <TableCell>
                <AccionesFila
                  activo={t.activo}
                  puedeAdministrar={puedeAdministrar}
                  alEditar={() => abrir(t)}
                  alAlternar={() =>
                    t.activo
                      ? desactivar.mutate(t.id, { onError: (e) => toast.error(e.message) })
                      : actualizar.mutate(
                          { id: t.id, cuerpo: { activo: true } },
                          { onError: (e) => toast.error(e.message) },
                        )
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={dialogo} onOpenChange={setDialogo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edicion ? 'Editar tipo de tela' : 'Nuevo tipo de tela'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="t-nombre">Nombre</FieldLabel>
              <Input id="t-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="t-dias">Días</FieldLabel>
              <Input
                id="t-dias"
                type="number"
                value={dias}
                onChange={(e) => setDias(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="t-factor">Factor tela</FieldLabel>
              <Input
                id="t-factor"
                type="number"
                step="0.01"
                value={factorTela}
                onChange={(e) => setFactorTela(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              onClick={guardar}
              disabled={crear.isPending || actualizar.isPending}
              data-testid="guardar-tela"
            >
              {crear.isPending || actualizar.isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ── Pestaña: días por aplicación ──────────────────────────────────────────────

function TabAplicacion({ puedeAdministrar }: { puedeAdministrar: boolean }): React.JSX.Element {
  const consulta = useDuracionesAplicacionRc(true);
  const crear = useCrearDuracionAplicacionRc();
  const actualizar = useActualizarDuracionAplicacionRc();
  const desactivar = useDesactivarDuracionAplicacionRc();

  const [dialogo, setDialogo] = useState(false);
  const [edicion, setEdicion] = useState<DuracionAplicacionRc | null>(null);
  const [nombre, setNombre] = useState('');
  const [clave, setClave] = useState('');
  const [dias, setDias] = useState('');

  function abrir(fila: DuracionAplicacionRc | null): void {
    setEdicion(fila);
    setNombre(fila?.nombre ?? '');
    setClave(fila?.clave ?? '');
    setDias(fila ? String(fila.dias) : '');
    setDialogo(true);
  }

  function guardar(): void {
    const cuerpo = { nombre, clave: clave === '' ? null : clave, dias: Number(dias) };
    const opciones = {
      onSuccess: () => {
        toast.success('Aplicación guardada.');
        setDialogo(false);
      },
      onError: (e: Error) => toast.error(e.message),
    };
    if (edicion) {
      actualizar.mutate({ id: edicion.id, cuerpo }, opciones);
    } else {
      crear.mutate(cuerpo, opciones);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      {puedeAdministrar ? (
        <div>
          <Button size="sm" onClick={() => abrir(null)} data-testid="nuevo-aplicacion">
            <Plus className="size-4" /> Nueva aplicación
          </Button>
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Aplicación</TableHead>
            <TableHead>Clave</TableHead>
            <TableHead>Días</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(consulta.data ?? []).map((a) => (
            <TableRow key={a.id} className={a.activo ? '' : 'opacity-50'}>
              <TableCell>{a.nombre}</TableCell>
              <TableCell>{a.clave ?? '—'}</TableCell>
              <TableCell>{a.dias}</TableCell>
              <TableCell>{a.activo ? 'Activo' : 'Inactivo'}</TableCell>
              <TableCell>
                <AccionesFila
                  activo={a.activo}
                  puedeAdministrar={puedeAdministrar}
                  alEditar={() => abrir(a)}
                  alAlternar={() =>
                    a.activo
                      ? desactivar.mutate(a.id, { onError: (e) => toast.error(e.message) })
                      : actualizar.mutate(
                          { id: a.id, cuerpo: { activo: true } },
                          { onError: (e) => toast.error(e.message) },
                        )
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={dialogo} onOpenChange={setDialogo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edicion ? 'Editar aplicación' : 'Nueva aplicación'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="a-nombre">Nombre</FieldLabel>
              <Input id="a-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="a-clave">Clave (opcional)</FieldLabel>
              <Input id="a-clave" value={clave} onChange={(e) => setClave(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="a-dias">Días</FieldLabel>
              <Input
                id="a-dias"
                type="number"
                value={dias}
                onChange={(e) => setDias(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              onClick={guardar}
              disabled={crear.isPending || actualizar.isPending}
              data-testid="guardar-aplicacion"
            >
              {crear.isPending || actualizar.isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
