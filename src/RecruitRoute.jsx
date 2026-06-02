import React from 'react';
import {
  listRecruitAgents,
  getRecruitAgent,
  installRecruitAgent,
} from './api.js';
import { RichText } from './RichText.jsx';

const UI_FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';
const MAX_W = 720;

const RUNTIME_NAMES = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor Agent',
  gemini: 'Gemini CLI',
};

function formatInstalls(n) {
  if (!n) return '0';
  if (n >= 1000) {
    const v = n / 1000;
    return (v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')) + 'k';
  }
  return String(n);
}

function TrendingIcon({ size = 11 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M2 8.5L5 5.5L7 7.5L10 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7.5 4H10V6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function StarIcon({ size = 11 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor">
      <path d="M6 1.2l1.45 2.94 3.25.47-2.35 2.29.55 3.23L6 8.6l-2.9 1.53.55-3.23L1.3 4.61l3.25-.47L6 1.2z"/>
    </svg>
  );
}

function DownloadIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M7 2.5v6M4 6L7 8.8 10 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2.8 11.2h8.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

function GithubIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 .2a8 8 0 00-2.53 15.59c.4.07.55-.17.55-.38l-.01-1.34c-2.23.49-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.96 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.6 7.6 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.52.56.83 1.28.83 2.15 0 3.08-1.87 3.76-3.65 3.96.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8 8 0 008 .2z"/>
    </svg>
  );
}

function CheckIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M2.5 6.2l2.4 2.4L9.6 3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

const primaryBtn = {
  padding: '6px 14px', borderRadius: 7, fontSize: 12.5, fontWeight: 500,
  border: '1px solid #1C1A17', background: '#1C1A17', color: '#FCFBF7',
  cursor: 'pointer', fontFamily: UI_FONT,
};
const installedBtn = {
  padding: '6px 12px 6px 10px', borderRadius: 7, fontSize: 12.5, fontWeight: 500,
  border: '1px solid #C7D4BC', background: '#EEF2E4', color: '#3E5C36',
  cursor: 'default', fontFamily: UI_FONT,
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const busyBtn = {
  ...primaryBtn,
  background: '#5C544B', borderColor: '#5C544B', cursor: 'progress',
};

// Derive (initial, color) from a registry entry. Backend may send icon
// or omit it; first letter of the name + neutral fill is the fallback.
function iconOf(entry) {
  const icon = entry.icon || {};
  return {
    initial: icon.initial || (entry.name ? entry.name[0].toUpperCase() : '?'),
    color: icon.color || '#7A8567',
  };
}

function Avatar({ entry, size = 36 }) {
  const { initial, color } = iconOf(entry);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color, color: '#FCFBF7',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, fontWeight: 600, flexShrink: 0,
    }}>{initial}</div>
  );
}

// Three install states: idle / busy / done. The busy state replaces the
// label with a brief "Installing…" so the user sees the click landed.
function InstallButton({ installed, busy, onClick, label = 'Add to crew' }) {
  if (installed) {
    return (
      <span style={installedBtn} data-testid="recruit-installed-badge">
        <CheckIcon/> Added
      </span>
    );
  }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={busy ? busyBtn : primaryBtn}
      disabled={busy}
      data-testid="recruit-install-btn"
    >
      {busy ? 'Installing…' : label}
    </button>
  );
}

// Icon-only link to the source repo. Kept out of the metadata stats line so
// it reads as an action, not a stat. Stops propagation so it doesn't open the
// detail view.
function GithubLinkButton({ url, size = 28 }) {
  const [hover, setHover] = React.useState(false);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="View source on GitHub"
      aria-label="View source on GitHub"
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid="recruit-row-github"
      style={{
        width: size, height: size, borderRadius: 7,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid ' + (hover ? '#D8CFB8' : '#ECE6D5'),
        background: hover ? '#F4EEDD' : 'transparent',
        color: hover ? '#1C1A17' : '#807972',
        transition: 'background 0.12s, border-color 0.12s, color 0.12s',
      }}
    >
      <GithubIcon size={15}/>
    </a>
  );
}

