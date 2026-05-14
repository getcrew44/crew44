import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import OnboardingRoute, { DEFAULT_CREW } from '../OnboardingRoute.jsx';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
  rescanRuntimes: vi.fn(),
  listRuntimes: vi.fn(),
  createAgent: vi.fn(),
  seedDefaultCrew: vi.fn(),
}));

const claudeRuntime = { id: 'rt-claude', name: 'Claude Code', provider: 'claude', version: '2.1.0', status: 'available' };
const codexRuntime = { id: 'rt-codex', name: 'Codex', provider: 'codex', version: '0.125.0', status: 'available' };
const offlineRuntime = { id: 'rt-cursor', name: 'Cursor', provider: 'cursor', version: '0.4.0', status: 'unavailable' };

beforeEach(() => {
  vi.clearAllMocks();
  api.rescanRuntimes.mockResolvedValue({});
  api.listRuntimes.mockResolvedValue([claudeRuntime, codexRuntime]);
  api.createAgent.mockResolvedValue({});
  api.seedDefaultCrew.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

describe('Onboarding — welcome step', () => {
  it('renders the multi-agent hero copy and start button', () => {
    render(<OnboardingRoute runtimes={[]} onComplete={() => {}} onSkip={() => {}} />);
    expect(screen.getByText(/Multi-agent teams/i)).toBeInTheDocument();
    expect(screen.getByText(/Welcome to CrewAI/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start exploring/i })).toBeInTheDocument();
  });

  it('shows the right-column preview with all four agent cards', () => {
    render(<OnboardingRoute runtimes={[]} onComplete={() => {}} onSkip={() => {}} />);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Coding Agent')).toBeInTheDocument();
    expect(screen.getByText('Product Agent')).toBeInTheDocument();
    expect(screen.getByText('Partner')).toBeInTheDocument();
  });

  it('calls onSkip when "Skip setup" is clicked', () => {
    const onSkip = vi.fn();
    render(<OnboardingRoute runtimes={[]} onComplete={() => {}} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole('button', { name: /skip setup/i }));
    expect(onSkip).toHaveBeenCalledOnce();
  });
});

// ─── Step 2: Runtime scan ─────────────────────────────────────────────────────

describe('Onboarding — runtime scan step', () => {
  it('shows "Scanning…" while the scan is running and rescan is called', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<OnboardingRoute runtimes={[]} onComplete={() => {}} onSkip={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /start exploring/i }));

    // Initial scanning state
    expect(screen.getByText('Scanning your machine for runtimes...')).toBeInTheDocument();
    expect(api.rescanRuntimes).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /scanning…/i })).toBeDisabled();
  });

  it('updates title and lists runtimes once the scan resolves', async () => {
    render(<OnboardingRoute runtimes={[]} onComplete={() => {}} onSkip={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /start exploring/i }));

    // After the min 1500ms delay, results appear
    await waitFor(
      () => expect(screen.getByText(/Found 2 runtimes/i)).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).not.toBeDisabled();
  }, 6000);

  it('shows the error state when the backend scan fails', async () => {
    api.rescanRuntimes.mockRejectedValueOnce(new Error('connection refused'));
    render(<OnboardingRoute runtimes={[]} onComplete={() => {}} onSkip={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /start exploring/i }));

    await waitFor(
      () => expect(screen.getByText(/Couldn['’]t reach the runtime scanner/i)).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
  }, 6000);

  it('shows "No runtimes found" when the scan returns an empty list', async () => {
    api.listRuntimes.mockResolvedValueOnce([]);
    render(<OnboardingRoute runtimes={[]} onComplete={() => {}} onSkip={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /start exploring/i }));

    await waitFor(
      () => expect(screen.getByText(/No runtimes found on this machine/i)).toBeInTheDocument(),
      { timeout: 4000 },
    );
  }, 6000);

  it('Back returns to the welcome step', async () => {
    render(<OnboardingRoute runtimes={[]} onComplete={() => {}} onSkip={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /start exploring/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument(), { timeout: 4000 });

    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText(/Multi-agent teams/i)).toBeInTheDocument();
  }, 6000);
});

// ─── Step 3: Default crew ─────────────────────────────────────────────────────

async function advanceToCrewStep() {
  fireEvent.click(screen.getByRole('button', { name: /start exploring/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument(), { timeout: 4000 });
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  await waitFor(() => expect(screen.getByText(/Meet your starter crew/i)).toBeInTheDocument());
}

describe('Onboarding — crew step', () => {
  it('renders all default crew members selected by default', async () => {
    render(<OnboardingRoute runtimes={[]} onComplete={() => {}} onSkip={() => {}} />);
    await advanceToCrewStep();

    DEFAULT_CREW.forEach(member => {
      expect(screen.getByText(member.name)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Create 4 agents/i })).toBeInTheDocument();
  }, 6000);

  it('defaults the runtime picker to "Auto — pick the best available"', async () => {
    render(<OnboardingRoute runtimes={[]} onComplete={() => {}} onSkip={() => {}} />);
    await advanceToCrewStep();

    expect(screen.getByRole('button', { name: /Auto — pick the best available/i })).toBeInTheDocument();
  }, 6000);

  it('toggling a member off updates the create button count', async () => {
    render(<OnboardingRoute runtimes={[]} onComplete={() => {}} onSkip={() => {}} />);
    await advanceToCrewStep();

    fireEvent.click(screen.getByText('Coding Agent'));
    expect(screen.getByRole('button', { name: /Create 3 agents/i })).toBeInTheDocument();
  }, 6000);

  it('Partner stays selected when all members are clicked — it cannot be deselected', async () => {
    render(<OnboardingRoute runtimes={[]} onComplete={() => {}} onSkip={() => {}} />);
    await advanceToCrewStep();

    DEFAULT_CREW.forEach(member => fireEvent.click(screen.getByText(member.name)));
    // Partner is locked-in, so the cta should still ask to create at least one agent.
    expect(screen.getByRole('button', { name: /Create 1 agent/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Skip and finish/i })).not.toBeInTheDocument();
  }, 6000);

  it('seeds the default crew through the presets API so skills are attached', async () => {
    const onComplete = vi.fn();

    render(<OnboardingRoute runtimes={[]} onComplete={onComplete} onSkip={() => {}} />);
    await advanceToCrewStep();

    fireEvent.click(screen.getByRole('button', { name: /Create 4 agents/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce(), { timeout: 4000 });
    expect(api.seedDefaultCrew).toHaveBeenCalledOnce();
    expect(api.createAgent).not.toHaveBeenCalled();
  }, 6000);

  it('surfaces an error message and does not complete when preset seed fails', async () => {
    const onComplete = vi.fn();
    api.seedDefaultCrew.mockRejectedValueOnce(new Error('write failed'));

    render(<OnboardingRoute runtimes={[]} onComplete={onComplete} onSkip={() => {}} />);
    await advanceToCrewStep();

    fireEvent.click(screen.getByRole('button', { name: /Create 4 agents/i }));

    await waitFor(
      () => expect(screen.getByText(/Could not finish setup.*write failed/i)).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(onComplete).not.toHaveBeenCalled();
  }, 6000);
});
