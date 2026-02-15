
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Search, Navigation, Map as MapIcon, Layers, Mic, Send, Star, Clock, 
  ExternalLink, ChevronUp, ChevronDown, X, MicOff, Car, MapPin, Info, 
  Route, Train, Mountain, Image as ImageIcon, Check, Heart, Coffee, 
  Utensils, Palette, Plus, Minus, MessageSquare, Waves, ArrowRight, 
  ArrowUp, RotateCcw, ArrowUpRight, ArrowUpLeft, Settings, ShieldAlert, 
  Phone, Globe
} from 'lucide-react';
import { GoogleGenAI, Modality } from '@google/genai';
import { MapContainer, TileLayer, Marker, Popup, useMap, ZoomControl } from 'react-leaflet';
import L from 'leaflet';

import { askMaps, mapTools } from './geminiService';
import { Message, Location, GroundingLink, RouteStep } from './types';

// --- LEAFLET ICON FIX ---
// Leaflet icons don't bundle well by default in some environments.
const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});
L.Marker.prototype.options.icon = DefaultIcon;

// Helper for Base64 (Standard implementation for Live API)
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

type MapLayer = 'standard' | 'satellite' | 'terrain' | 'transit';
type MarkerIconType = 'pin' | 'heart' | 'star' | 'coffee' | 'utensils';

interface MapMarker extends GroundingLink {
  id: string;
  lat: number;
  lng: number;
  rating: number;
  stopNumber?: number;
  photoUrl?: string;
  hours?: string;
  address?: string;
  phone?: string;
  website?: string;
  reviewCount?: number;
  color?: string;
  iconType?: MarkerIconType;
}

const MARKER_COLORS = [
  { name: 'Red', class: 'bg-red-500' },
  { name: 'Blue', class: 'bg-blue-500' },
  { name: 'Green', class: 'bg-green-500' },
  { name: 'Purple', class: 'bg-purple-500' },
  { name: 'Yellow', class: 'bg-yellow-500' },
  { name: 'Orange', class: 'bg-orange-500' },
];

const MARKER_ICONS = [
  { type: 'pin', icon: MapPin },
  { type: 'heart', icon: Heart },
  { type: 'star', icon: Star },
  { type: 'coffee', icon: Coffee },
  { type: 'utensils', icon: Utensils },
];

// --- MAP CONTROLLER ---
// Component to handle programmatic map moves via React props
const MapController = ({ center, zoom }: { center: Location, zoom: number }) => {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], zoom, {
      animate: true,
      duration: 1.5
    });
  }, [center, zoom, map]);
  return null;
};

// --- CUSTOM MARKER ICONS ---
const createCustomIcon = (color: string, iconType: MarkerIconType, isSelected: boolean, stopNumber?: number) => {
  // We use Leaflet DivIcon to render Tailwind classes
  const colorClass = color || 'bg-blue-600';
  const size = isSelected ? 'w-10 h-10' : 'w-8 h-8';
  const ring = isSelected ? 'ring-4 ring-white' : 'border-2 border-white';
  
  let svgContent = '';
  // Provide raw SVG paths for Leaflet HTML string
  switch (iconType) {
    case 'heart':
      svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg>`;
      break;
    case 'star':
      svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>`;
      break;
    case 'coffee':
      svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1" /><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" /><line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" /></svg>`;
      break;
    case 'utensils':
      svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" /><path d="M7 2v20" /><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" /></svg>`;
      break;
    default: // pin
      svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`;
      break;
  }

  const html = `
    <div class="relative flex items-center justify-center transform -translate-x-1/2 -translate-y-full transition-all duration-300 ${isSelected ? 'scale-110 z-50' : 'hover:scale-110 z-10'}">
      <div class="${size} rounded-full ${colorClass} shadow-xl ${ring} flex items-center justify-center text-white">
        ${stopNumber 
          ? `<span class="font-bold text-sm">${stopNumber}</span>` 
          : svgContent
        }
      </div>
      <div class="absolute bottom-0 translate-y-1 w-2 h-2 bg-black/20 blur-sm rounded-full"></div>
    </div>
  `;
  
  return L.divIcon({
    className: 'bg-transparent',
    html: html,
    iconSize: [0, 0], // Handled by CSS
    iconAnchor: [0, 0]
  });
};

