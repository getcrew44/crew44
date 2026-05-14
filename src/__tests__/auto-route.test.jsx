import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AutoRoute from '../AutoRoute.jsx';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
  listOptimizerSuggestions: vi.fn(),
  runOptimizerScan: vi.fn(),
  actOnSuggestion: vi.fn(),
  getOptimizerSchedule: vi.fn(),
  setOptimizerSchedule: vi.fn(),
  getOptimizerScan: vi.fn(),
  purgeOptimizerScans: vi.fn(),
}));

const skillEntry = {
  suggestion: {
    id: 'scan-1:k-1',
    scan_id: 'scan-1',
    kind: 'skill',
    priority: 'high',
    title: 'Codify the locale-video prep',
    body: '5 runs in 8 days.',
    impact: '-4m/run',
    generated_at: '2026-05-12T10:00:00Z',
    evidence: { runs: ['t-1'], windows: ['5 runs'] },
    preview: { type: 'skill', name: 'locale-video-prep', lines: ['# locale-video-prep', 'body'] },
  },
};

const baseSchedule = {
  cadence: 'weekly', day: 0, dom: 1, time: '03:00', tz: 'Local',
  surfaces: { skill: true, memory: true, strategy: true },
  threshold: 'med',
};

function expectedLastScanDate(iso) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

function expectedLastScanTime(iso) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getOptimizerSchedule.mockResolvedValue(baseSchedule);
  api.setOptimizerSchedule.mockImplementation(async (s) => s);
  api.runOptimizerScan.mockResolvedValue({ scan_id: 'scan-2', in_flight: false });
  api.actOnSuggestion.mockResolvedValue({ ok: true });
});

