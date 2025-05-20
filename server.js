// server.js
require('dotenv').config();
const fastify = require('fastify')({ logger: true });
const WebSocket = require('ws');
const axios = require('axios');

// Umgebungsvariablen
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const SIPGATE_TOKEN_ID = process.env.SIPGATE_TOKEN_ID;
const SIPGATE_TOKEN = process.env.SIPGATE_TOKEN;
const SIPGATE_CALLER_ID = process.env.SIPGATE_CALLER_ID;
const SERVER_URL = process.env.SERVER_URL;

// Debug-Informationen ausgeben
console.log('===== SERVER STARTUP =====');
console.log('Using sipgate API');
console.log('SIPGATE_TOKEN_ID:', SIPGATE_TOKEN_ID ? 'Set' : 'Not set');
console.log('SIPGATE_TOKEN:', SIPGATE_TOKEN ? 'Set' : 'Not set');
console.log('SIPGATE_CALLER_ID:', SIPGATE_CALLER_ID);
console.log('SERVER_URL:', SERVER_URL);
console.log('========================');

// CORS Headers für Frontend-Zugriff
fastify.register(require('@fastify/cors'), {
  origin: '*' // In Produktion einschränken!
});

// Optional: WebSocket-Support für fortgeschrittene Anwendungsfälle
fastify.register(require('@fastify/websocket'));

// Helper-Funktion für signierte URL (ElevenLabs)
async function getSignedUrl() {
  try {
    const response = await axios.get(
      `https://api.elevenlabs.io/v1/conversation-agents/${ELEVENLABS_AGENT_ID}/signed-url`,
      {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY
        }
      }
    );
    return response.data.signed_url;
  } catch (error) {
    console.error('Error getting signed URL:', error);
    throw error;
  }
}

// Speicher für aktive Anrufe und deren Daten
const activeCallsData = {};

// Endpunkt zum Initiieren eines Anrufs
fastify.post('/outbound-call', async (request, reply) => {
  const { number, prompt, firstMessage } = request.body;
  
  console.log('===== DEBUG INFO =====');
  console.log('Outbound call request received');
  console.log('Number:', number);
  console.log('Using sipgate API directly with axios');
  console.log('SIPGATE_TOKEN_ID:', SIPGATE_TOKEN_ID ? 'Set' : 'Not set');
  console.log('SIPGATE_TOKEN:', SIPGATE_TOKEN ? 'Set' : 'Not set');
  console.log('SIPGATE_CALLER_ID:', SIPGATE_CALLER_ID);
  console.log('=====================');
  
  try {
    console.log(`Initiating call to ${number} with prompt: ${prompt}`);
    
    // Speichere die Anrufdaten für spätere Verwendung
    const callData = {
      prompt,
      firstMessage,
      timestamp: new Date().toISOString()
    };
    
    // Direkte Verwendung der sipgate API über axios für detailliertere Kontrolle
    const response = await axios({
      method: 'POST',
      url: 'https://api.sipgate.com/v2/calls',
      auth: {
        username: SIPGATE_TOKEN_ID,
        password: SIPGATE_TOKEN
      },
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      data: {
        deviceId: 'e0',  // 'e0' ist die Standard-Device-ID für Web-Anrufe
        caller: SIPGATE_CALLER_ID,
        callee: number,
        callerId: SIPGATE_CALLER_ID
      }
    });
    
    console.log('Sipgate API response:', response.data);
    
    const callId = response.data.id;
    activeCallsData[callId] = callData;
    
    return { success: true, callSid: callId };
  } catch (error) {
    console.error('Error initiating call:', error.response?.data || error.message);
    return { success: false, error: error.response?.data?.error || error.message };
  }
});

// Webhook-Handler für sipgate.io-Ereignisse
fastify.post('/outbound-call-webhook', async (request, reply) => {
  try {
    // Verarbeite das Event
    const event = request.body;
    console.log('Received webhook event:', event);
    
    // Extrahiere Anrufdaten aus der URL oder dem Event
    const callId = event.callId || event.id;
    const prompt = request.query.prompt;
    const firstMessage = request.query.firstMessage;
    
    // Wenn keine callId gefunden wurde, fehlerhafte Anfrage
    if (!callId) {
      console.error('No call ID found in webhook event');
      return { success: false, error: 'No call ID in event' };
    }
    
    // Füge Daten aus der URL zu den Anrufdaten hinzu, falls sie nicht bereits existieren
    if (prompt && firstMessage && !activeCallsData[callId]) {
      activeCallsData[callId] = {
        prompt: decodeURIComponent(prompt),
        firstMessage: decodeURIComponent(firstMessage),
        timestamp: new Date().toISOString()
      };
    }
    
    // Verarbeite verschiedene Event-Typen
    if (event.event === 'answer' || event.state === 'ANSWERED') {
      // Anruf wurde beantwortet
      console.log(`Call ${callId} was answered`);
      
      // Hole die gespeicherten Anrufdaten
      const callData = activeCallsData[callId];
      if (!callData) {
        console.error(`No call data found for call ID: ${callId}`);
        return { success: false, error: 'Call data not found' };
      }
      
      // In einer vollständigen Implementation würdest du hier die ElevenLabs-Integration hinzufügen
      console.log(`Would play message: "${callData.firstMessage}"`);
      
      return { success: true, message: 'Call answered' };
      
    } else if (event.event === 'hangup' || event.state === 'DISCONNECTED') {
      // Anruf wurde beendet
      console.log(`Call ${callId} ended`);
      
      // Lösche die Anrufdaten aus dem Speicher
      delete activeCallsData[callId];
      
      return { success: true, message: 'Call ended' };
    }
    
    // Standard-Antwort für andere Events
    return { success: true, message: 'Event received' };
  } catch (error) {
    console.error('Error processing webhook:', error);
    return { success: false, error: error.message };
  }
});

// Debug-Endpunkt, um zu überprüfen ob der Server läuft und welche API verwendet wird
fastify.get('/debug', async () => {
  return { 
    version: "sipgate",
    timestamp: new Date().toISOString(),
    usingTwilio: false,
    usingSipgate: true,
    sipgateCallerIdConfigured: !!SIPGATE_CALLER_ID,
    serverUrl: SERVER_URL
  };
});

// Healthcheck-Endpunkt
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Server starten
const start = async () => {
  try {
    await fastify.listen({ port: 8765, host: '0.0.0.0' });
    console.log(`Server running at ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

