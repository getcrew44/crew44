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
    qr_text: 'https://mobileapp.crew44.io/#secret=%7B%22v%22%3A1%7D',
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
      expect(createRemotePairing).toHaveBeenCalledWith('wss://relay.crew44.io/relay');
    });
    expect(await screen.findByTestId('mobile-pair-qr')).toBeInTheDocument();
  });

  it('does not expose relay editing controls', async () => {
    render(<PairMobileDialog onClose={() => {}} />);

    await waitFor(() => expect(createRemotePairing).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Relay URL')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit relay url/i })).not.toBeInTheDocument();
  });

  it('shows RPC errors from pairing creation', async () => {
    createRemotePairing.mockRejectedValue(new Error('relay_url is required'));
    render(<PairMobileDialog onClose={() => {}} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('relay_url is required');
  });

  it('renders phone-camera pairing guidance and copies the pair link', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(<PairMobileDialog onClose={() => {}} />);

    await screen.findByTestId('mobile-pair-qr');
    expect(screen.getByText(/simply scan the QR above/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(pairingResult.qr_text);
    });
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
    expect(screen.getByText('https://mobileapp.crew44.io/')).toBeInTheDocument();
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
