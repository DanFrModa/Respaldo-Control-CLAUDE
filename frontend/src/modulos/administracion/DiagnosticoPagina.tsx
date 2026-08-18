import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  DatabaseBackup,
  HardDriveDownload,
  MinusCircle,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { useDiagnostico, usePedirRespaldo } from '@/api/diagnostico';
import type { CorridaRespaldo, PruebaDiagnostico } from '@/api/tipos';
import { ChipEstado, type TonoEstado } from '@/components/dominio/ChipEstado';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSesion } from '@/sesion/useSesion';

/**
 * DIAGNÓSTICO DEL SISTEMA — la pantalla que contesta, sin abrir Railway ni Cloudflare y sin leer un
 * solo log, las dos preguntas que costaban horas de arqueología:
 *
 *   • «¿por qué no se pueden subir fotos?» — el backend prueba el almacenamiento DE VERDAD (escribe,
 *     lee, borra y dispara el mismo preflight que hace el navegador) y dice cuál de las cinco causas
 *     posibles es, con el arreglo puntual. Antes, las cinco se veían idénticas desde el navegador.
 *   • «¿de verdad se está respaldando la base?» — con corridas MENSUALES, un respaldo roto pasaba
 *     medio año sin que nadie lo notara. Aquí se ve el estado y las últimas corridas, y se puede
 *     pedir una AHORA para comprobarlo el mismo día que se configura.
 *
 * Solo lectura (más el botón de respaldo). El criterio vive en el backend (A1): esta pantalla pinta.
 */

/** Tono del chip por resultado de la prueba. */
const TONO_PRUEBA: Record<PruebaDiagnostico['estado'], TonoEstado> = {
  ok: 'ok',
  falla: 'crit',
  aviso: 'warn',
  'no-probado': 'neutro',
};

/** Etiqueta legible por resultado. */
const ETIQUETA_PRUEBA: Record<PruebaDiagnostico['estado'], string> = {
  ok: 'Bien',
  falla: 'Falla',
  aviso: 'Aviso',
  'no-probado': 'Sin probar',
};

/** Tono del chip por estado de una corrida del respaldo. */
const TONO_CORRIDA: Record<string, TonoEstado> = {
  EXITO: 'ok',
  FALLO: 'crit',
  EN_CURSO: 'info',
};

