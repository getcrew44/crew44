// Mock data for the CrewAI desktop prototype.
// Single source of truth. Two task threads with realistic timelines so the
// product feels lived-in.

const AGENTS = {
  jordan: { id: 'jordan', name: 'Jordan', kind: 'human', color: '#A8A05C', initial: 'J' },
  aria:   { id: 'aria',   name: 'Aria',   kind: 'agent', role: 'Lead',     color: '#C4644A', initial: 'A' },
  nico:   { id: 'nico',   name: 'Nico',   kind: 'agent', role: 'Engineer', color: '#B8553E', initial: 'N' },
  milo:   { id: 'milo',   name: 'Milo',   kind: 'agent', role: 'Researcher', color: '#D17F58', initial: 'M' },
  rae:    { id: 'rae',    name: 'Rae',    kind: 'agent', role: 'QA',       color: '#9C6B47', initial: 'R' },
  ox:     { id: 'ox',     name: 'Ox',     kind: 'agent', role: 'Reviewer', color: '#6E5A45', initial: 'O' },
};

const PROJECTS = [
  {
    id: 'crewai-desktop',
    name: 'crewai-desktop',
    sessions: [
      { id: 't-114', title: 'Rework onboarding composer', age: '2h',  status: 'running' },
      { id: 't-112', title: 'Redo autopilot scheduler page', age: '1d', status: 'review' },
      { id: 't-109', title: 'Mobile-side implementation plan', age: '2d', status: 'done' },
      { id: 't-104', title: 'Rebuild cofounder mode system',  age: '4d', status: 'done' },
    ],
  },
  {
    id: 'research-portal',
    name: 'research-portal',
    sessions: [
      { id: 't-091', title: 'Audit Beijing campus access tiers', age: '2h', status: 'done' },
      { id: 't-088', title: 'Inspect work directory + submit',  age: '3h', status: 'done' },
      { id: 't-082', title: 'Review knowledge planet content',  age: '1w', status: 'done' },
    ],
  },
  {
    id: 'weekly-digest',
    name: 'weekly-digest',
    sessions: [
      { id: 't-077', title: 'Probe Codex client architecture', age: '1w', status: 'done' },
    ],
  },
  {
    id: 'prodlead-skills',
    name: 'prodlead-skills',
    sessions: [
      { id: 't-063', title: 'Build skill evaluation pipeline', age: '1w', status: 'done' },
      { id: 't-058', title: 'Diagnose skill file loader',      age: '1w', status: 'done' },
      { id: 't-052', title: 'Diff SKILL.md across releases',   age: '1w', status: 'done' },
    ],
  },
];

