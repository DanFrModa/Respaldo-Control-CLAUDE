import { Medal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useContextoOrden, useCrearAuditoria } from '@/api/calidad';
import { ETIQUETAS_TIPO_AUDITORIA, TIPOS_AUDITORIA } from '@/api/esquemas';
import type { Orden, TipoAuditoria } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { SelectorOrden } from '@/modulos/produccion/SelectorOrden';
import { useSesion } from '@/sesion/useSesion';

/** Fecha de hoy en YYYY-MM-DD (zona local), para el default de los campos fecha. */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * ALTA DE AUDITORÍA (F6-E2, doc 09 §2 — ex `CC_AltaAuditorias`). Móvil-primero (la auditoría se hace
 * en piso): elige una orden, ve su cantidad sola, elige el maquilero (propuesto de las entregas
 * reales), ve la muestra automática del plan AQL y captura las fechas/tipo. Al crearla, el folio, la
 * muestra y los defectos favoritos los pone el servidor; redirige a la captura de resultados.
 *
 * `calidad.generar-auditorias` gobierna el alta; sin él, el módulo no aparece (el backend re-verifica).
 */
export function AltaAuditoriaPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeGenerar = tienePermiso('calidad.generar-auditorias');
  const navigate = useNavigate();

  const [idOrden, setIdOrden] = useState<number | undefined>(undefined);
  const [folioOrden, setFolioOrden] = useState<number | null>(null);
  const [idMaquilero, setIdMaquilero] = useState<string>('');
  const [fechaElaboracion, setFechaElaboracion] = useState(hoy());
  const [fechaAuditoria, setFechaAuditoria] = useState(hoy());
  const [tipoAuditoria, setTipoAuditoria] = useState<TipoAuditoria>('final');

  const contexto = useContextoOrden(idOrden);
  const crear = useCrearAuditoria();

  // Al cargar el contexto, propone el maquilero sugerido (ex PrimerMaq) si aún no se eligió.
  useEffect(() => {
    const maquileros = contexto.data?.maquileros;
    if (maquileros !== undefined && idMaquilero === '') {
      const sugerido = maquileros.find((m) => m.sugerido) ?? maquileros[0];
      if (sugerido !== undefined) {
        setIdMaquilero(String(sugerido.id));
      }
    }
  }, [contexto.data, idMaquilero]);

  function alElegirOrden(o: Orden): void {
    setIdOrden(o.id);
    setFolioOrden(Number(o.folio));
    setIdMaquilero('');
  }

  const datos = contexto.data;
  const muestra = datos?.muestra;
  const puedeCrear = puedeGenerar && idOrden !== undefined && !crear.isPending;

  function crearAuditoria(): void {
    if (idOrden === undefined) return;
    crear.mutate(
      {
        idOrden,
        idMaquilero: idMaquilero === '' ? null : Number(idMaquilero),
        fechaElaboracion,
        fechaAuditoria,
        tipoAuditoria,
      },
      {
        onSuccess: (auditoria) => {
          toast.success(`Auditoría #${auditoria.numAuditoria} creada; captura sus resultados.`);
          void navigate(`/calidad/auditorias/${String(auditoria.id)}`);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
        >
          <Medal className="size-4.5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Alta de auditoría</h1>
          <p className="text-sm text-muted-foreground">
            Inspecciona una muestra de una orden. La cantidad, la muestra del plan AQL y los
            defectos favoritos se llenan solos.
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Orden</CardTitle>
            <CardDescription>Elige la orden a auditar.</CardDescription>
          </CardHeader>
          <CardContent>
            <SelectorOrden
              idSeleccionada={idOrden}
              alSeleccionar={alElegirOrden}
              testid="auditoria-selector-orden"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {folioOrden !== null ? `Orden #${folioOrden}` : 'Datos de la auditoría'}
            </CardTitle>
            <CardDescription>
              {idOrden === undefined
                ? 'Selecciona una orden para dar de alta su auditoría.'
                : datos !== undefined
                  ? `${datos.codigoModelo} · ${datos.cantidad.toLocaleString('es-MX')} pzas en la orden`
                  : 'Cargando contexto de la orden…'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {idOrden === undefined ? (
              <p className="text-sm text-muted-foreground">Sin orden seleccionada.</p>
            ) : contexto.isPending ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : contexto.isError ? (
              <p className="text-sm text-destructive" role="alert">
                {contexto.error.message}
              </p>
            ) : datos !== undefined ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div
                    className="rounded-lg border bg-muted/30 p-3"
                    data-testid="auditoria-cantidad"
                  >
                    <p className="text-xs text-muted-foreground">Cantidad de la orden</p>
                    <p className="text-2xl font-semibold">
                      {datos.cantidad.toLocaleString('es-MX')}
                    </p>
                  </div>
                  <div
                    className="rounded-lg border bg-muted/30 p-3"
                    data-testid="auditoria-muestra"
                  >
                    <p className="text-xs text-muted-foreground">Muestra a inspeccionar (AQL)</p>
                    {muestra?.resoluble === true ? (
                      <>
                        <p className="text-2xl font-semibold">{muestra.tamanoMuestra}</p>
                        <p className="text-xs text-muted-foreground">{muestra.nombrePlan}</p>
                      </>
                    ) : (
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        {muestra?.mensaje ?? 'Se captura a mano en los resultados.'}
                      </p>
                    )}
                  </div>
                </div>

                <Field>
                  <FieldLabel htmlFor="maquilero">Maquilero auditado</FieldLabel>
                  <SelectNativo
                    id="maquilero"
                    value={idMaquilero}
                    onChange={(e) => setIdMaquilero(e.target.value)}
                    disabled={!puedeGenerar}
                    data-testid="auditoria-maquilero"
                  >
                    <option value="">Sin maquilero</option>
                    {datos.maquileros.map((m) => (
                      <option key={m.id} value={String(m.id)}>
                        {m.nombre}
                        {m.sugerido ? ' (sugerido)' : ''}
                      </option>
                    ))}
                  </SelectNativo>
                  {datos.maquileros.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      La orden no tiene envíos/recibos con maquilero; puedes dejarlo sin asignar.
                    </p>
                  ) : null}
                </Field>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="tipo">Tipo</FieldLabel>
                    <SelectNativo
                      id="tipo"
                      value={tipoAuditoria}
                      onChange={(e) => setTipoAuditoria(e.target.value as TipoAuditoria)}
                      disabled={!puedeGenerar}
                      data-testid="auditoria-tipo"
                    >
                      {TIPOS_AUDITORIA.map((t) => (
                        <option key={t} value={t}>
                          {ETIQUETAS_TIPO_AUDITORIA[t]}
                        </option>
                      ))}
                    </SelectNativo>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="fecha-elab">Fecha de elaboración</FieldLabel>
                    <Input
                      id="fecha-elab"
                      type="date"
                      value={fechaElaboracion}
                      onChange={(e) => setFechaElaboracion(e.target.value)}
                      disabled={!puedeGenerar}
                      data-testid="auditoria-fecha-elaboracion"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="fecha-aud">Fecha de auditoría</FieldLabel>
                    <Input
                      id="fecha-aud"
                      type="date"
                      value={fechaAuditoria}
                      onChange={(e) => setFechaAuditoria(e.target.value)}
                      disabled={!puedeGenerar}
                      data-testid="auditoria-fecha-auditoria"
                    />
                  </Field>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={crearAuditoria}
                    disabled={!puedeCrear}
                    data-testid="auditoria-crear"
                  >
                    {crear.isPending ? 'Creando…' : 'Crear auditoría'}
                  </Button>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
