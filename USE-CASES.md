# USE-CASES.md — Software de gestión para ferretería

> Estado: **revisado**. El catálogo de casos (§3) sigue vigente y es la referencia de prioridades.
> Fecha: 2026-07-30
> Fuentes: esquema de datos de OSPOS (27 tablas, 46 migraciones) + NexoPOS (54 migraciones), cruzados con la operación de una ferretería chilena.
>
> **Qué quedó superado:** el modelo preliminar de §4 lo reemplaza `schema.prisma`, y las
> decisiones abiertas de §5 se cerraron casi todas. Las decisiones vigentes viven en
> `STATE.md`; su razonamiento completo, en `.agents/DECISIONS/`.

---

## 1. Metodología

Se descargaron ambos repos y se leyó **el esquema de base de datos y el historial de migraciones**, no el código. El razonamiento: cada migración posterior al esquema inicial es una cicatriz — alguien la escribió porque un caso real reventó en producción. Ese historial es exactamente el "parcheo largo" que queremos evitar pagar de nuevo.

No se copia código. Se cosechan **decisiones de modelado**.

---

## 2. Hallazgos estructurales

Seis cosas que ambos proyectos resolvieron y que deben estar en el schema **desde el día uno**, porque agregarlas después obliga a migrar datos históricos.

### 2.1 El stock es un libro, no un número

OSPOS tiene una tabla `inventory` que es un log append-only: `trans_items`, `trans_user`, `trans_date`, `trans_comment`, `trans_location`, `trans_inventory` (el delta). Aparte mantiene `item_quantities` como **caché** del stock actual por ubicación.

→ Adoptamos el patrón: `stock_movements` (inmutable, la verdad) + `stock_levels` (caché, reconstruible). Si alguna vez el caché se desincroniza, se recalcula desde el libro. Nunca al revés.

### 2.2 Unidad de compra ≠ unidad de venta

Confirmado en ambos. OSPOS lo resuelve con `items.receiving_quantity` (factor de conversión). NexoPOS lo hace bien más elegante: tablas `units` + `units_group`, donde cada unidad tiene `group_id`, `value` y un flag `base_unit`.

Ejemplo del modelo NexoPOS aplicado a ferretería:

| Grupo | Unidad | value | base |
|---|---|---|---|
| Cable | Metro | 1 | ✅ |
| Cable | Rollo 100m | 100 | ❌ |
| Tornillo | Unidad | 1 | ✅ |
| Tornillo | Caja 100u | 100 | ❌ |

Compras en rollo, vendes en metro, el kardex vive en la unidad base. **Este es el hallazgo más importante del cruce.** Sin esto, el margen que muestre el sistema es mentira.

### 2.3 La caja también es un libro

NexoPOS tiene `registers` + `registers_history`, y esta última guarda por cada movimiento: `action`, `author_id`, `value`, `balance_before`, `balance_after`. Cada peso que entra o sale queda con foto del saldo antes y después.

→ El arqueo deja de ser un cálculo y pasa a ser una lectura. Y las diferencias son rastreables hasta el vendedor y la hora.

### 2.4 El costo se congela en la línea de venta

`sales_items` de OSPOS guarda `item_cost_price` **además** de `item_unit_price`. O sea, copia el costo del producto en el momento de la venta.

→ Sin esto, si mañana sube el precio del proveedor, todos tus márgenes históricos se recalculan solos y los reportes del año pasado cambian. Es un error silencioso y grave.

### 2.5 Una venta tiene N pagos

OSPOS partió con un solo pago por venta y **tuvo que rehacer la tabla completa** (migración `paymenttracking`: renombra la tabla vieja a `_backup` y migra los datos). Caso real: el cliente paga $30.000 con $20.000 en efectivo y $10.000 con débito.

→ Nacemos con `sale_payments` como tabla aparte. Gratis ahora, carísimo después.

### 2.6 Redondeo de efectivo

