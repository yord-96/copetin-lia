# Analisis de schema JSON

Archivo: `C:\Users\Milton\Desktop\copetin\data\app-state.json`
Bytes: `4673934`
SHA256: `f0ff8ccb5a37d61c9e3a2feab869175ce692d1ed28847a778203fbdf5a8a5901`
Wrapper con state: `true`
Version: `38`
Generado: `2026-07-03T20:17:36.688Z`

## Resumen de colecciones

| Coleccion | Tipo | Registros | Campos | Duplicados | Huerfanos | Fechas invalidas |
|---|---:|---:|---:|---:|---:|---:|
| attendanceRecords | array | 2 | 19 | 0 | 0 | 0 |
| calendarBoardNotes | array | 0 | 0 | 0 | 0 | 0 |
| calendarEvents | array | 0 | 0 | 0 | 0 | 0 |
| cashDebts | array | 0 | 0 | 0 | 0 | 0 |
| cashMovements | array | 187 | 31 | 0 | 0 | 0 |
| cashSessions | array | 1 | 17 | 0 | 0 | 0 |
| categories | array | 49 | 7 | 0 | 0 | 0 |
| clients | array | 99 | 28 | 0 | 0 | 0 |
| contracts | array | 116 | 84 | 0 | 13 | 0 |
| deliveries | array | 113 | 22 | 0 | 0 | 0 |
| driverLoginLocations | array | 0 | 0 | 0 | 0 | 0 |
| drivers | array | 0 | 0 | 0 | 0 | 0 |
| generatedReports | array | 237 | 12 | 0 | 0 | 0 |
| inventoryCombos | array | 17 | 17 | 0 | 0 | 0 |
| inventoryMovements | array | 394 | 17 | 0 | 0 | 0 |
| items | array | 1872 | 23 | 0 | 0 | 0 |
| personnelAttendance | array | 0 | 0 | 0 | 0 | 0 |
| personnelEmployees | array | 39 | 28 | 0 | 0 | 0 |
| personnelIncidents | array | 0 | 0 | 0 | 0 | 0 |
| quotes | array | 10 | 75 | 0 | 0 | 0 |
| rentals | array | 107 | 124 | 0 | 8 | 0 |
| resetLogs | array | 20 | 55 | 0 | 0 | 0 |
| schemaVersion | number | 0 | 0 | 0 | 0 | 0 |
| settings | object | 1 | 38 | 0 | 0 | 0 |
| stockRecoveries | array | 5 | 13 | 0 | 0 | 0 |
| supplierLoans | array | 0 | 0 | 0 | 0 | 0 |
| supplierQuotes | array | 4 | 15 | 0 | 0 | 0 |
| suppliers | array | 2 | 15 | 0 | 0 | 0 |
| transportRoutes | array | 1 | 12 | 0 | 0 | 0 |
| userPresence | array | 0 | 0 | 0 | 0 | 0 |
| users | array | 11 | 21 | 0 | 0 | 0 |
| vehicles | array | 0 | 0 | 0 | 0 | 0 |

## attendanceRecords

- Registros: 2
- Campos obligatorios: `capturedAt`, `code`, `createdAt`, `id`, `latitude`, `location`, `longitude`, `photoMimeType`, `photoSizeBytes`, `photoUrl`, `reason`, `role`, `type`, `userId`, `userName`
- Campos con dinero: ninguno
- Campos de fecha: `capturedAt`, `createdAt`
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno
- Enums implicitos:
  - `capturedAt`: `2026-06-25T15:33:05.871Z`, `2026-06-26T17:28:42.285Z`
  - `code`: `ASI-00001`, `ASI-00002`
  - `createdAt`: `2026-06-25T15:33:05.871Z`, `2026-06-26T17:28:42.285Z`
  - `id`: `d4c1a1c4-e44b-4951-8eb2-6515c1cc1556`, `e05867b4-b84d-45b0-97e9-3b0a741554b7`
  - `latitude`: `-17.367859`, `-17.377109`
  - `location`: `Calle Batallón Colorados, Sarco Central, Cochabamba`, `Lincoln`
  - `longitude`: `-66.173124`, `-66.178656`
  - `notes`: ``
  - `photoDataUrl`: ``
  - `photoMimeType`: `image/jpeg`
  - `photoSizeBytes`: `2833295`, `2912828`
  - `photoUrl`: `/uploads/attendance/d4c1a1c4-e44b-4951-8eb2-6515c1cc1556-11af6a01776cdc3a45aa.jpg`, `/uploads/attendance/e05867b4-b84d-45b0-97e9-3b0a741554b7-66d2eb4e6b11a1a5b142.jpg`
  - `reason`: `INSTALACIÓN CÁMARA`, `VINE POR EL CONTRATO 1234 ARMADO`
  - `role`: `Developer`
  - `type`: `entrada`
  - `userId`: `fe8b62b8-9873-4aa1-844b-4fe72b701793`, `usr-maria`
  - `userName`: `JHONATAN PEREIRA`, `YORDY COPA CEREZO`

## calendarBoardNotes

- Registros: 0
- Campos obligatorios: ninguno detectado
- Campos con dinero: ninguno
- Campos de fecha: ninguno
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno

## calendarEvents

- Registros: 0
- Campos obligatorios: ninguno detectado
- Campos con dinero: ninguno
- Campos de fecha: ninguno
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno

## cashDebts

- Registros: 0
- Campos obligatorios: ninguno detectado
- Campos con dinero: ninguno
- Campos de fecha: ninguno
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno

## cashMovements

- Registros: 187
- Campos obligatorios: `amountBs`, `cashBoxType`, `createdAt`, `createdBy`, `description`, `id`, `isInternalTransfer`, `responsible`, `sourceType`, `transportExpenseBs`, `transportRevenueBs`, `type`
- Campos con dinero: `amountBs`, `paymentAccount`, `transportExpenseBs`, `transportRevenueBs`
- Campos de fecha: `createdAt`
- Estructuras anidadas: ninguna
- Campos efimeros: `sessionId`
- Conservar en legacyData: ninguno
- Enums implicitos:
  - `accountingTag`: ``, `guarantee_refund`, `transport_revenue`
  - `cashBoxType`: `BIG_CASH`, `PETTY_CASH`
  - `category`: ``, `ALIMENTACION`, `COBRO_CONTRATO`, `COMPRAS`, `GARANTIA`, `GARANTIA_DEVUELTA_MANUAL`, `INGRESO_MANUAL`, `MOVILIDAD`, `REPOSICION_CAJA_CHICA`, `SUELDOS`, `TRANSPORTE_COBRADO`, `VARIOS`
  - `createdBy`: `ARACELY SIERRA`, `CELINA MUÑOZ`, `ESTHER PLATA`, `JHONATAN PEREIRA`, `KARINA CARRASCO`, `LUIS VEGA`, `SHIRLEY CARRASCO`, `SONIA SIVINCHA`, `Sistema`, `TERCEROS ORELLANA CARLA`, `YORDY COPA CEREZO`
  - `isInternalTransfer`: `false`, `true`
  - `paymentAccount`: ``
  - `paymentMethod`: ``, `efectivo`, `qr`
  - `receipt`: ``, `A DUN EDWIN FLORES`, `DEL LUNES 29 DE JUN`, `N. INTERNA`, `NOTA INTERNA`, `SALDO SABADO 27 JUN`
  - `receiptStatus`: ``, `anulado`
  - `replacedByMovementId`: `5a200c95-67e7-4a6b-a10c-3e5ef8086b46`
  - `replacementOfMovementId`: `d55a46d0-953e-410a-a1e5-5d0aca4531de`
  - `responsible`: `ARACELY SIERRA`, `CELINA MUÑOZ`, `ESTHER PLATA`, `JHONATAN PEREIRA`, `KARINA CARRASCO`, `LUIS VEGA`, `SHIRLEY CARRASCO`, `SONIA SIVINCHA`, `Sistema`, `TERCEROS ORELLANA CARLA`, `YORDY COPA CEREZO`
  - `sessionId`: `65c6e0c8-cca2-4cce-a400-ef0875af3bf3`
  - `sourceType`: `client`, `manual`, `rental`, `return`, `transferencia`
  - `transferGroupId`: `30b21165-71d0-49b8-a107-66486fdc1656`, `8fde203c-0ad2-49e1-9974-1882932a3b9b`, `edf53d03-5426-413a-bc32-a8fa03f4efc6`, `f840528c-7a43-4720-804d-9daa0e6d6626`
  - `transportExpenseBs`: `0`
  - `transportRevenueBs`: `0`, `50`, `60`
  - `type`: `aplicacion_saldo_prepago`, `egreso_manual`, `ingreso_alquiler`, `ingreso_garantia`, `ingreso_manual`, `ingreso_prepago_cliente`, `ingreso_transporte_cliente`, `liquidacion_devolucion`, `saldo_alquiler_pendiente`, `saldo_pendiente_cobro`, `transferencia_entrada_caja_chica`, `transferencia_salida_caja_chica`
  - `voidedAt`: `2026-07-01T14:17:13.194Z`
  - `voidedBy`: ``, `ESTHER PLATA`
  - `voidReason`: ``, `DOBLE ANTICIPO MISMO NOMBRE`

## cashSessions

- Registros: 1
- Campos obligatorios: `id`, `openedAt`, `openedBy`, `openingAmountBs`, `openingBigCashBs`, `openingPettyCashBs`, `openNotes`, `status`, `treasuryAccounts`
- Campos con dinero: `countedBigCashBs`, `countedPettyCashBs`, `differenceBigCashBs`, `differencePettyCashBs`, `expectedBigCashBs`, `expectedPettyCashBs`, `openingAmountBs`, `openingBigCashBs`, `openingPettyCashBs`
- Campos de fecha: `treasuryUpdatedAt`
- Estructuras anidadas: `treasuryAccounts`
- Campos efimeros: ninguno
- Conservar en legacyData: `treasuryAccounts`
- Enums implicitos:
  - `id`: `65c6e0c8-cca2-4cce-a400-ef0875af3bf3`
  - `openedAt`: `2026-06-29T20:18:31.773Z`
  - `openedBy`: `ESTHER PLATA`
  - `openingAmountBs`: `0`
  - `openingBigCashBs`: `0`
  - `openingPettyCashBs`: `0`
  - `openNotes`: `Apertura automatica por reposicion a caja chica: Reposicion a caja chica`
  - `status`: `open`
  - `treasuryUpdatedBy`: ``

## categories

- Registros: 49
- Campos obligatorios: `color`, `createdAt`, `icon`, `id`, `name`, `status`, `updatedAt`
- Campos con dinero: ninguno
- Campos de fecha: `createdAt`, `updatedAt`
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno
- Enums implicitos:
  - `color`: `#00F55E`, `#141249`, `#173031`, `#186D67`, `#266D3E`, `#393738`, `#421CAB`, `#5754B0`, `#575C33`, `#5BC0E1`, `#5BDFE1`, `#5BE1D8`, `#5D59E0`, `#688D8C`, `#DF0C56`, `#E15BB0`, `#E15BC4`, `#E15BD6`, `#E1A35B`, `#E1BD5B`, `#E1CB5B`
  - `icon`: `box`, `chair`, `fabric`, `plate`, `star`, `table`
  - `status`: `active`

