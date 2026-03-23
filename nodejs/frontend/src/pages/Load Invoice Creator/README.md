# Load Invoice Creator (Docker)

A lightweight webpage to create a **printable carrier load invoice**.

## What the invoice includes

- Date of pickup
- Date of delivery
- Address of pickup
- Address of delivery
- Rate
- Broker to be invoiced (name + driver)
- Invoice #
- Carrier info (name + address)

## Run with Docker

Build:

```bash
docker build -t load-invoice-creator .
```

Run:

```bash
docker run --rm -p 8080:80 load-invoice-creator
```

Open:

- `http://localhost:8080`

## Run locally (no Docker)

### Option A: Just open the file

- Double-click `index.html`

### Option B: Use a tiny local web server (recommended)

From this folder:

```bash
python -m http.server 8080
```

Then open:

- `http://localhost:8080`

## Usage

1. Fill out the form.
2. Click **Generate invoice**.
3. Click **Print** (or press `Ctrl+P`).