/** Formatea una fecha ISO como dd/mm/yyyy hh:mm. */
function formatearFecha(iso: string | null): string {
  if (iso === null) {
    return '—';
  }
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Convierte bytes a una unidad legible (los respaldos crecen y se leen mejor en MB). */
function formatearTamano(bytes: string | null): string {
  if (bytes === null) {
    return '—';
  }
  const numero = Number(bytes);
  if (!Number.isFinite(numero)) {
    return '—';
  }
  const mb = numero / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(numero / 1024).toFixed(0)} KB`;
}

/** Una prueba pintada como renglón con su chip, su detalle y su arreglo. */
function FilaPrueba({ prueba }: { prueba: PruebaDiagnostico }): React.JSX.Element {
  return (
    <li className="flex gap-3 border-t border-foreground/10 py-3 first:border-t-0">
      <ChipEstado tono={TONO_PRUEBA[prueba.estado]} className="mt-0.5 shrink-0">
        {ETIQUETA_PRUEBA[prueba.estado]}
      </ChipEstado>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{prueba.titulo}</p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{prueba.detalle}</p>
        {prueba.sugerencia !== undefined && prueba.sugerencia !== '' && (
          <p className="mt-1.5 rounded-md bg-warn-soft px-2.5 py-1.5 text-[12.5px] text-warn">
            <strong>Cómo se arregla:</strong> {prueba.sugerencia}
          </p>
        )}
      </div>
    </li>
  );
}

/** Tabla de las últimas corridas del respaldo. */
function TablaCorridas({ corridas }: { corridas: CorridaRespaldo[] }): React.JSX.Element {
  if (corridas.length === 0) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        Todavía no hay ninguna corrida registrada.
      </p>
    );
  }
  return (
    <TablaDensa>
      <TablaDensaHead>
        <TablaDensaFila>
          <TablaDensaEncabezado>Cuándo</TablaDensaEncabezado>
          <TablaDensaEncabezado>Estado</TablaDensaEncabezado>
          <TablaDensaEncabezado>Paso</TablaDensaEncabezado>
          <TablaDensaEncabezado>Tamaño</TablaDensaEncabezado>
          <TablaDensaEncabezado>Archivo en R2 / error</TablaDensaEncabezado>
        </TablaDensaFila>
      </TablaDensaHead>
      <TablaDensaCuerpo>
        {corridas.map((corrida) => (
          <TablaDensaFila key={corrida.id}>
            <TablaDensaCelda>{formatearFecha(corrida.iniciadoEn)}</TablaDensaCelda>
            <TablaDensaCelda>
              <ChipEstado tono={TONO_CORRIDA[corrida.estado] ?? 'neutro'}>
                {corrida.estado}
              </ChipEstado>
            </TablaDensaCelda>
            <TablaDensaCelda>{corrida.paso}</TablaDensaCelda>
            <TablaDensaCelda>{formatearTamano(corrida.tamanoSubidoBytes)}</TablaDensaCelda>
            <TablaDensaCelda
              className="max-w-[28rem] truncate"
              title={corrida.error ?? corrida.key ?? ''}
            >
              {corrida.error ?? corrida.key ?? '—'}
            </TablaDensaCelda>
          </TablaDensaFila>
        ))}
      </TablaDensaCuerpo>
    </TablaDensa>
  );
}

export function DiagnosticoPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const consulta = useDiagnostico();
  const respaldo = usePedirRespaldo();
  const datos = consulta.data;

  function copiarCors(): void {
    if (datos === undefined) {
      return;
    }
    void navigator.clipboard
      .writeText(datos.almacenamiento.corsSugerido)
      .then(() => {
        toast.success(
          'Política CORS copiada. Pégala en Cloudflare → R2 → el bucket → Settings → CORS Policy.',
        );
      })
      .catch(() => {
        toast.error('No se pudo copiar. Selecciona el texto y cópialo a mano.');
      });
  }

  function respaldarAhora(): void {
    respaldo.mutate(undefined, {
      onSuccess: (resultado) => {
        if (resultado.encolado) {
          toast.success(resultado.mensaje);
        } else {
          toast.error(resultado.mensaje);
        }
      },
      onError: (error) => {
        toast.error(error.message);
      },
    });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl p-4 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
              Diagnóstico del sistema
            </h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Prueba de verdad el almacenamiento de archivos y revisa el respaldo de la base. Nada
              de lo que sale aquí es secreto: las credenciales van enmascaradas.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void consulta.refetch()}
            disabled={consulta.isFetching}
            data-testid="diagnostico-reintentar"
          >
            <RefreshCw
              className={consulta.isFetching ? 'size-4 animate-spin' : 'size-4'}
              aria-hidden
            />
            Volver a probar
          </Button>
        </div>

        {consulta.isPending && (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {consulta.isError && (
          <p className="mt-6 rounded-lg bg-crit-soft px-3 py-2 text-sm text-crit">
            No se pudo correr el diagnóstico: {consulta.error.message}
          </p>
        )}

        {datos !== undefined && (
          <>
            {/* ── Almacenamiento de archivos ───────────────────────────────── */}
            <section className="mt-6 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <header className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground"
                >
                  <HardDriveDownload className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-heading text-base font-medium">
                    Almacenamiento de archivos (fotos, adjuntos, PDFs)
                  </h2>
                  <p className="mt-1 flex items-center gap-2 text-sm">
                    {datos.almacenamiento.puedeSubirFotos ? (
                      <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
                    ) : (
                      <XCircle className="size-4 shrink-0 text-crit" aria-hidden />
                    )}
                    <span>{datos.almacenamiento.veredicto}</span>
                  </p>
                </div>
              </header>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground sm:grid-cols-4">
                <div>
                  <dt className="font-medium text-foreground">Bucket</dt>
                  <dd>{datos.almacenamiento.bucket}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Cuenta</dt>
                  <dd>{datos.almacenamiento.cuenta}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Llave S3</dt>
                  <dd>{datos.almacenamiento.accessKeyId}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Origen probado</dt>
                  <dd className="truncate" title={datos.almacenamiento.origenProbado}>
                    {datos.almacenamiento.origenProbado}
                  </dd>
                </div>
              </dl>

              <ul className="mt-4">
                {datos.almacenamiento.pruebas.map((prueba) => (
                  <FilaPrueba key={prueba.clave} prueba={prueba} />
                ))}
              </ul>

              <div className="mt-4 rounded-lg bg-muted/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium">Política CORS que necesita el bucket</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copiarCors}
                    data-testid="diagnostico-copiar-cors"
                  >
                    <Copy className="size-4" aria-hidden />
                    Copiar
                  </Button>
                </div>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  Cloudflare → R2 → el bucket <strong>{datos.almacenamiento.bucket}</strong> →
                  Settings → CORS Policy → Edit. Pega esto tal cual y guarda; no hace falta volver a
                  desplegar el sistema.
                </p>
                <pre className="mt-2 max-h-52 overflow-auto rounded-md bg-background p-2 text-[11.5px] leading-relaxed">
                  {datos.almacenamiento.corsSugerido}
                </pre>
                {datos.almacenamiento.corsActual !== null && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[12.5px] text-muted-foreground">
                      Ver la política que el bucket tiene hoy
                    </summary>
                    <pre className="mt-2 max-h-52 overflow-auto rounded-md bg-background p-2 text-[11.5px] leading-relaxed">
                      {datos.almacenamiento.corsActual}
                    </pre>
                  </details>
                )}
              </div>
            </section>

            {/* ── Respaldo de la base ──────────────────────────────────────── */}
            <section className="mt-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <header className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground"
                >
                  <DatabaseBackup className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-heading text-base font-medium">
                    Respaldo propio de la base (el segundo, fuera de Railway)
                  </h2>
                  <p className="mt-1 flex items-center gap-2 text-sm">
                    {datos.respaldo.estado === 'programado' ? (
                      <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
                    ) : datos.respaldo.estado === 'apagado' ? (
                      <MinusCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <AlertTriangle className="size-4 shrink-0 text-crit" aria-hidden />
                    )}
                    <span>{datos.respaldo.veredicto}</span>
                  </p>
                </div>
              </header>

              <p className="mt-3 text-[12.5px] text-muted-foreground">{datos.respaldo.mensaje}</p>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground sm:grid-cols-3">
                <div>
                  <dt className="font-medium text-foreground">Cuándo corre</dt>
                  <dd>{datos.respaldo.cuando}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Copias que conserva</dt>
                  <dd>{datos.respaldo.retencion === 0 ? '—' : datos.respaldo.retencion}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Estado</dt>
                  <dd>{datos.respaldo.estado}</dd>
                </div>
              </dl>

              {tienePermiso('admin.respaldo-ejecutar') && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    onClick={respaldarAhora}
                    disabled={respaldo.isPending || datos.respaldo.estado !== 'programado'}
                    data-testid="diagnostico-respaldar"
                  >
                    <DatabaseBackup className="size-4" aria-hidden />
                    {respaldo.isPending ? 'Encolando…' : 'Respaldar ahora'}
                  </Button>
                  <p className="text-[12.5px] text-muted-foreground">
                    Corre el respaldo real (volcado + cifrado + subida) sin esperar al día 1. Tarda
                    minutos: vuelve a probar el diagnóstico para verlo terminado.
                  </p>
                </div>
              )}

              <h3 className="mt-5 text-sm font-medium">Últimas corridas</h3>
              <div className="mt-2 overflow-x-auto">
                <TablaCorridas corridas={datos.respaldo.ultimasCorridas} />
              </div>
            </section>

            <p className="mt-4 text-[12.5px] text-muted-foreground">
              Diagnóstico corrido el {formatearFecha(datos.hora)}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
