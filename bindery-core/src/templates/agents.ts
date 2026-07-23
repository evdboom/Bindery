import { type TemplateContext, type TemplateMeta } from './context';
import { renderAgentTemplate } from './agentRender';

export const meta: TemplateMeta = {
    file:    'AGENTS.md',
    version: 14,
    label:   'agent instructions',
};

export function render(ctx: TemplateContext): string {
    return renderAgentTemplate(ctx, { hasSkills: true, requiresSkillUpload: false, name: 'Agent Instructions' });
}
