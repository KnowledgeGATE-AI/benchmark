import { useEffect, ReactNode } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: ReactNode;
}

const sizeClasses: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-xl md:max-w-2xl',
  lg: 'sm:max-w-xl md:max-w-2xl lg:max-w-4xl',
  xl: 'sm:max-w-2xl md:max-w-4xl lg:max-w-6xl',
};

const Modal = ({ isOpen, onClose, title, size = 'lg', children }: ModalProps) => {
  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 transition-theme"
      onClick={onClose}
    >
      {/* Backdrop with translucent blur */}
      <div className="absolute inset-0 bg-black/75 dark:bg-black/90 backdrop-blur-md transition-theme" />

      {/* Modal panel */}
      <div
        className={`relative w-full max-w-[95vw] ${sizeClasses[size]} max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-2xl transition-theme animate-slide-in`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6 transition-theme">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-slate-50">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1.5 sm:p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 flex-shrink-0"
              aria-label="Close modal"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 sm:h-6 sm:w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">{children}</div>
      </div>
    </div>
  );
};

export default Modal;
