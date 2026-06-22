import { CalendarDays, Loader2Icon, Plus, Power, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useActualizarConfiguracion, useConfiguracionEmpresa, useEmpresas } from '@/api/empresas';
import {
  useActualizarFestivoRc,
  useCalendarioRc,
  useCrearFestivoRc,
  useDesactivarFestivoRc,
  useFestivosRc,
  useGuardarCalendarioRc,
} from '@/api/ruta-critica-plantillas';
import type { CalendarioRcActualizar } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSesion } from '@/sesion/useSesion';

/** Etiquetas de los 7 días de la semana, en orden de captura. */
const DIAS: { clave: keyof CalendarioRcActualizar; etiqueta: string }[] = [
  { clave: 'lunes', etiqueta: 'Lunes' },
  { clave: 'martes', etiqueta: 'Martes' },
  { clave: 'miercoles', etiqueta: 'Miércoles' },
  { clave: 'jueves', etiqueta: 'Jueves' },
  { clave: 'viernes', etiqueta: 'Viernes' },
  { clave: 'sabado', etiqueta: 'Sábado' },
  { clave: 'domingo', etiqueta: 'Domingo' },
];

/**
 * Pantalla de CONFIGURACIÓN de la Ruta Crítica por empresa (Administración, F5-E2): colchón de
 * costura (días), calendario laboral (días hábiles de la semana) y días festivos. El colchón vive
 * en la configuración de la empresa (`/empresas/:id/configuracion`); el calendario y los festivos,
 * en la RC. `empresas.administrar` da acceso a la pantalla; `rc.catalogo-administrar` habilita
 * escribir el calendario/festivos.
 */
