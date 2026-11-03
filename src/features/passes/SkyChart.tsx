import Svg, { Circle, G, Line, Polyline, Text as SvgText } from 'react-native-svg';

import type { SkyPoint } from '../../core';
import { colors } from '../../shared/theme';

interface Props {
  track: SkyPoint[];
  size: number;
  minElevation: number;
  /** Live satellite position, drawn when above the horizon. */
  current?: { azimuth: number; elevation: number } | null;
}

/** Polar projection: zenith at the centre, horizon on the outer ring, north up, east right. */
export function polarToXY(azimuth: number, elevation: number, radius: number, centre: number) {
  const r = (radius * (90 - Math.max(0, Math.min(90, elevation)))) / 90;
  const a = (azimuth * Math.PI) / 180;
  return { x: centre + r * Math.sin(a), y: centre - r * Math.cos(a) };
}

/** RF-05: sky chart of the pass (concentric elevation rings, track, AOS/LOS and live position). */
export function SkyChart({ track, size, minElevation, current }: Props) {
  const centre = size / 2;
  const radius = size / 2 - 22;
  const points = track.map((p) => polarToXY(p.azimuth, p.elevation, radius, centre));
  const aos = points[0];
  const los = points[points.length - 1];
  const live = current && current.elevation > 0 ? polarToXY(current.azimuth, current.elevation, radius, centre) : null;
  const maxPoint = track.reduce<SkyPoint | null>((m, p) => (!m || p.elevation > m.elevation ? p : m), null);
  const max = maxPoint ? polarToXY(maxPoint.azimuth, maxPoint.elevation, radius, centre) : null;

  return (
    <Svg width={size} height={size}>
      {[0, 30, 60].map((el) => (
        <Circle
          key={el}
          cx={centre}
          cy={centre}
          r={(radius * (90 - el)) / 90}
          stroke={colors.border}
          strokeWidth={1}
          fill={el === 0 ? colors.surface : 'none'}
        />
      ))}
      <Circle
        cx={centre}
        cy={centre}
        r={(radius * (90 - minElevation)) / 90}
        stroke={colors.warning}
        strokeDasharray="4 4"
        strokeWidth={1}
        fill="none"
      />
      <Line x1={centre} y1={centre - radius} x2={centre} y2={centre + radius} stroke={colors.border} />
      <Line x1={centre - radius} y1={centre} x2={centre + radius} y2={centre} stroke={colors.border} />
      {[
        ['N', 0],
        ['E', 90],
        ['S', 180],
        ['W', 270],
      ].map(([label, az]) => {
        const { x, y } = polarToXY(az as number, -12, radius, centre);
        return (
          <SvgText
            key={label}
            x={x}
            y={y + 4}
            fill={colors.muted}
            fontSize={12}
            fontWeight="bold"
            textAnchor="middle"
          >
            {label}
          </SvgText>
        );
      })}
      {[30, 60].map((el) => (
        <SvgText key={el} x={centre + 3} y={centre - (radius * (90 - el)) / 90 - 3} fill={colors.muted} fontSize={9}>
          {el}°
        </SvgText>
      ))}
      {points.length > 1 && (
        <Polyline
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          stroke={colors.track}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
        />
      )}
      {aos && (
        <G>
          <Circle cx={aos.x} cy={aos.y} r={5} fill={colors.success} />
          <SvgText x={aos.x + 7} y={aos.y + 4} fill={colors.success} fontSize={11} fontWeight="bold">
            AOS
          </SvgText>
        </G>
      )}
      {los && (
        <G>
          <Circle cx={los.x} cy={los.y} r={5} fill={colors.danger} />
          <SvgText x={los.x + 7} y={los.y + 4} fill={colors.danger} fontSize={11} fontWeight="bold">
            LOS
          </SvgText>
        </G>
      )}
      {max && <Circle cx={max.x} cy={max.y} r={4} fill={colors.track} />}
      {live && <Circle cx={live.x} cy={live.y} r={8} fill={colors.accent} stroke="#fff" strokeWidth={2} />}
    </Svg>
  );
}
