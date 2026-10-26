import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import disasterRoutes from './routes/disasters.js';
import requestRoutes from './routes/requests.js';
import volunteerRoutes from './routes/volunteers.js';

const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ status: 'ok', message: 'HavenHub API is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/disasters', disasterRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/volunteers', volunteerRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Keep parser errors and future route errors in the same JSON format.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  let status = err.status >= 400 && err.status < 600 ? err.status : 500;

  let message = 'Internal server error';
  if (err.code === 11000) {
    status = 409;
    message = 'An account with that email already exists';
  } else if (err.name === 'ValidationError') {
    status = 400;
    // Do not return Mongoose errors: they can include rejected field values.
    message = 'Invalid data. Check the submitted fields';
  } else if (status < 500) {
    message = err.type === 'entity.parse.failed' ? 'Invalid JSON request body' : err.message;
  }

  if (status >= 500) console.error('Request failed with an internal server error');
  res.status(status).json({ message });
});

export default app;