const LeafletMap = ({ 
  showTraffic, 
  markers, 
  activeLayer, 
  zoom, 
  center,
  onMarkerClick,
  onMarkerUpdate,
  isDrivingMode
}: { 
  showTraffic: boolean, 
  markers: MapMarker[], 
  activeLayer: MapLayer, 
  zoom: number, 
  center: Location,
  onMarkerClick: (marker: MapMarker) => void,
  onMarkerUpdate: (id: string, updates: Partial<MapMarker>) => void,
  isDrivingMode: boolean
}) => {
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [showStylePicker, setShowStylePicker] = useState(false);

  // Reset style picker when marker changes
  useEffect(() => {
    setShowStylePicker(false);
  }, [selectedMarkerId]);

  // Map Layer URLs
  const layers = {
    standard: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    terrain: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    transit: 'https://{s}.tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=your_api_key_here' // Fallback to OSM usually if no key
  };
  
  // Use OSM for transit fallback if needed, or specific transit layer
  const tileUrl = activeLayer === 'satellite' ? layers.satellite : 
                  activeLayer === 'terrain' ? layers.terrain : 
                  layers.standard;

  const selectedMarker = markers.find(m => m.id === selectedMarkerId);

  return (
    <div className="fixed inset-0 z-0 w-full h-full bg-slate-100">
      <MapContainer 
        center={[center.lat, center.lng]} 
        zoom={zoom} 
        zoomControl={false}
        className="w-full h-full"
        style={{ background: '#f1f5f9' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={tileUrl}
          maxZoom={19}
        />
        
        <MapController center={center} zoom={zoom} />
        
        {markers.map(marker => (
          <Marker 
            key={marker.id} 
            position={[marker.lat, marker.lng]}
            icon={createCustomIcon(marker.color || 'bg-blue-600', marker.iconType || 'pin', selectedMarkerId === marker.id, marker.stopNumber)}
            eventHandlers={{
              click: () => {
                setSelectedMarkerId(marker.id);
                onMarkerClick(marker);
              }
            }}
          />
        ))}

        {/* Route Polyline (Simulated by drawing between markers if stopNumbers exist) */}
        {/* Note: In a real app we would use a routing API to get the geometry */}
      </MapContainer>

      {/* Traffic Overlay (Simulation) */}
      {showTraffic && (
        <div className="absolute inset-0 pointer-events-none z-[400] opacity-60 mix-blend-multiply">
           {/* We can't easily overlay real traffic without a paid API, so we use a visual effect to simulate 'traffic mode' being active */}
           <div className="w-full h-full bg-gradient-to-t from-red-500/10 via-transparent to-transparent" />
        </div>
      )}

      {/* Selected Marker Card */}
      {selectedMarker && !isDrivingMode && (
        <div className="absolute z-[1000] bottom-24 md:bottom-12 left-1/2 -translate-x-1/2 w-[300px] md:w-[350px] animate-in slide-in-from-bottom-8">
          <div className="bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100 flex flex-col">
             <div className="h-32 w-full bg-gray-100 relative">
               <img src={selectedMarker.photoUrl} className="w-full h-full object-cover" alt="" />
               <button onClick={() => setSelectedMarkerId(null)} className="absolute top-2 right-2 p-2 bg-black/30 hover:bg-black/50 text-white rounded-full backdrop-blur-sm transition-colors z-10"><X className="w-4 h-4" /></button>
               <div className="absolute bottom-0 inset-x-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" />
               <div className="absolute bottom-3 left-4 text-white font-bold">{selectedMarker.title}</div>
             </div>
             <div className="p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-900">{selectedMarker.rating.toFixed(1)}</span>
                  <div className="flex text-orange-400">
                    {[...Array(5)].map((_, i) => (<Star key={i} className={`w-3.5 h-3.5 ${i < Math.floor(selectedMarker.rating) ? 'fill-current' : ''}`} />))}
                  </div>
                  <span className="text-xs text-gray-400">({selectedMarker.reviewCount})</span>
                </div>
                <div className="space-y-2.5">
                  <div className="flex items-center gap-3 text-xs text-gray-600">
                    <Clock className="w-4 h-4 shrink-0" />
                    <span className={selectedMarker.hours?.includes('Open') ? 'text-green-600 font-semibold' : 'text-red-500'}>{selectedMarker.hours}</span>
                  </div>
                  {selectedMarker.address && (
                    <div className="flex items-start gap-3 text-xs text-gray-600">
                      <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{selectedMarker.address}</span>
                    </div>
                  )}
                  {selectedMarker.phone && (
                    <div className="flex items-center gap-3 text-xs text-gray-600">
                      <Phone className="w-4 h-4 shrink-0" />
                      <span>{selectedMarker.phone}</span>
                    </div>
                  )}
                  {selectedMarker.website && (
                    <div className="flex items-center gap-3 text-xs text-gray-600 truncate">
                      <Globe className="w-4 h-4 shrink-0" />
                      <a href={selectedMarker.website} target="_blank" className="text-blue-600 hover:underline truncate">{selectedMarker.website}</a>
                    </div>
                  )}
                </div>
                
                <div className="flex gap-2 pt-2">
                   <a href={selectedMarker.uri} target="_blank" className="flex-1 bg-blue-600 text-white text-sm font-bold py-2.5 rounded-2xl text-center hover:bg-blue-700 shadow-lg shadow-blue-500/20">Directions</a>
                   <button onClick={() => setShowStylePicker(!showStylePicker)} className={`p-2.5 rounded-2xl transition-all ${showStylePicker ? 'bg-blue-100 text-blue-600' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}><Palette className="w-5 h-5" /></button>
                </div>

                {showStylePicker && (
                  <div className="mt-2 pt-4 border-t border-gray-100 flex flex-col gap-3 animate-in fade-in">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Icon Style</p>
                    <div className="flex flex-wrap gap-2">
                      {MARKER_ICONS.map(i => (
                        <button 
                          key={i.type} 
                          onClick={() => onMarkerUpdate(selectedMarker.id, {iconType: i.type as any})} 
                          className={`p-2 rounded-xl transition-all ${selectedMarker.iconType === i.type ? 'bg-blue-100 text-blue-600 ring-2 ring-blue-500/20' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                        >
                          <i.icon className="w-4 h-4" />
                        </button>
                      ))}
                    </div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-1">Color</p>
                    <div className="flex flex-wrap gap-2">
                      {MARKER_COLORS.map(c => (
                        <button 
                          key={c.name} 
                          onClick={() => onMarkerUpdate(selectedMarker.id, {color: c.class})} 
                          className={`w-6 h-6 rounded-full ${c.class} border-2 transition-all ${selectedMarker.color === c.class ? 'border-gray-900 scale-110' : 'border-transparent hover:scale-110'}`} 
                        />
                      ))}
                    </div>
                  </div>
                )}
             </div>
          </div>
        </div>
      )}

      {/* Center Reticle */}
      {isDrivingMode && (
         <div className="absolute left-1/2 top-[60%] -translate-x-1/2 -translate-y-1/2 w-8 h-8 z-[500] pointer-events-none">
            <div className="w-full h-full bg-blue-600 rounded-full border-[3px] border-white shadow-xl animate-pulse ring-4 ring-blue-500/30" />
         </div>
      )}
    </div>
  );
};

