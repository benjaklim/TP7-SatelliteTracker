import type { OMMJsonObject } from 'satellite.js';

export type OrbitalRecord = OMMJsonObject & {
  NORAD_CAT_ID: number;
  OBJECT_NAME: string;
  EPOCH: string;
};

/** Ground observer in degrees / kilometers. */
export interface Observer {
  latitude: number;
  longitude: number;
  altitudeKm: number;
}

export interface GeoPosition {
  latitude: number;
  longitude: number;
  altitudeKm: number;
}

export interface SatelliteState extends GeoPosition {
  timestamp: number;
  velocityKmS: number;
}

export interface LookAngles {
  azimuth: number;
  elevation: number;
  rangeKm: number;
}

export interface SkyPoint extends LookAngles {
  timestamp: number;
}

export type OrbitClass = 'LEO' | 'MEO' | 'GEO' | 'HEO';

export interface Pass {
  aos: number;
  tca: number;
  los: number;
  maxElevation: number;
  aosAzimuth: number;
  tcaAzimuth: number;
  losAzimuth: number;
  /** True when the satellite is sunlit while the observer is in darkness at TCA. */
  optical: boolean;
  /** True when AOS happened before the search window started. */
  inProgress: boolean;
  /** True when LOS happens after the search window ended. */
  truncated: boolean;
}

export type LngLat = [longitude: number, latitude: number];