## clients

- Registros: 99
- Campos obligatorios: `attachments`, `companyName`, `contactName`, `contactRole`, `createdAt`, `customerType`, `deliveryAddresses`, `id`, `isBlacklisted`, `name`, `phone`, `prepaidBalanceBs`, `prepaidEnabled`, `prepaidMovements`, `prepaidTotalDepositedBs`, `prepaidTotalUsedBs`, `status`, `updatedAt`, `whatsapp`
- Campos con dinero: `prepaidBalanceBs`, `prepaidTotalDepositedBs`, `prepaidTotalUsedBs`
- Campos de fecha: `createdAt`, `updatedAt`
- Estructuras anidadas: `attachments`, `deliveryAddresses`, `prepaidMovements`
- Campos efimeros: ninguno
- Conservar en legacyData: `attachments`, `deliveryAddresses`, `prepaidMovements`
- Enums implicitos:
  - `blacklistNotes`: ``
  - `blacklistReason`: ``
  - `city`: ``, `AV LINDE`, `CBBA`, `CERCADO`, `CERCDO`, `COCHABAMBA`, `COCHABAMNA`, `QUILLACOLLO`, `TIQUIPAYA`, `VINTO`
  - `contactRole`: `ADMINISTRADORA`, `CONTACO`, `CONTACTO`, `GERENTE`
  - `customerType`: `persona`
  - `email`: ``, `yordycc76@gmail.com`
  - `isBlacklisted`: `false`
  - `nitCi`: ``, `00000000`, `12345678`, `12810452`, `3606402`, `5159743`, `5227193`, `6423076`, `6479035`, `7777777`, `8013274`, `N/D`, `NA`
  - `observations`: ``, `EXIGENTE`
  - `prepaidBalanceBs`: `0`, `21070.85`
  - `prepaidEnabled`: `false`, `true`
  - `prepaidTotalDepositedBs`: `0`, `22990.85`
  - `prepaidTotalUsedBs`: `0`, `1920`
  - `status`: `active`

## contracts

- Registros: 116
- Campos obligatorios: `address`, `billingMode`, `cancellationPenaltyBs`, `cancellationPenaltyPercent`, `clientId`, `companyName`, `contractCode`, `contractDate`, `createdAt`, `createdBy`, `createdById`, `createdByName`, `createdByRole`, `customerName`, `customerPhone`, `deliveryChargeMode`, `deliveryDate`, `deliveryFeeBs`, `deliveryFeeReason`, `deliveryTimeMode`, `deliveryWindowEnd`, `deliveryWindowStart`, `eventDate`, `eventTime`, `eventType`, `guarantee`, `guarantee.amountBs`, `guarantee.paymentMethod`, `guarantee.status`, `id`, `items`, `logisticsMode`, `payment`, `payment.guaranteePaymentMethod`, `payment.guaranteeStatus`, `payment.initialPaymentMethod`, `payment.overpaidBs`, `payment.paidAtApprovalBs`, `payment.pendingBs`, `payment.prepaidAppliedBs`, `pickupDate`, `pickupTimeMode`, `pickupWindowEnd`, `pickupWindowStart`, `pricingPlan`, `pricingPlan.baseSubtotalBs`, `pricingPlan.chargeableSubtotalBs`, `pricingPlan.days`, `pricingPlan.durationDiscountBs`, `pricingPlan.effectiveMultiplier`, `pricingPlan.mode`, `pricingPlan.theoreticalSubtotalBs`, `pricingPlan.tiers`, `responsibles`, `revisionHistory`, `services`, `status`, `supplierFulfillmentPlan`, `totals`, `totals.baseSubtotalBs`, `totals.deliveryFeeBs`, `totals.discountBs`, `totals.discountPercent`, `totals.durationDiscountBs`, `totals.guaranteeBs`, `totals.subtotalBs`, `totals.theoreticalSubtotalBs`, `totals.totalBs`, `updatedAt`
- Campos con dinero: `cancellationPenaltyBs`, `deliveryFeeBs`, `guarantee`, `guarantee.amountBs`, `payment`, `payment.overpaidBs`, `payment.paidAtApprovalBs`, `payment.pendingBs`, `payment.prepaidAppliedBs`, `pricingPlan.baseSubtotalBs`, `pricingPlan.chargeableSubtotalBs`, `pricingPlan.durationDiscountBs`, `pricingPlan.theoreticalSubtotalBs`, `totals.baseSubtotalBs`, `totals.deliveryFeeBs`, `totals.discountBs`, `totals.discountPercent`, `totals.durationDiscountBs`, `totals.guaranteeBs`, `totals.subtotalBs`, `totals.theoreticalSubtotalBs`, `totals.totalBs`
- Campos de fecha: `cancellationCutoffDate`, `contractDate`, `createdAt`, `deletedAt`, `deliveryDate`, `deliveryWindowEnd`, `deliveryWindowStart`, `eventDate`, `eventTime`, `pickupDate`, `pickupWindowEnd`, `pickupWindowStart`, `updatedAt`, `validUntil`
- Estructuras anidadas: `guarantee`, `items`, `payment`, `pricingPlan`, `pricingPlan.tiers`, `responsibles`, `revisionHistory`, `services`, `supplierFulfillmentPlan`, `totals`
- Campos efimeros: ninguno
- Conservar en legacyData: `guarantee`, `items`, `payment`, `pricingPlan`, `pricingPlan.tiers`, `responsibles`, `revisionHistory`, `services`, `supplierFulfillmentPlan`, `totals`
- Enums implicitos:
  - `billingMode`: `con_factura`, `sin_factura`
  - `cancellationPenaltyBs`: `0`
  - `cancellationPenaltyPercent`: `0`
  - `cancellationReason`: ``
  - `city`: ``, `AV LINDE`, `CERCADO`, `COCHABAMBA`, `COCHABAMNA`, `QUILLACOLLO`, `TIQUIPAYA`, `VINTO`
  - `createdBy`: `ANTEZANA ALBA LUIS GABRIEL`, `ARACELY SIERRA`, `CELINA MUÑOZ`, `ESTHER PLATA`, `JHONATAN PEREIRA`, `KARINA CARRASCO`, `LUIS VEGA`, `SEQUEIROS C. MARISOL`, `SHIRLEY CARRASCO`, `SIVINCHA SOLIZ SONIA`, `SONIA SIVINCHA`, `TERCEROS ORELLANA CARLA`
  - `createdById`: `15394320-f3ff-4f4e-88d4-1974123d286f`, `167e18e5-ea53-4c10-bf40-ec4b01613b38`, `458b69b6-8ed9-44e7-a642-66dd40e5e4dc`, `51cf2f2a-53f8-4690-86b0-062218d99e37`, `539851cf-e5f5-4f0a-b47b-cef2b6c5955f`, `76845e0a-e67c-4ef2-a367-14865b241f19`, `8efc0f4d-0529-4a61-a34b-a8454bdcbf71`, `a35e2196-14b3-43e7-8066-c8345afac5ef`, `a586f4a5-bb54-49f3-8cb0-5c1aa2f245a7`, `af80689d-d136-404a-aa33-bed563142b6c`, `e3e4398c-acf9-45e4-a127-4cfa8ef8d37c`, `fe8b62b8-9873-4aa1-844b-4fe72b701793`
  - `createdByName`: `ANTEZANA ALBA LUIS GABRIEL`, `ARACELY SIERRA`, `CELINA MUÑOZ`, `ESTHER PLATA`, `JHONATAN PEREIRA`, `KARINA CARRASCO`, `LUIS VEGA`, `SEQUEIROS C. MARISOL`, `SHIRLEY CARRASCO`, `SIVINCHA SOLIZ SONIA`, `SONIA SIVINCHA`, `TERCEROS ORELLANA CARLA`
  - `createdByRole`: `Developer`, `LINCOLN`, `OPERACIONES`, `Super admin`
  - `deletedAt`: `2026-06-24T17:31:42.971Z`, `2026-06-24T18:00:43.907Z`, `2026-06-25T17:35:15.852Z`, `2026-06-26T21:49:17.937Z`, `2026-06-27T21:38:30.839Z`, `2026-06-30T20:12:09.527Z`, `2026-06-30T20:12:34.003Z`, `2026-06-30T20:14:06.989Z`, `2026-07-01T18:35:49.660Z`, `2026-07-02T21:22:36.119Z`, `2026-07-03T16:09:14.480Z`, `2026-07-03T16:09:36.872Z`
  - `deliveryChargeMode`: `extra`, `included`
  - `deliveryFeeBs`: `0`, `20`, `200`, `30`, `50`, `60`, `70`
  - `deliveryFeeReason`: `covered`, `distance`, `quantity`
  - `deliveryTimeMode`: `coordinate`, `fixed`
  - `deliveryWindowEnd`: `07:30`, `08:00`, `08:30`, `09:00`, `10:00`, `10:59`, `11:00`, `11:45`, `12:00`, `12:30`, `13:00`, `14:00`, `14:04`, `16:00`, `17:00`, `17:30`, `18:00`, `18:30`, `19:00`, `20:00`, `23:00`
  - `deliveryWindowStart`: `07:00`, `07:30`, `08:00`, `08:30`, `09:00`, `09:30`, `10:00`, `11:00`, `11:45`, `12:00`, `13:00`, `13:30`, `14:00`, `15:30`, `16:00`, `17:00`, `17:45`
  - `eventTime`: `08:00`, `08:30`, `09:00`, `10:00`, `11:00`, `11:45`, `12:00`, `12:45`, `14:00`, `15:00`, `16:00`, `17:00`, `18:00`, `20:00`, `21:00`
  - `eventType`: `15 AÑOS VARON`, `BODA`, `CENA`, `COORPORATIVO`, `COORPORTIVO`, `CUMPELAÑOS INFANTIL`, `FERIA DEL API`, `GASTRONOMIA`, `PARTICULAR`, `PRESENTACION DE TESIS`, `SOCIAL`, `VELORIO`
  - `guarantee.amountBs`: `0`, `100`, `134`, `141`, `144`, `1478`, `150`, `156`, `174`, `197.5`, `200`, `28`, `300`, `40`, `500`, `680.4`, `700`, `94`
  - `guarantee.paymentMethod`: `efectivo`, `qr`
  - `guarantee.status`: `no_validado`, `validado`
  - `logisticsMode`: `envio`, `recojo`
  - `observations`: ``, `CAMIONETA AZUL REALIZA EL RECOJO`, `CONTAR BIEN EL MATERIAL POR FAVOR`, `CONTRATO ABIERTO POR CARLA`, `DEJAR TODO EL MATERIAL EN OPTIMAS CONDICIONES`, `EL CLIENTE  ES EXIGENTE Y PIDE ENTREGA 7:50 PUNTUAL`, `EL CLIENTE YA SE LO LLEVO  LAS 2 BANDEJAS DE CHIFUNDIS`, `EL TOLDO 3X4 IRA CON LUZ`, `EL TOLDO IRÁ CON LUZ , LLEVAR BASES PARA ASEGURAR EL TOLDO`, `ESCALA DE  3 NIVELES
ALTURA (0.5 CM) 4.88X 14,64
ALTURA (0.75 CM ) 1.22X12.20
ALTURA (1 CM) 2.44X12.20`, `FALTA DEFINIR MANTELES`, `FUE EN CAJA DE CARTON`, `LAS MESITAS Y SILLAS FUERON DE DIFERENTES COLORES OJO TOMAR EN CUENTA`, `LLEVAR LOS LOUNGE NUEVOS O LOS QUE SE VEAN MEJOR EL CLIENTE ES EXIGENTE`, `LLEVAR SIEMPRE ACOPLES Y ESTACAS`, `LOS TOLDOS 3X4 DEBERAN SER TAPADOS LOS 4 LADOS CON LOS LATERALES Y SE DEBERAN LLEVAR LUZ`, `MANDAR LAS JARRAS MARCADAS Y SIN LIJADOS`, `PASAR FACTURA 202 POR WHATSAPP`, `POR EL MOMENTO NINGUNA OBSERVACION`, `RECIEN TRAERA SU NUMERO DE CELULAR
CLIENTE DE LA 3RA EDAD, FAVOR TENER PACIENCIA , 
RECOGER LAS MESAS Y SILLAS EL MISMO SABADO A HRS 19:00
CONFIRMAR SIEMPRE CON LA CLIENTE PAGA EL TRANSPORTE DE IDA Y VUELTA BS 50`, `REVISAR QUE LAS SILLAS Y MESAS LIMPIAS, EL CLIENTE ES MUY EXIGENTE
ENVIARA LA UBICACION PARA REALIZAR LA  COTIZACION DEL TRANSPORTE`, `SER PUNTUALES  A LA HORA DE ENTREGA  Y RECOJO,  EL CLIENTE ES  EXIGENTE`, `SI SE UTILIZA LAS ILLAS EN DOMINGO SE INCREMENTA UN 50%`, `SOLO PAGO TRANSPORTE DE ENTREGA, CLIENTE DEVUELVE EL MATERIAL`, `TODOS LOS CALENTADORES DEBEN IR EN COLOR PLATEADO`
  - `payment.guaranteePaymentMethod`: `efectivo`, `qr`
  - `payment.guaranteeStatus`: `no_validado`, `validado`
  - `payment.initialPaymentMethod`: `efectivo`, `qr`
  - `payment.overpaidBs`: `0`, `100`, `150`, `197.5`, `30`, `300`, `94`
  - `payment.prepaidAppliedBs`: `0`, `1920`
  - `pickupTimeMode`: `coordinate`, `fixed`
  - `pickupWindowEnd`: `10:00`, `12:00`, `16:00`, `17:00`, `18:00`, `18:09`, `18:10`, `19:00`, `20:00`, `22:00`, `22:30`
  - `pickupWindowStart`: `08:00`, `08:30`, `09:00`, `09:30`, `10:00`, `12:00`, `13:00`, `15:00`, `19:00`, `20:00`, `22:00`
  - `pricingPlan.days`: `1`, `2`, `3`, `6`
  - `pricingPlan.durationDiscountBs`: `0`, `1545`, `170`, `450`, `675`, `900`, `915`
  - `pricingPlan.effectiveMultiplier`: `1`, `1.5`, `1.75`, `2.25`, `3.5`
  - `pricingPlan.mode`: `duration`, `simple`
  - `quoteId`: `422672be-b23e-4e2e-84e1-96d2baa97d46`, `49f969d0-4302-480d-bacd-0ea4106714ec`, `7dc607bb-ec65-40b7-91c0-23a0df5d3742`, `a2d2e9ee-ae06-41dd-880e-0c00c9874531`, `a7a4c0b2-bad5-4570-bf37-48c515b3c837`, `ec3f2127-4695-4d8a-a19c-03373406507f`
  - `status`: `aprobado`, `pendiente`, `revertido`
  - `totals.deliveryFeeBs`: `0`, `20`, `200`, `30`, `50`, `60`, `70`
  - `totals.discountBs`: `0`, `13.5`, `142`, `15.75`, `162`, `278.5`, `286.77`, `33.6`, `43.5`, `458.7`, `526.58`
  - `totals.discountPercent`: `0`, `10`, `15`
  - `totals.durationDiscountBs`: `0`, `1545`, `170`, `450`, `675`, `900`, `915`
  - `totals.guaranteeBs`: `0`, `100`, `134`, `141`, `144`, `1478`, `150`, `156`, `174`, `197.5`, `200`, `28`, `300`, `40`, `500`, `680.4`, `700`, `94`
