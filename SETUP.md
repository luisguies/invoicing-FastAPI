# Setup Instructions

## Quick Start

1. Create a root `.env` file (manual file creation; no `.env.example` exists):
   ```env
   OPENAI_API_KEY=your_openai_key
   LOGIN_PASSWORD=your_app_password

   # Optional
   REACT_APP_API_URL=/api
   OPENAI_API_VERSION=gpt-4o-mini
   GEMINI_API_KEY=
   ```

2. Build and start all containers:
   ```bash
   docker-compose up --build
   ```

3. Open the app:
   - Recommended: `http://localhost` (through Nginx)
   - Direct frontend: `http://localhost:3000`
   - API health check: `http://localhost:5000/api/health`

4. Log in using the value from `LOGIN_PASSWORD`.

## Services Started by Docker Compose

- `nginx` on port `80`
- `nodejs-app` on ports `3000` (React) and `5000` (Express API)
- `python-scripts` on port `8000` (OCR API)
- `mongodb` (internal network, persisted in `./mongodb-data`)

## First-Time Notes

- Most API routes require authentication. Authenticate first from the login page.
- OCR/upload flows require a valid `OPENAI_API_KEY`.
- Frontend API calls are configured to use `/api` behind Nginx by default.

## Useful Commands

Start:
```bash
docker-compose up --build
```

Stop:
```bash
docker-compose down
```

Stop and remove volumes (deletes DB data):
```bash
docker-compose down -v
```

Follow all logs:
```bash
docker-compose logs -f
```

Follow specific logs:
```bash
docker-compose logs -f nodejs-app
docker-compose logs -f python-scripts
docker-compose logs -f mongodb
docker-compose logs -f nginx
```

## Troubleshooting

### Login fails
- Confirm `LOGIN_PASSWORD` is present in `.env`
- Restart containers after env changes: `docker-compose up --build`

### OCR/upload fails
- Confirm `OPENAI_API_KEY` is valid and has usage quota
- Check Python logs: `docker-compose logs -f python-scripts`

### App loads but API calls fail
- Use `http://localhost` so Nginx proxies `/api` correctly
- Check Node logs: `docker-compose logs -f nodejs-app`
- Verify backend health: `http://localhost:5000/api/health`

### Port conflicts
- Ensure ports `80`, `3000`, `5000`, and `8000` are available
- If needed, adjust host port mappings in `docker-compose.yml`

## Data Persistence

- MongoDB data: `./mongodb-data`
- Uploaded PDFs: `./uploads`
- Generated invoices: `./invoices`
- Uploaded old invoice files: `./uploads/old-invoices`

