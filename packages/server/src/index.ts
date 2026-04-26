import { startServer } from './app.js';

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