- Referencias huerfanas: 13

## deliveries

- Registros: 113
- Campos obligatorios: `address`, `city`, `companyName`, `createdAt`, `customerName`, `deliveryCode`, `id`, `orderCode`, `progress`, `rentalId`, `routeSequence`, `scheduledDate`, `status`, `updatedAt`, `windowEnd`, `windowStart`
- Campos con dinero: ninguno
- Campos de fecha: `createdAt`, `deletedAt`, `scheduledDate`, `updatedAt`, `windowEnd`, `windowStart`
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno
- Enums implicitos:
  - `city`: `AV LINDE`, `CERCADO`, `CIUDAD`, `COCHABAMBA`, `COCHABAMNA`, `QUILLACOLLO`, `TIQUIPAYA`, `VINTO`
  - `progress`: `0`, `100`
  - `routeSequence`: `0`
  - `status`: `completada`, `programada`
  - `windowEnd`: `07:30`, `08:00`, `08:30`, `09:00`, `10:00`, `10:59`, `11:45`, `12:00`, `12:30`, `14:00`, `16:00`, `17:00`, `17:30`, `18:00`, `20:00`, `22:00`, `22:30`, `23:00`
  - `windowStart`: `07:00`, `07:30`, `08:00`, `08:30`, `09:00`, `09:30`, `10:00`, `11:00`, `11:45`, `12:00`, `13:00`, `13:30`, `14:00`, `15:00`, `15:30`, `16:00`, `17:00`, `19:00`, `20:00`, `22:00`

## driverLoginLocations

- Registros: 0
- Campos obligatorios: ninguno detectado
- Campos con dinero: ninguno
- Campos de fecha: ninguno
- Estructuras anidadas: ninguna
- Campos efimeros: `__collection__`
- Conservar en legacyData: ninguno

## drivers

- Registros: 0
- Campos obligatorios: ninguno detectado
- Campos con dinero: ninguno
- Campos de fecha: ninguno
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno

## generatedReports

- Registros: 237
- Campos obligatorios: `category`, `format`, `generatedAt`, `generatedBy`, `id`, `name`
- Campos con dinero: ninguno
- Campos de fecha: `deletedAt`, `updatedAt`
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno
- Enums implicitos:
  - `category`: `DOCUMENTOS`, `INVENTARIO`, `ORDENES`, `TRANSPORTE`, `VENTAS`
  - `format`: `PDF`
  - `generatedBy`: `Sistema Copetin`, `Yordy Copa Cerezo`
  - `sourceType`: `contrato`, `hoja_ruta`, `orden_inventario`

## inventoryCombos

- Registros: 17
- Campos obligatorios: `category`, `createdAt`, `id`, `ingredients`, `name`, `pricingCondition`, `pricingCondition.aboveUnitPriceBs`, `pricingCondition.enabled`, `pricingCondition.upToQuantity`, `pricingCondition.upToUnitPriceBs`, `rentalPriceBs`, `status`, `updatedAt`
- Campos con dinero: `pricingCondition.aboveUnitPriceBs`, `pricingCondition.upToUnitPriceBs`, `rentalPriceBs`
- Campos de fecha: `createdAt`, `deletedAt`, `updatedAt`
- Estructuras anidadas: `ingredients`, `pricingCondition`
- Campos efimeros: ninguno
- Conservar en legacyData: `ingredients`, `pricingCondition`
- Enums implicitos:
  - `category`: `COMBOS`
  - `deletedAt`: `2026-06-24T20:55:01.508Z`
  - `imageUrl`: `/uploads/products/combo-0203b272-a2bc-4da1-9745-c6bf9dbeec54-4ef405cafec757681ce3.jpg`, `/uploads/products/combo-0440a563-6911-467a-acf3-c938b36aebd9-c2e46b101b0758feeacd.png`, `/uploads/products/combo-0e9ec5e0-6eb6-404b-8efb-987f872c71a5-e461ff2ba45f88e542e1.png`, `/uploads/products/combo-321611a5-9d80-4edd-a680-bc08066906cf-7ce7255cda3b2976c719.jpg`, `/uploads/products/combo-3f9a7f60-415a-4bc6-b81c-e4e4d8c05bf7-7720d86d6b46dda12d80.jpg`, `/uploads/products/combo-45c6550d-978b-480e-b72a-9b8f1aa5f4d7-b5adc654d198328a7804.png`, `/uploads/products/combo-680809cc-4a6b-41ba-991b-e9998c7ad558-53a6d98c3ac4869f64c2.jpg`, `/uploads/products/combo-8124174e-58c9-4c23-aa60-fb5c59ae5ffb-3e7cb482c7972ba4f3ea.jpg`, `/uploads/products/combo-JUEGO-AMBAR-DORADO-5-PIEZAS-d8b71a082b92c250cc17.jpg`, `/uploads/products/combo-JUEGO-BASES-DE-TORTA-CON-VIDRIO-GIRASOL-3-PIEZAS-bc5e4beacc8ae5cc9b6f.jpg`, `/uploads/products/combo-JUEGO-DE-BASES-DE-TORTA-CRISTALES-REDONDO-DORADO-3-PIE-4ff6fcd229ae9c12b09f.png`, `/uploads/products/combo-b4104525-a03e-4a76-8298-1944f3aee098-0f3563c34ee347a2b93c.png`
  - `notes`: ``
  - `pricingCondition.aboveUnitPriceBs`: `0`
  - `pricingCondition.enabled`: `false`
  - `pricingCondition.upToQuantity`: `3`
  - `pricingCondition.upToUnitPriceBs`: `0`
  - `rentalPriceBs`: `0`, `100`, `12`, `130`, `170`, `230`, `320`, `50`, `55`, `880`, `90`, `95`
  - `status`: `active`, `deleted`

## inventoryMovements

