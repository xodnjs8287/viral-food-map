export interface Coordinates {
  lat: number;
  lng: number;
}

export const DEFAULT_MAP_CENTER: Coordinates = {
  lat: 37.5665,
  lng: 126.978,
};

const ZERO_COORDINATE_EPSILON = 0.001;

function isFiniteCoordinate(value: number) {
  return Number.isFinite(value);
}

export function hasUsableCoordinates(
  coords: Coordinates | null | undefined
): coords is Coordinates {
  if (!coords) {
    return false;
  }

  const { lat, lng } = coords;

  if (!isFiniteCoordinate(lat) || !isFiniteCoordinate(lng)) {
    return false;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return false;
  }

  if (
    Math.abs(lat) < ZERO_COORDINATE_EPSILON &&
    Math.abs(lng) < ZERO_COORDINATE_EPSILON
  ) {
    return false;
  }

  return true;
}