const NavigationTopBar = ({ currentStep }: { currentStep: RouteStep }) => {
  const getStepIcon = (instruction: string, size: string = "w-8 h-8") => {
    const text = instruction.toLowerCase();
    if (text.includes('left')) return <ArrowUpLeft className={`${size} text-white`} />;
    if (text.includes('right')) return <ArrowUpRight className={`${size} text-white`} />;
    if (text.includes('u-turn')) return <RotateCcw className={`${size} text-white`} />;
    if (text.includes('arrive') || text.includes('destination')) return <MapPin className={`${size} text-white`} />;
    return <ArrowUp className={`${size} text-white`} />;
  };

  return (
    <div className="fixed top-0 inset-x-0 z-[500] p-4 pt-4 md:pt-4 pointer-events-none flex flex-col items-center gap-2">
       {/* Safe Warning Overlay */}
       <div className="bg-black/60 backdrop-blur-md text-white/90 text-[10px] font-bold px-4 py-1.5 rounded-full uppercase tracking-widest shadow-lg border border-white/10 flex items-center gap-2">
          <ShieldAlert className="w-3 h-3 text-red-400" />
          <span>Eyes on the road • Voice mode active</span>
       </div>
       
       {/* Main Turn Card */}
       <div className="bg-[#0F9D58] w-full max-w-xl rounded-2xl shadow-2xl p-4 flex items-center gap-5 text-white pointer-events-auto border-[3px] border-white/20 animate-in slide-in-from-top-4 duration-500">
          <div className="p-4 bg-black/10 rounded-xl border border-white/10 shrink-0">
              {getStepIcon(currentStep.instruction, "w-10 h-10")}
          </div>
          <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                   <span className="text-4xl font-black tracking-tighter">{currentStep.distance || "0.5 mi"}</span>
              </div>
              <p className="text-xl font-bold leading-tight truncate mt-1">{currentStep.instruction}</p>
          </div>
       </div>
    </div>
  );
};