OSPOS agregó `cash_adjustment` en la migración `cashrounding`. En Chile esto no es opcional: no circulan monedas de $1 ni $5, y el pago en efectivo se redondea a la decena. El redondeo **se registra como línea propia**, no se disimula en el total, o la caja nunca cuadra.

---

## 3. Catálogo de casos de uso

Leyenda: **MVP** = va en la v1 · **v2** = después, pero el schema lo contempla · **NO** = descartado

### 3.1 Catálogo de productos

| ID | Caso | Prio | Nota |
|---|---|---|---|
| CAT-01 | Producto con código de barras del fabricante | MVP | Lector USB = teclado |
| CAT-02 | Producto **sin** código de barras → código interno + etiqueta impresa | MVP | Tornillos, fittings, terminales. Es la mitad del catálogo |
| CAT-03 | Varios códigos de barra para un mismo producto | MVP | Mismo perno, dos proveedores, dos códigos |
| CAT-04 | Unidad de compra ≠ unidad de venta (ver 2.2) | MVP | Estructural |
| CAT-05 | Venta fraccionada (cable por metro, cadena, manguera) | MVP | Decimales en cantidad, no enteros |
| CAT-06 | Categorías y marcas | MVP | |
| CAT-07 | Producto compuesto / kit (kit instalación WC) | v2 | NexoPOS: `products_group_items` |
| CAT-08 | Producto serializado con garantía (herramienta eléctrica) | v2 | OSPOS: `is_serialized` |
| CAT-09 | Foto del producto | v2 | Cargar 5.000 fotos es un proyecto aparte |
| CAT-10 | Variantes (tornillo 3x30 / 3x40 / 3x50) | NO | **Recomendación: cada medida es un SKU propio.** Las variantes complican el kardex y en ferretería no aportan |
| CAT-11 | Importación masiva desde Excel | MVP | Es cómo se carga el inventario inicial |

### 3.2 Inventario y kardex

| ID | Caso | Prio | Nota |
|---|---|---|---|
| INV-01 | Movimiento inmutable con autor, fecha y motivo | MVP | Estructural |
| INV-02 | Recepción de compra a proveedor | MVP | Entra en unidad de compra, se convierte |
| INV-03 | Ajuste por toma de inventario | MVP | Con motivo obligatorio |
| INV-04 | Merma / rotura / robo | MVP | El saco de cemento reventado |
| INV-05 | Costo promedio ponderado (PMP) | MVP | Se recalcula en cada recepción |
| INV-06 | Inventario valorizado a la fecha | MVP | Reporte |
| INV-07 | Devolución a proveedor | v2 | Movimiento negativo con referencia a la compra |
| INV-08 | Traslado bodega ↔ sala de venta | v2 | Requiere definir si hay bodega separada |
| INV-09 | Conteo cíclico por categoría | v2 | Contar 5.000 SKU de una vez no ocurre nunca |
| INV-10 | Bloquear venta con stock insuficiente | MVP | **Con override de admin**, registrado como `STOCK_OVERRIDE` en `AuditLog`. Bloqueo duro obliga a los vendedores a mentirle al sistema |

### 3.3 Punto de venta y caja