describe('AutoRoute', () => {
  it('shows the last completed scan as a date and time', async () => {
    api.listOptimizerSuggestions.mockResolvedValue({
      items: [],
      last_scan_at: '2026-05-12T10:00:00Z',
      last_scan_status: 'success',
      runs_analyzed: 12,
      scanning: false,
    });

    render(<AutoRoute onToast={vi.fn()} />);

    const time = await screen.findByTestId('last-scan-time');
    const date = await screen.findByTestId('last-scan-date');
    expect(date).toHaveTextContent(expectedLastScanDate('2026-05-12T10:00:00Z'));
    expect(time).toHaveTextContent(expectedLastScanTime('2026-05-12T10:00:00Z'));
    expect(date).toHaveStyle({ fontSize: '18px' });
    expect(time).toHaveStyle({ fontSize: '12px' });
    expect(screen.queryByText(/^\\d+[smhd]$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2026年/)).not.toBeInTheDocument();
  });

  it('shows never for an epoch default last scan value', async () => {
    api.listOptimizerSuggestions.mockResolvedValue({
      items: [],
      last_scan_at: '1970-01-01T00:00:00Z',
      last_scan_status: '',
      runs_analyzed: 0,
      scanning: false,
    });

    render(<AutoRoute onToast={vi.fn()} />);

    await screen.findByText('Run your first scan to see suggestions.');
    expect(await screen.findByText('never')).toBeInTheDocument();
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
  });

  it('uses roomier fixed-size day buttons in the schedule dialog', async () => {
    api.listOptimizerSuggestions.mockResolvedValue({
      items: [],
      last_scan_at: null,
      last_scan_status: '',
      runs_analyzed: 0,
      scanning: false,
    });

    render(<AutoRoute onToast={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Schedule' }));

    const sun = await screen.findByRole('button', { name: 'Sun' });
    expect(sun).toHaveStyle({
      minWidth: '42px',
      height: '34px',
      padding: '0px',
    });
  });

  it('uses the same outer whitespace and centered content width as the agents page', async () => {
    api.listOptimizerSuggestions.mockResolvedValue({
      items: [],
      last_scan_at: null,
      last_scan_status: '',
      runs_analyzed: 0,
      scanning: false,
    });

    const { container } = render(<AutoRoute onToast={vi.fn()} />);

    await screen.findByText('Run your first scan to see suggestions.');

    expect(container.querySelector('[data-testid="auto-route-shell"]')).toHaveStyle({
      padding: '60px 36px',
    });
    expect(container.querySelector('[data-testid="auto-route-content"]')).toHaveStyle({
      maxWidth: '720px',
      margin: '0px auto',
    });
  });

  it('shows the What it sees prompt only before the first completed scan when no suggestions exist', async () => {
    api.listOptimizerSuggestions.mockResolvedValue({
      items: [],
      last_scan_at: null,
      last_scan_status: '',
      runs_analyzed: 0,
      scanning: false,
    });

    render(<AutoRoute onToast={vi.fn()} />);

    expect(await screen.findByText(/Auto-optimization runs through your Partner agent/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /What it sees/i })).toBeInTheDocument();
  });

  it('hides the What it sees prompt after a completed scan even when no suggestions are returned', async () => {
    api.listOptimizerSuggestions.mockResolvedValue({
      items: [],
      last_scan_at: '2026-05-12T10:00:00Z',
      last_scan_status: 'success',
      runs_analyzed: 12,
      scanning: false,
    });

    render(<AutoRoute onToast={vi.fn()} />);

    await screen.findByText('No suggestions in this category. Nice — your crew is dialed in.');
    expect(screen.queryByText(/Auto-optimization runs through your Partner agent/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /What it sees/i })).not.toBeInTheDocument();
  });

  it('hides the What it sees prompt when suggestions exist', async () => {
    api.listOptimizerSuggestions.mockResolvedValue({
      items: [skillEntry],
      last_scan_at: null,
      last_scan_status: '',
      runs_analyzed: 0,
      scanning: false,
    });

    render(<AutoRoute onToast={vi.fn()} />);

    await screen.findByText('Codify the locale-video prep');
    expect(screen.queryByText(/Auto-optimization runs through your Partner agent/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /What it sees/i })).not.toBeInTheDocument();
  });

  it('renders a failure banner when the last scan failed, hides it on dismiss, and re-runs on retry', async () => {
    api.listOptimizerSuggestions.mockResolvedValue({
      items: [],
      last_scan_at: '2026-05-12T10:00:00Z',
      last_scan_status: 'failed',
      last_scan_error: 'partner unavailable',
      runs_analyzed: 0,
      scanning: false,
    });

    render(<AutoRoute onToast={vi.fn()} />);

    // Banner appears with the error string.
    const bannerText = await screen.findByText(/Last auto-scan failed/);
    expect(bannerText).toHaveTextContent('partner unavailable');

    // Clicking Retry calls runOptimizerScan.
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(api.runOptimizerScan).toHaveBeenCalledOnce());

    // Dismiss removes the banner without further API calls.
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Last auto-scan failed/)).not.toBeInTheDocument();
    });
  });

  it('triggers an accept action and surfaces the kind-aware toast', async () => {
    api.listOptimizerSuggestions.mockResolvedValue({
      items: [skillEntry],
      last_scan_at: '2026-05-12T10:00:00Z',
      last_scan_status: 'success',
      runs_analyzed: 12,
      scanning: false,
    });

    const toast = vi.fn();
    render(<AutoRoute onToast={toast} />);

    const accept = await screen.findByRole('button', { name: /^Accept$/i });
    await act(async () => { fireEvent.click(accept); });

    await waitFor(() => expect(api.actOnSuggestion).toHaveBeenCalledWith('scan-1:k-1', 'accept'));
    // Skill kind → "Saved to skills/" toast.
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Saved to skills/'));
  });

  it('renders pending memory compaction as a non-actionable queued row', async () => {
    api.listOptimizerSuggestions.mockResolvedValue({
      items: [{
        suggestion: {
          ...skillEntry.suggestion,
          id: 'scan-1:m-1',
          kind: 'memory-user',
          title: 'Remember copy style',
          preview: { type: 'memory', scope: 'You', text: 'Prefer short copy.' },
        },
        state: { state: 'pending_compaction', applied_to: '/fake/USER.md.pending' },
      }],
      last_scan_at: '2026-05-12T10:00:00Z',
      last_scan_status: 'success',
      runs_analyzed: 12,
      scanning: false,
    });

    render(<AutoRoute onToast={vi.fn()} />);

    expect(await screen.findByText('Queued for compaction')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Accept/i })).not.toBeInTheDocument();
  });
});
