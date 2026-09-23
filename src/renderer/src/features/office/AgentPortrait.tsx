import type { CSSProperties } from 'react';
import type { OfficeAgent } from './data/officeAgents';

export function AgentPortrait({ agent, className = '' }: { agent: OfficeAgent; className?: string }) {
  return (
    <span
      className={`office-portrait ${className}`}
      role="img"
      aria-label={agent.name}
      style={{ '--portrait': `url("${agent.avatar}")`, '--agent-color': agent.accentColor } as CSSProperties}
    >
      {!agent.avatar && agent.name.charAt(0)}
    </span>
  );
}
