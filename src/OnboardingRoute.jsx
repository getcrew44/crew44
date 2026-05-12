import React from 'react';
import { Icon, primaryBtn, ghostBtn, card, MONO_FONT } from './components.jsx';
import { CustomPicker } from './CustomPicker.jsx';
import { agentColor, agentInitial } from './utils.js';
import * as api from './api.js';

function RuntimeIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <rect x="1.5" y="2" width="11" height="4" rx="1" stroke="currentColor" strokeWidth="1"/>
      <rect x="1.5" y="8" width="11" height="4" rx="1" stroke="currentColor" strokeWidth="1"/>
      <circle cx="4" cy="4" r="0.6" fill="currentColor"/>
      <circle cx="4" cy="10" r="0.6" fill="currentColor"/>
    </svg>
  );
}

// ─── Default crew ────────────────────────────────────────────────────────────

export const DEFAULT_CREW = [
  {
    key: 'partner',
    name: 'Partner',
    role: 'Strategic thinking partner',
    blurb: 'Asks sharp questions, pushes back on weak ideas, and helps you frame the work before the crew starts executing.',
    instruction:
      'You are a strategic thinking partner. Your job is to ask clarifying questions, surface hidden assumptions, and help the user frame problems before any code is written. Push back when ideas are vague, suggest sharper alternatives, and keep the conversation focused on outcomes.',
  },
  {
    key: 'coding',
    name: 'Coding Agent',
    role: 'Implementation specialist',
    blurb: 'A senior engineer that reads the codebase, plans the change, and ships the edit. Prefers small, reversible diffs.',
    instruction:
      'You are a senior software engineer. Read the relevant code before editing, make minimal targeted changes, and prefer editing existing files over creating new ones. Run tests when available. Match the codebase style exactly.',
  },
  {
    key: 'product',
    name: 'Product Agent',
    role: 'Product & UX lens',
    blurb: 'Reviews work from the user’s point of view, catches rough edges, and proposes copy and flow improvements.',
    instruction:
      'You are a product manager and UX reviewer. Evaluate work from the end-user perspective: clarity, flow, copy, edge cases, accessibility. Propose specific improvements rather than vague feedback. Bias toward shipping the smallest valuable slice.',
  },
];

// ─── Shared atoms ────────────────────────────────────────────────────────────

function StepDots({ step, total }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} style={{
          width: i === step ? 18 : 6, height: 6, borderRadius: 999,
          background: i === step ? '#1C1A17' : i < step ? '#807972' : '#D8CFB8',
          transition: 'all 0.2s',
        }} />
      ))}
    </div>
  );
}

const SERIF_FONT = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif';

const largePrimaryBtn = {
  ...primaryBtn,
  padding: '12px 22px', fontSize: 14, borderRadius: 10,
  display: 'inline-flex', alignItems: 'center', gap: 10,
};

const largeGhostBtn = {
  ...ghostBtn,
  padding: '12px 22px', fontSize: 14, borderRadius: 10,
  display: 'inline-flex', alignItems: 'center', gap: 10,
};

