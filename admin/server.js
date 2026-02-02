import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRouter from './api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files (HTML, CSS, JS)
app.use(express.static(__dirname));

// API routes
app.use('/api', apiRouter);

// Start server
app.listen(PORT, () => {
  console.log(`Admin panel running at http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
