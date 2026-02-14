
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Search, 
  Navigation, 
  Map as MapIcon, 
  Layers, 
  Mic, 
  Send, 
  Star, 
  Clock, 
  ExternalLink,
  ChevronUp,
  ChevronDown,
  X,
  MicOff,
  Car,
  MapPin,
  Info,
  Route,
  Train,
  Mountain,
  Image as ImageIcon,
  Check,
  Heart,
  Coffee,
  Utensils,
  Palette,
  Plus,
  Minus,
  MessageSquare,
  Waves,
  ArrowRight,
  ArrowUp,
  RotateCcw,
  ArrowUpRight,
  ArrowUpLeft,
  Settings,
  ShieldAlert,
  Phone,
  Globe
} from 'lucide-react';
import { GoogleGenAI, Modality } from '@google/genai';
import { askMaps } from './geminiService';
import { Message, Location, GroundingLink, RouteStep } from './types';

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
  x: number;
  y: number;
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

interface MarkerCluster {
  id: string;
  x: number;
  y: number;
  count: number;
  markers: MapMarker[];
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

const MarkerIcon = ({ type, className }: { type: MarkerIconType; className?: string }) => {
  switch (type) {
    case 'heart': return <Heart className={className} fill="currentColor" />;
    case 'star': return <Star className={className} fill="currentColor" />;
    case 'coffee': return <Coffee className={className} fill="currentColor" />;
    case 'utensils': return <Utensils className={className} fill="currentColor" />;
    default: return <MapPin className={className} fill="currentColor" />;
  }
};

const MockMap = ({ 
  showTraffic, 
  markers, 
  activeLayer,
  zoom,
  centerX = 50,
  centerY = 50,
  onMarkerClick,
  onMarkerUpdate,
  onZoomChange,
  isDrivingMode
}: { 
  showTraffic: boolean, 
  markers: MapMarker[], 
  activeLayer: MapLayer,
  zoom: number,
  centerX?: number,
  centerY?: number,
  onMarkerClick: (marker: MapMarker) => void,
  onMarkerUpdate: (id: string, updates: Partial<MapMarker>) => void,
  onZoomChange: (newZoom: number) => void,
  isDrivingMode: boolean
}) => {
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [showStylePicker, setShowStylePicker] = useState(false);

  const effectiveZoom = isDrivingMode ? zoom + 1 : zoom;

  const clusters = useMemo(() => {
    if (effectiveZoom >= 4) return markers.map(m => ({ isCluster: false, data: m }));
    const clusterGridSize = 12 / effectiveZoom;
    const grid: Record<string, MapMarker[]> = {};
    markers.forEach(m => {
      const gx = Math.floor(m.x / clusterGridSize);
      const gy = Math.floor(m.y / clusterGridSize);
      const key = `${gx}-${gy}`;
      if (!grid[key]) grid[key] = [];
      grid[key].push(m);
    });
    return Object.values(grid).map((group, idx) => {
      if (group.length === 1) return { isCluster: false, data: group[0] };
      const avgX = group.reduce((acc, m) => acc + m.x, 0) / group.length;
      const avgY = group.reduce((acc, m) => acc + m.y, 0) / group.length;
      return {
        isCluster: true,
        data: { id: `cluster-${idx}`, x: avgX, y: avgY, count: group.length, markers: group } as MarkerCluster
      };
    });
  }, [markers, effectiveZoom]);

  const selectedMarker = markers.find(m => m.id === selectedMarkerId);

  const getLayerStyles = () => {
    switch(activeLayer) {
      case 'satellite': return { bg: 'bg-emerald-950', grid: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)', overlay: 'bg-black/20' };
      case 'terrain': return { bg: 'bg-stone-200', grid: 'repeating-linear-gradient(45deg, rgba(0,0,0,0.02) 0px, rgba(0,0,0,0.02) 1px, transparent 1px, transparent 10px)', overlay: 'bg-orange-900/5' };
      case 'transit': return { bg: 'bg-slate-50', grid: 'linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px)', overlay: 'bg-blue-900/5' };
      default: return { bg: isDrivingMode ? 'bg-[#242f3e]' : 'bg-blue-50', grid: isDrivingMode ? 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)' : 'radial-gradient(#94a3b8 1px, transparent 1px)', overlay: 'bg-transparent' };
    }
  };

  const styles = getLayerStyles();
  const routeMarkers = [...markers].filter(m => m.stopNumber !== undefined).sort((a, b) => (a.stopNumber || 0) - (b.stopNumber || 0));

  return (
    <div className={`fixed inset-0 transition-all duration-1000 ${styles.bg} z-0 overflow-hidden`}>
      <div className="absolute inset-0 transition-transform duration-1000 ease-in-out" style={{
        transform: `scale(${effectiveZoom * 0.5 + 0.5}) translate(${50 - centerX}%, ${isDrivingMode ? (60 - centerY) : (50 - centerY)}%)`,
        transformOrigin: 'center'
      }}>
        <div className="absolute inset-0 opacity-40" style={{ backgroundImage: styles.grid, backgroundSize: activeLayer === 'transit' ? '30px 30px' : '40px 40px' }} />
        <div className={`absolute inset-0 ${styles.overlay}`} />

        {showTraffic && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-80 z-10">
            <path d="M-10 200 Q 200 150 400 250 T 800 200" fill="transparent" stroke={activeLayer === 'satellite' ? '#86efac' : '#4ade80'} strokeWidth="6" strokeLinecap="round" className="animate-pulse" />
            <path d="M300 -10 L 300 800" fill="transparent" stroke="#ef4444" strokeWidth="4" strokeLinecap="round" strokeDasharray="10,5" className="animate-[dash_20s_linear_infinite]" />
          </svg>
        )}

        {routeMarkers.length > 1 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-20">
            <polyline
              points={routeMarkers.map(m => `${m.x}%,${m.y}%`).join(' ')}
              fill="none"
              stroke={isDrivingMode ? "#4285F4" : "#3b82f6"}
              strokeWidth={isDrivingMode ? "8" : "4"}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-in fade-in duration-1000"
            />
          </svg>
        )}

        {clusters.map((item) => {
          if (item.isCluster) {
            const cluster = item.data as MarkerCluster;
            return (
              <div key={cluster.id} className="absolute z-30 cursor-pointer transition-all duration-500 hover:scale-110" style={{ left: `${cluster.x}%`, top: `${cluster.y}%`, transform: 'translate(-50%, -50%)' }} onClick={() => onZoomChange(Math.min(zoom + 1, 5))}>
                <div className="relative w-8 h-8 bg-blue-600 border-2 border-white rounded-full shadow-lg flex items-center justify-center text-white text-xs font-bold">{cluster.count}</div>
              </div>
            );
          }
          const marker = item.data as MapMarker;
          return (
            <div key={marker.id} className="absolute z-30 cursor-pointer transition-all duration-300 hover:-translate-y-2 group/marker" style={{ left: `${marker.x}%`, top: `${marker.y}%`, transform: 'translate(-50%, -100%)' }} onClick={() => { setSelectedMarkerId(marker.id); onMarkerClick(marker); }}>
              <div className="relative flex flex-col items-center">
                <div className={`p-1.5 rounded-full shadow-lg border-2 border-white transition-all ${selectedMarkerId === marker.id ? 'bg-blue-700 ring-4 ring-blue-200' : marker.stopNumber !== undefined ? 'bg-blue-600' : (marker.color || 'bg-red-500')}`}>
                  {marker.stopNumber !== undefined ? <span className="w-5 h-5 flex items-center justify-center text-white text-[10px] font-bold">{marker.stopNumber}</span> : <MarkerIcon type={marker.iconType || 'pin'} className="w-5 h-5 text-white" />}
                </div>
                <div className={`mt-1 bg-white/95 px-2.5 py-1 rounded-full shadow-md text-[10px] font-bold border border-gray-100 ${isDrivingMode ? 'text-gray-900 bg-white/100 scale-125 translate-y-2' : ''}`}>{marker.title}</div>
              </div>
            </div>
          );
        })}
      </div>

      {selectedMarker && !isDrivingMode && (
        <div className="absolute z-50 bottom-24 left-1/2 -translate-x-1/2 w-[300px] md:w-[350px] animate-in slide-in-from-bottom-8">
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
                   <button onClick={() => setShowStylePicker(!showStylePicker)} className="p-2.5 bg-gray-50 rounded-2xl text-gray-500 hover:bg-gray-100"><Palette className="w-5 h-5" /></button>
                </div>

                {showStylePicker && (
                  <div className="mt-2 pt-4 border-t border-gray-100 flex flex-col gap-3 animate-in fade-in">
                    <div className="flex flex-wrap gap-2">{MARKER_ICONS.map(i => <button key={i.type} onClick={() => onMarkerUpdate(selectedMarker.id, {iconType: i.type as any})} className="p-1.5 bg-gray-50 rounded-lg hover:bg-gray-200"><i.icon className="w-4 h-4" /></button>)}</div>
                    <div className="flex flex-wrap gap-2">{MARKER_COLORS.map(c => <button key={c.name} onClick={() => onMarkerUpdate(selectedMarker.id, {color: c.class})} className={`w-5 h-5 rounded-full ${c.class} border border-gray-200`} />)}</div>
                  </div>
                )}
             </div>
          </div>
        </div>
      )}

      {/* Center Reticle */}
      <div className={`absolute left-1/2 -translate-x-1/2 w-5 h-5 bg-blue-600 rounded-full border-[3px] border-white shadow-2xl animate-pulse z-40 transition-all duration-1000 ${isDrivingMode ? 'top-[60%]' : 'top-1/2 -translate-y-1/2'}`} />
    </div>
  );
};

