import { useEffect, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './ui';

interface Props {
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  /** The action cannot be undone: the button reads red. */
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * A question in the app's own glass, in place of the browser's confirm box
 * (which a host frame may not show). Escape and the veil close it; only the
 * green (or red) button acts.
 */
export function ConfirmDialog({ title, children, confirmLabel, danger, disabled, busy, onConfirm, onClose }: Props) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="b-veil" onClick={onClose}>
      <div className="glass b-dialog narrow" role="alertdialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="b-dialog-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn round" aria-label={t('action.close')} title={t('action.close')} onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
        {children}
        <div className="b-actions">
          <button type="button" onClick={onClose} disabled={busy}>{t('entry.cancel')}</button>
          <button type="button" className={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={disabled || busy}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