export function ConfiguracionRcPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrarRc = tienePermiso('rc.catalogo-administrar');

  const empresas = useEmpresas();
  const [idEmpresa, setIdEmpresa] = useState<number | null>(null);

  // Selecciona la favorita (o la primera) en cuanto carga el catálogo.
  useEffect(() => {
    if (idEmpresa === null && empresas.data && empresas.data.length > 0) {
      const fav = empresas.data.find((e) => e.favorita) ?? empresas.data[0];
      if (fav) setIdEmpresa(fav.id);
    }
  }, [empresas.data, idEmpresa]);

  return (
    <div className="flex flex-col gap-5 p-4" data-testid="config-rc-pagina">
      <header className="flex items-center gap-3">
        <CalendarDays className="size-6 text-primary" aria-hidden />
        <div>
          <h1 className="text-lg font-semibold">Configuración de la Ruta Crítica</h1>
          <p className="text-sm text-muted-foreground">
            Colchón de costura, calendario laboral y festivos por empresa.
          </p>
        </div>
      </header>

      <Field className="max-w-xs">
        <FieldLabel htmlFor="empresa">Empresa</FieldLabel>
        <SelectNativo
          id="empresa"
          value={idEmpresa ?? ''}
          onChange={(e) => setIdEmpresa(Number(e.target.value))}
          data-testid="select-empresa-rc"
        >
          {(empresas.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </SelectNativo>
      </Field>

      {idEmpresa !== null ? (
        <>
          <ColchonCostura
            idEmpresa={idEmpresa}
            puedeAdministrar={tienePermiso('empresas.administrar')}
          />
          <CalendarioLaboral idEmpresa={idEmpresa} puedeAdministrar={puedeAdministrarRc} />
          <Festivos idEmpresa={idEmpresa} puedeAdministrar={puedeAdministrarRc} />
        </>
      ) : null}
    </div>
  );
}

// ── Colchón de costura (configuración de empresa) ─────────────────────────────

function ColchonCostura({
  idEmpresa,
  puedeAdministrar,
}: {
  idEmpresa: number;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const consulta = useConfiguracionEmpresa(idEmpresa);
  const guardar = useActualizarConfiguracion();
  const [colchon, setColchon] = useState('');

  useEffect(() => {
    if (consulta.data) {
      setColchon(consulta.data.colchonCostura === null ? '' : String(consulta.data.colchonCostura));
    }
  }, [consulta.data]);

  function alGuardar(): void {
    guardar.mutate(
      {
        id: idEmpresa,
        cuerpo: { colchonCostura: colchon === '' ? null : Number(colchon) },
      },
      {
        onSuccess: () => toast.success('Colchón de costura guardado.'),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-2 text-base font-semibold">Colchón de costura</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Días que la Ruta Crítica agrega a la costura como margen.
      </p>
      <div className="flex items-end gap-3">
        <Field className="max-w-[160px]">
          <FieldLabel htmlFor="colchon">Días</FieldLabel>
          <Input
            id="colchon"
            type="number"
            value={colchon}
            onChange={(e) => setColchon(e.target.value)}
            disabled={!puedeAdministrar}
            data-testid="input-colchon"
          />
        </Field>
        {puedeAdministrar ? (
          <Button onClick={alGuardar} disabled={guardar.isPending} data-testid="guardar-colchon">
            {guardar.isPending ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Guardar
          </Button>
        ) : null}
      </div>
    </section>
  );
}

// ── Calendario laboral (días hábiles) ─────────────────────────────────────────

function CalendarioLaboral({
  idEmpresa,
  puedeAdministrar,
}: {
  idEmpresa: number;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const consulta = useCalendarioRc(idEmpresa);
  const guardar = useGuardarCalendarioRc();
  const [dias, setDias] = useState<CalendarioRcActualizar>({
    lunes: true,
    martes: true,
    miercoles: true,
    jueves: true,
    viernes: true,
    sabado: false,
    domingo: false,
  });

  useEffect(() => {
    if (consulta.data) {
      const { lunes, martes, miercoles, jueves, viernes, sabado, domingo } = consulta.data;
      setDias({ lunes, martes, miercoles, jueves, viernes, sabado, domingo });
    }
  }, [consulta.data]);

  function alGuardar(): void {
    guardar.mutate(
      { idEmpresa, cuerpo: dias },
      {
        onSuccess: () => toast.success('Calendario guardado.'),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-2 text-base font-semibold">Calendario laboral</h2>
      <p className="mb-3 text-sm text-muted-foreground">Qué días de la semana se trabaja.</p>
      <div className="flex flex-wrap gap-3" data-testid="dias-semana">
        {DIAS.map((d) => (
          <label key={d.clave} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary disabled:opacity-50"
              checked={dias[d.clave]}
              disabled={!puedeAdministrar}
              onChange={(e) => setDias((prev) => ({ ...prev, [d.clave]: e.target.checked }))}
              data-testid={`dia-${d.clave}`}
            />
            {d.etiqueta}
          </label>
        ))}
      </div>
      {puedeAdministrar ? (
        <Button
          className="mt-3"
          size="sm"
          onClick={alGuardar}
          disabled={guardar.isPending}
          data-testid="guardar-calendario"
        >
          {guardar.isPending ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Guardar calendario
        </Button>
      ) : null}
    </section>
  );
}

// ── Festivos ──────────────────────────────────────────────────────────────────

function Festivos({
  idEmpresa,
  puedeAdministrar,
}: {
  idEmpresa: number;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const consulta = useFestivosRc(idEmpresa, true);
  const crear = useCrearFestivoRc();
  const actualizar = useActualizarFestivoRc();
  const desactivar = useDesactivarFestivoRc();

  const [fecha, setFecha] = useState('');
  const [descripcion, setDescripcion] = useState('');

  function alAgregar(): void {
    crear.mutate(
      { idEmpresa, cuerpo: { idEmpresa, fecha, descripcion } },
      {
        onSuccess: () => {
          toast.success('Festivo agregado.');
          setFecha('');
          setDescripcion('');
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-2 text-base font-semibold">Días festivos</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Días no laborables propios de la empresa (además de los fines de semana).
      </p>

      {puedeAdministrar ? (
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field className="max-w-[200px]">
            <FieldLabel htmlFor="fest-fecha">Fecha</FieldLabel>
            <Input
              id="fest-fecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              data-testid="festivo-fecha"
            />
          </Field>
          <Field className="max-w-xs flex-1">
            <FieldLabel htmlFor="fest-desc">Descripción</FieldLabel>
            <Input
              id="fest-desc"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              data-testid="festivo-descripcion"
            />
          </Field>
          <Button
            onClick={alAgregar}
            disabled={crear.isPending || fecha === '' || descripcion === ''}
            data-testid="agregar-festivo"
          >
            <Plus className="size-4" /> Agregar
          </Button>
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Descripción</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(consulta.data ?? []).map((f) => (
            <TableRow key={f.id} className={f.activo ? '' : 'opacity-50'}>
              <TableCell>{f.fecha}</TableCell>
              <TableCell>{f.descripcion}</TableCell>
              <TableCell>{f.activo ? 'Activo' : 'Inactivo'}</TableCell>
              <TableCell>
                {puedeAdministrar ? (
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={f.activo ? 'Desactivar' : 'Reactivar'}
                      onClick={() =>
                        f.activo
                          ? desactivar.mutate(f.id, { onError: (e) => toast.error(e.message) })
                          : actualizar.mutate(
                              { id: f.id, cuerpo: { activo: true } },
                              { onError: (e) => toast.error(e.message) },
                            )
                      }
                    >
                      {f.activo ? <Power className="size-4" /> : <RotateCcw className="size-4" />}
                    </Button>
                  </div>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
