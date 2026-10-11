import { DASHBOARD_LIMITS as L, normalizeDashboard, type Dashboard } from '../shared/dashboards';
import type { ToolDefinition } from '../shared/types';

/** The newest dashboards kept; older ones are dropped as new ones arrive. */
export const DASHBOARDS_KEPT = 200;

/**
 * Any coworker (and your own chats) can show what they gathered as a dashboard. It only displays:
 * the call is checked here and drawn by the window, so nothing the model writes runs.
 */
export const SHOW_DASHBOARD: ToolDefinition = {
  name: 'show_dashboard',
  description:
    'Show the user a dashboard of data you gathered: number tiles, bar and line charts, tables, lists of findings and short notes. Use it when the data is worth seeing at a glance (figures, comparisons, trends, a list of leads or results); a simple answer needs none. Only data you actually gathered or were given, never invented; say where it came from in sources. It appears in this conversation and in the Dashboards sheet. Still answer in text in a few lines. To change a dashboard you showed, call again with its dashboard_id.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'What it shows, in a few words' },
      summary: { type: 'string', description: 'The takeaway in one or two sentences' },
      widgets: {
        type: 'array',
        description: `1-${L.widgets} blocks, shown in order. Lead with stat tiles for the headline numbers.`,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['stat', 'bar', 'line', 'table', 'list', 'text'] },
            title: { type: 'string', description: 'bar, line, table, list, text: its heading' },
            label: { type: 'string', description: 'stat: what the number is' },
            value: {
              type: 'string',
              description: 'stat: the number, e.g. "1284", or a short value like "LinkedIn"'
            },
            unit: { type: 'string', description: 'stat, bar, line: e.g. "%", "USD", "leads"' },
            change: {
              type: 'string',
              description: 'stat: change against an earlier period, e.g. "+12% vs September"'
            },
            note: { type: 'string', description: 'stat: a few words more' },
            data: {
              type: 'array',
              description: `bar: up to ${L.bars} bars`,
              items: {
                type: 'object',
                properties: { label: { type: 'string' }, value: { type: 'number' } },
                required: ['label', 'value']
              }
            },
            x: {
              type: 'array',
              items: { type: 'string' },
              description: `line: the labels along the bottom, e.g. months (2-${L.points})`
            },
            series: {
              type: 'array',
              description: `line: up to ${L.series} lines, each with one value per x label`,
              items: {
                type: 'object',
                properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } },
                required: ['name', 'values']
              }
            },
            columns: {
              type: 'array',
              items: { type: 'string' },
              description: `table: column headings (up to ${L.columns})`
            },
            rows: {
              type: 'array',
              items: { type: 'array', items: { type: 'string' } },
              description: `table: up to ${L.rows} rows, one cell per column`
            },
            items: {
              type: 'array',
              description: `list: up to ${L.items} findings`,
              items: {
                type: 'object',
                properties: { text: { type: 'string' }, detail: { type: 'string' }, url: { type: 'string' } },
                required: ['text']
              }
            },
            body: { type: 'string', description: 'text: a short note in Markdown' }
          },
          required: ['type']
        }
      },
      sources: {
        type: 'array',
        description: 'Where the data came from',
        items: {
          type: 'object',
          properties: { title: { type: 'string' }, url: { type: 'string' } },
          required: ['title']
        }
      },
      dashboard_id: {
        type: 'string',
        description: 'Only to update a dashboard you showed earlier in this conversation'
      }
    },
    required: ['title', 'widgets']
  }
};

/**
 * Saves what a show_dashboard call shows into `dashboards` (newest first, the newest
 * DASHBOARDS_KEPT kept), or says what is wrong with it so the model can call again.
 */
export function publishDashboard(
  dashboards: Dashboard[],
  call: { args: unknown; conversationId: string; agentId?: string; toolCallId: string },
  make: { id: () => string; now: number }
): { content: string; isError?: boolean; dashboard?: Dashboard } {
  const checked = normalizeDashboard(call.args);
  if ('error' in checked)
    return { content: `Not shown: ${checked.error} Fix it and call show_dashboard again.`, isError: true };
  const { dashboard: content, id } = checked;
  if (id) {
    const at = dashboards.findIndex((d) => d.id === id && d.conversationId === call.conversationId);
    if (at < 0)
      return {
        content: `There is no dashboard ${id} in this conversation. Leave dashboard_id out to show a new one.`,
        isError: true
      };
    const [old] = dashboards.splice(at, 1);
    const dashboard: Dashboard = {
      ...content,
      id,
      ...(old.agentId ? { agentId: old.agentId } : {}),
      conversationId: old.conversationId,
      toolCallIds: [...old.toolCallIds, call.toolCallId],
      createdAt: old.createdAt,
      updatedAt: make.now
    };
    dashboards.unshift(dashboard);
    return { content: `Dashboard "${dashboard.title}" is updated on screen for the user (id ${id}).`, dashboard };
  }
  const dashboard: Dashboard = {
    ...content,
    id: make.id(),
    ...(call.agentId ? { agentId: call.agentId } : {}),
    conversationId: call.conversationId,
    toolCallIds: [call.toolCallId],
    createdAt: make.now,
    updatedAt: make.now
  };
  dashboards.unshift(dashboard);
  dashboards.splice(DASHBOARDS_KEPT);
  return {
    content: `Dashboard "${dashboard.title}" is on screen for the user (id ${dashboard.id}). To change it, call show_dashboard again with dashboard_id "${dashboard.id}".`,
    dashboard
  };
}
