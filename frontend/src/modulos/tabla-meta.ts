import type { RowData } from '@tanstack/react-table';

/**
 * Acciones por fila que cada pagina CRUD inyecta a sus columnas (TanStack Table)
 * via el `meta` de la tabla, para que las celdas las invoquen sin acoplar las
 * columnas al estado de la pagina. Es GENERICA sobre la entidad de la fila, asi
 * que sirve igual para todos los catalogos (almacenes, proveedores, colores, …)
 * con un solo augment de `TableMeta` (sin `any`).
 *
 * Segun el estado de la fila la pagina ofrece desactivar (si esta activa) o
 * reactivar (si esta inactiva); editar siempre. La visibilidad real la gobierna
 * `puedeAdministrar` (permiso de la sesion) y, en ultima instancia, el backend (A1).
 */
export interface AccionesFila<TEntidad> {
  /** ¿La sesion puede administrar (escribir) este catalogo? Oculta las acciones si no. */
  puedeAdministrar: boolean;
  /** Abre la edicion de la fila. */
  alEditar: (entidad: TEntidad) => void;
  /** Pide desactivar la fila (borrado suave, con confirmacion en la pagina). */
  alDesactivar: (entidad: TEntidad) => void;
  /** Reactiva la fila desactivada (sin confirmacion: accion no destructiva). */
  alReactivar: (entidad: TEntidad) => void;
}

/**
 * Augment UNICO de `TableMeta` del paquete TanStack Table: toda tabla CRUD del
 * frontend expone sus acciones por fila en `meta.acciones`, tipadas con la
 * entidad de la fila (`TData`). Un solo augment evita declaraciones en conflicto
 * entre modulos y mantiene el acceso TIPADO desde las columnas.
 */
declare module '@tanstack/react-table' {
  // El parametro TData es el de la firma original de la interfaz.
  interface TableMeta<TData extends RowData> {
    acciones?: AccionesFila<TData>;
  }
}