const RouteDirections: React.FC<{ stops: string[], steps: RouteStep[], duration?: string, isDrivingMode?: boolean }> = ({ stops, steps, duration, isDrivingMode }) => {
  const [isExpanded, setIsExpanded] = useState(isDrivingMode);

  const getStepIcon = (instruction: string, size: string = "w-4 h-4") => {
    const text = instruction.toLowerCase();
    if (text.includes('left')) return <ArrowUpLeft className={`${size} text-blue-500`} />;
    if (text.includes('right')) return <ArrowUpRight className={`${size} text-blue-500`} />;
    if (text.includes('u-turn')) return <RotateCcw className={`${size} text-blue-500`} />;
    if (text.includes('arrive') || text.includes('destination')) return <MapPin className={`${size} text-green-500`} />;
    return <ArrowUp className={`${size} text-blue-500`} />;
  };

  if (isDrivingMode) {
    const currentStep = steps[0] || { instruction: "Head towards your destination", distance: "0.1 mi" };
    return (
      <div className="mt-4 animate-in slide-in-from-top-4 duration-500">
        <div className="bg-white rounded-[32px] shadow-2xl border-4 border-blue-500/10 p-6 flex flex-col gap-4">
          <div className="flex items-center gap-6">
            <div className="p-5 bg-blue-600 rounded-[24px] text-white shadow-xl shadow-blue-500/30">
              {getStepIcon(currentStep.instruction, "w-12 h-12")}
            </div>
            <div className="flex-1">
              <p className="text-[28px] font-black leading-tight text-gray-900 tracking-tight">{currentStep.instruction}</p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-[22px] font-bold text-blue-600">{currentStep.distance || "NOW"}</span>
                <span className="w-1.5 h-1.5 bg-gray-200 rounded-full" />
                <span className="text-[18px] text-gray-400 font-bold uppercase tracking-wider">{duration || "12 min"}</span>
              </div>
            </div>
          </div>
          
          <div className="pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex -space-x-2">
                {stops.slice(0, 3).map((stop, i) => (
                  <div key={i} className="w-8 h-8 rounded-full bg-blue-50 border-2 border-white flex items-center justify-center text-[10px] font-bold text-blue-600">{i+1}</div>
                ))}
              </div>
              <div className="flex items-center gap-4">
                <button className="px-6 py-2 bg-gray-100 rounded-full text-sm font-bold text-gray-600">Stops</button>
                <button className="px-6 py-2 bg-red-50 rounded-full text-sm font-bold text-red-500">Exit</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
              {duration && (
                <>
                  <span className="w-1 h-1 bg-blue-300 rounded-full" />
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {duration}</span>
                </>
              )}
            </div>
          </div>
        </div>
        {isExpanded ? <ChevronUp className="w-5 h-5 text-blue-400" /> : <ChevronDown className="w-5 h-5 text-blue-400" />}
      </div>
      
      <div className="p-4 space-y-4">
        <div className="space-y-3">
          {stops.map((stop, i) => (
            <div key={i} className="flex items-center gap-3 text-sm text-gray-700">
              <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 shadow-sm">{i + 1}</div>
              <span className="font-semibold truncate">{stop}</span>
            </div>
          ))}
        </div>

        {isExpanded && steps.length > 0 && (
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
  );
};

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isDrivingMode, setIsDrivingMode] = useState(false);
  const [userLocation, setUserLocation] = useState<Location | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showTraffic, setShowTraffic] = useState(false);
  const [activeLayer, setActiveLayer] = useState<MapLayer>('standard');
  const [activeMarkers, setActiveMarkers] = useState<MapMarker[]>([]);
  const [zoom, setZoom] = useState(2);
  const [centerX, setCenterX] = useState(50);
  const [centerY, setCenterY] = useState(50);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sessionPromiseRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => console.warn("Geolocation denied", err)
      );
    }
  }, []);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  const executeFunctionCall = (fc: any) => {
    if (fc.name === 'set_map_layer') setActiveLayer(fc.args.layer);
    if (fc.name === 'toggle_traffic') setShowTraffic(fc.args.enabled);
    if (fc.name === 'update_map_view') {
      if (fc.args.zoom) setZoom(fc.args.zoom);
      if (fc.args.focusX) setCenterX(fc.args.focusX);
      if (fc.args.focusY) setCenterY(fc.args.focusY);
    }
    return "UI updated successfully.";
  };

  const parseRouteData = (text: string, links: GroundingLink[]) => {
    const durationMatch = text.match(/(?:Total time|Duration|Estimated time):\s*([\w\s]+?)(?:\.|\n|$)/i);
    const duration = durationMatch ? durationMatch[1].trim() : undefined;
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
      return { stops: links.map(l => l.title), steps: steps, duration: duration };
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
      if (functionCalls) functionCalls.forEach(executeFunctionCall);
      const routeData = parseRouteData(text, links);
      if (links && links.length > 0) {
        const newMarkers: MapMarker[] = links.map((link, i) => {
          const stopIdx = routeData?.stops.indexOf(link.title);
          return {
            ...link, 
            id: `marker-${Date.now()}-${i}`, 
            x: 50 + (Math.random() * 60 - 30), 
            y: 50 + (Math.random() * 60 - 30),
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
      setMessages(prev => [...prev, { role: 'assistant', content: text, links, route: routeData }]);
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
      setZoom(3);
      if (!isVoiceMode) startVoiceMode();
    } else {
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
      <MockMap 
        showTraffic={showTraffic} 
        markers={activeMarkers} 
        activeLayer={activeLayer} 
        zoom={zoom} 
        centerX={centerX}
        centerY={centerY}
        onMarkerClick={() => {}} 
        onMarkerUpdate={(id, up) => setActiveMarkers(prev => prev.map(m => m.id === id ? { ...m, ...up } : m))} 
        onZoomChange={setZoom} 
        isDrivingMode={isDrivingMode}
      />

      {/* Top Search Bar - Hidden in Driving Mode */}
      {!isDrivingMode && (
        <div className="relative z-10 px-4 pt-4 flex gap-2 max-w-2xl mx-auto w-full">
          <div className="flex-1 bg-white/95 backdrop-blur-md shadow-xl rounded-2xl px-4 py-3 flex items-center gap-3 border border-white focus-within:ring-4 focus-within:ring-blue-500/10 transition-all">
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

      {/* Driving Mode Indicator Overlay */}
      {isDrivingMode && (
        <div className="absolute top-0 inset-x-0 z-50 pointer-events-none">
          <div className="bg-red-600 text-white text-[10px] font-black uppercase tracking-[3px] text-center py-1.5 flex items-center justify-center gap-2">
            <ShieldAlert className="w-3 h-3" />
            Eyes on the road • Voice mode active
          </div>
        </div>
      )}

      {/* Floating Side Tools */}
      <div className={`absolute right-4 z-30 flex flex-col gap-3 transition-all duration-700 ${isDrivingMode ? 'top-12' : 'top-1/2 -translate-y-1/2'}`}>
        {!isDrivingMode && (
          <div className="flex flex-col gap-1 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-white overflow-hidden">
            <button onClick={() => setZoom(Math.min(zoom + 1, 5))} className="p-3.5 hover:bg-gray-50 text-gray-600 border-b border-gray-100"><Plus className="w-5 h-5" /></button>
            <button onClick={() => setZoom(Math.max(zoom - 1, 1))} className="p-3.5 hover:bg-gray-50 text-gray-600"><Minus className="w-5 h-5" /></button>
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
            <button onClick={() => setShowTraffic(!showTraffic)} className={`p-3.5 rounded-2xl shadow-xl border border-white transition-all ${showTraffic ? 'bg-blue-600 text-white' : 'bg-white/95 text-gray-600'}`}>
              <Car className="w-5 h-5" />
            </button>
            <button onClick={() => setIsChatOpen(!isChatOpen)} className={`p-3.5 rounded-2xl shadow-xl border border-white bg-white/95 text-blue-600`}>
              <MessageSquare className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {/* Main UI / Bottom Sheet */}
      <div className={`absolute left-0 right-0 z-40 shadow-[0_-8px_30px_rgb(0,0,0,0.2)] transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${isDrivingMode ? 'bottom-0 h-[40vh] bg-transparent shadow-none' : 'bg-white border-t border-gray-100 ' + (isChatOpen ? 'bottom-0 h-[75vh]' : 'h-16')} md:max-w-md md:mx-auto md:rounded-t-[40px]`}>
        
        {/* Driving Mode Main Layout */}
        {isDrivingMode ? (
          <div className="h-full px-6 flex flex-col justify-end pb-12 gap-4">
             {activeRoute && <RouteDirections stops={activeRoute.stops} steps={activeRoute.steps} duration={activeRoute.duration} isDrivingMode={true} />}
             
             {/* Large Driving Controls */}
             <div className="flex gap-4">
                <button 
                  onClick={isVoiceMode ? stopVoiceMode : startVoiceMode}
                  className={`flex-1 h-20 rounded-[32px] flex items-center justify-center gap-4 shadow-2xl border-4 transition-all active:scale-95 ${isVoiceMode ? 'bg-blue-600 text-white border-white animate-pulse' : 'bg-white text-blue-600 border-blue-100'}`}
                >
                  <Waves className="w-10 h-10" />
                  <span className="text-2xl font-black uppercase tracking-tight">Tap to Speak</span>
                </button>
                <button 
                  onClick={() => handleSend("Where is the nearest gas station?")}
                  className="w-20 h-20 bg-white rounded-[32px] flex items-center justify-center border-4 border-gray-100 shadow-2xl active:scale-95"
                >
                  <Coffee className="w-8 h-8 text-gray-600" />
                </button>
             </div>
          </div>
        ) : (
          <>
            <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mt-3 mb-1 shrink-0" onClick={() => setIsChatOpen(!isChatOpen)} />
            <div className="flex items-center justify-between px-6 py-4 cursor-pointer" onClick={() => setIsChatOpen(!isChatOpen)}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                  <Navigation className="w-6 h-6" />
                </div>
                <span className="font-bold text-xl text-gray-900 tracking-tight">Ask Maps</span>
              </div>
              {isChatOpen && (
                <button onClick={(e) => { e.stopPropagation(); setMessages([]); setIsChatOpen(false); setInput(''); setActiveMarkers([]); stopVoiceMode(); }} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X className="w-6 h-6 text-gray-400" />
                </button>
              )}
            </div>

            <div className={`flex flex-col h-full overflow-hidden ${!isChatOpen ? 'hidden' : 'block'}`}>
              {isVoiceMode && (
                <div className="absolute inset-x-0 top-[80px] bottom-0 bg-blue-600/5 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-300">
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
                      {msg.route && <RouteDirections stops={msg.route.stops} steps={msg.route.steps} duration={msg.route.duration} />}
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

              <div className="p-6 border-t border-gray-100 bg-white absolute bottom-0 inset-x-0">
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
      
      {/* Tab Navigation - Hidden in Driving Mode */}
      {!isDrivingMode && !isChatOpen && (
        <div className="fixed bottom-0 left-0 right-0 z-20 bg-white/95 backdrop-blur-md border-t border-gray-100 px-8 py-3 pb-8 md:pb-3 flex justify-between items-center text-gray-500">
          <div className="flex flex-col items-center gap-1 text-blue-600 cursor-pointer"><MapIcon className="w-6 h-6" /><span className="text-[10px] font-bold">Explore</span></div>
          <div className="flex flex-col items-center gap-1 cursor-pointer hover:text-gray-800"><Navigation className="w-6 h-6" /><span className="text-[10px] font-bold">Go</span></div>
          <div className="flex flex-col items-center gap-1 cursor-pointer hover:text-gray-800"><Clock className="w-6 h-6" /><span className="text-[10px] font-bold">Recent</span></div>
        </div>
      )}
    </div>
  );
};

export default App;
