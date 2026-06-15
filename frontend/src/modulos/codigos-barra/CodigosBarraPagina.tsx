import { BarcodeIcon, DownloadIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useCodigosBarraModelo, useModelos, type Modelo } from '@/api/modelos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/lib/useDebounce';

import { CodigoBarraCanvas } from './CodigoBarraCanvas';
import { EtiquetaPdf } from './EtiquetaPdf';
import { nombreArchivoEtiqueta } from './etiqueta';

/** Resultados de búsqueda que se muestran en el selector de modelo. */
const POR_PAGINA = 8;

/**
 * Generador de códigos de barra (F1-E5) — sucesor del form viejo `Codigo` (menú 1). Flujo:
 *  1. El usuario busca y elige un modelo.
 *  2. El backend calcula el EAN-13 y el DUN-14 para la EMPRESA ACTIVA (prefijo `Empresa.upc`).
 *  3. Se dibujan ambos como códigos ESCANEABLES (EAN-13 e ITF-14) con su número legible.
 *  4. Botón "Descargar etiqueta PDF" (primer impreso del sistema, R9).
 *
 * Si la empresa no tiene UPC (o el código no da 12 dígitos), el backend responde 400 con un
 * mensaje legible que esta pantalla muestra tal cual (no rompe). El acceso lo gobierna
 * `modelos.codigos-barra` (ruta del front + re-verificación del backend, A1).
 */
export function CodigosBarraPagina(): React.JSX.Element {
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [modeloElegido, setModeloElegido] = useState<Modelo | null>(null);
  const [descargando, setDescargando] = useState(false);

  const consultaModelos = useModelos({
    pagina: 1,
    porPagina: POR_PAGINA,
    ordenarPor: 'codigo',
    direccion: 'asc',
    incluirInactivos: 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const consultaCodigos = useCodigosBarraModelo(modeloElegido?.id);
  const codigos = consultaCodigos.data;

  function elegir(modelo: Modelo): void {
    setModeloElegido(modelo);
  }

  /** Genera el PDF de la etiqueta y dispara su descarga en el navegador. */
  async function descargarPdf(): Promise<void> {
    if (codigos === undefined) {
      return;
    }
    setDescargando(true);
    try {
      // Import perezoso del renderer (pesado): solo cuando se descarga.
      const { pdf } = await import('@react-pdf/renderer');
      const blob = await pdf(<EtiquetaPdf datos={codigos} />).toBlob();
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = nombreArchivoEtiqueta(codigos);
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('No se pudo generar el PDF de la etiqueta. Intenta de nuevo.');
    } finally {
      setDescargando(false);
    }
  }

  const modelos = consultaModelos.data?.datos ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center gap-3 border-b p-4 lg:px-6">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground"
        >
          <BarcodeIcon className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Generador de códigos de barra</h1>
          <p className="text-sm text-muted-foreground">
            EAN-13 (pieza) y DUN-14 (caja) de un modelo, con el prefijo de la empresa activa.
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[20rem_1fr]">
        {/* Columna izquierda: elegir modelo */}
        <section className="flex min-h-0 flex-col rounded-xl border">
          <div className="border-b p-3">
            <div className="relative">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                placeholder="Buscar modelo por código…"
                className="pl-8"
                value={textoBusqueda}
                onChange={(e) => setTextoBusqueda(e.target.value)}
                aria-label="Buscar modelo por código o descripción"
                data-testid="buscar-modelo"
              />
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="lista-modelos">
            {consultaModelos.isPending ? (
              <li className="space-y-2 p-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </li>
            ) : consultaModelos.isError ? (
              <li className="p-3 text-sm text-destructive">{consultaModelos.error.message}</li>
            ) : modelos.length === 0 ? (
              <li className="p-3 text-sm text-muted-foreground">No hay modelos que coincidan.</li>
            ) : (
              modelos.map((modelo) => (
                <li key={modelo.id}>
                  <button
                    type="button"
                    onClick={() => elegir(modelo)}
                    aria-pressed={modeloElegido?.id === modelo.id}
                    data-testid="opcion-modelo"
                    className={`flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent ${
                      modeloElegido?.id === modelo.id ? 'bg-accent ring-1 ring-primary/40' : ''
                    }`}
                  >
                    <span className="font-medium">{modelo.codigo}</span>
                    {modelo.descripcion !== null ? (
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {modelo.descripcion}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>

        {/* Columna derecha: códigos */}
        <section className="min-h-0">
          {modeloElegido === null ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed">
              <p className="px-6 text-center text-sm text-muted-foreground">
                Elige un modelo para generar sus códigos de barra.
              </p>
            </div>
          ) : consultaCodigos.isPending ? (
            <div className="space-y-4 rounded-xl border p-6">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : consultaCodigos.isError ? (
            <div
              className="rounded-xl border border-destructive/40 bg-destructive/5 p-6"
              data-testid="error-codigos"
            >
              <p className="text-sm font-medium text-destructive">
                {consultaCodigos.error.message}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Captura el prefijo UPC de la empresa en Administración → Empresas, o revisa el
                código del modelo.
              </p>
            </div>
          ) : codigos !== undefined ? (
            <div className="space-y-4 rounded-xl border p-6" data-testid="resultado-codigos">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">
                    {codigos.nombreEmpresa} · modelo {codigos.codigoModelo}
                  </p>
                  <p className="text-sm text-muted-foreground">Prefijo UPC: {codigos.prefijo}</p>
                </div>
                <Button
                  onClick={() => void descargarPdf()}
                  disabled={descargando}
                  data-testid="descargar-pdf"
                >
                  <DownloadIcon className="size-4" aria-hidden />
                  {descargando ? 'Generando…' : 'Descargar etiqueta PDF'}
                </Button>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <figure className="flex flex-col items-center gap-2 rounded-lg border bg-card p-4">
                  <figcaption className="self-start text-xs font-medium text-muted-foreground uppercase">
                    EAN-13 (pieza)
                  </figcaption>
                  <CodigoBarraCanvas
                    simbologia="ean13"
                    valor={codigos.ean13}
                    etiqueta={`EAN-13 del modelo ${codigos.codigoModelo}`}
                  />
                  <p className="font-mono text-sm" data-testid="texto-ean13">
                    {codigos.ean13}
                  </p>
                </figure>

                <figure className="flex flex-col items-center gap-2 rounded-lg border bg-card p-4">
                  <figcaption className="self-start text-xs font-medium text-muted-foreground uppercase">
                    DUN-14 (caja)
                  </figcaption>
                  <CodigoBarraCanvas
                    simbologia="itf14"
                    valor={codigos.dun14}
                    etiqueta={`DUN-14 del modelo ${codigos.codigoModelo}`}
                  />
                  <p className="font-mono text-sm" data-testid="texto-dun14">
                    {codigos.dun14}
                  </p>
                </figure>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
