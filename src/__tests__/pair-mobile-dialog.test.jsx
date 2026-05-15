import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({
  createRemotePairing: vi.fn(),
}));

import { createRemotePairing } from '../api.js';
import PairMobileDialog from '../PairMobileDialog.jsx';

describe('PairMobileDialog', () => {
  const storage = new Map();

  beforeEach(() => {
    createRemotePairing.mockReset();
    storage.clear();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: key => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, String(value)),
      },
    });
  });

  it('calls remote.pairing.create and renders a QR result', async () => {
    createRemotePairing.mockResolvedValue({
      qr_text: '{"type":"crew44-remote-pairing"}',
      offer: { expires_at: '2026-05-13T12:00:00.000Z' },
    });
    render(<PairMobileDialog onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText('Relay WebSocket URL'), {
      target: { value: 'wss://relay.example.com/relay' },
    });
    fireEvent.click(screen.getByTestId('create-mobile-pairing'));

    await waitFor(() => {
      expect(createRemotePairing).toHaveBeenCalledWith('wss://relay.example.com/relay');
    });
    expect(await screen.findByTestId('mobile-pair-qr')).toBeInTheDocument();
  });

  it('uses the deployed relay as the default when no relay was saved', async () => {
    createRemotePairing.mockResolvedValue({
      qr_text: '{"type":"crew44-remote-pairing"}',
      offer: { expires_at: '2026-05-13T12:00:00.000Z' },
    });
    render(<PairMobileDialog onClose={() => {}} />);

    expect(screen.getByLabelText('Relay WebSocket URL')).toHaveValue('wss://relay.mindivelabs.com/relay');
    fireEvent.click(screen.getByTestId('create-mobile-pairing'));

    await waitFor(() => {
      expect(createRemotePairing).toHaveBeenCalledWith('wss://relay.mindivelabs.com/relay');
    });
  });

  it('shows RPC errors from pairing creation', async () => {
    createRemotePairing.mockRejectedValue(new Error('relay_url is required'));
    render(<PairMobileDialog onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText('Relay WebSocket URL'), {
      target: { value: 'wss://relay.example.com/relay' },
    });
    fireEvent.click(screen.getByTestId('create-mobile-pairing'));

    expect(await screen.findByRole('alert')).toHaveTextContent('relay_url is required');
  });
});
