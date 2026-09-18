import WebSocket from 'ws';
import { Agent } from '@mastra/core/agent';
import { GeminiLiveVoice } from '@mastra/voice-google-gemini-live';
import { venueTool } from './mastra/tools/venue-tool';
import { tokenGenerate } from '@vonage/jwt';

export function setupAudioBridge(wss: WebSocket.Server) {
  wss.on('connection', async (vonageWs, req) => {
    console.log('Vonage Audio Connector connected to bridge.');

    const appId = process.env.VONAGE_APPLICATION_ID!;
    const privateKey = process.env.VONAGE_PRIVATE_KEY!;

    let currentRole = '';
    let textBuffer = '';
    let flushTimeout: NodeJS.Timeout;

    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');

    // Helper to send the signal and clear the buffer
    const flushCaptions = async () => {
      if (textBuffer.trim().length === 0) return;

      const payload = { role: currentRole, text: textBuffer.trim() };
      textBuffer = ''; // Clear buffer immediately to prevent double-sends

      const token = tokenGenerate(appId, privateKey);

      try {
        await fetch(`https://video.api.vonage.com/v2/project/${appId}/session/${sessionId}/signal`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'aiCaption', data: JSON.stringify(payload) })
        });
      } catch (error) {
        console.error('Caption signal failed:', error);
      }
    };

    const voiceAgent = new Agent({
      id: 'vonage-voice-agent-${sessionId}',
      name: 'Hackathon Voice Assistant',
      instructions: `You are a helpful AI assistant in a live Vonage video call. Your Vonage Session ID is ${sessionId}. If a user asks about the venue, use the show-venue-info tool and pass your Session ID.`,
      model: 'google/gemini-2.0-flash-live-001',
      tools: { venueTool },
      voice: new GeminiLiveVoice({
        // Explicitly pass your existing Gemini API key variable
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '',
        speaker: 'Puck'
      })
    });


    const aiVoice = voiceAgent.voice;
    if (!aiVoice) return;

    try {
      await aiVoice.connect();
      console.log('Mastra successfully connected to Gemini Live.');
    } catch (error) {
      console.error('Mastra connection failed:', error);
      return;
    }

    let outboundBuffer = Buffer.alloc(0);
    const FRAME_SIZE = 960; // 20ms of 24kHz 16-bit mono audio

    aiVoice.on('speaking', (event) => {
      if (event.audioData && vonageWs.readyState === WebSocket.OPEN) {
        const audioChunk = Buffer.from(
          event.audioData.buffer,
          event.audioData.byteOffset,
          event.audioData.byteLength
        );

        // Append new audio to our buffer
        outboundBuffer = Buffer.concat([outboundBuffer, audioChunk]);

        // Send audio to Vonage strictly in 960-byte chunks
        while (outboundBuffer.length >= FRAME_SIZE) {
          const frame = outboundBuffer.subarray(0, FRAME_SIZE);
          outboundBuffer = outboundBuffer.subarray(FRAME_SIZE);
          vonageWs.send(frame, (err) => {
            if (err) {
              console.error('Error sending audio data:', err);
              vonageWs.send(JSON.stringify({ status: 'ok' }));
            }
          });
        }
      }
    });

    aiVoice.on('writing', (event) => {
      console.log(`[Transcript] ${event.role}: ${event.text}`);
      // 1. If the speaker changed, immediately flush the previous speaker's text
      if (currentRole !== event.role && textBuffer.length > 0) {
        flushCaptions();
      }

      // 2. Accumulate the new text and update the role
      currentRole = event.role;
      textBuffer += event.text;

      // 3. Reset the "end of thought" timer. 
      // If 1 second passes without new text, assume they finished speaking and flush.
      clearTimeout(flushTimeout);
      flushTimeout = setTimeout(flushCaptions, 1000);
    });

    aiVoice.on('toolCall', ({ name, args, id }) => {
      console.log(`Tool called: ${name} with args:`, args)
    })

    aiVoice.on('toolResult', (event) => {
      console.log('✅ Tool execution completed. Result:', event.result);
    });

    vonageWs.on('message', (data, isBinary) => {
      if (!isBinary) return;

      const buffer = data as Buffer;
      const int16Audio = new Int16Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength / 2
      );

      aiVoice.send(int16Audio);
    });

    vonageWs.on('close', async () => {
      console.log('Vonage Audio Connector disconnected from bridge.');
      clearTimeout(flushTimeout);
      await aiVoice.disconnect();
      aiVoice.close();
    });
  });
}