- Registros: 394
- Campos obligatorios: `afterAvailableStock`, `afterTotalStock`, `beforeAvailableStock`, `beforeTotalStock`, `category`, `createdAt`, `deltaUnits`, `detail`, `id`, `itemId`, `itemName`, `reason`, `reservedStockAfter`, `type`, `userName`, `userRole`
- Campos con dinero: `afterTotalStock`, `beforeTotalStock`
- Campos de fecha: `createdAt`
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno
- Enums implicitos:
  - `type`: `ajuste`, `entrada`, `reinsercion`, `reserva`, `salida`
  - `userName`: `ARACELY SIERRA`, `Aracely Sierra`, `CELINA MUÑOZ`, `ESTHER PLATA`, `JHONATAN PEREIRA`, `KARINA CARRASCO`, `LUIS VEGA`, `Luis Vega`, `SONIA SIVINCHA`, `YORDY COPA CEREZO`, `esther plata`
  - `userRole`: `Developer`, `Super admin`

## items

- Registros: 1872
- Campos obligatorios: `availableStock`, `category`, `controlsStock`, `createdAt`, `damagedUnitChargeBs`, `id`, `missingUnitChargeBs`, `name`, `needsCleaningOnReturn`, `rentalPriceBs`, `totalStock`, `verificationStatus`
- Campos con dinero: `damagedUnitChargeBs`, `missingUnitChargeBs`, `rentalPriceBs`, `totalStock`
- Campos de fecha: `createdAt`, `deletedAt`, `imageMigratedAt`, `updatedAt`
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno
- Enums implicitos:
  - `adoptionSource`: ``, `inventory_verified`, `manual_inventory_pending`, `service_order_quick_item`
  - `controlsStock`: `false`, `true`
  - `damagedUnitChargeBs`: `0`, `1.2`, `1.8`, `12`, `18`, `2.4`, `30`, `6`
  - `deletedAt`: `2026-06-24T20:30:45.946Z`, `2026-06-24T21:24:25.742Z`, `2026-06-24T21:59:31.881Z`, `2026-06-24T22:00:01.212Z`, `2026-06-25T18:48:47.208Z`, `2026-06-25T18:49:48.751Z`, `2026-06-25T19:30:01.004Z`, `2026-06-26T13:17:33.788Z`, `2026-06-29T20:07:33.805Z`, `2026-07-02T16:28:33.404Z`, `2026-07-02T18:31:16.525Z`, `2026-07-03T18:41:24.511Z`
  - `inventoryArea`: ``, `vajilla`
  - `missingUnitChargeBs`: `0`, `10`, `2`, `20`, `3`, `30`, `4`, `50`
  - `needsCleaningOnReturn`: `false`, `true`
  - `verificationStatus`: `pending_verification`, `verified`

## personnelAttendance

- Registros: 0
- Campos obligatorios: ninguno detectado
- Campos con dinero: ninguno
- Campos de fecha: ninguno
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno

## personnelEmployees

- Registros: 39
- Campos obligatorios: `contractType`, `createdAt`, `department`, `employeeCode`, `fullName`, `id`, `salaryBs`, `schedule`, `schedule.dailyHours`, `schedule.end`, `schedule.start`, `schedule.workingDays`, `status`, `updatedAt`
- Campos con dinero: `salaryBs`
- Campos de fecha: `createdAt`, `deletedAt`, `hireDate`, `schedule.end`, `schedule.start`, `updatedAt`
- Estructuras anidadas: `schedule`, `schedule.workingDays`
- Campos efimeros: ninguno
- Conservar en legacyData: `schedule`, `schedule.workingDays`
- Enums implicitos:
  - `city`: ``, `COCHABAMBA`
  - `contractType`: `indefinido`
  - `department`: `ENCARGADA`, `OPERACIONES`
  - `email`: ``
  - `emergencyContact`: ``
  - `emergencyPhone`: ``
  - `notes`: ``
  - `photoUrl`: ``
  - `position`: ``, `CONDUCTOR`, `LINCOLN`
  - `salaryBs`: `0`
  - `schedule.dailyHours`: `8`
  - `schedule.end`: `17:00`
  - `schedule.start`: `08:00`
  - `status`: `active`

## personnelIncidents

- Registros: 0
- Campos obligatorios: ninguno detectado
- Campos con dinero: ninguno
- Campos de fecha: ninguno
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno

## quotes

- Registros: 10
- Campos obligatorios: `address`, `billingMode`, `city`, `clientId`, `companyName`, `createdAt`, `createdBy`, `createdById`, `createdByName`, `createdByRole`, `customerName`, `customerPhone`, `deliveryChargeMode`, `deliveryDate`, `deliveryFeeBs`, `deliveryFeeReason`, `deliveryTimeMode`, `deliveryWindowEnd`, `deliveryWindowStart`, `eventDate`, `eventTime`, `eventType`, `guarantee`, `guarantee.amountBs`, `guarantee.paymentMethod`, `guarantee.status`, `id`, `items`, `logisticsMode`, `payment`, `payment.guaranteePaymentMethod`, `payment.guaranteeStatus`, `payment.initialPaymentMethod`, `payment.overpaidBs`, `payment.paidAtApprovalBs`, `payment.pendingBs`, `pickupDate`, `pickupTimeMode`, `pickupWindowEnd`, `pickupWindowStart`, `pricingPlan`, `pricingPlan.baseSubtotalBs`, `pricingPlan.chargeableSubtotalBs`, `pricingPlan.days`, `pricingPlan.durationDiscountBs`, `pricingPlan.effectiveMultiplier`, `pricingPlan.mode`, `pricingPlan.theoreticalSubtotalBs`, `pricingPlan.tiers`, `quoteCode`, `responsibles`, `services`, `status`, `supplierFulfillmentPlan`, `totals`, `totals.baseSubtotalBs`, `totals.deliveryFeeBs`, `totals.discountBs`, `totals.discountPercent`, `totals.durationDiscountBs`, `totals.guaranteeBs`, `totals.subtotalBs`, `totals.theoreticalSubtotalBs`, `totals.totalBs`, `updatedAt`, `validUntil`
- Campos con dinero: `deliveryFeeBs`, `guarantee`, `guarantee.amountBs`, `payment`, `payment.overpaidBs`, `payment.paidAtApprovalBs`, `payment.pendingBs`, `pricingPlan.baseSubtotalBs`, `pricingPlan.chargeableSubtotalBs`, `pricingPlan.durationDiscountBs`, `pricingPlan.theoreticalSubtotalBs`, `totals.baseSubtotalBs`, `totals.deliveryFeeBs`, `totals.discountBs`, `totals.discountPercent`, `totals.durationDiscountBs`, `totals.guaranteeBs`, `totals.subtotalBs`, `totals.theoreticalSubtotalBs`, `totals.totalBs`
- Campos de fecha: `createdAt`, `deletedAt`, `deliveryDate`, `deliveryWindowEnd`, `deliveryWindowStart`, `eventDate`, `eventTime`, `pickupDate`, `pickupWindowEnd`, `pickupWindowStart`, `updatedAt`, `validUntil`
- Estructuras anidadas: `guarantee`, `items`, `payment`, `pricingPlan`, `pricingPlan.tiers`, `responsibles`, `services`, `supplierFulfillmentPlan`, `totals`
- Campos efimeros: ninguno
- Conservar en legacyData: `guarantee`, `items`, `payment`, `pricingPlan`, `pricingPlan.tiers`, `responsibles`, `services`, `supplierFulfillmentPlan`, `totals`
- Enums implicitos:
  - `address`: `A CONFIRMAR`, `AV. GUALBERTO VILLAROEL Y BENI 214`, `AVENIDA 6 DE AGOSTO FRENTE AL PAQUE KANATA, SOBRE LA AVENIDA MARTIRES DE LA DEMOCRACIA, EDIFICIO BLANCO`, `CALLE - LA PAZ`, `CLIENTE CONFIRMARA LA UBICACIÓN`, `PATACA BAJA ( DOS CUADRAS ANTES DEL PARQUE DE LAS MEMORIAS)`, `RECOGERA EL CLIENTE`, `SALON DEL KM 8 DE SACABA`, `TADEO HAENKE AV. SEXTA`
  - `approvedAt`: `2026-06-30T21:11:09.386Z`, `2026-07-01T18:32:58.626Z`, `2026-07-01T19:38:29.967Z`, `2026-07-03T19:32:15.419Z`
  - `billingMode`: `sin_factura`
  - `city`: `CERCADO`, `CERCDO`
  - `clientId`: `04ee959e-3a24-46df-8e48-deb9f49e48f6`, `2108746e-eda3-4e49-bb0b-31e9e366f808`, `4e688a7d-5679-4547-89dd-c039d4b6ee02`, `628c1391-f0d3-433a-8511-909d308c8d3b`, `a7255aba-2a3e-4fcd-bd0b-5085ae5d03cd`, `af45987c-3a0f-45d0-b877-c0505e2ad120`, `b2888e03-543c-4a79-a698-f047cba51316`, `d5d7fce5-d051-4d00-83fe-01b05f97416e`, `d8f77158-e50f-4124-8376-521aa7fa470a`
  - `companyName`: `ALIANZA FRANCESA`, `ANA MARIA MARAÑON`, `BODA`, `COTIZACION INFANTIL`, `MEGALABS`, `NAHUEL MATIAS HUANACO`, `PAMELA JORDAN`, `PARTICULAR`, `VIVIANA`
  - `createdAt`: `2026-06-30T16:54:17.829Z`, `2026-06-30T19:16:05.419Z`, `2026-06-30T19:19:01.484Z`, `2026-06-30T23:17:21.078Z`, `2026-07-02T23:17:47.943Z`, `2026-07-03T00:00:50.213Z`, `2026-07-03T15:39:00.802Z`, `2026-07-03T15:52:00.839Z`, `2026-07-03T17:28:43.574Z`, `2026-07-03T18:32:41.622Z`
  - `createdBy`: `ESTHER PLATA`, `KARINA CARRASCO`, `SONIA SIVINCHA`
  - `createdById`: `15394320-f3ff-4f4e-88d4-1974123d286f`, `af80689d-d136-404a-aa33-bed563142b6c`, `e3e4398c-acf9-45e4-a127-4cfa8ef8d37c`
  - `createdByName`: `ESTHER PLATA`, `KARINA CARRASCO`, `SONIA SIVINCHA`
  - `createdByRole`: `Super admin`
  - `customerName`: `ALIANZA FRANCESA`, `ANA MARIA MARAÑON`, `COTIZACION INFANTIL`, `FABIANA SAMBRANA`, `IVANA CANEDO`, `MARIA RENE  MORALES`, `NAHUEL MATIAS HUANACO`, `PAMELA JORDAN`, `VIVIANA`
  - `customerPhone`: `+591 72281164`, `60737085`, `62745153`, `69605017`, `71443339`, `75332849`, `75961333`, `76431258`, `78333434`
  - `customerReferencePhone`: ``, `75237050`
  - `deliveryChargeMode`: `extra`, `included`
  - `deliveryDate`: `2026-07-01`, `2026-07-02`, `2026-07-03`, `2026-07-04`, `2026-07-07`, `2026-07-17`, `2026-07-31`, `2026-08-06`, `2026-08-11`
  - `deliveryFeeBs`: `0`, `50`
  - `deliveryFeeReason`: `covered`, `quantity`
  - `deliveryTimeMode`: `coordinate`, `fixed`
  - `deliveryWindowEnd`: `09:00`, `10:00`, `18:00`, `18:30`
  - `deliveryWindowStart`: `08:00`, `17:45`
  - `eventDate`: `2026-07-02`, `2026-07-03`, `2026-07-04`, `2026-07-08`, `2026-07-18`, `2026-08-01`, `2026-08-07`, `2026-08-12`
  - `eventTime`: `08:00`, `09:00`, `10:00`, `12:00`, `14:00`, `20:00`
  - `eventType`: `BODA`, `BODA CIVIL`, `COORPORTIVO`, `EVENTO INFANTIL`, `PARTICULAR`, `SOCIAL`
  - `guarantee.amountBs`: `0`, `150`, `200`, `300`
  - `guarantee.paymentMethod`: `efectivo`
  - `guarantee.status`: `no_validado`, `validado`
  - `id`: `15dd46e8-44ad-4bd7-815b-531c524953c4`, `422672be-b23e-4e2e-84e1-96d2baa97d46`, `49f969d0-4302-480d-bacd-0ea4106714ec`, `7dc607bb-ec65-40b7-91c0-23a0df5d3742`, `7f1f2e18-a2f7-4c23-a30a-908dddbba8c1`, `9306f4eb-7ebb-4281-960c-52dffc077360`, `a2d2e9ee-ae06-41dd-880e-0c00c9874531`, `a7a4c0b2-bad5-4570-bf37-48c515b3c837`, `b4743e91-9a26-44c5-9b7a-a05628a2c9e7`, `ec3f2127-4695-4d8a-a19c-03373406507f`
  - `logisticsMode`: `envio`, `recojo`
  - `observations`: ``, `SI SE UTILIZA LAS ILLAS EN DOMINGO SE INCREMENTA UN 50%`, `TRANSPORTE IDA Y VUELTA`
  - `orderCode`: `OS-00069`, `OS-00078`
  - `payment.guaranteePaymentMethod`: `efectivo`
  - `payment.guaranteeStatus`: `no_validado`, `validado`
  - `payment.initialPaymentMethod`: `efectivo`
  - `payment.overpaidBs`: `0`
  - `payment.paidAtApprovalBs`: `0`
  - `payment.pendingBs`: `1440`, `1575`, `1715`, `1980`, `2025`, `2700`, `410`, `464`, `680`, `80`
  - `pickupDate`: `2026-07-03`, `2026-07-04`, `2026-07-06`, `2026-07-09`, `2026-07-19`, `2026-08-03`, `2026-08-10`, `2026-08-13`
  - `pickupTimeMode`: `coordinate`, `fixed`
  - `pickupWindowEnd`: `10:00`, `18:00`, `22:00`
  - `pickupWindowStart`: `08:00`, `20:00`
  - `pricingPlan.baseSubtotalBs`: `1440`, `1715`, `1800`, `1980`, `30`, `410`, `464`, `680`, `900`
  - `pricingPlan.chargeableSubtotalBs`: `1440`, `1575`, `1715`, `1980`, `2025`, `2700`, `30`, `410`, `464`, `680`
  - `pricingPlan.days`: `1`, `2`, `3`
  - `pricingPlan.durationDiscountBs`: `0`, `225`, `675`, `900`
  - `pricingPlan.effectiveMultiplier`: `1`, `1.5`, `1.75`, `2.25`
  - `pricingPlan.mode`: `duration`, `simple`
  - `pricingPlan.theoreticalSubtotalBs`: `1440`, `1715`, `1800`, `1980`, `2700`, `30`, `3600`, `410`, `464`, `680`
  - `quoteCode`: `COT-00001`, `COT-00002`, `COT-00003`, `COT-00004`, `COT-00005`, `COT-00006`, `COT-00007`, `COT-00008`, `COT-00009`, `COT-00010`
  - `rentalId`: `9daf7028-5d35-4f5f-8892-4da4c6ab945f`, `df885ef2-6cae-4cf6-9ea7-c0fc98619e93`
  - `status`: `aprobada`, `borrador`
  - `totals.baseSubtotalBs`: `1440`, `1715`, `1800`, `1980`, `30`, `410`, `464`, `680`, `900`
  - `totals.deliveryFeeBs`: `0`, `50`
  - `totals.discountBs`: `0`
  - `totals.discountPercent`: `0`
  - `totals.durationDiscountBs`: `0`, `225`, `675`, `900`
  - `totals.guaranteeBs`: `0`, `150`, `200`, `300`
  - `totals.subtotalBs`: `1440`, `1575`, `1715`, `1980`, `2025`, `2700`, `30`, `410`, `464`, `680`
  - `totals.theoreticalSubtotalBs`: `1440`, `1715`, `1800`, `1980`, `2700`, `30`, `3600`, `410`, `464`, `680`
  - `totals.totalBs`: `1440`, `1575`, `1715`, `1980`, `2025`, `2700`, `410`, `464`, `680`, `80`
  - `updatedAt`: `2026-06-30T21:11:11.111Z`, `2026-06-30T23:17:21.078Z`, `2026-07-01T18:32:59.576Z`, `2026-07-01T19:38:31.088Z`, `2026-07-02T23:21:29.188Z`, `2026-07-03T00:00:50.213Z`, `2026-07-03T16:09:14.480Z`, `2026-07-03T16:09:36.872Z`, `2026-07-03T17:28:43.574Z`, `2026-07-03T19:32:16.102Z`
  - `validUntil`: `2026-07-02`, `2026-07-03`, `2026-07-04`, `2026-07-05`, `2026-07-08`, `2026-07-18`, `2026-08-03`, `2026-08-07`, `2026-08-30`

