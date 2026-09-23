import type { CSSProperties } from 'react';
import type { OfficeAgent } from './data/officeAgents';
import { appearanceFor } from './scene/agents/appearance';
import { usePortrait } from './scene/people/portraits';

/**
 * A coworker's face: rendered from their own 3D figure, so it matches the office. Until the render
 * is ready (or if 3D is unavailable) a drawn version in the same colours stands in.
 */
export function AgentPortrait({
  agent,
  className = '',
  urgent = false
}: {
  agent: OfficeAgent;
  className?: string;
  urgent?: boolean;
}) {
  const look = appearanceFor(agent.id, agent.accentColor);
  const rendered = usePortrait(agent.id, urgent);
  const outer = look.jacket ?? look.shirt;
  return (
    <span
      className={`office-portrait ${className}`}
      role="img"
      aria-label={agent.name}
      style={{ '--agent-color': agent.accentColor, '--portrait-bg': agent.accentSoft } as CSSProperties}
    >
      {rendered ? (
        <img src={rendered} alt="" draggable={false} />
      ) : (
        <svg viewBox="0 0 80 80" aria-hidden="true">
          <circle cx="40" cy="40" r="40" fill={agent.accentSoft} />
          <path d="M8 82 Q9 57 29 56 L51 56 Q72 58 74 82" fill={outer} />
          <path d="M32 53 L40 68 L48 53" fill={look.jacket ? look.shirt : outer} />
          <rect x="34" y="47" width="12" height="14" rx="5" fill={look.skin} />
          {look.hairStyle !== 'bald' && <ellipse cx="40" cy="33" rx="19" ry="23" fill={look.hair} />}
          <ellipse cx="40" cy="35" rx="16" ry="20" fill={look.skin} />
          {look.hairStyle !== 'bald' && look.hairStyle !== 'buzz' && (
            <path d="M23 31 Q20 11 41 11 Q61 13 57 29 Q44 27 34 20 Q31 29 23 31" fill={look.hair} />
          )}
          {look.beard && (
            <path d="M26 40 Q28 58 40 58 Q52 58 54 40 Q48 50 40 50 Q32 50 26 40" fill={look.beard} />
          )}
          <path d="M29 32 L35 31 M45 31 L51 32" stroke={look.hair} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="32" cy="36" r="1.7" fill="#26313e" />
          <circle cx="48" cy="36" r="1.7" fill="#26313e" />
          <path
            d="M36 46 Q40 49 44 46"
            fill="none"
            stroke="#945d4f"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          {look.glasses && (
            <g fill="none" stroke="#344052" strokeWidth="1.5">
              <rect x="25" y="31" width="13" height="10" rx="4" />
              <rect x="42" y="31" width="13" height="10" rx="4" />
              <path d="M38 34 L42 34" />
            </g>
          )}
          {look.headphones && (
            <g fill="#1f2430">
              <path d="M21 34 Q21 10 40 10 Q59 10 59 34" fill="none" stroke="#1f2430" strokeWidth="3" />
              <rect x="17" y="30" width="7" height="12" rx="3" />
              <rect x="56" y="30" width="7" height="12" rx="3" />
            </g>
          )}
          {look.hairStyle === 'bun' && <circle cx="43" cy="10" r="8" fill={look.hair} />}
          {look.top === 'suit' && <path d="M38.5 56 L41.5 56 L42 70 L40 73 L38 70 Z" fill={look.accent} />}
        </svg>
      )}
    </span>
  );
}
