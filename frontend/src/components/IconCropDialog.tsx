import React, { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import Slider from '@mui/material/Slider';
import CircularProgress from '@mui/material/CircularProgress';
import CropRoundedIcon from '@mui/icons-material/CropRounded';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { pushButton, primaryButton } from '@/shared/styles/ui';
import { gitgraphIconApplyUrl, gitgraphIconRawUrl } from '@/shared/state/API_ENDPOINTS';

interface Props {
  open: boolean;
  onClose: () => void;
  iconId: string;
  appName: string;
  /** Called after the cropped image is committed as the new icon. */
  onApplied: () => void;
}

const VIEWPORT = 280; // on-screen crop square, px
const OUTPUT = 512; // committed icon resolution, px
const MAX_ZOOM = 3;

// Canvas can only emit these raster types. Anything else (notably the backend's
// image/jpeg) still round-trips, we just fall back to the nearest encodable
// type that keeps the committed filename stable.
const CANVAS_MIME: Record<string, string> = {
  'image/webp': 'image/webp',
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
};

/** Crop a raster image to a square and re-encode it as its ORIGINAL type. */
function rasterCropDataUri(
  img: HTMLImageElement,
  sx: number,
  sy: number,
  s: number,
  srcMime: string,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT;
  canvas.height = OUTPUT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas context');
  ctx.imageSmoothingQuality = 'high';
  // jpeg has no alpha; paint white first so transparent source pixels don't
  // come out black.
  const outMime = CANVAS_MIME[srcMime] || 'image/png';
  if (outMime === 'image/jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, OUTPUT, OUTPUT);
  }
  ctx.drawImage(img, sx, sy, s, s, 0, 0, OUTPUT, OUTPUT);
  // quality arg is ignored by png, honored by webp/jpeg.
  return canvas.toDataURL(outMime, 0.95);
}

/**
 * Crop an SVG to a square WITHOUT rasterizing, so the icon stays vector.
 *
 * The crop rect (sx,sy,s) is in the pixel space the <img> rendered the SVG in,
 * i.e. nat.w x nat.h. We can't just put that rect in an outer viewBox, because
 * the source SVG's own viewBox may use different user units. So we NEST the
 * original SVG, forced to width=nat.w height=nat.h (its own viewBox then scales
 * its content into exactly that box, matching what the <img> showed), and crop
 * with an outer viewBox in those same nat pixels.
 */
function svgCropDataUri(
  svgText: string,
  sx: number,
  sy: number,
  s: number,
  nat: { w: number; h: number },
): string {
  let inner = svgText.replace(/<\?xml[^>]*\?>/i, '').replace(/<!DOCTYPE[^>]*>/i, '').trim();
  // Force explicit width/height on the root <svg> so the nested viewport is
  // exactly nat.w x nat.h regardless of the source's own width/height.
  inner = inner.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
    let a = attrs
      .replace(/\swidth\s*=\s*(".*?"|'.*?'|\S+)/i, '')
      .replace(/\sheight\s*=\s*(".*?"|'.*?'|\S+)/i, '');
    if (!/xmlns\s*=/.test(a)) a += ' xmlns="http://www.w3.org/2000/svg"';
    return `<svg${a} width="${nat.w}" height="${nat.h}">`;
  });
  const wrapped =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OUTPUT}" height="${OUTPUT}" ` +
    `viewBox="${sx} ${sy} ${s} ${s}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(wrapped)))}`;
}

/**
 * Crop the app's committed icon down to a square and commit the result as the
 * new icon. The source image pans (drag) and zooms (slider) inside a fixed
 * square viewport; on save the visible region is rendered to a canvas and sent
 * to the same apply endpoint the generate flow uses, so the dashboard tile and
 * GitHub both pick it up. Pure canvas — no crop library — and same-origin, so
 * the canvas never taints.
 */