function Shell({ step, total, onSkip, wide, children }) {
  return (
    <div style={{
      height: '100%', width: '100%', background: '#FAF5E8',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        padding: '18px 28px', borderBottom: '1px solid #ECE6D5',
        display: 'flex', alignItems: 'center', gap: 14,
        WebkitAppRegion: 'drag',
      }}>
        <div style={{
          width: 26, height: 26, borderRadius: 7,
          background: '#1C1A17', color: '#FCFBF7',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, fontFamily: MONO_FONT,
        }}>C</div>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: '#1C1A17' }}>CrewAI</span>
        <span style={{ fontSize: 12, color: '#A89F92' }}>· Setup</span>
        <div style={{ flex: 1 }} />
        <StepDots step={step} total={total} />
        <div style={{ flex: 1 }} />
        {onSkip && (
          <button onClick={onSkip} style={{
            ...ghostBtn, background: 'transparent', border: 'none', color: '#807972',
          }}>Skip setup</button>
        )}
      </div>
      {wide ? (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div key={step} style={{ height: '100%', animation: 'crewStepIn 0.42s cubic-bezier(0.22, 1, 0.36, 1)' }}>
            {children}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
          <div
            key={step}
            style={{
              width: '100%', maxWidth: 760, padding: '56px 40px 40px',
              animation: 'crewStepIn 0.42s cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            {children}
          </div>
        </div>
      )}
      <style>{`
        @keyframes crewStepIn {
          0% { opacity: 0; transform: translateY(14px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function StepTitle({ eyebrow, title, body }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{
        fontSize: 11.5, color: '#C4644A', textTransform: 'uppercase',
        letterSpacing: 0.6, fontWeight: 600, marginBottom: 10,
      }}>{eyebrow}</div>
      <h1 style={{
        fontSize: 30, fontWeight: 600, color: '#1C1A17',
        margin: '0 0 12px', letterSpacing: -0.4, lineHeight: 1.15,
      }}>{title}</h1>
      <p style={{
        fontSize: 14.5, color: '#5C544B', margin: 0,
        lineHeight: 1.55, maxWidth: 560,
      }}>{body}</p>
    </div>
  );
}

function Footer({ left, right }) {
  return (
    <div style={{
      marginTop: 40, paddingTop: 20, borderTop: '1px solid #ECE6D5',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {left}
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}

// ─── Step 1: Welcome ─────────────────────────────────────────────────────────

function PreviewCard({ agentKey, agentName, code, body, status, statusColor, statusDot, offset }) {
  const color = agentKey === 'you' ? '#1C1A17' : agentColor(agentKey);
  return (
    <div style={{
      background: '#FCFBF7',
      border: '1px solid #ECE6D5',
      borderRadius: 12,
      padding: '14px 16px',
      boxShadow: '0 6px 18px rgba(28,26,23,0.06)',
      marginLeft: offset || 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%',
          background: color, color: '#FCFBF7',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10.5, fontWeight: 700,
        }}>{agentInitial(agentName)}</div>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1C1A17' }}>{agentName}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#A89F92', fontFamily: MONO_FONT }}>{code}</span>
      </div>
      <div style={{ fontSize: 12.5, color: '#1C1A17', lineHeight: 1.55, marginBottom: status ? 8 : 0 }}>
        {body}
      </div>
      {status && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11.5, color: statusColor, fontWeight: 500,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusDot }} />
          {status}
        </div>
      )}
    </div>
  );
}

function ChatMention({ children }) {
  return <span style={{ color: '#C4644A', fontWeight: 500 }}>{children}</span>;
}

function WelcomeStep({ onNext }) {
  return (
    <div style={{
      height: '100%', display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    }}>
      {/* Left — hero */}
      <div style={{
        padding: '72px 56px 48px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        minWidth: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, color: '#807972' }}>
          <span style={{ color: '#C4644A', fontSize: 16 }}>✦</span>
          <span style={{ fontSize: 13, color: '#5C544B' }}>Welcome to CrewAI</span>
        </div>

        <h1 style={{
          fontFamily: SERIF_FONT,
          fontSize: 56, fontWeight: 500, color: '#1C1A17',
          margin: '0 0 28px', letterSpacing: -1.2, lineHeight: 1.02,
        }}>
          Multi-agent teams
          <br />
          in{' '}
          <em style={{ color: '#C4644A', fontStyle: 'italic', fontWeight: 500 }}>one workplace.</em>
        </h1>

        <p style={{
          fontSize: 16, color: '#1C1A17', margin: '0 0 16px',
          lineHeight: 1.5, maxWidth: 460,
        }}>
          Specialized agents hand off work, debate decisions, and sharpen their own skills with every task you ship together.
        </p>
        <p style={{
          fontSize: 13, color: '#A89F92', margin: '0 0 36px',
          lineHeight: 1.5, maxWidth: 460,
        }}>
          Takes under a minute to setup.
        </p>

        <div>
          <button onClick={onNext} style={largePrimaryBtn}>
            Start exploring <span style={{ fontSize: 15 }}>→</span>
          </button>
        </div>
      </div>

      {/* Right — preview */}
      <div style={{
        padding: '64px 48px 48px',
        background: '#F7F1DE',
        borderLeft: '1px solid #ECE6D5',
        display: 'flex', flexDirection: 'column', gap: 14,
        overflow: 'hidden',
      }}>
        <div style={{
          fontFamily: SERIF_FONT, fontStyle: 'italic',
          fontSize: 14, color: '#807972', lineHeight: 1.5,
          textAlign: 'center', maxWidth: 360, alignSelf: 'center', marginBottom: 8,
        }}>
          Every task, every issue — a specialized team that <em style={{ color: '#C4644A', fontStyle: 'italic' }}>gets better</em> with every run.
        </div>

        <PreviewCard
          agentKey="you" agentName="You" code="CRW-42"
          body={<><ChatMention>@Coding Agent</ChatMention> can you ship the export feature? Pull the spec from <ChatMention>@Product</ChatMention>’s notes.</>}
          offset={0}
        />
        <PreviewCard
          agentKey="coding" agentName="Coding Agent" code="CRW-42"
          body={<>On it. Reading the spec and drafting the diff against <code style={{ fontFamily: MONO_FONT, fontSize: 11.5, background: '#F0EAD8', padding: '1px 5px', borderRadius: 4 }}>src/export.ts</code>…</>}
          status="In progress" statusColor="#8A6E1F" statusDot="#D9B24A"
          offset={28}
        />
        <PreviewCard
          agentKey="product" agentName="Product Agent" code="CRW-38"
          body="Reviewed the draft — left 3 notes on copy and one on the empty state. Otherwise looks shippable."
          status="In review" statusColor="#3E7A4A" statusDot="#5B9C5F"
          offset={0}
        />
        <PreviewCard
          agentKey="partner" agentName="Partner" code="CRW-35"
          body={<>Quick check: are we shipping this behind a flag, or all-users on merge? Cost of getting it wrong is small either way.</>}
          offset={28}
        />
      </div>
    </div>
  );
}

// ─── Step 2: Runtime scan ────────────────────────────────────────────────────

function RuntimeRow({ runtime, scanning }) {
  const available = runtime.status === 'available';
  return (
    <div style={{
      padding: '12px 16px', borderBottom: '1px solid #ECE6D5',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 7,
        background: available ? '#F0EAD8' : '#F7F1DE',
        border: '1px solid #E6DFCC',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: MONO_FONT, fontSize: 12, fontWeight: 600,
        color: available ? '#1C1A17' : '#A89F92',
      }}>{(runtime.provider || runtime.name || '?')[0].toUpperCase()}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1C1A17' }}>
          {runtime.name || runtime.id}
        </div>
        <div style={{ fontSize: 12, color: '#807972', fontFamily: MONO_FONT }}>
          {runtime.version || '—'}
        </div>
      </div>
      <span style={{
        fontSize: 12, color: available ? '#3E7A4A' : '#A89F92',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: available ? '#5B9C5F' : '#C9BFA8',
        }} />
        {scanning ? 'checking…' : available ? 'available' : 'not found'}
      </span>
    </div>
  );
}

function ScanStep({ onNext, onBack, runtimes, setRuntimes }) {
  const [scanning, setScanning] = React.useState(true);
  const [error, setError] = React.useState(null);

  const runScan = React.useCallback(async () => {
    setScanning(true);
    setError(null);
    const minDelay = new Promise(resolve => setTimeout(resolve, 1500));
    try {
      await api.rescanRuntimes();
      const [fresh] = await Promise.all([api.listRuntimes(), minDelay]);
      setRuntimes(fresh);
    } catch (err) {
      await minDelay;
      setError(err.message || 'Could not reach backend');
    } finally {
      setScanning(false);
    }
  }, [setRuntimes]);

  React.useEffect(() => { runScan(); /* eslint-disable-next-line */ }, []);

  const available = runtimes.filter(r => r.status === 'available');

  let title, body;
  if (scanning) {
    title = 'Scanning your machine for runtimes.';
    body = 'Runtimes are the local engines your agents talk to — things like Claude Code, OpenAI CLIs, or anything you’ve already installed. We’ll detect what’s here and use it.';
  } else if (error) {
    title = 'Couldn’t reach the runtime scanner.';
    body = 'No worries — you can continue and configure runtimes later from the Crew tab.';
  } else if (available.length === 0) {
    title = 'No runtimes found on this machine.';
    body = 'You can install one (Claude Code, Codex, Cursor…) and rescan, or skip ahead and add a runtime later from the Crew tab.';
  } else {
    title = `Your runtime is ready.`;
    body = 'Your crew will run locally on your machine. You can swap or add more from the Crew tab anytime.';
  }

  return (
    <>
      <StepTitle eyebrow="Step 2 of 3" title={title} body={body} />

      <div style={card}>
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid #ECE6D5',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {scanning ? (
            <span style={{
              width: 14, height: 14, borderRadius: '50%',
              border: '2px solid #D8CFB8', borderTopColor: '#1C1A17',
              animation: 'crewSpin 0.7s linear infinite',
            }} />
          ) : (
            <span style={{
              width: 14, height: 14, borderRadius: '50%',
              background: error ? '#C4644A' : '#5B9C5F',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#FCFBF7', fontSize: 9, fontWeight: 700,
            }}>{error ? '!' : '✓'}</span>
          )}
          <span style={{ fontSize: 13.5, fontWeight: 500, color: '#1C1A17' }}>
            {scanning
              ? 'Scanning…'
              : error
                ? 'Scan failed'
                : `Found ${available.length} runtime${available.length === 1 ? '' : 's'}`}
          </span>
          <div style={{ flex: 1 }} />
          {!scanning && (
            <button style={ghostBtn} onClick={runScan}>Rescan</button>
          )}
        </div>

        {error && (
          <div style={{ padding: '14px 16px', fontSize: 13, color: '#807972' }}>
            {error}. You can continue and configure runtimes later in the Crew tab.
          </div>
        )}

        {!error && runtimes.length === 0 && !scanning && (
          <div style={{ padding: '20px 16px', fontSize: 13, color: '#A89F92', fontStyle: 'italic' }}>
            No runtimes detected. You can add one later from <strong style={{ color: '#5C544B' }}>Crew → Runtimes</strong>.
          </div>
        )}

        {runtimes.map(r => <RuntimeRow key={r.id} runtime={r} scanning={scanning} />)}
      </div>

      <Footer
        left={<button style={largeGhostBtn} onClick={onBack}><span style={{ fontSize: 15 }}>←</span> Back</button>}
        right={
          <button style={largePrimaryBtn} onClick={onNext} disabled={scanning}>
            {scanning ? 'Scanning…' : <>Continue <span style={{ fontSize: 15 }}>→</span></>}
          </button>
        }
      />

      <style>{`@keyframes crewSpin { to { transform: rotate(360deg) } }`}</style>
    </>
  );
}

// ─── Step 3: Default crew ────────────────────────────────────────────────────

function CrewCard({ member, selected, onToggle }) {
  const color = agentColor(member.key);
  return (
    <div
      onClick={onToggle}
      style={{
        ...card,
        padding: '16px 18px',
        cursor: 'pointer',
        display: 'flex', alignItems: 'flex-start', gap: 14,
        border: '1px solid ' + (selected ? '#1C1A17' : '#ECE6D5'),
        background: selected ? '#FCFBF7' : '#FCFAF1',
        transition: 'all 0.12s',
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: color, color: '#FCFBF7',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 600, flexShrink: 0,
      }}>{agentInitial(member.name)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: '#1C1A17' }}>{member.name}</span>
          <span style={{ fontSize: 12, color: '#807972' }}>· {member.role}</span>
        </div>
        <div style={{ fontSize: 13, color: '#5C544B', lineHeight: 1.5 }}>{member.blurb}</div>
      </div>
      <div style={{
        width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 2,
        border: '1.5px solid ' + (selected ? '#1C1A17' : '#D8CFB8'),
        background: selected ? '#1C1A17' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#FCFBF7', fontSize: 12, fontWeight: 700,
      }}>{selected ? '✓' : ''}</div>
    </div>
  );
}

const AUTO_RUNTIME = '__auto__';

function CrewStep({ onBack, onFinish, runtimes, creating, error }) {
  const [selected, setSelected] = React.useState(() =>
    new Set(DEFAULT_CREW.map(m => m.key))
  );
  const [runtimeId, setRuntimeId] = React.useState(AUTO_RUNTIME);

  const toggle = (key) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const chosen = DEFAULT_CREW.filter(m => selected.has(m.key));

  return (
    <>
      <StepTitle
        eyebrow="Step 3 of 3"
        title="Meet your starter crew."
        body="We’ve drafted three agents to get you moving. Keep the ones you want — you can tweak instructions, attach skills, or add more from the Crew tab anytime."
      />

      <div style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
        {DEFAULT_CREW.map(m => (
          <CrewCard
            key={m.key}
            member={m}
            selected={selected.has(m.key)}
            onToggle={() => toggle(m.key)}
          />
        ))}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderRadius: 8,
        background: '#F7F1DE', border: '1px solid #ECE6D5',
      }}>
        <span style={{ fontSize: 12.5, color: '#807972' }}>Run agents on</span>
        <CustomPicker
          icon={<RuntimeIcon size={13} />}
          placeholder="Pick a runtime"
          value={runtimeId}
          items={[
            { id: AUTO_RUNTIME, label: 'Auto — pick the best available' },
            ...runtimes.map(r => ({
              id: r.id,
              label: (r.name || r.id) + (r.status === 'available' ? '' : ' (unavailable)'),
            })),
          ]}
          onChange={setRuntimeId}
          width={280}
        />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#A89F92' }}>
          {chosen.length} agent{chosen.length === 1 ? '' : 's'} selected
        </span>
      </div>

      {error && (
        <div style={{
          marginTop: 16, padding: '10px 14px', borderRadius: 8,
          background: '#FBEEE7', border: '1px solid #E8CFC2',
          fontSize: 12.5, color: '#8B3A22',
        }}>{error}</div>
      )}

      <Footer
        left={
          <button style={largeGhostBtn} onClick={onBack} disabled={creating}>
            <span style={{ fontSize: 15 }}>←</span> Back
          </button>
        }
        right={
          <button
            style={{ ...largePrimaryBtn, opacity: creating ? 0.6 : 1 }}
            onClick={() => onFinish(chosen, runtimeId)}
            disabled={creating}
          >
            {creating
              ? 'Setting up…'
              : chosen.length === 0
                ? 'Skip and finish'
                : `Create ${chosen.length} agent${chosen.length === 1 ? '' : 's'}`}
          </button>
        }
      />
    </>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function OnboardingRoute({ runtimes: initialRuntimes, onComplete, onSkip }) {
  const [step, setStep] = React.useState(0);
  const [runtimes, setRuntimes] = React.useState(initialRuntimes || []);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState(null);

  const handleFinish = async (chosen, runtimeId) => {
    setCreating(true);
    setError(null);
    const resolvedRuntimeId =
      runtimeId === AUTO_RUNTIME
        ? (runtimes.find(r => r.status === 'available')?.id || runtimes[0]?.id || '')
        : (runtimeId || '');
    try {
      for (const member of chosen) {
        await api.createAgent(member.name, member.instruction, resolvedRuntimeId, '');
      }
      onComplete?.();
    } catch (err) {
      setError(`Could not create agents: ${err.message}`);
      setCreating(false);
    }
  };

  return (
    <Shell step={step} total={3} onSkip={onSkip} wide={step === 0}>
      {step === 0 && <WelcomeStep onNext={() => setStep(1)} onSkip={onSkip} />}
      {step === 1 && (
        <ScanStep
          onBack={() => setStep(0)}
          onNext={() => setStep(2)}
          runtimes={runtimes}
          setRuntimes={setRuntimes}
        />
      )}
      {step === 2 && (
        <CrewStep
          onBack={() => setStep(1)}
          onFinish={handleFinish}
          runtimes={runtimes}
          creating={creating}
          error={error}
        />
      )}
    </Shell>
  );
}
