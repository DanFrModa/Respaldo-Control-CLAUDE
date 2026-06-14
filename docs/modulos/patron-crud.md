# Patrón CRUD del frontend (estándar a replicar)

> Esta es la **plantilla** de toda pantalla de administración del frontend de
> CONTROL v2. El CRUD de **Almacenes** (`frontend/src/modulos/almacenes/`) la
> implementa de referencia; cada módulo nuevo (clientes, telas, avíos, …)
> se construye copiando esta estructura. Si cambias el patrón, cámbialo aquí y en
> Almacenes a la vez.

Regla de oro (innegociable **A1**): **el frontend NO tiene lógica de negocio.**
Solo pide al API y presenta; valida la captura para una buena experiencia, pero
**el servidor siempre re-valida y es la autoridad**. Las acciones se ocultan
según los permisos de la sesión, pero **la decisión real la toma el backend** en
cada ruta (deny-by-default, §9.2).

---

## Las capas (de afuera hacia adentro)

```
Pantalla (página)        modulos/<modulo>/<Modulo>Pagina.tsx
  ├─ Tabla               TanStack Table en modo servidor + columnas.tsx
  ├─ Diálogo alta/edición  Dialogo<Modulo>.tsx (react-hook-form + Zod)
  └─ Confirmación        components/DialogoConfirmacion.tsx (reutilizable)
        │
Hooks de datos           api/<modulo>.ts  (TanStack Query + openapi-fetch)
        │
Cliente del API          api/cliente.ts   (openapi-fetch tipado del OpenAPI)
        │
Contrato                 api/esquema.gen.ts  (tipos GENERADOS) + api/tipos.ts (alias)
```

Cada capa tiene una sola responsabilidad. Una pantalla nunca llama a `fetch` ni
arma URLs: usa los hooks. Los hooks nunca pintan UI: solo llaman al cliente y
normalizan el resultado. El cliente nunca conoce el negocio: solo es el
transporte tipado.

---

## 1. Tipos del contrato (`api/tipos.ts`)

Los tipos salen del contrato OpenAPI generado (`esquema.gen.ts`), no se escriben
a mano. Se les pone un alias de dominio:

```ts
export type Almacen =
  paths['/api/almacenes']['get']['responses']['200']['content']['application/json']['datos'][number];
export type AlmacenesQuery = NonNullable<paths['/api/almacenes']['get']['parameters']['query']>;
export type AlmacenCrear =
  paths['/api/almacenes']['post']['requestBody']['content']['application/json'];
```

> Si el backend cambia el contrato, se regenera con `npm run gen:api` y los
> cambios se vuelven errores de compilación aquí. No hay tipos duplicados.

## 2. Esquemas de captura (`api/esquemas.ts`)

Zod **solo para la UX** del formulario (mensajes en español, campos requeridos).
Reflejan las reglas del backend pero NO las reemplazan (el server re-valida):

```ts
export const esquemaAlmacenFormulario = z.object({
  nombre: z.string().trim().min(1, { error: 'El nombre es obligatorio' }).max(100, { ... }),
  tipo: z.enum(TIPOS_ALMACEN, { error: 'El tipo debe ser PT, TELA o AVIO' }),
});
```

## 3. Hooks de datos (`api/<modulo>.ts`)

Cada operación: llama al cliente tipado, normaliza (`data` en éxito, `ErrorDeApi`
con el mensaje del backend en fallo) y se expone como **consulta** (lectura) o
**mutación** (escritura). Las mutaciones **invalidan** la consulta de la lista.

```ts
async function listarAlmacenes(query: AlmacenesQuery): Promise<AlmacenesPagina> {
  const { data, error } = await api.GET('/api/almacenes', { params: { query } });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

export function useAlmacenes(query: AlmacenesQuery) {
  return useQuery({
    queryKey: [...CLAVE_ALMACENES, 'lista', query],
    queryFn: () => listarAlmacenes(query),
    placeholderData: keepPreviousData, // sin parpadeo al paginar/buscar
  });
}

export function useCrearAlmacen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: crearAlmacen,
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_ALMACENES }),
  });
}
```

- **Paginación, orden y filtrado son del SERVIDOR.** La query lleva
  `pagina/porPagina/ordenarPor/direccion/busqueda/incluirInactivos`; el backend
  responde `{ datos, total, pagina, porPagina, totalPaginas }`.
- La **búsqueda** se hace con _debounce_ (`useDebounce`, 300 ms) para no pegarle
  al API en cada tecla.

## 4. La pantalla (`<Modulo>Pagina.tsx`)

Junta todo: estado de la vista (búsqueda, orden, página, filtros), la consulta,
la tabla (TanStack Table en **modo servidor**: `manualPagination`,
`manualSorting`, `manualFiltering`) y los diálogos. Responsabilidades:

- **Consciencia de permisos:** lee `useSesion().tienePermiso('<modulo>.administrar')`
  y oculta el botón "Nuevo" y las acciones de fila si no lo tiene
  (`<modulo>.ver` ya gobierna el acceso a la pantalla).
- **Estados:** carga (skeleton), error (mensaje + reintentar), vacío (mensaje).
- **Toasts** (sonner) en cada éxito/fallo de mutación, con el mensaje del backend.

```tsx
const { tienePermiso } = useSesion();
const puedeAdministrar = tienePermiso('almacenes.administrar');
const consulta = useAlmacenes(query);

const tabla = useReactTable({
  data: consulta.data?.datos ?? [],
  columns: columnasAlmacenes,
  getCoreRowModel: getCoreRowModel(),
  manualPagination: true,
  manualSorting: true,
  manualFiltering: true,
  pageCount: consulta.data?.totalPaginas ?? 0,
  state: { sorting: orden },
  onSortingChange: /* mapea a ordenarPor/direccion y vuelve a la página 1 */,
  meta: { acciones: { puedeAdministrar, alEditar, alDesactivar, alReactivar } },
});
```

