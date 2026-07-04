# Migracion JSON a PostgreSQL

Modo: `dry-run`
Archivo JSON: `C:\Users\Milton\Desktop\copetin\data\app-state.json`
Empresa destino: `COPETIN`
Duracion ms: `150`

## Conteos origen JSON

| Coleccion | Registros |
|---|---:|
| clients | 99 |
| categories | 49 |
| items | 1872 |
| inventoryCombos | 17 |
| inventoryMovements | 394 |
| stockRecoveries | 5 |
| suppliers | 2 |
| supplierQuotes | 4 |
| contracts | 116 |
| quotes | 10 |
| rentals | 107 |
| deliveries | 113 |
| transportRoutes | 1 |
| vehicles | 0 |
| drivers | 0 |
| cashSessions | 1 |
| cashMovements | 187 |
| cashDebts | 0 |
| personnelEmployees | 39 |
| attendanceRecords | 2 |
| personnelAttendance | 0 |
| personnelIncidents | 0 |
| calendarEvents | 0 |
| calendarBoardNotes | 0 |
| generatedReports | 237 |
| resetLogs | 20 |

## Plan PostgreSQL

| Modelo | Filas |
|---|---:|
| company | 2 |
| permission | 27 |
| role | 8 |
| rolePermission | 92 |
| user | 11 |
| userCompany | 11 |
| companySettings | 1 |
| uploadedFile | 484 |
| client | 99 |
| category | 49 |
| item | 1872 |
| inventoryCombo | 17 |
| inventoryMovement | 394 |
| stockRecovery | 5 |
| supplier | 2 |
| supplierQuote | 4 |
| contract | 116 |
| quote | 10 |
| rental | 107 |
| delivery | 113 |
| transportRoute | 1 |
| vehicle | 0 |
| driver | 0 |
| cashSession | 1 |
| cashMovement | 187 |
| cashDebt | 0 |
| personnelEmployee | 39 |
| attendanceRecord | 2 |
| personnelAttendance | 0 |
| personnelIncident | 0 |
| calendarEvent | 0 |
| calendarBoardNote | 0 |
| generatedReport | 237 |
| resetLog | 20 |
| inventoryComboItem | 46 |
| supplierQuoteItem | 4 |
| contractItem | 565 |
| quoteItem | 60 |
| rentalItem | 516 |
| transportRouteStop | 0 |

Warnings: `0`
