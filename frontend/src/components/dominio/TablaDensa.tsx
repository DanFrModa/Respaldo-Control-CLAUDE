import * as React from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * TABLA DENSA del rediseño (proto `table.data`): el restyling de `ui/table`
 * para pantallas "tabla-first" — filas de 28–34px a 13px, encabezado pegajoso
 * en MAYUSCULAS chicas sobre superficie secundaria, hover por renglon y
 * seleccion con el realce de marca. Soporta una BARRA DE TOTALES al pie
 * (`TablaDensaPie` sobre `tfoot`).
 *
 * Columnas numericas: pasar `numerica` a `TablaDensaHead`/`TablaDensaCelda`
 * alinea a la derecha y aplica `tabular-nums` (los numeros ALINEAN, clave en un
 * ERP). Filas expandibles/agrupadas quedan para R2/R3 (se construyen sobre esta
 * misma base cuando las pantallas de listas se rediseñen a fondo).
 */
function TablaDensa({ className, ...props }: React.ComponentProps<typeof Table>) {
  return <Table data-slot="tabla-densa" className={cn('text-sm', className)} {...props} />;
}

function TablaDensaEncabezado({ className, ...props }: React.ComponentProps<typeof TableHeader>) {
  return <TableHeader className={cn('bg-secondary', className)} {...props} />;
}

function TablaDensaHead({
  className,
  numerica = false,
  ...props
}: React.ComponentProps<typeof TableHead> & {
  /** Columna numerica: alinea a la derecha (el cuerpo usa `tabular-nums`). */
  numerica?: boolean;
}) {
  return (
    <TableHead
      className={cn(
        'sticky top-0 z-10 h-8 bg-secondary px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase',
        numerica && 'text-right',
        className,
      )}
      {...props}
    />
  );
}

function TablaDensaCuerpo({ ...props }: React.ComponentProps<typeof TableBody>) {
  return <TableBody {...props} />;
}

function TablaDensaFila({
  className,
  seleccionada = false,
  ...props
}: React.ComponentProps<typeof TableRow> & {
  /** Renglon seleccionado: fondo suave de marca + barra de acento (proto `.sel`). */
  seleccionada?: boolean;
}) {
  return (
    <TableRow
      data-seleccionada={seleccionada || undefined}
      className={cn(
        seleccionada &&
          'bg-primary-soft hover:bg-primary-soft [&>td:first-child]:shadow-[inset_3px_0_0_var(--primary)]',
        className,
      )}
      {...props}
    />
  );
}

function TablaDensaCelda({
  className,
  numerica = false,
  ...props
}: React.ComponentProps<typeof TableCell> & {
  /** Columna numerica: alinea a la derecha con cifras tabulares. */
  numerica?: boolean;
}) {
  return (
    <TableCell className={cn('px-3 py-1.5', numerica && 'num text-right', className)} {...props} />
  );
}

/** Barra de TOTALES al pie: pegajosa abajo, seminegrita, cifras tabulares. */
function TablaDensaPie({ className, ...props }: React.ComponentProps<typeof TableFooter>) {
  return (
    <TableFooter
      data-slot="tabla-densa-pie"
      className={cn('num sticky bottom-0 z-10 bg-secondary font-semibold', className)}
      {...props}
    />
  );
}

export {
  TablaDensa,
  TablaDensaEncabezado,
  TablaDensaHead,
  TablaDensaCuerpo,
  TablaDensaFila,
  TablaDensaCelda,
  TablaDensaPie,
};
