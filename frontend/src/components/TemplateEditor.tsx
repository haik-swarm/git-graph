import React, { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import DataObjectRoundedIcon from '@mui/icons-material/DataObjectRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { menuSurface, slimScroll } from '@/shared/styles/ui';

export interface TemplateVar {
  name: string;
  desc: string;
}

interface Props {
  /** Canonical value with variables written as {name}. */
  value: string;
  onChange: (next: string) => void;
  /** Variables offered in the @ picker and rendered as pills. */
  variables: TemplateVar[];
  /** Built-in default this field resets to. */
  defaultValue: string;
  onReset: () => void;
  /** Variables the default template used, for the drop warning. */
  requiredVars?: string[];
}

const TOKEN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

function tokenNames(text: string): Set<string> {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(TOKEN);
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return out;
}

/**
 * A human-readable prompt-template field: known {variables} render as removable
 * pills instead of raw braces, and typing `@` opens a picker to insert one. The
 * contentEditable DOM is driven imperatively so typing never loses the caret;
 * React only re-seeds it when `value` changes from the outside (load / reset).
 */
const TemplateEditor: React.FC<Props> = ({
  value,
  onChange,
  variables,
  defaultValue,
  onReset,
  requiredVars,
}) => {
  const c = useClaudeTokens();
  const editRef = useRef<HTMLDivElement | null>(null);
  // The last value we serialized out, so an incoming `value` that merely echoes
  // our own edit doesn't trigger a DOM rewrite (which would jump the caret).
  const lastSerialized = useRef<string>('');
  const savedRange = useRef<Range | null>(null);
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);

  const known = new Set(variables.map(v => v.name));

  // Build the pill/text DOM for a canonical string into the editable div.
  const paint = useCallback(
    (text: string) => {
      const host = editRef.current;
      if (!host) return;
      host.textContent = '';
      let last = 0;
      const re = new RegExp(TOKEN);
      let m: RegExpExecArray | null;
      const pushText = (s: string) => {
        if (s) host.appendChild(document.createTextNode(s));
      };
      while ((m = re.exec(text)) !== null) {
        pushText(text.slice(last, m.index));
        if (known.has(m[1])) host.appendChild(makePill(m[1]));
        else pushText(m[0]); // unknown var stays literal
        last = m.index + m[0].length;
      }
      pushText(text.slice(last));
    },
    // known is derived from variables; re-paint if the variable set changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variables],
  );

  const makePill = (name: string): HTMLSpanElement => {
    const span = document.createElement('span');
    span.setAttribute('data-var', name);
    span.setAttribute('contenteditable', 'false');
    span.textContent = name;
    span.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'padding:1px 6px',
      'margin:0 1px',
      `border-radius:${c.radius.sm}px`,
      `background:rgba(${c.accentRgb},0.12)`,
      `color:${c.accent.primary}`,
      `border:1px solid rgba(${c.accentRgb},0.35)`,
      'font-family:' + c.font.sans,
      'font-size:11px',
      'font-weight:600',
      'user-select:none',
      'white-space:nowrap',
    ].join(';');
    return span;
  };

  // Walk the DOM back to a canonical {var} string.
  const serialize = useCallback((): string => {
    const host = editRef.current;
    if (!host) return '';
    let out = '';
    const walk = (node: Node) => {
      node.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
          out += child.textContent ?? '';
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const el = child as HTMLElement;
          const v = el.getAttribute('data-var');
          if (v) out += `{${v}}`;
          else if (el.tagName === 'BR') out += '\n';
          else walk(el); // browser-inserted wrapper
        }
      });
    };
    walk(host);
    return out;
  }, []);

  const emit = useCallback(() => {
    const next = serialize();
    lastSerialized.current = next;
    onChange(next);
  }, [serialize, onChange]);

  // Seed / re-seed the DOM only when the external value diverges from what we
  // last emitted (initial load, reset, or a programmatic change).
  useEffect(() => {
    if (value === lastSerialized.current) return;
    lastSerialized.current = value;
    paint(value);
  }, [value, paint]);

  const openMenuAtCaret = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    savedRange.current = range.cloneRange();
    const rect = range.getBoundingClientRect();
    const host = editRef.current!.getBoundingClientRect();
    // Fall back to the field's own box when the caret rect is empty (collapsed
    // at the very start gives a zero rect in some browsers).
    const top = (rect.top || host.top) + (rect.height || 16);
    const left = rect.left || host.left;
    setMenu({ top, left });
  };

  const insertVar = (name: string) => {
    const host = editRef.current;
    const range = savedRange.current;
    setMenu(null);
    if (!host) return;
    host.focus();
    const sel = window.getSelection();
    if (range && sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const r = sel?.getRangeAt(0);
    const pill = makePill(name);
    if (r) {
      r.deleteContents();
      r.insertNode(pill);
      // caret after the pill
      const after = document.createRange();
      after.setStartAfter(pill);
      after.collapse(true);
      sel!.removeAllRanges();
      sel!.addRange(after);
    } else {
      host.appendChild(pill);
    }
    emit();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === '@') {
      e.preventDefault();
      openMenuAtCaret();
    } else if (e.key === 'Enter') {
      // Templates are single logical strings; keep Enter from splitting blocks.
      e.preventDefault();
    }
  };

  const missing = (requiredVars ?? []).filter(
    v => !tokenNames(value).has(v),
  );
  const isDefault = value.trim() === defaultValue.trim();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box
        ref={editRef}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onKeyDown={onKeyDown}
        spellCheck={false}
        sx={{
          m: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: c.font.mono,
          fontSize: 11,
          lineHeight: 1.7,
          color: c.text.primary,
          p: 1,
          minHeight: 34,
          borderRadius: `${c.radius.sm}px`,
          background: c.bg.secondary,
          border: `1px solid ${c.border.subtle}`,
          outline: 'none',
          transition: c.transition,
          '&:focus': {
            borderColor: c.accent.primary,
            background: c.bg.surface,
          },
          '&:empty::before': {
            content: '"Empty — falls back to the built-in default"',
            color: c.text.ghost,
          },
        }}
      />
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minHeight: 18,
        }}
      >
        <ButtonBase
          onClick={openMenuAtCaret}
          sx={{
            ...c.type.caption,
            color: c.accent.primary,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            px: '4px',
            borderRadius: `${c.radius.sm}px`,
            '&:hover': { background: c.bg.secondary },
          }}
          title="Insert a variable (or type @ in the field)"
        >
          <DataObjectRoundedIcon sx={{ fontSize: 13 }} />
          Insert variable
        </ButtonBase>
        {missing.length > 0 && (
          <Box
            sx={{
              ...c.type.caption,
              color: c.status.warning,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <WarningAmberRoundedIcon sx={{ fontSize: 13 }} />
            dropped {missing.map(v => `{${v}}`).join(', ')}
          </Box>
        )}
        <Box sx={{ flex: 1 }} />
        {!isDefault && (
          <ButtonBase
            onClick={onReset}
            sx={{
              ...c.type.caption,
              color: c.text.tertiary,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              px: '4px',
              borderRadius: `${c.radius.sm}px`,
              '&:hover': { background: c.bg.secondary, color: c.text.secondary },
            }}
            title="Restore the built-in default template"
          >
            <RestartAltRoundedIcon sx={{ fontSize: 13 }} />
            Reset to default
          </ButtonBase>
        )}
      </Box>

      <Popover
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.top, left: menu.left } : undefined}
        slotProps={{ paper: { sx: { ...menuSurface(c), width: 260, maxHeight: 260, overflowY: 'auto', ...slimScroll(c) } } }}
      >
        {variables.map(v => (
          <ButtonBase
            key={v.name}
            onClick={() => insertVar(v.name)}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: '1px',
              width: '100%',
              textAlign: 'left',
              px: '10px',
              py: '6px',
              borderRadius: `${c.radius.sm}px`,
              '&:hover': { background: c.bg.secondary },
            }}
          >
            <Box
              sx={{
                ...c.type.caption,
                fontFamily: c.font.mono,
                fontWeight: 600,
                color: c.accent.primary,
              }}
            >
              {`{${v.name}}`}
            </Box>
            <Box sx={{ ...c.type.caption, color: c.text.tertiary }}>{v.desc}</Box>
          </ButtonBase>
        ))}
      </Popover>
    </Box>
  );
};

export default TemplateEditor;
