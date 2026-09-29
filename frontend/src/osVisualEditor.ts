/**
 * Visual Editor overlay — injected into a target app so it can be inspected
 * from the Visual Editor card next to it.
 *
 * Why this lives INSIDE the target app: each OpenSwarm app is served by its own
 * Vite dev server on its own random port, so the editor's iframe is a foreign
 * origin and the parent can't touch this document. The editor can't reach in, so
 * the app reports out over postMessage.
 *
 * Element -> source needs no Babel plugin: @vitejs/plugin-react compiles JSX
 * with jsxDEV in dev, which stamps every call site with {fileName, lineNumber,
 * columnNumber}, and React 18 copies that onto each fiber as _debugSource.
 *
 * Dev-only and self-disabling: bails out unless import.meta.env.DEV, so a
 * production build ships nothing.
 */

const CHANNEL = 'openswarm:visual-editor';
const PROTOCOL = 1;

if (import.meta.env.DEV && typeof window !== 'undefined' && !window.__osVisualEditor) {
  const state = {
    enabled: false,
    hovered: null,
    selected: null,
    srcRoot: '',
  };

  // ---------------------------------------------------------------- fibers

  const fiberOf = (node) => {
    for (const key in node) {
      if (key.startsWith('__reactFiber$')) return node[key];
    }
    return null;
  };

  /** Is this source file part of the app's own code (not a dependency)?
   *
   * Compared case-insensitively on purpose. macOS is case-insensitive, so the
   * same directory is reachable as both ".../Application Support/OpenSwarm/..."
   * and ".../Application Support/openswarm/...". Vite resolves its own cwd to
   * the lowercase spelling while the backend reports the canonical mixed-case
   * one, so an exact startsWith rejects every element in the app.
   */
  const isAppSource = (fileName) => {
    if (!fileName) return false;
    if (fileName.includes('node_modules')) return false;
    if (!/\.[jt]sx?$/.test(fileName)) return false;
    if (!state.srcRoot) return fileName.includes('/src/');
    return fileName.toLowerCase().startsWith(state.srcRoot.toLowerCase());
  };

  const componentNameOf = (type) => {
    if (!type) return null;
    if (typeof type === 'string') return type;
    return type.displayName || type.name || null;
  };

  /**
   * Walk up from the clicked node's fiber to the nearest JSX site the user
   * actually wrote. A bare <div> authored in the app resolves immediately; a
   * <Box sx={...}> renders a div created inside MUI/emotion, whose own
   * _debugSource is null or points into node_modules, so we climb the return
   * chain past the library internals until we land back in app source.
   */
  const resolveSource = (node) => {
    let fiber = fiberOf(node);
    let hops = 0;
    let ownerName = null;

    while (fiber && hops < 40) {
      const src = fiber._debugSource;
      if (src && isAppSource(src.fileName)) {
        // The component this JSX lives inside, for the breadcrumb.
        let owner = fiber._debugOwner;
        let ownerHops = 0;
        while (owner && ownerHops < 40) {
          const name = componentNameOf(owner.elementType || owner.type);
          if (name && typeof (owner.elementType || owner.type) !== 'string') {
            ownerName = name;
            break;
          }
          owner = owner._debugOwner;
          ownerHops += 1;
        }

        return {
          fileName: src.fileName,
          lineNumber: src.lineNumber,
          columnNumber: src.columnNumber,
          tagName: componentNameOf(fiber.elementType || fiber.type),
          props: fiber.memoizedProps || {},
          ownerName,
        };
      }
      fiber = fiber.return;
      hops += 1;
    }
    return null;
  };

  // --------------------------------------------------------------- styling

  /** Which styling idiom did the author use here? Decides how an edit is written back. */
  const describeStyling = (props) => {
    const className = typeof props.className === 'string' ? props.className : null;
    const sx = props.sx;
    const hasSx = sx != null && typeof sx === 'object' && !Array.isArray(sx);
    return {
      // `kind` is the field name the inspector reads; keep them in step.
      kind: hasSx ? 'sx' : className != null ? 'className' : 'none',
      className: className || '',
      // Only plain-object sx round-trips safely; a callback sx is agent territory.
      sx: hasSx ? JSON.parse(JSON.stringify(sx, (_k, v) => (typeof v === 'function' ? undefined : v))) : null,
      // A computed className or callback sx can't be edited textually, so the
      // inspector greys out the direct controls and routes to the agent.
      dynamic: typeof sx === 'function' || Array.isArray(sx),
    };
  };

  /** The element's own text, when its children are text and nothing else.
   *
   * Whitespace-only text nodes are ignored rather than disqualifying: JSX
   * routinely leaves them around a single child from indentation, and treating
   * them as "mixed content" made every real heading come back uneditable.
   */
  const directText = (node) => {
    const kids = Array.from(node.childNodes);
    const meaningful = kids.filter(
      (k) => k.nodeType !== Node.TEXT_NODE || k.textContent.trim() !== '',
    );
    if (meaningful.length === 1 && meaningful[0].nodeType === Node.TEXT_NODE) {
      return meaningful[0].textContent.trim();
    }
    return null;
  };

  // --------------------------------------------------------------- overlay

  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483600;contain:layout style size;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .box { position:fixed; pointer-events:none; border-radius:3px; transition:all .06s linear; }
      .hover { border:1.5px dashed rgba(10,132,255,.9); background:rgba(10,132,255,.06); }
      .sel   { border:2px solid #0A84FF; background:rgba(10,132,255,.10);
               box-shadow:0 0 0 1px rgba(255,255,255,.55); }
      .tag   { position:fixed; pointer-events:none; font:600 10px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif;
               color:#fff; background:#0A84FF; padding:2px 6px; border-radius:4px; white-space:nowrap;
               box-shadow:0 1px 4px rgba(0,0,0,.25); }
      .hidden { display:none; }
    </style>
    <div class="box hover hidden" id="hover"></div>
    <div class="box sel hidden" id="sel"></div>
    <div class="tag hidden" id="tag"></div>
  `;
  const els = {
    hover: shadow.getElementById('hover'),
    sel: shadow.getElementById('sel'),
    tag: shadow.getElementById('tag'),
  };

  const place = (box, node) => {
    if (!node || !node.isConnected) {
      box.classList.add('hidden');
      return null;
    }
    const r = node.getBoundingClientRect();
    if (!r.width && !r.height) {
      box.classList.add('hidden');
      return null;
    }
    box.classList.remove('hidden');
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    return r;
  };

  const showTag = (node, label) => {
    const r = node.getBoundingClientRect();
    els.tag.classList.remove('hidden');
    els.tag.textContent = label;
    const above = r.top > 22;
    els.tag.style.left = `${Math.max(4, r.left)}px`;
    els.tag.style.top = above ? `${r.top - 20}px` : `${r.bottom + 4}px`;
  };

  const redraw = () => {
    if (!state.enabled) return;
    place(els.sel, state.selected);
    if (state.hovered && state.hovered !== state.selected) {
      const r = place(els.hover, state.hovered);
      if (r) showTag(state.hovered, state.hovered.__osLabel || state.hovered.tagName.toLowerCase());
    } else {
      els.hover.classList.add('hidden');
      els.tag.classList.add('hidden');
    }
  };

  // ---------------------------------------------------------------- bridge

  const post = (type, payload) => {
    try {
      window.parent.postMessage({ channel: CHANNEL, protocol: PROTOCOL, type, payload }, '*');
    } catch (_) {
      /* parent went away */
    }
  };

  const payloadFor = (node) => {
    const resolved = resolveSource(node);
    if (!resolved) return null;
    const computed = getComputedStyle(node);
    const styling = describeStyling(resolved.props);
    return {
      source: {
        fileName: resolved.fileName,
        lineNumber: resolved.lineNumber,
        columnNumber: resolved.columnNumber,
      },
      // Fall back to the DOM tag: a host element's fiber type is the string
      // itself, but a memo/forwardRef wrapper can leave it null, which used to
      // render the header as a literal "null".
      tagName: resolved.tagName || node.tagName.toLowerCase(),
      domTag: node.tagName.toLowerCase(),
      ownerName: resolved.ownerName || '',
      styling,
      text: directText(node) || '',
      computed: {
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        padding: computed.padding,
        margin: computed.margin,
        display: computed.display,
        borderRadius: computed.borderRadius,
      },
      rect: (({ x, y, width, height }) => ({ x, y, width, height }))(node.getBoundingClientRect()),
    };
  };

  // ---------------------------------------------------------------- events

  const onMove = (e) => {
    if (!state.enabled) return;
    const node = e.target;
    if (!(node instanceof HTMLElement) || node === host) return;
    state.hovered = node;
    const resolved = resolveSource(node);
    node.__osLabel = resolved
      ? `${resolved.tagName || node.tagName.toLowerCase()}${resolved.ownerName ? ` · ${resolved.ownerName}` : ''}`
      : `${node.tagName.toLowerCase()} · no source`;
    redraw();
  };

  const onClick = (e) => {
    if (!state.enabled) return;
    e.preventDefault();
    e.stopPropagation();
    const node = e.target;
    if (!(node instanceof HTMLElement)) return;
    state.selected = node;
    redraw();
    const payload = payloadFor(node);
    post(payload ? 'selected' : 'select-failed', payload || { domTag: node.tagName.toLowerCase() });
  };

  const onKey = (e) => {
    if (!state.enabled) return;
    if (e.key === 'Escape') {
      state.selected = null;
      state.hovered = null;
      redraw();
      post('cleared', null);
    }
  };

  const setEnabled = (on, srcRoot) => {
    state.enabled = on;
    if (typeof srcRoot === 'string' && srcRoot) state.srcRoot = srcRoot;
    if (!on) {
      state.hovered = null;
      state.selected = null;
      [els.hover, els.sel, els.tag].forEach((n) => n.classList.add('hidden'));
      document.body.style.cursor = '';
    } else {
      document.body.style.cursor = 'crosshair';
    }
    post('state', { enabled: on });
  };

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || msg.channel !== CHANNEL) return;
    if (msg.type === 'enable') setEnabled(true, msg.payload && msg.payload.srcRoot);
    else if (msg.type === 'disable') setEnabled(false);
    else if (msg.type === 'ping') post('pong', { protocol: PROTOCOL, ready: true });
    else if (msg.type === 'reselect') {
      // After a source edit + HMR the old node is gone; re-resolve by source position.
      const want = msg.payload || {};
      const all = document.querySelectorAll('*');
      for (const node of all) {
        const r = resolveSource(node);
        if (r && r.fileName === want.fileName && r.lineNumber === want.lineNumber) {
          state.selected = node;
          redraw();
          post('selected', payloadFor(node));
          return;
        }
      }
      post('cleared', null);
    }
  });

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', redraw, true);
  window.addEventListener('resize', redraw);

  const attach = () => {
    if (document.body && !host.isConnected) document.body.appendChild(host);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }

  // Re-place the boxes after HMR swaps the tree underneath us.
  if (import.meta.hot) {
    import.meta.hot.on('vite:afterUpdate', () => {
      attach();
      setTimeout(redraw, 60);
    });
  }

  window.__osVisualEditor = { setEnabled, state, version: PROTOCOL };
  post('ready', { protocol: PROTOCOL });
}
