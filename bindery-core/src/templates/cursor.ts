import type { TemplateContext, TemplateMeta } from './context';
import { renderAgentTemplate } from './agentRender';

export const meta: TemplateMeta = {
    file:    '.cursor/rules',
    version: 12,
    label:   'cursor rules',
};

export function render(ctx: TemplateContext): string {
    return renderAgentTemplate(ctx, { hasSkills: false, requiresSkillUpload: false, name: 'Cursor' });
}
