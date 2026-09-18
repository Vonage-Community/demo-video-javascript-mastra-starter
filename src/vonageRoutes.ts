import express, { Request, Response } from 'express';
import { Vonage } from '@vonage/server-sdk';
import { Video } from '@vonage/video';
import { tokenGenerate } from '@vonage/jwt';
import fs from 'fs';
import path from 'path';

const router = express.Router();

const appId = process.env.VONAGE_APPLICATION_ID;
let privateKey;

if (process.env.VONAGE_PRIVATE_KEY) {
    try {
        privateKey = fs.readFileSync(process.env.VONAGE_PRIVATE_KEY, 'utf8');
    } catch (error) {
        // PRIVATE_KEY entered as a single line string
        privateKey = process.env.VONAGE_PRIVATE_KEY.replace(/\\n/g, '\n');
    }
} else if (process.env.VONAGE_PRIVATE_KEY64) {
    privateKey = Buffer.from(process.env.VONAGE_PRIVATE_KEY64, 'base64');
}

if (!appId || !privateKey) {
    console.error('=========================================================================================================');
    console.error('');
    console.error('Missing Vonage Application ID and/or Vonage Private key');
    console.error('Find the appropriate values for these by logging into your Vonage Dashboard at: https://dashboard.nexmo.com/applications');
    console.error('Then add them to ', path.resolve('.env'), 'or as environment variables');
    console.error('');
    console.error('=========================================================================================================');
    process.exit();
}

const vonageCredentials = {
    applicationId: appId,
    privateKey: privateKey
};
const vonage = new Vonage(vonageCredentials);
vonage.video = new Video(vonageCredentials);

// IMPORTANT: roomToSessionIdDictionary is a variable that associates room names with unique
// session IDs. However, since this is stored in memory, restarting your server will
// reset these values if you want to have a room-to-session association in your production
// application you should consider a more persistent storage

const roomToSessionIdDictionary: Record<string, string> = {};

// Creates a session with various roles and properties
async function createSession(response, roomName, sessionProperties = {}, role = 'moderator') {
    let sessionId;
    let token;
    console.log(`Creating ${role} creds for ${roomName}`);

    if (roomToSessionIdDictionary[roomName]) {
        sessionId = roomToSessionIdDictionary[roomName];
        token = vonage.video.generateClientToken(sessionId, { role })
        response.setHeader('Content-Type', 'application/json');
        response.send({
            applicationId: appId,
            sessionId: sessionId,
            token: token
        });
    } else {
        try {
            const session = await vonage.video.createSession(sessionProperties);

            // now that the room name has a session associated wit it, store it in memory
            // IMPORTANT: Because this is stored in memory, restarting your server will reset these values
            // if you want to store a room-to-session association in your production application
            // you should use a more persistent storage for them
            roomToSessionIdDictionary[roomName] = session.sessionId;

            // generate token
            token = vonage.video.generateClientToken(session.sessionId, { role });
            response.setHeader('Content-Type', 'application/json');
            response.send({
                applicationId: appId,
                sessionId: session.sessionId,
                token: token
            });
        } catch (error) {
            console.error("Error creating session: ", error);
            response.status(500).send({ error: 'createSession error:' + error });
        }
    }
}

/**
 * GET /session redirects to /room/session
 */
router.get('/session', function (req: Request, res: Response) {
    res.redirect('/room/session');
});

/**
 * GET /room/session
 */
router.get('/room/:name', async (req: Request, res: Response) => {
    const roomName = req.params.name;
    const e2ee = req.params.e2ee || false
    await createSession(res, roomName, { mediaMode: "routed", e2ee }, 'moderator');
});

/**
 * POST /audio-connector/connect
 */
router.post('/audio-connector/connect', async (req: Request, res: Response) => {
    const { sessionId } = req.body;
    console.log('Connecting Audio Connector for session:', sessionId);

    // Dynamically grab the active Codespace URL so we can construct the wss:// URI
    // const host = req.get('host');
    const PORT = 3000;
    const host = `${process.env.CODESPACE_NAME}-${PORT}.app.github.dev`;
    const wsUri = `wss://${host}/ws/audio?sessionId=${sessionId}`;
    console.log('WebSocket URI for Audio Connector:', wsUri);

    try {
        // Generate an admin JWT to authorize the REST API request
        const adminToken = tokenGenerate(appId, privateKey);

        // Generate a standard participant token so the AI can "join" the video call
        const botToken = vonage.video.generateClientToken(sessionId, {
            role: 'publisher',
            data: 'name=AIAgent'
        });

        const response = await fetch(`https://video.api.vonage.com/v2/project/${appId}/connect`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId: sessionId,
                token: botToken,
                websocket: {
                    uri: wsUri,
                    audioRate: 24000,
                    bidirectional: true // Critical: Enables two-way AI audio flow
                }
            })
        });

        const data = await response.json();
        console.log('Audio Connector response data:', data);
        res.json(data);
    } catch (error) {
        console.error('Audio Connector error:', error);
        res.status(500).json({ error: 'Failed to start AI audio' });
    }
});

/**
 * POST /audio-connector/disconnect
 */
router.post('/audio-connector/disconnect', async (req, res) => {
    const { sessionId, connectionId } = req.body;
    try {
        await vonage.video.disconnectClient(sessionId, connectionId);
        console.log("Successfully disconnected Audio Connector");
        res.sendStatus(204)
    } catch (error) {
        console.error("Error starting Audio Connector: ", error);
        res.status(500).send(`Error stopping Audio Connector: ${error}`);
    }
});

export default router;