function Row({ entry, busy, onOpen, onInstall }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid={`recruit-row-${entry.id}`}
      style={{
        display: 'grid', gridTemplateColumns: '36px 1fr auto',
        gap: 14, alignItems: 'center',
        padding: '16px 18px',
        borderBottom: '1px solid #ECE6D5',
        background: hover ? '#FAF5E8' : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.12s',
      }}
    >
      <Avatar entry={entry} size={36}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1C1A17', letterSpacing: -0.1 }}>
            {entry.name}
          </span>
          {entry.trending && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '1px 6px 1px 5px', borderRadius: 999,
              background: '#F4E8D8', color: '#9A6420',
              fontSize: 10.5, fontWeight: 600, letterSpacing: 0.2,
              textTransform: 'uppercase',
            }}>
              <TrendingIcon size={10}/> Trending
            </span>
          )}
        </div>
        <div style={{
          fontSize: 12.5, color: '#807972', marginTop: 4, lineHeight: 1.5,
          display: '-webkit-box', WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2, overflow: 'hidden',
        }}>
          {entry.description}
        </div>
        <div style={{ fontSize: 12, color: '#A89F92', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {entry.author && <span>by {entry.author}</span>}
          {entry.author && entry.installs > 0 && <span style={{ color: '#D6CDB6' }}>·</span>}
          {entry.installs > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#807972', fontVariantNumeric: 'tabular-nums' }}>
              <DownloadIcon size={11}/>{formatInstalls(entry.installs)}
            </span>
          )}
          {entry.stars > 0 && (
            <>
              <span style={{ color: '#D6CDB6' }}>·</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#807972', fontVariantNumeric: 'tabular-nums' }}>
                <StarIcon size={10}/>{formatInstalls(entry.stars)}
              </span>
            </>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {entry.repo_url && <GithubLinkButton url={entry.repo_url}/>}
        <InstallButton installed={entry.installed} busy={busy} onClick={onInstall}/>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div data-testid="recruit-skeleton" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#ECE6D5' }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 12, background: '#ECE6D5', borderRadius: 4, width: '40%', marginBottom: 8 }} />
            <div style={{ height: 10, background: '#ECE6D5', borderRadius: 4, width: '80%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorBanner({ message, onRetry }) {
  return (
    <div
      data-testid="recruit-error"
      style={{
        padding: '14px 16px', background: '#FBEAE5', border: '1px solid #E6BFAE',
        borderRadius: 8, color: '#7A2E1F', fontSize: 13, display: 'flex',
        alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}
    >
      <span>{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: '6px 12px', borderRadius: 7, fontSize: 12.5,
            border: '1px solid #E6BFAE', background: '#FCFAF1', color: '#7A2E1F',
            cursor: 'pointer', fontFamily: UI_FONT, fontWeight: 500,
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

function Browse({ items, loading, error, busyId, onReload, onOpen, onInstall, query, setQuery }) {
  const q = query.trim().toLowerCase();
  const filtered = !q ? items : items.filter(e =>
    (e.name || '').toLowerCase().includes(q) ||
    (e.description || '').toLowerCase().includes(q) ||
    (e.author || '').toLowerCase().includes(q) ||
    (e.tags || []).some(t => (t || '').toLowerCase().includes(q))
  );

  return (
    <div style={{ height: '100%', background: '#FAF5E8', overflow: 'auto', padding: '28px 36px 40px' }}>
      <div style={{ maxWidth: MAX_W, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px', color: '#1C1A17', letterSpacing: -0.2 }}>
          Recruit
        </h1>
        <div style={{ fontSize: 13, color: '#807972', marginBottom: 20 }}>
          Browse agents published by the community. Recruit the ones you want into your crew.
        </div>

        {error && (
          <div style={{ marginBottom: 18 }}>
            <ErrorBanner message={error} onRetry={onReload}/>
          </div>
        )}

        <div style={{ position: 'relative', marginBottom: 18 }}>
          <span style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: '#A89F92', display: 'flex',
          }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M10.5 10.5l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents, authors, tags…"
            data-testid="recruit-search"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 12px 10px 34px',
              border: '1px solid #E6DFCC',
              borderRadius: 8, background: '#FCFAF1',
              fontFamily: UI_FONT, fontSize: 13, color: '#1C1A17',
              outline: 'none',
            }}
          />
        </div>

        <div style={{
          background: '#FCFAF1', border: '1px solid #ECE6D5',
          borderRadius: 10, overflow: 'hidden',
        }}>
          {loading ? <Skeleton/> :
            filtered.length === 0 ? (
              <div style={{ padding: '32px 18px', textAlign: 'center', fontSize: 13, color: '#A89F92' }}>
                {items.length === 0 ? 'No agents in the registry yet.' : `No agents match "${query}".`}
              </div>
            ) : (
              filtered.map((entry) => (
                <Row
                  key={entry.id}
                  entry={entry}
                  busy={busyId === entry.id}
                  onOpen={() => onOpen(entry.id)}
                  onInstall={() => onInstall(entry.id)}
                />
              ))
            )
          }
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{
        fontSize: 11.5, color: '#A89F92',
        textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 500,
        marginBottom: 10,
      }}>{label}</div>
      {children}
    </section>
  );
}

function Detail({ entry, detail, loading, error, busy, onInstall, onBack, onReload }) {
  const manifest = detail?.manifest;
  const runtimeName = manifest?.suggested_runtime
    ? (RUNTIME_NAMES[manifest.suggested_runtime] || manifest.suggested_runtime)
    : null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#FAF5E8' }}>
      <div style={{
        padding: '16px 36px 12px', borderBottom: '1px solid #ECE6D5',
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
      }}>
        <span onClick={onBack} data-testid="recruit-back" style={{ color: '#807972', cursor: 'pointer' }}>Recruit</span>
        <span style={{ color: '#C9BFA8' }}>›</span>
        <span style={{ color: '#1C1A17', fontWeight: 500 }}>{entry.name}</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '32px 36px 48px' }}>
        <div style={{ maxWidth: MAX_W, margin: '0 auto' }}>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 28 }}>
            <Avatar entry={entry} size={64}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 24, fontWeight: 600, color: '#1C1A17',
                letterSpacing: -0.3, lineHeight: 1.15,
              }}>{entry.name}</div>
              <div style={{ fontSize: 13, color: '#807972', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {entry.author && <span>by {entry.author}</span>}
                {entry.installs > 0 && (
                  <>
                    <span style={{ color: '#D6CDB6' }}>·</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontVariantNumeric: 'tabular-nums' }}>
                      <DownloadIcon size={12}/>{formatInstalls(entry.installs)}
                    </span>
                  </>
                )}
                {entry.stars > 0 && (
                  <>
                    <span style={{ color: '#D6CDB6' }}>·</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontVariantNumeric: 'tabular-nums' }}>
                      <StarIcon size={11}/>{formatInstalls(entry.stars)}
                    </span>
                  </>
                )}
              </div>
            </div>
            <InstallButton installed={entry.installed} busy={busy} onClick={onInstall}/>
          </div>

          {error && (
            <div style={{ marginBottom: 24 }}>
              <ErrorBanner message={error} onRetry={onReload}/>
            </div>
          )}

          {loading && !detail && (
            <div data-testid="recruit-detail-loading" style={{ color: '#A89F92', fontSize: 13, padding: '12px 0' }}>
              Loading…
            </div>
          )}

          {detail && (
            <>
              <Section label="About">
                <div style={{ fontSize: 13.5, color: '#3A352E', lineHeight: 1.65 }}>
                  <RichText text={detail.agent_body || manifest?.description || entry.description} />
                </div>
              </Section>

              {manifest?.skills?.length > 0 && (
                <Section label="Skills">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {manifest.skills.map(s => (
                      <span key={s.name} style={{
                        padding: '4px 10px', borderRadius: 999,
                        background: '#FCFAF1', border: '1px solid #ECE6D5',
                        fontFamily: MONO, fontSize: 11.5, color: '#5C544B',
                      }}>{s.name}</span>
                    ))}
                  </div>
                </Section>
              )}

              {manifest?.upstream?.repo_url && (
                <Section label="Based on">
                  <div style={{ fontSize: 13, color: '#1C1A17', lineHeight: 1.5 }}>
                    <a
                      href={manifest.upstream.repo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontFamily: MONO, fontSize: 12, color: '#5C544B',
                        background: '#F0EAD8', padding: '2px 7px', borderRadius: 4,
                        wordBreak: 'break-all', textDecoration: 'none',
                      }}
                    >{manifest.upstream.repo_url}</a>
                    {manifest.upstream.commit && (
                      <span style={{ color: '#807972', marginLeft: 8, fontSize: 12 }}>
                        @ {manifest.upstream.commit.slice(0, 8)}
                      </span>
                    )}
                    <div style={{ color: '#807972', fontSize: 12, marginTop: 6 }}>
                      Crew44 installs the upstream content under <code style={{
                        fontFamily: MONO, fontSize: 11.5,
                      }}>{manifest.upstream.path || 'upstream'}/</code> in the agent source directory.
                    </div>
                  </div>
                </Section>
              )}

              {runtimeName && (
                <Section label="Recommended runtime">
                  <div style={{ fontSize: 13, color: '#1C1A17' }}>{runtimeName}</div>
                </Section>
              )}

              <Section label="Version">
                <code style={{
                  fontFamily: MONO, fontSize: 12, color: '#5C544B',
                  background: '#F0EAD8', padding: '2px 7px', borderRadius: 4,
                }}>{manifest?.version}</code>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RecruitRoute({ onToast, onDataRefresh }) {
  const [items, setItems] = React.useState([]);
  const [loadingList, setLoadingList] = React.useState(true);
  const [listError, setListError] = React.useState('');
  const [query, setQuery] = React.useState('');

  const [openId, setOpenId] = React.useState(null);
  const [detail, setDetail] = React.useState(null);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [detailError, setDetailError] = React.useState('');

  const [busyInstallId, setBusyInstallId] = React.useState('');

  const loadList = React.useCallback(async () => {
    setLoadingList(true);
    setListError('');
    try {
      const data = await listRecruitAgents();
      setItems(data);
    } catch (err) {
      setListError(err?.message || 'Could not load registry.');
    } finally {
      setLoadingList(false);
    }
  }, []);

  React.useEffect(() => { loadList(); }, [loadList]);

  const loadDetail = React.useCallback(async (id) => {
    setLoadingDetail(true);
    setDetailError('');
    setDetail(null);
    try {
      const data = await getRecruitAgent(id);
      setDetail(data);
    } catch (err) {
      setDetailError(err?.message || 'Could not load agent details.');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const handleOpen = React.useCallback((id) => {
    setOpenId(id);
    loadDetail(id);
  }, [loadDetail]);

  const handleBack = React.useCallback(() => {
    setOpenId(null);
    setDetail(null);
    setDetailError('');
  }, []);

  const handleInstall = React.useCallback(async (id) => {
    setBusyInstallId(id);
    try {
      await installRecruitAgent(id);
      const name = items.find(e => e.id === id)?.name || 'Agent';
      onToast?.(`${name} added to your crew.`);
      onDataRefresh?.();
      setItems(prev => prev.map(e => e.id === id ? { ...e, installed: true } : e));
    } catch (err) {
      onToast?.(err?.message || 'Install failed.');
    } finally {
      setBusyInstallId('');
    }
  }, [items, onToast, onDataRefresh]);

  if (openId) {
    const entry = items.find(e => e.id === openId) || { id: openId, name: openId };
    return (
      <Detail
        entry={entry}
        detail={detail}
        loading={loadingDetail}
        error={detailError}
        busy={busyInstallId === openId}
        onInstall={() => handleInstall(openId)}
        onBack={handleBack}
        onReload={() => loadDetail(openId)}
      />
    );
  }

  return (
    <Browse
      items={items}
      loading={loadingList}
      error={listError}
      busyId={busyInstallId}
      onReload={loadList}
      onOpen={handleOpen}
      onInstall={handleInstall}
      query={query}
      setQuery={setQuery}
    />
  );
}
