import type { TemplateContext, AgentTemplate } from './context';
import { pushCapabilitiesSource, pushProjectSection, pushSessionStart, pushMemorySystem, pushRepoLayout, pushWritingRules } from './building-blocks';

export type TopLevelTarget = 'claude' | 'copilot' | 'cursor' | 'agents';

export function renderAgentTemplate(ctx: TemplateContext, agent: AgentTemplate): string {
    const lines: string[] = [
        `# ${agent.name} — ${ctx.title}`,
        '',
    ];
    pushProjectSection(lines, ctx);
    lines.push('');
    pushSessionStart(lines, ctx, agent);
    lines.push('');
    pushMemorySystem(lines, agent);
    lines.push('');
    pushRepoLayout(lines, ctx);
    lines.push('');
    pushWritingRules(lines, ctx);
    lines.push('');
    pushCapabilitiesSource(lines);
    return lines.filter(l => l !== '\n').join('\n') + '\n';
};