const RouteDirections: React.FC<{ stops: string[], steps: RouteStep[], duration?: string, distance?: string, isDrivingMode?: boolean }> = ({ stops, steps, duration, distance, isDrivingMode }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStepIcon = (instruction: string, size: string = "w-4 h-4") => {
    const text = instruction.toLowerCase();
    if (text.includes('left')) return <ArrowUpLeft className={`${size} text-blue-500`} />;
    if (text.includes('right')) return <ArrowUpRight className={`${size} text-blue-500`} />;
    if (text.includes('u-turn')) return <RotateCcw className={`${size} text-blue-500`} />;
    if (text.includes('arrive') || text.includes('destination')) return <MapPin className={`${size} text-green-500`} />;
    return <ArrowUp className={`${size} text-blue-500`} />;
  };

  if (isDrivingMode) {
    // Driving Mode: Trip Summary Footer (replaces the big turn card)
    return (
      <div className="animate-in slide-in-from-bottom-4 duration-500 w-full md:max-w-3xl md:mx-auto mb-2 pointer-events-auto">
        <div className="bg-gray-800/90 backdrop-blur-xl rounded-[24px] border border-gray-700/50 p-5 flex items-center justify-between shadow-2xl">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-500/20 text-green-400 rounded-2xl shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-white tracking-tight">{duration || "--"}</span>
                <span className="text-sm font-bold text-gray-400">remaining</span>
              </div>
              <p className="text-sm font-medium text-gray-500">{distance} • {stops.length} stops</p>
            </div>
          </div>
          <div className="h-10 w-px bg-white/10 mx-2 hidden sm:block"></div>
          <div className="text-right hidden sm:block">
             <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Arrival</span>
             <p className="text-lg font-bold text-white">12:42 PM</p>
          </div>
        </div>
      </div>
    );
  }

  // Standard Plan Mode: Collapsible List
  return (
    <div className="mt-4 bg-white border border-blue-100 rounded-3xl overflow-hidden shadow-sm">
      <div className="bg-blue-50/50 p-4 flex items-center justify-between cursor-pointer active:bg-blue-100/50 transition-colors" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-xl text-white">
            <Route className="w-5 h-5" />
          </div>
          <div>
            <span className="text-sm font-bold text-gray-900">Planned Route</span>
            <div className="flex items-center gap-2 text-[11px] text-blue-600 font-bold uppercase tracking-wider">
              <span>{stops.length} stops</span>
              {/* Keeping header summary concise for collapsed state */}
              {(duration || distance) && (
                <>
                  <span className="w-1 h-1 bg-blue-300 rounded-full" />
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> 
                    {duration}
                    {duration && distance && " • "}
                    {distance}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        {isExpanded ? <ChevronUp className="w-5 h-5 text-blue-400" /> : <ChevronDown className="w-5 h-5 text-blue-400" />}
      </div>
      
      {/* Collapsible Content */}
      <div className={`transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'}`}>
         <div className="p-4 space-y-4">
            {/* Detailed Route Summary Block */}
            {(duration || distance) && (
              <div className="flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-4 border border-blue-100/50">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-blue-400 font-black uppercase tracking-widest">Est. Duration</span>
                  <div className="flex items-center gap-2 text-blue-900">
                    <Clock className="w-4 h-4 text-blue-500" />
                    <span className="text-lg font-black tracking-tight">{duration || "--"}</span>
                  </div>
                </div>
                <div className="w-px h-8 bg-blue-200/50" />
                <div className="flex flex-col gap-1 text-right">
                  <span className="text-[10px] text-blue-400 font-black uppercase tracking-widest">Total Distance</span>
                  <div className="flex items-center justify-end gap-2 text-blue-900">
                    <span className="text-lg font-black tracking-tight">{distance || "--"}</span>
                    <MapPin className="w-4 h-4 text-blue-500" />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {stops.map((stop, i) => (
                <div key={i} className="flex items-center gap-3 text-sm text-gray-700">
                  <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 shadow-sm">{i + 1}</div>
                  <span className="font-semibold truncate">{stop}</span>
                </div>
              ))}
            </div>

            {steps.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100 animate-in slide-in-from-top-2">
                <h5 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-4">Driving Directions</h5>
                <div className="space-y-4">
                  {steps.map((step, i) => (
                    <div key={i} className="flex gap-4">
                      <div className="flex flex-col items-center shrink-0">
                        <div className="p-1.5 bg-blue-50 rounded-lg">
                          {getStepIcon(step.instruction)}
                        </div>
                        {i < steps.length - 1 && <div className="w-0.5 flex-1 bg-gray-100 my-1" />}
                      </div>
                      <div className="flex-1 pt-0.5">
                        <p className="text-[13px] text-gray-800 leading-snug font-medium">{step.instruction}</p>
                        {step.distance && <p className="text-[11px] text-gray-400 font-bold mt-1 uppercase">{step.distance}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
         </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isDrivingMode, setIsDrivingMode] = useState(false);
  const [userLocation, setUserLocation] = useState<Location>({ lat: 37.7749, lng: -122.4194 }); // Default SF
  const [isProcessing, setIsProcessing] = useState(false);
  const [showTraffic, setShowTraffic] = useState(false);
  const [activeLayer, setActiveLayer] = useState<MapLayer>('standard');
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [activeMarkers, setActiveMarkers] = useState<MapMarker[]>([]);
  
  // Map State
  const [zoom, setZoom] = useState(13);
  const [mapCenter, setMapCenter] = useState<Location>({ lat: 37.7749, lng: -122.4194 });
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sessionPromiseRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLocation(loc);
          setMapCenter(loc);
        },
        (err) => console.warn("Geolocation denied, using default", err)
      );
    }
  }, []);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  const executeFunctionCall = (fc: any) => {
    if (fc.name === 'set_map_layer') setActiveLayer(fc.args.layer);
    if (fc.name === 'toggle_traffic') setShowTraffic(fc.args.enabled);
    if (fc.name === 'update_map_view') {
      if (fc.args.zoom) setZoom(fc.args.zoom);
      if (fc.args.latitude && fc.args.longitude) {
        setMapCenter({ lat: fc.args.latitude, lng: fc.args.longitude });
      }
    }
    return "UI updated successfully.";
  };

  const parseRouteData = (text: string, links: GroundingLink[]) => {
    const durationMatch = text.match(/(?:Total time|Duration|Estimated time):\s*([\w\s]+?)(?:\.|\n|$)/i);
    const duration = durationMatch ? durationMatch[1].trim() : undefined;
    const distanceMatch = text.match(/(?:Total distance|Distance):\s*([\w\s\.]+?)(?:\.|\n|$)/i);
    const distance = distanceMatch ? distanceMatch[1].trim() : undefined;

    const steps: RouteStep[] = [];
    const stepMatches = text.matchAll(/^\d+\.\s+(.+)$/gm);
    for (const match of stepMatches) {
      const instruction = match[1];
      const distMatch = instruction.match(/\(([\d.]+\s*\w+)\)/);
      steps.push({
        instruction: instruction.replace(/\([\d.]+\s*\w+\)/, '').trim(),
        distance: distMatch ? distMatch[1] : undefined
      });
    }
    if (steps.length > 0 || links.length >= 2) {
      return { stops: links.map(l => l.title), steps: steps, duration: duration, distance: distance };
    }
    return undefined;
  };

  const handleSend = async (textToSend?: string) => {
    const finalInput = textToSend || input;
    if (!finalInput.trim() || isProcessing) return;
    setMessages(prev => [...prev, { role: 'user', content: finalInput }]);
    setInput('');
    setIsChatOpen(true);
    setIsProcessing(true);
    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const { text, links, functionCalls } = await askMaps(finalInput, userLocation, history);
      
      let displayText = text;
      if (text.includes('[ACTION: SHOW_MAP]')) {
        setIsChatOpen(false);
        displayText = text.replace('[ACTION: SHOW_MAP]', '').trim();
      }

      if (functionCalls) functionCalls.forEach(executeFunctionCall);
      const routeData = parseRouteData(text, links);
      
      if (links && links.length > 0) {
        // Generate pseudo-coordinates around the map center for grounding links 
        // (Since grounding sometimes only gives URIs without lat/lng in the basic response)
        const newMarkers: MapMarker[] = links.map((link, i) => {
          const stopIdx = routeData?.stops.indexOf(link.title);
          // Random offset around current center ~1-3km
          const offsetLat = (Math.random() - 0.5) * 0.04; 
          const offsetLng = (Math.random() - 0.5) * 0.04;
          
          return {
            ...link, 
            id: `marker-${Date.now()}-${i}`, 
            lat: mapCenter.lat + offsetLat,
            lng: mapCenter.lng + offsetLng,
            rating: 4 + Math.random(), 
            reviewCount: Math.floor(Math.random() * 1500) + 100,
            photoUrl: `https://picsum.photos/seed/${encodeURIComponent(link.title)}/400/250`,
            hours: "Open · Closes 9 PM", 
            address: `${Math.floor(Math.random() * 9999)} Mockingbird Lane, Mapview, MV 90210`,
            phone: `+1 (555) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`,
            website: `https://www.${link.title.toLowerCase().replace(/\s+/g, '')}.com`,
            color: 'bg-red-500', 
            iconType: 'pin',
            stopNumber: stopIdx !== undefined && stopIdx !== -1 ? stopIdx + 1 : undefined,
          };
        });
        setActiveMarkers(prev => [...prev, ...newMarkers]);
      }
      setMessages(prev => [...prev, { role: 'assistant', content: displayText, links, route: routeData }]);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: "Something went wrong. Let's try again." }]);
    } finally { setIsProcessing(false); }
  };

  const startVoiceMode = async () => {
    setIsVoiceMode(true);
    setIsChatOpen(true);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
    const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 16000});
    const outputCtx = audioContextRef.current;
    let nextStartTime = 0;
    const sources = new Set<AudioBufferSourceNode>();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    sessionPromiseRef.current = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => {
          const source = inputCtx.createMediaStreamSource(stream);
          const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
          scriptProcessor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const l = inputData.length;
            const int16 = new Int16Array(l);
            for (let i = 0; i < l; i++) int16[i] = inputData[i] * 32768;
            sessionPromiseRef.current?.then((session: any) => {
              session.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } });
            });
          };
          source.connect(scriptProcessor);
          scriptProcessor.connect(inputCtx.destination);
        },
        onmessage: async (msg: any) => {
          const base64Audio = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (base64Audio) {
            nextStartTime = Math.max(nextStartTime, outputCtx.currentTime);
            const audioBuffer = await decodeAudioData(decode(base64Audio), outputCtx, 24000, 1);
            const source = outputCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(outputCtx.destination);
            source.start(nextStartTime);
            nextStartTime += audioBuffer.duration;
            sources.add(source);
          }
          if (msg.serverContent?.interrupted) {
            sources.forEach(s => s.stop());
            sources.clear();
            nextStartTime = 0;
          }
          if (msg.toolCall) {
            for (const fc of msg.toolCall.functionCalls) {
              const res = executeFunctionCall(fc);
              sessionPromiseRef.current?.then((s: any) => s.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name, response: { result: res } }] }));
            }
          }
        },
        onclose: () => setIsVoiceMode(false),
        onerror: (e) => console.error('Live Error:', e)
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        tools: [{ functionDeclarations: mapTools }],
        systemInstruction: "You are the voice of 'Ask Maps'. You can see the map through tool calls. Respond naturally and help the user navigate hands-free."
      }
    });
  };

  const stopVoiceMode = () => {
    sessionPromiseRef.current?.then((s: any) => s.close());
    setIsVoiceMode(false);
  };

  const toggleDrivingMode = () => {
    const nextState = !isDrivingMode;
    setIsDrivingMode(nextState);
    if (nextState) {
      setIsChatOpen(true);
      setShowTraffic(true);
      setZoom(17); // Closer zoom for driving
      if (!isVoiceMode) startVoiceMode();
    } else {
      setZoom(13); // Reset zoom
      stopVoiceMode();
    }
  };

  const activeRoute = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].route) return messages[i].route;
    }
    return null;
  }, [messages]);

  return (
    <div className={`relative h-screen w-full flex flex-col overflow-hidden transition-colors duration-1000 ${isDrivingMode ? 'bg-[#1a1c1e]' : 'bg-gray-50'}`}>
      <LeafletMap 
        showTraffic={showTraffic} 
        markers={activeMarkers} 
        activeLayer={activeLayer} 
        zoom={zoom} 
        center={mapCenter}
        onMarkerClick={() => {}} 
        onMarkerUpdate={(id, up) => setActiveMarkers(prev => prev.map(m => m.id === id ? { ...m, ...up } : m))} 
        isDrivingMode={isDrivingMode}
      />

      {/* Top Search Bar - Hidden in Driving Mode */}
      {!isDrivingMode && (
        <div className="fixed top-0 left-0 right-0 z-[500] px-4 pt-4 flex gap-2 max-w-2xl mx-auto w-full pointer-events-none">
          <div className="flex-1 bg-white/95 backdrop-blur-md shadow-xl rounded-2xl px-4 py-3 flex items-center gap-3 border border-white focus-within:ring-4 focus-within:ring-blue-500/10 transition-all pointer-events-auto">
            <Search className="w-5 h-5 text-gray-400" />
            <input 
              type="text" 
              placeholder="Plan a route or ask a question..." 
              className="flex-1 outline-none bg-transparent font-medium" 
              value={input} 
              onChange={(e) => setInput(e.target.value)} 
              onKeyDown={(e) => e.key === 'Enter' && handleSend()} 
            />
            <button onClick={isVoiceMode ? stopVoiceMode : startVoiceMode} className={`p-2 rounded-xl transition-all ${isVoiceMode ? 'bg-blue-600 text-white animate-pulse' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}>
              <Waves className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Driving Mode Top Bar */}
      {isDrivingMode && activeRoute && (
         <NavigationTopBar 
            currentStep={activeRoute.steps[0] || { instruction: "Head to destination", distance: "0 mi" }} 
         />
      )}

      {/* Floating Side Tools */}
      <div className={`fixed right-4 z-[400] flex flex-col gap-3 transition-all duration-700 ${isDrivingMode ? 'top-12' : 'top-1/2 -translate-y-1/2'}`}>
        {!isDrivingMode && (
          <div className="flex flex-col gap-1 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-white overflow-hidden">
            <button onClick={() => setZoom(Math.min(zoom + 1, 18))} className="p-3.5 hover:bg-gray-50 text-gray-600 border-b border-gray-100"><Plus className="w-5 h-5" /></button>
            <button onClick={() => setZoom(Math.max(zoom - 1, 2))} className="p-3.5 hover:bg-gray-50 text-gray-600"><Minus className="w-5 h-5" /></button>
          </div>
        )}
        
        <button 
          onClick={toggleDrivingMode} 
          className={`p-4 rounded-3xl shadow-2xl border-2 transition-all duration-500 flex items-center justify-center ${isDrivingMode ? 'bg-red-600 text-white border-white' : 'bg-white/95 text-blue-600 border-transparent hover:scale-110'}`}
          title={isDrivingMode ? "Exit Driving Mode" : "Enter Driving Mode"}
        >
          {isDrivingMode ? <X className="w-7 h-7" /> : <Car className="w-6 h-6" />}
        </button>

        {!isDrivingMode && (
          <>
            <div className="relative">
              <button 
                onClick={() => setShowLayerMenu(!showLayerMenu)} 
                className={`p-3.5 rounded-2xl shadow-xl border border-white transition-all ${showLayerMenu || activeLayer !== 'standard' ? 'bg-blue-600 text-white' : 'bg-white/95 text-gray-600'}`}
                title="Map Layers"
              >
                <Layers className="w-5 h-5" />
              </button>
              
              {showLayerMenu && (
                <div className="absolute right-full top-0 mr-3 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-white p-2 flex flex-col gap-1 min-w-[140px] animate-in fade-in slide-in-from-right-4 z-50">
                  {(['standard', 'satellite', 'terrain', 'transit'] as const).map((layer) => (
                    <button
                      key={layer}
                      onClick={() => { setActiveLayer(layer); setShowLayerMenu(false); }}
                      className={`px-3 py-2.5 rounded-xl text-left text-sm font-bold flex items-center justify-between transition-all ${activeLayer === layer ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      <span className="capitalize">{layer}</span>
                      {activeLayer === layer && <Check className="w-4 h-4" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button onClick={() => setShowTraffic(!showTraffic)} className={`p-3.5 rounded-2xl shadow-xl border border-white transition-all ${showTraffic ? 'bg-blue-600 text-white' : 'bg-white/95 text-gray-600'}`}>
              <Car className="w-5 h-5" />
            </button>
            <button onClick={() => setIsChatOpen(!isChatOpen)} className={`p-3.5 rounded-2xl shadow-xl border border-white bg-white/95 text-blue-600 md:hidden`}>
              <MessageSquare className="w-5 h-5" />
            </button>
            <button onClick={() => setIsChatOpen(!isChatOpen)} className={`p-3.5 rounded-2xl shadow-xl border border-white bg-white/95 text-blue-600 hidden md:flex`}>
              {isChatOpen ? <X className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
            </button>
          </>
        )}
      </div>

      {/* Main UI / Bottom Sheet / Sidebar */}
      <div className={`fixed z-[1000] bg-white shadow-2xl transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden flex flex-col
        ${isDrivingMode 
          ? 'inset-x-0 bottom-0 h-[45vh] md:h-[40vh] md:max-w-3xl md:mx-auto md:rounded-t-[32px] md:bottom-0 bg-transparent shadow-none border-none pointer-events-none'
          : `
             inset-x-0 bottom-0 rounded-t-[32px] border-t border-gray-100
             ${isChatOpen ? 'h-[85vh]' : 'h-16'}
             md:inset-auto md:top-24 md:bottom-8 md:left-6 md:w-[420px] md:h-auto md:rounded-[32px] md:border md:border-gray-200
             ${!isChatOpen ? 'md:opacity-0 md:-translate-x-full md:pointer-events-none' : 'md:opacity-100 md:translate-x-0'}
            `
        }
      `}>
        
        {/* Driving Mode Main Layout */}
        {isDrivingMode ? (
          <div className="h-full px-6 flex flex-col justify-end pb-8 md:pb-12 gap-4 pointer-events-auto">
             {activeRoute && <RouteDirections stops={activeRoute.stops} steps={activeRoute.steps} duration={activeRoute.duration} distance={activeRoute.distance} isDrivingMode={true} />}
             <div className="flex gap-4 w-full md:max-w-3xl md:mx-auto">
                <button 
                  onClick={isVoiceMode ? stopVoiceMode : startVoiceMode}
                  className={`flex-1 h-20 md:h-24 rounded-[32px] flex items-center justify-center gap-4 shadow-2xl border-4 transition-all active:scale-95 ${isVoiceMode ? 'bg-blue-600 text-white border-white animate-pulse' : 'bg-white text-blue-600 border-blue-100'}`}
                >
                  <Waves className="w-10 h-10 md:w-12 md:h-12" />
                  <span className="text-2xl md:text-3xl font-black uppercase tracking-tight">Tap to Speak</span>
                </button>
                <button 
                  onClick={() => handleSend("Where is the nearest gas station?")}
                  className="w-20 h-20 md:w-24 md:h-24 bg-white rounded-[32px] flex items-center justify-center border-4 border-gray-100 shadow-2xl active:scale-95"
                >
                  <Coffee className="w-8 h-8 md:w-10 md:h-10 text-gray-600" />
                </button>
             </div>
          </div>
        ) : (
          <>
            <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mt-3 mb-1 shrink-0 md:hidden" onClick={() => setIsChatOpen(!isChatOpen)} />
            <div className="flex items-center justify-between px-6 py-4 cursor-pointer md:cursor-default" onClick={() => setIsChatOpen(!isChatOpen)}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                  <Navigation className="w-6 h-6" />
                </div>
                <span className="font-bold text-xl text-gray-900 tracking-tight">Ask Maps</span>
              </div>
              {isChatOpen && (
                <button onClick={(e) => { e.stopPropagation(); setMessages([]); setIsChatOpen(false); setInput(''); setActiveMarkers([]); stopVoiceMode(); }} className="p-2 hover:bg-gray-100 rounded-full transition-colors md:hidden">
                  <X className="w-6 h-6 text-gray-400" />
                </button>
              )}
            </div>

            <div className={`flex flex-col h-full overflow-hidden ${!isChatOpen ? 'hidden md:flex' : 'block'}`}>
              {isVoiceMode && (
                <div className="absolute inset-x-0 top-[80px] bottom-0 bg-blue-600/5 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-300 rounded-b-[32px]">
                   <div className="relative mb-12">
                     <div className="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-20" />
                     <div className="relative w-24 h-24 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-2xl">
                       <Waves className="w-10 h-10" />
                     </div>
                   </div>
                   <h3 className="text-2xl font-bold text-blue-700 mb-2">Speak Now</h3>
                   <p className="text-gray-500 max-w-[200px]">Ask about places, traffic, or tell me where to go next.</p>
                   <button onClick={stopVoiceMode} className="mt-auto mb-12 px-8 py-3 bg-red-500 text-white rounded-full font-bold shadow-lg hover:bg-red-600 transition-colors">End Session</button>
                </div>
              )}

              <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar space-y-6 pb-20">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center min-h-[40vh] text-center space-y-6">
                    <div className="grid grid-cols-2 gap-3 w-full">
                      <button onClick={() => handleSend("Plan a route to central park with stops for coffee and lunch")} className="text-left p-4 rounded-3xl border border-gray-100 hover:bg-blue-50 hover:border-blue-100 transition-all group">
                        <Coffee className="w-5 h-5 text-blue-500 mb-2" />
                        <p className="text-sm font-bold text-gray-700">Coffee stop route</p>
                      </button>
                      <button onClick={() => handleSend("Switch to satellite view and zoom in on high-rated parks")} className="text-left p-4 rounded-3xl border border-gray-100 hover:bg-blue-50 hover:border-blue-100 transition-all group">
                        <ImageIcon className="w-5 h-5 text-blue-500 mb-2" />
                        <p className="text-sm font-bold text-gray-700">Visual exploration</p>
                      </button>
                    </div>
                  </div>
                )}
                {messages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
                    <div className={`max-w-[85%] rounded-[24px] p-5 ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-50 border border-gray-100 text-gray-800 rounded-bl-none shadow-sm'}`}>
                      <p className="text-[16px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      {msg.route && <RouteDirections stops={msg.route.stops} steps={msg.route.steps} duration={msg.route.duration} distance={msg.route.distance} />}
                      {msg.links && msg.links.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2 pt-4 border-t border-gray-200/50">
                          {msg.links.map((link, lIdx) => (
                            <a key={lIdx} href={link.uri} target="_blank" className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-xl text-xs font-bold text-blue-600 shadow-sm hover:shadow-md transition-all">
                              <MapIcon className="w-3.5 h-3.5" /> {link.title}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isProcessing && (
                  <div className="flex justify-start"><div className="bg-gray-100 rounded-full px-4 py-2 flex gap-1 animate-pulse"><div className="w-2 h-2 bg-blue-400 rounded-full" /><div className="w-2 h-2 bg-blue-400 rounded-full" /><div className="w-2 h-2 bg-blue-400 rounded-full" /></div></div>
                )}
              </div>

              <div className="p-6 border-t border-gray-100 bg-white absolute bottom-0 inset-x-0 md:rounded-b-[32px]">
                <div className="flex items-center gap-3 bg-gray-50 rounded-2xl px-5 py-2.5 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100 transition-all border border-transparent focus-within:border-blue-200 shadow-inner">
                  <input 
                    type="text" 
                    placeholder="Message Ask Maps..." 
                    className="flex-1 bg-transparent outline-none py-1 text-[15px] font-medium" 
                    value={input} 
                    onChange={(e) => setInput(e.target.value)} 
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()} 
                  />
                  <button onClick={() => handleSend()} disabled={!input.trim() || isProcessing} className={`p-2 rounded-xl transition-all ${input.trim() ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'text-gray-300'}`}>
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      
      {/* Tab Navigation - Hidden in Driving Mode & Desktop */}
      {!isDrivingMode && !isChatOpen && (
        <div className="fixed bottom-0 left-0 right-0 z-[500] bg-white/95 backdrop-blur-md border-t border-gray-100 px-8 py-3 pb-8 md:hidden flex justify-between items-center text-gray-500">
          <div className="flex flex-col items-center gap-1 text-blue-600 cursor-pointer"><MapIcon className="w-6 h-6" /><span className="text-[10px] font-bold">Explore</span></div>
          <div className="flex flex-col items-center gap-1 cursor-pointer hover:text-gray-800"><Navigation className="w-6 h-6" /><span className="text-[10px] font-bold">Go</span></div>
          <div className="flex flex-col items-center gap-1 cursor-pointer hover:text-gray-800"><Clock className="w-6 h-6" /><span className="text-[10px] font-bold">Recent</span></div>
        </div>
      )}
    </div>
  );
};

export default App;
