import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { tokenGenerate } from '@vonage/jwt';

export const venueTool = createTool({
  id: 'get-venue-info',
  description: 'Displays the HackBarna venue information (Norrsken House) visually on the screens of all users in the video call.',
  inputSchema: z.object({
    sessionId: z.string().describe('The Vonage session ID to broadcast the signal to.')
  }),
  execute: async (data) => {
    console.log('\n--- 🛠️ TOOL EXECUTION STARTED ---');
    const appId = process.env.VONAGE_APPLICATION_ID!;
    const privateKey = process.env.VONAGE_PRIVATE_KEY!;
    const token = tokenGenerate(appId, privateKey);
    console.log('venueTool executing with data:', data);
    
    await fetch(`https://video.api.vonage.com/v2/project/${appId}/session/${data.sessionId}/signal`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'venueModal',
        data: JSON.stringify({ 
          name: 'Norrsken House Barcelona', 
          address: 'Passeig del Mare Nostrum, 15', 
          link: 'https://luma.com/3gswve8n',
          photo: 'https://cdn.prod.website-files.com/65e76a15af207274f46c7f5c/6690ff1caec74652c35248a7_BarcelonaHouse_animation%201.avif'
        })
      })
    });
    return { success: true, message: 'Venue information displayed to users.' };
  }
});