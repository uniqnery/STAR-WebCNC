import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';

// Environment
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Express App
const app = express();

// Middleware
app.use(cors({
  origin: NODE_ENV === 'production'
    ? process.env.CORS_ORIGIN
    : 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0'
  });
});

// API Routes (to be added)
app.get('/api', (req, res) => {
  res.json({
    message: 'Star-WebCNC API Server',
    version: '0.1.0'
  });
});

// HTTP Server
const httpServer = createServer(app);

// Start Server
httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║           Star-WebCNC Server Started                  ║
╠═══════════════════════════════════════════════════════╣
║  Environment: ${NODE_ENV.padEnd(39)}║
║  Port:        ${String(PORT).padEnd(39)}║
║  Time:        ${new Date().toISOString().padEnd(39)}║
╚═══════════════════════════════════════════════════════╝
  `);
});

export { app, httpServer };
