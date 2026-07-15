import { type TemplateContext, type TemplateMeta } from './context';
import { renderAgentTemplate } from './agentRender';

export const meta: TemplateMeta = {
    file:    '.github/copilot-instructions.md',
    version: 12,
    label:   'copilot instructions',
};

export function render(ctx: TemplateContext): string {
    return renderAgentTemplate(ctx, { hasSkills: true, requiresSkillUpload: false, name: 'GitHub Copilot' });
}