// Timelines are arrays of typed events. Renderer keys off `kind`.
const TIMELINES = {
  't-114': {
    id: 't-114',
    title: 'Rework onboarding composer',
    openedBy: 'jordan',
    openedAt: '2h',
    status: 'running',
    meta: ['3 subtasks · 1 done', 'lead · Aria', 'touches 4 files', 'elapsed 1h 42m'],
    events: [
      {
        kind: 'message', author: 'jordan', time: '14:58',
        body: "Let's rework the onboarding composer. It should feel like a first-run conversation, not a form. Keep it to 3 steps max. Ping the research you've already gathered.",
      },
      {
        kind: 'thinking', author: 'aria', time: '14:58', seconds: 23,
        reasoning: 'Goal is a conversational onboarding — three steps. I have the Milo audit from last week (12 first-runs, drop-off at field 4). I should split this so Nico can rewrite the composer in parallel while Milo pulls quotes for copy and Rae writes the new flow tests. I will lead.',
      },
      {
        kind: 'message', author: 'aria', time: '14:59',
        body: 'Formal task card written to {{file:experiment/tasks/onboarding-composer.md}} (line 1). Decomposing into 3 parallelizable subtasks. I\'ll drive, hand pieces off as they become blocking.',
      },
      {
        kind: 'subtask', id: 'st-1', title: 'Replace form with 3-step conversational flow', owner: 'nico', status: 'running',
        events: [
          { kind: 'tool', author: 'nico', time: '15:02', tool: 'read_file', path: 'src/components/onboarding/Form.tsx', result: 'ok', detail: '124 lines · last edited by Milo · Apr 21' },
          { kind: 'edit', author: 'nico', time: '15:06', path: 'src/components/onboarding/Composer.tsx', added: 48, removed: 12,
            diff: [
              { kind: 'ctx', text: 'export function OnboardingComposer() {' },
              { kind: 'del', text: '  const [form, setForm] = useState<FormState>(initial);' },
              { kind: 'add', text: '  const [step, setStep] = useState<Step>("greet");' },
              { kind: 'add', text: '  const [answers, setAnswers] = useAnswers();' },
              { kind: 'ctx', text: '  const { user } = useSession();' },
            ],
          },
          { kind: 'message', author: 'nico', time: '15:11',
            body: 'Three steps wired: greet → goal → workspace. Pulling copy from {{ref:milo}}\'s research dump in a sec.',
          },
        ],
      },
      {
        kind: 'subtask', id: 'st-2', title: 'Surface research from prior first-run audit', owner: 'milo', status: 'done',
        events: [
          { kind: 'tool', author: 'milo', time: '15:03', tool: 'search', path: 'research/onboarding-audit-apr.md', result: 'ok', detail: '6 matches for "drop-off"' },
          { kind: 'message', author: 'milo', time: '15:09', body: 'Top blockers from the Apr cohort: field overload (n=8), unclear value prop (n=5), workspace step confusion (n=3). Wrote a copy spec to {{file:experiment/tasks/onboarding-copy.md}}.' },
        ],
      },
      {
        kind: 'subtask', id: 'st-3', title: 'Replace flow integration tests', owner: 'rae', status: 'queued', events: [],
      },
    ],
  },
  't-112': {
    id: 't-112',
    title: 'Redo autopilot scheduler page',
    openedBy: 'jordan',
    openedAt: 'yesterday',
    status: 'review',
    meta: ['2 subtasks · 2 done', 'lead · Aria', 'touches 3 files', 'awaiting review'],
    events: [
      { kind: 'message', author: 'jordan', time: 'yesterday 09:12', body: 'The autopilot scheduler still looks like a cron form. Make it human — show me the next 5 runs as cards I can drag.' },
      { kind: 'thinking', author: 'aria', time: 'yesterday 09:13', seconds: 17, reasoning: 'Need to keep cron underneath but make timeline the primary surface. Draggable cards = react-dnd or a small custom solution. I\'ll have Nico ship the timeline component and Ox review the cron compatibility.' },
      { kind: 'message', author: 'aria', time: 'yesterday 09:13', body: 'Two subtasks. Ox will guard the cron round-trip so we don\'t regress existing schedules.' },
      { kind: 'subtask', id: 'st-1', title: 'Build draggable timeline of next 5 runs', owner: 'nico', status: 'done', events: [
        { kind: 'edit', author: 'nico', time: 'yesterday 11:40', path: 'src/components/autopilot/Timeline.tsx', added: 142, removed: 0, diff: [
          { kind: 'add', text: 'export function Timeline({ runs, onReorder }: Props) {' },
          { kind: 'add', text: '  const [drag, setDrag] = useDragState();' },
        ]},
      ]},
      { kind: 'subtask', id: 'st-2', title: 'Round-trip cron ↔ timeline', owner: 'ox', status: 'done', events: [
        { kind: 'message', author: 'ox', time: 'yesterday 14:02', body: 'Confirmed: every cron string the old page accepted produces the same 5 cards. Added a fuzzer at {{file:test/cron-roundtrip.test.ts}}.' },
      ]},
      { kind: 'message', author: 'aria', time: 'yesterday 14:05', body: 'Ready for your review @jordan. Click into the live preview from the task header.' },
    ],
  },
};

// Mutation helpers for interactivity
let _nextTaskNum = 115;

window.addEventToTask = function(taskId, event) {
  const task = TIMELINES[taskId];
  if (!task) return;
  task.events.push(event);
  if (window.notifyTaskUpdate) window.notifyTaskUpdate();
};

window.createTask = function(projectId, title, firstMessage) {
  const id = 't-' + _nextTaskNum++;
  const now = new Date();
  const timeStr = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
  TIMELINES[id] = {
    id, title,
    openedBy: 'jordan',
    openedAt: 'just now',
    status: 'running',
    meta: ['0 subtasks', 'lead · Aria', 'touches 0 files', 'elapsed 0s'],
    events: [
      { kind: 'message', author: 'jordan', time: timeStr, body: firstMessage },
    ],
  };
  const proj = PROJECTS.find(p => p.id === projectId) || PROJECTS[0];
  proj.sessions.unshift({ id, title, age: 'just now', status: 'running' });
  return id;
};

window.setTaskStatus = function(taskId, status) {
  if (!TIMELINES[taskId]) return;
  TIMELINES[taskId].status = status;
  const session = PROJECTS.flatMap(p => p.sessions).find(s => s.id === taskId);
  if (session) session.status = status;
  if (window.notifyTaskUpdate) window.notifyTaskUpdate();
};

Object.assign(window, { AGENTS, PROJECTS, TIMELINES });
