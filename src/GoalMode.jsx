import React from 'react';
import { Avatar, UI_FONT, MONO_FONT } from './components.jsx';
import { resolveAuthor } from './utils.js';

// Goal mode UI (docs/goal-0610.md), ported from mocks/CrewAI v3/goal.jsx.
// Events: goal_clarify (scoping questions), goal_lock (divider), goal_verify
// (gate run), goal_done (sign-off banner), goal_signoff (resolution divider).
// Plus the pinned GoalCard checklist, the New Task GoalModeChip, and the
// header GoalHeaderPill. Live goal state arrives on chat.goal.

// Goal identity: the same brass/gold family the worktree pill uses.
const G = {
  ink:    '#1C1A17',
  ink2:   '#5C544B',
  ink3:   '#807972',
  ink4:   '#A89F92',
  line:   '#ECE6D5',
  line2:  '#DCD3BC',
  card:   '#FCFAF1',
  cardHi: '#FFFEF8',
  gold:   '#7A6420',
  goldBg: '#F8EFC9',
  goldLn: '#E6D6A4',
  ok:     '#3E7A4A',
  okSoft: '#6E9E5B',
  okBg:   '#E8F1DE',
  err:    '#B23A2E',
  errSoft:'#FBEEE7',
};

export function GoalGlyph({ size = 12, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" style={{ display: 'block', ...style }}>
      <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="7" cy="7" r="2.9" fill="none" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="7" cy="7" r="0.9" fill="currentColor"/>
    </svg>
  );
}

const GIco = {
  check: (p) => <svg width="10" height="10" viewBox="0 0 10 10" {...p}>
    <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>,
  x: (p) => <svg width="9" height="9" viewBox="0 0 9 9" {...p}>
    <path d="M2 2l5 5M7 2l-5 5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
  </svg>,
  spin: (p) => <svg width="11" height="11" viewBox="0 0 11 11" {...p}>
    <circle cx="5.5" cy="5.5" r="3.5" stroke="currentColor" strokeWidth="1.1" fill="none" strokeDasharray="3 3"/>
  </svg>,
  chev: (p) => <svg width="10" height="10" viewBox="0 0 10 10" {...p}>
    <path d="M3.5 2L7 5 3.5 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>,
  pencil: (p) => <svg width="10" height="10" viewBox="0 0 11 11" {...p}>
    <path d="M2 9l0.6-2.2L7.8 1.6a1 1 0 0 1 1.4 0l0.2 0.2a1 1 0 0 1 0 1.4L4.2 8.4 2 9z" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinejoin="round"/>
  </svg>,
  plus: (p) => <svg width="10" height="10" viewBox="0 0 10 10" {...p}>
    <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>,
};

// Per-criterion / per-row status dot. Daemon statuses: pending | verified |
// failed (criteria), pass | fail | pending (verify rows). The running state
// is kept for forward-compat with live gate progress but never fed in v1.
function GoalStatusIcon({ status, size = 15 }) {
  const base = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };
  if (status === 'verified' || status === 'pass') return (
    <span data-testid="goal-status-pass" style={{ ...base, background: G.okSoft, color: '#FCFBF7' }}><GIco.check /></span>
  );
  if (status === 'failed' || status === 'fail') return (
    <span data-testid="goal-status-fail" style={{ ...base, background: G.err, color: '#FCFBF7' }}><GIco.x /></span>
  );
  if (status === 'running') return (
    <span style={{ ...base, color: G.gold }}>
      <span style={{ display: 'flex', animation: 'cw-spin 1.2s linear infinite' }}><GIco.spin /></span>
    </span>
  );
  return (
    <span data-testid="goal-status-pending" style={{ ...base, border: '1.4px solid ' + G.line2, boxSizing: 'border-box' }} />
  );
}

const GOAL_STATUS_LABEL = {
  verified: 'verified', pass: 'passed', failed: 'failed', fail: 'failed',
  running: 'running', pending: 'pending',
};

function formatGoalElapsed(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds - hours * 3600) / 60);
  if (hours) return `${hours}h ${mins}m`;
  if (mins) return `${mins}m`;
  return `${seconds}s`;
}

