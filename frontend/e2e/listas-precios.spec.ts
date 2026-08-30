import { expect, test } from '@playwright/test';

import { elegirCliente, entrarComoAdmin } from './ayudas';

/**
 * E2E del módulo LISTAS DE PRECIOS (F8-E4) contra el stack real. Cubre el ciclo del spec: preparar un
 * cliente + departamento + factores, un modelo con precosto CONGELADO (vía maquila), crear la lista
 * desde los candidatos, aprobar un renglón y comprobar que el PDF sale. Todo con datos únicos por
 * corrida (no depende del estado previo). Asume el admin sembrado (todos los permisos).
 */
test.describe('Listas de precios (F8-E4)', () => {
  test('capturar factores → congelar precosto → crear lista → aprobar → PDF', async ({ page }) => {
    const sufijo = Date.now().toString().slice(-6);
    const cliente = `Cliente Lista ${sufijo}`;
    const departamento = `NIÑOS ${sufijo}`;
    const codigoModelo = `LST-${sufijo}`;
    const nombreProyecto = `Lista ${sufijo}`;

    await entrarComoAdmin(page);

    // ── Cliente + departamento ──────────────────────────────────────────────────
    await page.goto('/catalogos/clientes');
    await page.getByTestId('nuevo-cliente').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(cliente);
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText(`Cliente "${cliente}" creado.`)).toBeVisible();

    await page.getByTestId('buscar-cliente').fill(cliente);
    await page.getByTestId('fila-cliente').filter({ hasText: cliente }).first().click();
    await page.getByTestId('nuevo-departamento').click();
    await page.getByRole('dialog').getByLabel('Nombre').fill(departamento);
    await page.getByTestId('guardar-departamento').click();
    await expect(page.getByText(`Departamento "${departamento}" agregado.`)).toBeVisible();

    // ── Factores por defecto del cliente (margen 50%, resto 0) ───────────────────
    const formFactores = page.getByTestId('form-factores-default');
    await formFactores.getByLabel('Margen %').fill('50');
    await page.getByTestId('guardar-factores-default').click();
    await expect(page.getByText('Factores por defecto guardados.')).toBeVisible();

    // ── Modelo ──────────────────────────────────────────────────────────────────
    await page.goto('/modelos');
    await page.getByTestId('nuevo-modelo').click();
    await page.getByRole('dialog').getByLabel('Código').fill(codigoModelo);
    // ⭐ V1-E8j (§Post-F9.134): tipo de prenda y género son OBLIGATORIOS en el alta — son los
    // dos dígitos con los que el sistema arma el nº de producción del modelo.
    await page
      .getByRole('dialog')
      .getByLabel('Tipo de producto')
      .selectOption({ label: 'Pantalón' });
    await page.getByRole('dialog').getByLabel('Género').selectOption({ label: 'Caballero' });
    await page.getByTestId('guardar-modelo').click();
    await expect(page.getByText(`Modelo "${codigoModelo}" creado.`)).toBeVisible();

    // ── Proyecto + desarrollo ───────────────────────────────────────────────────
    await page.goto('/desarrollo');
    await page.getByTestId('nuevo-proyecto').click();
    const dialogoProyecto = page.getByRole('dialog');
    await elegirCliente(page, dialogoProyecto, cliente, 'proyecto-cliente');
    await dialogoProyecto.getByLabel('Departamento').selectOption({ label: departamento });
    await dialogoProyecto.getByLabel('Nombre / tema').fill(nombreProyecto);
    await page.getByTestId('guardar-proyecto').click();
    await expect(page.getByText(/Proyecto \d+ creado\./)).toBeVisible();

    const detalleProyecto = page.getByTestId('detalle-proyecto');
    await page.getByTestId('fila-proyecto').filter({ hasText: nombreProyecto }).first().click();
    await detalleProyecto.getByTestId('agregar-desarrollo').click();
    const dialogoDesarrollo = page.getByRole('dialog');
    await dialogoDesarrollo.getByTestId('desarrollo-modelo-busqueda').fill(codigoModelo);
    await page
      .getByTestId('desarrollo-modelo-opcion')
      .filter({ hasText: codigoModelo })
      .first()
      .click();
    await page.getByTestId('guardar-desarrollo').click();
    await expect(page.getByText('Desarrollo agregado.')).toBeVisible();

    // ── Precosto: generar → poner maquila 50 → congelar ─────────────────────────
    await detalleProyecto
      .getByTestId('fila-desarrollo')
      .filter({ hasText: codigoModelo })
      .getByTestId('precostear-desarrollo')
      .click();
    const dialogoPrecosto = page.getByRole('dialog');
    await dialogoPrecosto.getByTestId('generar-precosto').click();
    await expect(page.getByText(/Precosto v1 generado\./)).toBeVisible();

    // Edita la maquila a 50 — pero ÉSE NO ES EL COSTO. Desde V1-E8w (§Post-F9.153) el EMPAQUE es la
    // TERCERA ancla fija del precosto (junto a maquila y corte) y entra SIEMPRE al generar, con el
    // valor de `ConfiguracionEmpresa.costoEmpaqueBase` (el seed no lo captura, así que manda el
    // `@default(2.20)` del esquema; el respaldo `COSTO_EMPAQUE_DEFECTO` vale lo mismo).
    // ⇒ costo v1 = maquila 50 + corte 0 (el modelo no captura `corteBase`) + empaque 2.20 = 52.20.
    // Ese 52.20 es el número del que cuelgan TODAS las cifras de abajo (precio, desglose, deltas).
    await dialogoPrecosto.getByTestId('grupo-maquila').getByTestId('editar-linea').click();
    await dialogoPrecosto.getByTestId('editar-linea-precio').fill('50');
    await dialogoPrecosto.getByTestId('guardar-linea').click();

    await dialogoPrecosto.getByTestId('congelar-precosto').click();
    await dialogoPrecosto.getByTestId('confirmar-precosto').click();
    // ⚠️ V1-E8f cambió este aviso: ya no termina en «congelado.» — ahora dice a dónde seguir, que
    // era el eslabón sin puerta del camino precosteo → lista → cotización.
    // 🔴 Y ÉSTA es la que faltaba: el arreglo anterior barrió `precosto.spec.ts` y NO este archivo,
    // porque se leyó la COLA del registro del CI (un solo fallo) en vez del RESUMEN (que los lista
    // todos). Tres vueltas de CI por leer el pedazo equivocado del mismo informe.
    await expect(
      page.getByText(/Precosto v1 congelado: ya puede incluirse en una lista de precios/),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    // ── Crear la lista desde los candidatos ─────────────────────────────────────
    await page.goto('/listas-precios');
    await expect(page.getByRole('heading', { name: 'Listas de precios' })).toBeVisible();
    await page.getByTestId('nuevo-lista-precios').click();
    const dialogoLista = page.getByRole('dialog');
    await elegirCliente(page, dialogoLista, cliente, 'crear-lista-cliente');
    await dialogoLista.getByLabel('Departamento').selectOption({ label: departamento });

    const candidato = dialogoLista.getByTestId('fila-candidato').filter({ hasText: codigoModelo });
    await expect(candidato).toBeVisible();
    await candidato.getByRole('checkbox').check();

    // Captura el id de la lista de la respuesta del POST (no del DOM): el body es la lista completa.
    const [crearResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/listas-precios') && r.request().method() === 'POST' && r.ok(),
      ),
      page.getByTestId('confirmar-crear-lista').click(),
    ]);
    const listaId = ((await crearResp.json()) as { id: number }).id;
    await expect(page.getByText(/Lista #\d+ creada\./)).toBeVisible();

    // Selecciona la lista recién creada (por el nombre del cliente, único por corrida).
    await page.getByTestId('fila-lista-precios').filter({ hasText: cliente }).first().click();

    // ── ⭐ V1-E8b (§Post-F9.125(c)): ANTES de aprobar no sale papel, ni borrador ──
    // Daniel: *"si no está aprobado no debería de poder bajar ni un borrador porque puede confundir
    // al cliente"*. Se comprueban las DOS capas: el servidor NIEGA (409) y la pantalla lo dice.
    const detalleLista = page.getByTestId('detalle-lista-precios');
    const renglon = detalleLista
      .getByTestId('fila-renglon-lista')
      .filter({ hasText: codigoModelo });
    await expect(renglon).toBeVisible();

    const pdfSinAprobar = await page.request.get(`/api/listas-precios/${String(listaId)}/pdf`);
    expect(pdfSinAprobar.status()).toBe(409);
    expect(await pdfSinAprobar.text()).toContain(codigoModelo);
    const excelSinAprobar = await page.request.get(`/api/listas-precios/${String(listaId)}/excel`);
    expect(excelSinAprobar.status()).toBe(409);
    // Y la pantalla no ofrece un botón que falla: está deshabilitado y dice por qué.
    await expect(detalleLista.getByTestId('descargar-lista-pdf')).toBeDisabled();
    await expect(detalleLista.getByTestId('descargar-lista-excel')).toBeDisabled();
    await expect(detalleLista.getByTestId('aviso-sin-aprobar')).toContainText(codigoModelo);

    // ── Aprobar el renglón ──────────────────────────────────────────────────────
    await renglon.getByTestId('aprobar-renglon').click();
    await expect(page.getByText(`Renglón "${codigoModelo}" aprobado.`)).toBeVisible();
    await expect(renglon).toHaveAttribute('data-aprobado', 'true');
    // Con costo 52.20 (maquila 50 + corte 0 + empaque 2.20) y margen 50%, `calcularPrecioLista`
    // da Math.ceil(52.20 / (1 − 50/100)) = Math.ceil(104.40) = 105 ⇒ $105.00.
    // ⚠️ Es `Math.ceil`, NO redondeo normal (D2 #4, redondeo AL ALZA): 104.40 sube a 105, no baja
    // a 104. Aprobar sin teclear precio copia el calculado, así que el aprobado es el mismo.
    // 🔴 Antes del empaque esto decía $100.00 (costo 50 ÷ 0.5). La tercera ancla movió el costo y
    // esta línea se quedó atrás → CI rojo. Quien mueva `costoEmpaqueBase` rehace esta cuenta.
    // Se apunta al badge del aprobado (evita strict mode: $105.00 aparece también en la celda del
    // calculado).
    await expect(renglon.getByTestId('precio-aprobado')).toHaveText('$105.00');

    // ── §4.8: el renglón EXPANDE su desglose de costo por concepto (server-side) ──
    await renglon.getByTestId('alternar-desglose').click();
    const desglose = page.getByTestId('desglose-renglon');
    await expect(desglose).toBeVisible();
    await expect(desglose.getByTestId('desglose-concepto').first()).toBeVisible();
    // ⭐ V1-E8w: el desglose trae TRES conceptos, no dos — Maquila $50.00 (orden 3), Corte $0.00
    // (orden 8) y Empaque $2.20 (orden 9). El conteo se afirma A PROPÓSITO: el empaque entró como
    // un renglón NUEVO en todo precosto, y si mañana aparece una cuarta ancla queremos que lo diga
    // una prueba y no un total que ya no cuadra.
    await expect(desglose.getByTestId('desglose-concepto')).toHaveCount(3);
    await expect(
      desglose.getByTestId('desglose-concepto').filter({ hasText: 'Empaque' }),
    ).toContainText('$2.20');
    // Total = 50 (maquila) + 0 (corte) + 2.20 (empaque) = $52.20. Antes del empaque eran $50.00.
    await expect(desglose.getByTestId('desglose-total')).toHaveText('$52.20');
    await renglon.getByTestId('alternar-desglose').click(); // colapsa

    // ── El PDF sale (R9): el endpoint responde 200 con application/pdf ───────────
    // Se verifica con una request autenticada (comparte cookies de sesión), no vía popup:
    // en Chromium headless de CI no hay visor de PDF, así que el tab nunca navega a la URL.
    const pdf = await page.request.get(`/api/listas-precios/${String(listaId)}/pdf`);
    expect(pdf.ok()).toBeTruthy();
    expect(pdf.headers()['content-type']).toContain('application/pdf');

    // ── F8-E5: NEGOCIACIÓN — nueva ronda (re-costeo) sobre el renglón ────────────
    await renglon.getByTestId('abrir-negociacion').click();
    const panel = page.getByTestId('panel-negociacion');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('negociacion-vacia')).toBeVisible();

    // Nueva ronda → abre el editor de precosto → genera v2 → maquila 80 → congela.
    await panel.getByTestId('abrir-nueva-ronda').click();
    const formRonda = page.getByTestId('form-nueva-ronda');
    // §4.8: la calculadora es alcanzable a COSTO VIGENTE desde que se abre la ronda, SIN elegir una
    // versión nueva (el caso "¿me da margen al precio que ofrece el cliente sin tocar la prenda?").
    await formRonda.getByTestId('calculadora-precio-objetivo').fill('120');
    await expect(formRonda.getByTestId('margen-bruto')).toBeVisible();
    await formRonda.getByTestId('abrir-editor-precosto').click();

    const editor = page.getByTestId('dialogo-precosto');
    await editor.getByTestId('generar-precosto').click();
    await expect(page.getByText(/Precosto v2 generado\./)).toBeVisible();
    await editor.getByTestId('grupo-maquila').getByTestId('editar-linea').click();
    await editor.getByTestId('editar-linea-precio').fill('80');
    await editor.getByTestId('guardar-linea').click();
    await editor.getByTestId('congelar-precosto').click();
    await editor.getByTestId('confirmar-precosto').click();
    await expect(
      page.getByText(/Precosto v2 congelado: ya puede incluirse en una lista de precios/),
    ).toBeVisible();
    await page.keyboard.press('Escape'); // cierra el editor (dialog superior)

    // Elige la v2 congelada + escribe el acuerdo + confirma la ronda. La opción trae el costo en el
    // texto —hoy "v2 · $82.20" (maquila 80 + corte 0 + empaque 2.20), no "$80.00"—, y JUSTO POR ESO
    // se elige por ÍNDICE y no por texto: el número de la etiqueta se mueve cada vez que cambia una
    // ancla del precosto (el empaque de V1-E8w ya lo movió una vez). La única versión elegible es
    // la v2 recién congelada (la v1, que el renglón ya usa, queda excluida) → índice 1 tras el
    // placeholder.
    await expect(formRonda.getByTestId('ronda-version').locator('option')).toHaveCount(2);
    await formRonda.getByTestId('ronda-version').selectOption({ index: 1 });
    await formRonda.getByTestId('ronda-acuerdo').fill('Se sube la maquila (nueva versión)');
    // §4.8: al elegir la versión, la CALCULADORA en vivo muestra el margen del precio objetivo contra
    // el costo de la v2 (el objetivo capturado va también como precio acordado del evento).
    // El badge de «cumple» SIGUE en verde con el empaque dentro: contra el costo v2 = 82.20 (no 80),
    // un objetivo de 200 sin descuentos/regalías deja (200 − 82.20) ÷ 200 = 58.9 % de margen bruto,
    // por encima del 50 % objetivo del cliente. El empaque le come 1.1 puntos, no lo tumba.
    await formRonda.getByTestId('calculadora-precio-objetivo').fill('200');
    await expect(formRonda.getByTestId('margen-bruto')).toBeVisible();
    await expect(formRonda.getByTestId('badge-cumple-objetivo')).toBeVisible();
    // `confirmar-ronda` vive en el DialogFooter (hermano del contenedor form-nueva-ronda), no dentro de
    // él → se busca a nivel page (es único en pantalla mientras el diálogo de ronda está abierto).
    await page.getByTestId('confirmar-ronda').click();
    await expect(page.getByText(`Ronda registrada para "${codigoModelo}".`)).toBeVisible();

    // El evento queda en el historial y el comparador muestra el cambio.
    await expect(panel.getByTestId('fila-evento-negociacion')).toHaveCount(1);
    await panel.getByTestId('comparar-evento').click();
    await expect(page.getByTestId('comparador-versiones')).toBeVisible();
    // v1 (maquila 50) → v2 (maquila 80) ⇒ delta +$30.00.
    // ⭐ Y ESTE NÚMERO NO LO MUEVE EL EMPAQUE, a diferencia de todos los de arriba: el delta es una
    // RESTA de totales (82.20 − 52.20) y el empaque de 2.20 entra IGUAL en las dos versiones, así
    // que se cancela. Queda anotado para que nadie lo "corrija" a 32.20 la próxima vez que barra
    // este archivo detrás de un cambio de anclas: lo único que cambió entre v1 y v2 es la maquila.
    await expect(page.getByTestId('comparador-delta')).toHaveText('$30.00');

    // Cierra el panel: el renglón trae el precio NUEVO y el aprobado RESETEADO. El calculado de la
    // v2 es Math.ceil(82.20 / 0.5) = Math.ceil(164.40) = 165 (antes del empaque era 160).
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('panel-negociacion')).toHaveCount(0);
    await expect(renglon).toHaveAttribute('data-aprobado', 'false');

    // ── F8-E5: ESTADOS — cerrar la lista bloquea la negociación; reabrir la desbloquea ──
    const selectorEstado = page.getByTestId('selector-estado-lista');
    await selectorEstado
      .getByTestId('nuevo-estado-lista')
      .selectOption({ label: 'Cerrada (cierre)' });
    await selectorEstado.getByTestId('confirmar-estado-lista').click();
    await expect(page.getByText(/Estado cambiado a "Cerrada"\./)).toBeVisible();

    // Con la lista cerrada, un acuerdo se rechaza (guard esCierre en el backend).
    await renglon.getByTestId('abrir-negociacion').click();
    await page.getByTestId('abrir-acuerdo').click();
    await page.getByTestId('acuerdo-texto').fill('Intento con lista cerrada');
    await page.getByTestId('confirmar-acuerdo').click();
    await expect(page.getByText(/lista está cerrada/i)).toBeVisible();
    await page.keyboard.press('Escape'); // cierra el diálogo de acuerdo (dialog superior)
    await page.keyboard.press('Escape'); // cierra el panel de negociación
    await expect(page.getByTestId('panel-negociacion')).toHaveCount(0);

    // Reabrir (auditado) y verificar que el acuerdo ya procede.
    await selectorEstado.getByTestId('nuevo-estado-lista').selectOption({ label: 'Abierta' });
    await selectorEstado.getByTestId('confirmar-estado-lista').click();
    await expect(page.getByText(/Estado cambiado a "Abierta"\./)).toBeVisible();

    await renglon.getByTestId('abrir-negociacion').click();
    await page.getByTestId('abrir-acuerdo').click();
    await page.getByTestId('acuerdo-texto').fill('Acuerdo tras reabrir');
    await page.getByTestId('confirmar-acuerdo').click();
    await expect(page.getByText(`Acuerdo registrado para "${codigoModelo}".`)).toBeVisible();
    await page.keyboard.press('Escape'); // cierra el panel de negociación
    await expect(page.getByTestId('panel-negociacion')).toHaveCount(0);

    // ── ⭐ V1-E8d (§Post-F9.127): AVISAR CUANDO LA RECETA CAMBIA BAJO EL PRECIO ──
    //
    // Daniel: *"Si. Ok. Que me avise."* El renglón apunta a un precosto CONGELADO —inmutable por
    // diseño (D3)— así que mover la receta del modelo NO lo mueve. Aquí se recorren las DOS mitades
    // de la etapa, en este orden porque la segunda sólo significa algo después de la primera.
    //
    // Va al FINAL a propósito: el arte que se agrega abajo tiene precio y entraría en cualquier
    // precosto que se generara después, moviendo los costos que las ronda de arriba afirman.

    // 1. De salida, nadie avisa nada: el aviso no se enciende solo.
    await expect(detalleLista.getByTestId('aviso-costo-viejo')).toHaveCount(0);

    // 2. ⭐ LA MITAD QUE SEPARA ESTA SOLUCIÓN DE LA BARATA: tocar algo que NO es la receta
    //    —renombrar el modelo— no dispara nada. Contra `Modelo.modificadoEn` (que es `@updatedAt`)
    //    esta línea saldría ROJA: renombrar mueve esa fecha igual que cambiar una tela.
    const listado = await page.request.get(
      `/api/modelos?busqueda=${encodeURIComponent(codigoModelo)}`,
    );
    expect(listado.ok()).toBeTruthy();
    const idModelo = ((await listado.json()) as { datos: { id: number }[] }).datos[0]!.id;
    const renombrado = await page.request.patch(`/api/modelos/${String(idModelo)}`, {
      data: { descripcion: `Nombre corregido ${sufijo}` },
    });
    expect(renombrado.ok()).toBeTruthy();

    await page.reload();
    await page.getByTestId('fila-lista-precios').filter({ hasText: cliente }).first().click();
    await expect(detalleLista.getByTestId('fila-renglon-lista')).toBeVisible();
    await expect(detalleLista.getByTestId('aviso-costo-viejo')).toHaveCount(0);

    // 3. ⭐ Y la RECETA sí: se le agrega un ARTE al modelo por la pantalla donde se opera.
    await page.goto('/modelos');
    await page.getByTestId('buscar-modelo').fill(codigoModelo);
    await page.getByTestId('fila-modelo').filter({ hasText: codigoModelo }).first().click();
    const detalleModelo = page.getByTestId('detalle-modelo');
    await detalleModelo.getByTestId('tab-bom-artes').click();
    await detalleModelo.getByTestId('agregar-arte').click();
    const dialogoArte = page.getByTestId('dialogo-arte');
    await dialogoArte.getByTestId('arte-descripcion').fill(`Logo ${sufijo}`);
    await dialogoArte.getByTestId('arte-tipo').selectOption({ label: 'Bordado' });
    await page.getByTestId('guardar-arte').click();
    await expect(page.getByText('Arte agregado.')).toBeVisible();

    // 4. El aviso aparece en la lista, con la FRASE del servidor: qué cambió y contra qué costo.
    await page.goto('/listas-precios');
    await page.getByTestId('fila-lista-precios').filter({ hasText: cliente }).first().click();
    const avisoCosto = detalleLista.getByTestId('aviso-costo-viejo');
    await expect(avisoCosto).toBeVisible();
    await expect(avisoCosto).toContainText('el ARTE');
    await expect(avisoCosto).toContainText(codigoModelo);
    await expect(detalleLista.getByTestId('aviso-costo-viejo-resumen')).toContainText(codigoModelo);

    // 5. Es un AVISO, no un candado: el renglón se sigue pudiendo aprobar (§Post-F9.127).
    await expect(renglon.getByTestId('aprobar-renglon')).toBeEnabled();

    // ── ⭐⭐ V1-E8x (§Post-F9.151 / §Post-F9.155): LOS ESTADOS DEL MODELO Y EL PAPEL ──
    //
    // Daniel: *«a veces de una lista de 10 modelos, cierro 5 y los otros ya no los vendo»*. Va al
    // FINAL del recorrido a propósito: dropea el ÚNICO renglón de esta lista, así que después de
    // aquí no queda nada que negociar (se revive al cerrar, para dejar la lista utilizable).

    // Se re-aprueba (la ronda de arriba tumbó la firma) para que el papel dependa SÓLO del estado.
    await renglon.getByTestId('aprobar-renglon').click();
    await expect(page.getByText(`Renglón "${codigoModelo}" aprobado.`)).toBeVisible();
    await expect(detalleLista.getByTestId('descargar-lista-pdf')).toBeEnabled();

    // El chip del MODELO existe y arranca en «Abierto» (todo renglón nace ahí).
    await expect(renglon.getByTestId('chip-estado-renglon')).toHaveText('Abierto');

    // DROPEARLO: el estado se mueve desde la fila, en un toque.
    await renglon.getByTestId('estado-renglon').selectOption('dropeado');
    await expect(page.getByText(`"${codigoModelo}" quedó en «Dropeado».`)).toBeVisible();
    await expect(renglon.getByTestId('chip-estado-renglon')).toHaveText('Dropeado');
    await expect(renglon).toHaveAttribute('data-estado', 'dropeado');

    // Como era el ÚNICO renglón, la lista se queda sin nada vigente: el papel se apaga y DICE por
    // qué (el caso límite de §Post-F9.155), y el servidor contesta lo mismo con un 409.
    await expect(detalleLista.getByTestId('descargar-lista-pdf')).toBeDisabled();
    await expect(detalleLista.getByTestId('aviso-dropeados')).toContainText(codigoModelo);
    const pdfTodoDropeado = await page.request.get(`/api/listas-precios/${String(listaId)}/pdf`);
    expect(pdfTodoDropeado.status()).toBe(409);
    expect((await pdfTodoDropeado.text()).toUpperCase()).toContain('DROPEADOS');

    // Y un modelo dropeado ya no admite movimiento: el acuerdo se rechaza (guard del renglón).
    await renglon.getByTestId('abrir-negociacion').click();
    await page.getByTestId('abrir-acuerdo').click();
    await page.getByTestId('acuerdo-texto').fill('Intento sobre un modelo dropeado');
    await page.getByTestId('confirmar-acuerdo').click();
    await expect(page.getByText(/ya no admite acuerdos nuevos/i)).toBeVisible();
    await page.keyboard.press('Escape'); // cierra el diálogo de acuerdo
    await page.keyboard.press('Escape'); // cierra el panel de negociación
    await expect(page.getByTestId('panel-negociacion')).toHaveCount(0);

    // REVIVIRLO: vuelve al papel CON su precio aprobado intacto — revivir no pierde nada.
    await renglon.getByTestId('estado-renglon').selectOption('en_negociacion');
    await expect(page.getByText(`"${codigoModelo}" quedó en «En negociación».`)).toBeVisible();
    await expect(renglon).toHaveAttribute('data-aprobado', 'true');
    await expect(detalleLista.getByTestId('descargar-lista-pdf')).toBeEnabled();
    await expect(detalleLista.getByTestId('aviso-dropeados')).toHaveCount(0);
  });
});
