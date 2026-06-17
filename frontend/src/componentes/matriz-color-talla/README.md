# Matriz Color × Talla (componente reutilizable)

Rejilla de captura de cantidades por **color (filas) × talla (columnas)**, con totales en vivo y
captura por teclado. Es **presentación pura** (regla A1): no tiene lógica de negocio; el backend
valida y es la autoridad. Pensado para reusarse en **F3** (corte, envíos, recibos, entregas) y en
cualquier flujo que capture cantidades por color × talla.

## Contrato de props (`PropsMatrizColorTalla`)

El componente es **controlado en dos ejes independientes**: el padre es dueño de las columnas
(`tallas`) y de las filas (`lineas`), y reacciona a sus dos callbacks.

| Prop                 | Tipo                                            | Descripción                                                                 |
| -------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| `tallas`             | `MatrizTalla[]` (`{ idTalla, etiqueta }`)       | Columnas, en orden. Estado controlado del padre.                            |
| `lineas`             | `MatrizLinea[]` (`{ idColor, color, cantidades }`) | Filas (valor controlado). `cantidades` = `{ [idTalla]: number }`; ausente = 0. |
| `coloresDisponibles` | `MatrizColorOpcion[]` (`{ id, nombre }`)        | Catálogo para agregar una fila. Los colores ya usados se **ocultan**.       |
| `tallasDisponibles`  | `MatrizTalla[]`                                  | Catálogo para agregar columnas fuera de curva. Las presentes se **ocultan**.|
| `onLineasChange`     | `(lineas) => void`                              | Emite el nuevo set de filas (editar celda, agregar/quitar color).           |
| `onTallasChange`     | `(tallas) => void`                              | Emite el nuevo set de columnas (agregar/quitar talla).                      |
| `soloLectura?`       | `boolean`                                       | Oculta toda edición (orden cancelada / sin permiso); la matriz sigue visible.|
| `testid?`            | `string` (def. `"matriz"`)                      | Base de los `data-testid`.                                                   |

### Comportamiento

- **Celdas**: enteros ≥ 0. Vacío = 0; negativos/decimales se normalizan en la UX (el backend
  re-valida). El valor `0` se muestra como celda vacía para una captura más limpia.
- **Totales en vivo**: por fila (`<testid>-total-fila`), por columna (`<testid>-total-columna`) y
  total general (`<testid>-total-general`), recalculados al teclear.
- **Captura por teclado**: `Tab` (nativo), `Enter` y flechas mueven el foco entre celdas; una fila
  completa se captura sin tocar el mouse. Al enfocar una celda se selecciona su contenido.
- **Agregar/quitar fila (color)** y **agregar/quitar columna (talla extra)**. El color duplicado se
  bloquea en la UX (no aparece en el selector); el backend re-valida la unicidad.
- **Responsive**: scroll horizontal en móvil. Usa tokens de tema shadcn (`bg-muted`,
  `text-muted-foreground`, …); nunca colores fijos, para que el modo oscuro funcione solo.
- **Rendimiento**: memoizado (`memo`) y con cálculos `useMemo`; teclear en una celda no re-renderiza
  el árbol del padre si sus props no cambian.

## Ejemplo de uso (espejo de cómo lo usa Órdenes en F2-E3)

```tsx
const [tallas, setTallas] = useState<MatrizTalla[]>(columnasIniciales);
const [lineas, setLineas] = useState<MatrizLinea[]>(filasIniciales);

<MatrizColorTalla
  tallas={tallas}
  lineas={lineas}
  coloresDisponibles={colores.map((c) => ({ id: c.id, nombre: c.nombre }))}
  tallasDisponibles={catalogoTallas.map((t) => ({ idTalla: t.id, etiqueta: t.etiqueta }))}
  onTallasChange={setTallas}
  onLineasChange={setLineas}
  soloLectura={ordenCancelada || !puedeAdministrar}
  testid="matriz-orden"
/>;
```

Al guardar, el padre mapea `lineas` al cuerpo del API (`{ lineas: [{ idColor, tallas: [{ idTalla,
cantidad }] }] }`), normalmente omitiendo las tallas en 0 según convenga al endpoint destino.

## Guía de reuso en F3

- Para corte/envíos/recibos/entregas, el mismo componente sirve: cada flujo arma sus filas a partir
  de la matriz de la orden y captura las cantidades del paso (cortadas, enviadas, recibidas…). Solo
  cambia el **mapeo al cuerpo del API** y, si aplica, el `soloLectura`.
- Si un flujo necesita **dos cantidades por celda** (p. ej. enviada/recibida), conviene **no**
  forzarlo en este componente: o se renderizan dos matrices, o se extiende el contrato con un
  render de celda inyectable. Mantener la matriz simple es deliberado (A1: presentación pura).
