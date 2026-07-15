import { type TemplateContext, type TemplateMeta } from './context';
import { renderAgentTemplate } from './agentRender';

export const meta: TemplateMeta = {
    file:    'CLAUDE.md',
    version: 18,
    label:   'project instructions',
};

export function render(ctx: TemplateContext): string {
    return renderAgentTemplate(ctx, { hasSkills: true, requiresSkillUpload: true, name: 'Claude' });
}
