import type { GroundTrack, LngLat } from '../../core';

export function groundTrackFeatures(track: GroundTrack): GeoJSON.FeatureCollection<GeoJSON.MultiLineString> {
  return {
    type: 'FeatureCollection',
    features: (['past', 'future'] as const).map((kind) => ({
      type: 'Feature',
      properties: { kind },
      geometry: { type: 'MultiLineString', coordinates: track[kind] },
    })),
  };
}

export function footprintFeature(polygons: LngLat[][][]): GeoJSON.Feature<GeoJSON.MultiPolygon> {
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polygons } };
}

export function outlineFeature(lines: LngLat[][]): GeoJSON.Feature<GeoJSON.MultiLineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } };
}

export const EMPTY_COLLECTION: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
