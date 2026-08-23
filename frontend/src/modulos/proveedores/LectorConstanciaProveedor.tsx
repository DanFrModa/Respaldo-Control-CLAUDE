import { FileText, Loader2Icon } from 'lucide-react';
import { useRef, useState } from 'react';

import { useAnalizarConstancia } from '@/api/proveedores';
import type { ConstanciaPropuesta } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { SelectNativo } from '@/components/ui/native-select';

/**
 * LECTOR de la Constancia de Situación Fiscal (§Post-F9.55).
 *
 * Daniel: *"En proveedores me gustaría poder subir su Constancia de Situación Fiscal para darlos de
 * alta. Con ese documento se llena toda la info en automático: RFC, direcciones, etc."*
 *
 * ⭐ **El documento PROPONE, la persona CONFIRMA.** Este componente NO guarda nada: sube el PDF,
 * muestra lo que dice el papel y solo cuando alguien aprieta *"Usar estos datos"* llena el
 * formulario — que después hay que guardar como siempre. El `rfc` y el `regimenFiscalSat` alimentan
 * el CFDI: un carácter mal leído no se nota hasta que una factura sale mal.
 *
 * DEGRADAR CON GRACIA: si el SAT cambia el formato y no se puede leer, esto avisa y **no bloquea**
 * el alta — se captura a mano, como hasta hoy.
 *
 * VARIOS REGÍMENES: si la constancia trae más de uno (frecuente en persona física), se ofrecen
 * TODOS en un selector y la persona escoge. Nunca se toma el primero en silencio.
 *
 * El PDF se CONSERVA aparte, como adjunto `CONSTANCIA` del proveedor (sección Adjuntos): esto solo
 * lo lee.
 */
export function LectorConstanciaProveedor({
  alProponer,
  deshabilitado,
}: {
  /**
   * Se llama al confirmar: recibe la propuesta, la clave de régimen elegida y el PDF que se leyó
   * — el diálogo lo CONSERVA como adjunto `CONSTANCIA` (§Post-F9.55: *"la constancia se CONSERVA
   * como adjunto, no se lee y se tira"*).
   */
  alProponer: (propuesta: ConstanciaPropuesta, regimenElegido: string, pdf: File) => void;
  deshabilitado: boolean;
}): React.JSX.Element {
  const analizar = useAnalizarConstancia();
  const entrada = useRef<HTMLInputElement>(null);
  const [propuesta, setPropuesta] = useState<ConstanciaPropuesta | null>(null);
  // El PDF leído se guarda para poder CONSERVARLO como adjunto al confirmar.
  const [pdf, setPdf] = useState<File | null>(null);
  const [regimen, setRegimen] = useState('');
  const [error, setError] = useState<string | null>(null);

  function alElegirArchivo(archivo: File): void {
    setError(null);
    setPropuesta(null);
    setPdf(archivo);
    const lector = new FileReader();
    lector.onerror = () => setError('No se pudo leer el archivo.');
    lector.onload = () => {
      // `readAsDataURL` da "data:application/pdf;base64,XXXX": el API quiere solo la parte base64.
      // `result` es `string | ArrayBuffer | null`; con readAsDataURL siempre es texto, pero se
      // comprueba en vez de forzarlo (un ArrayBuffer convertido a texto daría "[object …]").
      const crudo = typeof lector.result === 'string' ? lector.result : '';
      const base64 = crudo.split(',')[1] ?? '';
      if (base64 === '') {
        setError('No se pudo leer el archivo.');
        return;
      }
      analizar.mutate(base64, {
        onSuccess: (datos) => {
          setPropuesta(datos);
          setRegimen(datos.regimenes[0]?.clave ?? '');
        },
        onError: (e) => setError(e.message),
      });
    };
    lector.readAsDataURL(archivo);
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3" data-testid="lector-constancia">
      <div className="flex items-center gap-2">
        <FileText className="size-4 text-muted-foreground" aria-hidden />
        <FieldLabel htmlFor="constancia-archivo" className="font-normal">
          Constancia de Situación Fiscal (opcional)
        </FieldLabel>
      </div>
      <FieldDescription>
        Sube el PDF y el sistema PROPONE el RFC, la razón social, el régimen, el CP y el domicilio.
        Tú revisas y confirmas antes de guardar.
      </FieldDescription>

      <input
        ref={entrada}
        id="constancia-archivo"
        type="file"
        accept="application/pdf"
        className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1 file:text-sm"
        disabled={deshabilitado || analizar.isPending}
        data-testid="constancia-archivo"
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          if (archivo) {
            alElegirArchivo(archivo);
          }
        }}
      />

      {analizar.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden />
          Leyendo la constancia…
        </p>
      ) : null}

      <FieldError errors={error === null ? [] : [{ message: error }]} />
      {error !== null ? (
        <FieldDescription data-testid="constancia-captura-manual">
          No pasa nada: captura los datos a mano como siempre.
        </FieldDescription>
      ) : null}

      {propuesta !== null ? (
        <div
          className="space-y-2 rounded-md bg-primary-soft p-2"
          data-testid="constancia-propuesta"
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Persona</dt>
            <dd>{propuesta.tipoPersona === 'fisica' ? 'Física' : 'Moral'}</dd>
            <dt className="text-muted-foreground">RFC</dt>
            <dd data-testid="constancia-rfc">{propuesta.rfc === '' ? '—' : propuesta.rfc}</dd>
            <dt className="text-muted-foreground">Nombre / razón social</dt>
            <dd>{propuesta.razonSocial === '' ? '—' : propuesta.razonSocial}</dd>
            <dt className="text-muted-foreground">CP</dt>
            <dd>
              {propuesta.codigoPostalExpedicion === '' ? '—' : propuesta.codigoPostalExpedicion}
            </dd>
            <dt className="text-muted-foreground">Domicilio</dt>
            <dd data-testid="constancia-direccion">
              {propuesta.direccion === '' ? '—' : propuesta.direccion}
            </dd>
          </dl>

          {/* Con más de un régimen, la persona escoge: nunca se toma el primero en silencio. */}
          {propuesta.regimenes.length > 0 ? (
            <div>
              <FieldLabel htmlFor="constancia-regimen" className="font-normal">
                Régimen fiscal
              </FieldLabel>
              <SelectNativo
                id="constancia-regimen"
                value={regimen}
                disabled={deshabilitado}
                onChange={(e) => setRegimen(e.target.value)}
                data-testid="constancia-regimen"
              >
                {propuesta.regimenes.map((r) => (
                  <option key={`${r.clave}-${r.descripcion}`} value={r.clave}>
                    {r.clave === '' ? r.descripcion : `${r.clave} — ${r.descripcion}`}
                  </option>
                ))}
              </SelectNativo>
            </div>
          ) : null}

          {propuesta.advertencias.length > 0 ? (
            <ul
              className="list-disc pl-5 text-xs text-muted-foreground"
              data-testid="constancia-advertencias"
            >
              {propuesta.advertencias.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : null}

          <Button
            type="button"
            size="sm"
            disabled={deshabilitado}
            onClick={() => {
              if (pdf !== null) {
                alProponer(propuesta, regimen, pdf);
              }
            }}
            data-testid="usar-constancia"
          >
            Usar estos datos
          </Button>
        </div>
      ) : null}
    </div>
  );
}
