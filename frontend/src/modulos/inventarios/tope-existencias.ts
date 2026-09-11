/**
 * ⭐ EL TOPE QUE PIDEN LAS PANTALLAS DE **CAPTURA** DE PT (fila 0.143, ronda de corrección).
 *
 * Desde la 0.143 `GET /inventarios/pt/existencias` recorta: devuelve como mucho `limite` renglones
 * y avisa. Ese recorte cura la pantalla de **Existencias**, cuyo universo es *todo el almacén*.
 *
 * 🔴 **PERO LAS DOS PANTALLAS DE CAPTURA NO QUIEREN UNA VENTANA: QUIEREN LA LISTA COMPLETA.**
 * Movimientos y Traspasos no pintan esos renglones — los usan para deducir **de qué órdenes hay
 * piezas** (el desplegable) y **cuántas hay** (el aviso de sobre-traspaso). Un renglón que no llega
 * no se ve «recortado»: se ve como *«esa orden no tiene piezas»*. Y si el operador se lo cree,
 * captura la entrada como «sin orden» y el bucket PT-por-orden (F6-E2) queda mal **en un módulo D3,
 * donde lo guardado es inmutable y sólo se corrige con un inverso auditado**.
 *
 * ⭐⭐ **Y AQUÍ NINGÚN ORDEN DE CORTE SIRVE, QUE ES EL FONDO DEL ASUNTO.** El corte del dominio va
 * por `abs(existencia) DESC`, así que **los renglones en CERO son, por construcción, los últimos —
 * o sea los primeros que el tope descarta**. Eso apunta justo al modo **ENTRADA** de Movimientos,
 * que pide `incluirCeros` A PROPÓSITO (el regreso del estampado deja el bucket en cero y hay que
 * poder elegirlo). Medido: con **80 renglones y sitio para 40**, de los **16 en cero** sobrevivieron
 * **0**. La tentación es reordenar para que los ceros ganen — y sería un error: quien pierde
 * entonces es un bucket CON saldo, y en esta pantalla eso hace exactamente el mismo daño. **Estas
 * pantallas no necesitan un mejor recorte: necesitan que no haya recorte.**
 *
 * 📐 **Por eso piden el TECHO del contrato, y por eso no cuesta nada.** `limite` es un **techo, no
 * un tamaño de página**: sólo viaja lo que existe. Un modelo normal trae decenas o cientos de
 * renglones y pedir 5 000 transfiere exactamente lo mismo que pedir 1 000; el techo alto sólo se
 * nota en el modelo patológico, que es justo donde hace falta. Y su universo es **UN MODELO**, no
 * el almacén: el número por omisión, pensado para «todo el inventario», aquí no aplica.
 *
 * ⚠️ **Lo que esto NO hace, dicho en voz alta: no elimina el techo, lo sube 5×.** Con 8 tallas × 3
 * almacenes son 24 renglones por (color × orden), así que 5 000 alcanza para ~208 combinaciones —
 * con 5 colores, unas 41 órdenes del mismo modelo. Un modelo muy longevo puede pasarlo, y entonces
 * vuelve a faltar un bucket (con el aviso puesto, eso sí). **La cura de fondo es que el desplegable
 * salga de un agregado en SERVIDOR** —«dame las órdenes con existencia de este modelo», A1— en vez
 * de deducirse en el navegador de una lista de renglones; eso es fila propia y no la abre ésta.
 *
 * 🔒 El número vive DOS veces —aquí y como `.max()` en el querystring publicado— y por eso
 * `tope-existencias.test.ts` lo cruza contra el `openapi.json` generado: si el backend baja su
 * techo, estas pantallas pedirían un `limite` que la API contesta con **400 en cada carga**.
 */
export const TOPE_EXISTENCIAS_PT = 5000;
