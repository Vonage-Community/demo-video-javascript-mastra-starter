import express, { type Request, type Response } from "express";
import cors from 'cors';
import http from 'http';
import { MastraServer } from '@mastra/express';
import { mastra } from './mastra';
import { WebSocketServer } from 'ws';
import vonageRoutes from './vonageRoutes';
import { setupAudioBridge } from './wsBridge';


const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

app.use(express.static('public'));

app.use('/api/video', vonageRoutes);

// 1. Initialize the Mastra REST API (handles your text-based /api/agents/... routes)
const mastraServer = new MastraServer({ app, mastra });
await mastraServer.init();

// 2. Create the native HTTP server wrapping the Express app
const httpServer = http.createServer(app);

// 3. Attach the WebSocket server to the HTTP server
const wss = new WebSocketServer({ server: httpServer, path: '/ws/audio' });
setupAudioBridge(wss);

// 4. Start the unified server
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});