import { describe, it, expect } from 'vitest';
import { createExistingFolderProject } from '../existingFolderProject.js';

describe('createExistingFolderProject', () => {
  it('uses the first available agent when creating a project from a browser folder selection', async () => {
    const calls = [];

    await createExistingFolderProject({
      folderName: 'demo-project',
      workdir: 'demo-project',
      agents: [{ id: 'agent-123' }],
      createProject: async (...args) => calls.push(args),
      refreshProjects: async () => calls.push(['refresh']),
      showToast: () => {},
    });

    expect(calls).toEqual([
      ['demo-project', 'demo-project', 'agent-123'],
      ['refresh'],
    ]);
  });

  it('does not call the API when no agent is available', async () => {
    const calls = [];
    const toasts = [];

    await createExistingFolderProject({
      folderName: 'demo-project',
      workdir: 'demo-project',
      agents: [],
      createProject: async (...args) => calls.push(args),
      refreshProjects: async () => calls.push(['refresh']),
      showToast: (message) => toasts.push(message),
    });

    expect(calls).toEqual([]);
    expect(toasts).toEqual(['Create an agent before adding a project folder']);
  });
});
