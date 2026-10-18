import express from 'express';
import cors from 'cors';

const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ status: 'ok', message: 'HavenHub API is running' });
});

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Keep parser errors and future route errors in the same JSON format.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  const status = err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);

  let message = 'Internal server error';
  if (status < 500) {
    message = err.type === 'entity.parse.failed' ? 'Invalid JSON request body' : err.message;
  }

  res.status(status).json({ message });
});

export default app;
