# API Reference

Base URL: `http://localhost/api` (via Nginx)  
Direct backend URL: `http://localhost:5000/api`

## Authentication

Most routes require an authenticated session cookie.

Public endpoints:
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/check`
- `GET /health`

### POST /auth/login
Authenticate with password from `LOGIN_PASSWORD`.

**Body**
```json
{
  "password": "your-password"
}
```

### POST /auth/logout
Destroys the current session.

### GET /auth/check
Returns `{ "authenticated": true|false }`.

## Health

### GET /health
Backend status endpoint.

## Upload

### POST /upload
Upload and OCR-process a single PDF, creating one `Load`.

**Request**
- `multipart/form-data`
- field: `file` (PDF, max 10MB)

## Loads

### GET /loads
List loads (defaults to excluding `invoiced: true` unless explicitly requested).

**Query params**
- `carrier_id`
- `driver_id`
- `cancelled` (`true|false`)
- `confirmed` (`true|false`)
- `invoiced` (`true|false`)

### GET /loads/invoiced
Search invoiced loads only.

**Query params**
- `carrier_id`
- `load_number` (partial match, case-insensitive)
- `driver_id`
- `pickup_date_from`
- `delivery_date_to`
- `sub_dispatcher_id`

### GET /loads/grouped
Returns loads grouped by carrier.

**Query params**
- `cancelled` (`true` to include cancelled)
- `invoiced` (`true|false`, optional filtering)

### GET /loads/log
Company load log by carrier/date range.

**Query params**
- `carrier_id` (required)
- `date_from`
- `date_to`

### GET /loads/sub-dispatcher-report
Loads and totals for a sub-dispatcher/date range.

**Query params**
- `sub_dispatcher_id` (required)
- `date_from`
- `date_to`

### GET /loads/:id
Get a load by ID.

### GET /loads/:id/conflicts
Get date-conflicting loads for a load.

### POST /loads
Create a load.

### PUT /loads/:id
Full load update.

### PATCH /loads/:id
Driver assignment patch.

**Body**
```json
{
  "driver_id": "driverObjectId-or-null"
}
```

### PATCH /loads/:id/cancel
Set cancelled state.

### PATCH /loads/:id/confirm
Mark load as confirmed.

### PATCH /loads/:id/invoiced
Set invoiced state.

### PATCH /loads/:id/sub-dispatcher
Set or clear `sub_dispatcher_id`.

### PATCH /loads/:id/carrier
Set carrier and optionally save OCR alias.

**Body**
```json
{
  "carrier_id": "carrierObjectId",
  "save_alias": false
}
```

### DELETE /loads/:id
Delete load.

## Carriers

- `GET /carriers`
- `GET /carriers/:id`
- `POST /carriers`
- `PUT /carriers/:id`
- `DELETE /carriers/:id`

## Drivers

- `GET /drivers` (supports `carrier_id` query filter)
- `GET /drivers/:id`
- `POST /drivers`
- `PUT /drivers/:id`
- `DELETE /drivers/:id`

## Rules

Invoice rule CRUD:
- `GET /rules`
- `GET /rules/:id`
- `POST /rules`
- `PUT /rules/:id`
- `DELETE /rules/:id`

Used by invoice generation (`rule_id`) to select loads.

## Invoices

### GET /invoices
List invoices.

**Query params**
- `carrier` (matches carrier name / bill-to name)
- `dateFrom`
- `dateTo`

### GET /invoices/:id
Get invoice by ID.

### GET /invoices/:id/pdf
Stream invoice PDF.

**Query params**
- `download=true` -> attachment
- omitted -> inline view

### PATCH /invoices/:id/paid
Set paid/unpaid state.

### DELETE /invoices/:id
Delete invoice and unmark linked loads as invoiced.

### POST /invoices/generate
Generate one or more invoices from selected loads or an invoice rule.

**Body (example)**
```json
{
  "load_ids": ["..."],
  "rule_id": "...",
  "includeUnconfirmed": false,
  "invoiceData": {
    "invoiceNumber": "INV-001"
  }
}
```

Notes:
- Either `load_ids` or `rule_id` is required.
- Cancelled and already-invoiced loads are excluded.
- Loads are grouped by `carrier + invoice_week_id`, so one request can create multiple invoices.

### POST /invoices/upload-old
Upload historical invoice PDF; creates an invoice record from parsed filename.

Filename pattern:
- `{Carrier Name} Invoice YYYY-MM-DD.pdf`
- `{Carrier Name} Invoice YYYY-MM-DD (PERSON NAME).pdf`

### POST /invoices/extract-old-invoice
Extract structured data from old invoice PDF.

### POST /invoices/save-extracted
Persist edited extracted old-invoice data as loads + invoice.

## Dispatchers

- `GET /dispatchers`
- `GET /dispatchers/active`
- `GET /dispatchers/:id`
- `POST /dispatchers`
- `PUT /dispatchers/:id`
- `PATCH /dispatchers/:id/activate`
- `DELETE /dispatchers/:id`

## Settings

### GET /settings
Get app settings (creates defaults if none exist).

### PUT /settings
Update settings.

**Body fields**
- `defaultRate`
- `billTo`
- `hideInvoicedLoads`

