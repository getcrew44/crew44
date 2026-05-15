const CARET_STYLE_PROPS = [
  'boxSizing',
  'width',
  'height',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'MozTabSize',
];

export function textareaCaretPoint(textarea, position) {
  if (!textarea || typeof document === 'undefined') return null;

  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';

  for (const prop of CARET_STYLE_PROPS) {
    mirror.style[prop] = style[prop];
  }
  mirror.style.width = `${textarea.clientWidth}px`;

  const before = textarea.value.slice(0, position);
  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(position, position + 1) || '.';
  mirror.textContent = before;
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const fontSize = Number.parseFloat(style.fontSize) || 14;
  let lineHeight = Number.parseFloat(style.lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight < fontSize * 0.8) {
    lineHeight = fontSize * 1.4;
  }
  const point = {
    left: marker.offsetLeft,
    top: marker.offsetTop + lineHeight + 4,
  };

  mirror.remove();
  return point;
}
