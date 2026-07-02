/**
 * **"Business process modeling" skill**: a best-practice block injected into the system prompt
 * **only when relevant** — either the user's message mentions process / business / swimlane…,
 * or the board already contains swimlanes (active process context).
 *
 * Goal: the assistant properly understands the **swimlane** concept (lane = actor/role) and the
 * **left→right temporal flow**, instead of stacking steps or breaking the sequence.
 */

// Triggers (on the lowercased user message). Intentionally broad.
const KEYWORDS = [
  'process',
  'processus',
  'métier',
  'metier',
  'swimlane',
  'swimline',
  'swim lane',
  'bpmn',
  'workflow',
  'flux',
  'parcours',
  'acteur',
  'rôle',
  'role',
  'modélis',
  'modelis',
  'diagramme',
] as const;

/** True when the text refers to business process modeling. */
export function matchesProcessSkill(text: string): boolean {
  const t = text.toLowerCase();
  return KEYWORDS.some((k) => t.includes(k));
}

/** Best practices injected when the skill is active. */
export const PROCESS_SKILL_PROMPT = [
  'BONNES PRATIQUES — modélisation de **processus métier** (applique-les pour ce type de demande) :',
  '- **Swimlanes = acteurs/rôles** (bandes HORIZONTALES) : chaque bande = QUI réalise l’étape. À la',
  '  création, choisis le bon `laneType` : "user" pour un acteur HUMAIN (rôle/personne), "system" pour',
  '  un système automatisé, "custom" UNIQUEMENT si ce n’est ni l’un ni l’autre (et précise `customType`).',
  '  N’utilise pas "custom" par défaut.',
  '- **Temps de GAUCHE → DROITE** : crée les étapes dans l’**ordre chronologique réel** (toutes bandes',
  '  confondues) — leur position x suit l’ordre de création. N’enchaîne PAS toutes les étapes d’une bande',
  '  puis celles d’une autre : alterne selon la chronologie du process. Rattache chaque étape à la',
  '  swimlane de son acteur via `swimlaneId` (place dans la bande + garde le flux). La verticale =',
  '  l’ACTEUR, pas le temps. (Tu peux aussi forcer un `x` explicite croissant si besoin.)',
  '- **Rédaction des étapes** : TOUJOURS au **passé**, à la 1re personne, en commençant par « J’ai… »,',
  '  « On a… » ou « Nous avons… » (ex. « J’ai soumis la demande », « Nous avons évalué la demande »).',
  '  Vaut pour TOUS les acteurs, **peu importe que le système soit humain ou technique** (un système',
  '  écrit aussi « J’ai vérifié… », « J’ai notifié… »).',
  '- Le `name` reste COURT (un titre). Mets le détail dans le champ **`description`** (corps de la carte),',
  '  PAS dans le name. Pose la description en **une seule fois** par étape (ne la ré-écris pas vide ensuite).',
  '- **Texte des étapes TOUJOURS aligné à GAUCHE** (textAlign="left").',
  '- **L’appartenance à une bande est GÉOMÉTRIQUE** : une étape n’est « dans » une bande que si sa',
  '  position (x, y) tombe dans le rectangle de la bande (voir la géométrie dans l’état du board :',
  '  chaque bande a un intervalle `y top→bas` et une `Largeur partagée`). **Poser `swimlaneId` ne',
  '  déplace PAS la carte** : pour RANGER / DÉPLACER une étape dans une bande, utilise **`moveStepToLane`**',
  '  (il pose le rattachement ET repositionne la carte, en agrandissant la bande si besoin). N’affirme',
  '  jamais qu’une carte est « dans » une bande sans vérifier sa géométrie dans l’état du board.',
  '- **Si l’état du board signale une incohérence** (⚠ « hors de sa bande ») : CORRIGE-la — `moveStepToLane`',
  '  pour une carte précise, ou **`tidyLayout`** pour ranger tout le board (agrandit les bandes trop',
  '  petites, recentre les cartes, étend la largeur). Ne laisse jamais une incohérence non traitée.',
  '- **Redimensionner une bande** : `updateSwimlane` avec `height` (hauteur d’une bande). **Largeur**',
  '  (partagée par toutes les bandes) : `setLanesWidth`. Agrandis une bande quand les cartes y sont à',
  '  l’étroit ou la débordent.',
  '- **Réordonner les bandes** (ordre de haut en bas) : `reorderSwimlane` — `toIndex` (0 = tout en haut)',
  '  pour une position absolue, ou `before`/`after` (nom/id d’une autre bande) pour un placement relatif.',
  '  Les cartes suivent leur bande. Ex. « remonte le client tout en haut », « mets le système sous le RH ».',
  '- **Transmission d’information = changement de swimlane** : à CHAQUE passage d’un acteur à un autre,',
  '  utilise l’outil **`addHandoff`** (il crée la paire « J’ai transmis/envoyé… » dans la bande source et',
  '  « J’ai reçu… » dans la bande destination, **alignées verticalement** au même x, et les relie). Ne',
  '  fabrique pas ces paires à la main. **Respecte toujours cette transmission**, SAUF si un processus',
  '  d’une autre bande se déclenche **sans trigger ni transmission d’info** (ex. tâche autonome/planifiée) :',
  '  dans ce cas, pas de paire envoi/réception.',
  '- Les étapes de transmission (créées par `addHandoff`) sont des **étapes comme les autres** (même',
  '  objet). Pour **TOUTE modification** demandée « sur les étapes » (description, skills, livrables, mise',
  '  en forme, couleur, émotion, alignement, déplacement…), **inclus TOUJOURS les étapes de transmission**',
  '  — ne les traite jamais à part.',
  '- **Réutilise les swimlanes existantes** (vois l’état du board ci-dessous) : ne recrée jamais une bande',
  '  qui existe déjà (même nom).',
  '- **Connecteurs** : par DÉFAUT, chaque changement d’acteur (passage entre bandes) = un **`addHandoff`**',
  '  (envoi+réception alignés verticalement). `connectSteps` relie deux étapes (en général la même bande).',
  '  **Exception** : si l’utilisateur demande explicitement un lien direct entre deux bandes, fais-le avec',
  '  `connectSteps` — sa volonté prime sur cette consigne.',
  '- `skills` = compétences mobilisées ; `deliverables` = livrables produits.',
  '- **N’oublie pas la séquence intra-bande** : relie les étapes successives d’un même acteur. Le plus sûr',
  '  est `connectFlow` avec la liste ORDONNÉE des ids de la bande (un appel par bande).',
  '- Ordre de travail : (1) swimlanes (acteurs, bon type), (2) étapes au passé, rattachées et ordonnées en',
  '  x, + handoffs aux changements d’acteur, (3) **`connectFlow` pour la séquence de chaque bande**,',
  '  (4) **termine TOUJOURS par `tidyFlow`** (complète les liens de séquence manquants et corrige les sens',
  '  inversés) **puis `tidyLayout`** (range la mise en page : hauteurs de bande, recentrage, largeur).',
].join('\n');

/** Decides whether the skill must be active for this turn. */
export function processSkillActive(userMessage: string, swimlaneCount: number): boolean {
  return matchesProcessSkill(userMessage) || swimlaneCount > 0;
}
