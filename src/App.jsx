import React from 'react';
import Sidebar from './Sidebar.jsx';
import TaskView from './TaskView.jsx';
import CrewRoute from './CrewRoute.jsx';
import NewTaskRoute from './NewTaskRoute.jsx';
import OnboardingRoute from './OnboardingRoute.jsx';
import PairMobileDialog from './PairMobileDialog.jsx';
import AutoRoute from './AutoRoute.jsx';
import { Icon } from './components.jsx';
import { displayAgent, relativeTime, rememberAgents, HUMAN_USER } from './utils.js';
import * as api from './api.js';
import { createExistingFolderProject } from './existingFolderProject.js';
import { dataTransferHasFiles } from './dragDrop.js';

// Minimal toast — renders a small pill at the bottom-center of the window
function Toast({ message, onDone }) {
  React.useEffect(() => {
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div style={{
      position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(28,26,23,0.88)', color: '#FCFBF7',
      fontSize: 13, padding: '8px 16px', borderRadius: 20,
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      zIndex: 99999, pointerEvents: 'none', whiteSpace: 'nowrap',
      animation: 'toastIn 0.18s ease',
    }}>{message}</div>
  );
}

function EmptyRoute({ icon, title, body }) {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#FAF5E8',
      color: '#5C544B', textAlign: 'center', padding: 40,
      WebkitAppRegion: 'drag',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 14,
        background: '#F0EAD8', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#807972', marginBottom: 18,
      }}>
        <Icon name={icon} size={26} />
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: '#1C1A17', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13.5, color: '#807972', maxWidth: 420, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FAF5E8', color: '#A89F92', fontSize: 13, WebkitAppRegion: 'drag' }}>
      Connecting to backend…
    </div>
  );
}