// ── GoalCard: pinned, editable criteria checklist ───────────────────────
function GoalProgressTicks({ criteria }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {criteria.map(c => (
        <span key={c.id} title={GOAL_STATUS_LABEL[c.status] || c.status} style={{
          width: 12, height: 4, borderRadius: 2,
          background:
            c.status === 'verified' ? G.okSoft :
            c.status === 'failed'   ? G.err :
            c.status === 'running'  ? G.gold : G.line2,
        }} />
      ))}
    </span>
  );
}

const goalIconBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 20, height: 20, borderRadius: 5, cursor: 'pointer',
  background: 'transparent', border: '1px solid ' + G.line2,
  color: G.ink3, padding: 0,
};

function GoalCriterionRow({ c, onEdit, onRemove }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(c.text);
  const [hover, setHover] = React.useState(false);

  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== c.text) onEdit(t);
    else setDraft(c.text);
  };

  return (
    <div
      data-testid="goal-criterion-row"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 14px', fontFamily: UI_FONT,
        background: hover ? G.cardHi : 'transparent',
      }}
    >
      <GoalStatusIcon status={c.status} />
      {editing ? (
        <input
          autoFocus
          data-testid="goal-criterion-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setDraft(c.text); setEditing(false); }
          }}
          style={{
            flex: 1, fontFamily: UI_FONT, fontSize: 13, color: G.ink,
            border: '1px solid ' + G.goldLn, borderRadius: 5, padding: '3px 7px',
            background: G.cardHi, outline: 'none',
          }}
        />
      ) : (
        <span style={{
          flex: 1, fontSize: 13, lineHeight: 1.45, minWidth: 0,
          color: c.status === 'verified' ? G.ink2 : G.ink,
        }}>
          {c.text}
          {c.detail && (
            <span style={{
              marginLeft: 8, fontFamily: MONO_FONT, fontSize: 11,
              color: c.status === 'failed' ? G.err : G.ink4,
            }}>{c.detail}</span>
          )}
        </span>
      )}
      <span style={{
        display: 'inline-flex', gap: 2, flexShrink: 0, width: 38,
        justifyContent: 'flex-end',
        opacity: hover && !editing ? 1 : 0, transition: 'opacity .12s',
      }}>
        <button
          title="Edit criterion"
          data-testid="goal-criterion-edit"
          onClick={() => { setDraft(c.text); setEditing(true); }}
          style={goalIconBtn}
        ><GIco.pencil /></button>
        <button
          title="Remove criterion"
          data-testid="goal-criterion-remove"
          onClick={onRemove}
          style={goalIconBtn}
        ><GIco.x /></button>
      </span>
    </div>
  );
}

