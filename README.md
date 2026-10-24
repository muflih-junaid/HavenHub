# HavenHub

```bash
# Install (Node.js 24.15+ LTS or 26+)
npm --prefix client install
npm --prefix server install

# Configure local environment files (run once from the project root)
printf 'VITE_API_URL=http://localhost:5000/api\n' > client/.env
# Copy only if server/.env does not already exist
cp -n server/.env.example server/.env
# Edit server/.env and set MONGODB_URI and JWT_SECRET before starting the API
# Generate JWT_SECRET (paste its output into server/.env)
openssl rand -hex 32
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
npm --prefix client test
npm --prefix client run build
npm --prefix server run check
npm --prefix server test
curl http://localhost:5000/api/health

# Start the API without file watching
npm --prefix server start
```

For a local admin, set `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_PHONE` in `server/.env`, then run:

```bash
npm --prefix server run bootstrap:admin
```

The command leaves an existing admin unchanged and refuses to promote a citizen or volunteer with the same email. Remove the `ADMIN_*` credentials afterward. Passwords need at least 8 characters and at most 72 UTF-8 bytes. `JWT_EXPIRES_IN_SECONDS` defaults to `3600`.
