
export interface Location {
  lat: number;
  lng: number;
}

export interface GroundingLink {
  uri: string;
  title: string;
}

export interface RouteStep {
  instruction: string;
  distance?: string;
  type?: 'left' | 'right' | 'straight' | 'u-turn' | 'destination';
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  links?: GroundingLink[];
  route?: {
    stops: string[];
    steps: RouteStep[];
    duration?: string;
    distance?: string;
  };
  isLoading?: boolean;
}

export interface PlaceInfo {
  name: string;
  rating?: number;
  reviewCount?: number;
  duration?: string;
  image?: string;
  address?: string;
  phone?: string;
  website?: string;
}
