import 'dotenv/config';
import mongoose from 'mongoose';
import app from './app.js';
import User from './models/User.js';

mongoose.connection.on('error', () => {
  // Driver errors can include connection details, so do not log the raw error.
  console.error('MongoDB connection error. Check database availability and network access.');
});

async function startServer() {
  const port = Number(process.env.PORT || 5000);
  const uri = process.env.MONGODB_URI?.trim();

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  if (!uri) {
    throw new Error('MONGODB_URI is required. Set it in server/.env or the process environment.');
  }

  try {
    await mongoose.connect(uri);
    // Wait for the unique email index before accepting requests.
    await User.init();
  } catch {
    throw new Error('MongoDB initialization failed. Check MONGODB_URI, credentials, network access, and the User email index.');
  }

  console.log('MongoDB connected and User indexes ready.');

  const server = app.listen(port, () => {
    console.log(`HavenHub API listening on http://localhost:${port}`);
  });

  server.on('error', async (error) => {
    console.error(`Unable to start HavenHub API: ${error.code}`);
    await mongoose.disconnect();
    process.exit(1);
  });
}

startServer().catch(async (error) => {
  console.error(`Unable to start HavenHub API: ${error.message}`);
  await mongoose.disconnect();
  process.exit(1);
});
