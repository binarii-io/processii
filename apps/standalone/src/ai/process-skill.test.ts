import { describe, expect, it } from 'vitest';
import { PROCESS_SKILL_PROMPT, matchesProcessSkill, processSkillActive } from './process-skill.js';

describe('process-skill', () => {
  it('detects business process requests', () => {
    expect(matchesProcessSkill('modélise un processus métier')).toBe(true);
    expect(matchesProcessSkill('ajoute des swimlanes par acteur')).toBe(true);
    expect(matchesProcessSkill('le workflow de validation')).toBe(true);
    expect(matchesProcessSkill('mets cette étape en rouge')).toBe(false);
  });

  it('active when swimlanes exist, even without a keyword', () => {
    expect(processSkillActive('déplace les étapes', 0)).toBe(false);
    expect(processSkillActive('déplace les étapes', 3)).toBe(true);
    expect(processSkillActive('réorganise le process', 0)).toBe(true);
  });

  it('the prompt covers swimlanes, flow, past-tense wording and handoff', () => {
    const p = PROCESS_SKILL_PROMPT.toLowerCase();
    expect(p).toContain('swimlane');
    expect(p).toContain('gauche');
    expect(p).toContain('acteur');
    expect(p).toContain('passé');
    expect(p).toContain('transmis');
    expect(p).toContain('reçu');
    expect(p).toContain('user');
  });
});
