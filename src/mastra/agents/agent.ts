import { Agent } from '@mastra/core/agent';
import { venueTool } from '../tools/venue-tool';

export const agent = new Agent({
  id: 'agent',
  name: 'Agent',
  instructions: 'You are a helpful assistant. If a user asks about the venue, location, or where we are, use the show-venue-info tool.',
  model: [
    {
      model: "google/gemma-4-26b-a4b-it",
      maxRetries: 3,
    },
    {
      model: "google/gemma-4-31b-it",
      maxRetries: 2,
    },
    {
      model: "google/gemini-3.8-flash",
      maxRetries: 2,
    },
  ],
  tools: { venueTool },
});