## rentals

- Registros: 107
- Campos obligatorios: `billingMode`, `cancellationPenaltyBs`, `cancellationPenaltyPercent`, `clientId`, `contractCode`, `contractId`, `createdAt`, `createdById`, `createdByName`, `createdByRole`, `customerName`, `customerPhone`, `deliveryChargeMode`, `deliveryFeeBs`, `deliveryFeeReason`, `deliveryWindowEnd`, `deliveryWindowStart`, `depositBs`, `dueAt`, `dueDate`, `dueTime`, `guarantee`, `guarantee.amountBs`, `guarantee.paymentMethod`, `guarantee.status`, `guarantee.validatedBs`, `guaranteeDeclaredBs`, `id`, `idCardHeld`, `inventoryAvailabilityAssumptions`, `items`, `logisticsMode`, `operational`, `operational.inventoryStatus`, `operational.transportStatus`, `orderCode`, `payment`, `payment.cashCollectedBs`, `payment.deliveryFeeCollectedBs`, `payment.guaranteePaymentMethod`, `payment.guaranteeStatus`, `payment.initialPaymentMethod`, `payment.mode`, `payment.overpaidBs`, `payment.paidAtRentalBs`, `payment.pendingPaymentBs`, `payment.prepaidAppliedBs`, `payment.rentalCollectedBs`, `payment.status`, `pickupWindowEnd`, `pickupWindowStart`, `prepaidAppliedBs`, `pricingPlan`, `pricingPlan.baseSubtotalBs`, `pricingPlan.chargeableSubtotalBs`, `pricingPlan.days`, `pricingPlan.durationDiscountBs`, `pricingPlan.effectiveMultiplier`, `pricingPlan.mode`, `pricingPlan.theoreticalSubtotalBs`, `pricingPlan.tiers`, `rentalAt`, `rentalDate`, `services`, `status`, `supplierFulfillmentPlan`, `totals`, `totals.baseSubtotalBs`, `totals.deliveryFeeBs`, `totals.deliveryFeeCollectedBs`, `totals.discountBs`, `totals.durationDiscountBs`, `totals.itemsSubtotalBs`, `totals.overpaidBs`, `totals.paidAtRentalBs`, `totals.pendingPaymentBs`, `totals.prepaidAppliedBs`, `totals.subtotalBs`, `totals.theoreticalSubtotalBs`, `totals.totalBs`
- Campos con dinero: `cancellationPenaltyBs`, `deliveryFeeBs`, `depositBs`, `guarantee`, `guarantee.amountBs`, `guarantee.validatedBs`, `guaranteeDeclaredBs`, `internalPenaltiesBs`, `payment`, `payment.cashCollectedBs`, `payment.deliveryFeeCollectedBs`, `payment.overpaidBs`, `payment.paidAtRentalBs`, `payment.pendingPaymentBs`, `payment.prepaidAppliedBs`, `payment.rentalCollectedBs`, `penaltiesBs`, `prepaidAppliedBs`, `pricingPlan.baseSubtotalBs`, `pricingPlan.chargeableSubtotalBs`, `pricingPlan.durationDiscountBs`, `pricingPlan.theoreticalSubtotalBs`, `refundBs`, `returnSettlement.discountCoveredByDepositBs`, `returnSettlement.internalPenaltiesBs`, `returnSettlement.outstandingRentalBs`, `returnSettlement.penaltiesBs`, `returnSettlement.pendingCollectionBs`, `returnSettlement.refundBs`, `returnSettlement.totalDiscountAgainstDepositBs`, `totals.baseSubtotalBs`, `totals.deliveryFeeBs`, `totals.deliveryFeeCollectedBs`, `totals.discountBs`, `totals.discountPercent`, `totals.durationDiscountBs`, `totals.guaranteeBs`, `totals.itemsSubtotalBs`, `totals.overpaidBs`, `totals.paidAtRentalBs`, `totals.pendingPaymentBs`, `totals.prepaidAppliedBs`, `totals.servicesSubtotalBs`, `totals.subtotalBs`, `totals.theoreticalSubtotalBs`, `totals.totalBs`
- Campos de fecha: `cancellationCutoffDate`, `contractDate`, `createdAt`, `deletedAt`, `deliveryWindowEnd`, `deliveryWindowStart`, `dueDate`, `dueTime`, `pickupWindowEnd`, `pickupWindowStart`, `rentalDate`, `updatedAt`
- Estructuras anidadas: `guarantee`, `inventoryAvailabilityAssumptions`, `items`, `operational`, `payment`, `pricingPlan`, `pricingPlan.tiers`, `returnReport`, `returnSettlement`, `services`, `supplierFulfillmentPlan`, `totals`
- Campos efimeros: ninguno
- Conservar en legacyData: `guarantee`, `inventoryAvailabilityAssumptions`, `items`, `operational`, `payment`, `pricingPlan`, `pricingPlan.tiers`, `returnReport`, `returnSettlement`, `services`, `supplierFulfillmentPlan`, `totals`
- Enums implicitos:
  - `billingMode`: `con_factura`, `sin_factura`
  - `cancellationPenaltyBs`: `0`
  - `cancellationPenaltyPercent`: `0`
  - `cancellationReason`: ``
  - `createdById`: `15394320-f3ff-4f4e-88d4-1974123d286f`, `167e18e5-ea53-4c10-bf40-ec4b01613b38`, `458b69b6-8ed9-44e7-a642-66dd40e5e4dc`, `51cf2f2a-53f8-4690-86b0-062218d99e37`, `539851cf-e5f5-4f0a-b47b-cef2b6c5955f`, `8efc0f4d-0529-4a61-a34b-a8454bdcbf71`, `a586f4a5-bb54-49f3-8cb0-5c1aa2f245a7`, `af80689d-d136-404a-aa33-bed563142b6c`, `e3e4398c-acf9-45e4-a127-4cfa8ef8d37c`, `fe8b62b8-9873-4aa1-844b-4fe72b701793`, `usr-maria`
  - `createdByName`: `ARACELY SIERRA`, `CELINA MUÑOZ`, `ESTHER PLATA`, `JHONATAN PEREIRA`, `KARINA CARRASCO`, `LUIS VEGA`, `SEQUEIROS C. MARISOL`, `SHIRLEY CARRASCO`, `SONIA SIVINCHA`, `TERCEROS ORELLANA CARLA`, `YORDY COPA CEREZO`
  - `createdByRole`: `Developer`, `LINCOLN`, `OPERACIONES`, `Super admin`
  - `deliveryChargeMode`: `extra`, `included`
  - `deliveryFeeBs`: `0`, `20`, `200`, `30`, `50`, `60`, `70`
  - `deliveryFeeReason`: `covered`, `distance`, `quantity`
  - `deliveryTimeMode`: `coordinate`, `fixed`
  - `deliveryWindowEnd`: `07:30`, `08:00`, `08:30`, `09:00`, `10:00`, `10:59`, `11:00`, `11:45`, `12:00`, `12:30`, `13:00`, `14:00`, `14:04`, `16:00`, `17:00`, `17:30`, `18:00`, `19:00`, `20:00`, `23:00`
  - `deliveryWindowStart`: `07:00`, `07:30`, `08:00`, `08:30`, `09:00`, `09:30`, `10:00`, `11:00`, `11:45`, `12:00`, `13:00`, `13:30`, `14:00`, `15:30`, `16:00`, `17:00`
  - `depositBs`: `0`, `100`, `134`, `141`, `144`, `1478`, `150`, `156`, `200`, `28`, `300`, `500`, `680.4`, `700`
  - `dueTime`: `10:00`, `12:00`, `16:00`, `17:00`, `18:00`, `18:09`, `19:00`, `20:00`, `22:00`, `22:30`
  - `eventType`: `15 AÑOS VARON`, `BODA`, `CENA`, `CUMPELAÑOS INFANTIL`, `GASTRONOMIA`, `PARTICULAR`, `PRESENTACION DE TESIS`, `SOCIAL`, `VELORIO`
  - `guarantee.amountBs`: `0`, `100`, `134`, `141`, `144`, `1478`, `150`, `156`, `174`, `197.5`, `200`, `28`, `300`, `40`, `500`, `680.4`, `700`
  - `guarantee.paymentMethod`: `efectivo`, `qr`
  - `guarantee.status`: `no_validado`, `validado`
  - `guarantee.validatedBs`: `0`, `100`, `134`, `141`, `144`, `1478`, `150`, `156`, `200`, `28`, `300`, `500`, `680.4`, `700`
  - `guaranteeDeclaredBs`: `0`, `100`, `134`, `141`, `144`, `1478`, `150`, `156`, `174`, `197.5`, `200`, `28`, `300`, `40`, `500`, `680.4`, `700`
  - `idCardHeld`: `false`
  - `internalPenaltiesBs`: `0`
  - `logisticsMode`: `envio`, `recojo`
  - `notes`: ``, `CAMIONETA AZUL REALIZA EL RECOJO`, `CONTAR BIEN EL MATERIAL POR FAVOR`, `CONTRATO ABIERTO POR CARLA`, `DEJAR TODO EL MATERIAL EN OPTIMAS CONDICIONES`, `EL CLIENTE  ES EXIGENTE Y PIDE ENTREGA 7:50 PUNTUAL`, `EL CLIENTE YA SE LO LLEVO  LAS 2 BANDEJAS DE CHIFUNDIS`, `EL TOLDO 3X4 IRA CON LUZ`, `EL TOLDO IRÁ CON LUZ , LLEVAR BASES PARA ASEGURAR EL TOLDO`, `ESCALA DE  3 NIVELES
ALTURA (0.5 CM) 4.88X 14,64
ALTURA (0.75 CM ) 1.22X12.20
ALTURA (1 CM) 2.44X12.20`, `FALTA DEFINIR MANTELES`, `FUE EN CAJA DE CARTON`, `LAS MESITAS Y SILLAS FUERON DE DIFERENTES COLORES OJO TOMAR EN CUENTA`, `LLEVAR LOS LOUNGE NUEVOS O LOS QUE SE VEAN MEJOR EL CLIENTE ES EXIGENTE`, `LLEVAR SIEMPRE ACOPLES Y ESTACAS`, `LOS TOLDOS 3X4 DEBERAN SER TAPADOS LOS 4 LADOS CON LOS LATERALES Y SE DEBERAN LLEVAR LUZ`, `MANDAR LAS JARRAS MARCADAS Y SIN LIJADOS`, `PASAR FACTURA 202 POR WHATSAPP`, `POR EL MOMENTO NINGUNA OBSERVACION`, `RECIEN TRAERA SU NUMERO DE CELULAR
CLIENTE DE LA 3RA EDAD, FAVOR TENER PACIENCIA , 
RECOGER LAS MESAS Y SILLAS EL MISMO SABADO A HRS 19:00
CONFIRMAR SIEMPRE CON LA CLIENTE PAGA EL TRANSPORTE DE IDA Y VUELTA BS 50`, `REVISAR QUE LAS SILLAS Y MESAS LIMPIAS, EL CLIENTE ES MUY EXIGENTE
ENVIARA LA UBICACION PARA REALIZAR LA  COTIZACION DEL TRANSPORTE`, `SER PUNTUALES  A LA HORA DE ENTREGA  Y RECOJO,  EL CLIENTE ES  EXIGENTE`, `SOLO PAGO TRANSPORTE DE ENTREGA, CLIENTE DEVUELVE EL MATERIAL`, `TODOS LOS CALENTADORES DEBEN IR EN COLOR PLATEADO`
  - `operational.inventoryConfirmedByName`: `ARACELY SIERRA`, `CELINA MUÑOZ`, `ESTHER PLATA`, `JHONATAN PEREIRA`, `KARINA CARRASCO`, `LUIS VEGA`, `YORDY COPA CEREZO`
  - `operational.inventoryConfirmedByRole`: `Developer`, `Super admin`
  - `operational.inventoryDispatchedByName`: `ARACELY SIERRA`, `ESTHER PLATA`, `JHONATAN PEREIRA`, `KARINA CARRASCO`, `LUIS VEGA`, `YORDY COPA CEREZO`
  - `operational.inventoryDispatchedByRole`: `Developer`, `Super admin`
  - `operational.inventoryNote`: ``
  - `operational.inventoryReturnedByName`: `ARACELY SIERRA`, `ESTHER PLATA`, `JHONATAN PEREIRA`, `KARINA CARRASCO`, `LUIS VEGA`, `YORDY COPA CEREZO`
  - `operational.inventoryReturnedByRole`: `Developer`, `Super admin`
  - `operational.inventoryStatus`: `confirmado`, `devuelto`, `pendiente`, `salio`
  - `operational.transportNote`: ``
  - `operational.transportStatus`: `no_aplica`, `pendiente`
  - `payment.cashCollectedBs`: `0`, `100`, `107`, `150`, `1800`, `190`, `196`, `200`, `2000`, `222`, `230`, `25`, `255`, `266`, `2696`, `315`, `380`, `400`, `423.5`, `480.5`, `800`
  - `payment.deliveryFeeCollectedBs`: `0`, `30`, `50`, `60`, `70`
  - `payment.guaranteePaymentMethod`: `efectivo`, `qr`
  - `payment.guaranteeStatus`: `no_validado`, `validado`
  - `payment.initialPaymentMethod`: `efectivo`, `qr`
  - `payment.mode`: `a_cuenta`, `cancelado`, `sin_pago`
  - `payment.overpaidBs`: `0`, `100`, `150`, `174`, `197.5`, `30`, `300`
  - `payment.paidAtRentalBs`: `0`, `100`, `107`, `150`, `1800`, `190`, `1920`, `196`, `200`, `2000`, `222`, `230`, `25`, `255`, `266`, `2696`, `315`, `380`, `400`, `423.5`, `480.5`, `800`
  - `payment.prepaidAppliedBs`: `0`, `1920`
  - `payment.rentalCollectedBs`: `0`, `107`, `120`, `150`, `1800`, `196`, `200`, `2000`, `222`, `225`, `230`, `25`, `255`, `266`, `2696`, `380`, `400`, `423.5`, `480.5`, `50`, `800`
  - `payment.status`: `a_cuenta`, `cancelado`, `liquidado`, `saldo_pendiente`, `sin_pago`
  - `penaltiesBs`: `0`, `15`, `20`
  - `pickupTimeMode`: `coordinate`, `fixed`
  - `pickupWindowEnd`: `10:00`, `12:00`, `16:00`, `17:00`, `18:00`, `18:09`, `19:00`, `20:00`, `22:00`, `22:30`
  - `pickupWindowStart`: `08:00`, `08:30`, `09:00`, `09:30`, `10:00`, `12:00`, `13:00`, `15:00`, `19:00`, `20:00`, `22:00`
  - `prepaidAppliedBs`: `0`, `1920`
  - `prepaidClientId`: `4cd81b22-0317-41d6-b22c-66acc86de7d7`
  - `pricingPlan.days`: `1`, `2`, `6`
  - `pricingPlan.durationDiscountBs`: `0`, `1545`, `170`
  - `pricingPlan.effectiveMultiplier`: `1`, `1.75`, `3.5`
  - `pricingPlan.mode`: `duration`, `simple`
  - `refundBs`: `0`, `100`, `13`, `135`, `144`, `150`, `200`, `29`, `31.8`, `36`, `77`
  - `returnSettlement.discountCoveredByDepositBs`: `0`, `100`, `132`, `137`, `1478`, `15`, `150`, `68.2`, `680.4`, `71`, `73`
  - `returnSettlement.internalPenaltiesBs`: `0`
  - `returnSettlement.penaltiesBs`: `0`, `15`, `20`
  - `returnSettlement.refundBs`: `0`, `100`, `13`, `135`, `144`, `150`, `200`, `29`, `31.8`, `36`, `77`
  - `status`: `active`, `returned`
  - `totals.deliveryFeeBs`: `0`, `20`, `200`, `30`, `50`, `60`, `70`
  - `totals.deliveryFeeCollectedBs`: `0`, `30`, `50`, `60`, `70`
  - `totals.discountBs`: `0`, `142`, `15.75`, `162`, `278.5`, `286.77`, `33.6`, `43.5`, `458.7`, `526.58`
  - `totals.discountPercent`: `0`, `10`
  - `totals.durationDiscountBs`: `0`, `1545`, `170`
  - `totals.guaranteeBs`: `0`, `100`, `134`, `141`, `150`, `200`, `28`, `40`, `680.4`, `700`
  - `totals.overpaidBs`: `0`, `100`, `150`, `174`, `197.5`, `30`, `300`
  - `totals.paidAtRentalBs`: `0`, `100`, `107`, `150`, `1800`, `190`, `1920`, `196`, `200`, `2000`, `222`, `230`, `25`, `255`, `266`, `2696`, `315`, `380`, `400`, `423.5`, `480.5`, `800`
  - `totals.prepaidAppliedBs`: `0`, `1920`
  - `totals.servicesSubtotalBs`: `0`, `170`