| ID | Caso | Prio | Nota |
|---|---|---|---|
| POS-01 | Apertura de caja con monto inicial declarado | MVP | |
| POS-02 | Venta escaneando código | MVP | |
| POS-03 | Búsqueda por nombre / código interno | MVP | Crítico: media tienda no tiene código |
| POS-04 | Varios medios de pago en una venta | MVP | Ver 2.5 |
| POS-05 | Redondeo a $10 en efectivo | MVP | Ver 2.6 |
| POS-06 | Cálculo de vuelto + apertura de cajón | MVP | El cajón se abre por pulso de la térmica. **El vuelto va en `SalePayment.receivedAmount`/`changeAmount` (ADR-003)** |
| POS-07 | Registrar folio y tipo de documento del POS tributario | MVP | La doble digitación acordada |
| POS-08 | Venta en espera / suspendida | MVP | OSPOS tiene `sales_suspended` con tabla propia — el cliente va a buscar otra cosa y el mesón se libera. **Resuelto en `SuspendedSale`/`SuspendedSaleItem`, tabla aparte (ADR-001)** |
| POS-09 | Descuento por línea y por venta, con permiso | MVP | Vendedor limitado a X%, admin sin tope |
| POS-10 | Anulación de venta | MVP | **Documento contrario, nunca DELETE** |
| POS-11 | Devolución total o parcial con reingreso a stock | MVP | Con motivo y autorización. **Una venta admite N devoluciones parciales; cada línea apunta a la que revierte (ADR-002)** |
| POS-12 | Cierre de caja con arqueo y diferencia | MVP | Ver 2.3 |
| POS-13 | Retiro / ingreso de efectivo durante el turno | MVP | Pagar el flete, cambiar sencillo |
| POS-14 | Cotización que se convierte en venta | v2 | Muy usado con maestros y empresas |
| POS-15 | Fiado / cuenta corriente con abonos | ~~v2~~ **NO** | NexoPOS: `orders_instalments`. **Confirmado: no aplica.** Está en Fuera de alcance de `STATE.md` |
| POS-16 | Precio mayorista por tipo de cliente | v2 | NexoPOS: `customers_groups` |
| POS-17 | Gastos de caja categorizados | v2 | |
| POS-18 | Reimprimir comprobante | MVP | Se pide todos los días |

### 3.4 Usuarios y control

| ID | Caso | Prio | Nota |
|---|---|---|---|
| USR-01 | Roles admin / vendedor | MVP | |
| USR-02 | Login con PIN en el mesón | MVP | Contraseña larga en mesón = PIN pegado en el monitor |
| USR-03 | Vendedor **no ve** costos ni márgenes | MVP | Regla de negocio, no cosmética |
| USR-04 | Auditoría de acciones sensibles | MVP | Anulaciones, descuentos, ajustes, retiros |
| USR-05 | Permisos granulares por acción | v2 | OSPOS tiene `permissions` + `grants` |

### 3.5 Alertas

| ID | Caso | Prio | Nota |
|---|---|---|---|
| ALE-01 | Stock bajo el mínimo | MVP | OSPOS: `items.reorder_level` |
| ALE-02 | Quiebre de stock | MVP | |
| ALE-03 | Diferencia de caja sobre umbral | MVP | |
| ALE-04 | Producto sin rotación en N días | v2 | Capital muerto en repisa |
| ALE-05 | Sugerencia de pedido a proveedor | v2 | Basado en consumo histórico |
| ALE-06 | Descuento sobre umbral aplicado por vendedor | v2 | Control de fuga de margen |

### 3.6 WhatsApp

| ID | Caso | Prio | Nota |
|---|---|---|---|
| WA-01 | Mensaje post-venta con consentimiento explícito | MVP | Checkbox en pantalla de pago |
| WA-02 | Cola con reintentos ante caída de internet | MVP | La venta nunca se bloquea por WhatsApp |
| WA-03 | Opt-out y registro de la baja | MVP | Requisito legal, no cortesía |
| WA-04 | Plantillas editables por el admin | v2 | |
| WA-05 | Campañas masivas | NO | **Es lo que hace que Meta bloquee el número.** Riesgo desproporcionado |

### 3.7 Descartado del alcance

| Caso | Motivo |
|---|---|
| Emisión de DTE / boleta electrónica | Decisión tomada: la emite el POS tributario |
| Fidelización, puntos, cupones | NexoPOS lo trae; una ferretería de barrio no lo usa |
| Gift cards | OSPOS lo trae; no aplica |
| Ecommerce / catálogo web | Otro producto |
| Multi-sucursal | El schema lo contempla vía `location_id`, pero no se implementa |
| Balanza integrada | NexoPOS tiene `scale_ranges`. Se asume que el peso se digita a mano desde una balanza aparte — es la pregunta 3 abierta de `STATE.md` |

---

## 4. Modelo de datos

> **Superado por `schema.prisma`**, que es la fuente de verdad (28 modelos, validado).
> Este diagrama se mantiene actualizado solo como mapa de lectura.

