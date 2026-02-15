import { GoogleGenAI, GenerateContentResponse, Type, FunctionDeclaration } from "@google/genai";
import { Location, GroundingLink } from "./types";

// Initialize lazily to avoid top-level failures
let ai: GoogleGenAI | null = null;

const getAiClient = () => {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
  return ai;
};

// Define map control tools for the AI
export const mapTools: FunctionDeclaration[] = [
  {
    name: 'update_map_view',
    description: 'Adjust the map zoom level or move to a specific coordinate.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        zoom: { type: Type.NUMBER, description: 'Zoom level from 1 (World) to 18 (Street).' },
        latitude: { type: Type.NUMBER, description: 'Target latitude.' },
        longitude: { type: Type.NUMBER, description: 'Target longitude.' }
      }
    }
  },
  {
    name: 'set_map_layer',
    description: 'Change the visual layer of the map.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        layer: { 
          type: Type.STRING, 
          enum: ['standard', 'satellite', 'terrain', 'transit'],
          description: 'The map layer to activate.' 
        }
      },
      required: ['layer']
    }
  },
  {
    name: 'toggle_traffic',
    description: 'Enable or disable the real-time traffic overlay.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        enabled: { type: Type.BOOLEAN }
      },
      required: ['enabled']
    }
  }
];

export const askMaps = async (
  prompt: string,
  location: Location | null,
  history: { role: string; content: string }[] = []
): Promise<{ text: string; links: GroundingLink[]; functionCalls?: any[] }> => {
  try {
    const client = getAiClient();
    
    const contents = history.map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    }));

    contents.push({
      role: 'user',
      parts: [{ text: prompt }]
    });

    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dayName = now.toLocaleDateString([], { weekday: 'long' });

    // Note: We use gemini-2.5-flash for grounding support.
    const config: any = {
      tools: [
        { googleMaps: {} }
      ],
      systemInstruction: `You are 'Ask Maps', a sophisticated AI navigator. 
      Today is ${dayName} and the current local time is ${timeString}. 
      
      Help users discover places, plan multi-stop routes, and explore maps using Google Maps grounding.
      
      Smart Context Awareness:
      - ANALYZE TIME: If the user is planning a trip during meal times (Breakfast: 7-9AM, Lunch: 11AM-2PM, Dinner: 6-9PM), proactively suggest highly-rated restaurant stops along their route.
      - ANALYZE DURATION: If a journey is expected to take more than 2.5 hours, suggest a coffee or rest break mid-way.
      - ANALYZE LOCATION: Use the user's current coordinates as the starting point unless they specify otherwise.
      
      Capabilities:
      - Search for places using Google Maps (Grounding).
      - Plan optimized routes with logical stop orders.
      - IMPORTANT: When providing a route, always include an estimated travel time (e.g., "Total time: 45 mins"), total distance (e.g., "Total distance: 12.5 miles"), and structured turn-by-turn steps.
      
      Interaction Rules:
      1. Suggest relevant stops (meal/rest/fuel) based on ${timeString} and the journey context.
      2. If the user asks to control the map (zoom, layer), explain that you can help find places textually, or they can use Voice Mode for hands-free map control.
      3. If the user explicitly asks to 'display map', 'show map', or 'hide chat', start your response with '[ACTION: SHOW_MAP]' followed by a confirmation message like "Here is the map view."`,
    };

    if (location) {
      config.toolConfig = {
        retrievalConfig: {
          latLng: {
            latitude: location.lat,
            longitude: location.lng
          }
        }
      };
    }

    const response: GenerateContentResponse = await client.models.generateContent({
      model: "gemini-2.5-flash", 
      contents: contents,
      config: config
    });

    const text = response.text || "Searching the map for you...";
    const links: GroundingLink[] = [];
    const functionCalls = response.functionCalls;

    // Extract grounding chunks
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks && Array.isArray(chunks)) {
      chunks.forEach((chunk: any) => {
        if (chunk.maps?.uri) {
          links.push({
            uri: chunk.maps.uri,
            title: chunk.maps.title || "View on Maps"
          });
        }
      });
    }

    return { text, links, functionCalls };
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};