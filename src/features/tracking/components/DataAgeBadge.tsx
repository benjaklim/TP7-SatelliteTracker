import { dataAgeHours, type Satellite } from '../../../core';
import { formatAge } from '../../../shared/format';
import { Badge } from '../../../shared/ui';
import { STALE_EPOCH_HOURS } from '../hooks/useSatellite';

/** RF-16: age of the orbital elements, warning when they are too old for accurate SGP4. */
export function DataAgeBadge({ satellite, now, stale }: { satellite: Satellite; now: number; stale?: boolean }) {
  const age = dataAgeHours(satellite, now);
  const outdated = age > STALE_EPOCH_HOURS || stale;
  return (
    <Badge
      tone={outdated ? 'warning' : age > 24 ? 'neutral' : 'success'}
      label={`${outdated ? '⚠ ' : ''}Elements ${formatAge(age)} old${stale ? ' · offline cache' : ''}`}
    />
  );
}