// Pinned above the conversation. Edits commit immediately through
// onSave({ criteria }) — the whole-list-replacement RPC — and the
// authoritative state flows back via chat.updated, so there is no local
// dirty copy to drift.
export function GoalCard({ goal, onSave }) {
  const drafting = goal.phase === 'scoping';
  const [open, setOpen] = React.useState(false);
  const [edited, setEdited] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [addDraft, setAddDraft] = React.useState('');
  React.useEffect(() => { setEdited(false); }, [goal.phase]);

  const criteria = goal.criteria || [];
  const verified = criteria.filter(c => c.status === 'verified').length;
  const anyFailed = criteria.some(c => c.status === 'failed');
  const allVerified = !drafting && criteria.length > 0 && verified === criteria.length;

  const toInputs = (list) => list.map(c => ({ id: c.id, text: c.text, verify: c.verify }));
  const commitList = (list) => {
    setEdited(true);
    onSave({ criteria: toInputs(list) });
  };
  const editCriterion = (id, text) => {
    commitList(criteria.map(c => (c.id === id ? { ...c, text } : c)));
  };
  const removeCriterion = (id) => {
    commitList(criteria.filter(c => c.id !== id));
  };
  const commitAdd = () => {
    const t = addDraft.trim();
    if (t) commitList([...criteria, { text: t, verify: '' }]);
    setAddDraft('');
    setAdding(false);
  };

  return (
    <div data-testid="goal-card" style={{
      margin: '12px 0 0',
      border: drafting ? '1px dashed ' + G.goldLn : '1px solid ' + (allVerified ? '#C5DCB4' : G.goldLn),
      borderRadius: 10, background: allVerified ? G.okBg : G.goldBg,
      overflow: 'hidden', flexShrink: 0,
      fontFamily: UI_FONT,
    }}>
      <button
        onClick={() => !drafting && setOpen(o => !o)}
        data-testid="goal-card-bar"
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '8px 14px', background: 'transparent', border: 'none',
          cursor: drafting ? 'default' : 'pointer', textAlign: 'left',
          fontFamily: UI_FONT,
        }}
      >
        <span style={{ color: allVerified ? G.ok : G.gold, display: 'flex', flexShrink: 0 }}>
          <GoalGlyph size={14} />
        </span>
        <span style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8,
          color: allVerified ? G.ok : G.gold, textTransform: 'uppercase', flexShrink: 0,
        }}>Goal</span>
        {drafting ? (
          <span style={{ fontSize: 12.5, color: G.ink3, flex: 1, minWidth: 0 }}>
            Drafting — the lead agent is scoping the goal with you below. Criteria lock in here.
          </span>
        ) : (
          <>
            <span style={{
              fontSize: 13, fontWeight: 500, color: G.ink, flex: 1, minWidth: 0,
              lineHeight: 1.4,
              // Collapsed: one ellipsized line. Expanded: the full statement
              // wraps so the goal is never hidden behind an ellipsis.
              ...(open
                ? { whiteSpace: 'normal', overflowWrap: 'break-word', textWrap: 'pretty' }
                : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
            }}>{goal.statement}</span>
            <GoalProgressTicks criteria={criteria} />
            <span data-testid="goal-card-progress" style={{
              fontSize: 12, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap',
              color: allVerified ? G.ok : anyFailed ? G.err : G.ink2,
            }}>
              {verified}/{criteria.length} verified
            </span>
            {goal.attempt > 0 && !allVerified && (
              <span style={{
                fontSize: 11, fontFamily: MONO_FONT, color: G.gold,
                background: G.cardHi, border: '1px solid ' + G.goldLn,
                padding: '1px 7px', borderRadius: 999, flexShrink: 0,
                whiteSpace: 'nowrap',
              }}>attempt {goal.attempt}</span>
            )}
            <span style={{
              color: G.ink4, display: 'flex', flexShrink: 0,
              transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s',
            }}><GIco.chev /></span>
          </>
        )}
      </button>

      {/* Expand/collapse animates via the grid 0fr→1fr trick: the content
          stays mounted and the row track tweens its height, so no measuring
          is needed and both directions ease smoothly. */}
      {!drafting && (
        <div style={{
          display: 'grid',
          gridTemplateRows: open ? '1fr' : '0fr',
          transition: 'grid-template-rows 240ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}>
        <div aria-hidden={!open} style={{
          overflow: 'hidden', minHeight: 0,
          // Drop out of the focus/AT tree only after the collapse finishes,
          // so the animation isn't cut short.
          visibility: open ? 'visible' : 'hidden',
          transition: 'visibility 0s ' + (open ? '0s' : '240ms'),
        }}>
        <div style={{
          borderTop: '1px solid ' + (allVerified ? '#D3E5C5' : '#EFE3BC'), background: G.card,
          opacity: open ? 1 : 0,
          transition: 'opacity 180ms ease' + (open ? ' 60ms' : ''),
        }}>
          <div style={{ padding: '4px 0' }}>
            {criteria.map(c => (
              <GoalCriterionRow
                key={c.id} c={c}
                onEdit={(text) => editCriterion(c.id, text)}
                onRemove={() => removeCriterion(c.id)}
              />
            ))}
            {adding ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px' }}>
                <GoalStatusIcon status="pending" />
                <input
                  autoFocus
                  data-testid="goal-criterion-add-input"
                  value={addDraft}
                  onChange={(e) => setAddDraft(e.target.value)}
                  onBlur={commitAdd}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitAdd();
                    if (e.key === 'Escape') { setAddDraft(''); setAdding(false); }
                  }}
                  placeholder="New criterion — make it checkable"
                  style={{
                    flex: 1, fontFamily: UI_FONT, fontSize: 13, color: G.ink,
                    border: '1px solid ' + G.goldLn, borderRadius: 5, padding: '3px 7px',
                    background: G.cardHi, outline: 'none',
                  }}
                />
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                data-testid="goal-criterion-add"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 14px', background: 'transparent', border: 'none',
                  cursor: 'pointer', color: G.ink4, fontFamily: UI_FONT, fontSize: 12,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = G.ink2; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = G.ink4; }}
              >
                <span style={{ display: 'flex', marginLeft: 2 }}><GIco.plus /></span>
                Add criterion
              </button>
            )}
          </div>
          <div style={{
            padding: '6px 14px', borderTop: '1px solid ' + G.line,
            fontSize: 11.5, color: G.ink4, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {edited ? (
              <span style={{ color: G.gold }}>
                Checklist edited — changed criteria reset to pending and the gate re-arms on the next run.
              </span>
            ) : allVerified ? (
              <span style={{ color: G.ok }}>Every criterion verified. Awaiting your sign-off below.</span>
            ) : (
              <span>The crew keeps iterating until every check passes. Edit any criterion — it’s a living checklist.</span>
            )}
          </div>
        </div>
        </div>
        </div>
      )}
    </div>
  );
}

