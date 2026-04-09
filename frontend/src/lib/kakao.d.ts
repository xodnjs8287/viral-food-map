declare namespace Kakao {
  function init(appKey: string): void;
  function isInitialized(): boolean;
  namespace Share {
    function sendDefault(settings: {
      objectType: string;
      content?: {
        title: string;
        description?: string;
        imageUrl?: string;
        link: { mobileWebUrl?: string; webUrl?: string };
      };
      buttons?: Array<{
        title: string;
        link: { mobileWebUrl?: string; webUrl?: string };
      }>;
    }): void;
  }
}

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
      xAnchor?: number;
      yAnchor?: number;
    });
    setMap(map: Map | null): void;
    getPosition(): LatLng;
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
    function removeListener(target: any, type: string, handler: Function): void;
  }

  namespace services {
    class Geocoder {
      addressSearch(
        addr: string,
        callback: (result: any[], status: any) => void
      ): void;
      coord2Address(
        x: number,
        y: number,
        callback: (result: any[], status: any) => void
      ): void;
    }
    class Places {
      keywordSearch(
        keyword: string,
        callback: (result: any[], status: any, pagination: PlacesPagination) => void,
        options?: {
          size?: number;
          category_group_code?: string;
          x?: number;
          y?: number;
        }
      ): void;
    }
    interface PlacesPagination {
      totalCount: number;
      hasNextPage: boolean;
      nextPage(): void;
    }
    const Status: { OK: string; ZERO_RESULT: string };
  }

  function load(callback: () => void): void;
}
