import { createContext, useContext, type ReactNode } from 'react';

import { useSatellite, type SatelliteData } from './hooks/useSatellite';
import { trackingStore } from './trackingStore';

const SelectedSatelliteContext = createContext<SatelliteData | null>(null);

/** One SGP4 satellite instance shared by the map, passes, compass and validation screens. */
export function SelectedSatelliteProvider({ children }: { children: ReactNode }) {
  const noradId = trackingStore.use((s) => s.selectedNoradId);
  const data = useSatellite(noradId);
  return <SelectedSatelliteContext.Provider value={data}>{children}</SelectedSatelliteContext.Provider>;
}

export function useSelectedSatellite(): SatelliteData {
  const value = useContext(SelectedSatelliteContext);
  if (!value) throw new Error('useSelectedSatellite must be used inside SelectedSatelliteProvider');
  return value;
}