// ── goal_clarify event ──────────────────────────────────────────────────
// Interactive only while it is the goal's active clarify round (matching
// chat.goal.clarify_seq) in the scoping phase with no answers yet. Once
// answers land on chat.goal (via chat.updated), it collapses to a summary.
export function GoalClarifyEvent({ event, agentsMap, showHeader = true, chatGoal, onAnswer }) {
  const agent = resolveAuthor(event.author, agentsMap);
  const isCurrentRound = chatGoal && chatGoal.clarify_seq === event._seq && chatGoal.phase === 'scoping';
  const storedAnswers = (chatGoal && chatGoal.answers) || null;
  const answered = !isCurrentRound || (storedAnswers && Object.keys(storedAnswers).length > 0);

  const [answers, setAnswers] = React.useState({});
  const [open, setOpen] = React.useState(!answered);
  const [submitting, setSubmitting] = React.useState(false);
  React.useEffect(() => { setOpen(!answered); }, [answered]);

  const questions = event.questions || [];
  const chipQs = questions.filter(q => q.type === 'chips');
  const answeredCount = chipQs.filter(q => answers[q.id] != null).length;
  const ready = answeredCount === chipQs.length && !submitting;

  const submit = async () => {
    if (!ready || !onAnswer) return;
    setSubmitting(true);
    try {
      const payload = questions.map(q => (
        q.type === 'chips'
          ? { question_id: q.id, option: answers[q.id] }
          : { question_id: q.id, text: answers[q.id] || '' }
      ));
      await onAnswer(payload);
    } finally {
      setSubmitting(false);
    }
  };

  const header = !showHeader ? null : (
    <div style={{ fontSize: 13.5, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontWeight: 600, color: G.ink }}>{agent?.name || 'Agent'}</span>
      <span style={{ color: G.ink4 }}>· {event.time}</span>
    </div>
  );
  const gutter = showHeader && agent
    ? <Avatar agent={agent} size={28} />
    : <div style={{ width: 28, flexShrink: 0 }} />;

  // Collapsed summary once the round is answered or superseded.
  if (answered && !open) {
    return (
      <div data-testid="goal-clarify-collapsed" style={{ display: 'flex', gap: 14, padding: showHeader ? '14px 0 2px' : '2px 0' }}>
        {gutter}
        <div style={{ flex: 1, minWidth: 0 }}>
          {header}
          <button
            onClick={() => setOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '4px 8px', borderRadius: 6, textAlign: 'left',
              background: 'transparent', border: '1px solid transparent',
              cursor: 'pointer', fontFamily: UI_FONT, color: G.ink3,
            }}
          >
            <span style={{ color: G.ink4, display: 'flex' }}><GIco.chev /></span>
            <span style={{ color: G.gold, display: 'flex' }}><GoalGlyph size={11} /></span>
            <span style={{ fontSize: 12 }}>
              Scoped the goal · {questions.length} questions
            </span>
            <span style={{
              fontSize: 11.5, color: G.ink4, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
            }}>
              {storedAnswers ? questions.map(q => storedAnswers[q.id]).filter(Boolean).join(' · ') : ''}
            </span>
          </button>
        </div>
      </div>
    );
  }

  const locked = answered;
  const selectedFor = (q) => {
    if (locked && storedAnswers) {
      const idx = (q.options || []).indexOf(storedAnswers[q.id]);
      return idx >= 0 ? idx : null;
    }
    return answers[q.id] != null ? answers[q.id] : null;
  };

  return (
    <div data-testid="goal-clarify" style={{ display: 'flex', gap: 14, padding: showHeader ? '14px 0 2px' : '2px 0' }}>
      {gutter}
      <div style={{ flex: 1, minWidth: 0 }}>
        {header}
        {event.intro && (
          <div style={{ fontSize: 14, color: G.ink, lineHeight: 1.55, marginBottom: 10, textWrap: 'pretty' }}>
            {event.intro}
          </div>
        )}

        <div style={{
          border: '1px solid ' + G.goldLn, borderRadius: 10,
          background: G.cardHi, overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 14px', background: G.goldBg,
            borderBottom: '1px solid #EFE3BC',
          }}>
            <span style={{ color: G.gold, display: 'flex' }}><GoalGlyph size={12} /></span>
            <span style={{ fontSize: 12, fontWeight: 600, color: G.gold }}>
              Scoping the goal
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: G.gold, fontFamily: MONO_FONT, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {locked ? 'locked' : `${answeredCount} of ${chipQs.length} answered`}
            </span>
            {locked && (
              <button onClick={() => setOpen(false)} title="Collapse" style={{
                ...goalIconBtn, borderColor: G.goldLn, color: G.gold,
                transform: 'rotate(-90deg)',
              }}><GIco.chev /></button>
            )}
          </div>

          <div style={{ padding: '6px 14px 12px' }}>
            {questions.map((q) => (
              <div key={q.id} style={{ padding: '8px 0 2px' }}>
                <div style={{
                  fontSize: 12.5, color: G.ink2, marginBottom: 7,
                  display: 'flex', alignItems: 'center', gap: 7,
                }}>
                  <span style={{ fontWeight: 500 }}>{q.q}</span>
                  {q.type === 'chips' && selectedFor(q) != null && (
                    <span style={{ color: G.ok, display: 'flex' }}><GIco.check /></span>
                  )}
                </div>
                {q.type === 'chips' ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(q.options || []).map((opt, i) => {
                      const sel = selectedFor(q) === i;
                      return (
                        <button
                          key={i}
                          data-testid="goal-clarify-chip"
                          disabled={locked && !sel}
                          onClick={() => !locked && setAnswers(s => ({ ...s, [q.id]: i }))}
                          style={{
                            padding: '4px 11px', borderRadius: 999, fontSize: 12.5,
                            fontFamily: UI_FONT,
                            cursor: locked ? 'default' : 'pointer',
                            border: '1px solid ' + (sel ? G.gold : G.line2),
                            background: sel ? G.goldBg : 'transparent',
                            color: sel ? G.gold : G.ink2,
                            fontWeight: sel ? 600 : 400,
                            opacity: locked && !sel ? 0.45 : 1,
                          }}
                        >
                          {opt}
                          {q.rec === i && !sel && !locked && (
                            <span style={{ color: G.ink4, fontWeight: 400 }}> · suggested</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  locked ? (
                    <div style={{ fontSize: 12.5, color: G.ink, padding: '4px 0' }}>
                      {(storedAnswers && storedAnswers[q.id]) || <span style={{ color: G.ink4 }}>—</span>}
                    </div>
                  ) : (
                    <input
                      data-testid="goal-clarify-text"
                      value={answers[q.id] || ''}
                      onChange={(e) => setAnswers(s => ({ ...s, [q.id]: e.target.value }))}
                      placeholder={q.placeholder}
                      style={{
                        width: '60%', minWidth: 240, fontFamily: UI_FONT, fontSize: 12.5,
                        color: G.ink, border: '1px solid ' + G.line2, borderRadius: 6,
                        padding: '5px 9px', background: G.cardHi, outline: 'none',
                      }}
                    />
                  )
                )}
              </div>
            ))}
          </div>

          {!locked && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 14px', borderTop: '1px solid ' + G.line,
              background: G.card,
            }}>
              <span style={{ fontSize: 11.5, color: G.ink4, flex: 1 }}>
                Answers become the criteria. Nothing runs until the goal locks.
              </span>
              <button
                disabled={!ready}
                data-testid="goal-clarify-lock"
                onClick={submit}
                style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 500,
                  fontFamily: UI_FONT,
                  border: '1px solid ' + (ready ? G.ink : G.line2),
                  background: ready ? G.ink : G.card,
                  color: ready ? '#FCFBF7' : G.ink4,
                  cursor: ready ? 'pointer' : 'default',
                }}
              >
                {submitting ? 'Locking…' : 'Lock in goal →'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── goal_lock divider ───────────────────────────────────────────────────
export function GoalLockDivider({ event }) {
  const count = (event.criteria || []).length;
  return (
    <div data-testid="goal-lock-divider" style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '14px 0 10px', userSelect: 'none', fontFamily: UI_FONT,
    }}>
      <div style={{ flex: 1, borderTop: '1px dashed ' + G.line2 }} />
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '4px 12px', borderRadius: 999,
        background: G.goldBg, border: '1px solid ' + G.goldLn,
      }}>
        <span style={{ color: G.gold, display: 'flex' }}><GoalGlyph size={12} /></span>
        <span style={{ fontSize: 12, color: G.gold, fontWeight: 600, whiteSpace: 'nowrap' }}>Goal locked</span>
        <span style={{ fontSize: 12, color: '#9A8434' }}>
          · {count} criteria · gate armed — crew iterates until every check passes
        </span>
      </span>
      <div style={{ flex: 1, borderTop: '1px dashed ' + G.line2 }} />
    </div>
  );
}