- Referencias huerfanas: 8

## resetLogs

- Registros: 20
- Campos obligatorios: `action`, `createdAt`, `errors`, `id`, `modules`, `result`, `summary`, `summary.total`, `userId`, `userName`, `userRole`
- Campos con dinero: `summary.deletedTotal`, `summary.total`
- Campos de fecha: `createdAt`
- Estructuras anidadas: `errors`, `modules`, `summary`, `summary.deletedByCollection`
- Campos efimeros: ninguno
- Conservar en legacyData: `errors`, `modules`, `summary`, `summary.deletedByCollection`
- Enums implicitos:
  - `action`: `database_export`, `database_import`, `execute`
  - `ip`: ``
  - `observations`: ``
  - `result`: `partial`, `success`
  - `summary.attendanceRecords`: `1`, `2`
  - `summary.blocked`: `0`, `16`
  - `summary.calendarEvents`: `0`
  - `summary.cashDebts`: `0`, `1`
  - `summary.cashMovements`: `14`, `15`, `154`, `155`, `16`, `17`, `187`, `21`, `22`, `32`, `66`, `71`
  - `summary.cashSessions`: `0`, `1`
  - `summary.categories`: `42`, `43`, `44`, `45`, `46`, `48`, `49`
  - `summary.clients`: `11`, `14`, `15`, `21`, `28`, `4`, `47`, `48`, `5`, `7`, `86`, `99`
  - `summary.contracts`: `104`, `13`, `15`, `2`, `22`, `27`, `3`, `49`, `50`, `6`, `91`, `92`
  - `summary.critical`: `0`
  - `summary.deletable`: `14`, `33`, `52`, `72`
  - `summary.deletedByCollection.cashMovements`: `14`, `22`, `32`, `71`
  - `summary.deletedByCollection.cashSessions`: `1`
  - `summary.deletedByCollection.contracts`: `3`
  - `summary.deletedByCollection.deliveries`: `4`
  - `summary.deletedByCollection.generatedReports`: `11`
  - `summary.deletedByCollection.rentals`: `7`
  - `summary.deletedByCollection.transportRoutes`: `2`
  - `summary.deletedByCollection.userPresence`: `2`
  - `summary.deletedTotal`: `14`, `33`, `52`, `72`
  - `summary.deliveries`: `113`, `12`, `2`, `20`, `28`, `3`, `4`, `58`, `8`, `97`, `99`
  - `summary.drivers`: `0`
  - `summary.exportedCollections`: `24`, `25`, `27`
  - `summary.importedCollections`: `27`
  - `summary.inventoryMovements`: `109`, `15`, `20`, `206`, `212`, `32`, `359`, `364`, `394`, `53`, `8`, `89`
  - `summary.personnelAttendance`: `0`
  - `summary.personnelEmployees`: `38`, `39`
  - `summary.personnelIncidents`: `0`
  - `summary.quotes`: `0`, `10`, `6`
  - `summary.rentals`: `107`, `14`, `16`, `23`, `3`, `30`, `4`, `55`, `56`, `7`, `95`, `96`
  - `summary.stockRecoveries`: `0`, `3`, `5`
  - `summary.supplierLoans`: `0`
  - `summary.supplierQuotes`: `0`, `1`, `2`, `4`
  - `summary.suppliers`: `0`, `1`, `2`
  - `summary.transportRoutes`: `0`, `1`
  - `summary.userPresence`: `0`, `2`, `3`
  - `summary.users`: `10`, `11`, `7`, `8`, `9`
  - `summary.vehicles`: `0`
  - `userId`: `usr-maria`
  - `userName`: `YORDY COPA CEREZO`, `Yordy Copa Cerezo`
  - `userRole`: `Developer`

