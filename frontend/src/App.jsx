import React from 'react';
import Sidebar from './Sidebar.jsx';
import TaskView from './TaskView.jsx';
import CrewRoute from './CrewRoute.jsx';
import NewTaskRoute from './NewTaskRoute.jsx';
import { Icon } from './components.jsx';
import { displayAgent, relativeTime, HUMAN_USER } from './utils.js';
import * as api from './api.js';

function EmptyRoute({ icon, title, body }) {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#FAF5E8',
      color: '#5C544B', textAlign: 'center', padding: 40,
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
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FAF5E8', color: '#A89F92', fontSize: 13 }}>
      Connecting to backend…
    </div>
  );
}

export default function App() {
  const [route, setRoute] = React.useState('new');
  const [currentChatId, setCurrentChatId] = React.useState(null);

  // Backend data
  const [projects, setProjects] = React.useState([]);
  const [projectChats, setProjectChats] = React.useState({});
  const [agentsMap, setAgentsMap] = React.useState({ '__human__': HUMAN_USER });
  const [skills, setSkills] = React.useState([]);
  const [runtimes, setRuntimes] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [backendOnline, setBackendOnline] = React.useState(false);


  const loadData = React.useCallback(async () => {
    try {
      const [projs, agts, sklls, rntms] = await Promise.all([
        api.listProjects(),
        api.listAgents(),
        api.listSkills(),
        api.listRuntimes(),
      ]);

      setProjects(projs);
      setSkills(sklls);
      setRuntimes(rntms);
      setBackendOnline(true);

      // Build agents map with display properties
      const map = { '__human__': HUMAN_USER };
      agts.forEach(a => { map[a.id] = displayAgent(a); });
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

  const handleDataRefresh = React.useCallback(() => {
    loadData();
  }, [loadData]);

  const agentsList = Object.values(agentsMap).filter(a => a.kind === 'agent');

  const handleExistingFolder = React.useCallback(() => {
    if (window.electronAPI?.openFolderDialog) {
      window.electronAPI.openFolderDialog().then(async (result) => {
        if (result.canceled || !result.filePaths?.[0]) return;
        const folderPath = result.filePaths[0];
        const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;
        try {
          await api.createProject(folderName, folderPath, agentsList[0]?.id || '');
          loadData();
        } catch (err) {
          console.error('Failed to create project:', err);
        }
      });
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.style.display = 'none';
    input.onchange = async (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      // The folder path comes from the first file's webkitRelativePath
      const folderName = files[0].webkitRelativePath.split('/')[0];
      // Create a project with this folder name
      try {
        await api.createProject(folderName, folderName, '');
        loadData();
      } catch (err) {
        console.error('Failed to create project:', err);
      }
      document.body.removeChild(input);
    };
    document.body.appendChild(input);
    input.click();
  }, [agentsList, loadData]);

  // Build sidebar-compatible project list from backend data
  const sidebarProjects = React.useMemo(() =>
    projects.map(p => ({
      id: p.id,
      name: p.name,
      sessions: (projectChats[p.id] || []).map(c => ({
        id: c.chat_id,
        title: c.title || 'Untitled',
        status: c.status || 'active',
        age: relativeTime(c.updated_at),
      })),
    })),
    [projects, projectChats]
  );

  const deskName = runtimes[0]?.name || 'CrewAI Desktop';

  let content;
  if (loading) {
    content = <LoadingScreen />;
  } else if (route === 'task' && currentChatId) {
    content = <TaskView chatId={currentChatId} agentsMap={agentsMap} />;
  } else if (route === 'new') {
    content = (
      <NewTaskRoute
        projects={projects}
        agents={agentsList}
        onNewTask={handleNewTask}
        onExistingFolder={handleExistingFolder}
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
      />
    );
  } else if (route === 'search') {
    content = (
      <EmptyRoute icon="search" title="Search"
        body="Search across every conversation, edit, and file the crew has touched. ⌘K from anywhere." />
    );
  } else if (route === 'auto') {
    content = (
      <EmptyRoute icon="auto" title="Auto optimization"
        body="Suggest model swaps, prompt tightening, and tool consolidations based on the last week of runs." />
    );
  } else {
    content = <NewTaskRoute projects={projects} agents={agentsList} onNewTask={handleNewTask} onExistingFolder={handleExistingFolder} />;
  }

  return (
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
      />
      <div style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {content}
      </div>
    </div>
  );
}
