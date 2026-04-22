interface ClientAvatarProps {
    gender?: 'male' | 'female' | null;
    dataQuality?: 'correct' | 'incorrect' | 'needs_edit' | null;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

const bgConfig = {
    correct:    { bg: 'bg-emerald-100', border: 'border-emerald-200', icon: 'text-emerald-600' },
    incorrect:  { bg: 'bg-red-100',     border: 'border-red-200',     icon: 'text-red-500'     },
    needs_edit: { bg: 'bg-amber-100',   border: 'border-amber-200',   icon: 'text-amber-600'   },
    default:    { bg: 'bg-slate-100',   border: 'border-slate-200',   icon: 'text-slate-400'   },
};

const sizeConfig = {
    sm: { wrapper: 'w-9 h-9',   svg: 28 },
    md: { wrapper: 'w-12 h-12', svg: 38 },
    lg: { wrapper: 'w-24 h-24', svg: 76 },
};

function MaleIcon({ size, className }: { size: number; className: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            {/* Head */}
            <circle cx="32" cy="20" r="12" className="fill-current" opacity="0.9" />
            {/* Body */}
            <path d="M14 56c0-9.941 8.059-18 18-18s18 8.059 18 18H14z" className="fill-current" opacity="0.75" />
            {/* Collar */}
            <path d="M27 38l5 6 5-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.6" />
        </svg>
    );
}

function FemaleIcon({ size, className }: { size: number; className: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            {/* Hijab outer */}
            <ellipse cx="32" cy="21" rx="16" ry="14" className="fill-current" opacity="0.5" />
            {/* Face */}
            <ellipse cx="32" cy="22" rx="10" ry="11" fill="white" opacity="0.85" />
            {/* Face features placeholder (just face area) */}
            <ellipse cx="32" cy="22" rx="8" ry="9" className="fill-current" opacity="0.15" />
            {/* Hijab wrap below chin */}
            <path d="M16 28 Q16 40 32 40 Q48 40 48 28 Q44 36 32 36 Q20 36 16 28z" className="fill-current" opacity="0.5" />
            {/* Body / abaya */}
            <path d="M12 56c0-11 9-20 20-20s20 9 20 20H12z" className="fill-current" opacity="0.7" />
        </svg>
    );
}

export default function ClientAvatar({ gender, dataQuality, size = 'sm', className = '' }: ClientAvatarProps) {
    const colors = bgConfig[dataQuality ?? 'default'] ?? bgConfig.default;
    const dims = sizeConfig[size];

    return (
        <div
            className={`${dims.wrapper} rounded-full ${colors.bg} border ${colors.border} flex items-center justify-center shrink-0 ${className}`}
        >
            {gender === 'female' ? (
                <FemaleIcon size={dims.svg * 0.72} className={colors.icon} />
            ) : (
                <MaleIcon size={dims.svg * 0.72} className={colors.icon} />
            )}
        </div>
    );
}
