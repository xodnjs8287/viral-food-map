declare namespace kakao.maps {
  class Map {
    constructor(container: HTMLElement, options: MapOptions);
    setCenter(latlng: LatLng): void;
    panTo(latlng: LatLng): void;
    setLevel(level: number): void;
    getCenter(): LatLng;
    getLevel(): number;
    setBounds(bounds: LatLngBounds): void;
    getBounds(): LatLngBounds;
  }

  interface MapOptions {
    center: LatLng;
    level?: number;
  }

  class LatLng {
    constructor(lat: number, lng: number);
    getLat(): number;
    getLng(): number;
  }

  class LatLngBounds {
    constructor();
    extend(latlng: LatLng): void;
    getSouthWest(): LatLng;
    getNorthEast(): LatLng;
  }

  class Marker {
    constructor(options: MarkerOptions);
    setMap(map: Map | null): void;
    getPosition(): LatLng;
  }

  interface MarkerOptions {
    position: LatLng;
    map?: Map;
    image?: MarkerImage;
  }

  class MarkerImage {
    constructor(src: string, size: Size, options?: object);
  }

  class Size {
    constructor(width: number, height: number);
  }

  class InfoWindow {
    constructor(options: InfoWindowOptions);
    open(map: Map, marker: Marker): void;
    close(): void;
  }

  interface InfoWindowOptions {
    content: string;
    removable?: boolean;
  }

  class CustomOverlay {
    constructor(options: {
      position: LatLng;
      content: HTMLElement | string;
      map?: Map;
      zIndex?: number;
    });
    setMap(map: Map | null): void;
  }

  class MarkerClusterer {
    constructor(options: MarkerClustererOptions);
    addMarkers(markers: Marker[]): void;
    clear(): void;
  }

  interface MarkerClustererOptions {
    map: Map;
    averageCenter?: boolean;
    minLevel?: number;
  }

  namespace event {
    function addListener(target: any, type: string, handler: Function): void;
  }

  namespace services {
    class Geocoder {
      addressSearch(
        addr: string,
        callback: (result: any[], status: any) => void
      ): void;
    }
    class Places {
      keywordSearch(
        keyword: string,
        callback: (result: any[], status: any, pagination: any) => void,
        options?: { size?: number; category_group_code?: string }
      ): void;
    }
    const Status: { OK: string; ZERO_RESULT: string };
  }

  function load(callback: () => void): void;
}