## schemaVersion

- Registros: 0
- Campos obligatorios: ninguno detectado
- Campos con dinero: ninguno
- Campos de fecha: ninguno
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno

## settings

- Registros: 1
- Campos obligatorios: `activityStartDate`, `address`, `backupMode`, `companyName`, `contractCancellationPenaltyPercent`, `currency`, `damageMultiplier`, `dateFormat`, `defaultDepositBs`, `deliveryBaseFeeBs`, `email`, `fiscalCondition`, `language`, `missingMultiplier`, `numbering`, `numbering.adjustmentNext`, `numbering.adjustmentPrefix`, `numbering.contractNext`, `numbering.deliveryNext`, `numbering.deliveryPrefix`, `numbering.hrImportNext`, `numbering.hrImportPrefix`, `numbering.movementNext`, `numbering.movementPrefix`, `numbering.quoteNext`, `numbering.quotePrefix`, `numbering.serviceOrderNext`, `numbering.serviceOrderPrefix`, `numbering.supplierLoanNext`, `numbering.supplierLoanPrefix`, `numbering.supplierQuoteNext`, `numbering.supplierQuotePrefix`, `phone`, `taxId`, `timeFormat`, `timezone`, `website`
- Campos con dinero: `defaultDepositBs`, `deliveryBaseFeeBs`
- Campos de fecha: `activityStartDate`
- Estructuras anidadas: `numbering`
- Campos efimeros: ninguno
- Conservar en legacyData: `numbering`
- Enums implicitos:
  - `activityStartDate`: `2018-03-01`
  - `address`: `CALLE BATALLÓN N° 2357 ENTRE TOCOPILLA Y ATACAMA`
  - `backupMode`: `automatico`
  - `companyName`: `COPETIN SRL`
  - `contractCancellationPenaltyPercent`: `20`
  - `currency`: `BOB`
  - `damageMultiplier`: `1.2`
  - `dateFormat`: `DD/MM/YYYY`
  - `defaultDepositBs`: `200`
  - `deliveryBaseFeeBs`: `0`
  - `email`: `elcopetin@gmail.com`
  - `fiscalCondition`: `Responsable Inscripto`
  - `language`: `es`
  - `missingMultiplier`: `2`
  - `numbering.adjustmentNext`: `46`
  - `numbering.adjustmentPrefix`: `AJ-`
  - `numbering.contractNext`: `1571`
  - `numbering.contractPrefix`: ``
  - `numbering.deliveryNext`: `114`
  - `numbering.deliveryPrefix`: `ENT-`
  - `numbering.hrImportNext`: `1`
  - `numbering.hrImportPrefix`: `BIO-`
  - `numbering.movementNext`: `457`
  - `numbering.movementPrefix`: `MOV-`
  - `numbering.quoteNext`: `11`
  - `numbering.quotePrefix`: `COT-`
  - `numbering.serviceOrderNext`: `108`
  - `numbering.serviceOrderPrefix`: `OS-`
  - `numbering.supplierLoanNext`: `1`
  - `numbering.supplierLoanPrefix`: `SUB-`
  - `numbering.supplierQuoteNext`: `5`
  - `numbering.supplierQuotePrefix`: `PRO-COT-`
  - `phone`: `78333334`
  - `taxId`: `30-71234567-8`
  - `timeFormat`: `24h`
  - `timezone`: `America/Argentina/Buenos_Aires`
  - `website`: `www.copetin.com`

## stockRecoveries

- Registros: 5
- Campos obligatorios: `category`, `createdAt`, `id`, `imageUrl`, `itemId`, `itemName`, `note`, `quantity`, `sourceCustomerName`, `sourceRentalId`, `stage`, `updatedAt`
- Campos con dinero: ninguno
- Campos de fecha: `createdAt`, `updatedAt`
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno
- Enums implicitos:
  - `category`: `CRISTALERIA`, `VASOS VARIOS`
  - `createdAt`: `2026-06-30T16:12:43.738Z`, `2026-06-30T20:03:27.054Z`, `2026-07-03T14:37:42.611Z`, `2026-07-03T18:18:45.930Z`
  - `id`: `4c733370-9221-412d-aafe-c2df63405352`, `890216a8-3c8f-4977-95d2-0014703d55ae`, `9e70d41b-68e8-44f4-950b-421518bfad0c`, `bc83dd1f-617d-48ae-ac92-ad1d4407fc12`, `d8ab249b-605a-414a-aa03-406256c0b028`
  - `imageUrl`: `/uploads/products/0f08ac8d-d95c-4b32-98ff-1aa49455966e-4341771f797861c50c39.jpg`, `/uploads/products/3966faae-1f2f-4b88-98b1-44b732fcce68-14d978a753c9747b0262.jpg`, `/uploads/products/3c8dcecd-6379-4468-918a-f5e7932e27f8-9d36849b8c84dc3a97ea.jpg`, `/uploads/products/41f11ec8-e32b-4af6-99f7-e942eb704486-920764eae5874e37407e.jpg`, `/uploads/products/abc25fee-67b3-4ea2-8dd2-88bc627f22e5-a2ebd141f984d4d51b74.jpg`
  - `itemId`: `0f08ac8d-d95c-4b32-98ff-1aa49455966e`, `3966faae-1f2f-4b88-98b1-44b732fcce68`, `3c8dcecd-6379-4468-918a-f5e7932e27f8`, `41f11ec8-e32b-4af6-99f7-e942eb704486`, `abc25fee-67b3-4ea2-8dd2-88bc627f22e5`
  - `itemName`: `COPA DE VINO GOTA`, `COPA HURACANADO`, `VASO LARGO AMASADIÑO`, `VASO LARGO ESTRIADO`, `VASO LARGO LISO`
  - `note`: `F1X15 = 15 BS`, `F1X18 = 18 BS REPOSICION`, `F1X20 = 20 BS REPOSICION`, `F1X60 = 60 BS`, `VASO ROTO`
  - `quantity`: `1`
  - `sourceCustomerName`: `ALEJANDRA TAMES`, `ESTELA RIVERA`, `LORENA`, `MARIANA SORIANO`
  - `sourceRentalId`: `593896d0-ee47-43a5-869b-536d8ecaa0ac`, `a0b7a308-dd70-467e-a916-b6046e889032`, `d7f6c5fb-2b25-4f25-952e-f3bff3ea64aa`, `d9fdb436-ffed-4792-9df5-5038b3392ad7`
  - `stage`: `reparacion`
  - `updatedAt`: `2026-06-30T16:12:43.738Z`, `2026-06-30T20:03:27.054Z`, `2026-07-03T14:37:42.611Z`, `2026-07-03T18:18:45.930Z`

