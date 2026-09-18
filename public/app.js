// A hardcoded room name for the hackathon demo
const ROOM_NAME = 'hackbarna-demo';

let currentSessionId = null;
let currentConnectionId = null;
let clearCaptionTimeout;

// DOM Elements
const chatLog = document.getElementById('chat-log');
const aiInput = document.getElementById('ai-input');
const askBtn = document.getElementById('ask-btn');
const startAiBtn = document.getElementById('start-ai-btn');
const stopAiBtn = document.getElementById('stop-ai-btn');

// ==========================================
// Initialize Vonage Video
// ==========================================
async function initializeVideo() {
    try {
        // Fetch credentials from your Express backend
        const res = await fetch(`/api/video/room/${ROOM_NAME}`);
        const { applicationId, sessionId, token } = await res.json();

        currentSessionId = sessionId;
        startAiBtn.disabled = false;

        // Initialize the Vonage session
        const session = OT.initSession(applicationId, sessionId);

        // Subscribe to newly created streams (other participants)
        session.on('streamCreated', (event) => {
            const subscriber = session.subscribe(event.stream, 'subscribers', {
                insertMode: 'append',
                width: '100%',
                height: '100%'
            });
            // Check if the stream belongs to the Mastra AI Agent
            const streamData = event.stream.connection.data;
            if (streamData && streamData.includes('name=AIAgent')) {
                // You can use a URL to an image, or place a logo inside your 'public' folder 
                // e.g., '/mastra-logo.png'
                subscriber.setStyle('backgroundImageURI', 'https://mastra.ai/favicon/new-brand/icon-512.png');
            }
        });

        session.on('signal:venueModal', (event) => {
            const venueData = JSON.parse(event.data);
            console.log('Received venue data:', venueData);

            // Populate the DOM elements
            document.getElementById('venue-name').innerText = venueData.name;
            document.getElementById('venue-address').innerText = venueData.address;
            document.getElementById('venue-link').href = venueData.link;
            document.getElementById('venue-photo').src = venueData.photo;

            // Open the dialog natively (dims the background and centers the modal)
            document.getElementById('venue-modal').showModal();
        });

        session.on('signal:aiCaption', (event) => {
            const payload = JSON.parse(event.data);
            const captionContainer = document.getElementById('caption-container');
            const captionText = document.getElementById('caption-text');

            captionContainer.style.display = 'block';

            captionText.innerHTML = `<span style="color: ${payload.role === 'user' ? '#93c5fd' : '#10b981'};">${payload.role}:</span> ${payload.text}`;

            clearTimeout(clearCaptionTimeout);

            // Calculate dynamic timeout based on word count
            // Split by spaces to get the number of words
            const wordCount = payload.text.trim().split(/\s+/).length;

            // Estimate 400ms per word + a 2-second padding buffer. 
            // Force a minimum of 4 seconds just in case it's a very short response like "Yes."
            const dynamicDisplayTime = Math.max(4000, (wordCount * 400) + 2000);

            // Hide the box after the dynamically calculated time
            clearCaptionTimeout = setTimeout(() => {
                captionContainer.style.display = 'none';
            }, dynamicDisplayTime);
        });


        // Initialize the publisher (your webcam)
        const publisher = OT.initPublisher('publisher', {
            insertMode: 'append',
            width: '100%',
            height: '100%'
        });

        // Connect to the session and publish
        session.connect(token, (error) => {
            if (error) {
                console.error('Failed to connect to Vonage:', error);
            } else {
                console.log('Connected to Vonage session!');
                session.publish(publisher);
            }
        });

    } catch (error) {
        console.error('Error fetching Vonage credentials:', error);
    }
}


async function startAIvoice() {
    if (!currentSessionId) return;

    startAiBtn.innerText = 'Connecting AI...';
    startAiBtn.disabled = true;

    try {
        const res = await fetch('/api/video/audio-connector/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: currentSessionId })
        });

        if (res.ok) {
            const data = await res.json();
            console.log('Audio Connector connected successfully: ', data);


            // The Vonage REST API returns the connection's unique ID in the 'id' field
            currentConnectionId = data.connectionId;

            // Swap the UI buttons
            startAiBtn.style.display = 'none';
            stopAiBtn.style.display = 'inline-block';

            // Reset the start button for later use
            startAiBtn.innerText = 'Connect AI Voice Assistant';
            startAiBtn.disabled = false;
        } else {
            throw new Error('Failed to connect audio');
        }
    } catch (error) {
        console.error(error);
        startAiBtn.innerText = 'Connection Failed';
        startAiBtn.style.background = '#ef4444';
        startAiBtn.disabled = false;
    }

}

async function stopAIvoice() {
    if (!currentSessionId || !currentConnectionId) return;

    stopAiBtn.innerText = 'Disconnecting...';
    stopAiBtn.disabled = true;

    try {
        const res = await fetch('/api/video/audio-connector/disconnect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: currentSessionId,
                connectionId: currentConnectionId
            })
        });

        if (res.ok) {
            console.log('Audio Connector disconnected successfully');
            // Clear the connection state
            currentConnectionId = null;

            // Swap the UI buttons back
            stopAiBtn.style.display = 'none';
            startAiBtn.style.display = 'inline-block';
        } else {
            throw new Error('Failed to disconnect audio');
        }
    } catch (error) {
        console.error(error);
        stopAiBtn.innerText = 'Disconnect Failed';
    } finally {
        stopAiBtn.innerText = 'Disconnect AI';
        stopAiBtn.disabled = false;
    }

}

// ==========================================
// Text Chat with Mastra AI
// ==========================================
async function askAIchat() {
    const prompt = aiInput.value.trim();
    if (!prompt) return;

    // Display user message
    appendMessage(prompt, 'user');
    aiInput.value = '';
    askBtn.innerText = 'Thinking...';
    askBtn.disabled = true;

    try {
        const contextPrompt = `${prompt}\n\n[System Context: The current Vonage Session ID is ${currentSessionId}]`;
        // Send the prompt to the stateless Mastra agent endpoint
        const response = await fetch('/api/agents/agent/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [{ role: 'user', content: contextPrompt }]
            })
        });

        const data = await response.json();

        // Mastra returns the AI response in the data.text field
        appendMessage(data.text, 'ai');

    } catch (error) {
        appendMessage('Error reaching the AI agent.', 'ai');
        console.error(error);
    } finally {
        askBtn.innerText = 'Ask';
        askBtn.disabled = false;
    }
}

// Helper to update the chat UI
function appendMessage(text, sender) {
    const div = document.createElement('div');
    div.className = `message ${sender}`;
    div.innerText = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
}

// Event Listeners
askBtn.addEventListener('click', askAIchat);
aiInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') askAIchat();
});

startAiBtn.addEventListener('click', startAIvoice);
stopAiBtn.addEventListener('click', stopAIvoice);

// Start the video application
initializeVideo();