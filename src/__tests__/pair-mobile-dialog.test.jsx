import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../api.js', () => ({
  createRemotePairing: vi.fn(),
  deleteRemoteDevice: vi.fn(),
}));

import { createRemotePairing, deleteRemoteDevice } from '../api.js';
import PairMobileDialog, { ManageMobileDialog } from '../PairMobileDialog.jsx';

describe('PairMobileDialog', () => {
  const pairingResult = {
    qr_text: '{"type":"crew44-remote-pairing"}',
    offer: { expires_at: '2026-05-13T12:00:00.000Z' },
  };

  beforeEach(() => {
    createRemotePairing.mockReset();
    deleteRemoteDevice.mockReset();
    createRemotePairing.mockResolvedValue(pairingResult);
    deleteRemoteDevice.mockResolvedValue({ ok: true });
  });

  it('creates and renders a QR immediately with the deployed relay URL', async () => {
    render(<PairMobileDialog onClose={() => {}} />);

    await waitFor(() => {
      expect(createRemotePairing).toHaveBeenCalledWith('wss://relay.mindivelabs.com/relay');
    });
    expect(await screen.findByTestId('mobile-pair-qr')).toBeInTheDocument();
  });

  it('lets the relay URL be overridden from the pen edit action without persisting it locally', async () => {
    const setItem = vi.fn();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: vi.fn(), setItem },
    });
    render(<PairMobileDialog onClose={() => {}} />);

    await waitFor(() => expect(createRemotePairing).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /edit relay url/i }));
    fireEvent.change(screen.getByLabelText('Relay URL'), {
      target: { value: 'wss://relay.example.com/relay' },
    });
    fireEvent.click(screen.getByTestId('create-mobile-pairing'));

    await waitFor(() => {
      expect(createRemotePairing).toHaveBeenLastCalledWith('wss://relay.example.com/relay');
    });
    expect(setItem).not.toHaveBeenCalled();
  });

  it('shows RPC errors from pairing creation', async () => {
    createRemotePairing.mockRejectedValue(new Error('relay_url is required'));
    render(<PairMobileDialog onClose={() => {}} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('relay_url is required');
  });
});

describe('ManageMobileDialog', () => {
  it('renders paired devices with pair date and last active when present', () => {
    render(
      <ManageMobileDialog
        onClose={() => {}}
        devices={[{
          device_id: 'dev-1',
          name: 'Alex iPhone',
          created_at: '2026-05-13T12:00:00.000Z',
          last_seen_at: '2026-05-13T12:30:00.000Z',
        }]}
      />
    );

    const row = screen.getByTestId('mobile-device-row');
    expect(row).toHaveTextContent('Alex iPhone');
    expect(row).toHaveTextContent('Paired');
    expect(row).toHaveTextContent('Last active');
  });

  it('omits last active when the backend has not recorded it', () => {
    render(
      <ManageMobileDialog
        onClose={() => {}}
        devices={[{
          device_id: 'dev-1',
          name: 'Alex iPhone',
          created_at: '2026-05-13T12:00:00.000Z',
        }]}
      />
    );

    expect(screen.getByTestId('mobile-device-row')).not.toHaveTextContent('Last active');
  });

  it('unpairs a device', async () => {
    const onChanged = vi.fn();
    render(
      <ManageMobileDialog
        onClose={() => {}}
        onChanged={onChanged}
        devices={[{
          device_id: 'dev-1',
          name: 'Alex iPhone',
          created_at: '2026-05-13T12:00:00.000Z',
        }]}
      />
    );

    fireEvent.click(within(screen.getByTestId('mobile-device-row')).getByText('Unpair'));

    await waitFor(() => {
      expect(deleteRemoteDevice).toHaveBeenCalledWith('dev-1');
    });
    expect(onChanged).toHaveBeenCalledWith([]);
    expect(screen.getByText('No mobile devices are paired.')).toBeInTheDocument();
  });
});
