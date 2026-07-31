import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ContentCopy,
  Edit as EditIcon,
  OpenInNew as ExternalLinkIcon,
} from '@mui/icons-material';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import { alpha, useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { LinkElementProps } from '@yoopta/link';
import copy from 'copy-to-clipboard';
import { createPortal } from 'react-dom';

import { LinkHoverEdit } from './link-hover-edit';

type LinkHoverPopoverProps = {
  elementProps: LinkElementProps;
  linkText: string;
  onUpdate: (props: Partial<LinkElementProps>, newText?: string) => void;
  onDelete: () => void;
  children: React.ReactNode;
};

export const LinkHoverPopover = ({
  elementProps,
  linkText,
  onUpdate,
  onDelete,
  children,
}: LinkHoverPopoverProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedUrl, setEditedUrl] = useState(elementProps.url ?? '');
  const [editedText, setEditedText] = useState(linkText);
  const [copied, setCopied] = useState(false);
  const theme = useTheme();

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setEditedUrl(elementProps.url ?? '');
    setEditedText(linkText);
  }, [elementProps.url, linkText]);

  useEffect(() => {
    if (isEditing && urlInputRef.current) {
      urlInputRef.current.focus();
      urlInputRef.current.select();
    }
  }, [isEditing]);

  const onMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsOpen(true);
  };

  const onMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false);
      setIsEditing(false);
    }, 150);
  };

  // Touch has no hover: a tap on the link toggles the popover instead of
  // navigating; the popover's own Open action follows the URL.
  const onTouchToggle = (e: React.MouseEvent) => {
    const coarse =
      typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    if (!coarse) return;

    e.preventDefault();
    e.stopPropagation();
    setIsOpen((prev) => !prev);
  };

  const openLink = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (elementProps.url) {
      window.open(elementProps.url, elementProps.target ?? '_blank', elementProps.rel);
    }
  };

  const copyUrl = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (elementProps.url) {
      const success = copy(elementProps.url);
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    }
  };

  const editUrl = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsEditing(true);
  };

  const saveEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onUpdate({ url: editedUrl }, editedText);
    setIsEditing(false);
  };

  const cancelEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditedUrl(elementProps.url ?? '');
    setEditedText(linkText);
    setIsEditing(false);
  };

  const deleteLink = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete();
    setIsEditing(false);
    setIsOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onUpdate({ url: editedUrl }, editedText);
      setIsEditing(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setEditedUrl(elementProps.url ?? '');
      setEditedText(linkText);
      setIsEditing(false);
    }
  };

  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(
    null,
  );

  useEffect(() => {
    if (!isOpen || !containerRef.current) {
      setPopoverPosition(null);
      return;
    }

    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // clamp the anchor so translate(-50%) cannot push the popover past the
      // viewport edges (minWidth 280 -> half-width 140 + 8px gutter)
      const halfWidth = 148;
      const viewportWidth = window.innerWidth;
      setPopoverPosition({
        top: rect.top - 8,
        left: Math.min(Math.max(rect.left + rect.width / 2, halfWidth), viewportWidth - halfWidth),
      });
    };

    measure();

    // fixed-position coordinates go stale on every scroll, resize, and mobile
    // keyboard appearance
    window.addEventListener('scroll', measure, { passive: true, capture: true });
    window.addEventListener('resize', measure, { passive: true });
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);

    return () => {
      window.removeEventListener('scroll', measure, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [isOpen]);

  const popoverContent =
    isOpen && popoverPosition ? (
      <Paper
        elevation={8}
        sx={{
          position: 'fixed',
          zIndex: 9999,
          top: `${popoverPosition.top}px`,
          left: `${popoverPosition.left}px`,
          transform: 'translate(-50%, -100%)',
          minWidth: 'min(280px, calc(100vw - 16px))',
          maxWidth: 'min(400px, calc(100vw - 16px))',
          borderRadius: 2,
          border: `1px solid ${theme.palette.divider}`,
          bgcolor: alpha(theme.palette.background.paper, 0.95),
          backdropFilter: 'blur(8px)',
          px: 1.5,
          py: 1,
          transition: 'all 0.2s ease-out',
        }}
        contentEditable={false}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}>
        {isEditing ? (
          <LinkHoverEdit
            textInputRef={textInputRef}
            urlInputRef={urlInputRef}
            editedText={editedText}
            editedUrl={editedUrl}
            onChangeLinkText={(e) => setEditedText(e.target.value)}
            onChangeLinkUrl={(e) => setEditedUrl(e.target.value)}
            onKeyDown={onKeyDown}
            saveEdit={saveEdit}
            cancelEdit={cancelEdit}
            deleteLink={deleteLink}
          />
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0, backgroundColor: 'transparent' }}>
              <Typography
                variant="body1"
                sx={{
                  fontSize: '0.875rem',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                {elementProps.url ?? 'No URL'}
              </Typography>
            </Box>
            <Box
              sx={{
                width: 1,
                height: 16,
                bgcolor: 'divider',
              }}
            />
            <Tooltip title="Open link" arrow>
              <IconButton
                size="small"
                onClick={openLink}
                disabled={!elementProps.url}
                sx={{ width: 28, height: 28 }}>
                <ExternalLinkIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={copied ? 'Copied!' : 'Copy URL'} arrow>
              <IconButton
                size="small"
                onClick={copyUrl}
                disabled={!elementProps.url}
                sx={{ width: 28, height: 28 }}>
                {copied ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Edit URL" arrow>
              <IconButton size="small" onClick={editUrl} sx={{ width: 28, height: 28 }}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Paper>
    ) : null;

  return (
    <>
      <Box
        ref={containerRef}
        component="span"
        sx={{ position: 'relative', display: 'inline-block' }}
        contentEditable={false}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={onTouchToggle}>
        {children}
      </Box>
      {typeof document !== 'undefined' && createPortal(popoverContent, document.body)}
    </>
  );
};
