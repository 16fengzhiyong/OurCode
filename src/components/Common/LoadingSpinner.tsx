interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  text?: string
}

const sizes = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-3',
}

export default function LoadingSpinner({ size = 'md', text }: LoadingSpinnerProps) {
  return (
    <div className="flex items-center gap-2">
      <div className={`${sizes[size]} border-nova-border border-t-nova-accent rounded-full animate-spin`} />
      {text && <span className="text-xs text-nova-text-muted">{text}</span>}
    </div>
  )
}
