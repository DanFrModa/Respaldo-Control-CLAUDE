import { Ban } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useClientes } from '@/api/clientes';
import {
  useActividades,
  useCancelarRegistroProductividad,
  usePersonal,
  useRegistrarProductividad,
  useRegistrosProductividad,
} from '@/api/productividad';
import type { RegistroProductividadCrear } from '@/api/tipos';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { atajosFecha, numero, porcentaje } from './comun';

type Area = 'ip' | 'almacen';

/**
 * CAPTURA unificada de productividad IP/Almacén (F7-E4; doc 05 §A.1/§B.1). Una sola pantalla para las
 * dos áreas: se elige el área, la actividad (y la persona en IP), y se captura cantidad/horas. Atajos
 * Hoy/Ayer/Sábado para la captura móvil; la fecha libre exige `indicadores.fecha-libre` (el backend
 * re-verifica, A1). El índice lo calcula el servidor y se muestra en la lista de registros recientes.
 */
export function CapturaProductividadPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeFechaLibre = tienePermiso('indicadores.fecha-libre');

  const [area, setArea] = useState<Area>('ip');
  const [fecha, setFecha] = useState(atajosFecha.hoy());
  const [idActividad, setIdActividad] = useState('');
  const [idPersona, setIdPersona] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [horas, setHoras] = useState('');
  const [personas, setPersonas] = useState('1');
  const [idCliente, setIdCliente] = useState('');

  const actividades = useActividades({ area, porPagina: 100 });
  const personal = usePersonal({ area: 'ip', porPagina: 100 });
  const clientes = useClientes({ porPagina: 100 });
  const registros = useRegistrosProductividad({ area, porPagina: 20 });
  const registrar = useRegistrarProductividad();
  const cancelar = useCancelarRegistroProductividad();

  const actividadesArea = actividades.data?.datos ?? [];

  function limpiar(): void {
    setCantidad('');
    setHoras('');
    setPersonas('1');
    setIdCliente('');
  }

  function alGuardar(e: React.FormEvent): void {
    e.preventDefault();
    if (idActividad === '' || cantidad === '' || horas === '') {
      toast.error('Completa la actividad, la cantidad y las horas.');
      return;
    }
    if (area === 'ip' && idPersona === '') {
      toast.error('La productividad de IP requiere una persona.');
      return;
    }
    const cuerpo: RegistroProductividadCrear = {
      fecha,
      idActividad: Number(idActividad),
      cantidad: Number(cantidad),
      horasTrabajadas: Number(horas),
      personas: area === 'ip' ? 1 : Number(personas),
      ...(area === 'ip' && idPersona !== '' ? { idPersona: Number(idPersona) } : {}),
      ...(area === 'almacen' && idCliente !== '' ? { idCliente: Number(idCliente) } : {}),
    };
    registrar.mutate(cuerpo, {
      onSuccess: (r) => {
        toast.success(`Registro guardado (índice ${numero(r.indice)}).`);
        limpiar();
      },
      onError: (err) => toast.error(err.message),
    });
  }

  const filas = registros.data?.datos ?? [];

  return (
    <div
      className="h-full overflow-y-auto space-y-6 p-4 md:p-6"
      data-testid="captura-productividad"
    >
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Captura de productividad
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Ingeniería del Producto y Almacén, en una sola pantalla
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Nuevo registro</CardTitle>
          <CardDescription>
            Elige el área, la actividad y captura el trabajo del día.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={alGuardar}
          >
            <Field>
              <FieldLabel htmlFor="cap-area">Área</FieldLabel>
              <SelectNativo
                id="cap-area"
                value={area}
                onChange={(e) => {
                  setArea(e.target.value as Area);
                  setIdActividad('');
                }}
                data-testid="cap-area"
              >
                <option value="ip">Ingeniería del Producto</option>
                <option value="almacen">Almacén</option>
              </SelectNativo>
            </Field>

            <Field>
              <FieldLabel htmlFor="cap-actividad">Actividad</FieldLabel>
              <SelectNativo
                id="cap-actividad"
                value={idActividad}
                onChange={(e) => setIdActividad(e.target.value)}
                data-testid="cap-actividad"
              >
                <option value="">Selecciona…</option>
                {actividadesArea.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>

            {area === 'ip' ? (
              <Field>
                <FieldLabel htmlFor="cap-persona">Persona</FieldLabel>
                <SelectNativo
                  id="cap-persona"
                  value={idPersona}
                  onChange={(e) => setIdPersona(e.target.value)}
                  data-testid="cap-persona"
                >
                  <option value="">Selecciona…</option>
                  {(personal.data?.datos ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </SelectNativo>
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="cap-cliente">Cliente (opcional)</FieldLabel>
                <SelectNativo
                  id="cap-cliente"
                  value={idCliente}
                  onChange={(e) => setIdCliente(e.target.value)}
                  data-testid="cap-cliente"
                >
                  <option value="">Sin cliente</option>
                  {(clientes.data?.datos ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </SelectNativo>
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="cap-cantidad">
                {area === 'ip' ? 'Cantidad' : 'Piezas'}
              </FieldLabel>
              <Input
                id="cap-cantidad"
                type="number"
                min={0}
                step="any"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                data-testid="cap-cantidad"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="cap-horas">Horas trabajadas</FieldLabel>
              <Input
                id="cap-horas"
                type="number"
                min={0}
                step="any"
                value={horas}
                onChange={(e) => setHoras(e.target.value)}
                data-testid="cap-horas"
              />
            </Field>

            {area === 'almacen' && (
              <Field>
                <FieldLabel htmlFor="cap-personas">Personas</FieldLabel>
                <Input
                  id="cap-personas"
                  type="number"
                  min={1}
                  step={1}
                  value={personas}
                  onChange={(e) => setPersonas(e.target.value)}
                  data-testid="cap-personas"
                />
              </Field>
            )}

            <Field className="sm:col-span-2 lg:col-span-3">
              <FieldLabel htmlFor="cap-fecha">Fecha</FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="cap-fecha"
                  type="date"
                  className="w-44"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  disabled={!puedeFechaLibre}
                  data-testid="cap-fecha"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFecha(atajosFecha.hoy())}
                >
                  Hoy
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFecha(atajosFecha.ayer())}
                >
                  Ayer
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFecha(atajosFecha.sabado())}
                >
                  Sábado
                </Button>
                {!puedeFechaLibre && (
                  <span className="text-xs text-muted-foreground">
                    Solo Hoy/Ayer/Sábado (fecha libre requiere permiso).
                  </span>
                )}
              </div>
            </Field>

            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={registrar.isPending} data-testid="cap-guardar">
                Guardar registro
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registros recientes</CardTitle>
          <CardDescription>Los últimos registros del área con su índice calculado.</CardDescription>
        </CardHeader>
        <CardContent>
          {registros.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : filas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin registros.</p>
          ) : (
            <div className="overflow-x-auto">
              <TablaDensa>
                <TablaDensaEncabezado>
                  <TablaDensaFila>
                    <TablaDensaHead>Fecha</TablaDensaHead>
                    <TablaDensaHead>Actividad</TablaDensaHead>
                    <TablaDensaHead>{area === 'ip' ? 'Persona' : 'Cliente'}</TablaDensaHead>
                    <TablaDensaHead numerica>
                      {area === 'ip' ? 'Cantidad' : 'Piezas'}
                    </TablaDensaHead>
                    <TablaDensaHead numerica>Horas</TablaDensaHead>
                    <TablaDensaHead numerica>Índice</TablaDensaHead>
                    <TablaDensaHead numerica>% trab.</TablaDensaHead>
                    <TablaDensaHead />
                  </TablaDensaFila>
                </TablaDensaEncabezado>
                <TablaDensaCuerpo>
                  {filas.map((r) => (
                    <TablaDensaFila key={r.id} data-testid={`cap-registro-${r.id}`}>
                      <TablaDensaCelda>{r.fecha}</TablaDensaCelda>
                      <TablaDensaCelda>{r.actividad}</TablaDensaCelda>
                      <TablaDensaCelda>
                        {area === 'ip' ? (r.persona ?? '—') : (r.cliente ?? '—')}
                      </TablaDensaCelda>
                      <TablaDensaCelda numerica>{numero(r.cantidad)}</TablaDensaCelda>
                      <TablaDensaCelda numerica>{numero(r.horasTrabajadas)}</TablaDensaCelda>
                      <TablaDensaCelda numerica className="font-medium">
                        {numero(r.indice)}
                      </TablaDensaCelda>
                      <TablaDensaCelda numerica>
                        {porcentaje(r.porcentajeTrabajado)}
                      </TablaDensaCelda>
                      <TablaDensaCelda className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const motivo = window.prompt('Motivo de la cancelación:');
                            if (motivo === null || motivo.trim().length < 3) return;
                            cancelar.mutate(
                              { id: r.id, motivo: motivo.trim() },
                              {
                                onSuccess: () => toast.success('Registro cancelado.'),
                                onError: (err) => toast.error(err.message),
                              },
                            );
                          }}
                          data-testid={`cap-cancelar-${r.id}`}
                        >
                          <Ban className="size-4" aria-hidden />
                        </Button>
                      </TablaDensaCelda>
                    </TablaDensaFila>
                  ))}
                </TablaDensaCuerpo>
              </TablaDensa>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
