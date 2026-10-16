export interface ConventionalOptions {
  types: string[];
  scopeRequired: boolean;
  subjectMaxLength: number;
  additionalInstructions: string;
}

export function loadConventionalPattern(options: {
  types: string[];
  scopeRequired: boolean;
}): RegExp {
  const types = options.types
    .map((type) => type.trim().replace(/[^\w-]/g, ''))
    .filter(Boolean)
    .map(escapeRegExp);
  const typePattern = types.length > 0 ? types.join('|') : '\\w+';
  const scope = options.scopeRequired
    ? '\\([^\\r\\n()]+\\)'
    : '(?:\\([^\\r\\n()]+\\))?';
  return new RegExp(`^(?:${typePattern})${scope}!?: [^\r\n]+$`);
}

export function validateConventionalMessage(
  message: string,
  options: ConventionalOptions
): void {
  const headerPattern = loadConventionalPattern(options);
  const [header] = message.split(/\r?\n/, 1);

  if (!headerPattern.test(header)) {
    throw new Error(
      `LLM returned a non-Conventional Commits header: "${header}". Expected format: type(scope)!: subject`
    );
  }

  const subjectText = header.replace(/^[^:]+:\s*/, '');
  if (subjectText.length > options.subjectMaxLength) {
    throw new Error(
      `Commit subject is ${subjectText.length} characters; maximum is ${options.subjectMaxLength}.`
    );
  }
  if (subjectText.endsWith('.')) {
    throw new Error('Commit subject must not end with a period.');
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