// ── goal_verify event ───────────────────────────────────────────────────
export function GoalVerifyEvent({ event }) {
  const overall = event.overall; // passed | failed (running reserved for live gates)
  const headBg = overall === 'failed' ? G.errSoft : overall === 'passed' ? G.okBg : G.goldBg;
  const headLn = overall === 'failed' ? '#EFD3C9' : overall === 'passed' ? '#D3E5C5' : '#EFE3BC';
  const headCol = overall === 'failed' ? G.err : overall === 'passed' ? G.ok : G.gold;

  return (
    <div data-testid="goal-verify" style={{ display: 'flex', gap: 14, padding: '10px 0' }}>
      <div style={{ width: 28, flexShrink: 0, display: 'flex', justifyContent: 'center', paddingTop: 4 }}>
        <span style={{ color: headCol }}><GoalGlyph size={16} /></span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          border: '1px solid ' + headLn, borderRadius: 10,
          background: G.cardHi, overflow: 'hidden', fontFamily: UI_FONT,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 14px', background: headBg,
            borderBottom: '1px solid ' + headLn,
          }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: headCol }}>
              Verification gate
            </span>
            <span style={{ fontSize: 11.5, fontFamily: MONO_FONT, color: headCol, opacity: 0.85, whiteSpace: 'nowrap', flexShrink: 0 }}>
              attempt {event.attempt}
            </span>
            <span style={{ flex: 1 }} />
            {overall === 'running' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: G.gold }}>
                <span style={{ display: 'flex', animation: 'cw-spin 1.2s linear infinite' }}><GIco.spin /></span>
                running
              </span>
            )}
            {overall === 'failed' && (
              <span data-testid="goal-verify-held" style={{ fontSize: 11.5, fontWeight: 600, color: G.err }}>gate held</span>
            )}
            {overall === 'passed' && (
              <span data-testid="goal-verify-passed" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: G.ok }}>
                <GIco.check /> all checks passed
              </span>
            )}
            <span style={{ fontSize: 11.5, color: G.ink4 }}>{event.time}</span>
          </div>

          <div style={{ padding: '4px 0' }}>
            {(event.rows || []).map((r) => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '5px 14px',
              }}>
                <GoalStatusIcon status={r.status} size={14} />
                <span style={{
                  fontSize: 12.5, flex: 1, minWidth: 0,
                  color: r.status === 'fail' ? G.err : r.status === 'pending' ? G.ink4 : G.ink2,
                  fontWeight: r.status === 'fail' ? 500 : 400,
                }}>
                  {r.text}
                  {r.detail && (
                    <span style={{
                      marginLeft: 8, fontFamily: MONO_FONT, fontSize: 11,
                      color: r.status === 'fail' ? G.err : G.ink4,
                    }}>{r.detail}</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div style={{
            padding: '7px 14px', borderTop: '1px solid ' + G.line,
            fontSize: 12, lineHeight: 1.5,
            color: overall === 'failed' ? G.err : overall === 'passed' ? G.ok : G.ink3,
            background: G.card,
          }}>
            {event.outcome}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── goal_done event ─────────────────────────────────────────────────────
// Sign-off buttons live here, gated on the goal still awaiting sign-off.
// After accept the chat.goal phase flips to done and the banner shows the
// accepted state; a send_back drops the phase back to running and the
// buttons disappear with it.
export function GoalDoneEvent({ event, chatGoal, onSignoff }) {
  const awaiting = chatGoal?.phase === 'awaiting_signoff';
  const accepted = chatGoal?.phase === 'done';
  const [sendingBack, setSendingBack] = React.useState(false);
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const act = async (action, actionNotes) => {
    if (!onSignoff || busy) return;
    setBusy(true);
    try {
      await onSignoff(action, actionNotes);
      setSendingBack(false);
      setNotes('');
    } finally {
      setBusy(false);
    }
  };

  const stats = [
    { label: 'criteria', value: `${event.criteriaTotal} / ${event.criteriaTotal}` },
    { label: 'attempts', value: String(event.attempts) },
    { label: 'elapsed', value: formatGoalElapsed(event.elapsedSeconds) },
  ];

  return (
    <div data-testid="goal-done" style={{ display: 'flex', gap: 14, padding: '12px 0' }}>
      <div style={{ width: 28, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          border: '1px solid #C5DCB4', borderRadius: 12,
          background: G.okBg, overflow: 'hidden', fontFamily: UI_FONT,
        }}>
          <div style={{ padding: '16px 18px 14px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <span style={{
              width: 34, height: 34, borderRadius: '50%', background: G.okSoft,
              color: '#FCFBF7', display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexShrink: 0, marginTop: 2,
            }}>
              <svg width="16" height="16" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: G.ok }}>Goal reached</span>
                <span style={{ fontSize: 11.5, color: '#7C9468' }}>{event.time}</span>
              </div>
              <div style={{ fontSize: 13.5, color: G.ink, marginTop: 4, lineHeight: 1.5, textWrap: 'pretty' }}>
                {event.statement}
              </div>
              <div style={{ display: 'flex', gap: 22, marginTop: 12, flexWrap: 'wrap' }}>
                {stats.map((s, i) => (
                  <div key={i}>
                    <div style={{ fontFamily: MONO_FONT, fontSize: 14, fontWeight: 600, color: G.ink }}>{s.value}</div>
                    <div style={{ fontSize: 10.5, color: '#7C9468', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 1 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {(awaiting || accepted) && (
            <div style={{
              padding: '10px 18px', borderTop: '1px solid #D3E5C5',
              background: '#F2F7EA',
            }}>
              {sendingBack ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    autoFocus
                    data-testid="goal-sendback-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && notes.trim()) act('send_back', notes.trim());
                      if (e.key === 'Escape') { setSendingBack(false); setNotes(''); }
                    }}
                    placeholder="What needs another pass?"
                    style={{
                      flex: 1, fontFamily: UI_FONT, fontSize: 12.5, color: G.ink,
                      border: '1px solid #C5DCB4', borderRadius: 6, padding: '5px 9px',
                      background: G.cardHi, outline: 'none',
                    }}
                  />
                  <button
                    disabled={!notes.trim() || busy}
                    data-testid="goal-sendback-confirm"
                    onClick={() => act('send_back', notes.trim())}
                    style={{
                      padding: '5px 12px', borderRadius: 6, fontSize: 12.5,
                      border: '1px solid #C5DCB4', background: 'transparent',
                      color: notes.trim() ? G.ink2 : G.ink4,
                      cursor: notes.trim() ? 'pointer' : 'default', fontFamily: UI_FONT,
                    }}>Send back</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#5F7A4E', flex: 1 }}>
                    {accepted
                      ? 'Signed off. Task closed.'
                      : 'The gate is open — your sign-off closes the task.'}
                  </span>
                  {awaiting && (
                    <>
                      <button
                        data-testid="goal-sendback"
                        onClick={() => setSendingBack(true)}
                        style={{
                          padding: '5px 12px', borderRadius: 6, fontSize: 12.5,
                          border: '1px solid #C5DCB4', background: 'transparent',
                          color: G.ink2, cursor: 'pointer', fontFamily: UI_FONT,
                        }}>Send back with notes</button>
                      <button
                        data-testid="goal-accept"
                        disabled={busy}
                        onClick={() => act('accept', '')}
                        style={{
                          padding: '5px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 500,
                          border: '1px solid ' + G.ink, background: G.ink, color: '#FCFBF7',
                          cursor: 'pointer', fontFamily: UI_FONT,
                        }}>Accept &amp; close task</button>
                    </>
                  )}
                  {accepted && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: G.ok }}>
                      <GIco.check /> Accepted
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── goal_signoff divider ────────────────────────────────────────────────
// accept renders inside GoalDoneEvent (the banner flips to the accepted
// state); a standalone divider only appears for send_back so the rework
// loop has a visible boundary carrying the user's notes.
export function GoalSignoffDivider({ event }) {
  if (event.action !== 'send_back') return null;
  return (
    <div data-testid="goal-sendback-divider" style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '14px 0 10px', userSelect: 'none', fontFamily: UI_FONT,
    }}>
      <div style={{ flex: 1, borderTop: '1px dashed ' + G.line2 }} />
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '4px 12px', borderRadius: 999, maxWidth: '80%',
        background: G.errSoft, border: '1px solid #EFD3C9',
      }}>
        <span style={{ color: G.err, display: 'flex', flexShrink: 0 }}><GoalGlyph size={12} /></span>
        <span style={{ fontSize: 12, color: G.err, fontWeight: 600, whiteSpace: 'nowrap' }}>Sent back</span>
        <span style={{
          fontSize: 12, color: '#9A5A4E', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
        }}>· {event.notes}</span>
      </span>
      <div style={{ flex: 1, borderTop: '1px dashed ' + G.line2 }} />
    </div>
  );
}

// ── New Task view: Goal mode chip + detail strip ────────────────────────
export function GoalModeChip({ enabled, onToggle }) {
  const Switch = ({ on }) => (
    <span aria-hidden="true" style={{
      position: 'relative', display: 'inline-block',
      width: 22, height: 13, borderRadius: 999,
      background: on ? G.gold : '#D6CDB6',
      transition: 'background 120ms ease', flexShrink: 0,
    }}>
      <span style={{
        position: 'absolute', top: 1.5, left: on ? 10.5 : 1.5,
        width: 10, height: 10, borderRadius: '50%',
        background: '#FCFBF7', boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
        transition: 'left 120ms ease',
      }} />
    </span>
  );
  return (
    <button
      type="button"
      data-testid="goal-mode-chip"
      onClick={onToggle}
      title={enabled
        ? 'Disable Goal mode — the crew runs once and reports back'
        : 'Goal mode: the lead clarifies scope, writes verifiable criteria, and the crew iterates until every check passes'}
      style={{
        padding: '4px 9px 4px 7px', borderRadius: 6, fontSize: 12.5,
        border: '1px solid transparent', background: 'transparent', color: G.ink3,
        cursor: 'pointer', fontFamily: UI_FONT,
        display: 'inline-flex', alignItems: 'center', gap: 7,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#F0EAD8'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Switch on={enabled} />
      <span style={enabled
        ? { color: G.gold, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }
        : undefined}>
        {enabled && <GoalGlyph size={11} />}
        Goal mode
      </span>
    </button>
  );
}

export function GoalModeDetail() {
  return (
    <div data-testid="goal-mode-detail" style={{
      marginTop: 4, padding: '6px 8px',
      display: 'flex', alignItems: 'center', gap: 10,
      fontFamily: UI_FONT, fontSize: 11.5, color: G.ink4,
      whiteSpace: 'nowrap', overflow: 'hidden',
    }}>
      <span style={{ color: G.gold, display: 'flex', flexShrink: 0 }}><GoalGlyph size={11} /></span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
        The lead agent asks scoping questions first, then the crew iterates until every criterion verifies
      </span>
    </div>
  );
}

// Small goal pill for the task header meta row.
export function GoalHeaderPill({ goal }) {
  const drafting = goal.phase === 'scoping';
  const criteria = goal.criteria || [];
  const verified = criteria.filter(c => c.status === 'verified').length;
  const total = criteria.length;
  const all = !drafting && total > 0 && verified === total;
  return (
    <span
      data-testid="goal-header-pill"
      title={drafting
        ? 'Goal mode — criteria are being scoped'
        : `Goal mode — ${verified} of ${total} criteria verified`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '1px 8px 1px 6px', borderRadius: 999,
        border: '1px solid ' + (all ? '#C5DCB4' : G.goldLn),
        background: all ? G.okBg : G.goldBg,
        color: all ? G.ok : G.gold,
        fontFamily: MONO_FONT, fontSize: 11.5, lineHeight: 1.5,
        whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      <GoalGlyph size={10} />
      <span style={{ whiteSpace: 'nowrap' }}>{drafting ? 'goal · scoping' : `goal · ${verified}/${total}`}</span>
    </span>
  );
}