```
Product ──< ProductBarcode
        ──> Unit (saleUnit / purchaseUnit) >── UnitGroup
        ──< StockMovement          (libro inmutable, en unidad BASE)
        ──< StockLevel             (caché por ubicación)
        ──> Category, Brand, Supplier

Sale ──< SaleItem      (congela descripción + precio + lineCostNet)
     │        └──> SaleItem (reversesSaleItem)  ← devolución línea a línea
     ──< SalePayment   (N medios de pago; efectivo lleva recibido y vuelto)
     ──> Customer, User, CashSession, Location
     ──< Sale (reversedBy / reverses)   ← anulaciones y N devoluciones parciales

SuspendedSale ──< SuspendedSaleItem   ← venta en espera, AISLADA de caja y stock

CashSession ──< CashMovement  (balanceBefore / balanceAfter)
            ──> Station >── Location

Purchase ──< PurchaseItem  → genera StockMovement

PrintJob (cola, con Station y Sale)      WhatsAppJob (cola, estado, intentos)
AuditLog        Alert        Setting        Counter
```

Dos diferencias con el borrador original de este documento, ambas deliberadas:

- **No hay tabla puente `ProductUnit`.** Un producto tiene exactamente una unidad de
  compra y una de venta, como dos claves foráneas. Si el mismo tornillo se vende suelto
  *y* por caja, son dos SKU — la misma lógica de CAT-10, que ya decidió que cada medida
  es un SKU propio. Una tabla puente permitiría N unidades por producto y volvería
  ambigua la conversión del kardex.
- **`Location` y `Station` son tablas desde el día uno**, aunque tengan una fila cada una.

---

## 5. Decisiones abiertas

De las seis preguntas que este documento planteaba, **cinco están cerradas**:

| # | Pregunta original | Resolución |
|---|---|---|
| 1 | ¿Precio con IVA incluido? | **Sí.** Precios brutos, costos netos, IVA por residuo. Sellada en `STATE.md` #1 |
| 2 | ¿Existe bodega separada? | `Location` existe desde el día uno con una fila; la UI la oculta hasta que haya una segunda. INV-08 sigue en v2 |
| 3 | ¿Se vende fiado? | **No aplica.** POS-15 pasa de v2 a descartado |
| 4 | ¿Venden algo por peso? | Sí, pero se pesa en balanza aparte y se digita. Sin integración de balanza |
| 5 | ¿Cuántos vendedores y turnos? | **Sigue abierta.** Define si la caja es por turno o por día, y cuántas estaciones sembrar |
| 6 | Nombre del producto | Ferrehouse Manager |

Queda además la pregunta que este documento no se había hecho y que hoy es la más
importante: **¿los dos puntos de venta futuros son dos cajas en la misma tienda o dos
sucursales?** De eso dependen el motor de base de datos y si el costo promedio debe
pasar a ser por ubicación. Está en `STATE.md`, pregunta 1.

---

## 6. Nota técnica: impresora térmica USB

La impresora es USB, no de red. Implicancias:

- **Hoy:** vive conectada al PC servidor. Los otros dos terminales mandan el trabajo al servidor por HTTP y el servidor imprime. Funciona sin problema.
- **Cómo:** se envían bytes ESC/POS crudos a la impresora compartida de Windows. Nada de imprimir "documentos" con el driver gráfico — eso genera tickets lentos y mal cortados.
- **El cajón:** se abre con la secuencia ESC/POS `ESC p 0 25 250` incrustada en el mismo trabajo del ticket. Imprimir y abrir el cajón es una sola operación atómica.
- **Futuro multi-impresora:** cada caja nueva necesitará un agente local de impresión, porque USB no se comparte por red de forma confiable. **Recomendación: cuando compres la segunda impresora, cómprala con puerto Ethernet.** Ahí es un socket TCP al puerto 9100 y el agente sobra.
- El diseño de `print_jobs` con `stationId` cubre los tres escenarios sin reescribir.