const IconCropDialog: React.FC<Props> = ({ open, onClose, iconId, appName, onApplied }) => {
  const c = useClaudeTokens();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const svgTextRef = useRef<string | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [srcMime, setSrcMime] = useState<string>('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [loadErr, setLoadErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  // Load the current icon fresh each time the dialog opens. We fetch the blob
  // (rather than pointing an <img> straight at the URL) so we learn the icon's
  // real MIME type from the response and can re-encode the crop to the SAME
  // type on save. The backend derives the committed filename from that MIME and
  // deletes the other icon.* variants, so encoding a webp as png would silently
  // turn icon.webp into icon.png.
  useEffect(() => {
    if (!open) return;
    setNat(null);
    setSrcMime('');
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setLoadErr(false);
    setSaveErr(null);
    setBusy(false);

    let objectUrl = '';
    let cancelled = false;
    const img = new Image();
    imgRef.current = img;

    // no-store on the endpoint keeps this honest; bust anyway so a re-open
    // after a previous crop never shows the pre-crop image.
    fetch(`${gitgraphIconRawUrl(iconId)}?v=${Date.now()}`)
      .then(res => {
        if (!res.ok) throw new Error(`icon ${res.status}`);
        return res.blob();
      })
      .then(async blob => {
        if (cancelled) return;
        const mime = (blob.type || '').split(';')[0].trim().toLowerCase();
        setSrcMime(mime);
        // Keep the raw SVG markup so we can crop it as vector (via viewBox) on
        // save instead of rasterizing it into a png.
        svgTextRef.current = mime === 'image/svg+xml' ? await blob.text() : null;
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        img.onload = () => {
          if (cancelled) return;
          setNat({ w: img.naturalWidth || 300, h: img.naturalHeight || 300 });
        };
        img.onerror = () => !cancelled && setLoadErr(true);
        img.src = objectUrl;
      })
      .catch(() => !cancelled && setLoadErr(true));

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, iconId]);

  // baseScale = cover: the image's smaller side exactly fills the viewport.
  const baseScale = nat ? VIEWPORT / Math.min(nat.w, nat.h) : 1;
  const scale = baseScale * zoom;
  const dispW = nat ? nat.w * scale : VIEWPORT;
  const dispH = nat ? nat.h * scale : VIEWPORT;

  const clampPan = useCallback(
    (x: number, y: number) => {
      const maxX = Math.max(0, (dispW - VIEWPORT) / 2);
      const maxY = Math.max(0, (dispH - VIEWPORT) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, x)),
        y: Math.min(maxY, Math.max(-maxY, y)),
      };
    },
    [dispW, dispH],
  );

  // Re-clamp pan whenever zoom changes so the image can never expose an edge.
  useEffect(() => {
    setPan(p => clampPan(p.x, p.y));
  }, [zoom, clampPan]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: pan.x, oy: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.px;
    const dy = e.clientY - drag.current.py;
    setPan(clampPan(drag.current.ox + dx, drag.current.oy + dy));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const left = VIEWPORT / 2 + pan.x - dispW / 2;
  const top = VIEWPORT / 2 + pan.y - dispH / 2;

  const apply = async () => {
    if (!nat || !imgRef.current) return;
    setBusy(true);
    setSaveErr(null);
    try {
      // Map the viewport square back into source pixels. Same transform as the
      // on-screen preview, so what you framed is what gets cropped.
      const sx = -left / scale;
      const sy = -top / scale;
      const s = VIEWPORT / scale;

      // Preserve the icon's original format. The backend names the committed
      // file from the data URI's MIME (icon.webp / icon.png / icon.jpg /
      // icon.svg) and deletes the other variants, so re-encoding a webp as png
      // would rename the file and break anything referencing the old name.
      const dataUri =
        srcMime === 'image/svg+xml' && svgTextRef.current
          ? svgCropDataUri(svgTextRef.current, sx, sy, s, nat)
          : rasterCropDataUri(imgRef.current, sx, sy, s, srcMime);

      const res = await fetch(gitgraphIconApplyUrl(iconId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_uri: dataUri, message: 'Crop app icon' }),
      });
      if (!res.ok) throw new Error(`apply ${res.status}`);
      onApplied();
      onClose();
    } catch {
      setSaveErr("Couldn't save the cropped icon.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      slotProps={{
        paper: {
          sx: {
            background: c.bg.surface,
            border: `1px solid ${c.border.medium}`,
            borderRadius: `${c.radius.lg}px`,
            boxShadow: c.shadow.lg,
            width: 360,
            maxWidth: '90vw',
          },
        },
      }}
    >
      <Box sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <CropRoundedIcon sx={{ fontSize: 18, color: c.text.tertiary }} />
          <Box sx={{ ...c.type.title3, color: c.text.primary }}>Crop icon</Box>
        </Box>
        <Box sx={{ ...c.type.caption, color: c.text.muted, mb: 2 }}>
          Drag to reposition, zoom to frame. The square you see becomes {appName}'s new icon.
        </Box>

        {loadErr ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              ...c.type.body,
              color: c.status.error,
              py: 4,
              justifyContent: 'center',
            }}
          >
            <ErrorOutlineRoundedIcon sx={{ fontSize: 18 }} />
            Couldn't load this icon.
          </Box>
        ) : (
          <>
            <Box
              onPointerDown={nat ? onPointerDown : undefined}
              onPointerMove={nat ? onPointerMove : undefined}
              onPointerUp={onPointerUp}
              sx={{
                position: 'relative',
                width: VIEWPORT,
                height: VIEWPORT,
                maxWidth: '100%',
                mx: 'auto',
                borderRadius: `${c.radius.md}px`,
                overflow: 'hidden',
                background: c.bg.secondary,
                border: `1px solid ${c.border.medium}`,
                cursor: nat ? 'grab' : 'default',
                touchAction: 'none',
                '&:active': { cursor: nat ? 'grabbing' : 'default' },
              }}
            >
              {nat ? (
                <Box
                  component="img"
                  src={imgRef.current?.src}
                  alt=""
                  draggable={false}
                  sx={{
                    position: 'absolute',
                    left,
                    top,
                    width: dispW,
                    height: dispH,
                    maxWidth: 'none',
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                />
              ) : (
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CircularProgress size={22} sx={{ color: c.text.tertiary }} />
                </Box>
              )}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2 }}>
              <ZoomInRoundedIcon sx={{ fontSize: 18, color: c.text.tertiary }} />
              <Slider
                value={zoom}
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                disabled={!nat}
                onChange={(_, v) => setZoom(v as number)}
                sx={{
                  color: c.accent.primary,
                  '& .MuiSlider-thumb': { width: 14, height: 14 },
                }}
              />
            </Box>
          </>
        )}

        {saveErr && (
          <Box sx={{ ...c.type.caption, color: c.status.error, mt: 1 }}>{saveErr}</Box>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2.5 }}>
          <ButtonBase sx={pushButton(c)} onClick={onClose} disabled={busy}>
            Cancel
          </ButtonBase>
          <ButtonBase
            sx={primaryButton(c)}
            onClick={() => void apply()}
            disabled={busy || !nat || loadErr}
          >
            {busy ? (
              <>
                <CircularProgress size={14} sx={{ color: '#fff', mr: 0.5 }} />
                Saving…
              </>
            ) : (
              'Set as icon'
            )}
          </ButtonBase>
        </Box>
      </Box>
    </Dialog>
  );
};

export default IconCropDialog;