## supplierLoans

- Registros: 0
- Campos obligatorios: ninguno detectado
- Campos con dinero: ninguno
- Campos de fecha: ninguno
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno

## supplierQuotes

- Registros: 4
- Campos obligatorios: `createdAt`, `id`, `items`, `quoteCode`, `status`, `supplierId`, `supplierName`, `title`, `totals`, `totals.totalBs`, `updatedAt`
- Campos con dinero: `totals.totalBs`
- Campos de fecha: `createdAt`, `deletedAt`, `updatedAt`, `validUntil`
- Estructuras anidadas: `items`, `totals`
- Campos efimeros: ninguno
- Conservar en legacyData: `items`, `totals`
- Enums implicitos:
  - `createdAt`: `2026-06-23T15:48:13.776Z`, `2026-06-25T23:27:25.320Z`, `2026-06-29T21:03:47.443Z`, `2026-06-30T15:39:14.704Z`
  - `id`: `3788d5c8-db94-4b99-b7a4-5cfddd6628ec`, `6f118685-d781-4c83-a804-0227fe104991`, `89f7e9f3-ba68-4a44-ab36-3144b1db0543`, `b19b843e-a6d0-4e9a-910f-a20b95b06d4b`
  - `notes`: ``, `COBERTURA CREADA DESDE CONTRATO EN ORDENES DE SERVICIO. | COLOR: BLANCO | MATERIAL: MADERA`, `COBERTURA CREADA DESDE CONTRATO EN ORDENES DE SERVICIO. | COLOR: TRANSPARENTE | MATERIAL: VIDRIO`
  - `quoteCode`: `PRO-COT-00001`, `PRO-COT-00002`, `PRO-COT-00003`, `PRO-COT-00004`
  - `status`: `vigente`
  - `supplierId`: `1e66037a-188a-4c03-9ce6-9ad513d3fd08`, `a57fca4f-424e-43fa-a2d2-54c625217687`
  - `supplierName`: `MABEL BAREA`, `SALON LINCOL`
  - `title`: `COBERTURA PARA CERVECERO PEQUEÑO`, `COBERTURA PARA MESA INFANTIL  / MADERA LINEA BLANCA`, `LISTA DE PRECIOS`
  - `totals.totalBs`: `0`, `30`, `32`, `45`
  - `updatedAt`: `2026-06-23T15:48:13.776Z`, `2026-06-25T23:27:25.320Z`, `2026-06-29T21:03:47.443Z`, `2026-06-30T15:39:14.704Z`
  - `validFrom`: `2026-06-27`, `2026-07-02`
  - `validUntil`: `2026-06-27`, `2026-07-01`, `2026-07-06`

## suppliers

- Registros: 2
- Campos obligatorios: `contactName`, `createdAt`, `id`, `name`, `status`, `type`, `updatedAt`
- Campos con dinero: `paymentTerms`
- Campos de fecha: `createdAt`, `deletedAt`, `updatedAt`
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno
- Enums implicitos:
  - `address`: ``, `PACHAMAMA`
  - `city`: ``, `CERCADO`
  - `contactName`: `SHIRLEY CARRASCO`, `SOMBRILLAS`
  - `createdAt`: `2026-06-10T21:51:42.631Z`, `2026-06-25T23:27:19.437Z`
  - `email`: ``
  - `id`: `1e66037a-188a-4c03-9ce6-9ad513d3fd08`, `a57fca4f-424e-43fa-a2d2-54c625217687`
  - `name`: `MABEL BAREA`, `SALON LINCOL`
  - `notes`: ``, `CREADO DESDE ORDEN DE SERVICIO.`
  - `paymentTerms`: ``, `Segun acuerdo operativo`
  - `phone`: ``, `77922727`
  - `status`: `active`
  - `type`: `regular`
  - `updatedAt`: `2026-06-10T21:51:42.631Z`, `2026-06-28T13:57:45.298Z`
  - `whatsapp`: ``, `67407518`

## transportRoutes

- Registros: 1
- Campos obligatorios: `createdAt`, `date`, `id`, `routeCode`, `status`, `stops`, `type`, `updatedAt`
- Campos con dinero: ninguno
- Campos de fecha: `createdAt`, `date`, `deletedAt`, `updatedAt`
- Estructuras anidadas: `stops`
- Campos efimeros: ninguno
- Conservar en legacyData: `stops`
- Enums implicitos:
  - `createdAt`: `2026-06-22T14:56:00.821Z`
  - `date`: `2026-06-22`
  - `id`: `b8ff2457-29d2-4008-978b-485b9cd170a6`
  - `notes`: ``
  - `routeCode`: `RM-20260622-01`
  - `status`: `borrador`
  - `type`: `mixta`
  - `updatedAt`: `2026-06-22T14:56:00.821Z`

## userPresence

- Registros: 0
- Campos obligatorios: ninguno detectado
- Campos con dinero: ninguno
- Campos de fecha: ninguno
- Estructuras anidadas: ninguna
- Campos efimeros: `__collection__`
- Conservar en legacyData: ninguno

## users

- Registros: 11
- Campos obligatorios: `createdAt`, `fullName`, `id`, `isCurrentUser`, `mustChangePassword`, `passwordChangedAt`, `passwordHash`, `permissions`, `permissions.attendanceEnabled`, `permissions.calendarReadOnly`, `permissions.ordersReadOnly`, `role`, `roleId`, `roleIds`, `status`, `updatedAt`, `username`
- Campos con dinero: ninguno
- Campos de fecha: `createdAt`, `deletedAt`, `invitedAt`, `updatedAt`
- Estructuras anidadas: `permissions`, `roleIds`
- Campos efimeros: `isCurrentUser`
- Conservar en legacyData: `permissions`, `roleIds`
- Enums implicitos:
  - `createdAt`: `2026-05-19T23:04:27.518Z`, `2026-05-25T23:13:10.338Z`, `2026-05-25T23:13:46.245Z`, `2026-05-25T23:14:35.069Z`, `2026-05-28T19:26:06.488Z`, `2026-06-01T22:00:29.784Z`, `2026-06-03T13:14:14.089Z`, `2026-06-23T16:59:48.972Z`, `2026-06-29T17:58:16.141Z`, `2026-06-30T20:42:08.310Z`, `2026-07-03T19:07:00.240Z`
  - `fullName`: `ARACELY SIERRA`, `CELINA MUÑOZ`, `ESTHER PLATA`, `JHONATAN PEREIRA`, `KARINA CARRASCO`, `LUIS VEGA`, `MABEL COLQUE`, `MARCELINA INOCENTE`, `RAQUEL VELASCO`, `SONIA SIVINCHA`, `YORDY COPA CEREZO`
  - `id`: `15394320-f3ff-4f4e-88d4-1974123d286f`, `51cf2f2a-53f8-4690-86b0-062218d99e37`, `539851cf-e5f5-4f0a-b47b-cef2b6c5955f`, `6771f731-6c57-4c70-b22c-d193af99afb9`, `83fedfa7-cb0f-4c62-9a99-e0b040358fed`, `8efc0f4d-0529-4a61-a34b-a8454bdcbf71`, `9a43fb0b-b74a-42ca-af8e-ae63bc32c417`, `af80689d-d136-404a-aa33-bed563142b6c`, `e3e4398c-acf9-45e4-a127-4cfa8ef8d37c`, `fe8b62b8-9873-4aa1-844b-4fe72b701793`, `usr-maria`
  - `isCurrentUser`: `false`, `true`
  - `lastAccessAt`: `2026-06-30T20:44:58.146Z`, `2026-07-01T16:14:11.251Z`, `2026-07-02T20:12:50.021Z`, `2026-07-03T15:23:27.530Z`, `2026-07-03T15:33:19.206Z`, `2026-07-03T16:02:39.217Z`, `2026-07-03T16:06:12.922Z`, `2026-07-03T17:14:26.221Z`, `2026-07-03T17:22:37.943Z`, `2026-07-03T17:46:01.624Z`
  - `mustChangePassword`: `false`
  - `passwordChangedAt`: `2026-05-20T14:47:43.215Z`, `2026-05-25T23:13:10.338Z`, `2026-05-25T23:13:46.245Z`, `2026-05-25T23:14:35.069Z`, `2026-05-28T19:26:06.488Z`, `2026-06-01T22:00:29.784Z`, `2026-06-03T13:14:14.089Z`, `2026-06-23T16:59:48.972Z`, `2026-06-29T17:58:16.141Z`, `2026-06-30T20:42:08.310Z`, `2026-07-03T19:07:00.240Z`
  - `passwordHash`: `fnv1a:117593e6`, `fnv1a:26d06b8a`, `fnv1a:43a45364`, `fnv1a:4c8034c0`, `fnv1a:6ddb8f04`, `fnv1a:738e32f3`, `fnv1a:db5749d6`, `fnv1a:de8ef39d`, `fnv1a:f0408787`, `fnv1a:f702a338`, `fnv1a:ffc65846`
  - `permissions.attendanceEnabled`: `true`
  - `permissions.calendarReadOnly`: `false`
  - `permissions.ordersReadOnly`: `false`
  - `phone`: ``, `60727050`, `76919455`, `79979352`
  - `role`: `Developer`, `Super admin`, `Ventas`, `Ventas, Transporte`
  - `roleId`: `developer`, `super_admin`, `ventas`
  - `status`: `active`
  - `updatedAt`: `2026-06-30T20:44:58.146Z`, `2026-07-01T16:14:11.251Z`, `2026-07-02T20:12:50.021Z`, `2026-07-03T15:23:27.530Z`, `2026-07-03T15:33:19.206Z`, `2026-07-03T16:02:39.217Z`, `2026-07-03T16:06:12.922Z`, `2026-07-03T17:14:26.221Z`, `2026-07-03T17:22:37.943Z`, `2026-07-03T17:46:01.624Z`, `2026-07-03T19:07:00.240Z`
  - `username`: `admin`, `aracely`, `celina`, `esther`, `jhonatan`, `karina`, `luis`, `mabel`, `marcelina`, `raquel`, `sonia`

## vehicles

- Registros: 0
- Campos obligatorios: ninguno detectado
- Campos con dinero: ninguno
- Campos de fecha: ninguno
- Estructuras anidadas: ninguna
- Campos efimeros: ninguno
- Conservar en legacyData: ninguno

