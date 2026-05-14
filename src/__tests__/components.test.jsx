import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Avatar, MetaPill, Toggle, RichText, Icon } from '../components.jsx';

// ─── Avatar ────────────────────────────────────────────────────────────────────
describe('Avatar', () => {
  const agent = { id: 'a', name: 'Aria', initial: 'A', color: '#C4644A' };

  it('renders the agent initial', () => {
    render(<Avatar agent={agent} />);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('falls back to first letter of name when initial is missing', () => {
    const noInitial = { id: 'a', name: 'Zander' };
    render(<Avatar agent={noInitial} />);
    expect(screen.getByText('Z')).toBeInTheDocument();
  });

  it('returns null when agent is null', () => {
    const { container } = render(<Avatar agent={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('applies size prop to width/height', () => {
    const { container } = render(<Avatar agent={agent} size={40} />);
    const div = container.firstChild;
    expect(div).toHaveStyle({ width: '40px', height: '40px' });
  });

  it('uses fallback color when agent has none', () => {
    const noColor = { id: 'a', name: 'X', initial: 'X' };
    const { container } = render(<Avatar agent={noColor} />);
    expect(container.firstChild).toHaveStyle({ background: 'rgb(168, 159, 146)' }); // #A89F92
  });
});

// ─── MetaPill ──────────────────────────────────────────────────────────────────
describe('MetaPill', () => {
  it('renders children text', () => {
    render(<MetaPill>3 subtasks</MetaPill>);
    expect(screen.getByText('3 subtasks')).toBeInTheDocument();
  });

  it('renders a status dot when dot=true', () => {
    const { container } = render(<MetaPill dot dotColor="#C4644A">running</MetaPill>);
    const spans = container.querySelectorAll('span');
    // First span inside the pill is the dot
    expect(spans.length).toBeGreaterThan(1);
  });

  it('omits the dot when not provided', () => {
    const { container } = render(<MetaPill>plain</MetaPill>);
    const outerSpan = container.firstChild;
    // Only one inner span (the text)
    expect(outerSpan.children.length).toBe(0); // text node has no child element
  });
});

// ─── Toggle ────────────────────────────────────────────────────────────────────
describe('Toggle', () => {
  it('renders in the off state with light background', () => {
    const { container } = render(<Toggle on={false} onChange={() => {}} />);
    expect(container.firstChild).toHaveStyle({ background: 'rgb(220, 211, 188)' }); // #DCD3BC
  });

  it('renders in the on state with dark background', () => {
    const { container } = render(<Toggle on={true} onChange={() => {}} />);
    expect(container.firstChild).toHaveStyle({ background: 'rgb(28, 26, 23)' }); // #1C1A17
  });

  it('calls onChange with the toggled value when clicked', () => {
    const onChange = vi.fn();
    const { container } = render(<Toggle on={false} onChange={onChange} />);
    fireEvent.click(container.firstChild);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('flips back when clicked again', () => {
    const onChange = vi.fn();
    const { container } = render(<Toggle on={false} onChange={onChange} />);
    fireEvent.click(container.firstChild);
    fireEvent.click(container.firstChild);
    expect(onChange).toHaveBeenNthCalledWith(1, true);
    expect(onChange).toHaveBeenNthCalledWith(2, false);
  });

  it('does not crash without onChange prop', () => {
    const { container } = render(<Toggle on={false} />);
    expect(() => fireEvent.click(container.firstChild)).not.toThrow();
  });
});

// ─── RichText ──────────────────────────────────────────────────────────────────
describe('RichText', () => {
  it('renders plain text', () => {
    render(<RichText text="hello world" />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('renders {{file:path}} as a code element with the path', () => {
    const { container } = render(<RichText text="see {{file:src/app.js}}" />);
    const code = container.querySelector('code');
    expect(code).toBeInTheDocument();
    expect(code.textContent).toBe('src/app.js');
  });

  it('renders {{ref:id}} as @id mention', () => {
    const { container } = render(<RichText text="ping {{ref:milo}}" />);
    expect(container.textContent).toContain('@milo');
  });

  it('does not highlight raw @mention syntax inline', () => {
    const { container } = render(<RichText text="hey @aria how are you" />);
    expect(container.textContent).toContain('@aria');
    expect(container.textContent).toContain('how are you');
    expect(container.querySelector('span')).toBeNull();
  });

  it('handles multiple markup tokens in one string', () => {
    const { container } = render(
      <RichText text="@aria please look at {{file:foo.js}} and ping {{ref:milo}}" />
    );
    expect(container.textContent).toContain('@aria');
    expect(container.textContent).toContain('@milo');
    expect(container.querySelector('code').textContent).toBe('foo.js');
  });

  it('returns null for null/empty text', () => {
    const { container: c1 } = render(<RichText text={null} />);
    expect(c1).toBeEmptyDOMElement();
    const { container: c2 } = render(<RichText text="" />);
    expect(c2).toBeEmptyDOMElement();
  });

  it('preserves text around markup tokens', () => {
    const { container } = render(<RichText text="before {{file:x}} after" />);
    expect(container.textContent).toBe('before x after');
  });
});

// ─── Icon ──────────────────────────────────────────────────────────────────────
describe('Icon', () => {
  it('renders an svg for each known name', () => {
    for (const name of ['new', 'agents', 'auto', 'search', 'folder', 'folder-open', 'gear', 'phone', 'chev', 'plus']) {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    }
  });

  it('returns null for unknown names', () => {
    const { container } = render(<Icon name="not-a-real-icon" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('applies the size prop', () => {
    const { container } = render(<Icon name="folder" size={24} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
  });
});