function FolderAccessWarningDialog({ folderName, onCancel, onConfirm }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(28,26,23,0.28)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="folder-warn-title" style={{
        width: 'min(520px, 100%)',
        background: '#FCFBF7',
        border: '1px solid #E6DFCC',
        borderRadius: 10,
        boxShadow: '0 20px 60px rgba(28,26,23,0.22)',
        padding: 22,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
          <div aria-hidden="true" style={{
            width: 32, height: 32, borderRadius: '50%',
            background: '#FBEEE7', color: '#C4644A',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 3l10 18H2L12 3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
              <path d="M12 10v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              <circle cx="12" cy="18" r="0.9" fill="currentColor"/>
            </svg>
          </div>
          <div id="folder-warn-title" style={{ fontSize: 17, fontWeight: 650, color: '#1C1A17', lineHeight: 1.3 }}>
            Allow agents to change files in “{folderName}”?
          </div>
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: '#5C544B', marginBottom: 18 }}>
          This includes all files and subfolders. Agents will be able to read, edit, and permanently delete — and may share file contents with third-party tools they connect to. Be careful about exposing sensitive information.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={{
            border: '1px solid #D8CFB8',
            background: '#FCFBF7',
            color: '#5C544B',
            borderRadius: 6,
            padding: '8px 14px',
            fontSize: 13,
            cursor: 'pointer',
          }}>Cancel</button>
          <button autoFocus onClick={onConfirm} style={{
            border: '1px solid #1C1A17',
            background: '#1C1A17',
            color: '#FCFBF7',
            borderRadius: 6,
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}>Allow</button>
        </div>
      </div>
    </div>
  );
}

function BrowserFolderDialog({ onCancel, onSubmit }) {
  const [path, setPath] = React.useState('');
  const canSubmit = path.trim().length > 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(28,26,23,0.28)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby="folder-path-title" style={{
        width: 'min(520px, 100%)',
        background: '#FCFBF7',
        border: '1px solid #E6DFCC',
        borderRadius: 8,
        boxShadow: '0 20px 60px rgba(28,26,23,0.22)',
        padding: 20,
      }}>
        <div id="folder-path-title" style={{ fontSize: 16, fontWeight: 650, color: '#1C1A17', marginBottom: 8 }}>
          Paste folder path
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: '#5C544B', marginBottom: 14 }}>
          Browser mode cannot read the real folder path from the system picker. Paste an absolute path here instead; Electron mode will show the native folder dialog.
        </div>
        <input
          autoFocus
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) onSubmit(path.trim());
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="/Users/alex/project"
          aria-label="Folder path"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            border: '1px solid #D8CFB8',
            borderRadius: 6,
            background: '#FFFDF7',
            color: '#1C1A17',
            fontSize: 13,
            padding: '10px 11px',
            outline: 'none',
            marginBottom: 16,
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={{
            border: '1px solid #D8CFB8',
            background: '#FCFBF7',
            color: '#5C544B',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 13,
            cursor: 'pointer',
          }}>Cancel</button>
          <button
            onClick={() => canSubmit && onSubmit(path.trim())}
            disabled={!canSubmit}
            style={{
              border: '1px solid #1C1A17',
              background: canSubmit ? '#1C1A17' : '#D8CFB8',
              color: '#FCFBF7',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 13,
              cursor: canSubmit ? 'pointer' : 'default',
            }}
          >Create project</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = React.useState('new');
  const [currentChatId, setCurrentChatId] = React.useState(null);
  const [newTaskProjectId, setNewTaskProjectId] = React.useState(null);

  // Backend data
  const [projects, setProjects] = React.useState([]);
  const [projectChats, setProjectChats] = React.useState({});
  const [chatStatusOverrides, setChatStatusOverrides] = React.useState({});
  const [agentsMap, setAgentsMap] = React.useState({ '__human__': HUMAN_USER });
  const [skills, setSkills] = React.useState([]);
  const [runtimes, setRuntimes] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [backendOnline, setBackendOnline] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [folderPathDialogOpen, setFolderPathDialogOpen] = React.useState(false);
  const [pendingFolderPaths, setPendingFolderPaths] = React.useState([]);
  const [pairMobileOpen, setPairMobileOpen] = React.useState(false);
  const [onboardingRequired, setOnboardingRequired] = React.useState(false);
  const [forceOnboarding, setForceOnboarding] = React.useState(false);
  const showToast = React.useCallback((msg) => setToast(msg), []);

  const markOnboardingDone = React.useCallback(async () => {
    const status = await api.completeOnboarding();
    setOnboardingRequired(Boolean(status.onboarding_required));
    setForceOnboarding(false);
  }, []);

  const resetOnboarding = React.useCallback(() => {
    setForceOnboarding(true);
  }, []);


  const loadData = React.useCallback(async () => {
    try {
      const [projs, agts, sklls, rntms, onboarding] = await Promise.all([
        api.listProjects(),
        api.listAgents(),
        api.listSkills(),
        api.listRuntimes(),
        api.getOnboardingStatus(),
      ]);

      setProjects(projs);
      setSkills(sklls);
      setRuntimes(rntms);
      setOnboardingRequired(Boolean(onboarding.onboarding_required));
      setBackendOnline(true);

      // Build agents map with display properties
      const runtimesById = Object.fromEntries(rntms.map(r => [r.id, r]));
      const map = { '__human__': HUMAN_USER };
      agts.forEach(a => { map[a.id] = displayAgent(a, runtimesById); });
      rememberAgents(map);
      setAgentsMap(map);

      // Fetch chats for each project
      const chatMap = {};
      await Promise.all(projs.map(async p => {
        try { chatMap[p.id] = await api.listProjectChats(p.id); }
        catch { chatMap[p.id] = []; }
      }));
      setProjectChats(chatMap);
    } catch (err) {
      console.warn('Backend unavailable:', err.message);
      setBackendOnline(false);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { loadData(); }, [loadData]);

  React.useEffect(() => {
    const preventFileNavigation = (event) => {
      if (!dataTransferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
    };

    document.addEventListener('dragover', preventFileNavigation);
    document.addEventListener('drop', preventFileNavigation);
    return () => {
      document.removeEventListener('dragover', preventFileNavigation);
      document.removeEventListener('drop', preventFileNavigation);
    };
  }, []);

  const handlePickChat = React.useCallback((chatId) => {
    setCurrentChatId(chatId);
    setRoute('task');
  }, []);

  const handleNewTask = React.useCallback((chatId) => {
    setCurrentChatId(chatId);
    setRoute('task');
    // Refresh sidebar data
    loadData();
  }, [loadData]);

  const handleChatStreamingChange = React.useCallback((chatId, isStreaming) => {
    setChatStatusOverrides(prev => {
      if (isStreaming) return { ...prev, [chatId]: 'running' };
      if (!prev[chatId]) return prev;
      const next = { ...prev };
      delete next[chatId];
      return next;
    });
    if (!isStreaming) {
      api.getChat(chatId).then(c => {
        if (!c?.id || !c?.project_id) return;
        setProjectChats(prev => {
          const list = prev[c.project_id];
          if (!list) return prev;
          const idx = list.findIndex(x => x.id === c.id);
          if (idx === -1) return prev;
          const updated = list.slice();
          updated[idx] = { ...updated[idx], updated_at: c.updated_at, status: c.status };
          return { ...prev, [c.project_id]: updated };
        });
      }).catch(() => {});
    }
  }, []);

  // Reconcile sidebar running indicators for chats the user is not currently
  // viewing. TaskView's stream subscription closes when the user switches
  // away, so without this loop the override would stick at "running" forever
  // (or, before this loop existed, get falsely cleared on unmount).
  const runningChatIdsKey = React.useMemo(
    () => Object.entries(chatStatusOverrides)
      .filter(([, v]) => v === 'running')
      .map(([id]) => id)
      .sort()
      .join(','),
    [chatStatusOverrides]
  );
  React.useEffect(() => {
    if (!runningChatIdsKey) return;
    const ids = runningChatIdsKey.split(',');
    let cancelled = false;
    const reconcile = async () => {
      for (const id of ids) {
        try {
          const c = await api.getChat(id);
          if (cancelled) return;
          if (c?.stream?.status !== 'streaming') {
            setChatStatusOverrides(prev => {
              if (!prev[id]) return prev;
              const next = { ...prev };
              delete next[id];
              return next;
            });
          }
        } catch {
          // Backend hiccup — try again next tick.
        }
      }
    };
    const interval = setInterval(reconcile, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [runningChatIdsKey]);

  const handleDataRefresh = React.useCallback(() => {
    loadData();
  }, [loadData]);

  const agentsList = Object.values(agentsMap).filter(a => a.kind === 'agent');
  const handleNewChat = React.useCallback((projectId) => {
    setNewTaskProjectId(projectId);
    setRoute('new');
  }, []);

  const createProjectFromFolderPath = React.useCallback(async (folderPath) => {
    const normalizedPath = folderPath.trim();
    if (!normalizedPath) return false;
    const folderName = normalizedPath.split(/[\\/]/).filter(Boolean).pop() || normalizedPath;
    const createdProject = await createExistingFolderProject({
      folderName,
      workdir: normalizedPath,
      agents: agentsList,
      createProject: api.createProject,
      refreshProjects: loadData,
      showToast,
    });
    if (createdProject?.id) setNewTaskProjectId(createdProject.id);
    return createdProject;
  }, [agentsList, loadData, showToast]);

  const queueFolderForApproval = React.useCallback((folderPath) => {
    const trimmed = (folderPath || '').trim();
    if (!trimmed) return;
    setPendingFolderPaths(prev => [...prev, trimmed]);
  }, []);

  const handleDroppedProjectFolders = React.useCallback(async (folderPaths) => {
    for (const folderPath of folderPaths) queueFolderForApproval(folderPath);
  }, [queueFolderForApproval]);

  const handleExistingFolder = React.useCallback(() => {
    if (window.electronAPI?.openFolderDialog) {
      window.electronAPI.openFolderDialog().then((result) => {
        if (result.canceled || !result.filePaths?.[0]) return;
        queueFolderForApproval(result.filePaths[0]);
      });
      return;
    }

    setFolderPathDialogOpen(true);
  }, [queueFolderForApproval]);

  const pendingFolderPath = pendingFolderPaths[0] || null;
  const pendingFolderName = React.useMemo(() => {
    if (!pendingFolderPath) return '';
    return pendingFolderPath.split(/[\\/]/).filter(Boolean).pop() || pendingFolderPath;
  }, [pendingFolderPath]);

  const confirmPendingFolder = React.useCallback(async () => {
    if (!pendingFolderPath) return;
    setPendingFolderPaths(prev => prev.slice(1));
    await createProjectFromFolderPath(pendingFolderPath);
  }, [pendingFolderPath, createProjectFromFolderPath]);

  const cancelPendingFolders = React.useCallback(() => {
    setPendingFolderPaths([]);
  }, []);

  const handleCreateProject = React.useCallback(async (name) => {
    const mainAgentId = agentsList[0]?.id || '';
    if (!mainAgentId) {
      showToast('Create an agent before creating a project');
      return;
    }
    if (!window.electronAPI?.createBlankProjectFolder) {
      showToast('Blank project folders are only available in the desktop app');
      return;
    }
    try {
      const folder = await window.electronAPI.createBlankProjectFolder(name);
      const project = await api.createProject(name, folder.path, mainAgentId);
      if (project?.id) setNewTaskProjectId(project.id);
      loadData();
    } catch (err) {
      showToast(`Failed to create project: ${err.message}`);
    }
  }, [agentsList, loadData, showToast]);

  const handleRenameProject = React.useCallback(async (id, newName) => {
    const project = projects.find(p => p.id === id);
    if (!project || !newName.trim()) return;
    try {
      await api.updateProject(id, { ...project, name: newName.trim() });
      loadData();
    } catch (err) {
      console.error('Rename failed:', err);
    }
  }, [projects, loadData]);

  const handleRemoveProject = React.useCallback(async (id) => {
    const removedProjectChats = projectChats[id] || [];
    try {
      await api.deleteProject(id);
      if (removedProjectChats.some(chat => chat.id === currentChatId)) {
        setCurrentChatId(null);
        setRoute('new');
      }
      loadData();
    } catch (err) {
      showToast(`Failed to remove project: ${err.message}`);
    }
  }, [currentChatId, projectChats, loadData, showToast]);

  const handleShowInFinder = React.useCallback(async (workdir) => {
    if (!workdir) {
      showToast('No folder path set for this project');
      return;
    }

    // Electron production path
    if (window.electronAPI?.showInFinder) {
      window.electronAPI.showInFinder(workdir);
      showToast('Opening in Finder…');
      return;
    }

    // Relative paths can't be opened — the browser never knows the absolute path
    const isAbsolute = workdir.startsWith('/') || /^[A-Za-z]:[\\/]/.test(workdir);
    if (!isAbsolute) {
      showToast(`Path "${workdir}" is relative — set an absolute path in project settings`);
      return;
    }

    // Dev: Vite plugin POST /dev/open-folder → runs `open` on the host machine
    try {
      const res = await fetch('/dev/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: workdir }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast('Opened in Finder');
      } else {
        showToast(`Could not open folder: ${data.error || res.status}`);
      }
    } catch (e) {
      showToast(`Could not open folder: ${e.message}`);
    }
  }, [showToast]);

  const [nowTick, setNowTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Build sidebar-compatible project list from backend data
  const sidebarProjects = React.useMemo(() =>
    projects.map(p => ({
      id: p.id,
      name: p.name,
      workdir: p.workdir,
      sessions: (projectChats[p.id] || []).map(c => ({
        id: c.id,
        title: c.title || 'Untitled',
        status: chatStatusOverrides[c.id] || c.status || 'active',
        age: relativeTime(c.updated_at),
      })),
    })),
    [projects, projectChats, chatStatusOverrides, nowTick]
  );

  const [computerName, setComputerName] = React.useState('');
  React.useEffect(() => {
    if (window.electronAPI?.getComputerName) {
      window.electronAPI.getComputerName().then(name => {
        if (name) setComputerName(name);
      }).catch(() => {});
    }
  }, []);
  const deskName = computerName || 'Crew44';

  const shouldShowOnboarding =
    !loading && backendOnline && (
      forceOnboarding ||
      onboardingRequired
    );

  if (shouldShowOnboarding) {
    return (
      <>
        <style>{`@keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(8px) } to { opacity:1; transform:translateX(-50%) translateY(0) } }`}</style>
        {toast && <Toast message={toast} onDone={() => setToast(null)} />}
        <div style={{ width: '100%', height: '100%', background: '#FAF5E8', overflow: 'hidden' }}>
          <OnboardingRoute
            runtimes={runtimes}
            onSkip={async () => {
              try {
                await markOnboardingDone();
              } catch (err) {
                showToast(`Failed to finish setup: ${err.message}`);
              }
            }}
            onComplete={async () => {
              await markOnboardingDone();
              await loadData();
              showToast('Crew ready. Welcome aboard.');
            }}
          />
        </div>
      </>
    );
  }

  let content;
  if (loading) {
    content = <LoadingScreen />;
  } else if (route === 'task' && currentChatId) {
    content = <TaskView chatId={currentChatId} agentsMap={agentsMap} onStreamingChange={handleChatStreamingChange} />;
  } else if (route === 'new') {
    content = (
      <NewTaskRoute
        projects={projects}
        agents={agentsList}
        onNewTask={handleNewTask}
        onExistingFolder={handleExistingFolder}
        initialProjectId={newTaskProjectId}
      />
    );
  } else if (route === 'agents' || route === 'skills' || route === 'runtimes') {
    content = (
      <CrewRoute
        agents={agentsList}
        agentsMap={agentsMap}
        skills={skills}
        runtimes={runtimes}
        initialTab={route === 'skills' ? 'skills' : route === 'runtimes' ? 'runtimes' : 'agents'}
        onDataRefresh={handleDataRefresh}
        onToast={showToast}
      />
    );
  } else if (route === 'search') {
    content = (
      <EmptyRoute icon="search" title="Search"
        body="Search across every conversation, edit, and file the crew has touched. ⌘K from anywhere." />
    );
  } else if (route === 'auto') {
    content = <AutoRoute onToast={showToast} />;
  } else {
    content = <NewTaskRoute projects={projects} agents={agentsList} onNewTask={handleNewTask} onExistingFolder={handleExistingFolder} initialProjectId={newTaskProjectId} />;
  }

  return (
    <>
    <style>{`@keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(8px) } to { opacity:1; transform:translateX(-50%) translateY(0) } }`}</style>
    {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    {folderPathDialogOpen && (
      <BrowserFolderDialog
        onCancel={() => setFolderPathDialogOpen(false)}
        onSubmit={(folderPath) => {
          setFolderPathDialogOpen(false);
          queueFolderForApproval(folderPath);
        }}
      />
    )}
    {pendingFolderPath && (
      <FolderAccessWarningDialog
        folderName={pendingFolderName}
        onCancel={cancelPendingFolders}
        onConfirm={confirmPendingFolder}
      />
    )}
    {pairMobileOpen && <PairMobileDialog onClose={() => setPairMobileOpen(false)} />}
    <div style={{ width: '100%', height: '100%', display: 'flex', background: '#FAF5E8', overflow: 'hidden' }}>
      <Sidebar
        projects={sidebarProjects}
        currentChatId={currentChatId}
        route={route}
        setRoute={setRoute}
        onPick={handlePickChat}
        deskName={deskName}
        backendOnline={backendOnline}
        onNewProject={(type) => { if (type === 'folder') handleExistingFolder(); }}
        onNewChat={handleNewChat}
        onRenameProject={handleRenameProject}
        onShowInFinder={handleShowInFinder}
        onCreateProject={handleCreateProject}
        onRemoveProject={handleRemoveProject}
        onResetOnboarding={resetOnboarding}
        onPairMobile={() => setPairMobileOpen(true)}
        onDroppedProjectFolders={handleDroppedProjectFolders}
      />
      <div style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {content}
      </div>
    </div>
    </>
  );
}
