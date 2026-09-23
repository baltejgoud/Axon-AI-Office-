import type { CSSProperties } from 'react';
import type { OfficeAgent } from './data/officeAgents';
import { appearanceFor } from './scene/agents/appearance';
import { AVATARS } from './data/avatars';

export function AgentPortrait({ agent, className = '' }: { agent: OfficeAgent; className?: string }) {
  const look = appearanceFor(agent.id, agent.accentColor);
  const avatar = AVATARS[agent.id];
  return (
    <span
      className={`office-portrait ${className}`}
      role="img"
      aria-label={agent.name}
      style={{ '--portrait': `url("${avatar}")`, '--agent-color': agent.accentColor } as CSSProperties}
    >
      {!avatar && (
        <svg viewBox="0 0 80 80" aria-hidden="true">
          <circle cx="40" cy="40" r="40" fill={agent.accentSoft} />
          <path d="M8 82 Q9 57 29 56 L51 56 Q72 58 74 82" fill={look.jacket ?? look.shirt} />
          <path d="M32 53 L40 68 L48 53" fill="#f7f5ee" />
          <rect x="34" y="47" width="12" height="14" rx="5" fill={look.skin} />
          <ellipse cx="40" cy="33" rx="19" ry="23" fill={look.hair} />
          <ellipse cx="40" cy="35" rx="16" ry="20" fill={look.skin} />
          <path d="M23 31 Q20 11 41 11 Q61 13 57 29 Q44 27 34 20 Q31 29 23 31" fill={look.hair} />
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
          {look.hairStyle === 'bun' && <circle cx="43" cy="10" r="8" fill={look.hair} />}
          <rect x="54" y="64" width="7" height="5" rx="1" fill={agent.accentColor} stroke="#fff" />
        </svg>
      )}
    </span>
  );
}
