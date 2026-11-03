import { SqliteCacheStore } from '../data/cache/SqliteCacheStore';
import { ProviderOrchestrator } from '../data/orchestrator/ProviderOrchestrator';
import { CelesTrakProvider } from '../data/providers/CelesTrakProvider';
import { N2yoProvider } from '../data/providers/N2yoProvider';
import { SpaceTrackProvider } from '../data/providers/SpaceTrackProvider';
import { WhereTheIssProvider } from '../data/providers/WhereTheIssProvider';
import { settingsStore } from '../features/settings/settingsStore';

const cache = new SqliteCacheStore();
let current: { proxyUrl: string; orchestrator: ProviderOrchestrator } | null = null;

/**
 * Composition root. Fallback order:
 *   catalog/orbital: CelesTrak via proxy → CelesTrak direct → Space-Track (proxy) → N2YO / WTIA TLE
 *   validation:      N2YO (proxy) + Where the ISS at? (proxy, then direct)
 */
function build(proxyUrl: string): ProviderOrchestrator {
  const celestrakProxy = new CelesTrakProvider({ proxyUrl });
  const celestrakDirect = new CelesTrakProvider();
  const spaceTrack = new SpaceTrackProvider(proxyUrl);
  const n2yo = new N2yoProvider(proxyUrl);
  const wtiaProxy = new WhereTheIssProvider(proxyUrl);
  const wtiaDirect = new WhereTheIssProvider();
  return new ProviderOrchestrator(
    {
      catalog: [celestrakProxy, celestrakDirect, spaceTrack],
      orbital: [celestrakProxy, celestrakDirect, spaceTrack, n2yo, wtiaDirect],
      search: [celestrakProxy, celestrakDirect],
      validation: [n2yo, wtiaProxy],
    },
    cache,
  );
}

export function getOrchestrator(): ProviderOrchestrator {
  const { proxyUrl } = settingsStore.get();
  if (!current || current.proxyUrl !== proxyUrl) current = { proxyUrl, orchestrator: build(proxyUrl) };
  return current.orchestrator;
}

export function getDirectIssProvider() {
  return new WhereTheIssProvider();
}
