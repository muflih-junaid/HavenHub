# HavenHub

```bash
# Install (Node.js 24+)
npm --prefix client install
npm --prefix server install

# Configure local environment files (run once from the project root)
printf 'VITE_API_URL=http://localhost:5000/api\n' > client/.env
printf 'PORT=5000\nCLIENT_ORIGIN=http://localhost:5173\n' > server/.env
```

```bash
# Terminal 1 — API at http://localhost:5000
cd server
npm run dev
```

```bash
# Terminal 2 — client at http://localhost:5173
cd client
npm run dev
```

```bash
# Checks (from the project root)
npm --prefix client run lint
npm --prefix client run build
npm --prefix server run check
curl http://localhost:5000/api/health

# Start the API without file watching
npm --prefix server start
```
