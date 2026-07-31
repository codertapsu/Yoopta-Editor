export type SlashCommandContentProps = {
  children: React.ReactNode;
  className?: string;
};

const isFormField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

export const SlashCommandContent = ({ children, className }: SlashCommandContentProps) => {
  // Keep the editor selection intact when the menu surface is pressed — but a
  // blanket preventDefault would also stop the child search input from ever
  // receiving focus, making it unusable by mouse or touch.
  const preventUnlessFormField = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (!isFormField(e.target)) e.preventDefault();
  };

  return (
    <div
      tabIndex={0}
      role="listbox"
      aria-label="Slash commands"
      className={`yoopta-ui-slash-command-content ${className || ''}`}
      onPointerDown={preventUnlessFormField}
      onMouseDown={preventUnlessFormField}
      onMouseMove={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
};

SlashCommandContent.displayName = 'SlashCommand.Content';
