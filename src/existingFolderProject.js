export async function createExistingFolderProject({
  folderName,
  workdir,
  agents,
  createProject,
  refreshProjects,
  showToast,
}) {
  const mainAgentId = agents.find(agent => agent?.id)?.id || '';
  if (!mainAgentId) {
    showToast?.('Create an agent before adding a project folder');
    return false;
  }

  try {
    const project = await createProject(folderName, workdir, mainAgentId);
    await refreshProjects?.();
    return project || true;
  } catch (err) {
    showToast?.(`Failed to create project: ${err.message}`);
    return false;
  }
}