Las **columnas** viven aparte (`columnas.tsx`) y leen las acciones del `meta` de
la tabla (tipado con un `declare module '@tanstack/react-table'`), para no
acoplar las columnas al estado de la página.

## 5. Diálogo de alta/edición (`Dialogo<Modulo>.tsx`)

Un solo diálogo para alta y edición (si recibe la entidad, edita; si no, da de
alta). `react-hook-form` + `zodResolver(esquema)`. Al guardar con éxito: cierra y
toast; en error: toast con el mensaje del backend. La validación de captura es
solo UX.

## 6. Borrado SUAVE: desactivar, ver desactivados y REACTIVAR

Nada se borra físicamente. El ciclo de vida del borrado suave es **reversible** y
los tres pasos son parte del estándar (todo CRUD los hereda):

1. **Desactivar** (`DELETE /api/<modulo>/{id}` → `activo = false`): acción
   destructiva → se pide confirmación con `DialogoConfirmacion` (reutilizable)
   antes de mutar. Toast al terminar.
2. **Ver los desactivados**: un toggle "Mostrar desactivados" alterna el query
   `incluirInactivos` del API (paginación de servidor). **Por defecto la lista
   muestra solo activos.** Los desactivados se distinguen con un badge "Inactivo"
   atenuado (variante suave, no de error: es un estado válido).
3. **Reactivar** (restaurar): `PATCH /api/<modulo>/{id}` con `{ activo: true }`.
   Es una acción **NO destructiva**, así que se aplica **directo, sin diálogo de
   confirmación** (al revés que desactivar) → toast "… activado." → la lista se
   refresca (la mutación invalida la query).

El **menú de acciones por fila** es consciente del estado: siempre ofrece
**Editar**, y luego **Desactivar** si la fila está activa, o **Activar** si está
inactiva (nunca ambas). El backend ya soporta la reactivación (re-verifica que el
nombre siga libre y la audita); el frontend solo presenta.

```tsx
// En la columna de acciones (columnas.tsx):
{almacen.activo ? (
  <DropdownMenuItem variant="destructive" onSelect={() => alDesactivar(almacen)}>
    Desactivar
  </DropdownMenuItem>
) : (
  <DropdownMenuItem onSelect={() => alReactivar(almacen)}>Activar</DropdownMenuItem>
)}
```

```ts
// Hook de datos (api/<modulo>.ts): reactivar = PATCH { activo: true }
async function reactivar<Entidad>(id: number) {
  const { data, error } = await api.PATCH('/api/<modulo>/{id}', {
    params: { path: { id } },
    body: { activo: true },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}
```

---

## Accesibilidad y forma (todo lo menor es mayor)

- **Español** en toda la UI; identificadores en código sin acentos ni ñ.
- Títulos de diálogo y de confirmación son **encabezados reales** (los provee
  `DialogTitle` de shadcn).
- Inputs con `<label>` asociado (`FieldLabel htmlFor`), errores con `role="alert"`.
- **Responsive:** el layout colapsa el sidebar a un `Sheet` en móvil; las tablas
  hacen scroll horizontal.
- **Tema** claro/oscuro: usa los tokens de shadcn (`bg-card`, `text-muted-foreground`,
  …), nunca colores fijos, para que el modo oscuro funcione solo.
- `data-testid` en los puntos que las pruebas necesitan (botones de acción,
  filas, mensajes de error).

## Pruebas

- **Componente** (Vitest + Testing Library): renderiza la pantalla con el API
  simulado (`vi.mock('@/api/<modulo>')`) y la sesión inyectada
  (`renderConProveedores` de `src/pruebas/utilidades.tsx`). Casos mínimos: lista,
  estado vacío, estado de error, acciones ocultas sin permiso, confirmación de
  borrado, y que una fila inactiva ofrezca **Activar** (no Desactivar) y reactive
  sin confirmación.
- **E2E** (Playwright, stack real): el ciclo completo crear → aparece → editar →
  desactivar → mostrar desactivados → **reactivar** → vuelve a activo, más la
  búsqueda.

---

## Checklist para un módulo CRUD nuevo

1. [ ] El backend expone el contrato (rutas + esquemas Zod) y `npm run gen:api`
       trae los tipos.
2. [ ] `api/tipos.ts`: alias de los tipos del contrato (entidad, query, crear, editar).
3. [ ] `api/esquemas.ts`: esquema Zod de captura del formulario (UX).
4. [ ] `api/<modulo>.ts`: hooks `use<Modulo>s` (lista), `useCrear`, `useActualizar`,
       `useDesactivar`, `useReactivar`; las mutaciones invalidan la lista.
5. [ ] `modulos/<modulo>/columnas.tsx`: columnas de TanStack Table + acciones por
       `meta` (Editar siempre; Desactivar/Activar según el estado de la fila).
6. [ ] `modulos/<modulo>/Dialogo<Modulo>.tsx`: alta/edición con react-hook-form + Zod.
7. [ ] `modulos/<modulo>/<Modulo>Pagina.tsx`: búsqueda (debounce), orden y
       paginación de **servidor**, toggle "Mostrar desactivados"
       (`incluirInactivos`), estados carga/vacío/error, toasts, permisos.
8. [ ] Ruta en `App.tsx` (y enlace desde su módulo, p. ej. la portada de Catálogos).
9. [ ] Pruebas de componente (Vitest) + E2E (Playwright) del ciclo completo
       (incluida la reactivación).
10. [ ] `typecheck`, `lint`, `format:check`, `test`, `build` en verde; sin `any` ni `!`.
```
